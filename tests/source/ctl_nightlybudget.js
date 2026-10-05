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
  'one step hand-rolls its own budget check again': b => ({
    'Code.js': b['Code.js'].replace(
      "    nightlyStep_(ctx, 'pruneMemoryLog_', pruneMemoryLog_);",
      "    if (Date.now() < DEADLINE) { nightlyStep_(ctx, 'pruneMemoryLog_', pruneMemoryLog_); }"),
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
  'a completed run leaves the breadcrumb set': b => ({
    'Code.js': b['Code.js'].replace(/\n *PropertiesService\.getScriptProperties\(\)\.deleteProperty\(NIGHTLY_STEP_PROP_\);/g, ''),
  }),
  'the empty-run early return forgets to clear it': b => {
    const s = b['Code.js'];
    const i = s.indexOf('no events, tasks, or summaries tonight');
    const j = s.indexOf('deleteProperty(NIGHTLY_STEP_PROP_);', i);
    const k = s.indexOf('\n', j);
    return { 'Code.js': s.slice(0, j) + 'void 0;' + s.slice(k) };
  },

  // ---- the reporting -------------------------------------------------------
  'skips are reported as step warnings': b => ({
    'Code.js': b['Code.js'].replace(
      "      if (stepSkipped.length) summary += ' \\u00b7 ' + stepSkipped.length + ' skipped (time budget)';",
      "      if (stepSkipped.length) stepFailures.push('skipped');"),
  }),
  'the slowest steps are never reported': b => ({
    'Code.js': b['Code.js'].replace(/      var slowest = slowestNightlySteps_\(stepTimings, 5\);\n/g,
                                    '      var slowest = [];\n'),
  }),
  'the slowest report sorts fastest first': b => ({
    'Code.js': b['Code.js'].replace('.sort(function(a, b) { return b.ms - a.ms; })',
                                    '.sort(function(a, b) { return a.ms - b.ms; })'),
  }),
  'the slowest report sorts the caller\'s array in place': b => ({
    'Code.js': b['Code.js'].replace('  return (timings || []).slice()\n', '  return (timings || [])\n'),
  }),
  'the two previously-unguarded steps go back to being bare calls': b => ({
    'Code.js': b['Code.js']
      .replace("    nightlyStep_(ctx, 'writeSummarySnapshot', writeSummarySnapshot);", '    writeSummarySnapshot();')
      .replace("    nightlyStep_(ctx, 'checkTaxDocuments_', checkTaxDocuments_);", '    checkTaxDocuments_();'),
  }),

  // ---- the watchdog --------------------------------------------------------
  'the watchdog stops reading the breadcrumb': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(", stepProp: 'NIGHTLY_STEP' }", " }"),
  }),
  'the breadcrumb is read even when the run did NOT die': b => {
    const s = b['Watchdog.js'];
    return { 'Watchdog.js': s.replace(
      "          if (r.stepProp) {",
      "          }\n          if (r.stepProp) {").replace(
      "              diedAt = bits[0] + (isFinite(secs) ? ' (' + formatAge_(secs * 1000) + ' in)' : '');\n            }\n          }\n        }",
      "              diedAt = bits[0] + (isFinite(secs) ? ' (' + formatAge_(secs * 1000) + ' in)' : '');\n            }\n          }") };
  },
  'the step is not shown in the rendered lines': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      /\n *\(j\.diedAt \? ' \\u2014 died during ' \+ j\.diedAt : ''\) \+/, ''),
  }),
  'the step is not shown on the flag': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      /\n *\(j\.diedAt \? ' \\u2014 died during ' \+ j\.diedAt : ''\),/, ','),
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
  'both halves share one breadcrumb': b => ({
    'Code.js': b['Code.js'].replace('ctx.stepProp || NIGHTLY_STEP_PROP_', 'NIGHTLY_STEP_PROP_'),
  }),
  'the tail does not tell nightlyStep_ which breadcrumb to write': b => ({
    'Code.js': b['Code.js'].replace('      stepProp: NIGHTLY_TAIL_STEP_PROP_,\n', ''),
  }),
  'the tail records no heartbeat of its own': b => ({
    'Code.js': b['Code.js'].replace("    try { recordHeartbeat_('nightlyRunTail'); } catch (hbErr) {}\n", ''),
  }),
  'the head records the tail\'s heartbeat too (masking its death)': b => ({
    'Code.js': b['Code.js'].replace("    try { recordHeartbeat_('nightlyRun'); } catch (hbErr) {}",
                                    "    try { recordHeartbeat_('nightlyRun'); } catch (hbErr) {}\n" +
                                    "    try { recordHeartbeat_('nightlyRunTail'); } catch (hbErr) {}"),
  }),
  'the tail writes no start marker': b => ({
    'Code.js': b['Code.js'].replace(/        \.setProperty\('LAST_NIGHTLY_TAIL_START'[^;]*;/, ';'),
  }),
  'the watchdog does not know about the tail': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(/  \{ job: 'nightlyRunTail'[^\n]*\n/, ''),
  }),
  'no trigger fires the tail': b => ({
    'Code.js': b['Code.js'].replace(/  ScriptApp\.newTrigger\('nightlyRunTail'\)[\s\S]*?\.create\(\);\n/, ''),
  }),
  'the tail runs at the same hour as the head': b => ({
    'Code.js': b['Code.js'].replace('.atHour((CONFIG.NIGHTLY_RUN_HOUR + 1) % 24)',
                                    '.atHour(CONFIG.NIGHTLY_RUN_HOUR)'),
  }),
  'a tail step is left behind in the head as well': b => ({
    'Code.js': b['Code.js'].replace(
      "    // The night now ends here.",
      "    nightlyStep_(ctx, 'runExplorer_', runExplorer_);\n    // The night now ends here."),
  }),
  'a step is dropped from both halves': b => ({
    'Code.js': b['Code.js'].replace(
      "    nightlyStep_(ctx, 'checkCrossPatternFlags_', checkCrossPatternFlags_);\n", ''),
  }),
  'the tail clears its breadcrumb in the finally (presence stops meaning died)': b => ({
    'Code.js': b['Code.js'].replace(
      "    try {\n      PropertiesService.getScriptProperties().deleteProperty(NIGHTLY_TAIL_STEP_PROP_);\n    } catch (bcErr) { /* non-fatal */ }",
      ''). replace(
      "    try { recordHeartbeat_('nightlyRunTail'); } catch (hbErr) {}",
      "    try { PropertiesService.getScriptProperties().deleteProperty(NIGHTLY_TAIL_STEP_PROP_); } catch (bcErr) {}\n" +
      "    try { recordHeartbeat_('nightlyRunTail'); } catch (hbErr) {}"),
  }),
  'the tail never reports its slowest steps': b => ({
    'Code.js': b['Code.js'].replace(/Slowest tail steps: /, 'Tail ran: '),
  }),
  'the PTO snapshot is recomputed every night in the tail': b => ({
    'Code.js': b['Code.js'].replace('var ptoStats = today.getDate() === 1 ? writePTOSnapshot_() : null;',
                                    'var ptoStats = writePTOSnapshot_();'),
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
