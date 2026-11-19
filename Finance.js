// ============================================================
// VERA — Finance.js
// Reads Simple Ass Tracker (budget) + Transactions (spending)
// Called from Summaries.js during the nightly run.
//
// SETUP — add these two Script Properties before first run:
//   SAT_SHEET_ID          → 1lI6pvSQIet55z-UtJpnzdTre5zKZ16VVkZgbK7X_GSA
//   TRANSACTIONS_SHEET_ID → 1bTQusCgZOAJc9xRu5qbf6mzBNaiOxnJGsA6VR5iQAag
//
// VERIFY — run these debug helpers once from the Apps Script editor:
//   logFinanceData()       → prints both SAT + transaction rows to Logs
//   logSATData()           → SAT only
//   logTransactionData()   → Transactions only
// ============================================================

// Default skip categories — used as fallback when 'finance_skip_categories' is not
// set in the Config tab. To customise without touching code, add a Config tab row:
//   Setting                    | Value
//   finance_skip_categories    | Transfers,Securities Trades,Credit Card Payments,...
// Categories are matched case-insensitively and must be exact category names.
var SKIP_CATEGORIES_DEFAULT_ = [
  'income', 'paycheck', 'salary', 'direct deposit',
  'transfer', 'transfers',
  'credit card payment', 'credit card payments',
  'payment',
  'investments', 'investment income',
  'savings',
  'refund',
  'securities trades',
];

// ============================================================
// PUBLIC ENTRY POINT — called from Summaries.js
// ============================================================

/**
 * Returns all finance summary rows (SAT + Transactions) for the Summaries tab.
 * Gracefully returns [] if either sheet is inaccessible or not configured.
 */
function getFinanceSummaries() {
  var rows = [];
  try { rows = rows.concat(getSATSummaries_()); }    catch (e) { Logger.log('Finance: SAT failed — ' + e.message); }
  try { rows = rows.concat(getTransactionSummaries_()); } catch (e) { Logger.log('Finance: Transactions failed — ' + e.message); }
  return rows;
}

// ============================================================
// BUDGET TRACKER (Household Split) — budget metrics
// ============================================================

/**
 * The budget figures for the Summaries tab, from the Household Split tab through the Budget engine
 * (Budget.js), so they are the same numbers Finances › Budget shows. One row per person × metric,
 * plus the household totals. [] when the sheet isn't connected or can't be read.
 */
function getSATSummaries_() {
  var t = bgReadTracker_();
  if (t.error) { Logger.log('Finance: ' + t.error); return []; }
  var model = bgModel_(t.grid);
  if (!model.ok) { Logger.log('Finance: ' + model.error); return []; }
  var c = budgetCompute_(model, {}, bgCategoryMap_());
  var today = todayStr_(), src = AUTO_PREFIX + ' Budget Tracker', out = [];
  c.people.forEach(function(p) {
    out.push(row_(src, p.name + ' — Take-Home', fmtCurrency_(p.takeHome), today));
    out.push(row_(src, p.name + ' — Transfer To Joint', fmtCurrency_(p.checking), today));
    out.push(row_(src, p.name + ' — Personal Bills', fmtCurrency_(p.personalBills), today));
    out.push(row_(src, p.name + ' — Left Over', fmtCurrency_(p.disposable), today));
  });
  out.push(row_(src, 'Shared — Total Shared Expenses', fmtCurrency_(c.shared.total), today));
  out.push(row_(src, 'Shared — Total Shared Savings', fmtCurrency_(c.shared.savings), today));
  out.push(row_(src, 'Shared — Total Take-Home', fmtCurrency_(c.totalTakeHome), today));
  out.push(row_(src, 'Shared — Total Left Over', fmtCurrency_(c.totalDisposable), today));
  return out;
}

// ============================================================
// TRANSACTIONS — category spend: current month vs last month
// ============================================================

/**
 * Reads the "Transactions" tab (Empower CSV format).
 * Groups spending by category for the two most recent complete months found in
 * the data (auto-detected — does NOT use today's date). This handles end-of-month
 * CSV uploads correctly: the latest month in the sheet is always a complete month.
 *
 * Outputs:
 *   1. One "Total Spending" row (latest month total vs prior month total)
 *   2. Top 10 categories sorted by latest-month spend (descending)
 *   3. One "Other (N categories)" bucket for the rest (if significant)
 *
 * All amounts formatted via fmtCurrency_() → "$1,234" style.
 *
 * Columns expected: Date | Account | Description | Category | Tags | Amount
 * Sign convention: positive = expense, negative = income/credit (skipped).
 *
 * Supports two sheet layouts (Issue #51):
 *   New: "Transactions - Ahmed" + "Transactions - Victoria" tabs (per-person)
 *   Legacy: single "Transactions" tab (backward compatible)
 */

/**
 * Reads one Transactions tab and returns rows tagged with the person's name.
 * Each returned row is [Date, Account, Description, Category, Tags, Amount, Person].
 * @param {GoogleAppsScript.Spreadsheet.Sheet|null} sheet
 * @param {string} person  e.g. 'Ahmed', 'Victoria', or '' for legacy
 * @return {Array[]}
 */
function readTransactionTab_(sheet, person) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var raw = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  return raw.map(function(row) { return row.concat([person]); });
}

function getTransactionSummaries_() {
  var id = veraSettingId_('TRANSACTIONS_SHEET_ID');
  if (!id) {
    Logger.log('Finance: TRANSACTIONS_SHEET_ID not set — skipping');
    return [];
  }

  var ss            = SpreadsheetApp.openById(id);
  var sheetAhmed    = ss.getSheetByName('Transactions - Ahmed');
  var sheetVictoria = ss.getSheetByName('Transactions - Victoria');
  var data;

  if (sheetAhmed || sheetVictoria) {
    // New format: per-person tabs — merge into one dataset (Issue #51)
    data = readTransactionTab_(sheetAhmed,    'Ahmed')
      .concat(readTransactionTab_(sheetVictoria, 'Victoria'));
    Logger.log('Finance: reading per-person tabs — Ahmed: ' +
      (sheetAhmed    ? sheetAhmed.getLastRow()    - 1 : 0) + ' rows, Victoria: ' +
      (sheetVictoria ? sheetVictoria.getLastRow() - 1 : 0) + ' rows');
  } else {
    // Legacy fallback: single "Transactions" tab
    var sheetLegacy = ss.getSheetByName('Transactions');
    data = readTransactionTab_(sheetLegacy, '');
    Logger.log('Finance: reading legacy "Transactions" tab — ' + data.length + ' rows');
  }

  if (data.length === 0) return [];

  // ---- Build skip list from Config tab (or fall back to hardcoded defaults) --------
  var cfg_     = getConfigValues();
  var skipRaw  = cfg_['finance_skip_categories'] || '';
  var skipList = skipRaw
    ? skipRaw.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean)
    : SKIP_CATEGORIES_DEFAULT_;

  Logger.log('Finance: skip list (' + skipList.length + '): ' + skipList.join(', '));

  // ---- Step 1: Parse into per-month buckets ----------------------------------------
  // Key: year * 100 + month (e.g. 202601 = Feb 2026) — sorts reliably numerically.
  var buckets = {};

  data.forEach(function(row) {
    var dateVal = row[0];
    var d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) return;

    var cat    = String(row[3] || 'Uncategorized').trim();
    var amount = parseFloat(String(row[5]).replace(/[$,]/g, ''));
    if (isNaN(amount) || amount >= 0) return; // skip income/credits/zero — positive = inbound
    amount = Math.abs(amount);               // convert expense (negative) to positive for summation
    if (skipList.indexOf(cat.toLowerCase()) !== -1) return;

    var monthKey = d.getFullYear() * 100 + d.getMonth();
    if (!buckets[monthKey]) buckets[monthKey] = { year: d.getFullYear(), month: d.getMonth(), spending: {} };
    buckets[monthKey].spending[cat] = (buckets[monthKey].spending[cat] || 0) + amount;
  });

  if (Object.keys(buckets).length === 0) return [];

  // ---- Step 2: Identify the two most recent months ---------------------------------
  // Always exclude the current calendar month — it's in-progress and will appear
  // sparse even if the CSV export happens to include a few early transactions.
  var _now = new Date();
  var currentMonthKey = _now.getFullYear() * 100 + _now.getMonth();
  delete buckets[currentMonthKey];

  if (Object.keys(buckets).length === 0) return [];

  var sortedKeys = Object.keys(buckets).map(Number).sort(function(a, b) { return a - b; });
  var latestKey  = sortedKeys[sortedKeys.length - 1];
  var prevKey    = sortedKeys.length >= 2 ? sortedKeys[sortedKeys.length - 2] : null;

  var latestInfo = buckets[latestKey];
  var curr       = latestInfo.spending;
  var prev       = prevKey ? buckets[prevKey].spending : {};

  var MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var currName = MONTHS[latestInfo.month];
  var prevName = prevKey ? MONTHS[buckets[prevKey].month] : null;
  var today    = todayStr_();
  var rows     = [];

  // ---- Step 3: Overall Total Spending row (first) ----------------------------------
  var totalCurr = Object.keys(curr).reduce(function(s, c) { return s + curr[c]; }, 0);
  var totalPrev = prevName
    ? Object.keys(prev).reduce(function(s, c) { return s + (prev[c] || 0); }, 0)
    : 0;

  var totalStr;
  if (totalPrev > 0) {
    var totalPct = Math.round(((totalCurr - totalPrev) / totalPrev) * 100);
    totalStr = fmtCurrency_(totalCurr) + ' full month' +
      ' vs ' + fmtCurrency_(totalPrev) + ' in ' + prevName +
      ' (' + (totalPct >= 0 ? '+' : '') + totalPct + '%)';
  } else {
    totalStr = fmtCurrency_(totalCurr) + ' (no prior month data)';
  }
  rows.push(row_(AUTO_PREFIX + ' Transactions', 'Total Spending — ' + currName, totalStr, today));

  // ---- Step 4: Sort categories by latest-month spend, take top 10 ------------------
  var TOP_N   = 10;
  var allCats = {};
  Object.keys(curr).forEach(function(c) { allCats[c] = true; });
  Object.keys(prev).forEach(function(c) { allCats[c] = true; });

  var catList = Object.keys(allCats).sort(function(a, b) {
    return (curr[b] || 0) - (curr[a] || 0); // descending by current spend
  });

  var topCats  = catList.slice(0, TOP_N);
  var restCats = catList.slice(TOP_N);

  // ---- Step 5: Per-category rows (top 10) ------------------------------------------
  topCats.forEach(function(cat) {
    var c = curr[cat] || 0;
    var p = prev[cat] || 0;
    var valueStr;
    if (p > 0) {
      var pct = Math.round(((c - p) / p) * 100);
      valueStr = fmtCurrency_(c) + ' vs ' + fmtCurrency_(p) + ' in ' + prevName +
        ' (' + (pct >= 0 ? '+' : '') + pct + '%)';
    } else {
      valueStr = fmtCurrency_(c) + ' (first month)';
    }
    rows.push(row_(AUTO_PREFIX + ' Transactions', cat + ' — ' + currName, valueStr, today));
  });

  // ---- Step 6: "Other" bucket for remaining categories -----------------------------
  if (restCats.length > 0) {
    var otherCurr = restCats.reduce(function(s, c) { return s + (curr[c] || 0); }, 0);
    var otherPrev = restCats.reduce(function(s, c) { return s + (prev[c] || 0); }, 0);
    if (otherCurr >= 5) {
      var otherPct = otherPrev > 0 ? Math.round(((otherCurr - otherPrev) / otherPrev) * 100) : null;
      var otherStr = fmtCurrency_(otherCurr) + ' across ' + restCats.length + ' other categories' +
        (otherPct !== null ? ' (' + (otherPct >= 0 ? '+' : '') + otherPct + '% vs ' + prevName + ')' : '');
      rows.push(row_(AUTO_PREFIX + ' Transactions',
        'Other (' + restCats.length + ' categories) — ' + currName, otherStr, today));
    }
  }

  Logger.log('Finance: Transactions — ' + currName + ' vs ' + (prevName || 'no prev') +
    ', ' + topCats.length + ' top cats + ' + restCats.length + ' other, total=' + rows.length);
  return rows;
}

// ============================================================
// UTILITIES
// ============================================================

/**
 * Scans a row array for the first non-zero numeric value starting at startCol.
 * Also parses strings like "$1,234" and "(500)" (negative parentheses notation).
 */
function findFirstNumericInRow_(row, startCol) {
  for (var c = startCol; c < row.length; c++) {
    var v = row[c];
    if (typeof v === 'number' && !isNaN(v) && v !== 0) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = parseFloat(v.replace(/[$,\s]/g, '').replace(/\(([^)]+)\)/, '-$1'));
      if (!isNaN(n) && n !== 0) return n;
    }
  }
  return null;
}

function fmtCurrency_(n) {
  return '$' + Number(Math.abs(n)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * A money amount with its SIGN, for anywhere the sign carries meaning.
 *
 * -$310.00, $1,430.00, $49.99 — minus before the dollar, two decimals, separators.
 *
 * Not fmtCurrency_ above: that one takes Math.abs and rounds to whole dollars, because
 * its callers (the Simple Ass Tracker rollups, the monthly spend comparison) convey
 * direction in the surrounding words. Handing a credit to it prints "$310", which reads
 * as money owed. Two formatters on purpose; neither is a bug.
 *
 * Replaces `' ($' + amount + ')'` at the bill call sites, which glued the dollar sign in
 * front of a raw number and so rendered a -310 credit as "$-310" in the morning email.
 *
 * @param {*} n  anything numeric; '' / null / NaN return '' so callers can test truthiness
 * @returns {string}
 */
function fmtMoney_(n) {
  if (n === '' || n === null || n === undefined) return '';
  var v = Number(n);
  if (!isFinite(v)) return '';
  return (v < 0 ? '-$' : '$') +
    Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Is this Bills row money coming IN rather than a bill to pay?
 *
 * The Bills tab's Type column is 'Expense' | 'Income' (blank means Expense — see
 * addBillTypeColumn in Code.js, which added the column to existing sheets). The
 * cash-flow projection has always honoured it; every surface that shows a bill to a
 * person or to Claude ignored it, so an Income row — a paycheck, per that function's
 * own docstring — was announced as a bill due today.
 *
 * One predicate rather than the literal repeated at four call sites: the same reason
 * dateCellToIso_ and googleApiNotEnabled_ are single implementations.
 *
 * @param {*} typeCell  the raw Type cell (BILL_HEADERS index 8)
 * @returns {boolean}
 */
function isIncomeBillRow_(typeCell) {
  return String(typeCell == null ? '' : typeCell).trim().toLowerCase() === 'income';
}

function toTitleCase_(str) {
  return str.replace(/\w\S*/g, function(w) {
    return w.charAt(0).toUpperCase() + w.substr(1).toLowerCase();
  });
}

// ============================================================
// DEBUG HELPERS — run once from Apps Script editor to verify
// ============================================================

function logFinanceData() {
  logSATData();
  logTransactionData();
}

function logSATData() {
  Logger.log('=== Simple Ass Tracker ===');
  var rows = getSATSummaries_();
  if (rows.length === 0) {
    Logger.log('No rows found. Check SAT_SHEET_ID is set and labels match.');
    Logger.log('→ Run debugSATLabels() to see the actual labels in your sheet.');
  } else {
    rows.forEach(function(r) { Logger.log(r[1] + ': ' + r[2]); });
  }
}

/**
 * Prints every non-empty label in the SAT label column so you can see
 * exactly what text appears in the sheet. Run this from the Apps Script
 * editor to diagnose why getSATSummaries_() finds 0 metrics.
 *
 * Copy the labels you want VERA to track and add them to the `targets`
 * object inside getSATSummaries_() (all lowercase).
 */
function debugSATLabels() {
  var t = bgReadTracker_();
  if (t.error) { Logger.log(t.error); return; }
  var m = budgetModel_(t.grid);
  Logger.log(m.ok ? 'Household Split reads: ' + m.people.map(function(p) { return p.name; }).join(' and ') + ', ' + m.bills.length + ' bills' + (m.missing.length ? '. Missing: ' + m.missing.join(', ') : '') : m.error);
}

function logTransactionData() {
  Logger.log('=== Transactions ===');
  var rows = getTransactionSummaries_();
  if (rows.length === 0) {
    Logger.log('No rows found. Check TRANSACTIONS_SHEET_ID is set and sheet has data.');
  } else {
    rows.forEach(function(r) { Logger.log(r[1] + ': ' + r[2]); });
  }
}
