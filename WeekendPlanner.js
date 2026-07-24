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
  var weekendCal      = getWeekendCalendarEvents_();
  var weekendCapacity = classifyWeekend_(weekendCal, travelCtx);

  Logger.log('runWeekendPlanner_: weekendCapacity.type=' + weekendCapacity.type +
             ', eventCount=' + weekendCapacity.eventCount);

  var prompt = buildWeekendPlannerPrompt_({
    windows:          windows,
    events:           events,
    tasks:            tasks,
    intensity:        intensity,
    goals:            goals,
    ledger:           ledger,
    ptoStats:         ptoStats,
    today:            today,
    travelCtx:        travelCtx,
    planHistory:      planHistory,
    weekendCal:       weekendCal,
    weekendCapacity:  weekendCapacity,
  });

  var claudeResult = callClaudeWeekendPlanner_(prompt);
  if (!claudeResult) {
    Logger.log('runWeekendPlanner_: no result returned from Claude, aborting');
    veraLog_('runWeekendPlanner', 'Planning', 'Failed', 'No result returned from Claude', Date.now() - _wpStart);
    return;
  }
  var memo       = claudeResult.memo || '';
  var activities = claudeResult.activities || [];
  if (!memo) {
    Logger.log('runWeekendPlanner_: empty memo in Claude response, aborting');
    veraLog_('runWeekendPlanner', 'Planning', 'Failed', 'Empty memo in Claude response', Date.now() - _wpStart);
    return;
  }

  // Save history immediately after Claude generates the memo, before any delivery
  // steps that could throw — ensures anti-repeat context is always recorded.
  writePlannerHistory_(memo, activities);

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
    intensitySection += '\n⚠️ High intensity week — the outing suggestion should lean toward rest and low-effort, not more activity.';
  }

  // ---- Ledger section --------------------------------------------------------
  var capForLedger    = ctx.weekendCapacity || { type: 'open' };
  var isAwayWeekend   = capForLedger.type === 'traveling' || capForLedger.type === 'pre_major_trip';
  var destLabelLower  = (tCtx.currentTrip ? String(tCtx.currentTrip.label || '') : '').toLowerCase();
  var ledgerEntries   = Array.isArray(ctx.ledger) ? ctx.ledger : [];
  var ledgerSection   = ledgerEntries.length === 0
    ? 'No interests logged yet.'
    : ledgerEntries.map(function(i) {
        return '- ' + i.person + ': ' + i.interest + ' [' + i.category + ', logged ' + i.date + ']';
      }).join('\n');

  // Instruction header appended to the ledger so Claude knows the filtering rules
  var ledgerContextNote;
  if (capForLedger.type === 'traveling') {
    ledgerContextNote =
      '\nUSAGE RULE (traveling): Only reference interests that are directly achievable at ' +
      (tCtx.currentTrip ? tCtx.currentTrip.label : 'the current destination') +
      '. Skip any interest tied to a different location, language, home project, or business goal. ' +
      '"Learn French" is only relevant if the destination is France or a French-speaking region. ' +
      '"eBay store" is not relevant on vacation anywhere. Apply this logic to every item.';
  } else if (capForLedger.type === 'pre_major_trip') {
    ledgerContextNote =
      '\nUSAGE RULE (pre-departure): Avoid referencing business goals, learning programs, or anything requiring multi-session commitment. ' +
      'Only light, local interests are relevant this weekend.';
  } else if (capForLedger.type === 'house_guests') {
    ledgerContextNote =
      '\nUSAGE RULE (house guests): Prefer interests that work in a social setting or that guests can share. ' +
      'Skip solo learning interests, business goals, or anything that requires Ahmed to be alone.';
  } else {
    ledgerContextNote =
      '\nUSAGE RULE: Reference interests that are genuinely achievable this weekend. ' +
      'Language-learning interests are only relevant if there is a connection to the activity being suggested — ' +
      'do not surface "learn French" unless the suggestion directly involves French language, cuisine, or culture. ' +
      'Business and development interests are only relevant if the task paragraph is included.';
  }
  ledgerSection += ledgerContextNote;

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
  var cap  = ctx.weekendCapacity || { type: 'open', note: '' };

  var travelLines = ['=== TRAVEL CONTEXT ==='];
  if (tCtx.currentTrip) {
    var ct = tCtx.currentTrip;
    var endParts = String(ct.endDate || '').split('-');
    var endDateObj = new Date(parseInt(endParts[0], 10), parseInt(endParts[1], 10) - 1, parseInt(endParts[2], 10));
    var endDateFmt = Utilities.formatDate(endDateObj, tz, 'MMM d');
    travelLines.push('Ahmed is currently traveling: ' + ct.label + ' (through ' + endDateFmt + ').');
    travelLines.push('CRITICAL: Do NOT suggest anything at home or requiring Ahmed to be home. Every suggestion must be at or near ' + ct.label + '.');
    if (tCtx.currentTripOnBucketList) {
      travelLines.push('★ This destination is on Ahmed\'s bucket list.');
    }
  } else {
    travelLines.push('Ahmed is home this weekend.');
  }
  if (tCtx.upcomingTrips && tCtx.upcomingTrips.length > 0) {
    tCtx.upcomingTrips.forEach(function(t) {
      travelLines.push('Upcoming trip: ' + t.label + ' departs in ' + t.daysAway + ' day(s).');
    });
  }
  var travelBlock = travelLines.join('\n');

  // ---- Block B: Bucket list — ONLY when traveling AND geographically matching -
  // Never surface at home: the match between home weekends and bucket list
  // destinations is too loose and leads to forced, irrelevant suggestions.
  var bucketBlock = '';
  if (tCtx.currentTrip) {
    var destLabel = String(tCtx.currentTrip.label || '').toLowerCase();
    var bList = (tCtx.bucketList || []).filter(function(b) {
      var city    = String(b['City']    || '').toLowerCase();
      var country = String(b['Country'] || '').toLowerCase();
      return (city    && destLabel.indexOf(city)    !== -1) ||
             (country && destLabel.indexOf(country) !== -1);
    });
    if (bList.length > 0) {
      var bLines = [
        '=== BUCKET LIST ITEMS AT THIS DESTINATION ===',
        'These are items on Ahmed\'s bucket list that match the current destination. Reference them specifically if they are directly achievable this weekend.',
      ];
      bList.forEach(function(b) {
        var starCount = Math.min(5, Math.max(1, Number(b['Stars']) || 1));
        var stars = '';
        for (var s = 0; s < starCount; s++) stars += '★';
        var line = stars + ' ' + b['City'] + ', ' + b['Country'];
        if (b['Dream Trip']) line += ' — ' + b['Dream Trip'];
        bLines.push(line);
      });
      bucketBlock = bLines.join('\n');
    }
  }

  // ---- Block C: Anti-recycle history -----------------------------------------
  var historyBlock = '';
  var history = ctx.planHistory || [];
  var allPastActivities = [];
  history.forEach(function(h) {
    (h.activities || []).forEach(function(a) {
      if (a && allPastActivities.indexOf(a) === -1) allPastActivities.push(a);
    });
  });
  if (allPastActivities.length > 0) {
    historyBlock =
      '=== RECENTLY SUGGESTED ACTIVITIES — DO NOT REPEAT, REPHRASE, OR SUGGEST NEARBY VARIANTS ===\n' +
      allPastActivities.map(function(a) { return '- ' + a; }).join('\n');
  }

  // ---- Weekend calendar block ------------------------------------------------
  var weekendCalSection = (ctx.weekendCal && ctx.weekendCal.length > 0)
    ? ctx.weekendCal.join('\n')
    : 'Nothing scheduled — both days appear clear.';

  // ---- Output instructions ---------------------------------------------------
  var sat = computeNextSaturday_(ctx.today);
  var satStr = Utilities.formatDate(sat, tz, 'MMM d');

  var travelNote = '';
  if (ctx.travelCtx && ctx.travelCtx.currentTrip) {
    travelNote = 'Ahmed is currently traveling — ' + ctx.travelCtx.currentTrip.label +
      '. ALL suggestions must be grounded in that destination. Do NOT suggest anything at home or requiring Ahmed to be home.\n\n';
  }

  var outputInstructions =
    'Write a Weekend Memo for the weekend of ' + satStr + '.\n\n' +
    travelNote +
    // ---- Capacity-specific instructions ----------------------------------------
    (function() {
      var capType = cap.type;
      var lines = [
        'FORMAT: 2–3 paragraphs of prose. No section labels. No headers. No bullets. No lists.',
        '',
        '=== WEEKEND STATE: ' + capType.toUpperCase() + ' ===',
        cap.note,
        '',
      ];

      // Paragraph 1 — always required
      lines.push(
        'PARAGRAPH 1 — MINDSET (always present, always first):',
        'Acknowledge what the week was and what the weekend should be. Use what VERA knows — but write in human terms, not a status report. Do NOT cite numbers ("N flags", "N overdue tasks"). Instead name the actual thing: a specific run of meetings, a specific project that has been sitting. 2–3 sentences.',
        ''
      );

      // Paragraph 2 — task — conditional on capacity
      if (capType === 'traveling' || capType === 'busy' || capType === 'pre_major_trip') {
        lines.push(
          'PARAGRAPH 2 — TASK: OMIT.',
          'Do not include a productivity suggestion. Weekend capacity does not support it.',
          ''
        );
      } else {
        lines.push(
          'PARAGRAPH 2 — THE ONE THING (optional — omit entirely if not warranted):',
          'Include ONLY if there is a self-contained task that: (a) can be meaningfully advanced in 1–2 hours at home, (b) is genuinely overdue or tied to a stated goal, AND (c) fits this weekend given what is already on the calendar. If no such task exists, skip this paragraph. Do not manufacture one.',
          'When included: name the goal, name the specific action, say why this weekend not next.',
          ''
        );
      }

      // Paragraph 3 — outing — shaped by capacity type
      lines.push('PARAGRAPH 3 — WHAT TO DO (always present, always last):');
      if (capType === 'traveling') {
        lines.push(
          'One specific suggestion at or near the current destination (' + (tCtx.currentTrip ? tCtx.currentTrip.label : 'destination') + ').',
          'Do NOT suggest anything at home or requiring travel back. Reference the actual destination — its neighborhoods, culture, food, or geography.',
          'If a matching bucket list item exists (see above), you may reference it specifically.'
        );
      } else if (capType === 'pre_major_trip') {
        lines.push(
          'Something very short, local, and low-energy — under 2 hours, close to home. The weekend is pre-departure. Packing, logistics, and mental prep take priority.',
          'Do not suggest anything ambitious, a full-day trip, or anything that adds logistical complexity.'
        );
      } else if (capType === 'house_guests') {
        lines.push(
          'Something that works with guests — social, low-logistics, near home.',
          'Do not suggest solo activities, distant day trips, or anything that separates Ahmed from the guests.'
        );
      } else if (capType === 'busy') {
        lines.push(
          'The weekend is already full. If there is a genuine gap (see THIS WEEKEND\'S CALENDAR), suggest one very brief, low-friction thing to fill it. If there is no real gap, acknowledge the weekend is spoken for and skip any outing suggestion — the memo may end after paragraph 1.'
        );
      } else {
        lines.push(
          'One specific place, outing, or activity. It must:',
          '• Be appropriate for the current season and conditions (today is ' + todayStr + ')',
          '• Not appear in the recent suggested-activities history',
          '• Be distance-appropriate (easy Sunday morning = 20–40 min away; half-day = further is fine)',
          '• Connect naturally to a stated interest or goal — not forced',
          '• Be grounded in THIS specific weekend: say what makes now the right time',
          'Do not suggest anything already on the weekend calendar.'
        );
      }

      lines.push(
        '',
        'VOICE: warm, direct, specific. Trusted advisor who knows Ahmed well — not a corporate brief, not a travel blog. Short sentences. No padding.',
        '',
        'TARGET LENGTH: 150–250 words. Longer only if the specificity earns it.',
        '',
        'Return ONLY valid JSON — no preamble, no markdown fences:',
        '{',
        '  "memo": "Full memo text — the paragraphs, with a \'Weekend Memo — ' + satStr + '\' header on the first line",',
        '  "activities": ["Exact name of each place or activity suggested — used for anti-repeat tracking"]',
        '}'
      );

      return lines.join('\n');
    })();

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
    '',
    '=== THIS WEEKEND\'S CALENDAR (' + satStr + '–' + Utilities.formatDate(new Date(sat.getTime() + 86400000), tz, 'MMM d') + ') ===',
    weekendCalSection,
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
 * Returns { memo: string, activities: string[] } or null on failure.
 *
 * @param {string} prompt
 * @returns {{ memo: string, activities: string[] }|null}
 */
function callClaudeWeekendPlanner_(prompt) {
  var result = callClaudeJson_(prompt, null);
  if (!result || typeof result !== 'object' || !result.memo) return null;
  if (!Array.isArray(result.activities)) result.activities = [];
  return result;
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
 * Reads planner history from Script Properties.
 * Returns an array of { date, activities: string[] } entries.
 * Handles both old format ({ date, text }) and new format ({ date, activities }).
 *
 * @returns {Array} [{ date, activities: string[] }]
 */
function readPlannerHistory_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('WKND_PLAN_HISTORY');
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 24).map(function(entry) {
      if (Array.isArray(entry.activities)) return entry;
      // Migrate old { date, text } format — no activity extraction possible
      return { date: entry.date || '', activities: [] };
    });
  } catch (e) {
    Logger.log('readPlannerHistory_: error: ' + e.message);
    return [];
  }
}

/**
 * Prepends the current plan to WKND_PLAN_HISTORY, keeping last 24 entries (~6 months).
 * Stores compact { date, activities[] } rather than full memo text.
 * Called only after successful plan delivery — not on Claude failure.
 *
 * @param {string}   planText   — full memo text (for legacy callers)
 * @param {string[]} activities — suggested activity/place names from Claude JSON response
 */
function writePlannerHistory_(planText, activities) {
  try {
    var dateLabel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy');
    var existing  = readPlannerHistory_();
    var entry     = {
      date:       dateLabel,
      activities: Array.isArray(activities) ? activities : [],
    };
    var updated = [entry].concat(existing).slice(0, 24);
    PropertiesService.getScriptProperties().setProperty('WKND_PLAN_HISTORY', JSON.stringify(updated));
    Logger.log('writePlannerHistory_: saved ' + updated.length + ' entries (' + entry.activities.length + ' activities this week)');
  } catch (e) {
    Logger.log('writePlannerHistory_: error: ' + e.message);
  }
}

// ============================================================
// WEEKEND CAPACITY CLASSIFIER
// ============================================================

/**
 * classifyWeekend_(weekendCal, travelCtx)
 *
 * Reads the weekend's actual state before the memo is drafted.
 * Returns a capacity object the prompt uses to decide what kind of memo to write.
 *
 * Types:
 *   'traveling'      — Ahmed is currently on a trip; all suggestions must be at the destination
 *   'pre_major_trip' — A trip departs within 4 days of the weekend; this weekend is pre-departure
 *   'house_guests'   — Calendar signals guests or family visitors; social/near-home suggestions
 *   'busy'           — 4+ events on the weekend calendar; suggest nothing ambitious
 *   'light'          — 1–3 events; one meaningful suggestion appropriate
 *   'open'           — No events; full latitude
 *
 * @param {string[]} weekendCal  — output of getWeekendCalendarEvents_()
 * @param {Object}   travelCtx   — output of getTravelContextForPlanner_()
 * @returns {{ type, eventCount, preTripLabel, preTripDaysAway, hasHouseGuests, note }}
 */
function classifyWeekend_(weekendCal, travelCtx) {
  var result = {
    type:             'open',
    eventCount:       (weekendCal || []).length,
    preTripLabel:     null,
    preTripDaysAway:  null,
    hasHouseGuests:   false,
    note:             '',
  };

  // 1. Currently traveling → destination-only
  if (travelCtx && travelCtx.currentTrip) {
    result.type = 'traveling';
    result.note = 'Ahmed is traveling: ' + travelCtx.currentTrip.label +
      '. Every suggestion must be grounded in that destination and its immediate surroundings.';
    return result;
  }

  // 2. Major trip departing within 4 days of the weekend (Mon–Thu after Sunday)
  var upcoming = (travelCtx && travelCtx.upcomingTrips) ? travelCtx.upcomingTrips : [];
  var preTripMatch = null;
  upcoming.forEach(function(t) {
    if (t.daysAway !== undefined && t.daysAway <= 4) {
      if (!preTripMatch || t.daysAway < preTripMatch.daysAway) preTripMatch = t;
    }
  });
  if (preTripMatch) {
    result.type            = 'pre_major_trip';
    result.preTripLabel    = preTripMatch.label;
    result.preTripDaysAway = preTripMatch.daysAway;
    result.note = 'Trip to "' + preTripMatch.label + '" departs in ' + preTripMatch.daysAway +
      ' day(s). This weekend is pre-departure: suggest only something short, local, and low-energy. Packing and prep take priority. Do not suggest anything ambitious or time-consuming.';
    return result;
  }

  // 3. House guests — scan calendar event titles for guest/family signals
  var guestKeywords = ['guest', 'guests', 'family', 'visit', 'visiting', 'stay', 'in-law',
                       'parents', 'sister', 'brother', 'cousin', 'eraky', 'hosting'];
  var calEvents = weekendCal || [];
  calEvents.forEach(function(ev) {
    var lower = ev.toLowerCase();
    guestKeywords.forEach(function(kw) {
      if (lower.indexOf(kw) !== -1) result.hasHouseGuests = true;
    });
  });
  if (result.hasHouseGuests) {
    result.type = 'house_guests';
    result.note = 'Calendar signals house guests or family visitors this weekend. Suggestions should work with — not around — guests: social, local, low-logistics.';
    return result;
  }

  // 4. Capacity by event count
  var count = result.eventCount;
  if (count >= 4) {
    result.type = 'busy';
    result.note = 'The weekend already has ' + count + ' calendar events. Do not add more. If the weekend is this full, the memo may simply acknowledge it is spoken for and offer one very brief, low-friction note — or no outing suggestion at all.';
  } else if (count >= 1) {
    result.type = 'light';
    result.note = 'Weekend has ' + count + ' event(s). Room for one well-chosen suggestion that fits around what is already there.';
  } else {
    result.type = 'open';
    result.note = 'Weekend is clear — no calendar commitments. Full latitude for a meaningful suggestion.';
  }

  return result;
}

// ============================================================
// WEEKEND CALENDAR
// ============================================================

/**
 * Returns a flat list of calendar events for the upcoming Saturday and Sunday.
 * Used in the prompt so Claude knows what's already committed before making suggestions.
 *
 * @returns {string[]} e.g. ["Saturday · Family lunch (1:00 PM – 3:00 PM)", "Sunday · all day"]
 */
function getWeekendCalendarEvents_() {
  try {
    var tz  = Session.getScriptTimeZone();
    var sat = computeNextSaturday_(new Date());
    var mon = new Date(sat.getTime() + 2 * 24 * 60 * 60 * 1000);
    mon.setHours(0, 0, 0, 0);
    var sun = new Date(sat.getTime() + 24 * 60 * 60 * 1000);

    var results = [];
    var cals    = CalendarApp.getAllCalendars();
    cals.forEach(function(cal) {
      try {
        cal.getEvents(sat, mon).forEach(function(ev) {
          var title    = ev.getTitle() || '(untitled)';
          var dayLabel = ev.getStartTime() < sun ? 'Saturday' : 'Sunday';
          var timeStr;
          if (ev.isAllDayEvent()) {
            timeStr = 'all day';
          } else {
            timeStr = Utilities.formatDate(ev.getStartTime(), tz, 'h:mm a');
            var endT = Utilities.formatDate(ev.getEndTime(), tz, 'h:mm a');
            if (endT && endT !== timeStr) timeStr += ' – ' + endT;
          }
          results.push(dayLabel + ' · ' + title + ' (' + timeStr + ')');
        });
      } catch (calErr) {/* skip inaccessible calendars */}
    });

    return results;
  } catch (e) {
    Logger.log('getWeekendCalendarEvents_ error (non-fatal): ' + e.message);
    return [];
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
