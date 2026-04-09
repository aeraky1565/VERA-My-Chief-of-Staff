// ============================================================
// Slack.js — Issue #143
// Real-time bidirectional chat + notifications via Slack.
// Replaces Telegram entirely.
//
// Channels:
//   #vera-chat          — bidirectional, Ahmed + Victoria
//   #vera-notifications — one-way outbound (nudges, flags, alerts)
//   #vera-logs          — nightly run summaries, errors
//
// Architecture:
//   Slack Events API POSTs to doPost() instantly.
//   Chat messages are queued in CacheService and processed
//   async (same pattern as Telegram) to beat the 3-second
//   Slack acknowledgement deadline.
// ============================================================

var SLACK_API = 'https://slack.com/api/';

// ─── CREDENTIALS ─────────────────────────────────────────────────────────────

function getSlackToken_() {
  return PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '';
}

function isSlackConfigured_() {
  return !!getSlackToken_();
}

function getSlackChannelId_(name) {
  var map = {
    chat:          'SLACK_CHAT_CHANNEL_ID',
    notifications: 'SLACK_NOTIFICATIONS_CHANNEL_ID',
    logs:          'SLACK_LOGS_CHANNEL_ID',
  };
  return PropertiesService.getScriptProperties().getProperty(map[name] || name) || '';
}

function getSlackAllowedUserIds_() {
  var raw = PropertiesService.getScriptProperties().getProperty('SLACK_ALLOWED_USER_IDS') || '';
  return raw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

function getSlackUserName_(userId) {
  var props = PropertiesService.getScriptProperties();
  if (userId === props.getProperty('SLACK_AHMED_USER_ID'))    return 'Ahmed';
  if (userId === props.getProperty('SLACK_VICTORIA_USER_ID')) return 'Victoria';
  return null;
}

function getSlackAhmedUserId_() {
  return PropertiesService.getScriptProperties().getProperty('SLACK_AHMED_USER_ID') || '';
}

// ─── SEND ─────────────────────────────────────────────────────────────────────

/**
 * Sends a message to a Slack channel.
 * @param {string}  channelId  Channel ID (C...)
 * @param {string}  text       Fallback plain text (shown in notifications)
 * @param {Array}   [blocks]   Optional Block Kit blocks array
 * @param {string}  [threadTs] Optional thread timestamp to reply in thread
 * @returns {Object} Slack API response
 */
function sendSlackMessage_(channelId, text, blocks, threadTs) {
  var token = getSlackToken_();
  if (!token || !channelId) return { ok: false, error: 'not_configured' };

  var payload = { channel: channelId, text: String(text || '').substring(0, 3000) };
  if (blocks)   payload.blocks    = blocks;
  if (threadTs) payload.thread_ts = threadTs;

  try {
    var resp   = UrlFetchApp.fetch(SLACK_API + 'chat.postMessage', {
      method:          'post',
      contentType:     'application/json; charset=utf-8',
      headers:         { Authorization: 'Bearer ' + token },
      payload:         JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    var result = JSON.parse(resp.getContentText());
    if (!result.ok) Logger.log('Slack sendMessage error: ' + result.error + ' | channel: ' + channelId);
    return result;
  } catch (err) {
    Logger.log('Slack sendMessage exception: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Responds to a slash command or interaction via response_url.
 * @param {string} responseUrl
 * @param {string} text
 * @param {Array}  [blocks]
 * @param {boolean} [ephemeral] true = only visible to the user
 */
/**
 * Responds to a Block Kit button interaction via response_url.
 * Uses replace_original:true so the action buttons are replaced with the
 * confirmation text (the correct pattern for interactive components).
 * Note: response_type:'ephemeral' is only valid for slash commands, NOT
 * for button interaction callbacks — using it here causes Slack to ignore
 * the response entirely, which is why button feedback was missing.
 */
function sendSlackResponse_(responseUrl, text, blocks, replaceOriginal) {
  if (!responseUrl) return;
  var payload = {
    replace_original: replaceOriginal !== false, // default true
    text:             String(text || ''),
  };
  if (blocks) payload.blocks = blocks;
  try {
    UrlFetchApp.fetch(responseUrl, {
      method:      'post',
      contentType: 'application/json; charset=utf-8',
      payload:     JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (err) {
    Logger.log('Slack sendResponse_ exception: ' + err.message);
  }
}

/**
 * Publishes the App Home view for a user.
 */
function updateAppHome_(userId) {
  var token = getSlackToken_();
  if (!token || !userId) return;
  var view = buildAppHome_(userId);
  try {
    UrlFetchApp.fetch(SLACK_API + 'views.publish', {
      method:      'post',
      contentType: 'application/json; charset=utf-8',
      headers:     { Authorization: 'Bearer ' + token },
      payload:     JSON.stringify({ user_id: userId, view: view }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    Logger.log('Slack updateAppHome_ exception: ' + err.message);
  }
}

// ─── NOTIFICATION HELPERS ─────────────────────────────────────────────────────

/**
 * Routes a nudge/alert to #vera-notifications.
 * For High urgency: prepends an @mention of Ahmed.
 * @param {string} text      Plain text fallback
 * @param {Array}  [blocks]  Optional Block Kit blocks
 * @param {string} [urgency] 'High' | 'Medium' | 'Low' | undefined
 */
function sendSlackNotification_(text, blocks, urgency) {
  var channelId = getSlackChannelId_('notifications');
  if (!channelId) return;

  var finalText = text;
  if (urgency === 'High') {
    var ahmedId = getSlackAhmedUserId_();
    if (ahmedId) finalText = '<@' + ahmedId + '> ' + text;
  }
  sendSlackMessage_(channelId, finalText, blocks);
}

/**
 * Posts a message to #vera-logs.
 */
function sendSlackLog_(text) {
  var channelId = getSlackChannelId_('logs');
  if (channelId) sendSlackMessage_(channelId, text);
}

// ─── BLOCK KIT BUILDERS ──────────────────────────────────────────────────────

/**
 * Builds a Block Kit section for a single flag with Acknowledge + Snooze buttons.
 */
function buildFlagBlocks_(flag) {
  var urgencyEmoji = flag.urgency === 'High' ? ':red_circle:' :
                     flag.urgency === 'Medium' ? ':large_yellow_circle:' : ':large_green_circle:';
  var text = urgencyEmoji + ' *' + (flag.flag || 'Flag') + '*';
  if (flag.reason) text += '\n_' + String(flag.reason).substring(0, 200) + '_';

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: text },
    },
    {
      type: 'actions',
      elements: [
        {
          type:      'button',
          text:      { type: 'plain_text', text: 'Acknowledge' },
          action_id: 'acknowledge_flag',
          value:     String(flag.id || flag.key || ''),
        },
        {
          type:      'button',
          text:      { type: 'plain_text', text: 'Snooze 3 days' },
          action_id: 'snooze_flag',
          value:     String(flag.id || flag.key || ''),
        },
      ],
    },
    { type: 'divider' },
  ];
}

/**
 * Builds the full morning nudge Block Kit payload.
 * @param {Array}  flags        Active flags array
 * @param {string} capacityMode 'busy' | 'normal' | 'light'
 * @param {number} heldCount    Number of flags held from yesterday
 */
function buildMorningNudgeBlocks_(flags, capacityMode, heldCount) {
  var blocks = [];

  // Header
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEEE, MMMM d');
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: 'VERA Morning Briefing — ' + dateStr },
  });

  // Capacity ticker
  var capacityText = capacityMode === 'busy'   ? ':red_circle: Busy day — High-priority + time-sensitive only' :
                     capacityMode === 'light'  ? ':large_green_circle: Light day — surfacing all flags' :
                                                 ':large_yellow_circle: Normal day — High + Medium flags';
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: capacityText }],
  });

  // Held from yesterday ticker
  if (heldCount > 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: ':clipboard: ' + heldCount + ' flag' + (heldCount !== 1 ? 's' : '') + ' held from yesterday — shown today' }],
    });
  }

  blocks.push({ type: 'divider' });

  if (!flags || flags.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: ':white_check_mark: No active flags. Clean slate!' },
    });
    return blocks;
  }

  // Flags grouped by urgency
  ['High', 'Medium', 'Low'].forEach(function(urgency) {
    var group = flags.filter(function(f) { return f.urgency === urgency; });
    if (!group.length) return;
    group.forEach(function(flag) {
      buildFlagBlocks_(flag).forEach(function(b) { blocks.push(b); });
    });
  });

  return blocks;
}

/**
 * Builds the evening check-in Block Kit message with Yes / No buttons.
 */
function buildEveningCheckinBlocks_() {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: ':person_in_lotus_position: *Evening check-in* — did you get movement in today?\nReply here or tap a button to log it.' },
    },
    {
      type: 'actions',
      elements: [
        {
          type:      'button',
          text:      { type: 'plain_text', text: '✅ Yes' },
          style:     'primary',
          action_id: 'evening_checkin_yes',
          value:     'yes',
        },
        {
          type:      'button',
          text:      { type: 'plain_text', text: '🚶 I walked instead' },
          action_id: 'evening_checkin_walk',
          value:     'walk',
        },
        {
          type:      'button',
          text:      { type: 'plain_text', text: '❌ No — skipped' },
          style:     'danger',
          action_id: 'evening_checkin_no',
          value:     'no',
        },
      ],
    },
  ];
}

/**
 * Builds the dynamic App Home view for a given user.
 */
function buildAppHome_(userId) {
  var userName = getSlackUserName_(userId) || 'Ahmed';
  var blocks   = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: 'VERA — ' + userName + '\'s Dashboard' },
  });
  blocks.push({ type: 'divider' });

  // Try to load live data
  try {
    var flags = getActiveFlags_();
    var high   = flags.filter(function(f) { return f.urgency === 'High'; }).length;
    var medium = flags.filter(function(f) { return f.urgency === 'Medium'; }).length;
    var low    = flags.filter(function(f) { return f.urgency === 'Low'; }).length;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Active Flags*\n:red_circle: ' + high + ' High  :large_yellow_circle: ' + medium + ' Medium  :large_green_circle: ' + low + ' Low' },
    });
  } catch (e) { /* non-fatal */ }

  try {
    var tasks    = getOpenTasks();
    var overdue  = tasks.filter(function(t) { return t.isOverdue; }).length;
    var taskText = tasks.length + ' open task' + (tasks.length !== 1 ? 's' : '');
    if (overdue > 0) taskText += '  :warning: ' + overdue + ' overdue';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Tasks*\n' + taskText },
    });
  } catch (e) { /* non-fatal */ }

  try {
    var pto = getPTOStats_(userName);
    if (pto && pto.remaining) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '*PTO*\n:palm_tree: ' + (pto.remaining.vacationDays || '—') + ' vacation days remaining' },
      });
    }
  } catch (e) { /* non-fatal */ }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Chat with VERA in *#vera-chat* · Use */flags*, */tasks*, */pto* for quick lookups' }],
  });

  return {
    type:   'home',
    blocks: blocks,
  };
}

// ─── INCOMING EVENT ROUTING ──────────────────────────────────────────────────

/**
 * Entry point for Slack Events API JSON payloads.
 * Called from doPost() when body.type === 'event_callback'.
 * Returns 200 immediately; chat messages are queued for async processing.
 */
function handleSlackEvent_(body) {
  var event = body && body.event;
  if (!event) return ContentService.createTextOutput('ok');

  // Ignore messages from VERA itself (bot_id present = bot message)
  if (event.bot_id || event.subtype === 'bot_message') {
    return ContentService.createTextOutput('ok');
  }

  if (event.type === 'message' && event.channel === getSlackChannelId_('chat')) {
    // File upload (image for Smart Scheduler) or regular chat — both queued async
    queueSlackMessage_(event);
    // Issue #158: Log chat session to #vera-logs with user identity
    try {
      var slackUserId = event.user;
      var userName    = (slackUserId && getSlackUserName_(slackUserId)) || slackUserId || 'unknown';
      sendSlackLog_('\ud83d\udcac Chat \u2014 vera-chat (' + userName + ')');
    } catch (logErr) { /* non-fatal */ }
  }

  if (event.type === 'reaction_added' && event.item && event.item.channel === getSlackChannelId_('notifications')) {
    handleSlackReaction_(event);
  }

  if (event.type === 'app_home_opened') {
    try { updateAppHome_(event.user); } catch (e) { /* non-fatal */ }
  }

  return ContentService.createTextOutput('ok');
}

/**
 * Entry point for form-encoded Slack payloads (interactions + slash commands).
 * Called from doPost() when the POST body appears to be form-encoded.
 *
 * GAS does NOT reliably decode form-encoded POST bodies into e.parameter —
 * that only works for query strings. We parse e.postData.contents manually
 * as a fallback, with e.parameter as the primary attempt.
 */
function handleSlackFormPost_(e) {
  // ── Resolve the payload string ────────────────────────────────────────────
  // Try e.parameter first (works when GAS does decode the body), then fall
  // back to manually URL-decoding the raw POST body.
  var payloadStr  = (e.parameter && e.parameter.payload)  || '';
  var commandStr  = (e.parameter && e.parameter.command)  || '';

  if (!payloadStr && !commandStr && e.postData && e.postData.contents) {
    // Manually parse "key=value&key2=value2" from the raw body
    var parts = e.postData.contents.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv  = parts[i].split('=');
      var key = decodeURIComponent(kv[0] || '');
      var val = decodeURIComponent((kv.slice(1).join('=')) || '');
      if (key === 'payload') { payloadStr = val; }
      if (key === 'command') { commandStr = val; }
    }
  }

  Logger.log('handleSlackFormPost_: payloadStr length=' + payloadStr.length + ' command=' + commandStr);

  // ── Interactive components (button clicks) ────────────────────────────────
  if (payloadStr) {
    try {
      var payload = JSON.parse(payloadStr);
      handleSlackInteraction_(payload);
    } catch (err) {
      Logger.log('Slack interaction parse error: ' + err.message + ' | raw=' + payloadStr.substring(0, 200));
    }
    return ContentService.createTextOutput('');
  }

  // ── Slash commands ────────────────────────────────────────────────────────
  if (commandStr) {
    // Rebuild a parameter map from the decoded body if e.parameter is incomplete
    var params = e.parameter || {};
    if (!params.command) params.command = commandStr;
    return handleSlashCommand_(params);
  }

  Logger.log('handleSlackFormPost_: no payload or command found in body');
  return ContentService.createTextOutput('ok');
}

// ─── ASYNC CHAT QUEUE ────────────────────────────────────────────────────────

/**
 * Queues a Slack message event in CacheService and fires a one-shot trigger
 * to process it. This lets doPost() return 200 in <1s while Claude runs async.
 */
function queueSlackMessage_(event) {
  try {
    var sc  = CacheService.getScriptCache();
    var qId = 'SLK_' + (event.ts || Date.now()).replace('.', '_');
    sc.put(qId, JSON.stringify(event), 180);
    var existing = sc.get('SLK_Q_IDS') || '';
    sc.put('SLK_Q_IDS', existing ? existing + ',' + qId : qId, 180);

    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === 'processSlackQueue_') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('processSlackQueue_').timeBased().after(200).create();
  } catch (err) {
    Logger.log('queueSlackMessage_ error: ' + err.message);
    // Fallback: process synchronously
    try { processSlackMessage_(event); } catch (e2) { Logger.log('Sync fallback error: ' + e2.message); }
  }
}

/**
 * Processes all queued Slack messages. Called by the one-shot trigger.
 */
function processSlackQueue_() {
  var sc  = CacheService.getScriptCache();
  var ids = sc.get('SLK_Q_IDS');
  if (!ids) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('processSlackQueue_: could not acquire lock');
    return;
  }

  try {
    sc.remove('SLK_Q_IDS');
    ids.split(',').forEach(function(qId) {
      var json = sc.get(qId);
      if (!json) return;
      sc.remove(qId);
      try {
        processSlackMessage_(JSON.parse(json));
      } catch (err) {
        Logger.log('processSlackQueue_ error for ' + qId + ': ' + err.message);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Processes a single chat message from #vera-chat.
 * Identifies the user, calls the VERA chat pipeline, replies in channel.
 */
function processSlackMessage_(event) {
  var userId  = event.user;
  var text    = (event.text || '').trim();
  var channel = event.channel;

  // Check allowlist
  var allowed = getSlackAllowedUserIds_();
  if (allowed.length && allowed.indexOf(userId) === -1) {
    Logger.log('Slack: blocked user ' + userId);
    return;
  }

  // ── File upload — route by type ──────────────────────────────────────────
  if (event.files && event.files.length > 0) {
    var fileType = (event.files[0].mimetype || '').split('/')[0];
    if (fileType === 'audio') {
      processSlackVoiceMessage_(event);
    } else {
      processSlackSchedulerPhoto_(event);
    }
    return;
  }

  if (!text) return;

  // ── Pending scheduler confirmation (user replied "1", "2", "skip") ──────
  var cache      = CacheService.getScriptCache();
  var pendingKey = SCHEDULER_PENDING_KEY_PREFIX + userId;
  if (cache.get(pendingKey)) {
    var schedulerReply = handleSchedulerReply_(text, userId);
    sendSlackMessage_(channel, schedulerReply);
    return;
  }

  var userName = getSlackUserName_(userId) || 'Ahmed';

  // ── Regular chat → Claude ────────────────────────────────────────────────
  var thinkingResult = sendSlackMessage_(channel, 'Thinking\u2026');
  var thinkingTs     = thinkingResult && thinkingResult.ts;

  try {
    var sessionKey = 'slack_' + userId;
    var result     = processChat_(text, sessionKey);
    var reply      = (result && result.reply) ? result.reply : 'Sorry, something went wrong.';

    if (thinkingTs) deleteSlackMessage_(channel, thinkingTs);
    sendSlackMessage_(channel, reply);
  } catch (err) {
    Logger.log('processSlackMessage_ error: ' + err.message);
    if (thinkingTs) deleteSlackMessage_(channel, thinkingTs);
    sendSlackMessage_(channel, 'Sorry, something went wrong: ' + err.message);
  }
}

/**
 * Deletes a Slack message (used to remove the "Thinking..." placeholder).
 */
function deleteSlackMessage_(channelId, ts) {
  try {
    UrlFetchApp.fetch(SLACK_API + 'chat.delete', {
      method:      'post',
      contentType: 'application/json; charset=utf-8',
      headers:     { Authorization: 'Bearer ' + getSlackToken_() },
      payload:     JSON.stringify({ channel: channelId, ts: ts }),
      muteHttpExceptions: true,
    });
  } catch (e) { /* non-fatal */ }
}

// ─── REACTION HANDLING ───────────────────────────────────────────────────────

/**
 * Handles emoji reactions on #vera-notifications messages.
 * ✅ = acknowledge flag, 💤 = snooze 3 days, 🔕 = resolve flag.
 */
function handleSlackReaction_(event) {
  var reaction = event.reaction;
  var msgTs    = event.item && event.item.ts;
  if (!msgTs) return;

  // Look up which flag this message corresponds to
  var sc     = CacheService.getScriptCache();
  var flagId = sc.get('SLK_MSG_FLAG_' + msgTs);
  if (!flagId) return;

  try {
    if (reaction === 'white_check_mark') {
      webAcknowledge_(flagId);
      Logger.log('Slack reaction: acknowledged flag ' + flagId);
    } else if (reaction === 'zzz') {
      webSnooze_(flagId, 3);
      Logger.log('Slack reaction: snoozed flag ' + flagId);
    } else if (reaction === 'no_bell') {
      webResolve_(flagId);
      Logger.log('Slack reaction: resolved flag ' + flagId);
    }
  } catch (err) {
    Logger.log('handleSlackReaction_ error: ' + err.message);
  }
}

// ─── INTERACTION HANDLING ────────────────────────────────────────────────────

/**
 * Handles Block Kit button clicks.
 */
function handleSlackInteraction_(payload) {
  if (!payload || !payload.actions || !payload.actions.length) return;

  var action      = payload.actions[0];
  var actionId    = action.action_id;
  var value       = action.value;
  var responseUrl = payload.response_url;
  var userId      = payload.user && payload.user.id;

  // ── Send the visual response to Slack FIRST (3-second deadline) ─────────
  // Any sheet reads/writes happen AFTER the ack so Slack never times out.
  var ackText = '';
  if      (actionId === 'acknowledge_flag')    ackText = ':white_check_mark: Flag acknowledged.';
  else if (actionId === 'snooze_flag')         ackText = ':zzz: Snoozed for 3 days.';
  else if (actionId === 'evening_checkin_yes') ackText = ':white_check_mark: Got it — logged! What did you do? _(Reply in #vera-chat)_';
  else if (actionId === 'evening_checkin_walk')ackText = ':walking: Walking counts! Logged as movement for today.';
  else if (actionId === 'evening_checkin_no')  ackText = ':ok_hand: No worries — logged as skipped.';
  else if (actionId === 'mark_bill_paid')      ackText = ':white_check_mark: Bill marked as paid.';

  if (ackText) sendSlackResponse_(responseUrl, ackText, null, true);

  // ── Heavy work (sheet reads/writes) AFTER the ack ────────────────────────
  try {
    if (actionId === 'acknowledge_flag') {
      webAcknowledge_(value);

    } else if (actionId === 'snooze_flag') {
      webSnooze_(value, 3);

    } else if (actionId === 'evening_checkin_yes') {
      try { webGymAttendLatest_('Yes'); } catch (gErr) { Logger.log('evening_checkin_yes gym log error: ' + gErr.message); }
      var chatChannel = getSlackChannelId_('chat');
      var userName    = getSlackUserName_(userId) || 'Ahmed';
      sendSlackMessage_(chatChannel, ':muscle: Nice work, ' + userName + '! What did you do? _(e.g. 30 min run, yoga, weights)_');
      var logsChannel = getSlackChannelId_('logs');
      if (logsChannel) sendSlackMessage_(logsChannel, ':person_in_lotus_position: Evening check-in — ' + userName + ' *got movement* (logged as attended)');

    } else if (actionId === 'evening_checkin_walk') {
      try { webGymAttendLatest_('Yes'); } catch (gErr) { Logger.log('evening_checkin_walk gym log error: ' + gErr.message); }
      var logsChannel = getSlackChannelId_('logs');
      var userName    = getSlackUserName_(userId) || 'Ahmed';
      if (logsChannel) sendSlackMessage_(logsChannel, ':person_in_lotus_position: Evening check-in — ' + userName + ' *walked* (logged as attended)');

    } else if (actionId === 'evening_checkin_no') {
      try { webGymAttendLatest_('No'); } catch (gErr) { Logger.log('evening_checkin_no gym log error: ' + gErr.message); }
      var logsChannel = getSlackChannelId_('logs');
      var userName    = getSlackUserName_(userId) || 'Ahmed';
      if (logsChannel) sendSlackMessage_(logsChannel, ':person_in_lotus_position: Evening check-in — ' + userName + ' *skipped* movement today');

    } else if (actionId === 'mark_bill_paid') {
      webMarkBillPaid_(value);
    }
  } catch (err) {
    Logger.log('handleSlackInteraction_ error: ' + err.message);
    // Response was already sent above; just log the error
  }
}

// ─── SLASH COMMANDS ──────────────────────────────────────────────────────────

/**
 * Handles Slack slash commands. Returns a TextOutput response.
 */
function handleSlashCommand_(params) {
  var command     = params.command;
  var responseUrl = params.response_url;
  var userId      = params.user_id;

  // Check allowlist
  var allowed = getSlackAllowedUserIds_();
  if (allowed.length && allowed.indexOf(userId) === -1) {
    return ContentService.createTextOutput(JSON.stringify({
      response_type: 'ephemeral',
      text: 'You are not authorised to use VERA.',
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var replyText = '';

    if (command === '/flags') {
      var flags  = getActiveFlags_();
      var active = flags.filter(function(f) { return !f.resolved && !f.acknowledged; });
      if (!active.length) {
        replyText = ':white_check_mark: No active flags.';
      } else {
        var high = active.filter(function(f) { return f.urgency === 'High'; });
        var med  = active.filter(function(f) { return f.urgency === 'Medium'; });
        var low  = active.filter(function(f) { return f.urgency === 'Low'; });
        replyText = ':triangular_flag_on_post: *Active Flags*\n';
        if (high.length) replyText += ':red_circle: ' + high.length + ' High\n';
        if (med.length)  replyText += ':large_yellow_circle: ' + med.length + ' Medium\n';
        if (low.length)  replyText += ':large_green_circle: ' + low.length + ' Low\n';
        replyText += '\nTop: ' + (active[0].flag || '');
      }

    } else if (command === '/tasks') {
      var tasks   = getOpenTasks();
      var overdue = tasks.filter(function(t) { return t.isOverdue; });
      replyText = ':pencil: *Tasks*\n' + tasks.length + ' open' +
                  (overdue.length ? '  :warning: ' + overdue.length + ' overdue' : '') +
                  (tasks[0] ? '\nNext: ' + tasks[0].task : '');

    } else if (command === '/pto') {
      try {
        var ptoData = getPTODataForSlack_();
        replyText = ':palm_tree: *PTO*\n' + ptoData;
      } catch (e) {
        replyText = ':palm_tree: PTO data not available — try refreshing.';
      }

    } else if (command === '/status') {
      replyText = ':robot_face: *VERA Status*\n' +
                  'Last nightly run: ' + (PropertiesService.getScriptProperties().getProperty('LAST_NIGHTLY_RUN') || 'unknown') + '\n' +
                  'Active flags: ' + getActiveFlags_().filter(function(f) { return !f.resolved; }).length;

    } else if (command === '/busy') {
      var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      PropertiesService.getScriptProperties().setProperties({
        capacity_override_mode: 'busy',
        capacity_override_date: today,
      });
      replyText = ':red_circle: Busy day mode set — VERA will surface High-priority + time-sensitive only.';

    } else if (command === '/light') {
      var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      PropertiesService.getScriptProperties().setProperties({
        capacity_override_mode: 'light',
        capacity_override_date: today,
      });
      replyText = ':large_green_circle: Light day mode set — VERA will surface all flags.';

    } else {
      replyText = 'Unknown command. Available: /flags /tasks /pto /status /busy /light';
    }

    // Respond via response_url for deferred response
    if (responseUrl) {
      sendSlackResponse_(responseUrl, replyText, null, true);
      return ContentService.createTextOutput('');
    }

    return ContentService.createTextOutput(JSON.stringify({
      response_type: 'ephemeral',
      text:          replyText,
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('handleSlashCommand_ error: ' + err.message);
    return ContentService.createTextOutput(JSON.stringify({
      response_type: 'ephemeral',
      text:          'Error: ' + err.message,
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── PTO HELPER FOR SLASH COMMAND ────────────────────────────────────────────

function getPTODataForSlack_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.PTO);
  if (!sheet) return 'PTO sheet not found.';
  var data = sheet.getDataRange().getValues();
  // Find Ahmed and Victoria remaining vacation days
  var lines = [];
  data.forEach(function(row) {
    if (row[0] && row[1] !== undefined) {
      lines.push(row[0] + ': ' + row[1] + ' days remaining');
    }
  });
  return lines.slice(0, 4).join('\n') || 'No PTO data found.';
}

// ─── MORNING NUDGE VIA SLACK ─────────────────────────────────────────────────

/**
 * Posts the morning nudge to #vera-notifications as Block Kit embeds.
 * Called from morningNudge() in Code.js when Slack is configured.
 * @param {Array}  flags        Active flags to surface
 * @param {string} capacityMode 'busy' | 'normal' | 'light'
 * @param {number} heldCount    Flags held from yesterday
 */
function sendMorningNudgeSlack_(flags, capacityMode, heldCount) {
  var channelId = getSlackChannelId_('notifications');
  if (!channelId) return;

  var blocks = buildMorningNudgeBlocks_(flags, capacityMode, heldCount);
  var result = sendSlackMessage_(channelId, 'VERA Morning Briefing', blocks);

  // Cache msg ts → flag id mapping for reaction handling
  if (result && result.ok && result.ts) {
    var sc = CacheService.getScriptCache();
    // Store ts for each flag so reactions can look up flag IDs
    // (For morning nudge, store a generic key)
    sc.put('SLK_MORNING_TS', result.ts, 86400);
  }

  // Pin the morning nudge; unpin yesterday's
  pinSlackMessage_(channelId, result && result.ts);
}

/**
 * Pins a message and unpins the previous morning nudge.
 */
function pinSlackMessage_(channelId, ts) {
  if (!ts || !channelId) return;
  var token = getSlackToken_();
  try {
    // Unpin previous
    var prevTs = PropertiesService.getScriptProperties().getProperty('SLACK_PINNED_MORNING_TS');
    if (prevTs) {
      UrlFetchApp.fetch(SLACK_API + 'pins.remove', {
        method:      'post',
        contentType: 'application/json; charset=utf-8',
        headers:     { Authorization: 'Bearer ' + token },
        payload:     JSON.stringify({ channel: channelId, timestamp: prevTs }),
        muteHttpExceptions: true,
      });
    }
    // Pin new
    UrlFetchApp.fetch(SLACK_API + 'pins.add', {
      method:      'post',
      contentType: 'application/json; charset=utf-8',
      headers:     { Authorization: 'Bearer ' + token },
      payload:     JSON.stringify({ channel: channelId, timestamp: ts }),
      muteHttpExceptions: true,
    });
    PropertiesService.getScriptProperties().setProperty('SLACK_PINNED_MORNING_TS', ts);
  } catch (err) {
    Logger.log('pinSlackMessage_ error: ' + err.message);
  }
}

// ─── EVENING CHECK-IN ────────────────────────────────────────────────────────

/**
 * Posts the evening check-in to #vera-chat with Yes/No buttons.
 * Called from checkEveningMobility_() in Reminders.js.
 */
function sendEveningCheckinSlack_() {
  var channelId = getSlackChannelId_('chat');
  if (!channelId) return;
  var blocks = buildEveningCheckinBlocks_();
  sendSlackMessage_(channelId, 'Evening check-in', blocks);
}

// ─── VOICE MESSAGE — transcription via Slack's built-in transcript ───────────

/**
 * Handles an audio/voice message in #vera-chat.
 * Fetches Slack's built-in transcription via files.info, then routes the
 * transcribed text into the normal VERA chat pipeline.
 */
function processSlackVoiceMessage_(event) {
  var channel  = event.channel;
  var userId   = event.user;
  var file     = event.files[0];

  var thinkingResult = sendSlackMessage_(channel, '\uD83C\uDFA4 Transcribing\u2026');
  var thinkingTs     = thinkingResult && thinkingResult.ts;

  try {
    // Fetch full file info — Slack includes transcription here once ready
    var token    = getSlackToken_();
    var infoResp = UrlFetchApp.fetch(SLACK_API + 'files.info?file=' + encodeURIComponent(file.id), {
      headers:            { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    var infoData = JSON.parse(infoResp.getContentText());
    var fullFile = (infoData && infoData.ok) ? infoData.file : null;

    // Extract transcript — Slack stores it in file.transcription / file.preview / VTT
    var transcript = '';
    if (fullFile) {
      if (fullFile.preview) {
        transcript = fullFile.preview.trim();
      } else if (fullFile.vtt) {
        // Strip WEBVTT header and timestamp lines, keep only spoken text
        transcript = fullFile.vtt
          .replace(/WEBVTT[\s\S]*?\n\n/, '')
          .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\n?/g, '')
          .replace(/<[^>]+>/g, '')
          .trim();
      }
    }

    if (!transcript) {
      if (thinkingTs) deleteSlackMessage_(channel, thinkingTs);
      sendSlackMessage_(channel,
        '\uD83C\uDFA4 I received your voice message but the transcription isn\u2019t ready yet ' +
        '(Slack usually takes a few seconds). Try resending it in a moment, or just type your message.');
      return;
    }

    // Route transcribed text through normal VERA chat pipeline
    var sessionKey = 'slack_' + userId;
    var result     = processChat_(transcript, sessionKey);
    var reply      = (result && result.reply) ? result.reply : 'Sorry, something went wrong.';

    if (thinkingTs) deleteSlackMessage_(channel, thinkingTs);
    sendSlackMessage_(channel, '\uD83C\uDFA4 _\u201c' + transcript + '\u201d_\n\n' + reply);

  } catch (err) {
    Logger.log('processSlackVoiceMessage_ error: ' + err.message);
    if (thinkingTs) deleteSlackMessage_(channel, thinkingTs);
    sendSlackMessage_(channel, 'Sorry, something went wrong with your voice message: ' + err.message);
  }
}

// ─── SMART SCHEDULER — Slack image intake ────────────────────────────────────

/**
 * Downloads a Slack private file URL using the bot token.
 * Requires files:read scope.
 * @param  {string} url  url_private_download from the Slack files object
 * @returns {Byte[]|null}
 */
function downloadSlackFile_(url) {
  var token = getSlackToken_();
  try {
    var resp = UrlFetchApp.fetch(url, {
      headers:            { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log('downloadSlackFile_: failed (' + resp.getResponseCode() + ')');
      return null;
    }
    return resp.getContent();
  } catch (err) {
    Logger.log('downloadSlackFile_ exception: ' + err.message);
    return null;
  }
}

/**
 * Handles an image uploaded to #vera-chat.
 * Downloads → Claude vision → prompts user for calendar choice.
 * @param {Object} event  Slack message event with event.files array
 */
function processSlackSchedulerPhoto_(event) {
  var channel = event.channel;
  var userId  = event.user;
  var file    = event.files[0];

  // Only process images
  var mimeType = file.mimetype || 'image/jpeg';
  if (mimeType.indexOf('image/') !== 0) {
    sendSlackMessage_(channel, 'I can only process images for scheduling. Please send a photo or screenshot with dates.');
    return;
  }

  // Dedup — same file ID within 24h skipped
  if (file.id) {
    var props    = PropertiesService.getScriptProperties();
    var dedupKey = 'SCHED_SLACK_' + file.id;
    var lastSeen = parseInt(props.getProperty(dedupKey) || '0', 10);
    if (Date.now() - lastSeen < 86400000) {
      sendSlackMessage_(channel, '📷 This image was already processed recently. Send a new screenshot to process it again.');
      return;
    }
    props.setProperty(dedupKey, String(Date.now()));
  }

  var thinkingResult = sendSlackMessage_(channel, '📷 Analyzing image\u2026');
  var thinkingTs     = thinkingResult && thinkingResult.ts;

  try {
    var downloadUrl = file.url_private_download || file.url_private;
    var bytes       = downloadSlackFile_(downloadUrl);
    if (!bytes) {
      if (thinkingTs) deleteSlackMessage_(channel, thinkingTs);
      sendSlackMessage_(channel, 'Sorry, I couldn\'t download that image. Please try again.');
      return;
    }

    var base64 = Utilities.base64Encode(bytes);
    var events = extractEventsFromImage_(base64, mimeType);

    if (!events || events.length === 0) {
      if (thinkingTs) deleteSlackMessage_(channel, thinkingTs);
      sendSlackMessage_(channel, '🔍 I couldn\'t find any dates or events in that image. Try sending a clearer screenshot with visible dates.');
      return;
    }

    // Store pending state keyed by userId so the next reply is routed correctly
    var cache      = CacheService.getScriptCache();
    var pendingKey = SCHEDULER_PENDING_KEY_PREFIX + userId;
    cache.put(pendingKey, JSON.stringify({ events: events }), SCHEDULER_PENDING_TTL);

    var cfg  = readSchedulerConfig_();
    var cals = cfg.schedulerCalendars;

    var lines = ['📅 Found ' + events.length + ' event' + (events.length > 1 ? 's' : '') + ':\n'];
    events.forEach(function(ev, idx) {
      lines.push((idx + 1) + '. ' + ev.title + ' — ' + ev.date + (ev.allDay === false ? '' : ' (all day)'));
    });
    lines.push('\nWhich calendar?');
    cals.forEach(function(name, idx) {
      lines.push((idx + 1) + '. ' + name);
    });
    lines.push('\nReply with the number, or "skip" to cancel.');

    if (thinkingTs) deleteSlackMessage_(channel, thinkingTs);
    sendSlackMessage_(channel, lines.join('\n'));

  } catch (err) {
    Logger.log('processSlackSchedulerPhoto_ error: ' + err.message);
    if (thinkingTs) deleteSlackMessage_(channel, thinkingTs);
    sendSlackMessage_(channel, 'Sorry, something went wrong processing your image: ' + err.message);
  }
}

// ─── SETUP HELPER ────────────────────────────────────────────────────────────

/**
 * Run this once from the Apps Script editor to seed all Slack Script Properties.
 * Values are stored securely — never in code.
 */
function setupSlackProperties() {
  PropertiesService.getScriptProperties().setProperties({
    SLACK_BOT_TOKEN:                'PASTE_BOT_TOKEN_HERE',
    SLACK_SIGNING_SECRET:           'PASTE_SIGNING_SECRET_HERE',
    SLACK_CHAT_CHANNEL_ID:          'PASTE_VERA_CHAT_CHANNEL_ID',
    SLACK_NOTIFICATIONS_CHANNEL_ID: 'PASTE_VERA_NOTIFICATIONS_CHANNEL_ID',
    SLACK_LOGS_CHANNEL_ID:          'PASTE_VERA_LOGS_CHANNEL_ID',
    SLACK_AHMED_USER_ID:            'PASTE_AHMED_USER_ID',
    SLACK_VICTORIA_USER_ID:         'PASTE_VICTORIA_USER_ID',
    SLACK_ALLOWED_USER_IDS:         'PASTE_AHMED_USER_ID,PASTE_VICTORIA_USER_ID',
  });
  Logger.log('Slack Script Properties seeded. Update each value then run verifySlackSetup().');
}

/**
 * Sends a test message to each channel to verify setup.
 */
function verifySlackSetup() {
  if (!isSlackConfigured_()) {
    Logger.log('Slack not configured. Run setupSlackProperties() first.');
    return;
  }
  sendSlackMessage_(getSlackChannelId_('chat'),          ':white_check_mark: VERA connected to #vera-chat');
  sendSlackMessage_(getSlackChannelId_('notifications'), ':white_check_mark: VERA connected to #vera-notifications');
  sendSlackMessage_(getSlackChannelId_('logs'),          ':white_check_mark: VERA connected to #vera-logs');
  Logger.log('Verification messages sent. Check your Slack channels.');
}
