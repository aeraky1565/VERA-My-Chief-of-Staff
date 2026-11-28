// Home & seasonal (HomePurchases.js, with Groceries.js and Pantry.js): decor, seasonal things and
// furniture from grocery runs. Pins:
//  - the paid total is shared across groceries, supplies and home in proportion (tax included);
//  - season dates (Thanksgiving, Easter by the computus, Ramadan from the table) and guesses;
//  - a reminder only within the weeks before a season, only with purchases from last time;
//  - a run can be home only; its home lines go to Home Purchases with their share; deleting it
//    removes them; the month carries a home total against a "Home & seasonal" budget row;
//  - a receipt's home lines never reach Purchase History; the reader keeps grocery/supply/home;
//  - "Not a pantry item" moves the rows and takes the amount off the run that counted it;
//  - wiring: route, nightly step, Features row; and, in a browser, the Finances card and the Pantry button.
// Runs in a vm over fake sheets. Every item, store and amount is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HP = read('HomePurchases.js'), GR = read('Groceries.js'), PA = read('Pantry.js'), CODE = read('Code.js');
const WEB = read('WebApp.js'), NR = read('NightlyRunner.js'), FE = read('Features.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const headers = name => eval(CODE.match(new RegExp('const ' + name + ' *= (\\[[^\\]]*\\]);'))[1]);
function fakeSheet(hdr) {
  const rows = [hdr.slice()];
  return { rows, getLastRow: () => rows.length, getLastColumn: () => rows[0].length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => { const o = x.slice(c - 1, c - 1 + (nc || 1)); while (o.length < (nc || 1)) o.push(''); return o; }),
      setValues: vals => vals.forEach((v, i) => { rows[r - 1 + i] = v.slice(); }),
      setValue: v => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; } }),
    appendRow: v => rows.push(v.slice()), deleteRow: r => rows.splice(r - 1, 1) };
}
function ctx(opts) {
  opts = opts || {};
  let uuid = 0;
  const c = { console, JSON, Math, Number, String, Array, Date, isFinite, Object, RegExp, parseInt, parseFloat, isNaN,
    TABS: { GROCERY_RUNS: 'GR', HOME_PURCHASES: 'HP', PURCHASE_HISTORY: 'PH', FLAGS: 'Flags', CONFIG: 'Config', CREDIT_CARDS: 'Cards', CARD_REWARDS: 'Rewards' },
    GROCERY_RUN_HEADERS: headers('GROCERY_RUN_HEADERS'), HOME_PURCHASE_HEADERS: headers('HOME_PURCHASE_HEADERS'), PURCHASE_HISTORY_HEADERS: headers('PURCHASE_HISTORY_HEADERS'),
    CREDIT_CARD_HEADERS: headers('CREDIT_CARD_HEADERS'), CARD_REWARD_HEADERS: headers('CARD_REWARD_HEADERS'),
    Utilities: { getUuid: () => 'u' + (++uuid) + 'abcdefghijkl', formatDate: () => opts.today || '2026-11-22' },
    Session: { getScriptTimeZone: () => 'UTC' }, Logger: { log() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    cfg: opts.cfg || {}, flags: null };
  c.sheets = { GR: fakeSheet(c.GROCERY_RUN_HEADERS), HP: fakeSheet(c.HOME_PURCHASE_HEADERS), PH: fakeSheet(c.PURCHASE_HISTORY_HEADERS), Flags: fakeSheet(['f']),
    Cards: fakeSheet(c.CREDIT_CARD_HEADERS), Rewards: fakeSheet(c.CARD_REWARD_HEADERS) };
  vm.createContext(c);
  vm.runInContext(PA + '\n' + GR + '\n' + HP, c);
  c.getSpreadsheet = () => ({ getSheetByName: n => c.sheets[n] || null });
  c.ensureSheet = (ss, n) => c.sheets[n];
  c.getConfigValues = () => c.cfg;
  c.getPurchaseHistorySheet_ = () => c.sheets.PH;
  c.webGetBudget_ = () => ({ ok: true, rows: opts.budget || [] });
  c.getShoppingList_ = () => [];
  c.upsertKeyedFlags_ = (sheet, prefix, src, wanted) => { c.flags = { prefix, src, wanted }; };
  c.getSuppressedKeyPatterns_ = () => [];
  c.setConfigRow_ = (k, v) => { c.cfg[k] = v; return true; };
  return c;
}

console.log('\nthe split');
{
  const c = ctx();
  const lines = [{ price: 20, kind: 'grocery' }, { price: 10, kind: 'supply' }, { price: 50, kind: 'home' }, { price: 20, kind: 'home' }];
  const s = c.hpSplit_(lines, 106);
  check('tax shared in proportion: 6% on everything', s.supply === 10.6 && J(s.homeAmounts) === J([null, null, 53, 21.2]) && s.home === 74.2 && s.grocery === 21.2, J(s));
  check('the three add up to what was paid', Math.round((s.grocery + s.supply + s.home) * 100) / 100 === 106);
  check('no paid total: the line sums', c.hpSplit_(lines, '').paid === 100 && c.hpSplit_(lines, '').home === 70);
  check('a line without a kind: food → grocery, else supply', c.hpKind_('', true) === 'grocery' && c.hpKind_(undefined, false) === 'supply' && c.hpKind_('home', true) === 'home');
}

console.log('\nseasons');
{
  const c = ctx();
  check('Thanksgiving: the fourth Thursday of November', c.hpSeasonDate_('Thanksgiving', 2027) === '2027-11-25' && c.hpSeasonDate_('Thanksgiving', 2026) === '2026-11-26');
  check('Easter by the computus', c.hpSeasonDate_('Easter', 2027) === '2027-03-28' && c.hpSeasonDate_('Easter', 2028) === '2028-04-16');
  check('Christmas, Halloween, Summer; Other has none', c.hpSeasonDate_('Christmas', 2027) === '2027-12-25' && c.hpSeasonDate_('Halloween', 2027) === '2027-10-31' && c.hpSeasonDate_('Summer', 2027) === '2027-06-21' && c.hpSeasonDate_('Other', 2027) === '');
  check('the next date: this year’s, or next year’s once it passed', c.hpNextDate_('Halloween', '2026-11-22') === '2027-10-31' && c.hpNextDate_('Christmas', '2026-11-22') === '2026-12-25');
  check('Ramadan from the table', c.hpNextDate_('Ramadan & Eid', '2026-11-22') === '2027-02-08');
  check('guesses from the name', c.hpSeasonGuess_('7.5 ft pre-lit christmas tree') === 'Christmas' && c.hpSeasonGuess_('outdoor wreath') === 'Christmas' && c.hpSeasonGuess_('kids pumpkin costume') === 'Halloween'
    && c.hpSeasonGuess_('storage ottoman') === '' && c.hpSeasonGuess_('easter egg dye kit') === 'Easter');
}

console.log('\nthe reminders');
{
  const c = ctx();
  const rows = [{ item: 'pre-lit tree', store: 'Costco', amount: 199.99, season: 'Christmas', date: '2026-11-22' }, { item: 'wreath', store: 'Target', amount: 15.49, season: 'Christmas', date: '2026-11-08' },
    { item: 'skeleton', store: 'Costco', amount: 12, season: 'Halloween', date: '2026-11-01' }, { item: 'ottoman', store: 'Costco', amount: 79.99, season: '', date: '2026-11-22' }];
  const w = c.hpRemindersWanted_(rows, '2027-11-05', 8);
  check('7 weeks before Christmas 2027, last year’s things: one flag keyed by season and year', J(Object.keys(w)) === J(['SEASON|Christmas|2027']), J(Object.keys(w)));
  const f = w['SEASON|Christmas|2027'];
  check('…it lists them and the total', /pre-lit tree \(Costco, \$199\.99\)/.test(f.reason) && /\$215\.48 in all/.test(f.reason) && /7 weeks away/.test(f.flag), J(f));
  check('not earlier than the window (Christmas is 12 weeks off on Oct 1)', !c.hpRemindersWanted_(rows, '2027-10-01', 8)['SEASON|Christmas|2027']);
  check('Halloween: last November’s skeleton counts, within 8 weeks of Oct 31', !!c.hpRemindersWanted_(rows, '2027-10-01', 8)['SEASON|Halloween|2027'] && !c.hpRemindersWanted_(rows, '2027-08-01', 8)['SEASON|Halloween|2027']);
  check('nothing bought last time: no flag', Object.keys(c.hpRemindersWanted_(rows, '2027-03-01', 8)).length === 0);
  c.sheets.HP.rows.push(['HP-1', '2026-11-22', 'pre-lit tree', 'Costco', 199.99, 'Christmas', 'GR-1', 'receipt', '', 'x']);
  const c2 = ctx({ today: '2027-11-01' }); c2.sheets.HP.rows.push(['HP-1', '2026-11-22', 'pre-lit tree', 'Costco', 199.99, 'Christmas', 'GR-1', 'receipt', '', 'x']);
  const r = c2.checkSeasonalReminders_();
  check('nightly: upserts SEASON| flags from the tab', c2.flags.prefix === 'SEASON|' && c2.flags.src === 'Home & seasonal' && J(Object.keys(c2.flags.wanted)) === J(['SEASON|Christmas|2027']) && r.flags === 1, J(c2.flags));
}

console.log('\nruns');
{
  const c = ctx({ budget: [{ label: 'Groceries', value: 900 }, { label: 'Home and seasonal', value: 250 }] });
  let r = c.webGroceryLog_({ run: { store: 'Costco', who: 'Ahmed', card: 'Gold', total: 31.8, source: 'receipt', counted: 'all', homeTotal: 74.2,
    home: [{ name: 'pre-lit tree', price: 50, amount: 53, season: 'Christmas' }, { name: 'ottoman', price: 20, amount: 21.2, season: '' }] } });
  check('a run with home lines: groceries in Total, home in Home Total', r.ok && r.run.total === 31.8 && r.run.homeTotal === 74.2 && c.sheets.GR.rows[1][11] === 74.2, J(r));
  const hp = c.sheets.HP.rows.slice(1);
  check('…its home lines go to Home Purchases with their share, season and run', hp.length === 2 && hp[0][2] === 'pre-lit tree' && hp[0][4] === 53 && hp[0][5] === 'Christmas' && hp[0][6] === r.run.id && hp[1][4] === 21.2 && hp[1][5] === '', J(hp));
  const r2 = c.webGroceryLog_({ run: { store: 'Target', who: 'Victoria', total: 0, homeTotal: 15.49, home: [{ name: 'wreath', price: 15.49, season: 'Christmas' }] } });
  check('a home-only run is fine (total 0)', r2.ok && r2.run.total === 0 && c.sheets.HP.rows.length === 4, J(r2));
  check('…but nothing at all is refused', c.webGroceryLog_({ run: { store: 'Target', who: 'Victoria', total: 0 } }).ok === false);
  const r3 = c.webGroceryLog_({ run: { store: 'Costco', who: 'Ahmed', total: 40, homeTotal: 25, source: 'typed' } });
  check('typed with a home amount: one row', r3.ok && c.sheets.HP.rows[c.sheets.HP.rows.length - 1][2] === 'Home & seasonal' && c.sheets.HP.rows[c.sheets.HP.rows.length - 1][4] === 25);
  const m = c.webGroceryMonth_({ ym: '2026-11' });
  check('the month: home total, by season, against the "Home and seasonal" row', m.home.total === 114.69 && m.home.budget === 250 && m.home.bySeason[0].season === 'Christmas' && m.home.bySeason[0].total === 68.49 && m.budget === 900, J(m.home));
  const d = c.webGroceryDelete_({ id: r.run.id });
  check('deleting the run removes its home rows', d.ok && d.homeRemoved === 2 && c.sheets.HP.rows.every(x => x[6] !== r.run.id));
  check('rows without a budget row: budget null', ctx().webGroceryMonth_({ ym: '2026-11' }).home.budget === null);
  check('setup tells the screen the Home Items threshold', ctx({ cfg: { home_keep_min: '75' } }).webGrocerySetup_({ store: 'Costco' }).keepMin === 75 && ctx().webGrocerySetup_({ store: 'Costco' }).keepMin === 50);
}

console.log('\nthe pantry');
{
  const c = ctx();
  const clean = c.receiptClean_(J([{ name: 'bananas', price: 1.99, food: true }, { name: 'paper towels', price: 22.99, food: false }, { name: 'wreath', price: 15, food: false, kind: 'home' }, { name: 'odd', price: 1, food: false, kind: 'grocery' }]), []);
  check('the reader keeps grocery, supply and home (a non-food "grocery" is a supply)', J(clean.map(x => x.kind)) === J(['grocery', 'supply', 'home', 'supply']), J(clean));
  check('the reader asks for the kind', /"kind": "grocery" for food and drink, "supply"/.test(PA) && /"kind": "grocery" for food and drink, "supply"/.test(read('GroceryRun.js')));
  c.logPurchaseItems_ = items => { c.logged = items; return { ok: true }; };
  c.receiptLog_('Costco', [{ name: 'bananas', price: 1.99 }, { name: 'christmas wreath', price: 15, kind: 'home' }], '2026-11-22');
  check('a home line never reaches Purchase History', J((c.logged || []).map(x => x.normalized)) === J(['bananas']), J(c.logged));
}

console.log('\nnot a pantry item');
{
  const c = ctx();
  const PH = c.sheets.PH.rows;
  PH.push(['PH-1', 'Christmas wreath', 'christmas wreath', 'Household', '2026-11-08', 1, '', 'Target', 15.49, 'receipt', ''],
          ['PH-2', 'Bananas', 'bananas', 'Produce', '2026-11-08', 1, '', 'Target', 1.99, 'receipt', ''],
          ['PH-3', 'Desk lamp', 'desk lamp', 'Household', '2026-10-30', 1, '', 'Costco', 34.99, 'receipt', '']);
  c.sheets.GR.rows.push(['GR-1', '2026-11-08', 'Target', 'Ahmed', 'Gold', 60, 'receipt', 'all', 60, 'x', 'x', ''],
                        ['GR-2', '2026-10-30', 'Costco', 'Ahmed', 'Gold', 80, 'receipt', 'food', 80, 'x', 'x', '']);
  const r = c.webPantryToHome_({ parameter: { name: 'Christmas wreath', season: 'Christmas' } });
  check('moves the rows out of the pantry', r.ok && r.moved === 1 && PH.length === 3 && PH.every(x => x[2] !== 'christmas wreath'), J(r));
  const hp = c.sheets.HP.rows[1];
  check('…into Home Purchases, source pantry, with its season', hp[2] === 'Christmas wreath' && hp[4] === 15.49 && hp[5] === 'Christmas' && hp[7] === 'pantry' && hp[6] === 'GR-1', J(hp));
  check('…and takes it off the run that counted it in groceries', c.sheets.GR.rows[1][5] === 44.51 && c.sheets.GR.rows[1][11] === 15.49 && r.runsAdjusted === 1, J(c.sheets.GR.rows[1]));
  const r2 = c.webPantryToHome_({ parameter: { name: 'desk lamp' } });
  check('a "just the food" run never counted a household line: left alone', r2.ok && r2.runsAdjusted === 0 && c.sheets.GR.rows[2][5] === 80);
  check('an item that isn’t there is refused', c.webPantryToHome_({ parameter: { name: 'unicorn' } }).ok === false);
}

console.log('\nwiring');
check('route pantry_to_home', /case 'pantry_to_home':\s*return jsonOut_\(webPantryToHome_\(e\)\)/.test(WEB));
check('nightly: after the tech gear step', /S\('checkTechGear_', 3, function\(\) \{ checkTechGear_\(\); \}\),\n\s*S\('checkSeasonalReminders_', 3, function\(\) \{ checkSeasonalReminders_\(\); \}\),/.test(NR));
check('a Features row with its two settings', /k: 'home_seasonal'[\s\S]{0,500}steps: \['checkSeasonalReminders_'\][\s\S]{0,200}season_remind_weeks[\s\S]{0,200}home_keep_min/.test(FE));
check('the tab and its headers', /HOME_PURCHASES:\s*'Home Purchases'/.test(CODE) && headers('GROCERY_RUN_HEADERS').slice(-1)[0] === 'Home Total');

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
const PAGES = process.env.VERA_PAGES_ROOT || ROOT;
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screens: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const MONTH = { ok: true, ym: '2026-11', today: '2026-11-22', total: 684.12, budget: 900, byWho: {}, cards: [], runs: [], pace: null, stores: [],
    home: { total: 342.46, budget: 250, bySeason: [{ season: 'Christmas', total: 250.47, items: [{ item: 'pre-lit tree' }, { item: 'string lights' }] }, { season: 'Other', total: 79.99, items: [{ item: 'storage ottoman' }] }] } };
  const PANTRY = { ok: true, daysAhead: 7, onHand: [], items: [{ normalized: 'christmas wreath', aisle: 'Household', avgDays: 30, lastDate: '2026-11-08', daysUntil: null }, { normalized: 'paper towels', aisle: 'Household', avgDays: 21, daysUntil: null }, { normalized: 'bananas', aisle: 'Produce', avgDays: 5, daysUntil: null }] };
  for (const width of [390, 1280]) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(PAGES, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ month, pantry }) => {
      window.__ev = []; window.__month = month;
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'grocery_month') return Promise.resolve(JSON.parse(JSON.stringify(window.__month))); if (p.action === 'pantry') return Promise.resolve(pantry);
        if (p.action === 'pantry_to_home') return Promise.resolve({ ok: true, moved: 1 }); return Promise.resolve({ ok: true }); };
      document.body.innerHTML = '<div id="gc" style="padding:0 16px"></div><div id="pa" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('gc')).render(React.createElement(GroceriesCard, { apiUrl: 'u', apiToken: 't', who: 'Ahmed' }));
      ReactDOM.createRoot(document.getElementById('pa')).render(React.createElement(PantryView, { apiUrl: 'u', apiToken: 't' }));
    }, { month: MONTH, pantry: PANTRY });
    await page.waitForTimeout(400);
    const home = await page.$eval('#gc .grc-home', n => n.innerText).catch(() => '');
    check('Finances › Groceries: Home & seasonal against its budget, by season', /Home & seasonal/.test(home) && /\$342\.46/.test(home) && /of \$250/.test(home) && /over/.test(home) && /Christmas/.test(home) && /pre-lit tree, string lights/.test(home) && /🏠 Home/.test(home), home);
    await page.click('#pa .pa-fold >> text=/Household/'); await page.waitForTimeout(60);
    await page.click('#pa .pa-fold >> text=/Produce/'); await page.waitForTimeout(60);
    check('the Pantry: Household rows offer “Not a pantry item”; Produce doesn’t', (await page.$$('#pa .pa-tohome')).length === 2 && !!(await page.$('#pa .pa-row[data-item="bananas"]')) && !(await page.$('#pa .pa-row[data-item="bananas"] .pa-tohome')));
    await page.click('#pa .pa-row[data-item="christmas wreath"] .pa-tohome'); await page.waitForTimeout(60);
    check('…it guesses the season', (await page.$eval('#pa .pa-tohome-season', n => n.value)) === 'Christmas');
    await page.click('#pa .pa-tohome-go'); await page.waitForTimeout(120);
    check('…and moves it: pantry_to_home with the season, gone from the list', J((await page.evaluate(() => window.__ev)).filter(e => e.action === 'pantry_to_home')) === J([{ action: 'pantry_to_home', name: 'christmas wreath', season: 'Christmas' }])
      && !(await page.$('#pa .pa-row[data-item="christmas wreath"]')) && /Moved to Home & seasonal: christmas wreath \(Christmas\)/.test(await page.$eval('#pa', n => n.innerText)));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
