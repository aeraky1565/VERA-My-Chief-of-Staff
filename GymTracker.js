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

/** Pure: workouts you went to this week (Monday to today), from getGymLog_ rows. */
function gymWeekDone_(log, todayIso) {
  var d = new Date(todayIso + 'T12:00:00'), back = (d.getDay() + 6) % 7;
  var mon = new Date(d.getTime() - back * 86400000), monIso = mon.getFullYear() + '-' + ('0' + (mon.getMonth() + 1)).slice(-2) + '-' + ('0' + mon.getDate()).slice(-2);
  return (log || []).filter(function(s) { return s.attended === 'Yes' && s.date >= monIso && s.date <= todayIso; }).length;
}
/** Pure: what the evening check-in says back. */
function eveningReply_(kind, weekDone, target) {
  var of = target ? ' of ' + target : '';
  if (kind === 'none') return 'Logged: not today. ' + weekDone + of + ' this week so far.';
  var what = { gym: 'gym', walk: 'a walk', stretch: 'a stretch' }[kind] || kind;
  return '\u2705 Logged: ' + what + '. That\u2019s ' + weekDone + of + ' this week.';
}
/**
 * The evening check-in's answer, logged to Health › Fitness (Gym Log). Gym marks today's
 * scheduled workout as went, or adds one; Walk and Stretch add one of that type; Not today
 * marks today's open scheduled workouts as skipped. Only TODAY's rows are touched: the old
 * Yes button marked whichever session was last left open, even one from weeks ago.
 * → the reply line.
 */
function eveningMoveLog_(kind) {
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var log = getGymLog_(), mine = log.filter(function(s) { return s.date === today; });
  var open = mine.filter(function(s) { return !s.attended; });
  var type = { gym: 'Gym', walk: 'Walk', stretch: 'Stretch' }[kind];
  if (kind === 'none') {
    open.forEach(function(s) { try { logGymAttendance_(s.id, 'No'); } catch (e) {} });
  } else if (kind === 'gym' && open.length) {
    logGymAttendance_(open[0].id, 'Yes');
  } else if (type && !mine.some(function(s) { return s.attended === 'Yes' && String(s.type).toLowerCase() === type.toLowerCase(); })) {
    webWorkoutAdd_({ parameter: { type: type } });   // Workouts.js
  }
  var target = 0; try { target = wkTarget_(getConfigValues()); } catch (e) {}
  return eveningReply_(kind, gymWeekDone_(getGymLog_(), today), target);
}

// ---- A typed answer to the evening check-in ("Gym, 45 min legs") -----------------------------
var EVENING_TYPED_WORDS_ = [['Gym', /^(gym|lift(ed|ing)?|weights|workout|strength)$/], ['Walk', /^(walk(ed|ing)?)$/], ['Stretch', /^(stretch(ed|ing)?|mobility)$/],
  ['Run', /^(run|ran|running|jog(ged|ging)?)$/], ['Swim', /^(swim|swam|swimming)$/], ['Yoga', /^(yoga|pilates)$/], ['Ride', /^(bike|biked|biking|cycl(e|ed|ing)|ride|rode)$/],
  ['Hike', /^(hike|hiked|hiking)$/], ['Sport', /^(tennis|squash|pickleball|basketball|soccer|climbing|golf)$/]];
var EVENING_TYPED_FILLER_ = /^(i|did|went|to|the|a|an|for|of|and|some|just|today|tonight|at|my|about|~)$/;

/**
 * Pure: a short reply to the evening check-in, read as a workout, or null when it isn't one
 * (then it goes to chat as usual). → {kind: 'workout'|'none'|'details', type, minutes, note}
 *   "Gym, 45 min legs" → workout Gym 45 "legs"     "walked 30 minutes" → workout Walk 30
 *   "not today" / "skipped" → none                  "45 min, legs" → details 45 "legs" (for today's workout)
 */
function eveningTypedParse_(text) {
  var t = String(text || '').trim().toLowerCase();
  if (!t || t.length > 60 || t.split(/\s+/).length > 8) return null;
  // A question is for chat, never a log ("how many gym sessions this week?").
  if (/\?/.test(t) || /^(what|how|when|why|where|who|can|could|should|would|will|do|does|did i|is|are|was|tell|show|remind|add|please)\b/.test(t)) return null;
  // No, only when it says so: a bare "no" may be answering something else in chat.
  if (/^(not today|skipped( (it|today))?|skip(ping)? (it|today)|no (workout|gym|movement|exercise)( today)?|rest day|didn'?t (go|work out|move)( today)?)[.!]*$/.test(t)) return { kind: 'none' };
  var minutes = null, m = t.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/);
  if (m) { minutes = Math.round(parseFloat(m[1]) * 60); t = t.replace(m[0], ' '); }
  m = t.match(/(\d+)\s*(m|min|mins|minute|minutes)\b/);
  if (m) { minutes = parseInt(m[1], 10); t = t.replace(m[0], ' '); }
  var words = t.replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter(Boolean), type = '';
  // The workout word has to come first (after "I went to the…"), so a sentence that
  // only mentions the gym further on isn't read as one.
  var lead = words.filter(function(w) { return !EVENING_TYPED_FILLER_.test(w); })[0] || '';
  for (var i = 0; i < EVENING_TYPED_WORDS_.length; i++) if (EVENING_TYPED_WORDS_[i][1].test(lead)) { type = EVENING_TYPED_WORDS_[i][0]; break; }
  var dropped = false;
  var rest = words.filter(function(w) {
    if (type && !dropped && w === lead) { dropped = true; return false; }
    return !EVENING_TYPED_FILLER_.test(w);
  });
  var note = rest.join(' ').trim().slice(0, 40);
  if (minutes !== null && !(minutes > 0 && minutes <= 600)) minutes = null;
  if (type) return { kind: 'workout', type: type, minutes: minutes, note: note };
  if (minutes !== null && /^\d/.test(String(text).trim())) return { kind: 'details', type: '', minutes: minutes, note: note };   // "45 min, legs"; not "in 30 min"
  return null;
}
/** Pure: "Logged: gym, 45 min, legs. That's 3 of 4 this week." */
function eveningTypedReply_(p, type, weekDone, target) {
  if (p.kind === 'none') return eveningReply_('none', weekDone, target);
  var bits = [String(type || p.type || 'workout').toLowerCase()];
  if (p.minutes) bits.push(p.minutes + ' min');
  if (p.note) bits.push(p.note);
  return 'Logged: ' + bits.join(', ') + '. That’s ' + weekDone + (target ? ' of ' + target : '') + ' this week.';
}

/**
 * From chat (Chat.js), before the AI: a typed answer to tonight's evening check-in, logged
 * to Health › Fitness like a tap, with its minutes and a note. Only after tonight's check-in
 * went out, and only for a short reply that reads as one. → the reply, or null.
 */
function eveningTypedAnswer_(text, now) {
  now = now || new Date();
  var p = eveningTypedParse_(text);
  if (!p) return null;
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  try { if (!wasRecentlySent_('mobility_' + today, 1440)) return null; } catch (e) { return null; }   // tonight's check-in went out
  var sheet = getSpreadsheet().getSheetByName(TABS.GYM_LOG);
  if (!sheet) return null;
  var log = getGymLog_(), mine = log.filter(function(s) { return s.date === today; });
  var type = p.type, row = null;
  if (p.kind === 'none') {
    mine.filter(function(s) { return !s.attended; }).forEach(function(s) { try { logGymAttendance_(s.id, 'No'); } catch (e) {} });
  } else {
    // The row this answer belongs to: today's same-type workout already logged (a tap, then
    // the details), today's planned one, or — for details alone — today's latest one.
    var same = function(s) { return String(s.type).toLowerCase() === String(type).toLowerCase(); };
    if (p.kind === 'details') { row = mine.filter(function(s) { return s.attended === 'Yes'; }).pop() || mine.filter(function(s) { return !s.attended; })[0] || null; type = row ? row.type : 'Workout'; }
    else row = mine.filter(function(s) { return s.attended === 'Yes' && same(s); })[0] || mine.filter(function(s) { return !s.attended && same(s); })[0] || null;
    if (row) {
      if (!row.attended) logGymAttendance_(row.id, 'Yes');
      wkEnsureCols_(sheet);
      if (p.minutes) sheet.getRange(row.rowNum, WK_MIN_COL_).setValue(p.minutes);
      if (p.note && String(row.title).toLowerCase().indexOf(p.note) === -1) sheet.getRange(row.rowNum, 2).setValue(row.title + ' · ' + p.note);
    } else if (p.kind === 'workout') {
      webWorkoutAdd_({ parameter: { type: type, minutes: p.minutes || '' } });
      if (p.note) { var after = getGymLog_().filter(function(s) { return s.date === today && s.attended === 'Yes' && same(s); }).pop(); if (after) sheet.getRange(after.rowNum, 2).setValue(type + ' · ' + p.note); }
    } else return null;   // details, but nothing logged today to attach them to: let chat answer
  }
  var target = 0; try { target = wkTarget_(getConfigValues()); } catch (e) {}
  return eveningTypedReply_(p, type, gymWeekDone_(getGymLog_(), today), target);
}

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
