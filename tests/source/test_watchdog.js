// Tests the REAL Watchdog.js / VERALog.js functions, extracted from source by
// brace-matching and run in a vm context with the Apps Script globals stubbed.
// Never a copy — a copy would only prove the copy works.

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;


function extract(file, names) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let out = '';
  for (const name of names) {
    // Function declarations and top-level `var X = ...;` declarations.
    let i = src.indexOf('function ' + name + '(');
    if (i === -1) {
      const m = new RegExp('^var\\s+' + name + '\\s*=', 'm').exec(src);
      if (!m) throw new Error('not found: ' + name + ' in ' + file);
      let j = m.index, depth = 0, started = false;
      while (j < src.length) {
        const c = src[j];
        if (c === '[' || c === '{') { depth++; started = true; }
        else if (c === ']' || c === '}') depth--;
        else if (c === ';' && (!started || depth === 0)) { j++; break; }
        j++;
      }
      out += src.slice(m.index, j) + '\n';
      continue;
    }
    let j = src.indexOf('{', i), depth = 0;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    out += src.slice(i, j) + '\n';
  }
  return out;
}

const HOUR = 3600000;
const DAY  = 86400000;

// ---- Shared stubs -----------------------------------------------------------

function makeCtx(heartbeatState) {
  const props = { SYSTEM_HEARTBEATS: JSON.stringify(heartbeatState || {}) };
  const ctx = {
    console,
    Logger: { log: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
        deleteProperty: k => { delete props[k]; },
      }),
    },
    _props: props,
  };
  vm.createContext(ctx);
  return ctx;
}

const WATCHDOG_READS = [
  'HEARTBEAT_KEY_', '_heartbeatCache_', 'HEARTBEAT_REGISTRY', 'FEED_REGISTRY',
  'getHeartbeatState_', 'setHeartbeatState_', 'recordHeartbeat_', 'recordFeedResult_',
  'getOverdueJobs_', 'getSilentFeeds_', 'getWatchdogNotices_', 'describeHours_',
];

function loadWatchdog(state) {
  const ctx = makeCtx(state);
  // formatAge_ lives in ApiHealth.js and is reused rather than reimplemented.
  vm.runInContext(extract('ApiHealth.js', ['formatAge_']), ctx);
  vm.runInContext(extract('Watchdog.js', WATCHDOG_READS), ctx);
  return ctx;
}

// ---- Assertions -------------------------------------------------------------

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
}

// ---- getOverdueJobs_ --------------------------------------------------------

console.log('\ngetOverdueJobs_');
{
  const now = Date.now();
  const ctx = loadWatchdog({
    nightlyRun:           { lastRun: now - 27 * HOUR },  // window 26h -> overdue
    morningNudge:         { lastRun: now - 3  * HOUR },  // window 26h -> fine
    hourlyCheck:          { lastRun: now - 2  * HOUR },  // window 3h  -> fine
    checkFlightStatuses_: { lastRun: now - 5  * HOUR },  // window 2h  -> overdue
    // scanUSPSMail_, runEmailScan_, scanHoaWebsite_ deliberately absent
  });
  const overdue = vm.runInContext('getOverdueJobs_()', ctx);
  const jobs = overdue.map(o => o.job);

  check('27h-old nightly run is overdue at a 26h window', jobs.includes('nightlyRun'));
  check('5h-old flight poll is overdue at a 2h window', jobs.includes('checkFlightStatuses_'));
  check('3h-old morning nudge is not overdue at 26h', !jobs.includes('morningNudge'));
  check('2h-old hourly check is not overdue at 3h', !jobs.includes('hourlyCheck'));
  check('never-recorded jobs are not overdue',
        !jobs.includes('scanUSPSMail_') && !jobs.includes('runEmailScan_') && !jobs.includes('scanHoaWebsite_'),
        'a fresh deploy must not alarm on all seven');
  check('sorted worst-first', overdue.length === 2 && overdue[0].job === 'checkFlightStatuses_',
        JSON.stringify(jobs));
  check('carries a human age', /h|d/.test(overdue[0].ageText), overdue[0].ageText);
}

// ---- getSilentFeeds_ --------------------------------------------------------

console.log('\ngetSilentFeeds_');
{
  const now = Date.now();
  const ctx = loadWatchdog({
    // Running today, produced nothing for 30d, window 21d -> silent
    'gmail:travel-parser': { lastRun: now - 1 * HOUR, lastProduced: now - 30 * DAY },
    // Produced yesterday, window 14d -> fine
    'gmail:email-admin':   { lastRun: now - 1 * HOUR, lastProduced: now - 1 * DAY },
    // Has not run in 40 days (window 7d) -> the JOB watchdog's story, not this one's
    'gmail:usps':          { lastRun: now - 40 * DAY, lastProduced: now - 40 * DAY },
    // Running, never produced anything at all, window 45d
    'web:hoa':             { lastRun: now - 2 * HOUR, firstSeen: now - 60 * DAY },
  });
  const silent = vm.runInContext('getSilentFeeds_()', ctx);
  const feeds  = silent.map(f => f.feed);

  check('running + 30d dry at a 21d window is silent', feeds.includes('gmail:travel-parser'));
  check('produced yesterday is not silent', !feeds.includes('gmail:email-admin'));
  check('a feed that stopped running is NOT double-reported here',
        !feeds.includes('gmail:usps'),
        'getOverdueJobs_ already covers it');
  check('running but never produced is silent', feeds.includes('web:hoa'));
  check('everProduced distinguishes the two cases',
        silent.find(f => f.feed === 'gmail:travel-parser').everProduced === true &&
        silent.find(f => f.feed === 'web:hoa').everProduced === false);
  check('carries the hint', /Gmail search query/.test(
        silent.find(f => f.feed === 'gmail:travel-parser').hint));
}

// ---- recordFeedResult_ ------------------------------------------------------

console.log('\nrecordFeedResult_');
{
  const ctx = loadWatchdog({});
  vm.runInContext("recordFeedResult_('gmail:usps', 0)", ctx);
  let s = JSON.parse(ctx._props.SYSTEM_HEARTBEATS)['gmail:usps'];
  check('a zero-result run advances lastRun', !!s.lastRun);
  check('a zero-result run does NOT advance lastProduced', !s.lastProduced,
        'this is the whole distinction the feature rests on');

  vm.runInContext("recordFeedResult_('gmail:usps', 3)", ctx);
  s = JSON.parse(ctx._props.SYSTEM_HEARTBEATS)['gmail:usps'];
  check('a productive run advances lastProduced', !!s.lastProduced);
  check('and records the count', s.lastCount === 3);
}

// ---- Wording ----------------------------------------------------------------

console.log('\ngetWatchdogNotices_ wording');
{
  const now = Date.now();
  const ctx = loadWatchdog({
    nightlyRun:            { lastRun: now - 50 * HOUR },
    'gmail:travel-parser': { lastRun: now - 1 * HOUR, lastProduced: now - 30 * DAY },
  });
  const n = vm.runInContext('getWatchdogNotices_()', ctx);

  check('reports both kinds', n.lines.length === 2, JSON.stringify(n.lines));
  const jobLine  = n.lines.find(l => /Nightly run/.test(l));
  const feedLine = n.lines.find(l => /Travel email parser/.test(l));
  check('job line says "has not run"', /has not run in/.test(jobLine), jobLine);
  check('feed line says "found nothing", not "failed"',
        /found nothing in/.test(feedLine) && !/fail/i.test(feedLine), feedLine);
  check('hasAlerts is true', n.hasAlerts === true);

  const quiet = loadWatchdog({ nightlyRun: { lastRun: Date.now() - 1 * HOUR } });
  check('silent when everything is inside its window',
        vm.runInContext('getWatchdogNotices_()', quiet).hasAlerts === false);
}

console.log('\ndescribeHours_');
{
  const ctx = loadWatchdog({});
  check('26 -> "26 hours"',  vm.runInContext('describeHours_(26)', ctx) === '26 hours');
  check('1 -> "1 hour"',     vm.runInContext('describeHours_(1)', ctx) === '1 hour');
  check('192 -> "8 days"',   vm.runInContext('describeHours_(192)', ctx) === '8 days');
}

// ---- Buffered logger --------------------------------------------------------

console.log('\nflushSystemLog_ (VERALog.js)');
{
  const writes = [];
  const ctx = {
    console,
    Logger: { log: () => {} },
    SYSTEM_LOG_HEADERS: ['Timestamp','Routine','Category','Status','Summary','Duration (s)','Error'],
    TABS: { SYSTEM_LOG: 'System Log' },
    getSpreadsheet: () => ({}),
    ensureSheet: () => ({
      getLastRow: () => 1,
      getRange: (row, col, numRows, numCols) => ({
        setValues: rows => { writes.push({ row, numRows, rows }); },
      }),
    }),
    getConfigValues: () => ({}),
  };
  vm.createContext(ctx);
  vm.runInContext(extract('VERALog.js', [
    '_systemLogBuffer_', '_systemLogSheet_', 'SYSTEM_LOG_AUTOFLUSH_ROWS_',
    'bufferSystemLogRow_', 'getSystemLogSheet_', 'flushSystemLog_',
  ]), ctx);

  for (let i = 0; i < 7; i++) {
    vm.runInContext(`bufferSystemLogRow_('r${i}','Nightly','Success','did a thing', 4200)`, ctx);
  }
  check('nothing written before the flush', writes.length === 0);

  const n = vm.runInContext('flushSystemLog_()', ctx);
  check('7 entries flush as ONE setValues', writes.length === 1, JSON.stringify(writes.length));
  check('...carrying all 7 rows', writes[0].numRows === 7 && n === 7);
  check('appends below the header', writes[0].row === 2);
  check('duration stored in whole seconds', writes[0].rows[0][5] === 4);

  vm.runInContext('flushSystemLog_()', ctx);
  check('a second flush with an empty buffer writes nothing', writes.length === 1);

  // Auto-flush at the threshold, so a long run never holds 200 entries hostage.
  for (let i = 0; i < 50; i++) {
    vm.runInContext(`bufferSystemLogRow_('bulk${i}','Nightly','Success','x', 0)`, ctx);
  }
  check('auto-flushes at ' + vm.runInContext('SYSTEM_LOG_AUTOFLUSH_ROWS_', ctx) + ' rows',
        writes.length === 2 && writes[1].numRows === 50);
}

// ---- A failing write must not silently duplicate on the next flush ----------

console.log('\nflushSystemLog_ failure handling');
{
  let attempts = 0;
  const ctx = {
    console,
    Logger: { log: () => {} },
    SYSTEM_LOG_HEADERS: ['Timestamp','Routine','Category','Status','Summary','Duration (s)','Error'],
    TABS: { SYSTEM_LOG: 'System Log' },
    getSpreadsheet: () => ({}),
    ensureSheet: () => ({
      getLastRow: () => 1,
      getRange: () => ({ setValues: () => { attempts++; throw new Error('sheet locked'); } }),
    }),
  };
  vm.createContext(ctx);
  vm.runInContext(extract('VERALog.js', [
    '_systemLogBuffer_', '_systemLogSheet_', 'SYSTEM_LOG_AUTOFLUSH_ROWS_',
    'bufferSystemLogRow_', 'getSystemLogSheet_', 'flushSystemLog_',
  ]), ctx);

  vm.runInContext("bufferSystemLogRow_('r','Nightly','Success','x',0)", ctx);
  const n = vm.runInContext('flushSystemLog_()', ctx);
  check('a failed write is swallowed, not thrown', n === 0);
  vm.runInContext('flushSystemLog_()', ctx);
  check('and the rows are not retried into a duplicate', attempts === 1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
