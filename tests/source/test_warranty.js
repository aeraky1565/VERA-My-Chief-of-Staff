// Runs the REAL checkWarrantiesExpiring_ + upsertKeyedFlags_ against a fake
// sheet. The escalation is the risk: writeFlags' keysAreSimilar_ strips numbers,
// so a tier-suffixed key would silently collapse to one flag. These assert the
// tiers actually move, and that one item keeps one row.

const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC  = fs.readFileSync(ROOT + '/Code.js', 'utf8');

function extractFn(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = SRC.indexOf('{', start); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(start, j + 1); }
  }
  throw new Error('unbalanced');
}
const decl = re => { const m = SRC.match(re); if (!m) throw new Error('not found: ' + re); return m[0]; };

const HOME_HDRS = ['Item','Category','Purchase Date','Warranty Expiry','Last Service','Next Service','Interval (mo)','Notes'];
const FLAG_HDRS = ['ID','Date','Source','Flag','Reason','Urgency','Acknowledged','Snoozed Until','Resolved','Key','Escalated'];

function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  return {
    _rows: data,
    getLastRow: () => data.length,
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
    getRange: (row, c, nr, nc) => ({
      getValues: () => { const o = []; for (let i=0;i<nr;i++){ const rr=[]; for(let j=0;j<nc;j++) rr.push(data[row-1+i]?(data[row-1+i][c-1+j]!==undefined?data[row-1+i][c-1+j]:''):''); o.push(rr);} return o; },
      setValue: v => { data[row-1][c-1] = v; },
    }),
    appendRow: r => data.push(r.slice()),
  };
}

function run(homeRows, flagRows, todayISO) {
  const logs = [];
  const home = makeSheet([HOME_HDRS].concat(homeRows));
  const flags = makeSheet([FLAG_HDRS].concat(flagRows || []));
  const FixedDate = class extends Date {
    constructor(...a) { if (a.length === 0) super(todayISO + 'T09:00:00Z'); else super(...a); }
  };
  const ctx = {
    TABS: { HOME_ITEMS: 'Home Items', FLAGS: 'Flags' },
    HOME_ITEM_HEADERS: HOME_HDRS, FLAG_HEADERS: FLAG_HDRS,
    getSpreadsheet: () => ({ getSheetByName: n => n === 'Home Items' ? home : n === 'Flags' ? flags : null }),
    getConfigValues: () => ({}),
    getSuppressedKeyPatterns_: () => (ctx.__suppressed || []),
    colorCodeFlags: () => {},
    Utilities: { formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? d.toISOString().slice(0,10)
                   : d.toISOString().slice(0,10) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Logger: { log: s => logs.push(s) },
    Date: FixedDate, Object, String, Math, parseInt, isNaN, Array, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(
    decl(/^var WARRANTY_FLAG_PREFIX_ = .*;$/m) + '\n' +
    decl(/^var WARRANTY_FLAG_SOURCE_ = .*;$/m) + '\n' +
    decl(/^var WARRANTY_TIERS_ = [\s\S]*?^\];$/m) + '\n' +
    extractFn('upsertKeyedFlags_') + '\n' + extractFn('checkWarrantiesExpiring_') +
    '\ncheckWarrantiesExpiring_();', ctx);
  return { flags: flags._rows.slice(1), logs, ctx };
}

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const WATCH = d => ['Watch battery', 'Personal', '2025-09-01', d, '', '', '', 'Seiko, receipt in the drawer'];
const flagFor = (rows, item) => rows.filter(r => String(r[3]).indexOf(item) !== -1)[0];

console.log('\nthe three tiers');
{
  // Warranty ends 2027-09-30.
  const cases = [
    ['2027-07-15', 'Medium', /expires in 77 days/, '77 days out — inside 60? no'],
    ['2027-08-15', 'Medium', /expires in 46 days/, '46 days out'],
    ['2027-09-20', 'High',   /expires in 10 days/, '10 days out'],
    ['2027-09-29', 'High',   /expires tomorrow/,   '1 day out'],
  ];
  // 77 days is outside every tier, so that one should produce nothing.
  let r = run([WATCH('2027-09-30')], [], '2027-07-15');
  check('nothing at 77 days out (beyond the 60-day tier)', r.flags.length === 0, JSON.stringify(r.flags));

  r = run([WATCH('2027-09-30')], [], '2027-08-15');
  check('a Medium flag at 46 days', r.flags.length === 1 && r.flags[0][5] === 'Medium', JSON.stringify(r.flags[0]));
  check('…worded with the day count', /expires in 46 days/.test(r.flags[0][3]), r.flags[0][3]);
  check('…naming the item', /Watch battery/.test(r.flags[0][3]), r.flags[0][3]);
  check('…and the real end date in the reason', /Sep 30, 2027|2027-09-30/.test(r.flags[0][4]), r.flags[0][4]);
  check('…carrying the note across', /receipt in the drawer/.test(r.flags[0][4]), r.flags[0][4]);

  r = run([WATCH('2027-09-30')], [], '2027-09-20');
  check('escalates to High at 10 days', r.flags.length === 1 && r.flags[0][5] === 'High', JSON.stringify(r.flags[0]));

  r = run([WATCH('2027-09-30')], [], '2027-09-29');
  check('says "tomorrow" on the last day', /expires tomorrow/.test(r.flags[0][3]), r.flags[0][3]);
}

console.log('\none item keeps ONE row as it escalates');
{
  let { flags } = run([WATCH('2027-09-30')], [], '2027-08-15');
  check('opens one', flags.length === 1, flags.length);
  const key = flags[0][9];
  const id  = flags[0][0];

  // Carry that row forward to a later date — the tier changes.
  const later = run([WATCH('2027-09-30')], [flags[0]], '2027-09-20');
  check('still one row, not a second', later.flags.length === 1, JSON.stringify(later.flags));
  check('the same row is reused', later.flags[0][0] === id, later.flags[0][0] + ' vs ' + id);
  check('its urgency is rewritten Medium → High', later.flags[0][5] === 'High', later.flags[0][5]);
  check('its wording is rewritten', /expires in 10 days/.test(later.flags[0][3]), later.flags[0][3]);
  check('the key is stable and tier-free', later.flags[0][9] === key && !/\d/.test(key), key);
}

console.log('\nre-running the same night changes nothing');
{
  const first = run([WATCH('2027-09-30')], [], '2027-08-15');
  const snap  = JSON.stringify(first.flags);
  const again = run([WATCH('2027-09-30')], first.flags, '2027-08-15');
  check('idempotent', JSON.stringify(again.flags) === snap, JSON.stringify(again.flags));
}

console.log('\nresolving and recurrence');
{
  const opened = run([WATCH('2027-09-30')], [], '2027-08-15').flags;
  const resolved = opened.map(r => { const c = r.slice(); c[8] = 'Yes'; return c; });

  // Same warranty, still approaching → reopen.
  const reopened = run([WATCH('2027-09-30')], resolved, '2027-09-20');
  check('a still-live warranty reopens after being resolved', reopened.flags[0][8] === 'No',
        JSON.stringify(reopened.flags[0]));
  check('…without adding a duplicate row', reopened.flags.length === 1, reopened.flags.length);

  // Warranty extended past the window → the open flag should close itself.
  const extended = run([WATCH('2030-01-01')], opened, '2027-08-15');
  check('extending the warranty auto-resolves the flag', extended.flags[0][8] === 'Yes',
        JSON.stringify(extended.flags[0]));
}

console.log('\nwhat should NOT flag');
{
  check('an item with no warranty date',
        run([['Fridge','Appliance','2020-01-01','','','2027-10-01','6','']], [], '2027-08-15').flags.length === 0);
  check('a warranty that already lapsed (the badge says so; nagging does not help)',
        run([WATCH('2026-01-01')], [], '2027-08-15').flags.length === 0);
  check('a blank item name', run([['','X','','2027-09-30','','','','']], [], '2027-08-15').flags.length === 0);
  check('an unparseable date', run([[ 'Thing','X','','not a date','','','','']], [], '2027-08-15').flags.length === 0);
  check('service-only rows are untouched by this engine',
        run([['Boiler','Appliance','','','2027-01-01','2027-08-16','12','']], [], '2027-08-15').flags.length === 0);
}

console.log('\nsuppression');
{
  const r = run([WATCH('2027-09-30')], [], '2027-08-15');
  check('sanity: it flags without suppression', r.flags.length === 1);

  // Re-run with the per-item pattern suppressed.
  const src = fs.readFileSync(__filename, 'utf8'); // no-op, keeps shape explicit
  const home = [WATCH('2027-09-30')];
  const logs = [];
  const flagsSheet = makeSheet([FLAG_HDRS]);
  const homeSheet  = makeSheet([HOME_HDRS].concat(home));
  const FixedDate = class extends Date {
    constructor(...a) { if (a.length === 0) super('2027-08-15T09:00:00Z'); else super(...a); }
  };
  const ctx = {
    TABS: { HOME_ITEMS: 'Home Items', FLAGS: 'Flags' },
    HOME_ITEM_HEADERS: HOME_HDRS, FLAG_HEADERS: FLAG_HDRS,
    getSpreadsheet: () => ({ getSheetByName: n => n === 'Home Items' ? homeSheet : flagsSheet }),
    getConfigValues: () => ({}),
    getSuppressedKeyPatterns_: () => ['warranty_expiry_watch_battery'],
    colorCodeFlags: () => {},
    Utilities: { formatDate: d => d.toISOString().slice(0,10) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Logger: { log: s => logs.push(s) },
    Date: FixedDate, Object, String, Math, parseInt, isNaN, Array, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(
    decl(/^var WARRANTY_FLAG_PREFIX_ = .*;$/m) + '\n' + decl(/^var WARRANTY_FLAG_SOURCE_ = .*;$/m) + '\n' +
    decl(/^var WARRANTY_TIERS_ = [\s\S]*?^\];$/m) + '\n' +
    extractFn('upsertKeyedFlags_') + '\n' + extractFn('checkWarrantiesExpiring_') +
    '\ncheckWarrantiesExpiring_();', ctx);
  check('a suppressed item does not flag', flagsSheet._rows.length === 1, JSON.stringify(flagsSheet._rows));
}

console.log('\nmultiple items');
{
  const { flags } = run([
    WATCH('2027-09-30'),
    ['Laptop', 'Electronics', '', '2027-08-25', '', '', '', ''],   // 10 days out → High
    ['Fridge', 'Appliance',   '', '2031-01-01', '', '', '', ''],
  ], [], '2027-08-15');
  check('flags each item inside the window', flags.length === 2, flags.length);
  check('…one row per item', new Set(flags.map(r => r[9])).size === 2, flags.map(r => r[9]).join(','));
  check('the one inside 14 days is High, the one inside 60 is Medium',
        flagFor(flags, 'Laptop')[5] === 'High' && flagFor(flags, 'Watch')[5] === 'Medium',
        flags.map(r => r[3] + '=' + r[5]).join(' | '));
  check('the far-future one is left alone', !flags.some(r => /Fridge/.test(r[3])));
  check('all are sourced as Warranties', flags.every(r => r[2] === 'Warranties'), flags.map(r=>r[2]).join(','));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
