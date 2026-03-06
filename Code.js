// ============================================================
// VERA — Virtual Executive & Reminder Assistant
// Code.js — Main Entry Point
// ============================================================

// ---- CONFIG ----------------------------------------------------------------
// SHEET_ID: Paste your Life OS Google Sheet ID here after creating the sheet.
// CLAUDE_API_KEY is NOT stored here — it is loaded from Script Properties.
//   See setup instructions for how to set it safely.
// ----------------------------------------------------------------------------
const CONFIG = {
  SHEET_ID: '1FlNnxQltktinV1qnGQJ0QZ_4s5G4EA45GI61ul92er0',       // <-- Replace after creating your sheet
  CALENDAR_DAYS_AHEAD: 7,
  TASK_AGE_THRESHOLD: 7,                 // Days before a task is considered neglected
  MAX_FLAGS: 8,
  MORNING_NUDGE_EMAIL: 'aaeleraky@gmail.com',
  MORNING_NUDGE_HOUR: 7,
  NIGHTLY_RUN_HOUR: 23,
};

// ---- Tab Names -------------------------------------------------------------
const TABS = {
  FLAGS:        'Flags',
  TASKS:        'Tasks',
  SUMMARIES:    'Summaries',
  TRANSACTIONS: 'Transactions',
  CONFIG:       'Config',
};

// ---- Column Headers --------------------------------------------------------
const FLAG_HEADERS        = ['ID', 'Date', 'Source', 'Flag', 'Reason', 'Urgency', 'Acknowledged', 'Snoozed Until', 'Resolved'];
const TASK_HEADERS        = ['ID', 'Task', 'Added Date', 'Due Date', 'Status', 'Recurring', 'Notes', 'Flagged'];
const SUMMARY_HEADERS     = ['Source', 'Metric', 'Value', 'As Of'];
const TRANSACTION_HEADERS = ['Date', 'Account', 'Description', 'Category', 'Tags', 'Amount'];
const CONFIG_HEADERS      = ['Setting', 'Value'];

// ============================================================
// SETUP — Run once to create all sheet tabs
// ============================================================

/**
 * Run this function once after creating your Life OS sheet.
 * It creates all required tabs with headers and default config rows.
 */
function setupVERA() {
  const ss = getSpreadsheet();
  createSheetTabs(ss);
  setupTriggers();
  Logger.log('✅ VERA setup complete. All tabs created and triggers installed.');
  Logger.log('   Next step: set your CLAUDE_API_KEY in Script Properties.');
}

function getSpreadsheet() {
  if (CONFIG.SHEET_ID === 'YOUR_SHEET_ID_HERE') {
    throw new Error('SHEET_ID not configured. Open Code.js and replace YOUR_SHEET_ID_HERE with your actual Google Sheet ID.');
  }
  return SpreadsheetApp.openById(CONFIG.SHEET_ID);
}

function createSheetTabs(ss) {
  // Default Config rows
  const configDefaults = [
    ['calendar_days_ahead',    '7'],
    ['task_age_threshold_days','7'],
    ['max_flags_per_night',    '8'],
    ['morning_nudge_time',     '7'],
    ['snooze_default_days',    '2'],
    ['finance_review_day',     '1'],
    ['active_sources',         'Calendar,Tasks,Summaries'],
    ['skip_calendars',         'Holidays in United States'],
    // Add rows like: calendar_label:Eraky Family | family (shared, not Ahmed's direct obligations)
    // Add rows like: calendar_label:Ahmed         | personal
    // Add rows like: calendar_label:Victoria       | household partner
  ];

  ensureSheet(ss, TABS.FLAGS,        FLAG_HEADERS);
  ensureSheet(ss, TABS.TASKS,        TASK_HEADERS);
  ensureSheet(ss, TABS.SUMMARIES,    SUMMARY_HEADERS);
  ensureSheet(ss, TABS.TRANSACTIONS, TRANSACTION_HEADERS);
  ensureSheet(ss, TABS.CONFIG,       CONFIG_HEADERS, configDefaults);

  Logger.log('All VERA tabs verified/created.');
}

/**
 * Creates a sheet tab if it doesn't exist, writes headers, and optionally
 * seeds default rows. Skips header/data writing if content already exists.
 */
function ensureSheet(ss, name, headers, defaultRows) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    Logger.log('Created tab: ' + name);
  }

  // Only write headers if the sheet is blank
  if (sheet.getLastRow() === 0) {
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange
      .setFontWeight('bold')
      .setBackground('#1a1a2e')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);

    // Seed default data rows if provided and sheet is otherwise empty
    if (defaultRows && defaultRows.length > 0) {
      sheet.getRange(2, 1, defaultRows.length, defaultRows[0].length).setValues(defaultRows);
    }
  }

  return sheet;
}

// ============================================================
// TRIGGERS — Install time-based triggers programmatically
// ============================================================

/**
 * Creates the nightly (11pm) and morning nudge (7am) triggers.
 * Safe to call multiple times — deletes existing VERA triggers first.
 */
function setupTriggers() {
  // Remove any existing triggers for these functions to avoid duplicates
  const existingTriggers = ScriptApp.getProjectTriggers();
  existingTriggers.forEach(function(trigger) {
    const handlerName = trigger.getHandlerFunction();
    if (handlerName === 'nightlyRun' || handlerName === 'morningNudge') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Nightly run at 11pm
  ScriptApp.newTrigger('nightlyRun')
    .timeBased()
    .atHour(CONFIG.NIGHTLY_RUN_HOUR)
    .everyDays(1)
    .inTimezone(Session.getScriptTimeZone())
    .create();

  // Morning nudge at 7am
  ScriptApp.newTrigger('morningNudge')
    .timeBased()
    .atHour(CONFIG.MORNING_NUDGE_HOUR)
    .everyDays(1)
    .inTimezone(Session.getScriptTimeZone())
    .create();

  Logger.log('Triggers set: nightlyRun at 11pm, morningNudge at 7am.');
}

// ============================================================
// NIGHTLY RUN — Main intelligence pipeline
// ============================================================

/**
 * Main nightly function. Called by time-based trigger at 11pm.
 * Collects data → packages prompt → calls Claude → writes flags.
 */
function nightlyRun() {
  try {
    Logger.log('=== VERA nightly run started: ' + new Date() + ' ===');

    // Step 1: Collect
    const events    = getUpcomingEvents();
    const tasks     = getOpenTasks();
    const summaries = getSummaries();

    Logger.log('Data collected — Events: ' + events.length + ', Tasks: ' + tasks.length + ', Summaries: ' + summaries.length);

    // Step 2 & 3: Package + Reason (Claude)
    const flags = generateFlags(events, tasks, summaries);

    // Step 4: Write
    if (flags && flags.length > 0) {
      writeFlags(flags);
      Logger.log('Wrote ' + flags.length + ' flags to sheet.');
    } else {
      Logger.log('No flags generated tonight — nothing to write.');
    }

    Logger.log('=== VERA nightly run complete: ' + new Date() + ' ===');

  } catch (e) {
    Logger.log('VERA nightly run ERROR: ' + e.message + '\n' + e.stack);
    try {
      MailApp.sendEmail(
        CONFIG.MORNING_NUDGE_EMAIL,
        'VERA Error — Nightly Run Failed',
        'VERA encountered an error during the nightly run.\n\n' +
        'Error: ' + e.message + '\n\n' +
        'Stack:\n' + e.stack
      );
    } catch (mailErr) {
      Logger.log('Also failed to send error email: ' + mailErr.message);
    }
  }
}

// ============================================================
// WRITE FLAGS — Persist Claude's output to the Flags tab
// ============================================================

/**
 * Appends flag rows to the Flags tab and color-codes by urgency.
 * @param {Array} flags - Array of flag objects from generateFlags()
 */
function writeFlags(flags) {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.FLAGS);
  const today = new Date();
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const timestamp = dateStr.replace(/-/g, '');

  flags.forEach(function(flag, index) {
    const id = 'FLAG-' + timestamp + '-' + String(index + 1).padStart(2, '0');
    const row = [
      id,                     // A: ID
      dateStr,                // B: Date
      flag.source  || '',     // C: Source
      flag.flag    || '',     // D: Flag
      flag.reason  || '',     // E: Reason
      flag.urgency || 'Low',  // F: Urgency
      'No',                   // G: Acknowledged
      '',                     // H: Snoozed Until
      'No',                   // I: Resolved
    ];
    sheet.appendRow(row);
  });

  colorCodeFlags(sheet);
}

/**
 * Applies background color to flag rows based on urgency level.
 * High = red-tint, Medium = yellow-tint, Low = green-tint.
 */
function colorCodeFlags(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const urgencyCol = 6; // Column F
  const urgencyData = sheet.getRange(2, urgencyCol, lastRow - 1, 1).getValues();

  urgencyData.forEach(function(row, i) {
    const rowNum  = i + 2;
    const urgency = row[0];
    let bgColor   = '#ffffff';

    if (urgency === 'High')   bgColor = '#fce8e6'; // soft red
    if (urgency === 'Medium') bgColor = '#fef9e7'; // soft yellow
    if (urgency === 'Low')    bgColor = '#e6f4ea'; // soft green

    sheet.getRange(rowNum, 1, 1, FLAG_HEADERS.length).setBackground(bgColor);
  });
}

// ============================================================
// GET CONFIG VALUES — Read the Config tab into a key-value map
// ============================================================

/**
 * Reads all rows from the Config tab and returns them as a plain object.
 * Skips blank or malformed rows.
 *
 * Example output:
 * {
 *   "calendar_days_ahead": "7",
 *   "skip_calendars": "Holidays in United States",
 *   "calendar_label:Eraky Family": "family (shared, not Ahmed's direct obligations)",
 *   "calendar_label:Ahmed": "personal"
 * }
 *
 * @returns {Object} Key-value map of all Config settings
 */
function getConfigValues() {
  try {
    const ss    = getSpreadsheet();
    const sheet = ss.getSheetByName(TABS.CONFIG);
    if (!sheet || sheet.getLastRow() < 2) return {};

    const numRows = sheet.getLastRow() - 1;
    const data    = sheet.getRange(2, 1, numRows, 2).getValues();
    const config  = {};

    data.forEach(function(row) {
      const key   = String(row[0] || '').trim();
      const value = String(row[1] || '').trim();
      if (key !== '') config[key] = value;
    });

    return config;
  } catch (e) {
    Logger.log('getConfigValues error: ' + e.message);
    return {};
  }
}

// ============================================================
// GET SUMMARIES — Read from Summaries tab
// ============================================================

/**
 * Reads all rows from the Summaries tab.
 * @returns {Array} Array of {source, metric, value, asOf} objects
 */
function getSummaries() {
  try {
    const ss    = getSpreadsheet();
    const sheet = ss.getSheetByName(TABS.SUMMARIES);
    if (!sheet || sheet.getLastRow() < 2) return [];

    const numRows = sheet.getLastRow() - 1;
    const data    = sheet.getRange(2, 1, numRows, SUMMARY_HEADERS.length).getValues();

    return data
      .filter(function(row) { return row[0] !== ''; }) // skip blank rows
      .map(function(row) {
        return {
          source: String(row[0] || ''),
          metric: String(row[1] || ''),
          value:  String(row[2] || ''),
          asOf:   row[3] instanceof Date
            ? Utilities.formatDate(row[3], Session.getScriptTimeZone(), 'yyyy-MM-dd')
            : String(row[3] || ''),
        };
      });

  } catch (e) {
    Logger.log('getSummaries error: ' + e.message);
    return [];
  }
}

// ============================================================
// MORNING NUDGE — 7am email summary
// ============================================================

/**
 * Sends a brief morning email if there are unacknowledged flags.
 * Deliberately contains no flag details — detail lives in the sheet.
 */
function morningNudge() {
  try {
    const ss    = getSpreadsheet();
    const sheet = ss.getSheetByName(TABS.FLAGS);

    if (!sheet || sheet.getLastRow() < 2) {
      Logger.log('Morning nudge: no flags found, skipping email.');
      return;
    }

    const numRows = sheet.getLastRow() - 1;
    const data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();

    // Active = not acknowledged AND not resolved
    const active = data.filter(function(row) {
      const acknowledged = String(row[6]).toLowerCase();
      const resolved     = String(row[8]).toLowerCase();
      return acknowledged !== 'yes' && resolved !== 'yes';
    });

    const total     = active.length;
    const highCount = active.filter(function(r) { return r[5] === 'High';   }).length;
    const medCount  = active.filter(function(r) { return r[5] === 'Medium'; }).length;
    const lowCount  = active.filter(function(r) { return r[5] === 'Low';    }).length;

    if (total === 0) {
      Logger.log('Morning nudge: no active flags, skipping email.');
      return;
    }

    const subject = 'Good morning, Ahmed — VERA has ' + total + (total === 1 ? ' thing' : ' things') + ' for your attention';

    const lines = [
      'Good morning, Ahmed.',
      '',
      'VERA flagged ' + total + (total === 1 ? ' item' : ' items') + ' overnight:',
      '',
    ];
    if (highCount > 0) lines.push('  HIGH priority:   ' + highCount);
    if (medCount  > 0) lines.push('  MEDIUM priority: ' + medCount);
    if (lowCount  > 0) lines.push('  LOW priority:    ' + lowCount);
    lines.push('');
    lines.push('Open your VERA Life OS sheet to review and acknowledge flags.');
    lines.push('');
    lines.push('— VERA');

    MailApp.sendEmail(CONFIG.MORNING_NUDGE_EMAIL, subject, lines.join('\n'));
    Logger.log('Morning nudge sent: ' + total + ' active flags.');

  } catch (e) {
    Logger.log('morningNudge ERROR: ' + e.message);
  }
}

// ============================================================
// MANUAL TEST — Call this to do a full dry run before going live
// ============================================================

/**
 * Run this from the Apps Script editor to test the full pipeline manually.
 * Check the Execution Log and the Flags tab in your sheet after running.
 */
function testRun() {
  Logger.log('=== VERA MANUAL TEST RUN ===');
  nightlyRun();
  Logger.log('=== TEST RUN COMPLETE — check Flags tab and Execution Log above ===');
}
