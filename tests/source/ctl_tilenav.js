// Negative controls for the icon-tile navigation (VeraTileNav, both dashboards), Home's slot card and
// the lite dashboard's eight tabs: revert ONE rule at a time and confirm test_tilenav_ui.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tilenav_out');

const FILES = ['docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
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
const UI = 'test_tilenav_ui.js';

const CONTROLS = [
  ['Network goes back into Search', both("items:['brand','market']},{id:'agents'", "items:['brand','market','network']},{id:'agents'")],
  ['an emptied group still shows', both("    .filter(function(g){return g.tabs.length>0;});}\n// Pure: the group a subtab is in", "    ;}\n// Pure: the group a subtab is in")],
  ['a group forgets its last subtab', both("var to=g.tabs.some(function(t){return t.id===keep;})?keep:g.tabs[0].id;props.onPick(to);", "props.onPick(g.tabs[0].id);")],
  ['the memory is not kept in this browser', both("function vnLastWrite_(name,v){try{localStorage.setItem('vera_vn_'+name,JSON.stringify(v));}catch(e){}}", "function vnLastWrite_(name,v){}")],
  ['a one-subtab group shows chips', both("cur.tabs.length>1||props.after?h('div'", "cur.tabs.length>0||props.after?h('div'")],
  ['tiles lose their tooltip', both("title:g.tabs.map(function(t){return t.label;}).join(' · ')", "title:''")],
  ['the lite copy drifts', b => ({ [L]: swap(b[L], "{id:'network',label:'Network',icon:'🤝',items:['network']}", "{id:'network',label:'Network',icon:'👥',items:['network']}") })],
  ['Chat is not right after Today', b => ({ [L]: swap(b[L], "  { id: 'chat',          label: '💬 Chat'     },\n  { id: 'shopping',      label: '🛒 Shopping' },", "  { id: 'shopping',      label: '🛒 Shopping' },\n  { id: 'chat',          label: '💬 Chat'     },") })],
  ['an old Cards link goes nowhere', b => ({ [L]: swap(b[L], "cards: ['finances', 'fin_cards'], ", "") })],
  ['Money › Cards keeps the cheat sheet', b => ({ [L]: swap(b[L], "display: part === 'cards' ? 'none' : undefined", "display: undefined") })],
  ['Your assistants leaves lite Today', b => ({ [L]: swap(b[L], '<VeraRoster links={status && status.rosterLinks} veraHref="./" />', '') })],
  ['Home loses the slot', full('React.createElement(HomeSlot,{apiUrl:apiUrl,apiToken:apiToken,onNavigate:onNavigate}),', '')],
  ['Bills comes back to the slot', full("{id:'birthday',label:'🎂 Birthday'}];", "{id:'birthday',label:'🎂 Birthday'},{id:'bills',label:'🧾 Bills'}];")],
  ['spending counts lines with no actuals', full("if(x.actual==null)return;plan+=x.plan||0;", "plan+=x.plan||0;")],
  ['the slot forgets the pick', full("setPick(id);try{localStorage.setItem('vera_home_slot',id);}catch(e){}", "setPick(id);")],
  ['Coming up shows past events', full("var cs=(d.cards||[]).filter(function(c){return!c.after;}).slice(0,3);", "var cs=(d.cards||[]).slice(0,3);")],
  ['Birthday ignores gift ideas', full("return{label:String(d.Label||''),person:who,date:d.nextDate,days:d.daysUntil,ideas:n};", "return{label:String(d.Label||''),person:who,date:d.nextDate,days:d.daysUntil,ideas:0};")],
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
  const r = cp.spawnSync('node', [UI], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT, FIN_QUICK: '1' }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + UI + ')');
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
