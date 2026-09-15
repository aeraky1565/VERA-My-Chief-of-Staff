// ============================================================
// VERA — Mailer.js
// The single door every VERA email goes through
// ============================================================
//
// THE PROBLEM THIS SOLVES:
//   VERA sent mail from 13 call sites across 8 files, each calling
//   MailApp.sendEmail directly, and measured none of it. Two consequences:
//
//   1. MailApp.getRemainingDailyQuota() was never called anywhere. Apps Script
//      caps daily recipients; past the cap sendEmail throws. With the throw
//      swallowed by a caller's try/catch, running out of quota looked exactly
//      like nothing happening.
//
//   2. A briefing that quietly stopped going out had no signature at all. There
//      was nothing recording that it used to go out.
//
// WHAT THIS CAN AND CANNOT SEE:
//   It knows whether MailApp accepted the message, whether quota is running low,
//   and when each kind of email last went out. It does NOT know whether the
//   message reached an inbox — Gmail filing it under Trash or Spam is invisible
//   from the sending side, and detecting that would mean reading the mailbox
//   back, which is deliberately out of scope. Do not let this instrumentation
//   read as proof of delivery.
// ============================================================

// Warn when fewer than this many recipients remain in the daily quota.
var MAIL_QUOTA_WARN_THRESHOLD_ = 10;

/**
 * Sends an email and records that it happened.
 *
 * Drop-in replacement for MailApp.sendEmail's (to, subject, body, options) form,
 * with one extra argument naming what kind of email this is.
 *
 * Re-throws on failure, matching MailApp's own contract — callers that already
 * wrap sends in try/catch keep behaving exactly as they did.
 *
 * @param {string} to        Recipient(s), comma-separated
 * @param {string} subject   Subject line
 * @param {string} body      Plain-text body
 * @param {Object} [options] MailApp options (name, htmlBody, inlineImages, cc…)
 * @param {string} [kind]    Stable label for this email, e.g. 'morning_briefing'
 * @returns {boolean} true if the send was accepted
 */
function sendVeraEmail_(to, subject, body, options, kind) {
  var label      = kind || 'unlabelled';
  var recipients = String(to || '').split(',').filter(function(r) { return r.trim(); }).length;

  // ---- Quota check ---------------------------------------------------------
  // Checked before sending so the warning arrives while there is still quota
  // left to carry it.
  var remaining = null;
  try {
    remaining = MailApp.getRemainingDailyQuota();
    if (remaining <= MAIL_QUOTA_WARN_THRESHOLD_) {
      recordApiHealth_('mail:quota', false,
        'only ' + remaining + ' recipient(s) left in today\'s quota', 0);
    } else {
      recordApiHealth_('mail:quota', true, '', 0);
    }
  } catch (qErr) {
    Logger.log('sendVeraEmail_: quota check failed — ' + qErr.message);
  }

  if (remaining !== null && remaining < recipients) {
    var msg = 'daily mail quota exhausted (' + remaining + ' left, ' +
              recipients + ' needed) — "' + subject + '" not sent';
    recordApiHealth_('mail:send', false, msg, 0);
    veraLog_('sendVeraEmail', 'Email', 'Failed', label + ' — ' + subject, 0, msg);
    throw new Error(msg);
  }

  // ---- Send ----------------------------------------------------------------
  var t0 = Date.now();
  try {
    MailApp.sendEmail(to, subject, body, options || {});
  } catch (err) {
    recordApiHealth_('mail:send', false, err.message, 0);
    veraLog_('sendVeraEmail', 'Email', 'Failed', label + ' — ' + subject,
             Date.now() - t0, err.message);
    throw err;
  }

  recordApiHealth_('mail:send', true, '', 0);

  // A per-kind timestamp: "when did this kind of email last go out?" had no
  // answer anywhere before. Not itself watched for overdueness — most of these
  // are event-driven (a trip recap has no cadence to be late against). Emails
  // that DO have a cadence record a channel-agnostic delivery heartbeat at their
  // own call site instead, so switching one to Slack doesn't read as silence.
  recordHeartbeat_('mail:' + label);

  veraLog_('sendVeraEmail', 'Email', 'Success',
           label + ' — "' + subject + '" to ' + recipients + ' recipient(s)' +
           (remaining !== null ? ' · ' + (remaining - recipients) + ' quota left' : ''),
           Date.now() - t0);

  return true;
}
