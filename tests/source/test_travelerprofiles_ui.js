// Travel › Travelers › Profiles: TravelerProfilesPanel (shared verbatim by both dashboards), at
// phone and desktop width. The page runs the real TravelerProfiles.js as its server, over an
// in-memory sheet, with invented people and numbers.
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
const SRV = fs.readFileSync(path.join(ROOT, 'TravelerProfiles.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const START = '// ---- TravelerProfilesPanel (Travel › Travelers › Profiles, issue #227) — SHARED VERBATIM', END = '// ---- /TravelerProfilesPanel ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };

console.log('\nthe source');
check('both dashboards carry it, word for word', block(APP).length > 5000 && block(APP) === block(LITE));
check('the full dashboard shows it at Travel › Travelers › Profiles', /sub==='profiles'&&\/\*#__PURE__\*\/React\.createElement\(TravelerProfilesPanel,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
check('lite has a Profiles tab and shows it there', /const LITE_TRAVEL_TABS = \[\{ id: 'trips', label: '✈️ My Trips' \}, \{ id: 'profiles', label: '👤 Profiles' \}, \{ id: 'gifts', label: '🎁 Gifts' \}\];/.test(LITE)
  && /\{travSub === 'profiles' && <TravelerProfilesPanel apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>\}/.test(LITE));

const HEAD = (CODE.match(/const TRAVELER_ITEM_HEADERS\s*=\s*(\[[^\]]*\])/) || [])[1];
const server = (o) => `
var ROWS = [${HEAD}].concat(${JSON.stringify(o.rows || [])});
var SHEET = { getLastRow: function() { return ROWS.length; },
  getRange: function(r, c, n, w) { return { getValues: function() { return ROWS.slice(r - 1, r - 1 + n).map(function(x) { var o = []; for (var i = 0; i < w; i++) o.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return o; }); },
    setValues: function(v) { v.forEach(function(row, i) { row.forEach(function(x, j) { ROWS[r - 1 + i][c - 1 + j] = x; }); }); } }; },
  appendRow: function(r) { ROWS.push(r.slice()); }, deleteRow: function(r) { ROWS.splice(r - 1, 1); } };
var TABS = { TRAVELER_ITEMS: 'Traveler Items', TRAVELER_PROFILES: 'Traveler Profiles', CARD_PERKS: 'Card Perks' }, TRAVELER_ITEM_HEADERS = ${HEAD};
var LockService = { getScriptLock: function() { return { waitLock: function() {}, releaseLock: function() {} }; } };
var PropertiesService = { getScriptProperties: function() { return { getProperty: function() { return 'done'; }, setProperty: function() {} }; } };
var Session = { getScriptTimeZone: function() { return 'UTC'; } }, Utilities = { formatDate: function() { return '2027-03-01'; } }, Logger = { log: function() {} };
function getSpreadsheet() { return { getSheetByName: function() { return null; } }; } function ensureSheet() { return SHEET; }
function getConfigValues() { return {}; } function fpReadSettings_() { return ${JSON.stringify(o.fp || { phase: 'plan' })}; }
function webGetPrescriptions_() { return { prescriptions: [{ id: 'RX-1', person: 'Sam', medication: 'Inhaler', refillDate: '2027-03-20' }] }; }
window.POSTS = [];
${SRV}
function apiGet(u, t, p) { return Promise.resolve(JSON.parse(JSON.stringify(webTpGet_()))); }
function apiPost(u, t, b) { POSTS.push(b); var f = ({ tp_save: webTpSave_, tp_delete: webTpDelete_ })[b.action]; var r = f ? f(b) : { ok: false, error: 'unknown action' }; r = JSON.parse(JSON.stringify(r));
  return r.ok ? Promise.resolve(r) : Promise.reject(new Error(r.error)); }
window.confirm = function() { return true; };
`;
const ROWS = [
  ['TI-1', 'Sam', 'document', 'passport', '', 'Canada', '', '', '2027-06-30', '', '', 'blue cover', ''],
  ['TI-2', 'Sam', 'document', 'eta', '', 'United Kingdom', '', '', '2029-01-01', '', '', '', ''],
  ['TI-3', 'Lee', 'document', 'passport', '', 'Ireland', '', '', '2033-02-02', '', '', '', ''],
  ['TI-4', 'Sam', 'membership', 'airline', 'United', '', '4455', '', '', 'Gold', 'Star Alliance', '', ''],
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'), 'react-dom.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8') };
  const shell = body => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0b1020;color:#dde1f0;font-family:sans-serif}</style>'
    + '<script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>' + body + '</script></body></html>';
  const open = async (width, o) => {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const probe = server(o) + block(APP) + "\nReactDOM.createRoot(document.getElementById('root')).render(React.createElement(TravelerProfilesPanel, { apiUrl: 'x', apiToken: 'y', who: " + JSON.stringify(o.who || '') + " }));";
    await page.route('**/*', r => { const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] }); return r.fulfill({ contentType: 'text/html', body: shell(probe) }); });
    await page.goto('http://probe.local/'); await page.waitForSelector('.tp-sec', { timeout: 5000 }).catch(() => {}); await wait(120);
    return { page, errs };
  };
  const tap = async (page, sel) => { const el = await page.$(sel); if (el) await el.click(); await wait(150); return !!el; };
  const text = (page, sel) => page.$eval(sel, n => n.innerText).catch(() => '');
  for (const width of [390, 1280]) {
    const L = '@' + width;
    let { page, errs } = await open(width, { rows: ROWS });
    check(L + ': a chip per person, the first one shown', (await page.$$eval('.tp-person', ns => ns.map(n => n.dataset.p).join())) === 'Sam,Lee' && (await page.$eval('.tp-person[aria-pressed="true"]', n => n.dataset.p)) === 'Sam');
    check(L + ': five sections, each saying what it’s used for; no Children before a birth', (await page.$$eval('.tp-sec', ns => ns.map(n => n.dataset.sec).join())) === 'document,trusted,membership,preference,health'
      && (await page.$$eval('.tp-used', ns => ns.every(n => n.innerText.length > 20))));
    const docs = await text(page, '.tp-sec[data-sec="document"]');
    check(L + ': documents: the passport with its expiry chip and note, and the ETA', /Passport[\s\S]*Canada[\s\S]*Expires 2027-06-30[\s\S]*blue cover/.test(docs) && /ETA[\s\S]*United Kingdom[\s\S]*Valid to 2029-01-01/.test(docs), docs);
    check(L + ': a passport running out in 4 months is red', (await page.$eval('.tp-item[data-id="TI-1"] .tp-exp', n => n.dataset.tone)) === 'bad' && (await page.$eval('.tp-item[data-id="TI-2"] .tp-exp', n => n.dataset.tone)) === 'ok');
    check(L + ': memberships show the last 4 only, tier and alliance', /United · ••4455 · Gold · Star Alliance/.test(await text(page, '.tp-sec[data-sec="membership"]')));
    // add Global Entry with a full number: only the last 4 are kept
    await tap(page, '.tp-add[data-sec="trusted"]');
    check(L + ': the form says only the last 4 are kept', /Only the last 4 are kept/.test(await text(page, '.tp-form')));
    await page.fill('.tp-f-last4', '98 7654 3210').catch(() => {}); await page.fill('.tp-f-expiry', '2027-08-01').catch(() => {});
    await tap(page, '.tp-save'); await wait(150);
    let p = await page.evaluate(() => POSTS.slice(-1)[0] || {});
    check(L + ': saving sends the section, kind and person', p.action === 'tp_save' && p.section === 'trusted' && p.kind === 'global_entry' && p.person === 'Sam', JSON.stringify(p));
    check(L + ': and says it kept the last 4 only; the row shows ••3210', /Kept the last 4 only/.test(await text(page, '.tp-msg')) && /Global Entry[\s\S]*••3210/.test(await text(page, '.tp-sec[data-sec="trusted"]'))
      && (await page.evaluate(() => ROWS.slice(-1)[0][6])) === '3210');
    // switch person
    await tap(page, '.tp-person[data-p="Lee"]');
    check(L + ': switching shows Lee’s items only', /Ireland/.test(await text(page, '.tp-sec[data-sec="document"]')) && !/Canada/.test(await text(page, '.tp-sec[data-sec="document"]')));
    // add a medication linked to a prescription, for Sam
    await tap(page, '.tp-person[data-p="Sam"]');
    await tap(page, '.tp-add[data-sec="health"]');
    await page.selectOption('.tp-kind', 'medication').catch(() => {}); await wait(60);
    await page.fill('.tp-f-label', 'Inhaler').catch(() => {}); await page.selectOption('.tp-f-value', 'RX-1').catch(() => {});
    await tap(page, '.tp-save');
    check(L + ': a medication links to its prescription and shows the refill', /Regular medication[\s\S]*Inhaler · Rx: Inhaler \(refill 2027-03-20\)/.test(await text(page, '.tp-sec[data-sec="health"]')), await text(page, '.tp-sec[data-sec="health"]'));
    // edit the ETA's expiry
    if (await tap(page, '.tp-item[data-id="TI-2"] .tp-edit')) { await page.fill('.tp-f-expiry', '2030-05-05'); await tap(page, '.tp-save'); }
    check(L + ': Edit saves the change in place', /Valid to 2030-05-05/.test(await text(page, '.tp-item[data-id="TI-2"]')) && (await page.evaluate(() => POSTS.slice(-1)[0].id)) === 'TI-2');
    // delete
    await tap(page, '.tp-item[data-id="TI-2"] .tp-del');
    check(L + ': × removes it', !(await page.$('.tp-item[data-id="TI-2"]')) && (await page.evaluate(() => POSTS.slice(-1)[0].action)) === 'tp_delete');
    // a bad save says why
    await tap(page, '.tp-add[data-sec="document"]'); await page.selectOption('.tp-kind', 'visa').catch(() => {}); await tap(page, '.tp-save');
    check(L + ': a visa with no country says why, and keeps the form open', /Which country is it for\?/.test(await text(page, '.tp-msg')) && !!(await page.$('.tp-form')));
    await tap(page, '.tp-cancel');
    // a new person
    await tap(page, '.tp-add-person'); await page.fill('.tp-new-name', 'Kit').catch(() => {}); await tap(page, '.tp-new-ok');
    check(L + ': ＋ Person starts an empty profile', (await page.$eval('.tp-person[aria-pressed="true"]', n => n.dataset.p).catch(() => '')) === 'Kit' && /Nothing here yet/.test(await text(page, '.tp-sec[data-sec="document"]')));
    const sizes = await page.$$eval('.tp-panel button', ns => ns.filter(n => n.offsetParent).map(n => n.getBoundingClientRect().height));
    check(L + ': every button is at least 36 px tall', sizes.length > 5 && sizes.every(x => x >= 35.5), JSON.stringify(sizes.filter(x => x < 35.5)));
    check(L + ': no sideways scroll, no errors', (await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)) && errs.length === 0, errs.join(' | '));
    await page.close();

    ({ page, errs } = await open(width, { rows: ROWS, fp: { phase: 'back' }, who: 'Lee' }));
    check(L + ': after a birth, the Children section appears', (await page.$$eval('.tp-sec', ns => ns.map(n => n.dataset.sec).join())).endsWith(',child') && /5 years/.test(await text(page, '.tp-sec[data-sec="child"]')));
    check(L + ': it opens on whoever is looking', (await page.$eval('.tp-person[aria-pressed="true"]', n => n.dataset.p)) === 'Lee');
    await page.close();
  }
  {
    const { page, errs } = await open(390, { rows: [] });
    check('empty: says to add a person', /Add a person to start a profile/.test(await text(page, '.tp-panel')) && errs.length === 0);
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
