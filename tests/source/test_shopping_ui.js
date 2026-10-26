// The Shopping list in BOTH real pages, at phone and desktop width: pill store tabs, an add
// box per store, aisles, the checked-off section and Done shopping with a receipt; VERA's restock lines
// read as a name plus when it expects you to run out (the Doc's text untouched), every
// check circle and row button is a 44px / 40px target, a tap still toggles the right item,
// and the list says that a check-off is logged. Every value here is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const helper = s => { const m = s.match(/function shopItemView_\(text\)\{[^\n]*\n/); return m ? m[0] : ''; };

console.log('\nthe line reader');
check('both dashboards carry it, word for word', helper(APP).length > 50 && helper(APP) === helper(LITE));
const C = vm.createContext({});
vm.runInContext(helper(APP), C);
const v = t => JSON.stringify(vm.runInContext('shopItemView_(' + JSON.stringify(t) + ')', C));
check('a VERA line: its name and when it runs out', v('🤖 milk (est. ~Oct 30)') === '{"vera":true,"name":"milk","est":"Oct 30"}', v('🤖 milk (est. ~Oct 30)'));
check('…without the tilde too', v('🤖 eggs (est. Nov 2)') === '{"vera":true,"name":"eggs","est":"Nov 2"}', v('🤖 eggs (est. Nov 2)'));
check('your own line is left as written, brackets and all', v('Tomatoes (Roma, 2 lb)') === '{"vera":false,"name":"Tomatoes (Roma, 2 lb)","est":""}', v('Tomatoes (Roma, 2 lb)'));
check('nothing is an empty name, not an error', v(null) === '{"vera":false,"name":"","est":""}');

console.log('\nthe shared block, aisles and receipt lines');
const START = '// ---- ShopList (Shopping tab) — SHARED VERBATIM', END = '// ---- /ShopList ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
check('both dashboards carry the Shopping block, word for word', block(APP).length > 2000 && block(APP) === block(LITE));
const B = vm.createContext({ React: { createElement: () => null, useState: x => [x, () => {}], useEffect: () => {}, Fragment: 'f' } });
vm.runInContext(block(APP), B);
const aisle = n => vm.runInContext('shopAisle_(' + JSON.stringify(n) + ')', B);
check('aisles come from the name, by whole word', aisle('Bananas') === 'Produce' && aisle('Greek yogurt') === 'Dairy & Eggs' && aisle('Chicken thighs') === 'Meat & Fish'
  && aisle('Olive oil') === 'Pantry' && aisle('Burger buns') === 'Bakery' && aisle('Paper towels') === 'Household', [aisle('Bananas'), aisle('Olive oil'), aisle('Burger buns')].join());
check('first match wins (ice cream is Frozen, not Dairy); "soil" isn\'t oil; unknown is Other', aisle('Vanilla ice cream') === 'Frozen' && aisle('Potting soil') === 'Other' && aisle('Birthday card') === 'Other' && aisle('') === 'Other');
B.items = [{ index: 0, text: 'Paper towels', done: false }, { index: 1, text: '🤖 milk (est. ~Oct 30)', done: false }, { index: 2, text: 'Bananas', done: false }, { index: 3, text: 'Olive oil', done: true }, { index: 4, text: 'Mystery thing', done: false }];
const grp = vm.runInContext('shopGroup_(items)', B);
check('groups in walking order, Other last; checked items apart', grp.groups.map(x => x.name + ':' + x.rows.map(r => r.view.name).join('+')).join(' ') === 'Produce:Bananas Dairy & Eggs:milk Household:Paper towels Other:Mystery thing'
  && grp.done.length === 1 && grp.done[0].view.name === 'Olive oil', JSON.stringify(grp.groups.map(x => x.name)));
const kind = l => JSON.stringify(vm.runInContext('shopReceiptKind_(' + JSON.stringify(l) + ', items)', B));
check('a receipt line on a checked item is a match; on an unchecked one, a list item with its place', kind({ name: 'olive oil', match: 'Olive oil' }) === '{"kind":"match","index":3}' && kind({ name: 'milk', match: 'MILK' }) === '{"kind":"list","index":1}');
check('…otherwise new, or non-food when the model says so', kind({ name: 'pears', match: '' }) === '{"kind":"new","index":-1}' && kind({ name: 'batteries', match: '', food: false }) === '{"kind":"nonfood","index":-1}');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  // SHOP_QUICK (set by ctl_shopping.js): the full dashboard at phone width only, so the controls
  // fit the runner's time. The lite copy of the shared block is checked word for word above.
  const QUICK = !!process.env.SHOP_QUICK;
  for (const kind of (QUICK ? ['full'] : ['full', 'lite'])) {
    for (const width of (QUICK ? [390] : [390, 1280])) {
      const L = kind + ' ' + width;
      console.log('\n' + kind + ' dashboard @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errs = []; page.on('pageerror', e => errs.push(e.message));
      if (kind === 'lite') {
        await page.route('**/*', r => {
          const u = r.request().url();
          for (const n of Object.keys(vendor)) if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
          if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: LITE });
          return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
        });
        await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else {
        await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      }
      await page.waitForFunction(() => typeof ShoppingTab === 'function', null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => {
        window.__calls = [];
        const stores = [
          { tabId: 't.a', storeName: 'Store A', items: [
            { index: 0, text: 'Bananas', done: false },
            { index: 1, text: '🤖 milk (est. ~Oct 30)', done: false },
            { index: 2, text: '🤖 olive oil (est. ~Nov 9)', done: true },
            { index: 3, text: 'Tomatoes (Roma, 2 lb)', done: false }] },
          { tabId: 't.b', storeName: 'Store B', items: [{ index: 0, text: 'Lemons', done: false }] }];
        document.querySelectorAll('#shopprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'shopprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        ReactDOM.createRoot(host).render(React.createElement(ShoppingTab, { stores, busy: false,
          onToggle: (tab, idx, done) => { window.__calls.push(['toggle', tab, idx, done]); },
          onAddItem: () => {}, onDelete: (tab, idx) => window.__calls.push(['delete', tab, idx]), onEdit: () => {},
          onAddText: (tab, text) => window.__calls.push(['add', tab, text]),
          onScanReceipt: (tab, file) => { window.__calls.push(['scan', tab, file.name]); return Promise.resolve(window.__scan); },
          onSaveReceipt: (tab, items) => { window.__calls.push(['save', tab, items]); return Promise.resolve({ ok: true, filled: 1, added: 2 }); } }));
      });
      await wait(400);
      const rows = await page.$$eval('#shopprobe .shop-row', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': a VERA line reads as its name, with when it runs out', rows.some(r => /^milk VERA added · runs out ~Oct 30/.test(r)), JSON.stringify(rows));
      check(L + ': …and the raw marker and estimate are nowhere on screen', !rows.some(r => /🤖|\(est\./.test(r)));
      check(L + ': your own line is shown as written', rows.some(r => /^Tomatoes \(Roma, 2 lb\)/.test(r)));
      check(L + ': a VERA line in the cart drops the restock note', rows.some(r => /^✓ olive oil/.test(r) && !/VERA added/.test(r)));
      const sizes = await page.$$eval('#shopprobe .shop-check', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      check(L + ': every check circle is a 44px target', sizes.length === 4 && sizes.every(s => s[0] >= 44 && s[1] >= 44), JSON.stringify(sizes));
      const btns = await page.$$eval('#shopprobe .shop-row button[title]', bs => bs.map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
      check(L + ': edit and delete are 40px targets', btns.length === 8 && btns.every(x => x >= 40), JSON.stringify(btns));
      const labels = await page.$$eval('#shopprobe .shop-check', bs => bs.map(b => b.getAttribute('aria-label') + '|' + b.getAttribute('aria-checked')));
      check(L + ': each circle says what it does, by the item\'s name', labels.includes('Check milk|false') && labels.includes('Uncheck olive oil|true'), JSON.stringify(labels));
      await page.evaluate(() => Array.from(document.querySelectorAll('#shopprobe .shop-check')).find(b => b.getAttribute('aria-label') === 'Check milk').click());
      await page.evaluate(() => Array.from(document.querySelectorAll('#shopprobe .shop-row button[title="Delete"]')).find(b => b.getAttribute('aria-label') === 'Delete Bananas').click());
      const calls = await page.evaluate(() => window.__calls);
      check(L + ': tapping a circle toggles that item, by its place in the Doc', JSON.stringify(calls[0]) === '["toggle","t.a",1,false]', JSON.stringify(calls));
      check(L + ': delete still names the right item', JSON.stringify(calls[1]) === '["delete","t.a",0]', JSON.stringify(calls));
      const hint = await page.$eval('#shopprobe .shop-hint', n => n.innerText).catch(() => '');
      check(L + ': under the list it says a check-off is logged, and an untick today takes it back', /logs it to Purchase History with today’s date\. Unchecking it the same day takes it back out\./.test(hint), hint);
      check(L + ': no Log Shopping Run button', !(await page.evaluate(() => Array.from(document.querySelectorAll('#shopprobe button')).some(b => /Log Shopping Run/.test(b.textContent)))));
      // ---- pills, add per store, aisles, the checked section ----
      const pills = await page.$$eval('#shopprobe .shop-pill', bs => bs.map(b => b.innerText.replace(/\s+/g, ' ').trim() + '|' + b.getAttribute('aria-pressed') + '|' + Math.round(b.getBoundingClientRect().height)));
      check(L + ': a pill per store with what\'s left, the current one pressed, 44px tall', pills.join(',') === 'Store A 3|true|44,Store B 1|false|44', JSON.stringify(pills));
      const heads = await page.$$eval('#shopprobe .shop-aisle-head', hs => hs.map(x => x.innerText.replace(/\s+/g, ' ').trim().toLowerCase()));
      check(L + ': unchecked items sit under their aisles, each with what\'s left', heads.join(',') === 'produce 2 left,dairy & eggs 1 left', JSON.stringify(heads));
      await page.fill('#shopprobe .shop-add-input', 'Garlic'); await page.press('#shopprobe .shop-add-input', 'Enter'); await wait(150);
      let calls2 = await page.evaluate(() => window.__calls.filter(c => c[0] === 'add'));
      check(L + ': the add box adds to the store you\'re on, and clears', JSON.stringify(calls2) === '[["add","t.a","Garlic"]]' && await page.$eval('#shopprobe .shop-add-input', n => n.value) === '', JSON.stringify(calls2));
      check(L + ': …it says which store', await page.$eval('#shopprobe .shop-add-input', n => n.getAttribute('placeholder')) === 'Add to Store A…');
      await page.evaluate(() => Array.from(document.querySelectorAll('#shopprobe .shop-pill')).find(b => /Store B/.test(b.textContent)).click()); await wait(150);
      check(L + ': another pill shows that store\'s list and add box', /Lemons/.test(await page.$eval('#shopprobe .shop-tab', n => n.innerText)) && await page.$eval('#shopprobe .shop-add-input', n => n.getAttribute('placeholder')) === 'Add to Store B…');
      await page.evaluate(() => Array.from(document.querySelectorAll('#shopprobe .shop-pill')).find(b => /Store A/.test(b.textContent)).click()); await wait(150);
      const tog = () => page.$eval('#shopprobe .shop-checked-toggle', n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
      check(L + ': checked items sit below, under Checked off', /^CHECKED OFF · 1 Hide$/.test(await tog()), await tog());
      await page.$eval('#shopprobe .shop-checked-toggle', b => b.click()); await wait(100);
      check(L + ': …and fold away', !(await page.$$eval('#shopprobe .shop-row', rs => rs.some(r => /olive oil/.test(r.innerText)))) && /Show$/.test(await tog()));
      await page.$eval('#shopprobe .shop-checked-toggle', b => b.click()); await wait(100);
      check(L + ': the bar says what\'s left and what\'s checked off', await page.$eval('#shopprobe .shop-bar-text', n => n.innerText) === '3 left · 1 checked off');
      // ---- Done shopping and a receipt ----
      await page.$eval('#shopprobe .shop-done-btn', b => b.click()); await wait(150);
      const sheetText = await page.$eval('#shopprobe .shop-sheet', n => n.innerText).catch(() => '');
      check(L + ': Done shopping lists what was checked off, with the receipt and no-receipt choices', /Done shopping at Store A/.test(sheetText) && /olive oil/.test(await page.$eval('#shopprobe .shop-sheet-done', n => n.innerText).catch(() => '')) && /Snap the receipt/.test(sheetText) && /Done, no receipt/.test(sheetText), sheetText.slice(0, 200));
      check(L + ': …the sheet fits the screen', await page.$eval('#shopprobe .shop-sheet', n => n.getBoundingClientRect().width <= window.innerWidth));
      await page.evaluate(() => { window.__scan = { ok: true, items: [
        { name: 'olive oil', price: 12.99, qty: 1, food: true, match: 'olive oil' }, { name: 'bananas', price: 1.79, qty: null, food: true, match: 'Bananas' },
        { name: 'blueberries', price: 4.99, qty: 1, food: true, match: '' }, { name: 'paper towels', price: 21.99, qty: 1, food: false, match: '' }] }; });
      await page.setInputFiles('#shopprobe .shop-snap input[type=file]', { name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 217]) }); await wait(300);
      const lines = await page.$$eval('#shopprobe .shop-receipt-line', bs => bs.map(b => b.getAttribute('aria-pressed') + '|' + b.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': the photo goes to the scan for the store you\'re on', (await page.evaluate(() => JSON.stringify(window.__calls.find(c => c[0] === 'scan')))) === '["scan","t.a","receipt.jpg"]');
      check(L + ': each line says what saving it will do; food picked, non-food not', lines.length === 4
        && /^true\|✓ olive oil Already logged when you checked it off · adds the price \$12\.99$/.test(lines[0]) && /^true\|✓ Bananas On your list · checked off too \$1\.79$/.test(lines[1])
        && /^true\|✓ blueberries Not on the list · a new pantry row \$4\.99$/.test(lines[2]) && /^false\|paper towels Not food · logged only if you tick it \$21\.99$/.test(lines[3]), JSON.stringify(lines));
      check(L + ': the button counts what\'s picked', await page.$eval('#shopprobe .shop-receipt-save', n => n.innerText) === 'Add 3 to Pantry');
      await page.$eval('#shopprobe .shop-receipt-save', b => b.click()); await wait(300);
      const tail = await page.evaluate(() => window.__calls.filter(c => c[0] === 'toggle' || c[0] === 'save').slice(-2));
      check(L + ': a picked line on the list is checked off first, then everything picked is saved by the list\'s name', JSON.stringify(tail) === JSON.stringify([['toggle', 't.a', 0, false], ['save', 't.a', [{ name: 'olive oil', qty: 1, price: 12.99 }, { name: 'Bananas', qty: null, price: 1.79 }, { name: 'blueberries', qty: 1, price: 4.99 }]]]), JSON.stringify(tail));
      const saved = await page.$eval('#shopprobe .shop-sheet-saved', n => n.innerText).catch(() => '');
      check(L + ': it says what happened', saved === 'Saved to Pantry: prices added to 1 you checked off, 1 more checked off on the list, 1 new item logged from the receipt.', saved);
      await page.evaluate(() => Array.from(document.querySelectorAll('#shopprobe .shop-sheet button')).find(b => b.textContent === 'Done').click()); await wait(150);
      check(L + ': Done closes the sheet; the list is as it was', !(await page.$('#shopprobe .shop-sheet')) && /olive oil/.test(await page.$eval('#shopprobe .shop-tab', n => n.innerText)));
      await page.$eval('#shopprobe .shop-done-btn', b => b.click()); await wait(100);
      await page.evaluate(() => { window.__scan = { ok: true, items: [] }; });
      await page.setInputFiles('#shopprobe .shop-snap input[type=file]', { name: 'blur.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 217]) }); await wait(300);
      check(L + ': a photo with nothing readable says so and stays on the first step', /couldn’t read any items/.test(await page.$eval('#shopprobe .shop-sheet-msg', n => n.innerText).catch(() => '')) && !!(await page.$('#shopprobe .shop-snap')));
      await page.$eval('#shopprobe .shop-sheet-close', b => b.click()); await wait(100);
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
