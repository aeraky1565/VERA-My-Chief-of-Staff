// Drives the REAL "built from" banner in BOTH real pages, at phone and desktop widths,
// over a stubbed generation_inputs record.
//
// The states that matter: a well-grounded list collapses to one line that says so;
// a list with problems opens by itself and says what to fix; a list from before this
// existed says it's unknown; a trip with no list shows nothing; a forecast that has
// arrived is called out; kept items are named; a failed load says so rather than
// showing nothing.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const F = (id, label, status, detail, hint) => ({ id, label, status, detail, hint: hint || '' });
const GOOD = [
  F('destination', 'Destination', 'used', 'Chicago, IL (from the flight)'),
  F('dates', 'Dates & time of year', 'used', '2026-10-20 to 2026-10-24 · Fall'),
  F('weather', 'Weather', 'used', 'Forecast: Expected: 48–61°F, some rain.'),
  F('activities', 'Itinerary activities', 'used', '6 items: flight, hotel, dining'),
  F('characteristics', 'Trip characteristics', 'used', 'city, museums'),
  F('travellers', 'Travellers', 'used', 'both'),
  F('dresscodes', 'Dress codes', 'none', 'None on the itinerary'),
  F('lessons', 'Lessons from past trips', 'used', '2 applied'),
];
const BAD = GOOD.map(f => f.id === 'weather'
  ? F('weather', 'Weather', 'missing', 'None: no trip dates (end date missing)', 'Fix what’s missing above, then regenerate.')
  : f.id === 'characteristics'
  ? F('characteristics', 'Trip characteristics', 'missing', 'None set', 'Say what the trip involves.')
  : f);

// Mounts the banner. `resp` is what generation_inputs answers ('fail' to reject).
async function mount(page, props, resp) {
  return page.evaluate(([props, resp]) => {
    document.querySelectorAll('#giprobe').forEach(n => n.remove());
    const host = document.createElement('div'); host.id = 'giprobe'; document.body.appendChild(host);
    const p2 = n => String(n).padStart(2, '0');
    const day = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
    props = Object.assign({}, props, { tripKey: day(props.inDays) + '|Chicago' });
    window.__giCalls = [];
    window.apiGet = function(url, tok, params) {
      window.__giCalls.push({ url, tok, action: params.action, kind: params.kind, tripKey: params.tripKey });
      return resp === 'fail' ? Promise.reject(new Error('down')) : Promise.resolve(resp);
    };
    window.__giRoot = ReactDOM.createRoot(host);
    window.__giProps = props;
    window.__giRoot.render(React.createElement(GenInputsBanner, props));
    return new Promise(r => setTimeout(r, 250));
  }, [props, resp]);
}
const text = page => page.$eval('#giprobe', n => n.innerText);
const count = (page, sel) => page.$$eval('#giprobe ' + sel, ns => ns.length);
const rec = (factors, extra) => ({ ok: true, record: Object.assign({ kind: 'packing', generatedAt: '2026-10-17T09:30:00', factors, weatherMode: 'forecast', kept: [] }, extra || {}) });

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
          for (const n of Object.keys(vendor)) {
            if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
          }
          if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: liteHtml });
          return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
        });
        await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else {
        await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => { try { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); } catch (e) {} });
      }
      check('GenInputsBanner is defined on the page', await page.evaluate(() => typeof GenInputsBanner === 'function'));

      // ---- a well-grounded list: one line, collapsed, expandable ----
      await mount(page, { kind: 'packing', inDays: 30, hasList: true }, rec(GOOD));
      let t = await text(page);
      const calls = await page.evaluate(() => window.__giCalls);
      check('asks for this trip’s packing record', calls.length === 1 && calls[0].action === 'generation_inputs' && calls[0].kind === 'packing', JSON.stringify(calls));
      check('…using the stored URL and token when the panel passes none', calls[0].url === 'https://vera.test/exec' && calls[0].tok === 't');
      check('all good: one line that says so', /Built from all 8 inputs/.test(t), t);
      check('…collapsed', (await count(page, '.gi-factor')) === 0);
      // A direct click: the full dashboard opens its settings modal on load (no URL stored
      // yet when it booted), and that overlay would otherwise catch the pointer.
      await page.$eval('#giprobe .gi-toggle', b => b.click());
      await page.waitForTimeout(50);
      check('…and opens to all eight', (await count(page, '.gi-factor')) === 8);
      t = await text(page);
      check('each factor shows what it was', /Destination: Chicago, IL \(from the flight\)/.test(t) && /Weather: Forecast:/.test(t));

      // ---- problems: open by itself, with the fix ----
      await mount(page, { kind: 'packing', inDays: 30, hasList: true }, rec(BAD));
      t = await text(page);
      check('problems are counted', /2 of 8 inputs need attention/.test(t), t.split('\n')[0]);
      check('…and open without a click', (await count(page, '.gi-factor')) === 8);
      check('…the reason is shown', /no trip dates \(end date missing\)/.test(t));
      check('…and what to do about it', /Fix what’s missing above, then regenerate\./.test(t));
      check('missing factors are marked as such', (await count(page, '.gi-missing')) === 2);

      // ---- built before records existed ----
      await mount(page, { kind: 'packing', inDays: 30, hasList: true }, { ok: true, record: null });
      t = await text(page);
      check('an old list: "built before VERA recorded its inputs"', /Built before VERA recorded its inputs/.test(t) && /checked items are kept/.test(t), t);
      await mount(page, { kind: 'packing', inDays: 30, hasList: false }, { ok: true, record: null });
      check('no list at all: nothing drawn', (await text(page)).trim() === '');

      // ---- the forecast has arrived ----
      await mount(page, { kind: 'packing', inDays: 10, hasList: true }, rec(GOOD, { weatherMode: 'last_year' }));
      t = await text(page);
      check('last year’s weather, trip in 10 days: the forecast nudge', /A real forecast is now available\. Regenerate to use it\. Your checked items are kept\./.test(t), t);
      await mount(page, { kind: 'packing', inDays: 30, hasList: true }, rec(GOOD, { weatherMode: 'last_year' }));
      check('…but not 30 days out', !/real forecast is now available/.test(await text(page)));
      await mount(page, { kind: 'discover', inDays: 10, hasList: true }, rec(GOOD, { kind: 'discover', weatherMode: 'last_year' }));
      t = await text(page);
      check('Discover gets the nudge too, without the checkmark line', /A real forecast is now available\. Regenerate to use it\./.test(t) && !/checked items/.test(t), t);

      // ---- kept items named ----
      await mount(page, { kind: 'packing', inDays: 30, hasList: true }, rec(BAD, { kept: [{ person: 'ahmed', item: 'Wool socks' }] }));
      check('items kept from the previous list are named', /Kept from the previous list because you’d checked them: Ahmed: Wool socks\./.test(await text(page)));

      // ---- a failed load says so ----
      await mount(page, { kind: 'packing', inDays: 30, hasList: true }, 'fail');
      check('a failed load says so, in a real sentence', (await text(page)).trim() === 'Couldn’t load what this list was built from.', await text(page));
      await mount(page, { kind: 'discover', inDays: 30, hasList: true }, 'fail');
      check('…and for Discover', (await text(page)).trim() === 'Couldn’t load what these picks were built from.', await text(page));

      // ---- regenerating refetches ----
      await mount(page, { kind: 'packing', inDays: 30, hasList: true }, rec(GOOD));
      await page.evaluate(() => {
        window.__giRoot.render(React.createElement(GenInputsBanner, Object.assign({}, window.__giProps, { watch: { items: [1] } })));
        return new Promise(r => setTimeout(r, 200));
      });
      check('a new list (watch changes) fetches the record again', (await page.evaluate(() => window.__giCalls.length)) === 2);

      // ---- phone width ----
      await mount(page, { kind: 'packing', inDays: 10, hasList: true }, rec(BAD, { weatherMode: 'last_year', kept: [{ person: 'victoria', item: 'A very long item name that goes on and on and on' }] }));
      const ov = await page.evaluate(() => { const h = document.getElementById('giprobe'); return { s: h.scrollWidth, c: h.clientWidth }; });
      check('never scrolls sideways', ov.s <= ov.c + 1, JSON.stringify(ov));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
