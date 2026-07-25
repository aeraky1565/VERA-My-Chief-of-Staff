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

  // ── Day-after nudge email (complements the flag) ───────────────────────────
  trips.forEach(function(trip) {
    try { sendPostTripNudgeEmail_(trip); } catch (e) {
      Logger.log('PostTripCapture: nudge email error for ' + trip.tripKey + ' — ' + e.message);
    }
  });

  // ── 48-hour recap email (fires ~2 days after trip end) ─────────────────────
  var recapTrips = getRecentlyCompletedTrips_(delayDays + 1);
  recapTrips.forEach(function(trip) {
    try { sendPostTripRecapEmail_(trip); } catch (e) {
      Logger.log('PostTripCapture: recap email error for ' + trip.tripKey + ' — ' + e.message);
    }
  });
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

// ─── POST-TRIP EMAIL FUNCTIONS ────────────────────────────────────────────────

/**
 * readTripRows_(tripKey)
 * Re-reads all Itinerary rows for a given tripKey, sorted by date + startTime.
 *
 * @param  {string} tripKey
 * @returns {Array} raw row arrays
 */
function readTripRows_(tripKey) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.ITINERARY);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
  return data
    .filter(function(row) { return String(row[1] || '').trim() === tripKey; })
    .sort(function(a, b) {
      var ak = String(a[4] || '') + '|' + String(a[5] || '');
      var bk = String(b[4] || '') + '|' + String(b[5] || '');
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    });
}

/**
 * sendPostTripNudgeEmail_(trip)
 * Sends a brief day-after email nudging Ahmed to debrief in Chat.
 * Templated prose — no Claude call needed.
 * Dedup: POSTTRIP_NUDGE_{key} Script Property.
 */
function sendPostTripNudgeEmail_(trip) {
  var props   = PropertiesService.getScriptProperties();
  var safeKey = 'POSTTRIP_NUDGE_' + trip.tripKey.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (props.getProperty(safeKey)) {
    Logger.log('sendPostTripNudgeEmail_: already sent for ' + trip.tripKey);
    return;
  }

  var tz            = Session.getScriptTimeZone();
  var durationMs    = trip.endDate.getTime() - trip.departureDate.getTime();
  var durationNights = Math.max(1, Math.round(durationMs / 86400000));
  var BLUE          = '#1565c0';

  var subject = '🧳 ' + trip.tripLabel + ' — Capture the Memories';

  var bodyHtml =
    '<p style="margin:0 0 14px;font-size:14px;color:#333;line-height:1.65;">' +
    'Your ' + durationNights + '-night ' + escapeHtml_(trip.tripLabel) + ' just wrapped up — ' +
    'before the details fade, it\'s worth capturing the highlights.' +
    '</p>' +
    '<p style="margin:0 0 20px;font-size:14px;color:#333;line-height:1.65;">' +
    'A quick chat debrief lets you log the restaurants worth returning to, the best experiences, ' +
    'anything you\'d skip next time, and what made this trip memorable. ' +
    'The recap email lands in 48 hours whether or not you debrief — ' +
    'but it\'s richer when you do.' +
    '</p>' +
    '<div style="text-align:center;margin:24px 0;">' +
    '<div style="display:inline-block;padding:12px 24px;background:' + BLUE + ';' +
    'border-radius:6px;font-size:14px;font-weight:700;color:#ffffff;">' +
    'Open Chat and say: "Let\'s debrief the ' + escapeHtml_(trip.tripLabel) + ' trip."' +
    '</div>' +
    '</div>';

  var sections = [{ id: 'nudge', data: bodyHtml }];
  var htmlBody = buildPreTripEmailHtml_('Post-Trip', trip.tripLabel, 'Capture it while it\'s fresh', sections);

  var plain =
    trip.tripLabel + ' just wrapped up.\n\n' +
    'Open Chat and say: "Let\'s debrief the ' + trip.tripLabel + ' trip."\n\n' +
    'A recap email will land in 48 hours with the full summary.\n\n— VERA';

  MailApp.sendEmail(
    CONFIG.MORNING_NUDGE_EMAIL, subject, plain,
    { name: 'VERA Travel', htmlBody: htmlBody });
  props.setProperty(safeKey, new Date().toISOString());
  Logger.log('sendPostTripNudgeEmail_: sent for ' + trip.tripKey);
}

/**
 * sendPostTripRecapEmail_(trip)
 * Sends a full trip recap ~48h after the trip ends.
 * Uses Chat debrief data when available; falls back to itinerary-only mode.
 * Dedup: POSTTRIP_RECAP_{key} Script Property.
 */
function sendPostTripRecapEmail_(trip) {
  var props    = PropertiesService.getScriptProperties();
  var safeKey  = 'POSTTRIP_RECAP_' + trip.tripKey.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (props.getProperty(safeKey)) {
    Logger.log('sendPostTripRecapEmail_: already sent for ' + trip.tripKey);
    return;
  }

  var tz            = Session.getScriptTimeZone();
  var durationMs    = trip.endDate.getTime() - trip.departureDate.getTime();
  var durationNights = Math.max(1, Math.round(durationMs / 86400000));
  var toneMode      = getTripToneMode_(trip.tripKey);
  var BLUE          = '#1565c0';

  // Load itinerary rows
  var rows = readTripRows_(trip.tripKey);
  var itinSummary = rows.map(function(row) {
    var date  = String(row[4] || '').trim();
    var type  = String(row[2] || '').trim();
    var title = String(row[3] || '').trim() || '(untitled)';
    var loc   = String(row[7] || '').trim();
    return date + ' [' + type + '] ' + title + (loc ? ' @ ' + loc : '');
  }).join('\n') || 'No itinerary items on record';

  // Check for completed debrief
  var debriefSafeKey  = 'POSTTRIP_DEBRIEF_' + trip.tripKey.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  var debriefProp     = props.getProperty(debriefSafeKey);
  var hasDebrief      = !!debriefProp;

  // If debrief completed, query Interests sheet for Chat items logged since trip end
  var highlightLines = [];
  if (hasDebrief) {
    try {
      var ss          = getSpreadsheet();
      var intSheet    = ss.getSheetByName(TABS.INTEREST_LEDGER);
      var tripEndMs   = trip.endDate.getTime();
      var windowMs    = 4 * 86400000; // 4-day window after trip end
      if (intSheet && intSheet.getLastRow() >= 2) {
        var intData = intSheet.getRange(2, 1, intSheet.getLastRow() - 1, INTEREST_LEDGER_HEADERS.length).getValues();
        intData.forEach(function(row) {
          if (String(row[5] || '').trim() !== 'Chat') return; // Source col
          var addedMs = 0;
          try { addedMs = new Date(String(row[1] || '')).getTime(); } catch (e_) {}
          if (!addedMs || addedMs < tripEndMs || addedMs > tripEndMs + windowMs) return;
          var person   = String(row[2] || '').trim();
          var interest = String(row[3] || '').trim();
          var category = String(row[4] || '').trim();
          if (interest) highlightLines.push('[' + category + '] ' + interest + (person ? ' (' + person + ')' : ''));
        });
      }
    } catch (e) {
      Logger.log('sendPostTripRecapEmail_: interests lookup error (non-fatal) — ' + e.message);
    }
  }

  // Build Claude prompt
  var claudePrompt;
  if (hasDebrief && highlightLines.length) {
    claudePrompt =
      'You are VERA, Ahmed\'s Chief of Staff. Ahmed returned from ' + trip.tripLabel + ' (' + durationNights + ' nights).\n\n' +
      'Itinerary:\n' + itinSummary + '\n\n' +
      'Debrief highlights:\n' + highlightLines.join('\n') + '\n\n' +
      'Tone mode: ' + toneMode + '\n' +
      '- "professional": polished, warm but refined. Like a concierge writing a client summary.\n' +
      '- "personal": warm, intimate. Like a friend reflecting on an adventure you shared.\n\n' +
      'Return ONLY valid JSON:\n' +
      '{\n' +
      '  "tagline": "One line capturing what made this trip memorable — like something you\'d put on a postcard.",\n' +
      '  "narrative": "2-3 paragraphs: a warm, specific narrative of the trip. Reference the itinerary AND the debrief highlights. End with one forward-looking sentence."\n' +
      '}';
  } else {
    claudePrompt =
      'You are VERA, Ahmed\'s Chief of Staff. Ahmed returned from ' + trip.tripLabel + ' (' + durationNights + ' nights).\n\n' +
      'Itinerary:\n' + itinSummary + '\n\n' +
      'Ahmed did not complete a Chat debrief within 48 hours. Assume all itinerary items were completed as planned. Write the recap from the itinerary alone.\n\n' +
      'Tone mode: ' + toneMode + '\n' +
      '- "professional": polished, warm but refined. Like a concierge writing a client summary.\n' +
      '- "personal": warm, intimate. Like a friend reflecting on an adventure you shared.\n\n' +
      'Return ONLY valid JSON:\n' +
      '{\n' +
      '  "tagline": "One line capturing what made this trip memorable — like something you\'d put on a postcard.",\n' +
      '  "narrative": "2-3 paragraphs: a warm, specific narrative of the trip based on the itinerary. End with one forward-looking sentence."\n' +
      '}';
  }

  var claudeResult = callClaudeJson_(claudePrompt,
    { tagline: trip.tripLabel + ' — wrapped up', narrative: 'What a trip. ' + trip.tripLabel + ' is now part of your story.' });
  var tagline   = String(claudeResult.tagline   || '').trim();
  var narrative = String(claudeResult.narrative || '').trim();

  var subject = '📸 ' + trip.tripLabel + ' — Trip Recap';

  // ── Section HTML builders ─────────────────────────────────────────────────
  var taglineNarrativeHtml = (function() {
    var html = '';
    if (tagline) {
      html +=
        '<div style="text-align:center;padding:12px 0 8px;color:#555;font-style:italic;' +
        'border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;margin-bottom:16px;">' +
        escapeHtml_(tagline) + '</div>';
    }
    if (narrative) {
      narrative.split(/\n+/).forEach(function(p) {
        if (p.trim()) {
          html += '<p style="margin:0 0 14px;font-size:14px;color:#333;line-height:1.65;">' +
                  escapeHtml_(p.trim()) + '</p>';
        }
      });
    }
    return html;
  }());

  var itinHtml = (function() {
    if (!rows.length) return '';
    var byDate = {}, dateOrder = [];
    rows.forEach(function(row) {
      var date  = String(row[4] || '').trim() || 'TBD';
      var type  = String(row[2] || '').trim();
      var title = String(row[3] || '').trim() || '(untitled)';
      var loc   = String(row[7] || '').trim();
      if (!byDate[date]) { byDate[date] = []; dateOrder.push(date); }
      byDate[date].push({ type: type, title: title, loc: loc });
    });

    // Merge debrief highlights into itinerary where category matches
    var highlightsByTopic = {};
    highlightLines.forEach(function(h) {
      var m = h.match(/^\[([^\]]+)\]\s+(.+)/);
      if (m) highlightsByTopic[m[1]] = highlightsByTopic[m[1]] || [];
    });

    var tz2 = Session.getScriptTimeZone();
    var html =
      '<p style="margin:0 0 12px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
      'letter-spacing:1.5px;text-transform:uppercase;">What You Did</p>';
    dateOrder.forEach(function(date) {
      var dLabel = date;
      try {
        var d = new Date(date + 'T00:00:00');
        if (!isNaN(d)) dLabel = Utilities.formatDate(d, tz2, 'EEE, MMM d');
      } catch (e_) {}
      html += '<p style="margin:4px 0;font-size:12px;font-weight:700;color:#444;">' +
              escapeHtml_(dLabel) + '</p>';
      byDate[date].forEach(function(item) {
        var line = item.title + (item.loc ? ' · ' + item.loc : '');
        html += '<p style="margin:1px 0 1px 12px;font-size:13px;color:#555;">• ' +
                escapeHtml_(line) + '</p>';
      });
      html += '<div style="height:8px;"></div>';
    });
    return html;
  }());

  var debriefFooterHtml = hasDebrief
    ? '<p style="margin:0;font-size:12px;color:#999;font-style:italic;text-align:center;">' +
      '✓ Memories saved to your log from your Chat debrief.' +
      '</p>'
    : '';

  var sections = [
    { id: 'narrative', data: taglineNarrativeHtml },
    { id: 'itinerary', data: itinHtml },
    { id: 'footer',    data: debriefFooterHtml },
  ];

  var depLabel = Utilities.formatDate(trip.departureDate, tz, 'MMM d');
  var endLbl   = Utilities.formatDate(trip.endDate,       tz, 'MMM d, yyyy');
  var htmlBody = buildPreTripEmailHtml_(
    'Trip Recap', trip.tripLabel, depLabel + ' – ' + endLbl + ' · ' + durationNights + ' nights', sections);

  // Plain text
  var plain = [
    trip.tripLabel.toUpperCase() + ' — TRIP RECAP',
    depLabel + ' – ' + endLbl + ' (' + durationNights + ' nights)',
    '',
  ];
  if (tagline)   plain.push('~~ ' + tagline + ' ~~', '');
  if (narrative) plain.push(narrative, '');
  if (rows.length) {
    plain.push('WHAT YOU DID');
    rows.forEach(function(row) {
      var date  = String(row[4] || '').trim();
      var title = String(row[3] || '').trim() || '(untitled)';
      plain.push((date ? date + ' ' : '') + title);
    });
    plain.push('');
  }
  if (hasDebrief) plain.push('Memories saved to your log.', '');
  plain.push('— VERA');

  MailApp.sendEmail(
    CONFIG.MORNING_NUDGE_EMAIL, subject, plain.join('\n'),
    { name: 'VERA Travel', htmlBody: htmlBody });
  props.setProperty(safeKey, new Date().toISOString());
  Logger.log('sendPostTripRecapEmail_: sent for ' + trip.tripKey + (hasDebrief ? ' (with debrief)' : ' (itinerary-only)'));
}
