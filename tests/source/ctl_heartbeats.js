// Negative controls for the every-return-path invariant.
//
// This check's whole value is that it bites, so each control reintroduces one way a
// job can stop recording. The first is the morningNudge bug verbatim; the rest put it
// back in each of the other seven jobs, because an invariant derived from the registry
// should hold for all of them and not just the one it was written for.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_hb');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

// Put an early `return` before the try that records — the bug, in any job.
function escapeReturn(src, fnName) {
  const at = src.indexOf('function ' + fnName + '(');
  if (at === -1) throw new Error('no ' + fnName);
  const brace = src.indexOf('{', at);
  return src.slice(0, brace + 1) +
         '\n  if (Math.random() < 0) return;   // control: escapes the heartbeat\n' +
         src.slice(brace + 1);
}

const CONTROLS = {
  // The bug itself, in the job it actually happened to.
  'morningNudge returns before the recording try again (the real bug)': b => ({
    'Code.js': escapeReturn(b['Code.js'], 'morningNudge'),
  }),

  // The same mistake in every other tracked job.
  'nightlyRun gains an escaping return':      b => ({ 'Code.js': escapeReturn(b['Code.js'], 'nightlyRun') }),
  'nightlyRunTail gains an escaping return':  b => ({ 'Code.js': escapeReturn(b['Code.js'], 'nightlyRunTail') }),
  'hourlyCheck gains an escaping return':     b => ({ 'Reminders.js': escapeReturn(b['Reminders.js'], 'hourlyCheck') }),
  'checkFlightStatuses_ gains one':           b => ({ 'FlightStatus.js': escapeReturn(b['FlightStatus.js'], 'checkFlightStatuses_') }),
  'runEmailScan_ gains one':                  b => ({ 'EmailParser.js': escapeReturn(b['EmailParser.js'], 'runEmailScan_') }),
  'scanUSPSMail_ gains one':                  b => ({ 'MailCounter.js': escapeReturn(b['MailCounter.js'], 'scanUSPSMail_') }),
  'scanHoaWebsite_ gains one':                b => ({ 'NeighborhoodWatcher.js': escapeReturn(b['NeighborhoodWatcher.js'], 'scanHoaWebsite_') }),

  // Recorded on the happy path instead of in a finally: a thrown run records nothing.
  'the nightly heartbeat moves out of the finally': b => ({
    'Code.js': b['Code.js']
      .replace("    try { recordHeartbeat_('nightlyRun'); } catch (hbErr) {}\n", '')
      .replace("    Logger.log('=== VERA nightly run complete: ' + new Date() + ' ===');",
               "    try { recordHeartbeat_('nightlyRun'); } catch (hbErr) {}\n" +
               "    Logger.log('=== VERA nightly run complete: ' + new Date() + ' ===');"),
  }),
  'the morning heartbeat moves out of the finally': b => ({
    'Code.js': b['Code.js']
      .replace("    try { recordHeartbeat_('morningNudge'); } catch (hbErr) {}\n", '')
      .replace("    try { recordHeartbeat_('delivery:morning_briefing'); } catch (hbErr) {}",
               "    try { recordHeartbeat_('morningNudge'); } catch (hbErr) {}\n" +
               "    try { recordHeartbeat_('delivery:morning_briefing'); } catch (hbErr) {}"),
  }),
  'a job stops recording altogether': b => ({
    'MailCounter.js': b['MailCounter.js'].replace(
      "try { recordHeartbeat_('scanUSPSMail_'); } catch (hbErr) {}", ''),
  }),

  // A job added to the registry with no entry point at all.
  'a registry job has no function behind it': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      "  { job: 'morningNudge',",
      "  { job: 'inventedJob_',         label: 'Invented',             maxAgeHours: 26 },\n" +
      "  { job: 'morningNudge',"),
  }),

  // The walker's own guarantees. If these stop holding, the check above is a lie.
  'the walker descends into nested functions (a closure return counts)': b => ({
    // Remove the nested-function guard so a closure's return is attributed to the
    // enclosing job. nightlyRun hands ~40 closures to nightlyStep_.
    'tests/source/test_heartbeats.js': null,   // placeholder, replaced below
  }),
};

// The walker control patches the TEST, not the source, so it is applied separately.
const TEST_FILE = 'test_heartbeats.js';
const TEST_BASE = fs.readFileSync(path.join(__dirname, TEST_FILE), 'utf8');
delete CONTROLS['the walker descends into nested functions (a closure return counts)'];
const TEST_CONTROLS = {
  'the walker descends into nested functions (closure returns get blamed)': t =>
    t.replace('    if (!isRoot && FN_TYPES.indexOf(n.type) !== -1) return;   // a nested function\'s',
              '    if (false) return;'),
  'the walker ignores where the return sits relative to the try': t =>
    t.replace('    if (n.start >= recordingTry.start && n.end <= recordingTry.end) return;',
              '    if (false) return;'),
};

let allBit = true;

function run(sourcePatch, testPatch, name) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const files = Object.assign({}, BASE, sourcePatch || {});
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  let testPath = TEST_FILE;
  if (testPatch) {
    const patched = testPatch(TEST_BASE);
    if (patched === TEST_BASE) {
      console.log('\n=== CONTROL: ' + name);
      console.log('  !! MUTATION DID NOT APPLY — vacuous');
      allBit = false; return;
    }
    testPath = path.join(OUT, '_ctl_' + TEST_FILE);
    fs.writeFileSync(testPath, patched);
    changed.push(TEST_FILE);
  }

  const r = cp.spawnSync('node', [testPath], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
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
}

Object.keys(CONTROLS).forEach(name => {
  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  run(patch, null, name);
});
Object.keys(TEST_CONTROLS).forEach(name => run(null, TEST_CONTROLS[name], name));

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
