// =============================================================
// VERA — Regression Test Handler
// Called via WebApp.js: action=regression_test
// Runs read-only checks across all major system areas.
// Returns JSON: { ok, passed, failed, total_ms, results: [...] }
// ============================================================

function handleRegressionTest_(e) {
  var t0 = Date.now();
  var results = [];

  function run(name, fn) {
    var s = Date.now();
    try {
      fn();
      results.push({ name: name, status: 'pass', ms: Date.now() - s });
    } catch (err) {
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

  // ── Travel ───────────────────────────────────────────────────────────────
  run('upcoming_travel', function () {
    getUpcomingTravel_();
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  var passed = results.filter(function (r) { return r.status === 'pass'; }).length;
  var failed = results.filter(function (r) { return r.status === 'fail'; }).length;

  var resp = {
    ok: failed === 0,
    passed: passed,
    failed: failed,
    total_ms: Date.now() - t0,
    results: results
  };

  Logger.log('regression_test: ' + passed + ' passed, ' + failed + ' failed');
  results.forEach(function (r) {
    if (r.status === 'fail') Logger.log('  FAIL ' + r.name + ': ' + r.error);
  });

  return jsonOut_(resp);
}
