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

// The envelope. 'Send Card' holds the literal 'Yes' or blank — the same convention
// as Resolved, Autopay and Needs Review, where every reader tests
// String(...).trim().toLowerCase() === 'yes'. A checkbox TRUE reads as unset.
var HOUSEHOLD_HEADERS = ['ID', 'Household', 'Address Line 1', 'Address Line 2', 'City',
                         'State', 'Postal Code', 'Country', 'Relationship', 'Send Card',
                         'Last Card Sent', 'Address Confirmed', 'Notes'];

var CONTACT_HEADERS   = ['ID', 'Household ID', 'Name', 'Email', 'Phone', 'Member Type', 'Notes'];

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
  var id = PropertiesService.getScriptProperties().getProperty(ADDRESS_BOOK_PROP_);
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
 * 'Yes' or '' — never a boolean. See the HOUSEHOLD_HEADERS note.
 *
 * Accepts a real boolean as well as the string, because a JSON body sends
 * `"sendCard": true` naturally and the sheet must still end up holding the literal
 * the readers look for.
 */
function addressBookYesNo_(v) {
  if (v === true) return 'Yes';
  return String(v === undefined || v === null ? '' : v).trim().toLowerCase() === 'yes' ? 'Yes' : '';
}

/** A short, sortable, collision-free id. Mirrors 'CP-' + Date.now() elsewhere. */
function newAddressBookId_(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}
