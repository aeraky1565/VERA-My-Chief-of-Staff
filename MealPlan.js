// ============================================================
// MealPlan.js — Weekly Dinner Planner (Issue #122)
//
// Data stored in "Meal Plan" sheet tab.
// MEAL_PLAN_HEADERS: ID | Week Start | Day | Date | Meal Name | Type | Status | Notes
//
// Week Start = Monday ISO date of that week.
// One row per day (Mon–Sun) per week.
// Saturday night auto-reset seeds the next week.
// ============================================================

var MEAL_PLAN_DAYS_  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var MEAL_PLAN_TYPES_ = ['Home Cooked', 'Leftovers', 'Takeout', 'Eating Out'];

/**
 * Generates a unique row ID with the given prefix, e.g. "MP-20240407143022-482".
 * @param {string} prefix  Short string prepended to the ID (e.g. 'MP')
 * @returns {string}
 */
function generateId_(prefix) {
  var ts  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
  var rnd = Math.floor(Math.random() * 1000);
  return (prefix || 'ID') + '-' + ts + '-' + rnd;
}

// Column indices (0-based) matching MEAL_PLAN_HEADERS
var MP_COL_ = { ID: 0, WEEK_START: 1, DAY: 2, DATE: 3, MEAL_NAME: 4, TYPE: 5, STATUS: 6, NOTES: 7 };

// ============================================================
// Helpers
// ============================================================

/**
 * Returns the Monday of the current week as a YYYY-MM-DD string.
 */
function getCurrentWeekStart_() {
  var tz    = Session.getScriptTimeZone();
  var today = new Date();
  var dow   = today.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  var diff  = dow === 0 ? -6 : 1 - dow; // shift to Monday
  var mon   = new Date(today);
  mon.setDate(today.getDate() + diff);
  return Utilities.formatDate(mon, tz, 'yyyy-MM-dd');
}

/**
 * Returns the Monday of NEXT week as a YYYY-MM-DD string.
 */
function getNextWeekStart_() {
  var tz    = Session.getScriptTimeZone();
  var today = new Date();
  var dow   = today.getDay();
  var diff  = dow === 0 ? 1 : 8 - dow; // days until next Monday
  var mon   = new Date(today);
  mon.setDate(today.getDate() + diff);
  return Utilities.formatDate(mon, tz, 'yyyy-MM-dd');
}

/**
 * Given a week-start string (Monday) and day abbreviation, returns the ISO date for that day.
 */
function dayDateForWeek_(weekStart, dayAbbrev) {
  var tz  = Session.getScriptTimeZone();
  var mon = new Date(weekStart + 'T00:00:00');
  var idx = MEAL_PLAN_DAYS_.indexOf(dayAbbrev); // 0=Mon … 6=Sun
  if (idx < 0) return weekStart;
  var d = new Date(mon);
  d.setDate(mon.getDate() + idx);
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

// ============================================================
// Read
// ============================================================

/**
 * Returns all meal plan rows for a given weekStart as an array of objects.
 * If the week has no rows yet, creates 7 blank placeholder rows.
 *
 * @param {string} weekStart  YYYY-MM-DD Monday date
 * @returns {Array<Object>}
 */
function getMealPlanWeek_(weekStart) {
  var sheet = getSpreadsheet().getSheetByName(TABS.MEAL_PLAN);
  if (!sheet) return [];

  var rows = _readMealPlanRows_(sheet);
  var week = rows.filter(function(r) { return r.weekStart === weekStart; });

  if (week.length === 0) {
    // Seed blank rows for the week
    MEAL_PLAN_DAYS_.forEach(function(day) {
      var date = dayDateForWeek_(weekStart, day);
      var id   = generateId_('MP');
      sheet.appendRow([id, weekStart, day, date, '', '', 'Planned', '']);
    });
    // Re-read
    rows = _readMealPlanRows_(sheet);
    week = rows.filter(function(r) { return r.weekStart === weekStart; });
  }

  // Sort Mon→Sun
  week.sort(function(a, b) {
    return MEAL_PLAN_DAYS_.indexOf(a.day) - MEAL_PLAN_DAYS_.indexOf(b.day);
  });

  return week;
}

/**
 * Returns meal data from the last nWeeks weeks (excluding current), for variety context.
 */
function getMealPlanHistory_(nWeeks) {
  var sheet = getSpreadsheet().getSheetByName(TABS.MEAL_PLAN);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var current = getCurrentWeekStart_();
  var rows    = _readMealPlanRows_(sheet);

  // Filter to past weeks with actual meal names
  var past = rows.filter(function(r) {
    return r.weekStart < current && r.mealName;
  });

  // Get distinct week starts sorted descending, take last nWeeks
  var weekStarts = [];
  past.forEach(function(r) {
    if (weekStarts.indexOf(r.weekStart) === -1) weekStarts.push(r.weekStart);
  });
  weekStarts.sort().reverse();
  var recentWeeks = weekStarts.slice(0, nWeeks || 3);

  return past.filter(function(r) { return recentWeeks.indexOf(r.weekStart) !== -1; });
}

function _readMealPlanRows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, MEAL_PLAN_HEADERS.length).getValues();
  return data
    .filter(function(r) { return String(r[MP_COL_.ID] || '').trim() !== ''; })
    .map(function(r, i) {
      return {
        rowNum:    i + 2,
        id:        String(r[MP_COL_.ID]        || ''),
        weekStart: String(r[MP_COL_.WEEK_START] || ''),
        day:       String(r[MP_COL_.DAY]        || ''),
        date:      String(r[MP_COL_.DATE]       || ''),
        mealName:  String(r[MP_COL_.MEAL_NAME]  || ''),
        type:      String(r[MP_COL_.TYPE]       || ''),
        status:    String(r[MP_COL_.STATUS]     || 'Planned'),
        notes:     String(r[MP_COL_.NOTES]      || ''),
      };
    });
}

// ============================================================
// Write
// ============================================================

/**
 * Upserts a meal plan entry. Matches by weekStart + day; creates if not found.
 */
function upsertMealPlanEntry_(weekStart, day, date, mealName, type, status, notes) {
  var sheet = getSpreadsheet().getSheetByName(TABS.MEAL_PLAN);
  if (!sheet) throw new Error('Meal Plan tab not found');

  var rows    = _readMealPlanRows_(sheet);
  var existing = rows.find(function(r) { return r.weekStart === weekStart && r.day === day; });

  if (existing) {
    sheet.getRange(existing.rowNum, MP_COL_.MEAL_NAME + 1).setValue(mealName  !== undefined ? mealName  : existing.mealName);
    sheet.getRange(existing.rowNum, MP_COL_.TYPE      + 1).setValue(type      !== undefined ? type      : existing.type);
    sheet.getRange(existing.rowNum, MP_COL_.STATUS    + 1).setValue(status    !== undefined ? status    : existing.status);
    sheet.getRange(existing.rowNum, MP_COL_.NOTES     + 1).setValue(notes     !== undefined ? notes     : existing.notes);
    return existing.id;
  } else {
    var id = generateId_('MP');
    if (!date) date = dayDateForWeek_(weekStart, day);
    sheet.appendRow([id, weekStart, day, date, mealName || '', type || '', status || 'Planned', notes || '']);
    return id;
  }
}

// ============================================================
// Saturday reset
// ============================================================

/**
 * Called Saturday night from nightlyRun().
 * Seeds 7 blank rows for next week (idempotent — skips if rows already exist).
 */
function resetWeekMealPlan_() {
  var nextWeek = getNextWeekStart_();
  var sheet    = getSpreadsheet().getSheetByName(TABS.MEAL_PLAN);
  if (!sheet) return;

  var rows     = _readMealPlanRows_(sheet);
  var existing = rows.filter(function(r) { return r.weekStart === nextWeek; });
  if (existing.length > 0) {
    Logger.log('resetWeekMealPlan_: next week (' + nextWeek + ') already exists — skipping.');
    return;
  }

  MEAL_PLAN_DAYS_.forEach(function(day) {
    var date = dayDateForWeek_(nextWeek, day);
    sheet.appendRow([generateId_('MP'), nextWeek, day, date, '', '', 'Planned', '']);
  });
  Logger.log('resetWeekMealPlan_: seeded 7 blank rows for week of ' + nextWeek);
}

// ============================================================
// VERA suggestions (Claude)
// ============================================================

/**
 * Calls Claude to suggest a full week of dinners.
 * Returns [{day, mealName, type}, ...] x7.
 *
 * @param {string} weekStart  YYYY-MM-DD
 * @returns {Array<Object>}
 */
function suggestWeekMeals_(weekStart) {
  // Recent meal history for variety
  var history  = getMealPlanHistory_(3);
  var recentMeals = history
    .filter(function(r) { return r.mealName; })
    .map(function(r) { return r.mealName; });
  var recentList = recentMeals.length
    ? recentMeals.join(', ')
    : 'none';

  // Available recipes
  var recipeNames = [];
  try {
    var recipeSheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
    if (recipeSheet && recipeSheet.getLastRow() > 1) {
      var recipeData = recipeSheet.getRange(2, 1, recipeSheet.getLastRow() - 1, 1).getValues();
      recipeNames = recipeData.map(function(r) { return String(r[0] || '').trim(); }).filter(Boolean);
    }
  } catch (e) { /* no recipes tab */ }

  var recipeList = recipeNames.length ? recipeNames.slice(0, 20).join(', ') : 'none saved yet';

  var tz        = Session.getScriptTimeZone();
  var weekLabel = Utilities.formatDate(new Date(weekStart + 'T00:00:00'), tz, 'MMMM d');

  var prompt =
    'Suggest 7 dinners for the week starting ' + weekLabel + ' (Monday through Sunday).\n\n' +
    'Guidelines:\n' +
    '- Mon–Thu: quicker/lighter meals (≤45 min, simple ingredients)\n' +
    '- Fri–Sun: can be more elaborate, takeout or eating out is fine 1–2 nights\n' +
    '- Avoid repeating these recent dinners: ' + recentList + '\n' +
    '- Draw from these household recipes if suitable: ' + recipeList + '\n' +
    '- Mix of Home Cooked, Takeout, and Eating Out across the week\n\n' +
    'Reply ONLY with a valid JSON array, no markdown fences, no explanation:\n' +
    '[{"day":"Mon","meal":"Pasta Carbonara","type":"Home Cooked"},{"day":"Tue",...}]';

  var apiKey  = getApiKey();
  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method:      'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model:    'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Claude API error: ' + response.getResponseCode());
  }

  var raw  = JSON.parse(response.getContentText()).content[0].text.trim();
  // Strip markdown fences if present
  raw = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();

  var suggestions = JSON.parse(raw);

  // Write suggestions to sheet
  suggestions.forEach(function(s) {
    if (!s.day || !s.meal) return;
    upsertMealPlanEntry_(weekStart, s.day,
      dayDateForWeek_(weekStart, s.day), s.meal, s.type || 'Home Cooked', 'Planned', '');
  });

  return suggestions;
}
