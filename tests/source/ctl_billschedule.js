// Negative controls for Finances › Bills & cashflow (BillSchedule.js and the BillsCashflowTab block,
// issue #226 stage B): revert ONE rule at a time and confirm a test catches it. Server rules run
// test_billschedule.js; dashboard rules run test_billscash_ui.js.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_billschedule_out');

const FILES = ['BillSchedule.js', 'Budget.js', 'Code.js', 'TripIdeas.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const S = 'BillSchedule.js', B = 'Budget.js', W = 'WebApp.js', A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
// The engine lives in Budget.js and both dashboards; the full page is served from index.html.
const engine = (from, to) => b => ({ [B]: swap(b[B], from, to), [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const TEST = 'test_billschedule.js', UI = 'test_billscash_ui.js';
const srv = (from, to) => b => ({ [S]: swap(b[S], from, to) });

const CONTROLS = [
  ['budget lines show as bills', srv("    if (x.category === 'Household') { budgetLines.push(x.name); return; }\n", "")],
  ['a credit stays a line of its own', srv("    var into = bills.filter(function(b) { return bsStem_(b.line) === bsStem_(c.name); })[0];", "    var into = null;")],
  ['a set due day doesn’t win', srv("var due = s.dueDay || x.dueDay || null;", "var due = x.dueDay || s.dueDay || null;")],
  ['card payments count as bills', srv("    if (s.kind === 'card payment') return;\n", "")],
  ['every bill goes on the Joint timeline', srv("var joint = list.bills.filter(function(b) { return /joint/i.test(b.account); });", "var joint = list.bills;")],
  ['the transfer day is ignored', srv("var tday = bsDay_(opts.transferDay) || 1,", "var tday = 1,")],
  ['a window’s need leaves out later bills', srv("return b.dueDay && b.dueDay >= from; })", "return bsWindow_(b.dueDay) === w; })")],
  ['reconcile compares one month, not three', srv("var rows = bsMatchLines_(lines, inQ, aliasMap, 3);", "var rows = bsMatchLines_(lines, inQ, aliasMap, 1);")],
  ['a transaction counts toward two lines', srv("    hits.forEach(function(t) { used[t._i] = true; });\n", "")],
  ['card payments count as spending', srv("&& t.amount < 0 && !bsIsCardPayment_(t, cardNames); });", "&& t.amount < 0; });")],
  ['Config aliases are ignored', srv("|| aliases.some(function(a) { return d.indexOf(a) !== -1; });", ";")],
  ['a line with no uploads reads as $0', srv("    if (!hits.length) return { id: L.id || L.line, line: L.line, kind: L.kind, plan: plan, actual: null, diff: null, flag: 'not in uploads', count: 0 };\n", "")],
  ['the migration brings income over', srv("if (/income/i.test(type)) { out.skipped.push(bill); return; }", "")],
  ['the migration adds a line twice', srv("    if (seen[key] || existing[key]) return;\n", "")],
  ['an unmatched bill is migrated anyway', srv("    if (!line && !isCard) { out.unmatched.push({ bill: bill, amount: r[1] === '' ? null : Number(r[1]), why: 'no tracker line by that name' }); return; }\n", "")],
  ['save adds a row instead of updating', srv("    if (at === -1) sheet.appendRow(row); else sheet.getRange(at, 1, 1, BS_HEADERS_.length).setValues([row]);", "    sheet.appendRow(row);")],
  ['a due day of 40 is kept', srv("function bsDay_(v) { var n = Number(v); return n >= 1 && n <= 31 &&", "function bsDay_(v) { var n = Number(v); return n >= 1 &&")],
  ['a person’s lines take everyone’s uploads', srv("if (L.owner && t.owner !== L.owner) return false; ", "")],
  ['actuals aren’t a monthly average', srv("actual: r.actual == null ? null : Math.round(r.actual / Math.max(1, months.length) * 100) / 100", "actual: r.actual")],
  ['the reconcile route is missing', b => ({ [W]: swap(b[W], "      case 'bills_reconcile':", "      case 'bills_reconcile_old':") })],
  ['the list doesn’t fold in the credit', both("b.credit?'net of the '+bsMoneyC_(b.credit)+' credit':''", "''"), UI],
  ['editing sends nothing for autopay', both("autopay:e.autopay,cardLink:e.cardLink||''", "autopay:false,cardLink:e.cardLink||''"), UI],
  ['Reconcile’s previous quarter goes forward', both("var n=bsQuarterShift_(q,-1);", "var n=bsQuarterShift_(q,1);"), UI],
  ['Bills and Cashflow stay apart in the full dashboard', b => ({ [A]: swap(b[A], "{id:'billscash',label:'🧾 Bills & cashflow'},", "{id:'bills',label:'🧾 Bills'},{id:'cashflow',label:'💰 Cashflow'},"), [I]: swap(b[I], "{id:'billscash',label:'🧾 Bills & cashflow'},", "{id:'bills',label:'🧾 Bills'},{id:'cashflow',label:'💰 Cashflow'},") }), UI],
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
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }, c[2] ? { BS_QUICK: '1' } : {}) });
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
