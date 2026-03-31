// ============================================================
// PostTripCapture.js — Issue #87
// Within 1 day of a trip ending, VERA writes a Low flag
// prompting a structured debrief conversation in Chat.
// The debrief captures restaurants, best experiences, what to
// skip, Victoria's favorites, and "would go back" decisions —
// routing each answer to existing data stores via Chat actions.
// ============================================================

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

/**
 * checkPostTripCapture_()
 * Called from nightlyRun() as Step 0g.
 * Finds trips that ended within the capture window, writes a Low flag
 * for each prompting a Chat debrief. Dedup via writeFlags() key fingerprint
 * ensures exactly one flag per trip, never re-fires.
 */
function checkPostTripCapture_() {
  var cfg = getConfigValues();
  if ((cfg['posttrip_capture_enabled'] || 'true') === 'false') {
    Logger.log('PostTripCapture: disabled via config');
    return;
  }
  var delayDays = parseInt(cfg['posttrip_capture_delay_days'] || '1', 10) || 1;

  var trips = getRecentlyCompletedTrips_(delayDays);
  if (!trips.length) {
    Logger.log('PostTripCapture: no trips ended within capture window');
    return;
  }
  Logger.log('PostTripCapture: ' + trips.length + ' recently-completed trip(s) found');

  var flags = [];
  trips.forEach(function(trip) {
    try {
      var flag = buildPostTripFlag_(trip);
      if (flag) flags.push(flag);
    } catch (err) {
      Logger.log('PostTripCapture: error building flag for ' + trip.tripKey + ' — ' + err.message);
    }
  });

  if (flags.length) {
    writeFlags(flags);
    Logger.log('PostTripCapture: wrote ' + flags.length + ' capture prompt flag(s)');

    // Memory Log — record each completed trip
    trips.forEach(function(trip) {
      try {
        var durationMs     = trip.endDate.getTime() - trip.departureDate.getTime();
        var durationNights = Math.max(1, Math.round(durationMs / 86400000));
        appendMemoryEvent_(
          MEMORY_TYPE.TRIP_COMPLETED,
          'Ahmed',
          'Trip completed: ' + trip.tripLabel,
          durationNights + ' night(s) · ended ' + Utilities.formatDate(trip.endDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
          trip.tripKey
        );
      } catch (mErr) { Logger.log('Memory: trip completed hook (non-fatal) — ' + mErr.message); }
    });
  }
}

// ─── TRIP DISCOVERY ──────────────────────────────────────────────────────────

/**
 * getRecentlyCompletedTrips_(delayDays)
 * Scans the Itinerary tab and returns trips whose end date falls within
 * the capture window: [delayDays, delayDays + 2] days ago.
 * The 2-day window tolerates nightly-run timing variations.
 *
 * End date = latest event date among all rows for that tripKey.
 *
 * @param  {number} delayDays  Days after trip end to trigger flag (e.g. 1)
 * @returns {Array}  [{ tripKey, tripLabel, departureDate, endDate, daysAgo }]
 */
function getRecentlyCompletedTrips_(delayDays) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.ITINERARY);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data    = sheet.getRange(2, 1, sheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
  var tripMap = {};
  var now     = new Date();
  var minDays = delayDays;
  var maxDays = delayDays + 2;

  data.forEach(function(row) {
    var tripKey = String(row[1] || '').trim();
    if (!tripKey) return;

    // TripKey prefix is the departure date: "YYYY-MM-DD|Trip Label"
    var datePart = tripKey.split('|')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return;

    if (!tripMap[tripKey]) {
      var parts     = tripKey.split('|');
      var tripLabel = parts.length > 1 ? parts.slice(1).join('|') : tripKey;
      tripMap[tripKey] = {
        tripKey:       tripKey,
        tripLabel:     tripLabel,
        departureDate: new Date(datePart + 'T00:00:00'),
        endDate:       new Date(datePart + 'T00:00:00'), // will be updated below
      };
    }

    // Update endDate to the latest event date seen for this trip
    var eventDate = String(row[4] || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      var d = new Date(eventDate + 'T00:00:00');
      if (d > tripMap[tripKey].endDate) tripMap[tripKey].endDate = d;
    }
  });

  // Filter to trips within the capture window
  var results = [];
  Object.keys(tripMap).forEach(function(k) {
    var trip    = tripMap[k];
    var daysAgo = (now.getTime() - trip.endDate.getTime()) / 86400000;
    if (daysAgo >= minDays && daysAgo <= maxDays) {
      trip.daysAgo = daysAgo;
      results.push(trip);
    }
  });

  return results;
}

// ─── FLAG BUILDER ─────────────────────────────────────────────────────────────

/**
 * buildPostTripFlag_(trip)
 * Assembles the post-trip capture flag. The reason field includes
 * a clear call-to-action directing the user to open Chat.
 *
 * @param  {{ tripKey, tripLabel, departureDate, endDate, daysAgo }} trip
 * @returns {{ source, flag, reason, urgency, key }}
 */
function buildPostTripFlag_(trip) {
  var tz        = Session.getScriptTimeZone();
  var daysN     = Math.round(trip.daysAgo);
  var daysLabel = daysN === 1 ? 'yesterday' : daysN + ' days ago';

  // Trip duration in nights
  var durationMs    = trip.endDate.getTime() - trip.departureDate.getTime();
  var durationNights = Math.max(1, Math.round(durationMs / 86400000));

  var reason =
    'Your ' + durationNights + '-night ' + trip.tripLabel + ' ended ' + daysLabel + '.\n\n' +
    'A quick debrief in Chat will log the highlights for future reference:\n' +
    'restaurants worth returning to, best experiences, anything you\u2019d skip,\n' +
    'what Victoria loved, and whether you\u2019d go back.\n\n' +
    'Open Chat and say: \u201cLet\u2019s do the ' + trip.tripLabel + ' debrief.\u201d';

  // Stable dedup key
  var safeKey = ('posttrip_capture_' + trip.tripKey)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  return {
    source:  'Post-Trip Capture',
    flag:    trip.tripLabel + ' just wrapped \u2014 anything worth capturing?',
    reason:  reason,
    urgency: 'Low',
    key:     safeKey,
  };
}
