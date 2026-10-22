// Negative controls for the Oct 20 fixes: revert ONE protection at a time and confirm
// its test bites. Each control names the test that must catch it — the watchdog's
// incident lifecycle lives in test_flags.js, the rest in test_nightlyfixes.js.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_nfix');

const FILES = ['VERALog.js', 'Code.js', 'FlightStatus.js', 'ApiHealth.js', 'Slack.js', 'Watchdog.js', 'docs/app.js', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const FIX = 'test_nightlyfixes.js', FLAGS = 'test_flags.js';

const CONTROLS = [
  // ---- credentials in logs ---------------------------------------------------
  ['the pattern misses access_key (the real leak)', FIX, b => ({
    'VERALog.js': swap(b['VERALog.js'], '(?:access_key|api_key|', '(?:api_key|'),
  })],
  ['veraLog_ stops masking', FIX, b => ({
    'VERALog.js': swap(b['VERALog.js'], '  summary = redactSecrets_(summary);\n  error   = redactSecrets_(error);\n', ''),
  })],
  ['the System Log buffer stops masking', FIX, b => ({
    'VERALog.js': swap(b['VERALog.js'], '    redactSecrets_(summary) || \'\',', '    summary  || \'\','),
  })],
  ['API health keeps the raw error', FIX, b => ({
    'ApiHealth.js': swap(b['ApiHealth.js'], '  detail = redactSecrets_(detail);   // VERALog.js\n', ''),
  })],
  ['the scrub runs every night', FIX, b => ({
    'VERALog.js': swap(b['VERALog.js'], '  if (props.getProperty(SECRETS_SCRUBBED_PROPERTY_)) return -1;\n', ''),
  })],

  // ---- the nightly run -------------------------------------------------------
  ['writeSummarySnapshot goes back into the first half', FIX, b => ({
    'Code.js': swap(b['Code.js'], "    // Step 0 (writeSummarySnapshot) moved to the second half",
                                  "    nightlyStep_(ctx, 'writeSummarySnapshot', writeSummarySnapshot);\n    // Step 0 (writeSummarySnapshot) moved to the second half"),
  })],
  ['the slowest steps go back into the duration slot', FIX, b => ({
    'Code.js': swap(b['Code.js'], "          (stepFailures.length ? ' · ' + stepFailures.length + ' step warning(s)' : '') +\n",
                                  "          (stepFailures.length ? ' · ' + stepFailures.length + ' step warning(s)' : ''),\n"),
  })],

  // ---- the flight poll -------------------------------------------------------
  ['the gap ignores the setting', FIX, b => ({
    'FlightStatus.js': swap(b['FlightStatus.js'], "  var n = parseInt(String((cfg || {})['flight_status_poll_minutes'] || '').trim(), 10);", '  var n = 15;'),
  })],
  ['a value below 15 is honoured', FIX, b => ({
    'FlightStatus.js': swap(b['FlightStatus.js'], 'return isFinite(n) && n >= FLIGHT_POLL_MIN_MINUTES_ ? n', 'return isFinite(n) && n > 0 ? n'),
  })],
  ['a dashboard refresh is held back by the gap', FIX, b => ({
    'FlightStatus.js': swap(b['FlightStatus.js'], '  if (!forceRefresh) {\n    var _gapMin', '  if (true) {\n    var _gapMin'),
  })],
  ['no slack for trigger drift: a 15-min gap skips every other run', FIX, b => ({
    'FlightStatus.js': swap(b['FlightStatus.js'], 'return nowMs - lastMs >= (gapMin - 1) * 60000;', 'return nowMs - lastMs >= gapMin * 60000;'),
  })],
  ['the seed overwrites a value you set', FIX, b => ({
    'FlightStatus.js': swap(b['FlightStatus.js'], "  if (!have) sheet.appendRow(['flight_status_poll_minutes', String(FLIGHT_POLL_MIN_MINUTES_)]);",
                                                  "  sheet.appendRow(['flight_status_poll_minutes', String(FLIGHT_POLL_MIN_MINUTES_)]);"),
  })],
  ['the modal loses the setting', FIX, b => ({
    'docs/app.js': swap(b['docs/app.js'], "'home_country','flight_status_poll_minutes',", "'home_country',"),
  })],

  // ---- the watchdog's incidents ----------------------------------------------
  ['a restore is never logged', FLAGS, b => ({
    'Watchdog.js': swap(b['Watchdog.js'], "    if (rowOf(restoredKey) === -1) {", '    if (false) {'),
  })],
  ['the restore is logged on every good run, not just the first', FLAGS, b => ({
    'Watchdog.js': swap(b['Watchdog.js'], '    delete incidents[job];\n', ''),
  })],
  ['a new failure reuses the old incident’s row', FLAGS, b => ({
    'Watchdog.js': swap(b['Watchdog.js'], "      while (rowOf(key) !== -1) key = base + '-' + (++n);\n", ''),
  })],
  ['incident keys go back to one key per job', FLAGS, b => ({
    'Watchdog.js': swap(b['Watchdog.js'], "+ '__' + Utilities.formatDate(now, tz, 'yyyyMMddHHmm');", ';'),
  })],
  ['the flag already on the sheet is not adopted', FLAGS, b => ({
    'Watchdog.js': swap(b['Watchdog.js'], '    if (i !== -1 && !isResolved(i)) {\n      var opened', '    if (false) {\n      var opened'),
  })],
  ['a restore leaves the failure flag open', FLAGS, b => ({
    'Watchdog.js': swap(b['Watchdog.js'], "    if (i !== -1 && !isResolved(i)) sheet.getRange(i + 2, 9).setValue('Yes');\n    var hb", '    var hb'),
  })],
  ['a restore writes no System Log row', FLAGS, b => ({
    'Watchdog.js': swap(b['Watchdog.js'], "      try { veraLog_('watchdog', 'System', 'Success', text); } catch (e) {}\n", ''),
  })],
];

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0], test = c[1];
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[2](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });
  // Files the tests read that no control touches.
  ['README.md', 'Code.js'].forEach(f => { if (!files[f]) fs.writeFileSync(path.join(OUT, f), fs.readFileSync(path.join(SRC_DIR, f), 'utf8')); });

  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
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
