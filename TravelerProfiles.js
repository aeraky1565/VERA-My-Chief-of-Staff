// ============================================================
// VERA — TravelerProfiles.js
// Travel › Travelers › Profiles (issue #227, Profiles A): one person, many items.
// ============================================================
//
// The Traveler Items tab holds everything about how each of us travels, one row
// per item:
//   document    passports, visas and travel authorisations (ESTA, UK ETA, eTA,
//               e-Visa), national / Real ID, residence card
//   trusted     Global Entry, TSA PreCheck, NEXUS
//   membership  airline and hotel programmes: tier and alliance (balances stay
//               in Loyalty Programs)
//   preference  home airports, seat, cabin, longest layover, red-eyes, hotel bed
//               and room
//   health      diet, allergies, regular medication (linked to Prescriptions),
//               vaccines with their date
//   child       a child's passport, consent letter and car seat; offered only
//               once Family Planning is past the birth
//
// Privacy: no full document, Known Traveler or member number is ever stored.
// The server keeps the last 4 characters and nothing else, and any long run of
// digits typed into a label, value or note is cut down the same way. The full
// numbers stay in a wallet or password manager.
//
// The old Traveler Profiles tab (one row per passport) is copied in once
// (Script Property TP_MIGRATED) and then left alone. webGetProfiles_ now reads
// passports from here, so the visa check, the trip documents check and the
// Bucket List visa pills see the same people as before.
//
// Effects in this release:
//   - the trip documents check counts a visa or travel authorisation held for
//     that country, valid to the end of the trip, as covered
//   - nightly: a passport that runs out within 9 months, or that won't have
//     6 months left after a trip abroad; an ETA / ESTA that runs out before a
//     trip there; Global Entry / PreCheck / NEXUS 6 months before it runs out,
//     with the card perk that pays for the renewal
//
// Two layers: tp*_ pure helpers, then the sheet reads, the routes and the
// nightly step.
// ============================================================

var TP_MIGRATED_PROP_ = 'TP_MIGRATED';

var TP_SECTIONS_ = [
  { id: 'document', label: 'Documents', usedFor: 'Used for the visa and passport checks on every trip, and renewal reminders.',
    kinds: [['passport', 'Passport'], ['visa', 'Visa'], ['esta', 'ESTA'], ['eta', 'ETA'], ['evisa', 'e-Visa'], ['national_id', 'National ID'], ['real_id', 'Real ID'], ['residence', 'Residence card']] },
  { id: 'trusted', label: 'Trusted traveller', usedFor: 'Used for renewal reminders, paired with the card perk that pays for it.',
    kinds: [['global_entry', 'Global Entry'], ['precheck', 'TSA PreCheck'], ['nexus', 'NEXUS']] },
  { id: 'membership', label: 'Memberships', usedFor: 'Used to spot a booking without your member number, and lounge access by status.',
    kinds: [['airline', 'Airline'], ['hotel', 'Hotel']] },
  { id: 'preference', label: 'Travel preferences', usedFor: 'Used to check seats on bookings, to brief trip planning, and Always pack goes on every packing list.',
    kinds: [['home_airports', 'Home airports'], ['seat', 'Seat'], ['cabin', 'Cabin'], ['max_layover_h', 'Longest layover (hours)'], ['red_eyes', 'Red-eyes'], ['hotel_bed', 'Hotel bed'], ['hotel_room', 'Hotel room'], ['always_pack', 'Always pack']] },
  { id: 'health', label: 'Health & needs', usedFor: 'Used for refills before a trip, and the pre-trip briefing’s vaccines and allergy phrase.',
    kinds: [['diet', 'Diet'], ['allergy', 'Allergy'], ['medication', 'Regular medication'], ['vaccine', 'Vaccine']] },
  { id: 'contact', label: 'Contact', usedFor: 'Used for a trip’s Travel Day email, only on the trips where you switch this person on.',
    kinds: [['email', 'Email']] },
  { id: 'child', label: 'Children', usedFor: 'Shown once Family Planning is past the birth. A child’s passport lasts 5 years.',
    kinds: [['child_passport', 'Child passport'], ['consent_letter', 'Consent letter'], ['car_seat', 'Car seat']] },
];

// Documents that admit you to one country, and the country an ESTA is always for.
var TP_HELD_KINDS_ = { visa: 'Visa', esta: 'ESTA', eta: 'ETA', evisa: 'e-Visa' };

// ---- pure ---------------------------------------------------------------------

function tpStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }

function tpYmd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '').trim());
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

function tpDays_(from, to) {
  var p = function(s) { var x = s.split('-').map(Number); return Date.UTC(x[0], x[1] - 1, x[2]); };
  return Math.round((p(to) - p(from)) / 86400000);
}

function tpAddMonths_(ymd, n) {
  var x = ymd.split('-').map(Number), d = new Date(Date.UTC(x[0], x[1] - 1 + n, 1));
  var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(x[2], last));
  return d.toISOString().slice(0, 10);
}

/** The last 4 letters or digits of a number, nothing more. */
function tpLast4_(v) { return String(v == null ? '' : v).replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase(); }

/** Any run of 5 or more digits (spaces and dashes allowed between) becomes ••••1234. */
function tpScrub_(text) {
  return String(text == null ? '' : text).replace(/\d[\d \-]{3,}\d/g, function(run) {
    var d = run.replace(/\D/g, '');
    return d.length >= 5 ? '••••' + d.slice(-4) : run;
  });
}

function tpSection_(id) { return TP_SECTIONS_.filter(function(s) { return s.id === id; })[0] || null; }
function tpKindLabel_(section, kind) {
  var s = tpSection_(section), k = s && s.kinds.filter(function(x) { return x[0] === kind; })[0];
  return k ? k[1] : kind;
}

/**
 * A clean item from what the screen sent, or {error}. `trimmed` is true when a
 * longer number was cut down to its last 4.
 */
function tpClean_(b) {
  b = b || {};
  var section = tpStr_(b.section, 20), kind = tpStr_(b.kind, 30), person = tpStr_(b.person, 60);
  var s = tpSection_(section);
  if (!s) return { error: 'Which section is this for?' };
  if (!s.kinds.some(function(k) { return k[0] === kind; })) return { error: 'Pick what kind of item this is.' };
  if (!person) return { error: 'Whose is this?' };
  var raw = String(b.last4 == null ? '' : b.last4), last4 = tpLast4_(raw);
  var trimmed = raw.replace(/[^A-Za-z0-9]/g, '').length > 4;
  var fields = ['label', 'value', 'notes'], out = {};
  fields.forEach(function(f) {
    var v = tpStr_(b[f], f === 'notes' ? 500 : 200), sc = (kind === 'email' && f === 'value') ? v : tpScrub_(v);
    if (sc !== v) trimmed = true;
    out[f] = sc;
  });
  var issued = tpYmd_(b.issued), expiry = tpYmd_(b.expiry);
  if (issued && expiry && expiry < issued) return { error: 'It can’t expire before it was issued.' };
  if (kind === 'email' && !/^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/.test(out.value)) return { error: 'Enter the full email address.' };
  var country = tpStr_(b.country, 60);
  if (kind === 'esta' && !country) country = 'United States';
  if (TP_HELD_KINDS_[kind] && !country) return { error: 'Which country is it for?' };
  if ((kind === 'passport' || kind === 'child_passport') && !country) return { error: 'Which country issued the passport?' };
  return { item: { id: tpStr_(b.id, 40), person: person, section: section, kind: kind, label: out.label, country: country,
    last4: last4, issued: issued, expiry: expiry, tier: tpStr_(b.tier, 60), value: out.value, notes: out.notes }, trimmed: trimmed };
}

/** Old Traveler Profiles rows (with headers) → passport items, skipping any already copied. */
function tpFromOldProfiles_(rows, haveIds) {
  var h = (rows[0] || []).map(function(x) { return String(x).trim(); }), out = [];
  var col = function(r, name) { var i = h.indexOf(name); return i === -1 ? '' : r[i]; };
  rows.slice(1).forEach(function(r) {
    var oldId = tpStr_(col(r, 'ID'), 40), name = tpStr_(col(r, 'Name'), 60), country = tpStr_(col(r, 'Passport Country'), 60);
    if (!oldId || !name) return;
    var id = 'TI-' + oldId;
    if (haveIds[id]) return;
    var notes = [tpStr_(col(r, 'Special Docs'), 200), tpStr_(col(r, 'Notes'), 300)].filter(Boolean).join(' · ');
    out.push({ id: id, person: name, section: 'document', kind: 'passport', label: '', country: country,
      last4: '', issued: '', expiry: tpYmd_(col(r, 'Passport Expiry')), tier: '', value: '', notes: tpScrub_(notes) });
  });
  return out;
}

/** Passports in the shape the visa and trip documents checks have always read. */
function tpProfilesCompat_(items) {
  return (items || []).filter(function(i) { return i.section === 'document' && i.kind === 'passport'; }).map(function(i) {
    return { id: i.id, name: i.person, passportCountry: i.country, passportExpiry: i.expiry, specialDocs: '', notes: i.notes };
  });
}

/** Per person: the visas and travel authorisations held, by country. */
function tpHeld_(items) {
  var by = {};
  (items || []).forEach(function(i) {
    if (i.section !== 'document' || !TP_HELD_KINDS_[i.kind] || !i.country) return;
    (by[i.person] = by[i.person] || []).push({ kind: i.kind, label: TP_HELD_KINDS_[i.kind], country: i.country, expiry: i.expiry });
  });
  return by;
}

/**
 * The trip documents check, with what's held: a passport that would need a visa,
 * an eTA or an e-Visa for this country is covered when that traveller holds one
 * for it, valid to the end of the trip.
 */
function tpApplyHeld_(travelers, held, country, endDate) {
  var norm = function(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); };
  (travelers || []).forEach(function(t) {
    var doc = (held[t.name] || []).filter(function(d) {
      return norm(d.country) === norm(country) && (!d.expiry || !endDate || d.expiry >= endDate);
    })[0];
    if (!doc) return;
    (t.passports || []).forEach(function(p) {
      if (p.color !== 'yellow' && p.color !== 'red') return;
      if (/no admission/i.test(p.label || '')) return;
      p.held = { kind: doc.kind, expiry: doc.expiry };
      p.label = 'Held: ' + doc.label + (doc.expiry ? ' to ' + doc.expiry : '');
      p.color = 'green';
    });
  });
  return travelers;
}

/**
 * The reminders due today: [{key, flag, reason, urgency}].
 *   items  every Traveler Item
 *   trips  [{country, label, startDate, endDate}], stays abroad on upcoming trips
 *   perks  [{card, perk, availableFrom}] the cards that pay for Global Entry / PreCheck
 */
function tpRemindersDue_(items, trips, today, perks, cfg) {
  cfg = cfg || {};
  var leadM = Number(cfg.tp_passport_lead_months) || 9, out = [];
  var horizon = tpAddMonths_(today, leadM);
  (items || []).forEach(function(i) {
    if (!i.expiry || i.expiry < today) return;
    var who = i.person + '’s ', what = tpKindLabel_(i.section, i.kind);
    if (i.kind === 'passport' || i.kind === 'child_passport') {
      if (i.expiry <= horizon)
        out.push({ key: 'tp_passport_' + i.id + '_' + i.expiry, urgency: tpDays_(today, i.expiry) <= 120 ? 'High' : 'Medium',
          flag: who + (i.country ? i.country + ' ' : '') + 'passport runs out ' + i.expiry,
          reason: 'Renew it now: renewals can take months, and many countries want 6 months left. Then update it in Travel › Travelers › Profiles.' });
      // A trip abroad that this passport won't have 6 months left after.
      (trips || []).forEach(function(t) {
        var end = t.endDate || t.startDate;
        if (!end || t.startDate > horizon || t.startDate < today) return;
        if (tpAddMonths_(end, 6) <= i.expiry) return;
        out.push({ key: 'tp_passport_trip_' + i.id + '_' + i.expiry + '_' + t.startDate, urgency: 'High',
          flag: who + 'passport is short for ' + t.label,
          reason: 'It runs out ' + i.expiry + ', under 6 months after you get back from ' + t.country + '. Renew it before the trip.' });
      });
    }
    if (TP_HELD_KINDS_[i.kind] && i.section === 'document') {
      (trips || []).forEach(function(t) {
        if (String(t.country).toLowerCase() !== String(i.country).toLowerCase()) return;
        var end = t.endDate || t.startDate;
        if (t.startDate < today || i.expiry >= end) return;
        out.push({ key: 'tp_held_' + i.id + '_' + i.expiry + '_' + t.startDate, urgency: 'High',
          flag: who + what + ' for ' + i.country + ' runs out before ' + t.label,
          reason: 'It runs out ' + i.expiry + '; the trip ends ' + end + '. Apply for a new one before you go.' });
      });
    }
    if (i.section === 'trusted') {
      var d = tpDays_(today, i.expiry);
      if (d > 183) return;
      var pay = (perks || []).filter(function(p) { return /global entry|pre ?check|nexus/i.test(p.perk); })[0];
      var payLine = pay ? (pay.availableFrom && pay.availableFrom > today
        ? ' The ' + pay.card + ' credit is available again from ' + pay.availableFrom + '.'
        : ' Pay with the ' + pay.card + ': its credit covers it.') : '';
      out.push({ key: 'tp_trusted_' + i.id + '_' + i.expiry, urgency: d <= 60 ? 'High' : 'Medium',
        flag: who + what + ' runs out ' + i.expiry,
        reason: 'Renew it up to a year ahead; you keep it while the renewal is pending.' + payLine });
    }
  });
  return out;
}

/** Whether the Children section applies: after the birth, by Family Planning. */
function tpHasChild_(fp, today) {
  fp = fp || {};
  if (fp.phase === 'leave' || fp.phase === 'back') return true;
  return !!(fp.dueDate && fp.dueDate <= today && fp.phase !== 'plan' && fp.phase !== 'trying');
}

// ---- sheets -------------------------------------------------------------------

function tpSchema_(sheet, headers) {
  if (!sheet) return sheet;
  var have = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(have[i] == null ? '' : have[i]).trim() !== headers[i]) { sheet.getRange(1, 1, 1, headers.length).setValues([headers]); break; }
  }
  return sheet;
}

function tpSheet_() { return tpSchema_(ensureSheet(getSpreadsheet(), TABS.TRAVELER_ITEMS, TRAVELER_ITEM_HEADERS), TRAVELER_ITEM_HEADERS); }

function tpLocked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function tpToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function tpRowOut_(i) {
  return [i.id, i.person, i.section, i.kind, i.label, i.country, i.last4, i.issued, i.expiry, i.tier, i.value, i.notes, new Date().toISOString()];
}

/** Every item, oldest first, each with its sheet row. */
function tpRead_() {
  var sh = tpSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, TRAVELER_ITEM_HEADERS.length).getValues().map(function(r, i) {
    return { _row: i + 2, id: tpStr_(r[0], 40), person: tpStr_(r[1], 60), section: tpStr_(r[2], 20), kind: tpStr_(r[3], 30),
      label: tpStr_(r[4]), country: tpStr_(r[5], 60), last4: tpStr_(r[6], 4), issued: tpYmd_(r[7]), expiry: tpYmd_(r[8]),
      tier: tpStr_(r[9], 60), value: tpStr_(r[10]), notes: tpStr_(r[11], 500) };
  }).filter(function(i) { return i.id; });
}

/** The one-time copy of the old Traveler Profiles tab. Safe to call every time. */
function tpMigrateOnce_() {
  var props = PropertiesService.getScriptProperties();
  if (veraOnceGet_(TP_MIGRATED_PROP_)) return 0;
  return tpLocked_(function() {
    if (veraOnceGet_(TP_MIGRATED_PROP_)) return 0;
    var old = getSpreadsheet().getSheetByName(TABS.TRAVELER_PROFILES), n = 0;
    if (old && old.getLastRow() >= 2) {
      var have = {};
      tpRead_().forEach(function(i) { have[i.id] = 1; });
      var add = tpFromOldProfiles_(old.getDataRange().getValues(), have), sh = tpSheet_();
      add.forEach(function(i) { sh.appendRow(tpRowOut_(i)); });
      n = add.length;
    }
    veraOnceSet_(TP_MIGRATED_PROP_, new Date().toISOString() + ' copied ' + n);
    return n;
  });
}

function tpItems_() { try { tpMigrateOnce_(); } catch (e) { Logger.log('tpMigrateOnce_: ' + e.message); } return tpRead_(); }

function tpPerks_() {
  var sh = getSpreadsheet().getSheetByName(TABS.CARD_PERKS), out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  var today = tpToday_();
  sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().forEach(function(r) {
    if (!/global entry|pre ?check|nexus/i.test(String(r[2]))) return;
    var from = null;
    try { var y = typeof perkCycleYears_ === 'function' ? perkCycleYears_(r[4]) : 4; var d = cardPerkEligibleFrom_(tpYmd_(r[6]), y || 4); from = d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : null; } catch (e) {}
    out.push({ card: tpStr_(r[1], 80), perk: tpStr_(r[2], 80), availableFrom: from && from > today ? from : '' });
  });
  return out;
}

// ---- routes -------------------------------------------------------------------

/** The passports, in the old profile shape, for the visa and trip documents checks. */
function webGetProfiles_() { return { ok: true, profiles: tpProfilesCompat_(tpItems_()) }; }

/** Old route save_profile {id?, name, passportCountry, passportExpiry, notes}: saves a passport item. */
function webSaveProfile_(e) {
  var p = (e && e.parameter) || {};
  if (!tpStr_(p.name) || !tpStr_(p.passportCountry)) return { ok: false, error: 'name and passportCountry required' };
  return webTpSave_({ id: p.id, person: p.name, section: 'document', kind: 'passport', country: p.passportCountry,
    expiry: p.passportExpiry, notes: [p.specialDocs, p.notes].filter(Boolean).join(' · ') });
}

function webDeleteProfile_(e) { return webTpDelete_({ id: ((e && e.parameter) || {}).id }); }

/** GET tp_get: everyone's items by section, the sections, and what each is used for. */
function webTpGet_() {
  var items = tpItems_(), today = tpToday_(), people = [], seen = {};
  items.forEach(function(i) { if (!seen[i.person]) { seen[i.person] = 1; people.push(i.person); } });
  var fp = {};
  try { fp = typeof fpReadSettings_ === 'function' ? fpReadSettings_() : {}; } catch (e) {}
  var rx = [];
  try {
    if (typeof webGetPrescriptions_ === 'function') rx = ((webGetPrescriptions_() || {}).prescriptions || []).map(function(r) {
      return { id: String(r.id || ''), person: String(r.person || ''), medication: String(r.medication || ''), refillDate: tpYmd_(r.refillDate) };
    });
  } catch (e) {}
  return { ok: true, today: today, people: people, hasChild: tpHasChild_(fp, today), prescriptions: rx,
    sections: TP_SECTIONS_.map(function(s) { return { id: s.id, label: s.label, usedFor: s.usedFor, kinds: s.kinds }; }),
    items: items.map(function(i) { var o = Object.assign({}, i); delete o._row; return o; }) };
}

/** POST tp_save: add or update one item. Long numbers are cut to their last 4. */
function webTpSave_(body) {
  var c = tpClean_(body);
  if (c.error) return { ok: false, error: c.error };
  var it = c.item;
  return tpLocked_(function() {
    var sh = tpSheet_(), have = it.id ? tpRead_().filter(function(x) { return x.id === it.id; })[0] : null;
    if (it.id && !have) return { ok: false, error: 'That item is gone; refresh and try again.' };
    if (have) sh.getRange(have._row, 1, 1, TRAVELER_ITEM_HEADERS.length).setValues([tpRowOut_(it)]);
    else { it.id = 'TI-' + Date.now(); sh.appendRow(tpRowOut_(it)); }
    return { ok: true, id: it.id, trimmed: c.trimmed, note: c.trimmed ? 'Kept the last 4 only.' : '' };
  });
}

/** POST tp_delete {id}. */
function webTpDelete_(body) {
  var id = tpStr_(body && body.id, 40);
  if (!id) return { ok: false, error: 'id required' };
  return tpLocked_(function() {
    var have = tpRead_().filter(function(x) { return x.id === id; })[0];
    if (!have) return { ok: false, error: 'not found' };
    tpSheet_().deleteRow(have._row);
    return { ok: true, id: id };
  });
}

// ---- nightly ------------------------------------------------------------------

/** Passport, travel authorisation and trusted-traveller reminders, each once. */
function tpNightly_() {
  var items = tpItems_();
  if (!items.length) return 'no items';
  var trips = [];
  try { trips = typeof plPlanned_ === 'function' ? plPlanned_() : []; } catch (e) { Logger.log('tpNightly_ trips: ' + e.message); }
  var perks = [];
  try { perks = tpPerks_(); } catch (e) {}
  var due = tpRemindersDue_(items, trips, tpToday_(), perks, getConfigValues());
  if (!due.length) return '0 reminders';
  writeFlags(due.map(function(x) { return { source: 'Travel', flag: x.flag, reason: x.reason, urgency: x.urgency, key: x.key }; }));
  var sent = 0;
  due.forEach(function(x) {
    if (wasRecentlySent_(x.key, 60 * 24 * 365)) return;
    sendNudge_(x.key, x.flag, '🛂 ' + x.flag + '\n' + x.reason, 'travel_docs');
    sent++;
  });
  return due.length + ' due, ' + sent + ' sent';
}
