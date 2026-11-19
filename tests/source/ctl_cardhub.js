// Negative controls for Card Hub (CardValue.js, CardHub.js, the Card Hub reader and writers, and
// the shared CardHub block): revert ONE rule at a time and confirm a test catches it. Server and
// maths rules run test_cardvalue.js; dashboard rules run test_cardhub_ui.js.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_cardhub_out');

const FILES = ['NightlyRunner.js', 'CardValue.js', 'CardHub.js', 'WebApp.js', 'Code.js', 'Chat.js', 'Groceries.js', 'FinSummary.js', 'FlagsTasks.js',
  'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const V = 'CardValue.js', H = 'CardHub.js', W = 'WebApp.js', A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
// The value maths is in CardValue.js and copied into both dashboards; change every copy, so
// what bites is the behaviour, not the "copies agree" check.
const maths = (from, to) => b => ({ [V]: swap(b[V], from, to), [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const pages = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const full = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const TEST = 'test_cardvalue.js', UI = 'test_cardhub_ui.js';

const CONTROLS = [
  ['points count as the raw rate, whatever a point is worth', maths('return Math.round(rate * cvCpp_(p) * 100) / 100;', 'return rate;')],
  ['your own ¢ is ignored', maths('if (own && own > 0) return own;', '')],
  ['a card earns into no program', maths("return x && (x === id || x === nm);", 'return false;')],
  ['a tie goes to the higher fee', maths('(fee(a.card) - fee(b.card))', '(fee(b.card) - fee(a.card))')],
  ['Costco offers any network', maths('(!it.visaOnly || !String(c.network', '(true || !String(c.network')],
  ['a closed card still shows', maths("&& !String((card && card.closed) || '').trim(); }", '; }')],
  ['abroad offers cards with a foreign fee', maths("&& (!opts.abroad || cvNoFx_(c)); });", '; });')],
  ['no broad Travel rate for flights', maths("if (item && item.broad) mine.forEach", 'if (false) mine.forEach')],
  ['an authorised user can’t use the card', maths("String((card && card.authUser) || '').split(", "String('').split(")],
  ['other categories vanish', maths("    if (list.length) rows.push({ group: 'More'", "    if (false) rows.push({ group: 'More'")],
  ['a goal ignores transfers', one(W, "if (goal.countTransfers", "if (false && goal.countTransfers")],
  ['a program on two rows stays two', one(W, 'var k = p.id || p.program;', 'var k = Math.random();')],
  ['a 3% foreign fee still says No FX', one(W, 'function cardFxFlag_(noFxFee, fxFeePct) {', 'function cardFxFlag_(noFxFee, fxFeePct) { return noFxFee || \'\';')],
  ['a perk use is logged twice in one cycle', one(W, '  if (at !== -1) return false;\n  var perks', '  var perks')],
  ['un-ticking leaves the use logged', one(W, "if (!add) { if (at !== -1) sh.deleteRow(at + 2); return at !== -1; }", "if (!add) { return false; }")],
  ['a balance change isn’t dated', one(W, "cardLogPoints_(id, p.totalPoints, p.source || 'dashboard')", 'null')],
  ['points expiring 50 days out aren’t flagged', one(H, 'if (d >= 0 && d <= 90) out[', 'if (d >= 0 && d <= 30) out[')],
  ['the fee flag ignores the perks', one(H, "urgency: used >= fee ? 'Low' : 'Medium', due: when };", "urgency: 'Low', due: when };")],
  ['the fee month in the notes is ignored', one(H, "(typeof fsCardFeeMonth_ === 'function' ? fsCardFeeMonth_(c.notes) : 0)", '0')],
  ['the grocery pick ignores what points are worth', one('Groceries.js', 'grBestCard_(cr.cards, cr.rewards, w, cr.programs)', 'grBestCard_(cr.cards, cr.rewards, w)')],
  ['the Perks list never reads a tick', pages("if(f==='Standing'||!lu)return false;", 'return false;')],
  ['the Perks list ignores the multi-year claim date', pages('return new Date(now.getFullYear(),m,now.getDate())<back;', 'return false;')],
  ['the Perks list shows a closed card’s perks', pages("return c&&cvOpen_(c)&&(!who||cvCanUse_(c,who));", 'return c&&(!who||cvCanUse_(c,who));'), UI],
  ['the Perks list loses each perk’s cycle tag', pages("h('b',null,p.perk),' ',chTag_(x.cy.label,col),", "h('b',null,p.perk),' ',"), UI],
  ['lite shows the runner-up without a tap', pages("isOpen&&h('div',{className:'ch-ru'", "h('div',{className:'ch-ru'"), UI],
  ['lite’s reference can edit points', pages("tab==='points'&&h(CardPointsView,{programs:programs,goals:goals,history:history,readOnly:true})", "tab==='points'&&h(CardPointsView,{programs:programs,goals:goals,history:history,readOnly:false,onAddProgram:function(){},onEditProgram:function(){},onDeleteProgram:function(){},onAddGoal:function(){},onEditGoal:function(){},onDeleteGoal:function(){}})"), UI],
  ['lite’s reference can’t tick a perk', pages("tab==='perks'&&h(CardPerksAll,{cards:cards,perks:perks,onToggle:onToggle,", "tab==='perks'&&h(CardPerksAll,{cards:cards,perks:perks,onToggle:null,"), UI],
  ['the rate can’t be edited in the card pop-up', full('onAddReward:handleAddReward,onEditReward:handleEditReward,', 'onAddReward:handleAddReward,'), UI],
  ['My cards repeats the old cheat sheet', full("part!=='cards'&&/*#__PURE__*/React.createElement(\"div\",{style:{background:'#1a2744'", "/*#__PURE__*/React.createElement(\"div\",{style:{background:'#1a2744'"), UI],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const test = c[2] || TEST;
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
