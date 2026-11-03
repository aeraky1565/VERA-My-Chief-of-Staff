// Travel › Bucket List (issue #228), the PlacesBucket screen in the full dashboard, at phone and
// desktop width against invented places: cards (flag, stars, year and who, occasion, Dream trip,
// in a trip idea), the filters, things to do (add, tick, remove), Edit with the occasion picker,
// Mark visited, Remove, Add a place, and ticking places.
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
const isoMap = (APP.match(/const COUNTRY_ISO_MAP=\{[^\n]*?\};/) || [''])[0];
const isoFn = (() => { const i = APP.indexOf('function countryToIso('); let d = 0;
  for (let j = APP.indexOf('{', i); j < APP.length; j++) { if (APP[j] === '{') d++; else if (APP[j] === '}' && --d === 0) return APP.slice(i, j + 1); } return ''; })();

console.log('\nthe source');
check('the block is in app.js', PB.length > 4000 && PC.length > 4000);
check('Travel › Bucket List mounts it, with Add a place and the way to Trip Ideas', APP.indexOf("React.createElement(PlacesBucket,{apiUrl:apiUrl,apiToken:apiToken,busy:busy,onAdd:onAddBucketItem,onGoIdeas:function(){setSub('ideas');}") !== -1);
check('the old Bucket List panel is no longer mounted', APP.indexOf('React.createElement(BucketListPanel,') === -1);
check('the add form has an Occasion field', /className:"form-input bucket-occasion",value:occasion,onChange:function\(e\)\{setOccasion\(e\.target\.value\);\}/.test(APP));

const DATA = { ok: true, visits: [], planned: [], notes: {},
  picks: ['Anniversary', 'Birthday', 'Honeymoon', 'Family visit', 'Wedding', 'Holiday', 'Work', 'Just because'],
  occasions: ['Anniversary', 'Birthday', 'Honeymoon', 'Family visit', 'Wedding', 'Holiday', 'Work', 'Just because', '10th anniversary'],
  bucket: [
    { ID: 'b1', Country: 'Portugal', City: 'Lisbon', 'Target Year': 2027, Traveller: 'Both', Stars: 4, 'Dream Trip': '', Notes: 'stay in Alfama', Occasion: '10th anniversary', 'Trip Idea': '', visited: false,
      activities: [{ id: 'a1', activity: 'Tram 28', done: false }, { id: 'a2', activity: 'Pastéis in Belém', done: true }] },
    { ID: 'b2', Country: 'Norway', City: '', 'Target Year': 2028, Traveller: 'Both', Stars: 5, 'Dream Trip': 'Yes', Notes: '', Occasion: '', 'Trip Idea': 'TI1', visited: false, activities: [] },
    { ID: 'b3', Country: 'Vietnam', City: 'Hanoi', 'Target Year': '', Traveller: 'Ahmed', Stars: 3, 'Dream Trip': '', Notes: '', Occasion: '', 'Trip Idea': '', visited: false, activities: [] },
    { ID: 'b4', Country: 'Japan', City: 'Kyoto', 'Target Year': '', Traveller: 'Both', Stars: 5, 'Dream Trip': '', Notes: '', Occasion: 'Birthday', 'Trip Idea': '', Visited: '2024', visited: true, activities: [] },
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
  if (a === 'update_bucket_item') { var b = find(p.id); if (p.visited) { b.Visited = p.visited; b.visited = true; } ['occasion:Occasion', 'notes:Notes', 'traveller:Traveller', 'targetYear:Target Year'].forEach(function(x) { var k = x.split(':'); if (p[k[0]] !== undefined) b[k[1]] = p[k[0]]; }); }
  if (a === 'delete_bucket_item') DATA.bucket = DATA.bucket.filter(function(b) { return b.ID !== p.id; });
  if (a === 'add_bucket_activity') find(p.bucketId).activities.push({ id: 'n' + CALLS.length, activity: p.activity, done: false });
  if (a === 'toggle_bucket_activity') DATA.bucket.forEach(function(b) { b.activities.forEach(function(x) { if (x.id === p.id) x.done = !!p.done; }); });
  if (a === 'delete_bucket_activity') DATA.bucket.forEach(function(b) { b.activities = b.activities.filter(function(x) { return x.id !== p.id; }); });
  return Promise.resolve({ ok: true }); }
window.confirm = function() { return true; };
function AddBucketItemModal(p) { return React.createElement('div', { className: 'stub-add' }, React.createElement('button', { className: 'stub-save', onClick: function() { p.onSave({ country: 'Peru', city: 'Cusco', occasion: 'Honeymoon redo' }); } }, 'save')); }
${isoMap}
${isoFn}
${PC}
${PB}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(PlacesBucket, { apiUrl: 'x', apiToken: 'y', busy: false,
  onAdd: function(f) { ADDED.push(f); DATA.bucket.push({ ID: 'b9', Country: f.country, City: f.city, Occasion: f.occasion, Traveller: 'Both', visited: false, activities: [] }); return Promise.resolve(); },
  onGoIdeas: function(id) { IDEAS.push(id); } }));`;
  for (const width of [390, 1280]) {
    const L = '@' + width;
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/*', r => { const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] }); return r.fulfill({ contentType: 'text/html', body: shell(probe) }); });
    await page.goto('http://probe.local/'); await page.waitForSelector('.pb-card', { timeout: 5000 }).catch(() => {}); await wait(100);
    const ids = () => page.$$eval('.pb-card', ns => ns.map(n => n.dataset.id).join());
    const cardText = id => page.$eval('.pb-card[data-id="' + id + '"]', n => n.innerText);
    check(L + ': opens on Not yet visited', (await ids()) === 'b1,b2,b3' && /Not yet/.test(await page.$eval('.pb-filter.on', n => n.textContent)));
    const lis = await cardText('b1');
    check(L + ': a card: flag, place, stars, year and who, occasion, notes', /🇵🇹\s*Lisbon, Portugal/.test(lis) && /★★★★☆/.test(lis) && /2027 · Both/.test(lis) && /10th anniversary/.test(lis) && /stay in Alfama/.test(lis), lis);
    check(L + ': things to do, done ones ticked', (await page.$$eval('.pb-card[data-id="b1"] .pb-act input', ns => ns.map(n => n.checked).join())) === 'false,true');
    check(L + ': a Dream trip badge, and the trip idea it’s in', /Dream trip/.test(await cardText('b2')) && !!(await page.$('.pb-card[data-id="b2"] .pb-idea')));
    await page.click('.pb-card[data-id="b2"] .pb-idea'); await wait(50);
    check(L + ': “In a trip idea” opens Trip Ideas', (await page.evaluate(() => IDEAS.join())) === 'TI1');

    for (const [f, want] of [['dream', 'b2'], ['occasion', 'b1'], ['stars', 'b1,b2'], ['all', 'b1,b2,b3,b4']]) {
      await page.click('.pb-filter[data-f="' + f + '"]'); await wait(60);
      check(L + ': filter ' + f, (await ids()) === want, await ids());
    }
    check(L + ': a visited place says when, with no tick box or Mark visited', /Visited 2024/.test(await cardText('b4')) && !(await page.$('.pb-card[data-id="b4"] .pb-pick')) && !(await page.$('.pb-card[data-id="b4"] .pb-visited')));
    await page.click('.pb-filter[data-f="open"]'); await wait(60);

    await page.fill('.pb-card[data-id="b3"] .pb-act-in', 'Old Quarter food walk'); await page.press('.pb-card[data-id="b3"] .pb-act-in', 'Enter'); await wait(150);
    check(L + ': a thing to do is added', /Old Quarter food walk/.test(await cardText('b3')) && (await page.evaluate(() => CALLS.some(c => c.action === 'add_bucket_activity' && c.bucketId === 'b3'))));
    await page.click('.pb-card[data-id="b1"] .pb-act input >> nth=0'); await wait(150);
    check(L + ': ticking one marks it done', (await page.evaluate(() => CALLS.filter(c => c.action === 'toggle_bucket_activity').pop())).done === 'yes');
    await page.click('.pb-card[data-id="b1"] .pb-act button >> nth=1'); await wait(150);
    check(L + ': × removes one', !/Pastéis/.test(await cardText('b1')));

    await page.click('.pb-card[data-id="b3"] .pb-edit-btn'); await wait(80);
    check(L + ': Edit offers the quick picks and the ones used before', (await page.$$eval('.pb-occpick', ns => ns.map(n => n.textContent))).includes('10th anniversary') && (await page.$$('.pb-occpick')).length === 9);
    await page.click('.pb-occpick >> text=Birthday'); await page.fill('.pb-year-in', '2029'); await page.click('.pb-save'); await wait(200);
    const up = await page.evaluate(() => CALLS.filter(c => c.action === 'update_bucket_item').pop());
    check(L + ': Save sends the occasion, year and who', up.id === 'b3' && up.occasion === 'Birthday' && up.targetYear === '2029' && up.traveller === 'Ahmed', JSON.stringify(up));
    check(L + ': the card shows it', /Birthday/.test(await cardText('b3')) && /2029/.test(await cardText('b3')));
    await page.click('.pb-card[data-id="b3"] .pb-edit-btn'); await page.fill('.pb-occ-in', 'Mom’s 70th'); await page.click('.pb-save'); await wait(200);
    check(L + ': or your own words', /Mom’s 70th/.test(await cardText('b3')));

    await page.click('.pb-card[data-id="b1"] .pb-pick'); await page.click('.pb-card[data-id="b3"] .pb-pick'); await wait(60);
    check(L + ': ticking places marks them chosen', (await page.$$eval('.pb-pick[aria-pressed="true"]', ns => ns.length)) === 2);

    await page.click('.pb-card[data-id="b3"] .pb-visited'); await wait(200);
    check(L + ': Mark visited moves it out of Not yet visited', !(await ids()).includes('b3') && (await page.evaluate(() => /^\d{4}$/.test(CALLS.filter(c => c.action === 'update_bucket_item').pop().visited))));
    await page.click('.pb-card[data-id="b2"] .pb-remove'); await wait(200);
    check(L + ': Remove deletes it', !(await ids()).includes('b2'));
    await page.click('.pb-add'); await page.click('.stub-save'); await wait(250);
    check(L + ': Add a place saves with its occasion and the list reloads', (await page.evaluate(() => ADDED[0].occasion)) === 'Honeymoon redo' && (await ids()).includes('b9'));
    check(L + ': buttons are big enough to tap', await page.$$eval('.pb-filter, .pb-add, .pb-pick, .pb-edit-btn', ns => ns.every(n => n.getBoundingClientRect().height >= 36)));
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
