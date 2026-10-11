// The meal planner showed an empty week and swallowed every save, for one reason: a
// cell type.
//
// Week Start is written as the string '2026-10-05'. Sheets stores a date-shaped string
// as a DATE, so getValues() hands back a Date, and String(date) is
// 'Sun Oct 05 2026 00:00:00 GMT-0400 (EDT)'. Every lookup in MealPlan.js compares
// weekStart for equality against 'yyyy-MM-dd', so every lookup missed:
//
//   · getMealPlanWeek_ found no week, appended 7 blank rows, re-read, found none
//     again, and returned [] — a GET that wrote seven rows and rendered an empty week.
//   · upsertMealPlanEntry_ found nothing to update and appended instead, so a saved
//     dinner was written and then invisible.
//   · getMealPlanHistory_ compared a full date string with `<`, so Suggest Week had
//     no variety context.
//
// So the fixtures here hold REAL Date objects in those columns. A fixture of strings
// would pass against the broken code and prove nothing — that is precisely the version
// that shipped.
//
// The timezone is pinned BEFORE the first Date is constructed, and it has to be one
// that observes DST. The container runs in UTC, where every week is exactly 7 × 24h,
// so the week arithmetic below cannot tell `setDate(+7)` from `+7*24*3600*1000` — the
// control that swaps one for the other passed happily against a UTC clock while the
// script's own timezone is America/New_York, which is where the Monday would slip.
process.env.TZ = 'America/New_York';

const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const MP   = fs.readFileSync(ROOT + '/MealPlan.js', 'utf8');
const TRP  = fs.readFileSync(ROOT + '/Trips.js',    'utf8');
const WEB  = fs.readFileSync(ROOT + '/WebApp.js',   'utf8');
const CODE = fs.readFileSync(ROOT + '/Code.js',     'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const HEADERS = ['ID','Week Start','Day','Date','Meal Name','Type','Status','Notes'];
const DAYS    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function formatDate(d, tz, pat) {
  const D = new Date(d), p2 = n => String(n).padStart(2, '0');
  if (pat === 'yyyy-MM-dd')     return D.getFullYear() + '-' + p2(D.getMonth()+1) + '-' + p2(D.getDate());
  if (pat === 'yyyyMMddHHmmss') return '' + D.getFullYear() + p2(D.getMonth()+1) + p2(D.getDate()) +
                                       p2(D.getHours()) + p2(D.getMinutes()) + p2(D.getSeconds());
  throw new Error('formatDate: unhandled pattern ' + pat);
}

// A sheet that counts every mutation. "A read must not write" is the property under
// test for getMealPlanWeek_, and only a counter can state it.
function makeSheet(rows, calls) {
  return {
    _rows: rows,
    getLastRow() { return rows.length + 1; },          // +1 for the header row
    appendRow(r) { calls.appendRow++; rows.push(r.slice()); },
    deleteRow(n) { calls.deleteRow.push(n); rows.splice(n - 2, 1); },
    getRange(startRow, startCol, nRows, nCols) {
      return {
        getValues() {
          calls.getValues++;
          return rows.slice(startRow - 2, startRow - 2 + (nRows === undefined ? 1 : nRows))
                     .map(r => r.slice(startCol - 1, startCol - 1 + (nCols === undefined ? 1 : nCols)));
        },
        setValue(v) {
          calls.setValue.push({ row: startRow, col: startCol, value: v });
          const r = rows[startRow - 2];
          if (!r) throw new Error('setValue on a row that does not exist: ' + startRow);
          r[startCol - 1] = v;
        },
      };
    },
  };
}

/**
 * A week of rows as the LIVE SHEET returns them: Week Start and Date are Date objects,
 * because that is what Sheets stores for a date-shaped string.
 */
function weekRows(weekStart, meals, opts) {
  opts = opts || {};
  const mon = new Date(weekStart + 'T00:00:00');
  return DAYS.map(function(day, i) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const name = (meals || {})[day] || '';
    return [
      'MP-' + weekStart + '-' + day,
      opts.asText ? weekStart : new Date(mon),
      day,
      opts.asText ? formatDate(d, null, 'yyyy-MM-dd') : d,
      name,
      name ? (opts.type || 'Home Cooked') : '',
      name ? (opts.status || 'Planned') : 'Planned',
      '',
    ];
  });
}

function harness(rows) {
  const calls = { appendRow: 0, getValues: 0, setValue: [], deleteRow: [] };
  const sheet = makeSheet(rows || [], calls);
  const logs  = [];
  const ctx = {
    console, Date, Math, String, Number, Object, Array, JSON, isNaN, parseInt, Error,
    Logger: { log: m => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate },
    TABS: { MEAL_PLAN: 'Meal Plan' },
    MEAL_PLAN_HEADERS: HEADERS,
    getSpreadsheet: () => ({ getSheetByName: n => (n === 'Meal Plan' ? sheet : null) }),
    _calls: calls, _logs: logs, _sheet: sheet,
  };
  vm.createContext(ctx);
  vm.runInContext("var MEAL_PLAN_DAYS_ = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];" +
                  'var MP_COL_ = { ID:0, WEEK_START:1, DAY:2, DATE:3, MEAL_NAME:4, TYPE:5, STATUS:6, NOTES:7 };', ctx);
  [extractFn(TRP, 'dateCellToIso_'),
   extractFn(MP,  'generateId_'),
   extractFn(MP,  'addWeeksToStart_'),
   extractFn(MP,  'dayDateForWeek_'),
   extractFn(MP,  'getCurrentWeekStart_'),
   extractFn(MP,  'getNextWeekStart_'),
   extractFn(MP,  '_readMealPlanRows_'),
   extractFn(MP,  'getMealPlanWeek_'),
   extractFn(MP,  'getMealPlanHistory_'),
   extractFn(MP,  'upsertMealPlanEntry_'),
   extractFn(MP,  'moveMealPlanEntry_'),
   extractFn(MP,  'inspectMealPlanTab_'),
   extractFn(MP,  'purgeBlankMealPlanRows_')].forEach(s => vm.runInContext(s, ctx));
  return ctx;
}
const run = (c, expr) => vm.runInContext(expr, c);
const mealOn = (c, ws, day) => {
  const r = run(c, 'getMealPlanWeek_(' + JSON.stringify(ws) + ')').find(x => x.day === day);
  return r ? r.mealName : null;
};

const WS  = '2026-10-05';   // a Monday
const WS2 = '2026-10-12';

// ============ the bug, as the sheet actually returns it ====================

console.log('A Date in the Week Start cell still finds its week');
{
  const c = harness(weekRows(WS, { Mon:'Chili', Wed:'Tacos' }));
  const week = run(c, 'getMealPlanWeek_(' + JSON.stringify(WS) + ')');
  check('the week is found', week.length === 7,
        week.length + ' row(s) — String(aDate) is "Sun Oct 05 2026 00:00:00 GMT-0400", which ' +
        'never equals "2026-10-05", so every lookup missed and the planner read as empty');
  check('…with the dinners in it', mealOn(c, WS, 'Mon') === 'Chili' && mealOn(c, WS, 'Wed') === 'Tacos');
  check('…normalised to yyyy-MM-dd', week[0].weekStart === WS, JSON.stringify(week[0].weekStart));
  check('…and each day carries its own date', week[2].date === '2026-10-07', week[2].date);
  check('sorted Mon→Sun', week.map(r => r.day).join(',') === DAYS.join(','));

  // THE COST ASSERTION. The old version seeded seven blank rows whenever it could not
  // find the week — on a GET, every page load, forever.
  check('a read writes NOTHING', c._calls.appendRow === 0,
        c._calls.appendRow + ' appendRow(s) on a read');
}

console.log('\nA week with no rows is empty, not seeded');
{
  const c = harness(weekRows(WS, { Mon:'Chili' }));
  const week = run(c, 'getMealPlanWeek_(' + JSON.stringify(WS2) + ')');
  check('an unplanned week reads as empty', week.length === 0, JSON.stringify(week.length));
  check('…and still writes nothing', c._calls.appendRow === 0,
        'seeding blank rows on a miss is what grew the tab by seven rows per page view');
}

console.log('\nText cells still work (a tab somebody formatted as plain text)');
{
  const c = harness(weekRows(WS, { Fri:'Pizza' }, { asText:true }));
  check('a string Week Start is found too', mealOn(c, WS, 'Fri') === 'Pizza',
        'the fix must normalise, not assume the other type');
}

// ============ writes =======================================================

console.log('\nSaving a dinner updates the row instead of appending another');
{
  const c = harness(weekRows(WS, { Mon:'Chili' }));
  run(c, 'upsertMealPlanEntry_(' + JSON.stringify(WS) + ", 'Mon', '', 'Lasagne', 'Home Cooked', 'Planned', '')");
  check('nothing was appended', c._calls.appendRow === 0,
        c._calls.appendRow + ' — an append here is the row that saves and then vanishes');
  check('the existing row was updated', mealOn(c, WS, 'Mon') === 'Lasagne', mealOn(c, WS, 'Mon'));
  check('…and only the four content columns were touched',
        c._calls.setValue.every(s => s.col >= 5 && s.col <= 8),
        JSON.stringify(c._calls.setValue.map(s => s.col)) +
        ' — Day and Date define which night the row IS; they never move');
}

console.log('\nA day with no row yet gets one');
{
  const c = harness(weekRows(WS, {}));
  const rows = c._sheet._rows.length;
  run(c, 'upsertMealPlanEntry_(' + JSON.stringify(WS2) + ", 'Thu', '', 'Curry', 'Home Cooked', 'Planned', '')");
  check('exactly one row was added', c._sheet._rows.length === rows + 1);
  check('…and it reads back', mealOn(c, WS2, 'Thu') === 'Curry');
  check('…carrying the right date',
        run(c, 'getMealPlanWeek_(' + JSON.stringify(WS2) + ')')[0].date === '2026-10-15',
        run(c, 'getMealPlanWeek_(' + JSON.stringify(WS2) + ')')[0].date);
}

// A SECOND BUG, found while fixing the first. rowNum was the index in the FILTERED
// array, so one blank-ID row anywhere above shifted every write one row up — a save
// that silently overwrote a different day's dinner.
console.log('\nA blank row above does not misdirect the writes');
{
  const rows = weekRows(WS, { Mon:'Chili', Tue:'Soup' });
  rows.unshift(['', '', '', '', '', '', '', '']);        // debris with no ID, row 2
  const c = harness(rows);
  run(c, 'upsertMealPlanEntry_(' + JSON.stringify(WS) + ", 'Tue', '', 'Ramen', 'Home Cooked', 'Planned', '')");
  check('Tuesday got the new dinner', mealOn(c, WS, 'Tue') === 'Ramen', mealOn(c, WS, 'Tue'));
  check('…and Monday was left alone', mealOn(c, WS, 'Mon') === 'Chili',
        mealOn(c, WS, 'Mon') + ' — an off-by-one rowNum overwrites the row above the target');
  check('the write landed on the real sheet row',
        c._calls.setValue.length > 0 && c._calls.setValue.every(s => s.row === 4),
        JSON.stringify(c._calls.setValue.map(s => s.row)));
}

// ============ moving =======================================================

console.log('\nMoving a dinner to an empty day');
{
  const c = harness(weekRows(WS, { Mon:'Chili' }));
  const res = run(c, 'moveMealPlanEntry_(' + JSON.stringify(WS) + ", 'Mon', " + JSON.stringify(WS) + ", 'Thu')");
  check('it reports a move, not a swap', res.moved === true && res.swapped === false, JSON.stringify(res));
  check('Thursday has it', mealOn(c, WS, 'Thu') === 'Chili');
  check('…and Monday is empty', mealOn(c, WS, 'Mon') === '', JSON.stringify(mealOn(c, WS, 'Mon')));
  check('the emptied day is back to Planned',
        run(c, 'getMealPlanWeek_(' + JSON.stringify(WS) + ')').find(r => r.day === 'Mon').status === 'Planned');
}

console.log('\nMoving onto an occupied day swaps');
{
  const c = harness(weekRows(WS, { Mon:'Chili', Thu:'Tacos' }));
  const res = run(c, 'moveMealPlanEntry_(' + JSON.stringify(WS) + ", 'Mon', " + JSON.stringify(WS) + ", 'Thu')");
  check('it reports a swap', res.swapped === true, JSON.stringify(res));
  check('Thursday took Monday’s', mealOn(c, WS, 'Thu') === 'Chili', mealOn(c, WS, 'Thu'));
  check('…and Monday took Thursday’s', mealOn(c, WS, 'Mon') === 'Tacos',
        mealOn(c, WS, 'Mon') + ' — writing the target first and then reading it back ' +
        'would put the same dinner on both nights and lose one');
  check('no dinner was duplicated',
        mealOn(c, WS, 'Mon') !== mealOn(c, WS, 'Thu'));
}

console.log('\nMoving across the week boundary');
{
  const c = harness(weekRows(WS, { Sat:'Roast' }).concat(weekRows(WS2, { Tue:'Pasta' })));
  run(c, 'moveMealPlanEntry_(' + JSON.stringify(WS) + ", 'Sat', " + JSON.stringify(WS2) + ", 'Tue')");
  check('next Tuesday took it', mealOn(c, WS2, 'Tue') === 'Roast', mealOn(c, WS2, 'Tue'));
  check('…and this Saturday took next Tuesday’s', mealOn(c, WS, 'Sat') === 'Pasta', mealOn(c, WS, 'Sat'));
  check('the moved row kept the TARGET day’s date',
        run(c, 'getMealPlanWeek_(' + JSON.stringify(WS2) + ')').find(r => r.day === 'Tue').date === '2026-10-13',
        'a move carries the dinner across, never the row — the date says which night it is');
}

console.log('\nMoves that should not happen');
{
  const c = harness(weekRows(WS, { Mon:'Chili' }));
  const same = run(c, 'moveMealPlanEntry_(' + JSON.stringify(WS) + ", 'Mon', " + JSON.stringify(WS) + ", 'Mon')");
  check('a day onto itself is a no-op', same.moved === false, JSON.stringify(same));
  check('…and wrote nothing', c._calls.setValue.length === 0 && c._calls.appendRow === 0);

  const threw = (from, to) => {
    try { run(c, 'moveMealPlanEntry_(' + JSON.stringify(WS) + ", '" + from + "', " +
                 JSON.stringify(WS) + ", '" + (to || 'Thu') + "')"); return null; }
    catch (e) { return e.message; }
  };
  check('an empty day has nothing to move', /nothing to move/.test(threw('Tue') || ''), threw('Tue'));
  check('an unknown SOURCE day is refused', /unknown day/.test(threw('Funday') || ''), threw('Funday'));
  // Both guards, separately. Checking only the source leaves the target's guard
  // untested, and 'Mon' → 'Funday' would write a row for a day that does not exist.
  check('an unknown TARGET day is refused too',
        /unknown day/.test(threw('Mon', 'Funday') || ''), threw('Mon', 'Funday'));
  check('…and still nothing was written', c._calls.setValue.length === 0 && c._calls.appendRow === 0,
        'a refused move must not half-apply');
}

// ============ weeks ========================================================

console.log('\nWeek arithmetic');
{
  const c = harness([]);
  check('+1 week', run(c, "addWeeksToStart_('2026-10-05', 1)") === '2026-10-12');
  check('0 weeks is the same Monday', run(c, "addWeeksToStart_('2026-10-05', 0)") === '2026-10-05');
  check('across a month boundary', run(c, "addWeeksToStart_('2026-10-26', 1)") === '2026-11-02');
  check('across the year', run(c, "addWeeksToStart_('2026-12-28', 1)") === '2027-01-04');
  check('backwards', run(c, "addWeeksToStart_('2026-10-05', -2)") === '2026-09-21');
  // The US DST change falls on 1 November 2026. Adding 7 days to a local midnight
  // crosses it, and an hours-based implementation lands on the 1st at 23:00 the day
  // before — which formats as the WRONG Monday.
  check('across the DST change', run(c, "addWeeksToStart_('2026-10-26', 2)") === '2026-11-09',
        run(c, "addWeeksToStart_('2026-10-26', 2)"));
}

console.log('\nHistory reads past weeks, not future ones');
{
  const c = harness(weekRows('2026-09-21', { Mon:'Stew' })
            .concat(weekRows('2026-09-28', { Tue:'Fish' }))
            .concat(weekRows(WS,           { Wed:'Now'  }))
            .concat(weekRows(WS2,          { Thu:'Later'})));
  const hist = run(c, 'getMealPlanHistory_(3)').map(r => r.mealName).filter(Boolean);
  check('past dinners come back', hist.indexOf('Stew') !== -1 && hist.indexOf('Fish') !== -1,
        JSON.stringify(hist) + ' — with an unnormalised Date the `weekStart < current` ' +
        'comparison was nonsense and Suggest Week had no variety context');
  check('the current week is not history', hist.indexOf('Now') === -1, JSON.stringify(hist));
  check('…nor is next week', hist.indexOf('Later') === -1, JSON.stringify(hist));
}

// ============ cleanup ======================================================

console.log('\nThe blank-row cleanup');
{
  const rows = weekRows(WS, { Mon:'Chili', Fri:'Pizza' });
  const c = harness(rows);
  const preview = run(c, 'purgeBlankMealPlanRows_(true)');
  check('it counts the blanks', preview.matched === 5, JSON.stringify(preview));
  check('…and a preview deletes nothing', preview.deleted === 0 && c._calls.deleteRow.length === 0,
        'the preview/run pair exists so you can look before anything goes');

  const res = run(c, 'purgeBlankMealPlanRows_(false)');
  check('the run deletes them', res.deleted === 5, JSON.stringify(res));
  check('…bottom-up, or the row numbers shift under it',
        c._calls.deleteRow.join(',') === c._calls.deleteRow.slice().sort((a,b) => b-a).join(','),
        JSON.stringify(c._calls.deleteRow));
  check('the dinners survived', mealOn(c, WS, 'Mon') === 'Chili' && mealOn(c, WS, 'Fri') === 'Pizza',
        'a row with a meal name in it is never a candidate');
  check('…and nothing else is left', run(c, 'getMealPlanWeek_(' + JSON.stringify(WS) + ')').length === 2);
}

console.log('\nThe inspector names the cell type');
{
  const c = harness(weekRows(WS, { Mon:'Chili' }));
  const info = run(c, 'inspectMealPlanTab_()');
  check('it reports Week Start as a Date', info.cellTypes.weekStart === 'Date',
        JSON.stringify(info.cellTypes) + ' — the one line that would have named this bug');
  check('…counts the blanks', info.blanks === 6, JSON.stringify(info.blanks));
  check('…and groups by week', info.weeks.length === 1 && info.weeks[0].meals === 1,
        JSON.stringify(info.weeks));

  const t = harness(weekRows(WS, { Mon:'Chili' }, { asText:true }));
  check('a text tab is reported as a string', run(t, 'inspectMealPlanTab_()').cellTypes.weekStart === 'string');
}

// ============ the endpoints ================================================

console.log('\nThe web layer');
{
  const web = extractFn(WEB, 'webGetMealPlan_');
  check('meal_plan can return several weeks', /weeks/.test(web) && /addWeeksToStart_/.test(web));
  check('…and still returns `days` for the first one', /days:\s*weeks\[0\]\.days/.test(web),
        'the dashboard is not the only caller shape that ever existed');
  check('the week count is bounded', /Math\.min\(Math\.max/.test(web),
        'weeks=9999 would be 9999 sheet scans in a GET');

  check('move_meal is routed', /case 'move_meal':/.test(WEB));
  check('…to webMoveMeal_', /webMoveMeal_/.test(WEB));
  const mv = extractFn(WEB, 'webMoveMeal_');
  check('it requires both days', /fromDay parameter required/.test(mv) && /toDay parameter required/.test(mv));
  check('…and defaults the target week to the source week', /p\.toWeekStart\s*\|\|\s*fromWeek/.test(mv),
        'a move inside one week should not have to name it twice');
}

console.log('\nThe Saturday seeding job is gone');
{
  check('nightlyRun no longer calls it', CODE.indexOf("nightlyStep_(ctx, 'resetWeekMealPlan_'") === -1,
        'it seeded seven blank rows for next week, and there are no blank rows to seed');
  check('…and the function went with it', MP.indexOf('function resetWeekMealPlan_') === -1,
        'a nightly step that can only append empty rows is not worth the slot');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
