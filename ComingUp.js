/**
 * ComingUp.js — Life › Coming up (issue #222, stage 4).
 *
 * A new reader, separate from getMilestones_ (PTO.js keeps its all-day list for the PTO
 * planner). It reads Ahmed's calendars and the joint one (LifeGrowth.js lgEvents_), timed
 * events included, and keeps an event when it has a location or guests, or when it is
 * neither recurring nor one of his own blocks.
 *
 * How far ahead is set in Config, never in code:
 *   coming_up_days                 = 60
 *   coming_up_type:<name>          = <keywords, comma separated> | <days ahead>
 * An event of a type shows once it is that many days away; matching two types, the longer
 * lead wins. Untyped events don't show. The default rows are seeded into Config once.
 *
 * Birthdays and anniversaries come from Important Dates with each date's own lead time; a
 * calendar event for the same person that day merges with it.
 *
 * Each card gets prep actions by type (gift, RSVP, leave-by, bring something, pencil in a
 * trip, Hosting), a clash line when two evening plans overlap or it falls during a trip,
 * and after the day it becomes "How was it?", logging a note or an interest.
 * VERA writes no calendar.
 */

var CU_SEEDED_PROP_ = 'CU_CONFIG_SEEDED';
var CU_DONE_PROP_ = 'CU_DEBRIEFED';
var CU_DEFAULT_DAYS_ = 60;
var CU_AFTER_DAYS_ = 3;          // "How was it?" stays this long
var CU_DEFAULTS_ = [
  ['coming_up_days', '60'],
  ['coming_up_type:wedding', 'wedding, reception, ceremony | 60'],
  ['coming_up_type:big_event', 'graduation, shower, engagement, gala | 30'],
  ['coming_up_type:show', 'concert, show, game, festival | 21'],
  ['coming_up_type:party', 'party, celebration | 14'],
  ['coming_up_type:dinner', 'dinner, brunch, lunch | 7'],
];
var CU_GIFT_TYPES_ = ['wedding', 'big_event', 'party', 'birthday', 'anniversary'];
var CU_BRING_TYPES_ = ['party', 'dinner'];

// ---- pure ------------------------------------------------------------------------------------

/** Pure: the event types from Config rows; the defaults when there are none. */
function cuTypes_(cfg) {
  var out = [];
  Object.keys(cfg || {}).forEach(function(k) {
    if (k.indexOf('coming_up_type:') !== 0) return;
    var name = k.slice('coming_up_type:'.length).trim(), v = String(cfg[k] || ''), bar = v.lastIndexOf('|');
    var words = (bar === -1 ? v : v.slice(0, bar)).split(',').map(function(w) { return w.trim().toLowerCase(); }).filter(Boolean);
    var lead = bar === -1 ? NaN : Number(v.slice(bar + 1).trim());
    if (name && words.length && isFinite(lead) && lead >= 0) out.push({ name: name, words: words, lead: Math.round(lead) });
  });
  if (out.length) return out;
  var d = {}; CU_DEFAULTS_.forEach(function(p) { d[p[0]] = p[1]; });
  return cuTypes_(d);
}
function cuDays_(cfg) { var n = Number((cfg || {})['coming_up_days']); return isFinite(n) && n > 0 ? Math.round(n) : CU_DEFAULT_DAYS_; }
/** Pure: an event's type — every type whose word is in the title (as a word); the longest lead wins. */
function cuTypeFor_(title, types) {
  var t = ' ' + lfNorm_(title) + ' ', best = null;
  (types || []).forEach(function(ty) {
    if (!ty.words.some(function(w) { return t.indexOf(' ' + lfNorm_(w) + ' ') !== -1; })) return;
    if (!best || ty.lead > best.lead) best = ty;
  });
  return best;
}
/** Pure: keep an event? With a location or guests always; otherwise not when it recurs or is his own block. */
function cuKeep_(ev) {
  if (ev.location || ev.guests > 0) return true;
  return !ev.recurring && !ev.mine;
}
function cuDay_(ev) { return String(ev.start || '').slice(0, 10); }
function cuTime_(ev) { return ev.allDay ? '' : String(ev.start || '').slice(11, 16); }

/** Pure: Important Dates rows as cards' raw material — { day, label, person, lead, kind }. */
function cuDatesFrom_(rows, today) {
  return (rows || []).map(function(r) {
    var label = String(r.Label || r.label || ''), kind = /anniversar/i.test(label) ? 'anniversary' : /birthday|bday/i.test(label) ? 'birthday' : 'date';
    var d = Number(r.daysUntil);
    if (!isFinite(d)) return null;
    return { day: lgAddDays_(today, d), label: label, person: String(r.Person || r.person || ''), lead: Number(r['Lead Time Days'] || r.lead) || 30, kind: kind };
  }).filter(Boolean);
}

/**
 * Pure: the cards. Events (kept, typed) and Important Dates within their lead and the horizon;
 * an event on the same day naming the date's person (first name) absorbs the date. Past events
 * stay CU_AFTER_DAYS_ as "How was it?" unless already answered.
 * @param {Array} events  lgEvents_ shape
 * @param {Array} dates   cuDatesFrom_ shape
 * @param {Object} opts   { types, days, today, done: { id: 1 }, trips: [{label,start,end}], homeCity }
 */
function cuCards_(events, dates, opts) {
  var today = opts.today, horizon = opts.days, cards = [], done = opts.done || {};
  (events || []).forEach(function(ev) {
    if (!cuKeep_(ev)) return;
    var ty = cuTypeFor_(ev.title, opts.types);
    if (!ty) return;
    var day = cuDay_(ev), away = lfDays_(today, day);
    var after = away < 0 && away >= -CU_AFTER_DAYS_;
    if (after && done[ev.id]) return;
    if (!after && (away < 0 || away > Math.min(ty.lead, horizon))) return;
    cards.push({ id: ev.id, title: ev.title, day: day, time: cuTime_(ev), end: ev.end, allDay: ev.allDay, type: ty.name, lead: ty.lead, daysAway: away,
      location: ev.location || '', guests: ev.guests || 0, description: ev.description || '', calendar: ev.calendar || '', after: after, dates: [] });
  });
  (dates || []).forEach(function(d) {
    var away = lfDays_(today, d.day);
    if (away < 0 || away > Math.min(d.lead, horizon)) return;
    var first = lfNorm_(d.person).split(' ')[0];
    var host = first && cards.filter(function(c) { return c.day === d.day && !c.after && (' ' + lfNorm_(c.title) + ' ').indexOf(' ' + first) !== -1; })[0];
    if (host) { host.dates.push({ label: d.label, person: d.person, kind: d.kind }); if (d.kind !== 'date' && CU_GIFT_TYPES_.indexOf(host.type) === -1) host.giftFor = d.person; return; }
    cards.push({ id: 'date:' + d.day + ':' + lfNorm_(d.label).replace(/ /g, '-'), title: d.label, day: d.day, time: '', allDay: true, type: d.kind === 'date' ? 'date' : d.kind,
      lead: d.lead, daysAway: away, location: '', guests: 0, description: '', after: false, dates: [{ label: d.label, person: d.person, kind: d.kind }], fromDates: true });
  });
  cards.forEach(function(c) { c.prep = cuPrep_(c, opts); });
  cuClashes_(cards, opts.trips || []);
  cards.sort(function(a, b) { return a.after !== b.after ? (a.after ? 1 : -1) : a.day < b.day ? -1 : a.day > b.day ? 1 : (a.time < b.time ? -1 : 1); });
  return cards;
}

/** Pure: the prep actions for a card. */
function cuPrep_(c, opts) {
  if (c.after) return [];
  var p = [], person = (c.dates[0] && c.dates[0].person) || c.giftFor || '';
  if (CU_GIFT_TYPES_.indexOf(c.type) !== -1 || c.giftFor) p.push({ kind: 'gift', label: 'Plan a gift' + (person ? ' for ' + person : ''), person: person });
  var rsvp = String(c.description || '').match(/rsvp[^.\n]{0,60}/i);
  if (rsvp) p.push({ kind: 'rsvp', label: rsvp[0].replace(/\s+/g, ' ').trim() });
  if (c.location && c.time && c.daysAway <= 7) p.push({ kind: 'leave_by', label: 'Leave-by time' });
  if (CU_BRING_TYPES_.indexOf(c.type) !== -1 || /potluck|bring/i.test(c.description || '')) p.push({ kind: 'bring', label: 'Bring something?' });
  var home = lfNorm_((opts && opts.homeCity) || '').split(' ')[0];
  if (c.location && home && lfNorm_(c.location).indexOf(home) === -1 && /,\s*[A-Za-z .]+,?\s*[A-Z]{2}\b|\b(airport|hotel|resort)\b/i.test(c.location)) p.push({ kind: 'trip', label: 'Pencil in a trip' });
  if (/\b(host|hosting|our place|at ours|at home)\b/i.test(c.title + ' ' + c.description)) p.push({ kind: 'hosting', label: 'Open in Hosting' });
  return p;
}

/** Pure: a clash line — two evening plans that overlap, or a plan during a trip. */
function cuClashes_(cards, trips) {
  var mins = function(t) { return t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null; };
  cards.forEach(function(c) {
    if (c.after) return;
    var lines = [];
    if (c.time && mins(c.time) >= 17 * 60) {
      var cEnd = String(c.end || '').slice(0, 10) === c.day ? mins(String(c.end).slice(11, 16)) : 24 * 60;
      cards.forEach(function(o) {
        if (o === c || o.day !== c.day || !o.time || o.after) return;
        var oEnd = String(o.end || '').slice(0, 10) === o.day ? mins(String(o.end).slice(11, 16)) : 24 * 60;
        if (mins(o.time) < cEnd && mins(c.time) < oEnd) lines.push('Overlaps ' + o.title + ' at ' + o.time);
      });
    }
    (trips || []).forEach(function(t) { if (t.start && t.end && c.day >= t.start && c.day <= t.end && lfNorm_(t.label) !== lfNorm_(c.title)) lines.push('During ' + t.label); });
    c.clash = lines.join(' · ');
  });
}
/** Pure: leave-by — the start, less the drive and ten minutes, as HH:MM; '' when unknown. */
function cuLeaveBy_(time, driveMin) {
  if (!time || driveMin == null) return '';
  var m = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) - driveMin - 10;
  if (m < 0) return '';
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

// ---- reads -------------------------------------------------------------------------------------

/** Once ever: the default Coming up rows into VERA's Config tab (a row already there is left alone). */
function cuSeedConfig_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(CU_SEEDED_PROP_)) return 0;
  var sheet = getSpreadsheet().getSheetByName(TABS.CONFIG);
  if (!sheet) return 0;
  var have = {};
  if (sheet.getLastRow() >= 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function(r) { have[String(r[0] || '').trim()] = 1; });
  var added = 0;
  CU_DEFAULTS_.forEach(function(p) { if (!have[p[0]]) { sheet.appendRow(p); added++; } });
  props.setProperty(CU_SEEDED_PROP_, new Date().toISOString());
  try { _configCache_ = null; } catch (e) {}
  return added;
}
function cuDone_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(CU_DONE_PROP_) || '{}') || {}; } catch (e) { return {}; } }
function cuTripsWindow_() {
  try { return (getUpcomingTravel_(readPTOConfig_()) || []).map(function(t) { return { label: t.label, start: t.startDate, end: t.endDate }; }); } catch (e) { return []; }
}

/** GET coming_up → the cards. */
function webComingUp_() {
  try { cuSeedConfig_(); } catch (e) {}
  var cfg = {}; try { cfg = getConfigValues() || {}; } catch (e) {}
  var today = lfToday_(), days = cuDays_(cfg), types = cuTypes_(cfg);
  var from = new Date(lgAddDays_(today, -CU_AFTER_DAYS_) + 'T00:00:00'), to = new Date(lgAddDays_(today, days + 1) + 'T00:00:00');
  var events = [], err = '';
  try { events = lgEvents_(from, to); } catch (e) { err = 'The calendar could not be read just now.'; }
  var dates = []; try { dates = cuDatesFrom_(getUpcomingImportantDates_(days), today); } catch (e) {}
  var cards = cuCards_(events, dates, { types: types, days: days, today: today, done: cuDone_(), trips: cuTripsWindow_(), homeCity: cfg['home_city'] || '' });
  return { ok: true, today: today, days: days, cards: cards, error: err };
}

/** GET coming_up_leave_by&id&location&time → the drive and the time to leave (Distance Matrix, cached). */
function webComingUpLeaveBy_(p) {
  var cfg = {}; try { cfg = getConfigValues() || {}; } catch (e) {}
  var from = String(cfg['home_address'] || cfg['home_city'] || '').trim(), to = lfStr_(p && p.location, 200), time = lfStr_(p && p.time, 5);
  if (!from) return { ok: false, error: 'Add home_address to Config so VERA knows where you leave from.' };
  if (!to) return { ok: false, error: 'This plan has no place on it.' };
  var cache = loadTravelLegCache_(), key = travelLegKey_(from, to, 'driving'), leg = cache[key];
  if (!leg) {
    var apiKey = getTravelLegsApiKey_();
    if (!apiKey) return { ok: false, error: 'Drive times need the Maps key VERA uses for trips.' };
    leg = fetchTravelLeg_(from, to, 'driving', apiKey);
    if (!leg.fatal) appendTravelLegRows_([[from, to, 'driving', leg.minutes == null ? '' : leg.minutes, leg.distance || '', leg.status || '', new Date().toISOString()]]);
  }
  if (leg.minutes == null) return { ok: false, error: 'No drive time for that place.' };
  return { ok: true, minutes: leg.minutes, distance: leg.distance, leaveBy: cuLeaveBy_(time, leg.minutes) };
}

/** POST coming_up_debrief { id, title, kind: note|interest|skip, text } — "How was it?" */
function webComingUpDebrief_(body) {
  var id = lfStr_(body && body.id, 200), kind = String((body && body.kind) || ''), text = lfStr_(body && body.text, 400), title = lfStr_(body && body.title, 120);
  if (!id) return { ok: false, error: 'Which plan?' };
  if (kind !== 'skip' && !text) return { ok: false, error: 'Say a word about it' };
  var out = { ok: true, kind: kind };
  if (kind === 'interest') out.interest = createInterest_('Ahmed', text, 'Other', 'Manual', 'After ' + title);
  else if (kind === 'note') { var r = webAddNote_({ parameter: { title: 'After ' + title, content: text, category: 'Coming up' } }); if (!r.ok) return r; out.noteId = r.id; }
  return lfLocked_(function() {
    var done = cuDone_(); done[id] = lfToday_();
    var keys = Object.keys(done).sort(function(a, b) { return done[a] < done[b] ? 1 : -1; }).slice(0, 200), keep = {};
    keys.forEach(function(k) { keep[k] = done[k]; });
    PropertiesService.getScriptProperties().setProperty(CU_DONE_PROP_, JSON.stringify(keep));
    return out;
  });
}

/** POST coming_up_bring { title, day } → a task the day before. */
function webComingUpBring_(body) {
  var title = lfStr_(body && body.title, 120), day = lfYmd_(body && body.day);
  if (!title || !day) return { ok: false, error: 'Which plan?' };
  var r = webAddTask_({ parameter: { task: 'Bring something to ' + title, dueDate: lgAddDays_(day, -1), notes: 'From Life › Coming up' } });
  return { ok: true, task: r && (r.taskId || r.id) || '' };
}
