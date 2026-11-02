// Finances' grouped navigation (FinNav, shared verbatim, issue #225) in BOTH real pages, at
// phone and desktop width: four groups (Overview, Day to day, Long term, Accounts & paperwork),
// Overview is Summary with no subtab row, a group shows its own subtabs, each group remembers the
// subtab last opened in it (kept in this browser), Day to day has a Groceries subtab with the full
// card, the lite dashboard (no Cards) still groups Accounts · Contracts · Tax, and nothing scrolls
// sideways. Every value here is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const START = '// ---- FinNav (Finances groups, issue #225) — SHARED VERBATIM', END = '// ---- /FinNav ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };

console.log('\nthe shared block');
check('both dashboards carry it, word for word', block(APP).length > 500 && block(APP) === block(LITE));
const C = vm.createContext({ React: { createElement: () => null, useState: v => [v, () => {}], useEffect: () => {} } });
vm.runInContext(block(APP), C);
C.tabs = [{ id: 'fin_hsafsa', label: 'H' }, { id: 'fin_summary', label: 'S' }, { id: 'tax', label: 'T' }, { id: 'fin_accounts', label: 'A' }, { id: 'fin_groceries', label: 'G' }, { id: 'fin_budget', label: 'B' }];
const gs = vm.runInContext('finGroupsFor_(tabs)', C);
check('groups keep their order, subtabs in group order, lite ids matched without fin_, empty groups hidden',
  gs.map(g => g.id + ':' + g.tabs.map(t => t.id).join('+')).join(' ') === 'overview:fin_summary day:fin_budget+fin_groceries long:fin_hsafsa paper:fin_accounts+tax', JSON.stringify(gs));
check('a group with nothing on offer is hidden',
  vm.runInContext('finGroupsFor_([{id:"summary",label:"S"},{id:"tax",label:"T"}]).map(function(g){return g.id;}).join()', C) === 'overview,paper');
check('every old subtab id lands in its group; an unknown one in none',
  [['summary', 'overview'], ['fin_summary', 'overview'], ['budget', 'day'], ['fin_bills', 'day'], ['cashflow', 'day'], ['groceries', 'day'],
   ['networth', 'long'], ['fin_goals', 'long'], ['planned', 'long'], ['hsafsa', 'long'], ['accounts', 'paper'], ['cards', 'paper'], ['fin_contracts', 'paper'], ['tax', 'paper'], ['nope', '']]
    .every(([id, g]) => vm.runInContext('finGroupOf_(' + JSON.stringify(id) + ')', C) === g));
const appIds = (APP.match(/const subTabs=\[\{id:'summary'[^\n]*?\];/) || [''])[0].match(/id:'(\w+)'/g) || [];
const liteIds = (LITE.match(/const FINANCE_TABS = \[[\s\S]*?\];/) || [''])[0].match(/id: '(\w+)'/g) || [];
check('every Finances subtab in both dashboards is in a group',
  appIds.length === 13 && liteIds.length === 12
  && appIds.concat(liteIds).every(x => vm.runInContext('finGroupOf_(' + JSON.stringify(x.replace(/^id: ?'|'$/g, '')) + ')', C) !== ''), appIds.length + ' ' + liteIds.length);
check('both dashboards mount the full Groceries card on its own subtab, and keep it on Summary',
  APP.indexOf("sub==='groceries'&&React.createElement(GroceriesCard,{apiUrl:apiUrl,apiToken:apiToken})") !== -1
  && LITE.indexOf("{activeFinanceTab === 'fin_groceries' && <GroceriesCard apiUrl={apiUrl} apiToken={apiToken} />}") !== -1
  && LITE.indexOf("{activeFinanceTab === 'fin_summary' && <GroceriesCard apiUrl={apiUrl} apiToken={apiToken} />}") !== -1);
check('the lite Finances uses FinNav', LITE.indexOf('<FinNav tabs={FINANCE_TABS} sub={activeFinanceTab} onPick={setActiveFinanceTab} />') !== -1);

const MONTH = { ok: true, ym: '2026-11', today: '2026-11-20', total: 612, budget: 800,
  byWho: { Ahmed: { total: 389, runs: 4 }, Victoria: { total: 223, runs: 3 } },
  cards: [{ card: 'Gold Card', total: 389, earned: 'about 1,556 points at 4x' }],
  runs: [{ id: 'GR-1', date: '2026-11-20', store: 'Store A', who: 'Ahmed', card: 'Gold Card', total: 74.35, source: 'receipt', counted: 'all' }],
  pace: { spent: 612, budget: 800, left: 188, daysLeft: 10, lastMonthByNow: 540 },
  stores: [{ store: 'Store A', counts: true }] };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const QUICK = !!process.env.FIN_QUICK;
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
      await page.waitForFunction(() => typeof FinNav === 'function', null, { timeout: 15000 }).catch(() => {});
      const mount = () => page.evaluate(({ kind, MONTH }) => {
        window.apiGet = (u, t, p) => Promise.resolve(p && p.action === 'grocery_month' ? JSON.parse(JSON.stringify(MONTH)) : { ok: false });
        window.apiPost = () => Promise.resolve({ ok: true });
        document.querySelectorAll('#finprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'finprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        if (kind === 'lite') {
          // The lite Finances lives inside its App; this probe is FinNav over the lite's own tab list,
          // switching what the App switches (the mounts are checked in the source above).
          const Probe = () => { const [s, setS] = React.useState('fin_summary');
            return React.createElement('div', null, React.createElement(FinNav, { tabs: FINANCE_TABS, sub: s, onPick: setS }),
              React.createElement('div', { className: 'fin-probe-sub' }, s), s === 'fin_groceries' ? React.createElement(GroceriesCard, { apiUrl: 'https://vera.test/exec', apiToken: 't' }) : null); };
          ReactDOM.createRoot(host).render(React.createElement(Probe));
        } else {
          ReactDOM.createRoot(host).render(React.createElement(FinancesTab, { summaries: [], budget: [], bills: [], calBills: [], txList: [], financialGoals: [],
            apiUrl: 'https://vera.test/exec', apiToken: 't', onLoadGoals: () => {} }));
        }
      }, { kind, MONTH });
      await page.evaluate(() => { try { localStorage.removeItem('vera_fin_last'); } catch (e) {} });
      await mount(); await wait(400);
      const state = () => page.evaluate(() => {
        const host = document.getElementById('finprobe');
        return { groups: Array.from(host.querySelectorAll('.fin-group')).map(b => b.innerText.replace(/\s+/g, ' ').trim()),
          on: (host.querySelector('.fin-group.on') || {}).innerText || '',
          tabs: Array.from(host.querySelectorAll('.fin-tabs .subtab-btn')).map(b => b.textContent),
          active: (host.querySelector('.fin-tabs .subtab-btn.active') || {}).textContent || '', text: host.innerText };
      });
      const click = (sel, txt) => page.evaluate(({ sel, txt }) => { const b = Array.from(document.querySelectorAll('#finprobe ' + sel)).find(x => x.textContent.indexOf(txt) !== -1); if (b) b.click(); return !!b; }, { sel, txt });
      let s = await state();
      check(L + ': four groups, each with what it is for', s.groups.join('|') === 'Overview where we stand|Day to day this month|Long term building toward|Accounts & paperwork set up once', JSON.stringify(s.groups));
      check(L + ': it opens on Overview, with no subtab row', /Overview/.test(s.on) && s.tabs.length === 0, JSON.stringify(s.tabs));
      await click('.fin-group', 'Day to day'); await wait(200);
      s = await state();
      check(L + ': Day to day: Budget · Bills · Cashflow · Groceries, Budget first', /Day to day/.test(s.on) && /Budget/.test(s.active)
        && s.tabs.map(t => t.replace(/^\S+\s/, '')).join('|') === 'Budget|Bills|Cashflow|Groceries', JSON.stringify(s.tabs));
      await click('.fin-tabs .subtab-btn', 'Groceries'); await wait(400);
      s = await state();
      check(L + ': Groceries opens the full card', /Groceries/.test(s.active) && /Groceries · November 2026/.test(s.text) && /Store A/.test(s.text), s.text.slice(0, 300));
      await click('.fin-group', 'Long term'); await wait(200);
      s = await state();
      check(L + ': Long term: Net Worth · Goals · Planned Purchases · FSA & HSA', s.tabs.map(t => t.replace(/^\S+\s/, '')).join('|') === 'Net Worth|Goals|Planned Purchases|FSA & HSA', JSON.stringify(s.tabs));
      await click('.fin-group', 'Accounts'); await wait(200);
      s = await state();
      check(L + ': Accounts & paperwork: ' + (kind === 'lite' ? 'Accounts · Contracts · Tax (no Cards here)' : 'Accounts · Cards · Contracts · Tax'),
        s.tabs.map(t => t.replace(/^\S+\s/, '')).join('|') === (kind === 'lite' ? 'Accounts|Contracts|Tax' : 'Accounts|Cards|Contracts|Tax'), JSON.stringify(s.tabs));
      await click('.fin-tabs .subtab-btn', 'Contracts'); await wait(150);
      await click('.fin-group', 'Day to day'); await wait(200);
      s = await state();
      check(L + ': back in Day to day, Groceries again', /Groceries/.test(s.active), s.active);
      await click('.fin-group', 'Accounts'); await wait(200);
      check(L + ': and Accounts & paperwork remembers Contracts', /Contracts/.test((await state()).active));
      await click('.fin-group', 'Overview'); await wait(200);
      s = await state();
      check(L + ': Overview again: no subtab row', /Overview/.test(s.on) && s.tabs.length === 0);
      // the memory is kept in this browser: a fresh mount still knows each group's last subtab
      await mount(); await wait(300);
      await click('.fin-group', 'Day to day'); await wait(200);
      check(L + ': after a reload, Day to day still opens on Groceries', /Groceries/.test((await state()).active), (await state()).active);
      check(L + ': the group buttons are big enough to tap', await page.$$eval('#finprobe .fin-group', ns => ns.every(n => n.getBoundingClientRect().height >= 44)));
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
