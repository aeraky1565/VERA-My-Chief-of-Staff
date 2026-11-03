// Finances › Day to day › Bills & cashflow (BillsCashflowTab, shared verbatim, issue #226) in
// BOTH real pages at phone and desktop width, on an invented tracker: List (bills by due day,
// credit folded in, card payments apart, editing a bill's schedule, bringing over the old Bills
// list), Timeline (Joint Checking with the checkpoint windows) and Reconcile (a quarter, with
// "not in uploads" and the flags), and no sideways scroll. Every name and figure is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { tracker } = require('./budget_fixture.js');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const BS = fs.readFileSync(path.join(ROOT, 'BillSchedule.js'), 'utf8');
console.log('\nthe wiring');
check('Bills and Cashflow are one subtab in the full dashboard, and Victoria’s Money has no Bills',
  APP.indexOf("{id:'billscash',label:'🧾 Bills & cashflow'}") !== -1 && !/\{id:'bills',label:'🧾 Bills'\}/.test(APP) && !/\{id:'cashflow',label:'💰 Cashflow'\}/.test(APP)
  && LITE.indexOf("{ id: 'fin_billscash', label: '🧾 Bills & cashflow' }") === -1 && LITE.indexOf("{ id: 'fin_bills',") === -1);
check('…mounting BillsCashflowTab', APP.indexOf("sub==='billscash'&&React.createElement(BillsCashflowTab,{apiUrl:apiUrl,apiToken:apiToken})") !== -1
  && LITE.indexOf("{activeFinanceTab === 'fin_billscash' && <BillsCashflowTab apiUrl={apiUrl} apiToken={apiToken} />}") !== -1);

// the payload bills_schedule sends, worked out with the real code
const E = vm.createContext({});
vm.runInContext(APP.slice(APP.indexOf('// ---- BudgetEngine'), APP.indexOf('// ---- /BudgetEngine ----')), E);
vm.runInContext(BS.slice(BS.indexOf('var BS_TAB_'), BS.indexOf('// ---- reading and writing')), E);
E.G = tracker();
E.C = vm.runInContext('budgetCompute_(budgetModel_(G), {}, {})', E);
E.SCHED = vm.runInContext('bsScheduleMap_([["Gold Card", 3, "Pat checking", true, "Gold Card", "card payment", ""]])', E);
const list = vm.runInContext('bsBills_(C, SCHED)', E); E.LIST = list;
const PAYLOAD = { ok: true, configured: true, bills: list.bills, cards: list.cards, budgetLines: list.budgetLines, total: list.total,
  timeline: vm.runInContext('bsTimeline_(LIST, C, { transferDay: 1 })', E), quarter: '2026-Q4',
  migration: { matched: [{ bill: 'Rent', line: 'Rent' }], cards: ['Gold Card'], unmatched: [{ bill: 'Gym', amount: 40, why: '' }], skipped: [] } };
E.TXR = [{ month: '2026-07', description: 'ACME PROPERTY RENT', amount: -2000 }, { month: '2026-08', description: 'ACME PROPERTY RENT', amount: -2000 }, { month: '2026-09', description: 'ACME PROPERTY RENT', amount: -2000 },
  { month: '2026-08', description: 'CITY ELECTRIC CO', amount: -332 }];
const REC = Object.assign({ ok: true }, vm.runInContext('bsReconcile_(C, LIST, TXR, "2026-Q3", {})', E));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const QUICK = !!process.env.BS_QUICK;
  for (const kind of (QUICK ? ['full'] : ['full', 'lite'])) {
    for (const width of (QUICK ? [390] : [390, 1280])) {
      const L = kind + ' ' + width;
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
      await page.waitForFunction(() => typeof BillsCashflowTab === 'function', null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(({ PAYLOAD, REC }) => {
        window.__gets = []; window.__posts = [];
        window.apiGet = (u, t, p) => { window.__gets.push(Object.assign({}, p));
          if (p.action === 'bills_schedule') return Promise.resolve(JSON.parse(JSON.stringify(PAYLOAD)));
          if (p.action === 'bills_reconcile') return Promise.resolve(p.quarter === '2026-Q2' ? { ok: true, quarter: '2026-Q2', noUploads: true, error: 'The transactions sheet isn’t connected.' } : JSON.parse(JSON.stringify(REC)));
          return Promise.resolve({ ok: false }); };
        window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b))); return Promise.resolve(b.action === 'bills_schedule_migrate' ? { ok: true, written: 2 } : { ok: true }); };
        document.querySelectorAll('#bsprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'bsprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        ReactDOM.createRoot(host).render(React.createElement(BillsCashflowTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
      }, { PAYLOAD, REC });
      await wait(400);
      const txt = sel => page.$eval('#bsprobe ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
      const click = sel => page.evaluate(sel => { const n = document.querySelector('#bsprobe ' + sel); if (n) n.click(); return !!n; }, sel);
      const fill = (sel, v) => page.evaluate(({ sel, v }) => { const n = document.querySelector('#bsprobe ' + sel); if (!n) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); return true; }, { sel, v });
      const views = await page.$$eval('#bsprobe .bs-view', ns => ns.map(n => n.textContent + ':' + n.getAttribute('aria-selected')));
      check(L + ': List · Timeline · Reconcile, opening on List', views.join() === 'List:true,Timeline:false,Reconcile:false', views.join());
      const rows = await page.$$eval('#bsprobe .bs-row', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': bills by due day, amounts from the tracker', /^1st Rent Joint \$2,000\.00/.test(rows[0]) && /^12th Family Plan Payment Joint · net of the \$50 credit \$150\.00/.test(rows[1]) && /^— Dog Walker Joint · set a due day \$40\.00/.test(rows[4]), JSON.stringify(rows));
      const cards = await txt('.bs-cards');
      check(L + ': card payments apart, never counted', /Card payments \(not counted as spending\) Gold Card due 3rd · Pat checking · statement amount · Cards: Gold Card · autopay/.test(cards) && /Bills each month \$2,450\.00/.test(await txt('.bs-list')), cards);
      check(L + ': budget lines named, not listed', /Groceries, Home Cleaning are budget lines, not bills/.test(await txt('.bs-list')));
      check(L + ': the old Bills list offered, with what matches nothing', /1 match a tracker line, 1 are card payments, and these match nothing: Gym/.test(await txt('.bs-migrate')));
      await click('.bs-migrate-go'); await wait(150);
      let posts = await page.evaluate(() => window.__posts);
      check(L + ': Bring them over', posts[0] && posts[0].action === 'bills_schedule_migrate' && posts[0].apply === true && /Brought over 2/.test(await txt('.bs-msg')));
      await page.evaluate(() => document.querySelector('#bsprobe .bs-edit-btn[aria-label="Edit Internet"]').click()); await wait(100);
      await fill('.bs-edit-due', '9'); await click('.bs-edit-autopay'); await fill('.bs-edit-notes', 'paperless'); await wait(50);
      await click('.bs-edit-save'); await wait(150);
      posts = await page.evaluate(() => window.__posts);
      const sv = posts.find(p => p.action === 'bills_schedule_save') || {};
      check(L + ': editing a bill saves its schedule, never an amount', sv.line === 'Internet' && sv.dueDay === '9' && sv.autopay === true && sv.notes === 'paperless' && sv.kind === 'bill' && !('amount' in sv), JSON.stringify(sv));
      await page.evaluate(() => Array.from(document.querySelectorAll('#bsprobe .bs-view')).find(b => b.textContent === 'Timeline').click()); await wait(150);
      const evs = await page.$$eval('#bsprobe .bs-ev', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': Timeline: transfers in, Joint bills out, the running balance', /^1st Pat → AMEX Checking Joint after: \$1,690 \+\$1,690/.test(evs[0]) && /^1st Rent Joint after: \$340 −\$2,000/.test(evs[2]) && /^12th Family Plan Payment: money back, before it’s due Joint after: \$390 \+\$50/.test(evs[3]) && /^12th Family Plan Payment Joint after: \$190 −\$200/.test(evs[4]) && /^15th Utilities - Electric Joint after: \$40 −\$90/.test(evs[6]), JSON.stringify(evs));
      check(L + ': the checkpoint windows', /Days 1–7 \$2,000 due keep \$2,300 in Joint from day 1/.test(await txt('.bs-windows')) && /Days 8–20 \$300 due/.test(await txt('.bs-windows')));
      check(L + ': undated Joint bills named', /No due day yet, so not on the timeline: Dog Walker/.test(await txt('.bs-timeline')));
      await page.evaluate(() => Array.from(document.querySelectorAll('#bsprobe .bs-view')).find(b => b.textContent === 'Reconcile').click()); await wait(250);
      const rec = await page.$$eval('#bsprobe .bs-rec-row', ns => ns.map(n => n.className.split(' ')[1] + ':' + n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': Reconcile: the last full quarter, plan × 3 against actual', /Reconcile · 2026-Q3/.test(await txt('.bs-reconcile')) && rec.some(r => /^ok:Rent plan \$6,000 \$6,000 ✓/.test(r)) && rec.some(r => /^off:Utilities - Electric plan \$270 \$332 \+\$62/.test(r)), JSON.stringify(rec));
      check(L + ': …“not in uploads”, and budget lines marked', rec.some(r => /^none:Internet plan \$180 not in uploads/.test(r)) && rec.some(r => /^none:Groceries\s*budget line/.test(r)));
      await click('.bs-q-prev'); await wait(200);
      check(L + ': the previous quarter, with no uploads, says so', /2026-Q2/.test(await txt('.bs-reconcile')) && /isn’t connected/.test(await txt('.bs-rec-none')) && (await page.evaluate(() => window.__gets.some(g => g.action === 'bills_reconcile' && g.quarter === '2026-Q2'))));
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
