// ============================================================
// TravelDayBriefing.js — Issue #108b
// Sends a clean, shareable travel day briefing email on the
// morning of travel. No VERA branding — suitable for companions.
//
// Architecture:
//   checkAndSendTravelDayBriefings_()   ← entry point (called from morningNudge)
//     └─ sendTravelDayBriefing_(tripKey, items)
//          ├─ enrichTravelItems_(items)   ← once, shared by schedule + map + plain text
//          ├─ buildTravelDayEmailHtml_(label, date, sections)
//          │    └─ sections pipeline: [{ id, builder, data }, ...]
//          │         ├─ buildTravelScheduleSection_(enrichedItems)
//          │         ├─ buildTravelMapSection_({items, apiKey, directionsUrl})
//          │         // Future: buildTravelWeatherSection_
//          │         // Future: buildTravelFlightStatusSection_
//          │         // Future: buildTravelGroupNotesSection_
//          ├─ buildTravelDayPlainText_(label, date, items, ..., directionsUrl)
//          └─ getTravelDayRecipients_(tripKey)
//
// To add a new email section: implement buildXxxSection_(data) → HTML,
// then push { id: 'xxx', builder: buildXxxSection_, data: payload }
// to the sections array in sendTravelDayBriefing_(). No other changes needed.
// ============================================================

/**
 * isVirtualMeetingLocation_(location)
 * Same virtual-meeting keyword check isItineraryCalendarRelevant_ (WebApp.js)
 * already applies internally — duplicated here in miniature because that
 * function only exposes include/exclude, not *why*, and getCalendarItemsForToday_
 * needs to know specifically "was this excluded for being virtual" before
 * applying its own looser has-a-real-location fallback.
 */
function isVirtualMeetingLocation_(location) {
  var VIRTUAL_LOCS = ['zoom', 'google meet', 'teams', 'webex', 'skype',
                       'conference room', 'meet.google', 'whereby'];
  var loc = location.toLowerCase();
  for (var i = 0; i < VIRTUAL_LOCS.length; i++) {
    if (loc.indexOf(VIRTUAL_LOCS[i]) !== -1) return true;
  }
  return false;
}

/**
 * getCalendarItemsForToday_(tripKey, tripLabel, tz)
 * Fallback: reads today's events from the same "trusted calendar" set
 * webGetItinerary_() uses for the dashboard's auto-pull (WebApp.js) — gap/
 * shared calendars + the user's personal primary calendar, explicitly
 * excluding extended-family calendars — and keeps any event
 * isItineraryCalendarRelevant_() (WebApp.js) judges relevant to this trip
 * by keyword/location match against tripLabel. That's the same relevance
 * check the dashboard's Travel tab already relies on; no GAS file boundary
 * to cross since every .js file shares one global scope.
 *
 * Returns an array of synthetic Itinerary row arrays (same 10-column layout)
 * so they can be passed directly to sendTravelDayBriefing_() unchanged —
 * every downstream consumer (enrichTravelItems_, the schedule/map section
 * builders, the plain-text builder) only ever cared about this row shape,
 * never about whether it came from the sheet or a calendar.
 *
 * Only called when the Itinerary sheet has no rows for the trip today —
 * deliberately conservative so this can't double up a manually-logged item.
 */
function getCalendarItemsForToday_(tripKey, tripLabel, tz) {
  var today      = new Date();
  var startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
  var endOfDay   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
  var rows       = [];
  try {
    var cfg      = readPTOConfig_();
    var gapNames = (cfg.gapCalendarsRaw || '').split(',')
      .map(function(n) { return n.trim(); })
      .filter(function(n) { return n && n !== cfg.calendarName; });
    var trustedSet = {};
    gapNames.forEach(function(n) { trustedSet[n] = true; });
    var userEmail = Session.getEffectiveUser().getEmail();

    CalendarApp.getAllCalendars().forEach(function(cal) {
      if (cal.getId() !== userEmail && !trustedSet[cal.getName()]) return;

      cal.getEvents(startOfDay, endOfDay).forEach(function(ev) {
        var title    = (ev.getTitle()    || '(No title)').trim();
        var location = (ev.getLocation() || '').trim();

        var relevance = isItineraryCalendarRelevant_(title, location, tripLabel);
        if (!relevance.include) {
          // isItineraryCalendarRelevant_ requires the trip-label keyword to
          // literally appear in the title/location — which misses something
          // like a lunch/dinner reservation whose venue name doesn't contain
          // the destination (e.g. trip "Anniversary Weekend", venue "The
          // Grove Bistro"). This function only ever runs when the trip has
          // ZERO logged items for today, so err toward including any event
          // with a real (non-virtual) location rather than dropping it —
          // worst case is one extra row easily deleted from the Travel tab;
          // the alternative is a real trip plan silently never showing up.
          if (!location || isVirtualMeetingLocation_(location)) return;
          relevance = { include: true, type: 'calendar' };
        }

        var allDay   = ev.isAllDayEvent();
        var startStr = allDay ? '' : Utilities.formatDate(ev.getStartTime(), tz, 'HH:mm');
        var endStr   = allDay ? '' : Utilities.formatDate(ev.getEndTime(),   tz, 'HH:mm');

        var meta = {};
        if (relevance.type === 'flight') {
          // Preserve the same flight-detail extraction the old flight-only
          // fallback did, so flight-day briefings don't lose any detail.
          var iata      = title.match(/\b([A-Z]{3})\b/g) || [];
          var desc      = ev.getDescription() || '';
          var confMatch = desc.match(/conf(?:irmation)?[#:\s]+([A-Z0-9]{5,8})/i);
          meta = {
            origin:             iata[0] || '',
            dest:               iata[1] || '',
            confirmationNumber: confMatch ? confMatch[1] : '',
            dep_scheduled:      ev.getStartTime().toISOString(),
            arr_scheduled:      ev.getEndTime().toISOString(),
          };
        }

        // [ID, TripKey, Type, Title, Date, StartTime, EndTime, Location, Notes, Metadata]
        rows.push(['', tripKey, relevance.type, title,
                   ev.getStartTime(), startStr, endStr, location, '', JSON.stringify(meta)]);
      });
    });
  } catch (e) {
    Logger.log('getCalendarItemsForToday_ error: ' + e.message);
  }
  return rows.sort(function(a, b) {
    return String(a[5]) < String(b[5]) ? -1 : 1;
  });
}

/**
 * checkAndSendTravelDayBriefings_()
 * Entry point. Called from morningNudge() each morning.
 * Scans the Itinerary sheet for rows whose Date = today,
 * groups by Trip Key, and fires one email per trip.
 * Safe no-op if no travel today.
 * Respects config key: travel_day_briefing_enabled (default: true)
 */
function checkAndSendTravelDayBriefings_() {
  var _tdbStart = Date.now();
  try {
  var cfg = getConfigValues();
  if ((cfg['travel_day_briefing_enabled'] || 'true') === 'false') {
    Logger.log('TravelDayBriefing: disabled via config');
    veraLog_('checkAndSendTravelDayBriefings', 'Travel', 'Skipped', 'travel_day_briefing_enabled=false', Date.now() - _tdbStart);
    return;
  }

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.ITINERARY);
  var tz    = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // tripMap: tripKey → rows for today (may be empty array for active trips with no items today)
  var tripMap    = {};
  var tripRanges = {}; // tripKey → { min, max } across all itinerary rows

  if (sheet && sheet.getLastRow() >= 2) {
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
    data.forEach(function(row) {
      var tripKey = String(row[1] || '').trim();
      if (!tripKey) return;
      var rowDate = (row[4] instanceof Date && !isNaN(row[4].getTime()))
        ? Utilities.formatDate(row[4], tz, 'yyyy-MM-dd')
        : String(row[4] || '').trim();
      if (!rowDate || !/^\d{4}-\d{2}-\d{2}$/.test(rowDate)) return;
      // Track date range for this trip
      if (!tripRanges[tripKey]) tripRanges[tripKey] = { min: rowDate, max: rowDate };
      if (rowDate < tripRanges[tripKey].min) tripRanges[tripKey].min = rowDate;
      if (rowDate > tripRanges[tripKey].max) tripRanges[tripKey].max = rowDate;
      // Collect today's rows
      if (rowDate === today) {
        if (!tripMap[tripKey]) tripMap[tripKey] = [];
        tripMap[tripKey].push(row);
      }
    });
    // Include active trips where today falls in their date range but no rows for today
    Object.keys(tripRanges).forEach(function(tripKey) {
      var r = tripRanges[tripKey];
      if (!tripMap[tripKey] && today >= r.min && today <= r.max) {
        tripMap[tripKey] = [];
      }
    });
  }

  // Also catch calendar-based trips with no itinerary rows at all
  try {
    var calCfg   = readPTOConfig_();
    var calTrips = getUpcomingTravel_(calCfg);
    calTrips.forEach(function(t) {
      if (t.isExtendedFamily) return;
      var key = t.startDate + '|' + t.label;
      if (!tripMap[key] && today >= t.startDate && today <= t.endDate) {
        tripMap[key] = [];
      }
    });
  } catch (calErr) {
    Logger.log('TravelDayBriefing: calendar scan error (non-fatal) — ' + calErr.message);
  }

  // Calendar fallback: if a trip was found but has no sheet rows, pull in
  // whatever today's trusted-calendar events are actually relevant to it.
  Object.keys(tripMap).forEach(function(key) {
    if (tripMap[key].length === 0) {
      var keyParts  = key.split('|');
      var tripLabel = keyParts.length > 1 ? keyParts.slice(1).join('|') : key;
      var calRows   = getCalendarItemsForToday_(key, tripLabel, tz);
      if (calRows.length) {
        Logger.log('TravelDayBriefing: calendar fallback provided ' + calRows.length + ' item(s) for ' + key);
        tripMap[key] = calRows;
      }
    }
  });

  var tripKeys = Object.keys(tripMap);
  if (!tripKeys.length) {
    Logger.log('TravelDayBriefing: no travel today (' + today + ')');
    return;
  }

  Logger.log('TravelDayBriefing: ' + tripKeys.length + ' trip(s) today — sending briefings');
  var sent = 0;
  tripKeys.forEach(function(tripKey) {
    try {
      sendTravelDayBriefing_(tripKey, tripMap[tripKey]);
      sent++;
    } catch (err) {
      Logger.log('TravelDayBriefing: error for ' + tripKey + ' — ' + err.message);
      veraLog_('checkAndSendTravelDayBriefings', 'Travel', 'Partial',
        'Error sending briefing for ' + tripKey, Date.now() - _tdbStart, err.message);
    }
  });
  if (sent > 0) {
    veraLog_('checkAndSendTravelDayBriefings', 'Travel', 'Success',
      sent + ' travel day briefing(s) sent', Date.now() - _tdbStart);
  }
  } catch (err) {
    Logger.log('checkAndSendTravelDayBriefings_ FATAL: ' + err.message + '\n' + (err.stack || ''));
    veraLog_('checkAndSendTravelDayBriefings', 'Travel', 'Failed', '', Date.now() - _tdbStart, err.message);
  }
}

// ---------------------------------------------------------------------------

/**
 * sendTravelDayBriefing_(tripKey, todayItems)
 * Assembles and sends the travel day briefing email.
 *
 * @param {string} tripKey     — e.g. "2026-03-25|Paris"
 * @param {Array}  todayItems  — raw Itinerary sheet rows for today
 */
function sendTravelDayBriefing_(tripKey, todayItems) {
  if (!isNotifEnabled_('travel_day_briefing')) {
    Logger.log('sendTravelDayBriefing_: skipped — travel_day_briefing disabled');
    return;
  }
  var tz        = Session.getScriptTimeZone();
  var parts     = tripKey.split('|');
  var tripLabel = parts.length > 1 ? parts.slice(1).join('|') : tripKey;
  var dateLabel = Utilities.formatDate(new Date(), tz, 'EEEE, MMMM d'); // e.g. "Tuesday, March 25"

  // Sort items by Start Time ascending
  var sortedItems = todayItems.slice().sort(function(a, b) {
    var at = String(a[5] || '').trim();
    var bt = String(b[5] || '').trim();
    return at < bt ? -1 : at > bt ? 1 : 0;
  });

  // ── Modular sections pipeline ──────────────────────────────────────────────
  // To add a new section, implement buildXxxSection_(data) → HTML string,
  // then push { id: 'xxx', builder: buildXxxSection_, data: payload } here.
  // The HTML assembler (buildTravelDayEmailHtml_) never needs to change.
  // Compute flight insights once — feeds both HTML sections pipeline and plain-text path
  var cfg      = getConfigValues();
  var homeCity = String(cfg['weather_location'] || '').trim();
  var insights = buildTravelFlightInsightsData_(sortedItems, homeCity);

  var toneMode      = getTripToneMode_(tripKey);
  var narrativeData = buildTravelDayNarrativeData_(sortedItems, tripLabel, insights, toneMode);

  // Lounge access — extract departure/layover airports from flight rows
  var travelAirports = (function() {
    var flightRows = sortedItems.filter(function(r) { return String(r[2]||'').trim().toLowerCase() === 'flight'; });
    var airports = [];
    var seen = {};
    flightRows.forEach(function(r, i) {
      var meta = {};
      try { meta = JSON.parse(String(r[9]||'{}')); } catch(e) {}
      var orig = (meta.origin || '').trim().toUpperCase() || (String(r[7]||'').match(/\b([A-Z]{3})\b/)||[])[1] || '';
      var dest = (meta.dest   || '').trim().toUpperCase() || (String(r[7]||'').match(/\b([A-Z]{3})\b/g)||[]).slice(-1)[0] || '';
      if (orig && !seen[orig]) { seen[orig] = true; airports.push({ code: orig, role: i === 0 ? 'departure' : 'layover' }); }
      // dest is a layover only if there's another flight after this one; otherwise it's the arrival (omitted)
      if (dest && !seen[dest] && i < flightRows.length - 1) { seen[dest] = true; airports.push({ code: dest, role: 'layover' }); }
    });
    return airports;
  })();
  var loungePerks = getLoungePerkPrograms_();
  var loungeData  = { lounges: [], tip: '' };
  if (loungePerks.length > 0 && travelAirports.length > 0) {
    try { loungeData = buildTravelLoungeData_(travelAirports, loungePerks); } catch (lErr) { Logger.log('lounge data error: ' + lErr.message); }
  }

  // Tomorrow flight preview + return-day detection — single sheet read for both
  var tomorrowFlights = [];
  var isReturnDay     = false;
  try {
    var _itSheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
    if (_itSheet && _itSheet.getLastRow() >= 2) {
      var _tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), tz, 'yyyy-MM-dd');
      var _allRows  = _itSheet.getRange(2, 1, _itSheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
      // Find the latest itinerary date for this trip → is today the final day?
      var _maxDate = '';
      _allRows.forEach(function(row) {
        if (String(row[1]||'').trim() !== tripKey) return;
        var rd = (row[4] instanceof Date && !isNaN(row[4].getTime()))
          ? Utilities.formatDate(row[4], tz, 'yyyy-MM-dd')
          : String(row[4]||'').trim();
        if (rd && rd > _maxDate) _maxDate = rd;
      });
      isReturnDay = (_maxDate !== '' && _maxDate === today);
      tomorrowFlights = _allRows.filter(function(row) {
        var rowDate = (row[4] instanceof Date && !isNaN(row[4].getTime()))
          ? Utilities.formatDate(row[4], tz, 'yyyy-MM-dd')
          : String(row[4] || '').trim();
        return String(row[1] || '').trim() === tripKey &&
               rowDate === _tomorrow &&
               String(row[2] || '').trim().toLowerCase() === 'flight';
      }).sort(function(a, b) {
        return String(a[5] || '') < String(b[5] || '') ? -1 : 1;
      });
    }
  } catch (tmrwErr) { Logger.log('tomorrow flights error (non-fatal): ' + tmrwErr.message); }
  // Attach return-day flag to insights so section builders can suppress stale pre-trip tips
  if (insights) { insights.isReturnDay = isReturnDay; }

  // Enrich once, share across the schedule + map sections (and plain text) \u2014
  // see enrichTravelItems_'s doc comment for why this can't happen per-section.
  var enrichedItems    = enrichTravelItems_(sortedItems);
  var directionsUrl    = buildTravelDirectionsUrl_(enrichedItems);
  var staticMapsApiKey = PropertiesService.getScriptProperties().getProperty('GOOGLE_STATIC_MAPS_API_KEY') || '';

  var sections = [
    { id: 'narrative',       builder: buildTravelNarrativeSection_,      data: narrativeData },
    { id: 'flight_insights', builder: buildTravelFlightInsightsSection_,  data: insights },
    { id: 'lounge_access',   builder: buildTravelLoungeSection_,          data: loungeData },
    // Future: { id: 'weather',       builder: buildTravelWeatherSection_,      data: null },
    // Future: { id: 'flight_status', builder: buildTravelFlightStatusSection_, data: null },
    { id: 'schedule',          builder: buildTravelScheduleSection_,      data: enrichedItems },
    { id: 'map',               builder: buildTravelMapSection_,           data: { items: enrichedItems, apiKey: staticMapsApiKey, directionsUrl: directionsUrl } },
    { id: 'tomorrow_flights',  builder: buildTravelTomorrowSection_,      data: tomorrowFlights },
    // Future: { id: 'group_notes',   builder: buildTravelGroupNotesSection_,   data: null },
  ];

  var recipients = getTravelDayRecipients_(tripKey);
  var subject    = '\u2708\uFE0F Travel Day \u2014 ' + tripLabel + ' \u00B7 ' + dateLabel;
  var htmlBody   = buildTravelDayEmailHtml_(tripLabel, dateLabel, sections);
  var plainText  = buildTravelDayPlainText_(tripLabel, dateLabel, sortedItems, insights, narrativeData, loungeData, directionsUrl);

  var travelCh = getNotifChannel_('travel_day_briefing');
  if (travelCh === 'email') {
    MailApp.sendEmail(recipients.join(','), subject, plainText, { name: 'Travel Briefing', htmlBody: htmlBody });
    Logger.log('TravelDayBriefing: sent email for "' + tripLabel + '" to ' + recipients.join(', '));
  } else {
    sendSlack_(travelCh, '✈️ *' + subject + '*\n\n' + plainText);
    Logger.log('TravelDayBriefing: sent Slack/' + travelCh + ' for "' + tripLabel + '"');
  }
}

// ---------------------------------------------------------------------------

/**
 * buildTravelDayEmailHtml_(tripLabel, dateLabel, sections)
 *
 * Builds a clean, brand-neutral travel day HTML email.
 * Design: travel blue (#1565c0) header, white card, light gray background.
 *
 * Architecture: header → sections pipeline → footer.
 * Each section is { id, builder, data } where builder(data) returns HTML or ''.
 * Empty returns are silently skipped; sections are separated by a divider line.
 *
 * @param {string} tripLabel  — Human-readable trip name, e.g. "Paris"
 * @param {string} dateLabel  — e.g. "Tuesday, March 25"
 * @param {Array}  sections   — [{ id, builder, data }] ordered pipeline
 * @returns {string} Full HTML email body
 */
function buildTravelDayEmailHtml_(tripLabel, dateLabel, sections) {
  var BLUE = '#1565c0';

  var html =
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f9;' +
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 0;">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;' +
    'border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);">' +

    // ── Blue header ──────────────────────────────────────────────────────────
    '<tr><td style="padding:32px 40px 28px;background:' + BLUE + ';">' +
    '<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.7);' +
    'letter-spacing:2px;text-transform:uppercase;">Travel Day</p>' +
    '<p style="margin:0 0 4px;font-size:28px;font-weight:700;color:#ffffff;line-height:1.2;">' +
    escapeHtml_(tripLabel) + '</p>' +
    '<p style="margin:0;font-size:15px;color:rgba(255,255,255,0.85);">' +
    escapeHtml_(dateLabel) + '</p>' +
    '</td></tr>' +

    // ── Body open ────────────────────────────────────────────────────────────
    '<tr><td style="padding:32px 40px;">';

  // ── Section pipeline ──────────────────────────────────────────────────────
  // Adding a new section requires only:
  //   1. A buildXxxSection_(data) function that returns HTML or ''
  //   2. Pushing { id, builder, data } to the sections array in sendTravelDayBriefing_()
  // No changes to this assembler are ever needed.
  var sectionParts = [];
  sections.forEach(function(sec) {
    try {
      var s = sec.builder(sec.data);
      if (s && s.trim()) sectionParts.push(s);
    } catch (err) {
      Logger.log('TravelDayBriefing: section "' + sec.id + '" error — ' + err.message);
    }
  });
  html += sectionParts.join('<div style="height:1px;background:#f0f0f5;margin:20px 0;"></div>');

  // ── Data freshness notice (Issue #138) ───────────────────────────────────
  // This is the highest-stakes email VERA sends — anything shown here can change
  // what the user does at the airport, so a failed refresh must be stated plainly.
  try {
    var degradedTravel = getDegradedSources_();
    if (degradedTravel.length > 0) {
      html +=
        '<div style="margin-top:24px;padding:12px 14px;background:#fff8e6;border-left:3px solid #e8b44a;border-radius:4px;">' +
        '<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#8a6d1f;letter-spacing:0.5px;text-transform:uppercase;">' +
        '⚠️ Some data is not live</p>' +
        '<ul style="margin:0;padding-left:18px;font-size:13px;color:#6b5514;">' +
        degradedTravel.map(function(d) {
          return '<li style="margin:0 0 3px;">' + escapeHtml_(d.source) +
                 ' <span style="color:#999999;">(last good data: ' + escapeHtml_(d.staleForText) + ')</span></li>';
        }).join('') +
        '</ul>' +
        '<p style="margin:8px 0 0;font-size:12px;color:#6b5514;">' +
        'Confirm anything time-critical directly with the airline or provider.</p>' +
        '</div>';
    }
  } catch (staleErr) {
    Logger.log('TravelDayBriefing: staleness notice error — ' + staleErr.message);
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  html +=
    '</td></tr>' +
    '<tr><td style="padding:16px 40px;background:#f7f7fa;border-top:1px solid #eeeeee;">' +
    '<p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">' +
    'Have a great trip! \u2014 Sent automatically on travel day.' +
    '</p>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';

  return html;
}

// ---------------------------------------------------------------------------

/**
 * buildTravelScheduleSection_(enrichedItems)
 *
 * Section builder: renders all today's itinerary items sorted by start time.
 * Called by the section pipeline in buildTravelDayEmailHtml_().
 *
 * Icons by type:
 *   flight / plane         → ✈️
 *   hotel / accommodation  → 🏨
 *   car / rental / drive /
 *   transport / leave_by /
 *   buffer                 → 🚗
 *   train / rail           → 🚆
 *   activity / tour /
 *   sightseeing            → 🗺️
 *   dining / restaurant /
 *   lunch / dinner / food  → 🍽️
 *   default                → 📍
 *
 * Shows: title · time range · type label · location · conf# · notes
 *
 * @param {Array} enrichedItems — from enrichTravelItems_(), [{ row, details, displayAddress }]
 * @returns {string} HTML string, or '' if enrichedItems is empty
 */
function buildTravelScheduleSection_(enrichedItems) {
  if (!enrichedItems || !enrichedItems.length) {
    return '<p style="margin:0 0 16px;font-size:13px;color:#888;font-style:italic;">' +
      "Today's activities haven't been logged yet — add them in the VERA Travel tab.</p>";
  }
  var BLUE = '#1565c0';

  function typeIcon(t) {
    t = (t || '').toLowerCase();
    if (t === 'flight' || t === 'plane')           return '\u2708\uFE0F';
    if (t === 'hotel' || t === 'accommodation')    return '\uD83C\uDFE8';
    if (t === 'car'   || t === 'rental' || t === 'drive' ||
        t === 'transport' || t === 'leave_by' || t === 'buffer') return '\uD83D\uDE97';
    if (t === 'train' || t === 'rail')             return '\uD83D\uDE86';
    if (t === 'activity' || t === 'tour' || t === 'sightseeing') return '\uD83D\uDDFA\uFE0F';
    if (t === 'dining' || t === 'restaurant' ||
        t === 'lunch'  || t === 'dinner' || t === 'food') return '\uD83C\uDF7D\uFE0F';
    return '\uD83D\uDCCD';
  }

  var html =
    '<p style="margin:0 0 16px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
    'letter-spacing:1.5px;text-transform:uppercase;">Today\'s Schedule</p>';

  enrichedItems.forEach(function(entry) {
    var row    = entry.row;
    var type   = String(row[2] || '').trim();
    var title  = String(row[3] || '').trim() || '(untitled)';
    var startT = String(row[5] || '').trim();
    var endT   = String(row[6] || '').trim();
    var loc    = String(row[7] || '').trim();
    var notes  = String(row[8] || '').trim();

    var timeStr = startT || 'All day';
    if (endT && endT !== startT) timeStr += ' \u2013 ' + endT;
    var typeLabel = type ? type.charAt(0).toUpperCase() + type.slice(1).toLowerCase() : '';

    // Already enriched once, up in enrichTravelItems_() — reused here (and by
    // buildTravelMapSection_) rather than re-fetched, since enrichment makes a
    // live Claude + web-search call per item, and doing that twice per item
    // per day would double the cost/latency for no benefit.
    var details        = entry.details;
    var displayAddress = entry.displayAddress;

    html +=
      '<div style="display:flex;align-items:flex-start;margin-bottom:22px;">' +
      '<div style="width:34px;flex-shrink:0;font-size:20px;padding-top:2px;">' +
      typeIcon(type) + '</div>' +
      '<div style="flex:1;">' +
      '<p style="margin:0 0 2px;font-size:15px;font-weight:600;color:#1a1a2e;">' +
      escapeHtml_(title) + '</p>' +
      '<p style="margin:0 0 3px;font-size:13px;color:#888888;">' +
      escapeHtml_(timeStr) +
      (typeLabel ? ' \u00B7 ' + escapeHtml_(typeLabel) : '') +
      '</p>';

    if (displayAddress) {
      html += '<p style="margin:0 0 6px;font-size:13px;color:#555555;">' +
              '\uD83D\uDCCD ' + escapeHtml_(displayAddress) + '</p>';
    }

    // \u2500\u2500 Details block \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (details && details.notFound) {
      html += '<p style="margin:0;font-size:12px;color:#aaaaaa;font-style:italic;">' +
              'No further details found \u2014 you may want to check manually.</p>';
    } else if (details) {
      var tableRows = [];
      function addRow_(label, val) {
        if (!val) return;
        tableRows.push(
          '<tr>' +
          '<td style="padding:3px 10px 3px 0;font-size:12px;font-weight:600;' +
          'color:#555555;white-space:nowrap;vertical-align:top;">' + label + '</td>' +
          '<td style="padding:3px 0;font-size:12px;color:#333333;vertical-align:top;">' +
          escapeHtml_(String(val)) + '</td>' +
          '</tr>'
        );
      }
      addRow_('Conf #',    details.confirmationNumber);
      addRow_('Seat',      details.seatAssignment);
      addRow_('Loyalty',   details.loyaltyNumber);
      addRow_('Address',   details.address !== loc ? details.address : null);
      addRow_('Directions',details.directions);
      addRow_('Parking',   details.parkingInfo);
      addRow_('Check-in',  details.checkInInstructions);
      addRow_('Contact',   details.contactPhone);
      addRow_('Wi-Fi',     details.wifiInfo);
      addRow_('Note',      details.importantNotes);
      if (notes) addRow_('Notes', notes);

      if (tableRows.length) {
        html +=
          '<table cellpadding="0" cellspacing="0" ' +
          'style="margin-top:2px;padding-top:6px;border-top:1px solid #f0f0f5;width:100%;">' +
          tableRows.join('') +
          '</table>';
      }
    } else {
      // Enrichment call failed \u2014 fall back to raw itinerary data
      var meta = {};
      if (row[9]) { try { meta = JSON.parse(String(row[9])); } catch (e_) {} }
      if (meta.confirmationNumber) {
        html += '<p style="margin:0 0 3px;font-size:12px;color:#888888;">' +
                'Conf# ' + escapeHtml_(String(meta.confirmationNumber)) + '</p>';
      }
      if (notes) {
        html += '<p style="margin:0;font-size:12px;color:#888888;font-style:italic;">' +
                escapeHtml_(notes) + '</p>';
      }
    }

    html += '</div></div>';
  });

  return html;
}

// ---------------------------------------------------------------------------

/**
 * enrichTravelItems_(items)
 *
 * Runs buildTravelItemDetailsData_() once per item and computes each item's
 * best-known address (enriched if it's more specific than the raw location
 * column, otherwise the raw location) up front. Both buildTravelScheduleSection_
 * and buildTravelMapSection_ consume this shared result rather than each
 * calling buildTravelItemDetailsData_() themselves — that call can make a
 * live Claude + web-search request per item, and doing it twice per item
 * per day would double the cost/latency for no benefit.
 *
 * @param {Array} items — sorted flat row array (all types)
 * @returns {Array} [{ row, details, displayAddress }]
 */
function enrichTravelItems_(items) {
  return (items || []).map(function(row) {
    var title = String(row[3] || '').trim() || '(untitled)';
    var loc   = String(row[7] || '').trim();

    var details = null;
    try { details = buildTravelItemDetailsData_(row); } catch (enrichErr) {
      Logger.log('TravelDayBriefing: enrichment error for "' + title + '": ' + enrichErr.message);
    }

    var displayAddress = loc;
    if (details && details.address && details.address !== loc &&
        details.address.length > loc.length) {
      displayAddress = details.address;
    }

    return { row: row, details: details, displayAddress: displayAddress };
  });
}

/**
 * buildTravelDirectionsUrl_(enrichedItems)
 *
 * Builds a Google Maps Directions URL chaining every item with a usable
 * address, in the day's existing chronological order — the first stop
 * becomes the origin, the last the destination, everything between becomes
 * a waypoint. Google resolves plain address/place text server-side when the
 * link is opened; no geocoding is needed here.
 *
 * @param {Array} enrichedItems — from enrichTravelItems_()
 * @returns {string|null} Directions URL, or null if fewer than 2 usable stops
 */
function buildTravelDirectionsUrl_(enrichedItems) {
  var stops = (enrichedItems || [])
    .map(function(e) { return e.displayAddress; })
    .filter(function(a) { return !!a; });
  if (stops.length < 2) return null;

  var origin      = encodeURIComponent(stops[0]);
  var destination = encodeURIComponent(stops[stops.length - 1]);
  var waypoints    = stops.slice(1, -1).map(encodeURIComponent).join('|');

  var url = 'https://www.google.com/maps/dir/?api=1&origin=' + origin +
            '&destination=' + destination;
  if (waypoints) url += '&waypoints=' + waypoints;
  return url;
}

/**
 * buildTravelStaticMapUrl_(enrichedItems, apiKey)
 *
 * Builds a Google Static Maps image URL with one marker per item that has a
 * usable address. Static Maps resolves plain address text server-side, same
 * as the Directions URL — no geocoding needed. Capped at 10 markers to keep
 * the URL length and rendered image reasonable.
 *
 * @param {Array} enrichedItems — from enrichTravelItems_()
 * @param {string} apiKey — GOOGLE_STATIC_MAPS_API_KEY script property
 * @returns {string|null} Static Maps image URL, or null if fewer than 2 usable stops or no key
 */
function buildTravelStaticMapUrl_(enrichedItems, apiKey) {
  if (!apiKey) return null;
  var stops = (enrichedItems || [])
    .map(function(e) { return e.displayAddress; })
    .filter(function(a) { return !!a; })
    .slice(0, 10);
  if (stops.length < 2) return null;

  var markers = stops.map(function(addr) {
    return 'markers=' + encodeURIComponent(addr);
  }).join('&');

  return 'https://maps.googleapis.com/maps/api/staticmap?size=600x300&scale=2&' +
         markers + '&key=' + apiKey;
}

/**
 * buildTravelMapSection_(data)
 *
 * Section builder: a static map image of today's stops, wrapped in a link to
 * live turn-by-turn Google Maps directions — the closest approximation of an
 * interactive map achievable inside an email (email clients strip
 * <script>/<iframe>, so a real interactive map can't render here at all;
 * see the dashboard's Map tab for that).
 *
 * Skipped entirely (returns '') if the Static Maps API key isn't configured —
 * that's a config issue, not something the reader can fix, so it matches the
 * "empty sections are silently dropped" convention every other section here
 * uses. But if fewer than 2 items have a usable address, that IS something
 * the reader can fix (log more stops with addresses), so this shows a short
 * explanatory line instead of silently vanishing.
 *
 * @param {{items: Array, apiKey: string, directionsUrl: string|null}} data
 * @returns {string}
 */
function buildTravelMapSection_(data) {
  var items          = (data && data.items) || [];
  var apiKey         = (data && data.apiKey) || '';
  var directionsUrl  = (data && data.directionsUrl) || null;

  if (!apiKey) return '';

  var usableStops = items.filter(function(e) { return !!(e && e.displayAddress); }).length;
  if (usableStops < 2 || !directionsUrl) {
    return (
      '<p style="margin:24px 0 16px;font-size:11px;font-weight:700;color:#1565c0;' +
      'letter-spacing:1.5px;text-transform:uppercase;">Today\'s Route</p>' +
      '<p style="margin:0;font-size:12.5px;color:#999999;font-style:italic;">' +
      'Not enough stops with addresses logged today to build a route map — ' +
      'add at least 2 items with addresses in the VERA Travel tab and it\'ll show up next time.' +
      '</p>'
    );
  }

  var mapUrl = buildTravelStaticMapUrl_(items, apiKey);
  if (!mapUrl) return ''; // apiKey present + 2+ stops but build still failed — unexpected, stay silent rather than show a broken image

  return (
    '<p style="margin:24px 0 16px;font-size:11px;font-weight:700;color:#1565c0;' +
    'letter-spacing:1.5px;text-transform:uppercase;">Today\'s Route</p>' +
    '<a href="' + directionsUrl + '" style="display:block;text-decoration:none;">' +
    '<img src="' + mapUrl + '" alt="Map of today\'s stops" width="600" ' +
    'style="width:100%;max-width:600px;border-radius:8px;display:block;" /></a>' +
    '<p style="margin:8px 0 0;font-size:12px;color:#888888;">' +
    'Tap the map for turn-by-turn directions</p>'
  );
}

// ---------------------------------------------------------------------------

/**
 * buildTravelItemDetailsData_(row)
 *
 * Enriches one itinerary row with actionable day-of details.
 * Priority: (1) existing Metadata JSON from col 9, (2) Claude + web search
 * for gaps when the item is sparse and not a flight.
 *
 * Returns a details object with fields: confirmationNumber, address,
 * directions, parkingInfo, checkInInstructions, contactPhone, wifiInfo,
 * cancellationPolicy, specialRequests, importantNotes, seatAssignment,
 * mealPreference, loyaltyNumber, notFound.
 * notFound=true only when there is genuinely nothing to show.
 *
 * @param {Array} row — one Itinerary sheet row
 * @returns {Object}
 */
function buildTravelItemDetailsData_(row) {
  var type  = String(row[2] || '').trim().toLowerCase();
  var title = String(row[3] || '').trim();
  var tz    = Session.getScriptTimeZone();
  var date  = (row[4] instanceof Date && !isNaN(row[4].getTime()))
    ? Utilities.formatDate(row[4], tz, 'yyyy-MM-dd')
    : String(row[4] || '').trim();
  var loc   = String(row[7] || '').trim();
  var meta  = {};
  if (row[9]) { try { meta = JSON.parse(String(row[9])); } catch (e_) {} }

  // ── Step 1: pull all already-known fields from metadata ────────────────────
  var details = {
    confirmationNumber:  meta.confirmationNumber  || null,
    address:             loc                      || null,
    directions:          null,
    parkingInfo:         meta.parkingInfo         || null,
    checkInInstructions: meta.checkInInstructions || null,
    contactPhone:        meta.contactPhone        || null,
    wifiInfo:            meta.wifiInfo            || null,
    importantNotes:      meta.importantNotes      || null,
    seatAssignment:      meta.seatAssignment      || null,
    loyaltyNumber:       meta.loyaltyNumber       || null,
    notFound:            false,
  };

  // ── Step 2: heuristic — skip enrichment for flights and already-rich items ─
  // A "rich" item has a street-level address (digit present) + 2+ detail fields.
  var hasStreetAddress = /\d/.test(loc);
  var metaFieldCount = ['confirmationNumber','parkingInfo','checkInInstructions',
                        'contactPhone','wifiInfo']
                       .filter(function(k) { return !!meta[k]; }).length;
  var isFlight = (type === 'flight' || type === 'plane');
  var needsEnrichment = !isFlight && !(hasStreetAddress && metaFieldCount >= 2);

  if (!needsEnrichment) {
    Logger.log('TravelDayBriefing details: "' + title + '" — itinerary data only');
    return details;
  }

  // ── Step 3: Claude + web search for missing details ────────────────────────
  Logger.log('TravelDayBriefing details: enriching "' + title + '" via Claude/web-search');
  var sysprompt =
    'You are VERA, a personal chief-of-staff AI. Find concrete, actionable day-of ' +
    'details for the given itinerary item. The goal is offline survival info — ' +
    'things the user needs if they have no cell service: address to navigate to, ' +
    'directions, a phone number to call, parking, check-in instructions. ' +
    'Be honest — if you cannot confidently determine something, set it to null. ' +
    'Do NOT guess or hallucinate addresses or phone numbers. ' +
    'Use the web_search tool if available to look up accurate information. ' +
    'Respond ONLY with a valid JSON object, no markdown, no preamble.';

  var knownParts = [];
  if (details.confirmationNumber) knownParts.push('confirmation: ' + details.confirmationNumber);
  if (details.address)            knownParts.push('location (may be city-only): ' + details.address);
  var knownStr = knownParts.length ? '\nAlready known: ' + knownParts.join('; ') : '';

  var userprompt =
    'Find day-of details for this itinerary item:\n' +
    'Title: ' + title + '\n' +
    'Type: ' + (type || 'unknown') + '\n' +
    'Date: ' + date + knownStr + '\n\n' +
    'Return ONLY a JSON object with these fields (null if unknown/uncertain):\n' +
    '{\n' +
    '  "address": "full street address or null",\n' +
    '  "directions": "brief how-to-get-there note or null",\n' +
    '  "contactPhone": "venue/reservation phone or null",\n' +
    '  "parkingInfo": "parking details or null",\n' +
    '  "importantNotes": "one key arrival tip or null",\n' +
    '  "found": true or false\n' +
    '}\n' +
    'Set found=false if you genuinely cannot find useful details for this item.';

  var rawText = callClaudeWithWebSearch_(sysprompt, userprompt, 512);
  if (!rawText) {
    details.notFound = !hasAnyDetails_(details);
    return details;
  }

  // Parse JSON from Claude's response
  var enriched = null;
  try {
    var cleaned = rawText.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    var start = cleaned.indexOf('{'); var end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) enriched = JSON.parse(cleaned.substring(start, end + 1));
  } catch (parseErr) {
    Logger.log('TravelDayBriefing details: JSON parse failed for "' + title + '": ' + parseErr.message);
  }

  if (enriched) {
    // Merge — only fill nulls, never overwrite existing itinerary data
    if (!details.address    && enriched.address)       details.address       = enriched.address;
    if (!details.directions && enriched.directions)    details.directions    = enriched.directions;
    if (!details.contactPhone && enriched.contactPhone) details.contactPhone = enriched.contactPhone;
    if (!details.parkingInfo  && enriched.parkingInfo)  details.parkingInfo  = enriched.parkingInfo;
    if (!details.importantNotes && enriched.importantNotes) details.importantNotes = enriched.importantNotes;
    if (enriched.found === false && !hasAnyDetails_(details)) details.notFound = true;
  } else {
    if (!hasAnyDetails_(details)) details.notFound = true;
  }

  return details;
}

/** Returns true if at least one actionable detail field has a value. */
function hasAnyDetails_(details) {
  return !!(details.confirmationNumber || details.address || details.directions ||
            details.parkingInfo || details.checkInInstructions || details.contactPhone ||
            details.wifiInfo || details.importantNotes || details.seatAssignment ||
            details.loyaltyNumber);
}

// ---------------------------------------------------------------------------

/**
 * getTravelDayRecipients_(tripKey)
 *
 * Returns the list of email addresses for the briefing.
 * Always includes CONFIG.MORNING_NUDGE_EMAIL (Ahmed).
 * Also reads 'travel_companions' from Config tab (comma-separated).
 *
 * Future: can read per-trip companions from TripMeta Traveler column via tripKey.
 *
 * @param {string} tripKey — for future per-trip companion lookup
 * @returns {string[]} deduped, non-empty array of email addresses
 */
function getTravelDayRecipients_(tripKey) {
  var cfg        = getConfigValues();
  var companions = String(cfg['travel_companions'] || '');
  var emails     = [CONFIG.MORNING_NUDGE_EMAIL];

  companions.split(',').forEach(function(addr) {
    addr = addr.trim();
    if (addr && emails.indexOf(addr) === -1) emails.push(addr);
  });

  // Future: read per-trip companions from TripMeta Traveler column
  // var metaRow = getTripMetaRow_(tripKey);
  // if (metaRow && metaRow.traveler) { ... }

  return emails.filter(Boolean);
}

// ---------------------------------------------------------------------------

/**
 * buildTravelDayPlainText_(tripLabel, dateLabel, items, insights, narrativeData, loungeData, directionsUrl)
 * Plain-text fallback for email clients that don't render HTML, and for Slack.
 * @param {Object|null} insights      — optional result from buildTravelFlightInsightsData_()
 * @param {Object|null} loungeData    — optional result from buildTravelLoungeData_()
 * @param {string|null} directionsUrl — optional result from buildTravelDirectionsUrl_(), same value used in the HTML map section
 */
function buildTravelDayPlainText_(tripLabel, dateLabel, items, insights, narrativeData, loungeData, directionsUrl) {
  var lines = [
    '\u2708\uFE0F Travel Day \u2014 ' + tripLabel,
    dateLabel,
    '',
  ];

  // Tagline block (Napa email ~~ ... ~~ style)
  if (narrativeData && narrativeData.tagline) {
    lines.push('~~');
    lines.push(narrativeData.tagline);
    lines.push('~~');
    lines.push('');
  }

  // VERA narrative
  if (narrativeData && narrativeData.narrative) {
    lines.push(narrativeData.narrative);
    lines.push('');
  }

  // ── Useful to Know block ──────────────────────────────────────────────────
  if (insights) {
    lines.push('USEFUL TO KNOW');
    lines.push('--------------');
    if (insights.origin_code && insights.dest_code) {
      lines.push('\u23F0 Timezone:    ' + insights.origin_code + ' \u2192 ' +
        insights.dest_code + '  ' + (insights.tz_offset_label || ''));
    }
    if (insights.distance_miles) {
      lines.push('\uD83D\uDCCF Distance:    ~' +
        Number(insights.distance_miles).toLocaleString() + ' miles' +
        (insights.haul_category ? ' \u00B7 ' + insights.haul_category : ''));
    }
    if (insights.daynight_pct_day != null) {
      var filled = Math.round(insights.daynight_pct_day / 10);
      var bar    = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
      lines.push('\uD83C\uDF17 Your flight: ' + bar + '  ' + insights.daynight_pct_day + '% daytime');
    }
    if (insights.dep_local && insights.arr_local) {
      lines.push('\uD83D\uDEEB Times:       ' + insights.dep_local + ' \u2192 ' + insights.arr_local);
    }
    if (insights.pre_trip_tip && !insights.isReturnDay) {
      lines.push('\uD83D\uDCC5 Before you go: ' + insights.pre_trip_tip);
    }
    if (insights.arrival_tip) {
      lines.push('\uD83D\uDCA4 On arrival:    ' + insights.arrival_tip);
    }
    lines.push('');
  }

  // \u2500\u2500 Lounge Access block \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (loungeData && loungeData.lounges && loungeData.lounges.length) {
    lines.push('LOUNGE ACCESS');
    lines.push('-------------');
    loungeData.lounges.forEach(function(lounge) {
      var name = lounge.lounge_name || 'Airport Lounge';
      var role = lounge.role ? ' (' + lounge.role + ')' : '';
      lines.push(name + role);
      if (lounge.airport_code) lines.push('  ' + lounge.airport_code + (lounge.terminal ? ' \u00B7 Terminal ' + lounge.terminal : ''));
      if (lounge.hours)        lines.push('  Hours: ' + lounge.hours);
      if (lounge.card)         lines.push('  Access: ' + lounge.card + (lounge.program ? ' \u00B7 ' + lounge.program : ''));
      if (lounge.guest_limit)  lines.push('  Guests: ' + lounge.guest_limit);
    });
    if (loungeData.tip) lines.push('\uD83D\uDCA1 ' + loungeData.tip);
    lines.push('');
  }

  lines.push("TODAY'S SCHEDULE");
  lines.push('----------------');

  if (!items || !items.length) {
    lines.push("Today's activities haven't been logged yet.");
    lines.push('Add them in the VERA Travel tab \u2192 Itinerary.');
  } else {
    items.forEach(function(row) {
      var type   = String(row[2] || '').trim();
      var title  = String(row[3] || '').trim() || '(untitled)';
      var startT = String(row[5] || '').trim();
      var endT   = String(row[6] || '').trim();
      var loc    = String(row[7] || '').trim();
      var notes  = String(row[8] || '').trim();
      var meta   = {};
      if (row[9]) { try { meta = JSON.parse(String(row[9])); } catch(e_) {} }

      var time = (startT || 'All day') + (endT && endT !== startT ? ' \u2013 ' + endT : '');
      var line = time + '  [' + (type || 'event') + ']  ' + title;
      if (loc)  line += '\n  Location: ' + loc;
      if (meta.confirmationNumber) line += '\n  Conf#: ' + String(meta.confirmationNumber);
      if (notes) line += '\n  Note: ' + notes;
      lines.push(line);
    });
  }

  if (directionsUrl) {
    lines.push('');
    lines.push("TODAY'S ROUTE");
    lines.push('-------------');
    lines.push(directionsUrl);
  }

  // Tip from narrative
  if (narrativeData && narrativeData.tip) {
    lines.push('');
    lines.push('Tip: ' + narrativeData.tip);
  }

  lines.push('', 'Have a great trip!');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------

/**
 * webSendTravelBriefing_(e)
 * Manual trigger from the dashboard or direct URL.
 * GET ?action=send_travel_briefing&tripKey=YYYY-MM-DD|TripLabel&token=...
 *
 * Sends the briefing for a specific tripKey using today's itinerary items.
 * Useful for testing, or resending after a recipient list change.
 */
function webSendTravelBriefing_(e) {
  var tripKey = (e && e.parameter && e.parameter.tripKey) || '';
  if (!tripKey) return { ok: false, error: 'Missing tripKey parameter' };

  try {
    var ss    = getSpreadsheet();
    var sheet = ss.getSheetByName(TABS.ITINERARY);
    if (!sheet || sheet.getLastRow() < 2) {
      return { ok: false, error: 'Itinerary tab is empty' };
    }

    var tz    = Session.getScriptTimeZone();
    var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var data  = sheet.getRange(2, 1, sheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();

    var items = data.filter(function(row) {
      var rowDate = (row[4] instanceof Date && !isNaN(row[4].getTime()))
        ? Utilities.formatDate(row[4], tz, 'yyyy-MM-dd')
        : String(row[4] || '').trim();
      return String(row[1] || '').trim() === tripKey && rowDate === today;
    });

    if (!items.length) {
      return { ok: false, error: 'No itinerary items found for tripKey "' + tripKey + '" on ' + today };
    }

    sendTravelDayBriefing_(tripKey, items);

    var parts     = tripKey.split('|');
    var tripLabel = parts.length > 1 ? parts.slice(1).join('|') : tripKey;
    return { ok: true, message: 'Travel Day Briefing sent for: ' + tripLabel };
  } catch (err) {
    Logger.log('webSendTravelBriefing_ error: ' + err.message);
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Flight Insights ("Useful to Know") section — Issue #195
// ---------------------------------------------------------------------------

/**
 * buildTravelFlightInsightsData_(sortedItems, homeCity)
 *
 * Calls Claude to compute timezone, distance, day-night ratio, and local times
 * for the first flight found in today's itinerary items.
 *
 * Returns a parsed insights object or null (on error / no flight / disabled).
 * Called once in sendTravelDayBriefing_() and threaded to both HTML + plain-text.
 *
 * @param {Array}  sortedItems  — today's Itinerary rows sorted by start time
 * @param {string} homeCity     — from Config 'weather_location', e.g. "Washington DC"
 * @returns {Object|null}
 */
function buildTravelFlightInsightsData_(sortedItems, homeCity) {
  try {
    var cfg = getConfigValues();
    if (String(cfg['sleep_tz_advisor_enabled'] || 'true').toLowerCase() === 'false') {
      return null;
    }

    // Find first flight row
    var flight = null;
    for (var i = 0; i < sortedItems.length; i++) {
      var t = String(sortedItems[i][2] || '').toLowerCase().trim();
      if (t === 'flight' || t === 'plane') { flight = sortedItems[i]; break; }
    }
    if (!flight) return null;

    var meta = {};
    if (flight[9]) { try { meta = JSON.parse(String(flight[9])); } catch(e_) {} }

    // Extract IATA codes: prefer meta.origin/meta.dest, fall back to location field
    function iataFromLocation(loc) {
      var codes = (loc || '').match(/\b([A-Z]{3})\b/g) || [];
      return codes;
    }
    var locCodes = iataFromLocation(String(flight[7] || ''));
    var origin   = meta.origin || locCodes[0] || null;
    var dest     = meta.dest   || (locCodes.length > 1 ? locCodes[locCodes.length - 1] : null);

    var depTime  = meta.dep_scheduled || String(flight[5] || '').trim();
    var arrTime  = meta.arr_scheduled || String(flight[6] || '').trim();
    var flightDate = (function() {
      var d = flight[4];
      if (d instanceof Date && !isNaN(d.getTime())) {
        return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      return String(d || '').trim();
    }());

    var prompt =
      'You are a flight insights assistant. A traveler is flying today.\n' +
      'Origin airport: ' + (origin || 'unknown') + '\n' +
      'Destination airport: ' + (dest || 'unknown') + '\n' +
      'Home city (for timezone reference): ' + (homeCity || 'unknown') + '\n' +
      'Flight date: ' + (flightDate || 'today') + '\n' +
      (depTime ? 'Departure time (local to origin airport): ' + depTime + '\n' : '') +
      (arrTime ? 'Arrival time (local to destination airport): ' + arrTime + '\n' : '') +
      'Home IANA timezone: ' + Session.getScriptTimeZone() + '\n\n' +
      'Return ONLY a valid JSON object with exactly these fields (no explanation):\n' +
      '{\n' +
      '  "origin_code": "IATA code or null",\n' +
      '  "origin_local_time": "dep time formatted as h:MM AM/PM in origin local time, or null",\n' +
      '  "dest_code": "IATA code or null",\n' +
      '  "dest_local_time": "arr time formatted as h:MM AM/PM in destination local time, or null",\n' +
      '  "tz_offset_hours": number (positive=ahead of home, negative=behind; 0 if same timezone),\n' +
      '  "tz_offset_label": "e.g. +5h or -3h or same timezone",\n' +
      '  "pre_trip_tip": "1 sentence: what to do in the days before departure to prepare — direction-specific (west = shift bedtime earlier, east = stay up later; say no adjustment needed if same tz)",\n' +
      '  "arrival_tip": "REQUIRED — write exactly 1 sentence of specific advice for after landing. Never return null. Westward flight: advise staying awake until local bedtime to reset the body clock. Eastward flight: advise avoiding naps and going to sleep at local time. Same timezone: write that no adjustment is needed but getting morning sunlight helps.",\n' +
      '  "distance_miles": number (great-circle miles, integer),\n' +
      '  "haul_category": "Short-haul or Medium-haul or Long-haul or Ultra-long-haul",\n' +
      '  "daynight_pct_day": integer 0-100 (% of flight time in daylight based on route and departure time),\n' +
      '  "dep_local": "e.g. 10:30 AM (IAD) or null",\n' +
      '  "arr_local": "e.g. 11:45 PM (LHR) or null"\n' +
      '}\n' +
      'Haul categories: Short-haul <1500 mi, Medium-haul 1500-3500 mi, Long-haul 3500-7000 mi, Ultra-long-haul >7000 mi.';

    var result = callClaudeJson_(prompt, null);
    if (!result || typeof result !== 'object') return null;

    // Attach raw offset for recovery-day calculations by the dashboard card
    if (typeof result.tz_offset_hours !== 'number') result.tz_offset_hours = 0;
    return result;

  } catch (err) {
    Logger.log('buildTravelFlightInsightsData_ error (non-fatal): ' + err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------

/**
 * buildTravelFlightInsightsSection_(insights)
 *
 * HTML section builder for the "Useful to Know" panel in the travel day email.
 * Registered in the sections pipeline as { id: 'flight_insights', builder: buildTravelFlightInsightsSection_, data: insights }.
 *
 * @param {Object|null} insights  — result from buildTravelFlightInsightsData_(), or null
 * @returns {string} HTML string, or '' if insights is null
 */
function buildTravelFlightInsightsSection_(insights) {
  if (!insights) return '';

  var BLUE  = '#1565c0';
  var DARK  = '#111111';
  var GREY  = '#555555';
  var LGREY = '#888888';

  var html =
    '<p style="margin:0 0 16px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
    'letter-spacing:1.5px;text-transform:uppercase;">Useful to Know</p>';

  // Helper: one row in the insights table
  function row(emoji, label, value) {
    if (!value) return '';
    return (
      '<tr>' +
      '<td style="padding:4px 8px 4px 0;font-size:13px;width:20px;vertical-align:top;">' + emoji + '</td>' +
      '<td style="padding:4px 8px 4px 0;font-size:12px;color:' + LGREY + ';white-space:nowrap;vertical-align:top;">' + label + '</td>' +
      '<td style="padding:4px 0;font-size:13px;color:' + DARK + ';vertical-align:top;">' + value + '</td>' +
      '</tr>'
    );
  }

  html += '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">';

  // ⏰ Timezone
  if (insights.origin_code && insights.dest_code && insights.tz_offset_label) {
    var tzVal = escapeHtml_(insights.origin_code) + ' → ' +
      escapeHtml_(insights.dest_code) + ' &nbsp;<strong>' +
      escapeHtml_(insights.tz_offset_label) + '</strong>';
    html += row('⏰', 'Timezone', tzVal);
  }

  // 📏 Distance
  if (insights.distance_miles) {
    var distVal = '~' + Number(insights.distance_miles).toLocaleString() + ' miles';
    if (insights.haul_category) {
      distVal += ' &nbsp;<span style="font-size:11px;color:' + LGREY + ';background:#f0f0f5;' +
        'padding:2px 6px;border-radius:10px;">' + escapeHtml_(insights.haul_category) + '</span>';
    }
    html += row('📏', 'Distance', distVal);
  }

  // 🌗 Day-night ratio
  if (insights.daynight_pct_day != null) {
    var pct    = Math.max(0, Math.min(100, Math.round(insights.daynight_pct_day)));
    var dayW   = pct;
    var nightW = 100 - pct;
    var barHtml =
      '<table cellpadding="0" cellspacing="0" style="display:inline-table;vertical-align:middle;' +
      'border-radius:4px;overflow:hidden;width:120px;">' +
      '<tr>' +
      (dayW   > 0 ? '<td style="width:' + dayW   + '%;height:8px;background:#e8b44a;"></td>' : '') +
      (nightW > 0 ? '<td style="width:' + nightW + '%;height:8px;background:#2a2a3a;"></td>' : '') +
      '</tr></table>' +
      '&nbsp;<span style="font-size:12px;color:' + LGREY + ';">' + pct + '% daytime</span>';
    html += row('🌗', 'Your flight', barHtml);
  }

  // 🛫 Local times
  if (insights.dep_local && insights.arr_local) {
    var timesVal = escapeHtml_(insights.dep_local) + ' → ' + escapeHtml_(insights.arr_local);
    html += row('🛫', 'Times', timesVal);
  }

  html += '</table>';

  // Tips (full width below table)
  if (insights.pre_trip_tip && !insights.isReturnDay) {
    html +=
      '<p style="margin:8px 0 0;font-size:13px;color:' + GREY + ';font-style:italic;' +
      'padding:8px 12px;background:#f7f7fa;border-left:3px solid ' + BLUE + ';border-radius:0 4px 4px 0;">' +
      '📅 <strong>Before you go:</strong> ' + escapeHtml_(insights.pre_trip_tip) + '</p>';
  }
  if (insights.arrival_tip) {
    html +=
      '<p style="margin:6px 0 0;font-size:13px;color:' + GREY + ';font-style:italic;' +
      'padding:8px 12px;background:#f7f7fa;border-left:3px solid ' + BLUE + ';border-radius:0 4px 4px 0;">' +
      '💤 <strong>On arrival:</strong> ' + escapeHtml_(insights.arrival_tip) + '</p>';
  }

  return html;
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Lounge Access section — Issue #187
// ---------------------------------------------------------------------------

/**
 * getLoungePerkPrograms_()
 *
 * Reads TABS.CARD_PERKS and TABS.CREDIT_CARDS.
 * Returns deduplicated array of lounge program objects for active cards.
 * Returns [] if the sheet is missing, empty, or no lounge perks found.
 *
 * @returns {Array} [{ program: string, card: string }, ...]
 */
function getLoungePerkPrograms_() {
  try {
    var ss = getSpreadsheet();

    // Build set of active card names from Credit Cards sheet
    var ccSheet = ss.getSheetByName(TABS.CREDIT_CARDS);
    var activeCards = {};
    if (ccSheet && ccSheet.getLastRow() >= 2) {
      var ccData = ccSheet.getRange(2, 1, ccSheet.getLastRow() - 1, 10).getValues();
      ccData.forEach(function(row) {
        var cardName = String(row[1] || '').trim();
        var active   = String(row[9] || '').trim().toLowerCase();
        if (cardName && active !== 'false' && active !== 'no' && active !== '0') {
          activeCards[cardName.toLowerCase()] = cardName;
        }
      });
    }

    // Read Card Perks sheet; headers: ID, Card Name, Perk, Amount, Frequency, Category, Last Used
    var cpSheet = ss.getSheetByName(TABS.CARD_PERKS);
    if (!cpSheet || cpSheet.getLastRow() < 2) return [];

    var cpData = cpSheet.getRange(2, 1, cpSheet.getLastRow() - 1, 7).getValues();
    var loungeKeywords = ['lounge', 'priority pass', 'centurion', 'capital one lounge'];

  // Tagline block (Napa email ~~ ... ~~ style)
  if (narrativeData && narrativeData.tagline) {
    lines.push('~~');
    lines.push(narrativeData.tagline);
    lines.push('~~');
    lines.push('');
  }

  // VERA narrative
  if (narrativeData && narrativeData.narrative) {
    lines.push(narrativeData.narrative);
    lines.push('');
  }

    var results = [];
    var seen    = {};

    cpData.forEach(function(row) {
      var cardName = String(row[1] || '').trim();
      var perkName = String(row[2] || '').trim();
      if (!cardName || !perkName) return;

      // Only include perks for active cards (or if Credit Cards sheet is empty/missing)
      var isActive = Object.keys(activeCards).length === 0 ||
                     !!activeCards[cardName.toLowerCase()];
      if (!isActive) return;

      var perkLower = perkName.toLowerCase();
      var matchedProgram = null;
      loungeKeywords.forEach(function(kw) {
        if (!matchedProgram && perkLower.indexOf(kw) !== -1) {
          // Normalize program name
          if (perkLower.indexOf('centurion') !== -1) {
            matchedProgram = 'Centurion Lounge';
          } else if (perkLower.indexOf('priority pass') !== -1) {
            matchedProgram = 'Priority Pass';
          } else if (perkLower.indexOf('capital one') !== -1) {
            matchedProgram = 'Capital One Lounge';
          } else {
            matchedProgram = perkName; // use raw perk name as program label
          }
        }
      });

      if (!matchedProgram) return;

      var key = matchedProgram + '|' + cardName;
      if (!seen[key]) {
        seen[key] = true;
        results.push({ program: matchedProgram, card: cardName });
      }
    });

    return results;
  } catch (err) {
    Logger.log('getLoungePerkPrograms_ error (non-fatal): ' + err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------

/**
 * buildTravelLoungeData_(airports, loungePerks)
 *
 * Calls Claude to look up lounges at the given airports for the given programs.
 * Only departure and layover airports are passed; arrivals are excluded.
 *
 * @param {Array} airports    — [{ code: 'IAD', role: 'departure'|'layover' }, ...]
 * @param {Array} loungePerks — result of getLoungePerkPrograms_()
 * @returns {{ lounges: Array, tip: string }}
 */
function buildTravelLoungeData_(airports, loungePerks) {
  var programList = loungePerks.map(function(p) {
    return p.program + ' (via ' + p.card + ')';
  }).join(', ');

  var airportList = airports.map(function(a) {
    return a.code + ' (' + a.role + ')';
  }).join(', ');

  var prompt =
    'You are a travel assistant with detailed knowledge of airport lounges worldwide.\n' +
    'Ahmed holds the following lounge access programs: ' + programList + '.\n' +
    'Today\'s relevant airports (departure and layovers only): ' + airportList + '.\n\n' +
    'For each airport, list only the lounges Ahmed can access through his programs.\n' +
    'IMPORTANT: Only include lounges you are CONFIDENT exist and are accessible through these specific programs.\n' +
    'If you are not certain a lounge exists at an airport for a given program, OMIT it entirely — do not guess.\n' +
    'If no lounges are confidently known, return { "lounges": [], "tip": "" }.\n\n' +
    'For guest_limit: state the exact cap and any per-guest fee (e.g. "2 guests at no charge; additional guests $50 each").\n' +
    'For access_window: state any time restriction on entry (e.g. "Must enter at least 1 hour before close").\n' +
    'If there are multiple lounges at the same airport, the tip should compare them (e.g. which is better for guests).\n\n' +
    'Return ONLY a valid JSON object (no markdown, no preamble):\n' +
    '{\n' +
    '  "lounges": [\n' +
    '    {\n' +
    '      "airport_code": "IAD",\n' +
    '      "airport_name": "Washington Dulles International",\n' +
    '      "role": "departure",\n' +
    '      "program": "Priority Pass",\n' +
    '      "card": "AMEX Platinum",\n' +
    '      "lounge_name": "Club at IAD",\n' +
    '      "terminal": "C",\n' +
    '      "location_notes": "Airside, past security",\n' +
    '      "hours": "5:00 AM – 10:00 PM",\n' +
    '      "guest_limit": "Guest fee: $32/person" or null,\n' +
    '      "access_window": "Must enter at least 1 hour before close" or null,\n' +
    '      "access_notes": "Capacity limits apply — check app before visiting" or null\n' +
    '    }\n' +
    '  ],\n' +
    '  "tip": "One sentence tip — compare lounge options at the same airport if applicable, otherwise general advice. Empty string if nothing useful."\n' +
    '}';

  var result = callClaudeJson_(prompt, null);
  if (!result || typeof result !== 'object') return { lounges: [], tip: '' };
  if (!Array.isArray(result.lounges)) result.lounges = [];
  if (typeof result.tip !== 'string') result.tip = '';
  return result;
}

// ---------------------------------------------------------------------------

/**
 * buildTravelLoungeSection_(data)
 *
 * HTML section builder for the "🛋️ Lounge Access" panel.
 * Returns '' if data.lounges is empty (section skipped silently by pipeline).
 *
 * @param {{ lounges: Array, tip: string }} data
 * @returns {string} HTML string or ''
 */
function buildTravelLoungeSection_(data) {
  if (!data || !data.lounges || !data.lounges.length) return '';

  var BLUE  = '#1565c0';
  var DARK  = '#111111';
  var GREY  = '#555555';
  var LGREY = '#888888';

  var html =
    '<p style="margin:0 0 16px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
    'letter-spacing:1.5px;text-transform:uppercase;">🛋️ Lounge Access</p>';

  data.lounges.forEach(function(lounge, i) {
    var airportLabel = lounge.airport_code
      ? escapeHtml_(lounge.airport_code) + (lounge.airport_name ? ' — ' + escapeHtml_(lounge.airport_name) : '')
      : '';
    var roleLabel = lounge.role
      ? ' <span style="font-size:11px;color:' + LGREY + ';background:#f0f0f5;padding:2px 6px;border-radius:10px;">' +
        escapeHtml_(lounge.role.charAt(0).toUpperCase() + lounge.role.slice(1)) + '</span>'
      : '';
    var accessVia = (lounge.card ? escapeHtml_(lounge.card) : '') +
                   (lounge.program ? ' · ' + escapeHtml_(lounge.program) : '');

    html +=
      (i > 0 ? '<div style="height:1px;background:#f0f0f5;margin:12px 0;"></div>' : '') +
      '<div style="margin-bottom:4px;">' +
      '<p style="margin:0 0 2px;font-size:14px;font-weight:600;color:' + DARK + ';">' +
      escapeHtml_(lounge.lounge_name || 'Airport Lounge') + roleLabel + '</p>' +
      (airportLabel ? '<p style="margin:0 0 4px;font-size:12px;color:' + LGREY + ';">' + airportLabel + '</p>' : '') +
      '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">';

    var AMBER = '#a05c00';

    function loungeRow(label, val, warnColor) {
      if (!val) return '';
      var valColor = warnColor || GREY;
      return '<tr>' +
        '<td style="padding:2px 8px 2px 0;font-size:12px;font-weight:600;color:' + LGREY + ';white-space:nowrap;vertical-align:top;">' + label + '</td>' +
        '<td style="padding:2px 0;font-size:12px;color:' + valColor + ';vertical-align:top;">' + escapeHtml_(String(val)) + '</td>' +
        '</tr>';
    }

    html += loungeRow('Terminal',  lounge.terminal);
    html += loungeRow('Location',  lounge.location_notes);
    html += loungeRow('Hours',     lounge.hours);
    html += loungeRow('Access',    accessVia || null);
    html += loungeRow('Guests',    lounge.guest_limit   ? '⚠ ' + lounge.guest_limit   : null, AMBER);
    html += loungeRow('Note',      lounge.access_window ? '⚠ ' + lounge.access_window : (lounge.access_notes || null), lounge.access_window ? AMBER : null);

    html += '</table></div>';
  });

  if (data.tip) {
    html +=
      '<p style="margin:12px 0 0;font-size:13px;color:' + GREY + ';font-style:italic;' +
      'padding:8px 12px;background:#f7f7fa;border-left:3px solid ' + BLUE + ';border-radius:0 4px 4px 0;">' +
      '💡 ' + escapeHtml_(data.tip) + '</p>';
  }

  return html;
}

// ---------------------------------------------------------------------------

/**
 * buildTravelTomorrowSection_(tomorrowFlights)
 *
 * HTML section builder for a compact "Coming Up Tomorrow" flight preview.
 * Visually recessed (light background, muted label) to signal preview context —
 * not today's action items. Returns '' if array is empty.
 *
 * @param {Array} tomorrowFlights — Itinerary rows for tomorrow's flights (same trip)
 * @returns {string} HTML string or ''
 */
function buildTravelTomorrowSection_(tomorrowFlights) {
  if (!tomorrowFlights || !tomorrowFlights.length) return '';

  var MUTED_BLUE = '#7a9ccb';
  var DARK       = '#2e3a50';
  var SUBTEXT    = '#8a96aa';

  var html =
    '<div style="background:#f7f8fb;border:1px solid #e6eaf2;border-radius:6px;padding:16px 20px;">' +
    '<p style="margin:0 0 12px;font-size:10.5px;font-weight:700;color:' + MUTED_BLUE + ';' +
    'letter-spacing:1.5px;text-transform:uppercase;">Coming Up Tomorrow</p>';

  tomorrowFlights.forEach(function(row, i) {
    var title  = String(row[3] || '').trim() || 'Flight';
    var startT = String(row[5] || '').trim();
    var endT   = String(row[6] || '').trim();
    var loc    = String(row[7] || '').trim();
    var meta   = {};
    try { meta = JSON.parse(String(row[9] || '{}')); } catch (e_) {}

    var route = '';
    if (meta.origin && meta.dest) {
      route = escapeHtml_(meta.origin) + ' → ' + escapeHtml_(meta.dest);
    } else if (loc) {
      route = escapeHtml_(loc);
    }

    var timeStr = startT || '';
    if (endT && endT !== startT) timeStr += ' – ' + endT;

    html +=
      (i > 0 ? '<div style="height:1px;background:#e8ecf4;margin:10px 0;"></div>' : '') +
      '<div style="display:flex;align-items:flex-start;gap:10px;">' +
      '<div style="font-size:16px;padding-top:1px;flex-shrink:0;">✈️</div>' +
      '<div>' +
      '<p style="margin:0 0 1px;font-size:13px;font-weight:600;color:' + DARK + ';">' +
      escapeHtml_(title) + (route ? ' &nbsp;·&nbsp; ' + route : '') + '</p>' +
      (timeStr ? '<p style="margin:0;font-size:12px;color:' + SUBTEXT + ';">' + escapeHtml_(timeStr) + '</p>' : '') +
      '</div>' +
      '</div>';
  });

  html += '</div>';
  return html;
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// VERA Narrative section — Claude-powered travel day story
// ---------------------------------------------------------------------------

/**
 * getTripToneMode_(tripKey)
 * Returns 'personal' for anniversary/romantic trips (checked against TripMeta Context),
 * 'professional' otherwise. Used to tune Claude voice in travel emails.
 */
function getTripToneMode_(tripKey) {
  try {
    var ss    = getSpreadsheet();
    var sheet = ss.getSheetByName(TABS.TRIP_META);
    if (!sheet || sheet.getLastRow() < 2) return 'professional';
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      var key     = String(data[i][0] || '').trim();
      var context = String(data[i][1] || '').trim().toLowerCase();
      if (key === tripKey &&
          (context.indexOf('anniversary trip') !== -1 ||
           context.indexOf('romantic couples getaway') !== -1)) {
        return 'personal';
      }
    }
  } catch (e) {
    Logger.log('getTripToneMode_: error (non-fatal) — ' + e.message);
  }
  return 'professional';
}

/**
 * buildTravelDayNarrativeData_(sortedItems, tripLabel, insights, toneMode)
 *
 * Calls Claude to generate a tagline, narrative, and tip for the travel day.
 * Returns { tagline, narrative, tip } or null on error/empty.
 *
 * @param {Array}       sortedItems  — today's Itinerary rows sorted by start time
 * @param {string}      tripLabel    — e.g. "Paris" or "Austin · SXSW"
 * @param {Object|null} insights     — flight insights object (optional context)
 * @param {string}      toneMode     — 'professional' (default) or 'personal'
 * @returns {{ tagline, narrative, tip }|null}
 */
function buildTravelDayNarrativeData_(sortedItems, tripLabel, insights, toneMode) {
  try {
    if (!sortedItems || sortedItems.length === 0) return null;

    // Build a compact plain-text summary of the day's items for Claude
    var itemLines = sortedItems.map(function(row) {
      var type   = String(row[2] || '').trim();
      var title  = String(row[3] || '').trim() || '(untitled)';
      var startT = String(row[5] || '').trim();
      var endT   = String(row[6] || '').trim();
      var loc    = String(row[7] || '').trim();
      var notes  = String(row[8] || '').trim();
      var meta   = {};
      if (row[9]) { try { meta = JSON.parse(String(row[9])); } catch (e_) {} }

      var parts = [type ? '[' + type + ']' : '[event]', title];
      if (startT) parts.push(startT + (endT && endT !== startT ? '–' + endT : ''));
      if (loc)   parts.push('at ' + loc);
      if (meta.confirmationNumber) parts.push('conf# ' + meta.confirmationNumber);
      if (notes) parts.push('(' + notes + ')');
      return parts.join(' · ');
    }).join('\n');

    var flightContext = '';
    if (insights) {
      if (insights.dep_local && insights.arr_local) {
        flightContext += ' Flight: ' + insights.dep_local + ' → ' + insights.arr_local + '.';
      }
      if (insights.tz_offset_label && insights.tz_offset_label !== 'same timezone') {
        flightContext += ' Timezone shift: ' + insights.tz_offset_label + '.';
      }
      if (insights.sleep_tip) {
        flightContext += ' ' + insights.sleep_tip;
      }
    }

    var tone = toneMode || 'professional';
    var toneDesc = tone === 'personal'
      ? '"personal": warm, intimate, slightly playful — like a close friend who arranged the whole trip.'
      : '"professional": polished, first-class concierge. Warm but refined. Email may be forwarded to travel companions.';

    var prompt =
      'You are VERA, Ahmed\'s Chief of Staff. It\'s travel day to ' + tripLabel + '.\n\n' +
      'Itinerary:\n' + itemLines + '\n' +
      (flightContext ? '\nFlight context: ' + flightContext + '\n' : '') +
      '\nTone mode: ' + tone + '\n- ' + toneDesc + '\n\n' +
      'Return ONLY valid JSON (no markdown, no preamble):\n' +
      '{\n' +
      '  "tagline": "One thematic line (or two short lines joined by \\\\n) capturing the spirit of today. Day-specific — reference actual activities. Professional: sophisticated. Personal: playful or heartfelt.",\n' +
      '  "narrative": "2–3 short paragraphs painting the arc of the day. Reference specific times and places. Don\'t list — tell the story. No markdown, no headers.",\n' +
      '  "tip": "One sentence: a practical heads-up or encouragement specific to today."\n' +
      '}';

    var result = callClaudeJson_(prompt, null);
    if (!result || typeof result !== 'object') return null;
    return {
      tagline:   String(result.tagline   || '').trim(),
      narrative: String(result.narrative || '').trim(),
      tip:       String(result.tip       || '').trim(),
    };

  } catch (err) {
    Logger.log('buildTravelDayNarrativeData_ error (non-fatal): ' + err.message);
    return null;
  }
}

/**
 * buildTravelNarrativeSection_(narrativeData)
 *
 * HTML section builder for the VERA narrative panel.
 * Accepts either the new { tagline, narrative, tip } object or a legacy plain-text string.
 * Renders: tagline block (centered italic) → narrative → tip box.
 *
 * @param {{ tagline, narrative, tip }|string|null} narrativeData
 * @returns {string} HTML string, or '' if narrativeData is null/empty
 */
function buildTravelNarrativeSection_(narrativeData) {
  if (!narrativeData) return '';

  var tagline   = '';
  var narrative = '';
  var tip       = '';

  if (typeof narrativeData === 'string') {
    narrative = narrativeData; // legacy plain-text path
  } else {
    tagline   = narrativeData.tagline   || '';
    narrative = narrativeData.narrative || '';
    tip       = narrativeData.tip       || '';
  }

  if (!narrative && !tagline) return '';

  var BLUE = '#1565c0';
  var html = '';

  // Tagline block — centered italic, between thin horizontal rules
  if (tagline) {
    html +=
      '<div style="text-align:center;padding:12px 0 8px;color:#555;font-style:italic;' +
      'border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;margin-bottom:16px;">' +
      escapeHtml_(tagline).replace(/\n/g, '<br>') +
      '</div>';
  }

  // VERA narrative — existing blue-left-bordered block
  if (narrative) {
    var paragraphs = narrative.split(/\n\n+/).map(function(p) { return p.trim(); }).filter(Boolean);
    var parasHtml = paragraphs.map(function(p, i) {
      var isLast = (i === paragraphs.length - 1);
      return '<p style="margin:0' + (isLast ? '' : ' 0 10px') +
             ';font-size:14px;line-height:1.65;color:#333333;font-style:italic;">' +
             escapeHtml_(p) + '</p>';
    }).join('');

    html +=
      '<div style="margin-bottom:' + (tip ? '0' : '4') + 'px;padding:16px 20px;background:#f0f4ff;' +
      'border-left:4px solid ' + BLUE + ';border-radius:0 6px 6px 0;">' +
      '<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
      'letter-spacing:1.5px;text-transform:uppercase;">Your Day</p>' +
      parasHtml +
      '</div>';
  }

  // Tip box — labeled, blue left border
  if (tip) {
    html +=
      '<div style="margin-top:8px;margin-bottom:4px;padding:10px 14px;background:#f0f4ff;' +
      'border-left:3px solid ' + BLUE + ';font-size:13px;line-height:1.5;">' +
      '<strong>Tip:</strong> ' + escapeHtml_(tip) +
      '</div>';
  }

  return html;
}

// ---------------------------------------------------------------------------

/**
 * testSendTravelDayBriefing()
 * Run from the Apps Script editor to test without waiting for the 7am trigger.
 * Uses today's date — make sure an Itinerary row exists for today first.
 */
function testSendTravelDayBriefing() {
  Logger.log('=== testSendTravelDayBriefing ===');
  checkAndSendTravelDayBriefings_();
  Logger.log('=== done — check your inbox ===');
}
