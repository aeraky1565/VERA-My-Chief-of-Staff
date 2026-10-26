// Negative controls for Meal Plan "on hand" (OnHand.js and the shared MealHand block):
// revert ONE rule at a time and confirm a test catches it. Server rules run test_onhand.js;
// screen rules (third field) run test_onhand_ui.js, quickly, and are skipped with no browser.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_ohand');

const FILES = ['OnHand.js', 'MealPlan.js', 'Pantry.js', 'TripIdeas.js', 'Trips.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const O = 'OnHand.js', P = 'Pantry.js', W = 'WebApp.js', A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const full = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });
const both = (from, to) => b => Object.assign(full(from, to)(b), { [L]: swap(b[L], from, to) });
const T = 'test_onhand.js', UI = 'test_onhand_ui.js';

const CONTROLS = [
  ['household things go on hand', one(O, "if (havePid[id] || haveNorm[norm] || !ohIsFood_(r[3], norm)) return;", "if (havePid[id] || haveNorm[norm]) return;")],
  ['last week\'s shopping counts', one(O, "day < weekStart || day > end) return;", "day > end) return;")],
  ['the same food twice is two chips', one(O, "if (havePid[id] || haveNorm[norm] || !ohIsFood_(r[3], norm)) return;", "if (havePid[id] || !ohIsFood_(r[3], norm)) return;")],
  ['an untick leaves its chip', one(O, "if ((x.source === 'checkout' || x.source === 'receipt') && x.pid && !bought[x.pid] && x.status === 'on hand') del.push(x.rowNum);", "")],
  ['a carry-over comes back every time', one(O, "if (x.status !== 'on hand' || havePid['CARRY:' + x.id] || haveNorm[x.norm]) return;", "if (x.status !== 'on hand') return;")],
  ['a carry-over arrives already kept', one(O, "'carried', 'CARRY:' + x.id, x.useSoon, 'pending'", "'carried', 'CARRY:' + x.id, x.useSoon, 'on hand'")],
  ['a skipped dinner uses things up', one(O, "if (!m.mealName || !m.date || m.date >= today || String(m.status).toLowerCase() === 'skipped') return;", "if (!m.mealName || !m.date || m.date >= today) return;")],
  ['tonight\'s dinner has already used things', one(O, "if (!m.mealName || !m.date || m.date >= today || String(m.status).toLowerCase() === 'skipped') return;", "if (!m.mealName || !m.date || m.date > today || String(m.status).toLowerCase() === 'skipped') return;")],
  ['made-extra leftovers aren\'t use soon', one(O, "'leftover', pid, true, 'on hand'", "'leftover', pid, false, 'on hand'")],
  ['Suggest offers days already past', one(O, "    return date >= today && !week.some(function(m) { return m.day === d && m.mealName; });", "    return !week.some(function(m) { return m.day === d && m.mealName; });")],
  ['saving picks overwrites a planned dinner', one(O, "    if (week.some(function(m) { return m.day === day && m.mealName; })) { kept.push(day); return; }\n", "")],
  ['a Skip dinner can come back', one(O, "if (open.indexOf(day) === -1 || seen[day] || !meal || skipped[meal.toLowerCase()]) return;", "if (open.indexOf(day) === -1 || seen[day] || !meal) return;")],
  ['a pick can use what isn\'t on hand', one(O, ".map(function(u) { return names[String(u).toLowerCase()]; }).filter(Boolean);", ".map(function(u) { return String(u); }).filter(Boolean);")],
  ['a busy evening is only one starting after 5:30', one(O, "if (en >= 17 * 60 + 30 && s < 20 * 60 + 30)", "if (s >= 17 * 60 + 30 && s < 20 * 60 + 30)")],
  ['salt and pepper count as missing', one(O, ".filter(function(x) { return x && !MP_STAPLES_.test(x); });", ".filter(function(x) { return x; });")],
  ['the use-soon nudge runs every day', one(O, "if (['Wed', 'Thu', 'Fri', 'Sat'].indexOf(dow) !== -1) {", "if (true) {")],
  ['prep is flagged for tomorrow, too late to thaw', one(O, "  var target = ohAddDays_(tomorrow, 1);\n", "  var target = tomorrow;\n")],
  ['a check-off carries no aisle', one(P, "category: pantryAisle_(raw), store: store }], 'checkout')", "category: 'Other', store: store }], 'checkout')")],
  ['the planner\'s read leaves on hand out', one(W, "  try { weeks[0].onHand = ohWeek_(weeks[0].weekStart); } catch (err) { res.onHandError = err.message; }\n", "")],
  // the screens
  ['coverage ignores the dinners', both("function mpCoverage_(days){var out={};", "function mpCoverage_(days){return {};var out={};"), UI],
  ['adding forgets use soon', both("useSoon:soon?'true':'false'", "useSoon:'false'"), UI],
  ['a carry-over shows as on hand', both("var live=items.filter(function(x){return x.status==='on hand';}),pending=", "var live=items.filter(function(x){return x.status!=='removed';}),pending="), UI],
  ['Suggest saves the picks you untick', both("var kept=res?res.days.filter(function(d){return !off[d.day];}):[];", "var kept=res?res.days:[];"), UI],
  ['still to buy goes to the first store', both("return props.call('shopping_add',{tabId:pick,text:t});", "return props.call('shopping_add',{tabId:stores[0].id,text:t});"), UI],
  ['Plan it forgets what the dinner uses', both(".then(function(){return ids.length?props.call('meal_extras',{weekStart:props.weekStart,day:day,uses:ids.join(',')}):null;})", ".then(function(){return null;})"), UI],
  ['the planner shows no on hand', full("wi===0&&React.createElement(MpOnHand,", "false&&React.createElement(MpOnHand,"), UI],
  ['a dinner shows no uses', full("!isEditing&&!isEmpty&&React.createElement(MpDayHand,", "false&&React.createElement(MpDayHand,"), UI],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[1](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });
  const test = c[2] || T;
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }, c[2] ? { ONHAND_QUICK: '1' } : {}) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
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
