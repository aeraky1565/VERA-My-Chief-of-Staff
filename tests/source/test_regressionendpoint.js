// The live regression endpoint has to ANSWER.
//
// Regression run #187 failed like this:
//
//   TimeoutError: apiRequestContext.get: Timeout 60000ms exceeded.
//     - → GET ***?action=regression_test&token=***
//
// Not a failing check — no response at all, twice. Every other live endpoint in
// the same run was fine (status 8.5s, get_notification_map 6.3s, get_config_rows
// 3.5s), so the web app was up; this one endpoint ran past the client's patience.
//
// It runs nine checks serially, one of them CalendarApp.getAllCalendars(), whose
// latency is Google's business. It measured per-check ms the whole time and threw
// all of it away, because a request that never returns carries no diagnosis. So a
// slow check produced a timeout that named nothing — the same shape as the nightly
// run dying without recording a heartbeat.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = {
  Reg:  fs.readFileSync(ROOT + '/RegressionTest.js', 'utf8'),
  Spec: fs.readFileSync(ROOT + '/tests/regression.spec.js', 'utf8'),
};

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

// A clock the test drives, and readers that cost whatever the test says they cost.
// Real elapsed time cannot be used here: the point is behaviour at 45 seconds, and
// a test that waits 45 seconds to find out is a test nobody runs.
function loadCtx(costs, opts) {
  const o = opts || {};
  let now = 1000000;
  const calls = [];

  function reader(name) {
    return function () {
      calls.push(name);
      now += (costs[name] === undefined ? 10 : costs[name]);
      if (o.throwOn === name) throw new Error(o.throwMessage || 'boom');
      return { ok: true };
    };
  }

  const ctx = {
    String, Number, Object, Array, Math, JSON, Error, console,
    Logger: { log: () => {} },
    Date: { now: () => now },
    _calls: calls,
    _advance: ms => { now += ms; },

    // Everything the nine checks touch.
    getConfigValues:   reader('config'),
    getSpreadsheet:    function () { calls.push('spreadsheet'); now += (costs.spreadsheet || 10);
                                     if (o.throwOn === 'spreadsheet') throw new Error(o.throwMessage || 'boom');
                                     return { getSheets: () => [1, 2, 3] }; },
    CalendarApp:       { getAllCalendars: reader('calendar') },
    webGetStatus_:     reader('status'),
    webGetFlags_:      reader('flags'),
    webGetTasks_:      reader('tasks'),
    webGetShopping_:   reader('shopping'),
    webGetBudget_:     reader('budget'),
    webGetBills_:      reader('bills'),

    // jsonOut_ hands back the object so assertions can read it directly.
    jsonOut_: obj => obj,
  };
  vm.createContext(ctx);
  const budget = /^var REGRESSION_BUDGET_MS\s*=.*?;/m.exec(SRC.Reg);
  if (!budget) throw new Error('REGRESSION_BUDGET_MS not found');
  vm.runInContext(budget[0] + '\n' + extractFn(SRC.Reg, 'handleRegressionTest_'), ctx);
  return ctx;
}

const CHECKS = ['config_readable', 'spreadsheet_access', 'calendar_access', 'status_action',
                'flags_readable', 'tasks_readable', 'shopping_readable', 'budget_readable',
                'bills_readable'];

console.log('Everything healthy and inside the budget');
{
  const c = loadCtx({});
  const r = c.handleRegressionTest_({ parameter: {} });

  check('every check runs', r.results.length === CHECKS.length, r.results.length);
  check('…in the declared order',
        r.results.map(x => x.name).join() === CHECKS.join(),
        r.results.map(x => x.name).join());
  check('all pass', r.passed === CHECKS.length && r.failed === 0 && r.skipped === 0,
        JSON.stringify({ p: r.passed, f: r.failed, s: r.skipped }));
  check('ok is true', r.ok === true);
  check('every check carries a timing', r.results.every(x => typeof x.ms === 'number'),
        'the timings are the diagnosis — they have to be there even when nothing fails');
  check('the budget is reported', r.budget_ms === 45000, r.budget_ms);
  check('…and the total', typeof r.total_ms === 'number');
}

console.log('\nA broken check does not mask the others');
{
  const c = loadCtx({}, { throwOn: 'flags', throwMessage: 'Flags tab not found' });
  const r = c.handleRegressionTest_({ parameter: {} });

  const flags = r.results.find(x => x.name === 'flags_readable');
  check('the broken check is recorded as a failure', flags.status === 'fail', flags.status);
  check('…carrying its message', /Flags tab not found/.test(flags.error), flags.error);
  check('ok is false', r.ok === false);
  check('the checks AFTER it still ran',
        r.results.filter(x => x.status === 'pass').length === CHECKS.length - 1,
        'one unreadable tab must not hide the state of the other eight');
  check('…including the last one',
        r.results[r.results.length - 1].status === 'pass');
}

console.log('\nRunning out of budget: it still answers');
{
  // calendar_access eats the whole budget, the way a slow Google call would.
  const c = loadCtx({ calendar: 60000 });
  const r = c.handleRegressionTest_({ parameter: {} });

  check('a response is returned at all', !!r && Array.isArray(r.results),
        'this is the whole point — the old shape returned nothing and the client timed out');
  check('the slow check itself completed', r.results[2].status === 'pass' && r.results[2].ms === 60000,
        JSON.stringify(r.results[2]));
  check('everything after it is skipped',
        r.results.slice(3).every(x => x.status === 'skipped'),
        JSON.stringify(r.results.map(x => x.status)));
  check('…and says why', r.results[3].error === 'time budget exhausted', r.results[3].error);
  check('skipped checks cost nothing', r.results.slice(3).every(x => x.ms === 0));
  check('they are counted separately from failures',
        r.skipped === CHECKS.length - 3 && r.failed === 0,
        JSON.stringify({ s: r.skipped, f: r.failed }));

  check('an overrun still fails the build', r.ok === false,
        '"I ran out of time" is not a clean bill of health');
  check('the slow check is nameable from the response',
        r.results.filter(x => x.status !== 'skipped').pop().name === 'calendar_access',
        'this is what the timeout could never tell us');

  // And the readers past the deadline are never even called.
  check('a skipped check is not STARTED',
        c._calls.indexOf('status') === -1,
        'starting a slow check past the deadline is exactly what stops the response being sent');
}

console.log('\nThe boundary');
{
  // Exactly at the deadline the next check must not start: at that point there is
  // no time left to finish it in, and a half-run check is what kills the response.
  const c = loadCtx({ config: 45000 });
  const r = c.handleRegressionTest_({ parameter: {} });
  check('a check that lands exactly on the deadline stops the rest',
        r.results[0].status === 'pass' && r.results[1].status === 'skipped',
        JSON.stringify(r.results.slice(0, 2)));

  const c2 = loadCtx({ config: 44999 });
  const r2 = c2.handleRegressionTest_({ parameter: {} });
  check('…and one millisecond short does not', r2.results[1].status === 'pass',
        JSON.stringify(r2.results.slice(0, 2)));
}

console.log('\nThe spec reports what it got');
{
  check('it prints a timing for passing checks too', /✅ \$\{r\.name\} \(\$\{r\.ms\}ms\)/.test(SRC.Spec));
  check('it renders skipped distinctly from failed', /⏭/.test(SRC.Spec));
  check('it prints the total against the budget', /total \$\{data\.total_ms\}ms of \$\{data\.budget_ms\}ms/.test(SRC.Spec));
  check('an overrun throws a message naming the slowest completed check',
        /slowest completed: \$\{lastRan\.name\}/.test(SRC.Spec));
  check('the client timeout is still 60s', /timeout: 60000/.test(SRC.Spec),
        'raising it would paper over the signal this exists to surface');
  check('…which leaves the server budget inside it', 45000 < 60000);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
