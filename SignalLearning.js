// ============================================================
// VERA — SignalLearning.js
// Signal Learning Engine — Issue #24
// ============================================================
//
// Tracks flag engagement patterns over time to:
//   1. Suppress recurring noise (consistently snoozed/ignored flags)
//   2. Importance-score signals (weight by engagement history)
//   3. Feed suppression list into Claude.js nightly prompts
//
// SHEET TAB: 'SignalLearning'
// HEADERS: Key Pattern | Total Seen | Acknowledged | Snoozed |
//          Resolved | Expired/Ignored | Last Seen | Score | Suppressed
//
// HOW SCORES WORK:
//   score = 100
//   score -= snoozed   * 20  (user put off dealing with it)
//   score -= expired   * 15  (user never acted — silent dismissal)
//   score += ack       * 10  (user acknowledged — mild signal)
//   score += resolved  * 25  (user took action — strong signal)
//   score = clamp(0, 100)
//
// SUPPRESSION:
//   A pattern is suppressed if score < 25 AND total_seen >= 5.
//   Suppressed patterns are excluded from nightly prompts + Anticipator.
// ============================================================

var SIGNAL_LEARNING_TAB     = 'SignalLearning';
var SIGNAL_LEARNING_HEADERS = [
  'Key Pattern', 'Total Seen', 'Acknowledged', 'Snoozed',
  'Resolved', 'Expired/Ignored', 'Last Seen', 'Score', 'Suppressed'
];
var SIGNAL_SUPPRESSION_THRESHOLD       = 25;  // Score below this = noise
var SIGNAL_SUPPRESSION_MIN_SIGHTINGS   = 5;   // Minimum sightings before suppressing

// Column indices (0-based) for reading/writing
var SL_COL = {
  KEY_PATTERN:  0,
  TOTAL_SEEN:   1,
  ACKNOWLEDGED: 2,
  SNOOZED:      3,
  RESOLVED:     4,
  EXPIRED:      5,
  LAST_SEEN:    6,
  SCORE:        7,
  SUPPRESSED:   8
};

// ============================================================
// TAB SETUP
// ============================================================

/**
 * Creates the SignalLearning tab if it doesn't exist.
 * Called from setupVERA() and from recordFlagOutcome_() defensively.
 */
function ensureSignalLearningTab_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(SIGNAL_LEARNING_TAB);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SIGNAL_LEARNING_TAB);
  var headerRange = sheet.getRange(1, 1, 1, SIGNAL_LEARNING_HEADERS.length);
  headerRange.setValues([SIGNAL_LEARNING_HEADERS]);
  headerRange
    .setFontWeight('bold')
    .setBackground('#1a1a2e')
    .setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  Logger.log('SignalLearning: created tab.');
  return sheet;
}

// ============================================================
// KEY PATTERN EXTRACTION
// ============================================================

/**
 * Extracts a stable key pattern from a full flag key by stripping
 * date/sequence suffixes.
 *
 * Examples:
 *   verizon_bill_20260315   → verizon_bill
 *   task_neglect_TASK_0012  → task_neglect
 *   ergonomic_break_1234    → ergonomic_break
 *   goal_stall_GOAL20260101 → goal_stall
 *
 * @param {string} flagKey - Full flag key from the Flags sheet
 * @returns {string} Stable key pattern
 */
function extractKeyPattern_(flagKey) {
  if (!flagKey) return '';
  return String(flagKey)
    .toLowerCase()
    .replace(/_\d{4,}.*$/, '')      // Strip _YYYYMMDD... and similar numeric suffixes
    .replace(/[^a-z0-9_]/g, '_')   // Normalize non-alphanumeric to _
    .replace(/_+/g, '_')            // Collapse multiple underscores
    .replace(/^_|_$/g, '')          // Trim leading/trailing underscores
    .trim();
}

// ============================================================
// RECORD FUNCTIONS — called when events happen
// ============================================================

/**
 * Records that a flag was acted on (ack, snooze, resolve, or expired).
 * Updates the SignalLearning row for this pattern's key.
 * Creates the row if it doesn't exist yet.
 *
 * @param {string} flagKey - Key from the Flags sheet (column J)
 * @param {string} outcome - 'acknowledged' | 'snoozed' | 'resolved' | 'expired'
 */
function recordFlagOutcome_(flagKey, outcome) {
  if (!flagKey) return;
  var pattern = extractKeyPattern_(flagKey);
  if (!pattern) return;

  try {
    var sheet = ensureSignalLearningTab_();
    var row   = findOrCreateSignalRow_(sheet, pattern);

    // Increment the appropriate outcome counter
    switch (outcome) {
      case 'acknowledged':
        sheet.getRange(row, SL_COL.ACKNOWLEDGED + 1).setValue(
          (sheet.getRange(row, SL_COL.ACKNOWLEDGED + 1).getValue() || 0) + 1
        );
        break;
      case 'snoozed':
        sheet.getRange(row, SL_COL.SNOOZED + 1).setValue(
          (sheet.getRange(row, SL_COL.SNOOZED + 1).getValue() || 0) + 1
        );
        break;
      case 'resolved':
        sheet.getRange(row, SL_COL.RESOLVED + 1).setValue(
          (sheet.getRange(row, SL_COL.RESOLVED + 1).getValue() || 0) + 1
        );
        break;
      case 'expired':
        sheet.getRange(row, SL_COL.EXPIRED + 1).setValue(
          (sheet.getRange(row, SL_COL.EXPIRED + 1).getValue() || 0) + 1
        );
        break;
      default:
        Logger.log('SignalLearning: unknown outcome "' + outcome + '" for key ' + pattern);
        return;
    }

    // Update Last Seen
    var tz      = Session.getScriptTimeZone();
    var dateStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    sheet.getRange(row, SL_COL.LAST_SEEN + 1).setValue(dateStr);

    // Recompute score + suppressed
    recomputeSignalScore_(sheet, row);

    Logger.log('SignalLearning: recorded ' + outcome + ' for "' + pattern + '".');
  } catch (e) {
    Logger.log('SignalLearning: recordFlagOutcome_ error — ' + e.message);
  }
}

/**
 * Records that new flags were generated tonight (Total Seen bump).
 * Called from nightlyRun() after writeFlags().
 *
 * @param {Array<string>} flagKeys - Array of flag keys from the newly written flags
 */
function recordFlagsGenerated_(flagKeys) {
  if (!flagKeys || flagKeys.length === 0) return;

  try {
    var sheet = ensureSignalLearningTab_();
    var tz    = Session.getScriptTimeZone();
    var dateStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    // Deduplicate patterns so one nightly run doesn't inflate counts per batch
    var seen = {};
    flagKeys.forEach(function(key) {
      var pattern = extractKeyPattern_(key);
      if (pattern && !seen[pattern]) {
        seen[pattern] = true;
        var row = findOrCreateSignalRow_(sheet, pattern);
        sheet.getRange(row, SL_COL.TOTAL_SEEN + 1).setValue(
          (sheet.getRange(row, SL_COL.TOTAL_SEEN + 1).getValue() || 0) + 1
        );
        sheet.getRange(row, SL_COL.LAST_SEEN + 1).setValue(dateStr);
        recomputeSignalScore_(sheet, row);
      }
    });

    Logger.log('SignalLearning: recorded generation for ' + Object.keys(seen).length + ' distinct patterns.');
  } catch (e) {
    Logger.log('SignalLearning: recordFlagsGenerated_ error — ' + e.message);
  }
}

// ============================================================
// READ FUNCTIONS — called to retrieve intelligence
// ============================================================

/**
 * Returns a plain object mapping key patterns to their current scores.
 * Patterns with no data default to 100.
 *
 * @returns {Object} { pattern: score, ... }
 */
function getSignalScores_() {
  var scores = {};
  try {
    var sheet = ensureSignalLearningTab_();
    if (sheet.getLastRow() < 2) return scores;

    var numRows = sheet.getLastRow() - 1;
    var data    = sheet.getRange(2, 1, numRows, SIGNAL_LEARNING_HEADERS.length).getValues();

    data.forEach(function(row) {
      var pattern = String(row[SL_COL.KEY_PATTERN] || '').trim();
      var score   = parseFloat(row[SL_COL.SCORE] || 100);
      if (pattern) scores[pattern] = isNaN(score) ? 100 : score;
    });
  } catch (e) {
    Logger.log('SignalLearning: getSignalScores_ error — ' + e.message);
  }
  return scores;
}

/**
 * Returns an array of suppressed key patterns.
 * A pattern is suppressed if its score < 25 AND it has been seen >= 5 times.
 *
 * These are injected into the nightly Claude prompt and used to filter
 * Anticipator nudges before they are sent.
 *
 * @returns {Array<string>} List of suppressed key pattern strings
 */
function getSuppressedKeyPatterns_() {
  var suppressed = [];
  try {
    var sheet = ensureSignalLearningTab_();
    if (sheet.getLastRow() < 2) return suppressed;

    var numRows = sheet.getLastRow() - 1;
    var data    = sheet.getRange(2, 1, numRows, SIGNAL_LEARNING_HEADERS.length).getValues();

    data.forEach(function(row) {
      var pattern   = String(row[SL_COL.KEY_PATTERN] || '').trim();
      var isSuppressed = String(row[SL_COL.SUPPRESSED] || '').toLowerCase() === 'yes';
      if (pattern && isSuppressed) suppressed.push(pattern);
    });
  } catch (e) {
    Logger.log('SignalLearning: getSuppressedKeyPatterns_ error — ' + e.message);
  }
  return suppressed;
}

/**
 * Returns the top N key patterns by score (highest first).
 * Used to tell Claude what Ahmed engages with most.
 *
 * @param {number} n - Number of top patterns to return (default 5)
 * @returns {Array<{pattern, score}>}
 */
function getTopSignalPatterns_(n) {
  n = n || 5;
  var scores = getSignalScores_();
  var entries = Object.keys(scores).map(function(p) {
    return { pattern: p, score: scores[p] };
  });
  entries.sort(function(a, b) { return b.score - a.score; });
  return entries.slice(0, n);
}

// ============================================================
// SCORE COMPUTATION
// ============================================================

/**
 * Recomputes and writes back the Score and Suppressed columns for a row.
 * Called after any outcome is recorded.
 *
 * Score formula:
 *   score = 100 - (snoozed × 20) - (expired × 15) + (ack × 10) + (resolved × 25)
 *   Clamped to [0, 100].
 *
 * Suppressed = YES if score < SIGNAL_SUPPRESSION_THRESHOLD
 *              AND total_seen >= SIGNAL_SUPPRESSION_MIN_SIGHTINGS
 *
 * @param {Sheet} sheet  - The SignalLearning sheet
 * @param {number} rowNum - 1-based row number to recompute
 */
function recomputeSignalScore_(sheet, rowNum) {
  var rowData = sheet.getRange(rowNum, 1, 1, SIGNAL_LEARNING_HEADERS.length).getValues()[0];

  var totalSeen  = parseInt(rowData[SL_COL.TOTAL_SEEN]   || 0, 10);
  var ack        = parseInt(rowData[SL_COL.ACKNOWLEDGED]  || 0, 10);
  var snoozed    = parseInt(rowData[SL_COL.SNOOZED]       || 0, 10);
  var resolved   = parseInt(rowData[SL_COL.RESOLVED]      || 0, 10);
  var expired    = parseInt(rowData[SL_COL.EXPIRED]       || 0, 10);

  var score = 100 - (snoozed * 20) - (expired * 15) + (ack * 10) + (resolved * 25);
  score = Math.max(0, Math.min(100, score));

  var isSuppressed = (score < SIGNAL_SUPPRESSION_THRESHOLD && totalSeen >= SIGNAL_SUPPRESSION_MIN_SIGHTINGS)
    ? 'Yes' : 'No';

  sheet.getRange(rowNum, SL_COL.SCORE      + 1).setValue(score);
  sheet.getRange(rowNum, SL_COL.SUPPRESSED + 1).setValue(isSuppressed);
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Finds an existing row for a key pattern, or creates a new one.
 *
 * @param {Sheet}  sheet   - The SignalLearning sheet
 * @param {string} pattern - The key pattern to find/create
 * @returns {number} 1-based row number
 */
function findOrCreateSignalRow_(sheet, pattern) {
  if (sheet.getLastRow() >= 2) {
    var numRows = sheet.getLastRow() - 1;
    var keys    = sheet.getRange(2, 1, numRows, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === pattern) return i + 2;
    }
  }

  // Not found — append a new row
  var tz      = Session.getScriptTimeZone();
  var dateStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var newRow  = [pattern, 0, 0, 0, 0, 0, dateStr, 100, 'No'];
  sheet.appendRow(newRow);

  // Style the new data row (subtle blue-tint)
  var newRowNum = sheet.getLastRow();
  sheet.getRange(newRowNum, 1, 1, SIGNAL_LEARNING_HEADERS.length)
    .setBackground('#f0f4ff');

  return newRowNum;
}
