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

    // ---- Deduplication: skip rows whose Column A ID already appeared --------
    // If the same ID is entered in the sheet twice (e.g. copy-paste error),
    // keep only the first occurrence.  Row-based fallback IDs (TASK-Rn) are
    // never considered explicit IDs so they don't trigger dedup against each other.
    const idSeen  = {};
    const deduped = [];
    tasks.forEach(function(t) {
      const hasExplicitId = t.id.indexOf('TASK-R') !== 0;
      if (hasExplicitId) {
        const norm = t.id.toLowerCase().trim();
        if (idSeen[norm]) {
          Logger.log('Tasks: dedup — duplicate ID "' + t.id + '" ignored (keeping first row).');
          return;
        }
        idSeen[norm] = true;
      }
      deduped.push(t);
    });

    // Sort: overdue first → then by age descending (oldest neglected tasks surface first)
    deduped.sort(function(a, b) {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return b.ageInDays - a.ageInDays;
    });

    Logger.log('Tasks: ' + deduped.length + ' open tasks found (' +
      deduped.filter(function(t) { return t.isOverdue;    }).length + ' overdue, ' +
      deduped.filter(function(t) { return t.isNeglected;  }).length + ' neglected).');

    return deduped;

  } catch (e) {
    Logger.log('getOpenTasks error: ' + e.message);
    return [];
  }
}

// ============================================================
// SUGGEST DUE DATES — Ask Claude to fill in missing due dates
// ============================================================

/**
 * For tasks with no due date, calls Claude to suggest one, then writes
 * the suggestion back to the Tasks tab (Due Date column).
 * Also prepends a "[VERA: reason]" tag to the Notes column so the user
 * knows the date was auto-suggested and why.
 *
 * @param {Array} tasks - From getOpenTasks()
 * @returns {number} Number of due dates written
 */
function suggestDueDates(tasks) {
  const undated = tasks.filter(function(t) { return !t.dueDate || t.dueDate.trim() === ''; });
  if (undated.length === 0) {
    Logger.log('suggestDueDates: all tasks already have due dates.');
    return 0;
  }

  Logger.log('suggestDueDates: requesting due dates for ' + undated.length + ' undated task(s).');

  const tz       = Session.getScriptTimeZone();
  const todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const todayFmt = Utilities.formatDate(new Date(), tz, 'EEEE, MMMM d, yyyy');

  // Build a compact JSON description of each undated task for the prompt
  const taskLines = undated.map(function(t) {
    const obj = { id: t.id, task: t.task };
    if (t.ageInDays > 0)  obj.age_days  = t.ageInDays;
    if (t.notes)          obj.notes     = t.notes;
    if (t.recurring)      obj.recurring = t.recurring;
    return JSON.stringify(obj);
  }).join('\n');

  const prompt =
    'Today is ' + todayFmt + ' (' + todayStr + ').\n\n' +
    'Suggest a realistic due date for each undated task below. Consider:\n' +
    '- Task urgency and type (admin, shopping, planning, health, etc.)\n' +
    '- How long the task has been open (age_days field)\n' +
    '- Whether the task recurs regularly\n' +
    'All suggested dates must be in the future (on or after ' + todayStr + ').\n\n' +
    'Tasks:\n' + taskLines + '\n\n' +
    'Return ONLY a raw JSON array. No markdown, no explanation. Each object:\n' +
    '{"id":"<task id>","suggestedDueDate":"YYYY-MM-DD","reason":"brief 1-sentence rationale"}';

  // ---- Call Claude ---------------------------------------------------------
  const apiKey = getApiKey();
  const fetchOptions = {
    method:             'post',
    contentType:        'application/json',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }],
    }),
    muteHttpExceptions: true,
  };

  const response = fetchTracked_('anthropic', CLAUDE_API_URL, fetchOptions);
  if (response.getResponseCode() !== 200) {
    Logger.log('suggestDueDates: Claude API error ' + response.getResponseCode() + ' — ' + response.getContentText().substring(0, 200));
    return 0;
  }

  // ---- Parse response -------------------------------------------------------
  let suggestions;
  try {
    const apiJson = JSON.parse(response.getContentText());
    let raw = apiJson.content[0].text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const startIdx = raw.indexOf('[');
    const endIdx   = raw.lastIndexOf(']');
    if (startIdx === -1 || endIdx === -1) throw new Error('No JSON array found');
    suggestions = JSON.parse(raw.substring(startIdx, endIdx + 1));
  } catch (e) {
    Logger.log('suggestDueDates: failed to parse Claude response — ' + e.message);
    return 0;
  }

  if (!Array.isArray(suggestions) || suggestions.length === 0) return 0;

  // ---- Write back to sheet -------------------------------------------------
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.TASKS);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, TASK_HEADERS.length).getValues();

  // Map task ID → sheet row number (1-indexed, accounting for header)
  const rowMap = {};
  data.forEach(function(row, i) {
    const id = String(row[0] || '').trim();
    if (id) rowMap[id] = i + 2;
  });

  const DUE_DATE_COL = 4; // Column D
  const NOTES_COL    = 7; // Column G

  let written = 0;
  suggestions.forEach(function(s) {
    if (!s.id || !s.suggestedDueDate) return;

    // Validate date format (YYYY-MM-DD) and that it is not in the past
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.suggestedDueDate)) return;
    if (s.suggestedDueDate < todayStr) return;

    const rowNum = rowMap[String(s.id).trim()];
    if (!rowNum) return;

    // Only write if the Due Date cell is still blank (don't overwrite manual entries)
    const existing = String(sheet.getRange(rowNum, DUE_DATE_COL).getValue() || '').trim();
    if (existing !== '') return;

    sheet.getRange(rowNum, DUE_DATE_COL).setValue(s.suggestedDueDate);

    const veraNote  = '[VERA: ' + (s.reason || 'auto-suggested due date') + ']';
    const notesCell = sheet.getRange(rowNum, NOTES_COL);
    const notesCur  = String(notesCell.getValue() || '').trim();
    notesCell.setValue(notesCur ? veraNote + '  ' + notesCur : veraNote);

    Logger.log('suggestDueDates: ' + s.id + ' → ' + s.suggestedDueDate + ' (' + (s.reason || '') + ')');
    written++;
  });

  Logger.log('suggestDueDates: ' + written + ' due date(s) written to Tasks tab.');
  return written;
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
