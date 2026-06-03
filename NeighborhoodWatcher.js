// ============================================================
// NeighborhoodWatcher.js — Neighborhood Watch (Issue #179)
//
// Two responsibilities:
//   1. scanHoaWebsite_()  — weekly trigger; fetches HOA URL,
//      passes page text to Claude, writes VERA flags, logs scan.
//   2. webExtractFlyer_() — called by WebApp.js doPost;
//      sends a base64 image to Claude Vision and returns
//      structured event data (title, date, location, etc.)
//
// Script Properties used:
//   NEIGHBORHOOD_HOA_URL — URL of the HOA website to monitor
// ============================================================

var NEIGHBORHOOD_HOA_URL_KEY = 'NEIGHBORHOOD_HOA_URL';

// ============================================================
// HOA WEBSITE SCANNER
// ============================================================

/**
 * Fetches the HOA website, extracts events/notices/warnings via Claude,
 * writes VERA flags, and logs the scan to NEIGHBORHOOD_HOA_SCANS sheet.
 * Called by a weekly Monday 9am trigger installed by setupTriggers().
 */
function scanHoaWebsite_() {
  try {
    var props  = PropertiesService.getScriptProperties();
    var hoaUrl = props.getProperty(NEIGHBORHOOD_HOA_URL_KEY);
    if (!hoaUrl) {
      Logger.log('🏘 HOA URL not configured. Set NEIGHBORHOOD_HOA_URL in Script Properties.');
      return;
    }

    // Fetch page content
    var response = UrlFetchApp.fetch(hoaUrl, { muteHttpExceptions: true });
    var html     = response.getContentText();

    // Strip scripts, styles, and all tags → plain text, truncate for Claude
    var text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi,   '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 8000);

    // Ask Claude to extract actionable items
    var claudePrompt =
      'Parse this HOA/community website text. Extract all events, notices, warnings, ' +
      'violations, maintenance alerts, and meeting announcements. ' +
      'Return a JSON array of objects with these fields: ' +
      'type ("event" | "notice" | "warning" | "violation" | "meeting" | "other"), ' +
      'title (string), date (YYYY-MM-DD or null if not found), ' +
      'description (1-2 sentences max). ' +
      'Only include actionable or upcoming items — skip general boilerplate, navigation, and footers. ' +
      'If nothing notable is found, return []. ' +
      'Return only the JSON array, no markdown fences.\n\n' + text;

    var payload = {
      model:      CLAUDE_MODEL,
      max_tokens: 1024,
      messages:   [{ role: 'user', content: claudePrompt }]
    };

    var claudeResp = UrlFetchApp.fetch(CLAUDE_API_URL, {
      method:          'post',
      contentType:     'application/json',
      muteHttpExceptions: true,
      headers: { 'x-api-key': getApiKey(), 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(payload)
    });

    var rawText = JSON.parse(claudeResp.getContentText()).content[0].text.trim();
    // Defensive: strip markdown fences Claude might add
    rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');

    var items = [];
    try { items = JSON.parse(rawText); } catch (parseErr) {
      Logger.log('🏘 HOA parse error (Claude response was not valid JSON): ' + parseErr.message);
      items = [];
    }

    // Check Signal Learning suppressed patterns before writing flags
    var suppressed = getSuppressedKeyPatterns_();
    var flags    = [];
    var flagKeys = [];

    items.forEach(function(item) {
      if (!item || !item.title) return;
      var slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 40);
      var key  = 'hoa_' + (item.type || 'notice') + '_' + slug;

      if (suppressed.indexOf(key) >= 0) {
        Logger.log('🏘 Suppressed (Signal Learning): ' + key);
        return;
      }

      var urgency = (item.type === 'violation' || item.type === 'warning')  ? 'High'
                  : (item.type === 'meeting'   || item.type === 'notice')   ? 'Medium'
                  :                                                             'Low';

      flags.push({
        source:  'HOA',
        flag:    '[HOA] ' + item.title,
        reason:  item.description || (item.date ? 'Date: ' + item.date : ''),
        urgency: urgency,
        key:     key
      });
      flagKeys.push(key);
    });

    // Write flags and record in Signal Learning
    if (flags.length > 0) writeFlags(flags);
    recordFlagsGenerated_(flagKeys);

    // Log scan to NEIGHBORHOOD_HOA_SCANS sheet (only if tab already exists — don't auto-create)
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh = ss.getSheetByName(TABS.NEIGHBORHOOD_HOA_SCANS);
    if (sh) {
      var lastRow = sh.getLastRow();
      var newId   = lastRow > 1
        ? parseInt(sh.getRange(lastRow, 1).getValue() || '0', 10) + 1 : 1;
      sh.appendRow([newId, new Date().toISOString(), hoaUrl, items.length, flags.length, '']);
    }

    Logger.log('🏘 HOA scan complete. ' + items.length + ' items found, ' + flags.length + ' flags written.');
  } catch (err) {
    Logger.log('⚠ scanHoaWebsite_ error: ' + err.message);
  }
}

// ============================================================
// FLYER VISION EXTRACTOR  (called from WebApp.js doPost)
// ============================================================

/**
 * Sends a base64 image to Claude Vision and returns structured flyer data.
 * Called by WebApp.js doPost with action='extract_flyer'.
 *
 * @param  {Object} body  Parsed POST body: { imageBase64, imageMimeType? }
 * @return {Object}       { ok, flyer: { title, type, date, time, location,
 *                                       description, recurring, tags } }
 *                        or { ok: false, error }
 */
function webExtractFlyer_(body) {
  var b    = body || {};
  var b64  = b.imageBase64;
  var mime = b.imageMimeType || 'image/jpeg';
  if (!b64) return { ok: false, error: 'imageBase64 required' };

  var apiKey = getApiKey();

  var prompt =
    'Extract neighborhood event details from this flyer image. ' +
    'Return ONLY a valid JSON object (no markdown fences) with these exact keys:\n' +
    'title (string — name of event or notice), ' +
    'type ("Event" | "Notice" | "Other"), ' +
    'date (YYYY-MM-DD if visible, else ""), ' +
    'time (HH:MM in 24h format if visible, else ""), ' +
    'location (string if visible, else ""), ' +
    'description (1-2 sentence summary of what this is about), ' +
    'recurring (true if this is a recurring event like "every Saturday", false otherwise), ' +
    'tags (JSON array of short keyword strings, e.g. ["farmers market","food","community"]).';

  var payload = {
    model:      CLAUDE_MODEL,
    max_tokens: 512,
    messages:   [{
      role:    'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
        { type: 'text',  text: prompt }
      ]
    }]
  };

  var resp   = UrlFetchApp.fetch(CLAUDE_API_URL, {
    method:          'post',
    contentType:     'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload)
  });
  var result = JSON.parse(resp.getContentText());
  var text   = (result.content && result.content[0] && result.content[0].text) || '';
  // Strip markdown fences
  text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

  try {
    var flyer = JSON.parse(text);
    return { ok: true, flyer: flyer };
  } catch (ex) {
    return { ok: false, error: 'Parse failed', raw: text };
  }
}
