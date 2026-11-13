// ============================================================
// VERA — TripIds.js  (issue #239, phase 1)
// A Trip ID column on every trip-keyed tab, kept filled.
// ============================================================
//
// Every trip has a permanent Trip ID in the Trips registry (Trips.js), but the
// trip tabs key their rows by "startDate|label". Readers cope through
// tripKeyMatches_ / tripKeysFor_ and the registry's aliases. Phase 1 gives each of
// those tabs a "Trip ID" column, as the LAST header in its constant (Code.js), so:
//
//   - fixed-width writers write it (tripIdCell_, Trips.js; blank when the key
//     doesn't resolve yet), and rows appended short leave it blank;
//   - tripIdStampAll_ fills every blank Trip ID whose key resolves. It runs in the
//     nightly run, right after legacy keys are adopted, and by hand as the first
//     backfill: backfillTripIds();
//   - it never overwrites an ID that is there. An ID that disagrees with its key
//     is reported, not changed: from phase 2 the ID is the source of truth;
//   - it writes only the Trip ID column (one setValues per tab, and only when
//     something changed), plus the header cell when it is blank.
//
// Readers still match by key in phase 1; phase 2 switches them to the ID.
//
// Two layers: tidFill_ (pure) and tripIdStampAll_ (the reads and the writes).
// ============================================================

// Each trip tab, its header constant, and the column holding its Trip Key.
function tidTabs_() {
  return [
    { tab: TABS.ITINERARY,            headers: ITINERARY_HEADERS },
    { tab: TABS.TRIP_META,            headers: TRIP_META_HEADERS },
    { tab: TABS.PACKING_ITEMS,        headers: PACKING_ITEM_HEADERS },
    { tab: TABS.TRIP_BUDGET,          headers: TRIP_BUDGET_HEADERS },
    { tab: TABS.TRIP_GIFTS,           headers: TRIP_GIFT_HEADERS },
    { tab: TABS.TRIP_OUTFITS,         headers: TRIP_OUTFIT_HEADERS },
    { tab: TABS.PACKING_REVIEWS,      headers: PACKING_REVIEW_HEADERS },
    { tab: TABS.LEAVE_RUNS,           headers: LEAVE_RUN_HEADERS },
    { tab: TABS.TRIP_RECOMMENDATIONS, headers: TRIP_RECS_HEADERS },
    { tab: TABS.TRIP_DECISIONS,       headers: TRIP_DECISION_HEADERS },
  ];
}

/**
 * Pure: the Trip ID column after filling. rows: the tab's data rows; keyCol and
 * idCol are zero-based; resolve(key) → id or ''. → { ids: [[id]…], filled, mismatched }.
 * Blank IDs whose key resolves are filled; existing IDs are kept, and counted as
 * mismatched when their key now resolves to another trip.
 */
function tidFill_(rows, keyCol, idCol, resolve) {
  var memo = {}, filled = 0, mismatched = 0;
  var res = function(k) { if (!(k in memo)) { var v = ''; try { v = String(resolve(k) || '').toUpperCase(); } catch (e) { v = ''; } memo[k] = v; } return memo[k]; };
  var ids = (rows || []).map(function(row) {
    var key = String(row[keyCol] == null ? '' : row[keyCol]).trim();
    var id  = String(row[idCol] == null ? '' : row[idCol]).trim();
    if (!key) return [id];
    var want = res(key);
    if (!id) { if (want) { filled++; return [want]; } return ['']; }
    if (want && want !== id.toUpperCase()) mismatched++;
    return [id];
  });
  return { ids: ids, filled: filled, mismatched: mismatched };
}

/**
 * Fills blank Trip IDs on every trip tab. → { tabs: [{tab, filled, mismatched, skipped}], filled }
 * A tab whose Trip ID header cell holds something else is skipped and reported,
 * never written: that would mean a column was moved by hand.
 */
function tripIdStampAll_() {
  var ss = getSpreadsheet(), out = { tabs: [], filled: 0, mismatched: 0 };
  tidTabs_().forEach(function(t) {
    var sh = ss.getSheetByName(t.tab);
    if (!sh) return;
    var width = t.headers.length, idCol = width - 1, keyCol = t.headers.indexOf('Trip Key');
    if (keyCol === -1 || t.headers[idCol] !== 'Trip ID') return;
    var head = String(sh.getRange(1, width).getValue() || '').trim();
    if (head && head !== 'Trip ID') {
      out.tabs.push({ tab: t.tab, skipped: 'column ' + width + ' is "' + head + '", not Trip ID' });
      Logger.log('tripIdStampAll_: ' + t.tab + ' skipped — column ' + width + ' holds "' + head + '"');
      return;
    }
    if (!head) sh.getRange(1, width).setValue('Trip ID');
    if (sh.getLastRow() < 2) { out.tabs.push({ tab: t.tab, filled: 0, mismatched: 0 }); return; }
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
    var r = tidFill_(rows, keyCol, idCol, tripIdForKey_);
    if (r.filled) sh.getRange(2, width, r.ids.length, 1).setValues(r.ids);
    out.tabs.push({ tab: t.tab, filled: r.filled, mismatched: r.mismatched });
    out.filled += r.filled; out.mismatched += r.mismatched;
  });
  Logger.log('tripIdStampAll_: ' + out.filled + ' Trip ID(s) filled' + (out.mismatched ? ', ' + out.mismatched + ' that disagree with their key (left as they are)' : ''));
  return out;
}

/**
 * Run by hand from the Apps Script editor, once, after the release that adds the
 * Trip ID columns (make a backup copy of the sheet first). After that the nightly
 * run keeps new rows filled. Safe to run again.
 */
function backfillTripIds() {
  return tripIdStampAll_();
}

// ---- one-time repair: TripMeta's header row (Nov 13) ---------------------------
//
// The live TripMeta header row had drifted from TRIP_META_HEADERS: columns 6–10
// blank, "Trip Budget" and "Trip Travellers" in 11–12, and a second set of labels
// in 13–17 that ensureTripMetaColumns_ used to append. Everything reads TripMeta by
// position, except the budget writer, which looked columns up by name. So a
// traveller count could land in column 12 (where the Trip ID belongs) and a budget
// in column 11 (over Characteristics). The backfill then rightly refused to write
// Trip IDs into a column that didn't say "Trip ID".

/**
 * Pure: what the repair would do. header: row 1; rows: rows 2+ (any width).
 * → { ok, why, header, moves: [{row, from, to}], clears: [{row, col}], extraCols }
 * Columns are 1-based. Refuses (ok: false) if any row has data past column 12,
 * since that would be data the repair doesn't understand.
 */
function tmRepairPlan_(header, rows) {
  var W = TRIP_META_HEADERS.length, BUDGET = 6, TRAV = 7, CHAR = 11, TID = W;
  var out = { ok: true, why: '', header: TRIP_META_HEADERS.slice(), moves: [], clears: [], extraCols: 0 };
  var isNum = function(v) { return v !== '' && v != null && !isNaN(Number(v)) && String(v).trim() !== ''; };
  out.extraCols = Math.max(0, (header || []).length - W);
  for (var i = 0; i < (rows || []).length; i++) {
    var r = rows[i] || [];
    for (var c = W; c < r.length; c++) {
      if (String(r[c] == null ? '' : r[c]).trim() !== '') {
        return { ok: false, why: 'row ' + (i + 2) + ' has data in column ' + (c + 1) + ', past Trip ID; nothing changed', moves: [], clears: [], header: out.header, extraCols: out.extraCols };
      }
    }
    var at = function(col) { var v = r[col - 1]; return v == null ? '' : v; };
    // A traveller count written by name into the Trip ID column.
    if (isNum(at(TID))) {
      if (String(at(TRAV)).trim() === '') out.moves.push({ row: i + 2, from: TID, to: TRAV });
      else out.clears.push({ row: i + 2, col: TID });
    }
    // A budget written by name over Characteristics (which holds words, never a number).
    if (isNum(at(CHAR))) {
      if (String(at(BUDGET)).trim() === '') out.moves.push({ row: i + 2, from: CHAR, to: BUDGET });
      else out.clears.push({ row: i + 2, col: CHAR });
    }
  }
  return out;
}

/**
 * Run once by hand from the Apps Script editor (after a backup copy of the sheet).
 * Puts TripMeta's header row back to TRIP_META_HEADERS, moves a traveller count or
 * budget that was written into the wrong column back to its own, clears the extra
 * labels past column 12, then fills the Trip IDs. Changes nothing if any row has
 * data past column 12. Logs counts only. Safe to run again.
 */
function repairTripMeta() {
  var sh = getSpreadsheet().getSheetByName(TABS.TRIP_META);
  if (!sh) { Logger.log('repairTripMeta: no TripMeta tab'); return null; }
  var lastCol = Math.max(sh.getLastColumn(), TRIP_META_HEADERS.length), lastRow = sh.getLastRow();
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var rows = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  var plan = tmRepairPlan_(header, rows);
  if (!plan.ok) { Logger.log('repairTripMeta: ' + plan.why); return plan; }
  plan.moves.forEach(function(m) {
    var v = rows[m.row - 2][m.from - 1];
    sh.getRange(m.row, m.to).setValue(v);
    sh.getRange(m.row, m.from).clearContent();
  });
  plan.clears.forEach(function(c) { sh.getRange(c.row, c.col).clearContent(); });
  sh.getRange(1, 1, 1, plan.header.length).setValues([plan.header]);
  if (plan.extraCols) sh.getRange(1, plan.header.length + 1, 1, plan.extraCols).clearContent();
  var filled = tripIdStampAll_();
  Logger.log('repairTripMeta: header row reset; ' + plan.moves.length + ' value(s) moved back to their column, ' +
    plan.clears.length + ' duplicate(s) cleared, ' + plan.extraCols + ' extra label(s) removed; Trip IDs filled: ' + (filled ? filled.filled : 0));
  return plan;
}
