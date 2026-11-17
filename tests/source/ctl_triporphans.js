// Negative controls for System › Checks › Trip IDs' fixes (keys that name no trip, the Trip
// details repair): break ONE rule at a time and confirm test_triporphans.js (or the panel's
// browser test) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_triporphans');
const FILES = ['Trips.js', 'TripIds.js', 'Code.js', 'WebApp.js', 'Settings.js', 'People.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const NODE = 'test_triporphans.js', UI = 'test_tripids_ui.js';
const MISMATCH = "issues.push({k:x.tab+'m'+m.row,tab:x.tab,row:m.row,kind:'mismatch',text:'Its Trip ID is '+m.id+', but its key \"'+m.key+'\" now names '+m.keyIs+'. Readers follow the ID.'});});";
const CONTROLS = [
  ['register makes a trip on every tap', one('TripIds.js', "    if (!still) return { ok: true, done: 'already', filled: 0 };\n", ''), NODE],
  ['register doesn\'t alias the key', one('TripIds.js', "tidLastItineraryDate_(key) || start, [], key, 'past')", "tidLastItineraryDate_(key) || start, [], '', 'past')"), NODE],
  ['register makes an active trip', one('TripIds.js', "[], key, 'past')", "[], key)"), NODE],
  ['register ends the trip on its first day', one('TripIds.js', "tidLastItineraryDate_(key) || start, [], key", "start, [], key"), NODE],
  ['the IDs wait for the nightly run', one('TripIds.js', "    invalidateTripRegistry_();\n    var filled = tripIdStampAll_();\n    return { ok: true, done: action", "    var filled = null;\n    return { ok: true, done: action"), NODE],
  ['merge ignores the refusal', one('TripIds.js', "      if (!r.applied) return { ok: false, error: (r.refused && r.refused[key]) || 'Not merged' };\n", ''), NODE],
  ['the refusal reason is lost', one('Trips.js', "            refused[orphanKey] = 'Both trips have a different '", "            void 'Both trips have a different '"), NODE],
  ['the TripMeta conflict guard is gone', one('Trips.js', "          if (av && bv && av !== bv) {", "          if (false) {"), NODE],
  ['the suggestion writes the registry', one('Trips.js', "start, start, { mint: false, touch: false });", "start, start, { mint: false });"), NODE],
  ['the fix isn\'t owner only', one('TripIds.js', "function webTripOrphanFix_(p) {\n  var no = peopleOwnerOnly_(); if (no) return no;", "function webTripOrphanFix_(p) {"), NODE],
  ['the repair isn\'t owner only', one('TripIds.js', "function webTripMetaRepair_(p) {\n  var no = peopleOwnerOnly_(); if (no) return no;", "function webTripMetaRepair_(p) {"), NODE],
  ['the list shows the buttons to everyone', one('TripIds.js', "try { canFix = !peopleOwnerOnly_(); } catch (e) { canFix = false; }", "canFix = true;"), NODE],
  ['the dry run writes', one('TripIds.js', "    if (dry) {\n", "    if (dry) { repairTripMeta();\n"), NODE],
  ['the fix reads the route\'s action', one('TripIds.js', "action = String(p.how || '');", "action = String(p.action || '');"), NODE],
  ['no fix route', one('WebApp.js', "case 'trip_orphan_fix':", "case 'trip_orphan_fix_off':"), NODE],
  ['no orphan list route', one('WebApp.js', "case 'trip_orphans':", "case 'trip_orphans_off':"), NODE],
  ['the cards drop back to one per row', ui(MISMATCH + "});", MISMATCH + "(x.unresolved||[]).forEach(function(u){issues.push({k:x.tab+'u'+u.row,tab:x.tab,row:u.row,kind:'blank',text:'No Trip ID: its key \"'+u.key+'\" names no trip in the registry.'});});});"), UI],
  ['the picker ignores the suggestion', ui("sel=pick[o.key]!=null?pick[o.key]:(o.suggestion&&o.suggestion.tripId)||''", "sel=pick[o.key]!=null?pick[o.key]:''"), UI],
  ['merge posts the suggestion, not the pick', ui("var tid=how==='merge'?(pick[o.key]!=null?pick[o.key]:(o.suggestion&&o.suggestion.tripId)||''):'';", "var tid=how==='merge'?((o.suggestion&&o.suggestion.tripId)||''):'';"), UI],
  ['register doesn\'t ask first', ui("if(how==='register'&&!window.confirm(", "if(how==='register'&&false&&window.confirm("), UI],
  ['the repair skips the dry run', ui("onClick:function(){call(true);}},busy==='check'", "onClick:function(){call(false);}},busy==='check'"), UI],
  ['the repair doesn\'t ask first', ui("onClick:function(){if(window.confirm('Repair the Trip details header row now?", "onClick:function(){if(true||window.confirm('Repair the Trip details header row now?"), UI],
  ['the repair card never shows', ui("metaSkipped&&h(TidRepair,", "false&&h(TidRepair,"), UI],
  ['the buttons show for everyone', ui("canFix&&!(m&&!m.bad)&&h(", "!(m&&!m.bad)&&h("), UI],
  ['Leave posts', ui("onClick:function(){setGone(function(p){", "onClick:function(){apiPost(apiUrl,apiToken,{action:'trip_orphan_fix',key:o.key,how:'leave'});setGone(function(p){"), UI],
  ['no Not registered yet group', ui(".concat(others.length?[h(\"optgroup\"", ".concat(false?[h(\"optgroup\""), UI],
  ['the card\'s own key offered', ui("var others=list.filter(function(x){return x.key!==o.key&&", "var others=list.filter(function(x){return "), UI],
  ['an older trip merged with no register first', ui("if(how==='merge'&&tid.indexOf('key:')===0){", "if(false){"), UI],
  ['the merge sent with the picked key, not the new ID', ui("how:'merge',tripId:nid}", "how:'merge',tripId:tk}"), UI],
  ['a refused merge after the register goes unsaid', ui("if(!r2||r2.ok===false){say(o.key,{bad:true,", "if(false){say(o.key,{bad:true,"), UI],
];
let allBit = true;
// The dashboard controls drive a real browser. The CI job that runs controls has none (the
// browser job runs the screens themselves), so there they are skipped and said so; locally they run.
const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();
CONTROLS.forEach(([name, mut, test]) => {
  if (test === UI && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT, f)));
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_CTL_FAST: '1' }) });
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
