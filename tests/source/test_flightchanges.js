// A stored flight the calendar has since moved or rebooked.
//
// The stored row used to be paired with its calendar copy only by date +
// flight number. When the airline moved the date or rebooked, both showed: the
// stale row and the live calendar flight. reconcileChangedFlights_ pairs them,
// the itinerary shows the calendar's version, the stale row comes back as
// changedFlights, and a nightly flag says so until the row is updated or removed.
//
// Invented flights throughout.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const WEB = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
const CODE = fs.readFileSync(ROOT + '/Code.js', 'utf8');

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

const FNS = ['flightKeyFor_', 'flightRouteKey_', 'flightConfOf_', 'reconcileChangedFlights_', 'flightChangesWanted_'];
function ctx(extra) {
  const c = Object.assign({ String, Number, Object, Array, Date, Math, JSON, RegExp, isNaN, Infinity, Error }, extra || {});
  vm.createContext(c);
  vm.runInContext(WEB.match(/var FLIGHT_CHANGE_FLAG_PREFIX_ = '[^']*';/)[0] + '\n' +
                  FNS.map(n => extractFn(WEB, n)).join('\n'), c);
  return c;
}
const C = ctx();
const meta = o => JSON.stringify(o);
const row = (id, date, num, o) => Object.assign({ id, type: 'flight', title: 'Flight ' + num, date,
  startTime: '18:00', endTime: '20:00', source: 'manual',
  metadata: meta(Object.assign({ flightNum: num }, (o || {}).meta || {})) }, o && o.extra || {});
const cal = (date, title, m, times) => ({ id: 'CAL-' + date + title, type: 'flight', title, date,
  startTime: (times || [])[0] || '17:30', endTime: (times || [])[1] || '19:30', source: 'calendar', metadata: meta(m || {}) });
const rec = (stored, calAll, calLive) => { C.__s = stored; C.__a = calAll; C.__l = calLive || calAll;
  return vm.runInContext('reconcileChangedFlights_(__s, __a, __l)', C); };

console.log('\na moved or rebooked flight is paired with the calendar\'s version');
{
  // Moved: same flight, same booking, two days earlier.
  const s = row('R1', '2026-10-23', 'UA590', { meta: { origin: 'BWI', dest: 'ORD', confirmationNumber: 'ABC123' } });
  const c = cal('2026-10-21', 'Flight to Chicago (UA 590)', { origin: 'BWI', dest: 'ORD', confirmationNumber: 'ABC123' });
  const r = rec([s], [c]);
  check('a moved date is caught', r.changed.length === 1 && r.changed[0].reason === 'date', JSON.stringify(r.changed));
  check('…the stale row leaves the list', r.stored.length === 0, JSON.stringify(r.stored));
  check('…and the change carries the calendar\'s date, times and flight',
        r.changed[0].by.date === '2026-10-21' && r.changed[0].by.startTime === '17:30' && r.changed[0].by.flight === 'UA590',
        JSON.stringify(r.changed[0].by));

  // Rebooked: new flight number, same booking and route, same day.
  const s2 = row('R2', '2026-11-06', 'UA101', { meta: { origin: 'IAD', dest: 'MIA', confirmationNumber: 'XYZ789' } });
  const c2 = cal('2026-11-06', 'Flight UA2210 IAD to MIA', { origin: 'IAD', dest: 'MIA', confirmationNumber: 'XYZ789' });
  const r2 = rec([s2], [c2]);
  check('a rebooking onto another flight is caught', r2.changed.length === 1 && r2.changed[0].reason === 'flight',
        JSON.stringify(r2.changed));

  // Same booking moved weeks: allowed with the confirmation number.
  const c3 = cal('2026-12-02', 'Flight UA590 BWI to ORD', { origin: 'BWI', dest: 'ORD', confirmationNumber: 'ABC123' });
  check('with the booking number, a move of weeks is still caught', rec([s], [c3]).changed.length === 1);
}

console.log('\n…without a booking number, only when it is plainly the same leg');
{
  const s = row('R3', '2026-10-23', 'AA12', { meta: { origin: 'DCA', dest: 'BOS' } });
  check('same route within 3 days', rec([s], [cal('2026-10-25', 'Flight AA99 DCA to BOS', { origin: 'DCA', dest: 'BOS' })]).changed.length === 1);
  check('…but not 4 days away', rec([s], [cal('2026-10-27', 'Flight AA99 DCA to BOS', { origin: 'DCA', dest: 'BOS' })]).changed.length === 0);
  check('a different route never', rec([s], [cal('2026-10-23', 'Flight AA99 DCA to JFK', { origin: 'DCA', dest: 'JFK' })]).changed.length === 0);

  // No route on either side: the same flight number, within 3 days.
  const bare = { id: 'R4', type: 'flight', title: 'Flight DL400', date: '2026-10-23', startTime: '08:00', metadata: '{}' };
  check('no route: the same flight number within 3 days', rec([bare], [cal('2026-10-24', 'Flight DL400', {})]).changed.length === 1);
  check('…a different number is not', rec([bare], [cal('2026-10-24', 'Flight DL401', {})]).changed.length === 0);
}

console.log('\none booking for both directions does not swap the legs');
{
  // The round trip: one confirmation number on both flights.
  const out = row('OUT', '2026-10-21', 'UA590', { meta: { origin: 'BWI', dest: 'ORD', confirmationNumber: 'RT1234' } });
  const back = cal('2026-10-28', 'Flight UA1369 ORD to DCA', { origin: 'ORD', dest: 'DCA', confirmationNumber: 'RT1234' });
  const r = rec([out], [back]);
  check('the outbound is not replaced by the return', r.changed.length === 0 && r.stored.length === 1, JSON.stringify(r));
  // Two different bookings on the same route a day apart (e.g. one each).
  const mine = row('MINE', '2026-10-21', 'UA590', { meta: { origin: 'BWI', dest: 'ORD', confirmationNumber: 'AAA111' } });
  const theirs = cal('2026-10-22', 'Flight UA592 BWI to ORD', { origin: 'BWI', dest: 'ORD', confirmationNumber: 'BBB222' });
  check('a different booking on the same route is not paired', rec([mine], [theirs]).changed.length === 0);
}

console.log('\nexact matches and other rows are left alone');
{
  const s = row('R5', '2026-10-21', 'UA590', { meta: { origin: 'BWI', dest: 'ORD' } });
  const exact = cal('2026-10-21', 'Flight to Chicago (UA 590)', { origin: 'BWI', dest: 'ORD' });
  // The exact copy was suppressed upstream, so it is in calendarAll but not live.
  const r = rec([s], [exact], []);
  check('a row that matches its calendar copy exactly stays', r.stored.length === 1 && !r.changed.length, JSON.stringify(r));
  const hotel = { id: 'H1', type: 'hotel', title: 'Hotel', date: '2026-10-21', metadata: '{}' };
  check('non-flights are untouched', rec([hotel], [exact]).stored.length === 1);
  const alone = row('R6', '2026-10-21', 'UA590', { meta: { origin: 'BWI', dest: 'ORD' } });
  check('a flight only in the sheet stays', rec([alone], []).stored.length === 1);
}

console.log('\none calendar flight replaces at most one row, the nearest');
{
  const a = row('A', '2026-10-20', 'UA1', { meta: { origin: 'BWI', dest: 'ORD' } });
  const b = row('B', '2026-10-22', 'UA2', { meta: { origin: 'BWI', dest: 'ORD' } });
  const c = cal('2026-10-21', 'Flight UA3 BWI to ORD', { origin: 'BWI', dest: 'ORD' });
  const r = rec([a, b], [c]);
  check('only one row is replaced', r.changed.length === 1 && r.stored.length === 1, JSON.stringify(r.changed.map(x => x.row.id)));
  const near = row('N', '2026-10-21', 'UA9', { meta: { origin: 'BWI', dest: 'ORD' } });
  const far = row('F', '2026-10-23', 'UA8', { meta: { origin: 'BWI', dest: 'ORD' } });
  const r2 = rec([far, near], [cal('2026-10-21', 'Flight UA7 BWI to ORD', { origin: 'BWI', dest: 'ORD' })]);
  check('…the nearest in date, whatever the sheet order', r2.changed.length === 1 && r2.changed[0].row.id === 'N',
        JSON.stringify(r2.changed.map(x => x.row.id)));
  check('…and the other row stays', r2.stored.length === 1 && r2.stored[0].id === 'F', JSON.stringify(r2.stored.map(x => x.id)));
}

console.log('\nthe itinerary read');
{
  check('webGetItinerary_ reconciles after suppressing exact copies',
        /var calLive = suppressCalendarDuplicatesOfRows_\(calAll, items\);\s*[\s\S]{0,400}reconcileChangedFlights_\(items, calAll, calLive\)/.test(extractFn(WEB, 'webGetItinerary_')));
  check('…keeps only the reconciled stored rows', /items\.push\.apply\(items, recon\.stored\)/.test(extractFn(WEB, 'webGetItinerary_')));
  check('…and returns the stale ones as changedFlights',
        /items: items, changedFlights: changedFlights/.test(extractFn(WEB, 'webGetItinerary_')));
}

console.log('\nthe confirmation number is read from the airline\'s wording');
{
  const src = extractFn(WEB, 'webGetItinerary_');
  const re = new RegExp(src.match(/\.match\(\/(conf\(\?:irmation\)[^\n]*?)\/i\)/)[1], 'i');
  const code = t => { const m = t.match(re); const c = m ? m[1] : '';
    return (/\d/.test(c) || /^[A-Z]{5,8}$/.test(c)) ? c.toUpperCase() : ''; };
  check('"Confirmation number: EPGVLX" (United) gives the code, not "number"', code('Confirmation number: EPGVLX') === 'EPGVLX',
        code('Confirmation number: EPGVLX'));
  check('"Confirmation #: EPVD0D"', code('United Airlines Confirmation #: EPVD0D') === 'EPVD0D');
  check('"Conf# 9L4DMN"', code('Conf# 9L4DMN') === '9L4DMN');
  check('a plain word is not a code', code('Confirmation pending') === '', code('Confirmation pending'));
}

console.log('\nthe real itinerary read, end to end');
{
  // The sheet has UA590 on Oct 23; the calendar now has it on Oct 21.
  const sheetRows = [['ITIN-1', '2026-10-21|Lake Trip', 'flight', 'Flight UA590', '2026-10-23', '18:00', '19:20',
                      'BWI', '', JSON.stringify({ flightNum: 'UA590', origin: 'BWI', dest: 'ORD', confirmationNumber: 'ABC123', seat: '21C' })],
                     ['ITIN-2', '2026-10-21|Lake Trip', 'dining', 'Dinner', '2026-10-22', '19:00', '', '', '', '']];
  const ev = { getTitle: () => 'Flight to Chicago (UA 590)', getLocation: () => 'Baltimore BWI',
    getDescription: () => 'United Airlines flight 590\nBaltimore BWI 5:29pm - Chicago ORD 6:49pm\n\nConfirmation number: ABC123',
    getStartTime: () => new Date('2026-10-21T21:29:00Z'), getEndTime: () => new Date('2026-10-21T23:49:00Z'),
    getId: () => 'ev1', isAllDayEvent: () => false, isRecurringEvent: () => false, getGuestByEmail: () => null };
  const calObj = { getId: () => 'joint', getName: () => 'Joint', getEvents: () => [ev] };
  const fmt = (d, tz, f) => { const iso = new Date(d.getTime() - 4 * 3600000).toISOString();
    return f === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso.slice(11, 16); };
  const W = { String, Number, Object, Array, Date, Math, JSON, RegExp, isNaN, isFinite, parseInt, Infinity, Error,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'me@example.test' }) },
    Utilities: { formatDate: fmt },
    CalendarApp: { getAllCalendars: () => [calObj], GuestStatus: { MAYBE: 'maybe' } },
    TABS: { ITINERARY: 'Itinerary' }, ITINERARY_HEADERS: new Array(10).fill('x'),
    getSpreadsheet: () => ({ getSheetByName: () => ({ getLastRow: () => sheetRows.length + 1,
      getRange: () => ({ getValues: () => sheetRows.map(r => r.slice()) }) }) }),
    readPTOConfig_: () => ({ gapCalendarsRaw: 'Joint', calendarName: 'PTO' }),
    fetchEventTimezoneMap_: () => ({}),
    isItineraryCalendarRelevant_: () => ({ include: true, type: 'flight' }),
    isVirtualMeetingLocation_: () => false,
    dedupeItineraryCalendarItems_: x => x,
    annotateOptionGroups_: () => {}, applyTripDecisions_: () => {}, tdReadMeta_: () => ({}),
    tripKeyMatches_: (a, b) => String(a).trim() === String(b).trim(),
    tripRowIs_: (a, id, b) => String(a).trim() === String(b).trim(),   // #239: no Trip IDs in these rows
    tripIdCellOf_: () => '',
    dedupeStoredRowsAcrossKeys_: x => x.slice(),   // the real one returns a new array
  };
  vm.createContext(W);
  vm.runInContext(['webGetItinerary_', 'suppressCalendarDuplicatesOfRows_'].concat(FNS).map(n => extractFn(WEB, n)).join('\n'), W);
  W.__e = { parameter: { tripKey: '2026-10-21|Lake Trip', startDate: '2026-10-21', endDate: '2026-10-28' } };
  W.__o = { skipEventTz: true };
  const res = vm.runInContext('webGetItinerary_(__e, __o)', W);
  const flights = res.items.filter(i => i.type === 'flight');
  check('one flight on the itinerary, the calendar\'s', flights.length === 1 && flights[0].source === 'calendar' &&
        flights[0].date === '2026-10-21', JSON.stringify(flights.map(f => [f.source, f.date])));
  check('the dinner is still there', res.items.some(i => i.title === 'Dinner'));
  check('the stale row comes back as a changed flight', res.changedFlights.length === 1 &&
        res.changedFlights[0].row.id === 'ITIN-1' && res.changedFlights[0].by.date === '2026-10-21',
        JSON.stringify(res.changedFlights));
}

console.log('\nthe nightly flag');
{
  const s = row('ITIN-9', '2026-10-23', 'UA590', { meta: { origin: 'BWI', dest: 'ORD', confirmationNumber: 'ABC123' } });
  const c = cal('2026-10-21', 'Flight to Chicago (UA 590)', { origin: 'BWI', dest: 'ORD', confirmationNumber: 'ABC123' }, ['17:29', '18:49']);
  C.__c = rec([s], [c]).changed;
  const w = vm.runInContext('flightChangesWanted_("Lake Trip", __c)', C);
  const keys = Object.keys(w);
  check('one flag per changed row, keyed by its id', JSON.stringify(keys) === '["FLIGHTCHG|ITIN-9"]', JSON.stringify(keys));
  check('it says what moved and where', /UA590 on Lake Trip moved to Oct 21/.test(w[keys[0]].flag), w[keys[0]].flag);
  check('…and what to do', /Update or remove the old row/.test(w[keys[0]].reason) && /Oct 23 18:00/.test(w[keys[0]].reason),
        w[keys[0]].reason);
  C.__c = [];
  check('nothing changed, nothing wanted (so the flag closes)', Object.keys(vm.runInContext('flightChangesWanted_("Lake Trip", __c)', C)).length === 0);
  const sync = extractFn(WEB, 'flightChangesSyncFlags_');
  check('the nightly step reads dates only', /skipEventTz: true/.test(sync));
  check('…for trips within 30 days', /30 \* 86400000/.test(sync));
  check('…and closes flags no longer wanted', /upsertKeyedFlags_\(flags, FLIGHT_CHANGE_FLAG_PREFIX_/.test(sync));
  check('it runs every night', /nightlyStep_\(ctx, 'flightChangesSyncFlags_', flightChangesSyncFlags_\)/.test(CODE));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
