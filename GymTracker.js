// ============================================================
// GYM TRACKER — Issue #97
// Detects calendar events with "EXERCISE" in description,
// logs them in the Gym Log sheet, and writes a check-in flag.
// ============================================================

/**
 * Called from nightlyRun() Step 0i.
 * Scans the past 24h for ended calendar events containing "EXERCISE"
 * in the description. Appends new rows to the Gym Log sheet and writes
 * a check-in flag for each untracked session.
 */
function checkGymSessions_() {
  var cfg = getConfigValues();
  if ((cfg['gym_tracker_enabled'] || 'true') === 'false') {
    Logger.log('GymTracker: disabled via config');
    return;
  }

  var tz          = Session.getScriptTimeZone();
  var now         = new Date();
  var lookbackHrs = parseInt(cfg['gym_tracker_lookback_hours'] || '48', 10) || 48;
  var windowStart = new Date(now.getTime() - lookbackHrs * 60 * 60 * 1000);

  // ---- Scan all calendars for EXERCISE events that have already ended -------
  // CalendarApp.getAllCalendars() returns ALL calendars — personal (Ahmed) and
  // shared (e.g. "Joint Chaos"). Only skips whatever is in the skip_calendars
  // config row (default: "Holidays in United States").
  var skipCals  = (cfg['skip_calendars'] || '').split(',').map(function(s) { return s.trim().toLowerCase(); });
  var calendars = CalendarApp.getAllCalendars();
  var candidates = [];

  for (var ci = 0; ci < calendars.length; ci++) {
    var cal = calendars[ci];
    if (skipCals.indexOf(cal.getName().toLowerCase()) !== -1) continue;

    var events = cal.getEvents(windowStart, now);
    for (var ei = 0; ei < events.length; ei++) {
      var ev   = events[ei];
      if (!wkIsWorkout_(ev.getTitle(), ev.getDescription())) continue;   // Workouts.js: EXERCISE, or Run / Swim / Class / Yoga…
      if (ev.getEndTime() > now) continue; // still in progress

      var dateStr   = Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd');
      var safeTitle = ev.getTitle().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20).toLowerCase();
      candidates.push({
        id:    'GYM-' + dateStr + '-' + safeTitle,
        title: ev.getTitle().trim(),
        date:  dateStr,
      });
    }
  }

  if (!candidates.length) {
    Logger.log('GymTracker: no gym sessions found in window');
    return;
  }

  // ---- Read existing Gym Log to avoid duplicates ----------------------------
  var sheet = getSpreadsheet().getSheetByName(TABS.GYM_LOG);
  if (!sheet) { Logger.log('GymTracker: Gym Log sheet missing'); return; }

  var existingIds = {};
  if (sheet.getLastRow() >= 2) {
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var ri = 0; ri < ids.length; ri++) {
      if (ids[ri][0]) existingIds[String(ids[ri][0])] = true;
    }
  }

  // ---- Append new rows + build flags ----------------------------------------
  var flags = [];
  var added = 0;

  for (var i = 0; i < candidates.length; i++) {
    var s = candidates[i];
    if (existingIds[s.id]) continue; // already logged
    existingIds[s.id] = true;        // dedup within this run

    // Gym Log row: ID | Event Title | Event Date | Attended | Logged At | Type (Workouts.js)
    wkEnsureCols_(sheet);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, WK_TYPE_COL_)
      .setValues([[s.id, s.title, s.date, '', '', wkType_(s.title) || 'Gym']]);

    flags.push({
      source:  'Gym Tracker',
      flag:    'Did you go? ' + s.title + ' (' + s.date + ')',
      reason:  'Your scheduled workout has passed. ' +
               'Open Health → Fitness to log Yes or No; it counts toward the weekly target.',
      urgency: 'Low',
      key:     s.id,
    });

    Logger.log('GymTracker: logged ' + s.id);
    added++;
  }

  if (flags.length) writeFlags(flags);
  Logger.log('GymTracker: done — ' + added + ' new session(s) logged.');
  if (added > 0) {
    try {
      var sessionNames = flags.map(function(f) { return f.flag.replace('Gym check-in: ', ''); }).join(', ');
      sendSlackLog_(':weight_lifter: Gym check-in prompt sent — ' + sessionNames);
    } catch(slErr) {}
  }
}

/** Pure: the hours when hourlyCheck looks for workouts that just ended: 6 pm to 11 pm, or
 *  Config gym_checkin_hours ("18-23", set on Gym check-ins in Feature Flags, #254). */
function gymEveningHour_(hour, range) {
  var r = typeof gymCheckinRange_ === 'function' ? gymCheckinRange_(range) : null;
  return r ? hour >= r.from && hour <= r.to : hour >= 18 && hour <= 23;
}

/**
 * From hourlyCheck. The nightly run used to be the only caller, so a night it didn't
 * finish (Nov 16–17) left that day's workouts with no check-in at all. Never throws.
 */
function gymEveningCheck_(now) {
  var range = ''; try { range = (getConfigValues() || {}).gym_checkin_hours; } catch (e) {}
  if (!gymEveningHour_((now || new Date()).getHours(), range)) return false;
  if (typeof featureOn_ === 'function' && !featureOn_('gym_tracker')) return false;   // off in Feature Flags (#254)
  try { checkGymSessions_(); return true; }
  catch (e) { Logger.log('gymEveningCheck_ (non-fatal): ' + e.message); return false; }
}

// ---------------------------------------------------------------------------

/**
 * Reads all rows from the Gym Log sheet.
 * @returns {Array<{id, title, date, attended, loggedAt, rowNum}>}
 */
function getGymLog_() {
  var sheet = getSpreadsheet().getSheetByName(TABS.GYM_LOG);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.min(WK_MIN_COL_, sheet.getMaxColumns())).getValues();   // + Type, Minutes (Workouts.js)
  return data
    .map(function(row, i) {
      return {
        id:       String(row[0] || '').trim(),
        title:    String(row[1] || '').trim(),
        date:     row[2] instanceof Date
                    ? Utilities.formatDate(row[2], Session.getScriptTimeZone(), 'yyyy-MM-dd')
                    : String(row[2] || '').trim().substring(0, 10),
        attended: String(row[3] || '').trim(),
        loggedAt: String(row[4] || '').trim(),
        type:     String(row[WK_TYPE_COL_ - 1] || '').trim() || wkType_(row[1]) || 'Gym',
        minutes:  parseInt(row[WK_MIN_COL_ - 1], 10) || null,
        rowNum:   i + 2,
      };
    })
    .filter(function(r) { return r.id; });
}

// ---------------------------------------------------------------------------

/**
 * Records a Yes/No attendance answer for a gym session.
 * Also auto-resolves any matching open flag (key = gymId).
 *
 * @param {string} id       - Gym Log row ID (e.g. GYM-2026-03-22-gym)
 * @param {string} attended - 'Yes' or 'No'
 */
function logGymAttendance_(id, attended) {
  if (attended !== 'Yes' && attended !== 'No') throw new Error('attended must be Yes or No');

  var sheet = getSpreadsheet().getSheetByName(TABS.GYM_LOG);
  if (!sheet) throw new Error('Gym Log sheet not found.');

  var tz  = Session.getScriptTimeZone();
  var now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  if (sheet.getLastRow() >= 2) {
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var ri = 0; ri < ids.length; ri++) {
      if (String(ids[ri][0] || '').trim() !== id) continue;
      sheet.getRange(ri + 2, 4).setValue(attended); // col D: Attended
      sheet.getRange(ri + 2, 5).setValue(now);      // col E: Logged At

      // Auto-resolve the matching flag (key = id) if it exists
      try { autoResolveFlagByKey_(id); } catch (e_) {}

      // Memory Log
      try {
        var sessionTitle = String(ids[ri][0] || id); // use event title if available
        var sessionDate  = sheet.getRange(ri + 2, 3).getValue(); // col C: Event Date
        appendMemoryEvent_(
          'gym_session',
          'Ahmed',
          attended === 'Yes' ? '✓ Gym attended' : '✗ Gym skipped',
          sessionDate ? String(sessionDate).slice(0, 10) : '',
          id
        );
      } catch (mErr) { Logger.log('Memory: gym session hook (non-fatal) — ' + mErr.message); }

      return { ok: true, id: id, attended: attended };
    }
  }
  throw new Error('Gym session not found: ' + id);
}

// ---------------------------------------------------------------------------

/**
 * Scans the Flags sheet for an open flag whose Key column (col 10) matches
 * the given key and marks it Resolved.
 * Silently does nothing if no match is found.
 */
function autoResolveFlagByKey_(key) {
  var sheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!sheet || sheet.getLastRow() < 2) return;

  var lastRow  = sheet.getLastRow();
  var keys     = sheet.getRange(2, 10, lastRow - 1, 1).getValues(); // col J: Key
  var resolved = sheet.getRange(2, 9,  lastRow - 1, 1).getValues(); // col I: Resolved

  for (var ri = 0; ri < keys.length; ri++) {
    if (String(keys[ri][0] || '').trim() === key &&
        String(resolved[ri][0] || '').trim() !== 'Yes') {
      sheet.getRange(ri + 2, 9).setValue('Yes');
      Logger.log('autoResolveFlagByKey_: resolved flag for key=' + key);
      return;
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Run this from the Apps Script editor to test gym session detection
 * without waiting for the nightly trigger.
 * Check the Execution Log and the Gym Log sheet for output.
 */
function testCheckGymSessions() {
  Logger.log('=== testCheckGymSessions ===');
  checkGymSessions_();
  Logger.log('=== done — check Gym Log sheet and Flags tab ===');
}

// ---------------------------------------------------------------------------

/**
 * Scans the past `lookbackDays` days for missed gym sessions.
 * Same logic as checkGymSessions_() but with a wider window.
 * Safe to call multiple times — deduplicates against existing Gym Log rows.
 * @param {number} lookbackDays  How many days back to scan (default 30, max 90)
 * @returns {{ added: number, skipped: number }}
 */
function backfillGymSessions_(lookbackDays) {
  lookbackDays = Math.min(Math.max(parseInt(lookbackDays) || 30, 1), 90);

  var cfg   = getConfigValues();
  var tz    = Session.getScriptTimeZone();
  var now   = new Date();
  var start = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  var skipCals  = (cfg['skip_calendars'] || '').split(',').map(function(s) { return s.trim().toLowerCase(); });
  var calendars = CalendarApp.getAllCalendars();
  var candidates = [];

  for (var ci = 0; ci < calendars.length; ci++) {
    var cal = calendars[ci];
    if (skipCals.indexOf(cal.getName().toLowerCase()) !== -1) continue;
    var events = cal.getEvents(start, now);
    for (var ei = 0; ei < events.length; ei++) {
      var ev   = events[ei];
      if (!wkIsWorkout_(ev.getTitle(), ev.getDescription())) continue;   // Workouts.js
      if (ev.getEndTime() > now) continue;
      var dateStr   = Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd');
      var safeTitle = ev.getTitle().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20).toLowerCase();
      candidates.push({ id: 'GYM-' + dateStr + '-' + safeTitle, title: ev.getTitle().trim(), date: dateStr });
    }
  }

  var sheet = getSpreadsheet().getSheetByName(TABS.GYM_LOG);
  if (!sheet) throw new Error('Gym Log sheet not found.');

  var existingIds = {};
  if (sheet.getLastRow() >= 2) {
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var ri = 0; ri < ids.length; ri++) {
      if (ids[ri][0]) existingIds[String(ids[ri][0])] = true;
    }
  }

  var added = 0, skipped = 0;
  for (var i = 0; i < candidates.length; i++) {
    var s = candidates[i];
    if (existingIds[s.id]) { skipped++; continue; }
    existingIds[s.id] = true;
    wkEnsureCols_(sheet);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, WK_TYPE_COL_)
      .setValues([[s.id, s.title, s.date, '', '', wkType_(s.title) || 'Gym']]);
    added++;
  }

  Logger.log('GymBackfill: ' + added + ' added, ' + skipped + ' already existed.');
  return { added: added, skipped: skipped };
}

function testBackfillGymSessions() {
  Logger.log(JSON.stringify(backfillGymSessions_(30)));
}
