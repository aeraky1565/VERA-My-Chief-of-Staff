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

// ============================================================
// Add a recipe from a photo, a PDF or a link (Kitchen › Recipes). VERA reads it, the dashboard
// shows every field to check (anything unsure is marked), and nothing is saved until Save.
// A recipe site's own recipe data (schema.org Recipe, in its ld+json) is read first; only a page
// without it goes to Claude. The extra fields are columns after Photo, found by their header.
// ============================================================

var RC_MORE_HEADERS_ = ['Cook Time', 'Total Time', 'Directions', 'Equipment', 'Nutrition', 'Source', 'Updated'];
var RC_PAGE_MAX_ = 30000;       // characters of a page's text sent to Claude

/** Pure: an ISO 8601 duration (PT1H30M) → "1 hr 30 min"; other text is kept as written. */
function rcDuration_(v) {
  var s = String(v == null ? '' : v).trim();
  var m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?$/i.exec(s);
  if (!m || !(m[1] || m[2] || m[3])) return s.slice(0, 40);
  var min = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
  if (!min) return '';
  var h = Math.floor(min / 60), r = min % 60;
  return (h ? h + ' hr' : '') + (h && r ? ' ' : '') + (r ? r + ' min' : '');
}

/** Pure: HTML entities and tags out of a short string. */
function rcText_(v) {
  return String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(+n); }).replace(/&#x([0-9a-f]+);/gi, function(_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/\s+/g, ' ').trim();
}

/** Pure: a list from a string, an array or nothing. */
function rcList_(v) {
  if (Array.isArray(v)) return v.map(function(x) { return typeof x === 'string' ? x : (x && (x.text || x.name)) || ''; }).map(rcText_).filter(Boolean);
  var s = rcText_(v); return s ? s.split(/\s*,\s*/).filter(Boolean) : [];
}

/** Pure: schema.org recipeInstructions → steps; a section's name becomes a heading line ending in ':'. */
function rcSteps_(v) {
  var out = [];
  (function walk(x) {
    if (!x) return;
    if (typeof x === 'string') { rcText_(x).split(/\s*\n+\s*/).forEach(function(s) { if (s) out.push(s); }); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    var t = [].concat(x['@type'] || []).join(' ');
    if (/HowToSection/i.test(t)) { if (x.name) out.push(rcText_(x.name).replace(/:?$/, ':')); walk(x.itemListElement); return; }
    if (x.text) out.push(rcText_(x.text)); else if (x.name) out.push(rcText_(x.name));
  })(v);
  return out.filter(Boolean);
}

/** Pure: the Recipe object in a page's ld+json blocks (at the top, in an array, or in @graph), else null. */
function rcFindLd_(html) {
  var re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, m;
  var isRecipe = function(o) { return o && [].concat(o['@type'] || []).some(function(t) { return /^Recipe$/i.test(String(t)); }); };
  var find = function(o) {
    if (!o || typeof o !== 'object') return null;
    if (isRecipe(o)) return o;
    var kids = Array.isArray(o) ? o : [].concat(o['@graph'] || [], o.mainEntity || []);
    for (var i = 0; i < kids.length; i++) { var f = find(kids[i]); if (f) return f; }
    return null;
  };
  while ((m = re.exec(String(html || '')))) {
    var j = null; try { j = JSON.parse(m[1].trim()); } catch (e) { continue; }
    var r = find(j); if (r) return r;
  }
  return null;
}

/** Pure: a schema.org Recipe → VERA's recipe fields. */
function rcFromLd_(r, url) {
  var y = [].concat(r.recipeYield || [])[0];
  var nut = r.nutrition || {}, names = { calories: 'Calories', proteinContent: 'Protein', carbohydrateContent: 'Carbs', fatContent: 'Fat', fiberContent: 'Fiber', sugarContent: 'Sugar', sodiumContent: 'Sodium' };
  var img = [].concat(r.image || [])[0]; img = typeof img === 'string' ? img : (img && img.url) || '';
  return {
    name: rcText_(r.name), servings: rcText_(y), prep: rcDuration_(r.prepTime), cook: rcDuration_(r.cookTime), total: rcDuration_(r.totalTime),
    ingredients: rcList_(r.recipeIngredient || r.ingredients), directions: rcSteps_(r.recipeInstructions),
    equipment: rcList_(r.tool), cuisine: rcList_(r.recipeCuisine).join(', '),
    tags: rcList_(r.recipeCategory).concat(rcList_(r.keywords)).filter(function(t, i, a) { return a.indexOf(t) === i; }).slice(0, 8),
    nutrition: Object.keys(names).filter(function(k) { return nut[k]; }).map(function(k) { return names[k] + ' ' + rcText_(nut[k]); }),
    notes: '', link: String(url || ''), photo: /^https:\/\//.test(img) ? img : ''
  };
}

/** Pure: what Claude (or a form) sent → clean fields, each list a list, nothing over its limit. */
function rcClean_(g) {
  g = g || {};
  var s = function(v, n) { return rcText_(v).slice(0, n); };
  var l = function(v, n, each) { return (Array.isArray(v) ? v : String(v || '').split(/\n|;/)).map(function(x) { return s(x, each).replace(/;/g, ','); }).filter(Boolean).slice(0, n); };
  var nut = g.nutrition && !Array.isArray(g.nutrition) && typeof g.nutrition === 'object'
    ? Object.keys(g.nutrition).filter(function(k) { return g.nutrition[k]; }).map(function(k) { return k.charAt(0).toUpperCase() + k.slice(1) + ' ' + g.nutrition[k]; }) : g.nutrition;
  return { name: s(g.name, 120), servings: s(g.servings, 40), prep: rcDuration_(g.prep), cook: rcDuration_(g.cook), total: rcDuration_(g.total),
           ingredients: l(g.ingredients, 80, 200), directions: l(g.directions, 60, 800), equipment: l(g.equipment, 20, 80), nutrition: l(nut, 12, 40),
           cuisine: s(g.cuisine, 40), tags: l(g.tags, 10, 30), notes: s(g.notes, 600), link: /^https?:\/\//i.test(String(g.link || '')) ? String(g.link).trim().slice(0, 1000) : '',
           photo: /^https:\/\//.test(String(g.photo || '')) ? String(g.photo).slice(0, 1000) : '' };
}

/** Pure: a page's readable text for Claude: scripts, styles and tags out. */
function rcPageText_(html) {
  return String(html || '').replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, RC_PAGE_MAX_);
}

var RC_PROMPT_ = 'Return ONLY JSON (no markdown): {"name","servings","prep","cook","total","ingredients":[one line each, with amount and unit, e.g. "2 cups flour"],' +
  '"directions":[one step each, in order; a section heading as its own line ending in ":"],"equipment":[tools beyond the ingredients],"nutrition":{"calories","protein","carbs","fat"} per serving if given,' +
  '"cuisine","tags":[a few],"notes":"tips worth keeping","unsure":[names of any field you could not read with confidence]}. Use "" or [] for anything not there. Copy amounts exactly; do not invent a step or an ingredient.';

/** Claude reads a photo, PDF or page text → {got} or {error}. */
function rcAsk_(content) {
  var resp = fetchTracked_('anthropic', CLAUDE_API_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': getApiKey(), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 4000, messages: [{ role: 'user', content: content }] }) });
  if (resp.getResponseCode() !== 200) return { error: 'Couldn’t read it right now (HTTP ' + resp.getResponseCode() + '). You can type it in instead.' };
  var text = ''; try { var j = JSON.parse(resp.getContentText()); text = (j.content && j.content[0] && j.content[0].text) || ''; } catch (e) {}
  var m = text.match(/\{[\s\S]*\}/), got = null; try { got = m ? JSON.parse(m[0]) : null; } catch (e) {}
  return got ? { got: got } : { error: 'VERA couldn’t make out a recipe in that. Try a clearer photo, or type it in.' };
}

/** POST recipe_read { url } | { imageBase64, mime } → { ok, recipe, unsure, from } (nothing saved). */
function webRecipeRead_(body) {
  var b = body || {}, url = String(b.url || '').trim();
  if (url) {
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'That isn’t a web link.' };
    var resp; try { resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; recipe-reader)' } }); }
    catch (e) { return { ok: false, error: 'Couldn’t open that link.' }; }
    if (resp.getResponseCode() >= 400) return { ok: false, error: 'That site didn’t let VERA in (HTTP ' + resp.getResponseCode() + '). Copy the recipe text, or take a screenshot and upload it.' };
    var html = resp.getContentText(), ld = rcFindLd_(html);
    if (ld) {
      var r = rcClean_(rcFromLd_(ld, url));
      if (!r.photo) r.photo = rcOgImage_(html, url);
      if (r.ingredients.length && r.directions.length) return { ok: true, recipe: r, unsure: [], from: 'site' };
    }
    var a = rcAsk_([{ type: 'text', text: 'Below is the text of a recipe web page (' + url + '). Pull out the recipe. ' + RC_PROMPT_ + '\n\nPAGE:\n' + rcPageText_(html) }]);
    if (a.error) return { ok: false, error: a.error };
    var c = rcClean_(Object.assign({}, a.got, { link: url, photo: rcOgImage_(html, url) }));
    return { ok: true, recipe: c, unsure: Array.isArray(a.got.unsure) ? a.got.unsure.slice(0, 12) : [], from: 'page' };
  }
  var f = eyCheckFile_(b); if (f.error) return { ok: false, error: f.error };
  var p = rcAsk_([eyBlock_(f.b64, f.mime), { type: 'text', text: 'This is a recipe (a cookbook page, a card or a screenshot). Read it exactly as written. ' + RC_PROMPT_ }]);
  if (p.error) return { ok: false, error: p.error };
  return { ok: true, recipe: rcClean_(p.got), unsure: Array.isArray(p.got.unsure) ? p.got.unsure.slice(0, 12) : [], from: 'photo' };
}

/** The Recipes tab with every column, and where each one is (1-based). */
function rcCols_(sheet) {
  rcEnsurePhotoCol_(sheet);
  var w = sheet.getLastColumn(), head = sheet.getRange(1, 1, 1, w).getValues()[0].map(function(h) { return String(h || '').trim(); });
  var missing = RC_MORE_HEADERS_.filter(function(h) { return head.indexOf(h) === -1; });
  // A new column past the sheet's last one has to be made first, or the write is out of bounds.
  if (missing.length && head.length + missing.length > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), head.length + missing.length - sheet.getMaxColumns());
  missing.forEach(function(h) { head.push(h); sheet.getRange(1, head.length).setValue(h); });
  var at = {}; head.forEach(function(h, i) { if (h && !at[h]) at[h] = i + 1; });
  return { at: at, width: head.length };
}

/** POST recipe_save { row?, recipe } → { ok, row, name }. A row updates that recipe; none adds one. */
function webRecipeSave_(body) {
  var r = rcClean_((body && body.recipe) || {});
  if (!r.name) return { ok: false, error: 'Give the recipe a name.' };
  if ([r.name, r.cuisine].some(function(v) { return /^[=+@-]/.test(v); })) return { ok: false, error: 'A name can’t start with =, +, - or @.' };
  if (!r.ingredients.length && !r.directions.length) return { ok: false, error: 'Add the ingredients or the directions.' };
  var sheet = getSpreadsheet().getSheetByName(TABS.RECIPES);
  if (!sheet) return { ok: false, error: 'The Recipes tab isn’t there.' };
  return tiLocked_(function() {
    var cols = rcCols_(sheet), row = parseInt((body && body.row) || '0', 10);
    if (row && (row < 2 || row > sheet.getLastRow())) return { ok: false, error: 'That recipe isn’t there any more. Refresh and try again.' };
    var at = row || sheet.getLastRow() + 1;
    var cur = row ? sheet.getRange(at, 1, 1, cols.width).getValues()[0] : new Array(cols.width).fill('');
    var put = function(h, v) { if (cols.at[h]) cur[cols.at[h] - 1] = v; };
    put('Name', r.name); put('Cuisine', r.cuisine); put('Servings', r.servings); put('Prep Time', r.prep); put('Link', r.link);
    put('Ingredients', r.ingredients.join('; ')); put('Tags', r.tags.join(', ')); put('Notes', r.notes);
    put('Cook Time', r.cook); put('Total Time', r.total); put('Directions', r.directions.join('\n')); put('Equipment', r.equipment.join('; '));
    put('Nutrition', r.nutrition.join('; ')); put('Source', String((body && body.from) || cur[(cols.at.Source || 1) - 1] || 'typed')); put('Updated', new Date().toISOString());
    if (r.photo) put('Photo', r.photo);
    else if (!row && r.link) put('Photo', rcFetchPhoto_(r.link) || 'none');
    sheet.getRange(at, 1, 1, cols.width).setNumberFormat('@').setValues([cur]);
    return { ok: true, row: at, name: r.name };
  });
}
