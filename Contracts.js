// ============================================================
// VERA — Contracts.js
// Finances › Contracts: each contract's "warn me N days ahead" is the Notice Period Days column,
// 60 by default (a blank or unreadable cell reads as 60; contracts that already say 30 keep 30).
// Shop around makes a Task "Get quotes for …", due a week before the contract ends (today when
// that has passed); one open Task per contract, tagged in its notes.
// ============================================================

var CT_WARN_DEFAULT_ = 60;
var CT_TASK_TAG_ = 'VERA contract shop:';

/** Pure: a contract's warning window in days (1–365), 60 when blank or unreadable. */
function ctWarnDays_(v) {
  var n = parseInt(v, 10);
  return n >= 1 && n <= 365 ? n : CT_WARN_DEFAULT_;
}

/** Pure: when the Shop around Task is due: a week before the end date, never before today. */
function ctShopDue_(endIso, todayIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(endIso || ''))) return todayIso;
  var p = endIso.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] - 7));
  var iso = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  return iso < todayIso ? todayIso : iso;
}

/** GET contract_shop_around — id: a Task "Get quotes for <name>" (kept if one is already open). → {ok, made, taskId, due} */
function webContractShopAround_(e) {
  var id = String(((e && e.parameter) || {}).id || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var c = getContracts_().filter(function(x) { return x.id === id; })[0];
  if (!c) return { ok: false, error: 'not found' };
  var sheet = getSpreadsheet().getSheetByName(TABS.TASKS);
  if (!sheet) return { ok: false, error: 'Tasks tab not found' };
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var tag = CT_TASK_TAG_ + id, due = ctShopDue_(c.endDate, today);
  var last = sheet.getLastRow(), rows = last >= 2 ? sheet.getRange(2, 1, last - 1, TASK_HEADERS.length).getValues() : [];
  for (var i = 0; i < rows.length; i++) {
    // TASK_HEADERS: ID | Task | Added Date | Due Date | Status | Recurring | Notes | Flagged | Completed
    if (String(rows[i][6] || '').indexOf(tag) !== -1 && String(rows[i][4]).trim() === 'Open') return { ok: true, made: false, taskId: String(rows[i][0]), due: String(rows[i][3]) };
  }
  return veraLocked_(function() {
    var tid = taskNextId_(sheet, Utilities.formatDate(new Date(), tz, 'yyyyMMdd'));
    var who = c.counterparty ? ' (' + c.counterparty + ')' : '';
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, TASK_HEADERS.length).setValues([[tid, 'Get quotes for ' + c.name + who, today, due, 'Open', '',
      tag + ' (from Contracts: shop around before ' + (c.endDate || 'it renews') + ')', '', '']]);
    return { ok: true, made: true, taskId: tid, due: due };
  });
}
