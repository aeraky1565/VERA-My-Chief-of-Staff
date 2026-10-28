// FSA & HSA (HealthAccounts.js): reading the FSA claims sheet by header, the household
// FSA balance (sheet or typed, whichever is newer), the use-by date and what would be lost,
// every HSA added into one card against one limit, the Health Accounts tab, the routes and
// the nightly flags. The REAL file runs in a vm with Apps Script stubbed. Every value is
// invented; the claims grid copies the layout of a real FSA export.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC  = fs.readFileSync(path.join(ROOT, 'HealthAccounts.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB  = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
function extract(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('not found: ' + name);
  let j = src.indexOf('{', i), depth = 0;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (!depth) return src.slice(i, j + 1); } }
}
const HEADERS_LINE = CODE.match(/^var HEALTH_ACCOUNT_HEADERS = .*;$/m)[0];
const FLAG_HEADERS_LINE = CODE.match(/^(const|var) FLAG_HEADERS\s*=.*;$/m)[0];

// A fake sheet: rows of values, faithful about ranges.
function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  const sh = {
    _rows: data,
    getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + (nr || 1)).map(row => { const o = []; for (let k = 0; k < (nc || 1); k++) o.push(row[c - 1 + k] === undefined ? '' : row[c - 1 + k]); return o; }),
      setValues: v => v.forEach((row, i) => { while (!data[r - 1 + i]) data.push([]); row.forEach((x, k) => { data[r - 1 + i][c - 1 + k] = x; }); }),
      setValue: v => { while (!data[r - 1]) data.push([]); data[r - 1][c - 1] = v; },
    }),
    appendRow: row => data.push(row.slice()),
    deleteRow: n => data.splice(n - 1, 1),
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
  };
  return sh;
}

const TODAY = '2026-10-28';
function load(opts) {
  opts = opts || {};
  const H = vm.runInNewContext(HEADERS_LINE.replace(/^var /, '') + '; HEALTH_ACCOUNT_HEADERS');
  const tab = makeSheet([H].concat(opts.rows || []));
  const flags = makeSheet([vm.runInNewContext(FLAG_HEADERS_LINE.replace(/^(const|var) /, '') + '; FLAG_HEADERS')]);
  let opened = null;
  const ctx = {
    Date, Math, String, Number, Object, JSON, isNaN, parseInt, parseFloat, Error, RegExp, Array,
    Logger: { log: () => {} },
    TABS: { HEALTH_ACCOUNTS: 'Health Accounts', FLAGS: 'Flags' },
    getConfigValues: () => opts.cfg || {},
    hfToday_: () => TODAY,
    getSpreadsheet: () => ({ getSheetByName: n => n === 'Flags' ? flags : (opts.noTab ? null : tab) }),
    ensureSheet: () => tab,
    SpreadsheetApp: { openById: id => { opened = id; if (opts.denied) throw new Error('You do not have permission'); return { getSheets: () => [makeSheet(opts.claims || [])] }; } },
    Utilities: { getUuid: () => 'abcdef12-3456', formatDate: () => '' },
    colorCodeFlags: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(HEADERS_LINE + '\n' + FLAG_HEADERS_LINE.replace(/^const /, 'var ') + '\n' + extract(CODE, 'upsertKeyedFlags_') + '\n' + SRC, ctx);
  ctx._tab = tab; ctx._flags = flags; ctx._opened = () => opened;
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

// The layout of a real FSA export (Toggle, Date of Service, Account, Merchant/Provider,
// Claim Status, Amount, Recipient), with invented rows.
const CLAIMS = [
  ['Toggle', 'Date of Service', 'Account', 'Merchant/Provider', 'Claim Status', 'Amount', 'Recipient'],
  ['', '09/12/2026', '2026 Health Care FSA', 'NEIGHBORHOOD PHARMACY', 'Paid', '$435.94', 'Ahmed'],
  ['', '08/05/2026', '2026 Health Care FSA', 'TOWN PHYSICAL THERAPY', 'Paid', '$40.00', 'Victoria'],
  ['', '07/29/2026', '2026 Health Care FSA', 'OPTICAL SHOP', 'Pending', '$692.80', 'Victoria'],
  ['', '06/10/2026', '2026 Health Care FSA', 'DENTAL GROUP', 'Denied', '$500.00', 'Ahmed'],
  ['', '05/21/2026', '2026 Health Care FSA', 'CLINIC', 'Needs receipt', '$31.26', 'Ahmed'],
  ['', '12/20/2025', '2025 Health Care FSA', 'LAST YEAR CLINIC', 'Paid', '$99.00', 'Ahmed'],
  ['', '', '', '', '', '', ''],
];

console.log('\nreading the FSA sheet by header');
{
  const c = load();
  const r = run(c, 'haParseClaims_')(CLAIMS, 2026);
  check('claims are read by header, newest first', r.status === 'ok' && r.claims.map(x => x.date).join() === '2026-09-12,2026-08-05,2026-07-29,2026-06-10,2026-05-21', JSON.stringify(r.claims && r.claims.map(x => x.date)));
  check('paid and pending count; denied doesn\'t; an unknown status counts and is listed',
    r.total === 1200 && r.unknownStatuses.join() === 'Needs receipt' && r.claims.find(x => x.provider === 'DENTAL GROUP').counted === false, JSON.stringify([r.total, r.unknownStatuses]));
  check('another year\'s claims in the same sheet are left out', !r.claims.some(x => /LAST YEAR/.test(x.provider)));
  check('each claim keeps who it was for', r.claims[0].recipient === 'Ahmed' && r.claims[0].amount === 435.94);
  const moved = CLAIMS.map(row => [row[5], row[4], row[1], row[3], row[6], row[0], row[2]]);
  const r2 = run(c, 'haParseClaims_')(moved, 2026);
  check('columns in another order read the same', r2.status === 'ok' && r2.total === 1200, JSON.stringify(r2).slice(0, 120));
  const r3 = run(c, 'haParseClaims_')([['Date', 'Who', 'Cost'], ['1/2/2026', 'x', '$4']], 2026);
  check('a sheet without Amount and Claim Status says so instead of guessing', r3.status === 'unavailable' && /Amount/.test(r3.reason), JSON.stringify(r3));
  check('an empty sheet says so', run(c, 'haParseClaims_')([], 2026).status === 'unavailable');
  check('money reads $, commas, brackets and numbers', JSON.stringify(['$1,234.50', '(40.00)', 40, 'x'].map(v => run(c, 'haMoney_')(v))) === '[1234.5,-40,40,null]');
}

console.log('\nthe household FSA card');
{
  const c = load();
  const lim = run(c, 'haLimits_')(2026, {});
  const claims = run(c, 'haParseClaims_')(CLAIMS, 2026);
  const acct = { id: 'HA-1', type: 'FSA', year: 2026, election: 3400, balance: '', balanceAsOf: '', rule: 'none', useBy: '', carryover: '' };
  const v = run(c, 'haFsaView_')(acct, claims, TODAY, lim);
  check('left to spend is the election less the claims, from the sheet', v.balance === 2200 && v.spent === 1200 && v.source === 'sheet' && v.balanceAsOf === '2026-09-12', JSON.stringify([v.balance, v.source, v.balanceAsOf]));
  check('nothing carries: use by Dec 31, 64 days, all of it would be lost', v.useBy === '2026-12-31' && v.daysLeft === 64 && v.atRisk === 2200 && v.warn === true, JSON.stringify([v.useBy, v.daysLeft, v.atRisk]));
  const typedNewer = run(c, 'haFsaView_')(Object.assign({}, acct, { balance: 1500, balanceAsOf: '2026-10-20' }), claims, TODAY, lim);
  check('a typed balance newer than the newest claim wins', typedNewer.balance === 1500 && typedNewer.source === 'typed');
  const typedOlder = run(c, 'haFsaView_')(Object.assign({}, acct, { balance: 1500, balanceAsOf: '2026-09-01' }), claims, TODAY, lim);
  check('…an older one gives way to the sheet', typedOlder.balance === 2200 && typedOlder.source === 'sheet');
  const noSheet = run(c, 'haFsaView_')(Object.assign({}, acct, { balance: 640, balanceAsOf: '2026-09-02' }), { status: 'unavailable', reason: 'x' }, TODAY, lim);
  check('no readable sheet: the typed balance, marked stale after 45 days', noSheet.balance === 640 && noSheet.source === 'typed' && noSheet.stale === true);
  const none = run(c, 'haFsaView_')(acct, { status: 'unconfigured' }, TODAY, lim);
  check('neither: no balance, and nothing at risk', none.balance === null && none.source === 'none' && none.warn === false);
  const carry = run(c, 'haFsaView_')(Object.assign({}, acct, { rule: 'carry', carryover: '' }), claims, TODAY, lim);
  check('carryover: only what\'s above the carryover is at risk (the year\'s default carryover)', carry.carryover === 680 && carry.atRisk === 1520);
  const grace = run(c, 'haFsaView_')(Object.assign({}, acct, { rule: 'grace', useBy: '2027-03-15' }), claims, TODAY, lim);
  check('grace period: use by its date, not yet in the warning window', grace.useBy === '2027-03-15' && grace.daysLeft === 138 && grace.warn === false);
  const noElection = run(c, 'haFsaView_')(Object.assign({}, acct, { election: '' }), claims, TODAY, lim);
  check('no election typed: the year\'s FSA limit', noElection.election === 3400);
  check('Config overrides a year\'s limits', run(c, 'haLimits_')(2026, { fsa_limit_2026: '3,300', hsa_limit_family_2026: 9000 }).fsa === 3300 && run(c, 'haLimits_')(2026, { hsa_limit_family_2026: 9000 }).hsaFamily === 9000);
  const l27 = run(c, 'haLimits_')(2027, {});
  check('2027: the HSA family limit is $9,000; figures not yet listed carry on from 2026', l27.hsaFamily === 9000 && l27.fsa === 3400 && l27.carry === 680 && l27.hsaSelf === 4400, JSON.stringify(l27));
  check('…2026 stays $8,750, a later year keeps the latest figures, and Config still wins',
    run(c, 'haLimits_')(2026, {}).hsaFamily === 8750 && run(c, 'haLimits_')(2030, {}).hsaFamily === 9000 && run(c, 'haLimits_')(2027, { hsa_limit_self_2027: 4500 }).hsaSelf === 4500);
}

console.log('\nevery HSA in one household card');
{
  const c = load();
  const lim = run(c, 'haLimits_')(2026, {});
  const one = run(c, 'haHsaView_')([{ id: 'H1', year: 2026, coverage: 'self', balance: 2100, contributed: 2000, employer: 750, employerName: 'Verizon', balanceAsOf: '2026-10-20' }], TODAY, lim);
  check('self-only: one limit, your money and your employer\'s against it', one.limit === 4400 && one.you === 2000 && one.employer === 750 && one.room === 1650 && one.employerName === 'Verizon');
  const two = run(c, 'haHsaView_')([{ id: 'H1', year: 2026, coverage: 'family', balance: 2100, contributed: 4000, employer: 750, balanceAsOf: '2026-10-20' }, { id: 'H2', year: 2026, coverage: 'family', balance: 900, contributed: 4500, employer: 0, balanceAsOf: '2026-08-01' }], TODAY, lim);
  check('two HSAs: one balance, one family limit, never per person', two.accounts === 2 && two.balance === 3000 && two.limit === 8750 && two.room === 0 && two.over === 500, JSON.stringify([two.balance, two.room, two.over]));
  check('the oldest balance date decides whether it\'s stale', two.balanceAsOf === '2026-08-01' && two.stale === true);
  check('no HSA, no card', run(c, 'haHsaView_')([], TODAY, lim) === null);
}

console.log('\nthe tab, the routes and the sheet');
{
  const c = load({ cfg: { fsa_sheet_id: 'SHEET-ID' }, claims: CLAIMS });
  const r = run(c, 'webSaveHealthAccount_({ parameter: { type: "FSA", year: "2026", election: "3400", rule: "carry", carryover: "680" } })');
  check('adding writes one full-width row', r.action === 'added' && c._tab._rows.length === 2 && c._tab._rows[1].length === 15 && c._tab._rows[1][1] === 'FSA' && c._tab._rows[1][11] === 'carry', JSON.stringify(c._tab._rows[1]));
  const v = run(c, 'webGetHealthAccounts_()');
  check('the card reads the sheet named in Config, by its id', c._opened() === 'SHEET-ID' && v.sheetLinked === true && v.fsa.length === 1 && v.fsa[0].balance === 2200 && v.fsa[0].claims.count === 5 && v.fsa[0].claims.recent.length === 5);
  run(c, 'webSaveHealthAccount_({ parameter: { id: "' + r.id + '", balance: "1800" } })');
  check('a typed balance is dated today and keeps the other fields', c._tab._rows[1][9] === 1800 && c._tab._rows[1][10] === TODAY && c._tab._rows[1][4] === 3400 && c._tab._rows[1][11] === 'carry');
  check('…and, newer than the newest claim, it is what the card shows', run(c, 'webGetHealthAccounts_()').fsa[0].source === 'typed');
  run(c, 'webSaveHealthAccount_({ parameter: { type: "HSA", year: "2026", coverage: "family", contributed: "3000", employer: "750", employerName: "Verizon", balance: "2500" } })');
  const v2 = run(c, 'webGetHealthAccounts_()');
  check('an HSA shows as the household card', v2.hsa && v2.hsa.limit === 8750 && v2.hsa.room === 5000 && v2.fsa.length === 1);
  run(c, 'webDeleteHealthAccount_({ parameter: { id: "' + r.id + '" } })');
  check('removing deletes its row', run(c, 'webGetHealthAccounts_()').fsa.length === 0 && c._tab._rows.length === 2);
  let threw = ''; try { run(c, 'webDeleteHealthAccount_({ parameter: { id: "nope" } })'); } catch (e) { threw = e.message; }
  check('an unknown id is refused', /not found/.test(threw));
  const d = load({ cfg: { fsa_sheet_id: 'X' }, denied: true, rows: [['HA-9', 'FSA', 2026, '', 3400, '', '', '', '', 640, '2026-10-01', 'none', '', '', '']] });
  const dv = run(d, 'webGetHealthAccounts_()');
  check('a sheet VERA can\'t open: says how to fix it, and uses the typed balance', dv.fsa[0].claims.status === 'unavailable' && /Share it with VERA/.test(dv.fsa[0].claims.reason) && dv.fsa[0].balance === 640 && dv.fsa[0].source === 'typed');
  const u = load({ rows: [['HA-9', 'FSA', 2026, '', 3400, '', '', '', '', '', '', 'none', '', '', '']] });
  check('no sheet linked: the card says so and has no balance', run(u, 'webGetHealthAccounts_()').sheetLinked === false && run(u, 'webGetHealthAccounts_()').fsa[0].source === 'none');
  check('the routes', /case 'health_accounts':\s+return jsonOut_\(webGetHealthAccounts_\(\)\);/.test(WEB) && /case 'health_account_save':\s+return jsonOut_\(webSaveHealthAccount_\(e\)\);/.test(WEB) && /case 'health_account_delete':\s+return jsonOut_\(webDeleteHealthAccount_\(e\)\);/.test(WEB));
  check('the tab is set up with the others', /ensureSheet\(ss, TABS\.HEALTH_ACCOUNTS,\s+HEALTH_ACCOUNT_HEADERS\);/.test(CODE));
  check('the FSA sheet is only ever read', !/\.(setValue|setValues|appendRow|deleteRow|clear)\b/.test(extract(SRC, 'haReadClaims_')));
}

console.log('\nnightly flags');
{
  const c = load({ cfg: { fsa_sheet_id: 'S' }, claims: CLAIMS, rows: [['HA-1', 'FSA', 2026, '', 3400, '', '', '', '', '', '', 'carry', '', 680, '']] });
  run(c, 'haSyncFlags_()');
  const f = c._flags._rows.slice(1);
  check('money that would be lost raises one flag, keyed by the account', f.length === 1 && f[0][9] === 'HSAFSA|HA-1|lose' && f[0][3] === '💊 FSA: $1,520 would be lost' && f[0][5] === 'Medium', JSON.stringify(f[0]));
  check('…saying what\'s left, what carries and by when', f[0][4] === '$2,200 left of $3,400, and only $680 carries into 2027. Spend the rest by 2026-12-31 (64 days). See Finances → FSA & HSA.', f[0][4]);
  c._tab._rows[1][13] = 3000;
  run(c, 'haSyncFlags_()');
  check('once nothing above the carryover is left, it resolves itself', c._flags._rows[1][8] === 'Yes');
  const s = load({ rows: [['HA-2', 'FSA', 2026, '', 3400, '', '', '', '', 640, '2026-09-02', 'grace', '2027-03-15', '', '']] });
  run(s, 'haSyncFlags_()');
  check('a typed balance not updated in 45 days raises a Low reminder', s._flags._rows.length === 2 && s._flags._rows[1][9] === 'HSAFSA|HA-2|stale' && s._flags._rows[1][5] === 'Low');
  check('the nightly step is wired', /nightlyStep_\(ctx, 'haSyncFlags_', haSyncFlags_\);/.test(CODE));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
