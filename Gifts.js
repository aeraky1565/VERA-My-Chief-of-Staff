// ============================================================
// VERA — Gifts.js
// People › Gift Ideas: each idea can carry a Price and a Link, and "Bought" keeps it as given,
// with the day and the occasion ("Birthday 2026"), so next time the card can say "Last year: …".
// Four columns follow Added Date on the Gift Ideas tab, named the first time they're written:
//   Price (5), Link (6), Given On (7), Occasion (8)
// ============================================================

var GI_COLS_ = ['Price', 'Link', 'Given On', 'Occasion'];
var GI_PRICE_COL_ = 5;

/** Pure: a price as a number ("$45", "45.50"), '' when blank or unreadable. */
function giPrice_(v) {
  var s = String(v == null ? '' : v).replace(/[$,\s]/g, '');
  if (!s) return '';
  var n = Number(s);
  return isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : '';
}

/** Pure: a link kept only when it's http(s), with https:// added to a bare domain. */
function giLink_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s)) s = 'https://' + s;
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 500 ? s : '';
}

function giEnsureCols_(sheet) {
  var last = GI_PRICE_COL_ + GI_COLS_.length - 1;
  if (sheet.getMaxColumns() < last) sheet.insertColumnsAfter(sheet.getMaxColumns(), last - sheet.getMaxColumns());
  var h = sheet.getRange(1, GI_PRICE_COL_, 1, GI_COLS_.length).getValues()[0];
  if (h.some(function(x) { return !String(x).trim(); })) sheet.getRange(1, GI_PRICE_COL_, 1, GI_COLS_.length).setValues([GI_COLS_]);
}

function giRow_(sheet, id) {
  if (!sheet || sheet.getLastRow() < 2) return -1;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return -1;
}

/** GET update_gift_idea — id, any of idea, price, link. */
function webUpdateGiftIdea_(e) {
  var p = (e && e.parameter) || {}, id = String(p.id || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(TABS.GIFT_IDEAS), row = giRow_(sheet, id);
  if (row === -1) return { ok: false, error: 'not found' };
  giEnsureCols_(sheet);
  if (p.idea !== undefined && String(p.idea).trim()) sheet.getRange(row, 3).setValue(String(p.idea).trim());
  if (p.price !== undefined) sheet.getRange(row, GI_PRICE_COL_).setValue(giPrice_(p.price));
  if (p.link !== undefined) sheet.getRange(row, GI_PRICE_COL_ + 1).setValue(giLink_(p.link));
  return { ok: true, id: id, price: p.price !== undefined ? giPrice_(p.price) : undefined, link: p.link !== undefined ? giLink_(p.link) : undefined };
}

/** GET gift_given — id, occasion ("Birthday 2026"), undo=1 to move it back to ideas. */
function webGiftGiven_(e) {
  var p = (e && e.parameter) || {}, id = String(p.id || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(TABS.GIFT_IDEAS), row = giRow_(sheet, id);
  if (row === -1) return { ok: false, error: 'not found' };
  giEnsureCols_(sheet);
  if (String(p.undo || '') === '1') { sheet.getRange(row, GI_PRICE_COL_ + 2, 1, 2).setValues([['', '']]); return { ok: true, id: id, given: false }; }
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var occasion = String(p.occasion || '').trim().slice(0, 60) || ('Gift ' + today.slice(0, 4));
  sheet.getRange(row, GI_PRICE_COL_ + 2, 1, 2).setValues([[today, occasion]]);
  return { ok: true, id: id, given: true, givenOn: today, occasion: occasion };
}
