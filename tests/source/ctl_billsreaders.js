// Negative controls for the bills readers' switch to the tracker and Bill Schedule (bsBillRows_,
// issue #226): put ONE reader back on the old Bills sheet (or break one rule) at a time and confirm
// test_billsreaders.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_billsreaders_out');
const FILES = ['BillSchedule.js', 'Budget.js', 'WebApp.js', 'Reminders.js', 'Code.js', 'Claude.js', 'Chat.js', 'Memory.js', 'Finance.js', 'TripIdeas.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const in_ = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const TEST = 'test_billsreaders.js';
const CONTROLS = [
  ['the bills route reads the old sheet', in_('WebApp.js', "var fresh = (typeof bsBillRows_ === 'function' && bsBillRows_(monN));", "var fresh = null;")],
  ['paid by name is ignored', in_('WebApp.js', "if (lineP && typeof bsSetPaid_ === 'function') {", "if (false) {")],
  ['Cashflow reads the old sheet', in_('WebApp.js', "var billsData = (typeof bsBillRows_ === 'function' && bsBillRows_(month)) || [];", "var billsData = [];")],
  ['calendar bills take paid from the old sheet', in_('WebApp.js', "var freshC = (typeof bsBillRows_ === 'function' && bsBillRows_(monC));", "var freshC = null;")],
  ['a calendar toggle writes the old sheet', in_('WebApp.js', "if (typeof bsBillRows_ === 'function' && bsBillRows_(monCal)) return", "if (false) return")],
  ['the nudge reads the old sheet', in_('Reminders.js', "var data = (typeof bsBillRows_ === 'function' && bsBillRows_(currMonth));", "var data = null;")],
  ['the morning email reads the old sheet', in_('Code.js', "var billsData = (typeof bsBillRows_ === 'function' && bsBillRows_(currMonth));", "var billsData = null;")],
  ['Claude’s context reads the old sheet', in_('Claude.js', "var billsData = (typeof bsBillRows_ === 'function' && bsBillRows_(currMonth));", "var billsData = null;")],
  ['Chat’s context reads the old sheet', in_('Chat.js', "var freshB = (typeof bsBillRows_ === 'function' && bsBillRows_(monCtx));", "var freshB = null;")],
  ['the snapshot counts “yes” as paid', in_('Memory.js', "if (String(r[6] || '').trim() !== monS) unpaidCount++;", "if (String(r[6] || '').toLowerCase() !== 'yes') unpaidCount++;")],
  ['the Income rows are dropped', in_('BillSchedule.js', "if (!bsText_(r[0]) || !/income/i.test(bsText_(r[8]))) return;", "return;")],
  ['any month counts as paid', in_('BillSchedule.js', "return x && x.paid === month ? month : '';", "return x && x.paid ? month : '';")],
  ['calendar rows are listed as bills', in_('BillSchedule.js', "if (s.kind !== 'bill' || trackerNames[k]) return;", "if (trackerNames[k]) return;")],
  ['a tracker line can be deleted from VERA', in_('BillSchedule.js', "  if (plan.computed.shared.lines.some(function(x) { return x.name.toLowerCase() === low; })) return { ok: false, error: line + ' comes from the budget tracker; remove the line there.' };\n", "")],
  ['the fallback is gone', in_('WebApp.js', "  if (fresh) {\n    return { ok: true, currentMonth: monN, source: 'tracker',", "  if (true) {\n    return { ok: true, currentMonth: monN, source: 'tracker',")],
];
let allBit = true;
CONTROLS.forEach(function(c) {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + c[0] + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  fs.mkdirSync(path.join(OUT, 'tests', 'source'), { recursive: true });
  const r = cp.spawnSync('node', [TEST], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  console.log('\n=== CONTROL: ' + c[0]);
  if (r.status !== 0 && !fails.length) { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:'); fails.slice(0, 3).forEach(f => console.log('    - ' + f));
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
