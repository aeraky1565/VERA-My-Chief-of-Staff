// Log a grocery run from a receipt, no list needed (GroceryRun.js, issue #229): the store read off the
// receipt matched to your stores, the date (never future, not too old), the total with tax, lines
// matched against EVERY store's open list items (only real ones), the pantry rows on the receipt's
// date, ticking the matched items off whichever list they were on (and not twice), the run logged on
// that date, "always count" for a new store, "not this one", a total-only run, and the wiring.
// Over fake sheets and a stubbed Claude; every item is invented.
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = read('GroceryRun.js'), PANTRY = read('Pantry.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), ONHAND = read('OnHand.js'), GR = read('Groceries.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const extract = (src, name) => { const at = src.indexOf('function ' + name + '('); if (at === -1) return ''; const end = src.indexOf('\n}\n', at) + 3; return src.slice(at, end); };
const varLine = (src, name) => { const m = src.match(new RegExp('var ' + name + '\\s*=[^\\n]*\\n')); return m ? m[0] : ''; };
const constLine = (src, name) => { const m = src.match(new RegExp('const ' + name + '\\s*=\\s*\\[[^\\]]*\\];')); return m ? m[0].replace(/^const/, 'var') : ''; };

function fakeSheet(rows) {
  const sh = { rows };
  sh.getLastRow = () => sh.rows.length;
  sh.getRange = (r, c, nr, nc) => ({
    getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = sh.rows[r - 1 + i] || []; out.push(Array.from({ length: nc || 1 }, (x, j) => row[c - 1 + j] === undefined ? '' : row[c - 1 + j])); } return out; },
    setValues: v => { v.forEach((row, i) => { sh.rows[r - 1 + i] = row.slice(); }); },
    setValue: v => { sh.rows[r - 1][c - 1] = v; },
  });
  return sh;
}

const TODAY = '2026-11-08';
function ctx(o) {
  o = o || {};
  const H = ['ID', 'Item', 'Normalized', 'Category', 'Date', 'Quantity', 'Unit', 'Store', 'Price', 'Source', 'Notes'];
  const ph = fakeSheet([H].concat(o.ph || []));
  const S = vm.createContext({ console, Math, JSON, Date, Object, String, Number, Array, isNaN, isFinite, parseInt, Error,
    Logger: { log() {} }, Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: () => TODAY },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
  });
  vm.runInContext(PANTRY.match(/var PANTRY_AISLES_ = \[[\s\S]*?\]\];\n/)[0] + extract(PANTRY, 'pantryAisle_'), S);
  vm.runInContext(constLine(CODE, 'PURCHASE_HISTORY_HEADERS') + varLine(PANTRY, 'RECEIPT_MAX_B64_') + varLine(PANTRY, 'RECEIPT_MIMES_') + varLine(ONHAND, 'OH_PERISHABLE_') + varLine(GR, 'GR_NOT_STORES_'), S);
  ['normalizeItemName_', 'logPurchaseItems_', 'receiptClean_', 'receiptLog_'].forEach(n => vm.runInContext(extract(PANTRY, n), S));
  S.getPurchaseHistorySheet_ = () => ph;
  S.TABS = { PURCHASE_HISTORY: 'Purchase History' };
  S.CLAUDE_API_URL = 'https://claude.test/v1/messages'; S.CLAUDE_MODEL = 'model-x'; S.getApiKey = () => 'k';
  const lists = o.lists || [];
  S.getShoppingList_ = () => JSON.parse(J(lists));
  S.toggles = [];
  S.toggleShoppingItem_ = (tabId, idx) => { S.toggles.push(tabId + ':' + idx); const s = lists.filter(x => x.tabId === tabId)[0]; const i = s.items.filter(x => x.index === idx)[0]; i.done = !i.done; return { ok: true }; };
  S.runs = []; S.saved = [];
  S.webGrocerySetup_ = p => ({ ok: true, store: p.store, counts: /costco|giant/i.test(p.store) ? true : false, people: { Ahmed: { suggested: { card: 'Blue Cash' }, cards: ['Blue Cash'] } }, month: { spent: 400, budget: 700 } });
  S.webGroceryLog_ = b => { if (!(Number(b.run.total) > 0)) return { ok: false, error: 'Enter the total' }; S.runs.push(b.run); return { ok: true, run: Object.assign({ id: 'GR-1' }, b.run, { total: Number(b.run.total) }), month: 464 }; };
  S.webGroceryStoresSave_ = b => { S.saved.push(b.stores); return { ok: true }; };
  S.reply = o.reply || '{}';
  S.sent = null;
  S.fetchTracked_ = (src, url, opts) => { S.sent = JSON.parse(opts.payload); return { getResponseCode: () => o.code || 200, getContentText: () => J({ content: [{ text: S.reply }] }) }; };
  vm.runInContext(SRC, S);
  S.__ph = ph; S.__lists = lists;
  return S;
}
const LISTS = () => [
  { tabId: 'T1', storeName: 'Costco', items: [{ index: 3, text: 'Organic eggs', done: false }, { index: 4, text: 'Coffee', done: true }, { index: 5, text: '🤖 Spinach (est. $4)', done: false }] },
  { tabId: 'T2', storeName: "Trader Joe's", items: [{ index: 1, text: 'Greek yogurt', done: false }, { index: 2, text: 'Organic eggs', done: false }] },
  { tabId: 'T3', storeName: 'Recipe', items: [{ index: 0, text: 'Saffron', done: false }] },
];

console.log('\nreading the receipt (pure)');
{
  const S = ctx();
  check('the store on the receipt is one of yours', S.gqStoreMatch_('COSTCO WHOLESALE #1123', ['Costco', 'Giant']) === 'Costco' && S.gqStoreMatch_("trader joe's", ["Trader Joe's"]) === "Trader Joe's" && S.gqStoreMatch_('Corner Market', ['Costco']) === '');
  check('dates: ISO or US, never the future, no older than 60 days', S.gqDate_('2026-11-07', TODAY) === '2026-11-07' && S.gqDate_('11/7/26', TODAY) === '2026-11-07' && S.gqDate_('2026-11-09', TODAY) === '' && S.gqDate_('2026-08-01', TODAY) === '' && S.gqDate_('soon', TODAY) === '');
  const open = S.gqOpenItems_(LISTS(), ['recipe']);
  check('open items on every store’s list; done ones and non-stores left out; VERA’s markers off', J(open.map(o => o.store + ':' + o.text)) === J(['Costco:Organic eggs', 'Costco:Spinach', "Trader Joe's:Greek yogurt", "Trader Joe's:Organic eggs"]));
  const text = '```json\n' + J({ store: 'COSTCO #12', date: '2026-11-07', total: '$64.18', items: [
    { name: 'eggs organic', qty: 1, price: 7.49, food: true, match: 'organic eggs' }, { name: 'greek yogurt', price: 6.29, match: 'Greek yogurt' },
    { name: 'spinach', price: 4.99, match: 'Spinach' }, { name: 'paper towels', price: 22.99, food: false, match: 'Paper towels' }, { name: 'coffee', price: 9, match: 'Coffee' }] }) + '\n```';
  const r = S.gqClean_(text, open, ['Costco', "Trader Joe's"], TODAY);
  check('store, date and total with tax read', r.store === 'Costco' && r.knownStore && r.date === '2026-11-07' && r.readDate && r.total === 64.18);
  check('eggs are on two lists: the receipt’s store wins', r.items[0].onList === 'Costco' && r.items[0].tabId === 'T1' && r.items[0].index === 3);
  check('yogurt ticks off Trader Joe’s; spinach the Costco list', r.items[1].onList === "Trader Joe's" && r.items[1].index === 1 && r.items[2].onList === 'Costco' && r.items[2].index === 5);
  const tj = S.gqClean_(J({ store: "TRADER JOE'S #5", items: [{ name: 'eggs', match: 'Organic eggs' }] }), open, ['Costco', "Trader Joe's"], TODAY);
  check('at Trader Joe’s, the eggs come off the Trader Joe’s list', tj.items[0].tabId === 'T2' && tj.items[0].index === 2);
  check('a made-up or already-done match ticks nothing', r.items[3].match === '' && r.items[3].tabId === '' && r.items[4].match === '' && r.items[3].food === false);
  const r2 = S.gqClean_(J({ store: 'Corner Market', date: '2025-01-01', total: null, items: [{ name: 'milk', price: 3 }] }), open, ['Costco'], TODAY);
  check('an unknown store kept as printed; a stale date falls back to today', r2.store === 'Corner Market' && !r2.knownStore && r2.date === TODAY && !r2.readDate && r2.total === null);
  const r3 = S.gqClean_('[{"name":"tea","price":2}]', open, [], TODAY);
  check('a bare array still reads', r3.items.length === 1 && r3.store === '');
  check('the same list item is never matched twice', S.gqClean_(J({ items: [{ name: 'eggs', match: 'Organic eggs' }, { name: 'eggs', match: 'Organic eggs' }, { name: 'eggs', match: 'Organic eggs' }] }), open, [], TODAY).items.filter(i => i.tabId).length === 2);
}

console.log('\nscanning');
{
  const S = ctx({ lists: LISTS(), reply: J({ store: 'Costco', date: '2026-11-07', total: 20.77, items: [{ name: 'eggs', price: 7.49, match: 'Organic eggs' }, { name: 'bananas', price: 1.79 }] }) });
  const r = S.webGqScan_({ image: 'AAAA', mime: 'image/jpeg' });
  check('one Claude call with the photo and every store’s open items', S.sent.messages[0].content[0].source.data === 'AAAA' && /MY LISTS: \["Organic eggs","Spinach","Greek yogurt"\]/.test(S.sent.messages[0].content[1].text) && /including tax/.test(S.sent.messages[0].content[1].text));
  check('the result: store, date, total, lines, your stores, the run’s setup', r.ok && r.store === 'Costco' && r.date === '2026-11-07' && r.total === 20.77 && r.items.length === 2 && J(r.stores) === J(['Costco', "Trader Joe's"]) && r.setup.counts === true);
  S.grStoreSetting_ = () => ({ Giant: true, costco: true, Lidl: false });
  check('your stores: the list tabs, then grocery stores with no tab (not twice, not the ones switched off)', J(S.gqStoreNames_(LISTS())) === J(['Costco', "Trader Joe's", 'Giant']));
  const bad = ctx({ lists: LISTS(), reply: 'sorry' }).webGqScan_({ image: 'AAAA', mime: 'image/jpeg' });
  check('nothing readable: says so, with the way out', bad.ok === false && /just log the total/.test(bad.error));
  let threw = ''; try { ctx({ code: 529 }).webGqScan_({ image: 'A', mime: 'image/jpeg' }); } catch (e) { threw = e.message; }
  check('a failed call says why', /HTTP 529/.test(threw));
  threw = ''; try { ctx().webGqScan_({ image: 'A', mime: 'application/pdf' }); } catch (e) { threw = e.message; }
  check('not a photo is refused before any call', /isn’t a photo/.test(threw));
}

console.log('\nsaving');
{
  const S = ctx({ lists: LISTS(), ph: [['PH-2026-11-07-organic_eggs', 'Organic eggs', 'organic eggs', 'Dairy & Eggs', '2026-11-07', '', '', 'Costco', '', 'checkout', '']] });
  const r = S.webGqLog_({ store: 'Costco', date: '2026-11-07',
    items: [{ name: 'Organic eggs', qty: 1, price: 7.49, food: true }, { name: 'baby spinach', price: 4.99, food: true }, { name: 'sourdough bread', price: 5.99, food: true }],
    ticks: [{ tabId: 'T1', index: 5, item: 'Spinach' }, { tabId: 'T2', index: 1, item: 'Greek yogurt' }, { tabId: 'T1', index: 4, item: 'Coffee' }, { tabId: 'T1', index: 3, item: 'Something else' }],
    run: { who: 'Ahmed', card: 'Blue Cash', total: '64.18', counted: 'all', itemsTotal: 61.4 }, left: 1 });
  const rows = S.__ph.rows.slice(1);
  check('the pantry: on the receipt’s date, the eggs fill in that day’s check-off', r.ok && r.filled === 1 && r.added === 2 && rows[0][8] === 7.49 && rows.slice(1).every(x => x[4] === '2026-11-07' && x[9] === 'receipt' && x[7] === 'Costco'));
  check('use soon named', J(r.useSoon) === J(['baby spinach', 'sourdough bread']), J(r.useSoon));
  check('ticked off: only open items whose text still matches', J(S.toggles) === J(['T1:5', 'T2:1']) && J(r.ticked) === J([{ item: 'Spinach', store: 'Costco' }, { item: 'Greek yogurt', store: "Trader Joe's" }]));
  check('the run: on that date, from the receipt', S.runs.length === 1 && S.runs[0].date === '2026-11-07' && S.runs[0].source === 'receipt' && S.runs[0].counted === 'all' && S.runs[0].total === '64.18' && r.month === 464);
  check('the summary says all of it', r.summary.length === 4 && /3 items in the pantry, 2 use soon/.test(r.summary[0]) && /Ticked off: Spinach \(Costco\), Greek yogurt \(Trader Joe's\)/.test(r.summary[1]) && /\$64\.18 to groceries on Blue Cash, 2026-11-07, by Ahmed/.test(r.summary[2]) && /1 left out/.test(r.summary[3]), J(r.summary));
  S.webGqLog_({ store: 'Costco', items: [{ name: 'milk' }], ticks: [{ tabId: 'T1', index: 5, item: 'Spinach' }], run: { who: 'Ahmed', total: 3, counted: 'all' } });
  check('a tick already done isn’t undone', S.toggles.length === 2);

  const N = ctx({ lists: LISTS() });
  const n = N.webGqLog_({ store: 'Corner Market', date: '2026-11-08', items: [{ name: 'milk', price: 3, food: true }], run: { who: 'Victoria', total: 3.2, counted: 'food' }, always: true });
  check('a new store: “always count” saves it, the run counts the food', n.ok && J(N.saved) === J([{ 'Corner Market': true }]) && N.runs[0].counted === 'food' && N.runs[0].store === 'Corner Market');
  const x = ctx().webGqLog_({ store: 'Corner Market', items: [{ name: 'milk', price: 3, food: true }], run: { who: 'Ahmed', total: 3, counted: 'none' } });
  check('“not this one”: the pantry still gets the food, no run', x.ok && x.added === 1 && x.run === null);
  const t = ctx();
  const tr = t.webGqLog_({ store: 'Giant', items: [], run: { who: 'Ahmed', card: 'Gold', total: 41, counted: 'all' } });
  check('just the total: a typed run, nothing in the pantry', tr.ok && tr.added === 0 && t.runs[0].source === 'typed' && t.__ph.rows.length === 1);
  check('needs a store, something to save, who went', ctx().webGqLog_({ items: [{ name: 'milk' }] }).ok === false && ctx().webGqLog_({ store: 'Giant', items: [], run: { who: 'Ahmed', counted: 'all' } }).ok === false
    && ctx().webGqLog_({ store: 'Giant', items: [{ name: 'milk' }], run: { total: 3, counted: 'all' } }).ok === false);
  const f = ctx().webGqLog_({ store: 'Giant', date: '2027-01-01', items: [{ name: 'milk' }], run: { who: 'Ahmed', total: 3, counted: 'all' } });
  check('a future date is today', f.date === TODAY);
}

console.log('\nreceipt dates in the pantry');
{
  const S = ctx({ ph: [['X', 'Milk', 'milk', 'Dairy & Eggs', TODAY, '', '', 'Giant', '', 'checkout', '']] });
  S.receiptLog_('Giant', [{ name: 'milk', price: 3 }]);
  check('Done shopping unchanged: today’s check-off is filled in', S.__ph.rows[1][8] === 3 && S.__ph.rows.length === 2);
  const S2 = ctx({ ph: [['X', 'Milk', 'milk', 'Dairy & Eggs', TODAY, '', '', 'Giant', '', 'checkout', '']] });
  S2.receiptLog_('Giant', [{ name: 'milk', price: 3 }], '2026-11-07');
  check('a receipt from yesterday is a new row for yesterday, not today’s check-off', S2.__ph.rows[1][8] === '' && S2.__ph.rows[2][4] === '2026-11-07' && /^PH-2026-11-07-/.test(S2.__ph.rows[2][0]));
}

console.log('\nwiring');
{
  check('routes', /case 'gq_scan':\s+return jsonOut_\(webGqScan_\(body\)\)/.test(WEB) && /case 'gq_log':\s+return jsonOut_\(webGqLog_\(body\)\)/.test(WEB) && /case 'gq_setup':\s+return jsonOut_\(webGqSetup_\(e\.parameter\)\)/.test(WEB));
  check('Done shopping’s routes are untouched', /function webReceiptLog_\(body\)[\s\S]*?return receiptLog_\(s\.storeName, b\.items\.slice\(0, 100\)\);/.test(WEB));
  check('the photo isn’t kept', !/DriveApp|createFile/.test(SRC));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
