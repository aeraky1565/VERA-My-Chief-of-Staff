// The Shopping list in BOTH real pages, at phone and desktop width: VERA's restock lines
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

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  for (const kind of ['full', 'lite']) {
    for (const width of [390, 1280]) {
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
          onToggle: (tab, idx, done) => window.__calls.push(['toggle', tab, idx, done]),
          onAddItem: () => {}, onDelete: (tab, idx) => window.__calls.push(['delete', tab, idx]), onEdit: () => {},
          }));
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
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
