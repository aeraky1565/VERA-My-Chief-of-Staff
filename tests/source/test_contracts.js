// Finances › Contracts (Contracts.js, the contract routes, checkContracts_ / getContracts_, ContractsTab). Pins:
//  - "warn me N days ahead" is Notice Period Days, 60 when blank or unreadable (30 stays 30);
//    a new contract defaults to 60; the nightly check and the read use the same rule;
//  - Shop around makes one Task "Get quotes for …", due a week before the end (never in the past);
//  - Renewed / Cancel send the outcome in its own parameter (the route name already uses action);
//  - the screen: counters, category chips, renewing soon first with the three actions, the warning
//    window shown and editable, the rest by end date, ended folded. Invented contracts.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CT = read('Contracts.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };
const TODAY = isoOf(new Date());
const TH = ['ID', 'Task', 'Added Date', 'Due Date', 'Status', 'Recurring', 'Notes', 'Flagged', 'Completed'];
const CH = ['ID', 'Name', 'Category', 'Counterparty', 'Start Date', 'End Date', 'Auto-Renews', 'Notice Period Days', 'Monthly Cost', 'Status', 'Document Link', 'Notes'];
function sheetOf(rows) { return { rows, getLastRow: () => rows.length, appendRow: r => rows.push(r.slice()),
  getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
    setValue: x => { rows[r - 1][c - 1] = x; }, setValues: v => v.forEach((row, i) => { while (rows.length < r + i) rows.push([]); rows[r - 1 + i] = row.slice(); }) }) }; }

console.log('\nthe warning window');
const C = { String, Number, Math, JSON, Date, Object }; vm.createContext(C); vm.runInContext(CT, C);
check('60 when blank or unreadable; a set number stays', C.ctWarnDays_('') === 60 && C.ctWarnDays_(null) === 60 && C.ctWarnDays_('x') === 60 && C.ctWarnDays_(0) === 60 && C.ctWarnDays_('30') === 30 && C.ctWarnDays_(45) === 45 && C.ctWarnDays_(999) === 60);
check('the nightly check and the read both use it', /var noticeDays\s+= ctWarnDays_\(row\[7\]\);/.test(fnSrc(CODE, 'checkContracts_')) && /var noticeDays = ctWarnDays_\(row\[7\]\);/.test(fnSrc(CODE, 'getContracts_')));
check('a new contract and an update both use it', /ctWarnDays_\(p\.noticeDays\),/.test(fnSrc(WEB, 'webAddContract_')) && /'Notice Period Days': p\.noticeDays !== undefined \? ctWarnDays_\(p\.noticeDays\)/.test(fnSrc(WEB, 'webUpdateContract_')));
check('the Shop around due date: a week before the end, never in the past', C.ctShopDue_('2026-12-20', '2026-11-16') === '2026-12-13' && C.ctShopDue_('2026-11-20', '2026-11-16') === '2026-11-16' && C.ctShopDue_('2027-01-03', '2026-11-16') === '2026-12-27' && C.ctShopDue_('', '2026-11-16') === '2026-11-16');

console.log('\nShop around → Task');
{
  const tasks = sheetOf([TH.slice()]);
  const c = { String, Number, Math, JSON, Date, Object, TABS: { TASKS: 'Tasks' }, TASK_HEADERS: TH, Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: (d, tz, f) => f === 'yyyyMMdd' ? isoOf(d).replace(/-/g, '') : isoOf(d) },
    getSpreadsheet: () => ({ getSheetByName: () => tasks }), veraLocked_: f => f(), taskNextId_: () => 'T' + (tasks.rows.length),
    getContracts_: () => [{ id: 'con_1', name: 'Car insurance', counterparty: 'Acme Mutual', endDate: plus(23) }, { id: 'con_2', name: 'Gym', endDate: plus(3) }] };
  vm.createContext(c); vm.runInContext(CT, c);
  let r = c.webContractShopAround_({ parameter: { id: 'con_1' } });
  check('a Task "Get quotes for …", due a week before the end, tagged', r.ok && r.made && tasks.rows[1][1] === 'Get quotes for Car insurance (Acme Mutual)' && tasks.rows[1][3] === plus(16) && tasks.rows[1][4] === 'Open' && /VERA contract shop:con_1/.test(tasks.rows[1][6]), J(tasks.rows[1]));
  r = c.webContractShopAround_({ parameter: { id: 'con_1' } });
  check('…once: the open Task is kept', !r.made && tasks.rows.length === 2);
  r = c.webContractShopAround_({ parameter: { id: 'con_2' } });
  check('…ending within a week: due today', r.made && tasks.rows[2][3] === TODAY);
  check('an unknown contract is refused', c.webContractShopAround_({ parameter: { id: 'nope' } }).ok === false);
}

console.log('\nRenewed / Cancel');
{
  const sheet = sheetOf([CH.slice(), ['con_1', 'Car insurance', 'Insurance', '', '', plus(23), 'Yes', 60, 148, 'Active', '', '']]);
  const c = { String, Number, Math, JSON, Date, Object, CONFIG: { SHEET_ID: 'x' }, TABS: { CONTRACTS: 'C', FLAGS: 'F' }, CONTRACT_HEADERS: CH, FLAG_HEADERS: [],
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => n === 'C' ? sheet : null }) } };
  vm.createContext(c); vm.runInContext(fnSrc(WEB, 'webLogContractAction_'), c);
  c.webLogContractAction_({ parameter: { action: 'log_contract_action', id: 'con_1', outcome: 'Renewed', newEndDate: '2027-12-01' } });
  check('Renewed: the new end date, status back to Active', sheet.rows[1][5] === '2027-12-01' && sheet.rows[1][9] === 'Active', J(sheet.rows[1]));
  c.webLogContractAction_({ parameter: { action: 'log_contract_action', id: 'con_1', outcome: 'Terminated' } });
  check('Cancel: Terminated (not the route name)', sheet.rows[1][9] === 'Terminated', sheet.rows[1][9]);
  check('the screen sends outcome', /action:'log_contract_action',id:c\.id,outcome:'Terminated'/.test(APP) && /action:'log_contract_action',id:c\.id,outcome:'Renewed'/.test(APP));
}

console.log('\nthe list');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext(['ctWarn_', 'ctActive_', 'ctSoon_', 'ctMoney_', 'ctCounts_', 'ctSorted_', 'ctWhen_'].map(n => fnSrc(APP, n)).join('\n'), U);
const CS = [{ id: 'a', name: 'Car insurance', category: 'Insurance', endDate: plus(23), daysUntil: 23, noticeDays: 60, monthlyCost: 148, autoRenews: 'Yes', status: 'Active' },
  { id: 'b', name: 'Gym membership', category: 'Services', endDate: '2027-06-01', daysUntil: 197, noticeDays: 60, monthlyCost: 59, status: 'Active' },
  { id: 'c', name: 'Lease', category: 'Housing', endDate: plus(50), daysUntil: 50, noticeDays: 30, monthlyCost: 2100, status: 'Active' },
  { id: 'd', name: 'Alarm', category: 'Services', endDate: plus(5), daysUntil: 5, noticeDays: '', monthlyCost: 40, status: 'Active' },
  { id: 'e', name: 'Old phone plan', category: 'Services', endDate: plus(-40), daysUntil: -40, status: 'Terminated', monthlyCost: 60 }, { id: 'f', name: 'Streaming', category: 'Services', daysUntil: null, monthlyCost: 15, status: 'Active' }];
check('soon: inside its own window (30 d lease at 50 d isn’t)', J(U.ctSorted_(CS, 'all').soon.map(c => c.id)) === J(['d', 'a']) && J(U.ctSorted_(CS, 'all').later.map(c => c.id)) === J(['c', 'b', 'f']) && J(U.ctSorted_(CS, 'all').ended.map(c => c.id)) === J(['e']));
check('counters: soon, active, per month (active only)', J(U.ctCounts_(CS)) === J({ soon: 2, active: 5, perMonth: 2362 }));
check('a category', J(U.ctSorted_(CS, 'Services').soon.map(c => c.id)) === J(['d']));
check('when: renews in N d, a month and year later on, ended', U.ctWhen_(CS[0]) === 'Renews in 23 d' && U.ctWhen_(CS[1]) === 'Jun 2027' && U.ctWhen_(CS[5]) === 'No end date');

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
    await page.evaluate(({ cs }) => {
      window.__ev = []; window.confirm = () => true;
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'get_contracts') return Promise.resolve({ ok: true, contracts: cs }); if (p.action === 'contract_shop_around') return Promise.resolve({ ok: true, made: true, due: '2026-12-01' }); return Promise.resolve({ ok: true }); };
      document.body.innerHTML = '<div id="ct" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('ct')).render(React.createElement(ContractsTab, { apiUrl: 'u', apiToken: 't' }));
    }, { cs: CS });
    await page.waitForTimeout(250);
    const counts = await page.$$eval('#ct .ct-count', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
    check('counters', J(counts) === J(['2 Renewing soon', '5 Active', '$2,362 Per month']), J(counts));
    check('chips', J(await page.$$eval('#ct .ct-chip', ns => ns.map(n => n.textContent))) === J(['All', 'Housing', 'Insurance', 'Services']));
    check('renewing soon first, then the rest, ended folded', J(await page.$$eval('#ct .ct-card', ns => ns.map(n => n.dataset.contract))) === J(['d', 'a', 'c', 'b', 'f']));
    const a = await page.$eval('#ct .ct-card[data-contract="a"]', n => n.innerText);
    check('a soon card: when, the line, the three actions, the window', /Renews in 23 d/.test(a) && /Insurance · \$148\/mo · auto-renews/.test(a) && /Shop around → Task/.test(a) && /Renewed/.test(a) && /Cancel/.test(a) && /Warn me 60 days ahead/.test(a), a);
    check('…a later one has no actions', !(await page.$('#ct .ct-card[data-contract="b"] .ct-shop')) && /Jun 2027/.test(await page.$eval('#ct .ct-card[data-contract="b"]', n => n.innerText)));
    await page.click('#ct .ct-card[data-contract="a"] .ct-shop'); await page.waitForTimeout(60);
    check('Shop around makes the Task and says so', J((await page.evaluate(() => window.__ev)).filter(p => p.action === 'contract_shop_around').pop()) === J({ action: 'contract_shop_around', id: 'a' }) && /Task added: Get quotes for Car insurance/.test(await page.$eval('#ct', n => n.innerText)));
    await page.click('#ct .ct-card[data-contract="a"] .ct-renewed'); await page.fill('.ct-newend', '2027-11-30'); await page.click('.ct-renew-save'); await page.waitForTimeout(60);
    check('Renewed with a new end date', J((await page.evaluate(() => window.__ev)).filter(p => p.action === 'log_contract_action').pop()) === J({ action: 'log_contract_action', id: 'a', outcome: 'Renewed', newEndDate: '2027-11-30' }));
    await page.click('#ct .ct-card[data-contract="d"] .ct-cancel'); await page.waitForTimeout(60);
    check('Cancel', J((await page.evaluate(() => window.__ev)).filter(p => p.action === 'log_contract_action').pop()) === J({ action: 'log_contract_action', id: 'd', outcome: 'Terminated' }));
    await page.click('#ct .ct-card[data-contract="b"] .ct-warn'); await page.fill('#ct .ct-warn-in', '45'); await page.click('#ct .ct-warn-save'); await page.waitForTimeout(60);
    check('the window is editable on the card', J((await page.evaluate(() => window.__ev)).filter(p => p.action === 'update_contract').pop()) === J({ action: 'update_contract', id: 'b', noticeDays: '45' }));
    await page.click('#ct .ct-chip >> text=Housing'); await page.waitForTimeout(40);
    check('a chip', J(await page.$$eval('#ct .ct-card', ns => ns.map(n => n.dataset.contract))) === J(['c']));
    await page.click('#ct .ct-chip >> text=All'); await page.click('#ct .ct-fold'); await page.waitForTimeout(40);
    check('ended unfold', !!(await page.$('#ct .ct-card.ended[data-contract="e"]')));
    await page.click('#ct .ct-add'); await page.waitForTimeout(40);
    check('a new contract defaults to 60 days ahead', await page.evaluate(() => Array.from(document.querySelectorAll('.ct-modal label')).some(l => /Warn me \(days ahead\)/.test(l.textContent) && l.parentNode.querySelector('input').value === '60')));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
