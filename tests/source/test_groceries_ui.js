// Grocery runs in both dashboards: the "This run" step in Done shopping (with a
// receipt, without one, at a store that asks) and the Groceries card in Finances.
// The Shopping tab and the card are mounted for real with a fake server.
// Invented stores, cards and amounts.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;
const APP = fs.readFileSync(path.resolve(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); return i === -1 || j === -1 ? null : s.slice(i, j); };
console.log('\nthe shared blocks');
check('the Shopping block matches in both dashboards', !!cut(APP, '// ---- ShopList (Shopping tab)', '// ---- /ShopList ----') &&
      cut(APP, '// ---- ShopList (Shopping tab)', '// ---- /ShopList ----') === cut(LITE, '// ---- ShopList (Shopping tab)', '// ---- /ShopList ----'));
check('the Groceries card matches', !!cut(APP, '// ---- GroceriesCard', '// ---- end GroceriesCard ----') &&
      cut(APP, '// ---- GroceriesCard', '// ---- end GroceriesCard ----') === cut(LITE, '// ---- GroceriesCard', '// ---- end GroceriesCard ----'));
check('Shopping knows whose dashboard it is', /createElement\(ShoppingTab,\{grocery:\{apiUrl:apiUrl,apiToken:apiToken,who:'Ahmed'\}/.test(APP) && /grocery=\{\{ apiUrl, apiToken, who: 'Victoria' \}\}/.test(LITE));
check('Finances › Summary shows the card in both (behind the Groceries line’s Details)', /groceriesCard:React\.createElement\(GroceriesCard,\{apiUrl:apiUrl,apiToken:apiToken,who:'Ahmed'\}\)/.test(APP) &&
      /groceriesCard=\{<GroceriesCard apiUrl=\{apiUrl\} apiToken=\{apiToken\} who="Victoria" \/>\}/.test(LITE));

const SETUP = s => ({ ok: true, store: s, counts: s === 'Store B' ? false : true,
  people: { Ahmed: { suggested: { card: 'Gold Card', why: '4x points at US supermarkets · best of yours here' }, cards: ['Gold Card', 'Shared Card'] },
            Victoria: { suggested: { card: 'Cash Card', why: '3% back at US supermarkets · best of yours here' }, cards: ['Cash Card', 'Shared Card'] } },
  month: { spent: 486.2, budget: 800 } });
const MONTH = { ok: true, ym: '2026-11', today: '2026-11-20', total: 612, budget: 800,
  byWho: { Ahmed: { total: 389, runs: 4 }, Victoria: { total: 223, runs: 3 } },
  cards: [{ card: 'Gold Card', total: 389, earned: 'about 1,556 points at 4x' }, { card: 'Cash Card', total: 223, earned: 'about $6.69 back at 3%' }],
  runs: [{ id: 'GR-1', date: '2026-11-20', store: 'Store A', who: 'Ahmed', card: 'Gold Card', total: 74.35, source: 'receipt', counted: 'all' },
         { id: 'GR-2', date: '2026-11-18', store: 'Store B', who: 'Victoria', card: 'Cash Card', total: 38.4, source: 'receipt', counted: 'food' }],
  pace: { spent: 612, budget: 800, left: 188, daysLeft: 10, lastMonthByNow: 540 },
  stores: [{ store: 'Store A', counts: true }, { store: 'Store B', counts: false }] };
const SCAN = { ok: true, items: [
  { name: 'olive oil', price: 12.99, qty: 1, food: true, match: '' }, { name: 'bananas', price: 1.79, qty: null, food: true, match: 'Bananas' },
  { name: 'paper towels', price: 21.99, qty: 1, food: false, match: '' }] };

async function mountShop(page, who, store) {
  await page.evaluate(({ who, store, SETUP_A, SETUP_B, SCAN }) => {
    window.__calls = []; window.__posts = [];
    window.apiGet = (u, t, p) => { window.__calls.push(p); return Promise.resolve(p.action === 'grocery_setup' ? (p.store === 'Store B' ? SETUP_B : SETUP_A) : { ok: false }); };
    window.apiPost = (u, t, b) => { window.__posts.push(b); return Promise.resolve({ ok: true, run: b.run, month: 560 }); };
    window.confirm = () => true;
    const stores = [{ tabId: 't.a', storeName: 'Store A', items: [{ index: 0, text: 'Bananas', done: false }, { index: 1, text: 'Milk', done: true }] },
                    { tabId: 't.b', storeName: 'Store B', items: [{ index: 0, text: 'Lemons', done: true }] }];
    document.querySelectorAll('#grprobe').forEach(n => n.remove());
    const host = document.createElement('div'); host.id = 'grprobe'; document.body.prepend(host);
    ReactDOM.createRoot(host).render(React.createElement(ShoppingTab, { stores, busy: false, grocery: { apiUrl: 'https://vera.test/exec', apiToken: 't', who },
      onToggle: (tab, idx, done) => { window.__posts.push({ toggle: [tab, idx, done] }); return Promise.resolve(); }, onAddItem: () => {}, onDelete: () => {}, onEdit: () => {}, onAddText: () => {},
      onScanReceipt: () => Promise.resolve(SCAN),
      onSaveReceipt: (tab, items) => { window.__posts.push({ pantry: tab, n: items.length }); return Promise.resolve({ ok: true }); } }));
  }, { who, store, SETUP_A: SETUP('Store A'), SETUP_B: SETUP('Store B'), SCAN });
  await page.waitForTimeout(250);
  if (store === 'Store B') { await page.evaluate(() => Array.from(document.querySelectorAll('#grprobe .shop-pill')).find(b => /Store B/.test(b.textContent)).click()); await page.waitForTimeout(120); }
  await page.$eval('#grprobe .shop-done-btn', b => b.click()); await page.waitForTimeout(250);
}
const text = (page, s) => page.$eval('#grprobe ' + s, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => null);
const click = async (page, s) => { await page.$eval('#grprobe ' + s, b => b.click()); await page.waitForTimeout(150); };
const scan = async page => { await page.setInputFiles('#grprobe .shop-snap input[type=file]', { name: 'r.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 217]) }); await page.waitForTimeout(300); };
const posts = page => page.evaluate(() => window.__posts);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8') };
  for (const [kind, who] of [['full', 'Ahmed'], ['lite', 'Victoria']]) {
    for (const width of [390, 1280]) {
      const L = kind + ' ' + width;
      console.log('\n' + kind + ' dashboard @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errs = []; page.on('pageerror', e => errs.push(e.message));
      if (kind === 'lite') {
        await page.route('**/*', r => { const u = r.request().url();
          for (const n of Object.keys(vendor)) if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
          if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: LITE });
          return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' }); });
        await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof ShoppingTab === 'function' && typeof GroceriesCard === 'function', null, { timeout: 15000 }).catch(() => {});

      // ---- with a receipt, at a grocery store ----
      await mountShop(page, who, 'Store A');
      check(L + ': it asks the server about this store', (await page.evaluate(() => window.__calls)).some(c => c.action === 'grocery_setup' && c.store === 'Store A'));
      await scan(page);
      const box = await text(page, '.gr-run');
      check(L + ': after the receipt, a "This run" box', !!box && /This run/i.test(box) && /Who went/i.test(box), box);
      check(L + ': the total is every line, pantry or not', await page.$eval('#grprobe .gr-total', n => n.value) === '$36.77');
      const meWho = await page.$$eval('#grprobe .gr-who', bs => bs.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent));
      check(L + ': who starts as whoever’s dashboard it is', JSON.stringify(meWho) === JSON.stringify([who]), JSON.stringify(meWho));
      const myCard = who === 'Ahmed' ? 'Gold Card' : 'Cash Card', other = who === 'Ahmed' ? 'Victoria' : 'Ahmed', otherCard = who === 'Ahmed' ? 'Cash Card' : 'Gold Card';
      check(L + ': their best grocery card is suggested, with why', await page.$eval('#grprobe .gr-card', n => n.value) === myCard && /best of yours here/.test(await text(page, '.gr-why')));
      await page.evaluate(o => Array.from(document.querySelectorAll('#grprobe .gr-who')).find(b => b.textContent === o).click(), other); await page.waitForTimeout(120);
      check(L + ': switching who switches the suggested card', await page.$eval('#grprobe .gr-card', n => n.value) === otherCard);
      check(L + ': the month bar includes this run', /Groceries this month, with this run \$523 of \$800/.test(await text(page, '.gr-month')), await text(page, '.gr-month'));
      await page.fill('#grprobe .gr-total', '39.10');
      check(L + ': the button says it logs the total too', /Add 2 to Pantry · log \$39\.10/.test(await text(page, '.shop-receipt-save')), await text(page, '.shop-receipt-save'));
      await click(page, '.shop-receipt-save'); await page.waitForTimeout(300);
      const p1 = await posts(page);
      const log = p1.filter(x => x.action === 'grocery_log')[0];
      check(L + ': Save logs the run', log && log.run.store === 'Store A' && log.run.who === other && log.run.card === otherCard && log.run.total === 39.1 &&
            log.run.source === 'receipt' && log.run.counted === 'all' && log.run.itemsTotal === 36.77, JSON.stringify(log));
      check(L + ': …then saves the pantry as before', p1.findIndex(x => x.action === 'grocery_log') < p1.findIndex(x => x.pantry) && p1.some(x => x.pantry === 't.a' && x.n === 2), JSON.stringify(p1));
      check(L + ': it says both happened', /Saved to Pantry: .*Logged \$39\.10 to groceries\./.test(await text(page, '.shop-sheet-saved')), await text(page, '.shop-sheet-saved'));

      // ---- no receipt ----
      await mountShop(page, who, 'Store A');
      check(L + ': without a receipt, "How much was it?"', /How much was it\?/.test(await text(page, '.gr-run')) && /Done, don’t log a total/.test(await text(page, '.shop-sheet-close')));
      check(L + ': nothing to log until there is a total', !(await page.$('#grprobe .gr-log-typed')));
      await page.fill('#grprobe .gr-typed', '64.18');
      await click(page, '.gr-log-typed'); await page.waitForTimeout(200);
      const t = (await posts(page)).filter(x => x.action === 'grocery_log')[0];
      check(L + ': a typed total is logged', t && t.run.total === 64.18 && t.run.source === 'typed' && t.run.who === who, JSON.stringify(t));
      check(L + ': …and said', /Logged \$64\.18 to groceries\./.test(await text(page, '.shop-sheet-saved')));

      // ---- a store that asks ----
      await mountShop(page, who, 'Store B');
      await scan(page);
      check(L + ': a non-grocery store asks, defaulting to just the food', /Store B isn’t marked as a grocery store\. Count this run\?/.test(await text(page, '.gr-ask')) &&
            await page.$eval('#grprobe .gr-count[aria-pressed="true"]', n => n.dataset.mode) === 'food');
      check(L + ': just the food leaves the paper towels out', await page.$eval('#grprobe .gr-total', n => n.value) === '$14.78');
      await click(page, '.gr-count[data-mode="all"]');
      check(L + ': all of it puts them back', await page.$eval('#grprobe .gr-total', n => n.value) === '$36.77');
      await click(page, '.gr-count[data-mode="none"]');
      check(L + ': not this one: no total, nothing to log', !(await page.$('#grprobe .gr-total')) && /^Add 2 to Pantry$/.test(await text(page, '.shop-receipt-save')));
      await click(page, '.gr-count[data-mode="food"]');
      await click(page, '.shop-receipt-save'); await page.waitForTimeout(300);
      const fb = (await posts(page)).filter(x => x.action === 'grocery_log')[0];
      check(L + ': a food-only run is logged as such', fb && fb.run.counted === 'food' && fb.run.total === 14.78 && fb.run.itemsTotal === 36.77, JSON.stringify(fb));

      // ---- Finances ----
      await page.evaluate(MONTH => {
        window.__posts = [];
        window.apiGet = (u, t, p) => Promise.resolve(p.action === 'grocery_month' ? JSON.parse(JSON.stringify(MONTH)) : { ok: false });
        window.apiPost = (u, t, b) => { window.__posts.push(b); return Promise.resolve({ ok: true }); };
        document.querySelectorAll('#grprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'grprobe'; document.body.prepend(host);
        ReactDOM.createRoot(host).render(React.createElement(GroceriesCard, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
      }, MONTH);
      await page.waitForTimeout(250);
      const card = await text(page, '.grc');
      check(L + ': the card: month, total against the budget', /Groceries · November 2026/.test(card) && /\$612 of \$800 budget/.test(card), card && card.slice(0, 160));
      check(L + ': what’s left and last month', /\$188 left with 10 days to go · last month at this point: \$540/.test(await text(page, '.grc-pace')));
      const whoTiles = await page.$$eval('#grprobe .grc-who', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
      check(L + ': by person', whoTiles.join('|') === 'AHMED $389 4 runs|VICTORIA $223 3 runs' || whoTiles.join('|') === 'Ahmed $389 4 runs|Victoria $223 3 runs', whoTiles.join('|'));
      const runs = await page.$$eval('#grprobe .grc-run', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
      check(L + ': each run, with how it was counted', runs.length === 2 && /Store B .*Victoria · Cash Card · just the food \$38\.40/.test(runs[1]), runs.join(' | '));
      await page.evaluate(() => Array.from(document.querySelectorAll('#grprobe .grc-view')).find(b => b.textContent === 'By card').click()); await page.waitForTimeout(100);
      check(L + ': by card, with what it earned', /about 1,556 points at 4x/.test(await text(page, '.grc-cardrow')));
      await page.evaluate(() => Array.from(document.querySelectorAll('#grprobe .grc-view')).find(b => b.textContent === 'By run').click()); await page.waitForTimeout(100);
      await click(page, '.grc-run');
      await page.fill('#grprobe .grc-edit-total', '70.00');
      await click(page, '.grc-edit-save');
      check(L + ': a run can be fixed', JSON.stringify((await posts(page)).slice(-1)[0]) === JSON.stringify({ action: 'grocery_update', run: { id: 'GR-1', total: '70.00', who: 'Ahmed' } }));
      await page.waitForTimeout(150);
      await click(page, '.grc-run'); await click(page, '.grc-edit-delete');
      check(L + ': …or removed', JSON.stringify((await posts(page)).slice(-1)[0]) === JSON.stringify({ action: 'grocery_delete', id: 'GR-1' }));
      await page.waitForTimeout(150);
      await click(page, '.grc-stores-toggle');
      const sw = await page.$$eval('#grprobe .grc-store-switch', ns => ns.map(n => n.dataset.store + ':' + n.getAttribute('aria-checked')));
      check(L + ': which stores count, as switches', sw.join(',') === 'Store A:true,Store B:false', sw.join(','));
      await click(page, '.grc-store-switch[data-store="Store B"]');
      check(L + ': a switch saves', JSON.stringify((await posts(page)).slice(-1)[0]) === JSON.stringify({ action: 'grocery_stores_save', stores: { 'Store B': true } }));
      if (width === 390) check(L + ': no sideways scroll at phone width', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
