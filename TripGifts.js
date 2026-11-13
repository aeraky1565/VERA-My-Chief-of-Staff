// ============================================================
// VERA — TripGifts.js
// Travel › Travelers › Gifts (issue #227): what to bring, buy and bring home.
// ============================================================
//
// One row per gift in the Trip Gifts sheet. Three columns came later and are
// appended after the original seven, so old positional reads still line up:
//   Kind      host (bought before going) | souvenir (bought there) | us
//   Status    To buy | Bought | Packed. Purchased (Yes/No) is kept in step,
//             because My Trips and older readers still read it. A row from
//             before Status existed reads its Status from Purchased.
//   Packs As  fragile | liquid | food | none
//
// Also here:
//   - the trip's gift budget: a "Gifts" line in that trip's Trip Budget
//   - "given before": every gift bought, by who it went to, and the repeat
//     warning when the same name gets something alike again (names are free
//     text, matched as typed, ignoring case and spaces)
//   - ideas for a place: one Claude call per place, saved in Gift Place Ideas
//   - getting it home: liquids, alcohol, food to declare, what can't come in,
//     and the duty-free total (US rules, only when home is the United States)
//   - the Chat action gift_bought
//
// Two layers, so the tests need no Google: tg*_ pure helpers, then the
// web*TripGift*_ endpoints that read and write the sheets.
// ============================================================

var TG_KINDS_    = ['host', 'souvenir', 'us'];
var TG_STATUSES_ = ['To buy', 'Bought', 'Packed'];
var TG_PACKS_    = ['fragile', 'liquid', 'food', 'none'];
var TG_COL_ = { id: 0, tripKey: 1, recipient: 2, item: 3, amount: 4, purchased: 5, notes: 6, kind: 7, status: 8, packsAs: 9 };

// US returning residents: $800 each duty-free from most countries, and 1 L of
// alcohol each (21+). A reminder, not advice: the dashboard says to check.
var TG_US_DUTY_FREE_ = 800;
var TG_US_ALCOHOL_L_ = 1;
var TG_BOTTLE_L_     = 0.75;
var TG_ALCOHOL_RE_ = /\b(wine|port|whisk(?:e)?y|scotch|bourbon|vodka|gin|rum|liqueur|ouzo|raki|sake|soju|tequila|mezcal|brandy|cognac|armagnac|grappa|limoncello|ginjinha|madeira|sherry|champagne|prosecco|cava|beer|spirits?|arak)\b/i;
var TG_MEAT_RE_    = /\b(ham|jam[oó]n|prosciutto|salami|salame|chorizo|sausages?|jerky|biltong|meat|p[aâ]t[eé]|foie gras|bacon|cured|lard|bresaola|speck)\b/i;
var TG_FOOD_RE_    = /\b(cheese|tea|coffee|chocolate|sweets?|candy|cand(?:ies)|spices?|saffron|honey|olive oil|oil|sardines?|tuna|fish|cookies?|biscuits?|nuts?|dates|jam|sauce|pastr(?:y|ies)|vinegar|caviar|kit ?kats?|syrup)\b/i;
var TG_LIQUID_RE_  = /\b(oil|vinegar|syrup|perfume|cologne|cream|lotion|sauce|honey)\b/i;
var TG_STOP_ = { the: 1, and: 1, for: 1, with: 1, set: 1, box: 1, gift: 1, from: 1, pack: 1, small: 1, large: 1, mini: 1, bottle: 1, bottles: 1, two: 1, three: 1 };

// ---- pure ---------------------------------------------------------------------

function tgOneOf_(v, list, fallback) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  for (var i = 0; i < list.length; i++) if (list[i].toLowerCase() === s) return list[i];
  return fallback;
}

/** The status of a row: its Status cell, else read from Purchased (rows from before Status). */
function tgStatusOf_(statusCell, purchasedCell) {
  var s = tgOneOf_(statusCell, TG_STATUSES_, '');
  if (s) return s;
  return String(purchasedCell).trim().toLowerCase() === 'yes' || purchasedCell === true ? 'Bought' : 'To buy';
}

function tgKindOf_(v)  { return tgOneOf_(v, TG_KINDS_, 'souvenir'); }
function tgPacksOf_(v) { return tgOneOf_(v, TG_PACKS_, 'none'); }

function tgAmount_(v) {
  if (v === '' || v == null) return null;
  var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) && String(v).replace(/[^0-9]/g, '') !== '' ? Math.round(n * 100) / 100 : null;
}

/** A sheet row → the gift the dashboard reads. */
function tgRowToGift_(r) {
  var status = tgStatusOf_(r[TG_COL_.status], r[TG_COL_.purchased]);
  return {
    id:        String(r[TG_COL_.id] || '').trim(),
    tripKey:   String(r[TG_COL_.tripKey] || '').trim(),
    recipient: String(r[TG_COL_.recipient] || '').trim(),
    item:      String(r[TG_COL_.item] || '').trim(),
    amount:    tgAmount_(r[TG_COL_.amount]),
    purchased: status !== 'To buy',
    notes:     String(r[TG_COL_.notes] || '').trim(),
    kind:      tgKindOf_(r[TG_COL_.kind]),
    status:    status,
    packsAs:   tgPacksOf_(r[TG_COL_.packsAs]),
  };
}

/** A name as matched: case and spacing ignored, nothing else. */
function tgNameKey_(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

/** The words that make a gift what it is ("Azulejo tile coasters" → azulejo, tile, coaster). */
function tgWords_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9à-ÿ ]+/g, ' ').split(/\s+/)
    .map(function(w) { return w.length > 4 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w; })
    .filter(function(w, i, a) { return w.length >= 3 && !TG_STOP_[w] && a.indexOf(w) === i; });
}

/**
 * Every gift that was bought, grouped by who it went to, newest first in each.
 * labelOf(tripKey) → {label, year}. Names sorted A–Z; "Us" and blank names left out.
 */
function tgHistory_(gifts, labelOf) {
  var by = {}, order = [];
  (gifts || []).forEach(function(g) {
    if (!g || g.status === 'To buy' || g.kind === 'us') return;
    var key = tgNameKey_(g.recipient);
    if (!key || key === 'us') return;
    var t = labelOf ? labelOf(g.tripKey) : { label: g.tripKey, year: '' };
    if (!by[key]) { by[key] = { name: g.recipient.trim(), gifts: [] }; order.push(key); }
    by[key].gifts.push({ id: g.id, item: g.item, tripKey: g.tripKey, trip: t.label, year: t.year, start: String(g.tripKey || '').split('|')[0] });
  });
  return order.sort().map(function(k) {
    var p = by[k];
    p.gifts.sort(function(a, b) { return a.start < b.start ? 1 : a.start > b.start ? -1 : 0; });
    p.gifts.forEach(function(x) { delete x.start; });
    return p;
  });
}

/** Earlier gifts to the same name that share a word with this one (other trips only). */
function tgRepeats_(history, recipient, item, tripKey) {
  var key = tgNameKey_(recipient), words = tgWords_(item);
  if (!key || !words.length) return [];
  var person = (history || []).filter(function(p) { return tgNameKey_(p.name) === key; })[0];
  if (!person) return [];
  return person.gifts.filter(function(g) {
    if (tripKey && g.tripKey === tripKey) return false;
    var w = tgWords_(g.item);
    return words.some(function(x) { return w.indexOf(x) !== -1; });
  });
}

/** Spend against the gift budget: bought (and packed) vs planned. */
function tgBudget_(budget, gifts) {
  var bought = 0, planned = 0;
  (gifts || []).forEach(function(g) {
    if (g.amount == null) return;
    if (g.status === 'To buy') planned += g.amount; else bought += g.amount;
  });
  bought = Math.round(bought * 100) / 100; planned = Math.round(planned * 100) / 100;
  var b = budget == null || budget === '' ? null : Number(budget);
  return { budget: isFinite(b) && b > 0 ? b : null, bought: bought, planned: planned,
           left: isFinite(b) && b > 0 ? Math.round((b - bought - planned) * 100) / 100 : null };
}

/** What packing says an item is: what was chosen, else read from its name. */
function tgPacksFor_(g) {
  if (g.packsAs && g.packsAs !== 'none') return g.packsAs;
  if (TG_ALCOHOL_RE_.test(g.item) || TG_LIQUID_RE_.test(g.item)) return 'liquid';
  if (TG_FOOD_RE_.test(g.item) || TG_MEAT_RE_.test(g.item)) return 'food';
  return 'none';
}

/**
 * Getting it home. gifts: this trip's gifts; home: the home country; travellers: how many.
 * → {counts:{liquid,fragile,food}, rules:[{kind, title, text}], declare:{total, allowance}|null, us}
 * kind: checkin | ok | declare | avoid. Host gifts leave with you, so they are not brought back.
 */
function tgHomeCheck_(gifts, home, travellers) {
  var us = /^(united states|usa|us|united states of america)$/i.test(String(home || '').trim());
  var n = Math.max(1, Math.floor(Number(travellers) || 2));
  var back = (gifts || []).filter(function(g) { return g.kind !== 'host'; });
  var counts = { liquid: 0, fragile: 0, food: 0 };
  var liquids = [], foods = [], meats = [], alcohol = [];
  back.forEach(function(g) {
    var p = tgPacksFor_(g);
    if (counts[p] != null) counts[p]++;
    if (p === 'liquid') liquids.push(g.item);
    if (TG_MEAT_RE_.test(g.item)) meats.push(g.item);
    else if (p === 'food') foods.push(g.item);
    if (TG_ALCOHOL_RE_.test(g.item)) alcohol.push(g.item);
  });
  var rules = [];
  if (liquids.length) rules.push({ kind: 'checkin', title: liquids.join(', '),
    text: 'Over 100 ml goes in the checked bag, not the carry-on.' });
  if (counts.fragile) rules.push({ kind: 'checkin', title: counts.fragile + ' fragile',
    text: 'Pack them in the middle of the clothes, in the checked bag or as hand luggage.' });
  if (us && alcohol.length) {
    var litres = Math.round(alcohol.length * TG_BOTTLE_L_ * 100) / 100, free = n * TG_US_ALCOHOL_L_;
    rules.push({ kind: litres > free ? 'declare' : 'ok', title: 'Alcohol: about ' + litres + ' L',
      text: free + ' L comes in duty-free (' + TG_US_ALCOHOL_L_ + ' L each, 21+)' + (litres > free ? '; declare the rest, a small duty may apply.' : '.') });
  }
  if (us && foods.length) rules.push({ kind: 'declare', title: foods.join(', '),
    text: 'Food is declared on the customs form, even when it is allowed.' });
  if (us && meats.length) rules.push({ kind: 'avoid', title: meats.join(', '),
    text: 'Meat products can’t come into the US, cured or tinned: leave them off.' });
  var declare = null;
  if (us) {
    var total = 0;
    back.forEach(function(g) { if (g.status !== 'To buy' && g.amount != null) total += g.amount; });
    declare = { total: Math.round(total * 100) / 100, allowance: n * TG_US_DUTY_FREE_ };
  }
  return { counts: counts, rules: rules, declare: declare, us: us };
}

/** Claude's ideas for a place, cleaned: at most 10, known kinds and packing, no meat when home is the US. */
function tgCleanIdeas_(raw, us) {
  var list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.ideas) ? raw.ideas : []);
  var seen = {};
  return list.map(function(x) {
    x = x || {};
    return { item: String(x.item || '').trim().slice(0, 60), kind: tgKindOf_(x.kind), packsAs: tgPacksOf_(x.packsAs),
             note: String(x.note || '').trim().slice(0, 100) };
  }).filter(function(x) {
    var k = x.item.toLowerCase();
    if (!x.item || seen[k] || (us && TG_MEAT_RE_.test(x.item))) return false;
    seen[k] = 1; return true;
  }).slice(0, 10);
}

/** The place an idea list is kept under: the trip's name, lower-cased (the date part of a key dropped). */
function tgPlaceKey_(tripKeyOrPlace) {
  var s = String(tripKeyOrPlace || '');
  if (/^\d{4}-\d{2}-\d{2}\|/.test(s)) s = s.split('|').slice(1).join('|');
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The trip a Chat "bought" belongs to: the one under way today, else the one that
 * ended most recently within 7 days, else none. trips: [{key, startDate, endDate}].
 */
function tgChatTrip_(trips, today) {
  var on = (trips || []).filter(function(t) { return t.startDate && t.startDate <= today && (t.endDate || t.startDate) >= today; });
  if (on.length) return on.sort(function(a, b) { return a.startDate < b.startDate ? 1 : -1; })[0];
  var t0 = new Date(today + 'T12:00:00Z').getTime();
  var recent = (trips || []).filter(function(t) {
    var end = t.endDate || t.startDate; if (!end || end >= today) return false;
    return (t0 - new Date(end + 'T12:00:00Z').getTime()) / 86400000 <= 7;
  }).sort(function(a, b) { return (a.endDate || a.startDate) < (b.endDate || b.startDate) ? 1 : -1; });
  return recent[0] || null;
}

/** A gift on the list that a "bought X for Y" means: same name, a shared word, not yet bought. */
function tgMatchToBuy_(gifts, item, recipient) {
  var key = tgNameKey_(recipient), words = tgWords_(item);
  return (gifts || []).filter(function(g) {
    if (g.status !== 'To buy') return false;
    if (key && tgNameKey_(g.recipient) !== key) return false;
    var w = tgWords_(g.item);
    return words.some(function(x) { return w.indexOf(x) !== -1; });
  })[0] || null;
}

// ---- sheets -------------------------------------------------------------------

function tgSheet_() {
  var sheet = ensureSheet(getSpreadsheet(), TABS.TRIP_GIFTS, TRIP_GIFT_HEADERS);
  var have = sheet.getRange(1, 1, 1, TRIP_GIFT_HEADERS.length).getValues()[0];
  for (var i = 0; i < TRIP_GIFT_HEADERS.length; i++) {
    if (String(have[i] == null ? '' : have[i]).trim() !== TRIP_GIFT_HEADERS[i]) {
      sheet.getRange(1, 1, 1, TRIP_GIFT_HEADERS.length).setValues([TRIP_GIFT_HEADERS]); break;
    }
  }
  return sheet;
}

function tgAllRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, TRIP_GIFT_HEADERS.length).getValues();
}

function tgLocked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** The trip's gift budget: the Budgeted total of its "Gifts" lines in Trip Budget. */
function tgReadBudget_(tripKey) {
  var sheet = getSpreadsheet().getSheetByName(TABS.TRIP_BUDGET);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var total = 0, any = false;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, TRIP_BUDGET_HEADERS.length).getValues().forEach(function(r) {
    if (!r[0] || !tripRowIs_(r[1], r[TRIP_BUDGET_HEADERS.length - 1], tripKey) || String(r[2]).trim().toLowerCase() !== 'gifts') return;
    var n = Number(r[4]); if (isFinite(n)) { total += n; any = true; }
  });
  return any ? total : null;
}

function tgTravellers_(tripKey) {
  try { var m = webGetTripMeta_({ parameter: { tripKey: tripKey } }); return Number(m.tripTravellers) || 2; } catch (e) { return 2; }
}

function tgHome_() { return String(getConfigValues()['home_country'] || 'United States'); }

/** tripKey → {label, year}, for the history. */
function tgLabelOf_(tripKey) {
  var parts = String(tripKey || '').split('|');
  return { label: parts.slice(1).join('|') || tripKey, year: /^\d{4}/.test(parts[0]) ? parts[0].slice(0, 4) : '' };
}

// ---- endpoints ----------------------------------------------------------------

/**
 * GET get_trip_gifts — tripKey → {gifts, budget:{budget,bought,planned,left}, home:{…}}.
 * gifts keep the fields older readers use (purchased, amount) plus kind, status and packsAs.
 */
function webGetTripGifts_(e) {
  var tripKey = ((e.parameter || {}).tripKey || '').trim();
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  var gifts = tgAllRows_(getSpreadsheet().getSheetByName(TABS.TRIP_GIFTS))
    .filter(function(r) { return String(r[0]).trim() && tripRowIs_(r[1], r[TRIP_GIFT_HEADERS.length - 1], tripKey); })
    .map(tgRowToGift_);
  return { ok: true, gifts: gifts, budget: tgBudget_(tgReadBudget_(tripKey), gifts),
           home: tgHomeCheck_(gifts, tgHome_(), tgTravellers_(tripKey)) };
}

/** GET add_trip_gift — tripKey, item, recipient, amount, notes, kind, status, packsAs. */
function webAddTripGift_(e) {
  var p = e.parameter || {};
  var tripKey = tripKeyForWrite_((p.tripKey || '').trim());
  var item = (p.item || '').trim();
  if (!tripKey || !item) return { ok: false, error: 'tripKey and item required' };
  var status = tgOneOf_(p.status, TG_STATUSES_, 'To buy');
  var amount = tgAmount_(p.amount);
  var id = 'GIFT-' + Date.now();
  tgLocked_(function() {
    tgSheet_().appendRow([id, tripKey, (p.recipient || '').trim(), item, amount == null ? '' : amount,
      status === 'To buy' ? 'No' : 'Yes', (p.notes || '').trim(), tgKindOf_(p.kind), status, tgPacksOf_(p.packsAs)]);
  });
  return { ok: true, id: id };
}

/** GET update_trip_gift — id plus any of recipient, item, amount, notes, kind, packsAs, status (or the old purchased). */
function webUpdateTripGift_(e) {
  var p = e.parameter || {};
  var id = (p.id || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  return tgLocked_(function() {
    var sheet = tgSheet_();
    var rows = tgAllRows_(sheet);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() !== id) continue;
      var row = i + 2, set = function(col, v) { sheet.getRange(row, col + 1).setValue(v); };
      if (p.recipient !== undefined) set(TG_COL_.recipient, String(p.recipient).trim());
      if (p.item      !== undefined && String(p.item).trim()) set(TG_COL_.item, String(p.item).trim());
      if (p.amount    !== undefined) { var a = tgAmount_(p.amount); set(TG_COL_.amount, a == null ? '' : a); }
      if (p.notes     !== undefined) set(TG_COL_.notes, String(p.notes).trim());
      if (p.kind      !== undefined) set(TG_COL_.kind, tgKindOf_(p.kind));
      if (p.packsAs   !== undefined) set(TG_COL_.packsAs, tgPacksOf_(p.packsAs));
      var status = p.status !== undefined ? tgOneOf_(p.status, TG_STATUSES_, '')
        : p.purchased !== undefined ? (p.purchased === 'true' ? 'Bought' : 'To buy') : '';
      if (status) { set(TG_COL_.status, status); set(TG_COL_.purchased, status === 'To buy' ? 'No' : 'Yes'); }
      return { ok: true };
    }
    return { ok: false, error: 'not found' };
  });
}

function webDeleteTripGift_(e) {
  var id = ((e.parameter || {}).id || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  return tgLocked_(function() {
    var sheet = getSpreadsheet().getSheetByName(TABS.TRIP_GIFTS);
    if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'not found' };
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      if (String(data[i][0]).trim() === id) { sheet.deleteRow(i + 2); return { ok: true }; }
    }
    return { ok: false, error: 'not found' };
  });
}

/** GET set_trip_gift_budget — tripKey, budget (blank clears it). Writes the trip's "Gifts" line in Trip Budget. */
function webSetTripGiftBudget_(e) {
  var p = e.parameter || {};
  var tripKey = tripKeyForWrite_((p.tripKey || '').trim());
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  var budget = tgAmount_(p.budget);
  return tgLocked_(function() {
    var sheet = ensureSheet(getSpreadsheet(), TABS.TRIP_BUDGET, TRIP_BUDGET_HEADERS);
    var keys = tripKeysFor_(tripKey), rows = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, TRIP_BUDGET_HEADERS.length).getValues() : [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] && tripRowMatches_(rows[i][1], keys) && String(rows[i][2]).trim().toLowerCase() === 'gifts') {
        sheet.getRange(i + 2, 5).setValue(budget == null ? '' : budget);
        return { ok: true, budget: budget };
      }
    }
    if (budget == null) return { ok: true, budget: null };
    sheet.appendRow(['BI-' + Date.now(), tripKey, 'Gifts', 'Gifts', budget, '', 'Set from Travel › Gifts']);
    return { ok: true, budget: budget };
  });
}

/** GET trip_gift_history — every gift bought, by who it went to. */
function webTripGiftHistory_() {
  var gifts = tgAllRows_(getSpreadsheet().getSheetByName(TABS.TRIP_GIFTS)).filter(function(r) { return String(r[0]).trim(); }).map(tgRowToGift_);
  return { ok: true, people: tgHistory_(gifts, tgLabelOf_) };
}

/** GET trip_gift_check — recipient, item, tripKey → {repeats:[{item, trip, year}]}. */
function webTripGiftCheck_(e) {
  var p = e.parameter || {};
  var gifts = tgAllRows_(getSpreadsheet().getSheetByName(TABS.TRIP_GIFTS)).filter(function(r) { return String(r[0]).trim(); }).map(tgRowToGift_);
  return { ok: true, repeats: tgRepeats_(tgHistory_(gifts, tgLabelOf_), p.recipient, p.item, tripKeyForWrite_((p.tripKey || '').trim())) };
}

/**
 * GET trip_gift_ideas — tripKey (or place), refresh=1 to ask again →
 * {place, ideas:[{item, kind, packsAs, note}], saved}. One Claude call per place, kept in Gift Place Ideas.
 */
function webTripGiftIdeas_(e) {
  var p = e.parameter || {};
  var place = tgPlaceKey_(p.place || p.tripKey);
  if (!place) return { ok: false, error: 'tripKey or place required' };
  var us = tgHomeCheck_([], tgHome_(), 1).us;
  var sheet = ensureSheet(getSpreadsheet(), TABS.GIFT_PLACE_IDEAS, GIFT_PLACE_IDEAS_HEADERS);
  var rows = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues() : [];
  var at = -1;
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim().toLowerCase() === place) { at = i; break; }
  if (at !== -1 && String(p.refresh) !== '1') {
    var saved = []; try { saved = JSON.parse(rows[at][1] || '[]'); } catch (x) {}
    return { ok: true, place: place, ideas: tgCleanIdeas_(saved, us), saved: true };
  }
  var prompt = 'List what a traveller would bring home as gifts or souvenirs from this trip: "' + place + '". ' +
    'Think of what the place is known for, that can be packed and carried home' + (us ? ' to the United States (no meat products of any kind)' : '') + '. ' +
    'Answer with JSON only: {"ideas":[{"item":"short name","kind":"souvenir","packsAs":"fragile|liquid|food|none","note":"under 12 words"}]}, 6 to 8 ideas.';
  var r = callClaudeJsonDetailed_(prompt, { maxTokens: 700 });
  if (r.json == null) return { ok: false, error: 'Could not get ideas right now. Try again in a minute.' };
  var ideas = tgCleanIdeas_(r.json, us);
  tgLocked_(function() {
    var row = [place, JSON.stringify(ideas), new Date().toISOString()];
    if (at === -1) sheet.appendRow(row); else sheet.getRange(at + 2, 1, 1, 3).setValues([row]);
  });
  return { ok: true, place: place, ideas: ideas, saved: false };
}

/**
 * Chat: ACTION:gift_bought|{item}|{for}|{amount}. Ticks the matching gift on the
 * trip under way (or just ended), else adds it as a bought souvenir.
 * → a line for Chat's "done" list, or throws with a reason.
 */
function tgChatBought_(item, recipient, amount) {
  item = String(item || '').trim();
  if (!item) throw new Error('gift_bought: no item');
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var trips = [];
  try {
    (readTripRegistry_().rows || []).forEach(function(r) {
      if (r.status === 'active' && r.startDate && r.label) trips.push({ key: r.startDate + '|' + r.label, startDate: r.startDate, endDate: r.endDate || r.startDate });
    });
  } catch (x) {}
  var trip = tgChatTrip_(trips, today);
  if (!trip) throw new Error('gift_bought: no trip under way or just ended');
  var have = webGetTripGifts_({ parameter: { tripKey: trip.key } }).gifts || [];
  var match = tgMatchToBuy_(have, item, recipient);
  if (match) {
    var upd = { id: match.id, status: 'Bought' };
    if (amount !== undefined && String(amount).trim() !== '') upd.amount = amount;
    webUpdateTripGift_({ parameter: upd });
    return 'gift_bought (' + match.item + (match.recipient ? ' for ' + match.recipient : '') + ', ticked off)';
  }
  webAddTripGift_({ parameter: { tripKey: trip.key, item: item, recipient: recipient || '', amount: amount || '', kind: 'souvenir', status: 'Bought' } });
  return 'gift_bought (' + item + (recipient ? ' for ' + recipient : '') + ', added)';
}
