// ============================================================
// HouseholdInfo.js — Household cheat sheet
// Sheet: HouseholdInfo | columns: Section, Subsection, Label, Value, Notes, LastUpdated
// ============================================================

function getHouseholdInfoData_() {
  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(TABS.HOUSEHOLD_INFO);
  const sheetUrl = 'https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '/edit'
                 + (sheet ? '#gid=' + sheet.getSheetId() : '');

  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: true, sections: [], sheetUrl: sheetUrl };
  }

  const numRows = sheet.getLastRow() - 1;
  const data    = sheet.getRange(2, 1, numRows, 6).getValues();

  const sectionOrder = [];
  const sectionMap   = {};

  data.forEach(function(row, rowIndex) {
    const section     = String(row[0] || '').trim();
    const subsection  = String(row[1] || '').trim();
    const label       = String(row[2] || '').trim();
    const value       = String(row[3] || '').trim();
    const notes       = String(row[4] || '').trim();
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

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.getRange(rowNum, 1, 1, 6).setValues([[section, subsection, label, value, notes, today]]);
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

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sheet.appendRow([section, subsection, label, value, notes, today]);
  return { ok: true };
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
  const headers = ['Section', 'Subsection', 'Label', 'Value', 'Notes', 'LastUpdated'];
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
  if (samples.length) sheet.getRange(2, 1, samples.length, 6).setValues(samples);
  Logger.log('HouseholdInfo sheet created with ' + samples.length + ' sample rows.');
}
