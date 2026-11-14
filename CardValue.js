// ============================================================
// VERA — CardValue.js
// Which card is best for what, by what it's worth: cents back per $1.
// ============================================================
//
// A reward is a rate and a type: "4 x points", "3 % cashback", "2 x miles". Cash back
// counts as it is; points and miles are worth the rate times what a point is worth in
// the program the card earns into (Loyalty Programs: Linked Card lists the card's ID).
// A program's value is your own Cents Per Point (the first number in it, so "1.7 – 2.0+"
// reads 1.7), else its Typical CPP, else VERA's typical value for that program, else 1¢.
//
// The cheat sheet always shows three groups, in this order, then anything else your
// cards earn on. A card's value for a category is its own rate there, else a broader
// rate that covers it (Travel covers flights, hotels and rental cars), else its
// everything-else rate. Ties go to the lower annual fee. Costco takes Visa only.
// "Abroad" offers only cards with no foreign transaction fee.
//
// THE FUNCTIONS BELOW ARE COPIED VERBATIM into the Card Hub block of docs/app.js and
// docs/dashboard-lite.html, so the dashboard and the server always agree.
// test_cardvalue.js compares them.
// ============================================================

// ---- CardValue (shared) ----
var CV_TYPICAL_CPP_ = [
  [/chase|ultimate rewards|\bur\b/i, 1.7], [/amex|membership rewards|\bmr\b/i, 1.6], [/capital one|venture/i, 1.6],
  [/bilt/i, 1.7], [/citi|thankyou/i, 1.5], [/hyatt/i, 1.7], [/united|mileageplus/i, 1.2], [/american|aadvantage/i, 1.4],
  [/delta|skymiles/i, 1.1], [/southwest|rapid rewards/i, 1.3], [/alaska/i, 1.4], [/jetblue|trueblue/i, 1.3],
  [/marriott|bonvoy/i, 0.8], [/hilton|honors/i, 0.5], [/ihg/i, 0.5], [/wyndham/i, 0.9], [/choice/i, 0.6]
];
var CV_GROUPS_ = [
  { group: 'Everyday', items: [
    { key: 'groceries', label: 'Groceries', icon: '🛒', match: /grocer|supermarket/i },
    { key: 'gas',       label: 'Gas / EV', icon: '⛽', match: /\bgas\b|fuel|\bev\b|charging/i },
    { key: 'costco',    label: 'Costco', icon: '🏬', match: /costco/i, visaOnly: true },
    { key: 'dining',    label: 'Dining', icon: '🍽', match: /dining|restaurant/i },
    { key: 'general',   label: 'Everything else', icon: '💳', match: /general|everything|all (other )?purchases|^other$/i }] },
  { group: 'Travel', items: [
    { key: 'flights',   label: 'Flights', icon: '✈️', match: /flight|airfare|airline/i, broad: /^travel$/i },
    { key: 'hotelPre',  label: 'Hotels (prepaid)', icon: '🏨', match: /hotels? \(prepaid\)/i, broad: /^travel$|^hotels?$/i },
    { key: 'hotelPay',  label: 'Hotels (pay at hotel)', icon: '🛎', match: /pay at hotel/i, broad: /^travel$|^hotels?$/i },
    { key: 'portal',    label: 'Travel portal', icon: '🧳', match: /portal/i },
    { key: 'abroad',    label: 'Abroad (no foreign fee)', icon: '🌍', match: /international/i, abroad: true },
    { key: 'rental',    label: 'Rental cars', icon: '🚗', match: /rental|car hire/i, broad: /^travel$/i }] },
  { group: 'Online & bills', items: [
    { key: 'amazon',    label: 'Amazon / Whole Foods', icon: '📦', match: /amazon|whole foods/i },
    { key: 'online',    label: 'Online shopping', icon: '🛍', match: /online shopping|online retail/i },
    { key: 'streaming', label: 'Streaming', icon: '📺', match: /streaming/i },
    { key: 'phone',     label: 'Phone / utilities', icon: '📱', match: /phone|utilit|wireless|internet|cable/i },
    { key: 'rent',      label: 'Rent', icon: '🏠', match: /\brent\b/i }] }
];

/** The first number in a cell ("1.7 – 2.0+" → 1.7, "$325.00" → 325), or null. */
function cvNum_(v) { var m = /-?\d+(?:\.\d+)?/.exec(String(v == null ? '' : v).replace(/,/g, '')); return m ? Number(m[0]) : null; }

/** What a point is worth in a program, in cents: yours, else its typical, else VERA's typical, else 1. */
function cvCpp_(program) {
  if (!program) return 1;
  var own = cvNum_(program.centsPerPoint);
  if (own && own > 0) return own;
  var typ = cvNum_(program.typicalCpp);
  if (typ && typ > 0) return typ;
  var name = String(program.program || '');
  for (var i = 0; i < CV_TYPICAL_CPP_.length; i++) if (CV_TYPICAL_CPP_[i][0].test(name)) return CV_TYPICAL_CPP_[i][1];
  return 1;
}

/** VERA's typical value for a program name, or null. */
function cvTypicalCpp_(name) {
  for (var i = 0; i < CV_TYPICAL_CPP_.length; i++) if (CV_TYPICAL_CPP_[i][0].test(String(name || ''))) return CV_TYPICAL_CPP_[i][1];
  return null;
}

/** The program a card earns into: the one whose Linked Card lists its ID (or its name). */
function cvProgramFor_(card, programs) {
  var id = String((card && card.id) || '').trim().toLowerCase(), nm = String((card && card.cardName) || '').trim().toLowerCase();
  return (programs || []).filter(function(p) {
    return String(p.linkedCard || '').split(/[,;]/).some(function(x) { x = x.trim().toLowerCase(); return x && (x === id || x === nm); });
  })[0] || null;
}

/** Cents back per $1 for one reward row on a card. */
function cvRewardValue_(reward, card, programs) {
  var rate = cvNum_(reward && reward.rate);
  if (rate == null) return 0;
  if (/%|cash/i.test(String(reward.rateType || '') + ' ' + String(reward.rate || ''))) return rate;
  var p = cvProgramFor_(card, programs);
  return Math.round(rate * cvCpp_(p) * 100) / 100;
}

/** The fixed category a reward's category belongs to, or '' (it then shows under More). */
function cvCategoryOf_(category) {
  var c = String(category || '').trim();
  for (var g = 0; g < CV_GROUPS_.length; g++) for (var i = 0; i < CV_GROUPS_[g].items.length; i++) if (CV_GROUPS_[g].items[i].match.test(c)) return CV_GROUPS_[g].items[i].key;
  return '';
}

function cvItem_(key) { for (var g = 0; g < CV_GROUPS_.length; g++) for (var i = 0; i < CV_GROUPS_[g].items.length; i++) if (CV_GROUPS_[g].items[i].key === key) return CV_GROUPS_[g].items[i]; return null; }

/** Is a card open and in use? (Active not "No", and no Closed date.) */
function cvOpen_(card) { return String((card && card.active) || 'Yes').toLowerCase() !== 'no' && !String((card && card.closed) || '').trim(); }

/** No foreign transaction fee: FX Fee % of 0, or No FX Fee set to Yes. */
function cvNoFx_(card) { var f = cvNum_(card && card.fxFeePct); return (card && card.noFxFee) === true || (f != null && String(card.fxFeePct).trim() !== '' && f === 0); }

/** Who may use a card: its owner, its authorised users (comma list), everyone for joint/both. */
function cvUsers_(card) {
  var out = [String((card && card.owner) || '').trim()];
  String((card && card.authUser) || '').split(/[,;&]| and /).forEach(function(x) { x = x.trim(); if (x && out.indexOf(x) === -1) out.push(x); });
  return out.filter(Boolean);
}
function cvCanUse_(card, who) { if (!who) return true; var u = cvUsers_(card).map(function(x) { return x.toLowerCase(); }); return u.indexOf(String(who).toLowerCase()) !== -1 || u.indexOf('joint') !== -1 || u.indexOf('both') !== -1; }

/**
 * A card's best value for one fixed category: { value, reward, how: 'own' | 'broad' | 'general' }.
 * Abroad: the card's International Travel rate, else its everything-else rate.
 */
function cvCardValue_(card, key, rewards, programs) {
  var item = cvItem_(key), mine = (rewards || []).filter(function(r) { return r.cardName === card.cardName; });
  var best = null, consider = function(r, how) { var v = cvRewardValue_(r, card, programs); if (!best || v > best.value) best = { value: v, reward: r, how: how }; };
  mine.forEach(function(r) { if (cvCategoryOf_(r.category) === key) consider(r, 'own'); });
  if (best) return best;
  if (item && item.broad) mine.forEach(function(r) { if (item.broad.test(String(r.category || '').trim())) consider(r, 'broad'); });
  if (best) return best;
  mine.forEach(function(r) { if (cvCategoryOf_(r.category) === 'general') consider(r, 'general'); });
  return best || { value: 0, reward: null, how: 'none' };
}

/**
 * The cheat sheet: every fixed category in order, then the other categories your cards earn
 * on (group "More"), each with its open cards ranked by value, then the lower annual fee.
 * opts: { who: 'Ahmed' | 'Victoria' | '' (anyone's), abroad: true (only no-FX cards) }.
 * → [{ group, key, label, icon, picks: [{ card, value, reward, how }] }]
 */
function cvCheat_(cards, rewards, programs, opts) {
  opts = opts || {};
  var open = (cards || []).filter(function(c) { return cvOpen_(c) && cvCanUse_(c, opts.who) && (!opts.abroad || cvNoFx_(c)); });
  var fee = function(c) { return cvNum_(c.annualFee) || 0; };
  var rank = function(list) { return list.sort(function(a, b) { return (b.value - a.value) || (fee(a.card) - fee(b.card)) || String(a.card.cardName).localeCompare(String(b.card.cardName)); }); };
  var rows = [];
  CV_GROUPS_.forEach(function(g) {
    g.items.forEach(function(it) {
      var list = open.filter(function(c) { return (!it.visaOnly || !String(c.network || '').trim() || /visa/i.test(c.network) || /costco/i.test(c.cardName)) && (!it.abroad || cvNoFx_(c)); })
        .map(function(c) { var v = cvCardValue_(c, it.key, rewards, programs); return { card: c, value: v.value, reward: v.reward, how: v.how }; })
        .filter(function(p) { return p.value > 0 || it.abroad; });
      rows.push({ group: g.group, key: it.key, label: it.label, icon: it.icon, picks: rank(list) });
    });
  });
  var more = {};
  (rewards || []).forEach(function(r) { var c = String(r.category || '').trim(); if (c && !cvCategoryOf_(c) && !/^travel$|^hotels?$/i.test(c)) more[c] = true; });
  Object.keys(more).sort().forEach(function(cat) {
    var list = open.map(function(c) {
      var best = null;
      (rewards || []).forEach(function(r) { if (r.cardName === c.cardName && String(r.category).trim() === cat) { var v = cvRewardValue_(r, c, programs); if (!best || v > best.value) best = { card: c, value: v, reward: r, how: 'own' }; } });
      return best;
    }).filter(Boolean);
    if (list.length) rows.push({ group: 'More', key: 'more:' + cat, label: cat, icon: '•', picks: rank(list) });
  });
  return rows;
}

/** "4x MR ≈ 6.4¢" style: the rate as written and its value. */
function cvRateText_(pick) {
  if (!pick || !pick.reward) return pick && pick.how === 'none' ? 'no rewards' : '';
  var r = pick.reward, t = String(r.rateType || '').toLowerCase();
  var rate = String(r.rate || '').trim() + (/%|cash/.test(t) ? '%' : t.indexOf('mile') !== -1 ? 'x miles' : 'x');
  return rate + (/%|cash/.test(t) ? '' : ' ≈ ' + pick.value + '¢') + (pick.how === 'broad' ? ' (travel rate)' : pick.how === 'general' ? ' (everyday rate)' : '');
}
// ---- /CardValue ----

/** Server: the cheat sheet from the sheet, for Chat and other features. */
function cvCheatFromSheet_(opts) {
  var d = webGetCards_();
  return cvCheat_(d.cards, d.rewards, d.programs, opts);
}
