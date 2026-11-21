// Kitchen › Pantry (Pantry.js: pantry, pantry_staple, pantry_add, autoRestockItems_; PantryView). Pins:
//  - only staples restock by themselves at night; the rest wait for a tap;
//  - staples live in Config pantry_staples, normalized, added and removed;
//  - a list line ('🤖 milk (est. ~Oct 30)') counts as that item being on the list; checked-off lines don't;
//  - pantry_add uses the usual store, falls back to the first list, and never adds a duplicate;
//  - the screen: counters, Running out soon first with 🛒 Add to <store> or ✓ On the list, the rest
//    by aisle (folded, search), ☆ staples. Invented items.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PA = read('Pantry.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }

function ctx(cfg, lists, due) {
  const c = { String, Number, Math, JSON, Date, Object, RegExp, isNaN, parseInt, Logger: { log() {} }, cfg: Object.assign({}, cfg), added: [], configWrites: [],
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: (d, tz, f) => f === 'MMM d' ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : d.toISOString().slice(0, 10) } };
  c.getConfigValues = () => c.cfg;
  c.setConfigRow_ = (k, v) => { c.cfg[k] = v; c.configWrites.push([k, v]); return true; };
  c.getShoppingList_ = () => lists;
  c.addShoppingItem_ = (tab, text) => { c.added.push([tab, text]); return { ok: true }; };
  vm.createContext(c);
  vm.runInContext(PA, c);
  c.getItemsDue_ = () => due || [];
  return c;
}
const LISTS = [{ tabId: 't1', storeName: 'Costco', items: [{ text: '🤖 paper towels (est. ~Nov 20)', done: false }, { text: 'Eggs', done: true }] },
  { tabId: 't2', storeName: 'Target', items: [{ text: '2x Dish soap', done: false }] }];

console.log('\nstaples restock by themselves; the rest wait');
{
  const due = [{ normalized: 'olive oil', estimatedEmpty: '2026-11-19', store: 'Costco' }, { normalized: 'milk', estimatedEmpty: '2026-11-18', store: 'Target' }, { normalized: 'paper towels', estimatedEmpty: '2026-11-20', store: 'Costco' }];
  const c = ctx({ pantry_enabled: 'true', pantry_staples: 'Milk, paper towels' }, LISTS, due);
  c.autoRestockItems_();
  check('only the staple that isn’t on a list yet is added', J(c.added) === J([['t2', '🤖 milk (est. ~Nov 18)']]), J(c.added));
  const c2 = ctx({ pantry_enabled: 'true' }, LISTS, due); c2.autoRestockItems_();
  check('no staples: nothing is added by itself', c2.added.length === 0);
  check('staples read normalized', J(c.pantryStaples_({ pantry_staples: ' Milk ,, Olive Oil' })) === J(['milk', 'olive oil']));
}

console.log('\nstaples on and off');
{
  const c = ctx({ pantry_staples: 'milk' }, LISTS);
  let r = c.webPantryStaple_({ parameter: { name: 'Olive Oil', on: 'true' } });
  check('marking a staple adds it, sorted', r.staple && c.cfg.pantry_staples === 'milk, olive oil', c.cfg.pantry_staples);
  c.webPantryStaple_({ parameter: { name: 'olive oil', on: 'true' } });
  check('…twice is still once', c.cfg.pantry_staples === 'milk, olive oil');
  r = c.webPantryStaple_({ parameter: { name: 'milk', on: 'false' } });
  check('unmarking removes it', !r.staple && c.cfg.pantry_staples === 'olive oil');
}

console.log('\non a list, and adding');
{
  const c = ctx({}, LISTS);
  check('a list line is the item: VERA’s 🤖 lines and quantities read as the name', c.pantryLineName_('🤖 paper towels (est. ~Nov 20)') === 'paper towels' && c.pantryLineName_('2x Dish soap') === 'dish soap');
  const on = c.pantryOnLists_(LISTS);
  check('what’s on which list; checked-off lines don’t count', on['paper towels'] === 'Costco' && on['dish soap'] === 'Target' && !on.eggs, J(on));
  let r = c.webPantryAdd_({ parameter: { name: 'Olive oil', store: 'target' } });
  check('adding goes to the usual store', r.store === 'Target' && !r.already && J(c.added) === J([['t2', 'olive oil']]));
  r = c.webPantryAdd_({ parameter: { name: 'butter', store: 'Gone Market' } });
  check('…an unknown store falls back to the first list', r.store === 'Costco' && c.added[1][0] === 't1');
  r = c.webPantryAdd_({ parameter: { name: 'Dish soap', store: 'Costco' } });
  check('…already on a list: nothing added, and says where', r.already && r.store === 'Target' && c.added.length === 2);
}

console.log('\nthe pantry read');
{
  const c = ctx({ pantry_staples: 'milk', pantry_restock_days_ahead: '7' }, LISTS);
  const today = new Date().toISOString().slice(0, 10), plus = n => new Date(Date.parse(today) + n * 864e5).toISOString().slice(0, 10);
  c.getPurchaseStats_ = () => [{ normalized: 'milk', lastStore: 'Target', estimatedNext: plus(2), avgDays: 7 }, { normalized: 'paper towels', lastStore: 'Costco', estimatedNext: plus(20), avgDays: 30 }, { normalized: 'rice', lastStore: 'Costco', estimatedNext: '', avgDays: 30 }];
  c.getCurrentWeekStart_ = () => '2026-11-16'; c.ohWeekAsked = '';
  c.ohWeek_ = ws => { c.ohWeekAsked = ws; return [{ id: 'OH-1', item: 'Spinach', useSoon: true, status: 'on hand', added: '2026-11-15', source: 'receipt' }, { id: 'OH-2', item: 'Rice', status: 'pending' }, { id: 'OH-3', item: 'Feta', status: 'used' }]; };
  const r = c.webPantry_();
  check('…and this week’s food on hand, only what’s still on hand', c.ohWeekAsked === '2026-11-16' && J(r.onHand) === J([{ id: 'OH-1', item: 'Spinach', useSoon: true, added: '2026-11-15' }]), J(r.onHand));
  const m = r.items.reduce((o, i) => (o[i.normalized] = i, o), {});
  check('each item: aisle, staple, on a list, days until', m.milk.aisle === 'Dairy & Eggs' && m.milk.staple && m.milk.daysUntil === 2 && m.milk.store === 'Target' && m['paper towels'].onList === 'Costco' && m['paper towels'].store === '' && m.rice.daysUntil === null && m.rice.aisle === 'Pantry', J(r.items));
  check('…and the stores and window', J(r.stores) === J(['Costco', 'Target']) && r.daysAhead === 7);
  const c2 = ctx({}, LISTS); c2.getShoppingList_ = () => { throw new Error('no doc'); }; c2.getPurchaseStats_ = () => [{ normalized: 'milk', estimatedNext: '' }];
  let r2; try { r2 = c2.webPantry_(); } catch (e) { r2 = { error: e.message }; }
  check('a list failure doesn’t cost the pantry', r2.ok && r2.items.length === 1 && r2.listError === 'no doc');
  check('…nor does an on-hand failure', r2.ok && !r2.onHand && !!r2.onHandError, J(r2));
}

console.log('\nrunning out and by aisle');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext("var PA_AISLES_=['Produce','Meat & Fish','Dairy & Eggs','Bakery','Pantry','Frozen','Household','Other'];\n" + ['paSoon_', 'paByAisle_', 'paCounts_', 'paWhen_'].map(n => fnSrc(APP, n)).join('\n'), U);
const ITEMS = [{ normalized: 'olive oil', aisle: 'Pantry', daysUntil: 3, avgDays: 24, lastDate: '2026-10-26', lastStore: 'Costco', store: 'Costco', confidence: 'calibrated' },
  { normalized: 'paper towels', aisle: 'Household', daysUntil: 5, avgDays: 30, lastDate: '2026-10-21', lastStore: 'Target', store: 'Target', onList: 'Target' },
  { normalized: 'milk', aisle: 'Dairy & Eggs', daysUntil: -1, avgDays: 7, lastStore: 'Target', store: 'Target', staple: true },
  { normalized: 'rice', aisle: 'Pantry', daysUntil: 20, avgDays: 30 }, { normalized: 'bananas', aisle: 'Produce', daysUntil: 9, avgDays: 6 }, { normalized: 'flour', aisle: 'Pantry', daysUntil: null, avgDays: 60 }, { normalized: 'gadget', aisle: 'Weird', daysUntil: 40, avgDays: 90 }];
check('running out: within the window or already out, soonest first', J(U.paSoon_(ITEMS, 7).map(i => i.normalized)) === J(['milk', 'olive oil', 'paper towels']));
check('the rest by aisle in walking order, unknown aisles as Other', J(U.paByAisle_(ITEMS, 7, '').map(g => g.aisle + ':' + g.items.map(i => i.normalized).join('+'))) === J(['Produce:bananas', 'Pantry:flour+rice', 'Other:gadget']));
check('…a search looks at everything', J(U.paByAisle_(ITEMS, 7, 'oil').map(g => g.items.map(i => i.normalized).join())) === J(['olive oil']));
check('counters', J(U.paCounts_(ITEMS, 7)) === J({ soon: 3, tracked: 7, onList: 1 }));
check('when it runs out', U.paWhen_(3) === '~3 days' && U.paWhen_(0) === '~today' && U.paWhen_(-1) === 'out ~1 day ago');

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
    await page.evaluate(({ items }) => {
      window.__ev = [];
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'pantry') return Promise.resolve({ ok: true, items, daysAhead: 7, stores: ['Costco', 'Target'], onHand: [{ id: 'OH-1', item: 'Spinach', useSoon: true, added: '2026-11-15' }, { id: 'OH-2', item: 'Feta', useSoon: false, added: '' }] });
        if (p.action === 'pantry_add') return Promise.resolve({ ok: true, store: p.store || 'Costco', already: false }); return Promise.resolve({ ok: true }); };
      document.body.innerHTML = '<div id="pa" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('pa')).render(React.createElement(PantryView, { apiUrl: 'u', apiToken: 't' }));
    }, { items: ITEMS });
    await page.waitForTimeout(300);
    const counts = await page.$$eval('#pa .pa-count', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
    check('counters: running out, tracked, on the list', J(counts) === J(['3 Running out ≤ 7 d', '7 Tracked', '1 On the list']), J(counts));
    check('On hand now sits on top, with each food', J(await page.$$eval('#pa .pa-oh', ns => ns.map(n => n.dataset.oh))) === J(['OH-1', 'OH-2']) && /On hand now · 2/i.test(await page.$eval('#pa', n => n.innerText)) && /use soon/.test(await page.$eval('#pa .pa-oh[data-oh="OH-1"]', n => n.innerText)));
    await page.click('#pa .pa-oh[data-oh="OH-1"] .pa-used'); await page.waitForTimeout(80);
    check('✓ Used it marks it used and drops it from the list', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'onhand_set', id: 'OH-1', status: 'used' }) && !(await page.$('#pa .pa-oh[data-oh="OH-1"]')) && /Marked used: Spinach/.test(await page.$eval('#pa', n => n.innerText)));
    await page.click('#pa .pa-oh[data-oh="OH-2"] .pa-gone'); await page.waitForTimeout(80);
    check('× takes it off on hand without calling it used', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'onhand_set', id: 'OH-2', status: 'removed' }) && !(await page.$('#pa .pa-oh')));
    check('Running out soon first, soonest first', J(await page.$$eval('#pa .pa-row.soon', ns => ns.map(n => n.dataset.item))) === J(['milk', 'olive oil', 'paper towels']));
    check('…on a list says so instead of Add', /✓ On the Target list/.test(await page.$eval('#pa .pa-row[data-item="paper towels"]', n => n.innerText)) && !(await page.$('#pa .pa-row[data-item="paper towels"] .pa-add')));
    check('…Add names the usual store and the confidence', (await page.$eval('#pa .pa-row[data-item="olive oil"] .pa-add', n => n.textContent)) === '🛒 Add to Costco' && /high confidence/.test(await page.$eval('#pa .pa-row[data-item="olive oil"]', n => n.innerText)));
    await page.click('#pa .pa-row[data-item="olive oil"] .pa-add'); await page.waitForTimeout(80);
    check('one tap adds it to that store, then shows ✓', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'pantry_add', name: 'olive oil', store: 'Costco' }) && /✓ On the Costco list/.test(await page.$eval('#pa .pa-row[data-item="olive oil"]', n => n.innerText)));
    check('the rest is folded by aisle', J(await page.$$eval('#pa .pa-fold', ns => ns.map(n => n.textContent))) === J(['▸ Produce · 1', '▸ Pantry · 2', '▸ Other · 1']) && !(await page.$('#pa .pa-row[data-item="rice"]')));
    await page.click('#pa .pa-fold >> text=/Pantry · 2/'); await page.waitForTimeout(40);
    check('…an aisle opens', J(await page.$$eval('#pa .pa-aisle[data-aisle="Pantry"] .pa-row', ns => ns.map(n => n.dataset.item))) === J(['flour', 'rice']));
    await page.click('#pa .pa-row[data-item="milk"] .pa-star'); await page.waitForTimeout(40);
    check('☆ unmarks a staple', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'pantry_staple', name: 'milk', on: false }) && (await page.$eval('#pa .pa-row[data-item="milk"] .pa-star', n => n.textContent)) === '☆');
    await page.click('#pa .pa-row[data-item="rice"] .pa-star'); await page.waitForTimeout(40);
    check('…and marks one', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'pantry_staple', name: 'rice', on: true }) && (await page.$eval('#pa .pa-row[data-item="rice"] .pa-star', n => n.getAttribute('aria-pressed'))) === 'true');
    await page.fill('#pa .pa-search', 'banan'); await page.waitForTimeout(40);
    check('the search opens what it finds', J(await page.$$eval('#pa .pa-aisle .pa-row', ns => ns.map(n => n.dataset.item))) === J(['bananas']));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
