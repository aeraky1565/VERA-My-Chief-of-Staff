// Kitchen › Pantry: ✓ Used it / Still have some on Running out soon, and the smarter guesses
// (Pantry.js getDepletionRate_, pantryPredict_, webPantryUsed_; PantryView). Pins:
//  - buys a couple of days apart are one restock (no more "every ~1 days");
//  - Used it counts last restock → run-out day as the newest gap, and the item is out now;
//  - Still have some pushes the guess out a third of its cycle (at least 2 days);
//  - out longer than max(7 days, its cycle) is "not bought lately": off Running out soon and
//    never put on the list by itself;
//  - one purchase guesses from the aisle (bread ~5 days), not a flat 30;
//  - pantry_used saves to the VERA State store, puts a staple that ran out on the list, and is routed;
//  - the screen: both buttons on Running out soon, Used it turns the row to out, Still have some
//    moves it off, and a stale item sits in its aisle tagged. Invented items.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PA = read('Pantry.js'), WEB = read('WebApp.js'), SET = read('Settings.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const TODAY = '2026-11-25';

// rows: [item, date, store]
function ctx(rows, opts) {
  opts = opts || {};
  const data = rows.map((r, i) => ['PH-' + i, r[0], r[0], '', r[1], '', '', r[2] || 'Costco', '', 'test', '']);
  const c = { String, Number, Math, JSON, Date, Object, RegExp, Array, isNaN, parseInt, parseFloat, Logger: { log() {} },
    PURCHASE_HISTORY_HEADERS: new Array(11).fill('h'), store: Object.assign({}, opts.store || {}), added: [],
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => f === 'yyyy-MM-dd' && opts.realDates ? d.toISOString().slice(0, 10) : (f === 'yyyy-MM-dd' ? TODAY : d.toISOString().slice(0, 10)) } };
  c.getConfigValues = () => Object.assign({ pantry_enabled: 'true' }, opts.cfg || {});
  c.veraStoreGet_ = k => c.store[k] == null ? null : c.store[k];
  c.veraStoreSet_ = (k, v) => { c.store[k] = v; return true; };
  c.getShoppingList_ = () => opts.lists || [{ tabId: 't1', storeName: 'Costco', items: [] }];
  c.addShoppingItem_ = (tab, text) => { c.added.push([tab, text]); return { ok: true }; };
  vm.createContext(c); vm.runInContext(PA, c);
  c.getPurchaseHistorySheet_ = () => ({ getLastRow: () => data.length + 1, getRange: (r0, col, n, w) => ({ getValues: () => data.map(r => r.slice(col - 1, col - 1 + w)) }) });
  return c;
}
const use = u => ({ PANTRY_USAGE: J(u) });

console.log('\nrestocks, not rows');
{
  const c = ctx([['bread', '2026-10-01'], ['bread', '2026-10-02'], ['bread', '2026-10-08'], ['bread', '2026-10-09'], ['bread', '2026-10-15']]);
  const r = c.getDepletionRate_('bread', {});
  check('buys a day apart merge: every ~7 days, not ~1', r.avgDays === 7, J(r));
  check('…confidence counts restocks (3 restocks, 2 gaps: getting there)', r.confidence === 'building', r.confidence);
  check('pantryRestocks_ keeps the first day of each restock', J(c.pantryRestocks_(['2026-10-03', '2026-10-01', '2026-10-02', '2026-10-06'])) === J(['2026-10-01', '2026-10-06']));
}

console.log('\nfirst guesses');
{
  const c = ctx([['sourdough bread', '2026-11-20'], ['frozen peas', '2026-11-20'], ['milk', '2026-11-20'], ['mystery thing', '2026-11-20']]);
  check('one purchase of bread guesses its aisle (Bakery ~5)', c.getDepletionRate_('sourdough bread', {}).avgDays === 5);
  check('…frozen ~21, an item’s own default still wins (milk 7), unknown 30', c.getDepletionRate_('frozen peas', {}).avgDays === 21 && c.getDepletionRate_('milk', {}).avgDays === 7 && c.getDepletionRate_('mystery thing', {}).avgDays === 30);
}

console.log('\n✓ Used it');
{
  const rows = [['olive oil', '2026-09-01'], ['olive oil', '2026-10-01'], ['olive oil', '2026-11-01']];
  const c = ctx(rows);
  check('before: every ~30 days', c.getDepletionRate_('olive oil', {}).avgDays === 30);
  const u = { 'olive oil': { used: '2026-11-11' } };
  const r = c.getDepletionRate_('olive oil', u);
  check('used 10 days after buying pulls the rate down (newest gap weighs most)', r.avgDays < 30 && r.avgDays >= 20, r.avgDays);
  const p = c.pantryPredict_('olive oil', u, TODAY);
  check('…and it is out now', p.out === true && p.daysUntil <= 0 && p.estimatedNext === '2026-11-11', J(p));
  const old = c.pantryPredict_('olive oil', { 'olive oil': { used: '2026-10-20' } }, TODAY);
  check('a used date before the last purchase is an old cycle: not out', old.out === false);
}

console.log('\nStill have some');
{
  const c = ctx([['yogurt', '2026-11-04'], ['yogurt', '2026-11-11'], ['yogurt', '2026-11-18']]);
  const before = c.pantryPredict_('yogurt', {}, TODAY);
  check('before: out today', before.estimatedNext === '2026-11-25' && before.daysUntil === 0, J(before));
  const after = c.pantryPredict_('yogurt', { yogurt: { have: TODAY } }, TODAY);
  check('still have some today: a third of 7 days, at least 2, from today', after.estimatedNext === '2026-11-27' && after.daysUntil === 2, J(after));
  check('…a cycle of 30 hides 10 days', c.pantryHaveDays_(30) === 10 && c.pantryHaveDays_(3) === 2);
}

console.log('\nnot bought lately');
{
  const c = ctx([['bread', '2026-10-25'], ['bread', '2026-11-01'], ['bread', '2026-11-08'], ['milk', '2026-11-12'], ['milk', '2026-11-19']], { cfg: { pantry_staples: 'bread, milk' } });
  const p = c.pantryPredict_('bread', {}, TODAY);
  check('out 10 days on a 7-day cycle: stale', p.daysUntil === -10 && p.stale === true, J(p));
  check('out 3 days: not stale', c.pantryPredict_('milk', {}, '2026-11-29').stale === false);
  const due = c.getItemsDue_(7).map(i => i.normalized);
  check('stale items aren’t due (so a staple isn’t re-added every night)', J(due) === J(['milk']), J(due));
  const st = c.getPurchaseStats_().reduce((o, i) => (o[i.normalized] = i, o), {});
  check('stats carry stale and out', st.bread.stale === true && st.milk.stale === false && st.milk.out === false);
}

console.log('\npantry_used');
{
  const c = ctx([['milk', '2026-11-12'], ['milk', '2026-11-19'], ['rice', '2026-11-01']], { cfg: { pantry_staples: 'milk' }, store: use({ milk: { have: '2026-11-20' } }) });
  let r = c.webPantryUsed_({ parameter: { name: 'Milk', kind: 'used' } });
  const saved = JSON.parse(c.store.PANTRY_USAGE);
  check('used: saved today, the old Still have some cleared', saved.milk.used === TODAY && !saved.milk.have && r.ok && r.date === TODAY, c.store.PANTRY_USAGE);
  check('…a staple that ran out goes on the list now', J(c.added) === J([['t1', 'milk']]) && r.onList === 'Costco', J(c.added));
  r = c.webPantryUsed_({ parameter: { name: 'rice', kind: 'have' } });
  check('have: saved, not added, and the new guess comes back', JSON.parse(c.store.PANTRY_USAGE).rice.have === TODAY && c.added.length === 1 && r.daysUntil === 10, J(r));
  let threw = ''; try { c.webPantryUsed_({ parameter: { name: 'rice', kind: 'eaten' } }); } catch (e) { threw = e.message; }
  check('an unknown kind is refused', /kind/.test(threw));
  const bad = ctx([['rice', '2026-11-01']], { store: { PANTRY_USAGE: '{nope' } });
  check('a broken store reads as nothing', J(bad.pantryUsage_()) === '{}');
}

console.log('\nthe pantry read');
{
  const c = ctx([['bread', '2026-11-01']]);
  c.getPurchaseStats_ = () => [{ normalized: 'bread', lastStore: 'Costco', estimatedNext: '2026-11-08', avgDays: 7, stale: true }, { normalized: 'milk', lastStore: 'Target', estimatedNext: '2026-11-15', avgDays: 7, stale: false }];
  c.getCurrentWeekStart_ = () => '2026-11-23'; c.ohWeek_ = () => [];
  const m = c.webPantry_().items.reduce((o, i) => (o[i.normalized] = i, o), {});
  check('a stale item has no days left, so it isn’t running out soon', m.bread.daysUntil === null && m.bread.store === '' && m.milk.daysUntil !== null, J(m));
}

console.log('\nwiring');
check('route pantry_used', /case 'pantry_used':\s*return jsonOut_\(webPantryUsed_\(e\)\)/.test(WEB));
check('PANTRY_USAGE is a VERA State key', /'PANTRY_USAGE'/.test(SET.match(/VERA_STORE_KEYS_\s*=\s*\[[^\]]*\]/)[0]));

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
const ROOT_PAGES = process.env.VERA_PAGES_ROOT || ROOT;
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screen: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ITEMS = [
    { normalized: 'bread', aisle: 'Bakery', avgDays: 7, lastDate: '2026-11-08', lastStore: 'Costco', estimatedNext: '2026-11-15', daysUntil: null, stale: true, confidence: 'building' },
    { normalized: 'milk', aisle: 'Dairy & Eggs', avgDays: 7, lastDate: '2026-11-19', lastStore: 'Target', estimatedNext: '2026-11-26', daysUntil: 1, store: 'Target', confidence: 'calibrated' },
    { normalized: 'yogurt', aisle: 'Dairy & Eggs', avgDays: 7, lastDate: '2026-11-20', lastStore: 'Target', estimatedNext: '2026-11-27', daysUntil: 2, store: 'Target', confidence: 'learning' },
    { normalized: 'rice', aisle: 'Pantry', avgDays: 30, lastDate: '2026-11-01', lastStore: 'Costco', estimatedNext: '2026-12-01', daysUntil: 6, store: 'Costco', confidence: 'learning', onList: 'Costco' }];
  for (const width of [390, 1280]) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT_PAGES, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ items }) => {
      window.__ev = [];
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'pantry') return Promise.resolve({ ok: true, items, daysAhead: 7, stores: ['Costco', 'Target'], onHand: [] });
        if (p.action === 'pantry_used') return Promise.resolve(p.kind === 'used' ? { ok: true, date: '2026-11-25' } : { ok: true, date: '2026-11-25', daysUntil: 9, estimatedNext: '2026-12-04' });
        return Promise.resolve({ ok: true }); };
      document.body.innerHTML = '<div id="pa" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('pa')).render(React.createElement(PantryView, { apiUrl: 'u', apiToken: 't' }));
    }, { items: ITEMS });
    await page.waitForTimeout(300);
    const soon = () => page.$$eval('#pa .pa-row.soon', ns => ns.map(n => n.dataset.item));
    check('a stale item isn’t in Running out soon', J(await soon()) === J(['milk', 'yogurt', 'rice']), J(await soon()));
    check('each Running out soon row has ✓ Used it and Still have some', (await page.$$('#pa .pa-row.soon .pa-used2')).length === 3 && (await page.$$('#pa .pa-row.soon .pa-have')).length === 3);
    await page.click('#pa .pa-row[data-item="milk"] .pa-used2'); await page.waitForTimeout(80);
    const milk = await page.$eval('#pa .pa-row[data-item="milk"]', n => n.innerText).catch(() => '');
    check('Used it sends pantry_used used, and the row says out with Add still there', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'pantry_used', name: 'milk', kind: 'used' }) && /\bout\b/.test(milk) && !!(await page.$('#pa .pa-row[data-item="milk"] .pa-add')) && !(await page.$('#pa .pa-row[data-item="milk"] .pa-used2')), milk);
    await page.click('#pa .pa-row[data-item="yogurt"] .pa-have'); await page.waitForTimeout(80);
    check('Still have some sends have and moves it off Running out soon', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'pantry_used', name: 'yogurt', kind: 'have' }) && J(await soon()) === J(['milk', 'rice']) && /Still have yogurt/.test(await page.$eval('#pa', n => n.innerText)));
    await page.click('#pa .pa-fold >> text=/Bakery/'); await page.waitForTimeout(40);
    check('the stale item sits in its aisle, tagged not bought lately, no next date', /not bought lately/.test(await page.$eval('#pa .pa-row[data-item="bread"]', n => n.innerText)) && !/next ~/.test(await page.$eval('#pa .pa-row[data-item="bread"]', n => n.innerText)));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
