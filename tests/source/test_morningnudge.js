// The morning email must DEGRADE, not die.
//
// It was killed at Apps Script's six-minute ceiling. A terminated execution does not
// run its finally, so there was no heartbeat, no delivery marker, and flushSystemLog_
// never ran — taking that run's entire log with it. All the watchdog could say was
// "Morning email has not run in 1d 2h", which is the same sentence it uses for a
// trigger that never fired.
//
// It builds from ~15 sources: the Flags sheet, Drive, Calendar, a weather API, the
// watchdog, two task backends, Signal Learning. Each already had its own try/catch, so
// it degraded on ERROR but not on TIME — one slow dependency took the whole email.
//
// Asserted here against the real source and the real nightlyStep_:
//   - a breadcrumb written BEFORE each phase, so a kill names the phase;
//   - a budget checked before each phase, so the email still sends without a section;
//   - the Flags read and the send are NOT budgeted, because without them there is no
//     email to degrade.
const fs = require('fs'), vm = require('vm'), path = require('path');
const parser = require('@babel/standalone').packages.parser;
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const CODE = fs.readFileSync(ROOT + '/Code.js', 'utf8');
const WATCH = fs.readFileSync(ROOT + '/Watchdog.js', 'utf8');

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

const BODY = extractFn(CODE, 'morningNudge');

// Phase names, read out of the real source rather than listed here — a phase added
// later is covered without anyone updating this file.
const phases = (BODY.match(/nightlyStep_\(ctx,\s*'([^']+)'/g) || [])
  .map(m => /'([^']+)'/.exec(m)[1]);

// ============================================================================
console.log('Every slow phase is budgeted');
{
  check('the email is built in phases, not one block',
        phases.length >= 8, JSON.stringify(phases));

  // The external dependencies. These are the ones that can hang.
  ['loadLogoFromDrive', 'getUpcomingEvents', 'getWeatherTicker_', 'runWatchdog_',
   'getOpenTasks', 'webGetGoogleTasks_', 'buildMorningIntelligence_'].forEach(p => {
    check('  ' + p + ' is a budgeted phase', phases.indexOf(p) !== -1, JSON.stringify(phases));
  });

  check('the weather fetch is guarded at all',
        phases.indexOf('getWeatherTicker_') !== -1 &&
        !/^\s*const weatherTicker = getWeatherTicker_/m.test(BODY),
        'it was a bare call on an external HTTP fetch with no try/catch — the one ' +
        'phase that could take the email down by throwing as well as by hanging');

  // The watchdog is the heaviest: it reads the Flags sheet, APPENDS rows and posts to
  // Slack. Separated from the rendering so the breadcrumb can tell them apart.
  check('the watchdog is its own phase, separate from rendering the notice',
        phases.indexOf('runWatchdog_') !== -1 &&
        phases.indexOf('buildStalenessNotice') !== -1 &&
        phases.indexOf('runWatchdog_') < phases.indexOf('buildStalenessNotice'),
        JSON.stringify(phases) + ' — "died during runWatchdog_" and "died during ' +
        'buildStalenessNotice" are different problems');

  // What must NOT be budgeted: without these there is no email to degrade.
  check('reading the Flags sheet is NOT budgeted',
        !/nightlyStep_\(ctx, '[^']*[Ff]lag[^']*'/.test(BODY) &&
        /sheet\.getRange\(2, 1, numRows/.test(BODY),
        'skipping the flags would send an email with nothing in it');
  check('the send itself is NOT budgeted',
        !/nightlyStep_\([^)]*sendVeraEmail_/.test(BODY) &&
        /sendVeraEmail_\(CONFIG\.MORNING_NUDGE_EMAIL/.test(BODY),
        'a budget check in front of the send is a budget check that can cancel the email');

  check('the budget leaves room for the build and the send',
        /deadline: runStart \+ 4\.5 \* 60 \* 1000/.test(BODY),
        'the nightly 5m30s leaves 30s for everything after the last phase; here the ' +
        'HTML build and the Gmail call still have to happen');
}

console.log('\nA killed run names the phase that killed it');
{
  check('a start marker is written before any work',
        /setProperty\('LAST_MORNING_START'/.test(BODY) &&
        BODY.indexOf("setProperty('LAST_MORNING_START'") < BODY.indexOf('nightlyStep_(ctx,'),
        'written after the first phase, it cannot explain a kill inside that phase');
  check('…and non-fatally',
        /catch \(startErr\)/.test(BODY), 'a marker must never be able to break the email');
  check('the phases write the MORNING breadcrumb, not the nightly one',
        /stepProp:\s*MORNING_STEP_PROP_/.test(BODY) &&
        /var MORNING_STEP_PROP_\s*=\s*'MORNING_STEP'/.test(CODE),
        'sharing NIGHTLY_STEP would have the morning email overwrite the night\'s death');
  check('the watchdog knows about both markers',
        /job: 'morningNudge'[\s\S]{0,200}?startProp: 'LAST_MORNING_START'[\s\S]{0,80}?stepProp: 'MORNING_STEP'/
          .test(WATCH),
        'without them it can only say "has not run", which is what cost a day');

  // Cleared in the finally here, the OPPOSITE of nightlyRun, and deliberately.
  check('the breadcrumb is cleared in the finally',
        /finally \{[\s\S]*?deleteProperty\(MORNING_STEP_PROP_\)/.test(BODY),
        'this function has three legitimate early returns that send nothing; leaving ' +
        'a breadcrumb set on those would report a death that never happened');
}

console.log('\nThe disabled path still records');
{
  // From the AST. The first version compared against BODY.indexOf('try {'), which is
  // the TRAVEL BRIEFING's try at the top of the function — before the enabled check in
  // the broken version too, so the assertion passed either way and proved nothing.
  // Its own negative control is what exposed that.
  const fn = (function () {
    for (const st of parser.parse(CODE, { sourceType: 'script' }).program.body) {
      if (st.type === 'FunctionDeclaration' && st.id && st.id.name === 'morningNudge') return st;
    }
    return null;
  })();
  const find = (node, pred) => {
    let hit = null;
    (function rec(n) {
      if (hit || !n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(rec); return; }
      if (n.type && pred(n)) { hit = n; return; }
      Object.keys(n).forEach(k => { if (k !== 'loc') rec(n[k]); });
    })(node);
    return hit;
  };
  const recordingTry = find(fn.body, n =>
    n.type === 'TryStatement' && n.finalizer &&
    !!find(n.finalizer, x => x.type === 'CallExpression' &&
      x.callee.type === 'Identifier' && x.callee.name === 'recordHeartbeat_' &&
      x.arguments[0] && x.arguments[0].value === 'morningNudge'));
  const enabledCall = find(fn.body, n =>
    n.type === 'CallExpression' && n.callee.type === 'Identifier' &&
    n.callee.name === 'isNotifEnabled_' &&
    n.arguments[0] && n.arguments[0].value === 'morning_briefing');

  check('there is a try whose finally records the heartbeat', !!recordingTry);
  check('the enabled check sits INSIDE it',
        !!enabledCall && !!recordingTry &&
        enabledCall.start > recordingTry.start && enabledCall.end < recordingTry.end,
        'outside it, a briefing you switched off records no heartbeat and reports as ' +
        'an outage forever. test_heartbeats.js proves this generally, for all 8 jobs.');
}

console.log('\nThe run says what it cost');
{
  check('it reports its slowest phases',
        /slowestNightlySteps_\(stepTimings/.test(BODY) && /Slowest morning phases/.test(BODY),
        'emitted at the END of a run, so until the kill was fixed it was only ever ' +
        'produced by runs that did not need it');
  // Aimed at the Slack summary LINE, not the file. The first version matched
  // /skipped \(time budget\)/ anywhere in the function and so still passed when the
  // summary was changed to call a dropped section a warning — the veraLog_ call
  // further down carries the same words.
  check('a dropped section is counted apart from a warning in the summary line',
        /mSummary \+= ' \u00b7 ' \+ stepSkipped\.length \+ ' skipped \(time budget\)'/.test(BODY) &&
        /Morning sections dropped for time/.test(BODY),
        '"a phase failed" and "a phase was dropped to save the email" are different');
  check('…and makes the run Partial, not Success',
        /\(stepFailures\.length \|\| stepSkipped\.length\) \? 'Partial' : 'Success'/.test(BODY),
        'logged Success and the dropped section is invisible in the System Log');
  // Matching /catch \(mSumErr\)/ alone passed when the handler was changed to rethrow
  // — the catch was still there, it just no longer caught anything. Its own control
  // found that.
  check('the summary cannot break the email',
        /catch \(mSumErr\) \{ \/\* non-fatal/.test(BODY) &&
        !/catch \(mSumErr\) \{[^}]*throw/.test(BODY),
        'the email has already been SENT by this point; a throw here would turn a ' +
        'delivered briefing into a logged failure');
}

console.log('\nThe duplicated calendar fetch is gone');
{
  // getUpcomingEvents() was called twice: once for today's events, and again inside
  // the capacity ticker purely to count today's meetings.
  //
  // Counted from the AST, not the text. Matching /getUpcomingEvents\(\)/ over the
  // source found two — the real call and the COMMENT above the fix describing the call
  // that was removed. Fifth time in this codebase a check has matched a comment about
  // the thing instead of the thing; see test_heartbeats.js for the other four.
  let calls = 0;
  (function countCalls(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(countCalls); return; }
    if (n.type === 'CallExpression' && n.callee && n.callee.type === 'Identifier' &&
        n.callee.name === 'getUpcomingEvents') calls++;
    Object.keys(n).forEach(k => { if (k !== 'loc') countCalls(n[k]); });
  })((function () {
    const ast = parser.parse(CODE, { sourceType: 'script' });
    for (const st of ast.program.body) {
      if (st.type === 'FunctionDeclaration' && st.id && st.id.name === 'morningNudge') return st;
    }
    return null;
  })());

  check('the calendar is fetched once, not twice', calls === 1,
        calls + ' call(s) — a whole extra calendar round trip to count meetings ' +
        'already present in todayEventsAll, on the execution that was out of time');
  check('…and the meeting count comes from the events already fetched',
        /todayEventsAll\.filter\(function\(e\) \{ return !e\.isAllDay; \}\)\.length/.test(BODY),
        BODY.slice(BODY.indexOf('var meetCount'), BODY.indexOf('var meetCount') + 160));
}

// ============================================================================
// BEHAVIOURAL: drive the real nightlyStep_ with a morning-shaped ctx and prove a
// phase that overruns leaves the others alone.
console.log('\nA slow phase costs its own section only');
{
  const ctx = {
    String, Number, Object, Array, Math, JSON, Error, console, isNaN,
    Logger: { log: () => {} },
    Date: { now: () => now },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => props[k] || null,
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; },
    }) },
  };
  let now = 5000000;
  const props = {};
  ctx.Date = { now: () => now };
  vm.createContext(ctx);
  vm.runInContext(extractFn(CODE, 'nightlyStep_') + '\n' +
                  extractFn(CODE, 'slowestNightlySteps_') + '\n' +
                  /^var NIGHTLY_STEP_PROP_\s*=.*?;/m.exec(CODE)[0] + '\n' +
                  /^var MORNING_STEP_PROP_\s*=.*?;/m.exec(CODE)[0] + '\n' +
                  /^var NIGHTLY_STEP_RESERVE_MS_\s*=.*?;/m.exec(CODE)[0], ctx);

  const start = now;
  const c = { runStart: start, deadline: start + 4.5 * 60 * 1000,
              failures: [], skipped: [], timings: [], stepProp: ctx.MORNING_STEP_PROP_ };

  // A weather fetch that eats the entire budget.
  let rendered = { weather: '', tasks: 0, intel: '' };
  ctx.nightlyStep_(c, 'getWeatherTicker_', () => { now += 4.4 * 60 * 1000; rendered.weather = 'W'; });
  // …everything after it is skipped rather than run into the kill.
  ctx.nightlyStep_(c, 'getOpenTasks', () => { rendered.tasks = 7; });
  ctx.nightlyStep_(c, 'buildMorningIntelligence_', () => { rendered.intel = 'I'; });

  check('the slow phase itself completed', rendered.weather === 'W');
  check('the phases after it are skipped, not run into the kill',
        c.skipped.length === 2 && rendered.tasks === 0 && rendered.intel === '',
        JSON.stringify({ skipped: c.skipped, rendered }));
  check('…and are NAMED, so the email can say what is missing',
        c.skipped.indexOf('getOpenTasks') !== -1 &&
        c.skipped.indexOf('buildMorningIntelligence_') !== -1,
        JSON.stringify(c.skipped));
  check('the breadcrumb holds the last phase ATTEMPTED',
        /^getWeatherTicker_\|/.test(props[ctx.MORNING_STEP_PROP_] || ''),
        JSON.stringify(props) + ' — that is the name a killed run leaves behind');
  check('…in the morning property, not the nightly one',
        !props[ctx.NIGHTLY_STEP_PROP_], JSON.stringify(Object.keys(props)));
  check('the timings name the expensive one',
        ctx.slowestNightlySteps_(c.timings, 5)[0].indexOf('getWeatherTicker_') === 0,
        JSON.stringify(ctx.slowestNightlySteps_(c.timings, 5)));

  // The email still has everything the un-skipped phases produced — the point of the
  // change. Before it, this run was simply killed and nothing was sent.
  check('the run reached the end with sections to send',
        c.timings.length === 1 && c.skipped.length === 2,
        'a killed run sends nothing at all; a budgeted one sends what it had');

  // A phase that THROWS is a warning, not a dropped section, and does not stop the rest.
  const c2 = { runStart: now, deadline: now + 4.5 * 60 * 1000,
               failures: [], skipped: [], timings: [], stepProp: ctx.MORNING_STEP_PROP_ };
  let after = 0;
  ctx.nightlyStep_(c2, 'loadLogoFromDrive', () => { throw new Error('drive 500'); });
  ctx.nightlyStep_(c2, 'getOpenTasks', () => { after = 1; });
  check('a throwing phase is a warning and the rest still runs',
        c2.failures.length === 1 && /drive 500/.test(c2.failures[0]) && after === 1 &&
        c2.skipped.length === 0,
        JSON.stringify({ failures: c2.failures, skipped: c2.skipped, after }));
}

// ============================================================================
// The function still parses as one function and the phase closures really are
// closures — a hoisting slip here would send an email full of undefined.
console.log('\nThe phase variables are still assigned');
{
  let ast = null, err = '';
  try { ast = parser.parse(CODE, { sourceType: 'script' }); } catch (e) { err = e.message; }
  check('Code.js parses', !!ast, err);

  // Every phase closure assigns to a variable declared OUTSIDE it, which is the whole
  // mechanism. `const` cannot be reassigned, so any phase variable left as const would
  // throw at runtime — in a closure, which nightlyStep_ catches, turning the section
  // silently blank instead of loudly wrong.
  const declared = ['capMode', 'capSource', 'inlineImages', 'logoTag', 'todayEventsAll',
                    'weatherTicker', 'watchdogLines', 'stalenessNotice', 'stalenessPlainText',
                    'overdueCount', 'dueTodayCount', 'gOverdueCount', 'gDueTodayCount',
                    'intelligenceSection', 'guestTicker'];
  const stillConst = declared.filter(v =>
    new RegExp('(const|let)\\s+' + v + '\\b').test(BODY));
  check('no phase variable is still const or let',
        stillConst.length === 0, JSON.stringify(stillConst) +
        ' — reassigning one inside a closure throws, nightlyStep_ catches it, and ' +
        'the section goes blank with only a warning to show for it');
  const allVar = declared.filter(v => new RegExp('var\\s+' + v + '\\b').test(BODY));
  check('…and each is declared with var, outside its phase',
        allVar.length === declared.length,
        JSON.stringify(declared.filter(v => allVar.indexOf(v) === -1)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
