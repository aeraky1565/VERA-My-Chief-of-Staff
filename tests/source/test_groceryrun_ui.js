// Log a grocery run on screen (issue #229): the GroceryRun block, shared verbatim by both dashboards,
// and where it's mounted (Finances › Groceries, Home, Today, Quick capture). Snap a receipt, review
// (store and date from the receipt, lines for the pantry, list tick-offs, who / card / total, the
// month), save, and the summary; a store with no list ("Not this one", "always count"); an unreadable
// receipt; and "just log the total". The real GroceryRun.js, Pantry.js and Groceries.js run in the
// page over in-memory sheets, with Claude stubbed. At 390 and 1280 px. Every value is invented.
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
const SRV = ['Pantry.js', 'Groceries.js', 'GroceryRun.js'].map(read).join('\n');
const PERISH = (read('OnHand.js').match(/var OH_PERISHABLE_\s*=[^\n]*\n/) || [''])[0];
const START = '// ---- GroceryRun (', END = '// ---- /GroceryRun ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
const H = n => (CODE.match(new RegExp('const ' + n + '\\s*=\\s*(\\[[^\\]]*\\])')) || [])[1];

console.log('\nthe source');
check('both dashboards carry the block, word for word', block(APP).length > 10000 && block(APP) === block(LITE));
check('Finances › Groceries: the button at the top of the card, refreshing it after', /h\(GroceryRunButton,\{apiUrl:props\.apiUrl,apiToken:props\.apiToken,who:props\.who\|\|'',variant:'wide',onDone:load\}\)/.test(APP) && /h\(GroceryRunButton,\{apiUrl:props\.apiUrl,apiToken:props\.apiToken,who:props\.who\|\|'',variant:'wide',onDone:load\}\)/.test(LITE)
  && /GroceriesCard,\{apiUrl:apiUrl,apiToken:apiToken,who:'Ahmed'\}/.test(APP) && /<GroceriesCard apiUrl=\{apiUrl\} apiToken=\{apiToken\} who="Victoria" \/>/.test(LITE));
check('Home (yours) and Today (Victoria’s): a quick action under the ARIA banner', /React\.createElement\(AriaBookBanner,\{apiUrl:apiUrl,apiToken:apiToken,onNavigate:onNavigate\}\),React\.createElement\(GroceryRunButton,\{apiUrl:apiUrl,apiToken:apiToken,who:'Ahmed',variant:'tile'\}\)/.test(APP)
  && /<AriaBookBanner apiUrl=\{apiUrl\} apiToken=\{apiToken\} onNavigate=\{onNavigate\} \/>\s+<GroceryRunButton apiUrl=\{apiUrl\} apiToken=\{apiToken\} who="Victoria" variant="tile" \/>/.test(LITE));
check('Life › Quick capture: a Receipt chip', /'File it'\)\),h\(GroceryRunButton,\{apiUrl:apiUrl,apiToken:apiToken,who:'Ahmed',variant:'chip'\}\)/.test(APP));
check('Done shopping is untouched on the Shopping tab', /className:'shop-done-btn'/.test(APP) && !/GroceryRunButton/.test(APP.slice(APP.indexOf('// ---- ShopList'), APP.indexOf('// ---- ShopList') + 40000)));

const RECEIPTS = {
  costco: { store: 'COSTCO WHOLESALE #12', date: '2026-11-07', total: 64.18, items: [
    { name: 'organic eggs', qty: 1, price: 7.49, food: true, match: 'Organic eggs' }, { name: 'baby spinach', price: 4.99, food: true, match: '' },
    { name: 'greek yogurt', price: 6.29, food: true, match: 'Greek yogurt' }, { name: 'paper towels', price: 22.99, food: false, match: '' },
    { name: 'sourdough loaf', price: 5.99, food: true, match: '' }] },
  corner: { store: 'Corner Market', date: '2026-11-08', total: 6.2, items: [{ name: 'milk', price: 3.1, food: true }, { name: 'bread', price: 3.1, food: true }] },
  bad: 'I cannot read this image.',
};
const server = which => `
var TODAY = '2026-11-08', NOW_TS = '2026-11-08T10:00:00Z';
window.VERA_TODAY = TODAY;
var HEAD = { 'Purchase History': ${H('PURCHASE_HISTORY_HEADERS')}, 'Grocery Runs': ${H('GROCERY_RUN_HEADERS')}, Config: ['Key', 'Value', 'Notes'], 'Credit Cards': ${H('CREDIT_CARD_HEADERS')}, 'Card Rewards': ${H('CARD_REWARD_HEADERS')} };
var DATA = { 'Purchase History': [], 'Grocery Runs': [['GR-OLD', '2026-11-02', 'Giant', 'Ahmed', 'Blue Cash', 400, 'typed', 'all', '', '', '']],
  Config: [['shop_grocery_stores', JSON.stringify({ Costco: true, "Trader Joe's": true, Giant: true }), '']],
  'Credit Cards': [['C1', 'Blue Cash', '', '', '', '', '', 'Ahmed', '', 'yes'], ['C2', 'Gold', '', '', '', '', '', 'Joint', '', 'yes']],
  'Card Rewards': [['R1', 'Blue Cash', 'Groceries', 6, '%', 'Supermarkets'], ['R2', 'Gold', 'Groceries', 4, 'x', '']] };
function mk(name) { var rows = [HEAD[name]].concat(DATA[name] || []); return { rows: rows, getLastRow: function() { return rows.length; },
  getRange: function(r, c, n, w) { n = n || 1; w = w || 1; return {
    getValues: function() { return rows.slice(r - 1, r - 1 + n).map(function(x) { var o = []; for (var i = 0; i < w; i++) o.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return o; }); },
    setValue: function(v) { rows[r - 1][c - 1] = v; },
    setValues: function(v) { v.forEach(function(row, i) { while (rows.length < r + i) rows.push([]); rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach(function(x, j) { rows[r - 1 + i][c - 1 + j] = x; }); }); } }; },
  appendRow: function(r) { rows.push(r.slice()); }, deleteRow: function(r) { rows.splice(r - 1, 1); } }; }
var SHEETS = {}; Object.keys(HEAD).forEach(function(n) { SHEETS[n] = mk(n); });
var TABS = { PURCHASE_HISTORY: 'Purchase History', GROCERY_RUNS: 'Grocery Runs', CONFIG: 'Config', CREDIT_CARDS: 'Credit Cards', CARD_REWARDS: 'Card Rewards' };
var PURCHASE_HISTORY_HEADERS = HEAD['Purchase History'], GROCERY_RUN_HEADERS = HEAD['Grocery Runs'], CREDIT_CARD_HEADERS = HEAD['Credit Cards'], CARD_REWARD_HEADERS = HEAD['Card Rewards'];
var _configCache_ = null;
function getConfigValues() { var o = {}; SHEETS.Config.rows.slice(1).forEach(function(r) { o[r[0]] = r[1]; }); return o; }
var LockService = { getScriptLock: function() { return { tryLock: function() { return true; }, waitLock: function() {}, releaseLock: function() {} }; } };
var Session = { getScriptTimeZone: function() { return 'UTC'; } }, Logger = { log: function() {} };
var UUID = 0;
var Utilities = { formatDate: function() { return TODAY; }, getUuid: function() { UUID++; return 'abcdef12-3456-7890-' + UUID; } };
function getSpreadsheet() { return { getSheetByName: function(n) { return SHEETS[n] || null; } }; }
function ensureSheet(ss, n) { return SHEETS[n] || (SHEETS[n] = mk(n)); }
function webGetBudget_() { return { ok: true, rows: [{ label: 'Groceries', value: 700 }] }; }
var LISTS = [{ tabId: 'T1', storeName: 'Costco', items: [{ index: 3, text: 'Organic eggs', done: false }, { index: 4, text: 'Coffee', done: false }] },
  { tabId: 'T2', storeName: "Trader Joe's", items: [{ index: 1, text: 'Greek yogurt', done: false }] }, { tabId: 'T3', storeName: 'Recipe', items: [] }];
function getShoppingList_() { return JSON.parse(JSON.stringify(LISTS)); }
window.TOGGLES = [];
function toggleShoppingItem_(tabId, idx) { TOGGLES.push(tabId + ':' + idx); return { ok: true }; }
var CLAUDE_API_URL = 'x', CLAUDE_MODEL = 'm'; function getApiKey() { return 'k'; }
var REPLY = ${JSON.stringify(typeof RECEIPTS[which] === 'string' ? RECEIPTS[which] : JSON.stringify(RECEIPTS[which]))};
window.CLAUDE = 0;
function fetchTracked_() { CLAUDE++; return { getResponseCode: function() { return 200; }, getContentText: function() { return JSON.stringify({ content: [{ text: REPLY }] }); } }; }
${PERISH}
${SRV}
function resizeImage(file) { return Promise.resolve({ base64: 'AAAA', mimeType: 'image/jpeg' }); }
function clone(r) { return JSON.parse(JSON.stringify(r)); }
var GETS = { gq_setup: webGqSetup_ }, POSTS = { gq_scan: webGqScan_, gq_log: webGqLog_ };
window.CALLS = [];
function wrap(f, a) { try { var r = clone(f(a)); return r.ok === false ? Promise.reject(new Error(r.error)) : Promise.resolve(r); } catch (e) { return Promise.reject(e); } }
function apiGet(u, t, p) { CALLS.push(p.action); return wrap(GETS[p.action], p); }
function apiPost(u, t, b) { CALLS.push(b.action); window.LAST = clone(b); return wrap(POSTS[b.action], clone(b)); }
`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.js': read('docs/react.min.js'), 'react-dom.js': read('docs/react-dom.min.js') };
  const shell = body => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0b1020;color:#dde1f0;font-family:sans-serif}</style>'
    + '<script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>' + body + '</script></body></html>';
  const open = async (width, which, variant, who) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const probe = server(which) + block(APP) + "\nReactDOM.createRoot(document.getElementById('root')).render(React.createElement(GroceryRunButton,{apiUrl:'x',apiToken:'y',who:" + JSON.stringify(who || 'Ahmed') + ",variant:" + JSON.stringify(variant || 'wide') + "}));";
    await page.route('**/*', r => { const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] }); return r.fulfill({ contentType: 'text/html', body: shell(probe) }); });
    await page.goto('http://probe.local/'); await page.waitForSelector('.gq-open', { timeout: 5000 }).catch(() => {}); await wait(100);
    return { page, errs };
  };
  const tap = async (page, sel) => { const el = await page.$(sel); if (el) await el.click(); await wait(200); return !!el; };
  const text = (page, sel) => page.$eval(sel, n => n.innerText).catch(() => '');
  const snap = async page => { await page.setInputFiles('.gq-file', { name: 'r.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 0]) }).catch(() => {}); await wait(350); };
  const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  const buttons = page => page.$$eval('button', ns => ns.filter(n => n.offsetParent).map(n => n.getBoundingClientRect().height));
  const sheet = (page, n) => page.evaluate(n => SHEETS[n].rows.slice(1), n);

  for (const width of [390, 1280]) {
    const L = '@' + width;
    console.log('\na Costco receipt ' + L);
    let { page, errs } = await open(width, 'costco');
    check(L + ': the button says what it does', /Log a grocery run/.test(await text(page, '.gq-open')));
    await tap(page, '.gq-open');
    check(L + ': it opens on Snap the receipt', /Snap the receipt/.test(await text(page, '.gq-snap')) && /The photo isn’t kept/.test(await text(page, '.gq-sheet')) && !!(await page.$('.gq-file[accept="image/*"][capture="environment"]')));
    await snap(page);
    check(L + ': one read, then the review', (await page.evaluate(() => CLAUDE)) === 1 && !!(await page.$('.gq-lines')));
    check(L + ': store and date from the receipt', (await page.$eval('.gq-store', n => n.value).catch(() => '')) === 'Costco' && (await page.$eval('.gq-date', n => n.value)) === '2026-11-07' && /Not today/.test(await text(page, '.gq-date-note')));
    check(L + ': the lines; non-food starts off', (await page.$$('.gq-line')).length === 5 && (await page.$$eval('.gq-pick', ns => ns.map(n => n.checked ? 1 : 0).join(''))) === '11101');
    check(L + ': list matches say which list, ticked by default', (await page.$$eval('.gq-tickrow', ns => ns.map(n => n.innerText).join('|'))) === 'On your Costco list: tick it off|On your Trader Joe\'s list: tick it off' && (await page.$$eval('.gq-tick', ns => ns.every(n => n.checked))));
    check(L + ': who is you; the best grocery card, with why', (await page.$eval('.gq-who', n => n.value)) === 'Ahmed' && /You/.test(await text(page, '.gq-who')) && (await page.$eval('.gq-card', n => n.value)) === 'Blue Cash' && /6% back at supermarkets/.test(await text(page, '.gq-why')));
    check(L + ': the total with tax, the lines’ sum, the month', (await page.$eval('.gq-total', n => n.value)) === '64.18' && /The lines add up to \$47\.75; the rest is tax/.test(await text(page, '.gq-sum-lines')) && /\$464 of \$700 with this/.test(await text(page, '.gq-month')) && !(await page.$('.gq-count')), await text(page, '.gq-sum-lines'));
    check(L + ': the save button says it all', (await text(page, '.gq-save')) === 'Add 4 to Pantry · log $64.18');
    await page.click('.gq-line[data-i="2"] .gq-tick'); await wait(80);
    await page.click('.gq-line[data-i="4"] .gq-pick'); await wait(80);
    await page.selectOption('.gq-card', 'Gold');
    check(L + ': unpicking a line updates the button', (await text(page, '.gq-save')) === 'Add 3 to Pantry · log $64.18');
    await tap(page, '.gq-save'); await wait(200);
    const ph = await sheet(page, 'Purchase History');
    check(L + ': the pantry: 3 rows on the receipt’s date, at Costco', ph.length === 3 && ph.every(r => r[4] === '2026-11-07' && r[7] === 'Costco' && r[9] === 'receipt') && ph.map(r => r[1]).join() === 'Organic eggs,baby spinach,Greek yogurt', JSON.stringify(ph.map(r => r[1])));
    check(L + ': only the ticked list item came off', (await page.evaluate(() => TOGGLES.join())) === 'T1:3');
    const runs = await sheet(page, 'Grocery Runs');
    check(L + ': the run: that date, Costco, you, Gold, $64.18, from the receipt', runs.length === 2 && runs[1][1] === '2026-11-07' && runs[1][2] === 'Costco' && runs[1][3] === 'Ahmed' && runs[1][4] === 'Gold' && runs[1][5] === 64.18 && runs[1][6] === 'receipt', JSON.stringify(runs[1]));
    const sum = await text(page, '.gq-saved');
    check(L + ': the summary', /Costco run logged/.test(sum) && /3 items in the pantry, 2 use soon \(baby spinach, Greek yogurt\)/.test(sum) && /Ticked off: Organic eggs \(Costco\)/.test(sum) && /\$64\.18 to groceries on Gold, 2026-11-07, by Ahmed/.test(sum) && /2 left out of the pantry/.test(sum), sum);
    check(L + ': every button at least 36 px; no sideways scroll; no errors', (await buttons(page)).every(x => x >= 35.5) && await noScroll(page) && errs.length === 0, errs.join(' | ') + JSON.stringify((await buttons(page)).filter(x => x < 35.5)));
    await tap(page, '.gq-done');
    check(L + ': Done closes it', !(await page.$('.gq-overlay')));
    await page.close();

    console.log('\na store with no list ' + L);
    ({ page, errs } = await open(width, 'corner', 'tile', 'Victoria'));
    check(L + ': the Today tile', /Log a grocery run/.test(await text(page, '.gq-open-tile')));
    await tap(page, '.gq-open'); await snap(page);
    check(L + ': the store kept as printed, editable; asked whether it counts', (await page.$eval('.gq-store-text', n => n.value).catch(() => '')) === 'Corner Market' && /Corner Market isn’t one of your grocery stores/.test(await text(page, '.gq-count'))
      && (await page.$eval('.gq-counted[aria-pressed="true"]', n => n.dataset.v)) === 'food' && (await page.$eval('.gq-who', n => n.value)) === 'Victoria');
    await tap(page, '.gq-counted[data-v="none"]');
    check(L + ': Not this one: no total asked, the pantry still gets the food', !(await page.$('.gq-total')) && (await text(page, '.gq-save')) === 'Add 2 to Pantry' && /The pantry still gets what you picked/.test(await text(page, '.gq-run')));
    await tap(page, '.gq-save'); await wait(200);
    check(L + ': saved: food in the pantry, no run', (await sheet(page, 'Purchase History')).length === 2 && (await sheet(page, 'Grocery Runs')).length === 1 && /2 items in the pantry/.test(await text(page, '.gq-saved')));
    await page.close();
    ({ page, errs } = await open(width, 'corner', 'chip'));
    check(L + ': the Quick capture chip', (await text(page, '.gq-open-chip')) === 'Receipt');
    await tap(page, '.gq-open'); await snap(page);
    await tap(page, '.gq-counted[data-v="all"]'); await tap(page, '.gq-always');
    await tap(page, '.gq-save'); await wait(200);
    const cfg = await page.evaluate(() => getConfigValues().shop_grocery_stores);
    check(L + ': always count it: Corner Market is a grocery store now; the run counts all', /"Corner Market":true/.test(cfg) && (await sheet(page, 'Grocery Runs'))[1][7] === 'all' && (await sheet(page, 'Grocery Runs'))[1][5] === 6.2);
    check(L + ': no errors', errs.length === 0, errs.join(' | '));
    await page.close();

    console.log('\nunreadable, and just the total ' + L);
    ({ page, errs } = await open(width, 'bad'));
    await tap(page, '.gq-open'); await snap(page);
    check(L + ': unreadable: says so, offers a retake and the total', /Couldn’t read that receipt/.test(await text(page, '.gq-err')) && /Retake the photo/.test(await text(page, '.gq-snap')) && !!(await page.$('.gq-total-only')));
    await tap(page, '.gq-total-only'); await wait(150);
    check(L + ': just the total: pick a store, no lines', !!(await page.$('.gq-store')) && !(await page.$('.gq-lines')) && (await page.$eval('.gq-date', n => n.value)) === '2026-11-08');
    await page.selectOption('.gq-store', 'Giant'); await wait(150);
    await tap(page, '.gq-save');
    check(L + ': no total: says so', /Enter the total paid/.test(await text(page, '.gq-err')));
    await page.fill('.gq-total', '41.20'); await tap(page, '.gq-save'); await wait(200);
    const runs2 = await sheet(page, 'Grocery Runs');
    check(L + ': a typed run at Giant, today', runs2.length === 2 && runs2[1][2] === 'Giant' && runs2[1][5] === 41.2 && runs2[1][6] === 'typed' && runs2[1][1] === '2026-11-08' && (await sheet(page, 'Purchase History')).length === 0);
    check(L + ': no sideways scroll; no errors', await noScroll(page) && errs.length === 0, errs.join(' | '));
    await page.close();
    ({ page, errs } = await open(width, 'costco'));
    await tap(page, '.gq-open'); await tap(page, '.gq-close');
    check(L + ': × closes it without saving', !(await page.$('.gq-overlay')) && (await page.evaluate(() => CALLS.length)) === 0);
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
