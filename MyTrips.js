// ============================================================
// VERA — MyTrips.js
// Travel → My Trips (issue #220): what is on the calendar, what is pencilled in,
// and what is behind you.
// ============================================================
//
// A pencilled trip is a Trip Idea with Pulled In set: "Family visit, April or
// November, about 10 days", or a wedding whose dates are known but not booked
// (Exact Start/End). No new sheet. It stays off every calendar: choosing dates
// saves them on the idea (the Settle column) and hands back a one-event .ics,
// and tiLinkSettled_ (TripIdeas.js) links the idea once that event reaches the
// Trips registry, exactly as a settled Trip Idea does.
//
// A trip added to the calendar by hand, on other dates or under another name,
// is offered as a match ("Is this your Family Visit to Egypt?"). Yes links them;
// No is remembered on the idea (Not Same) and the pair is never offered again.
//
// Two layers, so the tests need no Google:
//   mt*_        pure: the strip, windows, clashes, matches and flags
//   webMyTrips* the reads and writes
// ============================================================

var MT_MONTHS_AHEAD_   = 15;                // the strip: this month and the next 14
var MT_PICK_LEAD_DAYS_ = 84;                // "pick dates" 12 weeks before the first window
var MT_FLAG_PREFIX_    = 'MYTRIP|';
var MT_MATCH_SLACK_    = 3;                 // days either side of known dates
// A calendar trip that is not settled yet. Narrower than the itinerary's hold
// words on purpose: "options" or "alt" in a trip's name is not a maybe.
var MT_TENTATIVE_ = /\b(tentative(ly)?|tbd|maybe|potential(ly)?|possible|possibly|pencil+ed)\b|\(\s*\?\s*\)|\?\s*$/i;
var MT_MONTH_NAMES_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---- pure: dates -------------------------------------------------------------

function mtIsTentative_(label) { return MT_TENTATIVE_.test(String(label || '')); }
function mtYm_(ymd) { return String(ymd || '').slice(0, 7); }
function mtAddMonths_(ym, n) {
  var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + n;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  return y + '-' + String(m + 1).padStart(2, '0');
}
function mtMonthEnd_(ym) {
  var d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0));
  return ym + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function mtAddDays_(ymd, n) {
  var p = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}
function mtMonthWords_(ym) { return MT_MONTH_NAMES_[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4); }
function mtListWords_(arr) { return arr.length < 2 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]; }

/** Pure: the strip's months, this month first. */
function mtHorizon_(today) {
  var out = [], ym = mtYm_(today);
  for (var i = 0; i < MT_MONTHS_AHEAD_; i++) out.push(mtAddMonths_(ym, i));
  return out;
}

/** Pure: weekdays from start to end, both included. */
function mtWeekdays_(start, end) {
  var n = 0;
  for (var d = start; d <= end; d = mtAddDays_(d, 1)) {
    var p = d.split('-').map(Number), w = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

/** Pure: PTO days a trip of this many days takes, leaving on a Friday (holidays not counted). */
function mtPtoEstimate_(days) {
  if (!days || days < 1) return null;
  return mtWeekdays_('2027-01-01', mtAddDays_('2027-01-01', Math.min(60, days) - 1));   // Jan 1 2027 is a Friday
}

// ---- pure: the page ----------------------------------------------------------

/**
 * Pure: the pencilled-in list. An idea shows when it is pulled in, has no trip
 * yet and is not settled or archived. Months already gone drop out of its
 * windows (the sheet keeps them until Ahmed moves or drops the trip); when all
 * of them are gone, or its known dates are, it is expired and sorts first.
 * Otherwise soonest first; "any time" last.
 */
function mtPencilled_(ideas, optionCounts, today) {
  var cur = mtYm_(today);
  optionCounts = optionCounts || {};
  var list = (ideas || []).filter(function(i) {
    return i && i.id && i.pulledIn && !i.tripId && (i.status === 'brainstorming' || i.status === 'shortlisted');
  }).map(function(i) {
    var exact = !!(i.exactStart && i.exactEnd), months = i.months || [];
    var future = exact ? [] : months.filter(function(m) { return m >= cur; });
    var passed = exact ? [] : months.filter(function(m) { return m < cur; });
    var expired = exact ? i.exactEnd < today : (months.length > 0 && future.length === 0);
    var first = exact ? i.exactStart : (future.length ? future[0] + '-01' : '');
    var nights = i.nightsMax || i.nightsMin || null;
    var days = exact ? Math.round((Date.parse(i.exactEnd) - Date.parse(i.exactStart)) / 864e5) + 1 : (nights ? nights + 1 : null);
    return {
      id: i.id, title: i.title, where: i.where, travelers: i.travelers, note: i.mustHaves, status: i.status,
      exact: exact, exactStart: i.exactStart || '', exactEnd: i.exactEnd || '',
      months: future, passedMonths: passed, anyTime: !exact && months.length === 0,
      nightsMin: i.nightsMin, nightsMax: i.nightsMax, days: days,
      pto: exact ? mtWeekdays_(i.exactStart, i.exactEnd) : mtPtoEstimate_(days),
      options: optionCounts[i.id] || 0, expired: expired, first: first,
      pickBy: !exact && first && !i.settle ? mtAddDays_(first, -MT_PICK_LEAD_DAYS_) : '',
      settle: i.settle || null, notSame: i.notSame || [],
    };
  });
  list.sort(function(a, b) {
    if (a.expired !== b.expired) return a.expired ? -1 : 1;
    var fa = a.first || '9999', fb = b.first || '9999';
    return fa < fb ? -1 : fa > fb ? 1 : String(a.title).localeCompare(String(b.title));
  });
  return list;
}

/**
 * Pure: the 15-month strip. Each month: calendar trips (firm or tentative),
 * pencilled trips that could fall in it, and other marks (a leave block, a date
 * that matters) as {label, start, end}.
 */
function mtStrip_(horizon, upcoming, pencilled, others) {
  return (horizon || []).map(function(ym) {
    var s = ym + '-01', e = mtMonthEnd_(ym);
    var hit = function(a, b) { return a && a <= e && (b || a) >= s; };
    var m = { ym: ym, firm: [], tentative: [], loose: [], other: [] };
    (upcoming || []).forEach(function(t) { if (hit(t.startDate, t.endDate)) (t.tentative ? m.tentative : m.firm).push(t.label); });
    (pencilled || []).forEach(function(p) {
      if (p.expired) return;
      if (p.exact ? hit(p.exactStart, p.exactEnd) : p.months.indexOf(ym) !== -1) m.loose.push(p.title);
    });
    (others || []).forEach(function(o) { if (hit(o.start, o.end)) m.other.push(o.label); });
    return m;
  });
}

/**
 * Pure: what the strip should point out, in month order: two pencilled trips
 * after the same month, a pencilled month that already has a calendar trip, and
 * one that overlaps a leave block or a date that matters.
 */
function mtClashes_(strip) {
  var out = [];
  (strip || []).forEach(function(m) {
    var when = mtMonthWords_(m.ym);
    if (m.loose.length >= 2) out.push({ ym: m.ym, kind: 'pencilled', text: mtListWords_(m.loose) + ' both look at ' + when + '.' });
    if (m.loose.length && m.firm.length) out.push({ ym: m.ym, kind: 'calendar', text: mtListWords_(m.loose) + ' could clash with ' + mtListWords_(m.firm) + ' in ' + when + '.' });
    if (m.loose.length && m.other.length) out.push({ ym: m.ym, kind: 'other', text: when + ' overlaps ' + mtListWords_(m.other) + '.' });
  });
  return out;
}

/**
 * Pure: calendar trips that look like a pencilled one. The trip is not linked to
 * any idea yet, has not ended, starts in one of the idea's months (or within a
 * few days of its known dates), and shares a word of its name. A pair Ahmed
 * turned down is never offered again. An idea that is settling is left to
 * tiLinkSettled_, which links VERA's own calendar file by its dates.
 */
function mtMatches_(pencilled, trips, linkedIds, today) {
  var out = [];
  linkedIds = linkedIds || {};
  (pencilled || []).forEach(function(p) {
    if (p.settle) return;
    var want = tiTitleWords_(p.title);
    if (!want.length) return;
    (trips || []).forEach(function(t) {
      if (!t || !t.tripId || !t.startDate || linkedIds[String(t.tripId).toUpperCase()]) return;
      var end = t.endDate || t.startDate;
      if (end < today || (p.notSame || []).indexOf(t.tripId) !== -1) return;
      var inWindow = p.exact
        ? t.startDate <= mtAddDays_(p.exactEnd, MT_MATCH_SLACK_) && end >= mtAddDays_(p.exactStart, -MT_MATCH_SLACK_)
        : p.months.concat(p.passedMonths).indexOf(mtYm_(t.startDate)) !== -1;
      if (!inWindow) return;
      var words = tiTitleWords_(t.label);
      if (!want.some(function(w) { return words.indexOf(w) !== -1; })) return;
      out.push({ ideaId: p.id, ideaTitle: p.title, tripId: t.tripId, label: t.label,
        startDate: t.startDate, endDate: end, tripKey: t.startDate + '|' + t.label });
    });
  });
  return out;
}

/** Pure: the flags My Trips wants raised: pick dates (12 weeks out) and months that passed. */
function mtFlagsWanted_(pencilled, today) {
  var wanted = {};
  (pencilled || []).forEach(function(p) {
    if (p.expired) {
      wanted[MT_FLAG_PREFIX_ + 'expired|' + p.id] = { urgency: 'Low',
        flag: '🧳 ' + p.title + ': its months went by without dates',
        reason: 'Move it to next year or drop it in Travel → My Trips.' };
      return;
    }
    if (p.settle || !p.pickBy || today < p.pickBy) return;
    wanted[MT_FLAG_PREFIX_ + 'pick|' + p.id] = { urgency: 'Medium',
      flag: '🧳 Pick dates for ' + p.title,
      reason: 'Pencilled in for ' + p.months.map(mtMonthWords_).join(' or ') + '. Choose dates in Travel → My Trips so flights and PTO can be booked.' };
  });
  return wanted;
}

/** Pure: a pencilled trip's months moved on a year (the ones that passed), or its known dates. */
function mtRollForward_(idea) {
  var out = Object.assign({}, idea);
  var year = function(d) { return String(Number(d.slice(0, 4)) + 1) + d.slice(4); };
  if (idea.exactStart && idea.exactEnd) { out.exactStart = year(idea.exactStart); out.exactEnd = year(idea.exactEnd); return out; }
  out.months = (idea.months || []).map(year).filter(function(m, i, a) { return a.indexOf(m) === i; }).sort();
  return out;
}

// ---- reads ---------------------------------------------------------------------

/** Other marks for the strip: Family Planning's leave blocks, once it exists. */
function mtOtherMarks_(horizon) {
  try { if (typeof fpLeaveMarks_ === 'function') return fpLeaveMarks_(horizon) || []; } catch (e) { Logger.log('my trips: leave blocks unavailable'); }
  return [];
}

/** GET ?action=my_trips → everything the page shows. */
function webMyTrips_() {
  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  try { tiLinkSettled_(); } catch (e) { Logger.log('my trips: settle link skipped: ' + e.message); }
  var ideas = tiRows_(tiIdeasSheet_(), TRIP_IDEAS_HEADERS.length).filter(function(r) { return String(r[0]).trim(); }).map(tiIdeaFromRow_);
  var counts = {};
  tiRows_(tiOptionsSheet_(), TRIP_IDEA_OPTIONS_HEADERS.length).forEach(function(r) { var k = String(r[1] || '').trim(); if (k) counts[k] = (counts[k] || 0) + 1; });

  var upcoming = [];
  try {
    upcoming = (getUpcomingTravel_(readPTOConfig_()) || []).map(function(t) {
      return Object.assign({}, t, { tripKey: t.startDate + '|' + t.label, tentative: mtIsTentative_(t.label) });
    });
  } catch (e) { Logger.log('my trips: upcoming travel unavailable'); }

  var pencilled = mtPencilled_(ideas, counts, today);
  var horizon = mtHorizon_(today);
  var strip = mtStrip_(horizon, upcoming, pencilled, mtOtherMarks_(horizon));

  var linked = {};
  ideas.forEach(function(i) { if (i.tripId) linked[String(i.tripId).toUpperCase()] = 1; });
  var trips = [];
  try { trips = readTripRegistry_().rows.filter(tripIsLive_); } catch (e) { Logger.log('my trips: registry unavailable'); }

  var past = [];
  try { past = (webListPastTrips_().trips || []); } catch (e) { Logger.log('my trips: past trips unavailable'); }

  var pullable = ideas.filter(function(i) { return !i.tripId && (i.status === 'brainstorming' || i.status === 'shortlisted'); })
    .map(function(i) { return { id: i.id, title: i.title, months: i.months, exactStart: i.exactStart, exactEnd: i.exactEnd,
      nightsMin: i.nightsMin, nightsMax: i.nightsMax, status: i.status, options: counts[i.id] || 0, pulledIn: i.pulledIn }; });

  return { ok: true, today: today, upcoming: upcoming, pencilled: pencilled, strip: strip, clashes: mtClashes_(strip),
    matches: mtMatches_(pencilled, trips, linked, today), past: past, ideas: pullable };
}

/**
 * GET ?action=my_trip_windows&id → for each of a pencilled trip's months, the
 * best dates by PTO for both of you and the calendars (the same costing as
 * Trip Ideas → Decide). Asked for when the trip is opened, not on the list.
 */
function webMyTripWindows_(p) {
  var id = tiStr_(p && p.id, 40);
  var idea = id ? tiGetIdea_(id) : null;
  if (!idea) return { ok: false, error: 'That trip no longer exists' };
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var ty = Number(today.slice(0, 4)), years = [ty, ty + 1, ty + 2];
  var people = [tiPtoPerson_('Ahmed', readPTOConfig_, years), tiPtoPerson_('Victoria', readVictoriaPTOConfig_, years)];
  var busy = [];
  try { busy = (getUpcomingTravel_(readPTOConfig_()) || []).map(function(t) { return { label: t.label, start: t.startDate, end: t.endDate }; }); }
  catch (e) { Logger.log('my_trip_windows: upcoming trips unavailable'); }
  var nights = idea.nightsMax || idea.nightsMin || 7, cur = mtYm_(today);
  var months = (idea.months || []).filter(function(m) { return m >= cur; });
  var out = months.map(function(m) {
    var w = tiPtoWindows_({ months: [m], nights: nights, today: today, people: people, busy: busy, max: 1 });
    return { month: m, best: w.windows[0] || null };
  });
  return { ok: true, id: id, nights: nights, windows: out,
    people: people.map(function(x) { return { name: x.name, found: x.found }; }) };
}

// ---- writes ----------------------------------------------------------------------

/** Pure: the pencil-in form → a Trip Idea's raw fields. "About N days" is N − 1 nights. */
function mtPencilInIdea_(f) {
  f = f || {};
  var days = tiInt_(f.days, 1, 60);
  var exact = tiCleanExact_(f.exactStart, f.exactEnd);
  return {
    id: tiStr_(f.id, 40), title: f.title, where: f.where,
    months: exact.start ? [] : f.months,
    nightsMin: exact.start || !days ? null : Math.max(1, days - 1), nightsMax: exact.start || !days ? null : Math.max(1, days - 1),
    travelers: f.travelers, mustHaves: f.note, status: 'brainstorming', pulledIn: true,
    exactStart: exact.start, exactEnd: exact.end,
  };
}

/** POST {action:'my_trip_pencil', trip} → creates (or edits) a pencilled trip. */
function webMyTripPencil_(body) {
  var raw = mtPencilInIdea_(body && body.trip);
  if (!tiStr_(raw.title, 80)) return { ok: false, error: 'Give the trip a name' };
  if (!raw.exactStart && !(Array.isArray(raw.months) && raw.months.length)) return { ok: false, error: 'Pick at least one month, or the dates' };
  if (!raw.id) return webSaveTripIdea_({ idea: raw });
  var idea = tiGetIdea_(raw.id);
  if (!idea) return { ok: false, error: 'That trip no longer exists' };
  // An edit keeps what the form does not show: options, pieces, budget, a settle.
  ['title', 'where', 'months', 'nightsMin', 'nightsMax', 'travelers', 'mustHaves', 'exactStart', 'exactEnd'].forEach(function(k) { idea[k] = raw[k]; });
  idea.pulledIn = true;
  return webSaveTripIdea_({ idea: idea });
}

/**
 * POST {action:'my_trip_update', id, op, …}:
 *   pull / unpull       show it on My Trips, or not
 *   roll                its passed months (or known dates) move on a year
 *   drop                archived: off My Trips and Trip Ideas' open list
 *   choose {start,end,label}  dates chosen: saved as its settle; the dashboard makes the .ics
 *   unchoose            the dates are let go
 *   not_same {tripId}   that calendar trip is a different trip; never offered again
 *   link {tripId}       that calendar trip IS this one: linked now
 */
function webMyTripUpdate_(body) {
  body = body || {};
  var id = tiStr_(body.id, 40), op = tiStr_(body.op, 20);
  var idea = id ? tiGetIdea_(id) : null;
  if (!idea) return { ok: false, error: 'That trip no longer exists' };
  if (op === 'pull') {
    if (!idea.months.length && !idea.exactStart) return { ok: false, error: 'Give it months in Trip Ideas first' };
    idea.pulledIn = true;
  } else if (op === 'unpull') idea.pulledIn = false;
  else if (op === 'roll') idea = mtRollForward_(idea);
  else if (op === 'drop') { idea.status = 'archived'; idea.pulledIn = false; }
  else if (op === 'choose') {
    var settle = tiCleanSettle_({ optionId: idea.chosenOption || '', start: body.start, end: body.end,
      label: body.label || idea.title, at: new Date().toISOString() });
    if (!settle) return { ok: false, error: 'Those dates don’t work: the return must be after leaving, within 90 nights' };
    idea.settle = settle;
  } else if (op === 'unchoose') idea.settle = null;
  else if (op === 'not_same') {
    var t = tiStr_(body.tripId, 40);
    if (!t) return { ok: false, error: 'tripId required' };
    if (idea.notSame.indexOf(t) === -1) idea.notSame.push(t);
  } else if (op === 'link') {
    var trip = (readTripRegistry_().rows || []).filter(function(r) { return r.tripId === tiStr_(body.tripId, 40) && tripIsLive_(r); })[0];
    if (!trip) return { ok: false, error: 'That calendar trip is gone' };
    idea.tripId = trip.tripId; idea.status = 'settled';
    idea.settle = { optionId: idea.chosenOption || '', start: trip.startDate, end: trip.endDate || trip.startDate, label: trip.label, at: new Date().toISOString() };
    var res = webSaveTripIdea_({ idea: idea });
    if (res.ok) {
      try { mtCarryToTrip_(idea, trip); } catch (e) { Logger.log('my trips: note not carried to the trip'); }
      if (idea.chosenOption) { try { ariaWatchSettled_(idea.chosenOption, trip); } catch (e) { Logger.log('my trips: watch request not moved'); } }
    }
    return res;
  } else return { ok: false, error: 'Unknown change' };
  return webSaveTripIdea_({ idea: idea });
}

/** Pure: who is going, as the trip's Traveler field has it, or '' when the text says something else. */
function mtTraveler_(text) {
  var t = String(text || '').trim().toLowerCase();
  if (t === 'both' || t === 'ahmed' || t === 'victoria') return t.charAt(0).toUpperCase() + t.slice(1);
  return '';
}

/** A linked pencilled trip's note and travellers go to the calendar trip, never over what it already has. */
function mtCarryToTrip_(idea, trip) {
  var tripKey = trip.startDate + '|' + trip.label;
  var sheet = getSpreadsheet().getSheetByName(TABS.TRIP_META), have = { notes: '', traveler: '' };
  if (sheet && sheet.getLastRow() >= 2) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
    var k = tripKeyRowIndex_(rows.map(function(r) { return r[0]; }), tripKey);
    if (k !== -1) have = { notes: String(rows[k][2] || '').trim(), traveler: String(rows[k][4] || '').trim() };
  }
  var p = { tripKey: tripKey };
  if (idea.mustHaves && !have.notes) p.notes = idea.mustHaves;
  var tv = mtTraveler_(idea.travelers);
  if (tv && !have.traveler) p.traveler = tv;
  if (p.notes === undefined && p.traveler === undefined) return false;
  webSetTripMeta_({ parameter: p });
  return true;
}

/** Nightly: the pick-dates and months-passed flags, raised and closed by key. */
function myTripsSyncFlags_() {
  var flags = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!flags) return { skipped: 'no Flags tab' };
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var ideas = tiRows_(tiIdeasSheet_(), TRIP_IDEAS_HEADERS.length).filter(function(r) { return String(r[0]).trim(); }).map(tiIdeaFromRow_);
  var wanted = mtFlagsWanted_(mtPencilled_(ideas, {}, today), today);
  upsertKeyedFlags_(flags, MT_FLAG_PREFIX_, 'Travel', wanted, today);
  return { wanted: Object.keys(wanted).length };
}
