// ============================================================
// VERA — BillSchedule.js
// Finances › Day to day › Bills & cashflow (issue #226, stage B): the tracker's shared lines as
// bills, in due-day order, with what the tracker doesn't hold kept in VERA's "Bill Schedule" tab
// (due day, account override, autopay, card link, kind, notes); Joint Checking through the month;
// and a quarterly reconcile of plan × 3 against the uploaded transactions.
// ============================================================
//
//   1. AMOUNTS COME FROM THE TRACKER (Budget.js reads it, by label, read only). Bill Schedule
//      never holds an amount, so nothing is typed twice.
//   2. Card payments are their own kind: listed, linked to Cards, NEVER counted as spending.
//   3. Budget lines (the Household category: groceries, cleaning, tips…) are not bills; they
//      stay in Budget, though Reconcile still checks them against what was spent.
//   4. The old Bills sheet is only read: the one-time migration, and its Income rows (the tracker has
//      no paydays). Every bill reader — the bills route, Cashflow, calendar bills, the bill nudge, the
//      morning email, Chat and Claude's context, the weekly snapshot — takes bsBillRows_ (the bills in
//      the old row layout, built from here), and falls back to the old sheet only when the tracker
//      can't be read. Paid this month is kept in Bill Schedule's Paid column.
// ============================================================

var BS_TAB_ = 'Bill Schedule';
var BS_HEADERS_ = ['Tracker Line', 'Due Day', 'Account Override', 'Autopay', 'Card Link', 'Kind', 'Notes', 'Paid'];
// Words too common in line names to match a transaction on their own.
var BS_STOP_ = { utilities: 1, utility: 1, health: 1, insurance: 1, subscription: 1, plan: 1, payment: 1, family: 1, membership: 1, home: 1, monthly: 1, basic: 1, bill: 1 };

function bsText_(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
function bsBool_(v) { return v === true || /^(true|yes|y|1|on)$/i.test(bsText_(v)); }
function bsDay_(v) { var n = Number(v); return n >= 1 && n <= 31 && Math.floor(n) === n ? n : null; }
function bsMoney_(n) { return '$' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/** Pure: Bill Schedule rows → { '<line, lower case>': entry }. */
function bsScheduleMap_(rows) {
  var out = {};
  (rows || []).forEach(function(r) {
    var line = bsText_(r[0]);
    if (!line) return;
    var k = bsText_(r[5]);
    out[line.toLowerCase()] = { line: line, dueDay: bsDay_(r[1]), account: bsText_(r[2]), autopay: bsBool_(r[3]),
      cardLink: bsText_(r[4]), kind: /card/i.test(k) ? 'card payment' : /calendar/i.test(k) ? 'calendar' : 'bill', notes: bsText_(r[6]), paid: bsText_(r[7]) };
  });
  return out;
}

/** Pure: the first two words of a name, for folding a credit into the bill it belongs to. */
function bsStem_(name) { return bsText_(name).toLowerCase().split(/[\s\-–:]+/).filter(Boolean).slice(0, 2).join(' '); }

/**
 * Pure: the bills list. Every shared tracker line with an amount, except budget lines (Household);
 * a credit (a negative line) folds into the bill that shares its first two words. Card payments
 * come from Bill Schedule rows of that kind (they are not tracker lines).
 * → { bills:[{line, amount, credit, account, dueDay, dueFrom, autopay, notes, category}], cards:[…], budgetLines:[names] }
 */
function bsBills_(computed, schedule) {
  schedule = schedule || {};
  var lines = computed.shared.lines, bills = [], credits = [], budgetLines = [];
  lines.forEach(function(x) {
    if (x.category === 'Household') { budgetLines.push(x.name); return; }
    if (!x.amount) return;
    if (x.amount < 0) { credits.push(x); return; }
    var s = schedule[x.name.toLowerCase()] || {};
    if (s.kind === 'card payment') return;
    var due = s.dueDay || x.dueDay || null;
    bills.push({ line: x.name, amount: x.amount, gross: x.amount, credit: 0, account: s.account || x.account, trackerAccount: x.account,
      dueDay: due, dueFrom: s.dueDay ? 'set' : (x.dueDay ? 'name' : ''), autopay: !!s.autopay, notes: s.notes || '', category: x.category, kind: x.kind });
  });
  credits.forEach(function(c) {
    var into = bills.filter(function(b) { return bsStem_(b.line) === bsStem_(c.name); })[0];
    if (into) { into.credit = Math.round((into.credit - c.amount) * 100) / 100; into.amount = Math.round((into.amount + c.amount) * 100) / 100; }
    else bills.push({ line: c.name, amount: c.amount, gross: c.amount, credit: 0, account: c.account, trackerAccount: c.account, dueDay: c.dueDay, dueFrom: c.dueDay ? 'name' : '', autopay: false, notes: '', category: c.category, kind: c.kind });
  });
  var trackerNames = {};
  lines.forEach(function(x) { trackerNames[x.name.toLowerCase()] = 1; });
  Object.keys(schedule).forEach(function(k) { var s = schedule[k];
    if (s.kind !== 'bill' || trackerNames[k]) return;
    bills.push({ line: s.line, amount: null, gross: null, credit: 0, account: s.account, trackerAccount: '', dueDay: s.dueDay, dueFrom: s.dueDay ? 'set' : '',
      autopay: !!s.autopay, notes: s.notes || '', category: '', kind: 'fixed', notInTracker: true }); });
  bills.sort(function(a, b) { return (a.dueDay || 99) - (b.dueDay || 99) || a.line.localeCompare(b.line); });
  var cards = Object.keys(schedule).map(function(k) { return schedule[k]; }).filter(function(s) { return s.kind === 'card payment'; })
    .map(function(s) { return { line: s.line, dueDay: s.dueDay, account: s.account, autopay: s.autopay, cardLink: s.cardLink, notes: s.notes }; })
    .sort(function(a, b) { return (a.dueDay || 99) - (b.dueDay || 99) || a.line.localeCompare(b.line); });
  return { bills: bills, cards: cards, budgetLines: budgetLines,
    total: Math.round(bills.reduce(function(s, b) { return s + (b.amount || 0); }, 0) * 100) / 100 };
}

/** Pure: the checkpoint window a due day falls in (the joint-balance checkpoints: days 1–7, 8–20, 21+). */
function bsWindow_(day) { return !day ? '' : day <= 7 ? '1–7' : day <= 20 ? '8–20' : '21+'; }

/**
 * Pure: Joint Checking through the month. Both transfers in on the transfer day, the Joint bills
 * out on their due days, a running balance from the opening balance, and each checkpoint window's
 * need (the Joint bills due in it and after). Bills with no due day are listed apart.
 */
function bsTimeline_(list, computed, opts) {
  opts = opts || {};
  var tday = bsDay_(opts.transferDay) || 1, open = Number(opts.opening) || 0, ev = [];
  computed.people.forEach(function(p) { if (p.checking) ev.push({ day: tday, what: p.name + ' → AMEX Checking', amount: p.checking, kind: 'in' }); });
  var joint = list.bills.filter(function(b) { return /joint/i.test(b.account) && b.amount != null; });
  joint.filter(function(b) { return b.dueDay; }).forEach(function(b) {
    if (b.credit) ev.push({ day: b.dueDay, what: b.line + ': money back, before it’s due', amount: b.credit, kind: 'in' });
    ev.push({ day: b.dueDay, what: b.line, amount: -(b.credit ? b.gross : b.amount), kind: 'out', autopay: b.autopay });
  });
  ev.forEach(function(e, i) { e._i = i; });
  ev.sort(function(a, b) { return a.day - b.day || (a.kind === b.kind ? a._i - b._i : (a.kind === 'in' ? -1 : 1)); });
  ev.forEach(function(e) { delete e._i; });
  var bal = open, low = null;
  ev.forEach(function(e) { bal = Math.round((bal + e.amount) * 100) / 100; e.balance = bal; e.window = bsWindow_(e.day); if (low == null || bal < low.balance) low = { day: e.day, balance: bal }; });
  var windows = ['1–7', '8–20', '21+'].map(function(w) {
    var due = joint.filter(function(b) { return bsWindow_(b.dueDay) === w; });
    var from = { '1–7': 1, '8–20': 8, '21+': 21 }[w];
    var need = joint.filter(function(b) { return b.dueDay && b.dueDay >= from; }).reduce(function(s, b) { return s + b.amount; }, 0);
    return { window: w, bills: due.map(function(b) { return b.line; }), due: Math.round(due.reduce(function(s, b) { return s + b.amount; }, 0) * 100) / 100, need: Math.round(need * 100) / 100 };
  });
  return { events: ev, opening: open, transferDay: tday, low: low, windows: windows,
    undated: joint.filter(function(b) { return !b.dueDay; }).map(function(b) { return b.line; }) };
}

/** Pure: the words of a line name worth matching a transaction description on. */
function bsWords_(name) {
  return bsText_(name).toLowerCase().replace(/\(.*?\)/g, ' ').split(/[^a-z0-9+]+/).filter(function(w) { return w.length > 3 && !BS_STOP_[w]; });
}

/** Pure: '2026-Q4' → ['2026-10', '2026-11', '2026-12'], or null. */
function bsQuarterMonths_(q) {
  var m = String(q || '').match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  var y = Number(m[1]), s = (Number(m[2]) - 1) * 3 + 1;
  return [0, 1, 2].map(function(i) { return y + '-' + String(s + i).padStart(2, '0'); });
}

/** Pure: is this transaction a card payment (never spending)? */
function bsIsCardPayment_(t, cardNames) {
  var d = String(t.description || '').toLowerCase();
  return (cardNames || []).some(function(c) { return c && d.indexOf(c) !== -1; }) || /payment\s*(thank|received)|autopay pmt|card payment/.test(d);
}

/**
 * Pure: lines against transactions. Each line: { id, line, plan (monthly), kind, owner? } — a line with an
 * owner only takes that person's transactions. A transaction counts toward a line when its description
 * has one of the line's words, or a Config alias names the line; it counts once, toward the first line
 * it matches in list order. → [{ id, line, kind, plan (× months), actual|null, diff, count, flag }]
 */
function bsMatchLines_(lines, tx, aliasMap, months) {
  aliasMap = aliasMap || {}; months = months || 3;
  var used = {};
  return lines.map(function(L) {
    var words = bsWords_(L.line), low = L.line.toLowerCase();
    var aliases = Object.keys(aliasMap).filter(function(k) { return String(aliasMap[k]).toLowerCase() === low; }).map(function(k) { return k.toLowerCase(); });
    var hits = tx.filter(function(t) { if (used[t._i]) return false; if (L.owner && t.owner !== L.owner) return false; var d = String(t.description || '').toLowerCase();
      return words.some(function(w) { return d.indexOf(w) !== -1; }) || aliases.some(function(a) { return d.indexOf(a) !== -1; }); });
    hits.forEach(function(t) { used[t._i] = true; });
    var plan = Math.round(L.plan * months * 100) / 100;
    if (!hits.length) return { id: L.id || L.line, line: L.line, kind: L.kind, plan: plan, actual: null, diff: null, flag: 'not in uploads', count: 0 };
    var actual = Math.round(hits.reduce(function(s, t) { return s - t.amount; }, 0) * 100) / 100, diff = Math.round((actual - plan) * 100) / 100;
    return { id: L.id || L.line, line: L.line, kind: L.kind, plan: plan, actual: actual, diff: diff, count: hits.length,
      flag: Math.abs(diff) <= Math.max(1, plan * 0.02) ? 'ok' : (diff > 0 ? L.line + ' +' + bsMoney_(diff) : L.line + ' −' + bsMoney_(diff)) };
  });
}

/** Pure: the quarter's spending transactions (money out, not card payments), numbered for matching. */
function bsQuarterTx_(tx, months, cardNames) {
  return (tx || []).map(function(t, i) { var c = Object.assign({}, t); c._i = i; return c; })
    .filter(function(t) { return months.indexOf(String(t.month)) !== -1 && t.amount < 0 && !bsIsCardPayment_(t, cardNames); });
}

/**
 * Pure: plan × 3 against the quarter's uploaded transactions, line by line (bills and budget lines;
 * never card payments). → { quarter, rows:[{line, plan, actual|null, diff, flag}], totals }
 */
function bsReconcile_(computed, list, tx, quarter, aliasMap) {
  var months = bsQuarterMonths_(quarter) || [];
  var inQ = bsQuarterTx_(tx, months, list.cards.map(function(c) { return c.line.toLowerCase(); }));
  var lines = list.bills.filter(function(b) { return b.amount != null; }).map(function(b) { return { line: b.line, plan: b.amount, kind: 'bill' }; })
    .concat(computed.shared.lines.filter(function(x) { return x.category === 'Household' && x.amount; }).map(function(x) { return { line: x.name, plan: x.amount, kind: 'budget line' }; }));
  var rows = bsMatchLines_(lines, inQ, aliasMap, 3);
  var covered = rows.filter(function(r) { return r.actual != null; });
  return { quarter: quarter, months: months, rows: rows, uploads: inQ.length,
    totals: { plan: Math.round(covered.reduce(function(s, r) { return s + r.plan; }, 0) * 100) / 100,
              actual: Math.round(covered.reduce(function(s, r) { return s + r.actual; }, 0) * 100) / 100,
              notInUploads: rows.length - covered.length, flagged: rows.filter(function(r) { return r.flag !== 'ok' && r.flag !== 'not in uploads'; }).length } };
}

/**
 * Pure: plan vs actual for every Budget line in a quarter, as monthly averages. Shared lines take
 * anyone's transactions; a person's own lines take only theirs (from their own Transactions tab).
 * → { quarter, uploads, lines: { '<line key>': { plan, actual|null } } } (both per month)
 */
function bsBudgetActuals_(computed, list, tx, quarter, aliasMap) {
  var months = bsQuarterMonths_(quarter) || [];
  var inQ = bsQuarterTx_(tx, months, list.cards.map(function(c) { return c.line.toLowerCase(); }));
  var lines = computed.shared.lines.filter(function(x) { return x.amount > 0; }).map(function(x) { return { id: x.key, line: x.name, plan: x.amount, kind: 'shared' }; });
  computed.people.forEach(function(p) { p.fixed.concat(p.nice).filter(function(x) { return x.amount > 0; })
    .forEach(function(x) { lines.push({ id: x.key, line: x.name, plan: x.amount, kind: 'personal', owner: p.key }); }); });
  var out = {};
  bsMatchLines_(lines, inQ, aliasMap, 1).forEach(function(r) {
    out[r.id] = { plan: r.plan, actual: r.actual == null ? null : Math.round(r.actual / Math.max(1, months.length) * 100) / 100 };
  });
  return { quarter: quarter, uploads: inQ.length, lines: out,
    owners: computed.people.map(function(p) { return { key: p.key, uploads: inQ.filter(function(t) { return t.owner === p.key; }).length }; }) };
}

/**
 * Pure: the one-time migration. Each old Bills row (Bill | Amount | Due Day | Frequency | Category |
 * Account | Paid | Notes | Type | Budget Entry) is matched to a tracker line by Budget Entry, then by
 * name (either way round). Income rows are skipped (the tracker holds income); a row that reads as a
 * card payment becomes a card payment; anything else unmatched is listed for a decision.
 * → { rows:[[…BS_HEADERS_]], matched:[{bill, line}], cards:[bill], unmatched:[{bill, amount, why}], skipped:[bill] }
 */
function bsMigrate_(billRows, computed, existing) {
  existing = existing || {};
  var lines = computed.shared.lines.map(function(x) { return x.name; });
  var find = function(t) { t = bsText_(t).toLowerCase().replace(/\s*\(\d{1,2}(st|nd|rd|th)\)/, ''); if (!t) return '';
    var exact = lines.filter(function(l) { return l.toLowerCase() === t; })[0]; if (exact) return exact;
    return lines.filter(function(l) { var L = l.toLowerCase(); return (L.length >= 4 && t.indexOf(L) !== -1) || (t.length >= 4 && L.indexOf(t) !== -1); })[0] || ''; };
  var out = { rows: [], matched: [], cards: [], unmatched: [], skipped: [] }, seen = {};
  (billRows || []).forEach(function(r) {
    var bill = bsText_(r[0]); if (!bill) return;
    var type = bsText_(r[8]) || 'Expense';
    if (/income/i.test(type)) { out.skipped.push(bill); return; }
    var isCard = /credit card|card payment/i.test(bsText_(r[4])) || /\b(amex|visa|mastercard|discover|sapphire|venture|bilt|card)\b/i.test(bill);
    var line = isCard ? '' : (find(r[9]) || find(bill));
    var key = (line || bill).toLowerCase();
    if (seen[key] || existing[key]) return;
    if (!line && !isCard) { out.unmatched.push({ bill: bill, amount: r[1] === '' ? null : Number(r[1]), why: 'no tracker line by that name' }); return; }
    seen[key] = 1;
    out.rows.push([line || bill, bsDay_(r[2]) || '', bsText_(r[5]), false, isCard ? bill : '', isCard ? 'card payment' : 'bill', bsText_(r[7]), bsText_(r[6])]);
    if (isCard) out.cards.push(bill); else out.matched.push({ bill: bill, line: line });
  });
  return out;
}

// ---- reading and writing ---------------------------------------------------------------------

function bsSheet_() { return tiSchema_(ensureSheet(getSpreadsheet(), BS_TAB_, BS_HEADERS_), BS_HEADERS_); }
function bsReadSchedule_() { return bsScheduleMap_(tiRows_(bsSheet_(), BS_HEADERS_.length)); }

/** The tracker model and its plan, or { error }. */
function bsPlan_() {
  var t = bgReadTracker_();
  if (t.error) return { error: t.error, configured: false };
  var model = bgModel_(t.grid);
  if (!model.ok) return { error: model.error, configured: true };
  return { model: model, computed: budgetCompute_(model, {}, bgCategoryMap_()) };
}

/** The uploaded transactions for some months: [{ month:'YYYY-MM', description, amount, account }]. */
function bsReadTransactions_(months) {
  var id = PropertiesService.getScriptProperties().getProperty('TRANSACTIONS_SHEET_ID');
  if (!id) return null;
  var ss;
  try { ss = SpreadsheetApp.openById(id); } catch (e) { return null; }
  var tabs = ss.getSheets().filter(function(s) { return /^transactions\b/i.test(s.getName()); });
  var tz = Session.getScriptTimeZone(), out = [];
  tabs.forEach(function(s) {
    if (s.getLastRow() < 2) return;
    var owner = (s.getName().match(/^transactions\s*[-–]\s*(.+)$/i) || ['', ''])[1].trim().toLowerCase();
    s.getRange(2, 1, s.getLastRow() - 1, 6).getValues().forEach(function(r) {
      var d = r[0], ym = d && typeof d.getFullYear === 'function' ? Utilities.formatDate(d, tz, 'yyyy-MM') : String(d || '').slice(0, 7);
      if (months.indexOf(ym) === -1) return;
      var amt = parseFloat(String(r[5]).replace(/[$,]/g, ''));
      var desc = bsText_(r[2]);
      if (!desc || isNaN(amt)) return;
      out.push({ month: ym, description: desc, amount: amt, account: bsText_(r[1]), category: bsText_(r[3]), owner: owner });
    });
  });
  return out;
}

/** GET bills_schedule → { ok, bills, cards, budgetLines, timeline, migrated, quarter } */
function webGetBillsSchedule_() {
  var plan = bsPlan_();
  if (plan.error) return { ok: true, configured: plan.configured, unavailable: true, error: plan.error };
  var schedule = bsReadSchedule_();
  var list = bsBills_(plan.computed, schedule);
  var cfg = {};
  try { cfg = getConfigValues() || {}; } catch (e) {}
  var timeline = bsTimeline_(list, plan.computed, { transferDay: cfg['bills_transfer_day'], opening: cfg['joint_opening_balance'] });
  var preview = null;
  if (!Object.keys(schedule).length) {
    var old = getSpreadsheet().getSheetByName(TABS.BILLS);
    var rows = old && old.getLastRow() >= 2 ? old.getRange(2, 1, old.getLastRow() - 1, Math.min(old.getLastColumn(), BILL_HEADERS.length)).getValues() : [];
    if (rows.length) { var m = bsMigrate_(rows, plan.computed, schedule); preview = { matched: m.matched, cards: m.cards, unmatched: m.unmatched, skipped: m.skipped }; }
  }
  return { ok: true, configured: true, bills: list.bills, cards: list.cards, budgetLines: list.budgetLines, total: list.total,
    timeline: timeline, migration: preview, quarter: bgQuarter_() };
}

/** POST bills_schedule_save { line, dueDay, account, autopay, cardLink, kind, notes } → { ok }. Upserts by line. */
function webSaveBillSchedule_(body) {
  body = body || {};
  var line = bsText_(body.line).slice(0, 120);
  if (!line) return { ok: false, error: 'Which bill?' };
  var due = body.dueDay === '' || body.dueDay == null ? '' : bsDay_(body.dueDay);
  if (due === null) return { ok: false, error: 'A due day is 1 to 31.' };
  var row = [line, due, bsText_(body.account).slice(0, 60), !!body.autopay, bsText_(body.cardLink).slice(0, 80), /card/i.test(bsText_(body.kind)) ? 'card payment' : 'bill', bsText_(body.notes).slice(0, 300), ''];
  return tiLocked_(function() {
    var sheet = bsSheet_(), rows = tiRows_(sheet, BS_HEADERS_.length), at = -1;
    for (var i = 0; i < rows.length; i++) if (bsText_(rows[i][0]).toLowerCase() === line.toLowerCase()) { at = i + 2; row[7] = rows[i][7] || ''; break; }
    if (at === -1) sheet.appendRow(row); else sheet.getRange(at, 1, 1, BS_HEADERS_.length).setValues([row]);
    return { ok: true, entry: bsScheduleMap_([row])[line.toLowerCase()] };
  });
}

/** POST bills_schedule_migrate { apply } → the preview, or the rows written. The old Bills sheet is only read. */
function webMigrateBillSchedule_(body) {
  var plan = bsPlan_();
  if (plan.error) return { ok: false, error: plan.error };
  var old = getSpreadsheet().getSheetByName(TABS.BILLS);
  var rows = old && old.getLastRow() >= 2 ? old.getRange(2, 1, old.getLastRow() - 1, Math.min(old.getLastColumn(), BILL_HEADERS.length)).getValues() : [];
  return tiLocked_(function() {
    var sheet = bsSheet_();
    var m = bsMigrate_(rows, plan.computed, bsScheduleMap_(tiRows_(sheet, BS_HEADERS_.length)));
    if (body && body.apply) m.rows.forEach(function(r) { sheet.appendRow(r); });
    return { ok: true, applied: !!(body && body.apply), written: body && body.apply ? m.rows.length : 0, matched: m.matched, cards: m.cards, unmatched: m.unmatched, skipped: m.skipped };
  });
}

/** GET bills_reconcile &quarter=YYYY-Qn (default: the last full quarter) */
function webGetBillsReconcile_(e) {
  var q = bsText_(e && e.parameter && e.parameter.quarter);
  if (!bsQuarterMonths_(q)) { var d = new Date(); d.setMonth(d.getMonth() - 3); q = bgQuarter_(d); }
  var plan = bsPlan_();
  if (plan.error) return { ok: true, unavailable: true, error: plan.error };
  var list = bsBills_(plan.computed, bsReadSchedule_());
  var tx = bsReadTransactions_(bsQuarterMonths_(q));
  if (tx === null) return { ok: true, quarter: q, noUploads: true, error: 'The transactions sheet isn’t connected (Script Property TRANSACTIONS_SHEET_ID).' };
  var aliases = {};
  try { aliases = getConfigAliases_() || {}; } catch (err) {}
  return Object.assign({ ok: true }, bsReconcile_(plan.computed, list, tx, q, aliases));
}

/** GET budget_actuals &quarter=YYYY-Qn (default: the last full quarter) → plan vs actual per Budget line, per month. */
function webGetBudgetActuals_(e) {
  var q = bsText_(e && e.parameter && e.parameter.quarter);
  if (!bsQuarterMonths_(q)) { var d = new Date(); d.setMonth(d.getMonth() - 3); q = bgQuarter_(d); }
  var plan = bsPlan_();
  if (plan.error) return { ok: true, unavailable: true, error: plan.error };
  var tx = bsReadTransactions_(bsQuarterMonths_(q));
  if (tx === null) return { ok: true, quarter: q, noUploads: true };
  var aliases = {};
  try { aliases = getConfigAliases_() || {}; } catch (err) {}
  return Object.assign({ ok: true }, bsBudgetActuals_(plan.computed, bsBills_(plan.computed, bsReadSchedule_()), tx, q, aliases));
}

// ---- the bills every reader takes ------------------------------------------------------------

/**
 * The bills this month in the old Bills row layout (Bill | Amount | Due Day | Frequency | Category |
 * Account | Paid | Notes | Type | Budget Entry), built from the tracker and Bill Schedule; Paid holds
 * the month when it's paid. Card payments come with no amount; the old sheet's Income rows are added
 * as they are. null when the tracker can't be read — the caller then reads the old sheet itself.
 */
function bsBillRows_(month) {
  try {
    var plan = bsPlan_();
    if (plan.error) return null;
    var sched = bsReadSchedule_(), list = bsBills_(plan.computed, sched);
    var paid = function(n) { var x = sched[String(n).toLowerCase()]; return x && x.paid === month ? month : ''; };
    var rows = list.bills.map(function(b) { return [b.line, b.amount == null ? '' : b.amount, b.dueDay || '', 'Monthly', b.category || '', b.account || '', paid(b.line), b.notes || '', 'Expense', b.notInTracker ? '' : b.line]; });
    list.cards.forEach(function(c) { rows.push([c.line, '', c.dueDay || '', 'Monthly', 'Credit Card', c.account || '', paid(c.line), c.notes || '', 'Expense', '']); });
    var old = getSpreadsheet().getSheetByName(TABS.BILLS);
    if (old && old.getLastRow() >= 2) {
      old.getRange(2, 1, old.getLastRow() - 1, Math.min(old.getLastColumn(), BILL_HEADERS.length)).getValues().forEach(function(r) {
        if (!bsText_(r[0]) || !/income/i.test(bsText_(r[8]))) return;
        var x = r.slice(); while (x.length < 10) x.push(''); rows.push(x);
      });
    }
    return rows;
  } catch (e) { Logger.log('bsBillRows_: ' + e.message); return null; }
}

/** Marks a bill paid (or not) for a month in Bill Schedule, adding a row for it when there's none. → paid now? */
function bsSetPaid_(line, month, paid, kind) {
  line = bsText_(line);
  return tiLocked_(function() {
    var sheet = bsSheet_(), rows = tiRows_(sheet, BS_HEADERS_.length);
    for (var i = 0; i < rows.length; i++) {
      if (bsText_(rows[i][0]).toLowerCase() !== line.toLowerCase()) continue;
      var now = paid == null ? bsText_(rows[i][7]) !== month : !!paid;
      sheet.getRange(i + 2, 8).setValue(now ? month : '');
      return now;
    }
    var on = paid == null ? true : !!paid;
    sheet.appendRow([line, '', '', false, '', kind || 'bill', '', on ? month : '']);
    return on;
  });
}

/** The bill whose name best fits some text (exact, then contained either way), from rows. */
function bsFindBill_(rows, text) {
  var t = bsText_(text).toLowerCase();
  if (!t) return null;
  var names = (rows || []).map(function(r) { return bsText_(r[0]); }).filter(Boolean);
  return names.filter(function(n) { return n.toLowerCase() === t; })[0]
    || names.filter(function(n) { var l = n.toLowerCase(); return (l.length >= 4 && t.indexOf(l) !== -1) || (t.length >= 4 && l.indexOf(t) !== -1); })[0] || null;
}

/** Removes a bill VERA holds itself (a Bill Schedule row that isn't a tracker line). Tracker lines stay. */
function bsDeleteScheduleBill_(line) {
  var plan = bsPlan_();
  if (plan.error) return { ok: false, error: plan.error };
  var low = bsText_(line).toLowerCase();
  if (plan.computed.shared.lines.some(function(x) { return x.name.toLowerCase() === low; })) return { ok: false, error: line + ' comes from the budget tracker; remove the line there.' };
  return tiLocked_(function() {
    var sheet = bsSheet_(), rows = tiRows_(sheet, BS_HEADERS_.length);
    for (var i = rows.length - 1; i >= 0; i--) if (bsText_(rows[i][0]).toLowerCase() === low) { sheet.deleteRow(i + 2); return { ok: true }; }
    return { ok: false, error: 'Bill not found: ' + line };
  });
}
