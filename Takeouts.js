// ============================================================
// VERA — Takeouts.js
// Kitchen › Takeouts: "We ordered" records the day (and, optionally, which dishes), so a card can
// say when you last ordered and what "our usual" is; a dish says who it's for (Ahmed, Victoria or
// Both). New columns follow Notes on each tab, named the first time they're written:
//   Takeout Restaurants: Last Ordered (7), Times Ordered (8)
//   Takeout Items:       For (6), Last Ordered (7), Times Ordered (8)
// ============================================================

var TO_R_LAST_ = 7, TO_R_TIMES_ = 8;
var TO_I_FOR_ = 6, TO_I_LAST_ = 7, TO_I_TIMES_ = 8;
var TO_FOR_ = ['Ahmed', 'Victoria', 'Both'];

/** Pure: who a dish is for, as Ahmed / Victoria / Both ('A', 'v', 'both' too), else ''. */
function toFor_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === 'a') s = 'ahmed'; else if (s === 'v') s = 'victoria'; else if (s === 'b') s = 'both';
  for (var i = 0; i < TO_FOR_.length; i++) if (TO_FOR_[i].toLowerCase() === s) return TO_FOR_[i];
  return '';
}

function toYmd_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

function toToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/** Adds and names the columns after Notes (from, the first new one; names in order). */
function toEnsureCols_(sheet, from, names) {
  var last = from + names.length - 1;
  if (sheet.getMaxColumns() < last) sheet.insertColumnsAfter(sheet.getMaxColumns(), last - sheet.getMaxColumns());
  var h = sheet.getRange(1, from, 1, names.length).getValues()[0];
  if (h.some(function(x) { return !String(x).trim(); })) sheet.getRange(1, from, 1, names.length).setValues([names]);
}

/** POST takeout_ordered — {name, dishes:[item names]}: today on the restaurant, and on each dish named. */
function webTakeoutOrdered_(body) {
  var name = String((body && body.name) || '').trim();
  if (!name) throw new Error('name is required');
  var dishes = ((body && body.dishes) || []).map(function(d) { return String(d).trim().toLowerCase(); }).filter(Boolean);
  var ss = getSpreadsheet(), today = toToday_();
  var rSheet = ss.getSheetByName(TABS.TAKEOUT_RESTAURANTS);
  if (!rSheet || rSheet.getLastRow() < 2) throw new Error('Takeout Restaurants tab not found or empty');
  toEnsureCols_(rSheet, TO_R_LAST_, ['Last Ordered', 'Times Ordered']);
  var rows = rSheet.getRange(2, 1, rSheet.getLastRow() - 1, TO_R_TIMES_).getValues(), at = -1;
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim() === name) { at = i; break; }
  if (at === -1) throw new Error('Restaurant not found: ' + name);
  var times = (parseInt(rows[at][TO_R_TIMES_ - 1], 10) || 0) + (toYmd_(rows[at][TO_R_LAST_ - 1]) === today ? 0 : 1);
  rSheet.getRange(at + 2, TO_R_LAST_, 1, 2).setValues([[today, times]]);
  var marked = [];
  if (dishes.length) {
    var iSheet = ss.getSheetByName(TABS.TAKEOUT_ITEMS);
    if (iSheet && iSheet.getLastRow() >= 2) {
      toEnsureCols_(iSheet, TO_I_FOR_, ['For', 'Last Ordered', 'Times Ordered']);
      var items = iSheet.getRange(2, 1, iSheet.getLastRow() - 1, TO_I_TIMES_).getValues();
      items.forEach(function(r, j) {
        if (String(r[0]).trim() !== name || dishes.indexOf(String(r[1]).trim().toLowerCase()) === -1) return;
        var n = (parseInt(r[TO_I_TIMES_ - 1], 10) || 0) + (toYmd_(r[TO_I_LAST_ - 1]) === today ? 0 : 1);
        iSheet.getRange(j + 2, TO_I_LAST_, 1, 2).setValues([[today, n]]);
        marked.push(String(r[1]).trim());
      });
    }
  }
  return { ok: true, name: name, date: today, times: times, dishes: marked };
}

/** POST update_takeout_item — {row, for?, rating?}. */
function webUpdateTakeoutItem_(body) {
  var row = parseInt((body && body.row) || '0', 10);
  if (!row || row < 2) throw new Error('Invalid row: ' + row);
  var sheet = getSpreadsheet().getSheetByName(TABS.TAKEOUT_ITEMS);
  if (!sheet || row > sheet.getLastRow()) throw new Error('That dish is gone');
  if (body.item && String(sheet.getRange(row, 2).getValue()).trim() !== String(body.item).trim()) throw new Error('That dish moved. Refresh and try again.');
  if (body['for'] !== undefined) { toEnsureCols_(sheet, TO_I_FOR_, ['For', 'Last Ordered', 'Times Ordered']); sheet.getRange(row, TO_I_FOR_).setValue(toFor_(body['for'])); }
  if (body.rating !== undefined) { var n = Number(body.rating); sheet.getRange(row, 4).setValue(n >= 1 && n <= 5 ? Math.round(n) : ''); }
  return { ok: true, row: row };
}

/** POST update_takeout_restaurant — {name, rating}. */
function webUpdateTakeoutRestaurant_(body) {
  var name = String((body && body.name) || '').trim();
  if (!name) throw new Error('name is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.TAKEOUT_RESTAURANTS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Takeout Restaurants tab not found or empty');
  var names = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < names.length; i++) if (String(names[i][0]).trim() === name) {
    var n = Number(body.rating); sheet.getRange(i + 2, 5).setValue(n >= 1 && n <= 5 ? Math.round(n) : '');
    return { ok: true, name: name };
  }
  throw new Error('Restaurant not found: ' + name);
}
