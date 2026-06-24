// ============================================================
// TravelDayBriefing.js — Issue #108b
// Sends a clean, shareable travel day briefing email on the
// morning of travel. No VERA branding — suitable for companions.
//
// Architecture:
//   checkAndSendTravelDayBriefings_()   ← entry point (called from morningNudge)
//     └─ sendTravelDayBriefing_(tripKey, items)
//          ├─ buildTravelDayEmailHtml_(label, date, sections)
//          │    └─ sections pipeline: [{ id, builder, data }, ...]
//          │         └─ buildTravelScheduleSection_(items)   ← today's only section
//          │         // Future: buildTravelWeatherSection_
//          │         // Future: buildTravelFlightStatusSection_
//          │         // Future: buildTravelGroupNotesSection_
//          ├─ buildTravelDayPlainText_(label, date, items)
//          └─ getTravelDayRecipients_(tripKey)
//
// To add a new email section: implement buildXxxSection_(data) → HTML,
// then push { id: 'xxx', builder: buildXxxSection_, data: payload }
// to the sections array in sendTravelDayBriefing_(). No other changes needed.
// ============================================================

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
  var sections = [
    // Future: { id: 'weather',       builder: buildTravelWeatherSection_,      data: null },
    // Future: { id: 'flight_status', builder: buildTravelFlightStatusSection_, data: null },
    { id: 'schedule', builder: buildTravelScheduleSection_, data: sortedItems },
    // Future: { id: 'group_notes',   builder: buildTravelGroupNotesSection_,   data: null },
  ];

  var recipients = getTravelDayRecipients_(tripKey);
  var subject    = '\u2708\uFE0F Travel Day \u2014 ' + tripLabel + ' \u00B7 ' + dateLabel;
  var htmlBody   = buildTravelDayEmailHtml_(tripLabel, dateLabel, sections);
  var plainText  = buildTravelDayPlainText_(tripLabel, dateLabel, sortedItems);

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
 * buildTravelScheduleSection_(items)
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
 * @param {Array} items — sorted flat row array (all types)
 * @returns {string} HTML string, or '' if items is empty
 */
function buildTravelScheduleSection_(items) {
  if (!items || !items.length) {
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

  items.forEach(function(row) {
    var type    = String(row[2] || '').trim();
    var title   = String(row[3] || '').trim() || '(untitled)';
    var startT  = String(row[5] || '').trim();
    var endT    = String(row[6] || '').trim();
    var loc     = String(row[7] || '').trim();
    var notes   = String(row[8] || '').trim();
    var meta    = {};
    if (row[9]) { try { meta = JSON.parse(String(row[9])); } catch(e_) {} }

    var timeStr = startT || 'All day';
    if (endT && endT !== startT) timeStr += ' \u2013 ' + endT;

    var typeLabel = type ? type.charAt(0).toUpperCase() + type.slice(1).toLowerCase() : '';

    html +=
      '<div style="display:flex;align-items:flex-start;margin-bottom:18px;">' +
      '<div style="width:34px;flex-shrink:0;font-size:20px;padding-top:2px;">' +
      typeIcon(type) + '</div>' +
      '<div style="flex:1;">' +
      '<p style="margin:0 0 2px;font-size:15px;font-weight:600;color:#1a1a2e;">' +
      escapeHtml_(title) + '</p>' +
      '<p style="margin:0 0 3px;font-size:13px;color:#888888;">' +
      escapeHtml_(timeStr) +
      (typeLabel ? ' \u00B7 ' + escapeHtml_(typeLabel) : '') +
      '</p>';

    if (loc) {
      html += '<p style="margin:0 0 3px;font-size:13px;color:#555555;">' +
              '\uD83D\uDCCD ' + escapeHtml_(loc) + '</p>';
    }
    if (meta.confirmationNumber) {
      html += '<p style="margin:0 0 3px;font-size:12px;color:#888888;">' +
              'Conf# ' + escapeHtml_(String(meta.confirmationNumber)) + '</p>';
    }
    if (notes) {
      html += '<p style="margin:0;font-size:12px;color:#888888;font-style:italic;">' +
              escapeHtml_(notes) + '</p>';
    }

    html += '</div></div>';
  });

  return html;
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
 * buildTravelDayPlainText_(tripLabel, dateLabel, items)
 * Plain-text fallback for email clients that don't render HTML.
 */
function buildTravelDayPlainText_(tripLabel, dateLabel, items) {
  var lines = [
    '\u2708\uFE0F Travel Day \u2014 ' + tripLabel,
    dateLabel,
    '',
    "TODAY'S SCHEDULE",
    '----------------',
  ];

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
