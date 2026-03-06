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
      case 'acknowledge': return jsonOut_(webAcknowledge_(id));
      case 'snooze':      return jsonOut_(webSnooze_(id, days));
      case 'resolve':     return jsonOut_(webResolve_(id));
      default:            return errOut_('Unknown action: ' + action);
    }
  } catch (err) {
    Logger.log('doGet error: ' + err.message + '\n' + err.stack);
    return errOut_('Server error: ' + err.message, 500);
  }
}

// ---- doPost — write operations ---------------------------------------------

function doPost(e) {
  if (!isAuthorized_(e)) return errOut_('Unauthorized', 401);

  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    return errOut_('Invalid JSON body: ' + parseErr.message);
  }

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
