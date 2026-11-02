// ============================================================
// VERA — FinSummary.js
// Finances › Overview › Summary (issue #224): the quick glance (tiles, Needs attention, FSA & HSA)
// and the quarterly money check-in (what changed, spending against the Budget, suggested topics,
// decisions and notes). Shared by both dashboards; the decisions are the same for both of us.
// ============================================================
//
//   1. EVERYTHING IS READ FROM WHERE IT ALREADY LIVES: the planner (Outputs, CDs, Plan items, Goals;
//      read only, by label), Budget.js and BillSchedule.js (the plan, the bills, the uploads),
//      HealthAccounts.js, Planned Purchases and Cards. Each source is read on its own: one that
//      fails drops out, and the page says which, instead of the whole card going blank.
//   2. VERA KEEPS ONLY ITS OWN: a quarterly snapshot (Finance Snapshots, one row a quarter, taken by
//      the nightly run and caught up when a run was missed), the check-in decisions and the notes.
//   3. Actual spending comes from the uploaded transactions; with none for a month the figures are
//      the Budget's plan and say "expected".
// ============================================================

var FS_SNAP_TAB_ = 'Finance Snapshots';
var FS_SNAP_HEADERS_ = ['Quarter', 'Taken', 'Net Worth', 'Cash & CDs', 'Goals Set Aside', 'HSA Balance', 'FSA Left', 'Plan Status', 'Spending JSON', 'Source'];
var FS_DEC_TAB_ = 'Check-in Decisions';
var FS_DEC_HEADERS_ = ['ID', 'Quarter', 'Text', 'Owner', 'Due', 'Status', 'Done On', 'Source Topic', 'Notes', 'Created', 'Updated'];
var FS_NOTES_TAB_ = 'Check-in Notes';
var FS_NOTES_HEADERS_ = ['Quarter', 'Notes', 'Updated'];
var FS_MONTHS_ = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function fsText_(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
function fsNum_(v) { if (typeof v === 'number') return isFinite(v) ? v : null; var s = fsText_(v).replace(/[$,\s]/g, ''); if (!s) return null; var n = parseFloat(s); return isNaN(n) ? null : n; }
function fsRound_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function fsMoney_(n) { return (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-US'); }
function fsDays_(fromIso, toIso) { return Math.round((new Date(toIso + 'T00:00:00') - new Date(fromIso + 'T00:00:00')) / 86400000); }
function fsAddDays_(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
/** Pure: '2026-11-02' → '2026-Q4'. */
function fsQuarter_(iso) { var y = Number(String(iso).slice(0, 4)), m = Number(String(iso).slice(5, 7)); return y + '-Q' + (Math.floor((m - 1) / 3) + 1); }
/** Pure: the quarter before. */
function fsPrevQuarter_(q) { var m = String(q).match(/^(\d{4})-Q([1-4])$/); if (!m) return ''; var i = Number(m[1]) * 4 + Number(m[2]) - 2; return Math.floor(i / 4) + '-Q' + (i % 4 + 1); }
/** Pure: a quarter's first day. */
function fsQuarterStart_(q) { var m = String(q).match(/^(\d{4})-Q([1-4])$/); return m ? m[1] + '-' + String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0') + '-01' : ''; }
/** Pure: the next quarter's first day. */
function fsNextQuarterStart_(today) { return fsQuarterStart_(fsQuarter_(fsAddDays_(fsQuarterStart_(fsQuarter_(today)), 100))); }
function fsQuarterMonths_(q) { var s = fsQuarterStart_(q); if (!s) return []; var y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)); return [0, 1, 2].map(function(i) { return y + '-' + String(m + i).padStart(2, '0'); }); }

/**
 * Pure: the planner's Outputs table ("Item | Value | What it means"), by label:
 * net worth, plan status, cash and CDs, and the 12-month cash low with its date and floor (from its note).
 */
function fsOutputs_(grid) {
  var out = { netWorth: null, planStatus: '', cash: null, cashLow: null, cashLowWhen: '', floor: null };
  (grid || []).forEach(function(row) {
    var a = fsText_(row && row[0]).toLowerCase(), v = row && row[1], note = fsText_(row && row[2]);
    if (a === 'net worth' && out.netWorth == null) out.netWorth = fsNum_(v);
    else if (a === 'plan status' && !out.planStatus) out.planStatus = fsText_(v);
    else if (a === 'cash and cds' && out.cash == null) out.cash = fsNum_(v);
    else if (a === '12-month cash low' && out.cashLow == null) {
      out.cashLow = fsNum_(v);
      var w = note.match(/^([A-Za-z]{3,9} \d{1,2})/); if (w) out.cashLowWhen = w[1];
      var f = note.match(/floor is \$?([\d,]+)/i); if (f) out.floor = fsNum_(f[1]);
    }
  });
  return out;
}

/** Pure: a card's annual fee month from its notes ("fee in March", "annual fee: Mar"), or 0. */
function fsCardFeeMonth_(notes) {
  var m = fsText_(notes).toLowerCase().match(/fee[^.;]*?\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  return m ? FS_MONTHS_[m[1]] : 0;
}

/**
 * Pure: Needs attention — one list, soonest first, from whichever sources were read:
 * bills due this week (not yet paid), categories over budget this month, planned spends this month,
 * FSA money left to use, a CD maturing, a card's annual fee, a return window closing.
 * sources: { bills, spend, plans, fsa, cds, cards, returns } — each either the data or { error }.
 * → { items:[{ kind, title, detail, date, tab }], unavailable:[source names] }
 */
function fsAttention_(sources, today) {
  sources = sources || {};
  var items = [], unavailable = [], month = today.slice(0, 7), y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7));
  var take = function(name, fn) { var s = sources[name]; if (!s) return; if (s.error) { unavailable.push(name); return; } try { fn(s); } catch (e) { unavailable.push(name); } };
  var dayOfMonth = function(d) { var last = new Date(y, mo, 0).getDate(), dd = Math.min(d, last), iso = month + '-' + String(dd).padStart(2, '0');
    if (iso < today) { var nm = new Date(y, mo, 1); iso = nm.getFullYear() + '-' + String(nm.getMonth() + 1).padStart(2, '0') + '-' + String(Math.min(d, new Date(nm.getFullYear(), nm.getMonth() + 1, 0).getDate())).padStart(2, '0'); }
    return iso; };
  take('bills', function(s) { (s.items || []).forEach(function(b) {
    if (!b.dueDay || b.paid || b.income) return; var d = dayOfMonth(b.dueDay), n = fsDays_(today, d); if (n < 0 || n > 7) return;
    items.push({ kind: 'bill', title: b.line + (b.amount != null ? ' ' + fsMoney_(b.amount) : ''), detail: n === 0 ? 'due today' : 'due in ' + n + ' day' + (n === 1 ? '' : 's'), date: d, tab: 'billscash' }); }); });
  take('spend', function(s) { if (s.source !== 'actual') return; (s.categories || []).forEach(function(c) {
    if (c.actual == null || c.actual <= c.plan * 1.02 + 1) return;
    items.push({ kind: 'over', title: c.name + ' over budget', detail: fsMoney_(c.actual) + ' of ' + fsMoney_(c.plan) + ' this month', date: today, tab: 'budget' }); }); });
  take('plans', function(s) { (s.items || []).forEach(function(p) {
    if (p.month !== month) return;
    items.push({ kind: 'planned', title: p.item + (p.amount ? ' ' + fsMoney_(p.amount) : ''), detail: 'planned this month', date: month + '-' + String(new Date(y, mo, 0).getDate()).padStart(2, '0'), tab: 'goals' }); }); });
  take('fsa', function(s) { (s.items || []).forEach(function(f) {
    if (!f.atRisk || f.daysLeft == null || f.daysLeft < 0 || f.daysLeft > 120) return;
    items.push({ kind: 'fsa', title: 'FSA ' + fsMoney_(f.atRisk) + ' to use', detail: 'by ' + f.useBy, date: f.useBy, tab: 'hsafsa' }); }); });
  take('cds', function(s) { (s.items || []).forEach(function(c) {
    if (!c.matures) return; var n = fsDays_(today, c.matures); if (n < 0 || n > 30) return;
    items.push({ kind: 'cd', title: c.name + ' matures', detail: 'decide whether to roll it over', date: c.matures, tab: 'networth' }); }); });
  take('cards', function(s) { (s.items || []).forEach(function(c) {
    var fm = fsCardFeeMonth_(c.notes); if (!fm || !c.annualFee || String(c.active || 'Yes') !== 'Yes') return;
    var fy = fm < mo ? y + 1 : y, d = fy + '-' + String(fm).padStart(2, '0') + '-01', n = fsDays_(today, d);
    if (fm !== mo && (n < 0 || n > 31)) return;
    items.push({ kind: 'fee', title: c.cardName + ' annual fee ' + fsMoney_(c.annualFee), detail: fm === mo ? 'this month' : 'next month', date: fm === mo ? today : d, tab: 'cards' }); }); });
  take('returns', function(s) { (s.items || []).forEach(function(p) {
    if (!p.returnBy) return; var n = fsDays_(today, p.returnBy); if (n < 0 || n > 7) return;
    items.push({ kind: 'return', title: 'Return window for ' + p.item, detail: n === 0 ? 'closes today' : 'closes in ' + n + ' day' + (n === 1 ? '' : 's'), date: p.returnBy, tab: 'planned' }); }); });
  var order = ['bill', 'fsa', 'cd', 'return', 'fee', 'over', 'planned'];
  items.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : order.indexOf(a.kind) - order.indexOf(b.kind); });
  return { items: items, unavailable: unavailable };
}

/**
 * Pure: Suggested to discuss at the check-in. Each topic: { id, text, why, tab }.
 * now / prev: snapshots ({ netWorth, cash, goalsSetAside, hsaBalance, fsaLeft, planStatus }).
 * budget: { months:[{ month, source, categories:[{ name, plan, actual }] }] } (the quarter so far).
 * health: { fsa:[views], hsa: view }. cds:[{ name, matures }]. goals:[pgBuild_ goals]. decisions:[rows].
 * scenarios:[{ name, quarter, results }] with base: the plan's results now, to say what each changes.
 */
function fsDiscuss_(now, prev, budget, health, cds, goals, decisions, scenarios, base, today) {
  var out = [], q = fsQuarter_(today), y = Number(today.slice(0, 4));
  var add = function(id, text, why, tab) { out.push({ id: id, text: text, why: why || '', tab: tab || '' }); };
  // a category over budget in 2+ months of the quarter
  var over = {};
  ((budget && budget.months) || []).forEach(function(m) { if (m.source !== 'actual') return;
    (m.categories || []).forEach(function(c) { if (c.actual != null && c.actual > c.plan * 1.02 + 1) (over[c.name] = over[c.name] || []).push(m.month); }); });
  Object.keys(over).forEach(function(n) { if (over[n].length >= 2) add('over:' + n, n + ' was over budget in ' + over[n].length + ' months', over[n].join(', '), 'budget'); });
  // FSA money at risk
  ((health && health.fsa) || []).forEach(function(f) { if (f.atRisk > 0 && f.daysLeft != null && f.daysLeft >= 0)
    add('fsa:' + f.year, 'FSA ' + fsMoney_(f.atRisk) + ' to use by ' + f.useBy, f.daysLeft + ' days left', 'hsafsa'); });
  // a CD maturing in the next 90 days
  (cds || []).forEach(function(c) { if (!c.matures) return; var n = fsDays_(today, c.matures);
    if (n >= 0 && n <= 90) add('cd:' + c.name, c.name + ' matures ' + c.matures, 'roll it over, or move it', 'networth'); });
  // next year's planned travel against its budget
  (goals || []).forEach(function(g) { if (g.kind !== 'yearly' || !/trip|travel/i.test(g.name)) return;
    var ny = (g.years || []).filter(function(x) { return x.year === y + 1; })[0];
    if (ny && ny.left != null && ny.left < 0) add('travel:' + (y + 1), (y + 1) + ' trips are ' + fsMoney_(-ny.left) + ' over the ' + g.name + ' budget', fsMoney_(ny.planned) + ' planned', 'goals'); });
  // HSA room left this year
  var hsa = health && health.hsa;
  if (hsa && hsa.room > 0) add('hsa:' + hsa.year, 'HSA has ' + fsMoney_(hsa.room) + ' of room left for ' + hsa.year, 'against the ' + fsMoney_(hsa.limit) + ' limit', 'hsafsa');
  // goals behind: a one-off due within 3 months (or past) and not yet funded
  (goals || []).forEach(function(g) { if (g.kind !== 'one-off' || g.status !== 'active' || !g.month || g.target == null) return;
    var due = g.month + '-01', n = fsDays_(today, due);
    if (n <= 92 && (g.saved || 0) < g.target) add('goal:' + g.name, g.name + ' is ' + fsMoney_(g.target - (g.saved || 0)) + ' short', 'target ' + g.month, 'goals'); });
  // open decisions past their due date
  (decisions || []).forEach(function(d) { if (d.status === 'open' && d.due && /^\d{4}-\d{2}-\d{2}$/.test(d.due) && d.due < today)
    add('decision:' + d.id, 'Overdue: ' + d.text, (d.owner || 'Both') + ' · due ' + d.due, ''); });
  // Budget scenarios saved this quarter, with what they'd change for each of us
  (scenarios || []).forEach(function(s) { if (s.quarter !== q || !s.results) return;
    var parts = (base && base.people || []).map(function(p) { var r = s.results[p.key]; if (!r || r.checking == null) return '';
      var d = fsRound_(r.checking - p.checking); return d ? p.name + ' ' + (d > 0 ? '+' : '−') + fsMoney_(Math.abs(d)).replace(/^\$/, '$') : ''; }).filter(Boolean);
    add('scenario:' + s.id, s.name + (parts.length ? ': ' + parts.join(', ') : ''), 'a Budget scenario saved this quarter', 'budget'); });
  // what changed a lot since the last snapshot
  if (now && prev && now.planStatus && prev.planStatus && now.planStatus.split(':')[0] !== prev.planStatus.split(':')[0])
    add('plan', 'Plan status moved from ' + prev.planStatus.split(':')[0] + ' to ' + now.planStatus.split(':')[0], '', 'networth');
  return out;
}

/** Pure: what changed since the snapshot — { key, label, now, prev, delta } for each figure both have. */
function fsChanges_(now, prev) {
  var F = [['netWorth', 'Net worth'], ['cash', 'Cash & CDs'], ['goalsSetAside', 'Goals set aside'], ['hsaBalance', 'HSA balance'], ['fsaLeft', 'FSA left']];
  var rows = F.map(function(f) { var a = now ? now[f[0]] : null, b = prev ? prev[f[0]] : null;
    return { key: f[0], label: f[1], now: a, prev: b, delta: a != null && b != null ? fsRound_(a - b) : null }; });
  rows.push({ key: 'planStatus', label: 'Plan status', now: now ? now.planStatus : '', prev: prev ? prev.planStatus : '', delta: null });
  return rows;
}

/**
 * Pure: a month's (or a quarter's) spending by Budget category. With uploads it's the actual from the
 * transactions (bsMatchLines_); without, the plan, labelled expected.
 * → { source:'actual'|'expected', categories:[{ name, plan, actual }], total:{ plan, actual } }
 */
function fsSpending_(computed, list, tx, months, aliases) {
  var cats = {}, order = [];
  computed.shared.lines.forEach(function(x) { if (!(x.amount > 0)) return; if (!cats[x.category]) { cats[x.category] = { name: x.category, plan: 0, actual: null }; order.push(x.category); }
    cats[x.category].plan += x.amount * months.length; });
  var has = (tx || []).some(function(t) { return months.indexOf(String(t.month)) !== -1; });
  if (has) {
    var inQ = bsQuarterTx_(tx, months, list.cards.map(function(c) { return c.line.toLowerCase(); }));
    var lines = computed.shared.lines.filter(function(x) { return x.amount > 0; }).map(function(x) { return { id: x.key, line: x.name, plan: x.amount, kind: x.category }; });
    bsMatchLines_(lines, inQ, aliases, months.length).forEach(function(r) { if (r.actual != null) cats[r.kind].actual = fsRound_((cats[r.kind].actual || 0) + r.actual); });
    order.forEach(function(n) { if (cats[n].actual == null) cats[n].actual = 0; });
  }
  var list2 = order.map(function(n) { return { name: n, plan: fsRound_(cats[n].plan), actual: cats[n].actual }; });
  return { source: has ? 'actual' : 'expected', months: months, categories: list2,
    total: { plan: fsRound_(list2.reduce(function(s, c) { return s + c.plan; }, 0)), actual: has ? fsRound_(list2.reduce(function(s, c) { return s + (c.actual || 0); }, 0)) : null } };
}

/** Pure: a snapshot row from figures. */
function fsSnapshotRow_(quarter, takenIso, f, spending) {
  return [quarter, takenIso, f.netWorth == null ? '' : f.netWorth, f.cash == null ? '' : f.cash, f.goalsSetAside == null ? '' : f.goalsSetAside,
    f.hsaBalance == null ? '' : f.hsaBalance, f.fsaLeft == null ? '' : f.fsaLeft, f.planStatus || '', JSON.stringify(spending ? spending.categories : []), spending ? spending.source : ''];
}
function fsSnapshotFrom_(r) {
  if (!r) return null;
  var n = function(v) { return v === '' || v == null ? null : Number(v); };
  var sp = []; try { sp = JSON.parse(String(r[8] || '[]')); } catch (e) {}
  return { quarter: fsText_(r[0]), taken: r[1] instanceof Date ? r[1].toISOString().slice(0, 10) : fsText_(r[1]), netWorth: n(r[2]), cash: n(r[3]), goalsSetAside: n(r[4]),
    hsaBalance: n(r[5]), fsaLeft: n(r[6]), planStatus: fsText_(r[7]), spending: sp, source: fsText_(r[9]) };
}
/** Pure: decision rows → objects; carried: this quarter's plus any still open from before. */
function fsDecisionFrom_(r) {
  return { id: fsText_(r[0]), quarter: fsText_(r[1]), text: fsText_(r[2]), owner: fsText_(r[3]) || 'Both', due: r[4] instanceof Date ? r[4].toISOString().slice(0, 10) : fsText_(r[4]),
    status: fsText_(r[5]) === 'done' ? 'done' : 'open', doneOn: fsText_(r[6]), topic: fsText_(r[7]), notes: fsText_(r[8]), created: fsText_(r[9]), updated: fsText_(r[10]) };
}
function fsCarried_(decisions, quarter) {
  return (decisions || []).filter(function(d) { return d.quarter === quarter || (d.status === 'open' && d.quarter < quarter); })
    .sort(function(a, b) { return (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1) || String(a.due || '9').localeCompare(String(b.due || '9')) || a.created.localeCompare(b.created); });
}

// ---- reading the sources (each on its own) ---------------------------------------------------

function fsToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function fsTry_(fn) { try { var r = fn(); return r == null ? { error: 'not set up' } : r; } catch (e) { return { error: e.message || String(e) }; } }

/** Every source the page reads. Never throws: a source that fails is { error }. */
function fsSources_(today) {
  var cfg = {}; try { cfg = getConfigValues() || {}; } catch (e) {}
  var plannerId = fsText_(cfg['planner_sheet_id']);
  var tabs = fsTry_(function() { if (!plannerId) return { error: 'the planner isn’t connected (Config planner_sheet_id)' }; return nwReadTabs_(plannerId, ['Outputs', 'CDs', 'Plan items', 'Goals', 'Settings']); });
  var planner = tabs.error ? { error: tabs.error } : fsOutputs_(tabs['Outputs']);
  var cds = tabs.error ? { error: tabs.error } : fsTry_(function() { var c = nwParseCds_(tabs['CDs']); return c.status === 'ok' ? { items: c.items } : { error: c.reason }; });
  var plans = tabs.error ? { error: tabs.error } : fsTry_(function() { var p = nwParsePlans_(tabs['Plan items']); return p.status === 'ok' ? { items: p.items } : { error: p.reason }; });
  var goals = tabs.error ? { error: tabs.error } : fsTry_(function() {
    var g = pgParseGoals_(tabs['Goals']); if (g.status !== 'ok') return { error: g.reason };
    var settings = pgSettings_(tabs['Settings']);
    return pgBuild_(g.goals, pgHouse_(settings), plans.items || [], pgOutputs_(tabs['Outputs']), 'floor' in settings ? nwNumber_(settings['floor']) : null, today); });
  var health = fsTry_(function() { return webGetHealthAccounts_(); });
  var budget = fsTry_(function() { var p = bsPlan_(); if (p.error) return { error: p.error }; p.list = bsBills_(p.computed, bsReadSchedule_()); return p; });
  var month = today.slice(0, 7), q = fsQuarter_(today), qMonths = fsQuarterMonths_(q);
  var tx = budget.error ? null : fsTry_(function() { var t = bsReadTransactions_(qMonths); return t === null ? { error: 'the transactions sheet isn’t connected' } : { rows: t }; });
  var aliases = {}; try { aliases = getConfigAliases_() || {}; } catch (e) {}
  var spendMonth = budget.error ? { error: budget.error } : fsSpending_(budget.computed, budget.list, tx && tx.rows || [], [month], aliases);
  var billRows = budget.error ? null : fsTry_(function() { return bsBillRows_(month); });
  var bills = !billRows || billRows.error ? { error: (billRows && billRows.error) || 'the bills couldn’t be read' } : { items: billRows.filter(function(r) { return fsText_(r[0]); }).map(function(r) {
    return { line: fsText_(r[0]), amount: r[1] === '' ? null : Number(r[1]), dueDay: r[2] === '' ? null : Number(r[2]), paid: fsText_(r[6]) === month, income: /income/i.test(fsText_(r[8])) }; }) };
  var cards = fsTry_(function() { var c = webGetCards_(); return c && c.ok !== false ? { items: c.cards || [] } : { error: (c && c.error) || 'Cards couldn’t be read' }; });
  var returns = fsTry_(function() { var p = webPlannedPurchases_(); return p && p.ok !== false ? { items: (p.purchases || p.items || []).map(function(x) { return { item: x.item, returnBy: x.returnBy }; }) } : { error: 'Planned Purchases couldn’t be read' }; });
  return { today: today, month: month, quarter: q, planner: planner, cds: cds, plans: plans, goals: goals, health: health, budget: budget, tx: tx,
    spendMonth: spendMonth, bills: bills, cards: cards, returns: returns, aliases: aliases };
}

/** The figures a snapshot keeps, from the sources. */
function fsFigures_(S) {
  var hsa = S.health && !S.health.error && S.health.hsa, fsa = S.health && !S.health.error ? (S.health.fsa || []) : [];
  var fsaLeft = fsa.length ? fsRound_(fsa.filter(function(f) { return f.year === Number(S.today.slice(0, 4)); }).reduce(function(s, f) { return s + (f.balance || 0); }, 0)) : null;
  return { netWorth: S.planner.error ? null : S.planner.netWorth, cash: S.planner.error ? null : S.planner.cash, planStatus: S.planner.error ? '' : S.planner.planStatus,
    goalsSetAside: S.goals && !S.goals.error && S.goals.summary ? S.goals.summary.setAside : null, hsaBalance: hsa ? hsa.balance : null, fsaLeft: fsaLeft };
}

function fsSheet_(name, headers) { return tiSchema_(ensureSheet(getSpreadsheet(), name, headers), headers); }
function fsSnapshots_() { return tiRows_(fsSheet_(FS_SNAP_TAB_, FS_SNAP_HEADERS_), FS_SNAP_HEADERS_.length).map(fsSnapshotFrom_).filter(function(s) { return s && s.quarter; }); }
function fsDecisions_() { return tiRows_(fsSheet_(FS_DEC_TAB_, FS_DEC_HEADERS_), FS_DEC_HEADERS_.length).filter(function(r) { return fsText_(r[0]); }).map(fsDecisionFrom_); }

/**
 * Nightly (and on the first check-in read): this quarter's snapshot, once. A missed 1st is caught up
 * by the next run, because the test is "no row for this quarter yet", not "today is the 1st". The
 * spending kept is the quarter that just ended (actual when its transactions were uploaded).
 */
function fsTakeSnapshot_(S) {
  S = S || fsSources_(fsToday_());
  return tiLocked_(function() {
    var sheet = fsSheet_(FS_SNAP_TAB_, FS_SNAP_HEADERS_);
    var have = tiRows_(sheet, FS_SNAP_HEADERS_.length).some(function(r) { return fsText_(r[0]) === S.quarter; });
    if (have) return { taken: false, quarter: S.quarter };
    var prevQ = fsPrevQuarter_(S.quarter), months = fsQuarterMonths_(prevQ), spending = null;
    if (!S.budget.error) {
      var tx = fsTry_(function() { return { rows: bsReadTransactions_(months) || [] }; });
      spending = fsSpending_(S.budget.computed, S.budget.list, tx.rows || [], months, S.aliases);
    }
    sheet.appendRow(fsSnapshotRow_(S.quarter, S.today, fsFigures_(S), spending));
    return { taken: true, quarter: S.quarter };
  });
}

/** GET checkin → everything the Summary page shows. */
function webGetCheckin_() {
  var S = fsSources_(fsToday_());
  try { fsTakeSnapshot_(S); } catch (e) {}
  var snaps = fsSnapshots_(), now = fsFigures_(S);
  var prev = snaps.filter(function(s) { return s.quarter === S.quarter; })[0] || snaps.filter(function(s) { return s.quarter < S.quarter; }).slice(-1)[0] || null;
  var decisions = fsDecisions_();
  var notesRow = tiRows_(fsSheet_(FS_NOTES_TAB_, FS_NOTES_HEADERS_), FS_NOTES_HEADERS_.length).filter(function(r) { return fsText_(r[0]) === S.quarter; })[0];
  var qMonths = fsQuarterMonths_(S.quarter).filter(function(m) { return m <= S.month; });
  var budgetMonths = S.budget.error ? [] : qMonths.map(function(m) { var sp = fsSpending_(S.budget.computed, S.budget.list, (S.tx && S.tx.rows) || [], [m], S.aliases); sp.month = m; return sp; });
  var quarterSpend = S.budget.error ? { error: S.budget.error } : fsSpending_(S.budget.computed, S.budget.list, (S.tx && S.tx.rows) || [], qMonths, S.aliases);
  var scenarios = []; try { scenarios = bgListScenarios_(); } catch (e) {}
  var health = S.health.error ? {} : S.health;
  var att = fsAttention_({ bills: S.bills, spend: S.spendMonth, plans: S.plans, cds: S.cds, cards: S.cards, returns: S.returns,
    fsa: S.health.error ? { error: S.health.error } : { items: health.fsa || [] } }, S.today);
  var errs = {}; ['planner', 'goals', 'health', 'budget', 'cds', 'plans'].forEach(function(k) { if (S[k] && S[k].error) errs[k] = S[k].error; });
  return {
    ok: true, today: S.today, quarter: S.quarter, month: S.month,
    tiles: { netWorth: now.netWorth, planStatus: now.planStatus, cash: now.cash, cashLow: S.planner.cashLow || null, cashLowWhen: S.planner.cashLowWhen || '', floor: S.planner.floor || null,
      spend: S.spendMonth.error ? null : { source: S.spendMonth.source, plan: S.spendMonth.total.plan, actual: S.spendMonth.total.actual },
      goals: S.goals && !S.goals.error && S.goals.summary ? S.goals.summary : null },
    attention: att,
    health: { fsa: (health.fsa || []).map(function(f) { return { year: f.year, balance: f.balance, useBy: f.useBy, daysLeft: f.daysLeft, atRisk: f.atRisk }; }),
      hsa: health.hsa ? { year: health.hsa.year, balance: health.hsa.balance, limit: health.hsa.limit, room: health.hsa.room, put: fsRound_((health.hsa.you || 0) + (health.hsa.employer || 0)) } : null },
    checkin: {
      since: prev ? prev.quarter + ' snapshot, taken ' + prev.taken : '', changes: fsChanges_(now, prev),
      spending: quarterSpend,
      discuss: fsDiscuss_(now, prev, { months: budgetMonths }, health, S.cds.error ? [] : S.cds.items, S.goals && S.goals.goals || [], decisions, scenarios, S.budget.error ? null : S.budget.computed, S.today),
      decisions: fsCarried_(decisions, S.quarter), notes: notesRow ? fsText_(notesRow[1]) : '' },
    unavailable: errs,
  };
}

/** POST checkin_decision_save { id?, text, owner, due, topic, notes } → { ok, decision } */
function webSaveCheckinDecision_(body) {
  body = body || {};
  var text = fsText_(body.text).slice(0, 300);
  if (!text) return { ok: false, error: 'What did you decide?' };
  var owner = { ahmed: 'Ahmed', victoria: 'Victoria', both: 'Both' }[fsText_(body.owner).toLowerCase()] || 'Both';
  var due = fsText_(body.due);
  if (due && due !== 'next check-in' && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { ok: false, error: 'A due date is YYYY-MM-DD, or “next check-in”.' };
  var today = fsToday_();
  if (due === 'next check-in') due = fsNextQuarterStart_(today);
  return tiLocked_(function() {
    var sheet = fsSheet_(FS_DEC_TAB_, FS_DEC_HEADERS_), now = tiNow_();
    var id = fsText_(body.id), row = id ? tiRowOf_(sheet, FS_DEC_HEADERS_.length, id) : -1;
    if (id && row === -1) return { ok: false, error: 'That decision no longer exists.' };
    if (row === -1) {
      id = tiMintId_('DEC-');
      var r = [id, fsQuarter_(today), text, owner, due, 'open', '', fsText_(body.topic).slice(0, 120), fsText_(body.notes).slice(0, 500), now, now];
      sheet.appendRow(r); return { ok: true, decision: fsDecisionFrom_(r) };
    }
    var cur = sheet.getRange(row, 1, 1, FS_DEC_HEADERS_.length).getValues()[0];
    cur[2] = text; cur[3] = owner; cur[4] = due; cur[7] = body.topic != null ? fsText_(body.topic).slice(0, 120) : cur[7]; cur[8] = body.notes != null ? fsText_(body.notes).slice(0, 500) : cur[8]; cur[10] = now;
    sheet.getRange(row, 1, 1, FS_DEC_HEADERS_.length).setValues([cur]);
    return { ok: true, decision: fsDecisionFrom_(cur) };
  });
}

/** POST checkin_decision_toggle { id } → done ↔ open. */
function webToggleCheckinDecision_(body) {
  var id = fsText_(body && body.id);
  if (!id) return { ok: false, error: 'id required' };
  return tiLocked_(function() {
    var sheet = fsSheet_(FS_DEC_TAB_, FS_DEC_HEADERS_), row = tiRowOf_(sheet, FS_DEC_HEADERS_.length, id);
    if (row === -1) return { ok: false, error: 'That decision no longer exists.' };
    var cur = sheet.getRange(row, 1, 1, FS_DEC_HEADERS_.length).getValues()[0];
    var done = fsText_(cur[5]) !== 'done';
    cur[5] = done ? 'done' : 'open'; cur[6] = done ? fsToday_() : ''; cur[10] = tiNow_();
    sheet.getRange(row, 1, 1, FS_DEC_HEADERS_.length).setValues([cur]);
    return { ok: true, decision: fsDecisionFrom_(cur) };
  });
}

/** POST checkin_notes_save { quarter?, notes } — one row per quarter. */
function webSaveCheckinNotes_(body) {
  var q = /^\d{4}-Q[1-4]$/.test(fsText_(body && body.quarter)) ? fsText_(body.quarter) : fsQuarter_(fsToday_());
  var notes = String(body && body.notes || '').slice(0, 5000);
  return tiLocked_(function() {
    var sheet = fsSheet_(FS_NOTES_TAB_, FS_NOTES_HEADERS_), rows = tiRows_(sheet, FS_NOTES_HEADERS_.length), now = tiNow_();
    for (var i = 0; i < rows.length; i++) if (fsText_(rows[i][0]) === q) { sheet.getRange(i + 2, 1, 1, 3).setValues([[q, notes, now]]); return { ok: true, quarter: q }; }
    sheet.appendRow([q, notes, now]);
    return { ok: true, quarter: q };
  });
}

// ---- reminders -------------------------------------------------------------------------------

/** Pure: the days to the next quarter's first day. */
function fsDaysToNextQuarter_(today) { var nq = fsNextQuarterStart_(today); return { quarter: fsQuarter_(nq), start: nq, days: fsDays_(today, nq) }; }

/** Pure: the reminders due today. → [{ key, subject, message }] */
function fsRemindersDue_(today, reminderDays, discuss, decisions) {
  var out = [], n = reminderDays == null || isNaN(reminderDays) ? 7 : reminderDays, next = fsDaysToNextQuarter_(today);
  if (next.days === n) {
    var list = (discuss || []).slice(0, 8).map(function(t) { return '• ' + t.text; }).join('\n');
    out.push({ key: 'quarterly_checkin_' + next.quarter, notif: 'quarterly_checkin', subject: 'Money check-in for ' + next.quarter + ' in ' + n + ' days',
      message: '🗓️ Our quarterly money check-in is coming up (' + next.quarter + ' starts ' + next.start + ').' + (list ? '\n\nSuggested to discuss:\n' + list : '') + '\n\nOpen Finances › Summary › Quarter check-in.' });
  }
  (decisions || []).forEach(function(d) {
    if (d.status !== 'open' || !/^\d{4}-\d{2}-\d{2}$/.test(d.due)) return;
    var k = fsDays_(today, d.due);
    if (k !== 3 && k !== 0) return;
    out.push({ key: 'checkin_decision_' + d.id + '_' + d.due + '_' + k, notif: 'quarterly_checkin', subject: 'Decision due ' + (k ? 'in 3 days' : 'today') + ': ' + d.text,
      message: '✅ ' + (d.owner || 'Both') + ': “' + d.text + '” is due ' + (k ? 'in 3 days (' + d.due + ')' : 'today') + '. Tick it off in Finances › Summary › Quarter check-in.' });
  });
  return out;
}

/** Nightly: the snapshot, then any check-in or decision reminder due today. */
function fsNightly_() {
  var c = webGetCheckin_();   // reads every source once, and takes this quarter's snapshot when it's missing
  var cfg = {}; try { cfg = getConfigValues() || {}; } catch (e) {}
  var days = cfg['checkin_reminder_days'] === undefined || cfg['checkin_reminder_days'] === '' ? 7 : Number(cfg['checkin_reminder_days']);
  fsRemindersDue_(c.today, days, c.checkin.discuss, fsDecisions_()).forEach(function(r) {
    if (typeof wasRecentlySent_ === 'function' && wasRecentlySent_(r.key, 60 * 24 * 30)) return;
    sendNudge_(r.key, r.subject, r.message, r.notif);
  });
}
