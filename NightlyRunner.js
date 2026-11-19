// ============================================================
// NightlyRunner.js — the night as one list that continues itself (#256)
// ============================================================
//
// WHY. Apps Script stops any execution at six minutes. The night outgrew one run, was split
// into two halves on two triggers, and outgrew those too: every new step pushed some half
// back over the limit, and a run that hits the limit is killed outright, so every step after
// it was lost (Nov 15–18: the post-trip email, the gym check-in, most flag checks).
//
// HOW IT ENDS THAT.
//  1. One ordered list (NIGHTLY_STEPS_ below), run by one runner, in PARTS. A part runs steps
//     for up to 4 minutes, then saves its place and schedules itself to continue a minute
//     later in a fresh six-minute run. More steps means more parts, never a timeout.
//  2. Before its first step, every part schedules a backup continuation 7 minutes out. A part
//     killed by the limit leaves its breadcrumb (nightlyStep_) and no handoff; the backup
//     picks up, records that step as KILLED, and goes on from the next one. A step that kills
//     a run costs that step, not the rest of the night. Killed two nights running: one flag.
//  3. The night finishes once: one summary, one heartbeat, LAST_NIGHTLY_RUN, the slowest
//     steps (and any over 90 s, named) — and a flag for a step near the limit two nights running.
//
// Steps run through nightlyStep_ (Code.js), unchanged: breadcrumb, Run Log step, timing,
// Feature Flags. The list is ordered by what you'd notice missing first (#256 §3).

var NIGHT_PART_BUDGET_MS_ = 4 * 60 * 1000;   // a part's own deadline; Google's limit is 6 min
var NIGHT_MAX_PARTS_      = 6;
var NIGHT_MAX_AGE_MS_     = 8 * 60 * 60 * 1000;   // a saved night older than this is abandoned
var NIGHT_BACKUP_MS_      = 7 * 60 * 1000;   // the backup continuation, in case a part is killed
var NIGHT_HANDOFF_MS_     = 60 * 1000;       // the next part, after a normal handoff
var NIGHT_SLOW_MS_        = 90 * 1000;       // named in the summary
var NIGHT_RISK_MS_        = 150 * 1000;      // two nights running over this: a flag

/**
 * The night, in order. g: 1 what you'd notice missing · 2 data and the flags call · 3 flag
 * writers · 4 analysis (the pattern engine after every writer) · 5 housekeeping.
 * fn(ctx, st): ctx is nightlyStep_'s; st is the saved night (st.vars carries small results
 * between steps, which may run in different parts).
 */
function nightlySteps_() {
  var S = function(n, g, fn) { return { n: n, g: g, fn: fn }; };
  return [
    // ---- 1 · What you'd notice missing --------------------------------------------------
    S('escalateAgedFlags_', 1, function() { escalateAgedFlags_(); }),
    // Trip keys first: the trip emails resolve trips through them (a moved start date sent a
    // post-trip email early before this ran first).
    S('adoptLegacyTripKeys_', 1, function() { adoptLegacyTripKeys_({ dryRun: false }); }),
    S('tripIdStampAll_', 1, function() { tripIdStampAll_(); }),
    S('checkPreTripBriefings_', 1, function() { checkPreTripBriefings_(); }),
    S('checkPostTripCapture_', 1, function() { checkPostTripCapture_(); }),
    S('plCloseEndedTrips_', 1, function() { plCloseEndedTrips_(10); }),
    S('checkGymSessions_', 1, function() { checkGymSessions_(); }),
    S('checkRefills_', 1, function() { checkRefills_(); }),
    S('checkHealthAppointments_', 1, function() { checkHealthAppointments_(); }),
    S('syncCalendarBirthdaysToImportantDates_', 1, function() { syncCalendarBirthdaysToImportantDates_(); }),
    S('syncImportantDatesToCalendar_', 1, function() { syncImportantDatesToCalendar_(); }),
    S('checkImportantDates_', 1, function() { checkImportantDates_(); }),
    S('checkNoGiftIdea_', 1, function() { checkNoGiftIdea_(); }),
    S('checkExpiringCoupons_', 1, function() { checkExpiringCoupons_(); }),
    S('morningRoutineReset', 1, function() { morningRoutineReset_(); }),
    S('resetChoresByCadence_', 1, function() { resetChoresByCadence_(); }),

    // ---- 2 · Data, and the flags call --------------------------------------------------
    S('getSuppressedKeyPatterns_', 2, function(ctx, st) {
      st.vars.suppressed = getSuppressedKeyPatterns_() || [];
      if (st.vars.suppressed.length) Logger.log('SignalLearning: suppressing ' + st.vars.suppressed.length + ' noise pattern(s): ' + st.vars.suppressed.join(', '));
    }),
    S('checkPTOYearRollover_', 2, function() { checkPTOYearRollover_(); }),
    S('checkPTOStrategy_', 2, function() { checkPTOStrategy_(); }),
    S('writePTOSnapshot_', 2, function(ctx, st) {
      var stats = writePTOSnapshot_();
      nightlyStash_('NIGHTLY_PTO_STATS', stats);   // read by the flags call and the monthly review, maybe in a later part
      st.vars.ptoSub = slowestNightlySteps_(stats && stats.subTimings, 11);
      Logger.log('PTO snapshot written — vacation used: ' + (stats && stats.used ? stats.used.vacationDays : '?') + ' days.');
    }),
    S('computeTravelLegs_', 2, function(ctx) {
      var legStats = computeTravelLegs_();
      if (legStats.calls > 0 || legStats.error) Logger.log('TravelLegs: ' + legStats.calls + ' call(s), ' + legStats.cached + ' cached' + (legStats.error ? ', error: ' + legStats.error : ''));
      if (legStats.error && legStats.error !== 'no_api_key') ctx.failures.push('computeTravelLegs_: ' + legStats.error);
    }),
    // The flags call, in three steps so each is short and a later part can carry on: the
    // flags Claude found are stashed between them.
    S('collect', 2, function(ctx, st) {
      var events = getUpcomingEventsCached_(), tasks = getOpenTasks(), summaries = getSummaries(), ledger = getSharedInterestLedger_();
      Logger.log('Data collected — Events: ' + events.length + ', Tasks: ' + tasks.length + ', Summaries: ' + summaries.length + ', Interests: ' + ledger.length);
      if (!events.length && !tasks.length && !summaries.length) {
        Logger.log('nightly: no events, tasks, or summaries tonight — skipping Claude call.');
        st.vars.noData = true; nightlyStash_('NIGHTLY_FLAGS', []); return;
      }
      var flags = generateFlags(events, tasks, summaries, nightlyUnstash_('NIGHTLY_PTO_STATS'), ledger, st.vars.suppressed || []) || [];
      nightlyStash_('NIGHTLY_FLAGS', flags);
      st.vars.generated = flags.length;
    }),
    S('writeFlags', 2, function(ctx, st) {
      var flags = nightlyUnstash_('NIGHTLY_FLAGS') || [];
      if (!flags.length) { Logger.log('No flags generated tonight — nothing to write.'); return; }
      st.vars.written = writeFlags(flags);
      var by = function(u) { return flags.filter(function(f) { return f.urgency === u; }).length; };
      st.vars.hml = [by('High'), by('Medium'), by('Low')];
      Logger.log('Wrote ' + st.vars.written + ' new flags to sheet (' + (flags.length - st.vars.written) + ' deduplicated).');
    }),
    S('recordFlagsGenerated_', 2, function() {
      var keys = (nightlyUnstash_('NIGHTLY_FLAGS') || []).map(function(f) { return f.key || ''; }).filter(Boolean);
      if (keys.length) recordFlagsGenerated_(keys);
    }),

    // ---- 3 · Flag writers ----------------------------------------------------------------
    S('hfSyncUpkeepReminders_', 3, function() { hfSyncUpkeepReminders_(); }),
    S('mpSyncNudges_', 3, function() { mpSyncNudges_(); }),
    S('projSyncOverdueFlags_', 3, function() { projSyncOverdueFlags_(); }),
    S('haSyncFlags_', 3, function() { haSyncFlags_(); }),
    S('flightChangesSyncFlags_', 3, function() { flightChangesSyncFlags_(); }),
    S('myTripsSyncFlags_', 3, function() { myTripsSyncFlags_(); }),
    S('ppSyncFlags_', 3, function() { ppSyncFlags_(); }),
    S('fpSyncFlags_', 3, function() { fpSyncFlags_(); }),
    S('cySyncReminders_', 3, function() { cySyncReminders_(); }),
    S('recordExpiredFlags_', 3, function() { recordExpiredFlags_(); }),
    S('checkFitnessConsistency_', 3, function() { checkFitnessConsistency_(); }),
    S('checkFitnessTravelGap_', 3, function() { checkFitnessTravelGap_(); }),
    S('autoRestockItems_', 3, function() { autoRestockItems_(); }),
    S('generatePantryFlags_', 3, function() { generatePantryFlags_(); }),
    S('inferCapacityMode_', 3, function() { inferCapacityMode_(); }),
    S('checkContracts_', 3, function() { checkContracts_(); }),
    S('checkWarrantiesExpiring_', 3, function() { checkWarrantiesExpiring_(); }),
    S('checkHomeServiceOverdue_', 3, function() { checkHomeServiceOverdue_(); }),
    S('seedNetWorthMappingConfig_', 3, function() { seedNetWorthMappingConfig_(); }),
    S('checkPlannerCdMaturity_', 3, function() { checkPlannerCdMaturity_(); }),
    S('fsNightly_', 3, function() { fsNightly_(); }),
    S('carCredNightly_', 3, function() { carCredNightly_(); }),
    S('tpNightly_', 3, function() { tpNightly_(); }),
    S('lgNightly_', 3, function() { lgNightly_(); }),
    S('checkGenerationInputs_', 3, function() { checkGenerationInputs_(); }),
    S('seedWishListInitialsConfig_', 3, function() { seedWishListInitialsConfig_(); }),
    S('seedFlightPollConfig_', 3, function() { seedFlightPollConfig_(); }),
    S('checkWishListGifts_', 3, function() { checkWishListGifts_(); }),
    S('checkTripDecisions_', 3, function() { checkTripDecisions_(); }),
    S('checkTripDecisionPremises_', 3, function() { checkTripDecisionPremises_(); }),
    // Close last period's lapsed perk flags before raising this period's.
    S('closeExpiredPerkFlags_', 3, function() { closeExpiredPerkFlags_(); }),
    S('checkCardPerksExpiring_', 3, function() { checkCardPerksExpiring_(); }),
    S('checkCardPerksActive_', 3, function() { checkCardPerksActive_(); }),
    S('seedPerkUses_', 3, function() { seedPerkUses_(); }),
    S('checkCardHub_', 3, function() { checkCardHub_(); }),
    S('checkTaxDocuments_', 3, function() { checkTaxDocuments_(); }),
    S('checkTaxLate_', 3, function() { checkTaxLate_(); }),
    S('carNightly_', 3, function() { carNightly_(); }),
    S('carCheckAgentHealth_', 3, function() { carCheckAgentHealth_(); }),
    S('checkAgentHealth_', 3, function() { checkAgentHealth_(); }),
    S('checkVehicleRenewals_', 3, function() { checkVehicleRenewals_(); }),
    S('carCareerFlags_', 3, function() { carCareerFlags_(); }),

    // ---- 4 · Analysis --------------------------------------------------------------------
    S('checkMonthlyReview_', 4, function() {
      // Tonight's PTO numbers on the review's day (#254), already computed in group 2.
      var onDay = new Date().getDate() === schedDom_('finance_review_day', 1);
      checkMonthlyReview_(onDay ? (nightlyUnstash_('NIGHTLY_PTO_STATS') || writePTOSnapshot_()) : null);
    }),
    S('sendHealthPerformanceInsightMonthly_', 4, function() {
      if (new Date().getDate() === schedDom_('health_insight_day', 1)) sendHealthPerformanceInsightMonthly_();
    }),
    // The one step that reads tonight's flags (it counts High flags into the week's load), so
    // it waits for every writer above; on a night where one was skipped or killed it's withheld.
    S('checkCrossPatternFlags_', 4, function() { checkCrossPatternFlags_(); }),
    S('suggestDueDates', 4, function() { suggestDueDates(getOpenTasks()); }),
    S('carMonthlyWinsBank_', 4, function() { carMonthlyWinsBank_(); }),
    S('carSuggestCriteria_', 4, function() { carSuggestCriteria_(); }),
    S('runExplorer_', 4, function() { runExplorer_(); }),
    S('writeWeeklySnapshot_', 4, function() { writeWeeklySnapshot_(); }),
    S('sendWeeklyTrendReview_', 4, function() { sendWeeklyTrendReview_(); }),

    // ---- 5 · Housekeeping, last -----------------------------------------------------------
    S('purgeExpiredCoupons_', 5, function() { purgeExpiredCoupons_(); }),
    S('purgeOldFlyers_', 5, function() { purgeOldFlyers_(); }),
    S('pruneMemoryLog_', 5, function() { pruneMemoryLog_(); }),
    S('pruneSystemLog_', 5, function() { pruneSystemLog_(); }),
    S('pruneApiHealthState_', 5, function() { pruneApiHealthState_(); }),
    S('purgeRetiredConfig_', 5, function() { purgeRetiredConfig_(); }),   // before the property prune (Features.js, #254)
    S('pruneScriptProperties_', 5, function() { pruneScriptProperties_(); }),
    S('veraSettingsCopyRefresh_', 5, function() { veraSettingsCopyRefresh_(); }),
    S('accessNightlySync_', 5, function() { accessNightlySync_(); }),
    S('purgePastPerkReminderEvents_', 5, function() { purgePastPerkReminderEvents_(PERK_EVENT_PURGE_LOOKBACK_DAYS_, false); }),
    S('scrubLoggedSecrets_', 5, function() { scrubLoggedSecrets_(); }),
    // Last: it reads external sheets (the step most able to stall), and tomorrow's collect
    // reads what it writes.
    S('writeSummarySnapshot', 5, function() { writeSummarySnapshot(); }),
  ];
}

/** The morning routine's checkboxes, cleared for the new day. */
function morningRoutineReset_() {
  var mrSheet = getSpreadsheet().getSheetByName(TABS.MORNING_ROUTINE);
  if (mrSheet && mrSheet.getLastRow() > 1) {
    var mrRows = mrSheet.getLastRow() - 1, resetVals = [];
    for (var i = 0; i < mrRows; i++) resetVals.push([false, '']);
    mrSheet.getRange(2, 5, mrRows, 2).setValues(resetVals);   // Checked, Checked At
    Logger.log('Morning routine: reset ' + mrRows + ' item(s) to unchecked.');
  }
}

// ---- The saved night ---------------------------------------------------------------------
/** Small results between steps that may run in different parts: the VERA State store. */
function nightlyStash_(key, value) { try { veraStoreSet_(key, JSON.stringify(value == null ? null : value)); } catch (e) { Logger.log('nightlyStash_ ' + key + ': ' + e.message); } }
function nightlyUnstash_(key) { try { return JSON.parse(veraStoreGet_(key) || 'null'); } catch (e) { return null; } }

/** Pure: a new night. */
function nightlyNewState_(nowMs, nightId) {
  return { id: nightId, started: nowMs, next: 0, part: 0, handoff: false, failures: [], skipped: [], blocked: [], killed: [], timings: [], vars: {} };
}
function nightlyLoad_() { try { return JSON.parse(veraStateGet_('NIGHT').NIGHTLY_RESUME || 'null'); } catch (e) { return null; } }
/** Saved with its lists capped, so it always fits the 9 KB a property holds. */
function nightlySave_(st) {
  var cut = function(a, n, len) { return (a || []).slice(-n).map(function(x) { return typeof x === 'string' ? x.slice(0, len) : x; }); };
  var copy = JSON.parse(JSON.stringify(st));
  copy.failures = cut(copy.failures, 15, 200); copy.skipped = cut(copy.skipped, 90, 60); copy.blocked = cut(copy.blocked, 10, 200);
  copy.killed = cut(copy.killed, 10, 60); copy.timings = cut(copy.timings, 100, 0);
  try { veraStateSet_('NIGHT', { NIGHTLY_RESUME: JSON.stringify(copy) }); } catch (e) { Logger.log('nightlySave_: ' + e.message); }
}
function nightlyClear_() { try { veraStateSet_('NIGHT', { NIGHTLY_RESUME: null }); } catch (e) {} }

/**
 * Pure: where a continuation starts. A part that handed off saved its place; one that was
 * killed left its breadcrumb ("step|seconds") and no handoff: that step was killed, and the
 * night goes on from the one after it. → {next, killed: name or ''}
 */
function nightlyResumeAt_(st, crumb, names) {
  if (!st) return { next: 0, killed: '' };
  if (st.handoff || !crumb) return { next: st.next, killed: '' };
  var name = String(crumb).split('|')[0], i = names.indexOf(name);
  return i === -1 ? { next: st.next, killed: '' } : { next: Math.max(st.next, i + 1), killed: name };
}

/** Pure: the pattern engine's gate: every writer ran tonight. */
function nightlyCrossGate_(st) {
  var gone = (st.skipped || []).concat(st.killed || []);
  return gone.length ? { ok: false, reason: 'tonight ' + gone.length + ' step(s) didn’t run (' + gone.slice(0, 3).join(', ') + (gone.length > 3 ? '…' : '') + ')' } : { ok: true, reason: '' };
}

// ---- Triggers for the next part ------------------------------------------------------------
function nightlyDropContinues_() {
  try { ScriptApp.getProjectTriggers().forEach(function(t) { if (t.getHandlerFunction() === 'nightlyContinue') ScriptApp.deleteTrigger(t); }); } catch (e) { Logger.log('nightlyDropContinues_: ' + e.message); }
}
function nightlyScheduleContinue_(afterMs) {
  nightlyDropContinues_();
  try { ScriptApp.newTrigger('nightlyContinue').timeBased().after(afterMs).create(); return true; }
  catch (e) { Logger.log('nightlyScheduleContinue_: ' + e.message); return false; }
}

// ---- The entry points ------------------------------------------------------------------------
/** The night's trigger (nightly_run_hour). Starts tonight's list from the top. */
function nightlyRun() {
  try { runLogStart_('nightlyRun', arguments[0]); } catch (rlErr) {}
  var now = Date.now();
  var prev = nightlyLoad_();
  if (prev && prev.next < nightlySteps_().length) Logger.log('nightlyRun: the previous night stopped at step ' + prev.next + ' (' + prev.id + ') and is replaced by tonight’s.');
  try { PropertiesService.getScriptProperties().setProperty('LAST_NIGHTLY_START', new Date(now).toISOString()); } catch (e) {}
  try { PropertiesService.getScriptProperties().deleteProperty(NIGHTLY_STEP_PROP_); } catch (e) {}
  Logger.log('=== VERA nightly run started: ' + new Date(now) + ' ===');
  var st = nightlyNewState_(now, Utilities.formatDate(new Date(now), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  nightlyRunPart_(st);
}

/** A one-off trigger: the next part of tonight's list (or the backup after a killed part). */
function nightlyContinue() {
  nightlyDropContinues_();
  var st = nightlyLoad_();
  if (!st) { Logger.log('nightlyContinue: no night in progress.'); return; }
  if (Date.now() - st.started > NIGHT_MAX_AGE_MS_) { Logger.log('nightlyContinue: night ' + st.id + ' is too old; dropped.'); nightlyClear_(); return; }
  try { runLogStart_('nightlyRun', arguments[0]); } catch (rlErr) {}
  var crumb = ''; try { crumb = PropertiesService.getScriptProperties().getProperty(NIGHTLY_STEP_PROP_) || ''; } catch (e) {}
  var names = nightlySteps_().map(function(s) { return s.n; });
  var at = nightlyResumeAt_(st, crumb, names);
  if (at.killed) {
    st.killed.push(at.killed);
    Logger.log('nightlyContinue: the last part was cut off during ' + at.killed + '; going on from the next step.');
  }
  st.next = at.next;
  nightlyRunPart_(st);
}

/** The old second half's trigger, if it's still there: removes itself (the night is one list now). */
function nightlyRunTail() {
  try { ScriptApp.getProjectTriggers().forEach(function(t) { if (t.getHandlerFunction() === 'nightlyRunTail') ScriptApp.deleteTrigger(t); }); } catch (e) {}
  Logger.log('nightlyRunTail: retired — the night continues itself now (NightlyRunner.js). Its trigger was removed.');
}

/** One part: steps until the part's time is up, then hand off; or the end of the list. */
function nightlyRunPart_(st) {
  var steps = nightlySteps_(), partStart = Date.now();
  st.part++; st.handoff = false;
  // A backup continuation before any work, so a part killed by the limit is picked up.
  if (st.part < NIGHT_MAX_PARTS_) nightlyScheduleContinue_(NIGHT_BACKUP_MS_);
  nightlySave_(st);
  var ctx = { runStart: partStart, deadline: partStart + NIGHT_PART_BUDGET_MS_, failures: st.failures, skipped: [], blocked: st.blocked, timings: st.timings };
  try { if (typeof runLogNote_ === 'function') runLogNote_('nightlyRun', '', 'night ' + st.id + ' · part ' + st.part, ''); } catch (e) {}
  Logger.log('Nightly part ' + st.part + ' from step ' + st.next + ' (' + (steps[st.next] ? steps[st.next].n : 'end') + ').');
  var since = 0;
  while (st.next < steps.length) {
    var s = steps[st.next];
    var gate = s.n === 'checkCrossPatternFlags_' ? nightlyCrossGate_(st) : null;
    var ran = nightlyStep_(ctx, s.n, function() { s.fn(ctx, st); }, gate);
    if (!ran && ctx.skipped.length) {   // out of time for this part: hand off
      ctx.skipped.length = 0;
      if (st.part >= NIGHT_MAX_PARTS_) {
        steps.slice(st.next).forEach(function(r) { st.skipped.push(r.n); });
        st.next = steps.length;
        Logger.log('Nightly: ' + NIGHT_MAX_PARTS_ + ' parts used; the rest is skipped tonight.');
        break;
      }
      st.handoff = true;
      try { PropertiesService.getScriptProperties().deleteProperty(NIGHTLY_STEP_PROP_); } catch (e) {}
      nightlySave_(st);
      nightlyScheduleContinue_(NIGHT_HANDOFF_MS_);
      Logger.log('Nightly part ' + st.part + ' handed off at step ' + st.next + ' (' + s.n + ') after ' + Math.round((Date.now() - partStart) / 1000) + 's.');
      try { if (typeof runLogHandoff_ === 'function') runLogHandoff_(ctx, 'night ' + st.id + ' · part ' + st.part + ' · continues at ' + s.n); } catch (e) {}
      try { flushSystemLog_(); } catch (e) {}
      return;
    }
    st.next++;
    if (++since >= 5) { since = 0; nightlySave_(st); }   // now and then, so a killed part loses little
  }
  nightlyDropContinues_();
  nightlyFinish_(st);
}

// ---- The end of the night ---------------------------------------------------------------------
/** Pure: the #vera-logs summary line. */
function nightlySummaryLine_(st, elapsedS) {
  var v = st.vars || {}, w = v.written || 0, hml = v.hml || [0, 0, 0], ded = (v.generated || 0) - w;
  var s = '✅ Nightly run — ' + (v.noData ? '0 flags (no data)' : w + ' new flag' + (w !== 1 ? 's' : '') + ' written' + (w ? ' (' + hml[0] + ' High, ' + hml[1] + ' Med, ' + hml[2] + ' Low)' : ''));
  if (ded > 0) s += ' · ' + ded + ' deduplicated';
  s += ' · ' + st.part + ' part' + (st.part === 1 ? '' : 's') + ' · ' + (st.timings || []).length + ' steps';
  if ((st.failures || []).length) s += ' · ' + st.failures.length + ' step warning' + (st.failures.length > 1 ? 's' : '');
  if ((st.killed || []).length) s += ' · ' + st.killed.length + ' cut off (' + st.killed.join(', ') + ')';
  if ((st.skipped || []).length) s += ' · ' + st.skipped.length + ' skipped (out of parts)';
  if ((st.blocked || []).length) s += ' · ' + st.blocked.length + ' withheld';
  return s + ' in ' + elapsedS + 's';
}
/** Pure: steps over the slow mark tonight, slowest first: "writePTOSnapshot_ 124.0s". */
function nightlySlowSteps_(timings, overMs) {
  return (timings || []).filter(function(t) { return t.ms >= overMs; }).sort(function(a, b) { return b.ms - a.ms; })
    .map(function(t) { return t.name + ' ' + (t.ms / 1000).toFixed(1) + 's'; });
}
/**
 * Pure: steps cut off, or near the limit, on two nights running → [step], and the map to keep.
 * prev: {step: 'yyyy-MM-dd'} from the last night; tonight: names; today: tonight's id; yesterday's id.
 */
function nightlyRepeatOffenders_(prev, tonight, today, yesterday) {
  var keep = {}, repeat = [];
  (tonight || []).forEach(function(n) { if ((prev || {})[n] === yesterday) repeat.push(n); keep[n] = today; });
  return { repeat: repeat, keep: keep };
}

/** Pure: the notifications count line for the night's day (nightId), given notifCounts_() and today's date. */
function nightlyCountLine_(nc, nightId, today) {
  nc = nc || {};
  if (nightId === today) return notifCountLine_(nc.counts || {}).replace(/^Yesterday/, 'Today');
  return notifCountLine_(nc.yesterday || {});
}

function nightlyFinish_(st) {
  var elapsed = Math.round((Date.now() - st.started) / 1000);
  Logger.log('=== VERA nightly run complete: ' + new Date() + ' (' + st.part + ' part(s)) ===');
  try {
    sendSlackLog_(nightlySummaryLine_(st, elapsed));
    if (st.failures.length) sendSlackLog_('⚠️ Step warnings:\n' + st.failures.map(function(f) { return '• ' + f; }).join('\n'));
    if (st.skipped.length) sendSlackLog_('⏭️ Skipped (out of parts):\n' + st.skipped.map(function(f) { return '• ' + f; }).join('\n'));
    if (st.blocked.length) sendSlackLog_('🚧 Withheld — incomplete input:\n' + st.blocked.map(function(f) { return '• ' + f; }).join('\n'));
    var slowest = slowestNightlySteps_(st.timings, 5), slow = nightlySlowSteps_(st.timings, NIGHT_SLOW_MS_);
    if (slowest.length) sendSlackLog_('⏱️ Slowest steps: ' + slowest.join(' · ') + (slow.length ? '\n⚠️ Over 90 s: ' + slow.join(' · ') : ''));
    if ((st.vars.ptoSub || []).length) sendSlackLog_('⏱️ writePTOSnapshot_ breakdown: ' + st.vars.ptoSub.join(' · '));
    // The night's own day: today's counts before midnight, yesterday's if the last part ran past it.
    try { if (typeof notifCountLine_ === 'function') sendSlackLog_('📊 ' + nightlyCountLine_(notifCounts_(), st.id, Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'))); } catch (ncErr) {}
    veraLog_('nightlyRun', 'Nightly', st.failures.length || st.killed.length || st.skipped.length || st.blocked.length ? 'Partial' : 'Success',
      nightlySummaryLine_(st, elapsed).replace(/^\S+ /, '') + (slowest.length ? ' · slowest: ' + slowest.join(', ') : ''), elapsed * 1000,
      st.failures.join('; '));
  } catch (sumErr) { Logger.log('nightly summary (non-fatal): ' + sumErr.message); }
  // Two nights running: a step cut off, or one near the limit, raises one flag naming it.
  try { nightlyRepeatFlags_(st); } catch (e) { Logger.log('nightlyRepeatFlags_ (non-fatal): ' + e.message); }
  try { PropertiesService.getScriptProperties().deleteProperty(NIGHTLY_STEP_PROP_); } catch (e) {}
  try { PropertiesService.getScriptProperties().setProperty('LAST_NIGHTLY_RUN', new Date().toISOString()); } catch (e) {}
  try { featureNoteSteps_(st.timings); } catch (e) {}
  try { recordHeartbeat_('nightlyRun'); } catch (e) {}
  nightlyClear_();
  try { flushSystemLog_(); } catch (e) {}
}

function nightlyRepeatFlags_(st) {
  var tz = Session.getScriptTimeZone(), y = Utilities.formatDate(new Date(new Date(st.id + 'T12:00:00').getTime() - 86400000), tz, 'yyyy-MM-dd');
  var prev = {}; try { prev = JSON.parse(veraStateGet_('NIGHT').NIGHTLY_KILLED || '{}') || {}; } catch (e) {}
  var risky = (st.killed || []).concat((st.timings || []).filter(function(t) { return t.ms >= NIGHT_RISK_MS_; }).map(function(t) { return t.name; }));
  var r = nightlyRepeatOffenders_(prev, risky, st.id, y);
  veraStateSet_('NIGHT', { NIGHTLY_KILLED: Object.keys(r.keep).length ? JSON.stringify(r.keep) : null });
  if (!r.repeat.length) return;
  writeFlags(r.repeat.map(function(n) {
    var killed = (st.killed || []).indexOf(n) !== -1;
    return { source: 'System', flag: n + (killed ? ' was cut off two nights running' : ' ran near the 6-minute limit two nights running'),
      reason: killed ? 'Google stopped the nightly run during this step on two nights in a row; the rest of the night carried on without it.'
                     : 'It took over ' + Math.round(NIGHT_RISK_MS_ / 1000) + ' s two nights in a row. One more slowdown and it gets cut off.',
      urgency: 'Medium', key: 'nightly_step_' + n };
  }));
}
