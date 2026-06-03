// ChoresForOthers.js — Issue #180
// Tracks one-off chores/tasks assigned to neighbor kids or other helpers.

var CHORES_FOR_OTHERS_HEADERS = ['ID', 'Task', 'Assignee', 'Reward', 'Status', 'Added Date', 'Notes'];

// ---- Read -------------------------------------------------------------------

function getChoresForOthers_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.CHORES_FOR_OTHERS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, CHORES_FOR_OTHERS_HEADERS.length).getValues();
  var hdrs    = CHORES_FOR_OTHERS_HEADERS;
  return data
    .map(function(row, i) {
      var obj = { _row: i + 2 };
      hdrs.forEach(function(h, j) { obj[h] = row[j]; });
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
      return { ok: true, id: id };
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
