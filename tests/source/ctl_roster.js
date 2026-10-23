// Negative controls for the Home roster ("Your assistants"): revert ONE rule at a
// time and confirm test_roster.js catches it. Node only, like every control.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_rost');

const FILES = ['WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const W = 'WebApp.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const TEST = 'test_roster.js';

const CONTROLS = [
  ['a blank id still builds a link', b => ({ [W]: swap(b[W], "return /^[A-Za-z0-9_-]{20,}$/.test(id) ? 'https", "return true ? 'https") })],
  ['the id is not trimmed', b => ({ [W]: swap(b[W], "id = String(id || '').trim();", "id = String(id || '');") })],
  ['WILLA links to the job agent sheet', b => ({ [W]: swap(b[W], 'WILLA: url((cfg || {}).planner_sheet_id)', 'WILLA: url((cfg || {}).career_alert_sheet_id)') })],
  ['status drops rosterLinks', b => ({ [W]: swap(b[W], '    rosterLinks:  rosterLinks_(featureCfg),\n', '') })],
  ['lite is missing ARIA', b => ({ [L]: swap(b[L], "  {name:'ARIA',", "  {nome:'ARIA',") })],
  ['HAILEY shows as live', b => { const f = s => swap(s, "Yours',purpose:'Searches Zillow against your buy box and flags new listings and price drops',state:'planned'", "Yours',purpose:'Searches Zillow against your buy box and flags new listings and price drops',state:'live'"); return { [A]: f(b[A]), [L]: f(b[L]) }; }],
  ['links hand over the opener', b => { const f = s => swap(s, "target:'_blank',rel:'noopener'", "target:'_blank'"); return { [A]: f(b[A]), [L]: f(b[L]) }; }],
  ['a sheet id is written into the roster', b => { const f = s => swap(s, "link:'WILLA',", "link:'WILLA',id:'InventedPlannerId_0123456789abcdefgh',"); return { [A]: f(b[A]), [L]: f(b[L]) }; }],
  ['Home stops rendering the roster', b => ({ [A]: swap(b[A], '/*#__PURE__*/React.createElement(VeraRoster,{links:status&&status.rosterLinks,veraHref:window.location.origin+window.location.pathname}),', '') })],
  ['lite’s VERA links back to itself', b => ({ [L]: swap(b[L], 'veraHref="./"', 'veraHref=""') })],
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
