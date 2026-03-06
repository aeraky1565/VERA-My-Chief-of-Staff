// ============================================================
// VERA — Summaries.js  (Phase 5)
// Auto-populates the Summaries tab nightly from live data
// ============================================================
//
// CONVENTION:
//   Rows whose Source column starts with "[AUTO]" are owned by this script.
//   They are wiped and rewritten fresh each night.
//   Rows WITHOUT the "[AUTO]" prefix are your manual notes — never touched.
//
// HOW TO ADD EXTERNAL SHEET SOURCES:
//   In your Config tab add one row per metric, with this exact format:
//
//     Setting                          | Value
//     summary_sheet:SimpleAssTracker   | SHEET_ID|TabName|CellRef|metric_name
//
//   Example:
//     summary_sheet:SimpleAssTracker   | 1aBc...XyZ|Budget|B2|checking_balance
//     summary_sheet:SimpleAssTracker   | 1aBc...XyZ|Budget|B5|monthly_spend
//
//   The external sheet must be shared (at least viewer access) with your
//   Google account (aaeleraky@gmail.com).
// ============================================================

var AUTO_PREFIX = '[AUTO]';

// ============================================================
// MAIN ENTRY POINT — called from nightlyRun() in Code.js
// ============================================================

/**
 * Clears all [AUTO] Summaries rows then writes a fresh nightly snapshot.
 * Runs BEFORE getSummaries() + generateFlags() so Claude sees current data.
 */
function writeSummarySnapshot() {
  try {
    Logger.log('Summaries: starting auto-snapshot...');

    const ss    = getSpreadsheet();
    const sheet = ss.getSheetByName(TABS.SUMMARIES);
    if (!sheet) {
      Logger.log('Summaries: tab not found — skipping snapshot.');
      return;
    }

    // 1. Wipe previous [AUTO] rows
    clearAutoSummaries_(sheet);

    // 2. Build fresh rows from every source
    const rows = [];
    appendAll_(rows, buildTaskSummaries_());
    appendAll_(rows, buildCalendarSummaries_());
    appendAll_(rows, buildFlagSummaries_(ss));
    appendAll_(rows, buildExternalSheetSummaries_());

    // 3. Insert at row 2 (just below header) so auto rows appear at the top
    if (rows.length > 0) {
      sheet.insertRowsBefore(2, rows.length);
      sheet.getRange(2, 1, rows.length, SUMMARY_HEADERS.length).setValues(rows);
      // Subtle blue-tint background so auto rows are visually distinct
      sheet.getRange(2, 1, rows.length, SUMMARY_HEADERS.length)
        .setBackground('#eef2ff')
        .setFontColor('#333333');
    }

    Logger.log('Summaries: wrote ' + rows.length + ' auto-snapshot rows.');

  } catch (e) {
    Logger.log('writeSummarySnapshot error: ' + e.message + '\n' + e.stack);
  }
}

// ============================================================
// CLEAR — Remove previous [AUTO] rows before re-writing
// ============================================================

/**
 * Deletes every row in the Summaries tab whose Source starts with AUTO_PREFIX.
 * Iterates bottom-up so row numbers don't shift during deletion.
 */
function clearAutoSummaries_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return;

  const numRows = sheet.getLastRow() - 1;
  const sources = sheet.getRange(2, 1, numRows, 1).getValues();

  // Collect 1-indexed sheet row numbers, then reverse so we delete bottom-up
  const toDelete = [];
  sources.forEach(function(row, i) {
    if (String(row[0]).indexOf(AUTO_PREFIX) === 0) {
      toDelete.push(i + 2);
    }
  });

  toDelete.reverse().forEach(function(rowNum) {
    sheet.deleteRow(rowNum);
  });

  Logger.log('Summaries: cleared ' + toDelete.length + ' stale [AUTO] rows.');
}

// ============================================================
// SNAPSHOT BUILDERS — one per data source
// ============================================================

/**
 * Task metrics derived from the Tasks tab.
 *
 * Metrics written:
 *   open_count          — total non-completed tasks
 *   overdue_count       — tasks past their due date
 *   due_within_7_days   — not yet overdue but due within the week
 *   neglected_count     — tasks older than TASK_AGE_THRESHOLD with no due date soon
 */
function buildTaskSummaries_() {
  try {
    const tasks     = getOpenTasks();
    const today     = todayStr_();
    const overdue   = tasks.filter(function(t) { return t.isOverdue;   }).length;
    const neglected = tasks.filter(function(t) { return t.isNeglected; }).length;
    const dueSoon   = tasks.filter(function(t) {
      return !t.isOverdue && t.daysUntilDue !== null && t.daysUntilDue <= 7;
    }).length;

    return [
      row_(AUTO_PREFIX + ' Tasks', 'open_count',         tasks.length, today),
      row_(AUTO_PREFIX + ' Tasks', 'overdue_count',       overdue,      today),
      row_(AUTO_PREFIX + ' Tasks', 'due_within_7_days',   dueSoon,      today),
      row_(AUTO_PREFIX + ' Tasks', 'neglected_count',     neglected,    today),
    ];
  } catch (e) {
    Logger.log('buildTaskSummaries_ error: ' + e.message);
    return [];
  }
}

/**
 * Calendar metrics derived from upcoming events.
 *
 * Metrics written:
 *   events_next_7_days   — total events across all calendars
 *   events_today         — events happening today
 *   events_with_location — events that have a location (proxy for "needs travel/prep")
 */
function buildCalendarSummaries_() {
  try {
    const events  = getUpcomingEvents();
    const today   = todayStr_();

    const todayCount    = events.filter(function(ev) { return ev.daysUntil === 0;   }).length;
    const withLocation  = events.filter(function(ev) { return ev.location !== '';    }).length;

    return [
      row_(AUTO_PREFIX + ' Calendar', 'events_next_7_days',   events.length, today),
      row_(AUTO_PREFIX + ' Calendar', 'events_today',          todayCount,    today),
      row_(AUTO_PREFIX + ' Calendar', 'events_with_location',  withLocation,  today),
    ];
  } catch (e) {
    Logger.log('buildCalendarSummaries_ error: ' + e.message);
    return [];
  }
}

/**
 * Active flag counts from the Flags tab.
 * Gives Claude a longitudinal view: if active flags keep rising, that's a signal.
 *
 * Metrics written:
 *   active_count   — flags that are neither acknowledged nor resolved
 *   high_count     — subset with urgency = High
 *   medium_count   — subset with urgency = Medium
 */
function buildFlagSummaries_(ss) {
  try {
    const sheet = ss.getSheetByName(TABS.FLAGS);
    if (!sheet || sheet.getLastRow() < 2) return [];

    const today   = todayStr_();
    const numRows = sheet.getLastRow() - 1;
    const data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();

    const active = data.filter(function(r) {
      return String(r[6]).toLowerCase() !== 'yes' &&   // not acknowledged
             String(r[8]).toLowerCase() !== 'yes';     // not resolved
    });

    const high   = active.filter(function(r) { return r[5] === 'High';   }).length;
    const medium = active.filter(function(r) { return r[5] === 'Medium'; }).length;

    return [
      row_(AUTO_PREFIX + ' Flags', 'active_count',   active.length, today),
      row_(AUTO_PREFIX + ' Flags', 'high_count',      high,          today),
      row_(AUTO_PREFIX + ' Flags', 'medium_count',    medium,        today),
    ];
  } catch (e) {
    Logger.log('buildFlagSummaries_ error: ' + e.message);
    return [];
  }
}

/**
 * Reads arbitrary cells from external Google Sheets defined in the Config tab.
 *
 * Config row format (Setting | Value):
 *   summary_sheet:SourceName  |  SheetID|TabName|CellRef|metric_name
 *
 * Multiple rows with the same SourceName are all read (one per metric).
 * If the external sheet is inaccessible the row is skipped with a log entry —
 * the rest of the snapshot still runs normally.
 */
function buildExternalSheetSummaries_() {
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
    Logger.log('buildExternalSheetSummaries_ error: ' + e.message);
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

/** Builds a single Summaries row array: [Source, Metric, Value, As Of] */
function row_(source, metric, value, asOf) {
  return [source, metric, value, asOf];
}

/** Appends all elements of src array into dest array (Array.push.apply polyfill). */
function appendAll_(dest, src) {
  src.forEach(function(item) { dest.push(item); });
}
