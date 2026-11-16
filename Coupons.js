// ============================================================
// VERA — Coupons.js
// Savings › Coupons: Mark as used keeps the coupon (Status Used, out of sight) with the day it
// was used and what it saved, so the screen can total "Saved this year" and list what you used.
// Two columns follow Added on the Coupons tab, named the first time they're written:
//   Used On (13), Saved (14)
// A "$5 off" coupon saves $5; a "% off" one asks how much (skippable). Used coupons are deleted
// once they were used before last year (purgeExpiredCoupons_, Code.js).
// ============================================================

var CPN_USED_COL_ = 13, CPN_SAVED_COL_ = 14;

/** Pure: what a discount saves in dollars when it says ("$5 off", "$10 off $50", "5 dollars off"), else null ("20% off", "free shipping"). */
function cpnSaved_(discount) {
  var s = String(discount == null ? '' : discount).trim();
  if (!s || /%|percent/i.test(s)) return null;
  var m = /\$\s*(\d+(?:\.\d{1,2})?)/.exec(s) || /^(\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd)?\s*(?:off)?\b/i.exec(s);
  return m ? Number(m[1]) : null;
}

/** Pure: whether a discount is a percentage (the screen asks how much it saved). */
function cpnIsPercent_(discount) { return /%|percent/i.test(String(discount || '')); }

/** Pure: a used coupon is old once it was used before Jan 1 of last year. */
function cpnUsedOld_(usedOn, tz, todayIso) {
  var iso = couponIso_(usedOn, tz);
  if (!iso) return false;
  return Number(iso.slice(0, 4)) < Number(String(todayIso).slice(0, 4)) - 1;
}

function cpnEnsureCols_(sheet) {
  if (sheet.getMaxColumns() < CPN_SAVED_COL_) sheet.insertColumnsAfter(sheet.getMaxColumns(), CPN_SAVED_COL_ - sheet.getMaxColumns());
  var h = sheet.getRange(1, CPN_USED_COL_, 1, 2).getValues()[0];
  if (!String(h[0]).trim() || !String(h[1]).trim()) sheet.getRange(1, CPN_USED_COL_, 1, 2).setValues([['Used On', 'Saved']]);
}

/** GET mark_coupon_used — id, saved (optional dollars): keeps the row as Used with today and what it saved. */
function webMarkCouponUsedKeep_(e) {
  var p = (e && e.parameter) || {}, id = String(p.id || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(TABS.COUPONS);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'Coupon not found' };
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    cpnEnsureCols_(sheet);
    var given = String(p.saved == null ? '' : p.saved).replace(/[$,\s]/g, '');
    var saved = given !== '' && !isNaN(Number(given)) && Number(given) >= 0 ? Math.round(Number(given) * 100) / 100 : cpnSaved_(rows[i][3]);
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    sheet.getRange(i + 2, 11).setValue('Used');
    sheet.getRange(i + 2, CPN_USED_COL_, 1, 2).setValues([[today, saved == null ? '' : saved]]);
    return { ok: true, id: id, usedOn: today, saved: saved };
  }
  return { ok: false, error: 'Coupon not found: ' + id };
}
