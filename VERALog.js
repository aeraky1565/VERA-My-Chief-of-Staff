/**
 * VERALog.js — Persistent audit log for major VERA routine invocations.
 *
 * Writes one row to the VERA Log sheet tab for each major routine run.
 * Fails silently so it never breaks the calling script.
 *
 * Usage:
 *   var _start = Date.now();
 *   // ... do work ...
 *   veraLog_('nightlyRun', 'Nightly', 'Success', '12 flags written', Date.now() - _start);
 *
 * @param {string} routine     Function name, e.g. 'nightlyRun', 'runEmailAdmin'
 * @param {string} category    'Nightly' | 'Email' | 'Planning' | 'Travel' | 'Finance' | 'Health'
 * @param {string} status      'Success' | 'Partial' | 'Failed' | 'Skipped'
 * @param {string} summary     Human-readable result, e.g. '12 flags written (3H 6M 3L)'
 * @param {number} [durationMs] How long the routine took in milliseconds
 * @param {string} [error]     Error message if status is Failed or Partial
 */
function veraLog_(routine, category, status, summary, durationMs, error) {
  try {
    var ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sheet = ss.getSheetByName(TABS.VERA_LOG);
    if (!sheet) {
      Logger.log('veraLog_: VERA Log sheet not found — skipping. Run createSheetTabs() to create it.');
      return;
    }
    var id = 'vl_' + Date.now();
    var ts = new Date().toISOString();
    sheet.appendRow([id, ts, routine, category, status,
                     durationMs != null ? durationMs : '',
                     summary    != null ? summary    : '',
                     error      != null ? error      : '']);
    // Trim to 1000 rows max — delete oldest entries from row 2 onward
    var lastRow = sheet.getLastRow();
    if (lastRow > 1001) {
      sheet.deleteRows(2, lastRow - 1001);
    }
  } catch (e) {
    // Never let logging crash the caller
    Logger.log('veraLog_ failed silently: ' + e.message);
  }
}
