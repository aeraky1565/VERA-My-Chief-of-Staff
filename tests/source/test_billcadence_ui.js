// How often a bill is due, in the real pages (the rules are in test_billcadence.js): Monthly, Every 2 weeks, Quarterly, Twice a year,
// Yearly. The tracker holds each payment's amount; VERA works out which months a bill is due, the
// monthly share, a tick per payment for a bill every 2 weeks, and every reader that means "due this
// month" skips a bill that isn't. Then the editor and both bill lists in the real pages, at phone
// and desktop width. Every name, date and figure is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { tracker } = require('./budget_fixture.js');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BS = read('BillSchedule.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html'), WEB = read('WebApp.js'), NOTIFY = read('Notify.js'), REM = read('Reminders.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify, wait = ms => new Promise(r => setTimeout(r, ms));
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const E = vm.createContext({});
vm.runInContext(APP.slice(APP.indexOf('// ---- BudgetEngine'), APP.indexOf('// ---- /BudgetEngine ----')), E);
vm.runInContext(BS.slice(BS.indexOf('var BS_TAB_'), BS.indexOf('// ---- reading and writing')), E);
['bsWhen_', 'bsRowDue_', 'bsTogglePaidDate_', 'bsSetPaid_', 'webSaveBillSchedule_'].forEach(n => vm.runInContext(extractFn(BS, n), E));
vm.runInContext(extractFn(NOTIFY, 'eveningUnpaid_'), E);
E.G = tracker();
E.C = vm.runInContext('budgetCompute_(budgetModel_(G), {}, {})', E);
E.SCHED = vm.runInContext(`bsScheduleMap_([
  ['Internet', 9, '', false, '', 'bill', '', '', 'Quarterly', '2026-12'],
  ['Utilities - Electric', '', '', false, '', 'bill', '', '2026-11-06', 'Bi-weekly', '2026-11-06'],
  ['Rent', 1, '', false, '', 'bill', '', '']])`, E);
const L = vm.runInContext('bsBills_(C, SCHED, { month: "2026-11", today: "2026-11-19" })', E); E.LIST = L;
const T = vm.runInContext('bsTimeline_(LIST, C, { transferDay: 1 })', E);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const PAYLOAD = { ok: true, configured: true, bills: L.bills, cards: [], budgetLines: [], total: L.total, monthlyShare: L.monthlyShare,
    timeline: T, quarter: '2026-Q4', migration: null, month: '2026-11', today: '2026-11-19' };
  const TRACK = { ok: true, currentMonth: '2026-11', source: 'tracker', bills: [
    { row: null, key: 'Dog Walker', bill: 'Dog Walker', amount: 120, dueDay: null, frequency: 'Bi-weekly', category: 'Pets', account: 'Joint', paid: false, notes: '', type: 'Expense', txMatch: null, txCandidates: [], dueDates: ['2026-11-06', '2026-11-20'], paidDates: ['2026-11-06'], next: '2026-11-20', dueThisMonth: true },
    { row: null, key: 'Water', bill: 'Water', amount: 90, dueDay: 9, frequency: 'Quarterly', category: 'Utilities', account: 'Joint', paid: false, notes: '', type: 'Expense', txMatch: null, txCandidates: [], dueDates: [], paidDates: [], next: '2026-12-09', dueThisMonth: false },
    { row: null, key: 'Rent', bill: 'Rent', amount: 2000, dueDay: 1, frequency: 'Monthly', category: 'Housing', account: 'Joint', paid: true, notes: '', type: 'Expense', txMatch: null, txCandidates: [], dueDates: ['2026-11-01'], paidDates: [], next: '2026-12-01', dueThisMonth: true }] };
  for (const kind of ['full', 'lite']) {
    for (const width of [390, 1280]) {
      const LB = kind + ' ' + width;
      console.log('\n' + kind + ' dashboard @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errs = []; page.on('pageerror', e => errs.push(e.message));
      if (kind === 'lite') {
        await page.route('**/*', r => {
          const u = r.request().url();
          for (const n of Object.keys(vendor)) if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
          if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: LITE });
          return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
        });
        await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else {
        await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      }
      await page.waitForFunction(() => typeof BillsCashflowTab === 'function' && typeof BillTrackerView === 'function', null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(({ PAYLOAD, TRACK }) => {
        window.__posts = []; window.__toggles = [];
        window.apiGet = (u, t, p) => Promise.resolve(p.action === 'bills_schedule' ? JSON.parse(JSON.stringify(PAYLOAD)) : { ok: false });
        window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b))); return Promise.resolve({ ok: true }); };
        document.querySelectorAll('#bcprobe,#btprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'bcprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        ReactDOM.createRoot(host).render(React.createElement(BillsCashflowTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
        const host2 = document.createElement('div'); host2.id = 'btprobe'; host2.style.padding = '0 12px'; document.body.prepend(host2);
        ReactDOM.createRoot(host2).render(React.createElement(BillTrackerView, { accounts: [], bills: TRACK, calBills: [], billsLoading: false, txList: [],
          onToggle: (row, b) => window.__toggles.push({ row, bill: b && b.bill, payDate: b && b.payDate }), onCalToggle: () => {}, onReassign: () => {}, trackerBudget: null, onBudgetLink: () => {} }));
      }, { PAYLOAD, TRACK });
      await wait(450);
      const txt = sel => page.$eval(sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
      const rows = await page.$$eval('#bcprobe .bs-row', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      const internet = rows.find(r => /Internet/.test(r)) || '', elec = rows.find(r => /Utilities - Electric/.test(r)) || '';
      check(LB + ': a quarterly bill not due this month: its chip, “Not due this month · next Dec 9”, dimmed', /Internet Quarterly/.test(internet) && /Not due this month · next Dec 9/.test(internet)
        && await page.$$eval('#bcprobe .bs-row-off', ns => ns.some(n => /Internet/.test(n.innerText))), internet);
      check(LB + ': a bill every 2 weeks lists both dates', /^6th, 20th Utilities - Electric Every 2 weeks/.test(elec), elec);
      check(LB + ': due this month, and the monthly share', /Due this month/.test(await txt('#bcprobe .bs-total')) && /Monthly share/.test(await txt('#bcprobe .bs-share')));
      await page.evaluate(() => document.querySelector('#bcprobe .bs-edit-btn[aria-label="Edit Rent"]').click()); await wait(100);
      const opts = await page.$$eval('#bcprobe .bs-edit-cadence option', ns => ns.map(n => n.textContent));
      check(LB + ': How often: the five choices', opts.join() === 'Monthly,Every 2 weeks,Quarterly,Twice a year,Yearly', opts.join());
      check(LB + ': monthly asks for nothing more', !(await page.$('#bcprobe .bs-edit-starts')));
      const pick = v => page.evaluate(v => { const s = document.querySelector('#bcprobe .bs-edit-cadence'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, v); s.dispatchEvent(new Event('change', { bubbles: true })); }, v);
      const fill = (sel, v) => page.evaluate(({ sel, v }) => { const n = document.querySelector('#bcprobe ' + sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); }, { sel, v });
      await pick('semiannual'); await wait(60);
      check(LB + ': twice a year asks for the first due month', await page.$eval('#bcprobe .bs-edit-starts', n => n.type).catch(() => '') === 'month');
      await pick('biweekly'); await wait(60);
      check(LB + ': every 2 weeks asks for a payment date, and says the due day isn’t used', await page.$eval('#bcprobe .bs-edit-starts', n => n.type).catch(() => '') === 'date' && /isn’t used/.test(await txt('#bcprobe .bs-edit-hint')));
      await pick('semiannual'); await wait(60); await fill('.bs-edit-starts', '2026-05'); await wait(60);
      await page.evaluate(() => document.querySelector('#bcprobe .bs-edit-save').click()); await wait(150);
      const sv = (await page.evaluate(() => window.__posts)).find(p => p.action === 'bills_schedule_save') || {};
      check(LB + ': Save sends how often and the first due month', sv.line === 'Rent' && sv.cadence === 'semiannual' && sv.starts === '2026-05', J(sv));
      const trow = () => page.$$eval('#btprobe button', ns => ns.map(n => n.parentElement.innerText.replace(/\s+/g, ' ').trim()).filter(t => /Dog Walker|Water|Rent/.test(t)));
      const tr = await trow();
      check(LB + ': the month list: a bill every 2 weeks is a row per date, a quarterly bill not due isn’t listed', tr.filter(t => /Dog Walker/.test(t)).length === 2 && /Nov 6 ✅ Paid/.test(tr.join('|')) && /Nov 20/.test(tr.join('|')) && !tr.some(t => /Water/.test(t)), J(tr));
      const clicked = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#btprobe button')).find(n => /Dog Walker/.test(n.parentElement.innerText) && /Nov 20/.test(n.parentElement.innerText)); if (b) b.click(); return !!b; });
      await wait(80);
      const tg = await page.evaluate(() => window.__toggles);
      check(LB + ': ticking one payment sends its date', clicked && tg.some(t => t.bill === 'Dog Walker' && t.row == null && t.payDate === '2026-11-20'), J(tg));
      check(LB + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      check(LB + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
