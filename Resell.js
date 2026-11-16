// ============================================================
// VERA — Resell.js
// Savings › Resell: To list → Listed → Sold. Four columns follow Added Date on the Resell List
// tab, named the first time they're written: Listed Date, Sold Price, Sold Date, Dropped On.
// Listing stamps Listed Date; selling stamps Sold Date and the price it went for (else the asking
// price); lowering the asking price of a listed item stamps Dropped On, which restarts the
// 14-day "drop the price?" nudge. Moving an item back clears what no longer applies.
// ============================================================

var RS_COLS_ = ['Listed Date', 'Sold Price', 'Sold Date', 'Dropped On'];
var RS_NUDGE_DAYS_ = 14;

/** The 0-based column of each new header, adding and naming the ones a tab made before them lacks. */
function rsEnsureCols_(sheet, hdrs) {
  var out = {}, at = hdrs.length;
  while (at > 0 && String(hdrs[at - 1]).trim() === '') at--;
  RS_COLS_.forEach(function(name) {
    var i = hdrs.indexOf(name);
    if (i === -1) {
      if (sheet.getMaxColumns() < at + 1) sheet.insertColumnsAfter(sheet.getMaxColumns(), at + 1 - sheet.getMaxColumns());
      sheet.getRange(1, at + 1).setValue(name); hdrs[at] = name; i = at; at++;
    }
    out[name] = i;
  });
  return out;
}

/** Pure: a cell as yyyy-MM-dd, '' when it isn't a date. */
function rsYmd_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/**
 * Pure: the new-column writes for a change. row: the current values by header; p: the request.
 * → {header: value} for the columns that change.
 */
function rsStamps_(row, p, today) {
  var out = {}, was = String(row.Status || '').trim(), now = p.status !== undefined ? String(p.status).trim() : was;
  if (now === 'Listed' && was !== 'Listed') { if (!rsYmd_(row['Listed Date'], 'UTC') || was === 'Unlisted') out['Listed Date'] = today; out['Sold Date'] = ''; out['Sold Price'] = ''; }
  if (now === 'Sold' && was !== 'Sold') {
    out['Sold Date'] = today;
    var sp = parseFloat(String(p.soldPrice == null ? '' : p.soldPrice).replace(/[$,\s]/g, ''));
    var ask = parseFloat(p.askingPrice !== undefined ? p.askingPrice : row['Asking Price']);
    out['Sold Price'] = !isNaN(sp) && sp >= 0 ? sp : (!isNaN(ask) ? ask : '');
  } else if (now === 'Sold' && p.soldPrice !== undefined) {
    var sp2 = parseFloat(String(p.soldPrice).replace(/[$,\s]/g, ''));
    out['Sold Price'] = !isNaN(sp2) && sp2 >= 0 ? sp2 : '';
  }
  if (now === 'Unlisted' && was !== 'Unlisted') { out['Listed Date'] = ''; out['Sold Date'] = ''; out['Sold Price'] = ''; out['Dropped On'] = ''; }
  if (now === 'Listed' && was === 'Listed' && p.askingPrice !== undefined) {
    var oldA = parseFloat(row['Asking Price']), newA = parseFloat(p.askingPrice);
    if (!isNaN(oldA) && !isNaN(newA) && newA < oldA) out['Dropped On'] = today;
  }
  return out;
}

/** Writes rsStamps_ for row i (1-based sheet row) of the Resell List tab. → the stamps written. */
function rsApplyStamps_(sheet, hdrs, rowValues, sheetRow, p) {
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var cols = rsEnsureCols_(sheet, hdrs), byName = {};
  hdrs.forEach(function(h, j) { byName[h] = rowValues[j]; });
  var st = rsStamps_(byName, p, today);
  Object.keys(st).forEach(function(k) { sheet.getRange(sheetRow, cols[k] + 1).setValue(st[k]); });
  return st;
}
