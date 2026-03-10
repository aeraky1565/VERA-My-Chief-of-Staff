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

  var projectsLine = context.projectsSummary || '  (none)';

  // Calendar events — same format as Claude.js lines 53–79
  var calLines;
  if (!context.calendarEvents || context.calendarEvents.length === 0) {
    calLines = '  (none in the next ' + CONFIG.CALENDAR_DAYS_AHEAD + ' days)';
  } else {
    calLines = context.calendarEvents.map(function(e) {
      var dl = e.daysUntil === 0 ? 'TODAY' : e.daysUntil === 1 ? 'TOMORROW' : 'in ' + e.daysUntil + ' days';
      var ts = e.isAllDay ? 'all day' : e.start.split(' ')[1];
      var ds = e.start.split(' ')[0];
      var ln = '  - ' + e.title + ' | ' + ds + ' ' + ts + ' [' + dl + ']';
      if (e.location) ln += ' @ ' + e.location;
      ln += ' (' + (e.calLabel || e.calendarName) + ')';
      if (e.myStatus && e.myStatus !== 'organizer' && e.myStatus !== 'accepted')
        ln += ' [RSVP: ' + e.myStatus + ']';
      if (e.eventColor) ln += ' [tagged: ' + e.eventColor + ']';
      return ln;
    }).join('\n');
  }

  // Shared Interest Ledger — same format as WeekendPlanner.js line 325
  var interestLines = (!context.interests || context.interests.length === 0)
    ? '  (none logged yet)'
    : context.interests.map(function(i) {
        return '  - ' + i.person + ': ' + i.interest + ' [' + i.category + ', logged ' + i.date + ']';
      }).join('\n');

  // PTO — delegate to existing ptoSummaryForClaude_() (PTO.js)
  var ptoSection = context.ptoStats
    ? ptoSummaryForClaude_(context.ptoStats)
    : '  (unavailable — PTO calendar may not be configured)';

  // Yearly goals — same format as WeekendPlanner.js lines 337–338
  var goalLines = (!context.goals || context.goals.length === 0)
    ? '  (none active)'
    : context.goals.map(function(g) {
        return '  - [' + g.status + '] ' + g.title + (g.category ? ' (' + g.category + ')' : '');
      }).join('\n');

  return (
    'You are VERA — Virtual Executive & Reminder Assistant. ' +
    'You are the personal chief of staff for Ahmed (and his partner Victoria).\n\n' +
    'Today is ' + today + '.\n\n' +

    'CURRENT STATE:\n\n' +
    'ACTIVE FLAGS (' + context.flags.length + '):\n' + flagLines + '\n\n' +
    'OPEN TASKS (' + context.tasks.length + '):\n' + taskLines + '\n\n' +
    'SUMMARIES:\n' + summaryLines + '\n\n' +
    'PROJECTS:\n  ' + projectsLine + '\n\n' +
    'UPCOMING CALENDAR EVENTS:\n' + calLines + '\n\n' +
    'SHARED INTEREST LEDGER (top 20):\n' + interestLines + '\n\n' +
    'YEARLY GOALS (active):\n' + goalLines + '\n\n' +
    'PTO STATUS:\n' + ptoSection + '\n\n' +

    'AVAILABLE ACTIONS — include these exact lines in your response to take action:\n' +
    'ACTION:complete_task|{taskId}\n' +
    'ACTION:acknowledge_flag|{flagId}\n' +
    'ACTION:snooze_flag|{flagId}|{days}\n' +
    'ACTION:resolve_flag|{flagId}\n' +
    'ACTION:create_project|{project name}|{task 1}~{task 2}~{task 3}\n' +
    'ACTION:log_interest|{person}|{interest}|{category}\n' +
    'ACTION:create_task|{task text}|{due date YYYY-MM-DD}\n' +
    'ACTION:create_calendar_event|{title}|{YYYY-MM-DD}|{HH:MM or all-day}|{duration_minutes}\n\n' +

    'RULES:\n' +
    '- Be concise and conversational. This is a chat interface, not an email.\n' +
    '- Address Ahmed directly by name when appropriate.\n' +
    '- If taking an action, include the ACTION line anywhere in your response, then confirm in plain text what you did.\n' +
    '- For create_task: use when Ahmed asks to add, create, or remember a task. Include due date if one was mentioned (format YYYY-MM-DD). Omit the due date field if none was specified.\n' +
    '- For create_calendar_event: use when Ahmed asks to schedule, block time, or add an event to his calendar. If the time is not mentioned, use "all-day". If date or title are missing, ask before emitting the ACTION line.\n' +
    '- For create_project: before generating the plan, ask 2–4 targeted clarifying questions to understand scope, timeline, and constraints. Wait for the answers before emitting the ACTION line. Only skip questions if Ahmed has already provided enough context, or explicitly says "just create it" / "go ahead". Once you have the details, generate a comprehensive, exhaustive checklist — the goal is that Ahmed misses nothing. Think through every phase: planning, logistics, dependencies, admin/paperwork, communications, day-of execution, and follow-up. Explicitly include steps people commonly overlook. Aim for 20–30 tasks for complex projects. Order tasks chronologically. Assign priorities naturally (High for time-sensitive or blocking steps, Low for nice-to-haves). Separate tasks with ~ and optionally append |High or |Low to each task.\n' +
    '- For log_interest: when Ahmed or Victoria mentions liking something, wanting to try something, or expresses interest in a place, food, activity, or experience, log it automatically with ACTION:log_interest. Use person "Ahmed" or "Victoria". Pick the best category from: Food, Travel, Fitness, Culture, Hobbies, Learning, Other. Example: "Victoria mentioned she wants to visit Wimberley" → ACTION:log_interest|Victoria|visit Wimberley TX|Travel\n' +
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

  var tasks           = getOpenTasks();
  // Include Metrics tab (nightly auto-stats) alongside Summaries
  var summaries       = readSummaryTab_(ss, TABS.METRICS).concat(readSummaryTab_(ss, TABS.SUMMARIES));
  var projectsSummary = getProjectsSummaryForContext_();

  // Calendar events (default horizon = CONFIG.CALENDAR_DAYS_AHEAD)
  var calendarEvents = [];
  try { calendarEvents = getUpcomingEvents(); }
  catch (e) { Logger.log('Chat context: calendar — ' + e.message); }

  // Shared Interest Ledger (top 20 active entries)
  var interests = [];
  try { interests = getSharedInterestLedger_().slice(0, 20); }
  catch (e) { Logger.log('Chat context: interests — ' + e.message); }

  // PTO stats (live compute — same pattern as webGetPTO_ in WebApp.js)
  var ptoStats = null;
  try {
    var ptoCfg    = readPTOConfig_();
    var ptoResult = getPTOEvents_(ptoCfg);
    ptoStats = computePTOStats_(ptoResult, ptoCfg, new Date());
  } catch (e) { Logger.log('Chat context: PTO — ' + e.message); }

  // Yearly goals (active only, top 8 — same filter as WeekendPlanner.js)
  var goals = [];
  try {
    goals = getGoals_().filter(function(g) {
      var s = String(g.status || '').toLowerCase();
      return s !== 'done' && s !== 'archived' && s !== 'complete';
    }).slice(0, 8);
  } catch (e) { Logger.log('Chat context: goals — ' + e.message); }

  return {
    flags:           activeFlags,
    tasks:           tasks,
    summaries:       summaries,
    projectsSummary: projectsSummary,
    calendarEvents:  calendarEvents,
    interests:       interests,
    ptoStats:        ptoStats,
    goals:           goals,
  };
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
    max_tokens: 2048,
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
  var errors   = [];

  lines.forEach(function(line) {
    // Strip leading whitespace/backticks Claude sometimes adds around code lines
    var trimmed = line.replace(/^[\s`]+/, '').replace(/[`]+$/, '');
    var m = trimmed.match(/^ACTION:(\w+)\|(.+)$/);
    if (!m) return;

    var type = m[1];
    var args = m[2].split('|');

    try {
      if      (type === 'complete_task')    { webCompleteTask_(args[0]);                       executed.push(type); }
      else if (type === 'acknowledge_flag') { webAcknowledge_(args[0]);                        executed.push(type); }
      else if (type === 'snooze_flag')     { webSnooze_(args[0], parseInt(args[1], 10) || 2); executed.push(type); }
      else if (type === 'resolve_flag')    { webResolve_(args[0]);                             executed.push(type); }
      else if (type === 'create_project')  {
        // Split on first pipe only — project name | tasks (tasks may contain |High, |Medium, |Low)
        var firstPipe = m[2].indexOf('|');
        var projName  = (firstPipe === -1 ? m[2] : m[2].substring(0, firstPipe)).trim() || 'Untitled Project';
        var tasksRaw  = firstPipe === -1 ? '' : m[2].substring(firstPipe + 1).trim();
        var taskNames = tasksRaw ? tasksRaw.split('~') : [];
        createProject_(projName, taskNames);
        executed.push(type);
      }
      else if (type === 'log_interest') {
        var person   = (args[0] || 'Ahmed').trim();
        var interest = (args[1] || '').trim();
        var category = (args[2] || 'Other').trim();
        if (interest) {
          createInterest_(person, interest, category, 'Chat', '');
          executed.push(type);
        }
      }
      else if (type === 'create_task') {
        var taskText = (args[0] || '').trim();
        var dueDate  = (args[1] || '').trim();
        if (!taskText) throw new Error('Task text is required');
        var taskSheet = getSpreadsheet().getSheetByName(TABS.TASKS);
        if (!taskSheet) throw new Error('Tasks sheet not found');
        var tz2      = Session.getScriptTimeZone();
        var now2     = new Date();
        var dateStr2 = Utilities.formatDate(now2, tz2, 'yyyyMMdd');
        var addedStr = Utilities.formatDate(now2, tz2, 'yyyy-MM-dd');
        var seq2     = 1;
        if (taskSheet.getLastRow() >= 2) {
          taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, 1).getValues()
            .forEach(function(r) { if (String(r[0] || '').indexOf('TASK-' + dateStr2) === 0) seq2++; });
        }
        var taskId2 = 'TASK-' + dateStr2 + '-' + String(seq2).padStart(2, '0');
        // TASK_HEADERS: ID | Task | Added Date | Due Date | Status | Recurring | Notes | Flagged
        taskSheet.getRange(taskSheet.getLastRow() + 1, 1, 1, TASK_HEADERS.length)
                 .setValues([[taskId2, taskText, addedStr, dueDate, 'Open', '', '', '']]);
        executed.push(type + ' (' + taskId2 + ')');
      }
      else if (type === 'create_calendar_event') {
        var evTitle    = (args[0] || '').trim();
        var evDate     = (args[1] || '').trim();
        var evTime     = (args[2] || 'all-day').trim().toLowerCase();
        var evDuration = parseInt(args[3], 10) || 60;
        if (!evTitle || !evDate) throw new Error('Title and date are required for create_calendar_event');
        var cal = CalendarApp.getDefaultCalendar();
        if (evTime === 'all-day' || evTime === '') {
          var startD = new Date(evDate + 'T00:00:00');
          if (isNaN(startD.getTime())) throw new Error('Invalid date: ' + evDate);
          cal.createAllDayEvent(evTitle, startD);
        } else {
          var startDT = new Date(evDate + 'T' + evTime + ':00');
          if (isNaN(startDT.getTime())) throw new Error('Invalid date/time: ' + evDate + ' ' + evTime);
          var endDT   = new Date(startDT.getTime() + evDuration * 60 * 1000);
          cal.createEvent(evTitle, startDT, endDT);
        }
        executed.push(type + ' ("' + evTitle + '" on ' + evDate + ')');
      }
    } catch (e) {
      Logger.log('Action error [' + type + ']: ' + e.message);
      errors.push(type + ': ' + e.message);
    }
  });

  return { executed: executed, errors: errors };
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
  Logger.log('VERA raw reply:\n' + rawReply); // visible in Apps Script Execution Log

  // Execute any actions Claude embedded
  var actionResult = executeActions_(rawReply);

  // Strip ACTION lines before returning to user
  var cleanReply = stripActions_(rawReply);

  // Surface any action failures so the user knows something went wrong
  if (actionResult.errors.length > 0) {
    cleanReply += '\n\n⚠️ Note: some actions could not be completed — ' + actionResult.errors.join('; ') + '.';
  }

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
