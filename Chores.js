// ============================================================
// VERA — Chores.js
// Two columns after Due By on the Chores tab: Owner (Ahmed, Victoria or Either) and Checked By
// (who ticked it, from the sign-in). Chores stay on the Chores screen: no nudges, not on Today.
// ============================================================

var CH_OWNERS_ = ['Ahmed', 'Victoria', 'Either'];

/** Pure: an owner cell or param as Ahmed / Victoria / Either (blank or anything else is Either). */
function chOwner_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  for (var i = 0; i < CH_OWNERS_.length; i++) if (CH_OWNERS_[i].toLowerCase() === s) return CH_OWNERS_[i];
  return 'Either';
}

/** The column index (0-based) of a header, adding and naming Owner / Checked By on a tab made before them. */
function chCol_(sheet, name) {
  var hdrs = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  var i = hdrs.indexOf(name);
  if (i !== -1) return i;
  var at = hdrs.length;
  while (at > 0 && String(hdrs[at - 1]).trim() === '') at--;
  if (sheet.getMaxColumns() < at + 1) sheet.insertColumnsAfter(sheet.getMaxColumns(), at + 1 - sheet.getMaxColumns());
  sheet.getRange(1, at + 1).setValue(name);
  return at;
}

/** Who is ticking: the signed-in person's name, else ''. */
function chWho_() { try { return (typeof _veraWho_ !== 'undefined' && _veraWho_ && _veraWho_.name) ? String(_veraWho_.name) : ''; } catch (e) { return ''; } }
