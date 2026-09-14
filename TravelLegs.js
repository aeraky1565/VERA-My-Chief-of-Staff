/**
 * TravelLegs.js — cached point-to-point travel times between itinerary stops.
 *
 * Why a cache rather than live lookups:
 *
 * Distance Matrix is a billed API, and the honest observation is that the answer
 * almost never changes — "Kimpton Surfcomber → 512 Española Way" is the same
 * number today and in five years. So every result is cached permanently, keyed
 * on the LOCATION PAIR rather than on itinerary item IDs, which means an entry
 * survives item edits, renames and deletions, and is reused across every trip
 * that touches the same two places.
 *
 * Usage is held down by four rules, in descending order of how much they save:
 *
 *   1. A cached pair is never re-fetched. Across all trips there are only a few
 *      dozen distinct pairs, so in steady state nothing here calls out at all —
 *      opening a trip whose pairs are known makes zero requests, however many
 *      times the dashboard is refreshed.
 *   2. Failures are cached too. "No driving route between Tortola and Great
 *      Stirrup Cay" is a permanent fact; without caching it, every cruise day
 *      would re-ask forever.
 *   3. Walking is only fetched when driving came back short enough that walking
 *      is plausibly a real choice.
 *   4. Hard ceilings — a large one per nightly run, a small one per dashboard
 *      read — so a bug that loops cannot run up a bill.
 *
 * Two things fill the cache. nightlyRun() warms every upcoming trip, and
 * webGetTravelLegs_ fills in any pair it has never seen while serving a read.
 * The second exists because plans arrive on the shared calendar at least as
 * often as through this dashboard, so hooking the itinerary write actions would
 * miss most of them; catching it at read time catches every source equally.
 *
 * Calls go through fetchTracked_ as the 'googlemaps' source, so failures surface
 * in the API Health panel and the [DOWN] alerts like any other integration.
 */

// Upper bound on the gap worth looking up, in minutes.
//
// Set generously at 8 hours, and deliberately so. An earlier, tighter 3-hour
// ceiling looked like a good saving until it was run against a real itinerary:
// it excluded the airport-to-hotel leg (207 min) and the lunch-to-dinner leg
// (360 min) — which are precisely the gaps the free-time chips are drawn from
// and therefore precisely the ones that need travel subtracted. Tight gaps
// matter for conflict detection; wide gaps matter for free time. Both are
// wanted, so the filter only exists to exclude the genuinely absurd.
//
// This costs almost nothing, because the real saving was never this filter —
// it is the permanent per-pair cache below. Across every trip there are only
// a few dozen distinct location pairs, and each is fetched exactly once, ever.
var TRAVEL_LEG_MAX_GAP_MINS = 480;

// Ceiling per nightly run. Reaching it is not an error — the remainder is simply
// picked up tomorrow, and in practice this is only ever approached on the very
// first run against a brand new itinerary.
var TRAVEL_LEG_MAX_CALLS_PER_RUN = 25;

// Walking is only requested when driving came back at or under this, i.e. when
// walking is plausibly a real choice. Asking how long it takes to walk a
// 40-minute drive bills for a number nobody will act on.
var TRAVEL_LEG_WALK_THRESHOLD_MINS = 12;

// Ceiling for the gap-filling done while serving a dashboard read. Small on
// purpose: it keeps that request fast, and anything left over is picked up by
// the nightly run anyway. Opening a trip whose pairs are all cached — the
// normal case — makes no calls at all.
var TRAVEL_LEG_MAX_LAZY_CALLS = 3;

var DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';

/**
 * The key used server-side. NOT the browser's vera_maps_key, which is a
 * referrer-restricted Maps JS key and cannot be used from Apps Script.
 */
function getTravelLegsApiKey_() {
  return PropertiesService.getScriptProperties()
           .getProperty('GOOGLE_STATIC_MAPS_API_KEY') || '';
}

/**
 * A location is usable only if it could plausibly be resolved by Google. Bare
 * place names are fine ("Puerto Plata"); virtual meeting locations and empty
 * strings are not.
 */
function isUsableTravelLocation_(loc) {
  var s = String(loc || '').trim();
  if (s.length < 3) return false;
  if (typeof isVirtualMeetingLocation_ === 'function' && isVirtualMeetingLocation_(s)) return false;
  return true;
}

/** Collapses whitespace/newlines so the same address always yields the same key. */
function normalizeTravelLocation_(loc) {
  return String(loc || '').replace(/\s+/g, ' ').trim();
}

function travelLegKey_(from, to, mode) {
  return normalizeTravelLocation_(from).toLowerCase() + '|' +
         normalizeTravelLocation_(to).toLowerCase()   + '|' + mode;
}

/**
 * Reads the whole cache into a map keyed by travelLegKey_.
 * @returns {Object} key → { minutes, distance, status }
 */
// Per-execution memo, same pattern as _upcomingTravelCache_ in PTO.js. Serving
// one lazy-filling read resolves the sheet three times — the caller's cache
// load, computeTravelLegs_'s own, and the re-read afterwards — plus once more to
// append. ensureSheet does a getSheetByName and a getLastRow every time, and
// none of that changes within a single execution.
var _travelLegsSheet_ = null;

function getTravelLegsSheet_() {
  // Created on demand rather than assumed. setupVERA() is the only other place
  // that makes this tab, and it is not re-run when a feature ships — so without
  // this the cache silently wrote nothing, every dashboard load re-queried the
  // same pairs, and the whole point of caching was lost.
  if (!_travelLegsSheet_) {
    _travelLegsSheet_ = ensureSheet(getSpreadsheet(), TABS.TRAVEL_LEGS, TRAVEL_LEGS_HEADERS);
  }
  return _travelLegsSheet_;
}

function loadTravelLegCache_() {
  var sheet = getTravelLegsSheet_();
  var cache = {};
  if (!sheet || sheet.getLastRow() < 2) return cache;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, TRAVEL_LEGS_HEADERS.length).getValues();
  rows.forEach(function(r) {
    var from = String(r[0]).trim();
    var to   = String(r[1]).trim();
    var mode = String(r[2]).trim();
    if (!from || !to || !mode) return;
    cache[travelLegKey_(from, to, mode)] = {
      minutes:  r[3] === '' || r[3] === null ? null : Number(r[3]),
      distance: String(r[4] || ''),
      status:   String(r[5] || ''),
    };
  });
  return cache;
}

/**
 * One Distance Matrix element: exactly one origin, one destination, one mode.
 *
 * Deliberately not a batched N×N matrix — Distance Matrix bills per element, and
 * a matrix of N origins by N destinations would bill for N² cells when only the
 * N diagonal ones are wanted.
 *
 * @returns {{ minutes:(number|null), distance:string, status:string }}
 */
function fetchTravelLeg_(from, to, mode, apiKey) {
  var url = DISTANCE_MATRIX_URL +
            '?origins='      + encodeURIComponent(normalizeTravelLocation_(from)) +
            '&destinations=' + encodeURIComponent(normalizeTravelLocation_(to)) +
            '&mode='         + encodeURIComponent(mode) +
            '&units=imperial' +
            '&key='          + encodeURIComponent(apiKey);

  var resp = fetchTracked_('googlemaps', url, { muteHttpExceptions: true });
  var body;
  try {
    body = JSON.parse(resp.getContentText());
  } catch (e) {
    return { minutes: null, distance: '', status: 'parse_error' };
  }

  // Top-level failures are about the key or the project, not this pair — they
  // must NOT be cached, or fixing the key later would leave poisoned rows behind.
  if (body.status !== 'OK') {
    return { minutes: null, distance: '', status: 'API_' + (body.status || 'UNKNOWN'),
             fatal: true, errorMessage: body.error_message || '' };
  }

  var el = body.rows && body.rows[0] && body.rows[0].elements && body.rows[0].elements[0];
  if (!el) return { minutes: null, distance: '', status: 'no_element' };
  if (el.status !== 'OK') {
    // ZERO_RESULTS / NOT_FOUND are permanent facts about this pair — cache them.
    return { minutes: null, distance: '', status: el.status };
  }
  return {
    minutes:  Math.round((el.duration && el.duration.value ? el.duration.value : 0) / 60),
    distance: (el.distance && el.distance.text) || '',
    status:   'OK',
  };
}

function appendTravelLegRows_(rows) {
  if (!rows.length) return;
  var sheet = getTravelLegsSheet_();
  if (!sheet) throw new Error('TravelLegs tab could not be created');
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, TRAVEL_LEGS_HEADERS.length)
       .setValues(rows);
}

/**
 * Turns a multi-day stay into the two moments you actually travel to and from:
 * a check-in on its first day and a check-out on its last.
 *
 * Hotel and cruise stays reach us as all-day calendar events, so they carry no
 * startTime and were being skipped entirely — which meant the single most
 * useful leg on any trip, airport to hotel, could never be computed. The
 * frontend already solves this when it renders; this is the same rule applied
 * server-side. Nothing is written back to the itinerary: these rows exist only
 * for the duration of this calculation.
 *
 * Defaults mirror docs/app.js ("Resolve default hotel check-in / check-out
 * times"): check in at 15:00, later if a flight lands after that; check out at
 * 10:00, earlier if a flight or train leaves before it.
 *
 * @param {Array} items — itinerary items (webGetItinerary_ shape)
 * @returns {Array} the same items plus synthesised check-in/check-out rows
 */
function expandStayTimes_(items) {
  var STAY_TYPES = { hotel: 1, cruise: 1, arranged_stay: 1 };
  var all = (items || []).slice();

  // Latest flight arrival and earliest departure per day, to adjust against.
  var latestArrival = {}, earliestDeparture = {};
  all.forEach(function(it) {
    if (!it.date) return;
    if (it.type === 'flight' && it.endTime) {
      if (!latestArrival[it.date] || it.endTime > latestArrival[it.date]) latestArrival[it.date] = it.endTime;
    }
    if ((it.type === 'flight' || it.type === 'train') && it.startTime) {
      if (!earliestDeparture[it.date] || it.startTime < earliestDeparture[it.date]) earliestDeparture[it.date] = it.startTime;
    }
  });

  var extra = [];
  all.forEach(function(it) {
    if (!STAY_TYPES[it.type] || it.startTime) return;   // not a stay, or already timed
    if (!isUsableTravelLocation_(it.location)) return;

    var meta = {};
    try { meta = JSON.parse(it.metadata || '{}') || {}; } catch (e) { meta = {}; }
    var checkoutDate = String(meta.checkoutDate || '').trim();
    if (!checkoutDate || !it.date) return;   // single-day or unbounded: nothing to anchor

    var ci = '15:00';
    if (latestArrival[it.date] && latestArrival[it.date] > ci) ci = latestArrival[it.date];
    extra.push({ date: it.date, startTime: ci, endTime: '', location: it.location,
                 type: it.type, title: it.title, _stay: 'checkin' });

    var co = '10:00';
    if (earliestDeparture[checkoutDate] && earliestDeparture[checkoutDate] < co) co = earliestDeparture[checkoutDate];
    extra.push({ date: checkoutDate, startTime: co, endTime: co, location: it.location,
                 type: it.type, title: it.title, _stay: 'checkout' });
  });

  return all.concat(extra);
}

/**
 * Every consecutive pair of timed items, within a day, that is worth a lookup.
 * @param {Array} items — itinerary items (webGetItinerary_ shape)
 * @returns {Array} [{ from, to, gapMins }]
 */
function collectTravelLegCandidates_(items) {
  var expanded = expandStayTimes_(items);

  var byDay = {};
  expanded.forEach(function(it) {
    if (!it.date || !it.startTime) return;   // undated or all-day: no gap to reason about
    if (!byDay[it.date]) byDay[it.date] = [];
    byDay[it.date].push(it);
  });

  var out = [];
  Object.keys(byDay).forEach(function(d) {
    var day = byDay[d].sort(function(a, b) {
      return a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0;
    });
    for (var i = 0; i < day.length - 1; i++) {
      var cur = day[i], next = day[i + 1];
      if (!isUsableTravelLocation_(cur.location) || !isUsableTravelLocation_(next.location)) continue;
      var from = normalizeTravelLocation_(cur.location);
      var to   = normalizeTravelLocation_(next.location);
      if (from.toLowerCase() === to.toLowerCase()) continue;   // same place: no travel

      var gap = travelTimeToMins_(next.startTime) - travelTimeToMins_(cur.endTime || cur.startTime);
      if (gap < 0 || gap > TRAVEL_LEG_MAX_GAP_MINS) continue;

      out.push({ from: from, to: to, gapMins: gap });
    }
  });
  return out;
}

function travelTimeToMins_(t) {
  var m = String(t || '').match(/(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
}

/**
 * Fills the cache for every upcoming trip. Called from nightlyRun().
 *
 * @param {number} [maxCalls] — override the per-run ceiling (used by the
 *   write-path top-up, which wants a much smaller budget)
 * @param {Array} [onlyItems] — restrict to these items instead of loading every trip
 * @returns {{ calls:number, cached:number, skipped:number, error:string }}
 */
function computeTravelLegs_(maxCalls, onlyItems) {
  var budget = maxCalls || TRAVEL_LEG_MAX_CALLS_PER_RUN;
  var apiKey = getTravelLegsApiKey_();
  if (!apiKey) {
    Logger.log('TravelLegs: no GOOGLE_STATIC_MAPS_API_KEY — skipping (feature stays dark).');
    return { calls: 0, cached: 0, skipped: 0, error: 'no_api_key' };
  }

  var candidates = [];
  if (onlyItems) {
    candidates = collectTravelLegCandidates_(onlyItems);
  } else {
    getUpcomingTripsForLegs_().forEach(function(trip) {
      try {
        var itin = webGetItinerary_(
          { parameter: { tripKey: trip.tripKey, startDate: trip.startDate, endDate: trip.endDate } },
          { skipEventTz: true }
        ) || {};
        candidates = candidates.concat(collectTravelLegCandidates_(itin.items || []));
      } catch (e) {
        Logger.log('TravelLegs: itinerary load failed for ' + trip.tripKey + ' — ' + e.message);
      }
    });
  }

  var cache   = loadTravelLegCache_();
  var newRows = [];
  var calls   = 0;
  var skipped = 0;
  var seen    = {};
  var tz      = Session.getScriptTimeZone();
  var stamp   = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  var fatal   = '';

  for (var i = 0; i < candidates.length; i++) {
    if (calls >= budget) { skipped = candidates.length - i; break; }
    var c = candidates[i];

    var driveKey = travelLegKey_(c.from, c.to, 'driving');
    if (seen[driveKey] || cache[driveKey]) continue;   // already cached, or queued this run
    seen[driveKey] = true;

    var drive = fetchTravelLeg_(c.from, c.to, 'driving', apiKey);
    calls++;
    if (drive.fatal) {
      // Key/project level problem — stop immediately rather than burning the
      // budget on calls that will all fail the same way, and cache nothing.
      fatal = drive.status + (drive.errorMessage ? ': ' + drive.errorMessage : '');
      Logger.log('TravelLegs: aborting — ' + fatal);
      break;
    }
    newRows.push([c.from, c.to, 'driving', drive.minutes === null ? '' : drive.minutes,
                  drive.distance, drive.status, stamp]);

    // Walking is only worth an element when driving was short. Asking how long
    // it takes to walk a 40-minute drive produces a number nobody will act on.
    if (drive.status === 'OK' && drive.minutes !== null &&
        drive.minutes <= TRAVEL_LEG_WALK_THRESHOLD_MINS && calls < budget) {
      var walkKey = travelLegKey_(c.from, c.to, 'walking');
      if (!seen[walkKey] && !cache[walkKey]) {
        seen[walkKey] = true;
        var walk = fetchTravelLeg_(c.from, c.to, 'walking', apiKey);
        calls++;
        if (!walk.fatal) {
          newRows.push([c.from, c.to, 'walking', walk.minutes === null ? '' : walk.minutes,
                        walk.distance, walk.status, stamp]);
        }
      }
    }
  }

  appendTravelLegRows_(newRows);
  Logger.log('TravelLegs: ' + calls + ' API call(s), ' + newRows.length + ' row(s) cached, ' +
             skipped + ' deferred to next run.' + (fatal ? ' ABORTED: ' + fatal : ''));
  return { calls: calls, cached: newRows.length, skipped: skipped, error: fatal };
}

/**
 * Trips worth spending calls on: currently running or starting within 120 days.
 * A trip two years out will be re-planned before it matters.
 */
function getUpcomingTripsForLegs_() {
  var out = [];
  try {
    // getUpcomingTravel_ is memoized per execution, so reusing it here adds no
    // calendar scanning to the nightly run — nightlyRun's other steps have
    // already paid for it.
    var trips = getUpcomingTravel_(readPTOConfig_()) || [];
    trips.forEach(function(t) {
      if (!t.startDate || !t.endDate) return;
      if (t.daysAway > 120) return;   // too far out; it will be re-planned before it matters
      // Same tripKey the dashboard builds: startDate + '|' + label.
      out.push({ tripKey: t.startDate + '|' + t.label, startDate: t.startDate, endDate: t.endDate });
    });
  } catch (e) {
    Logger.log('TravelLegs: trip list failed — ' + e.message);
  }
  return out;
}

/**
 * GET travel_legs — params: tripKey, startDate, endDate
 * Returns cached legs for the trip. Never calls the API: the dashboard reading
 * this must cost nothing, no matter how often it is refreshed.
 */
function webGetTravelLegs_(e) {
  var p       = (e && e.parameter) ? e.parameter : {};
  var tripKey = (p.tripKey || '').trim();
  if (!tripKey) throw new Error('tripKey is required');

  var cache = loadTravelLegCache_();
  var legs  = [];
  try {
    var itin       = webGetItinerary_(e, { skipEventTz: true }) || {};
    var candidates = collectTravelLegCandidates_(itin.items || []);

    // Fill in pairs never seen before, right now, rather than making them wait
    // for tonight's run. This is the only place that can catch every source:
    // plans are added straight to the shared calendar at least as often as
    // through this dashboard, so hooking the itinerary write actions would miss
    // most of them.
    //
    // Absence, not failure. A cached ZERO_RESULTS row — two Caribbean islands
    // with no road between them — is a permanent answer. Re-querying anything
    // whose status isn't 'OK' would ask about every cruise day on every single
    // load, which is exactly the cost model this cache exists to prevent.
    var missing = candidates.filter(function(c) {
      return !cache[travelLegKey_(c.from, c.to, 'driving')];
    });
    if (missing.length) {
      // Computed from the cache already in hand, so when everything is cached
      // — the overwhelmingly common case — this block costs nothing at all.
      try {
        var filled = computeTravelLegs_(TRAVEL_LEG_MAX_LAZY_CALLS, itin.items);
        if (filled && filled.cached > 0) cache = loadTravelLegCache_();
      } catch (fillErr) {
        Logger.log('webGetTravelLegs_: lazy fill failed — ' + fillErr.message);
      }
    }

    candidates.forEach(function(c) {
      var drive = cache[travelLegKey_(c.from, c.to, 'driving')];
      var walk  = cache[travelLegKey_(c.from, c.to, 'walking')];
      if (!drive || drive.status !== 'OK') return;   // unknown or no route — say nothing
      legs.push({
        from:        c.from,
        to:          c.to,
        gapMins:     c.gapMins,
        driveMins:   drive.minutes,
        driveText:   drive.distance,
        walkMins:    (walk && walk.status === 'OK') ? walk.minutes : null,
      });
    });
  } catch (err) {
    Logger.log('webGetTravelLegs_: ' + err.message);
  }
  return { ok: true, tripKey: tripKey, legs: legs };
}

/**
 * One-shot diagnostic. Run from the Apps Script editor and read the log — it
 * says plainly whether the existing key can do Distance Matrix, and if not,
 * exactly what to change. Makes exactly ONE API call.
 */
function testTravelLegsApi_() {
  var apiKey = getTravelLegsApiKey_();
  if (!apiKey) {
    Logger.log('FAIL — no GOOGLE_STATIC_MAPS_API_KEY script property set.');
    return;
  }
  var r = fetchTravelLeg_('1717 Collins Ave, Miami Beach, FL',
                          '512 Espanola Way, Miami Beach, FL', 'driving', apiKey);
  if (r.status === 'OK') {
    Logger.log('PASS — Distance Matrix is enabled and the key works. ' +
               'Sample: ' + r.minutes + ' min, ' + r.distance);
    return;
  }
  if (r.status === 'API_REQUEST_DENIED') {
    Logger.log('FAIL — REQUEST_DENIED. Either the Distance Matrix API is not enabled on ' +
               'this Cloud project, or the key is restricted so it excludes it. ' +
               'Fix: Cloud Console → APIs & Services → enable "Distance Matrix API", ' +
               'then check the key\'s API restrictions. ' +
               'Google said: ' + (r.errorMessage || '(no detail)'));
    return;
  }
  if (r.status === 'API_OVER_QUERY_LIMIT') {
    Logger.log('FAIL — OVER_QUERY_LIMIT. Billing may not be enabled on the project. ' +
               'Google said: ' + (r.errorMessage || '(no detail)'));
    return;
  }
  Logger.log('FAIL — status ' + r.status + '. ' + (r.errorMessage || ''));
}

/**
 * diagnoseTravelLegs_()
 *
 * Run from the Apps Script editor and read the execution log. Makes no Distance
 * Matrix calls and writes nothing — it walks the same path computeTravelLegs_
 * takes and reports what each stage produced, so the first stage reporting zero
 * is the fault.
 *
 * This exists because the pipeline went from itinerary to API call through six
 * stages, any one of which can legitimately yield nothing, and reasoning about
 * which one from the outside produced two confidently wrong answers in a row.
 * The item dump at stage 3 prints the real shapes verbatim rather than what a
 * test fixture assumed they were — that assumption was the actual bug both times.
 */
function diagnoseTravelLegs_() {
  Logger.log('════ TravelLegs diagnosis ════');

  var key = getTravelLegsApiKey_();
  Logger.log('1. API key: ' + (key ? 'present (' + key.length + ' chars)' : '*** MISSING ***'));

  var trips = getUpcomingTripsForLegs_();
  Logger.log('2. Trips in scope: ' + trips.length);
  trips.forEach(function(t) {
    Logger.log('     ' + t.startDate + ' .. ' + t.endDate + '   ' + t.tripKey);
  });
  if (!trips.length) {
    // Distinguish "found nothing" from "found things and filtered them all out".
    try {
      var raw = getUpcomingTravel_(readPTOConfig_()) || [];
      Logger.log('   getUpcomingTravel_ returned ' + raw.length + ' before the 120-day filter:');
      raw.forEach(function(t) {
        Logger.log('     ' + t.startDate + ' | ' + t.label + '   (daysAway ' + t.daysAway +
                   ', cal "' + t.calendarName + '")');
      });
    } catch (e) {
      Logger.log('   getUpcomingTravel_ threw: ' + e.message);
    }
  }

  trips.forEach(function(t) {
    Logger.log('');
    Logger.log('── ' + t.tripKey);
    var items = [];
    try {
      var itin = webGetItinerary_(
        { parameter: { tripKey: t.tripKey, startDate: t.startDate, endDate: t.endDate } },
        { skipEventTz: true }
      ) || {};
      items = itin.items || [];
    } catch (e) {
      Logger.log('3. webGetItinerary_ THREW: ' + e.message);
      return;
    }
    Logger.log('3. Items: ' + items.length);
    items.forEach(function(it) {
      var hasCheckout = String(it.metadata || '').indexOf('checkoutDate') !== -1;
      Logger.log('     [' + (it.type || '?') + '] ' + (it.date || 'no-date') + ' ' +
                 (it.startTime || '--:--') + (it.endTime ? '-' + it.endTime : '') +
                 '  loc=' + (it.location ? '"' + String(it.location).split('\n')[0] + '"' : 'NONE') +
                 (hasCheckout ? '  +checkoutDate' : '') +
                 '   ' + String(it.title || '').substring(0, 40));
    });

    var expanded = expandStayTimes_(items);
    Logger.log('4. After stay expansion: ' + expanded.length + ' (+' + (expanded.length - items.length) + ')');
    expanded.forEach(function(it) {
      if (!it._stay) return;
      Logger.log('     ' + it._stay + ' ' + it.date + ' ' + it.startTime + '  ' +
                 String(it.location || '').split('\n')[0]);
    });

    var cands = collectTravelLegCandidates_(items);
    Logger.log('5. Candidate pairs: ' + cands.length);
    cands.forEach(function(c) {
      Logger.log('     ' + c.gapMins + 'm  ' + String(c.from).split('\n')[0] +
                 '  ->  ' + String(c.to).split('\n')[0]);
    });
  });

  var cache = loadTravelLegCache_();
  Logger.log('');
  Logger.log('6. Legs already cached: ' + Object.keys(cache).length +
             '  (a cached pair is skipped, which is another way to reach 0 calls)');
  Logger.log('════ end ════');
}
