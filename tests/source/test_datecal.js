// Runs the REAL syncImportantDatesToCalendar_ against a fake Spreadsheet and a
// fake CalendarApp. This writes to a live calendar in production, so the three
// dedup gates are the part that has to be right.

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
  const m = SRC.match(new RegExp('^var ' + name + ' = [\\s\\S]*?^\\};?$', 'm'));
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}

const HEADERS = ['ID','Date','Label','Person','Recurring','Lead Time Days','Notes',
                 'Last Actioned Year','Add to Calendar','Calendar Lead Days','Last Calendar Year'];

function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  return {
    _rows: data,
    getLastRow: () => data.length,
    getMaxColumns: () => HEADERS.length,
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
    getRange: (row, colN) => ({ setValue: v => { data[row-1][colN-1] = v; } }),
  };
}

function makeCal(name, events) {
  const evs = (events || []).map(e => Object.assign({ desc: '' }, e));
  return {
    _name: name, _events: evs, _created: [],
    getName: () => name,
    getEventsForDay: d => {
      const k = d.toISOString().slice(0,10);
      return evs.filter(e => e.day === k).map(e => ({
        getTitle: () => e.title,
        getDescription: () => e.desc,
      }));
    },
    createAllDayEvent: (title, date) => {
      const rec = { title, day: date.toISOString().slice(0,10), desc: '' };
      evs.push(rec);
      const handle = { setDescription: t => { rec.desc = t; } };
      cal_created.push({ cal: name, title, day: rec.day, handle });
      return handle;
    },
  };
}
let cal_created = [];

function run(sheet, cals, cfg, todayISO) {
  cal_created = [];
  const logs = [];
  const FixedDate = class extends Date {
    constructor(...a) { if (a.length === 0) super(todayISO + 'T09:00:00Z'); else super(...a); }
    static now() { return new Date(todayISO + 'T09:00:00Z').getTime(); }
  };
  const ctx = {
    TABS: { IMPORTANT_DATES: 'Important Dates' },
    getSpreadsheet: () => ({ getSheetByName: n => n === 'Important Dates' ? sheet : null }),
    getConfigValues: () => cfg,
    CalendarApp: { getAllCalendars: () => cals },
    Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0,10) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Logger: { log: s => logs.push(s) },
    getCalendarByName_: n => cals.filter(c => c.getName() === n)[0] || null,
    getPrimarySharedCalendar_: () => cals.filter(c => c.getName() === 'Shared')[0] || null,
    Date: FixedDate, Object, String, Math, parseInt, Array, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(
    ['WEEKDAY_NAMES_','MONTH_NAMES_','ORDINAL_WORDS_'].map(extractVar).join('\n') + '\n' +
    ['parseDateRule_','nthWeekdayOfMonth_','easterSunday_','occurrenceInYear_',
     'nextOccurrence_','ruleRowsFromSheetValues_','normaliseEventTitle_',
     'syncImportantDatesToCalendar_'].map(extractFn).join('\n') +
    '\nsyncImportantDatesToCalendar_();', ctx);
  return logs;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}
const CFG = { dates_calendar_lead_days: '60', skip_calendars: 'Holidays in United States' };
// National Wife Day 2026 = Sun Sep 20.  "Today" = Aug 1 2026 → 50 days out.
const WIFE = ['id_1','3rd sun of sep','National Wife Day','Victoria','Yes','30','','','Yes','',''];
const rowsWith = (...extra) => [HEADERS, WIFE.slice(), ...extra.map(e => e.slice())];

console.log('\nplacing an occasion nothing knows about');
{
  const sheet = makeSheet(rowsWith());
  const shared = makeCal('Shared', []);
  run(sheet, [shared], CFG, '2026-08-01');
  check('creates exactly one event', cal_created.length === 1, cal_created.length);
  check('on the resolved rule date', cal_created[0] && cal_created[0].day === '2026-09-20',
        cal_created[0] && cal_created[0].day);
  check('on the shared calendar', cal_created[0] && cal_created[0].cal === 'Shared');
  check('titled from the Label', cal_created[0] && cal_created[0].title === 'National Wife Day');
  check('carries the dedup marker',
        /VERA-DATE:id_1:2026/.test(shared._events[shared._events.length-1].desc),
        shared._events[shared._events.length-1].desc);
  check('stamps Last Calendar Year', sheet._rows[1][10] === '2026', sheet._rows[1][10]);
}

console.log('\nrunning again the same night');
{
  const sheet = makeSheet(rowsWith());
  const shared = makeCal('Shared', []);
  run(sheet, [shared], CFG, '2026-08-01');
  const after = JSON.stringify(sheet._rows);
  run(sheet, [shared], CFG, '2026-08-01');
  check('creates nothing the second time', cal_created.length === 0, cal_created.length);
  check('and the sheet is unchanged', JSON.stringify(sheet._rows) === after);
}

console.log('\nan occasion you already put on a calendar yourself');
{
  const sheet = makeSheet(rowsWith());
  const shared   = makeCal('Shared', []);
  const personal = makeCal('Ahmed', [{ day: '2026-09-20', title: '💝  National Wife Day!' }]);
  run(sheet, [shared, personal], CFG, '2026-08-01');
  check('creates nothing', cal_created.length === 0, JSON.stringify(cal_created));
  check('but stamps the year so it stops re-checking', sheet._rows[1][10] === '2026', sheet._rows[1][10]);
  check('emoji/case/punctuation differences still match',
        ['💝  National Wife Day!', 'NATIONAL wife day', 'national-wife-day']
          .every(t => {
            const s2 = makeSheet(rowsWith());
            run(s2, [makeCal('Shared', []), makeCal('Ahmed', [{ day:'2026-09-20', title:t }])], CFG, '2026-08-01');
            return cal_created.length === 0;
          }));
}

console.log('\ndeleting an event VERA placed does not resurrect it');
{
  const sheet = makeSheet(rowsWith());
  const shared = makeCal('Shared', []);
  run(sheet, [shared], CFG, '2026-08-01');
  shared._events.length = 0;                       // user deletes it
  run(sheet, [shared], CFG, '2026-08-02');
  check('not recreated', cal_created.length === 0, JSON.stringify(cal_created));
}

console.log('\nskip_calendars is not consulted');
{
  const sheet = makeSheet(rowsWith());
  const shared   = makeCal('Shared', []);
  const holidays = makeCal('Holidays in United States', [{ day:'2026-09-20', title:'National Wife Day' }]);
  run(sheet, [shared, holidays], CFG, '2026-08-01');
  check('a match on a skipped calendar does not suppress creation', cal_created.length === 1,
        JSON.stringify(cal_created));
}

console.log('\nthe horizon');
{
  let sheet = makeSheet(rowsWith());
  run(sheet, [makeCal('Shared', [])], CFG, '2026-06-01');   // 111 days out
  check('nothing placed beyond the 60-day lead', cal_created.length === 0, cal_created.length);
  check('and no year is stamped', sheet._rows[1][10] === '', JSON.stringify(sheet._rows[1][10]));

  sheet = makeSheet(rowsWith());
  run(sheet, [makeCal('Shared', [])], { ...CFG, dates_calendar_lead_days: '200' }, '2026-06-01');
  check('a longer configured lead does place it', cal_created.length === 1, cal_created.length);

  const perRow = WIFE.slice(); perRow[9] = '150';
  sheet = makeSheet([HEADERS, perRow]);
  run(sheet, [makeCal('Shared', [])], CFG, '2026-06-01');
  check('a per-row lead overrides the config default', cal_created.length === 1, cal_created.length);

  sheet = makeSheet(rowsWith());
  run(sheet, [makeCal('Shared', [])], CFG, '2026-09-21');   // day after
  check('nothing placed for a date that has passed',
        cal_created.every(c => c.day !== '2026-09-20'), JSON.stringify(cal_created));
}

console.log('\nopt-in only');
{
  const off = WIFE.slice(); off[8] = '';
  let sheet = makeSheet([HEADERS, off]);
  run(sheet, [makeCal('Shared', [])], CFG, '2026-08-01');
  check('a blank "Add to Calendar" places nothing', cal_created.length === 0, cal_created.length);

  const no = WIFE.slice(); no[8] = 'No';
  sheet = makeSheet([HEADERS, no]);
  run(sheet, [makeCal('Shared', [])], CFG, '2026-08-01');
  check('"No" places nothing', cal_created.length === 0, cal_created.length);

  const named = WIFE.slice(); named[8] = 'Ahmed';
  sheet = makeSheet([HEADERS, named]);
  run(sheet, [makeCal('Shared', []), makeCal('Ahmed', [])], CFG, '2026-08-01');
  check('a calendar name targets that calendar', cal_created.length === 1 && cal_created[0].cal === 'Ahmed',
        JSON.stringify(cal_created));
}

console.log('\nfixed dates still work through the same path');
{
  const fixed = ['id_9','12-25','Christmas','Both','Yes','30','','','Yes','',''];
  const sheet = makeSheet([HEADERS, fixed]);
  run(sheet, [makeCal('Shared', [])], CFG, '2026-11-15');
  check('an MM-DD row is placed on its day', cal_created.length === 1 && cal_created[0].day === '2026-12-25',
        JSON.stringify(cal_created));
}

console.log('\nbad rows are survivable');
{
  const bad = ['id_8','5th fri of feb','Nonexistent','','Yes','30','','','Yes','',''];
  const sheet = makeSheet([HEADERS, bad, WIFE.slice()]);
  const shared = makeCal('Shared', []);
  let threw = null;
  try { run(sheet, [shared], CFG, '2026-08-01'); } catch (e) { threw = e.message; }
  check('an unresolvable rule does not throw', threw === null, threw);
  check('and the good row beside it still gets placed', cal_created.length === 1,
        JSON.stringify(cal_created));

  const noLabel = ['id_7','3rd sun of sep','','','Yes','30','','','Yes','',''];
  const s2 = makeSheet([HEADERS, noLabel]);
  let threw2 = null;
  try { run(s2, [makeCal('Shared', [])], CFG, '2026-08-01'); } catch (e) { threw2 = e.message; }
  check('a row with no Label is skipped, not placed untitled',
        threw2 === null && cal_created.length === 0, threw2 || JSON.stringify(cal_created));
}

console.log('\nno shared calendar available');
{
  const sheet = makeSheet(rowsWith());
  let threw = null;
  try { run(sheet, [makeCal('Ahmed', [])], CFG, '2026-08-01'); } catch (e) { threw = e.message; }
  check('does not throw', threw === null, threw);
  check('places nothing', cal_created.length === 0, cal_created.length);
  check('and does NOT stamp the year, so it retries tomorrow',
        sheet._rows[1][10] === '', JSON.stringify(sheet._rows[1][10]));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
