// ============================================================
// VERA — TripReadiness.js
// Each trip's readiness, per traveller (issue #227, Profiles B): what the profile
// changes on a trip.
// ============================================================
//
// GET trip_readiness {tripKey, startDate, endDate} answers, per traveller with a
// profile, rows of {state: blocks | todo | ready, area, text, action?}:
//   documents   from the trip documents check (red blocks, amber is to do)
//   bookings    a flight or hotel without your member number (the loyalty
//               number the email parser reads), or with someone else's
//   seats       a seat that isn't the kind you prefer (window / aisle / front)
//   lounge      lounge access by airline status, beside access by card
//   medication  a linked prescription whose refill falls before the trip ends;
//               "Add to packing" puts the refill on the packing list
// and, per country, health notes for the pre-trip briefing: the vaccines the
// destination usually calls for and an allergy phrase in the local language,
// one Claude call per country and set of allergies, kept in Trip Health Notes.
//
// VERA writes nothing to ARIA's sheet: preferences reach ARIA only through its
// own stored instructions, changed with Ahmed's approval.
//
// Two layers: trd*_ pure helpers, then the reads and the routes.
// ============================================================

var TRD_AIRLINES_ = {
  UA: ['united', 'star'], LH: ['lufthansa', 'star'], AC: ['air canada', 'star'], TP: ['tap', 'star'], NH: ['ana', 'star'], SQ: ['singapore', 'star'],
  TK: ['turkish', 'star'], LX: ['swiss', 'star'], OS: ['austrian', 'star'], SK: ['sas', 'star'], ET: ['ethiopian', 'star'], MS: ['egyptair', 'star'],
  AA: ['american', 'oneworld'], BA: ['british', 'oneworld'], AS: ['alaska', 'oneworld'], QR: ['qatar', 'oneworld'], IB: ['iberia', 'oneworld'],
  CX: ['cathay', 'oneworld'], JL: ['japan airlines', 'oneworld'], QF: ['qantas', 'oneworld'], AY: ['finnair', 'oneworld'], RJ: ['royal jordanian', 'oneworld'],
  DL: ['delta', 'skyteam'], AF: ['air france', 'skyteam'], KL: ['klm', 'skyteam'], KE: ['korean', 'skyteam'], AM: ['aeromexico', 'skyteam'], SV: ['saudia', 'skyteam'],
  B6: ['jetblue', ''], WN: ['southwest', ''], EK: ['emirates', ''], EY: ['etihad', ''], VS: ['virgin atlantic', ''],
};
var TRD_ALLIANCE_ = { 'star alliance': 'star', star: 'star', oneworld: 'oneworld', skyteam: 'skyteam' };
var TRD_HOTELS_ = ['marriott', 'bonvoy', 'hilton', 'hyatt', 'ihg', 'holiday inn', 'intercontinental', 'accor', 'wyndham', 'choice', 'best western', 'radisson'];
// Status that opens partner lounges on international trips: Star Gold, oneworld Sapphire / Emerald, SkyTeam Elite Plus.
var TRD_LOUNGE_TIER_ = /\b(gold|platinum|1k|diamond|emerald|sapphire|elite plus|executive|senator|hon)\b/i;
var TRD_ALLIANCE_TIER_ = { star: 'Star Alliance Gold', oneworld: 'oneworld Sapphire', skyteam: 'SkyTeam Elite Plus' };

// ---- pure ---------------------------------------------------------------------

function trdStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function trdMeta_(m) { if (m && typeof m === 'object') return m; try { return JSON.parse(String(m || '') || '{}') || {}; } catch (e) { return {}; } }
function trdLast4_(v) { return String(v == null ? '' : v).replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase(); }

/** The airline of a flight row: its two-letter code and alliance, from the metadata or the title. */
function trdAirline_(it) {
  var m = trdMeta_(it.metadata), code = '';
  var fn = String(m.flightNum || m.flightNumber || it.title || '').toUpperCase().match(/\b([A-Z0-9]{2})\s?\d{1,4}\b/);
  if (fn && TRD_AIRLINES_[fn[1]]) code = fn[1];
  if (!code && m.airline) {
    var a = String(m.airline).toLowerCase();
    Object.keys(TRD_AIRLINES_).some(function(k) { if (a.indexOf(TRD_AIRLINES_[k][0]) !== -1) { code = k; return true; } return false; });
  }
  return code ? { code: code, name: TRD_AIRLINES_[code][0], alliance: TRD_AIRLINES_[code][1] } : null;
}

/** Whether a membership (by its programme name and alliance) earns on this airline. */
function trdMemberFor_(mem, air) {
  if (!air) return false;
  var label = String(mem.label || '').toLowerCase(), al = TRD_ALLIANCE_[String(mem.value || '').toLowerCase()] || '';
  if (label.indexOf(air.name) !== -1 || label.split(/\W+/).indexOf(air.code.toLowerCase()) !== -1) return 'own';
  if (al && air.alliance && al === air.alliance) return 'partner';
  return false;
}

function trdHotelBrand_(text) {
  var t = String(text || '').toLowerCase();
  return TRD_HOTELS_.filter(function(b) { return t.indexOf(b) !== -1; })[0] || '';
}

/** A seat's kind: window, aisle or middle, and its row. */
function trdSeat_(seat) {
  var m = String(seat || '').toUpperCase().match(/^(\d{1,2})([A-L])$/);
  if (!m) return null;
  var l = m[2], kind = /[AFKL]/.test(l) ? 'window' : /[CDGH]/.test(l) ? 'aisle' : 'middle';
  return { row: +m[1], letter: l, kind: kind };
}

function trdIsPerson_(traveler, person) {
  var t = String(traveler || '').toLowerCase(), p = String(person || '').toLowerCase().split(' ')[0];
  return !t || !p || t.indexOf(p) !== -1 || /both|all|everyone/.test(t);
}

/**
 * Readiness per traveller. o = {items, itinerary, documents, rx, packing, loungeCards, today, endDate}.
 * Returns [{person, state, rows:[{state, area, text, action?}]}], blocking rows first.
 */
function trdReadiness_(o) {
  o = o || {};
  var items = o.items || [], people = [], seen = {};
  items.forEach(function(i) { if (i.section !== 'child' && !seen[i.person]) { seen[i.person] = 1; people.push(i.person); } });
  var flights = (o.itinerary || []).filter(function(it) { return String(it.type).toLowerCase() === 'flight'; });
  var hotels = (o.itinerary || []).filter(function(it) { return String(it.type).toLowerCase() === 'hotel'; });
  var abroad = !!(o.documents && (o.documents.countries || []).length);
  var rank = { blocks: 0, todo: 1, ready: 2 };
  return people.map(function(person) {
    var mine = items.filter(function(i) { return i.person === person; }), rows = [];
    var add = function(state, area, text, action) { rows.push(action ? { state: state, area: area, text: text, action: action } : { state: state, area: area, text: text }); };
    // documents
    ((o.documents || {}).countries || []).forEach(function(c) {
      var t = (c.travelers || []).filter(function(x) { return x.name === person; })[0];
      if (!t) return;
      var p = (t.passports || []).filter(function(x) { return x.use; })[0] || (t.passports || [])[0];
      if (!p) return;
      var ps = (p.passport || {}).status;
      if (p.color === 'red') add('blocks', 'documents', c.country + ': ' + p.label + ' on the ' + p.passportCountry + ' passport');
      else if (ps === 'expires') add('blocks', 'documents', 'The ' + p.passportCountry + ' passport runs out before you’re back from ' + c.country);
      else if (p.color === 'yellow') add('todo', 'documents', c.country + ': ' + p.label + ' needed on the ' + p.passportCountry + ' passport');
      else if (ps === 'short') add('todo', 'documents', c.country + ': the ' + p.passportCountry + ' passport is short of the months it asks for');
      else add('ready', 'documents', c.country + ': ' + (p.held ? p.label : 'documents in order'));
    });
    // bookings: member numbers
    var mems = mine.filter(function(i) { return i.section === 'membership'; });
    flights.forEach(function(f) {
      var m = trdMeta_(f.metadata);
      if (!trdIsPerson_(m.traveler, person)) return;
      var air = trdAirline_(f);
      var mem = mems.filter(function(x) { return x.kind === 'airline' && trdMemberFor_(x, air) === 'own'; })[0] || mems.filter(function(x) { return x.kind === 'airline' && trdMemberFor_(x, air); })[0];
      if (!mem) return;
      var have = trdLast4_(m.loyaltyNumber), name = f.title || 'this flight';
      if (!have) add('todo', 'bookings', 'Member number missing on ' + name + ': add your ' + (mem.label || 'programme') + (mem.last4 ? ' (••' + mem.last4 + ')' : '') + ' number');
      else if (mem.last4 && have !== mem.last4) add('todo', 'bookings', name + ' has number ••' + have + ', not your ' + (mem.label || 'programme') + ' ••' + mem.last4);
      else add('ready', 'bookings', name + ': ' + (mem.label || 'member') + ' number on the booking');
    });
    hotels.forEach(function(ht) {
      var m = trdMeta_(ht.metadata), brand = trdHotelBrand_(ht.title + ' ' + (m.brand || '') + ' ' + (m.chain || ''));
      if (!brand || !trdIsPerson_(m.traveler, person)) return;
      var mem = mems.filter(function(x) { return x.kind === 'hotel' && String(x.label).toLowerCase().indexOf(brand) !== -1; })[0];
      if (!mem) return;
      var have = trdLast4_(m.loyaltyNumber);
      if (!have) add('todo', 'bookings', 'Member number missing on ' + ht.title + ': add your ' + mem.label + (mem.last4 ? ' (••' + mem.last4 + ')' : '') + ' number');
      else if (mem.last4 && have !== mem.last4) add('todo', 'bookings', ht.title + ' has number ••' + have + ', not your ' + mem.label + ' ••' + mem.last4);
      else add('ready', 'bookings', ht.title + ': ' + mem.label + ' number on the booking');
    });
    // seats
    var pref = (mine.filter(function(i) { return i.section === 'preference' && i.kind === 'seat'; })[0] || {}).value || '';
    pref = String(pref).toLowerCase();
    if (pref) flights.forEach(function(f) {
      var m = trdMeta_(f.metadata);
      if (!trdIsPerson_(m.traveler, person)) return;
      var s = trdSeat_(m.seatAssignment || m.seat);
      var name = f.title || 'this flight';
      if (!s) { add('todo', 'seats', 'No seat yet on ' + name + ' (you prefer ' + pref + ')'); return; }
      var wantKind = /window/.test(pref) ? 'window' : /aisle/.test(pref) ? 'aisle' : '';
      var wantFront = /front/.test(pref);
      if ((wantKind && s.kind !== wantKind) || (wantFront && s.row > 12))
        add('todo', 'seats', 'Seat ' + s.row + s.letter + ' on ' + name + ' is ' + (s.kind === 'middle' ? 'a middle' : s.kind === 'aisle' ? 'an aisle' : 'a window') + (wantFront && s.row > 12 ? ' in row ' + s.row : '') + '; you prefer ' + pref);
      else add('ready', 'seats', 'Seat ' + s.row + s.letter + ' on ' + name);
    });
    // lounge by status (international trips)
    if (abroad && flights.length) {
      var shown = {};
      mems.forEach(function(x) {
        if (x.kind !== 'airline' || !TRD_LOUNGE_TIER_.test(x.tier || '')) return;
        var al = TRD_ALLIANCE_[String(x.value || '').toLowerCase()] || '';
        var on = flights.some(function(f) { var air = trdAirline_(f); return air && (trdMemberFor_(x, air) === 'own' || (al && air.alliance === al)); });
        if (!on || shown[al || x.label]) return;
        shown[al || x.label] = 1;
        add('ready', 'lounge', 'Lounge by status: ' + (x.label || 'airline') + ' ' + x.tier + (al ? ' (' + TRD_ALLIANCE_TIER_[al] + ')' : ''));
      });
    }
    // medication
    var packed = (o.packing || []).map(function(p) { return String(p.item || '').toLowerCase(); });
    mine.filter(function(i) { return i.section === 'health' && i.kind === 'medication' && i.value; }).forEach(function(i) {
      var rx = (o.rx || []).filter(function(r) { return r.id === i.value; })[0];
      if (!rx || !rx.refillDate || !o.endDate || rx.refillDate > o.endDate) return;
      var med = rx.medication || i.label || 'your medication';
      if (packed.some(function(p) { return p.indexOf(med.toLowerCase()) !== -1 && /refill/.test(p); }))
        add('ready', 'medication', med + ' refill is on the packing list');
      else add('todo', 'medication', 'Refill ' + med + ' before you go (due ' + rx.refillDate + ')', { kind: 'pack', item: 'Refill ' + med + ' before leaving', person: person });
    });
    rows.sort(function(a, b) { return rank[a.state] - rank[b.state]; });
    var state = rows.some(function(r) { return r.state === 'blocks'; }) ? 'blocks' : rows.some(function(r) { return r.state === 'todo'; }) ? 'todo' : 'ready';
    return { person: person, state: state, rows: rows };
  });
}

/** Lounge access by card, for the whole trip: [{program, card}] → lines. */
function trdCardLounges_(list) {
  var seen = {};
  return (list || []).filter(function(x) { var k = x.program; if (!k || seen[k]) return false; seen[k] = 1; return true; })
    .map(function(x) { return 'Lounge by card: ' + x.program + ' (' + x.card + ')'; });
}

/** The allergies and diets in everyone's profiles, sorted, for one health-notes key. */
function trdAllergies_(items) {
  var out = {};
  (items || []).forEach(function(i) { if (i.section === 'health' && (i.kind === 'allergy' || i.kind === 'diet') && i.label && !out[i.label.toLowerCase()]) out[i.label.toLowerCase()] = i.label; });
  return Object.keys(out).sort().map(function(k) { return out[k]; });
}

function trdHealthKey_(country, allergies) { return String(country).toLowerCase().trim() + '|' + (allergies || []).map(function(a) { return a.toLowerCase(); }).join(','); }

/** Claude's answer, cleaned: {vaccines:[≤6 short], phrase:{language, text, english}|null}. */
function trdCleanHealth_(j) {
  j = j || {};
  var v = (Array.isArray(j.vaccines) ? j.vaccines : []).map(function(x) { return trdStr_(x, 80); }).filter(Boolean).slice(0, 6);
  var p = j.phrase && typeof j.phrase === 'object' && trdStr_(j.phrase.text, 300) ? { language: trdStr_(j.phrase.language, 40), text: trdStr_(j.phrase.text, 300), english: trdStr_(j.phrase.english, 300) } : null;
  return { vaccines: v, phrase: p };
}

/** The pre-trip briefing's READINESS lines. */
function trdBriefLines_(readiness, health, cardLines) {
  var lines = [];
  (readiness || []).forEach(function(p) {
    p.rows.filter(function(r) { return r.state !== 'ready'; }).forEach(function(r) { lines.push('• ' + p.person + (r.state === 'blocks' ? ' (blocks the trip): ' : ': ') + r.text); });
  });
  (cardLines || []).forEach(function(l) { lines.push('• ' + l); });
  (health || []).forEach(function(h) {
    if (h.vaccines && h.vaccines.length) lines.push('• ' + h.country + ' vaccines to ask your doctor about: ' + h.vaccines.join(', '));
    if (h.phrase) lines.push('• Allergy phrase (' + h.phrase.language + '): “' + h.phrase.text + '”');
  });
  return lines;
}

// ---- reads ------------------------------------------------------------------------

function trdHealthSheet_() {
  var sh = ensureSheet(getSpreadsheet(), TABS.TRIP_HEALTH_NOTES, TRIP_HEALTH_NOTE_HEADERS);
  return sh;
}

/** Health notes for one country, cached; one Claude call on a miss. null when Claude is down. */
function trdHealthFor_(country, allergies) {
  var key = trdHealthKey_(country, allergies), sh = trdHealthSheet_();
  var rows = sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues() : [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === key) { try { return Object.assign({ country: country, saved: true }, JSON.parse(String(rows[i][1]))); } catch (e) {} }
  }
  var prompt = 'A traveller from the United States is going to ' + country + '. Reply with JSON only: ' +
    '{"vaccines": [up to 6 short names of vaccines or medicines travel clinics commonly recommend for ' + country + ', most important first],' +
    ' "phrase": ' + (allergies.length ? '{"language": "the main local language", "text": "a short sentence in that language saying: I have a serious allergy to ' + allergies.join(', ') + '. Please make sure my food contains none.", "english": "the English"}' : 'null') + '}.' +
    ' Do not include routine childhood vaccines unless they are specifically advised for ' + country + '.';
  var r = callClaudeJsonDetailed_(prompt, { maxTokens: 500 });
  if (!r || !r.json) return null;
  var clean = trdCleanHealth_(r.json);
  tpLocked_(function() { sh.appendRow([key, JSON.stringify(clean), new Date().toISOString()]); });
  return Object.assign({ country: country, saved: false }, clean);
}

function trdPacking_(tripKey) {
  var sh = getSpreadsheet().getSheetByName(TABS.PACKING_ITEMS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, PACKING_ITEM_HEADERS.length).getValues()
    .filter(function(r) { return String(r[1]) === tripKey; }).map(function(r) { return { person: String(r[2] || ''), item: String(r[4] || '') }; });
}

function trdRx_() {
  try {
    return ((webGetPrescriptions_() || {}).prescriptions || []).filter(function(r) { return String(r.active || 'Yes').toLowerCase() !== 'no'; })
      .map(function(r) { return { id: String(r.id || ''), person: String(r.person || ''), medication: String(r.medication || ''), refillDate: tpYmd_(r.refillDate) }; });
  } catch (e) { return []; }
}

// ---- routes -------------------------------------------------------------------------

/** GET trip_readiness {tripKey, startDate, endDate}. */
function webTripReadiness_(params) {
  params = params || {};
  var tripKey = trdStr_(params.tripKey, 200), startDate = tpYmd_(params.startDate), endDate = tpYmd_(params.endDate) || startDate;
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  var items = tpItems_();
  if (!items.length) return { ok: true, people: [], cards: [], health: [], empty: true };
  var itinerary = [], documents = null, lounges = [];
  try { itinerary = tripItemsFor_(tripKey, startDate, endDate, 'trip_readiness'); } catch (e) { Logger.log('trip_readiness itinerary: ' + e.message); }
  try { var d = webGetTripDocuments_({ tripKey: tripKey, startDate: startDate, endDate: endDate }); documents = d && d.ok ? d : null; } catch (e) { Logger.log('trip_readiness documents: ' + e.message); }
  try { lounges = (documents && documents.countries.length && typeof getLoungePerkPrograms_ === 'function') ? getLoungePerkPrograms_() : []; } catch (e) {}
  var people = trdReadiness_({ items: items, itinerary: itinerary, documents: documents, rx: trdRx_(), packing: trdPacking_(tripKey), today: tpToday_(), endDate: endDate });
  var health = [];
  if (params.health !== '0' && documents) {
    var allergies = trdAllergies_(items);
    (documents.countries || []).filter(function(c) { return c.role === 'stay'; }).slice(0, 3).forEach(function(c) {
      try { var h = trdHealthFor_(c.country, allergies); if (h) health.push(h); } catch (e) { Logger.log('trip_readiness health: ' + e.message); }
    });
  }
  return { ok: true, people: people, cards: trdCardLounges_(lounges), health: health };
}

/** POST trip_readiness_pack {tripKey, person, item}: puts a refill on the packing list (Source "profile"). */
function webTripReadinessPack_(body) {
  var tripKey = trdStr_(body && body.tripKey, 200), item = trdStr_(body && body.item, 120), person = trdStr_(body && body.person, 60);
  if (!tripKey || !item) return { ok: false, error: 'tripKey and item required' };
  var have = trdPacking_(tripKey).some(function(p) { return p.item.toLowerCase() === item.toLowerCase(); });
  if (have) return { ok: true, already: true };
  var r = webAddPackingItem_({ parameter: { tripKey: tripKey, person: (person || 'shared').toLowerCase(), category: 'Health', item: item } });
  try {
    var sh = getSpreadsheet().getSheetByName(TABS.PACKING_ITEMS), ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === r.id) { sh.getRange(i + 2, 7).setValue('profile'); break; }
  } catch (e) {}
  return { ok: true, id: r.id };
}

/** The pre-trip briefing's READINESS section, or '' (never throws). */
function trdBriefSection_(tripKey, startDate, endDate) {
  try {
    var r = webTripReadiness_({ tripKey: tripKey, startDate: startDate, endDate: endDate });
    if (!r.ok || r.empty) return '';
    var lines = trdBriefLines_(r.people, r.health, r.cards);
    return lines.length ? '🧾 READINESS\n' + lines.join('\n') : '🧾 READINESS\nEveryone is set.';
  } catch (e) { Logger.log('trdBriefSection_: ' + e.message); return ''; }
}
