// ============================================================
// VERA — Luggage.js
// Luggage advice at the top of Packing (issue #230).
// ============================================================
//
// Per traveller:
//   which of "Our bags" to take, and why: nights, laundry, trip type, the packing
//   list and the gifts
//   an about-weight per bag (typical item weights plus the bag's own weight)
//   against its limit, with a warning near it
//   which bag each item goes in. Liquids over 100 ml and fragile or liquid gifts
//   go checked; passport, meds, chargers and batteries and valuables stay with
//   you. "Move to" overrides a placement; the moves are kept per trip in the
//   TripMeta "Luggage JSON" column.
// An airline box on flown trips: free or paid per airline, Basic Economy meaning
// a personal item only, airline status from the traveller profiles and card perks
// that waive the checked bag. Always "about": check before you fly. Road trips
// get the bags without airline rules.
//
// "Our bags" (Travel › Travelers › Our bags) is the Bags tab, weights kept in lb.
// The dashboards show lb by default, with a kg/lb switch.
//
// Two layers: lu*_ pure helpers, then the reads and the routes.
// ============================================================

var LU_TYPES_ = ['carry-on', 'checked', 'personal'];
var LU_TYPE_LABEL_ = { 'carry-on': 'carry-on', checked: 'checked', personal: 'personal item' };
var LU_LB_PER_KG_ = 2.20462;
var LU_CHECKED_LIMIT_LB_ = 50;            // 23 kg, economy almost everywhere
var LU_CARRY_ROOM_LB_ = 26;               // what a carry-on and a personal item hold, about
var LU_PERSONAL_ROOM_LB_ = 12;            // a personal item alone (Basic Economy)
var LU_EMPTY_LB_ = { 'carry-on': 7, checked: 9, personal: 1.5 };
// Airlines that weigh carry-ons, in kg (US airlines mostly don't). About: check before you fly.
var LU_CARRY_KG_ = { TP: 8, LH: 8, LX: 8, OS: 8, SK: 8, AY: 8, TK: 8, MS: 8, AF: 12, KL: 12, IB: 10, NH: 10, JL: 10, VS: 10, EK: 7, QR: 7, SQ: 7, CX: 7, QF: 7, ET: 7, EY: 7, BA: 23 };
var LU_WEIGHTS_ = [
  [/\bboots?\b/i, 3], [/\b(shoes?|sneakers?|trainers?|heels|loafers|flats)\b/i, 2], [/\b(sandals?|flip ?flops?|slippers?)\b/i, 0.8],
  [/\bjeans\b/i, 1.5], [/\b(jacket|coat|parka|raincoat)\b/i, 2.5], [/\b(sweaters?|hoodies?|fleece|jumpers?|cardigans?)\b/i, 1.2],
  [/\b(dress|dresses|suit|blazer|gown)\b/i, 1.2], [/\b(pants|trousers|shorts|skirts?|leggings)\b/i, 0.8],
  [/\b(shirts?|tops?|blouses?|tees?|t-shirts?|polos?)\b/i, 0.4], [/\b(underwear|socks|bras?|boxers)\b/i, 0.15],
  [/\b(swim\w*|bikini)\b/i, 0.3], [/\b(pajamas|pyjamas|pjs)\b/i, 0.6],
  [/\blaptop\b/i, 3.5], [/\b(tablet|ipad|kindle|e-?reader)\b/i, 1], [/\bcamera\b/i, 2], [/\b(power ?bank|batter(y|ies))\b/i, 0.6],
  [/\b(chargers?|cables?|adapters?|plugs?)\b/i, 0.3], [/\b(headphones|earbuds)\b/i, 0.5],
  [/\b(toiletr\w*|wash ?bag|dopp kit)\b/i, 2], [/\b(hair ?dryer|straightener|curling iron)\b/i, 1.5],
  [/\b(olive oil|wine|port|whisk(e)?y|liqueur|spirits|bottles?)\b/i, 3], [/\b(ceramic|bowl|plates?|mugs?|glass|vase)\b/i, 1.5],
  [/\b(shampoo|conditioner|lotion|sunscreen|body wash|perfume|cologne)\b/i, 0.6],
  [/\bbooks?\b/i, 0.8], [/\bumbrella\b/i, 0.8], [/\btowels?\b/i, 1], [/\bsnacks?\b/i, 1], [/\b(cheese|chocolate|tea|coffee)\b/i, 0.8],
];
var LU_DOCS_RE_ = /\b(passports?|visas?|ids?|driver'?s licen[cs]e|wallet|documents?|tickets?|boarding pass(es)?|cash|keys)\b/i;
var LU_VALUABLE_RE_ = /\b(jewel(le)?ry|rings?|necklace|watch|laptop|tablet|ipad|camera|kindle)\b/i;
var LU_MEDS_RE_ = /\b(meds?|medicines?|medication|prescriptions?|pills|inhaler|insulin|epi-?pens?|vitamins)\b/i;
var LU_BATTERY_RE_ = /\b(chargers?|power ?banks?|batter(y|ies)|cables?|e-?cigs?|vapes?)\b/i;
var LU_LIQUID_RE_ = /\b(shampoo|conditioner|lotion|sunscreen|body wash|perfume|cologne|mouthwash|olive oil|wine|liquid|gel|spray)\b/i;
var LU_SMALL_RE_ = /\b(sunglasses|books?|headphones|earbuds|snacks?|eye ?mask|ear ?plugs|neck pillow|glasses|lip balm|pen)\b/i;

// ---- pure ---------------------------------------------------------------------

function luStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function luRound_(n) { return Math.round(n * 10) / 10; }
function luSame_(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
function luType_(v) {
  var t = String(v || '').toLowerCase();
  if (/check/.test(t)) return 'checked';
  if (/personal|under ?seat|backpack|tote/.test(t)) return 'personal';
  if (/carry|cabin|overhead/.test(t)) return 'carry-on';
  return '';
}

/** A weight typed with its unit ("9.3 lb", "4.2 kg", "4.2" with unit 'kg') → lb, or null. */
function luParseWeight_(text, unit) {
  var s = String(text == null ? '' : text).trim().toLowerCase();
  if (!s) return null;
  var m = s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  var n = parseFloat(m[1].replace(',', '.'));
  if (!(n >= 0) || n > 200) return null;
  var kg = /kg|kilo/.test(s) || (!/lb|pound/.test(s) && String(unit || '').toLowerCase() === 'kg');
  return luRound_(kg ? n * LU_LB_PER_KG_ : n);
}

/** How many: "x2", "2x", "2 ", "(3)". */
function luQty_(text) {
  var s = String(text || ''), m = s.match(/(?:^|\s)[x×]\s?(\d{1,2})\b|\b(\d{1,2})\s?[x×](?:\s|$)|^\s*(\d{1,2})\s+[a-z]|\((\d{1,2})\)/i);
  var n = m ? parseInt(m[1] || m[2] || m[3] || m[4], 10) : 1;
  return Math.max(1, Math.min(14, n || 1));
}

/** About how much an item weighs, in lb. */
function luItemWeight_(text) {
  var s = String(text || ''), w = 0.5;
  for (var i = 0; i < LU_WEIGHTS_.length; i++) { if (LU_WEIGHTS_[i][0].test(s)) { w = LU_WEIGHTS_[i][1]; break; } }
  return luRound_(w * luQty_(s));
}

/** Millilitres in a liquid's name ("Shampoo 250 ml", "3.4 oz", "1 L"), or null. */
function luMl_(text) {
  var s = String(text || ''), m = s.match(/(\d+(?:[.,]\d+)?)\s*(ml|millilit\w*|l\b|lit(re|er)s?|fl\.? ?oz|oz)/i);
  if (!m) return null;
  var n = parseFloat(m[1].replace(',', '.')), u = m[2].toLowerCase();
  if (u === 'ml' || /^millilit/.test(u)) return n;
  if (u === 'l' || /^lit/.test(u)) return n * 1000;
  return n * 29.57;
}

/**
 * Where an item must or should go.
 * → {place: personal | carry | checked | checked-soft | personal-soft | any, why}
 * personal / carry / checked are rules; the -soft ones and any are preferences.
 */
function luPlace_(text, packsAs) {
  var s = String(text || '');
  if (packsAs === 'fragile' && (LU_LIQUID_RE_.test(s) || packsAs === 'liquid')) return { place: 'checked', why: 'liquid, fragile: wrap in clothes' };
  if (packsAs === 'liquid') return { place: 'checked', why: 'liquid: wrap in clothes' };
  if (packsAs === 'fragile') return { place: 'checked', why: 'fragile: wrap in clothes' };
  if (LU_DOCS_RE_.test(s)) return { place: 'personal', why: 'documents stay with you' };
  if (LU_MEDS_RE_.test(s)) return { place: 'personal', why: 'meds stay with you' };
  if (LU_BATTERY_RE_.test(s)) return { place: 'carry', why: 'chargers and batteries: never checked' };
  if (LU_VALUABLE_RE_.test(s)) return { place: 'carry', why: 'valuables stay with you' };
  var ml = luMl_(s);
  if (ml !== null) return ml > 100 ? { place: 'checked', why: 'liquid over 100 ml' } : { place: 'any', why: '' };
  if (LU_LIQUID_RE_.test(s) && !/\b(travel|mini|sample)\b/i.test(s)) return { place: 'checked-soft', why: 'liquid: checked, or under 100 ml' };
  if (LU_SMALL_RE_.test(s)) return { place: 'personal-soft', why: '' };
  return { place: 'any', why: '' };
}

/** A gift's own packing note: tgPacksFor_ where it's loaded, else what the row says. */
function luGiftPacks_(g) {
  try { if (typeof tgPacksFor_ === 'function') return tgPacksFor_(g); } catch (e) {}
  return g.packsAs || 'none';
}

/** Checked-bag rules per traveller and airline, from status and card perks. */
function luAirline_(o) {
  var flights = o.flights || [], seen = {}, airlines = [];
  flights.forEach(function(f) { var a = f.air; if (!a || seen[a.code]) { if (a && f.basic) seen[a.code].basic = true; return; } seen[a.code] = { code: a.code, name: a.name, alliance: a.alliance, basic: !!f.basic, flights: [] }; airlines.push(seen[a.code]); });
  flights.forEach(function(f) { if (f.air && seen[f.air.code]) seen[f.air.code].flights.push(f.label); });
  if (!airlines.length) return { lines: [], none: true, note: 'No flights on the itinerary yet. Add them to see what’s free.' };
  var members = (o.memberships || []), perks = (o.perks || []), lines = [];
  var cap = function(s) { return s.length <= 3 ? s.toUpperCase() : s.replace(/\b[a-z]/g, function(x) { return x.toUpperCase(); }); };
  airlines.forEach(function(a) {
    var title = a.flights.join(' and ') || cap(a.name);
    lines.push({ tone: a.basic ? 'warn' : 'info', text: title + ': ' + (a.basic ? 'Basic Economy, so a personal item only (no full-size carry-on).' : 'carry-on and personal item, usually free.') });
    var free = [];
    (o.people || []).forEach(function(p) {
      var why = '';
      members.filter(function(m) { return luSame_(m.person, p); }).some(function(m) {
        var rel = typeof trdMemberFor_ === 'function' ? trdMemberFor_(m, a) : false, tier = luStr_(m.tier, 40);
        if (rel === 'own' && tier) { why = 'free with your ' + luStr_(m.label, 40) + ' ' + tier; return true; }
        if (rel === 'partner' && tier && typeof TRD_LOUNGE_TIER_ !== 'undefined' && TRD_LOUNGE_TIER_.test(tier)) {
          why = 'free with ' + ((typeof TRD_ALLIANCE_TIER_ !== 'undefined' && TRD_ALLIANCE_TIER_[a.alliance]) || 'partner status') + ' (' + luStr_(m.label, 40) + ' ' + tier + ')'; return true;
        }
        return false;
      });
      if (why) free.push({ person: p, why: why });
    });
    var perk = perks.filter(function(k) { return /checked bag|free bag|first bag|bag fee/i.test(k.perk) && String(k.card || '').toLowerCase().indexOf(a.name) !== -1; })[0];
    if (free.length) {
      free.forEach(function(f) { lines.push({ tone: 'good', text: 'Checked bags on ' + cap(a.name) + ': ' + f.why.replace(/^free with your /, 'free for ' + f.person + ' with ' + f.person + '’s ').replace(/^free with /, 'free for ' + f.person + ' with ') + '. It often covers others on the same booking too.' }); });
    }
    if (perk) lines.push({ tone: 'good', text: 'Paying with the ' + luStr_(perk.card, 60) + ' waives the first ' + cap(a.name) + ' checked bag.' });
    if (!free.length && !perk) lines.push({ tone: 'info', text: 'Checked bag on ' + cap(a.name) + ': may be paid, about $35–75 each way, often included on long-haul fares.' });
  });
  var kg = 0;
  airlines.forEach(function(a) { var k = LU_CARRY_KG_[a.code]; if (k && (!kg || k < kg)) kg = k; });
  return { lines: lines, none: false, basic: airlines.some(function(a) { return a.basic; }), carryLimitLb: kg ? luRound_(kg * LU_LB_PER_KG_) : null, checkedLimitLb: LU_CHECKED_LIMIT_LB_ };
}

/**
 * The advice. o: {travellers:[names], packing:[{id, person, item, category}], gifts:[{id, item, kind, packsAs}],
 * bags:[{id, name, type, emptyLb, whose}], nights, characteristics:[...], laundry, road, flights:[{air, basic, label}],
 * memberships, perks, moves:{itemKey: bagId}}
 * → {people:[{name, key, count, gifts, why, needChecked, bags:[{id, name, type, generic, weightLb, limitLb, state, items:[{key, item, why, tone, gift}]}]}], airline, road, nights}
 */
function luAdvise_(o) {
  o = o || {};
  var people = (o.travellers || []).slice();
  if (!people.length) (o.packing || []).forEach(function(p) { var n = luStr_(p.person, 40); if (n && !/^shared$/i.test(n) && !people.some(function(x) { return luSame_(x, n); })) people.push(n.charAt(0).toUpperCase() + n.slice(1)); });
  if (!people.length) people = ['You'];
  var road = !!o.road, nights = Math.max(0, Number(o.nights) || 0), chars = (o.characteristics || []).map(function(c) { return String(c).toLowerCase(); });
  var airline = road ? null : luAirline_({ flights: o.flights || [], memberships: o.memberships, perks: o.perks, people: people });
  var basic = !!(airline && airline.basic), moves = o.moves || {}, taken = {};
  var bags = (o.bags || []).filter(function(b) { return LU_TYPES_.indexOf(b.type) !== -1; });

  var own = people.map(function(p) { return { name: p, key: String(p).toLowerCase(), items: [], gifts: 0 }; });
  var byKey = {}; own.forEach(function(p) { byKey[p.key] = p; });
  (o.packing || []).forEach(function(it) {
    var k = String(it.person || '').toLowerCase(), p = byKey[k] || (/^shared$|^$/.test(k) ? own[0] : null);
    if (!p) return;
    var pl = luPlace_(it.item, null);
    var qty = Number(it.qty) > 0 && luQty_(it.item) === 1 ? Number(it.qty) : 1;   // #234: the list's count
    p.items.push({ key: 'p:' + it.id, item: luStr_(it.item, 120) + (qty > 1 ? ' × ' + qty : ''), lb: luRound_(luItemWeight_(it.item) * qty), qty: qty, status: it.status || 'ready', place: pl.place, why: pl.why + (k === 'shared' && own.length > 1 ? (pl.why ? ' · ' : '') + 'shared' : ''), gift: false });
  });
  var hostGifts = (o.gifts || []).filter(function(g) { return g.kind === 'host'; });
  var homeGifts = (o.gifts || []).filter(function(g) { return g.kind !== 'host'; });
  if (hostGifts.length) {
    var holder = own.filter(function(p) { return bags.some(function(b) { return b.type === 'checked' && luSame_(b.whose, p.name); }); })[0] || own[0];
    hostGifts.forEach(function(g) {
      var pl = luPlace_(g.item, luGiftPacks_(g));
      holder.items.push({ key: 'g:' + g.id, item: luStr_(g.item, 120) + ' (gift)', lb: Math.max(1, luItemWeight_(g.item)), qty: 1, status: g.status === 'Packed' ? 'bag' : 'ready', place: pl.place === 'any' ? 'any' : pl.place, why: pl.why, gift: true });
      holder.gifts++;
    });
  }

  own.forEach(function(p) {
    var lb = p.items.reduce(function(s, i) { return s + i.lb; }, 0), reasons = [], need = { personal: true, carry: !basic, checked: false };
    var mustCheck = p.items.filter(function(i) { return i.place === 'checked'; });
    if (mustCheck.length) { need.checked = true; reasons.push('the ' + mustCheck.slice(0, 2).map(function(i) { return i.item.replace(/ \(gift\)$/, '') + (i.why ? ' (' + i.why.split(':')[0] + ')' : ''); }).join(' and ') + (mustCheck.length > 2 ? ' and ' + (mustCheck.length - 2) + ' more' : '')); }
    var room = basic ? LU_PERSONAL_ROOM_LB_ : LU_CARRY_ROOM_LB_;
    if (lb > room) { need.checked = true; reasons.push('about ' + Math.round(lb) + ' lb of things, more than ' + (basic ? 'a personal item' : 'a carry-on and a personal item') + ' hold'); }
    if (nights >= 8 && !o.laundry) { need.checked = true; reasons.push(nights + ' nights without laundry'); }
    if (chars.indexOf('ski') !== -1) { need.checked = true; reasons.push('ski gear'); }

    var pick = function(type, optional) {
      var mine = bags.filter(function(b) { return b.type === type && luSame_(b.whose, p.name) && !taken[b.id]; });
      var shared = bags.filter(function(b) { return b.type === type && /^shared$/i.test(b.whose || '') && !taken[b.id]; });
      var b = mine[0] || shared[0];
      if (b) { taken[b.id] = 1; return { id: b.id, name: b.name, type: type, generic: false, emptyLb: Number(b.emptyLb) || 0 }; }
      if (optional) return null;
      return { id: p.key + ':' + type, name: type === 'personal' ? 'A personal item' : type === 'checked' ? 'A checked bag' : 'A carry-on', type: type, generic: true, emptyLb: LU_EMPTY_LB_[type] };
    };
    var chosen = [];
    if (need.checked) chosen.push(pick('checked'));
    // With a checked bag, a carry-on only when there's a real one free: no made-up extra bag.
    if (need.carry) { var cb = pick('carry-on', need.checked); if (cb) chosen.push(cb); }
    chosen.push(pick('personal'));
    var of = function(type) { return chosen.filter(function(b) { return b.type === type; })[0] || null; };
    var personal = of('personal'), carry = of('carry-on'), checked = of('checked');
    chosen.forEach(function(b) { b.items = []; });
    p.wearing = [];
    p.items.forEach(function(i) {
      var to = null, why = i.why;
      // #234: "wear it on the plane" takes it out of every bag.
      if (moves[i.key] === 'wear') { p.wearing.push({ key: i.key, item: i.item, lb: i.lb, status: i.status }); return; }
      var moved = moves[i.key] && chosen.filter(function(b) { return b.id === moves[i.key]; })[0];
      if (moved) { to = moved; }
      else if (i.place === 'personal') to = personal;
      else if (i.place === 'carry') to = carry || personal;
      else if (i.place === 'checked') to = checked;
      else if (i.place === 'checked-soft') { to = checked || carry || personal; if (!checked) why = 'keep it under 100 ml'; }
      else if (i.place === 'personal-soft') to = personal;
      else to = checked || carry || personal;
      var tone = /liquid|fragile|100 ml/.test(why) ? 'warn' : why ? 'info' : '';
      if (moved && i.place === 'checked' && moved.type !== 'checked') { why = (why ? why + ' · ' : '') + 'moved: check the rules'; tone = 'warn'; }
      if (moved && (i.place === 'personal' || i.place === 'carry') && moved.type === 'checked') { why = (why ? why + ' · ' : '') + 'moved: better with you'; tone = 'warn'; }
      to.items.push({ key: i.key, item: i.item, why: why, tone: tone, gift: i.gift, lb: i.lb, qty: i.qty, status: i.status, place: i.place });
    });
    var carryLimit = airline && !airline.none ? airline.carryLimitLb : null;
    chosen.forEach(function(b) {
      var w = b.emptyLb + b.items.reduce(function(s, i) { return s + i.lb; }, 0);
      b.weightLb = luRound_(w);
      b.limitLb = road ? null : b.type === 'checked' ? LU_CHECKED_LIMIT_LB_ : b.type === 'carry-on' ? carryLimit : null;
      b.state = !b.limitLb ? 'ok' : w > b.limitLb ? 'over' : w >= b.limitLb * 0.8 ? 'near' : 'ok';
      // #234: packing day. What's in the bag so far, by the list's ticks.
      var inBag = b.items.filter(function(i) { return i.status === 'bag'; });
      b.packed = inBag.length;
      b.packedLb = luRound_(b.emptyLb + inBag.reduce(function(s, i) { return s + i.lb; }, 0));
      delete b.emptyLb;
    });
    chosen.forEach(function(b) { b.fixes = b.state === 'over' ? luFixes_(b, chosen) : []; });
    var why;
    if (need.checked) why = 'A checked bag: ' + reasons.join('; ') + '.';
    else {
      var bits = [];
      if (nights) bits.push(nights + ' night' + (nights === 1 ? '' : 's') + (o.laundry ? ' with laundry' : ''));
      bits.push('about ' + Math.round(lb) + ' lb of things');
      why = (basic ? 'Personal item only (Basic Economy): ' : 'Carry-on only: ') + bits.join(', ') + '.';
    }
    if (p.wearing.length) why += ' Wearing on the plane: ' + p.wearing.map(function(w) { return w.item; }).join(', ') + '.';
    p.bags = chosen; p.why = why; p.count = p.items.length; p.needChecked = need.checked;
    delete p.items;
  });
  if (homeGifts.length) {
    var home = own.filter(function(p) { return p.needChecked; })[0] || own[0];
    var homeLb = homeGifts.reduce(function(s, g) { return s + Math.max(1, luItemWeight_(g.item)); }, 0);
    home.why += ' ' + homeGifts.length + ' gift' + (homeGifts.length === 1 ? '' : 's') + ' coming home, about ' + Math.round(homeLb) + ' lb: leave room.';
  }
  return { people: own, airline: airline, road: road, nights: nights, laundry: !!o.laundry };
}

var LU_WEARABLE_RE_ = /\b(boots?|shoes|sneakers|trainers|heels|loafers|jackets?|coats?|parka|sweaters?|hoodies?|fleece|jeans|blazer)\b/i;
/**
 * Ways to get an over-limit bag under (#234), biggest saving first, at most 4:
 * wear the heaviest wearable on the plane; move the heaviest item that may go to another
 * of the person's bags with room (never a liquid or fragile gift into the cabin, never
 * documents, meds or batteries into the hold); take one fewer of something counted.
 * → [{kind: wear | move | fewer, key, item, to?, toName?, saves}]
 */
function luFixes_(b, bags) {
  var out = [], items = b.items.filter(function(i) { return !i.gift || i.place !== 'checked'; });
  var each = function(i) { return i.lb / (i.qty > 1 ? i.qty : 1); };
  var wear = b.items.filter(function(i) { return LU_WEARABLE_RE_.test(i.item) && i.lb > 0; }).sort(function(x, y) { return each(y) - each(x); })[0];
  if (wear) out.push({ kind: 'wear', key: wear.key, item: wear.item, saves: luRound_(wear.qty > 1 ? wear.lb / wear.qty : wear.lb) });
  bags.forEach(function(o) {
    if (o === b) return;
    var room = o.limitLb ? o.limitLb - o.weightLb : (o.type === 'personal' ? LU_PERSONAL_ROOM_LB_ : LU_CARRY_ROOM_LB_) - (o.weightLb || 0);
    var cabin = o.type !== 'checked';
    var ok = b.items.filter(function(i) {
      if (i === wear || i.lb <= 0.4 || i.lb > room) return false;
      if (cabin && (i.place === 'checked' || i.place === 'checked-soft')) return false;
      if (!cabin && (i.place === 'personal' || i.place === 'carry')) return false;
      return true;
    }).sort(function(x, y) { return y.lb - x.lb; })[0];
    if (ok && !out.some(function(f) { return f.key === ok.key; })) out.push({ kind: 'move', key: ok.key, item: ok.item, to: o.id, toName: o.name, saves: ok.lb });
  });
  var many = items.filter(function(i) { return i.qty > 1 && /^p:/.test(i.key) && !out.some(function(f) { return f.key === i.key; }); }).sort(function(x, y) { return each(y) - each(x); })[0];
  if (many) out.push({ kind: 'fewer', key: many.key, item: many.item.replace(/ × \d+$/, ''), qty: many.qty, saves: luRound_(many.lb / many.qty) });
  return out.sort(function(x, y) { return y.saves - x.saves; }).slice(0, 4);
}

/** Bag rows (as stored) → bags. */
function luBagRows_(rows) {
  return (rows || []).filter(function(r) { return String(r[0] || '').trim() && String(r[1] || '').trim(); }).map(function(r) {
    var w = Number(r[4]);
    return { id: String(r[0]).trim(), name: luStr_(r[1], 60), type: luType_(r[2]) || 'carry-on', size: luStr_(r[3], 60), emptyLb: isFinite(w) && w > 0 ? luRound_(w) : 0, whose: luStr_(r[5], 40) || 'Shared', notes: luStr_(r[6], 200), updated: String(r[7] || '') };
  });
}

/** A trip's moves from its Luggage JSON cell. */
function luMovesFrom_(cell) {
  try { var o = JSON.parse(String(cell || '') || '{}'); return o && typeof o.moves === 'object' && o.moves ? o.moves : {}; } catch (e) { return {}; }
}

// ---- reads ----------------------------------------------------------------------

function luSheet_() { return ensureSheet(getSpreadsheet(), TABS.BAGS, BAG_HEADERS); }
function luBags_() {
  var sh = getSpreadsheet().getSheetByName(TABS.BAGS);
  if (!sh || sh.getLastRow() < 2) return [];
  return luBagRows_(sh.getRange(2, 1, sh.getLastRow() - 1, BAG_HEADERS.length).getValues());
}
function luLocked_(fn) { var l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }
function luToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function luNights_(a, b) {
  var x = Date.parse(String(a || '') + 'T00:00:00Z'), y = Date.parse(String(b || '') + 'T00:00:00Z');
  return isFinite(x) && isFinite(y) && y > x ? Math.round((y - x) / 86400000) : 0;
}

/** The TripMeta row (1-based) for a trip, or 0. */
function luMetaRow_(sheet, tripKey) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(function(r) { return r[0]; });
  var i = typeof tripKeyRowIndex_ === 'function' ? tripKeyRowIndex_(ids, tripKey) : ids.map(String).indexOf(tripKey);
  return i >= 0 ? i + 2 : 0;
}
var LU_JSON_COL_ = 10;   // TripMeta "Luggage JSON"
function luMoves_(tripKey) {
  var sh = getSpreadsheet().getSheetByName(TABS.TRIP_META), r = luMetaRow_(sh, tripKey);
  return r ? luMovesFrom_(sh.getRange(r, LU_JSON_COL_).getValue()) : {};
}

function luPacking_(tripKey) {
  var sh = getSpreadsheet().getSheetByName(TABS.PACKING_ITEMS), out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues().forEach(function(r) {
    if (!String(r[4] || '').trim() || !tripRowIs_(r[1], r[PACKING_ITEM_HEADERS.length - 1], tripKey)) return;
    out.push({ id: String(r[0]).trim(), person: String(r[2] || '').trim(), category: String(r[3] || '').trim(), item: String(r[4]).trim(),
      status: typeof pkStatusOf_ === 'function' ? pkStatusOf_(r[8], r[5]) : (String(r[5]).toUpperCase() === 'TRUE' ? 'bag' : 'ready'), qty: Number(r[9]) > 0 ? Number(r[9]) : '' });
  });
  return out;
}

function luGifts_(tripKey) {
  try {
    if (typeof tgAllRows_ !== 'function') return [];
    return tgAllRows_(getSpreadsheet().getSheetByName(TABS.TRIP_GIFTS)).filter(function(r) { return tripRowIs_(r[1], r[TRIP_GIFT_HEADERS.length - 1], tripKey); }).map(tgRowToGift_);
  } catch (e) { Logger.log('luGifts_: ' + e.message); return []; }
}

function luFlights_(tripKey, startDate, endDate) {
  var items = [];
  try { items = tripItemsFor_(tripKey, startDate, endDate, 'luggage'); } catch (e) { Logger.log('luggage itinerary: ' + e.message); }
  return items.filter(function(it) { return String(it.type).toLowerCase() === 'flight'; }).map(function(it) {
    var air = typeof trdAirline_ === 'function' ? trdAirline_(it) : null;
    var m = typeof trdMeta_ === 'function' ? trdMeta_(it.metadata) : {};
    var num = String(m.flightNum || m.flightNumber || '').toUpperCase().replace(/\s+/g, '') || ((String(it.title).toUpperCase().match(/\b([A-Z0-9]{2})\s?(\d{1,4})\b/) || [])[0] || '').replace(/\s+/g, ' ');
    return { air: air, basic: /\bbasic\b/i.test(it.title + ' ' + it.metadata), label: num || (air ? air.name : '') };
  });
}

/** Everything the advice needs for one trip. */
function luContext_(tripKey, startDate, endDate) {
  var meta = {};
  try { meta = webGetTripMeta_({ parameter: { tripKey: tripKey } }) || {}; } catch (e) {}
  var chars = String(meta.characteristics || '').split(/\s*,\s*/).filter(String);
  var road = chars.indexOf('roadtrip') !== -1 || /car|drive|road/i.test(String(meta.outboundMode || '') + ' ' + String(meta.returnMode || ''));
  var travellers = [];
  try { travellers = typeof teTravellersForKey_ === 'function' ? teTravellersForKey_(tripKey) : []; } catch (e) {}
  var items = [];
  try { items = typeof tpItems_ === 'function' ? tpItems_() : []; } catch (e) {}
  var perks = [];
  try {
    var ps = getSpreadsheet().getSheetByName(TABS.CARD_PERKS);
    if (ps && ps.getLastRow() >= 2) perks = ps.getRange(2, 1, ps.getLastRow() - 1, 3).getValues().map(function(r) { return { card: String(r[1] || ''), perk: String(r[2] || '') }; });
  } catch (e) {}
  return {
    travellers: travellers, packing: luPacking_(tripKey), gifts: luGifts_(tripKey), bags: luBags_(),
    nights: luNights_(startDate, endDate), characteristics: chars,
    laundry: /\b(laundry|washer|washing machine)\b/i.test(String(meta.notes || '') + ' ' + String(meta.context || '')),
    road: road, flights: road ? [] : luFlights_(tripKey, startDate, endDate),
    memberships: items.filter(function(i) { return i.section === 'membership'; }), perks: perks, moves: luMoves_(tripKey),
  };
}

// ---- routes -----------------------------------------------------------------------

/** GET luggage {tripKey, startDate, endDate}. */
function webLuggage_(p) {
  p = p || {};
  var tripKey = luStr_(p.tripKey, 200);
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  var c = luContext_(tripKey, luStr_(p.startDate, 10), luStr_(p.endDate, 10) || luStr_(p.startDate, 10));
  var advice = luAdvise_(c);
  advice.ok = true; advice.tripKey = tripKey; advice.bagsListed = c.bags.length;
  return advice;
}

/** GET lu_bags. */
function webLuBags_() { return { ok: true, bags: luBags_() }; }

/** POST lu_bag_save {id?, name, type, size, weight, unit, whose, notes}. */
function webLuBagSave_(body) {
  body = body || {};
  var name = luStr_(body.name, 60), type = luType_(body.type);
  if (!name) return { ok: false, error: 'Give the bag a name.' };
  if (!type) return { ok: false, error: 'Pick a type: carry-on, checked or personal item.' };
  var lb = String(body.weight == null ? '' : body.weight).trim() === '' ? 0 : luParseWeight_(body.weight, body.unit);
  if (lb === null) return { ok: false, error: 'The empty weight should be a number, in lb or kg.' };
  var row = [luStr_(body.id, 40), name, type, luStr_(body.size, 60), lb, luStr_(body.whose, 40) || 'Shared', luStr_(body.notes, 200), luToday_()];
  return luLocked_(function() {
    var sh = luSheet_();
    if (row[0] && sh.getLastRow() >= 2) {
      var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === row[0]) { sh.getRange(i + 2, 1, 1, BAG_HEADERS.length).setValues([row]); return { ok: true, bags: luBags_() }; }
    }
    row[0] = row[0] || 'BAG-' + new Date().getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    sh.appendRow(row);
    return { ok: true, bags: luBags_() };
  });
}

/** POST lu_bag_delete {id}. */
function webLuBagDelete_(body) {
  var id = luStr_(body && body.id, 40);
  if (!id) return { ok: false, error: 'id required' };
  return luLocked_(function() {
    var sh = getSpreadsheet().getSheetByName(TABS.BAGS);
    if (sh && sh.getLastRow() >= 2) {
      var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]).trim() === id) sh.deleteRow(i + 2);
    }
    return { ok: true, bags: luBags_() };
  });
}

/** POST lu_move {tripKey, item, bag}: an item into another bag; bag '' puts it back where VERA had it. */
function webLuMove_(body) {
  body = body || {};
  var tripKey = luStr_(body.tripKey, 200), item = luStr_(body.item, 60), bag = luStr_(body.bag, 60);
  if (!tripKey || !/^[pg]:/.test(item)) return { ok: false, error: 'tripKey and item required' };   // bag 'wear': on you on the plane (#234)
  return luLocked_(function() {
    var sh = getSpreadsheet().getSheetByName(TABS.TRIP_META), r = luMetaRow_(sh, tripKey);
    if (!r) { webSetTripMeta_({ parameter: { tripKey: tripKey } }); sh = getSpreadsheet().getSheetByName(TABS.TRIP_META); r = luMetaRow_(sh, tripKey); }
    if (!r) return { ok: false, error: 'That trip has no details row yet.' };
    var cell = sh.getRange(r, LU_JSON_COL_), o = {};
    try { o = JSON.parse(String(cell.getValue() || '') || '{}') || {}; } catch (e) { o = {}; }
    o.moves = o.moves && typeof o.moves === 'object' ? o.moves : {};
    if (bag) o.moves[item] = bag; else delete o.moves[item];
    o.v = 1;
    cell.setValue(JSON.stringify(o));
    return { ok: true, moves: o.moves };
  });
}
