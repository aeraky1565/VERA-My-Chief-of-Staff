// ============================================================
// VERA — Accounts.js
// Finances › Accounts: "Keep at least" per account. A bill with no amount is estimated from the
// average of its last 3 payments in the transactions sheet (read only, bsReadTransactions_ in
// BillSchedule.js), matched the way the Bills reconcile matches (bill words, Config aliases).
// The arithmetic (yearly bills set aside monthly) is on the dashboard (acMinimum_).
// ============================================================

var AC_EST_MONTHS_ = 12, AC_EST_PAYMENTS_ = 3;

/** Pure: the last 12 months as yyyy-MM, newest first, from today's yyyy-MM. */
function acMonths_(ym, n) {
  var y = Number(String(ym).slice(0, 4)), m = Number(String(ym).slice(5, 7)), out = [];
  for (var i = 0; i < (n || AC_EST_MONTHS_); i++) { out.push(y + '-' + String(m).padStart(2, '0')); m--; if (m === 0) { m = 12; y--; } }
  return out;
}

/**
 * Pure: per bill name, the average of its last 3 payments (money out), newest months first.
 * bills: [{bill}], tx: [{month, description, amount}], aliasMap: {keyword: 'Bill Name'}.
 * → { 'Bill name': { amount, count, months:[…] } } (only bills with at least one payment)
 */
function acEstimates_(bills, tx, aliasMap) {
  aliasMap = aliasMap || {};
  var spend = (tx || []).filter(function(t) { return t.amount < 0; }).slice().sort(function(a, b) { return String(b.month).localeCompare(String(a.month)); });
  var out = {};
  (bills || []).forEach(function(b) {
    var name = String(b.bill || '').trim(); if (!name) return;
    var words = bsWords_(name), low = name.toLowerCase();
    var aliases = Object.keys(aliasMap).filter(function(k) { return String(aliasMap[k]).toLowerCase() === low; }).map(function(k) { return k.toLowerCase(); });
    if (!words.length && !aliases.length) return;
    var hits = spend.filter(function(t) { var d = String(t.description || '').toLowerCase();
      return words.some(function(w) { return d.indexOf(w) !== -1; }) || aliases.some(function(a) { return d.indexOf(a) !== -1; }); }).slice(0, AC_EST_PAYMENTS_);
    if (!hits.length) return;
    var avg = hits.reduce(function(s, t) { return s - t.amount; }, 0) / hits.length;
    out[name] = { amount: Math.round(avg * 100) / 100, count: hits.length, months: hits.map(function(t) { return t.month; }) };
  });
  return out;
}

/** GET bill_estimates — the estimate for each bill with no amount. → { ok, estimates, source: 'transactions' | 'none' } */
function webBillEstimates_() {
  var bills = (webGetBills_().bills || []).filter(function(b) { return b.type !== 'Income' && (b.amount == null || b.amount === ''); });
  if (!bills.length) return { ok: true, estimates: {}, source: 'none' };
  var ym = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  var tx = bsReadTransactions_(acMonths_(ym, AC_EST_MONTHS_));
  if (!tx) return { ok: true, estimates: {}, source: 'none' };
  var aliases = {}; try { aliases = getConfigAliases_() || {}; } catch (e) { aliases = {}; }
  return { ok: true, estimates: acEstimates_(bills, tx, aliases), source: 'transactions' };
}
