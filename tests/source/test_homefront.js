// Home Front additions (HomeFront.js), over fake sheets: upkeep in Chores (the
// date maths, Done, edits, the starter list, flag/task/off reminders), and the
// wiring into Code.js and WebApp.js. Every chore and date here is invented.
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'HomeFront.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// ---- a fake spreadsheet ------------------------------------------------------------
function fakeSheet(rows) {
  const sh = { rows };
  sh.getLastRow = () => sh.rows.length;
  sh.getRange = (r, c, nr, nc) => ({
    getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = sh.rows[r - 1 + i] || []; out.push(Array.from({ length: nc || 1 }, (x, j) => row[c - 1 + j] === undefined ? '' : row[c - 1 + j])); } return out; },
    setValues: v => { v.forEach((row, i) => { sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || []; row.forEach((x, j) => { sh.rows[r - 1 + i][c - 1 + j] = x; }); }); },
    setValue: v => { sh.rows[r - 1] = sh.rows[r - 1] || []; sh.rows[r - 1][c - 1] = v; },
  });
  sh.appendRow = v => sh.rows.push(v.slice());
  return sh;
}
const extract = (src, name) => { const at = src.indexOf('function ' + name + '('); const end = src.indexOf('\n}\n', at) + 3; return src.slice(at, end); };
const constLine = (src, name) => { const m = src.match(new RegExp('const ' + name + '\\s*=\\s*\\[[^\\]]*\\];')); return m ? m[0].replace(/^const/, 'var') : ''; };

const S = vm.createContext({ console, Math, JSON, Date, Object, String, Number, Array, isNaN, Logger: { log() {} } });
vm.runInContext(SRC, S);
vm.runInContext(constLine(CODE, 'CHORES_HEADERS') + constLine(CODE, 'TASK_HEADERS') + constLine(CODE, 'FLAG_HEADERS'), S);
vm.runInContext(extract(CODE, 'upsertKeyedFlags_'), S);
vm.runInContext(extract(fs.readFileSync(path.join(ROOT, 'TripIdeas.js'), 'utf8'), 'tiSchema_'), S);
const run = code => vm.runInContext(code, S);

console.log('\nupkeep: the date maths');
check('months add, keeping the day or the month\'s last', run('hfAddMonths_("2026-11-30", 3)') === '2027-02-28' && run('hfAddMonths_("2026-01-15", 12)') === '2027-01-15' && run('hfAddMonths_("2026-10-31", 6)') === '2027-04-30');
check('a date cell, an ISO stamp or text reads as yyyy-mm-dd; nonsense is blank', run('hfYmd_(new Date(2026, 9, 2))') === '2026-10-02' && run('hfYmd_("2026-07-02T14:00:00Z")') === '2026-07-02' && run('hfYmd_("soon")') === '' && run('hfYmd_(null)') === '');
check('a month-day falls next on today or next year', run('hfNextMonthDay_("11-15", "2026-10-26")') === '2026-11-15' && run('hfNextMonthDay_("03-01", "2026-10-26")') === '2027-03-01' && run('hfNextMonthDay_("10-26", "2026-10-26")') === '2026-10-26');
check('only quarterly, semiannual, yearly and seasonal chores are upkeep', run('["Quarterly","Semiannually","Annually","Seasonal"].every(hfIsUpkeep_)') && !run('["Daily","Weekly","Monthly","Bimonthly","",null].some(hfIsUpkeep_)'));

const T = '2026-10-26';
const st = (o) => { S.o = o; return run('hfUpkeepState_(o, "' + T + '")'); };
let s = st({ Cadence: 'Quarterly', 'Last Done': '2026-07-02' });
check('next due is last done plus the cadence; past it is overdue', s.next === '2026-10-02' && s.status === 'overdue' && s.days === -24 && s.months === 3, JSON.stringify(s));
s = st({ Cadence: 'Seasonal', 'Last Done': '2025-11-09', 'Due By': '2026-11-05' });
check('a due-by date wins over the cadence; within two weeks is "soon"', s.next === '2026-11-05' && s.status === 'soon' && s.days === 10 && s.last === '2025-11-09', JSON.stringify(s));
check('…three weeks out is not yet', st({ Cadence: 'Seasonal', 'Due By': '2026-11-16' }).status === 'ok');
s = st({ Cadence: 'Annually', 'Last Done': '2026-09-14' });
check('a year out is fine', s.status === 'ok' && s.next === '2027-09-14');
s = st({ Cadence: 'Semiannually' });
check('never done and no date: not set, not overdue', s.status === 'unset' && s.next === '' && s.days === null);
s = st({ Cadence: 'Quarterly', Checked: true, 'Checked At': '2026-09-01T12:00:00Z' });
check('a quarterly chore ticked the old way counts its tick as last done', s.last === '2026-09-01' && s.next === '2026-12-01');
check('a routine chore has no upkeep state', st({ Cadence: 'Weekly', 'Last Done': '2026-10-01' }) === null);
check('Done moves a due-by date on by the cadence, past today', run('hfNextDueBy_("2026-11-15", 12, "' + T + '")') === '2027-11-15' && run('hfNextDueBy_("2026-01-10", 3, "' + T + '")') === '2027-01-10' && run('hfNextDueBy_("", 3, "' + T + '")') === '');

S.ch = [{ ID: 'ch_1', Chore: 'Replace HVAC filter', Cadence: 'Quarterly', 'Last Done': '2026-07-02' },
  { ID: 'ch_2', Chore: 'Shut off outdoor taps', Cadence: 'Seasonal', 'Due By': '2026-11-01' },
  { ID: 'ch_3', Chore: 'Clean gutters', Cadence: 'Seasonal', 'Due By': '2026-11-30' },
  { ID: 'ch_4', Chore: 'Smoke alarms', Cadence: 'Semiannually' },
  { ID: 'ch_5', Chore: 'Dishes', Cadence: 'Daily' }];
const w = run('hfUpkeepWanted_(ch, "' + T + '")');
check('a reminder for upkeep overdue or due within a week, and nothing else', Object.keys(w).sort().join() === 'UPKEEP|ch_1,UPKEEP|ch_2', Object.keys(w).join());
check('…Low, worded for the person', w['UPKEEP|ch_1'].urgency === 'Low' && w['UPKEEP|ch_1'].flag === 'Upkeep: Replace HVAC filter'
  && w['UPKEEP|ch_1'].reason === 'Overdue since 2026-10-02 · last done 2026-07-02. Mark it done in Home Front → Chores.' && /^Due 2026-11-01 · not done yet/.test(w['UPKEEP|ch_2'].reason), JSON.stringify(w));

console.log('\nupkeep: the sheet');
const H = run('CHORES_HEADERS');
check('Chores gains Last Done and Due By at the end, so existing columns keep their places', H.join('|') === 'ID|Chore|Cadence|Sort|Checked|Checked At|Added Date|Last Done|Due By');
const chores = fakeSheet([['ID', 'Chore', 'Cadence', 'Sort', 'Checked', 'Checked At', 'Added Date'],
  ['ch_1', 'Replace HVAC filter', 'Quarterly', 1, false, '', '2026-01-01'],
  ['ch_2', 'Shut off outdoor taps', 'Seasonal', 2, false, '', '2026-01-01', '', new Date(2026, 10, 15)],
  ['ch_5', 'Dishes', 'Daily', 3, true, '', '2026-01-01']]);
const tasks = fakeSheet([['ID', 'Task', 'Added Date', 'Due Date', 'Status', 'Recurring', 'Notes', 'Flagged']]);
const flags = fakeSheet([['ID', 'Date', 'Source', 'Flag', 'Reason', 'Urgency', 'Acknowledged', 'Snoozed Until', 'Resolved', 'Key', 'Escalated']]);
let cfg = {};
Object.assign(S, {
  TABS: { CHORES: 'Chores', TASKS: 'Tasks', FLAGS: 'Flags' },
  getSpreadsheet: () => ({ getSheetByName: n => ({ Chores: chores, Tasks: tasks, Flags: flags })[n] || null }),
  ensureSheet: (ss, n) => ss.getSheetByName(n),
  getConfigValues: () => cfg,
  tiLocked_: fn => fn(),
  Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: { formatDate: () => T },
  colorCodeFlags: () => {},
});
const rd = run('hfReadChores_(hfChoresSheet_(), "' + T + '")');
check('an old sheet gets the two new headers, and its rows read as before', chores.rows[0].join('|') === H.join('|') && rd.length === 3 && rd[1]['Due By'] === '2026-11-15' && rd[1].upkeep.status === 'ok' && rd[1].upkeep.days === 20 && !rd[2].upkeep, JSON.stringify(rd[1]));

let r = run('webUpkeepDone_({ parameter: { id: "ch_2" } })');
check('Done logs today and moves the due-by date on a year', r.ok && chores.rows[2][7] === T && chores.rows[2][8] === '2027-11-15' && chores.rows[2][4] === true && r.chore.upkeep.status === 'ok' && r.chore.upkeep.next === '2027-11-15', JSON.stringify(r.chore));
r = run('webUpkeepDone_({ parameter: { id: "ch_1" } })');
check('…and a cadence-only chore is next due a cadence from today', r.ok && r.chore.upkeep.next === '2027-01-26' && chores.rows[1][8] === '');
check('Done on a routine chore is refused, not logged', run('webUpkeepDone_({ parameter: { id: "ch_5" } })').ok === false && chores.rows[3][7] === undefined);
check('…and on one that does not exist', run('webUpkeepDone_({ parameter: { id: "ch_nope" } })').ok === false && run('webUpkeepDone_({ parameter: {} })').ok === false);

r = run('webUpkeepSet_({ parameter: { id: "ch_1", cadence: "Semiannually", lastDone: "2026-05-01" } })');
check('Edit changes how often and when it was last done', r.ok && chores.rows[1][2] === 'Semiannually' && chores.rows[1][7] === '2026-05-01' && r.chore.upkeep.next === '2026-11-01', JSON.stringify(r.chore));
r = run('webUpkeepSet_({ parameter: { id: "ch_1", dueBy: "" } })');
check('…a blank due-by clears it, leaving other fields alone', r.ok && chores.rows[1][8] === '' && chores.rows[1][7] === '2026-05-01');
check('…a last-done date in the future is refused', run('webUpkeepSet_({ parameter: { id: "ch_1", lastDone: "2027-01-01" } })').ok === false && chores.rows[1][7] === '2026-05-01');
check('…and an unknown cadence', run('webUpkeepSet_({ parameter: { id: "ch_1", cadence: "Hourly" } })').ok === false);

r = run('webUpkeepStarter_()');
const names = chores.rows.slice(1).map(x => x[1]);
check('the starter list adds the common jobs, dated to their next season', r.ok && r.added === 7 && names.indexOf('Clean the gutters') !== -1
  && chores.rows.find(x => x[1] === 'Clean the gutters')[8] === '2026-11-30' && chores.rows.find(x => x[1] === 'Check the sump pump')[8] === '2027-03-01'
  && chores.rows.find(x => x[1] === 'Test smoke & CO alarms')[8] === '', JSON.stringify(r).slice(0, 200));
check('…skipping one already there by name, and adding nothing twice', names.filter(n => n === 'Replace HVAC filter').length === 1 && run('webUpkeepStarter_()').added === 0 && chores.rows.length === 11);

console.log('\nupkeep: reminders');
// Back to a known state: ch_1 overdue (quarterly, last Jul 2), the starter rows not done.
chores.rows = chores.rows.slice(0, 4); chores.rows[1][2] = 'Quarterly'; chores.rows[1][7] = '2026-07-02';
const openFlags = () => flags.rows.slice(1).filter(x => x[8] !== 'Yes' && String(x[9]).indexOf('UPKEEP|') === 0).map(x => x[9]).sort().join();
let out = run('hfSyncUpkeepReminders_()');
check('by default an overdue job is a Low flag from Chores', out.mode === 'flag' && openFlags() === 'UPKEEP|ch_1' && flags.rows[1][2] === 'Chores' && flags.rows[1][5] === 'Low', openFlags());
run('webUpkeepDone_({ parameter: { id: "ch_1" } })');
check('…and Done closes it straight away', openFlags() === '');
chores.rows[1][7] = '2026-07-02';
cfg = { upkeep_reminders: 'task' };
out = run('hfSyncUpkeepReminders_()');
const openTasks = () => tasks.rows.slice(1).filter(x => x[4] === 'Open');
check('set to task, it is a task with its due date, and no flag', out.mode === 'task' && openTasks().length === 1 && openTasks()[0][1] === 'Upkeep: Replace HVAC filter' && openTasks()[0][3] === '2026-10-02'
  && /upkeep:ch_1/.test(openTasks()[0][6]) && openFlags() === '', JSON.stringify(tasks.rows));
run('hfSyncUpkeepReminders_()');
check('…one task, not one a night', tasks.rows.length === 2);
run('webUpkeepDone_({ parameter: { id: "ch_1" } })');
check('…marked Done when the job is', openTasks().length === 0 && tasks.rows[1][4] === 'Done');
chores.rows[1][7] = '2026-07-02'; cfg = { upkeep_reminders: 'off' };
run('hfSyncUpkeepReminders_()');
check('off: nothing at all', openFlags() === '' && openTasks().length === 0);
cfg = { upkeep_reminders: 'Flag ' };
check('the setting is read loosely, and anything unknown is a flag', run('hfUpkeepMode_()') === 'flag' && (cfg = { upkeep_reminders: 'nonsense' }, run('hfUpkeepMode_()')) === 'flag');

console.log('\nwiring');
check('the routes', /case 'chore_upkeep_done':\s+return jsonOut_\(webUpkeepDone_\(e\)\);/.test(WEB) && /case 'chore_upkeep_set':\s+return jsonOut_\(webUpkeepSet_\(e\)\);/.test(WEB) && /case 'chores_upkeep_starter':\s+return jsonOut_\(webUpkeepStarter_\(\)\);/.test(WEB));
check('the chores read carries each upkeep chore\'s state', /var up = hfUpkeepState_\(obj, today\);[^\n]*\n\s+if \(up\) obj\.upkeep = up;/.test(extract(WEB, 'webGetChores_')));
check('adding a chore can set its due-by date', /sheet\.appendRow\(\[id, chore, cadence, sort, false, '', added, '', dueBy\]\);/.test(extract(WEB, 'webAddChore_')));
const reset = extract(CODE, 'resetChoresByCadence_');
check('the nightly reset no longer clears quarterly or yearly chores', !/push\('Quarterly'\)|push\('Annually'\)|push\('Seasonal'\)|push\('Semiannually'\)/.test(reset) && /push\('Monthly'\)/.test(reset));
check('the nightly run raises upkeep reminders', /nightlyStep_\(ctx, 'hfSyncUpkeepReminders_', hfSyncUpkeepReminders_\);/.test(CODE));
check('Config says how', /\['upkeep_reminders',\s+'flag'\],/.test(CODE));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
