// Finances › Day to day › Phone plan (PhonePlanCard, shared verbatim, issue #226) in BOTH real
// pages at phone and desktop width, on an invented phone tracker: the bill, ours and the money
// back, ticking each payment received (by bill) and undoing it, the family chat card stepping
// through the months, Share image (a PNG through the share sheet, or a download), Copy as text,
// and no sideways scroll. Every name and figure is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { phoneTracker } = require('./budget_fixture.js');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const PPS = fs.readFileSync(path.join(ROOT, 'PhonePlan.js'), 'utf8');
const START = '// ---- PhonePlanCard (Finances › Day to day › Phone plan, issue #226) — SHARED VERBATIM', END = '// ---- /PhonePlanCard ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
console.log('\nthe wiring');
check('both dashboards carry it, word for word', block(APP).length > 2000 && block(APP) === block(LITE));
check('Phone plan is a Day to day subtab in both', /items:\['budget','billscash','groceries','phone'\]/.test(APP) && APP.indexOf("{id:'phone',label:'📱 Phone plan'}") !== -1
  && APP.indexOf("sub==='phone'&&React.createElement(PhonePlanCard,{apiUrl:apiUrl,apiToken:apiToken})") !== -1
  && LITE.indexOf("{ id: 'fin_phone',    label: '📱 Phone plan' }") !== -1 && LITE.indexOf("{activeFinanceTab === 'fin_phone' && <PhonePlanCard apiUrl={apiUrl} apiToken={apiToken} />}") !== -1);

const E = vm.createContext({});
vm.runInContext(PPS.slice(PPS.indexOf('function ppText_'), PPS.indexOf("/** The phone tracker's first tab")), E);
E.G = phoneTracker();
const plan = vm.runInContext('ppParse_(G, "2026-11-02", ["Pat", "Sam"])', E);
plan.name = 'Example Mobile · Unlimited Plus';
const PAYLOAD = { ok: true, configured: true, plan, received: { 'group (robin & lee)': '2026-11-03T15:00:00.000Z' } };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const QUICK = !!process.env.PP_QUICK;
  for (const kind of (QUICK ? ['full'] : ['full', 'lite'])) {
    for (const width of (QUICK ? [390] : [390, 1280])) {
      const L = kind + ' ' + width;
      console.log('\n' + kind + ' dashboard @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1000 }, acceptDownloads: true });
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
      await page.waitForFunction(() => typeof PhonePlanCard === 'function', null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(PAYLOAD => {
        window.__posts = []; window.__shared = null; window.__copied = null;
        window.apiGet = (u, t, p) => Promise.resolve(p.action === 'phone_plan' ? JSON.parse(JSON.stringify(PAYLOAD)) : { ok: false });
        window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b))); return Promise.resolve({ ok: true, receivedAt: b.received ? '2026-11-05T12:00:00.000Z' : '' }); };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } });
        navigator.canShare = d => !!(d && d.files && d.files.length);
        navigator.share = d => { window.__shared = { name: d.files[0].name, type: d.files[0].type, size: d.files[0].size, title: d.title }; return Promise.resolve(); };
        document.querySelectorAll('#ppprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'ppprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        ReactDOM.createRoot(host).render(React.createElement(PhonePlanCard, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
      }, PAYLOAD);
      await wait(400);
      const txt = sel => page.$eval('#ppprobe ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
      const click = sel => page.evaluate(sel => { const n = document.querySelector('#ppprobe ' + sel); if (n) n.click(); return !!n; }, sel);
      const all = await txt('.pp-card');
      check(L + ': the plan’s name and month, from the phone tracker', /^Example Mobile · Unlimited Plus · November 2026/.test(all) && /due the 12th from Joint/.test(all), all.slice(0, 120));
      const tiles = await page.$$eval('#ppprobe .pp-tile', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': the bill, ours, and the money back', /^The bill \$168\.50/.test(tiles[0]) && /^Ours \$72\.00 what the Budget counts/.test(tiles[1]) && /^Back from family \$96\.50 by the 12th/.test(tiles[2]), JSON.stringify(tiles));
      let payers = await page.$$eval('#ppprobe .pp-payer', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': a row per payment, by bill, the ones already in ticked', payers.length === 2 && /^Group \(Robin & Lee\) received Nov 3 \$71\.00 Received ✓/.test(payers[0]) && /^Kim not yet \$25\.50 Mark received/.test(payers[1]), JSON.stringify(payers));
      check(L + ': received so far', /Received this month \$71\.00 of \$96\.50/.test(await txt('.pp-progress')));
      await page.evaluate(() => document.querySelector('#ppprobe .pp-mark[aria-label="Mark received: Kim"]').click()); await wait(200);
      let posts = await page.evaluate(() => window.__posts);
      check(L + ': tapping marks it received for the month', posts[0] && posts[0].action === 'phone_payback_mark' && posts[0].month === '2026-11' && posts[0].payer === 'Kim' && posts[0].received === true && posts[0].amount === 25.5, JSON.stringify(posts));
      check(L + ': …all in', /\$96\.50 of \$96\.50/.test(await txt('.pp-progress')) && /Kim received Nov 5/.test(await txt('.pp-payers')));
      await page.evaluate(() => document.querySelector('#ppprobe .pp-mark[aria-label="Undo received: Kim"]').click()); await wait(200);
      check(L + ': and undo', (await page.evaluate(() => window.__posts[1] && window.__posts[1].received)) === false && /Kim not yet/.test(await txt('.pp-payers')));
      // the family chat card
      let card = await txt('.pp-share-card');
      check(L + ': the chat card opens on this month, in VERA’s look', /^PHONE PLAN Example Mobile · Unlimited Plus Due 11\/12/.test(card) && /Pat \$42\.00 Sam \$30\.00 Robin \$51\.00 Lee \$20\.00 Kim \$25\.50 Total Plan Due \$168\.50/.test(card)
        && /WHAT EACH PAYMENT IS Bill 1 - Pat \$42\.00 Bill 2 - Sam \$30\.00 Bill 3 - Group \(Robin & Lee\) \$71\.00 Bill 4 - Kim \$25\.50/.test(card) && !/Please send/.test(card), card);
      check(L + ': …on VERA’s dark card, not a white sheet', await page.$eval('#ppprobe .pp-share-card', n => getComputedStyle(n).backgroundColor) === 'rgb(11, 23, 48)');
      check(L + ': the latest month: no later one', await page.$eval('#ppprobe .pp-month-next', n => n.disabled));
      await click('.pp-month-prev'); await wait(100);
      check(L + ': an earlier month', /^October 2026$/.test(await txt('.pp-month')) && /Due 10\/12/.test(await txt('.pp-share-card')) && /Bill 3 - Group \(Robin & Lee\) \$70\.00/.test(await txt('.pp-share-card')));
      await click('.pp-month-prev'); await wait(100);
      card = await txt('.pp-share-card');
      check(L + ': a month before the payment table: people only', /Due 9\/12/.test(card) && /Total Plan Due \$165\.00/.test(card) && !/WHAT EACH PAYMENT IS/.test(card) && await page.$eval('#ppprobe .pp-month-prev', n => n.disabled));
      await click('.pp-copy'); await wait(100);
      const copied = await page.evaluate(() => window.__copied);
      check(L + ': Copy as text: the month, line by line', /^Example Mobile · Unlimited Plus · bill due 9\/12\n\nPat  \$40\.00\n/.test(copied || '') && /Total Plan Due  \$165\.00$/.test(copied) && /Copied as text/.test(await txt('.pp-note')), JSON.stringify(copied));
      await click('.pp-month-next'); await click('.pp-month-next'); await wait(100);
      await click('.pp-share-image'); await wait(400);
      const shared = await page.evaluate(() => window.__shared);
      check(L + ': Share image: a PNG of the month through the share sheet', shared && shared.name === 'phone-plan-2026-11.png' && shared.type === 'image/png' && shared.size > 2000 && shared.title === 'Example Mobile · Unlimited Plus', JSON.stringify(shared));
      await click('.pp-copy'); await wait(100);
      check(L + ': …and with the payments when the month has them', /\n\nWhat each payment is\nBill 1 - Pat  \$42\.00\n/.test(await page.evaluate(() => window.__copied) || ''));
      await page.evaluate(() => { navigator.canShare = () => false; });
      const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
      await click('.pp-share-image');
      const d = await dl;
      check(L + ': no share sheet (a computer): the picture downloads', d && d.suggestedFilename() === 'phone-plan-2026-11.png' && /Saved the picture/.test(await txt('.pp-note')));
      await click('.pp-who'); await wait(100);
      check(L + ': the split by person, ours marked', /Pat · ours \$42\.00 Sam · ours \$30\.00 Robin \$51\.00/.test(await txt('.pp-members')));
      check(L + ': buttons big enough to tap', await page.$$eval('#ppprobe .pp-mark, #ppprobe .pp-share-image, #ppprobe .pp-copy, #ppprobe .pp-month-prev', ns => ns.every(n => n.getBoundingClientRect().height >= 40)));
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
