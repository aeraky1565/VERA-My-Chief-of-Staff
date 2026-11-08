// ============================================================
// VERA — GroceryRun.js
// Log a grocery run from a receipt, no shopping list needed (issue #229).
// ============================================================
//
// Started from Finances › Groceries, Home / Today, or Life › Quick capture. One photo:
//   gq_scan  reads the store, the date, the total (tax included) and every line,
//            matching each line against EVERY store's shopping list, not one tab's
//   gq_log   puts the picked lines in the pantry on the receipt's date (receiptLog_,
//            so On Hand picks them up for that week), ticks the matched list items
//            off whichever list they were on, and logs the run on that date
//            (webGroceryLog_), with "always count this store" when asked
// Done shopping on the Shopping tab is unchanged. The photo isn't kept.
//
// Two layers: gq*_ pure helpers, then the reads and the routes.
// ============================================================

var GQ_MAX_LINES_ = 100;

// ---- pure ---------------------------------------------------------------------

function gqStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function gqItemText_(t) { return String(t || '').replace(/^🤖\s*/, '').replace(/\s*\(est\..*?\)$/, '').trim(); }

/**
 * The open items on every store's list, for matching. stores: getShoppingList_() shape.
 * → [{tabId, store, index, text}]
 */
function gqOpenItems_(stores, notStores) {
  var out = [];
  (stores || []).forEach(function(s) {
    if ((notStores || []).indexOf(String(s.storeName || '').toLowerCase()) !== -1) return;
    (s.items || []).forEach(function(i) {
      var t = gqItemText_(i.text);
      if (t && !i.done) out.push({ tabId: s.tabId, store: s.storeName, index: i.index, text: t });
    });
  });
  return out;
}

/** The store on the receipt, as one of yours when it is one: "COSTCO WHOLESALE #123" → "Costco". */
function gqStoreMatch_(text, names) {
  var t = String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  var hit = (names || []).filter(function(n) {
    var k = String(n).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!k) return false;
    var a = k.replace(/'/g, ''), b = t.replace(/'/g, '');
    return b === a || b.indexOf(a + ' ') === 0 || (' ' + b + ' ').indexOf(' ' + a + ' ') !== -1 || a.indexOf(b) === 0;
  })[0];
  return hit || '';
}

/** A date read off a receipt: yyyy-MM-dd, never in the future, no older than 60 days; else ''. */
function gqDate_(v, today) {
  var s = String(v || '').trim(), m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) || s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return '';
  var y, mo, d;
  if (s.charAt(4) === '-') { y = +m[1]; mo = +m[2]; d = +m[3]; } else { mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  var ymd = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  var age = (Date.parse(today + 'T00:00:00Z') - Date.parse(ymd + 'T00:00:00Z')) / 86400000;
  return age >= 0 && age <= 60 ? ymd : '';   // a future date has a negative age
}

/**
 * What the model read, cleaned: {store, date, total, items:[{name, qty, price, food, match,
 * tabId, index, onList}]}. A match must be one of the open list items, word for word, so a
 * made-up match can never tick anything; the receipt's store's list wins a tie.
 */
function gqClean_(text, open, storeNames, today) {
  var raw = String(text || '').replace(/^```[a-z]*\s*/i, '').replace(/\s*```\s*$/, '').trim(), obj = null;
  try { obj = JSON.parse(raw); } catch (e) { var m = raw.match(/\{[\s\S]*\}/); try { obj = m ? JSON.parse(m[0]) : null; } catch (e2) { obj = null; } }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = { items: Array.isArray(obj) ? obj : [] };
  var names = []; (open || []).forEach(function(o) { if (names.indexOf(o.text) === -1) names.push(o.text); });
  var lines = receiptClean_(JSON.stringify(Array.isArray(obj.items) ? obj.items : []), names).slice(0, GQ_MAX_LINES_);
  var store = gqStoreMatch_(obj.store, storeNames);
  var used = {};
  var items = lines.map(function(l) {
    var x = { name: l.name, qty: l.qty, price: l.price, food: l.food, match: '', tabId: '', index: -1, onList: '' };
    if (l.match) {
      var cands = (open || []).filter(function(o) { return o.text.toLowerCase() === l.match.toLowerCase() && !used[o.tabId + '|' + o.index]; });
      var pick = cands.filter(function(o) { return o.store === store; })[0] || cands[0];
      if (pick) { used[pick.tabId + '|' + pick.index] = 1; x.match = pick.text; x.tabId = pick.tabId; x.index = pick.index; x.onList = pick.store; }
    }
    return x;
  });
  var total = obj.total === null || obj.total === undefined || obj.total === '' ? null : Number(String(obj.total).replace(/[^0-9.\-]/g, ''));
  return { store: store || gqStr_(obj.store, 60), knownStore: !!store, date: gqDate_(obj.date, today) || today, readDate: !!gqDate_(obj.date, today),
    total: isFinite(total) && total > 0 ? Math.round(total * 100) / 100 : null, items: items };
}

/** Pure: what to tell you once it's saved. */
function gqSummary_(o) {
  var bits = [];
  if (o.added || o.filled) bits.push((o.added + o.filled) + ' item' + (o.added + o.filled === 1 ? '' : 's') + ' in the pantry' + (o.useSoon.length ? ', ' + o.useSoon.length + ' use soon (' + o.useSoon.slice(0, 3).join(', ') + ')' : ''));
  if (o.ticked.length) bits.push('Ticked off: ' + o.ticked.map(function(t) { return t.item + ' (' + t.store + ')'; }).join(', '));
  if (o.run) bits.push('$' + o.run.total.toFixed(2) + ' to groceries' + (o.run.card ? ' on ' + o.run.card : '') + ', ' + o.run.date + (o.run.who ? ', by ' + o.run.who : ''));
  if (o.left) bits.push(o.left + ' left out of the pantry');
  return bits;
}

// ---- reads ----------------------------------------------------------------------

/** Your stores: the Shopping tabs that are stores, then the grocery stores set on Finances › Groceries. */
function gqStoreNames_(tabs) {
  var not = typeof GR_NOT_STORES_ !== 'undefined' ? GR_NOT_STORES_ : [], out = [];
  var add = function(n) { n = gqStr_(n, 60); if (n && not.indexOf(n.toLowerCase()) === -1 && !out.some(function(x) { return x.toLowerCase() === n.toLowerCase(); })) out.push(n); };
  (tabs || []).forEach(function(s) { add(s.storeName); });
  try { var set = typeof grStoreSetting_ === 'function' ? grStoreSetting_() : {}; Object.keys(set || {}).forEach(function(k) { if (set[k] === true) add(k); }); } catch (e) {}
  return out;
}

function gqToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/** One Claude vision call: the store, the date, the total and the lines. */
function gqRead_(imageB64, mime, names) {
  var b64 = String(imageB64 || '');
  if (!b64) throw new Error('No photo came through.');
  if (b64.length > RECEIPT_MAX_B64_) throw new Error('That photo is too large — try again closer to the receipt.');
  if (RECEIPT_MIMES_.indexOf(mime) === -1) throw new Error('That file isn’t a photo.');
  var prompt =
    'This is a grocery or store receipt. Read it.\n' +
    'Return ONLY a JSON object (no markdown fences): {"store": the store name as printed, "date": the purchase date as YYYY-MM-DD or null, ' +
    '"total": the amount paid including tax as a number or null, "items": [one object per purchased item: {"name": plain lowercase item name ' +
    'without brand codes or sizes, "qty": number or null, "price": the line total as a number or null, "food": true if it is food or drink, else false, ' +
    '"match": the exact text of the matching entry from MY LISTS below, or "" if none matches}]}.\n' +
    'Skip totals, tax, discounts, bag fees and payment lines in items.\n' +
    'MY LISTS: ' + JSON.stringify(names.slice(0, 150));
  var resp = fetchTracked_('anthropic', CLAUDE_API_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': getApiKey(), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 3000, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
      { type: 'text', text: prompt }] }] }),
  });
  if (resp.getResponseCode() !== 200) throw new Error('Couldn’t read the receipt right now (HTTP ' + resp.getResponseCode() + ').');
  var json = JSON.parse(resp.getContentText());
  return (json.content && json.content[0] && json.content[0].text) || '';
}

// ---- routes -----------------------------------------------------------------------

/** POST gq_scan {image, mime, who}: the receipt read against every list, and the run's setup. */
function webGqScan_(body) {
  body = body || {};
  var stores = [];
  try { stores = getShoppingList_() || []; } catch (e) { Logger.log('gq_scan: no shopping list: ' + e.message); }
  var open = gqOpenItems_(stores, typeof GR_NOT_STORES_ !== 'undefined' ? GR_NOT_STORES_ : []);
  var storeNames = gqStoreNames_(stores);
  var names = []; open.forEach(function(o) { if (names.indexOf(o.text) === -1) names.push(o.text); });
  var r = gqClean_(gqRead_(body.image, body.mime, names), open, storeNames, gqToday_());
  if (!r.items.length && r.total == null) return { ok: false, error: 'Couldn’t read that receipt. Retake the photo flat and in good light, or just log the total.' };
  var setup = webGrocerySetup_({ store: r.store });
  r.ok = true; r.stores = storeNames; r.setup = setup;
  return r;
}

/** GET gq_setup {store}: who can pay, the cards, whether the store counts, the month; for "just log the total". */
function webGqSetup_(p) {
  var tabs = [];
  try { tabs = getShoppingList_() || []; } catch (e) {}
  var setup = webGrocerySetup_({ store: gqStr_(p && p.store, 60) });
  setup.stores = gqStoreNames_(tabs);
  setup.today = gqToday_();
  return setup;
}

/**
 * POST gq_log {store, date, items:[{name, qty, price, food}], ticks:[{tabId, index, item}],
 * run:{who, card, total, counted:'all'|'food'|'none', itemsTotal}, always}.
 */
function webGqLog_(body) {
  body = body || {};
  var store = gqStr_(body.store, 60), today = gqToday_();
  var date = gqDate_(body.date, today) || today;
  if (!store) return { ok: false, error: 'Which store?' };
  var items = (Array.isArray(body.items) ? body.items : []).slice(0, GQ_MAX_LINES_);
  var run = body.run || {}, counted = String(run.counted || 'all');
  if (!items.length && (counted === 'none' || !(Number(run.total) > 0))) return { ok: false, error: 'Pick something for the pantry, or enter the total.' };
  if (counted !== 'none' && !run.who) return { ok: false, error: 'Who went?' };
  var out = { ok: true, added: 0, filled: 0, ticked: [], run: null, useSoon: [], left: Math.max(0, Number(body.left) || 0) };
  if (items.length) {
    var r = receiptLog_(store, items, date);
    if (!r.ok) return r;
    out.added = r.added; out.filled = r.filled;
    var per = typeof OH_PERISHABLE_ !== 'undefined' ? OH_PERISHABLE_ : null;
    items.forEach(function(x) { if (x.food !== false && per && per.test(normalizeItemName_(x.name))) out.useSoon.push(String(x.name)); });
  }
  // Ticks: only items still open, at the index the scan saw; a list changed since is skipped.
  var lists = [];
  try { lists = getShoppingList_() || []; } catch (e) {}
  (Array.isArray(body.ticks) ? body.ticks : []).slice(0, GQ_MAX_LINES_).forEach(function(t) {
    var s = lists.filter(function(x) { return x.tabId === String(t.tabId); })[0];
    var it = s && s.items.filter(function(i) { return i.index === Number(t.index); })[0];
    if (!it || it.done || gqItemText_(it.text).toLowerCase() !== String(t.item || '').toLowerCase()) return;
    try { toggleShoppingItem_(s.tabId, it.index); out.ticked.push({ item: gqItemText_(it.text), store: s.storeName }); } catch (e) { Logger.log('gq tick: ' + e.message); }
  });
  if (body.always === true || body.always === 'true') { try { webGroceryStoresSave_({ stores: (function() { var o = {}; o[store] = true; return o; })() }); } catch (e) {} }
  if (counted !== 'none' && Number(run.total) > 0) {
    var g = webGroceryLog_({ run: { date: date, store: store, who: run.who, card: run.card, total: run.total, source: items.length ? 'receipt' : 'typed',
      counted: counted === 'food' ? 'food' : 'all', itemsTotal: run.itemsTotal } });
    if (!g.ok) { out.runError = g.error; } else { out.run = g.run; out.month = g.month; }
  }
  out.date = date; out.store = store;
  out.summary = gqSummary_(out);
  return out;
}
