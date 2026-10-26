// Drives the REAL trip Summary (TripSummaryView) in both dashboards at phone and
// desktop widths, over an in-page fake of trip_aria: "Still to book" with ARIA on
// the trip's flights (a Draft: the prefilled watch form, asking, stopping; a
// Watching row with its fares; a Book now card), "The plan" from a settled trip
// idea ticked off by the trip's own bookings, a booked trip, ARIA not connected,
// and a trip that's over. Every trip, fare and ID here is invented.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const TRIP = { tripId: 'TRIP-SET1', tripKey: '2027-05-29|Spring in Europe', label: 'Spring in Europe', startDate: '2027-05-29', endDate: '2027-06-11' };
const ITEMS = [{ id: 'i1', type: 'flight', title: 'TP 218 IAD → LIS', date: '2027-05-29', startTime: '18:40', location: 'IAD' },
  { id: 'i2', type: 'hotel', title: 'Casa Lisbon Baixa', location: 'Rua X 12, Lisbon, Portugal', date: '2027-05-30', metadata: JSON.stringify({ checkoutDate: '2027-06-02' }) },
  { id: 'i3', type: 'cruise', title: 'Board the ship', location: 'Cádiz, Spain', date: '2027-06-04', metadata: JSON.stringify({ checkoutDate: '2027-06-11' }) }];
const DRAFT = { origins: 'IAD, DCA', dests: '', earliest: TRIP.startDate, latest: TRIP.endDate, flexDays: 1, travelers: 2, ceiling: 360 };
const PLAN = { idea: { id: 'IDEA-1', title: 'Spring in Europe', budget: 13000 }, option: { id: 'OPT-9', name: 'Lisbon → Algarve → cruise', cost: { flights: { low: 1400, high: 1800 }, cruise: { low: 4000, high: 6000 } },
  legs: [{ kind: 'move', mode: 'fly', from: 'Home', to: 'LIS' }, { kind: 'stop', place: 'Lisbon', nights: 3 }, { kind: 'move', mode: 'car', from: 'Lisbon', to: 'Lagos' },
    { kind: 'stop', place: 'Algarve', nights: 3 }, { kind: 'move', mode: 'ship', from: 'Cádiz', to: 'Barcelona' }, { kind: 'stop', place: 'Cruise', nights: 7 }, { kind: 'move', mode: 'fly', from: 'BCN', to: 'Home' }] } };

async function mount(page, replies, opts) {
  await page.evaluate(({ replies, trip, items }) => {
    document.querySelectorAll('#taprobe').forEach(n => n.remove());
    window.__gets = []; window.__posts = []; window.__n = 0;
    window.apiGet = (u, t, q) => { window.__gets.push(Object.assign({}, q)); if (q.action !== 'trip_aria') return Promise.resolve({ ok: false });
      const r = replies[Math.min(window.__n++, replies.length - 1)]; return Promise.resolve(JSON.parse(JSON.stringify(r))); };
    window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b))); return Promise.resolve({ ok: true }); };
    window.__set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    window.__q = s => document.querySelector('#taprobe ' + s);
    const host = document.createElement('div'); host.id = 'taprobe'; host.style.padding = '0 12px'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(TripSummaryView, { trip, items, documents: { ok: true, home: 'United States', countries: [] }, apiUrl: 'https://vera.test/exec', apiToken: 't' }));
  }, { replies, trip: (opts && opts.trip) || TRIP, items: (opts && opts.items) || ITEMS });
  await wait(250);
}
const text = page => page.$eval('#taprobe', n => n.innerText);
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function scenario(page, label, width) {
  const draftRow = { tripId: 'TRIP-SET1', label: 'Spring in Europe', status: 'draft' };
  const asked = { ok: true, tripId: 'TRIP-SET1', configured: true, row: draftRow, fares: [], request: { kind: 'watch', status: 'active', origins: 'IAD, DCA', dests: 'LIS', created: '2027-02-20T12:00:00Z', updated: '2027-02-20T12:00:00Z' }, draft: DRAFT, plan: null };
  await mount(page, [{ ok: true, tripId: 'TRIP-SET1', configured: true, row: draftRow, fares: [], request: null, draft: DRAFT, plan: null }, asked]);
  let t = await text(page);
  check(label + ': a future trip shows what is still to book', /STILL TO BOOK/i.test(t) && /FLIGHTS · 🧭 ARIA/.test(t), t.slice(0, 200));
  check(label + ': …ARIA has it as a Draft, with a Watch button', /ARIA has this trip as a Draft: it isn’t pricing it yet/.test(t) && !!(await page.$('#taprobe .ts-aria-watch')));
  const g = await page.evaluate(() => window.__gets.find(q => q.action === 'trip_aria'));
  check(label + ': it asks for this trip by ID, key and dates', g && g.tripId === 'TRIP-SET1' && g.tripKey === TRIP.tripKey && g.startDate === '2027-05-29' && g.endDate === '2027-06-11', JSON.stringify(g));
  check(label + ': the nights with nowhere to sleep say they aren\'t watched', /night(s)? with no place to sleep · not watched \(ARIA watches flights for now\)/.test(t));
  await page.evaluate(() => window.__q('.ts-aria-watch').click()); await wait(80);
  const vals = await page.evaluate(() => ['origins', 'dests', 'travelers', 'ceiling', 'flexDays'].map(k => (document.querySelector('#taprobe .ts-aria-' + k) || {}).value));
  check(label + ': the form comes prefilled from what VERA knows', JSON.stringify(vals) === JSON.stringify(['IAD, DCA', '', '2', '360', '1']), JSON.stringify(vals));
  check(label + ': …and says ARIA won\'t overwrite what you typed in its Watchlist', /ARIA fills only what’s still blank in its Watchlist/.test(await text(page)));
  await page.evaluate(() => window.__set(window.__q('.ts-aria-dests'), 'LIS')); await wait(40);
  await page.evaluate(() => window.__q('.ts-aria-send').click()); await wait(200);
  const p = await page.evaluate(() => window.__posts.pop());
  check(label + ': Ask ARIA to watch sends the trip and the form', p && p.action === 'aria_request_watch' && p.tripId === 'TRIP-SET1' && p.tripKey === TRIP.tripKey && p.startDate === '2027-05-29'
    && p.dests === 'LIS' && p.origins === 'IAD, DCA' && String(p.ceiling) === '360' && String(p.flexDays) === '1', JSON.stringify(p));
  t = await text(page);
  check(label + ': …then says when ARIA starts', /Asked ARIA 2027-02-20 to watch IAD, DCA → LIS\. It starts on its next 06:52 run\./.test(t), t.slice(0, 400));
  await page.evaluate(() => window.__q('.ts-aria-stop').click()); await wait(150);
  const st = await page.evaluate(() => window.__posts.pop());
  check(label + ': Stop watching withdraws it by trip', st && st.action === 'aria_request_withdraw' && st.tripId === 'TRIP-SET1');
  check(label + ': no sideways scroll with the form', await noScroll(page));

  const watching = { tripId: 'TRIP-SET1', label: 'Spring in Europe', status: 'watching', bestFare: 1840, travelers: 2, verdict: 'wait', lastChecked: '2027-02-18', ceiling: 900, actionNeeded: 'Needs watch setup' };
  const fares = [{ tripId: 'TRIP-SET1', dateSeen: '2027-02-10', total: 1990 }, { tripId: 'OPT-9', dateSeen: '2027-02-12', total: 1910 }, { tripId: 'TRIP-SET1', dateSeen: '2027-02-18', total: 1840 }];
  await mount(page, [{ ok: true, tripId: 'TRIP-SET1', configured: true, row: watching, fares, request: { kind: 'watch', status: 'active' }, draft: DRAFT, plan: PLAN }]);
  t = await text(page);
  check(label + ': a watched trip shows ARIA\'s best fare, verdict, check and ceiling', /\$1,840 for 2 · WAIT · checked 2027-02-18 · ceiling \$900 pp/.test(t), t.slice(0, 500));
  check(label + ': …ARIA\'s next action, and the line of fares (scouted ones included)', /→ Needs watch setup/.test(t) && !!(await page.$('#taprobe .ts-aria .aria-spark')) && /\$1,840–\$1,990/.test(t));
  const plan = await page.$eval('#taprobe .ts-plan', n => n.innerText).catch(() => '');
  check(label + ': the settled plan shows, each piece ticked by the trip\'s own bookings', /THE PLAN · FROM TRIP IDEAS/i.test(plan) && /Lisbon → Algarve → cruise · 13 nights/.test(plan)
    && /Home → LIS\s*✅ booked/.test(plan) && /Lisbon · 3 nights\s*✅ booked/.test(plan) && /Algarve · 3 nights\s*⏳ not booked/.test(plan) && /Cádiz → Barcelona\s*✅ booked/.test(plan) && /BCN → Home\s*⏳ not booked/.test(plan), plan);
  check(label + ': …with the planned cost by category against the budget, and that nothing is added to the itinerary', /Flights\s*\$1\.4k – \$1\.8k\s*—/.test(plan) && /Total\s*\$5\.4k – \$7\.8k\s*—/.test(plan) && /Budget \$13k · the plan fits/.test(plan) && /Nothing is added to your itinerary/.test(plan), plan.slice(-400));
  if (process.env.SHOT_DIR) { const el = await page.$('#taprobe .ts-plan'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/tripaira-plan-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
  if (process.env.SHOT_DIR) { const el = await page.$('#taprobe .ts-still'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/tripaira-still-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
  check(label + ': no sideways scroll with the plan', await noScroll(page));
  const opened = await page.evaluate(() => new Promise(r => { const f = e => { window.removeEventListener('vera-open-idea', f); r(e.detail); }; window.addEventListener('vera-open-idea', f);
    window.__q('.ts-plan .ts-plan-idea').click(); setTimeout(() => r(null), 300); }));
  check(label + ': "Open the idea" asks the Travel tab for that idea', opened && opened.ideaId === 'IDEA-1', JSON.stringify(opened));

  await mount(page, [{ ok: true, tripId: 'TRIP-SET1', configured: true, row: watching, fares, request: null, draft: DRAFT, plan: PLAN, actuals: { flights: 1640, lodging: 4210.5 } }]);
  const paid = await page.$eval('#taprobe .ts-plan', n => n.innerText).catch(() => '');
  check(label + ': once booked, what was paid sits beside the plan, and the budget left', /Flights\s*\$1\.4k – \$1\.8k\s*\$1,640/.test(paid) && /Stays & cruise\s*\$4k – \$6k\s*\$4,211/.test(paid) && /Total\s*\$5\.4k – \$7\.8k\s*\$5,851/.test(paid)
    && /Budget \$13k · \$7,149 left · paid from your booking confirmations/.test(paid), paid.slice(-400));
  if (process.env.SHOT_DIR) { const el = await page.$('#taprobe .ts-plan'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/tripaira-paid-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
  await mount(page, [{ ok: true, tripId: 'TRIP-SET1', configured: true, row: watching, fares, request: null, draft: DRAFT, plan: Object.assign({}, PLAN, { idea: Object.assign({}, PLAN.idea, { budget: 5000 }) }), actuals: { flights: 1640, lodging: 4210.5 } }]);
  check(label + ': …and says so plainly when it\'s already over', /Budget \$5k · over by \$851 already/.test(await page.$eval('#taprobe .ts-plan', n => n.innerText).catch(() => '')));
  const book = Object.assign({}, watching, { actionType: 'BOOK_NOW', actionUrgency: 'High', actionNeeded: 'Book now: $1,640 on TP', bestFare: 1640, bestLink: 'https://fares.example/best' });
  await mount(page, [{ ok: true, tripId: 'TRIP-SET1', configured: true, row: book, fares, request: null, draft: DRAFT, plan: null }]);
  check(label + ': Book now shows ARIA\'s Book card, with the Book button', /BOOK NOW/.test(await text(page)) && (await page.$eval('#taprobe .ts-aria .aria-book-btn', a => a.getAttribute('href')).catch(() => '')) === 'https://fares.example/best');

  const both = ITEMS.concat([{ id: 'i4', type: 'flight', title: 'TP 205 BCN → IAD', date: '2027-06-11', startTime: '11:00', location: 'BCN' }]);
  await mount(page, [{ ok: true, tripId: 'TRIP-SET1', configured: true, row: watching, fares, request: null, draft: DRAFT, plan: null }], { items: both });
  check(label + ': flights booked out and back: it says so, and that VERA tells ARIA', /✅ Booked out and back\. VERA tells ARIA, so it stops pricing them\./.test(await text(page)));

  await mount(page, [{ ok: true, tripId: 'TRIP-SET1', configured: false, row: null, fares: [], request: null, draft: DRAFT, plan: null }]);
  check(label + ': ARIA not connected: it says how', /Connect ARIA \(Config → roster_link_aria\)/.test(await text(page)) && !(await page.$('#taprobe .ts-aria-watch')));

  await mount(page, [{ ok: true, tripId: 'TRIP-OLD', configured: true, row: draftRow, fares: [], request: null, draft: DRAFT, plan: PLAN }], { trip: { tripId: 'TRIP-OLD', tripKey: '2025-05-01|Old', label: 'Old', startDate: '2025-05-01', endDate: '2025-05-05' }, items: [] });
  check(label + ': a trip that\'s over shows neither, and asks for nothing', !(await page.$('#taprobe .ts-still')) && !(await page.$('#taprobe .ts-plan')) && !(await page.evaluate(() => window.__gets.some(q => q.action === 'trip_aria'))));

  await mount(page, [{ ok: false, error: 'x' }]);
  check(label + ': trip_aria unreadable: no ARIA sections, the Summary still works', !(await page.$('#taprobe .ts-still')) && /EVERY DAY AT A GLANCE/i.test(await text(page)));
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
