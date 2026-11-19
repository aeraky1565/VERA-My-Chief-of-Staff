// Finances › Budget (BudgetTab, shared verbatim, issue #226) in BOTH real pages at phone and
// desktop width, on an invented Household Split tab: the month at a glance (the four figures,
// where each paycheck goes, the charts, the checks), then the sheet's six sections that open and
// close and remember it; Add a bill (with what changes) and ✎ on a bill or a figure write the
// sheet through budget_add_bill / budget_write; What if reruns everything live, saves a scenario
// or writes its changes; a refused write says why; no sideways scroll. Every name and figure is invented.
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
const START = '// ---- BudgetTab (Finances › Day to day › Budget, issue #226) — SHARED VERBATIM', END = '// ---- /BudgetTab ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
console.log('\nthe shared block');
check('both dashboards carry it, word for word', block(APP).length > 2000 && block(APP) === block(LITE));
check('Budget mounts BudgetTab in both dashboards',
  APP.indexOf("sub==='budget'&&React.createElement(BudgetTab,{apiUrl:apiUrl,apiToken:apiToken})") !== -1
  && LITE.indexOf("{activeFinanceTab === 'fin_budget' && <BudgetTab apiUrl={apiUrl} apiToken={apiToken} />}") !== -1);

// the payload budget_model sends, worked out with the engine as the dashboards carry it
const E = vm.createContext({});
const eng = APP.slice(APP.indexOf('// ---- BudgetEngine'), APP.indexOf('// ---- /BudgetEngine ----'));
vm.runInContext(eng, E); E.G = tracker();
const model = vm.runInContext('budgetModel_(G)', E); E.M = model;
const computed = vm.runInContext('budgetCompute_(M, {}, {})', E); E.C = computed;
const PAYLOAD = { ok: true, configured: true, model, computed, match: vm.runInContext('budgetMatch_(M, C)', E), categoryMap: {}, quarter: '2026-Q4',
  scenarios: [{ id: 'BGS-OLD', name: 'Cheaper flat', changes: { 'shared.fixed:Rent': 1800 }, results: { totalShared: 2950, totalDisposable: 6850 }, created: '2026-10-01T00:00:00Z', quarter: '2026-Q4' }] };

const window_ACTS = { ok: true, quarter: '2026-Q3', uploads: 20, lines: { 'shared.fixed:Rent': { plan: 2000, actual: 2003.33 }, 'shared.fixed:Utilities - Electric': { plan: 90, actual: 110.67 },
  'shared.fixed:Internet': { plan: 60, actual: null }, 'pat.nice:Music': { plan: 10, actual: 11 }, 'pat.fixed:Phone - Pat': { plan: 50, actual: null } } };

// What if's units: a paycheck line is typed per paycheck and counts × paychecks in a regular month.
vm.runInContext(block(APP).replace(/function BudgetTab\(props\)[\s\S]*$/, ''), E);
E.M2 = JSON.parse(JSON.stringify(model)); E.M2.people[0].perMonth = 2;
check('What if: a paycheck line counts × paychecks in a regular month, and writes back per paycheck',
  JSON.stringify(vm.runInContext('bgChanged_(M2, { "pat.gross": 5500, "shared.pay:Health Insurance - Medical": 60, "shared.fixed:Rent": 2100 })', E)) === JSON.stringify({ 'pat.gross': 11000, 'shared.pay:Health Insurance - Medical': 60, 'shared.fixed:Rent': 2100 })
  && JSON.stringify(vm.runInContext('bgEditsFrom_(M2, { "pat.gross": 11000 }, 0.6)', E)) === JSON.stringify([{ key: 'pat.gross', value: 5500 }]));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const QUICK = !!process.env.BG_QUICK;
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
      await page.waitForFunction(() => typeof BudgetTab === 'function', null, { timeout: 15000 }).catch(() => {});
      const mount = () => page.evaluate(({ PAYLOAD, ACTS }) => {
        window.__posts = [];
        window.apiGet = (u, t, p) => Promise.resolve(p && p.action === 'budget_model' ? JSON.parse(JSON.stringify(PAYLOAD)) : p && p.action === 'budget_actuals' ? JSON.parse(JSON.stringify(ACTS)) : { ok: false });
        window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b)));
          if (b.action === 'budget_scenario_save') return Promise.resolve({ ok: true, scenario: { id: 'BGS-NEW', name: b.name, changes: b.changes, results: { totalShared: 3650 }, quarter: '2026-Q4' } });
          if (b.action === 'budget_add_bill') return Promise.resolve({ ok: true, row: 36, bill: b });
          if (b.action === 'budget_write') return window.__refuse ? Promise.reject(new Error(window.__refuse)) : Promise.resolve({ ok: true, written: b.edits.length, what: b.edits.map(e => e.key) });
          return Promise.resolve({ ok: true }); };
        document.querySelectorAll('#bgprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'bgprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        ReactDOM.createRoot(host).render(React.createElement(BudgetTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
      }, { PAYLOAD, ACTS: window_ACTS });
      await page.evaluate(() => { try { localStorage.removeItem('vera_budget_open'); } catch (e) {} });
      await mount(); await wait(400);
      const txt = sel => page.$eval('#bgprobe ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
      const click = sel => page.$eval('#bgprobe ' + sel, n => n.click());
      const fill = async (sel, v) => { await page.fill('#bgprobe ' + sel, v); };
      const posts = () => page.evaluate(() => window.__posts);
      const secOpen = id => page.$eval('#bgprobe .bg-sec-' + id + ' .bg-sec-head', n => n.getAttribute('aria-expanded')).catch(() => null);
      // the glance
      check(L + ': the four figures', /Take-home, together \$11,500 Pat \$6,900 · Sam \$4,600/i.test(await txt('.bg-kpi-take')) && /Shared costs \$3,150 split 60 \/ 40/i.test(await txt('.bg-kpi-shared'))
        && /Into Joint Checking \$2,340 matches what Joint pays out ✓/i.test(await txt('.bg-kpi-joint')) && /Left over \$6,650 Pat \$4,010 · Sam \$2,640/i.test(await txt('.bg-kpi-left')), await txt('.bg-kpis'));
      check(L + ': the summary boxes are whole dollars', !/\.\d\d/.test(await txt('.bg-kpis')), await txt('.bg-kpis'));
      const flow = await txt('.bg-flow');
      check(L + ': where each paycheck goes, both of you, with the settle-up', /Pat take-home \$6,900\.00/.test(flow) && /Joint Checking \$1,690/.test(flow) && /Sam take-home \$4,600\.00/.test(flow) && /Pat covers \$286\.00 of Sam’s share/.test(flow), flow);
      check(L + ': three charts: take-home, shared by category, by type with set-asides', await page.$$eval('#bgprobe .bg-charts svg', ns => ns.length) === 2 && /Housing \$2,000\.00/.test(await txt('.bg-chart-cats'))
        && /Fixed \$3,000\.00 · 95%/.test(await txt('.bg-chart-type')) && /Pat \$100\.00 · Sam \$0\.00 · \$100\.00 a month/.test(await txt('.bg-setaside')), await txt('.bg-chart-type'));
      check(L + ': the checks: Joint, missing fields, settle-up, VERA matches the sheet', /Joint in − out \$0\.00 ✓/.test(await txt('.bg-checks')) && /missing Type, For or Paid by 0 ✓/.test(await txt('.bg-checks')) && /match the sheet ✓/.test(await txt('.bg-checks')), await txt('.bg-checks'));
      // the sections
      check(L + ': six sections in the sheet’s order; Bills and Split open the first time', (await page.$$eval('#bgprobe .bg-sec .bg-sec-head', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').split(' ')[1]))).join() === '1,2,3,4,5,6'
        && (await secOpen('bills')) === 'true' && (await secOpen('split')) === 'true' && (await secOpen('paychecks')) === 'false');
      check(L + ': a closed section shows its headline', /Emergency fund 3 mo \$9,000 · 6 mo \$18,000 · 9 mo \$27,000/.test(await txt('.bg-sec-emergency')) && /Pat \$6,900 × 1/.test(await txt('.bg-sec-paychecks')));
      await click('.bg-sec-paychecks .bg-sec-head'); await wait(120);
      check(L + ': opened, it remembers', (await secOpen('paychecks')) === 'true' && await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('vera_budget_open') || '{}').paychecks === true; } catch (e) { return false; } }));
      const pay = await txt('.bg-sec-paychecks');
      check(L + ': Paychecks per paycheck, the shared cost from pay marked, taxes worked out, take-home', /Gross pay per paycheck \$10,000\.00/.test(pay) && /Health Insurance - Medical shared \$100\.00/.test(pay) && /Taxes \(worked out from the deposit\) \$2,000\.00/.test(pay) && /Take-home, regular month \$6,900\.00 \$4,600\.00/.test(pay), pay);
      check(L + ': taxes and take-home have no ✎ (the sheet works them out)', await page.$eval('#bgprobe .bg-pay', t => { const rs = Array.from(t.querySelectorAll('.bg-tr')).filter(r => /^(Taxes|Take-home)/.test(r.innerText.trim())); return rs.length === 2 && rs.every(r => !r.querySelector('.bg-pencil')); }));
      const bills = await txt('.bg-sec-bills');
      check(L + ': Bills: the shared ones first, with both shares, the cost from pay listed too', /Shared · 9/.test(bills) && (/Rent \$2,000\.00 Fixed Shared Joint Actual Housing \$1,200\.00 \$800\.00/.test(bills) || /Rent \$2,000\.00 Fixed Shared Paid by Joint Actual Housing Pat \$1,200\.00 Sam \$800\.00/.test(bills)) && /Health Insurance - Medical .*from Pat’s pay/.test(bills) && !/Car Insurance - Pat/.test(bills), bills);
      check(L + ': plan vs actual on a bill', /Actual, 2026-Q3/.test(bills) && await page.$eval('#bgprobe .bg-bills', t => Array.from(t.querySelectorAll('.bg-bill')).some(r => /^Utilities - Electric/.test(r.innerText.trim()) && r.querySelector('.bg-actual.over'))));
      await click('.bg-for-pat'); await wait(100);
      check(L + ': For Pat shows Pat’s own bills, Set-aside marked', /Car Insurance - Pat \$100\.00 Fixed (For )?Pat (Paid by )?Pat Set-aside Insurance/.test(await txt('.bg-sec-bills')) && !/Rent/.test(await txt('.bg-bills')));
      await click('.bg-for-shared'); await wait(80);
      // Add a bill
      await click('.bg-add'); await wait(120);
      check(L + ': Add a bill opens the form', await page.$('.bg-bill-form') !== null && /Adds a row to Household Split › 2\. Bills/.test(await page.$eval('.bg-bill-form', n => n.innerText)));
      await page.fill('.bg-bill-form input[aria-label="Bill"]', 'Window Cleaner'); await page.fill('.bg-bill-form input[aria-label="Monthly amount"]', '50');
      await page.$$eval('.bg-bill-form [aria-label="Paid by"] button', bs => bs.find(b => b.innerText === 'Pat').click());
      await page.$$eval('.bg-bill-form [aria-label="Kept as"] button', bs => bs.find(b => b.innerText === 'Set-aside').click()); await wait(100);
      const pv = await page.$eval('.bg-preview', n => n.innerText.replace(/\s+/g, ' '));
      check(L + ': What changes, before saving', /Shared costs \$3,150\.00 → \$3,200\.00/.test(pv) && /Pat’s Joint transfer \$1,690\.00 → \$1,670\.00/.test(pv) && /Sam’s Joint transfer \$650\.00 → \$670\.00/.test(pv), pv);
      await page.$eval('.bg-form-save', n => n.click()); await wait(250);
      let P = await posts();
      check(L + ': Add to the sheet sends the bill', P.length === 1 && P[0].action === 'budget_add_bill' && P[0].name === 'Window Cleaner' && P[0].amount === '50' && P[0].paidBy === 'Pat' && P[0].keptAs === 'Set-aside' && P[0].forWho === 'Shared' && P[0].type === 'Fixed', JSON.stringify(P));
      check(L + ': …then says where it went, and reads the sheet again', /Added Window Cleaner to Household Split \(row 36\)/.test(await txt('.bg-msg')) && await page.$('.bg-bill-form') === null);
      // ✎ on a bill sends only what changed
      await page.$eval('#bgprobe .bg-bills', t => Array.from(t.querySelectorAll('.bg-bill')).find(r => /^Internet/.test(r.innerText.trim())).querySelector('.bg-pencil').click()); await wait(120);
      await page.fill('.bg-bill-form input[aria-label="Monthly amount"]', '65'); await wait(60); await page.$eval('.bg-form-save', n => n.click()); await wait(200);
      P = await posts();
      check(L + ': ✎ on a bill writes only what changed', P[1] && P[1].action === 'budget_write' && JSON.stringify(P[1].edits) === JSON.stringify([{ key: 'shared.fixed:Internet', field: 'amount', value: '65' }]), JSON.stringify(P[1]));
      // ✎ on a figure
      await page.$eval('#bgprobe .bg-pay', t => Array.from(t.querySelectorAll('.bg-tr')).find(r => /^Gross pay/.test(r.innerText.trim())).querySelector('.bg-pencil').click()); await wait(120);
      check(L + ': Change a value names it and what it was', /Pat’s gross pay per paycheck/.test(await page.$eval('.bg-value-form', n => n.innerText)) && /Was \$10,000\.00/.test(await page.$eval('.bg-value-form', n => n.innerText)));
      await page.evaluate(() => { window.__refuse = 'Pat · gross pay per paycheck is worked out by the sheet, so VERA won’t type over it.'; });
      await page.fill('.bg-value-input', '10500'); await page.$eval('.bg-value-save', n => n.click()); await wait(200);
      check(L + ': a refused write says why and keeps the form open', /worked out by the sheet/.test(await page.$eval('.bg-value-form .bg-form-err', n => n.innerText).catch(() => '')));
      await page.evaluate(() => { window.__refuse = ''; }); await page.$eval('.bg-value-save', n => n.click()); await wait(200);
      P = await posts();
      check(L + ': Save to the sheet sends that one cell, per paycheck', JSON.stringify(P[P.length - 1].edits) === JSON.stringify([{ key: 'pat.gross', field: 'amount', value: '10500' }]) && await page.$('.bg-value-form') === null);
      // What if
      await click('.bg-whatif-toggle'); await wait(150);
      check(L + ': What if: every input becomes a field, nothing written', (await page.$$('#bgprobe .bg-bills .bg-input')).length === 9 && !(await page.$$eval('#bgprobe .bg-bills .bg-pencil', n => n.length)) && await page.$('#bgprobe .bg-split-range') !== null && /Nothing is written to the sheet/.test(await txt('.bg-whatif-bar')));
      await fill('.bg-bills input[aria-label="Rent"]', '2500'); await wait(150);
      check(L + ': a change reruns every sum', /Shared costs \$3,650/i.test(await txt('.bg-kpi-shared')) && /1 change · left over \$6,650\.00 → \$6,150\.00/.test(await txt('.bg-whatif-bar')), await txt('.bg-whatif-bar'));
      await page.evaluate(() => { const r = document.querySelector('#bgprobe .bg-split-range'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '50'); r.dispatchEvent(new Event('input', { bubbles: true })); });
      await wait(150);
      check(L + ': the split slider reruns them too', /Transfer to Joint Checking \$1,625\.00 \$1,215\.00 \$2,840\.00/.test(await txt('.bg-row-joint')), await txt('.bg-row-joint'));
      await click('.bg-reset'); await wait(120);
      check(L + ': Reset clears it', /Change any figure/.test(await txt('.bg-whatif-bar')) && await page.$('#bgprobe .bg-input.bg-changed') === null);
      await fill('.bg-pay input[aria-label="Pat · Health Insurance - Medical per paycheck"]', '150'); await wait(100);
      check(L + ': a paycheck line is typed per paycheck', /left over \$6,650\.00 → \$6,600\.00/.test(await txt('.bg-whatif-bar')), await txt('.bg-whatif-bar'));
      await page.fill('#bgprobe input[aria-label="Scenario name"]', 'Dearer cover'); await click('.bg-save-scenario'); await wait(200);
      P = await posts();
      check(L + ': Save as a scenario sends only what changed, a month', P[P.length - 1].action === 'budget_scenario_save' && JSON.stringify(P[P.length - 1].changes) === '{"shared.pay:Health Insurance - Medical":150}', JSON.stringify(P[P.length - 1]));
      await click('.bg-write'); await wait(120);
      check(L + ': Write these to the sheet lists each change first', /Pat · Health Insurance - Medical: \$100\.00 → \$150\.00 a paycheck/.test(await page.$eval('.bg-write-confirm', n => n.innerText).catch(() => '')));
      if (!(await page.$('.bg-write-confirm'))) { check(L + ': …then writes them', false, 'no confirm'); await page.close(); continue; }
      await page.$eval('.bg-write-go', n => n.click()); await wait(250);
      P = await posts();
      check(L + ': …then writes them, per paycheck, and leaves What if', JSON.stringify(P[P.length - 1].edits) === JSON.stringify([{ key: 'shared.pay:Health Insurance - Medical', value: 150 }]) && /What if…/.test(await txt('.bg-whatif-toggle')));
      await page.evaluate(() => Array.from(document.querySelectorAll('#bgprobe .bg-scenario')).find(n => /Cheaper flat/.test(n.innerText)).querySelector('button').click()); await wait(150);
      check(L + ': Open in What if loads a saved scenario', /Shared costs \$2,950/i.test(await txt('.bg-kpi-shared')), await txt('.bg-kpi-shared'));
      check(L + ': buttons and section heads are big enough to tap', await page.$$eval('#bgprobe .bg-sec-head, #bgprobe .bg-pencil, #bgprobe .bg-for, #bgprobe .bg-add', ns => ns.every(n => n.getBoundingClientRect().height >= 40)));
      check(L + ': on a phone the bills are cards and the sections have no tables; on a computer, tables', width < 640 ? (await page.$$('#bgprobe table')).length === 0 && (await page.$$('#bgprobe .bg-bills .bg-bill')).length > 5 : (await page.$$('#bgprobe table')).length >= 2);
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      // an unreadable tracker says why
      await page.evaluate(() => { window.apiGet = () => Promise.resolve({ ok: true, configured: true, unavailable: true, error: 'The budget tracker’s Household Split tab has no “1. Paychecks” section.' }); document.querySelectorAll('#bgprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'bgprobe'; document.body.prepend(host); ReactDOM.createRoot(host).render(React.createElement(BudgetTab, { apiUrl: 'u', apiToken: 't' })); });
      await wait(200);
      check(L + ': an unreadable sheet says why', /no “1\. Paychecks” section/.test(await txt('.bg-unavailable')));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
