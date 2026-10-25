// The trip documents check behind Summary's "Documents" card (WebApp.js,
// itinerary redesign stage 3): every non-home country a trip touches, stays and
// layovers, each with every traveler's visa status and passport validity.
//
// The real functions run in a vm over an invented Passport Index matrix, an
// invented airport table and invented travelers. Nothing is fetched.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');

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
const extractVar = (src, name) => { const a = src.indexOf('var ' + name + ' = '); if (a === -1) throw new Error('not found: ' + name); return src.slice(a, src.indexOf('];', a) !== -1 && src.indexOf('];', a) < src.indexOf('};', a) ? src.indexOf('];', a) + 2 : src.indexOf('};', a) + 2); };

const CSV = ['Passport,Portugal,Germany,Italy,France,Egypt,United States,Japan',
  'United States,90,90,90,90,VOA,-1,90',
  'Egypt,VR,VR,VR,VR,-1,VR,VR'].join('\n');
const AIRPORTS = { IAD: 'United States', LIS: 'Portugal', OPO: 'Portugal', FRA: 'Germany', FCO: 'Italy', CDG: 'France', JFK: 'United States' };

const S = vm.createContext({ console });
vm.runInContext([extractVar(WEB, 'VISA_ALIASES_'), extractVar(WEB, 'SCHENGEN_'), WEB.match(/var TRIP_NOT_A_PLACE_ = .*;/)[0], extractVar(WEB, 'TRIP_DOC_RANK_'),
  ...['tripPlaceMatches_', 'visaNorm_', 'visaResultsFor_', 'visaStatusKey_', 'visaStatusLabel_', 'visaStatusColor_', 'tripFlightRoute_', 'tripAddressCountry_', 'tripCountries_',
      'tripPassportCheck_', 'tripPassportTone_', 'tripPickPassports_', 'tripDocWorst_', 'tripReach_', 'tripPlaceZone_', 'tripItemsFor_', 'webGetTripDocuments_', 'webGetVisaRequirements_'].map(n => extractFn(WEB, n))].join('\n'), S);
const run = code => vm.runInContext(code, S);
S.CSV = CSV;
S.names = {}; CSV.split('\n')[0].split(',').slice(1).forEach(h => { S.names[h.toLowerCase().replace(/[^a-z0-9]/g, '')] = h; });
S.airport = c => AIRPORTS[c] || '';

// ============ the matrix's statuses ===========================================
// The live matrix writes words; older copies wrote codes. Both must read right.
console.log('the matrix\'s statuses');
{
  const st = v => { S.v = v; return run('visaStatusLabel_(v) + "|" + visaStatusColor_(v)'); };
  const want = { 'visa required': 'Visa Required|red', 'VR': 'Visa Required|red', 'no admission': 'No Admission|red',
    'e-visa': 'e-Visa|yellow', 'eta': 'eTA|yellow', 'ETA': 'eTA|yellow', 'visa on arrival': 'Visa on Arrival|yellow', 'VOA': 'Visa on Arrival|yellow',
    'visa free': 'Visa Free|green', 'VF': 'Visa Free|green', '90': 'Visa Free (90 days)|green', '-1': 'Your passport country|green',
    '': 'No Data|grey', 'something new': 'No Data|grey' };
  Object.keys(want).forEach(k => check('"' + k + '" reads ' + want[k], st(k) === want[k], st(k)));
  check('case and spaces do not matter', st(' Visa Required ') === 'Visa Required|red');
  S.WCSV = ['Passport,Mexico,Honduras,Bahamas', 'Egypt,visa required,visa required,e-visa', 'United States,180,90,240'].join('\n');
  const r = run('visaResultsFor_(WCSV, "Mexico", [{name:"Ahmed",passportCountry:"Egypt"},{name:"Ahmed",passportCountry:"United States"}])');
  const two = run('visaResultsFor_(WCSV, "Mexico", [{name:"Ahmed",passportCountry:"Egypt"},{name:"Ahmed",passportCountry:"United States"}])');
  check('the visa-free passport comes first, the one to travel on', two.results[0].passports[0].passportCountry === 'United States' && two.results[0].passports[0].color === 'green', JSON.stringify(two.results[0].passports.map(p => p.passportCountry + ':' + p.color)));
  check('a word-format matrix gives a red Visa Required, not grey', r.results[0].passports.some(p => p.label === 'Visa Required' && p.color === 'red'), JSON.stringify(r.results));
}

// ============ a flight's route =================================================
console.log('a flight\'s route');
const route = it => { S.it = it; return run('tripFlightRoute_(it)').join(','); };
check('from the title, in order', route({ title: 'LH 1179 · OPO → FRA → IAD' }) === 'OPO,FRA,IAD', route({ title: 'LH 1179 · OPO → FRA → IAD' }));
check('from the metadata when the title has no route', route({ title: 'Flight home', metadata: '{"origin":"cdg","dest":"JFK"}' }) === 'CDG,JFK');
check('the metadata ends are added when the title misses them', route({ title: 'via FRA', metadata: '{"origin":"LIS","dest":"IAD"}' }) === 'LIS,FRA,IAD');

// ============ an address's country =============================================
console.log('\nan address\'s country');
const ctry = l => { S.l = l; return run('tripAddressCountry_(l, names)'); };
check('the last part of an address', ctry('Rua X 12, 1100-001 Lisboa, Portugal') === 'Portugal');
check('an alias: USA', ctry('1 Main St, Springfield, USA') === 'United States');
check('a city alone is not a country', ctry('Lisbon') === '' && ctry('') === '');

// ============ the countries a trip touches =====================================
console.log('\nthe countries a trip touches');
const ITEMS = [
  { type: 'flight', title: 'AF 1 · IAD → CDG → LIS', date: '2026-11-11' },  // France first as a connection…
  { type: 'flight', title: 'TP 204 · IAD → LIS', date: '2026-11-12' },
  { type: 'hotel', title: 'Alfama hotel', date: '2026-11-13', location: 'Rua X 12, 1100-001 Lisboa, Portugal' },
  { type: 'activity', title: 'Day in Paris', date: '2026-11-15', location: '5 Rue Y, 75001 Paris, France' },
  { type: 'flight', title: 'LH 1179 · OPO → FRA → IAD', date: '2026-11-19' },
  { type: 'flight', title: 'AZ 1 · LIS → FCO → JFK', date: '2026-11-20' },
];
S.items = ITEMS;
const cs = run('tripCountries_(items, names, airport, "United States")');
check('every non-home country, in date order', cs.map(c => c.country).join() === 'France,Portugal,Germany,Italy', cs.map(c => c.country).join());
check('home is never listed', !cs.some(c => c.country === 'United States'));
check('a connection-only country is a layover, naming the airport', cs.find(c => c.country === 'Germany').role === 'layover' && cs.find(c => c.country === 'Germany').via.join() === 'FRA'
      && cs.find(c => c.country === 'Italy').role === 'layover');
check('a country you stay in is a stay, even when a flight connected there first', cs.find(c => c.country === 'Portugal').role === 'stay' && cs.find(c => c.country === 'France').role === 'stay');
check('each country keeps its first and last date', cs.find(c => c.country === 'Portugal').from === '2026-11-11' && cs.find(c => c.country === 'Portugal').to === '2026-11-20');
check('an unknown airport is skipped, not guessed', run('tripCountries_([{type:"flight",title:"XYZ → QQQ",date:"2026-01-01"}], names, airport, "United States")').length === 0);
check('a different home country is the one left out', run('tripCountries_(items, names, airport, "Portugal")').some(c => c.country === 'United States'));

// ============ a place an address leaves unnamed ================================
console.log('\na place an address leaves unnamed');
{
  // A cruise: it leaves from home, and its ports are calendar events named by place only.
  S.cruise = [
    { type: 'cruise', title: 'Anniversary cruise', date: '2026-12-01', location: 'Port Canaveral, FL' },
    { type: 'activity', title: 'Port day', date: '2026-12-03', location: 'Cozumel' },
    { type: 'activity', title: 'Port day', date: '2026-12-04', location: 'Port of Roatan' },
    { type: 'activity', title: 'Sea day', date: '2026-12-05', location: 'At sea' },
    { type: 'activity', title: 'Port day', date: '2026-12-06', location: 'George Town, Cayman' },
  ];
  const asked = [];
  S.place = l => { asked.push(l); return { 'Port Canaveral, FL': 'United States', 'Cozumel': 'Mexico', 'Port of Roatan': 'Honduras' }[l] || ''; };
  const cc = run('tripCountries_(cruise, names, airport, "United States", place)');
  check('ports named by place alone are found, in date order', cc.map(c => c.country + ':' + c.role).join() === 'Mexico:stay,Honduras:stay', cc.map(c => c.country + ':' + c.role).join());
  check('…with the day you are there', cc[0].from === '2026-12-03' && cc[1].from === '2026-12-04');
  check('a place at home is still left out', !cc.some(c => c.country === 'United States'));
  check('an address that names its country is not looked up', !asked.includes('Rua X 12, 1100-001 Lisboa, Portugal') && (S.items2 = [{ type: 'hotel', date: '2026-01-01', location: 'Rua X 12, 1100-001 Lisboa, Portugal' }], run('tripCountries_(items2, names, airport, "United States", place)').length === 1) && !asked.includes('Rua X 12, 1100-001 Lisboa, Portugal'));
  check('without a resolver, a bare place is still skipped', run('tripCountries_(cruise, names, airport, "United States")').length === 0);
  const pm = (l, n) => { S.a = [l, n]; return run('tripPlaceMatches_.apply(null, a)'); };
  check('a geocoder answer counts only when the location names it', pm('Port of Roatan', 'Roatán') && pm('Cozumel', 'Cozumel') && !pm('Main dining room', 'Roma') && !pm('Cozumel', 'Coz'));
  check('ship-board and online locations are never places', !pm('At sea', 'Sea') && !pm('Deck 5, ship', 'Deck') && !pm('https://zoom.us/j/1', 'Zoom'));
}

// ============ is the passport good for the trip ================================
console.log('\nis the passport good for the trip');
const pc = (e, end, c) => { S.a = [e, end, c]; return run('tripPassportCheck_.apply(null, a)'); };
check('a Schengen country asks for 3 months past the trip', pc('2027-02-21', '2026-11-19', 'Portugal').status === 'ok' && pc('2027-02-21', '2026-11-19', 'Portugal').ruleKnown);
check('…and 2 months is short, saying so', pc('2027-01-21', '2026-11-19', 'Germany').status === 'short' && /2 months after you're back, Germany asks for 3/.test(pc('2027-01-21', '2026-11-19', 'Germany').label), pc('2027-01-21', '2026-11-19', 'Germany').label);
check('elsewhere 6 months is the common rule, flagged as one to confirm', pc('2027-03-21', '2026-11-19', 'Japan').status === 'short' && !pc('2027-03-21', '2026-11-19', 'Japan').ruleKnown && /many countries ask for 6/.test(pc('2027-03-21', '2026-11-19', 'Japan').label));
check('a passport that runs out before you\'re back', pc('2026-11-15', '2026-11-19', 'Portugal').status === 'expires');
check('no expiry recorded is unknown, pointing at Traveler Profiles', pc('', '2026-11-19', 'Portugal').status === 'unknown' && /Traveler Profiles/.test(pc('', '2026-11-19', 'Portugal').label));
check('a partial month does not count', pc('2027-02-18', '2026-11-19', 'Italy').months === 2);

// ============ the whole check ===================================================
console.log('\nthe whole check');
{
  const fetched = [];
  Object.assign(S, {
    getSpreadsheet: () => ({ getSheetByName: () => ({ getLastRow: () => 6, getRange: () => ({ getValues: () => [
      ['1', 'fx|trip', 'flight', 'TP 204 · IAD → LIS', '2026-11-12', '', '', 'IAD', '', ''],
      ['2', 'fx|trip', 'hotel', 'Alfama hotel', '2026-11-13', '', '', 'Rua X 12, 1100-001 Lisboa, Portugal', '', ''],
      ['3', 'other|trip', 'hotel', 'Elsewhere', '2026-11-13', '', '', 'Tokyo, Japan', '', ''],
      ['4', 'fx|trip', 'flight', 'LH 1179 · OPO → FRA → IAD', '2026-11-19', '', '', 'OPO', '', ''],
      ['5', 'fx|trip', 'manual', 'Note', '', '', '', '', '', '']] }) }) }),
    TABS: { ITINERARY: 'Itinerary' }, ITINERARY_HEADERS: new Array(10).fill(''),
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: d => String(d) },
    webGetProfiles_: () => ({ profiles: [
      { name: 'Ahmed', passportCountry: 'United States', passportExpiry: '2030-01-01' },
      { name: 'Ahmed', passportCountry: 'Egypt', passportExpiry: '2026-11-15' },
      { name: 'Victoria', passportCountry: 'United States', passportExpiry: '2027-01-21' },
      { name: 'Guest', passportCountry: '' }] }),
    passportIndexCsv_: () => CSV,
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    resolveIataCountry_: c => { fetched.push(c); return AIRPORTS[c] || null; },
    getConfigValues: () => ({}),
    Logger: { log: () => {} },
  });
  const r = run('webGetTripDocuments_({ tripKey: "fx|trip", endDate: "2026-11-19" })');
  check('answers ok, with home', r.ok && r.home === 'United States', JSON.stringify(r).slice(0, 200));
  check('only this trip\'s countries: Portugal (stay) and Germany (layover)', r.countries.map(c => c.country + ':' + c.role).join() === 'Portugal:stay,Germany:layover', r.countries.map(c => c.country + ':' + c.role).join());
  const pt = r.countries[0];
  check('every traveler with a passport, every passport', pt.travelers.map(t => t.name + ':' + t.passports.length).join() === 'Ahmed:2,Victoria:1', JSON.stringify(pt.travelers.map(t => t.name)));
  const ahmedEg = pt.travelers[0].passports.find(p => p.passportCountry === 'Egypt');
  check('each passport carries its visa status…', ahmedEg.label === 'Visa Required' && ahmedEg.color === 'red');
  check('…and whether it lasts the trip', ahmedEg.passport.status === 'expires' && pt.travelers[1].passports[0].passport.status === 'short');
  check('Ahmed would use his US passport, not the Egyptian one that needs a visa', pt.travelers[0].passports.find(p => p.use).passportCountry === 'United States' && !ahmedEg.use);
  check('so a country is not red for a passport nobody would use: Victoria\'s short passport makes it amber', pt.worst === 'amber' && r.countries[1].worst === 'amber', pt.worst + ',' + r.countries[1].worst);
  S.T = [{ name: 'Ahmed', passports: [{ passportCountry: 'Egypt', color: 'red', passport: { status: 'ok' } }, { passportCountry: 'United States', color: 'green', passport: { status: 'ok' } }] }];
  run('tripPickPassports_(T)');
  check('the visa-free passport is picked even when listed second', S.T[0].passports[1].use === true && S.T[0].passports[0].use === false);
  check('…and the country is green', run('tripDocWorst_(T)') === 'green');
  S.T2 = [{ name: 'Ahmed', passports: [{ passportCountry: 'Egypt', color: 'red', passport: { status: 'ok' } }, { passportCountry: 'United States', color: 'green', passport: { status: 'expires' } }] }];
  run('tripPickPassports_(T2)');
  check('a passport that runs out is no better than one that needs a visa: still red', run('tripDocWorst_(T2)') === 'red');
  S.T3 = [{ name: 'Ahmed', passports: [{ passportCountry: 'Egypt', color: 'yellow', passport: { status: 'ok' } }, { passportCountry: 'United States', color: 'green', passport: { status: 'short' } }] }];
  run('tripPickPassports_(T3)');
  check('with only amber choices, the result is amber', run('tripDocWorst_(T3)') === 'amber');
  check('a clear visa with a short passport is amber', run("tripDocWorst_([{passports:[{color:'green',passport:{status:'short'}}]}])") === 'amber' && run("tripDocWorst_([{passports:[{color:'green',passport:{status:'ok'}}]}])") === 'green');
  check('each airport is looked up once', fetched.filter(c => c === 'IAD').length === 1, JSON.stringify(fetched));
  check('without a tripKey it says so', run('webGetTripDocuments_({})').ok === false);
  check('when the itinerary read fails, the sheet rows are used', r.countries.length === 2);
}

// ============ the whole check reads what the itinerary shows ====================
console.log('\nthe whole check reads what the itinerary shows');
{
  const geo = [];
  Object.assign(S, {
    // Stored rows plus calendar events, as the Travel tab gets them.
    webGetItinerary_: (e, opts) => { S.itinArgs = [e.parameter, opts]; return { items: [
      { type: 'cruise', title: 'Anniversary cruise', date: '2026-12-01', location: 'Port Canaveral, FL', metadata: '' },
      { type: 'calendar', title: 'Cozumel', date: '2026-12-03', location: 'Cozumel', metadata: '' },
      { type: 'calendar', title: 'Sea day', date: '2026-12-05', location: 'At sea', metadata: '' },
      { type: 'calendar', title: 'Dinner', date: '2026-12-06', location: 'Main dining room', metadata: '' }] }; },
    geocodePackingDestination_: (l) => { geo.push(l); return { 'Port Canaveral, FL': { name: 'Port Canaveral', country: 'United States' },
      'Cozumel': { name: 'Cozumel', country: 'Mexico' }, 'Main dining room': { name: 'Roma', country: 'Italy' } }[l] || null; },
    Logger: { log: () => {} },
  });
  const r = run('webGetTripDocuments_({ tripKey: "fx|cruise", startDate: "2026-12-01", endDate: "2026-12-08" })');
  check('calendar ports count: Mexico is found', r.ok && r.countries.map(c => c.country).join() === 'Mexico', JSON.stringify(r.countries && r.countries.map(c => c.country)));
  check('…read for this trip\'s dates, without the per-event timezone pass', S.itinArgs[0].tripKey === 'fx|cruise' && S.itinArgs[0].startDate === '2026-12-01' && S.itinArgs[0].endDate === '2026-12-08' && S.itinArgs[1].skipEventTz === true);
  check('a geocoder guess the location does not name is dropped', !r.countries.some(c => c.country === 'Italy'));
  check('"At sea" is never looked up', !geo.includes('At sea'), JSON.stringify(geo));
  check('the route is wired', /case 'trip_documents':\s+return jsonOut_\(webGetTripDocuments_\(e\.parameter\)\);/.test(WEB));
  delete S.webGetItinerary_;
}

// ============ how far the trip reaches ==========================================
console.log('\nhow far the trip reaches');
{
  // Offsets by zone, with one zone that changes on a date (daylight saving).
  S.off = (z, d) => ({ 'America/New_York': d >= '2026-11-01' ? -5 : -4, 'America/Cancun': -5, 'America/Tegucigalpa': -6, 'America/Puerto_Rico': -4 })[z] ?? null;
  S.mi = (a, b) => Math.round(Math.hypot(a.lat - b.lat, a.lon - b.lon) * 69);
  S.tzOffsetLabel_ = h => (h > 0 ? '+' : '-') + Math.abs(h) + 'h';
  vm.runInContext('var tzOffsetLabel_ = this.tzOffsetLabel_;', S);
  S.P = [
    { name: 'Miami', lat: 25.8, lon: -80.2, timezone: 'America/New_York', date: '2026-11-06' },
    { name: 'Cozumel', lat: 20.4, lon: -86.9, timezone: 'America/Cancun', date: '2026-11-09' },
    { name: 'Roatan', lat: 16.3, lon: -86.5, timezone: 'America/Tegucigalpa', date: '2026-11-10' },
    { name: 'Somewhere', lat: 10, lon: -60, timezone: '', date: '2026-11-11' }];
  S.H = { lat: 38.9, lon: -77.0 };
  const r = run('tripReach_(P, H, "America/New_York", off, mi)');
  check('the biggest clock change, measured on its own date', r.shift.name === 'Roatan' && r.shift.hours === -1 && r.shift.label === '-1h', JSON.stringify(r.shift));
  S.P3 = [S.P[3]];
  check('a place with no known zone is left out, not counted as zero', r.shift.name !== 'Somewhere' && run('tripReach_(P3, H, "America/New_York", off, mi)').shift === null);
  check('the farthest place from home', r.farthest.name === 'Somewhere' && r.farthest.miles > 0, JSON.stringify(r.farthest));
  S.P2 = [{ name: 'Miami', lat: 25.8, lon: -80.2, timezone: 'America/New_York', date: '2026-11-06' }, { name: 'Cozumel', lat: 20.4, lon: -86.9, timezone: 'America/Cancun', date: '2026-11-09' }];
  check('every stop on home time reads Same as home', run('tripReach_(P2, H, "America/New_York", off, mi)').shift.label === 'Same as home');
  check('no home, no distance; still a shift', run('tripReach_(P2, null, "America/New_York", off, mi)').farthest === null && run('tripReach_(P2, null, "America/New_York", off, mi)').shift !== null);
  const pz = (m, g) => { S.a = [m, g]; return run('tripPlaceZone_.apply(null, a)'); };
  check('the calendar event\'s own zone wins over a lookup', pz('{"startTz":"America/Puerto_Rico"}', 'Europe/London') === 'America/Puerto_Rico');
  check('a looked-up zone is used when the event has none', pz('{}', 'America/Nassau') === 'America/Nassau' && pz('', 'America/Nassau') === 'America/Nassau');
  check('a bare GMT/UTC from the geocoder is unknown, never "+5h"', pz('{}', 'GMT') === '' && pz('{}', 'UTC') === '' && pz('{}', 'Etc/GMT') === '');
  check('the reach reads events with their own timezones', /tripItemsFor_\(tripKey, String\(params\.startDate \|\| ''\), String\(params\.endDate \|\| ''\), 'trip_reach', true\)/.test(WEB));
  check('the route is wired', /case 'trip_reach':\s+return jsonOut_\(webTripReach_\(e\.parameter\)\);/.test(WEB));
}

// ============ the matrix is cached in pieces ====================================
console.log('\nthe visa matrix in the cache');
{
  const W = vm.createContext({});
  vm.runInContext([WEB.match(/var CACHE_CHUNK_ = \d+;/)[0], extractFn(WEB, 'cachePutChunked_'), extractFn(WEB, 'cacheGetChunked_')].join('\n'), W);
  const store = {};
  W.cache = { putAll: (o) => { Object.keys(o).forEach(k => { if (o[k].length > 100000) throw new Error('Argument too large: value'); store[k] = o[k]; }); },
              get: k => (k in store ? store[k] : null), getAll: ks => { const o = {}; ks.forEach(k => { if (k in store) o[k] = store[k]; }); return o; } };
  W.big = 'x'.repeat(250000) + 'END';
  vm.runInContext('cachePutChunked_(cache, "m", big, 60)', W);
  check('a value over the 100 KB limit is stored in pieces, each under it', Object.keys(store).length === 4 && Object.values(store).every(v => v.length <= 100000));
  check('…and read back whole', vm.runInContext('cacheGetChunked_(cache, "m")', W) === W.big);
  delete store.m_1;
  check('a missing piece reads as nothing cached, not half a matrix', vm.runInContext('cacheGetChunked_(cache, "m")', W) === null);
  check('the fetch is not lost when caching fails', /try \{ cachePutChunked_\(cache, 'passport_index_csv', csv, 21600\); \}\s*catch/.test(WEB));
}

// ============ the forecast for each day =========================================
console.log('\nthe forecast for each day');
{
  const calls = [];
  const W = vm.createContext({ JSON, Math, Date, Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    tripDailyForecast_: (city, from, to) => { calls.push([city, from, to]); return [
      { date: from, tMax: 64.4, tMin: 52.1, code: 3, precipMm: 0 }, { date: to, tMax: 60, tMin: null, code: 61, precipMm: 4 }]; } });
  vm.runInContext(extractFn(WEB, 'webTripWeather_'), W);
  const iso = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  W.p = { days: JSON.stringify({ [iso(1)]: 'Lisboa', [iso(2)]: 'Lisboa', [iso(3)]: 'Porto', [iso(4)]: 'Home', [iso(30)]: 'Porto' }) };
  const r = vm.runInContext('webTripWeather_(p)', W);
  check('one forecast per city, not per day', calls.length === 2 && calls[0][0] === 'Lisboa' && calls[0][1] === iso(1) && calls[0][2] === iso(2), JSON.stringify(calls));
  check('highs and lows rounded, with the weather code', r.ok && r.days[iso(1)].hi === 64 && r.days[iso(1)].lo === 52 && r.days[iso(1)].code === 3, JSON.stringify(r.days));
  check('beyond the forecast window, nothing is asked for', calls.every(c => c[2] <= iso(16)));
  check('home is not forecast', !Object.keys(r.days).includes(iso(4)));
  check('bad input is refused', vm.runInContext('webTripWeather_({ days: "{" })', W).ok === false);
  check('the route is wired', /case 'trip_weather':\s+return jsonOut_\(webTripWeather_\(e\.parameter\)\);/.test(WEB));
}

// ============ the old visa check is unchanged ===================================
console.log('\nthe Visa check it grew from');
{
  const r = run('webGetVisaRequirements_({ destination: "Germany" })');
  check('one destination still answers per person', r.ok && r.destination === 'Germany' && r.results.map(x => x.name).join() === 'Ahmed,Victoria', JSON.stringify(r).slice(0, 200));
  check('…with the visa label it always had', r.results[1].passports[0].label === 'Visa Free (90 days)');
  check('an unknown destination still says so', /not found/.test(run('webGetVisaRequirements_({ destination: "Atlantis" })').note));
  check('the route is wired', /case 'trip_documents':\s+return jsonOut_\(webGetTripDocuments_\(e\.parameter\)\);/.test(WEB));
}

console.log('\nthe Bucket List pills');
{
  const pill = '"🛂 ",person.name," · ",best.label,person.passports.length>1&&best.passportCountry?" · "+best.passportCountry+" passport":"")';
  check('both dashboards show the best passport, and name it when there are two',
    ['docs/app.js', 'docs/dashboard-lite.html'].every(f => { const src = fs.readFileSync(path.join(ROOT, f), 'utf8'); return src.indexOf('var best=(person.passports||[])[0];') !== -1 && src.indexOf(pill) !== -1; }));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
