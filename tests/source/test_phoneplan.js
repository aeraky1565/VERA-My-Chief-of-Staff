// Finances › Day to day › Phone plan (PhonePlan.js, issue #226) on an invented phone tracker:
// read by label, every month under its "Bill due" heading, this month picked, ours and the money
// back worked out where the tracker doesn't say, payers by bill (not by person), the plan's name,
// the Budget using the plan in place of the budget tracker's two family plan lines, the paid-back
// ticks kept in VERA, and the phone tracker never written. Every name and figure is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const { tracker, phoneTracker } = require('./budget_fixture.js');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PP = read('PhonePlan.js'), BG = read('Budget.js'), WEB = read('WebApp.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}
const writes = [];
function fakeSheet(name, grid, owner) {
  const note = () => { if (owner !== 'vera') writes.push(owner + ':' + name); };
  const sh = { getName: () => name, getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }), getLastRow: () => grid.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => ((grid[r - 1 + i] || [])[c - 1 + j]) ?? '')),
      setValues: v => { note(); v.forEach((row, i) => row.forEach((x, j) => { while (grid.length < r + i) grid.push([]); grid[r - 1 + i][c - 1 + j] = x; })); return sh; },
      setValue: x => { note(); grid[r - 1][c - 1] = x; return sh; },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; } }),
    appendRow: row => { note(); grid.push(row.slice()); }, deleteRow: r => { note(); grid.splice(r - 1, 1); }, setFrozenRows() {} };
  return sh;
}
const PHONE = phoneTracker(), TRACKER = tracker(), VERA = {};
const ss = (store, owner, title) => ({ getName: () => title || 'Sheet', getSheetByName: n => store[n] ? fakeSheet(n, store[n], owner) : null,
  getSheets: () => Object.keys(store).map(n => fakeSheet(n, store[n], owner)), insertSheet: n => { store[n] = []; return fakeSheet(n, store[n], owner); } });
const CONFIG = { phone_plan_sheet_id: 'phone-test' };
const S = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => k === 'SAT_SHEET_ID' ? 'sat-test' : null }) },
  SpreadsheetApp: { openById: id => id === 'sat-test' ? ss({ Tracker: TRACKER }, 'tracker') : id === 'phone-test' ? ss({ Sheet1: PHONE }, 'phone', 'Example Family Plan') : (() => { throw new Error('no such sheet'); })() },
  Utilities: { getUuid: () => 'abcdef12-3456-7890-0000', formatDate: () => '2026-11-02' },
  Session: { getScriptTimeZone: () => 'UTC' }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, Logger: { log() {} },
  getSpreadsheet: () => ss(VERA, 'vera'), getConfigValues: () => CONFIG,
};
vm.createContext(S);
vm.runInContext(extractFn(read('Code.js'), 'ensureSheet'), S);
['tiSchema_', 'tiRows_', 'tiRowOf_', 'tiMintId_', 'tiNow_', 'tiLocked_'].forEach(n => vm.runInContext(extractFn(read('TripIdeas.js'), n), S));
vm.runInContext(BG, S); vm.runInContext(PP, S);
const run = (expr, vars) => { Object.assign(S, vars || {}); return vm.runInContext(expr, S); };

console.log('\nreading the phone tracker by label');
let P = run('ppParse_(G, "2026-11-02", ["Pat", "Sam"])', { G: phoneTracker() });
check('this month picked from the “Bill due” headings', P.ok && P.month === '2026-11' && P.dueDay === 12 && P.dueLabel === 'Bill due 11/12', J([P.month, P.dueDay]));
check('total, ours and the money back as the tracker has them', P.total === 168.5 && P.ours === 72 && P.credit === 96.5 && P.checks === true);
check('payers by bill, not by person, and never ours', J(P.payers) === J([{ name: 'Group (Robin & Lee)', amount: 71 }, { name: 'Kim', amount: 25.5 }]), J(P.payers));
check('the by-person split, ours marked', J(P.members.map(m => m.name + (m.ours ? '*' : '') + '=' + m.amount)) === J(['Pat*=42', 'Sam*=30', 'Robin=51', 'Lee=20', 'Kim=25.5']));
check('every month it has', J(P.months.map(m => m.month)) === J(['2026-09', '2026-10', '2026-11']));
const oct = P.months[1], sep = P.months[0];
check('a month without “Our total”: ours and money back from the payments', oct.ours === 71 && oct.credit === 95 && oct.bills.length === 4 && oct.bills[2].label === 'Bill 3 - Group (Robin & Lee)');
check('a month without payments: ours from the people, the rest is money back', sep.ours === 70 && sep.credit === 95 && sep.bills.length === 0);
check('another day picks its month', run('ppParse_(G, "2026-10-20", ["Pat", "Sam"]).month', { G: phoneTracker() }) === '2026-10');
check('a month the tracker doesn’t have yet: the latest it does', run('ppParse_(G, "2027-02-01", ["Pat", "Sam"]).month', { G: phoneTracker() }) === '2026-11');
check('labels, not positions: a column added in front still reads', run('ppParse_(G, "2026-11-02", ["Pat", "Sam"]).total', { G: phoneTracker().map(r => [''].concat(r)) }) === 168.5);
check('no “Bill due” headings: unavailable, with why', /Bill due/.test(run('ppParse_([["x"]], "2026-11-02", []).error')));

console.log('\nthe Budget uses the plan');
let r = run('webGetBudgetModel_()');
const fp = r.model.shared.fixed.find(x => x.name === 'Family Plan Payment');
check('the family plan lines come from the phone tracker', fp.amount === 168.5 && fp.trackerAmount === 200 && r.model.phone.ours === 72 && r.model.phone.month === '2026-11', J(fp));
check('the shared total moves by the difference, and the match check names it', r.computed.shared.total === 3150 + (168.5 - 96.5) - 150 && r.match.find(x => x.id === 'totalShared').because === 'the phone plan, from the phone tracker');
delete CONFIG.phone_plan_sheet_id;
r = run('webGetBudgetModel_()');
check('no phone tracker connected: the budget tracker’s own lines', !r.model.phone && r.model.shared.fixed.find(x => x.name === 'Family Plan Payment').amount === 200);
CONFIG.phone_plan_sheet_id = 'phone-test';

console.log('\nthe Phone plan tab');
r = run('webGetPhonePlan_()');
check('phone_plan: this month, every month, the payers', r.ok && r.plan.month === '2026-11' && r.plan.months.length === 3 && r.plan.payers.length === 2 && J(r.received) === '{}', J(Object.keys(r)));
check('the plan’s name: the tracker’s title unless Config names it', r.plan.name === 'Example Family Plan');
CONFIG.phone_plan_name = 'Example Mobile · Unlimited Plus';
check('…Config phone_plan_name wins', run('webGetPhonePlan_()').plan.name === 'Example Mobile · Unlimited Plus');
r = run('webMarkPhonePayback_({ month: "2026-11", payer: "Kim", amount: 25.5, received: true })');
check('marking received keeps a tick in VERA', r.ok && /^\d{4}-/.test(r.receivedAt) && VERA['Phone Paybacks'].length === 2 && J(VERA['Phone Paybacks'][0]) === J(['Month', 'Payer', 'Amount', 'Received At']));
check('…and it reads back for the month', Object.keys(run('webGetPhonePlan_()').received).join() === 'kim');
check('marking again doesn’t add a second', run('webMarkPhonePayback_({ month: "2026-11", payer: "Kim", amount: 25.5, received: true })').ok && VERA['Phone Paybacks'].length === 2);
check('undo removes it', run('webMarkPhonePayback_({ month: "2026-11", payer: "kim", received: false })').ok && VERA['Phone Paybacks'].length === 1);
check('a bad month or no payer is refused', run('webMarkPhonePayback_({ month: "Nov", payer: "Kim", received: true })').ok === false && run('webMarkPhonePayback_({ month: "2026-11", payer: "", received: true })').ok === false);
check('neither tracker was written', writes.length === 0, J(writes));
delete CONFIG.phone_plan_sheet_id;
check('not connected: says which Config row', /phone_plan_sheet_id/.test(run('webGetPhonePlan_()').error));
check('the routes are wired', /case 'phone_plan':\s+return jsonOut_\(webGetPhonePlan_\(\)\)/.test(WEB) && /case 'phone_payback_mark':\s+return jsonOut_\(webMarkPhonePayback_\(body\)\)/.test(WEB));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
