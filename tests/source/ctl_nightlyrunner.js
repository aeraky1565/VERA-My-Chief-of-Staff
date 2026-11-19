// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The night continues itself in parts (NightlyRunner.js, #256). Each control puts back one
// way the night could again be cut short, or finish twice, or lose what a killed part did.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_nrn');
// Every root .js: the harness reads more of them than it mutates, and they share
// one global scope.
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const R = 'NightlyRunner.js', CO = 'Co' + 'de.js';
const rep = (f, a, b2) => b => { if (b[f].indexOf(a) === -1) throw new Error('anchor not found: ' + a.slice(0, 60)); return { [f]: b[f].replace(a, b2) }; };
const CONTROLS = {
  'a part runs to the end with no deadline of its own (the 6-minute kill)': rep(R, 'deadline: partStart + NIGHT_PART_BUDGET_MS_', 'deadline: partStart + 60 * 60 * 1000'),
  'no continuation is scheduled at a handoff': rep(R, '      nightlyScheduleContinue_(NIGHT_HANDOFF_MS_);\n', ''),
  'no backup is scheduled before a part starts': rep(R, '  if (st.part < NIGHT_MAX_PARTS_) nightlyScheduleContinue_(NIGHT_BACKUP_MS_);', ''),
  'the handoff isn’t marked (it looks like a kill)': rep(R, '      st.handoff = true;\n', ''),
  'the breadcrumb is left at a handoff': rep(R, "      st.handoff = true;\n      try { PropertiesService.getScriptProperties().deleteProperty(NIGHTLY_STEP_PROP_); } catch (e) {}\n", '      st.handoff = true;\n'),
  'the next part starts again at the step that ran out of time + 1 (skipping it)': rep(R, '      nightlySave_(st);\n      nightlyScheduleContinue_(NIGHT_HANDOFF_MS_);', '      st.next++; nightlySave_(st);\n      nightlyScheduleContinue_(NIGHT_HANDOFF_MS_);'),
  'a killed step is run again (and kills the night again)': rep(R, '{ next: Math.max(st.next, i + 1), killed: name }', '{ next: Math.max(st.next, i), killed: name }'),
  'a killed step isn’t recorded': rep(R, '    st.killed.push(at.killed);\n', ''),
  'a breadcrumb behind the saved place moves it back': rep(R, 'Math.max(st.next, i + 1)', '(i + 1)'),
  'no limit on parts': rep(R, '      if (st.part >= NIGHT_MAX_PARTS_) {', '      if (false) {'),
  'a stale night is continued anyway': rep(R, 'if (Date.now() - st.started > NIGHT_MAX_AGE_MS_) {', 'if (false) {'),
  'continuations are not cleaned up at the end': b => { const s = b[R].replace('  nightlyDropContinues_();\n  nightlyFinish_(st);', '  nightlyFinish_(st);'); if (s === b[R]) throw new Error('anchor'); return { [R]: s }; },
  'the heartbeat is recorded by every part (the night looks healthy while half-done)': rep(R, '      try { flushSystemLog_(); } catch (e) {}\n      return;', "      try { recordHeartbeat_('nightlyRun'); flushSystemLog_(); } catch (e) {}\n      return;"),
  'the pattern engine runs even when a writer was killed': rep(R, "var gate = s.n === 'checkCrossPatternFlags_' ? nightlyCrossGate_(st) : null;", 'var gate = null;'),
  'the gate ignores killed steps': rep(R, 'var gone = (st.skipped || []).concat(st.killed || []);', 'var gone = (st.skipped || []);'),
  'a repeat is counted from any earlier night, not last night': rep(R, 'if ((prev || {})[n] === yesterday) repeat.push(n);', 'if ((prev || {})[n]) repeat.push(n);'),
  'steps near the limit aren’t remembered': rep(R, 'return t.ms >= NIGHT_RISK_MS_;', 'return false;'),
  'the pattern engine moves before the last flag writers': b => {
    const s = b[R], m = /\n(\s*S\('checkCrossPatternFlags_'[^\n]*\n)/.exec(s);
    if (!m) throw new Error('anchor: checkCrossPatternFlags_ step');
    const without = s.replace(m[1], ''), at = without.indexOf("S('collect'");
    return { [R]: without.slice(0, at) + m[1].trim() + '\n    ' + without.slice(at) };
  },
  'writeSummarySnapshot is no longer last': b => {
    const s = b[R], m = /\n(\s*S\('writeSummarySnapshot'[^\n]*\n)/.exec(s);
    if (!m) throw new Error('anchor: writeSummarySnapshot step');
    const without = s.replace(m[1], ''), at = without.indexOf("S('scrubLoggedSecrets_'");
    return { [R]: without.slice(0, at) + m[1].trim() + '\n    ' + without.slice(at) };
  },
  'a step is dropped from the list': b => { const s = b[R].replace(/\n\s*S\('checkRefills_'[^\n]*/, ''); if (s === b[R]) throw new Error('anchor'); return { [R]: s }; },
  'the flag colours go back to one write per row': rep(CO, '  sheet.getRange(2, 1, lastRow - 1, FLAG_HEADERS.length).setBackgrounds(flagRowColors_(urgencyData, FLAG_HEADERS.length));',
    "  urgencyData.forEach(function(r, i) { sheet.getRange(i + 2, 1, 1, FLAG_HEADERS.length).setBackground(flagRowColors_([r], FLAG_HEADERS.length)[0][0]); });"),
  'the second-half trigger comes back': b => { const s = b[CO].replace(/(handler: 'nightlyRun'[^\n]*\n)/, "$1    { handler: 'nightlyRunTail', kind: 'daily', hour: 0 },\n"); if (s === b[CO]) throw new Error('anchor'); return { [CO]: s }; },
  'the old tail trigger isn’t removed when it fires': rep(R, "if (t.getHandlerFunction() === 'nightlyRunTail') ScriptApp.deleteTrigger(t);", ''),
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

  const r = cp.spawnSync('node', ['test_nightlyrunner.js'], {
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
