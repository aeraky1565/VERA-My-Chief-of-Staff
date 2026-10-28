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
const AH   = fs.readFileSync(ROOT + '/ApiHealth.js',         'utf8');

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

/** A top-level `var NAME = …;` lifted whole, for the fixtures a function reads. */
function extractVar(src, name) {
  const re = new RegExp('^var ' + name + '\\s*=', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('not found: var ' + name);
  let depth = 0;
  for (let j = m.index; j < src.length; j++) {
    const c = src[j];
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return src.slice(m.index, j + 1);
  }
  throw new Error('unterminated: var ' + name);
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

  check('a 400 bisects to name the offending stop',
        /Bisecting/.test(extractFn(TDB, 'travelMapVerdict_')) && /markers\.forEach/.test(d));
  check('the verdict decides whether to bisect',
        /verdict\.kind === 'bad_marker'/.test(d),
        'the branch used to be inline, which is why nothing could test it');
}

// THE VERDICT, RUN FOR REAL.
//
// These were source-text regexes over the diagnostic's body — /not authorized to use
// this api/ and friends. That pins the matcher's SPELLING without ever checking it
// against what Google says, and on 10 Oct it did not match:
//
//   HTTP 403 — "This API is not activated on your API project."
//   DIAGNOSIS — unrecognised failure.
//
// …for the one case the tool exists to name, with a one-click fix. A regex over the
// source cannot fail when Google's wording changes. This can.
console.log('\nthe verdict is decided by Google’s actual words');
{
  const ctx = { String, Object, Array, console };
  vm.createContext(ctx);
  // The not-enabled wording list lives in ApiHealth.js now — one list for the map
  // and the Calendar advanced service. Two files here, one global scope in Apps Script.
  vm.runInContext(extractFn(AH, 'googleApiNotEnabled_'), ctx);
  vm.runInContext(extractFn(TDB, 'travelMapVerdict_'), ctx);
  const verdict = (code, body) =>
    vm.runInContext('travelMapVerdict_(' + code + ',' + JSON.stringify(body) + ').kind', ctx);

  // The body captured from the live run. This is the regression fixture.
  const OBSERVED = 'The Google Maps Platform server rejected your request. This API is ' +
    'not activated on your API project. You may need to enable this API in the Google ' +
    'Cloud Console: https://console.cloud.google.com/apis/library?filter=category:maps. ' +
    'Learn more at https://developers.google.com/maps/gmp-get-started#enable-api-sdk.';
  check('the body Google actually sent reads as NOT ENABLED',
        verdict(403, OBSERVED) === 'not_enabled',
        verdict(403, OBSERVED) + ' — this exact text came back as "unrecognised"');

  check('…and so does the older wording',
        verdict(403, 'This API project is not authorized to use this API.') === 'not_enabled');
  check('…and the Calendar-style phrasing',
        verdict(403, 'Maps Static API has not been used in project 402807757311 before ' +
                     'or it is disabled.') === 'not_enabled',
        'the same sentence shape the Calendar advanced service produces');

  // THE KEY-RESTRICTION 403, captured 12 Oct from tbMapsStaticKey(). A third distinct
  // cause, not a third wording: the API is ON and this key may not call it, so the fix
  // is the Credentials page, not the Library's Enable button.
  const KEY_RESTRICTED = 'The Google Maps Platform server rejected your request. This ' +
    'API key is not authorized to use this service or API. Please check the API ' +
    'restrictions settings of your API key in the Google Cloud Console to ensure that ' +
    'all of the APIs and services you need to use are correctly specified in the list ' +
    'of enabled APIs. For more information, see ' +
    'https://developers.google.com/maps/api-key-best-practices.';
  check('a key that may not call the API is named as such',
        verdict(403, KEY_RESTRICTED) === 'key_restricted',
        verdict(403, KEY_RESTRICTED) + ' — this exact text came back as "unrecognised"');
  {
    const lines = vm.runInContext(
      'travelMapVerdict_(403,' + JSON.stringify(KEY_RESTRICTED) + ').lines.join("|")', ctx);
    check('…pointing at CREDENTIALS, not the Library',
          /CREDENTIALS/.test(lines) && /API restrictions/.test(lines), lines);
    check('…and saying so explicitly, since the two look alike',
          /NOT the Library/.test(lines), lines);
    check('…never telling you to enable the API',
          !/enable "Maps Static API"/.test(lines),
          lines + ' — that button already says Enabled; sending you there is a dead end');
  }
  // EACH PHRASE ON ITS OWN. The captured body carries both, so a test using only it
  // cannot tell whether the second matcher does anything — a control that drops it
  // stayed green until this existed. The second sentence is the durable half: it names
  // the setting to change, and survives Google rewording the first.
  check('the restrictions sentence alone is enough',
        verdict(403, 'Please check the API restrictions settings of your API key.') === 'key_restricted',
        verdict(403, 'Please check the API restrictions settings of your API key.'));
  check('…and the authorization sentence alone is too',
        verdict(403, 'This API key is not authorized to use this service or API.') === 'key_restricted');

  // The predicate Calendar shares must NOT learn this wording: same words, wrong remedy.
  check('googleApiNotEnabled_ stays blind to it',
        vm.runInContext('googleApiNotEnabled_(' + JSON.stringify(KEY_RESTRICTED) + ')', ctx) === false,
        'it is shared with the Calendar advanced service, which has no API-key list');
  // Branch ORDER, pinned. Both are restrictions; their fixes are incompatible.
  check('a body matching BOTH restriction kinds reads as the key one',
        verdict(403, KEY_RESTRICTED + ' The provided API key has referer restrictions.') === 'key_restricted',
        'the API-restriction list is the gate the request actually hit');

  check('a referrer restriction is named',
        verdict(403, 'The provided API key has referer restrictions that do not match.') === 'restricted');
  check('…and an IP restriction',
        verdict(403, 'This IP address is not authorized. Requests from this IP address ' +
                     'are blocked by the key\'s IP address restrictions.') === 'restricted');
  check('billing is named',
        verdict(403, 'You must enable Billing on the Google Cloud Project.') === 'billing');
  check('…and a 402 counts as billing even with an empty body',
        verdict(402, '') === 'billing');
  check('url signing is named',
        verdict(403, 'The request must be signed with a signature parameter.') === 'signing');
  check('a 400 is a bad marker', verdict(400, 'Invalid request. Invalid markers.') === 'bad_marker');

  // The catch-all is what made the misclassified failure recoverable — the diagnostic
  // still printed Google's own text above it. Widening the matchers must not cost that.
  check('something genuinely unknown still reaches the catch-all',
        verdict(500, 'Internal server error.') === 'unknown');
  check('…and an empty body on an odd code does too',
        verdict(418, '') === 'unknown');
  check('the catch-all still points at Google’s own text',
        /Google's own text/.test(
          vm.runInContext("travelMapVerdict_(500,'boom').lines.join('|')", ctx)));

  // Restriction must not swallow not-enabled. The real bodies above contain no referrer
  // wording, so this needs one that matches BOTH — otherwise reordering the branches
  // changes nothing and the ordering is untested.
  check('a body matching BOTH reads as not-enabled, the actionable one',
        verdict(403, 'This API is not activated on your API project. The provided API ' +
                     'key has referer restrictions.') === 'not_enabled',
        'enabling the API is the fix; "check your restrictions" would send you elsewhere');

  // The 403 gate is load-bearing: not-enabled wording on some other status is not a
  // not-enabled verdict, it is something we have not seen.
  check('not-enabled wording on a 500 is NOT reported as not-enabled',
        verdict(500, 'This API is not activated on your API project.') === 'unknown',
        'without the status gate any body mentioning it would be misread');
  check('…and on a 200 either',
        verdict(200, 'not activated') === 'unknown');
}

// THE KEY PROBE — the question the diagnostic above cannot answer on demand.
//
// diagnoseTravelDayMap_ refuses to fetch without a travel day carrying two mappable
// stops, so "is the Maps Static API on?" meant guessing a date and waiting on the
// enrichment's web searches. probeStaticMapsKey_ needs neither, and this drives the real
// one over a stubbed UrlFetchApp.
console.log('\nthe Maps Static key probe');
{
  function probeCtx(opts) {
    opts = opts || {};
    const fetched = [];
    const ctx = {
      String, Object, Array, Number, console, encodeURIComponent,
      PropertiesService: { getScriptProperties: () => ({
        getProperty: () => (opts.key === undefined ? 'AIzaTESTKEY0000000000' : opts.key),
      }) },
      UrlFetchApp: { fetch: (url) => {
        fetched.push(url);
        if (opts.throws) throw new Error('DNS failure');
        return {
          getResponseCode: () => opts.code,
          getHeaders:      () => ({ 'Content-Type': opts.ctype || '' }),
          getContentText:  () => opts.body || '',
        };
      } },
      _fetched: fetched,
    };
    vm.createContext(ctx);
    vm.runInContext(extractFn(AH, 'googleApiNotEnabled_'), ctx);
    vm.runInContext(extractFn(TDB, 'travelMapVerdict_'), ctx);
    vm.runInContext(extractVar(TDB, 'STATIC_MAP_PROBE_MARKERS_'), ctx);
    vm.runInContext(extractFn(TDB, 'probeStaticMapsKey_'), ctx);
    return ctx;
  }
  const probe = c => vm.runInContext('probeStaticMapsKey_()', c);

  // No key: it must not fetch AT ALL. Asserted on the call count, because "it returned
  // something sensible" is true of a version that fetches and then gives up.
  {
    const c = probeCtx({ key: '' });
    const r = probe(c);
    check('with no key it stops before fetching',
          r.reason === 'no key' && c._fetched.length === 0,
          JSON.stringify(r) + ' fetches: ' + c._fetched.length);
  }

  {
    const c = probeCtx({ code: 200, ctype: 'image/png' });
    const r = probe(c);
    check('an image is a pass', r.ok === true && r.code === 200, JSON.stringify(r.ok));
    check('…and carries no verdict to print', r.verdict === null);

    const url = c._fetched[0];
    check('it calls the same endpoint the email does',
          url.indexOf('https://maps.googleapis.com/maps/api/staticmap?') === 0, url);
    // Coordinates, not addresses: geocoding is the only other thing that can 400 this
    // request, and a probe that can fail two ways answers neither.
    check('…with coordinate markers, so geocoding cannot confound it',
          /markers=[-0-9.]+%2C[-0-9.]+/.test(url) && !/[A-Za-z]{3,}\+/.test(url), url);
    check('…two of them, as a real map has', (url.split('markers=').length - 1) === 2, url);
  }

  // A 200 that is not an image is Google answering with something other than a map.
  {
    const c = probeCtx({ code: 200, ctype: 'text/html', body: '<html>nope</html>' });
    check('a non-image 200 is NOT a pass', probe(c).ok === false,
          'calling that success is how a probe lies');
  }

  // The regression fixture: the body from the live 403 on 10 Oct.
  {
    const c = probeCtx({ code: 403, ctype: 'text/html',
      body: 'The Google Maps Platform server rejected your request. This API is not ' +
            'activated on your API project.' });
    const r = probe(c);
    check('the real 403 is reported as a failure', r.ok === false && r.code === 403);
    check('…and NAMED as not-enabled', r.verdict && r.verdict.kind === 'not_enabled',
          JSON.stringify(r.verdict && r.verdict.kind));
    check('…pointing at the Cloud Console',
          /enable "Maps Static API"/.test((r.verdict.lines || []).join('|')),
          (r.verdict.lines || []).join('|'));
  }

  // The trap a referrer-restricted key can never escape in email.
  {
    const c = probeCtx({ code: 403, ctype: 'text/html',
      body: 'The provided API key has referer restrictions that do not match.' });
    const r = probe(c);
    check('a referrer restriction is named as such',
          r.verdict && r.verdict.kind === 'restricted',
          JSON.stringify(r.verdict && r.verdict.kind) +
          ' — Gmail sends no referrer, so that key can never work here');
  }

  {
    // Run through a catch: the probe must SWALLOW a thrown request, and a version that
    // rethrows would otherwise take this file down instead of failing the assertion
    // that says so.
    const c = probeCtx({ throws: true });
    let r = null, threw = null;
    try { r = probe(c); } catch (e) { threw = e.message; }
    check('a thrown request is caught, not propagated',
          threw === null && r && r.reason === 'fetch threw',
          threw ? 'it escaped: ' + threw : JSON.stringify(r));
  }

  // The TestBench entry, and the promise it makes.
  const tb = extractFn(TB, 'tbMapsStaticKey');
  check('TestBench exposes it', /function tbMapsStaticKey\(\)/.test(TB));
  check('…and never logs the key itself', !/apiKey/.test(tb) && !/GOOGLE_STATIC_MAPS_API_KEY.{0,40}Logger/.test(tb));
  check('…it reads no knobs', !/TB_DATE|TB_TRIP_LABEL|TB_AIRPORTS/.test(tb),
        'needing a knob is the whole thing this exists to avoid');
  check('…it never sends mail', !/sendVeraEmail_|MailApp/.test(tb));
  check('…nor writes a sheet', !/setValue|appendRow/.test(tb));
  const pr = extractFn(TDB, 'probeStaticMapsKey_');
  check('the probe reuses the verdict rather than its own matchers',
        /travelMapVerdict_\(/.test(pr) && !/not activated/.test(pr),
        'a private wording list here is exactly what 4dd60cc removed');
}

console.log('\nthe diagnostic’s own shape');
{
  const d = extractFn(TDB, 'diagnoseTravelDayMap_');

  check('it shows addresses JSON-quoted so arrows and newlines are visible',
        /JSON\.stringify\(e\.displayAddress/.test(d));
  check('it uses the same screening the email uses', /travelMapMarkers_\(enriched\)/.test(d));
  check('a 200 image is reported as a pass', /PASS/.test(d) && /indexOf\('image'\) === 0/.test(d));
  check('it never sends mail',  !/sendVeraEmail_|MailApp/.test(d));
  check('it never writes a sheet', !/setValue|appendRow/.test(d));
  // Asserted on the verdict's OUTPUT, not this file's source: the explanation moved
  // into travelMapVerdict_ when it was split out, and a source-text check over the
  // wrong function would have gone quietly vacuous.
  {
    const vctx = { String, Object, Array, console };
    vm.createContext(vctx);
    vm.runInContext(extractFn(AH, 'googleApiNotEnabled_'), vctx);
    vm.runInContext(extractFn(TDB, 'travelMapVerdict_'), vctx);
    const lines = vm.runInContext(
      "travelMapVerdict_(403,'This API is not activated on your API project.').lines.join('|')", vctx);
    check('the not-enabled verdict explains why testTravelLegsApi_ passing proves nothing',
          /Distance Matrix/.test(lines) && /testTravelLegsApi_/.test(lines),
          lines + ' — the same key can pass Distance Matrix and fail Maps Static');
    check('…and names the one-click fix',
          /enable "Maps Static API"/.test(lines), lines);
  }

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
  vm.runInContext(['travelRowDate_', 'travelTripKey_', 'travelDayRanges_', 'checkAndSendTravelDayBriefings_']
    .map(n => extractFn(TDB, n)).join('\n'), ctx);
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
  vm.runInContext(['travelRowDate_', 'travelTripKey_', 'travelDayRanges_', 'checkAndSendTravelDayBriefings_']
    .map(n => extractFn(TDB, n)).join('\n'), ctx);
  ctx.__o = { dateOverride: '2026-09-21' };
  vm.runInContext('checkAndSendTravelDayBriefings_(__o)', ctx);
  // Same day, different labels — the latch must not collapse them.
  check('both trips get a briefing', sends.length === 2, JSON.stringify(sends));
  check('…and each has its own latch', Object.keys(props).length === 2, JSON.stringify(Object.keys(props)));
}

// ============ the range asked of the itinerary =============================
//
// The Chicago Trip: the sheet had a stay dated Oct 21 (checkout Oct 28 in its
// metadata) and two dinners on Oct 23-24. The calendar trip ran Oct 21-28. The
// flight home on Oct 28 lived only on the calendar. The briefing kept the
// sheet's Oct 21-24 as the trip's range, asked the itinerary about those days,
// and the Oct 28 email said nothing had been logged.

function runRange(o) {
  const asked = [];
  const sends = [];
  const ctx = {
    String, Array, Number, Object, Date, JSON, Math, RegExp, isFinite, Error,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
    TABS: { ITINERARY: 'Itinerary' },
    ITINERARY_HEADERS: new Array(10).fill('x'),
    getConfigValues: () => ({}), readPTOConfig_: () => ({}), veraLog_: () => {},
    getSpreadsheet: () => ({ getSheetByName: () => ({
      getLastRow: () => 4,
      getRange: () => ({ getValues: () => [
        ['ITIN-1', '2026-10-21|Lake Trip', 'arranged_stay', 'Staying with friends', '2026-10-21',
         '', '', '', '', o.meta === undefined ? '{"checkoutDate":"2026-10-28"}' : o.meta],
        ['ITIN-2', '2026-10-21|Lake Trip', 'dining', 'Drinks', '2026-10-23', '18:00', '', '', '', ''],
        ['ITIN-3', '2026-10-21|Lake Trip', 'dining', 'Brunch', '2026-10-24', '12:30', '', '', '', ''],
      ] }),
    })}),
    getUpcomingTravel_: () => o.cal || [],
    fetchTripDayItems_: (k, a, b, today) => { asked.push([k, a, b]); return [['x']]; },
    sendTravelDayBriefing_: (k, items) => { sends.push([k, items.length]); },
  };
  vm.createContext(ctx);
  vm.runInContext(['travelRowDate_', 'travelTripKey_', 'travelDayRanges_', 'checkAndSendTravelDayBriefings_']
    .map(n => extractFn(TDB, n)).join('\n'), ctx);
  ctx.__o = { dateOverride: o.today };
  vm.runInContext('checkAndSendTravelDayBriefings_(__o)', ctx);
  return { asked, sends };
}

console.log('\nthe last day of a trip is asked about, not just the days with rows');
{
  const cal = [{ label: 'Lake Trip', startDate: '2026-10-21', endDate: '2026-10-28', daysAway: 0 }];
  const r = runRange({ today: '2026-10-28', cal, meta: '' });
  check('a briefing goes out on the last day', r.sends.length === 1, JSON.stringify(r.sends));
  check('…and the itinerary is asked through the calendar trip\'s end',
        r.asked.length === 1 && r.asked[0][2] === '2026-10-28', JSON.stringify(r.asked));
  check('…from its start', r.asked.length === 1 && r.asked[0][1] === '2026-10-21', JSON.stringify(r.asked));

  const mid = runRange({ today: '2026-10-23', cal, meta: '' });
  check('a mid-trip day still asks for the whole trip',
        mid.asked.length === 1 && mid.asked[0][2] === '2026-10-28', JSON.stringify(mid.asked));
}

console.log('\n…and a stay\'s checkout counts as part of the trip, calendar or not');
{
  const r = runRange({ today: '2026-10-28' });
  check('checkout day gets a briefing with no calendar trip at all', r.sends.length === 1, JSON.stringify(r.sends));
  check('…asked through the checkout', r.asked.length === 1 && r.asked[0][2] === '2026-10-28',
        JSON.stringify(r.asked));

  const after = runRange({ today: '2026-10-29' });
  check('the day after checkout is not a travel day', after.sends.length === 0, JSON.stringify(after.sends));

  const bad = runRange({ today: '2026-10-28', meta: 'not json' });
  check('metadata that is not JSON is ignored, not fatal', bad.sends.length === 0, JSON.stringify(bad.sends));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
