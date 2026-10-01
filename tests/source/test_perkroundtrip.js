// Tick a perk, refresh, and see it still ticked.
//
// Asked for directly: "check by checking a perk that it has been used for the
// month or quarter, then this is maintained after a refresh."
//
// This drives the REAL round trip — the real writers put a value in a fake sheet,
// the real reader (webGetCards_, what a refresh calls) reads that same sheet back,
// and the real dashboard predicate (isPerkUsed, lifted out of all three dashboard
// copies) decides whether the box is ticked. Nothing about the used-state is
// asserted from a stub; the only fakes are the Sheets and Calendar surfaces.
//
// It also runs the clock forward over the period boundary, which is the other half
// of the question: a Q3 tick must survive every refresh until Oct 1, and must clear
// itself on Oct 1.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = {
  Code:  fs.readFileSync(ROOT + '/Code.js', 'utf8'),
  Web:   fs.readFileSync(ROOT + '/WebApp.js', 'utf8'),
  App:   fs.readFileSync(ROOT + '/docs/app.js', 'utf8'),
  Index: fs.readFileSync(ROOT + '/docs/index.html', 'utf8'),
  Lite:  fs.readFileSync(ROOT + '/docs/dashboard-lite.html', 'utf8'),
};

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

// isPerkUsed and the period constants it closes over, taken verbatim out of a
// dashboard file. app.js and index.html are minified onto one line, so this slices
// by index rather than by line.
function extractUsedCheck(src, label) {
  // Anchor on the function, then walk BACK to its own preamble. Searching forward
  // from the first `const now = new Date()` lands in the coupon-expiry helper,
  // hundreds of lines earlier, and drags a bare `return` into the slice.
  const fnAt = src.indexOf('function isPerkUsed(');
  if (fnAt === -1) throw new Error('isPerkUsed not found in ' + label);
  const start = src.lastIndexOf('const now', fnAt);
  if (start === -1) throw new Error('period preamble not found in ' + label);
  const m = { index: start };
  const preamble = src.slice(start, fnAt);
  if (!/curQuarter/.test(preamble) || !/curHalf/.test(preamble)) {
    throw new Error('the slice before isPerkUsed is not the period preamble in ' + label);
  }
  let depth = 0, end = -1;
  for (let j = src.indexOf('{', fnAt); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  if (end === -1) throw new Error('unbalanced isPerkUsed in ' + label);
  return src.slice(m.index, end);
}

const HDR = ['ID', 'Card Name', 'Perk', 'Amount', 'Frequency', 'Category', 'Last Used', 'Needs Review', 'Autopay'];
const CARD_HDR = ['ID', 'Card Name', 'Issuer', 'Last4', 'Annual Fee', 'Due Day', 'Last Used', 'Owner',
                  'Auth User', 'Active', 'Statement Credit', 'Notes', 'Credit Limit'];

function fixture() {
  return [
    HDR.slice(),
    ['CP-1', 'Amex Platinum', 'Uber Cash',         15,  'Monthly',    'Transport', '', '', ''],
    ['CP-2', 'Amex Platinum', 'Lululemon credit',  75,  'Quarterly',  'Shopping',  '', '', ''],
    ['CP-3', 'Amex Platinum', 'Saks credit',       50,  'Semiannual', 'Shopping',  '', '', ''],
    ['CP-4', 'Amex Platinum', 'Airline fee credit',200, 'Annual',     'Travel',    '', '', ''],
    ['CP-5', 'Amex Platinum', 'Centurion Lounge',  '',  'Standing',   'Travel',    '', '', ''],
  ];
}

function makeSheet(rows) {
  const sheet = {
    _rows: rows,
    _writes: [],
    getDataRange:  () => ({ getValues: () => rows.map(r => r.slice()) }),
    getLastRow:    () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: (r, c, nR, nC) => ({
      getValue:  () => rows[r - 1][c - 1],
      setValue:  v => { sheet._writes.push({ r, c, v }); rows[r - 1][c - 1] = v; },
      getValues: () => {
        const out = [];
        for (let i = 0; i < (nR || 1); i++) out.push(rows[r - 1 + i].slice(c - 1, c - 1 + (nC || 1)));
        return out;
      },
    }),
  };
  return sheet;
}

// One spreadsheet behind the writer and the reader. If they disagreed about which
// column holds Last Used, this is where it would show.
function serverCtx(now, perkRows) {
  const perkSheet = makeSheet(perkRows);
  const cardSheet = makeSheet([CARD_HDR.slice(),
    ['CC-1', 'Amex Platinum', 'Amex', '1001', 695, 5, '', 'Ahmed', '', 'Yes', '', '', 10000]]);
  const flagSheet = makeSheet([['ID','Date','Source','Flag','Reason','Urgency','Acknowledged','Snoozed Until','Resolved','Key','Escalated']]);
  const byName = { 'Card Perks': perkSheet, 'Credit Cards': cardSheet, 'Flags': flagSheet };

  const ctx = {
    String, Number, Object, Array, Math, JSON, isFinite, isNaN, parseInt, Error, RegExp, Boolean, console,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    CONFIG: { SHEET_ID: 'X' },
    TABS: { CARD_PERKS: 'Card Perks', CREDIT_CARDS: 'Credit Cards', FLAGS: 'Flags' },
    FLAG_HEADERS: flagSheet._rows[0].slice(),
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => byName[n] || null }) },
    getPrimarySharedCalendar_: () => null,   // no calendar in this fixture
    Utilities: { formatDate: (d, tz, f) => {
      const p2 = n => String(n).padStart(2, '0');
      const Y = d.getFullYear(), M = d.getMonth() + 1, D = d.getDate();
      if (f === 'yyyy')        return String(Y);
      if (f === 'M')           return String(M);
      if (f === 'yyyy-MM')     return Y + '-' + p2(M);
      if (f === 'yyyy-MM-dd')  return Y + '-' + p2(M) + '-' + p2(D);
      if (f === 'MMM d, yyyy') return 'MMM ' + D + ', ' + Y;
      throw new Error('unstubbed format: ' + f);
    } },
    __perkSheet: perkSheet,
  };
  vm.createContext(ctx);
  vm.runInContext([
    extractFn(SRC.Code, 'perkCycleYears_'),
    extractFn(SRC.Code, 'perkAnchorDate_'),
    extractFn(SRC.Code, 'cardPerkEligibleFrom_'),
    extractFn(SRC.Code, 'cardPerkIsUsed_'),
    extractFn(SRC.Code, 'cardPerkPeriodKey_'),
    extractFn(SRC.Code, 'cardPerkPeriodEnd_'),
    extractFn(SRC.Code, 'perkPeriodKeyEnd_'),
    extractFn(SRC.Code, 'perkCalendarMark_'),
    extractFn(SRC.Code, 'deletePerkReminderEvent_'),
    extractFn(SRC.Web, 'resolveCardPerkRow_'),
    extractFn(SRC.Web, 'resolveCardPerkFlag_'),
    extractFn(SRC.Web, 'resolveCardPerkEligibleFlags_'),
    extractFn(SRC.Web, 'finishCardPerkMarkedUsed_'),
    extractFn(SRC.Web, 'webToggleCardPerk_'),
    extractFn(SRC.Web, 'webMarkCardPerkUsed_'),
    extractFn(SRC.Web, 'webGetCards_'),
    // Freeze the clock, forwarding every argument: cardPerkPeriodEnd_ builds
    // new Date(year, month, 0), and a one-arg stub turns that into 1970.
    'var __Real = Date;',
    'Date = function() {',
    '  if (arguments.length === 0) return new __Real(' + now.getTime() + ');',
    '  if (arguments.length === 1) return new __Real(arguments[0]);',
    '  return new __Real(arguments[0], arguments[1], arguments.length > 2 ? arguments[2] : 1,',
    '                    arguments.length > 3 ? arguments[3] : 0, arguments.length > 4 ? arguments[4] : 0,',
    '                    arguments.length > 5 ? arguments[5] : 0);',
    '};',
    'Date.now = function(){ return ' + now.getTime() + '; };',
    'Date.parse = __Real.parse; Date.UTC = __Real.UTC; Date.prototype = __Real.prototype;',
  ].join('\n'), ctx);
  return ctx;
}

// The browser side: the real isPerkUsed, with the browser's clock frozen too.
function dashboardCtx(src, label, now) {
  const ctx = { String, Math, Object, console };
  const Real = Date;
  function FakeDate(...a) { return a.length ? new Real(...a) : new Real(now.getTime()); }
  FakeDate.prototype = Real.prototype;
  FakeDate.now = () => now.getTime();
  ctx.Date = FakeDate;
  vm.createContext(ctx);
  vm.runInContext(extractUsedCheck(src, label), ctx);
  return ctx;
}

const call   = (ctx, fn, id) => { ctx.__id = id; return vm.runInContext(fn + '({ parameter: { id: __id } })', ctx); };
const perkOf = (ctx, id) => vm.runInContext('webGetCards_()', ctx).perks.find(p => p.id === id);

const SEP29 = new Date(2026, 8, 29);
const OCT1  = new Date(2026, 9, 1);

const CASES = [
  { id: 'CP-1', freq: 'Monthly',    key: '2026-09', name: 'Uber Cash' },
  { id: 'CP-2', freq: 'Quarterly',  key: '2026-Q3', name: 'Lululemon credit' },
  { id: 'CP-3', freq: 'Semiannual', key: '2026-H2', name: 'Saks credit' },
  { id: 'CP-4', freq: 'Annual',     key: '2026',    name: 'Airline fee credit' },
];

console.log('Tick it on the dashboard, then refresh');
{
  CASES.forEach(c => {
    const rows = fixture();
    const srv  = serverCtx(SEP29, rows);
    const dash = dashboardCtx(SRC.App, 'docs/app.js', SEP29);

    const before = perkOf(srv, c.id);
    check(c.freq + ': starts unticked', dash.isPerkUsed(before) === false);

    const res = call(srv, 'webToggleCardPerk_', c.id);
    check(c.freq + ': the toggle reports it used', res.used === true && res.period === c.key,
          JSON.stringify(res));

    // THE assertion. A completely fresh read of the sheet, which is what a browser
    // refresh performs — webGetCards_ is what action=cards returns.
    const after = perkOf(srv, c.id);
    check(c.freq + ': the refresh returns the stored stamp', after.lastUsed === c.key, after.lastUsed);
    check(c.freq + ': …and the dashboard still shows it ticked',
          dash.isPerkUsed(after) === true,
          'stored ' + JSON.stringify(after.lastUsed) + ' for ' + after.frequency);
    check(c.freq + ': …and again on a second refresh',
          dash.isPerkUsed(perkOf(srv, c.id)) === true, 'it must not depend on read order');
    check(c.freq + ': the frequency survives the trip too', after.frequency === c.freq);
  });
}

console.log('\nMarking it used from Chat or the API sticks the same way');
{
  CASES.forEach(c => {
    const srv  = serverCtx(SEP29, fixture());
    const dash = dashboardCtx(SRC.App, 'docs/app.js', SEP29);
    const res  = call(srv, 'webMarkCardPerkUsed_', c.id);
    check(c.freq + ': it reports marked', res.marked === true, JSON.stringify(res.reason));
    check(c.freq + ': the refresh shows it ticked', dash.isPerkUsed(perkOf(srv, c.id)) === true);
    // Saying it twice must not un-mark it — the property the idempotent path exists for.
    call(srv, 'webMarkCardPerkUsed_', c.id);
    check(c.freq + ': …still ticked after a second mark',
          dash.isPerkUsed(perkOf(srv, c.id)) === true);
  });
}

console.log('\nUn-ticking survives a refresh too');
{
  const srv  = serverCtx(SEP29, fixture());
  const dash = dashboardCtx(SRC.App, 'docs/app.js', SEP29);
  call(srv, 'webToggleCardPerk_', 'CP-2');
  check('ticked', dash.isPerkUsed(perkOf(srv, 'CP-2')) === true);
  const off = call(srv, 'webToggleCardPerk_', 'CP-2');
  check('a second click reports it unused', off.used === false);
  check('…the stored stamp is cleared', perkOf(srv, 'CP-2').lastUsed === '');
  check('…and the refresh shows it unticked', dash.isPerkUsed(perkOf(srv, 'CP-2')) === false,
        'a mis-click must be undoable, and stay undone');
}

console.log('\nAll three dashboard copies agree about the stored value');
{
  const COPIES = { 'docs/app.js': SRC.App, 'docs/index.html': SRC.Index, 'docs/dashboard-lite.html': SRC.Lite };
  const srv = serverCtx(SEP29, fixture());
  CASES.forEach(c => call(srv, 'webToggleCardPerk_', c.id));

  Object.keys(COPIES).forEach(label => {
    const dash = dashboardCtx(COPIES[label], label, SEP29);
    const allTicked = CASES.every(c => dash.isPerkUsed(perkOf(srv, c.id)) === true);
    check(label + ': every frequency reads as ticked after the refresh', allTicked,
          CASES.map(c => c.freq + '=' + dash.isPerkUsed(perkOf(srv, c.id))).join(' '));
    check(label + ': a standing perk is never "used"',
          dash.isPerkUsed(perkOf(srv, 'CP-5')) === false);
  });
}

console.log('\nThe tick clears itself when the period rolls over');
{
  const rows = fixture();
  const srv  = serverCtx(SEP29, rows);
  CASES.forEach(c => call(srv, 'webToggleCardPerk_', c.id));

  // Same sheet, same stored values — only the clock moves. Nothing writes here,
  // which is the point: a perk resets because the stored key stops matching.
  const srvOct = serverCtx(OCT1, rows);
  const dashSep = dashboardCtx(SRC.App, 'docs/app.js', SEP29);
  const dashOct = dashboardCtx(SRC.App, 'docs/app.js', OCT1);

  const q = perkOf(srvOct, 'CP-2');
  check('the Q3 stamp is still in the cell on Oct 1', q.lastUsed === '2026-Q3', q.lastUsed);
  check('…it read as ticked on Sep 29', dashSep.isPerkUsed(q) === true);
  check('…and reads as unticked on Oct 1', dashOct.isPerkUsed(q) === false,
        'the quarter key moved to 2026-Q4 — nothing had to clear the cell');
  check('the monthly perk clears on Oct 1 as well',
        dashOct.isPerkUsed(perkOf(srvOct, 'CP-1')) === false);
  check('the semiannual perk does NOT clear — H2 runs to Dec 31',
        dashOct.isPerkUsed(perkOf(srvOct, 'CP-3')) === true);
  check('the annual perk does NOT clear either',
        dashOct.isPerkUsed(perkOf(srvOct, 'CP-4')) === true);
  check('nothing was written to make that happen',
        srvOct.__perkSheet._writes.length === 0,
        'the reset must cost no write — that is why it cannot fail');
}

console.log('\nWhy it survives: the refresh re-reads the sheet, and both sides agree on the column');
{
  const reader = extractFn(SRC.Web, 'webGetCards_');
  check('the cards read is not cached', !/CacheService/.test(reader),
        'a cached payload would make a fresh tick vanish on refresh');
  check('…and it reads the sheet on every call', /getRange\(2, 1, /.test(reader));
  check('the cards route returns it directly',
        /case 'cards':\s*return jsonOut_\(webGetCards_\(\)\)/.test(SRC.Web));

  // The coupling worth pinning: the writer finds Last Used by HEADER, the reader
  // indexes it positionally as r[6]. They agree only while Last Used is column 7.
  const srv = serverCtx(SEP29, fixture());
  const row = vm.runInContext('resolveCardPerkRow_("CP-2")', srv);
  check('the writer targets column 7', row.lastUsedCol === 7, String(row.lastUsedCol));
  check('…which is where the reader looks (r[6])', HDR[6] === 'Last Used',
        'the reader is positional; move this column and a tick stops surviving refresh');
  check('the write lands in that column',
        (call(srv, 'webToggleCardPerk_', 'CP-2'), srv.__perkSheet._writes[0].c === 7),
        JSON.stringify(srv.__perkSheet._writes[0]));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
