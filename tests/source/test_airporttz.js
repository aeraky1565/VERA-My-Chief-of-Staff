// A flight's times are in its AIRPORTS' zones, not the zone its calendar event
// was saved in.
//
// UA1369 ORD→DCA (Oct 28) was saved with both ends in America/New_York. The
// itinerary formatted it in that zone, so it left "at 19:00 from ORD" (really
// 18:00 Central), and the travel-day email said ORD and DCA share a timezone.
// This runs the REAL webGetItinerary_ against a stub calendar holding that
// event, and the REAL insights builder against what it returns.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const WEB = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
const TDB = fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8');

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

// Real zone arithmetic, through Intl, for the formats these functions use.
function formatDate(d, tz, f) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' })
    .formatToParts(d).forEach(p => { parts[p.type] = p.value; });
  if (f === 'yyyy-MM-dd') return parts.year + '-' + parts.month + '-' + parts.day;
  if (f === 'HH:mm') return parts.hour + ':' + parts.minute;
  if (f === 'Z') {
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(parts.timeZoneName);
    return m ? m[1] + m[2] + m[3] : '+0000';
  }
  throw new Error('unexpected format ' + f);
}

const AIRPORT_TZ = { ORD: 'America/Chicago', DCA: 'America/New_York', LHR: 'Europe/London', IAD: 'America/New_York' };

// One calendar, one event. `saved` is the zone(s) the event was saved in.
function itinerary(o) {
  const lookups = [];
  const ev = {
    getTitle: () => o.title || 'Flight UA1369 ORD to DCA',
    getLocation: () => o.location || 'Chicago, IL',
    getDescription: () => o.description || 'United Airlines Confirmation #: EPVD0D',
    getStartTime: () => new Date(o.start || '2026-10-28T23:00:00Z'),   // 18:00 CDT
    getEndTime: () => new Date(o.end || '2026-10-29T01:11:00Z'),       // 21:11 EDT
    getId: () => 'ev1@google.com',
    isAllDayEvent: () => false,
    isRecurringEvent: () => false,
    getGuestByEmail: () => null,
  };
  const cal = { getId: () => 'joint@group', getName: () => 'Joint', getEvents: () => [ev] };
  const ctx = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, isFinite, isNaN, parseInt, Error,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'America/New_York',
               getEffectiveUser: () => ({ getEmail: () => 'me@example.test' }) },
    Utilities: { formatDate },
    CalendarApp: { getAllCalendars: () => [cal], GuestStatus: { MAYBE: 'maybe' } },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    TABS: { ITINERARY: 'Itinerary' }, ITINERARY_HEADERS: new Array(10).fill('x'),
    getSpreadsheet: () => ({ getSheetByName: () => null }),
    readPTOConfig_: () => ({ gapCalendarsRaw: 'Joint', calendarName: 'PTO' }),
    fetchEventTimezoneMap_: () => ({ 'joint@group': { 'ev1@google.com': o.saved || { startTz: 'America/New_York', endTz: 'America/New_York' } } }),
    isItineraryCalendarRelevant_: () => ({ include: true, type: o.type || 'flight' }),
    isVirtualMeetingLocation_: () => false,
    dedupeItineraryCalendarItems_: x => x,
    suppressCalendarDuplicatesOfRows_: x => x,
    annotateOptionGroups_: () => {}, applyTripDecisions_: () => {}, tdReadMeta_: () => ({}),
    // AirportGap answers with the airport's own zone; anything else is a 404.
    fetchTracked_: (svc, url) => {
      const code = String(url).split('/').pop();
      lookups.push(code);
      const z = (o.unknown || []).indexOf(code) !== -1 ? null : AIRPORT_TZ[code];
      return { getResponseCode: () => (z ? 200 : 404),
               getContentText: () => JSON.stringify({ data: { attributes: { timezone: z } } }) };
    },
    travelAirportGeo_: () => null,
  };
  vm.createContext(ctx);
  vm.runInContext([extractFn(WEB, 'webGetItinerary_'), extractFn(TDB, 'airportTz_')].join('\n'), ctx);
  ctx.__e = { parameter: { tripKey: '2026-10-21|Lake Trip', startDate: '2026-10-21', endDate: '2026-10-28' } };
  ctx.__opts = o.opts;
  const res = vm.runInContext('webGetItinerary_(__e, __opts)', ctx);
  const it = res.items[0];
  return { it, meta: it ? JSON.parse(it.metadata) : {}, lookups };
}

console.log('\nthe reported flight: saved in New York at both ends');
{
  const r = itinerary({});
  check('it leaves at 18:00, ORD\'s own clock', r.it.startTime === '18:00', r.it.startTime);
  check('…and lands at 21:11, DCA\'s', r.it.endTime === '21:11', r.it.endTime);
  check('…on the 28th', r.it.date === '2026-10-28', r.it.date);
  check('the departure zone is Chicago', r.meta.startTz === 'America/Chicago', r.meta.startTz);
  check('…the arrival zone New York', r.meta.endTz === 'America/New_York', r.meta.endTz);
  check('the airports are still lifted from the title', r.meta.origin === 'ORD' && r.meta.dest === 'DCA',
        JSON.stringify(r.meta));
}

console.log('\nan event already saved in its airports\' zones is unchanged');
{
  const r = itinerary({ saved: { startTz: 'America/Chicago', endTz: 'America/New_York' } });
  check('18:00 → 21:11 as before', r.it.startTime === '18:00' && r.it.endTime === '21:11',
        r.it.startTime + '–' + r.it.endTime);
  check('…same zones', r.meta.startTz === 'America/Chicago' && r.meta.endTz === 'America/New_York',
        JSON.stringify(r.meta));
}

console.log('\nan airport we cannot place keeps the event\'s zone for that end');
{
  const r = itinerary({ unknown: ['DCA'] });
  check('the departure still moves to ORD\'s zone', r.it.startTime === '18:00', r.it.startTime);
  check('…the arrival stays in the saved zone', r.it.endTime === '21:11', r.it.endTime);
  const none = itinerary({ unknown: ['ORD', 'DCA'] });
  check('neither placed: the saved zone throughout', none.it.startTime === '19:00' &&
        none.meta.startTz === 'America/New_York', none.it.startTime + ' ' + JSON.stringify(none.meta));
}

console.log('\nonly flights, and only on the timezone pass');
{
  const notFlight = itinerary({ type: 'dining', title: 'Dinner ORD DCA' });
  check('a non-flight keeps its saved zone', notFlight.it.startTime === '19:00', notFlight.it.startTime);
  check('…with no airport lookup', notFlight.lookups.length === 0, JSON.stringify(notFlight.lookups));
  const quick = itinerary({ opts: { skipEventTz: true } });
  check('skipEventTz makes no airport lookups', quick.lookups.length === 0, JSON.stringify(quick.lookups));
}

// ============ the insights, on what the itinerary now returns ==============

function insights(row, airportGapOk) {
  const ctx = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, isFinite, isNaN, parseInt, parseFloat, Error,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    getConfigValues: () => ({}),
    fetchTracked_: (svc, url) => {
      const code = String(url).split('/').pop();
      const z = airportGapOk ? AIRPORT_TZ[code] : null;
      return { getResponseCode: () => (z ? 200 : 404),
               getContentText: () => JSON.stringify({ data: { attributes: { timezone: z } } }) };
    },
    travelAirportGeo_: () => null,
    haversineMiles_: () => 594,
    callClaudeJson_: () => ({ pre_trip_tip: 'x', arrival_tip: 'y', daynight_pct_day: 10 }),
  };
  vm.createContext(ctx);
  vm.runInContext(['airportTz_', 'tzOffsetHoursOn_', 'tzOffsetLabel_', 'haulCategoryFor_',
                   'travelTo12Hour_', 'buildTravelFlightInsightsData_'].map(n => extractFn(TDB, n)).join('\n'), ctx);
  ctx.__items = [row];
  return vm.runInContext('buildTravelFlightInsightsData_(__items, "Home")', ctx);
}

console.log('\nthe email\'s "Useful to know"');
{
  const r = itinerary({});
  const row = [r.it.id, r.it.tripKey, 'flight', r.it.title, r.it.date, r.it.startTime, r.it.endTime,
               r.it.location, '', r.it.metadata];
  const ins = insights(row, true);
  check('ORD → DCA is +1h, not the same timezone', ins.tz_offset_hours === 1 && ins.tz_offset_label === '+1h',
        ins.tz_offset_hours + ' / ' + ins.tz_offset_label);
  check('it leaves 6:00 PM (ORD)', ins.dep_local === '6:00 PM (ORD)', ins.dep_local);
  check('…and lands 9:11 PM (DCA)', ins.arr_local === '9:11 PM (DCA)', ins.arr_local);

  // A row still carrying the old saved-zone metadata (a sheet-entered flight,
  // or a cached itinerary): the airports decide the offset all the same.
  const stale = ['S-1', 'k', 'flight', 'UA1369', '2026-10-28', '19:00', '21:11', 'ORD', '',
                 JSON.stringify({ origin: 'ORD', dest: 'DCA', startTz: 'America/New_York' })];
  const ins2 = insights(stale, true);
  check('an event-zone-only row still gets the airports\' offset', ins2.tz_offset_label === '+1h',
        ins2.tz_offset_label);
  const ins3 = insights(stale, false);
  check('with no airport zone at all, the saved zone is the fallback', ins3.tz_offset_label === 'same timezone',
        ins3.tz_offset_label);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
