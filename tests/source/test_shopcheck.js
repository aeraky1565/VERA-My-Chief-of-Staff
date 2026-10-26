// A check-off is a purchase (Pantry.js shopCheckLog_, wired in WebApp.js
// webToggleShoppingItem_): ticking an item logs a Purchase History row dated today,
// unticking it the same day takes that row back out, and an untick on a later day leaves
// the history alone. Over a fake sheet and a fake Doc; every item and store is invented.
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const PANTRY = fs.readFileSync(path.join(ROOT, 'Pantry.js'), 'utf8');
const SHOP = fs.readFileSync(path.join(ROOT, 'Shopping.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const extract = (src, name) => { const at = src.indexOf('function ' + name + '('); if (at === -1) return ''; const end = src.indexOf('\n}\n', at) + 3; return src.slice(at, end); };
const constLine = (src, name) => { const m = src.match(new RegExp('const ' + name + '\\s*=\\s*\\[[^\\]]*\\];')); return m ? m[0].replace(/^const/, 'var') : ''; };

function fakeSheet(rows) {
  const sh = { rows };
  sh.getLastRow = () => sh.rows.length;
  sh.getRange = (r, c, nr, nc) => ({
    getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = sh.rows[r - 1 + i] || []; out.push(Array.from({ length: nc || 1 }, (x, j) => row[c - 1 + j] === undefined ? '' : row[c - 1 + j])); } return out; },
    setValues: v => { v.forEach((row, i) => { sh.rows[r - 1 + i] = row.slice(); }); },
  });
  sh.deleteRow = r => sh.rows.splice(r - 1, 1);
  return sh;
}

const TODAY = '2026-10-26';
const S = vm.createContext({ console, Math, JSON, Date, Object, String, Number, Array, isNaN, parseInt,
  Logger: { log() {} },
  Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: { formatDate: d => (d instanceof Date && !isNaN(d) ? (S.__fixedToday && Math.abs(Date.now() - d.getTime()) < 5000 ? S.__fixedToday : d.toISOString().slice(0, 10)) : '') },
});
S.__fixedToday = TODAY;
S.locks = 0; S.lockFree = true;
S.LockService = { getScriptLock: () => ({ tryLock: () => { if (!S.lockFree) return false; S.locks++; return true; }, releaseLock: () => { S.locks--; } }) };
vm.runInContext(constLine(CODE, 'PURCHASE_HISTORY_HEADERS'), S);
['normalizeItemName_', 'getPurchaseHistorySheet_', 'logPurchaseItems_', 'shopCheckLog_'].forEach(n => vm.runInContext(extract(PANTRY, n), S));
vm.runInContext(extract(SHOP, 'toggleShoppingItem_'), S);
vm.runInContext(extract(WEB, 'webToggleShoppingItem_'), S);
S.TABS = { PURCHASE_HISTORY: 'Purchase History' };
const H = ['ID', 'Item', 'Normalized', 'Category', 'Date', 'Quantity', 'Unit', 'Store', 'Price', 'Source', 'Notes'];
S.hist = fakeSheet([H.slice()]);
S.getSpreadsheet = () => ({ getSheetByName: n => n === 'Purchase History' ? S.hist : null });
const run = code => vm.runInContext(code, S);

console.log('\nlogging a check-off');
let r = run('shopCheckLog_("Store A", "🤖 milk (est. ~Oct 30)", true)');
check('a tick logs one row: today, the plain name, the store, from a check-off', r.logged === true && S.hist.rows.length === 2
  && S.hist.rows[1][1] === 'milk' && S.hist.rows[1][2] === 'milk' && S.hist.rows[1][4] === TODAY && S.hist.rows[1][7] === 'Store A' && S.hist.rows[1][9] === 'checkout', JSON.stringify(S.hist.rows[1]));
check('…under the lock, released after', S.locks === 0);
run('shopCheckLog_("Store B", "Milk", true)');
run('shopCheckLog_("Store A", "Bananas", true)');
check('another store and another item are their own rows', S.hist.rows.length === 4);

console.log('\ntaking it back');
S.hist.rows.splice(1, 0, ['PH-old', 'milk', 'milk', 'Other', '2026-10-19', '', '', 'Store A', '', 'checkout', '']);
S.hist.rows.push(['PH-rcpt', 'milk', 'milk', 'Other', TODAY, '', '', 'Store A', '3.49', 'receipt', '']);
r = run('shopCheckLog_("Store A", "🤖 milk (est. ~Oct 30)", false)');
const left = S.hist.rows.slice(1).map(x => x[0] + '/' + x[7] + '/' + x[9] + '/' + x[4]);
check('an untick the same day removes that check-off row', r.unlogged === true && !S.hist.rows.some(x => x[7] === 'Store A' && x[2] === 'milk' && x[9] === 'checkout' && x[4] === TODAY), JSON.stringify(left));
check('…and only that one: last week\'s milk, the other store\'s, a receipt row and the bananas stay', S.hist.rows.length === 5
  && S.hist.rows.some(x => x[0] === 'PH-old') && S.hist.rows.some(x => x[0] === 'PH-rcpt') && S.hist.rows.some(x => x[7] === 'Store B') && S.hist.rows.some(x => x[1] === 'Bananas'), JSON.stringify(left));
r = run('shopCheckLog_("Store A", "milk", false)');
check('an untick with nothing logged today changes nothing (last week\'s stays)', r.unlogged === false && S.hist.rows.length === 5);
S.hist.rows.push(['PH-d', 'eggs', 'eggs', 'Other', new Date(TODAY + 'T12:00:00Z'), '', '', 'Store A', '', 'checkout', '']);
S.__fixedToday = TODAY;
const before = S.hist.rows.length;
r = run('shopCheckLog_("Store A", "eggs", false)');
check('a date cell the sheet turned into a Date still counts as today', r.unlogged === true && S.hist.rows.length === before - 1);
check('a blank line logs nothing', run('shopCheckLog_("Store A", "  ", true)').logged === false && run('shopCheckLog_("Store A", "🤖  (est. ~Oct 30)", false)').unlogged === false);
S.lockFree = false;
let threw = ''; try { run('shopCheckLog_("Store A", "rice", true)'); } catch (e) { threw = e.message; }
check('a busy lock says so instead of writing', /busy/.test(threw) && !S.hist.rows.some(x => x[1] === 'rice'));
S.lockFree = true;

console.log('\nthe toggle route');
const docItems = [{ text: '🤖 olive oil (est. ~Nov 9)', strike: false }, { text: 'Lemons', strike: false }];
const tab = { getId: () => 't.a', getTitle: () => 'Store A', asDocumentTab: () => ({ getBody: () => ({ getChild: i => docItems[i] && {
  getType: () => 'LI', asListItem: () => ({ getText: () => docItems[i].text, editAsText: () => ({ isStrikethrough: () => docItems[i].strike, setStrikethrough: (a, b, v) => { docItems[i].strike = v; } }) }) } }) }) };
S.DocumentApp = { openById: () => ({ getTabs: () => [tab] }), ElementType: { LIST_ITEM: 'LI' } };
S.getShoppingDocId_ = () => 'doc';
S.makeEvent = (tabId, index) => ({ parameter: { tabId, index: String(index) } });
const n0 = S.hist.rows.length;
r = run('webToggleShoppingItem_(makeEvent("t.a", 0))');
check('ticking in the dashboard strikes it in the Doc and logs it, by the store tab\'s name', r.ok && r.done === true && docItems[0].strike === true && r.logged === true
  && S.hist.rows.length === n0 + 1 && S.hist.rows[S.hist.rows.length - 1][1] === 'olive oil' && S.hist.rows[S.hist.rows.length - 1][7] === 'Store A', JSON.stringify(r));
r = run('webToggleShoppingItem_(makeEvent("t.a", 0))');
check('unticking it takes the row back out', r.done === false && r.unlogged === true && S.hist.rows.length === n0, JSON.stringify(r));
S.getSpreadsheet = () => ({ getSheetByName: () => null });
try { r = run('webToggleShoppingItem_(makeEvent("t.a", 1))'); } catch (e) { r = { threw: e.message }; }
check('no history tab: the tick still lands, and the reason comes back', r.ok && docItems[1].strike === true && /Purchase History tab not found/.test(r.logError || ''), JSON.stringify(r));
check('Chat\'s "mark as bought" goes through the same route, so it logs too', /webToggleShoppingItem_\(makeFakeEvent_\(\{ tabId: tgtStore\.tabId, index: tgtItem\.index \}\)\)/.test(fs.readFileSync(path.join(ROOT, 'Chat.js'), 'utf8')));

console.log('\nthe dashboards');
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8'), LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
check('no Log Shopping Run button left in either (it would log everything twice)', !/Log Shopping Run|LogRunModal|log_purchase_run/.test(APP) && !/Log Shopping Run|LogRunModal|log_purchase_run/.test(LITE));
check('a history failure on a tick is shown, in both', /if\(r&&r\.logError\)setError\('Checked off, but not saved to Purchase History: '\+r\.logError\);/.test(APP)
  && /if \(r && r\.logError\) setError\('Checked off, but not saved to Purchase History: ' \+ r\.logError\);/.test(LITE));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
