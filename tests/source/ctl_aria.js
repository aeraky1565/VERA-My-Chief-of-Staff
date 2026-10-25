// Negative controls for ARIA, read by VERA (Aria.js and the shared AriaView
// block): revert ONE rule at a time and confirm test_aria.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_aria');

const FILES = ['Aria.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const T = 'Aria.js', W = 'WebApp.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [L]: swap(b[L], from, to) });
const TEST = 'test_aria.js';

const CONTROLS = [
  ['headers are read by position', b => ({ [T]: swap(b[T], "var i = map[ariaKey_(fields[f])], v = i == null ? '' : row[i];", "var i = Object.keys(fields).indexOf(f), v = row[i];") })],
  ['a bracketed note hides a header', b => ({ [T]: swap(b[T], "var k = ariaKey_(String(h == null ? '' : h).replace(/\\([^)]*\\)/g, ''));", "var k = ariaKey_(h);") })],
  ['a blank figure reads as zero', b => ({ [T]: swap(b[T], "if (v === '' || v == null) return null;\n  var n = typeof v", "if (v === '' || v == null) return 0;\n  var n = typeof v") })],
  ['any link is kept', b => ({ [T]: swap(b[T], "return /^https:\\/\\/[^\\s\"'<>]+$/i.test(s) ? s.slice(0, 600) : '';", "return s;") })],
  ['IDs keep their case', b => ({ [T]: swap(b[T], "    out.tripId = out.tripId.toUpperCase();\n    out.ref = out.ref.toUpperCase();", "    out.ref = out.ref;") })],
  ['a duplicated hold counts twice', b => ({ [T]: swap(b[T], "if (seen[k] || t.drive) return; seen[k] = 1;", "if (t.drive) return;") })],
  ['a drive needs fares', b => ({ [T]: swap(b[T], "if (seen[k] || t.drive) return; seen[k] = 1;", "if (seen[k]) return; seen[k] = 1;") })],
  ['a row is matched only by Trip ID', b => ({ [T]: swap(b[T], "if (has['id:' + String(t.tripId || '').toUpperCase()] || has['lk:' + k]) return;", "if (has['id:' + String(t.tripId || '').toUpperCase()]) return;") })],
  ['a ceiling is not needed to judge', b => ({ [T]: swap(b[T], "return !w.origins || !w.dests || w.ceiling == null; }).map", "return !w.origins || !w.dests; }).map") })],
  ['too early counts as stale', b => ({ [T]: swap(b[T], "      if (/too early/i.test(w.tier)) return false;\n", "") })],
  ['a fresh request is already waiting', b => ({ [T]: swap(b[T], "ariaDays_(r.created.slice(0, 10), today) >= 2;", "true;") })],
  ['every old fare is sent', b => ({ [T]: swap(b[T], "return f.dateSeen && ariaDays_(f.dateSeen, today) <= ARIA_FARE_DAYS_; })", "return true; })") })],
  ['nothing is cached', b => ({ [T]: swap(b[T], "  if (!(p && p.refresh)) { try { var hit = cache.get(ARIA_CACHE_KEY_); if (hit) return JSON.parse(hit); } catch (e) {} }\n", "") })],
  ['past trips are set beside ARIA', b => ({ [T]: swap(b[T], "return t.status !== 'archived' && t.endDate && t.endDate >= today; }).map", "return t.status !== 'archived'; }).map") })],
  ['the log names trips', b => ({ [T]: swap(b[T], "Logger.log('aria_status: ' + watch.length + ' watchlist rows, '", "Logger.log('aria_status: ' + watch.map(function(w) { return w.label; }).join() + ' watchlist rows, '") })],
  ['the route is missing', b => ({ [W]: swap(b[W], "      case 'aria_status':           return jsonOut_(webAriaStatus_(e.parameter));\n", '') })],
  ['the line uses every fare, not the cheapest of each day', both("if(by[f.dateSeen]==null||v<by[f.dateSeen])by[f.dateSeen]=v;", "by[f.dateSeen]=v;")],
  ['scouted fares are left off the card', both("var ids=[w.tripId,w.ref].filter(Boolean);", "var ids=[w.tripId].filter(Boolean);")],
  ['a flagged fare reads as firm', both("function ariaFirm_(f){return !!f&&!(f.flags||[]).length;}", "function ariaFirm_(f){return !!f;}")],
  ['lite drifts from the full block', b => ({ [L]: swap(b[L], "function ariaFareTotal_(f){return f.total!=null?f.total:f.farePP;}", "function ariaFareTotal_(f){return f.farePP;}") })],
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
