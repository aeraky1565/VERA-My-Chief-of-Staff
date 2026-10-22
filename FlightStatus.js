// ============================================================
// VERA — Flight Status Monitor (Issue #66)
// FlightStatus.js — Real-time flight polling via AviationStack
// ============================================================
//
// HOW IT WORKS:
//   1. A 15-minute Apps Script trigger calls checkFlightStatuses_()
//   2. Phase 1: scans Itinerary sheet for flight rows with a flightNum
//   3. Phase 2: scans Google Calendar for flight events (airline code + number in title)
//   4. Only flights due are looked up: from 6h before departure until departure
//      (or, from the dashboard, flights departing today). See checkFlightStatuses_.
//   5. Sheet flights: status stored in col J metadata JSON (flight_status key)
//      Calendar flights: status stored in Script Properties (FLIGHT_STATUS_CACHE)
//   6. The dashboard reads status via ?action=flight_statuses&tripKey=...
//      Both sheet and calendar statuses are merged and returned together.
//
// SETUP:
//   Add Script Property: AVIATIONSTACK_KEY → your AviationStack access key
//   Free tier: 100 req/month (~5-6 flight legs/month)
//   Paid tier: $9.99/mo for 10,000 req/month
//
// POLLING INTERVALS (applied via rate-limiting in metadata):
//   Departure 1–6h away:                  every 60 minutes
//   Departure < 1h away:                  every 15 minutes
//   Departure > 6h away or already gone:  no lookup at all
//   Config flight_status_poll_minutes, when longer, spaces them further.
// ============================================================

// ---- Config -----------------------------------------------------------------

function getAviationStackKey_() {
  return PropertiesService.getScriptProperties().getProperty('AVIATIONSTACK_KEY') || '';
}

// ---- AviationStack 429 backoff (Script Properties) -------------------------
// When the API returns 429, we store a "back off until" timestamp so every
// subsequent trigger run skips all API calls until the window expires.

var AS_BACKOFF_KEY_ = 'AVIATIONSTACK_BACKOFF_UNTIL';

// ---- How often to check a flight (Config flight_status_poll_minutes) ---------
var FLIGHT_POLL_MIN_MINUTES_  = 15;   // the trigger's own cadence: nothing finer is possible
var FLIGHT_POLL_SEEDED_PROP_  = 'FLIGHT_POLL_CONFIG_SEEDED';

/**
 * The configured gap between checks of one flight, in minutes: a whole number, 15 or
 * more. Anything else reads as 15. (This was first named flightPollIntervalMin_ —
 * the name of the built-in cadence below — and in one global scope the later
 * declaration won, so the setting never took effect.)
 */
function flightPollGapMin_(cfg) {
  var n = parseInt(String((cfg || {})['flight_status_poll_minutes'] || '').trim(), 10);
  return isFinite(n) && n >= FLIGHT_POLL_MIN_MINUTES_ ? n : FLIGHT_POLL_MIN_MINUTES_;
}

/** Adds flight_status_poll_minutes = 15 to Config, once, so the settings modal lists it. */
function seedFlightPollConfig_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(FLIGHT_POLL_SEEDED_PROP_)) return 0;
  var sheet = getSpreadsheet().getSheetByName(TABS.CONFIG);
  if (!sheet) return 0;
  var have = false;
  if (sheet.getLastRow() >= 2) {
    have = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().some(function(r) {
      return String(r[0] || '').trim().toLowerCase() === 'flight_status_poll_minutes';
    });
  }
  if (!have) sheet.appendRow(['flight_status_poll_minutes', String(FLIGHT_POLL_MIN_MINUTES_)]);
  props.setProperty(FLIGHT_POLL_SEEDED_PROP_, new Date().toISOString());
  _configCache_ = null;
  return have ? 0 : 1;
}

/**
 * What an aviationstack error actually was, in words — instead of the old catch-all
 * "rate limited / quota exhausted". Pure.
 *
 *   quota       the plan's monthly requests are spent: nothing refreshes until it resets
 *   rate        too many requests in a short window: passes in a couple of hours
 *   key         the access key was rejected or is missing
 *   restricted  the request needs a higher plan than this key has
 *   other       anything else, with the service's own message
 *
 * aviationstack names the cause in its body ({"error":{"code":"usage_limit_reached",…}}),
 * and may send that with HTTP 200, so the body is read whatever the status.
 *
 * @returns {{kind: string, code: string, text: string}|null}  null = not an error
 */
function classifyAviationStackError_(httpCode, body) {
  var err = null;
  try { var j = JSON.parse(String(body || '')); err = j && j.error ? j.error : null; } catch (e) {}
  if (httpCode === 200 && !err) return null;
  var code = String((err && (err.code || err.type)) || '').toLowerCase();
  var msg  = String((err && (err.message || err.info)) || '').replace(/\s+/g, ' ').trim();
  var raw  = String(body || '');
  if (code === 'usage_limit_reached' || /usage_limit|monthly|exceeded/i.test(code + ' ' + raw)) {
    return { kind: 'quota', code: code || 'usage_limit_reached', text: 'monthly quota used up — this plan’s requests for the month are spent' };
  }
  if (code === 'rate_limit_reached' || httpCode === 429) {
    return { kind: 'rate', code: code || 'rate_limit_reached', text: 'too many requests in a short time' };
  }
  if (/invalid_access_key|missing_access_key|inactive_user/.test(code) || httpCode === 401) {
    return { kind: 'key', code: code || 'unauthorized', text: 'the API key was rejected (' + (code || 'HTTP 401') + ') — check the AVIATIONSTACK_KEY Script Property' };
  }
  if (/restricted/.test(code) || httpCode === 403) {
    return { kind: 'restricted', code: code || 'forbidden', text: 'this request isn’t included in the current plan (' + (code || 'HTTP 403') + ')' };
  }
  return { kind: 'other', code: code, text: 'HTTP ' + httpCode + (msg ? ': ' + msg : (code ? ': ' + code : '')) };
}

/** Returns true if we are currently inside a rate-limit backoff window. */
function isAviationStackRateLimited_() {
  var until = parseInt(PropertiesService.getScriptProperties().getProperty(AS_BACKOFF_KEY_) || '0', 10);
  return Date.now() < until;
}

/**
 * Sets a backoff window after receiving a 429.
 * If the response body indicates a monthly quota error, backs off 30 days;
 * otherwise backs off 2 hours to handle per-minute/per-hour limits.
 * @param {string} responseBody  Raw response text from AviationStack
 */
function setAviationStackBackoff_(responseBody) {
  var c = classifyAviationStackError_(429, responseBody);
  var isQuota = !!c && c.kind === 'quota';
  var backoffMs = isQuota ? 30 * 24 * 60 * 60 * 1000   // 30 days — monthly quota
                          :  2 *       60 * 60 * 1000;  //  2 hours — per-rate limit
  var until = Date.now() + backoffMs;
  PropertiesService.getScriptProperties().setProperty(AS_BACKOFF_KEY_, String(until));
  return until;
  Logger.log('FlightStatus: 429 received — ' +
             (isQuota ? 'monthly quota exhausted, backing off 30 days'
                      : 'rate limited, backing off 2 hours') +
             ' (until ' + new Date(until).toISOString() + ')');
  Logger.log('FlightStatus: 429 body: ' + (responseBody || '').substring(0, 300));
}

// ---- Calendar flight status cache (Script Properties) ----------------------

/**
 * Reads the Script Properties cache for calendar-sourced flight statuses.
 * Returns a plain object keyed by CAL-xxx IDs.
 */
function getCalFlightStatusCache_() {
  var raw = PropertiesService.getScriptProperties().getProperty('FLIGHT_STATUS_CACHE') || '{}';
  try { return JSON.parse(raw); } catch(e) { return {}; }
}

/**
 * Writes the updated calendar flight status cache back to Script Properties.
 * @param {Object} cache  Plain object keyed by CAL-xxx IDs
 */
function setCalFlightStatusCache_(cache) {
  PropertiesService.getScriptProperties()
    .setProperty('FLIGHT_STATUS_CACHE', JSON.stringify(cache));
}

// ---- AviationStack API wrapper ----------------------------------------------

/**
 * Fetches live flight status from AviationStack.
 * @param {string} flightIata  e.g. 'AA102'
 * @param {string} flightDate  e.g. '2026-03-15' (YYYY-MM-DD)
 * @returns {Object|null} normalized status object, or null on error
 */
function fetchFlightStatus_(flightIata, flightDate) {
  var key = getAviationStackKey_();
  if (!key) {
    Logger.log('FlightStatus: AVIATIONSTACK_KEY not set in Script Properties');
    recordApiHealth_('aviationstack', false, 'AVIATIONSTACK_KEY not set in Script Properties', 0);
    return null;
  }

  // Note: flight_date is a paid-tier parameter on AviationStack — free tier returns
  // current/upcoming flight data for the IATA code; we filter by date client-side.
  var url = 'http://api.aviationstack.com/v1/flights'
    + '?access_key=' + encodeURIComponent(key)
    + '&flight_iata=' + encodeURIComponent(flightIata.toUpperCase());

  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = resp.getResponseCode();
    var body = resp.getContentText();
    // Read the cause from the body whatever the status: the limit can arrive as an
    // "error" object on a 200, which used to read as "no live data yet" — a success.
    var problem = classifyAviationStackError_(code, body);
    if (problem) {
      Logger.log('FlightStatus: aviationstack ' + problem.kind + ' (' + problem.code + ') for ' + flightIata);
      if (problem.kind === 'quota' || problem.kind === 'rate') {
        var until = setAviationStackBackoff_(body);
        var when = Utilities.formatDate(new Date(until), Session.getScriptTimeZone(),
                                        problem.kind === 'quota' ? 'MMM d' : 'h:mm a');
        if (problem.kind === 'rate') {
          // Passes on its own: the transient 429 path in recordApiHealth_ (a Warning,
          // never a degraded source).
          recordApiHealth_('aviationstack', false, problem.text + ' — flight checks paused until ' + when, 429);
        } else {
          // NOT transient: nothing refreshes for weeks, so this is a real outage and
          // says so, with what to do. Recorded without the 429 code for that reason.
          recordApiHealth_('aviationstack', false, problem.text + ' — flight checks paused until ' + when +
            '. Raise flight_status_poll_minutes, or upgrade the aviationstack plan.', 0);
        }
      } else {
        recordApiHealth_('aviationstack', false, problem.text, code === 200 ? 0 : code);
      }
      return null;
    }
    var json = JSON.parse(body);
    if (!json.data || json.data.length === 0) {
      // NOT an API failure. The free tier only carries current/upcoming flights —
      // see the note above the URL — so a flight booked weeks out legitimately
      // returns an empty set, and the API answered perfectly to say so.
      //
      // Recording this as a failure is what left 'aviationstack (last good data:
      // 10d)' sitting in the morning "SOME DATA IS NOT LIVE" banner while nothing
      // was wrong with the API at all. A banner whose job is to say "do not trust
      // this data" loses its authority the moment it reports things that are fine.
      //
      // Recording a SUCCESS rather than staying silent is deliberate: it is true
      // (HTTP 200, well-formed body), and it actively clears a source already stuck
      // in a degraded state from earlier empty responses.
      //
      // The caller still gets null, so the FLIGHT is correctly treated as having no
      // live status — that is a fact about the flight, not about the API's health,
      // and stampFlightFetchFailure_ goes on marking the shown status unconfirmed.
      Logger.log('FlightStatus: no live data yet for ' + flightIata + ' (expected for a future flight; not an API fault)');
      recordApiHealth_('aviationstack', true, '', code);
      return null;
    }
    // Pick the result whose scheduled departure date matches flightDate (YYYY-MM-DD).
    // If none match exactly (e.g. cross-midnight flight), fall back to the first result.
    var d = json.data[0];
    if (flightDate) {
      for (var di = 0; di < json.data.length; di++) {
        var depDateStr = ((json.data[di].departure || {}).scheduled || '').substring(0, 10);
        if (depDateStr === flightDate) { d = json.data[di]; break; }
      }
    }
    var dep = d.departure || {};
    var arr = d.arrival   || {};

    // Extract HH:MM from ISO datetime string
    function toHHMM(isoStr) {
      if (!isoStr) return null;
      var m = isoStr.match(/T(\d{2}:\d{2})/);
      return m ? m[1] : null;
    }

    recordApiHealth_('aviationstack', true, '', code);

    return {
      status:        d.flight_status  || 'scheduled',
      dep_scheduled: toHHMM(dep.scheduled),
      dep_estimated: toHHMM(dep.estimated),
      dep_actual:    toHHMM(dep.actual),
      arr_scheduled: toHHMM(arr.scheduled),
      arr_estimated: toHHMM(arr.estimated),
      arr_actual:    toHHMM(arr.actual),
      delay_min:     dep.delay || 0,
      gate:          dep.gate     || '',
      terminal:      dep.terminal || '',
      lastChecked:   Date.now(),
    };
  } catch (err) {
    Logger.log('FlightStatus: fetch error for ' + flightIata + ' — ' + err.message);
    recordApiHealth_('aviationstack', false, 'couldn’t reach aviationstack for ' + flightIata + ' (network): ' + err.message, 0);
    return null;
  }
}

// ---- Polling cadence + staleness --------------------------------------------

/**
 * How often a flight should be polled, given how far out departure is.
 * Single source of truth for both the sheet and calendar polling phases,
 * and for the staleness thresholds derived from it.
 *
 * @param {number} minutesUntilDep  Minutes until scheduled departure (may be negative)
 * @returns {number} Required poll interval in minutes
 */
function flightPollIntervalMin_(minutesUntilDep) {
  if (minutesUntilDep > 360) return 180;  // 6–24h away → every 3h
  if (minutesUntilDep > 60)  return 60;   // 1–6h away  → every 60min
  return 15;                              // <1h away   → every 15min
}

/**
 * A status is stale once it is older than twice the interval it should have
 * been refreshed at — i.e. at least one scheduled poll was missed entirely.
 *
 * @param {number} minutesUntilDep  Minutes until scheduled departure
 * @returns {number} Age in minutes past which the status is "Not live"
 */
function flightStaleAfterMin_(minutesUntilDep, gapMin) {
  // With a longer configured gap, a status is not stale until a check at THAT spacing
  // has been missed — or every status would read "Not live" between checks.
  return flightCheckIntervalMin_(minutesUntilDep, gapMin) * 2;
}

/**
 * Stamps a cached flight status with the fact that its last refresh failed.
 *
 * Deliberately leaves lastChecked untouched so the value's age keeps growing
 * honestly — the whole point of Issue #138 is that a status which stopped
 * refreshing must not keep looking current.
 *
 * @param {Object} statusObj  Existing flight_status object (mutated in place)
 * @returns {Object} The same object, stamped
 */
function stampFlightFetchFailure_(statusObj) {
  if (!statusObj) return statusObj;
  var health = getApiHealth_('aviationstack');
  statusObj.fetchFailedAt = Date.now();
  statusObj.fetchError    = health.lastError || 'refresh failed';
  return statusObj;
}

// ---- Sheet update helper ----------------------------------------------------

/**
 * Writes updated metadata JSON back to col 10 (Metadata) of the Itinerary sheet.
 * @param {Sheet}  sheet       The Itinerary sheet
 * @param {number} rowIndex    1-based row index
 * @param {string} metaJson    JSON string to write
 */
function updateFlightStatusInSheet_(sheet, rowIndex, metaJson) {
  sheet.getRange(rowIndex, 10).setValue(metaJson);
}

// ---- Main polling function (called by 15-min trigger) ----------------------

/**
 * Looks up flights — and only flights that are due. Nothing else touches the API.
 *
 * WHICH FLIGHTS, FROM A LIST. The flights for the next two weeks — Itinerary rows AND
 * calendar events — are listed by refreshFlightDays_ (at most every 6 hours, a few
 * calendar reads). A run with no flight due returns before reading the sheet or the
 * calendar again. The old version stopped as soon as the Itinerary tab had no flight
 * rows, so a trip whose flights live only on the calendar (Chicago, Oct 21) was never
 * polled on schedule at all.
 *
 * WHEN A FLIGHT IS DUE.
 *   scheduled  from 6 hours before departure until departure, at most every
 *              flightCheckIntervalMin_ (the built-in spacing, or the Config gap
 *              flight_status_poll_minutes if that is longer)
 *   forced     (the dashboard, or its ↺) only a flight departing TODAY. Opening the
 *              dashboard used to force a lookup of every flight on the trip, days
 *              out; the free plan has no data that far ahead, so the cache stayed
 *              empty and every visit forced again. That is what spent the quota.
 *
 * @param {boolean} [forceRefresh]   On-demand refresh: today's flights, ignoring spacing
 * @param {string}  [targetTripKey]  If set, only flights on this trip
 */
function checkFlightStatuses_(forceRefresh, targetTripKey) {
  var _fsStart = Date.now();
  var checked = 0, skipped = 0, errors = 0;
  try {
  // Short-circuit if we received a 429 recently — don't waste requests
  if (!forceRefresh && isAviationStackRateLimited_()) {
    var until = parseInt(PropertiesService.getScriptProperties().getProperty(AS_BACKOFF_KEY_) || '0', 10);
    Logger.log('FlightStatus: skipping — rate-limit backoff active until ' + new Date(until).toISOString());
    // Issue #138: a backoff window is precisely when every status silently goes
    // stale, so the staleness check matters more here than on the normal path.
    checkStaleFlightStatus_();
    return { polled: 0, skipped: 0, errors: 0 };
  }

  var now   = Date.now();
  var tz    = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(now), tz, 'yyyy-MM-dd');
  var gap   = flightPollGapMin_(getConfigValues());
  // A forced refresh accepts a list up to an hour old, so a flight added this morning
  // is picked up when you look; the trigger accepts six.
  var list  = refreshFlightDays_(forceRefresh ? 60 * 60000 : FLIGHT_DAYS_MAX_AGE_MS_);

  var due = list.flights.filter(function(f) {
    // An unkeyed calendar flight goes with the trip asking, as it always has.
    if (targetTripKey && f.tripKey && f.tripKey !== targetTripKey) return false;
    return flightDueForCheck_((f.dep - now) / 60000, !!forceRefresh, f.date, today);
  });
  skipped = list.flights.length - due.length;
  if (!due.length) {
    Logger.log('FlightStatus: no flight due (' + list.flights.length + ' listed) — no lookup.');
    if (!forceRefresh) checkStaleFlightStatus_();
    return { polled: 0, skipped: skipped, errors: 0 };
  }

  // ---- Itinerary-sheet flights: status lives in the row's metadata ----------
  var sheetDue = due.filter(function(f) { return f.src === 'sheet'; });
  if (sheetDue.length) {
    var sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
    var rows  = sheet ? sheet.getDataRange().getValues() : [];
    sheetDue.forEach(function(f) {
      var i = -1;
      for (var r = 1; r < rows.length; r++) if (String(rows[r][0] || '') === f.id) { i = r; break; }
      if (i === -1) { skipped++; return; }
      var meta = {};
      try { meta = JSON.parse(String(rows[i][9] || '{}') || '{}'); } catch (e) { meta = {}; }
      var prev = meta.flight_status || {};
      var mins = (f.dep - now) / 60000;
      if (!forceRefresh && (prev.status === 'landed' || prev.status === 'cancelled')) { skipped++; return; }
      if (!forceRefresh && (now - (prev.lastChecked || 0)) < flightCheckIntervalMin_(mins, gap) * 60000) { skipped++; return; }

      Logger.log('FlightStatus: checking ' + f.num + ' on ' + f.date + ' (row ' + (i + 1) + ')');
      var statusObj = fetchFlightStatus_(f.num, f.date);
      if (!statusObj) {
        errors++;
        // Issue #138: the refresh failed but a previous status is still cached.
        // Stamp it so downstream renders "Not live" instead of the stale value.
        if (meta.flight_status) {
          stampFlightFetchFailure_(meta.flight_status);
          try { updateFlightStatusInSheet_(sheet, i + 1, JSON.stringify(meta)); }
          catch (stampErr) { Logger.log('FlightStatus: could not stamp stale status on row ' + (i + 1) + ' — ' + stampErr.message); }
        }
        return;
      }
      meta.flight_status = statusObj;
      try {
        updateFlightStatusInSheet_(sheet, i + 1, JSON.stringify(meta));
        checked++;
      } catch (writeErr) {
        Logger.log('FlightStatus: write error for row ' + (i + 1) + ' — ' + writeErr.message);
        errors++;
      }
    });
  }

  // ---- Calendar flights: status lives in the Script Properties cache --------
  var calDue = due.filter(function(f) { return f.src === 'calendar'; });
  if (calDue.length) {
    var calCache = getCalFlightStatusCache_();
    calDue.forEach(function(f) {
      var entry = calCache[f.calId] || {};
      var prev  = entry.status || {};
      var mins  = (f.dep - now) / 60000;
      if (!forceRefresh && (prev.status === 'landed' || prev.status === 'cancelled')) { skipped++; return; }
      if (!forceRefresh && (now - (prev.lastChecked || 0)) < flightCheckIntervalMin_(mins, gap) * 60000) { skipped++; return; }

      Logger.log('FlightStatus: checking calendar flight ' + f.num + ' on ' + f.date + ' (' + f.calId + ')');
      var statusObj = fetchFlightStatus_(f.num, f.date);
      if (!statusObj) {
        errors++;
        // Issue #138: stamp the cached calendar status so it stops reading as live.
        if (entry.status) { stampFlightFetchFailure_(entry.status); calCache[f.calId] = entry; }
        return;
      }
      // `date` is stored so checkStaleFlightStatus_() can reconstruct the
      // departure time without re-scanning every calendar.
      calCache[f.calId] = { tripKey: f.tripKey || entry.tripKey || targetTripKey || '', flightNum: f.num,
                            date: f.date, time: f.time, status: statusObj };
      checked++;
    });
    setCalFlightStatusCache_(calCache);
  }

  // Issue #138: alert on anything that is departing soon but no longer refreshing.
  // Skipped on force-refresh — the user is looking at the dashboard and will see
  // the badge, so a push notification would just be noise.
  if (!forceRefresh) checkStaleFlightStatus_();

  Logger.log('FlightStatus: done. checked=' + checked + ' skipped=' + skipped + ' errors=' + errors);
  // Logged only when something was looked up: a no-op run every 15 minutes is the
  // heartbeat's business, not the System Log's.
  if (checked || errors) {
    veraLog_('checkFlightStatuses', 'Travel', errors ? 'Partial' : 'Success',
      'checked=' + checked + ' skipped=' + skipped + (errors ? ' errors=' + errors : ''), Date.now() - _fsStart);
  }
  return { polled: checked, skipped: skipped, errors: errors };
  } catch (err) {
    Logger.log('checkFlightStatuses_ FATAL: ' + err.message + '\n' + (err.stack || ''));
    veraLog_('checkFlightStatuses', 'Travel', 'Failed', '', Date.now() - _fsStart, err.message);
  } finally {
    // Runs every 15 minutes and no-ops with no flights booked — which is most of
    // the time. The heartbeat records that the trigger fired, not that it found
    // anything, so an empty travel calendar never reads as a dead poller.
    try { recordHeartbeat_('checkFlightStatuses_'); } catch (hbErr) {}
    try { flushSystemLog_(); } catch (flErr) {}
  }
}

// ---- Which flights exist, and which are due ---------------------------------

var FLIGHT_WINDOW_MIN_      = 360;              // checks start 6 hours before departure
var FLIGHT_DAYS_PROP_       = 'FLIGHT_DAYS';
var FLIGHT_DAYS_MAX_AGE_MS_ = 6 * 60 * 60000;   // the list is rebuilt at most this often
var FLIGHT_DAYS_AHEAD_      = 14;

/**
 * Whether a flight should be looked up now. Pure.
 *   scheduled  0–360 minutes before departure — the flight's own day, from 6 hours out
 *   forced     departing today, whatever the time (the dashboard's ↺ and its first load)
 */
function flightDueForCheck_(minutesUntilDep, forced, depDate, today) {
  if (forced) return depDate === today;
  return minutesUntilDep >= 0 && minutesUntilDep <= FLIGHT_WINDOW_MIN_;
}

/** The spacing between checks of one flight: the built-in cadence, or the Config gap if longer. */
function flightCheckIntervalMin_(minutesUntilDep, gapMin) {
  return Math.max(flightPollIntervalMin_(minutesUntilDep), gapMin || 0);
}

/**
 * Every flight in the window, from the Itinerary rows and the calendar events
 * given. Pure — the reading is refreshFlightDays_'s.
 *
 * @param {Array<Array>} sheetRows   Itinerary getValues(), header row first
 * @param {Array<Object>} calEvents  { id, title, location, start (ms), allDay }
 * @param {Array<Object>} [trips]    { tripKey, startDate, endDate } — a calendar flight takes
 *                                   the trip whose dates hold it, else the sheet's trip that day
 * @returns {Array<Object>} { src, id|calId, num, date, time, dep, tripKey }
 */
function buildFlightDays_(sheetRows, calEvents, tz, nowMs, trips) {
  var from = nowMs - 24 * 60 * 60000, to = nowMs + FLIGHT_DAYS_AHEAD_ * 24 * 60 * 60000;
  var asDate = function(v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v || '').trim(); };
  var asTime = function(v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'HH:mm') : String(v || '').trim(); };
  var dateToTripKey = {}, out = [];
  (sheetRows || []).slice(1).forEach(function(r) {
    var d = asDate(r[4]), k = String(r[1] || '').trim();
    if (d && k && !dateToTripKey[d]) dateToTripKey[d] = k;
  });
  (sheetRows || []).slice(1).forEach(function(r) {
    if (String(r[2] || '').trim() !== 'flight') return;
    var num = flightKeyFor_({ type: 'flight', title: String(r[3] || ''), metadata: String(r[9] || '') });
    var date = asDate(r[4]), time = asTime(r[5]);
    var dep = new Date(date + 'T' + (time || '00:00') + ':00').getTime();
    if (!num || !date || isNaN(dep) || dep < from || dep > to) return;
    out.push({ src: 'sheet', id: String(r[0] || ''), num: num, date: date, time: time, dep: dep,
               tripKey: String(r[1] || '').trim() });
  });
  (calEvents || []).forEach(function(ev) {
    var rel = isItineraryCalendarRelevant_(ev.title || '', ev.location || '', '');
    if (!rel.include || rel.type !== 'flight') return;
    var num = flightKeyFor_({ type: 'flight', title: ev.title || '' });
    if (!num || ev.start < from || ev.start > to) return;
    var date = Utilities.formatDate(new Date(ev.start), tz, 'yyyy-MM-dd');
    var time = ev.allDay ? '00:00' : Utilities.formatDate(new Date(ev.start), tz, 'HH:mm');
    var trip = (trips || []).filter(function(t) { return t.startDate <= date && date <= t.endDate; })[0];
    // The IDENTICAL formula webGetItinerary_() uses, so the dashboard finds the status.
    out.push({ src: 'calendar', calId: 'CAL-' + String(ev.id).replace(/[^a-z0-9]/gi, '').substring(0, 16),
               num: num, date: date, time: time, dep: ev.start,
               tripKey: (trip && trip.tripKey) || dateToTripKey[date] || '' });
  });
  out.sort(function(a, b) { return a.dep - b.dep; });
  return out;
}

/**
 * The flight list, rebuilt when older than maxAgeMs: one read of the Itinerary tab
 * and of the calendars over the next two weeks. Kept in a Script Property so the
 * 15-minute trigger can decide in one read that there is nothing to do.
 */
function refreshFlightDays_(maxAgeMs) {
  var props = PropertiesService.getScriptProperties();
  var saved = null;
  try { saved = JSON.parse(props.getProperty(FLIGHT_DAYS_PROP_) || 'null'); } catch (e) {}
  if (saved && saved.flights && Date.now() - (saved.at || 0) < maxAgeMs) return saved;

  var now = Date.now(), tz = Session.getScriptTimeZone();
  var sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
  var rows = sheet ? sheet.getDataRange().getValues() : [];
  var events = [];
  var from = new Date(now - 24 * 60 * 60000), to = new Date(now + FLIGHT_DAYS_AHEAD_ * 24 * 60 * 60000);
  CalendarApp.getAllCalendars().forEach(function(cal) {
    try {
      cal.getEvents(from, to).forEach(function(ev) {
        events.push({ id: ev.getId(), title: ev.getTitle() || '', location: ev.getLocation() || '',
                      start: ev.getStartTime().getTime(), allDay: ev.isAllDayEvent() });
      });
    } catch (calErr) { Logger.log('refreshFlightDays_: calendar read failed — ' + calErr.message); }
  });
  var list = { at: now, flights: buildFlightDays_(rows, events, tz, now, getUpcomingTripsForLegs_()) };   // TravelLegs.js
  try { props.setProperty(FLIGHT_DAYS_PROP_, JSON.stringify(list)); } catch (e) {}
  Logger.log('refreshFlightDays_: ' + list.flights.length + ' flight(s) in the next ' + FLIGHT_DAYS_AHEAD_ + ' days.');
  return list;
}

// ---- Travel-day staleness alert (Issue #138) --------------------------------

/**
 * Actively alerts when a flight is departing soon and its status has stopped
 * refreshing. A badge on the dashboard is easy to miss when you are already at
 * the airport, so this pushes a Slack notification and writes a flag.
 *
 * Runs on the same 15-minute trigger as checkFlightStatuses_().
 *
 * Repeat suppression comes free from writeFlags() — it fingerprint-dedups
 * against every flag ever written, so the key flight_status_stale_<num>_<date>
 * can only produce one alert per flight per date.
 *
 * @param {number} [withinHours]  Departure horizon to alert on (default 6)
 * @returns {Object} { checked, alerted }
 */
function checkStaleFlightStatus_(withinHours) {
  var horizonH = withinHours || 6;
  var now      = Date.now();
  var gapMin   = flightPollGapMin_(getConfigValues());
  var tz       = Session.getScriptTimeZone();
  var checked  = 0;
  var alerted  = 0;

  /**
   * Evaluates one flight and raises an alert if its status is not live.
   * @param {string} flightNum  e.g. 'UA1140'
   * @param {string} date       yyyy-MM-dd
   * @param {number} depMs      Scheduled departure epoch ms
   * @param {Object} statusObj  Cached flight_status, may be null
   */
  function evaluate(flightNum, date, depMs, statusObj) {
    if (isNaN(depMs)) return;
    var minsUntilDep = (depMs - now) / 60000;

    // Only flights still ahead of us, inside the alert horizon
    if (minsUntilDep < 0 || minsUntilDep > horizonH * 60) return;

    // Terminal states are final — a landed or cancelled flight cannot go stale
    var s = (statusObj || {}).status;
    if (s === 'landed' || s === 'cancelled') return;

    checked++;

    var staleAfter = flightStaleAfterMin_(minsUntilDep, gapMin);
    var fresh      = freshnessOf_((statusObj || {}).lastChecked, staleAfter);
    if (fresh.state !== 'stale') return;

    var depTime  = Utilities.formatDate(new Date(depMs), tz, 'h:mm a');
    var hoursOut = Math.round(minsUntilDep / 6) / 10;   // one decimal place
    var health   = getApiHealth_('aviationstack');
    var why      = health.lastError || (statusObj ? 'status stopped refreshing' : 'no status ever retrieved');

    var shownAs = statusObj && statusObj.status
      ? 'Last known status was "' + statusObj.status + '"' +
        (statusObj.delay_min ? ' (' + statusObj.delay_min + 'min delay)' : '') +
        ', from ' + fresh.ageText + ' ago. Treat it as unconfirmed.'
      : 'No live status has been retrieved for this flight at all.';

    var flagKey  = 'flight_status_stale_' + flightNum + '_' + date;
    var flagText = 'Flight status NOT LIVE for ' + flightNum + ' departing ' + depTime;
    var reason   = shownAs + ' Reason: ' + why +
                   ' Check with the airline directly before relying on this.';

    // This runs every 15 minutes for as long as the flight stays stale, so both
    // the push and the flag must be gated on the SAME fingerprint writeFlags
    // uses. Without this the flag would dedup correctly but the Slack push would
    // repeat for hours.
    try {
      var flagSheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
      if (flagSheet && getExistingFlagFingerprints_(flagSheet)
                         .has(makeFlagFingerprint_('Travel', flagText, flagKey))) {
        return;   // already alerted for this flight on this date
      }
    } catch (dedupErr) {
      Logger.log('checkStaleFlightStatus_: dedup check failed — ' + dedupErr.message);
    }

    // Push now — a flag alone would not surface until the next morning email
    try {
      sendSlackNotification_(
        '⚠️ *Flight status not live* — ' + flightNum + ' departs ' + depTime +
        ' (' + hoursOut + 'h)\n' + shownAs + '\n_' + why + '_',
        null,
        'High'
      );
    } catch (slackErr) {
      Logger.log('checkStaleFlightStatus_: Slack notify failed — ' + slackErr.message);
    }

    try {
      writeFlags([{
        source:  'Travel',
        flag:    flagText,
        reason:  reason,
        urgency: 'High',
        key:     flagKey,
      }]);
      alerted++;
    } catch (flagErr) {
      Logger.log('checkStaleFlightStatus_: writeFlags failed — ' + flagErr.message);
    }
  }

  try {
    // ---- Sheet-sourced flights ----
    var sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
    if (sheet) {
      var rows = sheet.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][2] || '').trim() !== 'flight') continue;

        var dateRaw = rows[i][4];
        var date    = (dateRaw instanceof Date)
          ? Utilities.formatDate(dateRaw, tz, 'yyyy-MM-dd')
          : String(dateRaw || '').trim();

        var timeRaw   = rows[i][5];
        var startTime = (timeRaw instanceof Date)
          ? Utilities.formatDate(timeRaw, tz, 'HH:mm')
          : String(timeRaw || '').trim();

        if (!date) continue;

        var meta = {};
        try { meta = JSON.parse(String(rows[i][9] || '{}') || '{}'); } catch (e) { meta = {}; }

        var flightNum = flightKeyFor_({
          type: 'flight', title: String(rows[i][3] || ''), metadata: String(rows[i][9] || ''),
        });
        if (!flightNum) continue;

        evaluate(flightNum, date,
                 new Date(date + 'T' + (startTime || '00:00') + ':00').getTime(),
                 meta.flight_status);
      }
    }

    // ---- Calendar-sourced flights ----
    var calCache = getCalFlightStatusCache_();
    Object.keys(calCache).forEach(function(calId) {
      var entry = calCache[calId];
      if (!entry || !entry.status || !entry.flightNum) return;
      var st      = entry.status;
      var depDate = entry.date || '';
      // Prefer the stored calendar time; fall back to the scheduled departure
      // from the API payload for cache entries written before `date`/`time`
      // were persisted.
      var depTime = entry.time || st.dep_scheduled || '';
      if (!depDate || !depTime) return;
      evaluate(entry.flightNum, depDate,
               new Date(depDate + 'T' + depTime + ':00').getTime(),
               st);
    });

    Logger.log('checkStaleFlightStatus_: evaluated ' + checked + ' upcoming flight(s), ' +
               alerted + ' alert(s) raised.');
  } catch (e) {
    Logger.log('checkStaleFlightStatus_ error: ' + e.message + '\n' + (e.stack || ''));
  }

  return { checked: checked, alerted: alerted };
}

// ---- Standalone debug function (run manually from Apps Script editor) -------

/**
 * Diagnostic tool — run this from the Apps Script editor (select function name,
 * click Run, then read the Execution Log at the bottom of the screen).
 *
 * Reports:
 *   1. Whether AVIATIONSTACK_KEY is set
 *   2. Current contents of FLIGHT_STATUS_CACHE
 *   3. Every calendar event in a 72-hour window with classification + flight-number parse
 *   4. Every flight row in the Itinerary sheet
 */
function debugFlightStatusScan() {
  var tz  = Session.getScriptTimeZone();
  var now = Date.now();

  Logger.log('=== VERA Flight Status Debug ===');
  Logger.log('Time: ' + Utilities.formatDate(new Date(now), tz, 'yyyy-MM-dd HH:mm:ss z'));

  // 1. AviationStack key
  var key = getAviationStackKey_();
  Logger.log('');
  Logger.log('--- AviationStack Key ---');
  Logger.log(key ? 'SET: ' + key.substring(0, 4) + '...' : 'MISSING — add AVIATIONSTACK_KEY to Script Properties');

  // 2. FLIGHT_STATUS_CACHE
  var cache     = getCalFlightStatusCache_();
  var cacheKeys = Object.keys(cache);
  Logger.log('');
  Logger.log('--- FLIGHT_STATUS_CACHE (' + cacheKeys.length + ' entries) ---');
  if (cacheKeys.length === 0) {
    Logger.log('(empty — force-refresh from dashboard will populate this)');
  } else {
    for (var k = 0; k < cacheKeys.length; k++) {
      var ck = cacheKeys[k];
      var ce = cache[ck] || {};
      Logger.log(ck + ' → tripKey="' + ce.tripKey + '" flight=' + ce.flightNum
        + ' status=' + (ce.status && ce.status.status || 'n/a'));
    }
  }

  // 3. Calendar scan — 24h back to 48h ahead (same as force-refresh window)
  var scanStart = new Date(now - 24 * 60 * 60000);
  var scanEnd   = new Date(now + 48 * 60 * 60000);
  Logger.log('');
  Logger.log('--- Calendar Scan ---');
  Logger.log('Window: ' + Utilities.formatDate(scanStart, tz, 'MM/dd HH:mm')
    + ' → ' + Utilities.formatDate(scanEnd, tz, 'MM/dd HH:mm'));

  var allCals = CalendarApp.getAllCalendars();
  Logger.log('Calendars: ' + allCals.length);

  for (var ci = 0; ci < allCals.length; ci++) {
    var cal = allCals[ci];
    var evs = cal.getEvents(scanStart, scanEnd);
    Logger.log('  [' + cal.getName() + '] ' + evs.length + ' event(s)');
    for (var ei = 0; ei < evs.length; ei++) {
      var ev      = evs[ei];
      var title   = (ev.getTitle()    || '').trim();
      var loc     = (ev.getLocation() || '').trim();
      var startFmt = Utilities.formatDate(ev.getStartTime(), tz, 'MM/dd HH:mm');
      var relevance = isItineraryCalendarRelevant_(title, loc, '');
      var flightNum = flightKeyFor_({ type: 'flight', title: title }) || '(none)';
      Logger.log('    ' + startFmt + ' | "' + title + '"'
        + ' | flight=' + (relevance.include && relevance.type === 'flight')
        + ' | iata=' + flightNum
        + (loc ? ' | loc="' + loc + '"' : ''));
    }
  }

  // 4. Itinerary sheet flight rows
  Logger.log('');
  Logger.log('--- Itinerary Sheet Flight Rows ---');
  try {
    var sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
    if (!sheet) {
      Logger.log('Sheet not found');
    } else {
      var rows    = sheet.getDataRange().getValues();
      var found   = 0;
      for (var ri = 1; ri < rows.length; ri++) {
        if (String(rows[ri][2] || '').trim() !== 'flight') continue;
        Logger.log('  id=' + rows[ri][0] + ' trip="' + rows[ri][1] + '" date=' + rows[ri][4] + ' title="' + rows[ri][3] + '"');
        found++;
      }
      if (found === 0) Logger.log('  (none — flights are calendar-only for this trip)');
    }
  } catch(sheetErr) {
    Logger.log('Sheet error: ' + sheetErr.message);
  }

  // 5. Live AviationStack test — call the API for any found flight events
  Logger.log('');
  Logger.log('--- AviationStack Live Test ---');
  var tested = 0;
  for (var ci2 = 0; ci2 < allCals.length; ci2++) {
    var evs2 = allCals[ci2].getEvents(scanStart, scanEnd);
    for (var ei2 = 0; ei2 < evs2.length; ei2++) {
      var ev2    = evs2[ei2];
      var title2 = (ev2.getTitle() || '').trim();
      var loc2   = (ev2.getLocation() || '').trim();
      var rel2   = isItineraryCalendarRelevant_(title2, loc2, '');
      if (!rel2.include || rel2.type !== 'flight') continue;
      var testFlight = flightKeyFor_({ type: 'flight', title: title2 });
      if (!testFlight) continue;
      var testDate   = Utilities.formatDate(ev2.getStartTime(), tz, 'yyyy-MM-dd');
      Logger.log('Calling AviationStack for ' + testFlight + ' on ' + testDate + '...');
      var apiResult = fetchFlightStatus_(testFlight, testDate);
      if (apiResult) {
        Logger.log('SUCCESS: status=' + apiResult.status
          + ' dep_sched=' + apiResult.dep_scheduled
          + ' gate=' + apiResult.gate
          + ' terminal=' + apiResult.terminal
          + ' delay=' + apiResult.delay_min + 'min');
      } else {
        // Also fetch raw response to see the error
        var rawKey = getAviationStackKey_();
        var rawUrl = 'http://api.aviationstack.com/v1/flights'
          + '?access_key=' + encodeURIComponent(rawKey)
          + '&flight_iata=' + encodeURIComponent(testFlight);
        Logger.log('fetchFlightStatus_ returned null. Fetching raw response...');
        try {
          var rawResp = UrlFetchApp.fetch(rawUrl, { muteHttpExceptions: true });
          Logger.log('HTTP ' + rawResp.getResponseCode() + ': ' + rawResp.getContentText().substring(0, 500));
        } catch(rawErr) {
          Logger.log('Raw fetch error: ' + rawErr.message);
        }
      }
      tested++;
    }
  }
  if (tested === 0) Logger.log('No flight events found to test');

  Logger.log('');
  Logger.log('=== END DEBUG ===');
}
