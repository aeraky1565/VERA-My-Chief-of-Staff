// The weekend memo and where you will actually be.
//
// The reported bug: a Tampa trip covering Saturday, and the memo still
// recommended a Virginia street festival. The cause was not a missing feature —
// classifyWeekend_ SAW the trip and deliberately told Claude to suggest
// something "short, local, and low-energy", because a trip starting on Saturday
// looked like a trip he was about to leave FOR rather than one he would be ON.
//
// So the lead fixture is that exact weekend, and the negative control is that
// exact wrong answer.
//
// The REAL functions, brace-matched into a vm context, with HTTP stubbed.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const WP  = fs.readFileSync(ROOT + '/WeekendPlanner.js', 'utf8');
const WEB = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

// ---- dates: a real Saturday, so the fixtures never drift -------------------
const SAT = new Date('2026-10-10T00:00:00Z');           // a Saturday
const SUN = new Date(SAT.getTime() + 86400000);
const d = n => new Date(SAT.getTime() + n * 86400000).toISOString().slice(0, 10);
const SAT_STR = d(0), SUN_STR = d(1);

const TAMPA_TRIP = { label: 'Tampa Trip', startDate: d(-1), endDate: d(1), daysAway: 2 };  // Fri–Sun
const SAT_ONLY   = { label: 'Tampa Trip', startDate: d(0), endDate: d(0), daysAway: 3 };   // Sat only
const NEXT_WEEK  = { label: 'Chicago Work Trip', startDate: d(2), endDate: d(5), daysAway: 4 }; // Mon

// ---- stubs -----------------------------------------------------------------
function ctxFor(opts) {
  opts = opts || {};
  const calls = { geocode: [], forecast: [], search: [] };
  const logs  = [];
  // Which cities can be placed on a map. Anything else geocodes to null, which
  // is the real API's behaviour for a "destination" like "First Anniversary".
  const known = opts.known || { 'tampa': { lat: 27.9, lon: -82.4 },
                                'fairfax, va': { lat: 38.8, lon: -77.3 } };
  const ctx = {
    String, Array, Number, JSON, Math, parseInt, isNaN, Error, Object, Date, RegExp, encodeURIComponent,
    TABS: { ITINERARY: 'Itinerary' },
    Logger: { log: m => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (dt, tz, f) => {
      const p = n => String(n).padStart(2, '0');
      if (f === 'H') return String(dt.getUTCHours());
      return dt.getUTCFullYear() + '-' + p(dt.getUTCMonth() + 1) + '-' + p(dt.getUTCDate());
    } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => opts.noApiKey ? null : 'KEY' }) },
    geocodeLocation_: (loc) => {
      calls.geocode.push(loc);
      return known[String(loc).toLowerCase()] || null;
    },
    fetchWithHealth_: (src, url) => {
      calls.forecast.push(url);
      if (opts.forecastFails) return null;
      const lat = /lat=([-\d.]+)/.exec(url)[1];
      // 3-hourly entries across both days, so closestToHour has something to pick.
      const list = [];
      [SAT_STR, SUN_STR].forEach(day => {
        [9, 12, 15, 18].forEach(h => {
          list.push({ dt: Date.parse(day + 'T' + String(h).padStart(2, '0') + ':00:00Z') / 1000,
                      main: { temp: lat === '27.9' ? 88 : 61, feels_like: lat === '27.9' ? 94 : 59 },
                      weather: [{ main: lat === '27.9' ? 'Humid' : 'Clear' }], pop: 0 });
        });
      });
      return { getContentText: () => JSON.stringify({ list }) };
    },
    doWebSearch_: (q) => { calls.search.push(q); return [{ title: 'An event', snippet: 's', link: 'l' }]; },
    isVirtualMeetingLocation_: () => false,
    // inferTripDestination_ now resolves a trip key through the registry, so a
    // trip that split into two keys infers from ALL its rows. In Apps Script
    // every root .js shares one global scope and these are always present; the
    // vm has to model that. No registry here, so they behave as the registry-less
    // fallback does in production: the key stands for itself.
    tripKeysFor_: k => [String(k == null ? '' : k).trim()],
    tripRowMatches_: (cell, keys) => {
      const v = String(cell == null ? '' : cell).trim();
      return !!v && (keys || []).indexOf(v) !== -1;
    },
    // opts.weekendOutOfRange pushes the target weekend past the forecast's
    // 5-day reach while the stub still only returns entries for SAT_STR/SUN_STR
    // — the real Sunday/Monday failure, which used to be entirely silent.
    computeNextSaturday_: () => new Date(SAT.getTime() + (opts.weekendOutOfRange ? 14 * 86400000 : 0)),
  };
  vm.createContext(ctx);
  // classifyWeekend_'s house-guest branch reads this module-level constant.
  const GUEST_SRC = WP.slice(WP.indexOf('var GUEST_KEYWORDS_'),
                             WP.indexOf(';', WP.indexOf('var GUEST_KEYWORDS_')) + 1);
  const COLORS_SRC = WP.slice(WP.indexOf('var WKND_EMAIL_COLORS_'),
                              WP.indexOf('};', WP.indexOf('var WKND_EMAIL_COLORS_')) + 2);
  vm.runInContext([
    GUEST_SRC,
    COLORS_SRC,
    extractFn(WEB, 'inferTripDestination_'),
    extractFn(WP, 'weekendTripFor_'),
    extractFn(WP, 'firstLocationSegment_'),
    extractFn(WP, 'getWeekendLocationPlan_'),
    extractFn(WP, 'eventSearchCityFor_'),
    extractFn(WP, 'describeWeekendLocation_'),
    extractFn(WP, 'classifyWeekend_'),
    extractFn(WP, 'getWeekendWeather_'),
    extractFn(WP, 'searchLocalEvents_'),
    extractFn(WP, 'weatherFallbackSentence_'),
    extractFn(WP, 'formatWeatherBlock_'),
    extractFn(WP, 'escapeHtmlWknd_'),
    extractFn(WP, 'htmlWeatherBlock_'),
    extractFn(WP, 'capacityBadgeLabel_'),
  ].join('\n'), ctx);
  ctx.__calls = calls;
  ctx.__logs  = logs;
  return ctx;
}

function planFor(ctx, trips, itinRows, homeCity) {
  ctx.__trips = trips; ctx.__itin = itinRows || []; ctx.__home = homeCity === undefined ? 'Fairfax, VA' : homeCity;
  ctx.__sat = new Date(SAT.getTime()); ctx.__sun = new Date(SUN.getTime());
  return vm.runInContext(
    'getWeekendLocationPlan_({ allTrips: __trips }, __itin, __sat, __sun, __home, "KEY")', ctx);
}

// ============ the question nobody asked =====================================

console.log('\nweekendTripFor_ — is he away on THAT day');
{
  const ctx = ctxFor();
  ctx.__trips = [TAMPA_TRIP];
  const hit = vm.runInContext('weekendTripFor_(__trips, ' + JSON.stringify(SAT_STR) + ')', ctx);
  check('a trip covering Saturday is found', hit && hit.label === 'Tampa Trip', hit && hit.label);
  check('…even though it has not started yet (daysAway 2)', TAMPA_TRIP.daysAway > 0);

  ctx.__trips = [SAT_ONLY];
  check('a Saturday-only trip covers Saturday',
        !!vm.runInContext('weekendTripFor_(__trips, ' + JSON.stringify(SAT_STR) + ')', ctx));
  check('…and NOT Sunday',
        vm.runInContext('weekendTripFor_(__trips, ' + JSON.stringify(SUN_STR) + ')', ctx) === null);

  ctx.__trips = [NEXT_WEEK];
  check('a trip starting Monday covers neither day',
        vm.runInContext('weekendTripFor_(__trips, ' + JSON.stringify(SAT_STR) + ')', ctx) === null &&
        vm.runInContext('weekendTripFor_(__trips, ' + JSON.stringify(SUN_STR) + ')', ctx) === null);

  check('no trips at all is not an error',
        vm.runInContext('weekendTripFor_([], ' + JSON.stringify(SAT_STR) + ')', ctx) === null);
}

// ============ the classifier — the actual bug ===============================

console.log('\nclassifyWeekend_ — the Tampa weekend');
{
  const ctx  = ctxFor();
  const plan = planFor(ctx, [TAMPA_TRIP]);
  ctx.__plan = plan;
  const r = vm.runInContext('classifyWeekend_(["Saturday · Gym (9:00 AM)"], { allTrips: __trips, upcomingTrips: __trips }, __plan)', ctx);

  check('it reads as away', r.type === 'away', r.type + ' / ' + r.note.slice(0, 80));
  check('NOT pre_major_trip', r.type !== 'pre_major_trip', r.type);
  // The precise wrong answer that shipped: "suggest only something short,
  // local, and low-energy" for a weekend spent 900 miles from home.
  check('the note never tells Claude to stay local', !/\blocal\b/i.test(r.note), r.note);
  check('…it names the destination instead', /Tampa/.test(r.note), r.note);
  check('…and says where he is', /Tampa/.test(r.where), r.where);
  check('the trip is named', r.awayLabel === 'Tampa Trip', r.awayLabel);
}

console.log('\n…while a trip departing Monday is still pre-departure');
{
  const ctx  = ctxFor();
  const plan = planFor(ctx, [NEXT_WEEK]);
  ctx.__plan = plan; ctx.__up = [NEXT_WEEK];
  const r = vm.runInContext('classifyWeekend_([], { allTrips: __trips, upcomingTrips: __up }, __plan)', ctx);
  check('still pre_major_trip', r.type === 'pre_major_trip', r.type);
  check('…and still says stay local, which is right here', /local/i.test(r.note), r.note.slice(0, 90));
  check('…naming the trip', r.preTripLabel === 'Chicago Work Trip', r.preTripLabel);
}

console.log('\n…and an ordinary weekend is untouched');
{
  const ctx  = ctxFor();
  const plan = planFor(ctx, []);
  ctx.__plan = plan;
  const open = vm.runInContext('classifyWeekend_([], { allTrips: [], upcomingTrips: [] }, __plan)', ctx);
  check('empty calendar → open', open.type === 'open', open.type);
  const busy = vm.runInContext('classifyWeekend_(["a","b","c","d"], { allTrips: [], upcomingTrips: [] }, __plan)', ctx);
  check('four events → busy', busy.type === 'busy', busy.type);
  const light = vm.runInContext('classifyWeekend_(["a"], { allTrips: [], upcomingTrips: [] }, __plan)', ctx);
  check('one event → light', light.type === 'light', light.type);
  check('no location plan at all still works',
        vm.runInContext('classifyWeekend_([], { allTrips: [], upcomingTrips: [] }, null)', ctx).type === 'open');
}

// ============ the per-day plan ==============================================

console.log('\nthe location plan');
{
  const ctx  = ctxFor();
  const plan = planFor(ctx, [TAMPA_TRIP], [], 'Fairfax, VA');
  check('both days away', plan.sat.away && plan.sun.away, JSON.stringify([plan.sat.away, plan.sun.away]));
  check('both resolve to Tampa', plan.sat.city === 'Tampa' && plan.sun.city === 'Tampa',
        plan.sat.city + ' / ' + plan.sun.city);
  check('the destination came from the label, and says so', plan.sat.source === 'label', plan.sat.source);
  check('anyAway is set', plan.anyAway === true);
  check('the destination is known', plan.unknownDestination === false);
  check('one geocode per distinct city', ctx.__calls.geocode.length === 1, ctx.__calls.geocode.join(','));
}

console.log('\na split weekend — away Saturday, home Sunday');
{
  const ctx  = ctxFor();
  const plan = planFor(ctx, [SAT_ONLY], [], 'Fairfax, VA');
  check('Saturday away', plan.sat.away === true);
  check('Sunday home',   plan.sun.away === false);
  check('Saturday is Tampa',  plan.sat.city === 'Tampa', plan.sat.city);
  check('Sunday is home',     plan.sun.city === 'Fairfax, VA', plan.sun.city);
  check('the summary names both', /Tampa/.test(vm.runInContext('describeWeekendLocation_(' + JSON.stringify(plan) + ')', ctx)) &&
        /home/.test(vm.runInContext('describeWeekendLocation_(' + JSON.stringify(plan) + ')', ctx)),
        vm.runInContext('describeWeekendLocation_(' + JSON.stringify(plan) + ')', ctx));
}

console.log('\na home weekend still resolves home');
{
  const ctx  = ctxFor();
  const plan = planFor(ctx, [], [], 'Fairfax, VA');
  check('neither day away', !plan.sat.away && !plan.sun.away);
  check('both are home', plan.sat.city === 'Fairfax, VA' && plan.sun.city === 'Fairfax, VA');
  check('anyAway is false', plan.anyAway === false);
}

console.log('\naway, but the destination cannot be placed on a map');
{
  const ctx  = ctxFor();
  const vague = { label: 'First Anniversary Trip', startDate: d(-1), endDate: d(1), daysAway: 2 };
  const plan  = planFor(ctx, [vague], [], 'Fairfax, VA');
  check('it knows he is away', plan.anyAway === true);
  check('…and admits it does not know where', plan.unknownDestination === true);
  check('no city is claimed', plan.sat.city === '', JSON.stringify(plan.sat.city));
  check('source records the failure', plan.sat.source === 'unknown', plan.sat.source);

  // The whole point: no home data stands in for a weekend spent elsewhere.
  const city = vm.runInContext('eventSearchCityFor_(' + JSON.stringify(plan) + ', "Fairfax, VA")', ctx);
  check('the event search city is EMPTY, not home', city === '', JSON.stringify(city));

  ctx.__plan = plan;
  const r = vm.runInContext('classifyWeekend_([], { allTrips: [], upcomingTrips: [] }, __plan)', ctx);
  check('the classifier knows the destination is unknown',
        /destination not in the itinerary/i.test(r.note), r.note.slice(0, 110));
  check('…and still forbids suggesting things near home',
        /at or near home/i.test(r.note), r.note);

  // The note is a PROMPT. Its previous wording was a finished sentence about
  // Ahmed in the third person, and Claude lifted it into the memo verbatim —
  // "the destination could not be determined", system register dropped into a
  // warm personal note. That is the reported bug, and it lives here.
  check('it reads as an instruction, not as memo prose',
        /^STATE:/.test(r.note), r.note.slice(0, 60));
  check('…and carries none of the old log phrasing',
        !/could not be determined/i.test(r.note), r.note);
}

// ============ weather ========================================================

console.log('\nweather follows the plan');
{
  const ctx  = ctxFor();
  const plan = planFor(ctx, [TAMPA_TRIP]);
  ctx.__plan = plan;
  const w = vm.runInContext('getWeekendWeather_(__plan)', ctx);
  check('both days returned', !!(w && w.sat && w.sun), JSON.stringify(w));
  check('Saturday is labelled Tampa', w.sat.city === 'Tampa', w.sat.city);
  check('Sunday is labelled Tampa',   w.sun.city === 'Tampa', w.sun.city);
  check('…and the numbers are the Tampa ones', w.sat.temp === 88, w.sat.temp);
  check('ONE forecast call for one city', ctx.__calls.forecast.length === 1, ctx.__calls.forecast.length);
}

console.log('\na split weekend fetches each city');
{
  const ctx  = ctxFor();
  const plan = planFor(ctx, [SAT_ONLY]);
  ctx.__plan = plan;
  const w = vm.runInContext('getWeekendWeather_(__plan)', ctx);
  check('two forecast calls', ctx.__calls.forecast.length === 2, ctx.__calls.forecast.length);
  check('Saturday is Tampa', w.sat.city === 'Tampa' && w.sat.temp === 88, w.sat.city + ' ' + w.sat.temp);
  check('Sunday is home',    w.sun.city === 'Fairfax, VA' && w.sun.temp === 61, w.sun.city + ' ' + w.sun.temp);
}

// This block asserts the REVERSE of what it used to. The previous change chose
// to show nothing at all when the destination could not be named, on the
// grounds that home numbers for a weekend elsewhere were the original bug.
// That produced a memo with no weather in it, which reads as broken. The rule
// now: always show a forecast, always name the city it describes, and always
// say when it is home's rather than his.
console.log('\nan unresolvable destination falls back to HOME weather, labelled as home');
{
  const ctx  = ctxFor();
  const vague = { label: 'First Anniversary Trip', startDate: d(-1), endDate: d(1), daysAway: 2 };
  const plan  = planFor(ctx, [vague]);
  check('the plan still claims no city', plan.sat.city === '' && plan.sun.city === '');
  check('…but it carries home', plan.home && plan.home.geocoded === true, JSON.stringify(plan.home));

  ctx.__plan = plan;
  const w = vm.runInContext('getWeekendWeather_(__plan)', ctx);
  check('weather is NOT skipped', !!(w && w.sat && w.sun), JSON.stringify(w));
  check('one forecast call — home, once, serving both days',
        ctx.__calls.forecast.length === 1, ctx.__calls.forecast.length);
  check('the numbers are the home ones', w.sat.temp === 61, w.sat.temp);
  check('the city named is home', w.sat.city === 'Fairfax, VA', w.sat.city);
  check('…never the trip label', !/Anniversary/.test(w.sat.city), w.sat.city);
  check('it is flagged as a fallback',
        w.sat.basis === 'home-fallback' && w.sun.basis === 'home-fallback', w.sat.basis);
  check('…and it still knows he is away', w.sat.away === true);

  // The invariant: numbers are only honest while the sentence is beside them.
  // Without it, "SAT · Fairfax, VA · 61°F" on a weekend spent elsewhere is the
  // original reported bug, rendered identically.
  const block = vm.runInContext('formatWeatherBlock_(' + JSON.stringify(w) + ')', ctx);
  check('the text block says the figures are home\'s', /home’s numbers/.test(block), block);
  check('…naming the trip', /First Anniversary Trip/.test(block), block);
  check('…as prose, not a bracketed system note',
        !/[\[\]]/.test(block) && /\.$/.test(block.trim()), block);
  check('…and never in the register Claude was copying',
        !/could not be determined|unavailable|section/i.test(block), block);

  const html = vm.runInContext('htmlWeatherBlock_(' + JSON.stringify(w) + ')', ctx);
  check('the email carries the numbers', /61/.test(html));
  check('…and never ships them without the sentence', /home’s numbers/.test(html), html.slice(-260));

  // Deliberately unchanged: weather is a fact about a place, an outing is a
  // suggestion. Suggesting something near a home he will not be in is the bug
  // that started all of this, and falling back for weather must not undo it.
  check('the event search city is STILL empty, not home',
        vm.runInContext('eventSearchCityFor_(' + JSON.stringify(plan) + ', "Fairfax, VA")', ctx) === '');
}

console.log('\n…and the other two bases are distinguished');
{
  const away = ctxFor(); away.__plan = planFor(away, [TAMPA_TRIP]);
  const wa = vm.runInContext('getWeekendWeather_(__plan)', away);
  check('a resolved destination is not a fallback', wa.sat.basis === 'destination', wa.sat.basis);
  check('…and needs no sentence',
        vm.runInContext('weatherFallbackSentence_(' + JSON.stringify(wa) + ')', away) === '');

  const home = ctxFor(); home.__plan = planFor(home, []);
  const wh = vm.runInContext('getWeekendWeather_(__plan)', home);
  check('a home weekend is plain home', wh.sat.basis === 'home', wh.sat.basis);
  check('…and needs no sentence either',
        vm.runInContext('weatherFallbackSentence_(' + JSON.stringify(wh) + ')', home) === '');

  const split = ctxFor(); split.__plan = planFor(split, [SAT_ONLY]);
  const ws = vm.runInContext('getWeekendWeather_(__plan)', split);
  check('a split weekend is destination + home',
        ws.sat.basis === 'destination' && ws.sun.basis === 'home',
        ws.sat.basis + ' / ' + ws.sun.basis);
}

console.log('\nthe city is named on every rendered line — at home too');
{
  const ctx  = ctxFor();
  const home = planFor(ctx, []);
  ctx.__plan = home;
  const block = vm.runInContext('formatWeatherBlock_(getWeekendWeather_(__plan))', ctx);
  check('the home block names the city', /Fairfax, VA/.test(block), block);
  check('…on the Saturday line', /SAT · Fairfax, VA/.test(block), block.split('\n')[0]);
  check('…and the Sunday line',  /SUN · Fairfax, VA/.test(block), block.split('\n')[1]);

  const ctx2 = ctxFor();
  const away = planFor(ctx2, [TAMPA_TRIP]);
  ctx2.__plan = away;
  const b2 = vm.runInContext('formatWeatherBlock_(getWeekendWeather_(__plan))', ctx2);
  check('the away block names Tampa', /SAT · Tampa/.test(b2), b2.split('\n')[0]);
  check('…and never says the home city', !/Fairfax/.test(b2), b2);
}

// ============ making the destination resolvable in the first place ==========

console.log('\na multi-city itinerary still lands on a map');
{
  const ctx = ctxFor({ known: { 'puerto plata': { lat: 19.8, lon: -70.7 },
                                'fairfax, va':  { lat: 38.8, lon: -77.3 } } });
  const cruise = { label: 'Caribbean Cruise', startDate: d(-1), endDate: d(1), daysAway: 2 };
  const key = d(-1) + '|Caribbean Cruise';
  // Type must NOT be hotel/cruise — those hit inferTripDestination_'s
  // single-location branch, which is not what this is exercising.
  const row = loc => { const r = new Array(10).fill(''); r[1] = key; r[2] = 'reservation'; r[7] = loc; return r; };
  const plan = planFor(ctx, [cruise], [row('Puerto Plata'), row('St Thomas'), row('Tortola')], 'Fairfax, VA');

  check('the full string was tried first',
        ctx.__calls.geocode[0] === 'Puerto Plata / St Thomas / Tortola', ctx.__calls.geocode[0]);
  check('…then its first segment', ctx.__calls.geocode[1] === 'Puerto Plata', ctx.__calls.geocode[1]);
  check('exactly two attempts, never more',
        ctx.__calls.geocode.length === 2, ctx.__calls.geocode.join(' | '));
  check('the destination is known', plan.unknownDestination === false);
  check('the city is the segment that geocoded', plan.sat.city === 'Puerto Plata', plan.sat.city);
  check('…never the unmappable join', plan.sat.city.indexOf('/') === -1, plan.sat.city);
  check('the evidence is still the itinerary', plan.sat.source === 'locations', plan.sat.source);
  check('home was never consulted', ctx.__calls.geocode.indexOf('Fairfax, VA') === -1);

  ctx.__plan = plan;
  const w = vm.runInContext('getWeekendWeather_(__plan)', ctx);
  check('and the weather is the destination, not home',
        w.sat.basis === 'destination' && w.sat.city === 'Puerto Plata', w.sat.city);
}

console.log('\n…and a comma is never a separator');
{
  const ctx = ctxFor();
  planFor(ctx, [], [], 'Fairfax, VA');
  // "Fairfax, VA" is ONE place, and geocodeLocation_ depends on the "City, ST"
  // form — it appends ",US". Splitting on the comma would break home weather
  // outright, which is the opposite of the point.
  check('the home city is geocoded whole', ctx.__calls.geocode[0] === 'Fairfax, VA', ctx.__calls.geocode[0]);
  check('"Fairfax" alone is never tried',
        ctx.__calls.geocode.indexOf('Fairfax') === -1, ctx.__calls.geocode.join(','));
  check('the splitter leaves it intact',
        vm.runInContext('firstLocationSegment_("Fairfax, VA")', ctx) === 'Fairfax, VA');
  check('…and leaves "Trinidad and Tobago" alone only because this is a retry',
        vm.runInContext('firstLocationSegment_("Trinidad and Tobago")', ctx) === 'Trinidad');
  check('inferTripDestination_ is untouched — it still joins every port',
        /places\.join\(' \/ '\)/.test(extractFn(WEB, 'inferTripDestination_')));
}

// ============ diagnostics ====================================================

console.log('\nevery way weather can come back empty names itself');
{
  const reason = ctx => (ctx.__logs.filter(l => /no weather —/.test(l))[0] || '');
  const reasons = [];

  const a = ctxFor({ noApiKey: true }); a.__plan = planFor(a, []);
  check('no API key → null', vm.runInContext('getWeekendWeather_(__plan)', a) === null);
  check('…and says which key', /WEATHER_API_KEY/.test(reason(a)), reason(a));
  reasons.push(reason(a));

  const b = ctxFor();
  check('no plan → null', vm.runInContext('getWeekendWeather_(null)', b) === null);
  check('…and says so', /location plan/.test(reason(b)), reason(b));
  reasons.push(reason(b));

  const c = ctxFor({ forecastFails: true }); c.__plan = planFor(c, []);
  vm.runInContext('getWeekendWeather_(__plan)', c);
  check('a dead forecast names the fetch', /fetch or parse/.test(reason(c)), reason(c));
  reasons.push(reason(c));

  const e = ctxFor({ weekendOutOfRange: true }); e.__plan = planFor(e, []);
  vm.runInContext('getWeekendWeather_(__plan)', e);
  check('a weekend past the horizon says so', /5-day window/.test(reason(e)), reason(e));
  reasons.push(reason(e));

  check('four DISTINCT reasons, not one "weatherData=null"',
        new Set(reasons).size === 4, JSON.stringify(reasons));
}

console.log('\na home weekend that cannot be placed is no longer invisible');
{
  const ctx  = ctxFor({ known: {} });
  const plan = planFor(ctx, [], [], 'Nowheresville');
  check('the plan admits home is unknown', plan.homeUnknown === true, JSON.stringify(plan.home));
  // unknownDestination stays away-only on purpose: classifyWeekend_ reads it
  // inside if(anyAway), and folding home failures in would corrupt the
  // away-with-known-destination case. homeUnknown is the separate signal.
  check('…without claiming he is away',
        plan.unknownDestination === false && plan.anyAway === false);
  ctx.__plan = plan;
  check('no weather', vm.runInContext('getWeekendWeather_(__plan)', ctx) === null);
  check('…but the log says why', /no weather —/.test(ctx.__logs.join('\n')), ctx.__logs.join('\n'));
  check('the orchestrator surfaces it', /homeUnknown/.test(extractFn(WP, 'runWeekendPlanner_')));
  check('…and warns when the config key is blank',
        /weekend_planner_home_city is blank/.test(extractFn(WP, 'runWeekendPlanner_')));
}

// ============ 'away' is no longer an orphan ==================================

console.log('\nthe away capacity type reaches the things that consume it');
{
  const ctx = ctxFor();
  check('the badge names it',
        /Away/.test(vm.runInContext('capacityBadgeLabel_({ type: "away", awayLabel: "Tampa Trip" })', ctx)),
        vm.runInContext('capacityBadgeLabel_({ type: "away", awayLabel: "Tampa Trip" })', ctx));
  check('…including the trip',
        /Tampa Trip/.test(vm.runInContext('capacityBadgeLabel_({ type: "away", awayLabel: "Tampa Trip" })', ctx)));
  check('…and copes without one',
        vm.runInContext('capacityBadgeLabel_({ type: "away", awayLabel: null })', ctx) === 'Away');

  // The root cause of the odd prose: 'away' fell through to the generic branch
  // and was asked for somewhere "20–40 min away" — near a home he would not be
  // in — while the state header above it said WEEKEND STATE: AWAY. Claude wrote
  // about the contradiction instead of about the weekend.
  const prompt = extractFn(WP, 'buildWeekendPlannerPrompt_');
  check('paragraph 3 has an away branch', /capType === 'away'/.test(prompt));
  check('…placed before the generic one',
        prompt.indexOf("capType === 'away'") < prompt.indexOf("'One specific place, outing, or activity"));
  check('paragraph 2 omits the task for an away weekend',
        /capType === 'away' \|\| capType === 'traveling'/.test(prompt));
  check('the prompt forbids narrating the memo itself',
        /NEVER DESCRIBE THE MEMO ITSELF/.test(prompt));
  check('…and names the exact phrasings that leaked',
        /could not be determined/.test(prompt) && /what will or will not be/.test(prompt));
  check('the weather note no longer asserts the figures are his unconditionally',
        /home-fallback/.test(prompt), 'prompt must branch on basis');
}

// ============ events =========================================================

console.log('\nthe event search follows the weekend, not the address');
{
  const ctx  = ctxFor();
  const plan = planFor(ctx, [TAMPA_TRIP]);
  const city = vm.runInContext('eventSearchCityFor_(' + JSON.stringify(plan) + ', "Fairfax, VA")', ctx);
  check('it searches Tampa', city === 'Tampa', city);

  ctx.__city = city;
  vm.runInContext('searchLocalEvents_(__city, new Date(' + SAT.getTime() + ' - 3*86400000))', ctx);
  check('the query names Tampa', /Tampa/.test(ctx.__calls.search[0]), ctx.__calls.search[0]);
  check('…and never the home city', !/Fairfax/.test(ctx.__calls.search[0]), ctx.__calls.search[0]);
}

console.log('\n…and a home weekend searches home, exactly as before');
{
  const ctx  = ctxFor();
  const plan = planFor(ctx, []);
  check('home city is used',
        vm.runInContext('eventSearchCityFor_(' + JSON.stringify(plan) + ', "Fairfax, VA")', ctx) === 'Fairfax, VA');
  const split = planFor(ctxFor(), [SAT_ONLY]);
  check('a split weekend searches the Saturday city',
        vm.runInContext('eventSearchCityFor_(' + JSON.stringify(split) + ', "Fairfax, VA")', ctx) === 'Tampa');
}

// ============ the wiring =====================================================

console.log('\nthe orchestrator actually uses all this');
{
  const run = extractFn(WP, 'runWeekendPlanner_');
  check('it builds a location plan', /getWeekendLocationPlan_\(/.test(run));
  check('weather takes the plan, not the home city', /getWeekendWeather_\(locationPlan\)/.test(run));
  check('the classifier takes the plan', /classifyWeekend_\(weekendCal, travelCtx, locationPlan\)/.test(run));
  check('the event search takes the resolved city', /searchLocalEvents_\(eventCity/.test(run));
  check('…and is skipped entirely when there is none', /eventCity \? searchLocalEvents_/.test(run));
  check('the plan reaches the prompt', /locationPlan:\s*locationPlan/.test(run));

  check('the un-partitioned trip list is kept',
        /allTrips:\s*\[\]/.test(extractFn(WP, 'getTravelContextForPlanner_')) &&
        /result\.allTrips = allTrips\.slice\(\)/.test(extractFn(WP, 'getTravelContextForPlanner_')));

  const html = extractFn(WP, 'htmlWeatherBlock_');
  check('the HTML email names the city too', /d\.city/.test(html));

  const prompt = extractFn(WP, 'buildWeekendPlannerPrompt_');
  check('the prompt names the city per day', /sw\.city/.test(prompt) && /uw\.city/.test(prompt));
  check('…and states where he will be', /describeWeekendLocation_/.test(prompt));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
