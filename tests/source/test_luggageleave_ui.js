// Luggage and leaving home on screen (issues #230, #231): the LuggageLeave block, shared verbatim by
// both dashboards. The luggage card at the top of a trip's Packing (bags per person, about-weights,
// the lb/kg switch, the airline box, road trips, what goes in each bag with Move to), Our bags
// (Travel › Travelers), Leaving home (Home Front › House: templates per home, Heading out) and the
// trip's "Before you head out". The real Luggage.js and LeavingHome.js run in the page as the
// stand-in server, over in-memory sheets. At 390 and 1280 px. Every value here is invented.
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
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const LU = fs.readFileSync(path.join(ROOT, 'Luggage.js'), 'utf8');
const LH = fs.readFileSync(path.join(ROOT, 'LeavingHome.js'), 'utf8');
const TRD = fs.readFileSync(path.join(ROOT, 'TripReadiness.js'), 'utf8');
const START = '// ---- LuggageLeave (', END = '// ---- /LuggageLeave ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
const H = n => (CODE.match(new RegExp('const ' + n + '\\s*=\\s*(\\[[^\\]]*\\])')) || [])[1];

console.log('\nthe source');
check('both dashboards carry the block, word for word', block(APP).length > 20000 && block(APP) === block(LITE));
check('full: the card sits above the trip’s packing list', /React\.createElement\(LuggageCard,\{apiUrl:apiUrl,apiToken:apiToken,tripKey:luKey,startDate:t\.startDate,endDate:t\.endDate,who:'Ahmed',refreshKey:[^}]*\}\),React\.createElement\(PackingPanel,\{trips:\[t\],/.test(APP));
check('lite: the card sits above the packing list too', /<><LuggageCard apiUrl=\{apiUrl\} apiToken=\{apiToken\} tripKey=\{tripKey\} startDate=\{t\.startDate\} endDate=\{t\.endDate\} who="Victoria"[\s\S]{0,200}<PackingLitePanel/.test(LITE));
check('Our bags at Travel › Travelers, on both', /sub==='bags'&&\/\*#__PURE__\*\/React\.createElement\(OurBagsPanel,\{apiUrl:apiUrl,apiToken:apiToken,who:'Ahmed'\}\)/.test(APP) && /\{id:'bags',label:'🧳 Our bags'\}/.test(APP)
  && /\{travSub === 'bags' && <OurBagsPanel apiUrl=\{apiUrl\} apiToken=\{apiToken\} who="Victoria" \/>\}/.test(LITE));
check('Leaving home at Home Front › House, on both', /sub==='leaving_home'&&\/\*#__PURE__\*\/React\.createElement\(LeaveHomePanel,\{apiUrl:apiUrl,apiToken:apiToken,who:'Ahmed'\}\)/.test(APP)
  && /<LeaveHomePanel apiUrl=\{apiUrl\} apiToken=\{apiToken\} who="Victoria" \/>/.test(LITE) && /\{ id:'leaving_home', label:'🚪 Leaving home' \}/.test(LITE) && /\{id:'leaving_home',label:'🚪 Leaving home'\}/.test(APP));
check('the trip summary has Before you head out, and knows who is looking', /h\(TsLeaveHome,\{trip:trip,apiUrl:props\.apiUrl,apiToken:props\.apiToken,who:props\.who,card:card,label:label\}\)/.test(APP)
  && /React\.createElement\(TripSummaryView,\{trip:trip,who:'Ahmed',/.test(APP) && /<TripSummaryView trip=\{\{\.\.\.t,tripKey\}\} who="Victoria" /.test(LITE));

const KEY = '2027-07-10|Lisbon';
const server = o => `
var NOW = ${JSON.stringify(o.now || '2027-07-09T21:00')};
var HEAD = { Bags: ${H('BAG_HEADERS')}, TripMeta: ${H('TRIP_META_HEADERS')}, PackingItems: ${H('PACKING_ITEM_HEADERS')}, 'Leaving Home': ${H('LEAVE_HOME_HEADERS')}, 'Leaving Home Runs': ${H('LEAVE_RUN_HEADERS')}, Itinerary: ${H('ITINERARY_HEADERS')} };
var DATA = ${JSON.stringify(o.data || {})};
function mk(name) { var rows = [HEAD[name] || []].concat(DATA[name] || []); return { rows: rows, getLastRow: function() { return rows.length; },
  getRange: function(r, c, n, w) { n = n || 1; w = w || 1; return {
    getValues: function() { return rows.slice(r - 1, r - 1 + n).map(function(x) { var o = []; for (var i = 0; i < w; i++) o.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return o; }); },
    getValue: function() { return (rows[r - 1] || [])[c - 1] === undefined ? '' : rows[r - 1][c - 1]; },
    setValue: function(v) { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; },
    setValues: function(v) { v.forEach(function(row, i) { while (rows.length < r + i) rows.push([]); row.forEach(function(x, j) { rows[r - 1 + i][c - 1 + j] = x; }); }); } }; },
  appendRow: function(r) { rows.push(r.slice()); }, deleteRow: function(r) { rows.splice(r - 1, 1); } }; }
var SHEETS = {}; ['Bags', 'TripMeta', 'PackingItems', 'Leaving Home', 'Leaving Home Runs', 'Itinerary'].forEach(function(n) { SHEETS[n] = mk(n); });
var TABS = { BAGS: 'Bags', TRIP_META: 'TripMeta', PACKING_ITEMS: 'PackingItems', TRIP_GIFTS: 'TripGifts', CARD_PERKS: 'CardPerks', LEAVE_HOME: 'Leaving Home', LEAVE_RUNS: 'Leaving Home Runs', ITINERARY: 'Itinerary' };
var BAG_HEADERS = HEAD.Bags, TRIP_META_HEADERS = HEAD.TripMeta, PACKING_ITEM_HEADERS = HEAD.PackingItems, LEAVE_HOME_HEADERS = HEAD['Leaving Home'], LEAVE_RUN_HEADERS = HEAD['Leaving Home Runs'], ITINERARY_HEADERS = HEAD.Itinerary;
var TE_OWNER_ = 'Ahmed', TE_PARTNER_ = 'Victoria';
var LockService = { getScriptLock: function() { return { waitLock: function() {}, releaseLock: function() {} }; } };
var Session = { getScriptTimeZone: function() { return 'UTC'; } }, Logger = { log: function() {} };
var Utilities = { formatDate: function(d, tz, f) { return f === 'yyyy-MM-dd HH:mm' ? NOW.replace('T', ' ') : f === 'yyyy-MM-dd' ? NOW.slice(0, 10) : NOW; } };
function getSpreadsheet() { return { getSheetByName: function(n) { return SHEETS[n] || null; } }; }
function ensureSheet(ss, n) { return SHEETS[n] || (SHEETS[n] = mk(n)); }
var META = ${JSON.stringify(o.meta || {})};
function webGetTripMeta_() { return META; }
function webSetTripMeta_(e) { SHEETS.TripMeta.appendRow([e.parameter.tripKey, '', '', '', '', '', 2, '', '', '', '']); return { ok: true }; }
function teTravellersForKey_() { return ['Ahmed', 'Victoria']; }
function tpItems_() { return ${JSON.stringify(o.items || [])}; }
function tripItemsFor_() { return ${JSON.stringify(o.itinerary || [])}; }
function readTripRegistry_() { return { rows: [] }; }
function sendNudge_() {}
window.POSTS = [];
${TRD}
${LU}
${LH}
function clone(r) { return JSON.parse(JSON.stringify(r)); }
var GETS = { luggage: webLuggage_, lu_bags: webLuBags_, lh_get: webLhGet_, lh_trip: webLhTrip_ };
var POSTF = { lu_bag_save: webLuBagSave_, lu_bag_delete: webLuBagDelete_, lu_move: webLuMove_, lh_item_save: webLhItemSave_, lh_item_delete: webLhItemDelete_, lh_tick: webLhTick_, lh_oneoff: webLhOneOff_, lh_run_set: webLhRunSet_, lh_away: webLhAway_, lh_away_delete: webLhAwayDelete_ };
function apiGet(u, t, p) { var f = GETS[p.action]; var r = f ? clone(f(p)) : { ok: false, error: 'unknown ' + p.action }; return r.ok ? Promise.resolve(r) : Promise.reject(new Error(r.error)); }
function apiPost(u, t, b) { POSTS.push(clone(b)); var f = POSTF[b.action]; var r = f ? clone(f(clone(b))) : { ok: false, error: 'unknown ' + b.action }; return r.ok ? Promise.resolve(r) : Promise.reject(new Error(r.error)); }
window.confirm = function() { return true; };
`;

const BAGS = [
  ['B1', 'Grey roller', 'carry-on', '22 × 14 × 9 in', 5.7, 'Ahmed', '', ''],
  ['B2', 'Blue medium', 'checked', '27 × 18 × 11 in', 8.4, 'Victoria', '', ''],
  ['B3', 'Big black spinner', 'checked', '31 × 20 × 12 in', 10.8, 'Shared', '', ''],
  ['B4', 'Black backpack', 'personal', '18 × 12 × 7 in', 2.4, 'Ahmed', '', ''],
  ['B5', 'Tote', 'personal', '', 1.3, 'Victoria', '', ''],
];
const PACK = [['1', KEY, 'ahmed', 'Docs', 'Passport', 'FALSE', 'manual', ''], ['2', KEY, 'ahmed', 'Clothes', 'T-shirts x5', 'FALSE', 'manual', ''], ['3', KEY, 'ahmed', 'Clothes', 'Jeans', 'FALSE', 'manual', ''],
  ['4', KEY, 'ahmed', 'Tech', 'Phone charger', 'FALSE', 'manual', ''], ['5', KEY, 'victoria', 'Clothes', 'Wedding dress', 'FALSE', 'manual', ''], ['6', KEY, 'victoria', 'Clothes', 'Heels', 'FALSE', 'manual', ''],
  ['7', KEY, 'victoria', 'Toiletries', 'Shampoo 250 ml', 'FALSE', 'manual', ''], ['8', KEY, 'victoria', 'Health', 'Allergy meds', 'FALSE', 'manual', '']];
const LUG = { data: { Bags: BAGS, PackingItems: PACK, TripMeta: [[KEY, '', 'Flat with a washer', '', '', '', 2, '', '', '', 'city']] }, meta: { notes: 'Flat with a washer', characteristics: 'city' },
  items: [{ person: 'Ahmed', section: 'membership', label: 'Aegean Miles+Bonus', value: 'Star Alliance', tier: 'Gold' }],
  itinerary: [{ type: 'flight', title: 'TP 204 IAD → LIS', date: '2027-07-10', metadata: '{"flightNum":"TP204"}' }] };
const TRIP = { startDate: '2027-07-10', endDate: '2027-07-18', label: 'Lisbon', tripKey: KEY };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'), 'react-dom.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8') };
  const shell = body => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0b1020;color:#dde1f0;font-family:sans-serif}</style>'
    + '<script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>' + body + '</script></body></html>';
  const open = async (width, o, el, sel, unit) => {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const pre = unit ? "try{localStorage.setItem('vera_lu_unit'," + JSON.stringify(unit) + ");}catch(e){}\n" : "try{localStorage.removeItem('vera_lu_unit');}catch(e){}\n";
    const probe = server(o) + block(APP) + '\n' + pre + "ReactDOM.createRoot(document.getElementById('root')).render(" + el + ');';
    await page.route('**/*', r => { const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] }); return r.fulfill({ contentType: 'text/html', body: shell(probe) }); });
    await page.goto('http://probe.local/'); await page.waitForSelector(sel, { timeout: 5000 }).catch(() => {}); await wait(150);
    return { page, errs };
  };
  const tap = async (page, sel) => { const el = await page.$(sel); if (el) await el.click(); await wait(160); return !!el; };
  const text = (page, sel) => page.$eval(sel, n => n.innerText).catch(() => '');
  const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  const buttons = page => page.$$eval('button', ns => ns.filter(n => n.offsetParent).map(n => n.getBoundingClientRect().height));
  const CARD = "React.createElement(LuggageCard,{apiUrl:'x',apiToken:'y',tripKey:'" + KEY + "',startDate:'2027-07-10',endDate:'2027-07-18',who:'Ahmed'})";

  for (const width of [390, 1280]) {
    const L = '@' + width;
    console.log('\nthe luggage card ' + L);
    let { page, errs } = await open(width, LUG, CARD, '.lu-person');
    check(L + ': one card per traveller; you are You', (await page.$$eval('.lu-person', ns => ns.map(n => n.dataset.name).join())) === 'Ahmed,Victoria' && /^You/.test(await text(page, '.lu-person[data-name="Ahmed"]')));
    check(L + ': the header says 8 nights and laundry', /8 nights · laundry/.test(await text(page, '.lu-card')));
    const vic = await text(page, '.lu-person[data-name="Victoria"]');
    check(L + ': Victoria takes her Blue medium, checked, with the reason', /Blue medium · checked/.test(vic) && /A checked bag: the Shampoo 250 ml/.test(vic), vic);
    check(L + ': you: carry-on only, your own bags by name', /Grey roller · carry-on/.test(await text(page, '.lu-person[data-name="Ahmed"]')) && /Carry-on only: 8 nights with laundry/.test(await text(page, '.lu-person[data-name="Ahmed"]')));
    check(L + ': about-weights in lb by default, against the 50 lb limit', /about \d+ of 50 lb/.test(vic) && (await page.$eval('.lu-unit[aria-pressed="true"]', n => n.dataset.v)) === 'lb');
    check(L + ': TAP weighs carry-ons: about N of 18 lb', /about \d+ of 18 lb/.test(await text(page, '.lu-person[data-name="Ahmed"]')), await text(page, '.lu-person[data-name="Ahmed"]'));
    const air = await text(page, '.lu-air');
    check(L + ': the airline box: what’s free, status, check before you fly', /What’s free/.test(air) && /TP204: carry-on and personal item, usually free/.test(air) && /free for Ahmed with Star Alliance Gold/.test(air) && /check before you fly/.test(air), air);
    await tap(page, '.lu-unit[data-v="kg"]');
    check(L + ': kg switch: the limits read 23 kg', /of 23 kg/.test(await text(page, '.lu-person[data-name="Victoria"]')) && /Checked limit 23 kg/.test(await text(page, '.lu-air')) && (await page.evaluate(() => localStorage.getItem('vera_lu_unit'))) === 'kg');
    await tap(page, '.lu-unit[data-v="lb"]');
    // what goes in each bag
    await tap(page, '.lu-split-open');
    check(L + ': the split groups by bag, yours first', (await page.$$eval('.lu-split-bag', ns => ns.map(n => n.dataset.bag).join())) === 'B1,B4' && /What goes in each bag/.test(await text(page, '.lu-card')));
    check(L + ': passport in the backpack, charger in the roller, with why', /Passport[\s\S]*documents stay with you/.test(await text(page, '.lu-split-bag[data-bag="B4"]')) && /Phone charger[\s\S]*never checked/.test(await text(page, '.lu-split-bag[data-bag="B1"]')));
    await page.selectOption('.lu-move[data-item="p:3"]', 'B4').catch(() => {}); await wait(250);
    check(L + ': Move to puts the jeans in the backpack and keeps it', /Jeans/.test(await text(page, '.lu-split-bag[data-bag="B4"]')) && !/Jeans/.test(await text(page, '.lu-split-bag[data-bag="B1"]'))
      && /"p:3":"B4"/.test(await page.evaluate(() => SHEETS.TripMeta.rows[1][9])));
    await tap(page, '.lu-split-person[data-v="Victoria"]');
    const vs = await page.$$eval('.lu-split-bag', ns => ns.map(n => n.innerText).join(' | '));
    check(L + ': Victoria’s bags: shampoo flagged as a liquid in the checked bag, meds with her', /Blue medium[\s\S]*Shampoo 250 ml[\s\S]*liquid over 100 ml/.test(vs) && /Tote[\s\S]*Allergy meds[\s\S]*meds stay with you/.test(vs), vs);
    await page.selectOption('.lu-move[data-item="p:8"]', 'B2').catch(() => {}); await wait(250);
    check(L + ': moving meds into the checked bag warns', /Allergy meds[\s\S]*better with you/.test(await text(page, '.lu-split-bag[data-bag="B2"]')));
    await page.selectOption('.lu-move[data-item="p:8"]', '').catch(() => {}); await wait(250);
    check(L + ': VERA’s pick puts it back', /Allergy meds/.test(await text(page, '.lu-split-bag[data-bag="B5"]')));
    await tap(page, '.lu-split-open');
    await tap(page, '.lu-bags-open');
    check(L + ': Our bags opens inside the card', (await page.$$('.lu-card .ob-bag')).length === 5);
    check(L + ': every button at least 36 px; no sideways scroll; no errors', (await buttons(page)).every(x => x >= 35.5) && await noScroll(page) && errs.length === 0, errs.join(' | ') + JSON.stringify((await buttons(page)).filter(x => x < 35.5)));
    await page.close();

    ({ page, errs } = await open(width, Object.assign({}, LUG, { meta: { characteristics: 'roadtrip' } }), CARD, '.lu-person', 'kg'));
    check(L + ': a road trip: the bags, no airline box, no limits; kg remembered', /Road trip: the bags, without airline rules/.test(await text(page, '.lu-card')) && !(await page.$('.lu-air')) && !/ of /.test(await text(page, '.lu-person[data-name="Victoria"]'))
      && (await page.$eval('.lu-unit[aria-pressed="true"]', n => n.dataset.v)) === 'kg' && errs.length === 0);
    await page.close();

    console.log('\nour bags ' + L);
    ({ page, errs } = await open(width, LUG, "React.createElement(OurBagsPanel,{apiUrl:'x',apiToken:'y',who:'Victoria'})", '.ob-bag'));
    check(L + ': the bags, with type, size, weight and whose', (await page.$$('.ob-bag')).length === 5 && /Blue medium[\s\S]*27 × 18 × 11 in · 8.4 lb · You[\s\S]*Checked/.test(await text(page, '.ob-bag[data-id="B2"]')) && /shared/.test(await text(page, '.ob-bag[data-id="B3"]')));
    await page.fill('.ob-name', 'Red spinner'); await page.selectOption('.ob-type', 'checked'); await page.fill('.ob-weight', '9.3'); await page.fill('.ob-size', '76 × 52 × 31 cm'); await page.selectOption('.ob-whose', 'Victoria');
    await tap(page, '.ob-save');
    let last = await page.evaluate(() => SHEETS.Bags.rows.slice(-1)[0]);
    check(L + ': Save adds it, weight kept in lb', (await page.$$('.ob-bag')).length === 6 && last[1] === 'Red spinner' && last[2] === 'checked' && last[4] === 9.3 && last[5] === 'Victoria' && /Saved/.test(await text(page, '.ob-msg')), JSON.stringify(last));
    await tap(page, '.ob-bag[data-id="B5"] .ob-edit');
    check(L + ': Edit fills the form', (await page.$eval('.ob-name', n => n.value)) === 'Tote' && (await page.$eval('.ob-type', n => n.value)) === 'personal');
    await page.fill('.ob-name', 'Canvas tote'); await tap(page, '.ob-save');
    check(L + ': and saves in place', /Canvas tote/.test(await text(page, '.ob-bag[data-id="B5"]')) && (await page.$$('.ob-bag')).length === 6);
    await tap(page, '.ob-bag[data-id="B1"] .ob-del');
    check(L + ': × removes a bag', !(await page.$('.ob-bag[data-id="B1"]')) && (await page.$$('.ob-bag')).length === 5);
    check(L + ': no sideways scroll; no errors', await noScroll(page) && errs.length === 0, errs.join(' | '));
    await page.close();
    ({ page, errs } = await open(width, LUG, "React.createElement(OurBagsPanel,{apiUrl:'x',apiToken:'y',who:'Ahmed'})", '.ob-bag', 'kg'));
    check(L + ': in kg the weights show in kg, and a kg weight is saved as lb', /3\.8 kg/.test(await text(page, '.ob-bag[data-id="B2"]')) && /Empty weight \(kg\)/.test(await text(page, '.ob-form')));
    await page.fill('.ob-name', 'Duffel'); await page.selectOption('.ob-type', 'carry-on'); await page.fill('.ob-weight', '2'); await tap(page, '.ob-save');
    last = await page.evaluate(() => SHEETS.Bags.rows.slice(-1)[0]);
    check(L + ': 2 kg is 4.4 lb on the sheet', last[1] === 'Duffel' && last[4] === 4.4, JSON.stringify(last));
    await page.close();

    console.log('\nleaving home ' + L);
    ({ page, errs } = await open(width, {}, "React.createElement(LeaveHomePanel,{apiUrl:'x',apiToken:'y',who:'Victoria'})", '.lh-group'));
    check(L + ': a starter list for Our home, in six groups', (await page.$$eval('.lh-group', ns => ns.map(n => n.dataset.group).join())) === 'always,summer,winter,nights3,nights7,empty' && (await page.$$('.lh-tpl')).length === 18
      && (await page.$eval('.lh-home[aria-pressed="true"]', n => n.dataset.v)) === 'Our home');
    await page.fill('.lh-add-item', 'Feed the fish'); await page.selectOption('.lh-add-group', 'nights3'); await tap(page, '.lh-add-btn');
    check(L + ': Victoria adds an item; it lands in its group, signed', /Feed the fish/.test(await text(page, '.lh-group[data-group="nights3"]')) && (await page.evaluate(() => SHEETS['Leaving Home'].rows.slice(-1)[0][6])) === 'Victoria');
    const fishId = await page.evaluate(() => SHEETS['Leaving Home'].rows.slice(-1)[0][0]);
    await tap(page, '.lh-tpl[data-id="' + fishId + '"] .lh-tpl-edit'); await page.fill('.lh-add-item', 'Ask Sam to feed the fish'); await tap(page, '.lh-add-btn');
    check(L + ': Edit changes it in place', /Ask Sam to feed the fish/.test(await text(page, '.lh-group[data-group="nights3"]')) && (await page.$$('.lh-tpl')).length === 19);
    await tap(page, '.lh-tpl[data-id="' + fishId + '"] .lh-tpl-del');
    check(L + ': × removes it', (await page.$$('.lh-tpl')).length === 18);
    await tap(page, '.lh-home-new'); await page.fill('.lh-home-name', 'Beach flat'); await page.click('.lh-add-item'); await wait(150);
    check(L + ': a new home starts empty', (await page.$eval('.lh-home[aria-pressed="true"]', n => n.dataset.v).catch(() => '')) === 'Beach flat' && (await page.$$('.lh-tpl')).length === 0);
    await page.fill('.lh-add-item', 'Shut the shutters'); await tap(page, '.lh-add-btn');
    check(L + ': and keeps its first item', (await page.$$eval('.lh-home', ns => ns.map(n => n.dataset.v).join())) === 'Our home,Beach flat' && (await page.$$('.lh-tpl')).length === 1);
    await tap(page, '.lh-home[data-v="Our home"]');
    // Heading out
    check(L + ': Heading out starts with you leaving', (await page.$eval('.lh-away-who[data-name="Victoria"]', n => n.checked)) && !(await page.$eval('.lh-away-who[data-name="Ahmed"]', n => n.checked)));
    await page.fill('.lh-away-at', '2027-07-16T18:00'); await page.fill('.lh-away-nights', '2'); await page.selectOption('.lh-away-home', 'Our home'); await wait(80);
    check(L + ': the button counts the list: always + summer, Ahmed stays', /Make my list \(8 things\)/.test(await text(page, '.lh-away-go')), await text(page, '.lh-away-go'));
    await tap(page, '.lh-away-who[data-name="Ahmed"]');
    check(L + ': both leaving adds the empty-house items', /Make my list \(11 things\)/.test(await text(page, '.lh-away-go')));
    await tap(page, '.lh-away-go'); await wait(150);
    check(L + ': a Heading out list appears with 0 of 11', (await page.$$('.lh-away')).length === 1 && /0 of 11/.test(await text(page, '.lh-away .lh-progress')));
    await tap(page, '.lh-away .lh-item >> nth=0 >> .lh-box');
    check(L + ': a tick: 1 of 11, ticked by You', /1 of 11/.test(await text(page, '.lh-away .lh-progress')) && /ticked by You · 2027-07-09 21:00/.test(await text(page, '.lh-away .lh-item >> nth=0')));
    await tap(page, '.lh-away-del');
    check(L + ': Remove takes the list away', (await page.$$('.lh-away')).length === 0);
    check(L + ': every button at least 36 px; no sideways scroll; no errors', (await buttons(page)).every(x => x >= 35.5) && await noScroll(page) && errs.length === 0, errs.join(' | '));
    await page.close();

    console.log('\nbefore you head out ' + L);
    const tripEl = "React.createElement(TsLeaveHome,{trip:" + JSON.stringify(TRIP) + ",apiUrl:'x',apiToken:'y',who:'Ahmed',card:{padding:12,borderRadius:12,display:'flex',flexDirection:'column',gap:8},label:{fontSize:12,color:'#9aa8c8'}})";
    ({ page, errs } = await open(width, { data: { Itinerary: [['I1', KEY, 'flight', 'TP 204', '2027-07-10', '09:40', '', '', '', '']] } }, tripEl, '.lh-check'));
    check(L + ': on the trip: 0 of 16, why, and leaving 2 h before the flight', /Before you head out/.test(await text(page, '.ts-leavehome')) && /0 of 16/.test(await text(page, '.lh-progress'))
      && /Our home · July, so the summer items · 8 nights, so the 3\+ and 7\+ items · nobody stays home\. Leaving Sat 7:40 AM\./.test(await text(page, '.lh-why')) && (await page.$eval('.lh-leave', n => n.value)) === '2027-07-10T07:40');
    await tap(page, '.lh-item >> nth=1 >> .lh-box');
    const run = await page.evaluate(() => SHEETS['Leaving Home Runs'].rows[1] || []);
    check(L + ': a tick is shared: written with who and when', /1 of 16/.test(await text(page, '.lh-progress')) && /"by":"Ahmed","at":"2027-07-09 21:00"/.test(run[7] || ''), JSON.stringify(run));
    await page.fill('.lh-oneoff-input', 'Leave a key with Sam'); await tap(page, '.lh-oneoff-add');
    check(L + ': a one-off for this trip', /1 of 17/.test(await text(page, '.lh-progress')) && /Leave a key with Sam[\s\S]*This trip only/.test(await text(page, '.lh-check')));
    await tap(page, '.lh-oneoff-del');
    check(L + ': and × removes it', /1 of 16/.test(await text(page, '.lh-progress')));
    await tap(page, '.lh-leaving[data-v="Victoria"]');
    check(L + ': Victoria stays: the empty-house items drop out', /of 13/.test(await text(page, '.lh-progress')) && /someone stays home/.test(await text(page, '.lh-why')), await text(page, '.lh-progress'));
    await page.fill('.lh-leave', '2027-07-10T06:30'); await tap(page, '.lh-leave-save');
    check(L + ': a new leave time is saved', /Leaving Sat 6:30 AM/.test(await text(page, '.lh-why')) && (await page.evaluate(() => POSTS.slice(-1)[0].leaveAt)) === '2027-07-10T06:30');
    check(L + ': every button at least 36 px; no sideways scroll; no errors', (await buttons(page)).every(x => x >= 35.5) && await noScroll(page) && errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
