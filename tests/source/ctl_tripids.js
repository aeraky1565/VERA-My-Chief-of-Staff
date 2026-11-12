// Negative controls for issue #239 phase 1 (Trip ID columns): revert ONE rule at a
// time and confirm test_tripids.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tid');

const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const in_ = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const TEST = 'test_tripids.js';

const CONTROLS = [
  ['a writer writes a row one cell short', in_('WebApp.js', "    newId, tripKey, rec.type, rec.title, rec.date, '', '', rec.address || '', rec.description, metadata, (typeof tripIdCell_ === 'function' ? tripIdCell_(tripKey) : ''),", "    newId, tripKey, rec.type, rec.title, rec.date, '', '', rec.address || '', rec.description, metadata,")],
  ['a tab loses its Trip ID column', in_('Code.js', "const TRIP_OUTFIT_HEADERS      = ['Trip Key', 'Plan JSON', 'Updated', 'Trip ID'];", "const TRIP_OUTFIT_HEADERS      = ['Trip Key', 'Plan JSON', 'Updated'];")],
  ['the fill overwrites an existing ID', in_('TripIds.js', "    if (!id) { if (want) { filled++; return [want]; } return ['']; }", "    if (want) { filled++; return [want]; }")],
  ['the fill writes a moved column', in_('TripIds.js', "    if (head && head !== 'Trip ID') {", "    if (false) {")],
  ['the fill writes when nothing changed', in_('TripIds.js', "    if (r.filled) sh.getRange(2, width, r.ids.length, 1).setValues(r.ids);", "    sh.getRange(2, width, r.ids.length, 1).setValues(r.ids);")],
  ['the nightly run stops filling', in_('Code.js', "    nightlyStep_(ctx, 'tripIdStampAll_', tripIdStampAll_);\n", "")],
  ['tripIdCell_ can throw', in_('Trips.js', "  try { return tripIdForKey_(tripKey) || ''; } catch (e) { return ''; }", "  return tripIdForKey_(tripKey) || '';")],
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
