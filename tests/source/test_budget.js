// Finances › Budget (Budget.js and the BudgetEngine block it shares with both dashboards,
// issue #226): the budget tracker's Household Split tab read by label — paychecks (per paycheck ×
// paychecks in a regular month, a "Shared cost? Yes" deduction joining the shared costs from that
// person's pay), bills by Type / For / Paid by / Actual or set-aside / Category, the split — and every
// figure the sheet shows worked out to match it: shares, Joint transfers, left over, settle-up,
// set-asides, the emergency fund. Then writing back: only input cells, found by label, a formula
// refused, every change checked before any is made; adding a bill in the first empty row or a new
// one inside the list; owner only. What if, scenarios, the HSA plan, and the old Tracker tab never
// read. Every name and figure is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BG = read('Budget.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html'), WEB = read('WebApp.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

const START = '// ---- BudgetEngine (Finances › Budget, issue #226) — SHARED VERBATIM', END = '// ---- /BudgetEngine ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
console.log('\nthe shared engine');
check('Budget.js and both dashboards carry it, word for word', block(BG).length > 2000 && block(BG) === block(APP) && block(BG) === block(LITE));

const { tracker } = require('./budget_fixture.js');

// ---- the server, in a vm with a fake tracker and a fake VERA sheet ----
const writes = [];
function fakeSheet(name, grid, tracked) {
  const sh = { name, grid,
    getName: () => name,
    getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }),
    getLastRow: () => grid.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => ((grid[r - 1 + i] || [])[c - 1 + j]) ?? '')),
      setValues: v => { if (tracked) writes.push(name); v.forEach((row, i) => row.forEach((x, j) => { while (grid.length < r + i) grid.push([]); grid[r - 1 + i][c - 1 + j] = x; })); return sh; },
      setValue: x => { if (tracked) writes.push(name + '!' + r + ':' + c); while (grid.length < r) grid.push([]); grid[r - 1][c - 1] = x; return sh; },
      getFormula: () => FORMULAS[r + ':' + c] || '',
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; } }),
    appendRow: row => { if (tracked) writes.push(name); grid.push(row.slice()); },
    insertRowAfter: r => { if (tracked) INSERTED.push(r); grid.splice(r, 0, []); },
    deleteRow: r => { if (tracked) writes.push(name); grid.splice(r - 1, 1); },
    setFrozenRows() {} };
  return sh;
}
let TRACKER = tracker();
const FORMULAS = {};   // 'row:col' → a formula, for the cells the sheet works out
const OLD = [['2026'], ['', 'Pat', '', '', 'Shared Expenses']];
let INSERTED = [];
const trackerSs = () => ({ getSheetByName: n => n === 'Household Split' ? fakeSheet('Household Split', TRACKER, true) : n === 'Tracker' ? fakeSheet('Tracker', OLD, true) : null,
  getSheets: () => [fakeSheet('Tracker', OLD, true), fakeSheet('Household Split', TRACKER, true)] });
const VERA = {}, CONFIG = {};
const veraSs = { getSheetByName: n => VERA[n] ? fakeSheet(n, VERA[n], false) : null, insertSheet: n => { VERA[n] = []; return fakeSheet(n, VERA[n], false); } };
let uid = 0;
const S = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => k === 'SAT_SHEET_ID' ? 'sat-test' : null }) },
  SpreadsheetApp: { openById: id => { if (id !== 'sat-test') throw new Error('no such sheet'); return trackerSs(); } },
  Utilities: { getUuid: () => 'abcdef12-3456-7890-' + String(++uid).padStart(4, '0'), formatDate: (d, tz, f) => f === 'yyyy' ? '2026' : '2026-11' },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Logger: { log() {} },
  getSpreadsheet: () => veraSs, getConfigValues: () => CONFIG, veraLog_: () => {}, _veraWho_: { owner: true },
  Session: { getScriptTimeZone: () => 'UTC' }, 
};
vm.createContext(S); loadSettings_(S);
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
const CODE = read('Code.js'), TI = read('TripIdeas.js');
vm.runInContext(extractFn(CODE, 'ensureSheet'), S);
['tiSchema_', 'tiRows_', 'tiRowOf_', 'tiMintId_', 'tiNow_', 'tiLocked_'].forEach(n => vm.runInContext(extractFn(TI, n), S));
vm.runInContext(BG, S);
const run = (expr, vars) => { Object.assign(S, vars || {}); return vm.runInContext(expr, S); };

console.log('\nreading Household Split by label');
let m = run('budgetModel_(G)', { G: tracker() });
check('it reads, nothing missing', m.ok === true && m.missing.length === 0, J(m.missing || m.error));
check('the two people come from the Paychecks heading', m.people.map(p => p.key + '/' + p.name).join() === 'pat/Pat,sam/Sam');
check('a paycheck: cadence, gross, net deposit, paychecks a year and in a regular month', (() => { const p = m.people[0];
  return p.cadence === 'Monthly' && p.grossPer === 10000 && p.netPer === 6900 && p.perYear === 12 && p.perMonth === 1 && p.gross === 10000; })());
check('deductions per paycheck and a month; taxes are one; a blank one is left out', J(m.people[0].deductions.map(x => x.name + '=' + x.per + '/' + x.amount)) === J(['401(k)=1000/1000', 'Taxes=2000/2000'])
  && m.people[1].deductions.length === 2, J(m.people[0].deductions.map(x => x.name)));
check('a “Shared cost? Yes” deduction is a shared cost taken from that person’s pay', J(m.shared.pay.map(x => [x.key, x.amount, x.account, x.fromPay])) === J([['shared.pay:Health Insurance - Medical', 100, 'Pat', 'pat']]));
check('each input keeps its cell', m.people[0].cells.gross.row === 6 && m.people[0].cells.gross.col === 2 && m.people[1].cells.gross.col === 3 && m.shared.pay[0].cell.row === 9);
check('bills: name without the due day, Type, For, Paid by, Kept as, Category, and its row', (() => { const r = m.shared.fixed[0];
  return r.key === 'shared.fixed:Rent' && r.name === 'Rent' && r.dueDay === 1 && r.account === 'Joint' && r.keptAs === 'Actual' && r.row === 21 && r.cells.amount.col === 2; })(), J(m.shared.fixed[0]));
check('shared by Type; a person’s own bills under them', m.shared.fixed.length === 6 && m.shared.nice.length === 3 && m.people[0].fixed.map(x => x.name).join() === 'Car Insurance - Pat,Phone - Pat' && m.people[1].nice[0].name === 'Books');
check('a shared bill paid by a person is on their account', m.shared.fixed.find(x => x.name === 'Groceries').account === 'Sam');
check('the split, shared and personal savings', m.split === 0.6 && m.sharedSavings === 1000 && m.people[0].psave === 300 && m.people[1].psave === 200);
check('the bills list’s empty rows and its Total bills row', J(m.cells.bills.blanks) === J([36, 37]) && m.cells.bills.total === 38 && m.cells.bills.first === 21, J(m.cells.bills));
check('a percent typed as a number reads as a share', run('budgetModel_(G).split', { G: tracker({ split: 60 }) }) === 0.6);
check('a sheet without the sections says which', /Paychecks/.test(run('budgetModel_(G).error', { G: [['Household split'], ['2. Bills']] })));
check('the old Tracker layout isn’t read', run('budgetModel_(G).ok', { G: OLD }) === false);
check('the bonuses section', m.bonus.usually.pat === 'March' && m.bonus.sharePct.sam === 0.5);

console.log('\nthe figures, as the sheet works them out');
let c = run('budgetCompute_(budgetModel_(G), {}, {})', { G: tracker() });
const [Pt, Sm] = c.people;
check('shared total: the shared bills and the shared cost from pay', c.shared.total === 3150 && c.shared.fixed === 3000 && c.shared.nice === 150 && c.shared.variable === 0);
check('take-home: gross − deductions − taxes − what comes from pay', Pt.net === 7000 && Pt.takeHome === 6900 && Sm.takeHome === 4600 && c.totalTakeHome === 11500);
check('each share, split 60 / 40', Pt.contribution === 1890 && Sm.contribution === 1260);
check('→ Joint: the share less shared costs on their own card or pay', Pt.ownCard === 100 && Pt.fromPay === 100 && Pt.checking === 1690 && Sm.checking === 650);
check('personal bills, left over', Pt.personalBills === 200 && Sm.personalBills === 100 && Pt.disposable === 4010 && Sm.disposable === 2640 && c.totalDisposable === 6650);
check('settle-up: what Pat covers of Sam’s share', c.settleUp === 286);
check('Joint pays out exactly what comes in', c.shared.joint === 2340 && c.jointCheck === 0);
check('set-asides, by who pays them', Pt.setAside === 100 && Sm.setAside === 0 && c.setAside === 100);
check('required: shared fixed and variable (the credit counts), × 3, 6, 9', c.shared.required === 3000 && c.emergency.map(e => e.total).join() === '9000,18000,27000' && c.emergency[0].byShare[0].amount === 5400);
check('share of take-home', Math.abs(Pt.takeHomeShare - 0.6) < 0.001);
check('two paychecks in a regular month: gross, deductions and take-home × 2', (() => { const g = tracker(); g.find(r => r[0] === 'Paychecks in a regular month')[1] = '2';
  const v = run('budgetCompute_(budgetModel_(G), {}, {})', { G: g }); return v.people[0].gross === 20000 && v.people[0].takeHome === 13800 && v.people[0].fromPay === 200 && v.shared.total === 3250; })());
check('a shared bill kept as set-aside counts for the person who pays it', (() => { const v = run('budgetCompute_(budgetModel_(G), {}, {})', { G: tracker({ bills: [['Jewellery cover', 12, 'Fixed', 'Shared', 'Pat', 'Set-aside', 'Insurance']] }) });
  return v.people[0].setAside === 112 && v.people[1].setAside === 0; })());
check('a variable bill is its own type, and counts as required', (() => { const v = run('budgetCompute_(budgetModel_(G), {}, {})', { G: tracker({ bills: [['Water', '$30.00', 'Variable', 'Shared', 'Joint', 'Actual', 'Utilities']] }) });
  return v.shared.variable === 30 && v.shared.required === 3030 && v.shared.lines.find(x => x.name === 'Water').kind === 'variable'; })());
check('the sheet’s Category wins over the rules; Config wins over both', (() => {
  const v = run('budgetCompute_(budgetModel_(G), {}, { water: "Bills" })', { G: tracker({ bills: [['Water', '$30.00', 'Variable', 'Shared', 'Joint', 'Actual', 'Utilities'], ['Fish food', 5, 'Fixed', 'Shared', 'Joint', 'Actual', 'Pets']] }) });
  return v.shared.lines.find(x => x.name === 'Water').category === 'Bills' && v.shared.lines.find(x => x.name === 'Fish food').category === 'Pets' && v.shared.lines.find(x => x.name === 'Rent').category === 'Housing'; })());
check('categories sum to the total', Math.abs(c.shared.categories.reduce((s, x) => s + x.total, 0) - c.shared.total) < 0.01);
check('groceries and cleaning are spending, not bills', c.shared.lines.filter(x => x.spend).map(x => x.name).join() === 'Groceries,Home Cleaning');
check('a bill missing Type, For or Paid by is counted', run('budgetCompute_(budgetModel_(G), {}, {}).incomplete', { G: tracker({ bills: [['Mystery', 9, '', 'Shared', 'Joint', 'Actual', '']] }) }) === 1);

console.log('\nVERA beside the sheet');
let match = run('budgetMatch_(M, budgetCompute_(M, {}, {}))', { M: m });
check('every figure matches the sheet', match.length >= 12 && match.every(r => r.ok), J(match.filter(r => !r.ok)));
check('a typed figure that’s wrong is named', (() => { const g = tracker(); g.find(r => r[0] === 'Transfer to Joint Checking')[1] = '$1,700.00';
  const rr = run('budgetMatch_(budgetModel_(G), budgetCompute_(budgetModel_(G), {}, {}))', { G: g }).filter(r => !r.ok); return rr.length === 1 && rr[0].id === 'pat.checking' && rr[0].diff === -10; })());
check('a net deposit that doesn’t follow from the deductions says so', (() => { const g = tracker(); g.find(r => r[0] === 'Net deposit per paycheck')[1] = '$7,000.00'; g.find(r => /^Take-home income/.test(r[0]))[1] = '$7,000.00';
  const rr = run('budgetMatch_(budgetModel_(G), budgetCompute_(budgetModel_(G), {}, {}))', { G: g }).find(r => r.id === 'pat.takeHome'); return rr && !rr.ok && /net deposit/.test(rr.because); })());

console.log('\nWhat if');
c = run('budgetCompute_(budgetModel_(G), { "shared.fixed:Rent": 2500, split: 0.5, "pat.gross": 11000 }, {})', { G: tracker() });
check('a bill, the split and gross pay rerun every sum', c.shared.total === 3650 && c.people[0].contribution === 1825 && c.people[0].takeHome === 7900);
check('a shared cost from pay can change too', run('budgetCompute_(budgetModel_(G), { "shared.pay:Health Insurance - Medical": 150 }, {}).people[0].fromPay', { G: tracker() }) === 150);
check('only known keys, as numbers, are kept for a scenario', J(run('bgCleanChanges_(budgetModel_(G), { "shared.fixed:Rent": "2500", "shared.pay:Health Insurance - Medical": 120, bogus: 5, "pat.gross": "x", split: 3 })', { G: tracker() }))
  === J({ 'shared.fixed:Rent': 2500, 'shared.pay:Health Insurance - Medical': 120, split: 1 }));

console.log('\nwriting back: which cells');
m = run('budgetModel_(G)', { G: tracker() }); S.M = m;
const plan = e => run('bgWritePlan_(M, E)', { E: e });
let w = plan([{ key: 'pat.gross', value: '10500' }]);
check('gross pay per paycheck: its cell, as a number', w.ok && J(w.writes.map(x => [x.row, x.col, x.value])) === J([[6, 2, 10500]]), J(w));
w = plan([{ key: 'shared.fixed:Rent', value: '2100' }, { key: 'shared.fixed:Rent', field: 'paidBy', value: 'sam' }, { key: 'pat.fixed:Phone - Pat', field: 'keptAs', value: 'set aside' }]);
check('a bill’s amount, Paid by (named as the sheet names people) and Kept as', w.ok && J(w.writes.map(x => [x.row, x.col, x.value])) === J([[21, 2, 2100], [21, 5, 'Sam'], [31, 6, 'Set-aside']]), J(w));
w = plan([{ key: 'split', value: 55 }, { key: 'sam.psave', value: 250 }, { key: 'pat.ssave', value: 700 }, { key: 'shared.pay:Health Insurance - Medical', value: 110 }, { key: 'sam.cadence', value: 'biweekly' }]);
check('the split (a percent), savings, a shared cost on a paycheck, and the pay cadence', w.ok && J(w.writes.map(x => [x.row, x.col, x.value])) === J([[41, 2, 0.55], [48, 3, 250], [46, 2, 700], [9, 2, 110], [5, 3, 'Biweekly']]), J(w));
check('a Type that isn’t one is refused', /Fixed, Variable or Nice to have/.test(plan([{ key: 'shared.fixed:Rent', field: 'type', value: 'Sometimes' }]).error));
check('For and Paid by only name the household', /For is one of: Shared, Pat, Sam/.test(plan([{ key: 'shared.fixed:Rent', field: 'forWho', value: 'Robin' }]).error));
check('taxes are refused (the sheet works them out)', /net deposit instead/.test(plan([{ key: 'pat.ded:Taxes', value: 1 }]).error));
check('a line the sheet no longer has is refused', /no longer has/.test(plan([{ key: 'shared.fixed:Boat', value: 1 }]).error));
check('the same cell twice is refused', /twice/.test(plan([{ key: 'pat.gross', value: 1 }, { key: 'pat.gross', value: 2 }]).error));
check('a name can’t start a formula', /can’t start/.test(plan([{ key: 'shared.fixed:Rent', field: 'name', value: '=IMPORTXML("x")' }]).error));
check('an amount must be a number', /Enter an amount/.test(plan([{ key: 'pat.gross', value: 'lots' }]).error));

console.log('\nwriting back: to the sheet');
const RESET = () => { TRACKER = tracker(); writes.length = 0; INSERTED = []; Object.keys(FORMULAS).forEach(k => delete FORMULAS[k]); };
RESET();
let r = run('webBudgetWrite_(B)', { B: { edits: [{ key: 'shared.fixed:Rent', value: 2100 }, { key: 'pat.gross', value: 10500 }] } });
check('it writes those cells of Household Split, and nothing else', r.ok && J(writes) === J(['Household Split!21:2', 'Household Split!6:2']) && TRACKER[20][1] === 2100 && TRACKER[5][1] === 10500, J(r) + J(writes));
RESET(); FORMULAS['13:2'] = '=B6-B8-B9-B14';
r = run('webBudgetWrite_(B)', { B: { edits: [{ key: 'pat.gross', value: 10500 }, { key: 'pat.net', value: 7000 }] } });
check('a cell holding a formula is refused, and then nothing at all is written', !r.ok && /worked out by the sheet/.test(r.error) && writes.length === 0, J(r));
RESET();
check('the old Tracker tab is never written', (run('webBudgetWrite_(B)', { B: { edits: [{ key: 'split', value: 0.5 }] } }), writes.every(x => /^Household Split!/.test(x))));
check('the budget_model route reads Household Split', /^\s*case 'budget_model':\s*return jsonOut_\(webGetBudgetModel_\(\)\);/m.test(WEB));
check('only the owner may write', /^\s*case 'budget_write':\s*return jsonOut_\(peopleOwnerOnly_\(\) \|\| webBudgetWrite_\(body\)\);/m.test(WEB) && /^\s*case 'budget_add_bill':\s*return jsonOut_\(peopleOwnerOnly_\(\) \|\| webBudgetAddBill_\(body\)\);/m.test(WEB));

console.log('\nadding a bill');
RESET();
r = run('webBudgetAddBill_(B)', { B: { name: 'Window Cleaner', amount: '25', type: 'nice to have', forWho: 'shared', paidBy: 'sam', keptAs: 'Set-aside', category: 'Home' } });
check('it goes in the first empty row of the list, every column filled', r.ok && r.row === 36 && J(TRACKER[35].slice(0, 7)) === J(['Window Cleaner', 25, 'Nice to have', 'Shared', 'Sam', 'Set-aside', 'Home']) && INSERTED.length === 0, J(r) + J(TRACKER[35]));
check('…and the model then reads it as a shared bill paid by Sam', (() => { const mm = run('budgetModel_(G)', { G: TRACKER }); const b = mm.shared.nice.find(x => x.name === 'Window Cleaner'); return b && b.account === 'Sam' && b.keptAs === 'Set-aside'; })());
RESET(); TRACKER = tracker({ noBlank: true });
r = run('webBudgetAddBill_(B)', { B: { name: 'Window Cleaner', amount: 25, type: 'Fixed', forWho: 'Pat', paidBy: 'Pat', keptAs: 'Actual' } });
check('with no empty row, a new row inside the list (so Total bills takes it in)', r.ok && J(INSERTED) === J([35]) && r.row === 36 && TRACKER[35][0] === 'Window Cleaner' && TRACKER[36][0] === 'Total bills', J(r) + J(INSERTED));
RESET();
check('a duplicate (same name, same For) is refused', /already a bill/.test(run('webBudgetAddBill_(B)', { B: { name: 'rent (1st)', amount: 1, forWho: 'Shared' } }).error) && /already a bill/.test(run('webBudgetAddBill_(B)', { B: { name: 'Rent', amount: 1, forWho: 'Shared' } }).error) && writes.length === 0);
check('a bill needs a name and an amount', /name/.test(run('webBudgetAddBill_(B)', { B: { amount: 5 } }).error) && /amount/.test(run('webBudgetAddBill_(B)', { B: { name: 'X' } }).error) && writes.length === 0);

console.log('\nthe HSA plan');
CONFIG.hsa_annual_2026 = '3300'; CONFIG.hsa_annual_2027 = '7600';
let hm = run('bgWithHsa_(budgetModel_(G), CFG, "2026").hsa', { G: tracker({ payDeductions: [['Health Savings (HSA)', '$275.00', '', 'No']] }), CFG: CONFIG });
check('the HSA line, its year from the sheet, and the plan for this year and next', hm && hm.key === 'pat.ded:Health Savings (HSA)' && hm.sheetAnnual === 3300 && hm.plan === 3300 && hm.next === 7600 && hm.nextYear === '2027', J(hm));
check('the plan never replaces the sheet’s figure', run('budgetCompute_(bgWithHsa_(budgetModel_(G), CFG, "2027"), {}, {}).people[0].deductions.find(x => /HSA/.test(x.name)).amount', { G: tracker({ payDeductions: [['Health Savings (HSA)', '$275.00', '', 'No']] }), CFG: CONFIG }) === 275);
delete CONFIG.hsa_annual_2026; delete CONFIG.hsa_annual_2027;

console.log('\nthe phone plan');
m = run('bgWithPhone_(budgetModel_(G), P)', { G: tracker(), P: { ok: true, total: 230, credit: 60, month: '2026-11', ours: 120, dueDay: 12 } });
check('the plan and its credit come from the phone tracker, the sheet’s kept', (() => { const a = m.shared.fixed.find(x => x.name === 'Family Plan Payment'), b = m.shared.fixed.find(x => x.name === 'Family Plan Credit');
  return a.amount === 230 && a.trackerAmount === 200 && b.amount === -60 && b.trackerAmount === -50 && m.phone.total === 230; })());
check('the real sheet’s names are swapped too', run('BG_PHONE_RX_.test("Phone family plan") && BG_PHONE_CREDIT_RX_.test("Phone plan credit") && !BG_PHONE_RX_.test("Phone plan credit")'));

console.log('\nscenarios, in VERA’s own sheet');
RESET();
r = run('webSaveBudgetScenario_(B)', { B: { name: 'Bigger flat', changes: { 'shared.fixed:Rent': 2500 } } });
check('saved with its results, the sheet untouched', r.ok && r.scenario.results.totalShared === 3650 && writes.length === 0 && VERA['Budget Scenarios'].length === 2);
check('listed back', run('bgListScenarios_()')[0].name === 'Bigger flat');
r = run('webSaveBudgetScenario_(B)', { B: { name: 'Rent from spring', changes: { 'shared.fixed:Rent': 2500 }, starts: { 'shared.fixed:Rent': '2027-04', bogus: '2027-01', 'shared.fixed:Internet': 'soon' } } });
check('a change can start in a later month; only real changes and real months are kept', r.ok && JSON.stringify(r.scenario.starts) === '{"shared.fixed:Rent":"2027-04"}' && JSON.stringify(run('bgListScenarios_()')[0].starts) === '{"shared.fixed:Rent":"2027-04"}' && JSON.stringify(run('bgListScenarios_()')[0].changes) === '{"shared.fixed:Rent":2500}', JSON.stringify(r.scenario));
check('an older scenario has no start months', JSON.stringify(run('bgListScenarios_()')[1].starts) === '{}');
check('nothing changed → not saved', /Nothing is changed/.test(run('webSaveBudgetScenario_(B)', { B: { name: 'x', changes: { bogus: 1 } } }).error));

console.log('\nthe tab');
check('Household Split is the tab read; the old Tracker isn’t', run('bgReadTracker_().grid.length') === TRACKER.length && /getSheetByName\(BG_TAB_\)/.test(BG) && !/getSheetByName\('Tracker'\)/.test(BG));
check('no other server file reads the old Tracker tab of the budget tracker', !/SAT_SHEET_ID[\s\S]{0,400}getSheetByName\('Tracker'\)/.test(WEB) && !/getSheetByName\('Tracker'\)/.test((() => { try { return read('Finance.js'); } catch (e) { return fs.readFileSync(path.join(REPO, 'Finance.js'), 'utf8'); } })()));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

function loadSettings_(c) {
  const fs_ = require('fs'), p_ = require('path');
  const repo = p_.join(__dirname, '..', '..'), at = p_.join(process.env.VERA_ROOT || repo, 'Settings.js');
  require('vm').runInContext(fs_.readFileSync(fs_.existsSync(at) ? at : p_.join(repo, 'Settings.js'), 'utf8'), c);
  return c;
}
