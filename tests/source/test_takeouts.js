// Kitchen › Takeouts (Takeouts.js, the takeout routes in WebApp.js, TakeoutsView). Pins:
//  - "We ordered" stamps today and counts it on the restaurant and on each dish named (twice in a
//    day counts once); the new columns are added and named; an unknown restaurant is refused;
//  - a dish says who it's for (Ahmed / Victoria / Both; A, V too), on add and on update;
//  - the read sends lastOrdered, timesOrdered and for;
//  - "our usual": dishes ordered 2+ times, most first, else the 4★+ ones; last ordered first;
//  - the screen: cuisine chips, stars to rate, our usual with A/V, last ordered, We ordered with
//    dishes, the dish list (For, stars, delete, add), add a restaurant. Invented restaurants.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TO = read('Takeouts.js'), WEB = read('WebApp.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
function fakeSheet(rows, maxCols) {
  const grid = rows.map(r => r.slice()); let cols = maxCols;
  const pad = r => { while (r.length < cols) r.push(''); return r; }; grid.forEach(pad);
  return { grid, getLastRow: () => grid.length, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; grid.forEach(pad); },
    getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
      getValue: () => (grid[r - 1] || [])[c - 1] ?? '', setValue: x => { grid[r - 1][c - 1] = x; },
      setValues: v => v.forEach((row, i) => { while (grid.length < r + i) grid.push(pad([])); row.forEach((x, j) => { grid[r - 1 + i][c - 1 + j] = x; }); }) }) };
}
const TODAY = new Date().toISOString().slice(0, 10);
function ctx(rs, is) {
  const c = { String, Number, Math, JSON, Date, Object, RegExp, isNaN, parseInt, TABS: { TAKEOUT_RESTAURANTS: 'R', TAKEOUT_ITEMS: 'I' },
    TAKEOUT_RESTAURANT_HEADERS: ['Name', 'Cuisine', 'Phone', 'Website', 'Rating', 'Notes'], TAKEOUT_ITEM_HEADERS: ['Restaurant', 'Item', 'Description', 'Rating', 'Notes'],
    getSpreadsheet: () => ({ getSheetByName: n => n === 'R' ? rs : n === 'I' ? is : null }), Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: d => d.toISOString().slice(0, 10) } };
  vm.createContext(c); vm.runInContext(TO + '\n' + ['webGetTakeouts_', 'webAddTakeoutItem_'].map(n => fnSrc(WEB, n)).join('\n'), c); return c;
}

console.log('\nWe ordered');
{
  const rs = fakeSheet([['Name', 'Cuisine', 'Phone', 'Website', 'Rating', 'Notes'], ['Saffron Grill', 'Lebanese', '555-0177', '', 4, ''], ['Basil & Lime', 'Thai', '', '', 5, '']], 6);
  const is = fakeSheet([['Restaurant', 'Item', 'Description', 'Rating', 'Notes'], ['Saffron Grill', 'Mixed grill', '', 5, ''], ['Saffron Grill', 'Fattoush', '', 4, ''], ['Basil & Lime', 'Mixed grill', '', '', '']], 5);
  const c = ctx(rs, is);
  let r = c.webTakeoutOrdered_({ name: 'Saffron Grill', dishes: ['mixed grill'] });
  check('today on the restaurant, counted once, in new named columns', r.ok && rs.grid[0][6] === 'Last Ordered' && rs.grid[0][7] === 'Times Ordered' && rs.grid[1][6] === TODAY && rs.grid[1][7] === 1 && r.times === 1, J(rs.grid[1]));
  check('…and on the dish named, at that restaurant only', is.grid[0][5] === 'For' && is.grid[1][6] === TODAY && is.grid[1][7] === 1 && is.grid[2][6] === '' && is.grid[3][6] === '' && J(r.dishes) === J(['Mixed grill']), J(is.grid));
  c.webTakeoutOrdered_({ name: 'Saffron Grill', dishes: ['Mixed grill'] });
  check('twice in a day counts once', rs.grid[1][7] === 1 && is.grid[1][7] === 1);
  rs.grid[1][6] = '2026-01-02'; is.grid[1][6] = '2026-01-02';
  c.webTakeoutOrdered_({ name: 'Saffron Grill', dishes: [] });
  check('another day counts again; no dishes leaves dishes alone', rs.grid[1][7] === 2 && is.grid[1][7] === 1 && is.grid[1][6] === '2026-01-02');
  let threw = false; try { c.webTakeoutOrdered_({ name: 'Nowhere' }); } catch (e) { threw = true; }
  check('an unknown restaurant is refused', threw);
  check('who a dish is for', c.toFor_('a') === 'Ahmed' && c.toFor_('Victoria') === 'Victoria' && c.toFor_('both') === 'Both' && c.toFor_('Sam') === '' && c.toFor_('') === '');
  c.webAddTakeoutItem_({ restaurant: 'Basil & Lime', item: 'Pad see ew', 'for': 'v' });
  check('adding a dish keeps who it’s for', is.grid[4][1] === 'Pad see ew' && is.grid[4][5] === 'Victoria', J(is.grid[4]));
  c.webUpdateTakeoutItem_({ row: 3, item: 'Fattoush', 'for': 'Both', rating: 3 });
  check('updating a dish: for and stars', is.grid[2][5] === 'Both' && is.grid[2][3] === 3);
  threw = false; try { c.webUpdateTakeoutItem_({ row: 3, item: 'Hummus', rating: 1 }); } catch (e) { threw = true; }
  check('…a row that moved is refused', threw && is.grid[2][3] === 3);
  c.webUpdateTakeoutRestaurant_({ name: 'Basil & Lime', rating: 3 });
  check('stars on a restaurant', rs.grid[2][4] === 3);
  const got = c.webGetTakeouts_().restaurants;
  check('the read sends last ordered, times and for', got[0].lastOrdered === TODAY && got[0].timesOrdered === 2 && got[0].items[0].lastOrdered === '2026-01-02' && got[0].items[0].timesOrdered === 1 && got[0].items[1]['for'] === 'Both' && got[1].items[1]['for'] === 'Victoria', J(got[0]));
}

console.log('\nour usual and the order');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext("var TO_PILL_={Ahmed:'A',Victoria:'V',Both:'A+V'};\n" + ['toUsual_', 'toSorted_', 'toCuisines_', 'toLast_', 'toDish_'].map(n => fnSrc(APP, n)).join('\n'), U);
const ITEMS = [{ item: 'Pad see ew', 'for': 'Victoria', timesOrdered: 5, rating: 4 }, { item: 'Green curry', 'for': 'Ahmed', timesOrdered: 3 }, { item: 'Spring rolls', timesOrdered: 1, rating: 5 }, { item: 'Larb', timesOrdered: 2 }, { item: 'Tom yum', timesOrdered: 2, rating: 5 }];
check('our usual: ordered 2+ times, most first, at most 3', J(U.toUsual_(ITEMS).map(i => i.item)) === J(['Pad see ew', 'Green curry', 'Tom yum']));
check('…else the 4★+ ones', J(U.toUsual_([{ item: 'A', rating: 3 }, { item: 'B', rating: 5 }, { item: 'C', rating: 4 }]).map(i => i.item)) === J(['B', 'C']));
check('a dish shows who it’s for', U.toDish_(ITEMS[0]) === 'Pad see ew (V)' && U.toDish_(ITEMS[2]) === 'Spring rolls');
const RESTS = [{ name: 'Saffron Grill', cuisine: 'Lebanese', rating: 4, lastOrdered: '2026-10-30', timesOrdered: 6 }, { name: 'Basil & Lime', cuisine: 'Thai', rating: 5, lastOrdered: '2026-11-10' }, { name: 'Pie Shop', cuisine: 'Pizza', rating: 5 }, { name: 'Anchor', cuisine: 'thai', rating: 2 }];
check('last ordered first, then stars, then name', J(U.toSorted_(RESTS, 'all').map(r => r.name)) === J(['Basil & Lime', 'Saffron Grill', 'Pie Shop', 'Anchor']));
check('a cuisine chip, any case', J(U.toSorted_(RESTS, 'Thai').map(r => r.name)) === J(['Basil & Lime', 'Anchor']) && J(U.toCuisines_(RESTS)) === J(['Thai', 'Lebanese', 'Pizza']));
const NOW = new Date(2026, 10, 16);
check('last ordered', U.toLast_(RESTS[0], NOW) === 'Last ordered Oct 30 · 6 times' && U.toLast_({ lastOrdered: '2026-11-16', timesOrdered: 1 }, NOW) === 'Last ordered today' && U.toLast_({ lastOrdered: '2026-11-13' }, NOW) === 'Last ordered 3 days ago' && U.toLast_({}, NOW) === 'Never ordered');

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screen: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of [390, 1280]) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ rests }) => {
      window.__ev = [];
      document.body.innerHTML = '<div id="to" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('to')).render(React.createElement(TakeoutsView, { takeouts: rests, loading: false, busy: false,
        onAddRestaurant: d => window.__ev.push(['addRest', d.name, d.cuisine, d.phone]), onDeleteRestaurant: n => window.__ev.push(['delRest', n]), onAddItem: (r, d) => window.__ev.push(['addItem', r, d.item, d['for']]),
        onDeleteItem: row => window.__ev.push(['delItem', row]), onOrdered: (n, d) => window.__ev.push(['ordered', n, d]), onUpdateItem: (i, f) => window.__ev.push(['item', i.item, f]), onRateRestaurant: (n, r) => window.__ev.push(['rate', n, r]) }));
    }, { rests: [Object.assign({}, RESTS[0], { phone: '555-0177', website: 'saffron.example.test/menu', items: [{ row: 2, item: 'Mixed grill', timesOrdered: 4, 'for': 'Both' }, { row: 3, item: 'Fattoush', timesOrdered: 2, rating: 4 }, { row: 4, item: 'Garlic sauce', timesOrdered: 1 }] }),
      Object.assign({}, RESTS[1], { items: ITEMS.map((x, i) => Object.assign({ row: 10 + i }, x)) }), Object.assign({}, RESTS[2], { items: [] })] });
    await page.waitForTimeout(250);
    check('cuisine chips', J(await page.$$eval('#to .to-chip', ns => ns.map(n => n.textContent))) === J(['All · 3', 'Lebanese', 'Pizza', 'Thai']), J(await page.$$eval('#to .to-chip', ns => ns.map(n => n.textContent))));
    check('cards: last ordered first', J(await page.$$eval('#to .to-card', ns => ns.map(n => n.dataset.rest))) === J(['Basil & Lime', 'Saffron Grill', 'Pie Shop']));
    const card = await page.$eval('#to .to-card[data-rest="Saffron Grill"]', n => n.innerText);
    check('the card: cuisine, our usual with who, last ordered', /Lebanese · our usual: Mixed grill \(A\+V\), Fattoush/.test(card) && /Last ordered Oct 30 · 6 times/.test(card), card);
    check('…📞 calls, Menu ↗ opens the link', (await page.$eval('#to .to-card[data-rest="Saffron Grill"] .to-phone', n => n.getAttribute('href'))) === 'tel:5550177' && (await page.$eval('#to .to-card[data-rest="Saffron Grill"] .to-menu', n => n.href)) === 'https://saffron.example.test/menu');
    check('never ordered says so', /Never ordered/.test(await page.$eval('#to .to-card[data-rest="Pie Shop"]', n => n.innerText)));
    await page.click('#to .to-card[data-rest="Pie Shop"] .to-star >> nth=2');
    check('tap a star to rate', J((await page.evaluate(() => window.__ev)).pop()) === J(['rate', 'Pie Shop', 3]));
    await page.click('#to .to-chip >> text=Thai'); await page.waitForTimeout(40);
    check('the Thai chip', J(await page.$$eval('#to .to-card', ns => ns.map(n => n.dataset.rest))) === J(['Basil & Lime']));
    await page.click('#to .to-chip >> text=/^All/');
    await page.click('#to .to-card[data-rest="Saffron Grill"] .to-ordered'); await page.waitForTimeout(40);
    check('We ordered: the dishes to tick, usual ones marked', J(await page.$$eval('.to-pick', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()))) === J(['Mixed grill (A+V) usual', 'Fattoush usual', 'Garlic sauce']));
    await page.click('.to-pick >> text=Fattoush'); await page.click('.to-order-save');
    check('…records the order with what you ticked', J((await page.evaluate(() => window.__ev)).pop()) === J(['ordered', 'Saffron Grill', ['Fattoush']]) && !(await page.$('.to-sheet')));
    await page.click('#to .to-card[data-rest="Pie Shop"] .to-ordered'); await page.click('.to-order-save');
    check('…or with no dishes', J((await page.evaluate(() => window.__ev)).pop()) === J(['ordered', 'Pie Shop', []]));
    await page.click('#to .to-card[data-rest="Saffron Grill"] .to-fold'); await page.waitForTimeout(40);
    check('the dishes fold open', J(await page.$$eval('#to .to-card[data-rest="Saffron Grill"] .to-dishrow', ns => ns.map(n => n.dataset.dish))) === J(['Mixed grill', 'Fattoush', 'Garlic sauce']));
    await page.selectOption('#to .to-dishrow[data-dish="Garlic sauce"] .to-for', 'Ahmed');
    check('…who a dish is for', J((await page.evaluate(() => window.__ev)).pop()) === J(['item', 'Garlic sauce', { 'for': 'Ahmed' }]));
    await page.click('#to .to-dishrow[data-dish="Fattoush"] .to-star >> nth=4');
    check('…its stars', J((await page.evaluate(() => window.__ev)).pop()) === J(['item', 'Fattoush', { rating: 5 }]));
    await page.click('#to .to-dishrow[data-dish="Garlic sauce"] .to-x');
    check('…delete a dish', J((await page.evaluate(() => window.__ev)).pop()) === J(['delItem', 4]));
    await page.fill('#to .to-card[data-rest="Saffron Grill"] .to-dish-in', 'Hummus'); await page.selectOption('#to .to-card[data-rest="Saffron Grill"] .to-dish-for', 'Victoria'); await page.click('#to .to-card[data-rest="Saffron Grill"] .to-dish-add');
    check('…add a dish, with who it’s for', J((await page.evaluate(() => window.__ev)).pop()) === J(['addItem', 'Saffron Grill', 'Hummus', 'Victoria']));
    await page.click('#to .to-add-rest'); await page.fill('.to-in-name', 'Noodle Bar'); await page.fill('.to-in-cuisine', 'Thai'); await page.fill('.to-in-phone', '555-0100'); await page.click('.to-rest-save');
    check('＋ Add a restaurant', J((await page.evaluate(() => window.__ev)).pop()) === J(['addRest', 'Noodle Bar', 'Thai', '555-0100']));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
