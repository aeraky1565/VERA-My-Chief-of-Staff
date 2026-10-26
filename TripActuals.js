// ============================================================
// VERA — TripActuals.js
// What a trip actually cost, from its booking confirmations, into Trip Budget.
// ============================================================
//
// The email parser (EmailParser.js) reads each travel confirmation and keeps what
// it finds in the itinerary row's Metadata, now including totalPaid: the total
// charged for that booking. Every six hours this totals the paid amounts of each
// current or upcoming trip by Trip Budget category (flights, lodging, transport,
// activities, food) and writes them as the Actual on the trip's Budget lines,
// adding a line when the trip has none for that category.
//
// An Actual you typed is never overwritten: VERA only writes a line whose Actual is
// blank or that it wrote itself (its Notes start "VERA: from"). Amounts in another
// currency are left out and said so; nothing is converted.
//
// A settled trip idea's WILLA reminder (trip_idea_willa|…) is refreshed with what
// has been booked so far, so the total sent to WILLA is the real one.
//
// Two layers, so the tests need no Google:
//   tripActuals*_ (pure)   totals, and which Budget lines to write
//   syncTripActuals_       the reads and writes, under the script lock
// ============================================================

var TRIP_ACTUALS_NOTE_ = 'VERA: from ';
var TRIP_ACTUALS_EVERY_HOURS_ = 6;
var TRIP_ACTUALS_PAST_DAYS_ = 30;   // a trip that ended within a month still gets its late confirmations

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

/** Pure: is it time? Every six hours. */
function tripActualsDue_(nowMs, lastIso) {
  if (!lastIso) return true;
  var last = new Date(lastIso).getTime();
  return !isFinite(last) || nowMs - last >= TRIP_ACTUALS_EVERY_HOURS_ * 36e5 - 5 * 6e4;
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
 * Totals each current or upcoming trip's paid bookings into Trip Budget, and
 * refreshes settled trip ideas' WILLA reminders. Returns how many lines it wrote.
 */
function syncTripActuals_() {
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var since = Utilities.formatDate(new Date(Date.now() - TRIP_ACTUALS_PAST_DAYS_ * 864e5), tz, 'yyyy-MM-dd');
  var trips = readTripRegistry_().rows.filter(function(t) { return t.status !== 'archived' && t.startDate && t.endDate && t.endDate >= since; });
  var found = [];
  trips.forEach(function(t) {
    try {
      var a = tripActualsFromItems_(tripItemsFor_(t.startDate + '|' + t.label, t.startDate, t.endDate, 'trip actuals'));
      if (Object.keys(a).length) found.push({ trip: t, actuals: a });
    } catch (e) { Logger.log('trip actuals: one trip skipped'); }
  });
  if (!found.length) return 0;
  var ss = getSpreadsheet(), written = 0;
  tiLocked_(function() {
    var sheet = ensureSheet(ss, TABS.TRIP_BUDGET, TRIP_BUDGET_HEADERS);
    found.forEach(function(x) {
      var key = x.trip.startDate + '|' + x.trip.label;
      var values = sheet.getLastRow() >= 1 ? sheet.getRange(1, 1, sheet.getLastRow(), TRIP_BUDGET_HEADERS.length).getValues() : [];
      tripActualsWrites_(tripActualsLines_(values, key), x.actuals).forEach(function(w) {
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

/** Called from hourlyCheck: totals actuals when due. Never throws. */
function maybeSyncTripActuals_(now) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (!tripActualsDue_((now || new Date()).getTime(), props.getProperty('TRIP_ACTUALS_SYNCED_AT'))) return;
    props.setProperty('TRIP_ACTUALS_SYNCED_AT', new Date().toISOString());
    syncTripActuals_();
  } catch (e) { Logger.log('trip actuals: sync failed: ' + e.message); }
}
