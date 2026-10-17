// What a packing list or a Discover run was actually built from.
//
// The failure this exists to make visible had been live for as long as dashboard-lite
// could generate packing lists: it never sent an end date, so the weather lookup went
// out with end_date= and failed at the weather service, and every list it produced
// was built with no weather — with nothing anywhere saying so. Discover, meanwhile,
// never used the weather or the time of year at all, and the season ignored the
// hemisphere.
//
// So this file holds to account: each factor's status in every state, the season
// south of the equator, the weather lookup saying WHY it has nothing (and not calling
// the service at all without dates), the regenerate that keeps your checkmarks, the
// flags — one per generation, exact keys, superseded ones closed, resolved ones left
// resolved — the nightly forecast nudge, Discover's prompt, and lite's end date.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const GI   = read('GenerationInputs.js');
const CODE = read('Code.js');
const WEB  = read('WebApp.js');
const APP  = read('docs/app.js');
const LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', src.indexOf(')', start)); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const pad = n => String(n).padStart(2, '0');
function formatDate(d, tz, fmt) {
  const Y = d.getFullYear(), M = pad(d.getMonth() + 1), D = pad(d.getDate());
  const h = pad(d.getHours()), m = pad(d.getMinutes()), s = pad(d.getSeconds());
  if (fmt === 'yyyy-MM-dd') return Y + '-' + M + '-' + D;
  if (fmt === "yyyy-MM-dd'T'HH:mm:ss") return Y + '-' + M + '-' + D + 'T' + h + ':' + m + ':' + s;
  if (fmt === 'yyyyMMddHHmmss') return '' + Y + M + D + h + m + s;
  throw new Error('format ' + fmt);
}

// A sheet that behaves enough like Apps Script's for these readers and writers.
function fakeSheet(rows) {
  const sh = {
    rows,
    getLastRow: () => rows.length + 1,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 2, r - 2 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
      setValues: vals => { vals.forEach((v, i) => { const row = rows[r - 2 + i] || (rows[r - 2 + i] = []); v.forEach((x, j) => { row[c - 1 + j] = x; }); }); return { setFontWeight() {} }; },
      setValue: v => { rows[r - 2][c - 1] = v; },
    }),
    appendRow: row => rows.push(row.slice()),
    setFrozenRows() {},
  };
  return sh;
}

function sandbox(over) {
  const S = Object.assign({
    Utilities: { formatDate },
    Session:   { getScriptTimeZone: () => 'America/New_York' },
    Logger:    { log() {} },
    TABS:      { FLAGS: 'Flags', PACKING_ITEMS: 'PackingItems', TRIP_RECOMMENDATIONS: 'TripRecommendations' },
    colorCodeFlags() {},
    console, Date, JSON, Math,
  }, over || {});
  vm.createContext(S);
  vm.runInContext(GI, S);
  vm.runInContext(extractFn(CODE, 'appendExactKeyFlags_'), S);
  vm.runInContext(extractFn(CODE, 'resolveFlagsWithPrefix_'), S);
  return S;
}

const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const inDays = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };

// ============ the season ===================================================

console.log('tripSeason_: the hemisphere is the destination’s, not assumed');
{
  const S = sandbox();
  const s = (d, lat) => vm.runInContext('tripSeason_(' + JSON.stringify(d) + ', ' + JSON.stringify(lat) + ')', S);
  check('December in Chicago is Winter', s('2026-12-20', 41.9).season === 'Winter');
  check('December in Sydney is Summer', s('2026-12-20', -33.9).season === 'Summer', s('2026-12-20', -33.9).season);
  check('July in Cape Town is Winter', s('2027-07-10', -33.9).season === 'Winter');
  check('near the equator there’s no season to name', /Tropical/.test(s('2027-03-01', 1.3).season), s('2027-03-01', 1.3).season);
  // The November cruise: its ports sit at 18–19°N. A 15° cut-off called them "Fall".
  check('Puerto Plata (19.8°N) in November is tropical', /Tropical/.test(s('2026-11-10', 19.8).season), s('2026-11-10', 19.8).season);
  check('Saint Thomas (18.3°N) too', /Tropical/.test(s('2026-11-11', 18.3).season));
  check('Miami (25.8°N), just outside the Tropics, is Fall', s('2026-11-06', 25.8).season === 'Fall', s('2026-11-06', 25.8).season);
  check('…and the far south is still flipped (Rio, 22.9°S, is tropical; Buenos Aires, 34.6°S, is Spring in November)',
        /Tropical/.test(s('2026-11-06', -22.9).season) && s('2026-11-06', -34.6).season === 'Spring');
  check('no latitude: northern, and SAID to be an assumption', s('2026-12-20', null).basis === 'assumed-north' && s('2026-12-20', null).season === 'Winter');
  check('no date: no season', s('', 40).season === '');
}

// ============ the factors ==================================================

const GOOD = {
  destination: { value: 'Chicago, IL', source: 'flight' },
  startDate: '2026-10-20', endDate: '2026-10-24',
  weather: { summary: 'Expected: 48–61°F, some rain. Mild.', mode: 'forecast', reason: '', lat: 41.9 },
  activityTypes: { flight: true, hotel: true, dining: true },
  itinCount: 6, traits: 'city, museums', traveler: 'both',
  dressCodes: ['smart casual'], lessons: '- Pack an umbrella\n- Skip the heavy coat', lessonsError: '',
};
const fx = (S, fn, g) => { S.g = g; return vm.runInContext(fn + '(g)', S); };
const by = (fs_, id) => fs_.find(f => f.id === id);

console.log('\npacking factors: all eight, each in every state');
{
  const S = sandbox();
  const f = fx(S, 'packingInputFactors_', GOOD);
  check('eight factors', f.length === 8, f.map(x => x.id).join(','));
  check('a well-grounded list: every factor used', f.every(x => x.status === 'used'), f.filter(x => x.status !== 'used').map(x => x.id + ':' + x.status).join(', '));
  check('the destination says where it came from', /Chicago, IL \(from the flight\)/.test(by(f, 'destination').detail), by(f, 'destination').detail);
  check('time of year comes from the destination’s hemisphere', /Fall/.test(by(f, 'dates').detail), by(f, 'dates').detail);
  check('the weather says it’s a forecast', /^Forecast:/.test(by(f, 'weather').detail));
  check('lessons are counted', by(f, 'lessons').detail === '2 applied', by(f, 'lessons').detail);

  const one = (over, id) => by(fx(S, 'packingInputFactors_', Object.assign({}, GOOD, over)), id);
  check('no destination → missing, with a fix', one({ destination: { value: '', source: '' } }, 'destination').status === 'missing' &&
        /flight or a hotel/.test(one({ destination: { value: '', source: '' } }, 'destination').hint));
  const lbl = one({ destination: { value: 'Alaska Cruise', source: 'label' } }, 'destination');
  check('a destination guessed from the trip name is WEAK, and says so', lbl.status === 'weak' && /guessed from the trip/.test(lbl.detail), JSON.stringify(lbl));

  // THE LITE BUG, as the record would have shown it.
  const lite = fx(S, 'packingInputFactors_', Object.assign({}, GOOD, { endDate: '', weather: { summary: '', mode: '', reason: 'no trip dates (end date missing)', lat: null } }));
  check('no end date → dates missing', by(lite, 'dates').status === 'missing' && /No end date/.test(by(lite, 'dates').detail), by(lite, 'dates').detail);
  check('…and weather missing, saying why', by(lite, 'weather').status === 'missing' && /end date missing/.test(by(lite, 'weather').detail), by(lite, 'weather').detail);

  const ly = one({ weather: { summary: '(Last year’s weather on these dates) Expected: 40–55°F', mode: 'last_year', lat: 41.9 } }, 'weather');
  check('last year’s weather is WEAK, labelled for what it is', ly.status === 'weak' && /^Last year’s weather on these dates: Expected/.test(ly.detail), ly.detail);
  check('…with when a forecast arrives', /14 days/.test(ly.hint));
  check('no latitude → the season is flagged as assumed',
        one({ weather: { summary: 'x', mode: 'forecast', lat: null } }, 'dates').status === 'weak');
  check('empty itinerary → missing', one({ itinCount: 0 }, 'activities').status === 'missing');
  check('no characteristics → missing', one({ traits: '' }, 'characteristics').status === 'missing');
  // Blank is the default (Both), as both dashboards and the packing prompt treat it —
  // the banner on the November cruise wrongly called it "Not set".
  const tv = one({ traveler: '' }, 'travellers');
  check('blank travellers is the default, not missing: used, "Ahmed and Victoria"', tv.status === 'used' && /Ahmed and Victoria/.test(tv.detail), JSON.stringify(tv));
  const ports = [{ label: 'Puerto Plata, Dominican Republic' }, { label: 'Tortola, British Virgin Islands' }];
  const dst = one({ destination: { value: 'Miami MIA', label: 'Miami, Florida', source: 'flight' }, ports }, 'destination');
  check('the destination shows the resolved place and the cruise stops',
        dst.detail === 'Miami, Florida (from the flight) · cruise stops: Puerto Plata, Dominican Republic, Tortola, British Virgin Islands', dst.detail);
  check('no dress codes is normal: NONE, not a warning', one({ dressCodes: [] }, 'dresscodes').status === 'none');
  check('no lessons that apply is normal: NONE', one({ lessons: '' }, 'lessons').status === 'none');
  check('lessons that couldn’t be read ARE a problem', one({ lessonsError: 'Memory Log not found' }, 'lessons').status === 'missing');
}

console.log('\nDiscover factors');
{
  const S = sandbox();
  const f = fx(S, 'discoverInputFactors_', GOOD);
  check('Discover’s six: destination, dates, weather, characteristics, itinerary, lessons',
        f.map(x => x.id).join(',') === 'destination,dates,weather,characteristics,itinerary,lessons', f.map(x => x.id).join(','));
  const lbl = by(fx(S, 'discoverInputFactors_', Object.assign({}, GOOD, { destination: { value: 'First Anniversary', source: 'label' } })), 'destination');
  check('a name-only destination is weak, and says it isn’t searched as a place', lbl.status === 'weak' && /isn’t used as a place/.test(lbl.detail), lbl.detail);
}

console.log('\nthe flag’s one-line summary');
{
  const S = sandbox();
  S.f = fx(S, 'packingInputFactors_', Object.assign({}, GOOD, { traits: '', weather: { summary: '', reason: 'couldn’t find "Nowhere" on the map', lat: null } }));
  const sum = vm.runInContext('genProblemSummary_(genProblems_(f))', S);
  check('names each problem and its reason', /no weather \(couldn’t find "Nowhere" on the map\)/.test(sum) && /no trip characteristics/.test(sum), sum);
}

// ============ the weather lookup says why ===================================

console.log('\ngetPackingWeatherDetail_: a reason whenever there’s no weather');
{
  function W(over) {
    const calls = [];
    const S = Object.assign({
      CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
      Logger: { log() {} }, JSON, Math, Date,
      geocodePackingDestination_: d => d === 'Nowhere' ? null : { lat: d === 'Sydney' ? -33.9 : 41.9, lon: 1 },
      fetchWithHealth_: (svc, url) => { calls.push(url); return S.answer; },
      answer: { getContentText: () => JSON.stringify({ daily: { temperature_2m_max: [60, 64], temperature_2m_min: [45, 50], precipitation_sum: [0, 3] } }) },
    }, over || {});
    vm.createContext(S);
    vm.runInContext(extractFn(WEB, 'getPackingWeatherDetail_'), S);
    vm.runInContext(extractFn(WEB, 'getPackingWeather_'), S);
    S.calls = calls;
    return S;
  }
  const S = W();
  const d = (dest, a, b) => { S.a = [dest, a, b]; return vm.runInContext('getPackingWeatherDetail_(a[0], a[1], a[2])', S); };
  check('no destination: says so', /no destination/.test(d('', inDays(5), inDays(8)).reason));

  // THE LITE BUG. No end date must be caught HERE, not sent to the weather service.
  const before = S.calls.length;
  const noEnd = d('Chicago', inDays(5), '');
  check('no end date: says so', noEnd.reason === 'no trip dates (end date missing)', noEnd.reason);
  check('…and never calls the weather service', S.calls.length === before, S.calls.slice(before).join(' '));

  check('a place that can’t be found: named', /couldn’t find "Nowhere"/.test(d('Nowhere', inDays(5), inDays(8)).reason));
  const near = d('Chicago', inDays(5), inDays(8));
  check('within 14 days: a forecast', near.mode === 'forecast' && /^Expected/.test(near.summary), JSON.stringify(near));
  check('…carrying the latitude for the season', near.lat === 41.9);
  const far = d('Sydney', inDays(40), inDays(44));
  check('beyond 14 days: last year’s weather, called that', far.mode === 'last_year' && /^\(Last year’s weather on these dates\)/.test(far.summary), far.summary);
  check('…not "seasonal average"', !/Seasonal average/i.test(far.summary));
  check('the wrapper still returns just the text', vm.runInContext('getPackingWeather_("Chicago", ' + JSON.stringify(inDays(5)) + ', ' + JSON.stringify(inDays(8)) + ')', S) === near.summary);

  const S2 = W({ answer: null });
  S2.a = ['Chicago', inDays(5), inDays(8)];
  check('the service not answering: said', /didn’t answer/.test(vm.runInContext('getPackingWeatherDetail_(a[0], a[1], a[2])', S2).reason));
}

// ============ regenerate keeps checkmarks ===================================

console.log('\nplanPackingRegeneration_: nothing you’ve packed is lost');
{
  const S = sandbox();
  S.rows = [
    { rowNum: 2, id: 'P1', person: 'victoria', item: 'Sunscreen',      checked: true,  source: 'ai' },
    { rowNum: 3, id: 'P2', person: 'ahmed',    item: 'Wool socks',     checked: true,  source: 'ai' },
    { rowNum: 4, id: 'P3', person: 'ahmed',    item: 'Phone charger',  checked: false, source: 'ai' },
    { rowNum: 5, id: 'P4', person: 'shared',   item: 'Passports',      checked: false, source: 'manual' },
    { rowNum: 6, id: 'P5', person: 'shared',   item: 'Umbrella',       checked: false, source: 'ai' },
  ];
  S.next = [
    { person: 'victoria', category: 'Toiletries', item: 'sunscreen ' },   // same item, other case and spacing
    { person: 'ahmed',    category: 'Tech',       item: 'Phone charger' },
    { person: 'shared',   category: 'Gear',       item: 'Rain jackets' },
    { person: 'shared',   category: 'Gear',       item: 'Rain Jackets' },  // the model repeated itself
  ];
  const p = vm.runInContext('planPackingRegeneration_(rows, next)', S);
  check('only UNCHECKED AI items are deleted', JSON.stringify(p.deleteRows) === '[6,4]', JSON.stringify(p.deleteRows));
  check('…bottom-up, so row numbers stay valid', p.deleteRows[0] > p.deleteRows[1]);
  check('your own items are never touched', p.deleteRows.indexOf(5) === -1);
  check('a checked item the new list repeats isn’t added twice', !p.append.some(a => /sunscreen/i.test(a.item)), JSON.stringify(p.append));
  check('the new list’s items are added once each', p.append.map(a => a.item).join('|') === 'Phone charger|Rain jackets', p.append.map(a => a.item).join('|'));
  check('a checked item the new list DROPPED is kept, and named', p.keptDropped.length === 1 && p.keptDropped[0].item === 'Wool socks' && p.keptDropped[0].person === 'ahmed', JSON.stringify(p.keptDropped));
}

// ============ the record and its flags ======================================

function world() {
  const flags = [], inputs = [];
  const S = sandbox({
    getSpreadsheet: () => ({
      getSheetByName: n => n === 'Flags' ? S.flagSheet : n === 'Generation Inputs' ? S.inputSheet : null,
      insertSheet: () => (S.inputSheet = fakeSheet(inputs)),
    }),
  });
  S.flagSheet = fakeSheet(flags);
  S.inputSheet = null;
  S.flags = flags; S.inputs = inputs;
  return S;
}
const open = S => S.flags.filter(r => String(r[8]).toLowerCase() !== 'yes');

console.log('\nrecordGenerationInputs_: one record per trip and kind, one flag per generation');
{
  const S = world();
  S.trip = inDays(30) + '|Chicago trip';
  S.bad  = fx(S, 'packingInputFactors_', Object.assign({}, GOOD, { traits: '' }));
  S.good = fx(S, 'packingInputFactors_', GOOD);

  const r1 = vm.runInContext('recordGenerationInputs_("packing", trip, bad, { weatherMode: "forecast", kept: [] })', S);
  check('the record is saved, and creates its tab', !!r1 && S.inputs.length === 1 && S.inputs[0][1] === 'packing', JSON.stringify(S.inputs[0] && S.inputs[0].slice(0, 3)));
  check('…and reads back', vm.runInContext('readGenerationInputs_(trip, "packing")', S).factors.length === 8);
  check('a weak or missing factor raises one flag', open(S).length === 1 && /Packing list for Chicago trip may be off: no trip characteristics/.test(open(S)[0][3]), open(S).map(r => r[3]).join(' | '));
  check('…keyed exactly to this generation', open(S)[0][9] === 'gen_inputs__packing__' + vm.runInContext('genSlug_(trip)', S) + '__' + r1.stamp, open(S)[0][9]);
  check('…Low, since the trip is weeks away', open(S)[0][5] === 'Low');

  // Regenerate (a different second, so a different stamp) with the fault fixed.
  S.Date = class extends Date { constructor(...a) { if (a.length) super(...a); else super(Date.now() + 2000); } static now() { return Date.now() + 2000; } };
  vm.runInContext('Date = this.Date', S);
  vm.runInContext('recordGenerationInputs_("packing", trip, good, { weatherMode: "forecast", kept: [] })', S);
  check('regenerating replaces the record rather than adding one', S.inputs.length === 1);
  check('…closes the earlier generation’s flag', open(S).length === 0, open(S).map(r => r[9]).join(', '));
  check('…and raises none, since nothing is missing now', S.flags.length === 1);

  S.trip2 = inDays(5) + '|Chicago';
  vm.runInContext('recordGenerationInputs_("discover", trip2, bad, { weatherMode: "forecast" })', S);
  check('within two weeks the flag is Medium', open(S).length === 1 && open(S)[0][5] === 'Medium', open(S).map(r => r[5]).join(','));

  const S2 = world();
  S2.getSpreadsheet = () => { throw new Error('spreadsheet unavailable'); };
  vm.runInContext('getSpreadsheet = this.getSpreadsheet', S2);
  S2.trip = inDays(30) + '|Chicago';
  S2.f = fx(S2, 'packingInputFactors_', GOOD);
  let threw = false, out;
  try { out = vm.runInContext('recordGenerationInputs_("packing", trip, f, {})', S2); } catch (e) { threw = true; }
  check('never throws: a list that generated fine doesn’t fail on its receipt', !threw && out === null);
}

console.log('\nflag keys can’t collide across similar trips');
{
  const S = world();
  const k = (t) => vm.runInContext('genFlagKey_("inputs", "packing", ' + JSON.stringify(t) + ')', S) + '__';
  const a = k('2026-10-20|Chicago'), b = k('2026-10-20|Chicago weekend');
  check('"Chicago" isn’t a prefix of "Chicago weekend"', b.indexOf(a) !== 0, a + ' vs ' + b);

  S.flags.push(['F1', '', 'Travel', 'x', '', 'Low', 'No', '', 'No', 'gen_inputs__packing__2026_10_20_chicago_weekend__20261001000000', '']);
  vm.runInContext('resolveFlagsWithPrefix_(flagSheet, ' + JSON.stringify(a) + ', "")', S);
  check('closing one trip’s flags leaves the other trip’s open', open(S).length === 1);

  // And the fuzzy dedupe that would have merged them is not in the path.
  check('the record’s flags go through the exact-key writer, not writeFlags',
        /appendExactKeyFlags_\(flagSheet, want, dateStr\)/.test(GI) && !/writeFlags\(/.test(GI));
}

console.log('\nnightly: an old list, and a forecast that has arrived');
{
  const S = world();
  const want = (item, rec) => { S.item = item; S.rec = rec; return vm.runInContext('genNightlyFlagsFor_(item, rec)', S); };
  const old = want({ kind: 'packing', tripKey: inDays(20) + '|Lisbon', daysUntil: 20 }, null);
  check('no record → "built before VERA recorded what it used"', old.length === 1 && /built before VERA recorded/.test(old[0].flag) && /Lisbon/.test(old[0].flag), old.map(f => f.flag).join());
  const fc = want({ kind: 'packing', tripKey: inDays(10) + '|Lisbon', daysUntil: 10 }, { weatherMode: 'last_year', stamp: '20261001000000' });
  check('last year’s weather, 10 days out → a forecast is now available', fc.length === 1 && /forecast is now available/.test(fc[0].flag), fc.map(f => f.flag).join());
  check('…and the checked items are said to be kept', /checked items are kept/.test(fc[0].reason));
  check('last year’s weather, 20 days out → nothing yet',
        want({ kind: 'packing', tripKey: inDays(20) + '|L', daysUntil: 20 }, { weatherMode: 'last_year', stamp: '1' }).length === 0);
  check('already built on a forecast → nothing',
        want({ kind: 'discover', tripKey: inDays(5) + '|L', daysUntil: 5 }, { weatherMode: 'forecast', stamp: '1' }).length === 0);

  S.due = fc.concat(old);
  vm.runInContext('appendExactKeyFlags_(flagSheet, due, "2026-10-17")', S);
  vm.runInContext('appendExactKeyFlags_(flagSheet, due, "2026-10-18")', S);
  check('raised once, not every night', S.flags.length === 2, S.flags.length);
  S.flags[0][8] = 'Yes';
  vm.runInContext('appendExactKeyFlags_(flagSheet, due, "2026-10-19")', S);
  check('a resolved one stays resolved', S.flags.length === 2 && open(S).length === 1);
}

console.log('\ngenTripDates_: never generate blind for want of an end date');
{
  const S = world();
  S.tripIdForKey_ = () => 'TRIP-1';
  S.getTripById_  = () => ({ endDate: '2026-10-24' });
  const d = vm.runInContext('genTripDates_("2026-10-20|Chicago", "", "")', S);
  check('the start comes from the trip key, the end from the trip', d.startDate === '2026-10-20' && d.endDate === '2026-10-24', JSON.stringify(d));
  check('what the caller sent wins', vm.runInContext('genTripDates_("2026-10-20|Chicago", "2026-10-21", "2026-10-23")', S).endDate === '2026-10-23');
  S.getTripById_ = () => { throw new Error('registry down'); };
  check('a failed lookup leaves the end empty, honestly', vm.runInContext('genTripDates_("2026-10-20|C", "", "")', S).endDate === '');
}

// ============ Discover’s prompt ===========================================

console.log('\nDiscover now sees the weather, the time of year and the trip characteristics');
{
  const C = { getConfigValues: () => ({}), String, parseInt };
  vm.createContext(C);
  vm.runInContext(extractFn(WEB, 'buildRecsUserPrompt_'), C);
  const full = vm.runInContext('buildRecsUserPrompt_("Sydney trip", "2026-12-20", "2026-12-27", "7", "Leisure", "Sydney", "", "gaps", "", "", "Expected: 70–85°F, frequent rain.", "Summer", "beach, snorkelling")', C);
  check('the time of year at the destination', /Time of year at the destination: Summer/.test(full));
  check('the trip characteristics', /Trip characteristics: beach, snorkelling/.test(full));
  check('the weather', /Weather: Expected: 70–85°F, frequent rain\./.test(full));
  check('…and an instruction to fit it', /Fit the weather above/.test(full));
  const bare = vm.runInContext('buildRecsUserPrompt_("T", "2026-12-20", "2026-12-27", "7", "", "", "", "gaps", "", "")', C);
  check('nothing said when there’s nothing to say', !/Time of year|Trip characteristics|Weather:|Fit the weather/.test(bare));
}

// ============ the geocoder: what Open-Meteo can actually find ===============
//
// The strings below are the November cruise's REAL itinerary locations. Open-Meteo's
// geocoder matches place names and postal codes, never a street address — so the
// hotel's address found nothing, and the trip lost its weather and its hemisphere.

const KIMPTON = 'Kimpton Surfcomber Hotel\n1717 Collins Ave, Miami Beach, FL  33139, United States';

// A stand-in for Open-Meteo's geocoder that behaves like the real one: it finds a
// NAME (or a postal code), honours countryCode, and finds nothing for an address.
const PLACES_DB = {
  'miami':             [{ name: 'Miami', latitude: 25.77, longitude: -80.19, admin1: 'Florida', country: 'United States', country_code: 'US', timezone: 'America/New_York' }],
  'miami beach':       [{ name: 'Miami Beach', latitude: 25.79, longitude: -80.13, admin1: 'Florida', country: 'United States', country_code: 'US', timezone: 'America/New_York' }],
  '33139':             [{ name: 'Miami Beach', latitude: 25.79, longitude: -80.13, admin1: 'Florida', country: 'United States', country_code: 'US', timezone: 'America/New_York' }],
  'puerto plata':      [{ name: 'Puerto Plata', latitude: 19.79, longitude: -70.69, admin1: 'Puerto Plata', country: 'Dominican Republic', country_code: 'DO' }],
  // By population, Ontario's comes first — the trap the hint exists for.
  'saint thomas':      [{ name: 'St. Thomas', latitude: 42.78, longitude: -81.19, admin1: 'Ontario', country: 'Canada', country_code: 'CA' },
                        { name: 'Saint Thomas', latitude: 18.34, longitude: -64.93, admin1: 'Saint Thomas Island', country: 'U.S. Virgin Islands', country_code: 'VI' }],
  'tortola':           [{ name: 'Tortola', latitude: 18.43, longitude: -64.62, admin1: '', country: 'British Virgin Islands', country_code: 'VG' }],
  'great stirrup cay': [{ name: 'Great Stirrup Cay', latitude: 25.82, longitude: -77.92, admin1: 'Berry Islands', country: 'Bahamas', country_code: 'BS' }],
  'washington':        [{ name: 'Washington', latitude: 38.9, longitude: -77.04, admin1: 'District of Columbia', country: 'United States', country_code: 'US' }],
  'düsseldorf':        [{ name: 'Düsseldorf', latitude: 51.22, longitude: 6.78, admin1: 'North Rhine-Westphalia', country: 'Germany', country_code: 'DE' }],
};
function geoWorld() {
  const store = {}, asked = [];
  const S = {
    CacheService: { getScriptCache: () => ({ get: k => store[k] || null, put: (k, v) => { store[k] = v; } }) },
    Logger: { log() {} }, JSON, Math, encodeURIComponent, decodeURIComponent,
    fetchTracked_: (svc, url) => {
      const q = /[?&]name=([^&]*)/.exec(url), cc = /[?&]countryCode=([A-Z]{2})/.exec(url), n = /[?&]count=(\d+)/.exec(url);
      const name = decodeURIComponent(q[1]).toLowerCase();
      asked.push(name + (cc ? '[' + cc[1] + ']' : ''));
      let hits = (PLACES_DB[name] || []).filter(r => !cc || r.country_code === cc[1]);
      hits = hits.slice(0, n ? +n[1] : 10);
      return { getContentText: () => JSON.stringify(hits.length ? { results: hits } : {}) };
    },
  };
  vm.createContext(S);
  ['geocodeCandidates_', 'geoPickResult_', 'geocodePackingDestination_'].forEach(f => vm.runInContext(extractFn(WEB, f), S));
  S.store = store; S.asked = asked;
  return S;
}

console.log('\ngeocodeCandidates_: an address broken into what can be found');
{
  const S = geoWorld();
  const c = raw => { S.raw = raw; return vm.runInContext('geocodeCandidates_(raw)', S).map(x => x.name + (x.countryCode ? '[' + x.countryCode + ']' : '')); };
  const k = c(KIMPTON);
  check('the hotel: the city in the US first, then the ZIP, then the old full string',
        k.slice(0, 3).join(' | ') === 'Miami Beach[US] | 33139[US] | Kimpton Surfcomber Hotel, 1717 Collins Ave, Miami Beach, FL 33139, United States', k.join(' | '));
  check('…never the street line, the hotel’s name, the country or "FL" alone',
        !k.filter((x, i) => i !== 2).some(x => /Collins|^Kimpton Surfcomber Hotel$|^United States$|^FL$/.test(x)), k.join(' | '));
  check('"Port of Miami" → Miami', c('Port of Miami')[0] === 'Miami', c('Port of Miami').join(' | '));
  check('"Miami MIA" (a flight’s airport) → Miami', c('Miami MIA')[0] === 'Miami', c('Miami MIA').join(' | '));
  check('"Chicago, IL" → Chicago first, never "IL"', c('Chicago, IL')[0] === 'Chicago' && c('Chicago, IL').indexOf('IL') === -1, c('Chicago, IL').join(' | '));
  check('"75001 Paris" → Paris', c('Rue de Rivoli, 75001 Paris, France').indexOf('Paris') !== -1, c('Rue de Rivoli, 75001 Paris, France').join(' | '));
  check('a plain place is tried as itself', c('Puerto Plata')[0] === 'Puerto Plata');
  check('nothing → nothing', c('').length === 0 && c(null).length === 0);
}

console.log('\ngeocodePackingDestination_: tries each candidate until one is found');
{
  const S = geoWorld();
  S.d = KIMPTON;
  const g = vm.runInContext('geocodePackingDestination_(d)', S);
  check('THE HOTEL’S ADDRESS NOW RESOLVES — to Miami Beach, Florida', g && g.name === 'Miami Beach' && g.admin1 === 'Florida' && Math.abs(g.lat - 25.79) < 0.01, JSON.stringify(g));
  check('…restricted to the US, on the first try', S.asked[0] === 'miami beach[US]' && S.asked.length === 1, S.asked.join(', '));
  check('…keeping the timezone the travel-day briefing needs', g.timezone === 'America/New_York');
  const before = S.asked.length;
  vm.runInContext('geocodePackingDestination_(d)', S);
  check('…and cached: the second ask costs no call', S.asked.length === before);

  // When the first candidate finds nothing, the next is tried.
  const S2 = geoWorld();
  S2.d = 'Somewhere Hotel\n1 Ocean Dr, Nowhereville, FL 33139, United States';
  const g2 = vm.runInContext('geocodePackingDestination_(d)', S2);
  check('a city the geocoder doesn’t know falls through to the ZIP', g2 && g2.name === 'Miami Beach' && S2.asked[0] === 'nowhereville[US]' && S2.asked[1] === '33139[US]', S2.asked.join(', '));
  S2.d = 'Atlantis';
  check('nothing found anywhere → null', vm.runInContext('geocodePackingDestination_(d)', S2) === null);

  const S3 = geoWorld();
  const st = vm.runInContext('geocodePackingDestination_("Saint Thomas", "St Thomas, US Virgin Islands Saint Thomas")', S3);
  check('"Saint Thomas" with its event’s words: the Virgin Islands, not Ontario', st && st.country === 'U.S. Virgin Islands', JSON.stringify(st));
  const on = vm.runInContext('geocodePackingDestination_("Saint Thomas")', S3);
  check('…and with no hint, the geocoder’s own order stands (as before)', on && on.country === 'Canada');
}

// ============ a trip's places =================================================
//
// Shaped exactly like the November anniversary cruise on the joint calendar: flights
// that carry the DEPARTURE airport, a hotel stored as a street address, the cruise, a
// port day in the home port, four real stops, an activity with a place-like location,
// and a family trip in Germany on the same calendar.

const TK = '2026-11-06|Anniversary';
const I = (id, type, title, date, loc, meta, key) => [id, key || TK, type, title, date, '', '', loc, '', meta ? JSON.stringify(meta) : ''];
const CRUISE_TRIP = [
  I('f1', 'flight',   'UA 1234 IAD → MIA',            '2026-11-06', 'Washington IAD', { dest: 'Miami MIA' }),
  I('h1', 'hotel',    'Kimpton Surfcomber Hotel',     '2026-11-06', KIMPTON, { checkoutDate: '2026-11-08' }),
  I('c1', 'cruise',   'Cruise Stay: Norwegian Aqua',  '2026-11-08', 'Port of Miami', { checkoutDate: '2026-11-15' }),
  I('p0', 'activity', 'Embarkation',                  '2026-11-08', 'Port of Miami'),
  I('p1', 'activity', 'Puerto Plata',                 '2026-11-10', 'Puerto Plata'),
  I('p2', 'activity', 'St Thomas, US Virgin Islands', '2026-11-11', 'Saint Thomas'),
  I('p3', 'activity', 'Tortola',                      '2026-11-12', 'Tortola'),
  I('p4', 'activity', 'Great Stirrup Cay',            '2026-11-14', 'Great Stirrup Cay'),
  I('a1', 'activity', 'Swim With The Pigs',           '2026-11-14', 'Swim With The Pigs'),
  I('z1', 'activity', 'Team sync',                    '2026-11-12', 'https://meet.google.com/abc-defg-hij'),
  I('f2', 'flight',   'UA 4321 MIA → IAD',            '2026-11-15', 'Miami MIA', { dest: 'Washington IAD' }),
  I('g1', 'activity', 'Eraky Family in Germany',      '2026-10-22', 'Düsseldorf'),
  I('g2', 'activity', 'Eraky Family in Germany',      '2026-11-09', 'Düsseldorf', null, '2026-10-22|Germany'),
];

function placesWorld() {
  const S = geoWorld();
  vm.runInContext(GI, S);
  vm.runInContext(extractFn(WEB, 'inferTripDestination_'), S);
  vm.runInContext(extractFn(read('Trips.js'), 'tripRowMatches_'), S);
  vm.runInContext(extractFn(read('TravelDayBriefing.js'), 'isVirtualMeetingLocation_'), S);
  vm.runInContext(extractFn(WEB, 'itinKeywordHit_'), S);
  S.tripKeysFor_ = k => [k];
  return S;
}

console.log('\ncruisePortRows_: the days inside the cruise that have a place');
{
  const S = placesWorld();
  S.itin = CRUISE_TRIP;
  const rows = vm.runInContext('cruisePortRows_(itin, ' + JSON.stringify(TK) + ', "2026-11-15")', S);
  const locs = rows.map(r => r.location);
  check('the four stops are candidates', ['Puerto Plata', 'Saint Thomas', 'Tortola', 'Great Stirrup Cay'].every(l => locs.indexOf(l) !== -1), locs.join(' | '));
  check('flights never are — their location is where they LEAVE from', locs.indexOf('Washington IAD') === -1 && locs.indexOf('Miami MIA') === -1);
  check('nor the cruise row itself, nor the hotel before boarding', !rows.some(r => r.title === 'Cruise Stay: Norwegian Aqua') && locs.indexOf(KIMPTON) === -1);
  check('a video call isn’t a port', !locs.some(l => /meet\.google/.test(l)));
  check('Germany never is: one row is before the cruise, the other is another trip', locs.indexOf('Düsseldorf') === -1);
  check('each keeps its own day', rows.find(r => r.location === 'Tortola').date === '2026-11-12');
  S.noCruise = CRUISE_TRIP.filter(r => r[2] !== 'cruise');
  check('no cruise → no ports at all', vm.runInContext('cruisePortRows_(noCruise, ' + JSON.stringify(TK) + ', "2026-11-15")', S).length === 0);
  S.renamed = CRUISE_TRIP.map(r => r.slice());
  S.renamed.forEach(r => { if (r[0] === 'p3') r[1] = '2026-11-06|First Anniversary'; });
  S.tripKeysFor_ = k => [k, '2026-11-06|First Anniversary'];
  check('a row under the trip’s old name still counts', vm.runInContext('cruisePortRows_(renamed, ' + JSON.stringify(TK) + ', "2026-11-15")', S).some(r => r.location === 'Tortola'));
}

console.log('\ntripPlaces_: the November cruise, as the banner should have shown it');
{
  const S = placesWorld();
  S.itin = CRUISE_TRIP;
  const p = vm.runInContext('tripPlaces_(itin, ' + JSON.stringify(TK) + ', "Vacation: First Anniversary Trip", "2026-11-15")', S);
  check('the base is Miami, from the flight, resolved on the map', p.base.source === 'flight' && p.base.label === 'Miami, Florida' && p.base.geo && Math.abs(p.base.geo.lat - 25.77) < 0.01, JSON.stringify(p.base));
  const labels = p.ports.map(x => x.label);
  check('EXACTLY the four stops, in order',
        labels.join(' | ') === 'Puerto Plata, Dominican Republic | Saint Thomas, U.S. Virgin Islands | Tortola, British Virgin Islands | Great Stirrup Cay, Bahamas', labels.join(' | '));
  check('the home port is dropped: Port of Miami is within 50 km of the base', !labels.some(l => /^Miami/.test(l)));
  check('"Swim With The Pigs" isn’t a place, so it’s dropped', !labels.some(l => /Pigs/.test(l)));
  check('each stop keeps its day and its own coordinates', p.ports[1].date === '2026-11-11' && Math.abs(p.ports[1].geo.lat - 18.34) < 0.01);
  check('the prompts see places, never a street address',
        vm.runInContext('genPlacesText_(p)', Object.assign(S, { p })) === 'Miami, Florida; cruise stops: Puerto Plata, Dominican Republic, Saint Thomas, U.S. Virgin Islands, Tortola, British Virgin Islands, Great Stirrup Cay, Bahamas');

  // With no flight, the base is the hotel's ADDRESS — which now resolves.
  S.noFlights = CRUISE_TRIP.filter(r => r[2] !== 'flight');
  const h = vm.runInContext('tripPlaces_(noFlights, ' + JSON.stringify(TK) + ', "Anniversary", "2026-11-15")', S);
  check('no flight: the hotel’s address resolves to Miami Beach, Florida', h.base.source === 'hotel' && h.base.label === 'Miami Beach, Florida' && h.base.geo && h.base.geo.lat > 23.44, JSON.stringify(h.base));
  check('…and the same four stops', h.ports.length === 4, h.ports.map(x => x.label).join(' | '));
  check('…and the season from its latitude is Fall, northern', vm.runInContext('tripSeason_("2026-11-06", ' + h.base.geo.lat + ')', S).season === 'Fall');

  // Two events at the same stop are one stop.
  S.dup = CRUISE_TRIP.concat([I('p5', 'activity', 'Beach day', '2026-11-12', 'Tortola')]);
  check('the same stop twice is listed once', vm.runInContext('tripPlaces_(dup, ' + JSON.stringify(TK) + ', "", "2026-11-15")', S).ports.length === 4);
}

console.log('\ngenCombineWeather_: the base and every stop, as one');
{
  const S = sandbox();
  const W = (summary, mode, lat) => ({ summary, mode, reason: summary ? '' : 'none', lat });
  S.parts = [
    { where: 'Miami, Florida', w: W('(Last year’s weather on these dates) Expected: 72–84°F', 'last_year', 25.77) },
    { where: 'Tortola, British Virgin Islands', w: W('Expected: 78–86°F, some rain.', 'forecast', 18.43) },
    { where: 'Great Stirrup Cay, Bahamas', w: W('', '', null) },
  ];
  const c = vm.runInContext('genCombineWeather_(parts)', S);
  check('any stop on last year’s weather makes the whole last year’s (so the forecast nudge still fires)', c.mode === 'last_year', c.mode);
  check('…said once, up front', /^\(Last year’s weather on these dates\) Miami, Florida: Expected: 72–84°F; Tortola, British Virgin Islands: Expected: 78–86°F/.test(c.summary) &&
        c.summary.split('Last year’s').length === 2, c.summary);
  check('a stop with no weather is named, not dropped silently', /no weather found for Great Stirrup Cay, Bahamas/.test(c.summary), c.summary);
  check('the latitude is the base’s', c.lat === 25.77);
  S.parts = [{ where: 'A', w: W('Expected: 1', 'forecast', 1) }, { where: 'B', w: W('Expected: 2', 'forecast', 2) }];
  check('all forecasts → forecast', vm.runInContext('genCombineWeather_(parts)', S).mode === 'forecast');
  S.parts = [{ where: 'Chicago', w: W('Expected: 48–61°F', 'forecast', 41.9) }];
  check('no stops: exactly the base’s text, as before', vm.runInContext('genCombineWeather_(parts)', S).summary === 'Expected: 48–61°F');
  S.parts = [{ where: 'X', w: { summary: '', mode: '', reason: 'couldn’t find "X" on the map', lat: null } }];
  const none = vm.runInContext('genCombineWeather_(parts)', S);
  check('nothing at all: the base’s reason', none.mode === '' && /couldn’t find "X"/.test(none.reason));

  // Each stop is looked up for ITS day, with the place already resolved.
  const calls = [];
  S.getPackingWeatherDetail_ = (d, a, b, g) => { calls.push([d, a, b, g && g.lat]); return W('Expected: x', 'forecast', g ? g.lat : 25); };
  S.places = { base: { value: 'Miami MIA', label: 'Miami, Florida', geo: { lat: 25.77 } }, ports: [{ label: 'Tortola, British Virgin Islands', date: '2026-11-12', geo: { lat: 18.43 } }] };
  vm.runInContext('genTripWeather_(places, "2026-11-06", "2026-11-15")', S);
  check('the base for the whole trip, each stop for its own day, with its own coordinates',
        JSON.stringify(calls) === JSON.stringify([['Miami MIA', '2026-11-06', '2026-11-15', 25.77], ['Tortola, British Virgin Islands', '2026-11-12', '2026-11-12', 18.43]]), JSON.stringify(calls));
}

// ============ wiring ========================================================

console.log('\nwiring');
{
  const pack = extractFn(WEB, 'webGeneratePacking_'), recs = extractFn(WEB, 'webGenerateRecommendations_');
  check('packing fills a missing end date from the trip', /genTripDates_\(tripKey/.test(pack));
  check('…works from the trip’s places, cruise stops included', /tripPlaces_\(itinData, tripKey, tripLabel, endDate\)/.test(pack) && /genTripWeather_\(places/.test(pack));
  check('…and the hemisphere-aware season', /tripSeason_\(startDate, weather\.lat\)/.test(pack));
  check('…recording the ports it used', /ports:\s+places\.ports/.test(pack));
  check('Discover works from the places too', /tripPlaces_\(itinData, tripKey, tripLabel, endDate\)/.test(recs) && /genTripWeather_\(places/.test(recs) && /ports:\s+places\.ports/.test(recs));
  check('the weather lookup takes an already-resolved place', /const geo = preGeo \|\| geocodePackingDestination_\(destination\);/.test(WEB));
  check('…the month-only season is gone', !/var mo = parseInt\(startDate\.substring\(5, 7\), 10\);/.test(pack));
  check('…keeps checkmarks via the plan', /planPackingRegeneration_\(tripRows, proposed\)/.test(pack));
  check('…and records what it used', /recordGenerationInputs_\('packing', tripKey, packingInputFactors_\(/.test(pack));
  check('Discover does the same', /genTripDates_\(tripKey/.test(recs) && /recordGenerationInputs_\('discover', tripKey, discoverInputFactors_\(/.test(recs) &&
        /weather\.summary, recsSeason, recTraits\)/.test(recs));
  check('generation_inputs is a doGet action', /case 'generation_inputs':\s+return jsonOut_\(webGetGenerationInputs_\(e\)\);/.test(WEB));
  check('the nightly check runs', /nightlyStep_\(ctx, 'checkGenerationInputs_', checkGenerationInputs_\);/.test(CODE));

  // THE LITE BUG, fixed at the source.
  check('dashboard-lite now sends the end date', /action:'generate_packing',tripKey,startDate,endDate\}/.test(LITE));
  check('…which the panel is given', /function PackingLitePanel\(\{ tripKey, endDate,/.test(LITE) && /tripKey=\{tripKey\}\s+endDate=\{t\.endDate\}/.test(LITE));
  check('…and a failed generation is no longer swallowed', !/\} catch\(e\) \{\} finally \{ setGenerating\(false\); \}/.test(LITE));
}

const START = '// ---- GenInputsBanner', END = '// ---- /GenInputsBanner ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a < 0 || b < 0 ? '' : s.slice(a, b + END.length); };

console.log('\nthe banner: one block, both dashboards, every list');
{
  check('identical in both dashboards', block(APP).length > 1000 && block(APP) === block(LITE),
        block(APP) === block(LITE) ? '' : 'the two copies have drifted — paste the whole block across');
  check('above the full dashboard’s packing lists',
        /React\.createElement\(GenInputsBanner,\{kind:'packing',tripKey:tripKey,watch:packData,hasList:hasAiItems\}\)/.test(APP));
  check('above Discover’s picks, in both', [APP, LITE].every(s => /React\.createElement\(GenInputsBanner,\{kind:'discover',tripKey:tripKey,watch:recData,hasList:hasAiRecs\}\)/.test(s)));
  check('above dashboard-lite’s packing list', /<GenInputsBanner kind="packing" tripKey=\{tripKey\} watch=\{packingData\}/.test(LITE));
  check('the regenerate warnings say checked items are kept',
        /Checked items and items you added are kept/.test(APP) && /Checked items and items you added are kept/.test(LITE));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
