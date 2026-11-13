// Negative controls for #242: revert ONE rule at a time and confirm
// test_sheetwrites.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_sheetwrites');
const FILES = ['Settings.js', 'PTO.js', 'Groceries.js', 'WebApp.js', 'Habits.js', 'Memory.js', 'SignalLearning.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const S = 'Settings.js';
const CONTROLS = [
  ['the script lock instead of the user lock', b => ({ [S]: swap(b[S], "lock = LockService.getUserLock(); got = lock.tryLock", "lock = LockService.getScriptLock(); got = lock.tryLock") })],
  ['the lock is never released', b => ({ [S]: swap(b[S], "  finally { _veraLockDepth_--; if (got) { try { lock.releaseLock(); } catch (e) {} } }", "  finally { _veraLockDepth_--; }") })],
  ['nested calls lock again', b => ({ [S]: swap(b[S], "  if (_veraLockDepth_ > 0) return fn();\n", "") })],
  ['a busy lock skips the write', b => ({ [S]: swap(b[S], "  if (!got) { try { Logger.log('veraLocked_: the lock stayed busy; going ahead without it'); } catch (e) {} }", "  if (!got) return null;") })],
  ['Config written without the lock', b => ({ [S]: swap(b[S], "  return veraLocked_(function() {\n    var sheet = getSpreadsheet().getSheetByName(TABS.CONFIG);", "  return (function(f) { return f(); })(function() {\n    var sheet = getSpreadsheet().getSheetByName(TABS.CONFIG);") })],
  ['the note dropped', b => ({ [S]: swap(b[S], "    else sheet.appendRow(note == null ? [k, value] : [k, value, note]);", "    else sheet.appendRow([k, value]);") })],
  ['caches not cleared', b => ({ [S]: swap(b[S], "    try { _configCache_ = null; } catch (e) {}\n    try { if (typeof invalidatePTOConfigRows_", "    try { if (typeof invalidatePTOConfigRows_") })],
  ['IDs counted, not maxed', b => ({ [S]: swap(b[S], "    if (!isNaN(n) && n > max) max = n;", "    if (!isNaN(n)) max++;") })],
  ['a PTO writer appends on its own again', b => ({ 'PTO.js': swap(b['PTO.js'], "  setConfigRow_(key, value);   // locked, Settings.js (#242)", "  var sh = getSpreadsheet().getSheetByName(TABS.CONFIG); sh.appendRow([key, value]);") })],
  ['the notification switch writes its own row', b => ({ 'WebApp.js': swap(b['WebApp.js'], "  setConfigRow_(configKey, value);   // locked, Settings.js (#242)", "  sheet.appendRow([configKey, value]);") })],
  ['habits minted by counting again', b => ({ 'Habits.js': swap(b['Habits.js'], "    var id = veraNextSeqId_('HAB-' + dateStr + '-', ids, 2);", "    var id = 'HAB-' + dateStr + '-' + String(ids.length + 1).padStart(2, '0');") })],
  ['habits minted outside the lock', b => ({ 'Habits.js': swap(b['Habits.js'], "  return veraLocked_(function() {\n    var ids = sheet.getLastRow()", "  return (function(f) { return f(); })(function() {\n    var ids = sheet.getLastRow()") })],
  ['memory minted by counting again', b => ({ 'Memory.js': swap(b['Memory.js'], "    var id  = veraNextSeqId_('MEM-' + dateKey + '-', ids, 3);", "    var seq = 1; ids.forEach(function() { seq++; });\n    var id  = 'MEM-' + dateKey + '-' + String(seq).padStart(3, '0');") })],
  ['signal counters outside the lock', b => ({ 'SignalLearning.js': swap(b['SignalLearning.js'], "  return veraLocked_(function() { return slRecordFlagOutcome_(flagKey, outcome); });", "  return slRecordFlagOutcome_(flagKey, outcome);") })],
];
let allBit = true;
CONTROLS.forEach(([name, mut]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const r = cp.spawnSync('node', ['test_sheetwrites.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
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
