// ============================================================
// VERA — Chat.js
// Conversational AI interface — shared backend for
// the dashboard Chat tab and Telegram bot (Phase 4)
// ============================================================
//
// Script Properties used:
//   CHAT_HISTORY_{sessionId} — stored conversation history (JSON)
//
// Sessions:
//   'dashboard'  — dashboard Chat tab (shared, no multi-user concern)
//   '{chatId}'   — Telegram: the user's numeric Telegram chat ID
// ============================================================

var CHAT_HISTORY_PREFIX = 'CHAT_HISTORY_';
var CHAT_MAX_EXCHANGES  = 10; // keep last 10 back-and-forths (20 messages)

// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildChatSystemPrompt_(context) {
  var tz    = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'EEEE, MMMM d, yyyy');

  var flagLines = context.flags.length === 0
    ? '  (none active)'
    : context.flags.map(function(f) {
        return '  [' + f.urgency + '] ' + f.flag + ' — ' + f.reason + ' (ID: ' + f.id + ')';
      }).join('\n');

  var taskLines = context.tasks.length === 0
    ? '  (none open)'
    : context.tasks.map(function(t) {
        var line = '  - ' + t.task + ' (ID: ' + t.id + ')';
        if (t.dueDate)   line += ' | due: ' + t.dueDate;
        if (t.isOverdue) line += ' ⚠ OVERDUE';
        return line;
      }).join('\n');

  var summaryLines = context.summaries.length === 0
    ? '  (none available)'
    : context.summaries.map(function(s) {
        return '  [' + s.source + '] ' + s.metric + ': ' + s.value;
      }).join('\n');

  return (
    'You are VERA — Virtual Executive & Reminder Assistant. ' +
    'You are the personal chief of staff for Ahmed (and his partner Victoria).\n\n' +
    'Today is ' + today + '.\n\n' +

    'CURRENT STATE:\n\n' +
    'ACTIVE FLAGS (' + context.flags.length + '):\n' + flagLines + '\n\n' +
    'OPEN TASKS (' + context.tasks.length + '):\n' + taskLines + '\n\n' +
    'SUMMARIES:\n' + summaryLines + '\n\n' +

    'AVAILABLE ACTIONS — include these exact lines in your response to take action:\n' +
    'ACTION:complete_task|{taskId}\n' +
    'ACTION:acknowledge_flag|{flagId}\n' +
    'ACTION:snooze_flag|{flagId}|{days}\n' +
    'ACTION:resolve_flag|{flagId}\n\n' +

    'RULES:\n' +
    '- Be concise and conversational. This is a chat interface, not an email.\n' +
    '- Address Ahmed directly by name when appropriate.\n' +
    '- If taking an action, include the ACTION line anywhere in your response, then confirm in plain text what you did.\n' +
    '- Never fabricate data not present in the current state above.\n' +
    '- If asked about something not in the current state, say so honestly.\n'
  );
}

// ============================================================
// CONTEXT BUILDER
// ============================================================

function buildChatContext_() {
  var ss = getSpreadsheet();

  // Active flags — read sheet directly
  var activeFlags = [];
  var flagSheet   = ss.getSheetByName(TABS.FLAGS);
  if (flagSheet && flagSheet.getLastRow() >= 2) {
    var numRows = flagSheet.getLastRow() - 1;
    var data    = flagSheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();
    activeFlags = data
      .filter(function(r) {
        return r[0] !== '' &&
               String(r[6]).toLowerCase() !== 'yes' &&  // not acknowledged
               String(r[8]).toLowerCase() !== 'yes';    // not resolved
      })
      .map(function(r) {
        return {
          id:      String(r[0]),
          flag:    String(r[3] || ''),
          reason:  String(r[4] || ''),
          urgency: String(r[5] || 'Low'),
        };
      });
  }

  var tasks     = getOpenTasks();
  var summaries = readSummaryTab_(ss, TABS.SUMMARIES);

  return { flags: activeFlags, tasks: tasks, summaries: summaries };
}

// ============================================================
// HISTORY STORAGE  (Script Properties, per session)
// ============================================================

function loadChatHistory_(sessionId) {
  var key = CHAT_HISTORY_PREFIX + String(sessionId);
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

function saveChatHistory_(sessionId, userMsg, replyText) {
  var history = loadChatHistory_(sessionId);
  history.push({ role: 'user',      content: userMsg   });
  history.push({ role: 'assistant', content: replyText });
  var trimmed = history.slice(-(CHAT_MAX_EXCHANGES * 2));
  var key     = CHAT_HISTORY_PREFIX + String(sessionId);
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(trimmed));
}

// ============================================================
// CLAUDE API  (messages format, with conversation history)
// ============================================================

function callClaudeChat_(userMessage, history, systemPrompt) {
  var apiKey   = getApiKey();
  var messages = history.concat([{ role: 'user', content: userMessage }]);

  var requestBody = {
    model:      CLAUDE_MODEL,
    max_tokens: 1024,
    system:     systemPrompt,
    messages:   messages,
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

  var response = UrlFetchApp.fetch(CLAUDE_API_URL, fetchOptions);
  var code     = response.getResponseCode();
  var text     = response.getContentText();

  if (code !== 200) {
    throw new Error('Claude API returned HTTP ' + code + ': ' + text.substring(0, 300));
  }

  var json = JSON.parse(text);
  if (!json.content || !json.content[0] || !json.content[0].text) {
    throw new Error('Unexpected Claude API response structure');
  }

  return json.content[0].text.trim();
}

// ============================================================
// ACTION EXECUTION
// Claude can embed ACTION lines in its reply; we execute then strip them.
// ============================================================

function executeActions_(rawText) {
  var lines    = rawText.split('\n');
  var executed = [];

  lines.forEach(function(line) {
    var m = line.match(/^ACTION:(\w+)\|(.+)$/);
    if (!m) return;

    var type = m[1];
    var args = m[2].split('|');

    try {
      if      (type === 'complete_task')    { webCompleteTask_(args[0]);                       executed.push(type); }
      else if (type === 'acknowledge_flag') { webAcknowledge_(args[0]);                        executed.push(type); }
      else if (type === 'snooze_flag')     { webSnooze_(args[0], parseInt(args[1], 10) || 2); executed.push(type); }
      else if (type === 'resolve_flag')    { webResolve_(args[0]);                             executed.push(type); }
    } catch (e) {
      Logger.log('Action error [' + type + ']: ' + e.message);
    }
  });

  return executed;
}

function stripActions_(text) {
  return text.replace(/^ACTION:\w+\|[^\n]*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

/**
 * Process a single user message and return VERA's reply.
 * Loads history, calls Claude, executes any actions, saves history.
 *
 * @param {string} userMessage  - The user's message
 * @param {string} sessionId    - 'dashboard' or Telegram chatId
 * @returns {{ ok: boolean, reply: string }}
 */
function processChat_(userMessage, sessionId) {
  sessionId = sessionId || 'dashboard';

  if (!userMessage || !userMessage.trim()) {
    return { ok: true, reply: 'What can I help you with?' };
  }

  var history   = loadChatHistory_(sessionId);
  var context   = buildChatContext_();
  var sysPrompt = buildChatSystemPrompt_(context);
  var rawReply  = callClaudeChat_(userMessage.trim(), history, sysPrompt);

  // Execute any actions Claude embedded
  executeActions_(rawReply);

  // Strip ACTION lines before returning to user
  var cleanReply = stripActions_(rawReply);

  // Persist this exchange
  saveChatHistory_(sessionId, userMessage.trim(), cleanReply);

  return { ok: true, reply: cleanReply };
}

// ============================================================
// DEBUG HELPERS  (run from Apps Script editor)
// ============================================================

function clearChatHistory(sessionId) {
  sessionId = sessionId || 'dashboard';
  PropertiesService.getScriptProperties().deleteProperty(CHAT_HISTORY_PREFIX + sessionId);
  Logger.log('Chat history cleared for: ' + sessionId);
}

function testChat() {
  var result = processChat_('What are my active flags right now?', 'test');
  Logger.log('VERA reply:\n' + result.reply);
}
