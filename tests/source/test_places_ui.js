// Travel › Countries (issue #228), the PlacesCountries screen in the full dashboard, at phone and
// desktop width against invented places: the three views, the who and occasion filters, the
// visited / planned / bucket map, the year timeline, the list with trip notes, and Add a visit.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const START = '// ---- PlacesCountries (Travel › Countries, issue #228) ----', END = '// ---- /PlacesCountries ----';
const block = (() => { const a = APP.indexOf(START), b = APP.indexOf(END); return a === -1 || b === -1 ? '' : APP.slice(a, b + END.length); })();
const isoMap = (APP.match(/const COUNTRY_ISO_MAP=\{[^\n]*?\};/) || [''])[0];
const isoFn = (() => { const i = APP.indexOf('function countryToIso('); if (i === -1) return ''; let d = 0;
  for (let j = APP.indexOf('{', i); j < APP.length; j++) { if (APP[j] === '{') d++; else if (APP[j] === '}' && --d === 0) return APP.slice(i, j + 1); } return ''; })();

console.log('\nthe source');
check('the block and the ISO helper are in app.js', block.length > 5000 && isoMap.length > 500 && isoFn.length > 100);
check('Travel › Countries mounts it with Add a visit wired to the existing form', APP.indexOf('React.createElement(PlacesCountries,{apiUrl:apiUrl,apiToken:apiToken,upcomingTravel:upcomingTravel,busy:busy,onAdd:onAddCountry})') !== -1
  && /h\(AddCountryModal,\{upcomingTravel:props\.upcomingTravel/.test(block));
check('the old Countries panel is no longer mounted', APP.indexOf('React.createElement(CountriesVisitedPanel,') === -1);

const DATA = {
  ok: true, picks: ['Anniversary', 'Birthday', 'Honeymoon', 'Family visit', 'Wedding', 'Holiday', 'Work', 'Just because'],
  visits: [
    { ID: 'c1', Country: 'Japan', City: 'Tokyo', Year: 2024, Traveller: 'Both', 'Trip Key': '2024-04-02|Japan cherry blossoms', Occasion: '10th anniversary' },
    { ID: 'c2', Country: 'Japan', City: 'Kyoto', Year: 2024, Traveller: 'Both', 'Trip Key': '2024-04-02|Japan cherry blossoms', Occasion: '10th anniversary' },
    { ID: 'c3', Country: 'Greece', City: 'Chania', Year: 2025, Traveller: 'Both', 'Trip Key': '2025-06-01|Crete', Occasion: 'Family visit' },
    { ID: 'c4', Country: 'Greece', City: 'Athens', Year: 2019, Traveller: 'Victoria', 'Trip Key': '', Occasion: '' },
    { ID: 'c5', Country: 'Morocco', City: 'Marrakech', Year: 2025, Traveller: 'Ahmed', 'Trip Key': '2025-02-14|Marrakech', Occasion: 'Birthday' },
    { ID: 'c6', Country: 'United Kingdom', City: 'London', Year: 2023, Traveller: 'Both', 'Trip Key': '', Occasion: 'Work' },
  ],
  bucket: [{ ID: 'b1', Country: 'Norway' }, { ID: 'b2', Country: 'Portugal' }, { ID: 'b3', Country: 'Peru', visited: true }],
  planned: [{ country: 'Portugal', tripKey: '2027-06-12|Lisbon & Porto', label: 'Lisbon & Porto', startDate: '2027-06-12', endDate: '2027-06-22' },
    { country: 'Japan', tripKey: '2027-03-01|Tokyo again', label: 'Tokyo again', startDate: '2027-03-01', endDate: '2027-03-09' }],
  notes: { Japan: { loved: ['depachika food halls'], next: ['autumn in Kyoto, and fewer cities'] } },
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'), 'react-dom.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8') };
  const shell = body => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0b1020;color:#dde1f0;font-family:sans-serif}</style>'
    + '<script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>' + body + '</script></body></html>';
  const probe = `
window.CALLS = []; window.ADDED = []; var DATA = ${JSON.stringify(DATA)};
function apiGet(u, t, p) { CALLS.push(p); if (p.action === 'places') return Promise.resolve(JSON.parse(JSON.stringify(DATA)));
  if (p.action === 'delete_country') { DATA.visits = DATA.visits.filter(function(v) { return v.ID !== p.id; }); return Promise.resolve({ ok: true }); } return Promise.resolve({ ok: false }); }
window.confirm = function() { return true; };
function AddCountryModal(p) { return React.createElement('div', { className: 'stub-add' }, React.createElement('button', { className: 'stub-save', onClick: function() {
  p.onSave({ country: 'Peru', city: 'Cusco', year: 2026, traveller: 'Both', tripKey: '', occasion: 'Holiday' }); } }, 'save')); }
${isoMap}
${isoFn}
${block}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(PlacesCountries, { apiUrl: 'x', apiToken: 'y', upcomingTravel: [], busy: false,
  onAdd: function(f) { ADDED.push(f); DATA.visits.push({ ID: 'c9', Country: f.country, City: f.city, Year: f.year, Traveller: 'Both', 'Trip Key': '', Occasion: f.occasion }); return Promise.resolve(); } }));`;
  for (const width of [390, 1280]) {
    const L = '@' + width;
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/*', r => { const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] }); return r.fulfill({ contentType: 'text/html', body: shell(probe) }); });
    await page.goto('http://probe.local/'); await page.waitForSelector('.pc-view', { timeout: 5000 }).catch(() => {}); await wait(150);
    const stat = k => page.$eval('.pc-stat[data-stat="' + k + '"] span', n => n.textContent);
    check(L + ': opens on Map & stats', /Map/.test(await page.$eval('.pc-view.on', n => n.textContent)));
    check(L + ': stats: 4 countries, 3 continents, 6 cities, 1 planned', (await stat('countries')) === '4' && (await stat('continents')) === '3' && (await stat('cities')) === '6' && (await stat('planned')) === '1',
      [await stat('countries'), await stat('continents'), await stat('cities'), await stat('planned')].join());
    const tiles = await page.$$eval('.pc-tile', ns => ns.map(n => n.title + ':' + n.dataset.state));
    check(L + ': the map: been, planned and bucket, been wins', tiles.indexOf('Japan:been') !== -1 && tiles.indexOf('Portugal:planned') !== -1 && tiles.indexOf('Norway:bucket') !== -1 && tiles.filter(t => /^Portugal/.test(t)).length === 1, tiles.join());
    check(L + ': a visited bucket place isn’t on the map', tiles.every(t => !/^Peru/.test(t)));
    check(L + ': tiles carry the flag and the code', /🇯🇵\s*JP/.test(await page.$eval('.pc-tile[title="Japan"]', n => n.textContent)));
    check(L + ': the UK tile is GB', /GB/.test(await page.$eval('.pc-tile[title="United Kingdom"]', n => n.textContent)));
    { const eu = await page.$eval('.pc-cont[data-cont="Europe"]', n => n.textContent); check(L + ': continents count each state', /2 been · 1 planned · 1 to go/.test(eu), eu); }
    check(L + ': trips by occasion, free text grouped under its pick', /Anniversary\s*1/.test(await page.$eval('.pc-occstats', n => n.innerText)) && /Family visit\s*1/.test(await page.$eval('.pc-occstats', n => n.innerText)));

    await page.click('.pc-who >> text=Ahmed'); await wait(100);
    check(L + ': Ahmed: his trips and the shared ones, not Victoria’s alone', (await stat('cities')) === '5');
    await page.click('.pc-who >> text=Both of us'); await page.click('.pc-occf >> text=Anniversary'); await wait(100);
    check(L + ': the occasion filter: only anniversary trips, no planned or bucket', (await page.$$eval('.pc-tile', ns => ns.map(n => n.title))).join() === 'Japan');
    await page.click('.pc-occf >> text=All occasions'); await wait(80);

    await page.click('.pc-view[data-view="year"]'); await wait(120);
    const years = await page.$$eval('.pc-year', ns => ns.map(n => n.dataset.year));
    check(L + ': By year: planned year first, then newest', years.join() === '2027,2025,2024,2023,2019', years.join());
    check(L + ': a planned trip is marked, and Portugal is new', /Lisbon & Porto[\s\S]*Planned · new country/.test(await page.$eval('.pc-year[data-year="2027"]', n => n.innerText)));
    check(L + ': a planned trip to a visited country isn’t called new', /Tokyo again[\s\S]*Planned(?! · new)/.test(await page.$eval('.pc-year[data-year="2027"]', n => n.innerText)));
    check(L + ': trips show cities, flag and occasion', /🇯🇵\s*Tokyo · Kyoto/.test(await page.$eval('.pc-year[data-year="2024"]', n => n.innerText)) && /10th anniversary/.test(await page.$eval('.pc-year[data-year="2024"]', n => n.innerText)));
    check(L + ': a year names its new countries', /new: Morocco/.test(await page.$eval('.pc-year[data-year="2025"]', n => n.innerText)) && !/new: [^\n]*Greece/.test(await page.$eval('.pc-year[data-year="2025"]', n => n.innerText)));

    await page.click('.pc-view[data-view="list"]'); await wait(120);
    const names = await page.$$eval('.pc-country', ns => ns.map(n => n.dataset.country));
    check(L + ': List: planned first, then A–Z', names.join() === 'Portugal,Greece,Japan,Morocco,United Kingdom', names.join());
    const jp = await page.$eval('.pc-country[data-country="Japan"]', n => n.innerText);
    check(L + ': a visited country going again says so', /Planned again · Tokyo again/.test(jp), jp);
    check(L + ': a country shows its cities, occasion, trip and what we thought', /Tokyo 2024/.test(jp) && /10th anniversary/.test(jp) && /Japan cherry blossoms · 2024/.test(jp) && /Loved depachika/.test(jp) && /Next time autumn in Kyoto/.test(jp), jp);
    check(L + ': the view is kept in this browser', (await page.evaluate(() => localStorage.getItem('vera_countries_view'))) === 'list');
    await page.click('.pc-country[data-country="Greece"] .pc-del >> nth=0'); await wait(200);
    check(L + ': × removes that visit', (await page.evaluate(() => CALLS.filter(c => c.action === 'delete_country').map(c => c.id).join())) === 'c3');

    await page.click('.pc-add'); await wait(80);
    await page.click('.stub-save'); await wait(250);
    check(L + ': Add a visit opens the form, saves with the occasion, and the list reloads', (await page.evaluate(() => ADDED[0] && ADDED[0].occasion)) === 'Holiday' && /Peru/.test(await page.$eval('.pc-list', n => n.innerText)) && !(await page.$('.stub-add')));
    check(L + ': buttons are big enough to tap', await page.$$eval('.pc-view, .pc-who, .pc-add', ns => ns.every(n => n.getBoundingClientRect().height >= 40)));
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
