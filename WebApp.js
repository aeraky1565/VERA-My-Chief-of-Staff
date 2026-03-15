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
      case 'shopping_add':    return jsonOut_(webAddShoppingItem_(e));
      case 'projects':              return jsonOut_(webGetProjects_());
      case 'complete_project_task': return jsonOut_(webCompleteProjectTask_(e.parameter.row));
      case 'add_project_task':      return jsonOut_(webAddProjectTask_(e));
      case 'update_project_task':   return jsonOut_(webUpdateProjectTask_(e));
      case 'delete_project_task':   return jsonOut_(webDeleteProjectTask_(e));
      case 'goals':        return jsonOut_(webGetGoals_());
      case 'add_goal':    return jsonOut_(webAddGoal_(e));
      case 'update_goal': return jsonOut_(webUpdateGoal_(e));
      case 'delete_goal': return jsonOut_(webDeleteGoal_(e));
      case 'interests':        return jsonOut_(webGetInterests_());
      case 'interests_add':    return jsonOut_(webAddInterest_(e));
      case 'interests_delete': return jsonOut_(webDeleteInterest_(e));
      case 'pto':                   return jsonOut_(webGetPTO_());
      case 'pto_trigger_buffer':    return jsonOut_(webTriggerBuffer_(e));
      case 'budget':                return jsonOut_(webGetBudget_());
      case 'bills':                 return jsonOut_(webGetBills_());
      case 'bills_toggle':          return jsonOut_(webToggleBill_(e));
      case 'recipes':               return jsonOut_(webGetRecipes_());
      case 'recipe_to_shopping':    return jsonOut_(webRecipeToShopping_(e));
      case 'homesteward':           return jsonOut_(webGetHomesteward_());
      case 'homesteward_service':   return jsonOut_(webRecordService_(e));
      case 'delete_task':           return jsonOut_(webDeleteTask_(id));
      case 'add_bill':              return jsonOut_(webAddBill_(e));
      case 'add_recipe':            return jsonOut_(webAddRecipe_(e));
      case 'delete_recipe':         return jsonOut_(webDeleteRecipe_(e));
      case 'add_home_item':         return jsonOut_(webAddHomeItem_(e));
      case 'delete_home_item':      return jsonOut_(webDeleteHomeItem_(e));
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
    // Return 200 OK immediately so Telegram never times out waiting for Claude.
    // Queue the update in ScriptCache and fire a one-shot trigger to process it.
    // Without this, the 10-20s Claude call causes Telegram to retry the delivery,
    // creating concurrent executions that result in a 302 on the next message.
    try {
      var sc  = CacheService.getScriptCache();
      var qId = String(body.update_id);
      sc.put('TG_Q_' + qId, JSON.stringify(body), 120);
      var existing = sc.get('TG_Q_IDS') || '';
      sc.put('TG_Q_IDS', existing ? existing + ',' + qId : qId, 120);
      // One trigger at a time — delete any existing queue trigger first
      ScriptApp.getProjectTriggers().forEach(function(t) {
        if (t.getHandlerFunction() === 'processTelegramQueue_') ScriptApp.deleteTrigger(t);
      });
      ScriptApp.newTrigger('processTelegramQueue_').timeBased().after(100).create();
    } catch (qErr) {
      // Fallback: process synchronously if queuing/trigger creation fails
      Logger.log('Queue fallback (sync): ' + qErr.message);
      try { processTelegramUpdate_(body); } catch (e) { Logger.log('Sync error: ' + e.message); }
    }
    return jsonOut_({ ok: true });
  }

  // VERA dashboard actions require auth
  if (!isAuthorized_(e)) return errOut_('Unauthorized', 401);

  const action = body && body.action;

  try {
    switch (action) {
      case 'chat':        return jsonOut_(webProcessChat_(body));
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

function webDeleteTask_(id) {
  const found = findTaskRow_(id);
  found.sheet.deleteRow(found.rowNum);
  return { ok: true, id: id, action: 'deleted' };
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

function webAddShoppingItem_(e) {
  const tabId = ((e.parameter && e.parameter.tabId) || '').trim();
  const text  = ((e.parameter && e.parameter.text)  || '').trim();
  if (!tabId || !text) throw new Error('tabId and text are required.');
  return addShoppingItem_(tabId, text);
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

// ---- Budget (Simple Ass Tracker) -------------------------------------------

/**
 * Reads the entire Budget tab from Simple Ass Tracker and returns structured rows.
 * Col A = label, Col B = value (empty → section header), Col C = Ahmed, Col D = Victoria.
 * SAT_SHEET_ID must be set in Script Properties.
 */
function webGetBudget_() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SAT_SHEET_ID');
  if (!sheetId) return { ok: true, rows: [], configured: false };

  try {
    var ss    = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('Budget');
    if (!sheet) return { ok: true, rows: [], configured: false, error: 'Budget tab not found' };

    var lastRow = sheet.getLastRow();
    if (lastRow < 1) return { ok: true, rows: [], configured: true };

    var numCols = Math.min(sheet.getLastColumn(), 4); // A-D: label, value, ahmed, victoria
    var data    = sheet.getRange(1, 1, lastRow, numCols).getValues();

    var rows = [];
    data.forEach(function(row) {
      var label = String(row[0] || '').trim();
      if (!label) return; // skip fully empty rows
      rows.push({
        label:    label,
        value:    (row.length > 1 && row[1] !== '') ? row[1] : null,
        ahmed:    (row.length > 2 && row[2] !== '') ? row[2] : null,
        victoria: (row.length > 3 && row[3] !== '') ? row[3] : null,
      });
    });

    return { ok: true, rows: rows, configured: true };
  } catch (err) {
    Logger.log('webGetBudget_ error: ' + err.message);
    return { ok: false, error: err.message, rows: [] };
  }
}

// ---- Bills (Issue #57) -----------------------------------------------------

/**
 * Returns all rows from the Bills tab in the Life OS sheet.
 * Columns: A=Bill, B=Amount, C=Due Day, D=Frequency, E=Category,
 *          F=Account, G=Paid (YYYY-MM), H=Notes
 * paid = true when Paid column equals current YYYY-MM (auto-resets each month).
 */
function webGetBills_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BILLS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, bills: [] };

  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, BILL_HEADERS.length).getValues();

  var tz        = Session.getScriptTimeZone();
  var currMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');

  var bills = [];
  data.forEach(function(row, idx) {
    var bill = String(row[0] || '').trim();
    if (!bill) return;
    var paidVal = String(row[6] || '').trim();
    bills.push({
      row:       idx + 2,
      bill:      bill,
      amount:    row[1] !== '' ? Number(row[1]) : null,
      dueDay:    row[2] !== '' ? Number(row[2]) : null,
      frequency: String(row[3] || 'Monthly').trim(),
      category:  String(row[4] || '').trim(),
      account:   String(row[5] || '').trim(),
      paid:      paidVal === currMonth,
      notes:     String(row[7] || '').trim(),
    });
  });

  return { ok: true, bills: bills, currentMonth: currMonth };
}

/**
 * Toggles the Paid status of a bill for the current month.
 * If already paid this month → clears the field.
 * If not paid → sets to current YYYY-MM.
 */
function webToggleBill_(e) {
  var rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row: ' + e.parameter.row);

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BILLS);
  if (!sheet) throw new Error('Bills tab not found');

  var tz        = Session.getScriptTimeZone();
  var currMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');

  var cell    = sheet.getRange(rowNum, 7); // Column G = Paid
  var current = String(cell.getValue() || '').trim();
  var newVal  = (current === currMonth) ? '' : currMonth;

  cell.setValue(newVal);
  return { ok: true, row: rowNum, paid: newVal !== '' };
}

function webAddBill_(e) {
  const p        = e.parameter || {};
  const billName = (p.bill || p.name || '').trim();
  if (!billName) throw new Error('Bill name is required');
  const sheet = getSpreadsheet().getSheetByName(TABS.BILLS);
  if (!sheet) throw new Error('Bills tab not found');
  // BILL_HEADERS: Bill | Amount | Due Day | Frequency | Category | Account | Paid | Notes
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, BILL_HEADERS.length).setValues([[
    billName,
    p.amount  !== undefined ? (Number(p.amount)  || '') : '',
    p.dueDay  !== undefined ? (Number(p.dueDay)  || '') : '',
    (p.frequency || 'Monthly').trim(),
    (p.category  || '').trim(),
    (p.account   || '').trim(),
    '',
    (p.notes     || '').trim(),
  ]]);
  return { ok: true, bill: billName, action: 'created' };
}

// ---- Recipes (Issue #46) ---------------------------------------------------

function webGetRecipes_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.RECIPES);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, recipes: [] };
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, RECIPE_HEADERS.length).getValues();
  var recipes = [];
  data.forEach(function(row, idx) {
    var name = String(row[0] || '').trim();
    if (!name) return;
    recipes.push({
      row:         idx + 2,
      name:        name,
      cuisine:     String(row[1] || '').trim(),
      servings:    row[2] !== '' ? String(row[2]).trim() : null,
      prepTime:    String(row[3] || '').trim(),
      link:        String(row[4] || '').trim(),
      ingredients: String(row[5] || '').trim(),
      tags:        String(row[6] || '').trim(),
      notes:       String(row[7] || '').trim(),
    });
  });
  return { ok: true, recipes: recipes };
}

function webRecipeToShopping_(e) {
  var rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.RECIPES);
  if (!sheet) throw new Error('Recipes tab not found');
  var raw = String(sheet.getRange(rowNum, 6).getValue() || '').trim(); // Col F = Ingredients
  if (!raw) return { ok: false, error: 'No ingredients listed for this recipe.' };
  var ingredients = raw.split(';').map(function(s) { return s.trim(); }).filter(Boolean);
  return addRecipeIngredients_(ingredients);
}

function webAddRecipe_(e) {
  const p    = e.parameter || {};
  const name = (p.name || '').trim();
  if (!name) throw new Error('Recipe name is required');
  const sheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
  if (!sheet) throw new Error('Recipes tab not found');
  // RECIPE_HEADERS: Name | Cuisine | Servings | Prep Time | Link | Ingredients | Tags | Notes
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, RECIPE_HEADERS.length).setValues([[
    name,
    (p.cuisine      || '').trim(),
    (p.servings     || '').trim(),
    (p.prepTime     || '').trim(),
    (p.link         || '').trim(),
    (p.ingredients  || '').trim(),
    (p.tags         || '').trim(),
    (p.notes        || '').trim(),
  ]]);
  return { ok: true, name: name, action: 'created' };
}

function webDeleteRecipe_(e) {
  const rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row: ' + rowNum);
  const sheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
  if (!sheet) throw new Error('Recipes tab not found');
  sheet.deleteRow(rowNum);
  return { ok: true, row: rowNum, action: 'deleted' };
}

// ---- Home Steward (Issue #21) ----------------------------------------------

function webGetHomesteward_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HOME_ITEMS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, items: [] };
  var data  = sheet.getRange(2, 1, sheet.getLastRow() - 1, HOME_ITEM_HEADERS.length).getValues();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var tz    = Session.getScriptTimeZone();

  function fmtDate(v) {
    if (!v) return '';
    try { return Utilities.formatDate(new Date(v), tz, 'yyyy-MM-dd'); } catch (ex) { return ''; }
  }
  function daysDiff(v) {
    if (!v) return null;
    try { var d = new Date(v); return Math.round((d - today) / 86400000); } catch (ex) { return null; }
  }

  var items = [];
  data.forEach(function(row, idx) {
    var item = String(row[0] || '').trim();
    if (!item) return;
    items.push({
      row:            idx + 2,
      item:           item,
      category:       String(row[1] || '').trim(),
      purchaseDate:   fmtDate(row[2]),
      warrantyExpiry: fmtDate(row[3]),
      lastService:    fmtDate(row[4]),
      nextService:    fmtDate(row[5]),
      intervalMonths: row[6] !== '' ? Number(row[6]) : null,
      notes:          String(row[7] || '').trim(),
      warrantyDays:   daysDiff(row[3]),
      serviceDays:    daysDiff(row[5]),
    });
  });
  return { ok: true, items: items };
}

function webRecordService_(e) {
  var rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HOME_ITEMS);
  if (!sheet) throw new Error('Home Items tab not found');

  var tz       = Session.getScriptTimeZone();
  var today    = new Date();
  var todayStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');
  sheet.getRange(rowNum, 5).setValue(todayStr); // Col E = Last Service

  var interval = Number(sheet.getRange(rowNum, 7).getValue() || 0); // Col G = Interval
  var nextStr  = '';
  var eventId  = '';

  if (interval > 0) {
    var next = new Date(today);
    next.setMonth(next.getMonth() + interval);
    nextStr = Utilities.formatDate(next, tz, 'yyyy-MM-dd');
    sheet.getRange(rowNum, 6).setValue(nextStr); // Col F = Next Service
    var itemName = String(sheet.getRange(rowNum, 1).getValue() || 'Item');
    var calEvent = CalendarApp.getDefaultCalendar().createAllDayEvent(
      '🔧 Service: ' + itemName, next,
      { description: 'VERA scheduled service reminder for ' + itemName }
    );
    eventId = calEvent.getId();
  }
  return { ok: true, lastService: todayStr, nextService: nextStr, calEventId: eventId };
}

function webAddHomeItem_(e) {
  const p    = e.parameter || {};
  const item = (p.item || p.name || '').trim();
  if (!item) throw new Error('Item name is required');
  const sheet = getSpreadsheet().getSheetByName(TABS.HOME_ITEMS);
  if (!sheet) throw new Error('Home Items tab not found');
  // HOME_ITEM_HEADERS: Item | Category | Purchase Date | Warranty Expiry | Last Service | Next Service | Interval (mo) | Notes
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, HOME_ITEM_HEADERS.length).setValues([[
    item,
    (p.category       || '').trim(),
    (p.purchaseDate   || '').trim(),
    (p.warrantyExpiry || '').trim(),
    '',   // Last Service
    '',   // Next Service
    p.intervalMonths !== undefined ? (Number(p.intervalMonths) || '') : '',
    (p.notes || '').trim(),
  ]]);
  return { ok: true, item: item, action: 'created' };
}

function webDeleteHomeItem_(e) {
  const rowNum = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row: ' + rowNum);
  const sheet = getSpreadsheet().getSheetByName(TABS.HOME_ITEMS);
  if (!sheet) throw new Error('Home Items tab not found');
  sheet.deleteRow(rowNum);
  return { ok: true, row: rowNum, action: 'deleted' };
}

// ---- Chat ------------------------------------------------------------------

/**
 * Chat handler — accepts both GET (text-only, existing path) and POST (with optional image).
 * @param {Object} source - Either the Apps Script event `e` (GET) or a parsed POST body object
 */
function webProcessChat_(source) {
  // GET: params are in source.parameter; POST: params are top-level on the body object
  const message       = source.message       || (source.parameter && source.parameter.message)  || '';
  const sessionId     = source.session       || (source.parameter && source.parameter.session)  || 'dashboard';
  const imageBase64   = source.imageBase64   || null;
  const imageMimeType = source.imageMimeType || null;
  return processChat_(message, sessionId, imageBase64, imageMimeType);
}

// ============================================================
// UTILITIES
// ============================================================

// ---- Goals (Yearly Goals Kanban) -------------------------------------------

function webGetGoals_() {
  const goals = getGoals_();
  return { ok: true, count: goals.length, goals: goals };
}

function webAddGoal_(e) {
  const p = e.parameter || {};
  const goal = createGoal_(
    p.title || '',
    p.description || '',
    p.status || 'To Do',
    p.category || '',
    p.year || '',
    p.notes || ''
  );
  return { ok: true, goal: goal };
}

function webUpdateGoal_(e) {
  const p  = e.parameter || {};
  const id = (p.id || '').trim();
  if (!id) throw new Error('Goal ID is required');

  const fields = {};
  ['title', 'description', 'status', 'category', 'year', 'progress', 'notes'].forEach(function(k) {
    if (p[k] != null) fields[k] = p[k];
  });

  const updated = updateGoal_(id, fields);
  if (!updated) return { ok: false, error: 'Goal not found: ' + id };
  return { ok: true, goal: updated };
}

function webDeleteGoal_(e) {
  const id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) throw new Error('Goal ID is required');
  const deleted = deleteGoal_(id);
  return { ok: deleted, id: id, action: 'deleted' };
}

// ---- Shared Interest Ledger (Issue #28) ------------------------------------

function webGetInterests_() {
  const interests = getSharedInterestLedger_();
  return { ok: true, count: interests.length, interests: interests };
}

function webAddInterest_(e) {
  const p        = e.parameter || {};
  const person   = (p.person   || 'Ahmed').trim();
  const interest = (p.interest || '').trim();
  const category = (p.category || 'Other').trim();
  const notes    = (p.notes    || '').trim();
  if (!interest) throw new Error('Interest text is required.');
  const created = createInterest_(person, interest, category, 'Manual', notes);
  return { ok: true, interest: created };
}

function webDeleteInterest_(e) {
  const id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) throw new Error('Interest ID is required.');
  const archived = deleteInterest_(id);
  return { ok: archived, id: id, action: 'archived' };
}

function formatDateVal_(val) {
  if (!val || val === '') return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val);
}
