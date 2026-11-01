// Negative controls for the past trips picker (#219): revert ONE rule at a time
// and confirm test_pasttrips.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_pt');

const W = 'WebApp.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const FILES = [W, A, L];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const TEST = 'test_pasttrips.js';

const CONTROLS = [
  ['upcoming trips are listed as past', b => ({ [W]: swap(b[W],
    "    return t.startDate && (t.endDate || t.startDate) < today;", "    return t.startDate;") })],
  ['old trip names are not folded onto the current one', b => ({ [W]: swap(b[W],
    "    var key = tripKeyForWrite_(rawKey);\n    if (!key || key.indexOf('|') === -1) return;",
    "    var key = rawKey;\n    if (!key || key.indexOf('|') === -1) return;") })],
  ['the Itinerary sheet is not read', b => ({ [W]: swap(b[W],
    "      if (k && d) add(k, d, d);", "") })],
  ['trips with gifts are not read', b => ({ [W]: swap(b[W],
    "      if (k && d) add(k, d, '');", "") })],
  ['merged registry rows are listed', b => ({ [W]: swap(b[W],
    "      if (r.status !== 'active' || !r.startDate || !r.label) return;", "      if (!r.startDate || !r.label) return;") })],
  ['oldest first', b => ({ [W]: swap(b[W],
    "return a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0;", "return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;") })],
  ['the route is missing', b => ({ [W]: swap(b[W], "case 'past_trips':", "case 'past_trips_x':") })],
  ['the lite dashboard does not ask for past trips', b => ({ [L]: swap(b[L], "api({action:'past_trips'})", "api({action:'trips'})") })],
  ['the full dashboard has no Past group', b => ({ [A]: swap(b[A], "label:'Past'", "label:'Earlier'") })],
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
  fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true });
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
