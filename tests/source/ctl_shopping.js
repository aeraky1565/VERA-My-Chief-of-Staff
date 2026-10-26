// Negative controls for the Shopping list's look (shopItemView_ and ShoppingTab in both
// dashboards): revert ONE rule at a time and confirm test_shopping_ui.js catches it.
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
  ['the estimate stays in the name', both(".replace(/\\s*\\(est\\..*?\\)\\s*$/,'').trim()", ".trim()")],
  ['the restock date is not read', both("est:m?m[1].trim():''", "est:''")],
  ['the raw line is shown', pair("},view.name,isVERA&&", "},item.text,isVERA&&", "                          {view.name}\n", "                          {item.text}\n")],
  ['the restock note shows for items in the cart too', pair("isVERA&&!item.done&&/*#__PURE__*/React.createElement(\"span\",{className:\"shop-vera\"", "isVERA&&/*#__PURE__*/React.createElement(\"span\",{className:\"shop-vera\"",
    "{isVERA && !item.done && (\n                            <span className=\"shop-vera\"", "{isVERA && (\n                            <span className=\"shop-vera\"")],
  ['the check circle is a small target again', pair("style:{width:44,height:44,flexShrink:0,display:'inline-flex'", "style:{width:18,height:18,flexShrink:0,display:'inline-flex'",
    "style={{ width: 44, height: 44, flexShrink: 0, display: 'inline-flex'", "style={{ width: 18, height: 18, flexShrink: 0, display: 'inline-flex'")],
  ['edit and delete are small targets again', pair("fontSize:15,minWidth:40,minHeight:40,padding:0,flexShrink:0", "fontSize:15,padding:0,flexShrink:0",
    "fontSize: 15, minWidth: 40, minHeight: 40, padding: 0, flexShrink: 0", "fontSize: 15, padding: 0, flexShrink: 0")],
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
  const r = cp.spawnSync('node', ['test_shopping_ui.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
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
