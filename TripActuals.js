// ============================================================
// VERA — TripActuals.js
// What a trip actually cost, from its booking confirmations, into Trip Budget.
// ============================================================
//
// The email parser (EmailParser.js) reads each travel confirmation and keeps what
// it finds in the itinerary row's Metadata, now including totalPaid: the total
// charged for that booking. A trip's paid amounts are totalled by Trip Budget
// category (flights, lodging, transport, activities, food) and written as the
// Actual on the trip's Budget lines, adding a line when the trip has none.
//
// No timer (decided Oct 26). It runs only when something changed or you look:
//   - when the parser saves a booking with a total (tripActualsOnBooking_), for
//     the trip whose dates hold it;
//   - when you open a trip's Summary or Budget (tripActualsOnView_), for that
//     trip, which catches a booking saved before its trip was on the calendar.
// Only the Itinerary sheet is read: calendar events never carry a total.
//
// An Actual you typed is never overwritten: VERA only writes a line whose Actual is
// blank or that it wrote itself (its Notes start "VERA: from"). Amounts in another
// currency are left out and said so; nothing is converted.
//
// A settled trip idea's WILLA reminder (trip_idea_willa|…) is refreshed with what
// has been booked so far, so the total sent to WILLA is the real one.
//
// Two layers, so the tests need no Google:
//   tripActuals*_ (pure)   which rows are the trip's, totals, which Budget lines to write
//   syncTripActualsFor_    the reads and writes, under the script lock
// ============================================================

var TRIP_ACTUALS_NOTE_ = 'VERA: from ';

function tripActualsMeta_(it) { try { return JSON.parse((it && it.metadata) || '{}') || {}; } catch (e) { return {}; } }

/**
 * Pure: a trip's paid bookings → {category: {total, count, other}} where other
 * counts bookings in another currency (left out). One booking counted once,
 * however many itinerary rows carry its confirmation email.
 */
function tripActualsFromItems_(items) {
  var out = {}, seen = {};
  (items || []).forEach(function(it) {
    var m = tripActualsMeta_(it), map = TRIP_BUDGET_TYPE_MAP_[String(it && it.type || '').toLowerCase()];
    var paid = typeof m.totalPaid === 'number' ? m.totalPaid : Number(String(m.totalPaid == null ? '' : m.totalPaid).replace(/[^0-9.]/g, '') || NaN);   // "1,180" or "$1,180.00" too
    if (!map || !isFinite(paid) || paid <= 0) return;
    var key = m.sourceEmailId ? 'e:' + m.sourceEmailId : 'i:' + it.type + '|' + it.title + '|' + it.date;
    if (seen[key]) return; seen[key] = 1;
    var c = out[map.category] = out[map.category] || { total: 0, count: 0, other: 0, label: map.label };
    var cur = String(m.totalCurrency || '').trim().toUpperCase();
    if (cur && cur !== 'USD') { c.other++; return; }
    c.total = Math.round((c.total + paid) * 100) / 100; c.count++;
  });
  return out;
}

/** Pure: the Notes VERA writes on a line it filled. */
function tripActualsNote_(c) {
  return TRIP_ACTUALS_NOTE_ + c.count + ' confirmation' + (c.count === 1 ? '' : 's') + (c.other ? ' · ' + c.other + ' in another currency left out' : '');
}

/**
 * Pure: which Budget lines to write for one trip. rows: [{row, category, actual,
 * notes}] (this trip's lines only). → [{kind: 'update', row, actual, notes} |
 * {kind: 'add', category, label, actual, notes}]. A line with an Actual you typed is left alone.
 */
function tripActualsWrites_(rows, actuals) {
  var writes = [];
  Object.keys(actuals || {}).forEach(function(cat) {
    var c = actuals[cat];
    if (!c.count) return;
    var notes = tripActualsNote_(c);
    var line = (rows || []).filter(function(r) { return String(r.category || '').toLowerCase() === cat; })[0];
    if (!line) { writes.push({ kind: 'add', category: cat, label: c.label, actual: c.total, notes: notes }); return; }
    var mine = String(line.notes || '').indexOf(TRIP_ACTUALS_NOTE_) === 0;
    var blank = line.actual === '' || line.actual == null;
    if (!blank && !mine) return;
    if (Number(line.actual) === c.total && String(line.notes) === notes) return;
    writes.push({ kind: 'update', row: line.row, actual: c.total, notes: notes });
  });
  return writes;
}

/** Pure: the WILLA reminder's reason, with what has been booked so far. */
function tripActualsWillaReason_(trip, actuals) {
  var cats = Object.keys(actuals || {}).filter(function(k) { return actuals[k].count; });
  var total = cats.reduce(function(n, k) { return n + actuals[k].total; }, 0);
  var money = function(n) { return '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  return (trip.label || 'The trip') + ' (' + trip.startDate + '–' + trip.endDate + '): booked so far ' + money(total)
    + (cats.length ? ' (' + cats.map(function(k) { return k + ' ' + money(actuals[k].total); }).join(', ') + ')' : '')
    + '. Send WILLA the final total once everything is booked.';
}

/** Trip Budget lines for one trip (by its keys), with their sheet rows. */
function tripActualsLines_(values, tripKey) {
  var keys = tripKeysFor_(tripKey);
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!String(r[0] || '').trim() || !tripRowMatches_(r[1], keys)) continue;
    out.push({ row: i + 1, category: r[2], actual: r[5], notes: r[6] });
  }
  return out;
}

/**
 * Pure: a trip's rows in the Itinerary sheet (header row excluded), as items:
 * rows filed under one of the trip's keys, and rows with no Trip Key dated within
 * its dates (the parser leaves the key blank). Another trip's rows are not its.
 * dateText turns a date cell into 'yyyy-MM-dd'.
 */
function tripActualsItems_(values, trip, keys, dateText) {
  var out = [];
  (values || []).forEach(function(r) {
    var key = String(r[1] || '').trim(), date = String(dateText ? dateText(r[4]) : r[4]).trim();
    var mine = key ? keys.indexOf(key) !== -1 : (date && date >= trip.startDate && date <= trip.endDate);
    if (mine) out.push({ type: String(r[2] || ''), title: String(r[3] || ''), date: date, metadata: String(r[9] || '') });
  });
  return out;
}

/**
 * Totals these trips' paid bookings into Trip Budget and refreshes their settled
 * ideas' WILLA reminders. One read of Itinerary and Trip Budget. Returns lines written.
 */
function syncTripActualsFor_(trips) {
  trips = (trips || []).filter(function(t) { return t && t.startDate && t.endDate; });
  if (!trips.length) return 0;
  var ss = getSpreadsheet(), tz = Session.getScriptTimeZone();
  var itin = ss.getSheetByName(TABS.ITINERARY);
  if (!itin || itin.getLastRow() < 2) return 0;
  var dateText = function(v) { return dateCellToIso_(v); };
  var values = itin.getRange(2, 1, itin.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
  var found = [];
  trips.forEach(function(t) {
    var key = t.startDate + '|' + t.label;
    var a = tripActualsFromItems_(tripActualsItems_(values, t, tripKeysFor_(key).concat([key]), dateText));
    if (Object.keys(a).length) found.push({ trip: t, actuals: a });
  });
  if (!found.length) return 0;
  var written = 0;
  tiLocked_(function() {
    var sheet = ensureSheet(ss, TABS.TRIP_BUDGET, TRIP_BUDGET_HEADERS);
    found.forEach(function(x) {
      var key = x.trip.startDate + '|' + x.trip.label;
      var bvals = sheet.getLastRow() >= 1 ? sheet.getRange(1, 1, sheet.getLastRow(), TRIP_BUDGET_HEADERS.length).getValues() : [];
      tripActualsWrites_(tripActualsLines_(bvals, key), x.actuals).forEach(function(w) {
        if (w.kind === 'update') {
          sheet.getRange(w.row, 6, 1, 2).setValues([[w.actual, w.notes]]);
        } else {
          sheet.appendRow(['BUDG-' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd') + '-' + String(Date.now()).slice(-4) + written, key, w.category, w.label, '', w.actual, w.notes]);
        }
        written++;
      });
    });
    tripActualsRefreshWilla_(ss, found);
  });
  Logger.log('trip actuals: ' + found.length + ' trip(s) with paid bookings, ' + written + ' budget line(s) written');
  return written;
}

/** Pure: the trips a booking belongs to: the one its key names, else the ones whose dates hold its date. */
function tripActualsTripsFor_(rows, date, key) {
  if (key) {
    var named = (rows || []).filter(function(t) { return t.startDate + '|' + t.label === key || (t.aliases || []).indexOf(key) !== -1; });
    if (named.length) return named;
  }
  return date ? (rows || []).filter(function(t) { return tripIsLive_(t) && t.startDate && t.endDate && date >= t.startDate && date <= t.endDate; }) : [];
}

/** The parser just saved a booking with a total: update its trip's Budget. Never throws. */
function tripActualsOnBooking_(date, key) {
  try {
    var trips = tripActualsTripsFor_(readTripRegistry_().rows, String(date || '').trim(), String(key || '').trim());
    if (trips.length) syncTripActualsFor_(trips);
  } catch (e) { Logger.log('trip actuals: booking update skipped: ' + e.message); }
}

/** A trip's Summary or Budget was opened: re-total that trip. Never throws. */
function tripActualsOnView_(tripKey, tripId) {
  try {
    var reg = readTripRegistry_(), id = String(tripId || '').trim().toUpperCase();
    var t = (id && reg.byId[id]) || tripActualsTripsFor_(reg.rows, '', String(tripKey || '').trim())[0];
    if (t) syncTripActualsFor_([t]);
  } catch (e) { Logger.log('trip actuals: view update skipped: ' + e.message); }
}

/** Each settled trip idea's open WILLA reminder gets the booked-so-far total in its reason. */
function tripActualsRefreshWilla_(ss, found) {
  var flags = ss.getSheetByName(TABS.FLAGS);
  if (!flags || flags.getLastRow() < 2) return;
  var byTrip = {};
  try {
    tiRows_(tiIdeasSheet_(), TRIP_IDEAS_HEADERS.length).map(tiIdeaFromRow_).forEach(function(i) { if (i.tripId) (byTrip[String(i.tripId).toUpperCase()] = byTrip[String(i.tripId).toUpperCase()] || []).push(i.id); });
  } catch (e) { return; }
  var want = {};
  found.forEach(function(x) { (byTrip[x.trip.tripId] || []).forEach(function(id) { want['trip_idea_willa|' + id] = tripActualsWillaReason_(x.trip, x.actuals); }); });
  if (!Object.keys(want).length) return;
  var rows = flags.getRange(2, 1, flags.getLastRow() - 1, FLAG_HEADERS.length).getValues();
  rows.forEach(function(r, i) {
    var k = String(r[9] || '').trim();
    if (!want[k] || String(r[8] || '').toLowerCase() === 'yes' || String(r[4]) === want[k]) return;
    flags.getRange(i + 2, 5).setValue(want[k]);
  });
}
