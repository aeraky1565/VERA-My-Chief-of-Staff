// Negative controls for Finances › Summary (FinSummary.js and the FinSummary block, issue #224):
// break ONE rule at a time and confirm a test catches it. Server rules run test_finsummary.js;
// dashboard rules run test_finsummary_ui.js.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_finsummary_out');
const FILES = ['FinSummary.js', 'Budget.js', 'BillSchedule.js', 'WebApp.js', 'Code.js', 'TripIdeas.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const F = 'FinSummary.js', A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const srv = (from, to) => b => ({ [F]: swap(b[F], from, to) });
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const TEST = 'test_finsummary.js', UI = 'test_finsummary_ui.js';
const CONTROLS = [
  ['the cash low’s floor isn’t read from its note', srv("var f = note.match(/floor is \\$?([\\d,]+)/i); if (f) out.floor = fsNum_(f[1]);", "")],
  ['a paid bill still needs attention', srv("if (!b.dueDay || b.paid || b.income) return;", "if (!b.dueDay || b.income) return;")],
  ['expected spending counts as over budget', srv("take('spend', function(s) { if (s.source !== 'actual') return;", "take('spend', function(s) {")],
  ['one failing source empties the list', srv("if (s.error) { unavailable.push(name); return; }", "if (s.error) { throw new Error(s.error); }")],
  ['Needs attention isn’t soonest first', srv("items.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : order.indexOf(a.kind) - order.indexOf(b.kind); });", "")],
  ['one month over counts as a pattern', srv("if (over[n].length >= 2) add(", "if (over[n].length >= 1) add(")],
  ['a CD a year off is suggested', srv("if (n >= 0 && n <= 90) add('cd:'", "if (n >= 0) add('cd:'")],
  ['a done decision counts as overdue', srv("if (d.status === 'open' && d.due &&", "if (d.due &&")],
  ['a scenario from last quarter is suggested', srv("if (s.quarter !== q || !s.results) return;", "if (!s.results) return;")],
  ['the snapshot is taken every run', srv("    if (have) return { taken: false, quarter: S.quarter };\n", "")],
  ['expected spending is labelled actual', srv("return { source: has ? 'actual' : 'expected',", "return { source: 'actual',")],
  ['an old open decision isn’t carried forward', srv("(d.status === 'open' && d.quarter < quarter)", "false")],
  ['the check-in reminder comes the day before', srv("if (next.days === n) {", "if (next.days === 1) {")],
  ['a decision reminder goes to no one in particular', srv("message: '✅ ' + (d.owner || 'Both') + ': “'", "message: '✅ “'")],
  ['Details shows the whole old page', b => ({ [A]: swap(b[A], "transferCard:React.createElement(FinanceSummaryTab,{part:'transfer',", "transferCard:React.createElement(FinanceSummaryTab,{"), [I]: swap(b[I], "transferCard:React.createElement(FinanceSummaryTab,{part:'transfer',", "transferCard:React.createElement(FinanceSummaryTab,{") }), UI],
  ['the transfer line isn’t from the Budget', both("return p.name+' → AMEX Checking '+fsuMoney_(p.checking)+', Savings '+fsuMoney_(p.savings);", "return p.name;"), UI],
  ['expected spending isn’t labelled', both("'expected · nothing uploaded yet'", "'this month'"), UI],
  ['a topic’s decision isn’t linked to it', both("topic:form.topic},function(r){", "topic:''},function(r){"), UI],
  ['ticking doesn’t save', both("var toggle=function(x){post({action:'checkin_decision_toggle',id:x.id}", "var toggle=function(x){post({action:'noop',id:x.id}"), UI],
];
const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
let allBit = true;
CONTROLS.forEach(function(c) {
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + c[0] + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + c[0] + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const test = c[2] || TEST;
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }, c[2] ? { FSU_QUICK: '1' } : {}) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  console.log('\n=== CONTROL: ' + c[0] + '  (' + test + ')');
  if (r.status !== 0 && !fails.length) { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:'); fails.slice(0, 3).forEach(f => console.log('    - ' + f));
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
