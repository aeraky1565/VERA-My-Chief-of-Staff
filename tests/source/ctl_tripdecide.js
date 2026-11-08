// Negative controls for the Agenda confirm (issue #232):
// revert ONE rule at a time and confirm test_tripdecide.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tripdecide_out');

const FILES = ['Chat.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const full = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });
const UI = 'test_tripdecide.js', SRV = 'test_tripdecide.js', S = 'WebApp.js';
const srv = (from, to) => b => ({ [S]: swap(b[S], from, to) });

const C = 'Chat.js';
const CONTROLS = [
  ['the panel calls App’s handler again', full("onDecideOption:function(opt){if(onDecideTripOption)onDecideTripOption(tripKey,opt);}", "onDecideOption:function(opt){handleDecideTripOption(tripKey,opt);}"), SRV],
  ['the Travel tab doesn’t pass the handlers', full("onDecideTripOption:onDecideTripOption,onReopenTripDecision:onReopenTripDecision,", ''), SRV],
  ['App doesn’t hand over its handlers', full("onDecideTripOption:handleDecideTripOption,onReopenTripDecision:handleReopenTripDecision,", ''), SRV],
  ['the full dashboard sends no dates', full(",startDate:(meta&&meta.startDate)||'',endDate:(meta&&meta.endDate)||''}", '}'), SRV],
  ['lite sends no dates', b => ({ [L]: swap(b[L], ", startDate: trip.startDate || '', endDate: trip.endDate || '' });", ' });') }), SRV],
  ['the caller’s dates are ignored', srv("  if (s && e) return { start: s, end: e };\n", ''), SRV],
  ['the Trips tab isn’t asked', srv("if (rec && rec.startDate) return { start: rec.startDate, end: rec.endDate || rec.startDate };", ''), SRV],
  ['the confirm reads without a range again', srv("{ parameter: { tripKey: tripKey, startDate: range.start, endDate: range.end } }", "{ parameter: { tripKey: tripKey, startDate: p.startDate || '', endDate: p.endDate || '' } }"), SRV],
  ['Chat reads without a range', b => ({ [C]: swap(b[C], "{ parameter: { tripKey: dtTrip, startDate: dtRange.start, endDate: dtRange.end } }", '{ parameter: { tripKey: dtTrip } }') }), SRV],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
const ONLY = process.env.CTL_ONLY;
CONTROLS.forEach(function(c) {
  if (ONLY && c[0] !== ONLY) return;
  const name = c[0];
  if (!HAS_BROWSER && (c[2] || UI) === UI) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const r = cp.spawnSync('node', [c[2] || UI], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + (c[2] || UI) + ')');
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
