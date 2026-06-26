// ============================================================
// VERA — WeekendPlanner.js
// Proactive Weekend Planner — Issue #20
//
// Fires every Monday ~8am via hourlyCheck() guard in Reminders.js.
// Delivers a "Weekend Decision Memo" with three archetypes:
//   THE EXTENSION  — goal-anchored activity
//   THE CONTRAST   — rest/recharge (weighted if high intensity)
//   THE PROTOTYPE  — new experience not in Interest Ledger
//
// DELIVERY:
//   1. Slack (#vera-notifications) or email — Monday morning
//   2. All-day Google Calendar event on the upcoming Saturday
//
// SETUP:
//   Run addWeekendPlannerConfig() once to seed Config tab defaults.
//   No new triggers, tabs, or OAuth scopes required.
//
// CONFIG KEYS (Config tab):
//   weekend_planner_enabled       — true/false master switch (default true)
//   weekend_planner_lookahead_days — days to scan for clear windows (default 21)
//   weekend_planner_hour          — 24h hour to fire on Monday (default 8)
//   weekend_planner_home_city     — base city for driving-radius framing (default "Austin, TX")
// ============================================================

// ============================================================
// MAIN ORCHESTRATOR
// ============================================================

/**
 * Runs the Weekend Planner. Called from hourlyCheck() in Reminders.js
 * when day===1 (Monday) && hour===weekend_planner_hour (default 8).
 *
 * Generates a Weekend Decision Memo via Claude and delivers it via:
 *   - Telegram push / email (sendNudge_)
 *   - All-day Google Calendar event on the upcoming Saturday
 */
function runWeekendPlanner_() {
  var _wpStart = Date.now();
  try {
  Logger.log('runWeekendPlanner_: starting');

  var cfg = getConfigValues();

  // Master switch
  if (String(cfg['weekend_planner_enabled'] || 'true').toLowerCase() === 'false') {
    Logger.log('runWeekendPlanner_: disabled (weekend_planner_enabled=false)');
    veraLog_('runWeekendPlanner', 'Planning', 'Skipped', 'weekend_planner_enabled=false', Date.now() - _wpStart);
    return;
  }

  // Weekly cooldown — ~6.25 days (9000 min) prevents double-send
  if (wasRecentlySent_('weekend_planner', 9000)) {
    Logger.log('runWeekendPlanner_: already sent recently, skipping');
    veraLog_('runWeekendPlanner', 'Planning', 'Skipped', 'Already sent recently (cooldown)', Date.now() - _wpStart);
    return;
  }

  var today          = new Date();
  var lookAheadDays  = parseInt(cfg['weekend_planner_lookahead_days'] || '21', 10);

  Logger.log('runWeekendPlanner_: lookAheadDays=' + lookAheadDays);

  // ---- Gather data -----------------------------------------------------------
  var ptoCfg    = readPTOConfig_();
  var gapCals   = getGapCalendars_(ptoCfg);
  var windows   = getWeekendWindows_(gapCals, today, lookAheadDays);

  var events    = getUpcomingEvents(21);
  var tasks     = getOpenTasks();
  var activeFlags = readActiveFlagsForPlanner_();
  var intensity = computeIntensitySignal_(activeFlags, tasks, events);
  var goals     = getGoals_();
  var ledger    = getSharedInterestLedger_().slice(0, 15);

  var ptoResult = getPTOEvents_(ptoCfg);
  var ptoStats  = computePTOStats_(ptoResult, ptoCfg, today);

  var travelCtx   = getTravelContextForPlanner_();
  var planHistory = readPlannerHistory_();

  Logger.log('runWeekendPlanner_: windows=' + windows.length +
             ', events=' + events.length +
             ', tasks=' + tasks.length +
             ', flags=' + activeFlags.length +
             ', intensity=' + intensity.level);

  // ---- Build prompt + call Claude -------------------------------------------
  var prompt = buildWeekendPlannerPrompt_({
    windows:    windows,
    events:     events,
    tasks:      tasks,
    intensity:  intensity,
    goals:      goals,
    ledger:     ledger,
    ptoStats:   ptoStats,
    today:      today,
    travelCtx:  travelCtx,
    planHistory: planHistory,
  });

  var memo = callClaudeWeekendPlanner_(prompt);
  if (!memo) {
    Logger.log('runWeekendPlanner_: no memo returned from Claude, aborting');
    veraLog_('runWeekendPlanner', 'Planning', 'Failed', 'No memo returned from Claude', Date.now() - _wpStart);
    return;
  }

  // ---- Deliver ---------------------------------------------------------------
  // 1. Slack / email push
  sendNudge_('weekend_planner', 'VERA Weekend Memo', memo);
  Logger.log('runWeekendPlanner_: nudge sent (' + memo.length + ' chars)');

  // 2. Calendar event on upcoming Saturday (full memo in description)
  var saturday = (windows.length > 0 && windows[0].weekendStart)
    ? parseDateStr_(windows[0].weekendStart)
    : computeNextSaturday_(today);
  createWeekendMemoEvent_(saturday, memo);
  Logger.log('runWeekendPlanner_: calendar event created on ' +
             Utilities.formatDate(saturday, Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  veraLog_('runWeekendPlanner', 'Planning', 'Success',
    windows.length + ' weekend window(s) found, memo generated (' + memo.length + ' chars)',
    Date.now() - _wpStart);
  writePlannerHistory_(memo);
  } catch (err) {
    Logger.log('runWeekendPlanner_ FATAL: ' + err.message + '\n' + (err.stack || ''));
    veraLog_('runWeekendPlanner', 'Planning', 'Failed', '', Date.now() - _wpStart, err.message);
  }
}

// ============================================================
// WINDOW DETECTION
// ============================================================

/**
 * Finds clear workday windows in the next lookAheadDays days,
 * then filters to only those that touch or wrap a weekend.
 *
 * @param {Array}  gapCalendars - from getGapCalendars_()
 * @param {Date}   today
 * @param {number} lookAheadDays
 * @returns {Array} enriched window objects
 */
function getWeekendWindows_(gapCalendars, today, lookAheadDays) {
  var rawWindows = findClearWindows_(gapCalendars, today, lookAheadDays, 1);
  return filterWeekendWindows_(rawWindows);
}

/**
 * Filters raw workday windows to only those touching a Friday or Monday,
 * then enriches each with bridgeType, weekendStart, weekendEnd, and totalCalDays.
 *
 * findClearWindows_() counts workday runs — a Mon–Wed window has no weekend value.
 * We only keep windows that:
 *   - Contain a Friday  → bridgeType: 'friday-bridge'  (extends into Sat/Sun ahead)
 *   - Contain a Monday  → bridgeType: 'monday-bridge'  (extends from Sat/Sun behind)
 *   - Contain both Fri + Mon → bridgeType: 'full-wrap' (entire weekend bridged)
 *
 * @param {Array} rawWindows - [{ startDate, endDate, workdays }] (dates as 'yyyy-MM-dd' strings)
 * @returns {Array} enriched objects, or [] if no windows qualify
 */
function filterWeekendWindows_(rawWindows) {
  if (!rawWindows || rawWindows.length === 0) return [];

  var tz = Session.getScriptTimeZone();
  var result = [];

  for (var i = 0; i < rawWindows.length; i++) {
    var w = rawWindows[i];
    var startDate = parseDateStr_(w.startDate);
    var endDate   = parseDateStr_(w.endDate);

    var hasFriday = false;
    var hasMonday = false;
    var fridayDate = null;
    var mondayDate = null;

    // Walk every day in the window (start→end inclusive) to find Fri/Mon
    var d = new Date(startDate.getTime());
    while (d <= endDate) {
      var dow = d.getDay();
      if (dow === 5) { hasFriday = true; fridayDate = new Date(d.getTime()); }
      if (dow === 1) { hasMonday = true; mondayDate = new Date(d.getTime()); }
      d.setDate(d.getDate() + 1);
    }

    if (!hasFriday && !hasMonday) continue; // skip — no weekend bridge

    var bridgeType;
    var weekendStart;
    var weekendEnd;

    if (hasFriday && hasMonday) {
      bridgeType = 'full-wrap';
      // Weekend is the Sat+Sun between the Friday and Monday
      weekendStart = new Date(fridayDate.getTime());
      weekendStart.setDate(weekendStart.getDate() + 1); // Saturday after Friday
      weekendEnd = new Date(mondayDate.getTime());
      weekendEnd.setDate(weekendEnd.getDate() - 1);     // Sunday before Monday
    } else if (hasFriday) {
      bridgeType = 'friday-bridge';
      weekendStart = new Date(fridayDate.getTime());
      weekendStart.setDate(weekendStart.getDate() + 1); // Saturday after Friday
      weekendEnd = new Date(weekendStart.getTime());
      weekendEnd.setDate(weekendEnd.getDate() + 1);     // Sunday
    } else {
      bridgeType = 'monday-bridge';
      weekendEnd = new Date(mondayDate.getTime());
      weekendEnd.setDate(weekendEnd.getDate() - 1);     // Sunday before Monday
      weekendStart = new Date(weekendEnd.getTime());
      weekendStart.setDate(weekendStart.getDate() - 1); // Saturday
    }

    // Total calendar days from window start through weekend end (or window end, whichever later)
    var span = Math.max(endDate.getTime(), weekendEnd.getTime());
    var totalCalDays = Math.round((span - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

    result.push({
      startDate:    Utilities.formatDate(startDate, tz, 'yyyy-MM-dd'),
      endDate:      Utilities.formatDate(endDate, tz, 'yyyy-MM-dd'),
      workdays:     w.workdays,
      bridgeType:   bridgeType,
      weekendStart: Utilities.formatDate(weekendStart, tz, 'yyyy-MM-dd'),
      weekendEnd:   Utilities.formatDate(weekendEnd, tz, 'yyyy-MM-dd'),
      totalCalDays: totalCalDays,
    });
  }

  return result;
}

// ============================================================
// INTENSITY SIGNAL
// ============================================================

/**
 * Infers how intense the current work period is, using what VERA already knows.
 * No new data sources.
 *
 * Thresholds for HIGH:
 *   - Active unresolved flags ≥ 4
 *   - Overdue tasks ≥ 2
 *   - Meetings in next 5 days (non-all-day) ≥ 8
 *
 * level = 'high'   if 2+ thresholds breached
 * level = 'medium' if 1 threshold breached
 * level = 'low'    otherwise
 *
 * @param {Array} activeFlags - from readActiveFlagsForPlanner_()
 * @param {Array} tasks       - from getOpenTasks()
 * @param {Array} events      - from getUpcomingEvents()
 * @returns {{ level, activeFlagCount, overdueTaskCount, meetingCount }}
 */
function computeIntensitySignal_(activeFlags, tasks, events) {
  var activeFlagCount = (activeFlags || []).length;

  // Overdue tasks: due date is set and in the past, status is not done
  var now = new Date();
  var overdueTaskCount = (tasks || []).filter(function(t) {
    var status = String(t.status || '').toLowerCase();
    if (status === 'done' || status === 'complete' || status === 'completed') return false;
    if (!t.dueDate) return false;
    var due = new Date(t.dueDate);
    return !isNaN(due.getTime()) && due < now;
  }).length;

  // Meetings in next 5 days: timed (non-all-day) events
  var fiveDaysOut = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  var meetingCount = (events || []).filter(function(ev) {
    if (ev.allDay) return false;
    var start = new Date(ev.start);
    return !isNaN(start.getTime()) && start >= now && start <= fiveDaysOut;
  }).length;

  var thresholdsBreach = 0;
  if (activeFlagCount >= 4)  thresholdsBreach++;
  if (overdueTaskCount >= 2) thresholdsBreach++;
  if (meetingCount >= 8)     thresholdsBreach++;

  var level = thresholdsBreach >= 2 ? 'high' : thresholdsBreach === 1 ? 'medium' : 'low';

  Logger.log('computeIntensitySignal_: flags=' + activeFlagCount +
             ', overdue=' + overdueTaskCount +
             ', meetings=' + meetingCount +
             ', breaches=' + thresholdsBreach +
             ', level=' + level);

  return {
    level:           level,
    activeFlagCount: activeFlagCount,
    overdueTaskCount: overdueTaskCount,
    meetingCount:    meetingCount,
  };
}

// ============================================================
// PROMPT BUILDER
// ============================================================

/**
 * Builds the Claude prompt for the Weekend Decision Memo.
 *
 * @param {Object} ctx - { windows, events, tasks, intensity, goals, ledger, ptoStats, isTelegram, today }
 * @returns {string}
 */
function buildWeekendPlannerPrompt_(ctx) {
  var tz = Session.getScriptTimeZone();

  var todayStr = Utilities.formatDate(ctx.today, tz, 'EEEE, MMM d, yyyy');

  // ---- Windows section -------------------------------------------------------
  var windowsSection;
  if (ctx.windows.length === 0) {
    windowsSection = 'No clear windows found in the next ' +
      (ctx.ptoStats && ctx.ptoStats.config ? '21' : '21') +
      ' days. Base suggestions on the nearest natural weekend.';
  } else {
    windowsSection = ctx.windows.map(function(w) {
      return '- ' + w.bridgeType + ': ' + w.startDate + ' → ' + w.endDate +
        ', ' + w.workdays + ' clear workday(s), ' + w.totalCalDays + ' total calendar days' +
        (w.weekendStart ? ' (weekend: ' + w.weekendStart + '–' + w.weekendEnd + ')' : '');
    }).join('\n');
  }

  // ---- Intensity section -----------------------------------------------------
  var intensitySection =
    'Level: ' + ctx.intensity.level.toUpperCase() + '\n' +
    'Active flags: ' + ctx.intensity.activeFlagCount +
    ' | Overdue tasks: ' + ctx.intensity.overdueTaskCount +
    ' | Upcoming meetings (5 days): ' + ctx.intensity.meetingCount;
  if (ctx.intensity.level === 'high') {
    intensitySection += '\n⚠️ Weight The Contrast heavily — Ahmed needs a rest-oriented option.';
  }

  // ---- Ledger section --------------------------------------------------------
  var ledgerEntries = Array.isArray(ctx.ledger) ? ctx.ledger : [];
  var ledgerSection = ledgerEntries.length === 0
    ? 'No interests logged yet.'
    : ledgerEntries.map(function(i) {
        return '- ' + i.person + ': ' + i.interest + ' [' + i.category + ', logged ' + i.date + ']';
      }).join('\n');

  // ---- Goals section ---------------------------------------------------------
  var activeGoals = (ctx.goals || [])
    .filter(function(g) {
      var s = String(g.status || '').toLowerCase();
      return s !== 'done' && s !== 'archived' && s !== 'complete';
    })
    .slice(0, 8);
  var goalsSection = activeGoals.length === 0
    ? 'No active goals found.'
    : activeGoals.map(function(g) {
        return '- [' + g.status + '] ' + g.title + (g.category ? ' (' + g.category + ')' : '');
      }).join('\n');

  // ---- Calendar section ------------------------------------------------------
  var eventsSection = (ctx.events || []).slice(0, 15).map(function(ev) {
    return '- ' + ev.title + ' on ' + ev.date +
      (ev.daysUntil !== undefined ? ' (in ' + ev.daysUntil + ' days)' : '') +
      (ev.allDay ? ' [all-day]' : '');
  }).join('\n') || 'No upcoming events.';

  // ---- Tasks section ---------------------------------------------------------
  var openTasks = (ctx.tasks || [])
    .filter(function(t) {
      var s = String(t.status || '').toLowerCase();
      return s !== 'done' && s !== 'complete' && s !== 'completed';
    })
    .slice(0, 5);
  var tasksSection = openTasks.length === 0
    ? 'No open tasks.'
    : openTasks.map(function(t) {
        return '- ' + t.task + (t.dueDate ? ' (due: ' + t.dueDate + ')' : '') +
               (t.status ? ' [' + t.status + ']' : '');
      }).join('\n');

  // ---- PTO section -----------------------------------------------------------
  var ptoSection = 'PTO data unavailable.';
  try {
    if (ctx.ptoStats) ptoSection = ptoSummaryForClaude_(ctx.ptoStats);
  } catch (e) {
    Logger.log('buildWeekendPlannerPrompt_: ptoSummaryForClaude_ error: ' + e.message);
  }

  // ---- Block A: Travel context -----------------------------------------------
  var tCtx = ctx.travelCtx || {};
  var travelLines = ['=== TRAVEL CONTEXT ==='];
  if (tCtx.currentTrip) {
    var ct = tCtx.currentTrip;
    var endParts = String(ct.endDate || '').split('-');
    var endDateObj = new Date(parseInt(endParts[0], 10), parseInt(endParts[1], 10) - 1, parseInt(endParts[2], 10));
    var endDateFmt = Utilities.formatDate(endDateObj, tz, 'MMM d');
    travelLines.push('Ahmed is currently traveling: ' + ct.label + ' (through ' + endDateFmt + ').');
    travelLines.push('IMPORTANT: Reframe ALL three suggestions around this destination. Do NOT suggest home-based activities, errands, or anything requiring Ahmed to be at home.');
    if (tCtx.currentTripOnBucketList) {
      travelLines.push('★ This destination is on Ahmed\'s bucket list — acknowledge and amplify this.');
    }
  } else {
    travelLines.push('Ahmed is home this weekend. Suggestions may be home-region or feasibly drivable.');
  }
  if (tCtx.upcomingTrips && tCtx.upcomingTrips.length > 0) {
    tCtx.upcomingTrips.forEach(function(t) {
      travelLines.push('Upcoming travel: ' + t.label + ' departs in ' + t.daysAway + ' day(s) — factor in prep energy and logistics if relevant.');
    });
  }
  var travelBlock = travelLines.join('\n');

  // ---- Block B: Bucket list inspiration --------------------------------------
  var bucketBlock = '';
  var bList = tCtx.bucketList || [];
  if (bList.length > 0) {
    var bLines = [
      '=== DREAM DESTINATIONS (inspiration/flavor — do not force) ===',
      'These are unvisited destinations on Ahmed\'s bucket list. Use as stepping-stones or flavor where naturally relevant (e.g. if Japan is listed, a Japanese cooking class qualifies as THE PROTOTYPE). Do not contrive connections.',
    ];
    bList.forEach(function(b) {
      var starCount = Math.min(5, Math.max(1, Number(b['Stars']) || 1));
      var stars = '';
      for (var s = 0; s < starCount; s++) stars += '★';
      var line = stars + ' ' + b['City'] + ', ' + b['Country'];
      if (b['Target Year']) line += ' (target ' + b['Target Year'] + ')';
      if (b['Dream Trip']) line += ' — ' + b['Dream Trip'];
      bLines.push(line);
    });
    bucketBlock = bLines.join('\n');
  }

  // ---- Block C: Anti-recycle history -----------------------------------------
  var historyBlock = '';
  var history = ctx.planHistory || [];
  if (history.length > 0) {
    var hLines = ['=== RECENT WEEKEND PLANS — DO NOT REPEAT OR REPHRASE ==='];
    history.forEach(function(h) {
      hLines.push(h.date + ': ' + h.text);
    });
    historyBlock = hLines.join('\n');
  }

  // ---- Output instructions ---------------------------------------------------
  // Find the nearest upcoming Saturday date for the memo header
  var sat = computeNextSaturday_(ctx.today);
  var satStr = Utilities.formatDate(sat, tz, 'MMM d');

  var outputInstructions =
    'Generate a "Weekend Decision Memo" with exactly this structure:\n\n' +
    'Weekend Memo — ' + satStr + '\n\n' +
    'THE EXTENSION\n' +
    'One specific weekend idea anchored to an active goal or in-progress task.\n' +
    'Name the goal. Name the activity. Say why this specific weekend.\n\n' +
    'THE CONTRAST\n' +
    (ctx.intensity.level === 'high'
      ? 'Suggest Zero-Input (nature, quiet, no agenda). Ahmed needs to recharge.\n'
      : 'Social but low-effort option. ') +
    'Be direct: "You need [X] because [Y]."\n\n' +
    'THE PROTOTYPE\n' +
    'One new city, neighbourhood, or experience NOT already in the Interest Ledger.\n' +
    'Brief and evocative. Why this place? Why now?\n\n' +
    'VERA RECOMMENDS\n' +
    'One sentence — which of the three, and why, for this specific week.\n\n' +
    'Rules: no bullets, no markdown headers, no code fences.\n' +
    '2-4 sentences per section. Total: 250-350 words.\n' +
    'Specific — name real goals, real interests, real dates.\n' +
    'When traveling, ground all three archetypes (THE EXTENSION, THE CONTRAST, THE PROTOTYPE) in the current destination. VERA RECOMMENDS must reflect the travel context, not the home city.';

  // ---- Assemble --------------------------------------------------------------
  var sections = [
    'You are VERA, a personal chief-of-staff operating in Weekend Planner mode.',
    'Today is ' + todayStr + '. Ahmed lives in ' + (getConfigValues()['weekend_planner_home_city'] || 'Austin, TX') + '.',
    '',
    '=== CLEAR WEEKEND WINDOWS (next 21 days) ===',
    windowsSection,
    '',
    '=== THIS WEEK\'S INTENSITY SIGNAL ===',
    intensitySection,
    '',
    '=== SHARED INTEREST LEDGER (top 15) ===',
    ledgerSection,
    '',
    '=== YEARLY GOALS (active) ===',
    goalsSection,
    '',
    '=== UPCOMING CALENDAR (21 days) ===',
    eventsSection,
    '',
    '=== OPEN TASKS (top 5) ===',
    tasksSection,
    '',
    '=== PTO STATUS ===',
    ptoSection,
    '',
    travelBlock,
  ];
  if (bucketBlock) { sections.push(''); sections.push(bucketBlock); }
  if (historyBlock) { sections.push(''); sections.push(historyBlock); }
  sections.push('');
  sections.push('=== YOUR TASK ===');
  sections.push(outputInstructions);
  return sections.join('\n');
}

// ============================================================
// CLAUDE API CALL
// ============================================================

/**
 * Calls Claude to generate the Weekend Decision Memo.
 *
 * @param {string} prompt
 * @returns {string|null}
 */
function callClaudeWeekendPlanner_(prompt) {
  var apiKey = getApiKey();
  var requestBody = {
    model:      CLAUDE_MODEL,
    max_tokens: 1200,
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
    Logger.log('callClaudeWeekendPlanner_ HTTP ' + response.getResponseCode() +
               ': ' + response.getContentText().substring(0, 200));
    return null;
  }

  var json = JSON.parse(response.getContentText());
  if (!json.content || !json.content[0] || !json.content[0].text) return null;

  return json.content[0].text.trim();
}

// ============================================================
// DELIVERY — Format + Calendar
// ============================================================


/**
 * Creates an all-day Google Calendar event on saturdayDate
 * with the full memo in the event description.
 * Clears any previous "VERA Weekend Memo" events first.
 *
 * @param {Date}   saturdayDate
 * @param {string} memo
 */
function createWeekendMemoEvent_(saturdayDate, memo) {
  clearOldWeekendMemoEvents_();

  var ptoCfg = readPTOConfig_();
  var cal    = getCalendarByName_(ptoCfg.veraCalendarName);
  if (!cal) {
    Logger.log('createWeekendMemoEvent_: "' + ptoCfg.veraCalendarName + '" calendar not found — skipping event creation');
    return;
  }
  cal.createAllDayEvent('VERA Weekend Memo', saturdayDate, { description: memo });
  Logger.log('createWeekendMemoEvent_: event created in "' + ptoCfg.veraCalendarName + '" on ' +
             Utilities.formatDate(saturdayDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'));
}

/**
 * Removes all "VERA Weekend Memo" events in a ±60-day window.
 * Prevents duplicate events from accumulating over time.
 */
function clearOldWeekendMemoEvents_() {
  var now   = new Date();
  var start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  var end   = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  var ptoCfg = readPTOConfig_();
  var cal    = getCalendarByName_(ptoCfg.veraCalendarName);
  if (!cal) { return; }
  var events = cal.getEvents(start, end, { search: 'VERA Weekend Memo' });

  var removed = 0;
  for (var i = 0; i < events.length; i++) {
    if (events[i].getTitle() === 'VERA Weekend Memo') {
      events[i].deleteEvent();
      removed++;
    }
  }
  if (removed > 0) Logger.log('clearOldWeekendMemoEvents_: removed ' + removed + ' old event(s)');
}

// ============================================================
// DATA READERS
// ============================================================

/**
 * Reads the Flags tab and returns all unresolved, unacknowledged flags.
 * Light read — no API calls.
 *
 * @returns {Array} [{ flag, urgency, source, date }]
 */
function readActiveFlagsForPlanner_() {
  try {
    var ss    = getSpreadsheet();
    var sheet = ss.getSheetByName(TABS.FLAGS);
    if (!sheet || sheet.getLastRow() < 2) return [];

    var numRows = sheet.getLastRow() - 1;
    var data    = sheet.getRange(2, 1, numRows, FLAG_HEADERS.length).getValues();

    // FLAG_HEADERS: ID, Date, Source, Flag, Reason, Urgency, Acknowledged, Snoozed Until, Resolved, Key, Escalated
    // Col indices:   0    1      2      3      4        5         6               7             8      9      10
    return data.filter(function(row) {
      var id           = String(row[0] || '').trim();
      var acknowledged = String(row[6] || '').trim().toLowerCase();
      var resolved     = String(row[8] || '').trim().toLowerCase();
      return id !== '' && acknowledged !== 'yes' && resolved !== 'yes';
    }).map(function(row) {
      return {
        flag:    String(row[3] || ''),
        urgency: String(row[5] || ''),
        source:  String(row[2] || ''),
        date:    String(row[1] || ''),
      };
    });
  } catch (e) {
    Logger.log('readActiveFlagsForPlanner_ error: ' + e.message);
    return [];
  }
}

// ============================================================
// TRAVEL CONTEXT + PLAN HISTORY
// ============================================================

/**
 * Gathers travel state, bucket list, and trip proximity for the planner prompt.
 * Non-fatal — every sub-call is try/caught; returns safe defaults on failure.
 *
 * @returns {{ isOnVacation, currentTrip, upcomingTrips, bucketList, currentTripOnBucketList }}
 */
function getTravelContextForPlanner_() {
  var result = {
    isOnVacation:           false,
    currentTrip:            null,
    upcomingTrips:          [],
    bucketList:             [],
    currentTripOnBucketList: false,
  };

  try {
    result.isOnVacation = isInVacationMode_();
  } catch (e) {
    Logger.log('getTravelContextForPlanner_: isInVacationMode_ error: ' + e.message);
  }

  try {
    var ptoCfg   = readPTOConfig_();
    var allTrips = getUpcomingTravel_(ptoCfg);
    var todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    var tz = Session.getScriptTimeZone();
    var todayStr = Utilities.formatDate(todayMidnight, tz, 'yyyy-MM-dd');

    allTrips.forEach(function(t) {
      if (t.startDate <= todayStr && t.endDate >= todayStr) {
        if (!result.currentTrip) result.currentTrip = t;
      } else if (t.startDate > todayStr && t.daysAway <= 21) {
        result.upcomingTrips.push(t);
      }
    });
  } catch (e) {
    Logger.log('getTravelContextForPlanner_: getUpcomingTravel_ error: ' + e.message);
  }

  try {
    var bRes     = webGetBucketList_();
    var bEntries = (bRes && bRes.entries) || [];
    result.bucketList = bEntries
      .filter(function(b) { return !b['Visited']; })
      .sort(function(a, b_) { return (Number(b_['Stars']) || 0) - (Number(a['Stars']) || 0); })
      .slice(0, 8);
  } catch (e) {
    Logger.log('getTravelContextForPlanner_: bucketList error: ' + e.message);
  }

  if (result.currentTrip && result.bucketList.length > 0) {
    var label = String(result.currentTrip.label || '').toLowerCase();
    result.currentTripOnBucketList = result.bucketList.some(function(b) {
      var city    = String(b['City']    || '').toLowerCase();
      var country = String(b['Country'] || '').toLowerCase();
      return (city    && label.indexOf(city)    !== -1) ||
             (country && label.indexOf(country) !== -1);
    });
  }

  Logger.log('getTravelContextForPlanner_: isOnVacation=' + result.isOnVacation +
             ', currentTrip=' + (result.currentTrip ? result.currentTrip.label : 'none') +
             ', upcomingTrips=' + result.upcomingTrips.length +
             ', bucketList=' + result.bucketList.length +
             ', onBucketList=' + result.currentTripOnBucketList);
  return result;
}

/**
 * Reads the last 4 weekend plan entries from Script Properties.
 * Returns [] on any error (non-fatal).
 *
 * @returns {Array} [{ date, text }]
 */
function readPlannerHistory_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('WKND_PLAN_HISTORY');
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 4) : [];
  } catch (e) {
    Logger.log('readPlannerHistory_: error: ' + e.message);
    return [];
  }
}

/**
 * Prepends the current plan text to WKND_PLAN_HISTORY, keeping only the last 4 entries.
 * Called only after successful plan delivery — not on Claude failure.
 *
 * @param {string} planText
 */
function writePlannerHistory_(planText) {
  try {
    var dateLabel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d');
    var existing  = readPlannerHistory_();
    var entry     = { date: dateLabel, text: String(planText || '').substring(0, 400) };
    var updated   = [entry].concat(existing).slice(0, 4);
    PropertiesService.getScriptProperties().setProperty('WKND_PLAN_HISTORY', JSON.stringify(updated));
    Logger.log('writePlannerHistory_: saved ' + updated.length + ' entries');
  } catch (e) {
    Logger.log('writePlannerHistory_: error: ' + e.message);
  }
}

// ============================================================
// DATE HELPERS
// ============================================================

/**
 * Parses a 'yyyy-MM-dd' string into a local-midnight Date object.
 *
 * @param {string} dateStr
 * @returns {Date}
 */
function parseDateStr_(dateStr) {
  var parts = String(dateStr).split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the Date of the next upcoming Saturday.
 * If today is Saturday, returns the Saturday one week away.
 *
 * @param {Date} today
 * @returns {Date}
 */
function computeNextSaturday_(today) {
  var d    = new Date(today.getTime());
  var diff = (6 - d.getDay() + 7) % 7 || 7; // never 0 — always the next Saturday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ============================================================
// TEST HELPERS — Run from Apps Script editor
// ============================================================

/**
 * Full end-to-end test run.
 * Clears the cooldown entry so the planner fires even if already sent this week.
 */
function testWeekendPlanner() {
  Logger.log('=== testWeekendPlanner: START ===');

  // Clear cooldown so we can re-test without waiting 6 days
  try {
    var sheet = getRemindersMemorySheet_();
    var data  = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0] || '').indexOf('weekend_planner') === 0) {
        sheet.deleteRow(i + 1);
        Logger.log('testWeekendPlanner: cleared cooldown row at index ' + i);
      }
    }
  } catch (e) {
    Logger.log('testWeekendPlanner: could not clear cooldown (' + e.message + ') — continuing anyway');
  }

  runWeekendPlanner_();
  Logger.log('=== testWeekendPlanner: END ===');
}

/**
 * Logs the enriched weekend windows without calling Claude.
 */
function testWeekendWindows() {
  Logger.log('=== testWeekendWindows: START ===');
  var cfg     = readPTOConfig_();
  var gapCals = getGapCalendars_(cfg);
  var windows = getWeekendWindows_(gapCals, new Date(), 21);
  if (windows.length === 0) {
    Logger.log('No clear weekend windows found in next 21 days.');
  } else {
    windows.forEach(function(w, i) {
      Logger.log('Window ' + (i + 1) + ': ' + JSON.stringify(w));
    });
  }
  Logger.log('=== testWeekendWindows: END ===');
}

/**
 * Logs the intensity signal without calling Claude.
 */
function testIntensitySignal() {
  Logger.log('=== testIntensitySignal: START ===');
  var flags    = readActiveFlagsForPlanner_();
  var tasks    = getOpenTasks();
  var events   = getUpcomingEvents(7);
  var signal   = computeIntensitySignal_(flags, tasks, events);
  Logger.log('Intensity: ' + JSON.stringify(signal));
  Logger.log('=== testIntensitySignal: END ===');
}

/**
 * Logs the full prompt without calling Claude.
 */
function testWeekendPlannerPrompt() {
  Logger.log('=== testWeekendPlannerPrompt: START ===');
  var today     = new Date();
  var cfg       = readPTOConfig_();
  var gapCals   = getGapCalendars_(cfg);
  var windows   = getWeekendWindows_(gapCals, today, 21);
  var events    = getUpcomingEvents(21);
  var tasks     = getOpenTasks();
  var flags     = readActiveFlagsForPlanner_();
  var intensity = computeIntensitySignal_(flags, tasks, events);
  var goals     = getGoals_();
  var ledger    = getSharedInterestLedger_().slice(0, 15);
  var ptoResult = getPTOEvents_(cfg);
  var ptoStats  = computePTOStats_(ptoResult, cfg, today);

  var prompt = buildWeekendPlannerPrompt_({
    windows: windows, events: events, tasks: tasks,
    intensity: intensity, goals: goals, ledger: ledger,
    ptoStats: ptoStats, today: today,
    travelCtx: getTravelContextForPlanner_(),
    planHistory: readPlannerHistory_(),
  });
  Logger.log('PROMPT (' + prompt.length + ' chars):\n' + prompt);
  Logger.log('=== testWeekendPlannerPrompt: END ===');
}
