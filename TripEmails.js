// ============================================================
// VERA — TripEmails.js
// Who's travelling, and who gets each trip's Travel Day email (issue #233).
// ============================================================
//
// Who's travelling: people from Travel › Travelers › Profiles, kept in TripMeta's
// Traveler column as a list of names ("Ahmed, Victoria"). The column used to hold
// one word (Ahmed / Victoria / Both); an old value is read as before, Both meaning
// the two of you, and nothing is rewritten until a trip is edited.
//
// Who gets the Travel Day email (only that email; the 48-hour, night-before and
// after-trip emails stay yours):
//   you        always, on trips you travel on (CONFIG.MORNING_NUDGE_EMAIL)
//   Victoria   on trips she travels on, only when switched on for that trip; her
//              address always comes from Config victoria_email
//   travellers anyone else travelling with an Email on their profile, the same way
//   added      anyone else, added per trip (from the Address Book or typed)
// Victoria's solo trips send no Travel Day email. Test sends go to you only.
//
// The Trips tab's new Email Recipients column holds the switched-on travellers'
// names and the added addresses, separated by ";". Config travel_companions is no
// longer read: System › Trip emails offers its addresses once (Script Property
// TE_LEGACY_DONE), to add to every upcoming trip or to dismiss.
//
// Two layers: te*_ pure helpers, then the reads, the routes and the email hook.
// ============================================================

var TE_OWNER_ = 'Ahmed';
var TE_PARTNER_ = 'Victoria';
var TE_LEGACY_PROP_ = 'TE_LEGACY_DONE';

// ---- pure ---------------------------------------------------------------------

function teStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }

function teEmailOk_(s) { return /^[^\s@,;<>"]+@[^\s@,;<>".]+(\.[^\s@,;<>".]+)*\.[A-Za-z]{2,}$/.test(String(s || '').trim()); }

function teSame_(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

/** The trip's travellers from the Traveler cell: a list of names, or an old one-word value. */
function teTravellersFrom_(value, profileNames) {
  var v = teStr_(value, 400);
  if (!v) return [];
  if (/^both$/i.test(v)) return [TE_OWNER_, TE_PARTNER_];
  var names = profileNames || [], out = [];
  v.split(/\s*[,;]\s*|\s+and\s+|\s*&\s*/i).forEach(function(n) {
    n = teStr_(n, 60);
    if (!n) return;
    var known = names.filter(function(p) { return teSame_(p, n); })[0];
    n = known || n;
    if (!out.some(function(x) { return teSame_(x, n); })) out.push(n);
  });
  return out;
}

/** The Email Recipients cell → its tokens (names and addresses), no repeats. */
function teTokens_(cell) {
  var out = [];
  String(cell == null ? '' : cell).split(/\s*[;,\n]\s*/).forEach(function(t) {
    t = teStr_(t, 200);
    if (t && !out.some(function(x) { return teSame_(x, t); })) out.push(t);
  });
  return out;
}

/**
 * Who gets this trip's Travel Day email.
 * o = {travellers, tokens, ownerEmail, partnerEmail, profileEmails: {name: email}}
 * → {solo, list: [{name, email, source: always|traveller|added, on, missing}], to: [emails]}
 * solo: travellers are set and you aren't one of them, so no email goes.
 */
function teResolve_(o) {
  o = o || {};
  var travellers = o.travellers || [], tokens = o.tokens || [];
  var youTravel = !travellers.length || travellers.some(function(t) { return teSame_(t, TE_OWNER_); });
  var list = [{ name: 'You', email: o.ownerEmail || '', source: 'always', on: true }];
  travellers.forEach(function(t) {
    if (teSame_(t, TE_OWNER_)) return;
    var email = teSame_(t, TE_PARTNER_) ? (o.partnerEmail || '') : ((o.profileEmails || {})[t] || '');
    var on = tokens.some(function(x) { return teSame_(x, t); });
    list.push({ name: t, email: email, source: 'traveller', on: on, missing: !email });
  });
  tokens.forEach(function(t) {
    if (!teEmailOk_(t)) return;
    // An address that is already a traveller's (Victoria's, from Config) switches that traveller on.
    var hit = list.filter(function(x) { return teSame_(x.email, t); })[0];
    if (hit) { hit.on = true; return; }
    list.push({ name: t, email: t, source: 'added', on: true });
  });
  if (!youTravel) return { solo: true, list: list, to: [] };
  var to = [];
  list.forEach(function(x) { if (x.on && x.email && teEmailOk_(x.email) && !to.some(function(e) { return teSame_(e, x.email); })) to.push(x.email.trim()); });
  return { solo: false, list: list, to: to };
}

/** Cleans what the screen sent: names of travellers who are travelling, and valid addresses. */
function teCleanTokens_(tokens, travellers) {
  var out = [], bad = [];
  (tokens || []).forEach(function(t) {
    t = teStr_(t, 200);
    if (!t) return;
    if (t.indexOf('@') !== -1) { if (teEmailOk_(t)) { if (!out.some(function(x) { return teSame_(x, t); })) out.push(t); } else bad.push(t); return; }
    var n = (travellers || []).filter(function(p) { return teSame_(p, t); })[0];
    if (n && !teSame_(n, TE_OWNER_) && !out.some(function(x) { return teSame_(x, n); })) out.push(n);
  });
  return { tokens: out, bad: bad };
}

function teLegacy_(cfgValue) {
  return teTokens_(cfgValue).filter(teEmailOk_);
}

// ---- reads --------------------------------------------------------------------

function teToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function teProfiles_() {
  var names = [], emails = {};
  try {
    (typeof tpItems_ === 'function' ? tpItems_() : []).forEach(function(i) {
      if (i.section === 'child') return;
      if (!names.some(function(n) { return teSame_(n, i.person); })) names.push(i.person);
      if (i.section === 'contact' && i.kind === 'email' && teEmailOk_(i.value) && !emails[i.person]) emails[i.person] = i.value.trim();
    });
  } catch (e) { Logger.log('teProfiles_: ' + e.message); }
  [TE_OWNER_, TE_PARTNER_].forEach(function(n) { if (!names.some(function(x) { return teSame_(x, n); })) names.push(n); });
  return { names: names, emails: emails };
}

function teTravellersForKey_(tripKey, profileNames) {
  try {
    var m = webGetTripMeta_({ parameter: { tripKey: tripKey } });
    return teTravellersFrom_(m && m.traveler, profileNames || teProfiles_().names);
  } catch (e) { return []; }
}

function teTripRec_(tripKey) {
  var id = '';
  try { id = tripIdForKey_(tripKey); } catch (e) {}
  if (!id) return null;
  return readTripRegistry_().byId[id] || null;
}

/** One trip's whole picture: travellers, tokens, and who gets the email. */
function teTrip_(rec, prof) {
  var tripKey = rec.startDate + '|' + rec.label;
  var travellers = teTravellersForKey_(tripKey, prof.names), tokens = teTokens_(rec.recipients);
  var r = teResolve_({ travellers: travellers, tokens: tokens, ownerEmail: CONFIG.MORNING_NUDGE_EMAIL,
    partnerEmail: teStr_(getConfigValues()['victoria_email'], 200), profileEmails: prof.emails });
  return { tripId: rec.tripId, tripKey: tripKey, label: rec.label, startDate: rec.startDate, endDate: rec.endDate,
    travellers: travellers, tokens: tokens, solo: r.solo,
    list: r.list.map(function(x) { return { name: x.name, email: x.source === 'added' ? x.email : '', source: x.source, on: x.on, missing: !!x.missing }; }),
    count: r.to.length };
}

/** The Travel Day email's To list for a trip key: [] means none goes (a trip you're not on). */
function teRecipientsFor_(tripKey) {
  var owner = CONFIG.MORNING_NUDGE_EMAIL;
  var rec = teTripRec_(tripKey), prof = teProfiles_();
  var travellers = teTravellersForKey_(tripKey, prof.names);
  var r = teResolve_({ travellers: travellers, tokens: teTokens_(rec && rec.recipients), ownerEmail: owner,
    partnerEmail: teStr_(getConfigValues()['victoria_email'], 200), profileEmails: prof.emails });
  return r.to;
}

function teUpcoming_() {
  var today = teToday_();
  return (readTripRegistry_().rows || []).filter(function(t) {
    return t.label && t.startDate && (t.endDate || t.startDate) >= today && !/cancel|merged|deleted|archived/i.test(t.status || '');
  }).sort(function(a, b) { return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0; });
}

function teWriteTokens_(rec, tokens) {
  getTripsSheet_().getRange(rec._row, TRIPS_HEADERS.indexOf('Email Recipients') + 1).setValue(tokens.join('; '));
  invalidateTripRegistry_();
}

function teLocked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---- routes -------------------------------------------------------------------

/** GET te_get: every upcoming trip, the people with profiles, and the retired list (once). */
function webTeGet_() {
  var prof = teProfiles_(), cfg = getConfigValues();
  var legacy = PropertiesService.getScriptProperties().getProperty(TE_LEGACY_PROP_) ? [] : teLegacy_(cfg['travel_companions']);
  return { ok: true, today: teToday_(), partnerSet: teEmailOk_(cfg['victoria_email']),
    people: prof.names.map(function(n) { return { name: n, you: teSame_(n, TE_OWNER_), hasEmail: teSame_(n, TE_PARTNER_) ? teEmailOk_(cfg['victoria_email']) : !!prof.emails[n] }; }),
    legacy: legacy, trips: teUpcoming_().map(function(t) { return teTrip_(t, prof); }) };
}

/** GET te_trip {tripKey}: one trip, for its summary. */
function webTeTrip_(p) {
  var rec = teTripRec_(String((p && p.tripKey) || ''));
  if (!rec) return { ok: true, found: false };
  var prof = teProfiles_(), cfg = getConfigValues();
  return { ok: true, found: true, trip: teTrip_(rec, prof), partnerSet: teEmailOk_(cfg['victoria_email']),
    people: prof.names.map(function(n) { return { name: n, you: teSame_(n, TE_OWNER_), hasEmail: teSame_(n, TE_PARTNER_) ? teEmailOk_(cfg['victoria_email']) : !!prof.emails[n] }; }) };
}

/** POST te_set {tripKey, travellers?: [names], tokens?: [names and addresses]}. */
function webTeSet_(body) {
  body = body || {};
  var rec = teTripRec_(String(body.tripKey || ''));
  if (!rec) return { ok: false, error: 'That trip isn’t on the Trips tab yet.' };
  var tripKey = rec.startDate + '|' + rec.label, prof = teProfiles_();
  var travellers = Array.isArray(body.travellers) ? teTravellersFrom_(body.travellers.join(', '), prof.names) : teTravellersForKey_(tripKey, prof.names);
  var tokens = Array.isArray(body.tokens) ? body.tokens : teTokens_(rec.recipients);
  var c = teCleanTokens_(tokens, travellers);
  if (c.bad.length) return { ok: false, error: 'That doesn’t look like a full email address: ' + c.bad[0] };
  return teLocked_(function() {
    if (Array.isArray(body.travellers)) webSetTripMeta_({ parameter: { tripKey: tripKey, traveler: travellers.join(', ') } });
    teWriteTokens_(rec, c.tokens);
    var fresh = readTripRegistry_().byId[rec.tripId] || rec;
    return { ok: true, trip: teTrip_(fresh, prof) };
  });
}

/** POST te_legacy {mode: 'add' | 'dismiss'}: the retired shared list, once. */
function webTeLegacy_(body) {
  var props = PropertiesService.getScriptProperties();
  var legacy = teLegacy_(getConfigValues()['travel_companions']), added = 0;
  return teLocked_(function() {
    if (body && body.mode === 'add' && legacy.length) {
      var prof = teProfiles_();
      teUpcoming_().forEach(function(t) {
        var tripKey = t.startDate + '|' + t.label;
        var travellers = teTravellersForKey_(tripKey, prof.names);
        if (travellers.length && !travellers.some(function(x) { return teSame_(x, TE_OWNER_); })) return;
        var tokens = teTokens_(t.recipients), before = tokens.length;
        legacy.forEach(function(e) { if (!tokens.some(function(x) { return teSame_(x, e); })) tokens.push(e); });
        if (tokens.length !== before) { teWriteTokens_(t, tokens); added++; }
      });
    }
    props.setProperty(TE_LEGACY_PROP_, new Date().toISOString() + ' ' + ((body && body.mode) || 'dismiss') + ' ' + added);
    return { ok: true, trips: added };
  });
}
