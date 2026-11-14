// Working and Business Trips in the browser, at 390 and 1280: the trip card asks
// who's working only on those trips, defaults to the Traveller, saves a change and
// says what it changes; a Business Trip's budget says Employer pays. Invented trips.
const { chromium } = require('playwright');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of (process.env.VERA_CTL_FAST ? [390] : [390, 1280])   /* a control checks one width */) {
    const L = '@' + width;
    console.log('\nWorking trips ' + L);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof TripWorkingBlock === 'function', null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => {
      window.__calls = [];
      window.fetch = (url) => {
        const u = new URL(url), p = Object.fromEntries(u.searchParams.entries()); window.__calls.push(p);
        let r = { ok: true };
        if (p.action === 'get_trip_budget') r = { ok: true, tripKey: p.tripKey, items: [{ ID: 'B1', 'Trip Key': p.tripKey, Category: 'Flights', Label: 'Flight', Budgeted: 400, Actual: 412 }],
          summary: { employerPays: true, toClaim: 412, budgeted: 400, actual: 412, diff: 12, tripBudget: '', travellers: 1, perPerson: 412 } };
        if (p.action === 'set_trip_working') r = { ok: true, working: p.working };
        return Promise.resolve({ ok: true, json: () => Promise.resolve(r) });
      };
      const root = document.getElementById('root'); if (root) root.style.display = 'none';
      const host = document.createElement('div'); host.id = 'wt'; host.style.padding = '0 12px'; document.body.prepend(host);
      window.__render = (props) => ReactDOM.createRoot(host).render(React.createElement('div', null,
        React.createElement('div', { id: 'card' }, React.createElement(TripWorkingBlock, Object.assign({ tripKey: '2027-03-08|Denver', apiUrl: 'https://vera.test/exec', apiToken: 't', busy: false }, props))),
        React.createElement('div', { id: 'budget' }, React.createElement(TripBudgetPanel, { trips: [{ tripKey: '2027-06-01|Chicago', label: 'Chicago', startDate: '2027-06-01', endDate: '2027-06-03' }], apiUrl: 'https://vera.test/exec', apiToken: 't', focusTripKey: '2027-06-01|Chicago' }))));
      window.__render({ context: 'Family Trip', traveler: 'Victoria', saved: '' });
    });
    await wait(300);
    check(L + ': not a working trip: no "Who’s working"', (await page.$('#wt .trip-working')) === null);
    await page.evaluate(() => window.__render({ context: 'Working Trip', traveler: 'Victoria', saved: '' }));
    await wait(300);
    const on = () => page.$$eval('#wt .tw-chip', ns => ns.filter(n => n.getAttribute('aria-pressed') === 'true').map(n => n.textContent));
    const what = () => page.$eval('#wt .tw-what', n => n.textContent).catch(() => '');
    check(L + ': a Working Trip asks, defaulting to the Traveller', JSON.stringify(await on()) === '["Victoria"]', JSON.stringify(await on()));
    check(L + ': …and says what it changes', /^No PTO counted\. Only Victoria’s breaks are blocked in the PTO plan\. Packing adds a laptop and charger/.test(await what()), await what());
    await page.click('#wt .tw-chip:has-text("Both")'); await wait(200);
    const last = (await page.evaluate(() => window.__calls)).filter(c => c.action === 'set_trip_working').slice(-1)[0] || {};
    check(L + ': choosing Both saves it for the trip', last.working === 'Both' && last.tripKey === '2027-03-08|Denver' && JSON.stringify(await on()) === '["Both"]' && /Only your breaks/.test(await what()));
    await page.evaluate(() => window.__render({ context: 'Business Trip', traveler: 'Ahmed', saved: '' }));
    await wait(300);
    check(L + ': a Business Trip: Employer pays and work clothes', /Costs show as Employer pays, to claim back\. Packing adds work clothes and a laptop\./.test(await what()) && JSON.stringify(await on()) === '["Ahmed"]', await what());
    await page.evaluate(() => window.__render({ context: 'Work Trip', traveler: '', saved: 'Victoria' }));
    await wait(300);
    check(L + ': an old "Work Trip" still counts, and a saved choice wins', JSON.stringify(await on()) === '["Victoria"]' && /Employer pays/.test(await what()));
    await wait(400);
    const note = await page.$eval('#wt .tb-employer', n => n.textContent).catch(() => '');
    check(L + ': the business trip’s budget: Employer pays, with what to claim back', /^Employer pays\. A business trip: these costs are your employer’s, to claim back \(\$412(\.00)?\s*so far\)\.$/.test(note.replace(/\s+/g, ' ')), note);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(L + ': no sideways scroll', sw <= width, sw);
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + e.message); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
