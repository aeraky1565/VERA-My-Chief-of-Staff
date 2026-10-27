// Negative controls for the USPS scan's self-healing (MailCounter.js, Watchdog.js): the hourly
// catch-up, the script lock, the start marker and the trigger repair. Revert ONE rule at a time
// and confirm test_mailcounter.js or test_watchdog.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_usps');

const FILES = ['MailCounter.js', 'Watchdog.js', 'Reminders.js', 'Code.js', 'ApiHealth.js', 'VERALog.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const M = 'MailCounter.js', W = 'Watchdog.js', R = 'Reminders.js';
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const MC = 'test_mailcounter.js', WD = 'test_watchdog.js';

const CONTROLS = [
  ['the catch-up runs even when the scan ran an hour ago', one(M, "return !lastRunMs || nowMs - lastRunMs > USPS_STALE_HOURS_ * 3600000;", "return true;"), MC],
  ['the catch-up runs before 10:00', one(M, "  if (hour < USPS_SCAN_HOUR_) return false;\n", ""), MC],
  ['hourlyCheck never calls the catch-up', one(R, "  uspsCatchUp_(new Date());\n", ""), MC],
  ['the scan runs without the lock', one(M, "    if (!lock.tryLock(30000)) { Logger.log('scanUSPSMail_: another run holds the lock, skipping.'); return; }\n", ""), MC],
  ['the scan leaves no start marker', one(M, "    props.setProperty('USPS_SCAN_START', new Date().toISOString());\n", ""), WD],
  ['the watchdog doesn\'t look for the marker', one(W, "maxAgeHours: 26, startProp: 'USPS_SCAN_START' },", "maxAgeHours: 26 },"), WD],
  ['the repair adds a trigger that already exists', one(W, "    if (have[j.job]) return;\n    var s = specs", "    var s = specs"), WD],
  ['the repair forgets the other registrations', one(W, "    var map = getTriggerRegistrations_(), now = Date.now();", "    var map = {}, now = Date.now();"), WD],
  ['the flag still blames a trigger VERA just put back', one(W, "(j.repaired\n                 ? ' Its trigger was missing, so VERA put it back; it should run at its next time.'", "(false\n                 ? ' Its trigger was missing, so VERA put it back; it should run at its next time.'"), WD],
];

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
