// Negative controls for #244: revert ONE rule at a time and confirm
// test_welcomeback.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_welcomeback');
const FILES = ['Away.js', 'Code.js', 'Pacing.js', 'Settings.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const A = 'Away.js', C = 'Code.js';
const CONTROLS = [
  ['a period still on is closed', b => ({ [A]: swap(b[A], "  if (!endHint && awayDecide_(st, today).on) return null;\n", "") })],
  ['the end is always yesterday', b => ({ [A]: swap(b[A], "(st.AWAY_MANUAL === 'on' && until && until < today ? until : awayAddDays_(today, -1))", "awayAddDays_(today, -1)") })],
  ['the end can fall before the start', b => ({ [A]: swap(b[A], "  if (end < start) end = start;\n", "") })],
  ['the period is never closed', b => ({ [A]: swap(b[A], "AWAY_STARTED: null, AWAY_HELD: null };", "};") })],
  ['an expired switch is left on', b => ({ [A]: swap(b[A], "patch.AWAY_MANUAL = null; patch.AWAY_UNTIL = null; patch.AWAY_TRIP = null;", "") })],
  ['a second period replaces the first', b => ({ [A]: swap(b[A], "  if (prev.start) {   // two periods", "  if (false) {   // two periods") })],
  ['the trip key, not its name', b => ({ [A]: swap(b[A], "  var trip = awayTripLabel_(tripHint ||", "  var trip = (tripHint ||") })],
  ['"End away mode" records nothing', b => ({ [A]: swap(b[A], "    awayCloseIfEnded_(today);   // the catch-up", "    // the catch-up") })],
  ['flags from any day', b => ({ [A]: swap(b[A], "  var raised = (flags || []).filter(function(f) { return inRange(f.date); });", "  var raised = (flags || []).slice();") })],
  ['resolved flags counted as open', b => ({ [A]: swap(b[A], "return !f.resolved && !f.acknowledged; });", "return true; });") })],
  ['flags not sorted by urgency', b => ({ [A]: swap(b[A], "return ra - rb || (", "return 0 || (") })],
  ['every flag listed', b => ({ [A]: swap(b[A], "list: open.slice(0, 5), more: Math.max(0, open.length - 5)", "list: open, more: 0") })],
  ['tasks due today count as overdue', b => ({ [A]: swap(b[A], "return inRange(d) && d < today; });", "return inRange(d); });") })],
  ['every task listed', b => ({ [A]: swap(b[A], "list: overdue.slice(0, 5), more: Math.max(0, overdue.length - 5)", "list: overdue, more: 0") })],
  ['held kinds not pluralised', b => ({ [A]: swap(b[A], "bits.push(n + ' ' + (n === 1 ? nn[0] : nn[1]));", "bits.push(n + ' ' + nn[0]);") })],
  ['mail never counts', b => ({ [A]: swap(b[A], "!total && !m.pieces && !m.packages;", "!total;") })],
  ['empty parts printed', b => ({ [A]: swap(b[A], "  if (d.tasks.count) {", "  if (true) {") })],
  ['an empty catch-up still prints', b => ({ [A]: swap(b[A], "  if (!d || d.empty) return null;", "  if (!d) return null;") })],
  ['the trip name not escaped', b => ({ [A]: swap(b[A], "(d.trip ? ' (' + awayEsc_(d.trip) + ')' : '')", "(d.trip ? ' (' + d.trip + ')' : '')") })],
  ['an empty catch-up kept for tomorrow', b => ({ [A]: swap(b[A], "    if (d.empty) { awayBackClear_(); return null; }", "    if (d.empty) return null;") })],
  ['the one sent on its own is never cleared', b => ({ [A]: swap(b[A], "  awayBackClear_();\n  Logger.log('morningNudge: welcome-back", "  Logger.log('morningNudge: welcome-back") })],
  ['the trip ending records nothing', b => ({ 'Pacing.js': swap(b['Pacing.js'], "    if (wasActiveEnd && typeof awayCloseIfEnded_ === 'function') awayCloseIfEnded_('', endedTrip);\n", "") })],
  ['the record not in the pacing state', b => ({ 'Settings.js': swap(b['Settings.js'], "'AWAY_HELD', 'AWAY_BACK'],", "'AWAY_HELD'],") })],
  ['the morning run never closes an expired switch', b => ({ [C]: swap(b[C], "    if (typeof awayCloseIfEnded_ === 'function') awayCloseIfEnded_();\n", "") })],
  ['a no-flags morning drops it', b => ({ [C]: swap(b[C], "      Logger.log('Morning nudge: no flags found, skipping email.');\n      if (typeof sendAwayBackAlone_ === 'function') sendAwayBackAlone_();   // #244\n", "      Logger.log('Morning nudge: no flags found, skipping email.');\n") })],
  ['not in the email', b => ({ [C]: swap(b[C], " + welcomeBack.html : '') +", " : '') +") })],
  ['cleared before it was sent', b => ({ [C]: swap(b[C], "    // Shown once: the catch-up is cleared only after the briefing went out (#244).\n    if (welcomeBack && typeof awayBackClear_ === 'function') awayBackClear_();\n", "").replace("    var welcomeBack = null;\n", "    var welcomeBack = null; if (typeof awayBackClear_ === 'function') awayBackClear_();\n") })],
];
let allBit = true;
CONTROLS.forEach(([name, mut]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const r = cp.spawnSync('node', ['test_welcomeback.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
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
