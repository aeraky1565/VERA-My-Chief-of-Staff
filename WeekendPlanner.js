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
//   weekend_planner_narrative_calendars — comma-separated calendar names allowed
//     to shape the memo's prose/events list (default "Ahmed ElEraky,aaeleraky@gmail.com,
//     AE&VV - Our Joint Chaos"). Other calendars are still used for scheduling
//     awareness (capacity/intensity, window detection) but never described in the memo.
// ============================================================

// ============================================================
// MAIN ORCHESTRATOR
// ============================================================

/**
 * Restricts events to calendars whose content should shape the memo's
 * narrative — the user's own calendar(s) and the shared household one — as
 * opposed to every calendar VERA can see for scheduling awareness. A
 * "conference trip" or similar from an unrelated calendar (extended family,
 * work calendars other than the user's own) must never be woven into the
 * memo's prose as if it's the user's business; those calendars stay visible
 * to capacity/intensity classification and window detection, just not to
 * what Claude writes about.
 *
 * Config-driven via weekend_planner_narrative_calendars (comma-separated
 * calendar names, case-insensitive exact match against event.calendarName).
 * Fails open (returns the unfiltered list) if the config value is somehow
 * empty — an empty memo is worse than an over-broad one.
 *
 * @param {Array}  events  From getUpcomingEvents() — every calendar
 * @param {Object} cfg     From getConfigValues()
 * @returns {Array} events whose calendarName is in the allowed list
 */
function filterToNarrativeCalendars_(events, cfg) {
  var raw = String(
    (cfg && cfg['weekend_planner_narrative_calendars']) ||
    'Ahmed ElEraky,aaeleraky@gmail.com,AE&VV - Our Joint Chaos'
  );
  var allowed = raw.split(',')
    .map(function(s) { return s.trim().toLowerCase(); })
    .filter(function(s) { return s; });
  if (allowed.length === 0) return events;

  return events.filter(function(ev) {
    return allowed.indexOf(String(ev.calendarName || '').toLowerCase()) !== -1;
  });
}

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

  // events is intentionally kept broad — every calendar VERA can see — because
  // computeIntensitySignal_() below is a scheduling-awareness use (how full is
  // the week), not a narrative one. narrativeEvents is the narrower set that
  // actually gets described in the memo's prose and events list; see
  // filterToNarrativeCalendars_ for why the split exists.
  var events          = getUpcomingEvents(21);
  var narrativeEvents = filterToNarrativeCalendars_(events, cfg);
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
             ', events=' + events.length + ' (narrative-scoped: ' + narrativeEvents.length + ')' +
             ', tasks=' + tasks.length +
             ', flags=' + activeFlags.length +
             ', intensity=' + intensity.level);

  // ---- Fetch contextual sections (weather, events, continuity) ---------------
  var homeCity    = String(cfg['weekend_planner_home_city'] || '').trim();
  var weatherData = getWeekendWeather_(homeCity);
  var localEvents = searchLocalEvents_(homeCity);
  var carryNote   = getCarryForwardNote_();
  var radarDates  = getRadarDatesForWeekendMemo_(14);

  Logger.log('runWeekendPlanner_: weatherData=' + (weatherData ? 'ok' : 'null') +
             ', localEvents=' + localEvents.length +
             ', carryNote=' + (carryNote ? 'yes' : 'none') +
             ', radarDates=' + radarDates.length);

  // ---- Build prompt + call Claude -------------------------------------------
  var weekendCal      = getWeekendCalendarEvents_();
  var weekendCapacity = classifyWeekend_(weekendCal, travelCtx);

  Logger.log('runWeekendPlanner_: weekendCapacity.type=' + weekendCapacity.type +
             ', eventCount=' + weekendCapacity.eventCount);

  var prompt = buildWeekendPlannerPrompt_({
    windows:          windows,
    events:           narrativeEvents,
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
    weatherData:      weatherData,
    localEvents:      localEvents,
    carryNote:        carryNote,
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

  // ---- Assemble full calendar description ------------------------------------
  // description keeps the full plain-text content — it's the record on the
  // calendar event and the email's plain-text fallback part.
  var description = assembleWeekendMemoText_(memo, weatherData, carryNote, localEvents, radarDates);

  // ---- Deliver ---------------------------------------------------------------
  // 1. Calendar event first — its htmlLink is what the email links back to.
  var saturday = (windows.length > 0 && windows[0].weekendStart)
    ? parseDateStr_(windows[0].weekendStart)
    : computeNextSaturday_(today);
  var calendarLink = createWeekendMemoEvent_(saturday, description);
  Logger.log('runWeekendPlanner_: calendar event created on ' +
             Utilities.formatDate(saturday, Session.getScriptTimeZone(), 'yyyy-MM-dd') +
             (calendarLink ? '' : ' (no link returned)'));

  // 2. Polished HTML email — the primary read surface. description is the
  // plain-text fallback for clients that don't render HTML.
  var htmlBody = buildWeekendMemoHtml_(memo, weatherData, carryNote, localEvents, radarDates,
                                        weekendCapacity, saturday, calendarLink);
  MailApp.sendEmail(CONFIG.MORNING_NUDGE_EMAIL, 'VERA: Weekend Memo', description,
                     { name: 'VERA', htmlBody: htmlBody });
  Logger.log('runWeekendPlanner_: HTML email sent (' + htmlBody.length + ' chars)');

  // 3. Short Slack ping — points at the email rather than duplicating it.
  if (isSlackConfigured_()) {
    var pingDelivered = sendSlack_('vera-notifications', '🗓️ Weekend memo is ready — check your email.');
    Logger.log('runWeekendPlanner_: Slack ping ' + (pingDelivered ? 'sent' : 'FAILED'));
  }

  // Bypassing sendNudge_ for this dual-channel delivery, so record the
  // cooldown/history entry directly — same dedup contract as before.
  markSent_('weekend_planner', description);

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

  // Hoisted from "Block A: Travel context" below — the ledger section needs it
  // first. Referencing tCtx before this line used to crash every single run
  // (var hoisting gives you the declaration but not the assignment), which is
  // why the memo never generated: "Cannot read properties of undefined
  // (reading 'currentTrip')".
  var tCtx = ctx.travelCtx || {};

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
  // tCtx is hoisted to the top of the function — the ledger section above needs it too.
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

  // ---- Weather context -------------------------------------------------------
  if (ctx.weatherData) {
    var wLines = [];
    if (ctx.weatherData.sat) {
      var sw = ctx.weatherData.sat;
      var swLine = 'Saturday: ' + sw.temp + '°F, ' + sw.condition;
      if (sw.feelsLike && sw.feelsLike !== sw.temp) swLine += ', feels like ' + sw.feelsLike + '°';
      if (sw.note) swLine += ' — ' + sw.note;
      wLines.push(swLine);
    }
    if (ctx.weatherData.sun) {
      var uw = ctx.weatherData.sun;
      var uwLine = 'Sunday: ' + uw.temp + '°F, ' + uw.condition;
      if (uw.feelsLike && uw.feelsLike !== uw.temp) uwLine += ', feels like ' + uw.feelsLike + '°';
      if (uw.stormNote) uwLine += ' — ' + uw.stormNote;
      wLines.push(uwLine);
    }
    if (wLines.length > 0) {
      sections.push('');
      sections.push('=== THIS WEEKEND\'S WEATHER ===');
      sections.push(wLines.join('\n'));
      if (ctx.weatherData.sun && ctx.weatherData.sun.stormNote) {
        sections.push('Important: Sunday outdoor window is limited. Factor this into your outing timing suggestion.');
      }
    }
  }

  // ---- Continuity from last week --------------------------------------------
  if (ctx.carryNote) {
    sections.push('');
    sections.push('=== CONTINUITY FROM LAST WEEK ===');
    sections.push(ctx.carryNote);
    sections.push('If this activity still fits the weekend and capacity supports it, reference it naturally in paragraph 3. Do not force it.');
  }

  // ---- Local events context -------------------------------------------------
  if (ctx.localEvents && ctx.localEvents.length > 0) {
    sections.push('');
    sections.push('=== LOCAL EVENTS THIS WEEKEND ===');
    sections.push('(Real events nearby — mention one if it genuinely fits interests or capacity. Do not fabricate details.)');
    sections.push(ctx.localEvents.map(function(ev) {
      return ev.day + ' · ' + ev.title + (ev.detail ? ' — ' + ev.detail : '');
    }).join('\n'));
  }

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
 * Creates the "VERA Weekend Memo" all-day calendar event via the Advanced
 * Calendar Service (Calendar.Events.insert, already enabled — appsscript.json)
 * rather than basic CalendarApp — this returns the event's htmlLink directly
 * in the response, which the HTML email links back to. CalendarApp's
 * createAllDayEvent gives no link, and bridging its event ID over to the
 * Advanced Service afterward is an avoidable GAS interop quirk.
 *
 * @param {Date}   saturdayDate
 * @param {string} memo  Full plain-text calendar description (unchanged content)
 * @returns {string|null} the event's htmlLink, or null if creation failed
 */
function createWeekendMemoEvent_(saturdayDate, memo) {
  clearOldWeekendMemoEvents_();

  var ptoCfg = readPTOConfig_();
  var cal    = getCalendarByName_(ptoCfg.veraCalendarName);
  if (!cal) {
    Logger.log('createWeekendMemoEvent_: "' + ptoCfg.veraCalendarName + '" calendar not found — skipping event creation');
    return null;
  }

  var tz         = Session.getScriptTimeZone();
  var dateStr    = Utilities.formatDate(saturdayDate, tz, 'yyyy-MM-dd');
  // All-day events use an EXCLUSIVE end date (the day after the last day),
  // per the Calendar API — for a single-day event that's saturdayDate + 1.
  var nextDayStr = Utilities.formatDate(new Date(saturdayDate.getTime() + 86400000), tz, 'yyyy-MM-dd');

  try {
    var created = Calendar.Events.insert({
      summary:     'VERA Weekend Memo',
      description: memo,
      start: { date: dateStr },
      end:   { date: nextDayStr },
    }, cal.getId());

    Logger.log('createWeekendMemoEvent_: event created in "' + ptoCfg.veraCalendarName + '" on ' + dateStr);
    return created.htmlLink || null;
  } catch (e) {
    Logger.log('createWeekendMemoEvent_ error: ' + e.message);
    return null;
  }
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
// CONTEXTUAL DATA — Weather, Local Events, Continuity
// ============================================================

/**
 * Fetches OWM 5-day forecast and extracts Saturday + Sunday data.
 * Returns { sat: {temp, feelsLike, condition, note}, sun: {temp, feelsLike, condition, stormNote} }
 * or null if no API key / fetch fails.
 *
 * @param {string} homeCity
 * @returns {{sat, sun}|null}
 */
function getWeekendWeather_(homeCity) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('WEATHER_API_KEY');
    if (!apiKey || !homeCity) return null;

    var coords = geocodeLocation_(homeCity, apiKey);
    if (!coords) return null;

    var url = 'https://api.openweathermap.org/data/2.5/forecast?' +
              'lat=' + coords.lat + '&lon=' + coords.lon +
              '&appid=' + encodeURIComponent(apiKey) +
              '&units=imperial&cnt=40';
    var resp = fetchWithHealth_('openweathermap', url);
    if (!resp) return null;   // failure already recorded by the wrapper
    var data = JSON.parse(resp.getContentText());
    if (!data || !data.list || data.list.length === 0) return null;

    var tz  = Session.getScriptTimeZone();
    var sat = computeNextSaturday_(new Date());
    var sun = new Date(sat.getTime() + 86400000);
    var satStr = Utilities.formatDate(sat, tz, 'yyyy-MM-dd');
    var sunStr = Utilities.formatDate(sun, tz, 'yyyy-MM-dd');

    var satEntries = [], sunEntries = [];
    data.list.forEach(function(entry) {
      var localDate = Utilities.formatDate(new Date(entry.dt * 1000), tz, 'yyyy-MM-dd');
      if (localDate === satStr) satEntries.push(entry);
      else if (localDate === sunStr) sunEntries.push(entry);
    });

    if (satEntries.length === 0 && sunEntries.length === 0) return null;

    function closestToHour(entries, targetHour) {
      if (!entries || entries.length === 0) return null;
      var best = entries[0], bestDiff = 999;
      entries.forEach(function(e) {
        var h = parseInt(Utilities.formatDate(new Date(e.dt * 1000), tz, 'H'), 10);
        var diff = Math.abs(h - targetHour);
        if (diff < bestDiff) { bestDiff = diff; best = e; }
      });
      return best;
    }

    var result = { sat: null, sun: null };

    if (satEntries.length > 0) {
      var satNoon    = closestToHour(satEntries, 12);
      var satEarly   = closestToHour(satEntries, 9);
      var satEvening = closestToHour(satEntries, 18);
      if (satNoon) {
        var satTemp   = Math.round(satNoon.main.temp);
        var satFeels  = Math.round(satNoon.main.feels_like);
        var satCond   = (satNoon.weather && satNoon.weather[0]) ? satNoon.weather[0].main : '';
        var satNote   = '';
        if (satEarly) {
          var earlyTemp = Math.round(satEarly.main.temp);
          var earlyRain = Math.round((satEarly.pop || 0) * 100);
          if (earlyTemp >= 90 || earlyRain >= 30) satNote = 'Better in the morning';
        }
        if (satEvening) {
          var eveRain = Math.round((satEvening.pop || 0) * 100);
          if (eveRain < 20) satNote = satNote ? satNote + ' · Evening clears' : 'Evening clears';
        }
        result.sat = { temp: satTemp, feelsLike: satFeels, condition: satCond, note: satNote };
      }
    }

    if (sunEntries.length > 0) {
      var sunNoon      = closestToHour(sunEntries, 12);
      var sunAfternoon = closestToHour(sunEntries, 15);
      if (sunNoon) {
        var sunTemp   = Math.round(sunNoon.main.temp);
        var sunFeels  = Math.round(sunNoon.main.feels_like);
        var sunCond   = (sunNoon.weather && sunNoon.weather[0]) ? sunNoon.weather[0].main : '';
        var sunStorm  = '';
        if (sunAfternoon) {
          var aftRain = Math.round((sunAfternoon.pop || 0) * 100);
          if (aftRain >= 40) sunStorm = 'Storms likely after 2pm — morning is the outdoor window';
          else if (aftRain >= 20) sunStorm = 'Possible afternoon showers';
        }
        result.sun = { temp: sunTemp, feelsLike: sunFeels, condition: sunCond, stormNote: sunStorm };
      }
    }

    return (result.sat || result.sun) ? result : null;
  } catch (e) {
    Logger.log('getWeekendWeather_ error: ' + e.message);
    return null;
  }
}

/**
 * Heuristic check for scraped-listing-page junk in a search result title/snippet —
 * markdown link syntax, heading markers, or a density of special characters that
 * signals raw page markup rather than a single event's plain-text description.
 * Real single-event snippets (e.g. "Wolf Trap: James Taylor · Gates 5PM · $65")
 * don't trip this; aggregator-page snippets like
 * "by Guys & Girls (20s & 30s) Going Out Group]( Reston Plays Games ### ..." do.
 *
 * @param {string} text
 * @returns {boolean} true if the text looks like scraped junk, not a clean snippet
 */
function looksLikeScrapedJunk_(text) {
  if (!text) return true;
  if (text.indexOf('](') !== -1) return true;          // markdown link syntax
  if (/#{2,}/.test(text)) return true;                  // ## / ### heading markers
  // 3+ occurrences of markup characters signals scraped page structure (nav
  // markers, repeated headings) — a single stray character ("Ranked #1...")
  // is normal prose and must not trip this.
  var specialChars = (text.match(/[#\[\]{}|*_~`]/g) || []).length;
  if (specialChars >= 3 && specialChars / text.length > 0.03) return true;
  return false;
}

/**
 * Searches for local events this weekend via doWebSearch_().
 * Returns [] if VERA_SEARCH_API_KEY is not configured, or if every candidate
 * result looks like scraped listing-page junk rather than a clean, single-event
 * description (Issue: a garbled result was worse than no section at all).
 *
 * @param {string} homeCity
 * @returns {Array} [{ day, title, detail }]
 */
function searchLocalEvents_(homeCity) {
  try {
    if (!homeCity) return [];
    var raw = doWebSearch_('events in ' + homeCity + ' this weekend');
    if (!raw || raw.length === 0) return [];

    var events = [];
    raw.slice(0, 3).forEach(function(r) {
      var title  = String(r.title  || '').replace(/\s+/g, ' ').trim().substring(0, 90);
      var detail = String(r.snippet || '').replace(/\s+/g, ' ').trim().substring(0, 130);
      if (!title) return;
      if (looksLikeScrapedJunk_(title) || looksLikeScrapedJunk_(detail)) {
        Logger.log('searchLocalEvents_: rejected junk result — "' + title + '"');
        return;
      }
      var combined = (title + ' ' + detail).toLowerCase();
      var day = 'Weekend';
      if (combined.indexOf('saturday') !== -1) day = 'Sat';
      else if (combined.indexOf('sunday') !== -1) day = 'Sun';
      events.push({ day: day, title: title, detail: detail });
    });
    return events;
  } catch (e) {
    Logger.log('searchLocalEvents_ error: ' + e.message);
    return [];
  }
}

/**
 * Checks whether last week's suggested activities appeared on the prior weekend's calendar.
 * Returns a carry-forward string for activities with no calendar match, or null if all matched.
 *
 * @returns {string|null}
 */
function getCarryForwardNote_() {
  try {
    var history = readPlannerHistory_();
    if (!history || history.length === 0) return null;

    var priorActivities = (history[0].activities || []).filter(function(a) { return !!a; });
    if (priorActivities.length === 0) return null;

    // Scan the prior weekend's calendar (last Saturday + Sunday)
    var tz = Session.getScriptTimeZone();
    var thisSat  = computeNextSaturday_(new Date());
    var priorSat = new Date(thisSat.getTime() - 7 * 24 * 60 * 60 * 1000);
    var priorMon = new Date(priorSat.getTime() + 2 * 24 * 60 * 60 * 1000);
    priorMon.setHours(0, 0, 0, 0);

    var calTitles = [];
    CalendarApp.getAllCalendars().forEach(function(cal) {
      try {
        cal.getEvents(priorSat, priorMon).forEach(function(ev) {
          var t = (ev.getTitle() || '').toLowerCase().trim();
          if (t) calTitles.push(t);
        });
      } catch (e) { /* skip inaccessible calendars */ }
    });

    var missed = priorActivities.filter(function(activity) {
      var actLower = activity.toLowerCase().trim();
      return !calTitles.some(function(calTitle) {
        return calTitle.indexOf(actLower) !== -1 || actLower.indexOf(calTitle) !== -1;
      });
    });

    if (missed.length === 0) return null;

    var names = missed.join(' and ');
    var verb  = missed.length === 1 ? 'was' : 'were';
    return names + ' ' + verb + ' suggested last week — no record on the calendar. Worth revisiting if timing works.';
  } catch (e) {
    Logger.log('getCarryForwardNote_ error: ' + e.message);
    return null;
  }
}

/**
 * Reads the Important Dates sheet and returns entries falling within the next N days.
 * Sorted by ascending date.
 *
 * @param {number} days
 * @returns {Array} [{ dateLabel, label, person, daysAway }]
 */
/**
 * Adapts the canonical getUpcomingImportantDates_() (ImportantDates.js) to the
 * { date, dateLabel, label, person, daysAway } shape formatRadarBlock_() expects.
 *
 * WeekendPlanner.js used to carry its own divergent reimplementation of
 * getUpcomingImportantDates_ — same name as the one in ImportantDates.js, a
 * silent collision in GAS's shared global namespace (undefined behavior over
 * which one actually ran). That copy also always treated every date as
 * year-agnostic recurring MM-DD, silently discarding the year on any
 * one-time YYYY-MM-DD entry. Deleted in favor of this thin adapter over the
 * one real implementation.
 *
 * @param {number} daysAhead
 * @returns {Array} [{ date, dateLabel, label, person, daysAway }]
 */
function getRadarDatesForWeekendMemo_(daysAhead) {
  var tz    = Session.getScriptTimeZone();
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  return getUpcomingImportantDates_(daysAhead).map(function(e) {
    // getUpcomingImportantDates_ returns the RAW sheet cell in e['Date'] (often
    // just "MM-DD" with no year), not the resolved target date — parsing that
    // directly is a trap: new Date('08-02') silently resolves to year 2001 in
    // this runtime rather than throwing. Reconstruct the real date from
    // daysUntil instead, using the exact arithmetic the source already used.
    var date = new Date(today.getTime() + e['daysUntil'] * 86400000);
    return {
      date:      date,
      dateLabel: Utilities.formatDate(date, tz, 'MMM d'),
      label:     String(e['Label']  || '').trim(),
      person:    String(e['Person'] || '').trim(),
      daysAway:  e['daysUntil'],
    };
  });
}

// ============================================================
// PLAIN-TEXT SECTION FORMATTERS
// ============================================================

/**
 * @param {{sat, sun}|null} weatherData
 * @returns {string}
 */
function formatWeatherBlock_(weatherData) {
  if (!weatherData) return '';
  var lines = [];
  if (weatherData.sat) {
    var s    = weatherData.sat;
    var line = 'SAT · ' + s.temp + '°F';
    if (s.condition) line += ' · ' + s.condition;
    if (s.feelsLike && s.feelsLike !== s.temp) line += ' · Feels like ' + s.feelsLike + '°';
    if (s.note) line += ' · ' + s.note;
    lines.push(line);
  }
  if (weatherData.sun) {
    var u    = weatherData.sun;
    var ul   = 'SUN · ' + u.temp + '°F';
    if (u.condition) ul += ' · ' + u.condition;
    if (u.feelsLike && u.feelsLike !== u.temp) ul += ' · Feels like ' + u.feelsLike + '°';
    if (u.stormNote) ul += ' · ' + u.stormNote;
    lines.push(ul);
  }
  return lines.join('\n');
}

/**
 * @param {string|null} carryNote
 * @returns {string}
 */
function formatCarryBlock_(carryNote) {
  if (!carryNote) return '';
  return '↩ Last week: ' + carryNote;
}

/**
 * @param {Array} events — [{ day, title, detail }]
 * @returns {string}
 */
function formatLocalEventsBlock_(events) {
  if (!events || events.length === 0) return '';
  return events.map(function(ev) {
    var line = ev.day + ' · ' + ev.title;
    if (ev.detail) line += '\n     ' + ev.detail;
    return line;
  }).join('\n');
}

/**
 * @param {Array} upcomingDates — [{ dateLabel, label, person, daysAway }]
 * @returns {string}
 */
function formatRadarBlock_(upcomingDates) {
  if (!upcomingDates || upcomingDates.length === 0) return '';
  return upcomingDates.map(function(d) {
    var line = d.dateLabel + ' · ' + d.label;
    if (d.person && d.person.toLowerCase() !== d.label.toLowerCase()) line += ' (' + d.person + ')';
    line += ' · ' + (d.daysAway === 1 ? '1 day out' : d.daysAway + ' days out');
    return line;
  }).join('\n');
}

/**
 * Assembles the full calendar event description by wrapping Claude's prose memo
 * with weather, carry-forward, local events, and radar sections.
 *
 * @param {string}      memo         — Claude's raw memo text
 * @param {Object|null} weatherData  — from getWeekendWeather_()
 * @param {string|null} carryNote    — from getCarryForwardNote_()
 * @param {Array}       localEvents  — from searchLocalEvents_()
 * @param {Array}       radarDates   — from getRadarDatesForWeekendMemo_()
 * @returns {string}
 */
function assembleWeekendMemoText_(memo, weatherData, carryNote, localEvents, radarDates) {
  var parts   = [];
  var divider = '────────────────────────────────';

  var weatherBlock = formatWeatherBlock_(weatherData);
  if (weatherBlock) parts.push(weatherBlock);

  var carryBlock = formatCarryBlock_(carryNote);
  if (carryBlock) parts.push(carryBlock);

  if (parts.length > 0) parts.push('');
  parts.push(memo);

  var eventsBlock = formatLocalEventsBlock_(localEvents);
  if (eventsBlock) {
    parts.push('');
    parts.push(divider);
    parts.push('IN THE AREA');
    parts.push(eventsBlock);
  }

  var radarBlock = formatRadarBlock_(radarDates);
  if (radarBlock) {
    parts.push('');
    parts.push(divider);
    parts.push('ON YOUR RADAR');
    parts.push(radarBlock);
  }

  parts.push('');
  parts.push(divider);
  parts.push('VERA · Chief of Staff');

  return parts.join('\n');
}

// ============================================================
// HTML EMAIL — polished rendering for the Weekend Memo email
// ============================================================
//
// Table-based, fully inline-styled markup — Gmail and Outlook strip or
// ignore CSS custom properties, flexbox/grid, and @media queries in email,
// so this is a deliberately different (safer) approach from a web artifact:
// no dark-mode variant, no CSS variables. One considered light palette,
// same structure as the plain-text calendar version (weather, continuity,
// memo, in the area, radar), same content — just rendered richly instead
// of as divider-separated plain text.

var WKND_EMAIL_COLORS_ = {
  ink:        '#1A1A1E',
  inkSoft:    '#72706B',
  canvas:     '#F5F3EF',
  card:       '#FFFFFF',
  accent:     '#2C3E55',
  rule:       '#E0DBD3',
  badgeBg:    '#EDE8DF',
  badgeText:  '#6B5C47',
  warn:       '#7A4F1E',
  carryBg:    '#FAF8F5',
  carryBorder:'#B8A99A',
};

/** Escapes text for safe inclusion in HTML — every piece of live content (memo prose, search results, sheet data) passes through this. */
function escapeHtmlWknd_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Human-readable capacity badge text. Only shown for the four states that
 * are actually atypical — an ordinary open/light weekend gets no badge,
 * matching the mockup's use of the badge to flag something worth knowing,
 * not to label every weekend.
 * @param {Object} weekendCapacity — from classifyWeekend_()
 * @returns {string} badge text, or '' for open/light weekends
 */
function capacityBadgeLabel_(weekendCapacity) {
  if (!weekendCapacity) return '';
  switch (weekendCapacity.type) {
    case 'traveling':      return 'Traveling';
    case 'pre_major_trip':
      return 'Trip in ' + weekendCapacity.preTripDaysAway +
             (weekendCapacity.preTripDaysAway === 1 ? ' day' : ' days');
    case 'house_guests':   return 'House Guests';
    case 'busy':           return weekendCapacity.eventCount + ' events on the calendar';
    default:                return '';
  }
}

function htmlSectionLabel_(text) {
  return '<div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:' +
    WKND_EMAIL_COLORS_.inkSoft + ';font-weight:600;margin-bottom:10px;">' + escapeHtmlWknd_(text) + '</div>';
}

function htmlDivider_() {
  return '<tr><td style="padding:0 24px;"><div style="border-top:1px solid ' + WKND_EMAIL_COLORS_.rule + ';margin:22px 0;"></div></td></tr>';
}

/** @param {{sat,sun}|null} weatherData @returns {string} '' or a full <tr> row */
function htmlWeatherBlock_(weatherData) {
  if (!weatherData || (!weatherData.sat && !weatherData.sun)) return '';
  var c = WKND_EMAIL_COLORS_;

  function dayCell(label, d) {
    if (!d) return '<td style="padding:12px 16px;"></td>';
    var lines =
      '<div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:' + c.inkSoft + ';margin-bottom:4px;">' + escapeHtmlWknd_(label) + '</div>' +
      '<div style="font-size:24px;font-weight:700;color:' + c.accent + ';line-height:1.1;">' + escapeHtmlWknd_(d.temp) + '&deg;F</div>' +
      (d.condition ? '<div style="font-size:12px;color:' + c.ink + ';margin-top:3px;">' + escapeHtmlWknd_(d.condition) +
        (d.feelsLike && d.feelsLike !== d.temp ? ' &middot; Feels like ' + escapeHtmlWknd_(d.feelsLike) + '&deg;' : '') + '</div>' : '') +
      (d.note ? '<div style="font-size:11px;color:' + c.inkSoft + ';margin-top:4px;font-style:italic;">' + escapeHtmlWknd_(d.note) + '</div>' : '') +
      (d.stormNote ? '<div style="font-size:11px;color:' + c.warn + ';margin-top:4px;font-style:italic;">' + escapeHtmlWknd_(d.stormNote) + '</div>' : '');
    return '<td width="50%" style="padding:12px 16px;">' + lines + '</td>';
  }

  return '<tr><td style="padding:20px 24px 0;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:' + c.badgeBg + ';border-radius:3px;"><tr>' +
    dayCell('Saturday', weatherData.sat) +
    '<td width="1" style="background:' + c.rule + ';"></td>' +
    dayCell('Sunday', weatherData.sun) +
    '</tr></table></td></tr>';
}

/** @param {string|null} carryNote @returns {string} '' or a full <tr> row */
function htmlCarryBlock_(carryNote) {
  if (!carryNote) return '';
  var c = WKND_EMAIL_COLORS_;
  return '<tr><td style="padding:16px 24px 0;">' +
    '<div style="border-left:2px solid ' + c.carryBorder + ';background:' + c.carryBg + ';padding:10px 12px;border-radius:0 2px 2px 0;">' +
    '<span style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;color:' + c.inkSoft + ';">&#8617; Last week</span>' +
    '<div style="font-size:12.5px;color:' + c.inkSoft + ';line-height:1.55;margin-top:4px;">' + escapeHtmlWknd_(carryNote) + '</div>' +
    '</div></td></tr>';
}

/** @param {string} memo — Claude's raw memo text, paragraphs separated by blank lines */
function htmlMemoBlock_(memo) {
  var c = WKND_EMAIL_COLORS_;
  var paragraphs = String(memo || '').split(/\n\s*\n/).map(function(p) { return p.trim(); }).filter(Boolean);
  var html = paragraphs.map(function(p) {
    return '<p style="margin:0 0 16px;font-family:Georgia,\'Times New Roman\',serif;font-size:15.5px;line-height:1.75;color:' +
      c.ink + ';">' + escapeHtmlWknd_(p) + '</p>';
  }).join('');
  return '<tr><td style="padding:22px 24px 0;">' + htmlSectionLabel_('Memo') + html + '</td></tr>';
}

/** @param {Array} events — [{ day, title, detail }] from searchLocalEvents_() @returns {string} '' or a full <tr> row */
function htmlLocalEventsBlock_(events) {
  if (!events || events.length === 0) return '';
  var c = WKND_EMAIL_COLORS_;
  var rows = events.map(function(ev, i) {
    var last = i === events.length - 1;
    return '<tr>' +
      '<td width="40" valign="top" style="padding:10px 0;border-bottom:' + (last ? 'none' : '1px solid ' + c.rule) + ';font-size:11px;font-weight:700;color:' + c.accent + ';letter-spacing:0.04em;text-transform:uppercase;">' + escapeHtmlWknd_(ev.day) + '</td>' +
      '<td valign="top" style="padding:10px 0;border-bottom:' + (last ? 'none' : '1px solid ' + c.rule) + ';">' +
        '<div style="font-size:14px;color:' + c.ink + ';font-weight:500;line-height:1.4;">' + escapeHtmlWknd_(ev.title) + '</div>' +
        (ev.detail ? '<div style="font-size:12px;color:' + c.inkSoft + ';margin-top:2px;">' + escapeHtmlWknd_(ev.detail) + '</div>' : '') +
      '</td></tr>';
  }).join('');
  return '<tr><td style="padding:22px 24px 0;">' + htmlSectionLabel_('In the Area') +
    '<table width="100%" cellpadding="0" cellspacing="0">' + rows + '</table></td></tr>';
}

/** @param {Array} dates — [{ dateLabel, label, person, daysAway }] from getRadarDatesForWeekendMemo_() @returns {string} '' or a full <tr> row */
function htmlRadarBlock_(dates) {
  if (!dates || dates.length === 0) return '';
  var c = WKND_EMAIL_COLORS_;
  var rows = dates.map(function(d, i) {
    var last = i === dates.length - 1;
    var personSuffix = (d.person && d.person.toLowerCase() !== d.label.toLowerCase())
      ? ' <span style="color:' + c.inkSoft + ';">(' + escapeHtmlWknd_(d.person) + ')</span>' : '';
    var daysText = d.daysAway === 1 ? '1 day out' : d.daysAway + ' days out';
    return '<tr>' +
      '<td width="50" valign="top" style="padding:9px 0;border-bottom:' + (last ? 'none' : '1px solid ' + c.rule) + ';font-size:12px;font-weight:700;color:' + c.accent + ';">' + escapeHtmlWknd_(d.dateLabel) + '</td>' +
      '<td valign="top" style="padding:9px 0;border-bottom:' + (last ? 'none' : '1px solid ' + c.rule) + ';">' +
        '<div style="font-size:14px;color:' + c.ink + ';font-weight:500;">' + escapeHtmlWknd_(d.label) + personSuffix + '</div>' +
        '<div style="font-size:12px;color:' + c.inkSoft + ';margin-top:2px;">' + daysText + '</div>' +
      '</td></tr>';
  }).join('');
  return '<tr><td style="padding:22px 24px 0;">' + htmlSectionLabel_('On Your Radar') +
    '<table width="100%" cellpadding="0" cellspacing="0">' + rows + '</table></td></tr>';
}

/**
 * Assembles the full HTML email body — same content and structure as
 * assembleWeekendMemoText_ (weather, continuity, memo, in the area, radar),
 * rendered richly instead of as plain divider-separated text. Includes a
 * link back to the calendar event, which holds the same content in plain
 * text form as a self-contained record.
 *
 * @param {string}      memo            Claude's raw memo text
 * @param {Object|null} weatherData     from getWeekendWeather_()
 * @param {string|null} carryNote       from getCarryForwardNote_()
 * @param {Array}       localEvents     from searchLocalEvents_()
 * @param {Array}       radarDates      from getRadarDatesForWeekendMemo_()
 * @param {Object}      weekendCapacity from classifyWeekend_()
 * @param {Date}        saturdayDate    the upcoming Saturday
 * @param {string|null} calendarLink    htmlLink from createWeekendMemoEvent_(), or null
 * @returns {string} full HTML document
 */
function buildWeekendMemoHtml_(memo, weatherData, carryNote, localEvents, radarDates, weekendCapacity, saturdayDate, calendarLink) {
  var c  = WKND_EMAIL_COLORS_;
  var tz = Session.getScriptTimeZone();
  var sundayDate = new Date(saturdayDate.getTime() + 86400000);
  var dateRange  = Utilities.formatDate(saturdayDate, tz, 'MMM d') + '&ndash;' + Utilities.formatDate(sundayDate, tz, 'd');
  var badge      = capacityBadgeLabel_(weekendCapacity);

  var rows = [];

  // Masthead
  rows.push(
    '<tr><td style="padding:0 24px 14px;border-bottom:1.5px solid ' + c.accent + ';">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="font-family:Georgia,\'Times New Roman\',serif;font-size:21px;letter-spacing:0.1em;color:' + c.accent + ';text-transform:uppercase;">VERA</td>' +
    '<td align="right" style="font-size:11px;letter-spacing:0.13em;text-transform:uppercase;color:' + c.inkSoft + ';">Weekend Memo</td>' +
    '</tr></table></td></tr>'
  );

  // Meta row — date + optional capacity badge
  rows.push(
    '<tr><td style="padding:18px 24px 0;font-size:13px;font-weight:600;letter-spacing:0.03em;color:' + c.ink + ';">' +
    'Saturday &ndash; Sunday &middot; ' + dateRange +
    (badge ? '&nbsp;&nbsp;<span style="font-size:11px;letter-spacing:0.07em;text-transform:uppercase;background:' +
      c.badgeBg + ';color:' + c.badgeText + ';padding:3px 9px;border-radius:2px;font-weight:500;">' + escapeHtmlWknd_(badge) + '</span>' : '') +
    '</td></tr>'
  );

  rows.push(htmlWeatherBlock_(weatherData));
  rows.push(htmlCarryBlock_(carryNote));
  rows.push(htmlMemoBlock_(memo));

  var eventsBlock = htmlLocalEventsBlock_(localEvents);
  if (eventsBlock) { rows.push(htmlDivider_()); rows.push(eventsBlock); }

  var radarBlock = htmlRadarBlock_(radarDates);
  if (radarBlock) { rows.push(htmlDivider_()); rows.push(radarBlock); }

  // Calendar link
  if (calendarLink) {
    rows.push(
      '<tr><td style="padding:26px 24px 0;">' +
      '<a href="' + calendarLink + '" style="display:inline-block;background:' + c.accent +
      ';color:' + c.canvas + ';font-size:13px;font-weight:600;letter-spacing:0.03em;padding:10px 20px;border-radius:3px;text-decoration:none;">' +
      'View on your calendar &rarr;</a></td></tr>'
    );
  }

  // Footer
  rows.push(
    '<tr><td style="padding:28px 24px 32px;border-top:1px solid ' + c.rule + ';margin-top:20px;font-size:11px;color:' +
    c.inkSoft + ';letter-spacing:0.05em;">VERA &middot; Chief of Staff</td></tr>'
  );

  return (
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:' + c.canvas +
    ';font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:' + c.canvas + ';padding:40px 0;">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:' + c.canvas + ';">' +
    rows.join('') +
    '</table></td></tr></table></body></html>'
  );
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
