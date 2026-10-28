// Settings › Test, rendered for real: the Test tab is in the modal, a trip
// loads its days, the preview tags each item with where it came from, an
// empty day warns, and Send passes the trip, the day and the recipients — and
// can't be pressed twice while it runs.
const { chromium } = require('playwright');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// Invented trips. Today is the Lake Trip's last day.
const TRIPS = { ok: true, today: '2026-10-28', trips: [
  { key: '2026-10-21|Lake Trip', label: 'Lake Trip', start: '2026-10-21', end: '2026-10-28', current: true },
  { key: '2026-11-06|Island Trip', label: 'Island Trip', start: '2026-11-06', end: '2026-11-08', current: false },
]};
const LAKE = { ok: true, start: '2026-10-21', end: '2026-10-28', days: [
  { date: '2026-10-21', items: [{ time: 'all day', title: 'Staying with friends', type: 'arranged_stay', source: 'sheet' }] },
  { date: '2026-10-22', items: [] },
  { date: '2026-10-23', items: [{ time: '18:00', title: 'Drinks', type: 'dining', source: 'sheet' }] },
  { date: '2026-10-24', items: [] }, { date: '2026-10-25', items: [] }, { date: '2026-10-26', items: [] },
  { date: '2026-10-27', items: [] },
  { date: '2026-10-28', items: [{ time: '19:00 – 21:11', title: 'Flight home', type: 'flight', source: 'calendar' }] },
]};
const ISLAND = { ok: true, start: '2026-11-06', end: '2026-11-08', days: [
  { date: '2026-11-06', items: [{ time: '20:00', title: 'Dinner', type: 'dining', source: 'sheet' }] },
  { date: '2026-11-07', items: [] }, { date: '2026-11-08', items: [] },
]};

const settle = (page, ms) => page.waitForTimeout(ms || 250);

async function mount(page, which, sendReply) {
  await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
  return page.evaluate(({ which, TRIPS, LAKE, ISLAND, sendReply }) => {
    document.querySelectorAll('.modal-overlay, #tprobe').forEach(n => n.remove());
    window.__calls = [];
    window.__release = null;
    window.fetch = (url) => {
      const q = new URL(url).searchParams;
      const action = q.get('action');
      const params = {}; q.forEach((v, k) => { if (k !== 'token') params[k] = v; });
      window.__calls.push(params);
      let body = { ok: true, rows: [] };
      if (action === 'test_travel_trips') body = TRIPS;
      if (action === 'test_travel_trip') body = q.get('tripKey').indexOf('Island') !== -1 ? ISLAND : LAKE;
      if (action === 'test_travel_send') {
        // Held until the test releases it, so "while sending" can be looked at.
        return new Promise(res => { window.__release = () => res({ json: () => Promise.resolve(sendReply) }); });
      }
      return Promise.resolve({ json: () => Promise.resolve(body) });
    };
    const comp = which === 'modal' ? NotifSettingsModal : TestEmailsPanel;
    if (typeof comp !== 'function') return { error: (which === 'modal' ? 'NotifSettingsModal' : 'TestEmailsPanel') + ' is not defined' };
    const host = document.createElement('div'); host.id = 'tprobe'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(comp,
      { apiUrl: 'https://vera.example.test/exec', apiToken: 'tok', onClose: () => {} }));
    return { ok: true };
  }, { which, TRIPS, LAKE, ISLAND, sendReply });
}
const text = (page, sel) => page.evaluate(s => { const n = document.querySelector(s); return n ? n.textContent : null; }, sel);
const all  = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].map(n => n.textContent), sel);
const calls = page => page.evaluate(() => window.__calls);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  console.log('\nthe settings modal has a Test tab');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
    const m = await mount(page, 'modal', { ok: true });
    if (m.error) { fail++; console.log('  FAIL ' + m.error); }
    await settle(page);
    const tabs = await all(page, '.modal-box button');
    check('a Test tab sits beside Notifications and Config',
          tabs.some(t => /Notifications/.test(t)) && tabs.some(t => /Config/.test(t)) && tabs.some(t => /Test$/.test(t.trim())),
          JSON.stringify(tabs));
    await page.evaluate(() => [...document.querySelectorAll('.modal-box button')].filter(b => /Test$/.test(b.textContent.trim()))[0].click());
    await settle(page, 400);
    check('opening it shows the travel day card', /Travel day email/.test(await text(page, '.test-emails') || ''));
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check('…with no sideways scroll at phone width', noScroll);
    await page.close();
  }

  for (const width of [390, 1280]) {
    console.log('\nthe travel day card @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1400 } });
    const m = await mount(page, 'panel', { ok: true, to: ['me@example.test'], subject: 'TEST · ✈️ Travel Day — Lake Trip · Wednesday, October 28', count: 1 });
    if (m.error) { fail++; console.log('  FAIL ' + m.error); await page.close(); continue; }
    await settle(page, 400);

    const trips = await all(page, '.test-trip');
    check('both trips are offered', trips.length === 2 && /Lake Trip/.test(trips[0]) && /Island Trip/.test(trips[1]),
          JSON.stringify(trips));
    check('the trip on now says so', /now/.test(trips[0]) && !/now/.test(trips[1]));
    const c0 = await calls(page);
    check('the trip on now is opened for you', c0.some(c => c.action === 'test_travel_trip' && c.tripKey === '2026-10-21|Lake Trip'),
          JSON.stringify(c0));
    const days = await all(page, '.test-day');
    check('a chip per day', days.length === 8, JSON.stringify(days));
    check('today is called Today', /Today/.test(days[7]), days[7]);
    check('a flight day is marked', /flight/.test(days[7]), days[7]);
    check('a day with one thing says so', /1 item/.test(days[2]), days[2]);

    const prev = await text(page, '.test-preview');
    check('the preview starts on today', /Today, Oct 28/.test(prev || ''), prev);
    check('…and lists the flight home', /Flight home/.test(prev || ''), prev);
    const src = await page.evaluate(() => [...document.querySelectorAll('.test-src')].map(n => n.getAttribute('data-src') + ':' + n.textContent));
    check('…tagged calendar', JSON.stringify(src) === '["calendar:calendar"]', JSON.stringify(src));

    await page.click('.test-day[data-date="2026-10-23"]'); await settle(page);
    const src2 = await page.evaluate(() => [...document.querySelectorAll('.test-src')].map(n => n.getAttribute('data-src')));
    check('a sheet item is tagged sheet', JSON.stringify(src2) === '["sheet"]', JSON.stringify(src2));

    await page.click('.test-day[data-date="2026-10-24"]'); await settle(page);
    check('an empty day warns what the email would say', /haven’t been logged yet/.test(await text(page, '.test-empty') || ''));

    await page.click('.test-day[data-date="2026-10-28"]'); await settle(page);
    await page.click('.test-send'); await settle(page);
    const btn = await page.evaluate(() => { const b = document.querySelector('.test-send'); return { dis: b.disabled, t: b.textContent }; });
    check('while it runs the button is held', btn.dis === true && /sending/.test(btn.t), JSON.stringify(btn));
    await page.evaluate(() => document.querySelector('.test-send').click()); await settle(page);
    const sends = (await calls(page)).filter(c => c.action === 'test_travel_send');
    check('…so a second press sends nothing', sends.length === 1, JSON.stringify(sends));
    check('it sends that trip, that day, to you',
          sends[0] && sends[0].tripKey === '2026-10-21|Lake Trip' && sends[0].date === '2026-10-28' && sends[0].to === 'me',
          JSON.stringify(sends));
    await page.evaluate(() => window.__release()); await settle(page);
    const res = await text(page, '.test-result');
    check('the result says it went to you', /Sent at .* to you/.test(res || ''), res);
    check('…with the subject', /TEST · ✈️ Travel Day — Lake Trip/.test(res || ''), res);
    check('…and how many items', /built from 1 item\./.test(res || ''), res);

    await page.click('.test-to-all'); await settle(page);
    await page.click('.test-send'); await settle(page);
    const sends2 = (await calls(page)).filter(c => c.action === 'test_travel_send');
    check('"Everyone on the trip" sends to=all', sends2.length === 2 && sends2[1].to === 'all', JSON.stringify(sends2));
    await page.evaluate(() => window.__release()); await settle(page);

    await page.click('.test-trip:nth-child(2)'); await settle(page, 400);
    const d2 = await all(page, '.test-day');
    check('picking another trip loads its days', d2.length === 3 && /Nov 6/.test(d2[0]), JSON.stringify(d2));
    check('…starting on its first day', /Nov 6/.test(await text(page, '.test-preview') || ''));

    if (width === 390) {
      const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      check('no sideways scroll at phone width', noScroll);
    }
    await page.close();
  }

  console.log('\na refused send shows why');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 1200 } });
    await mount(page, 'panel', { ok: false, error: 'That day is outside the trip.' });
    await settle(page, 400);
    await page.click('.test-send'); await settle(page);
    await page.evaluate(() => window.__release()); await settle(page);
    check('the error is shown', /outside the trip/.test(await text(page, '.test-error') || ''));
    check('…and no success line', (await text(page, '.test-result')) === null);
    const btn = await page.evaluate(() => document.querySelector('.test-send').disabled);
    check('…and the button is free again', btn === false);
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
