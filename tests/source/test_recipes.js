// Kitchen › Recipes (Recipes.js, the recipe routes in WebApp.js, RecipeView). Pins:
//  - the photo: a page's og:image / twitter:image as an absolute https URL; a link with none is
//    marked 'none' and not fetched again; recipe_photos fills a batch; the Photo column is named;
//  - last made (on or before today) and next planned from Meal Plan, skipped dinners don't count;
//  - prep times read as minutes; the search (name, ingredient), Quick ≤ 30, cuisine, Not made lately;
//  - the screen: chips with counts, the card line, Plan it's week picker (free dinners marked,
//    past days left out, replacing asks), 🛒 Add N, Open ↗. Invented recipes.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RC = read('Recipes.js'), WEB = read('WebApp.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
function fakeSheet(rows, maxCols) {
  const grid = rows.map(r => r.slice()); let cols = maxCols || 8;
  const pad = r => { while (r.length < cols) r.push(''); return r; }; grid.forEach(pad);
  return { grid, getLastRow: () => grid.length, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; grid.forEach(pad); },
    getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
      getValue: () => (grid[r - 1] || [])[c - 1] ?? '', setValue: x => { grid[r - 1][c - 1] = x; }, setValues: v => v.forEach((row, i) => { while (grid.length < r + i) grid.push(pad([])); row.forEach((x, j) => { grid[r - 1 + i][c - 1 + j] = x; }); }) }) };
}

console.log('\nthe photo from the link');
const C = { String, Number, Math, JSON, Date, Object, RegExp, isNaN }; vm.createContext(C);
vm.runInContext(RC, C);
check('og:image, either attribute order', C.rcOgImage_('<meta property="og:image" content="https://cdn.example.test/a.jpg">', 'https://x.test/r') === 'https://cdn.example.test/a.jpg'
  && C.rcOgImage_("<meta content='https://cdn.example.test/b.jpg' property='og:image' />", 'https://x.test/r') === 'https://cdn.example.test/b.jpg');
check('twitter:image when there is no og:image', C.rcOgImage_('<meta name="twitter:image" content="https://cdn.example.test/t.png">', '') === 'https://cdn.example.test/t.png');
check('a relative or protocol-less image is made absolute https', C.rcOgImage_('<meta property="og:image" content="/img/c.jpg">', 'https://site.example.test/recipes/1') === 'https://site.example.test/img/c.jpg'
  && C.rcOgImage_('<meta property="og:image" content="//cdn.example.test/d.jpg">', '') === 'https://cdn.example.test/d.jpg' && C.rcOgImage_('<meta property="og:image" content="http://cdn.example.test/e.jpg">', '') === 'https://cdn.example.test/e.jpg');
check('no image, or a bad one, is ""', C.rcOgImage_('<html><title>x</title></html>', '') === '' && C.rcOgImage_('<meta property="og:image" content="javascript:alert(1)">', '') === '' && C.rcOgImage_('', '') === '');
check('&amp; in the URL is decoded', C.rcOgImage_('<meta property="og:image" content="https://cdn.example.test/f.jpg?w=1&amp;h=2">', '') === 'https://cdn.example.test/f.jpg?w=1&h=2');
{
  const HEAD = ['Name', 'Cuisine', 'Servings', 'Prep Time', 'Link', 'Ingredients', 'Tags', 'Notes'];
  const rows = [HEAD, ['Shawarma bowls', 'Lebanese', 4, '35 min', 'https://a.example.test/1', 'chicken; rice', '', ''], ['Pasta e ceci', 'Italian', 4, '25 min', 'https://b.example.test/2', 'pasta', '', ''], ['Toast', '', 1, '5', '', 'bread', '', '']];
  for (let i = 0; i < 9; i++) rows.push(['Dish ' + i, '', 2, '', 'https://c.example.test/' + i, '', '', '']);
  const sh = fakeSheet(rows);
  const fetched = [];
  const W = { String, Number, Math, JSON, Date, Object, RegExp, isNaN, TABS: { RECIPES: 'Recipes', MEAL_PLAN: 'Meal Plan' }, RECIPE_HEADERS: HEAD,
    getSpreadsheet: () => ({ getSheetByName: n => n === 'Recipes' ? sh : null }),
    UrlFetchApp: { fetch: u => { fetched.push(u); return { getResponseCode: () => 200, getContentText: () => /a\.example/.test(u) ? '<meta property="og:image" content="https://cdn.example.test/1.jpg">' : '<p>no image</p>' }; } } };
  vm.createContext(W); vm.runInContext(RC + '\n' + fnSrc(WEB, 'webGetRecipes_'), W);
  let r = W.webRecipePhotos_();
  check('recipe_photos fills a batch of 8, names the column, marks no-image links "none"', r.filled.length === 8 && r.left === 3 && sh.grid[0][8] === 'Photo' && sh.grid[1][8] === 'https://cdn.example.test/1.jpg' && sh.grid[2][8] === 'none' && sh.grid[3][8] === '', J(sh.grid.slice(0, 4).map(x => x[8])));
  r = W.webRecipePhotos_(); W.webRecipePhotos_();
  check('…the next call does the rest, and nothing is fetched twice', r.filled.length === 3 && r.left === 0 && fetched.length === 11 && new Set(fetched).size === 11, fetched.length);
  const got = W.webGetRecipes_().recipes;
  check('the read sends the photo, never "none"', got[0].photo === 'https://cdn.example.test/1.jpg' && got[1].photo === '' && got[2].photo === '');
}

console.log('\nlast made from Meal Plan');
{
  const rows = [{ mealName: 'Shawarma bowls', date: '2026-10-28', status: 'Planned' }, { mealName: 'shawarma bowls ', date: '2026-09-01', status: 'Planned' },
    { mealName: 'Shawarma bowls', date: '2026-11-19', status: 'Planned' }, { mealName: 'Shawarma bowls', date: '2026-11-25', status: 'Planned' },
    { mealName: 'Pasta e ceci', date: '2026-11-10', status: 'Skipped' }, { mealName: 'Pasta e ceci', date: '2026-11-16', status: 'Planned' }, { mealName: '', date: '2026-11-11' }, { mealName: 'Risotto', date: '2026-11-12', status: 'Skipped' }];
  const m = C.rcMealDates_(rows, '2026-11-16');
  check('the last day made, on or before today, and the next planned', J(m['shawarma bowls']) === J({ lastMade: '2026-10-28', nextPlanned: '2026-11-19' }), J(m['shawarma bowls']));
  check('today counts as made; a skipped dinner doesn’t', J(m['pasta e ceci']) === J({ lastMade: '2026-11-16', nextPlanned: '' }) && !m['risotto'], J(m['pasta e ceci']));
  check('the recipes read joins Meal Plan, and survives it failing', /made = rcMealDates_\(_readMealPlanRows_\(mp\)/.test(fnSrc(WEB, 'webGetRecipes_')) && /catch \(err\) \{ made = \{\}; \}/.test(fnSrc(WEB, 'webGetRecipes_')));
}

console.log('\nfilters');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext('var RC_QUICK_MIN_=30,RC_LATELY_DAYS_=60,RC_DAYS_=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];\n' + ['rcMinutes_', 'rcIngs_', 'rcDay_', 'rcAgo_', 'rcLately_', 'rcFilter_', 'rcCuisines_', 'rcShort_', 'rcLine_', 'rcPickDays_'].map(n => fnSrc(APP, n)).join('\n'), U);
check('prep times as minutes', U.rcMinutes_('35 min') === 35 && U.rcMinutes_('1 hr 15 min') === 75 && U.rcMinutes_('1h15m') === 75 && U.rcMinutes_('45') === 45 && U.rcMinutes_('1.5 hours') === 90 && U.rcMinutes_('overnight') === null && U.rcMinutes_('') === null);
const NOW = new Date(2026, 10, 16);
const R = [{ row: 2, name: 'Shawarma bowls', cuisine: 'Lebanese', servings: '4', prepTime: '35 min', ingredients: 'chicken; rice; garlic', lastMade: '2026-10-28', link: 'https://a.example.test/1' },
  { row: 3, name: 'Pasta e ceci', cuisine: 'Italian', servings: '4', prepTime: '25 min', ingredients: 'pasta; chickpeas', lastMade: '' },
  { row: 4, name: 'Lentil soup', cuisine: 'Lebanese', prepTime: '1 hr', ingredients: 'lentils; onion', lastMade: '2026-08-01' },
  { row: 5, name: 'Risotto', cuisine: 'Italian', prepTime: '40 min', ingredients: 'rice', lastMade: '2026-01-01', nextPlanned: '2026-11-19' },
  { row: 6, name: 'Toast', cuisine: '', prepTime: '5', ingredients: '' }];
const ids = l => l.map(r => r.row).join();
check('search: name, ingredient', ids(U.rcFilter_(R, 'rice', 'all', NOW)) === '2,5' && ids(U.rcFilter_(R, 'PASTA', 'all', NOW)) === '3');
check('Quick ≤ 30 min', ids(U.rcFilter_(R, '', 'quick', NOW)) === '3,6');
check('a cuisine', ids(U.rcFilter_(R, '', 'c:Lebanese', NOW)) === '2,4');
check('Not made lately: never, or 60+ days, and not planned', ids(U.rcFilter_(R, '', 'lately', NOW)) === '3,4,6');
check('cuisine chips, most first', J(U.rcCuisines_(R)) === J(['Italian', 'Lebanese']));
check('the card line', U.rcLine_(R[0], NOW) === '35 min · serves 4 · 3 ingredients · last made Oct 28' && /never planned$/.test(U.rcLine_(R[1], NOW)) && /^40 min · 1 ingredient · planned Thu, Nov 19$/.test(U.rcLine_(R[3], NOW)), U.rcLine_(R[3], NOW));
const days = U.rcPickDays_([{ weekStart: '2026-11-16', days: [{ day: 'Mon', mealName: 'Tacos' }, { day: 'Wed', mealName: '' }] }, { weekStart: '2026-11-23', days: [] }], new Date(2026, 10, 17, 15));
check('the picker: from today, two weeks, dinners and free days', days.length === 13 && days[0].day === 'Tue' && days[0].today && days[0].free && days[1].day === 'Wed' && days[1].free && days[12].day === 'Sun' && days[12].weekStart === '2026-11-23', J(days.slice(0, 2)));
check('…a planned day carries its dinner', U.rcPickDays_([{ weekStart: '2026-11-16', days: [{ day: 'Mon', mealName: 'Tacos' }] }], NOW)[0].meal === 'Tacos' && !U.rcPickDays_([{ weekStart: '2026-11-16', days: [{ day: 'Mon', mealName: 'Tacos' }] }], NOW)[0].free);
check('Plan it writes the dinner to Meal Plan', /action:'set_meal',weekStart,day,mealName:r\.name,type:'Home Cooked'/.test(APP));

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
    await page.evaluate(({ recipes }) => {
      window.__ev = []; window.__confirm = true; window.confirm = () => { window.__ev.push(['confirm']); return window.__confirm; };
      const t = new Date(); const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const mon = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
      const next = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7);
      window.__weeks = { weeks: [{ weekStart: iso(mon), days: [] }, { weekStart: iso(next), days: [{ day: 'Tue', mealName: 'Tacos' }] }] };
      const shift = n => iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - n));
      const list = recipes.map(r => Object.assign({}, r, { lastMade: r.lastMade === 'recent' ? shift(10) : r.lastMade === 'old' ? shift(100) : r.lastMade }));
      document.body.innerHTML = '<div id="rc" style="padding:0 16px"></div>';
      const root = ReactDOM.createRoot(document.getElementById('rc'));
      root.render(React.createElement(RecipeView, { recipes: list, loading: false, busy: false, onAddToShopping: (row, n) => window.__ev.push(['shop', row, n]),
        onPlan: (r, ws, d) => window.__ev.push(['plan', r.name, ws, d]), onLoadWeeks: () => Promise.resolve(window.__weeks), onFetchPhotos: () => window.__ev.push(['photos']) }));
    }, { recipes: [Object.assign({}, R[0], { lastMade: 'recent', photo: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }), R[1], Object.assign({}, R[2], { lastMade: 'old' }), R[4]] });
    await page.waitForTimeout(250);
    check('no photo fetch when every linked recipe has one', J(await page.evaluate(() => window.__ev)) === J([]));
    const chips = await page.$$eval('#rc .rc-chip', ns => ns.map(n => n.textContent));
    check('chips: All, Quick, cuisines, Not made lately, with counts', J(chips) === J(['All · 4', 'Quick ≤ 30 min · 2', 'Lebanese · 2', 'Italian · 1', 'Not made lately · 3']), J(chips));
    check('cards in name order, a photo or a plate', J(await page.$$eval('#rc .rc-card', ns => ns.map(n => n.dataset.recipe))) === J(['Lentil soup', 'Pasta e ceci', 'Shawarma bowls', 'Toast'])
      && !!(await page.$('#rc .rc-card[data-recipe="Shawarma bowls"] img.rc-photo')) && !!(await page.$('#rc .rc-card[data-recipe="Toast"] .rc-photo.none')));
    check('the card says when it was last made', /35 min · serves 4 · 3 ingredients · last made /.test(await page.$eval('#rc .rc-card[data-recipe="Shawarma bowls"] .rc-line', n => n.textContent)));
    await page.fill('#rc .rc-search', 'chickpea'); await page.waitForTimeout(40);
    check('the search finds an ingredient', J(await page.$$eval('#rc .rc-card', ns => ns.map(n => n.dataset.recipe))) === J(['Pasta e ceci']));
    await page.fill('#rc .rc-search', ''); await page.click('#rc .rc-chip >> text=/^Not made lately/'); await page.waitForTimeout(40);
    check('Not made lately', J(await page.$$eval('#rc .rc-card', ns => ns.map(n => n.dataset.recipe))) === J(['Lentil soup', 'Pasta e ceci', 'Toast']));
    await page.click('#rc .rc-chip >> text=/^Not made lately/'); await page.waitForTimeout(40);
    check('…tapping it again shows all', (await page.$$('#rc .rc-card')).length === 4);
    await page.click('#rc .rc-card[data-recipe="Shawarma bowls"] .rc-shop');
    check('🛒 Add 3 to the list', J((await page.evaluate(() => window.__ev)).pop()) === J(['shop', 2, 'Shawarma bowls']) && (await page.$eval('#rc .rc-card[data-recipe="Toast"] .rc-shop', n => n.disabled)));
    await page.click('#rc .rc-card[data-recipe="Pasta e ceci"] .rc-plan'); await page.waitForTimeout(120);
    const pick = await page.$$eval('.rc-dayb', ns => ns.map(n => [n.dataset.day.split(':')[1], n.classList.contains('free'), n.querySelector('small').textContent]));
    const wk = await page.evaluate(() => window.__weeks.weeks.map(w => w.weekStart));
    check('Plan it: the days from today to next Sunday, free ones marked', pick.length >= 7 && pick.length <= 14 && pick[pick.length - 1][0] === 'Sun' && pick.some(p => p[0] === 'Tue' && !p[1] && p[2] === 'Tacos') && pick.filter(p => p[1]).length === pick.length - 1, J(pick));
    check('…and says how many are free', new RegExp((pick.length - 1) + ' free dinners').test(await page.$eval('.rc-sheet', n => n.innerText)));
    await page.click('.rc-dayb[data-day="' + wk[1] + ':Tue"]'); await page.waitForTimeout(40);
    let ev = await page.evaluate(() => window.__ev);
    check('…a planned day asks before replacing it', J(ev.slice(-2)) === J([['confirm'], ['plan', 'Pasta e ceci', wk[1], 'Tue']]), J(ev.slice(-2)));
    await page.click('#rc .rc-card[data-recipe="Pasta e ceci"] .rc-plan'); await page.waitForTimeout(120);
    await page.click('.rc-dayb[data-day="' + wk[1] + ':Sun"]'); await page.waitForTimeout(40);
    ev = await page.evaluate(() => window.__ev);
    check('…a free day plans it straight away', J(ev.slice(-1)) === J([['plan', 'Pasta e ceci', wk[1], 'Sun']]) && ev[ev.length - 2][0] !== 'confirm' && !(await page.$('.rc-sheet')));
    check('Open ↗ goes to the link in a new tab', (await page.$eval('#rc .rc-card[data-recipe="Shawarma bowls"] .rc-open', n => n.target + ' ' + n.href)) === '_blank https://a.example.test/1');
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    const ev = await page.evaluate(({ r }) => { window.__ev = []; document.body.innerHTML = '<div id="rc"></div>';
      ReactDOM.createRoot(document.getElementById('rc')).render(React.createElement(RecipeView, { recipes: [r], loading: false, busy: false, onAddToShopping() {}, onFetchPhotos: () => window.__ev.push('photos') }));
      return new Promise(res => setTimeout(() => res(window.__ev), 200)); }, { r: R[0] });
    check('a linked recipe with no photo asks for photos once', J(ev) === J(['photos']), J(ev));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
