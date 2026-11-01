// Grocery runs (Groceries.js): each Done shopping run's total, who went and on
// which card, the month's grocery spend against the Budget tab, and which stores
// count. Runs in a vm over fake sheets. Today is Nov 20, 2026. Every store,
// card, rate and amount is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const GR = fs.readFileSync(path.join(ROOT, 'Groceries.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const headers = name => eval(CODE.match(new RegExp('const ' + name + ' *= (\\[[^\\]]*\\]);'))[1]);
function fakeSheet(hdr) {
  const rows = [hdr.slice()];
  return { rows, getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => { const o = x.slice(c - 1, c - 1 + (nc || 1)); while (o.length < (nc || 1)) o.push(''); return o; }),
      setValues: vals => vals.forEach((v, i) => { rows[r - 1 + i] = v.slice(); }),
      setValue: v => { rows[r - 1][c - 1] = v; } }),
    appendRow: v => rows.push(v.slice()), deleteRow: r => rows.splice(r - 1, 1) };
}
let uuid = 0;
const S = vm.createContext({ console, JSON, Math, Number, String, Array, Date, isFinite, Object,
  TABS: { GROCERY_RUNS: 'GR', CONFIG: 'Config', CREDIT_CARDS: 'Cards', CARD_REWARDS: 'Rewards' },
  GROCERY_RUN_HEADERS: headers('GROCERY_RUN_HEADERS'), CREDIT_CARD_HEADERS: headers('CREDIT_CARD_HEADERS'), CARD_REWARD_HEADERS: headers('CARD_REWARD_HEADERS'),
  Utilities: { getUuid: () => String(++uuid).padEnd(12, 'e') + '-0', formatDate: () => S.TODAY }, TODAY: '2026-11-20',
  Session: { getScriptTimeZone: () => 'UTC' }, Logger: { log: () => {} },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, _configCache_: null });
S.sheets = { GR: fakeSheet(S.GROCERY_RUN_HEADERS), Config: fakeSheet(['Key', 'Value', 'Notes']), Cards: fakeSheet(S.CREDIT_CARD_HEADERS), Rewards: fakeSheet(S.CARD_REWARD_HEADERS) };
S.sheets.Cards.rows.push(
  ['C1', 'Gold Card', 'Bank A', '1111', 250, 1, '', 'Ahmed', '', 'Yes'],
  ['C2', 'Cash Card', 'Bank B', '2222', 0, 1, '', 'Victoria', '', 'Yes'],
  ['C3', 'Old Grocery Card', 'Bank C', '3333', 0, 1, '', 'Victoria', '', 'No'],
  ['C4', 'Shared Card', 'Bank D', '4444', 0, 1, '', 'Joint', '', 'Yes'],
  ['C5', 'Plain Card', 'Bank E', '5555', 0, 1, '', 'Ahmed', 'Victoria', 'Yes']);
S.sheets.Rewards.rows.push(
  ['R1', 'Gold Card', 'Groceries', '4', 'x points', 'US supermarkets, up to $25k/yr then 1x'],
  ['R2', 'Cash Card', 'Groceries', '3', '% cashback', 'US supermarkets, up to $6k/yr then 1%'],
  ['R3', 'Old Grocery Card', 'Groceries', '6', '% cashback', 'US supermarkets'],
  ['R4', 'Shared Card', 'Online Groceries', '5', 'x points', 'Online only'],
  ['R5', 'Plain Card', 'Groceries', '2', 'x points', '']);
S.getSpreadsheet = () => ({ getSheetByName: n => S.sheets[n] || null });
S.ensureSheet = (ss, name) => S.sheets[name];
S.getConfigValues = () => { const o = {}; S.sheets.Config.rows.slice(1).forEach(r => { o[r[0]] = String(r[1]); }); return o; };
S.budgetRows = [{ label: 'Rent', value: '$3,500.00' }, { label: 'Groceries', value: '$800.00' }];
S.webGetBudget_ = () => ({ ok: true, rows: S.budgetRows, configured: true });
S.getShoppingList_ = () => ['Wegmans', 'Costco', 'Lidl', 'Whole Foods', "MOM's", "Trader Joe's", 'Giant', 'Target', 'Egyptian/Greek', 'Recipe', 'Wish List', 'Home Supplies', 'Egypt'].map(n => ({ storeName: n }));
vm.runInContext(GR, S);
const run = c => vm.runInContext(c, S);
const J = x => JSON.stringify(x);

console.log('\nthe total and which stores count');
{
  S.lines = [{ name: 'bananas', price: 2.19, food: true }, { name: 'paper towels', price: 14.99, food: false }, { name: 'yogurt', price: '6.49', food: true }, { name: 'bag', price: null }];
  check('every line counts, pantry or not', run('grCountedTotal_(lines, "all")') === 23.67, run('grCountedTotal_(lines, "all")'));
  check('"just the food" leaves out what isn’t food', run('grCountedTotal_(lines, "food")') === 8.68, run('grCountedTotal_(lines, "food")'));
  const set = run('grStoreSetting_()');
  check('the first read seeds the grocery stores', J(Object.keys(set).sort()) === J(['Egyptian/Greek', 'Giant', 'Lidl', "MOM's", "Trader Joe's", 'Wegmans', 'Whole Foods']), J(set));
  check('…into Config', S.sheets.Config.rows.length === 2 && S.sheets.Config.rows[1][0] === 'shop_grocery_stores');
  check('…once', (run('grStoreSetting_()'), S.sheets.Config.rows.length === 2));
  S.set = set;
  check('Wegmans counts; Costco and Target ask', run('grIsGroceryStore_("Wegmans", set)') === true && run('grIsGroceryStore_("Costco", set)') === false && run('grIsGroceryStore_("Target", set)') === false);
  check('lists that are not stores are never stores', run('grIsGroceryStore_("Recipe", set)') === null && run('grIsGroceryStore_("Egypt", set)') === null && run('grIsGroceryStore_("Home Supplies", set)') === null);
  const list = run('grStoreList_(' + J(S.getShoppingList_().map(s => s.storeName)) + ', set)');
  check('the Stores setting shows the nine stores, not the lists', list.length === 9 && !list.some(x => /Recipe|Wish|Supplies|^Egypt$/.test(x.store)), J(list.map(x => x.store)));
}

console.log('\nthe best card for whoever went');
{
  S.CR = run('grCardsAndRewards_()');
  const a = run('grBestCard_(CR.cards, CR.rewards, "Ahmed")'), v = run('grBestCard_(CR.cards, CR.rewards, "Victoria")');
  check('Ahmed: his best grocery rate', a.card === 'Gold Card' && a.rate === 4, J(a));
  check('…said plainly', /^4x points at /.test(a.why) && /best of yours here$/.test(a.why), a.why);
  check('Victoria: her best active one; a closed card is skipped', v.card === 'Cash Card' && /^3% back/.test(v.why), J(v));
  check('an authorised user can use the card, and joint cards count', J(run('grCardsFor_(CR.cards, "Victoria")').map(c => c.name)) === J(['Cash Card', 'Shared Card', 'Plain Card']));
  check('"Online Groceries" is not a grocery-store rate', run('grBestCard_([{name:"Shared Card",owner:"Joint"}], CR.rewards, "Ahmed")').why === 'no grocery rate on file');
  check('points or cash back earned, in words', run('grEarned_(389, { rate: 4, rateType: "x points" })') === 'about 1,556 points at 4x' &&
        run('grEarned_(223, { rate: 3, rateType: "% cashback" })') === 'about $6.69 back at 3%');
}

console.log('\nthe budget, read from the Budget tab');
{
  check('the Groceries row', run('grBudgetFrom_(budgetRows)') === 800);
  check('none: null, not zero', run('grBudgetFrom_([{label:"Rent",value:"$1"}])') === null);
}

console.log('\nlogging, the month, and fixing a run');
{
  check('a run needs a store, who and a total', run('webGroceryLog_({ run: { who: "Ahmed", total: 5 } })').ok === false &&
        run('webGroceryLog_({ run: { store: "Wegmans", total: 5 } })').ok === false && run('webGroceryLog_({ run: { store: "Wegmans", who: "Ahmed", total: 0 } })').ok === false);
  const log = (store, who, card, total, date, extra) => run('webGroceryLog_({ run: ' + J(Object.assign({ store, who, card, total, date, source: 'receipt' }, extra || {})) + ' })');
  let r = log('Wegmans', 'Ahmed', 'Gold Card', '74.35', '');
  check('a run is saved for today', r.ok && r.run.date === '2026-11-20' && r.run.total === 74.35 && /^GR-/.test(r.run.id) && r.month === 74.35, J(r));
  S.rid = r.run.id;
  log('Giant', 'Victoria', 'Cash Card', 64.18, '2026-11-02', { source: 'typed' });
  log('Costco', 'Ahmed', 'Gold Card', 38.40, '2026-11-05', { counted: 'food', itemsTotal: 112.65 });
  log('Lidl', 'Victoria', 'Cash Card', 50, '2026-10-31');
  log('Lidl', 'Victoria', 'Cash Card', 40, '2026-10-12');
  log('Lidl', 'Ahmed', 'Gold Card', 99, '2026-10-25');
  const all = run('grAll_()');
  check('just the food keeps the full receipt too', all.filter(x => x.store === 'Costco')[0].counted === 'food' && all.filter(x => x.store === 'Costco')[0].itemsTotal === 112.65);
  S.all = all;
  const t = run('grMonthTotals_(all, "2026-11")');
  check('the month: only this month’s runs', t.total === 176.93 && t.count === 3, J(t.total));
  check('…by person', t.byWho.Ahmed.total === 112.75 && t.byWho.Ahmed.runs === 2 && t.byWho.Victoria.total === 64.18, J(t.byWho));
  check('…by card', Math.round(t.byCard['Gold Card'] * 100) / 100 === 112.75 && t.byCard['Cash Card'] === 64.18);
  check('…newest first', t.runs[0].date === '2026-11-20' && t.runs[2].date === '2026-11-02');
  const pace = run('grPaceLine_(all, "2026-11-20", 800)');
  check('what is left, the days to go, and last month by the same day', pace.left === 623.07 && pace.daysLeft === 10 && pace.lastMonthByNow === 40, J(pace));
  r = run('webGroceryUpdate_({ run: { id: rid, total: "80.10", who: "Victoria" } })');
  check('a run can be fixed, keeping the rest', r.ok && r.run.total === 80.1 && r.run.who === 'Victoria' && r.run.store === 'Wegmans' && r.run.card === 'Gold Card', J(r));
  check('…not to nothing', run('webGroceryUpdate_({ run: { id: rid, total: 0 } })').ok === false);
  check('a run can be removed', run('webGroceryDelete_({ id: rid })').ok === true && !run('grAll_()').some(x => x.id === S.rid));
  const m = run('webGroceryMonth_({ ym: "2026-11" })');
  check('the month page: budget, pace, cards with earnings, stores', m.ok && m.budget === 800 && m.pace && m.cards[0].card === 'Cash Card' && /points at 4x/.test(m.cards.filter(c => c.card === 'Gold Card')[0].earned) && m.stores.length === 9, J(m.cards));
  const su = run('webGrocerySetup_({ store: "Costco" })');
  check('setup for a run: Costco asks, each person’s card, the month so far', su.ok && su.counts === false && su.people.Ahmed.suggested.card === 'Gold Card' &&
        su.people.Victoria.suggested.card === 'Cash Card' && su.month.budget === 800 && su.month.spent === 102.58, J(su.month));
  check('…a list that is not a store is never logged', run('webGrocerySetup_({ store: "Recipe" })').counts === null);
}

console.log('\nthe stores setting');
{
  run('_configCache_ = { stale: true }');
  const r = run('webGroceryStoresSave_({ stores: { "Costco": true, "Giant": false, "Recipe": true } })');
  check('saving clears the cached config, so the next read sees it', run('_configCache_') === null);
  check('switches save; a list can’t be made a store', r.ok && r.stores.Costco === true && !('Giant' in r.stores) && !('Recipe' in r.stores), J(r.stores));
  check('…and are read back', run('grIsGroceryStore_("Costco", grStoreSetting_())') === true && run('grIsGroceryStore_("Giant", grStoreSetting_())') === false);
}

console.log('\nwiring');
{
  check('GET grocery_setup and grocery_month', /case 'grocery_setup':\s*return jsonOut_\(webGrocerySetup_\(e\.parameter\)\)/.test(WEB) && /case 'grocery_month':\s*return jsonOut_\(webGroceryMonth_\(e\.parameter\)\)/.test(WEB));
  ['grocery_log:webGroceryLog_', 'grocery_update:webGroceryUpdate_', 'grocery_delete:webGroceryDelete_', 'grocery_stores_save:webGroceryStoresSave_'].forEach(x => {
    const [a, f] = x.split(':'); check('POST ' + a, new RegExp("case '" + a + "':\\s*return jsonOut_\\(" + f + "\\(body\\)\\)").test(WEB)); });
  check('nothing here writes to the tracker sheet', !/SAT_SHEET_ID|openById/.test(GR));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
