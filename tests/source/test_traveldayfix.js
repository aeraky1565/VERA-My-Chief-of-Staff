// Phase 0 of the travel-email repair: the three visible symptoms.
//
// 1. Two identical travel-day emails for one trip. There was NO send guard in
//    this path at all — unlike the pre-trip path, which has one — so a trip that
//    acquired two keys sent one email per key.
// 2. A map that rendered as an empty box. Static Maps 400s the WHOLE image if a
//    single marker fails to geocode, and the markers were raw itinerary text: a
//    flight row's Location is synthesised as "IAD → MCO", which is not a place.
// 3. "Your 1-night trip just wrapped up" on a trip that had not ended. The
//    duration floor turned "I have no end date" into a confident 1.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const TDB  = fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8');
const PTC  = fs.readFileSync(ROOT + '/PostTripCapture.js',   'utf8');
const TL   = fs.readFileSync(ROOT + '/TravelLegs.js',        'utf8');
const TB   = fs.readFileSync(ROOT + '/TestBench.js',         'utf8');
const WEB  = fs.readFileSync(ROOT + '/WebApp.js',           'utf8');

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

// ============ the markers ==================================================

function mapCtx() {
  const ctx = { String, Array, Number, Object, RegExp, Math, JSON, isFinite, Date, Error,
                encodeURIComponent, Logger: { log: () => {} } };
  vm.createContext(ctx);
  vm.runInContext([
    // isVirtualMeetingLocation_ leans on a whole-word helper that lives in
    // WebApp.js — one global scope in Apps Script, two files here.
    extractFn(WEB, 'itinKeywordHit_'),
    extractFn(TDB, 'isVirtualMeetingLocation_'),
    extractFn(TL,  'isUsableTravelLocation_'),
    extractFn(TL,  'normalizeTravelLocation_'),
    extractFn(TDB, 'travelMapMarkers_'),
    extractFn(TDB, 'buildTravelStaticMapUrl_'),
  ].join('\n'), ctx);
  return ctx;
}
const markers = (ctx, addrs) => {
  ctx.__i = addrs.map(a => ({ displayAddress: a }));
  return vm.runInContext('travelMapMarkers_(__i)', ctx);
};

console.log('\nthe map refuses markers that would 400 the whole image');
{
  const ctx = mapCtx();

  // The exact string webGetItinerary_ synthesises for a flight row's Location.
  // Two places joined by an arrow is a route, not somewhere Google can pin.
  const withRoute = markers(ctx, ['IAD → MCO', '1717 Collins Ave, Miami Beach, FL']);
  check('a route string is dropped', withRoute.indexOf('IAD → MCO') === -1, JSON.stringify(withRoute));
  check('…and the real address survives', withRoute.length === 1, JSON.stringify(withRoute));

  check('an ASCII arrow is dropped too',
        markers(ctx, ['IAD -> MCO', 'x']).indexOf('IAD -> MCO') === -1);
  check('…and an em-dash route',
        markers(ctx, ['Dulles — Orlando', 'x']).length === 0, 'x is too short to count');

  // A multi-line calendar location: TravelLegs.js:498 already splits on \n,
  // which is direct evidence these exist in the real data.
  const multi = markers(ctx, ['1717 Collins Ave\nMiami Beach, FL 33139', '512 Espanola Way']);
  check('newlines are collapsed, not encoded as %0A',
        multi[0].indexOf('\n') === -1, JSON.stringify(multi[0]));
  check('…and the address is otherwise intact', /1717 Collins Ave Miami Beach/.test(multi[0]), multi[0]);

  check('too-short junk is dropped', markers(ctx, ['AB', 'Tampa TPA']).length === 1);
  check('blanks are dropped',        markers(ctx, ['', null, 'Tampa TPA', 'Miami Beach']).length === 2);
  check('a virtual meeting is dropped',
        markers(ctx, ['https://zoom.us/j/123', 'Tampa TPA']).length === 1);
  check('duplicates collapse to one pin',
        markers(ctx, ['Tampa TPA', 'Tampa TPA', 'Miami Beach']).length === 2);
  check('…and it is capped at 10',
        markers(ctx, Array.from({ length: 14 }, (_, i) => 'Place number ' + i)).length === 10);

  // A single airport name is fine — Google's geocoder resolves it.
  check('a plain airport name is kept', markers(ctx, ['Tampa TPA', 'Miami Beach'])[0] === 'Tampa TPA');
}

console.log('\n…and the URL and the stop count agree with each other');
{
  const ctx = mapCtx();
  // The old bug in miniature: the section counted raw addresses, so it could
  // promise a map and then emit nothing when the URL builder rejected them.
  ctx.__i = [{ displayAddress: 'IAD → MCO' }, { displayAddress: 'Tampa TPA' }];
  const url = vm.runInContext('buildTravelStaticMapUrl_(__i, "KEY")', ctx);
  check('one usable stop builds NO url', url === null, String(url));
  check('…and the section would say so too',
        vm.runInContext('travelMapMarkers_(__i).length', ctx) < 2);

  ctx.__i = [{ displayAddress: 'Tampa TPA' }, { displayAddress: 'Miami Beach' }];
  const good = vm.runInContext('buildTravelStaticMapUrl_(__i, "KEY")', ctx);
  check('two usable stops build a url', typeof good === 'string' && good.indexOf('staticmap') !== -1);
  check('…with both markers', (good.match(/markers=/g) || []).length === 2, good);
  check('…and the arrow never reaches the query string', good.indexOf('%E2%86%92') === -1);
  check('the section builder uses the same screening',
        /travelMapMarkers_\(items\)/.test(extractFn(TDB, 'buildTravelMapSection_')));
}

// ============ the send guard ===============================================

console.log('\nthe travel-day briefing cannot send twice in one day');
{
  const src = extractFn(TDB, 'checkAndSendTravelDayBriefings_');
  check('there is a sent latch at all', /TDB_SENT_/.test(src));
  // Keyed on the LABEL, not the whole key: the label is the part that survives
  // a start-date edit, so two keys for one trip collapse onto one latch. Keying
  // on the trip key would have latched each key separately and sent twice —
  // exactly the reported bug.
  check('it is keyed on the day and the label, not the trip key',
        /_lbl\s*=\s*String\(tripKey\.split\('\|'\)\.slice\(1\)/.test(src), 'label derivation');
  check('…and the property is written only after a successful send',
        src.indexOf('sendTravelDayBriefing_(tripKey') < src.indexOf('_tdbProps.setProperty(_sKey'));
  check('a manual run can force past it', /_tdbForce/.test(src) && /opts\.force/.test(src));
  check('…and TestBench does force it',
        /force:\s*true/.test(extractFn(TB, 'tbTravelDayBriefing')));
  check('…and says so, rather than silently re-sending',
        /Forcing a re-send/.test(extractFn(TB, 'tbTravelDayBriefing')));
  check('the scheduled caller passes no force', !/checkAndSendTravelDayBriefings_\(\{[^}]*force/.test(
        fs.readFileSync(ROOT + '/Code.js', 'utf8')));
}

// ============ the duration ==================================================

function ptcCtx() {
  const ctx = { String, Number, Math, Date, isFinite, Object, Logger: { log: () => {} } };
  vm.createContext(ctx);
  vm.runInContext([
    extractFn(PTC, 'tripDurationNights_'),
    extractFn(PTC, 'tripDurationPrefix_'),
    extractFn(PTC, 'tripDurationLabel_'),
  ].join('\n'), ctx);
  return ctx;
}
const tripOf = (start, end) => ({
  departureDate: new Date(start + 'T00:00:00Z'),
  endDate:       new Date(end   + 'T00:00:00Z'),
});

console.log('\na trip of unknown length says nothing about its length');
{
  const ctx = ptcCtx();
  const nights = t => { ctx.__t = t; return vm.runInContext('tripDurationNights_(__t)', ctx); };
  const prefix = t => { ctx.__t = t; return vm.runInContext('tripDurationPrefix_(__t)', ctx); };
  const label  = t => { ctx.__t = t; return vm.runInContext('tripDurationLabel_(__t)',  ctx); };

  // THE BUG: same start and end — which is what happens whenever the itinerary
  // holds no row later than the trip key's own date — used to floor to 1 and
  // announce "Your 1-night trip just wrapped up".
  const collapsed = tripOf('2026-09-20', '2026-09-20');
  check('a zero-length span is unknown, not 1', nights(collapsed) === null, String(nights(collapsed)));
  check('…so the prose simply omits it', prefix(collapsed) === '', JSON.stringify(prefix(collapsed)));
  check('…and the label says so plainly', label(collapsed) === 'length unknown', label(collapsed));

  check('a real 3-night trip still reads 3', nights(tripOf('2026-09-20', '2026-09-23')) === 3);
  check('…with the right prefix', prefix(tripOf('2026-09-20', '2026-09-23')) === '3-night ');
  check('…and plural', label(tripOf('2026-09-20', '2026-09-23')) === '3 nights');
  check('a genuine 1-night trip is still 1', nights(tripOf('2026-09-20', '2026-09-21')) === 1);
  check('…and is singular', label(tripOf('2026-09-20', '2026-09-21')) === '1 night');

  check('a backwards span is unknown', nights(tripOf('2026-09-23', '2026-09-20')) === null);
  check('a missing endDate is unknown', nights({ departureDate: new Date() }) === null);
  check('no trip at all is unknown',    nights(null) === null);
}

console.log('\n…and the floor is gone from every site that rendered it');
{
  check('no Math.max(1, …) survives in the duration paths',
        !/Math\.max\(1,\s*Math\.round\(durationMs/.test(PTC));
  check('nothing still reads a raw durationNights variable',
        !/\bdurationNights\b/.test(PTC.replace(/\/\*\*[\s\S]*?\*\//g, '')));

  // The email the user actually received.
  const nudge = extractFn(PTC, 'sendPostTripNudgeEmail_');
  check('the nudge email uses the prefix helper', /tripDurationPrefix_\(trip\)/.test(nudge));
  check('…and no longer hardcodes "-night "', !/'-night '/.test(nudge), 'literal survives');

  check('the flag reason uses it too', /tripDurationPrefix_\(trip\)/.test(extractFn(PTC, 'buildPostTripFlag_')));
  check('the recap email uses the label', /tripDurationLabel_\(trip\)/.test(extractFn(PTC, 'sendPostTripRecapEmail_')));
}

// ============ the diagnostic ================================================

console.log('\nthe map diagnostic can name each distinct failure');
{
  const d = extractFn(TDB, 'diagnoseTravelDayMap_');
  // The point of it: nothing else in the repo ever fetches this URL, so the
  // failure happens inside Gmail's proxy where no one can see it.
  check('it actually fetches the url', /UrlFetchApp\.fetch\(url/.test(d));
  check('it reports the status code', /getResponseCode\(\)/.test(d));
  check('…and prints Google’s own error text', /getContentText\(\)/.test(d));

  check('it distinguishes the API not being enabled', /not authorized to use this api/.test(d));
  check('…a referrer or IP restriction', /referer/.test(d) && /ip address/.test(d));
  check('…billing',                      /billing/.test(d));
  check('…url signing',                  /must be signed/.test(d));
  check('…and a bad marker',             /code === 400/.test(d));
  check('a 400 bisects to name the offending stop',
        /Bisecting/.test(d) && /markers\.forEach/.test(d));

  check('it shows addresses JSON-quoted so arrows and newlines are visible',
        /JSON\.stringify\(e\.displayAddress/.test(d));
  check('it uses the same screening the email uses', /travelMapMarkers_\(enriched\)/.test(d));
  check('a 200 image is reported as a pass', /PASS/.test(d) && /indexOf\('image'\) === 0/.test(d));
  check('it never sends mail',  !/sendVeraEmail_|MailApp/.test(d));
  check('it never writes a sheet', !/setValue|appendRow/.test(d));
  check('it explains why testTravelLegsApi_ passing proves nothing',
        /Distance Matrix|testTravelLegsApi_/.test(d), 'should name the misleading check');

  check('TestBench exposes it', /function tbTravelDayMap\(\)/.test(TB));
  check('…honouring TB_DATE',   /diagnoseTravelDayMap_\(TB_DATE\)/.test(TB));
}

// ============ the guard, actually exercised ================================
//
// The source-level assertions above are not enough: gutting the condition to
// `if (false)` leaves the latch string in place and they all still pass. This
// runs the REAL checkAndSendTravelDayBriefings_ over the exact situation the
// user hit — one trip, two keys — and counts the emails.

function runBriefings(opts, o) {
  o = o || {};
  const sends = [];
  const props = Object.assign({}, o.props || {});
  const ctx = {
    String, Array, Number, Object, Date, JSON, Math, RegExp, isFinite, Error,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (props.hasOwnProperty(k) ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
    })},
    TABS: { ITINERARY: 'Itinerary' },
    ITINERARY_HEADERS: new Array(10).fill('x'),
    getConfigValues: () => ({}),
    readPTOConfig_: () => ({}),
    veraLog_: () => {},
    // The Itinerary sheet still carries the OLD key — nothing can rewrite col B.
    getSpreadsheet: () => ({ getSheetByName: () => ({
      getLastRow: () => 2,
      getRange: () => ({ getValues: () => [[
        'ITIN-1', o.sheetKey || '2026-09-19|Florida Trip', 'flight', 'Flight to Tampa',
        '2026-09-21', '12:23', '15:04', 'Tampa TPA', '', '{}' ]] }),
    })}),
    // …while the calendar now yields the NEW one, because the start date moved.
    getUpcomingTravel_: () => [{ label: 'Florida Trip', startDate: o.calStart || '2026-09-20',
                                 endDate: '2026-09-23', daysAway: 0 }],
    getCalendarItemsForToday_: () => [],
    sendTravelDayBriefing_: (k, items) => { sends.push(k); },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(TDB, 'checkAndSendTravelDayBriefings_'), ctx);
  ctx.__o = opts || {};
  vm.runInContext('checkAndSendTravelDayBriefings_(__o)', ctx);
  return { sends, props };
}

console.log('\none trip under two keys sends ONE email');
{
  // dateOverride is the day the itinerary row falls on, so both keys are live.
  const r = runBriefings({ dateOverride: '2026-09-21' });
  check('exactly one briefing went out', r.sends.length === 1,
        r.sends.length + ': ' + JSON.stringify(r.sends));
  check('…and a latch was written', Object.keys(r.props).some(k => /^TDB_SENT_/.test(k)),
        JSON.stringify(Object.keys(r.props)));
  check('…keyed on the label, so both keys share it',
        Object.keys(r.props).some(k => /FLORIDA_TRIP/.test(k)), JSON.stringify(Object.keys(r.props)));
  check('…and not on either date prefix',
        !Object.keys(r.props).some(k => /2026_09_19|2026_09_20/.test(k)), JSON.stringify(Object.keys(r.props)));
}

console.log('\n…and running it again the same day sends none');
{
  const first  = runBriefings({ dateOverride: '2026-09-21' });
  const second = runBriefings({ dateOverride: '2026-09-21' }, { props: first.props });
  check('the second run is silent', second.sends.length === 0, JSON.stringify(second.sends));

  const forced = runBriefings({ dateOverride: '2026-09-21', force: true }, { props: first.props });
  check('…unless forced, which TestBench does', forced.sends.length === 1, JSON.stringify(forced.sends));
}

console.log('\n…while two genuinely different trips still both send');
{
  const sends = [];
  const props = {};
  const ctx = {
    String, Array, Number, Object, Date, JSON, Math, RegExp, isFinite, Error,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (props.hasOwnProperty(k) ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
    })},
    TABS: { ITINERARY: 'Itinerary' },
    ITINERARY_HEADERS: new Array(10).fill('x'),
    getConfigValues: () => ({}), readPTOConfig_: () => ({}), veraLog_: () => {},
    getSpreadsheet: () => ({ getSheetByName: () => null }),
    getUpcomingTravel_: () => [
      { label: 'Florida Trip', startDate: '2026-09-20', endDate: '2026-09-23', daysAway: 0 },
      { label: 'Boston Work',  startDate: '2026-09-20', endDate: '2026-09-23', daysAway: 0 },
    ],
    getCalendarItemsForToday_: () => [],
    sendTravelDayBriefing_: k => { sends.push(k); },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(TDB, 'checkAndSendTravelDayBriefings_'), ctx);
  ctx.__o = { dateOverride: '2026-09-21' };
  vm.runInContext('checkAndSendTravelDayBriefings_(__o)', ctx);
  // Same day, different labels — the latch must not collapse them.
  check('both trips get a briefing', sends.length === 2, JSON.stringify(sends));
  check('…and each has its own latch', Object.keys(props).length === 2, JSON.stringify(Object.keys(props)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
