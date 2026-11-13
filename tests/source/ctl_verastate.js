// Negative controls for Script Properties batch 2: revert ONE rule at a time and
// confirm test_verastate.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_verastate');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const S = 'Settings.js';
const CONTROLS = [
  ['old properties no longer read', b => ({ [S]: swap(b[S], "    var old = props.getProperty(n);\n    if (old != null && old !== '') out[n] = String(old);\n  });\n  return out;", "  });\n  return out;") })],
  ['a write forgets what was there', b => ({ [S]: swap(b[S], "  var cur = veraStateGet_(bundle);\n  Object.keys(patch || {})", "  var cur = {};\n  Object.keys(patch || {})") })],
  ['old properties left behind', b => ({ [S]: swap(b[S], "    names.forEach(function(n) { if (props.getProperty(n) != null) props.deleteProperty(n); });\n  }\n  return cur;", "  }\n  return cur;") })],
  ['old properties dropped without a read-back', b => ({ [S]: swap(b[S], "  if ((Object.keys(cur).length ? back === next : back == null)) {", "  if (true) {") })],
  ['clearing a value is ignored', b => ({ [S]: swap(b[S], "    if (v == null || v === '') delete cur[k]; else cur[k] = String(v);", "    cur[k] = String(v == null ? '' : v);") })],
  ['any name is accepted', b => ({ [S]: swap(b[S], "    if (names.indexOf(k) === -1) throw new Error('veraState: ' + k + ' is not in ' + bundle);\n", "") })],
  ['an empty bundle is kept', b => ({ [S]: swap(b[S], "  else if (props.getProperty(prop) != null) props.deleteProperty(prop);\n", "  else props.setProperty(prop, next);\n") })],
  ['the tab is shown', b => ({ [S]: swap(b[S], "    try { sh.hideSheet(); } catch (e) {}\n", "") })],
  ['the tab is read on every lookup', b => ({ [S]: swap(b[S], "  if (_veraStoreCache_) return _veraStoreCache_;\n", "") })],
  ['every write appends a row', b => ({ [S]: swap(b[S], "    if (rows[key]) sh.getRange(rows[key].row, 2, 1, 2).setValues([[v, now]]);\n    else { sh.appendRow([key, v, now]); rows[key] = { row: sh.getLastRow(), value: v }; }", "    sh.appendRow([key, v, now]); rows[key] = rows[key] || { row: sh.getLastRow(), value: v };") })],
  ['no fallback when the tab can\'t be written', b => ({ [S]: swap(b[S], "    try { props.setProperty(key, v); } catch (e) {}\n    return false;", "    return false;") })],
  ['the cache property dropped even when the write failed', b => ({ [S]: swap(b[S], "    ok = String(sh.getRange(rows[key].row, 2).getValue()) === v;", "    ok = true;") })],
  ['the old cache property is never read', b => ({ [S]: swap(b[S], "  try { return PropertiesService.getScriptProperties().getProperty(key); } catch (e) { return null; }\n}", "  return null;\n}") })],
  ['oversize values are written anyway', b => ({ [S]: swap(b[S], "  if (v.length > VERA_STORE_MAX_) {", "  if (false) {") })],
  ['the move skips the caches', b => ({ [S]: swap(b[S], "    if (veraStoreSet_(k, old)) out.stores.push(k); else out.storesKept.push(k);", "    out.storesKept.push(k);") })],
  ['the move skips the feature state', b => ({ [S]: swap(b[S], "    veraStateSet_(b, {});\n", "") })],
  ['the move logs values', b => ({ [S]: swap(b[S], "    '; feature state bundled ' + out.state.length +", "    '; feature state bundled ' + out.state.length + JSON.stringify(VERA_STORE_KEYS_.map(veraStoreGet_)) +") })],
  ['one capacity bundle for both', b => ({ 'Code.js': swap(b['Code.js'], "  veraStateProps_('CAPACITY_INFERRED').setProperties({\n    capacity_inferred_mode: mode,", "  veraStateProps_('CAPACITY_OVERRIDE').setProperties({\n    capacity_inferred_mode: mode,") })],
  ['pacing back on Script Properties', b => ({ 'Pacing.js': swap(b['Pacing.js'], "  var ss    = getSpreadsheet();\n  var props = veraStateProps_('PACING');\n  var tz    = Session.getScriptTimeZone();", "  var ss    = getSpreadsheet();\n  var props = PropertiesService.getScriptProperties();\n  var tz    = Session.getScriptTimeZone();") })],
  ['the weekend history back on its property', b => ({ 'WeekendPlanner.js': swap(b['WeekendPlanner.js'], "    veraStoreSet_('WKND_PLAN_HISTORY', JSON.stringify(updated));", "    PropertiesService.getScriptProperties().setProperty('WKND_PLAN_HISTORY', JSON.stringify(updated));") })],
  ['the watchdog stamp moved into the bundle', b => ({ 'MailCounter.js': swap(b['MailCounter.js'], "    props.setProperty('USPS_SCAN_START', new Date().toISOString());", "    mail.setProperty('USPS_SCAN_START', new Date().toISOString());") })],
  ['the tab left out of the styling', b => ({ 'SheetStyle.js': swap(b['SheetStyle.js'], ", 'Reminders Memory', 'VERA State'],", ", 'Reminders Memory'],") })],
  ['the styling moves a hidden tab', b => ({ 'SheetStyle.js': swap(b['SheetStyle.js'], "      if (sh.isSheetHidden && sh.isSheetHidden()) return;\n", "") })],
];
let allBit = true;
CONTROLS.forEach(([name, mut]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const r = cp.spawnSync('node', ['test_verastate.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name);
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
