// Drives the REAL add form in BOTH real pages, and asserts the two files agree.
// The parity block is the point: a single-file test passed last time while the
// lite dashboard silently kept the old label, no banner, and a badge that
// disagreed with the flags.

const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const ITEMS = [
  { row:2, item:'Watch battery', category:'Personal', warrantyExpiry:'2027-09-30', warrantyDays:46,
    lastService:'', nextService:'', intervalMonths:'', notes:'Seiko' },
  { row:3, item:'Boiler', category:'Appliance', warrantyExpiry:'', warrantyDays:null,
    lastService:'2027-01-01', nextService:'2027-08-20', serviceDays:5, intervalMonths:'12', notes:'' },
];

async function mount(page, items) {
  return page.evaluate(({ items }) => {
    document.querySelectorAll('.modal-overlay, #hprobe, .add-item-modal').forEach(n => n.remove());
    if (typeof HomestewardView !== 'function') return { error: 'HomestewardView is not defined' };
    window.__added = null; window.__deleted = null;
    window.confirm = () => true;
    const host = document.createElement('div'); host.id = 'hprobe'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(HomestewardView, {
      items, loading:false, busy:false,
      onRecordService: () => {},
      onAdd:    f => { window.__added = f; },
      onDelete: (row, item) => { window.__deleted = { row, item }; },
    }));
    return new Promise(r => setTimeout(() => r({ ok:true }), 300));
  }, { items });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  const liteHtml = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };

  for (const [label, kind] of [['full dashboard', 'full'], ['dashboard-lite', 'lite']]) {
    for (const width of [390, 1280]) {
      console.log('\n' + label + ' @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      if (kind === 'lite') {
        await page.route('**/*', route => {
          const u = route.request().url();
          for (const n of Object.keys(vendor))
            if (u.includes(n)) return route.fulfill({ contentType:'application/javascript', body: vendor[n] });
          if (u.startsWith('https://vera.test/')) return route.fulfill({ contentType:'text/html', body: liteHtml });
          return route.fulfill({ contentType:'application/json', body:'{"ok":false}' });
        });
        await page.addInitScript(() => {
          localStorage.setItem('vera_url', 'https://vera.test/exec');
          localStorage.setItem('vera_token', 't');
        });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else {
        await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      }

      const m = await mount(page, ITEMS);
      if (m.error) { fail++; console.log('  FAIL ' + m.error); await page.close(); continue; }

      // ---- add, minimal: a watch needs a name and a date ------------------
      check('the add button is present', await page.$('.add-item-btn') !== null);
      await page.click('.add-item-btn');
      await page.waitForTimeout(200);
      check('the form opens', await page.$('.add-item-modal') !== null);
      check('Add is disabled with no name', await page.$eval('.hi-save', b => b.disabled));

      await page.fill('.hi-item', 'Watch battery');
      await page.fill('.hi-warrantyExpiry', '2027-09-30');
      await page.waitForTimeout(120);
      check('Add enables once named', !(await page.$eval('.hi-save', b => b.disabled)));
      await page.click('.hi-save');
      await page.waitForTimeout(200);

      let a = await page.evaluate(() => window.__added);
      check('onAdd fires', a !== null, JSON.stringify(a));
      check('…with the item name', a && a.item === 'Watch battery', a && a.item);
      check('…the warranty date', a && a.warrantyExpiry === '2027-09-30', a && a.warrantyExpiry);
      check('…and invents nothing for the untouched fields',
            a && a.category === '' && a.lastService === '' && a.nextService === '' &&
            a.intervalMonths === '' && a.purchaseDate === '' && a.notes === '', JSON.stringify(a));
      check('the form closes after saving', await page.$('.add-item-modal') === null);

      // ---- add, full: every column ----------------------------------------
      await mount(page, ITEMS);
      await page.click('.add-item-btn');
      await page.waitForTimeout(150);
      for (const [sel, val] of [['.hi-item','Boiler'], ['.hi-category','Appliance'],
                                ['.hi-purchaseDate','2020-03-01'], ['.hi-warrantyExpiry','2030-03-01'],
                                ['.hi-lastService','2027-01-15'], ['.hi-nextService','2028-01-15'],
                                ['.hi-intervalMonths','12'], ['.hi-notes','British Gas']]) {
        await page.fill(sel, val);
      }
      await page.click('.hi-save');
      await page.waitForTimeout(200);
      a = await page.evaluate(() => window.__added);
      check('all eight fields are sent',
            a && a.item === 'Boiler' && a.category === 'Appliance' && a.purchaseDate === '2020-03-01' &&
            a.warrantyExpiry === '2030-03-01' && a.lastService === '2027-01-15' &&
            a.nextService === '2028-01-15' && a.intervalMonths === '12' && a.notes === 'British Gas',
            JSON.stringify(a));

      // ---- delete ----------------------------------------------------------
      await mount(page, ITEMS);
      const dels = await page.$$('.hi-delete');
      check('every row has a delete', dels.length === ITEMS.length, dels.length);
      await dels[0].click();
      await page.waitForTimeout(200);
      const d = await page.evaluate(() => window.__deleted);
      check('onDelete sends the row AND the name, so a stale list cannot delete the wrong thing',
            d && typeof d.row === 'number' && typeof d.item === 'string', JSON.stringify(d));

      // ---- the empty state must be able to add the first item -------------
      await mount(page, []);
      check('the empty state offers the add button too', await page.$('.add-item-btn') !== null);
      await page.click('.add-item-btn');
      await page.waitForTimeout(200);
      check('…and its form opens', await page.$('.add-item-modal') !== null);
      const emptyText = await page.evaluate(() => document.getElementById('hprobe').innerText);
      check('…and it no longer tells you to edit the sheet',
            !/Life OS sheet|Home Items tab/.test(emptyText), emptyText);

      // ---- the warranty banner (the lite parity miss) ---------------------
      await mount(page, ITEMS);
      const banner = await page.evaluate(() =>
        (document.querySelector('.warranty-banner') || {}).textContent || '');
      check('the warranty banner renders', /1 warranty ending within 60 days/.test(banner), banner);
      const listText = await page.evaluate(() => document.getElementById('hprobe').innerText);
      check('the badge agrees with it rather than saying Valid',
            /Expires in 46d/.test(listText), listText.slice(0, 300));

      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      check('no sideways page scroll', sw[0] <= sw[1], sw.join(' > '));
      await page.close();
    }
  }

  // ---- parity across the shipped files -----------------------------------
  console.log('\nparity between the two dashboards');
  const files = {
    'docs/app.js':              fs.readFileSync(path.resolve(ROOT, 'docs/app.js'), 'utf8'),
    'docs/index.html':          fs.readFileSync(path.resolve(ROOT, 'docs/index.html'), 'utf8'),
    'docs/dashboard-lite.html': fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8'),
  };
  for (const [name, src] of Object.entries(files)) {
    check(name + ': sub-tab renamed',        /Warranties & Service/.test(src));
    check(name + ": no '🏠 Steward' left",   !/🏠 Steward/.test(src));
    check(name + ': has the warranty banner', /warranty-banner/.test(src));
    check(name + ': badge red tier at 14',    /days\s*<=\s*14\) return \{ label: `🔴 Expires/.test(src) ||
                                              /days<=14\)return\{label:`🔴 Expires/.test(src), 'threshold missing');
    check(name + ': badge amber tier at 60',  /days\s*<=\s*60\) return \{ label: `🟡 Expires/.test(src) ||
                                              /days<=60\)return\{label:`🟡 Expires/.test(src), 'threshold missing');
    check(name + ': no 30-day threshold left', !/days\s*<=\s*30\)\s*return\s*\{\s*label:\s*`🟡 Expires/.test(src) &&
                                               !/days<=30\)return\{label:`🟡 Expires/.test(src));
    check(name + ': calls add_home_item',      /add_home_item/.test(src));
    check(name + ': calls delete_home_item',   /delete_home_item/.test(src));
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
