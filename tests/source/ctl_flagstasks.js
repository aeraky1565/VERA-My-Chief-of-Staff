// Negative controls for the Flags and Tasks tabs: revert ONE rule at a time and confirm
// test_flagstasks.js (server) or test_flagstasks_ui.js (dashboard) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_flagstasks');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const NODE = 'test_flagstasks.js', UI = 'test_flagstasks_ui.js';
const CONTROLS = [
  ['a nightly check left out', one('FlagsTasks.js', "  { prefix: 'MEALPREP|',         clears: 'Clears once the prep is done.' },\n", ''), NODE],
  ['Resolve allowed on automatic flags', one('WebApp.js', "  if (auto) return { ok: false, id: id, auto: true, error: 'This flag clears itself. ' + auto.clears };\n", ''), NODE],
  ['the read drops Due', one('WebApp.js', "      due:          flagDueCell_(r[11]),\n", ''), NODE],
  ['the read drops automatic', one('WebApp.js', "      auto:         !!flagAutoOf_(r[9]),\n", ''), NODE],
  ['snooze ignores the date', one('WebApp.js', "const when      = flagSnoozeUntil_(until, days, ftToday_());", "const when      = flagSnoozeUntil_('', days, ftToday_());"), NODE],
  ['snooze to today allowed', one('FlagsTasks.js', "if (u <= todayIso) return", "if (u < todayIso) return"), NODE],
  ['no year limit', one('FlagsTasks.js', "    if (u > ftAddDays_(todayIso, 365)) return { ok: false, error: 'Pick a day within a year' };\n", ''), NODE],
  ['an impossible date accepted', one('FlagsTasks.js', "if (isNaN(t) || new Date(t).toISOString().slice(0, 10) !== u)", "if (isNaN(t))"), NODE],
  ['a second task for the same flag', one('FlagsTasks.js', "if (open && String(rows[i][fCol - 1] || '').trim() === flagId)", "if (false)"), NODE],
  ['the task forgets its flag', one('FlagsTasks.js', "'Open', '', '', flagId, '']]);", "'Open', '', '', '', '']]);"), NODE],
  ['checking off doesn’t stamp the day', one('WebApp.js', "  found.sheet.getRange(found.rowNum, ftCompletedCol_()).setValue(ftToday_());\n", ''), NODE],
  ['an automatic flag resolved by its task', one('FlagsTasks.js', "  if (flagAutoOf_(r[9])) return 'left';\n", ''), NODE],
  ['a one-off flag left open by its task', one('FlagsTasks.js', "  found.sheet.getRange(found.rowNum, 9).setValue('Yes');\n  return 'resolved';", "  return 'resolved';"), NODE],
  ['Done this week takes 8 days', one('WebApp.js', "tasksDoneRecent_(rows, ftToday_(), 7, ", "tasksDoneRecent_(rows, ftToday_(), 8, "), NODE],
  ['Done this week counts cancelled', one('FlagsTasks.js', "  var DONE = ['done', 'complete', 'completed'];", "  var DONE = ['done', 'complete', 'completed', 'cancelled'];"), NODE],
  ['Reopen leaves the day', one('FlagsTasks.js', "  found.sheet.getRange(found.rowNum, ftCompletedCol_()).setValue('');\n", ''), NODE],
  ['a task row one cell short', one('WebApp.js', ".setValues([[id, taskText, addedStr, dueDate, 'Open', recurring, notes, '', '']]);", ".setValues([[id, taskText, addedStr, dueDate, 'Open', recurring, notes, '']]);"), NODE],
  ['the card offers Resolve on automatic flags', ui("!flag.auto&&h(\"button\",{className:\"btn btn-resolve\"", "true&&h(\"button\",{className:\"btn btn-resolve\""), UI],
  ['every group starts open', ui("Object.prototype.hasOwnProperty.call(open,g.id)?!!open[g.id]:g.high;", "Object.prototype.hasOwnProperty.call(open,g.id)?!!open[g.id]:true;"), UI],
  ['snoozed flags stay in their area', ui("var g=!f.resolved&&f.snoozedUntil&&f.snoozedUntil>today?FLAG_SNOOZED_:a;", "var g=a;"), UI],
  ['the urgency filter does nothing', ui("if(urgency&&urgency!=='all'&&f.urgency!==urgency)return;", ""), UI],
  ['Tomorrow snoozes two days', ui("var out=[{label:'Tomorrow',until:ftAdd_(today,1)}", "var out=[{label:'Tomorrow',until:ftAdd_(today,2)}"), UI],
  ['Go to it doesn’t unfold the vehicle', ui("if(t.vehicleId){const m=vhFoldRead_();m[t.vehicleId]=true;vhFoldWrite_(m);}", ""), UI],
  ['the check-off is written at once (no Undo)', ui("timer:setTimeout(()=>commitComplete(id),5000)", "timer:setTimeout(()=>commitComplete(id),0)"), UI],
  ['Undo doesn’t stop the write', ui("function undoComplete(){const p=pendingRef.current;if(!p)return;clearTimeout(p.timer);", "function undoComplete(){const p=pendingRef.current;if(!p)return;"), UI],
  ['Delete without asking', ui("onClick:()=>setDelAsk(true)},\"Delete…\")", "onClick:()=>onDelete(task)},\"Delete…\")"), UI],
  ['the flag chip is gone', ui("task.flag&&React.createElement(\"div\",{className:\"task-flag\"", "false&&React.createElement(\"div\",{className:\"task-flag\""), UI],
  // Task IDs and Google Tasks
  ['task IDs counted by rows again', one('FlagsTasks.js', "  return veraNextSeqId_('TASK-' + dateKey + '-', ids, 2);", "  return 'TASK-' + dateKey + '-' + String(ids.filter(function(r) { return String(r[0] || '').indexOf('TASK-' + dateKey) === 0; }).length + 1).padStart(2, '0');"), NODE],
  ['the recurring copy numbered outside the lock', one('WebApp.js', "  const newId = veraLocked_(function() {\n    const nid = taskNextId_(sheet, dateKey);", "  const newId = (function() {\n    const nid = taskNextId_(sheet, dateKey);"), NODE],
  ['Google task completed with a whole-task update', one('WebApp.js', "    Tasks.Tasks.patch({ status: 'completed' }, listId, id);", "    Tasks.Tasks.update({ id: id, status: 'completed' }, listId, id);"), NODE],
  ['Google task completed in the first list only', one('WebApp.js', "        try { if (Tasks.Tasks.get(lists[i].id, id)) listId = lists[i].id; } catch (notHere) {}", "        if (!listId) listId = lists[i].id;"), NODE],
  ['the task\'s list isn\'t sent back', one('WebApp.js', "        listId:       t.__listId,\n", ''), NODE],
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
  // index.html loads its scripts and styles from docs/: bring the rest of docs along unchanged.
  fs.readdirSync(path.join(SRC_DIR, 'docs')).forEach(f => { const s = path.join(SRC_DIR, 'docs', f), d = path.join(OUT, 'docs', f); if (!fs.existsSync(d) && fs.statSync(s).isFile()) fs.copyFileSync(s, d); });
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
