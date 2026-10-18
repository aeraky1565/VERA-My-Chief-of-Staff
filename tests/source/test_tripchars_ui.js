// Drives the REAL "What kind of trip" chips in the full dashboard over a stubbed API.
//
// The bug this exists for: the dashboard rebuilt its copy of a trip's details
// without the characteristics, so every trip showed "not set" — and a chip saves
// the WHOLE list, so tapping "beach" on a trip saved as "city" erased "city".
// The chips now read what's saved before a tap can build on it.
const { chromium } = require('playwright');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// saved: what get_trip_meta answers with. value: the (possibly stale) view the
// block is handed by the page.
async function mount(page, saved, value) {
  await page.evaluate(([saved, value]) => {
    document.querySelectorAll('#tcprobe').forEach(n => n.remove());
    const host = document.createElement('div'); host.id = 'tcprobe'; document.body.appendChild(host);
    window.__tcSent = [];
    window.fetch = function(url) {
      const u = new URL(url), action = u.searchParams.get('action');
      if (action === 'get_trip_meta') return Promise.resolve({ json: () => Promise.resolve({ ok: true, characteristics: saved }) });
      if (action === 'set_trip_meta') window.__tcSent.push(u.searchParams.get('characteristics'));
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    };
    ReactDOM.createRoot(host).render(React.createElement(TripCharacteristicsBlock,
      { tripKey: '2026-10-21|Chicago Trip', value: value, apiUrl: 'https://vera.test/exec', apiToken: 't', busy: false }));
  }, [saved, value]);
  await page.waitForTimeout(250);
}
const onChips = page => page.$$eval('#tcprobe button', bs => bs.filter(b => b.style.background === 'rgb(26, 58, 110)').map(b => b.textContent));
const tap = (page, t) => page.$$eval('#tcprobe button', (bs, t) => bs.find(b => b.textContent === t).click(), t);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const page = await browser.newPage({ viewport: { width: 390, height: 1200 } });
  await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
  check('TripCharacteristicsBlock is on the page', await page.evaluate(() => typeof TripCharacteristicsBlock === 'function'));

  console.log('\nthe Chicago trip: saved as "city", handed an empty view');
  await mount(page, 'city', '');
  check('shows what is SAVED, not the empty view', JSON.stringify(await onChips(page)) === '["city"]', JSON.stringify(await onChips(page)));
  check('…so no "not set" warning', !/not set/.test(await page.$eval('#tcprobe', n => n.innerText)));
  await tap(page, 'beach');
  await page.waitForTimeout(100);
  const sent = await page.evaluate(() => window.__tcSent);
  check('tapping "beach" ADDS to what was saved: beach,city', JSON.stringify(sent) === '["beach,city"]', JSON.stringify(sent));

  console.log('\nnothing saved');
  await mount(page, '', '');
  check('nothing on, and the warning shows', (await onChips(page)).length === 0 && /not set/.test(await page.$eval('#tcprobe', n => n.innerText)));

  console.log('\na stale view (beach) while the trip is saved as city,cruise');
  await mount(page, 'city,cruise', 'beach');
  check('the saved value wins', JSON.stringify(await onChips(page)) === '["city","cruise"]', JSON.stringify(await onChips(page)));
  await tap(page, 'cruise');
  await page.waitForTimeout(100);
  check('untapping removes just that one', JSON.stringify(await page.evaluate(() => window.__tcSent)) === '["city"]', JSON.stringify(await page.evaluate(() => window.__tcSent)));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
