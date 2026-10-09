// writePTOSnapshot_ was 4m 06s of a 6-minute ceiling, and the nightly run was killed.
//
// Ten getEvents calls for the shipped config, four of them redundant. The worst pair:
// findClearWindows_ and getMilestones_ are handed THE SAME gapCals array and compute
// THE SAME window — one took its 90 days as a parameter, the other hardcoded 90 — so
// every gap calendar was fetched twice, back to back, for identical events. Equal by
// coincidence rather than by agreement, which is exactly why nobody saw it.
//
// CalendarApp.getCalendarsByName ran seven times for five distinct names in one
// snapshot: getPTOEvents_ resolved the work calendar and dropped the handle,
// getUpcomingTravel_ resolved the travel calendars and dropped theirs, then
// getGapCalendars_ resolved two of the same names again.
//
// And getPTOEvents_ walked a 365-day event list TWICE, calling getTitle() and
// isAllDayEvent() on every event in both passes. Those are round trips to the Calendar
// service, not property reads.
//
// Everything here asserts COST, counted off a fake Calendar that records every call —
// the test_perkpurge idiom. An output-only test passes just as well on the slow version.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const PTO   = fs.readFileSync(ROOT + '/PTO.js', 'utf8');
const TRIPS = fs.readFileSync(ROOT + '/Trips.js', 'utf8');

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
const varLine = (src, name) =>
  new RegExp('^var ' + name + '\\s*=.*?;', 'm').exec(src)[0];

const DAY = 86400000;

// A Calendar service that COUNTS. Every resolution and every fetch is recorded with
// its window, because "one scan per calendar per window" is the property under test.
function makeCalendarApp(calls, eventsByCal) {
  const mk = name => ({
    getName: () => name,
    getEvents: (from, to) => {
      calls.getEvents.push({
        cal: name,
        days: Math.round((to.getTime() - from.getTime()) / DAY),
      });
      return (eventsByCal[name] || []).slice();
    },
  });
  return {
    getCalendarsByName: name => {
      calls.byName.push(name);
      return eventsByCal[name] ? [mk(name)] : [];
    },
    getDefaultCalendar: () => { calls.byName.push('(default)'); return mk('(default)'); },
  };
}

function harness(opts) {
  opts = opts || {};
  const calls = { byName: [], getEvents: [] };
  const logs = [];
  const ctx = {
    console, Date, Math, String, Number, Boolean, Object, Array, JSON, Set, Map,
    isNaN, parseInt, parseFloat, RegExp, Error,
    Logger: { log: m => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: {
      formatDate: (d, tz, pat) => {
        const D = new Date(d), p2 = n => String(n).padStart(2, '0');
        if (pat === 'yyyy-MM-dd') return D.getFullYear() + '-' + p2(D.getMonth() + 1) + '-' + p2(D.getDate());
        if (pat === 'EEEE') return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][D.getDay()];
        return D.toISOString();
      },
    },
    CalendarApp: makeCalendarApp(calls, opts.eventsByCal || {}),
    _calls: calls, _logs: logs,
  };
  vm.createContext(ctx);
  vm.runInContext(varLine(PTO, '_calendarByName_'), ctx);
  vm.runInContext(extractFn(PTO, 'invalidateCalendarByName_'), ctx);
  vm.runInContext(extractFn(PTO, 'getCalendarByName_'), ctx);
  vm.runInContext(varLine(PTO, 'PTO_GAP_SCAN_DAYS_'), ctx);
  vm.runInContext(extractFn(PTO, 'scanGapCalendars_'), ctx);
  vm.runInContext(extractFn(PTO, 'getGapCalendars_'), ctx);
  return ctx;
}

// All-day event in the shape CalendarApp returns.
const allDay = (title, startISO, endExclISO) => ({
  getTitle: () => title,
  isAllDayEvent: () => true,
  getAllDayStartDate: () => new Date(startISO + 'T00:00:00'),
  getAllDayEndDate:   () => new Date(endExclISO + 'T00:00:00'),
  isRecurringEvent: () => false,
  getId: () => title + '@x',
});

// ============================================================================
console.log('One name resolution per calendar, however many callers');
{
  const c = harness({ eventsByCal: { Work: [], Joint: [] } });
  vm.runInContext("getCalendarByName_('Work'); getCalendarByName_('Work'); " +
                  "getCalendarByName_('Joint'); getCalendarByName_('Work');", c);
  check('three asks for one name resolve it once',
        c._calls.byName.filter(n => n === 'Work').length === 1,
        JSON.stringify(c._calls.byName) +
        ' — seven calls for five names in one snapshot, each a Calendar round trip');
  check('…and a second name is still resolved',
        c._calls.byName.filter(n => n === 'Joint').length === 1, JSON.stringify(c._calls.byName));

  // A miss is remembered too, or an absent calendar costs a round trip AND a log line
  // per caller for the whole run.
  const c2 = harness({ eventsByCal: {} });
  vm.runInContext("getCalendarByName_('Ghost'); getCalendarByName_('Ghost');", c2);
  check('a calendar that does not exist is asked for once, not twice',
        c2._calls.byName.length === 1, JSON.stringify(c2._calls.byName));
  check('…and warns once, not once per caller',
        c2._logs.filter(l => /calendar not found/.test(l)).length === 1,
        JSON.stringify(c2._logs));
  check('…and still returns null', vm.runInContext("getCalendarByName_('Ghost')", c2) === null);

  vm.runInContext("invalidateCalendarByName_(); getCalendarByName_('Ghost');", c2);
  check('the escape hatch forces a re-resolve', c2._calls.byName.length === 2,
        JSON.stringify(c2._calls.byName));
}

console.log('\nOne scan per gap calendar, shared by both consumers');
{
  const c = harness({ eventsByCal: { Work: [], Joint: [] } });
  const cfg = { gapCalendarsRaw: 'Work,Joint' };
  vm.runInContext('var cals = getGapCalendars_(' + JSON.stringify(cfg) + ');', c);
  vm.runInContext('var today = new Date(2026, 9, 9); today.setHours(0,0,0,0);', c);
  vm.runInContext('var scanned = scanGapCalendars_(cals, today);', c);

  check('two gap calendars make exactly two fetches',
        c._calls.getEvents.length === 2, JSON.stringify(c._calls.getEvents) +
        ' — findClearWindows_ and getMilestones_ each used to make their own');
  check('…both over the shared window',
        c._calls.getEvents.every(g => g.days === vm.runInContext('PTO_GAP_SCAN_DAYS_', c)),
        JSON.stringify(c._calls.getEvents));
  check('…and the result is parallel to the calendars',
        vm.runInContext('scanned.length', c) === 2);

  // The constant is the point: the two consumers used to arrive at 90 independently.
  // Checked inside EACH function's own body. A file-wide regex was satisfied by
  // scanGapCalendars_'s copy of the same expression, so reverting getMilestones_ to a
  // hardcoded 90 left it green and its control did not bite.
  check('findClearWindows_ takes the window from the constant',
        /lookAheadDays \|\| PTO_GAP_SCAN_DAYS_/.test(extractFn(PTO, 'findClearWindows_')));
  check('…and getMilestones_ reads the SAME constant, not its own 90',
        /PTO_GAP_SCAN_DAYS_ \* 24 \* 60 \* 60 \* 1000/.test(extractFn(PTO, 'getMilestones_')) &&
        !/\b90 \* 24 \* 60 \* 60 \* 1000/.test(extractFn(PTO, 'getMilestones_')),
        'one took it as a parameter and the other hardcoded it — equal by coincidence, ' +
        'which is why the duplicate fetch was invisible');
}

console.log('\nAn unreadable calendar costs only its own window');
{
  const c = harness({ eventsByCal: { Good: [] } });
  let scanThrew = null;
  try {
    vm.runInContext(`
      var bad  = { getName: function() { return 'Bad'; },
                   getEvents: function() { throw new Error('no access'); } };
      var good = CalendarApp.getCalendarsByName('Good')[0];
      var today = new Date(2026, 9, 9);
      var out = scanGapCalendars_([bad, good], today);
    `, c);
  } catch (e) { scanThrew = e.message; }
  check('the scan does not propagate the failure', scanThrew === null, scanThrew +
        ' — one unreadable calendar must not cost the other calendars their windows');
  check('the throwing calendar yields null, not an exception',
        scanThrew === null && vm.runInContext('out[0] === null', c),
        'one bad calendar must not cost the others');
  check('…and the good one still scanned',
        scanThrew === null && vm.runInContext('Array.isArray(out[1])', c));
  check('…and it is logged', c._logs.some(l => /scanGapCalendars_/.test(l)), JSON.stringify(c._logs));
}

console.log('\nThe consumers use the injected scan, and still work without one');
{
  const fcw = extractFn(PTO, 'findClearWindows_');
  const gms = extractFn(PTO, 'getMilestones_');
  check('findClearWindows_ prefers the injected events',
        /\(scannedEvents && scannedEvents\[c\]\) \|\| gapCalendars\[c\]\.getEvents\(/.test(fcw),
        'the fallback is one bounded getEvents, which is why it is allowed here');
  check('getMilestones_ does the same',
        /\(scannedEvents && scannedEvents\[c\]\) \|\| gapCalendars\[c\]\.getEvents\(/.test(gms));
  check('writePTOSnapshot_ scans once and passes it to both',
        /var gapScan\s+= sub_\('gapScan'/.test(PTO) &&
        /findClearWindows_\(gapCals, today, PTO_GAP_SCAN_DAYS_, 3, gapScan\)/.test(PTO) &&
        /getMilestones_\(gapCals, cfg, today, gapScan\)/.test(PTO));
}

// ============================================================================
console.log('\ngetPTOEvents_ reads each getter once per event, not once per pass');
{
  const counts = {};
  const countingEvent = (title, s, e) => {
    counts[title] = { title: 0, allDay: 0 };
    return {
      getTitle: () => { counts[title].title++; return title; },
      isAllDayEvent: () => { counts[title].allDay++; return true; },
      getAllDayStartDate: () => new Date(s + 'T00:00:00'),
      getAllDayEndDate:   () => new Date(e + 'T00:00:00'),
    };
  };
  const evs = [countingEvent('Memorial Day', '2026-05-25', '2026-05-26'),
               countingEvent('Vacation — Rome', '2026-07-06', '2026-07-11')];

  const c = harness({ eventsByCal: { Work: evs } });
  vm.runInContext(extractFn(PTO, 'countWeekdays_'), c);
  vm.runInContext(extractFn(PTO, 'getPTOEvents_'), c);
  const cfg = { calendarName: 'Work', year: 2026,
                ignoreKeywords: ['pay day'], holidayKeywords: ['day', 'holiday'],
                milestoneKeywords: [] };
  vm.runInContext('var res = getPTOEvents_(' + JSON.stringify(cfg) + ');', c);

  check('one getEvents for the year', c._calls.getEvents.length === 1,
        JSON.stringify(c._calls.getEvents));
  Object.keys(counts).forEach(t => {
    check('  "' + t + '" getTitle() once', counts[t].title === 1,
          String(counts[t].title) + ' — two passes over a year of events paid twice');
    check('  "' + t + '" isAllDayEvent() once', counts[t].allDay === 1, String(counts[t].allDay));
  });

  // Behaviour unchanged: the holiday is still picked up, the vacation still classified.
  check('the holiday is still found',
        vm.runInContext('res.holidays.length', c) === 1,
        JSON.stringify(vm.runInContext('res.holidays', c)));
  check('…and the vacation still becomes a PTO event',
        vm.runInContext('res.events.filter(function(e){return e.type==="Vacation";}).length', c) >= 1,
        JSON.stringify(vm.runInContext('res.events.map(function(e){return e.type;})', c)));
}

// ============================================================================
console.log('\ntouchTripRow_ writes one range per contiguous run');
{
  const writes = [];
  const rows = [
    ['ID', 'Label', 'Start', 'End', 'EventIds', 'x', 'y', 'LastSeen'],
    ['TR-1', 'Old Label', '2026-01-01', '2026-01-05', 'ev-a', '', '', '2020-01-01T00:00:00Z'],
  ];
  const ctx = {
    console, Date, String, Number, Object, Array, JSON, Error,
    Logger: { log: () => {} },
    readTripRegistry_: () => ({
      byId: { 'TR-1': { label: 'Old Label', startDate: '2026-01-01', endDate: '2026-01-05',
                        eventIds: ['ev-a'], lastSeen: '2020-01-01T00:00:00Z', _row: 2 } },
      rows: [],
    }),
    getTripsSheet_: () => ({
      getRange: (r, c, nR, nC) => ({
        setValue: v => { writes.push({ col: c, width: 1 }); rows[r - 1][c - 1] = v; },
        setValues: vals => {
          writes.push({ col: c, width: nC });
          vals[0].forEach((v, j) => { rows[r - 1][c - 1 + j] = v; });
        },
      }),
    }),
    invalidateTripRegistry_: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(TRIPS, 'touchTripRow_'), ctx);
  vm.runInContext("touchTripRow_('TR-1', { label: 'New Label', startDate: '2026-02-01', " +
                  "endDate: '2026-02-09', eventIds: ['ev-b'] });", ctx);

  check('columns 2-5 go in ONE range', writes.some(w => w.col === 2 && w.width === 4),
        JSON.stringify(writes) + ' — four single-cell setValue calls, once per field');
  check('…and lastSeen separately, since column 8 is not adjacent',
        writes.some(w => w.col === 8), JSON.stringify(writes));
  check('…for two round trips, not four', writes.length === 2, JSON.stringify(writes));
  check('no single-cell setValue survives', writes.every(w => w.width > 0 && w.col !== undefined));

  // The values still land where they belong — a batched write that smears the row is
  // worse than four slow ones.
  check('the label was written', rows[1][1] === 'New Label', JSON.stringify(rows[1]));
  check('the dates were written', rows[1][2] === '2026-02-01' && rows[1][3] === '2026-02-09',
        JSON.stringify(rows[1]));
  check('the event ids grew rather than replaced', rows[1][4] === 'ev-a;ev-b', rows[1][4]);
  check('the untouched columns are untouched', rows[1][0] === 'TR-1' && rows[1][5] === '',
        JSON.stringify(rows[1]) + ' — a whole-row write would have blanked these');
}

// ============================================================================
console.log('\nThe snapshot reports where its own time went');
{
  const body = extractFn(PTO, 'writePTOSnapshot_');
  check('the timer is declared before any use of it',
        body.indexOf('var ptoSubs = []') < body.indexOf("sub_('memory'"),
        'sub_ is hoisted but ptoSubs is not — var leaves it undefined, so an earlier ' +
        'call would push onto undefined and take the snapshot down');
  ['memory', 'ptoEvents', 'travel', 'gapCals', 'gapScan', 'clearWindows',
   'milestones', 'stats', 'accrual', 'veraRecs'].forEach(name => {
    check('  ' + name + ' is timed', new RegExp("sub_\\('" + name + "'").test(body));
  });
  check('the timings ride home on the returned object',
        /stats\.subTimings = ptoSubs;/.test(body),
        'posting Slack from inside this function would put a network call on the hot path');
  check('…and are rendered by the same formatter as the step line',
        /slowestNightlySteps_\(ptoStats && ptoStats\.subTimings, 11\)/
          .test(fs.readFileSync(ROOT + '/Code.js', 'utf8')),
        'so the breakdown and the step total can never be computed differently');
  check('a block that throws still records its time',
        /finally \{ ptoSubs\.push/.test(body),
        'a try/catch would lose the timing of exactly the block worth timing');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
