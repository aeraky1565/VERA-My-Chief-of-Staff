// Perk-expiry flags close themselves when their period ends.
//
// Card perks are use-it-or-lose-it. The period end was already derived correctly
// (cardPerkPeriodEnd_), but NOTHING acted on it once the date passed:
// resolveCardPerkFlag_ fires only when a perk is marked used, and
// recordExpiredFlags_ records an outcome at 30 days without ever setting Resolved.
// So a credit that died on Dec 31 left a High-urgency "expiring in 3 days" flag
// open on the dashboard forever, and the next period raised another beside it.
//
// The deadline is taken from the FLAG KEY, not the perk row — the row may have
// been deleted, renamed or re-frequencied since, and the flag still has to close.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = {
  Code: fs.readFileSync(ROOT + '/Code.js', 'utf8'),
  Web:  fs.readFileSync(ROOT + '/WebApp.js', 'utf8'),
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

const TZ = 'America/New_York';

// A Flags tab with just the two columns the pass reads, plus a write log so we can
// assert not only WHAT was written but that nothing else was touched.
function makeFlagsSheet(rows) {
  const headers = ['ID', 'Date', 'Source', 'Flag', 'Reason', 'Urgency', 'Acknowledged', 'Snoozed Until', 'Resolved', 'Key', 'Escalated'];
  const grid = rows.map(r => {
    const row = headers.map(() => '');
    row[headers.indexOf('Key')] = r.key;
    row[headers.indexOf('Resolved')] = r.resolved || '';
    row[headers.indexOf('Flag')] = r.flag || 'Perk expiring';
    return row;
  });
  const writes = [];
  const sheet = {
    writes,
    grid,
    getLastRow: () => grid.length + 1,
    getLastColumn: () => headers.length,
    getRange: (r, c, n, w) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < (n || 1); i++) {
          const line = [];
          for (let j = 0; j < (w || 1); j++) line.push(grid[r - 2 + i][c - 1 + j]);
          out.push(line);
        }
        return out;
      },
      setValue: v => { writes.push({ row: r, col: c, value: v }); grid[r - 2][c - 1] = v; },
    }),
  };
  return sheet;
}

// Loads the REAL functions. Loud on failure: a silent catch here once hid a broken
// harness for an afternoon.
function loadCtx(sheet, today, outcomes) {
  const ctx = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, Boolean,
    isFinite, isNaN, parseInt, parseFloat, Error, console,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => TZ },
    Utilities: {
      formatDate: (d, tz, f) => {
        const p2 = n => String(n).padStart(2, '0');
        const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
        if (f === 'yyyy')       return String(y);
        if (f === 'M')          return String(m);
        if (f === 'yyyy-MM')    return y + '-' + p2(m);
        if (f === 'yyyy-MM-dd') return y + '-' + p2(m) + '-' + p2(day);
        throw new Error('unstubbed format: ' + f);
      },
    },
    TABS: { FLAGS: 'Flags' },
    getSpreadsheet: () => ({ getSheetByName: n => (n === 'Flags' ? sheet : null) }),
    recordFlagOutcome_: (key, outcome) => outcomes.push({ key, outcome }),
  };
  // Freeze "now" so a run on Dec 31 does not quietly change the answer.
  if (today) {
    const Real = Date;
    function FakeDate(...a) {
      if (!a.length) return new Real(today.getTime());
      return new Real(...a);
    }
    FakeDate.prototype = Real.prototype;
    FakeDate.now = () => today.getTime();
    ctx.Date = FakeDate;
  }
  vm.createContext(ctx);
  // The real header constant, not a copy — a column rename must break this test.
  const hdr = /^const FLAG_HEADERS\s*=.*$/m.exec(SRC.Code);
  if (!hdr) throw new Error('FLAG_HEADERS not found in Code.js');
  new vm.Script(hdr[0]).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'perkPeriodKeyEnd_')).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'perkCycleYears_')).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'cardPerkPeriodKey_')).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'cardPerkPeriodEnd_')).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'closeExpiredPerkFlags_')).runInContext(ctx);
  return ctx;
}

console.log('The deadline comes out of the period key');
{
  const c = loadCtx(makeFlagsSheet([]), null, []);
  const end = k => c.perkPeriodKeyEnd_(k, TZ);
  const is = (k, y, m, d) => {
    const e = end(k);
    return e instanceof Date && e.getFullYear() === y && e.getMonth() === m - 1 && e.getDate() === d;
  };

  check("'2026' ends Dec 31",        is('2026', 2026, 12, 31), String(end('2026')));
  check("'2026-H1' ends Jun 30",     is('2026-H1', 2026, 6, 30), String(end('2026-H1')));
  check("'2026-H2' ends Dec 31",     is('2026-H2', 2026, 12, 31), String(end('2026-H2')));
  check("'2026-Q1' ends Mar 31",     is('2026-Q1', 2026, 3, 31));
  check("'2026-Q2' ends Jun 30",     is('2026-Q2', 2026, 6, 30));
  check("'2026-Q3' ends Sep 30",     is('2026-Q3', 2026, 9, 30));
  check("'2026-Q4' ends Dec 31",     is('2026-Q4', 2026, 12, 31));
  check("'2026-09' ends Sep 30",     is('2026-09', 2026, 9, 30));
  check("'2026-02' ends Feb 28",     is('2026-02', 2026, 2, 28));
  check("'2024-02' ends Feb 29 in a leap year", is('2024-02', 2024, 2, 29), String(end('2024-02')));

  check("'standing' has no end",     end('standing') === null);
  check('…whatever its case',        end('Standing') === null);
  check('an empty key has no end',   end('') === null && end(null) === null);
  check('a month out of range is refused', end('2026-13') === null, String(end('2026-13')));
  check('a quarter out of range is refused', end('2026-Q5') === null);
  check('a half out of range is refused',    end('2026-H3') === null);
  check('anything else is refused',  end('whenever') === null && end('26-09') === null);

  // The shapes must match what cardPerkPeriodKey_ actually mints, not what I think
  // it mints. Every frequency, round-tripped.
  const D = new Date(2026, 8, 15);
  ['Annual', 'Semiannual', 'Quarterly', 'Monthly', ''].forEach(freq => {
    const key = c.cardPerkPeriodKey_(freq, D, TZ);
    const viaKey = c.perkPeriodKeyEnd_(key, TZ);
    const viaFreq = c.cardPerkPeriodEnd_(freq, D, TZ);
    check("round trip: '" + (freq || '(blank)') + "' -> " + key,
          viaKey && viaFreq && viaKey.getTime() === viaFreq.getTime(),
          String(viaKey) + ' vs ' + String(viaFreq));
  });
  const standingKey = c.cardPerkPeriodKey_('Standing', D, TZ);
  check('round trip: Standing stays open-ended',
        c.perkPeriodKeyEnd_(standingKey, TZ) === null);
}

console.log('\nLapsed flags close; live ones do not');
{
  const outcomes = [];
  const sheet = makeFlagsSheet([
    { key: 'perk_expiry_perk_amex_1_2025' },         // annual, last year — lapsed
    { key: 'perk_expiry_perk_amex_1_2026' },         // annual, this year — live
    { key: 'perk_expiry_p2_2026-08' },               // monthly, August — lapsed
    { key: 'perk_expiry_p2_2026-09' },               // monthly, this month — live
    { key: 'perk_expiry_p3_2026-Q2' },               // quarter just gone — lapsed
    { key: 'perk_expiry_p4_standing' },              // never ends
    { key: 'perk_expiry_p5_whenever' },              // unparseable
    { key: 'contract_expiry_x_2025' },               // not a perk flag at all
    { key: '' },                                     // blank
  ]);
  const c = loadCtx(sheet, new Date(2026, 8, 15), outcomes);   // Sep 15, 2026
  const closed = c.closeExpiredPerkFlags_();

  const resolvedOf = key => {
    const row = sheet.grid.find(r => r[9] === key);
    return row ? row[8] : '(no row)';
  };

  check('it reports how many it closed', closed === 3, String(closed));
  check("last year's annual flag is closed",   resolvedOf('perk_expiry_perk_amex_1_2025') === 'Yes');
  check("this year's annual flag stays open",  resolvedOf('perk_expiry_perk_amex_1_2026') === '');
  check("August's monthly flag is closed",     resolvedOf('perk_expiry_p2_2026-08') === 'Yes');
  check("September's monthly flag stays open", resolvedOf('perk_expiry_p2_2026-09') === '',
        'the period has not ended yet');
  check('the finished quarter is closed',      resolvedOf('perk_expiry_p3_2026-Q2') === 'Yes');
  check('a standing flag is never closed',     resolvedOf('perk_expiry_p4_standing') === '');
  check('an unparseable key is left alone',    resolvedOf('perk_expiry_p5_whenever') === '',
        'closing on a guess is worse than leaving it');
  check('a non-perk flag is not touched',      resolvedOf('contract_expiry_x_2025') === '');

  check("it writes 'Yes', not TRUE",
        sheet.writes.every(w => w.value === 'Yes'),
        JSON.stringify(sheet.writes.map(w => w.value)));
  check('…into the Resolved column and nowhere else',
        sheet.writes.every(w => w.col === 9), JSON.stringify(sheet.writes));
  check('…exactly once per closed flag', sheet.writes.length === 3, String(sheet.writes.length));

  check("the outcome recorded is 'expired', not 'resolved'",
        outcomes.length === 3 && outcomes.every(o => o.outcome === 'expired'),
        JSON.stringify(outcomes));
  check('…keyed by the flag key', outcomes.some(o => o.key === 'perk_expiry_perk_amex_1_2025'));
  check('…and nothing is recorded for the live ones',
        !outcomes.some(o => /2026-09|_2026$|standing|whenever/.test(o.key)),
        JSON.stringify(outcomes.map(o => o.key)));
}

console.log('\nA perk id containing underscores still resolves');
{
  const outcomes = [];
  const sheet = makeFlagsSheet([{ key: 'perk_expiry_amex_plat_uber_credit_2026-07' }]);
  const c = loadCtx(sheet, new Date(2026, 8, 15), outcomes);
  c.closeExpiredPerkFlags_();
  check('the period is taken from the TAIL, not from a split',
        sheet.grid[0][8] === 'Yes', 'ids have underscores; splitting on _ would lose the period');
}

console.log('\nThe boundary day itself is not past');
{
  [['2026-09', new Date(2026, 8, 30), 'Sep 30'],
   ['2026-H1', new Date(2026, 5, 30), 'Jun 30'],
   ['2026',    new Date(2026, 11, 31), 'Dec 31'],
   ['2026-Q3', new Date(2026, 8, 30), 'Sep 30']].forEach(([key, day, label]) => {
    const sheet = makeFlagsSheet([{ key: 'perk_expiry_p_' + key }]);
    const c = loadCtx(sheet, day, []);
    c.closeExpiredPerkFlags_();
    check(key + ' is still open ON ' + label, sheet.grid[0][8] === '',
          'the perk is usable all day; closing it here kills the reminder a day early');
  });

  [['2026-09', new Date(2026, 9, 1), 'Oct 1'],
   ['2026',    new Date(2027, 0, 1), 'Jan 1']].forEach(([key, day, label]) => {
    const sheet = makeFlagsSheet([{ key: 'perk_expiry_p_' + key }]);
    const c = loadCtx(sheet, day, []);
    c.closeExpiredPerkFlags_();
    check(key + ' closes on ' + label, sheet.grid[0][8] === 'Yes');
  });

  // Late in the day: the pass must compare dates, not timestamps.
  const sheet = makeFlagsSheet([{ key: 'perk_expiry_p_2026-09' }]);
  const c = loadCtx(sheet, new Date(2026, 8, 30, 23, 45), []);
  c.closeExpiredPerkFlags_();
  check('…even at 23:45 on the last day', sheet.grid[0][8] === '',
        'today must be floored to midnight before comparing');
}

console.log('\nAn already-closed flag is not rewritten');
{
  const outcomes = [];
  const sheet = makeFlagsSheet([
    { key: 'perk_expiry_p_2025', resolved: 'Yes' },
    { key: 'perk_expiry_p_2024', resolved: 'yes' },
  ]);
  const c = loadCtx(sheet, new Date(2026, 8, 15), outcomes);
  const closed = c.closeExpiredPerkFlags_();
  check('nothing is written', sheet.writes.length === 0, JSON.stringify(sheet.writes));
  check('nothing is counted', closed === 0, String(closed));
  check('no outcome is double-recorded', outcomes.length === 0, JSON.stringify(outcomes));
}

console.log('\nEmpty and missing sheets are survivable');
{
  const c1 = loadCtx(makeFlagsSheet([]), new Date(2026, 8, 15), []);
  check('an empty Flags tab returns 0', c1.closeExpiredPerkFlags_() === 0);

  const ctx = { String, Number, Object, Array, Date, Math, RegExp, Boolean, parseInt, Error, console,
    Logger: { log: () => {} }, Session: { getScriptTimeZone: () => TZ },
    TABS: { FLAGS: 'Flags' }, getSpreadsheet: () => ({ getSheetByName: () => null }),
    recordFlagOutcome_: () => {} };
  vm.createContext(ctx);
  new vm.Script(/^const FLAG_HEADERS\s*=.*$/m.exec(SRC.Code)[0]).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'perkPeriodKeyEnd_')).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'closeExpiredPerkFlags_')).runInContext(ctx);
  check('a missing Flags tab returns 0', ctx.closeExpiredPerkFlags_() === 0);
}

console.log('\nA failing signal hook does not abort the sweep');
{
  const sheet = makeFlagsSheet([
    { key: 'perk_expiry_a_2025' },
    { key: 'perk_expiry_b_2025' },
  ]);
  const c = loadCtx(sheet, new Date(2026, 8, 15), []);
  c.recordFlagOutcome_ = () => { throw new Error('SignalLearning is down'); };
  let closed = null, threw = null;
  try { closed = c.closeExpiredPerkFlags_(); } catch (e) { threw = e.message; }
  check('the sweep does not propagate the hook failure', threw === null, threw);
  check('both flags still close', closed === 2 && sheet.grid.every(r => r[8] === 'Yes'),
        threw ? 'threw: ' + threw : String(closed));
}

console.log('\nIt is wired into the nightly run, before the checker');
{
  const nightly = extractFn(SRC.Code, 'nightlyRun');
  const iClose = nightly.indexOf("nightlyStep_(ctx, 'closeExpiredPerkFlags_'");
  const iCheck = nightly.indexOf("nightlyStep_(ctx, 'checkCardPerksExpiring_'");
  check('closeExpiredPerkFlags_ is called in nightlyRun', iClose !== -1);
  check('…before checkCardPerksExpiring_', iClose !== -1 && iClose < iCheck,
        'tidy last period before raising this one');
  check('…through the step runner, which catches',
        /nightlyStep_\(ctx, 'closeExpiredPerkFlags_', closeExpiredPerkFlags_\)/.test(nightly),
        'one broken pass must not take the nightly run down — the try/catch each step '
        + 'used to hand-roll now lives in nightlyStep_');
}

console.log('\nThe derivation is still in one place');
{
  const end = extractFn(SRC.Code, 'cardPerkPeriodEnd_');
  check('cardPerkPeriodEnd_ still owns the frequency rules',
        /freq === 'Annual'\)\s+endMonth = 12;/.test(end) &&
        /freq === 'Semiannual'\) endMonth = month <= 6 \? 6 : 12;/.test(end) &&
        /freq === 'Quarterly'\)  endMonth = Math\.ceil\(month \/ 3\) \* 3;/.test(end),
        'a second copy of these rules is the thing to avoid');
  check('…and still returns null for Standing', /if \(freq === 'Standing'\) return null;/.test(end));

  const close = extractFn(SRC.Code, 'closeExpiredPerkFlags_');
  check('the closing pass does not re-derive from a frequency',
        !/Semiannual|Quarterly|'Annual'/.test(close), 'it must read the key, not the row');
  check('…and does not open the Card Perks sheet at all',
        !/CARD_PERK|TABS\.CARD/.test(close),
        'a deleted or re-frequencied perk must still have its flag close');

  const keyEnd = extractFn(SRC.Code, 'perkPeriodKeyEnd_');
  check('perkPeriodKeyEnd_ returns null rather than guessing', /return null;\s*\}$/.test(keyEnd.trim()));
}

console.log('\nThe mark-used path is untouched');
{
  const resolve = extractFn(SRC.Web, 'resolveCardPerkFlag_');
  check("resolveCardPerkFlag_ still writes 'Yes'", /'Yes'/.test(resolve));
  check('…and is still the mark-used path', SRC.Web.indexOf('resolveCardPerkFlag_(') !== -1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
