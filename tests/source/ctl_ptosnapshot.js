// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The first group restores the duplicated work verbatim — the two byte-identical gap
// scans, the unmemoised calendar resolution, the double getter pass — which together
// were the bulk of a step that ran 4m 06s of a 6-minute ceiling.
//
// The second group is the one that matters more: a cost fix that quietly changes an
// ANSWER. Sharing a fetch, batching a write or collapsing two passes are all ways to
// be faster and wrong, so each has a control that keeps the speed and breaks the data.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_ptos');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const CONTROLS = {
  // ---- the duplicated work, restored ---------------------------------------
  'the calendar name memo is removed': b => ({
    'PTO.js': b['PTO.js'].replace(
      '  if (Object.prototype.hasOwnProperty.call(_calendarByName_, key)) {\n' +
      '    return _calendarByName_[key];\n  }\n', ''),
  }),
  'the memo caches hits but not misses': b => ({
    'PTO.js': b['PTO.js'].replace(
      "    _calendarByName_[key] = null;\n    return null;", '    return null;'),
  }),
  'both consumers scan for themselves again': b => ({
    'PTO.js': b['PTO.js']
      .replace('findClearWindows_(gapCals, today, PTO_GAP_SCAN_DAYS_, 3, gapScan)',
               'findClearWindows_(gapCals, today, PTO_GAP_SCAN_DAYS_, 3)')
      .replace('getMilestones_(gapCals, cfg, today, gapScan)',
               'getMilestones_(gapCals, cfg, today)'),
  }),
  'the shared scan is never made': b => ({
    'PTO.js': b['PTO.js'].replace(
      '  return (gapCalendars || []).map(function(cal) {', '  return (gapCalendars || []).map(function(cal) {\n    if (true) return null;'),
  }),
  'getMilestones_ goes back to its own hardcoded 90': b => ({
    'PTO.js': b['PTO.js'].replace(
      '  var end      = new Date(today.getTime() + PTO_GAP_SCAN_DAYS_ * 24 * 60 * 60 * 1000);',
      '  var end      = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);'),
  }),
  'getPTOEvents_ reads the getters per pass again': b => {
    const s = b['PTO.js'];
    return { 'PTO.js': s
      .replace('    var p      = prepared[i];\n    var ev     = p.ev;\n' +
               '    var title  = p.title;\n    var tLower = p.tLower;\n    if (!p.allDay) continue;',
               '    var ev     = prepared[i].ev;\n    var title  = ev.getTitle().trim();\n' +
               '    var tLower = title.toLowerCase();\n    if (!ev.isAllDayEvent()) continue;')
      .replace('    var p2     = prepared[j];\n    var ev2    = p2.ev;\n' +
               '    var title2 = p2.title;\n    var tLow2  = p2.tLower;',
               '    var ev2    = prepared[j].ev;\n    var title2 = ev2.getTitle().trim();\n' +
               '    var tLow2  = title2.toLowerCase();')
      // p2 is gone, so its last use has to go too or the mutation is a ReferenceError
      // rather than a slower-but-working revert — a crash proves nothing about cost.
      .replace('    if (p2.allDay) {', '    if (ev2.isAllDayEvent()) {') };
  },
  'touchTripRow_ goes back to one setValue per cell': b => {
    const s = b['TripS.js'] ? 'TripS.js' : 'Trips.js';
    const start = b[s].indexOf('  writes.sort(function(a, b) { return a[0] - b[0]; });');
    const end   = b[s].indexOf('  invalidateTripRegistry_();', start);
    if (start === -1 || end === -1) throw new Error('batching block not found');
    return { [s]: b[s].slice(0, start) +
      '  writes.forEach(function(w) { sheet.getRange(rec._row, w[0]).setValue(w[1]); });\n' +
      b[s].slice(end) };
  },

  // ---- fast and WRONG -------------------------------------------------------
  'the shared scan is handed to the wrong calendar': b => ({
    'PTO.js': b['PTO.js'].replace(
      '    var events = (scannedEvents && scannedEvents[c]) || gapCalendars[c].getEvents(today, scanEnd);',
      '    var events = (scannedEvents && scannedEvents[0]) || gapCalendars[c].getEvents(today, scanEnd);'),
  }),
  'a calendar that throws takes the whole scan down': b => ({
    'PTO.js': b['PTO.js'].replace(
      '    try {\n      return cal.getEvents(today, end);\n    } catch (err) {',
      '    if (true) {\n      return cal.getEvents(today, end);\n    } else {'),
  }),
  'the prepared array drops the all-day flag': b => ({
    'PTO.js': b['PTO.js'].replace(
      'allDay: e.isAllDayEvent() };', 'allDay: true };'),
  }),
  'the batched write starts at the wrong column': b => ({
    'Trips.js': b['Trips.js'].replace(
      '    sheet.getRange(rec._row, run[0][0], 1, run.length)',
      '    sheet.getRange(rec._row, 1, 1, run.length)'),
  }),
  'the batch writes every column as one run': b => ({
    'Trips.js': b['Trips.js'].replace(
      '    if (writes[i][0] === run[run.length - 1][0] + 1) { run.push(writes[i]); continue; }',
      '    { run.push(writes[i]); continue; }'),
  }),

  // ---- the instrumentation --------------------------------------------------
  'the timer is declared after its first use': b => {
    const s = b['PTO.js'];
    const decl = '  var ptoSubs = [];\n  function sub_(label, fn) {\n' +
                 '    var t0 = Date.now();\n    try { return fn(); }\n' +
                 '    finally { ptoSubs.push({ name: label, ms: Date.now() - t0 }); }\n  }\n';
    if (s.indexOf(decl) === -1) throw new Error('timer block not found');
    return { 'PTO.js': s.replace(decl, '')
      .replace('  // Collect data\n', '  // Collect data\n' + decl) };
  },
  'a failing block loses its timing': b => ({
    'PTO.js': b['PTO.js'].replace(
      '    try { return fn(); }\n    finally { ptoSubs.push({ name: label, ms: Date.now() - t0 }); }',
      '    var out = fn();\n    ptoSubs.push({ name: label, ms: Date.now() - t0 });\n    return out;'),
  }),
  'the timings never leave the function': b => ({
    'PTO.js': b['PTO.js'].replace('  stats.subTimings = ptoSubs;\n', ''),
  }),
  'the breakdown gets its own inline formatter': b => ({
    'Code.js': b['Code.js'].replace(
      'var ptoSub = slowestNightlySteps_(ptoStats && ptoStats.subTimings, 11);',
      'var ptoSub = ((ptoStats && ptoStats.subTimings) || []).map(function(t) { ' +
      "return t.name + ' ' + (t.ms / 1000).toFixed(1) + 's'; });"),
  }),
  'one block is left untimed': b => ({
    'PTO.js': b['PTO.js'].replace(
      "  var gapScan    = sub_('gapScan',   function() { return scanGapCalendars_(gapCals, today); });",
      '  var gapScan    = scanGapCalendars_(gapCals, today);'),
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

  const r = cp.spawnSync('node', ['test_ptosnapshot.js'], {
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
