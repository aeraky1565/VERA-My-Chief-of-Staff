// Negative controls for the Script Properties panel, placeholders and the Access tab
// filling itself: revert ONE rule at a time and confirm a test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_scriptprops');
const FILES = ['Settings.js', 'ScriptProps.js', 'People.js', 'WebApp.js', 'Code.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const SET = 'test_settings.js', SP = 'test_scriptprops.js', PPL = 'test_people.js', SPUI = 'test_scriptprops_ui.js', PUI = 'test_people_ui.js';
const UIS = [SPUI, PUI];
const CONTROLS = [
  // placeholders
  ['PASTE_ isn\'t a placeholder', one('Settings.js', "return /^PASTE_/i.test(t) ||", "return"), SET],
  ['a placeholder in Config wins', one('Settings.js', "  if (cfg) v = veraReal_(cfg[veraSettingRow_(k)]);", "  if (cfg) v = String(cfg[veraSettingRow_(k)] == null ? '' : cfg[veraSettingRow_(k)]).trim();"), SET],
  ['the move leaves a placeholder cell alone', one('Settings.js', "have = at[row] ? veraReal_(at[row].value) : '';", "have = at[row] ? at[row].value : '';"), SET],
  ['the move copies a placeholder in', one('Settings.js', "var raw = String(props.getProperty(k) || '').trim(), prop = veraReal_(raw);", "var raw = String(props.getProperty(k) || '').trim(), prop = raw;"), SET],
  ['the nightly copy keeps placeholders', one('Settings.js', "    var v = veraReal_(cfg[veraSettingRow_(k)]);", "    var v = String(cfg[veraSettingRow_(k)] == null ? '' : cfg[veraSettingRow_(k)]).trim();"), SET],
  // the panel's server side
  ['a value leaks into the list', b => ({ 'ScriptProps.js': swap(swap(b['ScriptProps.js'], "    g.other.push({ name: n, note: '' });", "    g.other.push({ name: n, note: String(((info || {})[n] || {}).v || '') });"),
     "var v = all[n], i = { placeholder: veraIsPlaceholder_(v) };", "var v = all[n], i = { placeholder: veraIsPlaceholder_(v), v: v };") }), SP],
  ['a secret\'s value leaks into its note', one('ScriptProps.js', "    if (SP_SECRET_RE_.test(n)) return g.secret.push({ name: n, note: i.placeholder ?", "    if (SP_SECRET_RE_.test(n)) return g.secret.push({ name: n, note: String(spInspect_().all[n]) || i.placeholder ?"), SP],
  ['state names taken for secrets', one('ScriptProps.js', "    if (old[n]) return g.old.push(", "    if (old[n] && !SP_SECRET_RE_.test(n)) return g.old.push("), SP],
  ['secrets fall into running notes', one('ScriptProps.js', "    if (SP_SECRET_RE_.test(n)) return g.secret.push(", "    if (false) return g.secret.push("), SP],
  ['an old copy is removable whether or not it\'s in its home', one('ScriptProps.js', "removable: !!i.inHome });", "removable: true });"), SP],
  ['clean removes every old copy', one('ScriptProps.js', "      if (spInHome_(n, s.old[n], s.all[n], s.props)) { s.props.deleteProperty(n); removed.push(n); }", "      if (true) { s.props.deleteProperty(n); removed.push(n); }"), SP],
  ['a state copy counts as home without its value', one('ScriptProps.js', "return b[name] != null && String(b[name]) === String(value);", "return true;"), SP],
  ['the list isn\'t the owner\'s', one('ScriptProps.js', "function webScriptProps_() {\n  var no = peopleOwnerOnly_(); if (no) return no;", "function webScriptProps_() {"), SP],
  ['clean isn\'t the owner\'s', one('ScriptProps.js', "function webScriptPropsClean_() {\n  var no = peopleOwnerOnly_(); if (no) return no;", "function webScriptPropsClean_() {"), SP],
  ['the why for a placeholder Config cell is lost', one('ScriptProps.js', "  if (veraIsPlaceholder_(c)) return 'Config holds a placeholder: “Move settings now” puts the real value there';\n", ''), SP],
  ['no route for the list', one('WebApp.js', "      case 'script_props':          return jsonOut_(webScriptProps_());   // ScriptProps.js: names only, owner\n", ''), SP],
  // the Access tab
  ['the dashboard\'s list isn\'t saved', one('People.js', "if (JSON.stringify(cat) !== JSON.stringify(accessCatalogRead_())) veraStoreSet_(ACCESS_CATALOG_KEY_, JSON.stringify(cat));", "void 0;"), PPL],
  ['the list is re-saved every time', one('People.js', "if (JSON.stringify(cat) !== JSON.stringify(accessCatalogRead_())) veraStoreSet_", "veraStoreSet_"), PPL],
  ['the nightly fill does nothing', one('People.js', "  return accessSyncWith_(cat, 'nightly');", "  return { ok: true, addedRows: 0, addedCols: [] };"), PPL],
  ['a failed write is swallowed', one('People.js', "      try { veraLog_('accessSync', 'System', 'Warning',", "      try { void ('accessSync', 'System', 'Warning',"), PPL],
  ['the nightly run doesn\'t call it', one('Code.js', "    nightlyStep_(ctx, 'accessNightlySync_', accessNightlySync_);\n", ''), PPL],
  ['the People panel isn\'t told the tab is empty', one('People.js', "access: { rows: accessCounts_(v, '').total, listSaved: accessCatalogRead_().length > 0 } };", "};"), PPL],
  // the dashboard
  ['"propertys"', ui("pl(d.total,'property','properties')", "pl(d.total,'property')"), SPUI],
  ['remove doesn\'t ask', ui("if(window.confirm('Remove '+pl(removable,'old copy','old copies')+'? Each one is checked against its new home first.'))act(", "if(true)act("), SPUI],
  ['remove counts every old copy', ui("removable=(g.old||[]).filter(function(x){return x.removable;}).length", "removable=(g.old||[]).length"), SPUI],
  ['the panel isn\'t in System', ui(",cur==='script_props'&&h(SysScriptProps,{apiUrl:apiUrl,apiToken:apiToken})", ''), SPUI],
  ['opening People doesn\'t sync', ui("React.useEffect(function(){apiPost(apiUrl,apiToken,syncBody()).catch(function(){}).then(load);},[apiUrl,apiToken]);", "React.useEffect(load,[apiUrl,apiToken]);"), PUI],
  ['an empty Access tab says nothing', ui("d.access&&!d.access.rows&&h(", "false&&h("), PUI],
];
let allBit = true;
// The dashboard controls drive a real browser. The CI job that runs controls has none (the
// browser job runs the screens themselves), so there they are skipped and said so; locally they run.
const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();
CONTROLS.forEach(([name, mut, test]) => {
  if (UIS.indexOf(test) !== -1 && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT, f)));
  // test_settings reads every .js at the root (the call sites), so the rest come along unchanged.
  fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js') && !files[f]).forEach(f => fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT, f)));
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
