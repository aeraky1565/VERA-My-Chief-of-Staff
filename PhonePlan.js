// ============================================================
// VERA — PhonePlan.js
// Finances › Day to day › Phone plan (issue #226): the family phone plan, read live from its own
// tracker (Config `phone_plan_sheet_id`). One of us pays the whole bill from Joint; the rest of the
// family pays us back, and that money goes on to Joint. VERA shows this month's split and keeps one
// thing of its own: who has paid back this month ("Phone Paybacks"), marked by tapping.
// ============================================================
//
//   1. THE PHONE TRACKER IS ONLY READ, and BY LABEL: the "Bill due M/D" headings pick the month's
//      column; "Total Plan Due", "Our total", "Credit" and the "Bill N - <who>" rows are found by
//      their text. A row whose label can't be found is worked out from the others, or reported.
//   2. The Budget uses this month's plan total and credit in place of the budget tracker's
//      "Family Plan Payment" and "Family Plan Credit" lines (bgWithPhone_, Budget.js).
// ============================================================

var PHN_TAB_ = 'Phone Paybacks';
var PHN_HEADERS_ = ['Month', 'Payer', 'Amount', 'Received At'];

function phnText_(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
function phnNum_(v) { if (typeof v === 'number') return isFinite(v) ? v : null; var s = phnText_(v).replace(/[$,\s]/g, ''); if (!s) return null; var n = parseFloat(s.replace(/[()]/g, '')); return isNaN(n) ? null : (/^\(/.test(s) ? -n : n); }
function phnRound_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/**
 * Pure: the phone tracker's cells → every month it has, and this month's plan.
 * today: 'YYYY-MM-DD'. people: the two of us, by name (theirs are "our" lines; every other
 * "Bill N - …" row is a family member paying back, one payment per bill).
 * → { ok, month, dueDay, dueLabel, total, ours, credit, members:[{name, amount, ours}], payers:[{name, amount}],
 *     months:[{ month, label, dueDay, people:[{name, amount, ours}], total, bills:[{name, amount, ours}], ours, credit }], missing:[] }
 */
function phnParse_(grid, today, people) {
  grid = grid || []; people = (people || []).map(function(p) { return String(p).toLowerCase(); });
  var head = -1, cols = [];
  for (var r = 0; r < grid.length && head === -1; r++) {
    (grid[r] || []).forEach(function(cell, c) { var m = phnText_(cell).match(/^bill due (\d{1,2})\/(\d{1,2})$/i); if (m) cols.push({ col: c, m: Number(m[1]), d: Number(m[2]) }); });
    if (cols.length) head = r;
  }
  if (head === -1) return { ok: false, error: 'The phone tracker has no “Bill due M/D” headings.' };
  var label = function(row) { for (var c = 0; c < Math.min(row.length, cols[0].col); c++) { var t = phnText_(row[c]); if (t) return t; } return ''; };
  var rowsBy = {}, billRows = [], memberRows = [], inMembers = true;
  for (var i = head + 1; i < grid.length; i++) {
    var row = grid[i] || [], l = label(row), low = l.toLowerCase();
    if (!l) continue;
    if (/^(insurance|total plan due|insurance share|total bill checksum)$/i.test(l)) inMembers = false;
    if (/^bill \d+\s*-\s*/i.test(l)) { billRows.push({ name: l.replace(/^bill \d+\s*-\s*/i, ''), label: l, row: row }); continue; }
    if (rowsBy[low] === undefined) rowsBy[low] = row;
    if (inMembers && !/^if it makes/i.test(l)) memberRows.push({ name: l, row: row });
  }
  var y = Number(String(today).slice(0, 4)), mo = Number(String(today).slice(5, 7));
  var isOurs = function(name) { var n = name.toLowerCase(); return people.some(function(p) { return p && n.indexOf(p) !== -1; }); };
  var missing = [];
  var monthOf = function(c) {
    var at = function(row) { return row ? phnNum_(row[c.col]) : null; };
    var ppl = memberRows.map(function(x) { return { name: x.name, amount: at(x.row), ours: isOurs(x.name) }; }).filter(function(x) { return x.amount != null && (x.amount || x.ours); })
      .map(function(x) { x.amount = phnRound_(x.amount); return x; });
    var bills = billRows.map(function(b) { return { name: b.name, label: b.label, amount: at(b.row), ours: isOurs(b.name) }; }).filter(function(b) { return b.amount != null; })
      .map(function(b) { b.amount = phnRound_(b.amount); return b; });
    var total = at(rowsBy['total plan due']), totalFound = total != null;
    if (total == null) total = ppl.reduce(function(s, x) { return s + x.amount; }, 0);
    var ours = at(rowsBy['our total']);
    if (ours == null) ours = bills.length ? bills.filter(function(b) { return b.ours; }).reduce(function(s, b) { return s + b.amount; }, 0) : ppl.filter(function(x) { return x.ours; }).reduce(function(s, x) { return s + x.amount; }, 0);
    var credit = at(rowsBy['credit']);
    if (credit == null) credit = bills.length ? bills.filter(function(b) { return !b.ours; }).reduce(function(s, b) { return s + b.amount; }, 0) : total - ours;
    return { month: (c.m > mo + 1 ? y - 1 : y) + '-' + String(c.m).padStart(2, '0'), label: phnText_(grid[head][c.col]), dueDay: c.d,
      people: ppl, total: phnRound_(total), totalFound: totalFound, bills: bills, ours: phnRound_(ours), credit: phnRound_(credit) };
  };
  var months = cols.map(monthOf).filter(function(m) { return m.people.length || m.totalFound; });
  if (!months.length) return { ok: false, error: 'The phone tracker has no amounts under its “Bill due” headings.' };
  var cur = months.filter(function(m) { return Number(m.month.slice(5)) === mo && m.totalFound; })[0] || months.filter(function(m) { return m.totalFound; }).slice(-1)[0] || months[months.length - 1];
  if (!cur.totalFound) missing.push('Total Plan Due');
  return { ok: true, month: cur.month, dueDay: cur.dueDay, dueLabel: cur.label, total: cur.total, ours: cur.ours, credit: cur.credit,
    members: cur.people, payers: cur.bills.filter(function(b) { return !b.ours && b.amount; }).map(function(b) { return { name: b.name, amount: b.amount }; }),
    months: months, missing: missing, checks: Math.abs(phnRound_(cur.ours + cur.credit) - cur.total) <= 0.05 };
}

/** The phone tracker's first tab, or null when it isn't connected. */
function phnReadGrid_() {
  var id = '';
  try { id = String((getConfigValues() || {})['phone_plan_sheet_id'] || '').trim(); } catch (e) {}
  if (!id) return null;
  try { var ss = SpreadsheetApp.openById(id); return { grid: ss.getSheets()[0].getDataRange().getValues(), title: ss.getName() }; }
  catch (err) { return { error: 'Can’t open the phone tracker: ' + err.message }; }
}

/** This month's plan, or { configured:false } / { error }. people: the two of us, by name. */
function phnPlan_(people) {
  var g = phnReadGrid_();
  if (!g) return { configured: false };
  if (g.error) return { configured: true, error: g.error };
  var tz = Session.getScriptTimeZone();
  var plan = phnParse_(g.grid, Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), people);
  var name = '';
  try { name = String((getConfigValues() || {})['phone_plan_name'] || '').trim(); } catch (e) {}
  if (plan.ok) plan.name = name || g.title || 'Family phone plan';
  return plan;
}

function phnSheet_() { return tiSchema_(ensureSheet(getSpreadsheet(), PHN_TAB_, PHN_HEADERS_), PHN_HEADERS_); }

/** Who has paid back in a month → { '<payer, lower case>': received-at }. */
function phnReceived_(month) {
  var out = {};
  tiRows_(phnSheet_(), PHN_HEADERS_.length).forEach(function(r) {
    if (phnText_(r[0]) !== month) return;
    out[phnText_(r[1]).toLowerCase()] = r[3] instanceof Date ? r[3].toISOString() : phnText_(r[3]);
  });
  return out;
}

/** GET phone_plan → { ok, configured, plan, received } */
function webGetPhonePlan_() {
  var people = [];
  try { var t = bgReadTracker_(); if (t.grid) { var m = budgetModel_(t.grid); if (m.ok) people = m.people.map(function(p) { return p.name; }); } } catch (e) {}
  var plan = phnPlan_(people);
  if (plan.configured === false) return { ok: true, configured: false, error: 'The phone tracker isn’t connected (Config phone_plan_sheet_id).' };
  if (plan.error || plan.ok === false) return { ok: true, configured: true, unavailable: true, error: plan.error };
  return { ok: true, configured: true, plan: plan, received: phnReceived_(plan.month) };
}

/** POST phone_payback_mark { month, payer, amount, received } → { ok, receivedAt } */
function webMarkPhonePayback_(body) {
  body = body || {};
  var month = phnText_(body.month), payer = phnText_(body.payer).slice(0, 80);
  if (!/^\d{4}-\d{2}$/.test(month) || !payer) return { ok: false, error: 'Which month and who?' };
  return tiLocked_(function() {
    var sheet = phnSheet_(), rows = tiRows_(sheet, PHN_HEADERS_.length);
    for (var i = rows.length - 1; i >= 0; i--) if (phnText_(rows[i][0]) === month && phnText_(rows[i][1]).toLowerCase() === payer.toLowerCase()) sheet.deleteRow(i + 2);
    if (!body.received) return { ok: true, receivedAt: '' };
    var at = tiNow_();
    sheet.appendRow([month, payer, phnNum_(body.amount) || '', at]);
    return { ok: true, receivedAt: at };
  });
}
