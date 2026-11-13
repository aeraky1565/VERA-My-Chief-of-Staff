// ============================================================
// VERA — Groceries.js
// Grocery runs: what each Done shopping run cost, who went and on which card,
// and the month's grocery spend in Finances against the Budget tab's line.
// ============================================================
//
// A run is logged from the Done shopping sheet. With a receipt, its total is
// the sum of every line VERA read (pantry or not; tax is not on the lines),
// editable before saving. Without one, it is typed.
//
// Some stores always count as groceries; the others ask each run: all of it,
// just the food (the lines the receipt reader marked as food), or not this one.
// Which is which lives in Config as shop_grocery_stores ({store: true}); a store
// not in it asks.
//
// The budget is the "Groceries" row of the tracker sheet's Budget tab, read by
// webGetBudget_ (WebApp.js). VERA never writes to the tracker sheet.
//
// The suggested card is the best "Groceries" rate in Card Rewards among the
// person's active cards (their own, joint, or ones they are an authorised user on).
//
//   gr*_    pure: cleaning, totals, the pace line, the card, the store rule
//   webGr*  the sheet reads and writes
// ============================================================

var GR_PEOPLE_ = ['Ahmed', 'Victoria'];
var GR_COUNTED_ = ['all', 'food'];
var GR_SOURCES_ = ['receipt', 'typed'];
var GR_STORES_KEY_ = 'shop_grocery_stores';
// What counts on day one. Costco and Target are left to ask each run.
var GR_DEFAULT_STORES_ = ['Wegmans', 'Lidl', 'Whole Foods', "MOM's", "Trader Joe's", 'Giant', 'Egyptian/Greek'];
// Shopping Doc tabs that are lists, not stores: never shown in the Stores setting.
var GR_NOT_STORES_ = ['recipe', 'wish list', 'home supplies', 'egypt'];

// ---- pure ------------------------------------------------------------------

function grStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
function grMoney_(v) { if (v === '' || v == null) return null; var n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; }
function grYmd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  var t = String(v == null ? '' : v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
}
function grOneOf_(v, list, fb) { var s = String(v == null ? '' : v).trim(); var hit = list.filter(function(x) { return x.toLowerCase() === s.toLowerCase(); })[0]; return hit != null ? hit : fb; }

/** Pure: a run as the dashboard sent it, made safe to store. */
function grClean_(raw) {
  raw = raw || {};
  return { id: grStr_(raw.id, 40), date: grYmd_(raw.date), store: grStr_(raw.store, 60), who: grOneOf_(raw.who, GR_PEOPLE_, ''),
    card: grStr_(raw.card, 80), total: grMoney_(raw.total), source: grOneOf_(raw.source, GR_SOURCES_, 'typed'),
    counted: grOneOf_(raw.counted, GR_COUNTED_, 'all'), itemsTotal: grMoney_(raw.itemsTotal) };
}

/** Pure: a receipt's total for how the run counts: every line, or only the food lines. */
function grCountedTotal_(lines, mode) {
  var sum = 0;
  (lines || []).forEach(function(l) {
    var p = l && l.price != null && l.price !== '' && isFinite(Number(l.price)) ? Number(l.price) : 0;
    if (mode === 'food' && l.food === false) return;
    sum += p;
  });
  return Math.round(sum * 100) / 100;
}

/** Pure: does a store count as groceries? true, false, or null (not a store: never shown). */
function grIsGroceryStore_(store, setting) {
  var s = String(store || '').trim();
  if (!s || GR_NOT_STORES_.indexOf(s.toLowerCase()) !== -1) return null;
  return !!(setting && setting[s] === true);
}

/** Pure: the month's totals: all, by person, by card, by store. */
function grMonthTotals_(runs, ym) {
  var out = { total: 0, byWho: {}, byCard: {}, byStore: {}, count: 0, runs: [] };
  GR_PEOPLE_.forEach(function(p) { out.byWho[p] = { total: 0, runs: 0 }; });
  (runs || []).filter(function(r) { return r.date && r.date.slice(0, 7) === ym && r.total != null; }).forEach(function(r) {
    out.total += r.total; out.count++; out.runs.push(r);
    if (out.byWho[r.who]) { out.byWho[r.who].total += r.total; out.byWho[r.who].runs++; }
    var c = r.card || 'No card';
    out.byCard[c] = (out.byCard[c] || 0) + r.total;
    out.byStore[r.store] = (out.byStore[r.store] || 0) + r.total;
  });
  out.total = Math.round(out.total * 100) / 100;
  out.runs.sort(function(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return out;
}

/** Pure: what is left this month, and what last month had spent by the same day. */
function grPaceLine_(runs, today, budget) {
  var ym = today.slice(0, 7), y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  var prev = m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
  var day = today.slice(8, 10);
  var lastMonthByNow = (runs || []).filter(function(r) { return r.date && r.date.slice(0, 7) === prev && r.date.slice(8, 10) <= day && r.total != null; })
    .reduce(function(n, r) { return n + r.total; }, 0);
  var spent = grMonthTotals_(runs, ym).total;
  var monthEnd = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { spent: spent, budget: budget, left: budget != null ? Math.round((budget - spent) * 100) / 100 : null,
    daysLeft: monthEnd - Number(day), lastMonthByNow: Math.round(lastMonthByNow * 100) / 100 };
}

/** Pure: the cards a person can use: active, and theirs, joint, or with them as an authorised user. */
function grCardsFor_(cards, who) {
  return (cards || []).filter(function(c) {
    if (!c || !c.name || c.active === false) return false;
    var owner = String(c.owner || '').toLowerCase(), auth = String(c.authUser || '').toLowerCase(), w = String(who || '').toLowerCase();
    return !w || owner === w || owner === 'joint' || owner === 'both' || auth.indexOf(w) !== -1;
  });
}

/** Pure: the best grocery card for a person: the highest "Groceries" rate among their cards, with why. */
function grBestCard_(cards, rewards, who) {
  var mine = grCardsFor_(cards, who), names = {};
  mine.forEach(function(c) { names[c.name] = 1; });
  var hits = (rewards || []).filter(function(r) { return r && names[r.card] && String(r.category || '').trim().toLowerCase() === 'groceries' && isFinite(Number(r.rate)); })
    .sort(function(a, b) { return Number(b.rate) - Number(a.rate); });
  if (!hits.length) return mine[0] ? { card: mine[0].name, why: 'no grocery rate on file' } : null;
  var h = hits[0], where = String(h.conditions || '').split(',')[0].trim();
  var rate = /%/.test(h.rateType || '') ? h.rate + '% back' : h.rate + 'x points';
  return { card: h.card, rate: Number(h.rate), rateType: h.rateType || '', why: rate + (where ? ' at ' + where.charAt(0).toLowerCase() + where.slice(1) : ' on groceries') + ' · best of yours here' };
}

/** Pure: what a card earned on a month's grocery spend, in words. */
function grEarned_(total, reward) {
  if (!reward || !isFinite(Number(reward.rate))) return '';
  var r = Number(reward.rate);
  if (/%/.test(reward.rateType || '')) return 'about $' + (total * r / 100).toFixed(2) + ' back at ' + r + '%';
  return 'about ' + Math.round(total * r).toLocaleString('en-US') + ' points at ' + r + 'x';
}

/** Pure: the "Groceries" row of the Budget tab's rows ({label, value}), as a number, or null. */
function grBudgetFrom_(rows) {
  var row = (rows || []).filter(function(r) { return String(r.label || '').trim().toLowerCase() === 'groceries'; })[0];
  return row ? grMoney_(row.value) : null;
}

/** Pure: the stores for the setting: the Shopping Doc's tabs that are stores, each with whether it counts. */
function grStoreList_(storeNames, setting) {
  return (storeNames || []).filter(function(n) { return grIsGroceryStore_(n, setting) !== null; })
    .map(function(n) { return { store: n, counts: grIsGroceryStore_(n, setting) }; });
}

// ---- sheets and settings -------------------------------------------------------

function grSheet_() { return ensureSheet(getSpreadsheet(), TABS.GROCERY_RUNS, GROCERY_RUN_HEADERS); }
function grToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function grLocked_(fn) { var l = LockService.getScriptLock(); l.waitLock(10000); try { return fn(); } finally { l.releaseLock(); } }
function grRowToRun_(r) {
  var x = grClean_({ id: r[0], date: grYmd_(r[1]), store: r[2], who: r[3], card: r[4], total: r[5], source: r[6], counted: r[7], itemsTotal: r[8] });
  x.created = String(r[9] || ''); x.updated = String(r[10] || '');
  return x;
}
function grRunToRow_(x, created, updated) {
  return [x.id, x.date, x.store, x.who, x.card, x.total, x.source, x.counted, x.itemsTotal == null ? '' : x.itemsTotal, created, updated];
}
function grAll_() {
  var sh = grSheet_();
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, GROCERY_RUN_HEADERS.length).getValues().filter(function(r) { return String(r[0]).trim(); }).map(grRowToRun_);
}

/** The per-store setting. The first read writes the starting list to Config. */
function grStoreSetting_() {
  var raw = (getConfigValues() || {})[GR_STORES_KEY_];
  if (raw) { try { var v = JSON.parse(raw); if (v && typeof v === 'object') return v; } catch (e) {} }
  var seed = {};
  GR_DEFAULT_STORES_.forEach(function(s) { seed[s] = true; });
  grWriteConfig_(seed);
  return seed;
}
function grWriteConfig_(setting) {
  setConfigRow_(GR_STORES_KEY_, JSON.stringify(setting), 'Which Shopping stores count as groceries (Done shopping asks at the rest).');   // locked (#242)
}

/** Cards and their grocery rates. */
function grCardsAndRewards_() {
  var ss = getSpreadsheet(), cards = [], rewards = [];
  try {
    var cs = ss.getSheetByName(TABS.CREDIT_CARDS);
    if (cs && cs.getLastRow() >= 2) cards = cs.getRange(2, 1, cs.getLastRow() - 1, CREDIT_CARD_HEADERS.length).getValues().filter(function(r) { return r[1]; })
      .map(function(r) { return { name: String(r[1]).trim(), owner: String(r[7] || '').trim(), authUser: String(r[8] || '').trim(),
        active: !/^(no|false|closed)$/i.test(String(r[9] || '').trim()) }; });
    var rs = ss.getSheetByName(TABS.CARD_REWARDS);
    if (rs && rs.getLastRow() >= 2) rewards = rs.getRange(2, 1, rs.getLastRow() - 1, CARD_REWARD_HEADERS.length).getValues().filter(function(r) { return r[1]; })
      .map(function(r) { return { card: String(r[1]).trim(), category: String(r[2] || '').trim(), rate: Number(r[3]), rateType: String(r[4] || '').trim(), conditions: String(r[5] || '').trim() }; });
  } catch (e) { Logger.log('groceries: cards unavailable'); }
  return { cards: cards, rewards: rewards };
}

function grBudget_() {
  try { var b = webGetBudget_(); return b && b.ok ? grBudgetFrom_(b.rows) : null; } catch (e) { return null; }
}

// ---- endpoints -----------------------------------------------------------------------

/** GET grocery_setup&store → who can pay, each one's suggested card, the cards, whether the store counts, the month so far. */
function webGrocerySetup_(p) {
  var store = grStr_(p && p.store, 60), setting = grStoreSetting_(), cr = grCardsAndRewards_(), today = grToday_();
  var people = {};
  GR_PEOPLE_.forEach(function(w) { people[w] = { suggested: grBestCard_(cr.cards, cr.rewards, w), cards: grCardsFor_(cr.cards, w).map(function(c) { return c.name; }) }; });
  return { ok: true, store: store, counts: grIsGroceryStore_(store, setting), people: people,
    month: { spent: grMonthTotals_(grAll_(), today.slice(0, 7)).total, budget: grBudget_() } };
}

/** GET grocery_month&ym → the month's runs and totals, the budget and pace, what each card earned. */
function webGroceryMonth_(p) {
  var today = grToday_(), ym = /^\d{4}-\d{2}$/.test(String(p && p.ym || '')) ? p.ym : today.slice(0, 7);
  var runs = grAll_(), t = grMonthTotals_(runs, ym), budget = grBudget_(), cr = grCardsAndRewards_();
  var cards = Object.keys(t.byCard).map(function(c) {
    var rw = cr.rewards.filter(function(r) { return r.card === c && r.category.toLowerCase() === 'groceries'; })[0];
    return { card: c, total: Math.round(t.byCard[c] * 100) / 100, earned: grEarned_(t.byCard[c], rw) };
  }).sort(function(a, b) { return b.total - a.total; });
  var pace = ym === today.slice(0, 7) ? grPaceLine_(runs, today, budget) : null;
  return { ok: true, ym: ym, today: today, total: t.total, budget: budget, byWho: t.byWho, cards: cards, runs: t.runs, pace: pace,
    stores: grStoreList_((getShoppingList_() || []).map(function(s) { return s.storeName; }), grStoreSetting_()) };
}

/** POST {action:'grocery_log', run} → a run saved for today (or the date given). */
function webGroceryLog_(body) {
  var x = grClean_(body && body.run);
  if (!x.store) return { ok: false, error: 'Which store?' };
  if (!x.who) return { ok: false, error: 'Who went?' };
  if (x.total == null || x.total <= 0) return { ok: false, error: 'Enter the total' };
  if (!x.date) x.date = grToday_();
  return grLocked_(function() {
    var now = new Date().toISOString();
    x.id = 'GR-' + Utilities.getUuid().replace(/-/g, '').substring(0, 10).toUpperCase();
    grSheet_().appendRow(grRunToRow_(x, now, now));
    return { ok: true, run: x, month: grMonthTotals_(grAll_(), x.date.slice(0, 7)).total };
  });
}

/** POST {action:'grocery_update', run} → fixes a run's total, who, card, store or date. */
function webGroceryUpdate_(body) {
  var raw = (body && body.run) || {}, id = grStr_(raw.id, 40);
  return grLocked_(function() {
    var sh = grSheet_(), n = sh.getLastRow();
    var ids = n >= 2 ? sh.getRange(2, 1, n - 1, 1).getValues() : [];
    for (var k = 0; k < ids.length; k++) {
      if (String(ids[k][0]).trim() !== id) continue;
      var stored = grRowToRun_(sh.getRange(k + 2, 1, 1, GROCERY_RUN_HEADERS.length).getValues()[0]), merged = Object.assign({}, stored);
      Object.keys(raw).forEach(function(f) { if (raw[f] !== undefined) merged[f] = raw[f]; });
      var x = grClean_(merged);
      if (!x.who || x.total == null || x.total <= 0 || !x.date) return { ok: false, error: 'A run needs who went, a date and a total' };
      sh.getRange(k + 2, 1, 1, GROCERY_RUN_HEADERS.length).setValues([grRunToRow_(x, stored.created, new Date().toISOString())]);
      return { ok: true, run: x };
    }
    return { ok: false, error: 'That run no longer exists' };
  });
}

/** POST {action:'grocery_delete', id}. */
function webGroceryDelete_(body) {
  var id = grStr_(body && body.id, 40);
  return grLocked_(function() {
    var sh = grSheet_(), n = sh.getLastRow();
    var ids = n >= 2 ? sh.getRange(2, 1, n - 1, 1).getValues() : [];
    for (var k = 0; k < ids.length; k++) if (String(ids[k][0]).trim() === id) { sh.deleteRow(k + 2); return { ok: true, id: id }; }
    return { ok: false, error: 'That run no longer exists' };
  });
}

/** POST {action:'grocery_stores_save', stores: {store: true|false}} → which stores count. */
function webGroceryStoresSave_(body) {
  var raw = (body && body.stores) || {}, setting = Object.assign({}, grStoreSetting_());
  Object.keys(raw).slice(0, 40).forEach(function(s) {
    var name = grStr_(s, 60);
    if (!name || GR_NOT_STORES_.indexOf(name.toLowerCase()) !== -1) return;
    if (raw[s] === true) setting[name] = true; else delete setting[name];
  });
  grWriteConfig_(setting);
  return { ok: true, stores: setting };
}
