// Negative controls for the Run Log (RunLog.js, its hooks, System › Checks › Run log):
// revert ONE rule at a time and confirm test_runlog.js (server) or test_runlog_ui.js (screen) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_runlog_out');

const FILES = ['NightlyRunner.js', 'RunLog.js', 'Code.js', 'Watchdog.js', 'VERALog.js', 'WebApp.js', 'Reminders.js', 'GymTracker.js', 'FlightStatus.js', 'EmailParser.js',
  'MailCounter.js', 'NeighborhoodWatcher.js', 'docs/app.js', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html';
const full = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });
const UI = 'test_runlog_ui.js', SRV = 'test_runlog.js';
const on = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const rl = (from, to) => on('RunLog.js', from, to);

const CONTROLS = [
  ['the row is only written at the end', rl('    sheet.appendRow(row);\n', '\n'), SRV],
  ['every step writes the row', rl('if (r.steps % RUN_LOG_EVERY_ !== 0 && now - r.wrote < RUN_LOG_EVERY_MS_) return;', 'if (false) return;'), SRV],
  ['another job’s heartbeat finishes the row', rl('if (!r || job !== r.fn) return;', 'if (!r) return;'), SRV],
  ['errors keep their secrets', rl("red(errs.join('; '))", "(errs.join('; '))"), SRV],
  ['a skipped step still reads Done', rl("|| (c.skipped || []).length ", ''), SRV],
  ['dashboard calls are logged', rl("if (arg !== undefined && (arg === null || typeof arg !== 'object')) return null;", ''), SRV],
  ['a nested job adds its own row', rl('if (_runLog_) return null;', ''), SRV],
  ['a run still going is marked Cut off', rl('if (isNaN(t) || now - t < RUN_LOG_STALE_MS_) continue;', 'if (isNaN(t)) continue;'), SRV],
  ['every cut-off row takes the breadcrumb', rl('if (!took[f] && crumbs && crumbs[f])', 'if (crumbs && crumbs[f])'), SRV],
  ['the setting is ignored', rl('_runLogSS_ = id ? SpreadsheetApp.openById(id) : getSpreadsheet();', '_runLogSS_ = getSpreadsheet();'), SRV],
  ['the logs sheet gets one shared tab, not a tab per job', rl('return own ? RUN_LOG_TAB_ : (RUN_LOG_TABS_[fn] || String(fn || \'Other\'));', 'return RUN_LOG_TAB_;'), SRV],
  ['VERA’s own sheet gets a tab per job', rl('return own ? RUN_LOG_TAB_ : (RUN_LOG_TABS_[fn]', 'return false ? RUN_LOG_TAB_ : (RUN_LOG_TABS_[fn]'), SRV],
  ['the hourly sweep reads only one tab', rl('if (!sheet) return runLogTabsToRead_().reduce(', 'if (!sheet) return [runLogTabsToRead_()[0]].reduce('), SRV],
  ['the card gets a plain list, the 15-minute job crowding out the rest', rl('if (list.length >= per) continue;', ''), SRV],
  ['the retired second half still shows on the card', rl('if (!fn || RUN_LOG_RETIRED_.indexOf(fn) !== -1) continue;', 'if (!fn) continue;'), SRV],
  ['the retired second half’s tab is still read', rl("var RUN_LOG_ORDER_ = ['nightlyRun', 'morningNudge',", "var RUN_LOG_ORDER_ = ['nightlyRun', 'nightlyRunTail', 'morningNudge',"), SRV],
  ['the logs sheet keeps its own zone', rl('  ss.setSpreadsheetTimeZone(tz);\n', ''), SRV],
  ['the sheet isn’t aligned on open', rl('  try { runLogAlignZone_(_runLogSS_, Session.getScriptTimeZone()); } catch (e) {}\n', ''), SRV],
  ['the route doesn’t say the zone', rl('where: where, tz: tz };', 'where: where };'), SRV],
  ['the card doesn’t name the zone', full("+(data.tz?' Times are '+rlZone_(data.tz)+'.':'')", ''), UI],
  ['the route isn’t owner-only', rl('  var refused = peopleOwnerOnly_();\n  if (refused) return refused;\n  var tabs', '  var tabs'), SRV],
  ['the prune drops recent rows', rl('if (isNaN(t) || t >= cutoff) break;', 'if (isNaN(t)) break;'), SRV],
  ['the heartbeat doesn’t complete the row', on('Watchdog.js', '  try { runLogFinish_(job); } catch (rlErr) {}\n', ''), SRV],
  ['the hourly watchdog doesn’t sweep', on('Watchdog.js', '  try { runLogSweep_(null, null, Date.now()); }', '  try { 0; }'), SRV],
  ['the nightly run isn’t logged', on('NightlyRunner.js', "  try { runLogStart_('nightlyRun', arguments[0]); } catch (rlErr) {}\n  var now = Date.now();", '  var now = Date.now();'), SRV],
  ['a continued part isn’t logged', on('NightlyRunner.js', "  try { runLogStart_('nightlyRun', arguments[0]); } catch (rlErr) {}\n  var crumb", '  var crumb'), SRV],
  ['a handoff isn’t marked Continued', on('RunLog.js', "  if (r.status === 'Continued') return 'Continued';", ''), SRV],
  ['the flight check isn’t logged', on('FlightStatus.js', "  try { runLogStart_('checkFlightStatuses_', forceRefresh); } catch (rlErr) {}", ''), SRV],
  ['steps aren’t reported', on('Code.js', '  try { runLogStep_(ctx, name); } catch (rlErr) {}\n', ''), SRV],
  ['veraLog_ doesn’t pass on the verdict', on('VERALog.js', '  try { runLogNote_(routine, status, summary, error); } catch (rlErr) {}', ''), SRV],
  ['gym check-ins run all day', on('GymTracker.js', 'return r ? hour >= r.from && hour <= r.to : hour >= 18 && hour <= 23;', 'return true;'), SRV],
  ['hourlyCheck doesn’t look for workouts', on('Reminders.js', '  try { gymEveningCheck_(new Date()); }', '  try { 0; }'), SRV],
  ['the screen doesn’t say where a run stopped', full("'Cut off'+(r.step?' during '", "'Cut off'+(false?' during '")],
  ['the pill ignores cut-off runs', full("return s==='Cut off'||s==='Failed';", "return s==='Failed';")],
  ['older runs are always open', full('isOpen&&h("div",{className:"rl-more"', 'true&&h("div",{className:"rl-more"')],
  ['the strip runs oldest first', full("h(\"div\",{className:\"rl-strip\",style:{display:'flex',gap:4,marginTop:6,alignItems:'center'}},j.runs.map(", "h(\"div\",{className:\"rl-strip\",style:{display:'flex',gap:4,marginTop:6,alignItems:'center'}},j.runs.slice().reverse().map(")],
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
  if (test === UI && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_CTL_FAST: '1' }) });
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
