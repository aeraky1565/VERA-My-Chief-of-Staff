// "Done shopping" receipts (Pantry.js readReceipt_, receiptClean_, receiptLog_; WebApp.js
// webReceiptScan_, webReceiptLog_): a photo becomes clean lines tied to the store's list,
// and the lines picked either fill in the price on today's check-off row or become a new
// Purchase History row. Over a fake sheet and a stubbed Claude; every item is invented.
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const PANTRY = fs.readFileSync(path.join(ROOT, 'Pantry.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const extract = (src, name) => { const at = src.indexOf('function ' + name + '('); if (at === -1) return ''; const end = src.indexOf('\n}\n', at) + 3; return src.slice(at, end); };
const constLine = (src, name) => { const m = src.match(new RegExp('const ' + name + '\\s*=\\s*\\[[^\\]]*\\];')); return m ? m[0].replace(/^const/, 'var') : ''; };
const varLine = (src, name) => { const m = src.match(new RegExp('var ' + name + '\\s*=[^\\n]*\\n')); return m ? m[0] : ''; };

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

const TODAY = '2026-10-26';
const S = vm.createContext({ console, Math, JSON, Date, Object, String, Number, Array, isNaN, isFinite, parseInt,
  Logger: { log() {} }, Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: { formatDate: d => (d instanceof Date && !isNaN(d) ? (Math.abs(Date.now() - d.getTime()) < 5000 ? TODAY : d.toISOString().slice(0, 10)) : '') },
});
S.locks = 0; S.lockFree = true;
S.LockService = { getScriptLock: () => ({ tryLock: () => { if (!S.lockFree) return false; S.locks++; return true; }, releaseLock: () => { S.locks--; } }) };
vm.runInContext(constLine(CODE, 'PURCHASE_HISTORY_HEADERS') + varLine(PANTRY, 'RECEIPT_MAX_B64_') + varLine(PANTRY, 'RECEIPT_MIMES_'), S);
['normalizeItemName_', 'getPurchaseHistorySheet_', 'logPurchaseItems_', 'readReceipt_', 'receiptClean_', 'receiptLog_'].forEach(n => vm.runInContext(extract(PANTRY, n), S));
['shopStoreOf_', 'webReceiptScan_', 'webReceiptLog_'].forEach(n => vm.runInContext(extract(WEB, n), S));
S.TABS = { PURCHASE_HISTORY: 'Purchase History' };
S.CLAUDE_API_URL = 'https://claude.test/v1/messages'; S.CLAUDE_MODEL = 'model-x';
S.getApiKey = () => 'k';
const H = ['ID', 'Item', 'Normalized', 'Category', 'Date', 'Quantity', 'Unit', 'Store', 'Price', 'Source', 'Notes'];
const run = code => vm.runInContext(code, S);

console.log('\ncleaning what the model wrote');
S.LIST = ['Bananas', 'Greek yogurt', 'milk'];
let c = run('receiptClean_(' + JSON.stringify('```json\n[{"name":"organic bananas","qty":"1","price":"1.79","food":true,"match":"Bananas"},{"name":"paper towels","qty":null,"price":21.99,"food":false,"match":""}]\n```') + ', LIST)');
check('fences come off; numbers read as numbers; a match keeps the list\'s own spelling', c.length === 2 && c[0].match === 'Bananas' && c[0].price === 1.79 && c[0].qty === 1 && c[1].food === false && c[1].qty === null, JSON.stringify(c));
c = run('receiptClean_(' + JSON.stringify('[{"name":"spinach","price":3,"match":"SPINACH (BAG)"},{"name":"greek yogurt","price":5.49,"match":"greek YOGURT"}]') + ', LIST)');
check('a match not on the list is dropped; case doesn\'t matter for a real one', c[0].match === '' && c[1].match === 'Greek yogurt', JSON.stringify(c));
c = run('receiptClean_(' + JSON.stringify('Here you go:\n[{"name":"rice","price":"$12.99"}]\nThanks') + ', LIST)');
check('an array inside chatter is still found; "$12.99" is 12.99; food defaults to yes', c.length === 1 && c[0].price === 12.99 && c[0].food === true && c[0].match === '', JSON.stringify(c));
check('nonsense, an object, blank names and a missing price give clean results', run('receiptClean_("no idea", LIST).length') === 0 && run('receiptClean_("{\\"a\\":1}", LIST).length') === 0
  && run('receiptClean_(\'[{"name":"  "},{"name":"tea","price":"n/a"}]\', LIST)').length === 1 && run('receiptClean_(\'[{"name":"tea","price":"n/a"}]\', LIST)[0].price') === null);

console.log('\nreading a photo');
S.sent = null;
S.fetchTracked_ = (src, url, opts) => { S.sent = JSON.parse(opts.payload); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ text: '[{"name":"bananas","qty":1,"price":1.79,"food":true,"match":"Bananas"}]' }] }) }; };
const lines = run('readReceipt_("QUJD", "image/jpeg", LIST)');
const msg = S.sent && S.sent.messages[0].content;
check('the photo and the store\'s list go to Claude; the lines come back clean', lines.length === 1 && lines[0].match === 'Bananas'
  && msg[0].type === 'image' && msg[0].source.media_type === 'image/jpeg' && msg[0].source.data === 'QUJD' && /MY LIST: \["Bananas","Greek yogurt","milk"\]/.test(msg[1].text) && S.sent.model === 'model-x', JSON.stringify(S.sent).slice(0, 300));
const err = code => { try { run(code); return ''; } catch (e) { return e.message; } };
check('no photo, a file that isn\'t one, or a huge one is refused before calling out', /No photo/.test(err('readReceipt_("", "image/jpeg", [])')) && /isn’t a photo/.test(err('readReceipt_("QUJD", "application/pdf", [])'))
  && /too large/.test(err('readReceipt_(new Array(RECEIPT_MAX_B64_ + 2).join("A"), "image/jpeg", [])')));
S.fetchTracked_ = () => ({ getResponseCode: () => 529, getContentText: () => '{}' });
check('a failed call says so', /Couldn’t read the receipt right now \(HTTP 529\)/.test(err('readReceipt_("QUJD", "image/png", [])')));

console.log('\nsaving the lines picked');
S.hist = fakeSheet([H.slice(),
  ['PH-1', 'Greek yogurt', 'greek yogurt', 'Other', TODAY, '', '', 'Store A', '', 'checkout', ''],
  ['PH-2', 'olive oil', 'olive oil', 'Other', TODAY, '', '', 'Store A', '', 'checkout', ''],
  ['PH-3', 'olive oil', 'olive oil', 'Other', '2026-10-19', '', '', 'Store A', '', 'checkout', ''],
  ['PH-4', 'milk', 'milk', 'Other', TODAY, '', '', 'Store B', '', 'checkout', ''],
  ['PH-5', 'eggs', 'eggs', 'Other', TODAY, '', '', 'Store A', '4.10', 'checkout', '']]);
S.getSpreadsheet = () => ({ getSheetByName: n => n === 'Purchase History' ? S.hist : null });
let r = run('receiptLog_("Store A", [{ name: "Greek yogurt", qty: 2, price: 5.49 }, { name: "olive oil", price: 12.99 }, { name: "blueberries", qty: 1, price: 4.99 }, { name: "milk", price: 3.2 }, { name: "eggs", price: 4.1 }, { name: "  ", price: 1 }])');
const row = id => S.hist.rows.find(x => x[0] === id);
check('a line checked off today at this store fills in that row: price and quantity, no new row', r.ok && r.filled === 2 && row('PH-1')[8] === 5.49 && row('PH-1')[5] === 2 && row('PH-2')[8] === 12.99, JSON.stringify(r));
check('…last week\'s row, another store\'s and an already-priced row are left alone', row('PH-3')[8] === '' && row('PH-4')[8] === '' && row('PH-5')[8] === '4.10');
const added = S.hist.rows.filter(x => x[9] === 'receipt');
check('everything else is a new receipt row dated today, with its price; blank lines are dropped', r.added === 3 && added.length === 3
  && added.some(x => x[2] === 'blueberries' && x[8] === 4.99 && x[5] === 1 && x[4] === TODAY && x[7] === 'Store A') && added.some(x => x[2] === 'milk' && x[7] === 'Store A') && added.some(x => x[2] === 'eggs'), JSON.stringify(added));
check('…under the lock, released after', S.locks === 0);
r = run('receiptLog_("Store A", [{ name: "Greek yogurt", price: 6 }])');
check('a second receipt line for the same item doesn\'t overwrite the price already filled in', r.filled === 0 && r.added === 1 && row('PH-1')[8] === 5.49);
check('🤖 markers come off before matching', run('receiptLog_("Store B", [{ name: "🤖 milk (est. ~Oct 30)", price: 3.2 }])').filled === 1 && row('PH-4')[8] === 3.2);
check('nothing usable picked: nothing written', run('receiptLog_("Store A", [{ name: "" }])').ok === false);
S.lockFree = false;
check('a busy lock says so', /busy/.test(err('receiptLog_("Store A", [{ name: "tea" }])')));
S.lockFree = true;

console.log('\nthe routes');
S.getShoppingList_ = () => [{ tabId: 't.a', storeName: 'Store A', items: [{ index: 0, text: 'Bananas', done: false }, { index: 1, text: '🤖 milk (est. ~Oct 30)', done: true }] }];
S.fetchTracked_ = (src, url, opts) => { S.sent = JSON.parse(opts.payload); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ text: '[]' }] }) }; };
r = run('webReceiptScan_({ tabId: "t.a", image: "QUJD", mime: "image/jpeg" })');
check('scan: the store\'s list goes along as shown, markers stripped', r.ok && r.store === 'Store A' && /MY LIST: \["Bananas","milk"\]/.test(S.sent.messages[0].content[1].text), S.sent.messages[0].content[1].text.slice(-60));
check('scan or save for a store that isn\'t there says so', /wasn’t found/.test(err('webReceiptScan_({ tabId: "nope", image: "QUJD", mime: "image/jpeg" })')) && /wasn’t found/.test(err('webReceiptLog_({ tabId: "nope", items: [{ name: "x" }] })')));
const n0 = S.hist.rows.length;
r = run('webReceiptLog_({ tabId: "t.a", items: [{ name: "pears", price: 2 }] })');
check('save: rows carry the store tab\'s name', r.ok && S.hist.rows.length === n0 + 1 && S.hist.rows[S.hist.rows.length - 1][7] === 'Store A');
check('save with nothing picked writes nothing', run('webReceiptLog_({ tabId: "t.a", items: [] })').ok === false && S.hist.rows.length === n0 + 1);
check('save with something that isn\'t a list is refused, not a crash', err('r2 = webReceiptLog_({ tabId: "t.a", items: "pears" })') === '' && S.r2.ok === false && /No items/.test(S.r2.error));
check('both are POST routes', /case 'receipt_scan':\s+return jsonOut_\(webReceiptScan_\(body\)\);/.test(WEB) && /case 'receipt_log':\s+return jsonOut_\(webReceiptLog_\(body\)\);/.test(WEB));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
