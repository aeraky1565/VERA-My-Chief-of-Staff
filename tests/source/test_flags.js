// Tests the REAL syncWatchdogFlags_ and pruneSystemLog_ against a fake sheet
// that records every write, so the lifecycle (open -> refresh -> auto-resolve
// -> reopen) is checked rather than asserted.

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

function extractFn(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('not found: ' + name);
  let j = src.indexOf('{', i), depth = 0;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j) + '\n';
}

const FLAG_HEADERS = ['ID','Date','Source','Flag','Reason','Urgency','Acknowledged','Snoozed Until','Resolved','Key','Escalated'];

// A sheet that behaves like the real one for the calls these functions make.
function fakeSheet(rows) {
  const data = rows.map(r => r.slice());
  const appended = [];
  const sets = [];
  return {
    _data: data, _appended: appended, _sets: sets,
    getLastRow: () => data.length + 1,           // +1 for the header row
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < numRows; i++) out.push(data[row - 2 + i].slice(col - 1, col - 1 + numCols));
        return out;
      },
      setValue: v => { sets.push({ row, col, v }); data[row - 2][col - 1] = v; },
      setValues: vs => { sets.push({ row, col, vs }); },
    }),
    appendRow: r => { appended.push(r); data.push(r.slice()); },
    deleteRows: (start, n) => { data.splice(start - 2, n); sets.push({ deleteRows: [start, n] }); },
  };
}

function loadFlagSync(sheet, notifEnabled) {
  const ctx = {
    console, Logger: { log: () => {} },
    FLAG_HEADERS,
    TABS: { FLAGS: 'Flags' },
    getSpreadsheet: () => ({ getSheetByName: () => sheet }),
    isNotifEnabled_: k => (notifEnabled === undefined ? true : !!notifEnabled[k]),
    colorCodeFlags: () => {},
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const dt = new Date(d);
        if (fmt === 'yyyy-MM-dd') return dt.toISOString().slice(0, 10);
        return dt.toISOString();
      },
    },
    Math, Date, String, Object, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(
    "var WATCHDOG_FLAG_SOURCE_='System'; var WATCHDOG_FLAG_PREFIX_='watchdog_';\n" +
    extractFn('Watchdog.js', 'describeHours_') +
    extractFn('Watchdog.js', 'syncWatchdogFlags_'), ctx);
  return ctx;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
}

// Built by running the REAL getOverdueJobs_, not hand-rolled. A hand-written
// fixture silently stops matching the shape the code produces the moment a field
// is added — which is exactly how two earlier fixtures on this branch ended up
// agreeing with each other and disagreeing with reality.
const NOTICE = (function () {
  const ctx = { console, Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: () => JSON.stringify({ nightlyRun: { lastRun: Date.now() - 51 * 3600000 } }),
      setProperty: () => {}, deleteProperty: () => {} }) } };
  vm.createContext(ctx);
  vm.runInContext(extractFn('ApiHealth.js', 'formatAge_'), ctx);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'Watchdog.js'), 'utf8')
      .match(/var HEARTBEAT_KEY_[\s\S]*?^\];/m)[0], ctx);
  vm.runInContext("var _heartbeatCache_ = null;", ctx);
  vm.runInContext(extractFn('Watchdog.js', 'getHeartbeatState_'), ctx);
  vm.runInContext(extractFn('Watchdog.js', 'getOverdueJobs_'), ctx);
  const jobs = vm.runInContext('getOverdueJobs_()', ctx);
  if (!jobs.length) throw new Error('fixture setup produced no overdue jobs');
  return { jobs: jobs, feeds: [], lines: [], hasAlerts: true };
})();

console.log('\nsyncWatchdogFlags_ — opening');
{
  const sheet = fakeSheet([]);
  const ctx = loadFlagSync(sheet);
  ctx.NOTICE = NOTICE;
  vm.runInContext('syncWatchdogFlags_(NOTICE)', ctx);

  check('opens one flag', sheet._appended.length === 1);
  const row = sheet._appended[0];
  check('source is System', row[2] === 'System');
  check('flag text names the job and the age',
        row[3] === 'Nightly run ' + NOTICE.jobs[0].verb + ' ' + NOTICE.jobs[0].ageText, row[3]);
  check('reason points at the real cause', /Google disables triggers/.test(row[4]));
  check('High urgency', row[5] === 'High');
  check('unresolved', row[8] === 'No');
  check('key is namespaced', row[9] === 'watchdog_nightlyrun', row[9]);
}

console.log('\nsyncWatchdogFlags_ — still broken on the next run');
{
  // Seeded from a real first run, so "unchanged" means unchanged by the code's
  // own standard rather than by mine.
  const first = fakeSheet([]);
  const c0 = loadFlagSync(first); c0.NOTICE = NOTICE;
  vm.runInContext('syncWatchdogFlags_(NOTICE)', c0);

  const sheet = fakeSheet([first._appended[0]]);
  const ctx = loadFlagSync(sheet);
  ctx.NOTICE = NOTICE;
  vm.runInContext('syncWatchdogFlags_(NOTICE)', ctx);

  check('does not open a duplicate', sheet._appended.length === 0);
  const textWrites = sheet._sets.filter(s => s.col === 4);
  check('does not rewrite identical flag text', textWrites.length === 0,
        'runs hourly — an unchanged row should cost no writes');
}

console.log('\nsyncWatchdogFlags_ — wording moved on');
{
  const existing = [['FLAG-1','2026-09-14','System','Nightly run has not run in 1d 3h',
                     'old reason','High','No','','No','watchdog_nightlyrun','']];
  const sheet = fakeSheet(existing);
  const ctx = loadFlagSync(sheet);
  ctx.NOTICE = NOTICE;
  vm.runInContext('syncWatchdogFlags_(NOTICE)', ctx);

  check('refreshes the flag text',
        sheet._sets.some(s => s.col === 4 && s.v.indexOf(NOTICE.jobs[0].ageText) !== -1));
  check('refreshes the reason', sheet._sets.some(s => s.col === 5));
  check('still no duplicate row', sheet._appended.length === 0);
}

console.log('\nsyncWatchdogFlags_ — recovered');
{
  const existing = [['FLAG-1','2026-09-14','System','Nightly run has not run in 9d',
                     'r','High','No','','No','watchdog_nightlyrun','']];
  const sheet = fakeSheet(existing);
  const ctx = loadFlagSync(sheet);
  ctx.QUIET = { jobs: [], feeds: [], lines: [], hasAlerts: false };
  vm.runInContext('syncWatchdogFlags_(QUIET)', ctx);

  check('auto-resolves the stale alarm',
        sheet._sets.some(s => s.col === 9 && s.v === 'Yes'),
        'a watchdog flag nobody has to close by hand');
}

console.log('\nsyncWatchdogFlags_ — recurrence after a fix');
{
  // This is the case writeFlags() could never handle: the same problem, again,
  // months later, with a resolved row already on the sheet.
  const existing = [['FLAG-1','2026-06-01','System','Nightly run has not run in 2d',
                     'r','High','Yes','','Yes','watchdog_nightlyrun','7d']];
  const sheet = fakeSheet(existing);
  const ctx = loadFlagSync(sheet);
  ctx.NOTICE = NOTICE;
  vm.runInContext('syncWatchdogFlags_(NOTICE)', ctx);

  check('reopens rather than staying silent', sheet._sets.some(s => s.col === 9 && s.v === 'No'));
  check('clears the acknowledgement', sheet._sets.some(s => s.col === 7 && s.v === 'No'));
  check('clears the escalation marker', sheet._sets.some(s => s.col === 11 && s.v === ''));
  check('re-dates it so escalateAgedFlags_ ages it afresh', sheet._sets.some(s => s.col === 2));
  check('and does not append a second row', sheet._appended.length === 0);
}

console.log('\nsyncWatchdogFlags_ — toggle off');
{
  const sheet = fakeSheet([]);
  const ctx = loadFlagSync(sheet, { watchdog_flag: false });
  ctx.NOTICE = NOTICE;
  vm.runInContext('syncWatchdogFlags_(NOTICE)', ctx);
  check('writes nothing when the flag channel is switched off',
        sheet._appended.length === 0 && sheet._sets.length === 0);
}

console.log('\nsyncWatchdogFlags_ — leaves other flags alone');
{
  const existing = [
    ['FLAG-9','2026-09-14','Finance','Verizon bill due','r','High','No','','No','verizon_bill_sept',''],
  ];
  const sheet = fakeSheet(existing);
  const ctx = loadFlagSync(sheet);
  ctx.QUIET = { jobs: [], feeds: [], lines: [], hasAlerts: false };
  vm.runInContext('syncWatchdogFlags_(QUIET)', ctx);
  check('an unrelated open flag is untouched', sheet._sets.length === 0,
        'the sweep must only ever close its own rows');
}

// ---- pruneSystemLog_ --------------------------------------------------------

console.log('\npruneSystemLog_');
{
  const DAY = 86400000;
  const now = Date.now();
  const rows = [
    [new Date(now - 90 * DAY)], [new Date(now - 60 * DAY)], [new Date(now - 50 * DAY)],
    [new Date(now - 10 * DAY)], [new Date(now - 1 * DAY)],
  ];
  const sheet = fakeSheet(rows);
  const ctx = {
    console, Logger: { log: () => {} },
    TABS: { SYSTEM_LOG: 'System Log' },
    getConfigValues: () => ({}),                 // default retention: 45 days
    getSpreadsheet: () => ({ getSheetByName: () => sheet }),
    Date, parseInt, isNaN,
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn('VERALog.js', 'pruneSystemLog_'), ctx);
  const deleted = vm.runInContext('pruneSystemLog_()', ctx);

  check('deletes the 3 rows older than 45 days', deleted === 3, String(deleted));
  check('as ONE contiguous deleteRows call',
        sheet._sets.filter(s => s.deleteRows).length === 1,
        'row-by-row would be 3 round trips on a high-volume tab');
  check('starting at row 2', sheet._sets[0].deleteRows[0] === 2);
  check('keeps the 2 live rows', sheet._data.length === 2);

  // Retention override
  const sheet2 = fakeSheet(rows.map(r => r.slice()));
  const ctx2 = Object.assign({}, ctx, {
    getConfigValues: () => ({ system_log_retention_days: '5' }),
    getSpreadsheet: () => ({ getSheetByName: () => sheet2 }),
  });
  vm.createContext(ctx2);
  vm.runInContext(extractFn('VERALog.js', 'pruneSystemLog_'), ctx2);
  check('honours system_log_retention_days', vm.runInContext('pruneSystemLog_()', ctx2) === 4);

  // Nothing to do
  const sheet3 = fakeSheet([[new Date(now - 1 * DAY)]]);
  const ctx3 = Object.assign({}, ctx, { getSpreadsheet: () => ({ getSheetByName: () => sheet3 }) });
  vm.createContext(ctx3);
  vm.runInContext(extractFn('VERALog.js', 'pruneSystemLog_'), ctx3);
  check('no delete call when everything is fresh',
        vm.runInContext('pruneSystemLog_()', ctx3) === 0 && sheet3._sets.length === 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
