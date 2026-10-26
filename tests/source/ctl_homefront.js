// Negative controls for Home Front (HomeFront.js, the HfNav block and the Chores
// wiring): revert ONE rule at a time and confirm a test catches it. Most run
// test_homefront.js; dashboard rules run test_homefront_nav_ui.js (third field).
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_hfront');

const FILES = ['HomeFront.js', 'Code.js', 'WebApp.js', 'TripIdeas.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const H = 'HomeFront.js', K = 'Code.js', W = 'WebApp.js', A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
// A dashboard change: the full page is served from index.html, which carries app.js inside it.
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const TEST = 'test_homefront.js', UI = 'test_homefront_nav_ui.js';

const CONTROLS = [
  ['a due-by date is ignored', b => ({ [H]: swap(b[H], "var next = dueBy || (last ? hfAddMonths_(last, months) : '');", "var next = last ? hfAddMonths_(last, months) : '';") })],
  ['the month end is not kept', b => ({ [H]: swap(b[H], "String(Math.min(p[2], last)).padStart(2, '0')", "String(p[2]).padStart(2, '0')") })],
  ['an old tick is not counted as last done', b => ({ [H]: swap(b[H], "(checked ? hfYmd_(row['Checked At']) : '')", "''") })],
  ['Done leaves the due-by date where it was', b => ({ [H]: swap(b[H], "var dueBy = hfNextDueBy_(hfYmd_(c['Due By']), HF_UPKEEP_MONTHS_[c.Cadence], today);", "var dueBy = hfYmd_(c['Due By']);") })],
  ['Done works on a routine chore', b => ({ [H]: swap(b[H], "    if (!hfIsUpkeep_(c.Cadence)) return { ok: false, error: 'Only quarterly, seasonal and yearly chores are logged by date.' };\n", "") })],
  ['a future last-done date is kept', b => ({ [H]: swap(b[H], "if (l > today) return { ok: false, error: 'Last done can’t be in the future.' }; ", "") })],
  ['the starter list adds twice', b => ({ [H]: swap(b[H], "      if (have[s[0].toLowerCase()]) return;\n", "") })],
  ['reminders wait until overdue', b => ({ [H]: swap(b[H], "s.days > HF_UPKEEP_REMIND_DAYS_) return;", "s.days >= 0) return;") })],
  ['Done does not close the reminder', b => ({ [H]: swap(b[H], "    try { hfSyncUpkeepReminders_(); } catch (err)", "    try { } catch (err)") })],
  ['task mode still flags', b => ({ [H]: swap(b[H], "mode === 'flag' ? wanted : {}, today);", "wanted, today);") })],
  ['a task a night', b => ({ [H]: swap(b[H], "    if (open[w.id]) return;\n", "") })],
  ['a done job leaves its task open', b => ({ [H]: swap(b[H], "    else sheet.getRange(i + 2, 5).setValue('Done');", "") })],
  ['off still flags', b => ({ [H]: swap(b[H], "return v === 'task' || v === 'off' ? v : 'flag';", "return v === 'task' ? v : 'flag';") })],
  ['the nightly reset clears quarterly chores again', b => ({ [K]: swap(b[K], "  if (isLastDayOfMonth)  toReset.push('Monthly');\n", "  if (isLastDayOfMonth)  toReset.push('Monthly');\n  if (isLastDayOfMonth)  toReset.push('Quarterly');\n") })],
  ['no nightly reminders', b => ({ [K]: swap(b[K], "    nightlyStep_(ctx, 'hfSyncUpkeepReminders_', hfSyncUpkeepReminders_);\n", "") })],
  ['the chores read drops upkeep state', b => ({ [W]: swap(b[W], "      if (up) obj.upkeep = up;\n", "") })],
  ['the done route is missing', b => ({ [W]: swap(b[W], "      case 'chore_upkeep_done':     return jsonOut_(webUpkeepDone_(e));\n", "") })],
  ['Plan it again copies the guests too', b => ({ [H]: swap(b[H], "return { id: '', title: c.title, type: c.type, date: '', start: c.start, end: c.end, place: c.place, guests: [],", "return { id: '', title: c.title, type: c.type, date: '', start: c.start, end: c.end, place: c.place, guests: c.guests,") })],
  ['Plan it again keeps who brings what', b => ({ [H]: swap(b[H], "return { dish: m.dish, who: '', recipe: m.recipe, note: m.note };", "return { dish: m.dish, who: m.who, recipe: m.recipe, note: m.note };") })],
  ['a to-do may be any number of days before', b => ({ [H]: swap(b[H], "Math.min(Math.max(b, 0), 120)", "b") })],
  ['a new gathering gets no to-dos', b => ({ [H]: swap(b[H], "if (!g.todos.length && !(body.gathering && Array.isArray(body.gathering.todos))) g.todos = hfGatheringTemplate_(g.type);", "") })],
  ['a gone gathering is recreated', b => ({ [H]: swap(b[H], "    if (g.id && row === -1) return { ok: false, error: 'That gathering no longer exists.' };\n", "") })],
  ['an update forgets when it was created', b => ({ [H]: swap(b[H], "var created = String(sheet.getRange(row, 15).getValue() || now);\n      sheet.getRange(row, 1, 1, w).setValues([hfGatheringToRow_(g, created, now)]);", "var created = now;\n      sheet.getRange(row, 1, 1, w).setValues([hfGatheringToRow_(g, created, now)]);") })],
  ['a time cell reads back blank', b => ({ [H]: swap(b[H], "start: hfTimeCell_(r[4]), end: hfTimeCell_(r[5]),", "start: r[4] instanceof Date ? '' : r[4], end: r[5] instanceof Date ? '' : r[5],") })],
  ['Send to Shopping needs no store', b => ({ [H]: swap(b[H], "  if (!tabId) return { ok: false, error: 'Pick a store.' };\n", "") })],
  ['the save route is missing', b => ({ [W]: swap(b[W], "      case 'gathering_save':             return jsonOut_(webSaveGathering_(body));\n", "") })],
  ['the dashboard copies who brings what on Plan it again', both("menu:(g.menu||[]).map(function(m){return {dish:m.dish,who:'',", "menu:(g.menu||[]).map(function(m){return {dish:m.dish,who:m.who,"), UI],
  ['a to-do date is not counted back', both("function hfTodoDueC_(date,before){return date?hfAddDaysC_(date,-(Number(before)||0)):'';}", "function hfTodoDueC_(date,before){return date||'';}"), UI],
  ['Send to Shopping ignores the store picked', both("{action:'gathering_to_shopping',tabId:tab,items:g.shopping}", "{action:'gathering_to_shopping',tabId:(stores&&stores[0]||{}).id,items:g.shopping}"), UI],
  ['Gatherings is not in Hosting', both("{id:'hosting',label:'Hosting',icon:'🎉',items:['guests','gatherings','guide']}", "{id:'hosting',label:'Hosting',icon:'🎉',items:['guests','guide']}"), UI],
  ['the routine list shows upkeep again', both("function hfRoutineChores_(chores){return (chores||[]).filter(function(c){return !hfIsUpkeepCadence_(c.Cadence);});}", "function hfRoutineChores_(chores){return (chores||[]);}"), UI],
  ['upkeep is listed in sheet order', both("var r=(rank[ua.status]==null?2:rank[ua.status])-(rank[ub.status]==null?2:rank[ub.status]);if(r)return r;", ""), UI],
  ['Done does not update the row', both("function(r){merge([r.chore]);});},style:btn(false)},busy==='done'+c.ID", "function(r){});},style:btn(false)},busy==='done'+c.ID"), UI],
  ['the merge appends instead of replacing', both("if(i===-1)out.push(c);else out[i]=c;", "out.push(c);"), UI],
  ['a group forgets its last section', both("var to=g.tabs.some(function(t){return t.id===keep;})?keep:g.tabs[0].id;", "var to=g.tabs[0].id;"), UI],
  ['Home Front opens on Warranties again', b => ({ [A]: swap(b[A], "const[sub,setSub]=React.useState('household');", "const[sub,setSub]=React.useState('steward');"), [I]: swap(b[I], "const[sub,setSub]=React.useState('household');", "const[sub,setSub]=React.useState('steward');") }), UI],
];

// The dashboard controls drive a real browser. The CI job that runs controls has none (the
// browser job runs the screens themselves), so there they are skipped and said so; locally they run.
const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const test = c[2] || TEST;
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
