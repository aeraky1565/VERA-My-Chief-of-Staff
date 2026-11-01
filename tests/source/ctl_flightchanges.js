// Negative controls for changed flights: revert ONE rule at a time and confirm a
// test catches it. Screen controls (third field) need a browser.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_fc');

const FILES = ['WebApp.js', 'Code.js', 'Trips.js', 'docs/app.js', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const W = 'WebApp.js', A = 'docs/app.js', I = 'docs/index.html';
const web = (from, to) => b => ({ [W]: swap(b[W], from, to) });
const ui = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });
const TEST = 'test_flightchanges.js', UI = 'test_flightchange_ui.js';

const CONTROLS = [
  ['a round trip\'s two legs pair (route ignored)', web("        if (route !== croute) return;\n", "")],
  ['any booking on the same route pairs', web("        if (conf && cconf) ok = conf === cconf;", "        if (conf && cconf) ok = true;")],
  ['the 3-day window widened', web("        else ok = gap <= 3;", "        else ok = gap <= 30;")],
  ['the stale row stays on the itinerary', web("      items.push.apply(items, recon.stored);",
    "      items.push.apply(items, recon.stored.concat(recon.changed.map(function(c) { return c.row; })));")],
  ['one calendar flight replaces two rows', web("    if (rowTaken[p.ri] || calTaken[p.ci]) return;", "    if (rowTaken[p.ri]) return;")],
  ['rows taken in sheet order, not nearest first', web("  pairs.sort(function(x, y) { return x.gap - y.gap || x.ri - y.ri; });\n", "")],
  ['the flag is keyed by title, not the row', web("    wanted[FLIGHT_CHANGE_FLAG_PREFIX_ + c.row.id] = {", "    wanted[FLIGHT_CHANGE_FLAG_PREFIX_ + c.row.title] = {")],
  ['"Confirmation number:" reads as "number" again', web(
    "                .match(/conf(?:irmation)?(?:\\s*(?:number|no\\.?|code))?[#:\\s]+([A-Z0-9]{5,8})\\b/i);",
    "                .match(/conf(?:irmation)?[#:\\s]+([A-Z0-9]{5,8})\\b/i);")],
  ['Update drops the row\'s own details', ui("var meta=cfMeta(c.row.metadata),cal=cfMeta(c.by.metadata);", "var meta={},cal=cfMeta(c.by.metadata);"), UI],
  ['Update keeps the old date', ui("id:c.row.id,date:c.by.date,", "id:c.row.id,date:c.row.date,"), UI],
];

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
  const r = cp.spawnSync('node', [c[2] || TEST], { cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
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
