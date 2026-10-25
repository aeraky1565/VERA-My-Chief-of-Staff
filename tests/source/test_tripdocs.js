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
vm.runInContext([extractVar(WEB, 'VISA_ALIASES_'), extractVar(WEB, 'SCHENGEN_'),
  ...['visaNorm_', 'visaResultsFor_', 'visaStatusLabel_', 'visaStatusColor_', 'tripFlightRoute_', 'tripAddressCountry_', 'tripCountries_',
      'tripPassportCheck_', 'tripDocWorst_', 'webGetTripDocuments_', 'webGetVisaRequirements_'].map(n => extractFn(WEB, n))].join('\n'), S);
const run = code => vm.runInContext(code, S);
S.CSV = CSV;
S.names = {}; CSV.split('\n')[0].split(',').slice(1).forEach(h => { S.names[h.toLowerCase().replace(/[^a-z0-9]/g, '')] = h; });
S.airport = c => AIRPORTS[c] || '';

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
  });
  const r = run('webGetTripDocuments_({ tripKey: "fx|trip", endDate: "2026-11-19" })');
  check('answers ok, with home', r.ok && r.home === 'United States', JSON.stringify(r).slice(0, 200));
  check('only this trip\'s countries: Portugal (stay) and Germany (layover)', r.countries.map(c => c.country + ':' + c.role).join() === 'Portugal:stay,Germany:layover', r.countries.map(c => c.country + ':' + c.role).join());
  const pt = r.countries[0];
  check('every traveler with a passport, every passport', pt.travelers.map(t => t.name + ':' + t.passports.length).join() === 'Ahmed:2,Victoria:1', JSON.stringify(pt.travelers.map(t => t.name)));
  const ahmedEg = pt.travelers[0].passports.find(p => p.passportCountry === 'Egypt');
  check('each passport carries its visa status…', ahmedEg.label === 'Visa Required' && ahmedEg.color === 'red');
  check('…and whether it lasts the trip', ahmedEg.passport.status === 'expires' && pt.travelers[1].passports[0].passport.status === 'short');
  check('a country\'s chip shows its worst result', pt.worst === 'red' && r.countries[1].worst === 'red');
  check('a clear visa with a short passport is amber', run("tripDocWorst_([{passports:[{color:'green',passport:{status:'short'}}]}])") === 'amber' && run("tripDocWorst_([{passports:[{color:'green',passport:{status:'ok'}}]}])") === 'green');
  check('each airport is looked up once', fetched.filter(c => c === 'IAD').length === 1, JSON.stringify(fetched));
  check('without a tripKey it says so', run('webGetTripDocuments_({})').ok === false);
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
