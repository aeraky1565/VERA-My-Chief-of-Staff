// Negative controls for folding a stale copy of a trip into the live one
// (Trips.js tripShadowMerges_ / mergeShadowTrips_): revert ONE rule at a time and
// confirm test_tripregistry.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tshadow');

const FILES = ['Trips.js', 'PTO.js', 'Code.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const T = 'Trips.js';
const TEST = 'test_tripregistry.js';

const CONTROLS = [
  ['a different label is folded too', b => ({ [T]: swap(b[T], "normaliseTripLabel_(o.label) === normaliseTripLabel_(rec.label)\n        && ", "") })],
  ['a trip with no event ids is folded', b => ({ [T]: swap(b[T], "if (!rec.eventIds || !rec.eventIds.length || gone[rec.tripId]) return;", "if (gone[rec.tripId]) return;") })],
  ['the newer copy is folded into the older', b => ({ [T]: swap(b[T], "String(o.lastSeen) > String(rec.lastSeen)", "String(o.lastSeen) >= String(rec.lastSeen)") })],
  ['some shared events are enough', b => ({ [T]: swap(b[T], "rec.eventIds.every(function(e)", "rec.eventIds.some(function(e)") })],
  ['a merged trip still counts as live', b => ({ [T]: swap(b[T], "return st !== 'archived' && st.indexOf('merged:') !== 0;", "return st !== 'archived';") })],
  ['the sync never folds', b => ({ [T]: swap(b[T], "    try { mergeShadowTrips_(); } catch (e5)", "    try { } catch (e5)") })],
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
  const test = c[2] || TEST;
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
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
