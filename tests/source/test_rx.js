// Health › Prescriptions (Rx.js, webGetPrescriptions_, PrescriptionsTab, the shared NeedsYou block). Pins:
//  - ✓ Refilled today: Last Filled today, Refill Date + Days Supply (else the last gap; else blank);
//  - the nightly flag 7 days ahead (Medium; High when overdue), active ones only, closed when the date moves on;
//  - the read sends dates as yyyy-MM-dd;
//  - Victoria's refills on her lite Today (the shared block, the same in both dashboards); the full
//    Home doesn't pass rx;
//  - the screen: the Both / Ahmed / Victoria switch, counters, the supply meter, the countdown, Rx copy,
//    Refilled today, Pause / Resume and the Paused fold. Invented medicines.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RX = read('Rx.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); }, TODAY = isoOf(new Date());
const HDR = ['ID', 'Person', 'Medication', 'Dosage', 'Frequency', 'Doctor', 'Pharmacy', 'Rx Number', 'Last Filled', 'Refill Date', 'Days Supply', 'Active', 'Notes'];
function sheetOf(rows) { return { rows, getLastRow: () => rows.length, getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
  getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
    setValues: v => v.forEach((row, i) => row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; })) }) }; }
function ctx(sheet, extra) {
  const c = Object.assign({ String, Number, Math, JSON, Date, Object, parseInt, CONFIG: { SHEET_ID: 'x' }, TABS: { PRESCRIPTIONS: 'P', FLAGS: 'F' }, PRESCRIPTION_HEADERS: HDR,
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) }, Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: d => isoOf(d) } }, extra || {});
  vm.createContext(c); vm.runInContext(RX + '\n' + fnSrc(WEB, 'webGetPrescriptions_'), c); return c;
}

console.log('\nrefilled today, and the next date');
const C = ctx(sheetOf([HDR.slice()]));
check('+ Days Supply', C.rxNext_('2026-11-16', '30', '', '') === '2026-12-16');
check('…else the last gap between fills', C.rxNext_('2026-11-16', '', '2026-08-01', '2026-10-30') === '2027-02-14');
check('…else blank', C.rxNext_('2026-11-16', '', '', '') === '');
{
  const sh = sheetOf([HDR.slice(), ['RX-1', 'Victoria', 'Inhaler', '90 mcg', '', 'Lin', 'Corner Pharmacy', '445566', new Date(2026, 9, 1), new Date(2026, 9, 31), 30, 'Yes', '']]);
  const c = ctx(sh);
  const r = c.webRxRefilled_({ parameter: { id: 'RX-1' } });
  check('the route writes Last Filled and Refill Date', r.ok && sh.rows[1][8] === TODAY && sh.rows[1][9] === plus(30) && r.refillDate === plus(30), J(sh.rows[1]));
  let threw = false; try { c.webRxRefilled_({ parameter: { id: 'nope' } }); } catch (e) { threw = true; }
  check('an unknown one is refused', threw);
  const got = ctx(sheetOf([HDR.slice(), ['RX-2', 'Ahmed', 'Statin', '', '', '', '', '', new Date(2026, 9, 1), new Date(2026, 10, 30), 60, 'Yes', '']])).webGetPrescriptions_().prescriptions[0];
  check('the read sends dates as yyyy-MM-dd', got.lastFilled === '2026-10-01' && got.refillDate === '2026-11-30', J(got));
}

console.log('\nthe nightly flag');
{
  const calls = [];
  const sh = sheetOf([HDR.slice(), ['A', 'Ahmed', 'Statin', '', '', '', '', '', '', plus(5), 30, 'Yes', ''], ['B', 'Victoria', 'Inhaler', '', '', '', 'Corner Pharmacy', '445566', '', plus(-2), 30, 'Yes', ''],
    ['C', 'Ahmed', 'Allergy', '', '', '', '', '', '', plus(9), 30, 'Yes', ''], ['D', 'Ahmed', 'Old', '', '', '', '', '', '', plus(1), 30, 'No', '']]);
  const c = ctx(sh, { getSpreadsheet: () => ({ getSheetByName: () => ({}) }), upsertKeyedFlags_: (s, p, src, wanted) => calls.push([p, src, wanted]) });
  c.checkRefills_();
  const w = calls[0][2];
  check('due within 7 days or overdue, active only, under rx_refill_', calls[0][0] === 'rx_refill_' && J(Object.keys(w).sort()) === J(['rx_refill_A', 'rx_refill_B']), J(Object.keys(w)));
  check('…Medium ahead, High overdue, with the pharmacy and Rx', w.rx_refill_A.urgency === 'Medium' && w.rx_refill_B.urgency === 'High' && /overdue by 2 days/.test(w.rx_refill_B.flag) && /Corner Pharmacy · Rx 445566/.test(w.rx_refill_B.reason));
  check('it runs nightly after the tax checks', CODE.indexOf("nightlyStep_(ctx, 'checkRefills_', checkRefills_);") > CODE.indexOf("nightlyStep_(ctx, 'checkTaxLate_'"));
}

console.log('\nher lite Today');
const blk = s => s.slice(s.indexOf('// ---- NeedsYou'), s.indexOf('// ---- /NeedsYou ----'));
check('the shared block is the same in both dashboards', blk(APP).length > 500 && blk(APP) === blk(LITE));
{
  const L = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(L); vm.runInContext(blk(APP), L);
  const rx = { prescriptions: [{ id: 'B', person: 'Victoria', medication: 'Inhaler', dosage: '90 mcg', pharmacy: 'Corner Pharmacy', refillDate: plus(3), active: 'Yes' },
    { id: 'A', person: 'Ahmed', medication: 'Statin', refillDate: plus(2), active: 'Yes' }, { id: 'E', person: 'Victoria', medication: 'Vitamin D', refillDate: plus(20), active: 'Yes' }, { id: 'F', person: 'Victoria', medication: 'Paused', refillDate: plus(1), active: 'No' }] };
  const rows = L.liteNeedsYou_({ rx }, new Date()).filter(r => r.kind === 'rx');
  check('Victoria’s refills within 7 days, not Ahmed’s, not paused', J(rows.map(r => r.id)) === J(['B']) && rows[0].title === 'Refill Inhaler' && rows[0].sub === '90 mcg · Corner Pharmacy' && J(rows[0].go) === J(['family', 'prescriptions']), J(rows));
  check('…without rx, none (the full Home)', L.liteNeedsYou_({}, new Date()).filter(r => r.kind === 'rx').length === 0);
}
check('the lite Today passes rx; the full Home doesn’t', /liteNeedsYou_\(\{ cards: data\.cards, coupons: data\.coupons, chores: data\.chores, rx: data\.rx,/.test(LITE) && /liteNeedsYou_\(\{cards:ex\.cards,coupons:ex\.coupons,chores:ex\.chores\}/.test(APP));

console.log('\nthe screen’s numbers');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array, parseInt }; vm.createContext(U);
vm.runInContext(['rxDaysTo_', 'rxSupply_', 'rxActiveOf_', 'rxCounts_', 'rxWhen_'].map(n => fnSrc(APP, n)).join('\n'), U);
const NOW = new Date();
const R = [{ id: 'a', person: 'Ahmed', medication: 'Statin', dosage: '10 mg', refillDate: plus(5), daysSupply: '30', active: 'Yes', rxNumber: '112233', pharmacy: 'Corner Pharmacy' },
  { id: 'b', person: 'Victoria', medication: 'Inhaler', refillDate: plus(-2), daysSupply: '30', active: 'Yes' }, { id: 'c', person: 'Victoria', medication: 'Vitamin D', refillDate: plus(40), daysSupply: '90', active: 'Yes' },
  { id: 'd', person: 'Ahmed', medication: 'Old cream', refillDate: '', active: 'No' }];
check('counters', J(U.rxCounts_(R, NOW)) === J({ active: 3, soon: 1, overdue: 1 }) && J(U.rxCounts_(R.filter(r => r.person === 'Victoria'), NOW)) === J({ active: 2, soon: 0, overdue: 1 }));
check('supply left', Math.abs(U.rxSupply_(R[0], NOW) - 5 / 30) < 1e-9 && U.rxSupply_(R[1], NOW) === 0 && U.rxSupply_({ refillDate: plus(3) }, NOW) === null);
check('the countdown', U.rxWhen_(5) === 'Refill in 5 d' && U.rxWhen_(-2) === 'Refill overdue by 2 d' && U.rxWhen_(0) === 'Refill today' && U.rxWhen_(null) === 'No refill date');

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
    await page.evaluate(({ rows, next }) => {
      window.__ev = []; window.confirm = () => true;
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'prescriptions') return Promise.resolve({ ok: true, prescriptions: JSON.parse(JSON.stringify(rows)) });
        if (p.action === 'rx_refilled') return Promise.resolve({ ok: true, lastFilled: 'x', refillDate: next }); return Promise.resolve({ ok: true }); };
      document.body.innerHTML = '<div id="rx" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('rx')).render(React.createElement(PrescriptionsTab, { apiUrl: 'u', apiToken: 't' }));
    }, { rows: R, next: plus(30) });
    await page.waitForTimeout(250);
    check('the switch', J(await page.$$eval('#rx .rx-chip', ns => ns.map(n => n.textContent))) === J(['Both', 'Ahmed', 'Victoria']));
    check('counters', J(await page.$$eval('#rx .rx-count', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')))) === J(['3 Active', '1 Refill ≤ 7 d', '1 Overdue']));
    check('active ones, soonest refill first; paused folded', J(await page.$$eval('#rx .rx-card', ns => ns.map(n => n.dataset.rx))) === J(['b', 'a', 'c']));
    const a = await page.$eval('#rx .rx-card[data-rx="a"]', n => n.innerText);
    check('a card: countdown, pharmacy, Rx number, meter', /Refill in 5 d/.test(a) && /Corner Pharmacy/.test(a) && /Rx 112233/.test(a) && (await page.$eval('#rx .rx-card[data-rx="a"] .rx-meter span', n => n.style.width)) === '17%', a);
    await page.click('#rx .rx-chip >> text=Victoria'); await page.waitForTimeout(40);
    check('Victoria only', J(await page.$$eval('#rx .rx-card', ns => ns.map(n => n.dataset.rx))) === J(['b', 'c']));
    await page.click('#rx .rx-card[data-rx="b"] .rx-refilled'); await page.waitForTimeout(80);
    check('✓ Refilled today moves the date on', J((await page.evaluate(() => window.__ev)).filter(p => p.action === 'rx_refilled').pop()) === J({ action: 'rx_refilled', id: 'b' }) && /Refill in 30 d/.test(await page.$eval('#rx .rx-card[data-rx="b"]', n => n.innerText)));
    await page.click('#rx .rx-chip >> text=Both'); await page.click('#rx .rx-card[data-rx="c"] .rx-pause'); await page.waitForTimeout(60);
    check('Pause', J((await page.evaluate(() => window.__ev)).filter(p => p.action === 'update_prescription').pop()) === J({ action: 'update_prescription', id: 'c', active: 'No' }));
    await page.click('#rx .rx-fold'); await page.waitForTimeout(40);
    check('the Paused fold, with Resume', !!(await page.$('#rx .rx-card.paused[data-rx="d"] .rx-resume')));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
