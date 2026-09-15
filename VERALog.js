/**
 * VERALog.js — VERA's audit trail.
 *
 * Every major routine reports here. Entries go two places:
 *
 *   1. #vera-logs in Slack, as they always have — live, readable, ephemeral.
 *   2. The 'System Log' tab, buffered and flushed once per execution.
 *
 * WHY THE SHEET EXISTS:
 *   Until now this function only called sendSlackLog_, so VERA's entire
 *   diagnostic history lived in a Slack channel and nowhere else. Nothing could
 *   query it, and a Slack outage erased the record of the outage. Worse, the
 *   question you actually ask during an incident — "when did this last work?" —
 *   had no answer anywhere in the system.
 *
 * WHY IT IS BUFFERED:
 *   A nightly run produces dozens of entries. One appendRow each is a round trip
 *   each, against a run that already sheds steps on its time budget. So rows
 *   accumulate in memory and go out in a single setValues.
 *
 *   The cost of buffering is real and worth naming: an execution that dies takes
 *   its unflushed buffer with it, and that is exactly the execution you most
 *   wanted logged. Every entry point therefore flushes in a finally/catch, not
 *   only on the happy path, and the buffer auto-flushes once it gets large.
 *
 * Fails silently throughout — a diagnostics helper must never break its caller.
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
    var emoji = { Success: '✅', Partial: '⚠️', Failed: '❌', Skipped: '⏭️' }[status] || '🔹';
    var parts = [emoji + ' *' + routine + '* [' + category + '] — ' + status];
    if (summary) parts.push(summary);
    if (durationMs != null && durationMs > 0) {
      var s = Math.round(durationMs / 1000);
      parts.push(s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's');
    }
    if (error) parts.push('Error: ' + error);
    sendSlackLog_(parts.join(' — '));
  } catch (e) {
    // Never let logging crash the caller
    Logger.log('veraLog_ failed silently: ' + e.message);
  }

  // Sheet persistence is deliberately in its own try — a Slack failure must not
  // cost us the durable copy, and vice versa.
  try {
    bufferSystemLogRow_(routine, category, status, summary, durationMs, error);
  } catch (e2) {
    Logger.log('veraLog_ buffering failed silently: ' + e2.message);
  }
}

// ---- System Log persistence -------------------------------------------------

// GAS gives each execution a fresh global scope, so this buffer is per-run.
var _systemLogBuffer_   = [];
var _systemLogSheet_    = null;

// Flush automatically once the buffer reaches this size, so a long run never
// holds more than this many entries hostage to a crash.
var SYSTEM_LOG_AUTOFLUSH_ROWS_ = 50;

/** Appends one entry to the in-memory buffer, flushing early if it is full. */
function bufferSystemLogRow_(routine, category, status, summary, durationMs, error) {
  _systemLogBuffer_.push([
    new Date(),
    routine  || '',
    category || '',
    status   || '',
    summary  || '',
    (durationMs != null && durationMs > 0) ? Math.round(durationMs / 1000) : '',
    error    || '',
  ]);

  if (_systemLogBuffer_.length >= SYSTEM_LOG_AUTOFLUSH_ROWS_) flushSystemLog_();
}

/**
 * Returns the System Log sheet, creating it if it does not exist.
 *
 * Created here and not only in setupVERA() on purpose: ensureSheet runs at setup
 * time, so a writer that gives up when its tab is missing simply never writes.
 * That is how the TravelLegs tab stayed empty for a week.
 */
function getSystemLogSheet_() {
  if (_systemLogSheet_) return _systemLogSheet_;
  _systemLogSheet_ = ensureSheet(getSpreadsheet(), TABS.SYSTEM_LOG, SYSTEM_LOG_HEADERS);
  return _systemLogSheet_;
}

/**
 * Writes every buffered entry in one setValues and empties the buffer.
 *
 * Safe to call any number of times, including when nothing is buffered — every
 * trigger entry point calls it in a finally block.
 */
function flushSystemLog_() {
  if (!_systemLogBuffer_.length) return 0;

  // Take the rows before writing. If setValues throws we do not want the same
  // rows retried on the next flush and duplicated on a partial success.
  var rows = _systemLogBuffer_;
  _systemLogBuffer_ = [];

  try {
    var sheet = getSystemLogSheet_();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SYSTEM_LOG_HEADERS.length)
         .setValues(rows);
    return rows.length;
  } catch (e) {
    Logger.log('flushSystemLog_ failed silently (' + rows.length + ' entries lost): ' + e.message);
    return 0;
  }
}

/**
 * Deletes System Log rows older than the retention window.
 *
 * Rows are appended in time order, so everything expired is one contiguous block
 * at the top — a single deleteRows call rather than pruneMemoryLog_'s
 * row-by-row loop, which matters because this tab is far higher volume.
 *
 * @returns {number} rows deleted
 */
function pruneSystemLog_() {
  var cfg      = getConfigValues();
  var retainDays = parseInt(cfg['system_log_retention_days'] || '45', 10) || 45;

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.SYSTEM_LOG);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retainDays);

  var stamps = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  var expired = 0;
  for (var i = 0; i < stamps.length; i++) {
    var d = stamps[i][0] ? new Date(stamps[i][0]) : null;
    if (!d || isNaN(d.getTime()) || d >= cutoff) break;  // first live row ends the block
    expired++;
  }

  if (expired > 0) {
    sheet.deleteRows(2, expired);
    Logger.log('pruneSystemLog_: deleted ' + expired + ' entries older than ' + retainDays + ' days.');
  }
  return expired;
}
