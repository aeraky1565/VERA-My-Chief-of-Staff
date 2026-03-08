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
 *
 * Handles two common layouts automatically:
 *
 *   HORIZONTAL (column-per-person):
 *     Row N:   [Label col]  [Ahmed]      [Victoria]
 *     Row N+1: Net Income   $5,000       $4,000
 *     → Ahmed and Victoria appear as column headers in the SAME row.
 *     → Values are read from each person's column for every metric row.
 *
 *   VERTICAL (section-per-person):
 *     Row 5:  Ahmed          ← section header row
 *     Row 6:  Net Income  $5,000
 *     Row 12: Victoria       ← section header row
 *     Row 13: Net Income  $4,000
 *     → Each person's header appears alone in its own row above their metrics.
 *
 * Returns one summary row per (person × metric) combination found.
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

  var results  = [];
  var usedKeys = {}; // "section|metric" → true, prevents duplicates

  // ---- Detect layout: horizontal (column headers) vs vertical (row headers) ----
  // Horizontal is detected when 2+ section names appear in the SAME row.
  var sectionCols  = {}; // { 'Ahmed': colIdx, 'Victoria': colIdx } — horizontal only
  var headerRowIdx = -1;

  for (var r = 0; r < data.length; r++) {
    var rowSections = {};
    for (var c = 0; c < data[r].length; c++) {
      var v = String(data[r][c] || '').trim().toLowerCase();
      if      (v === 'ahmed')                                          rowSections['Ahmed']    = c;
      else if (v === 'victoria')                                       rowSections['Victoria'] = c;
      else if (v === 'shared' || v === 'household' || v === 'joint')  rowSections['Shared']   = c;
    }
    if (Object.keys(rowSections).length >= 2) {
      sectionCols  = rowSections;
      headerRowIdx = r;
      break;
    }
  }

  if (headerRowIdx !== -1) {
    // ======================================================
    // HORIZONTAL LAYOUT — sections are column headers
    // ======================================================
    // Each section (Ahmed, Victoria, Shared) may span multiple columns
    // (e.g. Ahmed = B–C, Shared = E–G, Victoria = I–J).
    // We compute each section's column RANGE as [startCol, nextSectionStartCol).
    // For each metric row we scan the full range and take the first non-zero value.

    var sectionColIndices = Object.keys(sectionCols).map(function(s) { return sectionCols[s]; });
    var minSectionCol     = Math.min.apply(null, sectionColIndices);
    var labelCol          = minSectionCol > 0 ? minSectionCol - 1 : 0;

    // Build ranges: sort sections by their start column, then each range ends
    // where the next section begins (or at the last column of the sheet).
    var sortedSections = Object.keys(sectionCols).sort(function(a, b) {
      return sectionCols[a] - sectionCols[b];
    });
    var sectionRanges = {}; // { 'Ahmed': { start: 1, end: 4 }, ... }
    for (var i = 0; i < sortedSections.length; i++) {
      var sec   = sortedSections[i];
      var start = sectionCols[sec];
      var end   = (i + 1 < sortedSections.length)
        ? sectionCols[sortedSections[i + 1]]
        : (data[headerRowIdx] ? data[headerRowIdx].length : start + 3);
      sectionRanges[sec] = { start: start, end: end };
    }

    Logger.log('Finance: SAT horizontal layout — ranges: ' + JSON.stringify(sectionRanges) + ', label col: ' + labelCol);

    for (var r = headerRowIdx + 1; r < data.length; r++) {
      var label    = String(data[r][labelCol] || '').trim();
      var labelLow = label.toLowerCase();
      if (!targets[labelLow]) continue;

      Object.keys(sectionRanges).forEach(function(section) {
        var range = sectionRanges[section];
        // Scan the section's full column range for the first non-zero numeric value
        var n = null;
        for (var c = range.start; c < range.end; c++) {
          var raw    = data[r][c];
          var parsed = typeof raw === 'number'
            ? raw
            : parseFloat(String(raw || '').replace(/[$,\s]/g, '').replace(/\(([^)]+)\)/, '-$1'));
          if (!isNaN(parsed) && parsed !== 0) { n = parsed; break; }
        }
        if (n === null) return;

        var key = section + '|' + labelLow;
        if (usedKeys[key]) return;
        usedKeys[key] = true;

        results.push(row_(AUTO_PREFIX + ' Simple Ass Tracker',
          section + ' — ' + toTitleCase_(label), fmtCurrency_(n), today));
      });
    }

  } else {
    // ======================================================
    // VERTICAL LAYOUT — each section header in its own row
    // ======================================================
    Logger.log('Finance: SAT vertical layout detected — scanning row by row');

    var currentSection = '';

    for (var r = 0; r < data.length; r++) {
      for (var c = 0; c < data[r].length; c++) {
        var cell    = String(data[r][c] || '').trim();
        var cellLow = cell.toLowerCase();

        if      (cellLow === 'ahmed')                                          { currentSection = 'Ahmed';    continue; }
        else if (cellLow === 'victoria')                                       { currentSection = 'Victoria'; continue; }
        else if (cellLow === 'shared' || cellLow === 'household' || cellLow === 'joint') { currentSection = 'Shared'; continue; }

        if (!targets[cellLow]) continue;

        var key = currentSection + '|' + cellLow;
        if (usedKeys[key]) continue;

        var value = findFirstNumericInRow_(data[r], c + 1);
        if (value === null) continue;

        usedKeys[key] = true;
        var metricLabel = currentSection
          ? currentSection + ' — ' + toTitleCase_(cell)
          : toTitleCase_(cell);
        results.push(row_(AUTO_PREFIX + ' Simple Ass Tracker', metricLabel, fmtCurrency_(value), today));
      }
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
  var id = PropertiesService.getScriptProperties().getProperty('SAT_SHEET_ID');
  if (!id) { Logger.log('SAT_SHEET_ID not set.'); return; }

  var sheet = SpreadsheetApp.openById(id).getSheetByName('Tracker');
  if (!sheet) { Logger.log('Tab "Tracker" not found.'); return; }

  var data = sheet.getDataRange().getValues();

  // Find header row (where Ahmed/Victoria appear in same row)
  var headerRowIdx = -1;
  var sectionCols  = {};
  for (var r = 0; r < data.length; r++) {
    var rowSections = {};
    for (var c = 0; c < data[r].length; c++) {
      var v = String(data[r][c] || '').trim().toLowerCase();
      if      (v === 'ahmed')                                         rowSections['Ahmed']    = c;
      else if (v === 'victoria')                                      rowSections['Victoria'] = c;
      else if (v === 'shared' || v === 'household' || v === 'joint') rowSections['Shared']   = c;
    }
    if (Object.keys(rowSections).length >= 2) { sectionCols = rowSections; headerRowIdx = r; break; }
  }

  if (headerRowIdx === -1) {
    Logger.log('Could not detect a header row with 2+ section names (Ahmed/Victoria/Shared).');
    Logger.log('Dumping all non-empty column A values:');
    for (var r = 0; r < data.length; r++) {
      var v = String(data[r][0] || '').trim();
      if (v) Logger.log('  Row ' + (r + 1) + ': "' + v + '"');
    }
    return;
  }

  // Determine label column (left of the first section column)
  var minSectionCol = Math.min.apply(null, Object.keys(sectionCols).map(function(s) { return sectionCols[s]; }));
  var labelCol = minSectionCol > 0 ? minSectionCol - 1 : 0;

  Logger.log('Header row: ' + (headerRowIdx + 1) + ' | Sections: ' + JSON.stringify(sectionCols) + ' | Label col: ' + labelCol);
  Logger.log('--- Labels found after header row (col ' + labelCol + ') ---');
  for (var r = headerRowIdx + 1; r < data.length; r++) {
    var label = String(data[r][labelCol] || '').trim();
    if (label) Logger.log('  Row ' + (r + 1) + ': "' + label + '"  (lowercase: "' + label.toLowerCase() + '")');
  }
  Logger.log('--- End of labels ---');
  Logger.log('Add the ones you want to the targets{} object in getSATSummaries_() (all lowercase).');
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
