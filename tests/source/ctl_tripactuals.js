// Negative controls for what trips actually cost (TripActuals.js): revert ONE
// rule at a time and confirm test_tripactuals.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tactuals');

const FILES = ['Trips.js', 'TripActuals.js', 'WebApp.js', 'EmailParser.js', 'Reminders.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const T = 'TripActuals.js', P = 'EmailParser.js', R = 'Reminders.js', W = 'WebApp.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [L]: swap(b[L], from, to) });
const TEST = 'test_tripactuals.js';

const CONTROLS = [
  ['another trip\'s rows count', b => ({ [T]: swap(b[T], "var mine = key ? keys.indexOf(key) !== -1 : (date && date >= trip.startDate && date <= trip.endDate);", "var mine = key ? true : (date && date >= trip.startDate && date <= trip.endDate);") })],
  ['keyless rows outside the dates count', b => ({ [T]: swap(b[T], ": (date && date >= trip.startDate && date <= trip.endDate);", ": !!date;") })],
  ['a booking\'s key is ignored', b => ({ [T]: swap(b[T], "  if (key) {\n    var named", "  if (false) {\n    var named") })],
  ['an archived trip takes bookings', b => ({ [T]: swap(b[T], "return tripIsLive_(t) && t.startDate && t.endDate && date >= t.startDate", "return t.startDate && t.endDate && date >= t.startDate") })],
  ['the parser no longer updates the trip', b => ({ [P]: swap(b[P], "  if (metadata.totalPaid != null && metadata.totalPaid !== '') tripActualsOnBooking_(basic.date || '', '');\n", "") })],
  ['opening the Budget doesn\'t re-total', b => ({ [W]: swap(b[W], "  tripActualsOnView_(tripKey, p.tripId);\n", "") })],
  ['a failure escapes into the parser', b => ({ [T]: swap(b[T], "  } catch (e) { Logger.log('trip actuals: booking update skipped: ' + e.message); }", "  } finally {}") })],
  ['a timer comes back', b => ({ [R]: swap(b[R], "function hourlyCheck() {\n", "function hourlyCheck() {\n  syncTripActualsFor_([]);\n") })],
  ['a round trip is counted twice', b => ({ [T]: swap(b[T], "    if (seen[key]) return; seen[key] = 1;\n", "") })],
  ['a comma stops an amount', b => ({ [T]: swap(b[T], ": Number(String(m.totalPaid == null ? '' : m.totalPaid).replace(/[^0-9.]/g, '') || NaN);", ": Number(m.totalPaid);") })],
  ['another currency is added as dollars', b => ({ [T]: swap(b[T], "    if (cur && cur !== 'USD') { c.other++; return; }\n", "") })],
  ['a typed Actual is overwritten', b => ({ [T]: swap(b[T], "    if (!blank && !mine) return;\n", "") })],
  ['VERA stops keeping its own Actual current', b => ({ [T]: swap(b[T], "var mine = String(line.notes || '').indexOf(TRIP_ACTUALS_NOTE_) === 0;", "var mine = false;") })],
  ['a missing category gets no line', b => ({ [T]: swap(b[T], "    if (!line) { writes.push({ kind: 'add', category: cat, label: c.label, actual: c.total, notes: notes }); return; }", "    if (!line) return;") })],
  ['nothing in dollars still adds a line', b => ({ [T]: swap(b[T], "    if (!c.count) return;\n    var notes", "    var notes") })],
  ['a resolved WILLA reminder is rewritten', b => ({ [T]: swap(b[T], "if (!want[k] || String(r[8] || '').toLowerCase() === 'yes' || String(r[4]) === want[k]) return;", "if (!want[k] || String(r[4]) === want[k]) return;") })],
  ['the WILLA reminder is not refreshed', b => ({ [T]: swap(b[T], "    tripActualsRefreshWilla_(ss, found);\n", "") })],
  ['the parser stops asking for the total', b => ({ [P]: swap(b[P], "    '  \"totalPaid\": \"number or null: the total charged", "    '  \"totalPaidX\": \"number or null: the total charged") })],
  ['the log names trips', b => ({ [T]: swap(b[T], "Logger.log('trip actuals: ' + found.length + ' trip(s) with paid bookings, '", "Logger.log('trip actuals: ' + found.map(function(x) { return x.trip.label; }).join() + ' trip(s) with paid bookings, '") })],
];

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
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
  const r = cp.spawnSync('node', [TEST], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + TEST + ')');
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
