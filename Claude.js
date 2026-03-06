// ============================================================
// VERA — Claude.js
// Builds the intelligence prompt and calls the Anthropic API
// ============================================================

// ---- API Key ---------------------------------------------------------------
// The API key is stored in Script Properties, NOT in code.
// To set it: Apps Script editor → Project Settings → Script Properties
// Key: CLAUDE_API_KEY  |  Value: your key starting with "sk-ant-..."
// ----------------------------------------------------------------------------

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL   = 'claude-sonnet-4-6';

/**
 * Retrieves the Anthropic API key from Script Properties.
 * Throws a helpful error if it hasn't been set yet.
 */
function getApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!key || key.trim() === '') {
    throw new Error(
      'CLAUDE_API_KEY is not set. ' +
      'Go to: Apps Script editor → Project Settings (gear icon) → Script Properties → Add property. ' +
      'Key: CLAUDE_API_KEY  |  Value: your Anthropic API key.'
    );
  }
  return key.trim();
}

// ============================================================
// BUILD PROMPT
// ============================================================

/**
 * Packages calendar events, tasks, and summaries into a structured
 * prompt for Claude to reason over.
 *
 * @param {Array} events    - From getUpcomingEvents()
 * @param {Array} tasks     - From getOpenTasks()
 * @param {Array} summaries - From getSummaries()
 * @returns {string} The full prompt string
 */
function buildPrompt(events, tasks, summaries) {
  const tz    = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'EEEE, MMMM d, yyyy');

  // ---- Format: Calendar Events -------------------------------------------
  let eventsSection;
  if (events.length === 0) {
    eventsSection = 'No upcoming calendar events in the next ' + CONFIG.CALENDAR_DAYS_AHEAD + ' days.';
  } else {
    eventsSection = events.map(function(e) {
      let dayLabel;
      if (e.daysUntil === 0)      dayLabel = 'TODAY';
      else if (e.daysUntil === 1) dayLabel = 'TOMORROW';
      else                        dayLabel = 'in ' + e.daysUntil + ' days';

      const timeStr = e.isAllDay ? 'all day' : e.start.split(' ')[1];
      const dateStr = e.start.split(' ')[0];

      let line = '- ' + e.title + ' | ' + dateStr + ' ' + timeStr + ' [' + dayLabel + ']';
      if (e.location) line += ' @ ' + e.location;

      // Calendar label (from Config tab, or auto-detected fallback)
      line += ' (' + (e.calLabel || e.calendarName) + ')';

      // RSVP status — flag unresponded invites
      if (e.myStatus && e.myStatus !== 'organizer' && e.myStatus !== 'accepted') {
        line += ' [RSVP: ' + e.myStatus + ']';
      }

      // Event color tag — user applies these manually to categorize events
      if (e.eventColor) {
        line += ' [tagged: ' + e.eventColor + ']';
      }

      return line;
    }).join('\n');
  }

  // ---- Format: Open Tasks -------------------------------------------------
  let tasksSection;
  if (tasks.length === 0) {
    tasksSection = 'No open tasks.';
  } else {
    tasksSection = tasks.map(function(t) {
      let line = '- [' + t.status + '] ' + t.task;

      if (t.isOverdue && t.daysUntilDue !== null) {
        line += ' ⚠ OVERDUE by ' + Math.abs(t.daysUntilDue) + ' day' + (Math.abs(t.daysUntilDue) === 1 ? '' : 's');
      } else if (t.daysUntilDue !== null && t.daysUntilDue <= 3) {
        line += ' (due in ' + t.daysUntilDue + ' day' + (t.daysUntilDue === 1 ? '' : 's') + ')';
      } else if (t.dueDate) {
        line += ' (due: ' + t.dueDate + ')';
      }

      if (t.isNeglected) {
        line += ' [NEGLECTED: ' + t.ageInDays + ' days old]';
      }

      if (t.recurring) {
        line += ' [recurring: ' + t.recurring + ']';
      }

      if (t.notes) {
        line += ' — ' + t.notes;
      }

      return line;
    }).join('\n');
  }

  // ---- Format: Summaries --------------------------------------------------
  let summariesSection;
  if (summaries.length === 0) {
    summariesSection = 'No summaries available yet.';
  } else {
    summariesSection = summaries.map(function(s) {
      let line = '- [' + s.source + '] ' + s.metric + ': ' + s.value;
      if (s.asOf) line += ' (as of ' + s.asOf + ')';
      return line;
    }).join('\n');
  }

  // ---- Assemble the Full Prompt -------------------------------------------
  const prompt =
    'You are VERA — Virtual Executive & Reminder Assistant. ' +
    'You are the personal chief of staff for Ahmed and Victoria, a 2-person household.\n\n' +

    'Today is ' + today + '.\n\n' +

    'Your role is to think ahead and surface what matters, not just report what exists. ' +
    'As you analyze the data below, ask yourself:\n' +
    '- What upcoming events need preparation or logistics that have not been addressed?\n' +
    '- Which tasks are at risk of slipping through the cracks (neglected, overdue, or undated)?\n' +
    '- Are there dependencies between calendar events and open tasks?\n' +
    '- What financial or recurring obligations are due soon?\n' +
    '- What patterns or conflicts would Ahmed not immediately notice on his own?\n\n' +

    'CALENDAR CONTEXT RULES:\n' +
    '- Events marked "(my calendar)" are Ahmed\'s own — treat these as his primary obligations.\n' +
    '- Events marked "(shared: X)" are from a calendar shared with him — use these as context but only flag them if they directly affect Ahmed (e.g. he needs to prepare something, attend, or respond).\n' +
    '- Events with [RSVP: invited (no response)] or [RSVP: tentative] mean Ahmed has not confirmed — flag these if the event is soon.\n' +
    '- Events with [tagged: Color] have a color label Ahmed applied manually — treat colored events as higher-intent or categorized items worth noting.\n\n' +

    '=== UPCOMING CALENDAR EVENTS (next ' + CONFIG.CALENDAR_DAYS_AHEAD + ' days) ===\n' +
    eventsSection + '\n\n' +

    '=== OPEN TASKS ===\n' +
    tasksSection + '\n\n' +

    '=== LIFE SUMMARIES & METRICS ===\n' +
    summariesSection + '\n\n' +

    'Based on this data, generate up to ' + CONFIG.MAX_FLAGS + ' intelligent, actionable flags for Ahmed. ' +
    'Prioritize items that are time-sensitive, high-stakes, have dependencies, or have been neglected.\n\n' +

    'CRITICAL — RESPONSE FORMAT:\n' +
    'Return ONLY a raw JSON array. ' +
    'No markdown. No code fences. No explanation before or after. Just the JSON array itself, starting with [ and ending with ].\n\n' +

    'Each object must have exactly these four fields:\n' +
    '  "source"  — one of: "Calendar", "Tasks", "Finance", "Summaries", "General"\n' +
    '  "flag"    — short action-oriented title, max 10 words\n' +
    '  "reason"  — specific explanation of why this matters right now, 1-2 sentences\n' +
    '  "urgency" — exactly one of: "High", "Medium", "Low"\n\n' +

    'Example of the expected format (do not include this in your response):\n' +
    '[{"source":"Calendar","flag":"Book restaurant before anniversary fills up","reason":"Anniversary dinner is 4 days away and no reservation task exists. Popular venues fill quickly on weekends.","urgency":"High"}]\n\n' +

    'Generate the flags for Ahmed now:';

  return prompt;
}

// ============================================================
// GENERATE FLAGS — Call Claude API and parse the response
// ============================================================

/**
 * Calls the Anthropic Claude API and parses the returned flag objects.
 *
 * @param {Array} events    - From getUpcomingEvents()
 * @param {Array} tasks     - From getOpenTasks()
 * @param {Array} summaries - From getSummaries()
 * @returns {Array} Parsed and validated array of flag objects
 */
function generateFlags(events, tasks, summaries) {
  const apiKey = getApiKey();
  const prompt = buildPrompt(events, tasks, summaries);

  const requestBody = {
    model:      CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role:    'user',
        content: prompt,
      },
    ],
  };

  const fetchOptions = {
    method:          'post',
    contentType:     'application/json',
    headers: {
      'x-api-key':          apiKey,
      'anthropic-version':  '2023-06-01',
    },
    payload:          JSON.stringify(requestBody),
    muteHttpExceptions: true, // We handle errors manually below
  };

  Logger.log('Calling Claude API (' + CLAUDE_MODEL + ')...');

  const response     = UrlFetchApp.fetch(CLAUDE_API_URL, fetchOptions);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    Logger.log('Claude API HTTP ' + responseCode + ': ' + responseText);
    throw new Error('Claude API returned HTTP ' + responseCode + '. Check your API key and account credits.');
  }

  let apiJson;
  try {
    apiJson = JSON.parse(responseText);
  } catch (parseErr) {
    throw new Error('Failed to parse Claude API response as JSON: ' + responseText.substring(0, 500));
  }

  if (!apiJson.content || !apiJson.content[0] || !apiJson.content[0].text) {
    throw new Error('Unexpected Claude API response structure: ' + JSON.stringify(apiJson).substring(0, 500));
  }

  const rawContent = apiJson.content[0].text.trim();
  Logger.log('Claude raw output (' + rawContent.length + ' chars): ' + rawContent.substring(0, 500));

  const flags = parseFlags(rawContent);
  Logger.log('Parsed ' + flags.length + ' valid flags from Claude response.');

  return flags;
}

// ============================================================
// PARSE FLAGS — Extract and validate the JSON array
// ============================================================

/**
 * Extracts a JSON flag array from Claude's raw text response.
 * Defensively handles stray markdown code fences that Claude
 * occasionally adds despite explicit instructions not to.
 *
 * @param {string} rawContent - The raw text from Claude's response
 * @returns {Array} Validated array of flag objects (may be empty)
 */
function parseFlags(rawContent) {
  let cleaned = rawContent.trim();

  // Strip markdown code fences if present
  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i,     '')
    .replace(/\s*```$/i,     '')
    .trim();

  // Find the JSON array boundaries
  const startIdx = cleaned.indexOf('[');
  const endIdx   = cleaned.lastIndexOf(']');

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    Logger.log('parseFlags: No valid JSON array found in response.');
    Logger.log('Full content was: ' + cleaned);
    return [];
  }

  const jsonStr = cleaned.substring(startIdx, endIdx + 1);

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    Logger.log('parseFlags JSON.parse failed: ' + e.message);
    Logger.log('JSON string was: ' + jsonStr.substring(0, 500));
    return [];
  }

  if (!Array.isArray(parsed)) {
    Logger.log('parseFlags: Parsed result is not an array.');
    return [];
  }

  const VALID_URGENCIES = ['High', 'Medium', 'Low'];
  const VALID_SOURCES   = ['Calendar', 'Tasks', 'Finance', 'Summaries', 'General'];

  const validated = parsed
    .filter(function(f) {
      return f && typeof f === 'object' && f.flag && f.flag.trim() !== '';
    })
    .map(function(f) {
      const urgency = VALID_URGENCIES.indexOf(f.urgency) !== -1 ? f.urgency : 'Low';
      const source  = VALID_SOURCES.indexOf(f.source) !== -1 ? f.source : 'General';
      return {
        source:  source,
        flag:    String(f.flag   || '').trim(),
        reason:  String(f.reason || '').trim(),
        urgency: urgency,
      };
    })
    .slice(0, CONFIG.MAX_FLAGS); // Enforce max flag cap

  return validated;
}
