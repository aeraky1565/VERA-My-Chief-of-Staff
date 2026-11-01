// Negative controls for Family Planning: break ONE rule at a time and confirm
// test_familyplanning.js (server) or test_familyplanning_ui.js (both dashboards)
// catches it. Dashboard mutations change app.js and dashboard-lite.html alike,
// so the copies still match and the lite page is what has to notice.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_fp');

const FP = 'FamilyPlanning.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const FILES = [FP, 'Code.js', 'WebApp.js', 'MyTrips.js', A, L, 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const both = (b, from, to) => ({ [A]: swap(b[A], from, to), [L]: swap(b[L], from, to) });
const SRV = 'test_familyplanning.js', UI = 'test_familyplanning_ui.js';

const CONTROLS = [
  [SRV, 'pregnancy weeks count from the wrong end', b => ({ [FP]: swap(b[FP], "return fpAddDays_(birth, -(40 - Number(m[1])) * 7);", "return fpAddDays_(birth, -Number(m[1]) * 7);") })],
  [SRV, 'day 8 of leave counts from the birth, not the leave', b => ({ [FP]: swap(b[FP], "return fpAddDays_(fpLeaveStart_(blocks, '', birth), Number(m[1]) - 1);", "return fpAddDays_(birth, Number(m[1]) - 1);") })],
  [SRV, 'the "what if" date is ignored', b => ({ [FP]: swap(b[FP], "return (s && (s.dueDate || s.whatIf)) || '';", "return (s && s.dueDate) || '';") })],
  [SRV, 'an unknown pay rate counts as zero', b => ({ [FP]: swap(b[FP], "return p.parentalPay === '' || p.parentalPay == null ? null : Number(p.parentalPay);", "return Number(p.parentalPay) || 0;") })],
  [SRV, 'a gap does not end the time at home', b => ({ [FP]: swap(b[FP], "  while (w < 104 && FP_PARENTS_.some(function(p) { return fpOnLeave_(blocks, p, w + 1); })) w++;", "  (blocks || []).forEach(function(b) { w = Math.max(w, b.startWeek + b.weeks - 1); });") })],
  [SRV, 'more parental weeks than the policy is fine', b => ({ [FP]: swap(b[FP], "    if (used > allowed) out.push", "    if (false) out.push") })],
  [SRV, 'the smallest block is not checked', b => ({ [FP]: swap(b[FP], "var small = par.filter(function(b) { return b.weeks < Number(p.minBlockWeeks); });", "var small = [];") })],
  [SRV, 'PTO before parental leave is fine', b => ({ [FP]: swap(b[FP], "if (mine.some(function(b) { return b.kind === 'pto' && b.startWeek < firstPar; }))", "if (false)") })],
  [SRV, 'FMLA ignores the start date', b => ({ [FP]: swap(b[FP], "else if (months < 12) out.push", "else if (false) out.push") })],
  [SRV, 'a re-read overwrites a typed value', b => ({ [FP]: swap(b[FP], "if (cur && cur.source === 'typed') {", "if (false) {") })],
  [SRV, 'a done item still flags', b => ({ [FP]: swap(b[FP], "    if (i.status === 'done') return;\n    var d = fpItemDate_(i, s, blocks);", "    var d = fpItemDate_(i, s, blocks);") })],
  [SRV, 'a reminder never says who it is for', b => ({ [FP]: swap(b[FP], " + (who !== 'Both' ? ' (for ' + who + ')' : '')", "") })],
  [SRV, 'the checklist is written on every read', b => ({ [FP]: swap(b[FP], "  if (sheet.getLastRow() >= 2) return 0;\n", "") })],
  [SRV, 'an edit forgets who made it', b => ({ [FP]: swap(b[FP], "function fpWho_(v) { return fpOneOf_(v, FP_PARENTS_, 'Ahmed'); }", "function fpWho_(v) { return 'Ahmed'; }") })],
  [SRV, 'gear goes to Planned Purchases twice', b => ({ [FP]: swap(b[FP], "  if (item.ppId) return { ok: false, error: 'Already in Planned Purchases' };\n", "") })],
  [SRV, 'leave blocks never reach the My Trips strip', b => ({ [FP]: swap(b[FP], "  if (!birth) return [];\n  return fpReadBlocks_()", "  if (birth) return [];\n  return fpReadBlocks_()") })],
  [SRV, 'an employer is named in the code', b => ({ [FP]: swap(b[FP], "var FP_PARENTS_ = ['Ahmed', 'Victoria'];", "var FP_PARENTS_ = ['Ahmed', 'Victoria']; // e.g. Verizon") })],
  [UI, 'lite edits as Ahmed', b => ({ [L]: swap(b[L], 'who="Victoria" />', 'who="Ahmed" />') })],
  [UI, 'the policy card sends every field, not just the changes', b => both(b, "var o={};changed.forEach(function(k){o[k]=f[k];});props.onSave(p,o);", "props.onSave(p,Object.assign({},f));")],
  [UI, '"Use" on a conflict keeps the typed value', b => both(b, "props.onResolve(props.conflicts.parent,c.field,c.read);", "props.onResolve(props.conflicts.parent,c.field);")],
  [UI, 'staggered leave puts it all at the birth', b => both(b, "if(split==='together'||opar<=min||w===1)", "if(true)")],
  [UI, '"Not yet" keeps the due date', b => both(b, "if(o.dated)o.whatIf='';else o.dueDate='';", "if(o.dated)o.whatIf='';")],
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
