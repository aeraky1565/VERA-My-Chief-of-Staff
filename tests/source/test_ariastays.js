// Issue #238: ARIA watches hotels too. VERA's side: a "stay" request per run of
// unbooked nights (Ref STAY-<Trip ID>-<check-in>, place, check-in/checkout, nights,
// travellers, ceiling per night); hotel prices from ARIA's Fare Log ("Hotel: …"
// routes); stays marked Booked once the itinerary covers the nights; BOOK_STAY and
// HOTEL_UNDER_CEILING as ARIA flags, BOOK_STAY posted to Slack; stopping the flight
// watch never stops a stay; the requests tab widens for its two new columns; and the
// "Still to book" card offers "Watch this stay" in both dashboards. Invented trips.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = read('Aria.js'), CODE = read('Code.js'), WEB = read('WebApp.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

const HEADERS = eval((CODE.match(/const ARIA_REQUESTS_HEADERS = (\[[^\]]*\]);/) || [])[1] || '[]');
const ARQ = [HEADERS.slice()];
let maxCols = 22, inserted = 0;
const rqTab = {
  getLastRow: () => ARQ.length, getMaxColumns: () => maxCols,
  insertColumnsAfter: (after, n) => { inserted += n; maxCols += n; },
  getRange: (r, c, nr, nc) => ({
    getValues: () => ARQ.slice(r - 1, r - 1 + nr).map(x => { const o = x.slice(c - 1, c - 1 + nc); while (o.length < nc) o.push(''); return o; }),
    setValues: v => v.forEach((x, i) => { ARQ[r - 1 + i] = x.slice(); }),
  }),
  appendRow: v => ARQ.push(v.slice()),
};
let items = [];
const S = vm.createContext({
  console, JSON, Math, Number, String, Array, Date, Object, isFinite, parseInt, RegExp,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  Logger: { log: () => {} }, Session: { getScriptTimeZone: () => 'UTC' },
  TABS: { ARIA_REQUESTS: 'ARIA Requests' }, ARIA_REQUESTS_HEADERS: HEADERS,
  getSpreadsheet: () => ({ getSheetByName: () => rqTab }),
  ensureSheet: () => rqTab, tiSchema_: sh => sh, tiLocked_: fn => fn(), tiNow_: () => '2027-03-01T12:00:00.000Z',
  tiMintId_: (() => { let n = 0; return p => p + (++n); })(),
  dateCellToIso_: v => String(v || '').trim(),
  readTripRegistry_: () => ({ byId: { 'TRIP-AAA': { tripId: 'TRIP-AAA', label: 'Coast Trip', startDate: '2027-05-01', endDate: '2027-05-08' } }, rows: [] }),
  tripItemsFor_: () => items,
});
vm.runInContext(SRC, S);
const run = (code, vars) => { Object.assign(S, vars || {}); return vm.runInContext(code, S); };

console.log('\na stay request');
{
  const ok = run('ariaStayRequest_(__b)', { __b: { tripId: 'trip-aaa', tripKey: '2027-05-01|Coast Trip', label: 'Coast Trip', place: 'Porto', checkIn: '2027-05-03', nights: '3', travelers: '2', ceilingNight: '$180' } });
  check('it is a stay, keyed by trip and check-in', ok.kind === 'stay' && ok.ref === 'STAY-TRIP-AAA-2027-05-03' && ok.tripId === 'TRIP-AAA', J(ok));
  check('check-in to checkout, nights and travellers', ok.earliest === '2027-05-03' && ok.latest === '2027-05-06' && ok.nightsMin === 3 && ok.nightsMax === 3 && ok.travelers === 2);
  check('the ceiling is per night', ok.ceilingNight === 180);
  const bad = b => run('ariaStayRequest_(__b)', { __b: Object.assign({ tripId: 'T', place: 'X', checkIn: '2027-05-03', nights: 2 }, b) }).error;
  check('no place, no check-in, or 0 nights is refused, with what to fix', /Where should ARIA look/.test(bad({ place: '' })) && /check-in/.test(bad({ checkIn: '' })) && /Nights/.test(bad({ nights: 0 })));
  check('a trip with no ID yet is refused', /no Trip ID/.test(bad({ tripId: '' })));
}

console.log('\nasking ARIA');
{
  const r1 = run('webStayAriaRequest_(__b)', { __b: { tripId: 'TRIP-AAA', label: 'Coast Trip', place: 'Porto', checkIn: '2027-05-03', nights: 3, travelers: 2, ceilingNight: 180 } });
  check('the requests tab widens for the two new columns first', inserted === 2, inserted);
  const row = ARQ[1];
  check('a stay request is written to VERA\'s own tab', r1.ok && ARQ.length === 2 && row[1] === 'stay' && row[2] === 'STAY-TRIP-AAA-2027-05-03' && row[16] === 'Active', J(row));
  check('…with Place and Ceiling Per Night in their columns', row[HEADERS.indexOf('Place')] === 'Porto' && row[HEADERS.indexOf('Ceiling Per Night')] === 180 && row.length === HEADERS.length);
  run('webStayAriaRequest_(__b)', { __b: { tripId: 'TRIP-AAA', label: 'Coast Trip', place: 'Porto centre', checkIn: '2027-05-03', nights: 3, travelers: 2 } });
  check('asking again refreshes it, never a second row', ARQ.length === 2 && ARQ[1][HEADERS.indexOf('Place')] === 'Porto centre');
  ARQ.push(run('ariaRequestToRow_(__r)', { __r: { id: 'REQ-F', kind: 'watch', ref: '', tripId: 'TRIP-AAA', label: 'Coast Trip', status: 'active', earliest: '2027-05-01', latest: '2027-05-08' } }));
  const w = run('webWithdrawAriaRequest_({ tripId: "TRIP-AAA" })');
  check('"Stop watching" the flights stops the flight watch only, never a stay', w.ok && ARQ[2][16] === 'Withdrawn' && ARQ[1][16] === 'Active', J([ARQ[1][16], ARQ[2][16]]));
  const ws = run('webWithdrawAriaRequest_({ ref: "STAY-TRIP-AAA-2027-05-03" })');
  check('a stay is stopped by its own ref', ws.ok && ARQ[1][16] === 'Withdrawn');
  run('webStayAriaRequest_(__b)', { __b: { tripId: 'TRIP-AAA', label: 'Coast Trip', place: 'Porto', checkIn: '2027-05-03', nights: 3, travelers: 2 } });
  check('…and can be asked for again, reusing its row', ARQ[1][16] === 'Active' && ARQ.length === 3);
}

console.log('\nbooked');
{
  const req = run('ariaRequestFromRow_(__r)', { __r: ARQ[1] });
  items = [{ type: 'hotel', date: '2027-05-03', metadata: '{"checkoutDate":"2027-05-05"}' }];
  check('two of three nights booked is not booked', run('ariaStayCovered_(__q, __i)', { __q: req, __i: items }) === false);
  check('…and nothing is marked', run('ariaMarkStaysBooked_()') === 0 && ARQ[1][16] === 'Active');
  items = [{ type: 'hotel', date: '2027-05-03', metadata: '{"checkoutDate":"2027-05-05"}' }, { type: 'arranged_stay', date: '2027-05-05', metadata: '' }];
  check('every night covered (a hotel and an arranged stay) is booked', run('ariaStayCovered_(__q, __i)', { __q: req, __i: items }) === true);
  check('…and the request is marked Booked, so ARIA stops pricing it', run('ariaMarkStaysBooked_()') === 1 && ARQ[1][16] === 'Booked');
  check('a cruise covers its nights too', run('ariaStayCovered_(__q, __i)', { __q: req, __i: [{ type: 'cruise', date: '2027-05-02', metadata: '{"checkoutDate":"2027-05-08"}' }] }) === true);
  check('the ARIA sync runs the stay check', /ariaMarkBooked_\(t\.watch\);[^\n]*\n  try \{ ariaMarkStaysBooked_\(\); \}/.test(SRC));
}

console.log('\nhotel prices and flags');
{
  const fares = [
    { tripId: 'TRIP-AAA', route: 'Hotel: Porto', dateSeen: '2027-03-01', total: 540 },
    { tripId: 'TRIP-AAA', route: 'IAD-OPO', dateSeen: '2027-03-02', total: 900 },
    { tripId: 'TRIP-AAA', route: 'hotel: Porto', dateSeen: '2027-03-03', total: 510 },
    { tripId: 'TRIP-ZZZ', route: 'Hotel: Elsewhere', dateSeen: '2027-03-03', total: 99 },
  ];
  const h = run('ariaHotelFares_(__f, "trip-aaa")', { __f: fares });
  check('a trip\'s hotel prices are its "Hotel:" rows, newest first', J(h.map(f => f.total)) === J([510, 540]), J(h));
  const A = run('ARIA_ACTIONS_');
  check('BOOK_STAY and HOTEL_UNDER_CEILING are ARIA flags, High', A.BOOK_STAY && A.BOOK_STAY[1] === 'High' && A.HOTEL_UNDER_CEILING && A.HOTEL_UNDER_CEILING[1] === 'High');
  const posts = run('ariaBookNowPosts_(__w, [])', { __w: [
    { actionType: 'BOOK_STAY', actionKey: 'ARIA|STAY-TRIP-AAA-2027-05-03|BOOK_STAY', actionSince: '2027-03-03', label: 'Coast Trip · Porto', bestFare: 510 },
    { actionType: 'BOOK_NOW', actionKey: 'ARIA|TRIP-AAA|BOOK_NOW', actionSince: '2027-03-03', label: 'Coast Trip', bestFare: 900 },
    { actionType: 'HOTEL_UNDER_CEILING', actionKey: 'ARIA|X|HOTEL_UNDER_CEILING', label: 'x' },
  ] });
  check('a Book this stay goes to Slack, worded as a stay', posts.length === 2 && /ARIA says book this stay: Coast Trip · Porto/.test(posts[0].text) && /book now: Coast Trip/.test(posts[1].text), J(posts));
  check('the trip view returns stays and hotel prices, and the flight request never picks a stay',
        /stays: stays, hotelFares: hotelFares, stayDraft: stayDraft/.test(SRC) && /r\.status === 'active' && r\.kind !== 'stay' &&/.test(SRC));
  check('the route is wired', /case 'aria_request_stay':\s+return jsonOut_\(webStayAriaRequest_\(body\)\);/.test(WEB));
}

console.log('\nthe Still to book card');
{
  const block = s => { const a = s.indexOf('function tsNightRuns_('), b = s.indexOf('\nfunction TsTripAria(', a); return a === -1 || b === -1 ? '' : s.slice(a, b); };
  check('both dashboards carry the same TsAriaStays', block(APP) && block(APP) === block(LITE));
  check('open nights offer "Watch this stay" instead of "flights only"', /h\(TsAriaStays,\{/.test(APP) && !/ARIA watches flights for now/.test(APP) && !/ARIA watches flights for now/.test(LITE));
  check('it posts aria_request_stay with the place, check-in, nights, travellers and ceiling', /action:'aria_request_stay'/.test(block(APP)) && /checkIn:/.test(block(APP)) && /ceilingNight:/.test(block(APP)));
  const ctx = vm.createContext({}); vm.runInContext(APP.slice(APP.indexOf('function tsAddDays_('), APP.indexOf('\n', APP.indexOf('function tsAddDays_('))) + '\n' + block(APP).split('\nfunction TsAriaStays(')[0], ctx);
  const runs = vm.runInContext('tsNightRuns_(["2027-05-06","2027-05-03","2027-05-04","2027-05-05"])', ctx);
  check('runs of nights are grouped, so each gap gets one request', J(runs) === J([{ from: '2027-05-03', to: '2027-05-06', nights: 4 }]) &&
        vm.runInContext('tsNightRuns_(["2027-05-03","2027-05-05"]).length', ctx) === 2, J(runs));
  check('a stay is stopped by its ref, not the trip', /action:'aria_request_withdraw',ref:s\.ref/.test(block(APP)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
