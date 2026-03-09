// ============================================================
// VERA — Goals.js
// CRUD operations for the Goals tab (Yearly Goals Kanban)
// ============================================================

const GOAL_COL = {
  ID:          0,
  TITLE:       1,
  DESCRIPTION: 2,
  STATUS:      3,
  CATEGORY:    4,
  YEAR:        5,
  PROGRESS:    6,
  NOTES:       7,
};

const GOAL_STATUSES = ['Resolutions', 'To Do', 'Doing', 'Parked', 'Done'];

// ============================================================
// READ
// ============================================================

/**
 * Returns all goal rows as an array of objects.
 * Skips blank rows.
 */
function getGoals_() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.GOALS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, GOAL_HEADERS.length).getValues();

  return data
    .map(function(row, i) { return { row: i + 2, data: row }; })
    .filter(function(r) { return String(r.data[GOAL_COL.ID] || '').trim() !== ''; })
    .map(function(r) {
      const row = r.data;
      return {
        id:          String(row[GOAL_COL.ID]          || ''),
        title:       String(row[GOAL_COL.TITLE]       || ''),
        description: String(row[GOAL_COL.DESCRIPTION] || ''),
        status:      String(row[GOAL_COL.STATUS]      || 'To Do'),
        category:    String(row[GOAL_COL.CATEGORY]    || ''),
        year:        row[GOAL_COL.YEAR] ? Number(row[GOAL_COL.YEAR]) : new Date().getFullYear(),
        progress:    row[GOAL_COL.PROGRESS] !== '' ? Number(row[GOAL_COL.PROGRESS]) : 0,
        notes:       String(row[GOAL_COL.NOTES]       || ''),
        rowNum:      r.row,
      };
    });
}

// ============================================================
// CREATE
// ============================================================

/**
 * Appends a new goal row and returns the created goal object.
 */
function createGoal_(title, description, status, category, year, notes) {
  if (!title || title.trim() === '') throw new Error('Goal title is required.');

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.GOALS);
  if (!sheet) throw new Error('Goals tab not found. Run setupVERA() first.');

  const tz        = Session.getScriptTimeZone();
  const dateStr   = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  const lastRow   = sheet.getLastRow();
  const seqNum    = Math.max(1, lastRow); // simple incrementing suffix
  const id        = 'GOAL-' + dateStr + '-' + String(seqNum).padStart(2, '0');
  const goalYear  = year ? Number(year) : new Date().getFullYear();
  const goalStatus = GOAL_STATUSES.indexOf(status) !== -1 ? status : 'To Do';

  const row = [
    id,
    String(title       || '').trim(),
    String(description || '').trim(),
    goalStatus,
    String(category    || '').trim(),
    goalYear,
    0,  // progress starts at 0
    String(notes       || '').trim(),
  ];

  sheet.appendRow(row);
  Logger.log('createGoal_: created ' + id + ' — ' + title);

  return {
    id:          id,
    title:       row[GOAL_COL.TITLE],
    description: row[GOAL_COL.DESCRIPTION],
    status:      row[GOAL_COL.STATUS],
    category:    row[GOAL_COL.CATEGORY],
    year:        goalYear,
    progress:    0,
    notes:       row[GOAL_COL.NOTES],
    rowNum:      sheet.getLastRow(),
  };
}

// ============================================================
// UPDATE
// ============================================================

/**
 * Updates one or more fields of a goal identified by ID.
 * Only fields present in the `fields` object are written.
 * Returns the updated goal object, or null if not found.
 */
function updateGoal_(id, fields) {
  if (!id) throw new Error('Goal ID is required.');

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.GOALS);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, GOAL_HEADERS.length).getValues();

  let targetRow = -1;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][GOAL_COL.ID]).trim() === String(id).trim()) {
      targetRow = i + 2; // 1-indexed + header
      break;
    }
  }

  if (targetRow === -1) {
    Logger.log('updateGoal_: ID not found — ' + id);
    return null;
  }

  const colMap = {
    title:       GOAL_COL.TITLE       + 1,
    description: GOAL_COL.DESCRIPTION + 1,
    status:      GOAL_COL.STATUS      + 1,
    category:    GOAL_COL.CATEGORY    + 1,
    year:        GOAL_COL.YEAR        + 1,
    progress:    GOAL_COL.PROGRESS    + 1,
    notes:       GOAL_COL.NOTES       + 1,
  };

  Object.keys(fields).forEach(function(key) {
    if (colMap[key]) {
      let val = fields[key];
      if (key === 'status' && GOAL_STATUSES.indexOf(val) === -1) return;
      if (key === 'progress') val = Math.min(100, Math.max(0, Number(val) || 0));
      if (key === 'year')     val = Number(val) || new Date().getFullYear();
      sheet.getRange(targetRow, colMap[key]).setValue(val);
    }
  });

  Logger.log('updateGoal_: updated ' + id + ' — ' + JSON.stringify(fields));

  // Re-read and return updated row
  const updated = sheet.getRange(targetRow, 1, 1, GOAL_HEADERS.length).getValues()[0];
  return {
    id:          String(updated[GOAL_COL.ID]),
    title:       String(updated[GOAL_COL.TITLE]),
    description: String(updated[GOAL_COL.DESCRIPTION]),
    status:      String(updated[GOAL_COL.STATUS]),
    category:    String(updated[GOAL_COL.CATEGORY]),
    year:        Number(updated[GOAL_COL.YEAR]) || new Date().getFullYear(),
    progress:    Number(updated[GOAL_COL.PROGRESS]) || 0,
    notes:       String(updated[GOAL_COL.NOTES]),
    rowNum:      targetRow,
  };
}

// ============================================================
// DELETE
// ============================================================

/**
 * Deletes the row for the given goal ID.
 * Returns true if found and deleted, false if not found.
 */
function deleteGoal_(id) {
  if (!id) throw new Error('Goal ID is required.');

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.GOALS);
  if (!sheet || sheet.getLastRow() < 2) return false;

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, 1).getValues();

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(id).trim()) {
      sheet.deleteRow(i + 2);
      Logger.log('deleteGoal_: deleted ' + id);
      return true;
    }
  }

  Logger.log('deleteGoal_: ID not found — ' + id);
  return false;
}
