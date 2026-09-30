// Renders the REAL HomestewardView from the REAL built page.
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
  { row:4, item:'Fridge', category:'Appliance', warrantyExpiry:'2031-01-01', warrantyDays:1200,
    lastService:'', nextService:'', intervalMonths:'', notes:'' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of [390, 1280]) {
    console.log('\nfull dashboard @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });

    const r = await page.evaluate(({ items }) => {
      document.querySelectorAll('.modal-overlay, #wprobe').forEach(n => n.remove());
      if (typeof HomestewardView !== 'function') return { error: 'HomestewardView is not defined' };
      const host = document.createElement('div'); host.id = 'wprobe'; document.body.appendChild(host);
      ReactDOM.createRoot(host).render(React.createElement(HomestewardView, {
        items, loading:false, busy:false, onRecordService: () => {},
      }));
      return new Promise(res => setTimeout(() => res({
        text: host.innerText,
        banner: (host.querySelector('.warranty-banner') || {}).textContent || '',
      }), 300));
    }, { items: ITEMS });

    if (r.error) { fail++; console.log('  FAIL ' + r.error); await page.close(); continue; }

    check('the warranty banner appears', r.banner.length > 0, r.text.slice(0, 200));
    check('…counting only the one inside 60 days', /1 warranty ending within 60 days/.test(r.banner), r.banner);
    check('…naming it', /Watch battery/.test(r.banner), r.banner);
    check('…and not the 2031 one', !/Fridge/.test(r.banner), r.banner);
    check('the service banner still works', /1 item due for service within 14 days/.test(r.text),
          r.text.slice(0, 300));
    check('the badge agrees with the banner rather than saying Valid',
          /Expires in 46d/.test(r.text) && !/Watch battery[\s\S]{0,40}Valid/.test(r.text), r.text.slice(0, 500));
    check('a genuinely distant warranty still reads Valid', /Fridge[\s\S]{0,40}Valid/.test(r.text),
          r.text.slice(0, 600));

    // empty state
    const e = await page.evaluate(() => {
      document.querySelectorAll('#wprobe').forEach(n => n.remove());
      const host = document.createElement('div'); host.id = 'wprobe'; document.body.appendChild(host);
      ReactDOM.createRoot(host).render(React.createElement(HomestewardView, {
        items: [], loading:false, busy:false, onRecordService: () => {},
      }));
      return new Promise(res => setTimeout(() => res(host.innerText), 250));
    });
    check('the empty state heading no longer says "No home items yet"',
          !/No home items yet/i.test(e) && /Nothing tracked yet/.test(e), e);
    check('…and names a watch as an example', /watch/i.test(e), e);

    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    check('no sideways page scroll', sw[0] <= sw[1], sw.join(' > '));
    await page.close();
  }

  // The sub-tab label ships in both the source and the built page.
  console.log('\nthe sub-tab label');
  for (const [label, file] of [['docs/app.js','docs/app.js'], ['docs/index.html','docs/index.html']]) {
    const src = fs.readFileSync(path.resolve(ROOT, file), 'utf8');
    check(label + ': renamed to Warranties & Service', /Warranties & Service/.test(src));
    check(label + ": no longer says '🏠 Steward'", !/🏠 Steward/.test(src));
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
