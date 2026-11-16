// Home Front › Chores (Chores.js, the chore routes in WebApp.js, ChoresView). Pins:
//  - each chore has an owner (Ahmed, Victoria or Either; anything else is Either), added, changed;
//  - ticking records who ticked it (the sign-in), unticking and the nightly reset clear it;
//  - the columns are added and named on a tab made before them;
//  - routine chores never reach Needs you (lite Today / full Home);
//  - the screen: today's ring, the cadence chips, the owner filter, owner pills, who ticked it,
//    the ⋯ editor (owner, cadence, delete), adding with an owner. Invented chores.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CH = read('Chores.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
function fakeSheet(rows, maxCols) {
  const grid = rows.map(r => r.slice()); let cols = maxCols || 9;
  const pad = r => { while (r.length < cols) r.push(''); return r; }; grid.forEach(pad);
  const lastCol = () => Math.max(...grid.map(r => { let n = r.length; while (n && r[n - 1] === '') n--; return n; }));
  return { grid, getLastRow: () => grid.length, getLastColumn: lastCol, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; grid.forEach(pad); },
    getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')), setValue: x => { grid[r - 1][c - 1] = x; } }),
    appendRow: r => grid.push(pad(r.slice())), getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }) };
}
const HEAD = ['ID', 'Chore', 'Cadence', 'Sort', 'Checked', 'Checked At', 'Added Date', 'Last Done', 'Due By'];
function ctx(sheet, who) {
  const c = { String, Number, Math, JSON, Date, parseInt, Logger: { log() {} }, TABS: { CHORES: 'Chores' }, CONFIG: { SHEET_ID: 'x' }, _veraWho_: who === undefined ? { name: 'Victoria' } : who,
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) }, hfChoresSheet_: () => sheet, hfYmd_: v => String(v || ''), hfToday_: () => '2026-11-16', hfUpkeepState_: () => null };
  vm.createContext(c);
  vm.runInContext(CH + '\n' + ['webAddChore_', 'webToggleChore_', 'webUpdateChore_', 'webGetChores_'].map(n => fnSrc(WEB, n)).join('\n'), c);
  return c;
}

console.log('\nowners and who ticked it');
{
  const sh = fakeSheet([HEAD, ['ch_1', 'Unload the dishwasher', 'Daily', 1, false, '', '2026-11-01', '', '']]);
  const c = ctx(sh);
  check('an owner reads as Ahmed, Victoria or Either', c.chOwner_('victoria') === 'Victoria' && c.chOwner_(' Ahmed ') === 'Ahmed' && c.chOwner_('') === 'Either' && c.chOwner_('Sam') === 'Either');
  let r = c.webAddChore_({ parameter: { chore: 'Feed the fish', cadence: 'Daily', owner: 'Victoria' } });
  check('adding a chore keeps its owner, in a new Owner column', r.chore.Owner === 'Victoria' && sh.grid[0][9] === 'Owner' && sh.grid[2][9] === 'Victoria', J(sh.grid[0]));
  r = c.webToggleChore_({ parameter: { id: 'ch_1', checked: 'true' } });
  check('ticking records who did it (the sign-in) in Checked By', r.ok && r.checkedBy === 'Victoria' && sh.grid[0][10] === 'Checked By' && sh.grid[1][10] === 'Victoria' && sh.grid[1][4] === true && !!r.checkedAt, J(sh.grid[1]));
  c.webToggleChore_({ parameter: { id: 'ch_1', checked: 'false' } });
  check('unticking clears it', sh.grid[1][10] === '' && sh.grid[1][5] === '');
  const c2 = ctx(sh, null);
  check('with no sign-in, the tick has no name', c2.webToggleChore_({ parameter: { id: 'ch_1', checked: 'true' } }).checkedBy === '');
  c.webUpdateChore_({ parameter: { id: 'ch_1', owner: 'ahmed' } });
  check('changing the owner', sh.grid[1][9] === 'Ahmed');
  c.webUpdateChore_({ parameter: { id: 'ch_1', cadence: 'Weekly' } });
  check('…a cadence change leaves the owner', sh.grid[1][9] === 'Ahmed' && sh.grid[1][2] === 'Weekly');
  check('the read sends Owner and Checked By', J(Object.keys(c.webGetChores_().chores[0]).filter(k => k === 'Owner' || k === 'Checked By')) === J(['Owner', 'Checked By']));
  check('the nightly reset clears Checked By with the tick', /var byIdx = hdrs\.indexOf\('Checked By'\);[\s\S]*?if \(byIdx !== -1\) sheet\.getRange\(i \+ 1, byIdx \+ 1\)\.setValue\(''\);/.test(fnSrc(CODE, 'resetChoresByCadence_')));
}

console.log('\nchores stay off Today');
{
  const L = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(L);
  vm.runInContext(APP.slice(APP.indexOf('// ---- NeedsYou'), APP.indexOf('// ---- /NeedsYou ----')), L);
  const rows = L.liteNeedsYou_({ cards: {}, coupons: { coupons: [] }, chores: { chores: [{ ID: 'ch_1', Chore: 'Unload the dishwasher', Cadence: 'Daily', Checked: false, Owner: 'Ahmed' }, { ID: 'ch_2', Chore: 'Feed the fish', Cadence: 'Weekly', Checked: false }] } }, new Date());
  check('a daily or weekly chore is never in Needs you', !rows.some(r => /dishwasher|fish/i.test(r.title || '')), J(rows));
}

console.log('\nthe filter and the counts');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext(['chOwnerOf_', 'chDone_', 'chFilter_', 'chCounts_'].map(n => fnSrc(APP, n)).join('\n'), U);
const CHORES = [{ ID: 'a', Chore: 'Unload the dishwasher', Cadence: 'Daily', Owner: 'Ahmed', Checked: false, Sort: 1 }, { ID: 'b', Chore: 'Feed the fish', Cadence: 'Daily', Owner: 'Victoria', Checked: false, Sort: 2 },
  { ID: 'c', Chore: 'Make the bed', Cadence: 'Daily', Owner: '', Checked: true, 'Checked By': 'Victoria', 'Checked At': '2026-11-16T12:40:00Z', Sort: 3 }, { ID: 'd', Chore: 'Water the plants', Cadence: 'Weekly', Owner: 'Either', Checked: 'TRUE', Sort: 4 }, { ID: 'e', Chore: 'Mop', Cadence: 'Weekly', Owner: 'Ahmed', Checked: false, Sort: 5 }];
check('a person’s filter keeps theirs and Either', J(U.chFilter_(CHORES, 'Ahmed').map(c => c.ID)) === J(['a', 'c', 'd', 'e']) && J(U.chFilter_(CHORES, 'Either').map(c => c.ID)) === J(['c', 'd']) && U.chFilter_(CHORES, 'all').length === 5);
check('counts per cadence', J(U.chCounts_(CHORES)) === J({ Daily: { n: 3, done: 1 }, Weekly: { n: 2, done: 1 } }));

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
    await page.evaluate(({ chores }) => {
      window.__ev = []; window.confirm = () => true;
      document.body.innerHTML = '<div id="ch" style="padding:0 16px"></div>';
      const root = ReactDOM.createRoot(document.getElementById('ch'));
      window.__render = list => root.render(React.createElement(ChoresView, { chores: list, loading: false, busy: false, onToggle: (i, v) => window.__ev.push(['toggle', i, v]), onAdd: (t, c, o) => window.__ev.push(['add', t, c, o]),
        onDelete: i => window.__ev.push(['del', i]), onUpdateCadence: (i, c) => window.__ev.push(['cad', i, c]), onUpdateOwner: (i, o) => window.__ev.push(['owner', i, o]) }));
      window.__render(chores);
    }, { chores: CHORES });
    await page.waitForTimeout(250);
    const t = await page.$eval('#ch', n => n.innerText);
    check('today’s ring: daily chores done, and how many are left', (await page.$eval('#ch .ch-ring b', n => n.textContent)) === '1/3' && /2 left/.test(t));
    check('the cadence chips count each', /Daily 1\/3/.test(t) && /Weekly 1\/2 · 1 left/.test(t));
    const rows = await page.$$eval('#ch .ch-row', ns => ns.map(n => [n.dataset.chore, n.className.includes('done'), n.querySelector('.ch-own').textContent]));
    check('undone first; owner pills A, V, Either', J(rows) === J([['a', false, 'A'], ['b', false, 'V'], ['c', true, 'Either']]), J(rows));
    check('a done chore says who ticked it', /Victoria · \d{1,2}:40/.test(await page.$eval('#ch .ch-row[data-chore="c"]', n => n.innerText)));
    await page.click('#ch .ch-row[data-chore="a"] .ch-check');
    check('ticking a chore', J((await page.evaluate(() => window.__ev)).pop()) === J(['toggle', 'a', true]));
    await page.click('#ch .ch-who .ch-pill >> text=Victoria'); await page.waitForTimeout(40);
    check('the Victoria filter: hers and Either', J(await page.$$eval('#ch .ch-row', ns => ns.map(n => n.dataset.chore))) === J(['b', 'c']));
    await page.click('#ch .ch-who .ch-pill >> text=All'); await page.click('#ch .ch-pills .ch-pill >> text=/^Weekly/'); await page.waitForTimeout(40);
    check('the Weekly chip shows the weekly chores, and when they reset', J(await page.$$eval('#ch .ch-row', ns => ns.map(n => n.dataset.chore))) === J(['e', 'd']) && /Resets every Friday/.test(await page.$eval('#ch', n => n.innerText)));
    await page.click('#ch .ch-row[data-chore="e"] .ch-more'); await page.waitForTimeout(40);
    await page.click('#ch .ch-row[data-chore="e"] .ch-set-owner >> text=Victoria');
    check('⋯ changes the owner', J((await page.evaluate(() => window.__ev)).pop()) === J(['owner', 'e', 'Victoria']));
    await page.selectOption('#ch .ch-row[data-chore="e"] .ch-cad', 'Monthly');
    check('…and the cadence', J((await page.evaluate(() => window.__ev)).pop()) === J(['cad', 'e', 'Monthly']));
    await page.click('#ch .ch-row[data-chore="d"] .ch-more'); await page.click('#ch .ch-row[data-chore="d"] .ch-del');
    check('…and deletes', J((await page.evaluate(() => window.__ev)).pop()) === J(['del', 'd']));
    await page.fill('#ch .ch-add-in', 'Wipe the counters'); await page.selectOption('#ch .ch-add-owner', 'Ahmed'); await page.click('#ch .ch-add-btn');
    check('adding: the chore, this cadence, and its owner', J((await page.evaluate(() => window.__ev)).pop()) === J(['add', 'Wipe the counters', 'Weekly', 'Ahmed']));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
