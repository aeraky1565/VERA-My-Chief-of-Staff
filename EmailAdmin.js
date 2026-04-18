// ============================================================
// VERA — EmailAdmin.js
// Sunday inbox triage: classify emails via Claude, label them,
// draft replies, and track follow-ups. (Issue #144)
// ============================================================

// ---- Constants -------------------------------------------------------------

var EMAIL_ADMIN_LAST_SCAN_KEY = 'EMAIL_ADMIN_LAST_SCAN';

// Gmail label names used by Email Admin. The '/' creates nested labels
// under a 'VERA' parent — Apps Script handles this automatically.
var EA_LABELS = {
  needs_reply:   'VERA/Needs Reply',
  follow_up:     'VERA/Follow-up',
  informational: 'VERA/Informational',
  promotional:   'VERA/Promotional',
};

// ============================================================
// MAIN ENTRY POINT
// ============================================================

/**
 * runEmailAdmin_()
 *
 * Main entry point for the Email Admin feature. Reads config, applies a
 * frequency gate, searches Gmail for unreviewed inbox threads since the
 * last scan, sends them to Claude for classification, applies Gmail labels,
 * creates draft replies for "needs_reply" emails, logs "follow_up" threads
 * to the Email Follow-ups sheet, and posts a Slack summary.
 *
 * Called by a daily time-based trigger (internal frequency gate handles
 * whether to actually proceed on a given day).
 */
function runEmailAdmin_() {
  var _eaStart = Date.now();
  try {
  // ── Step 1: Read config ──────────────────────────────────────────────────
  var config = getConfigValues();

  var enabled = config['email_admin_enabled'];
  if (enabled !== 'true') {
    Logger.log('runEmailAdmin_: email_admin_enabled is not true — skipping.');
    veraLog_('runEmailAdmin', 'Email', 'Skipped', 'email_admin_enabled is not true', Date.now() - _eaStart);
    return;
  }

  var frequency   = config['email_admin_frequency'] || 'weekly';
  var skipSenders = config['email_skip_senders'] || '';
  var tone        = config['email_tone'] || 'professional but warm and concise';

  // ── Step 2: Frequency gate ────────────────────────────────────────────────
  var props = PropertiesService.getScriptProperties();
  var now   = new Date();

  if (frequency === 'weekly') {
    // Only proceed on Sundays (day 0 in the script timezone)
    var tz          = Session.getScriptTimeZone();
    var dayOfWeek   = parseInt(Utilities.formatDate(now, tz, 'u'), 10) % 7; // 'u' = 1-Mon … 7-Sun → mod 7 → Sun=0
    if (dayOfWeek !== 0) {
      Logger.log('runEmailAdmin_: frequency=weekly but today is not Sunday — skipping.');
      veraLog_('runEmailAdmin', 'Email', 'Skipped', 'frequency=weekly, not Sunday', Date.now() - _eaStart);
      return;
    }
  } else if (frequency === '3days') {
    var lastScanRaw = props.getProperty(EMAIL_ADMIN_LAST_SCAN_KEY);
    if (lastScanRaw) {
      var lastScanDate = new Date(lastScanRaw);
      var daysSince = (now.getTime() - lastScanDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 3) {
        Logger.log('runEmailAdmin_: frequency=3days, last scan was ' + daysSince.toFixed(1) + ' days ago — skipping.');
        veraLog_('runEmailAdmin', 'Email', 'Skipped', 'frequency=3days, last scan ' + daysSince.toFixed(1) + ' days ago', Date.now() - _eaStart);
        return;
      }
    }
  }

  // ── Step 3: Determine last scan window ───────────────────────────────────
  var lastScanStr = props.getProperty(EMAIL_ADMIN_LAST_SCAN_KEY);
  var lastScanDate;
  if (lastScanStr) {
    lastScanDate = new Date(lastScanStr);
  } else {
    // Default: 7 days ago
    lastScanDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  var epochSeconds = Math.floor(lastScanDate.getTime() / 1000);

  Logger.log('runEmailAdmin_: scanning inbox since ' + lastScanDate.toISOString() + ' (epoch ' + epochSeconds + ')');

  // ── Step 4: Fetch inbox threads ───────────────────────────────────────────
  var threads;
  try {
    threads = GmailApp.search('in:inbox after:' + epochSeconds, 0, 50);
  } catch (gmErr) {
    Logger.log('runEmailAdmin_: GmailApp.search error: ' + gmErr.message);
    return;
  }

  // Collect most-recent message per thread
  var rawCandidates = [];
  for (var i = 0; i < threads.length; i++) {
    var thread   = threads[i];
    var messages = thread.getMessages();
    if (!messages || messages.length === 0) continue;
    var msg = messages[messages.length - 1]; // most recent
    rawCandidates.push({ thread: thread, message: msg });
  }

  // ── Step 5: Filter ────────────────────────────────────────────────────────
  var skipPatterns = skipSenders
    ? skipSenders.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean)
    : [];

  var SKIP_DOMAINS = ['noreply', 'no-reply', 'mailer-daemon', 'donotreply'];

  var candidates = [];
  for (var j = 0; j < rawCandidates.length; j++) {
    var item    = rawCandidates[j];
    var msg     = item.message;
    var from    = (msg.getFrom() || '').toLowerCase();
    var subject = (msg.getSubject() || '').toLowerCase();

    // Filter: skip if subject contains "vera" (our own nudge emails)
    if (subject.indexOf('vera') !== -1) {
      Logger.log('runEmailAdmin_: skipping VERA email — subject: ' + msg.getSubject());
      continue;
    }

    // Filter: skip no-reply / automated sender domains
    var skipDomain = false;
    for (var d = 0; d < SKIP_DOMAINS.length; d++) {
      if (from.indexOf(SKIP_DOMAINS[d]) !== -1) {
        skipDomain = true;
        break;
      }
    }
    if (skipDomain) continue;

    // Filter: user-defined skip sender patterns
    var skipUser = false;
    for (var p = 0; p < skipPatterns.length; p++) {
      if (skipPatterns[p] && from.indexOf(skipPatterns[p]) !== -1) {
        skipUser = true;
        break;
      }
    }
    if (skipUser) continue;

    candidates.push(item);
  }

  // ── Step 6: Early-exit if nothing to process ─────────────────────────────
  if (candidates.length === 0) {
    props.setProperty(EMAIL_ADMIN_LAST_SCAN_KEY, now.toISOString());
    sendSlackLog_(':mailbox: Email Admin: no new emails to process');
    Logger.log('runEmailAdmin_: no candidates after filtering — done.');
    veraLog_('runEmailAdmin', 'Email', 'Success', 'No new emails to process', Date.now() - _eaStart);
    return;
  }

  Logger.log('runEmailAdmin_: ' + candidates.length + ' candidate thread(s) to classify.');

  // ── Step 7: Build batch payload for Claude ────────────────────────────────
  var batchPayload = candidates.map(function(item) {
    var msg     = item.message;
    var plain   = msg.getPlainBody() || '';
    var snippet = plain.substring(0, 300);
    return {
      id:      msg.getId(),
      from:    msg.getFrom(),
      subject: msg.getSubject(),
      snippet: snippet
    };
  });

  // ── Step 8: Classify with Claude ──────────────────────────────────────────
  var classifications = classifyEmailsWithClaude_(batchPayload, tone);
  if (!classifications || classifications.length === 0) {
    Logger.log('runEmailAdmin_: Claude returned no classifications.');
    // Still update scan timestamp so we don't reprocess these threads
    props.setProperty(EMAIL_ADMIN_LAST_SCAN_KEY, now.toISOString());
    return;
  }

  // Build a quick lookup of candidate items by message ID
  var candidateMap = {};
  for (var k = 0; k < candidates.length; k++) {
    candidateMap[candidates[k].message.getId()] = candidates[k];
  }

  // ── Step 9: Process each classification result ────────────────────────────
  var counts       = { needs_reply: 0, follow_up: 0, informational: 0, promotional: 0 };
  var needsReplyList = []; // [{from, subject}] for Slack summary

  for (var r = 0; r < classifications.length; r++) {
    var result    = classifications[r];
    var msgId     = result.id;
    var category  = result.category;
    var draftBody = result.draftReply || '';

    if (!msgId || !category) continue;

    // Increment counter (guard unknown categories)
    if (counts.hasOwnProperty(category)) {
      counts[category]++;
    }

    // 9a: Apply Gmail label
    applyEmailLabel_(msgId, category);

    // 9b: Create draft reply for needs_reply
    if (category === 'needs_reply') {
      createEmailDraft_(msgId, draftBody);
      var item = candidateMap[msgId];
      if (item) {
        needsReplyList.push({
          from:    item.message.getFrom(),
          subject: item.message.getSubject()
        });
      }
    }

    // 9c: Log follow-ups to sheet
    if (category === 'follow_up') {
      var followItem = candidateMap[msgId];
      if (followItem) {
        logEmailFollowUp_(followItem.thread, followItem.message);
      }
    }
  }

  // ── Step 10: Update last scan timestamp ───────────────────────────────────
  props.setProperty(EMAIL_ADMIN_LAST_SCAN_KEY, now.toISOString());

  // ── Step 11: Post Slack summary ───────────────────────────────────────────
  var lines = [':mailbox_with_mail: *Email Admin — Inbox Triage Complete*'];
  lines.push('• Needs Reply: ' + counts.needs_reply);
  lines.push('• Follow-up: '    + counts.follow_up);
  lines.push('• Informational: ' + counts.informational);
  lines.push('• Promotional: '  + counts.promotional);

  if (needsReplyList.length > 0) {
    lines.push('');
    lines.push('*Needs Reply (top ' + Math.min(needsReplyList.length, 5) + '):*');
    var limit = Math.min(needsReplyList.length, 5);
    for (var n = 0; n < limit; n++) {
      var nr = needsReplyList[n];
      lines.push('  — ' + nr.from + ' | ' + nr.subject);
    }
  }

  // Call out follow-ups waiting > 3 days
  try {
    var followUpSheet = getSpreadsheet().getSheetByName(TABS.EMAIL_FOLLOW_UPS);
    if (followUpSheet && followUpSheet.getLastRow() > 1) {
      var fuData    = followUpSheet.getDataRange().getValues();
      var fuHeaders = fuData[0];
      var statusCol  = fuHeaders.indexOf('Status');
      var flaggedCol = fuHeaders.indexOf('Date Flagged');
      var subjectCol = fuHeaders.indexOf('Subject');
      var senderCol  = fuHeaders.indexOf('Sender');
      var staleLines = [];
      var today      = new Date();
      for (var fi = 1; fi < fuData.length; fi++) {
        var row = fuData[fi];
        if (row[statusCol] !== 'Waiting') continue;
        var flaggedDate = new Date(row[flaggedCol]);
        var daysWaiting = Math.floor((today.getTime() - flaggedDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysWaiting > 3) {
          staleLines.push('  :hourglass: ' + row[subjectCol] + ' (' + row[senderCol] + ') — ' + daysWaiting + ' days waiting');
        }
      }
      if (staleLines.length > 0) {
        lines.push('');
        lines.push('*Follow-ups waiting >3 days:*');
        lines = lines.concat(staleLines);
      }
    }
  } catch (fuErr) {
    Logger.log('runEmailAdmin_: follow-up stale check error (non-fatal): ' + fuErr.message);
  }

  sendSlackNotification_(lines.join('\n'), null, 'Low');
  Logger.log('runEmailAdmin_: complete. ' + JSON.stringify(counts));
  veraLog_('runEmailAdmin', 'Email', 'Success',
    candidates.length + ' email(s) classified — ' +
      counts.needs_reply + ' needs reply, ' + counts.follow_up + ' follow-up, ' +
      counts.informational + ' info, ' + counts.promotional + ' promo',
    Date.now() - _eaStart);
  } catch (err) {
    Logger.log('runEmailAdmin_ FATAL: ' + err.message + '\n' + (err.stack || ''));
    veraLog_('runEmailAdmin', 'Email', 'Failed', '', Date.now() - _eaStart, err.message);
  }
}

// ============================================================
// CLAUDE CLASSIFICATION
// ============================================================

/**
 * classifyEmailsWithClaude_(candidates, tone)
 *
 * Sends a batch of email candidates to Claude for classification.
 * Returns an array of {id, category, draftReply?} objects.
 *
 * @param {Array}  candidates - Array of {id, from, subject, snippet}
 * @param {string} tone       - Tone instruction for draft replies
 * @return {Array} classifications - [{id, category, draftReply?}, ...]
 */
function classifyEmailsWithClaude_(candidates, tone) {
  try {
    var systemPrompt =
      'You are VERA\'s email triage assistant for Ahmed\'s personal inbox.\n\n' +
      'Classify each email into exactly one category:\n' +
      '- needs_reply: a real person or business is clearly expecting a direct response from Ahmed\n' +
      '- follow_up: Ahmed sent something first and appears to be waiting on their reply\n' +
      '- informational: useful info, no response needed (bills, statements, receipts, shipping, notices)\n' +
      '- promotional: marketing, newsletters, deals, automated system emails\n\n' +
      'Skip (classify as promotional): VERA digest emails, mailing lists, automated notifications.\n\n' +
      'For every needs_reply email, also write a short draft reply (2-4 sentences). Tone: ' + tone + '.\n' +
      'Start the draft body with: [VERA draft — review before sending]\n\n' +
      'Return ONLY a valid JSON array, no markdown fences:\n' +
      '[{"id":"msgId","category":"needs_reply","draftReply":"[VERA draft — review before sending]\\n\\nHi John,\\n..."},...]\n\n' +
      'Emails to classify:\n' +
      JSON.stringify(candidates);

    var payload = JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [
        { role: 'user', content: systemPrompt }
      ]
    });

    var options = {
      method:      'post',
      contentType: 'application/json',
      headers: {
        'x-api-key':         getApiKey(),
        'anthropic-version': '2023-06-01'
      },
      payload:          payload,
      muteHttpExceptions: true
    };

    var response     = UrlFetchApp.fetch(CLAUDE_API_URL, options);
    var responseCode = response.getResponseCode();
    var responseText = response.getContentText();

    if (responseCode !== 200) {
      Logger.log('classifyEmailsWithClaude_: API error ' + responseCode + ': ' + responseText);
      return [];
    }

    var parsed = JSON.parse(responseText);
    var raw    = parsed.content && parsed.content[0] && parsed.content[0].text
                 ? parsed.content[0].text.trim()
                 : '';

    // Defensively strip markdown fences if Claude wraps in ```json ... ```
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    var result = JSON.parse(raw);
    if (!Array.isArray(result)) {
      Logger.log('classifyEmailsWithClaude_: expected array, got: ' + typeof result);
      return [];
    }
    return result;

  } catch (e) {
    Logger.log('classifyEmailsWithClaude_ error: ' + e.message);
    return [];
  }
}

// ============================================================
// GMAIL LABEL HELPER
// ============================================================

/**
 * applyEmailLabel_(messageId, category)
 *
 * Gets or creates the Gmail label corresponding to the given category,
 * then applies it to the thread containing the specified message.
 *
 * @param {string} messageId - Gmail message ID
 * @param {string} category  - One of the EA_LABELS keys
 */
function applyEmailLabel_(messageId, category) {
  try {
    var labelName = EA_LABELS[category];
    if (!labelName) {
      Logger.log('applyEmailLabel_: unknown category "' + category + '" — skipping.');
      return;
    }

    // Get or create the label (Apps Script handles nested 'VERA/...' labels automatically)
    var label = GmailApp.getUserLabelByName(labelName) || GmailApp.createLabel(labelName);

    var message = GmailApp.getMessageById(messageId);
    var thread  = message.getThread();
    label.addToThread(thread);

  } catch (e) {
    Logger.log('applyEmailLabel_ error (messageId=' + messageId + ', category=' + category + '): ' + e.message);
  }
}

// ============================================================
// DRAFT REPLY HELPER
// ============================================================

/**
 * createEmailDraft_(messageId, draftBody)
 *
 * Creates a Gmail draft reply to the given message using the provided body.
 *
 * @param {string} messageId - Gmail message ID
 * @param {string} draftBody - Draft reply body text
 * @return {boolean} true on success, false on error
 */
function createEmailDraft_(messageId, draftBody) {
  try {
    if (!draftBody) {
      Logger.log('createEmailDraft_: empty draftBody for messageId=' + messageId + ' — skipping.');
      return false;
    }
    var message = GmailApp.getMessageById(messageId);
    message.createDraftReply(draftBody);
    Logger.log('createEmailDraft_: draft created for messageId=' + messageId);
    return true;
  } catch (e) {
    Logger.log('createEmailDraft_ error (messageId=' + messageId + '): ' + e.message);
    return false;
  }
}

// ============================================================
// FOLLOW-UP SHEET HELPER
// ============================================================

/**
 * logEmailFollowUp_(thread, message)
 *
 * Appends a row to the Email Follow-ups sheet tracking a thread where Ahmed
 * is waiting for a reply. Prevents duplicate Thread IDs.
 *
 * Columns (EMAIL_FOLLOW_UP_HEADERS): Thread ID | Subject | Sender | Date Flagged | Status
 *
 * @param {GmailThread}  thread  - The Gmail thread
 * @param {GmailMessage} message - The most-recent message in that thread
 */
function logEmailFollowUp_(thread, message) {
  try {
    var sheet = getSpreadsheet().getSheetByName(TABS.EMAIL_FOLLOW_UPS);
    if (!sheet) {
      Logger.log('logEmailFollowUp_: Email Follow-ups sheet not found — skipping.');
      return;
    }

    var threadId = thread.getId();

    // Duplicate check: scan existing Thread ID column
    if (sheet.getLastRow() > 1) {
      var existingIds = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < existingIds.length; i++) {
        if (existingIds[i][0] === threadId) {
          Logger.log('logEmailFollowUp_: threadId ' + threadId + ' already logged — skipping duplicate.');
          return;
        }
      }
    }

    var today = new Date().toISOString().substring(0, 10);
    sheet.appendRow([
      threadId,
      message.getSubject(),
      message.getFrom(),
      today,
      'Waiting'
    ]);
    Logger.log('logEmailFollowUp_: logged follow-up for thread ' + threadId);

  } catch (e) {
    Logger.log('logEmailFollowUp_ error: ' + e.message);
  }
}

// ============================================================
// NIGHTLY FOLLOW-UP CHECKER
// ============================================================

/**
 * checkEmailFollowUps_()
 *
 * Called from nightlyRun(). Iterates the Email Follow-ups sheet and:
 *  - Creates a Medium flag if a follow-up has been waiting > 5 days
 *  - Marks Status as 'Received' if the thread has received a new reply
 */
function checkEmailFollowUps_() {
  try {
    var sheet = getSpreadsheet().getSheetByName(TABS.EMAIL_FOLLOW_UPS);
    if (!sheet || sheet.getLastRow() <= 1) {
      Logger.log('checkEmailFollowUps_: no follow-up rows to check.');
      return;
    }

    var data    = sheet.getDataRange().getValues();
    var headers = data[0];

    // Column indices (based on EMAIL_FOLLOW_UP_HEADERS order)
    var colThreadId   = headers.indexOf('Thread ID');
    var colSubject    = headers.indexOf('Subject');
    var colSender     = headers.indexOf('Sender');
    var colFlagged    = headers.indexOf('Date Flagged');
    var colStatus     = headers.indexOf('Status');

    var today = new Date();

    for (var i = 1; i < data.length; i++) {
      var row      = data[i];
      var status   = row[colStatus];
      if (status !== 'Waiting') continue;

      var threadId    = row[colThreadId];
      var subject     = row[colSubject];
      var sender      = row[colSender];
      var flaggedDate = new Date(row[colFlagged]);
      var days        = Math.floor((today.getTime() - flaggedDate.getTime()) / (1000 * 60 * 60 * 24));

      // Check if a reply has arrived (thread has more than 1 message)
      try {
        var gmThread = GmailApp.getThreadById(threadId);
        if (gmThread && gmThread.getMessageCount() > 1) {
          // Mark as Received in sheet
          sheet.getRange(i + 1, colStatus + 1).setValue('Received');
          Logger.log('checkEmailFollowUps_: thread ' + threadId + ' marked Received.');
          continue;
        }
      } catch (thrErr) {
        Logger.log('checkEmailFollowUps_: could not fetch thread ' + threadId + ': ' + thrErr.message);
      }

      // Flag if stale > 5 days
      if (days > 5) {
        var flagMsg = 'Follow-up: ' + subject + ' — no response from ' + sender + ' in ' + days + ' days';
        var flagKey = 'followup_' + threadId;
        addFlag_('Email Admin', flagMsg, 'Medium', flagKey);
        Logger.log('checkEmailFollowUps_: stale flag added for thread ' + threadId);
      }
    }

    Logger.log('checkEmailFollowUps_: done.');

  } catch (e) {
    Logger.log('checkEmailFollowUps_ error: ' + e.message);
  }
}
