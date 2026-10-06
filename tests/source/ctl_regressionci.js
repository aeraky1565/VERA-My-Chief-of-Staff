// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// Each of these puts back a way a failing CI run can decline to say what failed —
// which is the state that cost a push to diagnose one red tick.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_rci');

// This test reads files outside the root .js set, so the control copies the tree parts
// it needs rather than just *.js.
const EXTRA = ['playwright.config.js', 'tests/regression.spec.js',
               'tests/failing-titles.js', '.github/workflows/regression.yml'];
const ROOT_JS = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
ROOT_JS.concat(EXTRA).forEach(f => {
  const p = path.join(SRC_DIR, f);
  if (fs.existsSync(p)) BASE[f] = fs.readFileSync(p, 'utf8');
});

const CONTROLS = {
  // ---- the annotations path ------------------------------------------------
  'the github reporter is removed (a failure names nothing again)': b => ({
    'playwright.config.js': b['playwright.config.js'].replace("        ['github'],\n", ''),
  }),
  'the github reporter is on everywhere, including locally': b => ({
    'playwright.config.js': b['playwright.config.js'].replace(
      'process.env.CI || process.env.GITHUB_ACTIONS', 'true'),
  }),
  'the github reporter REPLACES list and json': b => ({
    'playwright.config.js': b['playwright.config.js'].replace(
      /  reporter: process\.env\.CI[\s\S]*?\n      \],\n/,
      "  reporter: [['github']],\n"),
  }),
  'the reporter name is one Playwright does not ship': b => ({
    'playwright.config.js': b['playwright.config.js'].replace("['github']", "['githib']"),
  }),

  // ---- the Slack message --------------------------------------------------
  'the Slack message goes back to status only': b => ({
    '.github/workflows/regression.yml': b['.github/workflows/regression.yml']
      .replace(/          FAILED=""\n[\s\S]*?\n          fi\n\n/, '')
      .replace(/          if \[ -n "\$FAILED" \]; then\n[\s\S]*?\n          fi\n/, ''),
  }),
  'the failing titles are read without checking the file exists': b => ({
    '.github/workflows/regression.yml': b['.github/workflows/regression.yml'].replace(
      '          if [ -f test-results/results.json ]; then\n', '          if true; then\n'),
  }),
  'the payload is interpolated instead of built with jq': b => ({
    '.github/workflows/regression.yml': b['.github/workflows/regression.yml'].replace(
      /          jq -nc --arg t "\$TEXT"[\s\S]*?--data-binary @-/,
      '          curl -sX POST "$SLACK_WEBHOOK_URL" -H "Content-Type: application/json" \\\n' +
      '            -d "{\\"text\\":\\"${TEXT}\\"}"'),
  }),
  'the Slack step only runs on failure': b => ({
    '.github/workflows/regression.yml': b['.github/workflows/regression.yml'].replace(
      '      - name: Notify Slack\n        if: always()',
      '      - name: Notify Slack\n        if: failure()'),
  }),

  // ---- the timings --------------------------------------------------------
  'the endpoint calls go back to untimed ctx.get': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js']
      .replace("const resp = await timedGet(ctx, 'status', { timeout: 20000 });",
               "const resp = await ctx.get(`${VERA_URL}?action=status&token=${VERA_TOKEN}`, { timeout: 20000 });"),
  }),
  'one action slips out of the timed helper': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js']
      .replace("const resp = await timedGet(ctx, 'address_book', { timeout: 30000 });",
               "const resp = await ctx.get(`${VERA_URL}?action=address_book&token=${VERA_TOKEN}`, { timeout: 30000 });"),
  }),
  'a request that never answers is not recorded': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      "    endpointTimings.push({ action, ms, status: 'no answer' });\n", ''),
  }),
  'a hung request is swallowed instead of failing the test': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      /    console\.error\(`  ⏱  \$\{action\}: \$\{ms\}ms — NO ANSWER[\s\S]*?\n    throw err;/,
      "    console.error('no answer');\n    return { ok: () => true, status: () => 200, json: async () => ({ ok: true }) };"),
  }),
  'the timings are never reported': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      '    reportEndpointTimings();\n', ''),
  }),
  'the timings are reported fastest first': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      'sort((a, b) => b.ms - a.ms)', 'sort((a, b) => a.ms - b.ms)'),
  }),
  'the dead actions are counted but not named': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      'dead.map(t => t.action).join(\', \')', "''"),
  }),

  // ---- the warm-up --------------------------------------------------------
  'the warm-up is removed': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      /    \/\/ ONE WARM-UP REQUEST[\s\S]*?\n    \}\n  \}\);/, '  });'),
  }),
  'the warm-up gets the same 20s budget as the tests': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace('{ timeout: 45000 }',
                                                                     '{ timeout: 20000 }'),
  }),
  'the warm-up becomes an assertion and gates the suite': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      /    \} catch \(err\) \{\n      console\.error\(`  🔥 warm-up got NO ANSWER[\s\S]*?\n    \}/,
      '    } catch (err) { throw err; }'),
  }),
  'the warm-up duration is not printed': b => ({
    'tests/regression.spec.js': b['tests/regression.spec.js'].replace(
      '`  🔥 warm-up: ${Date.now() - t0}ms (HTTP ${resp.status()})`', "'warmed'"),
  }),

  // ---- the extractor ------------------------------------------------------
  'the extractor stops descending into nested suites': b => ({
    'tests/failing-titles.js': b['tests/failing-titles.js'].replace(
      '    (suite.suites || []).forEach(walk);\n', ''),
  }),
  'the extractor reports skipped specs as failures': b => ({
    'tests/failing-titles.js': b['tests/failing-titles.js'].replace(
      'if (spec && spec.ok === false)', 'if (spec && spec.ok !== false)'),
  }),
  'the cap is removed': b => ({
    'tests/failing-titles.js': b['tests/failing-titles.js'].replace(
      /  const shown = titles\.slice\(0, max\)[\s\S]*?\n    : shown;/,
      "  return titles.map(t => '• ' + t).join('\\n');"),
  }),
  'nothing failing prints a header anyway': b => ({
    'tests/failing-titles.js': b['tests/failing-titles.js'].replace(
      "  if (!titles.length) return '';", "  if (!titles.length) return 'none';"),
  }),
  'a malformed report throws instead of yielding nothing': b => ({
    'tests/failing-titles.js': b['tests/failing-titles.js'].replace(
      '  })({ suites: report && report.suites });', '  })({ suites: report.suites });'),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'tests', 'source'), { recursive: true });
  fs.mkdirSync(path.join(OUT, '.github', 'workflows'), { recursive: true });

  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }

  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });
  // The test reads node_modules through ROOT for the reporter-name check.
  try {
    fs.symlinkSync(path.join(SRC_DIR, 'node_modules'), path.join(OUT, 'node_modules'));
  } catch (e) { /* already there, or unsupported — the test skips that assertion */ }

  const r = cp.spawnSync('node', ['test_regressionci.js'], {
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
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
