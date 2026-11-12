// Who's travelling and the Travel Day email (issue #233): System › Trip emails (TripEmailsPanel) and
// the box on each trip's summary (TsTripPeople), both in the TripSummaryView block shared verbatim by
// the two dashboards, at phone and desktop width. The page runs the real TripEmails.js as its server
// over in-memory sheets. Invented people and addresses.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
// Settings.js (veraOnceGet_ …) rides along: from ROOT when a control copied it there, else the repo.
const SETTINGS_SRC = fs.readFileSync(fs.existsSync(path.join(ROOT, 'Settings.js')) ? path.join(ROOT, 'Settings.js') : path.join(__dirname, '..', '..', 'Settings.js'), 'utf8');
const SRV = SETTINGS_SRC + '\n' + fs.readFileSync(path.join(ROOT, 'TripEmails.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const cut = s => { const a = s.indexOf('// Who\'s travelling and who gets the Travel Day email (TripEmails.js, issue #233)'), b = s.indexOf('// Readiness per traveller (TripReadiness.js, issue #227)'); return a === -1 || b === -1 ? '' : s.slice(a, b); };
const TS = s => { const a = s.indexOf('// ---- TripSummaryView (itinerary redesign)'), b = s.indexOf('// ---- /TripSummaryView ----'); return a === -1 || b === -1 ? '' : s.slice(a, b); };

console.log('\nthe source');
check('the pieces sit in the shared trip summary block, word for word in both dashboards', cut(APP).length > 8000 && cut(APP) === cut(LITE) && TS(APP).indexOf(cut(APP)) !== -1 && TS(APP) === TS(LITE));
check('every trip summary shows the box, before Readiness', /h\(TsTripPeople,\{trip:trip,apiUrl:props\.apiUrl,apiToken:props\.apiToken,card:card,label:label\}\),\n    h\(TsReadinessSection,/.test(TS(APP)));
check('System › Settings › Trip emails', /\{id:'trip_emails',label:'✉️ Trip emails'\}/.test(APP) && /items:\['notifications','trip_emails','config','flags'\]/.test(APP) && /cur==='trip_emails'&&h\(TripEmailsPanel,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
check('the Test tab says a test is yours only', /"A test goes to you only\."/.test(APP) && APP.indexOf('test-to-all') === -1);

const THEAD = (CODE.match(/const TRIPS_HEADERS\s*=\s*(\[[^\]]*\])/) || [])[1];
const server = o => `
var TRIPS = ${JSON.stringify(o.trips)}.map(function(t, i) { return Object.assign({ status: 'active', recipients: '', _row: i + 2 }, t); });
var META = ${JSON.stringify(o.meta)}, PROPS = {}, TRIPS_HEADERS = ${THEAD};
var CONFIG = { MORNING_NUDGE_EMAIL: 'me@example.test' };
var Session = { getScriptTimeZone: function() { return 'UTC'; } }, Utilities = { formatDate: function() { return '2027-03-01'; } }, Logger = { log: function() {} };
var LockService = { getScriptLock: function() { return { waitLock: function() {}, releaseLock: function() {} }; } };
var PropertiesService = { getScriptProperties: function() { return { getProperty: function(k) { return PROPS[k] || null; }, setProperty: function(k, v) { PROPS[k] = v; } }; } };
function getConfigValues() { return ${JSON.stringify(o.cfg)}; }
function tpItems_() { return ${JSON.stringify(o.items)}; }
function readTripRegistry_() { var byId = {}; TRIPS.forEach(function(t) { byId[t.tripId] = t; }); return { byId: byId, rows: TRIPS }; }
function invalidateTripRegistry_() {}
function tripIdForKey_(k) { var t = TRIPS.filter(function(x) { return x.startDate + '|' + x.label === k; })[0]; return t ? t.tripId : ''; }
function webGetTripMeta_(e) { return { ok: true, traveler: META[e.parameter.tripKey] || '' }; }
function webSetTripMeta_(e) { META[e.parameter.tripKey] = e.parameter.traveler; return { ok: true }; }
function getTripsSheet_() { return { getRange: function(r) { return { setValue: function(v) { TRIPS.forEach(function(t) { if (t._row === r) t.recipients = v; }); } }; } }; }
window.CALLS = []; window.POSTS = [];
${SRV}
var BOOK = { ok: true, people: [{ id: 'p1', name: 'Lee Park', email: 'lee.park@example.test' }, { id: 'p2', name: 'Leena Haddad', email: '' }] };
function apiGet(u, t, p) { CALLS.push(p); var f = { te_get: function() { return webTeGet_(); }, te_trip: function() { return webTeTrip_(p); }, address_book: function() { return BOOK; } }[p.action];
  return f ? Promise.resolve(JSON.parse(JSON.stringify(f()))) : Promise.reject(new Error('unknown')); }
function apiPost(u, t, b) { POSTS.push(b); var f = { te_set: webTeSet_, te_legacy: webTeLegacy_ }[b.action]; var r = f ? f(b) : { ok: false, error: 'unknown' };
  r = JSON.parse(JSON.stringify(r)); return r.ok ? Promise.resolve(r) : Promise.reject(new Error(r.error)); }
`;
const FIX = {
  trips: [{ tripId: 'TRIP-1', label: 'Chicago wedding', startDate: '2027-05-15', endDate: '2027-05-18', recipients: '' },
          { tripId: 'TRIP-2', label: 'Girls weekend', startDate: '2027-06-20', endDate: '2027-06-22', recipients: '' },
          { tripId: 'TRIP-3', label: 'Denver work', startDate: '2027-04-01', endDate: '2027-04-03', recipients: '' }],
  meta: { '2027-05-15|Chicago wedding': 'Both', '2027-06-20|Girls weekend': 'Victoria', '2027-04-01|Denver work': 'Ahmed' },
  cfg: { victoria_email: 'partner@example.test', travel_companions: 'friend@example.test' },
  items: [{ person: 'Ahmed', section: 'document', kind: 'passport' }, { person: 'Victoria', section: 'document', kind: 'passport' },
          { person: 'Kit Moreno', section: 'contact', kind: 'email', value: 'kit@example.test' }],
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'), 'react-dom.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8') };
  const shell = body => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0b1020;color:#dde1f0;font-family:sans-serif}</style>'
    + '<script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>' + body + '</script></body></html>';
  const open = async (width, mount, o) => {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const probe = server(o || FIX) + cut(APP) + "\nvar card={background:'#0d1b3e',border:'1px solid #1e3060',borderRadius:12,padding:14,display:'flex',flexDirection:'column',gap:10};var label={fontSize:11};\n" + mount;
    await page.route('**/*', r => { const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] }); return r.fulfill({ contentType: 'text/html', body: shell(probe) }); });
    await page.goto('http://probe.local/'); await wait(300);
    return { page, errs };
  };
  const tap = async (page, sel) => { const el = await page.$(sel); if (el) await el.click(); await wait(150); return !!el; };
  const text = (page, sel) => page.$eval(sel, n => n.innerText).catch(() => '');
  const PANEL = "ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(TripEmailsPanel,{apiUrl:'x',apiToken:'y'}));";
  const BOX = "ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(TsTripPeople,{trip:{tripKey:'2027-05-15|Chicago wedding'},apiUrl:'x',apiToken:'y',card:card,label:label}));";
  for (const width of [390, 1280]) {
    const L = '@' + width;
    let { page, errs } = await open(width, PANEL);
    check(L + ': upcoming trips, soonest first', (await page.$$eval('.te-trip', ns => ns.map(n => n.dataset.key).join())) === '2027-04-01|Denver work,2027-05-15|Chicago wedding,2027-06-20|Girls weekend');
    check(L + ': who’s travelling, from the old one-word setting', /Travelling: Ahmed, Victoria/.test(await text(page, '.te-trip[data-key="2027-05-15|Chicago wedding"]')));
    check(L + ': on a trip you both go on, Victoria is off', /Victoria · off/.test(await text(page, '.te-trip[data-key="2027-05-15|Chicago wedding"] .te-chips')));
    check(L + ': her solo trip sends nothing', /No Travel Day email/.test(await text(page, '.te-trip[data-key="2027-06-20|Girls weekend"] .te-chips')));
    check(L + ': the retired shared list, once', /friend@example\.test/.test(await text(page, '.te-legacy')));
    check(L + ': your and Victoria’s addresses are never on the screen', !/me@example\.test|partner@example\.test/.test(await text(page, '.te-panel')));
    await tap(page, '.te-legacy-add'); await wait(150);
    check(L + ': Add to all upcoming trips: your trips get it, her solo one doesn’t; the banner goes', /Added to 2 trips/.test(await text(page, '.te-msg')) && !(await page.$('.te-legacy'))
      && /friend@example\.test/.test(await text(page, '.te-trip[data-key="2027-04-01|Denver work"] .te-chips')) && !/friend/.test(await text(page, '.te-trip[data-key="2027-06-20|Girls weekend"]')));
    // edit Chicago
    await tap(page, '.te-trip[data-key="2027-05-15|Chicago wedding"] .te-edit');
    check(L + ': the editor ticks the travellers and lists everyone with a profile', (await page.$$eval('.te-trav', ns => ns.map(n => n.dataset.name + ':' + n.checked).join())) === 'Ahmed:true,Victoria:true,Kit Moreno:false');
    await tap(page, '.te-trav[data-name="Kit Moreno"]');
    check(L + ': a newly ticked traveller with an email gets a switch, off', (await page.$eval('.te-switch[data-name="Kit Moreno"]', n => n.getAttribute('aria-checked')).catch(() => '')) === 'false');
    await tap(page, '.te-switch[data-name="Victoria"]');
    await page.fill('.te-ab', 'lee'); await wait(150);
    check(L + ': the Address Book: people with an email can be picked, others can’t', (await page.$$eval('.te-ab-pick', ns => ns.map(n => n.disabled).join())) === 'false,true');
    await tap(page, '.te-ab-pick');
    await page.fill('.te-email', 'kit@example'); await tap(page, '.te-add');
    check(L + ': a typed address that isn’t whole is refused', /doesn’t look like a full email/.test(await text(page, '.te-err')));
    await page.fill('.te-email', 'sam@example.test'); await tap(page, '.te-add');
    await tap(page, '.te-save'); await wait(200);
    const p = await page.evaluate(() => POSTS.filter(x => x.action === 'te_set').pop() || {});
    check(L + ': Save sends the travellers and who’s switched on, plus the added addresses', JSON.stringify(p.travellers) === JSON.stringify(['Ahmed', 'Victoria', 'Kit Moreno']) && JSON.stringify(p.tokens) === JSON.stringify(['Victoria', 'friend@example.test', 'lee.park@example.test', 'sam@example.test']), JSON.stringify(p));
    const chips = await text(page, '.te-trip[data-key="2027-05-15|Chicago wedding"] .te-chips');
    check(L + ': saved: Victoria on, Kit off, the added people listed', /Victoria/.test(chips) && !/Victoria · off/.test(chips) && /Kit Moreno · off/.test(chips) && /lee\.park@example\.test/.test(chips), chips);
    check(L + ': the Trips tab and the Traveler cell are written', (await page.evaluate(() => TRIPS[0].recipients)) === 'Victoria; friend@example.test; lee.park@example.test; sam@example.test' && (await page.evaluate(() => META['2027-05-15|Chicago wedding'])) === 'Ahmed, Victoria, Kit Moreno');
    // remove an added address
    await tap(page, '.te-trip[data-key="2027-05-15|Chicago wedding"] .te-edit');
    await tap(page, '.te-del[data-email="sam@example.test"]'); await tap(page, '.te-save'); await wait(200);
    check(L + ': × removes an added address', !/sam@example/.test(await page.evaluate(() => TRIPS[0].recipients)));
    // untick yourself: no email
    await tap(page, '.te-trip[data-key="2027-04-01|Denver work"] .te-edit');
    await tap(page, '.te-trav[data-name="Ahmed"]'); await tap(page, '.te-trav[data-name="Victoria"]');
    check(L + ': a trip you’re not on says no email goes', /no Travel Day email goes/.test(await text(page, '.te-solo')));
    await tap(page, '.te-cancel');
    const sizes = await page.$$eval('.te-panel button', ns => ns.filter(n => n.offsetParent).map(n => n.getBoundingClientRect().height));
    check(L + ': buttons at least 36 px; no sideways scroll; no errors', sizes.every(x => x >= 35.5) && (await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)) && errs.length === 0, errs.join(' | ') + JSON.stringify(sizes.filter(x => x < 35.5)));
    await page.close();

    ({ page, errs } = await open(width, BOX));
    check(L + ': on the trip summary: who’s travelling and who gets it', /Travelling: Ahmed, Victoria/.test(await text(page, '.te-trip-box')) && /Victoria · off/.test(await text(page, '.te-trip-box')));
    await tap(page, '.te-change'); await tap(page, '.te-switch[data-name="Victoria"]'); await tap(page, '.te-save'); await wait(200);
    check(L + ': Change opens the same editor and saves', (await page.evaluate(() => TRIPS[0].recipients)) === 'Victoria' && !/Victoria · off/.test(await text(page, '.te-trip-box')) && errs.length === 0, errs.join(' | '));
    await page.close();
  }
  {
    const { page, errs } = await open(390, "ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('div',null,React.createElement(TsTripPeople,{trip:{tripKey:'2027-09-09|Unknown'},apiUrl:'x',apiToken:'y',card:card,label:label}),React.createElement('p',{id:'after'},'after')));");
    check('a trip the Trips tab doesn’t know shows no box', !(await page.$('.te-trip-box')) && !!(await page.$('#after')) && errs.length === 0);
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
