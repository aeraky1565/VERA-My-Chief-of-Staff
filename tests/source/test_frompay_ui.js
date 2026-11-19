// What comes out of pay, in the real Budget card (both dashboards, phone and desktop): the HSA line
// says its year ÷ 12, "Taken from pay" lists the premiums, then Take-home pay, and the HSA editor
// saves a year's figure through Config. The rules are in test_frompay.js. Every figure is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { tracker } = require('./budget_fixture.js');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BUD = read('Budget.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
}
const E = vm.createContext({});
vm.runInContext(BUD.slice(BUD.indexOf('// ---- BudgetEngine'), BUD.indexOf('// ---- /BudgetEngine ----')), E);
vm.runInContext(/var BG_FROM_PAY_RX_ = .*;/.exec(BUD)[0] + '\n' + /var BG_HSA_RX_ = .*;/.exec(BUD)[0] + '\n' + extractFn(BUD, 'bgWithPay_'), E);
const g = tracker();
const at = (col, text) => g.findIndex(r => String((r || [])[col] || '').trim() === text);
const hr = at(1, 'State Withholding') + 1; g[hr][1] = 'HSA Contributions'; g[hr][2] = '$3,300.00';
E.G = g;
const model = vm.runInContext('bgWithPay_(budgetModel_(G), { hsa_annual_2026: "3300" }, "2026")', E); E.M = model;
const computed = vm.runInContext('budgetCompute_(M, {}, {})', E); E.C = computed;
const PAYLOAD = { ok: true, configured: true, model, computed, match: vm.runInContext('budgetMatch_(M, C)', E), categoryMap: {}, quarter: '2026-Q4', scenarios: [],
  hsaYears: [{ year: '2026', annual: 3300 }, { year: '2027', annual: null }] };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  for (const kind of ['full', 'lite']) {
    for (const width of [390, 1280]) {
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
      await page.evaluate(({ PAYLOAD }) => {
        try { localStorage.removeItem('vera_budget_open'); } catch (e) {}
        window.__gets = [];
        window.apiGet = (u, t, p) => { window.__gets.push(Object.assign({}, p));
          return Promise.resolve(p && p.action === 'budget_model' ? JSON.parse(JSON.stringify(PAYLOAD)) : p && p.action === 'set_config_value' ? { ok: true } : { ok: false }); };
        window.apiPost = () => Promise.resolve({ ok: true });
        document.querySelectorAll('#fpprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'fpprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        ReactDOM.createRoot(host).render(React.createElement(BudgetTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
      }, { PAYLOAD });
      await wait(400);
      await page.evaluate(() => { const b = document.querySelector('#fpprobe .bg-card-pat .bg-card-head'); if (b) b.click(); }); await wait(150);
      const pat = await page.$eval('#fpprobe .bg-card-pat', n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
      check(L + ': the HSA line is the year ÷ 12, and says what the tracker types', /HSA Contributions deduction · \$3,300 for 2026 ÷ 12 \(the tracker says \$3,300\.00\/mo\)/.test(pat), pat.slice(0, 400));
      check(L + ': Taken from pay lists the premium, then Take-home pay', /TAKEN FROM PAY Health Insurance - Medical from your paycheck, before it reaches you/.test(pat) && /Take-home pay net income − what comes from pay/.test(pat), pat.slice(0, 900));
      check(L + ': the HSA for this year and next', /HSA for the year \(VERA takes ÷ 12 each month\) 2026 \$3,300 · \$275\.00\/mo Edit 2027 not set Edit/.test(pat), (pat.match(/HSA for the year.{0,120}/) || [''])[0]);
      await page.evaluate(() => document.querySelector('#fpprobe .bg-hsa-edit[aria-label="Edit HSA for 2027"]').click()); await wait(80);
      await page.evaluate(() => { const n = document.querySelector('#fpprobe .bg-hsa-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, '7600'); n.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.evaluate(() => document.querySelector('#fpprobe .bg-hsa-save').click()); await wait(150);
      const gets = await page.evaluate(() => window.__gets);
      check(L + ': saving next year’s HSA writes Config, then reads Budget again', gets.some(x => x.action === 'set_config_value' && x.key === 'hsa_annual_2027' && x.value === '7600') && gets.filter(x => x.action === 'budget_model').length >= 2, JSON.stringify(gets));
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
