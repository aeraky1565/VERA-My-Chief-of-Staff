// The pre-trip "Weather at Destination" section, which never produced weather.
//
// Two files declared inferTripDestination_ with different signatures. Apps
// Script puts every root file in one global scope and hoists declarations, so
// only one existed at runtime and PreTripBriefing's callers got the other one's
// contract — an object where they expected a string. That object reached
// geocodePackingDestination_, which does destination.toLowerCase() on its first
// line OUTSIDE any try, threw, and getPackingWeather_'s catch returned ''.
// An empty string renders no section, so the failure was completely silent.
//
// Runs the REAL functions, lifted from WebApp.js by brace-matching.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extract(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error('unterminated: ' + name);
}

let fetches = [];
function build(opts) {
  opts = opts || {};
  const WEB = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
  const ctx = {
    Logger: { log(){} },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
    isVirtualMeetingLocation_: loc => /zoom|meet|teams|webex/i.test(String(loc)),
    // Apps Script gives every root .js one shared global scope, so these are
    // always in scope in production; the vm has to model that. With no registry
    // here they behave as the registry-less fallback does: the key stands alone.
    tripKeysFor_: k => [String(k == null ? '' : k).trim()],
    tripRowMatches_: (cell, keys) => {
      const v = String(cell == null ? '' : cell).trim();
      return !!v && (keys || []).indexOf(v) !== -1;
    },
    // One stub for both helpers — the geocoder uses fetchTracked_, the forecast
    // uses fetchWithHealth_, which is itself a small inconsistency in the
    // original but not the bug under test.
    fetchTracked_:    (src, url) => respond(url),
    fetchWithHealth_: (src, url) => respond(url),
    recordApiHealth_: () => {},
    JSON, String, Number, Math, parseInt, Object, Array, RegExp, Date, isNaN, encodeURIComponent,
  };
  function respond(url) {
    fetches.push(url);
    if (opts.geoFails && url.indexOf('geocoding-api') !== -1) return { getContentText: () => '{}' };
    if (url.indexOf('geocoding-api') !== -1) {
      return { getContentText: () => JSON.stringify({
        results: [{ latitude: 25.7743, longitude: -80.1937, name: 'Miami' }] }) };
    }
    // A real-shaped Open-Meteo daily forecast: a warm Miami week with one wet day.
    return { getContentText: () => JSON.stringify({ daily: {
      time:                 [DEP, MID, RET],
      temperature_2m_max:   [86.2, 88.1, 79.4],
      temperature_2m_min:   [72.5, 74.0, 68.9],
      precipitation_sum:    [0.0, 4.6, 0.2],
      weather_code:         [1, 61, 2],
    } }) };
  }
  vm.createContext(ctx);
  ['inferTripDestination_', 'geocodePackingDestination_', 'getPackingWeather_']
    .forEach(fn => vm.runInContext(extract(WEB, fn), ctx));
  return ctx;
}

const E = build();

// Realistic Itinerary rows.
// ITINERARY_HEADERS: ID, Trip Key, Type, Title, Date, Start, End, Location, Notes, Metadata
// The 48h brief fires two days before departure, so the fixture sits where the
// real one does — inside Open-Meteo's 14-day forecast window. Dated 2026-11-08
// it was 49 days out, which correctly took the prior-year archive path and made
// the assertions below look like a bug in the code rather than in the fixture.
const _d  = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const DEP = _d(2), MID = _d(3), RET = _d(4);
const TRIPKEY = DEP + '|Anniversary Trip';
const FLIGHT_ROWS = [
  ['I1', TRIPKEY, 'flight', 'AA 1423 JFK→MIA', DEP, '08:00', '11:05', 'JFK', '',
   JSON.stringify({ airline:'AA', flightNum:'1423', origin:'JFK', dest:'Miami' })],
  ['I2', TRIPKEY, 'hotel', 'The Setai', DEP, '15:00', '', '2001 Collins Ave, Miami Beach', '', ''],
];
const HOTEL_ONLY = [
  ['I2', TRIPKEY, 'hotel', 'The Setai', DEP, '15:00', '', '2001 Collins Ave, Miami Beach', '', ''],
];
const PLACES_ONLY = [
  ['I3', TRIPKEY, 'dining', 'Dinner', DEP, '19:00', '21:00', 'Joe’s Stone Crab', '', ''],
];

console.log('\ndestination inference — the canonical resolver');
{
  const d1 = E.inferTripDestination_(FLIGHT_ROWS, TRIPKEY, 'Anniversary Trip');
  check('a flight’s metadata.dest wins', d1.value === 'Miami', JSON.stringify(d1));
  check('…and says where it came from', d1.source === 'flight', d1.source);

  const d2 = E.inferTripDestination_(HOTEL_ONLY, TRIPKEY, 'Anniversary Trip');
  check('falls back to the hotel', /Miami Beach/.test(d2.value), JSON.stringify(d2));

  const d3 = E.inferTripDestination_(PLACES_ONLY, TRIPKEY, 'Anniversary Trip');
  check('then to any real place', /Joe/.test(d3.value), JSON.stringify(d3));

  // A calendar-only trip has NO itinerary rows at all — the common case for a
  // trip that was never typed into the dashboard.
  const d4 = E.inferTripDestination_([], TRIPKEY, 'Lisbon Trip');
  check('a trip with no rows falls back to the label', d4.value === 'Lisbon', JSON.stringify(d4));
  check('…and flags the guess', d4.source === 'label', d4.source);

  // And the guard that stops a non-place label being sent as a destination.
  const d5 = E.inferTripDestination_([], TRIPKEY, 'Vacation: First Anniversary Trip');
  check('a label that is not a place is still only a guess', d5.source === 'label', JSON.stringify(d5));

  // Always an object with .value — that contract is the thing that broke.
  check('always returns an object with .value',
        typeof d1 === 'object' && 'value' in d1 && 'source' in d1);
}

console.log('\nthe weather section, end to end');
{
  fetches = [];
  const dest = E.inferTripDestination_(FLIGHT_ROWS, TRIPKEY, 'Anniversary Trip').value;
  const text = E.getPackingWeather_(dest, DEP, RET);

  check('it produces weather at all', !!text && text.length > 0,
        JSON.stringify(text) + '  ← this was "" before the fix');
  check('with the temperature range', /69–88°F/.test(text), text);
  check('…and a rain read',           /rain|dry/.test(text), text);
  check('…and packing advice',        /pack|layers|jacket/i.test(text), text);
  check('not marked as a seasonal average', !/Seasonal average/.test(text), text);

  check('it geocoded the destination', fetches.some(u => /geocoding-api/.test(u)), fetches.join(' | '));
  check('…by name, not by trip label',
        fetches.some(u => /geocoding-api.*name=Miami/.test(u)), fetches.join(' | '));
  check('and asked for the forecast, not the archive',
        fetches.some(u => /api\.open-meteo\.com\/v1\/forecast/.test(u)) &&
        !fetches.some(u => /archive/.test(u)), fetches.join(' | '));
  check('for the trip’s own dates',
        fetches.some(u => u.indexOf('start_date=' + DEP + '&end_date=' + RET) !== -1), fetches.join(' | '));
}

console.log('\nTHE BUG, reproduced');
{
  // Exactly what PreTripBriefing used to do: call with the two-argument shape
  // its own deleted copy had, against the resolver that actually existed.
  const oldStyle = E.inferTripDestination_(FLIGHT_ROWS, 'Anniversary Trip');   // tripLabel as tripKey
  check('the old 2-arg call returns an OBJECT, not a string',
        typeof oldStyle === 'object', typeof oldStyle);
  check('…and finds nothing, because it filtered on the label',
        oldStyle.value === '' || oldStyle.source === 'label', JSON.stringify(oldStyle));

  // That object reaching the geocoder is what killed it.
  fetches = [];
  const broken = E.getPackingWeather_(oldStyle, DEP, RET);
  check('passing the object yields NO weather', broken === '', JSON.stringify(broken));
  check('…and never even reaches the network', fetches.length === 0, fetches.join(' | '));

  // The fixed call, side by side.
  const fixed = E.getPackingWeather_(
    E.inferTripDestination_(FLIGHT_ROWS, TRIPKEY, 'Anniversary Trip').value,
    DEP, RET);
  check('the fixed call yields weather', fixed !== '' && fixed.length > 10, JSON.stringify(fixed));
}

console.log('\ndegrading honestly');
{
  const E2 = build({ geoFails: true });
  check('an unresolvable destination returns "" rather than throwing',
        E2.getPackingWeather_('Nowheresville', DEP, RET) === '');
  check('an empty destination returns ""', E.getPackingWeather_('', DEP, RET) === '');
  check('a null destination returns ""',   E.getPackingWeather_(null, DEP, RET) === '');
}

console.log('\nthe callers pass a string');
{
  const pre = fs.readFileSync(ROOT + '/PreTripBriefing.js', 'utf8');

  // Real calls only — the file also NAMES the function in a doc comment
  // explaining the bug, and matching that told me nothing.
  const calls = pre.split('\n')
    .filter(l => !/^\s*(\*|\/\/)/.test(l))
    .filter(l => /inferTripDestination_\(/.test(l));
  // Not pinned to an exact count — the invariant that matters is that EVERY
  // call has the right shape, which the next two assertions cover regardless of
  // how many there are. Pinning it just made adding a correct third call fail.
  check('there are call sites at all', calls.length >= 2, calls.length);
  check('every call site is the 3-arg form',
        calls.every(c => /inferTripDestination_\([^)]*,[^)]*,[^)]*\)/.test(c)),
        JSON.stringify(calls));
  check('…and every one takes .value', calls.every(c => /\)\.value/.test(c)),
        JSON.stringify(calls));
  check('PreTripBriefing no longer declares its own',
        !/^function inferTripDestination_/m.test(pre));
  check('getPackingWeather_ is still called with that string',
        /getPackingWeather_\(destination,/.test(pre));
}

console.log('\nthe night-before email — tomorrow only');
{
  const pre = fs.readFileSync(ROOT + '/PreTripBriefing.js', 'utf8');
  const nb  = extract(pre, 'sendPreTripEmail_NightBefore_');

  check('it has a weather section now', /id: 'weather'/.test(nb), 'missing');
  check('…headed "Tomorrow at Destination"', /Tomorrow at Destination/.test(nb));
  check('…and the plain-text twin', /TOMORROW AT DESTINATION/.test(nb));

  // The point of the whole change: ONE day, not the trip range. Passing
  // depStr twice is what makes it answer a different question from the 48h
  // brief rather than repeating its packing sentence twelve hours later.
  check('asks for the DEPARTURE DAY only, not the range',
        /getPackingWeather_\(nbDest, depStr, depStr\)/.test(nb),
        (nb.match(/getPackingWeather_\([^)]*\)/) || ['(no call)'])[0]);
  check('…and NOT the trip range', !/getPackingWeather_\(nbDest, depStr, endStrNB\)/.test(nb));

  // The dates are shared with the decisions lookup, so a throw in one cannot
  // leave the other with undefined dates — the bug fixed in 331b32c.
  // Against the try that WRAPS the decisions lookup, not the first try in the
  // function — there are earlier, unrelated ones.
  const datesAt    = nb.indexOf('var depStr');
  const decisionAt = nb.indexOf('openDecisionsForTrip_(');
  const decisionTry = nb.lastIndexOf('try {', decisionAt);
  check('the dates are computed outside the decisions try',
        datesAt !== -1 && decisionTry !== -1 && datesAt < decisionTry,
        'dates@' + datesAt + ' decisionsTry@' + decisionTry);
  check('…and outside the weather try too',
        datesAt < nb.lastIndexOf('try {', nb.indexOf('getPackingWeather_(nbDest')),
        'so a throw in one cannot leave the other with undefined dates');

  // Same failure shape as everything else: '' means the section vanishes.
  check('it degrades to no section', /nbWeatherText\s*\n?\s*\?/.test(nb) || /nbWeatherText$/m.test(nb));
  check('the weather lookup is wrapped', /catch \(wErr\)/.test(nb));

  // The 48h brief must be untouched — it still wants the whole-trip range,
  // because there it IS packing advice.
  const h48 = extract(pre, 'sendPreTripEmail_48h_');
  check('the 48h brief still asks for the trip range',
        /getPackingWeather_\(destination, startStr, endStr\)/.test(h48),
        (h48.match(/getPackingWeather_\([^)]*\)/) || ['(no call)'])[0]);
}

console.log('\nthe section actually renders in the assembled email');
{
  // The real assembler out of PreTripBriefing.js, so this is the last link in
  // the chain: weather text -> section HTML -> email body.
  const PRE = fs.readFileSync(ROOT + '/PreTripBriefing.js', 'utf8');
  const ctx = {
    escapeHtml_: str => String(str == null ? '' : str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    Logger: { log(){} }, String, RegExp, Array, Object, JSON,
    // Apps Script gives every root .js one shared global scope, so these are
    // always in scope in production; the vm has to model that. With no registry
    // here they behave as the registry-less fallback does: the key stands alone.
    tripKeysFor_: k => [String(k == null ? '' : k).trim()],
    tripRowMatches_: (cell, keys) => {
      const v = String(cell == null ? '' : cell).trim();
      return !!v && (keys || []).indexOf(v) !== -1;
    },
  };
  vm.createContext(ctx);
  vm.runInContext(extract(PRE, 'buildPreTripEmailHtml_'), ctx);

  const dest = E.inferTripDestination_(FLIGHT_ROWS, TRIPKEY, 'Anniversary Trip').value;
  const weatherText = E.getPackingWeather_(dest, DEP, RET);

  // Built exactly as sendPreTripEmail_48h_ builds it.
  const BLUE = '#1565c0';
  const weatherHtml = weatherText
    ? '<p style="margin:0 0 12px;font-size:11px;font-weight:700;color:' + BLUE + ';' +
      'letter-spacing:1.5px;text-transform:uppercase;">\uD83C\uDF24 Weather at Destination</p>' +
      '<p style="margin:0;font-size:13px;color:#555;line-height:1.6;">' +
      ctx.escapeHtml_(weatherText.substring(0, 400)) + '</p>'
    : '';

  const withWeather = ctx.buildPreTripEmailHtml_('Pre-Trip Brief', 'Anniversary Trip', 'Departing soon',
    [{ id:'weather', data: weatherHtml }]);
  check('the email contains a Weather section', /Weather at Destination/.test(withWeather));
  check('…with the actual forecast in it', /69\u201388\u00b0F/.test(withWeather), weatherText);

  // And the pre-fix state: '' section, which the assembler drops silently.
  const without = ctx.buildPreTripEmailHtml_('Pre-Trip Brief', 'Anniversary Trip', 'Departing soon',
    [{ id:'weather', data: '' }]);
  check('an empty weather section VANISHES from the email',
        !/Weather at Destination/.test(without),
        'which is why the breakage was invisible');
  check('…and the email still renders otherwise', /Anniversary Trip/.test(without));
}

console.log('\nthe flag no longer says weather is unavailable');
{
  const dest = E.inferTripDestination_(FLIGHT_ROWS, TRIPKEY, 'Anniversary Trip').value;
  const weatherText = E.getPackingWeather_(dest, DEP, RET) || '';
  const section = '\uD83C\uDF24 WEATHER\n' + (weatherText || 'Weather unavailable \u2014 check before departure');
  check('buildPreTripBriefingFlag_\u2019s weather line has real content',
        !/Weather unavailable/.test(section), section);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
