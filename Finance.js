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

// Categories to skip when calculating spending (income, transfers, etc.)
var SKIP_CATEGORIES_ = [
  'income', 'paycheck', 'salary', 'direct deposit',
  'transfer', 'credit card payment', 'payment',
  'investments', 'savings', 'refund',
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
// SIMPLE ASS TRACKER — budget metrics
// ============================================================

/**
 * Reads the "Tracker" tab in the Simple Ass Tracker sheet.
 * Uses a label-search approach: scans every cell for known metric labels
 * and tracks section context (Ahmed / Victoria / Shared) from headers.
 * Returns one summary row per metric found.
 */
function getSATSummaries_() {
  var id = PropertiesService.getScriptProperties().getProperty('SAT_SHEET_ID');
  if (!id) {
    Logger.log('Finance: SAT_SHEET_ID not set in Script Properties — skipping');
    return [];
  }

  var sheet = SpreadsheetApp.openById(id).getSheetByName('Tracker');
  if (!sheet) {
    Logger.log('Finance: SAT tab "Tracker" not found');
    return [];
  }

  var data  = sheet.getDataRange().getValues();
  var today = todayStr_();

  // Metric labels to search for (lowercase)
  var targets = {
    'net income':                      true,
    'net expenses':                    true,
    'disposable income':               true,
    'total shared expenses':           true,
    'total shared savings':            true,
    'total shared net income':         true,
    'total shared disposable income':  true,
  };

  var results        = [];
  var currentSection = '';
  var found          = {}; // "section|metric" → true, prevents duplicate rows

  for (var r = 0; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      var cell    = String(data[r][c] || '').trim();
      var cellLow = cell.toLowerCase();

      // Detect person/section header
      if (cellLow === 'ahmed')                                         { currentSection = 'Ahmed';    continue; }
      if (cellLow === 'victoria')                                      { currentSection = 'Victoria'; continue; }
      if (cellLow === 'shared' || cellLow === 'household' || cellLow === 'joint') { currentSection = 'Shared';   continue; }

      if (!targets[cellLow]) continue;

      // Dedup: same label in same section only counted once
      var dedupKey = currentSection + '|' + cellLow;
      if (found[dedupKey]) continue;

      // Look for first non-zero numeric value to the right in the same row
      var value = findFirstNumericInRow_(data[r], c + 1);
      if (value === null) continue;

      found[dedupKey] = true;

      var metricLabel = currentSection
        ? currentSection + ' — ' + toTitleCase_(cell)
        : toTitleCase_(cell);

      results.push(row_(AUTO_PREFIX + ' Simple Ass Tracker', metricLabel, fmtCurrency_(value), today));
    }
  }

  Logger.log('Finance: SAT found ' + results.length + ' metrics');
  return results;
}

// ============================================================
// TRANSACTIONS — category spend: current month vs last month
// ============================================================

/**
 * Reads the "Transactions" tab (Empower CSV format).
 * Groups spending by category, calculates current month vs last month totals.
 * Returns one summary row per category with delta % for Claude to assess.
 *
 * Columns expected: Date | Account | Description | Category | Tags | Amount
 * Sign convention: positive = expense, negative = income/credit (skipped).
 */
function getTransactionSummaries_() {
  var id = PropertiesService.getScriptProperties().getProperty('TRANSACTIONS_SHEET_ID');
  if (!id) {
    Logger.log('Finance: TRANSACTIONS_SHEET_ID not set — skipping');
    return [];
  }

  var sheet = SpreadsheetApp.openById(id).getSheetByName('Transactions');
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();

  var now       = new Date();
  var thisMonth = now.getMonth();
  var thisYear  = now.getFullYear();
  var lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
  var lastYear  = thisMonth === 0 ? thisYear - 1 : thisYear;

  var curr = {}; // category → total spend this month
  var prev = {}; // category → total spend last month

  data.forEach(function(row) {
    var dateVal = row[0];
    var d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) return;

    var cat    = String(row[3] || 'Uncategorized').trim();
    var amount = parseFloat(String(row[5]).replace(/[$,]/g, ''));

    if (isNaN(amount) || amount <= 0) return; // skip income/credits/zero
    if (SKIP_CATEGORIES_.indexOf(cat.toLowerCase()) !== -1) return;

    var m = d.getMonth();
    var y = d.getFullYear();

    if (m === thisMonth && y === thisYear)     { curr[cat] = (curr[cat] || 0) + amount; }
    else if (m === lastMonth && y === lastYear) { prev[cat] = (prev[cat] || 0) + amount; }
  });

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var currName = MONTHS[thisMonth];
  var today    = todayStr_();
  var rows     = [];

  // All categories from either month, sorted alphabetically
  var allCats = {};
  Object.keys(curr).forEach(function(c) { allCats[c] = true; });
  Object.keys(prev).forEach(function(c) { allCats[c] = true; });

  Object.keys(allCats).sort().forEach(function(cat) {
    var c = curr[cat] || 0;
    var p = prev[cat] || 0;

    var valueStr;
    if (p > 0) {
      var pct = Math.round(((c - p) / p) * 100);
      valueStr = '$' + Math.round(c) + ' vs $' + Math.round(p) + ' prev mo (' + (pct >= 0 ? '+' : '') + pct + '%)';
    } else {
      valueStr = '$' + Math.round(c) + ' (new this month)';
    }

    rows.push(row_(AUTO_PREFIX + ' Transactions', cat + ' — ' + currName, valueStr, today));
  });

  Logger.log('Finance: Transactions found ' + rows.length + ' categories');
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
  } else {
    rows.forEach(function(r) { Logger.log(r[1] + ': ' + r[2]); });
  }
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
