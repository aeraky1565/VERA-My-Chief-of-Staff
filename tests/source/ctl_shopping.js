// Negative controls for the Shopping list (the shared ShopList block in both dashboards): revert ONE rule at a time and confirm test_shopping_ui.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_shop');

const FILES = ['docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
// The full page is served from index.html, which carries app.js inside it.
const full = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });
const both = (from, to) => b => Object.assign(full(from, to)(b), { [L]: swap(b[L], from, to) });
const pair = (fullFrom, fullTo, liteFrom, liteTo) => b => Object.assign(full(fullFrom, fullTo)(b), { [L]: swap(b[L], liteFrom, liteTo) });

const CONTROLS = [
  ['the estimate stays in the name', both("name:t.replace(/^🤖\\s*/,'').replace(/\\s*\\(est\\..*?\\)\\s*$/,'').trim(),est:", "name:t.replace(/^🤖\\s*/,'').trim(),est:")],
  ['the raw line is shown', both("cursor:busy?'wait':'pointer'},onClick:function(){if(!busy)props.onToggle(it.index,it.done);}},view.name,", "cursor:busy?'wait':'pointer'},onClick:function(){if(!busy)props.onToggle(it.index,it.done);}},it.text,")],
  ['the restock note shows for checked items too', both("isVERA&&!it.done&&h('span',{className:'shop-vera'", "isVERA&&h('span',{className:'shop-vera'")],
  ['the check circle is a small target again', both("style:{width:44,height:44,flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center',background:'none'", "style:{width:18,height:18,flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center',background:'none'")],
  ['edit and delete are small targets again', both("fontSize:15,minWidth:40,minHeight:40,padding:0,flexShrink:0", "fontSize:15,padding:0,flexShrink:0")],
  ['aisles in list order, not walking order', both("var order=SHOP_AISLES_.map(function(a){return a[0];}).concat(['Other']);", "var order=Object.keys(by);")],
  ['the last matching aisle wins', both("for(var i=0;i<SHOP_AISLES_.length;i++){if(SHOP_AISLES_[i][2].test(t))", "for(var i=SHOP_AISLES_.length-1;i>=0;i--){if(SHOP_AISLES_[i][2].test(t))")],
  ['pantry words match inside other words', both("['Pantry', '#e3c46a', /\\b(", "['Pantry', '#e3c46a', /(")],
  ['the add box keeps the text', both("props.onAddText(current.tabId,t);setDraft('');", "props.onAddText(current.tabId,t);")],
  ['Done shopping forgets what was checked off', both("var done=store.items.filter(function(i){return i.done;})", "var done=store.items.filter(function(i){return false;})")],
  ['a checked item on the receipt counts as unchecked', both("kind:items[i].done?'match':'list'", "kind:'list'")],
  ['non-food is picked by default', both("setPicks(ls.map(function(x){return x.kind!=='nonfood';}));", "setPicks(ls.map(function(x){return true;}));")],
  ['a listed line is not checked off before saving', both("var tick=listed.reduce(function(p,x){return p.then(function(){return props.onToggle(x.index,false);});},Promise.resolve());", "var tick=Promise.resolve();")],
  ['the receipt\'s spelling is saved, not the list\'s', both("{name:x.match||x.name,qty:x.qty,price:x.price}", "{name:x.name,qty:x.qty,price:x.price}")],
];

// These drive a real browser. The CI job that runs controls has none (the browser job runs
// the screens themselves), so there they are skipped and said so; locally they run.
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
  const r = cp.spawnSync('node', ['test_shopping_ui.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT, SHOP_QUICK: '1' }) });
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
