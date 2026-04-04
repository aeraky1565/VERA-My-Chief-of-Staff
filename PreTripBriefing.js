// ============================================================
// PreTripBriefing.js — Issue #81
// 48-hour pre-trip auto-briefing delivered as a High flag.
// Assembles weather, flights, itinerary, confirmation numbers,
// cancellation deadlines, and packing status in one shot.
// ============================================================

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

/**
 * checkPreTripBriefings_()
 * Called from nightlyRun() as Step 0f.
 * Finds trips departing within the configured window (default 48h),
 * builds a structured briefing for each, and writes it as a High flag.
 * Deduplication is handled by writeFlags() key fingerprinting — one
 * briefing per trip, fires once and never again.
 */
function checkPreTripBriefings_() {
  var cfg = getConfigValues();
  if ((cfg['pretrip_briefing_enabled'] || 'true') === 'false') {
    Logger.log('PreTripBriefing: disabled via config');
    return;
  }
  var hoursWindow = parseInt(cfg['pretrip_briefing_hours'] || '48', 10) || 48;

  var trips = getUpcomingTripsForBriefing_(hoursWindow);
  if (!trips.length) {
    Logger.log('PreTripBriefing: no trips departing within ' + hoursWindow + 'h window');
    return;
  }
  Logger.log('PreTripBriefing: ' + trips.length + ' trip(s) in window → building briefings');

  var flags = [];
  trips.forEach(function(trip) {
    try {
      var flag = buildPreTripBriefingFlag_(trip);
      if (flag) flags.push(flag);
    } catch (err) {
      Logger.log('PreTripBriefing: error building briefing for ' + trip.tripKey + ' — ' + err.message);
    }
  });

  if (flags.length) {
    writeFlags(flags);
    Logger.log('PreTripBriefing: wrote ' + flags.length + ' briefing flag(s)');
    try {
      var tripNames = trips.slice(0, flags.length).map(function(t) { return t.tripLabel || t.tripKey; }).join(', ');
      sendSlackLog_(':airplane: Pre-trip briefing written — ' + tripNames);
    } catch(slErr) {}
  }
}

// ─── TRIP DISCOVERY ──────────────────────────────────────────────────────────

/**
 * getUpcomingTripsForBriefing_(hoursWindow)
 * Scans the Itinerary tab, groups rows by tripKey, and returns trips
 * whose departure date falls within the next [hoursWindow] hours.
 *
 * @param  {number} hoursWindow  Hours ahead to look (e.g. 48)
 * @returns {Array}  [{ tripKey, tripLabel, departureDate, endDate, rows, hoursUntil }]
 */
function getUpcomingTripsForBriefing_(hoursWindow) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.ITINERARY);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data     = sheet.getRange(2, 1, sheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
  var tripMap  = {};
  var now      = new Date();

  data.forEach(function(row) {
    var tripKey = String(row[1] || '').trim();
    if (!tripKey) return;

    // TripKey format: "YYYY-MM-DD|Trip Label" — departure date is the prefix
    var datePart = tripKey.split('|')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return;

    var depDate   = new Date(datePart + 'T00:00:00');
    var hoursUntil = (depDate.getTime() - now.getTime()) / 3600000;

    // Only trips departing in the future and within the window
    if (hoursUntil <= 0 || hoursUntil > hoursWindow) return;

    if (!tripMap[tripKey]) {
      var parts     = tripKey.split('|');
      var tripLabel = parts.length > 1 ? parts.slice(1).join('|') : tripKey;
      tripMap[tripKey] = {
        tripKey:       tripKey,
        tripLabel:     tripLabel,
        departureDate: depDate,
        endDate:       depDate,
        rows:          [],
        hoursUntil:    hoursUntil,
      };
    }

    // Track the latest event date as the trip end date
    var eventDate = String(row[4] || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      var d = new Date(eventDate + 'T00:00:00');
      if (d > tripMap[tripKey].endDate) tripMap[tripKey].endDate = d;
    }

    tripMap[tripKey].rows.push(row);
  });

  return Object.keys(tripMap).map(function(k) { return tripMap[k]; });
}

// ─── BRIEFING ASSEMBLER ───────────────────────────────────────────────────────

/**
 * buildPreTripBriefingFlag_(trip)
 * Assembles weather, flight status, itinerary, packing status, and
 * action items into a structured briefing. Returns a flag object.
 *
 * @param  {{ tripKey, tripLabel, departureDate, endDate, rows, hoursUntil }} trip
 * @returns {{ source, flag, reason, urgency, key }}
 */
function buildPreTripBriefingFlag_(trip) {
  var tz       = Session.getScriptTimeZone();
  var depLabel = Utilities.formatDate(trip.departureDate, tz, 'EEE MMM d, yyyy');
  var hoursN   = Math.round(trip.hoursUntil);
  var startDateStr = Utilities.formatDate(trip.departureDate, tz, 'yyyy-MM-dd');
  var endDateStr   = Utilities.formatDate(trip.endDate,       tz, 'yyyy-MM-dd');

  // Sort rows by date + startTime ascending
  var rows = trip.rows.slice().sort(function(a, b) {
    var ak = String(a[4] || '') + '|' + String(a[5] || '');
    var bk = String(b[4] || '') + '|' + String(b[5] || '');
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });

  // ── Step A: Destination inference ─────────────────────────────────────────
  var destination = inferTripDestination_(rows, trip.tripLabel);

  // ── Step B: Weather ───────────────────────────────────────────────────────
  var weatherText = '';
  try {
    weatherText = getPackingWeather_(destination, startDateStr, endDateStr) || '';
  } catch(e_) {}
  var weatherSection = '\uD83C\uDF24 WEATHER\n' +
    (weatherText || 'Weather unavailable \u2014 check before departure');

  // ── Step C: Flights ───────────────────────────────────────────────────────
  var flightLines = [];
  rows.forEach(function(row) {
    if (String(row[2] || '').trim().toLowerCase() !== 'flight') return;
    var meta = {};
    if (row[9]) { try { meta = JSON.parse(String(row[9])); } catch(e_) {} }

    var flightNum = meta.flightNum || String(row[3] || '').trim() || '(unknown flight)';
    var depSched  = meta.dep_scheduled || String(row[5] || '').trim() || '';
    var arrSched  = meta.arr_scheduled || String(row[6] || '').trim() || '';
    var depDate   = String(row[4] || '').trim();

    // Build timing string
    var timing = '';
    if (depDate) timing += depDate;
    if (depSched) timing += (timing ? ' ' : '') + depSched;
    if (arrSched) timing += ' \u2192 ' + arrSched;

    // Flight status freshness: show if lastChecked within last 3 hours
    var statusStr = 'Check airline app';
    if (meta.status && meta.lastChecked) {
      try {
        var lastChecked = new Date(meta.lastChecked);
        var ageHours    = (new Date() - lastChecked) / 3600000;
        if (ageHours <= 3) {
          statusStr = meta.status;
          if (meta.delay_min && parseInt(meta.delay_min, 10) > 0) {
            statusStr += ' (+' + meta.delay_min + ' min delay)';
          }
        }
      } catch(e_) {}
    }

    var gateInfo = '';
    if (meta.terminal) gateInfo += 'Terminal: ' + meta.terminal;
    if (meta.gate)     gateInfo += (gateInfo ? '  ' : '') + 'Gate: ' + meta.gate;

    var line = '\u2022 ' + flightNum;
    if (timing)   line += '  ' + timing;
    if (statusStr) line += '  \u2014  Status: ' + statusStr;
    if (gateInfo) line += '\n  ' + gateInfo;
    flightLines.push(line);
  });
  var flightSection = flightLines.length
    ? '\u2708\uFE0F FLIGHTS\n' + flightLines.join('\n')
    : '';

  // ── Step D: Itinerary ─────────────────────────────────────────────────────
  var itinLines = [];
  rows.forEach(function(row) {
    var meta = {};
    if (row[9]) { try { meta = JSON.parse(String(row[9])); } catch(e_) {} }

    var itype    = String(row[2] || '').trim();
    var title    = String(row[3] || '').trim();
    var date     = String(row[4] || '').trim();
    var stime    = String(row[5] || '').trim();
    var loc      = String(row[7] || '').trim();

    var line = '\u2022';
    if (date)  line += ' ' + date;
    if (stime) line += ' ' + stime;
    line += ' [' + (itype || 'event') + '] ' + (title || '(untitled)');
    if (loc)   line += ' @ ' + loc;

    var details = [];
    if (meta.confirmationNumber) details.push('Conf# ' + meta.confirmationNumber);
    if (meta.dresscode)          details.push('Dress: ' + meta.dresscode);
    if (details.length)          line += '\n  ' + details.join('  \u00B7  ');

    if (meta.cancellationPolicy) {
      var policy = String(meta.cancellationPolicy).substring(0, 100);
      line += '\n  \u26A0\uFE0F ' + policy;
    }

    itinLines.push(line);
  });
  var itinSection = itinLines.length
    ? '\uD83D\uDCCB ITINERARY\n' + itinLines.join('\n')
    : '';

  // ── Step E: Packing status ────────────────────────────────────────────────
  var packStatus = getPackingStatusForBriefing_(trip.tripKey);
  var packLines  = [];
  ['ahmed', 'victoria', 'shared'].forEach(function(person) {
    var p = packStatus[person];
    if (!p) return;
    var label = person.charAt(0).toUpperCase() + person.slice(1);
    var line  = label + ': ' + p.packed + '/' + p.total + ' packed';
    if (p.open.length) line += '  \u00B7  Open: ' + p.open.slice(0, 5).join(', ') +
                               (p.open.length > 5 ? ' (+' + (p.open.length - 5) + ' more)' : '');
    packLines.push(line);
  });
  var packSection = packLines.length
    ? '\uD83E\uDDF3 PACKING\n' + packLines.join('\n')
    : '\uD83E\uDDF3 PACKING\nNo packing list on file \u2014 generate one in the dashboard';

  // ── Step F: Action Needed ─────────────────────────────────────────────────
  var actionLines = [];
  rows.forEach(function(row) {
    var meta = {};
    if (row[9]) { try { meta = JSON.parse(String(row[9])); } catch(e_) {} }
    if (meta.cancellationPolicy) {
      var title  = String(row[3] || '').trim() || '(event)';
      var policy = String(meta.cancellationPolicy).substring(0, 100);
      actionLines.push('\u2022 ' + title + ': ' + policy);
    }
  });
  // Count total open packing items
  var totalOpen = 0;
  ['ahmed', 'victoria', 'shared'].forEach(function(p) {
    if (packStatus[p]) totalOpen += packStatus[p].open.length;
  });
  if (totalOpen > 0) actionLines.push('\u2022 ' + totalOpen + ' packing item(s) still open');

  var actionSection = actionLines.length
    ? '\u26A0\uFE0F ACTION NEEDED\n' + actionLines.join('\n')
    : '';

  // ── Assemble full briefing ────────────────────────────────────────────────
  var header = '\u2708\uFE0F PRE-TRIP BRIEF \u2014 ' + trip.tripLabel + '\n' +
               'Departs in ' + hoursN + ' hours (' + depLabel + ')';

  var sections = [header, weatherSection, flightSection, itinSection, packSection, actionSection]
    .filter(function(s) { return s && s.trim(); });
  var reason = sections.join('\n\n');

  // ── Build flag key (stable dedup identifier) ──────────────────────────────
  var safeKey = ('pretrip_briefing_' + trip.tripKey)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  return {
    source:  'Pre-Trip Briefing',
    flag:    trip.tripLabel + ' departs in ' + hoursN + ' hours \u2014 pre-trip brief ready',
    reason:  reason,
    urgency: 'High',
    key:     safeKey,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * inferTripDestination_(rows, tripLabel)
 * Infers the primary destination for weather lookup:
 *   1. First flight row with metadata.dest
 *   2. First hotel row's Location column
 *   3. tripLabel with generic travel words stripped
 *
 * @param  {Array}  rows       Raw Itinerary sheet rows for this trip
 * @param  {string} tripLabel  Human-readable trip name
 * @returns {string}
 */
function inferTripDestination_(rows, tripLabel) {
  // a. Flight metadata.dest
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim().toLowerCase() === 'flight' && rows[i][9]) {
      try {
        var meta = JSON.parse(String(rows[i][9]));
        if (meta.dest) return meta.dest;
      } catch(e_) {}
    }
  }
  // b. Hotel location column
  for (var j = 0; j < rows.length; j++) {
    if (String(rows[j][2] || '').trim().toLowerCase() === 'hotel') {
      var loc = String(rows[j][7] || '').trim();
      if (loc) return loc;
    }
  }
  // c. Trip label stripped of generic words
  return tripLabel
    .replace(/\b(trip|adventure|vacation|holiday|weekend|getaway|tour|visit)\b/gi, '')
    .trim();
}

/**
 * getPackingStatusForBriefing_(tripKey)
 * Reads PackingItems tab and returns per-person packing progress.
 *
 * @param  {string} tripKey
 * @returns {{ ahmed: {total, packed, open[]}, victoria: {…}, shared: {…} }}
 */
function getPackingStatusForBriefing_(tripKey) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.PACKING_ITEMS);
  var result = {};
  if (!sheet || sheet.getLastRow() < 2) return result;

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues();
  data.forEach(function(row) {
    if (String(row[1] || '').trim() !== tripKey) return;
    var person  = String(row[2] || '').trim().toLowerCase() || 'shared';
    var item    = String(row[4] || '').trim();
    var checked = String(row[5] || '').toUpperCase() === 'TRUE';

    if (!result[person]) result[person] = { total: 0, packed: 0, open: [] };
    result[person].total++;
    if (checked) result[person].packed++;
    else if (item) result[person].open.push(item);
  });

  return result;
}
