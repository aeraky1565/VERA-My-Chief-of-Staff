// Negative controls for Travel › Countries (Places.js and the PlacesCountries screen, issue #228):
// revert ONE rule at a time and confirm test_places.js (server) or test_places_ui.js (screen) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_places_out');

const FILES = ['Places.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
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
const UI = 'test_places_ui.js', SRV = 'test_places.js', S = 'Places.js';
const srv = (from, to) => b => ({ [S]: swap(b[S], from, to) });

const CONTROLS = [
  ['the move overwrites a filled Occasion', srv("if (occ || !notes) return r;", "if (!notes) return r;"), SRV],
  ['the move runs every time', b => ({ [S]: swap(b[S], "if (veraOnceGet_(PL_MOVED_PROP_)) return 0;", "if (false) return 0;") }), SRV],
  ['free text isn’t grouped under its pick', b => ({ [S]: swap(swap(b[S], "if (t === p || t.indexOf(p) !== -1) return picks[i];", "if (t === p) return picks[i];"), "if (stem.length >= 4 && t.indexOf(stem) !== -1) return picks[i];", "") }), SRV],
  ['suggestions repeat a pick in another case', srv("s = plStr_(s, 60); var k = s.toLowerCase();", "s = plStr_(s, 60); var k = s;"), SRV],
  ['planned includes trips that ended', srv("    if ((r.endDate || r.startDate) < today) return false;\n", ""), SRV],
  ['visited places aren’t flagged', srv("b.visited = !!String(b.Visited || '').trim();", "b.visited = false;"), SRV],
  ['the map shows visited bucket places', full("if(b.Country&&!b.visited&&!bucketBy[b.Country])", "if(b.Country&&!bucketBy[b.Country])")],
  ['add_country drops the occasion', b => ({ 'WebApp.js': swap(b['WebApp.js'], "sheet.appendRow([id, country, city, year, traveller, tripKey, notes, occasion]);", "sheet.appendRow([id, country, city, year, traveller, tripKey, notes]);") }), SRV],
  ['the form saves Occasion into Notes again', full("tripKey,notes:'',occasion:occasion.trim()});}", "tripKey,notes:occasion.trim()});}"), SRV],
  ['planned outranks been on the map', full("var rank={been:3,planned:2,bucket:1};", "var rank={been:1,planned:3,bucket:2};")],
  ['Ahmed’s filter drops shared trips', full("return t==='Both'||t===who;", "return t===who;")],
  ['the occasion filter keeps planned trips', full("var planned=occ?[]:(d.planned||[]);", "var planned=(d.planned||[]);")],
  ['the timeline runs oldest first', full("var yearList=Object.keys(years).sort(function(a,b){return b.localeCompare(a);})", "var yearList=Object.keys(years).sort(function(a,b){return a.localeCompare(b);})")],
  ['the list leaves out planned countries', full("return {name:c,iso:pcIso_(c),planned:plannedBy[c]};})", "return {name:c,iso:pcIso_(c),planned:plannedBy[c]};}).slice(0,0)")],
  ['trip notes are not shown', full("c.notes?h('div',{className:'pc-notes'", "false?h('div',{className:'pc-notes'")],
  ['Add a visit doesn’t reload', full("then(function(){setAdding(false);load();});", "then(function(){setAdding(false);});")],
  ['the view isn’t remembered', full("setView(v);try{localStorage.setItem('vera_countries_view',v);}catch(e){}", "setView(v);")],
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
