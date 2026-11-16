// ============================================================
// HouseholdInfo.js — Household cheat sheet
// Sheet: HouseholdInfo | columns: Section, Subsection, Label, Value, Notes, LastUpdated,
//                         Private, Emergency
// Private: Yes / No, or blank (blank = guessed from the label: IDs, account, policy and member
//   numbers; the dashboard's hfGuidePrivate_). Emergency: Yes puts the line on the pinned card.
// ============================================================

var HH_COLS_ = 8;
var HH_HEADERS_ = ['Section', 'Subsection', 'Label', 'Value', 'Notes', 'LastUpdated', 'Private', 'Emergency'];

/** Pure: a Yes/No cell as true / false, blank as null (not set). */
function hhFlag_(v) {
  if (v === true) return true;
  if (v === false) return false;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === 'yes' || s === 'true' || s === 'y') return true;
  if (s === 'no' || s === 'false' || s === 'n') return false;
  return null;
}

/** Names the two new columns on a sheet made before they existed. */
function hhEnsureCols_(sheet) {
  if (sheet.getMaxColumns() < HH_COLS_) sheet.insertColumnsAfter(sheet.getMaxColumns(), HH_COLS_ - sheet.getMaxColumns());
  var head = sheet.getRange(1, 7, 1, 2).getValues()[0];
  if (!String(head[0]).trim() || !String(head[1]).trim()) sheet.getRange(1, 7, 1, 2).setValues([['Private', 'Emergency']]);
}

/** A flag param from the dashboard: 'true' / 'false', or absent (keep what's there). */
function hhParam_(p, prev) {
  if (p === undefined || p === null || p === '') return prev;
  return String(p) === 'true' ? 'Yes' : 'No';
}

function getHouseholdInfoData_() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.HOUSEHOLD_INFO);
  const sheetUrl = 'https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '/edit'
                 + (sheet ? '#gid=' + sheet.getSheetId() : '');

  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: true, sections: [], sheetUrl: sheetUrl };
  }

  const numRows = sheet.getLastRow() - 1;
  const width   = Math.min(HH_COLS_, sheet.getMaxColumns());
  const data    = sheet.getRange(2, 1, numRows, width).getValues();

  const sectionOrder = [];
  const sectionMap   = {};

  data.forEach(function(row, rowIndex) {
    const section     = String(row[0] || '').trim();
    const subsection  = String(row[1] || '').trim();
    const label       = String(row[2] || '').trim();
    // A value cell holding a real date (a policy renewal, an expiry) would
    // otherwise stringify to "Fri Sep 19 2026 00:00:00 GMT-0400 (…)". String()
    // runs before jsonOut_ normalises, so it has to be caught here.
    const value       = formatDateVal_(row[3]).trim();
    const notes       = formatDateVal_(row[4]).trim();
    const lastUpdated = row[5] ? formatDateVal_(row[5]) : '';

    if (!section || !label || !value) return;

    if (!sectionMap[section]) {
      sectionMap[section] = { section: section, lastUpdated: '', subsectionOrder: [], subsectionMap: {} };
      sectionOrder.push(section);
    }
    const sec = sectionMap[section];
    if (lastUpdated && lastUpdated > sec.lastUpdated) sec.lastUpdated = lastUpdated;

    const subKey = subsection || '';
    if (!sec.subsectionMap[subKey]) {
      sec.subsectionMap[subKey] = { subsection: subsection, rows: [] };
      sec.subsectionOrder.push(subKey);
    }
    sec.subsectionMap[subKey].rows.push({
      rowNum:    rowIndex + 2, // 1-indexed sheet row (row 1 = headers)
      label:     label,
      value:     value,
      notes:     notes,
      section:   section,
      subsection: subsection,
      updated:   lastUpdated,
      private:   hhFlag_(row[6]),
      star:      hhFlag_(row[7]) === true,
    });
  });

  const sections = sectionOrder.map(function(sKey) {
    const sec = sectionMap[sKey];
    return {
      section:     sec.section,
      lastUpdated: sec.lastUpdated,
      subsections: sec.subsectionOrder.map(function(subKey) {
        return sec.subsectionMap[subKey];
      }),
    };
  });

  return { ok: true, sections: sections, sheetUrl: sheetUrl };
}

function webGetHouseholdInfo_() {
  return getHouseholdInfoData_();
}

function webUpdateHouseholdRow_(e) {
  const rowNum     = parseInt(e.parameter.rowNum, 10);
  const section    = String(e.parameter.section    || '').trim();
  const subsection = String(e.parameter.subsection || '').trim();
  const label      = String(e.parameter.label      || '').trim();
  const value      = String(e.parameter.value      || '').trim();
  const notes      = String(e.parameter.notes      || '').trim();

  if (!rowNum || rowNum < 2) return { ok: false, error: 'Invalid rowNum' };
  if (!section || !label || !value) return { ok: false, error: 'section, label, and value are required' };

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.HOUSEHOLD_INFO);
  if (!sheet) return { ok: false, error: 'HouseholdInfo sheet not found' };
  if (rowNum > sheet.getLastRow()) return { ok: false, error: 'That line is gone; reload' };

  hhEnsureCols_(sheet);
  const prev  = sheet.getRange(rowNum, 7, 1, 2).getValues()[0];
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.getRange(rowNum, 1, 1, HH_COLS_).setValues([[section, subsection, label, value, notes, today,
    hhParam_(e.parameter.private, prev[0]), hhParam_(e.parameter.star, prev[1])]]);
  return { ok: true };
}

function webAddHouseholdRow_(e) {
  const section    = String(e.parameter.section    || '').trim();
  const subsection = String(e.parameter.subsection || '').trim();
  const label      = String(e.parameter.label      || '').trim();
  const value      = String(e.parameter.value      || '').trim();
  const notes      = String(e.parameter.notes      || '').trim();

  if (!section || !label || !value) return { ok: false, error: 'section, label, and value are required' };

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.HOUSEHOLD_INFO);
  if (!sheet) return { ok: false, error: 'HouseholdInfo sheet not found' };

  hhEnsureCols_(sheet);
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.appendRow([section, subsection, label, value, notes, today,
    hhParam_(e.parameter.private, ''), hhParam_(e.parameter.star, '')]);
  return { ok: true };
}

/**
 * GET household_section_checked?section=… — "Still right ✓": stamps today on every line of a
 * section, so it stops being marked for a re-check. Changes nothing else.
 */
function webHouseholdSectionChecked_(e) {
  const section = String((e.parameter || {}).section || '').trim();
  if (!section) return { ok: false, error: 'section required' };
  const sheet = getSpreadsheet().getSheetByName(TABS.HOUSEHOLD_INFO);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'HouseholdInfo sheet not found' };
  const n = sheet.getLastRow() - 1;
  const names = sheet.getRange(2, 1, n, 1).getValues();
  const dates = sheet.getRange(2, 6, n, 1).getValues();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  let count = 0;
  names.forEach(function(r, i) { if (String(r[0]).trim() === section) { dates[i][0] = today; count++; } });
  if (!count) return { ok: false, error: 'No section called ' + section };
  sheet.getRange(2, 6, n, 1).setValues(dates);
  return { ok: true, section: section, lines: count, updated: today };
}

function webDeleteHouseholdRow_(e) {
  const rowNum = parseInt(e.parameter.rowNum, 10);
  if (!rowNum || rowNum < 2) return { ok: false, error: 'Invalid rowNum' };

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.HOUSEHOLD_INFO);
  if (!sheet) return { ok: false, error: 'HouseholdInfo sheet not found' };

  sheet.deleteRow(rowNum);
  return { ok: true };
}

function setupHouseholdInfoSheet() { setupHouseholdInfoSheet_(); }

// Run once manually to create the sheet with headers + sample placeholder rows.
function setupHouseholdInfoSheet_() {
  const ss    = getSpreadsheet();
  if (ss.getSheetByName(TABS.HOUSEHOLD_INFO)) {
    Logger.log('HouseholdInfo sheet already exists — skipping setup.');
    return;
  }
  const sheet = ss.insertSheet(TABS.HOUSEHOLD_INFO);
  const headers = HH_HEADERS_.slice();
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setColumnWidths(1, 2, 160);
  sheet.setColumnWidth(3, 160);
  sheet.setColumnWidth(4, 260);
  sheet.setColumnWidth(5, 200);
  sheet.setColumnWidth(6, 120);

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const samples = [
    ['Home Base',           '',                 'Address',          '123 Main St, City, ST 00000', '', today],
    ['Home Base',           '',                 'Landlord',         'Name — (555) 000-0000',       '', today],
    ['Home Base',           '',                 'Lease End',        'Month DD, YYYY',              '', today],
    ['Emergency Contacts',  '',                 'Name',             'Full Name — (555) 000-0000',  'Relationship', today],
    ['Insurance',           'Health – Ahmed',   'Provider',         'Insurance Co',                '', today],
    ['Insurance',           'Health – Ahmed',   'Member ID',        'MEMBER000',                   '', today],
    ['Insurance',           'Health – Victoria','Provider',         'Insurance Co',                '', today],
    ['Insurance',           'Health – Victoria','Member ID',        'MEMBER000',                   '', today],
    ['Insurance',           'Renters/Home',     'Provider',         'Insurance Co',                '', today],
    ['Insurance',           'Renters/Home',     'Policy Number',    'POL-000000',                  '', today],
    ['Insurance',           'Auto',             'Provider',         'Insurance Co',                '', today],
    ['Insurance',           'Auto',             'Policy Number',    'POL-000000',                  '', today],
    ['Utilities',           'Electric',         'Provider',         'Electric Co',                 '', today],
    ['Utilities',           'Electric',         'Account Number',   'ACCT-000',                    '', today],
    ['Utilities',           'Internet',         'Provider',         'ISP Name',                    '', today],
    ['Utilities',           'Internet',         'Account Number',   'ACCT-000',                    '', today],
    ['Medical',             'Ahmed',            'Primary Care',     'Dr. Name — (555) 000-0000',   '', today],
    ['Medical',             'Victoria',         'Primary Care',     'Dr. Name — (555) 000-0000',   '', today],
    ['Medical',             '',                 'Pharmacy',         'Pharmacy Name — Address',     '', today],
    ['Key Docs Location',   '',                 'Passports',        'Location description',        '', today],
    ['Key Docs Location',   '',                 'Birth Certificates','Location description',       '', today],
  ];
  if (samples.length) sheet.getRange(2, 1, samples.length, 6).setValues(samples);   // Private / Emergency left blank
  Logger.log('HouseholdInfo sheet created with ' + samples.length + ' sample rows.');
}
