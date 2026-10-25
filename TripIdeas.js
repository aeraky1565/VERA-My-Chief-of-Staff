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
// An idea can also carry pieces: what is already known, as loosely as it is known.
// An anchor has to happen ("a Med cruise, ~7 nights"); an either/or is a choice
// for one slot ("Cruise A or Cruise B"); a wish is nice to have. Ask VERA
// (trip_idea_ask) builds options around them: one per choice, wishes fitted
// where they make sense, every leg VERA filled in marked as its own, and a
// verdict on each option. With no pieces it builds a few different shapes from
// the brief alone.
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
var TI_PIECE_KINDS_ = ['anchor', 'choice', 'wish'];
var TI_VERDICTS_  = ['fits', 'cost', 'awkward'];
var TI_ASK_MAX_   = 4;      // options VERA builds in one ask

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
 * Pure: an idea's pieces. {kind: anchor | choice | wish, group, name, detail}.
 * group names the slot an either/or fills ("Which cruise"); choices sharing a
 * group are the alternatives. A piece with no name is dropped.
 */
function tiCleanPieces_(pieces) {
  return (Array.isArray(pieces) ? pieces : []).map(function(p) {
    p = p || {};
    var name = tiStr_(p.name, 100);
    if (!name) return null;
    var kind = tiOneOf_(p.kind, TI_PIECE_KINDS_, 'wish');
    return { kind: kind, group: kind === 'choice' ? (tiStr_(p.group, 60) || 'Choice') : '', name: name, detail: tiStr_(p.detail, 240) };
  }).filter(Boolean).slice(0, 30);
}

/** Pure: combinations VERA saw but did not build: [{name, why}]. */
function tiCleanAlso_(list) {
  return (Array.isArray(list) ? list : []).map(function(a) {
    a = a || {}; var name = tiStr_(a.name, 100);
    return name ? { name: name, why: tiStr_(a.why, 300) } : null;
  }).filter(Boolean).slice(0, 4);
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
    pieces: tiCleanPieces_(raw.pieces),
    alsoPossible: tiCleanAlso_(raw.alsoPossible),
  };
}

/**
 * Pure: an option's legs, in travel order. Each is a stop {kind:'stop', place,
 * nights, note} or a move {kind:'move', mode, from, to, note}. A trip can mix
 * every mode (fly → drive → cruise → train → fly) or be one flight in and out;
 * the list is the trip, home to home is implied. Empty legs are dropped.
 * vera marks a leg VERA filled in; piece says which of the idea's pieces a leg
 * is (anchor / choice / wish), if any.
 */
function tiCleanLegs_(legs) {
  return (Array.isArray(legs) ? legs : []).map(function(l) {
    l = l || {};
    if (l.kind === 'stop') {
      var place = tiStr_(l.place, 80);
      return place ? { kind: 'stop', place: place, nights: tiInt_(l.nights, 0, 60) || 0, note: tiStr_(l.note, 120), vera: l.vera === true, piece: tiOneOf_(l.piece, TI_PIECE_KINDS_, '') } : null;
    }
    if (l.kind === 'move') {
      var from = tiStr_(l.from, 60), to = tiStr_(l.to, 60), note = tiStr_(l.note, 120);
      return { kind: 'move', mode: tiOneOf_(l.mode, TI_MODES_, 'other'), from: from, to: to, note: note, vera: l.vera === true, piece: tiOneOf_(l.piece, TI_PIECE_KINDS_, '') };
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
    verdict: tiCleanVerdict_(raw.verdict),
    wishes: tiCleanWishes_(raw.wishes),
  };
}

/** Pure: VERA's take on an option: {level: fits | cost | awkward, text}, or null. */
function tiCleanVerdict_(v) {
  if (!v || typeof v !== 'object') return null;
  var level = tiOneOf_(v.level, TI_VERDICTS_, ''), text = tiStr_(v.text, 400);
  return level && text ? { level: level, text: text } : null;
}

/** Pure: which wishes an option fits, and which it leaves out and why. */
function tiCleanWishes_(w) {
  w = w && typeof w === 'object' ? w : {};
  var fit = (Array.isArray(w.fit) ? w.fit : []).map(function(x) { return tiStr_(x, 80); }).filter(Boolean).slice(0, 10);
  var left = (Array.isArray(w.left) ? w.left : []).map(function(x) {
    x = x || {}; var name = tiStr_(x.name, 80);
    return name ? { name: name, why: tiStr_(x.why, 200) } : null;
  }).filter(Boolean).slice(0, 10);
  return { fit: fit, left: left };
}

// ---- pure: rows --------------------------------------------------------------

function tiParse_(s, fallback) { try { var v = JSON.parse(String(s || '')); return v == null ? fallback : v; } catch (e) { return fallback; } }

/** Pure: an idea ↔ its sheet row, in TRIP_IDEAS_HEADERS order. */
function tiIdeaToRow_(i, created, updated) {
  return [i.id, i.title, i.where, JSON.stringify(i.months), i.nightsMin == null ? '' : i.nightsMin, i.nightsMax == null ? '' : i.nightsMax,
    i.travelers, i.budget == null ? '' : i.budget, i.pace, JSON.stringify(i.openTo), i.mustHaves, i.status, i.chosenOption, i.tripId, created, updated,
    JSON.stringify(i.pieces || []), JSON.stringify(i.alsoPossible || [])];
}
function tiIdeaFromRow_(r) {
  var i = tiCleanIdea_({ id: r[0], title: r[1], where: r[2], months: tiParse_(r[3], []), nightsMin: r[4], nightsMax: r[5],
    travelers: r[6], budget: r[7], pace: r[8], openTo: tiParse_(r[9], []), mustHaves: r[10], status: r[11], chosenOption: r[12], tripId: r[13],
    pieces: tiParse_(r[16], []), alsoPossible: tiParse_(r[17], []) });
  i.created = String(r[14] || ''); i.updated = String(r[15] || '');
  return i;
}

/** Pure: an option ↔ its sheet row, in TRIP_IDEA_OPTIONS_HEADERS order. */
function tiOptionToRow_(o, created, updated) {
  return [o.id, o.ideaId, o.name, o.source, o.flag, JSON.stringify(o.legs), JSON.stringify(o.cost), o.pros.join('\n'), o.cons.join('\n'), o.order, created, updated,
    o.verdict ? JSON.stringify(o.verdict) : '', JSON.stringify(o.wishes || { fit: [], left: [] })];
}
function tiOptionFromRow_(r) {
  var o = tiCleanOption_({ id: r[0], ideaId: r[1], name: r[2], source: r[3], flag: r[4], legs: tiParse_(r[5], []), cost: tiParse_(r[6], {}),
    pros: r[7], cons: r[8], order: r[9], verdict: tiParse_(r[12], null), wishes: tiParse_(r[13], {}) });
  o.created = String(r[10] || ''); o.updated = String(r[11] || '');
  return o;
}

// ---- the sheets ----------------------------------------------------------------

/** The two tabs, created on demand (createSheetTabs only runs from setupVERA). */
function tiIdeasSheet_()   { return tiSchema_(ensureSheet(getSpreadsheet(), TABS.TRIP_IDEAS, TRIP_IDEAS_HEADERS), TRIP_IDEAS_HEADERS); }
function tiOptionsSheet_() { return tiSchema_(ensureSheet(getSpreadsheet(), TABS.TRIP_IDEA_OPTIONS, TRIP_IDEA_OPTIONS_HEADERS), TRIP_IDEA_OPTIONS_HEADERS); }

/** A tab made before a column was added gets the new headers (ensureSheet only writes them on a blank tab). */
function tiSchema_(sheet, headers) {
  if (!sheet) return sheet;
  var have = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(have[i] == null ? '' : have[i]).trim() !== headers[i]) { sheet.getRange(1, 1, 1, headers.length).setValues([headers]); break; }
  }
  return sheet;
}

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

// ---- Ask VERA ------------------------------------------------------------------

/** Pure: "Mar–May 2027" style, for the prompt. */
function tiMonthsWords_(months) {
  var N = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (months || []).length ? months.map(function(m) { return N[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4); }).join(', ') : 'any time (not decided)';
}

/**
 * Pure: the prompt for Ask VERA. With pieces, VERA builds around the anchors,
 * one option per either/or choice (or the best combinations of several groups),
 * fitting wishes where they make sense; without, a few deliberately different
 * shapes from the brief. focus asks for one specific combination. Existing
 * option names are listed so VERA does not repeat them. Facts VERA can measure
 * (PTO, weather) are not asked for.
 */
function tiAskPrompt_(idea, existing, home, focus) {
  var pieces = idea.pieces || [];
  var anchors = pieces.filter(function(p) { return p.kind === 'anchor'; });
  var wishes = pieces.filter(function(p) { return p.kind === 'wish'; });
  var groups = {};
  pieces.filter(function(p) { return p.kind === 'choice'; }).forEach(function(p) { (groups[p.group] = groups[p.group] || []).push(p); });
  var line = function(p) { return '- ' + p.name + (p.detail ? ' (' + p.detail + ')' : ''); };
  var out = [
    'You help plan a trip that has no dates yet. Build concrete options as routes from home and back.',
    '',
    'THE BRIEF',
    'Trip: ' + (idea.title || 'untitled'),
    'Home: ' + (home || 'Washington, DC area (fly from IAD)'),
    'Where, roughly: ' + (idea.where || 'open'),
    'When: ' + tiMonthsWords_(idea.months),
    'Length: ' + (idea.nightsMin != null || idea.nightsMax != null ? (idea.nightsMin || idea.nightsMax) + '–' + (idea.nightsMax || idea.nightsMin) + ' nights' : 'open'),
    'Travelers: ' + (idea.travelers || '2 adults'),
    'Budget for the whole trip: ' + (idea.budget != null ? '$' + idea.budget : 'not set'),
    'Pace: ' + (idea.pace || 'balanced'),
    'Open to: ' + ((idea.openTo || []).join(', ') || 'anything'),
    'Must-haves and things to avoid: ' + (idea.mustHaves || 'none given'),
    ''];
  if (pieces.length) {
    out.push('THEIR PIECES');
    if (anchors.length) { out.push('Anchors (must be in every option):'); anchors.forEach(function(p) { out.push(line(p)); }); }
    Object.keys(groups).forEach(function(g) { out.push('Either/or "' + g + '" (exactly one per option; build one option per choice):'); groups[g].forEach(function(p) { out.push(line(p)); }); });
    if (wishes.length) { out.push('Wishes (fit them where they make sense; say which you left out and why):'); wishes.forEach(function(p) { out.push(line(p)); }); }
    out.push('', 'Build around the anchors. With more than one either/or group, build the most sensible combinations, at most ' + TI_ASK_MAX_ + ', and list the other combinations under alsoPossible with one line on why you did not build them.');
  } else {
    out.push('They have no pieces yet. Build 3 options that differ on purpose: different lengths inside the range, and different ways to travel (stay put, trains, a cruise, a road trip), within what they are open to.');
  }
  if (focus) out.push('', 'Build exactly ONE option now: ' + focus);
  if ((existing || []).length) out.push('', 'Options they already have (do not repeat them): ' + existing.map(function(o) { return o.name; }).join('; '));
  out.push('',
    'RULES',
    '- Every route starts with a move from Home and ends with a move back to Home. Stops have whole nights; the stops\' nights add up inside the length.',
    '- Legs from their pieces: piece = "anchor", "choice" or "wish" and vera = false. Legs you added to join things up (flights, transfers, stays between pieces): vera = true.',
    '- Joins must make geographic sense; prefer trains over flights in between; avoid backtracking and one-way car fees unless worth it, and say so.',
    '- Do not invent specific sailings, flight numbers, prices you cannot know, or dates. Name ports and cities.',
    '- Cost: a rough range in USD for all travelers together, per category; basis "VERA estimate". Leave out a category that does not apply.',
    '- verdict.level: "fits" (works well), "cost" (works, with a real cost or trade-off) or "awkward" (an awkward join). verdict.text: one or two plain sentences on why.',
    '',
    'Return ONLY JSON, no prose:',
    '{"options":[{"name":"14 nights: Swiss train → Med cruise",',
    '  "legs":[{"kind":"move","mode":"fly|train|car|ship|ferry|bus|other","from":"Home","to":"ZRH","note":"","vera":true,"piece":""},',
    '          {"kind":"stop","place":"Zermatt","nights":2,"note":"","vera":true,"piece":""}],',
    '  "cost":{"flights":{"low":0,"high":0,"basis":"VERA estimate"},"stays":{...},"cruise":{...},"ground":{...},"daily":{...}},',
    '  "pros":["…"],"cons":["…"],',
    '  "verdict":{"level":"fits|cost|awkward","text":"…"},',
    '  "wishes":{"fit":["Lake Como"],"left":[{"name":"Beach days","why":"…"}]}}],',
    ' "alsoPossible":[{"name":"Road trip → Cruise A","why":"…"}]}');
  return out.join('\n');
}

/** Pure: VERA's answer → clean options (source vera) and what it saw but did not build. */
function tiAskResult_(raw, ideaId) {
  var res = raw && typeof raw === 'object' ? raw : {};
  var options = (Array.isArray(res.options) ? res.options : []).map(function(o) {
    var c = tiCleanOption_(Object.assign({}, o, { id: '', ideaId: ideaId, source: 'vera', flag: '' }));
    return c.name && c.legs.length ? c : null;
  }).filter(Boolean).slice(0, TI_ASK_MAX_);
  return { options: options, alsoPossible: tiCleanAlso_(res.alsoPossible) };
}

/** The idea with this id, or null. */
function tiGetIdea_(id) {
  var rows = tiRows_(tiIdeasSheet_(), TRIP_IDEAS_HEADERS.length);
  for (var k = 0; k < rows.length; k++) if (String(rows[k][0]).trim() === id) return tiIdeaFromRow_(rows[k]);
  return null;
}

/**
 * POST {action:'trip_idea_ask', ideaId, focus?} → VERA builds options for an
 * idea and they are saved (source vera). The model call runs outside the lock;
 * the writes inside it. alsoPossible replaces the idea's previous list, unless
 * this was a focused ask for one of them, which is taken off the list.
 *
 * askId makes it safe to repeat: the dashboard retries a POST whose connection
 * dropped, and a long model call is exactly what drops one. A repeat of an ask
 * already running waits for it and returns its result instead of building (and
 * saving) a second set.
 */
function webAskVeraTripIdea_(body) {
  var askId = tiStr_(body && body.askId, 40);
  if (!askId) return tiAsk_(body);
  var cache = CacheService.getScriptCache(), key = 'ti_ask_' + askId.replace(/[^A-Za-z0-9_-]/g, '');
  var seen = cache.get(key);
  for (var waited = 0; seen === 'running' && waited < 100; waited++) { Utilities.sleep(3000); seen = cache.get(key); }
  if (seen === 'running') return { ok: false, error: 'VERA is still building these options. Reload in a minute.' };
  if (seen) { try { return JSON.parse(seen); } catch (e) {} }
  cache.put(key, 'running', 600);
  var result;
  try { result = tiAsk_(body); }
  catch (err) { cache.remove(key); throw err; }
  try { cache.put(key, JSON.stringify(result), 600); } catch (e) { cache.remove(key); }
  return result;
}

function tiAsk_(body) {
  var id = tiStr_(body && body.ideaId, 40), focus = tiStr_(body && body.focus, 200);
  if (!id) return { ok: false, error: 'ideaId required' };
  var idea = tiGetIdea_(id);
  if (!idea) return { ok: false, error: 'That idea no longer exists' };
  var existing = tiRows_(tiOptionsSheet_(), TRIP_IDEA_OPTIONS_HEADERS.length)
    .filter(function(r) { return String(r[1]).trim() === id; }).map(tiOptionFromRow_);
  var home = String(getConfigValues()['weather_location'] || '').trim();
  var raw = callClaudeJson_(tiAskPrompt_(idea, existing, home, focus), null, { maxTokens: 6000 });
  var got = tiAskResult_(raw, id);
  Logger.log('trip_idea_ask: ' + got.options.length + ' options, ' + got.alsoPossible.length + ' also possible');
  if (!got.options.length) return { ok: false, error: 'VERA could not build options just now. Try again in a minute.' };
  return tiLocked_(function() {
    var sheet = tiOptionsSheet_(), now = tiNow_(), order = existing.length;
    var saved = got.options.map(function(o) {
      o.id = tiMintId_('OPT-'); o.order = ++order;
      sheet.appendRow(tiOptionToRow_(o, now, now));
      o.created = now; o.updated = now;
      return o;
    });
    var also = focus ? (idea.alsoPossible || []).filter(function(a) { return a.name !== focus; }) : got.alsoPossible;
    idea.alsoPossible = also;
    var is = tiIdeasSheet_(), row = tiRowOf_(is, TRIP_IDEAS_HEADERS.length, id);
    if (row !== -1) {
      var created = String(is.getRange(row, 15).getValue() || now);
      is.getRange(row, 1, 1, TRIP_IDEAS_HEADERS.length).setValues([tiIdeaToRow_(idea, created, now)]);
      idea.created = created; idea.updated = now;
    }
    return { ok: true, options: saved, idea: idea };
  });
}

// ---- The deciders: PTO windows and typical weather ----------------------------
//
// GET trip_idea_decide answers the two questions a dateless option leaves open,
// from what VERA can measure rather than what a model would guess:
//   when:    the cheapest windows in PTO for each length, for both of you, with
//            the holidays they bridge, what each would have left, and any trip
//            already on the calendars that they would clash with;
//   weather: each stop's typical high, low and rainy days per month, from ten
//            years of measured daily weather (Open-Meteo's archive).
// The budget answer (within / over WILLA's number) is the dashboard's own.

var TI_DECIDE_MAX_LENGTHS_ = 4;
var TI_DECIDE_MAX_STOPS_   = 8;
var TI_DECIDE_WINDOWS_     = 3;
var TI_CLIMATE_FROM_ = '2015-01-01', TI_CLIMATE_TO_ = '2024-12-31';   // ten full years
var TI_CLIMATE_KEEP_DAYS_  = 180;

/** Pure: 'yyyy-MM-dd' ↔ a day number (days since 1970-01-01, UTC, so no clock shifts). */
function tiDay_(ymd) { var p = String(ymd).split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 864e5); }
function tiYmd_(day) { return new Date(day * 864e5).toISOString().slice(0, 10); }

/**
 * Pure: the PTO one person spends on a trip leaving on `start` and home `nights`
 * later: every weekday from the day you leave to the day you are back, less the
 * holidays on their work calendar ({ymd: label}), which the trip bridges.
 */
function tiPtoCost_(start, nights, holidays) {
  var d0 = tiDay_(start), days = 0, bridged = [];
  for (var d = d0; d <= d0 + nights; d++) {
    var dow = (d + 4) % 7;   // 1970-01-01 was a Thursday
    if (dow === 0 || dow === 6) continue;
    var ymd = tiYmd_(d);
    if (holidays && holidays[ymd]) bridged.push(holidays[ymd]); else days++;
  }
  return { days: days, bridged: bridged };
}

/**
 * Pure: the cheapest windows for one length.
 * o = {months: ['yyyy-MM'] (none = the next year), nights, today: 'yyyy-MM-dd',
 *      people: [{name, holidays: {ymd: label}, remaining: {yyyy: days}}],
 *      busy: [{label, start, end}], max}
 * Every departure day from tomorrow on, inside the months, is costed. The best
 * clear no clash, then cost the most-spending person least, then cost the two of
 * you least, then come soonest; the picks never overlap one another.
 */
function tiPtoWindows_(o) {
  var nights = Math.max(1, Math.min(60, Number(o.nights) || 7)), today = tiDay_(o.today);
  var months = (o.months || []).filter(function(m) { return /^\d{4}-\d{2}$/.test(m); });
  var people = (o.people || []).length ? o.people : [{ name: '', holidays: {}, remaining: {} }];
  var cands = [];
  for (var d = today + 1; d <= today + 366; d++) {
    var start = tiYmd_(d);
    if (months.length && months.indexOf(start.slice(0, 7)) === -1) continue;
    var end = tiYmd_(d + nights), seen = {}, holidays = [];
    var cost = people.map(function(p) {
      var c = tiPtoCost_(start, nights, p.holidays);
      c.bridged.forEach(function(h) { if (!seen[h]) { seen[h] = 1; holidays.push(h); } });
      var left = p.remaining && p.remaining[start.slice(0, 4)];
      return { name: p.name, days: c.days, left: left == null ? null : left - c.days };
    });
    var clash = (o.busy || []).filter(function(b) { return b.start <= end && b.end >= start; })[0];
    cands.push({ start: start, end: end, nights: nights, day: d, people: cost, holidays: holidays, clash: clash ? clash.label : '',
      most: Math.max.apply(null, cost.map(function(c) { return c.days; })), sum: cost.reduce(function(n, c) { return n + c.days; }, 0) });
  }
  cands.sort(function(a, b) { return (a.clash ? 1 : 0) - (b.clash ? 1 : 0) || a.most - b.most || a.sum - b.sum || a.day - b.day; });
  var picks = [];
  for (var k = 0; k < cands.length && picks.length < (o.max || TI_DECIDE_WINDOWS_); k++) {
    var c = cands[k];
    if (picks.some(function(p) { return c.day <= p.day + nights && p.day <= c.day + nights; })) continue;
    delete c.most; delete c.sum; picks.push(c);
  }
  picks.forEach(function(p) { delete p.day; });
  return { windows: picks, considered: cands.length };
}

/**
 * Pure: Open-Meteo's daily history → twelve monthly normals, January first:
 * {hi, lo} (°F, the average daily high and low) and wet (the rainy days, 1 mm or
 * more, in a typical month), or null for a month with no data.
 */
function tiClimateNormals_(daily) {
  daily = daily || {};
  var t = daily.time || [], hi = daily.temperature_2m_max || [], lo = daily.temperature_2m_min || [], pr = daily.precipitation_sum || [];
  var acc = []; for (var m = 0; m < 12; m++) acc.push({ hi: 0, nh: 0, lo: 0, nl: 0, wet: 0, np: 0 });
  for (var i = 0; i < t.length; i++) {
    var a = acc[Number(String(t[i]).slice(5, 7)) - 1]; if (!a) continue;
    if (hi[i] != null) { a.hi += hi[i]; a.nh++; }
    if (lo[i] != null) { a.lo += lo[i]; a.nl++; }
    if (pr[i] != null) { a.np++; if (pr[i] >= 1) a.wet++; }
  }
  var LEN = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return acc.map(function(a, m) {
    if (!a.nh || !a.nl) return null;
    return { hi: Math.round(a.hi / a.nh), lo: Math.round(a.lo / a.nl), wet: a.np ? Math.round(a.wet / a.np * LEN[m]) : null };
  });
}

/** Pure: the stops of an option worth looking up, once each, in route order. */
function tiOptionStops_(option) {
  var seen = {}, out = [];
  ((option && option.legs) || []).forEach(function(l) {
    if (!l || l.kind !== 'stop') return;
    var place = tiStr_(l.place, 120), key = place.toLowerCase();
    if (!place || seen[key] || TI_NOT_A_STOP_.test(place)) return;
    seen[key] = 1; out.push(place);
  });
  return out.slice(0, TI_DECIDE_MAX_STOPS_);
}
// A cruise or a day at sea is a stop on the route but not a place with weather.
var TI_NOT_A_STOP_ = /\b(at sea|sea days?|cruise|on ?board|aboard)\b/i;

/** Pure: the lengths asked for: whole nights 1–60, once each, at most four. */
function tiDecideLengths_(raw) {
  var out = [];
  String(raw == null ? '' : raw).split(',').forEach(function(s) {
    var n = Number(String(s).trim());
    if (String(s).trim() && n === Math.floor(n) && n >= 1 && n <= 60 && out.indexOf(n) === -1) out.push(n);
  });
  return out.slice(0, TI_DECIDE_MAX_LENGTHS_);
}

/** One person's holidays and PTO left, per year, from their work calendar (cached for 6 hours). */
function tiPtoPerson_(name, readCfg, years) {
  var out = { name: name, holidays: {}, remaining: {}, holidayYears: [], found: true };
  var cfg;
  try { cfg = readCfg(); } catch (e) { out.found = false; return out; }
  // No work calendar to read means no holidays and no balance: say so, rather than
  // show a full year's allowance that nobody checked.
  try { if (!getCalendarByName_(cfg.calendarName)) { out.found = false; return out; } } catch (e) { out.found = false; return out; }
  var cache = CacheService.getScriptCache();
  years.forEach(function(y) {
    var key = 'ti_pto_' + name.toLowerCase().replace(/[^a-z]/g, '') + '_' + y, got = null;
    try { got = JSON.parse(cache.get(key) || 'null'); } catch (e) {}
    if (!got) {
      try {
        var c = Object.assign({}, cfg, { year: y }), res = getPTOEvents_(c), h = {};
        (res.holidays || []).forEach(function(x) { h[x.date] = x.label; });
        got = { h: h, rem: computePTOStats_(res, c, new Date()).remaining.vacationDays };
        cache.put(key, JSON.stringify(got), 21600);
      } catch (e) { Logger.log('trip_idea_decide: PTO for one person, one year, unavailable'); return; }
    }
    Object.keys(got.h).forEach(function(d) { out.holidays[d] = got.h[d]; });
    if (Object.keys(got.h).length) out.holidayYears.push(y);
    out.remaining[y] = got.rem;
  });
  return out;
}

/** A place's monthly normals, kept in script properties for half a year: they barely move. */
function tiClimate_(place) {
  var g = null;
  try { g = geocodePackingDestination_(place); } catch (e) {}
  if (!g || g.lat == null || !tripPlaceMatches_(place, g.name)) return { place: place, found: false };
  var key = 'TI_CLIMATE_' + Number(g.lat).toFixed(1) + '_' + Number(g.lon).toFixed(1);
  var props = PropertiesService.getScriptProperties(), kept = null;
  try { kept = JSON.parse(props.getProperty(key) || 'null'); } catch (e) {}
  var fresh = kept && kept.at && (Date.now() - new Date(kept.at).getTime()) < TI_CLIMATE_KEEP_DAYS_ * 864e5;
  if (!fresh) {
    var resp = fetchWithHealth_('open-meteo', 'https://archive-api.open-meteo.com/v1/archive?latitude=' + g.lat + '&longitude=' + g.lon +
      '&start_date=' + TI_CLIMATE_FROM_ + '&end_date=' + TI_CLIMATE_TO_ + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit');
    var normals = null;
    if (resp) { try { normals = tiClimateNormals_(JSON.parse(resp.getContentText()).daily); } catch (e) {} }
    if (!normals || !normals.some(Boolean)) return kept ? { place: place, name: g.name, found: true, normals: kept.m } : { place: place, name: g.name, found: false };
    kept = { at: new Date().toISOString(), m: normals };
    try { props.setProperty(key, JSON.stringify(kept)); } catch (e) {}
  }
  return { place: place, name: g.name, country: g.country || '', found: true, normals: kept.m };
}

/**
 * GET trip_idea_decide?ideaId&optionId&nights=10,14 → for one option:
 * {ok, today, people: [{name, remaining, holidayYears, found}],
 *  lengths: [{nights, windows, considered}], stops: [{place, name, found, normals}]}
 */
function webTripIdeaDecide_(p) {
  p = p || {};
  var id = tiStr_(p.ideaId, 40), optId = tiStr_(p.optionId, 40);
  if (!id || !optId) return { ok: false, error: 'ideaId and optionId required' };
  var idea = tiGetIdea_(id);
  if (!idea) return { ok: false, error: 'That idea no longer exists' };
  var option = tiRows_(tiOptionsSheet_(), TRIP_IDEA_OPTIONS_HEADERS.length).map(tiOptionFromRow_).filter(function(o) { return o.id === optId && o.ideaId === id; })[0];
  if (!option) return { ok: false, error: 'That option no longer exists' };
  var lengths = tiDecideLengths_(p.nights);
  if (!lengths.length) lengths = [tiInt_(tiOptionNights_(option), 1, 60) || idea.nightsMin || 7];
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var ty = Number(today.slice(0, 4)), years = [ty, ty + 1];
  var people = [tiPtoPerson_('Ahmed', readPTOConfig_, years), tiPtoPerson_('Victoria', readVictoriaPTOConfig_, years)];
  var busy = [];
  try { busy = (getUpcomingTravel_(readPTOConfig_()) || []).map(function(t) { return { label: t.label, start: t.startDate, end: t.endDate }; }); }
  catch (e) { Logger.log('trip_idea_decide: upcoming trips unavailable'); }
  var out = lengths.map(function(n) {
    var w = tiPtoWindows_({ months: idea.months, nights: n, today: today, people: people, busy: busy });
    return { nights: n, windows: w.windows, considered: w.considered };
  });
  var stops = tiOptionStops_(option).map(tiClimate_);
  Logger.log('trip_idea_decide: ' + out.length + ' lengths, ' + stops.length + ' stops, ' + busy.length + ' trips on the calendars');
  return { ok: true, today: today, months: idea.months,
    people: people.map(function(x) { return { name: x.name, remaining: x.remaining, holidayYears: x.holidayYears, found: x.found }; }),
    lengths: out, stops: stops };
}

/** Pure: the nights an option's stops add up to. */
function tiOptionNights_(option) {
  return ((option && option.legs) || []).reduce(function(n, l) { return n + (l && l.kind === 'stop' ? Number(l.nights) || 0 : 0); }, 0);
}
