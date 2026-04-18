/**
 * VERALog.js — Posts a structured audit log entry to #vera-logs Slack channel
 * for each major VERA routine invocation.
 *
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
    // Skipped = routine was gated (disabled, day-of-week, cooldown) — not a real event, skip Slack
    if (status === 'Skipped') return;
    var emoji = { Success: '✅', Partial: '⚠️', Failed: '❌' }[status] || '🔹';
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
}
