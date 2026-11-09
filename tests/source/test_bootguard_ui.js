// The dashboards never go white: a component that throws shows a readable
// message instead (VeraBoundary), and a page that fails to start (a vendor
// script that doesn't load, a compile error) is explained by the head guard.
// Both dashboards, at 390 px (phone) and 1280 px.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

// ---- Source checks ----------------------------------------------------------
const HDR = '// ---- VeraBoundary (crash screen instead of a white page) — SHARED VERBATIM';
function block(src) { const i = src.indexOf(HDR); if (i < 0) return ''; const j = src.indexOf('\n// ---- ', i + HDR.length); return src.slice(i, j < 0 ? undefined : j); }
check('the boundary block exists in both dashboards', block(APP).length > 500 && block(LITE).length > 500);
check('the boundary block is byte-identical in both', block(APP) === block(LITE));
check('full: the whole app is wrapped', /render\(React\.createElement\(VeraBoundary,\{where:'app'\},\/\*#__PURE__\*\/React\.createElement\(App,null\)\)\)/.test(APP));
check('full: tab content is wrapped, keyed by tab', /className:"main"\},error&&[\s\S]{0,400}?React\.createElement\(VeraBoundary,\{key:activeTab,where:'section'\},activeTab==='flags'/.test(APP));
check('lite: the whole app is wrapped', /render\(<VeraBoundary where="app"><App \/><\/VeraBoundary>\)/.test(LITE));
check('lite: tab content is wrapped, keyed by tab', /<VeraBoundary key=\{activeTab\} where="section">\s+\{activeTab === 'overview'/.test(LITE));
const guardOf = s => { const m = s.match(/<script>\/\* VERA boot guard[\s\S]*?<\/script>/); return m ? m[0] : ''; };
check('the head guard is in both pages, identical', guardOf(INDEX).length > 500 && guardOf(INDEX) === guardOf(LITE));
check('the head guard comes before lite’s vendor scripts', LITE.indexOf('VERA boot guard') > 0 && LITE.indexOf('VERA boot guard') < LITE.indexOf('unpkg.com'));
check('lite pins exact vendor versions', /unpkg\.com\/react@18\.3\.1\/umd\/react\.production\.min\.js/.test(LITE)
  && /unpkg\.com\/react-dom@18\.3\.1\/umd\/react-dom\.production\.min\.js/.test(LITE)
  && /unpkg\.com\/@babel\/standalone@8\.0\.5\/babel\.min\.js/.test(LITE)
  && !/unpkg\.com\/(react|react-dom)@18\//.test(LITE) && !/@babel\/standalone\/babel/.test(LITE));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
check('lite’s Babel is the version the tests use', /@babel\/standalone@([\d.]+)\//.exec(LITE) && /@babel\/standalone@([\d.]+)\//.exec(LITE)[1] === String((pkg.devDependencies || {})['@babel/standalone'] || (pkg.dependencies || {})['@babel/standalone']).replace(/^[\^~]/, ''));

// ---- Browser checks ---------------------------------------------------------
const vendor = {
  'react.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
  'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
  'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
};

async function open(browser, which, width, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 500, hasTouch: width < 500 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.route('**/*', r => {
    const u = r.request().url();
    for (const n of Object.keys(vendor)) if (u.includes(n)) {
      if (opts.block && u.includes(opts.block)) return r.abort();
      return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
    }
    if (u.startsWith('https://vera.test/dashboard-lite')) return r.fulfill({ contentType: 'text/html', body: LITE });
    if (u.startsWith('https://vera.test/index')) return r.fulfill({ contentType: 'text/html', body: INDEX });
    return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
  });
  await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
  await page.goto('https://vera.test/' + (which === 'lite' ? 'dashboard-lite.html' : 'index.html'), { waitUntil: 'domcontentloaded' });
  return { ctx, page, errs };
}
const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// Controls narrow the run: BG_SOURCE_ONLY=1, BG_PAGES=full,lite, BG_WIDTHS=390,1280, BG_GUARD=0.
const ENV = process.env;
if (ENV.BG_SOURCE_ONLY === '1') { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
const PAGES = (ENV.BG_PAGES || 'full,lite').split(',');
const WIDTHS = (ENV.BG_WIDTHS || '390,1280').split(',').map(Number);
const GUARD = ENV.BG_GUARD !== '0';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    for (const which of PAGES.filter(p => p === 'full' || p === 'lite')) for (const width of WIDTHS) {
      const tag = which + ' @' + width + ': ';
      const landing = which === 'lite' ? 'OverviewLiteTab' : 'HomeTab';
      const { ctx, page } = await open(browser, which, width);
      const ready = await page.waitForFunction(n => typeof window[n] === 'function' && typeof VeraBoundary === 'function' && document.getElementById('root').children.length > 0, landing, { timeout: 30000 }).then(() => true).catch(() => false);
      check(tag + 'the page starts normally', ready);
      check(tag + 'no crash screen and no guard on a normal start', ready && (await page.$$('.vb-crash')).length === 0 && !(await page.$('#vera-boot')));

      // A crash in the landing tab: replace its component with one that throws, then re-render it.
      await page.evaluate(n => { window[n] = function () { throw new Error('Test crash: cannot read the trip'); }; }, landing);
      const other = which === 'lite' ? 'chat' : 'tasks';
      const back = which === 'lite' ? 'overview' : 'home';
      const clickTab = async id => page.evaluate(id => {
        const b = Array.from(document.querySelectorAll('button, .tab, [role="tab"], div')).find(el => {
          const t = (el.textContent || '').trim().toLowerCase();
          return el.children.length <= 2 && (id === 'overview' ? /^🌅?\s*today$/.test(t) : id === 'home' ? /^🏠?\s*home$/.test(t) : id === 'chat' ? /^💬?\s*chat$/.test(t) : /^✅?\s*tasks$/.test(t));
        });
        if (b) { b.click(); return true; } return false;
      }, id);
      const c1 = await clickTab(other); await page.waitForTimeout(300); const c2 = await clickTab(back); await page.waitForTimeout(500);
      check(tag + 'switched tabs to re-render the landing tab', c1 && c2);
      const sec = await page.$('.vb-crash.vb-section');
      const secText = sec ? await sec.innerText() : '';
      const msgText = sec ? await sec.$eval('.vb-msg', e => e.innerText).catch(() => '') : '';
      check(tag + 'a crash shows “This section hit an error” with the message', /This section hit an error/.test(secText) && msgText === 'Test crash: cannot read the trip', secText.slice(0, 120));
      check(tag + 'the details name the component and the build', /build \d{4}-\d{2}-\d{2}/.test(secText));
      const headerAlive = await page.evaluate(() => document.body.innerText.includes('VERA') && document.getElementById('root').innerText.length > 200);
      check(tag + 'the header and tabs still show', headerAlive);
      check(tag + 'Try again, Copy details and Reload are there', !!(await page.$('.vb-crash .vb-retry')) && !!(await page.$('.vb-crash .vb-copy')) && !!(await page.$('.vb-crash .vb-reload')));
      if (width === 390) {
        const box = sec ? await sec.boundingBox() : null;
        check(tag + 'buttons are at least 44 px tall', !!(await page.$$eval('.vb-crash button', bs => bs.every(b => b.getBoundingClientRect().height >= 44)).catch(() => false)));
        check(tag + 'the crash box fits the phone', !!box && box.width <= 390);
      }
      // (The full dashboard's own tab bar already runs past 1280 px, so measure the crash box itself.)
      const fits = sec ? await sec.evaluate(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1 && e.scrollWidth <= e.clientWidth + 1; }) : false;
      check(tag + 'the crash box adds no sideways scroll', fits);
      await clickTab(other); await page.waitForTimeout(300);
      check(tag + 'another tab still works after the crash', (await page.$$('.vb-crash')).length === 0);

      // The app-level variant.
      const appText = await page.evaluate(() => new Promise(res => {
        const d = document.createElement('div'); document.body.appendChild(d);
        const Bad = function () { throw new Error('Test crash: app'); };
        ReactDOM.createRoot(d).render(React.createElement(VeraBoundary, { where: 'app' }, React.createElement(Bad)));
        setTimeout(() => { res(d.innerText); d.remove(); }, 400);
      }));
      check(tag + 'an app-level crash shows “VERA couldn’t start” with Reload', /VERA couldn’t start/.test(appText) && /Test crash: app/.test(appText) && /Reload/.test(appText) && !/Try again/.test(appText), appText.slice(0, 120));
      await ctx.close();
    }

    // The head guard: block a vendor script so the app never starts.
    if (GUARD) for (const width of WIDTHS) {
      const { ctx, page } = await open(browser, 'lite', width, { block: 'babel.min.js' });
      const shown = await page.waitForSelector('#vera-boot', { timeout: 15000 }).then(() => true).catch(() => false);
      const t = shown ? await page.$eval('#vera-boot', e => e.innerText) : '';
      check('lite @' + width + ': a blocked script shows “VERA couldn’t start” instead of white', /VERA couldn’t start/.test(t) && /babel\.min\.js/.test(t), t.slice(0, 160));
      check('lite @' + width + ': the guard has a Reload button and no sideways scroll', /Reload/.test(t) && await noSideways(page));
      await ctx.close();
    }
    if (GUARD) {
      const { ctx, page } = await open(browser, 'full', 390);
      await page.evaluate(() => { document.getElementById('root').innerHTML = ''; });
      const shown = await page.waitForSelector('#vera-boot', { timeout: 15000 }).then(() => true).catch(() => false);
      const t = shown ? await page.$eval('#vera-boot', e => e.innerText) : '';
      check('full @390: an empty page with no error says it is still loading', /VERA is still loading/.test(t), t.slice(0, 120));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
