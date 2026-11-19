const NR__ = require('fs').readFileSync(require('path').join(process.env.VERA_ROOT || require('path').join(__dirname, '..', '..'), 'NightlyRunner.js'), 'utf8');   // the night's one list (#256)
// Home Front › Neighborhood (Neighborhood.js, the flyer routes in WebApp.js, NeighborhoodWatchView). Pins:
//  - Going puts the flyer on the Joint Chaos calendar once; any other answer takes it off;
//    no date or no Joint Chaos calendar says so, and the answer is still saved;
//  - a thumbnail is kept in the row only when it's a small JPEG; dates come back as yyyy-MM-dd,
//    and row numbers stay right past a blank row;
//  - flyers more than 30 days past are cleared nightly (never a recurring one);
//  - the screen: This week / Later / HOA / Past, the RSVP chips, the thumbnail, the HOA card with
//    its scan history and ⚙ link. Invented flyers.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NB = read('Neighborhood.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
function fakeSheet(rows, maxCols) {
  const grid = rows.map(r => r.slice()); let cols = maxCols || 14;
  const pad = r => { while (r.length < cols) r.push(''); return r; }; grid.forEach(pad);
  const rng = (r, c, nr, nc) => ({
    getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
    setValues: v => v.forEach((row, i) => row.forEach((x, j) => { grid[r - 1 + i][c - 1 + j] = x; })), setValue: x => { grid[r - 1][c - 1] = x; } });
  return { grid, getLastRow: () => grid.length, getLastColumn: () => Math.max(...grid.map(r => { let n = r.length; while (n && r[n - 1] === '') n--; return n; })), getMaxColumns: () => cols,
    insertColumnsAfter: (a, n) => { cols += n; grid.forEach(pad); }, getRange: rng, appendRow: r => grid.push(pad(r.slice())), deleteRow: n => grid.splice(n - 1, 1), getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }) };
}
const HEAD = ['ID', 'Title', 'Type', 'Date', 'Time', 'Location', 'Description', 'Recurring', 'Tags', 'Status', 'Added', 'Notes'];
function ctx(sheet, cals) {
  const made = [], deleted = [];
  const mk = name => ({ getName: () => name, createEvent: (t, s, e, o) => { const ev = { id: 'EV' + (made.length + 1), t, s, e, o, cal: name }; made.push(ev); return { getId: () => ev.id }; },
    createAllDayEvent: (t, d, o) => { const ev = { id: 'EV' + (made.length + 1), t, allDay: true, d, o, cal: name }; made.push(ev); return { getId: () => ev.id }; },
    getEventById: id => ({ deleteEvent: () => deleted.push(id) }) });
  const c = { String, Number, Math, JSON, Date, parseInt, isNaN, Logger: { log() {} }, TABS: { NEIGHBORHOOD_FLYERS: 'F' }, CONFIG: { SHEET_ID: 'x' },
    Utilities: { formatDate: d => d.toISOString().slice(0, 10) }, Session: { getScriptTimeZone: () => 'UTC' },
    CalendarApp: { getAllCalendars: () => (cals || ['Ahmed', 'AE&VV - Our Joint Chaos']).map(mk), getDefaultCalendar: () => mk('default') },
    getSpreadsheet: () => ({ getSheetByName: () => sheet }), SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) }, made, deleted };
  vm.createContext(c);
  vm.runInContext(NB + '\n' + ['webSaveFlyer_', 'webGetFlyers_', 'webUpdateFlyerStatus_', 'webFlyerToCalendar_'].map(n => fnSrc(WEB, n)).join('\n'), c);
  c.Date = class extends Date { constructor(...a) { if (!a.length) super('2026-11-16T12:00:00Z'); else super(...a); } };
  return c;
}

console.log('\nGoing and the Joint Chaos calendar');
{
  const sh = fakeSheet([HEAD, ['fly_1', 'Fall cleanup day', 'Event', '2026-11-21', '09:00', 'Clubhouse lot', 'Bring gloves', 'false', '', '', '2026-11-12', ''],
    ['fly_2', 'Food truck night', 'Event', '2026-11-20', '', 'Oak St park', '', 'false', '', '', '2026-11-12', ''], ['fly_3', 'Pool notice', 'Notice', '', '', '', '', 'false', '', '', '2026-11-12', '']]);
  const c = ctx(sh);
  let r = c.webUpdateFlyerStatus_({ parameter: { row: '2', status: 'Going' } });
  check('Going: the answer saved, and a 2-hour event on Joint Chaos', r.ok && r.calendar === 'added' && sh.grid[1][9] === 'Going' && c.made.length === 1 && c.made[0].cal === 'AE&VV - Our Joint Chaos' && /Fall cleanup day/.test(c.made[0].t) && (c.made[0].e - c.made[0].s) === 7200000, J(c.made));
  check('…its event id kept in the row', sh.grid[1][13] === 'EV1' && J(sh.grid[0].slice(12, 14)) === J(['Photo', 'Event ID']));
  r = c.webUpdateFlyerStatus_({ parameter: { row: '2', status: 'Going' } });
  check('Going again makes no second event', r.calendar === 'kept' && c.made.length === 1);
  r = c.webUpdateFlyerStatus_({ parameter: { row: '2', status: 'Not Going' } });
  check('another answer takes VERA’s event off', r.calendar === 'removed' && J(c.deleted) === J(['EV1']) && sh.grid[1][13] === '' && sh.grid[1][9] === 'Not Going');
  r = c.webUpdateFlyerStatus_({ parameter: { row: '3', status: 'Going' } });
  check('no time: an all-day event', r.calendar === 'added' && c.made[1].allDay === true);
  r = c.webUpdateFlyerStatus_({ parameter: { row: '4', status: 'Going' } });
  check('no date: saved, and it says nothing went on the calendar', r.ok && r.calendar === 'none' && /No date/.test(r.warning) && sh.grid[3][9] === 'Going');
  const c2 = ctx(fakeSheet([HEAD, ['fly_1', 'A', 'Event', '2026-11-21', '', '', '', 'false', '', '', '', '']]), ['Ahmed']);
  r = c2.webUpdateFlyerStatus_({ parameter: { row: '2', status: 'Going' } });
  check('no Joint Chaos calendar: saved, and says so', r.ok && r.calendar === 'none' && /Joint Chaos/.test(r.warning));
  check('a flyer that has gone is refused', c.webUpdateFlyerStatus_({ parameter: { row: '40', status: 'Going' } }).ok === false);
  c.webFlyerToCalendar_({ parameter: { title: 'X', date: '2026-12-01' } });
  check('“Add to calendar” goes on Joint Chaos too', c.made[c.made.length - 1].cal === 'AE&VV - Our Joint Chaos');
}

console.log('\nthe thumbnail, dates and rows');
{
  const sh = fakeSheet([HEAD, ['fly_1', 'A', 'Event', new Date('2026-11-21T00:00:00Z'), '', '', '', 'false', '', '', '', ''], ['', '', '', '', '', '', '', '', '', '', '', ''], ['fly_3', 'B', 'Event', '2026-12-01', '', '', '', 'false', '', '', '', '']]);
  const c = ctx(sh);
  const fl = c.webGetFlyers_().flyers;
  check('a date cell comes back as yyyy-MM-dd', fl.find(f => f.ID === 'fly_1').Date === '2026-11-21', J(fl.map(f => f.Date)));
  check('row numbers stay right past a blank row', fl.find(f => f.ID === 'fly_3')._row === 4, J(fl.map(f => f._row)));
  const small = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  c.webSaveFlyer_({ title: 'C', date: '2026-12-02', photo: small });
  check('a small JPEG thumbnail is kept in the row', sh.grid[sh.grid.length - 1][12] === small);
  const big = c.webSaveFlyer_({ title: 'D', photo: 'data:image/jpeg;base64,' + 'A'.repeat(50000) });
  const odd = c.webSaveFlyer_({ title: 'E', photo: 'data:text/html;base64,PGI+' });
  check('…a big one or anything else isn’t, and the flyer still saves', big.ok && /too big/.test(big.warning) && odd.ok && sh.grid[sh.grid.length - 1][12] === '' && sh.grid[sh.grid.length - 2][12] === '');
}

console.log('\nclearing old flyers');
{
  const sh = fakeSheet([HEAD, ['a', 'Old', '', '2026-10-01', '', '', '', 'false'], ['b', 'Recent', '', '2026-10-20', '', '', '', 'false'], ['c', 'Yearly', '', '2025-11-01', '', '', '', 'true'], ['d', 'No date', '', '', '', '', '', 'false']]);
  const c = ctx(sh);
  check('more than 30 days past goes; recurring and undated stay', c.purgeOldFlyers_().removed === 1 && J(sh.grid.slice(1).map(r => r[0])) === J(['b', 'c', 'd']));
  check('the nightly step runs it', /S\('purgeOldFlyers_', \d, function\(\) \{ purgeOldFlyers_\(\); \}\)/.test(NR__));
}

console.log('\nthe screen’s groups');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array };
vm.createContext(U);
vm.runInContext(['nbDays_', 'nbGroup_', 'nbWhen_'].map(n => fnSrc(APP, n)).join('\n'), U);
const T = '2026-11-16';
check('this week, later, past, gone', U.nbGroup_({ Date: '2026-11-22' }, T) === 'week' && U.nbGroup_({ Date: '2026-11-23' }, T) === 'later' && U.nbGroup_({ Date: '2026-10-17' }, T) === 'past' && U.nbGroup_({ Date: '2026-10-16' }, T) === 'gone' && U.nbGroup_({ Date: '2026-01-02', Recurring: 'true' }, T) === 'later' && U.nbGroup_({}, T) === 'undated');
check('the short when', U.nbWhen_({ Date: '2026-11-21', Time: '09:00' }, T) === 'Sat 9 am' && U.nbWhen_({ Date: '2026-11-16', Time: '17:30' }, T) === 'Today 5:30 pm' && U.nbWhen_({ Date: '2026-12-01' }, T) === 'Tue, Dec 1');

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screen: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const today = new Date(); const iso = n => { const d = new Date(today); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  const FLYERS = [{ _row: 2, ID: 'a', Title: 'Fall cleanup day', Date: iso(3), Time: '09:00', Location: 'Clubhouse lot', Type: 'HOA', Status: 'Going', 'Event ID': 'EV1', Photo: THUMB },
    { _row: 3, ID: 'b', Title: 'Food truck night', Date: iso(2), Location: 'Oak St park', Status: '' }, { _row: 4, ID: 'c', Title: 'Holiday lights', Date: iso(20), Status: 'Interested' },
    { _row: 5, ID: 'd', Title: 'Yard sale', Date: iso(-5), Status: 'Going' }];
  const SCANS = [{ ID: 's2', 'Scanned At': new Date(Date.now() - 2 * 864e5).toISOString(), 'Items Found': 2, 'New Flags': 1, Notes: '' }, { ID: 's1', 'Scanned At': new Date(Date.now() - 9 * 864e5).toISOString(), 'Items Found': 0, 'New Flags': 0, Notes: '' }];
  for (const width of [390, 1280]) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ flyers, scans }) => {
      window.__calls = []; window.confirm = () => true;
      window.apiGet = (u, t, q) => { window.__calls.push(q); const r = q.action === 'get_flyers' ? { ok: true, flyers } : q.action === 'get_hoa_scans' ? { ok: true, scans } : q.action === 'get_hoa_config' ? { ok: true, url: 'https://hoa.example/news' } : q.action === 'update_flyer_status' ? { ok: true, calendar: q.status === 'Going' ? 'added' : 'none' } : { ok: true };
        return Promise.resolve(JSON.parse(JSON.stringify(r))); };
      window.apiPost = (u, t, b) => { window.__calls.push(b); return Promise.resolve({ ok: true }); };
      document.body.innerHTML = '<div id="nb" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('nb')).render(React.createElement(NeighborhoodWatchView, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
    }, { flyers: FLYERS, scans: SCANS });
    await page.waitForTimeout(400);
    const titles = () => page.$$eval('#nb .nb-card b', ns => ns.map(n => n.textContent));
    check('This week, soonest first', J(await titles()) === J(['Food truck night', 'Fall cleanup day']));
    check('…the pills count each group', /This week · 2/.test(await page.$eval('#nb .nb-pills', n => n.innerText)) && /Later · 1/.test(await page.$eval('#nb .nb-pills', n => n.innerText)) && /Past · 1/.test(await page.$eval('#nb .nb-pills', n => n.innerText)));
    check('a Going event says it’s on Joint Chaos; others say Going adds it', /On Joint Chaos ✓/.test(await page.$eval('#nb .nb-card[data-flyer="2"]', n => n.innerText)) && /Going adds it to Joint Chaos/.test(await page.$eval('#nb .nb-card[data-flyer="3"]', n => n.innerText)));
    await page.click('#nb .nb-card[data-flyer="3"] .nb-rsvp.go'); await page.waitForTimeout(100);
    check('tapping Going sends it, and the card shows it on the calendar', (await page.evaluate(() => window.__calls)).some(q => q.action === 'update_flyer_status' && q.row === '3' && q.status === 'Going') && /On Joint Chaos ✓/.test(await page.$eval('#nb .nb-card[data-flyer="3"]', n => n.innerText)));
    await page.click('#nb .nb-card[data-flyer="2"] .nb-rsvp.go'); await page.waitForTimeout(100);
    check('tapping your current answer clears it (and takes it off)', (await page.evaluate(() => window.__calls)).some(q => q.action === 'update_flyer_status' && q.row === '2' && q.status === ''));
    check('Skip is the Not Going answer', (await page.$$eval('#nb .nb-card[data-flyer="3"] .nb-rsvp', ns => ns.map(n => n.textContent))).join() === 'Going,Interested,Skip');
    await page.click('#nb .nb-card[data-flyer="2"] .nb-thumb'); await page.waitForTimeout(60);
    check('the thumbnail opens larger', !!(await page.$('#nb .nb-zoom img')));
    await page.click('#nb .nb-zoom'); await page.waitForTimeout(40);
    check('the HOA card: when it last scanned, and what it found', /scanned 2 days ago/.test(await page.$eval('#nb .nb-hoa', n => n.innerText)) && /2 items found · 1 new flag/.test(await page.$eval('#nb .nb-hoa', n => n.innerText)));
    await page.click('#nb .nb-hist'); await page.waitForTimeout(60);
    check('Scan history opens the HOA view with every scan', (await page.$$('#nb .nb-hrow')).length === 2);
    await page.click('#nb .nb-gear'); await page.waitForTimeout(60);
    await page.fill('#nb .nb-hoa-url', 'https://hoa.example/events'); await page.click('#nb .nb-hoa-save'); await page.waitForTimeout(60);
    check('⚙ holds the HOA link, and saves it', (await page.evaluate(() => window.__calls)).some(q => q.action === 'set_hoa_config' && q.url === 'https://hoa.example/events'));
    await page.click('#nb .nb-pill >> text=Past'); await page.waitForTimeout(60);
    check('Past: the recent ones, and when they clear', J(await titles()) === J(['Yard sale']) && /clear 30 days after/.test(await page.$eval('#nb', n => n.innerText)));
    await page.click('#nb .nb-pill >> text=Later'); await page.waitForTimeout(60);
    check('Later', J(await titles()) === J(['Holiday lights']));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
