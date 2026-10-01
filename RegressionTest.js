// =============================================================
// VERA — Regression Test Handler
// Called via WebApp.js: action=regression_test
// Runs read-only checks across all major system areas.
// Returns JSON: { ok, passed, failed, total_ms, results: [...] }
// ============================================================

/**
 * How long the endpoint gives itself before it stops starting new checks.
 *
 * Kept well under the 60s the Playwright spec waits (tests/regression.spec.js),
 * because the failure this exists to prevent is the endpoint not answering at all.
 * Apps Script would let it run for 360s; the client gives up long before that, and
 * a request that never returns throws away the per-check timings below — so a slow
 * check produced a timeout that named nothing.
 *
 * If this is raised, raise the spec's timeout with it. They are a pair.
 */
var REGRESSION_BUDGET_MS = 45000;

function handleRegressionTest_(e) {
  var t0 = Date.now();
  var deadline = t0 + REGRESSION_BUDGET_MS;
  var results = [];

  function run(name, fn) {
    // Past the budget the check is not STARTED, rather than started and cut off.
    // Beginning a slow check here is exactly what stops the response being sent.
    if (Date.now() >= deadline) {
      results.push({ name: name, status: 'skipped', ms: 0, error: 'time budget exhausted' });
      return;
    }
    var s = Date.now();
    try {
      fn();
      results.push({ name: name, status: 'pass', ms: Date.now() - s });
    } catch (err) {
      // Recorded and carried on. One unreadable tab must not mask the state of
      // the other eight.
      results.push({ name: name, status: 'fail', ms: Date.now() - s, error: err.message });
    }
  }

  // ── Infrastructure ───────────────────────────────────────────────────────
  run('config_readable', function () {
    var cfg = getConfigValues();
    if (!cfg) throw new Error('getConfigValues returned falsy');
  });

  run('spreadsheet_access', function () {
    var ss = getSpreadsheet();
    if (!ss) throw new Error('getSpreadsheet returned null');
    var n = ss.getSheets().length;
    if (n === 0) throw new Error('Spreadsheet has no sheets');
  });

  run('calendar_access', function () {
    CalendarApp.getAllCalendars();
  });

  // ── Status / Flags / Tasks ───────────────────────────────────────────────
  run('status_action', function () {
    var result = webGetStatus_();
    if (!result) throw new Error('webGetStatus_ returned falsy');
  });

  run('flags_readable', function () {
    var result = webGetFlags_({ parameter: {} });
    if (typeof result !== 'object') throw new Error('webGetFlags_ returned non-object');
  });

  run('tasks_readable', function () {
    var result = webGetTasks_();
    if (!result) throw new Error('webGetTasks_ returned falsy');
  });

  // ── Shopping / Budget / Bills ────────────────────────────────────────────
  run('shopping_readable', function () {
    var result = webGetShopping_();
    if (!result) throw new Error('webGetShopping_ returned falsy');
  });

  run('budget_readable', function () {
    var result = webGetBudget_();
    if (!result) throw new Error('webGetBudget_ returned falsy');
  });

  run('bills_readable', function () {
    var result = webGetBills_();
    if (!result) throw new Error('webGetBills_ returned falsy');
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  var passed  = results.filter(function (r) { return r.status === 'pass'; }).length;
  var failed  = results.filter(function (r) { return r.status === 'fail'; }).length;
  var skipped = results.filter(function (r) { return r.status === 'skipped'; }).length;

  var resp = {
    // A budget overrun still fails the build. It has to: the endpoint exists to
    // tell you the system is healthy, and "I ran out of time" is not that. The
    // difference from before is that this ANSWERS, naming which checks ran and
    // how long each took, instead of leaving the client to time out on silence.
    ok: failed === 0 && skipped === 0,
    passed: passed,
    failed: failed,
    skipped: skipped,
    budget_ms: REGRESSION_BUDGET_MS,
    total_ms: Date.now() - t0,
    results: results
  };

  Logger.log('regression_test: ' + passed + ' passed, ' + failed + ' failed, ' +
             skipped + ' skipped in ' + resp.total_ms + 'ms');
  results.forEach(function (r) {
    if (r.status === 'fail')    Logger.log('  FAIL ' + r.name + ': ' + r.error);
    if (r.status === 'skipped') Logger.log('  SKIPPED ' + r.name + ' (time budget)');
  });

  return jsonOut_(resp);
}
