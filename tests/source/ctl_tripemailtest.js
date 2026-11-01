// Negative controls for the pre-trip and post-trip test sends: break ONE rule at
// a time and confirm test_tripemailtest.js (server) or test_tripemailtest_ui.js
// (the Test tab) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tte');

const PRE = 'PreTripBriefing.js', POST = 'PostTripCapture.js', TDB = 'TravelDayBriefing.js', A = 'docs/app.js', IX = 'docs/index.html';
const FILES = [PRE, POST, TDB, 'WebApp.js', A, IX, 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
// The Test tab is full-dashboard only; index.html carries the built copy of app.js.
const ui = (b, from, to) => ({ [A]: swap(b[A], from, to), [IX]: swap(b[IX], from, to) });
const SRV = 'test_tripemailtest.js', UI = 'test_tripemailtest_ui.js';

const CONTROLS = [
  [SRV, 'a 48h test is stopped by the latch', b => ({ [PRE]: swap(b[PRE], "if (!isTest && tripLatchSeen_('PRETRIP_48H_', trip)) {", "if (tripLatchSeen_('PRETRIP_48H_', trip)) {") })],
  [SRV, 'a night-before test sets the latch', b => ({ [PRE]: swap(b[PRE], "  if (!isTest) tripLatchMark_('PRETRIP_NB_', trip);", "  tripLatchMark_('PRETRIP_NB_', trip);") })],
  [SRV, 'the nudge test is not marked TEST', b => ({ [POST]: swap(b[POST], "var subject = '🧳 ' + trip.tripLabel + ' — Capture the Memories';\n  if (isTest) subject = 'TEST \\u00B7 ' + subject;", "var subject = '🧳 ' + trip.tripLabel + ' — Capture the Memories';") })],
  [SRV, 'the real recap skips its latch', b => ({ [POST]: swap(b[POST], "if (!isTest && tripLatchSeen_('POSTTRIP_RECAP_', trip)) {", "if (false) {") })],
  [SRV, 'the recap test does not say what it sent', b => ({ [POST]: swap(b[POST], "  return { to: [CONFIG.MORNING_NUDGE_EMAIL], subject: subject, count: rows.length };\n}", "}") })],
  [SRV, 'the night before goes to the 48h sender', b => ({ [TDB]: swap(b[TDB], "pretrip_nb: sendPreTripEmail_NightBefore_,", "pretrip_nb: sendPreTripEmail_48h_,") })],
  [SRV, 'the endpoint sends for real', b => ({ [TDB]: swap(b[TDB], "var sent = send(trip, { test: true });", "var sent = send(trip);") })],
  [SRV, 'a pre-trip test uses the real hours away', b => ({ [TDB]: swap(b[TDB], "trip.hoursUntil = real > 0 && real < k.hours ? real : k.hours;", "trip.hoursUntil = real;") })],
  [SRV, 'a past trip with no itinerary is refused', b => ({ [TDB]: swap(b[TDB], "      var past = (webListPastTrips_().trips || [])", "      var past = ([])") })],
  [SRV, 'an unknown kind is sent anyway', b => ({ [TDB]: swap(b[TDB], "  if (!k) return { ok: false, error: 'Pick which email to send.' };\n", "  if (!k) k = { when: 'pre', hours: 48, label: '?' };\n") })],
  [UI, 'the pre-trip card offers the trip under way', b => ui(b, "trips:trips?trips.filter(function(t){return !t.current;}):null", "trips:trips")],
  [UI, 'Send can be pressed twice', b => { const r = ui(b, "function send(){if(sending||!tripKey)return;", "function send(){"); r[A] = swap(r[A], "onClick:send,disabled:sending||!tripKey,", "onClick:send,disabled:!tripKey,"); r[IX] = swap(r[IX], "onClick:send,disabled:sending||!tripKey,", "onClick:send,disabled:!tripKey,"); return r; }],
  [UI, 'the email picked is not sent', b => ui(b, "props.call('test_trip_email_send',{kind:kind,tripKey:tripKey})", "props.call('test_trip_email_send',{kind:props.kinds[0][0],tripKey:tripKey})")],
  [UI, 'a failed send claims success', b => ui(b, "if(!d.ok){setErr(d.error||'That email wasn’t sent.');return;}setResult({at:", "setResult({at:")],
];

// The deploy gate runs where no browser is installed: dashboard controls are skipped
// there and say so; the full suite (which finds Chromium) runs them.
const HAVE_BROWSER = !!process.env.CHROMIUM_PATH;
let allBit = true;
CONTROLS.forEach(function(c) {
  const test = c[0], name = c[1];
  if (test === UI && !HAVE_BROWSER) { console.log('\n=== CONTROL: ' + name + '\n  skipped: no browser here (the full suite runs it)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[2](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true });
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', timeout: 600000,
    env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
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
