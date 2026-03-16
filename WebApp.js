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
      case 'ideas':                 return jsonOut_(webGetIdeas_());
      case 'add_idea':              return jsonOut_(webAddIdea_(e));
      case 'update_idea':           return jsonOut_(webUpdateIdea_(e));
      case 'delete_idea':           return jsonOut_(webDeleteIdea_(e));
      case 'promote_idea':          return jsonOut_(webPromoteIdea_(e));
      case 'delete_task':           return jsonOut_(webDeleteTask_(id));
      case 'add_bill':              return jsonOut_(webAddBill_(e));
      case 'add_recipe':            return jsonOut_(webAddRecipe_(e));
      case 'delete_recipe':         return jsonOut_(webDeleteRecipe_(e));
      case 'add_home_item':         return jsonOut_(webAddHomeItem_(e));
      case 'delete_home_item':      return jsonOut_(webDeleteHomeItem_(e));
      case 'itinerary':             return jsonOut_(webGetItinerary_(e));
      case 'add_itinerary_item':    return jsonOut_(webAddItineraryItem_(e));
      case 'update_itinerary_item': return jsonOut_(webUpdateItineraryItem_(e));
      case 'delete_itinerary_item': return jsonOut_(webDeleteItineraryItem_(e));
      case 'get_trip_meta':         return jsonOut_(webGetTripMeta_(e));
      case 'set_trip_meta':         return jsonOut_(webSetTripMeta_(e));
      case 'get_packing':           return jsonOut_(webGetPacking_(e));
      case 'add_packing_item':      return jsonOut_(webAddPackingItem_(e));
      case 'update_packing_item':   return jsonOut_(webUpdatePackingItem_(e));
      case 'delete_packing_item':   return jsonOut_(webDeletePackingItem_(e));
      case 'generate_packing':      return jsonOut_(webGeneratePacking_(e));
      case 'countries':             return jsonOut_(webGetCountries_());
      case 'add_country':           return jsonOut_(webAddCountry_(e));
      case 'delete_country':        return jsonOut_(webDeleteCountry_(e));
      case 'get_bucket_list':       return jsonOut_(webGetBucketList_());
      case 'add_bucket_item':       return jsonOut_(webAddBucketItem_(e));
      case 'update_bucket_item':    return jsonOut_(webUpdateBucketItem_(e));
      case 'delete_bucket_item':    return jsonOut_(webDeleteBucketItem_(e));
      case 'flight_statuses':       return jsonOut_(webGetFlightStatuses_(e));
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

  // Read all travel_* keys from Config tab into a travelConfig map
  // Supports: travel_transit_buffer, travel_customs_buffer,
  //           travel_transit_buffer_IAD, travel_customs_buffer_DCA, etc.
  var travelConfig = { transit_buffer: 120, customs_buffer: 60 };
  try {
    var cfgSheet = ss.getSheetByName(TABS.CONFIG);
    if (cfgSheet) {
      var cfgData = cfgSheet.getDataRange().getValues();
      for (var ci = 0; ci < cfgData.length; ci++) {
        var cfgKey = String(cfgData[ci][0]).trim();
        var cfgVal = parseInt(String(cfgData[ci][1]).trim(), 10);
        if (cfgKey.indexOf('travel_') === 0 && !isNaN(cfgVal)) {
          // strip 'travel_' prefix → e.g. 'transit_buffer', 'transit_buffer_IAD'
          travelConfig[cfgKey.substring(7)] = cfgVal;
        }
      }
    }
  } catch(e) {}

  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: true, totalFlags: 0, activeFlags: 0, high: 0, medium: 0, low: 0, lastRun: null,
             travelConfig: travelConfig };
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
    ok:             true,
    totalFlags:     all.length,
    activeFlags:    active.length,
    high:           active.filter(function(r) { return r[5] === 'High';   }).length,
    medium:         active.filter(function(r) { return r[5] === 'Medium'; }).length,
    low:            active.filter(function(r) { return r[5] === 'Low';    }).length,
    lastRun:      formatDateVal_(lastRun),
    travelConfig: travelConfig,
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

  // Signal Learning: record outcome so VERA can learn from user engagement
  try {
    const flagKey = found.sheet.getRange(found.rowNum, 10).getValue(); // Column J: Key
    if (flagKey) recordFlagOutcome_(String(flagKey), 'acknowledged');
  } catch (slErr) {
    Logger.log('SignalLearning: ack hook error (non-fatal) — ' + slErr.message);
  }

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

  // Signal Learning: record outcome
  try {
    const flagKey = found.sheet.getRange(found.rowNum, 10).getValue(); // Column J: Key
    if (flagKey) recordFlagOutcome_(String(flagKey), 'snoozed');
  } catch (slErr) {
    Logger.log('SignalLearning: snooze hook error (non-fatal) — ' + slErr.message);
  }

  return { ok: true, id: id, action: 'snoozed', snoozedUntil: untilStr };
}

// ---- Resolve ---------------------------------------------------------------

function webResolve_(id) {
  const found = findFlagRow_(id);
  found.sheet.getRange(found.rowNum, 9).setValue('Yes'); // Column I

  // Signal Learning: record outcome
  try {
    const flagKey = found.sheet.getRange(found.rowNum, 10).getValue(); // Column J: Key
    if (flagKey) recordFlagOutcome_(String(flagKey), 'resolved');
  } catch (slErr) {
    Logger.log('SignalLearning: resolve hook error (non-fatal) — ' + slErr.message);
  }

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

// ---- Recurring helper — compute next due date from a frequency string --------
/**
 * Given a base date and a recurring frequency string, returns the next Date.
 * Understands: Daily, Weekly, Bi-Weekly, Monthly, Quarterly, Semi-Annual,
 * Yearly/Annual, "Every N days/weeks/months", and plain "N days/weeks/months".
 * Returns null if the recurring string is empty or unrecognised as recurring.
 */
function computeNextDueDate_(fromDate, recurringStr) {
  var s = String(recurringStr || '').trim().toLowerCase();
  if (!s || s === 'no' || s === 'false' || s === '0') return null;

  var base = fromDate instanceof Date ? new Date(fromDate) : new Date();
  base.setHours(0, 0, 0, 0);
  var next = new Date(base);

  if (s === 'daily') {
    next.setDate(next.getDate() + 1);
  } else if (s === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else if (s === 'bi-weekly' || s === 'biweekly' || s === 'every 2 weeks' || s === 'fortnightly') {
    next.setDate(next.getDate() + 14);
  } else if (s === 'monthly') {
    next.setMonth(next.getMonth() + 1);
  } else if (s === 'quarterly' || s === 'every 3 months') {
    next.setMonth(next.getMonth() + 3);
  } else if (s === 'semi-annual' || s === 'semi annual' || s === 'every 6 months') {
    next.setMonth(next.getMonth() + 6);
  } else if (s === 'yearly' || s === 'annual' || s === 'annually' || s === 'every year') {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    // "every N days/weeks/months" or "N days/weeks/months"
    var m;
    if ((m = s.match(/^(?:every\s+)?(\d+)\s*days?$/))) {
      next.setDate(next.getDate() + parseInt(m[1]));
    } else if ((m = s.match(/^(?:every\s+)?(\d+)\s*weeks?$/))) {
      next.setDate(next.getDate() + parseInt(m[1]) * 7);
    } else if ((m = s.match(/^(?:every\s+)?(\d+)\s*months?$/))) {
      next.setMonth(next.getMonth() + parseInt(m[1]));
    } else {
      // Unknown string but non-empty — treat as monthly
      next.setMonth(next.getMonth() + 1);
    }
  }
  return next;
}

function webCompleteTask_(id) {
  const found = findTaskRow_(id);
  found.sheet.getRange(found.rowNum, 5).setValue('Done'); // Column E = Status

  // ---- Auto-regenerate if recurring --------------------------------------
  // TASK_HEADERS: ID(1) | Task(2) | Added Date(3) | Due Date(4) | Status(5) | Recurring(6) | Notes(7) | Flagged(8)
  const rowData      = found.sheet.getRange(found.rowNum, 1, 1, TASK_HEADERS.length).getValues()[0];
  const taskText     = String(rowData[1] || '').trim();
  const dueRaw       = rowData[3];
  const recurringVal = String(rowData[5] || '').trim();
  const notes        = String(rowData[6] || '').trim();

  const isRecurring = recurringVal !== '' &&
    recurringVal.toLowerCase() !== 'no' &&
    recurringVal.toLowerCase() !== 'false' &&
    recurringVal !== '0';

  if (!isRecurring || !taskText) {
    return { ok: true, id: id, action: 'completed' };
  }

  const tz      = Session.getScriptTimeZone();
  const today   = new Date(); today.setHours(0, 0, 0, 0);
  const baseDate = dueRaw ? new Date(dueRaw) : today;
  // If original due date has already passed, advance from today instead
  const fromDate = baseDate < today ? today : baseDate;
  const nextDate = computeNextDueDate_(fromDate, recurringVal);

  if (!nextDate) {
    return { ok: true, id: id, action: 'completed' };
  }

  const nextDateStr = Utilities.formatDate(nextDate, tz, 'yyyy-MM-dd');
  const todayStr    = Utilities.formatDate(today,    tz, 'yyyy-MM-dd');
  const dateKey     = Utilities.formatDate(today,    tz, 'yyyyMMdd');

  // Generate new task ID
  const sheet   = found.sheet;
  const lastRow = sheet.getLastRow();
  let seq = 1;
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(r) {
      if (String(r[0] || '').indexOf('TASK-' + dateKey) === 0) seq++;
    });
  }
  const newId = 'TASK-' + dateKey + '-' + String(seq).padStart(2, '0');

  // Append the regenerated task
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, TASK_HEADERS.length).setValues([[
    newId, taskText, todayStr, nextDateStr, 'Open', recurringVal, notes, ''
  ]]);

  return { ok: true, id: id, action: 'completed', recurring: true, nextTaskId: newId, nextDueDate: nextDateStr };
}

function webDeleteTask_(id) {
  const found = findTaskRow_(id);
  found.sheet.deleteRow(found.rowNum);
  return { ok: true, id: id, action: 'deleted' };
}

// ---- Add / Update task -----------------------------------------------------

function webAddTask_(e) {
  const taskText  = ((e.parameter && e.parameter.task)      || '').trim();
  const dueDate   =  (e.parameter && e.parameter.dueDate)   || '';
  const notes     =  (e.parameter && e.parameter.notes)     || '';
  const recurring =  (e.parameter && e.parameter.recurring) || '';
  if (!taskText) throw new Error('Task text is required');

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.TASKS);
  if (!sheet) throw new Error('Tasks sheet not found');

  // Generate ID: TASK-YYYYMMDD-NN
  const tz       = Session.getScriptTimeZone();
  const today    = new Date();
  const dateStr  = Utilities.formatDate(today, tz, 'yyyyMMdd');
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
  const row = [taskId, taskText, addedStr, dueDate, 'Open', recurring, notes, ''];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, TASK_HEADERS.length).setValues([row]);

  return { ok: true, id: taskId, action: 'created' };
}

function webUpdateTask_(e) {
  const id      = (e.parameter && e.parameter.id)      || '';
  const found   = findTaskRow_(id);

  // TASK_HEADERS: ID(1) | Task(2) | Added Date(3) | Due Date(4) | Status(5) | Recurring(6) | Notes(7) | Flagged(8)
  if (e.parameter.task      != null) found.sheet.getRange(found.rowNum, 2).setValue(e.parameter.task);
  if (e.parameter.dueDate   != null) found.sheet.getRange(found.rowNum, 4).setValue(e.parameter.dueDate);
  if (e.parameter.status    != null) found.sheet.getRange(found.rowNum, 5).setValue(e.parameter.status);
  if (e.parameter.recurring != null) found.sheet.getRange(found.rowNum, 6).setValue(e.parameter.recurring);
  if (e.parameter.notes     != null) found.sheet.getRange(found.rowNum, 7).setValue(e.parameter.notes);

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

// ---- Itinerary (Issue #63) --------------------------------------------------

/**
 * Decides whether a calendar event is travel-relevant for a trip itinerary.
 * @param {string} title     - Event title
 * @param {string} location  - Event location (may be empty string)
 * @param {string} tripLabel - Trip label extracted from tripKey (e.g. "Alaska Trip")
 * @returns {{ include: boolean, type: string }}
 */
function isItineraryCalendarRelevant_(title, location, tripLabel) {
  var titleLower    = (title    || '').toLowerCase();
  var locationLower = (location || '').toLowerCase();

  var AIRLINE_REGEX   = /\b(AA|UA|DL|SW|BA|EK|LH|AF|QR|AC|AS|B6|F9|WN|NK|G4)\s*\d+/;
  var FLIGHT_WORDS    = ['flight', 'flying', 'depart', 'arrive', '\u2708'];
  var TRANSPORT_WORDS = ['train', 'amtrak', 'eurostar', 'rail', 'thalys', 'bus', 'shuttle',
                         'transfer', 'car rental', 'rental car', 'lyft', 'uber', 'taxi'];
  var HOTEL_WORDS     = ['hotel', 'check-in', 'check in', 'check-out', 'check out',
                         'airbnb', 'vrbo', 'resort', 'inn', 'hostel', 'motel', 'lodge'];
  var VIRTUAL_LOCS    = ['zoom', 'google meet', 'teams', 'webex', 'skype',
                         'conference room', 'meet.google', 'whereby'];
  var STOP_WORDS      = { trip:1, travel:1, vacation:1, holiday:1, weekend:1, adventure:1,
                          getaway:1, visit:1, tour:1, journey:1, with:1, to:1, a:1, an:1,
                          the:1, my:1, our:1, and:1, 'in':1, at:1, for:1 };

  var i;

  // 1. Virtual/remote location → always exclude
  if (locationLower) {
    for (i = 0; i < VIRTUAL_LOCS.length; i++) {
      if (locationLower.indexOf(VIRTUAL_LOCS[i]) !== -1) return { include: false };
    }
  }

  // 2. Airline code + flight number (e.g. "AA 102", "UA123")
  if (AIRLINE_REGEX.test(title.toUpperCase())) return { include: true, type: 'flight' };

  // 3. Generic flight keywords
  for (i = 0; i < FLIGHT_WORDS.length; i++) {
    if (titleLower.indexOf(FLIGHT_WORDS[i]) !== -1) return { include: true, type: 'flight' };
  }

  // 4. Hotel / lodging keywords
  for (i = 0; i < HOTEL_WORDS.length; i++) {
    if (titleLower.indexOf(HOTEL_WORDS[i]) !== -1) return { include: true, type: 'hotel' };
  }

  // 5. Transport keywords
  for (i = 0; i < TRANSPORT_WORDS.length; i++) {
    if (titleLower.indexOf(TRANSPORT_WORDS[i]) !== -1) return { include: true, type: 'transport' };
  }

  // 6. Destination keyword extraction (words ≥3 chars not in stop list)
  var destKeywords = (tripLabel || '').toLowerCase()
    .split(/[^a-z]+/)
    .filter(function(w) { return w.length >= 3 && !STOP_WORDS[w]; });

  // 7–9. Location-based match
  if (locationLower) {
    for (i = 0; i < destKeywords.length; i++) {
      if (locationLower.indexOf(destKeywords[i]) !== -1) return { include: true, type: 'calendar' };
    }
    return { include: false }; // location present but doesn't match destination
  }

  // 9. No location, no travel keyword → exclude
  return { include: false };
}

function findItineraryRow_(id) {
  if (!id) throw new Error('Missing itinerary item ID');
  const sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Itinerary tab is empty');
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) return { sheet, rowNum: i + 2 };
  }
  throw new Error('Itinerary item not found: ' + id);
}

/**
 * Returns all stored itinerary items for a trip + auto-pulled calendar events
 * within the trip date range.
 * Params: tripKey (required), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD)
 */
function webGetItinerary_(e) {
  const p       = e.parameter || {};
  const tripKey = (p.tripKey   || '').trim();
  const start   = (p.startDate || '').trim();
  const end     = (p.endDate   || '').trim();
  if (!tripKey) throw new Error('tripKey is required');

  const tz    = Session.getScriptTimeZone();
  const items = [];

  // 1. Stored itinerary items
  const sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
  if (sheet && sheet.getLastRow() >= 2) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
    data.forEach(function(row, idx) {
      if (!String(row[0]).trim()) return;           // blank row
      if (String(row[1]).trim() !== tripKey) return; // different trip
      const meta = String(row[9] || '').trim();
      // Cells that were auto-converted to Date by Sheets must be re-formatted as strings
      function fmtDate_(v) {
        if (!v && v !== 0) return '';
        return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v).trim();
      }
      function fmtTime_(v) {
        if (!v && v !== 0) return '';
        return v instanceof Date ? Utilities.formatDate(v, tz, 'HH:mm') : String(v).trim();
      }
      items.push({
        id:        String(row[0]).trim(),
        tripKey:   String(row[1]).trim(),
        type:      String(row[2]).trim() || 'manual',
        title:     String(row[3]).trim(),
        date:      fmtDate_(row[4]),
        startTime: fmtTime_(row[5]),
        endTime:   fmtTime_(row[6]),
        location:  String(row[7]).trim(),
        notes:     String(row[8]).trim(),
        metadata:  meta,
        source:    'manual',
        row:       idx + 2,
      });
    });
  }

  // 2. Auto-pull calendar events within trip date range (smart-filtered, read-only)
  if (start && end) {
    try {
      const startDt   = new Date(start + 'T00:00:00');
      const endDt     = new Date(end   + 'T23:59:59');
      const tripLabel = tripKey.split('|')[1] || ''; // e.g. "Alaska Trip" from "2026-05-10|Alaska Trip"

      // Fetch per-event timezone via Calendar Advanced Service.
      // CalendarApp doesn't expose per-event timezone; Calendar.Events.list() does.
      // Keys stored as both resource id and iCalUID since ev.getId() returns iCalUID.
      var eventTzMap = {};  // eventId/iCalUID → { startTz, endTz }
      CalendarApp.getAllCalendars().forEach(function(cal) {
        try {
          var result = Calendar.Events.list(cal.getId(), {
            singleEvents: true,
            maxResults:   500,
            timeMin:      startDt.toISOString(),
            timeMax:      endDt.toISOString(),
            fields:       'items(id,iCalUID,start/timeZone,end/timeZone)',
          });
          (result.items || []).forEach(function(item) {
            var entry = {
              startTz: (item.start && item.start.timeZone) || null,
              endTz:   (item.end   && item.end.timeZone)   || null,
            };
            if (item.id)      eventTzMap[item.id]      = entry;
            if (item.iCalUID) eventTzMap[item.iCalUID] = entry;
          });
        } catch (tzErr) {
          Logger.log('Itinerary: TZ fetch failed for ' + cal.getId() + ' — ' + tzErr.message);
        }
      });

      CalendarApp.getAllCalendars().forEach(function(cal) {
        try {
          cal.getEvents(startDt, endDt).forEach(function(ev) {
            const evTitle    = (ev.getTitle()    || '(No title)').trim();
            const evLocation = (ev.getLocation() || '').trim();

            // Smart filter: only keep travel-relevant events
            var relevance = isItineraryCalendarRelevant_(evTitle, evLocation, tripLabel);
            if (!relevance.include) return;

            const evStart  = ev.getStartTime();
            // Use per-event timezones: departure city TZ for start, arrival city TZ for end.
            // Falls back to script TZ if the event has no explicit timezone.
            var evTzInfo  = eventTzMap[ev.getId()] || {};
            var evStartTz = evTzInfo.startTz || tz;
            var evEndTz   = evTzInfo.endTz   || tz;
            const evDate  = Utilities.formatDate(evStart, evStartTz, 'yyyy-MM-dd');
            const evTime  = ev.isAllDayEvent() ? '' : Utilities.formatDate(evStart, evStartTz, 'HH:mm');
            const evEnd   = ev.isAllDayEvent() ? '' : Utilities.formatDate(ev.getEndTime(), evEndTz, 'HH:mm');
            // Build metadata: always include calendarName; include startTz/endTz when available
            var evMeta = { calendarName: cal.getName() };
            if (evTzInfo.startTz) evMeta.startTz = evTzInfo.startTz;
            if (evTzInfo.endTz && evTzInfo.endTz !== evTzInfo.startTz) evMeta.endTz = evTzInfo.endTz;
            // For multi-day events (e.g. hotel stays spanning several nights), store the checkout
            // date in metadata so the frontend gap detector covers the full date range.
            if (ev.isAllDayEvent()) {
              var allDayEnd = new Date(ev.getEndTime());
              allDayEnd.setDate(allDayEnd.getDate() - 1); // GAS all-day end is exclusive
              var allDayEndStr = Utilities.formatDate(allDayEnd, tz, 'yyyy-MM-dd');
              if (allDayEndStr !== evDate) evMeta.checkoutDate = allDayEndStr;
            } else {
              var timedEndDate = Utilities.formatDate(ev.getEndTime(), evEndTz, 'yyyy-MM-dd');
              if (timedEndDate !== evDate) evMeta.checkoutDate = timedEndDate;
            }
            items.push({
              id:        'CAL-' + ev.getId().replace(/[^a-z0-9]/gi, '').substring(0, 16),
              tripKey:   tripKey,
              type:      relevance.type,    // 'flight' / 'hotel' / 'transport' / 'calendar'
              title:     evTitle,
              date:      evDate,
              startTime: evTime,
              endTime:   evEnd,
              location:  evLocation,
              notes:     '',
              metadata:  JSON.stringify(evMeta),
              source:    'calendar',
              row:       null,
            });
          });
        } catch (calErr) { /* skip inaccessible calendar */ }
      });
    } catch (calEx) {
      Logger.log('Itinerary: calendar pull failed — ' + calEx.message);
    }
  }

  // 3. Sort ascending by date + startTime (events with no time sort to start of day)
  items.sort(function(a, b) {
    const ak = a.date + '|' + (a.startTime || '00:00');
    const bk = b.date + '|' + (b.startTime || '00:00');
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });

  return { ok: true, tripKey: tripKey, items: items };
}

function webAddItineraryItem_(e) {
  const p       = e.parameter || {};
  const tripKey = (p.tripKey || '').trim();
  const title   = (p.title   || '').trim();
  if (!tripKey || !title) throw new Error('tripKey and title are required');

  const sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
  if (!sheet) throw new Error('Itinerary tab not found');

  const tz      = Session.getScriptTimeZone();
  const today   = new Date();
  const dateKey = Utilities.formatDate(today, tz, 'yyyyMMdd');
  const lastRow = sheet.getLastRow();
  let seq = 1;
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(r) {
      if (String(r[0]).indexOf('ITIN-' + dateKey) === 0) seq++;
    });
  }
  const id = 'ITIN-' + dateKey + '-' + String(seq).padStart(2, '0');

  // ITINERARY_HEADERS: ID|Trip Key|Type|Title|Date|Start Time|End Time|Location|Notes|Metadata
  const newRow = sheet.getLastRow() + 1;
  // Force Date (col 5), Start Time (col 6), End Time (col 7) to Plain Text so Sheets
  // does not auto-convert date/time strings to date serial numbers (Dec 30 1899 = serial 0 bug)
  sheet.getRange(newRow, 5, 1, 3).setNumberFormat('@');
  sheet.getRange(newRow, 1, 1, ITINERARY_HEADERS.length).setValues([[
    id,
    tripKey,
    (p.type      || 'manual').trim(),
    title,
    (p.date      || '').trim(),
    (p.startTime || '').trim(),
    (p.endTime   || '').trim(),
    (p.location  || '').trim(),
    (p.notes     || '').trim(),
    (p.metadata  || '').trim(),
  ]]);
  return { ok: true, id: id, action: 'created' };
}

function webUpdateItineraryItem_(e) {
  const p     = e.parameter || {};
  const found = findItineraryRow_((p.id || '').trim());
  // ITINERARY_HEADERS: ID(1)|TripKey(2)|Type(3)|Title(4)|Date(5)|StartTime(6)|EndTime(7)|Location(8)|Notes(9)|Metadata(10)
  if (p.type      != null) found.sheet.getRange(found.rowNum, 3).setValue(p.type.trim());
  if (p.title     != null) found.sheet.getRange(found.rowNum, 4).setValue(p.title.trim());
  if (p.date      != null) { var dc = found.sheet.getRange(found.rowNum, 5); dc.setNumberFormat('@'); dc.setValue(p.date.trim()); }
  if (p.startTime != null) { var sc = found.sheet.getRange(found.rowNum, 6); sc.setNumberFormat('@'); sc.setValue(p.startTime.trim()); }
  if (p.endTime   != null) { var ec = found.sheet.getRange(found.rowNum, 7); ec.setNumberFormat('@'); ec.setValue(p.endTime.trim()); }
  if (p.location  != null) found.sheet.getRange(found.rowNum, 8).setValue(p.location.trim());
  if (p.notes     != null) found.sheet.getRange(found.rowNum, 9).setValue(p.notes.trim());
  if (p.metadata  != null) found.sheet.getRange(found.rowNum, 10).setValue(p.metadata.trim());
  return { ok: true, id: p.id, action: 'updated' };
}

function webDeleteItineraryItem_(e) {
  const id    = ((e.parameter && e.parameter.id) || '').trim();
  const found = findItineraryRow_(id);
  found.sheet.deleteRow(found.rowNum);
  return { ok: true, id: id, action: 'deleted' };
}

// ---- Packing + Trip Context (Issue #64) ------------------------------------

/**
 * Find a row in PackingItems by ID. Mirrors findItineraryRow_.
 */
function findPackingRow_(id) {
  if (!id) throw new Error('Missing packing item ID');
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.PACKING_ITEMS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('PackingItems tab is empty');
  const numRows = sheet.getLastRow() - 1;
  const ids     = sheet.getRange(2, 1, numRows, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) return { sheet, rowNum: i + 2 };
  }
  throw new Error('Packing item not found: ' + id);
}

/**
 * GET get_trip_meta — params: tripKey
 * Returns { ok, tripKey, context, notes }
 */
function webGetTripMeta_(e) {
  const p       = (e && e.parameter) ? e.parameter : {};
  const tripKey = (p.tripKey || '').trim();
  if (!tripKey) throw new Error('tripKey is required');

  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.TRIP_META, TRIP_META_HEADERS);
  const sheet = ss.getSheetByName(TABS.TRIP_META);

  if (sheet.getLastRow() >= 2) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, TRIP_META_HEADERS.length).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === tripKey) {
        return { ok: true, tripKey, context: String(data[i][1] || ''), notes: String(data[i][2] || ''), traveler: String(data[i][4] || '') };
      }
    }
  }
  return { ok: true, tripKey, context: '', notes: '', traveler: '' };
}

/**
 * GET set_trip_meta — params: tripKey, context, notes
 * Upserts TripMeta row. Returns { ok }
 */
function webSetTripMeta_(e) {
  const p       = (e && e.parameter) ? e.parameter : {};
  const tripKey = (p.tripKey || '').trim();
  if (!tripKey) throw new Error('tripKey is required');

  const ss    = getSpreadsheet();
  ensureSheet(ss, TABS.TRIP_META, TRIP_META_HEADERS);
  const sheet = ss.getSheetByName(TABS.TRIP_META);
  const tz    = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  if (sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === tripKey) {
        const rowNum = i + 2;
        sheet.getRange(rowNum, 2).setValue((p.context  || '').trim());
        sheet.getRange(rowNum, 3).setValue((p.notes    || '').trim());
        sheet.getRange(rowNum, 5).setValue((p.traveler || '').trim());
        const dc = sheet.getRange(rowNum, 4);
        dc.setNumberFormat('@');
        dc.setValue(today);
        return { ok: true };
      }
    }
  }

  // Append new row
  const newRow = sheet.getLastRow() + 1;
  const dateCell = sheet.getRange(newRow, 4);
  dateCell.setNumberFormat('@');
  sheet.getRange(newRow, 1, 1, TRIP_META_HEADERS.length).setValues([[
    tripKey,
    (p.context  || '').trim(),
    (p.notes    || '').trim(),
    today,
    (p.traveler || '').trim(),
  ]]);
  return { ok: true };
}

/**
 * GET get_packing — params: tripKey
 * Returns { ok, tripKey, items: [...], meta: { context, notes } }
 */
function webGetPacking_(e) {
  const p       = (e && e.parameter) ? e.parameter : {};
  const tripKey = (p.tripKey || '').trim();
  if (!tripKey) throw new Error('tripKey is required');

  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.PACKING_ITEMS, PACKING_ITEM_HEADERS);
  const sheet = ss.getSheetByName(TABS.PACKING_ITEMS);

  const items = [];
  if (sheet.getLastRow() >= 2) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues();
    data.forEach(function(row) {
      if (String(row[1]).trim() !== tripKey) return;
      items.push({
        id:        String(row[0]).trim(),
        tripKey:   String(row[1]).trim(),
        person:    String(row[2]).trim(),
        category:  String(row[3]).trim(),
        item:      String(row[4]).trim(),
        checked:   String(row[5]).toUpperCase() === 'TRUE',
        source:    String(row[6]).trim() || 'manual',
        addedDate: String(row[7]).trim(),
      });
    });
  }

  // Sort: ahmed → victoria → shared, then category, then item
  const personOrder = { ahmed: 0, victoria: 1, shared: 2 };
  items.sort(function(a, b) {
    const pa = personOrder[a.person] !== undefined ? personOrder[a.person] : 99;
    const pb = personOrder[b.person] !== undefined ? personOrder[b.person] : 99;
    if (pa !== pb) return pa - pb;
    if (a.category < b.category) return -1;
    if (a.category > b.category) return  1;
    if (a.item < b.item) return -1;
    if (a.item > b.item) return  1;
    return 0;
  });

  // Also fetch trip meta (context)
  let meta = { context: '', notes: '' };
  try {
    const metaResult = webGetTripMeta_(e);
    meta = { context: metaResult.context || '', notes: metaResult.notes || '' };
  } catch(err) { /* graceful */ }

  return { ok: true, tripKey, items, meta };
}

/**
 * GET add_packing_item — params: tripKey, person, category, item
 * Returns { ok, id }
 */
function webAddPackingItem_(e) {
  const p        = (e && e.parameter) ? e.parameter : {};
  const tripKey  = (p.tripKey  || '').trim();
  const person   = (p.person   || '').trim();
  const category = (p.category || '').trim();
  const item     = (p.item     || '').trim();
  if (!tripKey || !person || !category || !item) {
    throw new Error('tripKey, person, category and item are required');
  }

  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.PACKING_ITEMS, PACKING_ITEM_HEADERS);
  const sheet = ss.getSheetByName(TABS.PACKING_ITEMS);
  const tz    = Session.getScriptTimeZone();

  // Generate ID: PACK-YYYYMMDD-NN
  const dateKey = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  let seq = 1;
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function(r) {
      if (String(r[0]).indexOf('PACK-' + dateKey) === 0) seq++;
    });
  }
  const id = 'PACK-' + dateKey + '-' + String(seq).padStart(2, '0');

  const newRow    = sheet.getLastRow() + 1;
  const addedDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // Prevent Sheets auto-converting Checked and Added Date columns
  sheet.getRange(newRow, 6).setNumberFormat('@');
  sheet.getRange(newRow, 8).setNumberFormat('@');
  sheet.getRange(newRow, 1, 1, PACKING_ITEM_HEADERS.length).setValues([[
    id, tripKey, person, category, item, 'FALSE', 'manual', addedDate,
  ]]);

  return { ok: true, id };
}

/**
 * GET update_packing_item — params: id, checked?, item?, category?
 * Returns { ok, id }
 */
function webUpdatePackingItem_(e) {
  const p     = (e && e.parameter) ? e.parameter : {};
  const id    = (p.id || '').trim();
  const found = findPackingRow_(id);

  if (p.checked != null) {
    const val   = (p.checked === 'true' || p.checked === 'TRUE') ? 'TRUE' : 'FALSE';
    const cell  = found.sheet.getRange(found.rowNum, 6);
    cell.setNumberFormat('@');
    cell.setValue(val);
  }
  if (p.item     != null) found.sheet.getRange(found.rowNum, 5).setValue(p.item.trim());
  if (p.category != null) found.sheet.getRange(found.rowNum, 4).setValue(p.category.trim());

  return { ok: true, id };
}

/**
 * GET delete_packing_item — params: id
 * Returns { ok, id }
 */
function webDeletePackingItem_(e) {
  const p     = (e && e.parameter) ? e.parameter : {};
  const id    = (p.id || '').trim();
  const found = findPackingRow_(id);
  found.sheet.deleteRow(found.rowNum);
  return { ok: true, id };
}

/**
 * Geocode a destination string via Open-Meteo geocoding API.
 * Returns { lat, lon, name } or null on failure.
 */
function geocodePackingDestination_(destination) {
  if (!destination) return null;
  try {
    const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
                encodeURIComponent(destination) + '&count=1&language=en&format=json';
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(resp.getContentText());
    if (!data.results || data.results.length === 0) return null;
    const r = data.results[0];
    return { lat: r.latitude, lon: r.longitude, name: r.name };
  } catch(err) {
    Logger.log('Packing geocode error: ' + err.message);
    return null;
  }
}

/**
 * Fetch weather summary for packing. Uses Open-Meteo forecast (≤14 days)
 * or prior-year archive (>14 days). Returns plain-English string or ''.
 */
function getPackingWeather_(destination, startDate, endDate) {
  if (!destination) return '';
  try {
    const geo = geocodePackingDestination_(destination);
    if (!geo) return '';
    const lat = geo.lat, lon = geo.lon;

    const today      = new Date();
    const tripStart  = new Date(startDate + 'T00:00:00');
    const daysUntil  = Math.floor((tripStart - today) / 86400000);
    const useForecast = daysUntil <= 14;

    let weatherUrl;
    let isArchive = false;
    if (useForecast) {
      weatherUrl =
        'https://api.open-meteo.com/v1/forecast' +
        '?latitude=' + lat + '&longitude=' + lon +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code' +
        '&start_date=' + startDate + '&end_date=' + endDate +
        '&timezone=auto&temperature_unit=fahrenheit';
    } else {
      isArchive = true;
      const yearOffset = parseInt(startDate.substring(0, 4), 10) - 1;
      const prevStart  = yearOffset + startDate.substring(4);
      const prevEnd    = yearOffset + endDate.substring(4);
      weatherUrl =
        'https://archive-api.open-meteo.com/v1/archive' +
        '?latitude=' + lat + '&longitude=' + lon +
        '&start_date=' + prevStart + '&end_date=' + prevEnd +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum' +
        '&temperature_unit=fahrenheit';
    }

    const wResp = UrlFetchApp.fetch(weatherUrl, { muteHttpExceptions: true });
    const wData = JSON.parse(wResp.getContentText());
    if (!wData.daily) return '';

    const maxTemps  = wData.daily.temperature_2m_max  || [];
    const minTemps  = wData.daily.temperature_2m_min  || [];
    const rainSums  = wData.daily.precipitation_sum   || [];
    if (maxTemps.length === 0) return '';

    const maxTemp  = Math.round(Math.max.apply(null, maxTemps.filter(function(x) { return x != null; })));
    const minTemp  = Math.round(Math.min.apply(null, minTemps.filter(function(x) { return x != null; })));
    const rainDays = rainSums.filter(function(x) { return x != null && x > 1; }).length;
    const tripDays = rainSums.length || 1;
    const rainFrac = rainDays / tripDays;

    let rainDesc;
    if (rainFrac >= 0.5)      rainDesc = 'frequent rain';
    else if (rainFrac >= 0.3) rainDesc = 'some rain';
    else if (rainFrac > 0)    rainDesc = 'minimal rain';
    else                      rainDesc = 'dry';

    let tempNote;
    if (maxTemp > 85)       tempNote = 'Hot — pack light breathable clothing.';
    else if (maxTemp > 70)  tempNote = 'Warm — light layers recommended.';
    else if (minTemp < 40)  tempNote = 'Cold — pack warm layers and a coat.';
    else                    tempNote = 'Mild — a light jacket should suffice.';

    let summary = (isArchive ? '(Seasonal average) ' : '') +
                  'Expected: ' + minTemp + '\u2013' + maxTemp + '\u00b0F, ' + rainDesc + '. ' + tempNote;
    Logger.log('Packing weather for ' + destination + ': ' + summary);
    return summary;
  } catch(err) {
    Logger.log('getPackingWeather_ error: ' + err.message);
    return '';
  }
}

/**
 * Build the Claude prompt for packing list generation.
 */
function buildPackingPrompt_(tripLabel, startDate, endDate, durationNights, context, itinerarySummary, weatherSummary) {
  const contextLine = context ? 'Trip Context: ' + context : 'Trip Context: General travel';
  const weatherLine = weatherSummary
    ? 'Weather: ' + weatherSummary
    : 'Weather: Unknown \u2014 pack for general conditions';

  return (
    'You are VERA, a smart packing assistant for Ahmed and Victoria, a US-based couple.\n\n' +
    'Trip: ' + tripLabel + '\n' +
    'Dates: ' + startDate + ' to ' + endDate + ' (' + durationNights + ' nights)\n' +
    contextLine + '\n' +
    weatherLine + '\n\n' +
    (itinerarySummary ? '=== ITINERARY ===\n' + itinerarySummary + '\n\n' : '') +
    'Generate a practical packing list split across "ahmed", "victoria", and "shared"\n' +
    '(shared = items only needed once: adapters, sunscreen, first aid kit, travel umbrella, etc.).\n' +
    'Group by category. Use concise names like: Documents, Clothing, Shoes, Toiletries,\n' +
    'Electronics, Medications, Entertainment, Beach/Pool, Outdoor/Hiking, Formal/Dress, Snacks, Romantic.\n\n' +
    'RULES:\n' +
    '- Match context: Anniversary/Romantic/Honeymoon \u2192 nicer clothes + Romantic category;\n' +
    '  Work Trip \u2192 laptop, charger, business clothes; Family \u2192 shared snacks/kids items if relevant.\n' +
    '- Match weather: rain \u2192 rain jacket; hot \u2192 sunscreen + light clothes; cold \u2192 layers + coat.\n' +
    '- 30\u201360 total items max. Keep item names concise (e.g. "3 T-shirts", not "t-shirt 1, t-shirt 2").\n' +
    '- Do NOT include basic everyday items unless travel-specific (e.g. include "travel toothbrush" not just "toothbrush").\n\n' +
    'CRITICAL \u2014 RESPONSE FORMAT:\n' +
    'Return ONLY a raw JSON object. No markdown. No code fences. No explanation.\n' +
    'Start with { and end with }.\n\n' +
    '{"ahmed":[{"category":"Documents","item":"Passport"},{"category":"Clothing","item":"3 T-shirts"}],' +
    '"victoria":[{"category":"Documents","item":"Passport"},{"category":"Clothing","item":"Swimsuit"}],' +
    '"shared":[{"category":"Electronics","item":"Universal adapter"},{"category":"Toiletries","item":"Sunscreen SPF 50"}]}\n\n' +
    'Generate the packing list now:'
  );
}

/**
 * Defensively parse Claude packing response. Returns { ahmed, victoria, shared } arrays.
 */
function parsePackingResponse_(rawContent) {
  try {
    let cleaned = (rawContent || '').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON object found');
    const parsed = JSON.parse(cleaned.substring(start, end + 1));
    return {
      ahmed:    Array.isArray(parsed.ahmed)    ? parsed.ahmed    : [],
      victoria: Array.isArray(parsed.victoria) ? parsed.victoria : [],
      shared:   Array.isArray(parsed.shared)   ? parsed.shared   : [],
    };
  } catch(err) {
    Logger.log('parsePackingResponse_ failed: ' + err.message + ' | raw: ' + (rawContent || '').substring(0, 200));
    return { ahmed: [], victoria: [], shared: [] };
  }
}

/**
 * GET generate_packing — params: tripKey, startDate, endDate
 * Generates a Claude-powered packing list (with weather context), saves to PackingItems tab.
 * Returns { ok, items: [...] }
 */
function webGeneratePacking_(e) {
  const p         = (e && e.parameter) ? e.parameter : {};
  const tripKey   = (p.tripKey   || '').trim();
  const startDate = (p.startDate || '').trim();
  const endDate   = (p.endDate   || '').trim();
  if (!tripKey) throw new Error('tripKey is required');

  // Step 1 — Parse trip label from tripKey ("YYYY-MM-DD|Label")
  const pipeIdx  = tripKey.indexOf('|');
  const tripLabel = pipeIdx >= 0 ? tripKey.substring(pipeIdx + 1) : tripKey;

  // Duration in nights
  let durationNights = '?';
  if (startDate && endDate) {
    try {
      const diff = (new Date(endDate + 'T00:00:00') - new Date(startDate + 'T00:00:00')) / 86400000;
      durationNights = Math.max(0, Math.round(diff)).toString();
    } catch(err) { /* ignore */ }
  }

  // Step 2 — Load itinerary items and build summary string
  const ss       = getSpreadsheet();
  const itinSheet = ss.getSheetByName(TABS.ITINERARY);
  let itinerarySummary = '';
  if (itinSheet && itinSheet.getLastRow() >= 2) {
    const itinData = itinSheet.getRange(2, 1, itinSheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
    const lines = [];
    itinData.forEach(function(row) {
      if (String(row[1]).trim() !== tripKey) return;
      const date  = String(row[4]).trim();
      const type  = String(row[2]).trim();
      const title = String(row[3]).trim();
      const loc   = String(row[7]).trim();
      let line = '\u2022 [' + type + '] ' + title;
      if (date) line = date + ' ' + line;
      if (loc)  line += ' @ ' + loc;
      lines.push(line);
    });
    itinerarySummary = lines.join('\n');
  }

  // Step 3 — Load trip context
  let context = '';
  try {
    const metaResult = webGetTripMeta_(e);
    context = metaResult.context || '';
  } catch(err) { /* graceful */ }

  // Step 4 — Infer destination for weather
  let destination = '';
  if (!destination && itinSheet && itinSheet.getLastRow() >= 2) {
    const itinData = itinSheet.getRange(2, 1, itinSheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
    // a. Flight metadata.dest
    for (let i = 0; i < itinData.length; i++) {
      const row = itinData[i];
      if (String(row[1]).trim() !== tripKey) continue;
      if (String(row[2]).trim() === 'flight' && row[9]) {
        try {
          const meta = JSON.parse(String(row[9]));
          if (meta.dest) { destination = meta.dest; break; }
        } catch(err) { /* skip */ }
      }
    }
    // b. Hotel location
    if (!destination) {
      for (let i = 0; i < itinData.length; i++) {
        const row = itinData[i];
        if (String(row[1]).trim() !== tripKey) continue;
        if (String(row[2]).trim() === 'hotel' && String(row[7]).trim()) {
          destination = String(row[7]).trim(); break;
        }
      }
    }
  }
  // c. Trip label (strip generic words)
  if (!destination) {
    destination = tripLabel
      .replace(/\b(trip|adventure|vacation|holiday|weekend|getaway|tour|visit)\b/gi, '')
      .trim();
  }

  // Step 5 — Weather
  const weatherSummary = getPackingWeather_(destination, startDate || '', endDate || '');

  // Step 6 — Build prompt
  const prompt = buildPackingPrompt_(tripLabel, startDate, endDate, durationNights, context, itinerarySummary, weatherSummary);

  // Step 7 — Call Claude
  const apiKey = getApiKey();
  const requestBody = {
    model:      CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  };
  const fetchOptions = {
    method:  'post',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload:            JSON.stringify(requestBody),
    muteHttpExceptions: true,
  };
  const response = UrlFetchApp.fetch(CLAUDE_API_URL, fetchOptions);
  const json     = JSON.parse(response.getContentText());
  if (!json.content || !json.content[0]) throw new Error('Claude API returned unexpected response');
  const rawText = json.content[0].text || '';

  // Step 8 — Parse response
  const packingData = parsePackingResponse_(rawText);

  // Step 9 — Clear existing AI items for this trip (bottom-to-top to avoid row shifting)
  ensureSheet(ss, TABS.PACKING_ITEMS, PACKING_ITEM_HEADERS);
  const packSheet = ss.getSheetByName(TABS.PACKING_ITEMS);
  if (packSheet.getLastRow() >= 2) {
    const allRows = packSheet.getRange(2, 1, packSheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues();
    const rowsToDelete = [];
    for (let i = 0; i < allRows.length; i++) {
      if (String(allRows[i][1]).trim() === tripKey && String(allRows[i][6]).trim() === 'ai') {
        rowsToDelete.push(i + 2); // 1-based row number
      }
    }
    rowsToDelete.sort(function(a, b) { return b - a; }); // descending
    rowsToDelete.forEach(function(rowNum) { packSheet.deleteRow(rowNum); });
  }

  // Step 10 — Batch-append new AI items
  const tz      = Session.getScriptTimeZone();
  const dateKey = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  const addedDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  let seq = 1;
  if (packSheet.getLastRow() >= 2) {
    packSheet.getRange(2, 1, packSheet.getLastRow() - 1, 1).getValues().forEach(function(r) {
      if (String(r[0]).indexOf('PACK-' + dateKey) === 0) seq++;
    });
  }

  const allNewItems = [];
  [['ahmed', packingData.ahmed], ['victoria', packingData.victoria], ['shared', packingData.shared]]
    .forEach(function(pair) {
      const person = pair[0];
      const list   = pair[1];
      list.forEach(function(entry) {
        if (!entry.item) return;
        allNewItems.push([
          'PACK-' + dateKey + '-' + String(seq++).padStart(2, '0'),
          tripKey,
          person,
          entry.category || 'General',
          entry.item,
          'FALSE',
          'ai',
          addedDate,
        ]);
      });
    });

  if (allNewItems.length > 0) {
    const startRow = packSheet.getLastRow() + 1;
    // Set plain-text format on Checked (col 6) and Added Date (col 8) for all new rows
    packSheet.getRange(startRow, 6, allNewItems.length, 1).setNumberFormat('@');
    packSheet.getRange(startRow, 8, allNewItems.length, 1).setNumberFormat('@');
    packSheet.getRange(startRow, 1, allNewItems.length, PACKING_ITEM_HEADERS.length).setValues(allNewItems);
  }

  // Return all items for this trip
  return webGetPacking_(e);
}

// ---- Ideas / Braindump (Issue #18) -----------------------------------------

function findIdeaRow_(id) {
  if (!id) throw new Error('Missing idea ID');
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.IDEAS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Ideas sheet is empty');
  const numRows = sheet.getLastRow() - 1;
  const ids     = sheet.getRange(2, 1, numRows, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) {
      return { sheet: sheet, rowNum: i + 2 };
    }
  }
  throw new Error('Idea not found: ' + id);
}

function webGetIdeas_() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.IDEAS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, ideas: [] };

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, IDEA_HEADERS.length).getValues();
  const ideas   = [];

  data.forEach(function(row, idx) {
    const id = String(row[0] || '').trim();
    if (!id) return;
    ideas.push({
      row:       idx + 2,
      id:        id,
      dateAdded: formatDateVal_(row[1]),
      idea:      String(row[2] || '').trim(),
      category:  String(row[3] || '').trim(),
      tags:      String(row[4] || '').trim(),
      notes:     String(row[5] || '').trim(),
      status:    String(row[6] || 'New').trim(),
    });
  });

  return { ok: true, ideas: ideas };
}

function webAddIdea_(e) {
  const p        = e.parameter || {};
  const ideaText = (p.idea || '').trim();
  if (!ideaText) throw new Error('Idea text is required');

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.IDEAS);
  if (!sheet) throw new Error('Ideas tab not found');

  // Generate ID: IDEA-YYYYMMDD-NN
  const tz       = Session.getScriptTimeZone();
  const today    = new Date();
  const dateStr  = Utilities.formatDate(today, tz, 'yyyyMMdd');
  const addedStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  let seq = 1;
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
      .forEach(function(r) { if (String(r[0] || '').indexOf('IDEA-' + dateStr) === 0) seq++; });
  }
  const ideaId = 'IDEA-' + dateStr + '-' + String(seq).padStart(2, '0');

  // IDEA_HEADERS: ID | Date Added | Idea | Category | Tags | Notes | Status
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, IDEA_HEADERS.length).setValues([[
    ideaId, addedStr, ideaText,
    (p.category || 'General').trim(),
    (p.tags  || '').trim(),
    (p.notes || '').trim(),
    'New',
  ]]);

  return { ok: true, id: ideaId, action: 'created' };
}

function webUpdateIdea_(e) {
  const p     = e.parameter || {};
  const id    = (p.id || '').trim();
  const found = findIdeaRow_(id);

  // IDEA_HEADERS: ID(1) | Date Added(2) | Idea(3) | Category(4) | Tags(5) | Notes(6) | Status(7)
  if (p.idea     != null) found.sheet.getRange(found.rowNum, 3).setValue(p.idea.trim());
  if (p.category != null) found.sheet.getRange(found.rowNum, 4).setValue(p.category.trim());
  if (p.tags     != null) found.sheet.getRange(found.rowNum, 5).setValue(p.tags.trim());
  if (p.notes    != null) found.sheet.getRange(found.rowNum, 6).setValue(p.notes.trim());
  if (p.status   != null) found.sheet.getRange(found.rowNum, 7).setValue(p.status.trim());

  return { ok: true, id: id, action: 'updated' };
}

function webDeleteIdea_(e) {
  const id    = ((e.parameter && e.parameter.id) || '').trim();
  const found = findIdeaRow_(id);
  found.sheet.deleteRow(found.rowNum);
  return { ok: true, id: id, action: 'deleted' };
}

/**
 * Promotes an idea to a new open task in the Tasks tab.
 * Marks the idea Status = "Promoted".
 */
function webPromoteIdea_(e) {
  const p  = e.parameter || {};
  const id = (p.id || p.ideaId || '').trim();
  if (!id) throw new Error('Idea ID is required');

  // 1. Find the idea row
  const found    = findIdeaRow_(id);
  const ideaData = found.sheet.getRange(found.rowNum, 1, 1, IDEA_HEADERS.length).getValues()[0];
  // IDEA_HEADERS: ID(0) | Date Added(1) | Idea(2) | Category(3) | Tags(4) | Notes(5) | Status(6)
  const ideaText  = String(ideaData[2] || '').trim();
  const ideaNotes = String(ideaData[5] || '').trim();
  if (!ideaText) throw new Error('Idea text is empty for: ' + id);

  // 2. Create a task — pattern mirrors webAddTask_
  const taskSheet = getSpreadsheet().getSheetByName(TABS.TASKS);
  if (!taskSheet) throw new Error('Tasks tab not found');

  const tz       = Session.getScriptTimeZone();
  const today    = new Date();
  const dateStr  = Utilities.formatDate(today, tz, 'yyyyMMdd');
  const addedStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  let seq = 1;
  if (taskSheet.getLastRow() >= 2) {
    taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, 1).getValues()
      .forEach(function(r) { if (String(r[0] || '').indexOf('TASK-' + dateStr) === 0) seq++; });
  }
  const taskId = 'TASK-' + dateStr + '-' + String(seq).padStart(2, '0');

  // TASK_HEADERS: ID | Task | Added Date | Due Date | Status | Recurring | Notes | Flagged
  taskSheet.getRange(taskSheet.getLastRow() + 1, 1, 1, TASK_HEADERS.length)
    .setValues([[taskId, ideaText, addedStr, '', 'Open', '', ideaNotes, '']]);

  // 3. Mark idea as Promoted
  found.sheet.getRange(found.rowNum, 7).setValue('Promoted'); // Col G = Status

  return { ok: true, ideaId: id, taskId: taskId, action: 'promoted' };
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

// ---- Countries Visited (Issue #74) -----------------------------------------

function webGetCountries_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.COUNTRIES);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, entries: [] };
  var rows    = sheet.getDataRange().getValues();
  var headers = rows[0];
  var entries = rows.slice(1)
    .filter(function(r) { return r[0] !== ''; })
    .map(function(r) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = r[i]; });
      return obj;
    });
  return { ok: true, entries: entries };
}

function webAddCountry_(e) {
  var p         = e.parameter || {};
  var country   = (p.country   || '').trim();
  var city      = (p.city      || '').trim();
  var year      = parseInt(p.year,  10) || new Date().getFullYear();
  var traveller = (p.traveller || 'Both').trim();
  var tripKey   = (p.tripKey   || '').trim();
  var notes     = (p.notes     || '').trim();
  if (!country) throw new Error('Country is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.COUNTRIES);
  if (!sheet) throw new Error('Countries tab not found. Run setupVERA() first.');
  var id = 'c_' + Date.now();
  sheet.appendRow([id, country, city, year, traveller, tripKey, notes]);
  return { ok: true, entry: { ID: id, Country: country, City: city, Year: year,
                               Traveller: traveller, 'Trip Key': tripKey, Notes: notes } };
}

function webDeleteCountry_(e) {
  var id    = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) throw new Error('Country entry ID is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.COUNTRIES);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'Entry not found.' };
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      sheet.deleteRow(i + 1);
      return { ok: true, id: id, action: 'deleted' };
    }
  }
  return { ok: false, error: 'Entry not found: ' + id };
}

// ---- Bucket List (Travel wishlist) -----------------------------------------

function webGetBucketList_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BUCKET_LIST);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, entries: [] };
  var rows    = sheet.getDataRange().getValues();
  var headers = rows[0];
  var entries = rows.slice(1)
    .filter(function(r) { return r[0] !== ''; })
    .map(function(r) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = r[i]; });
      return obj;
    });
  return { ok: true, entries: entries };
}

function webAddBucketItem_(e) {
  var p          = e.parameter || {};
  var country    = (p.country    || '').trim();
  var city       = (p.city       || '').trim();
  var targetYear = parseInt(p.targetYear, 10) || '';
  var traveller  = (p.traveller  || 'Both').trim();
  var stars      = parseInt(p.stars, 10) || '';
  var dreamTrip  = (p.dreamTrip  || '').trim();
  var notes      = (p.notes      || '').trim();
  if (!country) throw new Error('Country is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BUCKET_LIST);
  if (!sheet) throw new Error('Bucket List tab not found. Run setupVERA() first.');
  var id = 'b_' + Date.now();
  sheet.appendRow([id, country, city, targetYear, traveller, stars, dreamTrip, notes, '']);
  return { ok: true, entry: { ID: id, Country: country, City: city,
    'Target Year': targetYear, Traveller: traveller, Stars: stars,
    'Dream Trip': dreamTrip, Notes: notes, Visited: '' } };
}

function webUpdateBucketItem_(e) {
  var p  = e.parameter || {};
  var id = (p.id || '').trim();
  if (!id) throw new Error('Bucket item ID is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BUCKET_LIST);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'Entry not found.' };
  var rows    = sheet.getDataRange().getValues();
  var headers = rows[0];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      // Update only the fields present in params
      if (p.visited !== undefined) {
        var visitedCol = headers.indexOf('Visited');
        if (visitedCol >= 0) sheet.getRange(i + 1, visitedCol + 1).setValue(p.visited);
      }
      if (p.stars !== undefined) {
        var starsCol = headers.indexOf('Stars');
        if (starsCol >= 0) sheet.getRange(i + 1, starsCol + 1).setValue(parseInt(p.stars, 10) || '');
      }
      return { ok: true, id: id };
    }
  }
  return { ok: false, error: 'Entry not found: ' + id };
}

function webDeleteBucketItem_(e) {
  var id = ((e.parameter && e.parameter.id) || '').trim();
  if (!id) throw new Error('Bucket item ID is required.');
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BUCKET_LIST);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'Entry not found.' };
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) {
      sheet.deleteRow(i + 1);
      return { ok: true, id: id, action: 'deleted' };
    }
  }
  return { ok: false, error: 'Entry not found: ' + id };
}

// ---- Flight Status (Issue #66) ---------------------------------------------

/**
 * Returns the flight_status object from metadata for every flight item in a trip.
 * GET ?action=flight_statuses&tripKey=ENCODED_TRIP_KEY
 * Response: { ok: true, statuses: { itemId: { status, dep_scheduled, ... }, ... } }
 */
function webGetFlightStatuses_(e) {
  var tripKey = (e.parameter && e.parameter.tripKey) || '';
  if (!tripKey) return { ok: false, error: 'Missing tripKey' };
  var sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
  if (!sheet) return { ok: true, statuses: {} };
  var rows = sheet.getDataRange().getValues();
  var statuses = {};
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1] || '') !== tripKey) continue;   // col B = Trip Key
    if (String(rows[i][2] || '') !== 'flight') continue;  // col C = Type
    var id   = String(rows[i][0] || '');                  // col A = ID
    var meta = {};
    try { meta = JSON.parse(String(rows[i][9] || '{}') || '{}'); } catch(e_) {}
    if (meta.flight_status) statuses[id] = meta.flight_status;
  }
  return { ok: true, statuses: statuses };
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
