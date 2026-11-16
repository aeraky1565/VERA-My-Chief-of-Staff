// Health › Morning Routine (Routine.js, the routine routes in WebApp.js, MorningRoutineTab). Pins:
//  - two lists in a List column (named on first write); an item with no list shows on both;
//  - adding to a list; generating one list replaces only VERA's items on it (old ones count as Weekday);
//  - moving swaps with the next item on that list;
//  - the weekend prompt differs, and there are no minutes;
//  - the screen: opens on today's list, the ring, tick, add (or both lists), ✨ generate, Reorder.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MR = read('Routine.js'), WEB = read('WebApp.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
const HDR = ['ID', 'Item', 'Source', 'Sort', 'Checked', 'Checked At', 'Added Date'];
function sheetOf(rows) { let cols = Math.max(7, rows[0].length); const pad = r => { while (r.length < cols) r.push(''); return r; }; rows.forEach(pad);
  return { rows, getLastRow: () => rows.length, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; rows.forEach(pad); }, deleteRow: r => rows.splice(r - 1, 1),
    getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
      getValue: () => (rows[r - 1] || [])[c - 1] ?? '', setValue: x => { rows[r - 1][c - 1] = x; },
      setValues: v => v.forEach((row, i) => { while (rows.length < r + i) rows.push(pad([])); row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; }); }) }) }; }
function ctx(sheet, gen) {
  const c = { String, Number, Math, JSON, Date, Object, parseInt, Array, TABS: { MORNING_ROUTINE: 'M' }, MORNING_ROUTINE_HEADERS: HDR, prompts: [],
    getSpreadsheet: () => ({ getSheetByName: () => sheet }), Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: (d, tz, f) => f === 'yyyyMMdd' ? '20261116' : '2026-11-16' } };
  c.callClaudeJson_ = p => { c.prompts.push(p); return gen || []; };
  vm.createContext(c);
  vm.runInContext(MR + '\n' + ['webGenerateMorningRoutine_', 'webGetMorningRoutine_', 'webAddMorningRoutineItem_', 'webMoveMorningRoutineItem_', 'findMorningRoutineRow_'].map(n => fnSrc(WEB, n)).join('\n'), c);
  return c;
}

console.log('\ntwo lists');
const C0 = ctx(sheetOf([HDR.slice()]));
check('a list value', C0.mrList_('weekend') === 'Weekend' && C0.mrList_(' Weekday ') === 'Weekday' && C0.mrList_('') === '' && C0.mrList_('x') === '');
check('no list shows on both', C0.mrInList_('', 'Weekend') && C0.mrInList_('Weekday', 'Weekday') && !C0.mrInList_('Weekday', 'Weekend'));
check('today’s list', C0.mrTodayList_(new Date(2026, 10, 14)) === 'Weekend' && C0.mrTodayList_(new Date(2026, 10, 15)) === 'Weekend' && C0.mrTodayList_(new Date(2026, 10, 16)) === 'Weekday');
check('the weekend prompt is different, and neither asks for times', /WEEKEND/.test(C0.mrPrompt_('Weekend')) && /unhurried/.test(C0.mrPrompt_('Weekend')) && /WEEKDAY/.test(C0.mrPrompt_('Weekday')) && /no times/.test(C0.mrPrompt_('Weekday')));
{
  const sh = sheetOf([HDR.slice(), ['R1', 'Water', 'manual', 1, false, '', '2026-11-01'], ['R2', 'Old VERA step', 'vera', 2, false, '', '2026-11-01'], ['R3', 'Stretch', 'manual', 3, false, '', '2026-11-01']]);
  const c = ctx(sh, ['Long walk outside', 'Slow breakfast']);
  const a = c.webAddMorningRoutineItem_({ parameter: { text: 'Pancakes', list: 'weekend' } });
  check('adding to a list, in a named List column', a.list === 'Weekend' && sh.rows[0][7] === 'List' && sh.rows[4][7] === 'Weekend' && sh.rows[4][1] === 'Pancakes', J(sh.rows[4]));
  c.webGenerateMorningRoutine_({ parameter: { list: 'Weekend' } });
  check('generating Weekend: VERA’s weekend items added; the old (weekday) VERA item and yours stay', sh.rows.some(r => r[1] === 'Old VERA step') && sh.rows.filter(r => r[7] === 'Weekend' && r[2] === 'vera').map(r => r[1]).join() === 'Long walk outside,Slow breakfast' && /WEEKEND/.test(c.prompts[0]), J(sh.rows.map(r => r[1] + ':' + r[7])));
  const c2 = ctx(sh, ['Check the flags']);
  c2.webGenerateMorningRoutine_({ parameter: {} });
  check('generating Weekday replaces only VERA’s weekday items', !sh.rows.some(r => r[1] === 'Old VERA step') && sh.rows.some(r => r[1] === 'Check the flags' && r[7] === 'Weekday') && sh.rows.filter(r => r[7] === 'Weekend' && r[2] === 'vera').length === 2 && sh.rows.some(r => r[1] === 'Water'));
  const got = c2.webGetMorningRoutine_().items;
  check('the read sends the list', got.filter(i => i.text === 'Pancakes')[0].list === 'Weekend' && got.filter(i => i.text === 'Water')[0].list === '');
}
{
  const sh = sheetOf([HDR.concat(['List']), ['A', 'Water', 'manual', 1, false, '', '', ''], ['B', 'Commute podcast', 'manual', 2, false, '', '', 'Weekday'], ['C', 'Pancakes', 'manual', 3, false, '', '', 'Weekend']]);
  const c = ctx(sh);
  c.webMoveMorningRoutineItem_({ parameter: { id: 'C', dir: '-1', list: 'Weekend' } });
  check('moving on Weekend swaps with the item before it on that list (skipping weekday ones)', sh.rows[3][3] === 1 && sh.rows[1][3] === 3 && sh.rows[2][3] === 2, J(sh.rows.map(r => r[3])));
}

console.log('\nthe screen');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext(['mrTodayListUI_', 'mrShown_'].map(n => fnSrc(APP, n)).join('\n'), U);
const ITEMS = [{ id: 'a', text: 'Water', sort: 1, list: '', checked: true }, { id: 'b', text: 'Commute podcast', sort: 2, list: 'Weekday' }, { id: 'c', text: 'Pancakes', sort: 3, list: 'Weekend', source: 'vera' }, { id: 'd', text: 'Stretch', sort: 0, list: 'Weekend' }];
check('shown on a list: its own and the both ones, in order', J(U.mrShown_(ITEMS, 'Weekend').map(i => i.id)) === J(['d', 'a', 'c']) && J(U.mrShown_(ITEMS, 'Weekday').map(i => i.id)) === J(['a', 'b']));

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
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'morning_routine') return Promise.resolve({ ok: true, items: JSON.parse(JSON.stringify(items)) });
        if (p.action === 'generate_morning_routine') return Promise.resolve({ ok: true, items: items.concat([{ id: 'g', text: 'Long walk', sort: 9, list: p.list, source: 'vera' }]) }); return Promise.resolve({ ok: true }); };
      document.body.innerHTML = '<div id="mr" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('mr')).render(React.createElement(MorningRoutineTab, { apiUrl: 'u', apiToken: 't' }));
    }, { items: ITEMS });
    await page.waitForTimeout(250);
    const today = U.mrTodayListUI_(new Date()), other = today === 'Weekday' ? 'Weekend' : 'Weekday';
    check('opens on today’s list', (await page.$eval('#mr .mr-chip.on', n => n.textContent)) === today + ' · today');
    await page.click('#mr .mr-chip >> text=/^Weekend/'); await page.waitForTimeout(40);
    check('the Weekend list, and the ring', J(await page.$$eval('#mr .mr-row', ns => ns.map(n => n.dataset.item))) === J(['d', 'a', 'c']) && (await page.$eval('#mr .mr-ring b', n => n.textContent)) === '1/3' && /2 left/.test(await page.$eval('#mr .mr-top', n => n.innerText)));
    check('no minutes anywhere', !/\bmin\b|minutes/.test(await page.$eval('#mr', n => n.innerText)));
    await page.click('#mr .mr-row[data-item="d"] .mr-check');
    check('a tick', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'morning_routine_toggle', id: 'd' }) && (await page.$eval('#mr .mr-ring b', n => n.textContent)) === '2/3');
    await page.fill('#mr .mr-add-in', 'Farmers market'); await page.click('#mr .mr-add-btn'); await page.waitForTimeout(40);
    check('adding goes on this list', J((await page.evaluate(() => window.__ev)).filter(p => p.action === 'morning_routine_add').pop()) === J({ action: 'morning_routine_add', text: 'Farmers market', source: 'manual', list: 'Weekend' }));
    await page.fill('#mr .mr-add-in', 'Vitamins'); await page.check('#mr .mr-both input'); await page.click('#mr .mr-add-btn'); await page.waitForTimeout(40);
    check('…or on both', (await page.evaluate(() => window.__ev)).filter(p => p.action === 'morning_routine_add').pop().list === '');
    await page.click('#mr .mr-gen'); await page.waitForTimeout(80);
    check('✨ makes this list', J((await page.evaluate(() => window.__ev)).filter(p => p.action === 'generate_morning_routine').pop()) === J({ action: 'generate_morning_routine', list: 'Weekend' }) && !!(await page.$('#mr .mr-row[data-item="g"]')));
    await page.click('#mr .mr-reorder'); await page.click('#mr .mr-row[data-item="a"] .mr-up'); await page.waitForTimeout(40);
    check('Reorder: ↑ moves it on this list', J((await page.evaluate(() => window.__ev)).filter(p => p.action === 'morning_routine_move').pop()) === J({ action: 'morning_routine_move', id: 'a', dir: -1, list: 'Weekend' }) && (await page.$$eval('#mr .mr-row', ns => ns.map(n => n.dataset.item)))[0] === 'a');
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  {
    // A Saturday: the screen opens on Weekend.
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    if (page.clock) await page.clock.install({ time: new Date(2026, 10, 14, 9, 0, 0) });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    const on = await page.evaluate(() => new Promise(res => { window.apiGet = () => Promise.resolve({ ok: true, items: [] }); document.body.innerHTML = '<div id="mr"></div>';
      ReactDOM.createRoot(document.getElementById('mr')).render(React.createElement(MorningRoutineTab, { apiUrl: 'u', apiToken: 't' })); setTimeout(() => res([new Date().getDay(), (document.querySelector('#mr .mr-chip.on') || {}).textContent]), 200); }));
    check('on a Saturday it opens on Weekend', on[0] !== 6 || on[1] === 'Weekend · today', J(on));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
