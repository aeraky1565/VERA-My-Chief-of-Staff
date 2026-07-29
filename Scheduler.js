// ============================================================
// VERA — Scheduler.js
// Smart Scheduler: photo intake → Claude vision → calendar
// ============================================================
//
// HOW IT WORKS:
//   1. User sends a photo/screenshot (future: via Slack file upload)
//   2. VERA sends the image to Claude's vision API to extract dates + events
//   3. Shows extracted events and asks which calendar to use
//   4. User replies 1 or 2 → VERA creates the all-day events
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
    var response = fetchTracked_('anthropic', CLAUDE_API_URL, fetchOptions);
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
 * Called when the user sends a text reply to a pending scheduling confirmation.
 * @param  {string} text    The user's reply (e.g. "1", "2", "skip")
 * @param  {string} userId  Slack user ID (used as the cache key)
 * @returns {string} Reply message to send back
 */
function handleSchedulerReply_(text, userId) {
  var cache      = CacheService.getScriptCache();
  var pendingKey = SCHEDULER_PENDING_KEY_PREFIX + userId;
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

// ---- Test -------------------------------------------------------------------

/**
 * Quick sanity-check — run from Apps Script editor.
 * Verifies the config can be read and logs the calendar list.
 */
function testScheduler() {
  var cfg = readSchedulerConfig_();
  Logger.log('Scheduler calendars: ' + cfg.schedulerCalendars.join(', '));
  Logger.log('testScheduler OK — calendar list loaded successfully.');
}
