/**
 * Life.js — the Life tab (issue #222): Explore's server side.
 *
 * Explore
 *   Places · Trip lessons · Things we love — three views over the Shared Interests
 *     sheet (Interests.js). A row's view is its Tag column when set, otherwise it is
 *     worked out: a Chat entry logged within four days after a trip ended (the
 *     post-trip debrief) or a "skip: …" entry is a lesson from that trip; Travel and
 *     Food are places; everything else is a thing we love. Duplicates (same words,
 *     same person) show once.
 *   Ideas — the Ideas sheet; an idea can become a goal or a project, or be shelved.
 *   Giving — donations and volunteering, with yearly totals; donations with a
 *     receipt are offered to Finances › Tax.
 *   Weekend wishes — "Add to a weekend" keeps a short list the Weekend Planner reads.
 *
 * The Wish List (someday purchases) moves once into Planned Purchases at stage "idea".
 */

var LF_GIVING_TAB_ = 'Giving';
var LF_GIVING_HEADERS_ = ['ID', 'Date', 'Kind', 'Organisation', 'Amount', 'Hours', 'Receipt', 'Notes'];
var LF_GIVING_KINDS_ = ['donation', 'volunteering'];
var LF_TAGS_ = ['place', 'lesson', 'thing'];
var LF_LESSON_WINDOW_DAYS_ = 4;     // the debrief window PostTripCapture.js reads
var LF_WISHES_PROP_ = 'LF_WEEKEND_WISHES';
var LF_WISH_MIGRATED_PROP_ = 'LF_WISH_LIST_MIGRATED';
var LF_PLACE_STOP_ = ['trip', 'the', 'and', 'our', 'a', 'to', 'in', 'of', 'weekend', 'getaway', 'vacation', 'holiday', 'visit', 'skip', 'back', 'for', 'with', 'at', 'on'];

// ---- pure: words ------------------------------------------------------------------

function lfStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 400); }
function lfNorm_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function lfYmd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  var t = String(v == null ? '' : v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
}
function lfDays_(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
/** Pure: the words in a place or trip name worth matching on (no "trip", no years). */
function lfPlaceWords_(s) {
  return lfNorm_(s).split(' ').filter(function(w) { return w.length > 2 && !/^\d+$/.test(w) && LF_PLACE_STOP_.indexOf(w) === -1; });
}

// ---- pure: interests ---------------------------------------------------------------

/** Pure: the trip a debrief entry came from — logged by Chat within the window after the trip ended. */
function lfTripFor_(it, trips) {
  if (!it || it.source !== 'Chat' || !it.date) return null;
  var hit = null;
  (trips || []).forEach(function(t) {
    if (!t || !t.endDate) return;
    var d = lfDays_(t.endDate, it.date);
    if (d >= 0 && d <= LF_LESSON_WINDOW_DAYS_ && (!hit || t.endDate > hit.endDate)) hit = t;
  });
  return hit ? hit.label : null;
}

/** Pure: which view an interest belongs in. */
function lfKind_(it, tagRec, trip) {
  var tag = tagRec && LF_TAGS_.indexOf(tagRec.tag) !== -1 ? tagRec.tag : '';
  if (tag) return tag;
  if (trip || /^\s*skip\b/i.test(it.interest || '') || /\blesson\b/i.test(it.notes || '')) return 'lesson';
  if (it.category === 'Travel' || it.category === 'Food') return 'place';
  return 'thing';
}

/**
 * Pure: the three views, duplicates merged (same words, same person), newest first.
 * @param {Array} interests  getSharedInterestLedger_() rows
 * @param {Object} tags      id -> { tag, trip }
 * @param {Array} trips      [{ label, endDate }]
 */
function lfInterestViews_(interests, tags, trips) {
  var groups = { place: {}, lesson: {}, thing: {} }, order = { place: [], lesson: [], thing: [] };
  (interests || []).forEach(function(it) {
    var rec = (tags || {})[it.id] || null;
    var trip = (rec && rec.trip) || lfTripFor_(it, trips);
    var kind = lfKind_(it, rec, trip);
    var key = lfNorm_(it.interest) + '|' + it.person;
    var g = groups[kind][key];
    if (!g) {
      g = groups[kind][key] = { id: it.id, ids: [], text: it.interest, person: it.person, category: it.category, notes: it.notes,
        firstDate: it.date, lastDate: it.date, count: 0, trip: kind === 'lesson' ? (trip || '') : '', kind: kind };
      order[kind].push(key);
    }
    g.ids.push(it.id); g.count++;
    if (it.date && (!g.firstDate || it.date < g.firstDate)) g.firstDate = it.date;
    if (it.date && it.date > g.lastDate) { g.lastDate = it.date; g.text = it.interest; g.id = it.id; }
    if (!g.notes && it.notes) g.notes = it.notes;
    if (!g.trip && kind === 'lesson' && trip) g.trip = trip;
  });
  function list(kind) {
    return order[kind].map(function(k) { return groups[kind][k]; })
      .sort(function(a, b) { return a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0; });
  }
  var lessons = list('lesson'), byTrip = {}, tripOrder = [];
  lessons.forEach(function(l) {
    var t = l.trip || 'Other lessons';
    if (!byTrip[t]) { byTrip[t] = []; tripOrder.push(t); }
    byTrip[t].push(l);
  });
  return { places: list('place'), things: list('thing'), lessons: lessons,
    lessonsByTrip: tripOrder.map(function(t) { return { trip: t, items: byTrip[t] }; }) };
}

/** Pure: lessons that belong to a trip or place — they share a place word with its name. */
function lfLessonsFor_(name, lessons) {
  var want = lfPlaceWords_(name);
  if (!want.length) return [];
  return (lessons || []).filter(function(l) {
    var have = lfPlaceWords_((l.trip || '') + ' ' + l.text);
    return want.some(function(w) { return have.indexOf(w) !== -1; });
  }).map(function(l) { return { text: l.text, person: l.person, trip: l.trip }; });
}

// ---- pure: giving -------------------------------------------------------------------

function lfGivingClean_(raw) {
  raw = raw || {};
  var kind = String(raw.kind || '').toLowerCase();
  kind = LF_GIVING_KINDS_.indexOf(kind) !== -1 ? kind : 'donation';
  var amt = raw.amount === '' || raw.amount == null ? null : Number(String(raw.amount).replace(/[^0-9.]/g, ''));
  var hrs = raw.hours === '' || raw.hours == null ? null : Number(String(raw.hours).replace(/[^0-9.]/g, ''));
  var receipt = lfStr_(raw.receipt, 400);
  return { id: lfStr_(raw.id, 40), date: lfYmd_(raw.date), kind: kind, organisation: lfStr_(raw.organisation, 120),
    amount: isFinite(amt) && amt != null && amt >= 0 ? Math.round(amt * 100) / 100 : null,
    hours: isFinite(hrs) && hrs != null && hrs >= 0 ? Math.round(hrs * 10) / 10 : null,
    receipt: receipt, notes: lfStr_(raw.notes, 400) };
}

/** Pure: per year, newest first — money given, hours given, and the donations with a receipt. */
function lfGivingTotals_(rows) {
  var by = {};
  (rows || []).forEach(function(r) {
    var y = (r.date || '').slice(0, 4);
    if (!y) return;
    var t = by[y] = by[y] || { year: Number(y), donated: 0, hours: 0, donations: 0, volunteering: 0, withReceipt: 0, receiptTotal: 0 };
    if (r.kind === 'donation') {
      t.donations++; t.donated += r.amount || 0;
      if (r.receipt) { t.withReceipt++; t.receiptTotal += r.amount || 0; }
    } else { t.volunteering++; t.hours += r.hours || 0; }
  });
  return Object.keys(by).sort().reverse().map(function(y) {
    var t = by[y];
    t.donated = Math.round(t.donated * 100) / 100; t.receiptTotal = Math.round(t.receiptTotal * 100) / 100; t.hours = Math.round(t.hours * 10) / 10;
    return t;
  });
}

/** Pure: what Tax is offered for a tax year — donations with a receipt that year. */
function lfTaxGiving_(rows, year) {
  var y = String(year), list = (rows || []).filter(function(r) { return r.kind === 'donation' && r.receipt && (r.date || '').slice(0, 4) === y; })
    .sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  var total = 0; list.forEach(function(r) { total += r.amount || 0; });
  return { year: Number(y), count: list.length, total: Math.round(total * 100) / 100, items: list };
}

// ---- pure: wish list move ------------------------------------------------------------

/** Pure: a Wish List row as a Planned Purchase at stage "idea" (bought ones are left where they are). */
function lfWishToPurchase_(w) {
  if (!w || !w.item || /^purchased$/i.test(w.status || '')) return null;
  var notes = [];
  if (w.description) notes.push({ date: w.dateAdded || '', text: w.description, link: '' });
  String(w.urls || '').split(/[\s,]+/).filter(function(u) { return /^https?:\/\//i.test(u); }).slice(0, 5)
    .forEach(function(u) { notes.push({ date: w.dateAdded || '', text: 'Link from the Wish List', link: u }); });
  if (w.notes) notes.push({ date: w.dateAdded || '', text: w.notes, link: '' });
  var forWho = w.person === 'Ahmed' || w.person === 'Victoria' ? w.person : 'Shared';
  return { item: w.item, forWho: forWho, why: w.category ? 'Wish List · ' + w.category : 'Wish List', budget: w.price, stage: 'idea', notes: notes };
}

// ---- sheet helpers ---------------------------------------------------------------------

function lfLocked_(fn) { var l = LockService.getScriptLock(); l.waitLock(10000); try { return fn(); } finally { l.releaseLock(); } }
function lfMint_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').substring(0, 10).toUpperCase(); }
function lfToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
/** The 1-based column of a header, added at the end when asked and missing. */
function lfCol_(sheet, header, add) {
  var w = Math.max(1, sheet.getLastColumn());
  var hdr = sheet.getRange(1, 1, 1, w).getValues()[0].map(function(h) { return String(h || '').trim().toLowerCase(); });
  var i = hdr.indexOf(String(header).toLowerCase());
  if (i !== -1) return i + 1;
  if (!add) return 0;
  sheet.getRange(1, w + 1).setValue(header);
  return w + 1;
}
function lfGivingSheet_() { return ensureSheet(getSpreadsheet(), LF_GIVING_TAB_, LF_GIVING_HEADERS_); }
function lfGivingRows_() {
  var sh = lfGivingSheet_(), w = LF_GIVING_HEADERS_.length;
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues().filter(function(r) { return String(r[0]).trim(); }).map(function(r, i) {
    var g = lfGivingClean_({ id: r[0], date: r[1], kind: r[2], organisation: r[3], amount: r[4], hours: r[5], receipt: r[6], notes: r[7] });
    return g;
  });
}
function lfGivingRowOf_(sh, id) {
  if (sh.getLastRow() < 2) return -1;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return -1;
}

/** id -> { tag, trip } from the Shared Interests sheet's optional Tag and Trip columns. */
function lfInterestTags_() {
  var sh = getSpreadsheet().getSheetByName(TABS.INTEREST_LEDGER), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var tc = lfCol_(sh, 'Tag', false), pc = lfCol_(sh, 'Trip', false);
  if (!tc && !pc) return out;
  var w = Math.max(tc, pc), rows = sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues();
  rows.forEach(function(r) {
    var id = String(r[0] || '').trim();
    if (!id) return;
    var tag = tc ? String(r[tc - 1] || '').trim().toLowerCase() : '', trip = pc ? String(r[pc - 1] || '').trim() : '';
    if (tag || trip) out[id] = { tag: tag, trip: trip };
  });
  return out;
}
/** Past and current trips with their end dates (the Trips registry). */
function lfTrips_() {
  try { return readTripRegistry_().rows.filter(function(t) { return t.endDate; }).map(function(t) { return { label: t.label, endDate: t.endDate }; }); }
  catch (e) { return []; }
}
function lfViews_() { return lfInterestViews_(getSharedInterestLedger_(), lfInterestTags_(), lfTrips_()); }

// ---- routes: Explore -------------------------------------------------------------------

/** GET life_interests → places, lessons by trip, things we love. */
function webLifeInterests_() {
  var v = lfViews_();
  // Each lesson carries its place words, so a trip card can find its own with the same stop list.
  v.lessons.forEach(function(l) { l.words = lfPlaceWords_((l.trip || '') + ' ' + l.text); });
  return { ok: true, places: v.places, things: v.things, lessonsByTrip: v.lessonsByTrip, lessons: v.lessons, stop: LF_PLACE_STOP_ };
}

/** POST life_interest_tag { id, tag, trip } → moves an interest to another view (and every duplicate of it). */
function webLifeInterestTag_(body) {
  var id = lfStr_(body && body.id, 40), tag = String((body && body.tag) || '').toLowerCase();
  if (!id) return { ok: false, error: 'Which one?' };
  if (LF_TAGS_.indexOf(tag) === -1) return { ok: false, error: 'Choose Places, Trip lessons or Things we love' };
  var ids = Array.isArray(body.ids) && body.ids.length ? body.ids.map(function(x) { return lfStr_(x, 40); }) : [id];
  return lfLocked_(function() {
    var sh = getSpreadsheet().getSheetByName(TABS.INTEREST_LEDGER);
    if (!sh || sh.getLastRow() < 2) return { ok: false, error: 'No interests yet' };
    var tc = lfCol_(sh, 'Tag', true), pc = lfCol_(sh, 'Trip', true), all = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues(), n = 0;
    all.forEach(function(r, i) {
      if (ids.indexOf(String(r[0]).trim()) === -1) return;
      sh.getRange(i + 2, tc).setValue(tag);
      if (body.trip !== undefined) sh.getRange(i + 2, pc).setValue(tag === 'lesson' ? lfStr_(body.trip, 80) : '');
      n++;
    });
    return n ? { ok: true, moved: n } : { ok: false, error: 'That interest is gone' };
  });
}

/** POST life_place_to_trip_idea { id } → a Trip Ideas brief for the place. */
function webLifePlaceToTripIdea_(body) {
  var id = lfStr_(body && body.id, 40), it = getSharedInterestLedger_().filter(function(x) { return x.id === id; })[0];
  if (!it) return { ok: false, error: 'That place is gone' };
  var res = webSaveTripIdea_({ idea: { title: lfStr_(it.interest, 80), where: lfStr_(it.interest, 160), status: 'brainstorming',
    mustHaves: it.notes ? 'From Life › Places: ' + it.notes : 'From Life › Places' } });
  return res.ok ? { ok: true, ideaId: res.idea.id, title: res.idea.title } : res;
}

/** The weekend wish list, oldest first. */
function lfWishes_() {
  try { var v = JSON.parse(PropertiesService.getScriptProperties().getProperty(LF_WISHES_PROP_) || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function lfSaveWishes_(list) { PropertiesService.getScriptProperties().setProperty(LF_WISHES_PROP_, JSON.stringify(list.slice(-20))); }
/** Pure: a wish added once — the same words aren't added twice. */
function lfAddWish_(list, text, today) {
  var t = lfStr_(text, 160);
  if (!t) return list;
  if (list.some(function(w) { return lfNorm_(w.text) === lfNorm_(t); })) return list;
  return list.concat([{ text: t, added: today }]);
}
/** For the Weekend Planner prompt: the wishes as lines, or []. */
function lfWeekendWishLines_() { return lfWishes_().map(function(w) { return w.text; }); }

/** POST life_add_to_weekend { id | text } */
function webLifeAddToWeekend_(body) {
  var text = lfStr_(body && body.text, 160);
  if (!text && body && body.id) { var it = getSharedInterestLedger_().filter(function(x) { return x.id === body.id; })[0]; text = it ? it.interest : ''; }
  if (!text) return { ok: false, error: 'What should the weekend include?' };
  return lfLocked_(function() {
    var list = lfAddWish_(lfWishes_(), text, lfToday_());
    lfSaveWishes_(list);
    return { ok: true, wishes: list };
  });
}
/** GET life_weekend_wishes / POST life_weekend_wish_remove { text } */
function webLifeWeekendWishes_() { return { ok: true, wishes: lfWishes_() }; }
function webLifeWeekendWishRemove_(body) {
  var t = lfNorm_(body && body.text);
  return lfLocked_(function() {
    var list = lfWishes_().filter(function(w) { return lfNorm_(w.text) !== t; });
    lfSaveWishes_(list);
    return { ok: true, wishes: list };
  });
}

/** POST life_idea_to_goal { id } / life_idea_to_project { id } — the idea is marked Promoted. */
function lfIdeaRow_(id) {
  var f = findIdeaRow_(id), r = f.sheet.getRange(f.rowNum, 1, 1, IDEA_HEADERS.length).getValues()[0];
  return { f: f, text: String(r[2] || '').trim(), category: String(r[3] || '').trim(), notes: String(r[5] || '').trim() };
}
function webLifeIdeaToGoal_(body) {
  var id = lfStr_(body && body.id, 40);
  if (!id) return { ok: false, error: 'Which idea?' };
  return lfLocked_(function() {
    var i = lfIdeaRow_(id);
    if (!i.text) return { ok: false, error: 'That idea is empty' };
    var g = createGoal_(i.text, i.notes, 'To Do', i.category || 'Growth', new Date().getFullYear(), 'From an idea (' + id + ')');
    i.f.sheet.getRange(i.f.rowNum, 7).setValue('Promoted');
    try { lfSetGoalExtra_(g.id, { focus: 'waiting' }); } catch (e) {}
    return { ok: true, goalId: g.id, title: g.title };
  });
}
function webLifeIdeaToProject_(body) {
  var id = lfStr_(body && body.id, 40);
  if (!id) return { ok: false, error: 'Which idea?' };
  return lfLocked_(function() {
    var i = lfIdeaRow_(id);
    if (!i.text) return { ok: false, error: 'That idea is empty' };
    var p = createProject_(i.text, [], 'Ahmed', i.notes);
    i.f.sheet.getRange(i.f.rowNum, 7).setValue('Promoted');
    return { ok: true, project: p && (p.projectId || p.id || p.name) || i.text, title: i.text };
  });
}

// ---- routes: Giving ----------------------------------------------------------------------

/** GET life_giving → entries newest first, yearly totals. */
function webLifeGiving_() {
  var rows = lfGivingRows_().sort(function(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return { ok: true, entries: rows, totals: lfGivingTotals_(rows), today: lfToday_() };
}
/** GET life_tax_giving&year → donations with a receipt that tax year (for Finances › Tax). */
function webLifeTaxGiving_(p) {
  var y = Number((p && p.year) || new Date().getFullYear() - 1);
  var t = lfTaxGiving_(lfGivingRows_(), y);
  return { ok: true, year: t.year, count: t.count, total: t.total, items: t.items };
}
/** Pure: the reason an entry can't be saved, or ''. */
function lfGivingProblem_(g) {
  if (!g.organisation) return 'Who was it for?';
  if (!g.date) return 'When was it?';
  if (g.kind === 'donation' && g.amount == null) return 'How much was given?';
  if (g.kind === 'volunteering' && g.hours == null) return 'How many hours?';
  return '';
}
/** POST life_giving_save { entry } */
function webLifeGivingSave_(body) {
  var g = lfGivingClean_(body && body.entry);
  if (!g.date && body && body.entry && !body.entry.date) g.date = lfToday_();
  var why = lfGivingProblem_(g);
  if (why) return { ok: false, error: why };
  return lfLocked_(function() {
    var sh = lfGivingSheet_(), row = g.id ? lfGivingRowOf_(sh, g.id) : -1;
    if (g.id && row === -1) return { ok: false, error: 'That entry is gone' };
    if (!g.id) g.id = lfMint_('GIVE-');
    var out = [g.id, g.date, g.kind, g.organisation, g.amount == null ? '' : g.amount, g.hours == null ? '' : g.hours, g.receipt, g.notes];
    if (row === -1) sh.appendRow(out); else sh.getRange(row, 1, 1, out.length).setValues([out]);
    return { ok: true, entry: g };
  });
}
/** POST life_giving_delete { id } */
function webLifeGivingDelete_(body) {
  var id = lfStr_(body && body.id, 40);
  return lfLocked_(function() {
    var sh = lfGivingSheet_(), row = lfGivingRowOf_(sh, id);
    if (row === -1) return { ok: false, error: 'That entry is gone' };
    sh.deleteRow(row);
    return { ok: true, id: id };
  });
}
/** Chat: log_giving|{kind}|{organisation}|{amount or hours}|{date}|{notes} */
function lfChatLogGiving_(args) {
  var kind = String(args[0] || '').toLowerCase().indexOf('vol') === 0 ? 'volunteering' : 'donation';
  var entry = { kind: kind, organisation: args[1], date: (args[3] || '').trim() || lfToday_(), notes: args[4] || '' };
  if (kind === 'donation') entry.amount = args[2]; else entry.hours = args[2];
  return webLifeGivingSave_({ entry: entry });
}

// ---- the Wish List move -------------------------------------------------------------------

/** Once ever: someday purchases from the Wish List into Planned Purchases at stage "idea". */
function lfMigrateWishList_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(LF_WISH_MIGRATED_PROP_)) return { moved: 0, reason: 'already moved' };
  var sh = getSpreadsheet().getSheetByName(TABS.WISH_LIST), moved = 0;
  if (sh && sh.getLastRow() >= 2) {
    var have = {};
    try { ppAll_().forEach(function(p) { have[lfNorm_(p.item)] = 1; }); } catch (e) {}
    sh.getRange(2, 1, sh.getLastRow() - 1, WISH_LIST_HEADERS.length).getValues().forEach(function(r) {
      var w = { person: String(r[1] || '').trim(), category: String(r[2] || '').trim(), item: String(r[3] || '').trim(), description: String(r[4] || '').trim(),
        urls: String(r[5] || ''), price: r[6], status: String(r[8] || '').trim(), dateAdded: lfYmd_(r[9]), notes: String(r[10] || '').trim() };
      var p = lfWishToPurchase_(w);
      if (!p || have[lfNorm_(p.item)]) return;
      var res = webPpSave_({ purchase: p });
      if (res && res.ok) { moved++; have[lfNorm_(p.item)] = 1; }
    });
  }
  props.setProperty(LF_WISH_MIGRATED_PROP_, new Date().toISOString());
  return { moved: moved };
}

