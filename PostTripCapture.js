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
/**
 * A trip's length in nights, or null when it genuinely cannot be determined.
 *
 * This used to be Math.max(1, Math.round(ms / 86400000)) at four separate sites.
 * The floor was the bug: when departureDate and endDate are the SAME day — which
 * happens whenever the itinerary holds no row later than the trip key's own date
 * — the difference is 0, and the floor turned "I have no end date" into a
 * confident "1-night". A trip that had not even finished was announced as a
 * one-night trip that had just wrapped up.
 *
 * Returning null lets each caller say nothing about duration rather than state
 * a number it does not have.
 *
 * @returns {number|null}
 */
function tripDurationNights_(trip) {
  if (!trip || !trip.endDate || !trip.departureDate) return null;
  var ms = trip.endDate.getTime() - trip.departureDate.getTime();
  if (!isFinite(ms) || ms <= 0) return null;
  var n = Math.round(ms / 86400000);
  return n > 0 ? n : null;
}

/** "3-night " for prose, or "" when the duration is unknown. Note the trailing space. */
function tripDurationPrefix_(trip) {
  var n = tripDurationNights_(trip);
  return n === null ? '' : n + '-night ';
}

/** "3 nights" / "1 night", or "length unknown". */
function tripDurationLabel_(trip) {
  var n = tripDurationNights_(trip);
  if (n === null) return 'length unknown';
  return n + (n === 1 ? ' night' : ' nights');
}

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
        var durationLabel  = tripDurationLabel_(trip);
        appendMemoryEvent_(
          MEMORY_TYPE.TRIP_COMPLETED,
          'Ahmed',
          'Trip completed: ' + trip.tripLabel,
          durationLabel + ' · ended ' + Utilities.formatDate(trip.endDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
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

    // TripKey prefix is the departure date: "YYYY-MM-DD|Trip Label".
    //
    // NOTE: this guard skips any key not date-prefixed, which is correct while
    // keys keep that shape. It is also exactly what would silently stop post-trip
    // firing altogether if the tabs were ever migrated to store bare TRIP-… ids —
    // worth remembering before anyone does that.
    var datePart = tripKey.split('|')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return;

    // Group by TRIP ID, so a trip that split into two key strings lands in ONE
    // bucket. Before this, each key was its own "trip": the newer one owned only
    // the rows written after the date changed, so its latest row date was the
    // departure day itself — the email fired a day early and the 0-day span is
    // why the duration came out wrong.
    var groupId = tripIdForKey_(tripKey) || tripKey;

    if (!tripMap[groupId]) {
      var parts     = tripKey.split('|');
      var tripLabel = parts.length > 1 ? parts.slice(1).join('|') : tripKey;
      var range     = tripDateRangeFor_(groupId);   // null unless it resolved

      // The registry's dates come from the calendar and are authoritative for
      // when the trip runs; itinerary rows can extend past them. Both are
      // considered, and the later end wins — see below.
      var depStr = (range && range.startDate) || datePart;
      tripMap[groupId] = {
        tripKey:       canonicalTripKey_(tripKey),
        tripLabel:     (range && tripLabelFor_(groupId)) || tripLabel,
        departureDate: new Date(depStr + 'T00:00:00'),
        endDate:       new Date(((range && range.endDate) || depStr) + 'T00:00:00'),
      };
    }

    // Update endDate to the latest event date seen for this trip, across every
    // key it answers to — max(registry end, latest row) is what stops the early fire.
    var eventDate = String(row[4] || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      var d = new Date(eventDate + 'T00:00:00');
      if (d > tripMap[groupId].endDate) tripMap[groupId].endDate = d;
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

  var reason =
    'Your ' + tripDurationPrefix_(trip) + trip.tripLabel + ' ended ' + daysLabel + '.\n\n' +
    'A quick debrief in Chat will log the highlights for future reference:\n' +
    'restaurants worth returning to, best experiences, anything you\u2019d skip,\n' +
    'what Victoria loved, and whether you\u2019d go back.\n\n' +
    'Open Chat and say: \u201cLet\u2019s do the ' + trip.tripLabel + ' debrief.\u201d';

  // Stable dedup key
  // On the Trip ID rather than the key string -- see tripFlagKey_.
  var safeKey = tripFlagKey_('posttrip_capture_', trip);

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
  // Every key this trip has answered to, not just the one we were handed. A trip
  // whose start date moved owns two key strings, and matching only one returns
  // half its itinerary — which is what made the post-trip email fire early.
  var keys = tripKeysFor_(tripKey);
  return data
    .filter(function(row) { return tripRowMatches_(row[1], keys); })
    .sort(function(a, b) {
      var ak = String(a[4] || '') + '|' + String(a[5] || '');
      var bk = String(b[4] || '') + '|' + String(b[5] || '');
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    });
}

/**
 * getTripBoundsByKey_(tripKey)
 * Looks up departure/end dates and label for one specific, already-known
 * tripKey — for callers like the chat debrief-completion action that don't
 * want to scan for trips within a date window the way
 * getRecentlyCompletedTrips_() does.
 *
 * @param  {string} tripKey
 * @returns {{tripKey, tripLabel, departureDate, endDate}|null}
 */
function getTripBoundsByKey_(tripKey) {
  var datePart = String(tripKey || '').split('|')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;

  // readTripRows_ now gathers every key the trip answers to, so a key that moved
  // still returns the whole itinerary rather than the sliver written after the move.
  var rows = readTripRows_(tripKey);
  if (!rows.length) return null;

  var parts     = tripKey.split('|');
  var tripLabel = parts.length > 1 ? parts.slice(1).join('|') : tripKey;

  // Seeded from the registry where it resolves — the calendar knows when the trip
  // runs — and from the key's own date prefix otherwise. Same reasoning as
  // getRecentlyCompletedTrips_: the later of registry-end and latest-row wins.
  var tripId = tripIdForKey_(tripKey);
  var range  = tripId ? tripDateRangeFor_(tripId) : null;
  if (tripId && tripLabelFor_(tripId)) tripLabel = tripLabelFor_(tripId);

  var depStr        = (range && range.startDate) || datePart;
  var departureDate = new Date(depStr + 'T00:00:00');
  var endDate       = new Date(((range && range.endDate) || depStr) + 'T00:00:00');

  rows.forEach(function(row) {
    var eventDate = String(row[4] || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      var d = new Date(eventDate + 'T00:00:00');
      if (d > endDate) endDate = d;
    }
  });

  return {
    tripKey:       canonicalTripKey_(tripKey),
    tripLabel:     tripLabel,
    departureDate: departureDate,
    endDate:       endDate,
  };
}

/**
 * sendPostTripNudgeEmail_(trip)
 * Sends a brief day-after email nudging Ahmed to debrief in Chat.
 * Templated prose — no Claude call needed.
 * Dedup: POSTTRIP_NUDGE_{key} Script Property.
 */
function sendPostTripNudgeEmail_(trip) {
  if (tripLatchSeen_('POSTTRIP_NUDGE_', trip)) {
    Logger.log('sendPostTripNudgeEmail_: already sent for ' + trip.tripKey);
    return;
  }

  var tz            = Session.getScriptTimeZone();
  var BLUE          = '#1565c0';

  var subject = '🧳 ' + trip.tripLabel + ' — Capture the Memories';

  var bodyHtml =
    '<p style="margin:0 0 14px;font-size:14px;color:#333;line-height:1.65;">' +
    'Your ' + tripDurationPrefix_(trip) + escapeHtml_(trip.tripLabel) + ' just wrapped up — ' +
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

  sendVeraEmail_(
    CONFIG.MORNING_NUDGE_EMAIL, subject, plain,
    { name: 'VERA Travel', htmlBody: htmlBody }, 'posttrip_nudge');
  tripLatchMark_('POSTTRIP_NUDGE_', trip);
  Logger.log('sendPostTripNudgeEmail_: sent for ' + trip.tripKey);
}

/**
 * sendPostTripRecapEmail_(trip)
 * Sends a full trip recap ~48h after the trip ends.
 * Uses Chat debrief data when available; falls back to itinerary-only mode.
 * Dedup: POSTTRIP_RECAP_{key} Script Property.
 */
function sendPostTripRecapEmail_(trip) {
  if (tripLatchSeen_('POSTTRIP_RECAP_', trip)) {
    Logger.log('sendPostTripRecapEmail_: already sent for ' + trip.tripKey);
    return;
  }

  var tz            = Session.getScriptTimeZone();
  var durationLabel = tripDurationLabel_(trip);
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
  // The debrief marker follows the trip, not the key string it was completed
  // under: a debrief done before a date change must still count afterwards.
  var debriefSafeKey  = tripLatchName_('POSTTRIP_DEBRIEF_', trip);
  var debriefProp     = tripLatchValue_('POSTTRIP_DEBRIEF_', trip);
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
      'You are VERA, Ahmed\'s Chief of Staff. Ahmed returned from ' + trip.tripLabel + ' (' + durationLabel + ').\n\n' +
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
      'You are VERA, Ahmed\'s Chief of Staff. Ahmed returned from ' + trip.tripLabel + ' (' + durationLabel + ').\n\n' +
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
    'Trip Recap', trip.tripLabel, depLabel + ' – ' + endLbl + ' · ' + durationLabel, sections);

  // Plain text
  var plain = [
    trip.tripLabel.toUpperCase() + ' — TRIP RECAP',
    depLabel + ' – ' + endLbl + ' (' + durationLabel + ')',
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

  sendVeraEmail_(
    CONFIG.MORNING_NUDGE_EMAIL, subject, plain.join('\n'),
    { name: 'VERA Travel', htmlBody: htmlBody }, 'posttrip_recap');
  tripLatchMark_('POSTTRIP_RECAP_', trip);
  Logger.log('sendPostTripRecapEmail_: sent for ' + trip.tripKey + (hasDebrief ? ' (with debrief)' : ' (itinerary-only)'));
}
