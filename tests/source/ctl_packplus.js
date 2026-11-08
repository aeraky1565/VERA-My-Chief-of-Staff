// Negative controls for Packing, enriched (PackPlus.js, the Luggage.js additions and the PackPlus block, issue #234):
// revert ONE rule at a time and confirm test_packplus.js (server) or test_packplus_ui.js (screen) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_packplus_out');

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
  // server
  ['Checked isn’t kept in step', pk("sh.getRange(r._row, PK_COL_.checked).setValue(st === 'bag' ? 'TRUE' : 'FALSE');", ''), SRVT],
  ['a tick forgets who and when', pk("sh.getRange(r._row, PK_COL_.by, 1, 2).setValues([[pkStr_(body.by, 40), pkStamp_()]]);", ''), SRVT],
  ['laundry doesn’t cut the count', pk('if (laundry && days > 5) return', 'if (false && days > 5) return'), SRVT],
  ['no cap on a long trip', pk('if (days > 10) return { qty: 10,', 'if (false) return { qty: 10,'), SRVT],
  ['a counted item is counted again', pk("if (/\\d/.test(s)) return null;", ''), SRVT],
  ['staples are added twice', pk("if (rows.some(function(r) { return String(r.person).toLowerCase() === key && pkNorm_(r.item) === pkNorm_(s); })) return;", ''), SRVT],
  ['anything once is a learned staple', pk('return c >= 3 && c / total >= 0.8;', 'return c >= 1;'), SRVT],
  ['learning counts the upcoming trip', pk('.filter(function(r) { return pkStart_(r.tripKey) < today; })', '.filter(function(r) { return true; })'), SRVT],
  ['the copy brings what went unused', pk('if (skip[pkNorm_(i.item)]) { skipped.push(i.item); return; }', ''), SRVT],
  ['re-worn pieces counted per wear', pk('qty = PK_REWEAR_RE_.test(p.item) ? Math.max(1, Math.ceil(p.uses / 3)) : p.uses;', 'qty = p.uses;'), SRVT],
  ['outfits for people not travelling', pk('&& (!(travellers || []).length || travellers.some(', '&& (true || travellers.some('), SRVT],
  ['outfit pieces added twice', pk('if (have) { if (!have.qty', 'if (false) { if (!have.qty'), SRVT],
  ['no need-by date on Shopping', pk("(by ? ' (need by ' + by + ')' : '')", "''"), SRVT],
  ['medicines go to Shopping', pk("if (typeof LU_MEDS_RE_ !== 'undefined' && LU_MEDS_RE_.test(r.item)) return 'rx';", ''), SRVT],
  ['bought in Shopping isn’t picked up', pk("if (r.status === 'buy' && done[pkNorm_(r.item)]) {", 'if (false) {'), SRVT],
  ['an item goes on Shopping twice', pk("=== norm) return 'added'; }", '=== norm) {} }'), SRVT],
  ['no chargers line at checkout', pk('if (chargers.length) out.push(', 'if (false) out.push('), SRVT],
  ['a checkout tick forgets who', pk("run.ticks[key] = { by: pkStr_(body.by, 40), at: pkStamp_() };", "run.ticks[key] = { by: '', at: '' };"), SRVT],
  ['the checkout list is read as a trip list', lh("? 'away' : String(r[1] || '') === 'checkout' ? 'checkout' : 'trip',", "? 'away' : 'trip',"), SRVT],
  ['lessons are logged on every save', pk("if (!logged && typeof logTripLesson_ === 'function') {", "if (typeof logTripLesson_ === 'function') {"), SRVT],
  ['lessons aren’t tied to the trip type', pk("scope = traits.length ? 'trait:' + traits[0] : 'always:all'", "scope = 'always:all'"), SRVT],
  ['making a list skips staples and counts', web("if (typeof pkAfterGenerate_ === 'function') pkAfterGenerate_(", 'if (false) pkAfterGenerate_('), SRVT],
  ['the old tick leaves Status behind', web("found.sheet.getRange(found.rowNum, 9).setValue(val === 'TRUE' ? 'bag' : 'ready');", ''), SRVT],
  ['the count isn’t in the weight', lu('var qty = Number(it.qty) > 0 && luQty_(it.item) === 1 ? Number(it.qty) : 1;', 'var qty = 1;'), SRVT],
  ['worn on the plane stays in the bag', lu("if (moves[i.key] === 'wear') {", 'if (false) {'), SRVT],
  ['a liquid can be moved into the cabin', lu("if (cabin && (i.place === 'checked' || i.place === 'checked-soft')) return false;", ''), SRVT],
  ['packed so far counts everything', lu("var inBag = b.items.filter(function(i) { return i.status === 'bag'; });", 'var inBag = b.items;'), SRVT],
  // screens (the rest are in ctl_packplus_ui.js, so each file fits the suite’s 5-minute limit)
  ['the circle doesn’t move the item', both("onClick:function(){post({action:'pk_status',id:i.id,status:st[5],by:props.who||''});}", 'onClick:function(){}')],
  ['a new count isn’t saved', both("post({action:'pk_qty',id:i.id,qty:qty.v})", "post({action:'pk_qty',id:i.id,qty:''})")],
  ['“Need to buy it” is ignored', both("status:add.buy?'buy':'ready'", "status:'ready'")],
  ['no bag chips', both("bagOf['p:'+i.id]?h('span',{className:'pk-bag'", "false?h('span',{className:'pk-bag'")],
  ['ticking in Pack a bag does nothing', both('var tick=function(i,on){if(!/^p:/.test(i.key))return;props.post(', 'var tick=function(i,on){return;props.post(')],
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
