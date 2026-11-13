// Packing, enriched on screen (issue #234): the PackPlus block, shared verbatim by both dashboards.
// The trip's Packing tab (luggage card + the list: three-step ticks, counts, why, bag chips, add,
// whose), Buy before you go, Outfits by day, Pack a bag with the over-the-limit fixes, starting a
// list (make it, copy a past trip, staples), and in the trip summary Leave nothing behind and the
// after-trip review. The real PackPlus.js, Luggage.js and LeavingHome.js run in the page as the
// stand-in server over in-memory sheets. At 390 and 1280 px. Every value here is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html'), CODE = read('Code.js');
const SRV = ['TripReadiness.js', 'Luggage.js', 'LeavingHome.js', 'PackPlus.js'].map(read).join('\n');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); return i === -1 || j === -1 ? '' : s.slice(i, j + b.length); };
const LUB = s => cut(s, '// ---- LuggageLeave (', '// ---- /LuggageLeave ----');
const PKB = s => cut(s, '// ---- PackPlus (', '// ---- /PackPlus ----');
const H = n => (CODE.match(new RegExp('const ' + n + '\\s*=\\s*(\\[[^\\]]*\\])')) || [])[1];

console.log('\nthe source');
check('both dashboards carry the block, word for word', PKB(APP).length > 20000 && PKB(APP) === PKB(LITE));
check('the trip summary has Leave nothing behind and the review, on both', ['TsCheckout', 'TsPackReview'].every(n => new RegExp('h\\(' + n + ',\\{trip:trip,apiUrl:props\\.apiUrl,apiToken:props\\.apiToken,who:props\\.who,card:card,label:label\\}\\)').test(APP) && new RegExp('h\\(' + n + ',').test(LITE)));
check('Always pack is a profile preference, with a hint', /always_pack:'comma separated: contacts, retainer'/.test(APP) && /always_pack:'comma separated: contacts, retainer'/.test(LITE));

const K = '2027-07-10|Lisbon';
const P = (id, person, item, o) => { o = o || {}; return [id, o.key || K, person, o.cat || 'General', item, o.st === 'bag' ? 'TRUE' : 'FALSE', o.src || 'ai', '2027-06-01', o.st || '', o.qty || '', o.why || '', '', '']; };
const server = o => `
var NOW = ${JSON.stringify(o.now || '2027-07-01T09:00')};
var HEAD = { PackingItems: ${H('PACKING_ITEM_HEADERS')}, Bags: ${H('BAG_HEADERS')}, TripMeta: ${H('TRIP_META_HEADERS')}, 'Trip Outfits': ${H('TRIP_OUTFIT_HEADERS')}, 'Packing Reviews': ${H('PACKING_REVIEW_HEADERS')}, 'Leaving Home Runs': ${H('LEAVE_RUN_HEADERS')}, 'Leaving Home': ${H('LEAVE_HOME_HEADERS')} };
var DATA = ${JSON.stringify(o.data || {})};
function mk(name, h) { var rows = [h || HEAD[name] || []].concat(DATA[name] || []); return { rows: rows, getLastRow: function() { return rows.length; },
  getRange: function(r, c, n, w) { n = n || 1; w = w || 1; return {
    getValues: function() { return rows.slice(r - 1, r - 1 + n).map(function(x) { var o = []; for (var i = 0; i < w; i++) o.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return o; }); },
    getValue: function() { return (rows[r - 1] || [])[c - 1] === undefined ? '' : rows[r - 1][c - 1]; },
    setValue: function(v) { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; },
    setValues: function(v) { v.forEach(function(row, i) { while (rows.length < r + i) rows.push([]); row.forEach(function(x, j) { rows[r - 1 + i][c - 1 + j] = x; }); }); } }; },
  appendRow: function(r) { rows.push(r.slice()); }, deleteRow: function(r) { rows.splice(r - 1, 1); } }; }
var SHEETS = {}; Object.keys(HEAD).forEach(function(n) { SHEETS[n] = mk(n); });
var TABS = { PACKING_ITEMS: 'PackingItems', BAGS: 'Bags', TRIP_META: 'TripMeta', TRIP_OUTFITS: 'Trip Outfits', PACKING_REVIEWS: 'Packing Reviews', LEAVE_RUNS: 'Leaving Home Runs', LEAVE_HOME: 'Leaving Home', TRIP_GIFTS: 'TripGifts', CARD_PERKS: 'CardPerks', ITINERARY: 'Itinerary' };
var PACKING_ITEM_HEADERS = HEAD.PackingItems, BAG_HEADERS = HEAD.Bags, TRIP_META_HEADERS = HEAD.TripMeta, TRIP_OUTFIT_HEADERS = HEAD['Trip Outfits'], PACKING_REVIEW_HEADERS = HEAD['Packing Reviews'], LEAVE_RUN_HEADERS = HEAD['Leaving Home Runs'], LEAVE_HOME_HEADERS = HEAD['Leaving Home'], ITINERARY_HEADERS = [];
var TE_OWNER_ = 'Ahmed', TE_PARTNER_ = 'Victoria';
var LockService = { getScriptLock: function() { return { waitLock: function() {}, releaseLock: function() {} }; } };
var Session = { getScriptTimeZone: function() { return 'UTC'; } }, Logger = { log: function() {} };
var Utilities = { formatDate: function(d, tz, f) { return f === 'yyyy-MM-dd HH:mm' ? NOW.replace('T', ' ') : f === 'yyyy-MM-dd' ? NOW.slice(0, 10) : f === 'yyyyMMdd' ? NOW.slice(0, 10).replace(/-/g, '') : NOW; } };
function tripKeyMatches_(a, b) { var v = String(a == null ? '' : a).trim(); return !!v && v === String(b).trim(); }
function tripRowIs_(a, id, b) { return tripKeyMatches_(a, b); }   // #239: no Trip IDs in these rows
function getSpreadsheet() { return { getSheetByName: function(n) { return SHEETS[n] || null; } }; }
function ensureSheet(ss, n, h) { return SHEETS[n] || (SHEETS[n] = mk(n, h)); }
var META = ${JSON.stringify(o.meta || {})};
function webGetTripMeta_(e) { return META[e.parameter.tripKey] || {}; }
function webSetTripMeta_(e) { SHEETS.TripMeta.appendRow([e.parameter.tripKey, '', '', '', '', '', 2, '', '', '', '']); return { ok: true }; }
function teTravellersForKey_() { return ['Ahmed', 'Victoria']; }
var PROFILE = ${JSON.stringify(o.profile || [])};
function tpItems_() { return PROFILE; }
window.TP_SAVES = [];
function webTpSave_(b) { TP_SAVES.push(b); var have = PROFILE.filter(function(i) { return i.id && i.id === b.id; })[0]; if (have) have.value = b.value; else PROFILE.push({ id: 'TI-' + PROFILE.length, person: b.person, section: b.section, kind: b.kind, value: b.value }); return { ok: true }; }
function tripItemsFor_() { return ${JSON.stringify(o.itinerary || [])}; }
function readTripRegistry_() { return { rows: ${JSON.stringify(o.trips || [])} }; }
var OUTFITS = ${JSON.stringify(o.outfits || null)};
window.CLAUDE = [];
function callClaudeJsonDetailed_(p) { CLAUDE.push(p); return { json: OUTFITS }; }
window.LESSONS = [];
function logTripLesson_(t, s, c, l, d) { LESSONS.push(t); return { ok: true }; }
var SHOP = { tabs: [] };
function mkTab(title) { var t = { title: title, items: [], getTitle: function() { return this.title; }, getId: function() { return title; },
  asDocumentTab: function() { return { getBody: function() { return { getNumChildren: function() { return t.items.length; },
    getChild: function(i) { return { getType: function() { return 'LIST'; }, asListItem: function() { return { getText: function() { return t.items[i].text; }, editAsText: function() { return { isStrikethrough: function() { return t.items[i].done ? true : null; } }; } }; } }; },
    appendListItem: function(x) { t.items.push({ text: x, done: false }); return { setGlyphType: function() {} }; } }; } }; } }; return t; }
function getShoppingDocId_() { return 'doc'; }
var DocumentApp = { ElementType: { LIST_ITEM: 'LIST' }, GlyphType: { BULLET: 'b' }, openById: function() { return { getTabs: function() { return SHOP.tabs; }, addTab: function(o) { var t = mkTab(o.title); SHOP.tabs.push(t); return t; } }; } };
${SRV}
function rowsOut(tripKey) { return pkTripRows_(tripKey).map(function(r) { return { id: r.id, tripKey: r.tripKey, person: r.person, category: r.category, item: r.item, checked: r.status === 'bag', source: r.source, status: r.status, qty: r.qty, why: r.why, by: r.by, at: r.at }; }); }
function genStub(p) { pkAppend_(p.tripKey, [{ person: 'ahmed', category: 'Clothing', item: 'T-shirts', source: 'ai' }, { person: 'victoria', category: 'Clothing', item: 'Sundress', source: 'ai' }]); pkAfterGenerate_(p.tripKey, p.startDate, p.endDate, { hiF: 81, loF: 61 }); return { ok: true }; }
function clone(r) { return JSON.parse(JSON.stringify(r)); }
var GETS = { get_packing: function(p) { return { ok: true, items: rowsOut(p.tripKey) }; }, luggage: webLuggage_, lu_bags: webLuBags_, pk_staples: webPkStaples_, pk_similar: webPkSimilar_, pk_outfits: webPkOutfits_, pk_buy: webPkBuy_, pk_checkout: webPkCheckout_, pk_review: webPkReview_,
  generate_packing: genStub, delete_packing_item: function(p) { var r = pkAllRows_().filter(function(x) { return x.id === p.id; })[0]; if (r) SHEETS.PackingItems.deleteRow(r._row); return { ok: true }; } };
var POSTF = { pk_status: webPkStatus_, pk_qty: webPkQty_, pk_add: webPkAdd_, pk_staple_accept: webPkStapleAccept_, pk_copy: webPkCopy_, pk_outfits_make: webPkOutfitsMake_, pk_outfits_add: webPkOutfitsAdd_, pk_checkout_tick: webPkCheckoutTick_, pk_review_save: webPkReviewSave_, lu_move: webLuMove_, lu_bag_save: webLuBagSave_, lu_bag_delete: webLuBagDelete_ };
window.CALLS = [];
function apiGet(u, t, p) { CALLS.push(p.action); var f = GETS[p.action]; var r = f ? clone(f(p)) : { ok: false, error: 'unknown ' + p.action }; return r.ok ? Promise.resolve(r) : Promise.reject(new Error(r.error)); }
function apiPost(u, t, b) { CALLS.push(b.action); var f = POSTF[b.action]; var r = f ? clone(f(clone(b))) : { ok: false, error: 'unknown ' + b.action }; return r.ok ? Promise.resolve(r) : Promise.reject(new Error(r.error)); }
window.confirm = function() { return true; };
`;

const BAGS = [['B1', 'Grey roller', 'carry-on', '', 5.7, 'Ahmed', '', ''], ['B2', 'Blue medium', 'checked', '', 8.4, 'Victoria', '', ''], ['B4', 'Black backpack', 'personal', '', 2.4, 'Ahmed', '', ''], ['B5', 'Tote', 'personal', '', 1.3, 'Victoria', '', '']];
const PACK = [
  P('A1', 'ahmed', 'Passport', { st: 'bag' }), P('A2', 'ahmed', 'T-shirts', { qty: 6, why: '8 nights, laundry once' }), P('A3', 'ahmed', 'Contacts', { src: 'staple', cat: 'Staples', why: 'Staple · from your profile' }), P('A4', 'ahmed', 'Phone charger'),
  P('V1', 'victoria', 'Wedding dress'), P('V2', 'victoria', 'Heels'), P('V3', 'victoria', 'Shampoo 250 ml', { st: 'buy' }), P('V4', 'victoria', 'Allergy meds'), P('V5', 'victoria', 'Boots'),
  P('V6', 'victoria', 'Jeans', { qty: 4 }), P('V7', 'victoria', 'Olive oil x6'), P('V8', 'victoria', 'Ceramic plates x6'), P('V9', 'victoria', 'Sweaters', { qty: 5 }),
  P('S1', 'shared', 'EU adapter'),
  P('OLD1', 'ahmed', 'Phone stand', { key: '2025-05-01|Porto', st: 'bag' }), P('OLD2', 'ahmed', 'Hair dryer', { key: '2025-05-01|Porto', st: 'bag' }), P('OLD3', 'ahmed', 'Linen shirt', { key: '2025-05-01|Porto', st: 'bag' }),
  P('OLD4', 'ahmed', 'Phone stand', { key: '2024-06-01|Rome', st: 'bag' }), P('OLD5', 'ahmed', 'Phone stand', { key: '2024-01-01|Oslo', st: 'bag' }),
];
const BASE = { data: { Bags: BAGS, PackingItems: PACK, TripMeta: [[K, '', 'Flat with a washer', '', '', '', 2, '', '', '', 'city']], 'Packing Reviews': [['2025-05-01|Porto', '["Hair dryer"]', '[]', '[]', 'Ahmed', '', 'yes']] },
  meta: { [K]: { notes: 'Flat with a washer', characteristics: 'city' }, '2025-05-01|Porto': { characteristics: 'city' } },
  profile: [{ id: 'TI-0', person: 'Ahmed', section: 'preference', kind: 'always_pack', value: 'Contacts' }],
  trips: [{ startDate: '2025-05-01', label: 'Porto', endDate: '2025-05-07' }],
  itinerary: [{ type: 'hotel', title: 'Alfama flat', date: '2027-07-10', metadata: '' }, { type: 'dining', title: 'Belcanto', date: '2027-07-15', metadata: '{"dresscode":"smart casual"}' }],
  outfits: { people: [{ name: 'Ahmed', days: [{ date: '2027-07-10', label: 'Travel', weather: 'about 75° / 62°F', looks: [{ when: 'Flight', pieces: ['Chinos', 'T-shirt', 'Walking shoes'], note: 'Heavy shoes on you' }] },
    { date: '2027-07-15', label: 'Thu', looks: [{ when: 'Dinner at Belcanto', pieces: ['Linen shirt', 'Chinos', 'Loafers'], note: 'smart casual' }] }] },
    { name: 'Victoria', days: [{ date: '2027-07-10', label: 'Travel', looks: [{ when: 'Flight', pieces: ['Jumpsuit', 'Sneakers'] }] }] }] } };
const TRIP = { startDate: '2027-07-10', endDate: '2027-07-18', label: 'Lisbon', tripKey: K };
const CARD = "{padding:12,borderRadius:12,display:'flex',flexDirection:'column',gap:8}", LABEL = "{fontSize:12,color:'#9aa8c8'}";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.js': read('docs/react.min.js'), 'react-dom.js': read('docs/react-dom.min.js') };
  const shell = body => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0b1020;color:#dde1f0;font-family:sans-serif}</style>'
    + '<script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>' + body + '</script></body></html>';
  const open = async (width, o, el, sel, today) => {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const probe = server(o) + LUB(APP) + '\n' + PKB(APP) + "\ntry{localStorage.removeItem('vera_lu_unit');}catch(e){}\n" + (today ? 'window.VERA_TODAY=' + JSON.stringify(today) + ';\n' : '') + "ReactDOM.createRoot(document.getElementById('root')).render(" + el + ');';
    await page.route('**/*', r => { const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] }); return r.fulfill({ contentType: 'text/html', body: shell(probe) }); });
    await page.goto('http://probe.local/'); await page.waitForSelector(sel, { timeout: 5000 }).catch(() => {}); await wait(200);
    return { page, errs };
  };
  const tap = async (page, sel) => { const el = await page.$(sel); if (el) await el.click(); await wait(80); return !!el; };
  const text = (page, sel) => page.$eval(sel, n => n.innerText).catch(() => '');
  const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  const buttons = page => page.$$eval('button', ns => ns.filter(n => n.offsetParent).map(n => n.getBoundingClientRect().height));
  const tile = (page, s) => page.$eval('.pk-tile[data-s="' + s + '"]', n => n.innerText.split('\n')[0]).catch(() => '');
  const row = id => '.pk-item[data-id="' + id + '"]';
  const TAB = "React.createElement(PackTab,{apiUrl:'x',apiToken:'y',tripKey:'" + K + "',startDate:'2027-07-10',endDate:'2027-07-18',who:'Ahmed'})";

  for (const width of [390, 1280]) {
    const L = '@' + width;
    console.log('\nthe list ' + L);
    let { page, errs } = await open(width, BASE, TAB, '.pk-item');
    check(L + ': the luggage card sits above the list', !!(await page.$('.pk-tab .lu-card')) && (await page.$$eval('.pk-tab > *', ns => ns.map(n => n.className).join())).indexOf('lu-card') === 0);
    check(L + ': to buy 1 · ready 12 · in the bag 1', (await tile(page, 'buy')) === '1' && (await tile(page, 'ready')) === '12' && (await tile(page, 'bag')) === '1');
    check(L + ': staples first, marked', (await page.$eval('.pk-cat', n => n.dataset.cat)) === 'Staples' && /Always with you \(staples\)[\s\S]*Contacts[\s\S]*Staple · from your profile/i.test(await text(page, '.pk-cat[data-cat="Staples"]')));
    check(L + ': counts with why', /T-shirts × 6/.test(await text(page, row('A2'))) && /8 nights, laundry once/.test(await text(page, row('A2'))));
    check(L + ': each item shows its bag', /Black backpack/.test(await text(page, row('A1') + ' .pk-bag')) && /Grey roller/.test(await text(page, row('A4') + ' .pk-bag')) && /Blue medium/.test(await text(page, row('V7') + ' .pk-bag')));
    await tap(page, row('A4') + ' .pk-step');
    check(L + ': tap the circle: ready → in the bag, packed by You, written for both', (await page.$eval(row('A4'), n => n.dataset.status)) === 'bag' && /packed by You · 2027-07-01 09:00/.test(await text(page, row('A4')))
      && (await page.evaluate(() => { var r = SHEETS.PackingItems.rows.filter(x => x[0] === 'A4')[0]; return r[8] + r[5] + r[11]; })) === 'bagTRUEAhmed');
    await tap(page, row('A4') + ' .pk-step');
    check(L + ': again: in the bag → to buy', (await page.$eval(row('A4'), n => n.dataset.status)) === 'buy' && (await tile(page, 'buy')) === '2');
    await tap(page, row('A4') + ' .pk-step');
    await tap(page, row('A2') + ' .pk-qty'); await page.fill('.pk-qty-input', '4'); await tap(page, '.pk-qty-save');
    check(L + ': change the count', /T-shirts × 4/.test(await text(page, row('A2'))) && /Set by hand/.test(await text(page, row('A2'))));
    await page.fill('.pk-add-item', 'Sun hat'); await tap(page, '.pk-add-buy'); await tap(page, '.pk-add-btn');
    check(L + ': add something to buy: on the list and on the trip’s Shopping tab', (await tile(page, 'buy')) === '2' && (await page.evaluate(() => (SHOP.tabs.filter(t => t.title === 'Trip: Lisbon')[0] || { items: [] }).items.map(i => i.text))).indexOf('Sun hat (need by Jul 8)') !== -1);
    await tap(page, '.pk-person[data-v="victoria"]');
    check(L + ': whose: Victoria’s only', (await page.$$('.pk-item')).length === 9 && !(await page.$(row('A2'))));
    await tap(page, '.pk-person[data-v="all"]');
    await tap(page, row('S1') + ' .pk-del');
    check(L + ': × removes an item', !(await page.$(row('S1'))));
    check(L + ': every button at least 36 px; no sideways scroll; no errors', (await buttons(page)).every(x => x >= 35.5) && await noScroll(page) && errs.length === 0, errs.join(' | ') + JSON.stringify((await buttons(page)).filter(x => x < 35.5)));

    console.log('\nbuy before you go ' + L);
    await tap(page, '.pk-go-buy');
    check(L + ': the buy list: shampoo and the hat, need-by date, meds note', (await page.$$('.pk-buy-item')).length === 2 && /Shopping › Trip: Lisbon, need by Jul 8/.test(await text(page, '.pk-buy')));
    await page.evaluate(() => { SHOP.tabs[0].items.filter(i => /^Sun hat/.test(i.text))[0].done = true; });
    await tap(page, '.pk-back'); await tap(page, '.pk-go-buy');
    check(L + ': bought in Shopping comes back ready', /Bought in Shopping, now ready: Sun hat/.test(await text(page, '.pk-buy')) && (await page.$$('.pk-buy-item')).length === 1);
    await tap(page, '.pk-buy-item[data-id="V3"] .pk-bought-box');
    check(L + ': tick bought here', /Nothing to buy/.test(await text(page, '.pk-buy')));
    await page.fill('.pk-buy-input', 'Plug adapter'); await tap(page, '.pk-buy-add');
    check(L + ': add straight to the buy list', (await page.$$('.pk-buy-item')).length === 1 && /Plug adapter/.test(await text(page, '.pk-buy')));
    await tap(page, '.pk-back');

    console.log('\noutfits ' + L);
    await tap(page, '.pk-go-outfits');
    check(L + ': no plan yet', /No outfit plan for this trip yet/.test(await text(page, '.pk-outfits')));
    await tap(page, '.pk-outfits-make'); await wait(150);
    check(L + ': planned from the itinerary: days, looks, notes', (await page.$$('.pk-day')).length === 2 && /Dinner at Belcanto[\s\S]*Linen shirt, Chinos, Loafers[\s\S]*smart casual/.test(await text(page, '.pk-outfits')) && (await page.evaluate(() => CLAUDE.length)) === 1);
    check(L + ': what they add up to', /Chinos · T-shirt · Walking shoes · Linen shirt · Loafers/.test(await text(page, '.pk-pieces')), await text(page, '.pk-pieces'));
    await tap(page, '.pk-outfits-add');
    check(L + ': add to my list', /^Added 4\.$/.test(await text(page, '.pk-outfits-msg')), await text(page, '.pk-outfits-msg'));
    await tap(page, '.pk-outfit-person[data-v="Victoria"]');
    check(L + ': Victoria’s outfits', /Jumpsuit, Sneakers/.test(await text(page, '.pk-outfits')) && /Add these to Victoria’s list/.test(await text(page, '.pk-outfits-add')));
    await tap(page, '.pk-back');
    check(L + ': back on the list, the outfit pieces are there', /From outfits/.test(await text(page, '.pk-panel')) && /Loafers/.test(await text(page, '.pk-panel')));

    console.log('\npack a bag ' + L);
    await tap(page, '.pk-go-bag');
    await tap(page, '.pk-bag-pick[data-v="B2"]');
    check(L + ': Victoria’s Blue medium: 0 in, weight so far is the bag', /Pack the Blue medium/.test(await text(page, '.pk-bag-card')) && /0 of \d+ in/.test(await text(page, '.pk-bag-count')) && /about 8 of 50 lb so far/.test(await text(page, '.pk-bag-weight')), await text(page, '.pk-bag-weight'));
    check(L + ': over the limit: fixes, biggest first', (await page.$$eval('.pk-fix', ns => ns.map(n => n.dataset.kind).join())) === 'move,wear,fewer' && /Move the Ceramic plates x6 to the Tote[\s\S]*saves about 9 lb/.test(await text(page, '.pk-over')) && /Wear the Boots on the plane/.test(await text(page, '.pk-over')) && /\$75–100/.test(await text(page, '.pk-over')), await text(page, '.pk-over'));
    await page.click('.pk-bag-item[data-key="p:V2"] .pk-bag-box'); await wait(250);
    check(L + ': tick heels in: 1 in, weight goes up, in the bag on the list', /1 of \d+ in/.test(await text(page, '.pk-bag-count')) && /about 10 of 50 lb so far/.test(await text(page, '.pk-bag-weight')) && (await page.evaluate(() => SHEETS.PackingItems.rows.filter(x => x[0] === 'V2')[0][8])) === 'bag');
    await tap(page, '.pk-fix[data-kind="wear"] .pk-fix-do');
    check(L + ': wear the boots: out of the bag', !(await page.$('.pk-bag-item[data-key="p:V5"]')) && /"p:V5":"wear"/.test(await page.evaluate(() => SHEETS.TripMeta.rows[1][9])));
    await tap(page, '.pk-fix[data-kind="move"] .pk-fix-do');
    check(L + ': move the plates: under the limit, the fixes go', !(await page.$('.pk-over')) && !(await page.$('.pk-bag-item[data-key="p:V8"]')), await text(page, '.pk-bag-card'));
    check(L + ': no sideways scroll; no errors', await noScroll(page) && errs.length === 0, errs.join(' | '));
    await tap(page, '.pk-back');
    check(L + ': the list shows the boots worn', /Wear/.test(await text(page, row('V5') + ' .pk-bag')));

    console.log('\nremake or copy ' + L);
    await tap(page, '.pk-go-start');
    check(L + ': past trips, with why', (await page.$$('.pk-sim')).length === 3 && /Porto · 2025-05[\s\S]*city[\s\S]*you didn’t use 1 thing/.test(await text(page, '.pk-sim[data-key="2025-05-01|Porto"]')));
    check(L + ': staples: yours, and the phone stand on every list', /You: Contacts/.test(await text(page, '.pk-staple[data-name="Ahmed"]')) && !!(await page.$('.pk-staple-add[data-item="Phone stand"]')));
    await tap(page, '.pk-staple-add[data-item="Phone stand"]');
    check(L + ': accept it onto your profile', (await page.evaluate(() => (TP_SAVES.slice(-1)[0] || {}).value)) === 'Contacts, Phone stand' && /You: Contacts, Phone stand/.test(await text(page, '.pk-staple[data-name="Ahmed"]')));
    await tap(page, '.pk-sim[data-key="2025-05-01|Porto"] .pk-copy');
    check(L + ': copy Porto: the shirt comes, the hair dryer doesn’t', (await page.evaluate(() => SHEETS.PackingItems.rows.filter(r => r[1] === '2027-07-10|Lisbon').map(r => r[4]).join('|'))).indexOf('Hair dryer') === -1
      && /Phone stand/.test(await text(page, '.pk-panel')) && (await page.$$('.pk-start')).length === 0);
    check(L + ': no errors', errs.length === 0, errs.join(' | '));
    await page.close();

    console.log('\nan empty list ' + L);
    ({ page, errs } = await open(width, Object.assign({}, BASE, { data: Object.assign({}, BASE.data, { PackingItems: [] }) }), TAB, '.pk-start'));
    check(L + ': it says how the list is built, as before', /destination, dates, weather, trip type, briefing, itinerary, dress codes/.test(await text(page, '.pk-start')) && /Make the list/.test(await text(page, '.pk-generate')));
    await tap(page, '.pk-generate'); await wait(200);
    check(L + ': Make the list: VERA’s items, counted, plus your staples', /T-shirts × 6/.test(await text(page, '.pk-panel')) && /8 nights, laundry once/.test(await text(page, '.pk-panel')) && /Contacts/.test(await text(page, '.pk-cat[data-cat="Staples"]')), await text(page, '.pk-panel'));
    check(L + ': no errors', errs.length === 0, errs.join(' | '));
    await page.close();

    console.log('\nthe trip summary ' + L);
    const TS = n => 'React.createElement(' + n + ',{trip:' + JSON.stringify(TRIP) + ",apiUrl:'x',apiToken:'y',who:'Ahmed',card:" + CARD + ',label:' + LABEL + '})';
    ({ page, errs } = await open(width, BASE, TS('TsCheckout'), '.ts-checkout', '2027-07-17'));
    check(L + ': the evening before checkout: Leave nothing behind', /Checkout 2027-07-18 from Alfama flat/.test(await text(page, '.ts-checkout')) && /Chargers and cables off the wall/.test(await text(page, '.ts-checkout')) && /0 of \d+/.test(await text(page, '.pk-co-progress')));
    await tap(page, '.pk-co-item[data-key="safe"] .pk-co-box');
    check(L + ': a tick: shared, ticked by You', /1 of/.test(await text(page, '.pk-co-progress')) && /ticked by You/.test(await text(page, '.pk-co-item[data-key="safe"]')) && (await page.evaluate(() => SHEETS['Leaving Home Runs'].rows[1][1])) === 'checkout');
    check(L + ': no sideways scroll; no errors', await noScroll(page) && errs.length === 0, errs.join(' | '));
    await page.close();
    ({ page, errs } = await open(width, BASE, TS('TsCheckout'), '#root', '2027-07-12'));
    check(L + ': mid-trip: not shown yet', !(await page.$('.ts-checkout')) && errs.length === 0);
    await page.close();
    ({ page, errs } = await open(width, BASE, TS('TsPackReview'), '.ts-packreview', '2027-07-20'));
    check(L + ': after the trip: what you packed, to tap', (await page.$$('.pk-rv-group[data-k="unused"] .pk-rv-chip')).length >= 13);
    await tap(page, '.pk-rv-chip[data-v="unused:Sweaters"]');
    await page.fill('.pk-rv-input[data-k="forgot"]', 'Beach towel'); await tap(page, '.pk-rv-add[data-k="forgot"]');
    await page.fill('.pk-rv-input[data-k="bought"]', 'Sunscreen'); await tap(page, '.pk-rv-add[data-k="bought"]');
    await tap(page, '.pk-rv-save');
    check(L + ': save: lessons for next time', /Saved\. Next time: Pack less: Sweaters; Remember: Beach towel; Pack it, don’t buy it: Sunscreen/.test(await text(page, '.pk-rv-msg')) && (await page.evaluate(() => LESSONS.length)) === 3, await text(page, '.pk-rv-msg'));
    check(L + ': every button at least 36 px; no sideways scroll; no errors', (await buttons(page)).every(x => x >= 35.5) && await noScroll(page) && errs.length === 0, errs.join(' | '));
    await page.close();
    ({ page, errs } = await open(width, BASE, TS('TsPackReview'), '#root', '2027-07-12'));
    check(L + ': during the trip: no review', !(await page.$('.ts-packreview')) && errs.length === 0);
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
