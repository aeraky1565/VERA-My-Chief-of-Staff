// Negative controls for #247: revert ONE rule at a time and confirm
// test_agenthealth.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_agenthealth');
const FILES = ['AgentHealth.js', 'Code.js', 'WebApp.js', 'Career.js', 'docs/app.js', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const A = 'AgentHealth.js', APP = 'docs/app.js';
const CONTROLS = [
  ['weekdays include the weekend', b => ({ [A]: swap(b[A], "else if (w === 'weekdays') days = [1, 2, 3, 4, 5];", "else if (w === 'weekdays') days = [0, 1, 2, 3, 4, 5, 6];") })],
  ['eod ignored', b => ({ [A]: swap(b[A], "var due = sched.eod ? ", "var due = false ? ") })],
  ['no grace after the scheduled time', b => ({ [A]: swap(b[A], ": at + AGENT_GRACE_HOURS_ * 3600000;", ": at;") })],
  ['a run later today counts as started', b => ({ [A]: swap(b[A], "    if (at > nowMs) continue;\n", "") })],
  ['the zone ignored', b => ({ [A]: swap(b[A], "    var at = guess - offsetFn(guess) * 60000;", "    var at = guess;") })],
  ['Notes errors never make a run Partial', b => ({ [A]: swap(b[A], "? 'Partial' : 'OK') : (agentStatusWord_", "? 'OK' : 'OK') : (agentStatusWord_") })],
  ['oldest first', b => ({ [A]: swap(b[A], "return x < y ? 1 : x > y ? -1 : 0; });\n  return runs;", "return x < y ? -1 : x > y ? 1 : 0; });\n  return runs;") })],
  ['date-only rows a day late never count', b => ({ [A]: swap(b[A], "    return n && n.date ? n : null;", "    return null;") })],
  ['a failed run is OK', b => ({ [A]: swap(b[A], "  if (latest.status === 'Failed') return", "  if (false) return") })],
  ['a missed run is OK', b => ({ [A]: swap(b[A], "  if (firstDue !== -1 && strip[firstDue] === 'missing') {", "  if (false) {") })],
  ['partial shown as ok', b => ({ [A]: swap(b[A], ": r.status === 'Partial' ? 'partial' : 'ok';", ": 'ok';") })],
  ['nothing logged counts as OK', b => ({ [A]: swap(b[A], "  if (!latest) return Object.assign(base, { level: 'none', text: 'Nothing logged yet' });", "  if (!latest) return Object.assign(base, { level: 'ok', text: 'Nothing logged yet' });") })],
  ['every agent flagged', b => ({ [A]: swap(b[A], "    if (!a.flaggable) return;\n", "") })],
  ['nothing logged yet flagged', b => ({ [A]: swap(b[A], "(a.level === 'none' && !a.cantOpen)) return;", "false) return;") })],
  ['the first night posts everything', b => ({ [A]: swap(b[A], "    if (!was || was === a.level) return;", "    if (was === a.level) return;") })],
  ['VERA posted twice', b => ({ [A]: swap(b[A], "    if (a.name === 'PIES' || a.name === 'VERA') return;", "    if (a.name === 'PIES') return;") })],
  ['HAILEY’s failed status ignored', b => ({ [A]: swap(b[A], "    if (/\\b(fail|failed|failure)\\b/i.test(st) && sweep.level !== 'late') {", "    if (false) {") })],
  ['HAILEY’s digest ignored', b => ({ [A]: swap(b[A], "    var dv = agentTab_(sweep.ss, 'Weekly Digest');", "    var dv = null;") })],
  ['TESS flagged twice before its Run Log', b => ({ [A]: swap(b[A], "        tess.flaggable = false;   // carCheckAgentHealth_ flags this case, as before\n", "") })],
  ['a sheet VERA can’t open not marked', b => ({ [A]: swap(b[A], "level: 'none', cantOpen: true,", "level: 'none',") })],
  ['VERA writes to an agent’s sheet', b => ({ [A]: swap(b[A], "  if (!sh || sh.getLastRow() < 1) return null;", "  if (!sh || sh.getLastRow() < 1) return null;\n  sh.getRange(1, 1).setValue('seen by VERA');") })],
  ['not in the nightly run', b => ({ 'Code.js': swap(b['Code.js'], "    nightlyStep_(ctx, 'checkAgentHealth_', checkAgentHealth_);\n", "") })],
  ['Check again reads the cache', b => ({ 'WebApp.js': swap(b['WebApp.js'], "webAgentHealth_({ refresh: (e.parameter || {}).refresh === '1' })", "webAgentHealth_({})") })],
  ['TESS’s guess keeps flagging', b => ({ 'Career.js': swap(b['Career.js'], "  if (typeof agentTessHasRunLog_ === 'function' && agentTessHasRunLog_(sheetId)) {", "  if (false) {") })],
  ['the panel not shown', b => ({ [APP]: swap(b[APP], "cur==='agent_health'&&h(SysAgentHealth,{apiUrl:apiUrl,apiToken:apiToken}),", "") })],
  ['the roster without health', b => ({ [APP]: swap(b[APP], ",health:health});}", "});}") })],
];
let allBit = true;
CONTROLS.forEach(([name, mut]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const r = cp.spawnSync('node', ['test_agenthealth.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name);
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
