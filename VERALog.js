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
  // Keys never reach a log. A failed aviationstack call once wrote its full request
  // URL, access_key and all, into the Error column — and from there into Slack too.
  summary = redactSecrets_(summary);
  error   = redactSecrets_(error);
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
    redactSecrets_(summary) || '',
    (durationMs != null && durationMs > 0) ? Math.round(durationMs / 1000) : '',
    redactSecrets_(error)   || '',
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

// ---- Secrets never reach a log ------------------------------------------------

/**
 * Text with credentials masked: "…?access_key=[redacted]&flight_iata=UA590".
 * Anything that isn't a string goes back untouched, so callers needn't check.
 *
 * URL parameters whose VALUE is a credential are matched by whole parameter name, so
 * "monkey=" or "keyword=" are left alone. The patterns live inside the function so it
 * stands alone wherever it's lifted.
 */
function redactSecrets_(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(/([?&;](?:access_key|api_key|apikey|key|appid|app_id|token|access_token|secret|client_secret|password|pwd|sig|signature)=)[^&#\s"'<>]+/gi, '$1[redacted]')
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+\/-]{8,}=*/g, '$1[redacted]');
}

var SECRETS_SCRUBBED_PROPERTY_ = 'LOG_SECRETS_SCRUBBED';

/**
 * Once: rewrites what VERA already logged before redaction existed — the System
 * Log's Summary and Error columns, and the errors kept in API-health state.
 * One read and, only if something changed, one write. A no-op after its first run.
 *
 * @returns {number} cells rewritten (-1 when it had already run)
 */
function scrubLoggedSecrets_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(SECRETS_SCRUBBED_PROPERTY_)) return -1;
  var changed = 0;

  var sheet = getSpreadsheet().getSheetByName(TABS.SYSTEM_LOG);
  if (sheet && sheet.getLastRow() >= 2) {
    var range = sheet.getRange(2, 1, sheet.getLastRow() - 1, SYSTEM_LOG_HEADERS.length);
    var rows = range.getValues();
    rows.forEach(function(r) {
      [4, 6].forEach(function(c) {
        var clean = redactSecrets_(r[c]);
        if (clean !== r[c]) { r[c] = clean; changed++; }
      });
    });
    if (changed) range.setValues(rows);
  }

  try {
    var state = getApiHealthState_();
    var touched = false;
    Object.keys(state).forEach(function(k) {
      var clean = redactSecrets_(state[k] && state[k].lastError);
      if (state[k] && clean !== state[k].lastError) { state[k].lastError = clean; touched = true; changed++; }
    });
    if (touched) setApiHealthState_(state);
  } catch (e) { Logger.log('scrubLoggedSecrets_: API health state — ' + e.message); }

  props.setProperty(SECRETS_SCRUBBED_PROPERTY_, new Date().toISOString());
  Logger.log('scrubLoggedSecrets_: ' + changed + ' logged value(s) had a credential masked.');
  return changed;
}
