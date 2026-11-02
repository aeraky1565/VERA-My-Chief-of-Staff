// Finances › Goals from the planner, rendered in BOTH dashboards at phone and desktop
// width: the summary tiles, each kind of goal (yearly budget with its years, a one-off
// ready from the house plan, a reserve with the cash low), shares of the target, the
// filters, the link to the planner, and the not-set-up / unavailable states. Invented data.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;
const APP = fs.readFileSync(path.resolve(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); return i === -1 || j === -1 ? null : s.slice(i, j); };
const A = '// ---- PlannerGoalsTab (Finances', B = '// ---- end PlannerGoalsTab ----';
console.log('\nthe shared block');
check('both dashboards carry the Goals block, word for word', !!cut(APP, A, B) && cut(APP, A, B) === cut(LITE, A, B));
check('Ahmed\'s Finances › Goals shows it', /sub==='goals'&&React\.createElement\(PlannerGoalsTab,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
check('Victoria\'s Finances › Goals shows it too', /activeFinanceTab === 'fin_goals' +&& <PlannerGoalsTab +apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>/.test(LITE));

const DATA = { ok: true, configured: true, status: 'ok', calculated: 'Nov 1, 2026', asOf: '2026-09-20', plansAvailable: true,
  plannerUrl: 'https://docs.google.com/spreadsheets/d/SHEET/edit',
  summary: { count: 3, done: 2, setAside: 102000, toGo: 3500 },
  goals: [
    { name: 'Trips Fund', kind: 'yearly', priority: 'want', status: 'active', state: 'active', saved: 0, target: 8000, shares: [{ who: 'Pat', amount: 4000 }, { who: 'Sam', amount: 4000 }],
      years: [{ year: 2026, planned: 4500, left: 3500, next: { item: 'Beach week', month: '2026-12' }, items: [{ item: 'Spring trip', month: '2026-03', amount: 1500, confidence: 'committed', past: true }, { item: 'Beach week', month: '2026-12', amount: 3000, confidence: 'committed', past: false }] },
              { year: 2027, planned: 9500, left: -1500, next: { item: 'Ski trip', month: '2027-01' }, items: [{ item: 'Ski trip', month: '2027-01', amount: 9500, confidence: 'likely', past: false }] }] },
    { name: 'Home Deposit', kind: 'one-off', priority: 'want', status: 'active', state: 'ready', saved: 90000, target: 85000, pct: 106, targetFrom: 'house', month: '2027-05',
      houseLine: { price: 400000, downPct: 20, extra: 5000, month: '2027-05' }, shares: [{ who: 'Pat', amount: 40000 }, { who: 'Sam', amount: 40000 }] },
    { name: 'Rainy Day', kind: 'reserve', priority: 'must', status: 'achieved', state: 'reached', saved: 12000, target: 12000, pct: 100,
      cashLow: { amount: 41500, when: 'Jun 27', floor: 20000 }, shares: [{ who: 'Pat', amount: 7000 }, { who: 'Sam', amount: 5000 }] }] };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8') };
  for (const kind of ['full', 'lite']) {
    for (const width of [390, 1280]) {
      const L = kind + ' ' + width;
      console.log('\n' + kind + ' dashboard @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errs = []; page.on('pageerror', e => errs.push(e.message));
      if (kind === 'lite') {
        await page.route('**/*', r => { const u = r.request().url();
          for (const n of Object.keys(vendor)) if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
          if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: LITE });
          return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' }); });
        await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof PlannerGoalsTab === 'function', null, { timeout: 15000 }).catch(() => {});
      const mount = reply => page.evaluate(reply => {
        window.__calls = [];
        window.apiGet = (u, t, p) => { window.__calls.push(p); return reply && reply.__throw ? Promise.reject(new Error(reply.__throw)) : Promise.resolve(JSON.parse(JSON.stringify(reply))); };
        document.querySelectorAll('#pgprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'pgprobe'; host.style.padding = '0 16px'; document.body.prepend(host);
        ReactDOM.createRoot(host).render(React.createElement(PlannerGoalsTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
      }, reply);
      const txt = s => page.$eval('#pgprobe ' + s, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => null);
      const all = s => page.$$eval('#pgprobe ' + s, ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      const click = async (s, re) => { await page.evaluate(({ s, re }) => { const b = [...document.querySelectorAll('#pgprobe ' + s)].filter(n => !re || new RegExp(re).test(n.textContent))[0]; if (b) b.click(); }, { s, re }); await page.waitForTimeout(120); };

      await mount(DATA); await page.waitForTimeout(250);
      check(L + ': it asks for the planner\'s goals', JSON.stringify(await page.evaluate(() => window.__calls)) === '[{"action":"planner_goals"}]');
      check(L + ': when the planner calculated, and the balances date', (await txt('.pg-asof')) === 'Calculated Nov 1, 2026 · balances as of Sep 20', await txt('.pg-asof'));
      check(L + ': the tiles: set aside, done, still to go', (await all('.pg-tile')).join(' | ') === 'SET ASIDE $102,000 | DONE 2 of 3 | STILL TO GO $3,500', (await all('.pg-tile')).join(' | '));
      check(L + ': goals in the order the server sent', (await all('.pg-name')).join('|') === 'Trips Fund|Home Deposit|Rainy Day');
      const badges = await all('.pg-badge');
      check(L + ': each badge: left, ready, reached', badges.join('|') === '$3,500 LEFT|READY|REACHED', badges.join('|'));
      const trip = await txt('.pg-goal[aria-label="Trips Fund"]');
      check(L + ': a yearly budget: planned of the budget for this year', /\$4,500 planned of \$8,000 for 2026/.test(trip) && /\$3,500 left · next: Beach week in Dec/.test(trip), trip);
      check(L + ': …each trip with its month and how sure', /Spring trip Mar 2026 · committed \$1,500/.test(trip) && /Beach week Dec 2026 · committed \$3,000/.test(trip));
      check(L + ': …a trip already past is dimmed', await page.$eval('#pgprobe .pg-goal[aria-label="Trips Fund"] .pg-item', n => n.style.opacity) === '0.6');
      check(L + ': …kind and priority as chips', /Yearly budget Want/.test(trip));
      await click('.pg-goal[aria-label="Trips Fund"] .pg-year', '2027');
      const t27 = await txt('.pg-goal[aria-label="Trips Fund"]');
      check(L + ': next year: its own trips, and over budget says so', /\$9,500 planned of \$8,000 for 2027/.test(t27) && /\$1,500 over · next: Ski trip in Jan/.test(t27) && !/Beach week/.test(t27), t27);
      check(L + ': …the badge stays on this year', (await all('.pg-badge'))[0] === '$3,500 LEFT');
      const home = await txt('.pg-goal[aria-label="Home Deposit"]');
      check(L + ': the house goal: saved of the house-plan target', /\$90,000 of \$85,000 · 106%/.test(home), home);
      check(L + ': …the house line, with closing costs and what\'s over', /20% down on a \$400,000 house in May 2027, plus \$5,000 closing costs · \$5,000 more than it needs\./.test(home), home);
      check(L + ': …marked as from the house plan', /House plan/.test(home) && /The target follows the house plan/.test(home));
      const rd = await txt('.pg-goal[aria-label="Rainy Day"]');
      check(L + ': a reserve: kept, and the cash low against the floor', /\$12,000 of \$12,000 · 100% · kept, not spent/.test(rd) && /bottom out at \$41,500 on Jun 27, above your \$20,000 floor\./.test(rd), rd);
      check(L + ': …must is its own chip', /Reserve Must/.test(rd));
      const sh = await all('.pg-goal[aria-label="Rainy Day"] .pg-share');
      check(L + ': shares are shares of the target', sh.join('|') === 'PAT’S SHARE OF TARGET $7,000|SAM’S SHARE $5,000' || sh.join('|') === 'Pat’s share of target $7,000|Sam’s share $5,000', sh.join('|'));
      await click('.pg-filter[data-filter="active"]');
      check(L + ': In progress shows only what isn\'t done', (await all('.pg-name')).join('|') === 'Trips Fund');
      await click('.pg-filter[data-filter="done"]');
      check(L + ': Reached or ready shows the rest', (await all('.pg-name')).join('|') === 'Home Deposit|Rainy Day');
      await click('.pg-filter[data-filter="all"]');
      check(L + ': it links to the planner, in a new tab', await page.$eval('#pgprobe .pg-open', a => a.href === 'https://docs.google.com/spreadsheets/d/SHEET/edit' && a.target === '_blank'));
      check(L + ': nothing to add or edit here', !(await page.$('#pgprobe input, #pgprobe select, #pgprobe textarea')));
      if (width === 390) check(L + ': no sideways scroll at phone width', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

      await mount({ ok: true, configured: false }); await page.waitForTimeout(150);
      check(L + ': not set up says how', /planner_sheet_id/.test(await txt('.pg-setup') || ''));
      await mount({ ok: true, configured: true, status: 'unavailable', reason: 'the Goals tab has no saved or kept column' }); await page.waitForTimeout(150);
      check(L + ': unavailable says why, and shows no numbers', /Goals are unavailable: the Goals tab has no saved or kept column\./.test(await txt('.pg-unavailable') || '') && !(await page.$('#pgprobe .pg-tile')));
      await mount({ __throw: 'timeout' }); await page.waitForTimeout(150);
      check(L + ': a failed read says so', /Couldn’t read the planner: timeout/.test(await txt('.pg-error') || ''));
      await mount(Object.assign({}, DATA, { goals: [], summary: { count: 0, done: 0, setAside: 0, toGo: 0 } })); await page.waitForTimeout(150);
      check(L + ': no goals yet says so', /has no goals yet/.test(await txt('.pg-empty') || ''));
      const np = JSON.parse(JSON.stringify(DATA)); np.plansAvailable = false;
      await mount(np); await page.waitForTimeout(150);
      check(L + ': unreadable Plan items is said, not shown as nothing planned', /Plan items couldn’t be read/.test(await txt('.pg-goal[aria-label="Trips Fund"]') || ''));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
