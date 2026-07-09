// =============================================================
// VERA — Bank Account CRUD
// Tracks which bank/payment accounts exist and their metadata.
// Bills reference these by Account Name (col F in Bills sheet).
// Called via WebApp.js: get_bank_accounts, add_bank_account,
//   update_bank_account, delete_bank_account
// =============================================================

function webGetBankAccounts_() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(TABS.BANK_ACCOUNTS);
  if (!sheet) return { ok: true, accounts: [] };
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return { ok: true, accounts: [] };
  var accounts = rows.slice(1).map(function (r, i) {
    return {
      row:         i + 2,
      name:        String(r[0] || '').trim(),
      institution: String(r[1] || '').trim(),
      type:        String(r[2] || '').trim(),
      owner:       String(r[3] || '').trim(),
      notes:       String(r[4] || '').trim()
    };
  }).filter(function (a) { return a.name; });
  return { ok: true, accounts: accounts };
}

function webAddBankAccount_(e) {
  var p    = e.parameter || {};
  var name = (p.name || '').trim();
  if (!name) throw new Error('Account name is required');
  var sheet = getSpreadsheet().getSheetByName(TABS.BANK_ACCOUNTS);
  if (!sheet) throw new Error('Bank Accounts tab not found');
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, BANK_ACCOUNT_HEADERS.length).setValues([[
    name,
    (p.institution || '').trim(),
    (p.type        || '').trim(),
    (p.owner       || '').trim(),
    (p.notes       || '').trim()
  ]]);
  return { ok: true, name: name, action: 'created' };
}

function webUpdateBankAccount_(e) {
  var p   = e.parameter || {};
  var row = parseInt(p.row || '0', 10);
  if (!row) return { ok: false, error: 'Missing row' };
  var sheet = getSpreadsheet().getSheetByName(TABS.BANK_ACCOUNTS);
  if (!sheet) return { ok: false, error: 'Bank Accounts tab not found' };
  if (row < 2 || row > sheet.getLastRow()) return { ok: false, error: 'Row out of range' };
  sheet.getRange(row, 1, 1, BANK_ACCOUNT_HEADERS.length).setValues([[
    (p.name        || '').trim(),
    (p.institution || '').trim(),
    (p.type        || '').trim(),
    (p.owner       || '').trim(),
    (p.notes       || '').trim()
  ]]);
  return { ok: true, row: row, action: 'updated' };
}

function webDeleteBankAccount_(e) {
  var row = parseInt((e.parameter && e.parameter.row) || '0', 10);
  if (!row) return { ok: false, error: 'Missing row' };
  var sheet = getSpreadsheet().getSheetByName(TABS.BANK_ACCOUNTS);
  if (!sheet) return { ok: false, error: 'Bank Accounts tab not found' };
  if (row < 2 || row > sheet.getLastRow()) return { ok: false, error: 'Row out of range' };
  sheet.deleteRow(row);
  return { ok: true, deleted: row };
}
