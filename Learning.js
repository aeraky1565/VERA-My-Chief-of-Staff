/**
 * Learning.js: VERA learns from your corrections (plan B1, Nov 28).
 *
 * 1. RECEIPT LINES. When a receipt is read, each line gets a group (🥕 Grocery, 🧻 Supply,
 *    🎄 Home) and, for Home, a season. What VERA showed is remembered for six hours. When you
 *    save, any line you changed (group or season) is learned for that item, so the next receipt
 *    with "wreath" is already 🎄 Home · Christmas. A line you leave as shown confirms it.
 * 2. THE CARD PER STORE. Each grocery run remembers the card used at that store, per person.
 *    After the same card twice in a row, it is the one suggested there ("what you used at
 *    Costco the last 2 times"), even over the best grocery rate.
 *
 * Both live in Script Properties bundles (Settings.js: LEARN_ITEMS, LEARN_CARDS), compact so
 * they stay well under the 9 KB a property holds. System › Checks › What VERA learned shows
 * them, and Forget undoes any one.
 */

var RL_MAX_ITEMS_ = 120;        // most recently used items kept
var RL_MAX_CARDS_ = 60;
var RL_CARD_STREAK_ = 2;        // the same card this many times in a row → suggested there
var RL_GUESS_TTL_ = 6 * 3600;   // seconds a scan's guesses are remembered
var RL_KINDS_ = { g: 'grocery', s: 'supply', h: 'home' };
var RL_CODES_ = { grocery: 'g', supply: 's', home: 'h' };

/** Pure: the item key, the same one the pantry uses (lower-case, sizes and codes stripped). */
function rlKey_(name) {
  var n = typeof normalizeItemName_ === 'function' ? normalizeItemName_(name) : String(name || '').toLowerCase().trim();
  return String(n || '').replace(/\|/g, ' ').trim().slice(0, 40);
}
function rlDay_(d) { return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

// ---- receipt lines ----------------------------------------------------------------------

/** Pure: "h|Christmas|3|2026-11-28" → {kind, season, times, at}. */
function rlParseItem_(s) {
  var p = String(s || '').split('|');
  var kind = RL_KINDS_[p[0]];
  return kind ? { kind: kind, season: p[1] || '', times: Math.max(1, parseInt(p[2], 10) || 1), at: p[3] || '' } : null;
}
function rlItemStr_(o) { return [RL_CODES_[o.kind] || 'g', String(o.season || '').replace(/\|/g, ' '), o.times || 1, o.at || ''].join('|'); }

function rlItems_() { try { return JSON.parse(veraStateGet_('LEARN_ITEMS').LEARN_ITEMS || '{}') || {}; } catch (e) { return {}; } }
function rlItemsSave_(m) {
  var keys = Object.keys(m);
  if (keys.length > RL_MAX_ITEMS_) {
    keys.sort(function(a, b) { return String((rlParseItem_(m[b]) || {}).at).localeCompare(String((rlParseItem_(m[a]) || {}).at)); });
    keys.slice(RL_MAX_ITEMS_).forEach(function(k) { delete m[k]; });
  }
  veraStateSet_('LEARN_ITEMS', { LEARN_ITEMS: Object.keys(m).length ? JSON.stringify(m) : '' });
}

/**
 * Pure: receipt lines with what you taught VERA applied: the group, and a season for every
 * line (learned, else guessed from the name) so a line you turn into 🎄 Home already has one.
 * lines: [{name, kind, food, ...}] → new lines, each with season and learned (true when changed).
 */
function rlApply_(lines, learned) {
  learned = learned || {};
  return (lines || []).map(function(l) {
    var x = Object.assign({}, l), got = rlParseItem_(learned[rlKey_(l.match || l.name)]);
    var guess = typeof hpSeasonGuess_ === 'function' ? hpSeasonGuess_(l.name) : '';
    x.season = guess;
    if (got) {
      if (got.kind !== x.kind) { x.kind = got.kind; x.food = got.kind === 'grocery'; x.learned = true; }
      if (got.kind === 'home' && got.season) { if (got.season !== guess) x.learned = true; x.season = got.season; }
    }
    return x;
  });
}

/** Pure: what changed between what VERA showed and what you saved. → [{key, kind, season, changed}] */
function rlDiff_(saved, guesses) {
  var out = [];
  (saved || []).forEach(function(l) {
    var key = rlKey_(l.name), g = guesses && guesses[key];
    if (!key || !g) return;                         // not from a scan VERA remembers: nothing to learn
    var gp = String(g).split('|'), kind = RL_KINDS_[RL_CODES_[String(l.kind || '')]] ? String(l.kind) : (l.food === false ? 'supply' : 'grocery');
    var season = kind === 'home' ? String(l.season || '') : '';
    var changed = RL_KINDS_[gp[0]] !== kind || (kind === 'home' && season !== (gp[1] || ''));
    out.push({ key: key, kind: kind, season: season, changed: changed });
  });
  return out;
}

/** Pure: the learned map after a save. A change is learned; a confirmation adds to it. */
function rlLearn_(learned, diffs, today) {
  var m = Object.assign({}, learned || {});
  (diffs || []).forEach(function(d) {
    var cur = rlParseItem_(m[d.key]);
    if (d.changed) m[d.key] = rlItemStr_({ kind: d.kind, season: d.season, times: cur && cur.kind === d.kind ? cur.times + 1 : 1, at: today });
    else if (cur) m[d.key] = rlItemStr_({ kind: cur.kind, season: cur.season, times: cur.times + 1, at: today });
  });
  return m;
}

/** At a scan: lines with what VERA learned applied, and what was shown remembered. Never throws. */
function rlScanLines_(lines) {
  try {
    var out = rlApply_(lines, rlItems_());
    var c = CacheService.getScriptCache(), g = {};
    try { g = JSON.parse(c.get('RL_GUESS') || '{}') || {}; } catch (e) { g = {}; }
    out.forEach(function(x) { var k = rlKey_(x.match || x.name); if (k) g[k] = (RL_CODES_[x.kind] || 'g') + '|' + (x.season || ''); });
    var keys = Object.keys(g); if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(function(k) { delete g[k]; });
    c.put('RL_GUESS', JSON.stringify(g), RL_GUESS_TTL_);
    return out;
  } catch (e) { Logger.log('rlScanLines_ (non-fatal): ' + e.message); return lines; }
}

/** At a save: lines [{name, kind, food, season}] compared with the scan; changes learned. Never throws. → changes */
function rlNoteLines_(lines) {
  try {
    var g = {}; try { g = JSON.parse(CacheService.getScriptCache().get('RL_GUESS') || '{}') || {}; } catch (e) { g = {}; }
    var diffs = rlDiff_(lines, g);
    if (!diffs.length) return 0;
    var before = rlItems_(), after = rlLearn_(before, diffs, rlDay_());
    if (JSON.stringify(after) !== JSON.stringify(before)) rlItemsSave_(after);
    return diffs.filter(function(d) { return d.changed; }).length;
  } catch (e) { Logger.log('rlNoteLines_ (non-fatal): ' + e.message); return 0; }
}

// ---- the card per store -----------------------------------------------------------------

function rlCards_() { try { return JSON.parse(veraStateGet_('LEARN_CARDS').LEARN_CARDS || '{}') || {}; } catch (e) { return {}; } }
function rlCardKey_(store, who) { return String(store || '').trim().toLowerCase().replace(/\|/g, ' ').slice(0, 40) + '|' + String(who || '').trim(); }

/** Pure: the cards map after a run on card at store by who. "card|times in a row|date". */
function rlCardRun_(m, store, who, card, today) {
  var out = Object.assign({}, m || {}), k = rlCardKey_(store, who);
  if (!card || !String(store || '').trim() || !who) return out;
  var p = String(out[k] || '').split('|');
  var times = p[0] === card ? (parseInt(p[1], 10) || 1) + 1 : 1;
  out[k] = [String(card).replace(/\|/g, ' '), times, today, String(store).trim().replace(/\|/g, ' ').slice(0, 40)].join('|');
  return out;
}

/** Pure: the learned card for a store and person, or null: the same card RL_CARD_STREAK_ times in a row, still one of theirs. */
function rlCardFor_(m, store, who, theirCards) {
  var p = String((m || {})[rlCardKey_(store, who)] || '').split('|'), times = parseInt(p[1], 10) || 0;
  if (!p[0] || times < RL_CARD_STREAK_) return null;
  if (theirCards && theirCards.length && theirCards.indexOf(p[0]) === -1) return null;
  return { card: p[0], times: times, at: p[2] || '', learned: true,
    store: p[3] || String(store).trim(), why: 'what you used at ' + (p[3] || String(store).trim()) + ' the last ' + times + ' times' };
}

/** After a saved run. Never throws. */
function rlNoteCard_(store, who, card) {
  try {
    var before = rlCards_(), after = rlCardRun_(before, store, who, card, rlDay_());
    var keys = Object.keys(after);
    if (keys.length > RL_MAX_CARDS_) {
      keys.sort(function(a, b) { return String(after[b].split('|')[2]).localeCompare(String(after[a].split('|')[2])); });
      keys.slice(RL_MAX_CARDS_).forEach(function(k) { delete after[k]; });
    }
    if (JSON.stringify(after) !== JSON.stringify(before)) veraStateSet_('LEARN_CARDS', { LEARN_CARDS: JSON.stringify(after) });
  } catch (e) { Logger.log('rlNoteCard_ (non-fatal): ' + e.message); }
}

// ---- What VERA learned --------------------------------------------------------------------

/** Pure: the panel's lists. Items: changed from what VERA would guess on its own. Cards: in force. */
function rlLearnedLists_(items, cards) {
  var it = Object.keys(items || {}).map(function(k) { var o = rlParseItem_(items[k]); return o ? Object.assign({ key: k, name: k }, o) : null; })
    .filter(Boolean).sort(function(a, b) { return String(b.at).localeCompare(String(a.at)); });
  var cd = Object.keys(cards || {}).map(function(k) {
    var parts = k.split('|'), o = rlCardFor_(cards, parts[0], parts[1]);
    return o ? { key: k, store: o.store, who: parts[1], card: o.card, times: o.times, at: o.at } : null;
  }).filter(Boolean).sort(function(a, b) { return String(b.at).localeCompare(String(a.at)); });
  return { items: it, cards: cd };
}

/** GET learn_forget — type item|card, key: VERA forgets that one. */
function webLearnForget_(e) {
  var p = (e && e.parameter) || e || {}, type = String(p.type || ''), key = String(p.key || '');
  if (!key || (type !== 'item' && type !== 'card')) return { ok: false, error: 'Which one?' };
  return veraLocked_(function() {
    if (type === 'item') { var m = rlItems_(); if (!m[key]) return { ok: false, error: 'VERA hasn’t learned that one' }; delete m[key]; rlItemsSave_(m); }
    else { var c = rlCards_(); if (!c[key]) return { ok: false, error: 'VERA hasn’t learned that one' }; delete c[key]; veraStateSet_('LEARN_CARDS', { LEARN_CARDS: Object.keys(c).length ? JSON.stringify(c) : '' }); }
    return { ok: true, type: type, key: key };
  });
}
