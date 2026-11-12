// Issue #237: every day of a trip gets a Travel Day email, and each one used to be
// written as if it were the day you fly out — "wheels up" on a cruise port day, a
// flight tip with no flight, the port looked up as "fly into the airport", a ship's
// restaurant found in another country, and a flight-data warning on a day with no
// flight. This pins what replaced that: the kind of day (departure, during, transit,
// return, with "day n of N"), where you sleep tonight (a cruise counts), where you
// are, and how the narrative prompt, the per-stop lookup, the header, the "not live"
// notice and the subject use them. Invented trip, places and ship.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const TDB  = fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8');

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

const HELPERS = ['travelDaysBetween_', 'travelDayKind_', 'travelStayTonight_', 'travelDayArea_',
  'travelDayHeading_', 'travelDayPromptLine_', 'travelDetailsContext_'];
function ctxWith(extra, names) {
  const ctx = Object.assign({ String, Array, Number, Object, JSON, Math, RegExp, Date, Logger: { log: () => {} } }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(HELPERS.concat(names || []).map(n => extractFn(TDB, n)).join('\n'), ctx);
  return ctx;
}
const call = (ctx, expr, vars) => { Object.assign(ctx, vars || {}); return vm.runInContext(expr, ctx); };

// Invented: a cruise, Nov 7 (fly out) to Nov 15 (fly home), aboard the "Island Ship" from Nov 8.
const FIRST = '2026-11-07', LAST = '2026-11-15';
const FLIGHT = ['I-1', 'k', 'flight', 'Flight out', FIRST, '07:00', '10:00', 'AAA', '', ''];
const PORT   = ['I-2', 'k', 'calendar', 'Port Town', '2026-11-12', '06:30', '13:30', 'Port Town, Island', '', ''];
const DINNER = ['I-3', 'k', 'dining', 'Dinner: Harbour Grill', '2026-11-12', '19:45', '20:45', '', '', ''];
const STAYS = [
  { type: 'hotel', title: 'Airport Inn', date: FIRST, metadata: '' },
  { type: 'cruise', title: 'Island Ship', date: '2026-11-08', metadata: '{"checkoutDate":"2026-11-15"}' },
  { type: 'dining', title: 'Not a stay', date: '2026-11-12', metadata: '' },
];

console.log('\nthe kind of day');
{
  const c = ctxWith();
  const k = (day, items, first, last) => call(c, 'travelDayKind_(__d, __f, __l, __i)', { __d: day, __f: first === undefined ? FIRST : first, __l: last === undefined ? LAST : last, __i: items || [] });
  const dep = k(FIRST, [FLIGHT]);
  check('the first day is departure, day 1 of 9', dep.kind === 'departure' && dep.n === 1 && dep.total === 9, JSON.stringify(dep));
  const mid = k('2026-11-12', [PORT, DINNER]);
  check('a port day in the middle is "during", day 6 of 9', mid.kind === 'during' && mid.n === 6 && mid.total === 9 && mid.hasFlight === false, JSON.stringify(mid));
  check('a middle day with a flight is transit', k('2026-11-12', [PORT, FLIGHT]).kind === 'transit');
  const ret = k(LAST, []);
  check('the last day is return, day 9 of 9', ret.kind === 'return' && ret.n === 9 && ret.total === 9, JSON.stringify(ret));
  check('a one-day trip is departure', k(FIRST, [], FIRST, FIRST).kind === 'departure');
  const unk = k('2026-11-12', [PORT], '', '');
  check('with no known range, a day without a flight is "during", with no count', unk.kind === 'during' && unk.n === null);
  check('…and a day with one is departure', k('2026-11-12', [FLIGHT], '', '').kind === 'departure');
  check('a day outside the range is not counted', k('2026-11-20', [PORT]).n === null);
}

console.log('\nwhere you sleep tonight, and where you are');
{
  const c = ctxWith();
  const s = day => call(c, 'travelStayTonight_(__s, __d)', { __s: STAYS, __d: day });
  check('the first night is the hotel', JSON.stringify(s(FIRST)) === JSON.stringify({ type: 'hotel', title: 'Airport Inn' }), JSON.stringify(s(FIRST)));
  check('mid-cruise, tonight is the ship', JSON.stringify(s('2026-11-12')) === JSON.stringify({ type: 'cruise', title: 'Island Ship' }));
  check('checkout morning is no longer the ship', s(LAST) === null, JSON.stringify(s(LAST)));
  check('a stay with no checkout covers one night', call(c, 'travelStayTonight_(__s, "2026-11-08")', { __s: [STAYS[0]] }) === null);
  const area = call(c, 'travelDayArea_(__i)', { __i: [FLIGHT, PORT, DINNER, PORT] });
  check('today\'s area is the stops\' places, not the flight\'s or a meal\'s, once each', JSON.stringify(area) === JSON.stringify(['Port Town, Island']), JSON.stringify(area));
}

const CRUISE_DAY = { kind: 'during', n: 6, total: 9, hasFlight: false, stay: { type: 'cruise', title: 'Island Ship' }, onCruise: true, area: ['Port Town, Island'] };
const HOTEL_DAY  = { kind: 'during', n: 3, total: 5, hasFlight: false, stay: { type: 'hotel', title: 'Seaside Hotel' }, onCruise: false, area: ['Old Town'] };
const DEP_DAY    = { kind: 'departure', n: 1, total: 9, hasFlight: true, stay: { type: 'hotel', title: 'Airport Inn' }, onCruise: false, area: [] };

console.log('\nthe heading and subject');
{
  const c = ctxWith();
  const h = ctx => call(c, 'travelDayHeading_(__c)', { __c: ctx });
  check('a day in the middle reads "Day 6 of 9"', h(CRUISE_DAY).subject === '🌴 Day 6 of 9' && h(CRUISE_DAY).label === 'Day 6 of 9', JSON.stringify(h(CRUISE_DAY)));
  check('departure keeps "Travel Day"', h(DEP_DAY).subject === '✈️ Travel Day' && h(DEP_DAY).label === 'Travel Day');
  check('a mid-trip flight keeps "Travel Day"', h({ kind: 'transit', n: 4, total: 9 }).subject === '✈️ Travel Day');
  check('the last day says heading home', /Heading home/.test(h({ kind: 'return', n: 9, total: 9 }).subject));
  check('no count known: "Trip Day"', h({ kind: 'during' }).label === 'Trip Day');
  check('the send builds its subject from the heading', /heading\.subject \+ ' \\u2014 ' \+ tripLabel \+ ' \\u00B7 ' \+ dateLabel/.test(extractFn(TDB, 'sendTravelDayBriefing_')));
  check('…and gives the header and plain text the same heading',
        /buildTravelDayEmailHtml_\(tripLabel, dateLabel, sections, \{ label: heading\.label, hasFlight: dayCtx\.hasFlight \}\)/.test(extractFn(TDB, 'sendTravelDayBriefing_')) &&
        /directionsUrl, heading\)/.test(extractFn(TDB, 'sendTravelDayBriefing_')));
}

console.log('\nthe narrative knows which day it is');
{
  let prompt = '';
  const c = ctxWith({ callClaudeJson_: p => { prompt = p; return { tagline: 't', narrative: 'n', tip: 'x' }; } }, ['buildTravelDayNarrativeData_']);
  call(c, 'buildTravelDayNarrativeData_(__i, "Island Cruise", null, "personal", __c, "")', { __i: [PORT, DINNER], __c: CRUISE_DAY });
  check('a port day is never called a travel day to somewhere', !/travel day to/i.test(prompt), prompt.slice(0, 200));
  check('…it says which day it is and that they are already on the trip', /day 6 of 9/.test(prompt) && /already on the trip/.test(prompt));
  check('…and rules out departing and flights', /Do not write about departing, "wheels up", flights, airports, packing/.test(prompt));
  check('…names tonight\'s stay', /Staying tonight: Island Ship \(cruise\)/.test(prompt));
  check('…and says the stops are ports of call', /ports of call reached by the ship/.test(prompt));
  call(c, 'buildTravelDayNarrativeData_(__i, "Island Cruise", null, "personal", __c, "")', { __i: [FLIGHT], __c: DEP_DAY });
  check('the first day is departure day', /departure day, day 1 of 9/.test(prompt) && !/already on the trip/.test(prompt));
  call(c, 'buildTravelDayNarrativeData_(__i, "Island Cruise", null, "personal", __c, "")', { __i: [FLIGHT], __c: { kind: 'return', n: 9, total: 9 } });
  check('the last day is heading home', /last day, day 9 of 9: heading home/.test(prompt));
}

console.log('\nthe per-stop lookup knows where you are');
{
  let user = '';
  const answer = { address: '1 Far Away St, Another Country', directions: 'Fly into the airport', parkingInfo: 'Airport parking', contactPhone: null, importantNotes: null, found: true };
  const c = ctxWith({
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: () => '' },
    callClaudeWithWebSearch_: (sys, u) => { user = u; return JSON.stringify(answer); },
  }, ['buildTravelItemDetailsData_', 'hasAnyDetails_']);
  const d = call(c, 'buildTravelItemDetailsData_(__r, __c)', { __r: PORT, __c: CRUISE_DAY });
  check('on a cruise it asks for directions from the pier, never an airport or ferry',
        /cruise pier or tender dock, never from an airport or a ferry terminal/.test(user), user);
  check('…and leaves out immigration and ferry details', /leave out immigration and ferry details/.test(user));
  check('…and parking is dropped even if the lookup returns some', d.parkingInfo === null, d.parkingInfo);
  check('the stop\'s own place is not repeated as "where they are", and the ship is named', /Where they are today: Port Town, Island\./.test(user) === false && /Island Ship/.test(user));
  call(c, 'buildTravelItemDetailsData_(__r, __c)', { __r: DINNER, __c: CRUISE_DAY });
  check('a meal with no address on a cruise day is looked for on board first', /most likely on board Island Ship/.test(user), user);
  check('…in today\'s area, and a match elsewhere is "not found"', /Where they are today: Port Town, Island\./.test(user) && /another city or country\), set found=false/.test(user));
  call(c, 'buildTravelItemDetailsData_(__r, __c)', { __r: ['I-9', 'k', 'activity', 'Museum', '2026-11-03', '10:00', '', 'Old Town', '', ''], __c: HOTEL_DAY });
  check('on a hotel day mid-trip: from the hotel, never airport-arrival directions', /already at the destination, staying at Seaside Hotel\. Give directions from there, never airport-arrival directions/.test(user), user);
  call(c, 'buildTravelItemDetailsData_(__r, __c)', { __r: PORT, __c: undefined });
  check('with no day context the prompt is as before', !/Where they are today|cruise/.test(user));
  check('the send passes the day\'s context to the lookup', /enrichTravelItems_\(sortedItems, dayCtx\)/.test(extractFn(TDB, 'sendTravelDayBriefing_')) &&
        /buildTravelItemDetailsData_\(row, dayCtx\)/.test(extractFn(TDB, 'enrichTravelItems_')));
}

console.log('\nthe header, footer and the "not live" notice');
{
  const c = ctxWith({
    getDegradedSources_: () => [{ source: 'aviationstack', staleForText: '3d 19h' }, { source: 'weather', staleForText: '1d' }],
    escapeHtml_: s => String(s),
  }, ['buildTravelDayEmailHtml_']);
  const port = call(c, 'buildTravelDayEmailHtml_("Island Cruise", "Thursday", [], { label: "Day 6 of 9", hasFlight: false })');
  check('the header says the day of the trip', />Day 6 of 9</.test(port));
  check('no flight today: no warning about flight data', !/aviationstack/.test(port) && /weather/.test(port));
  const fly = call(c, 'buildTravelDayEmailHtml_("Island Cruise", "Saturday", [], { label: "Travel Day", hasFlight: true })');
  check('a flight today: the flight-data warning shows', /aviationstack/.test(fly));
  const old = call(c, 'buildTravelDayEmailHtml_("Island Cruise", "Saturday", [])');
  check('called the old way: "Travel Day", every warning', />Travel Day</.test(old) && /aviationstack/.test(old));
  check('the footer fits every day of the trip', /Sent automatically each day of your trip/.test(port));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
