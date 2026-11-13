// Negative controls for grocery runs: break ONE rule at a time and confirm
// test_groceries.js (server) or test_groceries_ui.js (both dashboards) catches it.
// Dashboard mutations change app.js and dashboard-lite.html alike, so the copies
// still match and the behaviour is what has to notice.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_gr');

const G = 'Groceries.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const FILES = [G, 'Code.js', 'WebApp.js', A, L, 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
// The full dashboard runs from index.html, which carries a built copy of app.js.
const both = (b, from, to) => ({ [A]: swap(b[A], from, to), [L]: swap(b[L], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const SRV = 'test_groceries.js', UI = 'test_groceries_ui.js';

const CONTROLS = [
  [SRV, 'just the food still counts non-food lines', b => ({ [G]: swap(b[G], "    if (mode === 'food' && l.food === false) return;\n", "") })],
  [SRV, 'Recipe and Wish List show up as stores', b => ({ [G]: swap(b[G], "var GR_NOT_STORES_ = ['recipe', 'wish list', 'home supplies', 'egypt'];", "var GR_NOT_STORES_ = [];") })],
  [SRV, 'the month includes last month\'s runs', b => ({ [G]: swap(b[G], "return r.date && r.date.slice(0, 7) === ym && r.total != null; }).forEach", "return r.date && r.total != null; }).forEach") })],
  [SRV, 'last month counts the whole month, not to date', b => ({ [G]: swap(b[G], " && r.date.slice(8, 10) <= day && r.total != null; })", " && r.total != null; })") })],
  [SRV, 'a closed card is still suggested', b => ({ [G]: swap(b[G], "if (!c || !c.name || c.active === false) return false;", "if (!c || !c.name) return false;") })],
  [SRV, 'the lowest grocery rate wins', b => ({ [G]: swap(b[G], "return Number(b.rate) - Number(a.rate); });", "return Number(a.rate) - Number(b.rate); });") })],
  [SRV, 'someone else\'s card is suggested', b => ({ [G]: swap(b[G], "return !w || owner === w || owner === 'joint'", "return true || owner === w || owner === 'joint'") })],
  [SRV, 'the budget reads the wrong row', b => ({ [G]: swap(b[G], "return String(r.label || '').trim().toLowerCase() === 'groceries'; })[0];", "return true; })[0];") })],
  [SRV, 'a zero total is logged', b => ({ [G]: swap(b[G], "  if (x.total == null || x.total <= 0) return { ok: false, error: 'Enter the total' };\n", "") })],
  [SRV, 'an edit wipes the fields it did not send', b => ({ [G]: swap(b[G], "merged = Object.assign({}, stored);", "merged = {id: stored.id};") })],
  [SRV, 'switching a store off leaves it on', b => ({ [G]: swap(b[G], "if (raw[s] === true) setting[name] = true; else delete setting[name];", "if (raw[s] === true) setting[name] = true;") })],
  [SRV, 'a stale config is read after saving the stores', b => ({ 'Settings.js': swap(fs.readFileSync(path.join(SRC_DIR, 'Settings.js'), 'utf8'), "    try { _configCache_ = null; } catch (e) {}\n    try { if (typeof invalidatePTOConfigRows_", "    try { if (typeof invalidatePTOConfigRows_") })],
  [UI, 'lite logs runs as Ahmed', b => ({ [L]: swap(b[L], "grocery={{ apiUrl, apiToken, who: 'Victoria' }}", "grocery={{ apiUrl, apiToken, who: 'Ahmed' }}") })],
  [UI, 'the run total only sums the pantry picks', b => both(b, "return mode==='food'&&l.food===false?n:n+v;},0)", "return l.food===false?n:n+v;},0)")],
  [UI, 'switching who keeps the first person\'s card', b => both(b, "onClick:function(){setR({who:w,cardTouched:false});}", "onClick:function(){setR({who:w,cardTouched:true,card:grCard});}")],
  [UI, 'a store that asks counts all of it by default', b => both(b, "(run.count||(step==='review'||step==='saving'?'food':''))", "(run.count||(step==='review'||step==='saving'?'all':''))")],
  [UI, 'a food-only run is logged as all of it', b => both(b, "counted:grMode==='food'?'food':'all'", "counted:'all'")],
  [UI, 'an edited total is ignored', b => both(b, "var t=kind==='receipt'?(run.edited?run.total:String(grSum(grMode))):run.typed;", "var t=kind==='receipt'?String(grSum(grMode)):run.typed;")],
];

// The deploy gate runs where no browser is installed: dashboard controls are skipped
// there and say so; the full suite (which finds Chromium) runs them.
const HAVE_BROWSER = !!process.env.CHROMIUM_PATH;
let allBit = true;
CONTROLS.forEach(function(c) {
  const test = c[0], name = c[1];
  if (test === UI && !HAVE_BROWSER) { console.log('\n=== CONTROL: ' + name + '\n  skipped: no browser here (the full suite runs it)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[2](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true });
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', timeout: 600000,
    env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
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
