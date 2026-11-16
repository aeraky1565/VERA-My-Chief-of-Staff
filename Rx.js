// ============================================================
// VERA — Rx.js
// Health › Prescriptions: "✓ Refilled today" sets Last Filled to today and the next Refill Date
// from Days Supply (or, without it, the last gap between fills); a nightly flag 7 days before a
// refill is due (Medium; High once overdue), closed when the date moves on. Victoria's refills also
// show on her lite Today (liteNeedsYou_, the shared NeedsYou block).
// ============================================================

var RX_AHEAD_DAYS_ = 7;
var RX_FLAG_PREFIX_ = 'rx_refill_';

function rxYmd_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

function rxUtc_(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function rxAdd_(iso, n) { var d = new Date(rxUtc_(iso) + n * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }

/** Pure: days from today to a refill date (negative when overdue), null without a date. */
function rxDays_(refillIso, todayIso) { return refillIso ? Math.round((rxUtc_(refillIso) - rxUtc_(todayIso)) / 86400000) : null; }

/** Pure: the next refill date after filling today: + Days Supply, else the last gap, else ''. */
function rxNext_(todayIso, daysSupply, lastFilledIso, refillIso) {
  var n = parseInt(daysSupply, 10);
  if (n > 0 && n <= 400) return rxAdd_(todayIso, n);
  if (lastFilledIso && refillIso) { var gap = rxDays_(refillIso, lastFilledIso); if (gap > 0 && gap <= 400) return rxAdd_(todayIso, gap); }
  return '';
}

/** Pure: the active prescriptions due for a refill within 7 days (or overdue). rows: [{id, person, medication, refillDate, active}] */
function rxDue_(rows, todayIso) {
  return (rows || []).filter(function(r) { return String(r.active || 'Yes') === 'Yes'; }).map(function(r) { return Object.assign({}, r, { days: rxDays_(r.refillDate, todayIso) }); })
    .filter(function(r) { return r.days != null && r.days <= RX_AHEAD_DAYS_; }).sort(function(a, b) { return a.days - b.days; });
}

/** GET rx_refilled — id: Last Filled today, Refill Date moved on. → {ok, lastFilled, refillDate} */
function webRxRefilled_(e) {
  var id = String(((e && e.parameter) || {}).id || '').trim();
  if (!id) throw new Error('id is required');
  var sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(TABS.PRESCRIPTIONS);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Prescription not found: ' + id);
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, PRESCRIPTION_HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== id) continue;
    var next = rxNext_(today, rows[i][10], rxYmd_(rows[i][8], tz), rxYmd_(rows[i][9], tz));
    sheet.getRange(i + 2, 9, 1, 2).setValues([[today, next]]);   // Last Filled, Refill Date
    return { ok: true, id: id, lastFilled: today, refillDate: next };
  }
  throw new Error('Prescription not found: ' + id);
}

/** Nightly: a flag for each refill due within 7 days (Medium; High when overdue). */
function checkRefills_() {
  var ss = getSpreadsheet(), flagSheet = ss.getSheetByName(TABS.FLAGS);
  if (!flagSheet) return { skipped: 'no flags tab' };
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), wanted = {};
  var rows = (webGetPrescriptions_().prescriptions || []);
  rxDue_(rows, today).forEach(function(r) {
    var when = r.days < 0 ? 'overdue by ' + (-r.days) + ' day' + (r.days === -1 ? '' : 's') : r.days === 0 ? 'due today' : 'due in ' + r.days + ' day' + (r.days === 1 ? '' : 's');
    wanted[RX_FLAG_PREFIX_ + r.id] = { flag: '💊 Refill ' + r.medication + (r.person ? ' (' + r.person + ')' : '') + ': ' + when,
      reason: 'Refill date ' + r.refillDate + (r.pharmacy ? ' · ' + r.pharmacy : '') + (r.rxNumber ? ' · Rx ' + r.rxNumber : '') + '. Tap ✓ Refilled today in Health › Prescriptions once it’s picked up.',
      urgency: r.days < 0 ? 'High' : 'Medium' };
  });
  upsertKeyedFlags_(flagSheet, RX_FLAG_PREFIX_, 'Prescriptions', wanted, today);
  return { due: Object.keys(wanted).length };
}
