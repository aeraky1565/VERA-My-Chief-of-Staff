// Negative controls for Planned Purchases: break ONE rule at a time and confirm
// test_plannedpurchases.js (server) or test_plannedpurchases_ui.js (both dashboards)
// catches it. Dashboard mutations change app.js and dashboard-lite.html alike,
// so the copies still match and the lite page is what has to notice.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_pp');

const PP = 'PlannedPurchases.js', HF = 'HomeFront.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const FILES = [PP, HF, 'Code.js', 'WebApp.js', A, L, 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const both = (b, from, to) => ({ [A]: swap(b[A], from, to), [L]: swap(b[L], from, to) });
const SRV = 'test_plannedpurchases.js', UI = 'test_plannedpurchases_ui.js';

const CONTROLS = [
  [SRV, 'a deal-breaker ticked yes is not a fail', b => ({ [PP]: swap(b[PP], " + p.no.filter(function(r) { return c[r] === 'yes'; }).length;", ";") })],
  [SRV, 'unticked counts as a pass', b => ({ [PP]: swap(b[PP], "ok: !fails && !unknown, label", "ok: !fails, label") })],
  [SRV, 'a ruled-out option can be the best', b => ({ [PP]: swap(b[PP], "var live = (options || []).filter(function(o) { return !o.ruledOut; })", "var live = (options || [])") })],
  [SRV, 'the best is the cheapest, not the best fit', b => ({ [PP]: swap(b[PP], "return b.s.niceMet - a.s.niceMet || (a.price", "return (a.price") })],
  [SRV, 'a new price replaces the old one', b => ({ [PP]: swap(b[PP], "prices.push({ price: price, seen: ppYmd_(raw.seen) });", "prices = [{ price: price, seen: ppYmd_(raw.seen) }];") })],
  [SRV, 'set aside ignores the goal', b => ({ [PP]: swap(b[PP], "set = goal ? Math.max(0, Number(goal.currentAmount) || 0) : 0;", "set = 0;") })],
  [SRV, 'a goal shared by two purchases counts twice', b => ({ [PP]: swap(b[PP], "if (p.goalId && !seen[p.goalId] && goalsById[p.goalId])", "if (p.goalId && goalsById[p.goalId])") })],
  [SRV, 'a partial save wipes the other fields', b => ({ [PP]: swap(b[PP], "    var merged = Object.assign({}, stored);\n    Object.keys(raw)", "    var merged = {};\n    Object.keys(raw)") })],
  [SRV, 'bought leaves the goal alone', b => ({ [PP]: swap(b[PP], "  if (goal) out.goal = {", "  if (false) out.goal = {") })],
  [SRV, 'the warranty is counted from the order, not delivery', b => ({ [PP]: swap(b[PP], "  var purchase = b.deliveryTo || b.deliveryFrom || b.orderedOn;", "  var purchase = b.orderedOn;") })],
  [SRV, 'it can be marked bought twice', b => ({ [PP]: swap(b[PP], "  if (p.stage === 'bought' && p.bought) return { ok: false, error: 'Already marked as bought' };\n", "") })],
  [SRV, 'Resell adds the old item again and again', b => ({ [PP]: swap(b[PP], "if (plan === 'resell' && p.oldPlan !== 'resell') {", "if (plan === 'resell') {") })],
  [SRV, 'a closed card is suggested', b => ({ [PP]: swap(b[PP], "if (c && c.name && c.active !== false) active[c.name] = 1;", "if (c && c.name) active[c.name] = 1;") })],
  [SRV, 'no flag the day before a delivery', b => ({ [PP]: swap(b[PP], "(b.deliveryFrom === tomorrow || b.deliveryFrom === today)", "(b.deliveryFrom === today)") })],
  [SRV, 'Coming up never reads purchases', b => ({ [HF]: swap(b[HF], "  (src.purchases || []).forEach(function(x) { if (x && x.label && x.date) out.push(x); });\n", "") })],
  [UI, 'a deal-breaker cell is not inverted', b => both(b, "var good=kind==='no'?v==='no':v==='yes',bad=kind==='no'?v==='yes':v==='no';", "var good=v==='yes',bad=v==='no';")],
  [UI, 'the bought form ignores the suggested card', b => both(b, "card:props.suggested?props.suggested.card:'',", "card:'',")],
  [UI, 'a pasted link is saved as text', b => both(b, "link=/^https?:\\/\\/\\S+$/i.test(t)?t:'';", "link='';")],
  [UI, 'the new-goal choice is lost', b => both(b, "f.goal==='__new');}}", "false);}}")],
  [UI, 'the cycle skips "no"', b => both(b, "c[r]=v==='yes'?'no':v==='no'?'':'yes';", "c[r]=v==='yes'?'':'yes';")],
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
