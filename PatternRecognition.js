// ============================================================
// PatternRecognition.js — Cross-Domain Pattern Recognition (Issue #90)
//
// Assembles a lightweight snapshot across all VERA data domains
// and evaluates rule-based compound patterns that span multiple
// domains. Single-domain flags are left to their own checkers;
// this file only fires when ≥2 domains signal together.
//
// Patterns detected:
//   1. High-Stress Compound     — overdue tasks + high flags + no gym
//   2. Goal–Behaviour Drift     — active goals but gym + tasks stalling
//   3. Social/Calendar Gap      — empty week ahead (not in pacing/vacation)
//   4. Overload + Pacing Mismatch — high intensity week, pacing not on
//   5. Meal Chaos               — mostly takeout + overdue tasks
//   6. Backlog Accumulation     — busy calendar but neglected task pile
//   7. Health Neglect Compound  — overdue appointments + no gym
//
// Config tab keys (optional overrides):
//   pattern_max_flags  — max new flags per run (default 2)
//   pattern_dedup_days — days to suppress same pattern key (default 7)
//
// Entry point: checkCrossPatternFlags_() — called from nightlyRun()
// ============================================================

var PATTERN_MAX_FLAGS_DEFAULT_  = 2;
var PATTERN_DEDUP_DAYS_DEFAULT_ = 7;

// ============================================================
// Snapshot builder
// ============================================================

/**
 * Assembles a lightweight cross-domain signal snapshot from existing
 * VERA data functions. All reads are wrapped in try/catch — missing
 * data returns null and patterns requiring that field are skipped.
 *
 * @returns {Object} snap — cross-domain signal object
 */
function buildCrossDomainSnapshot_() {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var snap  = {};

  // ---- Tasks ----
  try {
    var tasks = getOpenTasks();
    snap.overdueTaskCount   = tasks.filter(function(t) { return t.isOverdue; }).length;
    snap.neglectedTaskCount = tasks.filter(function(t) { return t.ageInDays >= 14; }).length;
    snap.tasks              = tasks;
  } catch (e) {
    Logger.log('PatternRecognition snapshot: tasks error — ' + e.message);
    snap.overdueTaskCount   = null;
    snap.neglectedTaskCount = null;
    snap.tasks              = [];
  }

  // ---- Calendar events this week ----
  try {
    var events  = getUpcomingEvents();
    var weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
    snap.calendarEventsThisWeek = events.filter(function(ev) {
      if (!ev.start) return false;
      var d = new Date(ev.start);
      return d >= today && d <= weekEnd;
    }).length;
    snap.events = events;
  } catch (e) {
    Logger.log('PatternRecognition snapshot: events error — ' + e.message);
    snap.calendarEventsThisWeek = null;
    snap.events                 = [];
  }

  // ---- Goals in progress ----
  try {
    var goals    = getGoals_();
    snap.activeGoals = goals.filter(function(g) {
      return g.status && g.status.toLowerCase() === 'doing';
    }).length;
  } catch (e) {
    Logger.log('PatternRecognition snapshot: goals error — ' + e.message);
    snap.activeGoals = null;
  }

  // ---- Gym sessions this week ----
  try {
    var cfg              = getConfigValues();
    snap.gymTargetPerWeek = parseInt(cfg['gym_sessions_per_week'] || '3', 10);
    var gymLog           = getGymLog_();
    var weekAgo          = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
    snap.gymSessionsThisWeek = gymLog.filter(function(entry) {
      if (String(entry.attended).toLowerCase() !== 'yes') return false;
      var d = new Date(entry.date);
      return d >= weekAgo && d <= today;
    }).length;
  } catch (e) {
    Logger.log('PatternRecognition snapshot: gym error — ' + e.message);
    snap.gymSessionsThisWeek = null;
    snap.gymTargetPerWeek    = 3;
  }

  // ---- Overdue health appointments ----
  try {
    var appts = getHealthAppointments_();
    snap.overdueHealthAppts = appts.filter(function(a) {
      return a.daysUntil !== null && a.daysUntil < 0 && a.intervalMonths !== 0;
    }).length;
  } catch (e) {
    Logger.log('PatternRecognition snapshot: health appts error — ' + e.message);
    snap.overdueHealthAppts = null;
  }

  // ---- Active High flags (unresolved, unacknowledged) ----
  try {
    var ss        = getSpreadsheet();
    var flagSheet = ss.getSheetByName(TABS.FLAGS);
    snap.activeHighFlags = 0;
    if (flagSheet && flagSheet.getLastRow() > 1) {
      var flagRows = flagSheet.getRange(2, 1, flagSheet.getLastRow() - 1, FLAG_HEADERS.length).getValues();
      snap.activeHighFlags = flagRows.filter(function(r) {
        return String(r[5]).trim() === 'High' &&
               String(r[6]).toLowerCase().trim() !== 'yes' &&   // Acknowledged
               String(r[8]).toLowerCase().trim() !== 'yes';     // Resolved
      }).length;
    }
  } catch (e) {
    Logger.log('PatternRecognition snapshot: flags read error — ' + e.message);
    snap.activeHighFlags = null;
  }

  // ---- Pacing + vacation mode ----
  try { snap.pacingMode   = isInPacingMode_();  } catch (e) { snap.pacingMode   = null; }
  try { snap.vacationMode = isInVacationMode_(); } catch (e) { snap.vacationMode = null; }

  // ---- Intensity signal (WeekendPlanner) ----
  try {
    // Build a fake activeFlags array of the right length for the threshold check
    var fakeFlags = [];
    if (snap.activeHighFlags !== null) {
      for (var fi = 0; fi < snap.activeHighFlags; fi++) fakeFlags.push({});
    }
    var intensityResult   = computeIntensitySignal_(fakeFlags, snap.tasks || [], snap.events || []);
    snap.intensityLevel   = intensityResult ? intensityResult.level : null;
  } catch (e) {
    Logger.log('PatternRecognition snapshot: intensity error — ' + e.message);
    snap.intensityLevel = null;
  }

  // ---- Meal takeout ratio (past 7 days) ----
  try {
    var mealHistory  = getMealPlanHistory_(2);  // look back 2 weeks
    var sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    var recentMeals  = mealHistory.filter(function(m) {
      return m.mealName && m.date && new Date(m.date) >= sevenDaysAgo;
    });
    if (recentMeals.length > 0) {
      var takeoutCount = recentMeals.filter(function(m) {
        var t = (m.type || '').toLowerCase();
        return t === 'takeout' || t === 'eating out';
      }).length;
      snap.takeoutRatio = takeoutCount / recentMeals.length;
    } else {
      snap.takeoutRatio = null;   // not enough data to evaluate
    }
  } catch (e) {
    Logger.log('PatternRecognition snapshot: meal plan error — ' + e.message);
    snap.takeoutRatio = null;
  }

  return snap;
}

// ============================================================
// Pattern evaluator
// ============================================================

/**
 * Evaluates all cross-domain patterns against the snapshot.
 * Returns candidate patterns sorted by urgency (High first).
 * Only candidates whose required signals are non-null are included.
 *
 * @param   {Object}  snap   from buildCrossDomainSnapshot_()
 * @returns {Array<{key, flag, reason, urgency}>}
 */
function evaluateCrossPatterns_(snap) {
  var candidates = [];

  function add(key, flag, reason, urgency) {
    candidates.push({ key: key, flag: flag, reason: reason, urgency: urgency });
  }

  // Pattern 1: High-Stress Compound
  // overdue tasks ≥3 AND active High flags ≥2 AND gym sessions = 0
  if (snap.overdueTaskCount !== null && snap.activeHighFlags !== null && snap.gymSessionsThisWeek !== null) {
    if (snap.overdueTaskCount >= 3 && snap.activeHighFlags >= 2 && snap.gymSessionsThisWeek === 0) {
      add(
        'cross_high_stress_compound',
        'High-stress signal: tasks piling up, high flags active, gym skipped this week',
        snap.overdueTaskCount + ' overdue tasks \u00b7 ' + snap.activeHighFlags + ' active High flags \u00b7 0 gym sessions this week',
        'High'
      );
    }
  }

  // Pattern 2: Goal–Behaviour Drift
  // ≥2 active goals AND gym < 50% target AND ≥2 overdue tasks
  if (snap.activeGoals !== null && snap.gymSessionsThisWeek !== null && snap.overdueTaskCount !== null) {
    var gymTarget = snap.gymTargetPerWeek || 3;
    if (snap.activeGoals >= 2 && snap.gymSessionsThisWeek < gymTarget * 0.5 && snap.overdueTaskCount >= 2) {
      add(
        'cross_goal_behaviour_drift',
        'Goal\u2013behaviour gap: ' + snap.activeGoals + ' active goals but momentum stalling',
        'Gym this week: ' + snap.gymSessionsThisWeek + '/' + gymTarget + ' target \u00b7 ' +
          snap.overdueTaskCount + ' overdue tasks \u00b7 Check if goals need to be re-prioritised',
        'Medium'
      );
    }
  }

  // Pattern 3: Social / Calendar Gap
  // ≤1 event this week AND not in pacing/vacation mode
  if (snap.calendarEventsThisWeek !== null && snap.pacingMode !== null && snap.vacationMode !== null) {
    if (snap.calendarEventsThisWeek <= 1 && snap.pacingMode === false && snap.vacationMode === false) {
      add(
        'cross_social_calendar_gap',
        'Low-activity week ahead \u2014 nothing on the calendar',
        'Only ' + snap.calendarEventsThisWeek + ' event(s) scheduled this week \u00b7 Consider planning something intentional',
        'Low'
      );
    }
  }

  // Pattern 4: Overload + Pacing Mismatch
  // intensity=high AND pacing off AND ≥2 High flags AND ≥3 overdue tasks
  if (snap.intensityLevel !== null && snap.pacingMode !== null && snap.activeHighFlags !== null && snap.overdueTaskCount !== null) {
    if (snap.intensityLevel === 'high' && snap.pacingMode === false && snap.activeHighFlags >= 2 && snap.overdueTaskCount >= 3) {
      add(
        'cross_overload_no_pacing',
        'High-intensity week with no pacing buffer active',
        'Intensity: high \u00b7 ' + snap.overdueTaskCount + ' overdue tasks \u00b7 ' +
          snap.activeHighFlags + ' High flags \u00b7 Consider enabling pacing mode',
        'Medium'
      );
    }
  }

  // Pattern 5: Meal Chaos
  // takeout ≥70% of meals this week AND ≥2 overdue tasks
  if (snap.takeoutRatio !== null && snap.overdueTaskCount !== null) {
    if (snap.takeoutRatio >= 0.7 && snap.overdueTaskCount >= 2) {
      add(
        'cross_meal_chaos',
        'Meal routine breaking down \u2014 mostly takeout this week',
        Math.round(snap.takeoutRatio * 100) + '% of planned meals are takeout \u00b7 ' +
          snap.overdueTaskCount + ' overdue tasks \u00b7 May indicate a high-stress period',
        'Low'
      );
    }
  }

  // Pattern 6: Backlog Accumulation
  // ≥5 tasks neglected 14+ days AND ≥3 calendar events this week (busy but ignoring backlog)
  if (snap.neglectedTaskCount !== null && snap.calendarEventsThisWeek !== null) {
    if (snap.neglectedTaskCount >= 5 && snap.calendarEventsThisWeek >= 3) {
      add(
        'cross_backlog_accumulation',
        'Busy calendar but task backlog growing \u2014 ' + snap.neglectedTaskCount + ' tasks untouched for 14+ days',
        snap.calendarEventsThisWeek + ' calendar event(s) this week yet ' + snap.neglectedTaskCount +
          ' tasks haven\u2019t been touched in 14+ days',
        'Medium'
      );
    }
  }

  // Pattern 7: Health Neglect Compound
  // ≥2 overdue health appointments AND 0 gym sessions this week
  if (snap.overdueHealthAppts !== null && snap.gymSessionsThisWeek !== null) {
    if (snap.overdueHealthAppts >= 2 && snap.gymSessionsThisWeek === 0) {
      add(
        'cross_health_neglect',
        'Health neglect signal: ' + snap.overdueHealthAppts + ' overdue appointment' + (snap.overdueHealthAppts > 1 ? 's' : '') + ' + no gym this week',
        snap.overdueHealthAppts + ' health appointment(s) past due \u00b7 0 gym sessions this week \u00b7 Consider a health reset week',
        'Medium'
      );
    }
  }

  // Sort: High → Medium → Low
  var urgencyRank = { 'High': 0, 'Medium': 1, 'Low': 2 };
  candidates.sort(function(a, b) {
    return (urgencyRank[a.urgency] !== undefined ? urgencyRank[a.urgency] : 3) -
           (urgencyRank[b.urgency] !== undefined ? urgencyRank[b.urgency] : 3);
  });

  return candidates;
}

// ============================================================
// Entry point
// ============================================================

/**
 * Main entry point — called from nightlyRun() as a non-fatal step.
 *
 * 1. Builds cross-domain snapshot
 * 2. Evaluates rule-based compound patterns
 * 3. Deduplicates against existing open pattern flags
 * 4. Writes at most pattern_max_flags new flags
 * 5. Logs to #vera-logs
 */
function checkCrossPatternFlags_() {
  var today    = new Date(); today.setHours(0, 0, 0, 0);
  var cfg      = getConfigValues();
  var maxFlags = parseInt(cfg['pattern_max_flags']  || String(PATTERN_MAX_FLAGS_DEFAULT_),  10);
  var dedupDays = parseInt(cfg['pattern_dedup_days'] || String(PATTERN_DEDUP_DAYS_DEFAULT_), 10);

  // 1. Build snapshot + evaluate
  var snap       = buildCrossDomainSnapshot_();
  var candidates = evaluateCrossPatterns_(snap);

  if (candidates.length === 0) {
    Logger.log('checkCrossPatternFlags_: no cross-domain patterns triggered.');
    return;
  }
  Logger.log('checkCrossPatternFlags_: ' + candidates.length + ' candidate pattern(s) before dedup: ' +
    candidates.map(function(c) { return c.key; }).join(', '));

  // 2. Read existing Pattern Recognition flags for dedup
  var suppressedKeys = {};
  try {
    var ss        = getSpreadsheet();
    var flagSheet = ss.getSheetByName(TABS.FLAGS);
    if (flagSheet && flagSheet.getLastRow() > 1) {
      var cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - dedupDays);
      var allRows = flagSheet.getRange(2, 1, flagSheet.getLastRow() - 1, FLAG_HEADERS.length).getValues();
      allRows.forEach(function(r) {
        if (String(r[2]).trim() !== 'Pattern Recognition') return;
        var key      = String(r[9]).trim();
        var resolved = String(r[8]).toLowerCase().trim();
        var flagDate = r[1] ? new Date(r[1]) : null;
        if (!key) return;
        // Suppress if open (unresolved)
        if (resolved !== 'yes') {
          suppressedKeys[key] = true;
          return;
        }
        // Suppress if resolved but within the dedup window
        if (flagDate && flagDate >= cutoff) {
          suppressedKeys[key] = true;
        }
      });
    }
  } catch (e) {
    Logger.log('checkCrossPatternFlags_: dedup read error (continuing) — ' + e.message);
  }

  // 3. Filter + cap
  var newFlags = [];
  for (var i = 0; i < candidates.length && newFlags.length < maxFlags; i++) {
    var c = candidates[i];
    if (!suppressedKeys[c.key]) {
      newFlags.push({
        source:  'Pattern Recognition',
        flag:    c.flag,
        reason:  c.reason,
        urgency: c.urgency,
        key:     c.key,
      });
    }
  }

  if (newFlags.length === 0) {
    Logger.log('checkCrossPatternFlags_: all triggered patterns already flagged (dedup). Nothing new written.');
    return;
  }

  // 4. Write
  var written = writeFlags(newFlags);
  Logger.log('checkCrossPatternFlags_: ' + written + ' cross-domain pattern flag(s) written (' + (newFlags.length - written) + ' deduplicated).');

  // 5. Slack log — only if something was actually written
  if (written > 0) {
    try {
      sendSlackLog_('\uD83D\uDD17 Pattern Recognition \u2014 ' + written +
        ' cross-domain pattern' + (written > 1 ? 's' : '') + ' flagged');
    } catch (e) { /* non-fatal */ }
  }
}
