// Finances › Budget (BudgetTab, shared verbatim, issue #226) in BOTH real pages at phone
// and desktop width, on an invented tracker: the person and shared cards open collapsed to
// their group and category summaries, expand to every line and remember it, the summary sits
// beside the tracker's figures with the expected difference named, What if reruns the sums
// live and marks the changed category, Reset, saving / opening / deleting a scenario, and no
// sideways scroll. Every name and figure is invented.
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
      const mount = () => page.evaluate(PAYLOAD => {
        window.__posts = [];
        window.apiGet = (u, t, p) => Promise.resolve(p && p.action === 'budget_model' ? JSON.parse(JSON.stringify(PAYLOAD)) : { ok: false });
        window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b)));
          if (b.action === 'budget_scenario_save') return Promise.resolve({ ok: true, scenario: { id: 'BGS-NEW', name: b.name, changes: b.changes, results: { totalShared: 3650 }, quarter: '2026-Q4' } });
          return Promise.resolve({ ok: true }); };
        document.querySelectorAll('#bgprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'bgprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        ReactDOM.createRoot(host).render(React.createElement(BudgetTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
      }, PAYLOAD);
      await page.evaluate(() => { try { localStorage.removeItem('vera_budget_open'); } catch (e) {} });
      await mount(); await wait(400);
      const txt = sel => page.$eval('#bgprobe ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
      const head = id => page.$eval('#bgprobe .bg-card-' + id + ' .bg-card-head', n => n.getAttribute('aria-expanded')).catch(() => null);
      const click = sel => page.evaluate(sel => { const n = document.querySelector('#bgprobe ' + sel); if (n) n.click(); return !!n; }, sel);
      const fill = (sel, v) => page.evaluate(({ sel, v }) => { const n = document.querySelector('#bgprobe ' + sel); if (!n) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); return true; }, { sel, v });
      const clickHead = id => click('.bg-card-' + id + ' .bg-card-head');

      const heads = await page.$$eval('#bgprobe .bg-card-head', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': Pat personal, Sam personal and Shared expenses, all collapsed', heads.length === 3 && /^Pat personal/.test(heads[0]) && /^Sam personal/.test(heads[1]) && /^Shared expenses/.test(heads[2])
        && (await head('pat')) === 'false' && (await head('shared')) === 'false', JSON.stringify(heads));
      let pat = await txt('.bg-card-pat');
      check(L + ': a person collapsed: net income, groups, disposable', /\$7,000 net/.test(pat) && /Net income \$7,000/.test(pat) && /Fixed \$150/.test(pat) && /Nice to have \$50/.test(pat) && /Contributions \$2,790/.test(pat) && /Disposable \$4,010/.test(pat), pat);
      check(L + ': …with the thin bar, and no lines yet', await page.$('#bgprobe .bg-card-pat .bg-bar') !== null && !/Car Insurance/.test(pat));
      let sh = await txt('.bg-card-shared');
      check(L + ': shared collapsed: totals by category, in order', /Housing Joint \$2,000 \$2,000 Utilities Joint \$300 \$300 Health Pat \$100 \$100 Household Sam \$600 Pat \$100 \$700/.test(sh), sh);
      check(L + ': …a line with no category is under Other, named', /Other\s*no category yet/.test(sh) && /Not in a category yet: Dog Walker/.test(sh));
      check(L + ': …and the total shared', /Total shared \$3,150\.00/.test(sh));
      await clickHead('shared'); await wait(150);
      sh = await txt('.bg-card-shared');
      check(L + ': expanded: every line, with account and due day', (await head('shared')) === 'true' && /Rent Joint · due 1st \$2,000\.00/.test(sh) && /Family Plan Credit Joint \$-?−?\$?50\.00|Family Plan Credit Joint −\$50\.00/.test(sh) && /Dog Walker Joint · nice to have \$40\.00/.test(sh), sh.slice(0, 400));
      check(L + ': …the tracker’s What If rows left out', !/New Rent Delta/.test(sh) && /What If rows are left out/.test(sh));
      await mount(); await wait(300);
      check(L + ': open or closed is remembered', (await head('shared')) === 'true' && (await head('pat')) === 'false');
      await clickHead('pat'); await wait(150);
      pat = await txt('.bg-card-pat');
      check(L + ': a person expanded: income, deductions, net from gross − deductions', /Gross income \$10,000\.00/.test(pat) && /Federal Withholding deduction −\$1,500\.00/.test(pat) && /Net income gross − deductions; the tracker types \$7,200\.00 \$7,000\.00/.test(pat), pat.slice(0, 400));
      check(L + ': …fixed, nice to have, contributions', /Car Insurance - Pat \$100\.00/.test(pat) && /Gym \$40\.00/.test(pat) && /Shared expenses 60% of \$3,150\.00 \$1,890\.00/.test(pat) && /Disposable \$4,010\.00/.test(pat));
      await clickHead('pat'); await wait(100);
      const sum = await txt('.bg-card-summary');
      check(L + ': transfers: share − own cards', /PAT · 60% → AMEX Checking \$1,690\.00 \$1,890\.00 share − \$200\.00 on own cards → AMEX Savings \$600\.00/.test(sum), sum.slice(0, 300));
      const rows = await page.$$eval('#bgprobe .bg-match-row', ns => ns.map(n => n.className.split(' ')[1] + ':' + n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': the match check: ✓ tracker on every figure but one', rows.filter(r => /^ok:.*✓ tracker$/.test(r)).length === rows.length - 4, JSON.stringify(rows));
      check(L + ': …the net income difference named, and what follows it', rows.some(r => /^diff:Pat’s net income \$7,000\.00 tracker \$7,200\.00 · −\$200\.00 · gross − deductions; the tracker types it/.test(r))
        && rows.some(r => /^diff:Pat’s disposable income .* · follows net income/.test(r)));
      check(L + ': emergency fund by months', /3 \$9,150 \$5,490 \/ \$3,660 \$4,575/.test(sum), sum.slice(-400));
      // ---- What if ----
      await click('.bg-whatif-toggle'); await wait(150);
      check(L + ': What if on: an input on every shared line, shared savings and the split', (await page.$$('#bgprobe .bg-card-shared .bg-input')).length === 11 && await page.$('#bgprobe .bg-split-range') !== null && /Change any amount/.test(await txt('.bg-whatif-bar')));
      await fill('.bg-card-shared input[aria-label="Rent"]', '2500'); await wait(150);
      let bar = await txt('.bg-whatif-bar');
      check(L + ': a change reruns the transfers live', /Pat → Checking \$1,990 \+\$300\.00/.test(bar) && /Sam → Checking \$850 \+\$200\.00/.test(bar) && /Shared \$3,650 \+\$500\.00/.test(bar), bar);
      await clickHead('shared'); await wait(150);
      check(L + ': collapsed, the changed category is marked', await page.$eval('#bgprobe .bg-card-shared', n => !!n.querySelector('.bg-cat.bg-changed') && n.querySelector('.bg-cat.bg-changed').innerText.indexOf('Housing') === 0 && /changed/.test(n.querySelector('.bg-card-head').innerText)));
      check(L + ': …and the people’s contributions group too', await page.$('#bgprobe .bg-card-pat .bg-group-contrib.bg-changed') !== null);
      await page.evaluate(() => { const r = document.querySelector('#bgprobe .bg-split-range'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '50'); r.dispatchEvent(new Event('input', { bubbles: true })); });
      await wait(150);
      bar = await txt('.bg-whatif-bar');
      check(L + ': the split slider reruns them too', /Pat → Checking \$1,625/.test(bar) && /Sam → Checking \$1,215/.test(bar), bar);
      await click('.bg-reset'); await wait(150);
      check(L + ': Reset clears it', /Change any amount/.test(await txt('.bg-whatif-bar')) && await page.$('#bgprobe .bg-changed') === null);
      await clickHead('pat'); await wait(100);
      await fill('.bg-card-pat input[aria-label="Personal savings"]', '500');
      await wait(100);
      await fill('.bg-scenario-name', 'Save more'); await click('.bg-save'); await wait(200);
      const posts = await page.evaluate(() => window.__posts);
      check(L + ': Save as scenario sends the name and only what changed', posts.length === 1 && posts[0].action === 'budget_scenario_save' && posts[0].name === 'Save more' && JSON.stringify(posts[0].changes) === '{"pat.psave":500}', JSON.stringify(posts));
      check(L + ': …and it shows in the list', /Saved “Save more”/.test(await txt('.bg-msg')) && /Save more 2026-Q4/.test(await txt('.bg-scenarios')));
      await click('.bg-whatif-toggle'); await wait(100);
      await page.evaluate(() => Array.from(document.querySelectorAll('#bgprobe .bg-scenario')).find(n => /Cheaper flat/.test(n.innerText)).querySelector('.bg-scenario-open').click()); await wait(150);
      bar = await txt('.bg-whatif-bar');
      check(L + ': Open in What if loads a saved scenario', /Shared \$2,950 −\$200\.00/.test(bar), bar);
      await page.evaluate(() => Array.from(document.querySelectorAll('#bgprobe .bg-scenario')).find(n => /Cheaper flat/.test(n.innerText)).querySelector('.bg-scenario-del').click()); await wait(100);
      check(L + ': delete asks once more first', (await page.evaluate(() => window.__posts.length)) === 1 && await page.$('#bgprobe .bg-scenario-del-yes') !== null);
      await click('.bg-scenario-del-yes'); await wait(150);
      check(L + ': …then deletes it', (await page.evaluate(() => window.__posts[1] && window.__posts[1].action + ':' + window.__posts[1].id)) === 'budget_scenario_delete:BGS-OLD' && !/Cheaper flat/.test(await txt('.bg-scenarios')));
      check(L + ': card headers are big enough to tap', await page.$$eval('#bgprobe .bg-card-head', ns => ns.every(n => n.getBoundingClientRect().height >= 44)));
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      // an unreadable tracker says why
      await page.evaluate(() => { window.apiGet = () => Promise.resolve({ ok: true, configured: true, unavailable: true, error: 'The tracker has no “Shared Expenses” heading.' }); document.querySelectorAll('#bgprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'bgprobe'; document.body.prepend(host); ReactDOM.createRoot(host).render(React.createElement(BudgetTab, { apiUrl: 'u', apiToken: 't' })); });
      await wait(200);
      check(L + ': an unreadable tracker says why', /no “Shared Expenses” heading/.test(await txt('.bg-unavailable')));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
