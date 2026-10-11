// One nightly run scanned every calendar FOUR times.
//
// getUpcomingEvents() measured 12.6s on its own in the morning timings, and four
// nightly steps called it with no argument — the collect step (Code.js),
// buildCalendarMetrics_ (Summaries.js), the pattern snapshot (PatternRecognition.js)
// and runExplorer_ (Reminders.js). Same window, same work, four times: ~38s of pure
// repetition inside the run the six-minute ceiling has already killed once.
//
// Each scan also made TWO API passes per calendar. The second one — the advanced
// service, for per-event timezones — throws for every calendar on this project because
// the Google Calendar API is not enabled, and the only trace was a Logger.log line. So
// it burned 44 failed round trips a night AND the consequence (every event falling back
// to the script timezone) never reached the morning banner.
//
// Everything here is asserted on COST as well as output. An output-only test passes
// just as well on the version that scans four times; the counters are the point.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const CAL  = fs.readFileSync(ROOT + '/Calendar.js', 'utf8');
const AH   = fs.readFileSync(ROOT + '/ApiHealth.js', 'utf8');
const CODE = fs.readFileSync(ROOT + '/Code.js', 'utf8');
const SUM  = fs.readFileSync(ROOT + '/Summaries.js', 'utf8');
const PR   = fs.readFileSync(ROOT + '/PatternRecognition.js', 'utf8');
const REM  = fs.readFileSync(ROOT + '/Reminders.js', 'utf8');
const WX   = fs.readFileSync(ROOT + '/Weather.js', 'utf8');
const CHAT = fs.readFileSync(ROOT + '/Chat.js', 'utf8');
const WP   = fs.readFileSync(ROOT + '/WeekendPlanner.js', 'utf8');
const TB   = fs.readFileSync(ROOT + '/TestBench.js', 'utf8');

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

// ============ the wording list ==============================================
//
// Driven by message strings Google actually produces, never by a regex over
// googleApiNotEnabled_'s own source. A source regex pins the spelling without
// checking it against anything, which is exactly how the 403 the map diagnostic
// exists to name came out as "unrecognised failure" on 10 Oct.
console.log('googleApiNotEnabled_ reads Google’s own words');
{
  const ctx = { String };
  vm.createContext(ctx);
  vm.runInContext(extractFn(AH, 'googleApiNotEnabled_'), ctx);
  const ne = s => vm.runInContext('googleApiNotEnabled_(' + JSON.stringify(s) + ')', ctx);

  // The message the Calendar advanced service throws on this project.
  check('the Calendar advanced service’s message reads as NOT ENABLED',
        ne('API call to calendar.events.list failed with error: Google Calendar API has ' +
           'not been used in project 402807757311 before or it is disabled. Enable it by ' +
           'visiting https://console.developers.google.com/apis/api/calendar-json.googleapis.com/' +
           'overview?project=402807757311 then retry.'),
        'this is the message behind 11 failures a scan, four scans a night');
  check('…and the Maps Static body that was misclassified',
        ne('The Google Maps Platform server rejected your request. This API is not ' +
           'activated on your API project.'));
  check('…and the older Maps wording',
        ne('This API project is not authorized to use this API.'));
  check('…and the generic reason code',
        ne('{"error":{"errors":[{"reason":"accessNotConfigured"}]}}'),
        'accessNotConfigured is the same fault with the same one-click fix');

  check('a transient server error is NOT read as not-enabled',
        !ne('Internal error encountered. Please try again.'),
        'treating a blip as "the API is off" would skip the other ten calendars');
  check('a rate limit is not either', !ne('Calendar usage limits exceeded.'));
  // The deliberate non-match. 'is disabled' alone appears in faults whose remedy is
  // not "enable the API", and naming the wrong remedy is worse than naming none.
  check('a disabled CALENDAR is not reported as a disabled API',
        !ne('The calendar you are trying to access is disabled.'),
        'a bare "is disabled" matcher would send you to the wrong settings page');
  check('an empty message is not a verdict', !ne('') && !ne(null) && !ne(undefined));
}

// ============ the scan, run for real ========================================

function fakeFormatDate(d, tz, pat) {
  const D = new Date(d), p2 = n => String(n).padStart(2, '0');
  const ymd = D.getUTCFullYear() + '-' + p2(D.getUTCMonth() + 1) + '-' + p2(D.getUTCDate());
  if (pat === 'yyyy-MM-dd') return ymd;
  // The timezone is echoed into the string on purpose: it is how a test tells a
  // per-event timezone from the script-timezone fallback.
  if (pat === 'yyyy-MM-dd HH:mm z') {
    return ymd + ' ' + p2(D.getUTCHours()) + ':' + p2(D.getUTCMinutes()) + ' ' + tz;
  }
  throw new Error('formatDate: unhandled pattern ' + pat);
}

/**
 * The REAL getUpcomingEvents and getUpcomingEventsCached_ in a vm, over a fake
 * CalendarApp and advanced service that COUNT every call.
 *
 * opts.listBehaviour(calIndex) → 'ok' | 'notEnabled' | 'transient'
 */
function harness(opts) {
  opts = opts || {};
  const nCals = opts.nCals === undefined ? 3 : opts.nCals;
  const calls = { getAllCalendars: 0, getEvents: [], list: [], health: [] };
  const logs  = [];

  const ev = (calIdx, i) => {
    const id = 'ev-' + calIdx + '-' + i;
    const start = new Date(Date.UTC(2026, 9, 12, 9 + i, 0, 0));
    const end   = new Date(Date.UTC(2026, 9, 12, 10 + i, 0, 0));
    return {
      getId:          () => id,
      getTitle:       () => 'Event ' + calIdx + '-' + i,
      getLocation:    () => '',
      getStartTime:   () => start,
      getEndTime:     () => end,
      isAllDayEvent:  () => false,
      getMyStatus:    () => 'YES',
      getColor:       () => '',
    };
  };

  const calendars = [];
  for (let c = 0; c < nCals; c++) {
    const id = 'cal' + c + '@group';
    calendars.push({
      getName: () => 'Calendar ' + c,
      getId:   () => id,
      getEvents(a, b) { calls.getEvents.push(id); return [ev(c, 0), ev(c, 1)]; },
    });
  }

  const ctx = {
    console, Date, Math, String, Number, Object, Array, JSON,
    Logger: { log: m => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate: fakeFormatDate },
    CONFIG: { CALENDAR_DAYS_AHEAD: 7 },
    getConfigValues: () => opts.config || {},
    recordApiHealth_: (source, ok, detail, code) => calls.health.push({ source, ok, detail, code }),
    CalendarApp: {
      getAllCalendars() {
        calls.getAllCalendars++;
        if (opts.allCalendarsThrows) throw new Error('calendar service unavailable');
        return calendars.slice(0, opts.visible === undefined ? nCals : opts.visible);
      },
      GuestStatus: { YES: 'YES', NO: 'NO', MAYBE: 'MAYBE', INVITED: 'INVITED', OWNER: 'OWNER' },
    },
    Calendar: { Events: { list(calId, params) {
      calls.list.push(calId);
      const idx = calendars.findIndex(c => c.getId() === calId);
      const mode = opts.listBehaviour ? opts.listBehaviour(idx) : 'ok';
      if (mode === 'notEnabled') {
        throw new Error('API call to calendar.events.list failed with error: Google ' +
          'Calendar API has not been used in project 402807757311 before or it is disabled.');
      }
      if (mode === 'transient') throw new Error('Internal error encountered. Please try again.');
      return { items: [
        { id: 'ev-' + idx + '-0', start: { timeZone: 'Europe/Rome' }, end: { timeZone: 'Europe/Rome' } },
      ] };
    } } },
    _calls: calls, _logs: logs,
  };

  vm.createContext(ctx);
  // EVENT_COLOR_NAMES is a file-level const the scan reads; lifted from source rather
  // than restated, so a renamed colour cannot pass here and fail in Apps Script.
  vm.runInContext(CAL.slice(CAL.indexOf('const EVENT_COLOR_NAMES'),
                            CAL.indexOf('};', CAL.indexOf('const EVENT_COLOR_NAMES')) + 2), ctx);
  vm.runInContext('var _upcomingEventsCache_ = {}; var _calendarAdvancedUnavailable_ = false;', ctx);
  [extractFn(AH,  'googleApiNotEnabled_'),
   extractFn(CAL, 'getUpcomingEvents'),
   extractFn(CAL, 'getUpcomingEventsCached_'),
   extractFn(CAL, 'invalidateUpcomingEvents_'),
   extractFn(CAL, 'invalidateCalendarAdvanced_')].forEach(s => vm.runInContext(s, ctx));
  return ctx;
}
const cached = (c, arg) => vm.runInContext('getUpcomingEventsCached_(' +
  (arg === undefined ? '' : arg) + ')', c);

console.log('\nThe memo: one scan per execution');
{
  const c = harness({});
  const a = cached(c);
  check('the first call scans', c._calls.getAllCalendars === 1 && a.length === 6,
        c._calls.getAllCalendars + ' scan(s), ' + a.length + ' event(s)');
  const b = cached(c);
  check('…and the second does NOT', c._calls.getAllCalendars === 1,
        c._calls.getAllCalendars + ' scans — this is the ~12.6s that four nightly steps ' +
        'each used to pay');
  check('…while still returning the same events', b.length === 6 && b[0].title === a[0].title);
  const d = cached(c); const e = cached(c);
  check('…however many consumers ask', c._calls.getAllCalendars === 1 && d.length === 6 && e.length === 6);

  // The per-calendar work, not just the calendar list: a memo that re-ran getEvents
  // would save nothing worth having.
  check('no calendar is re-read either', c._calls.getEvents.length === 3,
        JSON.stringify(c._calls.getEvents));
}

console.log('\nThe memo hands out copies');
{
  // Both paths out of the memo have to copy, and they are different lines: the call that
  // FILLS the cache returns the array it just cached, and every call after that returns
  // the cached one. A copy on only one of them still lets one consumer corrupt the rest.
  const c = harness({});
  const filling = cached(c);
  filling.sort(() => -1);      // a consumer reordering in place
  filling.length = 1;          // …and truncating
  check('the consumer that filled the cache cannot shrink what it cached',
        cached(c).length === 6,
        'the first call returns the array it just stored');

  const c2 = harness({});
  cached(c2);                       // fill
  const fromCache = cached(c2);     // served from the memo
  fromCache.length = 1;
  check('…nor can a consumer served FROM the cache', cached(c2).length === 6,
        'the array is shared between four consumers');
  check('…and the scan still did not repeat',
        c._calls.getAllCalendars === 1 && c2._calls.getAllCalendars === 1);
}

console.log('\nAn empty result is never cached');
{
  // A scan that FAILED returns [] from getUpcomingEvents' own catch, which is
  // indistinguishable from an empty window. Caching it would let one failure poison
  // every later consumer in the execution.
  const c = harness({ allCalendarsThrows: true });
  const a = cached(c);
  check('a failed scan returns empty', Array.isArray(a) && a.length === 0);
  cached(c);
  check('…and is retried rather than cached', c._calls.getAllCalendars === 2,
        c._calls.getAllCalendars + ' attempt(s) — a cached [] would make one failure ' +
        'look like an empty calendar for the rest of the night');

  const c2 = harness({ visible: 0 });
  cached(c2); cached(c2);
  check('a genuinely empty window re-scans too (the accepted cost)',
        c2._calls.getAllCalendars === 2);
}

console.log('\nEach window is its own entry');
{
  const c = harness({});
  cached(c);            // the default, 7
  cached(c, 21);
  check('a 21-day request is not served from the 7-day scan',
        c._calls.getAllCalendars === 2,
        'the windows differ, so the longer one has to be fetched');
  cached(c, 21);
  check('…but repeats within that window are', c._calls.getAllCalendars === 2);
  cached(c, 7);
  check('…and the explicit default hits the same entry as no argument',
        c._calls.getAllCalendars === 2,
        'the key is the RESOLVED day count, so getUpcomingEventsCached_(7) and ' +
        'getUpcomingEventsCached_() must not scan twice');
}

console.log('\nThe advanced service is asked once, not once per calendar');
{
  // Eleven calendars, as on this account, and the API switched off.
  const c = harness({ nCals: 11, listBehaviour: () => 'notEnabled' });
  const events = cached(c);
  check('exactly ONE advanced-service call is made', c._calls.list.length === 1,
        c._calls.list.length + ' call(s) — one per calendar, four times a night, was ' +
        '44 failed round trips');
  check('…and every calendar’s events still come back', events.length === 22,
        events.length + ' event(s) across 11 calendars');
  check('…on the script timezone', /America\/New_York/.test(events[0].start),
        events[0].start + ' — the fallback Phase 3 already had');
  check('the log says the service is off, and that it is being skipped',
        c._logs.some(l => /NOT ENABLED/.test(l) && /rest of this execution/.test(l)),
        JSON.stringify(c._logs.slice(0, 3)));
  check('it names the fix', c._logs.some(l => /Google Calendar API/.test(l) && /enabled/.test(l)));

  const h = c._calls.health;
  check('ONE health record for the scan, not one per calendar', h.length === 1,
        h.length + ' record(s) — recordApiHealth_ writes Script Properties and can email');
  check('…recorded as a failure, so the banner can say so',
        h[0] && h[0].source === 'googlecalendar-advanced' && h[0].ok === false,
        JSON.stringify(h[0]) + ' — nothing recorded this at all before, which is why a ' +
        'whole night of timezone fallbacks was invisible');
  check('…carrying Google’s own message',
        /has not been used in project/.test(h[0] && h[0].detail || ''), h[0] && h[0].detail);

  // A second scan in the same execution (a 21-day window, say) must not re-probe and
  // must not re-record: a second failure record would inflate consecutiveFailures and
  // overwrite the real message with an empty one.
  cached(c, 21);
  check('a second scan in the same execution does not probe again', c._calls.list.length === 1,
        c._calls.list.length + ' call(s)');
  check('…nor record a second failure', c._calls.health.length === 1,
        c._calls.health.length + ' record(s)');
}

console.log('\nA transient failure does not silence the other calendars');
{
  // The distinction the short-circuit rests on. One calendar erroring is not Google
  // saying the API is off, and must not skip the other ten.
  const c = harness({ nCals: 11, listBehaviour: i => (i === 0 ? 'transient' : 'ok') });
  const events = cached(c);
  check('all eleven are still asked', c._calls.list.length === 11,
        c._calls.list.length + ' call(s) — one flaky calendar must not end the pass');
  check('the ten that answered use their per-event timezone',
        /Europe\/Rome/.test(events.find(e => e.title === 'Event 1-0').start),
        events.find(e => e.title === 'Event 1-0').start);
  check('…and the one that failed falls back',
        /America\/New_York/.test(events.find(e => e.title === 'Event 0-0').start),
        events.find(e => e.title === 'Event 0-0').start);
  check('the scan is recorded as healthy, since calls did succeed',
        c._calls.health.length === 1 && c._calls.health[0].ok === true,
        JSON.stringify(c._calls.health) + ' — a daily banner line for one flaky calendar ' +
        'is the noise the 429 work spent a commit removing');
}

console.log('\nEvery calendar failing for an unknown reason is still a failure');
{
  const c = harness({ nCals: 3, listBehaviour: () => 'transient' });
  cached(c);
  check('all three are asked', c._calls.list.length === 3);
  check('…and the source is recorded as down',
        c._calls.health.length === 1 && c._calls.health[0].ok === false,
        JSON.stringify(c._calls.health));
}

console.log('\nNo calendars, nothing to report');
{
  const c = harness({ nCals: 3, visible: 0 });
  cached(c);
  check('an account with no visible calendars records no verdict',
        c._calls.health.length === 0,
        'there was no call to be healthy or unhealthy about');
}

console.log('\nThe invalidators');
{
  const c = harness({ nCals: 2, listBehaviour: () => 'notEnabled' });
  cached(c);
  check('warm', c._calls.getAllCalendars === 1 && c._calls.list.length === 1);
  vm.runInContext('invalidateUpcomingEvents_()', c);
  cached(c);
  check('dropping the memo forces a cold scan', c._calls.getAllCalendars === 2);
  check('…but the advanced service stays skipped', c._calls.list.length === 1,
        'it is off for the whole execution, not for one scan');
  vm.runInContext('invalidateCalendarAdvanced_()', c);
  vm.runInContext('invalidateUpcomingEvents_()', c);
  cached(c);
  check('re-arming the probe asks again', c._calls.list.length === 2,
        'TestBench has to be able to report what is true now');
}

// ============ who opted in =================================================
//
// The memo is opt-in, so the saving is only real if the four duplicate consumers
// actually use it — and the correctness rule is only real if the live-read callers
// do not. Counting call forms, which keeps this file out of the browser group.
console.log('\nThe four duplicate consumers read the memo');
{
  const bodyOf = (src, fn) => extractFn(src, fn);
  const LIVE   = 'getUpcomingEvents(';
  const MEMO   = 'getUpcomingEventsCached_(';
  const opted  = [
    ['the nightly collect step', bodyOf(CODE, 'nightlyRun')],
    ['buildCalendarMetrics_',    bodyOf(SUM,  'buildCalendarMetrics_')],
    ['the pattern snapshot',     bodyOf(PR,   'buildCrossDomainSnapshot_')],
    ['runExplorer_',             bodyOf(REM,  'runExplorer_')],
  ];
  // 'getUpcomingEvents(' is not a substring of 'getUpcomingEventsCached_(' — the memo's
  // name has a 'C' where the live form has its paren — so the two counts are already
  // independent and must not be netted against each other.
  const counts = body => ({
    memo: body.split(MEMO).length - 1,
    live: body.split(LIVE).length - 1,
  });
  opted.forEach(([name, body]) => {
    const n = counts(body);
    check(name + ' calls the memo, and never the live scan', n.memo === 1 && n.live === 0,
          'memo: ' + n.memo + ', live: ' + n.live);
  });

  // THE OTHER HALF OF THE RULE. getUpcomingEvents keeps its contract — always live —
  // because VERA creates and deletes calendar events in about fifteen places and a
  // caller that reads back its own write must see it.
  const liveStays = [
    ['the hourly calendar-gap nudge', bodyOf(REM,  'checkCalendarOpportunity_')],
    ['the weather ticker check',      bodyOf(WX,   'testWeather')],
    ['the weekend planner',           bodyOf(WP,   'runWeekendPlanner_')],
  ];
  liveStays.forEach(([name, body]) => {
    const n = counts(body);
    check(name + ' still reads live', n.live >= 1 && n.memo === 0,
          'memo: ' + n.memo + ', live: ' + n.live + ' — a stale read here would be a wrong ' +
          'answer, not a slow one');
  });
  check('Chat reads live too', CHAT.indexOf('getUpcomingEventsCached_') === -1,
        'a chat answer about the calendar must not be served from a memo filled before ' +
        'the user’s own edit');
}

console.log('\nTestBench can show both numbers');
{
  const body = extractFn(TB, 'tbCalendarAccess');
  check('it times a cold scan against a warm one',
        /invalidateUpcomingEvents_\(\)/.test(body) &&
        (body.split('getUpcomingEventsCached_(').length - 1) === 2, body.length + ' chars');
  check('…and reports the advanced service’s verdict',
        /_calendarAdvancedUnavailable_/.test(body) && /NOT ENABLED/.test(body));
  check('…after re-arming the probe, so the verdict is current',
        /invalidateCalendarAdvanced_\(\)/.test(body));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
