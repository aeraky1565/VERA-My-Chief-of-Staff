// ============================================================
// VERA — Scheduler.js
// Smart Scheduler: photo intake → Claude vision → calendar
// ============================================================
//
// HOW IT WORKS:
//   1. User sends a photo/screenshot to the VERA Telegram bot
//   2. VERA downloads the image from Telegram's CDN
//   3. Sends it to Claude's vision API to extract dates + events
//   4. Shows extracted events and asks which calendar to use
//   5. User replies 1 or 2 → VERA creates the all-day events
//
// NO NEW SCRIPT PROPERTIES needed.
// Optional Config tab row: scheduler_calendars | Vera,AE&VV - Our Joint Chaos
// ============================================================

var SCHEDULER_PENDING_KEY_PREFIX = 'pending_schedule_';
var SCHEDULER_PENDING_TTL        = 300; // 5 minutes before confirmation expires

var SCHEDULER_EXTRACTION_PROMPT =
  'Extract ALL dates and events from this image. ' +
  'Return ONLY a valid JSON array — no markdown fences, no explanation:\n' +
  '[{"title":"Event Name","date":"YYYY-MM-DD","allDay":true,"description":"optional context"}]\n\n' +
  'Rules:\n' +
  '- Include the main target dates AND any deadlines, registration cutoffs, or action dates\n' +
  '- Set "allDay": true unless a specific clock time is clearly stated\n' +
  '- If the year is not shown in the image, assume ' + new Date().getFullYear() + '\n' +
  '- Sort events by date ascending\n' +
  '- Return ONLY the JSON array, nothing else';

// ---- Config -----------------------------------------------------------------

/**
 * Reads the list of calendars the scheduler may write to from the Config tab.
 * Falls back to hardcoded defaults if the row is missing.
 */
function readSchedulerConfig_() {
  try {
    var ss    = getSpreadsheet();
    var sheet = ss.getSheetByName(TABS.CONFIG);
    if (!sheet) return { schedulerCalendars: ['Vera', 'AE&VV - Our Joint Chaos'] };

    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === 'scheduler_calendars') {
        var cals = String(data[i][1]).split(',')
          .map(function(c) { return c.trim(); })
          .filter(Boolean);
        if (cals.length > 0) return { schedulerCalendars: cals };
      }
    }
  } catch (e) {
    Logger.log('Scheduler: could not read config: ' + e.message);
  }
  return { schedulerCalendars: ['Vera', 'AE&VV - Our Joint Chaos'] };
}

// ---- Photo download ---------------------------------------------------------

/**
 * Downloads a Telegram photo by file_id and returns it as base64.
 * Uses two Telegram API calls: getFile (get path) → download (get bytes).
 * @param  {string} fileId  The Telegram file_id from the photo array
 * @returns {{base64: string, mimeType: string}|null}
 */
function downloadTelegramPhoto_(fileId) {
  var token = getTelegramToken_();

  // Step 1: resolve file_id → file_path on Telegram's CDN
  var getFileUrl = TELEGRAM_API_BASE + token + '/getFile?file_id=' + encodeURIComponent(fileId);
  var fileResp   = UrlFetchApp.fetch(getFileUrl, { muteHttpExceptions: true });
  if (fileResp.getResponseCode() !== 200) {
    Logger.log('Scheduler: getFile failed (' + fileResp.getResponseCode() + ')');
    return null;
  }
  var fileJson = JSON.parse(fileResp.getContentText());
  if (!fileJson.ok || !fileJson.result || !fileJson.result.file_path) {
    Logger.log('Scheduler: getFile returned no file_path');
    return null;
  }
  var filePath = fileJson.result.file_path;

  // Step 2: download the actual bytes
  var dlUrl  = 'https://api.telegram.org/file/bot' + token + '/' + filePath;
  var dlResp = UrlFetchApp.fetch(dlUrl, { muteHttpExceptions: true });
  if (dlResp.getResponseCode() !== 200) {
    Logger.log('Scheduler: photo download failed (' + dlResp.getResponseCode() + ')');
    return null;
  }

  // Infer MIME type from the file extension
  var ext      = filePath.split('.').pop().toLowerCase();
  var mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  return {
    base64:   Utilities.base64Encode(dlResp.getContent()),
    mimeType: mimeType,
  };
}

// ---- Claude vision extraction -----------------------------------------------

/**
 * Sends an image to Claude's vision API and returns an array of extracted events.
 * Reuses CLAUDE_API_URL, CLAUDE_MODEL, and getApiKey() from Claude.js.
 * @returns {Array} Array of {title, date, allDay, description} — empty on error
 */
function extractEventsFromImage_(base64, mimeType) {
  var apiKey = getApiKey();

  var requestBody = {
    model:      CLAUDE_MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type:   'image',
          source: { type: 'base64', media_type: mimeType, data: base64 },
        },
        {
          type: 'text',
          text: SCHEDULER_EXTRACTION_PROMPT,
        },
      ],
    }],
  };

  var fetchOptions = {
    method:             'post',
    contentType:        'application/json',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload:            JSON.stringify(requestBody),
    muteHttpExceptions: true,
  };

  try {
    var response = UrlFetchApp.fetch(CLAUDE_API_URL, fetchOptions);
    if (response.getResponseCode() !== 200) {
      Logger.log('Scheduler: Claude vision error (' + response.getResponseCode() + '): ' +
                 response.getContentText().substring(0, 300));
      return [];
    }

    var json = JSON.parse(response.getContentText());
    var raw  = (json.content && json.content[0]) ? json.content[0].text : '';

    // Strip markdown fences defensively (same pattern as parseFlags in Claude.js)
    raw = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    var events = JSON.parse(raw);
    if (!Array.isArray(events)) return [];
    return events.filter(function(e) { return e.title && e.date; });

  } catch (e) {
    Logger.log('Scheduler: extractEventsFromImage_ error: ' + e.message);
    return [];
  }
}

// ---- Calendar creation ------------------------------------------------------

/**
 * Creates all-day events in the specified Google Calendar.
 * @param  {Array}  events       Array of {title, date, allDay, description}
 * @param  {string} calendarName Display name of the target calendar
 * @returns {{created: string[], failed: string[]}}
 */
function createScheduledEvents_(events, calendarName) {
  var created = [];
  var failed  = [];

  var cals = CalendarApp.getCalendarsByName(calendarName);
  if (!cals || cals.length === 0) {
    events.forEach(function(e) {
      failed.push(e.title + ' (calendar "' + calendarName + '" not found)');
    });
    return { created: created, failed: failed };
  }
  var cal = cals[0];

  events.forEach(function(ev) {
    try {
      var startDate = new Date(ev.date + 'T00:00:00');
      if (isNaN(startDate.getTime())) throw new Error('invalid date: ' + ev.date);

      var newEv = cal.createAllDayEvent(ev.title, startDate);
      if (ev.description) {
        try { newEv.setDescription(ev.description); } catch (de) { /* non-fatal */ }
      }
      created.push(ev.title + ' — ' + ev.date);
    } catch (e) {
      Logger.log('Scheduler: failed to create "' + ev.title + '": ' + e.message);
      failed.push(ev.title + ' (' + e.message + ')');
    }
  });

  return { created: created, failed: failed };
}

// ---- Confirmation reply handler ---------------------------------------------

/**
 * Called when the user sends a text message while a pending scheduling
 * confirmation is stored in CacheService.
 * @param  {string} text    The user's reply (e.g. "1", "2", "skip")
 * @param  {string} chatId  Telegram chat ID
 * @returns {string} Reply message to send back
 */
function handleSchedulerReply_(text, chatId) {
  var cache      = CacheService.getScriptCache();
  var pendingKey = SCHEDULER_PENDING_KEY_PREFIX + chatId;
  var pendingRaw = cache.get(pendingKey);

  if (!pendingRaw) {
    return 'No pending scheduling request found. Send me a photo with dates to get started.';
  }

  var pendingData = JSON.parse(pendingRaw);
  var events      = pendingData.events;
  var cfg         = readSchedulerConfig_();
  var cals        = cfg.schedulerCalendars;
  var lower       = text.toLowerCase().trim();

  // Cancellation
  if (lower === 'skip' || lower === 'cancel' || lower === 'no') {
    cache.remove(pendingKey);
    return '❌ Cancelled. No events were added.';
  }

  // Parse calendar choice (1-indexed)
  var choiceIndex = parseInt(text, 10) - 1;
  if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= cals.length) {
    var prompt = 'Please reply with:\n';
    cals.forEach(function(name, idx) {
      prompt += (idx + 1) + '\ufe0f\u20e3  ' + name + '\n';
    });
    prompt += '"skip" to cancel';
    return prompt;
  }

  var calendarName = cals[choiceIndex];
  cache.remove(pendingKey);

  var result = createScheduledEvents_(events, calendarName);

  var lines = [];
  if (result.created.length > 0) {
    lines.push('✅ Added ' + result.created.length + ' event' +
               (result.created.length > 1 ? 's' : '') + ' to ' + calendarName + ':');
    result.created.forEach(function(line) { lines.push('• ' + line); });
  }
  if (result.failed.length > 0) {
    lines.push('\n⚠️ Could not add:');
    result.failed.forEach(function(line) { lines.push('• ' + line); });
  }

  return lines.join('\n').trim() || 'Done.';
}

// ---- Main photo entry point -------------------------------------------------

/**
 * Entry point called from processTelegramUpdate_() when a photo message arrives.
 * Downloads → extracts → stores pending state → prompts for calendar choice.
 * @param {Object} msg    Telegram message object (with .photo array)
 * @param {string} chatId Telegram chat ID
 */
function processSchedulerPhoto_(msg, chatId, hasPhoto) {
  // Use the highest-resolution photo when sent as a photo; fall back to document for
  // images shared as files (e.g. iPhone screenshots sent via "File" in Telegram).
  var fileId = hasPhoto
    ? msg.photo[msg.photo.length - 1].file_id
    : msg.document.file_id;

  // Dedup: Telegram's file_unique_id is stable per unique photo across all bots.
  // If the same photo was submitted within the last 24 hours, skip processing to
  // prevent duplicate Claude vision calls and duplicate sheet row writes.
  var fileUniqueId = hasPhoto
    ? (msg.photo[msg.photo.length - 1].file_unique_id || '')
    : (msg.document ? (msg.document.file_unique_id || '') : '');
  if (fileUniqueId) {
    var dedupKey  = 'SCHED_PHOTO_' + fileUniqueId;
    var props     = PropertiesService.getScriptProperties();
    var lastSeen  = parseInt(props.getProperty(dedupKey) || '0', 10);
    if (Date.now() - lastSeen < 86400000) {  // 24-hour dedup window
      Logger.log('Scheduler: photo ' + fileUniqueId + ' already processed within 24h — skipping duplicate.');
      sendTelegramMessage_(chatId, '📷 This image was already processed recently. If you need to re-process it, wait 24 hours or send a new screenshot.');
      return;
    }
    props.setProperty(dedupKey, String(Date.now()));
  }

  var thinkingId = sendTelegramMessage_(chatId, '📷 Analyzing image...');

  try {
    // Download from Telegram CDN
    var photoData = downloadTelegramPhoto_(fileId);
    if (!photoData) {
      var dlErr = 'Sorry, I couldn\'t download that image. Please try again.';
      if (thinkingId) editTelegramMessage_(chatId, thinkingId, dlErr);
      else sendTelegramMessage_(chatId, dlErr);
      return;
    }

    // Extract events via Claude vision
    var events = extractEventsFromImage_(photoData.base64, photoData.mimeType);

    if (!events || events.length === 0) {
      var noEvMsg = '🔍 I couldn\'t find any dates or events in that image.\n' +
                    'Try sending a clearer photo or screenshot with visible dates.';
      if (thinkingId) editTelegramMessage_(chatId, thinkingId, noEvMsg);
      else sendTelegramMessage_(chatId, noEvMsg);
      return;
    }

    // Store events in cache, waiting for user's calendar choice
    var cache      = CacheService.getScriptCache();
    var pendingKey = SCHEDULER_PENDING_KEY_PREFIX + chatId;
    cache.put(pendingKey, JSON.stringify({ events: events }), SCHEDULER_PENDING_TTL);

    // Build the confirmation prompt
    var cfg  = readSchedulerConfig_();
    var cals = cfg.schedulerCalendars;

    var lines = [
      '📅 Found ' + events.length + ' event' + (events.length > 1 ? 's' : '') + ' in your image:\n',
    ];
    events.forEach(function(ev, idx) {
      lines.push((idx + 1) + '. ' + ev.title + ' — ' + ev.date +
                 (ev.allDay === false ? '' : ' (all day)'));
    });
    lines.push('\nWhich calendar?');
    cals.forEach(function(name, idx) {
      lines.push((idx + 1) + '\ufe0f\u20e3  ' + name);
    });
    lines.push('\nReply with the number, or "skip" to cancel.');

    var confirmMsg = lines.join('\n');
    if (thinkingId) editTelegramMessage_(chatId, thinkingId, confirmMsg);
    else sendTelegramMessage_(chatId, confirmMsg);

  } catch (e) {
    Logger.log('Scheduler: processSchedulerPhoto_ error: ' + e.message + '\n' + e.stack);
    var catchMsg = 'Sorry, something went wrong processing your image: ' + e.message;
    if (thinkingId) editTelegramMessage_(chatId, thinkingId, catchMsg);
    else sendTelegramMessage_(chatId, catchMsg);
  }
}

// ---- Test -------------------------------------------------------------------

/**
 * Quick sanity-check — run from Apps Script editor.
 * Verifies the config can be read and logs the calendar list.
 */
function testScheduler() {
  var cfg = readSchedulerConfig_();
  Logger.log('Scheduler calendars: ' + cfg.schedulerCalendars.join(', '));
  Logger.log('testScheduler OK — send a photo to your Telegram bot to test the full flow.');
}
