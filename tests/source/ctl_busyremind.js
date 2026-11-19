// Negative controls for test_busyremind.js: undo ONE rule of the work busy times or of
// "Remind me at …" and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_br');
const FILES = ['Notify.js', 'Slack.js', 'Aria.js', 'Settings.js', 'Co' + 'de.js', 'docs/app.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const T = 'test_busyremind.js';
const CONTROLS = [
  ["free time counts as busy", "Notify.js", "    else if (l === 'TRANSP:TRANSPARENT' || l === 'STATUS:CANCELLED') cur.free = true;", ""],
  ["UTC times stay UTC", "Notify.js", "  if (m[7]) return toLocal(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));", ""],
  ["repeats are ignored", "Notify.js", "        if (r.FREQ === 'DAILY') on = gap % n === 0;", "        if (false) on = gap % n === 0;"],
  ["weekly ignores BYDAY", "Notify.js", "else if (r.FREQ === 'WEEKLY') on = (r.BYDAY ? r.BYDAY.split(',').indexOf(dow) !== -1 : gap % 7 === 0)", "else if (r.FREQ === 'WEEKLY') on = (gap % 7 === 0)"],
  ["EXDATE ignored", "Notify.js", "dayIso > e.s.iso && e.ex.indexOf(dayIso) === -1 &&", "dayIso > e.s.iso &&"],
  ["movement goes during a meeting", "Notify.js", "  if (moveBusyAt_(workBusyToday_(cfg, now), minute)) {", "  if (false) {"],
  ["a slot in a meeting is spent", "Notify.js", "    try { veraStateSet_('NOTIF', { NOTIF_MOVE: JSON.stringify(mv0) }); } catch (e) {}\n    return false;\n  }", "    try { veraStateSet_('NOTIF', { NOTIF_MOVE: JSON.stringify(next) }); } catch (e) {}\n    return false;\n  }"],
  ["remind after 9 PM", "Notify.js", "  if (at > lastToday) at = lastToday;", ""],
  ["remind after the deadline", "Notify.js", "  if (endMs && at > endMs - H) at = Math.floor((endMs - H) / H) * H;", ""],
  ["the tap leaves the button", "Notify.js", "      var els = (b.elements || []).filter(function(e) { return e.action_id !== 'act_remind'; });", "      var els = b.elements || [];"],
  ["due reminders kept forever", "Notify.js", "(r.at <= nowMs ? due : keep).push(r);", "keep.push(r);"],
  ["the tick never runs", "Notify.js", "    try { actRemindTick_(now); } catch (e) { Logger.log('checkinTick_ reminders: ' + e.message); }", ""],
  ["VERA posts lose the button", "Notify.js", "      typeof actRemindButton_ === 'function' ? actRemindButton_(new Date(item.due + 'T23:59:00').getTime()) : null,\n", ""],
  ["the live handler ignores the tap", "Slack.js", "    } else if (actionId === 'act_remind') {", "    } else if (false) {"],
].map(c => [c[0], b => ({ [c[1]]: swap(b[c[1]], c[2], c[3]) }), T]);

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0], test = c[2];
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
  const env = Object.assign({}, process.env, { VERA_ROOT: OUT });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env });
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
