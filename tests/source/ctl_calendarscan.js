// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The hazards this file is sized against:
//
//   · A memo that looks like a memo and saves nothing — caching the empty array, or
//     re-running the per-calendar reads behind a cached calendar list.
//   · A consumer silently reverted to the live scan, which costs 12.6s and no test
//     output.
//   · The not-enabled wording list widened until it swallows unrelated faults, which
//     would name the wrong one-click fix.
//   · recordApiHealth_ moved back inside the per-calendar loop: eleven state writes and
//     eleven chances to email, for one fact.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_cals');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

// A mutation that cannot find its anchor must THROW, not quietly return the file
// unchanged — an unapplied mutation is a control that is no longer controlling.
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 60));
  return src.replace(from, to);
};

const CONTROLS = {
  // ---- the memo ------------------------------------------------------------
  'the memo is never written, so every consumer re-scans': b => ({
    'Calendar.js': swap(b['Calendar.js'],
      '    _upcomingEventsCache_[key] = events;\n', ''),
  }),
  'the memo is never read': b => ({
    'Calendar.js': swap(b['Calendar.js'],
      '  if (_upcomingEventsCache_[key]) return _upcomingEventsCache_[key].slice();',
      '  if (false) return _upcomingEventsCache_[key].slice();'),
  }),
  // Two controls, because the copy happens on two different lines and one of them
  // covering for the other is the whole hazard.
  'the cached read hands out its own array, not a copy': b => ({
    'Calendar.js': swap(b['Calendar.js'],
      '  if (_upcomingEventsCache_[key]) return _upcomingEventsCache_[key].slice();',
      '  if (_upcomingEventsCache_[key]) return _upcomingEventsCache_[key];'),
  }),
  'the call that FILLS the cache hands out the array it stored': b => ({
    'Calendar.js': swap(b['Calendar.js'],
      '    return events.slice();', '    return events;'),
  }),
  'an empty result IS cached, so one failed scan poisons the execution': b => ({
    'Calendar.js': swap(b['Calendar.js'],
      '  if (events && events.length) {', '  if (events) {'),
  }),
  'every window shares one entry': b => ({
    'Calendar.js': swap(b['Calendar.js'], "  var key = String(days);", "  var key = 'all';"),
  }),

  // ---- the advanced service ------------------------------------------------
  'the service is asked once per calendar again': b => ({
    'Calendar.js': swap(b['Calendar.js'],
      '      if (_calendarAdvancedUnavailable_) {', '      if (false) {'),
  }),
  'the not-enabled answer is not remembered': b => ({
    'Calendar.js': swap(b['Calendar.js'],
      '          _calendarAdvancedUnavailable_ = true;', '          ;'),
  }),
  'a transient failure is taken as "the API is off"': b => ({
    'Calendar.js': swap(b['Calendar.js'],
      '        if (googleApiNotEnabled_(tzErr.message)) {', '        if (true) {'),
  }),
  'the wording list widens to a bare "is disabled"': b => ({
    'ApiHealth.js': swap(b['ApiHealth.js'],
      "         t.indexOf('accessnotconfigured')            !== -1;",
      "         t.indexOf('accessnotconfigured')            !== -1 ||\n" +
      "         t.indexOf('is disabled')                    !== -1;"),
  }),
  'health is recorded once per calendar, inside the loop': b => {
    const s = b['Calendar.js'];
    const rec = "    if (activeCalendars.length && !advAlreadyDown) {\n" +
                "      recordApiHealth_('googlecalendar-advanced', tzOk, tzErrText, 0);\n" +
                "    }";
    if (s.indexOf(rec) === -1) throw new Error('the health record moved');
    return { 'Calendar.js': s.replace(rec, '').replace(
      '      calTzMaps[c.calendar.getId()] = map;\n    });',
      '      calTzMaps[c.calendar.getId()] = map;\n' +
      "      recordApiHealth_('googlecalendar-advanced', tzOk, tzErrText, 0);\n    });") };
  },
  'nothing is recorded at all, as before': b => ({
    'Calendar.js': swap(b['Calendar.js'],
      '    if (activeCalendars.length && !advAlreadyDown) {',
      '    if (false) {'),
  }),
  'a second scan re-records the same failure': b => ({
    'Calendar.js': swap(b['Calendar.js'],
      '    if (activeCalendars.length && !advAlreadyDown) {',
      '    if (activeCalendars.length) {'),
  }),

  // ---- the consumers -------------------------------------------------------
  // One per site. A revert at any one of them costs a full scan and changes no output,
  // which is exactly why each needs its own control.
  'the nightly collect step goes back to the live scan': b => ({
    'Code.js': swap(b['Code.js'],
      '      events    = getUpcomingEventsCached_();', '      events    = getUpcomingEvents();'),
  }),
  'buildCalendarMetrics_ goes back to the live scan': b => ({
    'Summaries.js': swap(b['Summaries.js'],
      '    const events = getUpcomingEventsCached_();', '    const events = getUpcomingEvents();'),
  }),
  'the pattern snapshot goes back to the live scan': b => ({
    'PatternRecognition.js': swap(b['PatternRecognition.js'],
      '    var events  = getUpcomingEventsCached_();', '    var events  = getUpcomingEvents();'),
  }),
  'runExplorer_ goes back to the live scan': b => ({
    'Reminders.js': swap(b['Reminders.js'],
      '  var events    = getUpcomingEventsCached_();', '  var events    = getUpcomingEvents();'),
  }),
  // The other half of the rule: a caller that must see its own writes must NOT be
  // served from the memo.
  'the hourly calendar-gap nudge is served from the memo': b => ({
    'Reminders.js': swap(b['Reminders.js'],
      '  var events      = getUpcomingEvents();', '  var events      = getUpcomingEventsCached_();'),
  }),

  // ---- TestBench -----------------------------------------------------------
  'TestBench times the warm call twice, so the saving looks like nothing': b => ({
    'TestBench.js': swap(b['TestBench.js'],
      '    invalidateUpcomingEvents_();\n', ''),
  }),
  'TestBench reports a stale advanced-service verdict': b => ({
    'TestBench.js': swap(b['TestBench.js'], '    invalidateCalendarAdvanced_();\n', ''),
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

  const r = cp.spawnSync('node', ['test_calendarscan.js'], {
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
