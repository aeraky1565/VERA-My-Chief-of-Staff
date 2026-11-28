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
  'Resolved', 'Expired/Ignored', 'Last Seen', 'Score', 'Suppressed',
  'Seen Since Acted', 'Last Acted', 'Kept Until', 'Quiet Since'
];
// Learning from being ignored (#260): every night a pattern is raised and nothing is done about it
// costs it SL_DRIFT_ points past the first SL_GRACE_ nights. Acknowledge, Resolve or Mute resets
// the count; a Snooze halves it. Suppressed is now one of:
//   No     — shown as usual
//   Quiet  — VERA quieted it: still raised and listed in Flags under "Quieted by VERA", but kept
//            out of the morning email; one tap ("Keep showing these") undoes it
//   Kept   — you asked to keep seeing it: not quieted again until Kept Until
//   Yes    — the old hard suppression (nothing sets it now; still honoured if a row has it)
var SL_GRACE_ = 7, SL_DRIFT_ = 2, SL_KEEP_DAYS_ = 60;
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
  SUPPRESSED:   8,
  SINCE_ACTED:  9,
  LAST_ACTED:   10,
  KEPT_UNTIL:   11,
  QUIET_SINCE:  12
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
  if (sheet) {
    // A tab made before #260 gains the new headers.
    try { if (sheet.getLastColumn() < SIGNAL_LEARNING_HEADERS.length) sheet.getRange(1, 1, 1, SIGNAL_LEARNING_HEADERS.length).setValues([SIGNAL_LEARNING_HEADERS]); } catch (e) {}
    return sheet;
  }

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
var SL_MONTHS_ = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december';
function extractKeyPattern_(flagKey) {
  if (!flagKey) return '';
  // Normalise first, so a date written gym-2026-03-22 is stripped like gym_20260322 (#260).
  var t = String(flagKey).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  t = t.replace(/_(19|20)\d{2}(_|$).*$/, '')          // _2026_03_22…, _2026…
       .replace(/_\d{4,}.*$/, '')                     // _20260322…, _1234
       .replace(new RegExp('_(' + SL_MONTHS_ + ')_\\d{1,2}(_.*)?$'), '')   // _march_15
       .replace(/_[a-z]*\d+[a-z\d]*$/, '');           // a trailing id (TASK_0012, oh_5)
  // The first two words name the kind of flag; what follows is the instance, so
  // cd_maturity_decision and cd_maturity_action, or amex_bilt_payment(s)_due, add up.
  return t.split('_').filter(Boolean).slice(0, 2).join('_');
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
  // One at a time (#242): a read-modify-write of the counters, and a row that may be created.
  return veraLocked_(function() { return slRecordFlagOutcome_(flagKey, outcome); });
}
function slRecordFlagOutcome_(flagKey, outcome) {
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
    // You did something with it: the ignored-nights count starts again (a Snooze halves it).
    if (outcome !== 'expired') {
      var since = slSinceActed_(sheet.getRange(row, 1, 1, SIGNAL_LEARNING_HEADERS.length).getValues()[0]);
      sheet.getRange(row, SL_COL.SINCE_ACTED + 1).setValue(outcome === 'snoozed' ? Math.floor(since / 2) : 0);
      sheet.getRange(row, SL_COL.LAST_ACTED + 1).setValue(dateStr);
    }

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
  return veraLocked_(function() { return slRecordFlagsGenerated_(flagKeys); });
}
function slRecordFlagsGenerated_(flagKeys) {
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
        var cur = sheet.getRange(row, 1, 1, SIGNAL_LEARNING_HEADERS.length).getValues()[0];
        sheet.getRange(row, SL_COL.TOTAL_SEEN + 1).setValue((parseInt(cur[SL_COL.TOTAL_SEEN], 10) || 0) + 1);
        sheet.getRange(row, SL_COL.SINCE_ACTED + 1).setValue(slSinceActed_(cur) + 1);   // another night raised
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
      var isSuppressed = String(row[SL_COL.SUPPRESSED] || '').toLowerCase() === 'yes';   // the old hard suppression only; Quiet still raises
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
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var r = slScore_(rowData, today);
  sheet.getRange(rowNum, SL_COL.SCORE + 1, 1, 2).setValues([[r.score, r.state]]);
  sheet.getRange(rowNum, SL_COL.SINCE_ACTED + 1).setValue(r.since);
  sheet.getRange(rowNum, SL_COL.QUIET_SINCE + 1).setValue(r.quietSince);
}

// ---- #260: learning from being ignored, and the soft quiet ------------------------------------

function slInt_(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function slYmd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var t = String(v == null ? '' : v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
}
/** Pure: nights raised since you last did something with it. A row from before #260 has none: estimate it. */
function slSinceActed_(row) {
  var v = row[SL_COL.SINCE_ACTED];
  if (v !== '' && v != null && !isNaN(parseInt(v, 10))) return slInt_(v);
  var acted = slInt_(row[SL_COL.ACKNOWLEDGED]) + slInt_(row[SL_COL.SNOOZED]) + slInt_(row[SL_COL.RESOLVED]);
  return Math.max(0, slInt_(row[SL_COL.TOTAL_SEEN]) - 3 * acted);
}
/**
 * Pure: a row's score and state.
 *   score = 100 − 20·snoozed − 15·expired + 10·acknowledged + 25·resolved
 *           − SL_DRIFT_ · (nights raised since you last acted − SL_GRACE_), clamped 0…100
 *   state = Kept while Kept Until hasn't passed; Yes stays Yes; Quiet when the score is under 25
 *           after at least 5 sightings; else No.
 */
function slScore_(row, today) {
  var total = slInt_(row[SL_COL.TOTAL_SEEN]), since = slSinceActed_(row);
  var score = 100 - slInt_(row[SL_COL.SNOOZED]) * 20 - slInt_(row[SL_COL.EXPIRED]) * 15 + slInt_(row[SL_COL.ACKNOWLEDGED]) * 10 + slInt_(row[SL_COL.RESOLVED]) * 25
            - SL_DRIFT_ * Math.max(0, since - SL_GRACE_);
  score = Math.max(0, Math.min(100, score));
  var prev = String(row[SL_COL.SUPPRESSED] || '').trim(), kept = slYmd_(row[SL_COL.KEPT_UNTIL]);
  var state = kept && kept >= today ? 'Kept' : prev.toLowerCase() === 'yes' ? 'Yes'
            : score < SIGNAL_SUPPRESSION_THRESHOLD && total >= SIGNAL_SUPPRESSION_MIN_SIGHTINGS ? 'Quiet' : 'No';
  var quietSince = state === 'Quiet' ? (prev === 'Quiet' && slYmd_(row[SL_COL.QUIET_SINCE]) ? slYmd_(row[SL_COL.QUIET_SINCE]) : today) : '';
  return { score: score, state: state, since: since, quietSince: quietSince };
}
/** Pure: is this flag key one of the quieted patterns? */
function slIsQuietKey_(key, quiet) { return !!key && (quiet || []).indexOf(extractKeyPattern_(key)) !== -1; }
/** Pure: a pattern as words: pto_burn → "PTO burn". */
function slLabel_(p) {
  var w = String(p || '').split('_').map(function(x) { return /^(pto|cd|hoa|tax|usps|gym|amex|aqi)$/.test(x) && x.length <= 4 && x !== 'gym' && x !== 'tax' ? x.toUpperCase() : x; });
  var t = w.join(' '); return t.charAt(0).toUpperCase() + t.slice(1);
}
/** Pure: the sentence that says why VERA quieted a pattern. */
function slWhy_(r) {
  var bits = ['Raised ' + r.seen + ' time' + (r.seen === 1 ? '' : 's') + (r.firstSeen ? ' since ' + r.firstSeen : '')];
  bits.push(r.lastActed ? 'nothing done with it in the last ' + r.since + ' (last on ' + r.lastActed + ')' : 'you’ve never acted on it');
  return bits.join('; ') + '.';
}
function slRows_() {
  var sheet = ensureSignalLearningTab_();
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, SIGNAL_LEARNING_HEADERS.length).getValues();
}
/** The patterns VERA has quieted (still raised; kept out of the morning email). */
function getQuietPatterns_() {
  try { return slRows_().filter(function(r) { return String(r[SL_COL.SUPPRESSED]).trim() === 'Quiet'; }).map(function(r) { return String(r[SL_COL.KEY_PATTERN]).trim(); }); }
  catch (e) { Logger.log('SignalLearning: getQuietPatterns_ error — ' + e.message); return []; }
}
/** Pure: the rows as the What VERA learned panel shows them. */
function slLearned_(rows, today) {
  var all = (rows || []).filter(function(r) { return String(r[SL_COL.KEY_PATTERN] || '').trim(); }).map(function(r) {
    var x = { pattern: String(r[SL_COL.KEY_PATTERN]).trim(), seen: slInt_(r[SL_COL.TOTAL_SEEN]), since: slSinceActed_(r), acted: slInt_(r[SL_COL.ACKNOWLEDGED]) + slInt_(r[SL_COL.RESOLVED]) + slInt_(r[SL_COL.SNOOZED]),
      score: slInt_(r[SL_COL.SCORE]), state: String(r[SL_COL.SUPPRESSED] || 'No').trim() || 'No', lastSeen: slYmd_(r[SL_COL.LAST_SEEN]), lastActed: slYmd_(r[SL_COL.LAST_ACTED]),
      keptUntil: slYmd_(r[SL_COL.KEPT_UNTIL]), quietSince: slYmd_(r[SL_COL.QUIET_SINCE]) };
    x.label = slLabel_(x.pattern); x.why = slWhy_(x);
    return x;
  });
  var weekAgo = new Date(Date.parse(today + 'T00:00:00Z') - 7 * 86400000).toISOString().slice(0, 10);
  return {
    quiet: all.filter(function(x) { return x.state === 'Quiet'; }).sort(function(a, b) { return b.seen - a.seen; }),
    kept: all.filter(function(x) { return x.state === 'Kept'; }),
    engaged: all.filter(function(x) { return x.acted > 0 && x.state !== 'Quiet'; }).sort(function(a, b) { return b.acted - a.acted || b.score - a.score; }).slice(0, 5),
    newThisWeek: all.filter(function(x) { return x.state === 'Quiet' && x.quietSince >= weekAgo; }),
    patterns: all.length };
}
/** GET signal_learned → what VERA has quieted, what you asked to keep, what you engage with most. */
function webSignalLearned_() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var out = slLearned_(slRows_(), today); out.ok = true;
  // Receipt groups and seasons per item, and the card per store (Learning.js).
  if (typeof rlLearnedLists_ === 'function') { try { var rl = rlLearnedLists_(rlItems_(), rlCards_()); out.receipts = rl.items; out.cards = rl.cards; } catch (e) { out.receipts = []; out.cards = []; } }
  return out;
}
/** GET signal_keep — pattern: keep showing it (not quieted again for SL_KEEP_DAYS_ days). */
function webSignalKeep_(e) { return slSetKept_(e, true); }
/** GET signal_auto — pattern: let VERA decide again. */
function webSignalAuto_(e) { return slSetKept_(e, false); }
function slSetKept_(e, keep) {
  var p = String(((e && e.parameter) || e || {}).pattern || '').trim();
  if (!p) throw new Error('pattern required');
  return veraLocked_(function() {
    var sheet = ensureSignalLearningTab_(), n = sheet.getLastRow();
    var keys = n >= 2 ? sheet.getRange(2, 1, n - 1, 1).getValues() : [];
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() !== p) continue;
      var tz = Session.getScriptTimeZone();
      var until = keep ? Utilities.formatDate(new Date(Date.now() + SL_KEEP_DAYS_ * 86400000), tz, 'yyyy-MM-dd') : '';
      sheet.getRange(i + 2, SL_COL.KEPT_UNTIL + 1).setValue(until);
      if (keep) { sheet.getRange(i + 2, SL_COL.SINCE_ACTED + 1).setValue(0); sheet.getRange(i + 2, SL_COL.SUPPRESSED + 1).setValue('No'); }
      recomputeSignalScore_(sheet, i + 2);
      var row = sheet.getRange(i + 2, 1, 1, SIGNAL_LEARNING_HEADERS.length).getValues()[0];
      return { ok: true, pattern: p, state: String(row[SL_COL.SUPPRESSED]), keptUntil: until };
    }
    return { ok: false, error: 'VERA hasn’t learned anything about that one' };
  });
}
/**
 * Pure: the old rows merged under today's patterns (dates and ids stripped, the first two words).
 * → [{ pattern, from: [old patterns], row }] for each pattern that more than one old row maps to,
 * plus singles whose name changes. Counts add up; Last Seen and Last Acted keep the latest.
 */
function slRegroupPlan_(rows, today) {
  var by = {}, order = [];
  (rows || []).forEach(function(r) {
    var old = String(r[SL_COL.KEY_PATTERN] || '').trim(); if (!old) return;
    var np = extractKeyPattern_(old) || old;
    if (!by[np]) { by[np] = { pattern: np, from: [], rows: [] }; order.push(np); }
    by[np].from.push(old); by[np].rows.push(r);
  });
  return order.map(function(np) {
    var g = by[np], m = [np, 0, 0, 0, 0, 0, '', 100, 'No', 0, '', '', ''];
    var max = function(a, b) { return a > b ? a : b; };
    g.rows.forEach(function(r) {
      [SL_COL.TOTAL_SEEN, SL_COL.ACKNOWLEDGED, SL_COL.SNOOZED, SL_COL.RESOLVED, SL_COL.EXPIRED].forEach(function(c) { m[c] += slInt_(r[c]); });
      m[SL_COL.LAST_SEEN] = max(m[SL_COL.LAST_SEEN], slYmd_(r[SL_COL.LAST_SEEN]));
      m[SL_COL.LAST_ACTED] = max(m[SL_COL.LAST_ACTED], slYmd_(r[SL_COL.LAST_ACTED]));
      m[SL_COL.KEPT_UNTIL] = max(m[SL_COL.KEPT_UNTIL], slYmd_(r[SL_COL.KEPT_UNTIL]));
      if (String(r[SL_COL.SUPPRESSED]).trim().toLowerCase() === 'yes') m[SL_COL.SUPPRESSED] = 'Yes';
    });
    m[SL_COL.SINCE_ACTED] = g.rows.reduce(function(n, r) { return n + slSinceActed_(r); }, 0);
    var sc = slScore_(m, today); m[SL_COL.SCORE] = sc.score; m[SL_COL.SUPPRESSED] = sc.state; m[SL_COL.QUIET_SINCE] = sc.quietSince;
    return { pattern: np, from: g.from, row: m, merged: g.from.length > 1 || g.from[0] !== np };
  });
}
/** GET signal_regroup — dry (default true): the merges, written only with dry=false. */
function webSignalRegroup_(e) {
  var p = (e && e.parameter) || {}, dry = String(p.dry) !== 'false';
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return veraLocked_(function() {
    var rows = slRows_(), plan = slRegroupPlan_(rows, today);
    var out = { ok: true, dry: dry, before: rows.length, after: plan.length,
      merges: plan.filter(function(x) { return x.merged; }).map(function(x) { return { pattern: x.pattern, from: x.from, state: x.row[SL_COL.SUPPRESSED], score: x.row[SL_COL.SCORE] }; }) };
    if (dry) return out;
    var sheet = ensureSignalLearningTab_();
    if (sheet.getLastRow() >= 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, SIGNAL_LEARNING_HEADERS.length).clearContent();
    if (plan.length) sheet.getRange(2, 1, plan.length, SIGNAL_LEARNING_HEADERS.length).setValues(plan.map(function(x) { return x.row; }));
    if (sheet.getLastRow() > plan.length + 1) sheet.deleteRows(plan.length + 2, sheet.getLastRow() - plan.length - 1);
    return out;
  });
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
