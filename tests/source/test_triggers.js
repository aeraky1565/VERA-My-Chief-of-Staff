// setupTriggers had NO test coverage at all, and it is the function that points the
// live Apps Script triggers.
//
// WHAT WENT WRONG. It held three lists: a hand-written `||` chain of handler names to
// delete, a run of create blocks, and a hardcoded Logger.log summary. Adding
// nightlyRunTail touched exactly one of them. So the function whose own docstring
// promises it is "safe to call multiple times" deleted seven handlers, created eight,
// and APPENDED the tail on every call — two tails a night means two Explorer
// bulletins, two suggestDueDates Claude calls, two checkCrossPatternFlags_ passes over
// the same flags, and two heartbeats racing one property. Meanwhile the log named the
// seven it had always named, so it could not even tell you the eighth existed.
//
// Two kinds of assertion here, and the distinction matters:
//
//  1. THE INVARIANT — every handler created is also deletable. That is what makes the
//     bug impossible for the NEXT trigger, not just this one.
//  2. THE EQUIVALENCE — the exact builder chain per handler, all eight, pinned against
//     what is live today. The fix was a refactor of live scheduling code, and a dropped
//     .everyDays(1) or an .inTimezone() added to an everyMinutes chain is a silent
//     misfire. These assertions exist to prove the refactor changed no schedule.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(ROOT + '/Code.js', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

// A ScriptApp that RECORDS instead of scheduling. Every builder method returns the
// same recorder, so the chain is captured in call order — which is the thing under
// test, since .everyMinutes(15) and .atHour(10).everyDays(1) are different schedules
// made of the same shaped calls.
function harness(opts) {
  opts = opts || {};
  const existing = (opts.existing || []).map(h => ({
    handler: h, deleted: false, getHandlerFunction: function() { return h; },
  }));
  const log = [];
  const created = [];      // { handler, chain: ['atHour(23)', 'everyDays(1)', …] }
  const props = {};

  const ScriptApp = {
    WeekDay: { MONDAY: 'MONDAY', TUESDAY: 'TUESDAY' },
    getProjectTriggers: () => existing.filter(t => !t.deleted),
    deleteTrigger: t => { t.deleted = true; log.push('delete:' + t.handler); },
    newTrigger: function(handler) {
      const rec = { handler: handler, chain: [], created: false };
      const builder = {};
      ['timeBased', 'atHour', 'everyDays', 'everyHours', 'everyMinutes', 'everyWeeks',
       'onWeekDay', 'inTimezone', 'nearMinute', 'atMinute'].forEach(function(m) {
        builder[m] = function() {
          // timeBased() is the same on every chain and says nothing; the rest are the
          // schedule.
          if (m !== 'timeBased') {
            rec.chain.push(m + '(' + Array.prototype.slice.call(arguments).join(',') + ')');
          }
          return builder;
        };
      });
      builder.create = function() {
        rec.created = true;
        created.push(rec);
        log.push('create:' + handler);
        return rec;
      };
      return builder;
    },
  };

  const ctx = {
    String, Number, Object, Array, Math, JSON, Error, console, isNaN,
    Logger: { log: m => { log.push('log:' + m); } },
    Date: { now: () => 1762000000000 },
    ScriptApp: ScriptApp,
    Session: { getScriptTimeZone: () => 'America/New_York' },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => {
        if (opts.propsThrow) throw new Error('props unavailable');
        props[k] = String(v);
      },
      deleteProperty: k => { delete props[k]; },
    }) },
    CONFIG: { NIGHTLY_RUN_HOUR: 23, MORNING_NUDGE_HOUR: 7 },
    _log: log, _created: created, _existing: existing, _props: props,
  };
  vm.createContext(ctx);

  // The real functions, plus the real recorder out of Watchdog.js — not a stub, or the
  // registration assertions would only prove the stub works.
  vm.runInContext(
    extractFn(SRC, 'veraTriggerSpecs_') + '\n' +
    extractFn(SRC, 'setupTriggers') + '\n' +
    extractFn(fs.readFileSync(ROOT + '/Watchdog.js', 'utf8'), 'recordTriggerRegistrations_') + '\n' +
    /^var TRIGGER_REGISTRY_KEY_\s*=.*?;/m.exec(fs.readFileSync(ROOT + '/Watchdog.js', 'utf8'))[0],
    ctx);
  return ctx;
}

// ============================================================================
console.log('Every handler created is also deletable');
{
  // THE INVARIANT. Derived from the specs rather than a list typed here, because a
  // hand-typed list is exactly what drifted in the first place.
  const c = harness();
  const specs = vm.runInContext('veraTriggerSpecs_()', c);
  const handlers = specs.map(s => s.handler);

  check('there are specs at all', handlers.length >= 8, JSON.stringify(handlers));
  check('no handler is listed twice',
        new Set(handlers).size === handlers.length, JSON.stringify(handlers));

  // Run against a project that already has one of each: all must be removed.
  const c2 = harness({ existing: handlers.slice() });
  vm.runInContext('setupTriggers()', c2);
  const deleted = c2._log.filter(l => l.startsWith('delete:')).map(l => l.slice(7));
  check('an existing trigger for EVERY handler is deleted',
        handlers.every(h => deleted.indexOf(h) !== -1),
        JSON.stringify(handlers.filter(h => deleted.indexOf(h) === -1)) +
        ' — a handler created but not deleted is a duplicate on every run, which is ' +
        'exactly what nightlyRunTail was');
  check('…and every handler is created',
        c2._created.map(r => r.handler).join(',') === handlers.join(','),
        JSON.stringify(c2._created.map(r => r.handler)));
  check('running it twice over leaves one of each, not two',
        c2._created.length === handlers.length,
        JSON.stringify(c2._created.map(r => r.handler)));

  // Order: all deletes before any create. Interleaving would let a create land ahead
  // of its own delete, which re-creates the duplicate from the other direction.
  const firstCreate = c2._log.findIndex(l => l.startsWith('create:'));
  const lastDelete  = c2._log.reduce((acc, l, i) => l.startsWith('delete:') ? i : acc, -1);
  check('every delete happens before any create',
        lastDelete < firstCreate, JSON.stringify(c2._log.slice(0, 20)));

  // A project with duplicates already in it — the state a pre-fix double run leaves.
  const c3 = harness({ existing: handlers.concat(['nightlyRunTail', 'nightlyRunTail']) });
  vm.runInContext('setupTriggers()', c3);
  const tails = c3._created.filter(r => r.handler === 'nightlyRunTail');
  check('a project that already has duplicate tails is collapsed back to one',
        tails.length === 1 &&
        c3._log.filter(l => l === 'delete:nightlyRunTail').length === 3,
        JSON.stringify({ created: tails.length,
                         deleted: c3._log.filter(l => l === 'delete:nightlyRunTail').length }));

  // Other people's triggers are not ours to remove.
  const c4 = harness({ existing: ['processSlackQueue_', 'someoneElsesJob'] });
  vm.runInContext('setupTriggers()', c4);
  check('triggers we do not own are left alone',
        c4._log.filter(l => l.startsWith('delete:')).length === 0,
        JSON.stringify(c4._log.filter(l => l.startsWith('delete:'))) +
        ' — Slack.js manages its own queue triggers');
}

// ============================================================================
console.log('\nEvery schedule, pinned');
{
  // THE EQUIVALENCE. These are the chains that were live before the refactor, written
  // out from the eight create blocks it replaced. If one of these changes, a trigger
  // fires at a different time than it used to, which is not a thing to discover from
  // production.
  const EXPECTED = {
    nightlyRun:           ['atHour(23)', 'everyDays(1)', 'inTimezone(America/New_York)'],
    nightlyRunTail:       ['atHour(0)',  'everyDays(1)', 'inTimezone(America/New_York)'],
    morningNudge:         ['atHour(7)',  'everyDays(1)', 'inTimezone(America/New_York)'],
    hourlyCheck:          ['everyHours(1)', 'inTimezone(America/New_York)'],
    checkFlightStatuses_: ['everyMinutes(15)'],
    runEmailScan_:        ['everyMinutes(30)'],
    scanUSPSMail_:        ['atHour(10)', 'everyDays(1)', 'inTimezone(America/New_York)'],
    scanHoaWebsite_:      ['everyWeeks(1)', 'onWeekDay(MONDAY)', 'atHour(9)',
                           'inTimezone(America/New_York)'],
  };

  const c = harness();
  vm.runInContext('setupTriggers()', c);
  const byHandler = {};
  c._created.forEach(r => { byHandler[r.handler] = r.chain; });

  check('exactly the eight known handlers are created, no more',
        Object.keys(byHandler).sort().join(',') === Object.keys(EXPECTED).sort().join(','),
        JSON.stringify(Object.keys(byHandler)) +
        ' — a new trigger belongs in this table too, deliberately');

  Object.keys(EXPECTED).forEach(h => {
    check('  ' + h + ' → ' + EXPECTED[h].join('.'),
          (byHandler[h] || []).join('.') === EXPECTED[h].join('.'),
          JSON.stringify(byHandler[h]));
  });

  check('every created trigger actually had .create() called',
        c._created.every(r => r.created === true),
        'a builder chain that is never created schedules nothing at all');

  // The two that must NOT be given a timezone: a minute interval has no local time of
  // day to be in, and Apps Script rejects the combination.
  check('the minute-interval pollers get no timezone',
        !byHandler.checkFlightStatuses_.some(s => /inTimezone/.test(s)) &&
        !byHandler.runEmailScan_.some(s => /inTimezone/.test(s)),
        JSON.stringify([byHandler.checkFlightStatuses_, byHandler.runEmailScan_]));

  // The tail is an hour after the head, derived rather than hardcoded, and wraps.
  const c23 = harness();
  c23.CONFIG.NIGHTLY_RUN_HOUR = 23;
  vm.runInContext('setupTriggers()', c23);
  const tail23 = c23._created.filter(r => r.handler === 'nightlyRunTail')[0];
  check('the tail wraps past midnight rather than scheduling hour 24',
        tail23.chain[0] === 'atHour(0)', JSON.stringify(tail23.chain) +
        ' — atHour(24) is not a valid hour');

  const c9 = harness();
  c9.CONFIG.NIGHTLY_RUN_HOUR = 9;
  vm.runInContext('setupTriggers()', c9);
  const head9 = c9._created.filter(r => r.handler === 'nightlyRun')[0];
  const tail9 = c9._created.filter(r => r.handler === 'nightlyRunTail')[0];
  check('both halves follow NIGHTLY_RUN_HOUR, an hour apart',
        head9.chain[0] === 'atHour(9)' && tail9.chain[0] === 'atHour(10)',
        JSON.stringify([head9.chain[0], tail9.chain[0]]) +
        ' — read at call time, so the two can never drift apart');

  // Read at CALL time, not load time: the root .js files share one global scope with
  // no guaranteed order, and a spec list built at load time would depend on CONFIG
  // happening to exist first.
  check('the specs are a function, not a top-level array',
        /function veraTriggerSpecs_\(/.test(SRC) &&
        !/^var VERA_TRIGGER(S|_SPECS)_\s*=/m.test(SRC),
        'a top-level var initialised from CONFIG is a cross-file load-order dependency');
}

// ============================================================================
console.log('\nThe log says what it actually did');
{
  const c = harness();
  vm.runInContext('setupTriggers()', c);
  const logged = c._log.filter(l => l.startsWith('log:') && /Triggers set/.test(l))[0] || '';

  check('it logs a summary', logged !== '', JSON.stringify(c._log.filter(l => l.startsWith('log:'))));
  check('…naming EVERY handler it created',
        c._created.every(r => logged.indexOf(r.handler) !== -1),
        JSON.stringify(c._created.map(r => r.handler).filter(h => logged.indexOf(h) === -1)) +
        ' — the old literal named seven of eight, and the one it omitted was the one ' +
        'that needed confirming');
  check('…and counting them',
        new RegExp('\\(' + c._created.length + '\\)').test(logged), JSON.stringify(logged));
  check('…and saying when each runs',
        /nightlyRunTail daily at 0:00/.test(logged) &&
        /checkFlightStatuses_ every 15 min/.test(logged),
        JSON.stringify(logged));

  // The real point: the summary is produced BY the action, so it cannot drift from it.
  const body = extractFn(SRC, 'setupTriggers');
  check('the summary is built from what was created, not typed out beside it',
        /created\.join\(/.test(body) && !/Triggers set: nightlyRun at 11pm/.test(SRC),
        'a hardcoded string is wrong the moment a trigger is added, and silently');
}

// ============================================================================
console.log('\nRegistration is recorded, and cannot break the install');
{
  const c = harness();
  vm.runInContext('setupTriggers()', c);
  const stored = JSON.parse(c._props.TRIGGER_REGISTRATIONS || '{}');

  check('every handler created is recorded as registered',
        c._created.every(r => stored[r.handler] > 0),
        JSON.stringify(stored) +
        ' — this is the evidence that lets the watchdog tell a job that has never run ' +
        'from a job that does not exist');
  check('…and nothing else is',
        Object.keys(stored).length === c._created.length, JSON.stringify(Object.keys(stored)));

  // Bookkeeping must never be able to stop a trigger being created — the same rule as
  // the nightly breadcrumb.
  const c2 = harness({ propsThrow: true });
  let threw = '';
  try { vm.runInContext('setupTriggers()', c2); } catch (e) { threw = e.message; }
  check('a failed registration write does not stop the triggers installing',
        threw === '' && c2._created.length >= 8,
        threw || JSON.stringify(c2._created.length));
  check('…and is logged rather than swallowed in silence',
        c2._log.some(l => /recordTriggerRegistrations_/.test(l)),
        JSON.stringify(c2._log.filter(l => l.startsWith('log:'))));

  const body = extractFn(SRC, 'setupTriggers');
  check('the recording happens after the triggers exist, not before',
        body.indexOf('recordTriggerRegistrations_') > body.indexOf('.create()'),
        'recording a registration that then failed to create is a false alibi');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
