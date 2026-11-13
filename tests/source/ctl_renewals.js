// Negative controls for #245: revert ONE rule at a time and confirm test_renewals.js (or the
// browser test, test_vehicles_ui.js) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_renewals');
const FILES = ['Renewals.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const R = 'Renewals.js', W = 'WebApp.js', C = 'Code.js', APP = 'docs/app.js', LITE = 'docs/dashboard-lite.html', IDX = 'docs/index.html';
const card = (from, to) => b => ({ [APP]: swap(b[APP], from, to), [IDX]: swap(b[IDX], from, to), [LITE]: swap(b[LITE], from, to) });
const NODE = 'test_renewals.js', UI = 'test_vehicles_ui.js';
const CONTROLS = [
  ['31 days out flags', b => ({ [R]: swap(b[R], "var RENEWAL_AHEAD_DAYS_ = 30;", "var RENEWAL_AHEAD_DAYS_ = 31;") }), NODE],
  ['no Medium step', b => ({ [R]: swap(b[R], "  if (days <= 14) return 'med';\n", "") }), NODE],
  ['High only once passed', b => ({ [R]: swap(b[R], "  if (days < 0 || days <= 7) return 'high';", "  if (days < 0) return 'high';") }), NODE],
  ['warranties climb the ladder', b => ({ [R]: swap(b[R], "  if (kind === 'warranty') return days <= RENEWAL_AHEAD_DAYS_ && days >= -RENEWAL_AHEAD_DAYS_ ? 'low' : '';\n", "") }), NODE],
  ['ended warranties stay in Coming up', b => ({ [R]: swap(b[R], "if (it.kind === 'warranty' && days < -RENEWAL_AHEAD_DAYS_) {", "if (false) {") }), NODE],
  ['passed wording lost', b => ({ [R]: swap(b[R], "' passed on ' + renewalShort_(date, todayIso) + ': renewed? Update the tab')", "' passed')") }), NODE],
  ['the key ignores the date (a renewal never resolves)', b => ({ [R]: swap(b[R], "item.flagKey = 'vehicle_renewal_' + id + '_' + it.key + '_' + date;", "item.flagKey = 'vehicle_renewal_' + id + '_' + it.key;") }), NODE],
  ['no due date on the flag', b => ({ [R]: swap(b[R], "urgency: it.urgency, due: it.date };", "urgency: it.urgency };") }), NODE],
  ['inspections left out', b => ({ [R]: swap(b[R], "  { key: 'emission',     col: 'Emission Inspection Expiry',   label: 'Emission inspection',       kind: 'renew',    verb: 'expires' },\n", "") }), NODE],
  ['urgency ignored in the order', b => ({ [R]: swap(b[R], "    var r = RENEWAL_RANK_[a.status] - RENEWAL_RANK_[b.status];\n    if (r) return r;\n", "") }), NODE],
  ['undated miles count as fresh', b => ({ [R]: swap(b[R], "(milesAge == null || milesAge > RENEWAL_MILES_STALE_DAYS_)", "(milesAge != null && milesAge > RENEWAL_MILES_STALE_DAYS_)") }), NODE],
  ['a miles flag every night', b => ({ [R]: swap(b[R], "out.miles['vehicle_miles_' + id + '_' + todayIso.slice(0, 7)]", "out.miles['vehicle_miles_' + id + '_' + todayIso]") }), NODE],
  ['the reminder on the deadline', b => ({ [R]: swap(b[R], "  var d = renewalAddDays_(dateIso, -7);", "  var d = dateIso;") }), NODE],
  ['the reminder can be in the past', b => ({ [R]: swap(b[R], "  return d < todayIso ? todayIso : d;", "  return d;") }), NODE],
  ['no alert', b => ({ [R]: swap(b[R], "'TRIGGER:PT9H'", "'TRIGGER:PT0H'") }), NODE],
  ['service renewable by date', b => ({ [R]: swap(b[R], "if (RENEWAL_ITEMS_[i].key === key && RENEWAL_ITEMS_[i].kind !== 'service')", "if (RENEWAL_ITEMS_[i].key === key)") }), NODE],
  ['renew writes outside the lock', b => ({ [R]: swap(b[R], "  return veraLocked_(function() {\n    var sheet = getSpreadsheet().getSheetByName(TABS.VEHICLES);\n    var f = {}; f[col] = date;", "  return (function(fn) { return fn(); })(function() {\n    var sheet = getSpreadsheet().getSheetByName(TABS.VEHICLES);\n    var f = {}; f[col] = date;") }), NODE],
  ['miles not stamped', b => ({ [W]: swap(b[W], "  if (fields['Current Mileage'] !== undefined && fields['Current Mileage'] !== '' && fields['Mileage Updated'] === undefined) {", "  if (false) {") }), NODE],
  ['an older tab gets no new column', b => ({ [W]: swap(b[W], "  if (sheet.getMaxColumns && need > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), need - sheet.getMaxColumns());\n", "") }), NODE],
  ['not in the nightly run', b => ({ [C]: swap(b[C], "    nightlyStep_(ctx, 'checkVehicleRenewals_', checkVehicleRenewals_);\n", "") }), NODE],
  ['held while away', b => ({ [C]: swap(b[C], "stale miles once a month', locked: false, whileAway: 'due' }", "stale miles once a month', locked: false, whileAway: 'hold' }") }), NODE],
  ['the reminder button on every flag', b => ({ [APP]: swap(b[APP], "var m=/^vehicle_renewal_(.+)_(registration|insurance|service|emission|safety|warranty_b2b|warranty_pt)_(\\d{4}-\\d{2}-\\d{2})$/.exec(String(key||''));", "var m=/^(.+)_(.+)_(.+)$/.exec(String(key||''));") }), NODE],
  ['Renewed… offers today, not a year on', card("setVals(act==='renew'?{date:vhPlusYear_(it.date)}", "setVals(act==='renew'?{date:vhToday_()}"), UI],
  ['the stale note never shows', card("      stale&&h('div',{className:'vh-stale'", "      false&&h('div',{className:'vh-stale'"), UI],
  ['Remove deletes at once', card("onClick:function(){setDelAsk(id);}},'Remove vehicle')", "onClick:function(){call({action:'delete_vehicle',id:id},id,'Removed.');}},'Remove vehicle')"), UI],
  ['every card starts folded', card("return Object.prototype.hasOwnProperty.call(openMap,k)?!!openMap[k]:vhNeeds_(v);", "return Object.prototype.hasOwnProperty.call(openMap,k)?!!openMap[k]:false;"), UI],
  ['the fold isn’t remembered', card("setOpenMap(n);vhFoldWrite_(n);", "setOpenMap(n);"), UI],
  ['a folded card shows no chip', card("function vhTop_(v){var it=(v.comingUp||[]).filter(function(x){return x.status!=='ok';})[0];return it?{status:it.status,text:it.label+': '+it.chip}:{status:'ok',text:'All OK'};}", "function vhTop_(v){return {status:'ok',text:''};}"), UI],
  ['the icon ignores the body', card("var d=VH_BODIES[p.body]||VH_BODIES.sedan;", "var d=VH_BODIES.sedan;p={body:'sedan'};"), UI],
  ['Body Type ignored', b => ({ [R]: swap(b[R], "  if (RENEWAL_BODIES_.indexOf(set) !== -1) return set;\n", "") }), NODE],
  ['any body accepted', b => ({ [R]: swap(b[R], "  if (RENEWAL_BODIES_.indexOf(body) === -1) return { ok: false, error: 'body must be one of ' + RENEWAL_BODIES_.join(', ') };\n", "") }), NODE],
  ['History open from the start', card("return h('details',{className:'vh-fold',", "return h('details',{className:'vh-fold',open:true,"), UI],
];
let allBit = true;
CONTROLS.forEach(([name, mut, test]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT, f)));
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
