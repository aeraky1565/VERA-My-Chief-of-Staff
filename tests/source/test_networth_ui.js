// Drives the REAL Net Worth tab (issue #126) in BOTH real pages, at phone and desktop
// widths, over a stubbed `net_worth` payload. Every figure is invented.
//
// What is asserted is behaviour you'd see: the two figures and which one follows the
// filter, the slicer regrouping and refiltering, the CD list hiding under a filter
// that excludes CDs, the stale badge flipping after 60 days and not at 60, the setup
// message, and an unavailable section saying so instead of showing a number.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// Mounts NetWorthTab over a fixture built IN the browser (so dates use its clock),
// with `ageDays` setting how old the balances are and `tweak` editing the payload.
async function mount(page, ageDays, tweak) {
  return page.evaluate(([ageDays, tweak]) => {
    document.querySelectorAll('#nwprobe').forEach(n => n.remove());
    const host = document.createElement('div'); host.id = 'nwprobe'; document.body.appendChild(host);
    const p2 = n => String(n).padStart(2, '0');
    const iso = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const day = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };
    const row = (key, label, owner, amount, cls, tax) => ({ key, label, owner, amount, cls, tax });
    const fx = {
      ok: true, configured: true, staleAfterDays: 60,
      planner:  { status: 'ok', value: 736900, note: 'Excludes home equity and 529s.' },
      asOf:     { status: 'ok', iso: day(-ageDays) },
      balances: { status: 'ok', owners: ['Ahmed', 'Victoria', 'Joint'], unmapped: [], rows: [
        row('chk',    'Checking',     'Ahmed', 6000, 'Cash', 'Taxable'), row('chk', 'Checking', 'Victoria', 2000, 'Cash', 'Taxable'),
        row('chk',    'Checking',     'Joint', 4000, 'Cash', 'Taxable'),
        row('cds',    'CDs',          'Ahmed', 25000, 'CDs', 'Taxable'), row('cds', 'CDs', 'Victoria', 0, 'CDs', 'Taxable'),
        row('cds',    'CDs',          'Joint', 0, 'CDs', 'Taxable'),
        row('retire', '401(k) / IRA', 'Ahmed', 188000, 'Retirement', 'Pre-tax'), row('retire', '401(k) / IRA', 'Victoria', 152000, 'Retirement', 'Pre-tax'),
        row('retire', '401(k) / IRA', 'Joint', 0, 'Retirement', 'Pre-tax'),
      ] },
      cds: { status: 'ok', items: [
        { name: 'Example 12-month CD', owner: 'Ahmed', amount: 15000, apy: 3.9, matures: day(24), bucketKey: 'cds', cls: 'CDs', tax: 'Taxable' },
        { name: 'Example 18-month CD', owner: 'Ahmed', amount: 10000, apy: 4.0, matures: day(190), bucketKey: 'cds', cls: 'CDs', tax: 'Taxable' },
      ] },
      rsus:  { status: 'ok', items: [{ month: day(150).slice(0, 7), value: 3100 }] },
      plans: { status: 'ok', items: [{ item: 'Weekend away', month: day(30).slice(0, 7), amount: 2500, category: 'Trip', confidence: 'committed', canDefer: false }] },
    };
    if (tweak === 'unconfigured') { for (const k of Object.keys(fx)) delete fx[k]; fx.ok = true; fx.configured = false; }
    if (tweak === 'noPlanner') fx.planner = { status: 'unavailable', reason: 'couldn’t find "Net worth" in Outputs' };
    window.__nwCalls = [];
    window.apiGet = function(url, token, params) {
      window.__nwCalls.push(params.action);
      return Promise.resolve(fx);
    };
    ReactDOM.createRoot(host).render(React.createElement(NetWorthTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
    return new Promise(r => setTimeout(r, 300));
  }, [ageDays, tweak || '']);
}

const text  = page => page.$eval('#nwprobe', n => n.innerText);
const bars  = page => page.$$eval('#nwprobe .nw-bar', ns => ns.map(n => n.getAttribute('data-group') + '=' + n.querySelector('.nw-bar-amount').textContent));
const total = page => page.$eval('#nwprobe .nw-total-amount', n => n.textContent);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const liteHtml = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };

  for (const [label, kind] of [['full dashboard', 'full'], ['dashboard-lite', 'lite']]) {
    for (const width of [390, 1280]) {
      console.log('\n' + label + ' @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1600 } });
      if (kind === 'lite') {
        await page.route('**/*', r => {
          const u = r.request().url();
          for (const n of Object.keys(vendor)) {
            if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
          }
          if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: liteHtml });
          return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
        });
        await page.addInitScript(() => {
          localStorage.setItem('vera_url', 'https://vera.test/exec');
          localStorage.setItem('vera_token', 't');
        });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else {
        await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      }

      check('NetWorthTab is defined on the page', await page.evaluate(() => typeof NetWorthTab === 'function'));

      // ---- default view ----
      await mount(page, 18);
      let t = await text(page);
      check('it asked for net_worth', (await page.evaluate(() => window.__nwCalls)).join(',') === 'net_worth');
      check('planner figure shown', /\$736,900/.test(t), t.slice(0, 160));
      check('opens grouped by Owner, no filter',
            (await page.$eval('#nwprobe .nw-groupby', n => n.value)) === 'owner' &&
            (await page.$eval('#nwprobe .nw-filter', n => n.value)) === 'all');
      check('owner bars, Joint its own owner', JSON.stringify(await bars(page)) ===
            JSON.stringify(['Ahmed=$219,000', 'Victoria=$154,000', 'Joint=$4,000']), JSON.stringify(await bars(page)));
      check('total is the household sum', (await total(page)) === '$377,000', await total(page));
      check('both figures say Household with no filter', (t.match(/HOUSEHOLD/gi) || []).length >= 2);
      check('balances age shown, not stale', /Balances as of/.test(t) && /18 days old/.test(t) && !/Stale/.test(t));
      check('the CD inside 30 days carries the flag chip', /VERA flag · 24 days/.test(t), t.match(/VERA flag[^\n]*/));

      // ---- regroup, then filter on a different dimension ----
      await page.selectOption('#nwprobe .nw-groupby', 'cls');
      check('group by Asset class', JSON.stringify(await bars(page)) ===
            JSON.stringify(['Cash=$12,000', 'CDs=$25,000', 'Retirement=$340,000']), JSON.stringify(await bars(page)));
      await page.selectOption('#nwprobe .nw-filter', 'cls:Retirement');
      t = await text(page);
      check('filtered to Retirement: the total narrows', (await total(page)) === '$340,000', await total(page));
      check('…the planner figure does not', /\$736,900/.test(t));
      check('…and the CDs are hidden, with the reason', /Hidden: no CDs fall under Asset class = Retirement/.test(t),
            t.match(/Hidden[^\n]*/));
      check('RSUs and planned spends stay visible', /Pays out/.test(t) && /Weekend away/.test(t));

      await page.selectOption('#nwprobe .nw-groupby', 'owner');
      check('Retirement by owner', JSON.stringify(await bars(page)) ===
            JSON.stringify(['Ahmed=$188,000', 'Victoria=$152,000']), JSON.stringify(await bars(page)));
      await page.selectOption('#nwprobe .nw-filter', 'tax:Taxable');
      t = await text(page);
      check('filtered to Taxable: the CDs come back', /Example 12-month CD/.test(t) && !/Hidden: no CDs/.test(t));
      await page.selectOption('#nwprobe .nw-filter', 'owner:Victoria');
      t = await text(page);
      check('filtered to Victoria: her CDs only (she has none here)', /Hidden: no CDs fall under Owner = Victoria/.test(t));
      check('…and the Balances total is hers alone, Joint not included', (await total(page)) === '$154,000', await total(page));

      // ---- the stale badge flips AFTER 60 days ----
      await mount(page, 60);
      check('60 days old: not stale', !/Stale/.test(await text(page)));
      await mount(page, 61);
      check('61 days old: stale badge', /Stale · 61 days old/.test(await text(page)));

      // ---- not set up / a section unavailable ----
      await mount(page, 18, 'unconfigured');
      check('no planner_sheet_id: the setup line', /planner_sheet_id/.test(await text(page)));
      await mount(page, 18, 'noPlanner');
      t = await text(page);
      check('planner label missing: "Unavailable" and no figure', /Unavailable: couldn’t find "Net worth" in Outputs/.test(t) && !/\$736,900/.test(t));
      check('…while the balances still show', (await total(page)) === '$377,000');

      // ---- phone width never scrolls sideways ----
      await mount(page, 18);
      const over = await page.evaluate(() => {
        const host = document.getElementById('nwprobe');
        return { scroll: host.scrollWidth, client: host.clientWidth };
      });
      check('the tab never scrolls sideways', over.scroll <= over.client + 1, JSON.stringify(over));
      await page.close();
    }
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
