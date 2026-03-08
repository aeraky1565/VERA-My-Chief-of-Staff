// ============================================================
// VERA — Web App Endpoint (Phase 2)
// WebApp.js — JSON API bridge for the React dashboard
// ============================================================
//
// HOW TO DEPLOY:
//   1. In Apps Script editor: Deploy > New deployment
//   2. Type: Web App
//   3. Execute as: Me
//   4. Who has access: Anyone
//   5. Click Deploy — copy the Web App URL
//   6. Set VERA_WEB_TOKEN in Script Properties (any random string)
//      All requests must include ?token=YOUR_TOKEN
//
// GET endpoints (all operations use GET to avoid CORS preflight):
//   ?action=status               → flag counts + last run date
//   ?action=flags                → all flags
//   ?action=flags&filter=active  → unacknowledged + unresolved only
//   ?action=tasks                → open tasks
//   ?action=summaries            → summaries tab
//   ?action=acknowledge&id=FLAG-xxx
//   ?action=snooze&id=FLAG-xxx&days=2
//   ?action=resolve&id=FLAG-xxx
//   ?action=chat&message=...&session=dashboard  → VERA chat (Phase 4)
//
// POST endpoints:
//   { action: 'acknowledge'|'snooze'|'resolve', id: '...', days?: N }
//   Telegram webhook POSTs are detected automatically (no token needed)
// ============================================================

// ---- Auth ------------------------------------------------------------------

function getWebToken_() {
  return PropertiesService.getScriptProperties().getProperty('VERA_WEB_TOKEN') || '';
}

function isAuthorized_(e) {
  const token = getWebToken_();
  if (!token) return false;                               // No token = locked
  return (e && e.parameter && e.parameter.token) === token;
}

// ---- Response helpers ------------------------------------------------------

function jsonOut_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function errOut_(msg, code) {
  return jsonOut_({ ok: false, error: msg, code: code || 400 });
}

// ---- doGet — all operations (GET avoids CORS preflight from file://) -------

function doGet(e) {
  if (!isAuthorized_(e)) return errOut_('Unauthorized', 401);

  const action = (e.parameter && e.parameter.action) || 'status';
  const id     = e.parameter && e.parameter.id;
  const days   = e.parameter && e.parameter.days;

  try {
    switch (action) {
      case 'status':      return jsonOut_(webGetStatus_());
      case 'flags':       return jsonOut_(webGetFlags_(e));
      case 'tasks':       return jsonOut_(webGetTasks_());
      case 'summaries':   return jsonOut_(webGetSummaries_());
      case 'acknowledge':    return jsonOut_(webAcknowledge_(id));
      case 'snooze':         return jsonOut_(webSnooze_(id, days));
      case 'resolve':        return jsonOut_(webResolve_(id));
      case 'complete_task':         return jsonOut_(webCompleteTask_(id));
      case 'add_task':              return jsonOut_(webAddTask_(e));
      case 'update_task':           return jsonOut_(webUpdateTask_(e));
      case 'shopping':        return jsonOut_(webGetShopping_());
      case 'shopping_toggle': return jsonOut_(webToggleShoppingItem_(e));
      case 'projects':              return jsonOut_(webGetProjects_());
      case 'complete_project_task': return jsonOut_(webCompleteProjectTask_(e.parameter.row));
      case 'add_project_task':      return jsonOut_(webAddProjectTask_(e));
      case 'update_project_task':   return jsonOut_(webUpdateProjectTask_(e));
      case 'delete_project_task':   return jsonOut_(webDeleteProjectTask_(e));
      case 'pto':                   return jsonOut_(webGetPTO_());
      case 'pto_trigger_buffer':    return jsonOut_(webTriggerBuffer_(e));
      case 'chat':                  return jsonOut_(webProcessChat_(e));
      default:               return errOut_('Unknown action: ' + action);
    }
  } catch (err) {
    Logger.log('doGet error: ' + err.message + '\n' + err.stack);
    return errOut_('Server error: ' + err.message, 500);
  }
}

// ---- doPost — Telegram webhook + write operations --------------------------

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    return errOut_('Invalid JSON body: ' + parseErr.message);
  }

  // Telegram sends webhook POSTs without a token — detect by update_id field.
  // processTelegramUpdate_ sends "⏳ Thinking..." immediately via UrlFetchApp so
  // the user sees instant feedback, then edits the message with Claude's real answer.
  // Deduplication (CacheService) inside processTelegramUpdate_ prevents retry loops.
  if (body && body.update_id !== undefined) {
    try {
      processTelegramUpdate_(body);
    } catch (err) {
      Logger.log('Telegram processing error: ' + err.message);
    }
    return jsonOut_({ ok: true });
  }

  // VERA dashboard actions require auth
  if (!isAuthorized_(e)) return errOut_('Unauthorized', 401);

  const action = body && body.action;

  try {
    switch (action) {
      case 'acknowledge': return jsonOut_(webAcknowledge_(body.id));
      case 'snooze':      return jsonOut_(webSnooze_(body.id, body.days));
      case 'resolve':     return jsonOut_(webResolve_(body.id));
      default:            return errOut_('Unknown action: ' + action);
    }
  } catch (err) {
    Logger.log('doPost error: ' + err.message + '\n' + err.stack);
    return errOut_('Server error: ' + err.message, 500);
  }
}

// ============================================================
// READ HANDLERS
// ============================================================

// ---- Status ----------------------------------------------------------------

function webGetStatus_() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.FLAGS);

  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: true, totalFlags: 0, activeFlags: 0, high: 0, medium: 0, low: 0, lastRun: null };
  }

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();
  const all     = data.filter(function(r) { return r[0] !== ''; });

  const active = all.filter(function(r) {
    return String(r[6]).toLowerCase() !== 'yes' &&
           String(r[8]).toLowerCase() !== 'yes';
  });

  // Most recent flag date = last run approximation
  const lastRun = all.length > 0 ? all[all.length - 1][1] : null;

  return {
    ok:          true,
    totalFlags:  all.length,
    activeFlags: active.length,
    high:        active.filter(function(r) { return r[5] === 'High';   }).length,
    medium:      active.filter(function(r) { return r[5] === 'Medium'; }).length,
    low:         active.filter(function(r) { return r[5] === 'Low';    }).length,
    lastRun:     formatDateVal_(lastRun),
  };
}

// ---- Flags -----------------------------------------------------------------

function webGetFlags_(e) {
  const filter = e.parameter && e.parameter.filter; // 'active' or omit for all
  const ss     = getSpreadsheet();
  const sheet  = ss.getSheetByName(TABS.FLAGS);

  if (!sheet || sheet.getLastRow() < 2) return { ok: true, flags: [] };

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();
  let rows      = data.filter(function(r) { return r[0] !== ''; });

  if (filter === 'active') {
    rows = rows.filter(function(r) {
      return String(r[6]).toLowerCase() !== 'yes' &&
             String(r[8]).toLowerCase() !== 'yes';
    });
  }

  const flags = rows.map(function(r) {
    return {
      id:           String(r[0]),
      date:         formatDateVal_(r[1]),
      source:       String(r[2] || ''),
      flag:         String(r[3] || ''),
      reason:       String(r[4] || ''),
      urgency:      String(r[5] || 'Low'),
      acknowledged: String(r[6]).toLowerCase() === 'yes',
      snoozedUntil: formatDateVal_(r[7]),
      resolved:     String(r[8]).toLowerCase() === 'yes',
      key:          String(r[9] || ''),
    };
  });

  return { ok: true, count: flags.length, flags: flags };
}

// ---- Tasks -----------------------------------------------------------------

function webGetTasks_() {
  const tasks = getOpenTasks(); // reuse Tasks.js
  return { ok: true, count: tasks.length, tasks: tasks };
}

// ---- Summaries -------------------------------------------------------------

function webGetSummaries_() {
  // Read Summaries tab only (life intelligence: SAT, Transactions, external sheets).
  // Metrics tab (VERA's internal counts) is intentionally excluded from the dashboard.
  const ss        = getSpreadsheet();
  const summaries = readSummaryTab_(ss, TABS.SUMMARIES);
  return { ok: true, count: summaries.length, summaries: summaries };
}

// ============================================================
// WRITE HANDLERS
// ============================================================

// ---- Find a flag row by ID -------------------------------------------------

function findFlagRow_(id) {
  if (!id) throw new Error('Missing flag ID');

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.FLAGS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Flags sheet is empty');

  const numRows = sheet.getLastRow() - 1;
  const ids     = sheet.getRange(2, 1, numRows, 1).getValues();

  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) {
      return { sheet: sheet, rowNum: i + 2 };
    }
  }
  throw new Error('Flag not found: ' + id);
}

// ---- Acknowledge -----------------------------------------------------------

function webAcknowledge_(id) {
  const found = findFlagRow_(id);
  found.sheet.getRange(found.rowNum, 7).setValue('Yes'); // Column G
  return { ok: true, id: id, action: 'acknowledged' };
}

// ---- Snooze ----------------------------------------------------------------

function webSnooze_(id, days) {
  const found     = findFlagRow_(id);
  const snoozeFor = Math.max(1, parseInt(days, 10) || 2);
  const until     = new Date();
  until.setDate(until.getDate() + snoozeFor);
  const untilStr  = Utilities.formatDate(until, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  found.sheet.getRange(found.rowNum, 8).setValue(untilStr); // Column H
  return { ok: true, id: id, action: 'snoozed', snoozedUntil: untilStr };
}

// ---- Resolve ---------------------------------------------------------------

function webResolve_(id) {
  const found = findFlagRow_(id);
  found.sheet.getRange(found.rowNum, 9).setValue('Yes'); // Column I
  return { ok: true, id: id, action: 'resolved' };
}

// ---- Complete task ----------------------------------------------------------

function findTaskRow_(id) {
  if (!id) throw new Error('Missing task ID');

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.TASKS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Tasks sheet is empty');

  // Row-based fallback ID (tasks without a Column A value get TASK-R{sheetRow})
  if (String(id).indexOf('TASK-R') === 0) {
    const rowNum = parseInt(String(id).substring(6), 10);
    if (!isNaN(rowNum) && rowNum >= 2) return { sheet: sheet, rowNum: rowNum };
    throw new Error('Invalid row-based task ID: ' + id);
  }

  // Normal: search Column A for the explicit ID
  const numRows = sheet.getLastRow() - 1;
  const ids     = sheet.getRange(2, 1, numRows, 1).getValues();

  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) {
      return { sheet: sheet, rowNum: i + 2 };
    }
  }
  throw new Error('Task not found: ' + id);
}

function webCompleteTask_(id) {
  const found = findTaskRow_(id);
  found.sheet.getRange(found.rowNum, 5).setValue('Done'); // Column E = Status
  return { ok: true, id: id, action: 'completed' };
}

// ---- Add / Update task -----------------------------------------------------

function webAddTask_(e) {
  const taskText = ((e.parameter && e.parameter.task)    || '').trim();
  const dueDate  =  (e.parameter && e.parameter.dueDate) || '';
  const notes    =  (e.parameter && e.parameter.notes)   || '';
  if (!taskText) throw new Error('Task text is required');

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.TASKS);
  if (!sheet) throw new Error('Tasks sheet not found');

  // Generate ID: TASK-YYYYMMDD-NN
  const tz      = Session.getScriptTimeZone();
  const today   = new Date();
  const dateStr = Utilities.formatDate(today, tz, 'yyyyMMdd');
  const addedStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  let seq = 1;
  if (sheet.getLastRow() >= 2) {
    const idData = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    idData.forEach(function(r) {
      if (String(r[0] || '').indexOf('TASK-' + dateStr) === 0) seq++;
    });
  }
  const taskId = 'TASK-' + dateStr + '-' + String(seq).padStart(2, '0');

  // TASK_HEADERS: ID | Task | Added Date | Due Date | Status | Recurring | Notes | Flagged
  const row = [taskId, taskText, addedStr, dueDate, 'Open', '', notes, ''];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, TASK_HEADERS.length).setValues([row]);

  return { ok: true, id: taskId, action: 'created' };
}

function webUpdateTask_(e) {
  const id      = (e.parameter && e.parameter.id)      || '';
  const found   = findTaskRow_(id);

  // TASK_HEADERS: ID(1) | Task(2) | Added Date(3) | Due Date(4) | Status(5) | Recurring(6) | Notes(7) | Flagged(8)
  if (e.parameter.task    != null) found.sheet.getRange(found.rowNum, 2).setValue(e.parameter.task);
  if (e.parameter.dueDate != null) found.sheet.getRange(found.rowNum, 4).setValue(e.parameter.dueDate);
  if (e.parameter.notes   != null) found.sheet.getRange(found.rowNum, 7).setValue(e.parameter.notes);

  return { ok: true, id: id, action: 'updated' };
}

// ---- Shopping --------------------------------------------------------------

function webGetShopping_() {
  const stores = getShoppingList_();
  return { ok: true, count: stores.length, stores: stores };
}

function webToggleShoppingItem_(e) {
  const tabId = (e.parameter && e.parameter.tabId) || '';
  const index = (e.parameter && e.parameter.index) || 0;
  return toggleShoppingItem_(tabId, index);
}

// ---- Projects --------------------------------------------------------------

function webGetProjects_() {
  const projects = getProjects_();
  return { ok: true, count: projects.length, projects: projects };
}

function webCompleteProjectTask_(rowNum) {
  return completeProjectTask_(rowNum);
}

function webAddProjectTask_(e) {
  var projectId = ((e.parameter && e.parameter.projectId) || '').trim();
  var taskText  = ((e.parameter && e.parameter.task)      || '').trim();
  var priority  = ((e.parameter && e.parameter.priority)  || 'Medium').trim();
  var dueDate   =  (e.parameter && e.parameter.dueDate)   || '';
  var notes     =  (e.parameter && e.parameter.notes)     || '';
  if (!projectId) throw new Error('projectId is required');
  if (!taskText)  throw new Error('Task text is required');

  var sheet = getSpreadsheet().getSheetByName(TABS.PROJECTS);
  if (!sheet) throw new Error('Projects tab not found');

  // Look up project name from existing rows
  var projectName = '';
  if (sheet.getLastRow() >= 2) {
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === projectId) { projectName = data[i][1]; break; }
    }
  }
  if (!projectName) throw new Error('Project not found: ' + projectId);

  // PROJECT_HEADERS: Project ID | Project Name | Task | Status | Priority | Due Date | Notes
  var row = [projectId, projectName, taskText, 'Pending', priority, dueDate, notes];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, PROJECT_HEADERS.length).setValues([row]);
  return { ok: true, projectId: projectId, action: 'created' };
}

function webUpdateProjectTask_(e) {
  var rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row: ' + e.parameter.row);

  var sheet = getSpreadsheet().getSheetByName(TABS.PROJECTS);
  if (!sheet) throw new Error('Projects tab not found');

  // PROJ_COL is 0-indexed; sheet columns are 1-indexed (PROJ_COL.X + 1)
  if (e.parameter.task     != null) sheet.getRange(rowNum, PROJ_COL.TASK     + 1).setValue(e.parameter.task);
  if (e.parameter.priority != null) sheet.getRange(rowNum, PROJ_COL.PRIORITY + 1).setValue(e.parameter.priority);
  if (e.parameter.dueDate  != null) sheet.getRange(rowNum, PROJ_COL.DUE      + 1).setValue(e.parameter.dueDate);
  if (e.parameter.notes    != null) sheet.getRange(rowNum, PROJ_COL.NOTES    + 1).setValue(e.parameter.notes);

  return { ok: true, rowNum: rowNum, action: 'updated' };
}

function webDeleteProjectTask_(e) {
  var rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row: ' + e.parameter.row);

  var sheet = getSpreadsheet().getSheetByName(TABS.PROJECTS);
  if (!sheet) throw new Error('Projects tab not found');

  sheet.deleteRow(rowNum);
  return { ok: true, rowNum: rowNum, action: 'deleted' };
}

// ---- PTO -------------------------------------------------------------------

/**
 * Returns live PTO stats computed fresh from Google Calendar.
 * Called by the 🌴 PTO tab on dashboard open.
 */
function webGetPTO_() {
  var cfg      = readPTOConfig_();
  var ptoResult = getPTOEvents_(cfg);
  var travel   = getUpcomingTravel_(cfg);
  var gapCals  = getGapCalendars_(cfg);
  var today    = new Date();
  var stats    = computePTOStats_(ptoResult, cfg, today);

  // Attach live clear windows + milestones (may have changed since last nightly run)
  stats.clearWindows  = findClearWindows_(gapCals, today, 90, 3);
  stats.milestones    = getMilestones_(gapCals, cfg, today);
  stats.upcomingTravel = travel;

  return { ok: true, stats: stats };
}

/**
 * Decrements the PTO buffer-remaining count in the Config tab by 1.
 * Called when Ahmed clicks "Trigger a Buffer Day" in the dashboard.
 * Returns the new remaining count and the date triggered.
 */
function webTriggerBuffer_(e) {
  var cfg       = readPTOConfig_();
  var current   = readPTOBufferRemaining_(cfg);

  if (current <= 0) {
    return { ok: false, error: 'No buffer days remaining.', remaining: 0 };
  }

  var newVal = current - 1;
  setPTOBufferRemaining_(newVal);

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  Logger.log('PTO Buffer Day triggered. Remaining: ' + newVal + '. Date: ' + today);

  return { ok: true, remaining: newVal, triggeredOn: today };
}

// ---- Chat ------------------------------------------------------------------

function webProcessChat_(e) {
  const message   = (e.parameter && e.parameter.message)  || '';
  const sessionId = (e.parameter && e.parameter.session)  || 'dashboard';
  return processChat_(message, sessionId);
}

// ============================================================
// UTILITIES
// ============================================================

function formatDateVal_(val) {
  if (!val || val === '') return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val);
}
