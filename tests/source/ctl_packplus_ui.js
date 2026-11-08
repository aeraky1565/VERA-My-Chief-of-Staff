// Negative controls for Packing, enriched, part 2 (the screen) (PackPlus.js, the Luggage.js additions and the PackPlus block, issue #234):
// revert ONE rule at a time and confirm test_packplus.js (server) or test_packplus_ui.js (screen) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_packplus_ui_out');

const FILES = ['PackPlus.js', 'TravelerProfiles.js', 'Luggage.js', 'LeavingHome.js', 'TripReadiness.js', 'FlightStatus.js', 'PreTripBriefing.js', 'Code.js', 'WebApp.js',
  'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const UI = 'test_packplus_ui.js', SRVT = 'test_packplus.js', NAV = 'none';
const pk = (from, to) => b => ({ 'PackPlus.js': swap(b['PackPlus.js'], from, to) });
const lu = (from, to) => b => ({ 'Luggage.js': swap(b['Luggage.js'], from, to) });
const lh = (from, to) => b => ({ 'LeavingHome.js': swap(b['LeavingHome.js'], from, to) });
const web = (from, to) => b => ({ 'WebApp.js': swap(b['WebApp.js'], from, to) });

const CONTROLS = [
  // screens, part 2 (part 1 and the server controls are in ctl_packplus.js)
  ['“wear it” does nothing', both("if(f.kind==='wear')props.post({action:'lu_move',tripKey:props.tripKey,item:f.key,bag:'wear'});", "if(f.kind==='wear'){}")],
  ['checkout shows mid-trip', both('on=end&&today>=pkAddDays_(end,-1)&&today<=pkAddDays_(end,1);', 'on=true;')],
  ['the review shows during the trip', both('on=end&&today>end&&today<=pkAddDays_(end,60);', 'on=true;')],
  ['accepting a staple does nothing', both('onClick:function(){accept(p.name,x);}', 'onClick:function(){}')],
  ['Copy does nothing', both('onClick:function(){copy(t);}', 'onClick:function(){}')],
  ['the trip summary has no checkout', both('    h(TsCheckout,{trip:trip,apiUrl:props.apiUrl,apiToken:props.apiToken,who:props.who,card:card,label:label}),\n', '')],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
const ONLY = process.env.CTL_ONLY;
CONTROLS.forEach(function(c) {
  if (ONLY && c[0] !== ONLY) return;
  const name = c[0], test = c[2] || UI;
  if (!HAS_BROWSER && (test === UI || test === NAV)) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
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
