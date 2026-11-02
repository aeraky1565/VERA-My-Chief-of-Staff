// Negative controls for Finances' grouped navigation (the FinNav block, issue #225, and its
// wiring in both dashboards): revert ONE rule at a time and confirm test_finnav_ui.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_finnav_out');

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
const UI = 'test_finnav_ui.js';

const CONTROLS = [
  ['Groceries is not in Day to day', both("items:['budget','bills','cashflow','groceries']", "items:['budget','bills','cashflow']")],
  ['the lite ids keep their fin_ prefix', both("function finKey_(id){return String(id||'').replace(/^fin_/,'');}", "function finKey_(id){return String(id||'');}")],
  ['a group with nothing on offer still shows', both("    .filter(function(g){return g.tabs.length>0;});}\n// Pure: the group a tab id is in", "    ;}\n// Pure: the group a tab id is in")],
  ['a group forgets its last subtab', both("var to=g.tabs.some(function(t){return t.id===keep;})?keep:g.tabs[0].id;props.onPick(to);", "props.onPick(g.tabs[0].id);")],
  ['the memory is not kept in this browser', both("function finLastWrite_(v){try{localStorage.setItem('vera_fin_last',JSON.stringify(v));}catch(e){}}", "function finLastWrite_(v){}")],
  ['Overview shows a subtab row', both("cur.tabs.length>1?h('div',{role:'tablist'", "cur.tabs.length>0?h('div',{role:'tablist'")],
  ['the full dashboard has no Groceries subtab', full("{id:'cashflow',label:'💰 Cashflow'},{id:'groceries',label:'🛒 Groceries'},", "{id:'cashflow',label:'💰 Cashflow'},")],
  ['the full Groceries subtab is empty', full("sub==='groceries'&&React.createElement(GroceriesCard,{apiUrl:apiUrl,apiToken:apiToken}),", "")],
  ['the lite Groceries subtab is empty', b => ({ [L]: swap(b[L], "            {activeFinanceTab === 'fin_groceries' && <GroceriesCard apiUrl={apiUrl} apiToken={apiToken} />}\n", "") })],
  ['the lite Finances keeps the flat row', b => ({ [L]: swap(b[L], "<FinNav tabs={FINANCE_TABS} sub={activeFinanceTab} onPick={setActiveFinanceTab} />", "<div>{FINANCE_TABS.map(t => <button key={t.id} className=\"subtab-btn\" onClick={() => setActiveFinanceTab(t.id)}>{t.label}</button>)}</div>") })],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
CONTROLS.forEach(function(c) {
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
