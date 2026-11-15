// Two people on one phone: each dashboard keeps its own sign-in (full: vera_token, lite:
// vera_token_lite), so one browser can be the owner on the full dashboard and Victoria on lite.
// Pins, in one browser profile (shared storage, like one phone's Chrome):
//  - lite's first load carries over the sign-in both dashboards used to share, so nobody is signed out;
//  - after that, lite and full each send their own code and never overwrite the other's;
//  - the full dashboard still sends a lite-only person to lite;
//  - the shared blocks read the sign-in through VERA_TOKEN_KEY, and each page names its own.
// Codes and names here are invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html'), IDX = read('docs/index.html');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

console.log('\nthe source');
check('the full dashboard keeps vera_token', /var VERA_TOKEN_KEY='vera_token';/.test(APP) && IDX.includes("var VERA_TOKEN_KEY='vera_token';"));
check('lite has its own key', /var VERA_TOKEN_KEY = 'vera_token_lite';/.test(LITE));
check('lite reads and saves through it', /useState\(\(\) => liteSavedToken_\(\)\)/.test(LITE) && /localStorage\.setItem\(VERA_TOKEN_KEY, t\);/.test(LITE) && !/localStorage\.setItem\('vera_token'/.test(LITE));
check('the full dashboard saves through it', /localStorage\.setItem\(VERA_TOKEN_KEY,t\);/.test(APP) && !/localStorage\.setItem\('vera_token'/.test(APP));
check('no shared code names a key of its own', !/getItem\('vera_token'\)/.test(APP) && (LITE.match(/getItem\('vera_token'\)/g) || []).length === 1 /* the one-time carry-over */);

const WHO = { 'OWNER-TOKEN': { ok: true, name: 'Ahmed', owner: true, view: 'full', hidden: [] }, 'VICK-CODE-0001': { ok: true, name: 'Victoria', owner: false, view: 'lite', hidden: [] } };

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const vendor = {
    'react.production.min.js': read('docs/react.min.js'), 'react-dom.production.min.js': read('docs/react-dom.min.js'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });   // one phone: one storage
  const sent = [];
  await ctx.route('**/*', route => {
    const u = route.request().url(); if (process.env.TS_DEBUG) console.log('REQ', u.slice(0, 110));
    for (const n of Object.keys(vendor)) if (u.includes(n)) return route.fulfill({ contentType: 'application/javascript', body: vendor[n] });
    if (u.indexOf('/exec') !== -1) {
      const p = new URL(u).searchParams, a = p.get('action'), tok = p.get('token');
      sent.push({ page: route.request().frame() ? new URL(route.request().frame().url()).pathname : '', a, tok });
      if (a === 'whoami') return route.fulfill({ contentType: 'application/json', body: J(WHO[tok] || { ok: false, error: 'Unauthorized' }) });
      return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    }
    if (/dashboard-lite\.html/.test(u)) return route.fulfill({ contentType: 'text/html', body: LITE });
    if (u.startsWith('https://vera.test/')) return route.fulfill({ contentType: 'text/html', body: IDX });
    return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
  });
  const page = await ctx.newPage();
  await page.goto('https://vera.test/blank-start', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 'OWNER-TOKEN'); localStorage.setItem('vera_install_tip_done', '1'); });
  const store = () => page.evaluate(() => ({ full: localStorage.getItem('vera_token'), lite: localStorage.getItem('vera_token_lite') }));
  const tokensOn = () => [...new Set(sent.map(s => s.tok))];   // the log is cleared before each page load

  console.log('\nupgrading: lite carries over the shared sign-in once');
  sent.length = 0;
  await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.lite-bar, .modal-overlay', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  check('lite signs in with the code both used to share', J(tokensOn()) === J(['OWNER-TOKEN']), J(tokensOn()));
  check('…and keeps it as its own', J(await store()) === J({ full: 'OWNER-TOKEN', lite: 'OWNER-TOKEN' }), J(await store()));

  console.log('\nVictoria signs in on lite; the owner stays on full');
  await page.evaluate(() => localStorage.setItem('vera_token_lite', 'VICK-CODE-0001'));   // what lite’s ⚙ Save writes
  sent.length = 0;
  await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.lite-bar, .modal-overlay', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  check('lite now sends only Victoria’s code', J(tokensOn()) === J(['VICK-CODE-0001']), J(tokensOn()));
  check('…and the full dashboard’s sign-in is untouched', (await store()).full === 'OWNER-TOKEN');
  sent.length = 0;
  await page.goto('https://vera.test/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check('the full dashboard sends only the owner’s code', tokensOn().length >= 1 && tokensOn().every(t => t === 'OWNER-TOKEN'), J(tokensOn()));
  check('…and stays on the full dashboard (no bounce to lite)', !/dashboard-lite/.test(page.url()), page.url());
  check('…and lite still has Victoria', (await store()).lite === 'VICK-CODE-0001');

  console.log('\na lite-only code on the full dashboard still goes to lite');
  await page.evaluate(() => localStorage.setItem('vera_token', 'VICK-CODE-0001'));
  await page.goto('https://vera.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/dashboard-lite\.html/, { timeout: 8000 }).catch(() => {});
  check('Victoria’s code on the full page lands on lite', /dashboard-lite\.html/.test(page.url()), page.url());

  console.log('\nlite’s ⚙ Save writes only lite’s key');
  await page.evaluate(() => { localStorage.setItem('vera_token', 'OWNER-TOKEN'); localStorage.setItem('vera_token_lite', 'OLD-LITE-CODE'); localStorage.removeItem('vera_url'); });
  await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.lite-bar, .modal-overlay', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const inputs = await page.$$('.modal-overlay input');
  check('lite asks to connect when it has no web app address', inputs.length >= 2);
  if (inputs.length >= 2) {
    await inputs[0].fill('https://vera.test/exec'); await inputs[1].fill('VICK-CODE-0001');
    await page.click('.modal-overlay button:has-text("Connect")');
    await page.waitForTimeout(300);
  }
  const st = await store();
  check('saving on lite sets lite’s sign-in and leaves the full one alone', st.lite === 'VICK-CODE-0001' && st.full === 'OWNER-TOKEN', J(st));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + e.message); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
