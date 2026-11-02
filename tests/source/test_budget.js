// Finances › Budget (Budget.js and the BudgetEngine block it shares with both dashboards,
// issue #226): the tracker read by label, every formula in the map, net income from
// gross − deductions, the own-card transfers, required leaving out credits, categories
// summing to the total with an unmapped line under Other, the match check naming the
// expected difference and catching a moved row, What if overrides, scenarios saved to
// VERA's own sheet, and the tracker never written. Every name and figure is invented.
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
      setValue: x => { if (tracked) writes.push(name); grid[r - 1][c - 1] = x; return sh; },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; } }),
    appendRow: row => { if (tracked) writes.push(name); grid.push(row.slice()); },
    deleteRow: r => { if (tracked) writes.push(name); grid.splice(r - 1, 1); },
    setFrozenRows() {} };
  return sh;
}
let TRACKER = tracker();
const trackerSs = () => ({ getSheetByName: n => n === 'Tracker' ? fakeSheet('Tracker', TRACKER, true) : null, getSheets: () => [fakeSheet('Tracker', TRACKER, true)] });
const VERA = {}, CONFIG = {};
const veraSs = { getSheetByName: n => VERA[n] ? fakeSheet(n, VERA[n], false) : null, insertSheet: n => { VERA[n] = []; return fakeSheet(n, VERA[n], false); } };
let uid = 0;
const S = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => k === 'SAT_SHEET_ID' ? 'sat-test' : null }) },
  SpreadsheetApp: { openById: id => { if (id !== 'sat-test') throw new Error('no such sheet'); return trackerSs(); } },
  Utilities: { getUuid: () => 'abcdef12-3456-7890-' + String(++uid).padStart(4, '0') },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Logger: { log() {} },
  getSpreadsheet: () => veraSs, getConfigValues: () => CONFIG,
};
vm.createContext(S);
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

console.log('\nreading the tracker by label');
let m = run('budgetModel_(G)', { G: tracker() });
check('it reads', m.ok === true && m.missing.length === 0, J(m.missing || m.error));
check('the two people come from the heading row', m.people.map(p => p.key + '/' + p.name).join() === 'pat/Pat,sam/Sam');
check('gross, deductions (a blank one as 0) and the typed net', m.people[0].gross === 10000 && m.people[0].deductions.map(x => x.amount).join() === '1000,1500,500'
  && m.people[1].deductions.map(x => x.name + '=' + x.amount).join() === '401K Deductions=500,Federal Withholding=900,Federal MED/EE=0' && m.people[0].netTyped === 7200, J(m.people[1].deductions));
check('fixed and nice to have, per person', m.people[0].fixed.map(x => x.name).join() === 'Car Insurance - Pat,Phone - Pat' && m.people[0].nice.map(x => x.amount).join() === '40,10'
  && m.people[1].fixed.length === 1 && m.people[1].nice[0].name === 'Books');
check('shared lines: name without the due day, account, due day', J(m.shared.fixed[0]) === J({ key: 'shared.fixed:Rent', name: 'Rent', amount: 2000, account: 'Joint', dueDay: 1 })
  && m.shared.fixed.length === 7 && m.shared.nice.length === 3, J(m.shared.fixed[0]));
check('the tracker’s What If rows are kept apart', m.shared.whatif.length === 1 && m.shared.whatif[0].name === 'New Rent Delta');
check('split from the first person’s contribution %, shared savings from its total', m.split === 0.6 && m.sharedSavings === 1000);
check('the tracker’s own summary figures', m.tracker.totalShared === 3150 && m.tracker.required === 3050 && m.tracker.checking.pat === 1690 && m.tracker.ownCards.sam === 610 && m.tracker.totalDisposable === 6850, J(m.tracker));
check('a moved column still reads (labels, not positions)', (() => { const g = tracker().map(r => [''].concat(r)); const mm = run('budgetModel_(G)', { G: g }); return mm.ok && mm.shared.fixed.length === 7 && mm.people[0].gross === 10000; })());
check('no Shared Expenses heading: unavailable, with why', (() => { const mm = run('budgetModel_(G)', { G: [['a', 'b'], ['c']] }); return mm.ok === false && /Shared Expenses/.test(mm.error); })());
check('a missing split is listed, not guessed silently', (() => { const mm = run('budgetModel_(G)', { G: tracker({ pctLabel: 'Pat contribution' }) }); return mm.missing.some(x => /Contribution %/.test(x)); })());
check('a split typed as a number reads as a share', run('budgetModel_(G).split', { G: tracker({ split: 60 }) }) === 0.6);

console.log('\nthe formula map');
let c = run('budgetCompute_(budgetModel_(G), {}, {})', { G: tracker() });
const pat = c.people[0], sam = c.people[1];
check('shared total = every shared line, What If rows left out', c.shared.total === 3150, c.shared.total);
check('required = the fixed lines, the credit left out', c.shared.required === 3050, c.shared.required);
check('contribution = total × share (60/40)', pat.contribution === 1890 && sam.contribution === 1260);
check('own cards = the shared lines on that person’s account', pat.ownCards === 200 && sam.ownCards === 610, pat.ownCards + ' ' + sam.ownCards);
check('→ AMEX Checking = contribution − own cards', pat.checking === 1690 && sam.checking === 650);
check('→ AMEX Savings = shared savings × share', pat.savings === 600 && sam.savings === 400);
check('net income = gross − deductions, for both', pat.net === 7000 && sam.net === 4600, pat.net);
check('net expenses = fixed + nice + personal savings + contribution + shared savings', pat.netExpenses === 2990 && sam.netExpenses === 1960, pat.netExpenses + ' ' + sam.netExpenses);
check('disposable = net income − net expenses', pat.disposable === 4010 && sam.disposable === 2640);
check('groups: fixed, nice to have, contributions', pat.fixedTotal === 150 && pat.niceTotal === 50 && pat.contributions === 2790);
check('emergency fund: required × 3 / 6 / 9, by share and half each', J(c.emergency.map(e => [e.months, e.total, e.byShare.map(s => s.amount).join('/'), e.half])) === J([[3, 9150, '5490/3660', 4575], [6, 18300, '10980/7320', 9150], [9, 27450, '16470/10980', 13725]]), J(c.emergency));
check('totals across both people', c.totalNet === 11600 && c.totalDisposable === 6650);

console.log('\ncategories');
const cats = c.shared.categories;
check('the shared lines grouped, in order, with Other last', cats.map(x => x.name + '=' + x.total).join(' | ') === 'Housing=2000 | Utilities=300 | Health=100 | Household=700 | Insurance & subscriptions=10 | Other=40', cats.map(x => x.name + '=' + x.total).join(' | '));
check('categories sum to the shared total', Math.abs(cats.reduce((s, x) => s + x.total, 0) - c.shared.total) < 0.005);
check('each category keeps its account mix', J(cats.find(x => x.name === 'Household').accounts) === J({ Sam: 600, Pat: 100 }));
check('an unmapped line lands in Other, and is named', J(c.shared.other) === J(['Dog Walker']));
check('a Config mapping places it', run('budgetCompute_(budgetModel_(G), {}, { "dog walker": "Household" })', { G: tracker() }).shared.categories.find(x => x.name === 'Household').total === 740);

console.log('\nthe match check');
let mt = run('budgetMatch_(M, budgetCompute_(M, {}, {}))', { M: run('budgetModel_(G)', { G: tracker() }) });
const bad = mt.filter(r => !r.ok);
check('everything matches but the typed net income and what follows it', bad.map(r => r.id).join() === 'pat.net,pat.disposable,totalNet,totalDisposable', bad.map(r => r.id).join());
check('…the net income difference is named', /gross − deductions; the tracker types it/.test(bad[0].because) && bad[0].diff === -200 && bad[0].tracker === 7200);
check('…and the ones that follow from it say so', bad.slice(1).every(r => r.because === 'follows net income'), J(bad.map(r => r.because)));
check('a moved row shows as a difference, unexplained', (() => {
  const g = tracker(); const r = g.findIndex(x => x[4] === 'Utilities - Electric (15th)'); g[r][4] = ''; g[r][5] = '';   // the electric row went missing
  const mm = run('budgetModel_(G)', { G: g }); const rows = run('budgetMatch_(M, budgetCompute_(M, {}, {}))', { M: mm });
  const t = rows.find(x => x.id === 'totalShared'); return t && !t.ok && t.diff === -90 && t.because === ''; })());
check('a rounding cent is not a difference', (() => { const g = tracker(); g.find(x => x[4] === 'Total Shared Expenses')[5] = '$3,150.01';
  return run('budgetMatch_(M, budgetCompute_(M, {}, {}))', { M: run('budgetModel_(G)', { G: g }) }).find(x => x.id === 'totalShared').ok; })());

console.log('\nWhat if');
const M0 = run('budgetModel_(G)', { G: tracker() });
let w = run('budgetCompute_(M, { "shared.fixed:Rent": 2500 }, {})', { M: M0 });
check('a shared line changed: total, contributions and transfers rerun', w.shared.total === 3650 && w.people[0].checking === 1990 && w.people[1].checking === 850 && w.shared.required === 3550);
w = run('budgetCompute_(M, { split: 0.5 }, {})', { M: M0 });
check('the split changed', w.people[0].contribution === 1575 && w.people[1].savings === 500);
w = run('budgetCompute_(M, { "pat.gross": 11000, "pat.ded:Federal Withholding": 1700 }, {})', { M: M0 });
check('gross and a deduction changed: net and disposable', w.people[0].net === 7800 && w.people[0].disposable === 4810);
w = run('budgetCompute_(M, { "pat.psave": "", "shared.savings": "abc" }, {})', { M: M0 });
check('an empty or bad input falls back to the plan', w.people[0].psave === 300 && w.shared.savings === 1000);
check('the model itself is untouched', M0.shared.fixed[0].amount === 2000 && M0.split === 0.6);

console.log('\nthe phone plan, from its own tracker');
const MP = run('bgWithPhone_(budgetModel_(G), { ok: true, month: "2026-11", total: 180, credit: 40, ours: 140, dueDay: 12 })', { G: tracker() });
const fp = MP.shared.fixed.find(x => x.name === 'Family Plan Payment'), fc = MP.shared.fixed.find(x => x.name === 'Family Plan Credit');
check('the plan’s total and money back replace the two family plan lines, keeping the tracker’s', fp.amount === 180 && fp.trackerAmount === 200 && fc.amount === -40 && fc.trackerAmount === -50 && MP.phone.ours === 140, J([fp, fc]));
S.MP = MP;
const cp = run('budgetCompute_(MP, {}, {})'), cr = run('budgetCompute_(MP, {}, {}, true)');
check('the sums use the phone plan; raw uses the tracker’s figures', cp.shared.total === 3150 - 20 + 10 && cr.shared.total === 3150, cp.shared.total + ' ' + cr.shared.total);
check('required still leaves the money back out', cp.shared.required === 3050 - 20);
const mm = run('budgetMatch_(MP, budgetCompute_(MP, {}, {}), budgetCompute_(MP, {}, {}, true))');
const ts = mm.find(r => r.id === 'totalShared'), pd = mm.find(r => r.id === 'pat.disposable');
check('the match check names the phone plan as the cause', !ts.ok && ts.diff === -10 && ts.because === 'the phone plan, from the phone tracker', J(ts));
check('…and both causes when net income differs too', pd.because === 'follows net income, and the phone plan', J(pd));
check('no plan, or a plan that didn’t read: the model is untouched', run('bgWithPhone_(budgetModel_(G), null).phone', { G: tracker() }) === undefined && run('bgWithPhone_(budgetModel_(G), { ok: false }).shared.fixed.find(x => x.name === "Family Plan Payment").amount', { G: tracker() }) === 200);

console.log('\nthe server');
TRACKER = tracker(); writes.length = 0;
let r = run('webGetBudgetModel_()');
check('budget_model: model, computed, match and quarter', r.ok && r.configured && r.model.people.length === 2 && r.computed.shared.total === 3150 && r.match.length > 10 && /^\d{4}-Q[1-4]$/.test(r.quarter), J(Object.keys(r)));
CONFIG['budget_category:Dog Walker'] = 'Household'; S._configCache_ = null;
r = run('webGetBudgetModel_()');
check('Config budget_category:<line> rows are the map', r.categoryMap['dog walker'] === 'Household' && r.computed.shared.other.length === 0);
delete CONFIG['budget_category:Dog Walker'];
r = run('webSaveBudgetScenario_({ name: "  Bigger flat ", changes: { "shared.fixed:Rent": 2500, "nope": 5, split: 7, "pat.gross": "x" } })');
check('a scenario saves the known changes only, with results worked out on the server', r.ok && J(r.scenario.changes) === J({ 'shared.fixed:Rent': 2500, split: 1 }) && r.scenario.name === 'Bigger flat'
  && r.scenario.results.totalShared === 3650 && r.scenario.results.pat.checking === 3650 - 200, J(r.scenario));
check('…to VERA’s Budget Scenarios tab', VERA['Budget Scenarios'] && J(VERA['Budget Scenarios'][0]) === J(['ID', 'Name', 'Changes JSON', 'Results JSON', 'Created', 'Quarter']) && VERA['Budget Scenarios'].length === 2);
check('nothing changed: refused', /Nothing is changed/.test(run('webSaveBudgetScenario_({ name: "x", changes: { nope: 1 } })').error));
check('no name: refused', run('webSaveBudgetScenario_({ name: " ", changes: { split: 0.5 } })').ok === false);
const id = r.scenario.id;
check('the list reads it back', run('webGetBudgetModel_()').scenarios.map(s => s.id + ':' + s.changes['shared.fixed:Rent']).join() === id + ':2500');
check('delete removes it', run('webDeleteBudgetScenario_({ id: ID })', { ID: id }).ok && run('webGetBudgetModel_()').scenarios.length === 0);
check('a gone one says so', run('webDeleteBudgetScenario_({ id: ID })', { ID: id }).ok === false);
check('the tracker was never written', writes.length === 0, J(writes));
check('Budget.js never calls a write on the tracker', !/openById[\s\S]{0,400}?(setValue|appendRow|deleteRow|insertSheet)/.test(extractFn(BG, 'bgReadTracker_')));
check('the routes are wired', /case 'budget_model':\s+return jsonOut_\(webGetBudgetModel_\(\)\)/.test(WEB) && /case 'budget_scenario_save':\s+return jsonOut_\(webSaveBudgetScenario_\(body\)\)/.test(WEB)
  && /case 'budget_scenario_delete':\s+return jsonOut_\(webDeleteBudgetScenario_\(body\)\)/.test(WEB));
const FLAGS = [], everKeys = {};
S.writeFlags = fl => fl.forEach(f => { if (!everKeys[f.key]) { everKeys[f.key] = 1; FLAGS.push(f); } });
run('webGetBudgetModel_()'); run('webGetBudgetModel_()');
check('a line with no category is flagged once, with how to place it', FLAGS.length === 1 && FLAGS[0].key === 'budget_uncategorized_dog_walker' && /budget_category:Dog Walker/.test(FLAGS[0].reason) && FLAGS[0].source === 'Budget', JSON.stringify(FLAGS));
CONFIG['budget_category:Dog Walker'] = 'Household'; FLAGS.length = 0; delete everKeys.budget_uncategorized_dog_walker;
run('webGetBudgetModel_()');
check('…and not once it has one', FLAGS.length === 0);
delete CONFIG['budget_category:Dog Walker']; delete S.writeFlags;
S.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
r = run('webGetBudgetModel_()');
check('no tracker connected: says so', r.ok && r.configured === false && /SAT_SHEET_ID/.test(r.error));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
