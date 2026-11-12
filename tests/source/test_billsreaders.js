// Every reader of the bills now takes them from the budget tracker and Bill Schedule (bsBillRows_,
// issue #226): the bills route, toggling paid by name, Cashflow, the calendar bills and their toggle,
// the bill nudge, the morning email, Claude's and Chat's context, and the weekly snapshot. Paid is
// kept in Bill Schedule; the old Bills sheet is only read (its Income rows), and is what every
// reader falls back to when the tracker can't be read. Every name and figure is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const { tracker } = require('./budget_fixture.js');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BS = read('BillSchedule.js'), BG = read('Budget.js'), WEB = read('WebApp.js'), REM = read('Reminders.js'), CODE = read('Code.js'),
      CL = read('Claude.js'), CHAT = read('Chat.js'), MEM = read('Memory.js'), FIN = read('Finance.js');

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
const between = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + 1); if (a === -1 || b === -1) throw new Error('moved: ' + from.slice(0, 50)); return src.slice(a, b); };

const now = new Date(), p2 = n => String(n).padStart(2, '0');
const MONTH = now.getFullYear() + '-' + p2(now.getMonth() + 1), DAY = now.getDate();
const writes = [];
function fakeSheet(name, grid, owner) {
  const note = () => { if (owner !== 'vera' || name === 'Bills') writes.push(owner + ':' + name); };
  const sh = { getName: () => name, getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }), getLastRow: () => grid.length,
    getLastColumn: () => grid.reduce((m, r) => Math.max(m, r.length), 0),
    getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => ((grid[r - 1 + i] || [])[c - 1 + j]) ?? '')),
      getValue: () => ((grid[r - 1] || [])[c - 1]) ?? '',
      setValues: v => { note(); v.forEach((row, i) => row.forEach((x, j) => { while (grid.length < r + i) grid.push([]); while (grid[r - 1 + i].length < c + j) grid[r - 1 + i].push(''); grid[r - 1 + i][c - 1 + j] = x; })); return sh; },
      setValue: x => { note(); while (grid[r - 1].length < c) grid[r - 1].push(''); grid[r - 1][c - 1] = x; return sh; },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; } }),
    appendRow: row => { note(); grid.push(row.slice()); }, deleteRow: r => { note(); grid.splice(r - 1, 1); }, setFrozenRows() {} };
  return sh;
}
const TRACKER = tracker();
const OLD = [['Bill', 'Amount', 'Due Day', 'Frequency', 'Category', 'Account', 'Paid', 'Notes', 'Type', 'Budget Entry'],
  ['Rent', 1500, 1, 'Monthly', 'Housing', 'Joint', '', 'an old amount', 'Expense', 'Rent'],
  ['Sam paycheck', 2000, 15, 'Bi-weekly', 'Income', 'Sam checking', '', '', 'Income', '']];
const VERA = { Bills: OLD,
  'Bill Schedule': [['Tracker Line', 'Due Day', 'Account Override', 'Autopay', 'Card Link', 'Kind', 'Notes', 'Paid'],
    ['Internet', DAY, '', true, '', 'bill', '', ''], ['Rent', '', '', false, '', 'bill', '', MONTH], ['Gold Card', DAY, 'Pat checking', false, 'Gold Card', 'card payment', '', ''], ['Family Plan Payment', '', '', false, '', 'bill', '', '2000-01']] };
const BILLS_BEFORE = J(OLD);
const ss = (store, owner) => ({ getSheetByName: n => store[n] ? fakeSheet(n, store[n], owner) : null, getSheets: () => Object.keys(store).map(n => fakeSheet(n, store[n], owner)),
  insertSheet: n => { store[n] = []; return fakeSheet(n, store[n], owner); } });
const PROPS = { SAT_SHEET_ID: 'sat-test' };
const S = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => PROPS[k] || null }) },
  SpreadsheetApp: { openById: id => { if (id === 'sat-test') return ss({ Tracker: TRACKER }, 'tracker'); throw new Error('no such sheet'); }, flush() {} },
  Utilities: { getUuid: () => 'abcdef12-3456-7890-0000', formatDate: (d, tz, pat) => { const D = new Date(d);
    if (pat === 'yyyy-MM') return D.getFullYear() + '-' + p2(D.getMonth() + 1); if (pat === 'yyyy-MM-dd') return D.getFullYear() + '-' + p2(D.getMonth() + 1) + '-' + p2(D.getDate()); throw new Error(pat); } },
  Session: { getScriptTimeZone: () => 'UTC' }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, Logger: { log() {} },
  getSpreadsheet: () => ss(VERA, 'vera'), getConfigValues: () => ({}), getConfigAliases_: () => ({}),
  TABS: { BILLS: 'Bills', CONFIG: 'Config' }, BILL_HEADERS: OLD[0],
};
vm.createContext(S); loadSettings_(S);
vm.runInContext(extractFn(CODE, 'ensureSheet'), S);
['tiSchema_', 'tiRows_', 'tiRowOf_', 'tiMintId_', 'tiNow_', 'tiLocked_'].forEach(n => vm.runInContext(extractFn(read('TripIdeas.js'), n), S));
['fmtMoney_', 'isIncomeBillRow_'].forEach(n => vm.runInContext(extractFn(FIN, n), S));
vm.runInContext(BG, S); vm.runInContext(BS, S);
['webGetBills_', 'webToggleBill_', 'webGetCashflow_', 'projectDays_', 'getTransactionMatchMap_', 'buildTxMatchMap_', 'webGetCalendarBills_', 'webToggleCalBill_', 'parseAmountFromText_', 'inferBillCategory_']
  .forEach(n => vm.runInContext(extractFn(WEB, n), S));
vm.runInContext('var SKIP_CATEGORIES_DEFAULT_ = [];', S);
vm.runInContext(extractFn(REM, 'checkBillsDue_'), S);
const run = (expr, vars) => { Object.assign(S, vars || {}); try { return vm.runInContext(expr, S); } catch (e) { return { ok: false, threw: e.message, bills: [] }; } };
const block = code => { try { vm.runInContext(code, S); return true; } catch (e) { console.log('  (threw: ' + e.message + ')'); return false; } };
const sched = n => VERA['Bill Schedule'].find(r => r[0] === n) || [];

console.log('\nthe rows every reader takes');
let rows = run('bsBillRows_(M)', { M: MONTH });
const row = n => (Array.isArray(rows) ? rows : []).find(r => r[0] === n) || [];
check('the tracker’s bills, in the old layout, amounts from the tracker', row('Rent') && row('Rent')[1] === 2000 && row('Rent')[5] === 'Joint' && row('Rent')[8] === 'Expense' && row('Family Plan Payment')[1] === 150, J(row('Rent')));
check('paid this month from Bill Schedule; last time’s month isn’t this month', row('Rent')[6] === MONTH && row('Internet')[6] === '' && row('Family Plan Payment')[6] === '');
check('card payments with no amount', J(row('Gold Card')) === J(['Gold Card', '', DAY, 'Monthly', 'Credit Card', 'Pat checking', '', '', 'Expense', '']));
check('the old sheet’s Income rows, as they are', J(row('Sam paycheck')) === J(OLD[2]));
check('the old sheet’s own bills are not read (the tracker has them)', !rows.some(r => r[7] === 'an old amount'));

console.log('\nthe bills route and paid');
let r = run('webGetBills_()');
check('bills: from the tracker, marked so', r.ok && r.source === 'tracker' && r.bills.find(b => b.bill === 'Rent').amount === 2000 && r.bills.find(b => b.bill === 'Rent').paid === true && r.bills.find(b => b.bill === 'Sam paycheck').type === 'Income', J(r.bills.slice(0, 2)));
r = run('webToggleBill_({ parameter: { line: "Internet" } })');
check('toggling by name marks it paid in Bill Schedule', r.ok && r.paid === true && sched('Internet')[7] === MONTH);
check('…and back', run('webToggleBill_({ parameter: { line: "Internet" } })').paid === false && sched('Internet')[7] === '');
check('a bill with no Bill Schedule row gets one', run('webToggleBill_({ parameter: { line: "Utilities - Electric" } })').paid === true && sched('Utilities - Electric')[7] === MONTH && sched('Utilities - Electric')[5] === 'bill');
run('webToggleBill_({ parameter: { line: "Utilities - Electric" } })');

console.log('\nthe bill nudge and the morning email');
const sent = [];
Object.assign(S, { getSuppressedKeyPatterns_: () => [], wasRecentlySent_: () => false, isNotifEnabled_: () => true, sendNudge_: (k, t, b) => sent.push(t + ' ' + b) });
run('checkBillsDue_(new Date(), 8, {})');
check('the nudge: tracker amounts, unpaid only, never income', sent.some(x => /Internet/.test(x) && /\$60\.00/.test(x)) && !sent.some(x => /Rent|paycheck/i.test(x)), J(sent));
const morning = between(CODE, "  sub_('bills', function() {", "  // ---- Expiring coupons");
Object.assign(S, { focusRows: [], tz: 'UTC', today: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })(), dayOfMon: DAY, ss_: () => S.getSpreadsheet(), sub_: (n, fn) => fn(), escapeHtml_: x => String(x) });
block(morning);
const mo = S.focusRows.join('\n');
check('the morning email: due soon from the tracker', /Internet \(\$60\.00\)/.test(mo) && /DUE TODAY/.test(mo) && !/Rent/.test(mo), mo.replace(/<[^>]*>/g, ''));

console.log('\nClaude, Chat and the weekly snapshot');
const cl = between(CL, '    var tz_b     = Session.getScriptTimeZone();', '  } catch (billErr) {');
Object.assign(S, { billsForPrompt: [], billsSectionStr: '' });
block(cl);
check('Claude’s context: the tracker’s bills', /Rent/.test(S.billsSectionStr) && /\$2,?000/.test(S.billsSectionStr) && /Sam paycheck/.test(S.billsSectionStr) && !/\$1,?500/.test(S.billsSectionStr), S.billsSectionStr.slice(0, 300));
const chat = between(CHAT, '  var bills = [];', '  // Recipes');
S.ss = S.getSpreadsheet();
block(chat + ';this.__bills = bills;');
S.__bills = S.__bills || [];
check('Chat’s context: by name, no sheet rows', S.__bills.length === rows.length && S.__bills.every(b => b.row === null) && S.__bills.find(b => b.bill === 'Rent').paid === true && S.__bills.find(b => b.bill === 'Sam paycheck').isIncome === true);
check('…and Chat shows [bill] and takes names for mark paid and delete', /\(b\.row \? '\[row:' \+ b\.row \+ '\] ' : '\[bill\] '\)/.test(CHAT)
  && /type === 'mark_bill_paid' && typeof bsBillRows_ === 'function'/.test(CHAT) && /bsFindBill_\(bsBillRows_\(mbM\), args\[0\]\)/.test(CHAT) && /bsSetPaid_\(mbName, mbM, null\)/.test(CHAT)
  && /type === 'add_bill' && typeof bsBillRows_ === 'function'/.test(CHAT) && /bsDeleteScheduleBill_\(dbName\)/.test(CHAT));
check('finding a bill by name: exact, then contained', run('bsFindBill_(R, "internet")', { R: rows }) === 'Internet' && run('bsFindBill_(R, "the electric bill")', { R: rows }) === null && run('bsFindBill_(R, "Electric")', { R: rows }) === 'Utilities - Electric');
check('a bill VERA holds can be deleted; a tracker line can’t', (() => { VERA['Bill Schedule'].push(['Gym', 5, 'Pat', false, '', 'bill', 'added in chat', '']);
  const a = run('bsDeleteScheduleBill_("Rent")'), b = run('bsDeleteScheduleBill_("Gym")'); return a.ok === false && /budget tracker/.test(a.error) && b.ok === true && !sched('Gym').length; })());
const mem = between(MEM, '      // Bills not yet paid this month', '    } catch (billErr) {');
const snaps = {}; S.snap = (k, s, v) => { snaps[k] = v; };
block(mem);
check('the weekly snapshot counts unpaid bills this month (income left out)', snaps.bills_unpaid === rows.filter(x => !/income/i.test(x[8]) && x[6] !== MONTH).length && snaps.bills_unpaid > 0, J(snaps));

console.log('\nCashflow and the calendar bills');
r = run('webGetCashflow_({ parameter: { month: M } })', { M: MONTH });
const cfText = J(r);
check('Cashflow projects the tracker’s bills and the old Income rows', /Family Plan Payment/.test(cfText) && /Sam paycheck/.test(cfText) && !/an old amount/.test(cfText), cfText.slice(0, 300));
const ev = (title, day) => ({ getTitle: () => title, getDescription: () => '', isAllDayEvent: () => true, getId: () => title, getStartTime: () => new Date(now.getFullYear(), now.getMonth(), day), isRecurringEvent: () => true });
S.CalendarApp = { getAllCalendars: () => [{ getName: () => 'Bills', getId: () => 'bills@example.test', getEvents: () => [ev('Water bill', 20), ev('Rent', 1)] }] };
r = run('webGetCalendarBills_()');
check('calendar bills: paid from Bill Schedule', r.ok && r.bills.find(b => b.title === 'Rent').paid === true && r.bills.find(b => b.title === 'Water bill').paid === false, J(r.bills));
r = run('webToggleCalBill_({ parameter: { title: "Water bill", date: "2026-11-20" } })');
check('toggling one keeps it in Bill Schedule, as a calendar row', r.ok && r.paid === true && sched('Water bill')[5] === 'calendar' && sched('Water bill')[7] === MONTH);
check('…which isn’t listed as a bill', !run('bsBillRows_(M)', { M: MONTH }).some(x => x[0] === 'Water bill') && run('webGetCalendarBills_()').bills.find(b => b.title === 'Water bill').paid === true);

console.log('\nwhen the tracker can’t be read');
delete PROPS.SAT_SHEET_ID;
check('no rows from the new source', run('bsBillRows_(M)', { M: MONTH }) === null);
r = run('webGetBills_()');
check('the bills route falls back to the old sheet', r.ok && !r.source && r.bills.find(b => b.bill === 'Rent').amount === 1500 && r.bills[0].row === 2, J(r.bills[0]));
sent.length = 0; run('checkBillsDue_(new Date(), 8, {})');
check('the nudge falls back too', Array.isArray(sent));
PROPS.SAT_SHEET_ID = 'sat-test';
check('neither the tracker nor the old Bills sheet was written', !writes.some(w => /^tracker:|Bills$/.test(w)) && J(OLD) === BILLS_BEFORE, J(writes));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);


// Settings.js (veraSetting_, veraOnceGet_ …) into a test context: from VERA_ROOT when a
// control copied it there, else from the repo.
function loadSettings_(c) {
  const fs_ = require('fs'), p_ = require('path');
  const repo = p_.join(__dirname, '..', '..'), at = p_.join(process.env.VERA_ROOT || repo, 'Settings.js');
  require('vm').runInContext(fs_.readFileSync(fs_.existsSync(at) ? at : p_.join(repo, 'Settings.js'), 'utf8'), c);
  return c;
}
