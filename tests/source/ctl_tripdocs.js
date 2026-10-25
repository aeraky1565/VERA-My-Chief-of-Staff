// Negative controls for the trip documents check (WebApp.js, itinerary redesign
// stage 3): revert ONE rule at a time and confirm test_tripdocs.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tdocs');

const FILES = ['WebApp.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const W = 'WebApp.js';
const TEST = 'test_tripdocs.js';

const CONTROLS = [
  ['the home country is listed too', b => ({ [W]: swap(b[W], '    if (aliasN === homeN || n === homeN) return;\n', '') })],
  ['a connecting airport counts as a stay', b => ({ [W]: swap(b[W], "add(airportCountry(code), end ? 'stay' : 'layover', it.date, end ? '' : code);", "add(airportCountry(code), 'stay', it.date, end ? '' : code);") })],
  ['a layover wins over a stay', b => ({ [W]: swap(b[W], "    if (role === 'stay') c.role = 'stay';\n", '') })],
  ['the metadata route is ignored', b => ({ [W]: swap(b[W], '  if (o && route[0] !== o) route.unshift(o);\n', '') })],
  ['addresses are not read for countries', b => ({ [W]: swap(b[W], "    var named = tripAddressCountry_(it.location, countryNames);", "    var named = '';") })],
  ['a bare place is never looked up', b => ({ [W]: swap(b[W], "    if (!named && placeCountry && String(it.location || '').trim()) named = placeCountry(String(it.location).trim()) || '';\n", '') })],
  ['any geocoder answer is believed', b => ({ [W]: swap(b[W], "  return norm(loc).indexOf(norm(n)) !== -1;", "  return true;") })],
  ['calendar events are not read', b => ({ [W]: swap(b[W], "    if (merged && merged.items) items = merged.items.map(", "    if (false) items = merged.items.map(") })],
  ['the matrix\'s words are not understood', b => ({ [W]: swap(b[W], "    'eta': 'eta', 'e-visa': 'evisa', 'evisa': 'evisa', 'vf': 'vf', 'visa free': 'vf', 'cb': 'cb' }[s] || '';", "    'eta': 'eta', 'vf': 'vf', 'cb': 'cb' }[s] || '';").replace("{ 'vr': 'vr', 'visa required': 'vr', 'no admission': 'na', 'voa': 'voa', 'visa on arrival': 'voa',", "{ 'vr': 'vr', 'voa': 'voa',") })],
  ['visa required is amber', b => ({ [W]: swap(b[W], "  if (k === 'vr' || k === 'na') return 'red';", "  if (k === 'vr' || k === 'na') return 'yellow';") })],
  ['every country asks for 6 months', b => ({ [W]: swap(b[W], 'var ruleMonths = ruleKnown ? 3 : 6;', 'var ruleMonths = 6;') })],
  ['an expired passport only counts as short', b => ({ [W]: swap(b[W], "if (!tripEnd || expiry < tripEnd) return { status: 'expires'", "if (false) return { status: 'expires'") })],
  ['a partial month counts as a full one', b => ({ [W]: swap(b[W], " - (b[2] < a[2] ? 1 : 0);", ";") })],
  ['another trip\'s rows are read', b => ({ [W]: swap(b[W], "      if (String(r[1]).trim() !== tripKey) return;\n      items.push({ type:", "      items.push({ type:") })],
  ['a country\'s chip ignores the passport', b => ({ [W]: swap(b[W], "      [v, pp].forEach(function(x) { if (rank[x] > rank[worst]) worst = x; });", "      [v].forEach(function(x) { if (rank[x] > rank[worst]) worst = x; });") })],
  ['an airport is looked up every time', b => ({ [W]: swap(b[W], '    if (memo[code] !== undefined) return memo[code];\n', '') })],
  ['the matrix is cached in one piece again', b => ({ [W]: swap(b[W], "try { cachePutChunked_(cache, 'passport_index_csv', csv, 21600); }", "try { cache.put('passport_index_csv', csv, 21600); }") })],
  ['a missing piece reads as half a matrix', b => ({ [W]: swap(b[W], "if (got[keys[j]] == null) return null; out += got[keys[j]];", "out += got[keys[j]] || '';") })],
  ['the forecast is asked per day', b => ({ [W]: swap(b[W], "var fc = tripDailyForecast_(city, ds[0], to) || [];", "var fc = [].concat.apply([], ds.map(function(d) { return tripDailyForecast_(city, d, d) || []; }));") })],
  ['home is forecast', b => ({ [W]: swap(b[W], "|| c === 'Home' || c === 'At sea') return;", ") return;") })],
  ['the route is missing', b => ({ [W]: swap(b[W], "      case 'trip_documents':        return jsonOut_(webGetTripDocuments_(e.parameter));\n", '') })],
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
