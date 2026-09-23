// ============================================================
// VERA — TestBench.js
// One place to run every manual check, by hand, from the editor.
// ============================================================
//
// WHY THIS FILE EXISTS
// The Run menu lists 200+ functions, so it is not a menu — it is a haystack.
// This file is the index: open it, scan the sections, pick a function, run it.
//
// Most entries are one-line callouts to the real implementation, which stays
// where it belongs next to the code it tests. Nothing here reimplements
// anything — if a test drifts from its feature, that is a bug in the feature's
// own file, not here.
//
// HOW TO RUN ONE
//   1. Set any knobs you need in the KNOBS block below.
//   2. Pick the function from the Run dropdown.
//   3. Read the Execution log.
//
// APPS SCRIPT CANNOT PASS ARGUMENTS FROM THE RUN MENU. That is the whole
// reason for the knobs: anything that needs a date, a window or a trip is set
// as a constant here rather than as a parameter you would have no way to fill
// in. Edit, save, run.
//
// THESE SEND FOR REAL. Where a once-per-trip or once-per-week guard would
// otherwise make a second run silently do nothing, the wrapper clears it first
// and says so in the log — a test that quietly no-ops is worse than no test.
// The two exceptions are called out in their own comments.
// ============================================================


// ============================================================
// KNOBS — edit these, then run
// ============================================================

/**
 * Treat this date as "today" for the travel-day briefing.
 * Format 'yyyy-MM-dd'. Blank = the real today.
 * Use it to preview the briefing for a trip day that is not today.
 */
var TB_DATE = '';

/**
 * Widen the pre-trip departure window, in hours. 0 = use the configured value
 * (pretrip_briefing_hours, default 48).
 * Set it to e.g. 336 (14 days) to preview a brief for a trip further out.
 */
var TB_PRETRIP_HOURS = 0;

/**
 * Trip to target where a test needs one, as it appears on the calendar.
 * Blank = whichever trip the function picks on its own.
 */
var TB_TRIP_LABEL = '';


// ============================================================
// 1. HEALTH & CONNECTIONS — is anything broken?
// ============================================================

/** API health: per-service success/failure counts and recent errors. */
function tbApiHealth() {
  tbBanner_('API health');
  debugApiHealth();
}

/** Watchdog: nightly-run freshness, stale tabs, missing triggers. */
function tbSystemHealth() {
  tbBanner_('System health');
  debugSystemHealth();
}

/** Weather API: geocoding plus a live forecast fetch. */
function tbWeather() {
  tbBanner_('Weather API');
  testWeather();
}

/** Claude: one round trip through the real chat path. */
function tbClaude() {
  tbBanner_('Claude round trip');
  testChat();
}

/** Every tab the code expects, and whether its headers match the constants. */
function tbSheetIntegrity() {
  tbBanner_('Sheet integrity');
  var ss = getSpreadsheet();
  var missing = [], present = 0;
  Object.keys(TABS).forEach(function(k) {
    var name = TABS[k];
    if (ss.getSheetByName(name)) present++;
    else missing.push(k + ' ("' + name + '")');
  });
  Logger.log(present + ' of ' + Object.keys(TABS).length + ' tabs present');
  if (missing.length) {
    Logger.log('MISSING — run setupVERA() to create these:');
    missing.forEach(function(m) { Logger.log('  · ' + m); });
  } else {
    Logger.log('No tabs missing.');
  }
}

/** Which calendars VERA can actually see, and how they are classified. */
function tbCalendarAccess() {
  tbBanner_('Calendar access');
  try {
    var cfg = readPTOConfig_();
    var cals = CalendarApp.getAllCalendars();
    Logger.log(cals.length + ' calendar(s) visible to this account:');
    cals.forEach(function(c) { Logger.log('  · ' + c.getName()); });
    Logger.log('VERA writes only to: "' + cfg.veraCalendarName + '"');
    Logger.log('  ' + (getCalendarByName_(cfg.veraCalendarName) ? 'FOUND' : 'NOT FOUND — events cannot be created'));
  } catch (e) {
    Logger.log('FAILED: ' + e.message);
  }
}


// ============================================================
// 2. DAILY & WEEKLY EMAILS — the things that land in your inbox
// ============================================================

/** The full nightly run: every check, flag generation, the lot. Slow. */
function tbNightlyRun() {
  tbBanner_('Nightly run (full)');
  nightlyRun();
}

/** The morning nudge email. */
function tbMorningNudge() {
  tbBanner_('Morning nudge email');
  morningNudge();
}

/**
 * The weekend memo — DRY RUN. Builds everything, logs the prompt and the memo,
 * sends nothing. One of the two exceptions to "these send for real", because
 * it writes anti-repeat history that a test must not pollute.
 */
function tbWeekendMemoDryRun() {
  tbBanner_('Weekend memo (DRY RUN — nothing sent)');
  testWeekendMemo();
}

/** The weekend memo FOR REAL — email, Slack ping, calendar event, cooldown. */
function tbWeekendMemoSend() {
  tbBanner_('Weekend memo (REAL SEND)');
  clearReminderEntry_('weekend_planner');   // else the 6.25-day cooldown skips it
  Logger.log('Cleared the weekend_planner cooldown so this actually sends.');
  runWeekendPlanner_();
}

/** The weekly trend review email. */
function tbWeeklyTrendReview() {
  tbBanner_('Weekly trend review');
  sendWeeklyTrendReview_();
}

/** The hourly anticipator rules (hydration, bills, ergonomic breaks…). */
function tbHourlyCheck() {
  tbBanner_('Hourly anticipator rules');
  testHourlyCheck();
}

/** The daily AI discovery bulletin. Clears today's entry so it re-sends. */
function tbDailyDiscovery() {
  tbBanner_('Daily discovery');
  testExplorer();
}


// ============================================================
// 3. TRAVEL
// ============================================================

/**
 * Pre-trip briefing. Honours TB_PRETRIP_HOURS to reach a trip further out,
 * and clears the per-trip flag first so a second run is not deduplicated away.
 */
function tbPreTripBriefing() {
  tbBanner_('Pre-trip briefing');
  var cleared = tbClearFlagsByKeyPrefix_('pretrip_briefing_');
  Logger.log('Cleared ' + cleared + ' existing pre-trip flag(s) so this can fire again.');
  if (TB_PRETRIP_HOURS) Logger.log('Window override: ' + TB_PRETRIP_HOURS + 'h');
  checkPreTripBriefings_({ hoursOverride: TB_PRETRIP_HOURS });
}

/**
 * Travel-day briefing. Honours TB_DATE — set it to a date that has itinerary
 * rows and the briefing is built as though that day were today.
 */
function tbTravelDayBriefing() {
  tbBanner_('Travel-day briefing');
  if (TB_DATE) Logger.log('Date override: ' + TB_DATE);
  else Logger.log('No TB_DATE set — using today. Fires only if a trip has itinerary rows dated today.');
  checkAndSendTravelDayBriefings_({ dateOverride: TB_DATE });
}

/** Post-trip debrief prompt. Clears the flag so it can fire again. */
function tbPostTripCapture() {
  tbBanner_('Post-trip capture');
  var cleared = tbClearFlagsByKeyPrefix_('posttrip_capture_');
  Logger.log('Cleared ' + cleared + ' existing post-trip flag(s).');
  checkPostTripCapture_();
}

/** Tentative-hold decisions: what is unresolved and what VERA recommends. */
function tbTripDecisions() {
  tbBanner_('Trip decisions');
  checkTripDecisions_();
  checkTripDecisionPremises_();
}

/**
 * Packing list generation for a trip. Set TB_TRIP_LABEL, or leave it blank to
 * use the next upcoming trip.
 */
function tbGeneratePacking() {
  tbBanner_('Packing list generation');
  var trip = tbPickTrip_();
  if (!trip) return;
  var res = webGeneratePacking_({ parameter: {
    tripKey: trip.startDate + '|' + trip.label,
    startDate: trip.startDate, endDate: trip.endDate } });
  Logger.log('Generated ' + ((res && res.items && res.items.length) || 0) + ' packing item(s).');
}

/** Discovery/recommendation generation for a trip. Uses TB_TRIP_LABEL. */
function tbGenerateDiscoveries() {
  tbBanner_('Discoveries (recommendations)');
  var trip = tbPickTrip_();
  if (!trip) return;
  var res = webGenerateRecommendations_({ parameter: {
    tripKey: trip.startDate + '|' + trip.label,
    startDate: trip.startDate, endDate: trip.endDate } });
  Logger.log('Generated ' + ((res && res.recs && res.recs.length) || 0) + ' recommendation(s).');
}

/** What VERA thinks each upcoming trip is and where it goes. */
function tbTripContext() {
  tbBanner_('Trip context');
  var trips = getUpcomingTravel_(readPTOConfig_());
  if (!trips.length) { Logger.log('No upcoming trips.'); return; }
  trips.forEach(function(t) {
    var key = t.startDate + '|' + t.label;
    var meta = {};
    try { meta = webGetTripMeta_({ parameter: { tripKey: key } }) || {}; } catch (e) {}
    Logger.log('· ' + t.label + '  (' + t.startDate + ' → ' + t.endDate + ', in ' + t.daysAway + 'd)');
    Logger.log('    context:  ' + (meta.context  || '(none)'));
    Logger.log('    briefing: ' + (meta.notes    || '(none)'));
    Logger.log('    traveler: ' + (meta.traveler || '(none)'));
  });
}

/** Flight status scan for tracked flights. */
function tbFlightStatus() {
  tbBanner_('Flight status');
  debugFlightStatusScan();
}


// ============================================================
// 4. DATA & TRACKERS — sheet readers and writers
// ============================================================

/** PTO balances, accrual and suggested windows. */
function tbPTO()             { tbBanner_('PTO');              testPTO(); }

/** Gym session detection from the calendar. */
function tbGym()             { tbBanner_('Gym sessions');     testCheckGymSessions(); }

/** Fitness consistency checks. */
function tbFitness()         { tbBanner_('Fitness checks');   testFitnessChecks(); }

/** Pantry stock and consumption. */
function tbPantry()          { tbBanner_('Pantry');           testPantry(); }

/** Shopping list state. */
function tbShopping()        { tbBanner_('Shopping list');    testShoppingList(); }

/** Important dates: what is approaching and what would be flagged. */
function tbImportantDates()  { tbBanner_('Important dates');  testCheckImportantDates(); }

/** Financial goal projections. */
function tbFinancialGoals()  { tbBanner_('Financial goals');  debugProjections(); }

/** Projects: creates a throwaway test project. Delete its rows afterwards. */
function tbProjects()        { tbBanner_('Projects (WRITES a test project)'); testCreateProject(); }

/** Every project's health verdict, next action and owner — reads only. */
function tbProjectHealth() {
  tbBanner_('Project health');
  var projects = getProjects_();
  if (!projects.length) { Logger.log('No projects.'); return; }
  projects.forEach(function(p) {
    Logger.log('· ' + p.projectName + '  [' + p.owner + ']  ' +
               p.health.toUpperCase() + ' — ' + p.healthReason);
    Logger.log('    ' + p.done + '/' + p.total + ' done' +
               (p.targetDate ? ', target ' + p.targetDate : '') +
               (p.nextTask ? ', next: ' + p.nextTask.task : ', nothing to pick up'));
  });
}


// ============================================================
// HELPERS — private, not part of the index
// ============================================================

function tbBanner_(what) {
  Logger.log('========================================');
  Logger.log('  ' + what);
  Logger.log('  ' + new Date().toString());
  Logger.log('========================================');
}

/**
 * Deletes Flags rows whose Key starts with a prefix, so a flag-deduplicated
 * feature can fire again.
 *
 * writeFlags() fingerprints against EVERY flag ever written — open,
 * acknowledged, snoozed or resolved — so without this a second run of a
 * once-per-trip briefing is silently skipped and looks like a broken test.
 *
 * @returns {number} rows deleted
 */
function tbClearFlagsByKeyPrefix_(prefix) {
  var sheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var n    = sheet.getLastRow() - 1;
  var keys = sheet.getRange(2, 10, n, 1).getValues();   // column J — the stable key
  var removed = 0;
  // Bottom-up: deleting a row shifts everything below it.
  for (var i = keys.length - 1; i >= 0; i--) {
    if (String(keys[i][0] || '').trim().toLowerCase().indexOf(prefix.toLowerCase()) === 0) {
      sheet.deleteRow(i + 2);
      removed++;
    }
  }
  return removed;
}

/** The trip named by TB_TRIP_LABEL, else the next upcoming one. Logs and returns null if none. */
function tbPickTrip_() {
  var trips = getUpcomingTravel_(readPTOConfig_());
  if (!trips.length) { Logger.log('No upcoming trips to work with.'); return null; }
  if (TB_TRIP_LABEL) {
    var want = TB_TRIP_LABEL.toLowerCase();
    for (var i = 0; i < trips.length; i++) {
      if (String(trips[i].label).toLowerCase().indexOf(want) !== -1) {
        Logger.log('Trip: ' + trips[i].label + ' (' + trips[i].startDate + ' → ' + trips[i].endDate + ')');
        return trips[i];
      }
    }
    Logger.log('No trip matching TB_TRIP_LABEL="' + TB_TRIP_LABEL + '". Available:');
    trips.forEach(function(t) { Logger.log('  · ' + t.label); });
    return null;
  }
  Logger.log('Trip: ' + trips[0].label + ' (' + trips[0].startDate + ' → ' + trips[0].endDate +
             ')  — set TB_TRIP_LABEL to choose another');
  return trips[0];
}
