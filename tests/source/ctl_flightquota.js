// Negative controls for test_flightquota.js: undo ONE of the quota rules and confirm the
// test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_fq');
const FILES = ['FlightStatus.js', 'WebApp.js', 'Features.js', 'docs/app.js', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const T = 'test_flightquota.js';
const CONTROLS = [
  ["the Itinerary try isn't remembered", "FlightStatus.js", "      meta.flight_attempt_at = now;\n", ""],
  ["the calendar try isn't remembered", "FlightStatus.js", "        entry.attemptAt = now; entry.flightNum = f.num;", "        entry.flightNum = f.num;"],
  ["spacing reads the last good answer only (Itinerary)", "FlightStatus.js", "var lastTry = flightLastTry_(prev, meta.flight_attempt_at);", "var lastTry = flightLastTry_(prev, 0);"],
  ["spacing reads the last good answer only (calendar)", "FlightStatus.js", "var lastTry = flightLastTry_(prev, entry.attemptAt);", "var lastTry = flightLastTry_(prev, 0);"],
  ["a failed Itinerary try is written only when there was a status", "FlightStatus.js", "        if (meta.flight_status) stampFlightFetchFailure_(meta.flight_status);\n        // Written either way", "        if (!meta.flight_status) return;\n        stampFlightFetchFailure_(meta.flight_status);\n        // Written either way"],
  ["\u21ba ignores the backoff again", "FlightStatus.js", "  if (isAviationStackRateLimited_()) {", "  if (!forceRefresh && isAviationStackRateLimited_()) {"],
  ["\u21ba has no 10-minute floor (Itinerary)", "FlightStatus.js", "      if (forceRefresh && (now - lastTry) < FLIGHT_FORCE_FLOOR_MIN_ * 60000) { skipped++; recent++; return; }\n\n      Logger.log('FlightStatus: checking ' + f.num", "\n      Logger.log('FlightStatus: checking ' + f.num"],
  ["\u21ba has no 10-minute floor (calendar)", "FlightStatus.js", "      if (forceRefresh && (now - lastTry) < FLIGHT_FORCE_FLOOR_MIN_ * 60000) { skipped++; recent++; return; }\n\n      Logger.log('FlightStatus: checking calendar", "\n      Logger.log('FlightStatus: checking calendar"],
  ["calls aren't counted", "FlightStatus.js", "    try { asCountCall_(asBudget_(getConfigValues())); } catch (cntErr) {}", ""],
  ["the budget is ignored", "FlightStatus.js", "  if (used >= budget) {", "  if (false) {"],
  ["the count never resets for a new month", "FlightStatus.js", "return m && m[1] === month ? parseInt(m[2], 10) : 0;", "return m ? parseInt(m[2], 10) : 0;"],
  ["the budget setting is ignored", "FlightStatus.js", "  return n > 0 ? n : AS_BUDGET_DEFAULT_;", "  return AS_BUDGET_DEFAULT_;"],
  ["no 80% warning", "FlightStatus.js", "if (n === b || n === Math.ceil(b * 0.8)) {", "if (n === b) {"],
  ["the route doesn't say why", "WebApp.js", "result.skippedWhy = ran.budget ? 'budget' : ran.paused ? 'paused' :", "result.skippedWhy = ran.paused ? 'paused' :"],
  ["the \u21ba note isn't shown", "docs/app.js", "setFlightNote(flightSkipNote(r));", ""],
  ["Feature Flags hides the count", "Features.js", "usage: featureUsage_(f, cfg),", ""],
  ["the debug scan tests every flight", "FlightStatus.js", "      if (tested >= 1) break;", ""],
].map(c => [c[0], b => ({ [c[1]]: swap(b[c[1]], c[2], c[3]) }), T]);

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0], test = c[2];
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
  const env = Object.assign({}, process.env, { VERA_ROOT: OUT });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env });
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
