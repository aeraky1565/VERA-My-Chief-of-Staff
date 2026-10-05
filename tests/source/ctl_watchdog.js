// Negative controls: revert ONE behaviour at a time and confirm the test bites.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const SRC_DIR = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'ctl_wd');
// Every root .js, not just the ones mutated: test_watchdog.js reads several others
// (VERALog.js among them) and a partial copy makes the control crash on a missing
// file instead of failing an assertion — which reads as "did not bite".
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const CONTROLS = {
  'a killed run is reported as "has not run" again': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      "          verb = 'started but did not finish; last completed run was';",
      "          verb = r.verb || 'has not run in';"),
  }),
  'the start marker is dropped from the registry': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(", startProp: 'LAST_NIGHTLY_START', stepProp: 'NIGHTLY_STEP' }", " }"),
  }),
  'an unparseable start marker is trusted': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      "        if (startedAt && startedAt > entry.lastRun) {",
      "        if (startedRaw) {"),
  }),
  'nightlyRun stops writing the start marker': b => ({
    'Code.js': b['Code.js'].replace(/\n    try \{\n      PropertiesService\.getScriptProperties\(\)\n        \.setProperty\('LAST_NIGHTLY_START'[\s\S]*?\n    \} catch \(startErr\) \{[^\n]*\}/, ''),
  }),
  'the start marker moves after the first step': b => {
    const s = b['Code.js'];
    const m = /\n    try \{\n      PropertiesService\.getScriptProperties\(\)\n        \.setProperty\('LAST_NIGHTLY_START'[\s\S]*?\n    \} catch \(startErr\) \{[^\n]*\}/.exec(s)[0];
    return { 'Code.js': s.replace(m, '').replace('    // Step 1b: Suggest due dates', m + '\n    // Step 1b: Suggest due dates') };
  },
  'the completion marker is removed': b => ({
    'Code.js': b['Code.js'].replace(/\n    try \{\n      PropertiesService\.getScriptProperties\(\)\n        \.setProperty\('LAST_NIGHTLY_RUN'[\s\S]*?\n    \} catch \(lnrErr\) \{\}/, ''),
  }),
  // The guard is no longer at the prune's call site — it is in nightlyStep_, where
  // every step gets it. So this reverts the thing that actually matters now.
  'the step runner loses its budget check (every step runs regardless)': b => ({
    'Code.js': b['Code.js'].replace(
      /  if \(Date\.now\(\) \+ NIGHTLY_STEP_RESERVE_MS_ >= ctx\.deadline\) \{\n[\s\S]*?\n    return false;\n  \}\n/, ''),
  }),
  'a step hand-rolls its own budget check again': b => ({
    'Code.js': b['Code.js'].replace(
      "    nightlyStep_(ctx, 'pruneMemoryLog_', pruneMemoryLog_);",
      "    if (Date.now() < DEADLINE) { nightlyStep_(ctx, 'pruneMemoryLog_', pruneMemoryLog_); }"),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const patch = CONTROLS[name](BASE);
  const files = Object.assign({}, BASE, patch);
  let changed = false;
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed = true;
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_watchdog.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
  if (!changed)      { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)       { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-5).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 3).forEach(f => console.log('    - ' + f));
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
