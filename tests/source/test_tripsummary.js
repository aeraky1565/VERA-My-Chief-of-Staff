// The itinerary redesign's Summary (TripSummaryView): the shared block both
// dashboards carry word for word, and its pure builder, buildTripSummary_, run
// in a vm over invented trips.
//
// What the Summary must get right: which nights have nowhere to sleep (red),
// which days have a missing or tight transfer or an open decision (amber), the
// city each day is in, the counts under "Booked so far", the order of "Needs
// attention", the sleep bands, and the small notes kept from today's itinerary
// ("Still deciding — …", "Live status from …"). The rendering is driven in
// test_tripsummary_ui.js.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', src.indexOf(')', at)); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error('unterminated: ' + name);
}
const fnBody = (src, name) => { const a = src.indexOf('function ' + name + '('); return a === -1 ? '' : src.slice(a, src.indexOf('\nfunction ', a + 1)); };

// ============ the shared block =================================================
console.log('the shared block');
const START = '// ---- TripSummaryView (itinerary redesign)', END = '// ---- /TripSummaryView ----';
const block = src => { const a = src.indexOf(START), b = src.indexOf(END); return a === -1 || b === -1 ? null : src.slice(a, b + END.length); };
const A = block(APP), L = block(LITE);
check('the full dashboard has the block', !!A);
check('dashboard-lite has the block', !!L);
check('the two copies are identical', A && L && A === L);

// The real helpers the block leans on, from app.js.
const S = vm.createContext({ React: { createElement: () => null, useState: v => [v, () => {}] }, console });
vm.runInContext("var MONTH_ABBR_=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];\n" + ['itinMeta', 'decisionStatusOf', 'decideByOf', 'isOverdueDecision', 'fmtDate'].map(n => extractFn(APP, n)).join('\n') + '\n' + A, S);
const run = code => vm.runInContext(code, S);
const sum = o => { S.o = o; return run('buildTripSummary_(o)'); };

// ============ a city from a location ==========================================
console.log('\na city from a location');
const city = l => { S.l = l; return run('tsCity_(l)'); };
[['Anchorage, AK', 'Anchorage'], ['Little Havana, Miami, FL', 'Miami'], ['800 LaGrange Rd, La Grange, IL 60525', 'La Grange'],
 ['Vancouver, BC, Canada', 'Vancouver'], ['Rua X 12, 1100-001 Lisboa, Portugal', 'Lisboa'], ['20002 Gulf Boulevard 2303, Indian Shores, FL 33785, United States', 'Indian Shores'],
 ['10 Downing St, London SW1A 2AA, UK', 'London'], ['Delaware', 'Delaware'], ['', '']].forEach(([loc, want]) =>
  check('"' + loc + '" → "' + want + '"', city(loc) === want, city(loc)));
check('a trip label names its place', (S.l = 'Road Trip - Toledo, OH', run('tsLabelPlace_(l)')) === 'Toledo' && (S.l = 'Delaware Trip', run('tsLabelPlace_(l)')) === 'Delaware',
      run('tsLabelPlace_("Road Trip - Toledo, OH")'));
check('a move ends where its title points', run('tsMoveDest_({title:"Train · Lisbon → Porto"})') === 'Porto' && run('tsMoveDest_({title:"Tour"})') === '');

// ============ an invented trip: Lisbon and Porto ===============================
const TRIP = { tripKey: '2026-11-12|Vacation: Lisbon & Porto', label: 'Vacation: Lisbon & Porto', startDate: '2026-11-12', endDate: '2026-11-19' };
const ITEMS = () => [
  { id: 'f1', type: 'flight', title: 'TP 204 · IAD → LIS', date: '2026-11-12', startTime: '18:05', endTime: '06:40', location: 'IAD' },
  { id: 'h1', type: 'hotel', title: 'Alfama hotel', date: '2026-11-13', location: 'Rua X 12, 1100-001 Lisboa, Portugal', metadata: '{"checkoutDate":"2026-11-16"}' },
  { id: 'a1', type: 'activity', title: 'Sintra day', date: '2026-11-14', startTime: '09:00', location: 'Sintra, Portugal' },
  { id: 'c1', type: 'car', title: 'Taxi to the station', date: '2026-11-16', startTime: '10:30', endTime: '10:40', location: 'Alfama hotel' },
  { id: 't1', type: 'train', title: 'Train · Lisbon → Porto', date: '2026-11-16', startTime: '11:09', endTime: '14:05', location: 'Santa Apolonia' },
  { id: 'd1', type: 'dining', title: 'Fado tavern', date: '2026-11-15', startTime: '20:00', metadata: '{"tentative":true,"optionGroup":"g1","isRepresentative":true,"optionCount":2,"decisionStatus":"open","decideBy":"2026-10-24"}' },
  { id: 'd2', type: 'dining', title: 'Rooftop', date: '2026-11-15', startTime: '20:00', metadata: '{"tentative":true,"optionGroup":"g1","optionCount":2,"decisionStatus":"open"}' },
  { id: 'x1', type: 'activity', title: 'Port tasting', date: '2026-11-17', startTime: '16:00', location: 'Cellar door' },  // a bare name, not an address
  { id: 'h2', type: 'hotel', title: 'Ribeira hotel', date: '2026-11-18', location: 'Cais 1, 4050-510 Porto, Portugal', metadata: '{"checkoutDate":"2026-11-19"}' },
  { id: 'f2', type: 'flight', title: 'LH 1179 · OPO → FRA → IAD', date: '2026-11-19', startTime: '11:20', endTime: '18:55', location: 'OPO' },
];
const LEGS = [{ from: 'Alfama hotel', to: 'Santa Apolonia', driveMins: 35 }];
const base = (over) => Object.assign({ trip: TRIP, items: ITEMS(), legs: LEGS, outboundMode: 'flight', returnMode: 'flight', today: '2026-10-25', nowMs: Date.parse('2026-10-25T12:00:00') }, over || {});

console.log('\nnights and the red days');
{
  const s = sum(base());
  const day = d => s.days.find(x => x.date === d) || {};
  check('one pill per day of the trip', s.days.length === 8 && s.days[0].date === '2026-11-12' && s.days[7].date === '2026-11-19');
  check('the overnight flight\'s night is in the air, not missing', s.stays[0].kind === 'air' && day('2026-11-12').health === 'ok');
  check('nights with nowhere to sleep are red, the rest are not', day('2026-11-16').health === 'red' && day('2026-11-17').health === 'red'
        && ['2026-11-13', '2026-11-14', '2026-11-18'].every(d => day(d).health === 'ok'), JSON.stringify(s.days.map(d => d.date.slice(8) + ':' + d.health)));
  check('the last day is never red: you sleep at home', day('2026-11-19').health !== 'red');
  check('booked so far counts nights that need a stay', s.nights.total === 6 && s.nights.have === 4 && JSON.stringify(s.nights.missing) === '["2026-11-16","2026-11-17"]', JSON.stringify(s.nights));
  check('the sleep bands: in the air, a stay, a gap, a stay', JSON.stringify(s.stays.map(x => x.kind + x.nights)) === '["air1","stay3","gap2","stay1"]', JSON.stringify(s.stays.map(x => x.kind + x.nights)));
  check('a stay with no check-out date covers its one night', (() => { const it = ITEMS(); it[7].metadata = '{}'; const r = sum(base({ items: it })); return r.nights.missing.indexOf('2026-11-18') === -1; })());
  const cruise = sum({ trip: { startDate: '2026-06-27', endDate: '2026-07-04', label: 'Cruise' }, today: '2026-01-01', items: [
    { id: 'b', type: 'cruise', title: 'Board the ship', date: '2026-06-27', location: 'Whittier, AK' },
    { id: 'o', type: 'cruise', title: 'Disembark at Vancouver', date: '2026-07-04', location: 'Vancouver, BC, Canada' }] });
  check('a cruise booked as Board … Disembark covers every night between', cruise.nights.missing.length === 0 && cruise.nights.total === 7, JSON.stringify(cruise.nights));
}

console.log('\nthe amber days');
{
  const s = sum(base());
  const day = d => s.days.find(x => x.date === d) || {};
  check('an open decision turns its day amber', day('2026-11-15').health === 'amber' && day('2026-11-15').reasons.indexOf('a decision to make') !== -1);
  check('a tight connection is found from the cached drive time', s.tight.length === 1 && s.tight[0].driveMins === 35 && s.tight[0].gapMins === 29, JSON.stringify(s.tight));
  check('red outranks amber on the same day', day('2026-11-16').health === 'red' && day('2026-11-16').reasons.indexOf('a tight connection') !== -1);
  const noFly = sum(base({ items: ITEMS().filter(i => i.id !== 'f2') }));
  check('no way home on the last day is amber, and counted', noFly.days[7].health === 'amber' && noFly.ends.departure === false && noFly.ends.arrival === true);
  const road = sum(base({ items: ITEMS().filter(i => i.id !== 'f2'), returnMode: 'road_trip' }));
  check('driving yourself needs no departure booking', road.days[7].health === 'ok' && road.ends.departure === null);
  const decided = ITEMS(); decided[5].metadata = decided[5].metadata.replace('"open"', '"decided"');
  check('a decided option is no longer amber', sum(base({ items: decided })).days[3].health === 'ok');
  check('a non-representative option is not counted twice', s.decisions === 1);
}

console.log('\nwhere each day is');
{
  const s = sum(base());
  const c = s.days.map(d => d.city);
  check('a stay names the city', c[1] === 'Lisboa' && c[6] === 'Porto', JSON.stringify(c));
  check('a travel day points where it ends: the train\'s title, not a hotel\'s name', c[4] === '→ Porto', c[4]);
  check('a night flight takes the next day\'s city, not an airport code', c[0] === '→ Lisboa', c[0]);
  check('the day after a move carries the new city; a bare place name is not a city', c[5] === 'Porto', c[5]);
  check('the last travel day goes home', c[7] === '→ Home');
  check('travel days carry their mode', s.days[0].travel === 'flight' && s.days[4].travel === 'train' && s.days[2].travel === '');
}

console.log('\nneeds attention');
{
  const s = sum(base());
  check('red first, then amber', s.attention.map(a => a.level).join() === 'red,amber,amber', s.attention.map(a => a.level).join());
  check('consecutive empty nights are one entry, with the city', s.attention[0].title === 'No place to sleep in Porto' && /2 nights, Nov 16 – Nov 17/.test(s.attention[0].detail), JSON.stringify(s.attention[0]));
  const dec = s.attention.find(a => /^Decide/.test(a.title));
  check('a decision keeps today\'s wording: "Still deciding — 2 options · decide by … · overdue"',
        dec && /^Still deciding — 2 options · decide by .+ · overdue$/.test(dec.detail), dec && dec.detail);
  check('each entry jumps to its day', s.attention.every(a => /^2026-11-\d\d$/.test(a.date)));
}

console.log('\ngetting around and the countdown');
{
  const s = sum(base());
  check('flights, trains and transfers in order', s.moves.map(m => m.item.id).join() === 'f1,c1,t1,f2', s.moves.map(m => m.item.id).join());
  check('a future flight gets a check-in reminder, 24 h before', /^Online check-in usually opens 24 h before: Wed, Nov 11, 6:05/.test(s.moves[0].checkin), s.moves[0].checkin);
  check('a train gets none', s.moves[2].checkin === '');
  check('a flight that has gone gets none', sum(base({ nowMs: Date.parse('2026-11-20T12:00:00') })).moves[0].checkin === '');
  check('before the trip: "Leaves in N days"', s.countdown === 'Leaves in 18 days', s.countdown);
  check('during: "Day X of N", with today ringed', (() => { const r = sum(base({ today: '2026-11-14' })); return r.countdown === 'Day 3 of 8' && r.days[2].isToday; })());
  check('after: "Trip ended"', sum(base({ today: '2026-12-01' })).countdown === 'Trip ended');
}

console.log('\nwiring');
// ItineraryView has nested top-level-looking functions, so take it up to the panel that follows it.
const itin = APP.slice(APP.indexOf('function ItineraryView('), APP.indexOf('// Accordion panel: all trips', APP.indexOf('function ItineraryView(')));
check('full: Summary is the first and default view', /React\.useState\('summary'\)/.test(itin) && /\['summary','agenda','map','visa'\]/.test(itin));
check('full: Summary renders TripSummaryView with the trip editors inside', /viewMode==='summary'&&\/\*#__PURE__\*\/React\.createElement\(TripSummaryView,\{trip:trip,items:displayItems,legs:travelLegs,meta:ctxMeta,statuses:flightStatuses,insights:itinInsights,onGoToPacking:onGoToPacking,details:\/\*#__PURE__\*\/React\.createElement\(React\.Fragment,null,\/\*#__PURE__\*\/React\.createElement\(TripContextBadge/.test(itin));
check('full: the old per-day summary is gone', !/viewMode==='summary'&&orderedDays/.test(itin));
check('full: tapping a day opens Agenda at that day', /onOpenDay:function\(d\)\{setViewMode\('agenda'\);/.test(itin) && /id:tsDayId_\(trip\.tripKey,day\)/.test(itin));
check('full: VERA Notices and Useful to know stand down on Summary', /viewMode!=='summary'&&allNotices\.length>0/.test(itin) && /viewMode!=='summary'&&itinInsights&&/.test(itin));
check('lite: Summary first and default', /tripTabs\[tripKey\] \|\| 'summary'/.test(LITE) && /\[\['summary','📋 Summary'\],\['agenda','📅 Agenda'\],\['packing','🎒 Packing'\]\]/.test(LITE));
check('lite: Summary renders TripSummaryView and jumps to the day', /<TripSummaryView trip=\{\{\.\.\.t,tripKey\}\} items=\{filteredItin\.items\}/.test(LITE) && /id=\{tsDayId_\(trip\.tripKey, date\)\}/.test(LITE));
check('lite: the old SummaryLitePanel is gone', !/SummaryLitePanel/.test(LITE));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
