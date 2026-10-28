// Negative controls for Settings › Test (the travel day email on demand):
// revert ONE rule at a time and confirm a test catches it. Screen controls
// (third field) run test_testtab_ui.js and need a browser.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tdt');

const FILES = ['TravelDayBriefing.js', 'WebApp.js', 'docs/app.js', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const T = 'TravelDayBriefing.js', A = 'docs/app.js', I = 'docs/index.html';
const tdb = (from, to) => b => ({ [T]: swap(b[T], from, to) });
// The UI test loads index.html, which carries app.js inlined: patch both.
const ui = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });
const TEST = 'test_traveldaytest.js', UI = 'test_testtab_ui.js';

const CONTROLS = [
  ['the day asked about is ignored (real today used)', tdb(
    "  var dayStr    = /^\\d{4}-\\d{2}-\\d{2}$/.test(String(opts.date || ''))\n    ? String(opts.date) : Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');",
    "  var dayStr    = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');")],
  ['the return-day check reads an undefined today again (the found bug)', tdb(
    "      isReturnDay = (_lastDay !== '' && _lastDay === dayStr);",
    "      isReturnDay = (_lastDay !== '' && _lastDay === today);")],
  ['the return day is the last row added', tdb(
    "      var _lastDay = String(opts.lastDay || '');\n      if (!_lastDay) {",
    "      var _lastDay = '';\n      if (!_lastDay) {")],
  ['a test is not marked TEST', tdb("  var subject    = (isTest ? 'TEST \\u00B7 ' : '') +", "  var subject    = '' +")],
  ['"just me" sends to everyone', tdb("  var recipients = (isTest && opts.to !== 'all')", "  var recipients = (false)")],
  ['a test follows the Slack channel', tdb("  var travelCh = isTest ? 'email' : getNotifChannel_('travel_day_briefing');", "  var travelCh = getNotifChannel_('travel_day_briefing');")],
  ['a test is blocked when the briefing is off', tdb("  if (!isTest && !isNotifEnabled_('travel_day_briefing')) {", "  if (!isNotifEnabled_('travel_day_briefing')) {")],
  ['a test writes the once-a-day latch', tdb(
    "  var sent = sendTravelDayBriefing_(tripKey, rows, { date: date, lastDay: r.max, test: true, to: to });",
    "  var sent = sendTravelDayBriefing_(tripKey, rows, { date: date, lastDay: r.max, test: true, to: to });\n  PropertiesService.getScriptProperties().setProperty('TDB_SENT_TEST', '1');")],
  ['a test reads only the sheet', tdb("  var rows = fetchTripDayItems_(tripKey, r.min, r.max, date) || [];", "  var rows = [];")],
  ['every item is called sheet', tdb("      source: it.source === 'calendar' ? 'calendar' : 'sheet',", "      source: 'sheet',")],
  ['the trip range is the sheet\'s alone', tdb("    if (end > ranges[key].max) ranges[key].max = end;\n", "")],
  ['a renamed trip\'s old rows make a trip of their own', tdb(
    "    var tripKey = travelTripKey_(row[1]);\n    if (!tripKey) return;\n    var rowDate",
    "    var tripKey = String(row[1] || '').trim();\n    if (!tripKey) return;\n    var rowDate")],
  ['the morning run groups today\'s rows under the old key', tdb(
    "    var tripKey = travelTripKey_(row[1]);   // the same key travelDayRanges_ used",
    "    var tripKey = String(row[1] || '').trim();")],
  ['two trips with one name collapse into one', tdb(
    "      if (p.label !== label || p.end < t.start || t.end < p.start) continue;",
    "      if (p.label !== label) continue;")],
  ['past trips are offered', tdb("    if (r.max < today) return;\n", "")],
  ['the preview tags every item sheet', ui('className:"test-src","data-src":it.source,', 'className:"test-src","data-src":"sheet",'), UI],
  ['the send button is not held while sending', ui('className:"test-send",onClick:send,disabled:sending,', 'className:"test-send",onClick:send,disabled:false,'), UI],
  ['"Everyone on the trip" is not sent', ui("call('test_travel_send',{tripKey:tripKey,date:day,to:to})", "call('test_travel_send',{tripKey:tripKey,date:day,to:'me'})"), UI],
  ['the panel opens on the first trip, not the one on now', ui("var first=(d.trips||[]).filter(function(t){return t.current;})[0]||(d.trips||[])[0];", "var first=(d.trips||[])[1]||(d.trips||[])[0];"), UI],
  ['an error is swallowed', ui("if(!d.ok){setErr(d.error||'The email was not sent.');return;}", "if(!d.ok){return;}"), UI],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[1](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });
  const r = cp.spawnSync('node', [c[2] || TEST], { cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + (c[2] || TEST) + ')');
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
