// Negative controls for the Bucket List release 2 (BucketPlus.js and the shared PlacesBucket block, issue #228):
// revert ONE rule at a time and confirm test_bucketplus.js (server) or test_bucketplus_ui.js (screen) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_bucketplus_out');

const FILES = ['BucketPlus.js', 'Places.js', 'TripIdeas.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const UI = 'test_bucketplus_ui.js', SRV = 'test_bucketplus.js', S = 'BucketPlus.js';
const srv = (from, to) => b => ({ [S]: swap(b[S], from, to) });

const W = 'WebApp.js', P = 'Places.js';
const CONTROLS = [
  ['a range over New Year is lost', srv('for (var m = a, k = 0; k < 12; k++) { out[m] = 1; if (m === b) break; m = m % 12 + 1; }', 'for (var m = a; m <= b; m++) out[m] = 1;'), SRV],
  ['a place with no months spoils the overlap', srv("var known = (lists || []).filter(function(l) { return l && l.length; })", 'var known = (lists || [])'), SRV],
  ['the sample trip starts this month', srv('for (var k = 1; k <= 12; k++) {', 'for (var k = 0; k <= 12; k++) {'), SRV],
  ['holidays aren’t bridged', srv('var cost = tiPtoCost_(sample.start, sample.nights, p.holidays || {});', 'var cost = tiPtoCost_(sample.start, sample.nights, {});'), SRV],
  ['Config award rows are ignored', srv('(out[m[1]] = out[m[1]] || {})[m[2]] = [v[1], Number(v[2].replace(/,/g, \'\'))];', ''), SRV],
  ['transferable points aren’t counted', srv('if (BP_TRANSFERABLE_.test(p)) transferable += n;', ''), SRV],
  ['flights from anywhere count', srv("&& hs.indexOf(f.from) !== -1 &&", '&&'), SRV],
  ['seven hours counts as a long weekend', srv('return f.minutes < max;', 'return f.minutes <= max;'), SRV],
  ['each look-up asks Claude again', srv("if (!f || (p.refresh === '1' && !f.edited)) {", 'if (true) {'), SRV],
  ['a refresh overwrites your own times', srv("(p.refresh === '1' && !f.edited)", "(p.refresh === '1')"), SRV],
  ['the suggestion overwrites your best months', srv('if (!bm.length && f.bestMonths.length) {', 'if (f.bestMonths.length) {'), SRV],
  ['a failed look-up saves something', srv("if (!r || !r.json) return f ?", "if (!r) return f ?"), SRV],
  ['GET places drops the extras', b => ({ [P]: swap(b[P], "extras = typeof bpPlacesExtras_ === 'function' ? bpPlacesExtras_(bucket) : {};", 'extras = {};') }), SRV],
  ['the long-weekend filter shows everything', both("if(f==='weekend')return !!pbWeekend_(d,b);", "if(f==='weekend')return true;")],
  ['points are for one seat', both("need=Number(a[1])*4", "need=Number(a[1])*2")],
  ['the points line drops transferable', both("var tr=Number((d.points||{}).transferable)||0,have=own+tr;", 'var tr=0,have=own;')],
  ['Ask ARIA has no destination', both("'To: '+pbPlace_(b),", '')],
  ['Suggest doesn’t ask', both("apiGet(apiUrl,apiToken,{action:'bucket_facts',id:b.ID})", "Promise.resolve({ok:true})")],
  ['Edit saves no months', both("bestMonths:pbMonthsText_(b.bestMonths||[]),", '')],
  ['your flight times aren’t saved', both("if(fl&&b.flightsChanged)return apiPost", "if(false)return apiPost")],
  ['the strip marks no month good for all', both("var fit=plan.months.all.indexOf(i+1)!==-1?'all':", "var fit=false?'all':")],
  ['vacation days are hidden', both("plan.sample&&(plan.people||[]).length?h('div',{key:'pto'", "false?h('div',{key:'pto'")],
  ['lite keeps the old Bucket List', b => ({ [L]: swap(b[L], "{travSub === 'bucketlist' && <PlacesBucket apiUrl={apiUrl} apiToken={apiToken} busy={busy} onAdd={handleAddBucketItem} onGoIdeas={() => setTravSub('ideas')} />}", "{travSub === 'bucketlist' && <BucketListPanel entries={bucketList} />}") })],
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
