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
 * function only exposes include/exclude, not *why*, and a caller sometimes needs
 * to know specifically "was this excluded for being virtual" before applying a
 * looser has-a-real-location fallback. WebApp.js and TravelLegs.js both use it.
 */
function isVirtualMeetingLocation_(location) {
  var VIRTUAL_LOCS = ['zoom', 'google meet', 'teams', 'webex', 'skype',
                       'conference room', 'meet.google', 'whereby'];
  var loc = String(location || '').toLowerCase();
  for (var i = 0; i < VIRTUAL_LOCS.length; i++) {
    // Whole-word, via the shared helper in WebApp.js — a substring test read
    // 'teams' inside "Teamsters Hall" and dropped a real venue as a virtual
    // meeting. A false positive here deletes the event outright, so this list
    // matters more than the include-side ones.
    if (itinKeywordHit_(loc, VIRTUAL_LOCS[i])) return true;
  }
  return false;
}

/**
 * Today's itinerary items for a trip, via the SAME path the dashboard's Active
 * Travel Card uses.
 *
 * This is the fix for the wrong arrival times. webGetItinerary_ runs a per-event
 * timezone pass (Calendar.Events.list, start/timeZone + end/timeZone) and then
 * formats each end of a flight in ITS OWN zone — departure in startTz, arrival
 * in endTz. It has twelve callers and exactly one, the dashboard's
 * action=itinerary, omits skipEventTz and therefore gets those timezones. That
 * one is the card that renders correctly.
 *
 * The briefing used to call it not at all. It ran its own CalendarApp pull with
 * no timezone pass, formatted both ends in the script zone, and wrote
 * ev.getStartTime().toISOString() into metadata as dep_scheduled — a UTC instant
 * that the insights prompt then labelled "local to the origin airport". Handed
 * that, the model converted the departure correctly (it knew the origin) and
 * echoed the raw UTC clock for the arrival, because the destination had come
 * through as "unknown". Hence 21:03 rendering as 1:03 AM.
 *
 * Note what this deliberately does NOT return: dep_scheduled / arr_scheduled.
 * Their absence is the fix — buildTravelFlightInsightsData_ then falls through
 * to the row's own time columns, which are correct per-zone local strings.
 *
 * No second argument, so the timezone pass runs. webGetItinerary_ writes to no
 * sheet, so this is safe to call from a mailer.
 *
 * @returns {Array|null} 10-column rows for `today`, or null if unavailable
 */
function fetchTripDayItems_(tripKey, startDate, endDate, today) {
  if (typeof webGetItinerary_ !== 'function') return null;
  var res = webGetItinerary_({ parameter: {
    tripKey:   tripKey,
    startDate: startDate,
    endDate:   endDate,
  }});
  if (!res || !res.items) return null;

  // The same adapter webGeneratePacking_ and webGenerateRecommendations_ use.
  var rows = res.items.map(function(it) {
    return [it.id, it.tripKey, it.type, it.title, it.date,
            it.startTime, it.endTime, it.location, it.notes, it.metadata];
  });

  // `date` comes back formatted in the event's OWN start timezone, which is
  // departure-day semantics — the same assumption the dashboard card makes.
  var todays = rows.filter(function(r) {
    var d = r[4];
    var ds = (d instanceof Date)
      ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(d || '').trim();
    return ds === today;
  });

  Logger.log('TravelDayBriefing: webGetItinerary_ gave ' + rows.length +
             ' item(s) for ' + tripKey + ', ' + todays.length + ' dated ' + today);
  return todays;
}

// getCalendarItemsForToday_ lived here. It did its own CalendarApp pull with no
// per-event timezone pass, which is what produced the wrong arrival times, and
// its caller merged the result in with a title-only dedupe. fetchTripDayItems_
// above replaces both: webGetItinerary_ already reads the same trusted calendar
// set, applies the same isItineraryCalendarRelevant_ check, dedupes against the
// sheet properly and formats each end of a flight in its own zone.

/**
 * checkAndSendTravelDayBriefings_()
 * Entry point. Called from morningNudge() each morning.
 * Scans the Itinerary sheet for rows whose Date = today,
 * groups by Trip Key, and fires one email per trip.
 * Safe no-op if no travel today.
 * Respects config key: travel_day_briefing_enabled (default: true)
 */
function checkAndSendTravelDayBriefings_(opts) {
  var _tdbStart = Date.now();
  // opts.dateOverride ('yyyy-MM-dd') lets TestBench.js preview a briefing for a
  // day other than today. The scheduled call passes nothing and is unaffected.
  var _tdbDateOverride = (opts && opts.dateOverride) ? String(opts.dateOverride).trim() : '';
  // opts.force re-sends even if today's briefing already went out. Only
  // TestBench passes it; the scheduled call never does.
  var _tdbForce = !!(opts && opts.force);
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
  var today = _tdbDateOverride || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  if (_tdbDateOverride) Logger.log('TravelDayBriefing: DATE OVERRIDE — treating ' + today + ' as today');

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
      // Retain the range even when the trip already had sheet rows: a
      // calendar-only trip has no tripRanges entry at all, and webGetItinerary_
      // requires a start and an end.
      if (!tripRanges[key]) tripRanges[key] = { min: t.startDate, max: t.endDate };
    });
  } catch (calErr) {
    Logger.log('TravelDayBriefing: calendar scan error (non-fatal) — ' + calErr.message);
  }

  // The merge of calendar events into today's rows used to happen here, with a
  // title-only dedupe. It is gone: webGetItinerary_ already merges the two
  // sources, dedupes them properly and collapses competing holds — see
  // fetchTripDayItems_ below, called per trip AFTER the send latch so a trip
  // with two keys costs one call rather than two.

  var tripKeys = Object.keys(tripMap);
  if (!tripKeys.length) {
    Logger.log('TravelDayBriefing: no travel today (' + today + ')');
    return;
  }

  Logger.log('TravelDayBriefing: ' + tripKeys.length + ' trip(s) today — sending briefings');
  var sent = 0;
  // Guard against sending the same day's briefing twice.
  //
  // There was no send guard here at all — unlike the pre-trip path, which has
  // one. That is how a trip whose start date moved produced TWO identical
  // emails: the sheet rows still carried the old startDate|label key while the
  // calendar produced a new one, both resolved to the same events, and this loop
  // sent one email per key.
  //
  // Deliberately keyed on the DAY and the trip LABEL, not the trip key: the
  // label is the part that does not change when a date is edited, so two keys
  // for one trip collapse to one latch. Two genuinely different trips on the
  // same day still have different labels.
  var _tdbProps = PropertiesService.getScriptProperties();
  var _tdbSeen  = {};   // labels briefed in THIS run
  tripKeys.forEach(function(tripKey) {
    try {
      var _lbl  = String(tripKey.split('|').slice(1).join('|') || tripKey);
      var _sKey = 'TDB_SENT_' + today.replace(/-/g, '') + '_' +
                  _lbl.toUpperCase().replace(/[^A-Z0-9]/g, '_').substring(0, 60);

      // Two guards, and they do different jobs.
      //
      // The in-run one collapses a trip that appears under two keys, and it is
      // NOT bypassable: forcing a re-send should re-send the briefing, not
      // reproduce the duplicate that started all this.
      if (_tdbSeen[_sKey]) {
        Logger.log('TravelDayBriefing: "' + _lbl + '" already briefed this run — skipping ' +
                   tripKey + ' (same trip, second key)');
        return;
      }
      // The persisted one stops a second scheduled run the same day. TestBench
      // passes force to get past it, because a manual run that silently does
      // nothing looks exactly like "no trip today" and tells you nothing.
      if (!_tdbForce && _tdbProps.getProperty(_sKey)) {
        Logger.log('TravelDayBriefing: already sent today for "' + _lbl + '" — skipping ' + tripKey);
        return;
      }
      _tdbSeen[_sKey] = true;

      // Fetch through webGetItinerary_ now that the latch has settled which key
      // wins. Falls back to the raw sheet rows gathered above if that throws —
      // a briefing built from sheet rows alone is worse than one with calendar
      // events merged in, but far better than none.
      var _range = tripRanges[tripKey] || { min: today, max: today };
      var _rows  = tripMap[tripKey];
      try {
        var _fetched = fetchTripDayItems_(tripKey, _range.min, _range.max, today);
        if (_fetched) _rows = _fetched;
      } catch (itinErr) {
        Logger.log('TravelDayBriefing: webGetItinerary_ failed for ' + tripKey +
                   ' — falling back to sheet rows. ' + itinErr.message);
      }

      sendTravelDayBriefing_(tripKey, _rows);
      _tdbProps.setProperty(_sKey, new Date().toISOString());
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

  // Competing holds occupy ONE slot, here as everywhere else. Kept even though
  // webGetItinerary_ now collapses server-side: webSendTravelBriefing_ calls this
  // function directly with raw sheet rows, which have had no such pass. Collapsing
  // already-collapsed rows is a no-op, so both callers are safe.
  sortedItems = collapseItineraryRows_(sortedItems, tripKey,
                                       Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'));

  // ── Modular sections pipeline ──────────────────────────────────────────────
  // To add a new section, implement buildXxxSection_(data) → HTML string,
  // then push { id: 'xxx', builder: buildXxxSection_, data: payload } here.
  // The HTML assembler (buildTravelDayEmailHtml_) never needs to change.
  // Compute flight insights once — feeds both HTML sections pipeline and plain-text path
  var cfg      = getConfigValues();
  var homeCity = String(cfg['weather_location'] || '').trim();
  var insights = buildTravelFlightInsightsData_(sortedItems, homeCity);

  var toneMode      = getTripToneMode_(tripKey);
  // The trip briefing shapes the narrative, not the per-item detail lookups —
  // "why we are going" changes how the day should be told, and changes nothing
  // about a venue's address or phone number.
  var tripBriefing  = tripBriefingFor_(tripKey);
  var narrativeData = buildTravelDayNarrativeData_(sortedItems, tripLabel, insights, toneMode, tripBriefing);

  // Lounge access. Five things have to line up, and until now NONE of them said
  // so in the log — which is how this section stayed silently empty on every
  // travel-day email ever sent. Each gate below names itself when it stops.
  var travelAirports = travelDayAirports_(sortedItems);
  var loungePerks    = getLoungePerkPrograms_();
  var loungeData     = emptyLoungeData_();
  Logger.log('LOUNGE: ' + loungePerks.length + ' matching perk(s) [' +
             loungePerks.map(function(p) { return p.program + '/' + p.card; }).join(', ') +
             '], ' + travelAirports.length + ' airport(s) [' +
             travelAirports.map(function(a) { return a.code + ':' + a.role; }).join(', ') + ']');
  if (!loungePerks.length) {
    Logger.log('LOUNGE: gate 2 — no Card Perks row matches a lounge program. ' +
               'Run tbLoungeAccess() to see every row and why it did not match.');
  } else if (!travelAirports.length) {
    Logger.log('LOUNGE: gate 3 — no IATA code on any flight row today, so there is ' +
               'no airport to look up. Needs metadata.origin/dest or a bare code in Location.');
  } else {
    try {
      loungeData = buildTravelLoungeData_(travelAirports, loungePerks);
    } catch (lErr) {
      Logger.log('LOUNGE: buildTravelLoungeData_ threw — ' + lErr.message);
      // Keep the programs so the section still renders the fallback rather than
      // vanishing: access the user genuinely holds is worth saying either way.
      loungeData = emptyLoungeData_(loungePerks, travelAirports);
    }
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
      var _tripKeys = tripKeysFor_(tripKey);
      tomorrowFlights = _allRows.filter(function(row) {
        var rowDate = (row[4] instanceof Date && !isNaN(row[4].getTime()))
          ? Utilities.formatDate(row[4], tz, 'yyyy-MM-dd')
          : String(row[4] || '').trim();
        return tripRowMatches_(row[1], _tripKeys) &&
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

  // Anything still held two ways for TODAY. Builds to '' when there is nothing
  // open, and the assembler drops an empty section.
  var openDecisions = [];
  try {
    var _todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    openDecisions = openDecisionsForTrip_(tripKey, _todayStr, _todayStr, _todayStr);
  } catch (dErr) { Logger.log('TravelDay: decisions lookup failed — ' + dErr.message); }

  var sections = [
    { id: 'narrative',       builder: buildTravelNarrativeSection_,      data: narrativeData },
    { id: 'flight_insights', builder: buildTravelFlightInsightsSection_,  data: insights },
    { id: 'lounge_access',   builder: buildTravelLoungeSection_,          data: loungeData },
    { id: 'open_decisions',  builder: buildOpenDecisionsSection_,         data: openDecisions },
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
    sendVeraEmail_(recipients.join(','), subject, plainText, { name: 'Travel Briefing', htmlBody: htmlBody }, 'travel_day_briefing');
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

  // Travel times between today's stops, read from the cache the nightly run
  // already filled. A travel morning is exactly when the number matters and the
  // dashboard is exactly what you are not looking at — reusing these here is
  // the reason they are computed server-side rather than in the browser.
  // Read-only and free: no routing call is ever made from an email.
  var legCache = {};
  try { legCache = loadTravelLegCache_(); }
  catch (legErr) { Logger.log('TravelDayBriefing: leg cache unavailable — ' + legErr.message); }
  var prevLegItem = null;

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

    // The briefing holds items as sheet rows; the leg helpers take the object
    // shape webGetItinerary_ returns. Adapt rather than reimplement — a second
    // implementation drifting from the first is what produced two wrong test
    // fixtures earlier in this feature.
    var legItem = { date: String(row[4] || '').trim(), type: type, title: title,
                    startTime: startT, endTime: endT, location: loc,
                    metadata: String(row[9] || '') };

    if (prevLegItem && startT) {
      // departurePointOf_ so a flight measures from where it LANDED, not from
      // the departure airport sitting in its location field.
      var fromLoc = departurePointOf_(prevLegItem);
      if (fromLoc && isUsableTravelLocation_(fromLoc) && isUsableTravelLocation_(loc)) {
        var lg = legCache[travelLegKey_(fromLoc, loc, 'driving')];
        if (lg && lg.status === 'OK' && lg.minutes !== null &&
            lg.minutes <= TRAVEL_LEG_MAX_PLAUSIBLE_MINS) {
          var fromLabel = String(fromLoc).split('\n')[0].trim();
          if (fromLabel.length > 34) fromLabel = fromLabel.substring(0, 33) + '\u2026';
          html +=
            '<div style="margin:0 0 6px 34px;font-size:12px;color:#8a8a8a;">' +
            '\uD83D\uDE97 ~' + lg.minutes + 'm from ' + escapeHtml_(fromLabel) +
            '</div>';
        }
      }
    }
    if (startT) prevLegItem = legItem;

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
/**
 * The marker strings this map will actually use, in order.
 *
 * Static Maps geocodes each marker server-side and returns HTTP 400 for the
 * WHOLE image if any one of them fails — so an un-geocodable stop does not lose
 * its own pin, it loses the entire map. That is how a route string like
 * "IAD → MCO" (which webGetItinerary_ synthesises as a flight row's Location)
 * blanks the image.
 *
 * So the same screening the Distance Matrix path already applies
 * (isUsableTravelLocation_ / normalizeTravelLocation_, TravelLegs.js) is applied
 * here too, plus a rejection of route-shaped strings, which name two places and
 * are therefore not a place.
 *
 * Shared with diagnoseTravelDayMap_ so the diagnostic can never disagree with
 * the email about which stops were used.
 *
 * @returns {Array<string>} usable, normalised marker strings, capped at 10
 */
function travelMapMarkers_(enrichedItems) {
  var out = [];
  (enrichedItems || []).forEach(function(e) {
    var raw = e && e.displayAddress;
    if (!raw) return;
    var loc = (typeof normalizeTravelLocation_ === 'function')
      ? normalizeTravelLocation_(raw)
      : String(raw).replace(/\s+/g, ' ').trim();
    if (typeof isUsableTravelLocation_ === 'function' && !isUsableTravelLocation_(loc)) return;
    // A route, not a place. Two endpoints joined by an arrow/dash geocode to
    // nothing and take the whole image down with them.
    if (/\s(?:→|->|—|--)\s/.test(loc)) return;
    if (out.indexOf(loc) === -1) out.push(loc);   // one pin per distinct place
  });
  return out.slice(0, 10);
}

function buildTravelStaticMapUrl_(enrichedItems, apiKey) {
  if (!apiKey) return null;
  var stops = travelMapMarkers_(enrichedItems);
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

  // Counted with the SAME screening buildTravelStaticMapUrl_ applies. Counting
  // raw displayAddress here meant the section could promise a map and then emit
  // nothing, because the URL builder rejected stops this count had accepted.
  var usableStops = travelMapMarkers_(items).length;
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
    // Rows first, heading only if any survived. A fully-null insights object
    // used to print a bare "USEFUL TO KNOW" and its underline with nothing at
    // all beneath them.
    var utk = [];
    // Both codes AND a label, matching the HTML renderer. The two used to
    // disagree: text printed "TPA → IAD  " with a trailing gap where the
    // offset should be, while HTML showed nothing — the same email
    // contradicting itself about whether the route was known.
    if (insights.origin_code && insights.dest_code && insights.tz_offset_label) {
      utk.push('\u23F0 Timezone:    ' + insights.origin_code + ' \u2192 ' +
        insights.dest_code + '  ' + insights.tz_offset_label);
    }
    if (insights.distance_miles) {
      utk.push('\uD83D\uDCCF Distance:    ~' +
        Number(insights.distance_miles).toLocaleString() + ' miles' +
        (insights.haul_category ? ' \u00B7 ' + insights.haul_category : ''));
    }
    if (insights.daynight_pct_day != null) {
      // Clamped, exactly as the HTML renderer does. String.repeat throws
      // RangeError on a negative count, this sits outside any try/catch, and
      // plainText is built BEFORE sendVeraEmail_ — so one out-of-range answer
      // from the model would take down the email and the Slack copy with it.
      var pctDay = Math.max(0, Math.min(100, Number(insights.daynight_pct_day) || 0));
      var filled = Math.max(0, Math.min(10, Math.round(pctDay / 10)));
      var bar    = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
      utk.push('\uD83C\uDF17 Your flight: ' + bar + '  ' + pctDay + '% daytime');
    }
    // OR, not AND. A known departure used to be thrown away because the
    // arrival was unknown — which is exactly the case this whole fix is about.
    if (insights.dep_local || insights.arr_local) {
      utk.push('\uD83D\uDEEB Times:       ' + (insights.dep_local || 'departure unknown') +
               ' \u2192 ' + (insights.arr_local || 'arrival unknown'));
    }
    if (insights.pre_trip_tip && !insights.isReturnDay) {
      utk.push('\uD83D\uDCC5 Before you go: ' + insights.pre_trip_tip);
    }
    if (insights.arrival_tip) {
      utk.push('\uD83D\uDCA4 On arrival:    ' + insights.arrival_tip);
    }
    if (utk.length) {
      lines.push('USEFUL TO KNOW');
      lines.push('--------------');
      utk.forEach(function(l) { lines.push(l); });
      lines.push('');
    }
  }

  // \u2500\u2500 Lounge Access block \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Rows first, heading only if any survived \u2014 and the SAME gate the HTML renderer
  // uses. The flight-times work found these two disagreeing about the timezone row,
  // so the two sections of one email contradicted each other; not repeating that.
  if (loungeData) {
    var lng = [];
    if (loungeData.lounges && loungeData.lounges.length) {
      loungeData.lounges.forEach(function(lounge) {
        var name = lounge.lounge_name || 'Airport Lounge';
        var role = lounge.role ? ' (' + lounge.role + ')' : '';
        lng.push(name + role);
        if (lounge.airport_code) lng.push('  ' + lounge.airport_code + (lounge.terminal ? ' \u00B7 Terminal ' + lounge.terminal : ''));
        if (lounge.hours)        lng.push('  Hours: ' + lounge.hours);
        if (lounge.card)         lng.push('  Access: ' + lounge.card + (lounge.program ? ' \u00B7 ' + lounge.program : ''));
        if (lounge.guest_limit)  lng.push('  Guests: ' + lounge.guest_limit);
      });
      if (loungeData.tip) lng.push('\uD83D\uDCA1 ' + loungeData.tip);
    } else if (loungeData.programs && loungeData.programs.length) {
      // Same fallback the HTML side shows: access held, lounge unnamed.
      loungeData.programs.forEach(function(p) {
        lng.push(p.program + (p.card ? ' (' + p.card + ')' : ''));
      });
      var apts = (loungeData.airports || []).map(function(a) {
        return a.code + (a.role ? ' (' + a.role + ')' : '');
      }).join(', ');
      if (apts) lng.push('Today: ' + apts);
      lng.push('No specific lounge could be confirmed for ' + (apts ? 'these airports' : 'today') +
               ' \u2014 check the program\u2019s app for the current list.');
    }
    if (lng.length) {
      lines.push('LOUNGE ACCESS');
      lines.push('-------------');
      lng.forEach(function(l) { lines.push(l); });
      lines.push(LOUNGE_CAVEAT_);
      lines.push('');
    }
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

    // Every key this trip answers to: a trip whose start date moved owns two,
    // and matching one returned half the itinerary.
    var keys  = tripKeysFor_(tripKey);
    var items = data.filter(function(row) {
      var rowDate = (row[4] instanceof Date && !isNaN(row[4].getTime()))
        ? Utilities.formatDate(row[4], tz, 'yyyy-MM-dd')
        : String(row[4] || '').trim();
      return tripRowMatches_(row[1], keys) && rowDate === today;
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
/**
 * An airport's coordinates and IANA timezone, or null.
 *
 * Chains two helpers that already exist and are already cached: an IATA code
 * resolves to a city via AirportGap (resolveIataToCity_, the same step
 * webGetDestWeather_ takes, because a bare 3-letter code is not a place name),
 * and the city resolves to coordinates plus a timezone via Open-Meteo's
 * geocoder — keyless, and cached for six hours.
 *
 * City-centroid coordinates, not runway coordinates: TPA is ~9 km from downtown
 * Tampa, IAD ~40 km from Washington. At the rounding a mileage figure is shown
 * at, that is noise — and it is a measured number rather than a generated one.
 *
 * @returns {{lat:number, lon:number, timezone:string}|null}
 */
function travelAirportGeo_(code) {
  var c = String(code || '').trim();
  if (!c) return null;
  try {
    var query = c;
    if (/^[A-Z]{3}$/.test(c) && typeof resolveIataToCity_ === 'function') {
      var city = resolveIataToCity_(c);
      if (city) query = city;
    }
    if (typeof geocodePackingDestination_ !== 'function') return null;
    var geo = geocodePackingDestination_(query);
    if (!geo || typeof geo.lat !== 'number' || typeof geo.lon !== 'number') return null;
    return { lat: geo.lat, lon: geo.lon, timezone: geo.timezone || '' };
  } catch (e) {
    Logger.log('travelAirportGeo_("' + c + '") — ' + e.message);
    return null;
  }
}

/** Great-circle distance in statute miles. */
function haversineMiles_(a, b) {
  if (!a || !b) return null;
  var toRad = function(d) { return d * Math.PI / 180; };
  var R = 3958.7613;
  var dLat = toRad(b.lat - a.lat);
  var dLon = toRad(b.lon - a.lon);
  var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

/**
 * A zone's UTC offset in hours ON A GIVEN DATE — so a flight in August gets
 * daylight saving and the same route in January does not.
 * @returns {number|null}
 */
function tzOffsetHoursOn_(ianaZone, dateStr) {
  if (!ianaZone) return null;
  try {
    var d = new Date(String(dateStr || '') + 'T12:00:00Z');
    if (isNaN(d.getTime())) d = new Date();
    var z = Utilities.formatDate(d, ianaZone, 'Z');      // e.g. -0400
    var m = /^([+-])(\d{2})(\d{2})$/.exec(String(z).trim());
    if (!m) return null;
    var hrs = parseInt(m[2], 10) + (parseInt(m[3], 10) / 60);
    return m[1] === '-' ? -hrs : hrs;
  } catch (e) {
    Logger.log('tzOffsetHoursOn_("' + ianaZone + '") — ' + e.message);
    return null;
  }
}

/** "+5h" / "-3h30m" / "same timezone", or '' when the offset is unknown. */
function tzOffsetLabel_(hours) {
  if (typeof hours !== 'number' || isNaN(hours)) return '';
  if (hours === 0) return 'same timezone';
  var sign  = hours > 0 ? '+' : '-';
  var abs   = Math.abs(hours);
  var whole = Math.floor(abs);
  var mins  = Math.round((abs - whole) * 60);
  return sign + whole + 'h' + (mins ? mins + 'm' : '');
}

/** Distance band. Derived from the measured mileage, not asked of the model. */
function haulCategoryFor_(miles) {
  if (typeof miles !== 'number' || !isFinite(miles)) return '';
  if (miles < 1000) return 'Short-haul';
  if (miles < 3000) return 'Medium-haul';
  if (miles < 6000) return 'Long-haul';
  return 'Ultra-long-haul';
}

/** "6:47 PM" from "18:47". Returns '' for anything that is not HH:mm. */
function travelTo12Hour_(hhmm) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return '';
  var h = parseInt(m[1], 10);
  if (h < 0 || h > 23) return '';
  var suffix = h >= 12 ? 'PM' : 'AM';
  var h12    = h % 12; if (h12 === 0) h12 = 12;
  return h12 + ':' + m[2] + ' ' + suffix;
}

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

    // The row's own time columns first. They come from webGetItinerary_, which
    // formats departure in the event's startTz and arrival in its endTz — the
    // same path the dashboard's Active Travel Card renders correctly from.
    //
    // meta.dep_scheduled is only consulted as a fallback, and ONLY when it is a
    // bare HH:mm. The old calendar pull wrote ev.getStartTime().toISOString()
    // into that field — a UTC instant — while the prompt below called it "local
    // to the origin airport". That is what turned a 21:03 arrival into 1:03 AM.
    // One field name, two incompatible formats; this refuses the wrong one.
    function localHHmm_(rowVal, metaVal) {
      var row = String(rowVal || '').trim();
      var m   = String(metaVal || '').trim();
      // Worth saying out loud even when the row wins: an ISO instant sitting in
      // this field means stale metadata is still on the sheet somewhere.
      if (m && !/^\d{1,2}:\d{2}$/.test(m)) {
        Logger.log('buildTravelFlightInsightsData_: ignoring non-local time "' + m +
                   '" (a UTC instant here is what produced the wrong arrival times)');
      }
      if (/^\d{1,2}:\d{2}$/.test(row)) return row;
      if (/^\d{1,2}:\d{2}$/.test(m))   return m;   // the synthetic dashboard row
      return row;
    }
    var depTime = localHHmm_(flight[5], meta.dep_scheduled);
    var arrTime = localHHmm_(flight[6], meta.arr_scheduled);
    var flightDate = (function() {
      var d = flight[4];
      if (d instanceof Date && !isNaN(d.getTime())) {
        return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      return String(d || '').trim();
    }());

    // ---- Facts, computed here rather than generated -----------------------
    //
    // Distance, the timezone offset and the formatted clock times used to be
    // asked of the model, which had no way to know any of them — there is no
    // airport table and no haversine in this codebase, so "~842 miles" and
    // "same timezone" were plausible inventions. All three are now measured.
    var originGeo = travelAirportGeo_(origin);
    var destGeo   = travelAirportGeo_(dest);

    // The calendar's own per-event zones are exact when present, so they win
    // over a city-centroid lookup. endTz is omitted by webGetItinerary_ when it
    // equals startTz, which is itself the "did not cross zones" signal.
    var originTz = meta.startTz || (originGeo && originGeo.timezone) || '';
    var destTz   = meta.endTz   || meta.startTz || (destGeo && destGeo.timezone) || '';

    var originOff = tzOffsetHoursOn_(originTz, flightDate);
    var destOff   = tzOffsetHoursOn_(destTz,   flightDate);
    var offsetHrs = (typeof originOff === 'number' && typeof destOff === 'number')
      ? Math.round((destOff - originOff) * 100) / 100
      : null;

    var miles = (originGeo && destGeo) ? haversineMiles_(originGeo, destGeo) : null;

    var prompt =
      'You are a flight insights assistant. A traveler is flying today.\n' +
      'Origin airport: ' + (origin || 'unknown') + '\n' +
      'Destination airport: ' + (dest || 'unknown') + '\n' +
      'Home city (for timezone reference): ' + (homeCity || 'unknown') + '\n' +
      'Flight date: ' + (flightDate || 'today') + '\n' +
      // Labelled by the zone it is ACTUALLY in, and only claimed to be local
      // when a zone is known. Saying "local" over a UTC instant is the bug.
      (depTime ? 'Departure time' + (originTz ? ' (' + originTz + ')' : ' (timezone unknown)') +
                 ': ' + depTime + '\n' : '') +
      (arrTime ? 'Arrival time'   + (destTz   ? ' (' + destTz   + ')' : ' (timezone unknown)') +
                 ': ' + arrTime + '\n' : '') +
      (offsetHrs !== null ? 'Timezone change on arrival: ' + tzOffsetLabel_(offsetHrs) + '\n' : '') +
      (miles !== null ? 'Great-circle distance: ' + miles + ' miles\n' : '') +
      'Home IANA timezone: ' + Session.getScriptTimeZone() + '\n\n' +
      'The facts above are measured. Do not restate, recompute or contradict them.\n' +
      'Return ONLY a valid JSON object with exactly these fields (no explanation):\n' +
      '{\n'
      // origin_code/dest_code/tz_offset/distance/haul/dep_local/arr_local are
      // all set from the measurements below — the model is not asked for them.
      +
      '  "pre_trip_tip": "1 sentence: what to do in the days before departure to prepare — direction-specific (west = shift bedtime earlier, east = stay up later; say no adjustment needed if same tz)",\n' +
      '  "arrival_tip": "REQUIRED — write exactly 1 sentence of specific advice for after landing. Never return null. Westward flight: advise staying awake until local bedtime to reset the body clock. Eastward flight: advise avoiding naps and going to sleep at local time. Same timezone: write that no adjustment is needed but getting morning sunlight helps.",\n' +
      '  "daynight_pct_day": integer 0-100 (% of flight time in daylight based on route and departure time)\n' +
      '}';

    var result = callClaudeJson_(prompt, null) || {};
    if (typeof result !== 'object') result = {};

    // ---- Overwrite every measured field ------------------------------------
    //
    // Assigned after the call, unconditionally, so a model that answers anyway
    // cannot contradict a measurement. Null where genuinely unknown — never a
    // confident stand-in.
    result.origin_code = origin || null;
    result.dest_code   = dest   || null;

    result.tz_offset_hours = offsetHrs;                 // null stays null
    result.tz_offset_label = offsetHrs === null ? null : tzOffsetLabel_(offsetHrs);

    result.distance_miles = miles;
    result.haul_category  = miles === null ? null : haulCategoryFor_(miles);

    // "6:47 PM (TPA)". The airport is appended only when it is actually known —
    // the old code printed the literal string "(unknown)" beside a UTC clock.
    var dep12 = travelTo12Hour_(depTime);
    var arr12 = travelTo12Hour_(arrTime);
    result.dep_local = dep12 ? (dep12 + (origin ? ' (' + origin + ')' : '')) : null;
    result.arr_local = arr12 ? (arr12 + (dest   ? ' (' + dest   + ')' : '')) : null;

    // daynight_pct_day stays the model's estimate — real solar geometry is a
    // lot of code for a bar chart — but it is clamped so a stray value cannot
    // reach String.repeat and throw.
    if (result.daynight_pct_day != null) {
      var pd = Number(result.daynight_pct_day);
      result.daynight_pct_day = isFinite(pd) ? Math.max(0, Math.min(100, Math.round(pd))) : null;
    }

    Logger.log('flightInsights: ' + (origin || '?') + '→' + (dest || '?') +
               '  dep=' + (result.dep_local || 'n/a') + '  arr=' + (result.arr_local || 'n/a') +
               '  offset=' + (result.tz_offset_label || 'unknown') +
               '  miles=' + (miles === null ? 'unknown' : miles));
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

  // Heading is prepended at the END, only if a row survived. This used to be
  // emitted unconditionally, so an insights object with every field null
  // printed a lone "Useful to Know" above an empty table.
  var html = '';

  // Helper: one row in the insights table
  function row(emoji, label, value) {
    if (!value) return '';
    rowCount++;
    return (
      '<tr>' +
      '<td style="padding:4px 8px 4px 0;font-size:13px;width:20px;vertical-align:top;">' + emoji + '</td>' +
      '<td style="padding:4px 8px 4px 0;font-size:12px;color:' + LGREY + ';white-space:nowrap;vertical-align:top;">' + label + '</td>' +
      '<td style="padding:4px 0;font-size:13px;color:' + DARK + ';vertical-align:top;">' + value + '</td>' +
      '</tr>'
    );
  }

  var rowCount = 0;
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

  // 🛫 Local times — OR, not AND. A known departure used to be discarded
  // because the arrival was unknown, which is the exact case this fix is about.
  if (insights.dep_local || insights.arr_local) {
    var timesVal = escapeHtml_(insights.dep_local || 'departure unknown') + ' → ' +
                   escapeHtml_(insights.arr_local || 'arrival unknown');
    html += row('🛫', 'Times', timesVal);
  }

  html += '</table>';

  // Tips (full width below table)
  if (insights.pre_trip_tip && !insights.isReturnDay) {
    html +=
      '<p style="margin:8px 0 0;font-size:13px;color:' + GREY + ';font-style:italic;' +
      'padding:8px 12px;background:#f7f7fa;border-left:3px solid ' + BLUE + ';border-radius:0 4px 4px 0;">' +
      '📅 <strong>Before you go:</strong> ' + escapeHtml_(insights.pre_trip_tip) + '</p>';
    rowCount++;
  }
  if (insights.arrival_tip) {
    html +=
      '<p style="margin:6px 0 0;font-size:13px;color:' + GREY + ';font-style:italic;' +
      'padding:8px 12px;background:#f7f7fa;border-left:3px solid ' + BLUE + ';border-radius:0 4px 4px 0;">' +
      '💤 <strong>On arrival:</strong> ' + escapeHtml_(insights.arrival_tip) + '</p>';
    rowCount++;
  }

  if (!rowCount) return '';   // nothing to say — say nothing, not a bare heading

  return (
    '<p style="margin:0 0 16px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
    'letter-spacing:1.5px;text-transform:uppercase;">Useful to Know</p>' + html
  );
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Lounge Access section — Issue #187
// ---------------------------------------------------------------------------

/**
 * The airports worth looking up a lounge at, from today's flight rows.
 *
 * Departures and layovers only. The FINAL flight's destination is deliberately
 * omitted — a lounge you reach after landing is not useful, and this is the one
 * subtlety here worth preserving exactly.
 *
 * Lifted out of an inline IIFE in sendTravelDayBriefing_ so diagnoseLoungeAccess_
 * can call the same code rather than a copy of it that drifts. Behaviour is
 * unchanged.
 *
 * @param {Array} sortedItems — today's 10-column Itinerary rows, time-sorted
 * @returns {Array} [{ code: 'TPA', role: 'departure'|'layover' }, ...]
 */
function travelDayAirports_(sortedItems) {
  var flightRows = (sortedItems || []).filter(function(r) {
    return String(r[2] || '').trim().toLowerCase() === 'flight';
  });
  var airports = [];
  var seen = {};
  flightRows.forEach(function(r, i) {
    var meta = {};
    try { meta = JSON.parse(String(r[9] || '{}')); } catch (e) {}
    var orig = (meta.origin || '').trim().toUpperCase() || (String(r[7]||'').match(/\b([A-Z]{3})\b/)||[])[1] || '';
    var dest = (meta.dest   || '').trim().toUpperCase() || (String(r[7]||'').match(/\b([A-Z]{3})\b/g)||[]).slice(-1)[0] || '';
    if (orig && !seen[orig]) { seen[orig] = true; airports.push({ code: orig, role: i === 0 ? 'departure' : 'layover' }); }
    // dest is a layover only if there's another flight after this one; otherwise it's the arrival (omitted)
    if (dest && !seen[dest] && i < flightRows.length - 1) { seen[dest] = true; airports.push({ code: dest, role: 'layover' }); }
  });
  return airports;
}

/**
 * The shape both renderers read, with nothing resolved.
 *
 * `resolved: false` plus a non-empty `programs` is the difference between "no
 * lounge here" and "we could not name the lounge" — the renderers show the
 * programs held in the second case rather than hiding the section, because an
 * empty section is indistinguishable from the bug that hid this one for so long.
 */
function emptyLoungeData_(programs, airports) {
  return {
    lounges:  [],
    tip:      '',
    programs: programs || [],
    airports: airports || [],
    resolved: false,
  };
}

/**
 * Lounge programs, keyed by what a Card Perks row might actually say.
 *
 * One ordered table, so matching and labelling cannot disagree. The old code had
 * a keyword array and a SEPARATE normalize cascade, and the two drifted: the
 * array's 'capital one lounge' entry was dead (anything containing it already
 * matched the earlier 'lounge'), while the cascade tested the looser 'capital
 * one' — so any lounge perk mentioning Capital One anywhere was relabelled
 * "Capital One Lounge".
 *
 * Airline clubs are here because they were missing entirely. "Delta Sky Club",
 * "Admirals Club" and "United Club" contain no 'lounge' substring, so a row for
 * any of them was dropped in silence.
 *
 * Most specific first — 'capital one' has to be tested before the bare 'lounge'
 * fallback, or the fallback claims the row.
 */
var LOUNGE_PROGRAM_PATTERNS_ = [
  { program: 'Centurion Lounge',         any: ['centurion'] },
  { program: 'Priority Pass',            any: ['priority pass', 'prioritypass'] },
  { program: 'Capital One Lounge',       any: ['capital one'], requiresLoungeWord: true },
  { program: 'Delta Sky Club',           any: ['sky club', 'skyclub'] },
  { program: 'United Club',              any: ['united club'] },
  { program: 'Admirals Club',            any: ['admirals club', "admiral's club"] },
  { program: 'Escape Lounge',            any: ['escape lounge'] },
  { program: 'Plaza Premium Lounge',     any: ['plaza premium'] },
  { program: 'Global Lounge Collection', any: ['global lounge'] },
];

/** A perk that mentions a lounge at all, for the catch-all branch. */
var LOUNGE_GENERIC_WORDS_ = ['lounge', 'airport club'];

/**
 * Every lounge program a single perk string names — plural on purpose.
 *
 * The old cascade stopped at the first hit, so "Priority Pass + Centurion Lounge
 * access" resolved to Centurion only and the Priority Pass half of the perk went
 * unmentioned.
 *
 * @param {string} perkName — the raw Perk cell
 * @returns {Array<string>} canonical program names, possibly empty
 */
function loungeProgramsForPerk_(perkName) {
  var raw   = String(perkName || '').trim();
  var lower = raw.toLowerCase();
  if (!raw) return [];

  var hasLoungeWord = LOUNGE_GENERIC_WORDS_.some(function(w) {
    return lower.indexOf(w) !== -1;
  });

  var found = [];
  LOUNGE_PROGRAM_PATTERNS_.forEach(function(entry) {
    if (entry.requiresLoungeWord && !hasLoungeWord) return;
    var hit = entry.any.some(function(kw) { return lower.indexOf(kw) !== -1; });
    if (hit && found.indexOf(entry.program) === -1) found.push(entry.program);
  });

  // A lounge perk from a program not in the table keeps its own name — better a
  // raw label than dropping access the user really has.
  if (!found.length && hasLoungeWord) found.push(raw);
  return found;
}

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

    // NOTE: a stray copy of buildTravelDayPlainText_'s tagline/narrative block
    // used to sit here, referencing `narrativeData` and `lines` — neither of
    // which exists in this scope. Every call threw ReferenceError, this
    // function's own catch swallowed it and returned [], and so the LOUNGE
    // ACCESS section rendered empty on every single travel-day email, silently.
    // The real copy lives in buildTravelDayPlainText_ and is untouched.

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

      // Plural: one perk can name two programs, and the old first-match cascade
      // reported only one of them.
      loungeProgramsForPerk_(perkName).forEach(function(program) {
        var key = program + '|' + cardName;
        if (!seen[key]) {
          seen[key] = true;
          results.push({ program: program, card: cardName });
        }
      });
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
/** At most this many searches per briefing, so a multi-leg day cannot fan out. */
var LOUNGE_SEARCH_MAX_QUERIES_ = 12;

/**
 * The query for one programme at one airport.
 *
 * The old template was program + ' lounge ' + code + ' airport', which for a
 * programme whose name already contains the word produced "Centurion Lounge lounge
 * DCA airport". That duplication is why half the results came back as brand pages
 * naming no specific lounge.
 */
function loungeProgramQuery_(program, code) {
  var p = String(program || '').trim();
  return /lounge|club/i.test(p) ? (p + ' ' + code) : (p + ' lounge ' + code);
}

/**
 * The query that surfaces pages actually enumerating an airport's lounges. The
 * single best result of the real DCA run — "Lounges at Ronald Reagan Washington
 * National Airport [DCA]" — came from this shape, not from a programme query.
 */
function loungeAirportQuery_(code) {
  return String(code || '').trim().toUpperCase() + ' airport lounges list';
}

/**
 * Raw search candidates for each airport x programme pair.
 *
 * Modelled on searchLocalEvents_ (WeekendPlanner.js): fetch, normalise, truncate,
 * and return [] on any failure rather than throwing into a mailer.
 *
 * WHY THIS EXISTS. The lounge lookup used to be pure model recall, and it invented
 * lounges — a "Centurion Lounge Chicago O'Hare" at an airport that has never had
 * one, and the same at IAD. The prompt already said "only include lounges you are
 * CONFIDENT exist ... do not guess" and it guessed anyway, so the fix is not
 * stronger wording: it is giving the model something real to read, and then
 * checking its answer against that text.
 *
 * Candidates stay TAGGED by airport. Grounding has to be checked against the
 * snippets for the airport in question — merging them lets a lounge that really
 * exists at one airport vouch for a fabricated one at another.
 *
 * @param {Array} airports    — [{ code, role }]
 * @param {Array} loungePerks — [{ program, card }]
 * @returns {Object} airport code -> [{ title, snippet, link, program }]
 */
function searchLoungeCandidates_(airports, loungePerks) {
  var byAirport = {};
  if (typeof doWebSearch_ !== 'function') return byAirport;

  var cache   = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  var queries = 0;

  // 24h: lounge listings do not move hour to hour, and tbLoungeAccess gets run
  // repeatedly while diagnosing. Same justification as the geocode cache.
  function fetch_(query, cacheKey, code, program) {
    var hits = null;
    if (cache) {
      try {
        var cached = cache.get(cacheKey);
        if (cached) hits = JSON.parse(cached);
      } catch (e_) {}
    }
    if (hits === null) {
      if (queries >= LOUNGE_SEARCH_MAX_QUERIES_) return;
      queries++;
      try {
        hits = doWebSearch_(query, 4) || [];
      } catch (searchErr) {
        Logger.log('searchLoungeCandidates_: search failed for "' + query + '" — ' + searchErr.message);
        hits = [];
      }
      if (cache) {
        try { cache.put(cacheKey, JSON.stringify(hits), 86400); } catch (e2_) {}
      }
    }
    hits.forEach(function(r) {
      byAirport[code].push({
        title:   String(r.title   || '').replace(/\s+/g, ' ').trim().substring(0, 150),
        snippet: String(r.snippet || '').replace(/\s+/g, ' ').trim().substring(0, 300),
        link:    String(r.link    || '').trim(),
        program: program,
      });
    });
  }

  var codes = (airports || []).map(function(a) {
    return String(a && a.code || '').trim().toUpperCase();
  }).filter(function(c) { return !!c; });

  // General listing queries FIRST. They are the ones that surface pages naming
  // specific lounges, so a run that hits the cap keeps the most informative
  // results rather than a pile of brand pages.
  codes.forEach(function(code) {
    byAirport[code] = byAirport[code] || [];
    fetch_(loungeAirportQuery_(code), 'lounge_cand_' + code + '_all', code, '');
  });

  codes.forEach(function(code) {
    (loungePerks || []).forEach(function(p) {
      var program = String(p && p.program || '').trim();
      if (!program) return;
      fetch_(loungeProgramQuery_(program, code),
             'lounge_cand_' + code + '_' + program.toLowerCase().replace(/[^a-z0-9]/g, '_'),
             code, program);
    });
  });

  return byAirport;
}

/**
 * Does this programme actually operate a lounge at this airport?
 *
 * WHY A SEPARATE CHECK. Substring grounding answers "is this name in the text",
 * which is the wrong question for a descriptive name. "The Centurion Lounge at
 * Ronald Reagan Washington National Airport" is real but is not a contiguous string
 * in any snippet, while "Centurion Lounge" appears in ORD's results too — inside a
 * list of cities that does not include Chicago. No string test can separate "there
 * is one here" from "they exist, elsewhere". This asks that question directly.
 *
 * Same search-then-verdict shape as checkCardPerksActive_ (Code.js): one targeted
 * search, one short reply, one word. UNKNOWN counts as not confirmed — the failure
 * mode stays silence.
 *
 * @returns {string} 'CONFIRMED' | 'NOT_FOUND' | 'UNKNOWN'
 */
function verifyLoungeProgramAtAirport_(program, code) {
  var prog = String(program || '').trim();
  var ap   = String(code || '').trim().toUpperCase();
  if (!prog || !ap) return 'UNKNOWN';

  var cacheKey = 'lounge_verify_' + ap + '_' + prog.toLowerCase().replace(/[^a-z0-9]/g, '_');
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache) {
    try {
      var hit = cache.get(cacheKey);
      if (hit) return hit;
    } catch (e_) {}
  }

  var verdict = 'UNKNOWN';
  try {
    var results = doWebSearch_(prog + ' ' + ap + ' airport location', 4) || [];
    if (!results.length) {
      if (cache) { try { cache.put(cacheKey, verdict, 86400); } catch (e1_) {} }
      return verdict;
    }
    var snippetText = results.map(function(r) {
      return String(r.title || '') + ' — ' + String(r.snippet || '');
    }).join('\n');

    var prompt =
      'Question: does ' + prog + ' operate, or give access to, a lounge at ' + ap +
      ' airport?\n\n' +
      'Search results:\n' + snippetText + '\n\n' +
      'Answer from these results ONLY. Beware of pages that list the programme\'s ' +
      'locations at OTHER airports — those are not evidence about ' + ap + '.\n' +
      'Reply with EXACTLY one word: CONFIRMED if the results show a lounge at ' + ap +
      ', NOT_FOUND if they indicate there is none there, or UNKNOWN if they do not say.';

    // Raw text, not callClaudeJson_: the answer is one word, not an object.
    var payload = { model: CLAUDE_MODEL, max_tokens: 10, messages: [{ role: 'user', content: prompt }] };
    var resp = fetchTracked_('anthropic', CLAUDE_API_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': getApiKey(), 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(payload),
    });
    var text = JSON.parse(resp.getContentText()).content[0].text.trim().toUpperCase();
    if (text.indexOf('NOT_FOUND') !== -1 || text.indexOf('NOT FOUND') !== -1) verdict = 'NOT_FOUND';
    else if (text.indexOf('CONFIRMED') !== -1) verdict = 'CONFIRMED';
  } catch (err) {
    Logger.log('verifyLoungeProgramAtAirport_(' + prog + ', ' + ap + ') — ' + err.message);
    verdict = 'UNKNOWN';
  }

  if (cache) { try { cache.put(cacheKey, verdict, 86400); } catch (e3_) {} }
  return verdict;
}

/** Everything fetched for one airport, as one lowercase alphanumeric blob. */
function loungeCorpusFor_(candidates, code) {
  var list = (candidates || {})[String(code || '').toUpperCase()] || [];
  return list.map(function(r) { return r.title + ' ' + r.snippet; })
             .join(' ')
             .toLowerCase()
             .replace(/[^a-z0-9]/g, '');
}

/**
 * Does this lounge name actually occur in what we retrieved for its airport?
 *
 * The deterministic guard, and the one that stops the invented lounges. Both sides
 * are reduced to lowercase alphanumerics, so "The Centurion® Lounge" matches
 * "Centurion Lounge" while "centurionloungechicagoohare" — which appears in no ORD
 * snippet — does not match anything.
 */
function loungeNameIsGrounded_(name, corpus) {
  var n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (n.length < 4) return false;          // too short to be evidence of anything
  return String(corpus || '').indexOf(n) !== -1;
}

/** A name field carrying a caveat is not a name. */
var LOUNGE_HEDGE_RE_ = /check|varies|excluded|unknown|n\/a|participating|verify|confirm/i;

/** A detail field carrying a non-answer is not data. */
var LOUNGE_NONANSWER_RE_ = /varies|check|unknown|n\/a|typically|usually|approximate|depends/i;

/** Nulls a detail field that is really a shrug. */
function loungeDetailOrNull_(v) {
  var t = String(v == null ? '' : v).trim();
  if (!t) return null;
  return LOUNGE_NONANSWER_RE_.test(t) ? null : t;
}

/**
 * Keeps only lounges we can point at, and strips fields that say nothing.
 *
 * Runs over the model's reply because the prompt cannot be trusted to enforce its
 * own rules — this is what actually holds the line. Every drop is logged with its
 * reason so diagnoseLoungeAccess_ can show the working.
 *
 * @returns {{kept: Array, dropped: Array<string>}}
 */
function validateLounges_(lounges, candidates, airports, loungePerks) {
  var okAirports = {};
  (airports || []).forEach(function(a) {
    okAirports[String(a && a.code || '').toUpperCase()] = true;
  });
  var okPrograms = {};
  (loungePerks || []).forEach(function(p) {
    okPrograms[String(p && p.program || '').trim().toLowerCase()] = p.card || '';
  });

  var kept = [], dropped = [];

  (lounges || []).forEach(function(l) {
    if (!l || typeof l !== 'object') return;
    var name = String(l.lounge_name || '').trim();
    var code = String(l.airport_code || '').trim().toUpperCase();
    var prog = String(l.program || '').trim();

    if (!name)                       { dropped.push('(unnamed) — no lounge_name'); return; }
    if (!okAirports[code])           { dropped.push(name + ' — airport "' + code + '" was not asked about'); return; }
    if (!okPrograms[prog.toLowerCase()]) { dropped.push(name + ' @ ' + code + ' — programme "' + prog + '" is not held'); return; }
    // Model misbehaviour first — these say something about what it did, which is
    // more useful in the log than a length complaint.
    if (/[(\[]/.test(name))          { dropped.push(name + ' — name contains a parenthetical caveat'); return; }
    if (LOUNGE_HEDGE_RE_.test(name)) { dropped.push(name + ' — name hedges rather than names'); return; }

    // TWO WAYS IN, and keeping both matters.
    //
    // Verbatim is the deterministic guard and costs nothing — it is how a proper
    // noun like "The Club DCA" gets through. But it produced a false negative on a
    // real lounge: "The Centurion Lounge at Ronald Reagan Washington National
    // Airport" is a description, not a string any snippet contains, and a 60-char
    // cap killed it before it was even tested.
    //
    // So a name that is not verbatim is not rejected — it is escalated to the
    // question a string test cannot answer: does this programme have a lounge at
    // this airport at all? That is what separates the real DCA Centurion from the
    // invented ORD one, since "Centurion Lounge" appears in both corpora.
    var corpus = loungeCorpusFor_(candidates, code);
    if (loungeNameIsGrounded_(name, corpus)) {
      l.admittedBy = 'verbatim';
    } else {
      var verdict = 'UNKNOWN';
      try { verdict = verifyLoungeProgramAtAirport_(prog, code); } catch (ve) {
        Logger.log('validateLounges_: verification threw — ' + ve.message);
      }
      if (verdict !== 'CONFIRMED') {
        dropped.push(name + ' @ ' + code + ' — not in ' + code + '’s results, and "' +
                     prog + ' at ' + code + '" came back ' + verdict);
        return;
      }
      l.admittedBy = 'verified';
    }

    // Length last, and generous: a real name can be long. This is a sanity bound on
    // a runaway string, not a judgement about what a name looks like.
    if (name.length > 100) {
      dropped.push(name.substring(0, 40) + '… — name implausibly long (' + name.length + ' chars)');
      return;
    }

    // Details survive only if they say something. The card always comes from the
    // perks tab, never from the model.
    l.lounge_name   = name;
    l.airport_code  = code;
    l.card          = okPrograms[prog.toLowerCase()] || l.card || '';
    l.terminal      = loungeDetailOrNull_(l.terminal);
    l.hours         = loungeDetailOrNull_(l.hours);
    l.guest_limit   = loungeDetailOrNull_(l.guest_limit);
    l.access_window = loungeDetailOrNull_(l.access_window);
    l.access_notes  = loungeDetailOrNull_(l.access_notes);
    kept.push(l);
  });

  return { kept: kept, dropped: dropped };
}

function buildTravelLoungeData_(airports, loungePerks) {
  var programList = loungePerks.map(function(p) {
    return p.program + ' (via ' + p.card + ')';
  }).join(', ');

  var airportList = airports.map(function(a) {
    return a.code + ' (' + a.role + ')';
  }).join(', ');

  // ---- grounding ----------------------------------------------------------
  // Asked of the web before it is asked of the model. Without this the lookup was
  // pure recall and invented lounges that do not exist.
  var candidates = searchLoungeCandidates_(airports, loungePerks);
  var candidateCount = 0;
  Object.keys(candidates).forEach(function(code) { candidateCount += candidates[code].length; });

  if (!candidateCount) {
    // No search key, or nothing came back. Deliberately does NOT fall through to an
    // ungrounded model call — that is the behaviour being removed.
    Logger.log('LOUNGE: no search candidates (VERA_SEARCH_API_KEY unset, or no results). ' +
               'Falling back to programmes held rather than naming lounges we cannot check.');
    var bare = emptyLoungeData_(loungePerks, airports);
    bare.searchedAirports = Object.keys(candidates).length;
    bare.candidateCount   = 0;
    return bare;
  }

  var evidence = Object.keys(candidates).map(function(code) {
    var rows = candidates[code];
    if (!rows.length) return code + ': (nothing found)';
    return code + ':\n' + rows.map(function(r, i) {
      return '  [' + (i + 1) + '] (' + r.program + ') ' + r.title + ' — ' + r.snippet;
    }).join('\n');
  }).join('\n\n');

  var prompt =
    'You are selecting airport lounges from SEARCH RESULTS. Do not use prior knowledge.\n\n' +
    'Ahmed holds these lounge access programmes: ' + programList + '.\n' +
    'Today\'s relevant airports (departure and layovers only): ' + airportList + '.\n\n' +
    'SEARCH RESULTS, grouped by airport:\n' + evidence + '\n\n' +
    'Rules:\n' +
    '- Name ONLY lounges that appear in the search results above, under their own airport.\n' +
    '- If the results do not show a lounge for an airport and programme, return nothing for that pair.\n' +
    '- Copy the lounge name EXACTLY as it appears. Never append a caveat, exclusion, or\n' +
    '  instruction to the name — the name field must contain a name and nothing else.\n' +
    '- Fill terminal, hours, guest_limit and access_window ONLY from the results. If the\n' +
    '  results do not state one, use null. Never write "varies", "check the app", or similar.\n' +
    '- An empty list is a perfectly good answer.\n\n' +
    'Return ONLY a valid JSON object (no markdown, no preamble):\n' +
    '{\n' +
    '  "lounges": [\n' +
    '    {\n' +
    '      "airport_code": "IAD",\n' +
    '      "airport_name": "Washington Dulles International",\n' +
    '      "role": "departure",\n' +
    '      "program": "Priority Pass",\n' +
    '      "lounge_name": "Club at IAD",\n' +
    '      "terminal": "C" or null,\n' +
    '      "location_notes": "Airside, past security" or null,\n' +
    '      "hours": "5:00 AM – 10:00 PM" or null,\n' +
    '      "guest_limit": "2 guests at no charge" or null,\n' +
    '      "access_window": "Must enter at least 1 hour before close" or null,\n' +
    '      "access_notes": "Capacity limits apply" or null\n' +
    '    }\n' +
    '  ],\n' +
    '  "tip": "One sentence comparing the options above, or an empty string. Base it only on the results."\n' +
    '}';

  // A bigger budget than callClaudeJson_'s 1024 default. Eleven fields per lounge
  // across several airports can outrun it, and a truncated reply fails JSON.parse
  // inside callClaudeJson_, returns the fallback, and is indistinguishable from
  // "no lounges found" — gate 5 wearing gate 4's clothes.
  var result = callClaudeJson_(prompt, null, { maxTokens: 3000 });
  if (!result || typeof result !== 'object') {
    Logger.log('LOUNGE: gate 5 — no parseable reply from Claude (empty, error, or a ' +
               'reply too long for the token budget). Falling back to programs held.');
    return emptyLoungeData_(loungePerks, airports);
  }
  if (!Array.isArray(result.lounges)) result.lounges = [];
  if (typeof result.tip !== 'string') result.tip = '';

  // ---- validation ---------------------------------------------------------
  // The prompt cannot enforce its own rules; this can. A name that appears in no
  // snippet for its own airport is dropped here.
  var verdict = validateLounges_(result.lounges, candidates, airports, loungePerks);
  result.lounges = verdict.kept;
  result.dropped = verdict.dropped;
  if (verdict.dropped.length) {
    Logger.log('LOUNGE: dropped ' + verdict.dropped.length + ' unverifiable lounge(s):');
    verdict.dropped.forEach(function(d) { Logger.log('   - ' + d); });
  }
  // The tip was written against the list BEFORE validation, so anything dropped
  // invalidates it — the real ORD case had the tip recommending the very Centurion
  // Lounge that had just been removed, putting the invention back in the email
  // through a different field. Clearing on ANY drop is the conservative rule; a
  // good tip occasionally lost costs far less than a confident wrong one.
  if (!result.lounges.length || verdict.dropped.length) result.tip = '';

  // Always carried, so the renderers can show the programs held even when the
  // model named nothing.
  result.programs = loungePerks;
  result.airports = airports;
  result.resolved = result.lounges.length > 0;
  result.candidateCount = candidateCount;

  if (!result.resolved) {
    Logger.log('LOUNGE: gate 4 — nothing survived grounding for [' + airportList +
               ']. Falling back to programs held.');
  } else {
    Logger.log('LOUNGE: ' + result.lounges.length + ' lounge(s) named and verified against search.');
  }
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
  if (!data) return '';

  var BLUE  = '#1565c0';
  var DARK  = '#111111';
  var GREY  = '#555555';
  var LGREY = '#888888';

  var heading =
    '<p style="margin:0 0 16px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
    'letter-spacing:1.5px;text-transform:uppercase;">🛋️ Lounge Access</p>';

  // Nothing named, but access genuinely held: say so rather than vanishing. An
  // empty section reads identically to the bug that hid this one for months, and
  // "you have Priority Pass, check the app" is worth more than silence.
  if (!data.lounges || !data.lounges.length) {
    if (!data.programs || !data.programs.length) return '';
    return heading + loungeFallbackHtml_(data, { GREY: GREY, LGREY: LGREY });
  }

  var html = heading;

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

  // Unlike the flight times, none of this is measured — there is no lounge
  // database here, so names, terminals, hours and guest fees are all recalled
  // rather than looked up. Say so once, plainly, instead of presenting them as fact.
  html +=
    '<p style="margin:10px 0 0;font-size:11px;color:' + LGREY + ';">' +
    LOUNGE_CAVEAT_ + '</p>';

  return html;
}

/** Said once in each renderer, so the two cannot drift apart. */
var LOUNGE_CAVEAT_ = 'Lounge details are from memory, not a live feed — confirm hours ' +
                     'and guest policy in the program’s app before you count on them.';

/**
 * The "you have access, we just cannot name the lounge" state.
 *
 * Reached when Claude declines to name a lounge (gate 4) or its reply could not be
 * parsed (gate 5). Prints what IS known for certain — the programs the Card Perks
 * tab says are held, and today's airports — and nothing that isn't.
 */
function loungeFallbackHtml_(data, colors) {
  var GREY  = colors.GREY;
  var LGREY = colors.LGREY;

  var programs = (data.programs || []).map(function(p) {
    return escapeHtml_(p.program) + (p.card ? ' <span style="color:' + LGREY + ';">(' +
                                     escapeHtml_(p.card) + ')</span>' : '');
  }).join('<br>');

  var airports = (data.airports || []).map(function(a) {
    return escapeHtml_(a.code) + (a.role ? ' (' + escapeHtml_(a.role) + ')' : '');
  }).join(', ');

  return '<p style="margin:0 0 6px;font-size:13px;color:' + GREY + ';">' + programs + '</p>' +
    (airports
      ? '<p style="margin:0 0 6px;font-size:12px;color:' + LGREY + ';">Today: ' + airports + '</p>'
      : '') +
    '<p style="margin:0;font-size:12px;color:' + LGREY + ';">' +
    'No specific lounge could be confirmed for ' +
    (airports ? 'these airports' : 'today') +
    ' — check the program’s app for the current list.</p>';
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
    var keys = tripKeysFor_(tripKey);
    for (var i = 0; i < data.length; i++) {
      var context = String(data[i][1] || '').trim().toLowerCase();
      if (tripRowMatches_(data[i][0], keys) &&
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
 * buildTravelDayNarrativeData_(sortedItems, tripLabel, insights, toneMode, briefing)
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
function buildTravelDayNarrativeData_(sortedItems, tripLabel, insights, toneMode, briefing) {
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
      // Omitted entirely when unset — an empty line is something to reason about.
      (briefing ? 'What this trip is actually for: ' + briefing + '\n' +
                  'Let that shape the tagline and narrative.\n\n' : '') +
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

/**
 * diagnoseTravelDayMap_(dateStr)
 *
 * Why this exists: the static map is the only outbound Google call in this
 * codebase that is never made server-side. The URL is concatenated into an
 * <img src> and fetched by GMAIL'S IMAGE PROXY when the mail is opened — so a
 * rejection happens on Google's infrastructure, the error body is never
 * rendered, and the reader sees an empty box with no clue. It is also invisible
 * to API health, because health entries only exist for services this script
 * actually fetches.
 *
 * Worse, the one existing check is misleading: testTravelLegsApi_ verifies
 * DISTANCE MATRIX, which is a separately-enabled API. The key can pass that and
 * still be rejected for Maps Static, and the property is even named
 * GOOGLE_STATIC_MAPS_API_KEY.
 *
 * So this fetches the real URL and prints what Google actually says. Read-only:
 * sends no mail, writes no sheet.
 *
 * @param {string} [dateStr] — 'yyyy-MM-dd'; defaults to today
 */
function diagnoseTravelDayMap_(dateStr) {
  var tz    = Session.getScriptTimeZone();
  var today = String(dateStr || '').trim() ||
              Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  Logger.log('=== Travel-day map diagnostic — ' + today + ' ===');

  // ---- 1. the key ---------------------------------------------------------
  var apiKey = PropertiesService.getScriptProperties()
                 .getProperty('GOOGLE_STATIC_MAPS_API_KEY') || '';
  if (!apiKey) {
    Logger.log('STOP — GOOGLE_STATIC_MAPS_API_KEY is not set.');
    Logger.log('  With no key the whole "Today\'s Route" block is hidden, so if you');
    Logger.log('  SAW a heading and caption in the email, the key was set when it sent.');
    Logger.log('  Set it in Project Settings -> Script Properties.');
    return;
  }
  Logger.log('Key: present, ' + apiKey.length + ' chars, starts "' + apiKey.substring(0, 4) + '…"');

  // ---- 2. the markers, exactly as the email would build them --------------
  var rows = [];
  try {
    var sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
    if (sheet && sheet.getLastRow() >= 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, ITINERARY_HEADERS.length)
        .getValues().forEach(function(row) {
          var d = row[4];
          var ds = (d instanceof Date) ? Utilities.formatDate(d, tz, 'yyyy-MM-dd')
                                       : String(d || '').trim();
          if (ds === today) rows.push(row);
        });
    }
  } catch (e) {
    Logger.log('Itinerary read failed: ' + e.message);
  }
  Logger.log(rows.length + ' itinerary row(s) dated ' + today);
  if (!rows.length) {
    Logger.log('STOP — nothing to map. Set TB_DATE to a real travel day and re-run.');
    return;
  }

  var enriched = enrichTravelItems_(rows);
  Logger.log('Addresses as the map would see them (JSON-quoted so arrows and');
  Logger.log('newlines are visible):');
  enriched.forEach(function(e, i) {
    Logger.log('  [' + i + '] ' + JSON.stringify(e.displayAddress || ''));
  });

  var markers = travelMapMarkers_(enriched);
  Logger.log('After screening, ' + markers.length + ' usable marker(s):');
  markers.forEach(function(m, i) { Logger.log('  [' + i + '] ' + JSON.stringify(m)); });
  var dropped = enriched.length - markers.length;
  if (dropped > 0) Logger.log('  (' + dropped + ' dropped as unusable, duplicate, or route-shaped)');
  if (markers.length < 2) {
    Logger.log('STOP — fewer than 2 usable stops, so no map is built at all.');
    Logger.log('  The email shows the "not enough stops" note instead.');
    return;
  }

  // ---- 3. the one thing nothing else does: actually fetch it --------------
  var url = buildTravelStaticMapUrl_(enriched, apiKey);
  Logger.log('URL length: ' + url.length + ' chars (limit is 8192)');
  var resp = null;
  try {
    resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (fe) {
    Logger.log('FAIL — the request threw: ' + fe.message);
    return;
  }
  var code = resp.getResponseCode();
  var ctype = '';
  try { ctype = String(resp.getHeaders()['Content-Type'] || resp.getHeaders()['content-type'] || ''); } catch (he) {}
  var body = '';
  try { body = String(resp.getContentText() || '').substring(0, 400); } catch (be) { body = '(binary)'; }

  Logger.log('HTTP ' + code + '   Content-Type: ' + ctype);

  if (code === 200 && ctype.indexOf('image') === 0) {
    Logger.log('PASS — Google returned a real image. The key, the API and every');
    Logger.log('  marker are fine, so a blank box in the mail is client-side:');
    Logger.log('  images blocked in your mail app, or Gmail caching an earlier failure.');
    return;
  }

  Logger.log('Google said: ' + body);
  var verdict = travelMapVerdict_(code, body);
  verdict.lines.forEach(function(l) { Logger.log(l); });

  if (verdict.kind === 'bad_marker') {
    markers.forEach(function(m, i) {
      var one = 'https://maps.googleapis.com/maps/api/staticmap?size=200x200&markers=' +
                encodeURIComponent(m) + '&key=' + apiKey;
      var r = null;
      try { r = UrlFetchApp.fetch(one, { muteHttpExceptions: true }); } catch (e2) {}
      var ok = r && r.getResponseCode() === 200;
      Logger.log('    ' + (ok ? 'ok  ' : 'FAIL') + ' [' + i + '] ' + JSON.stringify(m));
    });
    Logger.log('  Fix the FAIL rows\' Location in the Travel tab, or leave them blank.');
  }
}

/**
 * Turns Google's HTTP status and response body into a named verdict.
 *
 * SPLIT OUT SO IT CAN BE TESTED. It used to be an if/else chain inline, asserted only
 * by regexes over this file's source text — which pinned the matcher's spelling without
 * ever checking that spelling against what Google actually says. It did not match, and
 * the one case this tool exists to name came out as "unrecognised":
 *
 *   HTTP 403 — "This API is not activated on your API project."
 *   DIAGNOSIS — unrecognised failure.
 *
 * The matcher was looking for "not authorized to use this api". Both wordings are real;
 * Google is not consistent across its Maps APIs, so match on either. A source-text
 * regex cannot fail when the wording changes. A classifier driven by a real body can.
 *
 * @param {number} code  HTTP status
 * @param {string} body  the response body, as returned
 * @returns {{kind: string, lines: Array<string>}} kind is one of not_enabled,
 *          restricted, billing, signing, bad_marker, unknown
 */
function travelMapVerdict_(code, body) {
  var b = String(body == null ? '' : body).toLowerCase();

  // Every wording Google has been observed to use for "you have not switched this on".
  var notEnabled = b.indexOf('not authorized to use this api') !== -1 ||
                   b.indexOf('not activated') !== -1 ||
                   b.indexOf('api is not enabled') !== -1 ||
                   b.indexOf('has not been used in project') !== -1;

  if (code === 403 && notEnabled) {
    return { kind: 'not_enabled', lines: [
      'DIAGNOSIS — the Maps Static API is NOT ENABLED on the Cloud project.',
      '  It is separate from Distance Matrix, which is the only thing',
      '  testTravelLegsApi_ checks — so that passing told you nothing here.',
      '  Fix: Cloud Console -> APIs & Services -> enable "Maps Static API".',
    ] };
  }
  if (b.indexOf('referer') !== -1 || b.indexOf('referrer') !== -1 || b.indexOf('ip address') !== -1) {
    return { kind: 'restricted', lines: [
      'DIAGNOSIS — the key is RESTRICTED in a way that excludes this call.',
      "  Gmail fetches the image through its own proxy, which sends no",
      '  referrer and an IP you cannot allowlist. A referrer-restricted',
      '  key can never work in email. Use a separate key restricted by',
      '  API only, not by referrer or IP.',
    ] };
  }
  if (b.indexOf('billing') !== -1 || code === 402) {
    return { kind: 'billing', lines: ['DIAGNOSIS — BILLING is not enabled on the Cloud project.'] };
  }
  if (b.indexOf('signature') !== -1 || b.indexOf('must be signed') !== -1) {
    return { kind: 'signing', lines: ['DIAGNOSIS — this project requires URL SIGNING for Maps Static.'] };
  }
  if (code === 400) {
    return { kind: 'bad_marker', lines: [
      'DIAGNOSIS — a marker failed to geocode, which fails the WHOLE image.',
      '  Bisecting to find which one…',
    ] };
  }
  // The catch-all still prints Google's own text above it. That is what made this
  // particular failure recoverable despite being misclassified, and it must survive
  // every widening of the matchers above.
  return { kind: 'unknown', lines: [
    "DIAGNOSIS — unrecognised failure. The body above is Google's own text.",
  ] };
}

// ---------------------------------------------------------------------------

/**
 * Why LOUNGE ACCESS is empty.
 *
 * Five things have to line up, and until the logging added alongside this, a
 * skipped section left no trace at all — which is how the orphaned-paragraph bug
 * that made getLoungePerkPrograms_ throw survived on every travel-day email ever
 * sent. This walks the gates in order and stops at the first that fails.
 *
 * Sends nothing, writes nothing. The Claude call in gate 4 is the only outbound
 * request, and only if gates 1-3 pass.
 *
 * @param {string} [dateStr]         — 'yyyy-MM-dd'; blank = today
 * @param {string} [airportsOverride]— 'TPA,IAD' to test WITHOUT a trip on the
 *        calendar. Skips gate 3's itinerary scan, so lounge matching can be
 *        checked on any day rather than only on a travel day.
 */
function diagnoseLoungeAccess_(dateStr, airportsOverride) {
  var tz    = Session.getScriptTimeZone();
  var today = String(dateStr || '').trim() ||
              Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  Logger.log('=== Lounge access diagnostic — ' + today + ' ===');

  // ---- gate 1 + 2: the perks ----------------------------------------------
  var ss = getSpreadsheet();

  var ccSheet = ss.getSheetByName(TABS.CREDIT_CARDS);
  var activeNames = [], inactiveNames = [];
  if (ccSheet && ccSheet.getLastRow() >= 2) {
    ccSheet.getRange(2, 1, ccSheet.getLastRow() - 1, 10).getValues().forEach(function(row) {
      var name   = String(row[1] || '').trim();
      var active = String(row[9] || '').trim().toLowerCase();
      if (!name) return;
      if (active !== 'false' && active !== 'no' && active !== '0') activeNames.push(name);
      else inactiveNames.push(name + ' [Active="' + active + '"]');
    });
  }
  Logger.log('Credit Cards: ' + activeNames.length + ' active — ' + (activeNames.join(', ') || '(none)'));
  if (inactiveNames.length) Logger.log('  excluded as inactive: ' + inactiveNames.join(', '));
  if (!activeNames.length) {
    Logger.log('  NOTE: with no active cards the active filter is skipped entirely, so ' +
               'every perk row counts. That is deliberate, not a bug.');
  }

  var cpSheet = ss.getSheetByName(TABS.CARD_PERKS);
  if (!cpSheet || cpSheet.getLastRow() < 2) {
    Logger.log('STOP — gate 2. The Card Perks tab is missing or has only a header row.');
    Logger.log('  Nothing can match. Add a perk row for whatever lounge access you hold.');
    return;
  }
  Logger.log('');
  Logger.log('Card Perks — every row, and what it matched:');
  var activeLookup = {};
  activeNames.forEach(function(n) { activeLookup[n.toLowerCase()] = true; });
  cpSheet.getRange(2, 1, cpSheet.getLastRow() - 1, 7).getValues().forEach(function(row, i) {
    var cardName = String(row[1] || '').trim();
    var perkName = String(row[2] || '').trim();
    if (!cardName && !perkName) return;
    var progs = loungeProgramsForPerk_(perkName);
    var isActive = !activeNames.length || !!activeLookup[cardName.toLowerCase()];
    var verdict = !progs.length     ? 'no lounge keyword'
                : !isActive         ? 'MATCHED (' + progs.join(' + ') + ') but card is inactive'
                :                     'MATCH -> ' + progs.join(' + ');
    Logger.log('  row ' + (i + 2) + '  ' + cardName + ' | ' + perkName + '  =>  ' + verdict);
  });

  var loungePerks = getLoungePerkPrograms_();
  Logger.log('');
  Logger.log('getLoungePerkPrograms_ returned ' + loungePerks.length + ': ' +
             (loungePerks.map(function(p) { return p.program + ' (' + p.card + ')'; }).join(', ') || '(none)'));
  if (!loungePerks.length) {
    Logger.log('STOP — gate 2. No perk row names a lounge program, so no lookup happens');
    Logger.log('  and the section is correctly empty. This is a SHEET fix, not a code fix:');
    Logger.log('  add a Card Perks row whose Perk text names the program, e.g.');
    Logger.log('    "Priority Pass (airport lounge access)" / "Centurion Lounge access"');
    Logger.log('    "Delta Sky Club membership" / "Capital One Lounge access"');
    Logger.log('  Recognised: ' + LOUNGE_PROGRAM_PATTERNS_.map(function(e) { return e.program; }).join(', ') +
               ', or anything containing "lounge".');
    return;
  }

  // ---- gate 3: the airports ----------------------------------------------
  var airports = [];
  if (String(airportsOverride || '').trim()) {
    airports = String(airportsOverride).split(/[,\s]+/)
      .map(function(c) { return c.trim().toUpperCase(); })
      .filter(function(c) { return /^[A-Z]{3}$/.test(c); })
      .map(function(c, i) { return { code: c, role: i === 0 ? 'departure' : 'layover' }; });
    Logger.log('');
    Logger.log('Airports: OVERRIDDEN to [' +
               airports.map(function(a) { return a.code + ':' + a.role; }).join(', ') +
               '] — the itinerary scan was skipped, so gate 3 is untested here.');
  } else {
    var rows = [];
    try {
      var itSheet = ss.getSheetByName(TABS.ITINERARY);
      if (itSheet && itSheet.getLastRow() >= 2) {
        itSheet.getRange(2, 1, itSheet.getLastRow() - 1, ITINERARY_HEADERS.length)
          .getValues().forEach(function(row) {
            var d = row[4];
            var ds = (d instanceof Date) ? Utilities.formatDate(d, tz, 'yyyy-MM-dd')
                                         : String(d || '').trim();
            if (ds === today) rows.push(row);
          });
      }
    } catch (e) {
      Logger.log('Itinerary read failed: ' + e.message);
    }
    var flightRows = rows.filter(function(r) {
      return String(r[2] || '').trim().toLowerCase() === 'flight';
    });
    Logger.log('');
    Logger.log(rows.length + ' itinerary row(s) dated ' + today + ', ' +
               flightRows.length + ' of them flights.');
    flightRows.forEach(function(r, i) {
      var meta = {};
      try { meta = JSON.parse(String(r[9] || '{}')); } catch (e) {}
      Logger.log('  flight ' + i + '  "' + String(r[3] || '') + '"' +
                 '  Location=' + JSON.stringify(String(r[7] || '')) +
                 '  meta.origin=' + (meta.origin || '(none)') +
                 '  meta.dest='   + (meta.dest   || '(none)'));
    });
    // The same function the email uses, not a copy of it.
    airports = travelDayAirports_(rows);
    Logger.log('travelDayAirports_ returned [' +
               airports.map(function(a) { return a.code + ':' + a.role; }).join(', ') + ']');
    Logger.log('  (the LAST flight\'s destination is omitted on purpose — a lounge you');
    Logger.log('   reach after landing is no use to you.)');
  }

  if (!airports.length) {
    Logger.log('STOP — gate 3. No IATA code could be found, so there is no airport to');
    Logger.log('  look up and the section is empty. Either the flight rows carry no');
    Logger.log('  origin/dest metadata and no bare 3-letter code in Location, or there');
    Logger.log('  are no flights today.');
    Logger.log('  To test the rest of the chain anyway, set TB_AIRPORTS = \'TPA,IAD\' and re-run.');
    return;
  }

  // ---- gates 4 + 5: the model -------------------------------------------
  Logger.log('');
  Logger.log('Gates 1-3 pass. Looking up [' +
             airports.map(function(a) { return a.code; }).join(', ') + '] with [' +
             loungePerks.map(function(p) { return p.program; }).join(', ') + '].');

  // ---- what the lookup will actually read ---------------------------------
  // Shown before the call, so "the data is wrong" becomes "that name was in no
  // snippet" without needing a code change to find out.
  var cands = {};
  try {
    cands = searchLoungeCandidates_(airports, loungePerks);
  } catch (se) {
    Logger.log('searchLoungeCandidates_ threw — ' + se.message);
  }
  var total = 0;
  Object.keys(cands).forEach(function(code) { total += cands[code].length; });
  Logger.log('');
  Logger.log('Search candidates: ' + total + ' across ' + Object.keys(cands).length + ' airport(s).');
  Object.keys(cands).forEach(function(code) {
    Logger.log('  ' + code + ': ' + cands[code].length + ' result(s)');
    cands[code].slice(0, 4).forEach(function(r) {
      Logger.log('    (' + r.program + ') ' + r.title.substring(0, 90));
    });
  });
  if (total) {
    Logger.log('');
    Logger.log('Programme-at-airport verdicts (the check a string match cannot make):');
    Object.keys(cands).forEach(function(code) {
      loungePerks.forEach(function(p) {
        var v = 'UNKNOWN';
        try { v = verifyLoungeProgramAtAirport_(p.program, code); } catch (ve) {}
        Logger.log('  ' + p.program + ' @ ' + code + '  ->  ' + v +
                   (v === 'CONFIRMED' ? '' : '   (a lounge for this pair now needs a verbatim match)'));
      });
    });
  }
  if (!total) {
    Logger.log('  NONE. Either VERA_SEARCH_API_KEY is unset in Script Properties, or the');
    Logger.log('  searches returned nothing. The lookup will NOT fall back to model recall —');
    Logger.log('  it shows the programmes you hold and stops, which is the point.');
  }
  var data = null;
  try {
    data = buildTravelLoungeData_(airports, loungePerks);
  } catch (e) {
    Logger.log('buildTravelLoungeData_ threw — ' + e.message);
    Logger.log('DIAGNOSIS — a hard error in the lookup. The email would show the');
    Logger.log('  programs-held fallback rather than nothing.');
    return;
  }

  Logger.log('');
  Logger.log('Result: resolved=' + !!data.resolved + ', ' +
             (data.lounges || []).length + ' lounge(s) kept, ' +
             ((data.dropped || []).length) + ' dropped, ' +
             (data.programs || []).length + ' program(s) carried.');
  (data.dropped || []).forEach(function(d) { Logger.log('  DROPPED  ' + d); });
  (data.lounges || []).forEach(function(l, i) {
    Logger.log('  [' + i + '] ' + (l.lounge_name || '(unnamed)') + ' @ ' + (l.airport_code || '?') +
               '  program=' + (l.program || '?') + '  terminal=' + (l.terminal || '-') +
               '  hours=' + (l.hours || '-'));
    Logger.log('        admitted by: ' + (l.admittedBy === 'verbatim'
               ? 'name found verbatim in ' + (l.airport_code || '?') + '’s results'
               : 'verification — "' + (l.program || '?') + ' at ' + (l.airport_code || '?') + '" CONFIRMED'));
  });
  if (data.tip) Logger.log('  tip: ' + data.tip);

  // ---- what the email would actually render ------------------------------
  Logger.log('');
  var html = buildTravelLoungeSection_(data);
  Logger.log('HTML section: ' + (html ? html.length + ' chars' : 'EMPTY (no section at all)'));
  var plain = buildTravelDayPlainText_('Diagnostic', today, [], null, null, data, '');
  var block = /LOUNGE ACCESS\n-+\n([\s\S]*?)\n\n/.exec(plain);
  Logger.log('Plain text section:');
  if (block) {
    block[1].split('\n').forEach(function(l) { Logger.log('  | ' + l); });
  } else {
    Logger.log('  (no LOUNGE ACCESS block — the two renderers must agree; if HTML is');
    Logger.log('   non-empty and this is missing, that is a bug worth reporting.)');
  }

  Logger.log('');
  if (data.resolved) {
    Logger.log('DIAGNOSIS — working. Every lounge named above appeared in the search');
    Logger.log('  results retrieved for its own airport. Details are printed only where the');
    Logger.log('  results stated them.');
  } else if ((data.programs || []).length) {
    if (!total) {
      Logger.log('DIAGNOSIS — no search results to work from, so nothing was named. Set');
      Logger.log('  VERA_SEARCH_API_KEY in Script Properties and re-run. The email shows the');
      Logger.log('  programmes you hold, which is correct but less useful than it could be.');
    } else if ((data.dropped || []).length) {
      Logger.log('DIAGNOSIS — candidates were found, but every lounge Claude named failed');
      Logger.log('  grounding (see DROPPED above). That is the guard working: a name that');
      Logger.log('  appears in no snippet for its airport does not reach the email.');
      Logger.log('  If a lounge you KNOW exists was dropped, the searches are not surfacing');
      Logger.log('  it — the query shape is the thing to change, not the guard.');
    } else {
      Logger.log('DIAGNOSIS — candidates were found but Claude named no lounge from them.');
      Logger.log('  Likely the results are about the programme in general rather than that');
      Logger.log('  airport. The email shows the programmes held.');
    }
  } else {
    Logger.log('DIAGNOSIS — no programs carried through, which should not happen once gate 2');
    Logger.log('  passed. Worth reporting.');
  }
}
