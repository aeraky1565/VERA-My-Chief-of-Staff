// Settings › Test, the pre-trip and post-trip cards, rendered for real: each
// offers its two emails and the right trips (coming up, or past), Send passes
// the email and the trip, goes only to you, and says what it sent or why not.
// Invented trips.
const { chromium } = require('playwright');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const TRIPS = { ok: true, today: '2026-10-28', trips: [
  { key: '2026-10-21|Lake Trip', label: 'Lake Trip', start: '2026-10-21', end: '2026-10-28', current: true },
  { key: '2026-11-06|Island Trip', label: 'Island Trip', start: '2026-11-06', end: '2026-11-08', current: false },
  { key: '2026-12-19|Snow Trip', label: 'Snow Trip', start: '2026-12-19', end: '2026-12-23', current: false },
]};
const PAST = { ok: true, today: '2026-10-28', trips: [
  { key: '2026-09-24|Old Trip', label: 'Old Trip', startDate: '2026-09-24', endDate: '2026-09-27' },
  { key: '2026-08-01|Summer Trip', label: 'Summer Trip', startDate: '2026-08-01', endDate: '' },
]};

async function mount(page, reply) {
  await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
  return page.evaluate(({ TRIPS, PAST, reply }) => {
    window.__calls = []; window.__release = null;
    window.fetch = (url) => {
      const q = new URL(url).searchParams, action = q.get('action'), params = {};
      q.forEach((v, k) => { if (k !== 'token') params[k] = v; });
      window.__calls.push(params);
      let body = { ok: true };
      if (action === 'test_travel_trips') body = TRIPS;
      if (action === 'past_trips') body = PAST;
      if (action === 'test_travel_trip') body = { ok: true, start: '2026-10-21', end: '2026-10-28', days: [] };
      if (action === 'test_trip_email_send') return new Promise(res => { window.__release = () => res({ json: () => Promise.resolve(reply) }); });
      return Promise.resolve({ json: () => Promise.resolve(body) });
    };
    if (typeof TestEmailsPanel !== 'function') return { error: 'TestEmailsPanel is not defined' };
    const host = document.createElement('div'); host.id = 'tprobe'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(TestEmailsPanel, { apiUrl: 'https://vera.example.test/exec', apiToken: 'tok' }));
    return { ok: true };
  }, { TRIPS, PAST, reply });
}
const settle = (page, ms) => page.waitForTimeout(ms || 300);
const txt = (page, s) => page.evaluate(s => { const n = document.querySelector(s); return n ? n.textContent : null; }, s);
const all = (page, s) => page.evaluate(s => [...document.querySelectorAll(s)].map(n => n.textContent), s);
const click = async (page, s, re) => { await page.evaluate(({ s, re }) => { const b = [...document.querySelectorAll(s)].filter(n => !re || new RegExp(re).test(n.textContent))[0]; if (b) b.click(); }, { s, re }); await settle(page, 150); };
const sends = page => page.evaluate(() => window.__calls.filter(c => c.action === 'test_trip_email_send'));
const release = async page => { await page.evaluate(() => window.__release && window.__release()); await settle(page); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of [390, 1280]) {
    console.log('\nthe pre-trip and post-trip cards @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1600 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const m = await mount(page, { ok: true, to: ['me@example.test'], subject: 'TEST · 🗺️ Pre-Trip Brief — Island Trip · Departing Fri Nov 6', count: 2 });
    if (m.error) { fail++; console.log('  FAIL ' + m.error); await page.close(); continue; }
    await settle(page, 500);
    const pre = '.test-card-pretrip ', post = '.test-card-posttrip ';

    check('a Pre-trip emails card', /Pre-trip emails/.test(await txt(page, '.test-card-pretrip') || ''));
    check('…offering the brief and the night-before email', JSON.stringify(await page.$$eval(pre + '.test-tt-kind', n => n.map(x => x.dataset.kind))) === '["pretrip_48h","pretrip_nb"]');
    const preTrips = await all(page, pre + '.test-tt-trip');
    check('…for trips still ahead, not the one under way', preTrips.length === 2 && /Island Trip/.test(preTrips[0]) && /Snow Trip/.test(preTrips[1]), JSON.stringify(preTrips));
    check('…the soonest picked', /Island/.test(await txt(page, pre + '.test-tt-trip[aria-pressed="true"]') || ''));
    check('…it says how it is built', /as if you leave in 48 hours/.test(await txt(page, pre + '.test-tt-note') || ''));
    check('…and that it goes to you', /Send test email to me/.test(await txt(page, pre + '.test-tt-send') || ''));

    await click(page, pre + '.test-tt-send');
    check('while it sends, it says so and can’t be pressed again', /Building and sending/.test(await txt(page, pre + '.test-tt-send')) && await page.$eval(pre + '.test-tt-send', b => b.disabled));
    await click(page, pre + '.test-tt-send');
    check('…one send, with the email and the trip', JSON.stringify(await sends(page)) === JSON.stringify([{ action: 'test_trip_email_send', kind: 'pretrip_48h', tripKey: '2026-11-06|Island Trip' }]), JSON.stringify(await sends(page)));
    await release(page);
    const res = await txt(page, pre + '.test-tt-result');
    check('it says what it sent', /Sent at .* to you/.test(res || '') && /Pre-Trip Brief — Island Trip/.test(res || ''), res);

    await click(page, pre + '.test-tt-kind', 'Night before');
    await click(page, pre + '.test-tt-trip', 'Snow Trip');
    check('changing the email clears the last result', !(await page.$(pre + '.test-tt-result')));
    check('…and the note follows', /as if you leave tomorrow/.test(await txt(page, pre + '.test-tt-note') || ''));
    await click(page, pre + '.test-tt-send'); await release(page);
    const s2 = (await sends(page)).slice(-1)[0];
    check('the night-before email for the trip picked', s2 && s2.kind === 'pretrip_nb' && s2.tripKey === '2026-12-19|Snow Trip', JSON.stringify(s2));

    check('a Post-trip emails card', /Post-trip emails/.test(await txt(page, '.test-card-posttrip') || ''));
    check('…offering the nudge and the recap', JSON.stringify(await page.$$eval(post + '.test-tt-kind', n => n.map(x => x.dataset.kind))) === '["posttrip_nudge","posttrip_recap"]');
    const pastTrips = await all(page, post + '.test-tt-trip');
    check('…for past trips, most recent first', pastTrips.length === 2 && /Old Trip/.test(pastTrips[0]) && /Sep 24 – Sep 27/.test(pastTrips[0]) && /Summer Trip/.test(pastTrips[1]) && /Aug 1/.test(pastTrips[1]), JSON.stringify(pastTrips));
    await click(page, post + '.test-tt-kind', 'Trip recap');
    await click(page, post + '.test-tt-send'); await release(page);
    const s3 = (await sends(page)).slice(-1)[0];
    check('the recap for the trip picked', s3 && s3.kind === 'posttrip_recap' && s3.tripKey === '2026-09-24|Old Trip', JSON.stringify(s3));
    check('the dashed "added later" list keeps only what isn’t built', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.test-emails div')].filter(d => d.style.border.indexOf('dashed') !== -1).map(d => d.firstChild.textContent))) === '["Morning nudge","Weekend memo"]');
    if (width === 390) check('no sideways scroll at phone width', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check('no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }

  console.log('\nwhen it can’t send');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 1600 } });
    await mount(page, { ok: false, error: 'That trip is no longer on the sheet or the calendar.' });
    await settle(page, 500);
    await click(page, '.test-card-posttrip .test-tt-send'); await release(page);
    check('the reason is shown', /no longer on the sheet/.test(await txt(page, '.test-card-posttrip .test-tt-error') || ''));
    check('…and nothing claims it was sent', !(await page.$('.test-card-posttrip .test-tt-result')));
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 1600 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.fetch = (url) => { const a = new URL(url).searchParams.get('action');
        const body = a === 'test_travel_trips' ? { ok: true, today: '2026-10-28', trips: [] } : a === 'past_trips' ? { ok: true, trips: [] } : { ok: true };
        return Promise.resolve({ json: () => Promise.resolve(body) }); };
      const host = document.createElement('div'); document.body.appendChild(host);
      ReactDOM.createRoot(host).render(React.createElement(TestEmailsPanel, { apiUrl: 'https://vera.example.test/exec', apiToken: 'tok' }));
    });
    await settle(page, 500);
    check('no trips ahead: it says so', /No trips coming up/.test(await txt(page, '.test-card-pretrip .test-tt-none') || '') && !(await page.$('.test-card-pretrip .test-tt-send')));
    check('no past trips: it says so', /No past trips yet/.test(await txt(page, '.test-card-posttrip .test-tt-none') || ''));
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
