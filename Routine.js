// ============================================================
// VERA — Routine.js
// Health › Morning Routine: two lists, Weekday and Weekend, in a List column after Added Date
// (named the first time it's written). An item with no list (from before) shows on both. The
// screen opens on today's list; VERA can generate either one, replacing only its own items there.
// ============================================================

var MR_LIST_COL_ = 8;
var MR_LISTS_ = ['Weekday', 'Weekend'];

/** Pure: a list value as Weekday / Weekend, '' for both. */
function mrList_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'weekday' ? 'Weekday' : s === 'weekend' ? 'Weekend' : '';
}

/** Pure: whether an item (its List cell) shows on a list. */
function mrInList_(itemList, list) { var l = mrList_(itemList); return !l || !mrList_(list) || l === mrList_(list); }

/** Pure: today's list: Saturday and Sunday are Weekend. */
function mrTodayList_(d) { var w = (d || new Date()).getDay(); return w === 0 || w === 6 ? 'Weekend' : 'Weekday'; }

function mrEnsureListCol_(sheet) {
  if (sheet.getMaxColumns() < MR_LIST_COL_) sheet.insertColumnsAfter(sheet.getMaxColumns(), MR_LIST_COL_ - sheet.getMaxColumns());
  if (!String(sheet.getRange(1, MR_LIST_COL_).getValue() || '').trim()) sheet.getRange(1, MR_LIST_COL_).setValue('List');
}

/** Pure: the prompt for a list. */
function mrPrompt_(list) {
  var weekend = mrList_(list) === 'Weekend';
  return 'You are VERA, a personal chief of staff AI. Generate a personalized ' + (weekend ? 'WEEKEND' : 'WEEKDAY') + ' morning routine checklist.\n' +
    (weekend
      ? 'It is a slower morning with no work: keep it unhurried. Include a longer walk or workout outside, an unrushed breakfast, ' +
        'some reading or a hobby, a light tidy, and a look at the weekend plans. Skip work email.\n'
      : 'Follow these frameworks:\n' +
        '1. The 10-10-10 Framework: Three 10-min blocks — Input (read a book or saved article, no news/social media), ' +
        'Movement (10-min walk outside for morning sunlight), Stillness (5-10 min breath meditation).\n' +
        '2. Administrative Sweep: Check VERA FLAGS for high-priority alerts; scan today\'s calendar for surprises.\n' +
        '3. Physical anchors: hydrate (full glass of water), light/air exposure.\n') +
    '\nReturn a JSON array of 6-10 concise checklist item strings (under 60 chars each, no markdown, no numbers, no times).\n' +
    'Example: ["Drink a full glass of water", "Step outside for 10 minutes", "Read for 10 minutes"]\n' +
    'Return ONLY the JSON array, nothing else.';
}
