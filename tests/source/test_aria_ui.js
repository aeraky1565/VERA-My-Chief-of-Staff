// Drives the REAL AriaView in both dashboards at phone and desktop widths, over
// an in-page fake of aria_status: first with no sheet connected (it says how to
// connect one), then with a Watchlist and Fare Log: what needs a look, trips by
// status with scouted ones under their idea, the best fare, the line of fares
// seen, a flagged fare's warning, a safe link out, and reading again on request.
// Read only: the view never posts. Every trip and fare here is invented.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const STATUS = {
  ok: true, configured: true, today: '2027-02-20', read: '2027-02-20T12:00:00.000Z',
  watchlist: [
    { tripId: 'TRIP-0001', label: 'Lake week', status: 'watching', origins: 'IAD', dests: 'ORD', returnFrom: '', earliest: '2027-04-05', latest: '2027-04-13', ceiling: 450, bestFare: 612, bestSource: 'SlickTrip', verdict: 'book', tier: 'Booking window', nextCheck: '2027-02-21', lastChecked: '2027-02-18', notes: 'Nonstop preferred', ref: '', dateChange: false },
    { tripId: 'TRIP-0002', label: 'Coast hop', status: 'watching', origins: '', dests: 'SFO', earliest: '2027-05-01', latest: '2027-05-08', ceiling: null, bestFare: null, verdict: 'wait', tier: 'Weekly', ref: '', dateChange: true, notes: '' },
    { tripId: '', ref: 'OPT-ABC', label: 'Spring idea', status: 'scouting', origins: 'IAD', dests: 'LIS', returnFrom: 'BCN', earliest: '2027-03-01', latest: '2027-05-31', nightsMin: 7, nightsMax: 10, bestFare: 1240, bestSource: 'SlickTrip', verdict: 'wait', tier: 'Weekly', dateChange: false, notes: '' },
    { tripId: 'TRIP-0003', label: 'Old plan', status: 'dropped', earliest: '2027-01-02', ref: '', dateChange: false, notes: '' },
  ],
  fares: [
    { tripId: 'TRIP-0001', dateSeen: '2027-02-18', total: 612, farePP: 280, airline: 'UA', stops: '0', depart: '2027-04-05', ret: '2027-04-13', link: 'https://fares.example/abc', flags: [] },
    { tripId: 'TRIP-0001', dateSeen: '2027-02-14', total: 650, farePP: 300, flags: [] },
    { tripId: 'TRIP-0001', dateSeen: '2027-02-10', total: 692, farePP: 320, flags: [] },
    { tripId: 'OPT-ABC', dateSeen: '2027-02-15', total: 1240, farePP: 590, airline: 'TP', stops: '1', depart: '2027-05-29', ret: '2027-06-05', link: '', flags: ['excl. bags', 'fare type unknown'] },
  ],
  requests: [],
  gaps: { noRow: [{ id: 'TRIP-0007', label: 'Girls weekend', start: '2027-03-12', why: 'ARIA has no row for this trip yet' }], draft: [],
    incomplete: [{ id: 'TRIP-0002', label: 'Coast hop', start: '2027-05-01', why: 'Missing origin airports, a price ceiling: ARIA can’t judge it' }],
    stale: [], dateChanged: [{ id: 'TRIP-0002', label: 'Coast hop', start: '2027-05-01', why: 'The dates changed in VERA: check the airports and the window' }], waiting: [], count: 3 },
  ideas: { 'OPT-ABC': { ideaId: 'IDEA-1', idea: 'Spring in Europe', option: 'Lisbon → Algarve → cruise' } },
};

async function mount(page, reply) {
  await page.evaluate((reply) => {
    document.querySelectorAll('#ariaprobe').forEach(n => n.remove());
    window.__gets = []; window.__posts = [];
    window.apiGet = (u, t, q) => { window.__gets.push(Object.assign({}, q)); return Promise.resolve(JSON.parse(JSON.stringify(reply))); };
    window.apiPost = (u, t, b) => { window.__posts.push(b); return Promise.resolve({ ok: true }); };
    window.__q = s => document.querySelector('#ariaprobe ' + s);
    const host = document.createElement('div'); host.id = 'ariaprobe'; host.style.padding = '0 12px'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(AriaView, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
  }, reply);
  await wait(200);
}
const text = page => page.$eval('#ariaprobe', n => n.innerText);
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function scenario(page, label, width) {
  await mount(page, { ok: true, configured: false });
  let t = await text(page);
  check(label + ': with no sheet connected it says how to connect one', /Connect ARIA’s sheet/.test(t) && /ARIA_SHEET_ID/.test(t) && /Project Settings → Script Properties/.test(t), t.slice(0, 300));
  check(label + ': …and offers no "Read again"', !(await page.$('#ariaprobe .aria-refresh')));

  await mount(page, { ok: false, configured: true, error: 'VERA couldn’t open the ARIA Travel Tracker.' });
  check(label + ': a sheet it can\'t open says so', /couldn’t open the ARIA Travel Tracker/.test(await text(page)));

  await mount(page, STATUS);
  t = await text(page);
  check(label + ': what needs a look comes first, with the count', /Needs a look · 3/i.test(t) && t.indexOf('Needs a look') < t.indexOf('Lake week'), t.slice(0, 300));
  check(label + ': …each with why', /ARIA can’t price these/.test(t) && /Coast hop \(2027-05-01\): Missing origin airports, a price ceiling/.test(t) && /Trips ARIA isn’t watching/.test(t) && /Girls weekend/.test(t) && /Dates changed in VERA/.test(t), t.slice(0, 600));
  check(label + ': trips group by status, scouted ones under their idea', /Watching · 2/i.test(t) && /Scouting · Spring in Europe · 1/i.test(t) && t.indexOf('Watching') < t.indexOf('Scouting'), t);
  const lake = await page.$$eval('#ariaprobe .aria-card', ns => (ns.find(n => /Lake week/.test(n.innerText)) || { innerText: '' }).innerText);
  check(label + ': a watched trip shows its dates, airports, verdict and best fare', /Mon, Apr 5 → Tue, Apr 13 · IAD → ORD/.test(lake) && /BOOK NOW/i.test(lake) && /\$612/.test(lake) && /ceiling \$450 pp/.test(lake), lake);
  check(label + ': …the latest fare in full', /Latest, 2027-02-18: \$612 total \(\$280 pp\) · UA · nonstop · Mon, Apr 5 → Tue, Apr 13/.test(lake), lake);
  check(label + ': …and the line of fares seen', !!(await page.$('#ariaprobe .aria-card .aria-spark')) && /\$612–\$692/.test(lake));
  const href = await page.$eval('#ariaprobe .aria-link', a => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]).catch(() => []);
  check(label + ': a fare link opens safely in a new tab', href[0] === 'https://fares.example/abc' && href[1] === '_blank' && href[2] === 'noopener noreferrer', JSON.stringify(href));
  const scout = await page.$$eval('#ariaprobe .aria-card', ns => (ns.find(n => /Lisbon → Algarve → cruise/.test(n.innerText)) || { innerText: '' }).innerText);
  check(label + ': a scouted row is named for its option, with its window and nights', /Leaving Mar 1 – May 31 · 7–10 nights · IAD → LIS, home from BCN/.test(scout) && /From the trip idea "Spring in Europe"/.test(scout), scout);
  check(label + ': fares show in whole dollars', /\$1,240\s+best seen/.test(scout) && /\$1,240 total \(\$590 pp\)/.test(scout), scout);
  check(label + ': a flagged fare says what it leaves out', /⚠ without bag fees/.test(scout) && /⚠ fare type unknown/.test(scout), scout);
  const coast = await page.$$eval('#ariaprobe .aria-card', ns => (ns.find(n => /Coast hop/.test(n.innerText)) || { innerText: '' }).innerText);
  check(label + ': a row with no fare says so, and a changed date is flagged', /No fare yet/.test(coast) && /The dates changed in VERA/.test(coast), coast);
  check(label + ': dropped rows wait behind a button', !/Old plan/.test(t) && /Show 1 dropped/.test(t));
  await page.evaluate(() => window.__q('.aria-show-dropped').click()); await wait(80);
  check(label + ': …and show on request', /Old plan/.test(await text(page)));
  await page.evaluate(() => window.__q('.aria-refresh').click()); await wait(120);
  const gets = await page.evaluate(() => window.__gets);
  check(label + ': "Read again" asks for a fresh read', gets.length === 2 && !gets[0].refresh && gets[1].refresh === '1' && gets[1].action === 'aria_status', JSON.stringify(gets));
  check(label + ': read only: nothing is ever posted', (await page.evaluate(() => window.__posts.length)) === 0);
  if (width >= 900) { const tops = await page.$$eval('#ariaprobe .aria-card', ns => ns.slice(0, 2).map(n => Math.round(n.getBoundingClientRect().top)));
    check(label + ': cards sit side by side on a desktop', tops[0] === tops[1], JSON.stringify(tops)); }
  check(label + ': no sideways scroll', await noScroll(page));
  if (process.env.SHOT_DIR) { const el = await page.$('#ariaprobe'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/aria-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const lite = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');
  for (const width of [390, 1280]) {
    console.log('\nfull dashboard @ ' + width + 'px');
    let page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await scenario(page, 'full ' + width, width);
    check('full ' + width + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();

    console.log('\ndashboard-lite @ ' + width + 'px');
    page = await browser.newPage({ viewport: { width, height: 900 } });
    const lerrs = []; page.on('pageerror', e => lerrs.push(e.message));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith('https://vera.test/')) return route.fulfill({ contentType: 'text/html', body: lite });
      for (const n of Object.keys(vendor)) if (url.includes(n)) return route.fulfill({ contentType: 'application/javascript', body: vendor[n] });
      return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
    });
    await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 'test-token'); });
    await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
    await scenario(page, 'lite ' + width, width);
    check('lite ' + width + ': no page errors', lerrs.length === 0, lerrs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); process.exit(2); });
