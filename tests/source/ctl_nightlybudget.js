// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The ones that matter most put back the two states this change exists to end:
// a budget almost nothing consults, and a breadcrumb written too late to survive.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_nbd');
// Every root .js: the harness reads more of them than it mutates, and they share
// one global scope.
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const CONTROLS = {
  // ---- the budget ----------------------------------------------------------
  'the budget check is removed (every step runs regardless — the bug)': b => ({
    'Code.js': b['Code.js'].replace(
      /  if \(Date\.now\(\) \+ NIGHTLY_STEP_RESERVE_MS_ >= ctx\.deadline\) \{\n[\s\S]*?\n    return false;\n  \}\n/, ''),
  }),
  'a skipped step is counted as a failure instead': b => ({
    'Code.js': b['Code.js'].replace('    ctx.skipped.push(name);',
                                    '    ctx.failures.push(name);'),
  }),
  'the skipped step is started anyway, then recorded': b => ({
    'Code.js': b['Code.js'].replace(
      '    ctx.skipped.push(name);',
      '    try { fn(); } catch (e9) {}\n    ctx.skipped.push(name);'),
  }),
  'the deadline is off by one (a step starting with no time left)': b => ({
    'Code.js': b['Code.js'].replace('  if (Date.now() + NIGHTLY_STEP_RESERVE_MS_ >= ctx.deadline) {',
                                    '  if (Date.now() + NIGHTLY_STEP_RESERVE_MS_ > ctx.deadline) {'),
  }),
  'a skipped step is given a fake timing': b => ({
    'Code.js': b['Code.js'].replace(
      '    ctx.skipped.push(name);',
      '    ctx.skipped.push(name);\n    ctx.timings.push({ name: name, ms: 0 });'),
  }),

  // ---- the catch -----------------------------------------------------------
  'a throwing step takes the run down again': b => ({
    'Code.js': b['Code.js'].replace(
      /  var t0 = Date\.now\(\);\n  try \{\n    fn\(\);\n  \} catch \(err\) \{\n[\s\S]*?\n  \}\n/,
      '  var t0 = Date.now();\n  fn();\n'),
  }),
  'a failure is recorded without naming the step': b => ({
    'Code.js': b['Code.js'].replace("    ctx.failures.push(name + ': ' + err.message);",
                                    "    ctx.failures.push(err.message);"),
  }),
  'a step that threw is not timed': b => ({
    'Code.js': b['Code.js'].replace(
      "  ctx.timings.push({ name: name, ms: Date.now() - t0 });\n  return true;",
      "  if (!ctx.failures.length) ctx.timings.push({ name: name, ms: Date.now() - t0 });\n  return true;"),
  }),

  // ---- the breadcrumb ------------------------------------------------------
  'the breadcrumb is written AFTER the step, not before': b => {
    const s = b['Code.js'];
    const write = /  var elapsed = Date\.now\(\) - ctx\.runStart;\n  try \{\n[\s\S]*?\n  \} catch \(bcErr\) \{[^\n]*\}\n/.exec(s)[0];
    return { 'Code.js': s.replace(write, '').replace(
      '  ctx.timings.push({ name: name, ms: Date.now() - t0 });',
      write + '  ctx.timings.push({ name: name, ms: Date.now() - t0 });') };
  },
  'the breadcrumb loses the elapsed time': b => ({
    'Code.js': b['Code.js'].replace(
      ".setProperty(ctx.stepProp || NIGHTLY_STEP_PROP_, name + '|' + Math.round(elapsed / 1000));",
      ".setProperty(ctx.stepProp || NIGHTLY_STEP_PROP_, name);"),
  }),
  'a skipped step leaves a breadcrumb too': b => ({
    'Code.js': b['Code.js'].replace(
      '    ctx.skipped.push(name);',
      "    try { PropertiesService.getScriptProperties().setProperty(NIGHTLY_STEP_PROP_, name + '|0'); } catch (e8) {}\n    ctx.skipped.push(name);"),
  }),
  'a failing property write breaks the step': b => ({
    'Code.js': b['Code.js'].replace(
      /  \} catch \(bcErr\) \{ \/\* a breadcrumb must never be able to break the run \*\/ \}/,
      '  } catch (bcErr) { throw bcErr; }'),
  }),

  // ---- the reporting -------------------------------------------------------
  'the slowest report sorts fastest first': b => ({
    'Code.js': b['Code.js'].replace('.sort(function(a, b) { return b.ms - a.ms; })',
                                    '.sort(function(a, b) { return a.ms - b.ms; })'),
  }),
  'the slowest report sorts the caller\'s array in place': b => ({
    'Code.js': b['Code.js'].replace('  return (timings || []).slice()\n', '  return (timings || [])\n'),
  }),

  // ---- the watchdog --------------------------------------------------------
  'the watchdog stops reading the breadcrumb': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(", stepProp: 'NIGHTLY_STEP' }", " }"),
  }),
  // Went vacuous when the start-marker reasoning moved into jobStartedAndDied_ — it
  // matched indentation that no longer exists, so the mutation silently did not apply.
  // Re-aimed at the guard itself, which is now the one place it lives.
  'the breadcrumb is read even when the run did NOT die': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      '    if (startedAt <= lastRunMs) return null;', ''),
  }),
  'the step is not shown in the rendered lines': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      /\n *\(j\.diedAt \? ' \\u2014 died during ' \+ j\.diedAt : ''\) \+/, ''),
  }),
  'the step is not shown on the flag': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      /\n *\(j\.diedAt \? ' \\u2014 died during ' \+ j\.diedAt : ''\);/, ';'),
  }),
  // ---- the reserve, and the split -----------------------------------------
  // THE BUG, put back: a step may start with a millisecond of budget left and then
  // overrun Apps Script's ceiling, taking the finally — and every diagnostic — with it.
  'a step may start with no time left to finish in': b => ({
    'Code.js': b['Code.js'].replace('Date.now() + NIGHTLY_STEP_RESERVE_MS_ >= ctx.deadline',
                                    'Date.now() >= ctx.deadline'),
  }),
  'the reserve is zero': b => ({
    'Code.js': b['Code.js'].replace(/^var NIGHTLY_STEP_RESERVE_MS_\s*=.*?;/m,
                                    'var NIGHTLY_STEP_RESERVE_MS_ = 0;'),
  }),
  'the reserve is a token amount that no step would fit in': b => ({
    'Code.js': b['Code.js'].replace(/^var NIGHTLY_STEP_RESERVE_MS_\s*=.*?;/m,
                                    'var NIGHTLY_STEP_RESERVE_MS_ = 5;'),
  }),

  // ---- the dependency order ------------------------------------------------
  // The one consumer of tonight's flags has to come after every producer.
  'escalateAgedFlags_ loses its age cutoff (it now reads tonight\'s flags, first)': b => ({
    'Code.js': b['Code.js']
      .replace('ageDays >= 7 && currentEscalated', 'ageDays >= 0 && currentEscalated')
      .replace('ageDays >= 3 && currentEscalated', 'ageDays >= 0 && currentEscalated'),
  }),

  // ---- the guard -----------------------------------------------------------
  'the gate is ignored and the step runs on a half-populated night (the bug)': b => ({
    'Code.js': b['Code.js'].replace(
      /  if \(gate && !gate\.ok\) \{\n[\s\S]*?\n    return false;\n  \}\n/, ''),
  }),
  'a blocked step is counted as skipped for time instead': b => ({
    'Code.js': b['Code.js'].replace(
      "    if (!ctx.blocked) ctx.blocked = [];\n    ctx.blocked.push(name + ' — ' + (gate.reason || 'precondition not met'));",
      "    ctx.skipped.push(name);"),
  }),
  'the blocked step is recorded without its reason': b => ({
    'Code.js': b['Code.js'].replace(
      "    ctx.blocked.push(name + ' — ' + (gate.reason || 'precondition not met'));",
      "    ctx.blocked.push(name);"),
  }),
  'the gate is checked after the clock, so a bad night reports as a slow one': b => ({
    'Code.js': (() => {
      const s = b['Code.js'];
      const gate = /  if \(gate && !gate\.ok\) \{\n[\s\S]*?\n    return false;\n  \}\n/.exec(s)[0];
      const clock = /  if \(Date\.now\(\) \+ NIGHTLY_STEP_RESERVE_MS_ >= ctx\.deadline\) \{\n[\s\S]*?\n    return false;\n  \}\n/.exec(s)[0];
      return s.replace(gate, '').replace(clock, clock + gate);
    })(),
  }),
  'a blocked step is given a fake timing': b => ({
    'Code.js': b['Code.js'].replace(
      "    ctx.blocked.push(name + ' — ' + (gate.reason || 'precondition not met'));",
      "    ctx.blocked.push(name + ' — ' + (gate.reason || 'precondition not met'));\n" +
      "    ctx.timings.push({ name: name, ms: 0 });"),
  }),

  // ---- reporting the skip --------------------------------------------------

  // ---- Step 1 outside the budget: the Oct 8 kill ----------------------------
  // Restores the four bare calls verbatim. This is what ran after the budget had
  // already skipped computeTravelLegs_, and what the execution was killed inside.
  // ---- the one list (#256) ---------------------------------------------------
  'a flag writer is appended after the pattern engine': b => {
    const s = b['NightlyRunner.js'], at = s.indexOf("    S('checkCrossPatternFlags_'");
    const nl = s.indexOf('\n', at) + 1;
    return { 'NightlyRunner.js': s.slice(0, nl) + "    S('checkRefills2_', 4, function() { checkRefills_(); }),\n" + s.slice(nl) };
  },
  'a step name no longer resolves to a body (the classifier goes blind)': b => ({
    'NightlyRunner.js': b['NightlyRunner.js'].replace("S('checkRefills_', 1, function() { checkRefills_(); }),", "S('checkRefillz_', 1, function() { checkRefillz_(); }),"),
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

  const r = cp.spawnSync('node', ['test_nightlybudget.js'], {
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
