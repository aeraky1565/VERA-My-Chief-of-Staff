// ChoresForOthers.js — Issue #180
// Tracks one-off chores/tasks assigned to neighbor kids or other helpers.

var CHORES_FOR_OTHERS_HEADERS = ['ID', 'Task', 'Assignee', 'Reward', 'Status', 'Added Date', 'Notes'];
// After Notes, added the first time they're written: when it was done, and when its reward was paid.
var CFO_DONE_COL_ = 8, CFO_PAID_COL_ = 9;

/** Pure: a reward as dollars when it's money ("$10", "10", "$7.50"), else null ("movie night"). */
function cfoAmount_(reward) {
  var m = /^\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd)?\s*$/i.exec(String(reward == null ? '' : reward));
  return m ? Number(m[1]) : null;
}

function cfoEnsureCols_(sheet) {
  if (sheet.getMaxColumns() < CFO_PAID_COL_) sheet.insertColumnsAfter(sheet.getMaxColumns(), CFO_PAID_COL_ - sheet.getMaxColumns());
  var h = sheet.getRange(1, CFO_DONE_COL_, 1, 2).getValues()[0];
  if (!String(h[0]).trim() || !String(h[1]).trim()) sheet.getRange(1, CFO_DONE_COL_, 1, 2).setValues([['Done Date', 'Paid']]);
}

function cfoToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function cfoYmd_(v) { return Object.prototype.toString.call(v) === '[object Date]' ? (isNaN(v.getTime()) ? '' : Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd')) : String(v == null ? '' : v).trim().slice(0, 10); }

// ---- Read -------------------------------------------------------------------

function getChoresForOthers_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CHORES_FOR_OTHERS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, Math.min(CFO_PAID_COL_, sheet.getMaxColumns())).getValues();
  var hdrs    = CHORES_FOR_OTHERS_HEADERS;
  return data
    .map(function(row, i) {
      var obj = { _row: i + 2 };
      hdrs.forEach(function(h, j) { obj[h] = h === 'Added Date' ? cfoYmd_(row[j]) : row[j]; });
      obj['Done Date'] = cfoYmd_(row[CFO_DONE_COL_ - 1]);
      obj.Paid = cfoYmd_(row[CFO_PAID_COL_ - 1]);
      obj.amount = cfoAmount_(obj.Reward);
      return obj;
    })
    .filter(function(o) { return String(o.ID || '').trim() !== ''; });
}

// ---- Add --------------------------------------------------------------------

function addChoreForOthers_(task, assignee, reward, notes) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CHORES_FOR_OTHERS);
  if (!sheet) throw new Error('ChoresForOthers tab not found. Run addChoresForOthersTab() first.');

  var today   = new Date();
  var dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd');

  // Sequential ID for today
  var existingIds = [];
  if (sheet.getLastRow() >= 2) {
    var idData = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    idData.forEach(function(r) {
      var v = String(r[0] || '').trim();
      if (v.indexOf('CFO-' + dateStr) === 0) existingIds.push(v);
    });
  }
  var id = 'CFO-' + dateStr + '-' + String(existingIds.length + 1).padStart(2, '0');

  var isoDate = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.appendRow([id, task, assignee || '', reward || '', 'Open', isoDate, notes || '']);
  return { ok: true, id: id };
}

// ---- Complete ---------------------------------------------------------------

function completeChoreForOthers_(id) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CHORES_FOR_OTHERS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('ChoresForOthers tab not found or empty.');

  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === id) {
      sheet.getRange(i + 2, 5).setValue('Done'); // Status column
      cfoEnsureCols_(sheet);
      sheet.getRange(i + 2, CFO_DONE_COL_).setValue(cfoToday_());
      return { ok: true, id: id, doneDate: cfoToday_() };
    }
  }
  throw new Error('Chore not found: ' + id);
}

// ---- Update -----------------------------------------------------------------

function updateChoreForOthers_(id, fields) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CHORES_FOR_OTHERS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('ChoresForOthers tab not found or empty.');

  var colMap = { Task: 2, Assignee: 3, Reward: 4, Status: 5, Notes: 7 };
  var numRows = sheet.getLastRow() - 1;
  var idData  = sheet.getRange(2, 1, numRows, 1).getValues();
  for (var i = 0; i < idData.length; i++) {
    if (String(idData[i][0]).trim() === id) {
      var rowNum = i + 2;
      Object.keys(fields).forEach(function(f) {
        if (colMap[f]) sheet.getRange(rowNum, colMap[f]).setValue(fields[f]);
      });
      return { ok: true, id: id };
    }
  }
  throw new Error('Chore not found: ' + id);
}

// ---- Paid -------------------------------------------------------------------

/** Marks rewards paid: one chore (id), or every done, unpaid one of an assignee. → {ok, paid:[ids], total} */
function payChoresForOthers_(id, assignee) {
  var sheet = getSpreadsheet().getSheetByName(TABS.CHORES_FOR_OTHERS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('ChoresForOthers tab not found or empty.');
  if (!id && !assignee) throw new Error('id or assignee required');
  cfoEnsureCols_(sheet);
  var n = sheet.getLastRow() - 1, rows = sheet.getRange(2, 1, n, CFO_PAID_COL_).getValues(), today = cfoToday_(), paid = [], total = 0;
  rows.forEach(function(r, i) {
    var match = id ? String(r[0]).trim() === id : String(r[2]).trim().toLowerCase() === String(assignee).trim().toLowerCase();
    if (!match || String(r[4]).trim() !== 'Done' || String(r[CFO_PAID_COL_ - 1]).trim()) return;
    sheet.getRange(i + 2, CFO_PAID_COL_).setValue(today);
    paid.push(String(r[0]).trim()); total += cfoAmount_(r[3]) || 0;
  });
  if (id && !paid.length) throw new Error('Nothing to pay for ' + id + ' (not done yet, or already paid)');
  return { ok: true, paid: paid, total: Math.round(total * 100) / 100, date: today };
}

// ---- Delete -----------------------------------------------------------------

function deleteChoreForOthers_(id) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CHORES_FOR_OTHERS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('ChoresForOthers tab not found or empty.');

  var numRows = sheet.getLastRow() - 1;
  var idData  = sheet.getRange(2, 1, numRows, 1).getValues();
  for (var i = 0; i < idData.length; i++) {
    if (String(idData[i][0]).trim() === id) {
      sheet.deleteRow(i + 2);
      return { ok: true, id: id };
    }
  }
  throw new Error('Chore not found: ' + id);
}

// ---- Setup ------------------------------------------------------------------

function addChoresForOthersTab() {
  var ss    = getSpreadsheet();
  var existing = ss.getSheetByName(TABS.CHORES_FOR_OTHERS);
  if (existing) { Logger.log('ChoresForOthers tab already exists.'); return; }
  var sheet = ss.insertSheet(TABS.CHORES_FOR_OTHERS);
  sheet.appendRow(CHORES_FOR_OTHERS_HEADERS);
  sheet.getRange(1, 1, 1, CHORES_FOR_OTHERS_HEADERS.length).setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  Logger.log('ChoresForOthers tab created.');
}
