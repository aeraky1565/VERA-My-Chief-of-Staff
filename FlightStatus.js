// ============================================================
// VERA — Flight Status Monitor (Issue #66)
// FlightStatus.js — Real-time flight polling via AviationStack
// ============================================================
//
// HOW IT WORKS:
//   1. A 15-minute Apps Script trigger calls checkFlightStatuses_()
//   2. It scans the Itinerary sheet for flight items with a flightNum
//   3. For flights within 24h of departure, it polls AviationStack API
//   4. Status is stored back into the item's metadata JSON (flight_status key)
//   5. The dashboard reads status via ?action=flight_statuses&tripKey=...
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
 */
function checkFlightStatuses_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.ITINERARY);
  if (!sheet) {
    Logger.log('FlightStatus: Itinerary tab not found');
    return;
  }

  var now  = Date.now();
  var rows = sheet.getDataRange().getValues();
  var checked = 0, skipped = 0, errors = 0;

  for (var i = 1; i < rows.length; i++) {
    var row  = rows[i];
    var type = String(row[2] || '').trim();      // col C
    if (type !== 'flight') continue;

    var id       = String(row[0] || '');         // col A
    var date     = String(row[4] || '');         // col E  (YYYY-MM-DD)
    var startTime = String(row[5] || '');        // col F  (HH:MM)

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
    if (minutesUntilDep > 1440) { skipped++; continue; }

    // Skip flights that have long since landed (>60 min past departure)
    var existingStatus = (meta.flight_status || {}).status;
    if (minutesUntilDep < -60 && existingStatus === 'landed') { skipped++; continue; }

    // Determine required poll interval (minutes)
    var intervalMin;
    if (minutesUntilDep > 360)      intervalMin = 180;  // 6–24h away → every 3h
    else if (minutesUntilDep > 60)  intervalMin = 60;   // 1–6h away  → every 60min
    else                             intervalMin = 15;   // <1h away   → every 15min

    // Rate-limit check
    var lastChecked = (meta.flight_status || {}).lastChecked || 0;
    if ((now - lastChecked) < intervalMin * 60000) { skipped++; continue; }

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

  Logger.log('FlightStatus: done. checked=' + checked + ' skipped=' + skipped + ' errors=' + errors);
}
