// ============================================================
// WishLists.js — the family Christmas wish-list docs, read as they are laid out
// ============================================================
//
// Each person's doc (Config: wishlist_<person> = <Doc ID>) is a stack of years,
// newest first. A year has:
//   · a banner — a one-cell table "2026", or a paragraph "2023" / "2020 Ange's List"
//   · a "Wishlist" bullet list — what they asked for; struck out = taken care of
//   · a gift table, Item | Purchaser | Purchased | Wrapped — the last two are
//     checklist boxes, and a ticked box shows as struck through
//   · older years: Item | Cost | Who is purchasing ("Purchased - Vic"), Total rows,
//     and "Ideas for next year"
//
// The old reader took getParagraphs(), which returns every table CELL as its own
// paragraph, across every year — so the dashboard showed a pile of words. This
// reads the document's structure instead. Two layers, so tests need no Google:
//   wishDocBlocks_(body)  Apps Script → plain blocks (the only DocumentApp code)
//   parseWishDoc_(blocks) blocks → { years: { 2026: { wishlist, gifts, ideas } } }
//
// The docs are never written to.

var WISH_INITIALS_PREFIX_   = 'gift_initials_';
var WISH_SEEDED_PROPERTY_   = 'WISHLIST_INITIALS_SEEDED';
var WISH_INITIALS_DEFAULTS_ = [['gift_initials_AE', 'Ahmed'], ['gift_initials_VV', 'Victoria']];
var WISH_OURS_              = ['Ahmed', 'Victoria'];
var WISH_FLAG_PREFIX_       = 'gift__';
var WISH_WRAP_DAY_          = 20;   // "not wrapped yet" from Dec 20
var WISH_LAST_DAY_          = 25;   // flags run Dec 1–25

// ============================================================
// THE DOCUMENT → PLAIN BLOCKS
// ============================================================

/** True when an element's text is struck through — how a ticked checklist box shows. */
function wishStruck_(el) {
  try {
    var attrs = el.getAttributes ? el.getAttributes() : null;
    if (attrs && attrs[DocumentApp.Attribute.STRIKETHROUGH] === true) return true;
  } catch (e) {}
  try {
    var t = el.editAsText();
    if (t.isStrikethrough() === true) return true;
    if (t.getText().length && t.isStrikethrough(0) === true) return true;
  } catch (e) {}
  return false;
}

/**
 * The body as a list of blocks, in order:
 *   { t: 'p', text, list: bool, struck: bool }
 *   { t: 'table', rows: [[ { text, struck } ]] }
 * A cell is struck when any list item inside it is: that is a ticked checklist box.
 */
function wishDocBlocks_(body) {
  var T = DocumentApp.ElementType, out = [];
  for (var i = 0; i < body.getNumChildren(); i++) {
    var el = body.getChild(i), type = el.getType();
    if (type === T.PARAGRAPH || type === T.LIST_ITEM) {
      out.push({ t: 'p', text: String(el.getText() || '').trim(), list: type === T.LIST_ITEM, struck: wishStruck_(el) });
    } else if (type === T.TABLE) {
      var tbl = el.asTable(), rows = [];
      for (var r = 0; r < tbl.getNumRows(); r++) {
        var row = tbl.getRow(r), cells = [];
        for (var c = 0; c < row.getNumCells(); c++) {
          var cell = row.getCell(c), struck = false;
          for (var k = 0; k < cell.getNumChildren(); k++) {
            var ch = cell.getChild(k);
            if (ch.getType() === T.LIST_ITEM && wishStruck_(ch)) struck = true;
          }
          cells.push({ text: String(cell.getText() || '').trim(), struck: struck });
        }
        rows.push(cells);
      }
      out.push({ t: 'table', rows: rows });
    }
  }
  return out;
}

// ============================================================
// PLAIN BLOCKS → YEARS  (pure)
// ============================================================

/** "2026", "2020 Ange's Christmas List" → 2026 / 2020; anything else → 0. */
function wishYearOf_(text) {
  var m = /^\s*\*{0,2}\s*((?:19|20)\d\d)\b/.exec(String(text || ''));
  return m && String(text).trim().length <= 60 ? Number(m[1]) : 0;
}

/** Index of the first header cell matching re, or -1. Columns are found by label. */
function wishCol_(header, re) {
  for (var i = 0; i < header.length; i++) if (re.test(header[i])) return i;
  return -1;
}

/**
 * A gift table's rows. Columns by header label — never by position:
 *   Item · Purchaser or "Who is purchasing" · Purchased · Wrapped (Cost is ignored).
 * Blank template rows and Total rows are dropped. Old-format "Purchased - Vic" /
 * "VV-wrapped" carry the state in the purchaser text.
 */
function wishParseGiftTable_(rows) {
  var header = rows[0].map(function(c) { return String(c.text || '').replace(/\*/g, '').trim().toLowerCase(); });
  var cItem = wishCol_(header, /^item/);
  if (cItem === -1) return null;
  var cWho  = wishCol_(header, /purchaser|who is purchasing|^who\b/);
  var cBuy  = wishCol_(header, /^purchased/);
  var cWrap = wishCol_(header, /^wrapped/);
  var gifts = [];
  rows.slice(1).forEach(function(row) {
    var cell = function(i) { return i >= 0 && row[i] ? row[i] : { text: '', struck: false }; };
    var item = cell(cItem).text.replace(/\s+/g, ' ').trim();
    if (!item || /^total\b/i.test(item)) return;
    var who = cell(cWho).text.replace(/\s+/g, ' ').trim();
    var ticked = function(c) { return c.struck || /^(yes|y|x|✓|✔|done)$/i.test(c.text); };
    var purchased = ticked(cell(cBuy)), wrapped = ticked(cell(cWrap));
    // Old format: the state lives in the purchaser text.
    if (/\bwrapped\b/i.test(who)) { wrapped = true; purchased = true; }
    if (/\bpurchased\b/i.test(who)) purchased = true;
    who = who.replace(/\b(purchased|wrapped)\b/ig, ' ').replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
             .replace(/\s*[\-–—]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    gifts.push({ item: item, purchaserRaw: who, purchased: purchased, wrapped: wrapped });
  });
  return gifts;
}

/**
 * The whole doc, by year. Anything before the first year banner (the doc's title)
 * is ignored. Lists count only under a "Wishlist" or "Ideas for next year" heading.
 */
function parseWishDoc_(blocks) {
  var years = {}, cur = null, mode = null;
  var section = function(y) {
    if (!years[y]) years[y] = { wishlist: [], gifts: [], ideas: [] };
    return years[y];
  };
  (blocks || []).forEach(function(b) {
    if (b.t === 'table') {
      if (b.rows.length === 1 && b.rows[0].length === 1 && wishYearOf_(b.rows[0][0].text)) {
        cur = section(wishYearOf_(b.rows[0][0].text)); mode = null; return;
      }
      if (!cur || !b.rows.length) return;
      var gifts = wishParseGiftTable_(b.rows);
      if (gifts) cur.gifts = cur.gifts.concat(gifts);
      mode = null;
      return;
    }
    var text = String(b.text || '').replace(/\*/g, '').trim();
    if (!b.list) {
      if (!text) return;   // blank lines never end a list
      var y = wishYearOf_(text);
      if (y) { cur = section(y); mode = null; return; }
      mode = /^wish\s*list\b/i.test(text) ? 'wish' : /^ideas\b/i.test(text) ? 'ideas' : null;
      return;
    }
    if (!cur || !text) return;
    if (mode === 'wish')  cur.wishlist.push({ text: text, done: !!b.struck });
    if (mode === 'ideas') cur.ideas.push(text);
  });
  return { years: years };
}

// ============================================================
// WHO IS BUYING — initials mapped through Config  (pure)
// ============================================================

/** { AE: 'Ahmed', VV: 'Victoria', … } from Config rows gift_initials_<XX>. */
function wishInitialsMap_(cfg) {
  var map = {};
  Object.keys(cfg || {}).forEach(function(k) {
    if (k.toLowerCase().indexOf(WISH_INITIALS_PREFIX_) !== 0) return;
    var v = String(cfg[k] || '').trim();
    if (v) map[k.slice(WISH_INITIALS_PREFIX_.length).trim().toUpperCase()] = v;
  });
  return map;
}

/** Looks like initials, not a name: "VV", "AE", "cv" — but not "Mom" or "Vic". */
function wishLooksLikeInitials_(tok) {
  return /^[A-Z]{2,3}$/.test(tok) || /^[a-z]{2}$/.test(tok);
}

/**
 * "Stocking VV" → { names: ['Victoria'], stocking: true, ours: true }
 * "VV/AE", "CV&KV", "Ange and Vic", "CV on behalf of Alex" all split into people.
 * Initials map through Config; anything unmapped is kept exactly as written.
 */
function wishPurchasers_(raw, initials) {
  var stocking = /\bstocking\b/i.test(raw);
  var toks = String(raw || '').replace(/\bstocking\b/ig, ' ').replace(/\bon behalf of\b/ig, ' ')
    .split(/[\/&,+]|\band\b|\s+/i).map(function(t) { return t.trim(); }).filter(Boolean);
  var names = [], unmapped = [];
  toks.forEach(function(t) {
    var mapped = initials[t.toUpperCase()];
    var name = mapped || t;
    if (!mapped && wishLooksLikeInitials_(t)) unmapped.push(t.toUpperCase());
    if (names.indexOf(name) === -1) names.push(name);
  });
  var ours = names.some(function(n) { return WISH_OURS_.indexOf(n) !== -1; });
  return { names: names, stocking: stocking, ours: ours, unmapped: unmapped };
}

// ============================================================
// WISHES NOBODY HAS CLAIMED  (pure)
// ============================================================

var WISH_STOP_ = { the: 1, and: 1, for: 1, with: 1, from: 1, new: 1, likes: 1, like: 1, some: 1, any: 1 };

function wishWords_(s) {
  return (String(s || '').toLowerCase().match(/[a-z]{3,}/g) || []).filter(function(w) { return !WISH_STOP_[w]; });
}

/** "Yoga Matt" and "Yoga Mat" share a word: one word starts with the other. */
function wishMatches_(a, b) {
  var wa = wishWords_(a), wb = wishWords_(b);
  return wa.some(function(x) {
    return wb.some(function(y) { return x === y || x.indexOf(y) === 0 || y.indexOf(x) === 0; });
  });
}

/** Marks each open wish claimed or not, against the year's gift table. */
function wishMarkClaims_(sec) {
  sec.wishlist.forEach(function(w) {
    w.claimed = w.done || sec.gifts.some(function(g) { return wishMatches_(w.text, g.item); });
  });
  return sec;
}

// ============================================================
// THE YEAR VERA OPENS ON
// ============================================================

/**
 * The upcoming Christmas. It rolls over on Jan 1 — Dec 26–31 still belong to the
 * Christmas just gone (returns, wrapping up) — so it is simply the calendar year.
 */
function upcomingChristmasYear_(today) {
  return (today || new Date()).getFullYear();
}

/** A section with nothing in it reads the same as no section: not started. */
function wishNotStarted_(sec) {
  return !sec || (!sec.wishlist.length && !sec.gifts.length && !sec.ideas.length);
}

// ============================================================
// ENDPOINT  (action get_wish_lists)
// ============================================================

/** The wishlist_<person> Config rows, as [{ person, docId }]. */
function wishListEntries_(cfg) {
  var out = [];
  Object.keys(cfg || {}).forEach(function(k) {
    var key = k.toLowerCase(), val = String(cfg[k] || '').trim();
    if (key.indexOf('wishlist_') !== 0 || !val) return;
    var person = key.replace('wishlist_', '').split('_').map(function(w) {
      return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
    }).join(' ').trim();
    out.push({ person: person, docId: val });
  });
  return out;
}

/** One person's doc, shaped for the dashboard. Pure apart from the blocks passed in. */
function wishPersonView_(person, blocks, initials, upcoming) {
  var parsed = parseWishDoc_(blocks), unmapped = {};
  var years = Object.keys(parsed.years).map(Number).sort(function(a, b) { return b - a; });
  var sections = {};
  years.forEach(function(y) {
    var sec = parsed.years[y];
    sec.gifts.forEach(function(g) {
      var p = wishPurchasers_(g.purchaserRaw, initials);
      g.names = p.names; g.stocking = p.stocking; g.ours = p.ours;
      p.unmapped.forEach(function(u) { unmapped[u] = true; });
    });
    sections[y] = wishMarkClaims_(sec);
  });
  return {
    person: person, years: years, sections: sections, error: null,
    notStarted: wishNotStarted_(sections[upcoming]),
    unmapped: Object.keys(unmapped).sort(),
  };
}

function webGetFamilyWishLists_() {
  var cfg = getConfigValues();
  var entries = wishListEntries_(cfg);
  var upcoming = upcomingChristmasYear_(new Date());
  if (!entries.length) {
    return { ok: true, upcomingYear: upcoming, people: [], note: 'No wishlist_* keys found in Config tab.' };
  }
  var initials = wishInitialsMap_(cfg), unmapped = {};
  var people = entries.map(function(entry) {
    try {
      var v = wishPersonView_(entry.person, wishDocBlocks_(DocumentApp.openById(entry.docId).getBody()), initials, upcoming);
      v.unmapped.forEach(function(u) { unmapped[u] = true; });
      return v;
    } catch (err) {
      return { person: entry.person, years: [], sections: {}, notStarted: true, unmapped: [],
               error: 'Couldn’t open the doc: ' + err.message };
    }
  });
  return { ok: true, upcomingYear: upcoming, people: people, unmappedInitials: Object.keys(unmapped).sort() };
}

// ============================================================
// CONFIG — the two initials VERA knows, written once
// ============================================================

/**
 * Adds gift_initials_AE = Ahmed and gift_initials_VV = Victoria to Config, once.
 * Never overwrites a row that's there. Everyone else's initials are yours to add.
 */
function seedWishListInitialsConfig_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(WISH_SEEDED_PROPERTY_)) return 0;
  var sheet = getSpreadsheet().getSheetByName(TABS.CONFIG);
  if (!sheet) return 0;
  var existing = {};
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function(r) {
      existing[String(r[0] || '').trim().toLowerCase()] = true;
    });
  }
  var added = 0;
  WISH_INITIALS_DEFAULTS_.forEach(function(pair) {
    if (existing[pair[0].toLowerCase()]) return;
    sheet.appendRow(pair);
    added++;
  });
  props.setProperty(WISH_SEEDED_PROPERTY_, new Date().toISOString());
  _configCache_ = null;
  Logger.log('seedWishListInitialsConfig_: added ' + added + ' initials row(s).');
  return added;
}

// ============================================================
// FLAGS — our unbought (and, from Dec 20, unwrapped) gifts, Dec 1–25
// ============================================================

function wishSlug_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** Inside the window, the flags that should be open now. Pure. */
function wishGiftFlagsDue_(people, today) {
  var m = today.getMonth() + 1, d = today.getDate();
  if (m !== 12 || d > WISH_LAST_DAY_) return [];
  var year = upcomingChristmasYear_(today), due = [];
  (people || []).forEach(function(p) {
    var sec = p.sections && p.sections[year];
    if (!sec) return;
    sec.gifts.forEach(function(g) {
      if (!g.ours) return;
      var who = g.names.filter(function(n) { return WISH_OURS_.indexOf(n) !== -1; }).join(' and ');
      var stage = !g.purchased ? 'unbought' : (!g.wrapped && d >= WISH_WRAP_DAY_) ? 'unwrapped' : '';
      if (!stage) return;
      due.push({
        source:  'Gifts',
        flag:    (stage === 'unbought' ? 'Not bought yet: ' : 'Not wrapped yet: ') + g.item + ' for ' + p.person + ' (' + who + ').',
        reason:  'From ' + p.person + '’s ' + year + ' Christmas list.',
        urgency: 'Medium',
        key:     [WISH_FLAG_PREFIX_ + stage, wishSlug_(p.person), year, wishSlug_(g.item)].join('__'),
      });
    });
  });
  return due;
}

/** Closes open gift flags that are no longer due — the box got ticked, or the row went. */
function wishResolveStale_(flagSheet, dueKeys) {
  var lastRow = flagSheet.getLastRow();
  if (lastRow < 2) return 0;
  var rows = flagSheet.getRange(2, 9, lastRow - 1, 2).getValues();   // Resolved, Key
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    var key = String(rows[i][1] || '').trim();
    if (key.indexOf(WISH_FLAG_PREFIX_) !== 0 || dueKeys[key]) continue;
    if (String(rows[i][0] || '').trim().toLowerCase() === 'yes') continue;
    flagSheet.getRange(i + 2, 9).setValue('Yes');
    n++;
  }
  return n;
}

/** Nightly. Raises each due flag once (exact keys) and closes the ones that aren't. */
function checkWishListGifts_() {
  var today = new Date();
  var flagSheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!flagSheet) return;
  var due = [];
  if (today.getMonth() === 11 && today.getDate() <= WISH_LAST_DAY_) {
    due = wishGiftFlagsDue_(webGetFamilyWishLists_().people, today);
  }
  var dueKeys = {};
  due.forEach(function(f) { dueKeys[f.key] = true; });
  var dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var written = due.length ? appendExactKeyFlags_(flagSheet, due, dateStr) : 0;
  var closed = wishResolveStale_(flagSheet, dueKeys);
  Logger.log('checkWishListGifts_: ' + written + ' raised, ' + closed + ' closed, ' + due.length + ' due.');
}
