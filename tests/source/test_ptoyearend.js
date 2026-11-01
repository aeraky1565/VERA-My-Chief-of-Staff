// A vacation on Dec 31 is read.
//
// The PTO Planner read the year from Jan 1 to `new Date(year, 11, 31)`: the
// first moment of Dec 31. Calendar getEvents returns events that START before
// the end of the window, so an all-day Dec 31 event (which starts exactly
// then) was never returned, in any year. The fake calendar here applies the
// same rule as Google's, which the older harness did not (it returned every
// event whatever the window, so the bug could not show).
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const PTO = fs.readFileSync(ROOT + '/PTO.js', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}

const ymd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const allDay = (title, s, eExcl) => ({ title, allDay: true, start: ymd(s), end: ymd(eExcl) });
const timed = (title, s, h1, h2) => ({ title, allDay: false,
  start: new Date(ymd(s).getTime() + h1 * 3600000), end: new Date(ymd(s).getTime() + h2 * 3600000) });

function scan(events, year) {
  const calls = [];
  const cal = { getEvents: (from, to) => {
    calls.push([from, to]);
    // Google's rule: an event is returned when it overlaps [from, to).
    return events.filter(e => e.start < to && e.end > from).map(e => ({
      getTitle: () => e.title, isAllDayEvent: () => e.allDay,
      getAllDayStartDate: () => e.start, getAllDayEndDate: () => e.end,
      getStartTime: () => e.start, getEndTime: () => e.end }));
  } };
  const ctx = { Date, Math, String, Number, Object, Array, JSON, Set, RegExp, Error,
    Logger: { log: () => {} }, Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: d => { const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); } },
    getCalendarByName_: () => cal };
  vm.createContext(ctx);
  vm.runInContext([extractFn(PTO, 'countWeekdays_'), extractFn(PTO, 'getPTOEvents_')].join('\n'), ctx);
  ctx.__cfg = { calendarName: 'Work', year, ignoreKeywords: ['pay day'], holidayKeywords: ['day', 'holiday'] };
  return { res: vm.runInContext('getPTOEvents_(__cfg)', ctx), calls };
}

// A year in the past, so every event reads as Used and counts are stable.
const Y = 2024;   // Dec 31, 2024 is a Tuesday

console.log('\nthe last day of the year is read');
{
  const { res, calls } = scan([allDay('Vacation', Y + '-12-31', (Y + 1) + '-01-01')], Y);
  const v = res.events.filter(e => e.type === 'Vacation');
  check('a Dec 31 vacation is found', v.length === 1, JSON.stringify(res.events));
  check('…as one weekday', v[0] && v[0].weekdays === 1 && v[0].startDate === Y + '-12-31', JSON.stringify(v));
  check('the window runs to the start of next Jan 1',
        calls.length === 1 && calls[0][1].getTime() === new Date(Y + 1, 0, 1).getTime(), String(calls[0] && calls[0][1]));

  const pto = scan([allDay('PTO', Y + '-12-31', (Y + 1) + '-01-01')], Y).res.events;
  check('an all-day PTO day on Dec 31 is found', pto.length === 1 && pto[0].hours === 8, JSON.stringify(pto));
  const part = scan([timed('PTO', Y + '-12-31', 9, 15)], Y).res.events;
  check('a few hours of PTO on Dec 31 are found', part.length === 1 && part[0].hours === 6, JSON.stringify(part));
  const hol = scan([allDay("New Year's Eve Holiday", Y + '-12-31', (Y + 1) + '-01-01')], Y).res.holidays;
  check('a Dec 31 company holiday is found', hol.length === 1 && hol[0].date === Y + '-12-31', JSON.stringify(hol));
}

console.log('\na block across New Year counts only this year\'s days');
{
  // Mon Dec 30 – Thu Jan 2: two weekdays in this year, two in the next.
  const v = scan([allDay('Vacation', Y + '-12-30', (Y + 1) + '-01-03')], Y).res.events;
  check('only Dec 30 and 31 count this year', v.length === 1 && v[0].weekdays === 2 && v[0].endDate === Y + '-12-31',
        JSON.stringify(v));
  const next = scan([allDay('Vacation', Y + '-12-30', (Y + 1) + '-01-03')], Y + 1).res.events;
  check('…and Jan 1 and 2 count next year', next.length === 1 && next[0].weekdays === 2 &&
        next[0].startDate === (Y + 1) + '-01-01', JSON.stringify(next));
  const p = scan([allDay('PTO', Y + '-12-31', (Y + 1) + '-01-02')], Y).res.events;
  check('all-day PTO across New Year counts only Dec 31 this year', p.length === 1 && p[0].hours === 8, JSON.stringify(p));
}

console.log('\nnext year\'s first day is not this year\'s');
{
  const v = scan([allDay('Vacation', (Y + 1) + '-01-01', (Y + 1) + '-01-02')], Y).res.events;
  check('a Jan 1 vacation is left for next year', v.length === 0, JSON.stringify(v));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
