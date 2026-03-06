// ============================================================
// VERA — Summaries.js  (Phase 5, updated)
// Nightly auto-population of the Metrics and Summaries tabs
// ============================================================
//
// TWO-TAB ARCHITECTURE:
//
//   Metrics tab   — VERA's self-monitoring counts (Tasks/Calendar/Flags).
//                   Written automatically every night. No user setup needed.
//
//   Summaries tab — External life intelligence feed (Finance, Fitness, Kenz Box, etc.).
//                   Populated from external Google Sheets via Config rows.
//                   This is the original "pre-digested intelligence" concept.
//
// CONVENTION — [AUTO] rows:
//   Rows whose Source column starts with "[AUTO]" are owned by this script.
//   They are wiped and rewritten fresh each night.
//   Rows WITHOUT "[AUTO]" prefix are your manual notes — never touched.
//
// HOW TO ADD EXTERNAL SHEET SOURCES (Summaries tab):
//   In your Config tab, add one row per metric in this format:
//
//     Setting                          | Value
//     summary_sheet:SimpleAssTracker   | SHEET_ID|TabName|CellRef|metric_name
//
//   Example rows:
//     summary_sheet:SimpleAssTracker   | 1aBc...XyZ|Budget|B2|checking_balance
//     summary_sheet:SimpleAssTracker   | 1aBc...XyZ|Budget|B5|groceries_actual_vs_budget
//     summary_sheet:Fitness            | 1xYz...AbC|Log|D4|gym_sessions_this_week
//
//   The external sheet must be shared (at least viewer access) with aaeleraky@gmail.com.
// ============================================================

var AUTO_PREFIX = '[AUTO]';

// ============================================================
// MAIN ENTRY POINT — called from nightlyRun() in Code.js
// ============================================================

/**
 * Orchestrates both nightly writes:
 *   1. Auto-counts → Metrics tab
 *   2. External sheet data → Summaries tab
 *
 * Runs BEFORE getSummaries() + generateFlags() so Claude sees fresh data.
 */
function writeSummarySnapshot() {
  try {
    const ss = getSpreadsheet();
    writeMetrics_(ss);
    writeSummaries_(ss);
  } catch (e) {
    Logger.log('writeSummarySnapshot error: ' + e.message + '\n' + e.stack);
  }
}

// ============================================================
// METRICS TAB — auto-counts from VERA's own data
// ============================================================

/**
 * Clears and rewrites [AUTO] rows in the Metrics tab.
 * Sources: Tasks tab, Calendar, Flags tab.
 */
function writeMetrics_(ss) {
  try {
    Logger.log('Metrics: starting auto-snapshot...');

    // Create Metrics tab on first run if it doesn't exist yet
    let sheet = ss.getSheetByName(TABS.METRICS);
    if (!sheet) {
      sheet = ss.insertSheet(TABS.METRICS);
      const headerRange = sheet.getRange(1, 1, 1, METRIC_HEADERS.length);
      headerRange.setValues([METRIC_HEADERS])
        .setFontWeight('bold')
        .setBackground('#1a1a2e')
        .setFontColor('#ffffff');
      sheet.setFrozenRows(1);
      Logger.log('Metrics: tab created.');
    }

    clearAutoRows_(sheet, 'Metrics');

    const rows = [];
    appendAll_(rows, buildTaskMetrics_());
    appendAll_(rows, buildCalendarMetrics_());
    appendAll_(rows, buildFlagMetrics_(ss));

    if (rows.length > 0) {
      sheet.insertRowsBefore(2, rows.length);
      sheet.getRange(2, 1, rows.length, METRIC_HEADERS.length)
        .setValues(rows)
        .setBackground('#eef2ff')
        .setFontColor('#333333');
    }

    Logger.log('Metrics: wrote ' + rows.length + ' auto-rows.');

  } catch (e) {
    Logger.log('writeMetrics_ error: ' + e.message);
  }
}

// ============================================================
// SUMMARIES TAB — external life intelligence feed
// ============================================================

/**
 * Clears and rewrites [AUTO] rows in the Summaries tab.
 * Sources: external Google Sheets defined in the Config tab via summary_sheet: rows.
 * Manual rows (no [AUTO] prefix) are never touched.
 */
function writeSummaries_(ss) {
  try {
    Logger.log('Summaries: starting external sheet snapshot...');

    // Create Summaries tab on first run if it doesn't exist yet
    let sheet = ss.getSheetByName(TABS.SUMMARIES);
    if (!sheet) {
      sheet = ss.insertSheet(TABS.SUMMARIES);
      const headerRange = sheet.getRange(1, 1, 1, SUMMARY_HEADERS.length);
      headerRange.setValues([SUMMARY_HEADERS])
        .setFontWeight('bold')
        .setBackground('#1a1a2e')
        .setFontColor('#ffffff');
      sheet.setFrozenRows(1);
      Logger.log('Summaries: tab created.');
    }

    clearAutoRows_(sheet, 'Summaries');

    const rows = buildExternalSheetRows_();

    if (rows.length > 0) {
      sheet.insertRowsBefore(2, rows.length);
      sheet.getRange(2, 1, rows.length, SUMMARY_HEADERS.length)
        .setValues(rows)
        .setBackground('#eef2ff')
        .setFontColor('#333333');
    }

    Logger.log('Summaries: wrote ' + rows.length + ' external rows.');

  } catch (e) {
    Logger.log('writeSummaries_ error: ' + e.message);
  }
}

// ============================================================
// CLEAR — Remove previous [AUTO] rows before re-writing
// ============================================================

/**
 * Deletes every row in a tab whose Source column starts with AUTO_PREFIX.
 * Iterates bottom-up so row numbers don't shift during deletion.
 *
 * @param {Sheet}  sheet   - The sheet to clear [AUTO] rows from
 * @param {string} tabDesc - Human-readable name for log messages
 */
function clearAutoRows_(sheet, tabDesc) {
  if (!sheet || sheet.getLastRow() < 2) return;

  const numRows = sheet.getLastRow() - 1;
  const sources = sheet.getRange(2, 1, numRows, 1).getValues();

  const toDelete = [];
  sources.forEach(function(row, i) {
    if (String(row[0]).indexOf(AUTO_PREFIX) === 0) {
      toDelete.push(i + 2);
    }
  });

  toDelete.reverse().forEach(function(rowNum) {
    sheet.deleteRow(rowNum);
  });

  Logger.log(tabDesc + ': cleared ' + toDelete.length + ' stale [AUTO] rows.');
}

// ============================================================
// METRICS BUILDERS — data sourced from within VERA's own sheet
// ============================================================

/**
 * Task health metrics from the Tasks tab.
 *   open_count          — total non-completed tasks
 *   overdue_count       — tasks past their due date
 *   due_within_7_days   — not yet overdue but due this week
 *   neglected_count     — tasks older than TASK_AGE_THRESHOLD
 */
function buildTaskMetrics_() {
  try {
    const tasks     = getOpenTasks();
    const today     = todayStr_();
    const overdue   = tasks.filter(function(t) { return t.isOverdue;   }).length;
    const neglected = tasks.filter(function(t) { return t.isNeglected; }).length;
    const dueSoon   = tasks.filter(function(t) {
      return !t.isOverdue && t.daysUntilDue !== null && t.daysUntilDue <= 7;
    }).length;

    return [
      row_(AUTO_PREFIX + ' Tasks', 'open_count',        tasks.length, today),
      row_(AUTO_PREFIX + ' Tasks', 'overdue_count',      overdue,      today),
      row_(AUTO_PREFIX + ' Tasks', 'due_within_7_days',  dueSoon,      today),
      row_(AUTO_PREFIX + ' Tasks', 'neglected_count',    neglected,    today),
    ];
  } catch (e) {
    Logger.log('buildTaskMetrics_ error: ' + e.message);
    return [];
  }
}

/**
 * Calendar health metrics from upcoming events.
 *   events_next_7_days   — total events across all calendars
 *   events_today         — events happening today
 *   events_with_location — events with a location (proxy for travel/prep needed)
 */
function buildCalendarMetrics_() {
  try {
    const events = getUpcomingEvents();
    const today  = todayStr_();

    return [
      row_(AUTO_PREFIX + ' Calendar', 'events_next_7_days',   events.length,                                                                           today),
      row_(AUTO_PREFIX + ' Calendar', 'events_today',          events.filter(function(ev) { return ev.daysUntil === 0;  }).length,                       today),
      row_(AUTO_PREFIX + ' Calendar', 'events_with_location',  events.filter(function(ev) { return ev.location !== ''; }).length,                        today),
    ];
  } catch (e) {
    Logger.log('buildCalendarMetrics_ error: ' + e.message);
    return [];
  }
}

/**
 * Active flag counts from the Flags tab.
 * Gives Claude longitudinal signal — a rising active count means the backlog is growing.
 *   active_count  — flags not acknowledged AND not resolved
 *   high_count    — subset with urgency = High
 *   medium_count  — subset with urgency = Medium
 */
function buildFlagMetrics_(ss) {
  try {
    const sheet = ss.getSheetByName(TABS.FLAGS);
    if (!sheet || sheet.getLastRow() < 2) return [];

    const today   = todayStr_();
    const numRows = sheet.getLastRow() - 1;
    const data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();

    const active = data.filter(function(r) {
      return String(r[6]).toLowerCase() !== 'yes' &&
             String(r[8]).toLowerCase() !== 'yes';
    });

    return [
      row_(AUTO_PREFIX + ' Flags', 'active_count',   active.length,                                                               today),
      row_(AUTO_PREFIX + ' Flags', 'high_count',      active.filter(function(r) { return r[5] === 'High';   }).length, today),
      row_(AUTO_PREFIX + ' Flags', 'medium_count',    active.filter(function(r) { return r[5] === 'Medium'; }).length, today),
    ];
  } catch (e) {
    Logger.log('buildFlagMetrics_ error: ' + e.message);
    return [];
  }
}

// ============================================================
// SUMMARIES BUILDER — data sourced from external Google Sheets
// ============================================================

/**
 * Reads arbitrary cells from external Google Sheets defined in the Config tab.
 * Results go into the Summaries tab — the life intelligence feed for Claude.
 *
 * Config row format (Setting | Value):
 *   summary_sheet:SourceName  |  SheetID|TabName|CellRef|metric_name
 *
 * Multiple rows with the same SourceName are all read (one row per metric).
 * If the external sheet is inaccessible, that row is skipped — the rest still runs.
 *
 * Example Config rows:
 *   summary_sheet:Finance         | 1aBc...|Budget|B5|groceries_actual_vs_budget
 *   summary_sheet:Finance         | 1aBc...|Budget|C2|wedding_fund_progress
 *   summary_sheet:SimpleAssTracker | 1xYz...|March|D8|checking_balance
 *   summary_sheet:Fitness         | 1mNb...|Log|E4|gym_sessions_this_week
 */
function buildExternalSheetRows_() {
  const rows  = [];
  const today = todayStr_();

  try {
    const cfg = getConfigValues();

    Object.keys(cfg).forEach(function(key) {
      if (key.indexOf('summary_sheet:') !== 0) return;

      const sourceName = key.substring('summary_sheet:'.length).trim();
      const parts      = String(cfg[key]).split('|');

      if (parts.length < 4) {
        Logger.log('Summaries: skipping malformed config "' + key + '" — expected SheetID|TabName|CellRef|metric_name');
        return;
      }

      const sheetId    = parts[0].trim();
      const tabName    = parts[1].trim();
      const cellRef    = parts[2].trim();
      const metricName = parts[3].trim();

      try {
        const extSS    = SpreadsheetApp.openById(sheetId);
        const extSheet = extSS.getSheetByName(tabName);

        if (!extSheet) {
          Logger.log('Summaries: tab "' + tabName + '" not found in sheet ' + sheetId + ' — skipping.');
          return;
        }

        const value = extSheet.getRange(cellRef).getValue();
        rows.push(row_(AUTO_PREFIX + ' ' + sourceName, metricName, value, today));
        Logger.log('Summaries: read [' + sourceName + '] ' + metricName + ' = ' + value);

      } catch (extErr) {
        Logger.log('Summaries: failed to read "' + sourceName + '" — ' + extErr.message);
      }
    });

  } catch (e) {
    Logger.log('buildExternalSheetRows_ error: ' + e.message);
  }

  return rows;
}

// ============================================================
// UTILITIES
// ============================================================

/** Returns today's date as yyyy-MM-dd in the script timezone. */
function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Builds a single tab row array: [Source, Metric, Value, As Of] */
function row_(source, metric, value, asOf) {
  return [source, metric, value, asOf];
}

/** Appends all elements of src into dest. */
function appendAll_(dest, src) {
  src.forEach(function(item) { dest.push(item); });
}
