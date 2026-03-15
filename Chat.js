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

  // Shared Interest Ledger — include ID so Claude can reference for delete_interest
  var interestLines = (!context.interests || context.interests.length === 0)
    ? '  (none logged yet)'
    : context.interests.map(function(i) {
        return '  - [ID:' + i.id + '] ' + i.person + ': ' + i.interest +
               ' [' + i.category + ', logged ' + i.date + ']';
      }).join('\n');

  // PTO — delegate to existing ptoSummaryForClaude_() (PTO.js)
  var ptoSection = context.ptoStats
    ? ptoSummaryForClaude_(context.ptoStats)
    : '  (unavailable — PTO calendar may not be configured)';

  // Yearly goals — include ID so Claude can reference them in update_goal / delete_goal
  var goalLines = (!context.goals || context.goals.length === 0)
    ? '  (none active)'
    : context.goals.map(function(g) {
        return '  - [' + g.status + '] ' + g.title +
               (g.category ? ' (' + g.category + ')' : '') + ' (ID: ' + g.id + ')';
      }).join('\n');

  var billLines = (!context.bills || context.bills.length === 0)
    ? '  (none)'
    : context.bills.map(function(b) {
        return '  [row:' + b.row + '] ' + b.bill +
               (b.amount ? ' $' + b.amount : '') +
               ' (' + b.frequency + ')' +
               (b.dueDay ? ' due day ' + b.dueDay : '') +
               (b.paid ? ' ✓ PAID this month' : ' — UNPAID');
      }).join('\n');

  var recipeLines = (!context.recipes || context.recipes.length === 0)
    ? '  (none)'
    : context.recipes.map(function(r) {
        var ingCount = r.ingredients ? r.ingredients.split(';').length : 0;
        return '  [row:' + r.row + '] ' + r.name +
               (r.cuisine ? ' (' + r.cuisine + ')' : '') +
               (ingCount > 0 ? ' — ' + ingCount + ' ingredients' : '');
      }).join('\n');

  var homeItemLines = (!context.homeItems || context.homeItems.length === 0)
    ? '  (none)'
    : context.homeItems.map(function(h) {
        var svc = h.nextService ? ' next service: ' + h.nextService : '';
        if (h.serviceDays !== null && h.serviceDays < 0) svc += ' ⚠ OVERDUE';
        else if (h.serviceDays !== null && h.serviceDays <= 14) svc += ' (due soon)';
        return '  [row:' + h.row + '] ' + h.item +
               (h.category ? ' [' + h.category + ']' : '') + svc;
      }).join('\n');

  var shoppingStoresList = (!context.shoppingStores || context.shoppingStores.length === 0)
    ? '(none configured)'
    : context.shoppingStores.join(', ');

  var ideaLines = (!context.ideas || context.ideas.length === 0)
    ? '  (none parked)'
    : context.ideas.map(function(i) {
        return '  [' + i.id + '] ' + i.idea +
               (i.category ? ' [' + i.category + ']' : '') +
               (i.status !== 'New' ? ' (' + i.status + ')' : '') +
               (i.tags ? ' — ' + i.tags : '');
      }).join('\n');

  return (
    'You are VERA — Virtual Executive & Reminder Assistant. ' +
    'You are the personal chief of staff for Ahmed (and his partner Victoria).\n\n' +
    'IMPORTANT: You run inside Google Apps Script with direct access to Google Calendar, ' +
    'Google Sheets, and other Google services. Every ACTION listed below is FULLY IMPLEMENTED ' +
    'and will be executed immediately by the backend when you include it in your response. ' +
    'Never tell the user you cannot perform one of the listed actions — just include the ACTION ' +
    'line and it will be done. Do not hedge, disclaim, or suggest the user do it themselves.\n\n' +
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
    'BILLS (' + context.bills.length + '):\n' + billLines + '\n\n' +
    'RECIPES (' + context.recipes.length + '):\n' + recipeLines + '\n\n' +
    'HOME ITEMS (' + context.homeItems.length + '):\n' + homeItemLines + '\n\n' +
    'SHOPPING STORES: ' + shoppingStoresList + '\n\n' +
    'IDEA BRAINDUMP (' + (context.ideas ? context.ideas.length : 0) + '):\n' + ideaLines + '\n\n' +

    'AVAILABLE ACTIONS — include these exact lines in your response to take action:\n' +
    'ACTION:complete_task|{taskId}\n' +
    'ACTION:delete_task|{taskId}\n' +
    'ACTION:update_task|{taskId}|{field}|{value}\n' +
    'ACTION:acknowledge_flag|{flagId}\n' +
    'ACTION:snooze_flag|{flagId}|{days}\n' +
    'ACTION:resolve_flag|{flagId}\n' +
    'ACTION:create_project|{project name}|{task 1}~{task 2}~{task 3}\n' +
    'ACTION:log_interest|{person}|{interest}|{category}\n' +
    'ACTION:create_task|{task text}|{due date YYYY-MM-DD}\n' +
    'ACTION:create_calendar_event|{title}|{YYYY-MM-DD}|{HH:MM or all-day}|{duration_minutes}\n' +
    'ACTION:add_bill|{name}|{amount}|{due_day}|{frequency}|{category}|{account}\n' +
    'ACTION:mark_bill_paid|{row_number_or_bill_name}\n' +
    'ACTION:add_recipe|{name}|{cuisine}|{servings}|{prep_time}|{ingredients_semicolon_sep}|{tags}\n' +
    'ACTION:delete_recipe|{row_number}\n' +
    'ACTION:add_home_item|{item_name}|{category}|{warranty_expiry_YYYY-MM-DD}|{interval_months}|{notes}\n' +
    'ACTION:record_home_service|{row_number_or_item_name}\n' +
    'ACTION:add_shopping_item|{store_name}|{item_text}\n' +
    'ACTION:add_goal|{title}|{category}|{description}\n' +
    'ACTION:update_goal|{goalId}|{field}|{value}\n' +
    'ACTION:delete_goal|{goalId}\n' +
    'ACTION:delete_interest|{interestId}\n' +
    'ACTION:add_idea|{idea text}|{category}|{tags}\n' +
    'ACTION:promote_idea|{ideaId}\n' +
    'ACTION:archive_idea|{ideaId}\n\n' +

    'RULES:\n' +
    '- Be concise and conversational. This is a chat interface, not an email.\n' +
    '- Address Ahmed directly by name when appropriate.\n' +
    '- If taking an action, include the ACTION line anywhere in your response, then confirm in plain text what you did.\n' +
    '- For complete_task / delete_task: match task by ID from OPEN TASKS above.\n' +
    '- For update_task: valid fields are "task" (rename the task text), "dueDate" (YYYY-MM-DD), "notes", "status" (Open/Done/Paused).\n' +
    '- For create_task: use when Ahmed asks to add, create, or remember a task. Include due date if one was mentioned (format YYYY-MM-DD). Omit the due date field if none was specified.\n' +
    '- For create_calendar_event: VERA can and does create Google Calendar events directly via the Apps Script backend. Use this whenever Ahmed asks to schedule, block time, or add an event to his calendar. If the time is not mentioned, default to "all-day". If title or date are missing, ask for them before emitting the ACTION line. Never say you cannot create calendar events — you can.\n' +
    '- For create_project: before generating the plan, ask 2–4 targeted clarifying questions to understand scope, timeline, and constraints. Wait for the answers before emitting the ACTION line. Only skip questions if Ahmed has already provided enough context, or explicitly says "just create it" / "go ahead". Once you have the details, generate a comprehensive, exhaustive checklist — the goal is that Ahmed misses nothing. Think through every phase: planning, logistics, dependencies, admin/paperwork, communications, day-of execution, and follow-up. Explicitly include steps people commonly overlook. Aim for 20–30 tasks for complex projects. Order tasks chronologically. Assign priorities naturally (High for time-sensitive or blocking steps, Low for nice-to-haves). Separate tasks with ~ and optionally append |High or |Low to each task.\n' +
    '- For log_interest: when Ahmed or Victoria mentions liking something, wanting to try something, or expresses interest in a place, food, activity, or experience, log it automatically with ACTION:log_interest. Use person "Ahmed" or "Victoria". Pick the best category from: Food, Travel, Fitness, Culture, Hobbies, Learning, Other. Example: "Victoria mentioned she wants to visit Wimberley" → ACTION:log_interest|Victoria|visit Wimberley TX|Travel\n' +
    '- For add_bill: use empty string for optional fields (amount, dueDay, category, account) when not provided.\n' +
    '- For mark_bill_paid: pass the row number from BILLS above (e.g., "2" for [row:2]). This toggles: paid→unpaid, unpaid→paid.\n' +
    '- For add_recipe: ingredients must be semicolon-separated (e.g., "Pasta 400g; Beef 500g; Tomatoes 2 cans"). Use empty string for unknown fields.\n' +
    '- For delete_recipe: use the row number from RECIPES above. Always confirm the recipe name with Ahmed before deleting.\n' +
    '- For add_home_item: use empty string for warranty_expiry and interval_months if not provided.\n' +
    '- For record_home_service: pass the row number from HOME ITEMS above, OR the item name. Sets Last Service=today, computes Next Service, creates a GCal reminder.\n' +
    '- For add_shopping_item: store_name must partially match one of the SHOPPING STORES listed above.\n' +
    '- For update_goal: valid fields are "status" (To Do/In Progress/Done/Paused), "title", "category", "progress", "notes". Use goal ID from YEARLY GOALS above.\n' +
    '- For delete_goal / delete_interest: always confirm the item name with Ahmed before deleting.\n' +
    '- For add_idea: capture any unstructured thought, half-formed plan, or "park this for later" request. Category options: General/Home/Finance/Health/Career/Personal/Travel/Other. Tags are optional, comma-separated. Use when Ahmed says "note this", "park this idea", "I want to eventually...", etc.\n' +
    '- For promote_idea: converts the idea to a real open task. Use the idea ID from IDEA BRAINDUMP above. Confirm with Ahmed which idea to promote if it is ambiguous.\n' +
    '- For archive_idea: marks the idea as Archived (no longer shown). Always confirm the idea with Ahmed before archiving.\n' +
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

  // Bills (for chat context)
  var bills = [];
  try {
    var billSheet = ss.getSheetByName(TABS.BILLS);
    if (billSheet && billSheet.getLastRow() >= 2) {
      var billData  = billSheet.getRange(2, 1, billSheet.getLastRow() - 1, BILL_HEADERS.length).getValues();
      var tzB       = Session.getScriptTimeZone();
      var currMonth = Utilities.formatDate(new Date(), tzB, 'yyyy-MM');
      bills = billData.filter(function(r) { return String(r[0]).trim(); }).map(function(r, idx) {
        return {
          row:       idx + 2,
          bill:      String(r[0] || '').trim(),
          amount:    r[1] !== '' ? Number(r[1]) : null,
          dueDay:    r[2] !== '' ? Number(r[2]) : null,
          frequency: String(r[3] || 'Monthly').trim(),
          paid:      String(r[6] || '').trim() === currMonth,
        };
      });
    }
  } catch (e) { Logger.log('Chat context: bills — ' + e.message); }

  // Recipes
  var recipes = [];
  try {
    var recSheet = ss.getSheetByName(TABS.RECIPES);
    if (recSheet && recSheet.getLastRow() >= 2) {
      var recData = recSheet.getRange(2, 1, recSheet.getLastRow() - 1, RECIPE_HEADERS.length).getValues();
      recipes = recData.filter(function(r) { return String(r[0]).trim(); }).map(function(r, idx) {
        return {
          row:         idx + 2,
          name:        String(r[0] || '').trim(),
          cuisine:     String(r[1] || '').trim(),
          ingredients: String(r[5] || '').trim(),
          tags:        String(r[6] || '').trim(),
        };
      });
    }
  } catch (e) { Logger.log('Chat context: recipes — ' + e.message); }

  // Home Items
  var homeItems = [];
  try {
    var hiSheet = ss.getSheetByName(TABS.HOME_ITEMS);
    if (hiSheet && hiSheet.getLastRow() >= 2) {
      var hiData   = hiSheet.getRange(2, 1, hiSheet.getLastRow() - 1, HOME_ITEM_HEADERS.length).getValues();
      var todayHI  = new Date(); todayHI.setHours(0, 0, 0, 0);
      homeItems = hiData.filter(function(r) { return String(r[0]).trim(); }).map(function(r, idx) {
        var svcDays = null;
        if (r[5]) {
          try { svcDays = Math.round((new Date(r[5]) - todayHI) / 86400000); } catch (ex) {}
        }
        return {
          row:            idx + 2,
          item:           String(r[0] || '').trim(),
          category:       String(r[1] || '').trim(),
          nextService:    r[5] ? String(r[5]).substring(0, 10) : '',
          intervalMonths: r[6] !== '' ? Number(r[6]) : null,
          serviceDays:    svcDays,
        };
      });
    }
  } catch (e) { Logger.log('Chat context: homeItems — ' + e.message); }

  // Shopping store names (so Claude knows which stores to add items to)
  var shoppingStores = [];
  try { shoppingStores = getShoppingList_().map(function(s) { return s.storeName; }); }
  catch (e) { Logger.log('Chat context: shopping stores — ' + e.message); }

  // Ideas braindump — all non-archived ideas (Issue #18)
  var ideas = [];
  try {
    var ideaSheet = ss.getSheetByName(TABS.IDEAS);
    if (ideaSheet && ideaSheet.getLastRow() >= 2) {
      var ideaData = ideaSheet.getRange(2, 1, ideaSheet.getLastRow() - 1, IDEA_HEADERS.length).getValues();
      ideas = ideaData.filter(function(r) { return String(r[0]).trim(); }).map(function(r, idx) {
        return { row: idx + 2,
                 id:        String(r[0]||'').trim(),
                 dateAdded: String(r[1]||'').trim(),
                 idea:      String(r[2]||'').trim(),
                 category:  String(r[3]||'').trim(),
                 tags:      String(r[4]||'').trim(),
                 notes:     String(r[5]||'').trim(),
                 status:    String(r[6]||'New').trim() };
      }).filter(function(i) { return i.status !== 'Archived'; });
    }
  } catch (e) { Logger.log('Chat context: ideas — ' + e.message); }

  return {
    flags:           activeFlags,
    tasks:           tasks,
    summaries:       summaries,
    projectsSummary: projectsSummary,
    calendarEvents:  calendarEvents,
    interests:       interests,
    ptoStats:        ptoStats,
    goals:           goals,
    bills:           bills,
    recipes:         recipes,
    homeItems:       homeItems,
    shoppingStores:  shoppingStores,
    ideas:           ideas,
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

/**
 * @param {string}      userMessage   - User's text (may be empty when image-only)
 * @param {Array}       history       - Prior message objects
 * @param {string}      systemPrompt  - VERA system prompt
 * @param {string|null} imageBase64   - Optional base64-encoded image
 * @param {string|null} imageMimeType - e.g. 'image/jpeg', 'image/png'
 */
function callClaudeChat_(userMessage, history, systemPrompt, imageBase64, imageMimeType) {
  var apiKey = getApiKey();

  // Build user content: multimodal array when image present, plain string otherwise
  var userContent;
  if (imageBase64 && imageMimeType) {
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: imageMimeType, data: imageBase64 } },
      { type: 'text',  text: userMessage ||
          'Please analyze this image and tell me what actions I should take or what useful information you can extract.' }
    ];
  } else {
    userContent = userMessage;
  }

  var messages = history.concat([{ role: 'user', content: userContent }]);

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

      // ---- Tasks (extended) ------------------------------------------------
      else if (type === 'delete_task') {
        var dtFound = findTaskRow_(args[0]);
        dtFound.sheet.deleteRow(dtFound.rowNum);
        executed.push(type + ' (' + args[0] + ')');
      }
      else if (type === 'update_task') {
        var utId    = (args[0] || '').trim();
        var utField = (args[1] || '').trim().toLowerCase();
        var utVal   = (args[2] || '').trim();
        var utFound = findTaskRow_(utId);
        // TASK_HEADERS: ID(1) | Task(2) | Added(3) | Due Date(4) | Status(5) | Recurring(6) | Notes(7) | Flagged(8)
        var utColMap = { task: 2, text: 2, duedate: 4, notes: 7, status: 5 };
        var utCol    = utColMap[utField];
        if (!utCol) throw new Error('Unknown task field: ' + utField + '. Valid: task, dueDate, notes, status');
        utFound.sheet.getRange(utFound.rowNum, utCol).setValue(utVal);
        executed.push(type + ' (' + utId + ')');
      }

      // ---- Bills ------------------------------------------------------------
      else if (type === 'add_bill') {
        var abName = (args[0] || '').trim();
        if (!abName) throw new Error('Bill name required');
        var abSheet = getSpreadsheet().getSheetByName(TABS.BILLS);
        if (!abSheet) throw new Error('Bills tab not found');
        // BILL_HEADERS: Bill | Amount | Due Day | Frequency | Category | Account | Paid | Notes
        abSheet.getRange(abSheet.getLastRow() + 1, 1, 1, BILL_HEADERS.length).setValues([[
          abName,
          args[1] !== undefined ? (Number(args[1]) || '') : '',
          args[2] !== undefined ? (Number(args[2]) || '') : '',
          (args[3] || 'Monthly').trim(),
          (args[4] || '').trim(),
          (args[5] || '').trim(),
          '', ''
        ]]);
        executed.push(type + ' (' + abName + ')');
      }
      else if (type === 'mark_bill_paid') {
        var mbArg   = (args[0] || '').trim();
        var mbSheet = getSpreadsheet().getSheetByName(TABS.BILLS);
        if (!mbSheet || mbSheet.getLastRow() < 2) throw new Error('Bills tab is empty');
        var mbTz    = Session.getScriptTimeZone();
        var mbMonth = Utilities.formatDate(new Date(), mbTz, 'yyyy-MM');
        var mbRow   = parseInt(mbArg, 10);
        if (isNaN(mbRow) || mbRow < 2) {
          var mbVals = mbSheet.getRange(2, 1, mbSheet.getLastRow() - 1, 1).getValues();
          for (var mbi = 0; mbi < mbVals.length; mbi++) {
            if (String(mbVals[mbi][0]).toLowerCase().indexOf(mbArg.toLowerCase()) !== -1) {
              mbRow = mbi + 2; break;
            }
          }
        }
        if (!mbRow || mbRow < 2) throw new Error('Bill not found: ' + mbArg);
        var mbCell = mbSheet.getRange(mbRow, 7); // Col G = Paid
        mbCell.setValue(String(mbCell.getValue() || '').trim() === mbMonth ? '' : mbMonth);
        executed.push(type + ' (row ' + mbRow + ')');
      }

      // ---- Recipes ----------------------------------------------------------
      else if (type === 'add_recipe') {
        var arName = (args[0] || '').trim();
        if (!arName) throw new Error('Recipe name required');
        var arSheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
        if (!arSheet) throw new Error('Recipes tab not found');
        // RECIPE_HEADERS: Name | Cuisine | Servings | Prep Time | Link | Ingredients | Tags | Notes
        arSheet.getRange(arSheet.getLastRow() + 1, 1, 1, RECIPE_HEADERS.length).setValues([[
          arName,
          (args[1] || '').trim(),   // cuisine
          (args[2] || '').trim(),   // servings
          (args[3] || '').trim(),   // prep time
          '',                       // link (not supplied via chat)
          (args[4] || '').trim(),   // ingredients (semicolon-sep)
          (args[5] || '').trim(),   // tags
          ''                        // notes
        ]]);
        executed.push(type + ' (' + arName + ')');
      }
      else if (type === 'delete_recipe') {
        var drRow = parseInt(args[0], 10);
        if (isNaN(drRow) || drRow < 2) throw new Error('Invalid recipe row: ' + args[0]);
        var drSheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
        if (!drSheet) throw new Error('Recipes tab not found');
        drSheet.deleteRow(drRow);
        executed.push(type + ' (row ' + drRow + ')');
      }

      // ---- Home Items -------------------------------------------------------
      else if (type === 'add_home_item') {
        var ahItem = (args[0] || '').trim();
        if (!ahItem) throw new Error('Item name required');
        var ahSheet = getSpreadsheet().getSheetByName(TABS.HOME_ITEMS);
        if (!ahSheet) throw new Error('Home Items tab not found');
        // HOME_ITEM_HEADERS: Item | Category | Purchase Date | Warranty Expiry | Last Service | Next Service | Interval (mo) | Notes
        ahSheet.getRange(ahSheet.getLastRow() + 1, 1, 1, HOME_ITEM_HEADERS.length).setValues([[
          ahItem,
          (args[1] || '').trim(),   // category
          '',                       // purchase date (not supplied via chat)
          (args[2] || '').trim(),   // warranty expiry
          '', '',                   // last/next service
          args[3] !== undefined ? (Number(args[3]) || '') : '',  // interval months
          (args[4] || '').trim()    // notes
        ]]);
        executed.push(type + ' (' + ahItem + ')');
      }
      else if (type === 'record_home_service') {
        var rhArg   = (args[0] || '').trim();
        var rhSheet = getSpreadsheet().getSheetByName(TABS.HOME_ITEMS);
        if (!rhSheet || rhSheet.getLastRow() < 2) throw new Error('Home Items tab is empty');
        var rhRow   = parseInt(rhArg, 10);
        if (isNaN(rhRow) || rhRow < 2) {
          var rhVals = rhSheet.getRange(2, 1, rhSheet.getLastRow() - 1, 1).getValues();
          for (var rhi = 0; rhi < rhVals.length; rhi++) {
            if (String(rhVals[rhi][0]).toLowerCase().indexOf(rhArg.toLowerCase()) !== -1) {
              rhRow = rhi + 2; break;
            }
          }
        }
        if (!rhRow || rhRow < 2) throw new Error('Home item not found: ' + rhArg);
        var rhResult = webRecordService_({ parameter: { row: rhRow } });
        executed.push(type + ' (next: ' + (rhResult.nextService || 'N/A — no interval set') + ')');
      }

      // ---- Shopping ---------------------------------------------------------
      else if (type === 'add_shopping_item') {
        var asStore = (args[0] || '').trim();
        var asText  = (args[1] || '').trim();
        if (!asStore || !asText) throw new Error('Store name and item text are both required');
        var asStores = getShoppingList_();
        var asFound  = null;
        for (var asi = 0; asi < asStores.length; asi++) {
          if (asStores[asi].storeName.toLowerCase().indexOf(asStore.toLowerCase()) !== -1) {
            asFound = asStores[asi]; break;
          }
        }
        if (!asFound) throw new Error('Store not found: ' + asStore + '. Available: ' +
          asStores.map(function(s) { return s.storeName; }).join(', '));
        addShoppingItem_(asFound.tabId, asText);
        executed.push(type + ' (' + asText + ' → ' + asFound.storeName + ')');
      }

      // ---- Goals ------------------------------------------------------------
      else if (type === 'add_goal') {
        var agTitle = (args[0] || '').trim();
        if (!agTitle) throw new Error('Goal title required');
        // createGoal_(title, description, status, category, year, notes)
        createGoal_(agTitle, (args[2] || '').trim(), 'To Do', (args[1] || '').trim(), '', '');
        executed.push(type + ' (' + agTitle + ')');
      }
      else if (type === 'update_goal') {
        var ugId    = (args[0] || '').trim();
        var ugField = (args[1] || '').trim();
        var ugVal   = (args[2] || '').trim();
        if (!ugId) throw new Error('Goal ID required');
        var ugFields = {};
        ugFields[ugField] = ugVal;
        updateGoal_(ugId, ugFields);
        executed.push(type + ' (' + ugId + ')');
      }
      else if (type === 'delete_goal') {
        var dgId = (args[0] || '').trim();
        if (!dgId) throw new Error('Goal ID required');
        deleteGoal_(dgId);
        executed.push(type + ' (' + dgId + ')');
      }

      // ---- Interests --------------------------------------------------------
      else if (type === 'delete_interest') {
        var diId = (args[0] || '').trim();
        if (!diId) throw new Error('Interest ID required');
        deleteInterest_(diId);
        executed.push(type + ' (' + diId + ')');
      }

      // ---- Ideas ------------------------------------------------------------
      else if (type === 'add_idea') {
        var aiText = (args[0] || '').trim();
        if (!aiText) throw new Error('Idea text required');
        var aiSheet = getSpreadsheet().getSheetByName(TABS.IDEAS);
        if (!aiSheet) throw new Error('Ideas tab not found');
        var aiTz      = Session.getScriptTimeZone();
        var aiNow     = new Date();
        var aiDateStr = Utilities.formatDate(aiNow, aiTz, 'yyyy-MM-dd');
        var aiDateKey = Utilities.formatDate(aiNow, aiTz, 'yyyyMMdd');
        var aiLastRow = aiSheet.getLastRow();
        var aiCount   = 1;
        if (aiLastRow >= 2) {
          var aiIds = aiSheet.getRange(2, 1, aiLastRow - 1, 1).getValues();
          aiIds.forEach(function(r) {
            if (String(r[0]).indexOf('IDEA-' + aiDateKey) === 0) aiCount++;
          });
        }
        var aiId = 'IDEA-' + aiDateKey + '-' + (aiCount < 10 ? '0' + aiCount : String(aiCount));
        aiSheet.getRange(aiLastRow + 1, 1, 1, IDEA_HEADERS.length).setValues([[
          aiId, aiDateStr, aiText, (args[1] || '').trim(), (args[2] || '').trim(), '', 'New'
        ]]);
        executed.push(type + ' (' + aiId + ')');
      }
      else if (type === 'promote_idea') {
        var piId = (args[0] || '').trim();
        if (!piId) throw new Error('Idea ID required');
        var piResult = webPromoteIdea_({ parameter: { id: piId } });
        executed.push(type + ' (task: ' + piResult.taskId + ')');
      }
      else if (type === 'archive_idea') {
        var arId = (args[0] || '').trim();
        if (!arId) throw new Error('Idea ID required');
        var arFound = findIdeaRow_(arId);
        arFound.sheet.getRange(arFound.rowNum, 7).setValue('Archived');
        executed.push(type + ' (' + arId + ')');
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
 * Process a single user message (and optional image) and return VERA's reply.
 * Loads history, calls Claude, executes any actions, saves history.
 *
 * @param {string}      userMessage   - The user's text (may be empty when image is provided)
 * @param {string}      sessionId     - 'dashboard' or Telegram chatId
 * @param {string|null} imageBase64   - Optional base64-encoded image data
 * @param {string|null} imageMimeType - MIME type of image (e.g. 'image/jpeg', 'image/png')
 * @returns {{ ok: boolean, reply: string }}
 */
function processChat_(userMessage, sessionId, imageBase64, imageMimeType) {
  sessionId = sessionId || 'dashboard';

  // Allow image-only messages (no text required when an image is attached)
  if (!userMessage && !imageBase64) {
    return { ok: true, reply: 'What can I help you with?' };
  }

  var history   = loadChatHistory_(sessionId);
  var context   = buildChatContext_();
  var sysPrompt = buildChatSystemPrompt_(context);
  var rawReply  = callClaudeChat_(
    (userMessage || '').trim(), history, sysPrompt,
    imageBase64   || null,
    imageMimeType || null
  );
  Logger.log('VERA raw reply:\n' + rawReply); // visible in Apps Script Execution Log

  // Execute any actions Claude embedded
  var actionResult = executeActions_(rawReply);

  // Strip ACTION lines before returning to user
  var cleanReply = stripActions_(rawReply);

  // Surface any action failures so the user knows something went wrong
  if (actionResult.errors.length > 0) {
    cleanReply += '\n\n⚠️ Note: some actions could not be completed — ' + actionResult.errors.join('; ') + '.';
  }

  // Persist this exchange — store [Image attached] placeholder, NEVER raw base64
  // (Script Properties have a 9 KB-per-property limit; base64 images are 100 KB+)
  var historyText = (userMessage || '').trim();
  if (imageBase64) historyText = (historyText ? historyText + ' ' : '') + '[Image attached]';
  saveChatHistory_(sessionId, historyText, cleanReply);

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
