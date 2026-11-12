// Negative controls for ARIA's hotel stays (issue #238): revert ONE rule at a time
// and confirm test_ariastays.js (or, for the screen, test_tripaira_ui.js) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_ariastays');

const FILES = ['Trips.js', 'Aria.js', 'Code.js', 'Reminders.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const T = 'Aria.js', K = 'Code.js', R = 'Reminders.js', W = 'WebApp.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [L]: swap(b[L], from, to) });
const TEST = 'test_ariastays.js', UI = 'test_tripaira_ui.js';

const CONTROLS = [
  ['the requests tab is never widened', b => ({ [T]: swap(b[T], "  if (sh && sh.getMaxColumns && sh.getMaxColumns() < ARIA_REQUESTS_HEADERS.length) sh.insertColumnsAfter(", "  if (false) sh.insertColumnsAfter(") })],
  ['Place is not written', b => ({ [T]: swap(b[T], "v(r.place), ", "'', ") })],
  ['a stay with no place is accepted', b => ({ [T]: swap(b[T], "  if (!place) return { error: 'Where should ARIA look? Add a city or area.' };\n", "") })],
  ['checkout is the check-in day', b => ({ [T]: swap(b[T], "latest: ariaPlusDays_(checkIn, nights),", "latest: checkIn,") })],
  ['asking again adds a second stay', b => ({ [T]: swap(b[T], "    all.forEach(function(r, i) { if (at === -1 && r.kind === 'stay' && r.ref === req.ref) at = i; });\n", "") })],
  ['stopping the flights stops the stays too', b => ({ [T]: swap(b[T], "(r.kind !== 'stay' && String(r.tripId).toUpperCase() === tid)", "(String(r.tripId).toUpperCase() === tid)") })],
  ['part of the nights booked counts as booked', b => ({ [T]: swap(b[T], "return c.total > 0 && c.have === c.total;", "return c.have > 0;") })],
  ['booked stays are never marked', b => ({ [T]: swap(b[T], "  try { ariaMarkStaysBooked_(); }", "  try { }") })],
  ['flight fares count as hotel prices', b => ({ [T]: swap(b[T], " && /^hotel:/i.test(String(f.route || ''))", "") })],
  ['Book this stay is never posted', b => ({ [T]: swap(b[T], "w.actionType === 'BOOK_NOW' || w.actionType === 'BOOK_STAY'", "w.actionType === 'BOOK_NOW'") })],
  ['the flight request can pick a stay', b => ({ [T]: swap(b[T], "r.status === 'active' && r.kind !== 'stay' &&", "r.status === 'active' &&") })],
  ['the route is not wired', b => ({ [W]: swap(b[W], "case 'aria_request_stay':", "case 'aria_request_stay_off':") })],
  ['one request per night, not per run', both("if(r&&tsAddDays_(r.to,1)===d){r.to=d;r.nights++;}else ", "")],
  ['the lite card drifts from the full one', b => ({ [L]: swap(b[L], "'🏨 Watch this stay'", "'🏨 Watch stay'") })],
  ['a stay is stopped by its trip', both("{action:'aria_request_withdraw',ref:s.ref}", "{action:'aria_request_withdraw',tripId:d.tripId}"), UI],
  ['the form starts blank, not from the run', both("checkIn:r.from,nights:r.nights,", "checkIn:'',nights:'',"), UI],
  ['the watched stay hides its price', both("'Best seen: '+money(p.total)", "'Seen: '+money(p.total)"), UI],

];

// Screen controls (third field) run test_tripaira_ui.js and need a browser.
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
  const r = cp.spawnSync('node', [c[2] || TEST], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
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
