// Finances › Goals, read from the planner (PlannerGoals.js): every read by label, the
// house-linked target from the house plan, a one-off over target is READY, yearly
// budgets count every trip (and anything whose Goal names them) per year, shares are
// shares of the target, and the planner is never written. All figures are invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PG = read('PlannerGoals.js'), NW = read('NetWorth.js'), TRIP = read('Trips.js'), WEB = read('WebApp.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
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
const pad = n => String(n).padStart(2, '0');
const S = {
  Utilities: { formatDate: d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) },
  Session: { getScriptTimeZone: () => 'UTC' }, Logger: { log() {} },
};
vm.createContext(S);
vm.runInContext(extractFn(TRIP, 'dateCellToIso_'), S);
['nwNorm_', 'nwCol_', 'nwNumber_', 'nwIsoDate_', 'nwIsoMonth_', 'nwBool_', 'nwUnavailable_', 'nwParsePlans_', 'nwParseAsOf_', 'nwReadTabs_']
  .forEach(n => vm.runInContext(extractFn(NW, n), S));
vm.runInContext(PG, S);
const J = JSON.stringify;
const run = (expr, vars) => { Object.assign(S, vars || {}); return vm.runInContext(expr, S); };

// ---- invented planner tabs ----
const GOALS = [
  ['Goal', 'Kind (one-off/reserve/yearly budget)', 'Priority (must/want)', 'Status (active/paused/achieved)', 'Target', 'Target month (YYYY-MM)', 'Saved or kept', 'Pat share', 'Sam share', 'Joint share', 'Linked to house'],
  ['Rainy Day', 'reserve', 'must', 'achieved', '$12,000', '', '$12,000', '$7,000', '$5,000', '$0', 'FALSE'],
  ['Trips Fund', 'yearly budget', 'want', 'active', '$8,000', '', '$0', '$4,000', '$4,000', '$0', 'FALSE'],
  ['Home Deposit', 'one-off', 'want', 'active', '$0', '', '$90,000', '$40,000', '$40,000', '$0', 'TRUE'],
  ['New Car', 'one-off', 'must', 'active', '$20,000', '2027-09', '$5,000', '', '', '$20,000', 'FALSE'],
  ['Boat', 'one-off', 'want', 'paused', '$30,000', '', '$1,000', '', '', '', 'FALSE'],
  ['', '', '', '', '', '', '', '', '', '', ''],
];
const SETTINGS = [['Section', 'Key', 'Value'], ['Household', 'asOfDate', '2026-09-20'], ['Household', 'floor', '20,000'],
  ['House (plan)', 'house.on', 'TRUE'], ['House (plan)', 'house.price', '400,000'], ['House (plan)', 'house.downPct', '20'],
  ['House (plan)', 'house.extra', '5,000'], ['House (plan)', 'house.date', '2027-05']];
const PLANS = [['Item', 'Month (YYYY-MM)', 'Amount', 'Category', 'Confidence', 'Can defer', 'Goal'],
  ['Beach week', '2026-12', '$3,000', 'Trip', 'committed', 'FALSE', ''],
  ['Spring trip', '2026-03', '$1,500', 'Trip', 'committed', 'FALSE', ''],
  ['Side project', '2027-02', '$5,000', 'Business', 'maybe', 'TRUE', ''],
  ['Ski trip', '2027-01', '$2,500', 'Trip', 'likely', 'TRUE', ''],
  ['Passport fees', '2027-03', '$400', 'Admin', 'likely', 'FALSE', 'Trips Fund'],
  ['Moving van', '2027-05', '$900', 'Trip', 'likely', 'FALSE', 'Home Deposit']];
const OUTPUTS = [['PLANNER: outputs'], ['Calculated Nov 1, 2026 8:55 PM by someone@example.test. Read-only summary.'], [], ['Item', 'Value', 'What it means'],
  ['Net worth', '900,000', ''], ['12-month cash low', '41,500', 'Jun 27; our floor is $20,000']];

console.log('\nreading the Goals tab by label');
{
  const g = run('pgParseGoals_(__g)', { __g: GOALS });
  check('every goal with a name, none without', g.status === 'ok' && g.goals.length === 5, J(g));
  check('kinds are normalised', g.goals.map(x => x.kind).join(',') === 'reserve,yearly,one-off,one-off,one-off');
  check('money cells typed as text are read', g.goals[0].target === 12000 && g.goals[2].saved === 90000);
  check('share columns are found by "share", owners not hard-coded', J(g.goals[0].shares) === J([{ who: 'Pat', amount: 7000 }, { who: 'Sam', amount: 5000 }]), J(g.goals[0].shares));
  check('…a zero share is left out', J(g.goals[3].shares) === J([{ who: 'Joint', amount: 20000 }]));
  check('linked to house reads TRUE/FALSE text', g.goals[2].house === true && g.goals[0].house === false);
  check('target month is a month', g.goals[3].month === '2027-09');
  const moved = GOALS.map(r => [r[6], r[0], r[1], r[2], r[3], r[4], r[5], r[7], r[8], r[9], r[10]]);
  const m = run('pgParseGoals_(__g)', { __g: moved });
  check('columns in another order read the same', m.goals[2].saved === 90000 && m.goals[1].name === 'Trips Fund', J(m.goals[2]));
  const nos = GOALS.map(r => r.filter((_, i) => i !== 6));
  const u = run('pgParseGoals_(__g)', { __g: nos });
  check('a missing required column makes the goals unavailable, named', u.status === 'unavailable' && /saved/.test(u.reason), J(u));
  check('an empty tab is unavailable', run('pgParseGoals_([])').status === 'unavailable');
}

console.log('\nthe house plan and the outputs');
{
  const st = run('pgSettings_(__s)', { __s: SETTINGS });
  const h = run('pgHouse_(__st)', { __st: st });
  check('down payment = price × down % + closing costs', h.down === 85000 && h.month === '2027-05', J(h));
  check('the house plan switched off gives no target', run('pgHouse_(__x)', { __x: Object.assign({}, st, { 'house.on': 'FALSE' }) }) === null);
  check('…nor does one with no price', run('pgHouse_(__x)', { __x: { 'house.on': 'TRUE' } }) === null);
  const o = run('pgOutputs_(__o)', { __o: OUTPUTS });
  check('when the planner calculated, without who', o.calculated === 'Nov 1, 2026', o.calculated);
  check('the 12-month cash low and when', o.cashLow === 41500 && o.cashLowWhen === 'Jun 27', J(o));
}

console.log('\nbuilding the tab');
const build = (today, over) => {
  const g = run('pgParseGoals_(__g)', { __g: GOALS }).goals;
  const st = run('pgSettings_(__s)', { __s: SETTINGS });
  const p = run('nwParsePlans_(__p)', { __p: PLANS }).items;
  return run('pgBuild_(__a, __h, __p, __o, 20000, __t)', Object.assign({ __a: g, __h: run('pgHouse_(__st)', { __st: st }), __p: p, __o: run('pgOutputs_(__o2)', { __o2: OUTPUTS }), __t: today }, over || {}));
};
{
  const b = build('2026-11-02'), by = n => b.goals.filter(g => g.name === n)[0];
  const home = by('Home Deposit');
  check('a house-linked goal takes its target from the house plan', home.target === 85000 && home.targetFrom === 'house', J(home));
  check('…over target, a one-off is READY, not reached', home.state === 'ready' && home.pct === 106, J(home));
  check('…and carries the house plan for its line', home.houseLine.price === 400000 && home.houseLine.downPct === 20 && home.month === '2027-05');
  check('achieved in the planner is REACHED', by('Rainy Day').state === 'reached');
  check('a reserve shows the cash low against the floor', J(by('Rainy Day').cashLow) === J({ amount: 41500, when: 'Jun 27', floor: 20000 }));
  check('paused stays paused', by('Boat').state === 'paused');
  check('short of target is active, with its %', by('New Car').state === 'active' && by('New Car').pct === 25);
  const t = by('Trips Fund');
  check('a yearly budget has this year and next', t.years.map(y => y.year).join(',') === '2026,2027', J(t.years));
  check('this year: every trip in the year counts', t.years[0].planned === 4500 && t.years[0].items.map(i => i.item).join('|') === 'Spring trip|Beach week', J(t.years[0]));
  check('…what\'s left of the budget', t.years[0].left === 3500);
  check('…the next one is still ahead, not one already past', t.years[0].next.item === 'Beach week' && t.years[0].items[0].past === true, J(t.years[0].next));
  check('next year: trips plus anything whose Goal names it, not other spends', t.years[1].items.map(i => i.item).join('|') === 'Ski trip|Passport fees' && t.years[1].planned === 2900, J(t.years[1]));
  check('a trip assigned to another goal doesn\'t count here', !t.years[1].items.some(i => i.item === 'Moving van'));
  check('in progress first, musts first; then paused, ready, reached', b.goals.map(g => g.name).join('|') === 'New Car|Trips Fund|Boat|Home Deposit|Rainy Day', b.goals.map(g => g.name).join('|'));
  check('set aside is everything saved', b.summary.setAside === 108000, J(b.summary));
  check('done counts reached and ready', b.summary.done === 2 && b.summary.count === 5);
  check('still to go: what active goals lack, and this year\'s budget left', b.summary.toGo === 15000 + 3500, J(b.summary));
  const over = build('2026-11-02', { __p: run('nwParsePlans_(__p)', { __p: PLANS.concat([['Big trip', '2026-12', '$9,000', 'Trip', 'maybe', 'TRUE', '']]) }).items });
  check('a budget over its limit says so', over.goals.filter(g => g.name === 'Trips Fund')[0].years[0].left === -5500);
  const nh = build('2026-11-02', { __h: null });
  check('no house plan: the goal keeps the planner\'s own target', nh.goals.filter(g => g.name === 'Home Deposit')[0].target === 0 && !nh.goals.filter(g => g.name === 'Home Deposit')[0].targetFrom);
  const jan = build('2027-01-15');
  check('a new year moves the years along', jan.goals.filter(g => g.name === 'Trips Fund')[0].years.map(y => y.year).join(',') === '2027,2028');
}

console.log('\nthe endpoint, and the planner is only read');
{
  const touched = [];
  const tabs = { Goals: GOALS, Settings: SETTINGS, 'Plan items': PLANS, Outputs: OUTPUTS };
  const sheet = name => new Proxy({}, { get: (t, k) => { touched.push(name + '.' + String(k)); return k === 'getDataRange' ? () => ({ getValues: () => tabs[name] }) : () => { throw new Error('write: ' + String(k)); }; } });
  S.SpreadsheetApp = { openById: id => new Proxy({}, { get: (t, k) => { touched.push('ss.' + String(k)); return k === 'getSheetByName' ? n => (tabs[n] ? sheet(n) : null) : () => { throw new Error('write'); }; } }) };
  S.getConfigValues = () => ({ planner_sheet_id: 'SHEET-ID' });
  const r = run('webGetPlannerGoals_()');
  check('it answers with the goals', r.ok && r.status === 'ok' && r.goals.length === 5, J(r).slice(0, 200));
  check('only getSheetByName and getDataRange().getValues() are touched', touched.every(x => /^(ss\.getSheetByName|[A-Za-z ]+\.getDataRange)$/.test(x)), J(touched));
  check('it says when, and links the planner', r.calculated === 'Nov 1, 2026' && r.asOf === '2026-09-20' && /SHEET-ID/.test(r.plannerUrl));
  check('no email or name from the outputs line leaks', !/example\.test/.test(J(r)));
  S.getConfigValues = () => ({});
  check('not set up says so', J(run('webGetPlannerGoals_()')) === J({ ok: true, configured: false }));
  S.getConfigValues = () => ({ planner_sheet_id: 'X' });
  delete tabs.Goals;
  const ng = run('webGetPlannerGoals_()');
  check('no Goals tab: unavailable, with why', ng.ok && ng.status === 'unavailable' && /Goals/.test(ng.reason), J(ng));
  tabs.Goals = GOALS; delete tabs['Plan items'];
  const np = run('webGetPlannerGoals_()');
  check('no Plan items: goals still show, budgets say nothing is readable', np.status === 'ok' && np.plansAvailable === false && np.goals.length === 5);
  S.SpreadsheetApp = { openById: () => { throw new Error('no access'); } };
  check('a sheet that can\'t be opened is an error', run('webGetPlannerGoals_()').ok === false);
}

console.log('\nwiring');
check('GET planner_goals', /case 'planner_goals':\s*return jsonOut_\(webGetPlannerGoals_\(\)\)/.test(WEB));
check('the planner code has no write call', !/\.(setValue|setValues|appendRow|insertRow|deleteRow|clear)\(/.test(PG));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
