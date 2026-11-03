// Negative controls for Travel › Bucket List (Places.js and the PlacesBucket screen, issue #228):
// revert ONE rule at a time and confirm test_places.js (server) or test_places_ui.js (screen) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_places_bucket_out');

const FILES = ['Places.js', 'Code.js', 'WebApp.js', 'TripIdeas.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
// A dashboard change: the full page is served from index.html, which carries app.js inside it.
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const full = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });
const UI = 'test_places_bucket_ui.js', SRV = 'test_places.js', S = 'Places.js';
const srv = (from, to) => b => ({ [S]: swap(b[S], from, to) });

const CONTROLS = [
  ['activities aren’t joined to their place', srv("b.activities = actBy[String(b.ID)] || [];", "b.activities = [];"), SRV],
  ['"FALSE" counts as done', srv("done: !!done && done !== 'no' && done !== 'false'", "done: !!done"), SRV],
  ['filters keep visited places', srv("if (filter !== 'open' && b.visited) return false;", ""), SRV],
  ['add_bucket_item drops the occasion', b => ({ 'WebApp.js': swap(b['WebApp.js'], "stars, dreamTrip, notes, '', occasion, '']);", "stars, dreamTrip, notes, '', '', '']);") }), SRV],
  ['update_bucket_item ignores the occasion', b => ({ 'WebApp.js': swap(b['WebApp.js'], "[['occasion', 'Occasion'], ['notes', 'Notes'],", "[['notes', 'Notes'],") }), SRV],
  ['the screen opens on All', full("var _f=React.useState('open'),filter=_f[0]", "var _f=React.useState('all'),filter=_f[0]")],
  ['dream trips include visited ones', full("if(f==='open')return !b.visited;if(b.visited)return false;", "if(f==='open')return !b.visited;")],
  ['Edit offers only the defaults', full("var picks=d.occasions||d.picks||[];", "var picks=d.picks||[];")],
  ['Save drops who', full("targetYear:b.targetYear,traveller:b.traveller})", "targetYear:b.targetYear})")],
  ['ticking a thing to do sends the old state', full("done:a.done?'':'yes'", "done:a.done?'yes':''")],
  ['Mark visited sends nothing', full("visited:String(new Date().getFullYear())", "visited:''")],
  ['a visited place can be ticked for a trip', full("b.visited?null:h('button',{type:'button',className:'pb-pick'", "h('button',{type:'button',className:'pb-pick'")],
  ['Add a place doesn’t reload', full("onSave:function(f){Promise.resolve(props.onAdd&&props.onAdd(f)).then(function(){setAdding(false);load();});}}):null;\n  if(!d)return h('div',{className:'pb-panel'", "onSave:function(f){Promise.resolve(props.onAdd&&props.onAdd(f)).then(function(){setAdding(false);});}}):null;\n  if(!d)return h('div',{className:'pb-panel'")],
  ['the brief ignores the occasion', srv("var lead = occasion ? occasion.charAt(0).toUpperCase() + occasion.slice(1) + ' in ' + countries.join(' & ') : countries.join(' & ');", "var lead = countries.join(' & ');"), SRV],
  ['this year’s months start in January', srv("for (var m = years[0] === ty ? tm + 1 : 1; m <= 12; m++)", "for (var m = 1; m <= 12; m++)"), SRV],
  ['done things to do become wishes', srv("if (!a.done && plStr_(a.activity, 100)) pieces.push(", "if (plStr_(a.activity, 100)) pieces.push("), SRV],
  ['no anniversary dinner', srv("if (group === 'Anniversary') musts.push('Anniversary dinner on the night itself.');", ""), SRV],
  ['the edits are ignored', srv("var idea = { title: e.title !== undefined ? e.title : b.title,", "var idea = { title: b.title,"), SRV],
  ['places aren’t linked to the idea', srv("plSetBucket_(String(id), 'Trip Idea', r.idea.id);", ""), SRV],
  ['places close before the trip ends', srv("(t.endDate || t.startDate) < today) tripOf[i.id] = t;", "true) tripOf[i.id] = t;"), SRV],
  ['a second visit is added every read', srv("if (!dup) cs.appendRow(", "cs.appendRow("), SRV],
  ['the sheet doesn’t send the edits', full("edits:{title:plan.title,where:plan.where,travelers:plan.travelers,mustHaves:plan.mustHaves}", "edits:{}")],
  ['saving doesn’t open Trip Ideas', full("if(props.onGoIdeas)props.onGoIdeas(r.idea.id);}else setErr", "}else setErr")],
  ['Trip Ideas doesn’t show the bucket places', both("i.fromBucket&&i.fromBucket.length?h('span',{className:'ti-from-bucket'", "false?h('span',{className:'ti-from-bucket'")],
  ['the add form has no occasion', full("dreamTrip:dreamTrip.trim(),notes:notes.trim(),occasion:occasion.trim()});}", "dreamTrip:dreamTrip.trim(),notes:notes.trim()});}"), SRV],
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
  if (!HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const r = cp.spawnSync('node', [c[2] || UI], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT, FIN_QUICK: '1' }) });
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
