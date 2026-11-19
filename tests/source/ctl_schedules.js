// Negative controls for test_schedules.js: put ONE schedule back the way it was (hard-coded,
// or broken) and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_sched');
const FILES = ['NightlyRunner.js', 'Co' + 'de.js', 'Features.js', 'Reminders.js', 'EmailAdmin.js', 'MonthlyReview.js', 'MailCounter.js', 'WishLists.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const T = 'test_schedules.js';
const CONTROLS = [
  ["an hour reader takes 24", 'Co' + 'de.js', "v >= 0 && v <= 23 ? v : def; }", "v >= 0 && v <= 24 ? v : def; }"],
  ["midnight reads as blank (0 is dropped)", 'Co' + 'de.js', "return s !== '' && v >= 0 && v <= 23 ? v : def; }", "return s !== '' && v > 0 && v <= 23 ? v : def; }"],
  ["a day of the month can be the 30th", 'Co' + 'de.js', "return v >= 1 && v <= 28 ? v : def; }", "return v >= 1 && v <= 31 ? v : def; }"],
  ["any minute count is accepted", 'Co' + 'de.js', "return VERA_TRIGGER_MINUTES_.indexOf(v) !== -1 ? v : def; }", "return v > 0 ? v : def; }"],
  ["the nightly hour setting is ignored", 'Co' + 'de.js', "var NIGHT = H('nightly_run_hour', CONFIG.NIGHTLY_RUN_HOUR, sc);", "var NIGHT = CONFIG.NIGHTLY_RUN_HOUR;"],
  ["the morning email setting is ignored", 'Co' + 'de.js', "var MORNING = H('morning_nudge_time', CONFIG.MORNING_NUDGE_HOUR, sc);", "var MORNING = CONFIG.MORNING_NUDGE_HOUR;"],
  ["the HOA day is off by one", 'Co' + 'de.js', "var HOA_DAY = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][HOA_D];", "var HOA_DAY = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'][HOA_D];"],
  ["the specs need the readers loaded", 'Co' + 'de.js', "var H = typeof schedHour_ === 'function' ? schedHour_ : keep,", "var H = schedHour_,"],
  ["a rebuild deletes every trigger", 'Co' + 'de.js', "    if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);", "    ScriptApp.deleteTrigger(trigger);"],
  ["a rebuild doesn't delete the old one", 'Co' + 'de.js', "    if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);", "    if (false) ScriptApp.deleteTrigger(trigger);"],
  ["a rebuild skips the watchdog registry", 'Co' + 'de.js', "  try { recordTriggerRegistrations_([handler]); } catch (regErr)", "  try { } catch (regErr)"],
  ["saving never rebuilds", "Features.js", "    try { if (rebuildTrigger_(handler)) rebuilt.push(handler); }", "    try { }"],
  ["a choice that isn't offered is saved", "Features.js", "if (x.type === 'select' && x.o.map(function(o) { return o[0]; }).indexOf(v) === -1) return { ok: false, error: 'Pick one of the choices.' };", ""],
  ["the weekend memo is back on Wednesday 8 am", "Reminders.js", "day === schedWeekday_('weekend_planner_day', 3, cfg) && hour === schedHour_('weekend_planner_hour', 8, cfg)", "day === 3 && hour === 8"],
  ["the goal check-in ignores its day", "Reminders.js", "if (day !== schedWeekday_('goal_checkin_day', 1, cfg)) return;", "if (day !== 1) return;"],
  ["the email tidy-up is back on Sunday", "EmailAdmin.js", "schedWeekday_('email_admin_day', 0, config)", "0"],
  ["the monthly review is back on the 1st", "MonthlyReview.js", "schedDom_('finance_review_day', 1, cfg)", "1"],
  ["the PTO snapshot is back on the 1st", "NightlyRunner.js", "var onDay = new Date().getDate() === schedDom_('finance_review_day', 1);", "var onDay = new Date().getDate() === 1;"],
  ["the chores reset is back on Friday", 'Co' + 'de.js', "(dow === schedWeekday_('chores_reset_day', 5))", "(dow === 5)"],
  ["the USPS catch-up is back at 10", "MailCounter.js", "schedHour_('usps_scan_hour', USPS_SCAN_HOUR_)", "USPS_SCAN_HOUR_"],
  ["Feature Flags doesn't say when the memo goes out", "Features.js", "function featureWhen_(f, cfg) {", "function featureWhen_(f, cfg) { return '';"],
  ["a fixed feature can be switched off", "Features.js", "  if (f.fixed) return { ok: false, error:", "  if (false) return { ok: false, error:"],
].map(c => [c[0], b => ({ [c[1]]: swap(b[c[1]], c[2], c[3]) }), T]);

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0], test = c[2];
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
  const env = Object.assign({}, process.env, { VERA_ROOT: OUT });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env });
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
