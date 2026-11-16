// Home Front › Chores › For Others (ChoresForOthers.js, the routes in WebApp.js, ChoresForOthersView). Pins:
//  - a money reward reads as dollars ("$10", "7.50"); anything else ("movie night") isn't money;
//  - Done stamps a Done Date; Paid stamps Paid, for one chore or all of a person's done, unpaid ones;
//    the two columns are added and named on a tab made before them; paying twice pays nothing;
//  - rewards owed per person, the counters, and a Needs you row on the full Home after 7 days unpaid;
//  - the screen: counters, the person filter, rewards owed with Paid, open jobs with ✓ Done, the
//    Done fold with Paid per chore, the add / edit sheet (Not done yet, Delete). Invented people.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CFO = read('ChoresForOthers.js'), WEB = read('WebApp.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
function fakeSheet(rows, maxCols) {
  const grid = rows.map(r => r.slice()); let cols = maxCols || 7;
  const pad = r => { while (r.length < cols) r.push(''); return r; }; grid.forEach(pad);
  return { grid, getLastRow: () => grid.length, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; grid.forEach(pad); },
    getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
      setValue: x => { grid[r - 1][c - 1] = x; }, setValues: v => v.forEach((row, i) => row.forEach((x, j) => { grid[r - 1 + i][c - 1 + j] = x; })) }),
    appendRow: r => grid.push(pad(r.slice())) };
}
const HEAD = ['ID', 'Task', 'Assignee', 'Reward', 'Status', 'Added Date', 'Notes'];
function ctx(sheet) {
  const c = { String, Number, Math, JSON, Date, Object, isNaN, Logger: { log() {} }, TABS: { CHORES_FOR_OTHERS: 'ChoresForOthers' },
    getSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }), Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 10) } };
  vm.createContext(c);
  vm.runInContext(CFO + '\n' + ['webPayChoresForOthers_', 'webCompleteChoreForOthers_'].map(n => fnSrc(WEB, n)).join('\n'), c);
  return c;
}
const TODAY = new Date().toISOString().slice(0, 10);

console.log('\nrewards, done and paid');
{
  const sh = fakeSheet([HEAD, ['cfo_1', 'Rake the leaves', 'Sam', '$10', 'Open', '2026-11-01', ''], ['cfo_2', 'Walk the dog', 'Sam', '5', 'Done', '2026-11-02', ''],
    ['cfo_3', 'Clean your room', 'Jo', 'movie night', 'Open', '2026-11-03', ''], ['cfo_4', 'Wash the car', 'Jo', '$7.50', 'Open', '2026-11-03', '']]);
  const c = ctx(sh);
  check('a reward reads as dollars when it is money', c.cfoAmount_('$10') === 10 && c.cfoAmount_(' 7.50 ') === 7.5 && c.cfoAmount_('5 dollars') === 5 && c.cfoAmount_('movie night') === null && c.cfoAmount_('') === null && c.cfoAmount_('$10 + ice cream') === null);
  const r = c.webCompleteChoreForOthers_({ parameter: { id: 'cfo_1' } });
  check('Done stamps a Done Date, in a new, named column', r.ok && sh.grid[1][4] === 'Done' && sh.grid[0][7] === 'Done Date' && sh.grid[0][8] === 'Paid' && sh.grid[1][7] === TODAY, J(sh.grid[0]) + J(sh.grid[1]));
  let p = c.webPayChoresForOthers_({ parameter: { id: 'cfo_1' } });
  check('Paid on one chore stamps Paid', p.ok && J(p.paid) === J(['cfo_1']) && p.total === 10 && sh.grid[1][8] === TODAY);
  let threw = false; try { c.webPayChoresForOthers_({ parameter: { id: 'cfo_1' } }); } catch (e) { threw = true; }
  check('paying it twice is refused', threw);
  threw = false; try { c.webPayChoresForOthers_({ parameter: { id: 'cfo_4' } }); } catch (e) { threw = true; }
  check('an open chore can’t be paid', threw && sh.grid[4][8] === '');
  try { p = c.webPayChoresForOthers_({ parameter: { assignee: 'sam' } }); } catch (e) { p = { error: e.message }; }
  check('Paid for a person pays all their done, unpaid chores', J(p.paid) === J(['cfo_2']) && p.total === 5 && sh.grid[2][8] === TODAY && sh.grid[4][8] === '', J(p));
  const got = c.getChoresForOthers_();
  check('the read sends Done Date, Paid and the amount', got[0]['Done Date'] === TODAY && got[0].Paid === TODAY && got[0].amount === 10 && got[2].amount === null && got[1]['Added Date'] === '2026-11-02', J(got[0]));
}

console.log('\nowed, counters and Needs you');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext(['cfoAmt_', 'cfoMoney_', 'cfoIso_', 'cfoDone_', 'cfoPaid_', 'cfoDay_', 'cfoAge_', 'cfoOwed_', 'cfoCounts_', 'cfoPeople_', 'cfoNeeds_'].map(n => fnSrc(APP, n)).join('\n') + '\nvar CFO_NUDGE_DAYS_=7;', U);
const NOW = new Date(2026, 10, 16);
const CHORES = [
  { ID: 'a', Task: 'Rake the leaves', Assignee: 'Sam', Reward: '$10', Status: 'Done', 'Done Date': '2026-11-05', Paid: '' },
  { ID: 'b', Task: 'Walk the dog', Assignee: 'Sam', Reward: '$5', Status: 'Done', 'Done Date': '2026-11-14', Paid: '' },
  { ID: 'c', Task: 'Wash the car', Assignee: 'Jo', Reward: '$7.50', Status: 'Done', 'Done Date': '2026-11-12', Paid: '' },
  { ID: 'd', Task: 'Clean your room', Assignee: 'Jo', Reward: 'movie night', Status: 'Done', 'Done Date': '2026-10-01', Paid: '' },
  { ID: 'e', Task: 'Fold laundry', Assignee: 'Jo', Reward: '$3', Status: 'Done', 'Done Date': '2026-11-02', Paid: '2026-11-03' },
  { ID: 'f', Task: 'Take out the bins', Assignee: 'Sam', Reward: '$2', Status: 'Open', 'Added Date': '2026-11-15' },
  { ID: 'g', Task: 'Water the plants', Assignee: 'Jo', Reward: '', Status: 'Open' }];
const owed = U.cfoOwed_(CHORES);
check('rewards owed per person: done, unpaid, money only', J(owed.map(o => [o.who, o.total, o.chores.map(c => c.ID)])) === J([['Sam', 15, ['a', 'b']], ['Jo', 7.5, ['c']]]), J(owed.map(o => [o.who, o.total])));
check('the counters: open, done this month, owed', J(U.cfoCounts_(CHORES, NOW)) === J({ open: 2, month: 4, owed: 22.5 }), J(U.cfoCounts_(CHORES, NOW)));
check('money shows as $10 or $7.50', U.cfoMoney_(10) === '$10' && U.cfoMoney_(7.5) === '$7.50');
const needs = U.cfoNeeds_(CHORES, NOW);
check('Needs you: a person with a reward unpaid 7+ days, their whole total', needs.length === 1 && needs[0].title === 'Pay Sam $15 (2 chores)' && /11 days ago/.test(needs[0].sub) && J(needs[0].go) === J(['home_front', 'chores_for_others']), J(needs));
check('…one chore names it', U.cfoNeeds_([CHORES[0]], NOW)[0].title === 'Pay Sam $10 for rake the leaves');
check('…not before 7 days', U.cfoNeeds_([CHORES[1], CHORES[2]], NOW).length === 0 && U.cfoNeeds_([Object.assign({}, CHORES[2], { 'Done Date': '2026-11-09' })], NOW).length === 1);
check('the full Home asks for For Others and adds its rows', /\['cfo','get_chores_for_others'\]/.test(APP) && /\.concat\(cfoNeeds_\(\(ex\.cfo\|\|\{\}\)\.chores,new Date\(\)\)\)/.test(APP));
check('the lite Today doesn’t list rewards', !/cfoNeeds_|kind: 'reward'/.test(read('docs/dashboard-lite.html')));

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
      document.body.innerHTML = '<div id="cfo" style="padding:0 16px"></div>';
      const root = ReactDOM.createRoot(document.getElementById('cfo'));
      const ym = new Date().toISOString().slice(0, 7);
      const list = chores.map(c => c['Done Date'] ? Object.assign({}, c, { 'Done Date': ym + c['Done Date'].slice(7) }) : c);
      root.render(React.createElement(ChoresForOthersView, { chores: list, loading: false, busy: false, onAdd: f => window.__ev.push(['add', f]), onComplete: i => window.__ev.push(['done', i]),
        onEdit: (i, f) => window.__ev.push(['edit', i, f]), onDelete: i => window.__ev.push(['del', i]), onPay: q => window.__ev.push(['pay', q]), onReopen: i => window.__ev.push(['reopen', i]) }));
    }, { chores: CHORES.filter(c => c.ID !== 'd') });
    await page.waitForTimeout(250);
    const counts = await page.$$eval('#cfo .cfo-count', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
    check('counters: open, done this month, rewards owed', J(counts) === J(['2 Open', '4 Done this month', '$22.50 Rewards owed']), J(counts));
    const owe = await page.$$eval('#cfo .cfo-owe', ns => ns.map(n => n.dataset.owed + ':' + n.querySelector('.cfo-pay').textContent));
    check('rewards owed per person, with Paid', J(owe) === J(['Sam:Paid $15', 'Jo:Paid $7.50']), J(owe));
    await page.click('#cfo .cfo-owe[data-owed="Sam"] .cfo-pay');
    check('Paid pays that person', J((await page.evaluate(() => window.__ev)).pop()) === J(['pay', { assignee: 'Sam' }]));
    check('open jobs only, with rewards', J(await page.$$eval('#cfo .cfo-row', ns => ns.map(n => n.dataset.cfo))) === J(['f', 'g']) && (await page.$eval('#cfo .cfo-row[data-cfo="f"] .cfo-reward', n => n.textContent)) === '$2');
    await page.click('#cfo .cfo-row[data-cfo="f"] .cfo-done');
    check('✓ Done', J((await page.evaluate(() => window.__ev)).pop()) === J(['done', 'f']));
    await page.click('#cfo .cfo-pill >> text=Jo'); await page.waitForTimeout(40);
    check('the person filter: Jo’s open jobs and owed', J(await page.$$eval('#cfo .cfo-row', ns => ns.map(n => n.dataset.cfo))) === J(['g']) && J(await page.$$eval('#cfo .cfo-owe', ns => ns.map(n => n.dataset.owed))) === J(['Jo']));
    await page.click('#cfo .cfo-pill >> text=Everyone');
    await page.click('#cfo .cfo-fold'); await page.waitForTimeout(40);
    const fold = await page.$eval('#cfo .cfo-fold', n => n.textContent);
    check('the Done fold counts this month', /^Done · 4 this month/.test(fold), fold);
    check('…and says paid or not', /paid /.test(await page.$eval('#cfo .cfo-row.done[data-cfo="e"]', n => n.innerText)) && /not paid yet/.test(await page.$eval('#cfo .cfo-row.done[data-cfo="c"]', n => n.innerText)) && !(await page.$('#cfo .cfo-row.done[data-cfo="e"] .cfo-pay-one')));
    await page.click('#cfo .cfo-row.done[data-cfo="c"] .cfo-pay-one');
    check('…Paid on one chore', J((await page.evaluate(() => window.__ev)).pop()) === J(['pay', { id: 'c' }]));
    await page.click('#cfo .cfo-new'); await page.fill('.cfo-in-task', 'Sweep the porch'); await page.fill('.cfo-in-who', 'Jo'); await page.fill('.cfo-in-reward', '$4'); await page.click('.cfo-save');
    check('＋ Chore adds one with its person and reward', J((await page.evaluate(() => window.__ev)).pop()) === J(['add', { task: 'Sweep the porch', assignee: 'Jo', reward: '$4', notes: '' }]));
    await page.click('#cfo .cfo-row.done[data-cfo="c"] .cfo-more'); await page.click('.cfo-reopen');
    check('the sheet: Not done yet', J((await page.evaluate(() => window.__ev)).pop()) === J(['reopen', 'c']));
    await page.click('#cfo .cfo-row[data-cfo="g"] .cfo-more'); check('…no Not done yet on an open one', !(await page.$('.cfo-reopen')));
    await page.click('.cfo-del');
    check('…Delete', J((await page.evaluate(() => window.__ev)).pop()) === J(['del', 'g']));
    await page.click('#cfo .cfo-new'); await page.fill('.cfo-in-reward', 'ice cream');
    check('a reward that isn’t money says it won’t count', /won’t count toward rewards owed/.test(await page.$eval('.cfo-sheet', n => n.innerText)));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
