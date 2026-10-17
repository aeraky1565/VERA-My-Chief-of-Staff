// ============================================================
// VERA — GenerationInputs.js
// What each packing list and Discover run was actually built from.
// ============================================================
//
// Packing lists and Discover suggestions are supposed to account for the weather,
// the time of year, the destination and what the trip is for. Nothing used to record
// whether they did — so a list built blind looked exactly like a well-grounded one.
// That is not hypothetical: dashboard-lite never sent an end date, every packing list
// generated from it went out with no weather at all, and nothing anywhere said so.
//
// So each generation now saves a record, one per trip and kind, of every factor it
// used and how solid each one was:
//
//   used     it was there, and here is what it was
//   weak     it was there, but shaky — a destination guessed from the trip's name,
//            or last year's weather standing in for a forecast
//   missing  it wasn't there, and here is why
//   none     nothing applied, and that's normal (no dress codes on a beach trip)
//
// The dashboards draw a banner from the record, and a weak or missing factor raises
// a VERA flag. A nightly pass adds the two things a record can't know at generation
// time: that a real forecast has since become available, and that a list predates
// all of this.
// ============================================================

var GEN_INPUTS_TAB_     = 'Generation Inputs';
var GEN_INPUTS_HEADERS_ = ['Trip Key', 'Kind', 'Generated At', 'Inputs'];
var GEN_KINDS_          = { packing: 'Packing list', discover: 'Discover suggestions' };
var GEN_UPCOMING_DAYS_  = 60;   // nightly checks look at trips starting within this
var GEN_FORECAST_DAYS_  = 14;   // the weather lookup switches to a forecast here
var GEN_TROPICS_LAT_    = 23.44; // the Tropics of Cancer and Capricorn
var GEN_PORT_RADIUS_KM_ = 50;    // a "port" this close to the base is the home port

// ============================================================
// TIME OF YEAR — now hemisphere-aware
// ============================================================

/**
 * The season at the destination on the trip's first day.
 *
 * It used to come from the month alone, so December in Sydney was "Winter". The
 * latitude is free — the weather lookup already geocodes the destination — and it
 * settles it: south of the Tropics the seasons flip, and inside them (23.44° either
 * side of the equator) there isn't a season worth naming. That cut-off was 15° at
 * first, which would have called November in Puerto Plata (19.8°N) "Fall". With no
 * latitude the northern answer is given, marked as an assumption, not presented as fact.
 */
function tripSeason_(startDate, lat) {
  var m = parseInt(String(startDate || '').substring(5, 7), 10);
  if (!m) return { season: '', basis: 'no-date' };
  var north = (m === 12 || m <= 2) ? 'Winter' : m <= 5 ? 'Spring' : m <= 8 ? 'Summer' : 'Fall';
  var flip  = { Winter: 'Summer', Spring: 'Fall', Summer: 'Winter', Fall: 'Spring' };
  if (lat === null || lat === undefined || !isFinite(lat)) return { season: north, basis: 'assumed-north' };
  if (Math.abs(lat) < GEN_TROPICS_LAT_) return { season: 'Tropical (no real seasons)', basis: 'tropical' };
  if (lat < 0) return { season: flip[north], basis: 'south' };
  return { season: north, basis: 'north' };
}

// ============================================================
// THE FACTORS — pure, so the tests can drive every state
// ============================================================

function genFactor_(id, label, status, detail, hint) {
  return { id: id, label: label, status: status, detail: detail || '', hint: hint || '' };
}

var GEN_DEST_SOURCE_ = { flight: 'from the flight', hotel: 'from where you’re staying', locations: 'from the itinerary’s places' };

function genDestinationFactor_(dest, labelIsUnusable, ports) {
  var stops = (ports || []).map(function(p) { return p.label; }).filter(Boolean);
  var stopText = stops.length ? ' \u00b7 cruise stops: ' + stops.join(', ') : '';
  if (!dest || !dest.value) {
    return genFactor_('destination', 'Destination', 'missing', 'Not known',
      'Add a flight or a hotel to the itinerary so VERA knows where you’re going.');
  }
  if (dest.source === 'label') {
    return genFactor_('destination', 'Destination', 'weak',
      labelIsUnusable ? 'Only the trip’s name, which isn’t used as a place'
                      : '“' + dest.value + '”, guessed from the trip’s name',
      'Add a flight or a hotel to the itinerary so the destination is certain.');
  }
  return genFactor_('destination', 'Destination', 'used',
    (dest.label || dest.value) + ' (' + (GEN_DEST_SOURCE_[dest.source] || dest.source) + ')' + stopText);
}

function genDatesFactor_(startDate, endDate, season) {
  if (!startDate || !endDate) {
    return genFactor_('dates', 'Dates & time of year', 'missing',
      'No ' + (startDate ? 'end' : 'start') + ' date', 'Set the trip’s dates.');
  }
  var detail = startDate + ' to ' + endDate + (season.season ? ' · ' + season.season : '');
  if (season.basis === 'assumed-north') {
    return genFactor_('dates', 'Dates & time of year', 'weak', detail + ' (hemisphere unknown, assumed northern)',
      'Once the destination is known, the season is worked out for it.');
  }
  return genFactor_('dates', 'Dates & time of year', 'used', detail);
}

function genWeatherFactor_(w) {
  if (!w || !w.summary) {
    return genFactor_('weather', 'Weather', 'missing', (w && w.reason) ? 'None: ' + w.reason : 'None',
      'Fix what’s missing above (usually the destination or dates), then regenerate.');
  }
  if (w.mode === 'last_year') {
    return genFactor_('weather', 'Weather', 'weak', 'Last year’s weather on these dates: ' + w.summary.replace(/^\([^)]*\)\s*/, ''),
      'A real forecast arrives 14 days before the trip. Regenerate then.');
  }
  return genFactor_('weather', 'Weather', 'used', 'Forecast: ' + w.summary);
}

function genCharacteristicsFactor_(traits) {
  return traits
    ? genFactor_('characteristics', 'Trip characteristics', 'used', traits)
    : genFactor_('characteristics', 'Trip characteristics', 'missing', 'None set',
        'Say what the trip involves (beach, hiking, formal dinners…) in the trip’s characteristics.');
}

function genLessonsFactor_(block, error) {
  if (error) return genFactor_('lessons', 'Lessons from past trips', 'missing', 'Couldn’t read them: ' + error);
  var n = (String(block || '').match(/^\s*[-•*]/gm) || []).length;
  return block
    ? genFactor_('lessons', 'Lessons from past trips', 'used', n ? n + ' applied' : 'Applied')
    : genFactor_('lessons', 'Lessons from past trips', 'none', 'None that apply to this trip');
}

/**
 * The eight packing factors. `g` is what webGeneratePacking_ gathered:
 *   destination {value, source}, startDate, endDate, weather (getPackingWeatherDetail_),
 *   activityTypes {type: true}, itinCount, traits, traveler, dressCodes [], lessons, lessonsError
 */
function packingInputFactors_(g) {
  var season = tripSeason_(g.startDate, g.weather ? g.weather.lat : null);
  var types  = Object.keys(g.activityTypes || {}).filter(Boolean);
  var codes  = (g.dressCodes || []).filter(function(c, i, a) { return c && a.indexOf(c) === i; });
  return [
    genDestinationFactor_(g.destination, false, g.ports),
    genDatesFactor_(g.startDate, g.endDate, season),
    genWeatherFactor_(g.weather),
    g.itinCount
      ? genFactor_('activities', 'Itinerary activities', 'used', g.itinCount + ' item' + (g.itinCount === 1 ? '' : 's') + (types.length ? ': ' + types.join(', ') : ''))
      : genFactor_('activities', 'Itinerary activities', 'missing', 'Nothing on the itinerary yet', 'Add the trip’s flights, stays and plans to the itinerary.'),
    genCharacteristicsFactor_(g.traits),
    // Blank is not "unset": both dashboards show it as Both, and the packing prompt
    // says "Ahmed and Victoria". The banner was the only thing calling it missing.
    genFactor_('travellers', 'Travellers', 'used', g.traveler || 'Ahmed and Victoria (the default)'),
    codes.length
      ? genFactor_('dresscodes', 'Dress codes', 'used', codes.join(', '))
      : genFactor_('dresscodes', 'Dress codes', 'none', 'None on the itinerary'),
    genLessonsFactor_(g.lessons, g.lessonsError),
  ];
}

/**
 * Discover's factors. It doesn't use travellers or dress codes; it does use the gaps
 * in each day, which is what it exists to fill. A destination guessed from the trip's
 * name is deliberately NOT searched for (it once produced a week in France for a
 * Caribbean cruise), so for Discover a label-only destination is weak and says why.
 */
function discoverInputFactors_(g) {
  var season = tripSeason_(g.startDate, g.weather ? g.weather.lat : null);
  return [
    genDestinationFactor_(g.destination, true, g.ports),
    genDatesFactor_(g.startDate, g.endDate, season),
    genWeatherFactor_(g.weather),
    genCharacteristicsFactor_(g.traits),
    g.itinCount
      ? genFactor_('itinerary', 'Itinerary and free time', 'used', g.itinCount + ' planned item' + (g.itinCount === 1 ? '' : 's') + ', gaps found from it')
      : genFactor_('itinerary', 'Itinerary and free time', 'missing', 'Nothing on the itinerary yet', 'Add what’s already planned so suggestions fill the gaps.'),
    genLessonsFactor_(g.lessons, g.lessonsError),
  ];
}

function genProblems_(factors) {
  return (factors || []).filter(function(f) { return f.status === 'weak' || f.status === 'missing'; });
}

/** "no Weather (no trip dates); Destination guessed …" — the flag's one-line summary. */
function genProblemSummary_(problems) {
  return problems.map(function(p) {
    return p.status === 'missing' ? 'no ' + p.label.toLowerCase() + (p.detail && p.detail !== 'None' && p.detail !== 'Not set' && p.detail !== 'None set' ? ' (' + p.detail.replace(/^None:\s*/, '') + ')' : '')
                                  : p.label.toLowerCase() + ': ' + p.detail;
  }).join('; ');
}

// ============================================================
// KEEPING CHECKMARKS ON REGENERATE — pure
// ============================================================

function genItemKey_(person, item) {
  return String(person || '').trim().toLowerCase() + '|' + String(item || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * How to apply a regenerated packing list without losing what you've packed.
 *
 * A CHECKED AI item is never deleted. If the new list has the same item for the
 * same person (ignoring case and spacing) the new copy is skipped, so you don't get it
 * twice; if the new list dropped it, it is kept anyway and named, so the banner can say
 * "kept from the previous list". Unchecked AI items are replaced, as before. Items you
 * added by hand are never touched — they aren't 'ai' rows.
 *
 * @param {Array} rows      this trip's existing rows: {rowNum, id, person, item, checked, source}
 * @param {Array} newItems  the new list: {person, category, item}
 * @returns {{deleteRows: number[], append: Array, keptDropped: Array}}
 */
function planPackingRegeneration_(rows, newItems) {
  var keptKeys = {}, deleteRows = [];
  (rows || []).forEach(function(r) {
    if (r.source !== 'ai') return;
    if (r.checked) keptKeys[genItemKey_(r.person, r.item)] = r;
    else deleteRows.push(r.rowNum);
  });
  var newKeys = {}, append = [];
  (newItems || []).forEach(function(n) {
    if (!n || !n.item) return;
    var k = genItemKey_(n.person, n.item);
    if (newKeys[k]) return;   // the model repeated itself
    newKeys[k] = true;
    if (!keptKeys[k]) append.push(n);
  });
  var keptDropped = Object.keys(keptKeys)
    .filter(function(k) { return !newKeys[k]; })
    .map(function(k) { return { id: keptKeys[k].id, person: keptKeys[k].person, item: keptKeys[k].item }; });
  deleteRows.sort(function(a, b) { return b - a; });   // bottom-up, so row numbers hold
  return { deleteRows: deleteRows, append: append, keptDropped: keptDropped };
}

// ============================================================
// THE RECORD
// ============================================================

function genSlug_(tripKey) {
  return String(tripKey || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function genInputsSheet_() {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(GEN_INPUTS_TAB_);
  if (!sh) {
    sh = ss.insertSheet(GEN_INPUTS_TAB_);
    sh.getRange(1, 1, 1, GEN_INPUTS_HEADERS_.length).setValues([GEN_INPUTS_HEADERS_]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** The saved record for one trip and kind, or null. */
function readGenerationInputs_(tripKey, kind) {
  var sh = getSpreadsheet().getSheetByName(GEN_INPUTS_TAB_);
  if (!sh || sh.getLastRow() < 2) return null;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, GEN_INPUTS_HEADERS_.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== tripKey || String(rows[i][1]).trim() !== kind) continue;
    try { return JSON.parse(String(rows[i][3])); } catch (e) { return null; }
  }
  return null;
}

/**
 * Saves what this generation used, replacing the trip's previous record for this kind,
 * and settles the flags: this generation's problems raise one flag; every earlier
 * generation's flags for this trip and kind close, along with any "unknown inputs" flag.
 *
 * Never throws: a list that generated fine must not fail because its receipt couldn't
 * be written. It logs instead.
 */
function recordGenerationInputs_(kind, tripKey, factors, extra) {
  try {
    var tz  = Session.getScriptTimeZone();
    var now = new Date();
    var record = {
      tripKey:     tripKey,
      kind:        kind,
      generatedAt: Utilities.formatDate(now, tz, "yyyy-MM-dd'T'HH:mm:ss"),
      stamp:       Utilities.formatDate(now, tz, 'yyyyMMddHHmmss'),
      factors:     factors,
      weatherMode: (extra && extra.weatherMode) || '',
      kept:        (extra && extra.kept) || [],
    };

    var sh   = genInputsSheet_();
    var json = JSON.stringify(record);
    var hit  = 0;
    if (sh.getLastRow() >= 2) {
      var keys = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < keys.length; i++) {
        if (String(keys[i][0]).trim() === tripKey && String(keys[i][1]).trim() === kind) { hit = i + 2; break; }
      }
    }
    var row = [tripKey, kind, record.generatedAt, json];
    if (hit) sh.getRange(hit, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);

    settleGenerationFlags_(record);
    return record;
  } catch (e) {
    Logger.log('recordGenerationInputs_ (' + kind + ', ' + tripKey + '): ' + e.message);
    return null;
  }
}

/** The web action: {ok, record|null}. */
function webGetGenerationInputs_(e) {
  var p = (e && e.parameter) || {};
  var tripKey = String(p.tripKey || '').trim();
  var kind    = String(p.kind || '').trim();
  if (!tripKey) throw new Error('tripKey is required');
  if (!GEN_KINDS_[kind]) throw new Error('kind must be packing or discover');
  return { ok: true, record: readGenerationInputs_(tripKey, kind) };
}

// ============================================================
// FLAGS — exact keys, one per generation
// ============================================================

// Keys are built from parts joined by "__". genSlug_ collapses every run of
// non-alphanumerics into ONE underscore, so "__" can never occur inside a slug — which
// is what stops "…_chicago__" from prefix-matching a different trip's
// "…_chicago_weekend__" when old flags are being closed.
function genFlagKey_(type, kind, tripKey, stamp) {
  return ['gen_' + type, kind, genSlug_(tripKey)].concat(stamp ? [stamp] : []).join('__');
}

function genTripLabel_(tripKey) {
  var i = String(tripKey).indexOf('|');
  return i >= 0 ? String(tripKey).slice(i + 1) : String(tripKey);
}

function genDaysUntil_(tripKey) {
  var start = String(tripKey).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  var t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(start + 'T00:00:00') - t) / 86400000);
}

/**
 * The flags one generation wants: at most one, listing its weak and missing factors.
 * Medium when the trip is within two weeks (time to act is short), Low otherwise.
 */
function genInputsFlagsFor_(record, daysUntil) {
  var problems = genProblems_(record.factors);
  if (!problems.length) return [];
  return [{
    source:  'Travel',
    flag:    GEN_KINDS_[record.kind] + ' for ' + genTripLabel_(record.tripKey) + ' may be off: ' + genProblemSummary_(problems) + '.',
    reason:  'Open the trip to see what it was built from. Fix what’s missing, then regenerate.',
    urgency: (daysUntil !== null && daysUntil <= GEN_FORECAST_DAYS_) ? 'Medium' : 'Low',
    key:     genFlagKey_('inputs', record.kind, record.tripKey, record.stamp),
  }];
}

function settleGenerationFlags_(record) {
  var flagSheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!flagSheet) return;
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var want = genInputsFlagsFor_(record, genDaysUntil_(record.tripKey));
  var keep = want.length ? want[0].key : '';
  // Earlier generations of THIS trip and kind are superseded: their flags close.
  resolveFlagsWithPrefix_(flagSheet, genFlagKey_('inputs',   record.kind, record.tripKey) + '__', keep);
  resolveFlagsWithPrefix_(flagSheet, genFlagKey_('forecast', record.kind, record.tripKey) + '__', '');
  resolveFlagsWithPrefix_(flagSheet, genFlagKey_('unknown',  record.kind, record.tripKey), '', true);
  if (want.length) appendExactKeyFlags_(flagSheet, want, dateStr);
}

// ============================================================
// NIGHTLY
// ============================================================

/**
 * Every (kind, tripKey) with an AI-generated list for a trip starting within the next
 * 60 days. Trip keys begin with the start date, so no trip lookup is needed.
 */
function genUpcomingLists_() {
  var ss = getSpreadsheet(), out = [], seen = {};
  function collect(tab, keyCol, sourceCol, kind) {
    var sh = ss.getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(keyCol, sourceCol)).getValues().forEach(function(r) {
      var key = String(r[keyCol - 1]).trim();
      if (!key || String(r[sourceCol - 1]).trim() !== 'ai' || seen[kind + '|' + key]) return;
      var d = genDaysUntil_(key);
      if (d === null || d < 0 || d > GEN_UPCOMING_DAYS_) return;
      seen[kind + '|' + key] = true;
      out.push({ kind: kind, tripKey: key, daysUntil: d });
    });
  }
  collect(TABS.PACKING_ITEMS, 2, 7, 'packing');
  collect(TABS.TRIP_RECOMMENDATIONS, 2, 11, 'discover');
  return out;
}

/**
 * What the nightly pass wants for one list:
 *   no record                      → "built before VERA recorded its inputs", once
 *   last year's weather, ≤14 days  → "a forecast is now available", once per generation
 */
function genNightlyFlagsFor_(item, record) {
  var label = GEN_KINDS_[item.kind] + ' for ' + genTripLabel_(item.tripKey);
  if (!record) {
    return [{
      source: 'Travel', urgency: 'Low',
      flag:   label + ' was built before VERA recorded what it used.',
      reason: 'Regenerate it to see what it was built from. Your checked items are kept.',
      key:    genFlagKey_('unknown', item.kind, item.tripKey),
    }];
  }
  if (record.weatherMode === 'last_year' && item.daysUntil <= GEN_FORECAST_DAYS_) {
    return [{
      source: 'Travel', urgency: 'Medium',
      flag:   'A weather forecast is now available for ' + genTripLabel_(item.tripKey) + '. Regenerate the ' + GEN_KINDS_[item.kind].toLowerCase() + ' to use it.',
      reason: 'It was built on last year’s weather for these dates. Your checked items are kept.',
      key:    genFlagKey_('forecast', item.kind, item.tripKey, record.stamp),
    }];
  }
  return [];
}

/** Nightly step. */
function checkGenerationInputs_() {
  var flagSheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!flagSheet) return;
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var want = [];
  genUpcomingLists_().forEach(function(item) {
    want = want.concat(genNightlyFlagsFor_(item, readGenerationInputs_(item.tripKey, item.kind)));
  });
  var n = want.length ? appendExactKeyFlags_(flagSheet, want, dateStr) : 0;
  Logger.log('checkGenerationInputs_: ' + n + ' new flag(s).');
}

// ============================================================
// DATES — never generate blind for want of an end date
// ============================================================

/**
 * The trip's dates, filling in what the caller didn't send.
 *
 * dashboard-lite has never sent an end date when generating a packing list, so every
 * list it made was built with an unknown length and no weather. Lite is fixed to send
 * it; this is the belt to that braces — the start date is the first ten characters of
 * every trip key, and the end date is on the trip's registry row.
 */
function genTripDates_(tripKey, startDate, endDate) {
  var s = startDate;
  if (!s && /^\d{4}-\d{2}-\d{2}/.test(String(tripKey))) s = String(tripKey).slice(0, 10);
  var e = endDate;
  if (!e) {
    try {
      var id  = tripIdForKey_(tripKey);
      var rec = id ? getTripById_(id) : null;
      if (rec && rec.endDate) e = rec.endDate;
    } catch (err) {
      Logger.log('genTripDates_: couldn’t look the trip up — ' + err.message);
    }
  }
  return { startDate: s || '', endDate: e || '' };
}

// ============================================================
// A TRIP'S PLACES — the base, and every cruise stop
// ============================================================

/** Great-circle distance in km between two {lat, lon}. */
function genKm_(a, b) {
  var R = 6371, rad = Math.PI / 180;
  var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "Miami Beach, Florida" / "Puerto Plata, Dominican Republic" from a geocode result. */
function genPlaceLabel_(g) {
  if (!g) return '';
  var tail = g.countryCode === 'US' ? g.admin1 : g.country;
  return g.name + (tail && tail !== g.name ? ', ' + tail : '');
}

/**
 * Which itinerary rows could be cruise port days — pure, so a fixture can hold it to
 * the real November trip.
 *
 * Only when the trip has a cruise. Then: rows dated inside the cruise stay (its date to
 * its checkoutDate, else the trip's end) that carry a location, except flights (whose
 * location is the DEPARTURE airport — "Washington IAD") and the cruise row itself.
 * An event that merely spans the trip ("Eraky Family in Germany", from Oct 22) starts
 * outside the window and never qualifies. Activities with a location ("Swim With The
 * Pigs") do qualify here; tripPlaces_ drops whatever doesn't resolve on the map.
 */
function cruisePortRows_(itinData, tripKey, endDate) {
  // The same alias set inferTripDestination_ matches on, so a renamed trip's rows count.
  var keys = typeof tripKeysFor_ === 'function' ? tripKeysFor_(tripKey) : [tripKey];
  var rows = (itinData || []).filter(function(r) { return keys.indexOf(String(r[1]).trim()) !== -1; });
  var windows = [];
  rows.forEach(function(r) {
    if (String(r[2]).trim() !== 'cruise' || !r[4]) return;
    var until = '';
    try { until = (JSON.parse(String(r[9] || '{}')) || {}).checkoutDate || ''; } catch (e) {}
    windows.push({ from: String(r[4]).slice(0, 10), to: String(until || endDate || r[4]).slice(0, 10) });
  });
  if (!windows.length) return [];
  var out = [];
  rows.forEach(function(r) {
    var type = String(r[2]).trim(), loc = String(r[7] || '').trim(), date = String(r[4] || '').slice(0, 10);
    if (!loc || !date || type === 'flight' || type === 'cruise') return;
    if (typeof isVirtualMeetingLocation_ === 'function' && isVirtualMeetingLocation_(loc)) return;
    var inside = windows.some(function(w) { return date >= w.from && date <= w.to; });
    if (inside) out.push({ location: loc, title: String(r[3] || '').trim(), date: date });
  });
  return out;
}

/**
 * The trip's base, resolved on the map, plus each cruise stop that resolves.
 *
 * base   inferTripDestination_ as before (flight destination, then where you're
 *        staying, then the itinerary's places, then the trip's name) — now geocoded,
 *        and labelled by what it resolved to rather than by a raw street address.
 * ports  cruisePortRows_, each geocoded with its own event's words as a hint (so
 *        "St Thomas, US Virgin Islands" picks the Virgin Islands over Ontario), minus
 *        anything within 50 km of the base (the home port) and duplicates.
 */
function tripPlaces_(itinData, tripKey, tripLabel, endDate) {
  var dest = inferTripDestination_(itinData, tripKey, tripLabel);
  var base = { value: dest.value, source: dest.source, label: dest.value, geo: null };
  if (dest.value) {
    base.geo = geocodePackingDestination_(dest.value);
    if (base.geo) base.label = genPlaceLabel_(base.geo);
  }
  var ports = [], seen = {};
  cruisePortRows_(itinData, tripKey, endDate).forEach(function(c) {
    var g = geocodePackingDestination_(c.location, c.title + ' ' + c.location);
    if (!g) return;
    if (base.geo && genKm_(base.geo, g) < GEN_PORT_RADIUS_KM_) return;
    var label = genPlaceLabel_(g);
    if (seen[label]) return;
    seen[label] = true;
    ports.push({ label: label, date: c.date, geo: g, from: c.location });
  });
  return { base: base, ports: ports };
}

/** What the prompts see: the base, then the stops. Never a street address. */
function genPlacesText_(places) {
  var b = places.base.label || places.base.value || '';
  var stops = places.ports.map(function(p) { return p.label; });
  return b + (stops.length ? (b ? '; ' : '') + 'cruise stops: ' + stops.join(', ') : '');
}

/**
 * Several weather lookups as one, pure.
 *
 *   summary  "Miami Beach, Florida: Expected …; Puerto Plata, …: Expected …"
 *            (just the base's text when there are no stops — unchanged)
 *   mode     the WEAKEST part that has weather: any last-year part makes the whole
 *            last_year, so the nightly "a forecast is now available" still fires
 *   reason   the base's reason when nothing at all came back
 *   lat      the base's latitude (the hemisphere is where you're based), else a stop's
 */
function genCombineWeather_(parts) {
  var got = parts.filter(function(p) { return p.w && p.w.summary; });
  var anyLast = got.some(function(p) { return p.w.mode === 'last_year'; });
  var strip = function(t) { return String(t).replace(/^\([^)]*\)\s*/, ''); };
  var summary = '';
  if (got.length === 1 && parts.length === 1) summary = got[0].w.summary;
  else if (got.length) {
    summary = (anyLast ? '(Last year\u2019s weather on these dates) ' : '') +
      got.map(function(p) { return p.where + ': ' + strip(p.w.summary); }).join('; ');
    var missed = parts.filter(function(p) { return !(p.w && p.w.summary); }).map(function(p) { return p.where; });
    if (missed.length) summary += ' (no weather found for ' + missed.join(', ') + ')';
  }
  var latSrc = parts.filter(function(p) { return p.w && p.w.lat !== null && p.w.lat !== undefined; })[0];
  return {
    summary: summary,
    mode:    got.length ? (anyLast ? 'last_year' : 'forecast') : '',
    reason:  got.length ? '' : ((parts[0] && parts[0].w && parts[0].w.reason) || 'no weather found'),
    lat:     latSrc ? latSrc.w.lat : null,
  };
}

/** The base for the whole trip; each stop for its own day. */
function genTripWeather_(places, startDate, endDate) {
  var parts = [{ where: places.base.label || places.base.value,
                 w: getPackingWeatherDetail_(places.base.value, startDate, endDate, places.base.geo) }];
  places.ports.forEach(function(p) {
    parts.push({ where: p.label, w: getPackingWeatherDetail_(p.label, p.date, p.date, p.geo) });
  });
  return genCombineWeather_(parts);
}
