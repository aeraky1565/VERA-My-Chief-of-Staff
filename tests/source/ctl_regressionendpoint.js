// Negative controls: revert ONE behaviour at a time and confirm the test bites.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const SRC_DIR = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'ctl_rge');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
BASE['tests/regression.spec.js'] = fs.readFileSync(path.join(SRC_DIR, 'tests', 'regression.spec.js'), 'utf8');

const CONTROLS = {
  'the budget check is removed (back to never answering)': b => ({
    'RegressionTest.js': b['RegressionTest.js'].replace(
      /    if \(Date\.now\(\) >= deadline\) \{\n      results\.push\(\{ name: name, status: 'skipped', ms: 0, error: 'time budget exhausted' \}\);\n      return;\n    \}\n/, ''),
  }),
  'a skipped check is counted as a pass': b => ({
    'RegressionTest.js': b['RegressionTest.js'].replace(
      "      results.push({ name: name, status: 'skipped', ms: 0, error: 'time budget exhausted' });",
      "      results.push({ name: name, status: 'pass', ms: 0 });"),
  }),
  'an overrun no longer fails the build': b => ({
    'RegressionTest.js': b['RegressionTest.js'].replace(
      "    ok: failed === 0 && skipped === 0,",
      "    ok: failed === 0,"),
  }),
  'the skipped check is started anyway, then recorded': b => ({
    'RegressionTest.js': b['RegressionTest.js'].replace(
      /    if \(Date\.now\(\) >= deadline\) \{\n      results\.push\(\{ name: name, status: 'skipped', ms: 0, error: 'time budget exhausted' \}\);\n      return;\n    \}/,
      "    if (Date.now() >= deadline) {\n      try { fn(); } catch (e2) {}\n      results.push({ name: name, status: 'skipped', ms: 0, error: 'time budget exhausted' });\n      return;\n    }"),
  }),
  'the first failure aborts the remaining checks': b => ({
    'RegressionTest.js': b['RegressionTest.js'].replace(
      "      results.push({ name: name, status: 'fail', ms: Date.now() - s, error: err.message });",
      "      results.push({ name: name, status: 'fail', ms: Date.now() - s, error: err.message });\n      deadline = 0;"),
  }),
  'the per-check timings are dropped from the response': b => ({
    'RegressionTest.js': b['RegressionTest.js'].replace(
      "      results.push({ name: name, status: 'pass', ms: Date.now() - s });",
      "      results.push({ name: name, status: 'pass' });"),
  }),
  'the budget is no longer reported': b => ({
    'RegressionTest.js': b['RegressionTest.js'].replace("    budget_ms: REGRESSION_BUDGET_MS,\n", ''),
  }),
  'the deadline is off by one (a check starting with no time left)': b => ({
    'RegressionTest.js': b['RegressionTest.js'].replace(
      "    if (Date.now() >= deadline) {", "    if (Date.now() > deadline) {"),
  }),
  'the spec stops printing timings for passing checks': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      "console.log(`  ✅ ${r.name} (${r.ms}ms)`);", "console.log(`  ✅ ${r.name}`);"),
  }),
  'the spec treats skipped as just another pass': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      /        \} else if \(r\.status === 'skipped'\) \{\n[^\n]*\n/, '        } else if (false) {\n'),
  }),
  'the spec raises the client timeout instead': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace('timeout: 60000', 'timeout: 300000'),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'tests'), { recursive: true });
  const patch = CONTROLS[name](BASE);
  const files = Object.assign({}, BASE, patch);
  let changed = false;
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed = true;
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_regressionendpoint.js'], {
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
