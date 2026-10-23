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

/**
 * Airports for tbLoungeAccess(), e.g. 'TPA,IAD'. First one is treated as the
 * departure, the rest as layovers.
 *
 * Set it to check lounge matching on a day with no trip on the calendar — the
 * diagnostic otherwise has no airport to look up and stops at gate 3. Blank =
 * scan the itinerary for TB_DATE (or today).
 */
var TB_AIRPORTS = '';

/**
 * Trip to test trip lessons against, as
 * 'destination|context|activity,activity|trait,trait'
 * e.g. '|Family Trip||beach' \u2014 a family beach trip with nothing scheduled yet.
 *
 * Any part may be blank: '|Family Trip||' tests context alone. Blank overall = show
 * every lesson on file without matching.
 *
 * The fourth segment is the trip's Characteristics, and it is the one that usually
 * matters: a lesson scoped trait:beach fires on it with no beach-typed itinerary
 * row anywhere, which is exactly the case the third segment cannot express.
 *
 * It is a made-up trip on purpose. A lesson is worth checking BEFORE the trip it
 * is meant to help exists on the calendar, and the point of the check is whether
 * the scope you chose will actually match.
 */
var TB_LESSON_TRIP = '';


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

    // What the scan actually costs, and whether the memo is doing its job. The nightly
    // run used to do this scan four times; it now does it once and three later steps
    // read the memo. Cold then warm, so the second number is the saving per extra
    // consumer.
    invalidateUpcomingEvents_();
    invalidateCalendarAdvanced_();
    var t0 = Date.now();
    var cold = getUpcomingEventsCached_();
    var coldMs = Date.now() - t0;
    var t1 = Date.now();
    var warm = getUpcomingEventsCached_();
    var warmMs = Date.now() - t1;
    Logger.log('Scan cost: cold ' + (coldMs / 1000).toFixed(1) + 's for ' + cold.length +
               ' event(s), warm ' + warmMs + 'ms for ' + warm.length +
               ' — each extra consumer in one execution now costs the warm number.');
    Logger.log('Calendar advanced service (per-event timezones): ' +
      (_calendarAdvancedUnavailable_
        ? 'NOT ENABLED — every event falls back to the script timezone. Fix: Cloud ' +
          'Console -> APIs & Services -> enable "Google Calendar API".'
        : 'OK'));
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
  // force: the day's send is latched now, so without this a second run would
  // silently do nothing and look exactly like "no trip today".
  Logger.log('Forcing a re-send past the once-per-day guard.');
  checkAndSendTravelDayBriefings_({ dateOverride: TB_DATE, force: true });
}

/**
 * Why the travel-day map is blank. Fetches the static-map URL server-side and
 * prints what Google actually says — the one Google call this codebase otherwise
 * never makes itself. Sends nothing, writes nothing. Honours TB_DATE.
 */
function tbTravelDayMap() {
  tbBanner_('Travel-day map diagnostic');
  diagnoseTravelDayMap_(TB_DATE);
}

/**
 * Is the Maps Static API switched on, and does the key reach it?
 *
 * NO KNOBS, NO ITINERARY. tbTravelDayMap above needs a travel day carrying two
 * mappable stops before it will fetch anything, so using it to check the API means
 * guessing a date, setting TB_DATE, and waiting on the enrichment's web searches —
 * and a day with fewer than two stops answers nothing at all. This runs any day, in
 * about a second, which is what you want when the question is yes or no.
 *
 * Fetches one small two-marker map. Reads only; costs a single Static Maps load.
 */
function tbMapsStaticKey() {
  tbBanner_('Maps Static API key');
  var r = probeStaticMapsKey_();

  if (r.reason === 'no key') {
    Logger.log('STOP — GOOGLE_STATIC_MAPS_API_KEY is not set.');
    Logger.log('  Set it in Project Settings -> Script Properties. Without it the');
    Logger.log('  travel email hides the whole "Today\'s Route" block.');
    return;
  }
  if (r.reason === 'fetch threw') {
    Logger.log('FAIL — the request threw: ' + r.body);
    return;
  }

  Logger.log('HTTP ' + r.code + '   Content-Type: ' + (r.contentType || '(none)'));
  if (r.ok) {
    Logger.log('PASS — Google returned an image, so the API is enabled and the key reaches it.');
    Logger.log('  If a real travel email still shows a blank box, the cause is the markers,');
    Logger.log('  not the API: run tbTravelDayMap() on that trip day.');
    return;
  }

  Logger.log('Google said:');
  String(r.body || '(empty body)').split('\n').slice(0, 6)
    .forEach(function(line) { Logger.log('  ' + line); });
  if (r.verdict) r.verdict.lines.forEach(function(line) { Logger.log(line); });
}

/**
 * Why LOUNGE ACCESS is empty. Walks the five gates in order and stops at the
 * first that fails, printing every Card Perks row and whether it matched.
 *
 * Set TB_AIRPORTS (e.g. 'TPA,IAD') to run this on a day with no trip — without
 * it the diagnostic stops at gate 3 for want of an airport. Sends nothing.
 */
function tbLoungeAccess() {
  tbBanner_('Lounge access diagnostic');
  if (TB_AIRPORTS) Logger.log('Airport override: ' + TB_AIRPORTS);
  else Logger.log('No TB_AIRPORTS set — scanning the itinerary. Set it to e.g. ' +
                  '\'TPA,IAD\' to test without a trip today.');
  diagnoseLoungeAccess_(TB_DATE, TB_AIRPORTS);
}

/**
 * What the registry thinks each trip is. READ-ONLY — sends nothing, writes
 * nothing, mints nothing.
 *
 * Run this FIRST. It prints every upcoming trip's Trip ID, every key string it
 * answers to, and the end date post-trip would now compute — which is what
 * confirms a trip that split into two keys has been put back together before
 * anything acts on it.
 */
function tbTripIdentity() {
  tbBanner_('Trip identity');
  diagnoseTripIdentity_();
}

/**
 * Every trip lesson on file, and which would fire for TB_LESSON_TRIP. READ ONLY.
 *
 * Set TB_LESSON_TRIP to 'destination|context|activity,activity' — e.g.
 * 'Orlando, Florida|Family|dining'. Blank shows all lessons with no matching.
 *
 * Worth running after recording a lesson, because the failure mode is silent:
 * a lesson scoped to something the next trip will not match is indistinguishable
 * from no lesson at all until the packing list comes back missing the hat again.
 */
function tbTripLessons() {
  tbBanner_('Trip lessons');

  var parts   = String(TB_LESSON_TRIP || '').split('|');
  var trip = {
    destination:   (parts[0] || '').trim(),
    context:       (parts[1] || '').trim(),
    activityTypes: {},
    traits:        (parts[3] || '').trim(),
  };
  (parts[2] || '').split(',').forEach(function(a) {
    var t = a.trim().toLowerCase();
    if (t) trip.activityTypes[t] = true;
  });

  // getTripLessons_ filters by match, so "everything on file" needs the scope
  // check bypassed — read the tab directly rather than inventing a trip that
  // matches every scope, which is not a thing that exists.
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.MEMORY_LOG);
  var rows  = [];
  if (sheet && sheet.getLastRow() >= 2) {
    var col = ensureMemoryColumns_(sheet);
    var w   = Math.max.apply(null, Object.keys(col).map(function(k) { return col[k]; }));
    sheet.getRange(2, 1, sheet.getLastRow() - 1, w).getValues().forEach(function(r) {
      if (String(r[col['Type'] - 1] || '').trim() !== MEMORY_TYPE.TRIP_LESSON) return;
      rows.push({
        title:    String(r[col['Title'] - 1] || '').trim(),
        scope:    String(r[col['Scope'] - 1] || '').trim(),
        category: String(r[col['Category'] - 1] || '').trim() || 'Other',
        trip:     String(r[col['Context'] - 1] || '').trim(),
      });
    });
  }

  Logger.log(rows.length + ' lesson(s) on file.');
  if (!rows.length) {
    Logger.log('Record one from Chat: "let\'s do the <trip> debrief" and answer question 6.');
    return;
  }

  if (TB_LESSON_TRIP) {
    Logger.log('Testing against: destination="' + trip.destination + '" context="' +
               trip.context + '" activities=' + JSON.stringify(Object.keys(trip.activityTypes)) +
               ' characteristics=' + JSON.stringify(tripTraitList_(trip.traits)));
    if (!tripTraitList_(trip.traits).length) {
      // Said out loud because it is the silent failure: no characteristics reads
      // exactly like "not a beach trip", and every trait-scoped lesson below will
      // say "no match" for a reason that has nothing to do with the lesson.
      Logger.log('NOTE: no characteristics set \u2014 every trait: lesson will read as "no match".');
    }
  } else {
    Logger.log('TB_LESSON_TRIP is blank — listing only, no matching.');
  }
  Logger.log('');

  rows.forEach(function(l) {
    var line = '[' + l.category + '] ' + l.title + '   scope=' + l.scope +
               (l.trip ? '   from ' + l.trip : '');
    if (TB_LESSON_TRIP) {
      var hit = tripLessonApplies_(l.scope, trip);
      // An unparseable scope reads as "no match", which looks identical to a
      // scope that simply does not fit this trip — so say which it is.
      var why = parseTripLessonScope_(l.scope) ? (hit ? 'FIRES' : 'no match')
                                               : 'UNPARSEABLE SCOPE — fires for nothing, ever';
      line = (hit ? '  ✓ ' : '  · ') + why + '  ' + line;
    } else {
      line = '  ' + line;
    }
    Logger.log(line);
  });

  if (TB_LESSON_TRIP) {
    Logger.log('');
    Logger.log('Packing prompt would receive:');
    Logger.log(tripLessonsPromptBlock_(trip, ['Packing']) || '  (nothing)');
    Logger.log('Recommendations prompt would receive:');
    Logger.log(tripLessonsPromptBlock_(trip, ['Dining', 'Activities']) || '  (nothing)');
  }
}

/**
 * Which legacy trip keys would be attached to which trip. DRY RUN — writes
 * nothing.
 *
 * A key written into the tabs before a trip's start date moved belongs to that
 * trip but the registry has never been told, so reads under it return only part
 * of the itinerary. This shows what the nightly pass will adopt on its own; run
 * it when you want to see that before it happens.
 */
function tbAdoptTripKeys() {
  tbBanner_('Adopt legacy trip keys (dry run)');
  var res = adoptLegacyTripKeysDryRun();
  Logger.log('Would adopt ' + res.adopted + ', already attached ' + res.already +
             ', left alone ' + res.unresolved + '.');
  if (!res.adopted && !res.unresolved) {
    Logger.log('Nothing to do — every key in the tabs already belongs to a trip.');
  }
}

/**
 * Copies every existing send latch onto its Trip ID.
 *
 * Run this ONCE, BEFORE relying on the new latches. Without it, a trip already
 * in flight looks unsent under its new id and every pre/post-trip email goes out
 * a second time — the exact bug this whole change exists to stop.
 *
 * Additive and idempotent: writes only where an id latch is missing, deletes
 * nothing, and running it twice changes nothing.
 */
function tbSeedTripLatches() {
  tbBanner_('Seed Trip ID latches');
  var res = seedTripIdLatches_();
  Logger.log('Seeded ' + res.seeded + ', already present ' + res.skipped + '.');
  if (!res.seeded && !res.skipped) {
    Logger.log('Nothing to seed — no registry rows, or no legacy latches to copy.');
  }
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

/**
 * Where VERA thinks a trip goes, as the packing list and Discover now see it: the base,
 * resolved on the map, and each cruise stop. Uses TB_TRIP_LABEL. No knobs otherwise.
 *
 * Prints what each place RESOLVED to — name, region, country, latitude — because a
 * place that resolves to the wrong one (St. Thomas, Ontario for the Virgin Islands) is
 * only visible this way, and it decides both the weather and the hemisphere.
 */
function tbTripPlaces() {
  tbBanner_('Trip places (destination + cruise stops)');
  var trip = tbPickTrip_();
  if (!trip) return;
  var key = trip.startDate + '|' + trip.label;
  var itin = webGetItinerary_({ parameter: { tripKey: key, startDate: trip.startDate, endDate: trip.endDate } }, { skipEventTz: true }) || {};
  var rows = (itin.items || []).map(function(it) {
    return [it.id, it.tripKey, it.type, it.title, it.date, it.startTime, it.endTime, it.location, it.notes, it.metadata];
  });
  var places = tripPlaces_(rows, key, trip.label, trip.endDate);
  var b = places.base;
  Logger.log('Base (' + (b.source || 'none') + '): ' + (b.value || '(nothing)').replace(/\s*\n\s*/g, ', '));
  Logger.log('   → ' + tbPlaceLine_(b.geo));
  Logger.log('Season: ' + tripSeasonWithStops_(trip.startDate, b.geo ? b.geo.lat : null, places.ports).season);
  var cands = cruisePortRows_(rows, key, trip.endDate);
  Logger.log('Cruise stop candidates: ' + cands.length + '; kept as stops: ' + places.ports.length);
  places.ports.forEach(function(p) { Logger.log('   ' + p.date + '  "' + p.from + '" → ' + tbPlaceLine_(p.geo)); });
  var kept = {}; places.ports.forEach(function(p) { kept[p.from] = true; });
  cands.filter(function(c) { return !kept[c.location]; }).forEach(function(c) {
    Logger.log('   dropped: ' + c.date + '  "' + c.location + '" (not on the map, near the base, near another stop that day, or a repeat)');
  });
  Logger.log('Prompt sees: ' + genPlacesText_(places));
  var stored = '';
  try { stored = (webGetTripMeta_({ parameter: { tripKey: key } }) || {}).traveler || ''; } catch (e) {}
  var tv = genTravellers_(stored, rows);
  Logger.log('Travellers: ' + tv.value + ' (' + GEN_TRAVELLER_SOURCE_[tv.source] + '); saved on the trip: "' + stored + '"');
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

/**
 * What the Meal Plan tab holds, and in what cell types. Reads only.
 *
 * The planner looked empty and saves vanished for one reason: Week Start was written
 * as '2026-10-05' and Sheets stored a DATE, so every weekStart comparison missed. That
 * is invisible in the sheet and in the dashboard; this prints it.
 */
function tbMealPlan() {
  tbBanner_('Meal Plan tab');
  var info = inspectMealPlanTab_();
  if (!info.ok) { Logger.log('FAILED: ' + info.error); return; }

  Logger.log('Rows: ' + info.rows + '  (' + info.blanks + ' with no dinner in them)');
  Logger.log('Week Start cell type: ' + info.cellTypes.weekStart +
             '   raw: "' + info.cellTypes.rawWeekStart + '"');
  Logger.log('Date cell type:       ' + info.cellTypes.date);
  if (info.cellTypes.weekStart === 'Date') {
    Logger.log('  ^ a Date, not a string — dateCellToIso_ in _readMealPlanRows_ is what');
    Logger.log('    makes the lookups match. Before that fix, none of them did.');
  }

  info.weeks.forEach(function(w) {
    Logger.log('  ' + w.weekStart + ' — ' + w.rows + ' row(s), ' + w.meals + ' dinner(s)' +
               (w.duplicatedDays ? ', ' + w.duplicatedDays + ' day(s) duplicated' : ''));
  });

  var cur = getCurrentWeekStart_();
  Logger.log('This week (' + cur + ') reads back ' + getMealPlanWeek_(cur).length + ' row(s).');
  Logger.log('Next week (' + getNextWeekStart_() + ') reads back ' +
             getMealPlanWeek_(getNextWeekStart_()).length + ' row(s).');
  if (info.blanks) {
    Logger.log('Run tbMealPlanCleanupPreview() to see what a cleanup would remove.');
  }
}

/** Blank Meal Plan rows that a cleanup would delete — PREVIEW, deletes nothing. */
function tbMealPlanCleanupPreview() {
  tbBanner_('Blank Meal Plan rows — PREVIEW (nothing is deleted)');
  var out = purgeBlankMealPlanRows_(true);
  if (!out.ok) { Logger.log('Could not look: ' + out.error); return; }
  Logger.log('Rows holding no dinner: ' + out.matched);
  Logger.log(out.matched
    ? 'These are debris from the old seed-on-read, which appended seven every page\n' +
      'load. Nothing with a meal name in it is a candidate.\n' +
      'Run tbMealPlanCleanupRun() to delete these ' + out.matched + '.'
    : 'Nothing to clean up.');
}

/** Deletes the blank Meal Plan rows. Run tbMealPlanCleanupPreview() first. */
function tbMealPlanCleanupRun() {
  tbBanner_('Blank Meal Plan rows — DELETING');
  var out = purgeBlankMealPlanRows_(false);
  if (!out.ok) { Logger.log('Could not run: ' + out.error); return; }
  Logger.log('Deleted ' + out.deleted + ' blank row(s).');
}

/**
 * The one-off backlog sweep for stale perk reminder events — PREVIEW, deletes nothing.
 *
 * The nightly pass only looks back PERK_EVENT_PURGE_LOOKBACK_DAYS_, so reminders that
 * accumulated before it existed — September's and earlier, from the months when
 * nothing could delete them at all — need one deeper pass.
 *
 * RUN THIS FIRST and read the list. It deletes from the calendar Victoria also reads,
 * so seeing what would go is the point. Only events carrying VERA's own 'VERA-PERK:'
 * marker are ever candidates; birthdays (VERA-DATE:) and anything either of you created
 * are out of reach by construction.
 */
function tbPerkEventPurgePreview() {
  tbBanner_('Stale perk reminder events — PREVIEW (nothing is deleted)');
  var out = purgePastPerkReminderEvents_(PERK_EVENT_PURGE_BACKLOG_DAYS_, true);
  if (!out.ok) {
    Logger.log('Could not look: ' + out.error);
    return;
  }
  Logger.log('Window: ' + out.from + ' .. ' + out.to +
             '  (' + out.scanned + ' event(s) on the calendar in it)');
  Logger.log('Past perk reminders found: ' + out.matched);
  out.events.forEach(function(e) { Logger.log('  ' + e.date + '  ' + e.title); });
  Logger.log(out.matched
    ? 'Run tbPerkEventPurgeRun() to delete these ' + out.matched + '.'
    : 'Nothing to clean up.');
}

/** The same sweep, FOR REAL. Run tbPerkEventPurgePreview() first. */
function tbPerkEventPurgeRun() {
  tbBanner_('Stale perk reminder events — DELETING');
  var out = purgePastPerkReminderEvents_(PERK_EVENT_PURGE_BACKLOG_DAYS_, false);
  if (!out.ok) {
    Logger.log('Failed: ' + out.error);
    return;
  }
  out.events.forEach(function(e) { Logger.log('  removed  ' + e.date + '  ' + e.title); });
  Logger.log('Removed ' + out.removed + ' of ' + out.matched + ' past perk reminder(s).');
  Logger.log('From here the nightly tail keeps up with it; this should never be needed twice.');
}

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


/**
 * Can VERA read the planner sheet for the Net Worth tab (issue #126)? No knobs.
 *
 * Prints which sections were FOUND and how many rows each has — never an amount, a
 * balance or a CD name. Logs outlive the moment; balances shouldn't sit in them.
 *
 * Also writes the bucket mapping into VERA's Config tab if that has never happened,
 * so the tab's Asset class and Tax views work straight away.
 */
/**
 * The family Christmas lists, as VERA now reads them (WishLists.js). Counts only —
 * no item text — and mainly here to confirm, on the real docs, that ticked
 * Purchased / Wrapped boxes are detected: Apps Script has no checklist API, so it
 * reads the strikethrough a ticked box carries.
 */
function tbWishLists() {
  tbBanner_('Family wish lists (Christmas docs)');
  var added = seedWishListInitialsConfig_();
  Logger.log(added ? 'Initials: wrote ' + added + ' row(s) into Config.' : 'Initials: already written before (left alone).');
  var r = webGetFamilyWishLists_();
  if (r.note) { Logger.log(r.note); return; }
  Logger.log('Upcoming Christmas: ' + r.upcomingYear);
  r.people.forEach(function(p) {
    if (p.error) { Logger.log('· ' + p.person + ' — ' + p.error); return; }
    Logger.log('· ' + p.person + ' — years: ' + (p.years.join(', ') || '(none)'));
    p.years.slice(0, 2).forEach(function(y) {
      var s = p.sections[y];
      Logger.log('    ' + y + ': ' + s.wishlist.length + ' wish(es), ' +
                 s.wishlist.filter(function(w) { return !w.claimed; }).length + ' unclaimed · ' +
                 s.gifts.length + ' gift(s), ' + s.gifts.filter(function(g) { return g.purchased; }).length + ' purchased, ' +
                 s.gifts.filter(function(g) { return g.wrapped; }).length + ' wrapped, ' +
                 s.gifts.filter(function(g) { return g.ours; }).length + ' ours · ' +
                 s.ideas.length + ' idea(s)');
    });
    if (p.notStarted) Logger.log('    ' + r.upcomingYear + ': not started yet');
  });
  if (r.unmappedInitials.length) {
    Logger.log('Initials with no name yet: ' + r.unmappedInitials.join(', ') +
               ' — add Config rows like gift_initials_' + r.unmappedInitials[0] + ' = <name>.');
  }
}

/**
 * Career tab v2 (issue #216, Career.js). Set TB_CAREER_DRY_RUN to true first to see
 * what the one-time migration would copy, without writing anything. Counts only:
 * never a title, statement, company or figure.
 */
var TB_CAREER_DRY_RUN = false;

function tbCareer() {
  tbBanner_('Career tab v2');
  if (TB_CAREER_DRY_RUN) {
    var dry = carMigrateV1_({ dryRun: true });
    Logger.log(dry.skipped ? 'Migration: already done — nothing to preview.'
                           : 'Migration would copy: ' + JSON.stringify(dry.counts));
    return;
  }
  var res = carEnsureMigrated_();
  Logger.log('Migration: ' + (res.skipped ? 'done before' : 'ran now — ' + JSON.stringify(res.counts)));
  var base = carStateGet_('baseline_imported');
  Logger.log('Wins bank baseline: ' + (base ? 'imported (' + base.count + ' item(s))'
    : 'not imported — add a Config row career_wins_bank_doc_id with the Wins bank doc id'));
  var data = webGetCareer_();
  var byStatus = {};
  data.ladder.forEach(function(r) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  Logger.log('Ladder: ' + JSON.stringify(byStatus));
  var byGroup = {};
  data.criteria.forEach(function(c) { byGroup[c.group] = (byGroup[c.group] || 0) + 1; });
  Logger.log('Criteria: ' + JSON.stringify(byGroup));
  Logger.log('Evidence: ' + data.evidence.length + ' item(s), ' +
             data.evidence.filter(function(e) { return e.adScale; }).length + ' at AD scale, ' +
             data.evidence.filter(function(e) { return !e.criterionIds.length; }).length + ' untagged');
  Logger.log('Intents: ' + data.intents.filter(function(i) { return i.status !== 'retired'; }).length + ' active');
  Object.keys(data.readiness).forEach(function(t) {
    var v = data.readiness[t];
    Logger.log('Readiness ' + t + ': ' + v.verdict + ' ' + v.pct + '% (' + v.gaps + ' gap(s), ' + v.partials + ' partial)');
  });
}

function tbNetWorth() {
  tbBanner_('Net Worth (planner sheet)');
  var cfg = getConfigValues();
  var sheetId = String(cfg['planner_sheet_id'] || '').trim();
  if (!sheetId) {
    Logger.log('NOT SET UP — add a planner_sheet_id row to VERA’s Config tab, with the');
    Logger.log('planner sheet’s ID as its value (the long part of its URL between /d/ and /edit).');
    return;
  }

  var added = seedNetWorthMappingConfig_();
  Logger.log(added ? 'Mapping: wrote ' + added + ' row(s) into Config.' : 'Mapping: already written before (left alone).');

  var data;
  try {
    data = readPlannerSheet_(sheetId, nwMappingFromConfig_(getConfigValues()));
  } catch (e) {
    Logger.log('FAILED to open the planner sheet: ' + e.message);
    Logger.log('Check the ID, and that this account can open the sheet.');
    return;
  }

  var b = data.balances;
  tbNetWorthLine_('Balances',          b, b.status === 'ok' ? (b.rows.length / b.owners.length) + ' bucket(s) × ' + b.owners.length + ' owner(s)' : undefined);
  tbNetWorthLine_('Planner net worth', data.planner);
  tbNetWorthLine_('Balances as of',    data.asOf, data.asOf.status === 'ok' ? data.asOf.iso : undefined);
  tbNetWorthLine_('CDs',               data.cds,   data.cds.status   === 'ok' ? data.cds.items.length   + ' row(s)' : undefined);
  tbNetWorthLine_('RSUs',              data.rsus,  data.rsus.status  === 'ok' ? data.rsus.items.length  + ' row(s)' : undefined);
  tbNetWorthLine_('Planned spends',    data.plans, data.plans.status === 'ok' ? data.plans.items.length + ' row(s)' : undefined);

  if (b.status === 'ok' && b.unmapped.length) {
    Logger.log('Unmapped bucket(s): ' + b.unmapped.join(', ') +
               ' — add networth_class:<key> and networth_tax:<key> rows in Config.');
  }
  if (data.cds.status === 'ok') {
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    Logger.log('CDs maturing within 30 days (would flag tonight): ' + nwCdFlagsDue_(data.cds.items, today).length);
  }
}


// ============================================================
// HELPERS — private, not part of the index
// ============================================================

/** One tbNetWorth() line: found, or MISSING with the reason. Never an amount. */
function tbNetWorthLine_(name, section, count) {
  Logger.log((section.status === 'ok' ? '  found    ' : '  MISSING  ') + name +
             (section.status === 'ok' ? (count !== undefined ? ' — ' + count : '') : ' — ' + section.reason));
}

/** One resolved place, for tbTripPlaces(): name | region | country | latitude, and the search that found it. */
function tbPlaceLine_(g) {
  return g ? g.name + ' | ' + (g.admin1 || '-') + ' | ' + (g.country || '-') + ' | lat ' + g.lat + '  (searched as "' + g.matched + '")'
           : 'NOT FOUND on the map';
}

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
