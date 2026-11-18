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
const helpers = ((APP.match(/var TM_DAY_COLORS=\[[^\]]*\];/) || [''])[0]) + '\n' + fnSrc(APP, 'tmStops_') + '\n' + fnSrc(APP, 'tmDayLabel_');

console.log('\nstops in order');
{
  const c = {}; vm.createContext(c); vm.runInContext(helpers, c);
  const items = [
    { type: 'activity', title: 'Tram 28', date: '2027-06-13', startTime: '10:00', location: 'Largo Martim Moniz, Lisbon' },
    { type: 'hotel', title: 'Check in', date: '2027-06-12', startTime: '15:00', location: 'Rua Augusta 1, Lisbon' },
    { type: 'flight', title: 'TP 202', date: '2027-06-12', startTime: '07:30', location: 'Lisbon Airport' },
    { type: 'note', title: 'No place', date: '2027-06-12', startTime: '09:00', location: '' },
    { type: 'activity', title: 'Market', date: '2027-06-13', startTime: '', location: 'Mercado da Ribeira, Lisbon' },
  ];
  const p = c.tmStops_(items);
  check('stops: only items with a place, by date then time, all-day first that day, numbered from 1', p.stops.map(s => s.n + ':' + s.item.title).join() === '1:TP 202,2:Check in,3:Market,4:Tram 28', p.stops.map(s => s.n + ':' + s.item.title).join());
  check('one colour per day, the same for every stop that day', p.stops[0].color === p.stops[1].color && p.stops[2].color === p.stops[3].color && p.stops[0].color !== p.stops[2].color);
  check('days for the legend, with their stop counts', JSON.stringify(p.days.map(d => d.date + ':' + d.count)) === JSON.stringify(['2027-06-12:2', '2027-06-13:2']));
  const many = c.tmStops_(Array.from({ length: 10 }, (_, i) => ({ title: 'd' + i, date: '2027-07-' + String(i + 1).padStart(2, '0'), location: 'x' })));
  check('colours repeat after the palette runs out, never blank', many.days.every(d => /^#[0-9a-f]{6}$/i.test(d.color)) && many.days[8].color === many.days[0].color);
  check('day labels: weekday and date, or "No date"', /Jun/.test(c.tmDayLabel_('2027-06-12')) && c.tmDayLabel_('') === 'No date');
}

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
${helpers}
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

  // The drawing, against a stand-in for Google's library: numbered markers in each day's colour,
  // a line with an arrow from each found stop to the next, a stop that can't be found skipped.
  const DRAW = '<!doctype html><html><head><meta charset="utf-8"><script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>'
    + `localStorage.clear(); localStorage.setItem('vera_maps_key','AIzaTypedHERE');
var VERA_TOKEN_KEY='vera_token'; var ITIN_TYPE_ICON={hotel:'🏨'};
function stored(key,fallback=''){return localStorage.getItem(key)||fallback;}
function apiGet(){ return Promise.resolve({ ok: true, key: '' }); }
window.MARKERS = []; window.LINES = [];
var SPOTS = { 'Lisbon Airport': [38.77, -9.13], 'Rua Augusta 1, Lisbon': [38.71, -9.14], 'Nowhere at all': null, 'Porto, Portugal': [41.15, -8.61] };
function LL(a, b) { this.a = a; this.b = b; } LL.prototype.lat = function() { return this.a; }; LL.prototype.lng = function() { return this.b; };
window.google = { maps: { SymbolPath: { CIRCLE: 0, FORWARD_CLOSED_ARROW: 1 },
  Map: function() { this.fitBounds = function() {}; }, LatLngBounds: function() { this.extend = function() {}; },
  Geocoder: function() { this.geocode = function(q, cb) { var s = SPOTS[q.address]; setTimeout(function() { s ? cb([{ geometry: { location: new LL(s[0], s[1]) } }], 'OK') : cb([], 'ZERO_RESULTS'); }, 5); }; },
  Marker: function(o) { MARKERS.push({ n: o.label.text, color: o.icon.fillColor, title: o.title }); },
  Polyline: function(o) { LINES.push({ from: o.path[0].lat(), to: o.path[1].lat(), color: o.strokeColor, arrow: o.icons && o.icons[0] && o.icons[0].icon.path === 1 && o.icons[0].offset }); } } };
function loadGoogleMapsScript() { return Promise.resolve(); }
let _mapsBrowserKey='';
${helpers}
${block}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(TripMapView, { items: [
  { type: 'hotel', title: 'Check in', date: '2027-06-12', startTime: '15:00', location: 'Rua Augusta 1, Lisbon' },
  { type: 'flight', title: 'TP 202', date: '2027-06-12', startTime: '07:30', location: 'Lisbon Airport' },
  { type: 'activity', title: 'Lost one', date: '2027-06-13', startTime: '09:00', location: 'Nowhere at all' },
  { type: 'activity', title: 'Porto day', date: '2027-06-13', startTime: '11:00', location: 'Porto, Portugal' } ] }));`
    + '</script></body></html>';
  for (const width of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/*', r => { const u = r.request().url(), f = Object.keys(vendor).find(n => u.endsWith('/' + n));
      if (f) return r.fulfill({ status: 200, contentType: 'text/javascript', body: vendor[f] });
      return r.fulfill({ status: 200, contentType: 'text/html', body: DRAW }); });
    await page.goto('http://maps.test/'); await page.waitForTimeout(400);
    const M = await page.evaluate(() => MARKERS), L = await page.evaluate(() => LINES), legend = await page.evaluate(() => (document.querySelector('.tm-legend') || {}).innerText || '');
    const W = width + 'px';
    check(W + ': markers are numbered in itinerary order; the stop that can’t be found is skipped', M.map(m => m.n).sort().join() === '1,2,4' && /^1\. ✈|^1\. 📍/.test(M.find(m => m.n === '1').title) && /^2\. 🏨 Check in/.test(M.find(m => m.n === '2').title), JSON.stringify(M));
    check(W + ': each day has its own marker colour', M.find(m => m.n === '1').color === M.find(m => m.n === '2').color && M.find(m => m.n === '4').color !== M.find(m => m.n === '1').color);
    check(W + ': a line with an arrow halfway from each found stop to the next, skipping the missing one', L.length === 2 && L[0].from === 38.77 && L[0].to === 38.71 && L[1].from === 38.71 && L[1].to === 41.15 && L.every(l => l.arrow === '50%'), JSON.stringify(L));
    check(W + ': the line into a new day takes that day’s colour', L[1].color === M.find(m => m.n === '4').color && L[0].color === M.find(m => m.n === '2').color);
    check(W + ': a legend lists each day and its stops', /Jun 12.*2 stops/.test(legend) && /Jun 13.*2 stops/.test(legend) && !errs.length, legend + ' ' + errs.join('|'));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(W + ': no sideways scroll', over <= 0, String(over));
    await ctx.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed — ' + e.message); process.exit(1); });
