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
var MP_COL_ = { ID: 0, WEEK_START: 1, DAY: 2, DATE: 3, MEAL_NAME: 4, TYPE: 5, STATUS: 6, NOTES: 7, USES: 8, RATING: 9 };

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
 * The Monday n weeks after the given one, as a YYYY-MM-DD string.
 * n may be negative. Built on the date rather than on string arithmetic so month and
 * year boundaries, and the DST weekends either side of them, take care of themselves.
 */
function addWeeksToStart_(weekStart, n) {
  var tz  = Session.getScriptTimeZone();
  var mon = new Date(weekStart + 'T00:00:00');
  mon.setDate(mon.getDate() + (n || 0) * 7);
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
 * Returns the meal plan rows that EXIST for a given weekStart, sorted Mon→Sun.
 *
 * It no longer seeds seven blank rows for a week it cannot find. That seeding was a
 * write on a GET — and with the weekStart comparison broken (see _readMealPlanRows_)
 * the week was never found, so every single page load appended seven more blank rows
 * and the tab grew without bound.
 *
 * A blank row carries no information: the dashboard draws all seven days from its own
 * day list and fills in whatever comes back, and upsertMealPlanEntry_ creates a row
 * the moment a meal is actually set. So the tab now holds only dinners that exist.
 *
 * @param {string} weekStart  YYYY-MM-DD Monday date
 * @returns {Array<Object>}
 */
function getMealPlanWeek_(weekStart) {
  var sheet = getSpreadsheet().getSheetByName(TABS.MEAL_PLAN);
  if (!sheet) return [];

  var week = _readMealPlanRows_(sheet).filter(function(r) { return r.weekStart === weekStart; });

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

/**
 * Every row in the tab, with the two date columns NORMALISED.
 *
 * dateCellToIso_ is the whole of the fix for Issue #122's long-standing "nothing
 * saves". Week Start is written as the string '2026-10-05', and Sheets stores a
 * date-shaped string as a DATE — so reading it back with String() gave
 * 'Sun Oct 05 2026 00:00:00 GMT-0400 (EDT)'. Every lookup in this file compares
 * weekStart for equality, so every lookup missed:
 *
 *   · getMealPlanWeek_ found no week, appended 7 blank rows, re-read, still found
 *     none, returned [] — a GET that wrote 7 rows and showed an empty planner.
 *   · upsertMealPlanEntry_ found no row to update and appended a new one, so a saved
 *     dinner was written and then invisible.
 *   · getMealPlanHistory_'s `weekStart < current` compared a full date string against
 *     'yyyy-MM-dd', so Suggest Week had no variety context.
 *
 * rowNum is the SHEET row, so it must be indexed before the blank-ID filter drops
 * anything — a filter-then-index would point every write at the wrong row.
 */
function _readMealPlanRows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, MEAL_PLAN_HEADERS.length).getValues();
  return data
    .map(function(r, i) { return { r: r, rowNum: i + 2 }; })
    .filter(function(x) { return String(x.r[MP_COL_.ID] || '').trim() !== ''; })
    .map(function(x) {
      var r = x.r;
      return {
        rowNum:    x.rowNum,
        id:        String(r[MP_COL_.ID]        || ''),
        weekStart: dateCellToIso_(r[MP_COL_.WEEK_START]),
        day:       String(r[MP_COL_.DAY]        || '').trim(),
        date:      dateCellToIso_(r[MP_COL_.DATE]),
        mealName:  String(r[MP_COL_.MEAL_NAME]  || ''),
        type:      String(r[MP_COL_.TYPE]       || ''),
        status:    String(r[MP_COL_.STATUS]     || 'Planned'),
        notes:     String(r[MP_COL_.NOTES]      || ''),
        uses:      String(r[MP_COL_.USES]       || '').split(',').map(function(s) { return s.trim(); }).filter(String),
        rating:    String(r[MP_COL_.RATING]     || '').trim().toLowerCase(),
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

/**
 * Sets a dinner's Uses (on-hand ids) and/or Rating (again | skip | ''). Leaves a field
 * alone when it is undefined. The two columns were added after the tab existed, so the
 * header row is brought up to date first (tiSchema_). Returns false when the day has no row.
 */
function mpSetExtras_(weekStart, day, uses, rating) {
  var sheet = getSpreadsheet().getSheetByName(TABS.MEAL_PLAN);
  if (!sheet) throw new Error('Meal Plan tab not found');
  tiSchema_(sheet, MEAL_PLAN_HEADERS);
  var row = _readMealPlanRows_(sheet).find(function(r) { return r.weekStart === weekStart && r.day === day; });
  if (!row) return false;
  if (uses !== undefined) sheet.getRange(row.rowNum, MP_COL_.USES + 1).setValue((uses || []).join(','));
  if (rating !== undefined) sheet.getRange(row.rowNum, MP_COL_.RATING + 1).setValue(String(rating || ''));
  return true;
}

// ============================================================
// Diagnosis and cleanup
// ============================================================

/**
 * What the tab actually contains, and in what cell types.
 *
 * Written because the whole planner failed silently on a type: Week Start LOOKED like
 * '2026-10-05' in the sheet and came back as a Date, and nothing in the UI could show
 * you that. dryRun is implied — this reads and deletes nothing.
 *
 * @returns {Object} counts, the raw constructor names, and the blank-row backlog
 */
function inspectMealPlanTab_() {
  var sheet = getSpreadsheet().getSheetByName(TABS.MEAL_PLAN);
  if (!sheet) return { ok: false, error: 'Meal Plan tab not found' };
  if (sheet.getLastRow() < 2) return { ok: true, rows: 0, blanks: 0, weeks: [], cellTypes: {} };

  var raw = sheet.getRange(2, 1, sheet.getLastRow() - 1, MEAL_PLAN_HEADERS.length).getValues();
  var typeOf = function(v) {
    if (v instanceof Date) return 'Date';
    if (v === '' || v === null || v === undefined) return 'empty';
    return typeof v;
  };

  var rows   = _readMealPlanRows_(sheet);
  var blanks = rows.filter(function(r) { return !String(r.mealName).trim(); }).length;

  var byWeek = {};
  rows.forEach(function(r) {
    var w = byWeek[r.weekStart] || (byWeek[r.weekStart] = { weekStart: r.weekStart, rows: 0, meals: 0, days: {} });
    w.rows++;
    if (String(r.mealName).trim()) w.meals++;
    w.days[r.day] = (w.days[r.day] || 0) + 1;
  });
  var weeks = Object.keys(byWeek).sort().map(function(k) {
    var w = byWeek[k];
    w.duplicatedDays = Object.keys(w.days).filter(function(d) { return w.days[d] > 1; }).length;
    return w;
  });

  return {
    ok:     true,
    rows:   rows.length,
    blanks: blanks,
    weeks:  weeks,
    // The first data row's raw types. One line that would have named the bug.
    cellTypes: {
      weekStart: typeOf(raw[0][MP_COL_.WEEK_START]),
      date:      typeOf(raw[0][MP_COL_.DATE]),
      rawWeekStart: String(raw[0][MP_COL_.WEEK_START]),
    },
  };
}

/**
 * Deletes rows that hold no dinner.
 *
 * Every one of them is debris from the old seed-on-read: a blank row carries no
 * information the dashboard needs, since it draws all seven days itself. Rows WITH a
 * meal name are never candidates, whatever week they belong to.
 *
 * Deletes bottom-up, because deleting a row shifts every row beneath it.
 *
 * @param {boolean} dryRun  true to count without deleting
 */
function purgeBlankMealPlanRows_(dryRun) {
  var sheet = getSpreadsheet().getSheetByName(TABS.MEAL_PLAN);
  if (!sheet) return { ok: false, error: 'Meal Plan tab not found' };

  var blanks = _readMealPlanRows_(sheet)
    .filter(function(r) { return !String(r.mealName).trim(); })
    .map(function(r) { return r.rowNum; })
    .sort(function(a, b) { return b - a; });

  if (!dryRun) blanks.forEach(function(n) { sheet.deleteRow(n); });

  return { ok: true, matched: blanks.length, deleted: dryRun ? 0 : blanks.length, dryRun: !!dryRun };
}

// ============================================================
// Move
// ============================================================

/**
 * Moves a dinner from one day to another, across weeks if asked.
 *
 * A row here is a SLOT (weekStart + day), not a movable object: its Day and Date
 * define which night it is, and the Meal Name / Type / Status / Notes are what sits
 * in it. So a move copies those four fields across and is never a re-parenting of
 * the row — moving the row would take its date with it.
 *
 * An occupied target SWAPS. Dropping Thursday's dinner onto Monday puts Monday's on
 * Thursday, because the common reason to move a dinner is to trade two nights, and a
 * swap is the one behaviour that cannot lose a plan there is no undo for.
 *
 * One call, one read, so the two halves cannot half-succeed the way two set_meal
 * round trips from the dashboard could.
 *
 * @returns {Object} { moved, swapped, from: {...}, to: {...} }
 */
function moveMealPlanEntry_(fromWeekStart, fromDay, toWeekStart, toDay) {
  var sheet = getSpreadsheet().getSheetByName(TABS.MEAL_PLAN);
  if (!sheet) throw new Error('Meal Plan tab not found');
  if (MEAL_PLAN_DAYS_.indexOf(fromDay) === -1) throw new Error('unknown day: ' + fromDay);
  if (MEAL_PLAN_DAYS_.indexOf(toDay)   === -1) throw new Error('unknown day: ' + toDay);
  if (fromWeekStart === toWeekStart && fromDay === toDay) {
    return { moved: false, swapped: false, reason: 'same day' };
  }

  var rows   = _readMealPlanRows_(sheet);
  var source = rows.find(function(r) { return r.weekStart === fromWeekStart && r.day === fromDay; });
  if (!source || !source.mealName) throw new Error('nothing to move from ' + fromDay);
  var target = rows.find(function(r) { return r.weekStart === toWeekStart && r.day === toDay; });

  var carried = { mealName: source.mealName, type: source.type, status: source.status, notes: source.notes };
  var swapped = !!(target && target.mealName);
  // Read before either write, so a swap cannot read back what it has just written.
  var returning = swapped
    ? { mealName: target.mealName, type: target.type, status: target.status, notes: target.notes }
    : { mealName: '', type: '', status: 'Planned', notes: '' };

  upsertMealPlanEntry_(toWeekStart, toDay, dayDateForWeek_(toWeekStart, toDay),
    carried.mealName, carried.type, carried.status, carried.notes);
  upsertMealPlanEntry_(fromWeekStart, fromDay, dayDateForWeek_(fromWeekStart, fromDay),
    returning.mealName, returning.type, returning.status, returning.notes);
  // What a dinner uses, and how it was rated, go with it (or swap with it).
  mpSetExtras_(toWeekStart, toDay, source.uses || [], source.rating || '');
  mpSetExtras_(fromWeekStart, fromDay, swapped ? (target.uses || []) : [], swapped ? (target.rating || '') : '');

  return {
    moved:   true,
    swapped: swapped,
    from:    { weekStart: fromWeekStart, day: fromDay, mealName: returning.mealName },
    to:      { weekStart: toWeekStart,   day: toDay,   mealName: carried.mealName },
  };
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
  var response = fetchTracked_('anthropic', 'https://api.anthropic.com/v1/messages', {
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
