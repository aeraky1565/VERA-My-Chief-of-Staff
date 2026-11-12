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
