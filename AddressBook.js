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

// One row per thing sent, or intended to be sent.
//
// A BLANK 'Sent' MEANS PLANNED: the household is on the list for that event but the
// card has not gone yet. A date means it went on that date. This started out as
// "every row is something that actually went out, so a row never has to be
// interpreted" — which was wrong in a way that showed up the moment the feature was
// used. The event dropdown is derived from these rows, so with nothing but sent rows
// allowed, naming a new event saved NOTHING until the first card was posted, and the
// name was gone on the next load.
//
// It is stored as a blank rather than a separate Status column on purpose. A Status
// cell can disagree with the date — 'Planned' sitting next to 2025-11-02 — and in a
// tab two people edit by hand it eventually will. A blank date cannot contradict
// anything.
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
// 'Full Address' is the alternative to the eight columns before it: paste the whole
// thing as it appears on a contact card or an email signature and let VERA split it.
// The broken-out columns always win where they are filled, so one row can be typed
// field by field and the next pasted whole.
//
// 'Status' is written BY VERA, never by hand: it is where the preview says what each
// row will do, and where the import says what it did.
//
// The six columns a pasted address is split into, in envelope order.
var IMPORT_HEADERS    = ['Household', 'Name', 'Member Type', 'Email', 'Phone',
                         'Address Line 1', 'Address Line 2', 'City', 'State',
                         'Postal Code', 'Country', 'Full Address', 'Relationship',
                         'Household Notes', 'Person Notes', 'Status'];

var IMPORT_ADDRESS_PARTS_ = ['Address Line 1', 'Address Line 2', 'City', 'State',
                             'Postal Code', 'Country'];

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
  ensureImportColumns_(ss.getSheetByName(ADDRESS_BOOK_IMPORT_));
}

/**
 * Adds any IMPORT_HEADERS column that is missing, at the right-hand edge.
 *
 * ensureSheet only writes headers into a BLANK tab, which is the right rule for
 * Households and People — they are someone else's document and VERA must not reshape
 * them. The Import tab is different: VERA created it, owns its schema and is the only
 * thing that reads it. Without this, every column added to the schema after the tab
 * first appeared would be invisible in the live sheet, and a header-driven read maps
 * a name it cannot find to nothing at all. 'Full Address' was exactly that.
 *
 * Additive and BY NAME: existing headers are never moved, renamed or rewritten, so a
 * column Ahmed added himself, or one he reordered, is left exactly where it is.
 */
function ensureImportColumns_(sheet) {
  if (!sheet) return [];
  var have   = addressBookCols_(sheet);
  var adding = IMPORT_HEADERS.filter(function(h) { return !have[h]; });
  if (!adding.length) return [];
  // One write at the end of the header row, not one per column.
  var at = Math.max(sheet.getLastColumn(), 0) + 1;
  sheet.getRange(1, at, 1, adding.length).setValues([adding]);
  return adding;
}

// ---- Reading an address written as one line ---------------------------------
//
// WHY VOCABULARIES RATHER THAN SHAPES. The first version of this split on commas and
// then guessed: a state was "any two letters", a country was "anything with no
// digits". Both are wrong often enough to matter — 'St' is two letters, 'Texas' is
// not — and the failures were silent. A comma-light overseas address put the whole
// line into Address Line 1, and 'Austin, Texas 78701' made the CITY 'Texas 78701'
// and pushed Austin into Address Line 2.
//
// Knowing what states and countries are actually called turns them into ANCHORS:
// find the state and the city is what sits before it, the street is what sits before
// that. Commas become a hint that reinforces a boundary rather than the only source
// of structure.

// Both spellings of every state, because people write either, and the code is what
// goes on an envelope. Keys are lower-cased; dots are stripped before lookup, so
// 'D.C.' arrives as 'dc'.
var US_STATES_ = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
  'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
  'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
  'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
  'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
  'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ',
  'new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',
  'ohio':'OH','oklahoma':'OK','oregon':'OR','pennsylvania':'PA','rhode island':'RI',
  'south carolina':'SC','south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT',
  'vermont':'VT','virginia':'VA','washington':'WA','west virginia':'WV',
  'wisconsin':'WI','wyoming':'WY',
  // 'washington dc' is deliberately NOT an alias here. As a two-word state it ate the
  // city as well: '…Avenue NW Washington DC 20500' came out with the state right and
  // no city at all. Washington is the city, DC is the state, and the single-word 'DC'
  // match handles it.
  'district of columbia':'DC',
  'puerto rico':'PR','virgin islands':'VI','guam':'GU','american samoa':'AS',
  'northern mariana islands':'MP',
};
// The codes map to themselves, so one lookup answers both spellings.
(function() {
  var codes = {};
  Object.keys(US_STATES_).forEach(function(k) { codes[US_STATES_[k].toLowerCase()] = US_STATES_[k]; });
  Object.keys(codes).forEach(function(k) { US_STATES_[k] = codes[k]; });
})();

// Aliases collapse to ONE spelling, or 'US' and 'United States' become two different
// countries on two rows of the same list and nothing groups properly again.
var COUNTRIES_ = {
  'usa':'USA','us':'USA','u.s.':'USA','u.s.a.':'USA','united states':'USA',
  'united states of america':'USA','america':'USA',
  'uk':'United Kingdom','u.k.':'United Kingdom','united kingdom':'United Kingdom',
  'great britain':'United Kingdom','england':'United Kingdom','scotland':'United Kingdom',
  'wales':'United Kingdom','northern ireland':'United Kingdom',
  'uae':'United Arab Emirates','u.a.e.':'United Arab Emirates',
  'united arab emirates':'United Arab Emirates',
  'ksa':'Saudi Arabia','saudi arabia':'Saudi Arabia','saudi':'Saudi Arabia',
  'egypt':'Egypt','canada':'Canada','mexico':'Mexico','france':'France',
  'germany':'Germany','italy':'Italy','spain':'Spain','portugal':'Portugal',
  'netherlands':'Netherlands','holland':'Netherlands','belgium':'Belgium',
  'switzerland':'Switzerland','austria':'Austria','ireland':'Ireland',
  'sweden':'Sweden','norway':'Norway','denmark':'Denmark','finland':'Finland',
  'poland':'Poland','greece':'Greece','turkey':'Turkey','israel':'Israel',
  'jordan':'Jordan','lebanon':'Lebanon','qatar':'Qatar','kuwait':'Kuwait',
  'bahrain':'Bahrain','oman':'Oman','morocco':'Morocco','tunisia':'Tunisia',
  'south africa':'South Africa','nigeria':'Nigeria','kenya':'Kenya',
  'india':'India','pakistan':'Pakistan','bangladesh':'Bangladesh',
  'china':'China','japan':'Japan','south korea':'South Korea','korea':'South Korea',
  'singapore':'Singapore','malaysia':'Malaysia','indonesia':'Indonesia',
  'thailand':'Thailand','vietnam':'Vietnam','philippines':'Philippines',
  'australia':'Australia','new zealand':'New Zealand',
  'brazil':'Brazil','argentina':'Argentina','chile':'Chile','colombia':'Colombia',
};

// What starts a second address line. 'Apartment or suite number if found in line 2'
// was the request, and it has to work with or without a comma in front of it.
var UNIT_KEYWORDS_ = ['apt', 'apartment', 'unit', 'suite', 'ste', 'fl', 'floor',
                      'rm', 'room', 'bldg', 'building', 'penthouse', 'ph', 'lot',
                      'space', 'trlr', 'trailer', 'box', 'no'];

// Where a street line ENDS. This is what tells '12 Elm St Austin' apart into a street
// and a city when they share a segment, and it is also the guard that stops the house
// number in '10400 NE 4th St' being read as a postal code.
var STREET_SUFFIXES_ = ['st','street','ave','avenue','av','rd','road','dr','drive',
  'ln','lane','blvd','boulevard','way','ct','court','pl','place','ter','terrace',
  'cir','circle','pkwy','parkway','hwy','highway','trail','trl','loop','sq','square',
  'walk','row','crescent','cres','close','mews','gardens','gdns','park','alley',
  'bend','pike','run','path','plaza','point','ridge','view','vista','expy','cswy',
  'turnpike','tpke','broadway','mall'];

// A trailing quadrant belongs to the street, not to the city: '1600 Pennsylvania
// Avenue NW Washington' is Washington, not 'NW Washington'.
var DIRECTIONALS_ = ['n','s','e','w','ne','nw','se','sw','north','south','east','west',
                     'northeast','northwest','southeast','southwest'];

// Enough to recognise a postcode rather than wonder about it. Ordered: the specific
// national shapes first, the bare run of digits last.
var POSTAL_PATTERNS_ = [
  /^\d{5}-\d{4}$/,                                   // US ZIP+4
  /^\d{5}$/,                                         // US ZIP
  /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i,            // UK
  /^[A-Z]\d[A-Z]\s*\d[A-Z]\d$/i,                     // Canada
  /^\d{4,6}$/,                                       // most of the rest
];

/** 'Texas' or 'tx' -> 'TX'; anything else -> ''. */
function parseUsState_(word) {
  var k = String(word || '').trim().replace(/\./g, '').toLowerCase();
  return US_STATES_[k] || '';
}

/** 'United States' -> 'USA'; anything else -> ''. */
function parseCountry_(word) {
  var raw = String(word || '').trim().toLowerCase();
  return COUNTRIES_[raw] || COUNTRIES_[raw.replace(/\./g, '')] || '';
}

/** A postcode, or ''. */
function parsePostalCode_(word) {
  var w = String(word || '').trim();
  if (!w) return '';
  for (var i = 0; i < POSTAL_PATTERNS_.length; i++) {
    if (POSTAL_PATTERNS_[i].test(w)) return w.toUpperCase().replace(/\s+/g, ' ');
  }
  return '';
}

/** Is this word the end of a street name? */
function isStreetSuffix_(word) {
  return STREET_SUFFIXES_.indexOf(String(word || '').replace(/\./g, '').toLowerCase()) !== -1;
}

/**
 * Splits a segment that holds BOTH a street and a city, at the street's suffix.
 * '12 Elm St Austin' -> { street: '12 Elm St', city: 'Austin' }
 *
 * Without this the two stay glued together, which is what '12 Elm St Austin TX 78701'
 * did: a street of '12 Elm St Austin' and no city at all. Returns no city when there
 * is no suffix to cut at, rather than guessing at a word boundary.
 */
function splitStreetAndCity_(segment) {
  var words = String(segment || '').trim().split(/\s+/);
  for (var i = words.length - 1; i >= 0; i--) {
    if (!isStreetSuffix_(words[i])) continue;
    var end = i;
    // A quadrant right after the suffix is still the street.
    if (words[i + 1] &&
        DIRECTIONALS_.indexOf(words[i + 1].replace(/\./g, '').toLowerCase()) !== -1) {
      end = i + 1;
    }
    if (end >= words.length - 1) return { street: words.join(' '), city: '' };
    return { street: words.slice(0, end + 1).join(' '),
             city:   words.slice(end + 1).join(' ') };
  }
  return { street: words.join(' '), city: '' };
}

/**
 * Splits a street line at the first unit keyword.
 * '123 Main St Apt 4B' -> { line1: '123 Main St', line2: 'Apt 4B' }
 */
function splitStreetAndUnit_(street) {
  var words = String(street || '').trim().split(/\s+/);
  for (var i = 1; i < words.length; i++) {          // never the first word
    var w = words[i].replace(/\./g, '').toLowerCase();
    if (w.charAt(0) === '#' || UNIT_KEYWORDS_.indexOf(w) !== -1) {
      return { line1: words.slice(0, i).join(' '), line2: words.slice(i).join(' ') };
    }
  }
  return { line1: words.join(' '), line2: '' };
}

/**
 * Reads an address written as one line.
 *
 * Works from the END, because that is where the recognisable things are: a country, a
 * postcode, a state. Each one that matches is consumed, and whatever is left at the
 * front is the street — the right way round, since a parser that guesses the street
 * first gets everything after its first mistake wrong too.
 *
 * RETURNS NOTHING WHEN IT CANNOT TELL. If no city, state, postcode or country could
 * be identified, this is not an address it understood, and it says so by returning an
 * empty object. The caller then leaves the row's columns blank and flags it. The
 * previous version instead put the whole line into Address Line 1, which is the bug
 * that prompted this rewrite: a row that LOOKS filled in, with a one-line address and
 * no city, and only shows up as wrong when somebody goes to print an envelope.
 *
 * @param {string} text  e.g. '123 Main Street, Apt 4B, Austin, Texas 78701, USA'
 * @returns {Object} any of Address Line 1/2, City, State, Postal Code, Country
 */
function parseFullAddress_(text) {
  var out  = {};
  var segs = String(text || '')
    .replace(/[\r\n]+/g, ',')
    .split(',')
    .map(function(p) { return p.replace(/\s+/g, ' ').trim(); })
    .filter(function(p) { return p !== ''; });
  if (!segs.length) return out;

  // ---- country, from the last segment or the last word or two of it ----
  var last = segs[segs.length - 1];
  var c    = parseCountry_(last);
  if (c) { out['Country'] = c; segs.pop(); }
  else {
    var lw = last.split(' ');
    for (var take = Math.min(3, lw.length); take >= 1 && !out['Country']; take--) {
      var tail = lw.slice(lw.length - take).join(' ');
      var hit  = parseCountry_(tail);
      // Only when something is left in front of it, or 'Egypt' alone would be a
      // country with no address attached rather than the city it probably is.
      if (hit && (lw.length > take || segs.length > 1)) {
        out['Country'] = hit;
        segs[segs.length - 1] = lw.slice(0, lw.length - take).join(' ');
        if (!segs[segs.length - 1]) segs.pop();
      }
    }
  }

  // ---- postcode and state, BY POSITION in the tail segment ----
  //
  // Both normally sit in the city's own segment ('Austin TX 78701'), so this reads
  // words rather than comma position — but strictly from the end, and the state only
  // where a state actually goes. Sweeping the whole segment for 'anything that looks
  // like a state' is how 'NE' in '10400 NE 4th St' became Nebraska.
  if (segs.length) {
    var words = segs[segs.length - 1].split(' ');

    // 1. A postcode at the very end. Two words for the UK and Canada.
    var two = words.length > 1
      ? parsePostalCode_(words[words.length - 2] + ' ' + words[words.length - 1]) : '';
    if (two) { out['Postal Code'] = two; words.length -= 2; }
    else if (parsePostalCode_(words[words.length - 1])) {
      out['Postal Code'] = parsePostalCode_(words[words.length - 1]);
      words.pop();
    }

    // 2. A state immediately before it — or at the end when there is no postcode.
    //    TWO WORDS FIRST, or 'West Virginia' matches on 'Virginia' alone and comes
    //    out as VA with a city of 'West'. Every two-word state ends in a word that
    //    is either a state itself or looks like one.
    if (words.length > 1 &&
        parseUsState_(words[words.length - 2] + ' ' + words[words.length - 1])) {
      out['State'] = parseUsState_(words[words.length - 2] + ' ' + words[words.length - 1]);
      words.length -= 2;
    } else if (words.length && parseUsState_(words[words.length - 1])) {
      out['State'] = parseUsState_(words[words.length - 1]);
      words.pop();
    }

    // 3. Postcode BEFORE the city, as most of the world writes it ('75001 Paris').
    //    Guarded by the street suffix: in '10400 NE 4th St' the leading number is a
    //    house number, and the 'St' is what says so.
    if (!out['Postal Code'] && words.length > 1 && parsePostalCode_(words[0]) &&
        !words.some(isStreetSuffix_)) {
      out['Postal Code'] = parsePostalCode_(words[0]);
      words.shift();
    }

    if (words.length) segs[segs.length - 1] = words.join(' ');
    else segs.pop();
  }

  // ---- city ----
  // Its own segment when there is still a street in front of it, so a lone 'Cairo' is
  // not read as a city with no address attached.
  if (segs.length > 1) out['City'] = segs.pop();
  else if (segs.length === 1 && (out['State'] || out['Postal Code'])) {
    // One segment holding street AND city, anchored by the state we just took:
    // '12 Elm St Austin'. The street's suffix is the cut.
    var both = splitStreetAndCity_(segs[0]);
    if (both.city) { out['City'] = both.city; segs[0] = both.street; }
    else if (!/\d/.test(segs[0])) out['City'] = segs.pop();
  }

  // ---- street, split at a unit keyword ----
  if (segs.length) {
    var street = splitStreetAndUnit_(segs.shift());
    out['Address Line 1'] = street.line1;
    // Anything still unclaimed — 'Zamalek', a building name — joins line 2 rather
    // than being dropped. Losing half an address silently is the worst outcome here.
    var line2 = [street.line2].concat(segs).filter(function(v) { return v; });
    if (line2.length) out['Address Line 2'] = line2.join(', ');
  }

  // THE CONFIDENCE RULE. A street line and nothing else is not an address that was
  // understood; it is the whole string sitting in one field, which is what this
  // rewrite exists to stop.
  if (!out['City'] && !out['State'] && !out['Postal Code'] && !out['Country']) return {};
  return out;
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
var ADDRESS_BOOK_ID_SEQ_ = 0;

/**
 * A new row id.
 *
 * THE COUNTER IS THE PART THAT MATTERS. This used to be Date.now() plus three random
 * digits, which inside the import's loop means Date.now() never changes and there are
 * a THOUSAND POSSIBLE IDS PER MILLISECOND. Measured against the real generator: 68
 * households collide 88.7% of the time, 121 people 99.9%. The live book is 68 and 121.
 *
 * Two households sharing an id is not a cosmetic problem. membersOf(id) returns the
 * union, so both show the other's people and a search for one matches the other;
 * key={h.id} collides and React corrupts the list on re-render; findAddressBookRow_
 * returns the first match, so editing the second household edits the first; and
 * deleteAddressBookRowsFor_ removes EVERY row with that id, so deleting one household
 * takes the other's members with it and leaves it standing and empty.
 *
 * More random bits would only have lengthened the odds. A sequence makes a collision
 * within one execution impossible, and one execution is exactly where the loop lives.
 * Date.now() separates executions; the random tail covers two of them starting in the
 * same millisecond, which is Ahmed and Victoria importing at once.
 */
function newAddressBookId_(prefix) {
  ADDRESS_BOOK_ID_SEQ_++;
  return prefix + '-' + Date.now().toString(36) + '-' +
         ADDRESS_BOOK_ID_SEQ_.toString(36) + '-' +
         Math.random().toString(36).slice(2, 8);
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
