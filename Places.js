// ============================================================
// VERA — Places.js
// Travel › Places (issue #228): Countries and the Bucket List, read together.
// ============================================================
//
// GET places returns what the Countries views need in one answer:
//   visits     the Countries rows (one per city visited), with Occasion
//   bucket     the Bucket List rows not yet visited, for the map's dashed tiles
//   planned    countries on upcoming trips, worked out from each trip's
//              itinerary (flights and addresses, no geocoding); cached 6 hours
//   notes      per country: what we loved and what to do next time, from Life ›
//              Explore (places and things we love, and trip lessons) that share
//              a word with the country, its cities or its trips
//   occasions  the quick picks (Config places_occasions) plus what's been used
//
// Occasion is a new column on Countries, after Notes. Until now the add form
// saved its Occasion box into Notes, so a one-time move (Script Property
// PL_OCCASION_MOVED) copies Notes into Occasion where Occasion is blank.
//
// Two layers: pl*_ pure helpers, then the sheet reads and the endpoint.
// ============================================================

var PL_OCCASIONS_DEFAULT_ = ['Anniversary', 'Birthday', 'Honeymoon', 'Family visit', 'Wedding', 'Holiday', 'Work', 'Just because'];
var PL_MOVED_PROP_ = 'PL_OCCASION_MOVED';
var PL_PLANNED_CACHE_ = 'pl_planned_v1';

// ---- pure ---------------------------------------------------------------------

function plStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }

/** Config places_occasions (comma list) or the defaults. */
function plPicks_(cfgValue) {
  var list = String(cfgValue || '').split(',').map(function(s) { return plStr_(s, 40); }).filter(Boolean);
  return list.length ? list : PL_OCCASIONS_DEFAULT_.slice();
}

/** The picks, then every other occasion already used (first spelling kept), no repeats ignoring case. */
function plSuggestions_(picks, used) {
  var seen = {}, out = [];
  (picks || []).concat(used || []).forEach(function(s) {
    s = plStr_(s, 60); var k = s.toLowerCase();
    if (!s || seen[k]) return; seen[k] = 1; out.push(s);
  });
  return out;
}

/** The pick a free-text occasion counts under ("10th anniversary" → Anniversary), else Other. */
function plOccasionGroup_(text, picks) {
  var t = String(text || '').toLowerCase();
  if (!t.trim()) return '';
  for (var i = 0; i < (picks || []).length; i++) {
    var p = String(picks[i]).toLowerCase();
    if (t === p || t.indexOf(p) !== -1) return picks[i];
    var stem = p.replace(/s$/, '');
    if (stem.length >= 4 && t.indexOf(stem) !== -1) return picks[i];
  }
  return 'Other';
}

/**
 * The one-time move: rows (with headers) → the rows to write, and how many moved.
 * A row with Notes and no Occasion gets Notes as its Occasion and Notes cleared.
 * A row that already has an Occasion is left exactly as it is.
 */
function plMoveOccasions_(rows) {
  if (!rows || !rows.length) return { rows: rows || [], moved: 0 };
  var h = rows[0].map(function(x) { return String(x).trim(); });
  var n = h.indexOf('Notes'), o = h.indexOf('Occasion'), moved = 0;
  if (n === -1 || o === -1) return { rows: rows, moved: 0 };
  var out = rows.map(function(r, i) {
    if (i === 0 || !String(r[0] || '').trim()) return r;
    var notes = plStr_(r[n], 120), occ = plStr_(r[o], 120);
    if (occ || !notes) return r;
    var c = r.slice(); c[o] = notes; c[n] = ''; moved++; return c;
  });
  return { rows: out, moved: moved };
}

/** Rows with headers → objects by header. Rows without an ID are skipped. */
function plObjects_(rows) {
  if (!rows || rows.length < 2) return [];
  var h = rows[0].map(function(x) { return String(x).trim(); });
  return rows.slice(1).filter(function(r) { return String(r[0] || '').trim(); }).map(function(r) {
    var o = {}; h.forEach(function(k, i) { if (k) o[k] = r[i] instanceof Date ? r[i].toISOString().slice(0, 10) : r[i]; }); return o;
  });
}

/**
 * What we thought, per visited country: loved (places and things we love) and next
 * time (trip lessons), each an interest whose words meet the country's, its cities'
 * or its trips' names. words(s) gives the place words; interests: {loved:[{text}], lessons:[{text,trip}]}.
 */
function plNotesFor_(visits, interests, words) {
  var by = {};
  (visits || []).forEach(function(v) {
    var c = plStr_(v.Country, 80); if (!c) return;
    var e = by[c] || (by[c] = { names: [c] });
    if (v.City) e.names.push(String(v.City));
    var trip = String(v['Trip Key'] || '').split('|').slice(1).join('|');
    if (trip) e.names.push(trip);
  });
  var out = {};
  Object.keys(by).forEach(function(c) {
    var want = {}; by[c].names.forEach(function(n) { words(n).forEach(function(w) { want[w] = 1; }); });
    var hits = function(list, withTrip) {
      var seen = {};
      return (list || []).filter(function(it) {
        var have = words((withTrip ? (it.trip || '') + ' ' : '') + it.text);
        var k = String(it.text).toLowerCase();
        if (seen[k] || !have.some(function(w) { return want[w]; })) return false;
        seen[k] = 1; return true;
      }).slice(0, 3).map(function(it) { return it.text; });
    };
    var loved = hits(interests.loved, false), next = hits(interests.lessons, true);
    if (loved.length || next.length) out[c] = { loved: loved, next: next };
  });
  return out;
}

/** Upcoming trips worth checking for countries: active, not ended, starting within 18 months; at most 6, soonest first. */
function plUpcoming_(rows, today) {
  var t0 = Date.parse(today + 'T00:00:00Z'), limit = t0 + 548 * 864e5;
  return (rows || []).filter(function(r) {
    if (r.status !== 'active' || !r.startDate || !r.label) return false;
    if ((r.endDate || r.startDate) < today) return false;
    return Date.parse(r.startDate + 'T00:00:00Z') <= limit;
  }).sort(function(a, b) { return a.startDate < b.startDate ? -1 : 1; }).slice(0, 6);
}

/** Activities rows (with headers) → {bucketId: [{id, activity, done}]} in sheet order. */
function plActivitiesBy_(rows) {
  var out = {};
  plObjects_(rows).forEach(function(a) {
    var b = String(a['Bucket ID'] || '').trim(); if (!b) return;
    var done = String(a.Done || '').trim().toLowerCase();
    (out[b] = out[b] || []).push({ id: String(a.ID), activity: String(a.Activity || ''), done: !!done && done !== 'no' && done !== 'false' });
  });
  return out;
}

/** The Bucket List filters: open (not yet visited), dream, occasion, stars (4 and up), all. */
function plBucketView_(items, filter) {
  return (items || []).filter(function(b) {
    if (filter === 'all') return true;
    if (filter !== 'open' && b.visited) return false;
    if (filter === 'open') return !b.visited;
    if (filter === 'dream') return !!String(b['Dream Trip'] || '').trim();
    if (filter === 'occasion') return !!String(b.Occasion || '').trim();
    if (filter === 'stars') return Number(b.Stars) >= 4;
    return true;
  });
}

/** A place's name as shown: "Lisbon, Portugal", or the country alone. */
function plPlaceName_(b) { var c = plStr_(b.City, 60), k = plStr_(b.Country, 60); return c ? c + ', ' + k : k; }

/**
 * The Trip Idea brief a set of bucket places makes (#228). items: bucket rows with their
 * activities; today: 'yyyy-mm-dd'; picks: the occasion quick picks.
 * → {title, where, months, travelers, mustHaves, pieces, occasion}. Everything is editable after.
 */
function plBriefFrom_(items, today, picks) {
  items = items || [];
  var countries = [], cities = [];
  items.forEach(function(b) {
    var k = plStr_(b.Country, 60), c = plStr_(b.City, 60);
    if (k && countries.indexOf(k) === -1) countries.push(k);
    if (c && cities.indexOf(c) === -1) cities.push(c);
  });
  var occasion = '';
  items.forEach(function(b) { if (!occasion && plStr_(b.Occasion, 60)) occasion = plStr_(b.Occasion, 60); });
  var placeList = cities.length ? cities.join(', ') : countries.join(', ');
  var lead = occasion ? occasion.charAt(0).toUpperCase() + occasion.slice(1) + ' in ' + countries.join(' & ') : countries.join(' & ');
  var title = cities.length ? lead + ': ' + cities.join(', ') : (occasion ? lead : placeList);
  var where = countries.length === 1 ? placeList + (cities.length ? ' (' + countries[0] + ')' : '')
    : items.map(function(b) { return plStr_(b.City, 60) ? plStr_(b.City, 60) + ' (' + plStr_(b.Country, 60) + ')' : plStr_(b.Country, 60); })
        .filter(function(x, i, a) { return x && a.indexOf(x) === i; }).join(', ');
  // when: the earliest target year; this year means from next month on
  var years = items.map(function(b) { return parseInt(b['Target Year'], 10); }).filter(function(y) { return y > 1900; }).sort();
  var months = [], ty = Number(String(today).slice(0, 4)), tm = Number(String(today).slice(5, 7));
  if (years.length && years[0] >= ty) {
    for (var m = years[0] === ty ? tm + 1 : 1; m <= 12; m++) months.push(years[0] + '-' + (m < 10 ? '0' : '') + m);
  }
  var who = items.map(function(b) { return plStr_(b.Traveller, 20) || 'Both'; }).filter(function(x, i, a) { return a.indexOf(x) === i; });
  var travelers = who.length === 1 && who[0] !== 'Both' ? who[0] : 'Ahmed and Victoria';
  var musts = [];
  var group = occasion ? plOccasionGroup_(occasion, picks || PL_OCCASIONS_DEFAULT_) : '';
  if (group === 'Anniversary') musts.push('Anniversary dinner on the night itself.');
  if (group === 'Birthday') musts.push('Birthday dinner on the day itself.');
  items.forEach(function(b) { var n = plStr_(b.Notes, 200); if (n) musts.push(items.length > 1 ? (plStr_(b.City, 60) || plStr_(b.Country, 60)) + ': ' + n : n); });
  var pieces = [];
  items.forEach(function(b) {
    (b.activities || []).forEach(function(a) { if (!a.done && plStr_(a.activity, 100)) pieces.push({ kind: 'wish', name: plStr_(a.activity, 100), detail: plPlaceName_(b) }); });
  });
  return { title: title.slice(0, 80), where: where.slice(0, 160), months: months, travelers: travelers, mustHaves: musts.join(' ').slice(0, 1000), pieces: pieces.slice(0, 30), occasion: occasion };
}

/** Bucket rows → {ideaId: ['Lisbon, Portugal', …]} for the places a Trip Idea came from. */
function plBucketByIdea_(bucket) {
  var out = {};
  (bucket || []).forEach(function(b) { var id = plStr_(b['Trip Idea'], 40); if (id) (out[id] = out[id] || []).push(plPlaceName_(b)); });
  return out;
}

/**
 * After the trip: bucket places linked to an idea that became a trip which has ended.
 * ideas: [{id, tripId}]; tripsById: {TRIP-ID: {startDate, endDate, label}}; today.
 * → [{bucket row, trip}] still to close (places not yet visited).
 */
function plToClose_(bucket, ideas, tripsById, today) {
  var tripOf = {};
  (ideas || []).forEach(function(i) { var t = i.tripId && tripsById[String(i.tripId).toUpperCase()]; if (t && (t.endDate || t.startDate) && (t.endDate || t.startDate) < today) tripOf[i.id] = t; });
  return (bucket || []).filter(function(b) { return !String(b.Visited || '').trim() && tripOf[plStr_(b['Trip Idea'], 40)]; })
    .map(function(b) { return { item: b, trip: tripOf[plStr_(b['Trip Idea'], 40)] }; });
}

// ---- sheets -------------------------------------------------------------------

/** A tab made before a column was added gets the new headers (ensureSheet only writes them on a blank tab). */
function plSchema_(sheet, headers) {
  if (!sheet) return sheet;
  var have = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(have[i] == null ? '' : have[i]).trim() !== headers[i]) { sheet.getRange(1, 1, 1, headers.length).setValues([headers]); break; }
  }
  return sheet;
}

function plBucketSheet_() { return plSchema_(ensureSheet(getSpreadsheet(), TABS.BUCKET_LIST, BUCKET_LIST_HEADERS), BUCKET_LIST_HEADERS); }

function plCountriesSheet_() { return plSchema_(ensureSheet(getSpreadsheet(), TABS.COUNTRIES, COUNTRIES_HEADERS), COUNTRIES_HEADERS); }

function plLocked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** The one-time Notes → Occasion move on Countries. Safe to call every time: it runs once. */
function plMoveOccasionsOnce_() {
  var props = PropertiesService.getScriptProperties();
  if (veraOnceGet_(PL_MOVED_PROP_)) return 0;
  return plLocked_(function() {
    if (veraOnceGet_(PL_MOVED_PROP_)) return 0;
    var sheet = plCountriesSheet_(), moved = 0;
    if (sheet.getLastRow() >= 2) {
      var rows = sheet.getRange(1, 1, sheet.getLastRow(), COUNTRIES_HEADERS.length).getValues();
      var r = plMoveOccasions_(rows);
      if (r.moved) sheet.getRange(1, 1, r.rows.length, COUNTRIES_HEADERS.length).setValues(r.rows);
      moved = r.moved;
    }
    veraOnceSet_(PL_MOVED_PROP_, new Date().toISOString() + ' moved ' + moved);
    return moved;
  });
}

/** Countries on upcoming trips: [{country, tripKey, label, startDate, endDate}]. Cached 6 hours. */
function plPlanned_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(PL_PLANNED_CACHE_);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var trips = plUpcoming_((readTripRegistry_().rows || []), today);
  var out = [];
  if (trips.length) {
    var countryNames = {};
    try { passportIndexCsv_().split('\n')[0].split(',').slice(1).forEach(function(h) { if (h.trim()) countryNames[visaNorm_(h)] = h.trim(); }); } catch (e) {}
    var memo = {};
    var airportCountry = function(code) {
      if (!/^[A-Z]{3}$/.test(code || '')) return '';
      if (memo[code] !== undefined) return memo[code];
      var c = cache.get('iata_country_' + code);
      if (c === null) { c = resolveIataCountry_(code, null) || ''; cache.put('iata_country_' + code, c, 21600); }
      return (memo[code] = c);
    };
    var home = String(getConfigValues()['home_country'] || 'United States');
    trips.forEach(function(t) {
      var key = t.startDate + '|' + t.label;
      try {
        var items = tripItemsFor_(key, t.startDate, t.endDate || t.startDate, 'places');
        tripCountries_(items, countryNames, airportCountry, home, null).forEach(function(c) {
          if (c.role !== 'stay') return;
          out.push({ country: c.country, tripKey: key, label: t.label, startDate: t.startDate, endDate: t.endDate || t.startDate });
        });
      } catch (e) { Logger.log('plPlanned_: ' + key + ' — ' + e.message); }
    });
  }
  try { cache.put(PL_PLANNED_CACHE_, JSON.stringify(out), 21600); } catch (e) {}
  return out;
}

// ---- endpoint -----------------------------------------------------------------

/** GET places → {visits, bucket, planned, notes, occasions, picks}. */
function webGetPlaces_() {
  plMoveOccasionsOnce_();
  try { plCloseVisited_(); } catch (e) { Logger.log('webGetPlaces_: close visited — ' + e.message); }
  var ss = getSpreadsheet();
  var cs = plCountriesSheet_();
  var visits = cs.getLastRow() >= 2 ? plObjects_(cs.getRange(1, 1, cs.getLastRow(), COUNTRIES_HEADERS.length).getValues()) : [];
  var bs = plBucketSheet_();
  var acts = ss.getSheetByName(TABS.BUCKET_ACTIVITIES);
  var actBy = acts && acts.getLastRow() >= 2 ? plActivitiesBy_(acts.getDataRange().getValues()) : {};
  var bucket = bs.getLastRow() >= 2 ? plObjects_(bs.getRange(1, 1, bs.getLastRow(), BUCKET_LIST_HEADERS.length).getValues()).map(function(b) {
    b.visited = !!String(b.Visited || '').trim(); b.activities = actBy[String(b.ID)] || []; return b;
  }) : [];
  var planned = [];
  try { planned = plPlanned_(); } catch (e) { Logger.log('webGetPlaces_: planned — ' + e.message); }
  var notes = {};
  try {
    var v = lfViews_();
    notes = plNotesFor_(visits, { loved: (v.places || []).concat(v.things || []), lessons: v.lessons || [] }, lfPlaceWords_);
  } catch (e) { Logger.log('webGetPlaces_: notes — ' + e.message); }
  var picks = plPicks_(getConfigValues()['places_occasions']);
  var used = visits.map(function(x) { return x.Occasion; }).concat(bucket.map(function(x) { return x.Occasion; }));
  var extras = {};
  try { extras = typeof bpPlacesExtras_ === 'function' ? bpPlacesExtras_(bucket) : {}; } catch (e) { Logger.log('webGetPlaces_: extras — ' + e.message); }
  return Object.assign({ ok: true, visits: visits, bucket: bucket, planned: planned, notes: notes, picks: picks, occasions: plSuggestions_(picks, used) }, extras);
}

/** Bucket rows with their things to do, by header. */
function plBucketRows_() {
  var bs = plBucketSheet_(), ss = getSpreadsheet();
  var acts = ss.getSheetByName(TABS.BUCKET_ACTIVITIES);
  var actBy = acts && acts.getLastRow() >= 2 ? plActivitiesBy_(acts.getDataRange().getValues()) : {};
  return bs.getLastRow() >= 2 ? plObjects_(bs.getRange(1, 1, bs.getLastRow(), BUCKET_LIST_HEADERS.length).getValues()).map(function(b) {
    b.activities = actBy[String(b.ID)] || []; return b; }) : [];
}

/** Writes one column of a bucket row by ID and header. */
function plSetBucket_(id, header, value) {
  var bs = plBucketSheet_(), col = BUCKET_LIST_HEADERS.indexOf(header) + 1;
  if (!col || bs.getLastRow() < 2) return false;
  var ids = bs.getRange(2, 1, bs.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) { bs.getRange(i + 2, col).setValue(value); return true; }
  return false;
}

/** POST places_plan_preview {bucketIds} → {brief, places}. */
function webPlacesPlanPreview_(body) {
  var ids = (body && body.bucketIds) || [];
  var items = plBucketRows_().filter(function(b) { return ids.indexOf(String(b.ID)) !== -1; });
  if (!items.length) return { ok: false, error: 'Choose at least one place.' };
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var brief = plBriefFrom_(items, today, plPicks_(getConfigValues()['places_occasions'])), extra = {};
  try { extra = typeof bpPlanExtras_ === 'function' ? bpPlanExtras_(items, brief, today) : {}; } catch (e) { Logger.log('places_plan_preview: extras — ' + e.message); }
  return Object.assign({ ok: true, brief: brief, places: items.map(plPlaceName_) }, extra);
}

/**
 * POST places_plan_idea {bucketIds, edits:{title, where, travelers, mustHaves}} → saves the brief as a
 * Trip Idea (through webSaveTripIdea_, so every field is bounded there) and links each place to it.
 */
function webPlacesPlanIdea_(body) {
  var pv = webPlacesPlanPreview_(body);
  if (!pv.ok) return pv;
  var e = (body && body.edits) || {}, b = pv.brief;
  var idea = { title: e.title !== undefined ? e.title : b.title, where: e.where !== undefined ? e.where : b.where, months: b.months,
    travelers: e.travelers !== undefined ? e.travelers : b.travelers, mustHaves: e.mustHaves !== undefined ? e.mustHaves : b.mustHaves,
    pieces: b.pieces, status: 'brainstorming', pace: 'balanced', openTo: [] };
  var r = webSaveTripIdea_({ idea: idea });
  if (!r || !r.ok) return r || { ok: false, error: 'The idea didn’t save.' };
  plLocked_(function() { (body.bucketIds || []).forEach(function(id) { plSetBucket_(String(id), 'Trip Idea', r.idea.id); }); });
  return { ok: true, idea: r.idea };
}

/** Trip Ideas' "From your bucket list" line: {ideaId: [place names]}. Never throws. */
function plBucketForIdeas_() {
  try { return plBucketByIdea_(plBucketRows_()); } catch (e) { Logger.log('plBucketForIdeas_: ' + e.message); return {}; }
}

/**
 * Places planned into an idea that became a trip which has ended are marked visited (the trip's
 * year), and each gets a Countries visit unless one for that trip is already there. Runs on
 * every places read; a place already visited is never touched again.
 */
function plCloseVisited_() {
  var bucket = plBucketRows_().filter(function(b) { return plStr_(b['Trip Idea'], 40) && !String(b.Visited || '').trim(); });
  if (!bucket.length) return 0;
  var ideas = tiRows_(tiIdeasSheet_(), TRIP_IDEAS_HEADERS.length).filter(function(r) { return String(r[0]).trim(); }).map(tiIdeaFromRow_);
  var byId = {}; (readTripRegistry_().rows || []).forEach(function(t) { byId[t.tripId] = t; });
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var todo = plToClose_(bucket, ideas, byId, today);
  if (!todo.length) return 0;
  return plLocked_(function() {
    var cs = plCountriesSheet_();
    var have = cs.getLastRow() >= 2 ? plObjects_(cs.getRange(1, 1, cs.getLastRow(), COUNTRIES_HEADERS.length).getValues()) : [];
    todo.forEach(function(x) {
      var b = x.item, t = x.trip, key = t.startDate + '|' + t.label, year = String(t.endDate || t.startDate).slice(0, 4);
      plSetBucket_(String(b.ID), 'Visited', year);
      var dup = have.some(function(v) { return String(v.Country) === String(b.Country) && String(v.City || '') === String(b.City || '') && String(v['Trip Key'] || '') === key; });
      if (!dup) cs.appendRow(['c_' + Date.now() + '_' + b.ID, b.Country, b.City || '', Number(year), b.Traveller || 'Both', key, '', b.Occasion || '']);
    });
    return todo.length;
  });
}
