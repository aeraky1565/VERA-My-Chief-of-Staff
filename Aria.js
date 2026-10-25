// ============================================================
// VERA — Aria.js
// ARIA, the travel agent: what VERA reads from it (Travel → ARIA).
// ============================================================
//
// ARIA runs as a scheduled Claude task outside this project. It keeps its own
// sheet, the ARIA Travel Tracker: a Watchlist (one row per trip it watches or
// scouts) and a Fare Log (every fare it has seen). VERA only READS that sheet;
// nothing here writes to it. The sheet's ID lives in the Script Property
// ARIA_SHEET_ID, never in code: this repository is public.
//
// ARIA owns its columns and may add more, so every read goes by header name,
// never by position.
//
// What VERA asks of ARIA goes the other way, through a tab of VERA's own,
// "ARIA Requests" (VERA writes it; ARIA reads it on its morning run). A starred
// option of a shortlisted trip idea can be scouted: ARIA prices its flights
// across the idea's months and logs the cheapest date pairs under the option's
// ID. At most three are scouted at once.
//
// Two layers, so the tests need no Google:
//   aria*_ (pure)   header maps, row cleaning, the gaps, a request from an option
//   web*Aria*_      the sheet reads (cached for ten minutes) and the request writes
// ============================================================

var ARIA_STATUSES_ = ['draft', 'scouting', 'watching', 'booked', 'dropped'];
var ARIA_VERDICTS_ = { 'book now': 'book', 'wait': 'wait', 'skip': 'skip' };
var ARIA_CACHE_KEY_ = 'aria_status_v1';
var ARIA_FARE_DAYS_ = 90;     // Fare Log history sent to the dashboard
var ARIA_FARE_MAX_ = 400;
var ARIA_STALE_DAYS_ = 7;     // a Watching trip with no fare this long is flagged

// Column → field, by header name. Unknown columns are ignored; missing ones read blank.
var ARIA_WATCH_FIELDS_ = {
  tripId: 'Trip ID', label: 'Label', status: 'Watch Status', origins: 'Origin Airports', dests: 'Destination Airports',
  returnFrom: 'Return-From Airports', earliest: 'Earliest Depart', latest: 'Latest Return', flexDays: 'Flex Days',
  ceiling: 'Price Ceiling Per Person', travelers: 'Travelers', bags: 'Bags', maxStops: 'Max Stops', tier: 'Window Tier',
  lastChecked: 'Last Checked', nextCheck: 'Next Check', bestFare: 'Best Fare Seen', bestSource: 'Best Fare Source',
  verdict: 'Verdict', notes: 'Notes', ref: 'Ref', tripKey: 'Trip Key', nightsMin: 'Nights Min', nightsMax: 'Nights Max',
  watchId: 'SlickTrip Watch ID', forecast: 'Expedia Forecast', hotelEstimate: 'Hotel Estimate', dateChange: 'Date Change Flag',
};
var ARIA_FARE_FIELDS_ = {
  dateSeen: 'Date Seen', tripId: 'Trip ID', route: 'Route', depart: 'Depart', ret: 'Return', airline: 'Airline', stops: 'Stops',
  farePP: 'Fare Per Person', fees: 'Est. Fees', total: 'True Total', vsCeiling: 'vs Ceiling', source: 'Source',
  verdict: 'Verdict', link: 'Booking Link', flags: 'Flags',
};
var ARIA_DATE_FIELDS_ = ['earliest', 'latest', 'lastChecked', 'nextCheck', 'dateSeen', 'depart', 'ret'];
var ARIA_MONEY_FIELDS_ = ['ceiling', 'bestFare', 'farePP', 'fees', 'total', 'hotelEstimate'];

// ---- pure ----------------------------------------------------------------------

/** Pure: a header name as a key: case, spaces and punctuation don't matter. */
function ariaKey_(h) { return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, ''); }

/**
 * Pure: a header row → {key: column index}. The first of a repeated header wins.
 * A note in brackets ("Watch Status (Draft/Watching/…)") is not part of the name.
 */
function ariaHeaderMap_(headerRow) {
  var map = {};
  (headerRow || []).forEach(function(h, i) {
    var k = ariaKey_(String(h == null ? '' : h).replace(/\([^)]*\)/g, ''));
    if (k && map[k] == null) map[k] = i;
  });
  return map;
}

/** Pure: a money cell ("$1,234", 1234, "") → a whole number, or null. */
function ariaMoney_(v) {
  if (v === '' || v == null) return null;
  var n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) && String(v).replace(/[^0-9]/g, '') !== '' ? Math.round(n) : null;
}

/** Pure: a date cell, already turned to text by the caller, → 'yyyy-MM-dd' or ''. */
function ariaYmd_(s) {
  var m = String(s == null ? '' : s).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var us = String(s == null ? '' : s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return us ? us[3] + '-' + ('0' + us[1]).slice(-2) + '-' + ('0' + us[2]).slice(-2) : '';
}

/** Pure: an https link, or '' (a cell is data: no javascript:, no plain http). */
function ariaLink_(v) {
  var s = String(v == null ? '' : v).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s.slice(0, 600) : '';
}

/**
 * Pure: one sheet row → a clean record, by header. dateText turns a cell into
 * text first (a Date cell in Apps Script; the tests pass strings).
 */
function ariaCleanRow_(map, row, fields, dateText) {
  var out = {};
  Object.keys(fields).forEach(function(f) {
    var i = map[ariaKey_(fields[f])], v = i == null ? '' : row[i];
    if (ARIA_DATE_FIELDS_.indexOf(f) !== -1) out[f] = ariaYmd_(dateText ? dateText(v) : v);
    else if (ARIA_MONEY_FIELDS_.indexOf(f) !== -1) out[f] = ariaMoney_(v);
    else if (f === 'link') out[f] = ariaLink_(v);
    else out[f] = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, f === 'notes' ? 400 : 160);
  });
  if (fields === ARIA_WATCH_FIELDS_) {
    out.tripId = out.tripId.toUpperCase();
    out.ref = out.ref.toUpperCase();
    var st = out.status.toLowerCase();
    out.status = ARIA_STATUSES_.indexOf(st) !== -1 ? st : (st ? 'other' : 'draft');
    out.verdict = ARIA_VERDICTS_[out.verdict.toLowerCase()] || '';
    out.dateChange = /^(yes|true|y|1|changed)$/i.test(out.dateChange);
    ['travelers', 'nightsMin', 'nightsMax', 'flexDays', 'maxStops'].forEach(function(f) { var n = parseInt(out[f], 10); out[f] = isFinite(n) ? n : null; });
  } else {
    out.tripId = out.tripId.toUpperCase();
    out.verdict = ARIA_VERDICTS_[out.verdict.toLowerCase()] || '';
    out.flags = out.flags.split(/\s*[,;·]\s*/).map(function(x) { return x.trim().toLowerCase(); }).filter(Boolean).slice(0, 6);
  }
  return out;
}

/** Pure: a whole tab (header row first) → clean records; blank rows dropped. */
function ariaReadRows_(values, fields, dateText) {
  if (!values || values.length < 2) return [];
  var map = ariaHeaderMap_(values[0]);
  return values.slice(1).map(function(r) { return ariaCleanRow_(map, r, fields, dateText); })
    .filter(function(o) { return fields === ARIA_FARE_FIELDS_ ? (o.tripId && (o.total != null || o.farePP != null)) : (o.tripId || o.ref || o.label); });
}

/** Pure: label + start date, the way two rows are known to be the same trip. */
function ariaSameTripKey_(label, start) {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + String(start || '');
}

/** Pure: days from a to b ('yyyy-MM-dd'). */
function ariaDays_(a, b) {
  var p = String(a).split('-').map(Number), q = String(b).split('-').map(Number);
  return Math.round((Date.UTC(q[0], q[1] - 1, q[2]) - Date.UTC(p[0], p[1] - 1, p[2])) / 864e5);
}

/**
 * Pure: what needs Ahmed's attention between VERA and ARIA.
 * veraTrips: [{tripId, label, startDate, endDate, drive}] (future trips only)
 * Returns {noRow, draft, incomplete, stale, dateChanged, waiting}: lists of {id, label, why}.
 * - noRow: a VERA trip ARIA has no row for (one per label + start, so a
 *   duplicated calendar hold counts once); trips you drive to don't need one.
 * - incomplete: Watching with no airports or no ceiling: ARIA can't price it.
 * - stale: Watching with no fare in the Fare Log for 7 days.
 * - waiting: an active request ARIA hasn't picked up after 2 days.
 */
function ariaGaps_(veraTrips, watch, fares, requests, today) {
  var has = {}, seen = {};
  (watch || []).forEach(function(w) {
    if (w.tripId) has['id:' + w.tripId] = 1;
    if (w.ref) has['id:' + w.ref] = 1;
    if (w.label && w.earliest) has['lk:' + ariaSameTripKey_(w.label, w.earliest)] = 1;
  });
  var noRow = [];
  (veraTrips || []).forEach(function(t) {
    var k = ariaSameTripKey_(t.label, t.startDate);
    if (seen[k] || t.drive) return; seen[k] = 1;
    if (has['id:' + String(t.tripId || '').toUpperCase()] || has['lk:' + k]) return;
    noRow.push({ id: t.tripId, label: t.label, start: t.startDate, why: 'ARIA has no row for this trip yet' });
  });
  var lastFare = {};
  (fares || []).forEach(function(f) { if (!lastFare[f.tripId] || f.dateSeen > lastFare[f.tripId]) lastFare[f.tripId] = f.dateSeen; });
  var item = function(w, why) { return { id: w.tripId || w.ref, label: w.label, start: w.earliest, why: why }; };
  var live = (watch || []).filter(function(w) { return w.status === 'watching'; });
  var gaps = {
    noRow: noRow,
    draft: (watch || []).filter(function(w) { return w.status === 'draft'; }).map(function(w) { return item(w, 'Still a draft: set it to Watching in the tracker when it’s ready'); }),
    incomplete: live.filter(function(w) { return !w.origins || !w.dests || w.ceiling == null; }).map(function(w) {
      var miss = [!w.origins && 'origin airports', !w.dests && 'destination airports', w.ceiling == null && 'a price ceiling'].filter(Boolean);
      return item(w, 'Missing ' + miss.join(', ') + ': ARIA can’t judge it');
    }),
    stale: live.filter(function(w) {
      if (/too early/i.test(w.tier)) return false;
      var last = lastFare[w.tripId] || lastFare[w.ref];
      return !last || ariaDays_(last, today) >= ARIA_STALE_DAYS_;
    }).map(function(w) { var last = lastFare[w.tripId] || lastFare[w.ref]; return item(w, last ? 'No new fare since ' + last : 'No fare yet'); }),
    dateChanged: (watch || []).filter(function(w) { return w.dateChange && w.status !== 'dropped'; }).map(function(w) { return item(w, 'The dates changed in VERA: check the airports and the window'); }),
    waiting: (requests || []).filter(function(r) {
      return r.status === 'active' && !has['id:' + String(r.ref || '').toUpperCase()] && r.created && ariaDays_(r.created.slice(0, 10), today) >= 2;
    }).map(function(r) { return { id: r.ref, label: r.label, start: r.earliest, why: 'Asked ' + r.created.slice(0, 10) + '; ARIA hasn’t picked it up' }; }),
  };
  gaps.count = Object.keys(gaps).reduce(function(n, k) { return n + gaps[k].length; }, 0);
  return gaps;
}

/** Pure: the Fare Log to send: the last 90 days, newest first, capped. */
function ariaRecentFares_(fares, today) {
  return (fares || []).filter(function(f) { return f.dateSeen && ariaDays_(f.dateSeen, today) <= ARIA_FARE_DAYS_; })
    .sort(function(a, b) { return a.dateSeen < b.dateSeen ? 1 : a.dateSeen > b.dateSeen ? -1 : 0; }).slice(0, ARIA_FARE_MAX_);
}

// ---- the reads -----------------------------------------------------------------

function ariaSheetId_() { return String(PropertiesService.getScriptProperties().getProperty('ARIA_SHEET_ID') || '').trim(); }

function ariaTabValues_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return [];
  return sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
}

/** VERA's future trips, with whether you drive there (TripMeta Outbound Mode). */
function ariaVeraTrips_(today) {
  var drive = {};
  try {
    var tm = getSpreadsheet().getSheetByName(TABS.TRIP_META);
    if (tm && tm.getLastRow() > 1) {
      tm.getRange(2, 1, tm.getLastRow() - 1, TRIP_META_HEADERS.length).getValues().forEach(function(r) {
        if (/^(drive|driving|car|road)/i.test(String(r[7] || '').trim())) drive[String(r[0]).trim()] = 1;
      });
    }
  } catch (e) { Logger.log('aria_status: TripMeta unavailable'); }
  return readTripRegistry_().rows.filter(function(t) { return t.status !== 'archived' && t.endDate && t.endDate >= today; }).map(function(t) {
    var keys = [t.startDate + '|' + t.label].concat(t.aliases || []);
    return { tripId: t.tripId, label: t.label, startDate: t.startDate, endDate: t.endDate, drive: keys.some(function(k) { return drive[k]; }) };
  });
}

/** Trip Ideas options by id, so scouted rows can be shown under their idea. */
function ariaIdeaNames_() {
  var out = {};
  try {
    var ideas = {};
    tiRows_(tiIdeasSheet_(), TRIP_IDEAS_HEADERS.length).forEach(function(r) { ideas[String(r[0]).trim()] = String(r[1] || '').trim(); });
    tiRows_(tiOptionsSheet_(), TRIP_IDEA_OPTIONS_HEADERS.length).forEach(function(r) {
      var id = String(r[0]).trim().toUpperCase();
      if (id) out[id] = { ideaId: String(r[1]).trim(), idea: ideas[String(r[1]).trim()] || '', option: String(r[2] || '').trim() };
    });
  } catch (e) { Logger.log('aria_status: Trip Ideas unavailable'); }
  return out;
}

/**
 * GET aria_status[&refresh=1] → {ok, configured, watchlist, fares, gaps, ideas, read}
 * Not configured: {ok, configured:false}. Can't open the sheet: {ok:false, error}.
 * Cached for ten minutes; refresh=1 reads again.
 */
function webAriaStatus_(p) {
  var id = ariaSheetId_();
  // The requests are VERA's own tab: they show (and ARIA reads them) even before VERA can read ARIA's sheet.
  if (!id) return { ok: true, configured: false, requests: ariaReadRequests_() };
  var cache = CacheService.getScriptCache();
  if (!(p && p.refresh)) { try { var hit = cache.get(ARIA_CACHE_KEY_); if (hit) return JSON.parse(hit); } catch (e) {} }
  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { return { ok: false, configured: true, error: 'VERA couldn’t open the ARIA Travel Tracker. Check ARIA_SHEET_ID, and that the sheet is shared with the account VERA runs as.' }; }
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var dateText = function(v) { return v instanceof Date && !isNaN(v.getTime()) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v; };
  var watch = ariaReadRows_(ariaTabValues_(ss, 'Watchlist'), ARIA_WATCH_FIELDS_, dateText);
  var fares = ariaReadRows_(ariaTabValues_(ss, 'Fare Log'), ARIA_FARE_FIELDS_, dateText);
  var requests = ariaReadRequests_();
  var gaps = ariaGaps_(ariaVeraTrips_(today), watch, fares, requests, today);
  var out = { ok: true, configured: true, today: today, read: new Date().toISOString(), watchlist: watch,
    fares: ariaRecentFares_(fares, today), requests: requests, gaps: gaps, ideas: ariaIdeaNames_() };
  Logger.log('aria_status: ' + watch.length + ' watchlist rows, ' + out.fares.length + ' fares, ' + gaps.count + ' gaps');
  try { cache.put(ARIA_CACHE_KEY_, JSON.stringify(out), 600); } catch (e) {}
  return out;
}

// ---- ARIA Requests (VERA's tab; ARIA reads it) -----------------------------------

var ARIA_SCOUT_CAP_ = 3;
var ARIA_REQUEST_STATUSES_ = ['active', 'withdrawn', 'booked'];

/** Pure: a 3-letter airport code as written, else the place name ("Home" means the home airports). */
function ariaAirport_(s) {
  var t = String(s == null ? '' : s).trim();
  return /^home$/i.test(t) ? '' : /^[A-Za-z]{3}$/.test(t) ? t.toUpperCase() : t.slice(0, 60);
}

/** Pure: the last day of a 'yyyy-MM' month. */
function ariaMonthEnd_(m) {
  var p = m.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1], 0)).toISOString().slice(0, 10);
}

/** Pure: a traveler count from the brief's words ("2 adults", "4"), else null. */
function ariaTravelers_(s) {
  var m = String(s == null ? '' : s).match(/\d+/);
  var n = m ? Number(m[0]) : NaN;
  return n >= 1 && n <= 12 ? n : null;
}

/**
 * Pure: a scout request for one option of a trip idea, or {error} when it can't
 * be scouted. The flights are the option's FLY legs: the first one's end is
 * where to fly to; the last one's start, when it differs, is where to fly home
 * from (an open jaw). The window is the idea's months; the nights the brief's
 * range, else the route's own. The ceiling per person is the option's flights
 * estimate (its high end) shared by the travelers, when both are known.
 */
function ariaRequestFromOption_(idea, option, homeAirports) {
  idea = idea || {}; option = option || {};
  var flights = (option.legs || []).filter(function(l) { return l && l.kind === 'move' && l.mode === 'fly'; });
  if (!flights.length) return { error: 'This option has no flights for ARIA to price.' };
  var months = (idea.months || []).filter(function(m) { return /^\d{4}-\d{2}$/.test(m); }).slice().sort();
  if (!months.length) return { error: 'Pick the months in the brief first: ARIA scouts across them.' };
  var first = flights[0], last = flights[flights.length - 1];
  var out = ariaAirport_(first.from), to = ariaAirport_(first.to);
  var back = flights.length > 1 ? ariaAirport_(last.from) : '';
  if (!to) return { error: 'The first flight needs a destination.' };
  var own = (option.legs || []).reduce(function(n, l) { return n + (l && l.kind === 'stop' ? Number(l.nights) || 0 : 0); }, 0) || null;
  var lo = idea.nightsMin != null ? idea.nightsMin : own, hi = idea.nightsMax != null ? idea.nightsMax : own;
  var travelers = ariaTravelers_(idea.travelers);
  var fl = option.cost && option.cost.flights;
  return {
    kind: 'scout', ref: String(option.id || '').toUpperCase(), tripId: '', tripKey: '',
    label: String((idea.title || 'Trip idea') + ' · ' + (option.name || '')).slice(0, 120),
    origins: out || String(homeAirports || ''), dests: to, returnFrom: back && back !== to ? back : '',
    earliest: months[0] + '-01', latest: ariaMonthEnd_(months[months.length - 1]),
    nightsMin: lo, nightsMax: hi, travelers: travelers, bags: '',
    ceiling: fl && fl.high && travelers ? Math.round(fl.high / travelers) : null,
  };
}

function ariaRequestsSheet_() { return ensureSheet(getSpreadsheet(), TABS.ARIA_REQUESTS, ARIA_REQUESTS_HEADERS); }

/** Pure: a request → its row. */
function ariaRequestToRow_(r) {
  var v = function(x) { return x == null ? '' : x; };
  return [r.id, r.kind, r.ref, v(r.tripId), v(r.tripKey), r.label, v(r.origins), v(r.dests), v(r.returnFrom), r.earliest, r.latest,
    v(r.nightsMin), v(r.nightsMax), v(r.travelers), v(r.bags), v(r.ceiling), r.status, r.created, r.updated];
}

/** Pure: a row → a request. */
function ariaRequestFromRow_(row) {
  var n = function(x) { var k = parseInt(x, 10); return isFinite(k) ? k : null; };
  var d = function(x) { return ariaYmd_(dateCellToIso_(x)); };   // a date written as text comes back a Date cell
  var st = String(row[16] || '').trim().toLowerCase();
  return { id: String(row[0] || '').trim(), kind: String(row[1] || '').trim().toLowerCase(), ref: String(row[2] || '').trim().toUpperCase(),
    tripId: String(row[3] || '').trim(), tripKey: String(row[4] || '').trim(), label: String(row[5] || '').trim(),
    origins: String(row[6] || '').trim(), dests: String(row[7] || '').trim(), returnFrom: String(row[8] || '').trim(),
    earliest: d(row[9]), latest: d(row[10]), nightsMin: n(row[11]), nightsMax: n(row[12]), travelers: n(row[13]),
    bags: String(row[14] || '').trim(), ceiling: ariaMoney_(row[15]),
    status: ARIA_REQUEST_STATUSES_.indexOf(st) !== -1 ? st : 'active', created: String(row[17] || ''), updated: String(row[18] || '') };
}

/** Every request, from VERA's tab ([] when there is none yet). */
function ariaReadRequests_() {
  try {
    var sh = getSpreadsheet().getSheetByName(TABS.ARIA_REQUESTS);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, ARIA_REQUESTS_HEADERS.length).getValues()
      .filter(function(r) { return String(r[0] || '').trim(); }).map(ariaRequestFromRow_);
  } catch (e) { Logger.log('aria: ARIA Requests unavailable'); return []; }
}

/** The idea and the option, or null. */
function ariaIdeaOption_(ideaId, optionId) {
  var idea = tiGetIdea_(ideaId);
  if (!idea) return null;
  var option = tiRows_(tiOptionsSheet_(), TRIP_IDEA_OPTIONS_HEADERS.length).map(tiOptionFromRow_)
    .filter(function(o) { return o.id === optionId && o.ideaId === ideaId; })[0];
  return option ? { idea: idea, option: option } : null;
}

/**
 * POST {action:'aria_request_save', ideaId, optionId} → asks ARIA to scout one
 * option's fares. Only a starred option of a shortlisted idea, and at most three
 * at once. Asking again for the same option refreshes its request (from the
 * option as it is now) rather than adding a second.
 */
function webSaveAriaRequest_(body) {
  var ideaId = String((body && body.ideaId) || '').trim(), optionId = String((body && body.optionId) || '').trim();
  if (!ideaId || !optionId) return { ok: false, error: 'ideaId and optionId required' };
  var io = ariaIdeaOption_(ideaId, optionId);
  if (!io) return { ok: false, error: 'That option no longer exists' };
  if (io.idea.status !== 'shortlisted') return { ok: false, error: 'Shortlist the idea first: ARIA scouts shortlisted ideas only.' };
  if (io.option.flag !== 'star') return { ok: false, error: 'Star this option first: ARIA scouts starred options only.' };
  var req = ariaRequestFromOption_(io.idea, io.option, String(getConfigValues()['home_airports'] || 'IAD, DCA, BWI'));
  if (req.error) return { ok: false, error: req.error };
  return tiLocked_(function() {
    var sh = ariaRequestsSheet_(), now = tiNow_();
    var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, ARIA_REQUESTS_HEADERS.length).getValues() : [];
    var all = rows.map(ariaRequestFromRow_), at = -1;
    all.forEach(function(r, i) { if (r.ref === req.ref && r.kind === 'scout' && at === -1) at = i; });
    var others = all.filter(function(r, i) { return i !== at && r.kind === 'scout' && r.status === 'active'; }).length;
    if (others >= ARIA_SCOUT_CAP_) return { ok: false, error: 'ARIA is already scouting ' + ARIA_SCOUT_CAP_ + ' options. Stop one first.' };
    req.status = 'active'; req.updated = now;
    if (at === -1) { req.id = tiMintId_('REQ-'); req.created = now; sh.appendRow(ariaRequestToRow_(req)); }
    else { req.id = all[at].id; req.created = all[at].created || now; sh.getRange(at + 2, 1, 1, ARIA_REQUESTS_HEADERS.length).setValues([ariaRequestToRow_(req)]); }
    ariaForget_();
    Logger.log('aria_request_save: scout request ' + (at === -1 ? 'added' : 'refreshed'));
    return { ok: true, request: req };
  });
}

/** POST {action:'aria_request_withdraw', ref} → ARIA stops scouting it (its row goes to Dropped). */
function webWithdrawAriaRequest_(body) {
  var ref = String((body && body.ref) || '').trim().toUpperCase();
  if (!ref) return { ok: false, error: 'ref required' };
  return tiLocked_(function() {
    var sh = ariaRequestsSheet_(), now = tiNow_(), n = 0, last = null;
    var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, ARIA_REQUESTS_HEADERS.length).getValues() : [];
    rows.forEach(function(row, i) {
      var r = ariaRequestFromRow_(row);
      if (r.ref !== ref || r.status !== 'active') return;
      r.status = 'withdrawn'; r.updated = now;
      sh.getRange(i + 2, 1, 1, ARIA_REQUESTS_HEADERS.length).setValues([ariaRequestToRow_(r)]); n++; last = r;
    });
    if (!n) return { ok: false, error: 'ARIA isn’t scouting that option' };
    ariaForget_();
    return { ok: true, request: last };
  });
}

/** The next aria_status reads afresh, so a new or withdrawn request shows at once. */
function ariaForget_() { try { CacheService.getScriptCache().remove(ARIA_CACHE_KEY_); } catch (e) {} }
