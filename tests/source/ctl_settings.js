// Negative controls for the Script Properties cleanup: revert ONE rule at a time and
// confirm test_settings.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_settings');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const S = 'Settings.js';
const CONTROLS = [
  ['the property beats the Config row', b => ({ [S]: swap(b[S], "  if (cfg) v = veraReal_(cfg[veraSettingRow_(k)]);\n  if (v) return v;\n", "") })],
  ['the copy is used even when Config reads fine', b => ({ [S]: swap(b[S], "  if (cfg && Object.keys(cfg).length) return '';\n", "") })],
  ['a pasted link is taken as the id', b => ({ [S]: swap(b[S], "  if (m) return m[1];\n", "  if (m) return t;\n") })],
  ['the copy is rewritten every night', b => ({ [S]: swap(b[S], "  if (next === was) return { written: false, count: Object.keys(copy).length };\n", "") })],
  ['an unreadable Config tab blanks the copy', b => ({ [S]: swap(b[S], "  try { cfg = getConfigValues() || {}; } catch (e) { return { written: false, reason: 'config unreadable' }; }\n  if (!Object.keys(cfg).length) return { written: false, reason: 'config unreadable' };", "  try { cfg = getConfigValues() || {}; } catch (e) { cfg = {}; }") })],
  ['an old marker property no longer counts', b => ({ [S]: swap(b[S], "  var old = props.getProperty(name);\n  return old ? String(old) : null;", "  return null;") })],
  ['setting a marker leaves its old property', b => ({ [S]: swap(b[S], "  try { if (props.getProperty(name) != null) props.deleteProperty(name); } catch (e) {}\n}", "}") })],
  ['the move overwrites a different Config value', b => ({ [S]: swap(b[S], "      else out.kept.push(k);\n      return;\n    }", "      else { sheet.getRange(at[row].row, 2).setValue(prop); props.deleteProperty(k); out.moved.push(k); }\n      return;\n    }") })],
  ['the move deletes without reading back', b => ({ [S]: swap(b[S], "    if (back && back.value === prop) { props.deleteProperty(k); out.moved.push(k); }", "    if (true) { props.deleteProperty(k); out.moved.push(k); }") })],
  ['the log carries values', b => ({ [S]: swap(b[S], "  Logger.log('moveSettingsToConfig: moved ' + out.moved.length +", "  Logger.log(JSON.stringify(props.getProperties ? {} : {}) + VERA_SETTINGS_.map(function(k){ return veraSetting_(k); }).join(',') + 'moveSettingsToConfig: moved ' + out.moved.length +") })],
  ['markers are not bundled by the move', b => ({ [S]: swap(b[S], "    veraOnceSet_(m, old);\n    out.markers.push(m);", "    out.markers.push(m);") })],
  ['a marker read straight from its property again', b => ({ 'Places.js': swap(b['Places.js'], "veraOnceGet_(PL_MOVED_PROP_)", "PropertiesService.getScriptProperties().getProperty(PL_MOVED_PROP_)") })],
  ['a setting read straight from Script Properties again', b => ({ 'Budget.js': swap(b['Budget.js'], "veraSettingId_('SAT_SHEET_ID')", "PropertiesService.getScriptProperties().getProperty('SAT_SHEET_ID')") })],
  ['the morning email fixed at load time', b => ({ 'Code.js': swap(b['Code.js'], "  get MORNING_NUDGE_EMAIL() { return veraSetting_('MORNING_NUDGE_EMAIL'); },", "  MORNING_NUDGE_EMAIL: veraSetting_('MORNING_NUDGE_EMAIL'),") })],
  ['a doc id written back into code', b => ({ 'FinancialGoals.js': swap(b['FinancialGoals.js'], "function readLifePlanDoc_() {", "var LIFE_PLAN_FALLBACK_ = 'InventedDocIdAbc0123456789Defghijklmnopqrs';\nfunction readLifePlanDoc_() {") })],
  ['the nightly refresh dropped', b => ({ 'Code.js': swap(b['Code.js'], "    nightlyStep_(ctx, 'veraSettingsCopyRefresh_', veraSettingsCopyRefresh_);\n", "") })],
  ['saving a setting keeps the old property', b => ({ [S]: swap(b[S], "  try { var props = PropertiesService.getScriptProperties(); if (props.getProperty(k) != null) props.deleteProperty(k); } catch (e) {}\n  return true;", "  return true;") })],
  ['the HOA link saved to Script Properties again', b => ({ 'WebApp.js': swap(b['WebApp.js'], "    if (!veraSetSetting_(NEIGHBORHOOD_HOA_URL_KEY, url)) return { ok: false, error: 'Config sheet not found' };", "    PropertiesService.getScriptProperties().setProperty(NEIGHBORHOOD_HOA_URL_KEY, url);") })],
];
let allBit = true;
CONTROLS.forEach(([name, mut]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const r = cp.spawnSync('node', ['test_settings.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
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
