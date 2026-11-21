// Drives the REAL AriaView in both dashboards at phone and desktop widths, over
// an in-page fake of aria_status: first with no sheet connected (it says how to
// connect one), then with a Watchlist and Fare Log: what needs a look, trips by
// status with scouted ones under their idea, the best fare, the line of fares
// seen, a flagged fare's warning, a safe link out, and reading again on request.
// The view never writes ARIA's tracker: the only posts are watch requests to VERA's
// own tab, from a Draft card. Every trip and fare here is invented.
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
    { tripId: 'TRIP-0001', label: 'Lake week', status: 'watching', origins: 'IAD', dests: 'ORD', returnFrom: '', earliest: '2027-04-05', latest: '2027-04-13', ceiling: 450, bestFare: 612, travelers: 2, bestSource: 'SlickTrip', verdict: 'book', tier: 'Booking window', nextCheck: '2027-02-21', lastChecked: '2027-02-18', notes: 'Nonstop preferred', ref: '', dateChange: false,
      actionType: 'BOOK_NOW', actionUrgency: 'High', actionKey: 'ARIA|TRIP-0001|BOOK_NOW', actionSince: '2027-02-18', actionNeeded: 'Book now: $612 on UA 2027-04-05–2027-04-13', bestLink: 'https://fares.example/best', email: { state: 'sent', date: '2027-02-18', text: 'Sent (1 trips)' } },
    { tripId: 'TRIP-0002', label: 'Coast hop', status: 'watching', origins: '', dests: 'SFO', earliest: '2027-05-01', latest: '2027-05-08', ceiling: null, bestFare: null, verdict: 'wait', tier: 'Weekly', ref: '', dateChange: true, notes: '',
      actionType: 'DATE_CHANGED', actionUrgency: 'Medium', actionNeeded: 'Date changed: check trip' },
    { tripId: 'TRIP-0006', label: 'Desert weekend', status: 'watching', origins: 'IAD', dests: 'PHX', earliest: '2027-03-12', latest: '2027-03-15', ceiling: 300, bestFare: 520, bestSource: 'Expedia', verdict: 'wait', tier: 'Daily', ref: '', dateChange: false, notes: '',
      actionType: 'UNDER_CEILING', actionUrgency: 'High', actionNeeded: 'Under ceiling: $520', actionSince: '2027-02-19', email: { state: 'failed', date: '2027-02-19', text: 'Draft (send failed: quota)' } },
    { tripId: '', ref: 'OPT-ABC', label: 'Spring idea', status: 'scouting', origins: 'IAD', dests: 'LIS', returnFrom: 'BCN', earliest: '2027-03-01', latest: '2027-05-31', nightsMin: 7, nightsMax: 10, bestFare: 1240, bestSource: 'SlickTrip', verdict: 'wait', tier: 'Weekly', dateChange: false, notes: '' },
    { tripId: 'TRIP-0003', label: 'Old plan', status: 'dropped', earliest: '2027-06-02', ref: '', dateChange: false, notes: '' },
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
  health: { level: 'partial', text: 'ARIA’s last run was partial: Expedia timed out', lastRun: '2027-02-20T11:52:00.000Z' },
  airline: { tiers: [{ code: 'UA', abroad: false }, { code: 'STAR', abroad: true }, { code: 'ANY', abroad: false }], premium: { pp: 75 }, star: { UA: 'United', TP: 'TAP Air Portugal', LH: 'Lufthansa' } },
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
  check(label + ': with no sheet connected it says how to connect one', /Connect ARIA’s sheet/.test(t) && /roster_link_aria/.test(t) && /Config tab/.test(t), t.slice(0, 300));
  check(label + ': …and offers no "Read again"', !(await page.$('#ariaprobe .aria-refresh')));

  await mount(page, { ok: false, configured: true, error: 'VERA couldn’t open the ARIA Travel Tracker.' });
  check(label + ': a sheet it can\'t open says so', /couldn’t open the ARIA Travel Tracker/.test(await text(page)));

  await mount(page, STATUS);
  t = await text(page);
  check(label + ': what needs a look comes before the trip list', /Needs a look · 3/i.test(t) && t.indexOf('Needs a look') < t.indexOf('WATCHING'), t.slice(0, 300));
  check(label + ': …each with why', /ARIA can’t price these/i.test(t) && /Coast hop \(2027-05-01\): Missing origin airports, a price ceiling/.test(t) && /Trips ARIA isn’t watching/i.test(t) && /Girls weekend/.test(t) && /Dates changed in VERA/i.test(t), t.slice(0, 600));
  check(label + ': the section names stand apart from the trips (small gold capitals, underlined)', await page.$$eval('#ariaprobe .aria-gap-head', ns => ns.length > 0 && ns.every(n => getComputedStyle(n).textTransform === 'uppercase' && parseFloat(getComputedStyle(n).borderBottomWidth) >= 1)));
  check(label + ': trips group by status, scouted ones under their idea', /Watching · 3/i.test(t) && /Scouting · Spring in Europe · 1/i.test(t) && t.indexOf('Watching') < t.indexOf('Scouting'), t);
  const books = await page.$$eval('#ariaprobe .aria-book', ns => ns.map(n => n.innerText));
  check(label + ': Book now comes first, then under your ceiling', books.length === 2 && /BOOK NOW/.test(books[0]) && /UNDER YOUR CEILING/.test(books[1]) && t.toUpperCase().indexOf('BOOK NOW') < t.toUpperCase().indexOf('NEEDS A LOOK'), JSON.stringify(books));
  check(label + ': the Book now card has the trip, dates, airline, since, fare and ARIA\'s words', /Lake week/.test(books[0]) && /Mon, Apr 5 → Tue, Apr 13 · UA · since 2027-02-18/.test(books[0]) && /\$612/.test(books[0]) && /Book now: \$612 on UA/.test(books[0]), books[0]);
  check(label + ': …and says the email went out', /Emailed 2027-02-18/.test(books[0]));
  check(label + ': the total is for everyone, set per person beside the per-person ceiling', /\$612\s+for 2 · \$306 pp\s+ceiling \$450 pp/.test(books[0]) && /\$520\s+total\s+ceiling \$300 pp/.test(books[1]), books.join(' | '));
  const bookHref = await page.$eval('#ariaprobe .aria-book-now .aria-book-btn', a => [a.getAttribute('href'), a.getAttribute('rel'), a.innerText]).catch(() => []);
  check(label + ': Book goes to ARIA\'s best fare link, safely', bookHref[0] === 'https://fares.example/best' && bookHref[1] === 'noopener noreferrer' && /Book/.test(bookHref[2]), JSON.stringify(bookHref));
  check(label + ': an email that didn\'t send is amber, and says the card still carries it', /Email failed/.test(books[1]) && /ARIA’s email didn’t send \(Draft \(send failed: quota\)\)/.test(books[1]), books[1]);
  check(label + ': the health chip says how ARIA\'s last run went', /ARIA’s last run was partial: Expedia timed out/.test(await page.$eval('#ariaprobe .aria-health-partial', n => n.innerText).catch(() => '')));
  check(label + ': a quieter action shows on its trip card', /→ Date changed: check trip/.test(await page.$$eval('#ariaprobe .aria-card', ns => (ns.find(n => /Coast hop/.test(n.innerText)) || { innerText: '' }).innerText)));
  const lake = await page.$$eval('#ariaprobe .aria-card', ns => (ns.find(n => /Lake week/.test(n.innerText)) || { innerText: '' }).innerText);
  check(label + ': a watched trip shows its dates, airports, verdict and best fare', /Mon, Apr 5 → Tue, Apr 13 · IAD → ORD/.test(lake) && /BOOK NOW/i.test(lake) && /\$612\s+best seen for 2 \(\$306 pp\) · SlickTrip/.test(lake) && /ceiling \$450 pp/.test(lake), lake);
  check(label + ': …the latest fare in full', /Latest, 2027-02-18: \$612 total \(\$280 pp\) · UA · nonstop · Mon, Apr 5 → Tue, Apr 13/.test(lake), lake);
  check(label + ': a United fare is tagged, and the card names the pick by your airline rule', /\bUnited\b/.test(await page.$$eval('#ariaprobe .aria-card .aria-tier', ns => ns.map(n => n.innerText).join('|'))) && /Pick: United · UA \$612 \(also the cheapest\)/.test(lake), lake);
  const scoutPick = await page.$$eval('#ariaprobe .aria-card', ns => (ns.find(n => /Lisbon → Algarve → cruise/.test(n.innerText)) || { innerText: '' }).innerText);
  check(label + ': …a trip with only a partner’s fare, read as home, says there’s no United fare yet', /No United fare logged yet; cheapest is TP \$1,240\./.test(scoutPick), scoutPick);
  check(label + ': …and the line of fares seen', !!(await page.$('#ariaprobe .aria-card .aria-spark')) && /\$612–\$692/.test(lake));
  const href = await page.$eval('#ariaprobe .aria-link', a => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]).catch(() => []);
  check(label + ': a fare link opens safely in a new tab', href[0] === 'https://fares.example/abc' && href[1] === '_blank' && href[2] === 'noopener noreferrer', JSON.stringify(href));
  const scout = await page.$$eval('#ariaprobe .aria-card', ns => (ns.find(n => /Lisbon → Algarve → cruise/.test(n.innerText)) || { innerText: '' }).innerText);
  check(label + ': a scouted row is named for its option, with its window and nights', /Leaving Mar 1 – May 31 · 7–10 nights · IAD → LIS, home from BCN/.test(scout) && /From the trip idea "Spring in Europe"/.test(scout), scout);
  check(label + ': fares show in whole dollars', /\$1,240\s+best seen/.test(scout) && /\$1,240 total \(\$590 pp\)/.test(scout), scout);
  check(label + ': a flagged fare says what it leaves out', /⚠ without bag fees/.test(scout) && /⚠ fare type unknown/.test(scout), scout);
  const coast = await page.$$eval('#ariaprobe .aria-card', ns => (ns.find(n => /Coast hop/.test(n.innerText)) || { innerText: '' }).innerText);
  check(label + ': a row with no fare says so, and a changed date is flagged', /No fare yet/.test(coast) && /The dates changed in VERA/.test(coast), coast);
  const coastCard = await page.$$('#ariaprobe .aria-card');
  let stopAt = -1; for (let i = 0; i < coastCard.length; i++) if (/Coast hop/.test(await coastCard[i].innerText())) stopAt = i;
  check(label + ': a watched trip on the ARIA page has Stop watching beside ✎ Change', stopAt !== -1 && !!(await coastCard[stopAt].$('.ts-aria-stop')) && !!(await coastCard[stopAt].$('.aria-change')));
  if (stopAt !== -1) { await (await coastCard[stopAt].$('.ts-aria-stop')).evaluate(n => n.click()); await wait(60); await (await coastCard[stopAt].$('.aria-stop-drop')).evaluate(n => n.click()); await wait(150); }
  const sp2 = await page.evaluate(() => window.__posts[window.__posts.length - 1]);
  check(label + ': …Drop it there sends the trip with how=drop', sp2 && sp2.action === 'aria_request_withdraw' && sp2.tripId === 'TRIP-0002' && sp2.how === 'drop' && sp2.startDate === '2027-05-01', JSON.stringify(sp2));
  await page.evaluate(() => { window.__posts = []; });   // the rest of the page is read only
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

  // A booked trip: no fare to find, so no "No fare yet", ceiling or the note ARIA left while deciding.
  await mount(page, Object.assign({}, STATUS, { watchlist: [{ tripId: 'TRIP-0009', label: 'Anniversary trip', status: 'booked', earliest: '2027-03-06', latest: '2027-03-15', ceiling: 980, bestFare: null,
    tier: 'Weekly', nextCheck: '2026-11-01', notes: 'Ceiling seeded from the flights budget. Likely booked, confirm before watching.', ref: '', dateChange: false }], fares: [], gaps: { count: 0 } }));
  const bk = await page.$$eval('#ariaprobe .aria-card', ns => (ns.find(n => /Anniversary trip/.test(n.innerText)) || { innerText: '' }).innerText);
  check(label + ': a booked trip says its flights are booked, under Booked', /Booked · 1/i.test(await text(page)) && /✈️ Flights booked/.test(bk), bk);
  await mount(page, Object.assign({}, STATUS, { watchlist: [{ tripId: 'TRIP-0010', label: 'Old anniversary', status: 'booked', earliest: '2026-11-06', latest: '2026-11-15', ref: '', dateChange: false, notes: '' },
    { tripId: 'TRIP-0011', label: 'Old watch', status: 'watching', earliest: '2027-01-02', latest: '2027-02-19', ref: '', dateChange: false, notes: '' },
    { tripId: 'TRIP-0012', label: 'Ends today', status: 'booked', earliest: '2027-02-10', latest: '2027-02-20', ref: '', dateChange: false, notes: '' }], fares: [], gaps: { count: 0 } }));
  const pastT = await text(page);
  check(label + ': trips that have already ended don\'t show at all, booked or not; one ending today still does', !/Old anniversary|Old watch/.test(pastT) && /Ends today/.test(pastT), pastT.slice(0, 400));
  await mount(page, Object.assign({}, STATUS, { watchlist: [{ tripId: 'TRIP-0009', label: 'Anniversary trip', status: 'booked', earliest: '2027-03-06', latest: '2027-03-15', ceiling: 980, bestFare: null,
    tier: 'Weekly', nextCheck: '2026-11-01', notes: 'Ceiling seeded from the flights budget. Likely booked, confirm before watching.', ref: '', dateChange: false }], fares: [], gaps: { count: 0 } }));
  check(label + ': …with no "No fare yet", ceiling, checks, or the note ARIA left before it was booked', !/No fare yet|ceiling|next check|Weekly|confirm before watching/.test(bk), bk);
  await mount(page, Object.assign({}, STATUS, { watchlist: [{ tripId: 'TRIP-0009', label: 'Anniversary trip', status: 'booked', earliest: '2027-03-06', latest: '2027-03-15', ceiling: 980, bestFare: 1700, travelers: 2, ref: '', dateChange: false, notes: '' }], fares: [], gaps: { count: 0 } }));
  check(label + ': …and the last fare ARIA saw, if it saw one, as a quiet note', /✈️ Flights booked\s+last fare ARIA saw \$1,700/.test(await text(page)));
  await mount(page, Object.assign({}, STATUS, { watchlist: [{ tripId: 'TRIP-0009', label: 'Anniversary trip', status: 'booked', earliest: '2027-03-06', latest: '2027-03-15', ref: '', dateChange: false, notes: '', lodging: { have: 9, total: 9, kinds: ['cruise'] } }], fares: [], gaps: { count: 0 } }));
  check(label + ': lodging from VERA shows under the flights, all nights covered', /✈️ Flights booked\s+🛏️ 9 of 9 nights covered \(cruise\)/.test(await text(page)), await text(page));
  await mount(page, Object.assign({}, STATUS, { watchlist: [{ tripId: 'TRIP-0009', label: 'Anniversary trip', status: 'booked', earliest: '2027-03-06', latest: '2027-03-15', ref: '', dateChange: false, notes: '', lodging: { have: 7, total: 9, kinds: ['cruise', 'arranged_stay'] } }], fares: [], gaps: { count: 0 } }));
  check(label + ': …and a gap points to the trip\'s Summary, in amber', /🛏️ 7 of 9 nights covered: see the trip’s Summary/.test(await text(page)) && await page.$eval('#ariaprobe .aria-lodging', n => getComputedStyle(n).color) === 'rgb(246, 210, 122)');
  if (process.env.SHOT_DIR) { const el = await page.$('#ariaprobe'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/aria-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }

  // A Draft card: Watch with ARIA opens the trip Summary's form, filled by trip_aria; it writes a request, never the tracker
  await page.evaluate(() => {
    document.querySelectorAll('#ariaprobe').forEach(n => n.remove());
    window.__gets = []; window.__posts = []; window.__asked = false;
    const draft = { tripId: 'TRIP-6BBE', label: 'Chicago Trip', status: 'draft', earliest: '2027-04-05', latest: '2027-04-13', tripKey: '2027-04-05|Chicago Trip', notes: 'Confirm airports', dateChange: false, ref: '' };
    window.apiGet = (u, t, q) => { window.__gets.push(Object.assign({}, q));
      if (q.action === 'trip_aria') return Promise.resolve({ ok: true, tripId: 'TRIP-6BBE', configured: true, row: draft, fares: [], request: null,
        draft: { origins: 'IAD, DCA, BWI', dests: '', earliest: '2027-04-05', latest: '2027-04-13', flexDays: 1, travelers: 2, ceiling: 360 }, plan: null,
        airlines: { home: 'United (UA) first, then any airline', abroad: 'United (UA) first, then Star Alliance, then any airline', premium: '$75 per person' } });
      return Promise.resolve({ ok: true, configured: true, watchlist: [draft], fares: [], gaps: { count: 0 }, ideas: {}, health: { level: 'ok', text: 'ARIA ran' },
        requests: window.__asked ? [{ kind: 'watch', status: 'active', tripId: 'TRIP-6BBE', origins: 'IAD, DCA, BWI', dests: 'ORD', updated: '2026-10-26T01:00:00Z' }] : [] }); };
    window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b))); if (b.action === 'aria_request_watch') window.__asked = true; if (b.action === 'aria_request_withdraw') window.__asked = false; return Promise.resolve({ ok: true }); };
    window.__set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const host = document.createElement('div'); host.id = 'ariaprobe'; host.style.padding = '0 12px'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(AriaView, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
  }); await wait(200);
  check(label + ': a Draft card offers Watch with ARIA', !!(await page.$('#ariaprobe .aria-draft-watch-btn')));
  await page.evaluate(() => window.__q('.aria-draft-watch-btn').click()); await wait(150);
  const ta = await page.evaluate(() => window.__gets.find(q => q.action === 'trip_aria'));
  check(label + ': …which asks VERA for this trip\'s prefilled form', ta && ta.tripId === 'TRIP-6BBE' && ta.tripKey === '2027-04-05|Chicago Trip' && ta.startDate === '2027-04-05' && ta.endDate === '2027-04-13', JSON.stringify(ta));
  const fv = await page.evaluate(() => ['origins', 'dests', 'travelers', 'ceiling', 'flexDays'].map(k => (document.querySelector('#ariaprobe .ts-aria-' + k) || {}).value));
  check(label + ': the form opens filled, on the card', JSON.stringify(fv) === JSON.stringify(['IAD, DCA, BWI', '', '2', '360', '1']), JSON.stringify(fv));
  const ph = await page.evaluate(() => [window.__q('.ts-aria-airlinePref').placeholder, window.__q('.ts-aria-premium').placeholder, window.__q('.ts-aria-airlinePref').value]);
  check(label + ': the form shows your airline rule for home and abroad, blank to keep it', ph[0] === 'United (UA) first, then any airline · abroad: United (UA) first, then Star Alliance, then any airline' && ph[1] === '$75' && ph[2] === '', JSON.stringify(ph));
  await page.evaluate(() => window.__set(window.__q('.ts-aria-dests'), 'ORD')); await wait(40);
  await page.evaluate(() => window.__set(window.__q('.ts-aria-airlinePref'), 'United only')); await wait(40);
  await page.evaluate(() => window.__q('.ts-aria-send').click()); await wait(250);
  const wp = await page.evaluate(() => window.__posts.find(p => p.action === 'aria_request_watch'));
  check(label + ': Ask ARIA to watch sends a request for the trip (VERA\'s tab, not ARIA\'s tracker)', wp && wp.tripId === 'TRIP-6BBE' && wp.dests === 'ORD' && wp.startDate === '2027-04-05' && String(wp.ceiling) === '360' && wp.airlinePref === 'United only', JSON.stringify(wp));
  check(label + ': …the tab reads ARIA again, fresh', (await page.evaluate(() => window.__gets.filter(q => q.action === 'aria_status' && q.refresh === '1').length)) >= 1);
  const asked = await page.$eval('#ariaprobe .aria-draft-asked', n => n.innerText).catch(() => '');
  check(label + ': …and the card says it was asked, and when ARIA acts', /Asked ARIA 2026-10-26 to watch IAD, DCA, BWI → ORD\. It moves this to Watching on its next 06:52 run\./.test(asked), asked);
  await page.evaluate(() => window.__q('.aria-draft-stop').click()); await wait(250);
  const wd = await page.evaluate(() => window.__posts.find(p => p.action === 'aria_request_withdraw'));
  check(label + ': Stop watching withdraws it by trip, and the button comes back', wd && wd.tripId === 'TRIP-6BBE' && !!(await page.$('#ariaprobe .aria-draft-watch-btn')));
  check(label + ': no sideways scroll with the form on a card', await noScroll(page));
  if (process.env.SHOT_DIR) { await page.evaluate(() => window.__q('.aria-draft-watch-btn').click()); await wait(150); const el = await page.$('#ariaprobe .aria-card'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/aria-draft-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }

  // Home: the banner shows what to book, and nothing at all otherwise
  const banner = async (reply) => { await page.evaluate((reply) => {
      document.querySelectorAll('#ariaprobe').forEach(n => n.remove()); window.__nav = '';
      window.apiGet = () => Promise.resolve(JSON.parse(JSON.stringify(reply)));
      const host = document.createElement('div'); host.id = 'ariaprobe'; document.body.appendChild(host);
      ReactDOM.createRoot(host).render(React.createElement(AriaBookBanner, { apiUrl: 'https://vera.test/exec', apiToken: 't', onNavigate: t => { window.__nav = t; } }));
    }, reply); await wait(200); return page.$eval('#ariaprobe', n => n.innerText); };
  t = await banner(STATUS);
  check(label + ': Home leads with ARIA\'s fares to book', /ARIA · 2 fares to look at/i.test(t) && /BOOK NOW/.test(t) && /Lake week/.test(t) && /Desert weekend/.test(t), t.slice(0, 300));
  await page.evaluate(() => window.__q('.aria-banner-open').click()); await wait(50);
  check(label + ': …and opens Travel', (await page.evaluate(() => window.__nav)) === 'travel');
  check(label + ': no sideways scroll with the Home banner', await noScroll(page));
  if (process.env.SHOT_DIR) { const el = await page.$('#ariaprobe'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/aria-home-' + label.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
  const quiet = JSON.parse(JSON.stringify(STATUS)); quiet.watchlist.forEach(w => { w.actionType = ''; });
  check(label + ': nothing to book: no banner at all', (await banner(quiet)).trim() === '');
  check(label + ': ARIA not connected: no banner', (await banner({ ok: true, configured: false })).trim() === '');
  check(label + ': ARIA unreadable: no banner, and Home doesn\'t break', (await banner({ ok: false, error: 'x' })).trim() === '');
  await page.evaluate(() => { document.querySelectorAll('#ariaprobe').forEach(n => n.remove()); window.apiGet = () => { throw new Error('offline'); };
    const host = document.createElement('div'); host.id = 'ariaprobe'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(AriaBookBanner, { apiUrl: 'https://vera.test/exec', apiToken: 't' })); }); await wait(150);
  check(label + ': …even when the request itself throws', (await page.$eval('#ariaprobe', n => n.innerText)).trim() === '');

  // Side by side: cheapest with a carry-on (flip through up to 3 airlines) vs your airline
  const cmp = await page.evaluate(() => {
    const cfg = { tiers: [{ code: 'UA' }, { code: 'STAR', abroad: true }, { code: 'ANY' }], star: { UA: 'United' }, premium: { pp: 75 } };
    const d = '2026-11-21', old = '2026-11-20';
    const F = [{ tripId: 'T', dateSeen: d, airline: 'Frontier (F9)', total: 461, farePP: 231, stops: 0, depart: '2026-12-17', ret: '2027-01-05', flags: ['carry-on included in fare'], link: 'https://fares.test/a' },
      { tripId: 'T', dateSeen: d, airline: 'Frontier (F9)', total: 311, farePP: 156, stops: 0, flags: ['basic fare'] },
      { tripId: 'T', dateSeen: d, airline: 'Allegiant (G4)', total: 300, farePP: 150, stops: 0, flags: ['excl. bags'] },
      { tripId: 'T', dateSeen: d, airline: 'Spirit (NK)', total: 498, farePP: 249, stops: 1 },
      { tripId: 'T', dateSeen: d, airline: 'Spirit (NK)', total: 520, farePP: 260, stops: 0 },
      { tripId: 'T', dateSeen: d, airline: 'American (AA)', total: 640, farePP: 320, stops: 0, flags: ['basic fare $300 excluded'] },
      { tripId: 'T', dateSeen: d, airline: 'Southwest (WN)', total: 700, farePP: 350, stops: 0 },
      { tripId: 'T', dateSeen: d, airline: 'UA 1234', total: 834, farePP: 417, stops: 0, depart: '2026-12-16', ret: '2026-12-30' },
      { tripId: 'T', dateSeen: old, airline: 'Delta (DL)', total: 200, farePP: 100, stops: 0 }];
    const c = ariaCompare_(F, cfg, false, 2);
    return { cheap: c.cheap.map(f => f.airline), mine: c.mine && c.mine.airline, tier: c.tier, none: ariaCompare_(F.filter(f => !/^UA/.test(f.airline)), cfg, false, 2) };
  });
  check(label + ': the cheap side is the 3 cheapest airlines with a carry-on, from the latest day, never basic or bags-extra fares', JSON.stringify(cmp.cheap) === JSON.stringify(['Frontier (F9)', 'Spirit (NK)', 'American (AA)']), JSON.stringify(cmp));
  check(label + ': …against the best fare on your airline', cmp.mine === 'UA 1234' && cmp.tier === 'United' && cmp.none && cmp.none.mine === null && cmp.none.cheap.length === 3, JSON.stringify(cmp));
  await page.evaluate(() => { document.querySelectorAll('#ariaprobe').forEach(n => n.remove());
    const cfg = { tiers: [{ code: 'UA' }, { code: 'ANY' }], star: { UA: 'United' }, premium: { pp: 75 } }, d = '2026-11-21';
    const F = [{ tripId: 'T', dateSeen: d, airline: 'Frontier (F9)', total: 461, farePP: 231, stops: 0, link: 'https://fares.test/a' }, { tripId: 'T', dateSeen: d, airline: 'Spirit (NK)', total: 498, farePP: 249, stops: 1 },
      { tripId: 'T', dateSeen: d, airline: 'UA 1234', total: 834, farePP: 417, stops: 0 }];
    const host = document.createElement('div'); host.id = 'ariaprobe'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(AriaCompare, { cmp: ariaCompare_(F, cfg, false, 2) })); }); await wait(150);
  let ct = await page.$eval('#ariaprobe', n => n.innerText);
  check(label + ': the two cards say what they are, price per person and for both, and the gap', /CHEAPEST WITH A CARRY-ON\s*1\/2/.test(ct) && /Frontier \(F9\)\s*\$231\s*pp · \$461 for 2/.test(ct) && /YOUR AIRLINE · UNITED/.test(ct) && /\$417\s*pp · \$834 for 2/.test(ct) && /\+\$186 pp vs this cheap option/.test(ct), ct);
  await page.evaluate(() => document.querySelector('#ariaprobe .aria-cmp-next').click()); await wait(60);
  ct = await page.$eval('#ariaprobe', n => n.innerText);
  check(label + ': › flips to the next cheap airline, and the gap follows', /2\/2/.test(ct) && /Spirit \(NK\)/.test(ct) && /\+\$168 pp vs this cheap option/.test(ct), ct);
  const lay = await page.evaluate(() => { const host = document.querySelector('#ariaprobe'), at = w => { host.style.width = w + 'px'; const c = host.querySelectorAll('.aria-cmp-card'); return c[0].getBoundingClientRect().top === c[1].getBoundingClientRect().top; };
    const r = { card: at(377), phone: at(330) }; host.style.width = ''; return r; });
  check(label + ': side by side in a computer-width ARIA card, stacked in a phone-width one', lay.card === true && lay.phone === false, JSON.stringify(lay));
  check(label + ': no sideways scroll with the comparison', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
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
