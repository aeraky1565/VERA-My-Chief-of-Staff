// Negative controls for Finances › Phone plan (PhonePlan.js, its use in Budget.js, and the
// PhonePlanCard block, issue #226): revert ONE rule at a time and confirm a test catches it.
// Server rules run test_phoneplan.js; dashboard rules run test_phoneplan_ui.js.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_phoneplan_out');

const FILES = ['PhonePlan.js', 'BillSchedule.js', 'Budget.js', 'Code.js', 'TripIdeas.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const S = 'PhonePlan.js', B = 'Budget.js', W = 'WebApp.js', A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
// The engine lives in Budget.js and both dashboards; the full page is served from index.html.
const engine = (from, to) => b => ({ [B]: swap(b[B], from, to), [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const TEST = 'test_phoneplan.js', UI = 'test_phoneplan_ui.js';
const srv = (from, to) => b => ({ [S]: swap(b[S], from, to) });

const CONTROLS = [
  ['payers are counted by person', srv("    if (/^bill \\d+\\s*-\\s*/i.test(l)) { billRows.push({ name: l.replace(/^bill \\d+\\s*-\\s*/i, ''), label: l, row: row }); continue; }\n", "")],
  ['our own payments count as money back', srv("payers: cur.bills.filter(function(b) { return !b.ours && b.amount; })", "payers: cur.bills.filter(function(b) { return b.amount; })")],
  ['the latest month is always picked', srv("var cur = months.filter(function(m) { return Number(m.month.slice(5)) === mo && m.totalFound; })[0] || ", "var cur = ")],
  ['a missing Our total isn’t worked out', srv("if (ours == null) ours = bills.length ?", "if (false) ours = bills.length ?")],
  ['the plan’s name ignores Config', srv("if (plan.ok) plan.name = name || g.title || 'Family phone plan';", "if (plan.ok) plan.name = g.title || 'Family phone plan';")],
  ['marking twice adds a second tick', srv("    for (var i = rows.length - 1; i >= 0; i--) if (ppText_(rows[i][0]) === month && ppText_(rows[i][1]).toLowerCase() === payer.toLowerCase()) sheet.deleteRow(i + 2);\n", "")],
  ['undo keeps the tick', srv("    if (!body.received) return { ok: true, receivedAt: '' };\n", "")],
  ['the Budget ignores the phone plan', b => ({ [B]: swap(b[B], "if (plan && plan.ok) bgWithPhone_(model, plan);", "") })],
  ['the share card shows the wrong month', both("var i=sel==null?Math.max(0,ms.map(function(x){return x.month;}).indexOf(p.month)):sel", "var i=sel==null?0:sel"), UI],
  ['Share image always downloads', both("if(file&&navigator.canShare&&navigator.canShare({files:[file]}))", "if(false)"), UI],
  ['Copy leaves out the payments', both("  if(m.bills.length){L.push('','What each payment is');m.bills.forEach(function(b){L.push((b.label||b.name)+'  '+ppMoney_(b.amount));});}\n", ""), UI],
  ['a tap marks the wrong month', both("{action:'phone_payback_mark',month:p.month,", "{action:'phone_payback_mark',month:'',"), UI],
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
  const test = c[2] || TEST;
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }, c[2] ? { PP_QUICK: '1' } : {}) });
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
