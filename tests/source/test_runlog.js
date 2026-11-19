// The Run Log (RunLog.js): a row per scheduled run, written as the run goes, so a run
// Apps Script kills at six minutes still says where it stopped. Invented data.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const SRC = read('RunLog.js');

function fakeSheet(rows) {
  const s = { rows: rows || [], appended: 0, writes: 0, deleted: [] };
  s.getLastRow = () => s.rows.length + 1;
  s.appendRow = r => { s.rows.push(r.slice()); s.appended++; };
  s.getRange = (r, c, nr, nc) => ({
    getValues: () => s.rows.slice(r - 2, r - 2 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
    setValues: v => { s.writes++; v.forEach((row, i) => row.forEach((x, j) => { s.rows[r - 2 + i][c - 1 + j] = x; })); },
    setValue: v => { s.writes++; s.rows[r - 2][c - 1] = v; },
  });
  s.deleteRows = (from, n) => { s.deleted.push([from, n]); s.rows.splice(from - 2, n); };
  return s;
}

function ctx(opts) {
  opts = opts || {};
  const sheet = opts.sheet || fakeSheet();
  const tabs = opts.tabs || {};
  const props = Object.assign({}, opts.props || {});
  const opened = [];
  const c = {
    Logger: { log() {} }, Date, Math, JSON, String, Number, Object, isNaN, parseInt,
    ensureSheet: (ss, name, headers) => { c.__ensured = [ss, name, headers]; (c.__names = c.__names || []).push(name); return ss === 'LOGS-SHEET' ? (tabs[name] || (tabs[name] = fakeSheet())) : sheet; },
    getSpreadsheet: () => 'VERA-SHEET',
    SpreadsheetApp: { openById: id => { opened.push(id); return 'LOGS-SHEET'; } },
    veraSettingId_: k => (opts.setting || {})[k] || '',
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] == null ? null : props[k] }) },
    redactSecrets_: s => String(s || '').replace(/sk-[A-Za-z0-9]+/g, '[redacted]'),
    peopleOwnerOnly_: () => opts.notOwner ? { ok: false, error: 'Only the owner can do that' } : null,
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: d => d.toISOString().slice(0, 19) },
  };
  vm.createContext(c);
  vm.runInContext(SRC, c);
  c.__sheet = sheet; c.__opened = opened; c.__tabs = tabs;
  return c;
}
const H = 13, C = { STARTED: 0, FN: 1, STATUS: 2, FIN: 3, DUR: 4, STEP: 5, AT: 6, STEPS: 7, SKIP: 8, ERR: 9, SLOW: 10, SUM: 11, ID: 12 };
const row = (o) => { const r = new Array(H).fill(''); Object.keys(o).forEach(k => { r[C[k]] = o[k]; }); return r; };

console.log('\nWhere it writes');
{
  const c = ctx({ setting: { RUN_LOG_SHEET_ID: 'LOGS-ID' } });
  c.runLogStart_('nightlyRun');
  check('the sheet named by run_log_sheet_id, in the job’s own tab', c.__opened[0] === 'LOGS-ID' && c.__ensured[0] === 'LOGS-SHEET' && c.__ensured[1] === 'Nightly run' && c.__tabs['Nightly run'].rows.length === 1, JSON.stringify(c.__ensured.slice(0, 2)));
  c.runLogFinish_('nightlyRun'); c.runLogStart_('checkFlightStatuses_', { triggerUid: 'x' });
  check('…each job its own tab, so the nightly rows aren’t buried under flight checks', c.__tabs['Flight status'].rows.length === 1 && c.__tabs['Nightly run'].rows.length === 1);
  c.runLogFinish_('checkFlightStatuses_');
  check('…and the row is completed in that same tab', c.__tabs['Flight status'].rows[0][2] === 'Done' && c.__tabs['Nightly run'].rows[0][2] === 'Done');
  check('…with the columns, Started first and Run ID last', c.__ensured[2][0] === 'Started' && c.__ensured[2][2] === 'Status' && c.__ensured[2][12] === 'Run ID' && c.__ensured[2].length === 13);
  const d = ctx();
  d.runLogStart_('nightlyRun');
  check('without the setting, one shared Run Log tab in VERA’s own sheet (not eight new tabs)', d.__opened.length === 0 && d.__ensured[0] === 'VERA-SHEET' && d.__ensured[1] === 'Run Log');
  d.runLogFinish_('nightlyRun'); d.runLogStart_('hourlyCheck');
  check('…every job in it', d.__names.every(n => n === 'Run Log') && d.__sheet.rows.length === 2);
}

console.log('\nA run that finishes');
{
  const c = ctx();
  c.runLogStart_('nightlyRun');
  const s = c.__sheet;
  check('a row is written the moment the run starts: Running', s.rows.length === 1 && s.rows[0][C.STATUS] === 'Running' && s.rows[0][C.FN] === 'nightlyRun' && /^nightlyRun-\d+$/.test(s.rows[0][C.ID]));
  const rc = { failures: [], skipped: [], blocked: [], timings: [] };
  for (let i = 1; i <= 4; i++) c.runLogStep_(rc, 'step' + i);
  check('steps are remembered, not written each time', s.writes === 0 && s.rows[0][C.STEP] === '', s.writes);
  c.runLogStep_(rc, 'step5');
  check('…the row shows the step every 5th one', s.writes === 1 && s.rows[0][C.STEP] === 'step5' && s.rows[0][C.STEPS] === 5);
  rc.timings.push({ name: 'collect', ms: 61000 }, { name: 'mpSyncNudges_', ms: 2000 });
  rc.failures.push('haSyncFlags_: boom sk-SECRET123');
  rc.skipped.push('pruneMemoryLog_');
  c.runLogNote_('nightlyRun', 'Success', '12 flags written', '');
  c.runLogFinish_('hourlyCheck');
  check('another job’s heartbeat doesn’t finish this row', s.rows[0][C.STATUS] === 'Running');
  c.runLogFinish_('nightlyRun');
  const r = s.rows[0];
  check('its own heartbeat does: Partial, since a step threw and one was skipped', r[C.STATUS] === 'Partial', r[C.STATUS]);
  check('…finished time and duration', r[C.FIN] instanceof Date && typeof r[C.DUR] === 'number');
  check('…the last step, how many ran, and what was skipped', r[C.STEP] === 'step5' && r[C.STEPS] === 5 && r[C.SKIP] === 'pruneMemoryLog_');
  check('…errors, with secrets taken out', r[C.ERR] === 'haSyncFlags_: boom [redacted]', r[C.ERR]);
  check('…the slowest steps, slowest first', r[C.SLOW] === 'collect 61.0s · mpSyncNudges_ 2.0s', r[C.SLOW]);
  check('…and the handler’s own summary', r[C.SUM] === '12 flags written');
  const c2 = ctx(); c2.runLogStart_('runEmailScan_'); c2.runLogNote_('runEmailScan', 'Skipped', 'email_parser_enabled is not true', ''); c2.runLogFinish_('runEmailScan_');
  check('a handler that says Skipped reads Skipped (the trailing _ ignored)', c2.__sheet.rows[0][C.STATUS] === 'Skipped');
  const c5 = ctx(); c5.runLogStart_('nightlyRunTail'); c5.runLogStep_({ failures: [], skipped: ['runExplorer_'], blocked: [], timings: [] }, 'writeSummarySnapshot');
  c5.runLogNote_('nightlyRunTail', 'Success', '', ''); c5.runLogFinish_('nightlyRunTail');
  check('a run where the time budget skipped a step reads Partial, naming it', c5.__sheet.rows[0][C.STATUS] === 'Partial' && c5.__sheet.rows[0][C.SKIP] === 'runExplorer_', c5.__sheet.rows[0][C.STATUS]);
  const c3 = ctx(); c3.runLogStart_('hourlyCheck'); c3.runLogFinish_('hourlyCheck');
  check('a clean run reads Done', c3.__sheet.rows[0][C.STATUS] === 'Done');
  const c4 = ctx(); c4.runLogStart_('morningNudge'); c4.runLogNote_('morningNudge', 'Failed', '', 'Drive down'); c4.runLogFinish_('morningNudge');
  check('a run that failed reads Failed, with the error', c4.__sheet.rows[0][C.STATUS] === 'Failed' && c4.__sheet.rows[0][C.ERR] === 'Drive down');
}

console.log('\nWhat isn’t logged');
{
  const c = ctx();
  c.runLogStart_('checkFlightStatuses_', true);
  c.runLogStart_('scanUSPSMail_', 'catch-up: the 10:00 trigger had not run');
  check('a handler called from code with its own arguments is not a scheduled run', c.__sheet.rows.length === 0);
  c.runLogStart_('checkFlightStatuses_', { triggerUid: '1' });
  check('…called by its trigger (an event object), it is', c.__sheet.rows.length === 1);
  c.runLogStart_('scanUSPSMail_', { triggerUid: '2' });
  check('a job started inside another logged run adds no row of its own', c.__sheet.rows.length === 1);
}

console.log('\nA run that was cut off');
{
  const now = Date.UTC(2026, 10, 18, 4, 30);
  const old = new Date(now - 90 * 60000), older = new Date(now - 25 * 3600000), fresh = new Date(now - 2 * 60000);
  const sheet = fakeSheet([
    row({ STARTED: older, FN: 'nightlyRun', STATUS: 'Running', STEP: 'checkPTOStrategy_', AT: 60, ID: 'nightlyRun-1' }),
    row({ STARTED: old, FN: 'nightlyRun', STATUS: 'Running', STEP: 'syncImportantDatesToCalendar_', AT: 150, ID: 'nightlyRun-2' }),
    row({ STARTED: old, FN: 'hourlyCheck', STATUS: 'Done', ID: 'hourlyCheck-3' }),
    row({ STARTED: fresh, FN: 'runEmailScan_', STATUS: 'Running', ID: 'runEmailScan_-4' }),
  ]);
  const c = ctx({ sheet, props: { NIGHTLY_STEP: 'mpSyncNudges_|183' } });
  const n = c.runLogSweep_(null, null, now);
  check('rows left Running past six minutes become Cut off', sheet.rows[0][C.STATUS] === 'Cut off' && sheet.rows[1][C.STATUS] === 'Cut off' && n === 2, n);
  check('the newest takes the step it died in from the breadcrumb', sheet.rows[1][C.STEP] === 'mpSyncNudges_' && sheet.rows[1][C.AT] === 183, JSON.stringify(sheet.rows[1]));
  check('…and says so in plain words', sheet.rows[1][C.SUM] === 'Never finished: cut off during mpSyncNudges_ at 183s', sheet.rows[1][C.SUM]);
  check('an older one keeps the last step it wrote (the breadcrumb has moved on)', sheet.rows[0][C.STEP] === 'checkPTOStrategy_' && sheet.rows[0][C.AT] === 60);
  check('a run started two minutes ago is left Running', sheet.rows[3][C.STATUS] === 'Running');
  check('a finished run is never touched', sheet.rows[2][C.STATUS] === 'Done');
  const s2 = fakeSheet([row({ STARTED: old, FN: 'nightlyRun', STATUS: 'Running', ID: 'nightlyRun-9' }), row({ STARTED: old, FN: 'morningNudge', STATUS: 'Running', ID: 'morningNudge-8' })]);
  const c2 = ctx({ sheet: s2, props: { NIGHTLY_STEP: 'collect|181' } });
  c2.runLogStart_('nightlyRun');
  check('the next run of the same job sweeps its own dead row when it starts', s2.rows[0][C.STATUS] === 'Cut off' && s2.rows[0][C.STEP] === 'collect');
  check('…and leaves other jobs to the hourly sweep', s2.rows[1][C.STATUS] === 'Running');
  check('…then writes its own Running row', s2.rows[2][C.STATUS] === 'Running' && s2.rows[2][C.FN] === 'nightlyRun');
}

console.log('\nKeeping 30 days');
{
  const now = Date.UTC(2026, 10, 18);
  const c = ctx();
  const d = n => new Date(now - n * 86400000);
  check('rows older than 30 days at the top, up to the first newer one', c.runLogExpired_([d(40), d(31), d(29), d(35)], now) === 2);
  check('none when the oldest is recent', c.runLogExpired_([d(3)], now) === 0);
}

console.log('\nThe card’s data');
{
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(row({ STARTED: 't' + i, FN: 'checkFlightStatuses_', STATUS: 'Done', ID: 'f' + i }));
  rows.splice(3, 0, row({ STARTED: 'n1', FN: 'nightlyRun', STATUS: 'Cut off', STEP: 'collect', AT: 181, ID: 'n1' }));
  rows.push(row({ STARTED: 'h1', FN: 'hourlyCheck', STATUS: 'Done', DUR: 12, ID: 'h1' }));
  const c = ctx();
  const jobs = JSON.parse(JSON.stringify(c.runLogJobs_(rows, null, 7)));
  check('one entry per job, in schedule order: the nightly run first', JSON.stringify(jobs.map(j => j.fn)) === '["nightlyRun","hourlyCheck","checkFlightStatuses_"]', JSON.stringify(jobs.map(j => j.fn)));
  check('the every-15-minutes job doesn’t crowd the nightly run out: at most 7 each, newest first', jobs[2].runs.length === 7 && jobs[2].runs[0].started === 't11');
  check('each run carries its status and step', jobs[0].runs[0].status === 'Cut off' && jobs[0].runs[0].step === 'collect' && jobs[0].runs[0].at === 181 && jobs[1].runs[0].secs === 12);
  const no = ctx({ notOwner: true });
  check('owner only', no.webRunLog_().error === 'Only the owner can do that');
  const own = ctx({ sheet: fakeSheet(rows) }).webRunLog_();
  check('the route, from the shared tab: the jobs, and where they come from', own.ok && own.jobs.length === 3 && /Run Log tab in VERA/.test(own.where), JSON.stringify(own).slice(0, 200));
  const tabs = { 'Nightly run': fakeSheet([rows[3]]), 'Flight status': fakeSheet(rows.filter(r => r[1] === 'checkFlightStatuses_')), 'Hourly check': fakeSheet([rows[rows.length - 1]]) };
  const out = ctx({ tabs, setting: { RUN_LOG_SHEET_ID: 'X' } }).webRunLog_();
  check('…from a tab per job: each job’s last 7, read from its own tab', out.ok && JSON.stringify(out.jobs.map(j => j.fn + ':' + j.runs.length)) === '["nightlyRun:1","hourlyCheck:1","checkFlightStatuses_:7"]' && out.jobs[2].runs[0].started === 't11' && /a tab per job/.test(out.where), JSON.stringify(out.jobs.map(j => j.fn + ':' + j.runs.length)));
  const sw = { 'Nightly run': fakeSheet([row({ STARTED: new Date(Date.now() - 3600000), FN: 'nightlyRun', STATUS: 'Running', ID: 'n' })]), 'Morning email': fakeSheet([row({ STARTED: new Date(Date.now() - 3600000), FN: 'morningNudge', STATUS: 'Running', ID: 'm' })]) };
  const cs = ctx({ tabs: sw, setting: { RUN_LOG_SHEET_ID: 'X' } });
  check('the hourly sweep goes through every job’s tab', cs.runLogSweep_(null, null, Date.now()) === 2 && sw['Nightly run'].rows[0][2] === 'Cut off' && sw['Morning email'].rows[0][2] === 'Cut off');
}

function extractFnNR_(name) {
  const src = read('NightlyRunner.js'), start = src.indexOf('function ' + name + '(');
  if (start === -1) return '';
  let d = 0; for (let j = src.indexOf('{', start); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(start, j + 1); }
  return '';
}
console.log('\nWired into the scheduled handlers');
{
  const files = { 'NightlyRunner.js': ['nightlyRun'], 'Code.js': ['morningNudge'], 'Reminders.js': ['hourlyCheck'], 'FlightStatus.js': ['checkFlightStatuses_'],
                  'EmailParser.js': ['runEmailScan_'], 'MailCounter.js': ['scanUSPSMail_'], 'NeighborhoodWatcher.js': ['scanHoaWebsite_'] };
  Object.keys(files).forEach(f => {
    const src = read(f);
    files[f].forEach(fn => {
      const at = src.indexOf('function ' + fn + '(');
      const head = src.slice(at, src.indexOf('\n', src.indexOf('{', at)) + 160);
      check(fn + ' opens its row first, guarded', new RegExp("^function " + fn + "\\([^)]*\\) \\{\\n  try \\{ runLogStart_\\('" + fn + "', ").test(head) && /\} catch \(rlErr\) \{\}/.test(head), head.slice(0, 140));
    });
  });
  const code = read('Code.js'), spec = code.slice(code.indexOf("{ handler: 'nightlyRun',"), code.indexOf("{ handler: 'scanHoaWebsite_'") + 40);
  const handlers = (spec.match(/handler: '([A-Za-z_]+)'/g) || []).map(s => s.split("'")[1]);
  check('…which is every handler in TRIGGER_SPECS, and the card lists them all', handlers.length === 7 && handlers.indexOf('nightlyRunTail') === -1 && handlers.every(h => /RUN_LOG_ORDER_ = \[[^\]]*'/.test(SRC) && SRC.indexOf("'" + h + "'") !== -1), handlers.join(','));
  check('each nightly part after the first opens its own row (a part that hands off ends as Continued)', /  try \{ runLogStart_\('nightlyRun', arguments\[0\]\); \} catch \(rlErr\) \{\}/.test(extractFnNR_('nightlyContinue')) && /runLogHandoff_\(ctx, /.test(read('NightlyRunner.js')));
  check('nightlyStep_ reports each step', /try \{ runLogStep_\(ctx, name\); \} catch \(rlErr\) \{\}/.test(code));
  check('recordHeartbeat_ completes the row', /try \{ runLogFinish_\(job\); \} catch \(rlErr\) \{\}/.test(read('Watchdog.js')));
  check('the hourly watchdog sweeps rows left Running', /runLogSweep_\(null, null, Date\.now\(\)\)/.test(read('Watchdog.js')));
  check('veraLog_ passes on each handler’s verdict', /try \{ runLogNote_\(routine, status, summary, error\); \} catch \(rlErr\) \{\}/.test(read('VERALog.js')));
  check('the nightly prune keeps 30 days', /try \{ runLogPrune_\(\); \}/.test(read('VERALog.js')));
  check('the run_log route', /case 'run_log':\s+return jsonOut_\(webRunLog_\(\)\);/.test(read('WebApp.js')));
}

console.log('\nGym check-ins the same evening');
{
  const G = read('GymTracker.js');
  const g = { Logger: { log() {} }, calls: 0 };
  vm.createContext(g);
  vm.runInContext(G.slice(G.indexOf('function gymEveningHour_'), G.indexOf('// ---------------------------------------------------------------------------', G.indexOf('function gymEveningCheck_'))), g);
  g.checkGymSessions_ = () => { g.calls++; };
  const at = h => new Date(2026, 10, 17, h, 5);
  check('from 6 pm to 11 pm, hourlyCheck looks for workouts that ended', g.gymEveningCheck_(at(18)) && g.gymEveningCheck_(at(23)) && g.calls === 2);
  check('not during the day', !g.gymEveningCheck_(at(17)) && !g.gymEveningCheck_(at(9)) && g.calls === 2);
  g.checkGymSessions_ = () => { throw new Error('calendar down'); };
  check('a failure never reaches hourlyCheck', g.gymEveningCheck_(at(20)) === false);
  check('hourlyCheck calls it, guarded', /try \{ gymEveningCheck_\(new Date\(\)\); \} catch \(gymErr\)/.test(read('Reminders.js')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
