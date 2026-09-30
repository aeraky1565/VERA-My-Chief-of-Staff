// Runs the REAL rule engine extracted from ImportantDates.js by brace-matching.
// Expected dates below were derived from the calendar independently of the
// implementation, not read back out of it.

const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC  = fs.readFileSync(ROOT + '/ImportantDates.js', 'utf8');

function extractFn(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = SRC.indexOf('{', start); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function extractVar(name) {
  const re = new RegExp('^var ' + name + ' = [\\s\\S]*?^\\};?$', 'm');
  const m = SRC.match(re);
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}

const logs = [];
const ctx = { Logger: { log: s => logs.push(s) }, Date, Object, String, Math, parseInt, Array };
vm.createContext(ctx);
vm.runInContext(
  ['WEEKDAY_NAMES_', 'MONTH_NAMES_', 'ORDINAL_WORDS_'].map(extractVar).join('\n') + '\n' +
  ['parseDateRule_', 'nthWeekdayOfMonth_', 'easterSunday_', 'occurrenceInYear_',
   'nextOccurrence_', 'ruleRowsFromSheetValues_'].map(extractFn).join('\n'),
  ctx);

const { parseDateRule_, occurrenceInYear_, nextOccurrence_, easterSunday_, nthWeekdayOfMonth_ } = ctx;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}
const iso = d => d ? d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') : String(d);
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── the headline cases ──────────────────────────────────────────────────────
console.log('\nNth / last weekday of a named month');
{
  // Sep 2026 starts on a Tuesday; Sundays are 6, 13, 20, 27.
  const d = occurrenceInYear_('3rd sun of sep', 2026, []);
  check('National Wife Day 2026 = Sun Sep 20', iso(d) === '2026-09-20' && d.getDay() === 0, iso(d));
  check('…and 2027 = Sun Sep 19', iso(occurrenceInYear_('3rd sun of sep', 2027, [])) === '2027-09-19',
        iso(occurrenceInYear_('3rd sun of sep', 2027, [])));

  // May 2026 ends on a Sunday (May 31); the last Monday is the 25th.
  const md = occurrenceInYear_('last mon of may', 2026, []);
  check('Memorial Day 2026 = Mon May 25', iso(md) === '2026-05-25' && md.getDay() === 1, iso(md));

  // Nov 2026 starts on a Sunday; Thursdays are 5, 12, 19, 26.
  const t = occurrenceInYear_('4th thu of nov', 2026, []);
  check('Thanksgiving 2026 = Thu Nov 26', iso(t) === '2026-11-26' && t.getDay() === 4, iso(t));

  check('1st fri of jan 2026 = Fri Jan 2', iso(occurrenceInYear_('1st fri of jan', 2026, [])) === '2026-01-02');
  check('word ordinals work: "third sunday of september"',
        iso(occurrenceInYear_('third sunday of september', 2026, [])) === '2026-09-20',
        iso(occurrenceInYear_('third sunday of september', 2026, [])));
  check('case and spacing are ignored',
        iso(occurrenceInYear_('  3RD   Sun  of  SEP ', 2026, [])) === '2026-09-20',
        iso(occurrenceInYear_('  3RD   Sun  of  SEP ', 2026, [])));
}

// ── the occurrence that does not exist ──────────────────────────────────────
console.log('\na 5th weekday that does not exist must not roll forward');
{
  // Feb 2026: Fridays are 6, 13, 20, 27 — there is no 5th.
  check('5th fri of feb 2026 → null', occurrenceInYear_('5th fri of feb', 2026, []) === null,
        iso(occurrenceInYear_('5th fri of feb', 2026, [])));
  check('specifically NOT rolled into March', !/^2026-03/.test(iso(occurrenceInYear_('5th fri of feb', 2026, []))));
  // Jan 2026: Fridays are 2, 9, 16, 23, 30 — there IS a 5th.
  check('5th fri of jan 2026 = Fri Jan 30', iso(occurrenceInYear_('5th fri of jan', 2026, [])) === '2026-01-30',
        iso(occurrenceInYear_('5th fri of jan', 2026, [])));
  check('nextOccurrence_ skips the month with no 5th Friday',
        nextOccurrence_('5th fri of feb', new Date(2026, 0, 1), []) === null);
}

// ── offsets ─────────────────────────────────────────────────────────────────
console.log('\noffsets from another row');
{
  const rows = [
    { id: 'a', label: 'Thanksgiving', date: '4th thu of nov' },
    { id: 'b', label: 'Friendsgiving', date: 'thanksgiving -6d' },
  ];
  const f = occurrenceInYear_('thanksgiving -6d', 2026, rows);
  check('the Friday before Thanksgiving 2026 = Fri Nov 20',
        iso(f) === '2026-11-20' && f.getDay() === 5, iso(f) + ' ' + (f && DOW[f.getDay()]));
  check('"+ 3 days" long form parses',
        iso(occurrenceInYear_('thanksgiving + 3 days', 2026, rows)) === '2026-11-29',
        iso(occurrenceInYear_('thanksgiving + 3 days', 2026, rows)));
  check('reference match is case-insensitive',
        iso(occurrenceInYear_('THANKSGIVING -6d', 2026, rows)) === '2026-11-20');

  // Easter 2026 is April 5 (independently: Paschal full moon Apr 2, first
  // Sunday after).
  check('easter 2026 = Sun Apr 5', iso(easterSunday_(2026)) === '2026-04-05', iso(easterSunday_(2026)));
  check('easter 2027 = Sun Mar 28', iso(easterSunday_(2027)) === '2027-03-28', iso(easterSunday_(2027)));
  check('easter +50d 2026 = May 25', iso(occurrenceInYear_('easter +50d', 2026, [])) === '2026-05-25',
        iso(occurrenceInYear_('easter +50d', 2026, [])));
  check('an offset can cross a month boundary backwards',
        iso(occurrenceInYear_('easter -10d', 2026, [])) === '2026-03-26',
        iso(occurrenceInYear_('easter -10d', 2026, [])));
}

console.log('\nbad offset references are survivable');
{
  const before = logs.length;
  check('unknown reference → null, no throw', occurrenceInYear_('nosuchthing -1d', 2026, []) === null);
  check('…and it logs why', logs.length > before && /unknown date/.test(logs[logs.length-1]), logs[logs.length-1]);

  const cyclic = [
    { id: 'a', label: 'A', date: 'b -1d' },
    { id: 'b', label: 'B', date: 'a -1d' },
  ];
  let threw = null;
  let res;
  try { res = occurrenceInYear_('a -1d', 2026, cyclic); } catch (e) { threw = e.message; }
  check('a cycle returns null rather than recursing forever', threw === null && res === null,
        threw || iso(res));
  check('…and it logs the cycle', logs.some(l => /circular/.test(l)), logs.slice(-2).join(' | '));
}

// ── fixed dates must be completely unchanged ────────────────────────────────
console.log('\nexisting fixed-date behaviour is preserved');
{
  check('MM-DD resolves in the asked-for year',
        iso(occurrenceInYear_('04-14', 2026, [])) === '2026-04-14');
  check('YYYY-MM-DD resolves to its own day',
        iso(occurrenceInYear_('2026-04-14', 2026, [])) === '2026-04-14');
  check('a Sheets-coerced Date cell resolves by month/day',
        iso(occurrenceInYear_(new Date(1999, 3, 14), 2026, [])) === '2026-04-14',
        iso(occurrenceInYear_(new Date(1999, 3, 14), 2026, [])));
  check('parseDateRule_ says MM-DD is not a rule', parseDateRule_('04-14') === null);
  check('parseDateRule_ says YYYY-MM-DD is not a rule', parseDateRule_('2026-04-14') === null);
  check('parseDateRule_ says a Date object is not a rule', parseDateRule_(new Date()) === null);
  check('genuine nonsense is not a rule', parseDateRule_('sometime in autumn') === null);
  check('blank is not a rule', parseDateRule_('') === null && parseDateRule_(null) === null);

  // MM-DD rolls to next year once passed; YYYY-MM-DD never does.
  check('MM-DD already passed rolls to next year',
        iso(nextOccurrence_('01-05', new Date(2026, 5, 1), [])) === '2027-01-05',
        iso(nextOccurrence_('01-05', new Date(2026, 5, 1), [])));
  check('a past YYYY-MM-DD stays in its own year (one-time)',
        iso(nextOccurrence_('2026-01-05', new Date(2026, 5, 1), [])) === '2026-01-05',
        iso(nextOccurrence_('2026-01-05', new Date(2026, 5, 1), [])));
}

// ── year boundaries ─────────────────────────────────────────────────────────
console.log('\nyear boundaries');
{
  check('on Dec 15 2026, "3rd sun of sep" is next September',
        iso(nextOccurrence_('3rd sun of sep', new Date(2026, 11, 15), [])) === '2027-09-19',
        iso(nextOccurrence_('3rd sun of sep', new Date(2026, 11, 15), [])));
  check('on the day itself, it resolves to today not next year',
        iso(nextOccurrence_('3rd sun of sep', new Date(2026, 8, 20), [])) === '2026-09-20',
        iso(nextOccurrence_('3rd sun of sep', new Date(2026, 8, 20), [])));
  check('the day after, it rolls',
        iso(nextOccurrence_('3rd sun of sep', new Date(2026, 8, 21), [])) === '2027-09-19',
        iso(nextOccurrence_('3rd sun of sep', new Date(2026, 8, 21), [])));

  // Dec 28 2026 is a Monday; "last fri of dec" 2026 = Dec 25, already passed.
  check('a late-December rule rolls into the next year',
        iso(nextOccurrence_('last fri of dec', new Date(2026, 11, 28), [])) === '2027-12-31',
        iso(nextOccurrence_('last fri of dec', new Date(2026, 11, 28), [])));

  const rows = [{ id: 'a', label: 'Thanksgiving', date: '4th thu of nov' }];
  check('an offset rolls with its anchor',
        iso(nextOccurrence_('thanksgiving -6d', new Date(2026, 11, 1), rows)) === '2027-11-19',
        iso(nextOccurrence_('thanksgiving -6d', new Date(2026, 11, 1), rows)));
}

// ── monthly stepping ────────────────────────────────────────────────────────
console.log('\n"of every month" steps month to month');
{
  // Jan 2026 Fridays: 2, 9, 16, 23, 30.  Feb: 6, 13, 20, 27.
  check('1st fri of every month, from Jan 1 → Jan 2',
        iso(nextOccurrence_('1st fri of every month', new Date(2026, 0, 1), [])) === '2026-01-02',
        iso(nextOccurrence_('1st fri of every month', new Date(2026, 0, 1), [])));
  check('…from Jan 5 (past it) → Feb 6',
        iso(nextOccurrence_('1st fri of every month', new Date(2026, 0, 5), [])) === '2026-02-06',
        iso(nextOccurrence_('1st fri of every month', new Date(2026, 0, 5), [])));
  check('…crosses the year end correctly',
        iso(nextOccurrence_('1st fri of every month', new Date(2026, 11, 10), [])) === '2027-01-01',
        iso(nextOccurrence_('1st fri of every month', new Date(2026, 11, 10), [])));
  check('"5th mon of every month" finds the next month that has one',
        nextOccurrence_('5th mon of every month', new Date(2026, 0, 1), []) !== null);
  check('parse: "of every month" and "of every" are the same rule',
        JSON.stringify(parseDateRule_('1st fri of every month')) ===
        JSON.stringify(parseDateRule_('1st fri of every')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
