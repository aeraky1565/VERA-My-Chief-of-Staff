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
  // These two went VACUOUS when the start-marker logic moved into
  // jobStartedAndDied_ — they matched text that no longer existed, so the mutation
  // silently did not apply and the control proved nothing. Re-aimed at the extracted
  // helper, which is now the one place the behaviour lives.
  'a killed run is reported as "has not run" again': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      "      verb = died ? 'started but did not finish; last completed run was'\n" +
      "                  : (r.verb || 'has not run in');",
      "      verb = r.verb || 'has not run in';"),
  }),
  'the start marker is dropped from the registry': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(", startProp: 'LAST_NIGHTLY_START', stepProp: 'NIGHTLY_STEP' }", " }"),
  }),
  'an unparseable start marker is trusted': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      "    if (!startedAt || isNaN(startedAt)) return null;",
      "    if (!startedRaw) return null;"),
  }),
  'a start marker OLDER than the last run is read as a death': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      "    if (startedAt <= lastRunMs) return null;", ''),
  }),

  // ---- a job that has never run -------------------------------------------
  'a job with no heartbeat is skipped outright again (the blind spot)': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      /    if \(!lastRun\) \{\n[\s\S]*?\n    \} else \{\n/,
      '    if (!lastRun) return;\n    {\n'),
  }),
  'an UNregistered job with no heartbeat alarms too (the fresh deploy)': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      '      if (!registeredAt) return;',
      '      if (!registeredAt) registeredAt = 0;'),
  }),
  'a job alarms the moment it is registered, before it was ever due': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      '      if (ageMs <= windowMs) return;          // registered, but not due yet', ''),
  }),
  'the never-ran age is measured from the epoch instead of registration': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      '      ageMs = now - registeredAt;',
      '      ageMs = now - lastRun;'),
  }),
  'a never-run job blames the code instead of the trigger': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      "        suffix = 'since it was registered — the trigger may not exist';",
      "        suffix = 'since it was registered';"),
  }),
  'a job that fires and dies on every first run is reported as missing': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      "      died = jobStartedAndDied_(r, 0);\n      if (died) {",
      "      died = null;\n      if (died) {"),
  }),
  'the suffix is dropped from the rendered line': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      "               (j.suffix ? ' ' + j.suffix : '') +\n" +
      "               (j.diedAt ? ' \\u2014 died during ' + j.diedAt : '') +\n" +
      "               ' (expected every '",
      "               (j.diedAt ? ' \\u2014 died during ' + j.diedAt : '') +\n" +
      "               ' (expected every '"),
  }),
  'registrations are merged rather than replaced (a dead handler lingers)': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      '  var map = {};\n  (handlers || []).forEach(function(h) { map[h] = now; });',
      '  var map = getTriggerRegistrations_();\n  (handlers || []).forEach(function(h) { map[h] = now; });'),
  }),
  'corrupt registration state is allowed to throw': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      /  try \{\n    var raw = PropertiesService\.getScriptProperties\(\)\.getProperty\(TRIGGER_REGISTRY_KEY_\)[\s\S]*?\n  \}\n\}/,
      '  var raw = PropertiesService.getScriptProperties().getProperty(TRIGGER_REGISTRY_KEY_) || \'{}\';\n' +
      '  return JSON.parse(raw);\n}'),
  }),
  'the flag reason formats lastRun=0 as a 1969 date again': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      /               \(j\.neverRan\n[\s\S]*?Utilities\.formatDate\(new Date\(j\.lastRun\), tz, 'MMM d, h:mm a'\) \+ '\.'\) \+/,
      "               'Last run ' + Utilities.formatDate(new Date(j.lastRun), tz, 'MMM d, h:mm a') + '.' +"),
  }),
  'a real heartbeat is overridden by the registration age': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      '    var lastRun  = (entry && entry.lastRun) ? entry.lastRun : 0;',
      '    var lastRun  = 0;'),
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
