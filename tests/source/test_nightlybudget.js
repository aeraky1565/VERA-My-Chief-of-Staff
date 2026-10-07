// The nightly run must either finish, or say where it stopped.
//
// This morning's email:
//
//   ⚠ SOME DATA IS NOT LIVE
//     • Nightly run started but did not finish; last completed run was 1d 7h
//
// which is the watchdog comparing LAST_NIGHTLY_START against the heartbeat and
// correctly reporting a death rather than a no-show. But it could say no more than
// that, because a run killed at Apps Script's six-minute ceiling is TERMINATED: it
// never reaches its own finally, where the heartbeat, LAST_NIGHTLY_RUN and
// flushSystemLog_ all live. The System Log buffer only autoflushes at 50 rows
// (SYSTEM_LOG_AUTOFLUSH_ROWS_, VERALog.js) and a nightly run never reaches that, so
// the entire run's log dies with it. Nothing, anywhere, could name the step.
//
// nightlyRun already had a budget — `var DEADLINE = runStart + 5.5 * 60 * 1000` —
// and exactly THREE of its ~40 steps consulted it. One slow step early on spent the
// whole thing and the three guarded steps at the end never got the chance to skip
// anything.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = {
  Code: fs.readFileSync(ROOT + '/Code.js', 'utf8'),
  Watch: fs.readFileSync(ROOT + '/Watchdog.js', 'utf8'),
};

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let paren = 0, afterParams = -1;
  for (let j = src.indexOf('(', start); j < src.length; j++) {
    if (src[j] === '(') paren++;
    else if (src[j] === ')') { paren--; if (paren === 0) { afterParams = j; break; } }
  }
  let depth = 0;
  for (let j = src.indexOf('{', afterParams); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

// A clock the test drives. The subject is behaviour at 5m30s, and a test that waits
// five and a half minutes to find out is a test nobody runs.
//
// A real wall-clock epoch rather than a small number, so that "four hours before the
// run" is still a valid date. With now = 1000000 it was four hours before 1970 and
// every age assertion would have been testing an Invalid Date instead.
const CLOCK0 = Date.parse('2026-10-06T00:00:00Z');

function runnerCtx() {
  let now = CLOCK0;
  const props = {};
  // Date.now() is driven by the test; `new Date(iso)` has to keep working, because
  // nightlyHeadCompletedTonight_ parses a stored timestamp with it. A constructor
  // function that RETURNS an object hands that object back from `new`, so one stub
  // serves both callers.
  const RealDate = Date;
  const FakeDate = function(v) {
    return arguments.length ? new RealDate(v) : new RealDate(now);
  };
  FakeDate.now = () => now;
  const ctx = {
    String, Number, Object, Array, Math, JSON, Error, console, isNaN,
    Logger: { log: () => {} },
    Date: FakeDate,
    _advance: ms => { now += ms; },
    _nowIs: () => now,
    _props: props,
    // "the head finished this long ago", as the property actually stores it.
    _isoAgo: ms => new RealDate(now - ms).toISOString(),
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; },
    }) },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(SRC.Code, 'nightlyStep_') + '\n' +
                  extractFn(SRC.Code, 'slowestNightlySteps_') + '\n' +
                  extractFn(SRC.Code, 'nightlyHeadCompletedTonight_') + '\n' +
                  /^var NIGHTLY_STEP_PROP_\s*=.*?;/m.exec(SRC.Code)[0] + '\n' +
                  /^var NIGHTLY_TAIL_STEP_PROP_\s*=.*?;/m.exec(SRC.Code)[0] + '\n' +
                  /^var NIGHTLY_STEP_RESERVE_MS_\s*=.*?;/m.exec(SRC.Code)[0] + '\n' +
                  /^var NIGHTLY_HEAD_MAX_AGE_MS_\s*=.*?;/m.exec(SRC.Code)[0], ctx);
  return ctx;
}

const START = CLOCK0;
const freshCtx = c => ({
  runStart: START, deadline: START + 330000,   // 5m30s, as the run uses
  failures: [], skipped: [], blocked: [], timings: [],
});

// ============================================================================
console.log('A step that runs');
{
  const c = runnerCtx();
  const ctx = freshCtx(c);
  let ran = 0;
  const ok = c.nightlyStep_(ctx, 'checkContracts_', () => { ran++; c._advance(1500); });

  check('it runs', ran === 1 && ok === true);
  check('…and is timed', ctx.timings.length === 1 && ctx.timings[0].ms === 1500,
        JSON.stringify(ctx.timings));
  check('…under its own name', ctx.timings[0].name === 'checkContracts_');
  check('nothing is recorded as failed', ctx.failures.length === 0);
  check('…nor as skipped', ctx.skipped.length === 0);
}

console.log('\nA step that throws');
{
  const c = runnerCtx();
  const ctx = freshCtx(c);
  let after = 0;
  // Guarded HERE because the whole point is that the runner should have caught it.
  // A control that removes the catch must report a clean failure, not crash the file.
  let escaped = null;
  try {
    c.nightlyStep_(ctx, 'checkContracts_', () => { c._advance(10); throw new Error('Contracts tab not found'); });
  } catch (e) { escaped = e.message; }
  try {
    c.nightlyStep_(ctx, 'checkWarrantiesExpiring_', () => { after++; });
  } catch (e) {}

  check('the throw does not escape the runner', escaped === null, String(escaped));
  check('the failure is recorded against the step', ctx.failures.length === 1 &&
        /^checkContracts_: /.test(ctx.failures[0]), JSON.stringify(ctx.failures));
  check('…carrying the message', /Contracts tab not found/.test(ctx.failures[0]));
  check('the NEXT step still runs', after === 1,
        'one broken step must never take the nightly run down');
  check('a thrown step is still timed', ctx.timings.length === 2,
        'the step that failed is exactly the one whose cost you want to see');
  check('…and is not counted as skipped', ctx.skipped.length === 0,
        'skipped and failed are different facts and must not be conflated');
}

// ============================================================================
console.log('\nThe budget: past the deadline, steps SKIP rather than run');
{
  const c = runnerCtx();
  const ctx = freshCtx(c);
  const ran = [];

  // One pathological step eats the whole budget, the way a slow Claude or
  // web-search step would.
  c.nightlyStep_(ctx, 'checkCardPerksActive_', () => { ran.push('perks'); c._advance(400000); });
  c.nightlyStep_(ctx, 'checkContracts_',  () => ran.push('contracts'));
  c.nightlyStep_(ctx, 'runExplorer_',     () => ran.push('explorer'));

  check('the slow step itself completed', ran.indexOf('perks') !== -1);
  check('everything after it is skipped, not run', ran.length === 1, JSON.stringify(ran));
  check('…and recorded as skipped', ctx.skipped.join() === 'checkContracts_,runExplorer_',
        JSON.stringify(ctx.skipped));
  check('…counted separately from failures', ctx.failures.length === 0,
        '"I ran out of time" is not a step warning, it is the budget working');
  check('a skipped step costs nothing', ctx.timings.length === 1,
        'a skipped step was never started, so it has no duration to report');
  check('the slow step is nameable from the timings',
        ctx.timings[0].name === 'checkCardPerksActive_' && ctx.timings[0].ms === 400000,
        'this is what the kill could never tell us');

  // THE regression this exists to prevent: the run reaching its own end.
  check('the run can still reach its finally', true,
        'skipping is cheap; being killed is what skipped the heartbeat');
}

console.log('\nThe boundary');
{
  const c = runnerCtx();
  const ctx = freshCtx(c);
  c._advance(330000);                       // exactly on the deadline
  let ran = 0;
  c.nightlyStep_(ctx, 'checkContracts_', () => ran++);
  check('a step landing exactly on the deadline does not start', ran === 0,
        'there is no time left to finish it in, and a half-run step is what kills the response');

  // DELIBERATELY CHANGED. This used to assert that a step one millisecond short of
  // the deadline still starts — which is exactly the bug: it then had one
  // millisecond to finish in before Apps Script killed the execution outright. The
  // boundary is now the deadline MINUS the reserve.
  const c2 = runnerCtx();
  const ctx2 = freshCtx(c2);
  c2._advance(329999);                      // one millisecond short of the deadline
  let ran2 = 0;
  c2.nightlyStep_(ctx2, 'checkContracts_', () => ran2++);
  check('…and one millisecond short does NOT either', ran2 === 0,
        'a step with a millisecond of budget is a step that overruns the ceiling');

  const c3 = runnerCtx();
  const ctx3 = freshCtx(c3);
  c3._advance(330000 - c3.NIGHTLY_STEP_RESERVE_MS_ - 1);   // just inside the reserve
  let ran3 = 0;
  c3.nightlyStep_(ctx3, 'checkContracts_', () => ran3++);
  check('…and one millisecond inside the RESERVE does', ran3 === 1,
        'the boundary moved by exactly the reserve, and no further');

  // Exactly on the new boundary: the reserve is what is left, to the millisecond.
  // The old "lands exactly on the deadline" case can no longer tell >= from >,
  // because by then the reserve has long since dominated the comparison.
  const c4 = runnerCtx();
  const ctx4 = freshCtx(c4);
  c4._advance(330000 - c4.NIGHTLY_STEP_RESERVE_MS_);
  let ran4 = 0;
  c4.nightlyStep_(ctx4, 'checkContracts_', () => ran4++);
  check('a step landing exactly ON the reserve boundary does not start', ran4 === 0,
        'exactly enough is not enough: the reserve is the minimum, not the target');
}

// ============================================================================
console.log('\nThe breadcrumb — the only thing that survives a kill');
{
  const c = runnerCtx();
  const ctx = freshCtx(c);

  // Written BEFORE the work. This is the whole point: a marker written afterwards
  // never survives the kill it exists to explain.
  let seenDuringStep = null;
  c._advance(62000);
  c.nightlyStep_(ctx, 'checkCardPerksActive_', () => {
    seenDuringStep = c._props[c.NIGHTLY_STEP_PROP_];
  });

  check('the step name is already set while the step runs', seenDuringStep !== null &&
        seenDuringStep !== undefined, String(seenDuringStep));
  check('…naming the step', /^checkCardPerksActive_\|/.test(seenDuringStep), seenDuringStep);
  check('…and how far into the run it got', seenDuringStep.split('|')[1] === '62',
        seenDuringStep);

  const c2 = runnerCtx();
  const ctx2 = freshCtx(c2);
  c2.nightlyStep_(ctx2, 'first_',  () => {});
  c2.nightlyStep_(ctx2, 'second_', () => {});
  check('each step overwrites it, so it names the LAST one reached',
        /^second_\|/.test(c2._props[c2.NIGHTLY_STEP_PROP_]),
        c2._props[c2.NIGHTLY_STEP_PROP_]);

  const c3 = runnerCtx();
  const ctx3 = freshCtx(c3);
  c3._advance(400000);
  c3.nightlyStep_(ctx3, 'skipped_', () => {});
  check('a SKIPPED step leaves no breadcrumb',
        c3._props[c3.NIGHTLY_STEP_PROP_] === undefined,
        'it never ran, so naming it as the place the run died would be a lie');
}

console.log('\nThe breadcrumb never breaks the run');
{
  const c = runnerCtx();
  const ctx = freshCtx(c);
  c.PropertiesService = { getScriptProperties: () => ({
    setProperty: () => { throw new Error('Properties service unavailable'); },
  }) };
  let ran = 0;
  let threw = null;
  try { c.nightlyStep_(ctx, 'checkContracts_', () => ran++); } catch (e) { threw = e.message; }
  check('a failing property write does not stop the step', ran === 1 && threw === null,
        String(threw));
  check('…and is not recorded as the step failing', ctx.failures.length === 0,
        'a diagnostic that breaks its subject is worse than no diagnostic');
}

// ============================================================================
console.log('\nThe slowest-step report');
{
  const c = runnerCtx();
  const t = [
    { name: 'a_', ms: 100 }, { name: 'b_', ms: 9000 }, { name: 'c_', ms: 50 },
    { name: 'd_', ms: 4000 }, { name: 'e_', ms: 1 }, { name: 'f_', ms: 70000 },
  ];
  const top = c.slowestNightlySteps_(t, 3);
  check('it is sorted slowest first', /^f_ /.test(top[0]) && /^b_ /.test(top[1]), JSON.stringify(top));
  check('…capped at the requested count', top.length === 3);
  check('…in seconds, readably', top[0] === 'f_ 70.0s', top[0]);
  check('an empty run reports nothing', c.slowestNightlySteps_([], 5).length === 0);
  check('…and so does a missing list', c.slowestNightlySteps_(undefined, 5).length === 0);
  check('it does not mutate the caller\'s array', t[0].name === 'a_',
        'sorting in place would reorder the timings everything else reads');
}

// ============================================================================
console.log('\nnightlyRun wires it up');
{
  const nightly = SRC.Code.slice(SRC.Code.indexOf('function nightlyRun()'),
                                 SRC.Code.indexOf('function nightlyRun()') + 40000);
  const steps = (nightly.match(/nightlyStep_\(ctx, '/g) || []).length;

  check('every step goes through the runner', steps >= 35, String(steps));
  check('NO step hand-rolls a budget check any more',
        !/if \(Date\.now\(\) < DEADLINE\)/.test(nightly),
        'three of forty checking the deadline is how one slow step killed the run');
  check('the old per-step try/catch boilerplate is gone',
        !/stepFailures\.push\('check[A-Za-z]*_: ' \+ \w+Err\.message\)/.test(nightly),
        'forty copies of the same seven lines is forty chances to get one wrong');

  check('the context carries the deadline', /deadline: DEADLINE/.test(nightly));
  check('…the failures', /failures: stepFailures/.test(nightly));
  check('…the skips', /skipped:  stepSkipped/.test(nightly));
  check('…and the timings', /timings:  stepTimings/.test(nightly));

  check('skips are reported in the Slack summary line',
        /summary \+= ' \\u00b7 ' \+ stepSkipped\.length \+ ' skipped \(time budget\)'/.test(nightly),
        'the veraLog_ row also mentions skips, so match the summary line itself');
  check('…and in the System Log row', /stepSkipped\.length \+ ' skipped \(time budget\)'/.test(nightly));
  check('…and they are listed, not just counted', /Skipped for time/.test(nightly));
  check('a skip is NEVER pushed onto stepFailures',
        !/stepFailures\.push\('skipped/.test(nightly),
        'the budget working as designed is not a step warning, and conflating them '
        + 'turns a healthy partial run into a run that looks broken');
  check('the slowest steps are reported on EVERY run',
        /slowestNightlySteps_\(stepTimings/.test(nightly),
        'creep is worth seeing while it is still creep');

  // Two steps previously had no guard at all, so a throw in either took the run down.
  check('writeSummarySnapshot is guarded now',
        /nightlyStep_\(ctx, 'writeSummarySnapshot'/.test(nightly));
  check('…and checkTaxDocuments_ too',
        /nightlyStep_\(ctx, 'checkTaxDocuments_'/.test(nightly));

  // The breadcrumb's PRESENCE is the signal, so a finished run must clear it.
  check('a completed run clears the breadcrumb',
        /deleteProperty\(NIGHTLY_STEP_PROP_\)/.test(nightly));
  check('…including the empty-run early return',
        (nightly.match(/deleteProperty\(NIGHTLY_STEP_PROP_\)/g) || []).length >= 2,
        'returning early with the marker set reports a death that never happened');

  check('the API health prune runs nightly',
        /nightlyStep_\(ctx, 'pruneApiHealthState_'/.test(nightly));
}

// ============================================================================
console.log('\nThe watchdog says WHERE it died');
{
  const fn = extractFn(SRC.Watch, 'getOverdueJobs_');
  // The start-marker reasoning now lives in one helper, shared by the stale branch and
  // the never-ran one. These two assertions used to read getOverdueJobs_'s inline copy
  // and went stale with it — re-aimed rather than relaxed.
  const died_ = extractFn(SRC.Watch, 'jobStartedAndDied_');
  check('the nightly job registers the breadcrumb property',
        /stepProp: 'NIGHTLY_STEP'/.test(SRC.Watch));
  check('the step is only read once the start marker has beaten the heartbeat',
        died_.indexOf('startedAt <= lastRunMs') < died_.indexOf('r.stepProp') &&
        died_.indexOf('r.stepProp') !== -1,
        'a breadcrumb means nothing unless the start marker beat the heartbeat');
  check('the marker is split on the pipe nightlyStep_ writes',
        /split\('\|'\)/.test(died_), 'the two must agree on the format');
  check('…and there is only ONE copy of that reasoning',
        !/started but did not finish/.test(died_) &&
        (SRC.Watch.match(/split\('\|'\)/g) || []).length === 1,
        'two copies and the never-ran branch drifts from the stale one');
  // Counts the RENDERING EXPRESSION, not the words. Matching /died during/ over the
  // file also matched a comment quoting the phrase, which pushed the count to 3 — so
  // deleting one of the two renderers still left 2 and the assertion passed. Its own
  // controls caught that; the seventh time in this codebase a check has matched prose
  // about the thing instead of the thing.
  check('both renderers name it',
        (SRC.Watch.match(/died during ' \+ j\.diedAt/g) || []).length === 2,
        'the email lines and the flag are two surfaces and both were guessing');

  // Behavioural: drive the real function.
  function overdue(props, heartbeatAgeH) {
    const now = Date.UTC(2026, 9, 3, 6, 0, 0);
    const ctx = {
      String, Number, Object, Array, Math, JSON, Date, parseInt, isFinite, console,
      Logger: { log: () => {} },
      PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
      formatAge_: ms => Math.round(ms / 3600000) + 'h',
      getHeartbeatState_: () => ({ nightlyRun: { lastRun: now - heartbeatAgeH * 3600000 } }),
      HEARTBEAT_REGISTRY: [{ job: 'nightlyRun', label: 'Nightly run', maxAgeHours: 26,
                             startProp: 'LAST_NIGHTLY_START', stepProp: 'NIGHTLY_STEP' }],
      _now: now,
    };
    vm.createContext(ctx);
    // The real helper and the real registration read, not stubs: jobStartedAndDied_ IS
    // the subject here, and getTriggerRegistrations_ reading no property returns {},
    // which is the "nothing registered" state these cases all assume.
    vm.runInContext('Date.now = function() { return ' + now + '; };\n' +
                    /^var TRIGGER_REGISTRY_KEY_\s*=.*?;/m.exec(SRC.Watch)[0] + '\n' +
                    extractFn(SRC.Watch, 'getTriggerRegistrations_') + '\n' +
                    extractFn(SRC.Watch, 'jobStartedAndDied_') + '\n' + fn, ctx);
    return ctx.getOverdueJobs_();
  }

  const started = new Date(Date.UTC(2026, 9, 3, 2, 0, 0)).toISOString();
  const died = overdue({ LAST_NIGHTLY_START: started, NIGHTLY_STEP: 'checkCardPerksActive_|252' }, 31);
  check('a killed run is reported as killed', died.length === 1 &&
        /did not finish/.test(died[0].verb), JSON.stringify(died.map(d => d.verb)));
  check('…naming the step', /^checkCardPerksActive_/.test(died[0].diedAt), died[0].diedAt);
  check('…and how far in it got', /252|4h|0h/.test(died[0].diedAt), died[0].diedAt);

  const noCrumb = overdue({ LAST_NIGHTLY_START: started }, 31);
  check('without a breadcrumb it reads exactly as before', noCrumb[0].diedAt === '',
        'the old wording must survive, for every job that has no breadcrumb');
  check('…still reporting the death itself', /did not finish/.test(noCrumb[0].verb));

  // THE case the ordering guard exists for: a breadcrumb left by an earlier death,
  // still sitting in the property, while THIS failure is a trigger that never fired.
  const staleCrumb = overdue({ NIGHTLY_STEP: 'checkCardPerksActive_|252' }, 31);
  check('a stale breadcrumb is ignored when the run never started',
        staleCrumb[0].diedAt === '',
        'the marker only means anything if the start marker beat the heartbeat');
  check('…and the wording stays "has not run"', !/did not finish/.test(staleCrumb[0].verb));

  // Started, finished, and merely overdue since — the breadcrumb is not this run's.
  const finishedThenStale = overdue({
    LAST_NIGHTLY_START: new Date(Date.UTC(2026, 9, 1, 2, 0, 0)).toISOString(),
    NIGHTLY_STEP: 'checkContracts_|99',
  }, 31);
  check('…nor when the last start PRECEDES the heartbeat',
        finishedThenStale[0].diedAt === '' && !/did not finish/.test(finishedThenStale[0].verb),
        'that run completed; something else is making it overdue');

  const neverRan = overdue({}, 31);
  check('a run that never STARTED is still worded differently',
        !/did not finish/.test(neverRan[0].verb) && neverRan[0].diedAt === '',
        'a trigger problem and a code problem need different answers from you');
}

// ============================================================================
// THE NIGHT IS IN TWO HALVES
//
// The run outgrew Apps Script's six-minute ceiling. The morning banner read
// "died during checkHealthAppointments_ (5m in)" — and because the budget only
// asked whether the deadline had PASSED, a step starting at 5m00s still had sixty
// seconds before the kill, which it then overran. Everything from that step
// onwards never ran at all: not occasionally, every night.
console.log('\nThe reserve');
{
  const c = runnerCtx();
  const ctx = freshCtx(c);

  // 30 seconds left: under the deadline, but less than a step is assumed to need.
  c._advance(330000 - 30000);
  const started = c.nightlyStep_(ctx, 'checkHealthAppointments_', () => {});
  check('a step is not started when the remaining budget might not cover it',
        started === false && ctx.skipped.indexOf('checkHealthAppointments_') !== -1,
        JSON.stringify({ started, skipped: ctx.skipped }) +
        ' — starting it is what got the execution killed mid-step');
  check('…and the kill it avoids is what takes the finally with it',
        ctx.timings.length === 0,
        'no heartbeat, no error email, no flushed log, and no slowest-steps report');

  // Comfortably inside: still runs.
  const c2 = runnerCtx(), ctx2 = freshCtx(c2);
  c2._advance(60000);
  check('a step with room to spare still runs',
        c2.nightlyStep_(ctx2, 'checkContracts_', () => {}) === true &&
        ctx2.skipped.length === 0);

  check('the reserve is a real duration, not zero',
        c.NIGHTLY_STEP_RESERVE_MS_ >= 30000,
        'anything less and the slowest step still overruns the ceiling');
}

console.log('\nEach half keeps its own breadcrumb');
{
  const c = runnerCtx();
  const head = freshCtx(c);
  const tail = freshCtx(c);
  tail.stepProp = c.NIGHTLY_TAIL_STEP_PROP_;

  c.nightlyStep_(head, 'checkContracts_', () => {});
  c.nightlyStep_(tail, 'runExplorer_', () => {});

  check('the head writes NIGHTLY_STEP',
        /^checkContracts_\|/.test(c._props[c.NIGHTLY_STEP_PROP_] || ''),
        JSON.stringify(c._props));
  check('…and the tail writes its OWN property',
        /^runExplorer_\|/.test(c._props[c.NIGHTLY_TAIL_STEP_PROP_] || ''),
        JSON.stringify(c._props));
  check('…so neither can overwrite the other\'s death',
        c.NIGHTLY_STEP_PROP_ !== c.NIGHTLY_TAIL_STEP_PROP_ &&
        c._props[c.NIGHTLY_STEP_PROP_] !== c._props[c.NIGHTLY_TAIL_STEP_PROP_],
        'one shared breadcrumb and the watchdog cannot say which half died');
}

console.log('\nEvery step belongs to exactly one half');
{
  // Read out of the real source, not a hand-copied list: the failure mode here is a
  // step quietly belonging to NEITHER half, and a list typed by hand would be
  // reproducing the same mistake it is meant to catch.
  const bodyOf = name => extractFn(SRC.Code, name);
  const stepsIn = body =>
    (body.match(/nightlyStep_\(ctx,\s*'([^']+)'/g) || [])
      .map(m => /'([^']+)'/.exec(m)[1]);

  const head = stepsIn(bodyOf('nightlyRun'));
  const tail = stepsIn(bodyOf('nightlyRunTail'));

  check('both halves run steps', head.length > 20 && tail.length > 0,
        JSON.stringify({ head: head.length, tail: tail.length }));
  const overlap = head.filter(s => tail.indexOf(s) !== -1);
  check('no step is in BOTH halves', overlap.length === 0, JSON.stringify(overlap));

  // The seven the banner said were being starved. Still the point of the split, so
  // they are asserted as a set AND in their original relative order — a re-split that
  // reordered them would break the dependency work pinned further down this file.
  const STARVED = ['checkHealthAppointments_', 'checkMonthlyReview_',
    'sendHealthPerformanceInsightMonthly_', 'resetWeekMealPlan_',
    'checkCrossPatternFlags_', 'suggestDueDates', 'runExplorer_'];
  check('every starved step is in the tail',
        STARVED.every(s => tail.indexOf(s) !== -1),
        JSON.stringify(STARVED.filter(s => tail.indexOf(s) === -1)));
  check('…in the order they always ran in',
        tail.filter(s => STARVED.indexOf(s) !== -1).join(',') === STARVED.join(','),
        JSON.stringify(tail));
  check('…and none of them is still in the first half',
        STARVED.every(s => head.indexOf(s) === -1),
        JSON.stringify(STARVED.filter(s => head.indexOf(s) !== -1)));

  // The tail's FULL contents, named. It was once exactly the starved seven; the
  // perk-event sweep was added deliberately because the head's three perk steps are
  // already #32-34 of 37 and so among the first the budget drops. Listing the whole
  // thing keeps that an explicit decision — a step cannot drift into the tail, or out
  // of it, without this line changing.
  const EXPECTED_TAIL = ['checkHealthAppointments_', 'checkMonthlyReview_',
    'sendHealthPerformanceInsightMonthly_', 'resetWeekMealPlan_',
    'checkCrossPatternFlags_', 'purgePastPerkReminderEvents_',
    'suggestDueDates', 'runExplorer_'];
  check('the tail is exactly its named steps, no more and no fewer',
        tail.join(',') === EXPECTED_TAIL.join(','), JSON.stringify(tail));

  // Nothing fell down the gap between the two. Comparing against git HEAD was the
  // obvious way and is worthless: the moment the split is committed, HEAD becomes
  // the split version and the check passes trivially forever. This holds for good —
  // every nightlyStep_ call in the file has to live in one of the two halves, so a
  // step belonging to neither is impossible rather than merely unlikely.
  // The quote is load-bearing: without it this also matches the declaration,
  //   function nightlyStep_(ctx, name, fn)
  // and the count is one too many for a reason that has nothing to do with the split.
  const allCalls = (SRC.Code.match(/nightlyStep_\(ctx,\s*'/g) || []).length;

  // nightlyStep_ is no longer only the night's. morningNudge routes its ~15 phases
  // through it too, after the morning email was killed at the same six-minute ceiling
  // — the budget, the breadcrumb and the timings are the same three things, so
  // reimplementing them would have been two copies to keep in step.
  //
  // So the accounting is over the THREE functions that use it, not two. This stays the
  // same guarantee it was: a call in a fourth, unaccounted function still fails, and a
  // step belonging to nothing is still impossible rather than merely unlikely. (This
  // assertion caught exactly that when the morning phases were added — it reported 54
  // calls against 44 accounted for, which is the whole reason it exists.)
  const morning = stepsIn(bodyOf('morningNudge'));
  check('morningNudge shares the same budgeted step runner',
        morning.length >= 8, JSON.stringify(morning));
  check('…and its phases are nothing to do with the night',
        morning.every(s => head.indexOf(s) === -1 && tail.indexOf(s) === -1),
        JSON.stringify(morning.filter(s => head.indexOf(s) !== -1 || tail.indexOf(s) !== -1)));
  check('every nightlyStep_ call in Code.js belongs to one of the three',
        allCalls === head.length + tail.length + morning.length,
        JSON.stringify({ inFile: allCalls, head: head.length, tail: tail.length,
                         morning: morning.length }) +
        ' — a step in none of them runs on no night and no morning at all');
}

console.log('\nThe tail reports its own death');
{
  const body = extractFn(SRC.Code, 'nightlyRunTail');
  check('it writes its own start marker',
        /setProperty\('LAST_NIGHTLY_TAIL_START'/.test(body),
        'without it the watchdog cannot tell "died" from "never fired". Matching the ' +
        'bare name also matched the Logger.log beside it, and passed with the write gone');
  check('it records its own heartbeat, in a finally',
        /finally\s*\{[\s\S]*recordHeartbeat_\('nightlyRunTail'\)/.test(body));
  check('…and the head does NOT record it',
        !/recordHeartbeat_\('nightlyRunTail'\)/.test(extractFn(SRC.Code, 'nightlyRun')),
        'one shared heartbeat would let the head report the whole night healthy');
  check('it clears its breadcrumb only on success',
        /deleteProperty\(NIGHTLY_TAIL_STEP_PROP_\)/.test(body) &&
        body.indexOf('deleteProperty(NIGHTLY_TAIL_STEP_PROP_)') < body.indexOf('} catch (e) {'),
        'cleared in the finally and its presence would stop meaning "died here"');
  check('it reports its slowest steps like the head does',
        /slowestNightlySteps_/.test(body) && /Slowest tail steps/.test(body),
        'the report that has never once been produced is the whole diagnosis');
  check('…and tells nightlyStep_ to use the tail breadcrumb',
        /stepProp:\s*NIGHTLY_TAIL_STEP_PROP_/.test(body),
        'the ctx is where that is decided; without it the tail overwrites the head');

  check('the watchdog knows about it',
        /job: 'nightlyRunTail'[\s\S]*?startProp: 'LAST_NIGHTLY_TAIL_START'[\s\S]*?stepProp: 'NIGHTLY_TAIL_STEP'/
          .test(SRC.Watch),
        'a half nothing watches is a half that can die every night unseen');
  // setupTriggers no longer names handlers at the newTrigger call — they come from
  // veraTriggerSpecs_, so that one list drives the creates, the delete guard and the
  // log. test_triggers.js pins the full chain; this just says the tail is in the list.
  check('…and a trigger fires it',
        /handler: 'nightlyRunTail'/.test(SRC.Code) &&
        /ScriptApp\.newTrigger\(s\.handler\)/.test(SRC.Code));
  check('…an hour after the first half, not alongside it',
        /atHour\(\(CONFIG\.NIGHTLY_RUN_HOUR \+ 1\) % 24\)/.test(SRC.Code),
        'back to back and the second starts underneath an overrunning first');

  // The expensive thing the tail must not do twice.
  check('the PTO snapshot is only recomputed on the day it is read',
        /today\.getDate\(\) === 1 \? writePTOSnapshot_\(\) : null/.test(body),
        'checkMonthlyReview_ returns immediately on the other 30 days, and the ' +
        'snapshot is one of the heaviest steps in the night');
}

// ============================================================================
// FLAGS ARE READ AFTER THEY ARE WRITTEN
//
// The question the split raised: are the dependencies across the two triggers in the
// right order — should flag-setting come last so nothing slips under the radar?
//
// There is no deferred flag write to get wrong. ~15 modules call writeFlags as each
// step determines something, so a flag exists the moment it is found. What matters is
// which step READS them, and there is exactly one that reads TONIGHT'S:
// checkCrossPatternFlags_, whose buildCrossDomainSnapshot_ counts unresolved High
// flags into the intensity signal. It is last in the night, which is why the order
// holds — and that is worth asserting rather than describing, because the next person
// to re-split or reorder has no way to know it.
//
// The age-based readers (escalateAgedFlags_ at >=7 days, recordExpiredFlags_,
// closeExpiredPerkFlags_) are order-insensitive by construction: tonight's flags are
// zero days old, so running them first is correct.
//
// This asserts only on WRITES. Classifying READS the same way produced a false
// positive — writeWeeklySnapshot_ looked like a flag reader and has zero flag
// references — whereas a write is a literal writeFlags( call and reliable to find.
console.log('\nFlags are read after they are written');
{
  const ALL = fs.readdirSync(ROOT)
    .filter(f => f.endsWith('.js') && f !== 'playwright.config.js')
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');

  const stepsIn = body =>
    (body.match(/nightlyStep_\(ctx,\s*'([^']+)'/g) || [])
      .map(m => /'([^']+)'/.exec(m)[1]);
  const order = stepsIn(extractFn(SRC.Code, 'nightlyRun'))
          .concat(stepsIn(extractFn(SRC.Code, 'nightlyRunTail')));

  // A step is either a named function or an inline closure at the call site. BOTH are
  // read: classifying only named functions would quietly treat every closure as a
  // non-writer, which is the way this test would go blind without failing.
  const closureAt = name => {
    const re = new RegExp("nightlyStep_\\(ctx,\\s*'" + name + "',\\s*function\\s*\\(");
    const m = re.exec(SRC.Code);
    if (!m) return null;
    let depth = 0;
    for (let j = SRC.Code.indexOf('{', m.index); j < SRC.Code.length; j++) {
      if (SRC.Code[j] === '{') depth++;
      else if (SRC.Code[j] === '}') { depth--; if (depth === 0) return SRC.Code.slice(m.index, j + 1); }
    }
    return null;
  };
  const named = name => { try { return extractFn(ALL, name); } catch (e) { return null; } };
  const bodiesFor = name => [named(name), closureAt(name)].filter(Boolean);

  // One level deep, which is how a step that writes through a module helper is caught:
  // writePTOSnapshot_ writes via checkAccrualCapRisk_ and adoptLegacyTripKeys_ via
  // resolveTripId_, and neither names writeFlags itself.
  const writesFlags = name => {
    const bodies = bodiesFor(name);
    if (bodies.some(b => /\bwriteFlags\(/.test(b))) return true;
    const callees = new Set();
    bodies.forEach(b => (b.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g) || [])
      .forEach(c => callees.add(c.replace(/\s*\($/, ''))));
    callees.delete(name);
    for (const c of callees) {
      const cb = named(c);
      if (cb && /\bwriteFlags\(/.test(cb)) return true;
    }
    return false;
  };

  const unresolved = order.filter(s => bodiesFor(s).length === 0);
  check('every nightly step resolves to a body the classifier can read',
        unresolved.length === 0, JSON.stringify(unresolved) +
        ' — a step with no body reads as "writes no flags", which is how this test ' +
        'would stop testing anything without ever failing');

  const writers = order.filter(writesFlags);
  check('the night writes flags from many steps, not one',
        writers.length >= 10, JSON.stringify(writers) +
        ' — if this collapses the classifier has broken, not the code');

  const CROSS = 'checkCrossPatternFlags_';
  const crossAt = order.indexOf(CROSS);
  check('the one step that reads tonight\'s flags is in the run at all',
        crossAt !== -1, JSON.stringify(order.slice(-5)));

  const after = writers.filter(w => order.indexOf(w) > crossAt);
  check('checkCrossPatternFlags_ runs after EVERY step that writes flags',
        after.length === 0, JSON.stringify(after) +
        ' — a writer after it is a flag the intensity signal cannot see, on the night ' +
        'it was raised');
  check('…and it is itself the last flag-touching step in the night',
        writers[writers.length - 1] === CROSS, JSON.stringify(writers.slice(-3)));

  // The Claude batch — the biggest single write of the night — is a bare call in the
  // head rather than a nightlyStep_, so the step list above does not contain it.
  check('the Claude batch write is in the FIRST half',
        /writtenCount = writeFlags\(flags\);/.test(extractFn(SRC.Code, 'nightlyRun')) &&
        !/writeFlags\(/.test(extractFn(SRC.Code, 'nightlyRunTail')),
        'it is not a nightlyStep_, so only its half can be asserted — and the half it ' +
        'is in is the one that has to come first');

  // "escalateAgedFlags_ first" is only correct BECAUSE of the age cutoff, so assert
  // the cutoff and not merely the position.
  check('escalateAgedFlags_ is first', order[0] === 'escalateAgedFlags_', order[0]);
  const esc = named('escalateAgedFlags_');
  // A cutoff of at least a day, not merely the presence of the words: `ageDays >= 0`
  // would read every flag written tonight, which is precisely what running first
  // makes unsafe.
  check('…and only touches flags at least a day old, which is why first is safe',
        esc !== null && /ageDays\s*>=\s*[1-9]/.test(esc) && !/ageDays\s*>=\s*0\b/.test(esc),
        'without a real cutoff it would read tonight\'s flags before most of them exist');
}

// ============================================================================
// A HALF-RUN NIGHT IS NOT PATTERN-MATCHED
//
// What the split changed: a head that dies no longer stops the tail. The pattern
// engine would then count unresolved High flags on a night where most writers never
// ran, read a loaded week as a quiet one, and say so with no sign anything was
// missing. Skipped and said so beats confidently wrong.
console.log('\nThe tail asks whether the first half finished');
{
  const c = runnerCtx();

  check('no recorded finish at all — not ok',
        c.nightlyHeadCompletedTonight_().ok === false,
        'a project that has never run a head is not a project with a complete one');

  // Finished twenty minutes ago, nothing left behind: the normal night.
  c._props['LAST_NIGHTLY_RUN'] = c._isoAgo(20 * 60 * 1000);
  const good = c.nightlyHeadCompletedTonight_();
  check('recent finish, no breadcrumb — ok', good.ok === true && good.reason === '',
        JSON.stringify(good));

  // A head that THREW reaches its finally and writes LAST_NIGHTLY_RUN anyway. The
  // breadcrumb is the only thing that separates it from a clean finish.
  c._props[c.NIGHTLY_STEP_PROP_] = 'checkContracts_|210';
  const died = c.nightlyHeadCompletedTonight_();
  check('a breadcrumb left behind — not ok, even with a fresh timestamp',
        died.ok === false, JSON.stringify(died) +
        ' — the timestamp is written in the finally, which a thrown run still reaches');
  check('…and the reason names the step it stopped at',
        /checkContracts_/.test(died.reason) && !/\|/.test(died.reason),
        JSON.stringify(died.reason) + ' — the elapsed suffix is for the watchdog, not this');
  delete c._props[c.NIGHTLY_STEP_PROP_];

  // A hard kill at six minutes never reaches the finally, so the timestamp is
  // yesterday's and the tail must not read it as tonight's.
  c._props['LAST_NIGHTLY_RUN'] = c._isoAgo(25 * 60 * 60 * 1000);
  const stale = c.nightlyHeadCompletedTonight_();
  check('yesterday\'s finish — not ok', stale.ok === false, JSON.stringify(stale));
  check('…and the reason says how old it is',
        /not tonight/.test(stale.reason) && /\d/.test(stale.reason),
        JSON.stringify(stale.reason));

  // The real gap between the two triggers: .atHour() places each anywhere in its
  // hour, so head-at-23:00 and tail-at-00:59 is nearly two hours apart and legitimate.
  c._props['LAST_NIGHTLY_RUN'] = c._isoAgo(115 * 60 * 1000);
  check('the widest legitimate gap between the two triggers still counts as tonight',
        c.nightlyHeadCompletedTonight_().ok === true,
        'atHour() is a window, not a time — a two-hour gap is a normal night, and ' +
        'refusing it would withhold the step on nights nothing was wrong with');
  check('…but the window is nowhere near a full day',
        c.NIGHTLY_HEAD_MAX_AGE_MS_ < 12 * 3600 * 1000 &&
        c.NIGHTLY_HEAD_MAX_AGE_MS_ > 2 * 3600 * 1000,
        String(c.NIGHTLY_HEAD_MAX_AGE_MS_) + ' — too wide and yesterday reads as tonight');

  c._props['LAST_NIGHTLY_RUN'] = 'not a date';
  check('an unreadable timestamp is not treated as a good night',
        c.nightlyHeadCompletedTonight_().ok === false,
        'NaN compares false against every threshold, so a bare age check would have ' +
        'passed this');
}

console.log('\nA withheld step is not a slow step');
{
  const c = runnerCtx();
  const ctx = freshCtx(c);
  let ran = 0;

  const out = c.nightlyStep_(ctx, 'checkCrossPatternFlags_', () => { ran++; },
                             { ok: false, reason: 'the first half stopped during checkContracts_' });
  check('a step whose precondition failed does not run', ran === 0 && out === false);
  check('…and is recorded as blocked, not as skipped for time',
        ctx.blocked.length === 1 && ctx.skipped.length === 0,
        JSON.stringify({ blocked: ctx.blocked, skipped: ctx.skipped }) +
        ' — one bucket and a data-dependency failure gets read as a slow night');
  check('…carrying the reason, not just the name',
        /checkCrossPatternFlags_/.test(ctx.blocked[0]) &&
        /checkContracts_/.test(ctx.blocked[0]),
        JSON.stringify(ctx.blocked) + ' — "skipped" with no reason is a shrug');
  check('…and is not counted as a failure either',
        ctx.failures.length === 0, JSON.stringify(ctx.failures));
  check('…and gets no timing, because nothing was timed',
        ctx.timings.length === 0, JSON.stringify(ctx.timings));

  // Plenty of budget left: proof the gate, not the clock, is what stopped it.
  check('the clock was not the reason',
        c._nowIs() + c.NIGHTLY_STEP_RESERVE_MS_ < ctx.deadline);

  const ok = c.nightlyStep_(ctx, 'checkCrossPatternFlags_', () => { ran++; }, { ok: true, reason: '' });
  check('a satisfied precondition lets the step run',
        ok === true && ran === 1 && ctx.blocked.length === 1);

  const ungated = c.nightlyStep_(ctx, 'runExplorer_', () => { ran++; });
  check('a step with no gate at all is unaffected',
        ungated === true && ran === 2 && ctx.blocked.length === 1,
        'all ~44 steps but one pass no gate, and must behave exactly as before');

  // The head's ctx has no `blocked` array. A gate there must not throw.
  const headCtx = { runStart: START, deadline: START + 330000,
                    failures: [], skipped: [], timings: [] };
  let threw = '';
  try { c.nightlyStep_(headCtx, 'x_', () => {}, { ok: false, reason: 'r' }); }
  catch (e) { threw = e.message; }
  check('a gate on a ctx without a blocked array does not throw',
        threw === '' && headCtx.blocked && headCtx.blocked.length === 1,
        threw || JSON.stringify(headCtx.blocked));

  // A gate is checked BEFORE the clock: both can be true at once, and "its input was
  // incomplete" is the more useful of the two answers.
  const c2 = runnerCtx(), ctx2 = freshCtx(c2);
  c2._advance(330000 - 30000);
  c2.nightlyStep_(ctx2, 'checkCrossPatternFlags_', () => {}, { ok: false, reason: 'incomplete' });
  check('when both the gate and the clock would stop a step, the gate is reported',
        ctx2.blocked.length === 1 && ctx2.skipped.length === 0,
        JSON.stringify({ blocked: ctx2.blocked, skipped: ctx2.skipped }));
}

console.log('\nOnly the pattern engine is gated, and the skip is reported');
{
  const body = extractFn(SRC.Code, 'nightlyRunTail');

  check('the head-completion check is made once, before the steps',
        /var headDone = nightlyHeadCompletedTonight_\(\);/.test(body) &&
        body.indexOf('nightlyHeadCompletedTonight_()') <
          body.indexOf("nightlyStep_(ctx, 'checkHealthAppointments_'"),
        'asked per step, the head\'s state could change mid-tail and two steps ' +
        'disagree about the same night');
  check('the pattern engine is gated on it',
        /nightlyStep_\(ctx, 'checkCrossPatternFlags_', checkCrossPatternFlags_, headDone\)/
          .test(body));

  // Narrow by design: the other tail steps read their own sheets.
  const gated = (body.match(/nightlyStep_\(ctx,\s*'([^']+)',[^;]*?,\s*headDone\)/g) || [])
    .map(m => /'([^']+)'/.exec(m)[1]);
  check('and nothing else is',
        gated.length === 1 && gated[0] === 'checkCrossPatternFlags_',
        JSON.stringify(gated) + ' — withholding steps that read their own sheets ' +
        'would cost work and buy no correctness');

  check('the tail collects blocked steps separately from skipped ones',
        /blocked:\s*stepBlocked/.test(body) && /var stepBlocked\s*=\s*\[\]/.test(body),
        JSON.stringify(body.match(/stepBlocked[^;\n]*/g)));
  check('…and the Slack summary counts them separately',
        /stepBlocked\.length \+ ' skipped \(incomplete input\)'/.test(body) &&
        /stepSkipped\.length \+ ' skipped \(time budget\)'/.test(body),
        'one count for both and "the night ran long" and "the night was incomplete" ' +
        'become the same sentence');
  check('…and names them, with reasons, on their own line',
        /Tail skipped — incomplete input/.test(body) &&
        /stepBlocked\.map\(/.test(body),
        'a count with no names cannot be acted on');
  check('a withheld step makes the night Partial, not Success',
        /\(stepFailures\.length \|\| stepBlocked\.length\) \? 'Partial' : 'Success'/.test(body),
        'logged as Success and the withholding is invisible in the System Log, which ' +
        'is the one place you would go looking for it');

  check('the head does NOT gate anything on its own completion',
        !/headDone/.test(extractFn(SRC.Code, 'nightlyRun')),
        'it cannot know whether it finished while it is still running');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
