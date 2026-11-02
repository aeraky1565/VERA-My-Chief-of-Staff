// Finances › Summary (FinSummary, shared verbatim, issue #224) in BOTH real pages at phone and
// desktop width, on invented figures: the tiles (each opens its tab), the Transfer Calculator,
// Groceries and Joint checkpoints as one line with Details expanding to the dashboard's own
// card, Needs attention, FSA & HSA, the This month | Quarter check-in switch, recording a
// decision from a topic and ticking it, notes, and no sideways scroll. Every figure is invented.
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
const START = '// ---- FinSummary (Finances › Overview › Summary, issue #224) — SHARED VERBATIM', END = '// ---- /FinSummary ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
console.log('\nthe wiring');
check('both dashboards carry it, word for word', block(APP).length > 3000 && block(APP) === block(LITE));
check('Summary mounts it, with each dashboard’s own cards behind Details',
  /sub==='summary'&&React\.createElement\(FinSummary,\{apiUrl:apiUrl,apiToken:apiToken,onOpenTab:setSub,\n  transferCard:React\.createElement\(FinanceSummaryTab,\{part:'transfer',/.test(APP) && /checkpointsCard:React\.createElement\(FinanceSummaryTab,\{part:'checkpoints',/.test(APP)
  && /\{activeFinanceTab === 'fin_summary' && <FinSummary apiUrl=\{apiUrl\} apiToken=\{apiToken\} onOpenTab=\{setActiveFinanceTab\}/.test(LITE) && /transferCard=\{<FinSummaryLiteTab apiUrl=\{apiUrl\} apiToken=\{apiToken\} part="transfer" \/>\}/.test(LITE));
check('the bills strip and the budget-health card are gone', APP.indexOf('// ── Bills status strip') === -1 && APP.indexOf('// ── Budget health + bills due this week') === -1);
check('decisions live on the server, the same for both dashboards (nothing kept in the browser)', !/localStorage/.test(block(APP)) && /action:'checkin_decision_save'/.test(block(APP)));

const E = vm.createContext({});
vm.runInContext(APP.slice(APP.indexOf('// ---- BudgetEngine'), APP.indexOf('// ---- /BudgetEngine ----')), E);
E.G = tracker();
const MODEL = vm.runInContext('budgetModel_(G)', E);
const CHECKIN = { ok: true, today: '2026-11-02', quarter: '2026-Q4', month: '2026-11',
  tiles: { netWorth: 800000, planStatus: 'Green: holds even in a weak market', cash: 90000, cashLow: 41500, cashLowWhen: 'Jun 27', floor: 20000,
    spend: { source: 'expected', plan: 3150, actual: null }, goals: { count: 3, done: 1, setAside: 40000, toGo: 25000 } },
  attention: { items: [{ kind: 'bill', title: 'Internet $60', detail: 'due in 2 days', date: '2026-11-04', tab: 'billscash' }, { kind: 'cd', title: 'CD A matures', detail: 'decide whether to roll it over', date: '2026-11-20', tab: 'networth' }], unavailable: ['cards'] },
  health: { fsa: [{ year: 2026, balance: 300, useBy: '2026-12-31', daysLeft: 59, atRisk: 300 }], hsa: { year: 2026, balance: 9000, limit: 8550, room: 1200, put: 7350 } },
  checkin: { since: '2026-Q4 snapshot, taken 2026-10-01',
    changes: [{ key: 'netWorth', label: 'Net worth', now: 800000, prev: 780000, delta: 20000 }, { key: 'cash', label: 'Cash & CDs', now: 90000, prev: 95000, delta: -5000 }, { key: 'planStatus', label: 'Plan status', now: 'Green: holds', prev: 'Green: holds', delta: null }],
    spending: { source: 'expected', categories: [{ name: 'Housing', plan: 4000, actual: null }, { name: 'Utilities', plan: 600, actual: null }] },
    discuss: [{ id: 'fsa:2026', text: 'FSA $300 to use by 2026-12-31', why: '59 days left', tab: 'hsafsa' }, { id: 'scenario:S1', text: 'Rent +$500: Pat +$300, Sam +$200', why: 'a Budget scenario saved this quarter', tab: 'budget' }],
    decisions: [{ id: 'DEC-OLD', quarter: '2026-Q3', text: 'Call the bank', owner: 'Pat', due: '2026-10-15', status: 'open', created: '1' }], notes: 'Last time: the car.' },
  unavailable: {} };
const GROC = { ok: true, ym: '2026-11', today: '2026-11-02', total: 612, budget: 800, byWho: {}, cards: [], runs: [], pace: { spent: 612, budget: 800, left: 188, daysLeft: 28, lastMonthByNow: 540 }, stores: [] };
const BILLS = { ok: true, configured: true, bills: [], cards: [], budgetLines: [], total: 0, timeline: { events: [], windows: [{ window: '1–7', need: 2300, due: 2000 }, { window: '8–20', need: 300, due: 300 }, { window: '21+', need: 0, due: 0 }], undated: [], transferDay: 1, opening: 0, low: null } };
const OLD_TB = { ok: true, configured: true, sharedFixed: [{ name: 'Rent', amount: 2000, paidBy: 'Joint', dueDay: 1 }, { name: 'Internet', amount: 60, paidBy: 'Joint', dueDay: 13 }], sharedNiceToHave: [],
  ahmedFixed: [], ahmedNiceToHave: [], victoriaFixed: [], victoriaNiceToHave: [], ahmedIncome: { gross: 0, net: 0 }, victoriaIncome: { gross: 0, net: 0 },
  summary: { totalShared: 2060, ahmedContribution: 1236, victoriaContribution: 824, ahmedTransferChecking: 1236, victoriaTransferChecking: 824, ahmedTransferSavings: 600, victoriaTransferSavings: 400 } };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const QUICK = !!process.env.FSU_QUICK;
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
      await page.waitForFunction(() => typeof FinSummary === 'function', null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(({ kind, CHECKIN, MODEL, GROC, BILLS, OLD_TB }) => {
        window.__posts = []; window.__opened = [];
        window.apiGet = (u, t, p) => { const a = p && p.action; const c = x => Promise.resolve(JSON.parse(JSON.stringify(x)));
          if (a === 'checkin') return c(CHECKIN); if (a === 'budget_model') return c({ ok: true, configured: true, model: MODEL, categoryMap: {} });
          if (a === 'grocery_month') return c(GROC); if (a === 'bills_schedule') return c(BILLS); if (a === 'budget_tracker') return c(OLD_TB);
          return Promise.resolve({ ok: false }); };
        window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b)));
          if (b.action === 'checkin_decision_save') return Promise.resolve({ ok: true, decision: { id: 'DEC-NEW', quarter: '2026-Q4', text: b.text, owner: b.owner, due: '2027-01-01', status: 'open', topic: b.topic, created: '9' } });
          if (b.action === 'checkin_decision_toggle') return Promise.resolve({ ok: true, decision: { id: b.id, quarter: '2026-Q3', text: 'Call the bank', owner: 'Pat', due: '2026-10-15', status: 'done', doneOn: '2026-11-02', created: '1' } });
          return Promise.resolve({ ok: true }); };
        document.querySelectorAll('#fsprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'fsprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        if (kind === 'lite') {
          // as the lite Finances mounts it (the tab switch is captured)
          const el = React.createElement(FinSummary, { apiUrl: 'https://vera.test/exec', apiToken: 't', onOpenTab: k => window.__opened.push(k), tabId: k => k === 'tax' ? 'tax' : 'fin_' + k,
            transferCard: React.createElement(FinSummaryLiteTab, { apiUrl: 'https://vera.test/exec', apiToken: 't', part: 'transfer' }),
            checkpointsCard: React.createElement(FinSummaryLiteTab, { apiUrl: 'https://vera.test/exec', apiToken: 't', part: 'checkpoints' }),
            groceriesCard: React.createElement(GroceriesCard, { apiUrl: 'https://vera.test/exec', apiToken: 't' }) });
          ReactDOM.createRoot(host).render(el);
        } else {
          ReactDOM.createRoot(host).render(React.createElement(FinancesTab, { summaries: [], budget: [], bills: [], calBills: [], txList: [], financialGoals: [], apiUrl: 'https://vera.test/exec', apiToken: 't', onLoadGoals: () => {} }));
        }
      }, { kind, CHECKIN, MODEL, GROC, BILLS, OLD_TB });
      await wait(600);
      const txt = sel => page.$eval('#fsprobe ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
      const click = sel => page.evaluate(sel => { const n = document.querySelector('#fsprobe ' + sel); if (n) n.click(); return !!n; }, sel);
      const views = await page.$$eval('#fsprobe .fsu-view', ns => ns.map(n => n.textContent + ':' + n.getAttribute('aria-selected')));
      check(L + ': This month | Quarter check-in, opening on This month', views.join() === 'This month:true,Quarter check-in · 2026-Q4:false', views.join());
      const tiles = await page.$$eval('#fsprobe .fsu-tile', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': the tiles: net worth with plan status, cash with the low and floor, spending (expected), goals',
        /^Net worth \$800,000 Plan: Green/.test(tiles[0]) && tiles[1] === 'Cash & CDs $90,000 12-month low $41,500 (Jun 27) · floor $20,000' && /^Spent this month \$3,150 expected · nothing uploaded yet/.test(tiles[2]) && tiles[3] === 'Goals $40,000 set aside 1 of 3 done', JSON.stringify(tiles));
      const sums = await page.$$eval('#fsprobe .fsu-line-sum', ns => ns.map(n => n.textContent));
      check(L + ': one line each: transfers from the Budget, groceries, checkpoints', sums[0] === 'Pat → AMEX Checking $1,690, Savings $600 · Sam → AMEX Checking $650, Savings $400' && sums[1] === '$612 of $800 · $188 left' && sums[2] === 'keep $2,300 from day 1 · keep $300 from day 8', JSON.stringify(sums));
      await page.evaluate(() => document.querySelectorAll('#fsprobe .fsu-details').forEach(b => b.click())); await wait(500);
      const full = await page.$$eval('#fsprobe .fsu-full', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim().slice(0, 120)));
      check(L + ': Details opens the dashboard’s own cards, unchanged', full.length === 3 && (kind === 'lite' ? /Monthly Transfers/.test(full[0]) : /Monthly Transfer Calculator/.test(full[0]))
        && /Groceries · November 2026/.test(full[1]) && (kind === 'lite' ? /Joint Account Balance Checkpoints/i.test(full[2]) : /Minimum Joint Balance Checkpoints/i.test(full[2])), JSON.stringify(full));
      check(L + ': …and only that card (no bills strip, no budget health)', !/due soon/i.test(full.join(' ')) && (kind === 'full' || !/Based on Tracker/.test(full.join(' '))));
      const att = await page.$$eval('#fsprobe .fsu-att', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': Needs attention, soonest first, and what couldn’t be checked', att.length === 2 && /Internet \$60 due in 2 days Nov 4/.test(att[0]) && /CD A matures/.test(att[1]) && /Couldn’t check: card fees\./.test(await txt('.fsu-att-missing')), JSON.stringify(att));
      check(L + ': FSA & HSA', /FSA 2026: \$300 left use by Dec 31 · 59 days/.test(await txt('.fsu-health')) && /HSA 2026: \$7,350 of \$8,550 \$1,200 room left/.test(await txt('.fsu-health')));
      await click('.fsu-tile-networth'); await wait(200);
      if (kind === 'lite') check(L + ': a tile opens its tab', (await page.evaluate(() => window.__opened)).join() === 'fin_networth');
      else { check(L + ': a tile opens its tab', /Net Worth/.test(await page.$eval('#fsprobe .fin-tabs .subtab-btn.active', n => n.textContent).catch(() => ''))); await page.evaluate(() => Array.from(document.querySelectorAll('#fsprobe .fin-group')).find(b => /Overview/.test(b.textContent)).click()); await wait(300); }
      // ---- the check-in ----
      await page.evaluate(() => Array.from(document.querySelectorAll('#fsprobe .fsu-view')).find(b => /check-in/.test(b.textContent)).click()); await wait(200);
      check(L + ': what changed since the snapshot', /since the 2026-Q4 snapshot, taken 2026-10-01/.test(await txt('.fsu-changes')) && /Net worth \$800,000 \+\$20,000/.test(await txt('.fsu-changes')) && /Cash & CDs \$90,000 −\$5,000/.test(await txt('.fsu-changes')));
      check(L + ': spending, labelled expected', /expected: the Budget’s plan, no uploads yet/.test(await txt('.fsu-spending')) && /Housing plan \$4,000 expected/.test(await txt('.fsu-spending')));
      check(L + ': suggested topics, a saved scenario among them', /FSA \$300 to use/.test(await txt('.fsu-discuss')) && /Rent \+\$500: Pat \+\$300, Sam \+\$200/.test(await txt('.fsu-discuss')));
      await page.evaluate(() => document.querySelector('#fsprobe .fsu-record[aria-label^="Record a decision: FSA"]').click()); await wait(150);
      check(L + ': Record a decision opens filled from the topic', await page.$eval('#fsprobe .fsu-f-text', n => n.value).catch(() => '') === 'FSA $300 to use by 2026-12-31' && await page.$eval('#fsprobe .fsu-f-next', n => n.checked));
      check(L + ': …with the shortcuts', /Change a budget line ›/.test(await txt('.fsu-sheet')) && /Adjust a savings goal ›/.test(await txt('.fsu-sheet')));
      await page.evaluate(() => { const s = document.querySelector('#fsprobe .fsu-f-owner'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'Sam'); s.dispatchEvent(new Event('change', { bubbles: true })); });
      await click('.fsu-f-save'); await wait(200);
      let posts = await page.evaluate(() => window.__posts);
      check(L + ': saved: the text, who, next check-in, and the topic', posts[0] && posts[0].action === 'checkin_decision_save' && posts[0].owner === 'Sam' && posts[0].due === 'next check-in' && posts[0].topic === 'fsa:2026', JSON.stringify(posts[0]));
      const decs = await page.$$eval('#fsprobe .fsu-decision', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': …and listed, with last quarter’s open one carried', decs.length === 2 && /^FSA \$300 to use by 2026-12-31 Sam · due Jan 1/.test(decs[0]) && /Call the bank Pat · due Oct 15 · from 2026-Q3/.test(decs[1]), JSON.stringify(decs));
      await page.evaluate(() => document.querySelector('#fsprobe .fsu-tick[aria-label="Done: Call the bank"]').click()); await wait(200);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': ticking a decision done', posts[1] && posts[1].action === 'checkin_decision_toggle' && posts[1].id === 'DEC-OLD' && await page.$('#fsprobe .fsu-decision.done') !== null);
      check(L + ': notes show, and save', await page.$eval('#fsprobe .fsu-notes-text', n => n.value) === 'Last time: the car.');
      await page.evaluate(() => { const t = document.querySelector('#fsprobe .fsu-notes-text'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'We agreed on the FSA.'); t.dispatchEvent(new Event('input', { bubbles: true })); });
      await click('.fsu-notes-save'); await wait(200);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': …to this quarter', posts[2] && posts[2].action === 'checkin_notes_save' && posts[2].quarter === '2026-Q4' && posts[2].notes === 'We agreed on the FSA.');
      check(L + ': buttons big enough to tap', await page.$$eval('#fsprobe .fsu-view, #fsprobe .fsu-record, #fsprobe .fsu-add-decision', ns => ns.every(n => n.getBoundingClientRect().height >= 36)));
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
