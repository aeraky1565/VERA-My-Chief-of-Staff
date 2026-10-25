// Renders the REAL TripSummaryView in both dashboards at phone and desktop
// widths over an invented Lisbon–Porto trip, and drives the full dashboard's
// ItineraryView: Summary opens first, and tapping a red day lands on that day
// in Agenda. Asserted as you'd see it: red and amber pills, the cities, Needs
// attention in order with today's decision wording, the sleep bands, the
// check-in reminder, flight detail on tap, Trip details folding open, and no
// sideways scroll.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// Dates are set relative to today so the countdown and check-in text stay true.
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const D = i => iso(20 + i);   // the trip starts 20 days from now
const FX = {
  trip: { tripKey: 'fx|Vacation: Lisbon & Porto', label: 'Vacation: Lisbon & Porto', startDate: D(0), endDate: D(7) },
  meta: { context: 'Vacation', outboundMode: 'flight', returnMode: 'flight' },
  items: [
    { id: 'f1', type: 'flight', title: 'TP 204 · IAD → LIS', date: D(0), startTime: '18:05', endTime: '06:40', location: 'IAD', metadata: '{}' },
    { id: 'h1', type: 'hotel', title: 'Alfama hotel', date: D(1), location: 'Rua X 12, 1100-001 Lisboa, Portugal', metadata: JSON.stringify({ checkoutDate: D(4) }) },
    { id: 's1', type: 'city_tour', title: 'Sintra', date: D(2), startTime: '09:00', endTime: '12:00', location: 'Sintra, Portugal' },
    { id: 's2', type: 'museum', title: 'Tile museum', date: D(2), startTime: '15:00', location: 'Lisbon, Portugal' },
    { id: 'c1', type: 'car', title: 'Taxi to the station', date: D(4), startTime: '10:30', endTime: '10:40', location: 'Alfama hotel' },
    { id: 't1', type: 'train', title: 'Train · Lisbon → Porto', date: D(4), startTime: '11:09', endTime: '14:05', location: 'Santa Apolonia' },
    { id: 'd1', type: 'dining', title: 'Fado tavern', date: D(3), startTime: '20:00', metadata: JSON.stringify({ tentative: true, optionGroup: 'g1', isRepresentative: true, optionCount: 2, decisionStatus: 'open', decideBy: iso(-1) }) },
    { id: 'h2', type: 'hotel', title: 'Ribeira hotel', date: D(6), location: 'Cais 1, 4050-510 Porto, Portugal', metadata: JSON.stringify({ checkoutDate: D(7) }) },
    { id: 'f2', type: 'flight', title: 'LH 1179 · OPO → FRA → IAD', date: D(7), startTime: '11:20', endTime: '18:55', location: 'OPO', metadata: '{}' },
  ],
  legs: [{ from: 'Alfama hotel', to: 'Santa Apolonia', driveMins: 35 }],
  docs: { ok: true, home: 'United States', countries: [
    { country: 'Portugal', role: 'stay', from: D(0), via: [], worst: 'amber', travelers: [
      { name: 'Ahmed', passports: [{ passportCountry: 'United States', color: 'green', label: 'Visa Free (90 days)', passport: { status: 'ok', label: 'Valid until 2030-01-01', ruleMonths: 3, ruleKnown: true } }] },
      { name: 'Victoria', passports: [{ passportCountry: 'United States', color: 'green', label: 'Visa Free (90 days)', passport: { status: 'short', label: 'Valid until 2027-01-21: 2 months after you\'re back, Portugal asks for 3', ruleMonths: 3, ruleKnown: true } }] }] },
    { country: 'Germany', role: 'layover', from: D(7), via: ['FRA'], worst: 'red', travelers: [
      { name: 'Ahmed', passports: [{ passportCountry: 'Egypt', color: 'red', label: 'Visa Required', passport: { status: 'ok', label: 'Valid until 2030-01-01', ruleMonths: 3, ruleKnown: true } }] }] }] },
  statuses: { f1: { status: 'scheduled', delay_min: 45, dep_scheduled: '18:05', dep_estimated: '18:50', gate: 'B12', terminal: '1' } },
};

async function mount(page) {
  return page.evaluate((fx) => {
    document.querySelectorAll('#tsprobe').forEach(n => n.remove());
    if (typeof TripSummaryView !== 'function') return { error: 'TripSummaryView is not defined' };
    const host = document.createElement('div'); host.id = 'tsprobe'; document.body.appendChild(host);
    window.__opened = [];
    ReactDOM.createRoot(host).render(React.createElement(TripSummaryView, { trip: fx.trip, items: fx.items, legs: fx.legs, meta: fx.meta, statuses: fx.statuses,
      insights: { origin_code: 'IAD', dest_code: 'LIS', tz_offset_label: '+5h' }, onGoToPacking: () => { window.__opened.push('packing'); },
      documents: fx.docs, onOpenDay: d => { window.__opened.push(d); }, details: React.createElement('span', { className: 'probe-editors' }, 'Trip editors') }));
    return new Promise(r => setTimeout(() => r({}), 300));
  }, FX);
}
const text = page => page.$eval('#tsprobe', n => n.innerText);
// The page's own Connect dialog sits over the probe, so clicks are made in the page.
const tap = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function assertSummary(page) {
  const r = await mount(page);
  check('TripSummaryView is available', !r.error, r.error);
  if (r.error) return;
  const pills = await page.$$eval('#tsprobe .ts-pill', ns => ns.map(n => ({ cls: n.className, text: n.innerText.replace(/\s+/g, ' ').trim() })));
  check('a pill per day', pills.length === 8, pills.length);
  check('the two empty nights are red', pills.filter(p => /ts-red/.test(p.cls)).length === 2 && /ts-red/.test(pills[4].cls) && /ts-red/.test(pills[5].cls), JSON.stringify(pills.map(p => p.cls)));
  check('the decision day is amber', /ts-amber/.test(pills[3].cls));
  check('pills show the city; travel days show where they go', /Lisboa/.test(pills[1].text) && /→ Porto/.test(pills[4].text) && /→ Home/.test(pills[7].text), JSON.stringify(pills.map(p => p.text)));
  const t = await text(page);
  check('the countdown', /Leaves in 20 days/.test(t), t.slice(0, 80));
  check('booked so far: 4 of 6 nights', /Nights with a place to sleep\s*4 of 6/.test(t));
  const attn = await page.$$eval('#tsprobe .ts-attn', ns => ns.map(n => n.className + ' | ' + n.innerText.replace(/\s+/g, ' ')));
  check('needs attention: red, then amber (documents included)', attn.length === 5 && /ts-attn-red/.test(attn[0]) && /No place to sleep in Porto/.test(attn[0]) && /ts-attn-amber/.test(attn[1]), JSON.stringify(attn));
  check('the decision keeps today\'s wording', attn.some(a => /Still deciding — 2 options · decide by .+ · overdue/.test(a)), JSON.stringify(attn));
  check('sleep bands: in the air, a stay, nothing booked, a stay', (await page.$$eval('#tsprobe .ts-stay', ns => ns.map(n => n.className.split(' ').pop()))).join() === 'ts-stay-air,ts-stay-stay,ts-stay-gap,ts-stay-stay');
  check('a flight not yet live says when it will be', /Live status from/.test(t));
  check('a check-in reminder under the flight', /Online check-in usually opens 24 h before/.test(t));
  check('Useful to know and Packing are under Before you go', /Useful to know/.test(t) && /IAD → LIS · \+5h/.test(t));
  check('no sideways scroll', await noScroll(page));

  // Documents
  const chips = await page.$$eval('#tsprobe .ts-doc-country', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
  check('a chip per country: role and worst status', chips.length === 2 && /Portugal Stay Check/.test(chips[0]) && /Germany Layover · FRA Action needed/.test(chips[1]), JSON.stringify(chips));
  let dt = await page.$eval('#tsprobe .ts-docs', n => n.innerText);
  check('the first country\'s check shows each traveler\'s visa and passport', /Ahmed/.test(dt) && /Victoria/.test(dt) && /Visa Free \(90 days\)/.test(dt) && /Renew soon/.test(dt) && /Valid for trip/.test(dt), dt.slice(0, 300));
  check('the Schengen rule is named', /Passport rule for Portugal: valid 3 months past the day you leave the Schengen area/.test(dt));
  await page.evaluate(() => { const sel = document.querySelector('#tsprobe .ts-doc-select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, 'Germany'); sel.dispatchEvent(new Event('change', { bubbles: true })); });
  await new Promise(r => setTimeout(r, 80));
  dt = await page.$eval('#tsprobe .ts-docs', n => n.innerText);
  check('the dropdown switches to another country', /Visa Required/.test(dt) && /Egypt passport/.test(dt) && !/Victoria/.test(dt), dt.slice(0, 300));
  const at = await page.$$eval('#tsprobe .ts-attn', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
  check('passport and visa problems are in Needs attention', at.some(a => /Passport: renew soon: Victoria \(United States passport\)/.test(a)) && at.some(a => /Visa required for Germany \(layover\)/.test(a)), JSON.stringify(at));

  await tap(page, '#tsprobe .ts-red');
  await tap(page, '#tsprobe .ts-attn-amber');
  await tap(page, '#tsprobe .ts-packing');
  const opened = await page.evaluate(() => window.__opened);
  check('tapping a red pill or an attention entry opens that day; Packing opens packing', opened[0] === D(4) && opened[1] === D(4) && opened[2] === 'packing', JSON.stringify(opened));

  check('the flight status shows, and is tappable', /Delayed \+45min/.test(t));
  await page.evaluate(() => Array.from(document.querySelectorAll('#tsprobe .ts-move button')).find(b => /Delayed/.test(b.innerText)).click());
  await new Promise(r => setTimeout(r, 80));
  check('tapping it opens gate and times', /Gate \/ Terminal\s*B12 \/ 1/.test(await text(page)) && /Est 18:50 \(\+45min\)/.test(await text(page)));

  check('Trip details start folded', !(await page.$('#tsprobe .probe-editors')));
  await tap(page, '#tsprobe .ts-details-btn');
  await new Promise(r => setTimeout(r, 60));
  check('…and open on tap, showing the editors', !!(await page.$('#tsprobe .probe-editors')));
}

async function assertAgenda(page, root, withLegs) {
  const heads = await page.$$eval(root + ' .ts-dayhead', ns => ns.map(n => getComputedStyle(n).backgroundColor + '|' + getComputedStyle(n).position));
  check('a header per day, sticky', heads.length === 8 && heads.every(h => /\|sticky$/.test(h)), JSON.stringify(heads));
  check('headers take their pill\'s colour: red on the empty nights, amber on the decision day', heads[4].startsWith('rgb(58, 18, 24)') && heads[5].startsWith('rgb(58, 18, 24)') && heads[3].startsWith('rgb(51, 40, 15)') && !heads[1].startsWith('rgb(58'), JSON.stringify(heads));
  check('a red "No place to sleep tonight" slot on each empty night', (await page.$$(root + ' .ts-slot-nostay')).length === 2);
  check('"+ Add to <day>" after every day', (await page.$$(root + ' .ts-add-day')).length === 8);
  const t = await page.$eval(root, n => n.innerText);
  check('free time sits inside its day', /\d+h( \d+m)? free/.test(t));
  if (withLegs) check('a tight connection sits between the two items it squeezes', /Tight connection: "Train · Lisbon → Porto" is ~35 min away, with 29 min to get there/.test(t), t.slice(0, 200));
  await tap(page, root + ' .ts-add-item');
  await page.evaluate((r) => document.querySelector(r + ' .ts-slot-nostay button').click(), root);
  await page.evaluate((r) => document.querySelectorAll(r + ' .ts-add-day')[2].click(), root);
  const adds = await page.evaluate(() => window.__adds);
  check('+ Add item opens a blank form; Add a stay opens a hotel on that night; + Add to <day> sets the date',
        adds[0] === 'blank' && adds[1].date === D(4) && adds[1].type === 'hotel' && adds[2].date === D(2) && !adds[2].type, JSON.stringify(adds));
  check('no sideways scroll in Agenda', await noScroll(page));
}

// The real ActiveTravelCard on Home, mid-trip, with the API stubbed: the today
// pieces (leave-by, Next up, tonight) render inside it.
async function assertHomeCard(page) {
  const pad = n => String(n).padStart(2, '0');
  const r = await page.evaluate(([iso0, isoM2, isoM3, isoP3]) => new Promise(done => {
    // Pin the page's clock to 09:00 today, so "an hour from now" never runs past midnight.
    const RealDate = window.__RealDate || (window.__RealDate = Date);
    const nine = new RealDate(); nine.setHours(9, 0, 0, 0);
    window.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(nine.getTime()); } static now() { return nine.getTime(); } };
    const now = new Date(); const at = m => { const t = now.getHours() * 60 + now.getMinutes() + m; return String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
    const items = [
      { id: 'h1', type: 'hotel', title: 'Alfama hotel', date: isoM2, location: 'Rua X 12, Lisboa, Portugal', metadata: JSON.stringify({ checkoutDate: iso0 }) },
      { id: 'c1', type: 'car', title: 'Taxi to the station', date: iso0, startTime: at(60), endTime: at(70), location: 'Rua X 12, Lisboa, Portugal' },
      { id: 't1', type: 'train', title: 'Train to Porto', date: iso0, startTime: at(100), location: 'Santa Apolonia' },
      { id: 'a1', type: 'dining', title: 'Dinner in Ribeira', date: iso0, startTime: at(400), location: 'Ribeira, Porto' } ];
    window.apiGet = (u, t, q) => Promise.resolve(q.action === 'itinerary' ? { ok: true, items } : q.action === 'travel_legs' ? { legs: [{ from: 'Rua X 12, Lisboa, Portugal', to: 'Santa Apolonia', driveMins: 35 }] } : { ok: false });
    const host = document.createElement('div'); host.id = 'homeprobe'; host.style.display = 'grid'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(ActiveTravelCard, { trip: { label: 'Lisbon & Porto', startDate: isoM3, endDate: isoP3 }, apiUrl: 'https://vera.test/exec', apiToken: 't', onViewItinerary: () => {}, travelConfig: {} }));
    setTimeout(() => { window.Date = RealDate; }, 900);
    setTimeout(() => done({ text: host.innerText, leave: !!host.querySelector('.ts-leaveby'), next: !!host.querySelector('.ts-nextup'), none: !!host.querySelector('.ts-tonight-none') }), 600);
  }), [iso(0), iso(-2), iso(-3), iso(3)]);
  check('the travel card shows when to leave for the next stop', r.leave && /Leave by \d\d:\d\d/i.test(r.text) && /For Train to Porto at/.test(r.text) && /About 35 min by car/.test(r.text), r.text.slice(0, 300));
  check('…what is left of today', r.next && /Next up today/i.test(r.text) && /Taxi to the station/.test(r.text) && /Dinner in Ribeira/.test(r.text));
  check('…and that tonight has nowhere to sleep', r.none && /Tonight: no place to sleep booked/.test(r.text));
  check('…without also saying the day is empty', !/No itinerary items for today/.test(r.text));
  check('no sideways scroll with the travel card', await noScroll(page));
}

// Share or export, opened from Agenda's toolbar, with the API, new windows and
// downloads all recorded instead of done.
async function assertShare(page, lite) {
  await page.evaluate(([fx, lite]) => new Promise(done => {
    window.__get = []; window.__post = []; window.__win = null; window.__blob = null;
    window.apiGet = (u, t, q) => { window.__get.push(q); return Promise.resolve(q.action === 'trip_sheet' ? { ok: true, title: 'Lisbon & Porto', html: '<div><b>Trip sheet</b></div>' }
      : q.action === 'trip_ics' ? { ok: true, filename: 'lisbon-porto.ics', ics: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' } : { ok: false }); };
    window.apiPost = (u, t, b) => { window.__post.push(b); return Promise.resolve({ ok: true, sent: 2 }); };
    window.open = () => { const w = { written: '', printed: false, closed: false, document: { open() {}, close() {}, write(x) { w.written += x; } }, focus() {}, print() { w.printed = true; }, close() { w.closed = true; } }; window.__win = w; return w; };
    URL.createObjectURL = b => { window.__blob = b; return 'blob:x'; }; URL.revokeObjectURL = () => {};
    const host = document.createElement('div'); host.id = 'shprobe'; document.body.appendChild(host); const noop = () => {};
    const el = lite ? React.createElement(ItineraryDayView, { trip: fx.trip, itinerary: { items: fx.items }, legs: [], meta: fx.meta, who: 'Both', apiUrl: 'https://vera.test/exec', apiToken: 't', busy: false, onAdd: noop, onEdit: noop, onDelete: noop, onDecide: noop, onReopen: noop })
      : React.createElement(ItineraryView, { trip: fx.trip, itinerary: { items: fx.items }, loading: false, busy: false, tripContext: fx.meta, onAdd: noop, onEdit: noop, onDelete: noop, onSetContext: noop, onSetBriefing: noop, onSetTraveler: noop, onSetMode: noop, onLoadContext: noop, onGoToPacking: noop, apiUrl: 'https://vera.test/exec', apiToken: 't' });
    ReactDOM.createRoot(host).render(el);
    setTimeout(() => { if (!lite) Array.from(host.querySelectorAll('button')).find(b => /Agenda/.test(b.innerText)).click(); setTimeout(done, 200); }, 300);
  }), [FX, lite]);
  check('Agenda\'s toolbar has Share or export', !!(await page.$('#shprobe .ts-share-open')));
  await tap(page, '#shprobe .ts-share-open');
  await new Promise(r => setTimeout(r, 100));
  check('it opens the share window on Email', !!(await page.$('#shprobe .ts-share')) && /Send to/.test(await page.$eval('#shprobe .ts-share', n => n.innerText)));
  check('no sideways scroll with it open', await noScroll(page));
  const setVal = (sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, [sel, v]);
  await setVal('#shprobe .ts-share-to', 'mom@example.test, dad@example.test');
  await setVal('#shprobe .ts-share-note', 'Here we are');
  await tap(page, '#shprobe .ts-share-send');
  await new Promise(r => setTimeout(r, 150));
  let st = await page.evaluate(() => ({ post: window.__post, msg: (document.querySelector('#shprobe .ts-share-msg') || {}).innerText }));
  const pb = st.post[0] || {};
  check('Send posts the trip, the addresses, the note and the defaults: no confirmations, no notes, calendar file attached',
        pb.action === 'trip_share_email' && String(pb.to).replace(/\s/g, '') === 'mom@example.test,dad@example.test' && pb.note === 'Here we are' && pb.tripKey === FX.trip.tripKey
        && pb.include.stays === true && pb.include.confirmations === false && pb.include.notes === false && pb.attachIcs === true && pb.who === 'Both', JSON.stringify(pb));
  check('…and says who it went to', /Sent to 2 people\. You got a copy\./.test(st.msg || ''), st.msg);
  await page.evaluate(() => Array.from(document.querySelectorAll('#shprobe .ts-share-mode')).find(b => /Calendar file/.test(b.innerText)).click());
  await new Promise(r => setTimeout(r, 60));
  await tap(page, '#shprobe .ts-share-ics');
  await new Promise(r => setTimeout(r, 150));
  st = await page.evaluate(() => ({ get: window.__get.filter(q => q.action === 'trip_ics'), blob: window.__blob && window.__blob.type, msg: (document.querySelector('#shprobe .ts-share-msg') || {}).innerText }));
  check('Calendar file downloads one .ics for the trip', st.get.length === 1 && st.get[0].tripKey === FX.trip.tripKey && st.blob === 'text/calendar' && /Downloaded lisbon-porto\.ics/.test(st.msg || ''), JSON.stringify(st));
  await page.evaluate(() => Array.from(document.querySelectorAll('#shprobe .ts-share-mode')).find(b => /Print/.test(b.innerText)).click());
  await new Promise(r => setTimeout(r, 60));
  await tap(page, '#shprobe .ts-share-print');
  await new Promise(r => setTimeout(r, 500));
  st = await page.evaluate(() => ({ get: window.__get.filter(q => q.action === 'trip_sheet'), win: window.__win && { printed: window.__win.printed, written: window.__win.written } }));
  check('Print opens the trip sheet in its own window and prints it, without confirmations', st.get.length === 1 && st.get[0].conf === '0' && st.win.printed && /Trip sheet/.test(st.win.written), JSON.stringify(st.get));
  await page.evaluate(() => Array.from(document.querySelectorAll('#shprobe .ts-share-mode')).find(b => /Save offline/.test(b.innerText)).click());
  await new Promise(r => setTimeout(r, 60));
  await tap(page, '#shprobe .ts-share-pdf');
  await new Promise(r => setTimeout(r, 500));
  st = await page.evaluate(() => window.__get.filter(q => q.action === 'trip_sheet'));
  check('Save offline asks for the copy with confirmations and notes', st.length === 2 && st[1].conf === '1' && st[1].notes === '1', JSON.stringify(st));
  await tap(page, '#shprobe .ts-share-close');
  await new Promise(r => setTimeout(r, 60));
  check('Close closes it', !(await page.$('#shprobe .ts-share')));
  await page.evaluate(() => document.getElementById('shprobe').remove());
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
    await assertSummary(page);
    const calls = await page.evaluate((fx) => new Promise(r => {
      window.__calls = []; window.apiGet = (u, t, p) => { window.__calls.push(p); return Promise.resolve(fx.docs); };
      const host = document.createElement('div'); document.body.appendChild(host);
      ReactDOM.createRoot(host).render(React.createElement(TripSummaryView, { trip: fx.trip, items: fx.items, apiUrl: 'https://vera.test/exec', apiToken: 't' }));
      setTimeout(() => { r({ calls: window.__calls, text: host.innerText }); host.remove(); }, 300);
    }), FX);
    check('Summary loads the trip\'s documents itself, once', calls.calls.length === 1 && calls.calls[0].action === 'trip_documents' && calls.calls[0].tripKey === FX.trip.tripKey && calls.calls[0].endDate === FX.trip.endDate && /Documents: passports and visas/i.test(calls.text), JSON.stringify(calls.calls));

    // The real ItineraryView: Summary first; a red day opens Agenda at that day.
    await page.evaluate((fx) => {
      document.querySelectorAll('#ivprobe').forEach(n => n.remove());
      const host = document.createElement('div'); host.id = 'ivprobe'; document.body.appendChild(host);
      const noop = () => {}; window.__adds = [];
      ReactDOM.createRoot(host).render(React.createElement(ItineraryView, { trip: fx.trip, itinerary: { items: fx.items }, loading: false, busy: false,
        tripContext: fx.meta, onAdd: d => { window.__adds.push(d === undefined ? 'blank' : d); }, onEdit: noop, onDelete: noop, onSetContext: noop, onSetBriefing: noop, onSetTraveler: noop, onSetMode: noop,
        onLoadContext: noop, onGoToPacking: noop, apiUrl: '', apiToken: '' }));
    }, FX);
    await new Promise(r => setTimeout(r, 300));
    check('ItineraryView opens on Summary', !!(await page.$('#ivprobe .trip-summary')));
    check('the trip editors live in Summary\'s Trip details, not the header', !!(await page.$('#ivprobe .ts-details-btn')));
    await tap(page, '#ivprobe .ts-red');
    await new Promise(r => setTimeout(r, 300));
    const landed = await page.evaluate((id) => { const el = document.getElementById(id); return !!el && !document.querySelector('#ivprobe .trip-summary'); },
      await page.evaluate((a) => tsDayId_(a[0], a[1]), [FX.trip.tripKey, D(4)]));
    check('tapping a red day switches to Agenda, where that day is', landed);
    await assertAgenda(page, '#ivprobe', false);
    await assertHomeCard(page);
    await assertShare(page, false);
    check('no page errors', errs.length === 0, errs.join(' | '));
    await page.close();

    console.log('\ndashboard-lite @ ' + width + 'px');
    page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith('https://vera.test/')) return route.fulfill({ contentType: 'text/html', body: lite });
      for (const n of Object.keys(vendor)) if (url.includes(n)) return route.fulfill({ contentType: 'application/javascript', body: vendor[n] });
      return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
    });
    await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 'test-token'); });
    await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
    await assertSummary(page);
    // lite's real Agenda, given the cached drive times
    await page.evaluate((fx) => {
      const host = document.createElement('div'); host.id = 'agprobe'; document.body.appendChild(host); window.__adds = [];
      const noop = () => {};
      ReactDOM.createRoot(host).render(React.createElement(ItineraryDayView, { trip: fx.trip, itinerary: { items: fx.items }, legs: fx.legs, meta: fx.meta, busy: false,
        onAdd: d => { window.__adds.push(d === undefined ? 'blank' : d); }, onEdit: noop, onDelete: noop, onDecide: noop, onReopen: noop }));
    }, FX);
    await new Promise(r => setTimeout(r, 300));
    await assertAgenda(page, '#agprobe', true);
    await assertHomeCard(page);
    await assertShare(page, true);
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
