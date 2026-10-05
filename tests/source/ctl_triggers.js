// Negative controls for test_triggers.js: revert ONE behaviour at a time and confirm
// the test bites.
//
// The ones that matter most put back the bug this fix exists for — a delete guard that
// does not cover every handler created — and break each of the eight schedules, since
// the equivalence assertions are the only thing standing between a refactor of live
// scheduling code and a trigger quietly firing at the wrong time.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_trg');
// Every root .js: they share one global scope and the harness reads more than it mutates.
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const CONTROLS = {
  // ---- the bug itself -----------------------------------------------------
  // A hand-written guard that misses one handler. This is what shipped, and what
  // made the tail duplicate on every run.
  'the delete guard misses one handler (the original bug)': b => ({
    'Code.js': b['Code.js'].replace(
      '    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) {',
      "    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1 &&\n" +
      "        trigger.getHandlerFunction() !== 'nightlyRunTail') {"),
  }),
  'nothing is deleted at all': b => ({
    'Code.js': b['Code.js'].replace(
      /  ScriptApp\.getProjectTriggers\(\)\.forEach\(function\(trigger\) \{\n[\s\S]*?\n  \}\);\n/, ''),
  }),
  'the deletes are interleaved with the creates': b => ({
    'Code.js': b['Code.js']
      .replace(/  ScriptApp\.getProjectTriggers\(\)\.forEach\(function\(trigger\) \{\n[\s\S]*?\n  \}\);\n/, '')
      .replace('    s.build(ScriptApp.newTrigger(s.handler).timeBased()).create();',
               "    ScriptApp.getProjectTriggers().forEach(function(t) {\n" +
               "      if (t.getHandlerFunction() === s.handler) ScriptApp.deleteTrigger(t);\n" +
               "    });\n" +
               '    s.build(ScriptApp.newTrigger(s.handler).timeBased()).create();'),
  }),
  'it deletes every trigger in the project, including other modules\'': b => ({
    'Code.js': b['Code.js'].replace(
      '    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) {',
      '    if (true) {'),
  }),
  'a handler is created without being in the spec list': b => ({
    'Code.js': b['Code.js'].replace(
      '  var created = [];',
      "  ScriptApp.newTrigger('scanHoaWebsite_').timeBased().everyMinutes(5).create();\n" +
      '  var created = [];'),
  }),
  'the same handler is listed twice in the specs': b => ({
    'Code.js': b['Code.js'].replace(
      "    { handler: 'hourlyCheck',",
      "    { handler: 'morningNudge',\n" +
      "      when: 'every hour',\n" +
      "      build: function(t) { return t.everyHours(1).inTimezone(tz); } },\n\n" +
      "    { handler: 'hourlyCheck',"),
  }),
  'the builder chain is never created': b => ({
    'Code.js': b['Code.js'].replace(
      '    s.build(ScriptApp.newTrigger(s.handler).timeBased()).create();',
      '    s.build(ScriptApp.newTrigger(s.handler).timeBased());'),
  }),

  // ---- each schedule ------------------------------------------------------
  'the nightly run loses its everyDays(1)': b => ({
    'Code.js': b['Code.js'].replace(
      '        return t.atHour(CONFIG.NIGHTLY_RUN_HOUR).everyDays(1).inTimezone(tz);',
      '        return t.atHour(CONFIG.NIGHTLY_RUN_HOUR).inTimezone(tz);'),
  }),
  'the tail no longer wraps past midnight': b => ({
    'Code.js': b['Code.js'].replace(
      '        return t.atHour((CONFIG.NIGHTLY_RUN_HOUR + 1) % 24).everyDays(1).inTimezone(tz);',
      '        return t.atHour(CONFIG.NIGHTLY_RUN_HOUR + 1).everyDays(1).inTimezone(tz);'),
  }),
  'the tail hardcodes midnight instead of following the head': b => ({
    'Code.js': b['Code.js'].replace(
      '        return t.atHour((CONFIG.NIGHTLY_RUN_HOUR + 1) % 24).everyDays(1).inTimezone(tz);',
      '        return t.atHour(0).everyDays(1).inTimezone(tz);'),
  }),
  'the flight poller is given a timezone': b => ({
    'Code.js': b['Code.js'].replace(
      '      build: function(t) { return t.everyMinutes(15); } },',
      '      build: function(t) { return t.everyMinutes(15).inTimezone(tz); } },'),
  }),
  'the email scan interval is halved': b => ({
    'Code.js': b['Code.js'].replace('return t.everyMinutes(30);', 'return t.everyMinutes(15);'),
  }),
  'the USPS scan moves off 10am': b => ({
    'Code.js': b['Code.js'].replace('return t.atHour(10).everyDays(1).inTimezone(tz);',
                                    'return t.atHour(6).everyDays(1).inTimezone(tz);'),
  }),
  'the HOA scan loses its weekday': b => ({
    'Code.js': b['Code.js'].replace(
      '        return t.everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).inTimezone(tz);',
      '        return t.everyWeeks(1).atHour(9).inTimezone(tz);'),
  }),
  'the HOA scan runs on the wrong day': b => ({
    'Code.js': b['Code.js'].replace('ScriptApp.WeekDay.MONDAY', 'ScriptApp.WeekDay.TUESDAY'),
  }),
  'the hourly check loses its timezone': b => ({
    'Code.js': b['Code.js'].replace(
      '      build: function(t) { return t.everyHours(1).inTimezone(tz); } },',
      '      build: function(t) { return t.everyHours(1); } },'),
  }),
  'the timezone is read once at load time instead of per call': b => ({
    'Code.js': b['Code.js'].replace('function veraTriggerSpecs_() {\n  var tz = Session.getScriptTimeZone();',
                                    'var VERA_TRIGGERS_ = null;\nfunction veraTriggerSpecs_() {\n  var tz = Session.getScriptTimeZone();'),
  }),

  // ---- the log ------------------------------------------------------------
  'the summary goes back to a hardcoded literal': b => ({
    'Code.js': b['Code.js'].replace(
      /  Logger\.log\('Triggers set \(' \+ created\.length[\s\S]*?\);\n/,
      "  Logger.log('Triggers set: nightlyRun at 11pm, morningNudge at 7am, hourlyCheck every hour, checkFlightStatuses_ every 15min, runEmailScan_ every 30min, scanUSPSMail_ at 10am, scanHoaWebsite_ every Monday 9am.');\n"),
  }),
  'the summary counts but does not name': b => ({
    'Code.js': b['Code.js'].replace("' + created.join(', ') + '.');", "');"),
  }),
  'the summary names but does not count': b => ({
    'Code.js': b['Code.js'].replace("'Triggers set (' + created.length + '): '", "'Triggers set: '"),
  }),
  'the summary is built before the creates, so a failure still reports success': b => ({
    'Code.js': b['Code.js'].replace(
      '    created.push(s.handler + \' \' + s.when);', ''),
  }),

  // ---- registration -------------------------------------------------------
  'registrations are never recorded (the watchdog blind spot returns)': b => ({
    'Code.js': b['Code.js'].replace(
      /  try \{\n    recordTriggerRegistrations_\(handlers\);\n  \} catch \(regErr\) \{\n[\s\S]*?\n  \}\n/, ''),
  }),
  'a failed registration write takes the whole install down': b => ({
    'Code.js': b['Code.js'].replace(
      /  try \{\n    recordTriggerRegistrations_\(handlers\);\n  \} catch \(regErr\) \{\n[\s\S]*?\n  \}\n/,
      '  recordTriggerRegistrations_(handlers);\n'),
  }),
  'the failed write is swallowed in silence': b => ({
    'Code.js': b['Code.js'].replace(
      "    Logger.log('recordTriggerRegistrations_ (non-fatal): ' + regErr.message);", ''),
  }),
  'registration is recorded BEFORE the triggers are created': b => {
    const s = b['Code.js'];
    const reg = /  try \{\n    recordTriggerRegistrations_\(handlers\);\n  \} catch \(regErr\) \{\n[\s\S]*?\n  \}\n/.exec(s)[0];
    return { 'Code.js': s.replace(reg, '').replace('  var created = [];', reg + '\n  var created = [];') };
  },
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

  const r = cp.spawnSync('node', ['test_triggers.js'], {
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
