// #245 The Vehicles card in the browser, both dashboards, 390 and 1280: Coming up in order
// with its chips, Renewed… and Done… calling the real routes, the stale-miles note, History
// and Details folded, the reminder, removing a vehicle, and the short add form.
// Invented vehicles; the server's answers are stubbed.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const VEHICLES = [{
  ID: 'veh_1', name: 'Family SUV', Nickname: 'Family SUV', Year: 2021, Make: 'Example', Model: 'Trailblazer', 'License Plate': '8XK-214', State: 'VA', Driver: 'Sam',
  'Current Mileage': 38412, milesAge: 41, milesStale: true, VIN: '1EXAMPLE0VIN4821', 'Last Service': '2026-04-30', 'Last Oil Change Date': '2026-06-02', 'Last Oil Change Mileage': 33980,
  comingUp: [
    { key: 'insurance', label: 'Insurance', kind: 'renew', date: '2026-09-22', days: -52, status: 'high', chip: 'Passed', when: 'Passed Sep 22' },
    { key: 'service', label: 'Service', kind: 'service', date: '2026-10-31', days: -13, status: 'high', chip: '13 days late', when: 'Was due Oct 31' },
    { key: 'oil', label: 'Oil change', kind: 'miles', miles: 568, status: 'low', chip: '~568 mi', when: 'In about 568 mi · every 5,000 mi' },
    { key: 'registration', label: 'Registration', kind: 'renew', date: '2027-06-30', days: 229, status: 'ok', chip: 'OK', when: 'Wed, Jun 30, 2027' }],
  history: [{ key: 'warranty_b2b', label: 'Bumper-to-bumper warranty', when: 'Ended Mar 1, 2024' }] },
  { ID: 'veh_2', name: 'Commuter sedan', Nickname: 'Commuter sedan', Year: 2019, Make: 'Sample', Model: 'Sedan', 'Current Mileage': 61903, milesAge: 5, milesStale: false,
    comingUp: [{ key: 'registration', label: 'Registration', kind: 'renew', date: '2026-11-26', days: 13, status: 'med', chip: '13 days', when: 'Thu, Nov 26' }], history: [] },
  { ID: 'veh_3', name: 'Work truck', Nickname: 'Work truck', Year: 2018, Make: 'Sample', Model: 'Hauler', body: 'truck', 'Current Mileage': 90210, milesAge: 2, milesStale: false,
    comingUp: [{ key: 'insurance', label: 'Insurance', kind: 'renew', date: '2027-05-01', days: 169, status: 'ok', chip: 'OK', when: 'Sat, May 1, 2027' }], history: [] }];

async function mount(browser, file, width) {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  if (file === 'index.html') await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
  else {   // lite loads React and Babel from a CDN: serve local copies, as test_roster_ui does
    const vendor = { 'react.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'), 'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
      'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8') };
    const lite = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');
    await page.route('**/*', route => { const url = route.request().url();
      if (url.startsWith('https://vera.test/dashboard-lite.html')) return route.fulfill({ contentType: 'text/html', body: lite });
      for (const n of Object.keys(vendor)) if (url.includes(n)) return route.fulfill({ contentType: 'application/javascript', body: vendor[n] });
      return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' }); });
    await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
  }
  await page.waitForFunction(() => typeof VehiclesView === 'function', null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(V => {
    const root = document.getElementById('root'); if (root) root.style.display = 'none';
    window.__calls = []; window.__changed = 0;
    window.fetch = url => { const p = Object.fromEntries(new URL(url).searchParams); window.__calls.push(p);
      const body = p.action === 'vehicle_renewal_ics' ? { ok: true, filename: 'renew-insurance-family-suv.ics', ics: 'BEGIN:VCALENDAR' } : { ok: true };
      return Promise.resolve({ json: () => Promise.resolve(body) }); };
    const host = document.createElement('div'); host.id = 'vh'; host.style.padding = '0 12px'; document.body.prepend(host);
    ReactDOM.createRoot(host).render(React.createElement(VehiclesView, { vehicles: V, loading: false, apiUrl: 'https://vera.test/exec', apiToken: 't', onChanged: () => { window.__changed++; } }));
  }, VEHICLES);
  await wait(300);
  return { page, errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const file of ['index.html', 'dashboard-lite.html']) for (const width of (process.env.VERA_CTL_FAST ? [390] : [390, 1280])   /* a control checks one width */) {
    const L = (file === 'index.html' ? 'Full ' : 'Lite ') + width;
    console.log('\n' + L);
    const { page, errs } = await mount(browser, file, width);
    const t = sel => page.$eval('#vh ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    const last = () => page.evaluate(() => window.__calls[window.__calls.length - 1] || {});
    check(L + ': the summary counts what needs you', /3 things need you across your vehicles/.test(await t('.vh-summary')), await t('.vh-summary'));
    const items = await page.$$eval('#vh [data-vid=\"veh_1\"] .vh-item', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
    check(L + ': Coming up, in the order the server gives, with chips and actions', items.length === 4 && /^Insurance Passed Sep 22 Passed 📅 Remind me Renewed…$/.test(items[0]) && /^Service Was due Oct 31 13 days late 📅 Remind me Done…$/.test(items[1]) && /Oil change .* ~568 mi Done…$/.test(items[2]) && /^Registration .* OK Renewed…$/.test(items[3]), JSON.stringify(items));
    check(L + ': stale miles: the note and Update miles', /The miles may be out of date/.test(await t('[data-vid=\"veh_1\"] .vh-stale')) && /updated 41 days ago/.test(await t('[data-vid=\"veh_1\"] .vh-age')));
    check(L + ': fresh miles: no note', (await page.$('#vh [data-vid=\"veh_2\"] .vh-stale')) === null || !/out of date/.test(await t('[data-vid=\"veh_2\"]')));
    // Renewed…
    await page.click('#vh [data-vid=\"veh_1\"] .vh-item:first-child .vh-act'); await wait(100);
    check(L + ': Renewed… offers a date a year on', await page.$eval('#vh .vh-fix input[type=date]', n => n.value) === '2027-09-22');
    await page.click('#vh .vh-fix button:has-text("Save")'); await wait(200);
    let c = await last();
    check(L + ': …and saves it to the Vehicles tab', c.action === 'vehicle_renew' && c.id === 'veh_1' && c.item === 'insurance' && c.date === '2027-09-22' && await page.evaluate(() => window.__changed) === 1, JSON.stringify(c));
    check(L + ': …saying so', /Saved to the Vehicles tab/.test(await t('.vh-msg')));
    // Done… for service
    await page.click('#vh [data-vid=\"veh_1\"] .vh-item:nth-child(2) .vh-act'); await wait(100);
    await page.fill('#vh .vh-fix input[type=number]', '38500');
    await page.click('#vh .vh-fix button:has-text("Save")'); await wait(200);
    c = await last();
    check(L + ': Done… logs the service, today, with the miles', c.action === 'vehicle_service' && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.currentMileage === '38500', JSON.stringify(c));
    // the reminder
    await page.click('#vh [data-vid=\"veh_1\"] .vh-item:first-child .vh-remind'); await wait(200);
    c = await last();
    check(L + ': 📅 Remind me fetches the reminder for that item', c.action === 'vehicle_renewal_ics' && c.item === 'insurance' && /Downloaded renew-insurance-family-suv\.ics/.test(await t('.vh-msg')));
    // miles
    await page.click('#vh [data-vid=\"veh_1\"] .vh-stale button:has-text("Update miles")'); await wait(100);
    await page.fill('#vh .vh-fix input[type=number]', '38612');
    await page.click('#vh .vh-fix button:has-text("Save")'); await wait(200);
    c = await last();
    check(L + ': Update miles', c.action === 'vehicle_mileage' && c.mileage === '38612', JSON.stringify(c));
    // folds
    check(L + ': History and Details start folded', await page.$$eval('#vh [data-vid=\"veh_1\"] details', ns => ns.length === 2 && ns.every(n => !n.open)));
    await page.click('#vh [data-vid=\"veh_1\"] details:nth-of-type(1) summary'); await wait(80);
    check(L + ': History has the last changes and the ended warranty', /Last oil change Jun 2, 2026 at 33,980 mi/.test(await t('[data-vid=\"veh_1\"] details[open]')) && /Bumper-to-bumper warranty Ended Mar 1, 2024/.test(await t('[data-vid=\"veh_1\"] details[open]')));
    // remove asks first, in the page
    await page.click('#vh [data-vid=\"veh_1\"] details:nth-of-type(2) summary'); await wait(80);
    await page.click('#vh [data-vid=\"veh_1\"] button:has-text("Remove vehicle")'); await wait(80);
    check(L + ': Remove asks first', /Remove Family SUV and its row\?/.test(await t('[data-vid=\"veh_1\"]')) && (await last()).action !== 'delete_vehicle');
    await page.click('#vh [data-vid=\"veh_1\"] button:has-text("Keep")');
    // add
    await page.click('#vh .vh-add-btn'); await wait(80);
    const fields = await page.$$eval('#vh .vh-add label', ns => ns.map(n => n.firstChild.textContent));
    check(L + ': the add form asks for the essentials only', JSON.stringify(fields) === JSON.stringify(['Nickname', 'Year', 'Make', 'Model', 'License Plate', 'State', 'Current Mileage', 'Registration Expiry', 'Insurance Expiry']), JSON.stringify(fields));
    await page.fill('#vh .vh-add label:nth-child(1) input', 'Weekend car');
    await page.click('#vh .vh-add button[type=submit]'); await wait(200);
    c = await last();
    check(L + ': …and adds through the real route', c.action === 'add_vehicle' && c.Nickname === 'Weekend car', JSON.stringify(c));
    // folding: open when it needs you, folded when all is OK; the icon is our own drawn shape
    check(L + ': cards that need you start open; an all-OK one starts folded', await page.$eval('#vh [data-vid="veh_1"] .vh-head', n => n.getAttribute('aria-expanded')) === 'true'
          && await page.$eval('#vh [data-vid="veh_2"] .vh-head', n => n.getAttribute('aria-expanded')) === 'true' && await page.$eval('#vh [data-vid="veh_3"] .vh-head', n => n.getAttribute('aria-expanded')) === 'false');
    check(L + ': a folded card is one row: icon, name, the most urgent chip', /^Work truck .*All OK/.test(await t('[data-vid="veh_3"]')) && (await page.$('#vh [data-vid="veh_3"] .vh-list')) === null && (await page.$('#vh [data-vid="veh_3"] svg.vh-icon-truck')) !== null);
    check(L + ': each card has its body-shape icon (a sedan when not set)', (await page.$('#vh [data-vid="veh_1"] svg.vh-icon-sedan')) !== null);
    await page.click('#vh [data-vid="veh_3"] .vh-head'); await wait(100);
    check(L + ': tap to open', await page.$eval('#vh [data-vid="veh_3"] .vh-head', n => n.getAttribute('aria-expanded')) === 'true' && (await page.$('#vh [data-vid="veh_3"] .vh-list')) !== null);
    await page.click('#vh [data-vid="veh_1"] .vh-head'); await wait(100);
    check(L + ': tap to fold, and the choice is remembered on this device', await page.$eval('#vh [data-vid="veh_1"] .vh-head', n => n.getAttribute('aria-expanded')) === 'false'
          && /Insurance: Passed/.test(await t('[data-vid="veh_1"]')) && await page.evaluate(() => (JSON.parse(localStorage.getItem('vera_vh_open') || '{}') || {}).veh_1 === false));
    await page.focus('#vh [data-vid="veh_1"] .vh-head'); await page.keyboard.press('Enter'); await wait(100);
    check(L + ': the keyboard opens it too', await page.$eval('#vh [data-vid="veh_1"] .vh-head', n => n.getAttribute('aria-expanded')) === 'true');
    await page.evaluate(() => { try { localStorage.removeItem('vera_vh_open'); } catch (e) {} });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(L + ': no sideways scroll', sw <= width, sw);
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
