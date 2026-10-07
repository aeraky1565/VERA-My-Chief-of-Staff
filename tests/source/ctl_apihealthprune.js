// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The two that matter most put back the false alarms: recording a successful empty
// response as an outage, and pruning on how long a source has been BROKEN rather
// than on how long nothing has TOUCHED it — which would silence the real outages
// while leaving the orphans in place, exactly backwards.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_ahp');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
BASE['README.md'] = fs.readFileSync(path.join(SRC_DIR, 'README.md'), 'utf8');

const CONTROLS = {
  // ---- the prune -----------------------------------------------------------
  'the prune does nothing (the orphan nags forever — the bug)': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      '    if (lastTouched && (now - lastTouched) <= API_HEALTH_ORPHAN_MS_) return;',
      '    return;'),
  }),
  'it prunes on lastFailure alone': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      '    var lastTouched = Math.max(e.lastSuccess || 0, e.lastFailure || 0, e.lastRateLimited || 0);',
      '    var lastTouched = e.lastFailure || 0;'),
  }),
  'it prunes on lastSuccess alone (a live failing source is dropped)': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      '    var lastTouched = Math.max(e.lastSuccess || 0, e.lastFailure || 0, e.lastRateLimited || 0);',
      '    var lastTouched = e.lastSuccess || 0;'),
  }),
  'it prunes on how long the source has been BROKEN': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      '    if (lastTouched && (now - lastTouched) <= API_HEALTH_ORPHAN_MS_) return;',
      '    if (!e.consecutiveFailures || (now - (e.lastSuccess || 0)) <= API_HEALTH_ORPHAN_MS_) return;'),
  }),
  'an entry with no timestamps is kept (and can never age out)': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      '    if (lastTouched && (now - lastTouched) <= API_HEALTH_ORPHAN_MS_) return;',
      '    if (!lastTouched || (now - lastTouched) <= API_HEALTH_ORPHAN_MS_) return;'),
  }),
  'the window is a day, not a fortnight (a quiet weekend drops a source)': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(/var API_HEALTH_ORPHAN_MS_ = 14 \* 24/, 'var API_HEALTH_ORPHAN_MS_ = 1 * 24'),
  }),
  'the boundary is exclusive (14 days exactly is dropped)': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(') <= API_HEALTH_ORPHAN_MS_) return;',
                                              ') < API_HEALTH_ORPHAN_MS_) return;'),
  }),
  'the pruned state is never written back': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(/\n *setApiHealthState_\(state\);\n *Logger\.log\('pruneApiHealthState_/,
                                              "\n    Logger.log('pruneApiHealthState_"),
  }),
  'it rewrites the property even when nothing was dropped': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace('  if (removed.length) {\n    setApiHealthState_(state);',
                                              '  setApiHealthState_(state);\n  if (removed.length) {'),
  }),
  'the prune is not wired into the nightly run': b => ({
    'Code.js': b['Code.js'].replace(/\n *nightlyStep_\(ctx, 'pruneApiHealthState_', pruneApiHealthState_\);/, ''),
  }),
  'the clock cannot be injected (the test can only pass by waiting 14 days)': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace('  var now     = nowMs || Date.now();',
                                              '  var now     = Date.now();'),
  }),

  // ---- aviationstack -------------------------------------------------------
  'an empty 200 is recorded as a failure again (the reported bug)': b => ({
    'FlightStatus.js': b['FlightStatus.js'].replace(
      "      recordApiHealth_('aviationstack', true, '', code);\n      return null;",
      "      recordApiHealth_('aviationstack', false, 'no data returned for ' + flightIata, code);\n      return null;"),
  }),
  'an empty 200 records nothing at all (a stuck source never heals)': b => ({
    'FlightStatus.js': b['FlightStatus.js'].replace(
      "      recordApiHealth_('aviationstack', true, '', code);\n      return null;",
      "      return null;"),
  }),
  'an empty 200 returns a bogus object instead of null': b => ({
    'FlightStatus.js': b['FlightStatus.js'].replace(
      "      recordApiHealth_('aviationstack', true, '', code);\n      return null;",
      "      recordApiHealth_('aviationstack', true, '', code);\n      return {};"),
  }),
  'a 429 is now treated as success too': b => ({
    'FlightStatus.js': b['FlightStatus.js'].replace(
      "      recordApiHealth_('aviationstack', false, 'rate limited / quota exhausted', 429);",
      "      recordApiHealth_('aviationstack', true, '', 429);"),
  }),
  'a non-200 is now treated as success too': b => ({
    'FlightStatus.js': b['FlightStatus.js'].replace(
      "      recordApiHealth_('aviationstack', false, 'HTTP error for ' + flightIata, code);",
      "      recordApiHealth_('aviationstack', true, '', code);"),
  }),
  'a missing key is no longer recorded': b => ({
    'FlightStatus.js': b['FlightStatus.js'].replace(
      "    recordApiHealth_('aviationstack', false, 'AVIATIONSTACK_KEY not set in Script Properties', 0);\n", ''),
  }),
  'a fetch error is no longer recorded': b => ({
    'FlightStatus.js': b['FlightStatus.js'].replace(
      "    recordApiHealth_('aviationstack', false, 'fetch error for ' + flightIata + ': ' + err.message, 0);\n", ''),
  }),

  // ---- the docs ------------------------------------------------------------
  'the README never explains the orphan rule': b => ({
    'README.md': b['README.md'].replace(/orphan/gi, 'thing').replace(/no longer records/gi, 'does not record'),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_apihealthprune.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
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
