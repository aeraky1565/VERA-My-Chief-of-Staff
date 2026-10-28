// Settings › Test: the travel-day email, sent on demand from the dashboard.
//
// Three things this pins:
//  1. The trip ranges come from ONE helper, travelDayRanges_, shared by the
//     6 AM run and the Test tab, so a test sees exactly what the real one will.
//  2. sendTravelDayBriefing_ takes the day it is about. It used to read the
//     real clock for its label, its decisions and tomorrow's flights, and its
//     return-day check compared against a `today` that was never defined in
//     that function: the ReferenceError was swallowed, so "Tomorrow's flights"
//     never appeared on any email.
//  3. A test send is marked TEST, goes to you unless you asked for everyone,
//     is always an email, and never touches the once-a-day latch.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const TDB  = fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8');
const WEB  = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');

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

// A clock that says it is FIXED, so "today" is the same on every run.
const FIXED = Date.parse('2026-10-28T14:00:00Z');
class FakeDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
const Utilities = { formatDate: (d, tz, f) => {
  const iso = new Date(d.getTime()).toISOString();
  if (f === 'yyyy-MM-dd') return iso.slice(0, 10);
  if (f === 'HH:mm') return iso.slice(11, 16);
  if (f === 'EEEE, MMMM d') return DAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  throw new Error('unexpected format ' + f);
}};

// Invented trip: rows Oct 21, 23, 24, a stay to Oct 28, flights on Oct 28 and 29.
const SHEET = [
  ['I-1', '2026-10-21|Lake Trip', 'arranged_stay', 'Staying with friends', '2026-10-21', '', '', '', '', '{"checkoutDate":"2026-10-28"}'],
  ['I-2', '2026-10-21|Lake Trip', 'dining', 'Drinks', '2026-10-23', '18:00', '', '', '', ''],
  ['I-3', '2026-10-21|Lake Trip', 'dining', 'Brunch', '2026-10-24', '12:30', '', '', '', ''],
  ['I-4', '2026-10-21|Lake Trip', 'flight', 'Connection home', '2026-10-29', '07:10', '09:00', 'ORD', '', ''],
  ['I-5', '2026-11-06|Island Trip', 'dining', 'Dinner', '2026-11-06', '20:00', '', '', '', ''],
  ['I-6', '2026-09-24|Old Trip', 'hotel', 'Beach stay', '2026-09-24', '', '', '', '', ''],
];

// ============ the shared range helper ======================================

function rangesCtx() {
  const ctx = { String, Object, JSON, RegExp, Date: FakeDate, Utilities };
  vm.createContext(ctx);
  vm.runInContext(['travelRowDate_', 'travelTripKey_', 'travelDayRanges_'].map(n => extractFn(TDB, n)).join('\n'), ctx);
  return ctx;
}

console.log('\none helper decides which days a trip covers');
{
  const ctx = rangesCtx();
  const r = (rows, cal) => { ctx.__a = rows; ctx.__b = cal; return vm.runInContext('travelDayRanges_(__a, __b, "UTC")', ctx); };
  const sheetOnly = r(SHEET.slice(0, 3), []);
  check('sheet rows run to the stay\'s checkout', sheetOnly['2026-10-21|Lake Trip'].max === '2026-10-28',
        JSON.stringify(sheetOnly));
  check('…from the first row', sheetOnly['2026-10-21|Lake Trip'].min === '2026-10-21');
  const withCal = r(SHEET.slice(1, 3), [{ label: 'Lake Trip', startDate: '2026-10-21', endDate: '2026-10-28' }]);
  check('the calendar trip widens a sheet trip to its end', withCal['2026-10-21|Lake Trip'].max === '2026-10-28',
        JSON.stringify(withCal));
  const fam = r([], [{ label: 'Cousins', startDate: '2026-10-01', endDate: '2026-10-30', isExtendedFamily: true }]);
  check('extended-family trips are left out', !Object.keys(fam).length, JSON.stringify(fam));
  const calOnly = r([], [{ label: 'Work', startDate: '2026-11-02', endDate: '2026-11-04' }]);
  check('a calendar-only trip gets its own range', calOnly['2026-11-02|Work'] &&
        calOnly['2026-11-02|Work'].max === '2026-11-04', JSON.stringify(calOnly));
  check('the scheduled run uses the helper',
        /travelDayRanges_\(data, calTrips, tz\)/.test(extractFn(TDB, 'checkAndSendTravelDayBriefings_')));
  check('…and passes the day and the trip\'s last day to the send',
        /sendTravelDayBriefing_\(tripKey, _rows, \{ date: today, lastDay: _range\.max \}\)/
          .test(extractFn(TDB, 'checkAndSendTravelDayBriefings_')));
}

console.log('\na renamed trip is one trip, under its current name');
{
  // An invented rename: rows written before it still carry the old key, and
  // the registry knows it as an alias of the current one.
  const ALIAS = { '2026-10-23|Maybe Lake Trip': '2026-10-21|Lake Trip' };
  const rows = [
    ['O-1', '2026-10-23|Maybe Lake Trip', 'arranged_stay', 'Old stay', '2026-10-23', '', '', '', '', '{"checkoutDate":"2026-10-30"}'],
    ['N-1', '2026-10-21|Lake Trip', 'dining', 'Drinks', '2026-10-22', '18:00', '', '', '', ''],
    ['X-1', '2026-12-01|Unrelated', 'dining', 'Lunch', '2026-12-01', '12:00', '', '', '', ''],
  ];
  const ctx = { String, Object, JSON, RegExp, Date: FakeDate, Utilities,
                canonicalTripKey_: k => ALIAS[k] || k };
  vm.createContext(ctx);
  vm.runInContext(['travelRowDate_', 'travelTripKey_', 'travelDayRanges_'].map(n => extractFn(TDB, n)).join('\n'), ctx);
  ctx.__a = rows;
  const r = vm.runInContext('travelDayRanges_(__a, [], "UTC")', ctx);
  check('the old key is not a trip of its own', !r['2026-10-23|Maybe Lake Trip'], JSON.stringify(r));
  check('…its rows widen the current trip', r['2026-10-21|Lake Trip'] &&
        r['2026-10-21|Lake Trip'].min === '2026-10-22' && r['2026-10-21|Lake Trip'].max === '2026-10-30',
        JSON.stringify(r));
  check('an unknown key is left as it is', !!r['2026-12-01|Unrelated'], JSON.stringify(r));

  const bare = { String, Object, JSON, RegExp, Date: FakeDate, Utilities };
  vm.createContext(bare);
  vm.runInContext(['travelRowDate_', 'travelTripKey_', 'travelDayRanges_'].map(n => extractFn(TDB, n)).join('\n'), bare);
  bare.__a = rows;
  check('with no registry, keys are kept (nothing breaks)',
        !!vm.runInContext('travelDayRanges_(__a, [], "UTC")', bare)['2026-10-23|Maybe Lake Trip']);

  // The morning run, on a day the old key's row falls on.
  const sends = [];
  const run = { String, Array, Number, Object, Date: FakeDate, JSON, Math, RegExp, isFinite, Error, Utilities,
    Logger: { log: () => {} }, Session: { getScriptTimeZone: () => 'UTC' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
    TABS: { ITINERARY: 'Itinerary' }, ITINERARY_HEADERS: new Array(10).fill('x'),
    getConfigValues: () => ({}), readPTOConfig_: () => ({}), veraLog_: () => {},
    canonicalTripKey_: k => ALIAS[k] || k,
    getSpreadsheet: () => ({ getSheetByName: () => ({ getLastRow: () => rows.length + 1,
      getRange: () => ({ getValues: () => rows.map(x => x.slice()) }) }) }),
    getUpcomingTravel_: () => [{ label: 'Lake Trip', startDate: '2026-10-21', endDate: '2026-10-28' }],
    fetchTripDayItems_: () => [['x']],
    sendTravelDayBriefing_: k => { sends.push(k); },
  };
  vm.createContext(run);
  vm.runInContext(['travelRowDate_', 'travelTripKey_', 'travelDayRanges_', 'checkAndSendTravelDayBriefings_']
    .map(n => extractFn(TDB, n)).join('\n'), run);
  run.__o = { dateOverride: '2026-10-23' };
  vm.runInContext('checkAndSendTravelDayBriefings_(__o)', run);
  check('the morning run sends one email, under the current name',
        JSON.stringify(sends) === '["2026-10-21|Lake Trip"]', JSON.stringify(sends));
}

// ============ the send, for a chosen day ===================================

function runSend(items, opts, o) {
  o = o || {};
  const out = { emails: [], slack: [], decisions: [], sections: null, props: {}, html: null };
  const stub = () => '';
  const ctx = {
    String, Array, Number, Object, JSON, Math, RegExp, isFinite, Error, Date: FakeDate, Utilities,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    CONFIG: { MORNING_NUDGE_EMAIL: 'me@example.test' },
    TABS: { ITINERARY: 'Itinerary' },
    ITINERARY_HEADERS: new Array(10).fill('x'),
    PropertiesService: { getScriptProperties: () => ({
      getProperty: () => '', setProperty: (k, v) => { out.props[k] = v; } }) },
    isNotifEnabled_: () => o.enabled !== false,
    getNotifChannel_: () => o.channel || 'email',
    getConfigValues: () => ({}),
    collapseItineraryRows_: (rows, key, day) => { out.collapseDay = day; return rows; },
    buildTravelFlightInsightsData_: () => ({}),
    getTripToneMode_: () => 'default', tripBriefingFor_: () => '',
    buildTravelDayNarrativeData_: () => null,
    travelDayAirports_: () => [], getLoungePerkPrograms_: () => [], emptyLoungeData_: () => ({}),
    getSpreadsheet: () => ({ getSheetByName: () => ({ getLastRow: () => SHEET.length + 1,
      getRange: () => ({ getValues: () => SHEET.map(r => r.slice()) }) }) }),
    tripKeysFor_: k => [k],
    tripRowMatches_: (cell, keys) => keys.indexOf(String(cell).trim()) !== -1,
    enrichTravelItems_: x => x, buildTravelDirectionsUrl_: stub,
    openDecisionsForTrip_: function() { out.decisions.push([].slice.call(arguments, 1)); return []; },
    buildTravelNarrativeSection_: stub, buildTravelFlightInsightsSection_: stub, buildTravelLoungeSection_: stub,
    buildOpenDecisionsSection_: stub, buildTravelScheduleSection_: stub, buildTravelMapSection_: stub,
    buildTravelTomorrowSection_: stub,
    buildTravelDayEmailHtml_: (label, date, sections) => { out.sections = sections; out.dateLabel = date; return '<p/>'; },
    buildTravelDayPlainText_: stub,
    getTravelDayRecipients_: () => ['me@example.test', 'partner@example.test'],
    sendVeraEmail_: (to, subject) => { out.emails.push({ to, subject }); },
    sendSlack_: (ch, text) => { out.slack.push(ch); },
  };
  vm.createContext(ctx);
  vm.runInContext(['travelRowDate_', 'travelTripKey_', 'travelDayRanges_', 'sendTravelDayBriefing_']
    .map(n => extractFn(TDB, n)).join('\n'), ctx);
  ctx.__i = items; ctx.__o = opts;
  out.ret = vm.runInContext('sendTravelDayBriefing_("2026-10-21|Lake Trip", __i, __o)', ctx);
  return out;
}
const sec = (out, id) => (out.sections || []).filter(s => s.id === id)[0];
const ITEMS = [['C-1', '2026-10-21|Lake Trip', 'flight', 'Flight home', '2026-10-28', '19:00', '21:11', 'ORD', '', '']];

console.log('\nthe email is about the day it is asked about');
{
  const r = runSend(ITEMS, { date: '2026-10-24' });
  check('the subject carries that day, not the real one', r.emails.length === 1 &&
        /Saturday, October 24$/.test(r.emails[0].subject), JSON.stringify(r.emails));
  check('…and so does the body', r.dateLabel === 'Saturday, October 24', r.dateLabel);
  check('competing holds are collapsed for that day', r.collapseDay === '2026-10-24', r.collapseDay);
  check('open decisions are for that day', r.decisions.length === 1 &&
        r.decisions[0].every(d => d === '2026-10-24'), JSON.stringify(r.decisions));

  const now = runSend(ITEMS, undefined);
  check('with no day given it is today', /Wednesday, October 28$/.test(now.emails[0].subject),
        JSON.stringify(now.emails));
}

console.log('\ntomorrow\'s flights appear at all (the undefined `today`)');
{
  const r = runSend(ITEMS, { date: '2026-10-28' });
  const t = sec(r, 'tomorrow_flights');
  check('the day before a flight lists it', t && t.data.length === 1 && t.data[0][3] === 'Connection home',
        JSON.stringify(t && t.data));
  const other = runSend(ITEMS, { date: '2026-10-24' });
  check('…and only the day before', sec(other, 'tomorrow_flights').data.length === 0,
        JSON.stringify(sec(other, 'tomorrow_flights').data));
}

console.log('\nthe last day of the trip is known');
{
  const ins = r => sec(r, 'flight_insights').data;
  check('the caller\'s last day wins', ins(runSend(ITEMS, { date: '2026-10-28', lastDay: '2026-10-28' })).isReturnDay === true);
  check('…not on another day', ins(runSend(ITEMS, { date: '2026-10-24', lastDay: '2026-10-28' })).isReturnDay === false);
  // Without one: the sheet's own range, checkouts included. The last ROW is
  // Oct 29 here, so Oct 24 (the last dinner) must not count.
  check('without one, the sheet\'s range decides', ins(runSend(ITEMS, { date: '2026-10-29' })).isReturnDay === true);
  check('…never the last dinner', ins(runSend(ITEMS, { date: '2026-10-24' })).isReturnDay === false);
}

console.log('\na test send');
{
  const me = runSend(ITEMS, { date: '2026-10-28', test: true });
  check('says TEST first', me.emails.length === 1 && /^TEST · ✈️ Travel Day — Lake Trip · /.test(me.emails[0].subject),
        JSON.stringify(me.emails));
  check('goes only to you by default', me.emails[0].to === 'me@example.test', me.emails[0].to);
  check('…and says who it went to', JSON.stringify(me.ret.to) === '["me@example.test"]', JSON.stringify(me.ret));
  check('…with the item count', me.ret.count === 1, JSON.stringify(me.ret));

  const all = runSend(ITEMS, { date: '2026-10-28', test: true, to: 'all' });
  check('"everyone" sends to the real list', all.emails[0].to === 'me@example.test,partner@example.test', all.emails[0].to);

  const slack = runSend(ITEMS, { date: '2026-10-28', test: true }, { channel: 'travel' });
  check('a test is an email even when the briefing goes to Slack',
        slack.emails.length === 1 && slack.slack.length === 0, JSON.stringify(slack));
  const realSlack = runSend(ITEMS, { date: '2026-10-28' }, { channel: 'travel' });
  check('…while the real one still goes to Slack', realSlack.slack.length === 1 && !realSlack.emails.length);

  const off = runSend(ITEMS, { date: '2026-10-28', test: true }, { enabled: false });
  check('a test sends even with the briefing switched off', off.emails.length === 1);
  const realOff = runSend(ITEMS, { date: '2026-10-28' }, { enabled: false });
  check('…while the real one does not', realOff.emails.length === 0 && realOff.ret === null);

  const real = runSend(ITEMS, { date: '2026-10-28' });
  check('the real one has no TEST', !/TEST/.test(real.emails[0].subject), real.emails[0].subject);
  check('…and still goes to everyone', real.emails[0].to === 'me@example.test,partner@example.test');
  check('the send itself writes no latch', !Object.keys(me.props).some(k => /^TDB_SENT_/.test(k)),
        JSON.stringify(me.props));
}

// ============ the three dashboard routes ===================================

function webCtx(o) {
  o = o || {};
  const out = { sends: [], fetches: [], itin: [], props: {}, logs: [] };
  const ctx = {
    String, Array, Number, Object, JSON, Math, RegExp, isFinite, Error, Date: FakeDate, Utilities,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    TABS: { ITINERARY: 'Itinerary' },
    ITINERARY_HEADERS: new Array(10).fill('x'),
    PropertiesService: { getScriptProperties: () => ({
      getProperty: () => '', setProperty: (k, v) => { out.props[k] = v; } }) },
    getSpreadsheet: () => ({ getSheetByName: () => ({ getLastRow: () => SHEET.length + 1,
      getRange: () => ({ getValues: () => SHEET.map(r => r.slice()) }) }) }),
    readPTOConfig_: () => ({}),
    canonicalTripKey_: k => (o.alias || {})[k] || k,
    getUpcomingTravel_: () => o.cal || [{ label: 'Lake Trip', startDate: '2026-10-21', endDate: '2026-10-28' }],
    webGetItinerary_: e => { out.itin.push(e.parameter); return { ok: true, items: o.items || [] }; },
    fetchTripDayItems_: function() { out.fetches.push([].slice.call(arguments)); return [['row']]; },
    sendTravelDayBriefing_: (k, rows, opts) => { out.sends.push({ k, rows, opts });
      return { to: ['me@example.test'], subject: 'TEST · x', count: rows.length }; },
    veraLog_: function() { out.logs.push([].slice.call(arguments)); },
  };
  vm.createContext(ctx);
  vm.runInContext(['travelRowDate_', 'travelTripKey_', 'travelDayRanges_', 'travelTestRanges_', 'webTestTravelTrips_',
                   'travelTestTime_', 'webTestTravelTrip_', 'webTestTravelSend_']
    .map(n => extractFn(TDB, n)).join('\n'), ctx);
  ctx.__run = (expr, p) => { ctx.__e = { parameter: p || {} }; return vm.runInContext(expr, ctx); };
  return { ctx, out, run: ctx.__run };
}

console.log('\nthe trip list');
{
  const w = webCtx();
  const r = w.run('webTestTravelTrips_()');
  const labels = r.trips.map(t => t.label);
  check('trips on now or ahead, soonest first', JSON.stringify(labels) === '["Lake Trip","Island Trip"]',
        JSON.stringify(r.trips));
  check('…the past one left out', labels.indexOf('Old Trip') === -1);
  check('the trip on now is marked', r.trips[0].current === true && r.trips[1].current === false);
  check('…with its whole range', r.trips[0].start === '2026-10-21' && r.trips[0].end === '2026-10-29',
        JSON.stringify(r.trips[0]));
  check('today is sent along', r.today === '2026-10-28', r.today);

  const moved = webCtx({ cal: [{ label: 'Lake Trip', startDate: '2026-10-20', endDate: '2026-10-28' }] })
    .run('webTestTravelTrips_()');
  check('a trip under two keys shows once', moved.trips.filter(t => t.label === 'Lake Trip').length === 1,
        JSON.stringify(moved.trips));

  // The Island Trip's row renamed: the registry maps its old key onto a new name.
  const renamed = webCtx({ alias: { '2026-11-06|Island Trip': '2026-11-06|Island Getaway' },
    cal: [{ label: 'Lake Trip', startDate: '2026-10-21', endDate: '2026-10-28' },
          { label: 'Island Getaway', startDate: '2026-11-06', endDate: '2026-11-09' }] }).run('webTestTravelTrips_()');
  check('a renamed trip is listed once, under its current name',
        JSON.stringify(renamed.trips.map(t => t.label)) === '["Lake Trip","Island Getaway"]', JSON.stringify(renamed.trips));
}

console.log('\none trip, every day, with where each item came from');
{
  const items = [
    { date: '2026-10-28', startTime: '19:00', endTime: '21:11', title: 'Flight home', type: 'flight', source: 'calendar' },
    { date: '2026-10-23', startTime: '18:00', endTime: '', title: 'Drinks', type: 'dining', source: 'manual' },
    { date: '2026-10-23', startTime: '09:00', endTime: '', title: 'Coffee', type: 'coffee', source: 'manual' },
    { date: '2026-10-21', startTime: '', endTime: '', title: 'Staying with friends', type: 'arranged_stay', source: 'manual' },
  ];
  const w = webCtx({ items });
  const r = w.run('webTestTravelTrip_(__e)', { tripKey: '2026-10-21|Lake Trip' });
  check('one itinerary read, over the whole trip', w.out.itin.length === 1 &&
        w.out.itin[0].startDate === '2026-10-21' && w.out.itin[0].endDate === '2026-10-29',
        JSON.stringify(w.out.itin));
  check('a chip for every day, empty ones too', r.days.length === 9 && r.days[3].items.length === 0,
        JSON.stringify(r.days.map(d => d.date)));
  const d28 = r.days.filter(d => d.date === '2026-10-28')[0];
  check('a calendar item is tagged calendar', d28.items[0].source === 'calendar', JSON.stringify(d28));
  const d23 = r.days.filter(d => d.date === '2026-10-23')[0];
  check('a sheet item is tagged sheet', d23.items.every(i => i.source === 'sheet'), JSON.stringify(d23));
  check('a day\'s items are in time order', d23.items[0].title === 'Coffee', JSON.stringify(d23.items));
  check('times read as a span', d28.items[0].time === '19:00 – 21:11', d28.items[0].time);
  check('…or all day', r.days[0].items[0].time === 'all day', r.days[0].items[0].time);

  const gone = webCtx().run('webTestTravelTrip_(__e)', { tripKey: '2026-01-01|Nope' });
  check('an unknown trip says so', gone.ok === false && /no longer/.test(gone.error), JSON.stringify(gone));
}

console.log('\nsending a test');
{
  const w = webCtx();
  const r = w.run('webTestTravelSend_(__e)', { tripKey: '2026-10-21|Lake Trip', date: '2026-10-28', to: 'me' });
  check('it sends', r.ok === true && w.out.sends.length === 1, JSON.stringify(r));
  check('…through the same item fetch as the 6 AM run, for that day',
        JSON.stringify(w.out.fetches[0]) === '["2026-10-21|Lake Trip","2026-10-21","2026-10-29","2026-10-28"]',
        JSON.stringify(w.out.fetches));
  const o = w.out.sends[0].opts;
  check('…as a test, for that day, to you', o.test === true && o.date === '2026-10-28' && o.to === 'me' &&
        o.lastDay === '2026-10-29', JSON.stringify(o));
  check('…and never writes the latch', !Object.keys(w.out.props).length, JSON.stringify(w.out.props));
  check('…and reports who and what', JSON.stringify(r.to) === '["me@example.test"]' && r.subject === 'TEST · x');

  const all = webCtx();
  all.run('webTestTravelSend_(__e)', { tripKey: '2026-10-21|Lake Trip', date: '2026-10-28', to: 'all' });
  check('"everyone" is passed through', all.out.sends[0].opts.to === 'all');
  const odd = webCtx();
  odd.run('webTestTravelSend_(__e)', { tripKey: '2026-10-21|Lake Trip', date: '2026-10-28', to: 'bob@x' });
  check('anything else means you', odd.out.sends[0].opts.to === 'me');

  const out = webCtx().run('webTestTravelSend_(__e)', { tripKey: '2026-10-21|Lake Trip', date: '2026-11-03' });
  check('a day outside the trip is refused', out.ok === false && /outside/.test(out.error), JSON.stringify(out));
  const bad = webCtx().run('webTestTravelSend_(__e)', { tripKey: '2026-10-21|Lake Trip', date: 'tomorrow' });
  check('…and so is a non-date', bad.ok === false, JSON.stringify(bad));
}

console.log('\nthe routes are wired');
{
  check('test_travel_trips', /case 'test_travel_trips':\s*return jsonOut_\(webTestTravelTrips_\(\)\)/.test(WEB));
  check('test_travel_trip',  /case 'test_travel_trip':\s*return jsonOut_\(webTestTravelTrip_\(e\)\)/.test(WEB));
  check('test_travel_send',  /case 'test_travel_send':\s*return jsonOut_\(webTestTravelSend_\(e\)\)/.test(WEB));
  check('the old unrouted sheet-only sender is gone', !/function webSendTravelBriefing_\(/.test(TDB));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
