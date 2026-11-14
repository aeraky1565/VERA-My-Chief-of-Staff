// ============================================================
// VERA — WorkTrips.js
// Trips where someone keeps working: a Working Trip (working remotely from out of
// town) or a Business Trip (the employer sends you). Neither takes days off.
// ============================================================
//
// A trip is one of these by its Context (TripMeta): "Working Trip" is remote work;
// "Business Trip" is a business trip, and the older "Work Trip" and "Business" read as
// one. Who is working is a per-person choice kept in the hidden VERA State tab
// (TRIP_WORKING, by Trip ID): TripMeta is read by position with the Trip ID last, so
// it gets no new column. Left unset, whoever the trip's Traveller is, is working.
//
// What it changes:
//   - PTO: a trip never costs PTO (only the work calendar does); in next year's plan a
//     trip is busy only for the people on it, and a working trip is drawn as "working
//     away" for those working. A pencilled Trip Idea that says it's a working or
//     business trip reserves no PTO.
//   - The trip budget: a Business Trip's costs are the employer's ("Employer pays").
//   - Packing and day plans: a business trip packs work clothes and a laptop, a
//     remote one a laptop on top of the usual list; on a working day, ideas are
//     before work, lunch and after work only (hours: Config work_hours_<name>, 9-18).
// ============================================================

var WT_STORE_KEY_ = 'TRIP_WORKING';
var WT_PEOPLE_    = ['Ahmed', 'Victoria'];
var WT_HOURS_DEFAULT_ = { start: 9, end: 18 };

/** Pure: 'remote' (Working Trip), 'business' (Business Trip, Work Trip, Business) or ''. */
function tripWorkKind_(context) {
  var c = String(context == null ? '' : context).trim().toLowerCase();
  if (/^working trip\b/.test(c)) return 'remote';
  if (/^(business trip|work trip|business)\b/.test(c)) return 'business';
  return '';
}

/** Pure: names in a Traveller/Working value ("Both", "Ahmed, Victoria", "victoria"). */
function wtNames_(v) {
  var s = String(v == null ? '' : v).toLowerCase();
  if (/\bboth\b/.test(s)) return WT_PEOPLE_.slice();
  return WT_PEOPLE_.filter(function(n) { return s.indexOf(n.toLowerCase()) !== -1; });
}

/** Pure: who's on the trip: its Traveller, or both of you when unset. */
function wtTravellers_(traveler) { var n = wtNames_(traveler); return n.length ? n : WT_PEOPLE_.slice(); }

/** Pure: who's working on it: the saved choice, else its travellers; nobody unless it's a working kind. */
function tripWorkers_(context, traveler, stored) {
  if (!tripWorkKind_(context)) return [];
  var s = wtNames_(stored);
  return s.length ? s : wtTravellers_(traveler);
}

/** Pure: "9-18", "9:30-17:30", "09:00–18:00" → {start, end} in hours; else 9 to 6. */
function wtParseHours_(v) {
  var m = /^\s*(\d{1,2})(?::(\d{2}))?\s*[-–to ]+\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(String(v == null ? '' : v));
  if (!m) return { start: WT_HOURS_DEFAULT_.start, end: WT_HOURS_DEFAULT_.end };
  var a = Number(m[1]) + (Number(m[2] || 0) / 60), b = Number(m[3]) + (Number(m[4] || 0) / 60);
  if (!(a >= 0 && a < 24 && b > a && b <= 24)) return { start: WT_HOURS_DEFAULT_.start, end: WT_HOURS_DEFAULT_.end };
  return { start: a, end: b };
}
function wtClock_(h) { var hh = Math.floor(h), mm = Math.round((h - hh) * 60); return (hh % 12 || 12) + (mm ? ':' + (mm < 10 ? '0' : '') + mm : '') + (hh < 12 ? ' am' : ' pm'); }

/**
 * Pure: the days in [start, end] a person works: weekdays that aren't one of their
 * holidays and aren't a PTO day booked on their work calendar.
 * holidays: {iso: label}; pto: [[from, to]].
 */
function wtWorkingDays_(start, end, holidays, pto) {
  var out = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end))) return out;
  for (var d = start, guard = 0; d <= end && guard < 120; guard++) {
    var p = d.split('-').map(Number), w = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
    var off = w === 0 || w === 6 || !!(holidays && holidays[d]) || (pto || []).some(function(r) { return d >= r[0] && d <= r[1]; });
    if (!off) out.push(d);
    d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1)).toISOString().slice(0, 10);
  }
  return out;
}

// ---- the saved choice (VERA State tab) ---------------------------------------------

function wtStoreRead_() { try { var o = JSON.parse(veraStoreGet_(WT_STORE_KEY_) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
function wtKeyOf_(tripKey) { var id = ''; try { id = tripIdOf_(tripKey); } catch (e) { id = ''; } return id || String(tripKey || '').trim(); }
function wtStoredFor_(map, tripKey) { return (map || {})[wtKeyOf_(tripKey)] || (map || {})[String(tripKey || '').trim()] || ''; }

/** GET set_trip_working { tripKey, working: Ahmed | Victoria | Both | '' } → saved by Trip ID. */
function webSetTripWorking_(p) {
  p = p || {};
  var tripKey = String(p.tripKey || '').trim(), w = String(p.working == null ? '' : p.working).trim();
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  if (w && ['Ahmed', 'Victoria', 'Both'].indexOf(w) === -1) return { ok: false, error: 'working must be Ahmed, Victoria or Both' };
  return veraLocked_(function() {
    _veraStoreCache_ = null;
    var map = wtStoreRead_(), k = wtKeyOf_(tripKey);
    delete map[String(tripKey)];
    if (w) map[k] = w; else delete map[k];
    var saved = veraStoreSet_(WT_STORE_KEY_, JSON.stringify(map));
    return saved ? { ok: true, tripKey: tripKey, working: w } : { ok: false, error: 'The choice couldn’t be saved' };
  });
}

/**
 * Every trip's people, from TripMeta read once and the saved choices:
 * → function(tripKey) → { kind, travellers: [names], workers: [names] }.
 */
function tripPeopleIndex_() {
  var rows = [], map = wtStoreRead_();
  try {
    var sh = getSpreadsheet().getSheetByName(TABS.TRIP_META);
    if (sh && sh.getLastRow() >= 2) rows = sh.getRange(2, 1, sh.getLastRow() - 1, TRIP_META_HEADERS.length).getValues();
  } catch (e) { rows = []; }
  var keys = rows.map(function(r) { return r[0]; });
  return function(tripKey) {
    var i = rows.length ? tripKeyRowIndex_(keys, tripKey, rows.map(function(r) { return r[TRIP_META_HEADERS.length - 1]; })) : -1, r = i >= 0 ? rows[i] : null;
    var context = r ? String(r[1] || '') : '', traveler = r ? String(r[4] || '') : '';
    return { kind: tripWorkKind_(context), travellers: wtTravellers_(traveler), workers: tripWorkers_(context, traveler, wtStoredFor_(map, tripKey)) };
  };
}

/** Config work_hours_<name> ("9-18"), 9 to 6 when unset. */
function wtHoursFor_(name) {
  var v = '';
  try { v = (getConfigValues() || {})['work_hours_' + String(name).toLowerCase()]; } catch (e) { v = ''; }
  return wtParseHours_(v);
}

/**
 * The line the packing and day-plan prompts get for a working or business trip, or ''.
 * Working days skip each person's holidays and the PTO on their work calendar when
 * those can be read (PTOStrategy.js ptsPerson_), else weekends only.
 */
function wtPromptLines_(tripKey, start, end) {
  var who;
  try { who = tripPeopleIndex_()(tripKey); } catch (e) { return ''; }
  if (!who || !who.kind || !who.workers.length) return '';
  var lines = [];
  lines.push(who.kind === 'business'
    ? 'This is a BUSINESS TRIP for ' + who.workers.join(' and ') + ': pack work clothes, a laptop and charger, and anything for meetings.'
    : 'This is a WORKING TRIP (working remotely) for ' + who.workers.join(' and ') + ': add a laptop, charger and a simple desk setup to the usual list.');
  who.workers.forEach(function(n) {
    var hol = {}, pto = [];
    try {
      var p = (typeof PTS_PEOPLE_ !== 'undefined' ? PTS_PEOPLE_ : []).filter(function(x) { return x.name === n; })[0];
      if (p && start) { var v = ptsPerson_(p, Number(String(start).slice(0, 4)), Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')); hol = v.holidays || {}; pto = v.booked || []; }
    } catch (e) {}
    var days = wtWorkingDays_(start, end || start, hol, pto), h = wtHoursFor_(n);
    if (days.length) lines.push(n + ' works ' + wtClock_(h.start) + '–' + wtClock_(h.end) + ' on ' + days.join(', ') +
      '. On those days suggest only things before ' + wtClock_(h.start) + ', at lunch, or after ' + wtClock_(h.end) + '; no full-day plans for ' + n + '.');
  });
  return lines.join('\n');
}
