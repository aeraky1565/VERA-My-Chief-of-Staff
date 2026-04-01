// ============================================================
// VERA — Reminders.js
// Anticipator (rule-based hourly nudges) + Explorer (daily AI discovery)
// ============================================================
//
// DELIVERY:
//   sendNudge_() tries Telegram first (if TELEGRAM_ALLOWED_CHAT_ID is set),
//   falls back to email (CONFIG.MORNING_NUDGE_EMAIL) if not.
//   Switch channels by setting TELEGRAM_ALLOWED_CHAT_ID in Script Properties.
//
// STATE:
//   Every sent reminder is logged to the 'Reminders Memory' sheet tab.
//   wasRecentlySent_(key, mins) reads this tab to enforce cooldowns,
//   preventing repeated nudges within the cooldown window.
//
// SETUP:
//   1. Run addRemindersMemoryTab() once to create the sheet tab
//      (or run setupVERA() / createSheetTabs() if starting fresh).
//   2. Run setupTriggers() to install the hourly trigger.
//   3. Optionally seed Config tab with any of these keys:
//
//   Config key              | Default | Description
//   ------------------------|---------|------------------------------
//   reminders_enabled       | true    | Master switch for Anticipator
//   explorer_enabled        | true    | Master switch for Explorer
//   explorer_interests      | (see default below) | Interests injected into Explorer prompt
//   ergonomic_interval_min  | 60      | Ergonomic break target interval
//   hydration_interval_min  | 120     | Hydration reminder interval
//   mobility_reminder_hour  | 20      | 24h hour for evening mobility nudge
// ============================================================

// ============================================================
// HOURLY TRIGGER ENTRY POINT
// ============================================================

/**
 * Called every hour by a time-based trigger (installed by setupTriggers()).
 * Evaluates all Anticipator rules and sends nudges when eligible.
 * Exits early outside active windows — guard logic lives here since
 * Apps Script everyHours() doesn't support conditional hour ranges.
 */
function hourlyCheck() {
  try {
    var cfg = getConfigValues();
    if (String(cfg['reminders_enabled'] || 'true').toLowerCase() === 'false') {
      Logger.log('hourlyCheck: reminders_enabled=false, skipping.');
      return;
    }

    var now       = new Date();
    var hour      = now.getHours();
    var day       = now.getDay(); // 0=Sun, 1-5=Mon-Fri, 6=Sat
    var isWeekday = day >= 1 && day <= 5;

    Logger.log('hourlyCheck: hour=' + hour + ', isWeekday=' + isWeekday);
    runAnticipatorRules_(now, hour, isWeekday, cfg);

    // Weekend Planner — fires Monday ~8am, once per week
    if (day === 1 && hour === Number(cfg['weekend_planner_hour'] || 8)) {
      try {
        runWeekendPlanner_();
      } catch (wpErr) {
        Logger.log('runWeekendPlanner_ error (non-fatal): ' + wpErr.message);
      }
    }

  } catch (e) {
    Logger.log('hourlyCheck error: ' + e.message + '\n' + e.stack);
  }
}

// ============================================================
// ANTICIPATOR — Rule engine
// ============================================================

/**
 * Evaluates all Anticipator rules in sequence.
 * Each rule is self-contained — errors in one don't block the others.
 */
function runAnticipatorRules_(now, hour, isWeekday, cfg) {
  var rules = [
    function() { checkErgonomicBreak_(hour, isWeekday, cfg); },
    function() { checkHydration_(hour, isWeekday, cfg); },
    function() { checkCalendarOpportunity_(now, hour, isWeekday, cfg); },
    function() { checkEveningMobility_(now, hour, cfg); },
    // Issue #24 — Active Intelligence Anticipators
    function() { checkBillsDue_(now, hour, cfg); },
    function() { checkTripPackingReminder_(now, hour, cfg); },
    function() { checkGoalCheckin_(now, hour, cfg); },
    function() { checkHomeServiceDue_(now, hour, cfg); },
  ];

  rules.forEach(function(rule) {
    try {
      rule();
    } catch (e) {
      Logger.log('Anticipator rule error: ' + e.message);
    }
  });
}

// ---- Rule: Ergonomic break -------------------------------------------------

/**
 * Reminds Ahmed to take an ergonomic desk break approximately every hour
 * during weekday work hours. Uses a longer cooldown when in email mode
 * to avoid inbox flooding.
 */
function checkErgonomicBreak_(hour, isWeekday, cfg) {
  if (!isWeekday) return;
  if (hour < 9 || hour >= 18) return; // Weekday 9am–6pm only

  // Slack/Telegram: every ~1h; Email: 3 per day max (~every 3h)
  var cooldown = isTelegramConfigured_() ? 55 : 180;
  if (wasRecentlySent_('ergonomic', cooldown)) return;

  sendNudge_(
    'ergonomic',
    'Desk break reminder',
    '⏰ Desk break time!\n\n' +
    'You\'ve been seated for ~60 minutes. Stand up, clasp your hands behind your head, ' +
    'open your chest — thoracic stretch for 60 seconds. Your spine will thank you. 🙏'
  );
}

// ---- Rule: Hydration -------------------------------------------------------

/**
 * Reminds Ahmed to drink water approximately every 2 hours during work hours.
 */
function checkHydration_(hour, isWeekday, cfg) {
  if (!isWeekday) return;
  if (hour < 8 || hour >= 18) return; // Weekday 8am–6pm only

  // Slack/Telegram: every ~2h; Email: 3 per day max
  var cooldown = isTelegramConfigured_() ? 110 : 180;
  if (wasRecentlySent_('hydration', cooldown)) return;

  sendNudge_(
    'hydration',
    'Hydration check',
    '💧 Hydration check!\n\n' +
    'Have you had water in the last 2 hours? Grab a glass now — ' +
    'staying ahead of thirst keeps energy and focus up.'
  );
}

// ---- Rule: Calendar opportunity window ------------------------------------

/**
 * Detects a free block of ≥90 minutes in today's calendar and — when one exists —
 * suggests using it for a high-priority or overdue task.
 * Uses a date+hour keyed rule so at most one nudge fires per opportunity window.
 */
function checkCalendarOpportunity_(now, hour, isWeekday, cfg) {
  if (!isWeekday) return;
  if (hour < 9 || hour >= 17) return; // Only fire during core hours

  var tz      = Session.getScriptTimeZone();
  var dateStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var ruleKey = 'cal_opp_' + dateStr + '_' + hour;

  // Email mode: max once per 3h slot; Telegram: once per 90min
  var cooldown = isTelegramConfigured_() ? 90 : 180;
  if (wasRecentlySent_(ruleKey, cooldown)) return;

  // Find a ≥90-minute free window starting from now
  var events      = getUpcomingEvents();
  var todayEvents = events.filter(function(e) { return e.daysUntil === 0 && !e.isAllDay; });
  var gapStart    = findNextFreeWindow_(now, todayEvents, 90);
  if (!gapStart) return; // No gap found — don't nudge

  // Suggest the most urgent open task
  var tasks       = getOpenTasks();
  var candidates  = tasks.filter(function(t) {
    return t.isOverdue || (t.daysUntilDue !== null && t.daysUntilDue <= 3);
  });
  var suggestion  = candidates.length > 0
    ? 'Good time to tackle: ' + candidates[0].task
    : 'Good time to work through your task list.';

  sendNudge_(
    ruleKey,
    'Open calendar window',
    '📅 You have a free block of ~90 min with no meetings coming up.\n\n' + suggestion
  );
}

/**
 * Scans today's timed events and finds the next contiguous free window
 * of at least minMinutes starting from now (rounded up to the next hour).
 *
 * @param {Date}   now        - Current time
 * @param {Array}  events     - Today's timed events (daysUntil === 0, not all-day)
 * @param {number} minMinutes - Minimum free window size in minutes
 * @returns {Date|null} Start of the free window, or null if none found before 6pm
 */
function findNextFreeWindow_(now, events, minMinutes) {
  // Sort events by start time
  var sorted = events.slice().sort(function(a, b) {
    return new Date(a.start) - new Date(b.start);
  });

  // Start cursor at the next full hour
  var cursor = new Date(now);
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(cursor.getHours() + 1);

  // End of work day
  var endOfDay = new Date(now);
  endOfDay.setHours(18, 0, 0, 0);

  for (var i = 0; i <= sorted.length; i++) {
    var nextEventStart = i < sorted.length ? new Date(sorted[i].start) : endOfDay;

    if (cursor >= endOfDay) break;

    var gapMinutes = (nextEventStart - cursor) / 60000;
    if (gapMinutes >= minMinutes) {
      return cursor; // Free window found
    }

    // Advance cursor past this event's end time
    if (i < sorted.length) {
      var evEnd = new Date(sorted[i].end);
      if (evEnd > cursor) cursor = evEnd;
    }
  }

  return null;
}

// ---- Rule: Evening mobility nudge -----------------------------------------

/**
 * Fires once at a configured hour (default 8pm) to ask if Ahmed got
 * movement in today. Keyed by date so it fires at most once per day.
 */
function checkEveningMobility_(now, hour, cfg) {
  var targetHour = parseInt(cfg['mobility_reminder_hour'] || '20', 10);
  if (hour !== targetHour) return;

  var tz      = Session.getScriptTimeZone();
  var dateStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var ruleKey = 'mobility_' + dateStr;

  if (wasRecentlySent_(ruleKey, 1440)) return; // Once per day

  // Evening check-in goes to #vera-chat (bidirectional) with Yes/No buttons when Slack is configured
  if (isSlackConfigured_()) {
    sendEveningCheckinSlack_();
    markSent_(ruleKey, 'evening_checkin');
    Logger.log('sendNudge_ [Slack chat]: ' + ruleKey);
  } else {
    sendNudge_(
      ruleKey,
      'Evening mobility check',
      '🧘 Evening check-in: did you get your mobility or movement session in today?\n\n' +
      'Even 10 minutes of stretching counts. Make it happen before the night winds down!'
    );
  }
}

// ---- Rule: Bills due soon (Issue #24) -------------------------------------

/**
 * Fires once daily in the morning window when an unpaid bill is due within 5 days.
 * Checks signal suppression before sending — if the user has consistently ignored
 * bill reminders, the pattern will be suppressed.
 */
function checkBillsDue_(now, hour, cfg) {
  if (hour < 8 || hour > 9) return; // Morning window only (8–9am)

  var tz        = Session.getScriptTimeZone();
  var dateStr   = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var today     = new Date(now); today.setHours(0, 0, 0, 0);
  var dayOfMonth = today.getDate();

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BILLS);
  if (!sheet || sheet.getLastRow() < 2) return;

  var currMonth    = Utilities.formatDate(now, tz, 'yyyy-MM');
  var suppressed   = [];
  try { suppressed = getSuppressedKeyPatterns_(); } catch(e) {}

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, BILL_HEADERS.length).getValues();

  data.forEach(function(row) {
    var billName = String(row[0] || '').trim();
    if (!billName) return;

    var dueDay   = row[2] !== '' ? Number(row[2]) : null;
    var amount   = row[1] !== '' ? Number(row[1]) : null;
    var paidVal  = String(row[6] || '').trim();
    var paid     = paidVal === currMonth;

    if (paid || dueDay === null) return;

    var daysUntilDue = dueDay - dayOfMonth;
    if (daysUntilDue < 0) daysUntilDue += new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    if (daysUntilDue > 5) return;

    // Build rule key and check suppression
    var ruleKey = 'bill_due_' + billName.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + dateStr;
    var pattern = 'bill_due_' + billName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (suppressed.indexOf(pattern) !== -1) {
      Logger.log('checkBillsDue_: suppressed — ' + pattern);
      return;
    }
    if (wasRecentlySent_(ruleKey, 1440)) return; // Once per day per bill

    var amtStr = amount !== null ? ' ($' + amount + ')' : '';
    var dayStr = daysUntilDue === 0 ? 'DUE TODAY' : 'due in ' + daysUntilDue + ' day' + (daysUntilDue === 1 ? '' : 's');

    sendNudge_(
      ruleKey,
      'Bill reminder: ' + billName,
      '💰 Bill reminder: ' + billName + amtStr + ' is ' + dayStr + '.\n\nMark it paid in VERA once done.'
    );
  });
}

// ---- Rule: Trip packing reminder (Issue #24) --------------------------------

/**
 * Fires once daily if an upcoming trip within 7 days has an empty packing list.
 * Suppression-aware.
 */
function checkTripPackingReminder_(now, hour, cfg) {
  if (hour < 8 || hour > 9) return; // Morning window only

  var tz      = Session.getScriptTimeZone();
  var today   = new Date(now); today.setHours(0, 0, 0, 0);
  var dateStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  var suppressed = [];
  try { suppressed = getSuppressedKeyPatterns_(); } catch(e) {}

  var travelTrips = [];
  try {
    var travelCfg = readPTOConfig_();
    travelTrips   = getUpcomingTravel_(travelCfg);
  } catch(e) {
    Logger.log('checkTripPackingReminder_: could not read trips — ' + e.message);
    return;
  }

  var ss        = getSpreadsheet();
  var packSheet = ss.getSheetByName(TABS.PACKING_ITEMS);

  travelTrips.forEach(function(trip) {
    var daysAway = trip.daysAway !== undefined ? trip.daysAway
      : (trip.startDate ? Math.round((new Date(trip.startDate) - today) / 86400000) : null);

    if (daysAway === null || daysAway > 7 || daysAway < 0) return;

    var tripKey = trip.startDate + '|' + trip.label;
    var pattern = 'packing_not_started';
    if (suppressed.indexOf(pattern) !== -1) return;

    // Count packing items for this trip
    var packCount = 0;
    if (packSheet && packSheet.getLastRow() >= 2) {
      var packData = packSheet.getRange(2, 1, packSheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues();
      packData.forEach(function(r) { if (String(r[1]).trim() === tripKey) packCount++; });
    }

    if (packCount > 0) return; // Already has items

    var ruleKey = 'trip_packing_' + tripKey.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_' + dateStr;
    if (wasRecentlySent_(ruleKey, 1440)) return;

    sendNudge_(
      ruleKey,
      trip.label + ' — packing list empty',
      '🧳 Your ' + trip.label + ' trip is in ' + daysAway + ' day' + (daysAway === 1 ? '' : 's') + '.\n\n' +
      'Packing list isn\'t started yet! Open VERA chat and say "generate packing list for ' + trip.label + '" to get started.'
    );
  });
}

// ---- Rule: Goal check-in (Issue #24) ----------------------------------------

/**
 * Fires once weekly on Monday morning for any goal in 'Doing' status
 * that was created in a prior month (potentially stalling).
 * Suppression-aware.
 */
function checkGoalCheckin_(now, hour, cfg) {
  var day = now.getDay(); // 0=Sun, 1=Mon
  if (day !== 1) return; // Mondays only
  if (hour !== Number(cfg['weekend_planner_hour'] || 8)) return; // Same window as weekend planner

  var tz      = Session.getScriptTimeZone();
  var dateStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  var suppressed = [];
  try { suppressed = getSuppressedKeyPatterns_(); } catch(e) {}

  if (suppressed.indexOf('goal_stall') !== -1) return;

  var currentYear  = now.getFullYear();
  var currentMonth = now.getMonth(); // 0-indexed

  var goals = [];
  try { goals = getGoals_(); } catch(e) {
    Logger.log('checkGoalCheckin_: could not read goals — ' + e.message);
    return;
  }

  var stalledGoals = goals.filter(function(g) {
    if (g.year !== currentYear) return false;
    if (g.status !== 'Doing' && g.status !== 'In Progress') return false;

    // Extract creation month from ID (format GOAL-YYYYMMDD-NN)
    var idMatch = g.id.match(/GOAL-(\d{4})(\d{2})\d{2}/);
    if (!idMatch) return true; // Unknown creation date — flag conservatively
    var goalYear  = parseInt(idMatch[1], 10);
    var goalMonth = parseInt(idMatch[2], 10) - 1; // 0-indexed
    return (goalYear === currentYear && goalMonth < currentMonth) || (goalYear < currentYear);
  });

  if (stalledGoals.length === 0) return;

  var ruleKey = 'goal_checkin_' + dateStr;
  if (wasRecentlySent_(ruleKey, 10080)) return; // Once per week (7 days * 1440 min)

  var goalList = stalledGoals.slice(0, 3).map(function(g) {
    return '• ' + g.title + (g.category ? ' [' + g.category + ']' : '');
  }).join('\n');

  sendNudge_(
    ruleKey,
    'Goal check-in: ' + stalledGoals.length + ' goal(s) stalling',
    '🎯 Goal check-in!\n\n' +
    'These goal' + (stalledGoals.length === 1 ? '' : 's') + ' have been in progress for a while:\n\n' +
    goalList + '\n\n' +
    'Make any moves this week? Open VERA chat to update progress or add tasks.'
  );
}

// ---- Rule: Home service due (Issue #24) -------------------------------------

/**
 * Fires once daily in the morning window when a home item service is overdue
 * or due within 7 days.
 * Suppression-aware.
 */
function checkHomeServiceDue_(now, hour, cfg) {
  if (hour < 8 || hour > 9) return; // Morning window only

  var tz      = Session.getScriptTimeZone();
  var today   = new Date(now); today.setHours(0, 0, 0, 0);
  var dateStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  var suppressed = [];
  try { suppressed = getSuppressedKeyPatterns_(); } catch(e) {}

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.HOME_ITEMS);
  if (!sheet || sheet.getLastRow() < 2) return;

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, HOME_ITEM_HEADERS.length).getValues();

  data.forEach(function(row) {
    var itemName = String(row[0] || '').trim();
    if (!itemName) return;

    var serviceDays = null;
    if (row[5]) {
      try { serviceDays = Math.round((new Date(row[5]) - today) / 86400000); } catch(e2) {}
    }

    if (serviceDays === null) return;
    if (serviceDays > 7) return; // Not due soon enough

    var pattern = 'home_service_' + itemName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (suppressed.indexOf(pattern) !== -1) return;
    if (suppressed.indexOf('home_service') !== -1) return;

    var ruleKey  = pattern + '_' + dateStr;
    if (wasRecentlySent_(ruleKey, 1440)) return;

    var statusStr;
    if (serviceDays < 0) {
      statusStr = '⚠ service is ' + Math.abs(serviceDays) + ' day' + (Math.abs(serviceDays) === 1 ? '' : 's') + ' OVERDUE';
    } else if (serviceDays === 0) {
      statusStr = 'service is DUE TODAY';
    } else {
      statusStr = 'service due in ' + serviceDays + ' day' + (serviceDays === 1 ? '' : 's');
    }

    sendNudge_(
      ruleKey,
      'Home maintenance: ' + itemName,
      '🔧 Home maintenance reminder: ' + itemName + ' — ' + statusStr + '.\n\n' +
      'Open VERA chat and say "record service for ' + itemName + '" once done.'
    );
  });
}

// ============================================================
// EXPLORER — Daily AI discovery
// ============================================================

/**
 * Calls Claude with a "discovery mode" prompt and sends the result via sendNudge_.
 * Called from nightlyRun() as Step 0c.
 * Non-fatal — errors are logged but do not interrupt the nightly pipeline.
 */
function runExplorer_() {
  var cfg = getConfigValues();
  if (String(cfg['explorer_enabled'] || 'true').toLowerCase() === 'false') {
    Logger.log('runExplorer_: explorer_enabled=false, skipping.');
    return;
  }

  var tz      = Session.getScriptTimeZone();
  var dateStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var ruleKey = 'explorer_' + dateStr;

  if (wasRecentlySent_(ruleKey, 1440)) {
    Logger.log('runExplorer_: already sent today, skipping.');
    return;
  }

  var goals     = getGoals_();
  var tasks     = getOpenTasks();
  var events    = getUpcomingEvents();
  var summaries = getSummaries();
  var interests = cfg['explorer_interests'] ||
    'specialty coffee, Egyptian culture, boutique fitness, local events, home improvement';
  var ledger    = getSharedInterestLedger_().slice(0, 20); // top 20 active entries

  var prompt    = buildExplorerPrompt_(goals, tasks, events, summaries, interests, ledger);
  var discovery = callClaudeExplorer_(prompt);

  if (!discovery) {
    Logger.log('runExplorer_: no content returned from Claude, skipping send.');
    return;
  }

  sendNudge_(ruleKey, 'Daily Discovery', discovery);
  Logger.log('runExplorer_: discovery sent (' + discovery.length + ' chars).');
}

/**
 * Builds the Claude prompt for the Explorer mode.
 * Injects goals, tasks, calendar, summaries, interests, and the Shared Interest Ledger.
 *
 * @param {Array}  goals     - From getGoals_()
 * @param {Array}  tasks     - From getOpenTasks()
 * @param {Array}  events    - From getUpcomingEvents()
 * @param {Array}  summaries - From getSummaries()
 * @param {string} interests - Config string of general interests
 * @param {Array}  ledger    - From getSharedInterestLedger_() (top 20 active entries)
 */
function buildExplorerPrompt_(goals, tasks, events, summaries, interests, ledger) {
  var tz    = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'EEEE, MMMM d, yyyy');

  var goalLines = goals.length === 0
    ? '  (none)'
    : goals.slice(0, 10).map(function(g) {
        return '  - [' + g.status + '] ' + g.title + (g.category ? ' (' + g.category + ')' : '');
      }).join('\n');

  var taskLines = tasks.length === 0
    ? '  (none)'
    : tasks.slice(0, 10).map(function(t) {
        return '  - ' + t.task + (t.isOverdue ? ' [OVERDUE]' : '');
      }).join('\n');

  var eventLines = events.length === 0
    ? '  (none in next 7 days)'
    : events.slice(0, 10).map(function(e) {
        return '  - ' + e.title + ' (in ' + e.daysUntil + 'd)';
      }).join('\n');

  var summaryLines = summaries.length === 0
    ? '  (none)'
    : summaries.slice(0, 8).map(function(s) {
        return '  [' + s.source + '] ' + s.metric + ': ' + s.value;
      }).join('\n');

  var ledger_   = ledger || [];
  var ledgerLines = ledger_.length === 0
    ? '  (none logged yet)'
    : ledger_.map(function(i) {
        return '  - ' + i.person + ' wants/likes: ' + i.interest +
               ' (' + i.category + ', logged ' + i.date + ')';
      }).join('\n');

  return (
    'You are VERA in "discovery mode". Today is ' + today + '.\n\n' +
    'Ahmed\'s yearly goals:\n' + goalLines + '\n\n' +
    'Open tasks (top 10):\n' + taskLines + '\n\n' +
    'Upcoming calendar (next 7 days):\n' + eventLines + '\n\n' +
    'Life context (summaries):\n' + summaryLines + '\n\n' +
    'Ahmed\'s general interests: ' + interests + '\n\n' +
    'Shared Interest Ledger (specific things Ahmed and Victoria have mentioned wanting or liking):\n' +
    ledgerLines + '\n\n' +
    'When surfacing discoveries, cross-reference the Shared Interest Ledger. ' +
    'If you find a match between a discovery and a logged interest, call it out naturally — ' +
    'e.g. "Victoria mentioned wanting to visit Round Rock — there\'s a farmers market there this weekend." ' +
    'Personalised connections are far more valuable than generic suggestions.\n\n' +
    'Surface 2-3 non-obvious, forward-looking observations or suggestions that:\n' +
    '- Connect dots across goals, tasks, and calendar in ways Ahmed might not immediately notice\n' +
    '- Are specific and actionable (not generic advice like "get enough sleep")\n' +
    '- Are opportunistic and forward-looking — save urgency for Flags\n\n' +
    'Format as a short, warm message. Max 200 words. ' +
    'Start with exactly "🔍 Daily Discovery" on its own line. No markdown headers or code fences.'
  );
}

/**
 * Calls the Claude API in single-turn mode for the Explorer prompt.
 * Returns the response text, or null on failure.
 *
 * @param {string} prompt - The Explorer prompt
 * @returns {string|null}
 */
function callClaudeExplorer_(prompt) {
  var apiKey = getApiKey();
  var requestBody = {
    model:      CLAUDE_MODEL,
    max_tokens: 512,
    messages:   [{ role: 'user', content: prompt }],
  };

  var fetchOptions = {
    method:             'post',
    contentType:        'application/json',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload:            JSON.stringify(requestBody),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(CLAUDE_API_URL, fetchOptions);
  if (response.getResponseCode() !== 200) {
    Logger.log('callClaudeExplorer_ HTTP ' + response.getResponseCode() + ': ' +
               response.getContentText().substring(0, 200));
    return null;
  }

  var json = JSON.parse(response.getContentText());
  if (!json.content || !json.content[0] || !json.content[0].text) return null;

  return json.content[0].text.trim();
}

// ============================================================
// DELIVERY — dual channel (Telegram now, email fallback)
// ============================================================

/**
 * Sends a nudge message via Telegram (if TELEGRAM_ALLOWED_CHAT_ID is set)
 * or plain-text email (fallback when Telegram isn't configured).
 * Always records the send to the Reminders Memory tab via markSent_().
 *
 * To switch from email to Telegram: set TELEGRAM_ALLOWED_CHAT_ID in
 * Script Properties — no code change or redeploy needed.
 *
 * @param {string} ruleKey - Unique key for this reminder (used for dedup)
 * @param {string} subject - Email subject line (also used as log label)
 * @param {string} message - Message body
 */
function sendNudge_(ruleKey, subject, message) {
  if (isSlackConfigured_()) {
    sendSlackNotification_(message);
    Logger.log('sendNudge_ [Slack]: ' + ruleKey);
  } else if (getTelegramAllowedChatId_()) {
    sendTelegramMessage_(getTelegramAllowedChatId_(), message);
    Logger.log('sendNudge_ [Telegram]: ' + ruleKey);
  } else {
    MailApp.sendEmail(
      CONFIG.MORNING_NUDGE_EMAIL,
      'VERA: ' + subject,
      message,
      { name: 'VERA' }
    );
    Logger.log('sendNudge_ [Email]: ' + ruleKey);
  }
  markSent_(ruleKey, message);
}

/**
 * Returns true if Slack is configured (preferred channel).
 * Falls back to Telegram check for backward compatibility.
 */
function isTelegramConfigured_() {
  return isSlackConfigured_() || !!(getTelegramAllowedChatId_());
}

// ============================================================
// MEMORY — Reminders Memory sheet tab
// ============================================================

/**
 * Returns the Reminders Memory sheet.
 * Auto-creates the tab with headers if it somehow doesn't exist yet.
 *
 * @returns {Sheet}
 */
function getRemindersMemorySheet_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.REMINDERS_MEMORY);
  if (!sheet) {
    // Shouldn't happen after setup, but handle gracefully
    sheet = ss.insertSheet(TABS.REMINDERS_MEMORY);
    var headerRange = sheet.getRange(1, 1, 1, 3);
    headerRange.setValues([['Rule Key', 'Sent At', 'Message']]);
    headerRange.setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    Logger.log('getRemindersMemorySheet_: auto-created missing tab.');
  }
  return sheet;
}

/**
 * Returns true if the given ruleKey was sent within the last cooldownMinutes.
 * Scans the Reminders Memory tab from the bottom (most recent first).
 *
 * @param {string} ruleKey         - The rule identifier to look up
 * @param {number} cooldownMinutes - Number of minutes to consider "recently sent"
 * @returns {boolean}
 */
function wasRecentlySent_(ruleKey, cooldownMinutes) {
  var sheet = getRemindersMemorySheet_();
  if (sheet.getLastRow() < 2) return false;

  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, 2).getValues(); // Rule Key + Sent At
  var now     = new Date();

  // Scan from bottom (most recent) for efficiency
  for (var i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]).trim() === ruleKey) {
      var sentAt = new Date(data[i][1]);
      if (isNaN(sentAt.getTime())) continue;
      var elapsedMinutes = (now - sentAt) / 60000;
      return elapsedMinutes < cooldownMinutes;
    }
  }
  return false; // Never sent
}

/**
 * Appends a row to the Reminders Memory tab recording that this rule was triggered.
 * Called by sendNudge_() after successful delivery.
 *
 * @param {string} ruleKey - The rule identifier
 * @param {string} message - The message that was sent (first 100 chars stored)
 */
function markSent_(ruleKey, message) {
  var sheet   = getRemindersMemorySheet_();
  var preview = String(message || '').substring(0, 100);
  sheet.appendRow([ruleKey, new Date().toISOString(), preview]);
}

// ============================================================
// MANUAL TEST HELPERS — run from Apps Script editor
// ============================================================

/**
 * Manually trigger hourlyCheck() to test rules without waiting for the trigger.
 * Check the Execution Log for rule output and your email/Telegram for messages.
 */
function testHourlyCheck() {
  Logger.log('=== testHourlyCheck ===');
  hourlyCheck();
  Logger.log('=== Done ===');
}

/**
 * Manually trigger the Explorer to test the daily discovery bulletin.
 * Clears today's explorer entry from Reminders Memory first to force a send.
 */
function testExplorer() {
  Logger.log('=== testExplorer ===');
  // Clear today's explorer entry so it sends even if already sent today
  var tz      = Session.getScriptTimeZone();
  var dateStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var ruleKey = 'explorer_' + dateStr;
  clearReminderEntry_(ruleKey);
  runExplorer_();
  Logger.log('=== Done ===');
}

/**
 * Removes all rows from the Reminders Memory tab (reset state for testing).
 * Keeps the header row.
 */
function clearRemindersMemory() {
  var sheet = getRemindersMemorySheet_();
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
  Logger.log('Reminders Memory cleared.');
}

/**
 * Removes the most recent row for a given ruleKey from Reminders Memory.
 * Useful for testing individual rules without clearing everything.
 *
 * @param {string} ruleKey
 */
function clearReminderEntry_(ruleKey) {
  var sheet = getRemindersMemorySheet_();
  if (sheet.getLastRow() < 2) return;

  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, 1).getValues();

  for (var i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]).trim() === ruleKey) {
      sheet.deleteRow(i + 2); // +2 because data starts at row 2
      Logger.log('clearReminderEntry_: removed entry for ' + ruleKey);
      return;
    }
  }
  Logger.log('clearReminderEntry_: no entry found for ' + ruleKey);
}
