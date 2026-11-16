// ============================================================
// VERA — HomeSteward.js
// Home Front › Warranties & Service, beyond the basic read/add/record in WebApp.js:
//   - two link columns on Home Items, after Notes: Receipt (I) and Manual (J);
//   - Snooze 1 week (moves Next Service to a week from today);
//   - the nightly step for an overdue service: one Medium flag AND one Task per item,
//     kept in step with the date, the Task closed when the service is recorded.
// ============================================================

var HS_RECEIPT_COL_ = 9, HS_MANUAL_COL_ = 10;
var HS_FLAG_PREFIX_ = 'home_service_overdue_';
var HS_FLAG_SOURCE_ = 'Home service';
var HS_TASK_TAG_ = 'VERA home service:';   // in a Task's Notes, then the item's slug

/** Pure: an item name as a key. */
function hsSlug_(item) { return String(item || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }

/** Pure: a link is blank or an http(s) address. */
function hsLinkOk_(v) { var s = String(v || '').trim(); return !s || /^https?:\/\/\S+$/i.test(s); }

/** Pure: a date a number of days after an ISO date, as ISO. */
function hsAddDays_(iso, n) { var p = String(iso).split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)); return d.toISOString().slice(0, 10); }

/** Names the link columns on a tab made before they existed. */
function hsEnsureLinkCols_(sheet) {
  if (sheet.getMaxColumns() < HS_MANUAL_COL_) sheet.insertColumnsAfter(sheet.getMaxColumns(), HS_MANUAL_COL_ - sheet.getMaxColumns());
  var h = sheet.getRange(1, HS_RECEIPT_COL_, 1, 2).getValues()[0];
  if (!String(h[0]).trim() || !String(h[1]).trim()) sheet.getRange(1, HS_RECEIPT_COL_, 1, 2).setValues([['Receipt', 'Manual']]);
}

/** The row, checked against the name the dashboard believes is there (a stale list must not write the wrong item). */
function hsRow_(p) {
  var rowNum = parseInt(p.row || '0', 10);
  if (isNaN(rowNum) || rowNum < 2) throw new Error('Invalid row: ' + p.row);
  var sheet = getSpreadsheet().getSheetByName(TABS.HOME_ITEMS);
  if (!sheet) throw new Error('Home Items tab not found');
  if (rowNum > sheet.getLastRow()) throw new Error('Row ' + rowNum + ' no longer exists');
  var actual = String(sheet.getRange(rowNum, 1).getValue() || '').trim(), expected = String(p.item || '').trim();
  if (expected && expected.toLowerCase() !== actual.toLowerCase())
    throw new Error('Row ' + rowNum + ' holds "' + actual + '", not "' + expected + '" — the list is out of date. Refresh and try again.');
  return { sheet: sheet, rowNum: rowNum, item: actual };
}

/** GET home_item_links?row&item&receipt&manual — sets either link; blank clears it. */
function webHomeItemLinks_(e) {
  var p = e.parameter || {}, r = hsRow_(p);
  if (!hsLinkOk_(p.receipt) || !hsLinkOk_(p.manual)) return { ok: false, error: 'A link has to start with http:// or https://' };
  hsEnsureLinkCols_(r.sheet);
  var cur = r.sheet.getRange(r.rowNum, HS_RECEIPT_COL_, 1, 2).getValues()[0];
  var receipt = p.receipt === undefined ? cur[0] : String(p.receipt).trim(), manual = p.manual === undefined ? cur[1] : String(p.manual).trim();
  r.sheet.getRange(r.rowNum, HS_RECEIPT_COL_, 1, 2).setValues([[receipt, manual]]);
  return { ok: true, item: r.item, receipt: receipt, manual: manual };
}

/** GET home_item_snooze?row&item — Next Service a week from today; its Task follows. */
function webHomeItemSnooze_(e) {
  var r = hsRow_(e.parameter || {});
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var next = hsAddDays_(today, 7);
  r.sheet.getRange(r.rowNum, 6).setValue(next);   // Col F = Next Service
  try { hsSyncTask_(r.item, next, false); } catch (err) { Logger.log('home_item_snooze task: ' + err.message); }
  return { ok: true, item: r.item, nextService: next };
}

/**
 * Keeps one Task per item for an overdue service: made when missing, its due date kept at the
 * Next Service date; done=true marks it Done (the service was recorded).
 */
function hsSyncTask_(item, due, done) {
  var sheet = getSpreadsheet().getSheetByName(TABS.TASKS);
  if (!sheet) return null;
  var tag = HS_TASK_TAG_ + hsSlug_(item), last = sheet.getLastRow();
  var rows = last >= 2 ? sheet.getRange(2, 1, last - 1, TASK_HEADERS.length).getValues() : [];
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  for (var i = 0; i < rows.length; i++) {
    // TASK_HEADERS: ID | Task | Added Date | Due Date | Status | Recurring | Notes | Flagged | Completed
    if (String(rows[i][6] || '').indexOf(tag) === -1 || String(rows[i][4]).trim() !== 'Open') continue;
    if (done) { sheet.getRange(i + 2, 5).setValue('Done'); sheet.getRange(i + 2, 9).setValue(today); return 'done'; }
    if (due && String(rows[i][3]) !== due) sheet.getRange(i + 2, 4).setValue(due);
    return 'kept';
  }
  if (done) return null;
  return veraLocked_(function() {
    var id = taskNextId_(sheet, Utilities.formatDate(new Date(), tz, 'yyyyMMdd'));
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, TASK_HEADERS.length).setValues([[id, '🔧 Service: ' + item, today, due || today, 'Open', '',
      tag + ' (from Warranties & Service; it closes when you record the service)', '', '']]);
    return 'made';
  });
}

/** Pure: the items whose service is overdue on a day. rows: Home Items values (A..). → [{item, next, days, category}] */
function hsOverdue_(rows, todayIso, fmt) {
  var out = [];
  (rows || []).forEach(function(r) {
    var item = String(r[0] || '').trim(), next = r[5] ? fmt(r[5]) : '';
    if (!item || !next || next >= todayIso) return;
    var p = function(x) { var q = x.split('-'); return Date.UTC(+q[0], +q[1] - 1, +q[2]); };
    out.push({ item: item, next: next, days: Math.round((p(todayIso) - p(next)) / 86400000), category: String(r[1] || '').trim() });
  });
  return out;
}

/** Nightly: a Medium flag and a Task for each overdue service; a flag closes once the date moves on. */
function checkHomeServiceOverdue_() {
  var ss = getSpreadsheet(), sheet = ss.getSheetByName(TABS.HOME_ITEMS), flagSheet = ss.getSheetByName(TABS.FLAGS);
  if (!sheet || !flagSheet) return { skipped: 'no tab' };
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var fmt = function(v) { try { return Utilities.formatDate(new Date(v), tz, 'yyyy-MM-dd'); } catch (e) { return ''; } };
  var rows = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, HOME_ITEM_HEADERS.length).getValues() : [];
  var suppressed = [];
  try { suppressed = getSuppressedKeyPatterns_(); } catch (e) {}
  var wanted = {}, made = 0;
  hsOverdue_(rows, today, fmt).forEach(function(o) {
    var key = HS_FLAG_PREFIX_ + hsSlug_(o.item);
    if (suppressed.indexOf(key) !== -1 || suppressed.indexOf('home_service') !== -1) return;
    wanted[key] = { flag: '🔧 ' + o.item + ': service overdue by ' + o.days + ' day' + (o.days === 1 ? '' : 's'),
      reason: 'It was due ' + o.next + (o.category ? ' · ' + o.category : '') + '. Record it in Home Front › Warranties & Service (✓ Done today), or snooze it a week.',
      urgency: 'Medium' };
    try { if (hsSyncTask_(o.item, o.next, false) === 'made') made++; } catch (err) { Logger.log('checkHomeServiceOverdue_ task: ' + err.message); }
  });
  upsertKeyedFlags_(flagSheet, HS_FLAG_PREFIX_, HS_FLAG_SOURCE_, wanted, today);
  return { overdue: Object.keys(wanted).length, tasksMade: made };
}
