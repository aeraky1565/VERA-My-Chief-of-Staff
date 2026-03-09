// ============================================================
// VERA — Telegram.js
// Telegram Bot webhook handler (Phase 4)
// ============================================================
//
// HOW IT WORKS:
//   Telegram sends a POST to your Apps Script Web App URL whenever
//   someone messages your bot. doPost() in WebApp.js detects the
//   Telegram update and routes it here.
//
// SETUP (one-time, in order):
//   1. Set TELEGRAM_BOT_TOKEN in Script Properties
//      (the token from BotFather — never hardcode it)
//   2. Set VERA_WEB_APP_URL in Script Properties
//      (same exec URL you use in the dashboard)
//   3. Run setTelegramWebhook() from the Apps Script editor
//   4. Message your bot — it will reply with your chat ID
//   5. Set TELEGRAM_ALLOWED_CHAT_ID in Script Properties
//   6. Push + redeploy, then message the bot again — VERA is live
// ============================================================

var TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

// ---- Script Property helpers -----------------------------------------------

function getTelegramToken_() {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token || token.trim() === '') {
    throw new Error('TELEGRAM_BOT_TOKEN not set in Script Properties.');
  }
  return token.trim();
}

function getTelegramAllowedChatId_() {
  return (PropertiesService.getScriptProperties().getProperty('TELEGRAM_ALLOWED_CHAT_ID') || '').trim();
}

// ---- Send a Telegram message -----------------------------------------------

/**
 * Sends a message to a Telegram chat.
 * @returns {number|null} The message_id of the sent message, or null on failure.
 */
function sendTelegramMessage_(chatId, text) {
  var token    = getTelegramToken_();
  var url      = TELEGRAM_API_BASE + token + '/sendMessage';
  var safeText = String(text).substring(0, 4000); // Telegram limit: 4096 chars

  var opts = {
    method:             'post',
    contentType:        'application/json',
    payload:            JSON.stringify({ chat_id: chatId, text: safeText }),
    muteHttpExceptions: true,
  };

  var resp = UrlFetchApp.fetch(url, opts);
  if (resp.getResponseCode() !== 200) {
    Logger.log('sendTelegramMessage_ error (' + resp.getResponseCode() + '): ' +
               resp.getContentText().substring(0, 300));
    return null;
  }
  var json = JSON.parse(resp.getContentText());
  return (json && json.result) ? json.result.message_id : null;
}

// ---- Edit an existing Telegram message -------------------------------------

/**
 * Replaces the text of a previously sent message (e.g. the "⏳ Thinking..." placeholder).
 * @param {string|number} chatId     - The chat ID
 * @param {number}        messageId  - The message_id returned by sendTelegramMessage_
 * @param {string}        text       - The new text content
 */
function editTelegramMessage_(chatId, messageId, text) {
  var token    = getTelegramToken_();
  var url      = TELEGRAM_API_BASE + token + '/editMessageText';
  var safeText = String(text).substring(0, 4000);

  UrlFetchApp.fetch(url, {
    method:             'post',
    contentType:        'application/json',
    payload:            JSON.stringify({ chat_id: chatId, message_id: messageId, text: safeText }),
    muteHttpExceptions: true,
  });
}

// ---- Handle an incoming Telegram update ------------------------------------

/**
 * Called from doPost() in WebApp.js when a Telegram webhook update arrives.
 * @param {Object} update - The parsed Telegram Update object
 */
function processTelegramUpdate_(update) {
  var msg      = update.message;
  var hasText  = !!(msg && msg.text);
  var hasPhoto = !!(msg && msg.photo && msg.photo.length > 0);
  if (!hasText && !hasPhoto) return; // ignore stickers, voice, etc.

  // ---- Stale message filter: drop anything older than 5 minutes ----------
  // Telegram queues undelivered messages and replays them once the bot is live.
  // Silently discard the backlog so only fresh messages get processed.
  var msgAgeSecs = Math.floor(Date.now() / 1000) - (msg.date || 0);
  if (msgAgeSecs > 300) {
    Logger.log('Telegram: ignoring stale message (' + msgAgeSecs + 's old)');
    return;
  }

  // ---- Deduplication: Telegram retries if Apps Script is slow (>5s) -------
  // Claude calls can take 10-15s, causing duplicate deliveries. Skip repeats.
  var updateId = String(update.update_id);
  var cache    = CacheService.getScriptCache();
  if (cache.get('TG_UPD_' + updateId)) {
    Logger.log('Telegram: skipping duplicate update_id ' + updateId);
    return;
  }
  cache.put('TG_UPD_' + updateId, '1', 600); // 10-minute dedup window

  var chatId    = String(msg.chat.id);
  var text      = hasText ? msg.text.trim() : '';
  var allowedId = getTelegramAllowedChatId_();

  // ---- First-time setup: only respond to /start when not configured -------
  if (!allowedId) {
    if (hasText && msg.text.trim() === '/start') {
      sendTelegramMessage_(chatId,
        'Hi! VERA here.\n\n' +
        'To activate me:\n\n' +
        '1. Apps Script editor → Project Settings → Script Properties\n' +
        '2. Add: TELEGRAM_ALLOWED_CHAT_ID = ' + chatId + '\n' +
        '3. Push + redeploy, then message me again.'
      );
    }
    return; // silently ignore everything else when not yet configured
  }

  // ---- Security: silently block all other senders -------------------------
  if (chatId !== allowedId) {
    Logger.log('Telegram: blocked unauthorized chat_id ' + chatId);
    return;
  }

  // ---- Smart Scheduler: pending confirmation (user replying to photo extraction) ----
  if (hasText) {
    var pendingKey = SCHEDULER_PENDING_KEY_PREFIX + chatId;
    if (CacheService.getScriptCache().get(pendingKey)) {
      var schedReply = handleSchedulerReply_(msg.text.trim(), chatId);
      sendTelegramMessage_(chatId, schedReply);
      return;
    }
  }

  // ---- Smart Scheduler: incoming photo → extract events --------------------
  if (hasPhoto) {
    processSchedulerPhoto_(msg, chatId);
    return;
  }

  // ---- Built-in commands ---------------------------------------------------
  if (text === '/start' || text === '/help') {
    sendTelegramMessage_(chatId,
      'VERA is online.\n' +
      'Your chat ID: ' + chatId + '\n\n' +
      'Talk to me naturally:\n' +
      '• "What are my active flags?"\n' +
      '• "Resolve the Verizon flag"\n' +
      '• "What tasks are overdue?"\n' +
      '• "Mark the grocery task done"\n\n' +
      '📷 Send a photo or screenshot with dates and I\'ll extract events and add them to your calendar.\n\n' +
      '/status — quick flag + task count\n' +
      '/clear — reset conversation history'
    );
    return;
  }

  if (text === '/clear') {
    clearChatHistory(chatId);
    sendTelegramMessage_(chatId, 'Conversation history cleared. Fresh start.');
    return;
  }

  if (text === '/status') {
    try {
      var ctx = buildChatContext_();
      var high = ctx.flags.filter(function(f) { return f.urgency === 'High'; }).length;
      sendTelegramMessage_(chatId,
        'Active flags: ' + ctx.flags.length +
        (high > 0 ? ' (' + high + ' high urgency)' : '') + '\n' +
        'Open tasks: ' + ctx.tasks.length
      );
    } catch (e) {
      sendTelegramMessage_(chatId, 'Error fetching status: ' + e.message);
    }
    return;
  }

  // ---- Regular message — show "Thinking..." immediately, then edit with real answer ----
  // This avoids Telegram's webhook retry loop: we return 200 quickly from doPost
  // (after this function returns), and the user sees instant feedback while Claude processes.
  var thinkingId = sendTelegramMessage_(chatId, '⏳ Thinking...');
  try {
    var result = processChat_(text, chatId);
    if (thinkingId) {
      editTelegramMessage_(chatId, thinkingId, result.reply);
    } else {
      sendTelegramMessage_(chatId, result.reply); // fallback if initial send failed
    }
  } catch (e) {
    Logger.log('Telegram chat error: ' + e.message + '\n' + e.stack);
    var errMsg = 'Sorry, something went wrong: ' + e.message;
    if (thinkingId) editTelegramMessage_(chatId, thinkingId, errMsg);
    else sendTelegramMessage_(chatId, errMsg);
  }
}

// ============================================================
// ONE-TIME SETUP FUNCTIONS  (run from Apps Script editor)
// ============================================================

/**
 * Registers your Apps Script Web App URL as the Telegram webhook.
 * Run this ONCE after setting TELEGRAM_BOT_TOKEN and VERA_WEB_APP_URL
 * in Script Properties.
 */
function setTelegramWebhook() {
  var token     = getTelegramToken_();
  var webAppUrl = PropertiesService.getScriptProperties().getProperty('VERA_WEB_APP_URL');

  if (!webAppUrl || webAppUrl.trim() === '') {
    throw new Error(
      'VERA_WEB_APP_URL not set in Script Properties.\n' +
      'Set it to your Apps Script Web App exec URL (same URL you paste into the dashboard).'
    );
  }

  var url  = TELEGRAM_API_BASE + token + '/setWebhook';
  var opts = {
    method:             'post',
    contentType:        'application/json',
    payload:            JSON.stringify({ url: webAppUrl.trim(), drop_pending_updates: true }),
    muteHttpExceptions: true,
  };

  var resp   = UrlFetchApp.fetch(url, opts);
  var result = resp.getContentText();
  Logger.log('setTelegramWebhook result: ' + result);

  var json = JSON.parse(result);
  if (json.ok) {
    Logger.log('Webhook set successfully to: ' + webAppUrl.trim());
  } else {
    Logger.log('ERROR: ' + json.description);
  }
}

/**
 * Checks the current webhook configuration — useful for debugging.
 */
function getTelegramWebhookInfo() {
  var token = getTelegramToken_();
  var resp  = UrlFetchApp.fetch(TELEGRAM_API_BASE + token + '/getWebhookInfo');
  Logger.log('Webhook info:\n' + resp.getContentText());
}

/**
 * Removes the webhook — useful if you want to switch to polling or debug manually.
 */
function deleteTelegramWebhook() {
  var token = getTelegramToken_();
  var resp  = UrlFetchApp.fetch(TELEGRAM_API_BASE + token + '/deleteWebhook');
  Logger.log('deleteWebhook: ' + resp.getContentText());
}
