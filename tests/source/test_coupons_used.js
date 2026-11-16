// Coupons kept when used (Coupons.js, webGetCoupons_ / webMarkCouponUsed_, CouponsTab, the shopping chip). Pins:
//  - Mark as used keeps the row: Status Used, Used On today, Saved ("$5 off" saves 5; a % coupon
//    saves what you typed, or nothing); the two columns are added and named;
//  - get_coupons leaves used ones out (lite, Needs you) unless withUsed=1; savedThisYear totals them;
//  - the nightly purge keeps used coupons until they were used before last year; the morning
//    email's expiring coupons skip used ones;
//  - the screen: counters, the store / online chips, Mark as Used (asks for a % coupon, skippable),
//    the Used fold with what each saved; the shopping list shows "🎟 N coupons" for that store.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CODE = read('Code.js'), WEB = read('WebApp.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html'), CPN = read('Coupons.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = isoOf(new Date()), YEAR = +TODAY.slice(0, 4);
const HDR = ['ID', 'Store', 'Offer', 'Discount', 'Min Spend', 'Offer Code', 'Customer Code', 'Expires', 'Channel', 'Addressed To', 'Status', 'Added'];
function sheetOf(rows) {
  let cols = rows[0].length; const deleted = [];
  const pad = r => { while (r.length < cols) r.push(''); return r; }; rows.forEach(pad);
  return { rows, deleted, getLastRow: () => rows.length, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; rows.forEach(pad); },
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }), deleteRow: r => { deleted.push(rows[r - 1][0]); rows.splice(r - 1, 1); },
    getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
      setValue: x => { rows[r - 1][c - 1] = x; }, setValues: v => v.forEach((row, i) => row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; })) }) };
}
function ctx(sheet) {
  const c = { Date, Math, String, Number, JSON, parseInt, isNaN, Object, Logger: { log() {} }, Utilities: { formatDate: d => isoOf(d) }, Session: { getScriptTimeZone: () => 'UTC' },
    getConfigValues: () => ({}), CONFIG: { SHEET_ID: 'x' }, TABS: { COUPONS: 'Coupons' }, COUPON_HEADERS: HDR, SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) } };
  vm.createContext(c);
  vm.runInContext(CPN + '\n' + ['couponIso_', 'couponState_', 'couponKeepDays_', 'purgeExpiredCoupons_'].map(n => fnSrc(CODE, n)).join('\n') + '\n' + ['webGetCoupons_', 'webMarkCouponUsed_'].map(n => fnSrc(WEB, n)).join('\n'), c);
  return c;
}
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };

console.log('\nwhat a coupon saves');
{
  const c = ctx(sheetOf([HDR.slice()]));
  check('"$5 off" saves 5; "$10 off $50" saves 10; "5 dollars off" saves 5', c.cpnSaved_('$5 OFF') === 5 && c.cpnSaved_('$10 off $50') === 10 && c.cpnSaved_('5 dollars off') === 5 && c.cpnSaved_('$7.50') === 7.5);
  check('a % coupon or no amount saves nothing by itself', c.cpnSaved_('10% off') === null && c.cpnSaved_('20 percent off') === null && c.cpnSaved_('Free shipping') === null && c.cpnSaved_('') === null);
  check('% is spotted', c.cpnIsPercent_('10% OFF') && !c.cpnIsPercent_('$5 off'));
}

console.log('\nmark as used keeps it');
{
  const sh = sheetOf([HDR.slice(), ['C1', 'Kroger', '$5 off $40', '$5 OFF', 40, '', '', plus(6), 'Both', '', 'Active', ''], ['C2', 'Target', '10% off', '10%', '', 'HOME10', '', plus(2), 'Online', '', 'Active', ''],
    ['C3', 'Aldi', 'Free bag', '', '', '', '', '', '', '', 'Active', ''], ['C4', 'Kohls', 'old', '$9', '', '', '', '', '', '', 'Used', '', (YEAR - 1) + '-06-01', 9]]);
  const c = ctx(sh);
  let r; try { r = c.webMarkCouponUsed_({ parameter: { id: 'C1' } }); } catch (e) { r = { error: e.message }; }
  check('the row stays: Used, today, and what it saved, in named columns', r.ok && sh.rows.length === 5 && sh.rows[1][10] === 'Used' && sh.rows[0][12] === 'Used On' && sh.rows[0][13] === 'Saved' && sh.rows[1][12] === TODAY && sh.rows[1][13] === 5 && r.saved === 5, J(sh.rows[1]));
  r = c.webMarkCouponUsed_({ parameter: { id: 'C2', saved: '$12.40' } });
  check('a % coupon saves what you typed', sh.rows[2][13] === 12.4 && r.saved === 12.4);
  r = c.webMarkCouponUsed_({ parameter: { id: 'C3', saved: '' } });
  check('…or nothing when skipped', sh.rows[3][10] === 'Used' && sh.rows[3][13] === '' && r.saved === null);
  check('an unknown coupon is refused', c.webMarkCouponUsed_({ parameter: { id: 'nope' } }).ok === false);
  let g = c.webGetCoupons_({ parameter: {} });
  check('get_coupons leaves used ones out (lite, Needs you)…', g.coupons.length === 0 && g.savedThisYear === 17.4, J(g));
  g = c.webGetCoupons_({ parameter: { withUsed: '1' } });
  const byId = {}; g.coupons.forEach(x => { byId[x.ID] = x; });
  check('…and sends them for the full screen, with used, usedOn and saved', g.coupons.length === 4 && byId.C1.used && byId.C1.usedOn === TODAY && byId.C1.saved === 5 && byId.C3.saved === null && byId.C2.percent === true && byId.C1.expired === false, J(byId.C1));
}

console.log('\nthe nightly purge and the morning email');
{
  const sh = sheetOf([HDR.concat(['Used On', 'Saved']),
    ['U1', 'Kroger', '', '$5', '', '', '', plus(-30), '', '', 'Used', '', TODAY, 5],
    ['U2', 'Kroger', '', '$5', '', '', '', plus(-400), '', '', 'Used', '', (YEAR - 1) + '-03-01', 5],
    ['U3', 'Kroger', '', '$5', '', '', '', plus(-800), '', '', 'Used', '', (YEAR - 2) + '-12-31', 5],
    ['E1', 'Kohls', '', '$10', '', '', '', plus(-30), '', '', 'Active', '', '', '']]);
  const c = ctx(sh); c.purgeExpiredCoupons_();
  check('used this year and last year stay; used before that, and expired unused ones, go', J(sh.deleted.sort()) === J(['E1', 'U3']), J(sh.deleted));
  check('get_coupons keeps a used coupon past its expiry', ctx(sheetOf(sh.rows.map(r => r.slice()))).webGetCoupons_({ parameter: { withUsed: '1' } }).coupons.some(x => x.ID === 'U1'));
  check('the morning email skips used coupons', /if \(String\(r\[10\]\)\.trim\(\) === 'Used'\) return;/.test(CODE.slice(CODE.indexOf("sub_('coupons'"), CODE.indexOf("sub_('coupons'") + 900)));
  check('the expiry flags already skip them', /status === 'Used'\) return;/.test(fnSrc(CODE, 'checkExpiringCoupons_')));
}

console.log('\nthe screen’s numbers');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext(['cpExpired_', 'cpUsed_', 'cpDays_', 'cpOnline_', 'cpMoney_', 'cpPercent_', 'cpLive_', 'cpStores_', 'cpCounts_', 'cpForStore_'].map(n => fnSrc(APP, n)).join('\n'), U);
const COUPONS = [
  { ID: 'C1', Store: 'Costco', Offer: '$5 off detergent', Discount: '$5 OFF', Channel: 'In-Store', Expires: plus(6), expired: false, daysLeft: 6 },
  { ID: 'C2', Store: 'Target', Offer: '10% off home goods', Discount: '10% OFF', 'Offer Code': 'HOME10', Channel: 'Online', Expires: plus(2), expired: false, daysLeft: 2, percent: true },
  { ID: 'C3', Store: 'Target', Offer: '$10 off $50', Discount: '$10 OFF', Expires: plus(20), expired: false, daysLeft: 20 },
  { ID: 'C4', Store: 'Costco', Offer: 'old', Expires: plus(-2), expired: true, daysLeft: -2, removeOn: plus(5) },
  { ID: 'C5', Store: 'Kroger', Offer: 'Free bag', Expires: '', expired: false, daysLeft: null },
  { ID: 'U1', Store: 'Kroger', Discount: '$5 OFF', used: true, usedOn: YEAR + '-02-03', saved: 5, Expires: plus(-60) },
  { ID: 'U2', Store: 'Target', Discount: '20%', used: true, usedOn: YEAR + '-10-01', saved: 12.4 },
  { ID: 'U3', Store: 'Target', Discount: '$3', used: true, usedOn: (YEAR - 1) + '-10-01', saved: 3 }];
const NOW = new Date();
check('live: not used, not expired, soonest first, no date last', J(U.cpLive_(COUPONS, 'all').map(c => c.ID)) === J(['C2', 'C1', 'C3', 'C5']));
check('a store chip, and Online', J(U.cpLive_(COUPONS, 's:target').map(c => c.ID)) === J(['C2', 'C3']) && J(U.cpLive_(COUPONS, 'online').map(c => c.ID)) === J(['C2']));
check('store chips, most first', J(U.cpStores_(COUPONS)) === J([{ store: 'Target', n: 2 }, { store: 'Costco', n: 1 }, { store: 'Kroger', n: 1 }]));
const k = U.cpCounts_(COUPONS, NOW);
check('counters: expire this week, live, saved this year (this year’s used only)', k.week === 2 && k.live === 4 && k.saved === 17.4 && J(k.used.map(c => c.ID)) === J(['U2', 'U1']), J([k.week, k.live, k.saved]));
check('a shopping list’s coupons: the store, either way round, live only', U.cpForStore_(COUPONS, 'Target') === 2 && U.cpForStore_(COUPONS, 'costco wholesale') === 1 && U.cpForStore_(COUPONS, 'Walmart') === 0);
const blk = s => { const a = s.indexOf('// ---- ShopList (Shopping tab)'), b = s.indexOf('// ---- /ShopList ----'); return a === -1 || b === -1 ? '' : s.slice(a, b); };
check('the shopping chip is in the shared ShopList, the same in both dashboards', blk(APP).length > 1000 && blk(APP) === blk(LITE) && /className:'shop-coupons'/.test(blk(APP)));
check('the full dashboard asks for used ones; lite doesn’t', /\{action:'get_coupons',withUsed:'1'\}/.test(APP) && !/withUsed/.test(LITE));

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
    await page.evaluate(({ coupons }) => {
      window.__ev = []; window.confirm = () => true;
      document.body.innerHTML = '<div id="cp" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('cp')).render(React.createElement(CouponsTab, { coupons, loading: false, busy: false, onExtract() {}, onSave() {}, onDelete: id => window.__ev.push(['del', id]), onMarkUsed: (id, s) => window.__ev.push(['used', id, s === undefined ? null : s]) }));
    }, { coupons: COUPONS });
    await page.waitForTimeout(250);
    const counts = await page.$$eval('#cp .cp-count', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
    check('counters: expire this week, live, saved this year', J(counts) === J(['2 Expire this week', '4 Live', '$17.40 Saved this year']), J(counts));
    check('chips: All, stores, Online', J(await page.$$eval('#cp .cp-chip', ns => ns.map(n => n.textContent))) === J(['All', 'Target · 2', 'Costco · 1', 'Kroger · 1', 'Online · 1']));
    check('live cards, soonest first', J(await page.$$eval('#cp .cp-card', ns => ns.map(n => n.dataset.coupon))) === J(['C2', 'C1', 'C3', 'C5']));
    await page.click('#cp .cp-chip >> text=Target · 2'); await page.waitForTimeout(40);
    check('a store chip', J(await page.$$eval('#cp .cp-card', ns => ns.map(n => n.dataset.coupon))) === J(['C2', 'C3']));
    await page.click('#cp .cp-chip >> text=All');
    await page.click('#cp .cp-card[data-coupon="C1"] .cp-used');
    check('Mark as Used on a $ coupon: straight away', J((await page.evaluate(() => window.__ev)).pop()) === J(['used', 'C1', null]));
    await page.click('#cp .cp-card[data-coupon="C2"] .cp-used'); await page.waitForTimeout(40);
    check('…a % coupon asks how much it saved', /How much did it save\?/.test(await page.$eval('#cp .cp-card[data-coupon="C2"]', n => n.innerText)) && (await page.evaluate(() => window.__ev)).length === 1);
    await page.fill('#cp .cp-ask-in', '$12.40'); await page.click('#cp .cp-ask-save');
    check('…Save sends it', J((await page.evaluate(() => window.__ev)).pop()) === J(['used', 'C2', '12.40']));
    await page.click('#cp .cp-card[data-coupon="C2"] .cp-used'); await page.click('#cp .cp-ask-skip');
    check('…Skip sends nothing', J((await page.evaluate(() => window.__ev)).pop()) === J(['used', 'C2', '']));
    check('the Used fold, closed', /Used · 2 ▸/.test(await page.$eval('#cp', n => n.innerText)) && !(await page.$('#cp .cp-usedrow')));
    await page.click('#cp .cp-fold'); await page.waitForTimeout(40);
    const used = await page.$$eval('#cp .cp-usedrow', ns => ns.map(n => n.dataset.coupon + ':' + n.querySelector('.cp-saved').textContent));
    check('…opens to this year’s, newest first, with what each saved', J(used) === J(['U2:saved $12.40', 'U1:saved $5']), J(used));
    check('the Expired group is still there', !!(await page.$('#cp .cp-exp-toggle')));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    // the shopping list chip
    await page.evaluate(({ coupons }) => {
      document.body.innerHTML = '<div id="sh" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('sh')).render(React.createElement(ShoppingTab, { stores: [{ tabId: 't1', storeName: 'Target', items: [{ index: 0, text: 'Milk', done: false }] }, { tabId: 't2', storeName: 'Walmart', items: [] }], busy: false,
        onToggle() { return Promise.resolve(); }, couponsFor: s => cpForStore_(coupons, s), onOpenCoupons: s => window.__ev.push(['open', s]) }));
    }, { coupons: COUPONS });
    await page.waitForTimeout(150);
    check('a store with coupons: "🎟 2 coupons for Target"', (await page.$eval('#sh .shop-coupons', n => n.textContent)) === '🎟 2 coupons for Target');
    await page.click('#sh .shop-coupons');
    check('…opens Coupons on that store', J((await page.evaluate(() => window.__ev)).pop()) === J(['open', 'Target']));
    await page.click('#sh .shop-pill >> text=Walmart'); await page.waitForTimeout(40);
    check('…none for a store without', !(await page.$('#sh .shop-coupons')));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
