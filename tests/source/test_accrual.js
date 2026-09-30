// Extracts the REAL computeAccrualCapStatus_ and readPTOConfig_ from PTO.js and
// runs them, rather than re-deriving the date arithmetic in the test.

const fs = require('fs');
const vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

const SRC = fs.readFileSync(ROOT + '/PTO.js', 'utf8');

function extractFn(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('not found: ' + name);
  let j = SRC.indexOf('{', i), depth = 0;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return SRC.slice(i, j) + '\n';
}

const DEFAULT_LINE = SRC.match(/var PTO_DEFAULT_ACCRUAL_DAY_ = \d+;/)[0];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

function ctxFor(configRows) {
  const ctx = {
    console, Date, Math, String, Number, parseInt, parseFloat, isNaN, JSON, Object, Array,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        // Only yyyy-MM-dd is used by the code under test.
        const p = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      },
    },
    TABS: { CONFIG: 'Config' },
    getSpreadsheet: () => ({
      getSheetByName: () => ({ getDataRange: () => ({ getValues: () => configRows }) }),
    }),
    ACCRUAL_CAP_SWITCH_DATE_: '2026-12-31',
  };
  vm.createContext(ctx);
  vm.runInContext(DEFAULT_LINE, ctx);
  vm.runInContext(extractFn('readPTOConfig_'), ctx);
  vm.runInContext(extractFn('computeAccrualCapStatus_'), ctx);
  return ctx;
}

// ---- The constant itself ----------------------------------------------------
console.log('\nPTO_DEFAULT_ACCRUAL_DAY_');
{
  const ctx = ctxFor([['x', 'y']]);
  check('is 16', vm.runInContext('PTO_DEFAULT_ACCRUAL_DAY_', ctx) === 16,
        String(vm.runInContext('PTO_DEFAULT_ACCRUAL_DAY_', ctx)));
}

// ---- readPTOConfig_ ---------------------------------------------------------
console.log('\nreadPTOConfig_');
{
  // No pto_accrual_day row — the case on a sheet that never had one added.
  let ctx = ctxFor([['pto_vacation_days', '20']]);
  check('falls back to 16 when Config has no row',
        vm.runInContext('readPTOConfig_().accrualDay', ctx) === 16,
        String(vm.runInContext('readPTOConfig_().accrualDay', ctx)));

  // A row present must still win — this is the case that would make the code
  // change a no-op on the live sheet.
  ctx = ctxFor([['pto_accrual_day', '15']]);
  check('a Config row still overrides the default',
        vm.runInContext('readPTOConfig_().accrualDay', ctx) === 15,
        String(vm.runInContext('readPTOConfig_().accrualDay', ctx)));

  ctx = ctxFor([['pto_accrual_day', '16']]);
  check('a Config row of 16 reads as 16',
        vm.runInContext('readPTOConfig_().accrualDay', ctx) === 16);
}

// ---- computeAccrualCapStatus_ ----------------------------------------------
// The boundary is the whole point: the code uses `d > accrualDay`, so ON the
// accrual day itself the accrual is still "today", not next month.
console.log('\ncomputeAccrualCapStatus_ — next accrual date');
{
  const ctx = ctxFor([['pto_vacation_days', '20']]);
  const cfg = { vacationDays: 20, rolloverDays: 0, accrualDay: 16, year: 2026 };
  const run = (iso) => vm.runInContext(
    'computeAccrualCapStatus_(' + JSON.stringify(cfg) + ', 0, [], new Date(' +
    JSON.stringify(iso) + '))', ctx).nextAccrualDate;

  check('Mar 10 → Mar 16',        run('2026-03-10T12:00:00') === '2026-03-16', run('2026-03-10T12:00:00'));
  check('Mar 15 → Mar 16 (the day that used to be the accrual)',
        run('2026-03-15T12:00:00') === '2026-03-16', run('2026-03-15T12:00:00'));
  check('Mar 16 → Mar 16 (on the day, it has not passed)',
        run('2026-03-16T12:00:00') === '2026-03-16', run('2026-03-16T12:00:00'));
  check('Mar 17 → Apr 16',        run('2026-03-17T12:00:00') === '2026-04-16', run('2026-03-17T12:00:00'));

  // Jan-Oct only: past October's accrual, the next one is next January.
  check('Oct 17 → next Jan 16',   run('2026-10-17T12:00:00') === '2027-01-16', run('2026-10-17T12:00:00'));
  check('Nov 5  → next Jan 16',   run('2026-11-05T12:00:00') === '2027-01-16', run('2026-11-05T12:00:00'));
  check('Dec 31 → next Jan 16',   run('2026-12-31T12:00:00') === '2027-01-16', run('2026-12-31T12:00:00'));

  // February still has a 16th, so no month-length edge case here.
  check('Feb 20 → Mar 16',        run('2026-02-20T12:00:00') === '2026-03-16', run('2026-02-20T12:00:00'));

  // And the old value is genuinely gone from the computed result.
  const allDates = ['2026-03-10', '2026-05-02', '2026-07-30'].map(d => run(d + 'T12:00:00'));
  check('no computed accrual date lands on a 15th',
        allDates.every(d => !d.endsWith('-15')), allDates.join(', '));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
