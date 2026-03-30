// ============================================================
// FITNESS CONSISTENCY TRACKER — Issue #84
// Builds on Gym Log data from Issue #97 (GymTracker.js).
// ============================================================

function checkFitnessConsistency_() {
  try {
    var cfg = getConfigValues();
    if ((cfg['fitness_enabled'] || 'false') !== 'true') {
      Logger.log('FitnessConsistency: disabled'); return;
    }
    var target     = parseInt(cfg['fitness_weekly_target'] || '4', 10) || 4;
    // fitness_low_flag_day: 1=Sun convention (4=Wed default). Convert to JS 0-based by -1.
    var lowFlagDay = parseInt(cfg['fitness_low_flag_day'] || '4', 10) || 4;
    var now        = new Date();
    var todayDow   = now.getDay(); // 0=Sun…6=Sat
    var weekStart  = getMondayOfWeek_(now);
    var weekKey    = getWeekKey_(now);
    var allRows    = getGymLog_();

    // Count attended sessions in current week (Mon–today)
    var currentCount = 0;
    allRows.forEach(function(r) {
      if (r.attended !== 'Yes') return;
      var d = new Date(r.date + 'T00:00:00');
      if (d >= weekStart && d <= now) currentCount++;
    });
    Logger.log('FitnessConsistency: week=' + weekKey + ' count=' + currentCount + ' target=' + target);

    var flags = [];

    // Rules 1–3 are suppressed during active trips — vacation mode handles its own pacing (Issue #139)
    if (!isInVacationMode_()) {
      // Rule 1: below target on configured low-flag day (default: Wednesday)
      if (todayDow === (lowFlagDay - 1) && currentCount < target) {
        flags.push({
          source: 'Fitness Tracker', urgency: 'Low',
          flag:   'Gym consistency: ' + currentCount + '/' + target + ' sessions this week',
          reason: 'Today is ' + getDowLabel_(todayDow) + ' and you\'ve completed ' + currentCount +
                  ' of your ' + target + ' target sessions. Still time to get a session in before the week ends.',
          key:    'fitness_weekly_low_' + weekKey,
        });
      }

      // Rule 2: zero sessions by Thursday
      if (todayDow === 4 && currentCount === 0) {
        flags.push({
          source: 'Fitness Tracker', urgency: 'Medium',
          flag:   'Gym consistency: zero sessions this week — it\'s Thursday',
          reason: 'No confirmed gym sessions yet this week. Getting at least one in before the weekend will keep your streak alive.',
          key:    'fitness_weekly_zero_thu_' + weekKey,
        });
      }

      // Rule 3: zero sessions by Saturday
      if (todayDow === 6 && currentCount === 0) {
        flags.push({
          source: 'Fitness Tracker', urgency: 'High',
          flag:   'Gym consistency: zero sessions this week — it\'s Saturday',
          reason: 'Zero confirmed gym sessions all week and it\'s Saturday. There\'s still time for one session today.',
          key:    'fitness_weekly_zero_sat_' + weekKey,
        });
      }
    }

    // Rule 4: 3+ consecutive complete weeks below target
    var streak = countConsecutiveWeeksBelowTarget_(allRows, target, weekStart, 12);
    if (streak >= 3) {
      flags.push({
        source: 'Fitness Tracker', urgency: 'Medium',
        flag:   streak + ' consecutive weeks below ' + target + '-session gym target',
        reason: streak + ' weeks in a row without reaching your target of ' + target +
                ' sessions/week. Consider adjusting your schedule or the target in Config.',
        key:    'fitness_streak_below_target_' + weekKey,
      });
    }

    if (flags.length) { writeFlags(flags); Logger.log('FitnessConsistency: wrote ' + flags.length + ' flag(s)'); }
  } catch (e) { Logger.log('checkFitnessConsistency_ error (non-fatal): ' + e.message); }
}

// ---------------------------------------------------------------------------

/**
 * Returns upcoming trips from both the Itinerary tab AND the shared gap
 * calendars (same source as PTO upcomingTravel). Itinerary-backed trips
 * take precedence when the same tripKey exists in both sources.
 *
 * @param {number} hoursWindow  Hours ahead to look (e.g. 120 = 5 days)
 * @returns {Array}
 */
function getUpcomingTripsForFitness_(hoursWindow) {
  var tz     = Session.getScriptTimeZone();
  var result = {};

  // Source 1: Itinerary tab (has row data for gym-item check)
  var itinTrips = getUpcomingTripsForBriefing_(hoursWindow);
  itinTrips.forEach(function(t) {
    result[t.tripKey] = {
      tripKey:       t.tripKey,
      tripLabel:     t.tripLabel,
      departureDate: t.departureDate,
      endDate:       t.endDate,
      endDateStr:    Utilities.formatDate(t.endDate, tz, 'yyyy-MM-dd'),
      rows:          t.rows,
      hoursUntil:    t.hoursUntil,
      calendarOnly:  false,
    };
  });

  // Source 2: Calendar-based travel from shared gap calendars
  try {
    var ptoCfg   = readPTOConfig_();
    var calTrips = getUpcomingTravel_(ptoCfg);
    var maxDays  = Math.ceil(hoursWindow / 24);
    calTrips.forEach(function(t) {
      if (t.daysAway > maxDays) return; // too far out
      var key = t.startDate + '|' + t.label;
      if (result[key]) return;          // itinerary version already present
      result[key] = {
        tripKey:       key,
        tripLabel:     t.label,
        departureDate: new Date(t.startDate + 'T00:00:00'),
        endDate:       new Date(t.endDate   + 'T00:00:00'),
        endDateStr:    t.endDate,
        rows:          [],
        hoursUntil:    t.daysAway * 24,
        calendarOnly:  true,
      };
    });
  } catch (calErr) {
    Logger.log('getUpcomingTripsForFitness_: calendar source error: ' + calErr.message);
  }

  return Object.keys(result).map(function(k) { return result[k]; });
}

function checkFitnessTravelGap_() {
  try {
    var cfg = getConfigValues();
    if ((cfg['fitness_enabled'] || 'false') !== 'true') return;

    var trips = getUpcomingTripsForFitness_(120); // 5 days = 120 hours
    if (!trips.length) { Logger.log('FitnessTravelGap: no trips in window'); return; }

    var GYM_KW = ['gym', 'fitness center', 'workout', 'wellness', 'pool'];
    var flags  = [];

    // Read TripMeta once for hotel facility hints
    var tripMetaMap = {};
    try {
      var ms = getSpreadsheet().getSheetByName(TABS.TRIP_META);
      if (ms && ms.getLastRow() >= 2) {
        ms.getRange(2, 1, ms.getLastRow() - 1, TRIP_META_HEADERS.length).getValues()
          .forEach(function(row) {
            var tk = String(row[0] || '').trim();
            if (tk) tripMetaMap[tk] = (String(row[1]) + ' ' + String(row[2])).toLowerCase();
          });
      }
    } catch (e_) {}

    trips.forEach(function(trip) {
      try {
        // Check if any itinerary item already has 'gym' in the title
        var hasGym = trip.rows.some(function(row) {
          return String(row[3] || '').toLowerCase().indexOf('gym') !== -1; // col 3 = Title
        });
        if (hasGym) return;

        // Build hint from TripMeta + hotel item metadata
        var hint = '';
        var metaText = tripMetaMap[trip.tripKey] || '';
        GYM_KW.forEach(function(kw) { if (!hint && metaText.indexOf(kw) !== -1) hint = 'Hotel notes mention "' + kw + '" facilities. '; });
        if (!hint) {
          trip.rows.forEach(function(row) {
            if (hint) return;
            if (String(row[2] || '').toLowerCase() !== 'hotel') return; // col 2 = Type
            var meta = String(row[9] || '').toLowerCase(); // col 9 = Metadata
            GYM_KW.forEach(function(kw) { if (!hint && meta.indexOf(kw) !== -1) hint = 'Hotel metadata mentions "' + kw + '" facilities. '; });
          });
        }

        var safeKey = trip.tripKey.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        flags.push({
          source: 'Fitness Tracker', urgency: 'Low',
          flag:   'No gym plan for ' + trip.tripLabel,
          reason: 'Your trip "' + trip.tripLabel + '" departs in ~' + Math.round(trip.hoursUntil) +
                  ' hours and there are no gym items in the itinerary. ' + hint +
                  'Say "Add gym sessions to the ' + trip.tripLabel + ' itinerary" to auto-schedule morning sessions.',
          key:    'fitness_travel_gap_' + safeKey,
        });
      } catch (te) { Logger.log('FitnessTravelGap trip error: ' + te.message); }
    });

    if (flags.length) { writeFlags(flags); Logger.log('FitnessTravelGap: wrote ' + flags.length + ' flag(s)'); }
  } catch (e) { Logger.log('checkFitnessTravelGap_ error (non-fatal): ' + e.message); }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Returns the Monday 00:00:00 of the ISO week containing `date`. */
function getMondayOfWeek_(date) {
  var d = new Date(date);
  var dow = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Returns "YYYY_WNN" for flag dedup keys — stable within a given calendar week. */
function getWeekKey_(date) {
  var d    = new Date(date);
  var jan1 = new Date(d.getFullYear(), 0, 1);
  var weekNum = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return d.getFullYear() + '_W' + (weekNum < 10 ? '0' + weekNum : weekNum);
}

/** Day-of-week label from JS getDay() value. */
function getDowLabel_(dow) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow];
}

/**
 * Counts consecutive complete weeks (Mon–Sun) BEFORE `currentWeekStart`
 * where attended sessions were below `target`. Stops at the first week at/above.
 */
function countConsecutiveWeeksBelowTarget_(allRows, target, currentWeekStart, maxWeeks) {
  var streak = 0;
  for (var w = 1; w <= maxWeeks; w++) {
    var wEnd   = new Date(currentWeekStart.getTime() - (w - 1) * 7 * 86400000);
    var wStart = new Date(currentWeekStart.getTime() - w       * 7 * 86400000);
    var count  = 0;
    allRows.forEach(function(r) {
      if (r.attended !== 'Yes') return;
      var d = new Date(r.date + 'T00:00:00');
      if (d >= wStart && d < wEnd) count++;
    });
    if (count >= target) break;
    streak++;
  }
  return streak;
}

// ─── TEST ────────────────────────────────────────────────────────────────────

/** Run from Apps Script editor to test (set fitness_enabled=true in Config first). */
function testFitnessChecks() {
  Logger.log('=== testFitnessChecks ===');
  checkFitnessConsistency_();
  checkFitnessTravelGap_();
  Logger.log('=== done — check Flags tab ===');
}
