// ============================================================
// VERA — PackPlus.js
// Packing, enriched (issue #234). Builds on Luggage.js (#230) and LeavingHome.js (#231).
// ============================================================
//
// The list is still built as before (webGeneratePacking_: destination, dates,
// weather, trip type, briefing, itinerary, dress codes, travellers, lessons).
// This adds:
//   three-step ticks   to buy → ready → in the bag, shared, with who and when;
//                      the Checked column stays in step (in the bag = TRUE)
//   quantities         "× 5: 8 nights, laundry once", from nights, laundry, weather
//   staples            each profile's "Always pack", plus ones on every past list
//                      (suggested; accepting puts them on the profile)
//   past trips         similar earlier lists, copied without what went unused
//   outfits by day     one Claude call per trip, from the itinerary and forecast;
//                      their pieces can be added to the list with counts
//   buy before you go  "to buy" items go to a "Trip: <name>" Shopping tab; ticked
//                      bought there brings them back as ready
//   leave nothing behind  a checkout list from the stays and what was packed,
//                      shared ticks (a "checkout" row in Leaving Home Runs)
//   after the trip     didn't use / forgot / bought there, saved as packing lessons
//
// Two layers: pk*_ pure helpers, then the reads and the routes.
// ============================================================

var PK_STATUSES_ = ['buy', 'ready', 'bag'];
var PK_COL_ = { checked: 6, status: 9, qty: 10, why: 11, by: 12, at: 13 };
var PK_DAILY_RE_ = /\b(underwear|socks|boxers|briefs|bras?|t-?shirts?|tees?|tops?|vests?)\b/i;
var PK_BOTTOM_RE_ = /\b(pants|trousers|jeans|chinos|shorts|skirts?|leggings)\b/i;
var PK_SLEEP_RE_ = /\b(pajamas|pyjamas|pjs|nightgown)\b/i;
var PK_SWIM_RE_ = /\b(swim\w*|bikinis?|trunks)\b/i;
var PK_WARM_RE_ = /\b(sweaters?|hoodies?|fleeces?|cardigans?|jumpers?)\b/i;
var PK_DRESS_RE_ = /\bdress(es)?\b(?! shoes)/i;
var PK_REWEAR_RE_ = /\b(pants|trousers|jeans|chinos|shorts|skirts?|sweaters?|hoodies?|fleeces?|cardigans?|jackets?|coats?|blazers?|shoes|loafers|sneakers|trainers|boots|sandals|heels|flats|belts?|hats?|caps?|scarf|scarves)\b/i;
var PK_CHECKOUT_BASE_ = [
  ['safe', 'Passports and valuables from the safe'], ['bath', 'Bathroom: shelves, the shower, the counter'],
  ['fridge', 'Fridge and freezer'], ['beds', 'Under the beds, behind the doors'], ['wardrobe', 'Wardrobe, drawers and hooks'],
  ['keys', 'Keys or cards handed back'],
];

// ---- pure ---------------------------------------------------------------------

function pkStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function pkSame_(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

/** A row's step: the Status cell when set, else from the old Checked column. */
function pkStatusOf_(status, checked) {
  var s = String(status || '').trim().toLowerCase();
  if (PK_STATUSES_.indexOf(s) !== -1) return s;
  return String(checked).toUpperCase() === 'TRUE' ? 'bag' : 'ready';
}

/** An item's name for matching: lower case, no counts, no plural s. */
function pkNorm_(text) {
  return String(text || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[×x]\s?\d+|\d+\s?[×x]|\b\d+\b/g, ' ')
    .replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').map(function(w) { return w.length > 3 ? w.replace(/(es|s)$/, '') : w; }).join(' ');
}

/**
 * How many of a clothing item, and why. o: {nights, laundry, hiF, loF}. null when it isn't counted
 * or the item names its own count.
 */
function pkQtyFor_(item, o) {
  var s = String(item || '');
  if (/\d/.test(s)) return null;
  var nights = Math.max(0, Number(o.nights) || 0), days = nights + 1, laundry = !!o.laundry;
  var base = nights + ' night' + (nights === 1 ? '' : 's');
  if (PK_DAILY_RE_.test(s)) {
    if (laundry && days > 5) return { qty: Math.min(days, Math.ceil(days / 2) + 1), why: base + ', laundry once' };
    if (days > 10) return { qty: 10, why: base + ': wash once there' };
    return { qty: days, why: base };
  }
  if (PK_DRESS_RE_.test(s)) return { qty: Math.min(3, Math.max(1, Math.ceil(days / 3))), why: base + ', each worn a few times' };
  if (PK_BOTTOM_RE_.test(s)) return { qty: Math.min(4, Math.max(1, Math.ceil(days / 3))), why: base + ', each worn a few times' };
  if (PK_SLEEP_RE_.test(s)) return { qty: days >= 5 ? 2 : 1, why: base };
  if (PK_SWIM_RE_.test(s)) return { qty: nights >= 4 && Number(o.hiF) >= 75 ? 2 : 1, why: nights >= 4 && Number(o.hiF) >= 75 ? 'Warm, so one drying' : base };
  if (PK_WARM_RE_.test(s)) return o.loF !== undefined && o.loF !== null && Number(o.loF) < 55 ? { qty: 2, why: 'Lows near ' + Math.round(o.loF) + '°F' } : { qty: 1, why: o.loF != null ? 'Evenings ' + Math.round(o.loF) + '°F' : 'For the evenings' };
  return null;
}

/** "Always pack" values from the profiles: {person: [items]}. */
function pkProfileStaples_(items) {
  var out = {};
  (items || []).forEach(function(i) {
    if (i.section !== 'preference' || i.kind !== 'always_pack') return;
    var list = out[i.person] = out[i.person] || [];
    String(i.value || '').split(/\s*[,;\n]\s*/).forEach(function(x) { x = pkStr_(x, 80); if (x && !list.some(function(y) { return pkSame_(y, x); })) list.push(x); });
  });
  return out;
}

/**
 * Staples VERA sees on every list: items on at least 3 of a person's past trips and on 80% of them.
 * rows: [{tripKey, person, item}] across trips. → {person key: [items]}
 */
function pkLearnedStaples_(rows, minTrips) {
  var trips = {}, seen = {}, names = {};
  (rows || []).forEach(function(r) {
    var p = String(r.person || '').toLowerCase(), n = pkNorm_(r.item);
    if (!p || p === 'shared' || !n) return;
    trips[p] = trips[p] || {}; trips[p][r.tripKey] = 1;
    seen[p] = seen[p] || {}; seen[p][n] = seen[p][n] || {}; seen[p][n][r.tripKey] = 1;
    names[p + '|' + n] = names[p + '|' + n] || pkStr_(r.item, 80).replace(/\s*[×x]\s?\d+$/, '');
  });
  var out = {};
  Object.keys(seen).forEach(function(p) {
    var total = Object.keys(trips[p]).length;
    if (total < (minTrips || 3)) return;
    out[p] = Object.keys(seen[p]).filter(function(n) { var c = Object.keys(seen[p][n]).length; return c >= 3 && c / total >= 0.8; })
      .map(function(n) { return names[p + '|' + n]; }).sort();
  });
  return out;
}

/** How alike two trips are. t: {tripKey, label, start, nights, traits:[...]} → {score, why:[...]} */
function pkSimilarity_(t, past) {
  var score = 0, why = [];
  var shared = (t.traits || []).filter(function(x) { return (past.traits || []).indexOf(x) !== -1; });
  if (shared.length) { score += 3 * shared.length; why.push(shared.join(', ')); }
  var m1 = Number(String(t.start || '').slice(5, 7)), m2 = Number(String(past.start || '').slice(5, 7));
  if (m1 && m2) { var d = Math.min(Math.abs(m1 - m2), 12 - Math.abs(m1 - m2)); if (d <= 1) { score += 2; why.push('same time of year'); } }
  var dn = Math.abs((Number(t.nights) || 0) - (Number(past.nights) || 0));
  if (dn <= 2) { score += 2; why.push(past.nights + ' nights'); } else if (dn <= 4) score += 1;
  var words = function(s) { return String(s || '').toLowerCase().split(/[^a-z]+/).filter(function(w) { return w.length > 3; }); };
  if (words(t.label).some(function(w) { return words(past.label).indexOf(w) !== -1; })) { score += 3; why.unshift('same place'); }
  return { score: score, why: why };
}

/** What to copy from a past list: not already on this one, not unused last time. */
function pkCopyPlan_(fromItems, haveItems, unused) {
  var have = {}; (haveItems || []).forEach(function(i) { have[String(i.person).toLowerCase() + '|' + pkNorm_(i.item)] = 1; });
  var skip = {}; (unused || []).forEach(function(n) { skip[pkNorm_(n)] = 1; });
  var out = [], skipped = [];
  (fromItems || []).forEach(function(i) {
    var k = String(i.person).toLowerCase() + '|' + pkNorm_(i.item);
    if (have[k]) return;
    if (skip[pkNorm_(i.item)]) { skipped.push(i.item); return; }
    have[k] = 1;
    out.push({ person: String(i.person).toLowerCase(), category: i.category || 'General', item: i.item });
  });
  return { add: out, skipped: skipped };
}

/** An outfit plan from Claude, cleaned. → {people:[{name, days:[{date, label, weather, looks:[{when, pieces:[...], note}]}]}]} */
function pkCleanOutfits_(raw, travellers) {
  var people = (raw && Array.isArray(raw.people)) ? raw.people : [];
  return { people: people.slice(0, 6).map(function(p) {
    return { name: pkStr_(p.name, 40), days: (Array.isArray(p.days) ? p.days : []).slice(0, 31).map(function(d) {
      return { date: /^\d{4}-\d{2}-\d{2}$/.test(String(d.date)) ? String(d.date) : '', label: pkStr_(d.label, 60), weather: pkStr_(d.weather, 40),
        looks: (Array.isArray(d.looks) ? d.looks : []).slice(0, 4).map(function(l) {
          return { when: pkStr_(l.when, 60), pieces: (Array.isArray(l.pieces) ? l.pieces : []).map(function(x) { return pkStr_(x, 50); }).filter(String).slice(0, 8), note: pkStr_(l.note, 120) };
        }).filter(function(l) { return l.pieces.length; }) };
    }).filter(function(d) { return d.looks.length; }) };
  }).filter(function(p) { return p.name && p.days.length && (!(travellers || []).length || travellers.some(function(t) { return pkSame_(t, p.name); })); }) };
}

/** The pieces an outfit plan needs: re-worn pieces counted once per three uses. → [{item, qty, why}] */
function pkOutfitPieces_(person) {
  var by = {}, order = [];
  (person.days || []).forEach(function(d) {
    d.looks.forEach(function(l) {
      l.pieces.forEach(function(x) {
        var n = pkNorm_(x);
        if (!n) return;
        if (!by[n]) { by[n] = { item: x.charAt(0).toUpperCase() + x.slice(1), uses: 0, whens: [] }; order.push(n); }
        by[n].uses++;
        if (by[n].whens.length < 2) by[n].whens.push((d.label || d.date) + (l.when ? ' ' + l.when.toLowerCase() : ''));
      });
    });
  });
  return order.map(function(n) {
    var p = by[n], qty = PK_REWEAR_RE_.test(p.item) ? Math.max(1, Math.ceil(p.uses / 3)) : p.uses;
    return { item: p.item, qty: qty, why: 'From outfits: ' + p.whens.join(', ') + (p.uses > 2 ? ' and ' + (p.uses - 2) + ' more' : '') };
  });
}

/**
 * The checkout list. o: {stays:[{name}], packed:[{item, person}], staples:[...], homeGifts:n}
 * → [{key, text, meta}]
 */
function pkCheckoutItems_(o) {
  o = o || {};
  var packed = o.packed || [], out = [];
  var has = function(re) { return packed.filter(function(p) { return re.test(p.item); }); };
  var where = (o.stays || []).map(function(s) { return s.name; }).filter(String);
  var chargers = has(/\b(chargers?|cables?|power ?banks?|batter(y|ies))\b/i);
  if (chargers.length) out.push({ key: 'chargers', text: 'Chargers and cables off the wall', meta: 'You packed ' + chargers.length + ': ' + chargers.slice(0, 3).map(function(c) { return c.item; }).join(', ') });
  PK_CHECKOUT_BASE_.forEach(function(b) { out.push({ key: b[0], text: b[1], meta: b[0] === 'keys' && where.length ? where[where.length - 1] : '' }); });
  var adapters = has(/\badapters?\b/i);
  if (adapters.length) out.push({ key: 'adapters', text: 'Plug adapters', meta: adapters.map(function(a) { return a.item; }).join(', ') });
  var meds = has(/\b(meds?|medicines?|medication|prescriptions?|pills|inhaler|insulin|retainer|contacts?|lenses)\b/i);
  var staples = (o.staples || []).concat(meds.map(function(m) { return m.item; }));
  var uniq = []; staples.forEach(function(s) { if (!uniq.some(function(u) { return pkSame_(u, s); })) uniq.push(s); });
  if (uniq.length) out.push({ key: 'staples', text: 'Meds and staples', meta: uniq.slice(0, 5).join(', ') });
  if (o.homeGifts) out.push({ key: 'gifts', text: 'Gifts and souvenirs packed', meta: o.homeGifts + ' coming home' });
  return out;
}

/** Packing lessons from an after-trip review. → [{text, detail}] */
function pkReviewLessons_(r, label) {
  var out = [];
  if ((r.unused || []).length) out.push({ text: 'Pack less: ' + r.unused.join(', '), detail: 'Came home unused from ' + label });
  if ((r.forgot || []).length) out.push({ text: 'Remember: ' + r.forgot.join(', '), detail: 'Forgotten on ' + label });
  if ((r.bought || []).length) out.push({ text: 'Pack it, don’t buy it: ' + r.bought.join(', '), detail: 'Bought there on ' + label });
  return out;
}

// ---- reads ----------------------------------------------------------------------

function pkLocked_(fn) { var l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }
function pkTz_() { return Session.getScriptTimeZone(); }
function pkStamp_() { return Utilities.formatDate(new Date(), pkTz_(), 'yyyy-MM-dd HH:mm'); }
function pkToday_() { return Utilities.formatDate(new Date(), pkTz_(), 'yyyy-MM-dd'); }
function pkKeyMatch_(cell, tripKey) { return tripKeyMatches_(cell, tripKey); }   // Trips.js: the trip's current key or any it had
function pkNights_(a, b) { var x = Date.parse(String(a || '') + 'T00:00:00Z'), y = Date.parse(String(b || '') + 'T00:00:00Z'); return isFinite(x) && isFinite(y) && y > x ? Math.round((y - x) / 86400000) : 0; }
function pkLabel_(tripKey) { var i = String(tripKey).indexOf('|'); return i >= 0 ? String(tripKey).slice(i + 1) : String(tripKey); }
function pkStart_(tripKey) { var m = String(tripKey).match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ''; }

/** The packing sheet, with the five #234 columns in place. */
function pkSheet_() {
  var sh = getSpreadsheet().getSheetByName(TABS.PACKING_ITEMS);
  if (!sh) sh = ensureSheet(getSpreadsheet(), TABS.PACKING_ITEMS, PACKING_ITEM_HEADERS);
  var head = sh.getRange(1, 1, 1, PACKING_ITEM_HEADERS.length).getValues()[0];
  if (String(head[PACKING_ITEM_HEADERS.length - 1] || '') !== PACKING_ITEM_HEADERS[PACKING_ITEM_HEADERS.length - 1]) {
    sh.getRange(1, 1, 1, PACKING_ITEM_HEADERS.length).setValues([PACKING_ITEM_HEADERS]);
  }
  return sh;
}
function pkRow_(r, i) {
  return { _row: i + 2, id: String(r[0]).trim(), tripKey: String(r[1]).trim(), person: String(r[2] || '').trim(), category: String(r[3] || '').trim(), item: String(r[4] || '').trim(),
    status: pkStatusOf_(r[8], r[5]), qty: Number(r[9]) > 0 ? Number(r[9]) : '', why: pkStr_(r[10], 160), by: pkStr_(r[11], 40), at: pkStr_(r[12], 20), source: String(r[6] || '').trim() || 'manual' };
}
function pkAllRows_() {
  var sh = pkSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues().map(pkRow_).filter(function(r) { return r.id && r.item; });
}
function pkTripRows_(tripKey) { return pkAllRows_().filter(function(r) { return pkKeyMatch_(r.tripKey, tripKey); }); }

function pkNewId_(sh, seqHint) {
  var dateKey = Utilities.formatDate(new Date(), pkTz_(), 'yyyyMMdd'), seq = 1;
  if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function(r) { if (String(r[0]).indexOf('PACK-' + dateKey) === 0) seq++; });
  return 'PACK-' + dateKey + '-' + String(seq + (seqHint || 0)).padStart(2, '0');
}
/** Appends items: [{person, category, item, qty, why, source, status}]. */
function pkAppend_(tripKey, items) {
  if (!items.length) return 0;
  var sh = pkSheet_(), added = pkToday_(), tid = (typeof tripIdCell_ === 'function' ? tripIdCell_(tripKey) : '');
  var rows = items.map(function(x, i) {
    return [pkNewId_(sh, i), tripKey, x.person, x.category || 'General', x.item, x.status === 'bag' ? 'TRUE' : 'FALSE', x.source || 'manual', added, x.status || 'ready', x.qty || '', x.why || '', '', '', tid];
  });
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, PACKING_ITEM_HEADERS.length).setValues(rows);
  return rows.length;
}

function pkTravellers_(tripKey) {
  var t = [];
  try { t = typeof teTravellersForKey_ === 'function' ? teTravellersForKey_(tripKey) : []; } catch (e) {}
  return t.length ? t : ['Ahmed', 'Victoria'];
}
function pkTraits_(tripKey) {
  try { return String((webGetTripMeta_({ parameter: { tripKey: tripKey } }) || {}).characteristics || '').split(/\s*,\s*/).filter(String); } catch (e) { return []; }
}
function pkLaundry_(tripKey) {
  try { var m = webGetTripMeta_({ parameter: { tripKey: tripKey } }) || {}; return /\b(laundry|washer|washing machine)\b/i.test(String(m.notes || '') + ' ' + String(m.context || '')); } catch (e) { return false; }
}
/** Highs and lows from a weather summary ("Expected: 61–81°F, dry."): {loF, hiF}. */
function pkTempsFrom_(summary) {
  var m = String(summary || '').match(/(-?\d{1,3})\s*[–-]\s*(-?\d{1,3})\s*°\s*F/);
  return m ? { loF: Number(m[1]), hiF: Number(m[2]), summary: String(summary) } : { summary: String(summary || '') };
}
/** The forecast for a trip, when there is one. Never fails. */
function pkTemps_(tripKey, startDate, endDate) {
  try {
    if (typeof tripPlaces_ !== 'function' || typeof genTripWeather_ !== 'function') return {};
    return pkTempsFrom_((genTripWeather_(tripPlaces_([], tripKey, pkLabel_(tripKey), endDate), startDate, endDate) || {}).summary);
  } catch (e) { return {}; }
}

/** After a list is made or copied: staples added, clothing counted. Never fails the caller. */
function pkAfterGenerate_(tripKey, startDate, endDate, temps) {
  try {
    var rows = pkTripRows_(tripKey), nights = pkNights_(startDate, endDate), laundry = pkLaundry_(tripKey);
    temps = temps || {};
    var sh = pkSheet_();
    rows.forEach(function(r) {
      if (r.qty) return;
      var q = pkQtyFor_(r.item, { nights: nights, laundry: laundry, hiF: temps.hiF, loF: temps.loF });
      if (q) sh.getRange(r._row, PK_COL_.qty, 1, 2).setValues([[q.qty, q.why]]);
    });
    var staples = pkProfileStaples_(typeof tpItems_ === 'function' ? tpItems_() : []), add = [];
    pkTravellers_(tripKey).forEach(function(name) {
      (staples[name] || []).forEach(function(s) {
        var key = String(name).toLowerCase();
        if (rows.some(function(r) { return String(r.person).toLowerCase() === key && pkNorm_(r.item) === pkNorm_(s); })) return;
        add.push({ person: key, category: 'Staples', item: s, source: 'staple', why: 'Staple · from your profile' });
      });
    });
    pkAppend_(tripKey, add);
    return { staples: add.length };
  } catch (e) { Logger.log('pkAfterGenerate_: ' + e.message); return { error: e.message }; }
}

// ---- routes: the list -----------------------------------------------------------

/** POST pk_status {id, status, by}: to buy → ready → in the bag, shared, with who and when. */
function webPkStatus_(body) {
  body = body || {};
  var id = pkStr_(body.id, 60), st = String(body.status || '').toLowerCase();
  if (!id || PK_STATUSES_.indexOf(st) === -1) return { ok: false, error: 'id and status (buy, ready or bag) required' };
  return pkLocked_(function() {
    var r = pkAllRows_().filter(function(x) { return x.id === id; })[0];
    if (!r) return { ok: false, error: 'That item isn’t on the list any more.' };
    var sh = pkSheet_();
    sh.getRange(r._row, PK_COL_.checked).setValue(st === 'bag' ? 'TRUE' : 'FALSE');
    sh.getRange(r._row, PK_COL_.status).setValue(st);
    sh.getRange(r._row, PK_COL_.by, 1, 2).setValues([[pkStr_(body.by, 40), pkStamp_()]]);
    var shop = '';
    if (st === 'buy') shop = pkToShopping_(r);
    return { ok: true, id: id, status: st, shopping: shop };
  });
}

/** POST pk_qty {id, qty}: blank clears it. */
function webPkQty_(body) {
  body = body || {};
  var id = pkStr_(body.id, 60), raw = String(body.qty == null ? '' : body.qty).trim(), q = raw === '' ? '' : Math.round(Number(raw));
  if (!id) return { ok: false, error: 'id required' };
  if (q !== '' && !(q >= 1 && q <= 30)) return { ok: false, error: 'How many: a number from 1 to 30.' };
  return pkLocked_(function() {
    var r = pkAllRows_().filter(function(x) { return x.id === id; })[0];
    if (!r) return { ok: false, error: 'That item isn’t on the list any more.' };
    pkSheet_().getRange(r._row, PK_COL_.qty, 1, 2).setValues([[q, q === '' ? '' : (q === r.qty ? r.why : 'Set by hand')]]);
    return { ok: true, id: id, qty: q };
  });
}

/** POST pk_add {tripKey, person, category, item, qty?, status?}. */
function webPkAdd_(body) {
  body = body || {};
  var tripKey = pkStr_(body.tripKey, 200), item = pkStr_(body.item, 120), person = String(body.person || 'shared').toLowerCase();
  if (!tripKey || !item) return { ok: false, error: 'Type the item to add.' };
  var st = PK_STATUSES_.indexOf(String(body.status)) !== -1 ? String(body.status) : 'ready';
  return pkLocked_(function() {
    pkAppend_(tripKey, [{ person: person, category: pkStr_(body.category, 40) || 'General', item: item, qty: Number(body.qty) > 0 ? Math.round(Number(body.qty)) : '', status: st, source: 'manual' }]);
    var r = pkTripRows_(tripKey).slice(-1)[0];
    if (st === 'buy' && r) pkToShopping_(r);
    return { ok: true, id: r ? r.id : '' };
  });
}

// ---- staples -------------------------------------------------------------------------

/** GET pk_staples: each person's profile staples and the ones VERA would suggest. */
function webPkStaples_() {
  var items = typeof tpItems_ === 'function' ? tpItems_() : [];
  var today = pkToday_(), prof = pkProfileStaples_(items), learned = pkLearnedStaples_(pkAllRows_().filter(function(r) { return pkStart_(r.tripKey) < today; }));   // past trips only
  var names = []; items.forEach(function(i) { if (i.section !== 'child' && names.indexOf(i.person) === -1) names.push(i.person); });
  ['Ahmed', 'Victoria'].forEach(function(n) { if (!names.some(function(x) { return pkSame_(x, n); })) names.push(n); });
  return { ok: true, people: names.map(function(n) {
    var mine = prof[n] || [];
    return { name: n, profile: mine, suggested: (learned[n.toLowerCase()] || []).filter(function(s) { return !mine.some(function(m) { return pkNorm_(m) === pkNorm_(s); }); }) };
  }) };
}

/** POST pk_staple_accept {person, item}: onto the profile's "Always pack". */
function webPkStapleAccept_(body) {
  body = body || {};
  var person = pkStr_(body.person, 60), item = pkStr_(body.item, 80);
  if (!person || !item) return { ok: false, error: 'person and item required' };
  var have = (typeof tpItems_ === 'function' ? tpItems_() : []).filter(function(i) { return pkSame_(i.person, person) && i.section === 'preference' && i.kind === 'always_pack'; })[0];
  var value = have ? (have.value ? have.value + ', ' : '') + item : item;
  var r = webTpSave_({ id: have ? have.id : '', person: have ? have.person : person, section: 'preference', kind: 'always_pack', value: value, notes: have ? have.notes : '' });
  return r.ok ? { ok: true, person: person, value: value } : r;
}

// ---- past trips ----------------------------------------------------------------------

/** GET pk_similar {tripKey, startDate, endDate}: past trips with a list, most alike first. */
function webPkSimilar_(p) {
  p = p || {};
  var tripKey = pkStr_(p.tripKey, 200);
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  var me = { label: pkLabel_(tripKey), start: pkStr_(p.startDate, 10) || pkStart_(tripKey), nights: pkNights_(p.startDate, p.endDate), traits: pkTraits_(tripKey) };
  var by = {}, today = pkToday_();
  pkAllRows_().forEach(function(r) {
    if (pkKeyMatch_(r.tripKey, tripKey) || pkStart_(r.tripKey) >= (me.start || today)) return;
    (by[r.tripKey] = by[r.tripKey] || []).push(r);
  });
  var reg = {};
  try { (readTripRegistry_().rows || []).forEach(function(t) { reg[t.startDate + '|' + t.label] = t; }); } catch (e) {}
  var list = Object.keys(by).map(function(k) {
    var t = reg[k] || {}, past = { label: pkLabel_(k), start: pkStart_(k), nights: pkNights_(pkStart_(k), t.endDate), traits: pkTraits_(k) };
    var s = pkSimilarity_(me, past), unused = pkReviewFor_(k).unused || [];
    return { tripKey: k, label: past.label, start: past.start, nights: past.nights, items: by[k].length, score: s.score, why: s.why.concat(unused.length ? ['you didn’t use ' + unused.length + ' thing' + (unused.length === 1 ? '' : 's')] : []).join(' · ') };
  }).sort(function(a, b) { return b.score - a.score || (a.start < b.start ? 1 : -1); }).slice(0, 5);
  return { ok: true, trips: list };
}

/** POST pk_copy {tripKey, startDate, endDate, from}: the past list, without what went unused. */
function webPkCopy_(body) {
  body = body || {};
  var tripKey = pkStr_(body.tripKey, 200), from = pkStr_(body.from, 200);
  if (!tripKey || !from) return { ok: false, error: 'tripKey and from required' };
  return pkLocked_(function() {
    var plan = pkCopyPlan_(pkTripRows_(from), pkTripRows_(tripKey), pkReviewFor_(from).unused);
    pkAppend_(tripKey, plan.add.map(function(x) { return { person: x.person, category: x.category, item: x.item, source: 'copy', why: 'From ' + pkLabel_(from) }; }));
    var after = pkAfterGenerate_(tripKey, pkStr_(body.startDate, 10), pkStr_(body.endDate, 10));
    return { ok: true, added: plan.add.length, skipped: plan.skipped, staples: after.staples || 0 };
  });
}

// ---- outfits ---------------------------------------------------------------------------

function pkOutfitSheet_() { return ensureSheet(getSpreadsheet(), TABS.TRIP_OUTFITS, TRIP_OUTFIT_HEADERS); }
function pkOutfitsFor_(tripKey) {
  var sh = getSpreadsheet().getSheetByName(TABS.TRIP_OUTFITS);
  if (!sh || sh.getLastRow() < 2) return null;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, TRIP_OUTFIT_HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) if (pkKeyMatch_(rows[i][0], tripKey)) { try { return { plan: JSON.parse(rows[i][1] || '{}'), updated: String(rows[i][2] || ''), _row: i + 2 }; } catch (e) { return null; } }
  return null;
}
function pkWithPieces_(plan) { return { people: (plan.people || []).map(function(p) { return { name: p.name, days: p.days, pieces: pkOutfitPieces_(p) }; }) }; }

/** GET pk_outfits {tripKey}. */
function webPkOutfits_(p) {
  var tripKey = pkStr_(p && p.tripKey, 200);
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  var o = pkOutfitsFor_(tripKey);
  return { ok: true, has: !!o, updated: o ? o.updated : '', people: o ? pkWithPieces_(o.plan).people : [] };
}

/** POST pk_outfits_make {tripKey, startDate, endDate}: one Claude call from the itinerary and the forecast. */
function webPkOutfitsMake_(body) {
  body = body || {};
  var tripKey = pkStr_(body.tripKey, 200), startDate = pkStr_(body.startDate, 10), endDate = pkStr_(body.endDate, 10) || startDate;
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  var items = [];
  try { items = tripItemsFor_(tripKey, startDate, endDate, 'pk_outfits'); } catch (e) {}
  var lines = items.slice(0, 60).map(function(it) {
    var m = {}; try { m = JSON.parse(it.metadata || '{}') || {}; } catch (e) {}
    return '- ' + it.date + ' [' + it.type + '] ' + it.title + (it.location ? ' @ ' + it.location : '') + (m.dresscode ? ' (dress code: ' + m.dresscode + ')' : '');
  });
  var temps = pkTemps_(tripKey, startDate, endDate), travellers = pkTravellers_(tripKey), traits = pkTraits_(tripKey);
  var prompt = 'Plan what to wear each day of this trip, for each traveller: ' + travellers.join(' and ') + '.\n' +
    'Trip: ' + pkLabel_(tripKey) + ', ' + startDate + ' to ' + endDate + ' (' + pkNights_(startDate, endDate) + ' nights)' + (traits.length ? ', ' + traits.join(', ') : '') + '.\n' +
    'Weather: ' + (temps.summary || 'unknown: plan for the season') + '.\n' +
    'Itinerary:\n' + (lines.join('\n') || '(nothing yet: plan by day)') + '\n' +
    'Re-wear pieces where it makes sense (trousers, shoes, sweaters). Put the heaviest shoes and layers on travel days. Follow any dress code.\n' +
    'Answer with JSON only: {"people":[{"name":"<traveller>","days":[{"date":"YYYY-MM-DD","label":"short day name, e.g. Sintra day trip","weather":"about 75° / 62°F","looks":[{"when":"Day|Evening|Flight|Dinner at <place>","pieces":["short piece names"],"note":"under 12 words, or empty"}]}]}]}';
  var r = callClaudeJsonDetailed_(prompt, { maxTokens: 3500 });
  if (r.json == null) return { ok: false, error: 'Couldn’t plan the outfits right now. Try again in a minute.' };
  var plan = pkCleanOutfits_(r.json, travellers);
  if (!plan.people.length) return { ok: false, error: 'The plan came back empty. Try again in a minute.' };
  pkLocked_(function() {
    var have = pkOutfitsFor_(tripKey), sh = pkOutfitSheet_(), row = [tripKey, JSON.stringify(plan), pkStamp_(), (typeof tripIdCell_ === 'function' ? tripIdCell_(tripKey) : '')];
    if (have) sh.getRange(have._row, 1, 1, TRIP_OUTFIT_HEADERS.length).setValues([row]); else sh.appendRow(row);
  });
  return { ok: true, has: true, updated: pkStamp_(), people: pkWithPieces_(plan).people };
}

/** POST pk_outfits_add {tripKey, person}: the outfit pieces onto the list, with counts. Ticked items keep their tick. */
function webPkOutfitsAdd_(body) {
  body = body || {};
  var tripKey = pkStr_(body.tripKey, 200), person = pkStr_(body.person, 60);
  var o = pkOutfitsFor_(tripKey);
  if (!o) return { ok: false, error: 'No outfits for this trip yet.' };
  var p = (o.plan.people || []).filter(function(x) { return pkSame_(x.name, person); })[0];
  if (!p) return { ok: false, error: 'No outfits for ' + person + '.' };
  var key = person.toLowerCase();
  return pkLocked_(function() {
    var rows = pkTripRows_(tripKey).filter(function(r) { return r.person.toLowerCase() === key; }), sh = pkSheet_(), add = [], updated = 0;
    pkOutfitPieces_(p).forEach(function(x) {
      var have = rows.filter(function(r) { return pkNorm_(r.item) === pkNorm_(x.item); })[0];
      if (have) { if (!have.qty || have.qty < x.qty) { sh.getRange(have._row, PK_COL_.qty, 1, 2).setValues([[x.qty, x.why]]); updated++; } return; }
      add.push({ person: key, category: 'Clothing', item: x.item, qty: x.qty, why: x.why, source: 'outfit' });
    });
    pkAppend_(tripKey, add);
    return { ok: true, added: add.length, updated: updated };
  });
}

// ---- buy before you go -------------------------------------------------------------------

function pkTabTitle_(tripKey) { return 'Trip: ' + pkLabel_(tripKey); }
function pkNeedBy_(tripKey) {
  var s = pkStart_(tripKey); if (!s) return '';
  var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) - 2 * 86400000);
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + d.getUTCDate();
}
/** The trip's Shopping tab, made the first time. null when there's no Shopping doc. */
function pkShopTab_(tripKey, create) {
  if (typeof getShoppingDocId_ !== 'function' || !getShoppingDocId_()) return null;
  var doc = DocumentApp.openById(getShoppingDocId_()), title = pkTabTitle_(tripKey), tabs = doc.getTabs();
  for (var i = 0; i < tabs.length; i++) if (tabs[i].getTitle() === title) return tabs[i];
  return create ? doc.addTab({ title: title }) : null;
}
/** Puts a "to buy" item on the trip's Shopping tab. Medicines stay with Prescriptions. → 'added' | 'rx' | 'none' | 'error' */
function pkToShopping_(r) {
  if (typeof LU_MEDS_RE_ !== 'undefined' && LU_MEDS_RE_.test(r.item)) return 'rx';
  try {
    var tab = pkShopTab_(r.tripKey, true);
    if (!tab) return 'none';
    var body = tab.asDocumentTab().getBody(), n = body.getNumChildren(), norm = pkNorm_(r.item);
    for (var i = 0; i < n; i++) { var c = body.getChild(i); if (c.getType() === DocumentApp.ElementType.LIST_ITEM && pkNorm_(c.asListItem().getText()) === norm) return 'added'; }
    var by = pkNeedBy_(r.tripKey);
    body.appendListItem(r.item + (r.qty ? ' × ' + r.qty : '') + (by ? ' (need by ' + by + ')' : '')).setGlyphType(DocumentApp.GlyphType.BULLET);
    return 'added';
  } catch (e) { Logger.log('pkToShopping_: ' + e.message); return 'error'; }
}
/** Items ticked bought in Shopping (struck through) come back as ready. → names moved */
function pkSyncShopping_(tripKey, rows) {
  var moved = [];
  try {
    var tab = pkShopTab_(tripKey, false);
    if (!tab) return moved;
    var body = tab.asDocumentTab().getBody(), done = {};
    for (var i = 0; i < body.getNumChildren(); i++) {
      var c = body.getChild(i);
      if (c.getType() !== DocumentApp.ElementType.LIST_ITEM) continue;
      var t = c.asListItem();
      if (t.editAsText().isStrikethrough(0) === true) done[pkNorm_(t.getText().replace(/\(need by.*\)$/, ''))] = 1;
    }
    var sh = pkSheet_();
    rows.forEach(function(r) {
      if (r.status === 'buy' && done[pkNorm_(r.item)]) {
        sh.getRange(r._row, PK_COL_.checked).setValue('FALSE'); sh.getRange(r._row, PK_COL_.status).setValue('ready');
        sh.getRange(r._row, PK_COL_.by, 1, 2).setValues([['Shopping', pkStamp_()]]);
        r.status = 'ready'; moved.push(r.item);
      }
    });
  } catch (e) { Logger.log('pkSyncShopping_: ' + e.message); }
  return moved;
}

/** GET pk_buy {tripKey}: what's still to buy, after picking up what was bought in Shopping. */
function webPkBuy_(p) {
  var tripKey = pkStr_(p && p.tripKey, 200);
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  var rows = pkTripRows_(tripKey), moved = pkSyncShopping_(tripKey, rows);
  var shopOn = typeof getShoppingDocId_ === 'function' && !!getShoppingDocId_();
  return { ok: true, list: pkTabTitle_(tripKey), needBy: pkNeedBy_(tripKey), shopping: shopOn, bought: moved,
    items: rows.filter(function(r) { return r.status === 'buy'; }).map(function(r) {
      return { id: r.id, person: r.person, item: r.item, qty: r.qty, rx: typeof LU_MEDS_RE_ !== 'undefined' && LU_MEDS_RE_.test(r.item) };
    }) };
}

// ---- leave nothing behind ---------------------------------------------------------------

function pkCheckoutRun_(tripKey, endDate) {
  var row = (typeof lhRuns_ === 'function' ? lhRuns_() : []).filter(function(r) { return r.kind === 'checkout' && pkKeyMatch_(r.tripKey, tripKey); })[0];
  return row || { id: '', kind: 'checkout', tripKey: tripKey, home: '', leaveAt: (endDate || '') + 'T11:00', nights: 0, leaving: [], ticks: {}, oneOffs: [], sent: '' };
}
function pkCheckoutView_(tripKey, startDate, endDate, run) {
  var items = [];
  try { items = tripItemsFor_(tripKey, startDate, endDate, 'pk_checkout'); } catch (e) {}
  var stays = items.filter(function(it) { return /hotel|lodging|stay|airbnb|accommodation/i.test(it.type); }).map(function(it) { return { name: pkStr_(it.title, 80) }; });
  var rows = pkTripRows_(tripKey), staples = pkProfileStaples_(typeof tpItems_ === 'function' ? tpItems_() : []), mine = [];
  pkTravellers_(tripKey).forEach(function(n) { (staples[n] || []).forEach(function(s) { mine.push(s); }); });
  var homeGifts = 0, giftNote = null;
  try {
    if (typeof tgAllRows_ === 'function') {
      var gifts = tgAllRows_(getSpreadsheet().getSheetByName(TABS.TRIP_GIFTS)).filter(function(r) { return pkKeyMatch_(r[1], tripKey); }).map(tgRowToGift_).filter(function(g) { return g.kind !== 'host'; });
      homeGifts = gifts.length;
      if (gifts.length && typeof tgHomeCheck_ === 'function') giftNote = tgHomeCheck_(gifts, typeof tgHome_ === 'function' ? tgHome_() : 'United States', pkTravellers_(tripKey).length);
    }
  } catch (e) { Logger.log('pk checkout gifts: ' + e.message); }
  var list = pkCheckoutItems_({ stays: stays, packed: rows, staples: mine, homeGifts: homeGifts });
  var ticks = run.ticks || {};
  var out = list.map(function(i) { var t = ticks[i.key]; return { key: i.key, text: i.text, meta: i.meta, done: !!t, by: t ? t.by || '' : '', at: t ? t.at || '' : '' }; });
  var done = out.filter(function(i) { return i.done; }).length;
  return { ok: true, items: out, done: done, total: out.length, stays: stays.map(function(s) { return s.name; }), checkout: endDate,
    gifts: giftNote ? { rules: (giftNote.rules || []).slice(0, 4), declare: giftNote.declare || null, count: homeGifts } : null };
}

/** GET pk_checkout {tripKey, startDate, endDate}. */
function webPkCheckout_(p) {
  p = p || {};
  var tripKey = pkStr_(p.tripKey, 200), s = pkStr_(p.startDate, 10), e = pkStr_(p.endDate, 10) || s;
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  return pkCheckoutView_(tripKey, s, e, pkCheckoutRun_(tripKey, e));
}

/** POST pk_checkout_tick {tripKey, startDate, endDate, key, done, by}: shared, with who and when. */
function webPkCheckoutTick_(body) {
  body = body || {};
  var tripKey = pkStr_(body.tripKey, 200), key = pkStr_(body.key, 40), s = pkStr_(body.startDate, 10), e = pkStr_(body.endDate, 10) || s;
  if (!tripKey || !key) return { ok: false, error: 'tripKey and key required' };
  return pkLocked_(function() {
    var run = pkCheckoutRun_(tripKey, e);
    run.ticks = run.ticks || {};
    if (body.done === true || body.done === 'true') run.ticks[key] = { by: pkStr_(body.by, 40), at: pkStamp_() }; else delete run.ticks[key];
    lhSaveRun_(run);
    return pkCheckoutView_(tripKey, s, e, run);
  });
}

// ---- after the trip --------------------------------------------------------------------

function pkReviewSheet_() { return ensureSheet(getSpreadsheet(), TABS.PACKING_REVIEWS, PACKING_REVIEW_HEADERS); }
function pkReviewFor_(tripKey) {
  var sh = getSpreadsheet().getSheetByName(TABS.PACKING_REVIEWS);
  if (!sh || sh.getLastRow() < 2) return {};
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, PACKING_REVIEW_HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (!pkKeyMatch_(rows[i][0], tripKey)) continue;
    var j = function(x) { try { var a = JSON.parse(x || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
    return { unused: j(rows[i][1]), forgot: j(rows[i][2]), bought: j(rows[i][3]), by: String(rows[i][4] || ''), updated: String(rows[i][5] || ''), logged: String(rows[i][6] || '') === 'yes', _row: i + 2 };
  }
  return {};
}

/** GET pk_review {tripKey}: what you packed, and the review so far. */
function webPkReview_(p) {
  var tripKey = pkStr_(p && p.tripKey, 200);
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  var r = pkReviewFor_(tripKey), seen = {}, packed = [];
  pkTripRows_(tripKey).forEach(function(x) { var n = pkNorm_(x.item); if (seen[n]) return; seen[n] = 1; packed.push({ id: x.id, item: x.item + (x.qty > 1 ? ' × ' + x.qty : ''), name: x.item, person: x.person }); });
  return { ok: true, packed: packed, unused: r.unused || [], forgot: r.forgot || [], bought: r.bought || [], saved: !!r._row, updated: r.updated || '' };
}

/** POST pk_review_save {tripKey, unused:[names], forgot:[names], bought:[names], by}: saved, and packing lessons logged once. */
function webPkReviewSave_(body) {
  body = body || {};
  var tripKey = pkStr_(body.tripKey, 200);
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  var clean = function(a) { var out = []; (Array.isArray(a) ? a : []).forEach(function(x) { x = pkStr_(x, 80); if (x && !out.some(function(y) { return pkSame_(y, x); })) out.push(x); }); return out.slice(0, 40); };
  var r = { unused: clean(body.unused), forgot: clean(body.forgot), bought: clean(body.bought) };
  return pkLocked_(function() {
    var have = pkReviewFor_(tripKey), sh = pkReviewSheet_(), logged = !!have.logged, lessons = [];
    if (!logged && typeof logTripLesson_ === 'function') {
      var traits = pkTraits_(tripKey), scope = traits.length ? 'trait:' + traits[0] : 'always:all';
      pkReviewLessons_(r, pkLabel_(tripKey)).forEach(function(l) { try { var x = logTripLesson_(l.text, scope, 'Packing', pkLabel_(tripKey), l.detail); if (x && x.ok) lessons.push(l.text); } catch (e) { Logger.log('pk lesson: ' + e.message); } });
      logged = lessons.length > 0;
    }
    var row = [tripKey, JSON.stringify(r.unused), JSON.stringify(r.forgot), JSON.stringify(r.bought), pkStr_(body.by, 40), pkStamp_(), logged ? 'yes' : '', (typeof tripIdCell_ === 'function' ? tripIdCell_(tripKey) : '')];
    if (have._row) sh.getRange(have._row, 1, 1, PACKING_REVIEW_HEADERS.length).setValues([row]); else sh.appendRow(row);
    return { ok: true, lessons: lessons, alreadyLogged: !!have.logged };
  });
}
