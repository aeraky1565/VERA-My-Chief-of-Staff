// Finances › Bills & cashflow (BillSchedule.js, issue #226 stage B) on an invented tracker:
// bills from the tracker's shared lines in due-day order, budget lines left out, a credit folded
// into its bill, the due day from the name or set in VERA, card payments apart and never counted,
// Joint Checking through the month against the checkpoint windows, the quarterly reconcile
// (plan × 3, each transaction once, "not in uploads"), the one-time migration from the old Bills
// list, and neither the tracker nor the old Bills sheet ever written. Every figure is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const { tracker } = require('./budget_fixture.js');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BS = read('BillSchedule.js'), BG = read('Budget.js'), WEB = read('WebApp.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}

// ---- fake sheets: the tracker, VERA's own sheet (with the old Bills list), the transactions sheet ----
const writes = [];
function fakeSheet(name, grid, owner) {
  const note = () => { if (owner !== 'vera' || name === 'Bills') writes.push(owner + ':' + name); };
  const sh = { getName: () => name, getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }), getLastRow: () => grid.length,
    getLastColumn: () => grid.reduce((m, r) => Math.max(m, r.length), 0),
    getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => ((grid[r - 1 + i] || [])[c - 1 + j]) ?? '')),
      setValues: v => { note(); v.forEach((row, i) => row.forEach((x, j) => { while (grid.length < r + i) grid.push([]); grid[r - 1 + i][c - 1 + j] = x; })); return sh; },
      setValue: x => { note(); grid[r - 1][c - 1] = x; return sh; },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; } }),
    appendRow: row => { note(); grid.push(row.slice()); }, deleteRow: r => { note(); grid.splice(r - 1, 1); }, setFrozenRows() {} };
  return sh;
}
const TRACKER = tracker();
const VERA = { Bills: [['Bill', 'Amount', 'Due Day', 'Frequency', 'Category', 'Account', 'Paid', 'Notes', 'Type', 'Budget Entry'],
  ['Rent', 2000, 1, 'Monthly', 'Housing', 'Joint', '', 'landlord portal', 'Expense', 'Rent'],
  ['Electricity', 90, 15, 'Monthly', 'Utilities', 'Joint', '', '', 'Expense', 'Utilities - Electric'],
  ['Internet bill', 60, 13, 'Monthly', 'Utilities', 'Joint', '', '', 'Expense', ''],
  ['Paycheck', 5000, 15, 'Bi-weekly', 'Income', 'Pat checking', '', '', 'Income', ''],
  ['Gold Card', '', 30, 'Monthly', 'Credit Card', 'Pat checking', '', 'pay in full', 'Expense', ''],
  ['Gym', 40, 5, 'Monthly', 'Fitness', 'Pat', '', '', 'Expense', ''],
  ['Rent', 2000, 1, 'Monthly', 'Housing', 'Joint', '', 'again', 'Expense', 'Rent']] };
const BILLS_BEFORE = J(VERA.Bills);
const TX = { 'Transactions - Pat': [['Date', 'Account', 'Description', 'Category', 'Tags', 'Amount'],
  [new Date(2026, 6, 1), 'Joint', 'ACME PROPERTY RENT', 'Rent', '', -2000], [new Date(2026, 7, 1), 'Joint', 'ACME PROPERTY RENT', 'Rent', '', '-$2,000.00'],
  [new Date(2026, 8, 1), 'Joint', 'ACME PROPERTY RENT', 'Rent', '', -2000], [new Date(2026, 8, 2), 'Joint', 'RENT ELECTRIC FEE', 'Fees', '', -10],
  [new Date(2026, 6, 15), 'Joint', 'CITY ELECTRIC CO', 'Utilities', '', -100], [new Date(2026, 7, 15), 'Joint', 'CITY ELECTRIC CO', 'Utilities', '', -110],
  [new Date(2026, 8, 15), 'Joint', 'CITY ELECTRIC CO', 'Utilities', '', -122],
  [new Date(2026, 6, 13), 'Joint', 'NETCO BROADBAND', 'Utilities', '', -60], [new Date(2026, 7, 13), 'Joint', 'NETCO BROADBAND', 'Utilities', '', -60], [new Date(2026, 8, 13), 'Joint', 'NETCO BROADBAND', 'Utilities', '', -60],
  [new Date(2026, 8, 30), 'Pat checking', 'GOLD CARD PAYMENT THANK YOU', 'Transfer', '', -900],
  [new Date(2026, 8, 30), 'Pat checking', 'PAYROLL', 'Income', '', 5000], [new Date(2026, 9, 1), 'Joint', 'ACME PROPERTY RENT', 'Rent', '', -2000],
  [new Date(2026, 6, 20), 'Pat card', 'MUSIC CLUB', 'Fun', '', -10], [new Date(2026, 7, 20), 'Pat card', 'MUSIC CLUB', 'Fun', '', -10], [new Date(2026, 8, 20), 'Pat card', 'MUSIC CLUB', 'Fun', '', -13]],
  'Transactions - Sam': [['Date', 'Account', 'Description', 'Category', 'Tags', 'Amount'],
  [new Date(2026, 7, 4), 'Sam card', 'GROCERIES OUTLET', 'Groceries', '', -500], [new Date(2026, 8, 4), 'Sam card', 'GROCERIES OUTLET', 'Groceries', '', -700],
  [new Date(2026, 7, 9), 'Sam card', 'CITY BOOKS', 'Books', '', -45], [new Date(2026, 8, 9), 'Sam card', 'MUSIC CLUB', 'Fun', '', -99]] };
const ss = (store, owner) => ({ getSheetByName: n => store[n] ? fakeSheet(n, store[n], owner) : null, getSheets: () => Object.keys(store).map(n => fakeSheet(n, store[n], owner)),
  insertSheet: n => { store[n] = []; return fakeSheet(n, store[n], owner); } });
const PROPS = { SAT_SHEET_ID: 'sat-test', TRANSACTIONS_SHEET_ID: 'tx-test' };
const CONFIG = { bills_transfer_day: '1' };
const S = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => PROPS[k] || null }) },
  SpreadsheetApp: { openById: id => id === 'sat-test' ? ss({ Tracker: TRACKER }, 'tracker') : id === 'tx-test' ? ss(TX, 'tx') : (() => { throw new Error('no such sheet'); })() },
  Utilities: { getUuid: () => 'abcdef12-3456-7890-0000', formatDate: (d, tz, f) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') },
  Session: { getScriptTimeZone: () => 'UTC' }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, Logger: { log() {} },
  getSpreadsheet: () => ss(VERA, 'vera'), getConfigValues: () => CONFIG, getConfigAliases_: () => ({ netco: 'Internet' }),
  TABS: { BILLS: 'Bills' }, BILL_HEADERS: ['Bill', 'Amount', 'Due Day', 'Frequency', 'Category', 'Account', 'Paid', 'Notes', 'Type', 'Budget Entry'],
};
vm.createContext(S);
vm.runInContext(extractFn(read('Code.js'), 'ensureSheet'), S);
['tiSchema_', 'tiRows_', 'tiRowOf_', 'tiMintId_', 'tiNow_', 'tiLocked_'].forEach(n => vm.runInContext(extractFn(read('TripIdeas.js'), n), S));
vm.runInContext(BG, S); vm.runInContext(BS, S);
const run = (expr, vars) => { Object.assign(S, vars || {}); return vm.runInContext(expr, S); };
const C = run('budgetCompute_(budgetModel_(G), {}, {})', { G: tracker() });
S.C = C;

console.log('\nthe bills list');
let L = run('bsBills_(C, {})');
check('the shared lines as bills, by due day, undated last (by name)', L.bills.map(b => b.line + '@' + (b.dueDay || '-')).join() === 'Rent@1,Family Plan Payment@12,Internet@13,Utilities - Electric@15,Dog Walker@-,Health Insurance - Medical@-,Subscription - Stream@-', L.bills.map(b => b.line + '@' + (b.dueDay || '-')).join());
check('budget lines (Household) are not bills', J(L.budgetLines) === J(['Groceries', 'Home Cleaning']));
check('a credit folds into its bill: net, with the credit kept', (() => { const f = L.bills.find(b => b.line === 'Family Plan Payment'); return f.amount === 150 && f.credit === 50 && f.gross === 200 && !L.bills.some(b => /Credit/.test(b.line)); })());
check('amounts and accounts from the tracker; the due day from the name', L.bills[0].amount === 2000 && L.bills[0].account === 'Joint' && L.bills[0].dueFrom === 'name');
check('the monthly total of bills', L.total === 2450, L.total);
const SCHED = run('bsScheduleMap_(R)', { R: [['Health Insurance - Medical', 5, 'Pat card', 'TRUE', '', 'bill', 'payroll'], ['Gold Card', 3, 'Pat checking', 'yes', 'Gold Card', 'card payment', ''], ['Internet', 20, '', false, '', 'bill', '']] });
S.SCHED = SCHED;
L = run('bsBills_(C, SCHED)');
const med = L.bills.find(b => b.line === 'Health Insurance - Medical');
check('VERA’s due day, account and autopay win', med.dueDay === 5 && med.dueFrom === 'set' && med.account === 'Pat card' && med.trackerAccount === 'Pat' && med.autopay === true && med.notes === 'payroll', J(med));
check('a set due day beats the one in the name', L.bills.find(b => b.line === 'Internet').dueDay === 20);
check('card payments sit apart, never in the bills or their total', J(L.cards.map(c => c.line + '@' + c.dueDay)) === J(['Gold Card@3']) && !L.bills.some(b => /Gold/.test(b.line)) && L.total === 2450);

check('a tracker line marked as a card payment leaves the bills', (() => { const l = run('bsBills_(C, bsScheduleMap_([["Subscription - Stream", "", "", "", "Stream Card", "card payment", ""]]))');
  return !l.bills.some(b => b.line === 'Subscription - Stream') && l.total === 2440 && l.cards.some(c => c.line === 'Subscription - Stream'); })());
console.log('\nJoint Checking through the month');
let T = run('bsTimeline_(bsBills_(C, {}), C, { transferDay: 1, opening: 0 })');
check('transfers in, Joint bills out, a bill’s money back in before it goes out gross, with the running balance', J(T.events.map(e => e.day + ':' + e.what + ':' + e.balance)) === J(['1:Pat → AMEX Checking:1690', '1:Sam → AMEX Checking:2340', '1:Rent:340', '12:Family Plan Payment: money back, before it’s due:390', '12:Family Plan Payment:190', '13:Internet:130', '15:Utilities - Electric:40']), J(T.events.map(e => e.day + ':' + e.what + ':' + e.balance)));
check('only Joint bills (a bill on someone’s own card isn’t here)', !T.events.some(e => /Medical|Stream/.test(e.what)));
check('the checkpoint windows: what’s due in each and what to keep from its first day', J(T.windows.map(w => [w.window, w.due, w.need])) === J([['1–7', 2000, 2300], ['8–20', 300, 300], ['21+', 0, 0]]), J(T.windows));
check('the low point, and the Joint bills with no due day', T.low.day === 15 && T.low.balance === 40 && J(T.undated) === J(['Dog Walker']));
T = run('bsTimeline_(bsBills_(C, {}), C, { transferDay: 5, opening: 100 })');
check('a later transfer day and an opening balance: Rent goes before the money arrives', T.events[0].what === 'Rent' && T.events[0].balance === -1900 && T.low.balance === -1900);

console.log('\nReconcile (quarterly)');
check('quarters to months', J(run('bsQuarterMonths_("2026-Q3")')) === J(['2026-07', '2026-08', '2026-09']) && run('bsQuarterMonths_("2026-Q5")') === null);
const txRows = [];
Object.keys(TX).forEach(k => TX[k].slice(1).forEach(r => txRows.push({ owner: k.replace(/^Transactions - /, '').toLowerCase(), month: r[0].getFullYear() + '-' + String(r[0].getMonth() + 1).padStart(2, '0'), description: r[2], amount: typeof r[5] === 'number' ? r[5] : parseFloat(String(r[5]).replace(/[$,]/g, '')) })));
S.TXR = txRows;
const R = run('bsReconcile_(C, bsBills_(C, SCHED), TXR, "2026-Q3", { netco: "Internet" })');
const by = n => R.rows.find(r => r.line === n) || {};
check('plan × 3 against actual: on plan is ✓', by('Rent').plan === 6000 && by('Rent').actual === 6010 && by('Rent').flag === 'ok', J(by('Rent')));
check('a difference is flagged by name', by('Utilities - Electric').actual === 332 && by('Utilities - Electric').flag === 'Utilities - Electric +$62.00', J(by('Utilities - Electric')));
check('…each transaction counted once (the rent-and-electric fee went to Rent only)', by('Utilities - Electric').count === 3);
check('a Config alias matches a line', by('Internet').actual === 180 && by('Internet').flag === 'ok');
check('budget lines are reconciled too, under spend flagged', by('Groceries').kind === 'budget line' && by('Groceries').actual === 1200 && by('Groceries').flag === 'Groceries −$600.00', J(by('Groceries')));
check('a line nothing covers says “not in uploads”', by('Health Insurance - Medical').flag === 'not in uploads' && by('Health Insurance - Medical').actual === null);
check('card payments, income and other quarters never count', R.uploads === 17 && !R.rows.some(r => /Gold/.test(r.line)), R.uploads);
check('quarter totals over the lines with uploads', R.totals.plan === 6000 + 270 + 180 + 1800 && R.totals.actual === 6010 + 332 + 180 + 1200 && R.totals.flagged === 2, J(R.totals));

console.log('\nplan vs actual for the Budget');
const BA = run('bsBudgetActuals_(C, bsBills_(C, SCHED), TXR, "2026-Q3", { netco: "Internet" })');
const al = n => BA.lines[n] || {};
check('every Budget line with a monthly plan and its actual as a monthly average', al('shared.fixed:Rent').plan === 2000 && al('shared.fixed:Rent').actual === 2003.33
  && al('shared.fixed:Utilities - Electric').actual === 110.67 && al('shared.fixed:Internet').actual === 60 && al('shared.fixed:Groceries').actual === 400, JSON.stringify(BA.lines['shared.fixed:Rent']));
check('a person’s own lines take only their own uploads', al('pat.nice:Music').actual === 11 && al('sam.nice:Books').actual === 15, JSON.stringify([al('pat.nice:Music'), al('sam.nice:Books')]));
check('…so the other person’s similar spending isn’t theirs', al('pat.nice:Music').actual !== (10 + 10 + 13 + 99) / 3);
check('a line nothing covers has no actual', al('shared.fixed:Health Insurance - Medical').actual === null && al('pat.fixed:Car Insurance - Pat').actual === null);
check('uploads per person', JSON.stringify(BA.owners) === JSON.stringify([{ key: 'pat', uploads: 13 }, { key: 'sam', uploads: 4 }]), JSON.stringify(BA.owners));

console.log('\nthe migration from the old Bills list');
S.OLD = VERA.Bills.slice(1);
let M = run('bsMigrate_(OLD, C, {})');
check('matched by Budget Entry, then by name', J(M.matched) === J([{ bill: 'Rent', line: 'Rent' }, { bill: 'Electricity', line: 'Utilities - Electric' }, { bill: 'Internet bill', line: 'Internet' }]), J(M.matched));
check('a card becomes a card payment; income is skipped; duplicates once', J(M.cards) === J(['Gold Card']) && J(M.skipped) === J(['Paycheck']) && M.rows.length === 4);
check('anything else is listed for a decision', J(M.unmatched.map(u => u.bill)) === J(['Gym']));
check('the rows carry due day, account and notes, never an amount', J(M.rows[0]) === J(['Rent', 1, 'Joint', false, '', 'bill', 'landlord portal']) && J(M.rows[3]) === J(['Gold Card', 30, 'Pat checking', false, 'Gold Card', 'card payment', 'pay in full']), J(M.rows));
check('a line already in Bill Schedule isn’t added again', run('bsMigrate_(OLD, C, { internet: {} })').rows.length === 3);

console.log('\nthe server');
let r = run('webGetBillsSchedule_()');
check('bills_schedule: bills, cards, timeline, and the migration offered while Bill Schedule is empty', r.ok && r.bills.length === 7 && r.timeline.events.length === 7 && r.migration && r.migration.matched.length === 3 && r.migration.unmatched.length === 1, J(Object.keys(r)));
r = run('webMigrateBillSchedule_({ apply: true })');
check('migrate writes Bill Schedule only', r.ok && r.written === 4 && VERA['Bill Schedule'].length === 5 && J(VERA['Bill Schedule'][0]) === J(['Tracker Line', 'Due Day', 'Account Override', 'Autopay', 'Card Link', 'Kind', 'Notes']), J(r));
check('…and twice adds nothing', run('webMigrateBillSchedule_({ apply: true })').written === 0 && VERA['Bill Schedule'].length === 5);
r = run('webGetBillsSchedule_()');
check('then the list has the card payment and no migration offer', r.cards.length === 1 && r.migration === null);
r = run('webSaveBillSchedule_({ line: "Internet", dueDay: 9, autopay: true, account: "" })');
check('save updates a line in place', r.ok && VERA['Bill Schedule'].filter(x => x[0] === 'Internet').length === 1 && VERA['Bill Schedule'].find(x => x[0] === 'Internet')[1] === 9);
check('…a new one is added', run('webSaveBillSchedule_({ line: "Dog Walker", dueDay: 28 })').ok && VERA['Bill Schedule'].some(x => x[0] === 'Dog Walker'));
check('…a bad due day is refused', run('webSaveBillSchedule_({ line: "Rent", dueDay: 40 })').ok === false && run('webSaveBillSchedule_({ line: "" })').ok === false);
r = run('webGetBillsReconcile_({ parameter: { quarter: "2026-Q3" } })');
check('bills_reconcile reads the uploads for the quarter', r.ok && r.quarter === '2026-Q3' && r.rows.find(x => x.line === 'Utilities - Electric').actual === 332, J(r).slice(0, 200));
check('no quarter given: the last full one', /^\d{4}-Q[1-4]$/.test(run('webGetBillsReconcile_({ parameter: {} })').quarter));
r = run('webGetBudgetActuals_({ parameter: { quarter: "2026-Q3" } })');
check('budget_actuals reads each person’s tab as theirs', r.ok && r.quarter === '2026-Q3' && r.lines['pat.nice:Music'].actual === 11 && r.lines['sam.nice:Books'].actual === 15, JSON.stringify(r).slice(0, 200));
delete PROPS.TRANSACTIONS_SHEET_ID;
check('no transactions sheet: says so', run('webGetBillsReconcile_({ parameter: { quarter: "2026-Q3" } })').noUploads === true && run('webGetBudgetActuals_({ parameter: {} })').noUploads === true);
check('neither the tracker, the uploads nor the old Bills list was written', writes.length === 0 && J(VERA.Bills) === BILLS_BEFORE, J(writes));
check('the routes are wired', /case 'bills_schedule':\s+return jsonOut_\(webGetBillsSchedule_\(\)\)/.test(WEB) && /case 'bills_reconcile':\s+return jsonOut_\(webGetBillsReconcile_\(e\)\)/.test(WEB)
  && /case 'bills_schedule_save':\s+return jsonOut_\(webSaveBillSchedule_\(body\)\)/.test(WEB) && /case 'bills_schedule_migrate':\s+return jsonOut_\(webMigrateBillSchedule_\(body\)\)/.test(WEB) && /case 'budget_actuals':\s+return jsonOut_\(webGetBudgetActuals_\(e\)\)/.test(WEB));
check('the old Bills readers are still routed', /case 'bills':\s+return jsonOut_\(webGetBills_\(\)\)/.test(WEB) && /case 'cashflow':\s+return jsonOut_\(webGetCashflow_\(e\)\)/.test(WEB) && /case 'calendar_bills':/.test(WEB));
const UI_S = '// ---- BillsCashflowTab (Finances › Day to day › Bills & cashflow, issue #226) — SHARED VERBATIM', UI_E = '// ---- /BillsCashflowTab ----';
const ub = s => { const a = s.indexOf(UI_S), b = s.indexOf(UI_E); return a === -1 || b === -1 ? '' : s.slice(a, b); };
check('both dashboards carry the tab, word for word', ub(APP).length > 2000 && ub(APP) === ub(LITE));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
