// Savings › Resell (Resell.js, webGetResellList_ / webUpdateResellItem_, ResellListView). Pins:
//  - listing stamps Listed Date; selling stamps Sold Date and the price (else the asking price);
//    a lower asking price on a listed item stamps Dropped On; back to To list clears them all;
//    the four columns are added and named on a tab made before them; dates come back yyyy-MM-dd;
//  - the nudge: listed 14+ days with no price drop in that time;
//  - the screen: counters, three columns in order, List it → / Sold… →, days listed, drop the
//    price, sold against what you paid, the edit sheet, add, Donated folded. Invented items.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RS = read('Resell.js'), WEB = read('WebApp.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = isoOf(new Date()), ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d); };
const HDR = ['ID', 'Item', 'Category', 'Asking Price', 'Original Price', 'Platform', 'Priority', 'Status', 'Notes', 'Added Date'];
function sheetOf(rows) {
  let cols = rows[0].length; const pad = r => { while (r.length < cols) r.push(''); return r; }; rows.forEach(pad);
  return { rows, getLastRow: () => rows.length, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; rows.forEach(pad); },
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }), getRange: (r, c) => ({ setValue: x => { rows[r - 1][c - 1] = x; } }) };
}
function ctx(sheet) {
  const c = { Date, Math, String, Number, JSON, parseInt, parseFloat, isNaN, Object, Utilities: { formatDate: d => isoOf(d) }, Session: { getScriptTimeZone: () => 'UTC' },
    CONFIG: { SHEET_ID: 'x' }, TABS: { RESELL_LIST: 'R' }, SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) } };
  vm.createContext(c); vm.runInContext(RS + '\n' + ['webGetResellList_', 'webUpdateResellItem_'].map(n => fnSrc(WEB, n)).join('\n'), c); return c;
}

console.log('\nthe dates');
{
  const sh = sheetOf([HDR.slice(), ['r1', 'Road bike', 'Sports', 400, 900, '', 'High', 'Unlisted', '', new Date(2026, 9, 1)], ['r2', 'Desk lamp', 'Other', 30, 60, 'eBay', 'Low', 'Unlisted', '', '2026-10-02']]);
  const c = ctx(sh), col = n => sh.rows[0].indexOf(n);
  let r = c.webUpdateResellItem_({ parameter: { id: 'r1', status: 'Listed', platform: 'Facebook Marketplace' } });
  check('listing stamps Listed Date, in new named columns', r.ok && J(sh.rows[0].slice(10)) === J(['Listed Date', 'Sold Price', 'Sold Date', 'Dropped On']) && sh.rows[1][col('Listed Date')] === TODAY && sh.rows[1][col('Status')] === 'Listed', J(sh.rows[1]));
  c.webUpdateResellItem_({ parameter: { id: 'r1', askingPrice: '350' } });
  check('a lower price on a listed item stamps Dropped On', sh.rows[1][col('Dropped On')] === TODAY && sh.rows[1][col('Asking Price')] === 350);
  sh.rows[1][col('Dropped On')] = '';
  c.webUpdateResellItem_({ parameter: { id: 'r1', askingPrice: '380' } });
  check('…a higher one doesn’t', sh.rows[1][col('Dropped On')] === '');
  c.webUpdateResellItem_({ parameter: { id: 'r1', status: 'Sold', soldPrice: '$340' } });
  check('selling stamps Sold Date and the price it went for', sh.rows[1][col('Sold Date')] === TODAY && sh.rows[1][col('Sold Price')] === 340);
  c.webUpdateResellItem_({ parameter: { id: 'r2', status: 'Listed' } });
  c.webUpdateResellItem_({ parameter: { id: 'r2', status: 'Sold' } });
  check('…no price given: the asking price', sh.rows[2][col('Sold Price')] === 30);
  c.webUpdateResellItem_({ parameter: { id: 'r2', status: 'Unlisted' } });
  check('back to To list clears them', ['Listed Date', 'Sold Price', 'Sold Date', 'Dropped On'].every(n => sh.rows[2][col(n)] === ''), J(sh.rows[2]));
  const got = c.webGetResellList_().items;
  check('the read sends dates as yyyy-MM-dd', got[0]['Added Date'] === '2026-10-01' && got[0]['Sold Date'] === TODAY, J(got[0]));
}

console.log('\nthe nudge and the numbers');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array, parseFloat, Infinity }; vm.createContext(U);
vm.runInContext('var RS_NUDGE_=14;\n' + ['rsNum_', 'rsMoney_', 'rsDay_', 'rsAgo_', 'rsStage_', 'rsDays_', 'rsNudge_', 'rsColumns_', 'rsCounts_'].map(n => fnSrc(APP, n)).join('\n'), U);
const YEAR = new Date().getFullYear();
const ITEMS = [
  { ID: 'a', Item: 'Old monitor', 'Asking Price': 60, Priority: 'High', Status: 'Unlisted' }, { ID: 'b', Item: 'Stroller', Priority: 'Low', Status: 'Unlisted' }, { ID: 'c', Item: 'Bread maker', Priority: 'Medium', Status: 'Unlisted' },
  { ID: 'd', Item: 'Road bike', 'Asking Price': 400, 'Original Price': 900, Platform: 'Facebook Marketplace', Status: 'Listed', 'Listed Date': ago(34) },
  { ID: 'e', Item: 'Desk lamp', 'Asking Price': 30, Platform: 'eBay', Status: 'Listed', 'Listed Date': ago(6) },
  { ID: 'f', Item: 'Couch', 'Asking Price': 250, Status: 'Listed', 'Listed Date': ago(30), 'Dropped On': ago(5) },
  { ID: 'g', Item: 'Headphones', 'Asking Price': 150, 'Original Price': 180, 'Sold Price': 140, Status: 'Sold', 'Sold Date': YEAR + '-03-02' },
  { ID: 'h', Item: 'Old phone', 'Asking Price': 90, Status: 'Sold', 'Sold Date': (YEAR - 1) + '-12-30' },
  { ID: 'i', Item: 'Kids books', Status: 'Donated' }];
const NOW = new Date();
check('the nudge: listed 14+ days, no drop since', U.rsNudge_(ITEMS[3], NOW) && !U.rsNudge_(ITEMS[4], NOW) && !U.rsNudge_(ITEMS[5], NOW) && !U.rsNudge_(ITEMS[0], NOW));
check('…a drop 14+ days ago nudges again', U.rsNudge_(Object.assign({}, ITEMS[5], { 'Dropped On': ago(15) }), NOW));
const cols = U.rsColumns_(ITEMS);
check('columns: To list by priority, Listed oldest first, Sold newest first', J(['tolist', 'listed', 'sold', 'donated'].map(k => cols[k].map(i => i.ID).join(''))) === J(['acb', 'dfe', 'gh', 'i']));
check('counters: listed value, sold this year, listed 14 d+', J(U.rsCounts_(ITEMS, NOW)) === J({ listedValue: 680, soldYear: 140, stale: 1 }));

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screen: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of [390, 1280]) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ items }) => {
      window.__ev = []; window.confirm = () => true;
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'get_resell_list') return Promise.resolve({ ok: true, items: JSON.parse(JSON.stringify(items)) });
        if (p.action === 'add_resell_item') return Promise.resolve({ ok: true, item: { ID: 'new', Item: p.item, Status: 'Unlisted', Priority: p.priority, 'Asking Price': p.askingPrice } }); return Promise.resolve({ ok: true }); };
      document.body.innerHTML = '<div id="rs" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('rs')).render(React.createElement(ResellListView, { apiUrl: 'u', apiToken: 't' }));
    }, { items: ITEMS });
    await page.waitForTimeout(250);
    const counts = await page.$$eval('#rs .rs-count', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
    check('counters', J(counts) === J(['$680 Listed value', '$140 Sold this year', '1 Listed 14 d+']), J(counts));
    check('three columns, in order, with counts', J(await page.$$eval('#rs .rs-col-h', ns => ns.map(n => n.textContent))) === J(['To list · 3', 'Listed · 3', 'Sold · 2']));
    check('…side by side on a computer, stacked on a phone', await page.evaluate(w => { const c = Array.from(document.querySelectorAll('#rs .rs-col')).map(n => n.getBoundingClientRect().top); return w > 900 ? c[0] === c[1] && c[1] === c[2] : c[0] < c[1] && c[1] < c[2]; }, width));
    const bike = await page.$eval('#rs .rs-card[data-resell="d"]', n => n.innerText);
    check('a listed card: days listed and the nudge', /34 d listed/.test(bike) && /Listed 34 d · drop the price\?/.test(bike) && !/drop the price/.test(await page.$eval('#rs .rs-card[data-resell="f"]', n => n.innerText)), bike);
    check('a sold card: what it went for against what you paid', /\$140 of \$180/.test(await page.$eval('#rs .rs-card[data-resell="g"]', n => n.innerText)) && /78% of what you paid/.test(await page.$eval('#rs .rs-card[data-resell="g"]', n => n.innerText)));
    await page.click('#rs .rs-card[data-resell="a"] .rs-list'); await page.waitForTimeout(60);
    check('List it → moves it on', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'update_resell_item', id: 'a', status: 'Listed' }) && !!(await page.$('#rs .rs-col[data-col="listed"] .rs-card[data-resell="a"]')));
    await page.click('#rs .rs-card[data-resell="e"] .rs-sell'); await page.fill('#rs .rs-sold-in', '25'); await page.click('#rs .rs-sold-save'); await page.waitForTimeout(60);
    check('Sold… asks the price, then moves it on', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'update_resell_item', id: 'e', status: 'Sold', soldPrice: '25' }) && /\$25/.test(await page.$eval('#rs .rs-col[data-col="sold"] .rs-card[data-resell="e"]', n => n.innerText)));
    await page.click('#rs .rs-card[data-resell="d"] .rs-nudge'); await page.fill('#rs .rs-ask-in', '340'); await page.click('#rs .rs-drop-save'); await page.waitForTimeout(60);
    check('drop the price: saves it and the nudge goes', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'update_resell_item', id: 'd', askingPrice: '340' }) && !/drop the price/.test(await page.$eval('#rs .rs-card[data-resell="d"]', n => n.innerText)));
    await page.click('#rs .rs-card[data-resell="b"] .rs-more'); await page.fill('.rs-in-ask', '120'); await page.selectOption('.rs-in-status', 'Donated'); await page.click('.rs-save'); await page.waitForTimeout(60);
    const ev = (await page.evaluate(() => window.__ev)).pop();
    check('⋯ edits, and Donated folds away', ev.action === 'update_resell_item' && ev.id === 'b' && ev.status === 'Donated' && ev.askingPrice === '120' && /Donated · 2 ▸/.test(await page.$eval('#rs', n => n.innerText)), J(ev));
    await page.click('#rs .rs-add'); await page.fill('.rs-in-item', 'Old printer'); await page.click('.rs-save'); await page.waitForTimeout(60);
    check('＋ Add an item goes to To list', (await page.evaluate(() => window.__ev)).pop().action === 'add_resell_item' && !!(await page.$('#rs .rs-col[data-col="tolist"] .rs-card[data-resell="new"]')));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
