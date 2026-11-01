// My Trips (issue #220), in both dashboards: the panel is mounted for real with a
// fake server, and every screen is clicked through. The two copies of the
// block must match. Invented trips throughout.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;
const APP = fs.readFileSync(path.resolve(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const block = s => { const a = s.indexOf('// ---- MyTripsPanel'), b = s.indexOf('// ---- end MyTripsPanel ----');
  return a === -1 || b === -1 ? null : s.slice(a, b); };
console.log('\nthe shared block');
check('both dashboards carry the block', !!block(APP) && !!block(LITE));
check('…and the two copies match', block(APP) === block(LITE));
check('the full dashboard mounts it on My Trips', /sub==='trips'&&React\.createElement\(MyTripsPanel,\{apiUrl:apiUrl,apiToken:apiToken/.test(APP));
check('the lite dashboard mounts it on My Trips', /travSub === 'trips' && <MyTripsPanel apiUrl=\{apiUrl\} apiToken=\{apiToken\}/.test(LITE));
check('both keep their own calendar-trip cards', /renderUpcoming:function\(\)/.test(APP) && /renderUpcoming=\{\(\) => \(trips\.length === 0/.test(LITE));
check('both mark a tentative calendar trip', /myTripsTentative\(t\.label\)\?' mt-tentative'/.test(APP) && /\{myTripsTentative\(t\.label\) && <span className="mt-tentative-chip"/.test(LITE));

const months = (() => { const out = []; for (let i = 0; i < 15; i++) { const m = 10 + i; out.push((2026 + Math.floor(m / 12)) + '-' + String(m % 12 + 1).padStart(2, '0')); } return out; })();
const strip = months.map(ym => ({ ym, firm: ym === '2026-11' ? ['Island Trip'] : [], tentative: ym === '2027-02' ? ['Potential Ski weekend'] : [],
  loose: ym === '2027-04' ? ['Spring in Japan', 'Family Visit to Egypt'] : ym === '2027-03' ? ['Spring in Japan'] : ym === '2027-11' ? ['Family Visit to Egypt'] : [],
  other: ym === '2027-11' ? ['a leave block'] : [] }));
const RESP = {
  my_trips: { ok: true, today: '2026-11-01',
    upcoming: [{ label: 'Island Trip', startDate: '2026-11-06', endDate: '2026-11-15', daysAway: 5, tripKey: '2026-11-06|Island Trip', tentative: false },
               { label: 'Potential Ski weekend', startDate: '2027-02-12', endDate: '2027-02-15', daysAway: 103, tripKey: '2027-02-12|Potential Ski weekend', tentative: true }],
    pencilled: [
      { id: 'I-MTL', title: 'Weekend in Montreal', exact: false, months: [], passedMonths: ['2026-09', '2026-10'], anyTime: false, days: 3, pto: 1, options: 0, expired: true, first: '', pickBy: '', settle: null, notSame: [] },
      { id: 'I-JAPAN', title: 'Spring in Japan', exact: false, months: ['2027-03', '2027-04'], passedMonths: [], anyTime: false, nightsMin: 8, nightsMax: 12, days: 13, pto: 9, options: 3, expired: false, first: '2027-03-01', pickBy: '2026-12-07', settle: null, notSame: [] },
      { id: 'I-EGYPT', title: 'Family Visit to Egypt', where: 'Cairo', travelers: 'Both', note: 'See everyone', exact: false, months: ['2027-04', '2027-11'], passedMonths: [], anyTime: false, nightsMin: 9, nightsMax: 9, days: 10, pto: 6, options: 0, expired: false, first: '2027-04-01', pickBy: '2027-01-07', settle: null, notSame: [] },
      { id: 'I-WED', title: 'Cousin wedding', exact: true, exactStart: '2027-11-18', exactEnd: '2027-11-22', months: [], passedMonths: [], anyTime: false, days: 5, pto: 3, options: 0, expired: false, first: '2027-11-18', pickBy: '', settle: null, notSame: [] }],
    strip,
    clashes: [{ ym: '2027-04', kind: 'pencilled', text: 'Spring in Japan and Family Visit to Egypt both look at April 2027.' },
              { ym: '2027-11', kind: 'other', text: 'November 2027 overlaps a leave block.' }],
    matches: [{ ideaId: 'I-EGYPT', ideaTitle: 'Family Visit to Egypt', tripId: 'TRIP-1', label: 'Egypt', startDate: '2027-04-10', endDate: '2027-04-19', tripKey: '2027-04-10|Egypt' }],
    past: [{ key: '2026-10-21|Lake Trip', label: 'Lake Trip', startDate: '2026-10-21', endDate: '2026-10-28' },
           { key: '2026-06-19|Mountain Cruise', label: 'Mountain Cruise', startDate: '2026-06-19', endDate: '2026-07-04' },
           { key: '2025-12-20|Winter Visit', label: 'Winter Visit', startDate: '2025-12-20', endDate: '2025-12-30' }],
    ideas: [{ id: 'I-JAPAN', title: 'Spring in Japan', months: ['2027-03', '2027-04'], nightsMin: 8, nightsMax: 12, status: 'shortlisted', options: 3, pulledIn: true },
            { id: 'I-ALPS', title: 'Hiking in the Alps', months: ['2027-07'], nightsMin: 7, status: 'brainstorming', options: 0, pulledIn: false },
            { id: 'I-SAF', title: 'Safari someday', months: [], status: 'brainstorming', options: 0, pulledIn: false }] },
  my_trip_windows: { ok: true, id: 'I-EGYPT', nights: 9, windows: [
    { month: '2027-04', best: { start: '2027-04-09', end: '2027-04-18', people: [{ name: 'Ahmed', days: 6 }, { name: 'Victoria', days: 6 }], clash: '', holidays: [] } },
    { month: '2027-11', best: { start: '2027-11-05', end: '2027-11-14', people: [{ name: 'Ahmed', days: 5 }, { name: 'Victoria', days: 6 }], clash: '', holidays: ['Veterans Day'] } }] },
  get_trip_budget: { ok: true, summary: { budgeted: 3500, actual: 3140, tripBudget: 3500, travellers: 2 } },
  get_trip_gifts: { ok: true, gifts: [{ id: 'g1', purchased: true }, { id: 'g2', purchased: 'false' }] },
};

async function mount(page) {
  return page.evaluate(resp => {
    document.querySelectorAll('.modal-overlay, #mtprobe').forEach(n => n.remove());
    if (typeof MyTripsPanel !== 'function') return { error: 'MyTripsPanel is not defined' };
    window.__get = []; window.__post = []; window.__ics = []; window.__gifts = [];
    window.apiGet = (u, t, params) => { window.__get.push(params); return Promise.resolve(JSON.parse(JSON.stringify(resp[params.action] || { ok: false }))); };
    window.apiPost = (u, t, body) => { window.__post.push(body); return Promise.resolve(body.op === 'choose'
      ? { ok: true, idea: { id: body.id, settle: { optionId: '', start: body.start, end: body.end, label: body.label } } }
      : body.action === 'my_trip_pencil' ? { ok: true, idea: { id: 'I-NEW' } } : { ok: true }); };
    window.tiDownload_ = (name, text) => window.__ics.push({ name, text });
    window.scrollTo = () => {};
    window.confirm = () => true;
    const host = document.createElement('div'); host.id = 'mtprobe'; document.body.prepend(host);
    window.__root = ReactDOM.createRoot(host);
    window.__root.render(React.createElement(MyTripsPanel, { apiUrl: 'https://vera.test/exec', apiToken: 't', onGoGifts: k => window.__gifts.push(k || 'gifts'),
      renderUpcoming: list => React.createElement('div', { className: 'mt-up-probe' }, list.map(t => t.label + (myTripsTentative(t.label) ? ' (tentative)' : '')).join(' | ')) }));
    return new Promise(res => setTimeout(() => res({ ok: true }), 300));
  }, RESP);
}
const q = (page, sel) => page.evaluate(s => { const n = document.querySelector('#mtprobe ' + s); return n ? n.textContent : null; }, sel);
const qa = (page, sel) => page.evaluate(s => Array.from(document.querySelectorAll('#mtprobe ' + s)).map(n => n.textContent), sel);
const click = async (page, sel, i) => { await page.evaluate(({ s, i }) => document.querySelectorAll('#mtprobe ' + s)[i || 0].click(), { s: sel, i }); await page.waitForTimeout(120); };
const posts = page => page.evaluate(() => window.__post);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  for (const [label, kind] of [['full dashboard', 'full'], ['dashboard-lite', 'lite']]) {
    for (const width of [390, 1280]) {
      console.log('\n' + label + ' @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      if (kind === 'lite') {
        await page.route('**/*', r => { const u = r.request().url();
          for (const n of Object.keys(vendor)) if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
          if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: LITE });
          return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' }); });
        await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else {
        await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      }
      const m = await mount(page);
      if (m.error) { fail++; console.log('  FAIL ' + m.error); await page.close(); continue; }

      // ---- the list ----
      check('it reads my_trips', (await page.evaluate(() => window.__get.map(g => g.action))).indexOf('my_trips') !== -1);
      check('the summary line counts both lists', /2 on the calendar · 4 pencilled in · next is Island Trip in 5 days/.test(await q(page, '')), (await q(page, '')).slice(0, 120));
      check('the strip has 15 months', (await qa(page, '.mt-month')).length === 15);
      const kinds = await page.evaluate(() => Array.from(document.querySelectorAll('#mtprobe .mt-month')).map(n => n.dataset.ym + ':' +
        n.querySelector('.mt-cell-firm').dataset.kind + ':' + n.querySelector('.mt-cell-loose').dataset.n + ':' + n.querySelector('.mt-cell-other').dataset.n));
      check('calendar, tentative, pencilled and leave marks land in their months', kinds.indexOf('2026-11:firm:0:0') !== -1 && kinds.indexOf('2027-02:tent:0:0') !== -1 &&
            kinds.indexOf('2027-04:none:2:0') !== -1 && kinds.indexOf('2027-11:none:1:1') !== -1, kinds.join(' '));
      const clashes = await qa(page, '.mt-clash');
      check('the clashes are spelled out', clashes.length === 2 && /both look at April 2027/.test(clashes[0]) && /overlaps a leave block/.test(clashes[1]), clashes.join(' / '));
      check('the dashboard draws its own calendar cards, tentative marked', (await q(page, '.mt-up-probe')) === 'Island Trip | Potential Ski weekend (tentative)', await q(page, '.mt-up-probe'));
      const cards = await qa(page, '.mt-pencilled-card');
      check('three open pencilled trips, soonest first', cards.length === 3 && /^Spring in Japan/.test(cards[0]) && /^Family Visit to Egypt/.test(cards[1]) && /^Cousin wedding/.test(cards[2]), cards.join(' / '));
      check('a Trip Idea says so; known dates say so', /Trip Idea/.test(cards[0]) && /3 options in Trip Ideas/.test(cards[0]) && /Dates known/.test(cards[2]) && /Not booked yet/.test(cards[2]), cards[0] + ' / ' + cards[2]);
      check('a pencilled card shows its months, length, pick-by and PTO', /April 2027/.test(cards[1]) && /November 2027/.test(cards[1]) && /about 10 days/.test(cards[1]) &&
            /Pick dates by Thu, Jan 7/.test(cards[1]) && /about 6 PTO days each/.test(cards[1]), cards[1]);
      check('Trip Ideas lengths stay in nights', /8–12 nights/.test(cards[0]), cards[0]);
      const exp = await q(page, '.mt-expired');
      check('a trip whose months passed asks to move or drop', /Months passed/.test(exp) && /September 2026 and October 2026 went by without dates/.test(exp) && /Move to Sep–Oct 2027/.test(exp), exp);
      await click(page, '.mt-roll');
      check('Move sends roll', JSON.stringify((await posts(page)).slice(-1)[0]) === JSON.stringify({ action: 'my_trip_update', id: 'I-MTL', op: 'roll' }), JSON.stringify(await posts(page)));
      await click(page, '.mt-drop');
      check('Drop sends drop', (await posts(page)).slice(-1)[0].op === 'drop');
      const pastRows = await qa(page, '.mt-past > div .mt-past-row');
      check('past trips: this year first, older behind a button', pastRows.length === 2 && /Lake Trip/.test(pastRows[0]) && /Show 2025/.test(await q(page, '.mt-older')), pastRows.join(' / '));
      await click(page, '.mt-older');
      check('…which shows 2025', (await qa(page, '.mt-past > div .mt-past-row')).length === 3);
      check('the match banner names both trips', /Egypt.*looks like Family Visit to Egypt/.test(await q(page, '.mt-match-banner')), await q(page, '.mt-match-banner'));

      // ---- the match ----
      await click(page, '.mt-match-banner');
      const mt = await q(page, '.mt-match');
      check('the match screen asks the question', /Is this your Family Visit to Egypt\?/.test(mt) && /New on your calendar/.test(mt) && /April 2027 or November 2027/.test(mt), mt.slice(0, 200));
      await click(page, '.mt-match-yes');
      check('Yes links them', JSON.stringify((await posts(page)).slice(-1)[0]) === JSON.stringify({ action: 'my_trip_update', id: 'I-EGYPT', op: 'link', tripId: 'TRIP-1' }));
      await page.waitForTimeout(150);
      check('…and goes back to the list', !!(await q(page, '.mt-strip')));
      await click(page, '.mt-match-banner'); await click(page, '.mt-match-no');
      check('No remembers they differ', JSON.stringify((await posts(page)).slice(-1)[0]) === JSON.stringify({ action: 'my_trip_update', id: 'I-EGYPT', op: 'not_same', tripId: 'TRIP-1' }));
      await page.waitForTimeout(150);

      // ---- pencil in ----
      await click(page, '.mt-pencil-btn');
      check('the form opens', /Pencil in a trip/.test(await q(page, '.mt-form')));
      check('the save waits for a name and a month', await page.evaluate(() => document.querySelector('#mtprobe .mt-form-save').disabled));
      await page.fill('#mtprobe .mt-in-title', 'Family reunion');
      await click(page, '.mt-month-chip[data-ym="2027-06"]'); await click(page, '.mt-month-chip[data-ym="2027-08"]');
      check('picked months read as alternatives', /June 2027 or August 2027/.test(await q(page, '.mt-form')), (await q(page, '.mt-form')).slice(0, 300));
      await click(page, '.mt-more');
      check('the length steps', (await q(page, '.mt-days')) === 'about 8 days');
      await click(page, '.mt-form-save');
      const pin = (await posts(page)).slice(-1)[0];
      check('Pencil it in sends the trip', pin.action === 'my_trip_pencil' && pin.trip.title === 'Family reunion' && JSON.stringify(pin.trip.months) === '["2027-06","2027-08"]' &&
            pin.trip.days === 8 && pin.trip.travelers === 'Both' && pin.trip.exactStart === '', JSON.stringify(pin));
      await page.waitForTimeout(150);
      await mount(page);
      await click(page, '.mt-pencil-btn'); await page.fill('#mtprobe .mt-in-title', 'Cousin wedding');
      await click(page, '.mt-mode-exact');
      await page.fill('#mtprobe .mt-in-from', '2027-11-18'); await page.fill('#mtprobe .mt-in-to', '2027-11-22');
      await click(page, '.mt-form-save');
      const ex = (await posts(page)).slice(-1)[0];
      check('exact dates are sent with no months', ex.trip.exactStart === '2027-11-18' && ex.trip.exactEnd === '2027-11-22' && ex.trip.months.length === 0, JSON.stringify(ex));
      await mount(page);

      // ---- a pencilled trip ----
      await click(page, '.mt-pencilled-card', 1);
      await page.waitForTimeout(200);
      const d = await q(page, '.mt-detail');
      check('the detail opens with its note and reminder', /Family Visit to Egypt/.test(d) && /See everyone/.test(d) && /pick dates by Thu, Jan 7, 2027/.test(d), d.slice(0, 300));
      check('it asks for the best dates per month', (await page.evaluate(() => window.__get.filter(g => g.action === 'my_trip_windows').map(g => g.id))).join() === 'I-EGYPT');
      const wins = await qa(page, '.mt-window');
      check('each month shows its best fit and PTO', wins.length === 2 && /Best fit: Fri, Apr 9 – Sun, Apr 18, 2027/.test(wins[0]) && /Ahmed 6 PTO days, Victoria 6 PTO days/.test(wins[0]) &&
            /Takes in Veterans Day/.test(wins[1]), wins.join(' / '));
      await click(page, '.mt-choose');
      check('choosing prefills the best fit', await page.evaluate(() => document.querySelector('#mtprobe .mt-c-from').value + '|' + document.querySelector('#mtprobe .mt-c-to').value) === '2027-04-09|2027-04-18');
      await page.fill('#mtprobe .mt-c-to', '2027-04-19');
      await click(page, '.mt-ics');
      await page.waitForTimeout(150);
      const ch = (await posts(page)).slice(-1)[0];
      check('Download sends the chosen dates', ch.op === 'choose' && ch.start === '2027-04-09' && ch.end === '2027-04-19' && ch.label === 'Family Visit to Egypt', JSON.stringify(ch));
      const ics = await page.evaluate(() => window.__ics);
      check('…and hands back a one-event calendar file', ics.length === 1 && /DTSTART;VALUE=DATE:20270409/.test(ics[0].text) && /DTEND;VALUE=DATE:20270420/.test(ics[0].text) &&
            /SUMMARY:Family Visit to Egypt/.test(ics[0].text), ics[0] && ics[0].text.slice(0, 300));
      await mount(page); await click(page, '.mt-pencilled-card', 1); await page.waitForTimeout(150);
      await click(page, '.mt-drop-month', 1);
      const dm = (await posts(page)).slice(-1)[0];
      check('Drop this month keeps the other', dm.action === 'my_trip_pencil' && JSON.stringify(dm.trip.months) === '["2027-04"]' && dm.trip.id === 'I-EGYPT', JSON.stringify(dm));
      await mount(page); await click(page, '.mt-pencilled-card', 1); await page.waitForTimeout(150);
      await click(page, '.mt-unpull');
      check('Not this year un-pulls it', (await posts(page)).slice(-1)[0].op === 'unpull');
      await mount(page); await click(page, '.mt-pencilled-card', 1); await page.waitForTimeout(150);
      await click(page, '.mt-delete');
      check('Delete deletes the idea', JSON.stringify((await posts(page)).slice(-1)[0]) === JSON.stringify({ action: 'trip_idea_delete', id: 'I-EGYPT' }));
      await mount(page); await click(page, '.mt-pencilled-card', 2); await page.waitForTimeout(150);
      check('known dates need no window lookup', (await page.evaluate(() => window.__get.filter(g => g.action === 'my_trip_windows').length)) === 0);
      check('…and offer to go on the calendar', /Put it on the calendar/.test(await q(page, '.mt-detail')));

      // ---- pull in ----
      await mount(page); await click(page, '.mt-pull-btn');
      const rows = await qa(page, '.mt-pull-row');
      check('every open idea is listed with its state', rows.length === 3 && /Pulled in/.test(rows[0]) && /Pull in/.test(rows[1]) && /Needs months/.test(rows[2]), rows.join(' / '));
      check('an idea with no months cannot be pulled in', await page.evaluate(() => document.querySelectorAll('#mtprobe .mt-pull-toggle')[2].disabled));
      await click(page, '.mt-pull-toggle', 1);
      check('Pull in sends pull', JSON.stringify((await posts(page)).slice(-1)[0]) === JSON.stringify({ action: 'my_trip_update', id: 'I-ALPS', op: 'pull' }));
      await click(page, '.mt-pull-toggle', 0);
      check('…and the pulled one un-pulls', (await posts(page)).slice(-1)[0].op === 'unpull');

      // ---- past ----
      await mount(page); await click(page, '.mt-past-row');
      await page.waitForTimeout(200);
      const pv = await q(page, '.mt-pastview');
      check('a past trip shows its spend against its budget and its gifts', /Lake Trip/.test(pv) && /\$3,140/.test(pv) && /\$360 under/.test(pv) && /2/.test(pv) && /1 bought/.test(pv) && /7 nights/.test(pv), pv);
      await click(page, '.mt-past-gifts');
      check('Gifts goes to that trip', JSON.stringify(await page.evaluate(() => window.__gifts)) === '["2026-10-21|Lake Trip"]');
      await mount(page); await click(page, '.mt-allpast');
      check('All past trips lists every one by year', (await qa(page, '.mt-allpast .mt-past-row')).length === 3 && /2025 · 1/.test(await q(page, '.mt-allpast')));

      if (width === 390) {
        await mount(page);
        check('no sideways scroll at phone width', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
              await page.evaluate(() => document.documentElement.scrollWidth));
      }
      check('no page errors', errors.length === 0, errors.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
