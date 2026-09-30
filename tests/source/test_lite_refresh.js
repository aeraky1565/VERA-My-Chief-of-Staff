// Loads the REAL docs/dashboard-lite.html in Chromium and clicks the real
// header refresh button, asserting it performs a cache-busting navigation
// rather than a single-panel fetch.
//
// The page pulls React and Babel from unpkg, which this sandbox may block, so
// those three <script src> tags are served from local copies. Everything that
// matters here — the page's own <script type="text/babel"> block, including the
// button and its handler — is the real file, untouched.

const { chromium } = require('playwright');
const fs = require('fs');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

const LITE = ROOT + '/docs/dashboard-lite.html';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const html = fs.readFileSync(LITE, 'utf8');

  // Serve the page and its three vendor scripts from routes, so no real network
  // is needed and the page boots exactly as it does in a browser.
  const vendor = {
    'react.production.min.js': fs.readFileSync(ROOT + '/docs/react.min.js', 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(ROOT + '/docs/react-dom.min.js', 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };

  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('https://vera.test/')) {
      return route.fulfill({ contentType: 'text/html', body: html });
    }
    for (const name of Object.keys(vendor)) {
      if (url.includes(name)) {
        return route.fulfill({ contentType: 'application/javascript', body: vendor[name] });
      }
    }
    // Any API call answers benignly — this test is about the button, not data.
    return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
  });

  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));

  // Without stored credentials the page opens its settings modal, whose overlay
  // covers the header and swallows the click. Seed localStorage so the app
  // boots to its normal state — this is about the harness, not the button.
  await page.addInitScript(() => {
    localStorage.setItem('vera_url', 'https://vera.test/exec');
    localStorage.setItem('vera_token', 'test-token');
  });

  await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.btn-refresh', { timeout: 15000 });

  check('page boots and renders the header refresh button', true);
  check('settings modal is not covering the header',
        await page.locator('.modal-overlay').count() === 0);

  const before = page.url();
  check('starts with no cache-buster', !before.includes('_r='), before);

  const btn = page.locator('.btn-refresh');
  check('button is enabled', await btn.isEnabled());
  check('title describes a hard refresh',
        /hard refresh/i.test(await btn.getAttribute('title')),
        await btn.getAttribute('title'));

  // Click and wait for the navigation the handler triggers.
  await Promise.all([
    page.waitForURL(/_r=\d+/, { timeout: 10000 }),
    btn.click(),
  ]);

  const after = page.url();
  check('clicking navigates with a cache-busting param', /[?&]_r=\d+/.test(after), after);
  check('it is a real reload, not a fragment change',
        after.split('#')[0] !== before.split('#')[0], before + ' -> ' + after);

  // Click again: the param must be replaced, not appended.
  await page.waitForSelector('.btn-refresh');
  const first = new URL(after).searchParams.get('_r');
  await Promise.all([
    page.waitForFunction(f => new URL(location.href).searchParams.get('_r') !== f, first, { timeout: 10000 }),
    page.locator('.btn-refresh').click(),
  ]);
  const third = page.url();
  const count = (third.match(/_r=/g) || []).length;
  check('a second refresh replaces the param rather than appending', count === 1,
        count + ' occurrences in ' + third);
  check('the value actually changed', new URL(third).searchParams.get('_r') !== first);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
