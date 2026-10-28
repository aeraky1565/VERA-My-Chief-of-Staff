// Finances → FSA & HSA (the shared HealthAcct block) in BOTH real pages, at phone and desktop
// width: the household FSA card (left to spend, where the number came from, spent against the
// election, use by and what would be lost, the latest claims), the household HSA card (one
// balance, you and your employer against one limit), Update balance, Add / Edit / Remove, and
// what each sends. Every value is invented. HA_QUICK (ctl_healthaccts.js): full page, 390 only.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP  = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const START = '// ---- HealthAcct (Finances: FSA & HSA) — SHARED VERBATIM', END = '// ---- /HealthAcct ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
console.log('\nthe shared block');
check('both dashboards carry the HealthAcct block, word for word', block(APP).length > 4000 && block(APP) === block(LITE));
check('both put it in Finances as "FSA & HSA"',
  /\{id:'hsafsa',label:'🩺 FSA & HSA'/.test(APP) && /sub==='hsafsa'&&\/\*#__PURE__\*\/React\.createElement\(HealthAcctTab,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP)
  && /\{ id: 'fin_hsafsa',   label: '🩺 FSA & HSA' \}/.test(LITE) && /activeFinanceTab === 'fin_hsafsa'   && <HealthAcctTab apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>/.test(LITE));

const FSA = { id: 'HA-1', type: 'FSA', year: 2026, provider: '', election: 3400, balance: 778.28, source: 'sheet', balanceAsOf: '2026-09-12', spent: 2621.72,
  rule: 'carry', useBy: '2026-12-31', daysLeft: 64, carryover: 680, atRisk: 98.28, warn: true, stale: false,
  edit: { id: 'HA-1', type: 'FSA', year: 2026, provider: '', election: 3400, rule: 'carry', useBy: '', carryover: 680 },
  claims: { status: 'ok', count: 28, total: 2621.72, unknownStatuses: ['Needs receipt'], recent: [
    { date: '2026-09-12', provider: 'NEIGHBORHOOD PHARMACY', recipient: 'Ahmed', status: 'Paid', amount: 435.94, counted: true },
    { date: '2026-09-10', provider: 'DR SAMPLE', recipient: 'Ahmed', status: 'Paid', amount: 159, counted: true },
    { date: '2026-07-29', provider: 'OPTICAL SHOP', recipient: 'Victoria', status: 'Denied', amount: 692.8, counted: false }] } };
const HSA = { type: 'HSA', year: 2026, ids: ['HA-2'], accounts: 1, coverage: 'family', limit: 8750, balance: 2500, you: 3000, employer: 750, employerName: 'Verizon',
  room: 5000, over: 0, balanceAsOf: '2026-10-20', stale: false, edits: [{ id: 'HA-2', type: 'HSA', year: 2026, coverage: 'family', contributed: 3000, employer: 750, employerName: 'Verizon' }] };
const VIEW = { ok: true, today: '2026-10-28', fsa: [FSA], hsa: HSA, sheetLinked: true, limits: { fsa: 3400, carry: 680, hsaSelf: 4400, hsaFamily: 8750 } };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const QUICK = !!process.env.HA_QUICK;
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
      await page.waitForFunction(() => typeof HealthAcctTab === 'function', null, { timeout: 15000 }).catch(() => {});
      const mount = view => page.evaluate(view => {
        document.querySelectorAll('#haprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'haprobe'; host.style.padding = '0 16px'; document.body.prepend(host);
        window.__calls = []; window.__view = view; window.__reply = {};
        window.apiGet = (u, t, p) => { window.__calls.push(p); return p.action === 'health_accounts' ? Promise.resolve(window.__view) : (window.__reply[p.action] ? Promise.reject(new Error(window.__reply[p.action])) : Promise.resolve({ ok: true })); };
        ReactDOM.createRoot(host).render(React.createElement(HealthAcctTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
        return new Promise(r => setTimeout(r, 250));
      }, view);
      const q = sel => page.$$eval('#haprobe ' + sel, ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      const click = (sel, re) => page.evaluate(({ sel, re }) => { const b = Array.from(document.querySelectorAll('#haprobe ' + sel)).find(x => !re || new RegExp(re).test(x.textContent || '')); if (b) b.click(); return !!b; }, { sel, re }).then(r => wait(120).then(() => r));
      const writes = () => page.evaluate(() => window.__calls.filter(c => c.action !== 'health_accounts'));

      await mount(VIEW);
      check(L + ': it loads the household\'s accounts', JSON.stringify((await page.evaluate(() => window.__calls))[0]) === '{"action":"health_accounts"}');
      check(L + ': one FSA card and one HSA card, both for the household, none per person',
        (await page.$$('#haprobe .ha-fsa')).length === 1 && (await page.$$('#haprobe .ha-hsa')).length === 1 && (await q('.ha-card')).every(t => /Household/.test(t)));
      check(L + ': the FSA card shows what\'s left and where the number came from',
        (await q('.ha-balance-left'))[0] === '$778.28' && (await q('.ha-source'))[0] === 'From your FSA sheet · 28 claims · newest Sep 12', JSON.stringify(await q('.ha-source')));
      check(L + ': …spent against the election', (await q('.ha-spent'))[0] === '$2,621.72 spent of $3,400 elected');
      check(L + ': …the use-by date, the carryover rule and what would be lost',
        /^Use by Dec 31, 2026 64 days Up to \$680 carries into 2027; anything above that is lost\. \$98\.28 would be lost\./.test((await q('.ha-deadline'))[0] || ''), (await q('.ha-deadline'))[0]);
      check(L + ': a status VERA doesn\'t know is named', (await q('.ha-unknown'))[0] === 'Counted, though VERA doesn’t know the status: Needs receipt');
      check(L + ': the claims stay folded until asked for', (await page.$$('#haprobe .ha-claim')).length === 0);
      await click('.ha-claims-toggle');
      const claims = await q('.ha-claim');
      check(L + ': the latest claims show date, provider, who it was for and amount; a denied one isn\'t counted',
        claims.length === 3 && claims[0] === 'Sep 12 NEIGHBORHOOD PHARMACY Ahmed $435.94' && claims[2] === 'Jul 29 OPTICAL SHOP Victoria · Denied, not counted $692.80', JSON.stringify(claims));
      check(L + ': the HSA card adds everything into one balance against one limit',
        (await q('.ha-hsa-balance'))[0] === '$2,500' && (await q('.ha-hsa-split'))[0] === 'You $3,000 Verizon $750' && (await q('.ha-room'))[0] === '$5,000 of room left under the $8,750 limit', JSON.stringify([await q('.ha-hsa-split'), await q('.ha-room')]));

      await click('.ha-fsa .ha-update-btn');
      await page.fill('#haprobe .ha-update input', '650.5');
      await page.$eval('#haprobe .ha-update', f => f.requestSubmit()); await wait(200);
      check(L + ': Update balance sends today\'s balance for that account, then reloads',
        JSON.stringify(await writes()) === '[{"action":"health_account_save","id":"HA-1","balance":"650.5"}]' && (await page.evaluate(() => window.__calls.filter(c => c.action === 'health_accounts').length)) === 2, JSON.stringify(await writes()));
      await click('.ha-hsa .ha-update-btn');
      const fields = await page.$$('#haprobe .ha-update input');
      await fields[0].fill('2600'); await fields[1].fill('3200');
      await page.$eval('#haprobe .ha-update', f => f.requestSubmit()); await wait(200);
      check(L + ': on the HSA it also takes what you\'ve put in', JSON.stringify((await writes())[1]) === '{"action":"health_account_save","id":"HA-2","balance":"2600","contributed":"3200"}', JSON.stringify((await writes())[1]));

      await mount(VIEW);
      await click('.ha-add');
      check(L + ': + Add account starts as an FSA, with the year\'s limit as a hint', (await page.$eval('#haprobe .ha-election', n => n.placeholder)) === '3400' && (await page.$$('#haprobe .ha-you')).length === 0);
      await page.fill('#haprobe .ha-election', '3400');
      await click('.ha-rule', '^Grace period$');
      await page.fill('#haprobe .ha-useby', '2027-03-15');
      await page.$eval('#haprobe .ha-form', f => f.requestSubmit()); await wait(200);
      check(L + ': saving an FSA sends its election and its grace date',
        JSON.stringify(await writes()) === '[{"action":"health_account_save","type":"FSA","year":"2026","provider":"","election":"3400","rule":"grace","useBy":"2027-03-15","carryover":""}]', JSON.stringify(await writes()));
      await click('.ha-add');
      await click('.ha-type', '^HSA$');
      check(L + ': switching to HSA asks for coverage and contributions instead', (await page.$$('#haprobe .ha-election')).length === 0 && (await page.$$('#haprobe .ha-you')).length === 1 && (await page.$$('#haprobe .ha-coverage')).length === 2);
      await click('.ha-coverage', '^Family$');
      await page.fill('#haprobe .ha-you', '3000'); await page.fill('#haprobe .ha-employer', '750'); await page.fill('#haprobe .ha-employer-name', 'Verizon'); await page.fill('#haprobe .ha-form .ha-balance', '2500');
      await page.$eval('#haprobe .ha-form', f => f.requestSubmit()); await wait(200);
      check(L + ': saving an HSA sends coverage, both contributions and the balance',
        JSON.stringify((await writes())[1]) === '{"action":"health_account_save","type":"HSA","year":"2026","provider":"","coverage":"family","contributed":"3000","employer":"750","employerName":"Verizon","balance":"2500"}', JSON.stringify((await writes())[1]));
      await click('.ha-fsa .ha-edit');
      check(L + ': Edit opens the FSA with its own values', (await page.$eval('#haprobe .ha-election', n => n.value)) === '3400' && (await page.$$('#haprobe .ha-type')).length === 0);
      await click('.ha-remove');
      check(L + ': Remove deletes that account', JSON.stringify((await writes())[2]) === '{"action":"health_account_delete","id":"HA-1"}');

      await page.evaluate(() => { window.__reply.health_account_save = 'The sheet is busy.'; });
      await click('.ha-fsa .ha-update-btn'); await page.fill('#haprobe .ha-update input', '1'); await page.$eval('#haprobe .ha-update', f => f.requestSubmit()); await wait(200);
      check(L + ': a failed save says why', (await q('.ha-err'))[0] === 'The sheet is busy.');

      await mount(Object.assign({}, VIEW, { hsa: null, sheetLinked: false, fsa: [Object.assign({}, FSA, { source: 'typed', balance: 640, balanceAsOf: '2026-09-02', stale: true, spent: 2760, warn: false,
        claims: { status: 'unavailable', reason: 'VERA can’t open the FSA sheet (no access). Share it with VERA’s Google account, Viewer is enough.' } })] }));
      check(L + ': a typed balance says when, and asks for a check once it\'s old', (await q('.ha-source'))[0] === 'Typed 56 days ago · check it');
      check(L + ': a sheet VERA can\'t open says how to fix it', /^The FSA sheet: VERA can’t open the FSA sheet/.test((await q('.ha-sheet-problem'))[0] || ''));
      check(L + ': with no sheet linked it says how to link one', /fsa_sheet_id/.test((await q('.ha-link-hint'))[0] || ''));
      await mount(Object.assign({}, VIEW, { fsa: [], hsa: null }));
      check(L + ': no accounts yet says what adding one gives you', /^No accounts yet/.test((await q('.ha-none'))[0] || ''));

      await mount(VIEW);
      const sizes = await page.$$eval('#haprobe .ha-update-btn, #haprobe .ha-edit, #haprobe .ha-add', bs => bs.map(b => Math.round(b.getBoundingClientRect().height)));
      check(L + ': its buttons are at least 44px tall', sizes.length >= 4 && sizes.every(x => x >= 44), JSON.stringify(sizes));
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
