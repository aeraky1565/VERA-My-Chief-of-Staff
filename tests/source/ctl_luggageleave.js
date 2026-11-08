// Negative controls for luggage and leaving home (Luggage.js, LeavingHome.js and the LuggageLeave block,
// issues #230 #231): revert ONE rule at a time and confirm test_luggage.js / test_leavinghome.js (server),
// test_luggageleave_ui.js or test_tilenav_ui.js (screen) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_luggageleave_out');

const FILES = ['Luggage.js', 'LeavingHome.js', 'TripReadiness.js', 'FlightStatus.js', 'PreTripBriefing.js', 'Code.js', 'WebApp.js',
  'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const UI = 'test_luggageleave_ui.js', LUT = 'test_luggage.js', LHT = 'test_leavinghome.js', NAV = 'test_tilenav_ui.js';
const lu = (from, to) => b => ({ 'Luggage.js': swap(b['Luggage.js'], from, to) });
const lh = (from, to) => b => ({ 'LeavingHome.js': swap(b['LeavingHome.js'], from, to) });

const CONTROLS = [
  // luggage, server
  ['kg is taken as lb', lu('return luRound_(kg ? n * LU_LB_PER_KG_ : n);', 'return luRound_(n);'), LUT],
  ['a count doesn’t multiply', lu('return luRound_(w * luQty_(s));', 'return luRound_(w);'), LUT],
  ['the passport can go anywhere', lu("if (LU_DOCS_RE_.test(s)) return { place: 'personal', why: 'documents stay with you' };", ''), LUT],
  ['batteries can be checked', lu("if (LU_BATTERY_RE_.test(s)) return { place: 'carry', why: 'chargers and batteries: never checked' };", ''), LUT],
  ['a 250 ml liquid rides in the cabin', lu('return ml > 100 ?', 'return ml > 1000 ?'), LUT],
  ['a fragile gift can go anywhere', lu("if (packsAs === 'fragile') return { place: 'checked', why: 'fragile: wrap in clothes' };", ''), LUT],
  ['laundry is ignored', lu('if (nights >= 8 && !o.laundry)', 'if (nights >= 8)'), LUT],
  ['a made-up carry-on next to the checked bag', lu("var cb = pick('carry-on', need.checked);", "var cb = pick('carry-on', false);"), LUT],
  ['a shared bag goes to two people', lu('if (b) { taken[b.id] = 1;', 'if (b) {'), LUT],
  ['the bag’s own weight isn’t counted', lu('var w = b.emptyLb + b.items.reduce', 'var w = 0 + b.items.reduce'), LUT],
  ['no warning near the limit', lu("w >= b.limitLb * 0.8 ? 'near'", "w >= b.limitLb * 2 ? 'near'"), LUT],
  ['moves are ignored', lu('var moved = moves[i.key] && chosen.filter', 'var moved = false && chosen.filter'), LUT],
  ['no warning when meds go in the hold', lu("if (moved && (i.place === 'personal' || i.place === 'carry') && moved.type === 'checked') {", 'if (false) {'), LUT],
  ['Basic Economy keeps a carry-on', lu('need = { personal: true, carry: !basic, checked: false }', 'need = { personal: true, carry: true, checked: false }'), LUT],
  ['partner status is ignored', lu("if (rel === 'partner' && tier &&", 'if (false && tier &&'), LUT],
  ['card perks are ignored', lu("String(k.card || '').toLowerCase().indexOf(a.name) !== -1; })[0];", 'false; })[0];'), LUT],
  ['road trips get airline rules', lu('var airline = road ? null : luAirline_(', 'var airline = luAirline_('), LUT],
  ['a move forgets the earlier ones', lu('if (bag) o.moves[item] = bag; else delete o.moves[item];', 'o.moves = {}; if (bag) o.moves[item] = bag;'), LUT],
  ['a bag in kg is saved as lb', lu('luParseWeight_(body.weight, body.unit)', "luParseWeight_(body.weight, 'lb')"), LUT],
  // leaving home, server
  ['summer is June to August', lh("if (group === 'summer') return m >= 5 && m <= 9;", "if (group === 'summer') return m >= 6 && m <= 8;"), LHT],
  ['winter is December to February', lh('return m >= 11 || (m >= 1 && m <= 3);', 'return m >= 12 || (m >= 1 && m <= 2);'), LHT],
  ['the empty-house items always show', lh("if (group === 'empty') return !!ctx.empty;", "if (group === 'empty') return true;"), LHT],
  ['1 hour before the flight', lh('return lhAddMin_(t, -120);', 'return lhAddMin_(t, -60);'), LHT],
  ['a tick forgets who and when', lh("run.ticks[key] = { by: lhStr_(body.by, 40), at: lhStamp_() };", "run.ticks[key] = { by: '', at: '' };"), LHT],
  ['the starter list is added every time', lh('if (sh.getLastRow() < 2 && seed) {', 'if (seed) {'), LHT],
  ['the morning message repeats', lh('return r.leaveAt && !r.sent && r.leaveAt <= now', 'return r.leaveAt && r.leaveAt <= now'), LHT],
  ['the morning message goes early', lh('&& r.leaveAt <= now && now <', '&& now <'), LHT],
  ['a message with nothing left', lh('if (list.left > 0) {', 'if (true) {'), LHT],
  ['a new leave time never resends', lh("if (at !== run.leaveAt) run.sent = '';", ''), LHT],
  ['the email lists a done list', lh('if (!list.total || !list.left) return null;', 'if (!list.total) return null;'), LHT],
  ['the 15-minute check doesn’t run it', b => ({ 'FlightStatus.js': swap(b['FlightStatus.js'], "if (typeof lhMorningCheck_ === 'function') lhMorningCheck_();", '') }), LHT],
  ['the night-before plain text leaves it out', b => ({ 'PreTripBriefing.js': swap(b['PreTripBriefing.js'], "if (leaveHome) plain.push(leaveHome.text, '');", '') }), LHT],
  ['ticks aren’t routed', b => ({ 'WebApp.js': swap(b['WebApp.js'], "      case 'lh_tick':                    return jsonOut_(webLhTick_(body));\n", '') }), LHT],
  // screens
  ['the kg switch changes nothing', both("function luW_(lb,unit){var n=Number(lb)||0;return unit==='kg'?", "function luW_(lb,unit){var n=Number(lb)||0;return false?")],
  ['kg isn’t remembered', both("function luUnitSet_(u){try{window.localStorage.setItem('vera_lu_unit',u);}catch(e){}}", 'function luUnitSet_(u){}')],
  ['Move to does nothing', both("onChange:function(e){move(i.key,e.target.value);}", 'onChange:function(){}')],
  ['you are shown by name', both('function luName_(name,who){return who&&', 'function luName_(name,who){return false&&')],
  ['no airline box', both(":d.airline?h('div',{className:'lu-air'", ":false?h('div',{className:'lu-air'")],
  ['a bag saved in kg is sent as lb', both("Object.assign({action:'lu_bag_save',unit:unit},f)", "Object.assign({action:'lu_bag_save'},f)")],
  ['a tick sends nothing', both("onChange:function(e){post('lh_tick',{key:i.key,done:e.target.checked});}", 'onChange:function(){}')],
  ['who ticked isn’t shown', both("(i.done&&i.by?' · ticked by '+luName_(i.by,props.who)+(i.at?' · '+i.at:''):'')", "''")],
  ['Heading out counts every item', both('lhAppliesC_(t.group,month,Number(a.nights)||0,empty)', 'true')],
  ['who’s leaving can’t be changed', both("post('lh_run_set',{leaving:next});", "post('lh_run_set',{});")],
  ['the trip summary has no checklist', both('    h(TsLeaveHome,{trip:trip,apiUrl:props.apiUrl,apiToken:props.apiToken,who:props.who,card:card,label:label}),\n', '')],
  ['lite packing has no card', b => ({ [L]: swap(b[L], '<><LuggageCard apiUrl=', '<><LuggageCardX apiUrl=') })],
  ['Victoria can’t reach Our bags', both("{id:'travelers',label:'Travelers',icon:'🎒',items:['profiles','bags']}", "{id:'travelers',label:'Travelers',icon:'🎒',items:['profiles']}"), NAV],
  ['Victoria can’t reach the Bucket List', both("{id:'bucketlist',label:'Bucket List',icon:'🪣',items:['bucketlist']},", ''), NAV],
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
