// Coupons: expired ones are scratched off for a grace week, then gone (Issue #173).
// Pins:
//  - couponIso_ reads a sheet Date, yyyy-MM-dd and a US M/D/YYYY (or M/D/YY); anything else is '';
//  - couponState_: expired the day after its date, removed `keep` days after it, today still live;
//  - coupon_keep_expired_days: default 7, kept within 0–60;
//  - get_coupons marks each coupon and leaves out the ones past the grace week;
//    the nightly purge deletes exactly those, and runs early in the night, not last;
//  - the Coupons tab, full and lite: an Expired group at the bottom, scratched off, copy off,
//    "Goes on …" and Delete now; full shows it open, lite closed; the group is the same code in both.
// Invented coupons.
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

function ctx(extra) {
  const c = Object.assign({ Date, Math, String, Number, JSON, parseInt, isNaN, Logger: { log() {} },
    Utilities: { formatDate: d => isoOf(d) }, Session: { getScriptTimeZone: () => 'America/New_York' },
    getConfigValues: () => ({}), CONFIG: { SHEET_ID: 'x' }, TABS: { COUPONS: 'Coupons' } }, extra || {});
  vm.createContext(c);
  vm.runInContext(CPN + '\n' + ['couponIso_', 'couponState_', 'couponKeepDays_', 'purgeExpiredCoupons_'].map(n => fnSrc(CODE, n)).join('\n') + '\n' + fnSrc(WEB, 'webGetCoupons_'), c);
  return c;
}
const C = ctx();

console.log('\nreading the Expires cell');
check('a sheet Date, yyyy-MM-dd, with a time, US M/D/YYYY and M/D/YY', C.couponIso_(new Date(2026, 10, 14), 'tz') === '2026-11-14' && C.couponIso_('2026-11-14') === '2026-11-14' && C.couponIso_('2026-11-14T00:00:00.000Z') === '2026-11-14'
  && C.couponIso_('11/14/2026') === '2026-11-14' && C.couponIso_('1/5/27') === '2027-01-05' && C.couponIso_(' 2026-3-9 ') === '2026-03-09');
check('anything else can’t be read', ['', null, undefined, 'whenever', 'Nov 14', '2/30/2026', '13/1/2026', '2026-13-01', new Date('x')].every(v => C.couponIso_(v, 'tz') === ''));

console.log('\nwhere a coupon stands (today Mon Nov 16, a 7-day grace week)');
const st = iso => C.couponState_(iso, '2026-11-16', 7);
check('expiring today is still live', st('2026-11-16').expired === false && st('2026-11-16').daysLeft === 0);
check('the day after, expired, kept, and it says when it goes', st('2026-11-15').expired && !st('2026-11-15').gone && st('2026-11-15').removeOn === '2026-11-22' && st('2026-11-15').daysLeft === -1);
check('six days past: still kept; seven: gone', !st('2026-11-10').gone && st('2026-11-09').gone);
check('across a month and a year end', C.couponState_('2026-12-30', '2027-01-02', 7).daysLeft === -3 && C.couponState_('2026-12-30', '2027-01-02', 7).removeOn === '2027-01-06');
check('no readable date: never expired, never removed', J(st('')) === J({ iso: '', daysLeft: null, expired: false, removeOn: '', gone: false }));
check('a grace of 0 removes it the day after', C.couponState_('2026-11-15', '2026-11-16', 0).gone && !C.couponState_('2026-11-16', '2026-11-16', 0).gone);
const keep = v => ctx({ getConfigValues: () => ({ coupon_keep_expired_days: v }) }).couponKeepDays_();
check('coupon_keep_expired_days: 7 by default, within 0–60', keep('') === 7 && keep(undefined) === 7 && keep('3') === 3 && keep('99') === 60 && keep('-2') === 0 && keep('x') === 7);

console.log('\nthe route and the nightly purge');
const today = new Date(); today.setHours(12, 0, 0, 0);
const plus = n => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
const HDR = ['ID', 'Store', 'Offer', 'Discount', 'Min Spend', 'Offer Code', 'Customer Code', 'Expires', 'Channel', 'Addressed To', 'Status', 'Added'];
const ROWS = () => [HDR,
  ['C1', 'Kroger', '$5 off $40', '$5 OFF', 40, '', '', plus(6), 'Both', '', 'Active', ''],
  ['C2', 'Kohls', '$10 off $50', '$10 OFF', 50, 'KC10', '', plus(-2), 'Online', '', 'Active', ''],
  ['C3', 'Costco', '$5 off detergent', '$5 OFF', '', '', '', plus(-9), 'In-Store', '', 'Active', ''],
  ['C4', 'Target', '10% off', '10%', '', '', '', isoOf(plus(-1)).replace(/^(\d+)-(\d+)-(\d+)$/, (m, y, mo, d) => +mo + '/' + +d + '/' + y), '', '', 'Active', ''],
  ['C5', 'Aldi', 'Free bag', '', '', '', '', '', '', '', 'Active', '']];
function sheetCtx(rows) {
  const deleted = [];
  const sheet = { getLastRow: () => rows.length, getDataRange: () => ({ getValues: () => rows }), deleteRow: r => { deleted.push(rows[r - 1][0]); rows.splice(r - 1, 1); } };
  const c = ctx({ SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) } });
  return { c, deleted };
}
let { c } = sheetCtx(ROWS());
const r = c.webGetCoupons_();
const byId = {}; r.coupons.forEach(x => { byId[x.ID] = x; });
check('a coupon past its grace week isn’t sent', !byId.C3 && r.coupons.length === 4, J(Object.keys(byId)));
check('each says whether it has expired, and when it goes', byId.C2.expired === true && byId.C2.daysLeft === -2 && byId.C2.removeOn === isoOf(plus(5)) && byId.C1.expired === false && byId.C1.daysLeft === 6);
check('a US date comes back as yyyy-MM-dd, and counts', byId.C4.Expires === isoOf(plus(-1)) && byId.C4.expired === true);
check('no date: not expired', byId.C5.expired === false && byId.C5.daysLeft === null && byId.C5.Expires === '');
check('…with today and the grace week', r.keepDays === 7 && r.today === isoOf(today));
const ps = sheetCtx(ROWS());
ps.c.purgeExpiredCoupons_();
check('the purge deletes the same ones the route leaves out, and only those', J(ps.deleted) === J(['C3']));
const p0 = (() => { const rows = ROWS(); const s = sheetCtx(rows); s.c.getConfigValues = () => ({ coupon_keep_expired_days: '0' }); s.c.purgeExpiredCoupons_(); return s.deleted.sort(); })();
check('…and follows the grace week setting (0: every expired one)', J(p0) === J(['C2', 'C3', 'C4']), J(p0));
const night = CODE.slice(CODE.indexOf('function nightlyRun('), CODE.indexOf('function nightlyRunTail('));
const at = n => night.indexOf("nightlyStep_(ctx, '" + n + "'");
check('the purge runs early in the night (after the important dates), not as its last step', at('purgeExpiredCoupons_') > at('checkImportantDates_') && at('purgeExpiredCoupons_') < at('resetChoresByCadence_') && at('checkExpiringCoupons_') < at('purgeExpiredCoupons_') && at('checkTaxDocuments_') > at('purgeExpiredCoupons_'));

console.log('\nthe Expired group, the same code in both dashboards');
const blk = s => { const a = s.indexOf('// ---- CpExpiredGroup'), b = s.indexOf('// ---- end CpExpiredGroup ----'); return a === -1 || b === -1 ? '' : s.slice(a, b); };
check('byte-identical in full and lite', blk(APP).length > 500 && blk(APP) === blk(LITE));
{
  const g = { Date, Math, String, isNaN }; vm.createContext(g); vm.runInContext(fnSrc(APP, 'cpExpired_') + fnSrc(APP, 'cpRemoveOn_'), g);
  check('the server’s word wins; without it, the date', g.cpExpired_({ expired: true }) && !g.cpExpired_({ expired: false, Expires: '2000-01-01' }) && g.cpExpired_({ Expires: '2000-01-01' }) && !g.cpExpired_({ Expires: '2999-01-01' }) && !g.cpExpired_({}));
  check('when it goes: the server’s date, else 7 days after expiry', g.cpRemoveOn_({ removeOn: '2026-11-21' }) === '2026-11-21' && g.cpRemoveOn_({ Expires: '2026-11-14' }) === '2026-11-21');
}

const COUPONS = [
  { ID: 'C1', Store: 'Kroger', Offer: '$5 off a $40 shop', Discount: '$5 OFF', Channel: 'Both', Expires: isoOf(plus(6)), expired: false, daysLeft: 6 },
  { ID: 'C2', Store: 'Target', Offer: '10% off home goods', Discount: '10% OFF', 'Offer Code': 'HOME10', Expires: isoOf(plus(2)), expired: false, daysLeft: 2 },
  { ID: 'C3', Store: 'Kohls', Offer: '$10 off $50', Discount: '$10 OFF', 'Offer Code': 'KC10NOV', Channel: 'Online', Expires: isoOf(plus(-2)), expired: true, daysLeft: -2, removeOn: isoOf(plus(5)) },
  { ID: 'C4', Store: 'Costco', Offer: '$5 off detergent', Expires: isoOf(plus(-4)), expired: true, daysLeft: -4, removeOn: isoOf(plus(3)) },
  { ID: 'C5', Store: 'Aldi', Offer: 'Free bag', Expires: '', expired: false, daysLeft: null }];
const nice = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the dashboards: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const vendor = { 'react.production.min.js': read('docs/react.min.js'), 'react-dom.production.min.js': read('docs/react-dom.min.js'), 'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8') };
  for (const file of ['index.html', 'dashboard-lite.html']) for (const width of (process.env.VERA_CTL_FAST ? [390] : [390, 1280])) {
    const L = (file === 'index.html' ? 'Full ' : 'Lite ') + width;
    console.log('\n' + L);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    if (file === 'index.html') await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    else {
      await page.route('**/*', route => { const url = route.request().url();
        if (url.startsWith('https://vera.test/dashboard-lite.html')) return route.fulfill({ contentType: 'text/html', body: LITE });
        for (const n of Object.keys(vendor)) if (url.includes(n)) return route.fulfill({ contentType: 'application/javascript', body: vendor[n] });
        return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' }); });
      await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => typeof CouponsLiteTab === 'function', null, { timeout: 20000 }).catch(() => {});
    }
    await page.evaluate(({ coupons, lite }) => {
      const root = document.getElementById('root'); if (root) root.style.display = 'none';
      window.__del = []; window.__gets = []; window.confirm = () => true;
      const host = document.createElement('div'); host.id = 'cp'; host.style.padding = '0 12px'; document.body.prepend(host);
      if (lite) {
        window.apiGet = (u, t, q) => { window.__gets.push(q); return Promise.resolve(q.action === 'get_coupons' ? { ok: true, coupons: JSON.parse(JSON.stringify(coupons)) } : { ok: true }); };
        ReactDOM.createRoot(host).render(React.createElement(CouponsLiteTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
      } else ReactDOM.createRoot(host).render(React.createElement(CouponsTab, { coupons, loading: false, busy: false, onExtract() {}, onSave() {}, onDelete: id => window.__del.push(id), onMarkUsed() {} }));
    }, { coupons: COUPONS, lite: file !== 'index.html' });
    await page.waitForTimeout(400);
    const text = await page.$eval('#cp', n => n.innerText);
    check(L + ': the count is the live coupons only', /\b3 coupons\b/.test(text), text.slice(0, 120));
    check(L + ': the live ones keep Mark as Used, expired ones aren’t among them', (text.match(/Mark as Used/g) || []).length === 3 && (file !== 'index.html' ? !/Kohls/.test(text) : text.indexOf('Kohls') > text.indexOf('Aldi')), text);
    const tg = await page.$eval('#cp .cp-exp-toggle', n => [n.getAttribute('aria-expanded'), n.innerText]);
    if (file === 'index.html') check(L + ': Expired (2), open, says when they go', tg[0] === 'true' && /Expired \(2\)/.test(tg[1]) && /removed 7 days after they expire/.test(tg[1]), J(tg));
    else {
      check(L + ': Expired (2), closed on lite', tg[0] === 'false' && /Expired \(2\)/.test(tg[1]) && !(await page.$('#cp .cp-gone')), J(tg));
      await page.click('#cp .cp-exp-toggle'); await page.waitForTimeout(80);
    }
    const gone = await page.$$eval('#cp .cp-gone', ns => ns.map(n => ({ id: n.dataset.coupon, store: getComputedStyle(n.querySelector('.cp-gone-store')).textDecorationLine, chip: n.querySelector('.cp-gone-chip').innerText, when: (n.querySelector('.cp-gone-when') || {}).innerText || '', copy: Array.from(n.querySelectorAll('.cp-gone-copy')).map(b => b.disabled), used: /Mark as Used/.test(n.innerText) })));
    check(L + ': scratched off, with the date it expired', gone.length === 2 && gone.every(g => g.store === 'line-through') && gone[0].chip === 'Expired ' + nice(plus(-2)) && gone[1].chip === 'Expired ' + nice(plus(-4)), J(gone));
    check(L + ': …copy off, no Mark as Used, and the day it goes', J(gone[0].copy) === J([true]) && gone.every(g => !g.used) && gone[0].when === 'Goes on ' + nice(plus(5)));
    await page.click('#cp .cp-gone[data-coupon="C4"] .cp-gone-del'); await page.waitForTimeout(150);
    const deleted = file === 'index.html' ? await page.evaluate(() => window.__del) : (await page.evaluate(() => window.__gets)).filter(q => q.action === 'delete_coupon').map(q => q.id);
    check(L + ': Delete now removes it (after asking)', J(deleted) === J(['C4']), J(deleted));
    await page.click('#cp .cp-exp-toggle'); await page.waitForTimeout(80);
    check(L + ': the group folds', !(await page.$('#cp .cp-gone')) && (await page.$eval('#cp .cp-exp-toggle', n => n.getAttribute('aria-expanded'))) === (file === 'index.html' ? 'false' : 'false'));
    check(L + ': no sideways scroll, no page errors', !(await page.evaluate(() => Array.from(document.querySelectorAll('#cp *')).some(n => n.getBoundingClientRect().right > window.innerWidth + 1))) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
