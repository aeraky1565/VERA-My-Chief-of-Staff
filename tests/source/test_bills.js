// The morning email said:
//
//   • Verizon Family Phone Bill ($430) — DUE TODAY
//   • Verizon Family Phone Bill ($-310) — DUE TODAY
//
// The -310 row is a deliberate credit against the 430, so the cash-flow projection nets
// to 120. Two defects made it read as a second bill for a negative amount of money.
//
// 1. The amount was built as `' ($' + Number(r[1]) + ')'`, putting the dollar sign in
//    front of a raw number. The same concatenation appeared at four bill surfaces.
// 2. The Bills tab has a Type column — 'Expense' | 'Income' — and exactly ONE consumer
//    honoured it, the cash-flow projection. Every surface that shows a bill to a person
//    or to Claude ignored it, so an Income row (a paycheck, per addBillTypeColumn's own
//    docstring) was announced as a bill due today.
//
// The fixture below is the screenshot's own pair of rows plus a paycheck, and the
// assertions run against all four real readers.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const FIN  = fs.readFileSync(ROOT + '/Finance.js',   'utf8');
const CODE = fs.readFileSync(ROOT + '/Code.js',      'utf8');
const REM  = fs.readFileSync(ROOT + '/Reminders.js', 'utf8');
const CL   = fs.readFileSync(ROOT + '/Claude.js',    'utf8');
const CHAT = fs.readFileSync(ROOT + '/Chat.js',      'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

// ============ the two helpers ==============================================

const H = { String, Number, Math, isFinite };
vm.createContext(H);
vm.runInContext(extractFn(FIN, 'fmtMoney_'), H);
vm.runInContext(extractFn(FIN, 'isIncomeBillRow_'), H);
const money  = v => vm.runInContext('fmtMoney_(' + JSON.stringify(v) + ')', H);
const income = v => vm.runInContext('isIncomeBillRow_(' + JSON.stringify(v) + ')', H);

console.log('fmtMoney_ keeps the sign in front of the dollar');
{
  check('a credit reads as a credit', money(-310) === '-$310.00',
        money(-310) + ' — "$-310" was the screenshot');
  check('a bill keeps its cents', money(49.99) === '$49.99', money(49.99));
  check('…and a round number gets them too', money(430) === '$430.00',
        money(430) + ' — $430 beside $49.99 is the inconsistency');
  check('thousands separate', money(1430) === '$1,430.00', money(1430));
  check('…negative thousands too', money(-1234.5) === '-$1,234.50', money(-1234.5));
  check('zero is still money', money(0) === '$0.00', money(0));

  // Returning '' lets every caller keep its `amount ? ...` shape, which is how a bill
  // with no amount stays a bare name rather than gaining an empty "()".
  check('a blank amount returns empty', money('') === '', JSON.stringify(money('')));
  check('…so does null and undefined', money(null) === '' && money(undefined) === '');
  check('…and so does text', money('abc') === '', JSON.stringify(money('abc')));

  // fmtCurrency_ is NOT this function. It takes Math.abs and rounds to whole dollars,
  // which is right for its own callers and would print a credit as "$310".
  check('fmtCurrency_ is left alone', /Math\.abs/.test(extractFn(FIN, 'fmtCurrency_')),
        'two formatters on purpose — this one is still the abs/0dp one');
}

console.log('\nisIncomeBillRow_ reads the Type column');
{
  check('Income is income', income('Income') === true);
  check('…whatever the case', income('income') === true && income('  INCOME ') === true);
  check('Expense is not', income('Expense') === false);
  check('blank means Expense', income('') === false && income(null) === false,
        'the column was added to existing sheets and left blank — Code.js addBillTypeColumn');
  check('anything unrecognised is treated as a bill', income('Transfer') === false,
        'defaulting an unknown type to "income" would hide a real bill');
}

// ============ the four surfaces ============================================

const DAY = new Date().getDate();
// The screenshot's rows, due today, plus a paycheck and a bill with no amount.
// BILL_HEADERS: Bill | Amount | Due Day | Frequency | Category | Account | Paid | Notes | Type | Budget Entry
const ROWS = [
  ['Verizon Family Phone Bill',  430,   DAY, 'Monthly', '', '', '', '', 'Expense', ''],
  ['Verizon Family Phone Bill', -310,   DAY, 'Monthly', '', '', '', '', 'Expense', ''],
  ['Verizon Internet Bill',      49.99, DAY, 'Monthly', '', '', '', '', '',        ''],
  ['Victoria paycheck',         2000,   DAY, 'Biweekly','', '', '', '', 'Income',  ''],
  ['Trash pickup',              '',     DAY, 'Monthly', '', '', '', '', 'Expense', ''],
];

function sheetOf(rows) {
  return {
    getLastRow: () => rows.length + 1,
    getRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getSheetByName() { return this; },
  };
}

function baseCtx(rows) {
  const sheet = sheetOf(rows);
  const ctx = {
    String, Number, Math, JSON, Date, Object, Array, isFinite, isNaN, parseInt, RegExp, Error, console,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate: (d, tz, pat) => {
      const D = new Date(d), p2 = n => String(n).padStart(2, '0');
      if (pat === 'yyyy-MM')    return D.getFullYear() + '-' + p2(D.getMonth() + 1);
      if (pat === 'yyyy-MM-dd') return D.getFullYear() + '-' + p2(D.getMonth()+1) + '-' + p2(D.getDate());
      throw new Error('unhandled pattern ' + pat);
    } },
    TABS: { BILLS: 'Bills' },
    BILL_HEADERS: ['Bill','Amount','Due Day','Frequency','Category','Account','Paid','Notes','Type','Budget Entry'],
    getSpreadsheet: () => sheet,
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(FIN, 'fmtMoney_'), ctx);
  vm.runInContext(extractFn(FIN, 'isIncomeBillRow_'), ctx);
  return ctx;
}

// ---- 1. the morning email -------------------------------------------------
console.log('\nThe morning email');
{
  // The bills block lives inside buildMorningIntelligence_'s sub_ timer. Lifted by its
  // anchors rather than brace-matched, because it is a closure, not a function — and
  // asserted on the rows it produces, not on its source text.
  const src  = CODE;
  const from = src.indexOf("  sub_('bills', function() {");
  const to   = src.indexOf("  // ---- Expiring coupons", from);
  if (from === -1 || to === -1) throw new Error('the bills block moved');
  const block = src.slice(from, to);

  const ctx = baseCtx(ROWS);
  ctx.focusRows = [];
  ctx.tz        = 'America/New_York';
  ctx.today     = new Date(); ctx.today.setHours(0, 0, 0, 0);
  ctx.dayOfMon  = DAY;
  ctx.ss_       = () => ctx.getSpreadsheet();
  ctx.sub_      = (name, fn) => fn();
  ctx.escapeHtml_ = s => String(s);
  vm.runInContext(block, ctx);
  const out = ctx.focusRows.join('\n');

  check('the credit renders as a credit', /-\$310\.00/.test(out),
        out.replace(/<[^>]*>/g, '') + ' — "$-310" is what shipped');
  check('…and never as $-310', !/\$-310/.test(out), out.replace(/<[^>]*>/g, ''));
  check('the bill it offsets keeps its decimals', /\$430\.00/.test(out));
  check('cents survive', /\$49\.99/.test(out));
  check('the paycheck is NOT a bill due', !/paycheck/i.test(out),
        out.replace(/<[^>]*>/g, '') + ' — an Income row was listed as DUE TODAY');
  check('a bill with no amount still lists, with no empty parens',
        /Trash pickup/.test(out) && !/Trash pickup \(\)/.test(out));
}

// ---- 2. the Slack / email bill nudge --------------------------------------
console.log('\nThe bill nudge');
{
  const ctx = baseCtx(ROWS);
  const sent = [];
  ctx.getSuppressedKeyPatterns_ = () => [];
  ctx.wasRecentlySent_ = () => false;
  ctx.sendNudge_ = (key, title, body) => sent.push({ key, title, body });
  ctx.isNotifEnabled_ = () => true;
  vm.runInContext(extractFn(REM, 'checkBillsDue_'), ctx);
  vm.runInContext('checkBillsDue_(new Date(), 8, {})', ctx);

  const all = JSON.stringify(sent);
  check('it nudges about the bills', /Verizon Internet/.test(all), all.slice(0, 200));
  check('…with the amount formatted', /\$49\.99/.test(all) && !/\$-310/.test(all), all.slice(0, 240));
  check('…and never about the paycheck', !/paycheck/i.test(all),
        all.slice(0, 240) + ' — "Bill reminder: Victoria paycheck ($2000) DUE TODAY"');
}

// ---- 3. Claude's prompt ---------------------------------------------------
console.log('\nClaude’s prompt');
{
  const src  = CL;
  const from = src.indexOf('    if (billsSheet && billsSheet.getLastRow() >= 2) {');
  const to   = src.indexOf('  } catch (billErr) {', from);
  if (from === -1 || to === -1) throw new Error('the bills section moved');

  const ctx = baseCtx(ROWS);
  ctx.billsForPrompt  = [];
  ctx.billsSectionStr = '';
  ctx.billsSheet      = ctx.getSpreadsheet();
  vm.runInContext(src.slice(from, to), ctx);
  const out = ctx.billsSectionStr;

  check('amounts are formatted', /\$430\.00/.test(out) && /\$49\.99/.test(out), out);
  check('…the credit reads as negative', /-\$310\.00/.test(out), out);
  check('income is LABELLED, not hidden', /\[INCOME\]/.test(out),
        out + ' — the day plan is better for knowing money is coming in, and worse for ' +
        'being told a paycheck is a bill to pay');
}

// ---- 4. chat notices ------------------------------------------------------
console.log('\nChat notices');
{
  const ctx = baseCtx(ROWS);
  ctx.context = { bills: ROWS.map(r => ({
    bill: r[0], amount: r[1] === '' ? null : Number(r[1]), dueDay: r[2],
    frequency: r[3], paid: false, isIncome: String(r[8]).toLowerCase() === 'income',
  })) };
  ctx.notices = [];
  ctx.today   = new Date();
  const src  = CHAT;
  const from = src.indexOf('    if (context.bills) {');
  const to   = src.indexOf('  } catch (e) { Logger.log(\'computeProactiveInsights_: bills', from);
  if (from === -1 || to === -1) throw new Error('the chat bills notice moved');
  vm.runInContext(src.slice(from, to), ctx);
  const all = JSON.stringify(ctx.notices);

  check('bills become notices', /Verizon/.test(all), all.slice(0, 200));
  check('…formatted', /\$430\.00/.test(all) && !/\$-310/.test(all), all.slice(0, 240));
  check('…and the paycheck is not one', !/paycheck/i.test(all), all.slice(0, 240));
}

// ---- the row numbers Claude writes back to --------------------------------
//
// Found while fixing the above. The chat context handed Claude `[row:N]` for bills,
// recipes, home items and ideas, computed as `idx + 2` inside a .map that ran AFTER a
// .filter — so idx was the index in the FILTERED array. One blank-name row above any
// entry shifted every row number below it, and ACTION:mark_bill_paid writes to that
// number. Marking the Verizon bill paid would have marked a different bill paid.
console.log('\nRow numbers survive a blank row above them');
{
  const src  = CHAT;
  ['bills = billData', 'recipes = recData', 'homeItems = hiData', 'ideas = ideaData'].forEach(function(anchor) {
    const at = src.indexOf(anchor);
    const window = src.slice(at, at + 260);
    check(anchor.split(' ')[0] + ' is indexed before the filter',
          /rowNum: i \+ 2/.test(window) && !/idx \+ 2/.test(window),
          window.slice(0, 120).replace(/\s+/g, ' '));
  });
  check('…and no filter-then-index pattern is left anywhere',
        src.indexOf('row:       idx + 2') === -1 && src.indexOf('row: idx + 2') === -1,
        'these numbers are written back to by mark_bill_paid and friends');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
