// Habits.js reads HabitLog dates the way Sheets returns them. Pins:
//  - a Date cell (what getValues gives for '2026-11-18') counts in the year grid;
//  - text dates still work, and other years are left out;
//  - marking a day already logged as a Date doesn't add a second row;
//  - unmarking finds a row whose date is a Date.
// Invented habit.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const HB = fs.readFileSync(path.join(ROOT, 'Habits.js'), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function ctx(rows) {
  const grid = rows.map(r => r.slice());
  const log = { appended: [], deleted: [] };
  const sheet = {
    getLastRow: () => grid.length + 1,
    getRange: (r, c, nr, nc) => ({ getValues: () => grid.slice(r - 2, r - 2 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }),
    appendRow: row => { log.appended.push(row); grid.push(row); },
    deleteRow: n => { log.deleted.push(n); grid.splice(n - 2, 1); },
  };
  const c = { String, Number, Math, Object, Array, isNaN, Date, Logger: { log() {} },
    TABS: { HABIT_LOG: 'HabitLog', HABITS: 'Habits', GYM_LOG: 'GymLog' }, HABIT_LOG_HEADERS: ['ID', 'Habit ID', 'Date', 'Notes'],
    HABITS_HEADERS: ['ID', 'Name', 'Cadence', 'Color', 'Active', 'Notes'], GYM_LOG_HEADERS: [],
    Utilities: { formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '20261125120000' },
    Session: { getScriptTimeZone: () => 'UTC' },
    getSpreadsheet: () => ({ getSheetByName: n => n === 'HabitLog' ? sheet : null }) };
  vm.createContext(c); vm.runInContext(HB, c);
  return { c, grid, log };
}
const D = (y, m, d) => new Date(y, m - 1, d, 0, 0, 0);

console.log('\nreading the year');
{
  const { c } = ctx([['LOG-1', 'HAB-1', D(2026, 11, 18), 'x'], ['LOG-2', 'HAB-1', '2026-11-21', ''], ['LOG-3', 'HAB-1', D(2025, 12, 30), ''], ['LOG-4', 'HAB-1', '2026-1-5', '']]);
  const log = c.getHabitLog_(2026);
  check('a Date cell counts, as yyyy-MM-dd', log.some(e => e.date === '2026-11-18'), JSON.stringify(log.map(e => e.date)));
  check('a text date still counts', log.some(e => e.date === '2026-11-21'));
  check('an unpadded text date is padded', log.some(e => e.date === '2026-01-05'));
  check('another year is left out', !log.some(e => e.date.indexOf('2025') === 0) && log.length === 3);
  check('hbYmd_: Date, text, blank', c.hbYmd_(D(2026, 3, 9)) === '2026-03-09' && c.hbYmd_('2026-03-09') === '2026-03-09' && c.hbYmd_('') === '');
}

console.log('\nmark and unmark');
{
  const { c, log } = ctx([['LOG-1', 'HAB-1', D(2026, 11, 18), '']]);
  const r = c.logHabitCompletion_('HAB-1', '2026-11-18', '');
  check('marking a day already logged as a Date adds nothing', r.alreadyLogged === true && log.appended.length === 0, JSON.stringify(r));
  c.logHabitCompletion_('HAB-1', '2026-11-19', '');
  check('…a new day is added', log.appended.length === 1);
  c.unlogHabitCompletion_('HAB-1', '2026-11-18');
  check('unmarking finds the Date row and removes it', log.deleted.length === 1 && log.deleted[0] === 2, JSON.stringify(log.deleted));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
