// Negative controls for Finances › Goals from the planner: break ONE rule at a time and
// confirm test_plannergoals.js (server) or test_plannergoals_ui.js (both dashboards)
// catches it. Dashboard mutations change app.js, index.html and dashboard-lite.html alike.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_pg');

const G = 'PlannerGoals.js', N = 'NetWorth.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html', IX = 'docs/index.html';
const FILES = [G, N, 'Trips.js', 'WebApp.js', A, L, IX, 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const both = (b, from, to) => ({ [A]: swap(b[A], from, to), [L]: swap(b[L], from, to), [IX]: swap(b[IX], from, to) });
const SRV = 'test_plannergoals.js', UI = 'test_plannergoals_ui.js';

const CONTROLS = [
  [SRV, 'a missing column is guessed past', b => ({ [G]: swap(b[G], "  if (missing.length) return nwUnavailable_('the Goals tab has no ' + missing.join(', ') + ' column');\n", "") })],
  [SRV, 'share columns are hard-coded to the first two', b => ({ [G]: swap(b[G], "h.forEach(function(x, i) { var m = pgText_(x).match(/^(.+?)\\s+share$/i); if (m) shares.push({ who: m[1], col: i }); });", "shares.push({ who: 'Ahmed', col: 7 }, { who: 'Victoria', col: 8 });") })],
  [SRV, 'the house target leaves out closing costs', b => ({ [G]: swap(b[G], "down: Math.round(price * pct / 100 + extra) };", "down: Math.round(price * pct / 100) };") })],
  [SRV, 'a house plan switched off still sets the target', b => ({ [G]: swap(b[G], "  if ('house.on' in settings && !nwBool_(settings['house.on'])) return null;\n", "") })],
  [SRV, 'a one-off over target is "reached", not ready', b => ({ [G]: swap(b[G], "x.state = g.kind === 'one-off' ? 'ready' : 'reached';", "x.state = 'reached';") })],
  [SRV, 'a yearly budget counts every plan item', b => ({ [G]: swap(b[G], "  return /travel|trip/i.test(goal.name) && nwNorm_(item.category) === 'trip';", "  return true;") })],
  [SRV, 'a trip assigned to another goal still counts', b => ({ [G]: swap(b[G], "  if (item.goal) return nwNorm_(item.goal) === nwNorm_(goal.name);\n", "") })],
  [SRV, 'the next trip can be one already past', b => ({ [G]: swap(b[G], "var next = items.filter(function(p) { return !p.past; })[0] || null;", "var next = items[0] || null;") })],
  [SRV, 'paused goals count as still to go', b => ({ [G]: swap(b[G], "var toGo = list.filter(function(g) { return g.state === 'active'; })", "var toGo = list.filter(function(g) { return g.state !== 'reached' && g.state !== 'ready'; })") })],
  [SRV, 'who calculated leaks into the payload', b => ({ [G]: swap(b[G], "var m = a.match(/^Calculated\\s+([A-Z][a-z]{2}\\s+\\d{1,2},\\s+\\d{4})/);", "var m = a.match(/^Calculated\\s+(.*)/);") })],
  [SRV, 'the plan parser drops the Goal column', b => ({ [N]: swap(b[N], "      goal:       goalCol === -1 ? '' : String(grid[r][goalCol] == null ? '' : grid[r][goalCol]).trim(),\n", "") })],
  [UI, 'lite keeps the old goals tab', b => ({ [L]: swap(b[L], "<PlannerGoalsTab     apiUrl={apiUrl} apiToken={apiToken} />", "<FinGoalsLiteTab     apiUrl={apiUrl} apiToken={apiToken} />") })],
  [UI, 'shares lose "of target"', b => both(b, "x.who + '’s share' + (i === 0 ? ' of target' : '')", "x.who")],
  [UI, 'the year switch does nothing', b => both(b, "var n = Object.assign({}, yearPick); n[g.name] = x.year; setYearPick(n);", "")],
  [UI, 'over budget reads as left', b => both(b, "(y.left >= 0 ? pgMoney(y.left) + ' left' : pgMoney(-y.left) + ' over')", "pgMoney(Math.abs(y.left)) + ' left'")],
  [UI, 'unavailable shows an empty tab', b => both(b, "  if (d.status !== 'ok') return h('div', { className: 'pg-tab pg-unavailable', style: box }, 'Goals are unavailable: ' + d.reason + '.');\n", "")],
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
