// Finances › Summary (FinSummary.js, issue #224) on invented figures: the planner's Outputs read by
// label, quarters, Needs attention (each source, soonest first, one source failing on its own),
// every Suggested-to-discuss rule (saved Budget scenarios included), what changed since the
// snapshot, actual vs expected spending, the quarterly snapshot (once a quarter, caught up when a
// run is missed), decisions carried forward, notes, and the check-in and decision reminders.
const fs = require('fs'), vm = require('vm'), path = require('path');
const { tracker } = require('./budget_fixture.js');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FS = read('FinSummary.js'), BG = read('Budget.js'), BS = read('BillSchedule.js'), WEB = read('WebApp.js'), CODE = read('Code.js');

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
const writes = [];
function fakeSheet(name, grid) {
  const sh = { getName: () => name, getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }), getLastRow: () => grid.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => ((grid[r - 1 + i] || [])[c - 1 + j]) ?? '')),
      setValues: v => { writes.push(name); v.forEach((row, i) => row.forEach((x, j) => { while (grid.length < r + i) grid.push([]); grid[r - 1 + i][c - 1 + j] = x; })); return sh; },
      setValue: x => { writes.push(name); grid[r - 1][c - 1] = x; return sh; },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; } }),
    appendRow: row => { writes.push(name); grid.push(row.slice()); }, deleteRow: r => { writes.push(name); grid.splice(r - 1, 1); }, setFrozenRows() {} };
  return sh;
}
const VERA = {};
let TODAY = '2026-11-02';
const S = {
  Utilities: { getUuid: () => 'abcdef12-3456-7890-' + String(++S.__u).padStart(4, '0'), formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? TODAY : TODAY.slice(0, 7) },
  Session: { getScriptTimeZone: () => 'UTC' }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, Logger: { log() {} },
  getSpreadsheet: () => ({ getSheetByName: n => VERA[n] ? fakeSheet(n, VERA[n]) : null, insertSheet: n => { VERA[n] = []; return fakeSheet(n, VERA[n]); } }),
  getConfigValues: () => ({}), __u: 0,
};
vm.createContext(S);
vm.runInContext(extractFn(CODE, 'ensureSheet'), S);
['tiSchema_', 'tiRows_', 'tiRowOf_', 'tiMintId_', 'tiNow_', 'tiLocked_'].forEach(n => vm.runInContext(extractFn(read('TripIdeas.js'), n), S));
vm.runInContext(BG, S); vm.runInContext(BS, S); vm.runInContext(FS, S);
const run = (expr, vars) => { Object.assign(S, vars || {}); return vm.runInContext(expr, S); };

console.log('\nthe planner’s Outputs, by label');
const OUT = [['PLANNER: outputs'], ['Our plan at a glance'], ['Item', 'Value', 'What it means'], ['Plan status', 'Green: holds even in a weak market', ''],
  ['Net worth', '800,000', 'Excludes home equity'], ['Cash and CDs', 90000, 'After credit card balances'], ['12-month cash low', '41,500', 'Jun 27; our floor is $20,000']];
let o = run('fsOutputs_(G)', { G: OUT });
check('net worth, plan status, cash and CDs', o.netWorth === 800000 && o.planStatus === 'Green: holds even in a weak market' && o.cash === 90000, J(o));
check('the cash low, with its date and the floor from its note', o.cashLow === 41500 && o.cashLowWhen === 'Jun 27' && o.floor === 20000);
check('rows moved: still found by label', run('fsOutputs_(G).cash', { G: [['x']].concat(OUT.slice().reverse()) }) === 90000);

console.log('\nquarters');
check('the quarter, the one before, and the next one’s first day', run('fsQuarter_("2026-11-02")') === '2026-Q4' && run('fsPrevQuarter_("2026-Q1")') === '2025-Q4'
  && run('fsNextQuarterStart_("2026-11-02")') === '2027-01-01' && run('fsNextQuarterStart_("2026-03-31")') === '2026-04-01' && J(run('fsQuarterMonths_("2026-Q3")')) === J(['2026-07', '2026-08', '2026-09']));

console.log('\nNeeds attention');
const SRC = {
  bills: { items: [{ line: 'Rent', amount: 2000, dueDay: 1, paid: true }, { line: 'Phone', amount: 40, dueDay: 5, paid: true }, { line: 'Internet', amount: 60, dueDay: 4, paid: false }, { line: 'Water', amount: 50, dueDay: 20, paid: false }, { line: 'Paycheck', amount: 3000, dueDay: 3, income: true }] },
  spend: { source: 'actual', categories: [{ name: 'Utilities', plan: 300, actual: 340 }, { name: 'Housing', plan: 2000, actual: 2000 }] },
  plans: { items: [{ item: 'New sofa', month: '2026-11', amount: 1200 }, { item: 'Ski trip', month: '2027-01', amount: 2500 }] },
  fsa: { items: [{ year: 2026, atRisk: 300, daysLeft: 59, useBy: '2026-12-31' }] },
  cds: { items: [{ name: 'CD A', matures: '2026-11-20' }, { name: 'CD B', matures: '2027-06-01' }] },
  cards: { items: [{ cardName: 'Gold Card', annualFee: 250, notes: 'annual fee in December', active: 'Yes' }, { cardName: 'Plain Card', annualFee: 0, notes: '' }] },
  returns: { items: [{ item: 'Lamp', returnBy: '2026-11-05' }, { item: 'Rug', returnBy: '2026-12-30' }] } };
let A = run('fsAttention_(X, "2026-11-02")', { X: SRC });
check('one list, soonest first', J(A.items.map(x => x.kind + ':' + x.date)) === J(['over:2026-11-02', 'bill:2026-11-04', 'return:2026-11-05', 'cd:2026-11-20', 'planned:2026-11-30', 'fee:2026-12-01', 'fsa:2026-12-31']), J(A.items.map(x => x.kind + ':' + x.date)));
check('bills due this week only, unpaid, never income', A.items.filter(x => x.kind === 'bill').map(x => x.title).join() === 'Internet $60' && /due in 2 days/.test(A.items.find(x => x.kind === 'bill').detail));
check('a category over budget, from actuals', A.items.some(x => x.kind === 'over' && /Utilities/.test(x.title) && /\$340 of \$300/.test(x.detail)));
check('…but not from expected figures', !run('fsAttention_(X, "2026-11-02")', { X: Object.assign({}, SRC, { spend: { source: 'expected', categories: [{ name: 'Utilities', plan: 300, actual: 340 }] } }) }).items.some(x => x.kind === 'over'));
check('each item says which tab', A.items.every(x => x.tab));
const failing = Object.assign({}, SRC, { cds: { error: 'the CDs tab is empty' } });
A = (() => { try { return run('fsAttention_(X, "2026-11-02")', { X: failing }); } catch (e) { return { items: [], unavailable: [] }; } })();
check('one source failing drops out, and says so; the rest still show', J(A.unavailable) === J(['cds']) && !A.items.some(x => x.kind === 'cd') && A.items.some(x => x.kind === 'bill') && A.items.length === 6);

console.log('\nSuggested to discuss');
const health = { fsa: [{ year: 2026, atRisk: 300, daysLeft: 59, useBy: '2026-12-31' }], hsa: { year: 2026, room: 1200, limit: 8550 } };
const goals = [{ name: 'Trips Fund', kind: 'yearly', years: [{ year: 2027, planned: 9000, left: -1000 }] }, { name: 'New Car', kind: 'one-off', status: 'active', month: '2027-01', target: 20000, saved: 5000 },
  { name: 'Boat', kind: 'one-off', status: 'active', month: '2029-01', target: 30000, saved: 0 }];
const decisions = [{ id: 'DEC-1', status: 'open', due: '2026-10-15', text: 'Call the bank', owner: 'Pat' }, { id: 'DEC-2', status: 'done', due: '2026-10-01', text: 'Old one' }];
const budget = { months: [
  { month: '2026-10', source: 'actual', categories: [{ name: 'Utilities', plan: 300, actual: 360 }, { name: 'Household', plan: 700, actual: 650 }] },
  { month: '2026-11', source: 'actual', categories: [{ name: 'Utilities', plan: 300, actual: 340 }, { name: 'Household', plan: 700, actual: 900 }] }] };
const base = { people: [{ key: 'pat', name: 'Pat', checking: 1690 }, { key: 'sam', name: 'Sam', checking: 650 }] };
const scen = [{ id: 'S1', name: 'Rent +$500', quarter: '2026-Q4', results: { pat: { checking: 1990 }, sam: { checking: 850 } } }, { id: 'S0', name: 'Old idea', quarter: '2026-Q3', results: {} }];
const D = run('fsDiscuss_(N, P, B, H, C, G, DD, SC, BA, "2026-11-02")', { N: { planStatus: 'Amber: thin in a weak market' }, P: { planStatus: 'Green: holds' }, B: budget, H: health,
  C: [{ name: 'CD A', matures: '2027-01-15' }, { name: 'CD B', matures: '2027-06-01' }], G: goals, DD: decisions, SC: scen, BA: base });
const ids = D.map(x => x.id);
check('a category over budget in 2+ months (and not one over once)', ids.includes('over:Utilities') && !ids.includes('over:Household'), J(ids));
check('FSA money at risk', D.some(x => x.id === 'fsa:2026' && /\$300 to use by 2026-12-31/.test(x.text)));
check('a CD maturing within 90 days, not later', ids.includes('cd:CD A') && !ids.includes('cd:CD B'));
check('next year’s trips over their budget', D.some(x => x.id === 'travel:2027' && /2027 trips are \$1,000 over the Trips Fund budget/.test(x.text)));
check('HSA room left', D.some(x => x.id === 'hsa:2026' && /\$1,200 of room/.test(x.text)));
check('a goal behind (due soon, short), not one years off', D.some(x => x.id === 'goal:New Car' && /\$15,000 short/.test(x.text)) && !ids.includes('goal:Boat'));
check('an open decision past its due date, not a done one', ids.includes('decision:DEC-1') && !ids.includes('decision:DEC-2'));
check('a scenario saved this quarter, with what it changes for each of us', D.some(x => x.id === 'scenario:S1' && x.text === 'Rent +$500: Pat +$300, Sam +$200') && !ids.includes('scenario:S0'), J(D.filter(x => /scenario/.test(x.id))));
check('the plan status moving', ids.includes('plan'));

console.log('\nwhat changed, and spending');
const ch = run('fsChanges_(N, P)', { N: { netWorth: 820000, cash: 85000, goalsSetAside: 40000, hsaBalance: 9000, fsaLeft: 300, planStatus: 'Green' }, P: { netWorth: 800000, cash: 90000, goalsSetAside: 35000, hsaBalance: null, fsaLeft: 900, planStatus: 'Green' } });
check('deltas against the snapshot, none where it has no figure', J(ch.map(c => c.key + ':' + c.delta)) === J(['netWorth:20000', 'cash:-5000', 'goalsSetAside:5000', 'hsaBalance:null', 'fsaLeft:-600', 'planStatus:null']));
const C = run('budgetCompute_(budgetModel_(G), {}, {})', { G: tracker() }); S.C = C; S.L = run('bsBills_(C, {})');
let sp = run('fsSpending_(C, L, [], ["2026-11"], {})');
check('no uploads for the month: expected, the plan', sp.source === 'expected' && sp.total.actual === null && sp.categories.find(c => c.name === 'Housing').plan === 2000);
sp = run('fsSpending_(C, L, T, ["2026-10", "2026-11"], {})', { T: [{ month: '2026-10', description: 'ACME RENT', amount: -2000 }, { month: '2026-11', description: 'ACME RENT', amount: -2100 }, { month: '2026-11', description: 'CITY ELECTRIC', amount: -95 }] });
check('with uploads: actual, by category, plan for the months', sp.source === 'actual' && sp.categories.find(c => c.name === 'Housing').actual === 4100 && sp.categories.find(c => c.name === 'Housing').plan === 4000
  && sp.categories.find(c => c.name === 'Utilities').actual === 95 && sp.categories.find(c => c.name === 'Health').actual === 0, J(sp.categories));

console.log('\nthe quarterly snapshot');
const FAKE = { today: '2026-10-05', quarter: '2026-Q4', planner: { netWorth: 800000, cash: 90000, planStatus: 'Green' }, goals: { summary: { setAside: 35000 } },
  health: { fsa: [{ year: 2026, balance: 900 }], hsa: { balance: 8000 } }, budget: { error: 'no tracker' }, aliases: {} };
S.FAKE = FAKE;
let t = run('fsTakeSnapshot_(FAKE)');
check('taken when the quarter has none (a missed 1st is caught up by the next run)', t.taken === true && VERA['Finance Snapshots'].length === 2 && VERA['Finance Snapshots'][1][0] === '2026-Q4' && VERA['Finance Snapshots'][1][2] === 800000, J(VERA['Finance Snapshots']));
check('…once: a second run the same quarter adds nothing', run('fsTakeSnapshot_(FAKE)').taken === false && VERA['Finance Snapshots'].length === 2);
FAKE.quarter = '2027-Q1'; FAKE.today = '2027-01-01';
check('the next quarter gets its own', run('fsTakeSnapshot_(FAKE)').taken === true && VERA['Finance Snapshots'].length === 3);
check('the headers', J(VERA['Finance Snapshots'][0]) === J(['Quarter', 'Taken', 'Net Worth', 'Cash & CDs', 'Goals Set Aside', 'HSA Balance', 'FSA Left', 'Plan Status', 'Spending JSON', 'Source']));
const sn = run('fsSnapshotFrom_(R)', { R: VERA['Finance Snapshots'][1] });
check('a snapshot reads back', sn.quarter === '2026-Q4' && sn.netWorth === 800000 && sn.hsaBalance === 8000 && sn.fsaLeft === 900 && sn.goalsSetAside === 35000);

console.log('\ndecisions and notes');
TODAY = '2026-11-02';
let r = run('webSaveCheckinDecision_({ text: "Raise the grocery line", owner: "victoria", due: "2026-12-01", topic: "over:Household" })');
check('a decision is saved for this quarter, open', r.ok && r.decision.quarter === '2026-Q4' && r.decision.owner === 'Victoria' && r.decision.status === 'open' && r.decision.topic === 'over:Household', J(r));
const id = r.decision.id;
check('“next check-in” is the next quarter’s first day', run('webSaveCheckinDecision_({ text: "Review CDs", due: "next check-in" })').decision.due === '2027-01-01');
check('no text, or a bad date, is refused', run('webSaveCheckinDecision_({ text: " " })').ok === false && run('webSaveCheckinDecision_({ text: "x", due: "soon" })').ok === false);
check('an edit keeps it in its quarter', run('webSaveCheckinDecision_({ id: ID, text: "Raise the grocery line to $800", owner: "Both", due: "2026-12-01" })', { ID: id }).decision.text === 'Raise the grocery line to $800');
r = run('webToggleCheckinDecision_({ id: ID })', { ID: id });
check('ticked done, with the day', r.ok && r.decision.status === 'done' && r.decision.doneOn === '2026-11-02');
check('…and back', run('webToggleCheckinDecision_({ id: ID })', { ID: id }).decision.status === 'open');
const old = [{ id: 'a', quarter: '2026-Q3', status: 'open', due: '2026-09-30', created: '1' }, { id: 'b', quarter: '2026-Q3', status: 'done', due: '', created: '2' },
  { id: 'c', quarter: '2026-Q4', status: 'done', due: '', created: '3' }, { id: 'd', quarter: '2026-Q4', status: 'open', due: '2026-12-01', created: '4' }];
check('carried forward: last quarter’s open ones and this quarter’s, open first', J(run('fsCarried_(X, "2026-Q4")', { X: old }).map(d => d.id)) === J(['a', 'd', 'c']));
run('webSaveCheckinNotes_({ notes: "Talked about the car." })'); run('webSaveCheckinNotes_({ notes: "Talked about the car and the CD." })');
check('notes: one row per quarter', VERA['Check-in Notes'].length === 2 && VERA['Check-in Notes'][1][0] === '2026-Q4' && /and the CD/.test(VERA['Check-in Notes'][1][1]));

console.log('\nreminders');
let rem = run('fsRemindersDue_("2026-12-25", 7, X, [])', { X: [{ text: 'FSA $300 to use' }] });
check('the check-in reminder N days before the quarter, with the discuss list', rem.length === 1 && rem[0].notif === 'quarterly_checkin' && /2027-Q1/.test(rem[0].subject) && /• FSA \$300 to use/.test(rem[0].message), J(rem));
check('…not on other days', run('fsRemindersDue_("2026-12-24", 7, [], [])').length === 0);
rem = run('fsRemindersDue_("2026-11-28", 7, [], X)', { X: [{ id: 'D1', status: 'open', due: '2026-12-01', text: 'Call the bank', owner: 'Victoria' }, { id: 'D2', status: 'done', due: '2026-12-01', text: 'x' }] });
check('a decision 3 days before its due date, to its owner', rem.length === 1 && /Victoria: “Call the bank” is due in 3 days/.test(rem[0].message));
check('…and on the day', run('fsRemindersDue_("2026-12-01", 7, [], X)', { X: [{ id: 'D1', status: 'open', due: '2026-12-01', text: 'Call the bank', owner: 'Victoria' }] }).length === 1);
check('the notification is registered', /key: 'quarterly_checkin',/.test(CODE));
check('the nightly run takes the snapshot and sends the reminders', /nightlyStep_\(ctx, 'fsNightly_', fsNightly_\)/.test(CODE));
check('the routes are wired', /case 'checkin':\s+return jsonOut_\(webGetCheckin_\(\)\)/.test(WEB) && /case 'checkin_decision_save':\s+return jsonOut_\(webSaveCheckinDecision_\(body\)\)/.test(WEB)
  && /case 'checkin_decision_toggle':\s+return jsonOut_\(webToggleCheckinDecision_\(body\)\)/.test(WEB) && /case 'checkin_notes_save':\s+return jsonOut_\(webSaveCheckinNotes_\(body\)\)/.test(WEB));
check('the planner and the tracker are never written', !writes.some(w => !/^(Finance Snapshots|Check-in Decisions|Check-in Notes)$/.test(w)), J(writes));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
