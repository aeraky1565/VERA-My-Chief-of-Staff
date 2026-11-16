// ============================================================
// VERA — Recipes.js
// Kitchen › Recipes: when each recipe was last made (from Meal Plan history) and whether it's
// planned, and a photo per recipe taken from its link's preview image (og:image), kept in a
// Photo column after Notes. A link with no image is marked 'none' so it isn't fetched again.
// ============================================================

var RC_PHOTO_COL_ = 9;          // after Notes (RECIPE_HEADERS has 8)
var RC_PHOTO_BATCH_ = 8;        // links fetched per recipe_photos call

/** Pure: the preview image a page names (og:image, then twitter:image), as an absolute https URL, else ''. */
function rcOgImage_(html, pageUrl) {
  var s = String(html || '').slice(0, 300000), m = null;
  var pats = [
    /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content\s*=\s*["']([^"']+)["']/i,
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*(?:property|name)\s*=\s*["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["']/i
  ];
  for (var i = 0; i < pats.length && !m; i++) m = pats[i].exec(s);
  if (!m) return '';
  var u = m[1].trim().replace(/&amp;/g, '&');
  if (/^\/\//.test(u)) u = 'https:' + u;
  else if (/^\//.test(u)) { var o = /^(https?:\/\/[^\/]+)/i.exec(String(pageUrl || '')); if (!o) return ''; u = o[1] + u; }
  if (/^http:\/\//i.test(u)) u = 'https://' + u.slice(7);
  return /^https:\/\/[^\s"'<>]+$/i.test(u) && u.length <= 1000 ? u : '';
}

/** Pure: per recipe name (lower-case), the last day it was made (on or before today) and the next day it's planned. */
function rcMealDates_(rows, today) {
  var out = {};
  (rows || []).forEach(function(r) {
    var name = String(r.mealName || '').trim().toLowerCase(), d = String(r.date || '').slice(0, 10);
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(d) || /skip/i.test(String(r.status || ''))) return;
    var o = out[name] = out[name] || { lastMade: '', nextPlanned: '' };
    if (d <= today) { if (d > o.lastMade) o.lastMade = d; }
    else if (!o.nextPlanned || d < o.nextPlanned) o.nextPlanned = d;
  });
  return out;
}

function rcEnsurePhotoCol_(sheet) {
  if (sheet.getMaxColumns() < RC_PHOTO_COL_) sheet.insertColumnsAfter(sheet.getMaxColumns(), RC_PHOTO_COL_ - sheet.getMaxColumns());
  if (!String(sheet.getRange(1, RC_PHOTO_COL_).getValue() || '').trim()) sheet.getRange(1, RC_PHOTO_COL_).setValue('Photo');
}

/** The preview image of one recipe link, '' when there is none. */
function rcFetchPhoto_(link) {
  if (!/^https?:\/\//i.test(String(link || ''))) return '';
  try {
    var resp = UrlFetchApp.fetch(link, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; recipe-preview)' } });
    if (resp.getResponseCode() >= 400) return '';
    return rcOgImage_(resp.getContentText(), link);
  } catch (e) { return ''; }
}

/** GET recipe_photos — fills the Photo of up to 8 recipes that have a link and no photo yet. → {ok, filled:[{row, photo}], left} */
function webRecipePhotos_() {
  var sheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, filled: [], left: 0 };
  rcEnsurePhotoCol_(sheet);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, RC_PHOTO_COL_).getValues(), todo = [];
  rows.forEach(function(r, i) { if (String(r[0]).trim() && /^https?:\/\//i.test(String(r[4]).trim()) && !String(r[RC_PHOTO_COL_ - 1]).trim()) todo.push(i); });
  var filled = [];
  todo.slice(0, RC_PHOTO_BATCH_).forEach(function(i) {
    var photo = rcFetchPhoto_(String(rows[i][4]).trim());
    sheet.getRange(i + 2, RC_PHOTO_COL_).setValue(photo || 'none');
    filled.push({ row: i + 2, photo: photo });
  });
  return { ok: true, filled: filled, left: Math.max(0, todo.length - RC_PHOTO_BATCH_) };
}
