// ============================================================
// VERA — Tasks.js
// Reads open tasks from the Tasks tab of the Life OS sheet
// ============================================================

/**
 * Reads all non-completed tasks from the Tasks tab.
 * Calculates age, overdue status, and recurring flags.
 * Returns tasks sorted with overdue first, then by age descending.
 *
 * @returns {Array} Array of task objects:
 *   { id, task, addedDate, dueDate, status, recurring, notes,
 *     ageInDays, isOverdue, daysUntilDue, isNeglected }
 */
function getOpenTasks() {
  try {
    const ss    = getSpreadsheet();
    const sheet = ss.getSheetByName(TABS.TASKS);

    if (!sheet || sheet.getLastRow() < 2) {
      Logger.log('Tasks: sheet empty or missing.');
      return [];
    }

    const numRows = sheet.getLastRow() - 1;
    const data    = sheet.getRange(2, 1, numRows, TASK_HEADERS.length).getValues();

    // Normalize "today" to midnight for consistent date math
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const DONE_STATUSES = ['done', 'complete', 'completed', 'cancelled', 'canceled'];

    const tasks = [];

    data.forEach(function(row, index) {
      const id        = row[0];
      const taskText  = row[1];
      const addedRaw  = row[2];
      const dueRaw    = row[3];
      const status    = String(row[4] || 'Open');
      const recurring = row[5];
      const notes     = row[6];

      // Skip blank rows
      if (!taskText || String(taskText).trim() === '') return;

      // Skip completed / cancelled tasks
      if (DONE_STATUSES.indexOf(status.toLowerCase()) !== -1) return;

      // ---- Age calculation ------------------------------------------------
      let ageInDays = 0;
      const addedDate = parseFlexibleDate(addedRaw);
      if (addedDate) {
        ageInDays = Math.floor((today - addedDate) / (1000 * 60 * 60 * 24));
        ageInDays = Math.max(0, ageInDays); // no negative ages
      }

      // ---- Due date / overdue ---------------------------------------------
      let isOverdue    = false;
      let daysUntilDue = null;
      const dueDate    = parseFlexibleDate(dueRaw);
      if (dueDate) {
        daysUntilDue = Math.floor((dueDate - today) / (1000 * 60 * 60 * 24));
        isOverdue    = daysUntilDue < 0;
      }

      // ---- Recurring flag -------------------------------------------------
      const recurringStr = String(recurring || '').trim().toLowerCase();
      const isRecurring  = recurringStr !== '' && recurringStr !== 'no' && recurringStr !== 'false' && recurringStr !== '0';

      // ---- Neglected flag -------------------------------------------------
      const isNeglected = ageInDays >= CONFIG.TASK_AGE_THRESHOLD;

      tasks.push({
        id:          String(id || '') || ('TASK-R' + (index + 2)), // fallback: row-based ID
        task:        String(taskText),
        addedDate:   addedDate ? Utilities.formatDate(addedDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(addedRaw || ''),
        dueDate:     dueDate   ? Utilities.formatDate(dueDate,   Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(dueRaw   || ''),
        status:      status,
        recurring:   isRecurring ? String(recurring) : '',
        notes:       String(notes || ''),
        ageInDays:   ageInDays,
        isOverdue:   isOverdue,
        daysUntilDue: daysUntilDue,
        isNeglected: isNeglected,
      });
    });

    // Sort: overdue first → then by age descending (oldest neglected tasks surface first)
    tasks.sort(function(a, b) {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return b.ageInDays - a.ageInDays;
    });

    Logger.log('Tasks: ' + tasks.length + ' open tasks found (' +
      tasks.filter(function(t) { return t.isOverdue;    }).length + ' overdue, ' +
      tasks.filter(function(t) { return t.isNeglected;  }).length + ' neglected).');

    return tasks;

  } catch (e) {
    Logger.log('getOpenTasks error: ' + e.message);
    return [];
  }
}

// ============================================================
// Helper — parse dates from sheet cells flexibly
// ============================================================

/**
 * Converts a spreadsheet cell value into a Date at midnight local time.
 * Handles: Date objects (from Google Sheets date cells), date strings,
 * and numeric serial dates. Returns null if unparseable.
 *
 * @param {*} raw - Raw cell value from getValues()
 * @returns {Date|null}
 */
function parseFlexibleDate(raw) {
  if (!raw || raw === '') return null;

  // Already a proper Date object (how Sheets returns typed date cells)
  if (raw instanceof Date) {
    const d = new Date(raw);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // String — try native parse
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      return parsed;
    }
  }

  // Number — could be a Google Sheets serial date (days since Dec 30, 1899)
  if (typeof raw === 'number') {
    // Google Sheets epoch: December 30, 1899
    const msPerDay  = 24 * 60 * 60 * 1000;
    const epoch     = new Date(1899, 11, 30); // Dec 30, 1899
    const parsed    = new Date(epoch.getTime() + raw * msPerDay);
    if (!isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      return parsed;
    }
  }

  return null;
}
