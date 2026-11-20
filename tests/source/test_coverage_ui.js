// Health › Care › Coverage (CoverageTab, shared verbatim, issue #257) in BOTH real pages at phone and
// desktop width, on invented data: Coverage first under Care (and on lite's Family), the four tabs;
// Cards (who has what, a person switch, a private number hidden until Show, then Copy, the doctors,
// a missing plan said plainly); Covered (plan chips, search, covered / not, source); FSA/HSA (balances,
// a question answered with its source, recent questions); Perks (allowance left, Log, the log, Add a
// perk); no sideways scroll. Every name and figure is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8'), LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const START = '// ---- CoverageTab (Health › Care › Coverage, issue #257) — SHARED VERBATIM', END = '// ---- /CoverageTab ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
console.log('\nthe shared block and where it lives');
check('both dashboards carry it, word for word', block(APP).length > 3000 && block(APP) === block(LITE));
check('Coverage is first under Health › Care', /\{id:'care',label:'Care',icon:'🩺',items:\['coverage','eyes','prescriptions','appointments'\]\}/.test(APP) && /sub==='coverage'&&React\.createElement\(CoverageTab,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
check('…and on lite’s Family tab', /\{ id: 'coverage', label: '🩺 Coverage' \}/.test(LITE) && /familySub === 'coverage' && <CoverageTab apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>/.test(LITE));

const COV = { ok: true, people: ['Pat', 'Sam'], year: '2026',
  cards: [{ kind: 'Medical', person: 'Pat', provider: 'Acme Health', fields: [{ label: 'Member ID', value: 'ACM123456789', private: true }, { label: 'Group', value: '55501', private: true }, { label: 'Plan', value: 'Gold PPO', private: false }] },
    { kind: 'Dental', person: 'Pat', provider: 'Smile Co', fields: [{ label: 'Member ID', value: 'SM-778899', private: true }] },
    { kind: 'Medical', person: 'Sam', provider: 'Acme Health', fields: [{ label: 'Member ID', value: 'ACM123456790', private: true }] },
    { kind: 'Vision', person: 'Sam', provider: 'EyeWell', fields: [{ label: 'Member ID', value: 'EW-2', private: true }] }],
  grid: { Medical: { Pat: true, Sam: true }, Dental: { Pat: true, Sam: false }, Vision: { Pat: false, Sam: true } },
  doctors: [{ kind: 'Medical', person: 'Sam', label: 'Pharmacy', value: 'Corner Pharmacy' }],
  covered: [{ id: 'C1', plan: 'Medical', status: 'Covered', service: 'Physical therapy', detail: '20 visits a year', source: 'Acme Medical SBC', page: '4' },
    { id: 'C2', plan: 'Medical', status: 'Not covered', service: 'Cosmetic surgery', detail: '', source: 'Acme Medical SBC', page: '' },
    { id: 'C3', plan: 'Dental', status: 'Covered', service: 'Cleanings', detail: 'twice a year', source: 'Smile SBC', page: '' }],
  docs: { plan: ['Acme Medical SBC'], fsa: ['Acme FSA Guide'] }, questions: [{ question: 'contact lenses', verdict: 'yes', why: '', source: '' }],
  perks: [{ id: 'PK-HINGE', name: 'Hinge', forWho: 'Pat', what: 'Therapy and coaching.', link: 'https://example.test/hinge', allowances: 'therapy:6; coaching:6',
      left: [{ kind: 'therapy', of: 6, used: 2, left: 4 }, { kind: 'coaching', of: 6, used: 0, left: 6 }], log: [{ id: 'L1', kind: 'therapy', date: '2026-10-14' }] },
    { id: 'PK-MAVEN', name: 'Maven', forWho: 'Both', what: 'Family planning support.', link: '', allowances: '', left: [], log: [] }] };
const HA = { ok: true, fsa: [{ year: 2026, balance: 390, useBy: '2027-03-15', daysLeft: 116 }], hsa: { balance: 1250, balanceAsOf: '2026-11-01' } };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'), 'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8') };
  for (const kind of ['full', 'lite']) for (const width of [390, 1280]) {
    const L = kind + ' ' + width; console.log('\n' + kind + ' dashboard @ ' + width + 'px');
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
    await page.waitForFunction(() => typeof CoverageTab === 'function', null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(({ COV, HA }) => {
      window.__posts = []; window.__copied = '';
      try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } }); } catch (e) {}
      window.apiGet = (u, t, p) => Promise.resolve(JSON.parse(JSON.stringify(p.action === 'coverage' ? COV : p.action === 'health_accounts' ? HA : { ok: false })));
      window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b)));
        if (b.action === 'coverage_ask') return Promise.resolve({ ok: true, item: b.q, verdict: 'no', why: 'A toothbrush is general health, not treatment.', source: 'Acme FSA Guide' });
        return Promise.resolve({ ok: true, rows: 3, from: ['Acme Medical SBC'] }); };
      document.querySelectorAll('#cvprobe').forEach(n => n.remove());
      const host = document.createElement('div'); host.id = 'cvprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
      ReactDOM.createRoot(host).render(React.createElement(CoverageTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
    }, { COV, HA });
    await wait(400);
    const txt = s => page.$eval('#cvprobe ' + s, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    const click = s => page.$eval('#cvprobe ' + s, n => n.click());
    const clickText = (s, t) => page.$$eval('#cvprobe ' + s, (ns, t) => { const n = ns.find(x => x.innerText.trim() === t); if (n) n.click(); return !!n; }, t);
    check(L + ': four tabs, Cards first', JSON.stringify(await page.$$eval('#cvprobe .cv-nav button', ns => ns.map(n => n.innerText.trim()))) === '["Cards","Covered","FSA / HSA","Perks"]');
    const g = await txt('.cv-grid');
    check(L + ': who has what, from the cheat sheet: Sam has no dental, Pat no vision', /Medical ✓ Yes ✓ Yes Dental ✓ Yes ✗ No Vision ✗ No ✓ Yes/.test(g), g);
    let ins = await txt('.cv-ins-medical');
    check(L + ': Pat’s medical card: the provider; private numbers hidden; the plan shown', /Medical Acme Health/.test(ins) && /Member ID ••••6789 Show/.test(ins) && /Plan Gold PPO Copy/.test(ins) && !/ACM123456789/.test(ins), ins);
    await page.$eval('#cvprobe .cv-ins-medical .cv-show', n => n.click()); await wait(100);
    ins = await txt('.cv-ins-medical');
    check(L + ': Show reveals it, then Copy copies it', /Member ID ACM123456789 Copy/.test(ins) && (await page.$eval('#cvprobe .cv-ins-medical .cv-copy', n => { n.click(); return true; }), await wait(80), await page.evaluate(() => window.__copied)) === 'ACM123456789');
    check(L + ': Pat has no vision card, said plainly', /Vision · Pat isn’t covered/.test(await txt('.cv-tab')));
    check(L + ': only Pat’s cards show', (await page.$$eval('#cvprobe .cv-ins-medical', ns => ns.length)) === 1 && (await page.$$eval('#cvprobe .cv-ins-vision', ns => ns.length)) === 0);
    await clickText('.cv-person', 'Sam'); await wait(120);
    check(L + ': Sam’s cards, her pharmacy, and no dental', /Vision EyeWell/.test(await txt('.cv-ins-vision')) && /Corner Pharmacy/.test(await txt('.cv-doctors')) && /Dental · Sam isn’t covered/.test(await txt('.cv-tab')));
    await click('.cv-nav-covered'); await wait(120);
    check(L + ': Covered: the medical plan, covered and not, with source and page', /✓ Covered · 1 Physical therapy 20 visits a year Acme Medical SBC · p\. 4/.test(await txt('.cv-yes')) && /✗ Not covered · 1 Cosmetic surgery/.test(await txt('.cv-no')));
    await page.fill('#cvprobe .cv-search', 'cosmetic'); await wait(100);
    check(L + ': search narrows it', /Covered · 0/.test(await txt('.cv-yes')) && /Cosmetic surgery/.test(await txt('.cv-no')));
    await page.fill('#cvprobe .cv-search', ''); await clickText('.cv-plan', 'Dental'); await wait(100);
    check(L + ': another plan', /Cleanings twice a year/.test(await txt('.cv-yes')));
    await click('.cv-read'); await wait(200);
    check(L + ': Read the plan documents asks VERA to read them', (await page.evaluate(() => window.__posts.slice(-1)[0].action)) === 'coverage_read_docs' && /Read Acme Medical SBC: 3 lines/.test(await txt('.cv-msg')));
    await click('.cv-nav-fsa'); await wait(150);
    check(L + ': FSA/HSA: the FSA left with its use-by, the HSA balance', /FSA 2026 left \$390 use by Mar 15 · 116 days/i.test(await txt('.cv-fsa')) && /HSA balance \$1,250/i.test(await txt('.cv-hsa')), await txt('.cv-fsa'));
    await page.fill('#cvprobe .cv-ask-input', 'electric toothbrush'); await click('.cv-ask-go'); await wait(200);
    const ans = await txt('.cv-answer');
    check(L + ': a question is answered with why and the source', /Probably not · electric toothbrush/.test(ans) && /general health/.test(ans) && /From: Acme FSA Guide/.test(ans) && (await page.evaluate(() => window.__posts.slice(-1)[0].q)) === 'electric toothbrush', ans);
    check(L + ': recent questions', /contact lenses Yes/.test(await txt('.cv-recent')));
    await click('.cv-nav-perks'); await wait(150);
    const perk = await page.$$eval('#cvprobe .cv-perk', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
    check(L + ': Hinge: whose, sessions left, the log; Maven: what it’s for', /Hinge Pat · 2026 · resets Jan 1/.test(perk[0]) && /Therapy 4 of 6 left/i.test(perk[0]) && /Coaching 6 of 6 left/i.test(perk[0]) && /therapy Oct 14/i.test(perk[0]) && /Maven/.test(perk[1]) && /Family planning support/.test(perk[1]), JSON.stringify(perk));
    await page.$eval('#cvprobe .cv-log', n => n.click()); await wait(150);
    check(L + ': Log therapy sends the perk and the kind', JSON.stringify(await page.evaluate(() => window.__posts.slice(-1)[0])) === '{"action":"perk_log","perkId":"PK-HINGE","kind":"therapy"}');
    await click('.cv-perk-add'); await wait(100);
    await page.fill('#cvprobe .cv-perk-form input[aria-label="Name"]', 'Gym discount'); await page.fill('#cvprobe .cv-perk-form input[aria-label="What it’s for"]', '20% off');
    await click('.cv-perk-save'); await wait(150);
    check(L + ': Add a perk saves it', (p => p.action === 'perk_save' && p.name === 'Gym discount' && p.what === '20% off')(await page.evaluate(() => window.__posts.slice(-1)[0])));
    check(L + ': buttons are big enough to tap', await page.$$eval('#cvprobe button', ns => ns.every(n => n.getBoundingClientRect().height >= 36)));
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
