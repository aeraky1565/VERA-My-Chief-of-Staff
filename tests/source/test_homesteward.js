// Home Front › Warranties & Service (HomeSteward.js + HomestewardView). Pins:
//  - receipt and manual links: written to their own columns (named on first use), only http(s),
//    refused on a stale row; a new item can bring them;
//  - Snooze 1 week moves Next Service to a week from today, and the item's Task follows;
//  - the nightly step: a Medium flag AND one Task per overdue item; the Task's due date follows,
//    no second Task, and recording the service marks it Done;
//  - the screen: counters, the order things need you, a warranty meter, ✓ Done today, Snooze,
//    the links form, Later folded. Invented items.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HS = read('HomeSteward.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }

function fakeSheet(rows, maxCols) {
  const grid = rows.map(r => r.slice()); let cols = maxCols || 10;
  const pad = r => { while (r.length < cols) r.push(''); return r; }; grid.forEach(pad);
  const rng = (r, c, nr, nc) => ({
    getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
    getValue: () => (grid[r - 1] || [])[c - 1] ?? '',
    setValues: v => v.forEach((row, i) => row.forEach((x, j) => { while (grid.length < r + i) grid.push(pad([])); grid[r - 1 + i][c - 1 + j] = x; })),
    setValue: x => { while (grid.length < r) grid.push(pad([])); grid[r - 1][c - 1] = x; },
  });
  return { grid, getLastRow: () => grid.length, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; grid.forEach(pad); }, getRange: rng };
}
const HOME_HEAD = ['Item', 'Category', 'Purchase Date', 'Warranty Expiry', 'Last Service', 'Next Service', 'Interval (mo)', 'Notes'];
const TASK_HEADERS = ['ID', 'Task', 'Added Date', 'Due Date', 'Status', 'Recurring', 'Notes', 'Flagged', 'Completed'];
function ctx(home, tasks, flags) {
  const tabs = { HOME_ITEMS: 'Home Items', TASKS: 'Tasks', FLAGS: 'Flags' }, sheets = { 'Home Items': home, Tasks: tasks, Flags: flags || {} };
  const c = { String, Number, Math, JSON, Date, parseInt, isNaN, Logger: { log() {} }, TABS: tabs, TASK_HEADERS, HOME_ITEM_HEADERS: HOME_HEAD,
    Utilities: { formatDate: (d, tz, f) => f === 'yyyyMMdd' ? '20261116' : (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) },
    Session: { getScriptTimeZone: () => 'UTC' }, getSpreadsheet: () => ({ getSheetByName: n => sheets[n] }),
    veraLocked_: fn => fn(), taskNextId_: (sh) => 'TASK-20261116-' + String(sh.getLastRow()).padStart(2, '0'), getSuppressedKeyPatterns_: () => [],
    __flags: null, upsertKeyedFlags_: (sh, prefix, src, wanted, date) => { c.__flags = { prefix, src, wanted, date }; } };
  vm.createContext(c); vm.runInContext(HS, c);
  c.Date = class extends Date { constructor(...a) { if (!a.length) super('2026-11-16T12:00:00Z'); else super(...a); } static now() { return new Date('2026-11-16T12:00:00Z').getTime(); } };
  return c;
}

console.log('\nreceipt and manual links');
{
  const home = fakeSheet([HOME_HEAD, ['Dishwasher', 'Kitchen', '2025-01-10', '2027-01-10', '', '', '', '']], 8);
  const c = ctx(home, fakeSheet([TASK_HEADERS]));
  const r = c.webHomeItemLinks_({ parameter: { row: '2', item: 'Dishwasher', receipt: 'https://drive.example/receipt', manual: 'https://maker.example/manual.pdf' } });
  check('both links saved in their own columns, named on first use', r.ok && home.grid[1][8] === 'https://drive.example/receipt' && home.grid[1][9] === 'https://maker.example/manual.pdf' && J(home.grid[0].slice(8, 10)) === J(['Receipt', 'Manual']), J(home.grid));
  c.webHomeItemLinks_({ parameter: { row: '2', item: 'Dishwasher', receipt: '' } });
  check('a blank one clears it; one not sent is kept', home.grid[1][8] === '' && home.grid[1][9] === 'https://maker.example/manual.pdf');
  check('only http(s) links', c.webHomeItemLinks_({ parameter: { row: '2', item: 'Dishwasher', manual: 'javascript:alert(1)' } }).ok === false);
  let threw = ''; try { c.webHomeItemLinks_({ parameter: { row: '2', item: 'Fridge', receipt: 'https://x.example' } }); } catch (e) { threw = e.message; }
  check('a stale list can’t write the wrong item', /holds "Dishwasher", not "Fridge"/.test(threw), threw);
  check('the read sends them, and a new item can bring them', /receipt:\s*String\(row\[8\] \|\| ''\)\.trim\(\)/.test(WEB) && /manual:\s*String\(row\[9\] \|\| ''\)\.trim\(\)/.test(WEB) && /hsEnsureLinkCols_\(sheet\);\n\s*sheet\.getRange\(sheet\.getLastRow\(\), HS_RECEIPT_COL_, 1, 2\)/.test(WEB));
  check('the routes are wired', /case 'home_item_links':\s*return jsonOut_\(webHomeItemLinks_\(e\)\)/.test(WEB) && /case 'home_item_snooze':\s*return jsonOut_\(webHomeItemSnooze_\(e\)\)/.test(WEB));
}

console.log('\noverdue: a flag and a Task, and Snooze');
{
  const home = fakeSheet([HOME_HEAD, ['HVAC filter', 'House', '', '', '2026-08-07', '2026-11-07', 3, ''], ['Water heater', 'House', '', '', '2026-03-03', '2027-03-03', 12, ''], ['Gutters', 'House', '', '', '', '2026-11-15', '', '']]);
  const tasks = fakeSheet([TASK_HEADERS]);
  const c = ctx(home, tasks, {});
  check('which items are overdue, by how much', J(c.hsOverdue_(home.grid.slice(1), '2026-11-16', v => String(v)).map(o => [o.item, o.days])) === J([['HVAC filter', 9], ['Gutters', 1]]));
  check('…due today isn’t overdue yet', c.hsOverdue_([['Smoke alarm', '', '', '', '', '2026-11-16']], '2026-11-16', v => String(v)).length === 0);
  const res = c.checkHomeServiceOverdue_();
  const w = c.__flags.wanted;
  check('a Medium flag for each, worded with the days', res.overdue === 2 && w.home_service_overdue_hvac_filter.urgency === 'Medium' && /HVAC filter: service overdue by 9 days/.test(w.home_service_overdue_hvac_filter.flag) && c.__flags.prefix === 'home_service_overdue_');
  check('…and a Task for each, due on the service date', tasks.grid.length === 3 && tasks.grid[1][1] === '🔧 Service: HVAC filter' && tasks.grid[1][3] === '2026-11-07' && tasks.grid[1][4] === 'Open' && /VERA home service:hvac_filter/.test(tasks.grid[1][6]), J(tasks.grid));
  c.checkHomeServiceOverdue_();
  check('the next night makes no second Task', tasks.grid.length === 3 && c.__flags.wanted.home_service_overdue_gutters);
  const sn = c.webHomeItemSnooze_({ parameter: { row: '2', item: 'HVAC filter' } });
  check('Snooze 1 week: Next Service a week from today, and the Task follows', sn.nextService === '2026-11-23' && home.grid[1][5] === '2026-11-23' && tasks.grid[1][3] === '2026-11-23');
  c.checkHomeServiceOverdue_();
  check('…so the flag goes (it no longer asks for one)', !c.__flags.wanted.home_service_overdue_hvac_filter && !!c.__flags.wanted.home_service_overdue_gutters);
  check('recording the service marks its Task Done', c.hsSyncTask_('Gutters', '', true) === 'done' && tasks.grid[2][4] === 'Done' && tasks.grid[2][8] === '2026-11-16');
  check('…which the Record service route does', /hsSyncTask_\(String\(sheet\.getRange\(rowNum, 1\)\.getValue\(\) \|\| ''\), '', true\)/.test(fnSrc(WEB, 'webRecordService_')));
  check('the nightly step runs after the warranty one', /nightlyStep_\(ctx, 'checkWarrantiesExpiring_', checkWarrantiesExpiring_\);\n\s*nightlyStep_\(ctx, 'checkHomeServiceOverdue_', checkHomeServiceOverdue_\);/.test(CODE));
}

console.log('\nthe order and the counters');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array };
vm.createContext(U);
vm.runInContext(['hsUrgency_', 'hsWarrantyUsed_', 'hsCounts_', 'hsIsLink_'].map(n => fnSrc(APP, n)).join('\n'), U);
const ITEMS = [
  { row: 2, item: 'Water heater', category: 'House', lastService: '2026-03-03', nextService: '2027-03-03', intervalMonths: 12, serviceDays: 107, warrantyDays: null },
  { row: 3, item: 'Dishwasher', category: 'Kitchen', purchaseDate: '2025-01-10', warrantyExpiry: '2026-12-27', warrantyDays: 41, serviceDays: null, receipt: 'https://drive.example/r', manual: '' },
  { row: 4, item: 'HVAC filter', category: 'House', lastService: '2026-08-07', nextService: '2026-11-07', intervalMonths: 3, serviceDays: -9, warrantyDays: null },
  { row: 5, item: 'Gutters', category: 'House', nextService: '2026-11-25', intervalMonths: 6, serviceDays: 9, warrantyDays: null },
  { row: 6, item: 'Fridge', category: 'Kitchen', purchaseDate: '2024-01-01', warrantyExpiry: '2031-01-01', warrantyDays: 1500, serviceDays: null }];
check('overdue, then service due soon, then a warranty ending, then later', J(ITEMS.slice().sort((a, b) => U.hsUrgency_(a).rank - U.hsUrgency_(b).rank || U.hsUrgency_(a).days - U.hsUrgency_(b).days).map(i => i.item)) === J(['HVAC filter', 'Gutters', 'Dishwasher', 'Water heater', 'Fridge']));
check('the counters', J(U.hsCounts_(ITEMS)) === J({ overdue: 1, dueSoon: 1, warranty: 1 }));
check('the warranty meter: how much of it is used', U.hsWarrantyUsed_(ITEMS[1], '2026-11-16') === 94 && U.hsWarrantyUsed_(ITEMS[0], '2026-11-16') === null && U.hsWarrantyUsed_({ purchaseDate: '2025-01-01', warrantyExpiry: '2026-01-01' }, '2027-01-01') === 100);

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screen: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of [390, 1280]) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ items }) => {
      window.__ev = []; window.confirm = () => true;
      document.body.innerHTML = '<div id="hs" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('hs')).render(React.createElement(HomestewardView, { items, loading: false, busy: false,
        onRecordService: row => window.__ev.push(['done', row]), onAdd: f => window.__ev.push(['add', f]), onDelete: (r, i) => window.__ev.push(['del', r, i]),
        onSnooze: (r, i) => window.__ev.push(['snooze', r, i]), onLinks: (r, i, a, b) => window.__ev.push(['links', r, i, a, b]) }));
    }, { items: ITEMS });
    await page.waitForTimeout(300);
    const order = await page.$$eval('#hs .hs-card', ns => ns.map(n => n.dataset.item));
    check('the cards that need you, in order; the rest under Later', J(order) === J(['HVAC filter', 'Gutters', 'Dishwasher']) && /Later · 2/.test(await page.$eval('#hs', n => n.innerText)), J(order));
    const sum = await page.$$eval('#hs .hs-n b', ns => ns.map(n => n.textContent));
    check('the counters up top', J(sum) === J(['1', '1', '1']));
    check('the overdue card is marked, with the badge wording kept', (await page.$eval('#hs .hs-card[data-item="HVAC filter"]', n => n.className)).includes('bad') && /🔴 Overdue/.test(await page.$eval('#hs .hs-card[data-item="HVAC filter"]', n => n.innerText)));
    await page.click('#hs .hs-card[data-item="HVAC filter"] .hs-done');
    await page.click('#hs .hs-card[data-item="Gutters"] .hs-snooze');
    check('✓ Done today records it; Snooze 1 wk snoozes it (with the name)', J(await page.evaluate(() => window.__ev)) === J([['done', 4], ['snooze', 5, 'Gutters']]));
    check('Snooze only where something is due', !(await page.$('#hs .hs-card[data-item="Dishwasher"] .hs-snooze')));
    check('the warranty meter on the ending warranty', (await page.$eval('#hs .hs-card[data-item="Dishwasher"] .hs-meter i', n => n.style.width)) === '94%' || (await page.$eval('#hs .hs-card[data-item="Dishwasher"] .hs-meter i', n => parseInt(n.style.width, 10))) >= 90);
    check('the receipt link opens; no manual button without one', (await page.$eval('#hs .hs-card[data-item="Dishwasher"] .hs-receipt', n => n.href)) === 'https://drive.example/r' && !(await page.$('#hs .hs-card[data-item="Dishwasher"] .hs-manual')));
    await page.click('#hs .hs-card[data-item="Dishwasher"] .hs-links'); await page.waitForTimeout(60);
    await page.fill('#hs .hs-in-manual', 'not a link'); await page.waitForTimeout(30);
    check('the links form refuses something that isn’t a link', await page.$eval('#hs .hs-links-save', b => b.disabled));
    await page.fill('#hs .hs-in-manual', 'https://maker.example/manual.pdf'); await page.click('#hs .hs-links-save'); await page.waitForTimeout(60);
    check('…and saves both links', J((await page.evaluate(() => window.__ev)).pop()) === J(['links', 3, 'Dishwasher', 'https://drive.example/r', 'https://maker.example/manual.pdf']));
    await page.click('#hs .hs-later'); await page.waitForTimeout(60);
    check('Later opens to the rest', J(await page.$$eval('#hs .hs-card', ns => ns.map(n => n.dataset.item))) === J(['HVAC filter', 'Gutters', 'Dishwasher', 'Water heater', 'Fridge']));
    await page.click('#hs .add-item-btn'); await page.waitForTimeout(60);
    await page.fill('#hs .hi-item', 'Car seat'); await page.fill('#hs .hi-receipt', 'https://drive.example/seat');
    await page.click('#hs .hi-save'); await page.waitForTimeout(60);
    const add = (await page.evaluate(() => window.__ev)).filter(e => e[0] === 'add').pop();
    check('a new item can bring its receipt link', add && add[1].item === 'Car seat' && add[1].receipt === 'https://drive.example/seat', J(add));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
