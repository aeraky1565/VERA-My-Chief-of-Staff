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
 * Skips any flag whose source + text fingerprint matches an existing
 * unresolved flag, to prevent nightly duplicates for ongoing issues.
 * @param {Array} flags - Array of flag objects from generateFlags()
 */
function writeFlags(flags) {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.FLAGS);
  const today = new Date();
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const timestamp = dateStr.replace(/-/g, '');

  // Build fingerprint set of all existing unresolved flags
  const existing = getExistingFlagFingerprints_(sheet);

  let written = 0;
  let skipped = 0;
  let seqNum  = 1;

  flags.forEach(function(flag) {
    const fp = makeFlagFingerprint_(flag.source, flag.flag);

    if (existing.has(fp)) {
      Logger.log('Dedup: skipping existing flag [' + flag.source + '] ' + flag.flag);
      skipped++;
      return;
    }

    const id = 'FLAG-' + timestamp + '-' + String(seqNum).padStart(2, '0');
    seqNum++;

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
    existing.add(fp); // Prevent dupes within the same batch
    written++;
  });

  if (written > 0) colorCodeFlags(sheet);
  Logger.log('writeFlags: ' + written + ' new flags written, ' + skipped + ' duplicates skipped.');
}

/**
 * Returns a Set of fingerprints for all unresolved flags currently in the sheet.
 * Resolved flags are excluded so a recurring issue can be re-flagged after resolution.
 */
function getExistingFlagFingerprints_(sheet) {
  const fingerprints = new Set();
  if (!sheet || sheet.getLastRow() < 2) return fingerprints;

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();

  data.forEach(function(row) {
    const resolved = String(row[8] || '').toLowerCase();
    if (resolved === 'yes') return; // Resolved = allow re-flagging if it recurs
    fingerprints.add(makeFlagFingerprint_(row[2], row[3]));
  });

  return fingerprints;
}

/**
 * Creates a short fingerprint from source + first 8 words of flag text.
 * Strips punctuation and lowercases so minor wording changes don't create dupes.
 */
function makeFlagFingerprint_(source, flagText) {
  const src  = String(source   || '').toLowerCase().trim();
  const text = String(flagText || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 8)
    .join(' ');
  return src + '|' + text;
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
 * Sends a branded HTML morning email if there are unacknowledged flags.
 * Includes VERA logo (loaded from Drive via VERA_LOGO_FILE_ID script property),
 * urgency breakdown, and a plain-text fallback.
 * Sender display name is set to "VERA".
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

    // ---- Build urgency rows for HTML ------------------------------------
    function urgencyRow(color, dot, label, count) {
      return count > 0
        ? '<tr><td style="padding:6px 0;">' +
            '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + color + ';margin-right:10px;vertical-align:middle;"></span>' +
            '<span style="font-size:15px;color:#333333;vertical-align:middle;">' + label + ': <strong>' + count + '</strong></span>' +
          '</td></tr>'
        : '';
    }

    const urgencyRows =
      urgencyRow('#e53935', '●', 'High priority',   highCount) +
      urgencyRow('#f9a825', '●', 'Medium priority', medCount)  +
      urgencyRow('#43a047', '●', 'Low priority',    lowCount);

    // ---- Try to load logo from Drive ------------------------------------
    let inlineImages = {};
    let logoTag = '';
    try {
      const logoFileId = PropertiesService.getScriptProperties().getProperty('VERA_LOGO_FILE_ID');
      if (logoFileId) {
        const logoBlob = DriveApp.getFileById(logoFileId).getBlob();
        inlineImages = { veraLogo: logoBlob };
        logoTag = '<img src="cid:veraLogo" alt="VERA" style="width:100%;display:block;border:0;" />';
      }
    } catch (logoErr) {
      Logger.log('Logo load failed (continuing without it): ' + logoErr);
    }

    // ---- Optional dashboard button (set VERA_DASHBOARD_URL in Script Properties) ----
    const dashboardUrl = PropertiesService.getScriptProperties().getProperty('VERA_DASHBOARD_URL') || '';
    const dashboardBtn = dashboardUrl
      ? '<tr><td style="padding:0 0 24px 0;">' +
          '<a href="' + dashboardUrl + '" style="display:inline-block;background:#0d1b3e;color:#c9a84c;font-size:14px;font-weight:700;letter-spacing:1px;padding:12px 28px;border-radius:6px;text-decoration:none;border:2px solid #c9a84c;">Open VERA Dashboard &rarr;</a>' +
        '</td></tr>'
      : '';
    const dashboardPlainText = dashboardUrl ? '\nDashboard: ' + dashboardUrl : '';

    // ---- HTML body ------------------------------------------------------
    const htmlBody =
      '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f0f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;">' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f5;padding:24px 0;">' +
      '<tr><td align="center">' +
      '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);">' +

      // Logo header
      (logoTag
        ? '<tr><td style="padding:0;background:#0d1b3e;">' + logoTag + '</td></tr>'
        : '<tr><td style="padding:24px 40px;background:#0d1b3e;text-align:center;"><span style="color:#ffffff;font-size:28px;font-weight:bold;letter-spacing:4px;">VERA</span><br><span style="color:#c9a84c;font-size:11px;letter-spacing:2px;">YOUR PERSONAL CHIEF OF STAFF</span></td></tr>') +

      // Body
      '<tr><td style="padding:36px 40px;">' +
      '<p style="margin:0 0 8px;font-size:17px;font-weight:600;color:#0d1b3e;">Good morning, Ahmed.</p>' +
      '<p style="margin:0 0 24px;font-size:15px;color:#555555;">VERA flagged <strong>' + total + ' item' + (total === 1 ? '' : 's') + '</strong> overnight requiring your attention.</p>' +
      '<table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">' + urgencyRows + '</table>' +
      '<table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">' + dashboardBtn + '</table>' +
      '<p style="margin:0;font-size:14px;color:#888888;">Or open your <a href="https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '" style="color:#0d1b3e;font-weight:bold;text-decoration:underline;">VERA Life OS sheet</a> directly.</p>' +
      '</td></tr>' +

      // Footer
      '<tr><td style="padding:16px 40px;background:#f7f7fa;border-top:1px solid #eeeeee;">' +
      '<p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">Sent by VERA &mdash; Virtual Executive &amp; Reminder Assistant</p>' +
      '</td></tr>' +

      '</table></td></tr></table></body></html>';

    // ---- Plain text fallback --------------------------------------------
    const plainText = [
      'Good morning, Ahmed.',
      '',
      'VERA flagged ' + total + (total === 1 ? ' item' : ' items') + ' overnight:',
      '',
      highCount > 0 ? '  High priority:   ' + highCount : '',
      medCount  > 0 ? '  Medium priority: ' + medCount  : '',
      lowCount  > 0 ? '  Low priority:    ' + lowCount  : '',
      '',
      'Open your VERA Life OS sheet to review and acknowledge flags:',
      'https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID,
      dashboardPlainText,
      '',
      '— VERA',
    ].filter(function(l) { return l !== false; }).join('\n');

    // ---- Send -----------------------------------------------------------
    const mailOptions = {
      name:        'VERA',
      htmlBody:    htmlBody,
      inlineImages: inlineImages,
    };

    MailApp.sendEmail(CONFIG.MORNING_NUDGE_EMAIL, subject, plainText, mailOptions);
    Logger.log('Morning nudge sent (HTML): ' + total + ' active flags.');

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
