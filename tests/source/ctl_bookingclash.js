// Negative controls for issue #221 (same-slot bookings are one choice): revert
// ONE rule at a time and confirm test_bookingclash.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_bkc');

const FILES = ['TripDecisions.js', 'docs/app.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const T = 'TripDecisions.js', A = 'docs/app.js';
const TEST = 'test_bookingclash.js';

const CONTROLS = [
  ['bookings never compete again (the reported bug)', b => ({ [T]: swap(b[T],
    "      if (span) { it._booked = true; it._span = span; candidates.push(it); }", "") })],
  ['a booking competes with anything on the same day', b => ({ [T]: swap(b[T],
    "        if (si && sj && si[0] < sj[1] && sj[0] < si[1]) union(i, j);", "        union(i, j);") })],
  ['a lone booking becomes a group of one', b => ({ [T]: swap(b[T],
    "    if (groups[root].length === 1 && groups[root][0]._booked) return;\n", "") })],
  ['long spans (a port day) take part', b => ({ [T]: swap(b[T],
    "  if (end - start > TD_CLASH_MAX_MINS_) return null;\n", "") })],
  ['flights and stays take part', b => ({ [T]: swap(b[T],
    "  if (TD_NEVER_CLASH_TYPES_[String(it.type || '').toLowerCase()]) return null;\n", "") })],
  ['the suggestion is shown first over the booking', b => ({ [T]: swap(b[T],
    "(/^ITIN-REC-/.test(String(it.id || '')) ? 1 : 0)", "(/^ITIN-REC-/.test(String(it.id || '')) ? -1 : 0)") })],
  ['bookings are marked as holds', b => ({ [T]: swap(b[T],
    "      if (span) { it._booked = true; it._span = span; candidates.push(it); }",
    "      if (span) { it._booked = true; it._span = span; meta.tentative = true; tdWriteMeta_(it, meta); candidates.push(it); }") })],
  ['the chip shows only for holds again', b => ({ [A]: swap(b[A],
    "function itinOptionsChip(item){var n=optionCountOf(item);if(!isTentativeItem(item)&&!(n>1))return null;",
    "function itinOptionsChip(item){var n=optionCountOf(item);if(!isTentativeItem(item))return null;") })],
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
    fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true });
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
