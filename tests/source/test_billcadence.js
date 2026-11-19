// How often a bill is due (BillSchedule.js): Monthly, Every 2 weeks, Quarterly, Twice a year,
// Yearly. The tracker holds each payment's amount; VERA works out which months a bill is due, the
// monthly share, a tick per payment for a bill every 2 weeks, and every reader that means "due this
// month" skips a bill that isn't. Then the editor and both bill lists in the real pages, at phone
// and desktop width. Every name, date and figure is invented.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { tracker } = require('./budget_fixture.js');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
// A control's sandbox holds only the root .js files; docs/ comes from the repo (no control changes it).
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const BS = read('BillSchedule.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html'), WEB = read('WebApp.js'), NOTIFY = read('Notify.js'), REM = read('Reminders.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify, wait = ms => new Promise(r => setTimeout(r, ms));
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const E = vm.createContext({});
vm.runInContext(APP.slice(APP.indexOf('// ---- BudgetEngine'), APP.indexOf('// ---- /BudgetEngine ----')), E);
vm.runInContext(BS.slice(BS.indexOf('var BS_TAB_'), BS.indexOf('// ---- reading and writing')), E);
['bsWhen_', 'bsRowDue_', 'bsTogglePaidDate_', 'bsSetPaid_', 'webSaveBillSchedule_'].forEach(n => vm.runInContext(extractFn(BS, n), E));
vm.runInContext(extractFn(NOTIFY, 'eveningUnpaid_'), E);
const due = (o, m) => J(E.bsDueDates_(o, m));

console.log('How often, in any words');
check('the five, and the ways people write them', ['', 'Monthly', 'bi-weekly', 'Every 2 weeks', 'fortnightly', 'Quarterly', 'Twice a year', 'semi-annual', 'Yearly', 'Annual', 'whenever']
  .map(E.bsCadence_).join() === 'monthly,monthly,biweekly,biweekly,biweekly,quarterly,semiannual,semiannual,annual,annual,monthly');

console.log('\nWhen it’s due');
const Q = { cadence: 'quarterly', starts: '2026-03', dueDay: 15 };
check('quarterly from March: due in Mar, Jun, Sep, Dec only', ['2026-03', '2026-04', '2026-06', '2026-09', '2026-12', '2027-03', '2026-02'].map(m => E.bsDueDates_(Q, m).length).join() === '1,0,1,1,1,1,0');
check('twice a year from May: May and November', due({ cadence: 'semiannual', starts: '2026-05', dueDay: 10 }, '2026-11') === '["2026-11-10"]' && due({ cadence: 'semiannual', starts: '2026-05', dueDay: 10 }, '2026-08') === '[]');
check('yearly: its one month', due({ cadence: 'annual', starts: '2026-04', dueDay: 1 }, '2027-04') === '["2027-04-01"]' && due({ cadence: 'annual', starts: '2026-04', dueDay: 1 }, '2026-10') === '[]');
check('every 2 weeks from Nov 6: Nov 6 and 20, then Dec 4 and 18 (and back into October)', due({ cadence: 'biweekly', starts: '2026-11-06' }, '2026-11') === '["2026-11-06","2026-11-20"]'
  && due({ cadence: 'biweekly', starts: '2026-11-06' }, '2026-12') === '["2026-12-04","2026-12-18"]' && due({ cadence: 'biweekly', starts: '2026-11-06' }, '2026-10') === '["2026-10-09","2026-10-23"]');
check('every 2 weeks: a month with three', E.bsDueDates_({ cadence: 'biweekly', starts: '2026-01-02' }, '2026-01').length === 3);
check('the 31st falls on the month’s last day', due({ dueDay: 31 }, '2027-02') === '["2027-02-28"]' && due({ dueDay: 31 }, '2028-02') === '["2028-02-29"]');
check('a longer cadence with no start month, or every 2 weeks with no date, isn’t placed', due({ cadence: 'quarterly', dueDay: 5 }, '2026-11') === '[]' && due({ cadence: 'biweekly' }, '2026-11') === '[]');
check('the next due date', E.bsNextDue_({ cadence: 'semiannual', starts: '2026-05', dueDay: 10 }, '2026-11-19') === '2027-05-10' && E.bsNextDue_({ dueDay: 25 }, '2026-11-19') === '2026-11-25' && E.bsNextDue_({ cadence: 'biweekly', starts: '2026-11-06' }, '2026-11-21') === '2026-12-04');
check('the monthly share of each payment', [['monthly', 120], ['biweekly', 120], ['quarterly', 600], ['semiannual', 600], ['annual', 1200]].map(x => E.bsMonthlyShare_(x[1], x[0])).join() === '120,260,200,100,100');

console.log('\nThe bills list and Joint through the month');
E.G = tracker();
E.C = vm.runInContext('budgetCompute_(budgetModel_(G), {}, {})', E);
E.SCHED = vm.runInContext(`bsScheduleMap_([
  ['Internet', 9, '', false, '', 'bill', '', '', 'Quarterly', '2026-12'],
  ['Utilities - Electric', '', '', false, '', 'bill', '', '2026-11-06', 'Bi-weekly', '2026-11-06'],
  ['Rent', 1, '', false, '', 'bill', '', '']])`, E);
const L = vm.runInContext('bsBills_(C, SCHED, { month: "2026-11", today: "2026-11-19" })', E); E.LIST = L;
const b = n => L.bills.find(x => x.line === n) || {};
check('each bill says how often, and whether it’s due this month', b('Rent').cadence === 'monthly' && b('Rent').dueThisMonth === true && b('Internet').cadence === 'quarterly' && b('Internet').dueThisMonth === false && b('Internet').next === '2026-12-09', J([b('Internet').cadence, b('Internet').dueThisMonth, b('Internet').next]));
check('every 2 weeks: both dates this month, and which are paid', J(b('Utilities - Electric').dueDates) === '["2026-11-06","2026-11-20"]' && J(b('Utilities - Electric').paidDates) === '["2026-11-06"]');
check('the monthly share: a quarterly bill a third, every 2 weeks 26/12', b('Internet').monthlyShare === Math.round(b('Internet').amount / 3 * 100) / 100 && b('Utilities - Electric').monthlyShare === Math.round(b('Utilities - Electric').amount * 26 / 12 * 100) / 100);
const expectDue = L.bills.reduce((s, x) => s + (x.dueThisMonth ? (x.amount || 0) * Math.max(1, x.dueDates.length) : 0), 0);
check('due this month leaves out the quarterly bill and counts both electric payments', L.total === Math.round(expectDue * 100) / 100 && L.total !== L.bills.reduce((s, x) => s + (x.amount || 0), 0), J([L.total, expectDue]));
check('…and the monthly share is every bill spread over the year', L.monthlyShare === Math.round(L.bills.reduce((s, x) => s + (x.monthlyShare || 0), 0) * 100) / 100);
const T = vm.runInContext('bsTimeline_(LIST, C, { transferDay: 1 })', E);
const outs = n => T.events.filter(e => e.kind === 'out' && e.what === n).map(e => e.day);
check('Joint through the month: the quarterly bill isn’t out this month', outs('Internet').length === 0 || !/joint/i.test(b('Internet').account), J(T.events.map(e => e.what + '@' + e.day)));
check('…and a bill every 2 weeks is out on each date', !/joint/i.test(b('Utilities - Electric').account) || J(outs('Utilities - Electric')) === '[6,20]', J(outs('Utilities - Electric')));
const L0 = vm.runInContext('bsBills_(C, SCHED)', E);
check('with no month given, everything counts as before (other callers)', L0.bills.every(x => x.dueThisMonth === true));

console.log('\nPaid, a tick per payment every 2 weeks');
check('ticking a date adds it; again removes it', E.bsTogglePaidDate_('2026-11-06', '2026-11-20', null, '2026-11-21').cell === '2026-11-06,2026-11-20' && E.bsTogglePaidDate_('2026-11-06,2026-11-20', '2026-11-20', null, '2026-11-21').cell === '2026-11-06');
check('dates older than 60 days drop off', E.bsTogglePaidDate_('2026-08-01,2026-11-06', '2026-11-20', true, '2026-11-21').cell === '2026-11-06,2026-11-20');
check('paid this month: only when every date this month is ticked', E.bsPaidFor_({ cadence: 'biweekly', starts: '2026-11-06', paid: '2026-11-06' }, '2026-11') === false && E.bsPaidFor_({ cadence: 'biweekly', starts: '2026-11-06', paid: '2026-11-06,2026-11-20' }, '2026-11') === true && E.bsPaidFor_({ paid: '2026-11' }, '2026-11') === true);
{ // the real bsSetPaid_ on a fake Bill Schedule
  const rows = [['Utilities - Electric', '', '', false, '', 'bill', '', '2026-11-06', 'Bi-weekly', '2026-11-06'], ['Rent', 1, '', false, '', 'bill', '', '', '', '']];
  const writes = [];
  Object.assign(E, { tiLocked_: f => f(), bsSheet_: () => ({ getRange: (r, c) => ({ setValue: v => { writes.push([r, c, v]); rows[r - 2][c - 1] = v; } }), appendRow: () => {} }),
    tiRows_: () => rows, Utilities: { formatDate: () => '2026-11-21' }, Session: { getScriptTimeZone: () => 'UTC' } });
  const on = E.bsSetPaid_('Utilities - Electric', '2026-11', null, undefined, '2026-11-20');
  check('a payment date ticks just that date', on === true && rows[0][7] === '2026-11-06,2026-11-20', J(writes));
  E.bsSetPaid_('Rent', '2026-11', null);
  check('a monthly bill still stores the month', rows[1][7] === '2026-11');
}

console.log('\nSaving how often');
{
  const rows = [['Internet', 9, '', false, '', 'bill', '', '2026-11', '', '']], saved = [];
  Object.assign(E, { tiRows_: () => rows, bsSheet_: () => ({ appendRow: r => saved.push(r), getRange: () => ({ setValues: v => saved.push(v[0]) }) }) });
  check('quarterly without a month is refused', E.webSaveBillSchedule_({ line: 'Internet', dueDay: 9, cadence: 'quarterly' }).error === 'Pick when it’s next due.');
  check('every 2 weeks without a date is refused', E.webSaveBillSchedule_({ line: 'Internet', cadence: 'biweekly', starts: '2026-11' }).error === 'Pick a date you paid it.');
  const r = E.webSaveBillSchedule_({ line: 'Internet', dueDay: 9, cadence: 'quarterly', starts: '2026-12-01' });
  check('quarterly from December is saved as its label and month, keeping Paid', r.ok && J(saved[0].slice(7)) === J(['2026-11', 'Quarterly', '2026-12']), J(saved[0]));
  saved.length = 0; E.webSaveBillSchedule_({ line: 'Internet', cadence: 'biweekly', starts: '2026-11-06' });
  check('switching to every 2 weeks clears a month-style Paid', saved[0][7] === '' && saved[0][8] === 'Bi-weekly' && saved[0][9] === '2026-11-06', J(saved[0]));
  saved.length = 0; E.webSaveBillSchedule_({ line: 'Internet', dueDay: 9 });
  check('monthly leaves Cadence and Starts blank (existing rows unchanged)', saved[0][8] === '' && saved[0][9] === '', J(saved[0]));
}

console.log('\nEvery reader that means “due this month”');
const fresh = (cad, dates, paid, paidDates) => ['Internet', 60, 9, cad, 'Utilities', 'Joint', paid || '', '', 'Expense', 'Internet', dates, paidDates || '', ''];
check('a bill not due this month isn’t due', E.bsRowDue_(fresh('Quarterly', ''), '2026-11', 19).due === false);
check('every 2 weeks: the next date on or after today, and whether that one is paid', J((d => [d.day, d.paid])(E.bsRowDue_(fresh('Bi-weekly', '2026-11-06,2026-11-20', '', '2026-11-06'), '2026-11', 19))) === '[20,false]'
  && E.bsRowDue_(fresh('Bi-weekly', '2026-11-06,2026-11-20', '', '2026-11-06'), '2026-11', 3).paid === true);
check('an old sheet row (10 columns) is due on its due day, as before', J((d => [d.due, d.day])(E.bsRowDue_(['Gym', 40, 12, 'Monthly', '', '', '', '', 'Expense', ''], '2026-11', 1))) === '[true,12]');
check('the evening check-in names only bills due today or tomorrow and unpaid', J(E.eveningUnpaid_([fresh('Bi-weekly', '2026-11-06,2026-11-20', '', '2026-11-06'), fresh('Quarterly', '')], 20, 21, '2026-11')) === '["internet"]'
  && J(E.eveningUnpaid_([fresh('Quarterly', '')], 9, 10, '2026-11')) === '[]');
check('the bill nudge skips a bill not due, and uses the next date', /var rd = bsRowDue_\(row, currMonth, dayOfMonth\);\n\s+if \(!rd\.due\) return;\n\s+dueDay = rd\.day; paid = rd\.paid;/.test(REM));
check('cashflow puts a bill on this month’s due dates', /if \(type !== 'Income' && row\.length > 10\) \{\n\s+days = String\(row\[10\] \|\| ''\)\.split/.test(extractFn(WEB, 'webGetCashflow_')));
check('the bills route sends the due dates, paid dates and next', /dueDates: String\(r\[10\] \|\| ''\)\.split\(','\)\.filter\(Boolean\), paidDates: String\(r\[11\] \|\| ''\)/.test(extractFn(WEB, 'webGetBills_')));
check('the paid toggle takes a payment date', /bsSetPaid_\(lineP, monT, null, undefined, \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(dateT\) \? dateT : undefined\)/.test(extractFn(WEB, 'webToggleBill_')));
check('the morning email’s bills-due list skips a bill not due, and uses the next date', /var rdM = bsRowDue_\(r, currMonth, dayOfMon\); if \(!rdM\.due\) return; dueDay = rdM\.day; paid = rdM\.paid;/.test(read('Co' + 'de.js')));
check('Claude’s bill context says whether a bill is due this month, and when next', /dueThisMonth: r\.length <= 10 \|\| String\(r\[10\] \|\| ''\) !== '',\n\s+nextDue:/.test(read('Claude.js')));
check('Accounts’ “keep at least” gets the real cadence (Frequency column)', /b\.cadenceLabel, b\.category/.test(extractFn(BS, 'bsBillRows_')));

console.log('\nThe same blocks in both dashboards');
const blk = (src, a, z) => src.slice(src.indexOf(a), src.indexOf(z, src.indexOf(a)));
check('the cadence helpers and Bills & cashflow are identical in both', blk(APP, 'var BS_CADENCE_OPTS_', 'function BillsCashflowTab(') === blk(LITE, 'var BS_CADENCE_OPTS_', 'function BillsCashflowTab(') && APP.indexOf('var BS_CADENCE_OPTS_') !== -1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
