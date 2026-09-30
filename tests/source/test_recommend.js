// Phase 3 engine: the four signals, and — the assertion that actually matters —
// the restraint. A recommender is easy to make speak; the hard part is making
// it shut up, and that is what most of this file is about.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC  = fs.readFileSync(ROOT + '/TripDecisions.js', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

let fetchCalls = 0;   // the Distance Matrix spy — see "travel legs are cache-only"

function build(opts) {
  opts = opts || {};
  const ctx = {
    TABS: { TRIP_DECISIONS: 'Trip Decisions', FLAGS: 'Flags' },
    TRIP_DECISION_HEADERS: ['ID','Trip Key','Group Key','Slot Date','Status','Chosen Item ID','Snoozed Until','Decided At','Notes'],
    getSpreadsheet: () => ({ getSheetByName: () => null }),
    formatDateVal_: v => String(v || ''),
    Logger: { log(){} },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0,10) },
    Session: { getScriptTimeZone: () => 'UTC' },
    // Travel-leg surface. fetchTravelLeg_ is a spy: the recommendation path
    // must never reach it.
    fetchTravelLeg_: () => { fetchCalls++; return { minutes: 5, distance: '', status: 'OK' }; },
    isUsableTravelLocation_: loc => !!loc && String(loc).trim().length > 2,
    departurePointOf_: it => it.location,
    travelLegKey_: (f, t, m) => String(f).toLowerCase() + '|' + String(t).toLowerCase() + '|' + m,
    loadTravelLegCache_: () => opts.legCache || {},
    geocodePackingDestination_: () => ({ lat: 25.77, lon: -80.19 }),
    fetchWithHealth_: () => null,
    JSON, String, Number, Math, parseInt, Object, Array, RegExp, Date, isNaN,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

const E = build();

// Against a pre-phase-3 tree every one of these is undefined. Report that as
// failures rather than dying on the first call, so the negative control says
// what is missing instead of printing a stack trace.
console.log('\nthe phase 3 engine exists');
['isOutdoorType_','isIndoorType_','weatherVerdictFor_','tripDailyForecast_','tdForecastDayFor_',
 'sigCollision_','sigWeather_','sigTravel_','sigContext_','recommendForGroup_','applyTripRecommendations_'].forEach(fn => check(fn + ' is defined', typeof E[fn] === 'function', typeof E[fn]));
if (fail) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed  — engine absent, nothing further to test');
  process.exit(1);
}
let seq = 0;
const item = o => Object.assign({
  id: 'I' + (++seq), type: 'calendar', title: '', date: '2026-11-08',
  startTime: '', endTime: '', location: '', notes: '', metadata: '{}', allDay: false,
}, o);

// The running example: an afternoon held three ways.
const MUSEUM   = () => item({ id:'A', type:'museum',   title:'Maybe the Frost Museum',     startTime:'14:00', endTime:'16:30', location:'Frost Museum, Miami' });
const BEACH    = () => item({ id:'B', type:'beach',    title:'Beach afternoon (tentative)', startTime:'14:30', endTime:'17:00', location:'South Beach, Miami' });
const SHOPPING = () => item({ id:'C', type:'shopping', title:'Lincoln Road — option',       startTime:'15:00', endTime:'17:00', location:'Lincoln Rd, Miami' });

console.log('\nindoor / outdoor vocabulary');
{
  check('a beach is outdoors',        E.isOutdoorType_('beach'));
  check('a museum is indoors',        E.isIndoorType_('museum'));
  check('dining is indoors',          E.isIndoorType_('dining'));
  // Deliberate omissions, both documented in the source.
  check('skiing is in NEITHER list',  !E.isOutdoorType_('skiing') && !E.isIndoorType_('skiing'),
        'precipitation is the point of a ski day');
  check('a winery is in NEITHER list', !E.isOutdoorType_('winery') && !E.isIndoorType_('winery'),
        'tasting room vs vineyard is not knowable from a type');
  check('a flight is in neither',     !E.isOutdoorType_('flight') && !E.isIndoorType_('flight'));
}

console.log('\nweather verdict bands');
{
  const v = (precipMm, code) => E.weatherVerdictFor_({ precipMm, code });
  check('dry is fine',                v(0, 1)    === 'fine',   v(0, 1));
  check('a trace is still fine',      v(0.8, 61) === 'fine',   v(0.8, 61));   // the 1mm bar
  check('just over 1mm is wet',       v(1.4, 61) === 'wet',    v(1.4, 61));
  check('over 5mm is severe',         v(7, 61)   === 'severe', v(7, 61));
  check('a thunderstorm code is severe', v(0.2, 95) === 'severe', v(0.2, 95),
        'code outranks the millimetres');
  check('heavy-rain code is severe',  v(0.2, 65) === 'severe', v(0.2, 65));
  check('no data at all is null',     v(null, null) === null,  String(v(null, null)));
  check('a missing day is null',      E.weatherVerdictFor_(null) === null);
}

console.log('\nsigWeather_ — warns, does not tempt');
{
  // Two options, one indoor and one out — the case weather can actually settle.
  // Museum + beach + Lincoln Road is NOT that case: rain rules out the beach
  // but leaves two indoor options, and weather has no view on which. That
  // limitation is asserted explicitly below.
  const members = [MUSEUM(), BEACH()];
  const wet  = E.sigWeather_(members, { forecastDay: { precipMm: 4, code: 61 } });
  check('rain points at the indoor option', wet && wet.itemId === 'A', JSON.stringify(wet));
  check('…and says why, as a fact',         wet && /rain likely/.test(wet.because), wet && wet.because);
  check('…with the millimetres named',      wet && /4mm/.test(wet.because), wet && wet.because);

  const bad = E.sigWeather_(members, { forecastDay: { precipMm: 9, code: 95 } });
  check('a storm still points indoors',     bad && bad.itemId === 'A', JSON.stringify(bad));
  check('…and reads as storms',             bad && /storms/.test(bad.because), bad && bad.because);

  // THE ASYMMETRY. This is the product decision, so it gets a real assertion.
  check('a GLORIOUS day says nothing',
        E.sigWeather_(members, { forecastDay: { precipMm: 0, code: 0 } }) === null,
        'sunshine is not a reason to skip a museum you wanted');
  check('no forecast says nothing',  E.sigWeather_(members, {}) === null);

  // Nothing to discriminate between.
  check('all-outdoor group says nothing',
        E.sigWeather_([BEACH(), item({ id:'D', type:'mountain', startTime:'14:00', endTime:'17:00' })],
                      { forecastDay: { precipMm: 4, code: 61 } }) === null,
        'weather is a warning there, not a decision');
  check('two indoor options say nothing',
        E.sigWeather_([MUSEUM(), SHOPPING()], { forecastDay: { precipMm: 4, code: 61 } }) === null,
        'ambiguous which dry one to name');
  check('one outdoor and TWO indoor says nothing',
        E.sigWeather_([MUSEUM(), BEACH(), SHOPPING()], { forecastDay: { precipMm: 4, code: 61 } }) === null,
        'rain rules out the beach but cannot choose between museum and shopping');
}

console.log('\nsigCollision_ — what is already booked rules options out');
{
  const members = [MUSEUM(), BEACH(), SHOPPING()];
  // A confirmed booking covering 14:00–16:45 kills the museum and the beach,
  // but not Lincoln Road at 15:00–17:00... which it also overlaps. Use a
  // booking that only clears the last one.
  const booked = item({ id:'Z', type:'reservation', title:'Spa treatment',
                        startTime:'14:00', endTime:'15:00', metadata:'{}' });
  const r = E.sigCollision_(members, { dayItems: members.concat([booked]) });
  check('the surviving option is named', r && r.itemId === 'C', JSON.stringify(r));
  check('…and the clash is named',       r && /Spa treatment/.test(r.because), r && r.because);

  check('a tentative item rules nothing out',
        E.sigCollision_(members, { dayItems: members.concat([
          Object.assign(booked, { metadata: JSON.stringify({ tentative: true }) })]) }) === null,
        'another hold cannot rule out a hold');
  check('no bookings at all says nothing',
        E.sigCollision_(members, { dayItems: members }) === null);
  check('a booking that clears everything says nothing',
        E.sigCollision_(members, { dayItems: members.concat([
          item({ id:'Y', title:'Breakfast', startTime:'08:00', endTime:'09:00' })]) }) === null,
        'nothing was ruled out, so there is nothing to observe');
}

console.log('\nsigTravel_ — and the ≥20 min bar');
{
  const members = [MUSEUM(), BEACH(), SHOPPING()];
  const hotel   = item({ id:'H', type:'hotel', title:'Hotel', startTime:'09:00', endTime:'10:00', location:'Hotel, Miami' });
  const legs = (a, b, c) => ({
    'hotel, miami|frost museum, miami|driving':  { minutes:a, status:'OK' },
    'hotel, miami|south beach, miami|driving':   { minutes:b, status:'OK' },
    'hotel, miami|lincoln rd, miami|driving':    { minutes:c, status:'OK' },
  });
  const run = (a,b,c) => E.sigTravel_(members, { legCache: legs(a,b,c), prevConfirmed: hotel });

  const r = run(8, 31, 40);
  check('the clearly closer option wins', r && r.itemId === 'A', JSON.stringify(r));
  check('…quoting both times',            r && /8 min away vs 31/.test(r.because), r && r.because);

  check('19 minutes apart is NOT enough', run(8, 27, 40) === null, 'the bar is exclusive at 19');
  check('20 minutes apart IS enough',     run(8, 28, 40) !== null, 'and inclusive at 20');
}

console.log('\ntravel legs are cache-only — the cost assertion');
{
  const members = [MUSEUM(), BEACH(), SHOPPING()];
  const hotel   = item({ id:'H', type:'hotel', startTime:'09:00', endTime:'10:00', location:'Hotel, Miami' });
  fetchCalls = 0;
  const miss = E.sigTravel_(members, { legCache: {}, prevConfirmed: hotel });
  check('a cache miss produces silence', miss === null, JSON.stringify(miss));
  check('…and bills ZERO Distance Matrix calls', fetchCalls === 0, fetchCalls);

  fetchCalls = 0;
  E.sigTravel_(members, {
    legCache: { 'hotel, miami|frost museum, miami|driving': { minutes: 8, status: 'OK' } },
    prevConfirmed: hotel });
  check('a PARTIAL cache is also silent, and free', fetchCalls === 0, fetchCalls);
}

console.log('\nsigContext_ — weight 0, tiebreak only');
{
  const romantic = E.sigContext_([item({id:'W',type:'winery'}), item({id:'T',type:'theme_park'})],
                                 { tripContext: 'Anniversary Trip' });
  check('an anniversary favours the winery', romantic && romantic.itemId === 'W', JSON.stringify(romantic));
  check('…at weight 0',                      romantic && romantic.weight === 0, romantic && romantic.weight);

  const family = E.sigContext_([item({id:'W',type:'winery'}), item({id:'T',type:'theme_park'})],
                               { tripContext: 'Family Trip' });
  check('a family trip favours the theme park', family && family.itemId === 'T', JSON.stringify(family));

  check('no context says nothing', E.sigContext_([item({id:'W',type:'winery'}), item({id:'T',type:'theme_park'})], {}) === null);
  check('an unrecognised context says nothing',
        E.sigContext_([item({id:'W',type:'winery'}), item({id:'T',type:'theme_park'})],
                      { tripContext: 'Eclipse Chasing' }) === null);
  check('a tie says nothing',
        E.sigContext_([item({id:'W',type:'winery'}), item({id:'S',type:'spa'})],
                      { tripContext: 'Anniversary Trip' }) === null,
        'both favoured equally');
}

console.log('\nrecommendForGroup_ — THE RESTRAINT');
{
  const members = [MUSEUM(), BEACH()];   // one indoor, one out — weather can settle it
  const hotel   = item({ id:'H', type:'hotel', startTime:'09:00', endTime:'10:00', location:'Hotel, Miami' });

  // One signal, agreeing with nothing else → speaks.
  const one = E.recommendForGroup_(members, { forecastDay: { precipMm: 4, code: 61 } });
  check('a lone decisive signal speaks', one && one.itemId === 'A', JSON.stringify(one));
  check('…and names which signal',       one && one.signal === 'weather', one && one.signal);

  // Two signals agreeing → speaks, with the heavier one's reason.
  const agree = E.recommendForGroup_(members, {
    forecastDay: { precipMm: 4, code: 61 },
    legCache: { 'hotel, miami|frost museum, miami|driving': { minutes: 8,  status:'OK' },
                'hotel, miami|south beach, miami|driving':  { minutes: 31, status:'OK' } },
    prevConfirmed: hotel });
  check('two agreeing signals still speak', agree && agree.itemId === 'A', JSON.stringify(agree));

  // ── The assertion that matters ──────────────────────────────────────────
  const disagree = E.recommendForGroup_(members, {
    forecastDay: { precipMm: 4, code: 61 },                       // → museum (A)
    legCache: { 'hotel, miami|frost museum, miami|driving': { minutes: 40, status:'OK' },
                'hotel, miami|south beach, miami|driving':  { minutes: 5,  status:'OK' } },
    prevConfirmed: hotel });                                      // → the beach (B)
  check('TWO SIGNALS DISAGREEING PRODUCE SILENCE', disagree === null, JSON.stringify(disagree),
        'arbitrating between them is how a recommender starts being confidently wrong');

  // Context disagreeing also vetoes.
  const ctxVeto = E.recommendForGroup_([item({id:'W',type:'winery',startTime:'14:00',endTime:'17:00'}),
                                        item({id:'T',type:'theme_park',startTime:'14:00',endTime:'17:00'})], {
    forecastDay: { precipMm: 4, code: 61 },
    tripContext: 'Family Trip' });
  check('context pointing elsewhere also vetoes', ctxVeto === null, JSON.stringify(ctxVeto));

  // Context alone cannot carry it.
  check('CONTEXT ALONE PRODUCES SILENCE',
        E.recommendForGroup_([item({id:'W',type:'winery'}), item({id:'T',type:'theme_park'})],
                             { tripContext: 'Anniversary Trip' }) === null,
        'weight 0 cannot speak by itself');

  // Context as an actual tiebreak: weather narrows, context picks.
  const tiebreak = E.recommendForGroup_(
    [item({id:'B2',type:'beach',startTime:'14:00',endTime:'17:00'}),
     item({id:'W2',type:'winery',startTime:'14:00',endTime:'17:00'}),
     item({id:'D2',type:'dining',startTime:'14:00',endTime:'17:00'})],
    { forecastDay: { precipMm: 4, code: 61 }, tripContext: 'Anniversary Trip' });
  check('weather + agreeing context speaks', tiebreak && tiebreak.itemId === 'D2', JSON.stringify(tiebreak));
  check('…crediting the weather, not the context', tiebreak && tiebreak.signal === 'weather',
        tiebreak && tiebreak.signal);

  check('no signals at all says nothing', E.recommendForGroup_(members, {}) === null);
  check('a single-option group says nothing', E.recommendForGroup_([MUSEUM()], { forecastDay:{precipMm:4,code:61} }) === null);
}

console.log('\napplyTripRecommendations_ — stamping the group');
{
  const items = [MUSEUM(), BEACH()];
  E.annotateOptionGroups_(items);
  E.applyTripDecisions_(items, 'T', '2026-10-01');
  E.applyTripRecommendations_(items, { forecast: [{ date:'2026-11-08', precipMm:4, code:61 }] });
  const meta = it => JSON.parse(it.metadata || '{}');

  check('every member carries the recommendation',
        items.every(it => meta(it).recommendedId === 'A'),
        items.map(it => meta(it).recommendedId).join(','));
  check('…and the reason',  /rain likely/.test(meta(items[0]).recommendBecause || ''), meta(items[0]).recommendBecause);

  // A DECIDED group gets no opinion — once you have chosen, this is
  // second-guessing rather than help.
  const decided = [MUSEUM(), BEACH()];
  E.annotateOptionGroups_(decided);
  decided.forEach(it => { const m = JSON.parse(it.metadata); m.decisionStatus = 'decided'; it.metadata = JSON.stringify(m); });
  E.applyTripRecommendations_(decided, { forecast: [{ date:'2026-11-08', precipMm:4, code:61 }] });
  check('a decided group gets NO recommendation',
        decided.every(it => meta(it).recommendedId === undefined),
        decided.map(it => meta(it).recommendedId).join(','));

  // A forecast for a different day must not leak across.
  const other = [MUSEUM(), BEACH()];
  E.annotateOptionGroups_(other);
  E.applyTripDecisions_(other, 'T', '2026-10-01');
  E.applyTripRecommendations_(other, { forecast: [{ date:'2026-11-09', precipMm:9, code:95 }] });
  check('another day’s forecast does not apply',
        other.every(it => meta(it).recommendedId === undefined),
        other.map(it => meta(it).recommendedId).join(','));
}

console.log('\ntdForecastDayFor_');
{
  const fc = [{ date:'2026-11-07', precipMm:0 }, { date:'2026-11-08', precipMm:4 }];
  check('finds the right day', E.tdForecastDayFor_(fc, '2026-11-08').precipMm === 4);
  check('a day not in range is null', E.tdForecastDayFor_(fc, '2026-11-10') === null);
  check('an empty forecast is null',  E.tdForecastDayFor_([], '2026-11-08') === null);
  check('a null forecast is null',    E.tdForecastDayFor_(null, '2026-11-08') === null);
}

console.log('\ntripDailyForecast_ — the horizon');
{
  // fetchWithHealth_ returns null in this context, so any call that reaches the
  // network returns null too. What is asserted here is the guard BEFORE it.
  let geocoded = 0;
  const E2 = build();
  E2.geocodePackingDestination_ = () => { geocoded++; return { lat: 1, lon: 2 }; };
  const far = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  E2.tripDailyForecast_('Miami', far, far);
  check('beyond 14 days it does not even try', geocoded === 1 && true, 'geocode=' + geocoded);
  check('…and returns null', E2.tripDailyForecast_('Miami', far, far) === null);
  check('no destination is null', E2.tripDailyForecast_('', '2026-11-08', '2026-11-08') === null);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
