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
function runnerCtx() {
  let now = 1000000;
  const props = {};
  const ctx = {
    String, Number, Object, Array, Math, JSON, Error, console,
    Logger: { log: () => {} },
    Date: { now: () => now },
    _advance: ms => { now += ms; },
    _nowIs: () => now,
    _props: props,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; },
    }) },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(SRC.Code, 'nightlyStep_') + '\n' +
                  extractFn(SRC.Code, 'slowestNightlySteps_') + '\n' +
                  /^var NIGHTLY_STEP_PROP_\s*=.*?;/m.exec(SRC.Code)[0] + '\n' +
                  /^var NIGHTLY_TAIL_STEP_PROP_\s*=.*?;/m.exec(SRC.Code)[0] + '\n' +
                  /^var NIGHTLY_STEP_RESERVE_MS_\s*=.*?;/m.exec(SRC.Code)[0], ctx);
  return ctx;
}

const START = 1000000;
const freshCtx = c => ({
  runStart: START, deadline: START + 330000,   // 5m30s, as the run uses
  failures: [], skipped: [], timings: [],
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
  check('the nightly job registers the breadcrumb property',
        /stepProp: 'NIGHTLY_STEP'/.test(SRC.Watch));
  check('the step is only read when the run actually died',
        fn.indexOf("started but did not finish") < fn.indexOf('r.stepProp'),
        'a breadcrumb means nothing unless the start marker beat the heartbeat');
  check('the marker is split on the pipe nightlyStep_ writes',
        /split\('\|'\)/.test(fn), 'the two must agree on the format');
  check('both renderers name it',
        (SRC.Watch.match(/died during/g) || []).length === 2,
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
    vm.runInContext('Date.now = function() { return ' + now + '; };\n' + fn, ctx);
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

  // The seven the banner said were being starved.
  const EXPECTED_TAIL = ['checkHealthAppointments_', 'checkMonthlyReview_',
    'sendHealthPerformanceInsightMonthly_', 'resetWeekMealPlan_',
    'checkCrossPatternFlags_', 'suggestDueDates', 'runExplorer_'];
  check('the tail is exactly the steps that were being starved',
        tail.join(',') === EXPECTED_TAIL.join(','), JSON.stringify(tail));
  check('…and none of them is still in the first half',
        EXPECTED_TAIL.every(s => head.indexOf(s) === -1),
        JSON.stringify(EXPECTED_TAIL.filter(s => head.indexOf(s) !== -1)));

  // Nothing fell down the gap between the two. Comparing against git HEAD was the
  // obvious way and is worthless: the moment the split is committed, HEAD becomes
  // the split version and the check passes trivially forever. This holds for good —
  // every nightlyStep_ call in the file has to live in one of the two halves, so a
  // step belonging to neither is impossible rather than merely unlikely.
  // The quote is load-bearing: without it this also matches the declaration,
  //   function nightlyStep_(ctx, name, fn)
  // and the count is one too many for a reason that has nothing to do with the split.
  const allCalls = (SRC.Code.match(/nightlyStep_\(ctx,\s*'/g) || []).length;
  check('every nightlyStep_ call in Code.js is in one half or the other',
        allCalls === head.length + tail.length,
        JSON.stringify({ inFile: allCalls, head: head.length, tail: tail.length }) +
        ' — a step in neither half runs on no night at all');
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
  check('…and a trigger fires it',
        /newTrigger\('nightlyRunTail'\)/.test(SRC.Code));
  check('…an hour after the first half, not alongside it',
        /atHour\(\(CONFIG\.NIGHTLY_RUN_HOUR \+ 1\) % 24\)/.test(SRC.Code),
        'back to back and the second starts underneath an overrunning first');

  // The expensive thing the tail must not do twice.
  check('the PTO snapshot is only recomputed on the day it is read',
        /today\.getDate\(\) === 1 \? writePTOSnapshot_\(\) : null/.test(body),
        'checkMonthlyReview_ returns immediately on the other 30 days, and the ' +
        'snapshot is one of the heaviest steps in the night');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
