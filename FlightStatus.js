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
    return null;
  }

  var url = 'http://api.aviationstack.com/v1/flights'
    + '?access_key=' + encodeURIComponent(key)
    + '&flight_iata=' + encodeURIComponent(flightIata.toUpperCase())
    + '&flight_date=' + encodeURIComponent(flightDate);

  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = resp.getResponseCode();
    if (code !== 200) {
      Logger.log('FlightStatus: AviationStack HTTP ' + code + ' for ' + flightIata);
      return null;
    }
    var json = JSON.parse(resp.getContentText());
    if (!json.data || json.data.length === 0) {
      Logger.log('FlightStatus: No data returned for ' + flightIata + ' on ' + flightDate);
      return null;
    }
    // Use first matching result (most relevant)
    var d = json.data[0];
    var dep = d.departure || {};
    var arr = d.arrival   || {};

    // Extract HH:MM from ISO datetime string
    function toHHMM(isoStr) {
      if (!isoStr) return null;
      var m = isoStr.match(/T(\d{2}:\d{2})/);
      return m ? m[1] : null;
    }

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
    return null;
  }
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

    // Skip flights that have long since landed (>60 min past departure)
    var existingStatus = (meta.flight_status || {}).status;
    if (!forceRefresh && minutesUntilDep < -60 && existingStatus === 'landed') { skipped++; continue; }

    // Determine required poll interval (minutes)
    var intervalMin;
    if (minutesUntilDep > 360)      intervalMin = 180;  // 6–24h away → every 3h
    else if (minutesUntilDep > 60)  intervalMin = 60;   // 1–6h away  → every 60min
    else                             intervalMin = 15;   // <1h away   → every 15min

    // Rate-limit check
    var lastChecked = (meta.flight_status || {}).lastChecked || 0;
    if (!forceRefresh && (now - lastChecked) < intervalMin * 60000) { skipped++; continue; }

    // Poll AviationStack
    Logger.log('FlightStatus: checking ' + flightNum + ' on ' + date + ' (row ' + (i+1) + ')');
    var statusObj = fetchFlightStatus_(flightNum, date);
    if (!statusObj) { errors++; continue; }

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
  // forceRefresh extends the window to 48h so same-day + next-day flights are covered.
  var scanStart = new Date(now - 60 * 60000);                             // 1h ago
  var scanEnd   = new Date(now + (forceRefresh ? 48 : 24) * 60 * 60000); // 24 or 48h ahead
  var allCals   = CalendarApp.getAllCalendars();

  for (var ci = 0; ci < allCals.length; ci++) {
    try {
      var calEvents = allCals[ci].getEvents(scanStart, scanEnd);
      for (var ei = 0; ei < calEvents.length; ei++) {
        var ev      = calEvents[ei];
        var evTitle = (ev.getTitle()    || '').trim();
        var evLoc   = (ev.getLocation() || '').trim();

        // Use the same classification function as webGetItinerary_() for consistency —
        // if that function classifies an event as 'flight', we should poll it here too.
        var relevance = isItineraryCalendarRelevant_(evTitle, evLoc, '');
        if (!relevance.include || relevance.type !== 'flight') continue;

        // Extract flight number (general regex covers airlines beyond the IATA short-list)
        var fm2 = evTitle.match(/\b([A-Z]{2})\s*(\d{1,4})\b/);
        if (!fm2) continue;
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
        if (!forceRefresh && minsUntilEv < -60 && cachedStatus.status === 'landed') { skipped++; continue; }

        var calInterval = minsUntilEv > 360 ? 180 : minsUntilEv > 60 ? 60 : 15;
        if (!forceRefresh && (now - (cachedStatus.lastChecked || 0)) < calInterval * 60000) { skipped++; continue; }

        // Poll AviationStack
        Logger.log('FlightStatus: checking calendar flight ' + calFlightNum + ' on ' + evDate + ' (' + calId + ')');
        var calStatusObj = fetchFlightStatus_(calFlightNum, evDate);
        if (!calStatusObj) { errors++; continue; }

        calCache[calId] = { tripKey: evTripKey, flightNum: calFlightNum, status: calStatusObj };
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

  Logger.log('FlightStatus: done. checked=' + checked + ' skipped=' + skipped + ' errors=' + errors);
  return { polled: checked, skipped: skipped, errors: errors };
}
