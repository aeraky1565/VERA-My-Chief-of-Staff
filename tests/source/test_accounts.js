// Finances › Accounts (Accounts.js: bill_estimates; AccountsTab). Pins:
//  - the estimate for a bill with no amount: the average of its last 3 payments (money out,
//    newest months first), matched by the bill's words or a Config alias;
//  - Keep at least: bills (monthly and more often, bi-weekly as 26/12), ~estimated, and yearly /
//    quarterly / semiannual bills set aside monthly; one-time bills and income don't count;
//  - the transfers to Joint split the joint accounts' minimums;
//  - the screen: transfers on top, the unassigned warning with Assign, compact cards with an
//    owner pill and Keep at least and its parts, tap for the bills, no balances. Invented bills.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const AC = read('Accounts.js'), BS = read('BillSchedule.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }

console.log('\nestimates from the transactions');
const BS_STOP = (BS.match(/var BS_STOP_\s*=\s*[^;]+;/) || ['var BS_STOP_ = {};'])[0];
const C = { String, Number, Math, JSON, Object }; vm.createContext(C);
vm.runInContext(BS_STOP + '\n' + ['bsText_', 'bsWords_'].map(n => fnSrc(BS, n)).join('\n') + '\n' + AC, C);
check('the last 12 months, newest first, across a year end', J(C.acMonths_('2026-02', 4)) === J(['2026-02', '2026-01', '2025-12', '2025-11']));
const TX = [{ month: '2026-11', description: 'CITY WATER UTILITY', amount: -62 }, { month: '2026-10', description: 'City Water Utility', amount: -58 }, { month: '2026-09', description: 'CITY WATER', amount: -60 },
  { month: '2026-08', description: 'CITY WATER', amount: -200 }, { month: '2026-11', description: 'WATER REFUND', amount: 20 }, { month: '2026-10', description: 'PSEG ELECTRIC', amount: -110 }, { month: '2026-11', description: 'Coffee', amount: -5 }];
const E = C.acEstimates_([{ bill: 'Water bill' }, { bill: 'Electricity' }, { bill: 'Trash pickup' }], TX, { pseg: 'Electricity' });
check('the average of the last 3 payments, newest months first, money out only', E['Water bill'] && E['Water bill'].amount === 60 && E['Water bill'].count === 3 && J(E['Water bill'].months) === J(['2026-11', '2026-10', '2026-09']), J(E['Water bill']));
check('a Config alias matches too', E.Electricity && E.Electricity.amount === 110 && E.Electricity.count === 1);
check('no payment, no estimate', !E['Trash pickup']);

console.log('\nkeep at least');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext((APP.match(/var AC_PER_MONTH_=\{[^}]*\};/) || [''])[0] + '\n' + ['acFreq_', 'acYearly_', 'acMinimum_', 'acMoney_', 'acPill_', 'acTransfers_'].map(n => fnSrc(APP, n)).join('\n'), U);
const BILLS = [{ bill: 'Mortgage', amount: 2100, frequency: 'Monthly', account: 'Joint checking' }, { bill: 'Water bill', amount: null, frequency: 'Monthly', account: 'Joint checking' },
  { bill: 'Home insurance', amount: 1800, frequency: 'Annual', account: 'Joint checking' }, { bill: 'Gym', amount: 24, frequency: 'Bi-weekly', account: 'Joint checking' },
  { bill: 'Gutter guard', amount: 900, frequency: 'One-time', account: 'Joint checking' }, { bill: 'Salary', amount: 5000, type: 'Income', account: 'Joint checking' },
  { bill: 'Trash pickup', amount: null, frequency: 'Monthly', account: 'Joint checking' }, { bill: 'Car tax', amount: 300, frequency: 'Quarterly', account: 'Ahmed checking' }, { bill: 'Phone', amount: 80, account: 'Ahmed checking' }];
const EST = { 'Water bill': { amount: 60, count: 3 } };
const jm = U.acMinimum_(BILLS.filter(b => b.account === 'Joint checking'), EST);
check('bills, ~estimated and yearly set-aside', jm.bills === 2152 && jm.estimated === 60 && jm.setAside === 150 && jm.total === 2362, J(jm));
check('…a bill with neither an amount nor an estimate is listed, not guessed', J(jm.missing) === J(['Trash pickup']) && jm.count === 5);
check('…one-time bills and income don’t count', !/Gutter|Salary/.test(J(jm)));
check('quarterly is set aside monthly; no frequency is monthly', J((m => [m.bills, m.setAside, m.total])(U.acMinimum_(BILLS.filter(b => b.account === 'Ahmed checking'), {}))) === J([80, 100, 180]));
const tr = U.acTransfers_([{ name: 'Joint checking', owner: 'Joint' }, { name: 'Ahmed checking', owner: 'Ahmed' }], BILLS, EST, { ahmed: 58, victoria: 42 });
check('transfers: the joint minimum, split', tr.joint === 2362 && tr.ahmed === 1370 && tr.victoria === 992 && tr.split === '58 / 42', J(tr));
check('owner pills', J(['Ahmed', 'Victoria', 'Joint', ''].map(o => U.acPill_(o)[0])) === J(['A', 'V', 'J', 'J']));

console.log('\nmoving a tracker bill to an account');
{
  const B = { String, Number, Math, JSON, Object }; vm.createContext(B);
  vm.runInContext((BS.match(/var BS_HEADERS_\s*=\s*[^;]+;/) || [''])[0] + '\n' + ['bsText_', 'bsWithAccount_'].map(n => fnSrc(BS, n)).join('\n'), B);
  const rows = [['Rent', 1, 'Old acct', true, '', 'bill', 'landlord', '2026-11'], ['Water', '', '', false, '', 'bill', '', '']];
  const w = B.bsWithAccount_(rows, 'rent', 'Joint checking');
  check('a line already in the Bill Schedule: only its account changes', w.at === 0 && J(w.row.slice(0, 8)) === J(['Rent', 1, 'Joint checking', true, '', 'bill', 'landlord', '2026-11']), J(w));
  const n = B.bsWithAccount_(rows, 'Internet', 'Ahmed checking');
  check('…a new line gets a bill row with just the account', n.at === -1 && J(n.row) === J(['Internet', '', 'Ahmed checking', false, '', 'bill', '', '']), J(n));
  check('the route is wired (POST)', /case 'bills_schedule_account':\s+return jsonOut_\(webSaveBillAccount_\(body\)\)/.test(read('WebApp.js')));
  check('Bills (both dashboards): a tracker bill’s account goes to the Bill Schedule', APP.indexOf("if(!row){if(line)apiPost(apiUrl,apiToken,{action:'bills_schedule_account',line:line,account:account})") !== -1 &&
    /if \(!row\) \{ if \(line\) apiPost\(apiUrl, apiToken, \{ action: 'bills_schedule_account', line: line, account: account \}\)/.test(read('docs/dashboard-lite.html')) &&
    APP.indexOf('if(v&&onReassign&&(b.row||b.key||b.bill))onReassign(b.row,v,b.key||b.bill)') !== -1);
}

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
    await page.evaluate(({ bills, est }) => {
      window.__ev = [];
      const accounts = [{ row: 2, name: 'Joint checking', owner: 'Joint', institution: 'Credit Union', type: 'Checking', balance: 9999 }, { row: 3, name: 'Ahmed checking', owner: 'Ahmed', institution: 'Bank', type: 'Checking' }];
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'get_bank_accounts') return Promise.resolve({ ok: true, accounts }); if (p.action === 'bill_estimates') return Promise.resolve({ ok: true, estimates: est });
        if (p.action === 'bills') return Promise.resolve({ ok: true, bills: bills.map(b => b.bill === 'Netflix' ? Object.assign({}, b, { account: 'Ahmed checking' }) : b) }); return Promise.resolve({ ok: true }); };
      window.apiPost = (u, t, b) => { window.__ev.push(b); return Promise.resolve({ ok: true }); };
      document.body.innerHTML = '<div id="ac" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('ac')).render(React.createElement(AccountsTab, { apiUrl: 'u', apiToken: 't', bills: { bills }, split: { ahmed: 58, victoria: 42 } }));
    }, { bills: BILLS.map((b, i) => Object.assign({ row: i + 2 }, b)).concat([{ row: 30, bill: 'Netflix', amount: 15, frequency: 'Monthly', account: '' }, { row: null, key: 'Old card', bill: 'Old card', amount: 40, account: 'Shared' }]), est: EST });
    await page.waitForTimeout(300);
    const text = await page.$eval('#ac', n => n.innerText);
    check('transfers on top, split', text.toLowerCase().indexOf('this month’s transfers') < text.toLowerCase().indexOf('\naccounts\n') && /Ahmed → Joint[\s\S]*\$1,370/.test(text) && /Victoria → Joint[\s\S]*\$992/.test(text), text.slice(0, 300));
    check('no balances', !/9,999|Balance/i.test(text));
    check('the unassigned warning', /⚠ 2 bills with no account/.test(text));
    const card = await page.$eval('#ac .ac-card[data-account="Joint checking"]', n => n.innerText.replace(/\s+/g, ' '));
    check('a card: owner pill, Keep at least ~$2,362 and its parts', /Keep at least ~\$2,362 · 5 bills/.test(card) && /\$2,152 bills · ~\$60 estimated · \$150 yearly set-aside · 1 with no amount yet/.test(card) && /J/.test(await page.$eval('#ac .ac-card[data-account="Joint checking"] .ac-pill', n => n.textContent)), card);
    check('…no ~ without an estimate', /Keep at least \$180 · 2 bills/.test(await page.$eval('#ac .ac-card[data-account="Ahmed checking"]', n => n.innerText.replace(/\s+/g, ' '))));
    check('the bills are folded', !(await page.$('#ac .ac-card[data-account="Joint checking"] .ac-bill')));
    await page.click('#ac .ac-card[data-account="Joint checking"] .ac-card-h'); await page.waitForTimeout(40);
    check('…tap shows them, an estimate marked ~', /~\$60/.test(await page.$eval('#ac .ac-bill[data-bill="Water bill"]', n => n.innerText)) && (await page.$$('#ac .ac-card[data-account="Joint checking"] .ac-bill')).length === 6);
    await page.click('#ac .ac-assign'); await page.waitForTimeout(40);
    check('Assign lists the bills with no account', J(await page.$$eval('#ac .ac-unlist .ac-bill', ns => ns.map(n => n.dataset.bill))) === J(['Netflix', 'Old card']));
    await page.click('#ac .ac-unlist .ac-bill[data-bill="Netflix"] .ac-move'); await page.waitForTimeout(80);
    check('…✎ opens the move dialog for that bill', /Reassign Bill\s+Netflix/.test(await page.$eval('.modal-box', n => n.innerText)));
    await page.click('.modal-box button >> text=Cancel'); await page.waitForTimeout(40);
    await page.click('#ac .ac-unlist .ac-bill[data-bill="Old card"] .ac-move'); await page.waitForTimeout(60);
    await page.click('.modal-box button >> text=Ahmed checking'); await page.click('.modal-box button >> text=Assign'); await page.waitForTimeout(120);
    const sent = (await page.evaluate(() => window.__ev)).filter(p => p.action === 'bills_schedule_account' || p.action === 'update_bill');
    check('a tracker bill (no row) is moved through the Bill Schedule, not update_bill', J(sent) === J([{ action: 'bills_schedule_account', line: 'Old card', account: 'Ahmed checking' }]), J(sent));
    check('…with no error', !/failed/i.test(await page.$eval('#ac', n => n.innerText)));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
