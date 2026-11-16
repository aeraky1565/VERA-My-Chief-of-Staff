// ============================================================
// VERA — Workouts.js
// Health › Fitness (Ahmed): gym sessions and other workouts count toward the weekly target
// (Config fitness_weekly_target, 4 by default). A calendar event is a workout when its description
// says EXERCISE (as before) or its title starts with a workout word (Run, Swim, Class, Yoga…);
// each gets the same "Did you go?" check-in. "＋ Workout" logs one you didn't plan. The Gym Log tab
// gains Type and Minutes after Logged At, named the first time they're written.
// ============================================================

var WK_TYPE_COL_ = 6, WK_MIN_COL_ = 7;
var WK_WORDS_ = [['Run', /^(run|running|jog|jogging)\b/], ['Swim', /^(swim|swimming|laps)\b/], ['Yoga', /^(yoga|pilates|barre|stretch(ing)?)\b/],
  ['Class', /^(class|spin|spinning|crossfit|bootcamp|hiit|zumba|boxing|kickboxing|dance class)\b/], ['Ride', /^(bike|biking|cycling|ride)\b/],
  ['Hike', /^(hike|hiking|walk)\b/], ['Sport', /^(tennis|squash|pickleball|basketball|soccer|climbing|bouldering|golf)\b/], ['Gym', /^(gym|lift|lifting|weights|workout|strength)\b|\bgym\b|\bworkout\b/]];
var WK_NOT_ = /\berrand|\bmeeting\b|\breunion\b|\bpickup\b|\bdrop.?off\b|\bschedule\b/i;

/** Pure: the workout type a title names ('Run', 'Swim', … 'Gym'), else ''. */
function wkType_(title) {
  var t = String(title || '').trim().toLowerCase();
  if (!t || WK_NOT_.test(t)) return '';
  t = t.replace(/^(morning|evening|lunch|lunchtime|weekend|quick|long|easy|group|outdoor|indoor|early)\s+/, '');   // "Morning swim"
  for (var i = 0; i < WK_WORDS_.length; i++) if (WK_WORDS_[i][1].test(t)) return WK_WORDS_[i][0];
  return '';
}

/** Pure: whether a calendar event is a workout: EXERCISE in its description, or a workout title. */
function wkIsWorkout_(title, desc) { return String(desc || '').toUpperCase().indexOf('EXERCISE') !== -1 || !!wkType_(title); }

function wkEnsureCols_(sheet) {
  if (sheet.getMaxColumns() < WK_MIN_COL_) sheet.insertColumnsAfter(sheet.getMaxColumns(), WK_MIN_COL_ - sheet.getMaxColumns());
  var h = sheet.getRange(1, WK_TYPE_COL_, 1, 2).getValues()[0];
  if (!String(h[0]).trim() || !String(h[1]).trim()) sheet.getRange(1, WK_TYPE_COL_, 1, 2).setValues([['Type', 'Minutes']]);
}

/** Pure: the weekly target from Config (1–14), 4 by default. */
function wkTarget_(cfg) { var n = parseInt((cfg || {})['fitness_weekly_target'], 10); return n >= 1 && n <= 14 ? n : 4; }

/** GET workout_add — type, minutes, date (yyyy-MM-dd, default today): a workout you did, counted as attended. */
function webWorkoutAdd_(e) {
  var p = (e && e.parameter) || {}, type = String(p.type || '').trim().slice(0, 40);
  if (!type) throw new Error('type is required');
  var mins = parseInt(p.minutes, 10); mins = mins > 0 && mins <= 600 ? mins : '';
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var date = /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || '')) && p.date <= today ? p.date : today;
  var sheet = getSpreadsheet().getSheetByName(TABS.GYM_LOG);
  if (!sheet) throw new Error('Gym Log sheet not found.');
  return veraLocked_(function() {
    wkEnsureCols_(sheet);
    var id = 'GYM-' + date + '-added-' + Utilities.formatDate(new Date(), tz, 'HHmmss');
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, WK_MIN_COL_).setValues([[id, type, date, 'Yes', Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'), type, mins]]);
    return { ok: true, id: id, title: type, date: date, attended: 'Yes', type: type, minutes: mins };
  });
}
