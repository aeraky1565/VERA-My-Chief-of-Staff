// Travel › Gifts (issue #227), the dashboard panel (TripGiftsPanel, shared verbatim by both
// dashboards), at phone and desktop width against an invented in-page server: trip chips, the
// three groups, one-tap status, the budget, ideas, the repeat warning, edit and remove, getting
// it home, and given before. Every value here is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const START = '// ---- TripGiftsPanel (Travel › Gifts, issue #227) — SHARED VERBATIM', END = '// ---- /TripGiftsPanel ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };

console.log('\nthe shared block');
check('both dashboards carry it, word for word', block(APP).length > 5000 && block(APP) === block(LITE));
check('there is one TripGiftsPanel in each', (APP.match(/function TripGiftsPanel\(/g) || []).length === 1 && (LITE.match(/function TripGiftsPanel\(/g) || []).length === 1);
check('both mount it in Travel › Gifts', /sub==='gifts'&&\/\*#__PURE__\*\/React\.createElement\(TripGiftsPanel,\{trips:upcomingTravel,apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP)
  && LITE.indexOf('<TripGiftsPanel trips={trips} apiUrl={apiUrl} apiToken={apiToken} />') !== -1);
check('My Trips’ gifts link opens that trip’s gifts', APP.indexOf("onGoGifts:function(k){try{if(k)localStorage.setItem('vera_gifts_trip',k);}catch(e){}setSub('gifts');}") !== -1
  && LITE.indexOf("onGoGifts={k => { try { if (k) localStorage.setItem('vera_gifts_trip', k); } catch (e) {} setTravSub('gifts'); }}") !== -1);

const T = '2027-06-12|Lisbon & Porto', P = '2025-06-01|Crete';
// An invented server, in the page: the same answers the real one gives, kept in memory.
const SERVER = `
window.CALLS = [];
var DB = {
  gifts: [
    { id: 'G1', tripKey: '${T}', recipient: 'Ana & Rui', item: 'Maple syrup box', amount: 34, kind: 'host', status: 'Packed', packsAs: 'liquid', notes: '' },
    { id: 'G2', tripKey: '${T}', recipient: 'Dad', item: 'Cork wallet', amount: 28, kind: 'souvenir', status: 'Bought', packsAs: 'none', notes: '' },
    { id: 'G3', tripKey: '${T}', recipient: 'Mom', item: 'Azulejo coasters', amount: 30, kind: 'souvenir', status: 'To buy', packsAs: 'fragile', notes: '' },
    { id: 'G4', tripKey: '${T}', recipient: 'Us', item: 'Port, 20-year', amount: 45, kind: 'us', status: 'Bought', packsAs: 'liquid', notes: '' },
    { id: 'G9', tripKey: '${P}', recipient: 'Mom', item: 'Tile coasters', amount: 20, kind: 'souvenir', status: 'Bought', packsAs: 'fragile', notes: '' }
  ],
  budget: { '${T}': 300 }
};
function tripGifts(k) { return DB.gifts.filter(function(g) { return g.tripKey === k; }); }
function words(s) { return String(s).toLowerCase().split(/[^a-z]+/).filter(function(w) { return w.length > 2; }).map(function(w) { return w.replace(/s$/, ''); }); }
function answer(p) {
  var a = p.action, k = p.tripKey;
  if (a === 'past_trips') return { ok: true, trips: [{ key: '${P}', label: 'Crete', startDate: '2025-06-01', endDate: '2025-06-08' }] };
  if (a === 'get_trip_gifts') {
    var g = tripGifts(k), b = DB.budget[k] || null, bought = 0, planned = 0;
    g.forEach(function(x) { if (x.amount == null) return; if (x.status === 'To buy') planned += x.amount; else bought += x.amount; });
    return { ok: true, gifts: g.map(function(x) { return Object.assign({ purchased: x.status !== 'To buy' }, x); }),
      budget: { budget: b, bought: bought, planned: planned, left: b ? b - bought - planned : null },
      home: { us: true, counts: { liquid: 1, fragile: 1, food: 0 },
        rules: [{ kind: 'checkin', title: 'Port, 20-year', text: 'Over 100 ml goes in the checked bag, not the carry-on.' }, { kind: 'avoid', title: 'Cured ham', text: 'Meat products can’t come into the US.' }],
        declare: { total: 73, allowance: 1600 } } };
  }
  if (a === 'add_trip_gift') { DB.gifts.push({ id: 'N' + DB.gifts.length, tripKey: k, recipient: p.recipient, item: p.item, amount: p.amount === '' ? null : Number(p.amount), kind: p.kind, status: p.status || 'To buy', packsAs: p.packsAs, notes: p.notes }); return { ok: true }; }
  if (a === 'update_trip_gift') { var x = DB.gifts.filter(function(g) { return g.id === p.id; })[0]; if (!x) return { ok: false, error: 'not found' };
    ['status', 'item', 'recipient', 'kind', 'packsAs', 'notes'].forEach(function(f) { if (p[f] !== undefined) x[f] = p[f]; }); if (p.amount !== undefined) x.amount = p.amount === '' ? null : Number(p.amount); return { ok: true }; }
  if (a === 'delete_trip_gift') { DB.gifts = DB.gifts.filter(function(g) { return g.id !== p.id; }); return { ok: true }; }
  if (a === 'set_trip_gift_budget') { DB.budget[k] = p.budget === '' ? null : Number(p.budget); return { ok: true }; }
  if (a === 'trip_gift_ideas') return { ok: true, ideas: [{ item: 'Tinned sardines', kind: 'souvenir', packsAs: 'food', note: 'Pretty tins' }, { item: 'Cork wallet', packsAs: 'none' }, { item: 'Port wine', packsAs: 'liquid' }] };
  if (a === 'trip_gift_check') { var ws = words(p.item);
    return { ok: true, repeats: DB.gifts.filter(function(g) { return g.tripKey !== k && g.status !== 'To buy' && g.recipient.toLowerCase() === String(p.recipient).trim().toLowerCase()
      && words(g.item).some(function(w) { return ws.indexOf(w) !== -1; }); }).map(function(g) { return { item: g.item, trip: 'Crete', year: '2025' }; }) }; }
  if (a === 'trip_gift_history') return { ok: true, people: [{ name: 'Dad', gifts: [{ id: 'G2', item: 'Cork wallet', trip: 'Lisbon & Porto', year: '2027' }] },
    { name: 'Mom', gifts: [{ id: 'G9', item: 'Tile coasters', trip: 'Crete', year: '2025' }] }] };
  return { ok: false, error: 'unknown ' + a };
}
window.fetch = function(url) { var q = {}; String(url).split('?')[1].split('&').forEach(function(kv) { var i = kv.indexOf('='); q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });
  CALLS.push(q); var out = answer(q); return new Promise(function(r) { setTimeout(function() { r({ json: function() { return Promise.resolve(out); } }); }, 15); }); };
window.confirm = function() { return true; };
`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
  };
  const shell = body => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0b1020;color:#dde1f0;font-family:sans-serif}</style>'
    + '<script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>' + body + '</script></body></html>';
  const probe = SERVER + block(APP) + `
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(TripGiftsPanel, { apiUrl: 'https://vera.test/exec', apiToken: 't',
  trips: [{ startDate: '2027-06-12', endDate: '2027-06-22', label: 'Lisbon & Porto' }, { startDate: '2027-09-03', label: 'Montreal' }] }));`;
  const open = async (width, store) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/*', r => {
      const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] });
      return r.fulfill({ contentType: 'text/html', body: shell(probe) });
    });
    if (store) await page.addInitScript(s => { for (const k in s) localStorage.setItem(k, s[k]); }, store);
    await page.goto('http://probe.local/');
    await page.waitForSelector('.tg-group', { timeout: 5000 }).catch(() => {});
    return { page, errs };
  };
  const calls = page => page.evaluate(() => CALLS.map(c => Object.assign({}, c, { token: undefined })));

  for (const width of [390, 1280]) {
    const L = '@' + width;
    let { page, errs } = await open(width);
    const text = () => page.$eval('.tg-panel', n => n.innerText);
    check(L + ': trips as chips, upcoming first, then past with its year', (await page.$$eval('.tg-trip', ns => ns.map(n => n.textContent))).join('|') === 'Lisbon & Porto · Jun|Montreal · Sep|Crete · 2025');
    check(L + ': opens on the first trip', /Lisbon/.test(await page.$eval('.tg-trip.on', n => n.textContent)));
    check(L + ': three groups, hosts first', (await page.$$eval('.tg-group', ns => ns.map(n => n.dataset.kind))).join() === 'host,souvenir,us');
    check(L + ': each row shows who and how much', /Maple syrup box[\s\S]*Ana & Rui[\s\S]*\$34/.test(await text()));
    check(L + ': the budget: $137 of $300, $163 left', /\$137[\s\S]*of \$300/.test(await page.$eval('.tg-budget', n => n.innerText)) && /\$163 left/.test(await page.$eval('.tg-budget', n => n.innerText)), await page.$eval('.tg-budget', n => n.innerText));
    check(L + ': a packing warning leads to Getting it home', /Port, 20-year: Over 100 ml/.test(await page.$eval('.tg-warn', n => n.innerText)));

    await page.click('.tg-row[data-id="G3"] .tg-status'); await wait(200);
    let c = (await calls(page)).filter(x => x.action === 'update_trip_gift').pop();
    check(L + ': one tap moves To buy → Bought', c && c.id === 'G3' && c.status === 'Bought', JSON.stringify(c));
    await page.click('.tg-row[data-id="G3"] .tg-status'); await wait(200);
    await page.click('.tg-row[data-id="G3"] .tg-status'); await wait(200);
    check(L + ': …→ Packed → back to To buy', (await page.$eval('.tg-row[data-id="G3"] .tg-status', n => n.dataset.status)) === 'To buy');

    await page.click('.tg-add'); await wait(250);
    check(L + ': the add form opens on Souvenir', /Souvenir/.test(await page.$eval('.tg-kind.on', n => n.textContent)));
    const ideas = await page.$$eval('.tg-idea', ns => ns.map(n => n.textContent));
    check(L + ': ideas for the place, minus what’s already on the list', ideas.join('|') === '+ Tinned sardines|+ Port wine', ideas.join('|'));
    await page.click('.tg-idea >> nth=0'); await wait(80);
    check(L + ': an idea fills the gift and how it packs', (await page.inputValue('.tg-in-item')) === 'Tinned sardines' && (await page.inputValue('.tg-in-packs')) === 'food');
    await page.fill('.tg-in-item', 'Painted tile coasters'); await page.fill('.tg-in-for', 'mom'); await wait(700);
    check(L + ': the repeat warning: Mom got tile coasters before', /mom got Tile coasters \(Crete 2025\)/.test(await page.$eval('.tg-repeat', n => n.innerText).catch(() => '')));
    await page.fill('.tg-in-item', 'Hand cream'); await page.click('.tg-kind[data-kind="us"]'); await page.fill('.tg-in-amount', '18'); await wait(600);
    check(L + ': no warning for something new', !(await page.$('.tg-repeat')));
    await page.click('.tg-save'); await wait(300);
    c = (await calls(page)).filter(x => x.action === 'add_trip_gift').pop();
    check(L + ': Add sends the kind, amount and trip', c && c.item === 'Hand cream' && c.kind === 'us' && c.amount === '18' && c.tripKey === T && c.status === 'To buy', JSON.stringify(c));
    check(L + ': it lands in Shopping for us', /Hand cream/.test(await page.$eval('.tg-group[data-kind="us"]', n => n.innerText)));

    await page.click('.tg-row[data-id="G2"] .tg-edit'); await wait(200);
    check(L + ': tapping a gift opens it to edit', (await page.inputValue('.tg-in-item')) === 'Cork wallet' && (await page.inputValue('.tg-in-for')) === 'Dad');
    await page.click('.tg-delete'); await wait(300);
    check(L + ': Remove deletes it', !(await page.$('.tg-row[data-id="G2"]')) && (await calls(page)).some(x => x.action === 'delete_trip_gift' && x.id === 'G2'));

    await page.click('.tg-warn'); await wait(150);
    check(L + ': Getting it home: counts, rules and the declare total', (await page.$$eval('.tg-rule', ns => ns.map(n => n.dataset.kind))).join() === 'checkin,avoid'
      && /\$73[\s\S]*of \$1,600/.test(await page.$eval('.tg-declare', n => n.innerText)) && (await page.$$('.tg-count')).length === 3);
    check(L + ': it says to check before flying', /final word/.test(await text()));

    await page.click('.tg-view[data-view="history"]'); await wait(250);
    check(L + ': Given before: by person', (await page.$$eval('.tg-person h3', ns => ns.map(n => n.textContent))).join() === 'Dad,Mom');
    await page.fill('.tg-search', 'tile'); await wait(80);
    check(L + ': search finds by gift', (await page.$$eval('.tg-person h3', ns => ns.map(n => n.textContent))).join() === 'Mom');

    await page.click('.tg-view[data-view="list"]'); await page.click('.tg-trip >> nth=1'); await wait(250);
    check(L + ': a trip with no gifts or budget says so, and offers a budget', /No gifts on this trip yet/.test(await text()) && /Set a budget/.test(await page.$eval('.tg-budget', n => n.innerText)));
    await page.click('.tg-budget-edit'); await page.fill('.tg-budget-input', '150'); await page.click('.tg-budget-save'); await wait(300);
    c = (await calls(page)).filter(x => x.action === 'set_trip_gift_budget').pop();
    check(L + ': setting a budget saves it for that trip', c && c.budget === '150' && c.tripKey === '2027-09-03|Montreal' && /of \$150/.test(await page.$eval('.tg-budget', n => n.innerText)), JSON.stringify(c));
    check(L + ': the picked trip is kept in this browser', (await page.evaluate(() => localStorage.getItem('vera_gifts_trip'))) === '2027-09-03|Montreal');
    check(L + ': buttons are big enough to tap', await page.$$eval('.tg-trip, .tg-view, .tg-add', ns => ns.every(n => n.getBoundingClientRect().height >= 40)));
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();

    ({ page, errs } = await open(width, { vera_gifts_trip: P }));
    await wait(200);
    check(L + ': a past trip asked for (from My Trips) opens on that trip', /Crete/.test(await page.$eval('.tg-trip.on', n => n.textContent)) && /Tile coasters/.test(await page.$eval('.tg-panel', n => n.innerText)));
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
