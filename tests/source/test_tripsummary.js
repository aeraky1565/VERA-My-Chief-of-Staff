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
  // One cruise stay from the home port; the ports are all-day calendar events named
  // by place alone. The pills follow the ports, not the ship's home port.
  const ports = sum({ trip: { startDate: '2026-12-01', endDate: '2026-12-06', label: 'Anniversary Trip' }, today: '2026-01-01', items: [
    { id: 'c', type: 'cruise', title: 'Cruise Stay: Anniversary', date: '2026-12-01', location: 'Port Canaveral, FL', metadata: JSON.stringify({ checkoutDate: '2026-12-06' }) },
    { id: 'p1', type: 'calendar', title: 'Cozumel', date: '2026-12-03', location: 'Cozumel' },
    { id: 'p0', type: 'calendar', title: 'Nassau', date: '2026-12-02', location: 'Port of Nassau' },
    { id: 'p2', type: 'calendar', title: 'Roatan', date: '2026-12-04', location: 'Roatan, Honduras' },
    { id: 'x', type: 'calendar', title: 'Team call', date: '2026-12-05', location: 'https://zoom.us/j/1' }] });
  check('cruise days read the port of call, a bare name included', ports.days.map(d => d.city).join() === 'Port Canaveral,Nassau,Cozumel,Roatan,At sea,Port Canaveral', ports.days.map(d => d.city).join());
  check('…and the cruise still covers every night', ports.nights.missing.length === 0, JSON.stringify(ports.nights));
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
  check('each day carries its plain city for the forecast, none for the trip home', s.days[1].place === 'Lisboa' && s.days[4].place === 'Porto' && s.days[7].place === '', JSON.stringify(s.days.map(d => d.place)));
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

console.log('\npassports and visas in Needs attention');
{
  const DOCS = { home: 'United States', countries: [
    { country: 'Portugal', role: 'stay', from: '2026-11-13', via: [], travelers: [
      { name: 'Ahmed', passports: [{ passportCountry: 'United States', color: 'green', label: 'Visa Free (90 days)', passport: { status: 'ok', label: 'Valid until 2030-01-01' } }] },
      { name: 'Victoria', passports: [{ passportCountry: 'United States', color: 'green', label: 'Visa Free (90 days)', passport: { status: 'short', label: 'Valid until 2027-01-10: 1 month after you\'re back, Portugal asks for 3' } }] }] },
    { country: 'Germany', role: 'layover', from: '2026-11-19', via: ['FRA'], travelers: [
      { name: 'Ahmed', passports: [{ passportCountry: 'Egypt', color: 'red', label: 'Visa Required', passport: { status: 'expires', label: 'Expires 2026-11-15, before you\'re back' } }] },
      { name: 'Victoria', passports: [{ passportCountry: 'United States', color: 'green', label: 'Visa Free', passport: { status: 'short', label: 'Valid until 2027-01-10: …' } }] }] }] };
  const s = sum(base({ documents: DOCS }));
  const docs = s.attention.filter(a => /Passport|Visa/.test(a.title));
  check('a passport that runs out before you\'re back is red', docs.some(a => a.level === 'red' && /^Passport runs out: Ahmed \(Egypt passport\)$/.test(a.title)), JSON.stringify(docs));
  check('a passport short of a rule is amber, listed once with every country it falls short for', docs.filter(a => /renew soon: Victoria/.test(a.title)).length === 1 && /Portugal, Germany/.test(docs.find(a => /Victoria/.test(a.title)).detail), JSON.stringify(docs));
  check('a required visa is red, as its pill is, naming the country, the layover and the traveler', docs.some(a => a.level === 'red' && a.title === 'Visa required for Germany (layover)' && /Ahmed \(Egypt passport\)/.test(a.detail)), JSON.stringify(docs));
  const lvl = (color, label) => { S.D2 = { countries: [{ country: 'Mexico', role: 'stay', from: '2026-12-03', travelers: [{ name: 'Ahmed', passports: [{ passportCountry: 'Egypt', color, label, passport: { status: 'ok' } }] }] }] };
    return run('tsDocAttention_(D2, "2026-12-01")')[0]; };
  check('an e-Visa or visa on arrival is amber', lvl('yellow', 'e-Visa').level === 'amber' && lvl('yellow', 'e-Visa').title === 'e-Visa for Mexico' && lvl('yellow', 'Visa on Arrival').level === 'amber');
  check('no admission is red and says so', lvl('red', 'No Admission').level === 'red' && lvl('red', 'No Admission').title === 'No admission to Mexico');
  S.D3 = { countries: [{ country: 'Mexico', role: 'stay', from: '2026-11-09', travelers: [{ name: 'Ahmed', passports: [
    { passportCountry: 'United States', color: 'green', label: 'Visa Free (180 days)', use: true, passport: { status: 'ok' } },
    { passportCountry: 'Egypt', color: 'red', label: 'Visa Required', use: false, passport: { status: 'expires', label: 'Expires soon' } }] }] }] };
  check('a passport he would not use raises nothing: no visa line, no expiry line', run('tsDocAttention_(D3, "2026-11-06")').length === 0, JSON.stringify(run('tsDocAttention_(D3, "2026-11-06")')));
  // Useful to know rendered for real, with a React that records and calls components.
  const R = vm.createContext({ console, Math, Number, String, Object, Array, JSON, Date, isNaN, apiGet: () => new Promise(() => {}) });
  R.React = { useState: v => [v, () => {}], useEffect: () => {},
    createElement: function (tag, props) { const kids = Array.prototype.slice.call(arguments, 2); return typeof tag === 'function' ? tag(Object.assign({}, props, { children: kids })) : { kids }; } };
  vm.runInContext("var MONTH_ABBR_=[];\n" + A, R);
  const txt = n => { const out = []; (function w(x) { if (x == null || x === false) return; if (Array.isArray(x)) return x.forEach(w); if (typeof x === 'object') return w(x.kids); out.push(String(x)); })(n); return out.join(' '); };
  const utk = (ins, reach) => { R.a = { ins, reach }; return txt(vm.runInContext('TsUsefulToKnow({ins:a.ins,reach:a.reach})', R)); };
  const INS = { origin_code: 'IAD', dest_code: null, tz_offset_label: null, distance_miles: null, daynight_pct_day: 90, dep_local: '8:40 AM (IAD)', arr_local: '11:33 AM',
    pre_trip_tip: 'Shift your bedtime later for your westward destination.', arrival_tip: 'Stay awake until 10 PM.' };
  const near = utk(INS, { shift: { name: 'Roatan', hours: -1, label: '-1h' }, farthest: { name: 'Roatan', miles: 1650 } });
  check('the trip: its biggest time change and farthest place', /The trip/.test(near) && /Biggest time change -1h at Roatan/.test(near) && /Farthest from home ~1,650 mi Roatan/.test(near), near);
  check('…the flight\'s own facts labelled as the first flight\'s', /Your first flight · IAD/.test(near) && /8:40 AM \(IAD\)/.test(near));
  check('…and within an hour of home, no invented jet-lag tips', /No jet lag to plan for/.test(near) && !/westward/.test(near), near);
  const far = utk(INS, { shift: { name: 'Lisbon', hours: 5, label: '+5h' }, farthest: null });
  check('a real clock change keeps the tips', /westward/.test(far) && !/No jet lag/.test(far));
  check('without reach, the card is as it was', /Useful to know|DAYLIGHT|Daylight/i.test(utk(INS, null)) && !/The trip/.test(utk(INS, null)));
  check('cards to carry starts folded', /function TsCardsToCarry\(props\)\{var h=React\.createElement;var d=props\.data;\n  var _o=React\.useState\(false\)/.test(A));
  check('the chips say what grey means, never "Unknown"', /grey:'No visa data'/.test(A) && /'No expiry on file','p'\)/.test(A) && !/'Unknown'/.test(A.slice(A.indexOf('function TsDocuments('), A.indexOf('function tsWx_('))));
  check('a clear visa adds nothing', !docs.some(a => /Visa Free/.test(a.title)));
  check('no documents yet adds nothing', sum(base()).attention.every(a => !/Passport|Visa/.test(a.title)));
  check('red still comes first with documents in', s.attention.map(a => a.level).join().replace(/(red,)+/, '') .indexOf('red') === -1 && s.attention[0].level === 'red', s.attention.map(a => a.level).join());
}

console.log('\nhome: the active travel card\'s today');
{
  const T = { label: 'Lisbon & Porto', startDate: '2026-11-12', endDate: '2026-11-19' };
  const items = [
    { id: 'h1', type: 'hotel', title: 'Alfama hotel', date: '2026-11-13', location: 'Rua X 12, Lisboa, Portugal', metadata: '{"checkoutDate":"2026-11-16"}' },
    { id: 'c1', type: 'car', title: 'Taxi', date: '2026-11-16', startTime: '10:30', endTime: '10:40', location: 'Rua X 12, Lisboa, Portugal' },
    { id: 't1', type: 'train', title: 'Train to Porto', date: '2026-11-16', startTime: '11:09', location: 'Santa Apolonia' },
    { id: 'f9', type: 'flight', title: 'Hop', date: '2026-11-16', startTime: '12:00' },
    { id: 'a1', type: 'dining', title: 'Dinner', date: '2026-11-16', startTime: '20:00', location: 'Ribeira, Porto, Portugal' },
    { id: 'a2', type: 'activity', title: 'Walk', date: '2026-11-16' },
    { id: 'h2', type: 'hotel', title: 'Ribeira hotel', date: '2026-11-18', location: 'Porto, Portugal', metadata: '{"checkoutDate":"2026-11-19"}' },
    { id: 'n1', type: 'flight', title: 'Night flight', date: '2026-11-17', startTime: '23:00', endTime: '06:00' } ];
  const LEGS = [{ from: 'Rua X 12, Lisboa, Portugal', to: 'Santa Apolonia', driveMins: 35 }];
  const card = (day, nowMins, legs) => { S.c = { trip: T, items, legs: legs || LEGS, day, nowMins }; return run('buildTodayCard_(c)'); };
  const c = card('2026-11-16', 9 * 60);
  check('next up: what is left of today, untimed first, not flights or stays', c.next.map(n => n.title).join() === 'Walk,Taxi,Train to Porto,Dinner', c.next.map(n => n.title).join());
  check('…and items already past drop off', card('2026-11-16', 12 * 60).next.map(n => n.title).join() === 'Walk,Dinner');
  check('leave by: the first stop ahead with a cached drive, from the stop before', c.leaveBy && c.leaveBy.time === '10:34' && c.leaveBy.title === 'Train to Porto' && c.leaveBy.driveMins === 35 && c.leaveBy.from === 'Taxi', JSON.stringify(c.leaveBy));
  check('no leave-by once its time has passed', card('2026-11-16', 10 * 60 + 40).leaveBy === null);
  check('no leave-by without a cached drive', card('2026-11-16', 9 * 60, []).leaveBy === null);
  check('the first stop of the day leaves from last night\'s stay', (() => { S.c = { trip: T, items: [items[0], { id: 'm', type: 'museum', title: 'Museum', date: '2026-11-14', startTime: '10:00', location: 'Museu, Lisboa, Portugal' }],
      legs: [{ from: 'Rua X 12, Lisboa, Portugal', to: 'Museu, Lisboa, Portugal', driveMins: 15 }], day: '2026-11-14', nowMins: 8 * 60 }; const r = run('buildTodayCard_(c)'); return r.leaveBy && r.leaveBy.time === '09:45' && r.leaveBy.from === 'Alfama hotel'; })());
  check('tonight with a stay', card('2026-11-14', 0).tonight.kind === 'stay' && card('2026-11-14', 0).tonight.title === 'Alfama hotel');
  check('tonight with nothing booked', card('2026-11-16', 0).tonight.kind === 'none');
  check('tonight on a night flight', card('2026-11-17', 0).tonight.kind === 'air');
  check('the last day of the trip is home, not a gap', card('2026-11-19', 0).tonight.kind === 'home');
  check('more than four left: the rest are counted', (() => { S.c = { trip: T, items: [1, 2, 3, 4, 5, 6].map(i => ({ id: 'x' + i, type: 'activity', title: 'A' + i, date: '2026-11-15', startTime: '1' + i + ':00' })), day: '2026-11-15', nowMins: 0 }; const r = run('buildTodayCard_(c)'); return r.next.length === 4 && r.more === 2; })());
}

console.log('\nagenda: between and after the items');
{
  const day = [
    { id: 'co', title: 'Check out', startTime: '10:00', location: 'Alfama hotel' },
    { id: 'tx', title: 'Taxi', startTime: '10:30', endTime: '10:40', location: 'Alfama hotel' },
    { id: 'tr', title: 'Train to Porto', startTime: '11:09', endTime: '14:05', location: 'Santa Apolonia' },
    { id: 'dn', title: 'Dinner', startTime: '20:00', location: 'Ribeira' },
    { id: 'ad', title: 'All day thing' } ];
  S.day = day; S.legs = [{ from: 'Alfama hotel', to: 'Santa Apolonia', driveMins: 35 }, { from: 'Santa Apolonia', to: 'Ribeira', driveMins: 15, walkMins: 20 }];
  const b = run('tsDayBreaks_(day, legs)');
  check('a drive over 70% of the gap is a tight connection after the item before it', b.tx && b.tx[0].kind === 'tight' && /"Train to Porto" is ~35 min away, with 29 min to get there/.test(b.tx[0].text), JSON.stringify(b.tx));
  check('free time takes the drive off the gap, and names the walk', b.tr && b.tr[0].kind === 'free' && b.tr[0].text === '5h 40m free · ~15 min drive / 20 min walk', JSON.stringify(b.tr));
  check('under an hour free is not worth a line', !b.co);
  check('an untimed item makes no break', Object.keys(b).length === 2);
  check('minutes under ten are padded: 1h 05m', run("tsDayBreaks_([{id:'a',startTime:'09:00'},{id:'b',startTime:'10:05'}],[])").a[0].text === '1h 05m free');
}
console.log('\nweather and Useful to know');
{
  const wx = c => { S.c = c; return run('tsWx_(c)'); };
  check('weather codes read as a symbol and a word', wx(0).label === 'Sunny' && wx(3).label === 'Cloudy' && wx(61).label === 'Rain' && wx(81).label === 'Rain' && wx(73).label === 'Snow' && wx(95).label === 'Storms' && wx(45).label === 'Fog');
  check('Useful to know is one shared card, in Summary and in both Agendas',
        /\(ins\|\|props\.reach\)&&h\('div',\{style:\{gridColumn:'1 \/ -1'\}\},h\(TsUsefulToKnow,\{ins:ins,trip:trip,reach:props\.reach,apiUrl:props\.apiUrl,apiToken:props\.apiToken\}\)\)/.test(A)
        && /\(viewMode==='agenda'\|\|viewMode==='map'\)&&itinInsights&&\/\*#__PURE__\*\/React\.createElement\(TsUsefulToKnow,\{ins:itinInsights,collapsible:true,trip:trip,apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP)
        && /return <TsUsefulToKnow ins=\{insights\} collapsible=\{true\} trip=\{trip\} apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>;/.test(LITE)
        && /<UsefulToKnowCard insights=\{flightInsights\[tripKey\]\} trip=\{\{\.\.\.t,tripKey\}\} apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>/.test(LITE));
  check('Documents shows only for a trip that leaves home (or while checking, or to report an error)', /documents&&\(documents\.loading\|\|documents\.error\|\|\(documents\.countries\|\|\[\]\)\.length>0\)&&h\('section'/.test(A));
}

console.log('\ncards to carry');
{
  S.cards = [
    { cardName: 'Blue Travel', owner: 'Ahmed', last4: '1111', active: 'Yes', noFxFee: true },
    { cardName: 'Cash Back', owner: 'Ahmed', last4: '2222', active: 'Yes', noFxFee: false },
    { cardName: 'Green Everyday', owner: 'Victoria', last4: '3333', active: 'Yes', noFxFee: true },
    { cardName: 'Old Gold', owner: 'Ahmed', last4: '4444', active: 'No', noFxFee: true },
    { cardName: 'Plain Card', owner: 'Victoria', last4: '5555', active: 'Yes', noFxFee: true }];
  S.rewards = [
    { cardName: 'Green Everyday', category: 'Everything Else', rate: '2', rateType: '%' },
    { cardName: 'Blue Travel', category: 'Dining', rate: '3', rateType: 'x' },
    { cardName: 'Blue Travel', category: 'International Travel', rate: '2', rateType: 'x' },
    { cardName: 'Cash Back', category: 'International Travel', rate: '5', rateType: '%' }];
  S.perks = [
    { cardName: 'Blue Travel', perk: 'Priority Pass lounge access', category: 'Travel' },
    { cardName: 'Blue Travel', perk: 'Streaming credit', category: 'Entertainment' },
    { cardName: 'Blue Travel', perk: 'Trip delay insurance', category: '' }];
  const c = run('tsCardsToCarry_(cards, rewards, perks)');
  check('only active cards marked No FX fee', c.map(x => x.cardName).join() === 'Blue Travel,Green Everyday,Plain Card', c.map(x => x.cardName).join());
  check('an International Travel rate ranks first, then general spend, then none', c[0].reward === '2x abroad' && c[1].reward === '2% on everything' && c[2].reward === '', JSON.stringify(c.map(x => x.reward)));
  check('travel perks come along; others do not', c[0].perks.join() === 'Priority Pass lounge access,Trip delay insurance', c[0].perks.join());
  check('owner and last four are kept', c[0].owner === 'Ahmed' && c[0].last4 === '1111');
  check('no cards is an empty list, not a crash', run('tsCardsToCarry_(null, null, null)').length === 0);
  check('the card shows only on a trip abroad, and loads the cards only then', /\(ins\|\|props\.onGoToPacking\|\|abroad\)&&h\('section'/.test(A) && /abroad&&h\(TsCardsToCarry,\{data:cards\}\)/.test(A)
        && /if\(!abroad\|\|props\.cards!==undefined/.test(A) && /\{action:'cards'\}/.test(A));
}

console.log('\nwiring');
// ItineraryView has nested top-level-looking functions, so take it up to the panel that follows it.
const itin = APP.slice(APP.indexOf('function ItineraryView('), APP.indexOf('// Accordion panel: all trips', APP.indexOf('function ItineraryView(')));
check('full: views read Summary, Map, Agenda, then Packing; Summary is the default; Visa is not a view of its own', /React\.useState\('summary'\)/.test(itin) && /\['summary','map','agenda'\]\.concat\(renderPacking\?\['packing'\]:\[\]\)/.test(itin) && /labels\[mode\]\);\}\),!renderPacking&&onGoToPacking&&/.test(itin));
check('full: Packing is the fourth view, rendered inside the itinerary', /viewMode==='packing'&&renderPacking&&renderPacking\(trip\)/.test(itin) && /onGoToPacking:renderPacking\?function\(\)\{setViewMode\('packing'\);\}:onGoToPacking/.test(itin));
check('full: Travel has no Packing sub-tab; each trip gets its own packing list', !/\{id:'packing',label:'🎒 Packing'\}/.test(APP) && !/sub==='packing'&&/.test(APP)
      && /renderPacking:function\(t\)\{[^]*?React\.createElement\(PackingPanel,\{trips:\[t\],[^]*?focusTripKey:t\.startDate\+'\|'\+t\.label,/.test(APP)
      && /renderPacking:renderPacking\?function\(\)\{return renderPacking\(t\);\}:null,/.test(APP));
check('full: a jump to packing opens the itinerary, not a removed tab', /if\(!packingFocusTripKey\)return;setSub\('itinerary'\);/.test(APP));
check('full: Summary renders TripSummaryView with the trip editors inside', /viewMode==='summary'&&\/\*#__PURE__\*\/React\.createElement\(TripSummaryView,\{trip:trip,items:displayItems,legs:travelLegs,meta:ctxMeta,statuses:flightStatuses,insights:itinInsights,apiUrl:apiUrl,apiToken:apiToken,onGoToPacking:renderPacking\?function\(\)\{setViewMode\('packing'\);\}:onGoToPacking,details:\/\*#__PURE__\*\/React\.createElement\(React\.Fragment,null,\/\*#__PURE__\*\/React\.createElement\(TripContextBadge/.test(itin));
check('full: the old per-day summary is gone', !/viewMode==='summary'&&orderedDays/.test(itin));
check('full: tapping a day opens Agenda at that day', /onOpenDay:function\(d\)\{setViewMode\('agenda'\);/.test(itin) && /id:tsDayId_\(trip\.tripKey,day\)/.test(itin));
check('full: VERA Notices and Useful to know stand down on Summary', /\(viewMode==='agenda'\|\|viewMode==='map'\)&&allNotices\.length>0/.test(itin) && /\(viewMode==='agenda'\|\|viewMode==='map'\)&&itinInsights&&/.test(itin));
check('full: Discover and Budget are views inside each trip, after Packing', /\.concat\(renderDiscover\?\['discover'\]:\[\]\)\.concat\(renderBudget\?\['budget'\]:\[\]\)/.test(itin)
      && /viewMode==='discover'&&renderDiscover&&renderDiscover\(trip,function\(\)\{setViewMode\('agenda'\);\}\),viewMode==='budget'&&renderBudget&&renderBudget\(trip\),/.test(itin));
check('full: Travel has no Discover or Budget tab; each trip gets its own, opened on it', !/\{id:'discover',label:'✨ Discover'\}/.test(APP) && !/sub==='discover'&&/.test(APP) && !/sub==='budget'&&\/\*#__PURE__\*\/React\.createElement\(TripBudgetPanel/.test(APP)
      && /React\.createElement\(RecommendationsPanel,\{trips:\[t\],focusTripKey:tk,/.test(APP) && /React\.createElement\(TripBudgetPanel,\{trips:\[t\],focusTripKey:t\.startDate\+'\|'\+t\.label,/.test(APP));
check('both: a panel opened on one trip loads it and skips the picker', [APP, LITE].every(src => /focusTripKey\)o\[focusTripKey\]=true;/.test(src) && /if\(focusTripKey&&!recommendations\[focusTripKey\]\)onLoadRecs\(focusTripKey\);/.test(src)
      && /var\[selectedKey,setSelectedKey\]=React\.useState\(focusTripKey\|\|null\);/.test(src) && /return\/\*#__PURE__\*\/React\.createElement\("div",null,!focusTripKey&&/.test(src)));
check('lite: no Discover or Budget in the Travel menu; they are trip tabs', !/\['discover','✨ Discover'\],\['countries'/.test(LITE) && !/travSub === 'discover'/.test(LITE) && !/travSub === 'budget'/.test(LITE)
      && /<RecommendationsPanel trips=\{\[t\]\} focusTripKey=\{tripKey\}/.test(LITE) && /<TripBudgetPanel trips=\{\[t\]\} focusTripKey=\{tripKey\}/.test(LITE));
check('lite: Summary first and default', /tripTabs\[tripKey\] \|\| 'summary'/.test(LITE) && /\[\['summary','📋 Summary'\],\['agenda','📅 Agenda'\],\['packing','🎒 Packing'\],\['discover','✨ Discover'\],\['budget','💰 Budget'\]\]/.test(LITE));
check('lite: Summary renders TripSummaryView and jumps to the day', /<TripSummaryView trip=\{\{\.\.\.t,tripKey\}\} items=\{filteredItin\.items\}/.test(LITE) && /id=\{tsDayId_\(trip\.tripKey, date\)\}/.test(LITE));
check('lite: the old SummaryLitePanel is gone', !/SummaryLitePanel/.test(LITE));
check('full: the Visa view and its state are gone', !/viewMode==='visa'/.test(itin) && !/handleVisaCheck/.test(itin));
check('lite: Summary gets the API to load documents', /items=\{filteredItin\.items\} legs=\{travelLegs\[tripKey\]\} meta=\{meta\|\|\{\}\} apiUrl=\{apiUrl\} apiToken=\{apiToken\}/.test(LITE));
check('full: + Add Item left the header for Agenda\'s toolbar', !/"\+ Add Item"/.test(itin) && /viewMode==='agenda'&&\/\*#__PURE__\*\/React\.createElement\(TsAgendaToolbar,\{onAdd:onAdd,busy:busy,trip:trip,who:travelerFilter,apiUrl:apiUrl,apiToken:apiToken\}\)/.test(itin));
check('full: each day gets its breaks, its coloured header and its end slots', /const dayBreaks=tsDayBreaks_\(groupItineraryOptions\(dayItems\),travelLegs\)/.test(itin)
      && /tsDayHeadStyle_\(agendaSum,day\)/.test(itin) && /return tsWithBreaks_\(dayBreaks\[item\.id\]/.test(itin) && /React\.createElement\(TsDayEnd,\{date:day,summary:agendaSum,onAdd:onAdd,busy:busy\}\)/.test(itin));
check('full: VERA Notices drops what now sits inside each day', /var allNotices=notices\.concat\(gaps\)\.filter\(function\(n\)\{return n\.type!=='timeline_gap'&&n\.type!=='missing_hotel'&&n\.type!=='missing_transport';\}\)/.test(itin));
check('full: the add form takes a date and type', /function AddItineraryItemModal\(\{tripKey,item,defaults,onSave,onClose,busy\}\)/.test(APP) && /defaults&&defaults\.date\|\|''/.test(APP) && /defaults:itinItemModal\.defaults/.test(APP)
      && /onAdd:function\(defaults\)\{onAddItinItem\(tripKey,t\.startDate,t\.endDate,defaults\);\}/.test(APP));
check('lite: the same toolbar, breaks, header colours and end slots', /<TsAgendaToolbar onAdd=\{onAdd\} busy=\{busy\} trip=\{trip\} who=\{who\} apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>/.test(LITE) && /who=\{traveler\} apiUrl=\{apiUrl\} apiToken=\{apiToken\}/.test(LITE) && /rows\.map\(item => tsWithBreaks_\(dayBreaks\[item\.id\]/.test(LITE)
      && /\.\.\.tsDayHeadStyle_\(agendaSum, date\)/.test(LITE) && /<TsDayEnd date=\{date\} summary=\{agendaSum\} onAdd=\{onAdd\} busy=\{busy\} \/>/.test(LITE));
check('lite: the add form takes a date and type', /defaults\?\.date\|\|tripStartDate/.test(LITE) && /defaults\?\.type\|\|'manual'/.test(LITE) && /defaults=\{modal\.defaults\}/.test(LITE));
check('lite: the top-of-Agenda notices card is no longer shown', !/<VERANoticesCard /.test(LITE));
['docs/app.js', 'docs/dashboard-lite.html'].forEach(f => {
  const src = f === 'docs/app.js' ? APP : LITE;
  const card = src.slice(src.indexOf('function ActiveTravelCard('), src.indexOf('// ---- Mail/Package Counter card', src.indexOf('function ActiveTravelCard(')));
  check(f + ': the active travel card carries the today pieces, before "Staying at"', /React\.createElement\(TsTodayCard,\{trip:trip,items:items,day:displayDay,departing:departing,apiUrl:apiUrl,apiToken:apiToken,onViewItinerary:/.test(card)
        && card.indexOf('TsTodayCard') < card.indexOf('"Staying at"'));
  check(f + ': "No itinerary items" only when the day really has none', /!\(items\|\|\[\]\)\.some\(function\(i\)\{return i\.date===displayDay&&!i\._synthetic;\}\)&&/.test(card));
});

console.log('\nthe plan from a settled trip idea: booked ticks');
{
  S.legs = [{ kind: 'move', mode: 'fly', from: 'Home', to: 'LIS' }, { kind: 'stop', place: 'Lisbon', nights: 3 }, { kind: 'move', mode: 'car', from: 'Lisbon', to: 'Lagos' },
    { kind: 'stop', place: 'Algarve', nights: 3 }, { kind: 'move', mode: 'ship', from: 'Cádiz', to: 'Barcelona' }, { kind: 'stop', place: 'Cruise', nights: 7 }, { kind: 'move', mode: 'fly', from: 'BCN', to: 'Home' }];
  S.its = [{ type: 'hotel', title: 'Hotel Avenida', location: 'Av. da Liberdade, Lisboa, Portugal', date: '2027-05-29' },
    { type: 'hotel', title: 'Casa Lisbon Baixa', location: 'Lisbon', date: '2027-05-30' },
    { type: 'cruise', title: 'Board the ship', location: 'Cádiz', date: '2027-06-04' }, { type: 'hotel', title: 'Algarve villa (suggested)', location: 'Algarve', date: '2027-06-01', _synthetic: true }];
  const t = run('tsPlanTicks_(legs, its, {arrival: true, departure: false})').map(x => x.booked);
  check('the first flight is the way there, the last the way back (the Summary\'s own check)', t[0] === true && t[6] === false, JSON.stringify(t));
  check('a stay is booked when a stay names its place; a suggestion (synthetic) is not a booking', t[1] === true && t[3] === false);
  check('a drive with nothing named is not booked', t[2] === false);
  check('a cruise leg and a cruise stop are booked by the trip\'s cruise', t[4] === true && t[5] === true);
  check('nothing booked reads as nothing booked', run('tsPlanTicks_(legs, [], {arrival: false, departure: false})').every(x => !x.booked));
  S.pc = { flights: { low: 1400, high: 1800 }, stays: { low: 2000, high: 2500 }, cruise: { low: 4000, high: 6000 }, daily: { low: 500, high: 700 } };
  const pm = run('tsPlanMoney_(pc, {flights: 1640, lodging: 4210.5, food: 120, activities: 80})');
  check('planned vs paid: stays and the cruise are both lodging; daily spend is food and activities', JSON.stringify(pm.rows.map(r => [r.label, r.low, r.high, r.paid])) === JSON.stringify([['Flights', 1400, 1800, 1640], ['Stays & cruise', 6000, 8500, 4210.5], ['Daily spend', 500, 700, 200]]), JSON.stringify(pm.rows));
  check('…totals, the paid one rounded', pm.low === 7900 && pm.high === 11000 && pm.paid === 6051, JSON.stringify(pm));
  check('…nothing paid yet is null, not $0', run('tsPlanMoney_(pc, {}).paid') === null && run('tsPlanMoney_(pc, null).rows.every(function(r){return r.paid===null;})') === true);
  S.__ev = []; S.window = { dispatchEvent: e => { S.__ev.push(e); } }; S.CustomEvent = function(t, o) { this.type = t; this.detail = o && o.detail; };
  run('tsOpenIdea_("IDEA-7"); tsOpenIdea_("")');
  check('"Open the idea" asks the Travel tab for that idea, by an event both dashboards listen for', S.__ev.length === 1 && S.__ev[0].type === 'vera-open-idea' && S.__ev[0].detail.ideaId === 'IDEA-7');
  check('…from the plan card\'s button', /className:'ts-plan-idea',onClick:function\(\)\{tsOpenIdea_\(p\.idea\.id\);\}/.test(fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8')));
  check('…a category paid but not planned still shows', run('tsPlanMoney_({flights:{low:1,high:2}}, {transport: 300}).rows.map(function(r){return r.label;}).join()') === 'Flights,Getting around');
  check('a place word skips filler and accents', run('tsPlaceWord_("Cádiz port")') === 'cadiz' && run('tsPlaceWord_("Home")') === '' && run('tsPlaceWord_("Cruise A · Genoa round trip")') === 'genoa');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
