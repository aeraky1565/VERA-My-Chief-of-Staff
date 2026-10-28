// Negative controls for flight times in their airports' zones: revert ONE rule
// at a time and confirm test_airporttz.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_atz');

const FILES = ['WebApp.js', 'TravelDayBriefing.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const W = 'WebApp.js', T = 'TravelDayBriefing.js';
const TEST = 'test_airporttz.js';

const CONTROLS = [
  ['the itinerary keeps the zone the event was saved in (the reported bug)', b => ({ [W]: swap(b[W],
    "              if (!skipEventTz && evMeta.origin && typeof airportTz_ === 'function') {",
    "              if (false) {") })],
  ['the zones change but the clock times are not re-read', b => ({ [W]: swap(b[W],
    "                  evTime = Utilities.formatDate(evStart, evStartTz, 'HH:mm');\n                  evEnd  = Utilities.formatDate(ev.getEndTime(), evEndTz, 'HH:mm');\n",
    "") })],
  ['the metadata keeps the saved zone', b => ({ [W]: swap(b[W],
    "                  evMeta.startTz = evStartTz;\n", "") })],
  ['the lookup runs even when the timezone pass is skipped', b => ({ [W]: swap(b[W],
    "              if (!skipEventTz && evMeta.origin && typeof airportTz_ === 'function') {",
    "              if (evMeta.origin && typeof airportTz_ === 'function') {") })],
  ['the insights trust the event zones first', b => ({ [T]: swap(b[T],
    "    var originTz = airportTz_(origin) || meta.startTz || (originGeo && originGeo.timezone) || '';\n    var destTz   = airportTz_(dest)   || meta.endTz   || meta.startTz || (destGeo && destGeo.timezone) || '';",
    "    var originTz = meta.startTz || airportTz_(origin) || '';\n    var destTz   = meta.endTz   || meta.startTz || airportTz_(dest) || '';") })],
  ['AirportGap\'s zone is ignored', b => ({ [T]: swap(b[T],
    "      if (/^[A-Za-z_]+\\/[A-Za-z_\\/+-]+$/.test(String(a.timezone || ''))) tzName = String(a.timezone);\n", "") })],
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
