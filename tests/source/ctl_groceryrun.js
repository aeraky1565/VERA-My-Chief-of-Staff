// Negative controls for Log a grocery run (GroceryRun.js, the Pantry.js receipt date and the GroceryRun block, issue #229):
// revert ONE rule at a time and confirm test_groceryrun.js (server) or test_groceryrun_ui.js (screen) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_groceryrun_out');

const FILES = ['GroceryRun.js', 'Pantry.js', 'Groceries.js', 'OnHand.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const UI = 'test_groceryrun_ui.js', SRVT = 'test_groceryrun.js', NAV = 'none';
const gq = (from, to) => b => ({ 'GroceryRun.js': swap(b['GroceryRun.js'], from, to) });
const pan = (from, to) => b => ({ 'Pantry.js': swap(b['Pantry.js'], from, to) });
const app = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });

const CONTROLS = [
  // server
  ['a list item is matched twice', gq(" && !used[o.tabId + '|' + o.index]; });", '; });'), SRVT],
  ['the receipt’s store doesn’t win a tie', gq('var pick = cands.filter(function(o) { return o.store === store; })[0] || cands[0];', 'var pick = cands[0];'), SRVT],
  ['done items are matched', gq('if (t && !i.done) out.push(', 'if (t) out.push('), SRVT],
  ['any old date is kept', gq("return age >= 0 && age <= 60 ? ymd : '';", 'return ymd;'), SRVT],
  ['a future date is kept', gq('return age >= 0 && age <= 60', 'return age <= 60'), SRVT],
  ['the pantry ignores the receipt’s date', gq('var r = receiptLog_(store, items, date);', 'var r = receiptLog_(store, items);'), SRVT],
  ['the purchase rows ignore the date', pan("if (fresh.length) logPurchaseItems_(fresh, 'receipt', today);", "if (fresh.length) logPurchaseItems_(fresh, 'receipt');"), SRVT],
  ['any list item can be ticked', gq("if (!it || it.done || gqItemText_(it.text).toLowerCase() !== String(t.item || '').toLowerCase()) return;", 'if (!it) return;'), SRVT],
  ['“always count” is ignored', gq("if (body.always === true || body.always === 'true') {", 'if (false) {'), SRVT],
  ['“not this one” still logs a run', gq("if (counted !== 'none' && Number(run.total) > 0) {", 'if (Number(run.total) > 0) {'), SRVT],
  ['a total-only run says receipt', gq("source: items.length ? 'receipt' : 'typed',", "source: 'receipt',"), SRVT],
  ['“just the food” counts everything', gq("counted: counted === 'food' ? 'food' : 'all'", "counted: 'all'"), SRVT],
  ['switched-off stores are offered', gq('if (set[k] === true) add(k);', 'add(k);'), SRVT],
  ['the read doesn’t see the lists', gq("'MY LISTS: ' + JSON.stringify(names.slice(0, 150));", "'MY LISTS: []';"), SRVT],
  ['an unreadable receipt isn’t reported', gq('if (!r.items.length && r.total == null) return { ok: false,', 'if (false) return { ok: false,'), SRVT],
  // screens
  ['non-food starts picked', both('picks:(r.items||[]).map(function(x){return x.food!==false;})', 'picks:(r.items||[]).map(function(x){return true;})')],
  ['list matches start unticked', both('ticks:(r.items||[]).map(function(x){return !!x.tabId;})', 'ticks:(r.items||[]).map(function(x){return false;})')],
  ['ticks aren’t sent', both('ticks:lines.map(function(x,i){return f.ticks[i]&&x.tabId?', 'ticks:lines.map(function(x,i){return false?')],
  ['who doesn’t default to you', both("var me=GQ_PEOPLE.filter(function(p){return String(p).toLowerCase()===String(props.who||'').toLowerCase();})[0]||GQ_PEOPLE[0];", 'var me=GQ_PEOPLE[0];')],
  ['an unknown store isn’t asked about', both('var showCount=f.counts!==true;', 'var showCount=false;')],
  ['the date isn’t sent', both("{action:'gq_log',store:f.store.trim(),date:f.date,", "{action:'gq_log',store:f.store.trim(),date:'',")],
  ['a run saves with no total', both("if(f.counted!=='none'&&!(total>0)&&!picked.length){setErr('Enter the total paid.');return;}\n    if(f.counted!=='none'&&!(total>0)){setErr('Enter the total paid, or pick “Not this one”.');return;}", '')],
  ['no Home quick action', app(",React.createElement(GroceryRunButton,{apiUrl:apiUrl,apiToken:apiToken,who:'Ahmed',variant:'tile'})", '')],
  ['no Quick capture chip', app("h(GroceryRunButton,{apiUrl:apiUrl,apiToken:apiToken,who:'Ahmed',variant:'chip'}),", '')],
  ['no Today tile', b => ({ [L]: swap(b[L], '      <GroceryRunButton apiUrl={apiUrl} apiToken={apiToken} who="Victoria" variant="tile" />\n', '') })],
  ['no button on the Groceries card', both("    h(GroceryRunButton,{apiUrl:props.apiUrl,apiToken:props.apiToken,who:props.who||'',variant:'wide',onDone:load}),\n", '')],
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
