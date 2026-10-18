// Drives the REAL WishListsView in BOTH dashboards, at phone and desktop widths, over a
// stubbed get_wish_lists. Invented people and gifts only.
//
// What matters: it opens on the upcoming Christmas with earlier years behind the
// picker; a person whose doc has nothing for that year reads "Not started yet";
// unclaimed wishes are marked; our gifts stand out; the table filters by person and
// buyer; a failed load says so; nothing scrolls sideways on a phone.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const G = (item, names, ours, purchased, wrapped, stocking) => ({ item, names, ours, purchased, wrapped, stocking: !!stocking });
const DATA = {
  ok: true, upcomingYear: 2026, unmappedInitials: ['QX'],
  people: [
    { person: 'Robin', years: [2026, 2025], notStarted: false, error: null, sections: {
      2026: { wishlist: [{ text: 'Ceramic Teapot', done: false, claimed: false }, { text: 'Yoga Matt', done: true, claimed: true }],
              gifts: [G('Yoga Mat', ['Victoria'], true, true, false), G('Scarf', ['Jordan'], false, false, false),
                      G('Hiking Socks', ['Ahmed'], true, false, false, true)],
              ideas: ['Pottery class'] },
      2025: { wishlist: [], gifts: [G('Old Lamp', ['QX'], false, true, true)], ideas: [] } } },
    { person: 'Sam', years: [2025], notStarted: true, error: null, sections: {
      2025: { wishlist: [{ text: 'A very long wish that goes on and on and on and on and on', done: false, claimed: false }],
              gifts: [G('Candle', ['Ahmed', 'Victoria'], true, true, true)], ideas: [] } } },
  ],
};

async function mount(page, resp) {
  await page.evaluate(resp => {
    document.querySelectorAll('#wlprobe').forEach(n => n.remove());
    const host = document.createElement('div'); host.id = 'wlprobe'; document.body.appendChild(host);
    window.__wlCalls = 0;
    window.apiGet = function(url, tok, params) {
      window.__wlCalls++;
      return resp === 'fail' ? Promise.reject(new Error('down')) : Promise.resolve(JSON.parse(JSON.stringify(resp)));
    };
    ReactDOM.createRoot(host).render(React.createElement(WishListsView, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
  }, resp);
  await page.waitForTimeout(250);
}
const text = page => page.$eval('#wlprobe', n => n.innerText);
const count = (page, sel) => page.$$eval('#wlprobe ' + sel, ns => ns.length);
const click = (page, sel) => page.$eval('#wlprobe ' + sel, b => b.click());

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const liteHtml = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };

  for (const [label, kind] of [['full dashboard', 'full'], ['dashboard-lite', 'lite']]) {
    for (const width of [390, 1280]) {
      console.log('\n' + label + ' @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1400 } });
      if (kind === 'lite') {
        await page.route('**/*', r => {
          const u = r.request().url();
          for (const n of Object.keys(vendor)) if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
          if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: liteHtml });
          return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
        });
        await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else {
        await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      }
      check('WishListsView is defined on the page', await page.evaluate(() => typeof WishListsView === 'function'));

      await mount(page, DATA);
      let t = await text(page);
      check('opens on the upcoming Christmas', /Christmas 2026/.test(t) && !/past year/.test(t), t.split('\n')[0]);
      check('…with earlier years behind the picker', (await page.$eval('#wlprobe .wl-year', s => Array.from(s.options).map(o => o.value).join(','))) === '2026,2025');
      check('one card per person', (await count(page, '.wl-card')) === 2);
      check('a person with nothing for 2026 reads "Not started yet"', (await count(page, '.wl-notstarted')) === 1 && /Sam[\s\S]*Not started yet/.test(t));
      check('the unclaimed wish is marked, the struck one isn’t', (await count(page, '.wl-unclaimed')) === 1 && /Ceramic Teapot\s*not claimed/.test(t), t);
      check('our gifts stand out', (await count(page, '.wl-gift.wl-ours')) === 2 && (await count(page, '.wl-gift')) === 3);
      check('who is buying, by name, with the stocking noted', /Ahmed · stocking/.test(t) && /Jordan/.test(t));
      check('ideas for next year', /Ideas for next year/i.test(t) && /Pottery class/.test(t));
      check('the setup note names initials with no name yet', /Initials with no name yet: QX/.test(t));

      // ---- an earlier year ----
      await page.$eval('#wlprobe .wl-year', s => { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '2025'); s.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.waitForTimeout(80);
      t = await text(page);
      check('picking 2025 shows 2025, labelled as a past year', /Christmas 2025/.test(t) && /past year/.test(t) && /Old Lamp/.test(t) && /Candle/.test(t), t.split('\n')[0]);
      check('…and Sam has content there', (await count(page, '.wl-notstarted')) === 0);

      // ---- the table ----
      await page.$eval('#wlprobe .wl-year', s => { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '2026'); s.dispatchEvent(new Event('change', { bubbles: true })); });
      await click(page, '.wl-to-table');
      await page.waitForTimeout(80);
      check('the table: every 2026 gift', (await count(page, '.wl-row')) === 3);
      await click(page, '.wl-fbuyer-ours');
      await page.waitForTimeout(50);
      check('…"Ours" keeps only what we’re buying', (await count(page, '.wl-row')) === 2);
      await click(page, '.wl-fbuyer-Ahmed');
      await page.waitForTimeout(50);
      check('…"Ahmed" keeps only his', (await count(page, '.wl-row')) === 1 && /Hiking Socks/.test(await text(page)));
      await click(page, '.wl-fbuyer-all');
      await page.$eval('#wlprobe .wl-fperson', s => { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'Sam'); s.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.waitForTimeout(50);
      check('…a person with no 2026 gifts says so', (await count(page, '.wl-row')) === 0 && /No gifts for 2026 with these filters\./.test(await text(page)));

      // ---- failure, and setup ----
      await mount(page, 'fail');
      check('a failed load says so', (await text(page)).trim() === 'Couldn’t load the wish lists.', await text(page));
      await mount(page, { ok: true, upcomingYear: 2026, people: [], note: 'No wishlist_* keys found in Config tab.' });
      check('no lists set up: says how', /No wishlist_\* keys/.test(await text(page)) && /wishlist_mom/.test(await text(page)));

      // ---- phone width ----
      await mount(page, DATA);
      const ov = await page.evaluate(() => { const h = document.getElementById('wlprobe'); return { s: h.scrollWidth, c: h.clientWidth }; });
      check('never scrolls sideways', ov.s <= ov.c + 1, JSON.stringify(ov));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
