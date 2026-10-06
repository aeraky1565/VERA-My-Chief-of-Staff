// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The ones that matter most put back the state that lost a morning email: phases with
// no budget and no breadcrumb, so a slow dependency kills the whole run and nothing
// afterwards can say which one it was.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_mn');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

// Unwrap one phase back into the bare call it used to be.
const unwrap = (src, name, inner) =>
  src.replace("nightlyStep_(ctx, '" + name + "', function() {", inner)
     .replace(/\n(\s*)\}\);/, '\n$1');

const CONTROLS = {
  // ---- the budget ---------------------------------------------------------
  'the weather fetch goes back to a bare, unguarded call (the likely killer)': b => ({
    'Code.js': b['Code.js'].replace(
      /    var weatherTicker = '';\n    nightlyStep_\(ctx, 'getWeatherTicker_', function\(\) \{\n      weatherTicker = getWeatherTicker_\(todayEventsAll\) \|\| '';\n    \}\);/,
      "    const weatherTicker = getWeatherTicker_(todayEventsAll);"),
  }),
  'the Drive logo fetch is unbudgeted again': b => ({
    'Code.js': b['Code.js'].replace("nightlyStep_(ctx, 'loadLogoFromDrive', function() {",
                                    "(function() {"),
  }),
  'the watchdog is unbudgeted': b => ({
    'Code.js': b['Code.js'].replace("nightlyStep_(ctx, 'runWatchdog_', function() {",
                                    "(function() {"),
  }),
  'the watchdog and the notice rendering share one phase': b => ({
    'Code.js': b['Code.js'].replace("nightlyStep_(ctx, 'buildStalenessNotice', function() {",
                                    "(function() {"),
  }),
  'the task fetches are unbudgeted': b => ({
    'Code.js': b['Code.js']
      .replace("nightlyStep_(ctx, 'getOpenTasks', function() {", "(function() {")
      .replace("nightlyStep_(ctx, 'webGetGoogleTasks_', function() {", "(function() {"),
  }),
  'Morning Intelligence is unbudgeted': b => ({
    'Code.js': b['Code.js'].replace("nightlyStep_(ctx, 'buildMorningIntelligence_', function() {",
                                    "(function() {"),
  }),
  'the budget is the nightly 5m30s, leaving no room for the send': b => ({
    'Code.js': b['Code.js'].replace('deadline: runStart + 4.5 * 60 * 1000',
                                    'deadline: runStart + 5.5 * 60 * 1000'),
  }),
  'the send is put behind the budget too': b => ({
    'Code.js': b['Code.js'].replace(
      "      sendVeraEmail_(CONFIG.MORNING_NUDGE_EMAIL, subject, plainText, mailOptions, 'morning_briefing');",
      "      nightlyStep_(ctx, 'sendVeraEmail_', function() { sendVeraEmail_(CONFIG.MORNING_NUDGE_EMAIL, subject, plainText, mailOptions, 'morning_briefing'); });"),
  }),

  // ---- the breadcrumb and the start marker --------------------------------
  'the start marker is removed': b => ({
    'Code.js': b['Code.js'].replace(
      /  try \{\n    PropertiesService\.getScriptProperties\(\)\n      \.setProperty\('LAST_MORNING_START'[\s\S]*?\n  \} catch \(startErr\) \{[^\n]*\}\n/, ''),
  }),
  'the start marker is written after the first phase': b => {
    const s = b['Code.js'];
    const m = /  try \{\n    PropertiesService\.getScriptProperties\(\)\n      \.setProperty\('LAST_MORNING_START'[\s\S]*?\n  \} catch \(startErr\) \{[^\n]*\}\n/.exec(s)[0];
    return { 'Code.js': s.replace(m, '').replace(
      "    // ---- Try to load logo from Drive ------------------------------------",
      m + "    // ---- Try to load logo from Drive ------------------------------------") };
  },
  'the morning phases write the NIGHTLY breadcrumb': b => ({
    'Code.js': b['Code.js'].replace('    stepProp: MORNING_STEP_PROP_,\n', ''),
  }),
  'the watchdog is not told about the morning markers': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      ", startProp: 'LAST_MORNING_START', stepProp: 'MORNING_STEP' }", " }"),
  }),
  'the breadcrumb is cleared on the success path, so an early return looks like a death': b => {
    const s = b['Code.js'];
    const m = /    try \{\n      PropertiesService\.getScriptProperties\(\)\.deleteProperty\(MORNING_STEP_PROP_\);\n    \} catch \(bcErr\) \{[^\n]*\}\n/.exec(s)[0];
    return { 'Code.js': s.replace(m, '').replace(
      "    try { recordHeartbeat_('delivery:morning_briefing'); } catch (hbErr) {}",
      "    try { recordHeartbeat_('delivery:morning_briefing'); } catch (hbErr) {}\n" + m) };
  },

  // ---- the disabled path --------------------------------------------------
  'the enabled check moves back outside the try (no heartbeat when disabled)': b => {
    const s = b['Code.js'];
    const m = /    if \(!isNotifEnabled_\('morning_briefing'\)\) \{\n      Logger\.log\('morningNudge: skipped — morning_briefing disabled'\);\n      return;\n    \}\n/.exec(s)[0];
    return { 'Code.js': s.replace(m, '').replace('  try {\n    // INSIDE the try',
      m.replace(/^    /gm, '  ') + '  try {\n    // INSIDE the try') };
  },

  // ---- reporting ----------------------------------------------------------
  'the slowest phases are never reported': b => ({
    'Code.js': b['Code.js'].replace('Slowest morning phases: ', 'Morning ran: '),
  }),
  'a dropped section is reported as a warning': b => ({
    'Code.js': b['Code.js'].replace(
      "      if (stepSkipped.length)  mSummary += ' · ' + stepSkipped.length + ' skipped (time budget)';",
      "      if (stepSkipped.length)  mSummary += ' · ' + stepSkipped.length + ' warnings';"),
  }),
  'the dropped sections are counted but never named': b => ({
    'Code.js': b['Code.js'].replace(
      /      if \(stepSkipped\.length\) \{\n        sendSlackLog_\('⏭️ Morning sections dropped for time:\\n' \+\n[\s\S]*?\n      \}\n/, ''),
  }),
  'a run that dropped a section is logged as Success': b => ({
    'Code.js': b['Code.js'].replace(
      "        (stepFailures.length || stepSkipped.length) ? 'Partial' : 'Success',\n        total + ' flag(s)",
      "        stepFailures.length ? 'Partial' : 'Success',\n        total + ' flag(s)"),
  }),
  'the summary can take the email down': b => ({
    'Code.js': b['Code.js'].replace(
      '} catch (mSumErr) { /* non-fatal — never let logging break the email */ }',
      '} catch (mSumErr) { throw mSumErr; }'),
  }),

  // ---- the duplicate calendar fetch ---------------------------------------
  'the capacity ticker refetches the calendar': b => ({
    'Code.js': b['Code.js'].replace(
      '      var meetCount = todayEventsAll.filter(function(e) { return !e.isAllDay; }).length;',
      '      var meetCount = 0;\n      try { meetCount = getUpcomingEvents().filter(function(e) {\n' +
      '        return e.daysUntil === 0 && !e.isAllDay; }).length; } catch (e) {}'),
  }),

  // ---- the closure hoisting -----------------------------------------------
  'a phase variable goes back to const (its section silently blanks)': b => ({
    'Code.js': b['Code.js'].replace('    var intelligenceSection = \'\';',
                                    '    const intelligenceSection = \'\';'),
  }),
  'a phase variable is declared with let inside the closure': b => ({
    'Code.js': b['Code.js'].replace('    var guestTicker = \'\';', '    let guestTicker = \'\';'),
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

  const r = cp.spawnSync('node', ['test_morningnudge.js'], {
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
