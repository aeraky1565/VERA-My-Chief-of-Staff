// Issue #126 — the Net Worth tab, read live from the work-optional planner's sheet.
//
// That sheet belongs to another system: it feeds that system's tracker and VERA at
// once, and the planner rewrites its Outputs tab on every calculation. So the
// properties that matter are the ones whose failure is SILENT:
//
//   - a read by cell position keeps "working" after a row moves — it just returns a
//     different number. Every read here is by label, and these tests move rows and
//     columns to prove it.
//   - a missing label must make a section UNAVAILABLE, never a guess.
//   - VERA must never write to the planner. The read path is driven through a proxy
//     that records every method touched.
//   - a CD flag must carry name and date only — it travels to the Flags list, the
//     morning email and Chat, further than the tab.
//   - every grouping and filter of the slicer must add up.
//
// All figures below are invented. None come from the real planner.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NW   = read('NetWorth.js');
const TRIP = read('Trips.js');
const CODE = read('Code.js');
const WEB  = read('WebApp.js');
const APP  = read('docs/app.js');
const LITE = read('docs/dashboard-lite.html');

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

const pad = n => String(n).padStart(2, '0');
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDate(d, tz, fmt) {
  if (fmt === 'yyyy-MM-dd') return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  if (fmt === 'MMM d, yyyy') return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  throw new Error('unexpected format ' + fmt);
}

// ---- one sandbox running the WHOLE real NetWorth.js ------------------------
function sandbox(over) {
  const S = Object.assign({
    Utilities: { formatDate },
    Session:   { getScriptTimeZone: () => 'America/New_York' },
    Logger:    { log() {} },
    TABS:      { FLAGS: 'Flags', CONFIG: 'Config' },
    health:    [],
    _configCache_: 'stale',
    console,
    // The fixtures' Date cells are built out here; without this, `v instanceof Date`
    // inside the sandbox is false for every one of them (a different realm's Date),
    // which is a test artefact — in Apps Script a cell's Date is the script's own.
    Date,
  }, over || {});
  S.recordApiHealth_ = (src, ok, detail) => S.health.push({ src, ok, detail });
  S.getSuppressedKeyPatterns_ = S.getSuppressedKeyPatterns_ || (() => []);
  S.colorCodeFlags = () => {};
  vm.createContext(S);
  vm.runInContext(extractFn(TRIP, 'dateCellToIso_'), S);
  vm.runInContext(NW, S);
  // The CD flag writer is the shared exact-key helper now (Code.js), not a copy in NetWorth.js.
  vm.runInContext(extractFn(CODE, 'appendExactKeyFlags_'), S);
  return S;
}

// ---- invented planner grids, shaped like the real tabs --------------------
function grids() {
  return {
    'Balances': [
      ['Bucket key', 'Bucket',              'Ahmed', 'Victoria', 'Joint'],
      ['chk',        'Checking (earns 0%)',  100,     200,        300],
      ['cds',        'CDs',                  1000,    0,          0],
      ['retire',     '401(k) / IRA',         5000,    4000,       0],
      ['roth',       'Roth IRA',             700,     0,          0],
    ],
    'Outputs': [
      ['Our planner: outputs', '', ''],
      ['', '', ''],
      ['Item', 'Value', 'What it means'],
      ['Net worth (projected)', 123456789, 'a DECOY: the label must match exactly'],
      ['Plan status', 'Green', ''],
      ['Net worth', 9999, 'Excludes home equity and 529s'],
      ['Cash and CDs', 1600, ''],
    ],
    'Settings': [
      ['Section', 'Key', 'Value'],
      ['Household', 'asOf', 'Sep 24, 2026'],
      ['Household', 'asOfDate', new Date(2026, 8, 24)],   // Sheets hands this back as a DATE
    ],
    'CDs': [
      ['Name', 'Owner', 'Amount', 'APY %', 'Matures (YYYY-MM-DD)'],
      ['Alpha Bank CD 1',             'Ahmed',    2200, 4.1, new Date(2026, 10, 5)],
      ['Alpha Bank CD 2 (14-month)',  'Ahmed',    1100, 3.7, new Date(2027, 6, 14)],
      ['',                            'Ahmed',    50,   1.0, new Date(2027, 0, 1)],   // no name: skipped
    ],
    'RSUs': [
      ['Pays out (YYYY-MM)', 'Value before tax'],
      [new Date(2028, 2, 1), 400],    // "2028-03" typed in, stored by Sheets as a Date
      ['2027-03',            300],
    ],
    'Plan items': [
      ['Item', 'Month (YYYY-MM)', 'Amount', 'Category', 'Confidence', 'Can defer'],
      ['Getaway',      new Date(2027, 4, 1), 120, 'Trip', 'Maybe',     true],
      ['Weekend away', '2026-11',            600, 'Trip', 'committed', 'FALSE'],
    ],
  };
}
const MAPPING_CFG = {
  'networth_class:chk': 'Cash',        'networth_tax:chk': 'Taxable',
  'networth_class:cds': 'CDs',         'networth_tax:cds': 'Taxable',
  'networth_class:retire': 'Retirement', 'networth_tax:retire': 'Pre-tax',
  'networth_class:roth': 'Retirement', 'networth_tax:roth': 'Tax-free',
};

// A planner spreadsheet whose every method access is RECORDED. Reading it is fine;
// touching anything that isn't a read is the failure.
function recordingPlanner(g, touched) {
  const wrap = (obj, label) => new Proxy(obj, {
    get(t, k) {
      if (typeof k === 'string') touched.push(label + '.' + k);
      return t[k];
    },
  });
  const sheetFor = name => {
    if (!g[name]) return null;
    const range = wrap({ getValues: () => g[name].map(r => r.slice()) }, 'range');
    return wrap({
      getDataRange: () => range,
      getRange: () => wrap({ setValue() {}, setValues() {}, setNote() {}, getValues: () => [] }, 'range'),
      appendRow() {}, clear() {}, insertRowBefore() {}, deleteRow() {},
    }, 'sheet');
  };
  return wrap({ getSheetByName: sheetFor, insertSheet() {} }, 'ss');
}

// ============ label lookups ==================================================

console.log('nwNumber_: a money cell is a number, or it is nothing');
{
  const S = sandbox();
  const n = v => vm.runInContext('nwNumber_(' + JSON.stringify(v) + ')', S);
  check('a number stays a number', n(8554) === 8554);
  check('text currency parses', n('$8,554') === 8554, n('$8,554'));
  check('parentheses are negative', n('(310)') === -310, n('(310)'));
  check('a leading minus, either side of the $', n('-$310') === -310 && n('$-310') === -310, n('-$310') + ' / ' + n('$-310'));
  check('blank is zero', n('') === 0);
  check('a dash mid-text is NOT a minus sign', n('3-5') === null, n('3-5') + ' — "3-5" read as -35 before this was tightened');
  check('a percent is not money', n('12%') === null, n('12%'));
  check('words are not money', n('n/a') === null, n('n/a'));
}

console.log('\nBalances: rows by key, owners by header, never by position');
{
  const S = sandbox();
  S.g = grids(); S.cfg = MAPPING_CFG;
  const b = vm.runInContext('nwParseBalances_(g.Balances, nwMappingFromConfig_(cfg))', S);
  check('parses', b.status === 'ok', JSON.stringify(b).slice(0, 120));
  check('owners come from the header row', JSON.stringify(b.owners) === '["Ahmed","Victoria","Joint"]', JSON.stringify(b.owners));
  check('one row per bucket × owner', b.rows.length === 12, b.rows.length);
  const cell = (rows, key, owner) => (rows.find(r => r.key === key && r.owner === owner) || {}).amount;
  check('a cell lands on the right bucket and owner', cell(b.rows, 'retire', 'Victoria') === 4000);
  check('rows are tagged with the Config mapping',
        b.rows.find(r => r.key === 'roth').cls === 'Retirement' && b.rows.find(r => r.key === 'roth').tax === 'Tax-free');
  check('the sheet’s own bucket label is kept', b.rows.find(r => r.key === 'chk').label === 'Checking (earns 0%)');

  // THE MOVED-ROW TEST. Rows reversed, owner columns rotated, and the label column
  // moved to the far end. That last move matters: with key and label still in front,
  // owner N sits at column 2+N in ANY order, and a positional read passes by luck —
  // the first version of this fixture did exactly that, and its control didn't bite.
  const g = grids().Balances;
  const head = g[0], body = g.slice(1).reverse();
  const perm = [0, 4, 2, 3, 1];   // Bucket key, Joint, Ahmed, Victoria, Bucket
  S.moved = [perm.map(i => head[i])].concat(body.map(r => perm.map(i => r[i])));
  const m = vm.runInContext('nwParseBalances_(moved, nwMappingFromConfig_(cfg))', S);
  const same = m.status === 'ok' && b.rows.every(r => cell(m.rows, r.key, r.owner) === r.amount);
  check('rows reversed, owners rotated, label moved to the end: every cell reads the same', same,
        same ? '' : 'a positional read returns a DIFFERENT number here, silently — ' + JSON.stringify(m).slice(0, 100));

  S.cfg2 = Object.assign({}, MAPPING_CFG); delete S.cfg2['networth_class:roth']; delete S.cfg2['networth_tax:roth'];
  const u = vm.runInContext('nwParseBalances_(g.Balances, nwMappingFromConfig_(cfg2))', S);
  check('an unmapped bucket is tagged Unmapped, not dropped',
        u.rows.filter(r => r.key === 'roth').every(r => r.cls === 'Unmapped' && r.tax === 'Unmapped'));
  check('…and named, so the hint can say which Config row is missing', JSON.stringify(u.unmapped) === '["roth"]', JSON.stringify(u.unmapped));
  check('…and still counted: the total is unchanged',
        u.rows.reduce((s, r) => s + r.amount, 0) === b.rows.reduce((s, r) => s + r.amount, 0));

  S.bad = grids().Balances; S.bad[2][3] = 'see note';
  const bad = vm.runInContext('nwParseBalances_(bad, {})', S);
  check('a balance that isn’t a number makes Balances unavailable — not $0',
        bad.status === 'unavailable' && /Victoria/.test(bad.reason) && /CDs/.test(bad.reason), JSON.stringify(bad));
  S.nokey = grids().Balances; S.nokey[0][0] = 'Key';
  check('no "Bucket key" column → unavailable',
        vm.runInContext('nwParseBalances_(nokey, {})', S).status === 'unavailable');
}

console.log('\nOutputs: the planner’s figure, found by its label');
{
  const S = sandbox();
  S.g = grids();
  const o = vm.runInContext('nwParseOutputs_(g.Outputs)', S);
  check('finds "Net worth"', o.status === 'ok' && o.value === 9999, JSON.stringify(o));
  check('…not the decoy "Net worth (projected)" above it', o.value !== 123456789);
  check('…and carries the planner’s own note', o.note === 'Excludes home equity and 529s', o.note);

  S.moved = [['x', '', '']].concat(grids().Outputs);   // planner rewrote the tab, one row lower
  check('one row lower: same figure', vm.runInContext('nwParseOutputs_(moved)', S).value === 9999);

  S.gone = grids().Outputs.filter(r => r[0] !== 'Net worth');
  const gone = vm.runInContext('nwParseOutputs_(gone)', S);
  check('label gone → unavailable, with the reason', gone.status === 'unavailable' && /Net worth/.test(gone.reason), JSON.stringify(gone));
  check('…and no number at all', gone.value === undefined);

  S.blank = grids().Outputs.map(r => r[0] === 'Net worth' ? ['Net worth', '', ''] : r);
  check('label present, figure blank → unavailable, not $0',
        vm.runInContext('nwParseOutputs_(blank)', S).status === 'unavailable');
}

console.log('\nSettings: asOfDate, when the balances were entered');
{
  const S = sandbox();
  S.g = grids();
  const a = vm.runInContext('nwParseAsOf_(g.Settings)', S);
  check('a Date cell becomes yyyy-MM-dd', a.status === 'ok' && a.iso === '2026-09-24', JSON.stringify(a));
  check('…and not the neighbouring "asOf" text row', a.iso !== 'Sep 24, 2026');
  S.txt = grids().Settings; S.txt[2][2] = '2026-09-24';
  check('a text date works too', vm.runInContext('nwParseAsOf_(txt)', S).iso === '2026-09-24');
  S.none = grids().Settings.slice(0, 2);
  check('missing → unavailable', vm.runInContext('nwParseAsOf_(none)', S).status === 'unavailable');
  S.junk = grids().Settings; S.junk[2][2] = 'soon';
  check('not a date → unavailable', vm.runInContext('nwParseAsOf_(junk)', S).status === 'unavailable');
}

console.log('\nCDs, RSUs, planned spends: columns by header, dates normalised');
{
  const S = sandbox();
  S.g = grids();
  const c = vm.runInContext('nwParseCds_(g.CDs)', S);
  check('CDs parse, nameless rows skipped', c.status === 'ok' && c.items.length === 2, c.items && c.items.length);
  check('headers with format hints still match ("APY %", "Matures (YYYY-MM-DD)")',
        c.items[0].apy === 4.1 && c.items[0].matures === '2026-11-05', JSON.stringify(c.items[0]));
  S.cdNoMat = grids().CDs.map(r => r.slice(0, 4));
  const cm = vm.runInContext('nwParseCds_(cdNoMat)', S);
  check('a missing column names itself', cm.status === 'unavailable' && /matures/.test(cm.reason), JSON.stringify(cm));

  const r = vm.runInContext('nwParseRsus_(g.RSUs)', S);
  check('RSU months: a Date cell and a text cell both become YYYY-MM',
        r.items.map(x => x.month).join(',') === '2027-03,2028-03', r.items.map(x => x.month).join(','));

  const p = vm.runInContext('nwParsePlans_(g["Plan items"])', S);
  check('planned spends in month order', p.items.map(x => x.item).join('|') === 'Weekend away|Getaway', p.items.map(x => x.item).join('|'));
  check('confidence is normalised', p.items[1].confidence === 'maybe', p.items[1].confidence);
  check('can-defer reads TRUE and "FALSE"', p.items[1].canDefer === true && p.items[0].canDefer === false);
}

// ============ the read path: READ-ONLY ====================================

console.log('\nreadPlannerSheet_ never writes to the planner');
{
  const touched = [];
  const S = sandbox({ SpreadsheetApp: { openById: () => recordingPlanner(grids(), touched) } });
  S.cfg = MAPPING_CFG;
  const d = vm.runInContext('readPlannerSheet_("SHEET", nwMappingFromConfig_(cfg))', S);
  check('every section reads', Object.keys(d).every(k => d[k].status === 'ok'),
        Object.keys(d).filter(k => d[k].status !== 'ok').map(k => k + ': ' + d[k].reason).join('; '));
  const allowed = new Set(['ss.getSheetByName', 'sheet.getDataRange', 'range.getValues']);
  const other = [...new Set(touched.filter(t => !allowed.has(t)))];
  check('only getSheetByName, getDataRange and getValues are touched', other.length === 0,
        'also touched: ' + other.join(', '));

  const g = grids(); delete g['RSUs'];
  const S2 = sandbox({ SpreadsheetApp: { openById: () => recordingPlanner(g, []) } });
  const d2 = vm.runInContext('readPlannerSheet_("SHEET", {})', S2);
  check('a missing tab is unavailable, the rest still read',
        d2.rsus.status === 'unavailable' && /RSUs/.test(d2.rsus.reason) && d2.cds.status === 'ok');
}

console.log('\nwebGetNetWorth_');
{
  const S = sandbox({ SpreadsheetApp: { openById: () => recordingPlanner(grids(), []) } });
  S.getConfigValues = () => ({});
  const nc = vm.runInContext('webGetNetWorth_()', S);
  check('no planner_sheet_id → configured:false, nothing opened', nc.ok === true && nc.configured === false, JSON.stringify(nc));

  S.getConfigValues = () => Object.assign({ planner_sheet_id: 'SHEET' }, MAPPING_CFG);
  const d = vm.runInContext('webGetNetWorth_()', S);
  check('configured payload', d.ok && d.configured && d.balances.status === 'ok' && d.planner.value === 9999);
  check('stale threshold is 60 days', d.staleAfterDays === 60);
  check('each CD carries the cds bucket’s class and tax, for the filter',
        d.cds.items.every(cd => cd.bucketKey === 'cds' && cd.cls === 'CDs' && cd.tax === 'Taxable'),
        JSON.stringify(d.cds.items[0]));
  check('a clean read records healthy', S.health.length === 1 && S.health[0].ok === true && S.health[0].src === 'sheet:Planner',
        JSON.stringify(S.health));

  const g = grids(); g['Outputs'] = g['Outputs'].filter(r => r[0] !== 'Net worth');
  const S2 = sandbox({ SpreadsheetApp: { openById: () => recordingPlanner(g, []) } });
  S2.getConfigValues = () => ({ planner_sheet_id: 'SHEET' });
  const d2 = vm.runInContext('webGetNetWorth_()', S2);
  check('a missing label still returns the rest of the tab', d2.ok && d2.planner.status === 'unavailable' && d2.balances.status === 'ok');
  check('…and is recorded in API health with the reason', S2.health[0].ok === false && /Net worth/.test(S2.health[0].detail),
        JSON.stringify(S2.health));

  const S3 = sandbox({ SpreadsheetApp: { openById: () => { throw new Error('No item with the given ID'); } } });
  S3.getConfigValues = () => ({ planner_sheet_id: 'WRONG' });
  const d3 = vm.runInContext('webGetNetWorth_()', S3);
  check('an unopenable sheet is an error the tab can show', d3.ok === false && /No item/.test(d3.error), JSON.stringify(d3));
}

// ============ the CD maturity flag ==========================================

console.log('\nCD flags: inside 30 days, name and date only');
{
  const S = sandbox();
  S.cds = [
    { name: 'Alpha Bank CD 1',            owner: 'Ahmed', amount: 22217, apy: 4.1, matures: '2026-11-05' },  // 24 days
    { name: 'Alpha Bank CD 2 (14-month)', owner: 'Ahmed', amount: 11780, apy: 3.7, matures: '2026-11-11' },  // 30 days
    { name: 'Beta CD',                    owner: 'Ahmed', amount: 5165,  apy: 3.9, matures: '2026-11-12' },  // 31 days
    { name: 'Old CD',                     owner: 'Ahmed', amount: 100,   apy: 1.0, matures: '2026-10-01' },  // matured
  ];
  const due = vm.runInContext('nwCdFlagsDue_(cds, "2026-10-12")', S);
  check('24 and 30 days flag; 31 days and already-matured do not',
        due.map(f => f.flag.split(' matures')[0]).join('|') === 'Alpha Bank CD 1|Alpha Bank CD 2 (14-month)',
        due.map(f => f.flag).join(' | '));
  check('the flag names the CD and the date', due[0].flag === 'Alpha Bank CD 1 matures Nov 5, 2026: decide whether to roll it over.', due[0].flag);

  // NAME AND DATE ONLY. Checked against both visible fields, in every format the
  // amount or APY could plausibly be written.
  const leaks = [];
  due.forEach((f, i) => {
    const cd = S.cds[i];
    const text = f.flag + ' ' + f.reason;
    [String(cd.amount), cd.amount.toLocaleString('en-US'), '$', String(cd.apy), '%'].forEach(t => {
      if (text.indexOf(t) !== -1) leaks.push(cd.name + ' leaks "' + t + '"');
    });
  });
  check('no amount, no APY, no $ and no % anywhere in flag or reason', leaks.length === 0, leaks.join('; '));
  check('urgency Medium', due.every(f => f.urgency === 'Medium'));
  check('distinct keys for two CDs from the same bank', due[0].key !== due[1].key, due[0].key);

  // WHY THIS DOESN'T GO THROUGH writeFlags(). Its fuzzy check, real and extracted from
  // Code.js, calls these two keys the same flag — the second CD would never be raised.
  const C = { String, Math };
  vm.createContext(C);
  vm.runInContext(extractFn(CODE, 'keysAreSimilar_'), C);
  C.fp = new Set(['key:' + due[0].key]);
  check('writeFlags’ fuzzy check WOULD have swallowed the second CD (the reason for the exact-key writer)',
        vm.runInContext('keysAreSimilar_(' + JSON.stringify(due[1].key) + ', fp)', C) === true);
}

console.log('\nCD flags: raised once, exact keys');
{
  const S = sandbox();
  const rows = [];
  S.flagSheet = {
    getLastRow: () => rows.length + 1,
    getRange: (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 2, r - 2 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }),
    appendRow: row => rows.push(row),
  };
  S.cds = [
    { name: 'Alpha Bank CD 1',            amount: 1, apy: 1, matures: '2026-11-05' },
    { name: 'Alpha Bank CD 2 (14-month)', amount: 1, apy: 1, matures: '2026-11-11' },
  ];
  S.due = vm.runInContext('nwCdFlagsDue_(cds, "2026-10-12")', S);
  const n1 = vm.runInContext('nwWriteCdFlags_(flagSheet, due, "2026-10-12")', S);
  check('both same-bank CDs are raised', n1 === 2 && rows.length === 2, n1);
  check('in the Flags row shape: source, text, urgency, key, open',
        rows[0][2] === 'Finance' && rows[0][5] === 'Medium' && rows[0][6] === 'No' && rows[0][8] === 'No' && rows[0][9] === S.due[0].key,
        JSON.stringify(rows[0]));
  const n2 = vm.runInContext('nwWriteCdFlags_(flagSheet, due, "2026-10-13")', S);
  check('the next night raises nothing new', n2 === 0 && rows.length === 2, n2);
  rows[0][8] = 'Yes';   // you resolved it: decided to roll over
  const n3 = vm.runInContext('nwWriteCdFlags_(flagSheet, due, "2026-10-14")', S);
  check('a resolved flag does not come back', n3 === 0 && rows.length === 2, n3);

  S.rolled = [{ name: 'Alpha Bank CD 1', amount: 1, apy: 1, matures: '2027-11-05' }];
  S.due2 = vm.runInContext('nwCdFlagsDue_(rolled, "2027-10-12")', S);
  const n4 = vm.runInContext('nwWriteCdFlags_(flagSheet, due2, "2027-10-12")', S);
  check('the same CD rolled over to a new date flags again', n4 === 1 && rows.length === 3, n4);
}

// ============ the mapping seed ==============================================

console.log('\nseedNetWorthMappingConfig_: once, and never over your edits');
{
  const props = {};
  const cfgRows = [['planner_sheet_id', 'SHEET'], ['networth_class:roth', 'Long term']];   // a hand edit
  const S = sandbox({
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  });
  S.getSpreadsheet = () => ({ getSheetByName: () => ({
    getLastRow: () => cfgRows.length + 1,
    getRange: (r, c, nr, nc) => ({ getValues: () => cfgRows.slice(r - 2, r - 2 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }),
    appendRow: row => cfgRows.push(row),
  }) });
  const added = vm.runInContext('seedNetWorthMappingConfig_()', S);
  check('adds the 15 rows that weren’t there', added === 15, added);
  check('your hand-edited row is not overwritten',
        cfgRows.filter(r => r[0] === 'networth_class:roth').length === 1 &&
        cfgRows.find(r => r[0] === 'networth_class:roth')[1] === 'Long term');
  check('the approved values went in', cfgRows.find(r => r[0] === 'networth_class:cds')[1] === 'CDs' &&
                                         cfgRows.find(r => r[0] === 'networth_tax:retire')[1] === 'Pre-tax' &&
                                         cfgRows.find(r => r[0] === 'networth_tax:crypto')[1] === 'Taxable');
  check('the Config cache is dropped so the new rows are read', S._configCache_ === null);

  const before = cfgRows.length;
  cfgRows.splice(cfgRows.findIndex(r => r[0] === 'networth_tax:crypto'), 1);   // you delete a row
  const again = vm.runInContext('seedNetWorthMappingConfig_()', S);
  check('running again adds nothing — a row you deleted stays deleted', again === 0 && cfgRows.length === before - 1, again);
}

// ============ the dashboard’s slicer (the real shared block) ============

const START = '// ---- NetWorthTab (issue #126)';
const END   = '// ---- /NetWorthTab ----';
function block(src) {
  const a = src.indexOf(START), b = src.indexOf(END);
  return a === -1 || b === -1 ? '' : src.slice(a, b + END.length);
}

console.log('\nboth dashboards carry the same NetWorthTab, byte for byte');
{
  const a = block(APP), l = block(LITE);
  check('present in docs/app.js', a.length > 1000);
  check('present in docs/dashboard-lite.html', l.length > 1000);
  check('identical', a === l, a === l ? '' : 'the two copies have drifted — paste the whole block across');
  check('registered as a Finances sub-tab in the full dashboard',
        /\{id:'networth',label:'📈 Net Worth'/.test(APP) && /sub==='networth'&&\/\*#__PURE__\*\/React\.createElement\(NetWorthTab,/.test(APP));
  check('registered in dashboard-lite',
        /\{ id: 'fin_networth', label: '📈 Net Worth' \}/.test(LITE) && /activeFinanceTab === 'fin_networth' && <NetWorthTab /.test(LITE));
}

console.log('\nthe slicer adds up, every way round');
{
  const C = { Math, isFinite, String, Number, Object, Array, Date, console };
  vm.createContext(C);
  vm.runInContext(block(APP), C);
  const S = sandbox();
  S.g = grids(); S.cfg = MAPPING_CFG;
  const bal = vm.runInContext('nwParseBalances_(g.Balances, nwMappingFromConfig_(cfg))', S);
  C.rows = JSON.parse(JSON.stringify(bal.rows)); C.owners = bal.owners;
  const all = C.rows.reduce((s, r) => s + r.amount, 0);

  const dims = ['owner', 'bucket', 'cls', 'tax'];
  const filters = [null];
  dims.forEach(d => vm.runInContext('nwValues_(rows, ' + JSON.stringify(d) + ', owners)', C)
    .forEach(v => filters.push({ dim: d, value: v.value })));
  let combos = 0, bad = [];
  dims.forEach(gb => filters.forEach(f => {
    C.f = f;
    const sub = vm.runInContext('rows.filter(function(r){return nwMatches_(r,f);})', C);
    const want = sub.reduce((s, r) => s + r.amount, 0);
    C.sub = sub;
    const g = vm.runInContext('nwGroup_(sub, ' + JSON.stringify(gb) + ', owners)', C);
    const shown = g.groups.reduce((s, x) => s + x.amount, 0);
    combos++;
    if (g.total !== want || shown !== want) bad.push(gb + ' / ' + (f ? f.dim + '=' + f.value : 'all') + ': ' + shown + ' vs ' + want);
  }));
  check('every Group by × Filter combination: groups sum to the filtered total (' + combos + ' combinations)',
        bad.length === 0, bad.slice(0, 3).join('; '));
  C.f = null;
  check('with no filter that total is the whole Balances sum',
        vm.runInContext('nwGroup_(rows, "owner", owners)', C).total === all);

  C.f = { dim: 'owner', value: 'Victoria' };
  const vic = vm.runInContext('nwGroup_(rows.filter(function(r){return nwMatches_(r,f);}), "owner", owners)', C);
  check('Joint is its own owner: "Victoria" is Victoria’s column only',
        vic.groups.length === 1 && vic.total === 4200, JSON.stringify(vic));
  const byOwner = vm.runInContext('nwGroup_(rows, "owner", owners)', C);
  check('owners add up to the household with nothing counted twice',
        byOwner.groups.reduce((s, x) => s + x.amount, 0) === all && byOwner.groups.length === 3);

  check('groups worth $0 are left out',
        !vm.runInContext('nwGroup_(rows, "bucket", owners)', C).groups.some(x => x.amount === 0) &&
        !vm.runInContext('nwGroup_(rows.filter(function(r){return r.owner==="Joint";}), "bucket", owners)', C).groups.some(x => x.value === 'cds'));

  C.rows2 = C.rows.map(r => r.key === 'roth' ? Object.assign({}, r, { cls: 'Unmapped', tax: 'Unmapped' })
                           : r.key === 'chk' ? Object.assign({}, r, { cls: 'Real estate' }) : r);
  const order = vm.runInContext('nwValues_(rows2, "cls", owners).map(function(x){return x.value;})', C);
  check('class order: the usual ones, then your own, then Unmapped last',
        order.join(',') === 'CDs,Retirement,Real estate,Unmapped', order.join(','));
  check('buckets keep the sheet’s order and label',
        vm.runInContext('nwValues_(rows, "bucket", owners).map(function(x){return x.label;})', C).join('|') ===
        'Checking (earns 0%)|CDs|401(k) / IRA|Roth IRA');

  // The CD list follows the filter, on every dimension.
  C.cd = { owner: 'Victoria', bucketKey: 'cds', cls: 'CDs', tax: 'Taxable', amount: 1 };
  const m = f => { C.f = f; return vm.runInContext('nwMatches_(cd, f)', C); };
  check('CD hidden under Asset class = Retirement', m({ dim: 'cls', value: 'Retirement' }) === false);
  check('CD shown under Tax = Taxable', m({ dim: 'tax', value: 'Taxable' }) === true);
  check('CD shown under Bucket = cds, hidden under another bucket', m({ dim: 'bucket', value: 'cds' }) === true && m({ dim: 'bucket', value: 'roth' }) === false);
  check('CD follows the owner filter', m({ dim: 'owner', value: 'Victoria' }) === true && m({ dim: 'owner', value: 'Ahmed' }) === false);

  check('a share under 1% says "<1%", not 0%', vm.runInContext('nwPct_(1, 1000)', C) === '<1%');
  check('money keeps its sign in front', vm.runInContext('nwMoney_(-310)', C) === '-$310');
  const d = vm.runInContext('nwLocalDate_("2026-09-24")', C);
  check('dates parse as LOCAL days, not UTC midnight', d.getFullYear() === 2026 && d.getMonth() === 8 && d.getDate() === 24,
        String(d));
}

// ============ wiring ========================================================

console.log('\nwiring');
{
  check('net_worth is a doGet action', /case 'net_worth':\s+return jsonOut_\(webGetNetWorth_\(\)\);/.test(WEB));
  check('the CD check runs nightly', /nightlyStep_\(ctx, 'checkPlannerCdMaturity_', checkPlannerCdMaturity_\);/.test(CODE));
  check('the mapping seed runs nightly (a no-op after its first run)',
        /nightlyStep_\(ctx, 'seedNetWorthMappingConfig_', seedNetWorthMappingConfig_\);/.test(CODE));
  // The planner sheet's id belongs in the Config tab, never in the repo — and so not
  // in this test either. Only its SHA-256 is here: every id-shaped token in the
  // shipped files is hashed and compared.
  const ID_SHA = '657aa3f4d64c303934b418e600950994cdabd769778b8d9e72d2f3cb9541f514';
  const crypto = require('crypto');
  const tokens = (NW + CODE + WEB + APP + LITE + read('TestBench.js')).match(/[A-Za-z0-9_-]{40,50}/g) || [];
  check('the planner sheet id is not in the shipped files',
        !tokens.some(t => crypto.createHash('sha256').update(t).digest('hex') === ID_SHA));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
