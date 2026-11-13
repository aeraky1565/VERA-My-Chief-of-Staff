// #243 in the browser: the install tip on an iPhone (Share › Add to Home Screen), on Android
// (Chrome's Install, with the Install button once Chrome offers it), never on a computer or
// once installed, gone for good after "Got it"; and the offline page. Full dashboard at 390.
const { chromium, devices } = require('playwright');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function mount(browser, ua, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 390, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  if (o.standalone) await page.addInitScript(() => { Object.defineProperty(window.navigator, 'standalone', { value: true }); });
  await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof VeraInstallTip === 'function', null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => {
    const root = document.getElementById('root'); if (root) root.style.display = 'none';
    const host = document.createElement('div'); host.id = 'tip'; host.style.padding = '0 12px'; document.body.prepend(host);
    window.__tipRoot = ReactDOM.createRoot(host); window.__tipRoot.render(React.createElement(VeraInstallTip, null));
  });
  await wait(200);
  return { ctx, page, errs, text: () => page.$eval('#tip', n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '') };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  console.log('\niPhone');
  let m = await mount(browser, IPHONE);
  let t = await m.text();
  check('the tip shows, with Safari’s Share › Add to Home Screen', /Put VERA on your home screen/.test(t) && /Tap Share \(the square with the arrow\) in Safari/.test(t) && /Tap Add to Home Screen/.test(t), t);
  check('…and says the code is entered once in the app', /enter your sign-in code once/.test(t));
  check('…no Install button on iPhone', !/\bInstall\b/.test(t.replace('Install app', '')));
  await m.page.click('#tip button:has-text("Got it")'); await wait(150);
  check('Got it: gone', (await m.text()) === '');
  await m.page.evaluate(() => { window.__tipRoot.render(React.createElement('div', null)); window.__tipRoot.render(React.createElement(VeraInstallTip, null)); }); await wait(150);
  check('…and stays gone', (await m.text()) === '' && await m.page.evaluate(() => localStorage.getItem('vera_install_tip_done')) === '1');
  check('no page errors', m.errs.length === 0, m.errs.join(' | '));
  await m.ctx.close();

  m = await mount(browser, IPHONE, { standalone: true });
  check('opened from the home-screen icon: no tip', (await m.text()) === '');
  await m.ctx.close();

  console.log('\nAndroid');
  m = await mount(browser, ANDROID);
  t = await m.text();
  check('the tip shows Chrome’s ⋮ › Install app', /In Chrome, tap ⋮ then Install app/.test(t) && !/Share/.test(t), t);
  await m.page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  await wait(200);
  t = await m.text();
  check('once Chrome offers it: an Install button', /Tap Install below/.test(t) && (await m.page.$('#tip button:has-text("Install")')) !== null, t);
  await m.page.click('#tip button:has-text("Install")'); await wait(200);
  check('Install opens Chrome’s prompt, and the tip goes', await m.page.evaluate(() => window.__prompted) === true && (await m.text()) === '');
  await m.ctx.close();

  console.log('\nComputer');
  m = await mount(browser, DESKTOP);
  check('no tip on a computer', (await m.text()) === '');
  await m.ctx.close();

  console.log('\nOffline page');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 } }); const p = await ctx.newPage();
  await p.goto('file://' + path.resolve(ROOT, 'docs/offline.html'));
  const ot = await p.$eval('body', n => n.innerText.replace(/\s+/g, ' ').trim());
  check('No connection, why, and Try again', /No connection/.test(ot) && /needs a connection to load/.test(ot) && (await p.$('button:has-text("Try again")')) !== null, ot);
  check('fits a phone', await p.evaluate(() => document.documentElement.scrollWidth) <= 390);
  await ctx.close();

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
