// ============================================================
// VERA — Aria.js
// ARIA, the travel agent: what VERA reads from it (Travel → ARIA).
// ============================================================
//
// ARIA runs as a scheduled Claude task outside this project. It keeps its own
// sheet, the ARIA Travel Tracker: a Watchlist (one row per trip it watches or
// scouts) and a Fare Log (every fare it has seen). VERA only READS that sheet;
// nothing here writes to it. The sheet's ID is read at run time, from the Script
// Property ARIA_SHEET_ID or else Config's roster_link_aria; never from code: this
// repository is public.
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
  actionNeeded: 'Action Needed', actionType: 'Action Type', actionUrgency: 'Action Urgency', actionKey: 'Action Key',
  actionSince: 'Action Since', bestLink: 'Best Fare Link',
};
// The Run Log: one row per ARIA run.
var ARIA_RUN_FIELDS_ = {
  runTime: 'Run Time', status: 'Status', tripsSynced: 'Trips Synced', rowsPriced: 'Rows Priced', searches: 'Searches Used',
  bookNow: 'Book Now', actions: 'Action Needed', failures: 'Failures', notes: 'Notes', runId: 'Run ID', emailSent: 'Email Sent',
};
// Action types ARIA writes on a Watchlist row (v3.1 contract), with VERA's wording and their default urgency.
var ARIA_ACTIONS_ = {
  BOOK_NOW:          ['✈️ Book now', 'High'],
  UNDER_CEILING:     ['💸 Under your ceiling', 'High'],
  DATE_CHANGED:      ['📅 Trip dates changed', 'Medium'],
  CHECK_FAILED:      ['⚠️ ARIA couldn’t price', 'Medium'],
  STOP_WATCH:        ['🛑 Stop the SlickTrip watch', 'Low'],
  NEEDS_WATCH_SETUP: ['👀 Set up a SlickTrip watch', 'Low'],
  CEILING_NOT_SET:   ['💲 Set a price ceiling', 'Low'],
  NEEDS_AIRPORTS:    ['🛫 Add airports', 'Low'],
};
var ARIA_STALE_HOURS_ = 26;   // ARIA runs daily; a day and two hours without a run means it didn't
var ARIA_FARE_FIELDS_ = {
  dateSeen: 'Date Seen', tripId: 'Trip ID', route: 'Route', depart: 'Depart', ret: 'Return', airline: 'Airline', stops: 'Stops',
  farePP: 'Fare Per Person', fees: 'Est. Fees', total: 'True Total', vsCeiling: 'vs Ceiling', source: 'Source',
  verdict: 'Verdict', link: 'Booking Link', flags: 'Flags',
};
var ARIA_DATE_FIELDS_ = ['earliest', 'latest', 'lastChecked', 'nextCheck', 'dateSeen', 'depart', 'ret', 'actionSince'];
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

/** Pure: a timestamp cell (text or, already turned to text, a Date) → an ISO string, or ''. */
function ariaIso_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  var t = String(v == null ? '' : v).trim(), d = t ? new Date(/^\d{4}-\d{2}-\d{2} \d/.test(t) ? t.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? '' : 'Z') : t) : null;
  return d && !isNaN(d.getTime()) ? d.toISOString() : '';
}

/** Pure: High / Medium / Low, whatever the case; else the action type's own. */
function ariaUrgency_(v, type) {
  var t = String(v == null ? '' : v).trim().toLowerCase();
  if (t === 'high' || t === 'medium' || t === 'low') return t.charAt(0).toUpperCase() + t.slice(1);
  return ARIA_ACTIONS_[type] ? ARIA_ACTIONS_[type][1] : '';
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
    else if (f === 'link' || f === 'bestLink') out[f] = ariaLink_(v);
    else if (f === 'runTime') out[f] = ariaIso_(v);
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
    out.actionType = out.actionType.toUpperCase().replace(/[^A-Z_]/g, '');
    if (!ARIA_ACTIONS_[out.actionType]) out.actionType = '';
    out.actionUrgency = ariaUrgency_(out.actionUrgency, out.actionType);
    out.actionKey = out.actionType ? out.actionKey.replace(/\s+/g, '') : '';
  } else if (fields === ARIA_RUN_FIELDS_) {
    out.status = /^ok$/i.test(out.status) ? 'OK' : /^partial$/i.test(out.status) ? 'Partial' : /^fail/i.test(out.status) ? 'Failed' : out.status;
    ['tripsSynced', 'rowsPriced', 'searches', 'bookNow', 'actions'].forEach(function(f) { var n = parseInt(out[f], 10); out[f] = isFinite(n) ? n : null; });
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
    .filter(function(o) { return fields === ARIA_FARE_FIELDS_ ? (o.tripId && (o.total != null || o.farePP != null)) : fields === ARIA_RUN_FIELDS_ ? !!o.runTime : (o.tripId || o.ref || o.label); });
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
 *   duplicated calendar hold counts once); trips you drive to, and trips already
 *   under way, don't need one.
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
  // A trip an active request already names is covered: ARIA picks it up on its next run.
  (requests || []).forEach(function(r) { if (r.status === 'active' && r.tripId) has['id:' + String(r.tripId).toUpperCase()] = 1; });
  var noRow = [];
  (veraTrips || []).forEach(function(t) {
    var k = ariaSameTripKey_(t.label, t.startDate);
    if (seen[k] || t.drive) return; seen[k] = 1;
    if (t.startDate && t.startDate <= today) return;   // already under way: too late to watch its fares
    if (has['id:' + String(t.tripId || '').toUpperCase()] || has['lk:' + k]) return;
    noRow.push({ id: t.tripId, label: t.label, start: t.startDate, why: 'ARIA has no row for this trip yet' });
  });
  var lastFare = {};
  (fares || []).forEach(function(f) { if (!lastFare[f.tripId] || f.dateSeen > lastFare[f.tripId]) lastFare[f.tripId] = f.dateSeen; });
  var item = function(w, why) { return { id: w.tripId || w.ref, label: w.label, start: w.earliest, why: why }; };
  var live = (watch || []).filter(function(w) { return w.status === 'watching'; });
  var gaps = {
    noRow: noRow,
    draft: (watch || []).filter(function(w) { return w.status === 'draft'; }).map(function(w) { return item(w, w.tripId ? 'Still a draft: use Watch with ARIA on its card below, or set it to Watching in the tracker' : 'Still a draft: set it to Watching in the tracker when it’s ready'); }),
    // Watching rows ARIA can't price or judge: what it says itself (NEEDS_*, CEILING_NOT_SET), else what VERA can see missing.
    incomplete: live.filter(function(w) { return /^(NEEDS_|CEILING_NOT_SET)/.test(w.actionType || '') || !w.origins || !w.dests || w.ceiling == null; }).map(function(w) {
      if (/^(NEEDS_|CEILING_NOT_SET)/.test(w.actionType || '')) return item(w, w.actionNeeded || w.actionType.replace(/_/g, ' ').toLowerCase());
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

/** Pure: the Settings tab (key in column A, value in B) → {key: value}. Section titles have no key match. */
function ariaSettings_(values) {
  var out = {};
  (values || []).forEach(function(r) {
    var k = String(r[0] == null ? '' : r[0]).trim().toLowerCase();
    if (/^[a-z0-9_]+$/.test(k) && out[k] == null) out[k] = r[1] instanceof Date ? r[1].toISOString() : String(r[1] == null ? '' : r[1]).trim();
  });
  return out;
}

/** Pure: "Sent (2 trips)" → sent; "Draft (send failed: …)" or "Failed: …" → failed; "None"/blank → none. */
function ariaEmailState_(text) {
  var t = String(text == null ? '' : text).trim();
  return /^sent/i.test(t) ? 'sent' : /^(draft|failed)/i.test(t) ? 'failed' : 'none';
}

/** Pure: the newest run in the Run Log, or null. */
function ariaLatestRun_(runs) {
  var best = null;
  (runs || []).forEach(function(r) { if (r.runTime && (!best || r.runTime > best.runTime)) best = r; });
  return best;
}

/**
 * Pure: is ARIA running? From Settings (last_run_utc, last_run_status), else the
 * newest Run Log row. level: ok | partial | failed | stale (no run logged, or none in 26 hours).
 */
function ariaRunHealth_(runs, settings, nowIso) {
  var latest = ariaLatestRun_(runs), st = settings || {};
  var last = ariaIso_(st.last_run_utc) || (latest && latest.runTime) || '';
  var status = String(st.last_run_status || (latest && latest.status) || '').trim();
  var said = status;   // last_run_status is "status + short reason"
  status = /^ok\b/i.test(status) ? 'OK' : /^partial/i.test(status) ? 'Partial' : /^fail/i.test(status) ? 'Failed' : status;
  if (!last) return { level: 'stale', lastRun: '', status: '', text: 'ARIA did not run: no run is logged' };
  var hours = (new Date(nowIso).getTime() - new Date(last).getTime()) / 36e5;
  var detail = latest && latest.runTime === last ? [latest.failures, latest.runId].filter(Boolean).join(' · ') : said.replace(/^(ok|partial|failed?)\W*/i, '');
  if (hours > ARIA_STALE_HOURS_) return { level: 'stale', lastRun: last, status: status, hours: Math.round(hours), text: 'ARIA did not run: its last run was ' + Math.round(hours) + ' hours ago' };
  if (status === 'Failed') return { level: 'failed', lastRun: last, status: status, text: 'ARIA’s last run failed' + (detail ? ': ' + detail : '') };
  if (status === 'Partial') return { level: 'partial', lastRun: last, status: status, text: 'ARIA’s last run was partial' + (detail ? ': ' + detail : '') };
  return { level: 'ok', lastRun: last, status: status || 'OK', text: 'ARIA ran ' + last.slice(0, 16).replace('T', ' ') + ' UTC' };
}

/**
 * Pure: did the Book now email go out for this trip? ARIA emails once, on the
 * run that first put the trip at BOOK_NOW, which is the run on its Action Since
 * day. → {state: sent | failed, date, text}, or null when no run that day says.
 */
function ariaEmailFor_(row, runs) {
  if (!row || row.actionType !== 'BOOK_NOW' || !row.actionSince) return null;
  var day = (runs || []).filter(function(r) { return r.runTime && r.runTime.slice(0, 10) === row.actionSince && ariaEmailState_(r.emailSent) !== 'none'; });
  if (!day.length) return null;
  day.sort(function(a, b) { return a.runTime < b.runTime ? 1 : -1; });
  return { state: ariaEmailState_(day[0].emailSent), date: day[0].runTime.slice(0, 10), text: day[0].emailSent };
}

/**
 * Pure: the flags VERA should hold for ARIA, keyed (v3.1 contract):
 *  A) one per Watchlist action: Key = its Action Key ("ARIA|<id>|<type>"); Flag = ARIA's
 *     Action Needed; Reason "<Label> (<from>–<to>): <action>. Verdict …, best $…."; Date = Action Since;
 *  B) one rolling run-health flag, ARIA|RUN_HEALTH, unless the latest run is OK and fresh;
 *  C) ARIA|EMAIL_FAILED|<Run ID> when the latest run's Book now email didn't send.
 * Everything else under "ARIA|" is resolved by the caller (upsertKeyedFlags_).
 */
function ariaWantedFlags_(watch, runs, settings, nowIso) {
  var wanted = {};
  var verdictWords = { book: 'Book now', wait: 'Wait', skip: 'Skip' };
  (watch || []).forEach(function(w) {
    if (!w.actionType) return;
    var id = w.tripId || w.ref;
    var key = /^ARIA\|[^|]+\|[A-Z_]+$/.test(w.actionKey) && w.actionKey.split('|')[2] === w.actionType ? w.actionKey : 'ARIA|' + id + '|' + w.actionType;
    if (/^ARIA\|(RUN_HEALTH|EMAIL_FAILED)/.test(key)) return;
    var said = w.actionNeeded || ARIA_ACTIONS_[w.actionType][0].replace(/^\S+\s/, '');
    wanted[key] = {
      flag: said.slice(0, 200),
      reason: (w.label || id) + (w.earliest ? ' (' + w.earliest + (w.latest ? '–' + w.latest : '') + ')' : '') + ': ' + said + '.'
        + (w.verdict || w.bestFare != null ? ' ' + [w.verdict ? 'Verdict ' + verdictWords[w.verdict] : '', w.bestFare != null ? 'best $' + w.bestFare : ''].filter(Boolean).join(', ') + '.' : ''),
      urgency: w.actionUrgency || ARIA_ACTIONS_[w.actionType][1],
      date: w.actionSince || '',
    };
  });
  var h = ariaRunHealth_(runs, settings, nowIso);
  if (h.level !== 'ok') {
    wanted['ARIA|RUN_HEALTH'] = { flag: h.level === 'stale' ? 'ARIA did not run' : h.level === 'failed' ? 'ARIA run failed' : 'ARIA run partially failed',
      reason: h.text, urgency: h.level === 'partial' ? 'Medium' : 'High' };
  }
  var latest = ariaLatestRun_(runs);
  if (latest && ariaEmailState_(latest.emailSent) === 'failed') {
    wanted['ARIA|EMAIL_FAILED|' + (latest.runId || latest.runTime.slice(0, 16))] = { flag: 'ARIA Book now email did not send', reason: latest.emailSent, urgency: 'Medium' };
  }
  return wanted;
}

/** Pure: the Fare Log to send: the last 90 days, newest first, capped. */
function ariaRecentFares_(fares, today) {
  return (fares || []).filter(function(f) { return f.dateSeen && ariaDays_(f.dateSeen, today) <= ARIA_FARE_DAYS_; })
    .sort(function(a, b) { return a.dateSeen < b.dateSeen ? 1 : a.dateSeen > b.dateSeen ? -1 : 0; }).slice(0, ARIA_FARE_MAX_);
}

// ---- the reads -----------------------------------------------------------------

/**
 * Pure: a Google Sheets id from a link (".../spreadsheets/d/<id>/edit…") or a bare id; else ''.
 */
function ariaSheetIdFrom_(v) {
  var t = String(v == null ? '' : v).trim(), m = t.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : /^[A-Za-z0-9_-]{20,}$/.test(t) ? t : '';
}

/**
 * ARIA's tracker: the Script Property ARIA_SHEET_ID if set, else the link in the
 * Config tab's roster_link_aria row (the one the Home roster already links to).
 * Read at run time; the repo is public, so no id is ever written in code.
 */
function ariaSheetId_() {
  var prop = ariaSheetIdFrom_(PropertiesService.getScriptProperties().getProperty('ARIA_SHEET_ID'));
  if (prop) return prop;
  try { return ariaSheetIdFrom_(getConfigValues()['roster_link_aria']); } catch (e) { return ''; }
}

function ariaTabValues_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return [];
  return sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
}

/** Every tab VERA reads from ARIA's tracker, by name. A missing tab reads empty; `missing` names it. */
function ariaReadTracker_(ss) {
  var tz = Session.getScriptTimeZone();
  var dateText = function(v) { return v instanceof Date && !isNaN(v.getTime()) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v; };
  var missing = ['Watchlist', 'Fare Log', 'Run Log', 'Settings'].filter(function(n) { return !ss.getSheetByName(n); });
  return {
    watch: ariaReadRows_(ariaTabValues_(ss, 'Watchlist'), ARIA_WATCH_FIELDS_, dateText),
    fares: ariaReadRows_(ariaTabValues_(ss, 'Fare Log'), ARIA_FARE_FIELDS_, dateText),
    runs: ariaReadRows_(ariaTabValues_(ss, 'Run Log'), ARIA_RUN_FIELDS_, null),
    settings: ariaSettings_(ariaTabValues_(ss, 'Settings')),
    missing: missing,
  };
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
  catch (e) { return { ok: false, configured: true, error: 'VERA couldn’t open the ARIA Travel Tracker. Check the link in Config → roster_link_aria, and that the sheet is shared with the account VERA runs as.' }; }
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var t = ariaReadTracker_(ss);
  var watch = t.watch, fares = t.fares;
  var requests = ariaReadRequests_();
  var gaps = ariaGaps_(ariaVeraTrips_(today), watch, fares, requests, today);
  var now = new Date().toISOString();
  watch.forEach(function(w) { var e = ariaEmailFor_(w, t.runs); if (e) w.email = e; });
  var out = { ok: true, configured: true, today: today, read: now, watchlist: watch,
    fares: ariaRecentFares_(fares, today), requests: requests, gaps: gaps, ideas: ariaIdeaNames_(),
    health: ariaRunHealth_(t.runs, t.settings, now), runs: t.runs.slice().sort(function(a, b) { return a.runTime < b.runTime ? 1 : -1; }).slice(0, 7) };
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

function ariaRequestsSheet_() { return tiSchema_(ensureSheet(getSpreadsheet(), TABS.ARIA_REQUESTS, ARIA_REQUESTS_HEADERS), ARIA_REQUESTS_HEADERS); }

/**
 * Pure: a request → its row. Status is written as ARIA's contract spells it
 * (Active / Withdrawn / Booked); VERA reads it back in any case.
 */
function ariaRequestToRow_(r) {
  var v = function(x) { return x == null ? '' : x; };
  var st = String(r.status || '').toLowerCase();
  return [r.id, r.kind, r.ref, v(r.tripId), v(r.tripKey), r.label, v(r.origins), v(r.dests), v(r.returnFrom), r.earliest, r.latest,
    v(r.nightsMin), v(r.nightsMax), v(r.travelers), v(r.bags), v(r.ceiling), st ? st.charAt(0).toUpperCase() + st.slice(1) : '', r.created, r.updated, v(r.flexDays)];
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
    status: ARIA_REQUEST_STATUSES_.indexOf(st) !== -1 ? st : 'active', created: String(row[17] || ''), updated: String(row[18] || ''), flexDays: n(row[19]) };
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

/** POST {action:'aria_request_withdraw', ref | tripId} → ARIA stops scouting or watching it (its row goes to Dropped). */
function webWithdrawAriaRequest_(body) {
  var ref = String((body && body.ref) || '').trim().toUpperCase(), tid = String((body && body.tripId) || '').trim().toUpperCase();
  if (!ref && !tid) return { ok: false, error: 'ref or tripId required' };
  return tiLocked_(function() {
    var sh = ariaRequestsSheet_(), now = tiNow_(), n = 0, last = null;
    var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, ARIA_REQUESTS_HEADERS.length).getValues() : [];
    rows.forEach(function(row, i) {
      var r = ariaRequestFromRow_(row);
      if (r.status !== 'active' || !(ref ? r.ref === ref : String(r.tripId).toUpperCase() === tid)) return;
      r.status = 'withdrawn'; r.updated = now;
      sh.getRange(i + 2, 1, 1, ARIA_REQUESTS_HEADERS.length).setValues([ariaRequestToRow_(r)]); n++; last = r;
    });
    if (!n) return { ok: false, error: ref ? 'ARIA isn’t scouting that option' : 'ARIA isn’t watching that trip for you' };
    ariaForget_();
    return { ok: true, request: last };
  });
}

/** The next aria_status reads afresh, so a new or withdrawn request shows at once. */
function ariaForget_() { try { CacheService.getScriptCache().remove(ARIA_CACHE_KEY_); } catch (e) {} }

// ---- ARIA → VERA Flags (v3.1): actions, run health, a Book now email that didn't send ----

var ARIA_FLAG_PREFIX_ = 'ARIA|';
var ARIA_FLAG_EVERY_HOURS_ = 3;    // after the first read of the day, every three hours is enough

/**
 * Syncs VERA's Flags with ARIA's tracker: one flag per Watchlist action (keyed by
 * its Action Key, closed when the key leaves the Watchlist), one rolling run-health
 * flag, and one for a Book now email that didn't send. If the tracker can't be
 * read, only the health flag changes: nothing ARIA raised is closed on a failed read.
 */
function syncAriaFlags_() {
  var id = ariaSheetId_();
  if (!id) return { ok: true, skipped: 'not configured' };
  var flagSheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!flagSheet) return { ok: false, error: 'no Flags tab' };
  var tz = Session.getScriptTimeZone(), dateStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var t = null, why = '';
  try { t = ariaReadTracker_(SpreadsheetApp.openById(id)); } catch (e) { why = 'VERA couldn’t open the ARIA Travel Tracker'; }
  if (t && t.missing.indexOf('Watchlist') !== -1) { why = 'The ARIA Travel Tracker has no Watchlist tab'; t = null; }
  if (!t) {
    upsertKeyedFlags_(flagSheet, 'ARIA|RUN_HEALTH', 'ARIA', { 'ARIA|RUN_HEALTH': { flag: '🧭 VERA can’t read ARIA', reason: why + '. Check the link in Config → roster_link_aria and the sheet’s sharing.', urgency: 'High' } }, dateStr);
    Logger.log('aria flags: tracker unreadable');
    return { ok: false, error: why };
  }
  // ARIA reads VERA's "ARIA Requests" tab only once it exists: make sure it does, with ARIA's headers.
  try { ariaRequestsSheet_(); } catch (e) { Logger.log('aria: ARIA Requests tab not ensured'); }
  var wanted = ariaWantedFlags_(t.watch, t.runs, t.settings, new Date().toISOString());
  var opened = upsertKeyedFlags_(flagSheet, ARIA_FLAG_PREFIX_, 'ARIA', wanted, dateStr);
  try { ariaMarkBooked_(t.watch); } catch (e) { Logger.log('aria booked: check skipped: ' + e.message); }
  ariaForget_();
  Logger.log('aria flags: ' + Object.keys(wanted).length + ' wanted, ' + opened + ' opened');
  return { ok: true, wanted: Object.keys(wanted).length, opened: opened };
}

/**
 * Pure: is it time to sync? ARIA runs at 06:52 ET; VERA reads it from 07:30 local,
 * then every three hours until 22:00. lastIso is the previous sync.
 */
function ariaSyncDue_(now, lastIso) {
  var mins = now.getHours() * 60 + now.getMinutes();
  if (mins < 7 * 60 + 30 || now.getHours() >= 22) return false;
  if (!lastIso) return true;
  var last = new Date(lastIso);
  if (isNaN(last.getTime())) return true;
  var morning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 30);
  return last < morning || (now.getTime() - last.getTime()) >= ARIA_FLAG_EVERY_HOURS_ * 36e5 - 5 * 6e4;
}

/** Called from hourlyCheck: syncs ARIA's flags when due. Never throws. */
function maybeSyncAriaFlags_(now) {
  try {
    if (!ariaSheetId_()) return;
    var props = PropertiesService.getScriptProperties();
    if (!ariaSyncDue_(now || new Date(), props.getProperty('ARIA_FLAGS_SYNCED_AT'))) return;
    props.setProperty('ARIA_FLAGS_SYNCED_AT', new Date().toISOString());
    syncAriaFlags_();
  } catch (e) { Logger.log('aria flags: sync failed: ' + e.message); }
}

/**
 * A settled option's scout request becomes a watch request for the real trip:
 * Kind watch, the Trip ID and Trip Key, the trip's dates. The Ref stays, so ARIA
 * moves its scouting row to the Trip ID and keeps the fares it logged. No scout
 * request (the option was never scouted): nothing to do, ARIA adds the calendar
 * trip as a Draft on its own. Called under tiLinkSettled_'s lock.
 */
function ariaWatchSettled_(optionId, trip) {
  var ref = String(optionId || '').toUpperCase(), sh = ariaRequestsSheet_(), now = tiNow_();
  var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, ARIA_REQUESTS_HEADERS.length).getValues() : [];
  var n = 0;
  rows.forEach(function(row, i) {
    var r = ariaRequestFromRow_(row);
    if (r.ref !== ref || r.kind !== 'scout' || r.status !== 'active') return;
    r.kind = 'watch'; r.tripId = trip.tripId; r.tripKey = trip.startDate + '|' + trip.label;
    r.earliest = trip.startDate; r.latest = trip.endDate; r.updated = now;
    sh.getRange(i + 2, 1, 1, ARIA_REQUESTS_HEADERS.length).setValues([ariaRequestToRow_(r)]); n++;
  });
  if (n) ariaForget_();
  return n;
}

/**
 * A settled trip moved on the calendar: its active watch requests take the new
 * dates and Trip Key. ARIA's own Date Change Flag covers its Watchlist row.
 * Called under tiLinkSettled_'s lock. Returns rows changed.
 */
function ariaFollowTrip_(trip) {
  var id = String(trip.tripId || '').toUpperCase(), sh = ariaRequestsSheet_(), now = tiNow_();
  var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, ARIA_REQUESTS_HEADERS.length).getValues() : [];
  var key = trip.startDate + '|' + trip.label, n = 0;
  rows.forEach(function(row, i) {
    var r = ariaRequestFromRow_(row);
    if (!id || String(r.tripId).toUpperCase() !== id || r.kind !== 'watch' || r.status !== 'active') return;
    if (r.earliest === trip.startDate && r.latest === trip.endDate && r.tripKey === key) return;
    r.earliest = trip.startDate; r.latest = trip.endDate; r.tripKey = key; r.updated = now;
    sh.getRange(i + 2, 1, 1, ARIA_REQUESTS_HEADERS.length).setValues([ariaRequestToRow_(r)]); n++;
  });
  if (n) ariaForget_();
  return n;
}

// ---- One trip: ARIA on My Itinerary's Summary (trip_aria, aria_request_watch) ----------
//
// A calendar trip's Summary shows what ARIA has for it, and asks ARIA to watch its
// flights. VERA fills the request in (decided Oct 25): home airports from Config,
// travelers from TripMeta, the ceiling from Trip Budget's flights line shared by
// the travelers; you check it and send it. ARIA fills only cells still blank in its
// Watchlist, so nothing you typed there is overwritten.

/** Pure: a Trip Budget's flights budget per person, or null. VERA files flights as category "flights". */
function ariaCeilingFrom_(budgetRows, travelers) {
  var total = 0, any = false;
  (budgetRows || []).forEach(function(r) {
    if (String(r.category || '').toLowerCase() !== 'flights') return;
    var b = ariaMoney_(r.budgeted);
    if (b != null && b > 0) { total += b; any = true; }
  });
  return any && travelers > 0 ? Math.round(total / travelers) : null;
}

/** Pure: did the flights out and back happen? A flight on or a day after the start, and on or a day before the end. */
function ariaFlightsBooked_(items, start, end) {
  var day = function(d, n) { var p = d.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); };
  var flights = (items || []).filter(function(it) { return it && it.type === 'flight' && it.date; });
  var out = flights.some(function(f) { return f.date >= start && f.date <= day(start, 1); });
  var back = flights.some(function(f) { return f.date >= day(end, -1) && f.date <= end; });
  return { out: out, back: back, both: out && back };
}

/** The trip's TripMeta travelers (2 when unset) and its Trip Budget rows. */
function ariaTripFacts_(tripKey) {
  var facts = { travelers: 2, budget: [] };
  try { var m = webGetTripMeta_({ parameter: { tripKey: tripKey } }); if (m && m.tripTravellers) facts.travelers = Number(m.tripTravellers) || 2; } catch (e) {}
  try {
    var sh = getSpreadsheet().getSheetByName(TABS.TRIP_BUDGET);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, TRIP_BUDGET_HEADERS.length).getValues().forEach(function(r) {
      if (tripRowMatches_(r[1], tripKeysFor_(tripKey))) facts.budget.push({ category: r[2], label: r[3], budgeted: r[4], actual: r[5] });
    });
  } catch (e) {}
  return facts;
}

/** The settled trip idea for a Trip ID, with its chosen option: {idea, option} or null. */
function ariaPlanFor_(tripId) {
  if (!tripId) return null;
  try {
    var idea = tiRows_(tiIdeasSheet_(), TRIP_IDEAS_HEADERS.length).map(tiIdeaFromRow_).filter(function(i) { return String(i.tripId).toUpperCase() === tripId; })[0];
    if (!idea) return null;
    var oid = idea.chosenOption || (idea.settle && idea.settle.optionId);
    var option = tiRows_(tiOptionsSheet_(), TRIP_IDEA_OPTIONS_HEADERS.length).map(tiOptionFromRow_).filter(function(o) { return o.id === oid; })[0] || null;
    return { idea: { id: idea.id, title: idea.title, budget: idea.budget, settle: idea.settle }, option: option };
  } catch (e) { return null; }
}

/**
 * GET trip_aria?tripId&tripKey&label&startDate&endDate → for one trip:
 * {ok, tripId, configured, row, fares, request, draft, plan}. The Trip ID is
 * resolved from the trip when the dashboard doesn't have it (read only: nothing minted).
 */
function webTripAria_(p) {
  p = p || {};
  var tripKey = String(p.tripKey || '').trim(), start = String(p.startDate || '').trim(), end = String(p.endDate || '').trim();
  var label = String(p.label || tripKey.split('|')[1] || '').trim();
  var tripId = String(p.tripId || '').trim().toUpperCase();
  if (!tripId && label && start) { try { tripId = String(resolveTripId_({ label: label, startDate: start, endDate: end }, { mint: false, touch: false }) || '').toUpperCase(); } catch (e) {} }
  // Opening the trip re-totals what it actually cost, before its Budget is read below (TripActuals.js).
  tripActualsOnView_(tripKey, tripId);
  var st = webAriaStatus_({});
  var configured = !!(st && st.configured && st.ok);
  var reqs = (st && st.requests) || ariaReadRequests_();
  var plan = ariaPlanFor_(tripId);
  var planRef = plan && plan.option ? plan.option.id.toUpperCase() : '';
  var row = configured ? (st.watchlist || []).filter(function(w) { return (tripId && w.tripId === tripId) || (planRef && w.ref === planRef); })[0] || null : null;
  var fares = configured && row ? (st.fares || []).filter(function(f) { return f.tripId === row.tripId || (row.ref && f.tripId === row.ref); }) : [];
  var request = reqs.filter(function(r) { return r.status === 'active' && ((tripId && String(r.tripId).toUpperCase() === tripId) || (planRef && r.ref === planRef)); })[0] || null;
  var facts = ariaTripFacts_(tripKey);
  var firstFly = plan && plan.option ? (plan.option.legs || []).filter(function(l) { return l.kind === 'move' && l.mode === 'fly'; })[0] : null;
  var draft = {
    origins: (row && row.origins) || String(getConfigValues()['home_airports'] || 'IAD, DCA, BWI'),
    dests: (row && row.dests) || (firstFly ? ariaAirport_(firstFly.to) : ''),
    earliest: start, latest: end, flexDays: 1, travelers: (row && row.travelers) || facts.travelers,
    ceiling: (row && row.ceiling) != null ? row.ceiling : ariaCeilingFrom_(facts.budget, (row && row.travelers) || facts.travelers),
  };
  // What has actually been paid, per Trip Budget category (TripActuals.js fills these from confirmations).
  var actuals = {};
  facts.budget.forEach(function(b) { var v = ariaMoney_(b.actual), c = String(b.category || '').toLowerCase(); if (v != null && c) actuals[c] = (actuals[c] || 0) + v; });
  return { ok: true, tripId: tripId, configured: configured, row: row, fares: fares, request: request, draft: draft, plan: plan, actuals: actuals };
}

/**
 * POST {action:'aria_request_watch', tripId, tripKey, label, startDate, endDate,
 * origins, dests, returnFrom, travelers, ceiling, flexDays} → asks ARIA to watch a
 * calendar trip's flights. One watch request per trip: asking again refreshes it.
 */
function webWatchAriaRequest_(body) {
  body = body || {};
  var tripId = String(body.tripId || '').trim().toUpperCase(), tripKey = String(body.tripKey || '').trim();
  var start = ariaYmd_(body.startDate), end = ariaYmd_(body.endDate), dests = String(body.dests || '').trim().slice(0, 60);
  if (!tripId || !start || !end) return { ok: false, error: 'tripId and the trip dates are required' };
  if (!dests) return { ok: false, error: 'Add where you fly to (an airport code like ORD).' };
  var travelers = parseInt(body.travelers, 10), flex = parseInt(body.flexDays, 10), ceiling = ariaMoney_(body.ceiling);
  var req = { kind: 'watch', ref: '', tripId: tripId, tripKey: tripKey, label: String(body.label || tripKey.split('|')[1] || '').trim().slice(0, 120),
    origins: String(body.origins || '').trim().slice(0, 60), dests: dests, returnFrom: ariaAirport_(body.returnFrom),
    earliest: start, latest: end, nightsMin: null, nightsMax: null, travelers: travelers >= 1 && travelers <= 12 ? travelers : null, bags: '',
    ceiling: ceiling != null && ceiling > 0 ? ceiling : null, flexDays: flex >= 0 && flex <= 14 ? flex : null };
  return tiLocked_(function() {
    var sh = ariaRequestsSheet_(), now = tiNow_();
    var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, ARIA_REQUESTS_HEADERS.length).getValues() : [];
    var at = -1;
    rows.map(ariaRequestFromRow_).forEach(function(r, i) { if (at === -1 && r.kind === 'watch' && String(r.tripId).toUpperCase() === tripId) at = i; });
    req.status = 'active'; req.updated = now;
    if (at === -1) { req.id = tiMintId_('REQ-'); req.created = now; sh.appendRow(ariaRequestToRow_(req)); }
    else { var old = ariaRequestFromRow_(rows[at]); req.id = old.id; req.created = old.created || now; req.ref = old.ref; sh.getRange(at + 2, 1, 1, ARIA_REQUESTS_HEADERS.length).setValues([ariaRequestToRow_(req)]); }
    ariaForget_();
    Logger.log('aria_request_watch: watch request ' + (at === -1 ? 'added' : 'refreshed'));
    return { ok: true, request: req };
  });
}

/**
 * VERA says "booked": for each trip ARIA watches (an active watch request, or a
 * Watching row on its Watchlist) whose flights out and back VERA now sees in the
 * itinerary (parsed confirmations with or without a Trip Key, and calendar
 * flights), write Status = Booked on its request, adding one if there is none.
 * ARIA stops pricing it on its next run. Runs from syncAriaFlags_.
 */
function ariaMarkBooked_(watch) {
  var reqs = ariaReadRequests_();
  var reg = readTripRegistry_();
  var targets = {};
  reqs.forEach(function(r) { if (r.status === 'active' && r.kind === 'watch' && r.tripId) targets[String(r.tripId).toUpperCase()] = { req: r }; });
  (watch || []).forEach(function(w) { if (w.status === 'watching' && w.tripId && !targets[w.tripId] && reg.byId[w.tripId]) targets[w.tripId] = { row: w }; });
  var booked = Object.keys(targets).filter(function(id) {
    var t = reg.byId[id];
    if (!t || !t.startDate || !t.endDate) return false;
    try { return ariaFlightsBooked_(tripItemsFor_(t.startDate + '|' + t.label, t.startDate, t.endDate, 'aria booked'), t.startDate, t.endDate).both; } catch (e) { return false; }
  });
  if (!booked.length) return 0;
  return tiLocked_(function() {
    var sh = ariaRequestsSheet_(), now = tiNow_();
    var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, ARIA_REQUESTS_HEADERS.length).getValues() : [];
    booked.forEach(function(id) {
      var t = reg.byId[id], at = -1;
      rows.forEach(function(row, i) { var r = ariaRequestFromRow_(row); if (at === -1 && r.kind === 'watch' && String(r.tripId).toUpperCase() === id) at = i; });
      if (at !== -1) {
        var r = ariaRequestFromRow_(rows[at]); if (r.status === 'booked') return;
        r.status = 'booked'; r.updated = now; sh.getRange(at + 2, 1, 1, ARIA_REQUESTS_HEADERS.length).setValues([ariaRequestToRow_(r)]);
      } else {
        sh.appendRow(ariaRequestToRow_({ id: tiMintId_('REQ-'), kind: 'watch', ref: '', tripId: id, tripKey: t.startDate + '|' + t.label, label: t.label,
          earliest: t.startDate, latest: t.endDate, status: 'booked', created: now, updated: now }));
      }
    });
    ariaForget_();
    Logger.log('aria booked: ' + booked.length + ' trip(s) told to ARIA as booked');
    return booked.length;
  });
}
