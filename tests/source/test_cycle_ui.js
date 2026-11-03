// Family Planning › Trying › Cycle: the FpCycleCard (inside the Family Planning block shared
// verbatim by both dashboards), at phone and desktop width. The page runs the real Cycle.js
// as its server, over an in-memory sheet, on invented dates.
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
const CYCLE = fs.readFileSync(path.join(ROOT, 'Cycle.js'), 'utf8');
const cut = s => { const a = s.indexOf('// The Cycle card (Cycle.js), shown under Trying'), b = s.indexOf('function FamilyPlanningPanel(props){'); return a === -1 || b === -1 ? '' : s.slice(a, b); };

console.log('\nthe source');
check('the card is in the shared Family Planning block, word for word in both dashboards', cut(APP).length > 5000 && cut(APP) === cut(LITE));
check('it shows only under Trying, for whoever is looking', [APP, LITE].every(s => s.indexOf("phase==='trying'?h(FpCycleCard,{key:'cy',apiUrl:props.apiUrl,apiToken:props.apiToken,who:who}):null,") !== -1));

const HEAD = "['ID', 'Start', 'End', 'Logged By', 'Logged At', 'Notes']";
const server = today => `
var ROWS = [${HEAD}, ['CY-2', '2027-01-12', '2027-01-16', 'Victoria', '', ''], ['CY-1', '2026-12-14', '2026-12-19', 'Ahmed', '', '']];
var SHEET = { getLastRow: function() { return ROWS.length; },
  getRange: function(r, c, n, w) { return { getValues: function() { return ROWS.slice(r - 1, r - 1 + n).map(function(x) { var o = []; for (var i = 0; i < w; i++) o.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return o; }); },
    setValues: function(v) { v.forEach(function(row, i) { row.forEach(function(x, j) { ROWS[r - 1 + i][c - 1 + j] = x; }); }); } }; },
  appendRow: function(r) { ROWS.push(r.slice()); }, deleteRow: function(r) { ROWS.splice(r - 1, 1); } };
var TABS = { CYCLE_LOG: 'Cycle Log' }, CYCLE_LOG_HEADERS = ${HEAD};
var LockService = { getScriptLock: function() { return { waitLock: function() {}, releaseLock: function() {} }; } };
var Session = { getScriptTimeZone: function() { return 'UTC'; } }, Utilities = { formatDate: function() { return window.TODAY; } };
function getSpreadsheet() { return {}; } function ensureSheet() { return SHEET; } function getConfigValues() { return {}; } function fpReadSettings_() { return { phase: 'trying' }; }
window.TODAY = '${today}'; window.POSTS = [];
${CYCLE}
function apiGet(u, t, p) { return Promise.resolve(JSON.parse(JSON.stringify(webCycleGet_()))); }
function apiPost(u, t, b) { POSTS.push(b); var f = { cycle_log: webCycleLog_, cycle_edit: webCycleEdit_, cycle_end: webCycleEnd_, cycle_delete: webCycleDelete_ }[b.action];
  return Promise.resolve(JSON.parse(JSON.stringify(f ? f(b) : { ok: false }))); }
window.confirm = function() { return true; };
`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'), 'react-dom.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8') };
  const shell = body => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0b1020;color:#dde1f0;font-family:sans-serif}</style>'
    + '<script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>' + body + '</script></body></html>';
  const open = async (width, today, who) => {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const probe = server(today) + cut(APP) + "\nReactDOM.createRoot(document.getElementById('root')).render(React.createElement(FpCycleCard, { apiUrl: 'x', apiToken: 'y', who: '" + (who || 'Victoria') + "' }));";
    await page.route('**/*', r => { const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] }); return r.fulfill({ contentType: 'text/html', body: shell(probe) }); });
    await page.goto('http://probe.local/'); await page.waitForSelector('.cy-card', { timeout: 5000 }).catch(() => {}); await wait(150);
    return { page, errs };
  };
  const txt = page => page.$eval('.cy-card', n => n.innerText);
  const tap = async (page, sel) => { const el = await page.$(sel); if (el) await el.click(); return !!el; };
  for (const width of [390, 1280]) {
    const L = '@' + width;
    // Feb 10: log a period that started yesterday, as Victoria
    let { page, errs } = await open(width, '2027-02-10');
    check(L + ': before logging: the card is up', /Cycle · Trying/.test(await txt(page)));
    await page.click('.cy-start'); await wait(50);
    await page.click('.cy-when[data-when="yesterday"]'); await page.fill('.cy-note', 'cramps'); await page.click('.cy-save'); await wait(250);
    let p = await page.evaluate(() => POSTS.slice(-1)[0]);
    check(L + ': Period started: yesterday, with the note and who', p.action === 'cycle_log' && p.start === '2027-02-09' && p.notes === 'cramps' && p.by === 'Victoria', JSON.stringify(p));
    check(L + ': day 2 with the mood words, and the period phase', (await page.$eval('.cy-card', n => n.dataset.phase)) === 'period' && (await page.$eval('.cy-dayno', n => n.textContent)) === '2' && /Day 2: usually the hardest day/.test(await txt(page)));
    check(L + ': how it usually goes, in one line', /Days 1–2 the hardest day, day 3 better, days 4–5 okay to good\. Go easy\./.test(await txt(page)), await txt(page));
    check(L + ': the average from the log, the next period and the window', /Avg 29 days · range 28–29/.test(await txt(page)) && /Next period[\s\S]*~/.test(await txt(page)) && /Fertile window[\s\S]*peak/.test(await txt(page)), await txt(page));
    check(L + ': the ring and the week strip mark the period', (await page.$$('.cy-card svg path')).length >= 28 && (await page.$$eval('.cy-day', ns => ns.filter(n => n.dataset.kind === 'period').length)) >= 2);
    const hadEnd = await tap(page, '.cy-end'); await wait(250);
    check(L + ': Period ended sends the end for that period', hadEnd && (await page.evaluate(() => POSTS.slice(-1)[0].action)) === 'cycle_end' && !(await page.$('.cy-end')));
    await tap(page, '.cy-hist'); await wait(80);
    check(L + ': history: averages, then each period with who logged it', (await page.$$('.cy-row')).length === 3 && /Logged by Victoria · cramps/.test(await page.$eval('.cy-history', n => n.innerText)) && /avg cycle/.test(await page.$eval('.cy-history', n => n.innerText)));
    { const dels = await page.$$('.cy-del'); if (dels[2]) await dels[2].click(); } await wait(250);
    check(L + ': × deletes an entry', (await page.$$('.cy-row')).length === 2);
    if (await tap(page, '.cy-edit')) { await page.fill('.cy-ed-start', '2027-02-08'); await page.click('.cy-ed-save'); } await wait(250);
    check(L + ': Edit moves a start', (await page.evaluate(() => POSTS.slice(-1)[0].start)) === '2027-02-08' && (await page.$eval('.cy-dayno', n => n.textContent)) === '3');
    check(L + ': day 3 says better', /Day 3: usually better/.test(await txt(page)));
    check(L + ': no sideways scroll, no errors', (await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)) && errs.length === 0, errs.join(' | '));
    await page.close();

    // the fertile window: Jan 12 + 29 = Feb 10 next; window Jan 21–27 (ovulation Jan 27 − 1 … ) — use a day inside it
    ({ page, errs } = await open(width, '2027-01-24', 'Ahmed'));
    const f = await txt(page);
    check(L + ': fertile window: the special note, peak days and ovulation', /^fertile$|^peak$/.test(await page.$eval('.cy-card', n => n.dataset.phase)) && /Fertile window: now through/.test(f) && /ovulation estimated around/.test(f) && /not a test/.test(f), f);
    check(L + ': the week strip marks the window and the ovulation day', (await page.$$eval('.cy-day', ns => ns.filter(n => /fertile|peak/.test(n.dataset.kind)).length)) >= 3);
    await page.close();
    ({ page, errs } = await open(width, '2027-01-26'));
    check(L + ': peak days say so, and the week strip marks both', (await page.$eval('.cy-card', n => n.dataset.phase)) === 'peak' && /Peak days: today/.test(await txt(page)) && (await page.$$eval('.cy-day', ns => ns.filter(n => n.dataset.kind === 'peak').length)) === 2);
    await page.close();

    // late: Jan 12 + 29 = Feb 10 expected; Feb 13 is 3 days late
    ({ page, errs } = await open(width, '2027-02-13'));
    check(L + ': late: how many days, the usual range, a calm note', (await page.$eval('.cy-card', n => n.dataset.phase)) === 'late' && /3 days later than usual/.test(await txt(page)) && /run 29–29 days|have run/.test(await txt(page)) && /Worth noting/.test(await txt(page)));
    check(L + ': late still offers Period started', !!(await page.$('.cy-start')));
    await page.close();
  }
  // nothing logged at all
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const probe = server('2027-02-10').replace(/var ROWS = \[[^\n]*\];/, 'var ROWS = [' + HEAD + '];') + cut(APP) + "\nReactDOM.createRoot(document.getElementById('root')).render(React.createElement(FpCycleCard, { apiUrl: 'x', apiToken: 'y', who: 'Ahmed' }));";
    await page.route('**/*', r => { const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] }); return r.fulfill({ contentType: 'text/html', body: shell(probe) }); });
    await page.goto('http://probe.local/'); await wait(300);
    check('empty: explains itself and offers Period started', /Log when a period starts/.test(await page.$eval('.cy-card', n => n.innerText)) && !!(await page.$('.cy-start')));
    await page.click('.cy-start'); await page.click('.cy-save'); await wait(250);
    check('empty: the first log shows day 1 and says it is an estimate', (await page.$eval('.cy-dayno', n => n.textContent)) === '1' && /estimate until 2 cycles/.test(await page.$eval('.cy-card', n => n.innerText)));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
