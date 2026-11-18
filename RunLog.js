// ============================================================
// VERA — RunLog.js
// The Run Log: one row per scheduled run, written AS THE RUN GOES.
// ============================================================
//
// WHY NOT THE SYSTEM LOG. veraLog_ rows are buffered and written in each handler's
// finally (VERALog.js). Apps Script kills a run at six minutes and a killed run never
// reaches its finally, so the night that most needed a record left none: the nightly
// run died three nights in a row and nothing in any sheet said where.
//
// So this writes a row when the run STARTS (Status: Running), refreshes it as the
// nightly steps go by, and completes it from recordHeartbeat_, which every scheduled
// handler already calls in its finally. A row still "Running" well past six minutes
// was killed; the next run of the same job, or the hourly watchdog, marks it Cut off
// and fills in the step it died in from that job's breadcrumb (nightlyStep_).
//
// WHERE. The sheet named by the Config row run_log_sheet_id (an id or a pasted link),
// one tab per job ("Nightly run", "Flight status"…), so the nightly rows aren't buried
// under a hundred flight checks a day. Without that row, everything goes in one Run Log
// tab in VERA's own sheet rather than eight new tabs there.
//
// WHAT. Only the eight scheduled handlers (TRIGGER_SPECS in Code.js). Dashboard calls
// are not logged: the two handlers the dashboard also calls take arguments then, and a
// run started from code with arguments is skipped (runLogStart_).
//
// Logging must never break a run: every entry point here swallows its own errors.

var RUN_LOG_TAB_     = 'Run Log';                     // the single tab, in VERA's own sheet
var RUN_LOG_SETTING_ = 'RUN_LOG_SHEET_ID';            // Config row: run_log_sheet_id
var RUN_LOG_HEADERS_ = ['Started', 'Function', 'Status', 'Finished', 'Duration (s)', 'Last step', 'At (s)',
                        'Steps run', 'Skipped', 'Errors', 'Slowest steps', 'Summary', 'Run ID'];
var RUN_LOG_C_ = { STARTED: 0, FN: 1, STATUS: 2, FIN: 3, DUR: 4, STEP: 5, AT: 6, STEPS: 7, SKIP: 8, ERR: 9, SLOW: 10, SUM: 11, ID: 12 };
var RUN_LOG_KEEP_DAYS_ = 30;
var RUN_LOG_STALE_MS_  = 7 * 60 * 1000;   // past Apps Script's six minutes: it can't still be running
var RUN_LOG_EVERY_     = 5;               // refresh the row every 5th step…
var RUN_LOG_EVERY_MS_  = 30 * 1000;       // …or every 30 s, whichever comes first
var RUN_LOG_LOOK_      = 300;             // rows read back when finding or sweeping
var RUN_LOG_READ_      = 1500;            // rows the card reads from the single tab (~170 runs a day)
// The scheduled jobs, in the order the card lists them (TRIGGER_SPECS, Code.js), and their tabs.
var RUN_LOG_ORDER_ = ['nightlyRun', 'nightlyRunTail', 'morningNudge', 'hourlyCheck', 'checkFlightStatuses_', 'runEmailScan_', 'scanUSPSMail_', 'scanHoaWebsite_'];
var RUN_LOG_TABS_ = { nightlyRun: 'Nightly run', nightlyRunTail: 'Nightly run, second half', morningNudge: 'Morning email', hourlyCheck: 'Hourly check',
                      checkFlightStatuses_: 'Flight status', runEmailScan_: 'Email scan', scanUSPSMail_: 'USPS mail scan', scanHoaWebsite_: 'HOA website scan' };
// Each job's breadcrumb (Code.js NIGHTLY_STEP_PROP_ etc.), as "step|seconds".
var RUN_LOG_CRUMBS_ = { nightlyRun: 'NIGHTLY_STEP', nightlyRunTail: 'NIGHTLY_TAIL_STEP', morningNudge: 'MORNING_STEP' };

var _runLog_ = null;        // this execution's open run
var _runLogSS_ = null, _runLogOwn_ = null, _runLogTabs_ = {};

/** The spreadsheet the log lives in, and whether it's VERA's own (no run_log_sheet_id). */
function runLogBook_() {
  if (_runLogSS_) return _runLogSS_;
  var id = '';
  try { id = veraSettingId_(RUN_LOG_SETTING_); } catch (e) { id = ''; }
  _runLogOwn_ = !id;
  _runLogSS_ = id ? SpreadsheetApp.openById(id) : getSpreadsheet();
  return _runLogSS_;
}

/** Pure: the tab a job's rows go in. One tab per job in the logs sheet; one shared tab in VERA's own. */
function runLogTabName_(fn, own) { return own ? RUN_LOG_TAB_ : (RUN_LOG_TABS_[fn] || String(fn || 'Other')); }

function runLogSheet_(fn) {
  var ss = runLogBook_(), name = runLogTabName_(fn, _runLogOwn_);
  if (!_runLogTabs_[name]) _runLogTabs_[name] = ensureSheet(ss, name, RUN_LOG_HEADERS_);
  return _runLogTabs_[name];
}

/** Every tab there is to read: the one shared tab, or each job's own. */
function runLogTabsToRead_() {
  runLogBook_();
  if (_runLogOwn_) return [{ fn: null, sheet: runLogSheet_(null) }];
  return RUN_LOG_ORDER_.map(function(fn) { return { fn: fn, sheet: runLogSheet_(fn) }; });
}

/** Pure: the job a routine name belongs to ('checkFlightStatuses' and 'checkFlightStatuses_' are one). */
function runLogSame_(a, b) { return String(a || '').replace(/_+$/, '') === String(b || '').replace(/_+$/, ''); }

/**
 * Called first thing in each scheduled handler. Opens this run's row.
 * arg is the handler's first argument: a trigger passes an event object, code passes
 * its own arguments (checkFlightStatuses_(true, key) from the dashboard), and those
 * calls are not scheduled runs.
 */
function runLogStart_(fn, arg) {
  try {
    if (_runLog_) return null;                                   // nested inside another logged run
    if (arg !== undefined && (arg === null || typeof arg !== 'object')) return null;
    var now = Date.now(), sheet = runLogSheet_(fn);
    try { runLogSweep_(sheet, fn, now); } catch (e) { Logger.log('runLogSweep_ (non-fatal): ' + e.message); }
    var row = []; for (var i = 0; i < RUN_LOG_HEADERS_.length; i++) row.push('');
    row[RUN_LOG_C_.STARTED] = new Date(now); row[RUN_LOG_C_.FN] = fn; row[RUN_LOG_C_.STATUS] = 'Running'; row[RUN_LOG_C_.STEPS] = 0;
    row[RUN_LOG_C_.ID] = fn + '-' + now;
    sheet.appendRow(row);
    _runLog_ = { fn: fn, id: row[RUN_LOG_C_.ID], t0: now, steps: 0, last: '', at: 0, wrote: now, ctx: null, status: '', summary: '', error: '' };
    return _runLog_;
  } catch (e) { Logger.log('runLogStart_ (non-fatal): ' + e.message); return null; }
}

/** From nightlyStep_, before each step: remembered, and written now and then. */
function runLogStep_(ctx, name) {
  var r = _runLog_;
  if (!r) return;
  var now = Date.now();
  r.steps++; r.last = name; r.at = Math.round((now - r.t0) / 1000); r.ctx = ctx || r.ctx;
  if (r.steps % RUN_LOG_EVERY_ !== 0 && now - r.wrote < RUN_LOG_EVERY_MS_) return;
  r.wrote = now;
  try {
    var sheet = runLogSheet_(r.fn), n = runLogFind_(sheet, r.id);
    if (n) sheet.getRange(n, RUN_LOG_C_.STEP + 1, 1, 3).setValues([[r.last, r.at, r.steps]]);
  } catch (e) { Logger.log('runLogStep_ (non-fatal): ' + e.message); }
}

/** From veraLog_: the handler's own verdict and summary for this run. */
function runLogNote_(routine, status, summary, error) {
  var r = _runLog_;
  if (!r || !runLogSame_(routine, r.fn)) return;
  if (status) r.status = status;
  if (summary) r.summary = String(summary);
  if (error) r.error = String(error);
}

/** Pure: Done, Partial, Failed or Skipped, from the handler's word and the steps. */
function runLogStatus_(r) {
  var c = r.ctx || {};
  if (r.status === 'Failed') return 'Failed';
  if (r.status === 'Skipped') return 'Skipped';
  if (r.status === 'Partial' || (c.failures || []).length || (c.skipped || []).length || (c.blocked || []).length) return 'Partial';
  return 'Done';
}

/** Pure: the cells from Status to Summary for a finished run. */
function runLogFinishCells_(r, now) {
  var c = r.ctx || {};
  var skipped = (c.skipped || []).concat((c.blocked || []).map(function(b) { return String(b).split(' — ')[0]; }));
  var errs = (c.failures || []).slice(); if (r.error) errs.push(r.error);
  var slow = (c.timings || []).slice().sort(function(a, b) { return b.ms - a.ms; }).slice(0, 5)
    .map(function(t) { return t.name + ' ' + (t.ms / 1000).toFixed(1) + 's'; });
  var red = function(s) { try { return redactSecrets_(s); } catch (e) { return s; } };
  return [runLogStatus_(r), new Date(now), Math.round((now - r.t0) / 1000), r.last, r.last ? r.at : '', r.steps,
          skipped.join(', '), red(errs.join('; ')).slice(0, 500), slow.join(' · '), red(r.summary).slice(0, 300)];
}

/** From recordHeartbeat_: completes this run's row when its own heartbeat is recorded. */
function runLogFinish_(job) {
  var r = _runLog_;
  if (!r || job !== r.fn) return;
  _runLog_ = null;
  try {
    var sheet = runLogSheet_(r.fn), n = runLogFind_(sheet, r.id);
    if (n) sheet.getRange(n, RUN_LOG_C_.STATUS + 1, 1, RUN_LOG_C_.SUM - RUN_LOG_C_.STATUS + 1).setValues([runLogFinishCells_(r, Date.now())]);
  } catch (e) { Logger.log('runLogFinish_ (non-fatal): ' + e.message); }
}

/** The sheet row (1-based) holding a run id, searching the newest rows only. */
function runLogFind_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var from = Math.max(2, last - RUN_LOG_LOOK_ + 1);
  var ids = sheet.getRange(from, RUN_LOG_C_.ID + 1, last - from + 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) return from + i;
  return 0;
}

/**
 * Pure: which Running rows were cut off. rows are full rows; fn limits it to one job
 * (null = every job). Only the NEWEST cut-off row of a job takes its breadcrumb — an
 * older one died on an earlier night, and the breadcrumb has moved on since.
 * @returns [{i, step, at}] i = index into rows
 */
function runLogCutOffs_(rows, fn, now, crumbs) {
  var out = [], took = {};
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i], f = String(r[RUN_LOG_C_.FN] || '');
    if (String(r[RUN_LOG_C_.STATUS]) !== 'Running') continue;
    if (fn && f !== fn) continue;
    var t = r[RUN_LOG_C_.STARTED] instanceof Date ? r[RUN_LOG_C_.STARTED].getTime() : new Date(r[RUN_LOG_C_.STARTED]).getTime();
    if (isNaN(t) || now - t < RUN_LOG_STALE_MS_) continue;
    var step = String(r[RUN_LOG_C_.STEP] || ''), at = r[RUN_LOG_C_.AT];
    if (!took[f] && crumbs && crumbs[f]) {
      var p = String(crumbs[f]).split('|');
      if (p[0]) { step = p[0]; at = parseInt(p[1], 10) || at; }
    }
    took[f] = true;
    out.push({ i: i, step: step, at: at });
  }
  return out;
}

/**
 * Marks cut-off runs (see runLogCutOffs_). From runLogStart_, for its own job's tab;
 * from the hourly watchdog with no sheet, for every tab.
 */
function runLogSweep_(sheet, fn, now) {
  now = now || Date.now();
  if (!sheet) return runLogTabsToRead_().reduce(function(n, t) { return n + runLogSweep_(t.sheet, t.fn, now); }, 0);
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var from = Math.max(2, last - RUN_LOG_LOOK_ + 1);
  var rows = sheet.getRange(from, 1, last - from + 1, RUN_LOG_HEADERS_.length).getValues();
  var crumbs = {};
  try {
    var props = PropertiesService.getScriptProperties();
    Object.keys(RUN_LOG_CRUMBS_).forEach(function(k) { var v = props.getProperty(RUN_LOG_CRUMBS_[k]); if (v) crumbs[k] = v; });
  } catch (e) {}
  // A job that's open in THIS execution is not cut off, however its row reads.
  if (_runLog_) crumbs[_runLog_.fn] = '';
  var cut = runLogCutOffs_(rows, fn, now, crumbs).filter(function(c) { return !_runLog_ || rows[c.i][RUN_LOG_C_.ID] !== _runLog_.id; });
  cut.forEach(function(c) {
    var n = from + c.i;
    sheet.getRange(n, RUN_LOG_C_.STATUS + 1, 1, 1).setValue('Cut off');
    sheet.getRange(n, RUN_LOG_C_.STEP + 1, 1, 2).setValues([[c.step, c.at === undefined ? '' : c.at]]);
    sheet.getRange(n, RUN_LOG_C_.SUM + 1, 1, 1).setValue(c.step ? 'Never finished: cut off during ' + c.step + (c.at !== '' && c.at != null ? ' at ' + c.at + 's' : '') : 'Never finished');
  });
  return cut.length;
}

/** Pure: how many rows at the top are older than the keep window (rows are in time order). */
function runLogExpired_(started, now) {
  var cutoff = now - RUN_LOG_KEEP_DAYS_ * 86400000, n = 0;
  for (var i = 0; i < started.length; i++) {
    var t = started[i] instanceof Date ? started[i].getTime() : new Date(started[i]).getTime();
    if (isNaN(t) || t >= cutoff) break;
    n++;
  }
  return n;
}

/** Nightly (from pruneSystemLog_): drops rows older than 30 days from each tab, in one delete each. */
function runLogPrune_() {
  return runLogTabsToRead_().reduce(function(total, t) {
    var sheet = t.sheet, last = sheet.getLastRow();
    if (last < 2) return total;
    var n = runLogExpired_(sheet.getRange(2, 1, last - 1, 1).getValues().map(function(r) { return r[0]; }), Date.now());
    if (n) sheet.deleteRows(2, n);
    return total + n;
  }, 0);
}

/**
 * Pure: rows → one entry per job, its runs newest first (at most `per`). Grouped,
 * not the last N rows: the flight check runs every 15 minutes and would push the
 * nightly run off any plain list by noon.
 */
function runLogJobs_(rows, fmt, per) {
  per = per || 7; fmt = fmt || function(v) { return String(v || ''); };
  var by = {};
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i], fn = String(r[RUN_LOG_C_.FN] || '');
    if (!fn) continue;
    var list = by[fn] || (by[fn] = []);
    if (list.length >= per) continue;
    list.push({ started: fmt(r[RUN_LOG_C_.STARTED]), status: String(r[RUN_LOG_C_.STATUS] || ''), finished: fmt(r[RUN_LOG_C_.FIN]),
                secs: r[RUN_LOG_C_.DUR] === '' || r[RUN_LOG_C_.DUR] == null ? null : Number(r[RUN_LOG_C_.DUR]),
                step: String(r[RUN_LOG_C_.STEP] || ''), at: r[RUN_LOG_C_.AT] === '' || r[RUN_LOG_C_.AT] == null ? null : Number(r[RUN_LOG_C_.AT]),
                steps: Number(r[RUN_LOG_C_.STEPS]) || 0, skipped: String(r[RUN_LOG_C_.SKIP] || ''), errors: String(r[RUN_LOG_C_.ERR] || ''),
                slowest: String(r[RUN_LOG_C_.SLOW] || ''), summary: String(r[RUN_LOG_C_.SUM] || '') });
  }
  var rank = function(fn) { var k = RUN_LOG_ORDER_.indexOf(fn); return k === -1 ? 99 : k; };
  return Object.keys(by).sort(function(a, b) { return rank(a) - rank(b) || (a < b ? -1 : 1); })
    .map(function(fn) { return { fn: fn, runs: by[fn] }; });
}

/** GET run_log → {ok, jobs:[{fn, runs:[newest first, up to 7]}], where}. Owner only. */
function webRunLog_() {
  var refused = peopleOwnerOnly_();
  if (refused) return refused;
  var tabs = runLogTabsToRead_();
  var where = _runLogOwn_ ? 'the Run Log tab in VERA’s sheet' : 'your logs sheet, a tab per job';
  var tz = Session.getScriptTimeZone();
  var fmt = function(v) { return v instanceof Date ? Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss") : String(v || ''); };
  var rows = [];
  tabs.forEach(function(t) {
    var last = t.sheet.getLastRow();
    if (last < 2) return;
    var from = Math.max(2, last - (t.fn ? 7 : RUN_LOG_READ_) + 1);   // a job's own tab: its last 7 rows are all that's shown
    rows = rows.concat(t.sheet.getRange(from, 1, last - from + 1, RUN_LOG_HEADERS_.length).getValues());
  });
  return { ok: true, jobs: runLogJobs_(rows, fmt, 7), where: where };
}
