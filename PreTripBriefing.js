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
  var _ptbStart = Date.now();
  var cfg = getConfigValues();
  if ((cfg['pretrip_briefing_enabled'] || 'true') === 'false') {
    Logger.log('PreTripBriefing: disabled via config');
    veraLog_('checkPreTripBriefings', 'Travel', 'Skipped', 'pretrip_briefing_enabled is false', Date.now() - _ptbStart);
    return;
  }
  var hoursWindow = parseInt(cfg['pretrip_briefing_hours'] || '48', 10) || 48;

  var trips = getUpcomingTripsForBriefing_(hoursWindow);
  if (!trips.length) {
    Logger.log('PreTripBriefing: no trips departing within ' + hoursWindow + 'h window');
    veraLog_('checkPreTripBriefings', 'Travel', 'Success', 'No trips within ' + hoursWindow + 'h window', Date.now() - _ptbStart);
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
    var written = writeFlags(flags);
    if (written > 0) {
      Logger.log('PreTripBriefing: wrote ' + written + ' briefing flag(s)');
      try {
        var tripNames = trips.slice(0, written).map(function(t) { return t.tripLabel || t.tripKey; }).join(', ');
        sendSlackLog_(':airplane: Pre-trip briefing written — ' + tripNames);
      } catch(slErr) {}
    } else {
      Logger.log('PreTripBriefing: ' + flags.length + ' trip(s) in window but all deduplicated — briefing already exists');
    }
  }

  // Send dedicated pre-trip emails (separate from and in addition to the morning-briefing flag)
  trips.forEach(function(trip) {
    try {
      if (trip.hoursUntil > 24) {
        sendPreTripEmail_48h_(trip);
      } else {
        sendPreTripEmail_NightBefore_(trip);
      }
    } catch (emailErr) {
      Logger.log('PreTripBriefing: email error for ' + trip.tripKey + ' — ' + emailErr.message);
    }
  });

  veraLog_('checkPreTripBriefings', 'Travel', 'Success',
    trips.length + ' trip(s) in window, ' + flags.length + ' briefing(s) written',
    Date.now() - _ptbStart);
}

// ─── TRIP DISCOVERY ──────────────────────────────────────────────────────────

/**
 * getUpcomingTripsForBriefing_(hoursWindow)
 * Returns trips departing within the next [hoursWindow] hours.
 *
 * Source 1 (primary): gap-calendar all-day events via getUpcomingTravel_().
 *   This guarantees any trip visible in the Travel tab fires a briefing,
 *   even when no itinerary items have been added yet.
 * Source 2 (supplemental): Itinerary tab rows.
 *   Adds flight/hotel detail to matching calendar trips and also catches
 *   manual-only trips that have no corresponding calendar event.
 *
 * @param  {number} hoursWindow  Hours ahead to look (e.g. 48)
 * @returns {Array}  [{ tripKey, tripLabel, departureDate, endDate, rows, hoursUntil }]
 */
function getUpcomingTripsForBriefing_(hoursWindow) {
  var now     = new Date();
  var tripMap = {};

  // ── Source 1: Gap-calendar trips (same data set as the Travel tab) ─────────
  try {
    var calCfg   = readPTOConfig_();
    var calTrips = getUpcomingTravel_(calCfg);
    calTrips.forEach(function(t) {
      if (t.isExtendedFamily) return; // skip family-only extended-calendar events
      var depDate    = new Date(t.startDate + 'T00:00:00');
      var hoursUntil = (depDate.getTime() - now.getTime()) / 3600000;
      if (hoursUntil <= 0 || hoursUntil > hoursWindow) return;
      var tripKey = t.startDate + '|' + t.label;
      if (!tripMap[tripKey]) {
        tripMap[tripKey] = {
          tripKey:       tripKey,
          tripLabel:     t.label,
          departureDate: depDate,
          endDate:       new Date(t.endDate + 'T00:00:00'),
          rows:          [],
          hoursUntil:    hoursUntil,
        };
      }
    });
  } catch (calErr) {
    Logger.log('getUpcomingTripsForBriefing_: calendar scan error (non-fatal) — ' + calErr.message);
  }

  // ── Source 2: Itinerary tab — merges detail rows into calendar trips and
  //    catches manual-only trips that have no calendar event. ─────────────────
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.ITINERARY);
  if (sheet && sheet.getLastRow() >= 2) {
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
    data.forEach(function(row) {
      var tripKey = String(row[1] || '').trim();
      if (!tripKey) return;

      // TripKey format: "YYYY-MM-DD|Trip Label" — departure date is the prefix
      var datePart = tripKey.split('|')[0];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return;

      var depDate    = new Date(datePart + 'T00:00:00');
      var hoursUntil = (depDate.getTime() - now.getTime()) / 3600000;
      if (hoursUntil <= 0 || hoursUntil > hoursWindow) return;

      if (!tripMap[tripKey]) {
        // Manual-only trip — create entry if not already seeded from calendar
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
  }

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

// ─── PRE-TRIP EMAIL HELPERS ───────────────────────────────────────────────────

/**
 * buildPreTripEmailHtml_(eyebrow, tripLabel, subLabel, sections)
 * Generic blue-header email builder for pre-trip emails.
 * Mirrors the visual style of buildTravelDayEmailHtml_ with a configurable eyebrow.
 *
 * @param  {string} eyebrow   — Small uppercase label in header, e.g. "Pre-Trip Brief"
 * @param  {string} tripLabel — Trip name for the large header h1
 * @param  {string} subLabel  — Subtitle line below the trip name
 * @param  {Array}  sections  — [{id, builder, data}] or [{id, data}] where data is pre-built HTML
 * @returns {string} Full HTML email
 */
function buildPreTripEmailHtml_(eyebrow, tripLabel, subLabel, sections) {
  var BLUE    = '#1565c0';
  var divider = '<div style="height:1px;background:#f0f0f5;margin:20px 0;"></div>';

  var html =
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f9;' +
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 0;">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;' +
    'border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);">' +
    '<tr><td style="padding:32px 40px 28px;background:' + BLUE + ';">' +
    '<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.7);' +
    'letter-spacing:2px;text-transform:uppercase;">' + escapeHtml_(eyebrow) + '</p>' +
    '<p style="margin:0 0 4px;font-size:28px;font-weight:700;color:#ffffff;line-height:1.2;">' +
    escapeHtml_(tripLabel) + '</p>' +
    '<p style="margin:0;font-size:15px;color:rgba(255,255,255,0.85);">' +
    escapeHtml_(subLabel) + '</p>' +
    '</td></tr>' +
    '<tr><td style="padding:32px 40px;">';

  var parts = [];
  sections.forEach(function(sec) {
    try {
      var s = typeof sec.builder === 'function' ? sec.builder(sec.data) : (sec.data || '');
      if (s && s.trim()) parts.push(s);
    } catch (e) {
      Logger.log('buildPreTripEmailHtml_ section "' + sec.id + '" error: ' + e.message);
    }
  });
  html += parts.join(divider);

  html +=
    '</td></tr>' +
    '<tr><td style="padding:16px 40px;background:#f7f7fa;border-top:1px solid #eeeeee;">' +
    '<p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">' +
    'Sent automatically by VERA — your Chief of Staff.' +
    '</p></td></tr>' +
    '</table></td></tr></table></body></html>';

  return html;
}

// ─── PRE-TRIP EMAIL SENDERS ───────────────────────────────────────────────────

/**
 * sendPreTripEmail_48h_(trip)
 * Sends a 48-hour pre-trip overview email with AI-written opener, trip at a glance,
 * flights, packing status, and destination weather.
 * Dedup: one send per trip via PRETRIP_48H_{key} Script Property.
 */
function sendPreTripEmail_48h_(trip) {
  var props   = PropertiesService.getScriptProperties();
  var safeKey = 'PRETRIP_48H_' + trip.tripKey.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (props.getProperty(safeKey)) {
    Logger.log('sendPreTripEmail_48h_: already sent for ' + trip.tripKey);
    return;
  }

  var tz       = Session.getScriptTimeZone();
  var depLabel = Utilities.formatDate(trip.departureDate, tz, 'EEE MMM d');
  var hoursN   = Math.round(trip.hoursUntil);
  var toneMode = getTripToneMode_(trip.tripKey);

  var rows = trip.rows.slice().sort(function(a, b) {
    var ak = String(a[4] || '') + '|' + String(a[5] || '');
    var bk = String(b[4] || '') + '|' + String(b[5] || '');
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });

  var destination = inferTripDestination_(rows, trip.tripLabel);

  var weatherText = '';
  try {
    var startStr = Utilities.formatDate(trip.departureDate, tz, 'yyyy-MM-dd');
    var endStr   = Utilities.formatDate(trip.endDate,       tz, 'yyyy-MM-dd');
    weatherText  = getPackingWeather_(destination, startStr, endStr) || '';
  } catch (e_) {}

  var packStatus = getPackingStatusForBriefing_(trip.tripKey);
  var openItems  = [];
  var totalPacked = 0, totalItems = 0;
  ['ahmed', 'victoria', 'shared'].forEach(function(p) {
    if (!packStatus[p]) return;
    totalPacked += packStatus[p].packed;
    totalItems  += packStatus[p].total;
    packStatus[p].open.forEach(function(item) { openItems.push(item); });
  });
  var packingSummary = totalItems > 0
    ? totalPacked + '/' + totalItems + ' packed' +
      (openItems.length ? '. Open: ' + openItems.slice(0, 5).join(', ') : '. All packed')
    : 'No packing list on file';

  var itinSummary = rows.map(function(row) {
    var date  = String(row[4] || '').trim();
    var type  = String(row[2] || '').trim();
    var title = String(row[3] || '').trim() || '(untitled)';
    var loc   = String(row[7] || '').trim();
    return date + ' [' + type + '] ' + title + (loc ? ' @ ' + loc : '');
  }).join('\n') || 'No itinerary items logged yet';

  // Claude: tagline + opener
  var claudePrompt =
    'You are VERA, Ahmed\'s Chief of Staff. Ahmed\'s trip to ' + trip.tripLabel + ' departs in ~' + hoursN + ' hours (' + depLabel + ').\n\n' +
    'Itinerary:\n' + itinSummary + '\n\n' +
    'Packing: ' + packingSummary + '\n' +
    'Weather at destination: ' + (weatherText ? weatherText.substring(0, 200) : 'unknown') + '\n' +
    'Tone mode: ' + toneMode + '\n' +
    '- "professional": polished, first-class concierge. Warm but refined. May be forwarded to travel companions.\n' +
    '- "personal": warm, intimate, slightly playful. Like a close friend who arranged the whole trip.\n\n' +
    'Return ONLY valid JSON:\n' +
    '{\n' +
    '  "tagline": "One line capturing the anticipation or spirit of this trip. Reference what makes it distinctive.",\n' +
    '  "opener": "2 short paragraphs. First: mood-setting — what\'s coming, what makes this trip special. Second: 1-2 practical things to confirm before leaving. Match the tone."\n' +
    '}';

  var claudeResult = callClaudeJson_(claudePrompt,
    { tagline: '✈️ ' + trip.tripLabel, opener: 'Your trip is just ' + hoursN + ' hours away. Here\'s a look at what\'s ahead.' });
  var tagline = String(claudeResult.tagline || '').trim();
  var opener  = String(claudeResult.opener  || '').trim();

  var BLUE    = '#1565c0';
  var subject = '🗺️ Pre-Trip Brief — ' + trip.tripLabel + ' · Departing ' + depLabel;

  // ── Section HTML builders ─────────────────────────────────────────────────
  var taglineOpenerHtml = (function() {
    var html = '';
    if (tagline) {
      html +=
        '<div style="text-align:center;padding:12px 0 8px;color:#555;font-style:italic;' +
        'border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;margin-bottom:16px;">' +
        escapeHtml_(tagline) + '</div>';
    }
    if (opener) {
      opener.split(/\n+/).forEach(function(p) {
        if (p.trim()) {
          html += '<p style="margin:0 0 14px;font-size:14px;color:#333;line-height:1.65;">' +
                  escapeHtml_(p.trim()) + '</p>';
        }
      });
    }
    return html;
  }());

  var glanceHtml = (function() {
    if (!rows.length) return '';
    var byDate = {}, dateOrder = [];
    rows.forEach(function(row) {
      var date  = String(row[4] || '').trim() || 'TBD';
      var type  = String(row[2] || '').trim();
      var title = String(row[3] || '').trim() || '(untitled)';
      var stime = String(row[5] || '').trim();
      var loc   = String(row[7] || '').trim();
      if (!byDate[date]) { byDate[date] = []; dateOrder.push(date); }
      byDate[date].push({ type: type, title: title, stime: stime, loc: loc });
    });
    var html =
      '<p style="margin:0 0 12px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
      'letter-spacing:1.5px;text-transform:uppercase;">Trip at a Glance</p>';
    dateOrder.forEach(function(date) {
      var dLabel = date;
      try {
        var d = new Date(date + 'T00:00:00');
        if (!isNaN(d)) dLabel = Utilities.formatDate(d, tz, 'EEE, MMM d');
      } catch (e_) {}
      html += '<p style="margin:4px 0;font-size:12px;font-weight:700;color:#444;">' +
              escapeHtml_(dLabel) + '</p>';
      byDate[date].forEach(function(item) {
        var line = (item.stime ? item.stime + ' ' : '') + item.title;
        if (item.loc) line += ' · ' + item.loc;
        html += '<p style="margin:1px 0 1px 12px;font-size:13px;color:#555;">• ' +
                escapeHtml_(line) + '</p>';
      });
      html += '<div style="height:8px;"></div>';
    });
    return html;
  }());

  var flightsHtml = (function() {
    var flightRows = rows.filter(function(row) {
      return String(row[2] || '').trim().toLowerCase() === 'flight';
    });
    if (!flightRows.length) return '';
    var html =
      '<p style="margin:0 0 12px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
      'letter-spacing:1.5px;text-transform:uppercase;">✈️ Flights</p>';
    flightRows.forEach(function(row) {
      var meta = {};
      if (row[9]) { try { meta = JSON.parse(String(row[9])); } catch (e_) {} }
      var flightNum = meta.flightNum || String(row[3] || '').trim() || 'Flight';
      var depTime   = meta.dep_scheduled || String(row[5] || '').trim() || '';
      var arrTime   = meta.arr_scheduled || String(row[6] || '').trim() || '';
      var confNum   = meta.confirmationNumber || '';
      var terminal  = meta.terminal || '';
      var gate      = meta.gate || '';
      var date      = String(row[4] || '').trim();
      html +=
        '<div style="margin-bottom:10px;">' +
        '<span style="font-weight:700;font-size:14px;color:#222;">' + escapeHtml_(flightNum) + '</span>' +
        (date ? ' <span style="color:#888;font-size:13px;">' + escapeHtml_(date) + '</span>' : '') +
        (depTime || arrTime
          ? '<br><span style="font-size:13px;color:#555;">' +
            escapeHtml_(depTime) + (arrTime ? ' → ' + escapeHtml_(arrTime) : '') + '</span>'
          : '') +
        (confNum   ? '<br><span style="font-size:12px;color:#777;">Conf# ' + escapeHtml_(confNum) + '</span>' : '') +
        (terminal || gate
          ? '<br><span style="font-size:12px;color:#777;">' +
            (terminal ? 'Terminal: ' + escapeHtml_(terminal) + ' ' : '') +
            (gate     ? 'Gate: '     + escapeHtml_(gate)               : '') + '</span>'
          : '') +
        '</div>';
    });
    return html;
  }());

  var packingHtml = (function() {
    var lines = [];
    ['ahmed', 'victoria', 'shared'].forEach(function(person) {
      var p = packStatus[person];
      if (!p) return;
      var label   = person.charAt(0).toUpperCase() + person.slice(1);
      var pct     = p.total > 0 ? Math.round(100 * p.packed / p.total) : 0;
      var status  = p.packed + '/' + p.total + ' (' + pct + '%)';
      var openStr = p.open.length
        ? 'Open: ' + p.open.slice(0, 5).map(function(x) { return escapeHtml_(x); }).join(', ') +
          (p.open.length > 5 ? ' (+' + (p.open.length - 5) + ' more)' : '')
        : 'All packed ✓';
      lines.push({ label: label, status: status, openStr: openStr });
    });
    if (!lines.length) return '';
    var html =
      '<p style="margin:0 0 12px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
      'letter-spacing:1.5px;text-transform:uppercase;">🧳 Packing</p>';
    lines.forEach(function(l) {
      html +=
        '<p style="margin:0 0 4px;font-size:13px;color:#333;">' +
        '<strong>' + l.label + '</strong>: ' + l.status + ' · ' + l.openStr + '</p>';
    });
    return html;
  }());

  var weatherHtml = weatherText
    ? '<p style="margin:0 0 12px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
      'letter-spacing:1.5px;text-transform:uppercase;">🌤 Weather at Destination</p>' +
      '<p style="margin:0;font-size:13px;color:#555;line-height:1.6;">' +
      escapeHtml_(weatherText.substring(0, 400)) + '</p>'
    : '';

  var sections = [
    { id: 'opener',  data: taglineOpenerHtml },
    { id: 'glance',  data: glanceHtml },
    { id: 'flights', data: flightsHtml },
    { id: 'packing', data: packingHtml },
    { id: 'weather', data: weatherHtml },
  ];

  var htmlBody = buildPreTripEmailHtml_(
    'Pre-Trip Brief', trip.tripLabel, 'Departing ' + depLabel + ' · ' + hoursN + 'h away', sections);

  // Plain text
  var plain = [
    'PRE-TRIP BRIEF — ' + trip.tripLabel,
    'Departing ' + depLabel + ' (' + hoursN + 'h away)',
    '',
  ];
  if (tagline) plain.push('~~ ' + tagline + ' ~~', '');
  if (opener)  plain.push(opener, '');
  if (rows.length) {
    plain.push('TRIP AT A GLANCE');
    rows.forEach(function(row) {
      var stime = String(row[5] || '').trim();
      var title = String(row[3] || '').trim() || '(untitled)';
      var date  = String(row[4] || '').trim();
      plain.push((stime ? stime + ' ' : '') + title + (date ? ' (' + date + ')' : ''));
    });
  }
  if (weatherText) plain.push('', 'WEATHER\n' + weatherText.substring(0, 300));
  plain.push('', '— VERA');

  MailApp.sendEmail(
    CONFIG.MORNING_NUDGE_EMAIL, subject, plain.join('\n'),
    { name: 'VERA Travel', htmlBody: htmlBody });
  props.setProperty(safeKey, new Date().toISOString());
  Logger.log('sendPreTripEmail_48h_: sent for ' + trip.tripKey);
}

/**
 * sendPreTripEmail_NightBefore_(trip)
 * Sends an evening-before checklist email when departure is within 24 hours.
 * Covers the departure sequence, open packing items, and an AI-written tip.
 * Dedup: one send per trip via PRETRIP_NB_{key} Script Property.
 */
function sendPreTripEmail_NightBefore_(trip) {
  var props   = PropertiesService.getScriptProperties();
  var safeKey = 'PRETRIP_NB_' + trip.tripKey.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (props.getProperty(safeKey)) {
    Logger.log('sendPreTripEmail_NightBefore_: already sent for ' + trip.tripKey);
    return;
  }

  var tz       = Session.getScriptTimeZone();
  var depLabel = Utilities.formatDate(trip.departureDate, tz, 'EEE MMM d');
  var toneMode = getTripToneMode_(trip.tripKey);

  var rows = trip.rows.slice().sort(function(a, b) {
    var ak = String(a[4] || '') + '|' + String(a[5] || '');
    var bk = String(b[4] || '') + '|' + String(b[5] || '');
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });

  var depDateStr = Utilities.formatDate(trip.departureDate, tz, 'yyyy-MM-dd');
  var day0Items  = rows.filter(function(row) {
    return String(row[4] || '').trim() === depDateStr;
  });

  var packStatus = getPackingStatusForBriefing_(trip.tripKey);
  var openItems  = [];
  ['ahmed', 'victoria', 'shared'].forEach(function(p) {
    if (packStatus[p]) packStatus[p].open.forEach(function(item) { openItems.push(item); });
  });

  var seqLines = day0Items.map(function(row) {
    var stime = String(row[5] || '').trim();
    var type  = String(row[2] || '').trim();
    var title = String(row[3] || '').trim() || '(untitled)';
    var loc   = String(row[7] || '').trim();
    return (stime ? stime + ' ' : '') + '[' + type + '] ' + title + (loc ? ' @ ' + loc : '');
  }).join('\n') || 'No departure-day items logged';

  var claudePrompt =
    'You are VERA, Ahmed\'s Chief of Staff. Ahmed departs for ' + trip.tripLabel + ' tomorrow (' + depLabel + ').\n\n' +
    'Tomorrow\'s departure sequence:\n' + seqLines + '\n\n' +
    'Packing still open: ' + (openItems.length ? openItems.slice(0, 8).join(', ') : 'none') + '\n' +
    'Tone mode: ' + toneMode + '\n' +
    '- "professional": polished, concierge voice. Efficient and warm.\n' +
    '- "personal": warm and direct, like a friend reminding you of the essentials.\n\n' +
    'Return ONLY valid JSON:\n' +
    '{\n' +
    '  "checklist_note": "1-2 sentences: what to do tonight. Specific to these logistics.",\n' +
    '  "tip": "One sentence: the single most important thing to remember for tomorrow morning."\n' +
    '}';

  var claudeResult = callClaudeJson_(claudePrompt,
    { checklist_note: 'You depart tomorrow — a few things to confirm tonight.', tip: 'Set two alarms.' });
  var checklistNote = String(claudeResult.checklist_note || '').trim();
  var tip           = String(claudeResult.tip           || '').trim();

  var BLUE    = '#1565c0';
  var subject = '📋 Tomorrow — ' + trip.tripLabel + ' · Last Things';

  var noteHtml = (function() {
    var html = '';
    checklistNote.split(/\n+/).forEach(function(p) {
      if (p.trim()) {
        html += '<p style="margin:0 0 12px;font-size:14px;color:#333;line-height:1.65;">' +
                escapeHtml_(p.trim()) + '</p>';
      }
    });
    return html;
  }());

  var sequenceHtml = (function() {
    if (!day0Items.length) return '';
    var html =
      '<p style="margin:0 0 12px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
      'letter-spacing:1.5px;text-transform:uppercase;">⏰ Tomorrow\'s Sequence</p>';
    day0Items.forEach(function(row) {
      var type  = String(row[2] || '').trim();
      var title = String(row[3] || '').trim() || '(untitled)';
      var stime = String(row[5] || '').trim();
      var loc   = String(row[7] || '').trim();
      var meta  = {};
      if (row[9]) { try { meta = JSON.parse(String(row[9])); } catch (e_) {} }
      html +=
        '<div style="margin-bottom:10px;">' +
        (stime ? '<span style="font-weight:700;font-size:14px;color:#222;">' + escapeHtml_(stime) + '</span> ' : '') +
        '<span style="font-size:13px;color:#333;">' + escapeHtml_(title) + '</span>' +
        (loc ? '<br><span style="font-size:12px;color:#777;">' + escapeHtml_(loc) + '</span>' : '') +
        (meta.confirmationNumber
          ? '<br><span style="font-size:12px;color:#777;">Conf# ' + escapeHtml_(meta.confirmationNumber) + '</span>'
          : '') +
        '</div>';
    });
    return html;
  }());

  var openPackingHtml = (function() {
    if (!openItems.length) return '';
    var html =
      '<p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#c0392b;' +
      'letter-spacing:1.5px;text-transform:uppercase;">🧳 Still to Pack</p>';
    openItems.forEach(function(item) {
      html += '<p style="margin:0 0 4px;font-size:13px;color:#555;">• ' + escapeHtml_(item) + '</p>';
    });
    return html;
  }());

  var tipHtml = tip
    ? '<div style="margin-top:14px;padding:10px 14px;background:#f0f4ff;' +
      'border-left:3px solid ' + BLUE + ';font-size:13px;color:#333;">' +
      '<strong>Tip:</strong> ' + escapeHtml_(tip) + '</div>'
    : '';

  var sections = [
    { id: 'note',     data: noteHtml },
    { id: 'sequence', data: sequenceHtml },
    { id: 'packing',  data: openPackingHtml },
    { id: 'tip',      data: tipHtml },
  ];

  var htmlBody = buildPreTripEmailHtml_(
    'Night Before', trip.tripLabel, 'Last check — Departing ' + depLabel, sections);

  // Plain text
  var plain = [
    'TOMORROW — ' + trip.tripLabel,
    'Departing ' + depLabel,
    '',
  ];
  if (checklistNote) plain.push(checklistNote, '');
  if (day0Items.length) {
    plain.push('DEPARTURE SEQUENCE');
    day0Items.forEach(function(row) {
      var stime = String(row[5] || '').trim();
      var title = String(row[3] || '').trim() || '(untitled)';
      plain.push((stime ? stime + ' ' : '') + title);
    });
    plain.push('');
  }
  if (openItems.length) {
    plain.push('STILL TO PACK', openItems.map(function(i) { return '• ' + i; }).join('\n'), '');
  }
  if (tip) plain.push('Tip: ' + tip, '');
  plain.push('— VERA');

  MailApp.sendEmail(
    CONFIG.MORNING_NUDGE_EMAIL, subject, plain.join('\n'),
    { name: 'VERA Travel', htmlBody: htmlBody });
  props.setProperty(safeKey, new Date().toISOString());
  Logger.log('sendPreTripEmail_NightBefore_: sent for ' + trip.tripKey);
}

