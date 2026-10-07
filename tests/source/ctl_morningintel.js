// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The first group restores the bugs verbatim — each dependency fetched again inside
// buildMorningIntelligence_, which is what made it 27.5s.
//
// THE SECOND GROUP IS THE POINT OF THIS FILE. A performance fix of this shape fails in
// a way that looks careful: a lazy fallback. `allEvents || getUpcomingEvents(7)` reads
// as defensive and restores 12.6s on exactly the path where the budget has already said
// there is no time — the latest block in the run, with the least left. If a future
// change adds one, 'the day plan falls back to a re-scan' is the control that catches it.
//
// The rest cover the ways a cache can be wrong rather than absent: caching a failure,
// keying on nothing, sharing a mutable object, never invalidating.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_mi');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const CONTROLS = {
  // ---- the duplicated fetches, restored ------------------------------------
  'the day plan re-scans the calendar for itself (the reported bug)': b => ({
    'Code.js': b['Code.js']
      .replace("  if (!allEvents) return '';\n",
               '  allEvents = getUpcomingEvents(7);\n'),
  }),
  'the day plan falls back to a re-scan when the phase was skipped': b => ({
    'Code.js': b['Code.js']
      .replace("  if (!allEvents) return '';\n",
               '  allEvents = allEvents || getUpcomingEvents(7);\n'),
  }),
  'the overdue list reads the Tasks tab for itself': b => ({
    'Code.js': b['Code.js'].replace('var taskList = openTasks || getOpenTasks();',
                                    'var taskList = getOpenTasks();'),
  }),
  'the day plan reads the Tasks tab for itself': b => ({
    'Code.js': b['Code.js'].replace('tasks = (openTasks || getOpenTasks())',
                                    'tasks = getOpenTasks()'),
  }),
  'the day plan reads capacity mode for itself': b => ({
    'Code.js': b['Code.js'].replace('  var mode = capMode || \'normal\';',
                                    "  var mode = 'normal';\n  try { mode = getCapacityMode_().mode; } catch (e) {}"),
  }),
  'the injected capMode is accepted but never used': b => ({
    'Code.js': b['Code.js'].replace("  var mode = capMode || 'normal';",
                                    "  var mode = 'normal';"),
  }),
  'the four tabs each open their own handle': b => ({
    'Code.js': b['Code.js'].replace(/\bss_\(\)/g, 'getSpreadsheet()')
                           .replace('var ss_t = getSpreadsheet();', 'var ss_t = getSpreadsheet();'),
  }),
  'the spreadsheet handle is not memoised': b => ({
    'Code.js': b['Code.js'].replace(
      '  if (!_spreadsheet_) _spreadsheet_ = SpreadsheetApp.openById(CONFIG.SHEET_ID);\n  return _spreadsheet_;',
      '  return SpreadsheetApp.openById(CONFIG.SHEET_ID);'),
  }),
  'the packing read goes back inside the trip loop': b => {
    const s = b['Code.js'];
    // Drop the bucketing pass, and restore the per-trip read it replaced.
    const bucketStart = s.indexOf('    var packByTrip = {};');
    const bucketEnd   = s.indexOf('    travelTrips.forEach(function(trip) {', bucketStart);
    if (bucketStart === -1 || bucketEnd === -1) throw new Error('bucketing block not found');
    let out = s.slice(0, bucketStart) + s.slice(bucketEnd);
    out = out.replace(
      '      var bucket    = packByTrip[tripKey] || { total: 0, done: 0 };\n' +
      '      var packTotal = bucket.total, packDone = bucket.done;',
      '      var packTotal = 0, packDone = 0;\n' +
      '      try {\n' +
      '        var packSheet = ss_t.getSheetByName(TABS.PACKING_ITEMS);\n' +
      '        if (packSheet && packSheet.getLastRow() >= 2) {\n' +
      '          packSheet.getRange(2, 1, packSheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues().forEach(function(r) {\n' +
      '            if (String(r[1]).trim() !== tripKey) return;\n' +
      '            packTotal++;\n' +
      '            if (String(r[5]).toLowerCase() === \'true\' || String(r[5]).toLowerCase() === \'yes\') packDone++;\n' +
      '          });\n' +
      '        }\n' +
      '      } catch(pe) {}');
    return { 'Code.js': out };
  },

  // ---- a fix that only looks applied ---------------------------------------
  'the injected events are accepted but the prompt is fed from a re-scan': b => ({
    'Code.js': b['Code.js'].replace(
      '  var todayTimedEvents = allEvents.filter(function(e) {',
      '  allEvents = getUpcomingEvents(7);\n  var todayTimedEvents = allEvents.filter(function(e) {'),
  }),
  'the week outlook is dropped along with the second scan': b => ({
    'Code.js': b['Code.js'].replace(
      '    return e.daysUntil >= 1 && e.daysUntil <= 6 && !e.isAllDay;',
      '    return false;'),
  }),

  // ---- the handle's laziness -----------------------------------------------
  'the shared handle is opened eagerly, outside every try': b => ({
    'Code.js': b['Code.js'].replace(
      '  var _ss = null;\n  function ss_() { if (!_ss) _ss = getSpreadsheet(); return _ss; }',
      '  var _ss = getSpreadsheet();\n  function ss_() { return _ss; }'),
  }),
  'the travel handle moves inside the packing try, hiding a dead spreadsheet': b => {
    const s = b['Code.js'];
    return { 'Code.js': s
      .replace('    var ss_t = ss_();\n', '')
      .replace('      var packSheet = ss_t.getSheetByName(TABS.PACKING_ITEMS);',
               '      var packSheet = ss_().getSheetByName(TABS.PACKING_ITEMS);') };
  },

  // ---- degradation ---------------------------------------------------------
  'one block\'s failure takes the whole section down': b => ({
    'Code.js': b['Code.js'].replace(
      "    catch (e) { Logger.log('buildMorningIntelligence_: ' + (logAs || label) + ' — ' + e.message); }",
      '    finally {}'),
  }),
  'a block\'s log message is no longer its own': b => ({
    'Code.js': b['Code.js'].replace("(logAs || label)", "'a block'"),
  }),
  'the empty-section early return is dropped': b => ({
    'Code.js': b['Code.js'].replace(
      "  if (focusRows.length === 0 && maintRows.length === 0 && travelRows.length === 0 && calPlanHtml === '') return '';",
      '  // early return removed'),
  }),

  // ---- the sub-timings -----------------------------------------------------
  'the sub-phases go through nightlyStep_ after all': b => ({
    'Code.js': b['Code.js'].replace(
      '  function sub_(label, fn, logAs) {\n    var t0 = Date.now();',
      '  function sub_(label, fn, logAs) {\n    nightlyStep_(ctx, label, fn);\n    var t0 = Date.now();'),
  }),
  'a block is left out of the breakdown': b => ({
    'Code.js': b['Code.js'].replace("    subs.push({ name: label, ms: Date.now() - t0 });",
                                    "    if (label !== 'coupons') subs.push({ name: label, ms: Date.now() - t0 });"),
  }),
  'the breakdown is emitted with its own inline formatter': b => ({
    'Code.js': b['Code.js'].replace(
      'var mIntel = slowestNightlySteps_(intelSubTimings, 6);',
      'var mIntel = intelSubTimings.map(function(t) { return t.name + \' \' + (t.ms / 1000).toFixed(1) + \'s\'; });'),
  }),
  'the breakdown hides the fastest blocks': b => ({
    'Code.js': b['Code.js'].replace('slowestNightlySteps_(intelSubTimings, 6)',
                                    'slowestNightlySteps_(intelSubTimings, 3)'),
  }),

  // ---- the weather memo ----------------------------------------------------
  'the forecast is not memoised at all': b => ({
    'Weather.js': b['Weather.js'].replace(
      '  if (_weatherForecastCache_[location]) return _weatherForecastCache_[location];\n', ''),
  }),
  'the forecast memo caches failures too': b => ({
    'Weather.js': b['Weather.js']
      .replace('  if (_weatherForecastCache_[location]) return _weatherForecastCache_[location];',
               '  if (_weatherForecastCache_.hasOwnProperty(location)) return _weatherForecastCache_[location];')
      .replace('  var response = fetchWithHealth_(\'openweathermap\', url);\n  if (!response) return null;',
               '  var response = fetchWithHealth_(\'openweathermap\', url);\n' +
               '  if (!response) { _weatherForecastCache_[location] = null; return null; }'),
  }),
  'the forecast memo is keyed on nothing': b => ({
    'Weather.js': b['Weather.js']
      .replace('  if (_weatherForecastCache_[location]) return _weatherForecastCache_[location];',
               '  if (_weatherForecastCache_.only) return _weatherForecastCache_.only;')
      .replace('    if (parsed) _weatherForecastCache_[location] = parsed;',
               '    if (parsed) _weatherForecastCache_.only = parsed;'),
  }),
  'the geocode cache is dropped': b => ({
    'Weather.js': b['Weather.js'].replace(
      '        try { CacheService.getScriptCache().put(geoCacheKey, JSON.stringify(coords), 21600); } catch (e_) {}\n', ''),
  }),
  'the geocode cache never reads back': b => ({
    'Weather.js': b['Weather.js'].replace(
      '    var geoCached = CacheService.getScriptCache().get(geoCacheKey);',
      '    var geoCached = null;'),
  }),
  'a geocode failure is cached for six hours': b => ({
    'Weather.js': b['Weather.js'].replace(
      "  recordApiHealth_('openweathermap', false, 'no geocoding results for \"' + location + '\"', 200);\n  return null;",
      "  recordApiHealth_('openweathermap', false, 'no geocoding results for \"' + location + '\"', 200);\n" +
      "  try { CacheService.getScriptCache().put(geoCacheKey, JSON.stringify(null), 21600); } catch (e_) {}\n  return null;"),
  }),

  // ---- the PTO config row memo --------------------------------------------
  'the Config rows are not memoised': b => ({
    'PTO.js': b['PTO.js'].replace('  if (_ptoConfigRows_) return _ptoConfigRows_;\n', ''),
  }),
  // The hazard the plan called out: memoising the config OBJECT rather than the rows
  // would let one caller's push() corrupt a shared array for every later caller. Here
  // it is as one shared array, which is the smallest form of that bug — and valid JS
  // inside readPTOConfig_'s own body, so the test's brace-matching extraction picks it
  // up (a `return (_cache = {` shim needs a closing paren a regex cannot place).
  'one config array becomes shared between callers': b => {
    const s = b['PTO.js'];
    const orig = "    milestoneKeywords: (raw['milestone_keywords'] || 'Wedding,Graduation,Trip,Travel,Concert,Birthday')\n" +
                 '                       .split(\',\').map(function(k) { return k.trim().toLowerCase(); }),';
    if (s.indexOf(orig) === -1) throw new Error('milestoneKeywords not found');
    // Stashed on `data` — the memoised rows array itself, the same instance on every
    // call — so the sharing survives between callers without a new module-level
    // declaration the test would have to be taught to load.
    return { 'PTO.js': s.replace(orig,
      "    milestoneKeywords: (data._shared || (data._shared =\n" +
      "                       (raw['milestone_keywords'] || 'Wedding,Graduation,Trip,Travel,Concert,Birthday')\n" +
      '                       .split(\',\').map(function(k) { return k.trim().toLowerCase(); }))),') };
  },
  'a missing Config tab stops throwing': b => ({
    'PTO.js': b['PTO.js'].replace("  if (!sheet) throw new Error('Config tab not found');\n  _ptoConfigRows_",
                                  "  if (!sheet) return [];\n  _ptoConfigRows_"),
  }),
  'the buffer reader stops absorbing that throw': b => ({
    'PTO.js': b['PTO.js'].replace(
      '  var data;\n  try { data = readPTOConfigRows_(); } catch (e) { return cfg.bufferDays; }\n' +
      "  for (var i = 0; i < data.length; i++) {\n    if (String(data[i][0]).trim() === 'pto_buffer_remaining') {",
      "  var data = readPTOConfigRows_();\n" +
      "  for (var i = 0; i < data.length; i++) {\n    if (String(data[i][0]).trim() === 'pto_buffer_remaining') {"),
  }),
  'a Config writer stops invalidating the row memo': b => ({
    'PTO.js': b['PTO.js'].replace(
      "      sheet.getRange(i + 1, 2).setValue(Math.max(0, newVal));\n      invalidatePTOConfigRows_();",
      '      sheet.getRange(i + 1, 2).setValue(Math.max(0, newVal));'),
  }),

  // ---- the wiring in morningNudge -----------------------------------------
  'morningNudge throws the scan away again': b => ({
    'Code.js': b['Code.js'].replace(
      '      allEvents      = getUpcomingEvents();\n' +
      '      todayEventsAll = allEvents.filter(function(e) { return e.daysUntil === 0; });',
      '      todayEventsAll = getUpcomingEvents().filter(function(e) { return e.daysUntil === 0; });'),
  }),
  'allEvents starts as [] instead of null': b => ({
    'Code.js': b['Code.js'].replace('    var allEvents      = null;', '    var allEvents      = [];'),
  }),
  'openTasks goes back inside its phase closure': b => ({
    'Code.js': b['Code.js'].replace('    var openTasks      = null;\n', '')
                           .replace('      openTasks     = getOpenTasks();', '      var openTasks = getOpenTasks();'),
  }),
  'the intelligence section is called with no arguments again': b => ({
    'Code.js': b['Code.js'].replace(
      'buildMorningIntelligence_(allEvents, openTasks, capMode, intelSubTimings)',
      'buildMorningIntelligence_()'),
  }),
  'a phase variable goes back to const': b => ({
    'Code.js': b['Code.js'].replace('    var allEvents      = null;', '    const allEvents      = null;'),
  }),
  'the breakdown line is removed': b => ({
    'Code.js': b['Code.js'].replace(
      /\n      var mIntel = slowestNightlySteps_\(intelSubTimings, 6\);\n      if \(mIntel\.length\) sendSlackLog_\('⏱️ buildMorningIntelligence_ breakdown: ' \+ mIntel\.join\(' · '\)\);/, ''),
  }),
};

// Which test file each control is expected to be caught by. Both are run for every
// control, because a mutation in Code.js can legitimately bite in either.
const TESTS = ['test_morningintel.js', 'test_morningnudge.js'];

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

  const fails = [];
  let crashed = false;
  TESTS.forEach(t => {
    const r = cp.spawnSync('node', [t], {
      cwd: __dirname, encoding: 'utf8',
      env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
    });
    const out = (r.stdout || '') + (r.stderr || '');
    const f = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
    fails.push.apply(fails, f);
    if (r.status !== 0 && f.length === 0) crashed = true;
  });

  console.log('\n=== CONTROL: ' + name);
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (!fails.length && crashed) { console.log('  !! CRASHED with no clean assertion failure'); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT (patched: ' + changed.join(', ') + ')'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 3).forEach(f => console.log('    - ' + f));
  if (fails.length > 3) console.log('    … and ' + (fails.length - 3) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
