// ============================================================
// VERA — Flight Status Monitor (Issue #66)
// FlightStatus.js — Real-time flight polling via AviationStack
// ============================================================
//
// HOW IT WORKS:
//   1. A 15-minute Apps Script trigger calls checkFlightStatuses_()
//   2. Phase 1: scans Itinerary sheet for flight rows with a flightNum
//   3. Phase 2: scans Google Calendar for flight events (airline code + number in title)
//   4. For flights within 24h of departure, each phase polls AviationStack API
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
//   Departure > 6h away  (6–24h window):  every 3 hours
//   Departure 1–6h away:                  every 60 minutes
//   Departure < 1h away:                  every 15 minutes
//   Departure > 24h away or already done: skip
// ============================================================

// ---- Config -----------------------------------------------------------------

function getAviationStackKey_() {
  return PropertiesService.getScriptProperties().getProperty('AVIATIONSTACK_KEY') || '';
}

// ---- AviationStack 429 backoff (Script Properties) -------------------------
// When the API returns 429, we store a "back off until" timestamp so every
// subsequent trigger run skips all API calls until the window expires.

var AS_BACKOFF_KEY_ = 'AVIATIONSTACK_BACKOFF_UNTIL';

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
  var isQuota = responseBody && (responseBody.indexOf('usage_limit') !== -1 ||
                                  responseBody.indexOf('monthly')     !== -1 ||
                                  responseBody.indexOf('exceeded')    !== -1);
  var backoffMs = isQuota ? 30 * 24 * 60 * 60 * 1000   // 30 days — monthly quota
                          :  2 *       60 * 60 * 1000;  //  2 hours — per-rate limit
  var until = Date.now() + backoffMs;
  PropertiesService.getScriptProperties().setProperty(AS_BACKOFF_KEY_, String(until));
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
    if (code === 429) {
      setAviationStackBackoff_(resp.getContentText());
      recordApiHealth_('aviationstack', false, 'rate limited / quota exhausted', 429);
      return null;
    }
    if (code !== 200) {
      Logger.log('FlightStatus: AviationStack HTTP ' + code + ' for ' + flightIata);
      recordApiHealth_('aviationstack', false, 'HTTP error for ' + flightIata, code);
      return null;
    }
    var json = JSON.parse(resp.getContentText());
    if (!json.data || json.data.length === 0) {
      Logger.log('FlightStatus: No data returned for ' + flightIata);
      recordApiHealth_('aviationstack', false, 'no data returned for ' + flightIata, code);
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
    recordApiHealth_('aviationstack', false, 'fetch error for ' + flightIata + ': ' + err.message, 0);
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
function flightStaleAfterMin_(minutesUntilDep) {
  return flightPollIntervalMin_(minutesUntilDep) * 2;
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
 * Scans the Itinerary sheet for flight items with a flightNum,
 * applies rate-limited polling, and updates status in metadata.
 * Safe to call manually for testing.
 *
 * @param {boolean} [forceRefresh]   Skip rate-limiting and window guards (for on-demand refresh)
 * @param {string}  [targetTripKey]  If set, only process flights for this trip
 */
function checkFlightStatuses_(forceRefresh, targetTripKey) {
  var _fsStart = Date.now();
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

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.ITINERARY);
  if (!sheet) {
    Logger.log('FlightStatus: Itinerary tab not found');
    return;
  }

  var now  = Date.now();
  var tz   = Session.getScriptTimeZone();        // hoisted — also used in Phase 2
  var rows = sheet.getDataRange().getValues();
  var checked = 0, skipped = 0, errors = 0;
  var hasUpcomingFlights = false; // true if any sheet flight is still in the 0–1440 min window

  for (var i = 1; i < rows.length; i++) {
    var row  = rows[i];
    var type = String(row[2] || '').trim();      // col C
    if (type !== 'flight') continue;

    // When called for a specific trip (force refresh from dashboard), skip other trips
    if (targetTripKey && String(row[1] || '').trim() !== targetTripKey) continue;

    var id       = String(row[0] || '');         // col A

    // Google Sheets auto-converts date/time strings to Date objects.
    // String(dateObj) gives a locale string that new Date() can't re-parse,
    // causing isNaN(depMs) → flight silently skipped → AviationStack never called.
    // Use Utilities.formatDate() to get the canonical string form.
    var dateRaw   = row[4];
    var date      = (dateRaw instanceof Date)
      ? Utilities.formatDate(dateRaw, tz, 'yyyy-MM-dd')
      : String(dateRaw || '').trim();            // col E  (YYYY-MM-DD)

    var timeRaw   = row[5];
    var startTime = (timeRaw instanceof Date)
      ? Utilities.formatDate(timeRaw, tz, 'HH:mm')
      : String(timeRaw || '').trim();            // col F  (HH:MM)

    // Parse metadata
    var meta = {};
    try { meta = JSON.parse(String(row[9] || '{}') || '{}'); } catch(e) { meta = {}; }

    var flightNum = (meta.flightNum || '').trim();

    // Fallback: extract flight number from the item title for calendar-imported flights
    // that have no flightNum in metadata (e.g. "Flight to Tampa (UA 1140)" → "UA1140")
    if (!flightNum) {
      var title = String(row[3] || '');
      var fm = title.match(/\b([A-Z]{2})\s*(\d{1,4})\b/);
      if (fm) {
        flightNum = fm[1] + fm[2];
        Logger.log('FlightStatus: extracted flight number "' + flightNum + '" from title "' + title + '"');
      }
    }

    if (!flightNum || !date) {
      skipped++;
      continue;
    }

    // Build departure datetime (use startTime if set, else midnight)
    var depStr = date + 'T' + (startTime || '00:00') + ':00';
    var depMs  = new Date(depStr).getTime();
    if (isNaN(depMs)) { skipped++; continue; }

    var minutesUntilDep = (depMs - now) / 60000;

    // Skip flights not yet in polling window (>24h out)
    if (!forceRefresh && minutesUntilDep > 1440) { skipped++; continue; }

    // Stop polling once the flight has landed or been cancelled — no time condition needed
    var existingStatus = (meta.flight_status || {}).status;
    if (!forceRefresh && (existingStatus === 'landed' || existingStatus === 'cancelled')) { skipped++; continue; }
    // Stop polling once departure time has passed — nothing actionable after the flight has left
    if (!forceRefresh && minutesUntilDep < 0) { skipped++; continue; }

    // Flight is genuinely upcoming (0–1440 min window, not terminal, not departed)
    if (!forceRefresh) hasUpcomingFlights = true;

    // Determine required poll interval (minutes)
    var intervalMin = flightPollIntervalMin_(minutesUntilDep);

    // Rate-limit check
    var lastChecked = (meta.flight_status || {}).lastChecked || 0;
    if (!forceRefresh && (now - lastChecked) < intervalMin * 60000) { skipped++; continue; }

    // Poll AviationStack
    Logger.log('FlightStatus: checking ' + flightNum + ' on ' + date + ' (row ' + (i+1) + ')');
    var statusObj = fetchFlightStatus_(flightNum, date);
    if (!statusObj) {
      errors++;
      // Issue #138: the refresh failed but a previous status is still cached.
      // Stamp it so downstream renders "Not live" instead of the stale value.
      if (meta.flight_status) {
        stampFlightFetchFailure_(meta.flight_status);
        try {
          updateFlightStatusInSheet_(sheet, i + 1, JSON.stringify(meta));
        } catch (stampErr) {
          Logger.log('FlightStatus: could not stamp stale status on row ' + (i+1) + ' — ' + stampErr.message);
        }
      }
      continue;
    }

    // Merge into metadata and write back
    meta.flight_status = statusObj;
    try {
      updateFlightStatusInSheet_(sheet, i + 1, JSON.stringify(meta));
      checked++;
      Logger.log('FlightStatus: updated ' + flightNum + ' → ' + statusObj.status
        + (statusObj.delay_min ? ' (' + statusObj.delay_min + 'min delay)' : ''));
    } catch(writeErr) {
      Logger.log('FlightStatus: write error for row ' + (i+1) + ' — ' + writeErr.message);
      errors++;
    }
  }

  // ---- Early exit: no upcoming flights in Itinerary sheet --------------------
  // If every sheet flight is either past departure, terminal, or outside the 24h window,
  // skip Phase 2 entirely — no Calendar API calls, no AviationStack exposure.
  if (!forceRefresh && !hasUpcomingFlights) {
    Logger.log('FlightStatus: no upcoming flights in window — skipping Phase 2 calendar scan');
    // Calendar-sourced flights live only in the cache, so they still need
    // a staleness pass even when the sheet has nothing upcoming.
    checkStaleFlightStatus_();
    return { polled: checked, skipped: skipped, errors: errors };
  }

  // ---- Phase 2: Calendar-sourced flight events --------------------------------
  // Calendar flights have no Itinerary sheet row, so we scan Google Calendar events
  // and store statuses in Script Properties (FLIGHT_STATUS_CACHE), keyed by CAL-xxx ID
  // (the same ID format assigned by webGetItinerary_() for calendar-derived items).

  var calCache = getCalFlightStatusCache_();

  // Build a date→tripKey map from the sheet rows already read,
  // so we can infer which trip a calendar event belongs to when no targetTripKey is given.
  var dateToTripKey = {};
  for (var r = 1; r < rows.length; r++) {
    var rDate    = (rows[r][4] instanceof Date)
      ? Utilities.formatDate(rows[r][4], tz, 'yyyy-MM-dd')
      : String(rows[r][4] || '').trim();
    var rTripKey = String(rows[r][1] || '').trim();
    if (rDate && rTripKey && !dateToTripKey[rDate]) dateToTripKey[rDate] = rTripKey;
  }

  // Scan all calendars for flight events in the polling window.
  // For force refresh: look back 24h (covers flights that already departed today).
  // For normal trigger: look back 1h and ahead 24h.
  var scanStart = new Date(now - (forceRefresh ? 24 : 1) * 60 * 60000);  // 24h or 1h ago
  var scanEnd   = new Date(now + (forceRefresh ? 48 : 24) * 60 * 60000); // 48h or 24h ahead
  var allCals   = CalendarApp.getAllCalendars();
  Logger.log('FlightStatus Phase2: scanning ' + allCals.length + ' calendar(s) from '
    + Utilities.formatDate(scanStart, tz, 'yyyy-MM-dd HH:mm') + ' to '
    + Utilities.formatDate(scanEnd,   tz, 'yyyy-MM-dd HH:mm'));

  for (var ci = 0; ci < allCals.length; ci++) {
    try {
      var calEvents = allCals[ci].getEvents(scanStart, scanEnd);
      Logger.log('FlightStatus Phase2: cal "' + allCals[ci].getName() + '" → ' + calEvents.length + ' event(s) in window');
      for (var ei = 0; ei < calEvents.length; ei++) {
        var ev      = calEvents[ei];
        var evTitle = (ev.getTitle()    || '').trim();
        var evLoc   = (ev.getLocation() || '').trim();

        // Use the same classification function as webGetItinerary_() for consistency —
        // if that function classifies an event as 'flight', we should poll it here too.
        var relevance = isItineraryCalendarRelevant_(evTitle, evLoc, '');
        if (!relevance.include || relevance.type !== 'flight') {
          Logger.log('FlightStatus Phase2: skip "' + evTitle + '" → not classified as flight (type=' + relevance.type + ', include=' + relevance.include + ')');
          continue;
        }

        // Extract flight number (general regex covers airlines beyond the IATA short-list)
        var fm2 = evTitle.match(/\b([A-Z]{2})\s*(\d{1,4})\b/);
        if (!fm2) {
          Logger.log('FlightStatus Phase2: skip "' + evTitle + '" → classified as flight but no IATA code+number found in title');
          continue;
        }
        var calFlightNum = fm2[1] + fm2[2];

        // Compute CAL-xxx ID using the IDENTICAL formula used in webGetItinerary_()
        var calId  = 'CAL-' + ev.getId().replace(/[^a-z0-9]/gi, '').substring(0, 16);
        var evDate = Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd');
        var evTime = ev.isAllDayEvent() ? '00:00'
                   : Utilities.formatDate(ev.getStartTime(), tz, 'HH:mm');

        // Determine tripKey: explicit param > existing cache entry > date lookup from sheet
        var evTripKey = targetTripKey
          || (calCache[calId] && calCache[calId].tripKey)
          || dateToTripKey[evDate]
          || '';

        // When targeting a specific trip, skip events from other trips
        if (targetTripKey && evTripKey !== targetTripKey) continue;

        // Rate-limiting (mirrors Phase 1 sheet-based logic)
        var evDepMs     = new Date(evDate + 'T' + evTime + ':00').getTime();
        var minsUntilEv = (evDepMs - now) / 60000;

        if (!forceRefresh && minsUntilEv > 1440) { skipped++; continue; }

        var cachedEntry  = calCache[calId] || {};
        var cachedStatus = cachedEntry.status || {};
        // Stop polling once landed or cancelled — no time condition needed
        if (!forceRefresh && (cachedStatus.status === 'landed' || cachedStatus.status === 'cancelled')) { skipped++; continue; }
        // Stop polling once departure time has passed — nothing actionable after the flight has left
        if (!forceRefresh && minsUntilEv < 0) { skipped++; continue; }

        var calInterval = flightPollIntervalMin_(minsUntilEv);
        if (!forceRefresh && (now - (cachedStatus.lastChecked || 0)) < calInterval * 60000) { skipped++; continue; }

        // Poll AviationStack
        Logger.log('FlightStatus: checking calendar flight ' + calFlightNum + ' on ' + evDate + ' (' + calId + ')');
        var calStatusObj = fetchFlightStatus_(calFlightNum, evDate);
        if (!calStatusObj) {
          errors++;
          // Issue #138: stamp the cached calendar status so it stops reading as live.
          if (cachedEntry.status) {
            stampFlightFetchFailure_(cachedEntry.status);
            calCache[calId] = cachedEntry;
          }
          continue;
        }

        // `date` is stored so checkStaleFlightStatus_() can reconstruct the
        // departure time without re-scanning every calendar.
        calCache[calId] = {
          tripKey:   evTripKey,
          flightNum: calFlightNum,
          date:      evDate,
          time:      evTime,
          status:    calStatusObj,
        };
        checked++;
        Logger.log('FlightStatus: updated calendar ' + calFlightNum + ' → ' + calStatusObj.status
          + (calStatusObj.delay_min ? ' (' + calStatusObj.delay_min + 'min delay)' : ''));
      }
    } catch (calScanErr) {
      Logger.log('FlightStatus: calendar scan error — ' + calScanErr.message);
    }
  }

  setCalFlightStatusCache_(calCache);
  // ---- end Phase 2 -----------------------------------------------------------

  // Issue #138: alert on anything that is departing soon but no longer refreshing.
  // Skipped on force-refresh — the user is looking at the dashboard and will see
  // the badge, so a push notification would just be noise.
  if (!forceRefresh) checkStaleFlightStatus_();

  Logger.log('FlightStatus: done. checked=' + checked + ' skipped=' + skipped + ' errors=' + errors);
  if (errors > 0) {
    veraLog_('checkFlightStatuses', 'Travel', 'Partial',
      'checked=' + checked + ' skipped=' + skipped + ' errors=' + errors, Date.now() - _fsStart);
  } else {
    veraLog_('checkFlightStatuses', 'Travel', 'Success',
      'checked=' + checked + ' skipped=' + skipped, Date.now() - _fsStart);
  }
  return { polled: checked, skipped: skipped, errors: errors };
  } catch (err) {
    Logger.log('checkFlightStatuses_ FATAL: ' + err.message + '\n' + (err.stack || ''));
    veraLog_('checkFlightStatuses', 'Travel', 'Failed', '', Date.now() - _fsStart, err.message);
  }
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

    var staleAfter = flightStaleAfterMin_(minsUntilDep);
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

        var flightNum = (meta.flightNum || '').trim();
        if (!flightNum) {
          var fm = String(rows[i][3] || '').match(/\b([A-Z]{2})\s*(\d{1,4})\b/);
          if (fm) flightNum = fm[1] + fm[2];
        }
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
      var fm        = title.match(/\b([A-Z]{2})\s*(\d{1,4})\b/);
      var flightNum = fm ? fm[1] + fm[2] : '(none)';
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
      var fm3 = title2.match(/\b([A-Z]{2})\s*(\d{1,4})\b/);
      if (!fm3) continue;
      var testFlight = fm3[1] + fm3[2];
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
