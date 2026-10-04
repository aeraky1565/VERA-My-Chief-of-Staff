// ============================================================
// ADDRESS BOOK — the shared list of people we send things to
// ============================================================
//
// One agreed place for the postal addresses, emails and phone numbers of family and
// friends: the list you reach for at Christmas, for a birthday card, or to invite
// people to a child's thing.
//
// WHY IT LIVES IN A DIFFERENT SPREADSHEET. Ahmed built it as its own Google Sheet so
// it can be shared with Victoria on its own, without handing over the rest of VERA —
// finances, health, career. VERA reaches it by id from the ADDRESS_BOOK_SHEET_ID
// script property, the same way the Simple Ass Tracker budget is read and written
// (webGetBudget_, WebApp.js). Everything here therefore has to tolerate a sheet VERA
// does not own: reads are header-driven, because a tab two people edit by hand WILL
// have a column inserted in the middle of it eventually.
//
// WHY TWO TABS. A Christmas card goes to a HOUSEHOLD — one envelope, one address,
// "and family". An email or a phone call reaches a PERSON. Modelling both as one
// flat list means either duplicating the address on every member, where the copies
// drift apart, or losing the per-person contact details. So: Households, and People
// belonging to a household.
//
// WHAT IS DELIBERATELY ABSENT: birthdays. The Important Dates tab already stores
// them, flags them ahead of time and writes them to the shared calendar. A second
// birthday list would be a second thing to keep right, and the one that is already
// wired up would win.

var ADDRESS_BOOK_PROP_       = 'ADDRESS_BOOK_SHEET_ID';
var ADDRESS_BOOK_HEALTH_     = 'sheet:AddressBook';
var ADDRESS_BOOK_HOUSEHOLDS_ = 'Households';
var ADDRESS_BOOK_PEOPLE_     = 'People';
var ADDRESS_BOOK_MAILINGS_   = 'Mailings';
var ADDRESS_BOOK_IMPORT_     = 'Import';

// The envelope.
//
// 'Send Card' and 'Last Card Sent' USED TO BE HERE and were retired when Mailings
// arrived. They tracked exactly one occasion and exactly one date, so a second
// Christmas card overwrote the first and "did they get one in 2024?" had no answer.
// VERA does not delete them from a sheet that already has them — ensureSheet only
// writes headers into a blank tab — it simply stops reading and writing them, so the
// columns can be removed by hand whenever it suits.
var HOUSEHOLD_HEADERS = ['ID', 'Household', 'Address Line 1', 'Address Line 2', 'City',
                         'State', 'Postal Code', 'Country', 'Relationship',
                         'Address Confirmed', 'Notes'];

var CONTACT_HEADERS   = ['ID', 'Household ID', 'Name', 'Email', 'Phone', 'Member Type', 'Notes'];

// One row per thing actually posted. EVERY ROW IS SOMETHING THAT WENT OUT — there is
// no planned or draft state, so a row never has to be interpreted, only counted.
//
// 'Event' is free text ('Christmas card', 'Wedding thank you'). The dashboard offers
// the values already in use and lets a new one be typed, so inventing an occasion
// needs no column, no config and no deploy. The alternative — a pair of columns per
// occasion on Households — grows the tab forever, and a one-off like wedding
// thank-yous would widen it permanently for something that happens once.
var MAILING_HEADERS   = ['ID', 'Household ID', 'Event', 'Sent', 'Notes'];

// The paste target for bulk entry: ONE ROW PER PERSON, with the household repeated.
// That is the shape a contact list is already in and the shape a CSV export lands in,
// so it can be pasted rather than retyped.
//
// Rows group into households by the 'Household' column, NOT by matching addresses.
// "12 Elm St" and "12 Elm Street" are the same house to a person and two houses to a
// string comparison, and that is exactly how one family quietly becomes two.
//
// 'Status' is written BY VERA, never by hand: it is where the preview says what each
// row will do, and where the import says what it did.
var IMPORT_HEADERS    = ['Household', 'Name', 'Member Type', 'Email', 'Phone',
                         'Address Line 1', 'Address Line 2', 'City', 'State',
                         'Postal Code', 'Country', 'Relationship',
                         'Household Notes', 'Person Notes', 'Status'];

// ---- Access -----------------------------------------------------------------

/**
 * Opens the address book spreadsheet.
 *
 * AN UNCONFIGURED FEATURE IS NOT AN OUTAGE. With no property set this returns
 * configured:false and records NOTHING against API health. That distinction is the
 * whole of the aviationstack bug fixed in 2829eba — a normal state filed as a fault,
 * nagging daily in a banner whose authority depends on only ever reporting real
 * problems. Only a sheet we were actually told to open and then could not is a
 * failure worth reporting.
 *
 * @returns {Object} { ok, configured, ss, error }
 */
function getAddressBookSheet_() {
  var id = '';
  try {
    id = String(PropertiesService.getScriptProperties().getProperty(ADDRESS_BOOK_PROP_) || '').trim();
  } catch (propErr) { id = ''; }

  // THE CONFIG TAB IS THE USABLE HOME FOR THIS, and the Script Property is the
  // fallback rather than the other way round in practice.
  //
  // The Apps Script property editor lists only the first 50 properties and goes
  // READ-ONLY past that — "to manage or view all of your properties, do so
  // programmatically using the Properties service". VERA is well past 50, largely
  // through latches nothing prunes (day_plan_*, PERK_NOTIFY_*, TDB_SENT_*), so a
  // value a human has to type simply cannot be added there any more.
  //
  // The Config tab has no such cap, is a sheet both of them can already edit, and
  // is where wishlist_* and victoria_email already live. Property first so an
  // existing deployment keeps working.
  if (!id) {
    try { id = String(getConfigValues()['address_book_sheet_id'] || '').trim(); }
    catch (cfgErr) { id = ''; }
  }

  if (!id) return { ok: true, configured: false, ss: null, error: '' };

  try {
    var ss = SpreadsheetApp.openById(id);
    recordApiHealth_(ADDRESS_BOOK_HEALTH_, true, '', 200);
    return { ok: true, configured: true, ss: ss, error: '' };
  } catch (err) {
    // A sharing or permissions problem is exactly what this should surface: the
    // sheet is someone else's document and access can be revoked without warning.
    recordApiHealth_(ADDRESS_BOOK_HEALTH_, false, err.message, 0);
    return { ok: false, configured: true, ss: null, error: err.message };
  }
}

/**
 * Creates the two tabs if they are not there, and NEVER touches anything else in
 * that spreadsheet.
 *
 * Ahmed already has his own tab in this document. ensureSheet (Code.js) takes the
 * spreadsheet as a parameter and only writes headers into a BLANK sheet, so it is
 * safe to call on a document VERA does not own — it adds what is missing and leaves
 * every existing tab, including his, exactly as it was.
 */
function ensureAddressBookTabs_(ss) {
  ensureSheet(ss, ADDRESS_BOOK_HOUSEHOLDS_, HOUSEHOLD_HEADERS);
  ensureSheet(ss, ADDRESS_BOOK_PEOPLE_,     CONTACT_HEADERS);
  ensureSheet(ss, ADDRESS_BOOK_MAILINGS_,   MAILING_HEADERS);
  ensureSheet(ss, ADDRESS_BOOK_IMPORT_,     IMPORT_HEADERS);
}

/**
 * Column index (1-based) for each header name actually present in a tab.
 *
 * Header-driven on purpose. Two people edit this sheet by hand, so a column will be
 * inserted in the middle of it sooner or later; reading by position would silently
 * shift every field by one from that moment on, and the first sign would be an
 * address in the Notes column.
 */
function addressBookCols_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header  = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map     = {};
  header.forEach(function(h, i) {
    var name = String(h || '').trim();
    if (name) map[name] = i + 1;
  });
  return map;
}

/** Reads one tab into objects keyed by header name. Rows with a blank ID are skipped. */
function readAddressBookTab_(sheet, headers) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var cols = addressBookCols_(sheet);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1,
                            Math.max(sheet.getLastColumn(), 1)).getValues();
  var out  = [];
  rows.forEach(function(row) {
    var rec = {};
    headers.forEach(function(h) {
      var c = cols[h];
      rec[h] = c ? String(row[c - 1] === null || row[c - 1] === undefined ? '' : row[c - 1]).trim() : '';
    });
    if (!rec['ID']) return;      // a blank spacer row, or a row half-typed by hand
    out.push(rec);
  });
  return out;
}

/** Row number of the row whose ID column matches, or 0. */
function findAddressBookRow_(sheet, id) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var cols = addressBookCols_(sheet);
  var idCol = cols['ID'] || 1;
  var ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getValues();
  var want = String(id || '').trim();
  if (!want) return 0;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === want) return i + 2;
  }
  return 0;
}

/**
 * Writes the named fields of one row, by header.
 *
 * Only the fields PRESENT in the object are written, so a caller that knows about
 * five columns cannot blank the three it has never heard of — which is what keeps
 * VERA from eating a column Victoria adds to the sheet herself.
 */
function writeAddressBookRow_(sheet, rowNum, fields) {
  var cols = addressBookCols_(sheet);
  Object.keys(fields).forEach(function(name) {
    var c = cols[name];
    if (!c) return;
    sheet.getRange(rowNum, c).setValue(fields[name]);
  });
}

/**
 * Appends MANY rows in one call.
 *
 * appendRow is a round trip each, and an import of sixty families is a few hundred
 * of them — minutes of wall clock for work that is one write. Same rule the memory
 * prune follows in reverse: batch, do not loop.
 */
function appendAddressBookRows_(sheet, headers, rowObjects) {
  if (!rowObjects || !rowObjects.length) return 0;
  var cols    = addressBookCols_(sheet);
  var lastCol = Math.max(sheet.getLastColumn(), headers.length);
  var block   = rowObjects.map(function(fields) {
    var row = [];
    for (var i = 0; i < lastCol; i++) row.push('');
    Object.keys(fields).forEach(function(name) {
      var c = cols[name];
      if (c) row[c - 1] = fields[name];
    });
    return row;
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, block.length, lastCol).setValues(block);
  return block.length;
}

/** Appends a row, placing each field under its own header. */
function appendAddressBookRow_(sheet, headers, fields) {
  var cols    = addressBookCols_(sheet);
  var lastCol = Math.max(sheet.getLastColumn(), headers.length);
  var row     = [];
  for (var i = 0; i < lastCol; i++) row.push('');
  Object.keys(fields).forEach(function(name) {
    var c = cols[name];
    if (c) row[c - 1] = fields[name];
  });
  sheet.appendRow(row);
}

/**
 * Deletes every row whose named column matches, BACK TO FRONT.
 *
 * Front to back is the classic way to get this wrong: deleting row 4 moves row 5 up
 * into its place, the loop moves on to row 5, and the row that just shifted is
 * skipped. Same rule deleteRowsOlderThan_ (Memory.js) follows.
 *
 * One implementation rather than one per tab: a household cascades to both its
 * members and its mailings, and two copies of a back-to-front delete is two chances
 * to write the forward one.
 *
 * @returns {number} rows removed
 */
function deleteAddressBookRowsFor_(sheet, columnName, value) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var cols = addressBookCols_(sheet);
  var col  = cols[columnName];
  if (!col) return 0;
  var want = String(value || '').trim();
  if (!want) return 0;
  var vals = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
  var removed = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0] || '').trim() !== want) continue;
    sheet.deleteRow(i + 2);
    removed++;
  }
  return removed;
}

/** A short, sortable, collision-free id. Mirrors 'CP-' + Date.now() elsewhere. */
function newAddressBookId_(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

// ============================================================
// SCRIPT PROPERTY HOUSEKEEPING
// ============================================================
//
// This lives here because the address book is what ran into it: the Apps Script
// property editor lists only the first 50 properties and turns read-only past that,
// so ADDRESS_BOOK_SHEET_ID could not be added by hand at all.
//
// The reason there are so many is that several latches are written and NEVER
// deleted. Only fixed-name properties (Pacing.js, PTO.js) are ever cleaned up:
//
//   day_plan_<yyyy-MM-dd>        one per day, forever — 365 a year on its own
//   PERK_NOTIFY_<ID>_<PERIOD>    one per perk per period — hundreds a year
//   TDB_SENT_<yyyymmdd>_<LABEL>  one per travel day, forever
//
// Each is a "have I already done this" marker whose answer stops mattering once its
// period is comfortably past, and keeping it after that buys nothing. This is the
// same disease as the orphaned googlefit-steps health entry: accumulated state that
// nothing prunes, which eventually costs you a surface you need.
//
// DELETING ONE TOO EARLY RE-SENDS SOMETHING, so every window here is deliberately
// far wider than it needs to be. A day plan is a pure cache. A perk notification
// cannot fire again once its period key no longer matches the current one. A travel
// briefing is keyed to a date that has passed.

var PROP_PRUNE_DAY_PLAN_DAYS_  = 7;    // a pure cache for Chat's apply action
var PROP_PRUNE_PERK_DAYS_      = 60;   // after the period END, not the stamp
var PROP_PRUNE_TDB_DAYS_       = 30;   // the briefing was for a day that has passed

/**
 * Drops expired latches from the script property store.
 *
 * @param {number} [nowMs] injectable clock, for tests
 * @returns {Object} { scanned, removed, keys }
 */
function pruneScriptProperties_(nowMs) {
  var now   = nowMs || Date.now();
  var props = PropertiesService.getScriptProperties();
  var all   = props.getProperties();
  var keys  = Object.keys(all);
  var removed = [];

  function ageDays(ms) { return (now - ms) / 86400000; }

  keys.forEach(function(key) {
    var m;

    // day_plan_2026-10-04
    if ((m = /^day_plan_(\d{4})-(\d{2})-(\d{2})$/.exec(key))) {
      var d = new Date(+m[1], +m[2] - 1, +m[3]);
      if (ageDays(d.getTime()) > PROP_PRUNE_DAY_PLAN_DAYS_) removed.push(key);
      return;
    }

    // TDB_SENT_20261004_SOME_TRIP_LABEL
    if ((m = /^TDB_SENT_(\d{4})(\d{2})(\d{2})_/.exec(key))) {
      var t = new Date(+m[1], +m[2] - 1, +m[3]);
      if (ageDays(t.getTime()) > PROP_PRUNE_TDB_DAYS_) removed.push(key);
      return;
    }

    // PERK_NOTIFY_CP_14_2026_Q3 — the id itself contains underscores, so the period
    // is matched at the END of the key rather than by splitting. The separators were
    // uppercased and underscored on the way in, so they are turned back here before
    // perkPeriodKeyEnd_ (Code.js) is asked when that period actually ended.
    if (/^PERK_NOTIFY_/.test(key)) {
      m = /_(\d{4})(?:_(\d{2}|Q[1-4]|H[12]))?$/.exec(key);
      if (!m) return;                                  // a shape we do not parse — leave it
      var periodKey = m[1] + (m[2] ? '-' + m[2] : '');
      var end;
      try { end = perkPeriodKeyEnd_(periodKey, Session.getScriptTimeZone()); }
      catch (pkErr) { return; }
      if (!end) return;                                // standing, or unrecognised
      if (ageDays(end.getTime()) > PROP_PRUNE_PERK_DAYS_) removed.push(key);
      return;
    }
  });

  // ONE KEY AT A TIME, deliberately.
  //
  // The cheap version is deleteAllProperties() followed by setProperties(kept) — one
  // round trip instead of N. It is also a way to lose EVERYTHING: an execution killed
  // between those two calls (and the nightly run is killed at six minutes often
  // enough that there is a watchdog for it) would take the API health state, every
  // heartbeat, the nightly markers and the address book id with it. There is no undo.
  //
  // deleteProperty is its own round trip, but the count is bounded: this only ever
  // touches keys that are already expired, so after the first run it is a handful a
  // night. A slow correct prune is skipped by the time budget; a fast one that loses
  // the store is unrecoverable.
  var deleted = [];
  removed.forEach(function(k) {
    try { props.deleteProperty(k); deleted.push(k); }
    catch (delErr) { Logger.log('pruneScriptProperties_: could not delete ' + k + ' — ' + delErr.message); }
  });
  if (deleted.length) {
    Logger.log('pruneScriptProperties_: removed ' + deleted.length + ' expired latch(es) of ' +
               keys.length + ' propert(ies).');
  }
  return { scanned: keys.length, removed: deleted.length, keys: deleted };
}
