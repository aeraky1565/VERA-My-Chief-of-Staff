// A job cannot report on itself from inside its own run.
//
// The morning email of 7 Oct contained these two lines, about itself:
//
//   • Morning briefing has not gone out in 1d 23h (expected every 26 hours)
//   • Morning email started but did not finish; last run was 1d 23h
//     — died during runWatchdog_ (expected every 26 hours)
//
// runWatchdog_ is the phase that produced them. morningNudge runs the watchdog as one
// of its own phases, roughly 250 lines before it records either of its heartbeats — so
// the watchdog saw a start marker seconds old against a heartbeat from the last run
// that actually finished, and answered exactly as designed. Both lines were true of the
// past and absurd where they were printed, and the breadcrumb named the phase that was
// asking.
//
// It surfaces ONLY on the morning after a failure: on a normal day the delivery marker
// is ~24h old, inside its 26h window, so nothing shows. Which means it appears on
// precisely the morning the banner most needs to be readable.
//
// What is asserted here is not only that the lines are gone, but that nothing stopped
// being watched — hourlyCheck still reports both jobs, every hour.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const WATCH = fs.readFileSync(ROOT + '/Watchdog.js', 'utf8');
const CODE  = fs.readFileSync(ROOT + '/Code.js', 'utf8');
const REM   = fs.readFileSync(ROOT + '/Reminders.js', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extract(file, names) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let out = '';
  for (const name of names) {
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
const READS = [
  'HEARTBEAT_KEY_', 'TRIGGER_REGISTRY_KEY_', '_heartbeatCache_',
  'HEARTBEAT_REGISTRY', 'FEED_REGISTRY',
  'getHeartbeatState_', 'setHeartbeatState_', 'getTriggerRegistrations_',
  'jobStartedAndDied_', 'formatAge_',
  'getOverdueJobs_', 'getSilentFeeds_', 'getWatchdogNotices_', 'describeHours_',
];

// The live shape on the morning after a miss: the last heartbeats are from the run
// before last, and the start marker is from seconds ago because we are inside the run.
function morningCtx(opts) {
  opts = opts || {};
  const now = Date.now();
  const props = {
    SYSTEM_HEARTBEATS: JSON.stringify(opts.state || {
      morningNudge:                 { lastRun: now - 47 * HOUR },
      'delivery:morning_briefing':  { lastRun: now - 47 * HOUR },
      nightlyRun:                   { lastRun: now - 9  * HOUR },
    }),
    LAST_MORNING_START: new Date(now - 4000).toISOString(),   // four seconds ago
    MORNING_STEP: 'runWatchdog_|3',                           // the phase that is asking
  };
  const ctx = {
    console, Date, String, Number, Object, Array, Math, JSON, isNaN, parseInt, isFinite,
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: k => { delete props[k]; },
    }) },
    isNotifEnabled_: () => true,
    _props: props,
  };
  vm.createContext(ctx);
  vm.runInContext(extract('ApiHealth.js', ['formatAge_']), ctx);
  vm.runInContext(extract('Watchdog.js', READS.filter(n => n !== 'formatAge_')), ctx);
  return ctx;
}

const SELF = "['morningNudge','delivery:morning_briefing']";

// ============================================================================
console.log('Without the exclusion, the email reports itself');
{
  // The bug, reproduced against the real function — so the fix below is measured
  // against something that actually happened rather than an assumption about it.
  const c = morningCtx();
  const jobs = vm.runInContext('getOverdueJobs_()', c).map(j => j.job);
  check('the unexcluded call still sees both morning jobs as overdue',
        jobs.indexOf('morningNudge') !== -1 &&
        jobs.indexOf('delivery:morning_briefing') !== -1,
        JSON.stringify(jobs) + ' — if this ever stops being true the fix below is ' +
        'passing for the wrong reason');

  const lines = vm.runInContext('getWatchdogNotices_().lines', c);
  check('…and renders the line the user actually received',
        lines.some(l => /Morning email started but did not finish/.test(l) &&
                        /died during runWatchdog_/.test(l)),
        JSON.stringify(lines));
}

console.log('\nWith it, the email is silent about itself');
{
  const c = morningCtx();
  const jobs = vm.runInContext('getOverdueJobs_(' + SELF + ')', c).map(j => j.job);

  check('morningNudge is not reported', jobs.indexOf('morningNudge') === -1, JSON.stringify(jobs));
  check('the delivery marker is not reported',
        jobs.indexOf('delivery:morning_briefing') === -1, JSON.stringify(jobs));
  check('…however stale they are',
        true === (JSON.parse(c._props.SYSTEM_HEARTBEATS).morningNudge.lastRun < Date.now() - 46 * HOUR),
        'the fixture has to be well past the 26h window or this proves nothing');

  const lines = vm.runInContext('getWatchdogNotices_(' + SELF + ').lines', c);
  check('neither line is rendered',
        !lines.some(l => /Morning email|Morning briefing/.test(l)), JSON.stringify(lines));
}

console.log('\nEverything else is still reported in the same call');
{
  const now = Date.now();
  const c = morningCtx({ state: {
    morningNudge:                { lastRun: now - 47 * HOUR },
    'delivery:morning_briefing': { lastRun: now - 47 * HOUR },
    nightlyRun:                  { lastRun: now - 30 * HOUR },   // genuinely overdue
    hourlyCheck:                 { lastRun: now - 1  * HOUR },   // fine
  } });
  const jobs = vm.runInContext('getOverdueJobs_(' + SELF + ')', c).map(j => j.job);

  check('a genuinely overdue OTHER job is still reported',
        jobs.indexOf('nightlyRun') !== -1, JSON.stringify(jobs) +
        ' — excluding the caller must not quieten the report it exists to make');
  check('…and a healthy one still is not', jobs.indexOf('hourlyCheck') === -1, JSON.stringify(jobs));
  check('the exclusion is exactly two jobs wide', jobs.length === 1, JSON.stringify(jobs));
}

console.log('\nNo exclusion behaves exactly as before');
{
  const a = morningCtx(), b = morningCtx();
  const none = vm.runInContext('JSON.stringify(getOverdueJobs_().map(function(j){return j.job;}))', a);
  const empty = vm.runInContext('JSON.stringify(getOverdueJobs_([]).map(function(j){return j.job;}))', b);
  check('getOverdueJobs_() and getOverdueJobs_([]) agree', none === empty, none + ' vs ' + empty);

  const c = morningCtx();
  let threw = '';
  try { vm.runInContext('getOverdueJobs_(null); getOverdueJobs_(undefined);', c); }
  catch (e) { threw = e.message; }
  check('null and undefined are tolerated', threw === '', threw);
}

console.log('\nCoverage is not lost — hourlyCheck still watches them');
{
  const c = morningCtx();
  // hourlyCheck passes NO exclusion, so it sees what the morning run declined to say.
  const jobs = vm.runInContext('getOverdueJobs_()', c).map(j => j.job);
  check('a genuinely dead morning email is still reported hourly',
        jobs.indexOf('morningNudge') !== -1 &&
        jobs.indexOf('delivery:morning_briefing') !== -1,
        JSON.stringify(jobs) + ' — this is the whole safety argument for excluding');
  check('…and hourlyCheck passes no exclusion',
        /try \{ runWatchdog_\(\); \} catch \(wdErr\)/.test(REM),
        'if it ever passes one, the morning jobs stop being watched by anything');
}

// ============================================================================
console.log('\nThe exclusion reaches the flag and Slack paths too');
{
  // runWatchdog_ hands ONE notices object to all three consumers, so excluding inside
  // getOverdueJobs_ covers the email lines, the High flag syncWatchdogFlags_ opens, and
  // the Slack announce. Excluding at the renderer would have fixed only the email —
  // and left a flag in the sheet saying the morning email died during runWatchdog_.
  const run = extract('Watchdog.js', ['runWatchdog_']);
  check('runWatchdog_ takes the exclusion', /function runWatchdog_\(exclude\)/.test(run));
  check('…and passes it on', /getWatchdogNotices_\(exclude\)/.test(run));
  check('…once, to one notices object',
        (run.match(/getWatchdogNotices_\(/g) || []).length === 1, run);
  check('…which feeds the flag sync', /syncWatchdogFlags_\(notices\)/.test(run));
  check('…and the Slack announce', /announceWatchdogToSlack_\(notices\)/.test(run));

  const notices = extract('Watchdog.js', ['getWatchdogNotices_']);
  check('getWatchdogNotices_ forwards it to getOverdueJobs_',
        /function getWatchdogNotices_\(exclude\)/.test(notices) &&
        /getOverdueJobs_\(exclude\)/.test(notices));

  // The filter is on the registry walk, not on the rendering.
  const overdue = extract('Watchdog.js', ['getOverdueJobs_']);
  check('the skip happens before any work on the entry',
        /if \(skip\[r\.job\]\) return;/.test(overdue) &&
        overdue.indexOf('if (skip[r.job]) return;') < overdue.indexOf('var entry'),
        'filtering later would still cost the property reads, and would be easy to ' +
        'apply to only one of the three surfaces');
}

console.log('\nThe morning run passes its own names');
{
  const body = (function () {
    const i = CODE.indexOf('function morningNudge(');
    let d = 0;
    for (let j = CODE.indexOf('{', i); j < CODE.length; j++) {
      if (CODE[j] === '{') d++;
      else if (CODE[j] === '}') { d--; if (d === 0) return CODE.slice(i, j + 1); }
    }
    return '';
  })();

  check('it names both of its own jobs',
        /var SELF = \['morningNudge', 'delivery:morning_briefing'\];/.test(body),
        'the delivery marker matters as much as the job: an email saying the briefing ' +
        'has not gone out, inside the briefing, is the more obviously wrong of the two');
  check('…and passes them on BOTH branches',
        (body.match(/runWatchdog_\(SELF\)/g) || []).length === 2,
        'the watchdog_email toggle picks the branch; only one of them being fixed ' +
        'would make the bug depend on a notification setting');
  check('no bare runWatchdog_() is left in the morning run',
        !/runWatchdog_\(\)/.test(body), body.slice(body.indexOf('runWatchdog_') - 80, body.indexOf('runWatchdog_') + 120));

  // The names have to match the registry, or the exclusion silently does nothing.
  const reg = /var HEARTBEAT_REGISTRY = \[([\s\S]*?)^\];/m.exec(WATCH)[1];
  const jobs = [...reg.matchAll(/job:\s*'([^']+)'/g)].map(m => m[1]);
  ['morningNudge', 'delivery:morning_briefing'].forEach(j => {
    check('  "' + j + '" is a real registry job', jobs.indexOf(j) !== -1, JSON.stringify(jobs));
  });
}

console.log('\nhourlyCheck records before it asks, and that is why it needs no exclusion');
{
  const hb = REM.indexOf("recordHeartbeat_('hourlyCheck')");
  const wd = REM.indexOf('runWatchdog_()');
  check('both are in hourlyCheck', hb !== -1 && wd !== -1);
  check('the heartbeat is recorded FIRST', hb < wd,
        'reversed, hourlyCheck would see its own heartbeat an hour stale and — with a ' +
        'start marker, were it ever given one — report itself exactly as the morning ' +
        'email did');
  check('…and the reason is written down',
        /load-bearing/i.test(REM.slice(hb, wd + 400)),
        'an uncommented ordering is one refactor from being swapped');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
