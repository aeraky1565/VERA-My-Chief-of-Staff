// ============================================================
// VERA — Pacing.js
// Context-Aware Pacing (Issue #139)
//
// checkPacing_()        — Step 0a called from nightlyRun()
//                         (vacation detection must run first)
// checkMissRate_()      — called at END of nightlyRun() after
//                         all other jobs so flag counts are current
//
// isInVacationMode_()   — fast helper used by Fitness.js, Growth.js,
//                         escalateAgedFlags_(), and morningNudge_()
// isInPacingMode_()     — fast helper used by flag-generation jobs
// getPacingStatus_()    — returns status object for the dashboard
// ============================================================

function checkPacing_() {
  var cfg = getConfigValues();
  if ((cfg['pacing_enabled'] || 'true') !== 'true') {
    Logger.log('checkPacing_: disabled'); return;
  }
  checkVacationMode_();
  // Miss rate is run at end of nightlyRun — see Step Final in Code.js
}

// ── Vacation Mode ─────────────────────────────────────────────────────────────

/**
 * Detects whether Ahmed is currently on an active trip.
 * Active = today falls within the date span of any itinerary tripKey
 *          where the Trip Meta Traveler is NOT exclusively Victoria.
 *
 * Writes to Script Properties:
 *   VACATION_MODE_ACTIVE  — "true" / "false"
 *   VACATION_MODE_ENDS    — "YYYY-MM-DD" (last itinerary date of the trip)
 *   VACATION_TRIP_NAME    — trip key
 */
function checkVacationMode_() {
  var ss    = getSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var tz    = Session.getScriptTimeZone();
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build traveler map: tripKey → traveler string (from Trip Meta)
  var travelerMap = {};
  var metaSheet = ss.getSheetByName(TABS.TRIP_META);
  if (metaSheet && metaSheet.getLastRow() >= 2) {
    metaSheet.getRange(2, 1, metaSheet.getLastRow() - 1, TRIP_META_HEADERS.length)
      .getValues()
      .forEach(function(r) {
        var tk = String(r[0] || '').trim();
        if (tk) travelerMap[tk] = String(r[4] || '').trim().toLowerCase(); // index 4 = Traveler
      });
  }

  // Build date-range map from Itinerary: tripKey → { min, max }
  var rangeMap = {};
  var itinSheet = ss.getSheetByName(TABS.ITINERARY);
  if (itinSheet && itinSheet.getLastRow() >= 2) {
    itinSheet.getRange(2, 1, itinSheet.getLastRow() - 1, ITINERARY_HEADERS.length)
      .getValues()
      .forEach(function(r) {
        var tk = String(r[1] || '').trim(); // index 1 = Trip Key
        var dt = r[4];                       // index 4 = Date
        if (!tk || !dt) return;
        var d = new Date(dt);
        d.setHours(0, 0, 0, 0);
        if (isNaN(d.getTime())) return;
        if (!rangeMap[tk]) rangeMap[tk] = { min: d, max: d };
        if (d < rangeMap[tk].min) rangeMap[tk].min = d;
        if (d > rangeMap[tk].max) rangeMap[tk].max = d;
      });
  }

  // Find the first active trip that includes Ahmed
  var activeTrip = null;
  var keys = Object.keys(rangeMap);
  for (var i = 0; i < keys.length; i++) {
    var tk    = keys[i];
    var range = rangeMap[tk];
    if (today < range.min || today > range.max) continue; // not active today

    // Victoria-only = traveler is set and explicitly excludes Ahmed
    var traveler      = travelerMap[tk] || '';
    var victoriaOnly  = traveler &&
                        traveler.indexOf('ahmed') === -1 &&
                        (traveler.indexOf('victoria') !== -1 || traveler === 'victoria');
    if (victoriaOnly) continue;

    activeTrip = {
      key:    tk,
      endStr: Utilities.formatDate(range.max, tz, 'yyyy-MM-dd'),
    };
    break;
  }

  if (activeTrip) {
    props.setProperties({
      VACATION_MODE_ACTIVE: 'true',
      VACATION_MODE_ENDS:   activeTrip.endStr,
      VACATION_TRIP_NAME:   activeTrip.key,
    });
    Logger.log('checkVacationMode_: ACTIVE — trip "' + activeTrip.key + '" ends ' + activeTrip.endStr);
  } else {
    props.setProperties({ VACATION_MODE_ACTIVE: 'false' });
    props.deleteProperty('VACATION_MODE_ENDS');
    props.deleteProperty('VACATION_TRIP_NAME');
    Logger.log('checkVacationMode_: inactive');
  }
}

/**
 * Returns true if vacation mode is currently active.
 * Fast Script Properties read — safe to call from any nightly job.
 */
function isInVacationMode_() {
  return PropertiesService.getScriptProperties()
           .getProperty('VACATION_MODE_ACTIVE') === 'true';
}

// ── Miss Rate / Pacing Mode ──────────────────────────────────────────────────

/**
 * Scores 4 domains for miss activity in the last 48 hours.
 * If 2+ domains show misses:
 *   - First detection  → fires a Medium deferral-offer flag
 *   - Second window (48h later, still no response, still 2+ misses)
 *                      → auto-defers upcoming open tasks to next Monday
 *                         + activates Pacing Mode for 7 days
 *
 * Called at END of nightlyRun so all flag counts are current.
 * Skipped entirely while vacation mode is active.
 */
function checkMissRate_() {
  var cfg = getConfigValues();
  if ((cfg['pacing_enabled'] || 'true') !== 'true') {
    Logger.log('checkMissRate_: disabled');
    return;
  }
  if (isInVacationMode_()) {
    Logger.log('checkMissRate_: skipped (vacation mode active)');
    return;
  }

  var ss             = getSpreadsheet();
  var props          = PropertiesService.getScriptProperties();
  var tz             = Session.getScriptTimeZone();
  var flagThreshold  = parseInt(cfg['pacing_flag_threshold'] || '3', 10) || 3;
  var pacingDays     = parseInt(cfg['pacing_mode_days']      || '7', 10) || 7;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var yesterday  = new Date(today.getTime() - 86400000);
  var todayStr   = Utilities.formatDate(today,     tz, 'yyyy-MM-dd');
  var yestStr    = Utilities.formatDate(yesterday,  tz, 'yyyy-MM-dd');

  // ── Score domains ──────────────────────────────────────────────────────────

  var domainHits = [];

  // 1. Gym — any scheduled session today or yesterday that is not attended
  try {
    var gymRows = getGymLog_();
    var gymMiss = gymRows.some(function(r) {
      return (r.date === todayStr || r.date === yestStr) && r.attended !== 'Yes';
    });
    if (gymMiss) domainHits.push('gym sessions');
  } catch (e) { Logger.log('checkMissRate_ gym: ' + e.message); }

  // 2. Tasks — tasks that became newly overdue today or yesterday (still Open)
  try {
    var taskSheet = ss.getSheetByName(TABS.TASKS);
    if (taskSheet && taskSheet.getLastRow() >= 2) {
      var taskRows = taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, TASK_HEADERS.length)
                              .getValues();
      var taskMiss = taskRows.some(function(r) {
        if (String(r[4] || '').trim() !== 'Open') return false;
        var due = r[3]; // index 3 = Due Date
        if (!due) return false;
        var d = new Date(due);
        d.setHours(0, 0, 0, 0);
        return d.getTime() === today.getTime() || d.getTime() === yesterday.getTime();
      });
      if (taskMiss) domainHits.push('overdue tasks');
    }
  } catch (e) { Logger.log('checkMissRate_ tasks: ' + e.message); }

  // 3. Flags — 3+ unacknowledged Medium/High flags sitting open
  try {
    var flagSheet = ss.getSheetByName(TABS.FLAGS);
    if (flagSheet && flagSheet.getLastRow() >= 2) {
      var flagRows = flagSheet.getRange(2, 1, flagSheet.getLastRow() - 1, FLAG_HEADERS.length)
                              .getValues();
      var urgentUnack = flagRows.filter(function(r) {
        var urg = String(r[5] || '').trim(); // index 5 = Urgency
        var ack = String(r[6] || '').trim(); // index 6 = Acknowledged
        var res = String(r[8] || '').trim(); // index 8 = Resolved
        return (urg === 'High' || urg === 'Medium') && !ack && !res;
      }).length;
      if (urgentUnack >= flagThreshold) domainHits.push(urgentUnack + ' unacknowledged flags');
    }
  } catch (e) { Logger.log('checkMissRate_ flags: ' + e.message); }

  // 4. Chores — any chore overdue by its cadence interval
  try {
    var choreSheet = ss.getSheetByName(TABS.CHORES);
    if (choreSheet && choreSheet.getLastRow() >= 2) {
      var choreRows = choreSheet.getRange(2, 1, choreSheet.getLastRow() - 1, CHORES_HEADERS.length)
                                .getValues();
      var cadenceDays = { Daily: 1, Weekly: 7, 'Bi-weekly': 14, Monthly: 30, Quarterly: 90 };
      var choreMiss = choreRows.some(function(r) {
        var cadence   = String(r[2] || '').trim(); // index 2 = Cadence
        var checkedAt = r[5];                       // index 5 = Checked At
        var interval  = cadenceDays[cadence];
        if (!interval || !checkedAt) return false;
        var last = new Date(checkedAt);
        last.setHours(0, 0, 0, 0);
        if (isNaN(last.getTime())) return false;
        return Math.round((today - last) / 86400000) > interval;
      });
      if (choreMiss) domainHits.push('overdue chores');
    }
  } catch (e) { Logger.log('checkMissRate_ chores: ' + e.message); }

  Logger.log('checkMissRate_: domain hits = [' + domainHits.join(', ') + ']');

  // ── Cluster evaluation ────────────────────────────────────────────────────

  if (domainHits.length < 2) {
    // Pattern has cleared — reset state
    if (props.getProperty('PACING_FIRST_DETECTED')) {
      props.deleteProperty('PACING_FIRST_DETECTED');
      props.deleteProperty('PACING_OFFER_FLAG_KEY');
      Logger.log('checkMissRate_: cluster cleared, reset state.');
    }
    return;
  }

  var nowMs            = Date.now();
  var firstDetectedMs  = parseInt(props.getProperty('PACING_FIRST_DETECTED') || '0', 10);
  var offerFlagKey     = props.getProperty('PACING_OFFER_FLAG_KEY') || '';

  // ── First detection — fire deferral offer flag ────────────────────────────
  if (!firstDetectedMs) {
    var offerKey = 'pacing_offer_' + Utilities.formatDate(today, tz, 'yyyyMMdd');
    addFlag_(
      'Pacing',
      'Missed targets detected — would you like me to ease up?',
      'Medium',
      offerKey,
      'I\'ve noticed missed targets across ' + domainHits.length + ' areas in the last 48 hours: ' +
      domainHits.join(', ') + '. ' +
      'Would you like me to defer all low-priority upcoming tasks to next Monday and pause routine reminders for a week? ' +
      'Acknowledge this flag or tell me in chat to activate Pacing Mode. ' +
      'If I don\'t hear back in 48 hours and the pattern continues, I\'ll activate it automatically.'
    );
    props.setProperties({
      PACING_FIRST_DETECTED: String(nowMs),
      PACING_OFFER_FLAG_KEY: offerKey,
    });
    Logger.log('checkMissRate_: first detection — offer flag fired (' + offerKey + ')');
    return;
  }

  // ── Check if user responded to the offer flag ─────────────────────────────
  if (offerFlagKey) {
    var flagSheet2 = ss.getSheetByName(TABS.FLAGS);
    if (flagSheet2 && flagSheet2.getLastRow() >= 2) {
      var fRows = flagSheet2.getRange(2, 1, flagSheet2.getLastRow() - 1, FLAG_HEADERS.length)
                            .getValues();
      for (var fi = 0; fi < fRows.length; fi++) {
        if (String(fRows[fi][9] || '').trim() !== offerFlagKey) continue;
        var ack = String(fRows[fi][6] || '').trim(); // Acknowledged
        var res = String(fRows[fi][8] || '').trim(); // Resolved
        if (ack || res) {
          props.deleteProperty('PACING_FIRST_DETECTED');
          props.deleteProperty('PACING_OFFER_FLAG_KEY');
          Logger.log('checkMissRate_: offer flag acknowledged/resolved — reset state.');
          return;
        }
        break;
      }
    }
  }

  // ── Second window passed, no response — auto-activate ────────────────────
  var hoursSinceFirst = (nowMs - firstDetectedMs) / 3600000;
  if (hoursSinceFirst < 48) {
    Logger.log('checkMissRate_: waiting for second 48h window (' +
               Math.round(hoursSinceFirst) + 'h elapsed).');
    return;
  }

  // Compute next Monday
  var nextMonday     = new Date(today);
  var daysUntilMon   = (8 - nextMonday.getDay()) % 7 || 7;
  nextMonday.setDate(nextMonday.getDate() + daysUntilMon);
  var nextMonStr     = Utilities.formatDate(nextMonday, tz, 'yyyy-MM-dd');

  // Defer upcoming open non-recurring tasks with a future due date
  var deferCount = 0;
  try {
    var taskSheet2 = ss.getSheetByName(TABS.TASKS);
    if (taskSheet2 && taskSheet2.getLastRow() >= 2) {
      var tRows = taskSheet2.getRange(2, 1, taskSheet2.getLastRow() - 1, TASK_HEADERS.length)
                            .getValues();
      tRows.forEach(function(r, idx) {
        if (String(r[4] || '').trim() !== 'Open') return; // not open
        if (String(r[5] || '').trim()) return;             // recurring — skip
        var due = r[3];
        if (!due) return;
        var d = new Date(due);
        d.setHours(0, 0, 0, 0);
        if (d <= today) return; // already overdue — leave as-is
        taskSheet2.getRange(idx + 2, 4).setValue(nextMonStr);
        deferCount++;
      });
    }
  } catch (e) { Logger.log('checkMissRate_ defer: ' + e.message); }

  // Activate pacing mode for configured number of days
  var pacingEnds    = new Date(today.getTime() + pacingDays * 86400000);
  var pacingEndsStr = Utilities.formatDate(pacingEnds, tz, 'yyyy-MM-dd');

  props.setProperties({
    PACING_MODE_ACTIVE: 'true',
    PACING_MODE_ENDS:   pacingEndsStr,
  });
  props.deleteProperty('PACING_FIRST_DETECTED');
  props.deleteProperty('PACING_OFFER_FLAG_KEY');

  addFlag_(
    'Pacing',
    'Pacing Mode activated — low-priority tasks deferred to next Monday',
    'Low',
    'pacing_activated_' + Utilities.formatDate(today, tz, 'yyyyMMdd'),
    'Pacing Mode is now active. ' + deferCount + ' upcoming task(s) have been moved to ' +
    nextMonStr + '. Low-priority routine reminders are paused until ' + pacingEndsStr + '. ' +
    'Tell me "exit pacing mode" in chat to deactivate early.'
  );

  Logger.log('checkMissRate_: pacing mode ACTIVATED. Deferred ' + deferCount +
             ' task(s). Ends ' + pacingEndsStr);
}

/**
 * Returns true if pacing mode is currently active.
 * Auto-expires if past PACING_MODE_ENDS date.
 */
function isInPacingMode_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('PACING_MODE_ACTIVE') !== 'true') return false;
  var endsStr = props.getProperty('PACING_MODE_ENDS');
  if (!endsStr) return false;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var ends = new Date(endsStr + 'T00:00:00');
  if (today > ends) {
    props.setProperties({ PACING_MODE_ACTIVE: 'false' });
    Logger.log('isInPacingMode_: auto-expired');
    return false;
  }
  return true;
}

/**
 * Returns a status object consumed by the get_pacing_status API endpoint.
 */
function getPacingStatus_() {
  var props = PropertiesService.getScriptProperties();
  return {
    vacationMode:     props.getProperty('VACATION_MODE_ACTIVE') === 'true',
    vacationModeEnds: props.getProperty('VACATION_MODE_ENDS')   || '',
    vacationTripName: props.getProperty('VACATION_TRIP_NAME')   || '',
    pacingMode:       isInPacingMode_(),
    pacingModeEnds:   props.getProperty('PACING_MODE_ENDS')     || '',
  };
}
