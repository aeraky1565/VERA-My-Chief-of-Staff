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
  check('no travellers → missing', one({ traveler: '' }, 'travellers').status === 'missing');
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

// ============ wiring ========================================================

console.log('\nwiring');
{
  const pack = extractFn(WEB, 'webGeneratePacking_'), recs = extractFn(WEB, 'webGenerateRecommendations_');
  check('packing fills a missing end date from the trip', /genTripDates_\(tripKey/.test(pack));
  check('…uses the weather detail and the hemisphere-aware season', /getPackingWeatherDetail_\(destination/.test(pack) && /tripSeason_\(startDate, weather\.lat\)/.test(pack));
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
