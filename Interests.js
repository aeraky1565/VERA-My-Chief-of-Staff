// ============================================================
// VERA — Interests.js
// CRUD for the Shared Interest Ledger tab (Issue #28)
// Tracks things Ahmed and Victoria mention liking or wanting to try.
// VERA's Explorer brain cross-references this ledger for
// personalised discovery suggestions.
// ============================================================

const INTEREST_COL = {
  ID:       0,
  DATE:     1,
  PERSON:   2,
  INTEREST: 3,
  CATEGORY: 4,
  SOURCE:   5,
  NOTES:    6,
  STATUS:   7,
};

const INTEREST_CATEGORIES = ['Food', 'Travel', 'Fitness', 'Culture', 'Hobbies', 'Learning', 'Other'];
const INTEREST_PERSONS    = ['Ahmed', 'Victoria'];

// ============================================================
// READ
// ============================================================

/**
 * Returns all Active interest rows ordered by Date Added descending.
 * Soft-deleted (Archived) rows are excluded.
 *
 * @returns {Array} Array of interest objects
 */
function getSharedInterestLedger_() {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.INTEREST_LEDGER);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var numRows = sheet.getLastRow() - 1;
  var data    = sheet.getRange(2, 1, numRows, INTEREST_LEDGER_HEADERS.length).getValues();

  return data
    .map(function(row, i) { return { row: i + 2, data: row }; })
    .filter(function(r) {
      return String(r.data[INTEREST_COL.ID] || '').trim() !== '' &&
             String(r.data[INTEREST_COL.STATUS] || 'Active').toLowerCase() !== 'archived';
    })
    .map(function(r) {
      var row = r.data;
      return {
        id:       String(row[INTEREST_COL.ID]       || ''),
        date:     formatDateVal_(row[INTEREST_COL.DATE]),
        person:   String(row[INTEREST_COL.PERSON]   || ''),
        interest: String(row[INTEREST_COL.INTEREST] || ''),
        category: String(row[INTEREST_COL.CATEGORY] || 'Other'),
        source:   String(row[INTEREST_COL.SOURCE]   || 'Manual'),
        notes:    String(row[INTEREST_COL.NOTES]    || ''),
        status:   String(row[INTEREST_COL.STATUS]   || 'Active'),
        rowNum:   r.row,
      };
    })
    .sort(function(a, b) {
      // Newest first — fall back to rowNum descending if dates match
      if (b.date > a.date) return 1;
      if (b.date < a.date) return -1;
      return b.rowNum - a.rowNum;
    });
}

// ============================================================
// CREATE
// ============================================================

/**
 * Appends a new interest row and returns the created interest object.
 *
 * @param {string} person   - 'Ahmed' or 'Victoria'
 * @param {string} interest - Free text description (required)
 * @param {string} category - One of INTEREST_CATEGORIES
 * @param {string} source   - 'Chat' or 'Manual'
 * @param {string} notes    - Optional context
 * @returns {Object} The created interest object
 */
function createInterest_(person, interest, category, source, notes) {
  if (!interest || interest.trim() === '') throw new Error('Interest text is required.');

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.INTEREST_LEDGER);
  if (!sheet) throw new Error('Shared Interests tab not found. Run setupVERA() or addInterestLedgerTab() first.');

  var tz          = Session.getScriptTimeZone();
  var today       = new Date();
  var dateStr     = Utilities.formatDate(today, tz, 'yyyyMMdd');
  var dateDisplay = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  // Sequence number: count existing INT-YYYYMMDD-* rows for today
  var seq = 1;
  if (sheet.getLastRow() >= 2) {
    var idData = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    idData.forEach(function(r) {
      if (String(r[0] || '').indexOf('INT-' + dateStr) === 0) seq++;
    });
  }
  var id = 'INT-' + dateStr + '-' + String(seq).padStart(2, '0');

  // Normalise
  var cleanPerson   = INTEREST_PERSONS.indexOf(person) !== -1 ? person : 'Ahmed';
  var cleanCategory = INTEREST_CATEGORIES.indexOf(category) !== -1 ? category : 'Other';
  var cleanSource   = (source === 'Chat' || source === 'Manual') ? source : 'Manual';

  var row = [
    id,
    dateDisplay,
    cleanPerson,
    String(interest || '').trim(),
    cleanCategory,
    cleanSource,
    String(notes || '').trim(),
    'Active',
  ];

  sheet.appendRow(row);
  Logger.log('createInterest_: created ' + id + ' — ' + cleanPerson + ': ' + interest);

  return {
    id:       id,
    date:     dateDisplay,
    person:   cleanPerson,
    interest: row[INTEREST_COL.INTEREST],
    category: cleanCategory,
    source:   cleanSource,
    notes:    row[INTEREST_COL.NOTES],
    status:   'Active',
    rowNum:   sheet.getLastRow(),
  };
}

// ============================================================
// DELETE (soft)
// ============================================================

/**
 * Archives an interest by setting its Status to 'Archived'.
 * The row is never physically deleted — it remains auditable.
 *
 * @param {string} id - The interest ID (e.g. 'INT-20260309-01')
 * @returns {boolean} true if found and archived, false if not found
 */
function deleteInterest_(id) {
  if (!id) throw new Error('Interest ID is required.');

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.INTEREST_LEDGER);
  if (!sheet || sheet.getLastRow() < 2) return false;

  var numRows = sheet.getLastRow() - 1;
  var ids     = sheet.getRange(2, 1, numRows, 1).getValues();

  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) {
      var rowNum = i + 2;
      sheet.getRange(rowNum, INTEREST_COL.STATUS + 1).setValue('Archived');
      Logger.log('deleteInterest_: archived ' + id);
      return true;
    }
  }

  Logger.log('deleteInterest_: ID not found — ' + id);
  return false;
}
