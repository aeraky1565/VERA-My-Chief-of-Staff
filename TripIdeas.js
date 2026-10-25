// ============================================================
// VERA — TripIdeas.js
// Trip Ideas: trips that have no dates yet (Travel → Trip Ideas).
// ============================================================
//
// An idea is a loose brief ("Spring in Europe": a few months, a range of nights,
// who is going, a budget from WILLA) with candidate options under it. An option
// is one concrete shape for the trip: an ordered list of legs from home and back
// (stops with nights, and the moves between them by plane, train, car, ship…),
// a cost by category, and what is for and against it.
//
// Nothing here touches a calendar. An idea becomes a trip only when Ahmed adds
// the event himself (stage 5 links the two through the Trips registry).
//
// Two layers, so the tests need no Google:
//   tiClean*_      raw dashboard input → a clean record (pure; every field bounded)
//   web*TripIdea*_ the sheet reads and writes, under the script lock
// ============================================================

var TI_STATUSES_  = ['brainstorming', 'shortlisted', 'settled', 'archived'];
var TI_PACES_     = ['slow', 'balanced', 'packed'];
var TI_OPEN_TO_   = ['stay', 'train', 'cruise', 'road'];
var TI_MODES_     = ['fly', 'train', 'car', 'ship', 'ferry', 'bus', 'other'];
var TI_COST_KEYS_ = ['flights', 'stays', 'cruise', 'ground', 'daily'];
var TI_SOURCES_   = ['manual', 'vera', 'chatgpt', 'claude', 'gemini', 'aria', 'other'];
var TI_FLAGS_     = ['', 'star', 'out'];
var TI_MAX_LEGS_  = 40;

// ---- pure: cleaning ----------------------------------------------------------

/** Pure: a trimmed string, cut to max characters. */
function tiStr_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Pure: a whole number inside [lo, hi], or null when there is none. */
function tiInt_(v, lo, hi) {
  if (v === '' || v == null) return null;
  var n = Math.round(Number(v));
  if (!isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

/** Pure: one of the allowed values, else the fallback. */
function tiOneOf_(v, list, fallback) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return list.indexOf(s) !== -1 ? s : fallback;
}

/** Pure: a list of short lines from an array or newline text, blanks dropped. */
function tiLines_(v, maxLines, maxLen) {
  var arr = Array.isArray(v) ? v : String(v == null ? '' : v).split('\n');
  return arr.map(function(x) { return tiStr_(x, maxLen); }).filter(Boolean).slice(0, maxLines);
}

/**
 * Pure: an idea as the dashboard sent it, made safe to store.
 * Months are 'yyyy-MM' (none = any time); nights are a range the two ends of
 * which are put in order; the budget is one number (WILLA's figure) or null.
 */
function tiCleanIdea_(raw) {
  raw = raw || {};
  var months = (Array.isArray(raw.months) ? raw.months : []).map(function(m) { return String(m).trim(); })
    .filter(function(m, i, a) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && a.indexOf(m) === i; }).sort().slice(0, 24);
  var lo = tiInt_(raw.nightsMin, 1, 90), hi = tiInt_(raw.nightsMax, 1, 90);
  if (lo != null && hi != null && lo > hi) { var t = lo; lo = hi; hi = t; }
  var budget = raw.budget === '' || raw.budget == null ? null : Math.round(Number(String(raw.budget).replace(/[^0-9.]/g, '')));
  if (!isFinite(budget) || budget < 0) budget = null;
  var openTo = (Array.isArray(raw.openTo) ? raw.openTo : []).map(function(x) { return String(x).trim().toLowerCase(); })
    .filter(function(x, i, a) { return TI_OPEN_TO_.indexOf(x) !== -1 && a.indexOf(x) === i; });
  return {
    id: tiStr_(raw.id, 40),
    title: tiStr_(raw.title, 80),
    where: tiStr_(raw.where, 160),
    months: months,
    nightsMin: lo,
    nightsMax: hi,
    travelers: tiStr_(raw.travelers, 120),
    budget: budget,
    pace: tiOneOf_(raw.pace, TI_PACES_, 'balanced'),
    openTo: openTo,
    mustHaves: String(raw.mustHaves == null ? '' : raw.mustHaves).trim().slice(0, 1000),
    status: tiOneOf_(raw.status, TI_STATUSES_, 'brainstorming'),
    chosenOption: tiStr_(raw.chosenOption, 40),
    tripId: tiStr_(raw.tripId, 40),
  };
}

/**
 * Pure: an option's legs, in travel order. Each is a stop {kind:'stop', place,
 * nights, note} or a move {kind:'move', mode, from, to, note}. A trip can mix
 * every mode (fly → drive → cruise → train → fly) or be one flight in and out;
 * the list is the trip, home to home is implied. Empty legs are dropped.
 */
function tiCleanLegs_(legs) {
  return (Array.isArray(legs) ? legs : []).map(function(l) {
    l = l || {};
    if (l.kind === 'stop') {
      var place = tiStr_(l.place, 80);
      return place ? { kind: 'stop', place: place, nights: tiInt_(l.nights, 0, 60) || 0, note: tiStr_(l.note, 120) } : null;
    }
    if (l.kind === 'move') {
      var from = tiStr_(l.from, 60), to = tiStr_(l.to, 60), note = tiStr_(l.note, 120);
      return { kind: 'move', mode: tiOneOf_(l.mode, TI_MODES_, 'other'), from: from, to: to, note: note };
    }
    return null;
  }).filter(Boolean).slice(0, TI_MAX_LEGS_);
}

/**
 * Pure: the cost by category, each a range {low, high, basis}. Basis says where
 * the figure came from ("estimate", "ARIA · Oct 24", "their estimate"). A
 * category with no figure is left out rather than stored as zero.
 */
function tiCleanCost_(cost) {
  var out = {};
  cost = cost || {};
  TI_COST_KEYS_.forEach(function(k) {
    var c = cost[k] || {};
    var num = function(v) { if (v === '' || v == null) return null; var n = Math.round(Number(String(v).replace(/[^0-9.]/g, ''))); return isFinite(n) && n >= 0 ? n : null; };
    var lo = num(c.low), hi = num(c.high);
    if (lo == null && hi == null) return;
    if (lo == null) lo = hi; if (hi == null) hi = lo;
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    out[k] = { low: lo, high: hi, basis: tiStr_(c.basis, 60) };
  });
  return out;
}

/** Pure: an option as the dashboard sent it, made safe to store. */
function tiCleanOption_(raw) {
  raw = raw || {};
  return {
    id: tiStr_(raw.id, 40),
    ideaId: tiStr_(raw.ideaId, 40),
    name: tiStr_(raw.name, 100),
    source: tiOneOf_(raw.source, TI_SOURCES_, 'manual'),
    flag: TI_FLAGS_.indexOf(String(raw.flag || '')) !== -1 ? String(raw.flag || '') : '',
    legs: tiCleanLegs_(raw.legs),
    cost: tiCleanCost_(raw.cost),
    pros: tiLines_(raw.pros, 12, 120),
    cons: tiLines_(raw.cons, 12, 120),
    order: tiInt_(raw.order, 0, 999) || 0,
  };
}

// ---- pure: rows --------------------------------------------------------------

function tiParse_(s, fallback) { try { var v = JSON.parse(String(s || '')); return v == null ? fallback : v; } catch (e) { return fallback; } }

/** Pure: an idea ↔ its sheet row, in TRIP_IDEAS_HEADERS order. */
function tiIdeaToRow_(i, created, updated) {
  return [i.id, i.title, i.where, JSON.stringify(i.months), i.nightsMin == null ? '' : i.nightsMin, i.nightsMax == null ? '' : i.nightsMax,
    i.travelers, i.budget == null ? '' : i.budget, i.pace, JSON.stringify(i.openTo), i.mustHaves, i.status, i.chosenOption, i.tripId, created, updated];
}
function tiIdeaFromRow_(r) {
  var i = tiCleanIdea_({ id: r[0], title: r[1], where: r[2], months: tiParse_(r[3], []), nightsMin: r[4], nightsMax: r[5],
    travelers: r[6], budget: r[7], pace: r[8], openTo: tiParse_(r[9], []), mustHaves: r[10], status: r[11], chosenOption: r[12], tripId: r[13] });
  i.created = String(r[14] || ''); i.updated = String(r[15] || '');
  return i;
}

/** Pure: an option ↔ its sheet row, in TRIP_IDEA_OPTIONS_HEADERS order. */
function tiOptionToRow_(o, created, updated) {
  return [o.id, o.ideaId, o.name, o.source, o.flag, JSON.stringify(o.legs), JSON.stringify(o.cost), o.pros.join('\n'), o.cons.join('\n'), o.order, created, updated];
}
function tiOptionFromRow_(r) {
  var o = tiCleanOption_({ id: r[0], ideaId: r[1], name: r[2], source: r[3], flag: r[4], legs: tiParse_(r[5], []), cost: tiParse_(r[6], {}),
    pros: r[7], cons: r[8], order: r[9] });
  o.created = String(r[10] || ''); o.updated = String(r[11] || '');
  return o;
}

// ---- the sheets ----------------------------------------------------------------

/** The two tabs, created on demand (createSheetTabs only runs from setupVERA). */
function tiIdeasSheet_()   { return ensureSheet(getSpreadsheet(), TABS.TRIP_IDEAS, TRIP_IDEAS_HEADERS); }
function tiOptionsSheet_() { return ensureSheet(getSpreadsheet(), TABS.TRIP_IDEA_OPTIONS, TRIP_IDEA_OPTIONS_HEADERS); }

function tiRows_(sheet, width) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
}

/** The sheet row (1-based) holding an id in column A, or -1. */
function tiRowOf_(sheet, width, id) {
  var rows = tiRows_(sheet, width);
  for (var k = 0; k < rows.length; k++) if (String(rows[k][0]).trim() === id) return k + 2;
  return -1;
}

function tiMintId_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(); }

function tiNow_() { return new Date().toISOString(); }

function tiLocked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---- endpoints -----------------------------------------------------------------

/** GET ?action=trip_ideas → every idea and every option. A handful of rows; no paging. */
function webGetTripIdeas_() {
  var ideas = tiRows_(tiIdeasSheet_(), TRIP_IDEAS_HEADERS.length).filter(function(r) { return String(r[0]).trim(); }).map(tiIdeaFromRow_);
  var options = tiRows_(tiOptionsSheet_(), TRIP_IDEA_OPTIONS_HEADERS.length).filter(function(r) { return String(r[0]).trim(); }).map(tiOptionFromRow_);
  return { ok: true, ideas: ideas, options: options };
}

/** POST {action:'trip_idea_save', idea} → creates (no id) or updates an idea. */
function webSaveTripIdea_(body) {
  var idea = tiCleanIdea_(body && body.idea);
  if (!idea.title) return { ok: false, error: 'Give the idea a name' };
  return tiLocked_(function() {
    var sheet = tiIdeasSheet_(), w = TRIP_IDEAS_HEADERS.length, now = tiNow_();
    var row = idea.id ? tiRowOf_(sheet, w, idea.id) : -1;
    if (idea.id && row === -1) return { ok: false, error: 'That idea no longer exists' };
    if (row === -1) {
      idea.id = tiMintId_('IDEA-');
      sheet.appendRow(tiIdeaToRow_(idea, now, now));
      idea.created = now;
    } else {
      var created = String(sheet.getRange(row, 15).getValue() || now);
      sheet.getRange(row, 1, 1, w).setValues([tiIdeaToRow_(idea, created, now)]);
      idea.created = created;
    }
    idea.updated = now;
    return { ok: true, idea: idea };
  });
}

/** POST {action:'trip_idea_delete', id} → the idea and all of its options. */
function webDeleteTripIdea_(body) {
  var id = tiStr_(body && body.id, 40);
  if (!id) return { ok: false, error: 'id required' };
  return tiLocked_(function() {
    var sheet = tiIdeasSheet_(), row = tiRowOf_(sheet, TRIP_IDEAS_HEADERS.length, id);
    if (row === -1) return { ok: false, error: 'That idea no longer exists' };
    sheet.deleteRow(row);
    var os = tiOptionsSheet_(), rows = tiRows_(os, TRIP_IDEA_OPTIONS_HEADERS.length), removed = 0;
    for (var k = rows.length - 1; k >= 0; k--) {
      if (String(rows[k][1]).trim() === id) { os.deleteRow(k + 2); removed++; }
    }
    return { ok: true, id: id, optionsRemoved: removed };
  });
}

/** POST {action:'trip_option_save', option} → creates or updates an option of an existing idea. */
function webSaveTripIdeaOption_(body) {
  var opt = tiCleanOption_(body && body.option);
  if (!opt.ideaId) return { ok: false, error: 'ideaId required' };
  if (!opt.name) return { ok: false, error: 'Give the option a name' };
  return tiLocked_(function() {
    if (tiRowOf_(tiIdeasSheet_(), TRIP_IDEAS_HEADERS.length, opt.ideaId) === -1) return { ok: false, error: 'That idea no longer exists' };
    var sheet = tiOptionsSheet_(), w = TRIP_IDEA_OPTIONS_HEADERS.length, now = tiNow_();
    var row = opt.id ? tiRowOf_(sheet, w, opt.id) : -1;
    if (opt.id && row === -1) return { ok: false, error: 'That option no longer exists' };
    if (row === -1) {
      opt.id = tiMintId_('OPT-');
      sheet.appendRow(tiOptionToRow_(opt, now, now));
      opt.created = now;
    } else {
      var created = String(sheet.getRange(row, 11).getValue() || now);
      sheet.getRange(row, 1, 1, w).setValues([tiOptionToRow_(opt, created, now)]);
      opt.created = created;
    }
    opt.updated = now;
    return { ok: true, option: opt };
  });
}

/** POST {action:'trip_option_delete', id}. */
function webDeleteTripIdeaOption_(body) {
  var id = tiStr_(body && body.id, 40);
  if (!id) return { ok: false, error: 'id required' };
  return tiLocked_(function() {
    var sheet = tiOptionsSheet_(), row = tiRowOf_(sheet, TRIP_IDEA_OPTIONS_HEADERS.length, id);
    if (row === -1) return { ok: false, error: 'That option no longer exists' };
    sheet.deleteRow(row);
    return { ok: true, id: id };
  });
}
