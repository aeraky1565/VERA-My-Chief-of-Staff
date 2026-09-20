// ============================================================
// VERA — Trip Decisions (Issue #187, phase 1)
// TripDecisions.js — recognising tentative holds and grouping
//                    the ones that compete for the same slot
// ============================================================
//
// Plans firm up late. A week out you hold two or three options for a slot and
// decide on the day. Until now VERA could not tell a hold from a booking, so
// three competing holds read as a packed afternoon that does not exist —
// corrupting gap detection, itinerary notices and travel-time pairing alike.
//
// The model: competing holds are not N tentative items, they are ONE decision
// with N options. What makes two holds alternatives is that they compete for
// the same TIME, not that they are the same kind of thing — "museum or beach
// or shopping" is one afternoon's decision across three types.
//
// Phase 1 recognises and groups them. Confirming a choice, decide-by dates and
// recommendations come later; nothing here writes anything down.

/** Tentative markers. Whole-word so "maybenot" and "optional" do not trip. */
var TENTATIVE_PATTERNS_ = [
  /\btentative(ly)?\b/i,
  /\btbd\b/i,
  /\bmaybe\b/i,
  /\boptions?\b/i,
  /\bplan\s*[abc]\b/i,
  /\balt\b/i,
  /\[\s*\?\s*\]/,
  /\(\s*\?\s*\)/,
];

/** An explicit "Plan B" / "Option 2" marker — the strongest grouping signal. */
var OPTION_MARKER_RE_ = /\b(?:plan\s*[a-d]|option\s*\d+)\b/i;

/**
 * Does this item's own text say it is a hold?
 * Used for both sheet rows and calendar events, so the vocabulary is identical
 * whichever way an item got here.
 */
function isTentativeText_(title, notes) {
  var hay = String(title || '') + ' ' + String(notes || '');
  for (var i = 0; i < TENTATIVE_PATTERNS_.length; i++) {
    if (TENTATIVE_PATTERNS_[i].test(hay)) return true;
  }
  return false;
}

function hasExplicitOptionMarker_(title, notes) {
  return OPTION_MARKER_RE_.test(String(title || '') + ' ' + String(notes || ''));
}

/** morning <11:00 · midday 11:00–15:59 · evening ≥16:00 */
function timeBucketOf_(startTime) {
  var mins = tdTimeToMins_(startTime);
  if (mins === null) return '';
  if (mins < 11 * 60) return 'morning';
  if (mins < 16 * 60) return 'midday';
  return 'evening';
}

/** "HH:MM" → minutes, or null when there is no usable time. */
function tdTimeToMins_(t) {
  var m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Parses an item's metadata JSON without throwing on a malformed cell. */
function tdReadMeta_(item) {
  if (!item) return {};
  var raw = item.metadata;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    var parsed = JSON.parse(String(raw));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

function tdWriteMeta_(item, meta) {
  item.metadata = JSON.stringify(meta);
}

/**
 * True when two same-day holds are alternatives for one slot.
 *
 * Any one of three signals is enough, strongest first:
 *   1. both carry an explicit Plan/Option marker — a deliberate act, so it
 *      overrides everything and groups holds held hours apart
 *   2. their time ranges genuinely overlap — two things over the same hour
 *      cannot both happen, which is what "mutually exclusive" means
 *   3. same time bucket and same type — the conservative fallback for holds
 *      with a start but no end time
 *
 * Type is deliberately NOT part of signals 1 and 2. Grouping on type would file
 * "museum or beach or shopping" as three unrelated decisions, which is the case
 * this exists for.
 */
function tdAreAlternatives_(a, b) {
  if (a.date !== b.date) return false;

  if (a._explicit && b._explicit) return true;                       // 1

  var aStart = tdTimeToMins_(a.startTime), bStart = tdTimeToMins_(b.startTime);
  if (aStart === null || bStart === null) return false;
  var aEnd = tdTimeToMins_(a.endTime), bEnd = tdTimeToMins_(b.endTime);
  if (aEnd !== null && bEnd !== null && aStart < bEnd && bStart < aEnd) return true;  // 2

  var aType = String(a.type || '').toLowerCase();
  var bType = String(b.type || '').toLowerCase();
  return aType === bType && timeBucketOf_(a.startTime) === timeBucketOf_(b.startTime); // 3
}

/**
 * Marks tentative items and groups the ones competing for the same slot.
 *
 * Writes four fields into each item's metadata:
 *   tentative        — this is a hold, not a booking
 *   optionGroup      — "<date>|<earliest HH:MM>", shared by everything in the group
 *   optionCount      — how many options the group holds
 *   isRepresentative — exactly one per group; the one everything downstream
 *                      counts, so three holds occupy one slot rather than three
 *
 * Deriving it here, once, is what lets every consumer collapse with a filter
 * instead of its own copy of this logic. Two implementations of the grouping —
 * one in Apps Script, one in browser JS — would drift; a flag cannot.
 *
 * Mutates and returns `items`.
 */
function annotateOptionGroups_(items) {
  if (!items || !items.length) return items;

  // Pass 1 — flag holds. Only timed, dated, non-all-day items can compete for a
  // slot; an all-day hold has no slot to compete for.
  var candidates = [];
  items.forEach(function(it) {
    var meta = tdReadMeta_(it);
    var tentative = isTentativeText_(it.title, it.notes) || meta.tentative === true;
    if (!tentative) return;

    meta.tentative = true;
    tdWriteMeta_(it, meta);

    if (!it.date || !it.startTime || it.allDay) return;
    it._explicit = hasExplicitOptionMarker_(it.title, it.notes);
    candidates.push(it);
  });
  if (!candidates.length) return items;

  // Pass 2 — transitive closure over the alternatives test, so A~B and B~C put
  // all three in one group.
  var parent = candidates.map(function(_, i) { return i; });
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function union(i, j) { var ri = find(i), rj = find(j); if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj); }

  for (var i = 0; i < candidates.length; i++) {
    for (var j = i + 1; j < candidates.length; j++) {
      if (tdAreAlternatives_(candidates[i], candidates[j])) union(i, j);
    }
  }

  var groups = {};
  candidates.forEach(function(it, idx) {
    var root = find(idx);
    if (!groups[root]) groups[root] = [];
    groups[root].push(it);
  });

  // Pass 3 — key, count, representative. Earliest start wins, ties broken by id
  // so repeated reads of the same data produce identical output.
  Object.keys(groups).forEach(function(root) {
    var members = groups[root].sort(function(a, b) {
      var am = tdTimeToMins_(a.startTime), bm = tdTimeToMins_(b.startTime);
      if (am !== bm) return am - bm;
      return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
    });
    var key = members[0].date + '|' + members[0].startTime;
    members.forEach(function(it, idx) {
      var meta = tdReadMeta_(it);
      meta.optionGroup      = key;
      meta.optionCount      = members.length;
      meta.isRepresentative = (idx === 0);
      tdWriteMeta_(it, meta);
    });
  });

  items.forEach(function(it) { delete it._explicit; });
  return items;
}

/**
 * One occupied slot per decision.
 *
 * Every consumer that reasons about the SHAPE of a day — free-time gaps,
 * itinerary notices, travel-leg pairing — must see a group as one item. Without
 * this, three competing holds read as a packed afternoon and produce free-time
 * that vanished and travel legs between places you will visit at most one of.
 *
 * Deliberately a filter over a flag the server already set, not a second copy
 * of annotateOptionGroups_'s logic.
 */
function collapseOptionGroups_(items) {
  if (!items || !items.length) return items || [];
  return items.filter(function(it) {
    var meta = tdReadMeta_(it);
    return !meta.optionGroup || meta.isRepresentative === true;
  });
}

// ─── PHASE 2 — closing an open decision ──────────────────────────────────────
//
// An OPEN decision is the absence of a row in Trip Decisions. Rows appear only
// when you act, so decide-by stays derived, nothing is written on a read path,
// and a hold you delete from the calendar simply stops being a decision.

/** Types whose option usually has to be booked, so the clock starts earlier. */
var DECIDE_BY_TICKETED_ = ['show', 'city_tour', 'theme_park', 'museum', 'spa',
                           'skiing', 'snorkeling', 'winery'];
var DECIDE_BY_DINING_   = ['reservation', 'dining', 'nightlife', 'coffee'];

/** Days of lead time one option's type asks for. */
function decideByLeadDays_(type) {
  var t = String(type || '').toLowerCase();
  if (DECIDE_BY_TICKETED_.indexOf(t) !== -1) return 3;
  if (DECIDE_BY_DINING_.indexOf(t)   !== -1) return 2;
  return 1;
}

function tdAddDays_(yyyymmdd, delta) {
  var p = String(yyyymmdd).split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + delta);
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

/**
 * When a group has to be decided by.
 *
 * A mixed group takes the EARLIEST of its members' deadlines — the museum in a
 * museum-or-beach group is the thing needing a booking, so it sets the clock.
 * Clamped to [today, slotDate]: never in the past, never after the slot itself.
 */
function decideByFor_(members, todayStr) {
  if (!members || !members.length) return '';
  var slotDate = members[0].date;
  var earliest = null;
  members.forEach(function(m) {
    var d = tdAddDays_(slotDate, -decideByLeadDays_(m.type));
    if (earliest === null || d < earliest) earliest = d;
  });
  if (todayStr && earliest < todayStr) earliest = todayStr;
  if (earliest > slotDate) earliest = slotDate;
  return earliest;
}

/** Reads the resolutions for one trip, keyed by group. */
function loadTripDecisions_(tripKey) {
  var out = {};
  try {
    var sheet = getSpreadsheet().getSheetByName(TABS.TRIP_DECISIONS);
    if (!sheet || sheet.getLastRow() < 2) return out;
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, TRIP_DECISION_HEADERS.length).getValues();
    rows.forEach(function(r) {
      if (!String(r[0] || '').trim()) return;
      if (String(r[1] || '').trim() !== tripKey) return;
      out[String(r[2] || '').trim()] = {
        id:           String(r[0]).trim(),
        status:       String(r[4] || '').trim().toLowerCase(),
        chosenItemId: String(r[5] || '').trim(),
        snoozedUntil: formatDateVal_(r[6]).trim(),
      };
    });
  } catch (e) {
    Logger.log('loadTripDecisions_: ' + e.message);
  }
  return out;
}

/**
 * Stamps each grouped item with its decide-by and whatever resolution exists.
 *
 * The consequential line is the representative flip: every consumer collapses on
 * isRepresentative, so moving it to the chosen option makes gap detection,
 * travel-leg pairing and the notices all start reasoning about the plan you
 * actually picked — without a change to any of them.
 *
 * Mutates and returns `items`.
 */
function applyTripDecisions_(items, tripKey, todayStr) {
  if (!items || !items.length) return items;
  var resolutions = loadTripDecisions_(tripKey);

  var byGroup = {};
  items.forEach(function(it) {
    var meta = tdReadMeta_(it);
    if (!meta.optionGroup) return;
    (byGroup[meta.optionGroup] = byGroup[meta.optionGroup] || []).push(it);
  });

  Object.keys(byGroup).forEach(function(groupKey) {
    var members = byGroup[groupKey];
    var res     = resolutions[groupKey] || null;
    var decideBy = decideByFor_(members, todayStr);

    var status = 'open';
    if (res) {
      if (res.status === 'decided' && res.chosenItemId) status = 'decided';
      else if (res.status === 'dropped') status = 'dropped';
      else if (res.status === 'snoozed') status = 'snoozed';
    }

    members.forEach(function(it) {
      var meta = tdReadMeta_(it);
      meta.decideBy       = decideBy;
      meta.decisionStatus = status;
      if (status === 'snoozed' && res) meta.snoozedUntil = res.snoozedUntil;

      if (status === 'decided') {
        var isChosen = (String(it.id) === res.chosenItemId);
        meta.chosen           = isChosen;
        meta.dismissed        = !isChosen;
        meta.isRepresentative = isChosen;      // the flip
        if (isChosen) meta.tentative = false;  // it is a plan now, so it renders solid
      } else {
        delete meta.chosen;
        delete meta.dismissed;
      }
      tdWriteMeta_(it, meta);
    });

    // A resolution naming an option that no longer exists (the hold was deleted
    // from the calendar) would otherwise leave a group with no representative
    // and quietly drop the slot from every consumer.
    if (status === 'decided' && !members.some(function(m) { return tdReadMeta_(m).isRepresentative; })) {
      var meta0 = tdReadMeta_(members[0]);
      meta0.isRepresentative = true;
      meta0.decisionStatus   = 'open';
      tdWriteMeta_(members[0], meta0);
      Logger.log('applyTripDecisions_: chosen item missing for ' + groupKey + ' — reopened');
    }
  });

  return items;
}

/**
 * Nightly: one flag per open decision, sharpening as its deadline approaches.
 *
 * Upserted rather than written through writeFlags — writeFlags dedups via
 * keysAreSimilar_, which strips standalone numbers, so a tiered key would
 * collapse to one flag and the escalation would silently never escalate. Same
 * trap the warranty tiers had to route around.
 */
function checkTripDecisions_() {
  var ss        = getSpreadsheet();
  var flagSheet = ss.getSheetByName(TABS.FLAGS);
  if (!flagSheet) return;

  var tz       = Session.getScriptTimeZone();
  var now      = new Date();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var dateStr  = todayStr;

  var trips = [];
  try { trips = getUpcomingTravel_(readPTOConfig_()) || []; }
  catch (e) { Logger.log('checkTripDecisions_: no upcoming travel — ' + e.message); return; }

  var wanted = {};
  trips.forEach(function(trip) {
    var daysAway = trip.daysAway;
    if (daysAway === undefined && trip.startDate) {
      daysAway = Math.round((new Date(trip.startDate + 'T00:00:00') - now) / 86400000);
    }
    if (daysAway === null || daysAway === undefined || daysAway > 21) return;

    var tripKey = trip.startDate + '|' + trip.label;
    var itin;
    try {
      itin = webGetItinerary_({ parameter: { tripKey: tripKey, startDate: trip.startDate, endDate: trip.endDate } },
                              { skipEventTz: true });
    } catch (ie) {
      Logger.log('checkTripDecisions_: itinerary failed for ' + tripKey + ' — ' + ie.message);
      return;
    }

    var byGroup = {};
    (itin.items || []).forEach(function(it) {
      var meta = tdReadMeta_(it);
      if (!meta.optionGroup) return;
      (byGroup[meta.optionGroup] = byGroup[meta.optionGroup] || []).push({ item: it, meta: meta });
    });

    Object.keys(byGroup).forEach(function(groupKey) {
      var members = byGroup[groupKey];
      var meta    = members[0].meta;
      if (meta.decisionStatus !== 'open') return;                       // decided or dropped
      if (meta.snoozedUntil && meta.snoozedUntil > todayStr) return;    // deliberately quiet

      var slotDate = members[0].item.date;
      var decideBy = meta.decideBy || slotDate;
      var daysToDecide = Math.round((new Date(decideBy + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000);
      if (daysToDecide > 3) return;                                     // not yet worth saying

      var urgency = daysToDecide > 0 ? 'Medium' : 'High';
      var when    = daysToDecide > 1  ? 'in ' + daysToDecide + ' days'
                  : daysToDecide === 1 ? 'tomorrow'
                  : daysToDecide === 0 ? 'today'
                  : Math.abs(daysToDecide) + ' day' + (daysToDecide === -1 ? '' : 's') + ' ago';
      var slotLabel = Utilities.formatDate(new Date(slotDate + 'T12:00:00'), tz, 'EEE MMM d');
      var titles = members.map(function(m) { return m.item.title; }).join(' · ');

      var slug = (tripKey + '_' + groupKey).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      wanted['trip_decision_' + slug] = {
        flag:    '🤔 ' + members.length + ' option' + (members.length === 1 ? '' : 's') +
                 ' still open for ' + slotLabel + ' — ' + trip.label,
        reason:  titles + '. Decide ' + when +
                 (daysToDecide < 0 ? ' (past the point where booking gets easy)' : '') +
                 '. Confirm one from the trip itinerary, or say "confirm the ' +
                 String(members[0].item.title).split(' ').slice(0, 3).join(' ') + ' one".',
        urgency: urgency,
      };
    });
  });

  upsertKeyedFlags_(flagSheet, 'trip_decision_', 'Trip Decisions', wanted, dateStr);
  Logger.log('checkTripDecisions_: ' + Object.keys(wanted).length + ' open decision(s) flagged.');
}

// ─── PHASE 3 — having something useful to say ────────────────────────────────
//
// Two jobs. Recommending an option when the facts are decisive, and noticing
// when the facts under a decision you ALREADY made have moved.
//
// The governing rule throughout is restraint. A recommender that speaks on
// every decision teaches you to ignore it, and the one time it had something
// worth saying you will scroll past it. So every signal below has an explicit
// "and otherwise say nothing" branch, and two signals that disagree produce
// silence rather than an arbitration.

/**
 * Types whose enjoyment depends on the sky.
 *
 * `skiing` is deliberately absent despite being outdoors: precipitation is the
 * POINT of a ski day, so "it will rain, go indoors" is exactly wrong there and
 * telling snow from rain reliably enough to special-case it is more subtlety
 * than this is worth. `winery` is absent for the opposite reason — the tasting
 * room is indoors and the vineyard is not, and which one a booking means is not
 * knowable from a type string.
 */
var WEATHER_OUTDOOR_TYPES_ = ['beach', 'mountain', 'camera', 'city_tour',
                              'theme_park', 'snorkeling', 'walking', 'bicycle',
                              'market'];

/** Types the weather cannot reach. */
var WEATHER_INDOOR_TYPES_  = ['museum', 'show', 'spa', 'shopping', 'dining',
                              'reservation', 'coffee', 'nightlife'];

function isOutdoorType_(type) {
  return WEATHER_OUTDOOR_TYPES_.indexOf(String(type || '').toLowerCase()) !== -1;
}
function isIndoorType_(type) {
  return WEATHER_INDOOR_TYPES_.indexOf(String(type || '').toLowerCase()) !== -1;
}

/**
 * Per-day forecast for a destination, as structured rows.
 *
 * A sibling of getPackingWeather_ (WebApp.js), not a replacement: that one
 * reduces the whole trip to one prose sentence for a packing prompt, and a
 * per-slot decision needs the individual days. Same provider, same endpoint,
 * same geocoder, same cache discipline — the only difference is that this one
 * hands back the numbers instead of a summary.
 *
 * Open-Meteo rather than the OpenWeatherMap path in Weather.js because that one
 * needs an API key and asks for cnt=8, which is 24 hours — useless for a
 * decision three days out. This one needs no key and reaches 14 days.
 *
 * Deliberately NO archive fallback. getPackingWeather_ falls back to last
 * year's weather beyond the forecast window, which is the right call for "what
 * should I pack" and the wrong one here: a seasonal average is not a reason to
 * change Saturday's plan, and presenting one as though it were a forecast would
 * be the most misleading thing this feature could do.
 *
 * @returns {Array<{date:string,tMax:number,tMin:number,precipMm:number,code:number}>|null}
 */
function tripDailyForecast_(destination, startDate, endDate) {
  if (!destination || !startDate || !endDate) return null;

  var cacheKey = 'tripwx_' + (destination + '_' + startDate + '_' + endDate)
    .toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
  try {
    var hit = CacheService.getScriptCache().get(cacheKey);
    if (hit) return JSON.parse(hit);
  } catch (e_) {}

  try {
    var geo = geocodePackingDestination_(destination);
    if (!geo) return null;

    // Outside the forecast window there is nothing honest to say.
    var daysUntil = Math.floor((new Date(startDate + 'T00:00:00') - new Date()) / 86400000);
    if (daysUntil > 14) return null;

    var url = 'https://api.open-meteo.com/v1/forecast' +
              '?latitude=' + geo.lat + '&longitude=' + geo.lon +
              '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code' +
              '&start_date=' + startDate + '&end_date=' + endDate +
              '&timezone=auto&temperature_unit=fahrenheit';

    var resp = fetchWithHealth_('open-meteo', url);
    if (!resp) return null;
    var data = JSON.parse(resp.getContentText());
    if (!data.daily || !data.daily.time) return null;

    var out = [];
    data.daily.time.forEach(function(d, i) {
      out.push({
        date:     String(d),
        tMax:     data.daily.temperature_2m_max ? data.daily.temperature_2m_max[i] : null,
        tMin:     data.daily.temperature_2m_min ? data.daily.temperature_2m_min[i] : null,
        precipMm: data.daily.precipitation_sum  ? data.daily.precipitation_sum[i]  : null,
        code:     data.daily.weather_code       ? data.daily.weather_code[i]       : null,
      });
    });

    try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(out), 21600); } catch (e_) {}
    return out;
  } catch (err) {
    Logger.log('tripDailyForecast_: ' + err.message);
    return null;
  }
}

/** WMO codes that mean the day is not merely damp. */
var WMO_SEVERE_ = [65, 67, 75, 77, 82, 86, 95, 96, 99];

/**
 * 'severe' | 'wet' | 'fine' | null
 *
 * The 1mm bar for "wet" is not invented here — it is what getPackingWeather_
 * already counts as a rain day, and two different definitions of rain in one
 * codebase is how VERA ends up contradicting itself in two emails.
 */
function weatherVerdictFor_(day) {
  if (!day) return null;
  var mm   = (day.precipMm === null || day.precipMm === undefined) ? null : Number(day.precipMm);
  var code = (day.code === null || day.code === undefined) ? null : Number(day.code);
  if (mm === null && code === null) return null;

  if (code !== null && WMO_SEVERE_.indexOf(code) !== -1) return 'severe';
  if (mm !== null && mm > 5) return 'severe';
  if (mm !== null && mm > 1) return 'wet';
  return 'fine';
}

function tdForecastDayFor_(forecast, dateStr) {
  if (!forecast || !forecast.length) return null;
  for (var i = 0; i < forecast.length; i++) {
    if (forecast[i].date === dateStr) return forecast[i];
  }
  return null;
}

// ─── The signals ─────────────────────────────────────────────────────────────
//
// Each takes the group's members plus a context object and returns either null
// or { itemId, because, weight }. `because` is one clause naming the FACT, not
// a judgement — "rain likely Sat afternoon", never "the better choice".

/**
 * An option that collides with something already booked is ruled out. If
 * exactly one survives, that is not really a recommendation so much as an
 * observation, which is why it carries the most weight.
 */
function sigCollision_(members, ctx) {
  var dayItems = (ctx && ctx.dayItems) || [];
  if (!dayItems.length || members.length < 2) return null;

  var memberIds = {};
  members.forEach(function(m) { memberIds[String(m.id)] = true; });

  // Only genuinely booked things rule anything out. Another hold cannot.
  var booked = dayItems.filter(function(it) {
    if (memberIds[String(it.id)]) return false;
    if (it.date !== members[0].date) return false;
    var meta = tdReadMeta_(it);
    if (meta.tentative === true) return false;
    return tdTimeToMins_(it.startTime) !== null && tdTimeToMins_(it.endTime) !== null;
  });
  if (!booked.length) return null;

  var survivors = members.filter(function(m) {
    var ms = tdTimeToMins_(m.startTime), me = tdTimeToMins_(m.endTime);
    if (ms === null || me === null) return true;          // cannot judge, so keep
    return !booked.some(function(b) {
      return ms < tdTimeToMins_(b.endTime) && tdTimeToMins_(b.startTime) < me;
    });
  });

  if (survivors.length !== 1 || survivors.length === members.length) return null;

  var clash = booked.filter(function(b) {
    var bs = tdTimeToMins_(b.startTime), be = tdTimeToMins_(b.endTime);
    return members.some(function(m) {
      if (String(m.id) === String(survivors[0].id)) return false;
      var ms = tdTimeToMins_(m.startTime), me = tdTimeToMins_(m.endTime);
      return ms !== null && me !== null && ms < be && bs < me;
    });
  })[0];

  return {
    itemId:  survivors[0].id,
    because: 'the others clash with ' + (clash ? clash.title : 'a booking already on the day'),
    weight:  3,
  };
}

/**
 * Weather warns, it does not tempt.
 *
 * Fires ONLY toward the dry option on a wet day. A gorgeous forecast produces
 * nothing: rain is a real reason to avoid a beach, but sunshine is not a reason
 * to skip a museum someone wanted to see, and a recommender that says otherwise
 * is substituting its taste for theirs.
 *
 * Needs both an outdoor and an indoor option in the group — with all three
 * outdoors the weather is a warning, not a decision, and it has nothing to
 * discriminate between.
 */
function sigWeather_(members, ctx) {
  var day = ctx && ctx.forecastDay;
  if (!day) return null;

  var verdict = weatherVerdictFor_(day);
  if (verdict !== 'wet' && verdict !== 'severe') return null;   // the asymmetry

  var indoors  = members.filter(function(m) { return isIndoorType_(m.type); });
  var outdoors = members.filter(function(m) { return isOutdoorType_(m.type); });
  if (indoors.length !== 1 || !outdoors.length) return null;

  return {
    itemId:  indoors[0].id,
    because: (verdict === 'severe' ? 'storms forecast' : 'rain likely') +
             (day.precipMm ? ' (' + Math.round(Number(day.precipMm)) + 'mm)' : '') +
             ' — it is the one that stays dry',
    weight:  2,
  };
}

/**
 * One option meaningfully closer to wherever you already are.
 *
 * CACHE ONLY. fetchTravelLeg_ bills a Distance Matrix element per call, and
 * pricing a leg for every option of every open decision would multiply that by
 * the option count on a path that runs on every itinerary read. A cache miss
 * makes this signal silent, which is the correct outcome — the same read-only
 * discipline the travel-day briefing already uses at TravelDayBriefing.js:594.
 */
var TD_TRAVEL_DELTA_MINS_ = 20;

function sigTravel_(members, ctx) {
  var cache = ctx && ctx.legCache;
  var from  = ctx && ctx.prevConfirmed;
  if (!cache || !from || members.length < 2) return null;
  if (typeof isUsableTravelLocation_ !== 'function') return null;

  var fromLoc = (typeof departurePointOf_ === 'function') ? departurePointOf_(from) : from.location;
  if (!fromLoc || !isUsableTravelLocation_(fromLoc)) return null;

  var timed = [];
  for (var i = 0; i < members.length; i++) {
    var m = members[i];
    if (!m.location || !isUsableTravelLocation_(m.location)) return null;  // incomplete → silent
    var leg = cache[travelLegKey_(fromLoc, m.location, 'driving')];
    if (!leg || leg.status !== 'OK' || leg.minutes === null) return null;  // a miss → silent
    timed.push({ id: m.id, mins: Number(leg.minutes) });
  }

  timed.sort(function(a, b) { return a.mins - b.mins; });
  if (timed[1].mins - timed[0].mins < TD_TRAVEL_DELTA_MINS_) return null;

  return {
    itemId:  timed[0].id,
    because: timed[0].mins + ' min away vs ' + timed[1].mins + ' for the next closest',
    weight:  2,
  };
}

/**
 * Trip context as a TIEBREAK — weight 0, so it can never carry a
 * recommendation by itself.
 *
 * It can still veto one, through the disagreement rule below. That is
 * deliberate: if the facts point at the winery and the trip is a work trip,
 * VERA genuinely is not sure, and saying nothing is the honest outcome.
 */
var TD_CONTEXT_AFFINITY_ = [
  { match: /anniversary|romantic|honeymoon/i,
    favour:   ['winery', 'dining', 'spa', 'show', 'beach'],
    disfavour:['theme_park', 'market'] },
  { match: /family/i,
    favour:   ['theme_park', 'beach', 'museum', 'city_tour'],
    disfavour:['nightlife', 'winery'] },
  { match: /work|business/i,
    favour:   ['coffee', 'dining'],
    disfavour:['theme_park', 'beach', 'snorkeling'] },
  { match: /girls|group/i,
    favour:   ['nightlife', 'dining', 'spa', 'shopping'],
    disfavour:[] },
];

function sigContext_(members, ctx) {
  var context = String((ctx && ctx.tripContext) || '').trim();
  if (!context || members.length < 2) return null;

  var rule = null;
  for (var i = 0; i < TD_CONTEXT_AFFINITY_.length; i++) {
    if (TD_CONTEXT_AFFINITY_[i].match.test(context)) { rule = TD_CONTEXT_AFFINITY_[i]; break; }
  }
  if (!rule) return null;

  var scored = members.map(function(m) {
    var t = String(m.type || '').toLowerCase();
    var s = 0;
    if (rule.favour.indexOf(t)    !== -1) s += 1;
    if (rule.disfavour.indexOf(t) !== -1) s -= 1;
    return { id: m.id, score: s };
  }).sort(function(a, b) { return b.score - a.score; });

  if (scored[0].score <= 0 || scored[0].score === scored[1].score) return null;

  return { itemId: scored[0].id, because: 'fits ' + context.toLowerCase(), weight: 0 };
}

/**
 * The recommendation, or nothing.
 *
 * @returns {null|{itemId:string, because:string, signal:string}}
 */
function recommendForGroup_(members, ctx) {
  if (!members || members.length < 2) return null;
  ctx = ctx || {};

  var found = [];
  [['collision', sigCollision_], ['weather', sigWeather_],
   ['travel', sigTravel_],       ['context', sigContext_]].forEach(function(pair) {
    var r;
    try { r = pair[1](members, ctx); }
    catch (e) { Logger.log('recommendForGroup_: ' + pair[0] + ' signal failed — ' + e.message); return; }
    if (r && r.itemId) { r.signal = pair[0]; found.push(r); }
  });
  if (!found.length) return null;

  // Disagreement is not decisiveness. Two signals pointing at different options
  // means VERA does not know, and arbitrating between them is how a recommender
  // starts being confidently wrong.
  var target = String(found[0].itemId);
  for (var i = 1; i < found.length; i++) {
    if (String(found[i].itemId) !== target) return null;
  }

  // Context alone cannot speak.
  var drivers = found.filter(function(f) { return f.weight > 0; });
  if (!drivers.length) return null;

  drivers.sort(function(a, b) { return b.weight - a.weight; });
  return { itemId: drivers[0].itemId, because: drivers[0].because, signal: drivers[0].signal };
}

/**
 * Attaches a recommendation to each OPEN group, where there is one to attach.
 *
 * Runs after applyTripDecisions_, so a group that has been decided is skipped —
 * once you have chosen, VERA offering an opinion is second-guessing, not help.
 *
 * Stamps every member rather than just the representative, so the disclosure
 * can mark the right row without knowing which one the server considered first.
 *
 * Mutates and returns `items`.
 */
function applyTripRecommendations_(items, opts) {
  if (!items || !items.length) return items;
  opts = opts || {};

  var byGroup = {};
  items.forEach(function(it) {
    var meta = tdReadMeta_(it);
    if (!meta.optionGroup) return;
    (byGroup[meta.optionGroup] = byGroup[meta.optionGroup] || []).push(it);
  });
  if (!Object.keys(byGroup).length) return items;

  // One cache read for the whole itinerary, not one per group. A miss stays a
  // miss — nothing here ever triggers a fetch.
  var legCache = null;
  if (opts.legCache !== undefined) legCache = opts.legCache;
  else {
    try { legCache = (typeof loadTravelLegCache_ === 'function') ? loadTravelLegCache_() : null; }
    catch (e) { Logger.log('applyTripRecommendations_: leg cache unavailable — ' + e.message); }
  }

  Object.keys(byGroup).forEach(function(groupKey) {
    var members = byGroup[groupKey];
    var meta0   = tdReadMeta_(members[0]);
    if (meta0.decisionStatus && meta0.decisionStatus !== 'open') return;

    var date = members[0].date;
    var groupStart = tdTimeToMins_(members[0].startTime);

    // The last genuinely booked thing before this slot — where you will be
    // travelling FROM.
    var prevConfirmed = null;
    items.forEach(function(it) {
      if (it.date !== date) return;
      if (tdReadMeta_(it).tentative === true) return;
      var s = tdTimeToMins_(it.startTime);
      if (s === null || groupStart === null || s >= groupStart) return;
      if (!prevConfirmed || s > tdTimeToMins_(prevConfirmed.startTime)) prevConfirmed = it;
    });

    var rec = recommendForGroup_(members, {
      dayItems:      items.filter(function(it) { return it.date === date; }),
      legCache:      legCache,
      prevConfirmed: prevConfirmed,
      forecastDay:   tdForecastDayFor_(opts.forecast, date),
      tripContext:   opts.tripContext || '',
    });

    members.forEach(function(it) {
      var m = tdReadMeta_(it);
      if (rec) { m.recommendedId = rec.itemId; m.recommendBecause = rec.because; m.recommendSignal = rec.signal; }
      else     { delete m.recommendedId; delete m.recommendBecause; delete m.recommendSignal; }
      tdWriteMeta_(it, m);
    });
  });

  return items;
}

// ─── The weather dependency — a premise that moved ───────────────────────────
//
// Not a decision tree. A tree needs edges someone has to author, it fights the
// deadlines (which already impose their own order), and it has to be
// invalidated every time a decision is undone. The real coupling is simpler and
// truer: a decision rested on a fact, and the fact changed.
//
// So VERA does not branch. It remembers what the weather looked like when you
// chose, and tells you if that stops being true.

/** The premise stored in the decision row's Notes column at confirm time. */
function tdReadPremise_(notes) {
  if (!notes) return null;
  try {
    var p = JSON.parse(String(notes));
    return (p && typeof p === 'object' && p.wx) ? p : null;
  } catch (e) { return null; }
}

/**
 * Nightly: one flag per decision whose weather premise has turned.
 *
 * Fires only on the decisive transition — an OUTDOOR choice whose day has gone
 * from fine to wet. It never reopens the decision: silently undoing a choice
 * someone made is worse than letting them make it again knowingly, and the Undo
 * that phase 2 built is one tap away.
 */
function checkTripDecisionPremises_() {
  var ss        = getSpreadsheet();
  var flagSheet = ss.getSheetByName(TABS.FLAGS);
  var tdSheet   = ss.getSheetByName(TABS.TRIP_DECISIONS);
  var tz       = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // Still upsert an empty set when there is nothing to check — that is what
  // closes yesterday's flags once the decisions behind them are gone.
  if (!flagSheet || !tdSheet || tdSheet.getLastRow() < 2) {
    if (flagSheet) upsertKeyedFlags_(flagSheet, 'trip_premise_', 'Trip Decisions', {}, todayStr);
    return;
  }

  var rows = tdSheet.getRange(2, 1, tdSheet.getLastRow() - 1, TRIP_DECISION_HEADERS.length).getValues();

  var wanted = {};
  rows.forEach(function(r) {
    if (!String(r[0] || '').trim()) return;
    if (String(r[4] || '').trim().toLowerCase() !== 'decided') return;

    var tripKey  = String(r[1] || '').trim();
    var groupKey = String(r[2] || '').trim();
    var slotDate = formatDateVal_(r[3]).trim();
    var chosenId = String(r[5] || '').trim();
    var premise  = tdReadPremise_(r[8]);

    if (!slotDate || slotDate <= todayStr) return;             // today or past — too late to matter
    if (!premise || premise.wx !== 'fine') return;             // nothing to fall from

    var parts = tripKey.split('|');
    var itin;
    try {
      itin = webGetItinerary_({ parameter: { tripKey: tripKey, startDate: parts[0], endDate: slotDate } },
                              { skipEventTz: true });
    } catch (e) {
      Logger.log('checkTripDecisionPremises_: itinerary failed for ' + tripKey + ' — ' + e.message);
      return;
    }

    var members = (itin.items || []).filter(function(it) {
      return tdReadMeta_(it).optionGroup === groupKey;
    });
    if (!members.length) return;

    var chosen = members.filter(function(m) { return String(m.id) === chosenId; })[0];
    if (!chosen || !isOutdoorType_(chosen.type)) return;       // indoors is weatherproof

    var dest = itin.destination || (parts[1] || '');
    var day  = tdForecastDayFor_(tripDailyForecast_(dest, slotDate, slotDate), slotDate);
    var now  = weatherVerdictFor_(day);
    if (now !== 'wet' && now !== 'severe') return;             // still fine, or unknowable

    var others = members.filter(function(m) { return String(m.id) !== chosenId; });
    var indoor = others.filter(function(m) { return isIndoorType_(m.type); })[0];
    var slotLabel = Utilities.formatDate(new Date(slotDate + 'T12:00:00'), tz, 'EEE MMM d');

    var slug = (tripKey + '_' + groupKey).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    wanted['trip_premise_' + slug] = {
      flag:   '☔ ' + chosen.title + ' on ' + slotLabel + ' — the forecast turned',
      reason: 'You confirmed it' + (premise.asOf ? ' on ' + premise.asOf : '') +
              ' when the day looked clear; it is now showing ' +
              (now === 'severe' ? 'storms' : 'rain') + '. ' +
              (indoor ? indoor.title + ' is still on your calendar as an option. ' : '') +
              'Reopen it from the trip itinerary to switch, or leave it be.',
      urgency: now === 'severe' ? 'High' : 'Medium',
    };
  });

  upsertKeyedFlags_(flagSheet, 'trip_premise_', 'Trip Decisions', wanted, todayStr);
  Logger.log('checkTripDecisionPremises_: ' + Object.keys(wanted).length + ' premise(s) moved.');
}

// ─── Email sections ──────────────────────────────────────────────────────────

/**
 * Open decisions for one trip, as the briefing emails need them.
 *
 * Goes through webGetItinerary_ rather than reading the Itinerary tab, because
 * that is where the grouping, the resolutions and the recommendation are
 * applied. The briefings read raw rows for everything else, which is exactly
 * why they were still showing competing holds as separate plans.
 *
 * @returns {Array<{slotDate,slotLabel,decideBy,options:Array,recommendedId,recommendBecause}>}
 */
function openDecisionsForTrip_(tripKey, startDate, endDate, onlyDate) {
  var out = [];
  try {
    var tz   = Session.getScriptTimeZone();
    var itin = webGetItinerary_({ parameter: { tripKey: tripKey, startDate: startDate, endDate: endDate } },
                                { skipEventTz: true });

    var byGroup = {};
    (itin.items || []).forEach(function(it) {
      var m = tdReadMeta_(it);
      if (!m.optionGroup) return;
      if (m.decisionStatus && m.decisionStatus !== 'open') return;
      (byGroup[m.optionGroup] = byGroup[m.optionGroup] || []).push(it);
    });

    Object.keys(byGroup).forEach(function(groupKey) {
      var members = byGroup[groupKey];
      if (members.length < 2) return;
      var meta = tdReadMeta_(members[0]);
      var slot = members[0].date;
      if (onlyDate && slot !== onlyDate) return;
      out.push({
        groupKey:         groupKey,
        slotDate:         slot,
        slotLabel:        Utilities.formatDate(new Date(slot + 'T12:00:00'), tz, 'EEE MMM d'),
        decideBy:         meta.decideBy || '',
        options:          members,
        recommendedId:    meta.recommendedId || '',
        recommendBecause: meta.recommendBecause || '',
      });
    });
    out.sort(function(a, b) { return a.slotDate < b.slotDate ? -1 : a.slotDate > b.slotDate ? 1 : 0; });
  } catch (e) {
    Logger.log('openDecisionsForTrip_: ' + e.message);
  }
  return out;
}

/**
 * The email section. Returns '' when there is nothing open, which is what makes
 * it disappear — both assemblers drop a section whose builder returns blank
 * (PreTripBriefing.js:446, TravelDayBriefing.js:447).
 */
function buildOpenDecisionsSection_(decisions) {
  if (!decisions || !decisions.length) return '';

  var BLUE = '#1565c0', DARK = '#111111', GREY = '#555555', LGREY = '#888888';
  var tz   = Session.getScriptTimeZone();

  var html =
    '<p style="margin:0 0 16px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
    'letter-spacing:1.5px;text-transform:uppercase;">🤔 Still To Decide</p>';

  decisions.forEach(function(d, i) {
    var byLabel = '';
    if (d.decideBy) {
      try { byLabel = Utilities.formatDate(new Date(d.decideBy + 'T12:00:00'), tz, 'EEE MMM d'); }
      catch (e) { byLabel = d.decideBy; }
    }

    html +=
      (i > 0 ? '<div style="height:1px;background:#f0f0f5;margin:12px 0;"></div>' : '') +
      '<p style="margin:0 0 2px;font-size:14px;font-weight:600;color:' + DARK + ';">' +
      escapeHtml_(d.slotLabel) + ' — ' + d.options.length + ' options' + '</p>' +
      (byLabel ? '<p style="margin:0 0 6px;font-size:12px;color:' + LGREY + ';">Decide by ' +
                 escapeHtml_(byLabel) + '</p>' : '');

    d.options.forEach(function(o) {
      var suggested = d.recommendedId && String(o.id) === String(d.recommendedId);
      html +=
        '<p style="margin:0 0 3px;font-size:13px;color:' + GREY + ';">' +
        '<span style="color:' + LGREY + ';">' + escapeHtml_(o.startTime || '·') + '</span>&nbsp;&nbsp;' +
        escapeHtml_(o.title || '') +
        (o.location ? ' <span style="color:' + LGREY + ';">· ' + escapeHtml_(o.location) + '</span>' : '') +
        (suggested ? ' <span style="font-size:11px;color:' + BLUE + ';background:#eef4fc;' +
                     'padding:1px 6px;border-radius:10px;white-space:nowrap;">★ suggested</span>' : '') +
        '</p>';
    });

    if (d.recommendedId && d.recommendBecause) {
      html += '<p style="margin:6px 0 0;font-size:12px;color:' + BLUE + ';">★ ' +
              escapeHtml_(d.recommendBecause) + '</p>';
    }
  });

  return html;
}

/** Plain-text twin, for the text part of the same emails. */
function buildOpenDecisionsPlain_(decisions) {
  if (!decisions || !decisions.length) return '';
  var lines = ['STILL TO DECIDE'];
  decisions.forEach(function(d) {
    lines.push(d.slotLabel + ' — ' + d.options.length + ' options' +
               (d.decideBy ? ' (decide by ' + d.decideBy + ')' : ''));
    d.options.forEach(function(o) {
      lines.push('  ' + (o.startTime || '·') + '  ' + (o.title || '') +
                 (d.recommendedId && String(o.id) === String(d.recommendedId) ? '  [suggested]' : ''));
    });
    if (d.recommendBecause) lines.push('  * ' + d.recommendBecause);
  });
  return lines.join('\n');
}

/**
 * Collapses competing holds in a list of raw Itinerary SHEET ROWS.
 *
 * The briefing emails read the Itinerary tab directly rather than going through
 * webGetItinerary_, so they never saw the grouping and were the last consumers
 * still rendering three options for one afternoon as three separate plans — a
 * packed day that does not exist, in the two places it misleads most.
 *
 * Adapts rows to the object shape the grouping takes, collapses, and returns
 * the surviving ROWS so every existing builder downstream is unchanged. The
 * adapter is here, once, rather than inline at each call site: three copies of
 * a column-index mapping is how the two versions of inferTripDestination_
 * happened.
 *
 * Column order is ITINERARY_HEADERS (Code.js:181).
 * Never throws — a failure here returns the rows untouched.
 */
function collapseItineraryRows_(rows, tripKey, todayStr) {
  if (!rows || !rows.length) return rows || [];
  try {
    var objs = rows.map(function(r) {
      return {
        id:        String(r[0] || ''),
        type:      String(r[2] || ''),
        title:     String(r[3] || ''),
        date:      formatDateVal_(r[4]),
        startTime: String(r[5] || ''),
        endTime:   String(r[6] || ''),
        location:  String(r[7] || ''),
        notes:     String(r[8] || ''),
        metadata:  String(r[9] || ''),
      };
    });
    annotateOptionGroups_(objs);
    applyTripDecisions_(objs, tripKey, todayStr);
    var keep = {};
    collapseOptionGroups_(objs).forEach(function(o) { keep[String(o.id)] = true; });
    return rows.filter(function(r) { return keep[String(r[0] || '')]; });
  } catch (e) {
    Logger.log('collapseItineraryRows_: ' + e.message + ' — rows left as they were');
    return rows;
  }
}
