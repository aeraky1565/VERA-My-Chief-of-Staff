// Bucket List release 2 (issue #228): best months and direct flights on the cards, Suggest best
// months, the Long weekend filter, points for dream trips with the ARIA copy-out, Edit for months
// and flight times, and the plan screen's month strip and vacation days. Lite carries the same
// Places block, word for word. Invented places and balances.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const cut = (a, b) => { const i = APP.indexOf(a), j = APP.indexOf(b); return i === -1 || j === -1 ? '' : APP.slice(i, j + b.length); };
const PC = cut('// ---- PlacesCountries (Travel › Countries, issue #228) ----', '// ---- /PlacesCountries ----');
const PB = cut('// ---- PlacesBucket (Travel › Bucket List, issue #228) ----', '// ---- /PlacesBucket ----');
const tiMonths = (() => { const i = APP.indexOf('function tiMonthsText_('); let d = 0;
  for (let j = APP.indexOf('{', i); j < APP.length; j++) { if (APP[j] === '{') d++; else if (APP[j] === '}' && --d === 0) return APP.slice(i, j + 1); } return ''; })();
const tiMonthsVar = (APP.match(/var TI_MONTHS=[^;]*;/) || [''])[0];
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const isoMap = (APP.match(/const COUNTRY_ISO_MAP=\{[^\n]*?\};/) || [''])[0];
const isoFn = (() => { const i = APP.indexOf('function countryToIso('); let d = 0;
  for (let j = APP.indexOf('{', i); j < APP.length; j++) { if (APP[j] === '{') d++; else if (APP[j] === '}' && --d === 0) return APP.slice(i, j + 1); } return ''; })();

const LPC = (() => { const a = LITE.indexOf('// ---- PlacesCountries (Travel › Countries, issue #228) ----'), b = LITE.indexOf('// ---- /PlacesBucket ----'); return a === -1 || b === -1 ? '' : LITE.slice(a, b); })();
const APC = (() => { const a = APP.indexOf('// ---- PlacesCountries (Travel › Countries, issue #228) ----'), b = APP.indexOf('// ---- /PlacesBucket ----'); return a === -1 || b === -1 ? '' : APP.slice(a, b); })();
console.log('\nthe source');
check('lite carries the same Places block, word for word', APC.length > 20000 && APC === LPC);
check('lite: the Bucket List tab, and the new screen in place of the old one', /\{ id: 'bucketlist', label: '🪣 Bucket List' \}/.test(LITE) && /\{travSub === 'bucketlist' && <PlacesBucket apiUrl=\{apiUrl\} apiToken=\{apiToken\} busy=\{busy\} onAdd=\{handleAddBucketItem\} onGoIdeas=\{\(\) => setTravSub\('ideas'\)\} \/>\}/.test(LITE) && LITE.indexOf('<BucketListPanel') === -1);
check('lite: adding a place keeps its occasion and waits for the save', /return apiGet\(apiUrl, apiToken, \{\n      action: 'add_bucket_item'[\s\S]{0,400}occasion: fields\.occasion \|\| '',/.test(LITE));

const DATA = { ok: true, visits: [], planned: [], notes: {}, picks: ['Anniversary'], occasions: ['Anniversary'],
  homeAirports: ['IAD', 'DCA', 'BWI'], longWeekendMinutes: 420, awardCabin: 'business',
  awards: { europe: { economy: ['United', 30000], business: ['United', 60000] }, asia: { business: ['United', 80000] } },
  points: { by: { 'United MileagePlus': 50000, 'Chase Ultimate Rewards': 70000 }, transferable: 70000 },
  facts: { b1: { bestMonths: [4, 5, 6, 9], flights: [{ from: 'IAD', minutes: 400, seasonal: false }] }, b2: { bestMonths: [6, 7, 8], flights: [{ from: 'IAD', minutes: 480, seasonal: true }] } },
  bucket: [
    { ID: 'b1', Country: 'Portugal', City: 'Lisbon', 'Target Year': 2027, Traveller: 'Both', Stars: 4, 'Dream Trip': '', Notes: '', Occasion: '', 'Trip Idea': '', 'Best Months': 'Apr–Jun, Sep', visited: false, activities: [] },
    { ID: 'b2', Country: 'Norway', City: '', 'Target Year': 2028, Traveller: 'Both', Stars: 5, 'Dream Trip': 'Yes', Notes: '', Occasion: '', 'Trip Idea': '', 'Best Months': 'Jun–Aug', visited: false, activities: [] },
    { ID: 'b3', Country: 'Vietnam', City: 'Hanoi', 'Target Year': '', Traveller: 'Both', Stars: 3, 'Dream Trip': 'Yes', Notes: '', Occasion: '', 'Trip Idea': '', 'Best Months': '', visited: false, activities: [] },
  ] };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'), 'react-dom.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8') };
  const shell = body => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0b1020;color:#dde1f0;font-family:sans-serif}</style>'
    + '<script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>' + body + '</script></body></html>';
  const probe = `
window.CALLS = []; window.ADDED = []; window.IDEAS = []; var DATA = ${JSON.stringify(DATA)};
function find(id) { return DATA.bucket.filter(function(b) { return b.ID === id; })[0]; }
function apiGet(u, t, p) { CALLS.push(p); var a = p.action;
  if (a === 'places') return Promise.resolve(JSON.parse(JSON.stringify(DATA)));
  if (a === 'update_bucket_item') { var b = find(p.id); if (p.visited) { b.Visited = p.visited; b.visited = true; } ['occasion:Occasion', 'notes:Notes', 'traveller:Traveller', 'targetYear:Target Year', 'bestMonths:Best Months'].forEach(function(x) { var k = x.split(':'); if (p[k[0]] !== undefined) b[k[1]] = p[k[0]]; }); }
  if (a === 'bucket_facts') { DATA.facts[p.id] = { bestMonths: [10, 11], flights: [] }; find(p.id)['Best Months'] = 'Oct, Nov'; return Promise.resolve({ ok: true }); }
  if (a === 'delete_bucket_item') DATA.bucket = DATA.bucket.filter(function(b) { return b.ID !== p.id; });
  if (a === 'add_bucket_activity') find(p.bucketId).activities.push({ id: 'n' + CALLS.length, activity: p.activity, done: false });
  if (a === 'toggle_bucket_activity') DATA.bucket.forEach(function(b) { b.activities.forEach(function(x) { if (x.id === p.id) x.done = !!p.done; }); });
  if (a === 'delete_bucket_activity') DATA.bucket.forEach(function(b) { b.activities = b.activities.filter(function(x) { return x.id !== p.id; }); });
  return Promise.resolve({ ok: true }); }
window.POSTS = [];
function apiPost(u, t, b) { POSTS.push(b);
  if (b.action === 'bucket_facts_set') { DATA.facts[b.id] = { bestMonths: DATA.facts[b.id].bestMonths, flights: b.flights }; return Promise.resolve({ ok: true }); }
  if (b.action === 'places_plan_preview') return Promise.resolve({ ok: true, months: { all: [6], some: [4, 5, 6, 7, 8, 9], known: 2 }, sample: { start: '2027-06-05', end: '2027-06-12', nights: 7, month: 6, monthName: 'Jun' },
    people: [{ name: 'Sam', found: true, year: '2027', left: 12, uses: 5, after: 7, bridged: [] }, { name: 'Lee', found: false }], places: ['Lisbon, Portugal', 'Hanoi, Vietnam'], brief: { title: '10th anniversary in Portugal & Vietnam: Lisbon, Hanoi', where: 'Lisbon (Portugal), Hanoi (Vietnam)',
    months: ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12'], travelers: 'Ahmed and Victoria', mustHaves: 'Anniversary dinner on the night itself.',
    pieces: [{ kind: 'wish', name: 'Tram 28', detail: 'Lisbon, Portugal' }], occasion: '10th anniversary' } });
  if (b.action === 'places_plan_idea') { b.bucketIds.forEach(function(id) { find(id)['Trip Idea'] = 'IDEA-NEW'; }); return Promise.resolve({ ok: true, idea: { id: 'IDEA-NEW' } }); }
  return Promise.resolve({ ok: false }); }
${tiMonthsVar}
${tiMonths}
window.confirm = function() { return true; };
function TiCopyOut(p) { return React.createElement('div', { className: 'ti-copyout' }, React.createElement('span', null, p.title), React.createElement('textarea', { readOnly: true, className: 'aria-text', value: p.text }), React.createElement('button', { className: 'ti-done', onClick: p.onClose }, 'Done')); }
function AddBucketItemModal(p) { return React.createElement('div', { className: 'stub-add' }, React.createElement('button', { className: 'stub-save', onClick: function() { p.onSave({ country: 'Peru', city: 'Cusco', occasion: 'Honeymoon redo' }); } }, 'save')); }
${isoMap}
${isoFn}
${PC}
${PB}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(PlacesBucket, { apiUrl: 'x', apiToken: 'y', busy: false,
  onAdd: function(f) { ADDED.push(f); DATA.bucket.push({ ID: 'b9', Country: f.country, City: f.city, Occasion: f.occasion, Traveller: 'Both', visited: false, activities: [] }); return Promise.resolve(); },
  onGoIdeas: function(id) { IDEAS.push(id); } }));`;
  const open = async width => {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/*', r => { const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] }); return r.fulfill({ contentType: 'text/html', body: shell(probe) }); });
    await page.goto('http://probe.local/'); await page.waitForSelector('.pb-card', { timeout: 5000 }).catch(() => {}); await wait(150);
    return { page, errs };
  };
  const card = (page, id) => page.$eval('.pb-card[data-id="' + id + '"]', n => n.innerText).catch(() => '');
  const ids = page => page.$$eval('.pb-card', ns => ns.map(n => n.dataset.id).join());
  for (const width of [390, 1280]) {
    const L = '@' + width;
    const { page, errs } = await open(width);
    check(L + ': best months and the direct flight on the card', /Best: Apr–Jun, Sep/.test(await card(page, 'b1')) && /Direct · 6 h 40 m from IAD/.test(await card(page, 'b1')) && /Direct · 8 h from IAD · seasonal/.test(await card(page, 'b2')));
    check(L + ': a short direct flight is marked as a long weekend', (await page.$eval('.pb-card[data-id="b1"] .pb-direct', n => n.dataset.weekend)) === 'yes' && (await page.$eval('.pb-card[data-id="b2"] .pb-direct', n => n.dataset.weekend)) === 'no');
    await page.click('.pb-filter[data-f="weekend"]'); await wait(80);
    check(L + ': Long weekend shows only places under 7 hours direct', (await ids(page)) === 'b1');
    await page.click('.pb-filter[data-f="open"]'); await wait(80);
    const pts = await page.$eval('.pb-card[data-id="b2"] .pb-points', n => n.innerText).catch(() => '');
    check(L + ': a dream trip: points for two seats, round trip, against what you hold', /About 240,000 United points for two seats, round trip, in business/.test(pts) && /You hold about 120,000 \(including 70,000 transferable\) · 50%/.test(pts), pts);
    check(L + ': the bar shows the share held', (await page.$eval('.pb-card[data-id="b2"] .pb-points-bar', n => n.style.width)) === '50%' && !(await page.$('.pb-card[data-id="b1"] .pb-points')));
    await page.click('.pb-card[data-id="b2"] .pb-aria'); await wait(80);
    const aria = await page.$eval('.pb-card[data-id="b2"] .aria-text', n => n.value).catch(() => '');
    check(L + ': Ask ARIA copies out a request, writing nothing', /=== VERA award request v1 ===/.test(aria) && /To: Norway/.test(aria) && /From: IAD, DCA, BWI/.test(aria) && /When: Jun–Aug 2028/.test(aria) && /about 240,000 points/.test(aria)
      && !(await page.evaluate(() => CALLS.concat(POSTS).some(c => /aria/i.test(c.action || '')))));
    check(L + ': a place with nothing looked up offers to suggest', !!(await page.$('.pb-card[data-id="b3"] .pb-facts')) && !(await page.$('.pb-card[data-id="b1"] .pb-facts')));
    await page.click('.pb-card[data-id="b3"] .pb-facts'); await wait(200);
    check(L + ': Suggest asks for that place and shows the answer', (await page.evaluate(() => (CALLS.filter(c => c.action === 'bucket_facts').pop() || {}).id)) === 'b3' && /Best: Oct, Nov/.test(await card(page, 'b3')) && /No direct flight from IAD, DCA, BWI/.test(await card(page, 'b3')));
    // Edit months and a flight time
    await page.click('.pb-card[data-id="b1"] .pb-edit-btn'); await wait(80);
    check(L + ': Edit shows the months already chosen, and the flight hours', (await page.$$eval('.pb-card[data-id="b1"] .pb-month.on', ns => ns.map(n => n.dataset.m).join())) === '4,5,6,9' && (await page.$eval('.pb-fl-in[data-from="IAD"]', n => n.value)) === '6.7');
    await page.click('.pb-card[data-id="b1"] .pb-month[data-m="10"]'); await page.click('.pb-card[data-id="b1"] .pb-month[data-m="4"]');
    await page.fill('.pb-fl-in[data-from="DCA"]', '7.5'); await page.click('.pb-card[data-id="b1"] .pb-save'); await wait(250);
    const up = (await page.evaluate(() => CALLS.filter(c => c.action === 'update_bucket_item').pop())) || {};
    const fs2 = await page.evaluate(() => POSTS.filter(c => c.action === 'bucket_facts_set').pop());
    check(L + ': saving sends the months and your flight times', up.bestMonths === 'May, Jun, Sep, Oct' && fs2 && JSON.stringify(fs2.flights) === JSON.stringify([{ from: 'IAD', minutes: 402 }, { from: 'DCA', minutes: 450 }]), JSON.stringify([up, fs2]));
    // the plan screen
    await page.click('.pb-card[data-id="b1"] .pb-pick'); await page.click('.pb-card[data-id="b2"] .pb-pick'); await page.click('.pb-plan'); await wait(250);
    check(L + ': the month strip: good for all, good for some', (await page.$$eval('.pb-mstrip-m', ns => ns.map(n => n.dataset.fit[0]).join(''))) === 'nnnssasssnnn' && /Good for all 2 places: Jun/.test(await page.$eval('.pb-mstrip-say', n => n.innerText)));
    const pto = await page.$eval('.pb-ptos', n => n.innerText).catch(() => '');
    check(L + ': vacation days per person for a sample trip in a good month', /7-night trip from Sat Jun 5/.test(pto) && /Sam: 12 left in 2027 · uses 5 → 7 left/.test(pto) && /Lee: no work calendar to read/.test(pto), pto);
    check(L + ': no sideways scroll, no errors', (await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)) && errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
