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

// props: a shared Script Properties store, so several runs can be played as nights.
// lastRuns: the heartbeat map those runs see (a restore reports the job's last run).
function loadFlagSync(sheet, notifEnabled, props, lastRuns) {
  props = props || {};
  const logged = [];
  const ctx = {
    console, Logger: { log: () => {} },
    FLAG_HEADERS,
    TABS: { FLAGS: 'Flags' },
    getSpreadsheet: () => ({ getSheetByName: () => sheet }),
    isNotifEnabled_: k => (notifEnabled === undefined || notifEnabled === null ? true : !!notifEnabled[k]),
    colorCodeFlags: () => {},
    veraLog_: (...a) => logged.push(a),
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k === 'SYSTEM_HEARTBEATS' ? JSON.stringify(lastRuns || {}) : (k in props ? props[k] : null)),
      setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const dt = new Date(d), iso = dt.toISOString();
        if (fmt === 'yyyy-MM-dd') return iso.slice(0, 10);
        if (fmt === 'yyyyMMddHHmm') return iso.slice(0, 16).replace(/[-T:]/g, '');
        if (fmt === 'EEE MMM d') return iso.slice(0, 10);
        if (fmt === 'EEE MMM d, h:mm a') return iso.slice(0, 16).replace('T', ' ');
        return iso;
      },
    },
    Math, Date, String, Object, JSON,
  };
  vm.createContext(ctx);
  const W = fs.readFileSync(path.join(ROOT, 'Watchdog.js'), 'utf8');
  vm.runInContext(
    "var WATCHDOG_FLAG_SOURCE_='System'; var WATCHDOG_FLAG_PREFIX_='watchdog_';\n" +
    "var WATCHDOG_INCIDENTS_KEY_='WATCHDOG_INCIDENTS'; var WATCHDOG_RESTORED_PREFIX_='watchdog_restored_';\n" +
    "var _heartbeatCache_ = null; var HEARTBEAT_KEY_='SYSTEM_HEARTBEATS';\n" +
    W.match(/var HEARTBEAT_REGISTRY = \[[\s\S]*?^\];/m)[0] + '\n' +
    W.match(/var FEED_REGISTRY = \[[\s\S]*?^\];/m)[0] + '\n' +
    ['describeHours_', 'syncWatchdogFlags_', 'watchdogSlug_', 'getWatchdogIncidents_',
     'setWatchdogIncidents_', 'watchdogRestoredText_', 'getHeartbeatState_'].map(n => extractFn('Watchdog.js', n)).join(''), ctx);
  ctx._logged = logged;
  ctx._props = props;
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
      // Answers only the key it is asked for. Returning the heartbeat JSON for every
      // key fed it back as the trigger-registration map too, which is the sort of
      // agreeable stub that makes a fixture stop resembling the real service.
      getProperty: k => k === 'SYSTEM_HEARTBEATS'
        ? JSON.stringify({ nightlyRun: { lastRun: Date.now() - 51 * 3600000 } })
        : null,
      setProperty: () => {}, deleteProperty: () => {} }) } };
  vm.createContext(ctx);
  vm.runInContext(extractFn('ApiHealth.js', 'formatAge_'), ctx);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'Watchdog.js'), 'utf8')
      .match(/var HEARTBEAT_KEY_[\s\S]*?^\];/m)[0], ctx);
  vm.runInContext("var _heartbeatCache_ = null;", ctx);
  vm.runInContext(extractFn('Watchdog.js', 'getHeartbeatState_'), ctx);
  vm.runInContext(extractFn('Watchdog.js', 'getTriggerRegistrations_'), ctx);
  vm.runInContext(extractFn('Watchdog.js', 'jobStartedAndDied_'), ctx);
  vm.runInContext(extractFn('Watchdog.js', 'getOverdueJobs_'), ctx);
  const jobs = vm.runInContext('getOverdueJobs_()', ctx);
  if (!jobs.length) throw new Error('fixture setup produced no overdue jobs');
  return { jobs: jobs, feeds: [], lines: [], hasAlerts: true };
})();

console.log('\nsyncWatchdogFlags_ — opening an incident');
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
  check('the key is this incident’s own: watchdog_<job>__<when first seen>', /^watchdog_nightlyrun__\d{12}$/.test(row[9]), row[9]);
  const inc = JSON.parse(ctx._props.WATCHDOG_INCIDENTS || '{}');
  check('…and the incident is remembered', inc.nightlyRun && inc.nightlyRun.key === row[9], JSON.stringify(inc));
}

console.log('\nsyncWatchdogFlags_ — still broken on the next check');
{
  const props = {};
  const sheet = fakeSheet([]);
  const c0 = loadFlagSync(sheet, null, props); c0.NOTICE = NOTICE;
  vm.runInContext('syncWatchdogFlags_(NOTICE)', c0);
  const c1 = loadFlagSync(sheet, null, props); c1.NOTICE = NOTICE;
  vm.runInContext('syncWatchdogFlags_(NOTICE)', c1);

  check('does not open a duplicate', sheet._appended.length === 1);
  const textWrites = sheet._sets.filter(s => s.col === 4);
  check('does not rewrite identical flag text', textWrites.length === 0,
        'runs hourly — an unchanged row should cost no writes');
}

console.log('\nsyncWatchdogFlags_ — a flag from before incidents is adopted');
{
  const existing = [['FLAG-1','2026-10-21','System','Nightly run has not run in 1d 3h',
                     'old reason','High','No','','No','watchdog_nightlyrun','']];
  const sheet = fakeSheet(existing);
  const ctx = loadFlagSync(sheet);
  ctx.NOTICE = NOTICE;
  vm.runInContext('syncWatchdogFlags_(NOTICE)', ctx);

  check('refreshes the existing flag’s text',
        sheet._sets.some(s => s.col === 4 && s.v.indexOf(NOTICE.jobs[0].ageText) !== -1));
  check('refreshes the reason', sheet._sets.some(s => s.col === 5));
  check('no duplicate row', sheet._appended.length === 0);
  check('…it is now that job’s incident', JSON.parse(ctx._props.WATCHDOG_INCIDENTS).nightlyRun.key === 'watchdog_nightlyrun');
}

console.log('\nMonday fails, Tuesday restores, Wednesday says nothing');
{
  const QUIET = { jobs: [], feeds: [], lines: [], hasAlerts: false };
  const props = {}, sheet = fakeSheet([]);
  const tueRun = Date.parse('2026-10-22T03:31:00Z');

  const mon = loadFlagSync(sheet, null, props); mon.NOTICE = NOTICE;
  vm.runInContext('syncWatchdogFlags_(NOTICE)', mon);
  const failKey = sheet._appended[0][9];

  const tue = loadFlagSync(sheet, null, props, { nightlyRun: { lastRun: tueRun } }); tue.QUIET = QUIET;
  vm.runInContext('syncWatchdogFlags_(QUIET)', tue);
  const failRow = sheet._data.find(r => r[9] === failKey);
  check('Tuesday: Monday’s failure flag is resolved', failRow[8] === 'Yes');
  const restored = sheet._appended.filter(r => /^watchdog_restored_nightlyrun__/.test(r[9]));
  check('…ONE "restored" flag is added, Low', restored.length === 1 && restored[0][5] === 'Low', JSON.stringify(restored.map(r => r[9])));
  check('…saying when it came back, and when it failed',
        /^Nightly run restored — first good run 2026-10-22 03:31, after the failure flagged /.test(restored[0][3]), restored[0][3]);
  check('…with the same incident stamp as the failure', restored[0][9] === 'watchdog_restored_' + failKey.slice('watchdog_'.length));
  check('…and one System Log row', tue._logged.length === 1 && tue._logged[0][0] === 'watchdog' && tue._logged[0][2] === 'Success' && /Nightly run restored/.test(tue._logged[0][3]));
  check('…the incident is closed', !JSON.parse(props.WATCHDOG_INCIDENTS).nightlyRun);

  const before = sheet._appended.length;
  const wed = loadFlagSync(sheet, null, props, { nightlyRun: { lastRun: tueRun + 86400000 } }); wed.QUIET = QUIET;
  vm.runInContext('syncWatchdogFlags_(QUIET)', wed);
  check('Wednesday: nothing new — no flag, no log row', sheet._appended.length === before && wed._logged.length === 0);

  // Thursday it fails again: a NEW incident, Monday's flag left exactly as it was.
  const monRowBefore = JSON.stringify(sheet._data.find(r => r[9] === failKey));
  const thu = loadFlagSync(sheet, null, props); thu.NOTICE = NOTICE;
  vm.runInContext('syncWatchdogFlags_(NOTICE)', thu);
  const fresh = sheet._appended.filter(r => /^watchdog_nightlyrun__/.test(r[9]));
  check('a later failure opens a NEW flag', fresh.length === 2, fresh.map(r => r[9]).join(', '));
  check('…and Monday’s flag is not touched', JSON.stringify(sheet._data.find(r => r[9] === failKey)) === monRowBefore);
}

console.log('\nthe pre-incident flag on the sheet today gets its restore');
{
  const existing = [['FLAG-1','2026-10-21','System','Nightly run started but did not finish; last completed run was 1d 14h',
                     'r','High','No','','No','watchdog_nightlyrun','']];
  const sheet = fakeSheet(existing);
  const ctx = loadFlagSync(sheet, null, {}, { nightlyRun: { lastRun: Date.parse('2026-10-22T03:31:00Z') } });
  ctx.QUIET = { jobs: [], feeds: [], lines: [], hasAlerts: false };
  vm.runInContext('syncWatchdogFlags_(QUIET)', ctx);
  check('it is resolved', sheet._data[0][8] === 'Yes');
  check('…and a restored flag is logged once', sheet._appended.length === 1 && /^watchdog_restored_nightlyrun__/.test(sheet._appended[0][9]) && ctx._logged.length === 1, JSON.stringify(sheet._appended.map(r => r[9])));
}

console.log('\nfeeds keep their old lifecycle');
{
  const F = { jobs: [], feeds: [{ feed: 'gmail:usps', label: 'USPS Informed Delivery', ageText: '9d', droughtDays: 7, hint: 'x' }], lines: ['x'], hasAlerts: true };
  const existing = [['FLAG-1','2026-06-01','System','USPS Informed Delivery has found nothing in 8d',
                     'r','Medium','Yes','','Yes','watchdog_gmailusps','7d']];
  const sheet = fakeSheet(existing);
  const ctx = loadFlagSync(sheet); ctx.F = F;
  vm.runInContext('syncWatchdogFlags_(F)', ctx);
  check('a returning drought reopens its one row', sheet._sets.some(s => s.col === 9 && s.v === 'No') && sheet._appended.length === 0);
  const c2 = loadFlagSync(sheet); c2.QUIET = { jobs: [], feeds: [], lines: [], hasAlerts: false };
  vm.runInContext('syncWatchdogFlags_(QUIET)', c2);
  check('…closes when it ends, with no "restored" flag or log row', sheet._data[0][8] === 'Yes' && sheet._appended.length === 0 && c2._logged.length === 0);
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
