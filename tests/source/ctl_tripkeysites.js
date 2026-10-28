// Negative controls for trip identity at the read and write sites: revert ONE
// rule at a time and confirm test_tripkeysites.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tks');

const FILES = ['WebApp.js', 'TravelDayBriefing.js', 'Trips.js', 'TripDecisions.js', 'PreTripBriefing.js', 'TripShare.js', 'GenerationInputs.js', 'Chat.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const W = 'WebApp.js', T = 'TravelDayBriefing.js', R = 'Trips.js';
const TEST = 'test_tripkeysites.js';

const CONTROLS = [
  ['decisions read the raw key again', b => ({ 'TripDecisions.js': swap(b['TripDecisions.js'],
    "      if (!tripKeyMatches_(r[1], tripKey)) return;\n      out[",
    "      if (String(r[1] || '').trim() !== tripKey) return;\n      out[") })],
  ['the matcher ignores old keys', b => ({ [R]: swap(b[R],
    "  if (typeof tripKeysFor_ !== 'function') return false;\n  return tripRowMatches_(v, tripKeysFor_(k));",
    "  return false;") })],
  ['a single-row tab takes the first old-key row over the exact one', b => ({ [R]: swap(b[R],
    "    if (v === k) return i;\n", "") })],
  ['the TripMeta row keeps its old key', b => ({ [W]: swap(b[W],
    "      if (String(ids[i][0]).trim() !== key) sheet.getRange(rowNum, 1).setValue(key);\n", "") })],
  ['new rows are written under the key as given', b => ({ [R]: swap(b[R],
    "  try { return String(canonicalTripKey_(k) || k).trim(); } catch (e) { return k; }",
    "  return k;") })],
  ['the travel day guard is keyed on the name', b => ({ [T]: swap(b[T],
    "      var _sKey = _tid ? _day + _tid : _lKey;", "      var _sKey = _lKey;") })],
  ['a guard written under the name is ignored', b => ({ [T]: swap(b[T],
    "      if (!_tdbForce && (_tdbProps.getProperty(_sKey) || _tdbProps.getProperty(_lKey))) {",
    "      if (!_tdbForce && _tdbProps.getProperty(_sKey)) {") })],
  ['one read site in the itinerary reverted', b => ({ [W]: swap(b[W],
    "      if (!tripKeyMatches_(row[1], tripKey)) return; // different trip",
    "      if (String(row[1]).trim() !== tripKey) return; // different trip") })],
  ['the old-key copy wins over the current one', b => ({ [W]: swap(b[W],
    "    if (it.tripKey === tripKey && prev.it.tripKey !== tripKey) {", "    if (false) {") })],
  ['same-key copies are collapsed too', b => ({ [W]: swap(b[W],
    "    if (prev.it.tripKey === it.tripKey) { out.push(it); return; }   // same key: both stay\n", "") })],
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
  fs.mkdirSync(OUT, { recursive: true });
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });
  const r = cp.spawnSync('node', [TEST], { cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
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
