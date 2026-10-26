// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The first restores the bug that made the planner useless — and it is the one that
// matters most, because it keeps the code compiling, keeps every string in place, and
// still returns an empty week from a tab full of dinners. A test written over fixtures
// of STRINGS passes on it, which is exactly how it survived: the sheet stores Dates.
//
// The rest guard the three things the rewrite could quietly undo: the read that must
// not write, the write that must land on the right sheet row, and the swap that must
// read both days before it writes either.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_mp');
// The dashboards are not root .js files, and the sub-tab controls below mutate them.
const EXTRA = ['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'];
const ROOT_JS = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
ROOT_JS.concat(EXTRA).forEach(f => {
  const p = path.join(SRC_DIR, f);
  if (fs.existsSync(p)) BASE[f] = fs.readFileSync(p, 'utf8');
});

// An anchor that has moved must THROW, not silently leave the file unchanged — an
// unapplied mutation is a control that has stopped controlling for anything.
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 60));
  return src.replace(from, to);
};

const CONTROLS = {
  // ---- the bug itself, restored --------------------------------------------
  'the date cells go back to bare String()': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      '        weekStart: dateCellToIso_(r[MP_COL_.WEEK_START]),',
      "        weekStart: String(r[MP_COL_.WEEK_START] || ''),"),
  }),
  'only the Date column is normalised, not Week Start': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      '        weekStart: dateCellToIso_(r[MP_COL_.WEEK_START]),',
      '        weekStart: String(r[MP_COL_.WEEK_START]),'),
  }),
  'the normaliser stops handling Date objects': b => ({
    'Trips.js': swap(b['Trips.js'],
      '  if (v instanceof Date && !isNaN(v.getTime())) {',
      '  if (false) {'),
  }),

  // ---- the read that must not write ----------------------------------------
  'a missing week is seeded with seven blank rows again': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      '  var week = _readMealPlanRows_(sheet).filter(function(r) { return r.weekStart === weekStart; });',
      '  var week = _readMealPlanRows_(sheet).filter(function(r) { return r.weekStart === weekStart; });\n' +
      '  if (week.length === 0) {\n' +
      '    MEAL_PLAN_DAYS_.forEach(function(day) {\n' +
      '      sheet.appendRow([generateId_(\'MP\'), weekStart, day, dayDateForWeek_(weekStart, day), \'\', \'\', \'Planned\', \'\']);\n' +
      '    });\n' +
      '    week = _readMealPlanRows_(sheet).filter(function(r) { return r.weekStart === weekStart; });\n' +
      '  }'),
  }),

  // ---- the write that must land on the right row ---------------------------
  // The off-by-one found while fixing the date bug: rowNum taken from the FILTERED
  // array, so one blank-ID row above shifted every update one row up.
  'rowNum is indexed after the blank-ID filter again': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      '    .map(function(r, i) { return { r: r, rowNum: i + 2 }; })\n' +
      "    .filter(function(x) { return String(x.r[MP_COL_.ID] || '').trim() !== ''; })\n" +
      '    .map(function(x) {\n' +
      '      var r = x.r;',
      "    .filter(function(r) { return String(r[MP_COL_.ID] || '').trim() !== ''; })\n" +
      '    .map(function(r, i) {\n' +
      '      var x = { rowNum: i + 2 };'),
  }),
  'an update writes the Day column too': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      '    sheet.getRange(existing.rowNum, MP_COL_.MEAL_NAME + 1).setValue(',
      '    sheet.getRange(existing.rowNum, MP_COL_.DAY + 1).setValue(day);\n' +
      '    sheet.getRange(existing.rowNum, MP_COL_.MEAL_NAME + 1).setValue('),
  }),

  // ---- the move ------------------------------------------------------------
  'the swap writes the target before reading it': b => {
    const s = b['MealPlan.js'];
    const read = '  var returning = swapped\n' +
                 "    ? { mealName: target.mealName, type: target.type, status: target.status, notes: target.notes }\n" +
                 "    : { mealName: '', type: '', status: 'Planned', notes: '' };";
    if (s.indexOf(read) === -1) throw new Error('the pre-read moved');
    // Re-read the target AFTER the first write, which is what putting the write first
    // amounts to: both nights end up with the same dinner and one is lost.
    return { 'MealPlan.js': s.replace(read,
      '  upsertMealPlanEntry_(toWeekStart, toDay, dayDateForWeek_(toWeekStart, toDay),\n' +
      '    carried.mealName, carried.type, carried.status, carried.notes);\n' +
      '  var reread = _readMealPlanRows_(sheet).find(function(r) { return r.weekStart === toWeekStart && r.day === toDay; }) || {};\n' +
      '  var returning = swapped\n' +
      "    ? { mealName: reread.mealName, type: reread.type, status: reread.status, notes: reread.notes }\n" +
      "    : { mealName: '', type: '', status: 'Planned', notes: '' };") };
  },
  'an occupied target is overwritten instead of swapped': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      '  var returning = swapped\n' +
      '    ? { mealName: target.mealName, type: target.type, status: target.status, notes: target.notes }\n' +
      "    : { mealName: '', type: '', status: 'Planned', notes: '' };",
      "  var returning = { mealName: '', type: '', status: 'Planned', notes: '' };"),
  }),
  'the source day is never cleared': b => {
    const s = b['MealPlan.js'];
    const clear = '  upsertMealPlanEntry_(fromWeekStart, fromDay, dayDateForWeek_(fromWeekStart, fromDay),\n' +
                  '    returning.mealName, returning.type, returning.status, returning.notes);';
    if (s.indexOf(clear) === -1) throw new Error('the source write moved');
    return { 'MealPlan.js': s.replace(clear, '') };
  },
  'a move onto the same day falls through and writes': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      '  if (fromWeekStart === toWeekStart && fromDay === toDay) {',
      '  if (false) {'),
  }),
  'an unknown day is accepted': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      "  if (MEAL_PLAN_DAYS_.indexOf(toDay)   === -1) throw new Error('unknown day: ' + toDay);", '  ;'),
  }),
  'an empty day can be moved': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      "  if (!source || !source.mealName) throw new Error('nothing to move from ' + fromDay);",
      '  if (!source) source = { mealName: \'\', type: \'\', status: \'Planned\', notes: \'\' };'),
  }),

  // ---- week arithmetic -----------------------------------------------------
  'weeks are added as hours, so DST moves the Monday': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      '  mon.setDate(mon.getDate() + (n || 0) * 7);',
      '  mon = new Date(mon.getTime() + (n || 0) * 7 * 24 * 3600 * 1000);'),
  }),

  // ---- history -------------------------------------------------------------
  'history includes the current week': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      '    return r.weekStart < current && r.mealName;',
      '    return r.weekStart <= current && r.mealName;'),
  }),

  // ---- cleanup -------------------------------------------------------------
  'the cleanup deletes top-down': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      '    .sort(function(a, b) { return b - a; });',
      '    .sort(function(a, b) { return a - b; });'),
  }),
  'the cleanup takes rows that hold a dinner': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      '    .filter(function(r) { return !String(r.mealName).trim(); })\n' +
      '    .map(function(r) { return r.rowNum; })',
      '    .map(function(r) { return r.rowNum; })'),
  }),
  'the preview deletes': b => ({
    'MealPlan.js': swap(b['MealPlan.js'],
      '  if (!dryRun) blanks.forEach(function(n) { sheet.deleteRow(n); });',
      '  blanks.forEach(function(n) { sheet.deleteRow(n); });'),
  }),

  // ---- the endpoints -------------------------------------------------------
  'the week count is unbounded': b => ({
    'WebApp.js': swap(b['WebApp.js'],
      '  var n         = Math.min(Math.max(parseInt(p.weeks, 10) || 1, 1), 8);',
      '  var n         = parseInt(p.weeks, 10) || 1;'),
  }),
  'meal_plan stops returning the first week as `days`': b => ({
    'WebApp.js': swap(b['WebApp.js'],
      '  var res = { ok: true, weekStart: weekStart, days: weeks[0].days, weeks: weeks };',
      '  var res = { ok: true, weekStart: weekStart, weeks: weeks };'),
  }),
  'move_meal loses its route': b => ({
    'WebApp.js': swap(b['WebApp.js'],
      "      case 'move_meal':             return jsonOut_(webMoveMeal_(e));", ''),
  }),

  // ---- the tab itself ------------------------------------------------------
  // The gate, put back one page at a time. Each of these is the exact state that
  // made the sub-tab vanish from dashboard-lite, and each must be caught — a page
  // that loses the tab while the other keeps it is the failure that started this.
  'the dashboard-lite tab is flag-gated again': b => ({
    'docs/dashboard-lite.html': swap(b['docs/dashboard-lite.html'],
      "{ id:'meal_plan', label:'📅 Meal Plan' },",
      "{ id:'meal_plan', label:'📅 Meal Plan', featureKey:'meal_planner' },"),
  }),
  'the full dashboard tab is flag-gated again': b => ({
    'docs/app.js': swap(b['docs/app.js'],
      "{id:'meal_plan',label:'🗓️ Meal Plan'}",
      "{id:'meal_plan',label:'🗓️ Meal Plan',featureKey:'meal_planner'}"),
  }),
  // docs/index.html is GENERATED from app.js. Gating it alone is what a forgotten
  // `node docs/build.js` looks like: the source is right and the shipped page is not.
  'the built page keeps a gate the source dropped': b => ({
    'docs/index.html': swap(b['docs/index.html'],
      "{id:'meal_plan',label:'🗓️ Meal Plan'}",
      "{id:'meal_plan',label:'🗓️ Meal Plan',featureKey:'meal_planner'}"),
  }),
  'the sub-tab is dropped from dashboard-lite entirely': b => ({
    'docs/dashboard-lite.html': swap(b['docs/dashboard-lite.html'],
      "{ id:'meal_plan', label:'📅 Meal Plan' },", ''),
  }),
};

// Each control is checked against the test that owns the behaviour: the sub-tab's
// presence is a parity rule, the morning email's packing count belongs to
// test_morningintel.js, and everything else to test_mealplan.js.
const TEST_FOR = name =>
  (/sub-tab|flag-gated|built page/.test(name) ? 'test_parity.js' : 'test_mealplan.js');

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true });
  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });

  const r = cp.spawnSync('node', [TEST_FOR(name)], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)         { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length)   { console.log('  !! NOTHING BIT (patched: ' + changed.join(', ') + ')'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 3).forEach(f => console.log('    - ' + f));
  if (fails.length > 3) console.log('    … and ' + (fails.length - 3) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
