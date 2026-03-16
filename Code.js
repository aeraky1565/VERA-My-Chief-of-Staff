// ============================================================
// VERA — Virtual Executive & Reminder Assistant
// Code.js — Main Entry Point
// ============================================================

// ---- CONFIG ----------------------------------------------------------------
// SHEET_ID and MORNING_NUDGE_EMAIL are loaded from Script Properties.
// CLAUDE_API_KEY is NOT stored here — it is loaded from Script Properties.
//   In Apps Script editor: Project Settings → Script Properties → Add:
//     VERA_SHEET_ID      → your Life OS Google Sheet ID
//     MORNING_NUDGE_EMAIL → your email address
// ----------------------------------------------------------------------------
const CONFIG = {
  SHEET_ID: PropertiesService.getScriptProperties().getProperty('VERA_SHEET_ID') || '',
  CALENDAR_DAYS_AHEAD: 7,
  TASK_AGE_THRESHOLD: 7,                 // Days before a task is considered neglected
  MAX_FLAGS: 8,
  MORNING_NUDGE_EMAIL: PropertiesService.getScriptProperties().getProperty('MORNING_NUDGE_EMAIL') || '',
  MORNING_NUDGE_HOUR: 7,
  NIGHTLY_RUN_HOUR: 23,
};

// ---- Tab Names -------------------------------------------------------------
const TABS = {
  FLAGS:        'Flags',
  TASKS:        'Tasks',
  METRICS:      'Metrics',      // Auto-populated VERA health counts (Tasks, Calendar, Flags)
  SUMMARIES:    'Summaries',    // External life intelligence feed (Finance, Fitness, Kenz Box, etc.)
  CONFIG:       'Config',
  PROJECTS:     'Projects',     // Multi-step projects with Claude-generated subtasks
  GOALS:            'Goals',            // Yearly goals Kanban board
  PTO:              'PTO',              // PTO planner snapshot (written nightly by writePTOSnapshot_)
  PTO_MEMORY:       'PTO Memory',       // Stateful PTO suggestion history (declined windows blacklist)
  REMINDERS_MEMORY: 'Reminders Memory', // Reminders.js cooldown log (Anticipator + Explorer)
  INTEREST_LEDGER:  'Shared Interests', // Shared Interest Ledger (Issue #28)
  BILLS:            'Bills',            // Recurring bill tracker (Issue #57)
  RECIPES:          'Recipes',          // Recipe list (Issue #46)
  HOME_ITEMS:       'Home Items',       // Warranties + service log (Issue #21)
  IDEAS:            'Ideas',            // Braindump repo (Issue #18)
  ITINERARY:        'Itinerary',        // Trip itinerary items (Issue #63)
  TRIP_META:        'TripMeta',         // Trip context / sentiment notes (Issue #64)
  PACKING_ITEMS:    'PackingItems',     // Per-trip packing list items (Issue #64)
  COUNTRIES:        'Countries',        // Countries visited tracker (Issue #74)
  BUCKET_LIST:      'Bucket List',      // Travel bucket list (wishlist of destinations)
};

// ---- Column Headers --------------------------------------------------------
const FLAG_HEADERS        = ['ID', 'Date', 'Source', 'Flag', 'Reason', 'Urgency', 'Acknowledged', 'Snoozed Until', 'Resolved', 'Key', 'Escalated'];
const PROJECT_HEADERS     = ['Project ID', 'Project Name', 'Task', 'Status', 'Priority', 'Due Date', 'Notes'];
const TASK_HEADERS        = ['ID', 'Task', 'Added Date', 'Due Date', 'Status', 'Recurring', 'Notes', 'Flagged'];
const METRIC_HEADERS      = ['Source', 'Metric', 'Value', 'As Of'];  // Metrics tab
const SUMMARY_HEADERS     = ['Source', 'Metric', 'Value', 'As Of'];  // Summaries tab
const CONFIG_HEADERS      = ['Setting', 'Value'];
const GOAL_HEADERS        = ['ID', 'Title', 'Description', 'Status', 'Category', 'Year', 'Progress', 'Notes'];
const PTO_HEADERS         = ['Type', 'Label', 'Start Date', 'End Date', 'Weekdays', 'Hours', 'Status'];
const BILL_HEADERS        = ['Bill', 'Amount', 'Due Day', 'Frequency', 'Category', 'Account', 'Paid', 'Notes'];
const PTO_MEMORY_HEADERS      = ['Start Date', 'End Date', 'Workdays', 'GCal Event ID', 'Status', 'Suggested On'];
const REMINDERS_MEMORY_HEADERS  = ['Rule Key', 'Sent At', 'Message'];
const INTEREST_LEDGER_HEADERS   = ['ID', 'Date Added', 'Person', 'Interest', 'Category', 'Source', 'Notes', 'Status'];
const RECIPE_HEADERS            = ['Name', 'Cuisine', 'Servings', 'Prep Time', 'Link', 'Ingredients', 'Tags', 'Notes'];
const HOME_ITEM_HEADERS         = ['Item', 'Category', 'Purchase Date', 'Warranty Expiry', 'Last Service', 'Next Service', 'Interval (mo)', 'Notes'];
const IDEA_HEADERS              = ['ID', 'Date Added', 'Idea', 'Category', 'Tags', 'Notes', 'Status'];
const ITINERARY_HEADERS         = ['ID', 'Trip Key', 'Type', 'Title', 'Date', 'Start Time', 'End Time', 'Location', 'Notes', 'Metadata'];
const TRIP_META_HEADERS         = ['Trip Key', 'Context', 'Notes', 'Updated Date', 'Traveler'];
const PACKING_ITEM_HEADERS      = ['ID', 'Trip Key', 'Person', 'Category', 'Item', 'Checked', 'Source', 'Added Date'];
const COUNTRIES_HEADERS         = ['ID', 'Country', 'City', 'Year', 'Traveller', 'Trip Key', 'Notes'];
const BUCKET_LIST_HEADERS       = ['ID', 'Country', 'City', 'Target Year', 'Traveller', 'Stars', 'Dream Trip', 'Notes', 'Visited'];

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
  // Ensure Signal Learning tab exists (Issue #24 — active intelligence)
  try {
    ensureSignalLearningTab_();
  } catch (slErr) {
    Logger.log('ensureSignalLearningTab_ error (non-fatal): ' + slErr.message);
  }
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
    // PTO settings
    ['pto_vacation_days',      '20'],  // annual vacation allocation (days)
    ['pto_rollover_days',      '0'],   // days carried over from prior year (Issue #49)
    ['pto_personal_hours',     '48'],  // annual personal time (hours)
    ['pto_buffer_days',        '3'],   // reserve days held back from planning
    ['weather_location',       ''],    // city name for weather ticker, e.g. "Austin, TX"
  ];

  ensureSheet(ss, TABS.FLAGS,        FLAG_HEADERS);
  ensureSheet(ss, TABS.TASKS,        TASK_HEADERS);
  ensureSheet(ss, TABS.METRICS,      METRIC_HEADERS);
  ensureSheet(ss, TABS.SUMMARIES,    SUMMARY_HEADERS);
  ensureSheet(ss, TABS.PROJECTS,     PROJECT_HEADERS);
  ensureSheet(ss, TABS.GOALS,        GOAL_HEADERS);
  ensureSheet(ss, TABS.PTO,          PTO_HEADERS);
  ensureSheet(ss, TABS.PTO_MEMORY,       PTO_MEMORY_HEADERS);
  ensureSheet(ss, TABS.REMINDERS_MEMORY, REMINDERS_MEMORY_HEADERS);
  ensureSheet(ss, TABS.INTEREST_LEDGER,  INTEREST_LEDGER_HEADERS);
  ensureSheet(ss, TABS.BILLS,            BILL_HEADERS);
  ensureSheet(ss, TABS.RECIPES,          RECIPE_HEADERS);
  ensureSheet(ss, TABS.HOME_ITEMS,       HOME_ITEM_HEADERS);
  ensureSheet(ss, TABS.IDEAS,            IDEA_HEADERS);
  ensureSheet(ss, TABS.ITINERARY,        ITINERARY_HEADERS);
  ensureSheet(ss, TABS.TRIP_META,        TRIP_META_HEADERS);
  ensureSheet(ss, TABS.PACKING_ITEMS,    PACKING_ITEM_HEADERS);
  ensureSheet(ss, TABS.COUNTRIES,        COUNTRIES_HEADERS);
  ensureSheet(ss, TABS.BUCKET_LIST,      BUCKET_LIST_HEADERS);
  ensureSheet(ss, TABS.CONFIG,           CONFIG_HEADERS, configDefaults);

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
    if (handlerName === 'nightlyRun' || handlerName === 'morningNudge' || handlerName === 'hourlyCheck' || handlerName === 'checkFlightStatuses_') {
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

  // Hourly Anticipator — evaluates reminder rules every hour
  ScriptApp.newTrigger('hourlyCheck')
    .timeBased()
    .everyHours(1)
    .inTimezone(Session.getScriptTimeZone())
    .create();

  // Flight status monitor — polls AviationStack for flights within 24h of departure
  ScriptApp.newTrigger('checkFlightStatuses_')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('Triggers set: nightlyRun at 11pm, morningNudge at 7am, hourlyCheck every hour, checkFlightStatuses_ every 15min.');
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

    // Step -1: Escalate aged unacknowledged flags (Issue #5)
    try {
      escalateAgedFlags_();
    } catch (escErr) {
      Logger.log('escalateAgedFlags_ error (non-fatal): ' + escErr.message);
    }

    // Step 0: Auto-populate Summaries tab from live data (Phase 5)
    writeSummarySnapshot();

    // Step 0b: PTO snapshot + Vera calendar recommendations (Issue #19)
    var ptoStats = null;
    try {
      ptoStats = writePTOSnapshot_();
      Logger.log('PTO snapshot written — vacation used: ' + (ptoStats && ptoStats.used ? ptoStats.used.vacationDays : '?') + ' days.');
    } catch (ptoErr) {
      Logger.log('PTO snapshot error (non-fatal): ' + ptoErr.message);
    }

    // Step 0c: Explorer — daily AI discovery bulletin (Reminders.js)
    try {
      runExplorer_();
    } catch (expErr) {
      Logger.log('runExplorer_ error (non-fatal): ' + expErr.message);
    }

    // Step 0d: Signal Learning — get suppressed patterns to filter noise (Issue #24)
    var suppressedPatterns = [];
    try {
      suppressedPatterns = getSuppressedKeyPatterns_();
      if (suppressedPatterns.length > 0) {
        Logger.log('SignalLearning: suppressing ' + suppressedPatterns.length + ' noise pattern(s): ' + suppressedPatterns.join(', '));
      }
    } catch (slErr) {
      Logger.log('getSuppressedKeyPatterns_ error (non-fatal): ' + slErr.message);
    }

    // Step 0e: Signal Learning — record expired flags (open > 30 days, never actioned)
    try {
      recordExpiredFlags_();
    } catch (expFlagErr) {
      Logger.log('recordExpiredFlags_ error (non-fatal): ' + expFlagErr.message);
    }

    // Step 1: Collect
    const events    = getUpcomingEvents();
    const tasks     = getOpenTasks();
    const summaries = getSummaries();
    const ledger    = getSharedInterestLedger_();

    Logger.log('Data collected — Events: ' + events.length + ', Tasks: ' + tasks.length + ', Summaries: ' + summaries.length + ', Interests: ' + ledger.length);

    // Step 1b: Suggest due dates for undated tasks (writes back to sheet)
    suggestDueDates(tasks);

    // Step 2 & 3: Package + Reason (Claude) — pass suppressed patterns for noise filtering
    const flags = generateFlags(events, tasks, summaries, ptoStats, ledger, suppressedPatterns);

    // Step 4: Write
    if (flags && flags.length > 0) {
      writeFlags(flags);
      Logger.log('Wrote ' + flags.length + ' flags to sheet.');

      // Step 4b: Signal Learning — record generated flag keys as "seen"
      try {
        var flagKeys = flags.map(function(f) { return f.key || ''; }).filter(function(k) { return k; });
        if (flagKeys.length > 0) recordFlagsGenerated_(flagKeys);
      } catch (slErr) {
        Logger.log('recordFlagsGenerated_ error (non-fatal): ' + slErr.message);
      }
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
/**
 * Returns true if newKey shares ≥ 60% of its meaningful tokens with any
 * existing key-based fingerprint in the set.
 *
 * Month names and standalone numbers are stripped before comparison so
 * date-drifted keys (e.g. verizon_bill_march_13 vs verizon_bill_march_14)
 * are treated as the same issue.
 *
 * @param {string} newKey              - The candidate key from Claude
 * @param {Set}    existingFingerprints - Set returned by getExistingFlagFingerprints_()
 * @returns {boolean}
 */
function keysAreSimilar_(newKey, existingFingerprints) {
  if (!newKey) return false;

  function normalize(k) {
    return String(k).toLowerCase()
      // Remove month names (full and abbreviated)
      .replace(/jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?/g, '')
      // Remove standalone numbers
      .replace(/\b\d+\b/g, '')
      // Collapse repeated underscores
      .replace(/_+/g, '_')
      // Trim leading/trailing underscores
      .replace(/^_|_$/g, '');
  }

  var newTokens = normalize(newKey).split('_').filter(function(t) { return t.length > 2; });
  if (newTokens.length === 0) return false;

  var similar = false;
  existingFingerprints.forEach(function(fp) {
    if (similar) return; // Already found a match — short-circuit
    if (fp.indexOf('key:') !== 0) return; // Only compare against key-based fingerprints
    var existingTokens = normalize(fp.slice(4)).split('_').filter(function(t) { return t.length > 2; });
    if (existingTokens.length === 0) return;
    var matches = newTokens.filter(function(t) { return existingTokens.indexOf(t) !== -1; });
    var minLen  = Math.min(newTokens.length, existingTokens.length);
    if (minLen > 0 && matches.length / minLen >= 0.6) similar = true;
  });
  return similar;
}

function writeFlags(flags) {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.FLAGS);
  const today = new Date();
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const timestamp = dateStr.replace(/-/g, '');

  // Build fingerprint set of ALL flags ever written (open, ack, snoozed, resolved)
  const existing = getExistingFlagFingerprints_(sheet);

  let written = 0;
  let skipped = 0;
  let seqNum  = 1;

  flags.forEach(function(flag) {
    const fp = makeFlagFingerprint_(flag.source, flag.flag, flag.key);

    if (existing.has(fp)) {
      Logger.log('Dedup (exact): skipping [' + (flag.key || flag.flag) + ']');
      skipped++;
      return;
    }

    // Fuzzy check: reject keys that share ≥60% token overlap with any existing key
    // (catches date-drifted variants like verizon_bill_march_13 vs verizon_bill_march_14)
    if (flag.key && keysAreSimilar_(flag.key, existing)) {
      Logger.log('Dedup (fuzzy): skipping similar key [' + flag.key + ']');
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
      flag.key     || '',     // J: Key (stable dedup identifier)
      '',                     // K: Escalated (3d / 7d once aged)
    ];
    sheet.appendRow(row);
    existing.add(fp); // Prevent dupes within the same batch
    written++;
  });

  if (written > 0) colorCodeFlags(sheet);
  Logger.log('writeFlags: ' + written + ' new flags written, ' + skipped + ' duplicates skipped.');
}

/**
 * Returns a Set of fingerprints for ALL flags ever written to the sheet,
 * regardless of their status (open, acknowledged, snoozed, or resolved).
 *
 * Once a key has been written — in any state — it is permanently blocked
 * from re-appearing. This prevents the same issue from cycling back after
 * the user resolves it. If the issue genuinely recurs later, Claude should
 * generate a new key (e.g. add a _q2 or _apr suffix).
 */
function getExistingFlagFingerprints_(sheet) {
  const fingerprints = new Set();
  if (!sheet || sheet.getLastRow() < 2) return fingerprints;

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();

  data.forEach(function(row) {
    const key = String(row[9] || '').trim(); // Column J: stable key (may be empty for legacy rows)
    fingerprints.add(makeFlagFingerprint_(row[2], row[3], key));
  });

  return fingerprints;
}

/**
 * Creates a deduplication fingerprint for a flag.
 *
 * When a stable "key" field is present (generated by Claude, e.g. "verizon_bill_march_13"),
 * uses the key ALONE as the fingerprint — no source prefix. This means the same key
 * always produces the same fingerprint regardless of how the source label is worded
 * across different nightly runs, preventing duplicates like "verizon_bill_march_13"
 * appearing twice because the source changed from "Finance" to "Finance/Verizon".
 *
 * Falls back to source + first 8 words of flag text for legacy rows that pre-date
 * the key field, so old unresolved flags still block re-duplication.
 *
 * @param {string} source   - Flag source (e.g. "Calendar", "Finance") — only used in fallback
 * @param {string} flagText - Flag title text (used as fallback)
 * @param {string} key      - Stable snake_case key from Claude (preferred; globally unique)
 */
function makeFlagFingerprint_(source, flagText, key) {
  // Preferred path: stable key provided by Claude — key alone is the fingerprint.
  // Keys are designed to be globally unique (e.g. "verizon_bill_march_13"), so no
  // source prefix is needed and including one only causes false mismatches.
  if (key && String(key).trim() !== '') {
    const safeKey = String(key).toLowerCase().replace(/[^a-z0-9_]/g, '').trim();
    return 'key:' + safeKey;
  }

  // Legacy fallback: source + first 8 words of flag text (for rows with no key)
  const src  = String(source || '').toLowerCase().trim();
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
// SIGNAL LEARNING HELPERS — Expired flag recording
// ============================================================

/**
 * Scans the Flags tab for flags that have been open for >30 days
 * with no acknowledgement, snooze, or resolution — these are "expired/ignored".
 * Records them in SignalLearning so the pattern gets a noise score penalty.
 * Only records once per flag (Escalated column shows '7d' when stale).
 */
function recordExpiredFlags_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.FLAGS);
  if (!sheet || sheet.getLastRow() < 2) return;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();

  var expiredCount = 0;
  data.forEach(function(row) {
    var resolved  = String(row[8]  || '').toLowerCase(); // Col I: Resolved
    var ack       = String(row[6]  || '').toLowerCase(); // Col G: Acknowledged
    var snoozed   = String(row[7]  || '').trim();        // Col H: Snoozed Until
    var flagKey   = String(row[9]  || '').trim();        // Col J: Key
    var escalated = String(row[10] || '').trim();        // Col K: Escalated

    // Only flag unresolved, unacknowledged, unsnoozed rows
    if (resolved === 'yes' || ack === 'yes' || snoozed) return;

    // Must have a key to track pattern
    if (!flagKey) return;

    // Calculate age
    var flagDate = new Date(row[1]); // Col B: Date
    if (isNaN(flagDate.getTime())) return;
    flagDate.setHours(0, 0, 0, 0);
    var ageDays = Math.floor((today - flagDate) / (1000 * 60 * 60 * 24));

    // Record as expired if open >30 days (the 7d escalation marks it as stale)
    // Use escalated = '7d' as a proxy that means "VERA tried, user never responded"
    if (ageDays >= 30 || escalated === '7d') {
      try {
        recordFlagOutcome_(flagKey, 'expired');
        expiredCount++;
      } catch (e) {
        Logger.log('recordExpiredFlags_: error for key "' + flagKey + '": ' + e.message);
      }
    }
  });

  if (expiredCount > 0) {
    Logger.log('recordExpiredFlags_: recorded ' + expiredCount + ' expired flag(s).');
  }
}

// ============================================================
// FLAG ESCALATION — Age-based urgency bumps
// ============================================================

/**
 * Scans unresolved, unacknowledged flags and escalates aged ones:
 *   ≥ 3 days → bump urgency (Low→Medium, Medium→High); set Escalated = '3d'
 *   ≥ 7 days → append stale note to Reason; set Escalated = '7d'
 *
 * The 'Escalated' column (K) tracks state so each threshold fires once.
 * Snoozed flags are skipped while the snooze window is active.
 */
function escalateAgedFlags_() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.FLAGS);
  if (!sheet || sheet.getLastRow() < 2) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const numRows = sheet.getLastRow() - 1;
  const numCols = FLAG_HEADERS.length; // includes Escalated (col K = index 10)
  const data    = sheet.getRange(2, 1, numRows, numCols).getValues();

  // Column indices (0-based within data row; 1-based for sheet.getRange)
  const COL_DATE      = 1;  // B
  const COL_REASON    = 4;  // E
  const COL_URGENCY   = 5;  // F
  const COL_ACK       = 6;  // G
  const COL_SNOOZE    = 7;  // H
  const COL_RESOLVED  = 8;  // I
  const COL_ESCALATED = 10; // K

  const urgencyUp = { 'Low': 'Medium', 'Medium': 'High', 'High': 'High' };

  let escalated = 0;

  data.forEach(function(row, i) {
    // Skip resolved or acknowledged flags
    if (String(row[COL_RESOLVED] || '').toLowerCase() === 'yes') return;
    if (String(row[COL_ACK]      || '').toLowerCase() === 'yes') return;

    // Skip while snoozed
    const snoozeVal = row[COL_SNOOZE];
    if (snoozeVal) {
      var snoozeDate = new Date(snoozeVal);
      if (!isNaN(snoozeDate.getTime()) && snoozeDate > today) return;
    }

    // Calculate age in days
    const flagDate = new Date(row[COL_DATE]);
    if (isNaN(flagDate.getTime())) return;
    flagDate.setHours(0, 0, 0, 0);
    const ageDays = Math.floor((today - flagDate) / (1000 * 60 * 60 * 24));

    const rowNum           = i + 2; // 1-indexed sheet row
    const currentEscalated = String(row[COL_ESCALATED] || '').trim();
    const currentUrgency   = String(row[COL_URGENCY]   || 'Low').trim();
    const flagText         = String(row[3] || '');

    if (ageDays >= 7 && currentEscalated !== '7d') {
      // Mark 7-day stale: force urgency to High + append stale note
      sheet.getRange(rowNum, COL_ESCALATED + 1).setValue('7d');
      sheet.getRange(rowNum, COL_URGENCY   + 1).setValue('High'); // force High — no more Medium after 7d
      const reason = String(row[COL_REASON] || '');
      if (reason.indexOf('[Stale:') === -1) {
        sheet.getRange(rowNum, COL_REASON + 1).setValue(
          reason + (reason ? ' ' : '') + '[Stale: open for 7+ days — needs attention]'
        );
      }
      Logger.log('escalateAgedFlags_: 7d stale + forced High — row ' + rowNum + ' "' + flagText + '"');
      escalated++;

    } else if (ageDays >= 3 && currentEscalated === '') {
      // First escalation: bump urgency at 3 days
      const newUrgency = urgencyUp[currentUrgency] || currentUrgency;
      sheet.getRange(rowNum, COL_URGENCY   + 1).setValue(newUrgency);
      sheet.getRange(rowNum, COL_ESCALATED + 1).setValue('3d');
      Logger.log('escalateAgedFlags_: 3d bump ' + currentUrgency + '→' + newUrgency +
                 ' — row ' + rowNum + ' "' + flagText + '"');
      escalated++;
    }
  });

  if (escalated > 0) {
    colorCodeFlags(sheet);
    Logger.log('escalateAgedFlags_: escalated ' + escalated + ' flag(s).');
  } else {
    Logger.log('escalateAgedFlags_: no flags needed escalation tonight.');
  }
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
 * Reads all rows from BOTH the Metrics tab (auto-counts) and the Summaries tab
 * (external life intelligence feed) and returns them combined for Claude.
 *
 * @returns {Array} Array of {source, metric, value, asOf} objects
 */
function getSummaries() {
  try {
    const ss = getSpreadsheet();
    return readSummaryTab_(ss, TABS.METRICS).concat(readSummaryTab_(ss, TABS.SUMMARIES));
  } catch (e) {
    Logger.log('getSummaries error: ' + e.message);
    return [];
  }
}

/**
 * Reads all non-blank rows from a single tab that shares the Source/Metric/Value/As Of schema.
 * Used by getSummaries() to read both Metrics and Summaries tabs.
 *
 * @param {Spreadsheet} ss       - The spreadsheet object
 * @param {string}      tabName  - Tab name to read (e.g. TABS.METRICS or TABS.SUMMARIES)
 * @returns {Array} Array of {source, metric, value, asOf} objects
 */
function readSummaryTab_(ss, tabName) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, SUMMARY_HEADERS.length).getValues();

  return data
    .filter(function(row) { return row[0] !== ''; })
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
}

// ============================================================
// MORNING INTELLIGENCE — Issue #24
// ============================================================

/**
 * Builds a TODAY'S FOCUS / MAINTENANCE / TRAVEL HTML section for the morning email.
 * Only renders sections that have content — silently skips empty ones.
 *
 * @returns {string} HTML string (may be empty if nothing urgent)
 */
function buildMorningIntelligence_() {
  var html     = '';
  var tz       = Session.getScriptTimeZone();
  var today    = new Date(); today.setHours(0, 0, 0, 0);
  var dayOfMon = today.getDate();

  var focusRows = [];
  var maintRows = [];
  var travelRows = [];

  // ---- Today's Focus: Overdue tasks by name --------------------------------
  try {
    var openTasks = getOpenTasks();
    var overdueTasks = openTasks.filter(function(t) { return t.isOverdue; })
      .sort(function(a, b) { return Math.abs(b.daysUntilDue || 0) - Math.abs(a.daysUntilDue || 0); })
      .slice(0, 3);

    overdueTasks.forEach(function(t) {
      var days = Math.abs(t.daysUntilDue || 0);
      focusRows.push('<p style="margin:0 0 4px;font-size:14px;color:#444444;">• <strong>' +
        escapeHtml_(t.task) + '</strong> <span style="color:#c62828;font-size:13px;">— ' +
        days + ' day' + (days === 1 ? '' : 's') + ' overdue</span></p>');
    });
  } catch (e) { Logger.log('buildMorningIntelligence_: tasks — ' + e.message); }

  // ---- Today's Focus: Bills due within 5 days -----------------------------
  try {
    var billsSheet = getSpreadsheet().getSheetByName(TABS.BILLS);
    if (billsSheet && billsSheet.getLastRow() >= 2) {
      var currMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
      var billsData = billsSheet.getRange(2, 1, billsSheet.getLastRow() - 1, BILL_HEADERS.length).getValues();
      billsData.forEach(function(r) {
        var name   = String(r[0] || '').trim();
        if (!name) return;
        var dueDay = r[2] !== '' ? Number(r[2]) : null;
        var paid   = String(r[6] || '').trim() === currMonth;
        if (paid || dueDay === null) return;
        var daysUntil = dueDay - dayOfMon;
        if (daysUntil < 0) daysUntil += new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        if (daysUntil > 5) return;
        var amtStr = r[1] !== '' ? ' ($' + Number(r[1]) + ')' : '';
        var dueStr = daysUntil === 0 ? 'DUE TODAY' : 'due in ' + daysUntil + ' day' + (daysUntil === 1 ? '' : 's');
        focusRows.push('<p style="margin:0 0 4px;font-size:14px;color:#444444;">• <strong>' +
          escapeHtml_(name) + amtStr + '</strong> <span style="color:#e65100;font-size:13px;">— ' + dueStr + '</span></p>');
      });
    }
  } catch (e) { Logger.log('buildMorningIntelligence_: bills — ' + e.message); }

  // ---- Maintenance: Home items overdue or due within 14 days ---------------
  try {
    var homeSheet = getSpreadsheet().getSheetByName(TABS.HOME_ITEMS);
    if (homeSheet && homeSheet.getLastRow() >= 2) {
      var homeData = homeSheet.getRange(2, 1, homeSheet.getLastRow() - 1, HOME_ITEM_HEADERS.length).getValues();
      homeData.forEach(function(r) {
        var item = String(r[0] || '').trim();
        if (!item) return;
        var serviceDays = null;
        if (r[5]) { try { serviceDays = Math.round((new Date(r[5]) - today) / 86400000); } catch(e2) {} }
        if (serviceDays === null || serviceDays > 14) return;
        var statusStr;
        if (serviceDays < 0)   statusStr = Math.abs(serviceDays) + ' day' + (Math.abs(serviceDays) === 1 ? '' : 's') + ' overdue';
        else if (serviceDays === 0) statusStr = 'DUE TODAY';
        else                   statusStr = 'due in ' + serviceDays + ' day' + (serviceDays === 1 ? '' : 's');
        var textColor = serviceDays < 0 ? '#c62828' : '#777777';
        maintRows.push('<p style="margin:0 0 4px;font-size:14px;color:#444444;">• <strong>' +
          escapeHtml_(item) + '</strong> <span style="color:' + textColor + ';font-size:13px;">— ' + statusStr + '</span></p>');
      });
    }
  } catch (e) { Logger.log('buildMorningIntelligence_: home — ' + e.message); }

  // ---- Travel: Upcoming trips within 14 days --------------------------------
  try {
    var travelCfg   = readPTOConfig_();
    var travelTrips = getUpcomingTravel_(travelCfg);
    var ss_t = getSpreadsheet();

    travelTrips.forEach(function(trip) {
      var daysAway = trip.daysAway !== undefined ? trip.daysAway
        : (trip.startDate ? Math.round((new Date(trip.startDate) - today) / 86400000) : null);
      if (daysAway === null || daysAway > 14 || daysAway < 0) return;

      var tripKey = trip.startDate + '|' + trip.label;
      var packTotal = 0, packDone = 0;
      try {
        var packSheet = ss_t.getSheetByName(TABS.PACKING_ITEMS);
        if (packSheet && packSheet.getLastRow() >= 2) {
          packSheet.getRange(2, 1, packSheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues().forEach(function(r) {
            if (String(r[1]).trim() !== tripKey) return;
            packTotal++;
            if (String(r[5]).toLowerCase() === 'true' || String(r[5]).toLowerCase() === 'yes') packDone++;
          });
        }
      } catch(pe) {}

      var packStr = packTotal === 0 ? '⚠ packing not started' : (packDone + '/' + packTotal + ' packed');
      var daysStr = daysAway === 0 ? 'TODAY' : (daysAway + ' days away');
      travelRows.push('<p style="margin:0 0 4px;font-size:14px;color:#444444;">• <strong>' +
        escapeHtml_(trip.label) + '</strong> <span style="color:#555555;font-size:13px;">— ' +
        daysStr + ' · ' + packStr + '</span></p>');
    });
  } catch (e) { Logger.log('buildMorningIntelligence_: travel — ' + e.message); }

  // ---- Assemble HTML -------------------------------------------------------
  if (focusRows.length === 0 && maintRows.length === 0 && travelRows.length === 0) return '';

  html += '<div style="margin-top:24px;padding-top:20px;border-top:1px solid #f0f0f5;">';

  if (focusRows.length > 0) {
    html += '<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#0d1b3e;letter-spacing:1px;text-transform:uppercase;">🎯 Today\'s Focus</p>';
    html += focusRows.join('');
  }

  if (maintRows.length > 0) {
    if (focusRows.length > 0) html += '<div style="margin-top:12px;"></div>';
    html += '<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#0d1b3e;letter-spacing:1px;text-transform:uppercase;">🔧 Maintenance</p>';
    html += maintRows.join('');
  }

  if (travelRows.length > 0) {
    if (focusRows.length > 0 || maintRows.length > 0) html += '<div style="margin-top:12px;"></div>';
    html += '<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#0d1b3e;letter-spacing:1px;text-transform:uppercase;">🧳 Travel</p>';
    html += travelRows.join('');
  }

  html += '</div>';
  return html;
}

/**
 * HTML-escapes a string for safe insertion into an HTML email.
 */
function escapeHtml_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    const veraLink = dashboardUrl || 'https://aeraky1565.github.io/VERA-My-Chief-of-Staff/';

    // ---- Weather ticker (graceful — empty string if not configured) -----
    const weatherTicker = getWeatherTicker_();

    // ---- Today's calendar events ----------------------------------------
    let todayEvents = [];
    try {
      todayEvents = getUpcomingEvents().filter(function(e) { return e.daysUntil === 0; }).slice(0, 5);
    } catch (calErr) { Logger.log('morningNudge: calendar fetch error — ' + calErr.message); }

    let calendarSection = '';
    if (todayEvents.length > 0) {
      const calRows = todayEvents.map(function(e) {
        const timeStr = e.isAllDay ? 'All day' : (e.start.split(' ')[1] || '');
        const calName = e.calLabel || e.calendarName || '';
        const detail  = [timeStr, calName].filter(Boolean).join(' · ');
        return '<p style="margin:0 0 5px;font-size:14px;color:#444444;">' +
               '<strong>' + e.title + '</strong>' +
               (detail ? ' <span style="color:#888888;font-size:13px;">· ' + detail + '</span>' : '') +
               '</p>';
      }).join('');
      calendarSection =
        '<div style="margin-top:24px;padding-top:20px;border-top:1px solid #f0f0f5;">' +
        '<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#0d1b3e;letter-spacing:1px;text-transform:uppercase;">📅 Today</p>' +
        calRows +
        '</div>';
    } else {
      calendarSection =
        '<div style="margin-top:24px;padding-top:20px;border-top:1px solid #f0f0f5;">' +
        '<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#0d1b3e;letter-spacing:1px;text-transform:uppercase;">📅 Today</p>' +
        '<p style="margin:0;font-size:14px;color:#aaaaaa;font-style:italic;">Nothing on the calendar today.</p>' +
        '</div>';
    }

    // ---- Tasks: overdue + due today count -------------------------------
    let overdueCount   = 0;
    let dueTodayCount  = 0;
    try {
      const openTasks = getOpenTasks();
      overdueCount  = openTasks.filter(function(t) { return t.isOverdue; }).length;
      dueTodayCount = openTasks.filter(function(t) { return !t.isOverdue && t.daysUntilDue === 0; }).length;
    } catch (taskErr) { Logger.log('morningNudge: task fetch error — ' + taskErr.message); }

    let taskBadges = '';
    if (overdueCount > 0 || dueTodayCount > 0) {
      taskBadges = '<div style="margin-top:14px;">';
      if (overdueCount > 0) {
        taskBadges += '<span style="display:inline-block;background:#fdecea;color:#c62828;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-right:8px;">⚠ ' + overdueCount + ' overdue</span>';
      }
      if (dueTodayCount > 0) {
        taskBadges += '<span style="display:inline-block;background:#fff8e1;color:#e65100;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;">📋 ' + dueTodayCount + ' due today</span>';
      }
      taskBadges += '</div>';
    }

    // ---- Morning Intelligence section (Issue #24) -------------------------
    let intelligenceSection = '';
    try {
      intelligenceSection = buildMorningIntelligence_();
    } catch (intErr) {
      Logger.log('morningNudge: buildMorningIntelligence_ error (non-fatal) — ' + intErr.message);
    }

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

      // Weather ticker (empty string → nothing rendered)
      weatherTicker +

      // Body
      '<tr><td style="padding:36px 40px;">' +
      '<p style="margin:0 0 8px;font-size:17px;font-weight:600;color:#0d1b3e;">Good morning, Ahmed.</p>' +
      '<p style="margin:0 0 24px;font-size:15px;color:#555555;">VERA flagged <strong>' + total + ' item' + (total === 1 ? '' : 's') + '</strong> overnight requiring your attention.</p>' +
      '<table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">' + urgencyRows + '</table>' +
      '<table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">' + dashboardBtn + '</table>' +
      calendarSection +
      taskBadges +
      intelligenceSection +
      '</td></tr>' +

      // Footer
      '<tr><td style="padding:16px 40px;background:#f7f7fa;border-top:1px solid #eeeeee;">' +
      '<p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">Sent by VERA &mdash; Virtual Executive &amp; Reminder Assistant</p>' +
      '</td></tr>' +

      '</table></td></tr></table></body></html>';

    // ---- Plain text fallback --------------------------------------------
    const calPlainText = todayEvents.length > 0
      ? '\nToday:\n' + todayEvents.map(function(e) {
          const t = e.isAllDay ? 'All day' : (e.start.split(' ')[1] || '');
          return '  ' + e.title + (t ? ' · ' + t : '');
        }).join('\n')
      : '';
    const taskPlainText = (overdueCount > 0 || dueTodayCount > 0)
      ? '\nTasks: ' +
        (overdueCount  > 0 ? overdueCount  + ' overdue'   : '') +
        (overdueCount  > 0 && dueTodayCount > 0 ? ' · ' : '') +
        (dueTodayCount > 0 ? dueTodayCount + ' due today' : '')
      : '';

    const plainText = [
      'Good morning, Ahmed.',
      '',
      'VERA flagged ' + total + (total === 1 ? ' item' : ' items') + ' overnight:',
      '',
      highCount > 0 ? '  High priority:   ' + highCount : '',
      medCount  > 0 ? '  Medium priority: ' + medCount  : '',
      lowCount  > 0 ? '  Low priority:    ' + lowCount  : '',
      calPlainText,
      taskPlainText,
      '',
      'Open VERA: ' + veraLink,
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
// ONE-TIME MIGRATIONS — Run each once after deploying the relevant update
// ============================================================

/**
 * Creates the Metrics tab (with headers) for users who ran setupVERA() before
 * the Metrics/Summaries split was introduced. Safe to re-run.
 *
 * After running this, the nightly run will automatically:
 *   - Write auto-counts (Tasks/Calendar/Flags) into the new Metrics tab
 *   - Clear the old [AUTO] rows from the Summaries tab (which now holds external data)
 */
function addMetricsTab() {
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.METRICS, METRIC_HEADERS);
  Logger.log('✅ Metrics tab created (or already exists). Run testRun() to populate it.');
}

/**
 * Creates the Projects tab for users who ran setupVERA() before Phase 6.
 * Run once from the Apps Script editor after pushing this update.
 */
function addProjectsTab() {
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.PROJECTS, PROJECT_HEADERS);
  Logger.log('✅ Projects tab created (or already exists).');
}

/**
 * Creates the PTO tab for users who ran setupVERA() before Issue #19.
 * Run once from the Apps Script editor after pushing this update.
 */
function addPTOTab() {
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.PTO, PTO_HEADERS);
  Logger.log('✅ PTO tab created (or already exists). Seed Config tab with pto_* rows, then run testPTO().');
}

/**
 * Migration helper — run once from Apps Script editor to create the PTO Memory tab.
 * Safe to re-run; ensureSheet() is idempotent.
 */
function addPTOMemoryTab() {
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.PTO_MEMORY, PTO_MEMORY_HEADERS);
  Logger.log('✅ PTO Memory tab created (or already exists). Stateful PTO suggestions are now active.');
}

/**
 * Migration helper — run once from Apps Script editor to seed PTO config rows.
 * Issue #49: Adds pto_vacation_days, pto_rollover_days, and other PTO settings
 * to the Config tab so they are visible and editable without hunting through code.
 * Safe to re-run — skips rows that already exist.
 */
function addPTOConfig() {
  var ss  = getSpreadsheet();
  var sh  = ss.getSheetByName(TABS.CONFIG);
  if (!sh) { Logger.log('Config tab not found.'); return; }

  var rows = [
    ['pto_calendar_name',          'Verizon Calendar'],
    ['pto_vera_calendar',          'Vera'],
    ['pto_vacation_days',          '20'],   // annual vacation allocation (days)
    ['pto_personal_hours',         '48'],   // annual personal time (hours)
    ['pto_rollover_days',          '0'],    // days carried over from prior year
    ['pto_buffer_days',            '3'],    // reserve days held back from planning
    ['pto_year',                   String(new Date().getFullYear())],
    ['gap_calendars',              'Verizon Calendar'],
    ['milestone_keywords',         'Wedding,Graduation,Trip,Travel,Concert,Birthday'],
    ['holiday_keywords',           'Day,Holiday,Floating,Closure'],
    ['ignore_keywords',            'Pay Day'],
  ];

  var existing = sh.getDataRange().getValues()
    .map(function(r) { return String(r[0]).trim(); });

  var added = 0;
  rows.forEach(function(row) {
    if (existing.indexOf(row[0]) === -1) {
      sh.appendRow(row);
      added++;
    }
  });
  Logger.log('✅ addPTOConfig: added ' + added + ' row(s) (skipped ' + (rows.length - added) + ' already present).');
}

/**
 * Creates the Reminders Memory tab for users who ran setupVERA() before Issue #26.
 * Safe to re-run — ensureSheet() is idempotent.
 */
function addRemindersMemoryTab() {
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.REMINDERS_MEMORY, REMINDERS_MEMORY_HEADERS);
  Logger.log('✅ Reminders Memory tab created (or already exists). Run setupTriggers() to install the hourlyCheck trigger.');
}

/**
 * Creates the Shared Interests tab for users who ran setupVERA() before Issue #28.
 * Safe to re-run — ensureSheet() is idempotent.
 */
function addInterestLedgerTab() {
  const ss = getSpreadsheet();
  ensureSheet(ss, TABS.INTEREST_LEDGER, INTEREST_LEDGER_HEADERS);
  Logger.log('✅ Shared Interests tab created (or already exists). VERA will now track Ahmed & Victoria\'s interests.');
}

/**
 * Adds the "Key" header to Column J of the Flags tab.
 * Run this ONCE from the Apps Script editor after pushing this update.
 * Safe to re-run — checks if the column already exists before writing.
 */
function addKeyColumnToFlags() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.FLAGS);
  if (!sheet) throw new Error('Flags tab not found.');

  // Check if Key column already exists at Column J
  if (sheet.getLastColumn() >= 10) {
    const existingHeader = String(sheet.getRange(1, 10).getValue()).trim();
    if (existingHeader === 'Key') {
      Logger.log('Key column already exists at Column J — nothing to do.');
      return;
    }
  }

  sheet.getRange(1, 10)
    .setValue('Key')
    .setFontWeight('bold')
    .setBackground('#1a1a2e')
    .setFontColor('#ffffff');

  Logger.log('✅ "Key" column added to Flags tab (Column J). Dedup will now use stable keys from Claude.');
}

// ============================================================
// MIGRATION — Weekend Planner Config (Issue #20)
// ============================================================

/**
 * Seeds the Config tab with Weekend Planner default settings.
 * Run ONCE from the Apps Script editor after pushing this update.
 * Safe to re-run — skips any key that already exists.
 */
function addWeekendPlannerConfig() {
  const ss     = getSpreadsheet();
  const sheet  = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) throw new Error('Config tab not found.');

  const defaults = [
    ['weekend_planner_enabled',       'true'],
    ['weekend_planner_lookahead_days', '21'],
    ['weekend_planner_hour',           '8'],
    ['weekend_planner_home_city',      'Austin, TX'],
  ];

  // Read existing keys so we don't overwrite manual edits
  const existing = new Set();
  const lastRow  = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(row) {
      existing.add(String(row[0] || '').trim());
    });
  }

  let added = 0;
  defaults.forEach(function(pair) {
    if (!existing.has(pair[0])) {
      sheet.appendRow(pair);
      added++;
    }
  });

  Logger.log('✅ addWeekendPlannerConfig: added ' + added + ' row(s). ' +
             (added < defaults.length ? (defaults.length - added) + ' row(s) already existed.' : ''));
}

// ============================================================
// MIGRATION — Finance Config
// ============================================================

/**
 * Seeds the Config tab with Finance default settings.
 * Run ONCE from the Apps Script editor after pushing this update.
 * Safe to re-run — skips any key that already exists.
 *
 * To customise which categories are excluded from the spending pivot,
 * edit the 'finance_skip_categories' row in the Config tab directly.
 * Values are comma-separated and matched case-insensitively.
 */
function addFinanceConfig() {
  const ss     = getSpreadsheet();
  const sheet  = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) throw new Error('Config tab not found.');

  const defaults = [
    [
      'finance_skip_categories',
      'Income,Paycheck,Salary,Direct Deposit,Transfer,Transfers,' +
      'Credit Card Payment,Credit Card Payments,Payment,' +
      'Investments,Investment Income,Savings,Refund,Securities Trades',
    ],
  ];

  const existing = new Set();
  const lastRow  = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(row) {
      existing.add(String(row[0] || '').trim());
    });
  }

  let added = 0;
  defaults.forEach(function(pair) {
    if (!existing.has(pair[0])) {
      sheet.appendRow(pair);
      added++;
    }
  });

  Logger.log('✅ addFinanceConfig: added ' + added + ' row(s). ' +
             (added < defaults.length ? (defaults.length - added) + ' already existed.' : ''));
}

// ============================================================
// MIGRATION — Weather Ticker Config (Issue #12)
// ============================================================

/**
 * Seeds the Config tab with the weather_location row introduced in Issue #12.
 * Run ONCE from the Apps Script editor after pushing this update.
 * Safe to re-run — skips the row if it already exists.
 *
 * After running:
 *   1. Set weather_location value in the Config tab (e.g. "Austin, TX")
 *   2. Set WEATHER_API_KEY in Apps Script → Project Settings → Script Properties
 *      (free key from openweathermap.org)
 */
function addWeatherConfig() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.CONFIG);
  if (!sheet) { Logger.log('Config tab not found.'); return; }

  const existing = new Set();
  const lastRow  = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(row) {
      existing.add(String(row[0] || '').trim());
    });
  }

  let added = 0;
  if (!existing.has('weather_location')) {
    sheet.appendRow(['weather_location', '']);
    added++;
  }

  Logger.log('✅ addWeatherConfig: added ' + added + ' row(s). ' +
             'Set the weather_location value and WEATHER_API_KEY Script Property to enable the weather ticker.');
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
