// The dashboard's trip map key comes from VERA (Script Property GOOGLE_MAPS_BROWSER_KEY) so every
// device has it without typing it into Settings. Server: owner only, the browser key only, never the
// server's GOOGLE_STATIC_MAPS_API_KEY. Screen: TripMapView uses a key typed on this device first,
// else asks VERA once, else says how to add one. Invented keys.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const PAGES = process.env.VERA_PAGES_ROOT || ROOT;
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const APP = fs.readFileSync(path.join(PAGES, 'docs/app.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const fnSrc = (src, name) => { const i = src.indexOf('function ' + name + '('); if (i === -1) return ''; let d = 0;
  for (let j = src.indexOf('{', src.indexOf(')', i)); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1); } return ''; };

console.log('\nthe server');
check('maps_browser_key is routed', /case 'maps_browser_key':\s*return jsonOut_\(webMapsBrowserKey_\(\)\);/.test(WEB));
const server = (owner, props) => {
  const c = { String, PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props || {})[k] || null }) },
    peopleOwnerOnly_: () => owner ? null : { ok: false, error: 'Only the owner can do that' } };
  vm.createContext(c); vm.runInContext(fnSrc(WEB, 'webMapsBrowserKey_'), c); return c.webMapsBrowserKey_();
};
const KEYS = { GOOGLE_MAPS_BROWSER_KEY: ' AIzaBrowserTEST ', GOOGLE_STATIC_MAPS_API_KEY: 'AIzaServerSECRET' };
const own = server(true, KEYS);
check('the owner gets the browser key, trimmed', own.ok && own.key === 'AIzaBrowserTEST', JSON.stringify(own));
check('the server key is never sent', JSON.stringify(own).indexOf('Server') === -1 && /getProperty\('GOOGLE_MAPS_BROWSER_KEY'\)/.test(fnSrc(WEB, 'webMapsBrowserKey_')) && fnSrc(WEB, 'webMapsBrowserKey_').indexOf("getProperty('GOOGLE_STATIC_MAPS_API_KEY')") === -1);
const other = server(false, KEYS);
check('anyone else is refused, with no key', other.ok === false && other.key === undefined && /owner/.test(other.error));
check('not set: an empty key, not an error', server(true, {}).ok && server(true, {}).key === '');

console.log('\nthe trip map');
const block = fnSrc(APP, 'TripMapView');
const loader = fnSrc(APP, 'loadGoogleMapsScript');
check('TripMapView and the loader are in app.js', block.length > 500 && loader.length > 100 && /let _mapsBrowserKey='';/.test(APP));
check('the Settings hint explains the shared key', APP.indexOf('Leave it blank to use the Script Property GOOGLE_MAPS_BROWSER_KEY') !== -1);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.js': fs.readFileSync(path.resolve(PAGES, 'docs/react.min.js'), 'utf8'), 'react-dom.js': fs.readFileSync(path.resolve(PAGES, 'docs/react-dom.min.js'), 'utf8') };
  const page_ = (local, served, fails) => '<!doctype html><html><head><meta charset="utf-8"><script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>'
    + `localStorage.clear(); ${local ? "localStorage.setItem('vera_maps_key'," + JSON.stringify(local) + ");" : ''}
localStorage.setItem('vera_url','https://example.test/exec'); localStorage.setItem('vera_token','tok');
window.CALLS = []; window.LOADED = [];
var VERA_TOKEN_KEY='vera_token'; var ITIN_TYPE_ICON={};
function stored(key,fallback=''){return localStorage.getItem(key)||fallback;}
function apiGet(u, t, p) { CALLS.push(p.action); return ${fails ? "Promise.reject(new Error('Only the owner can do that'))" : 'Promise.resolve({ ok: true, key: ' + JSON.stringify(served || '') + ' })'}; }
function loadGoogleMapsScript(k) { LOADED.push(k); return new Promise(function() {}); }
let _mapsBrowserKey='';
${block}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(TripMapView, { items: [{ type: 'hotel', title: 'Hotel', location: 'Rua Augusta 1, Lisbon, Portugal' }] }));`
    + '</script></body></html>';
  const run = async (label, local, served, fails) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 700 } });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/*', r => { const u = r.request().url(), f = Object.keys(vendor).find(n => u.endsWith('/' + n));
      if (f) return r.fulfill({ status: 200, contentType: 'text/javascript', body: vendor[f] });
      return r.fulfill({ status: 200, contentType: 'text/html', body: page_(local, served, fails) }); });
    await page.goto('http://maps.test/'); await page.waitForTimeout(400);
    const out = { calls: await page.evaluate(() => CALLS), loaded: await page.evaluate(() => LOADED), text: await page.evaluate(() => document.body.innerText), errs };
    await ctx.close(); return out;
  };
  const a = await run('served', '', 'AIzaBrowserTEST');
  check('no key on this device: VERA is asked once and the map loads with its key', a.calls.join() === 'maps_browser_key' && a.loaded.join() === 'AIzaBrowserTEST' && !a.errs.length, JSON.stringify(a));
  const b = await run('local', 'AIzaTypedHERE', 'AIzaBrowserTEST');
  check('a key typed into Settings on this device wins, and VERA isn’t asked', b.calls.length === 0 && b.loaded.join() === 'AIzaTypedHERE' && !b.errs.length, JSON.stringify(b));
  const c = await run('none', '', '');
  check('no key anywhere: it says how to add one, and loads nothing', c.calls.join() === 'maps_browser_key' && c.loaded.length === 0 && /GOOGLE_MAPS_BROWSER_KEY/.test(c.text) && /Settings/.test(c.text), JSON.stringify(c));
  const d = await run('refused', '', '', true);
  check('VERA refuses (not the owner): the same how-to, no error', d.loaded.length === 0 && /GOOGLE_MAPS_BROWSER_KEY/.test(d.text) && !d.errs.length, JSON.stringify(d));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed — ' + e.message); process.exit(1); });
