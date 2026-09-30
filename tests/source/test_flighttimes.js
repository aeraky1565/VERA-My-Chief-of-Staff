// Flight times in the travel-day briefing.
//
// The reported bug, verbatim from a real email:
//
//   USEFUL TO KNOW → Times: 6:47 PM (TPA) → 1:03 AM (unknown)
//   TODAY'S SCHEDULE →      18:47 – 21:03
//
// Same email, same flight, two different answers. 21:03 EDT is 01:03 UTC, and
// the whole "useful to know" block was Claude's prose — handed a UTC instant
// under a label asserting it was airport-local, and a destination of "unknown".
//
// The dashboard's Active Travel Card renders the same flight correctly, because
// it comes through webGetItinerary_, which formats departure in the event's
// startTz and arrival in its endTz. The briefing now uses that same path.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const TDB  = fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8');
const WEB  = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');

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

// Real airport geography, so the computed figures can be checked against
// something true rather than against themselves.
const GEO = {
  TPA: { lat: 27.98, lon: -82.53, timezone: 'America/New_York' },
  IAD: { lat: 38.95, lon: -77.46, timezone: 'America/New_York' },
  LAX: { lat: 33.94, lon: -118.41, timezone: 'America/Los_Angeles' },
  LHR: { lat: 51.47, lon: -0.45,   timezone: 'Europe/London' },
};
const OFFSETS = {          // on the fixture date, 2026-09-21
  'America/New_York':    -4,
  'America/Los_Angeles': -7,
  'Europe/London':        1,
};

function ctxFor(opts) {
  opts = opts || {};
  const logs = [];
  const claudeCalls = [];
  const ctx = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, isFinite, isNaN, parseInt, parseFloat, Error,
    Logger: { log: m => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: {
      formatDate: (d, tz, f) => {
        if (f === 'Z') {
          const off = OFFSETS[tz];
          if (off === undefined) throw new Error('unstubbed zone: ' + tz);
          const sign = off < 0 ? '-' : '+';
          const a = Math.abs(off);
          return sign + String(Math.floor(a)).padStart(2, '0') + String(Math.round((a % 1) * 60)).padStart(2, '0');
        }
        return d.toISOString().slice(0, 10);
      },
    },
    getConfigValues: () => ({}),
    resolveIataToCity_: code => ({ TPA: 'Tampa', IAD: 'Washington', LAX: 'Los Angeles', LHR: 'London' }[code] || null),
    geocodePackingDestination_: city => {
      const byCity = { Tampa: 'TPA', Washington: 'IAD', 'Los Angeles': 'LAX', London: 'LHR' };
      const code = byCity[city];
      return code ? Object.assign({ name: city }, GEO[code]) : null;
    },
    callClaudeJson_: p => {
      claudeCalls.push(p);
      return opts.claudeReply !== undefined ? opts.claudeReply : {
        pre_trip_tip: 'Sleep well.', arrival_tip: 'Get sunlight.', daynight_pct_day: 80,
      };
    },
  };
  vm.createContext(ctx);
  vm.runInContext([
    extractFn(TDB, 'travelAirportGeo_'),
    extractFn(TDB, 'haversineMiles_'),
    extractFn(TDB, 'tzOffsetHoursOn_'),
    extractFn(TDB, 'tzOffsetLabel_'),
    extractFn(TDB, 'haulCategoryFor_'),
    extractFn(TDB, 'travelTo12Hour_'),
    extractFn(TDB, 'buildTravelFlightInsightsData_'),
  ].join('\n'), ctx);
  ctx.__logs = logs;
  ctx.__claude = claudeCalls;
  return ctx;
}

// [ID, TripKey, Type, Title, Date, StartTime, EndTime, Location, Notes, Metadata]
const flightRow = (o) => ['CAL-1', '2026-09-20|Florida Trip', 'flight',
  o.title || 'Flight to Washington (UA 1370)', o.date || '2026-09-21',
  o.start || '18:47', o.end || '21:03', o.loc || 'Tampa TPA', '',
  JSON.stringify(o.meta || {})];

const insightsFor = (ctx, row) => { ctx.__items = [row]; return vm.runInContext('buildTravelFlightInsightsData_(__items, "Fairfax, VA")', ctx); };

// ============ the reported case ============================================

console.log('\nTHE BUG: 21:03 renders as 21:03, not 1:03 AM');
{
  const ctx = ctxFor();
  // metadata carries the airport codes, as webGetItinerary_ now supplies them
  // from the event DESCRIPTION rather than the title.
  const r = insightsFor(ctx, flightRow({ meta: { origin: 'TPA', dest: 'IAD' } }));

  check('the arrival is 9:03 PM', /9:03 PM/.test(r.arr_local), r.arr_local);
  check('…and is NOT 1:03 AM',   !/1:03 AM/.test(String(r.arr_local)), r.arr_local);
  check('the departure is 6:47 PM', /6:47 PM/.test(r.dep_local), r.dep_local);
  check('the arrival airport is named', /\(IAD\)/.test(r.arr_local), r.arr_local);
  check('…and never the literal "unknown"', !/unknown/i.test(String(r.arr_local)), r.arr_local);
  // Same zone both ends, so this is the case that used to say "same timezone"
  // by luck. Now it says it because both zones were looked up.
  check('the offset is a measured 0', r.tz_offset_hours === 0, r.tz_offset_hours);
  check('…labelled as same timezone', r.tz_offset_label === 'same timezone', r.tz_offset_label);
}

console.log('\n…and the prompt never calls a UTC instant "local"');
{
  const ctx = ctxFor();
  insightsFor(ctx, flightRow({ meta: { origin: 'TPA', dest: 'IAD' } }));
  const prompt = ctx.__claude[0];
  check('a prompt was built', typeof prompt === 'string' && prompt.length > 0);
  // The old wording asserted a zone it had no basis for. That is the bug.
  check('no "local to origin airport" claim',      !/local to origin airport/i.test(prompt), prompt.slice(0, 400));
  check('no "local to destination airport" claim', !/local to destination airport/i.test(prompt));
  check('the times are labelled with the real zone',
        /Departure time \(America\/New_York\): 18:47/.test(prompt), (prompt.match(/Departure time[^\n]*/) || [''])[0]);
  check('…both of them',
        /Arrival time \(America\/New_York\): 21:03/.test(prompt), (prompt.match(/Arrival time[^\n]*/) || [''])[0]);
  check('no ISO instant reaches the prompt', !/\dT\d{2}:\d{2}.*Z/.test(prompt));
  check('the measured facts are handed over, not requested',
        /Great-circle distance: \d+ miles/.test(prompt), (prompt.match(/Great-circle[^\n]*/) || [''])[0]);
  check('…and the model is told not to contradict them', /Do not restate, recompute or contradict/.test(prompt));
  check('the model is no longer asked for distance', !/"distance_miles"/.test(prompt));
  check('…nor for the timezone offset',              !/"tz_offset_hours"/.test(prompt));
  check('…nor for the clock times',                  !/"dep_local"/.test(prompt));
  check('it is still asked for the prose',           /"arrival_tip"/.test(prompt) && /"pre_trip_tip"/.test(prompt));
}

console.log('\n…and a UTC instant in metadata is refused, not trusted');
{
  // The old calendar pull wrote this. If such a row survives anywhere, the
  // row's own local columns must still win.
  const ctx = ctxFor();
  const r = insightsFor(ctx, flightRow({ meta: {
    origin: 'TPA', dest: 'IAD',
    dep_scheduled: '2026-09-21T22:47:00.000Z',
    arr_scheduled: '2026-09-22T01:03:00.000Z',
  }}));
  check('the row columns win', /9:03 PM/.test(r.arr_local), r.arr_local);
  check('…and it says it ignored the ISO value',
        /ignoring non-local time/.test(ctx.__logs.join('\n')), ctx.__logs.join('\n').slice(0, 200));

  // The dashboard's synthetic row legitimately puts HH:mm in the same field.
  const ctx2 = ctxFor();
  const r2 = insightsFor(ctx2, ['', '', 'flight', 'IAD → LAX', '2026-09-21', '', '',
    'IAD → LAX', '', JSON.stringify({ origin: 'IAD', dest: 'LAX',
      dep_scheduled: '08:15', arr_scheduled: '11:05' })]);
  check('an HH:mm metadata time is accepted', /8:15 AM/.test(r2.dep_local), r2.dep_local);
}

// ============ the facts are measured =======================================

console.log('\nthe numbers are computed, not generated');
{
  // A model answering anyway must not be able to contradict a measurement.
  const ctx = ctxFor({ claudeReply: {
    distance_miles: 99999, tz_offset_hours: 42, tz_offset_label: '+42h',
    haul_category: 'Interplanetary', dep_local: 'lunchtime', arr_local: 'teatime',
    origin_code: 'ZZZ', dest_code: 'ZZZ', daynight_pct_day: 55,
  }});
  const r = insightsFor(ctx, ['', '', 'flight', 'IAD to LAX', '2026-09-21',
    '08:15', '11:05', 'IAD', '', JSON.stringify({ origin: 'IAD', dest: 'LAX' })]);

  check('the absurd mileage is discarded', r.distance_miles !== 99999, r.distance_miles);
  // IAD→LAX is ~2,090 statute miles.
  check('…and replaced with a real one', r.distance_miles > 1900 && r.distance_miles < 2300, r.distance_miles);
  check('the haul band follows the measurement', r.haul_category === 'Medium-haul', r.haul_category);
  check('the absurd offset is discarded', r.tz_offset_hours === -3, r.tz_offset_hours);
  check('…and labelled from the measurement', r.tz_offset_label === '-3h', r.tz_offset_label);
  check('the invented clock times are discarded', /8:15 AM/.test(r.dep_local), r.dep_local);
  check('the invented codes are discarded', r.origin_code === 'IAD' && r.dest_code === 'LAX',
        r.origin_code + '/' + r.dest_code);
  // The one field still the model's to estimate.
  check('daynight_pct_day is still the model’s', r.daynight_pct_day === 55, r.daynight_pct_day);
}

console.log('\n…and an eastbound long haul reads correctly');
{
  const ctx = ctxFor();
  const r = insightsFor(ctx, ['', '', 'flight', 'IAD to LHR', '2026-09-21',
    '18:30', '06:45', 'IAD', '', JSON.stringify({ origin: 'IAD', dest: 'LHR' })]);
  check('eastbound is a positive offset', r.tz_offset_hours === 5, r.tz_offset_hours);
  check('…labelled +5h', r.tz_offset_label === '+5h', r.tz_offset_label);
  // IAD→LHR is ~3,670 miles.
  check('the distance is right', r.distance_miles > 3500 && r.distance_miles < 3800, r.distance_miles);
  check('…and bands as long-haul', r.haul_category === 'Long-haul', r.haul_category);
}

console.log('\n…and an unknown airport yields NO number, not a confident one');
{
  const ctx = ctxFor();
  // No codes anywhere: the title has none and the location has only one.
  const r = insightsFor(ctx, flightRow({ meta: {} }));
  check('the destination is null', r.dest_code === null, r.dest_code);
  check('the distance is null, not a guess', r.distance_miles === null, r.distance_miles);
  check('the haul band is null too', r.haul_category === null, r.haul_category);
  check('the offset is null, NOT zero', r.tz_offset_hours === null, r.tz_offset_hours);
  check('…and the label is null', r.tz_offset_label === null, r.tz_offset_label);
  // The old code coerced the offset to 0, which the dashboard recovery card
  // reads as "no jet lag" and then silently hides itself for good.
  check('the zero-coercion is gone from the source',
        !/tz_offset_hours !== 'number'/.test(TDB));

  // The departure is still known, and must survive.
  check('the known departure time is kept', /6:47 PM/.test(r.dep_local), r.dep_local);
  check('…with the origin named', /\(TPA\)/.test(r.dep_local), r.dep_local);
  // The arrival TIME is known — it is right there in the row. Only the airport
  // code is not, so the code is simply omitted rather than printed as the
  // literal string "(unknown)" beside it.
  check('the arrival time is still shown', /9:03 PM/.test(r.arr_local), r.arr_local);
  check('…with no airport in parentheses', !/\(/.test(String(r.arr_local)), r.arr_local);
  check('…and never the word unknown', !/unknown/i.test(String(r.arr_local)), r.arr_local);
}

// ============ the renderers ================================================

function renderCtx() {
  const ctx = { String, Number, Math, Object, Array, RegExp, isFinite,
                escapeHtml_: s => String(s == null ? '' : s)
                  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  vm.createContext(ctx);
  vm.runInContext(extractFn(TDB, 'buildTravelFlightInsightsSection_'), ctx);
  return ctx;
}
const html = (ctx, ins) => { ctx.__i = ins; return vm.runInContext('buildTravelFlightInsightsSection_(__i)', ctx); };

console.log('\na known departure survives an unknown arrival');
{
  const ctx = renderCtx();
  const out = html(ctx, { dep_local: '6:47 PM (TPA)', arr_local: null });
  // The AND-gate used to throw away a time it actually had.
  check('the departure still renders', /6:47 PM/.test(out), out.slice(0, 300));
  check('…and the gap is named, not hidden', /arrival unknown/.test(out), out.slice(0, 300));
}

console.log('\n…and an empty insights object renders nothing at all');
{
  const ctx = renderCtx();
  check('no bare heading', html(ctx, {}) === '', html(ctx, {}).slice(0, 120));
  check('null is still nothing', html(ctx, null) === '');
  // …but one real field brings the heading back.
  check('one row brings the heading', /Useful to Know/.test(html(ctx, { distance_miles: 842 })));
}

console.log('\n…and the daylight bar cannot crash the send');
{
  // '█'.repeat(negative) throws RangeError, the plain text is built BEFORE the
  // send, and it is outside any try/catch — so this would take the email and
  // the Slack copy down together.
  const ctx = ctxFor();
  [-5, 120, 1e9, NaN].forEach(function(v) {
    const c = ctxFor({ claudeReply: { daynight_pct_day: v, arrival_tip: 'x' } });
    const r = insightsFor(c, flightRow({ meta: { origin: 'TPA', dest: 'IAD' } }));
    const ok = r.daynight_pct_day === null ||
               (r.daynight_pct_day >= 0 && r.daynight_pct_day <= 100);
    check('a pct of ' + v + ' is clamped or nulled', ok, r.daynight_pct_day);
  });

  const txt = extractFn(TDB, 'buildTravelDayPlainText_');
  check('the plain-text bar clamps too', /Math\.max\(0, Math\.min\(10,/.test(txt));
  check('…and prints the clamped value', /\+ pctDay \+ '% daytime'/.test(txt));
}

// ============ the wiring ===================================================

console.log('\nthe briefing consumes the path the dashboard card uses');
{
  const run = extractFn(TDB, 'checkAndSendTravelDayBriefings_');
  check('it fetches through the adapter', /fetchTripDayItems_\(/.test(run));
  // After the latch, so a trip under two keys costs one call, not two.
  check('…after the send latch',
        run.indexOf('_tdbSeen[_sKey] = true') < run.indexOf('fetchTripDayItems_('));
  check('…and falls back to sheet rows if it throws', /falling back to sheet rows/.test(run));

  const fetch = extractFn(TDB, 'fetchTripDayItems_');
  check('it calls webGetItinerary_', /webGetItinerary_\(\{/.test(fetch));
  // No second argument — that is the whole point. skipEventTz would drop the
  // per-event timezone pass and reproduce the bug.
  check('…WITHOUT skipEventTz', !/skipEventTz/.test(fetch), 'skipEventTz must not appear');
  check('it adapts items to 10-column rows', /it\.startTime, it\.endTime/.test(fetch));
  check('…and filters to today', /=== today/.test(fetch));

  check('the old calendar merge block is gone', !/calendar auto-pull added/.test(TDB));
  check('…and its title-only dedupe with it', !/already logged manually today/.test(TDB));

  // Ported rather than duplicated.
  check('confirmationNumber now comes from webGetItinerary_',
        /evMeta\.confirmationNumber = confMatch\[1\]/.test(WEB));
  check('…in the flight branch', /conf\(\?:irmation\)\?\[#:\\s\]\+/.test(WEB));

  // The line that makes the computed timezone possible at all.
  check('the geocoder stops discarding the timezone',
        /timezone: r\.timezone \|\| ''/.test(WEB));
}

console.log('\n…and the lounge section can render again');
{
  // Comments stripped: the replacement comment NAMES the removed variables in
  // prose, and a raw grep cannot tell an explanation from a reference.
  const lounge = extractFn(TDB, 'getLoungePerkPrograms_')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // An orphaned paragraph of buildTravelDayPlainText_ was spliced into this
  // function's body, referencing narrativeData and lines — neither in scope.
  // Every call threw, the catch returned [], and LOUNGE ACCESS was silently
  // empty on every travel-day email ever sent.
  check('no stray narrativeData reference', !/narrativeData/.test(lounge), 'orphan still present');
  check('no stray lines.push', !/lines\.push/.test(lounge));
  check('…and it still does its real work',
        /loungeProgramsForPerk_/.test(lounge) && /cpData\.forEach/.test(lounge),
        'the keyword list moved out to LOUNGE_PROGRAM_PATTERNS_; the sheet read stays here');
  check('the tagline block still exists where it belongs',
        /narrativeData\.tagline/.test(extractFn(TDB, 'buildTravelDayPlainText_')));
}

// ---------------------------------------------------------------------------
// The dashboard. Three copies of the same card: docs/app.js (the source),
// docs/index.html (built from it), and docs/dashboard-lite.html (standalone).
// The recovery card is run for real here — its IIFE is lifted out of the file
// and given a recording React — rather than asserted against by regex, because
// what broke was behaviour: an unknown offset coerced to 0 set _recoverDays to
// 0, and the panel silently vanished on every day after the flight.
console.log('\n…and the dashboard renders what it knows');
{
  const COPIES = {
    'docs/app.js':               fs.readFileSync(ROOT + '/docs/app.js', 'utf8'),
    'docs/index.html':           fs.readFileSync(ROOT + '/docs/index.html', 'utf8'),
    'docs/dashboard-lite.html':  fs.readFileSync(ROOT + '/docs/dashboard-lite.html', 'utf8'),
  };

  // Lift the recovery-card IIFE out by brace-matching, exactly as the function
  // extractor above does — never a retyped copy.
  function liftCard(src, label) {
    const anchor = src.indexOf('flightInsights&&/*#__PURE__*/(function(){');
    if (anchor === -1) throw new Error('card not found in ' + label);
    const open = src.indexOf('{', src.indexOf('(function()', anchor));
    let depth = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(open, j + 1); }
    }
    throw new Error('unbalanced card in ' + label);
  }

  // A React that records. Text is everything the card would put on screen.
  function renderCard(body, state) {
    const ctx = vm.createContext({
      Math: Math, Number: Number, String: String, Date: Date, console: console,
      React: { createElement: function (tag, props) {
        return { children: Array.prototype.slice.call(arguments, 2) };
      } },
      flightInsights: state.flightInsights,
      todayFlights:   state.todayFlights || [],
      items:          state.items || [],
      displayDay:     state.displayDay,
      departing:      !!state.departing,
      insightsOpen:   true,
      setInsightsOpen: function () {},
    });
    const tree = new vm.Script('(function()' + body + ')()').runInContext(ctx);
    if (tree === null) return null;
    const out = [];
    (function walk(n) {
      if (n === null || n === undefined || n === false) return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (typeof n === 'object') return (n.children || []).forEach(walk);
      out.push(String(n));
    })(tree);
    return out.join('');
  }

  const FLEW_YESTERDAY = {
    items: [{ type: 'flight', date: '2026-03-01' }],
    displayDay: '2026-03-02',
    todayFlights: [],
  };

  Object.keys(COPIES).forEach(function (label) {
    const body = liftCard(COPIES[label], label);

    // The regression: a westbound flight whose airports could not be resolved.
    // tz_offset_hours is null, and null used to become 0.
    const unknown = renderCard(body, Object.assign({}, FLEW_YESTERDAY, {
      flightInsights: { tz_offset_hours: null, tz_offset_label: null,
                        origin_code: null, dest_code: null, arrival_tip: 'Get morning light.' },
    }));
    check(label + ': an unknown offset still shows the panel', unknown !== null,
          'panel hidden — tz_offset_hours null collapsed _recoverDays to 0');
    check(label + ': …and says the shift is unknown',
          unknown !== null && /Timezone shift unknown/.test(unknown), unknown);
    check(label + ': …and claims no recovery-day count it does not have',
          unknown !== null && !/ of /.test(unknown), unknown);

    // Westbound, known. The old card hardcoded " ahead of home" for every sign,
    // so -4h read "You're -4h ahead of home".
    const west = renderCard(body, Object.assign({}, FLEW_YESTERDAY, {
      flightInsights: { tz_offset_hours: -3, tz_offset_label: '-3h',
                        origin_code: 'IAD', dest_code: 'LAX', arrival_tip: 'Stay up.' },
    }));
    check(label + ': a westbound shift is not called "ahead of home"',
          west !== null && !/ahead of home/.test(west), west);
    check(label + ': …and names both airports it was given',
          west !== null && /IAD/.test(west) && /LAX/.test(west), west);
    check(label + ': …and counts the recovery days it can',
          west !== null && /day 1 of 2/.test(west), west);

    // A same-zone flight has no jet lag to recover from.
    const same = renderCard(body, Object.assign({}, FLEW_YESTERDAY, {
      flightInsights: { tz_offset_hours: 0, tz_offset_label: 'same timezone',
                        origin_code: 'TPA', dest_code: 'IAD' },
    }));
    check(label + ': a same-timezone flight shows no recovery panel', same === null, same);

    // On the flight day itself the fact rows render, and a known departure must
    // survive an unknown arrival.
    const flightDay = renderCard(body, {
      items: [{ type: 'flight', date: '2026-03-01' }],
      displayDay: '2026-03-01',
      todayFlights: [{ id: 'f1' }],
      flightInsights: { tz_offset_hours: null, tz_offset_label: null,
                        origin_code: 'TPA', dest_code: null,
                        dep_local: '6:47 PM (TPA)', arr_local: null, distance_miles: 842 },
    });
    check(label + ': a known departure survives an unknown arrival',
          flightDay !== null && /6:47 PM \(TPA\)/.test(flightDay), flightDay);
    check(label + ': …and the missing half is named, not blanked',
          flightDay !== null && /arrival unknown/.test(flightDay), flightDay);
    check(label + ': …and an unknown offset prints no number',
          flightDay !== null && !/\+0h/.test(flightDay) && !/0h/.test(flightDay), flightDay);
  });

  // The lite dashboard's itinerary panel is spaced JSX, not the minified form,
  // so it needs its own gate check. Transformed the way the browser does it —
  // that is also the syntax gate for the whole file.
  const lite = COPIES['docs/dashboard-lite.html'];
  const jsx  = lite.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
  check('dashboard-lite still has its babel block', !!jsx);
  if (jsx) {
    let transformed = null;
    try {
      const Babel = require('@babel/standalone');
      transformed = Babel.transform(jsx[1], { presets: ['react'] }).code;
    } catch (e) { /* reported below */ }
    check('dashboard-lite JSX still transforms', !!transformed);
    check('…and its itinerary times gate is an OR',
          /insights\.dep_local \|\| insights\.arr_local/.test(jsx[1]));
    check('…showing the half it has',
          /insights\.dep_local \|\| 'departure unknown'/.test(jsx[1]) &&
          /insights\.arr_local \|\| 'arrival unknown'/.test(jsx[1]));
  }

  // index.html is generated; drift between it and app.js has shipped a dead
  // feature before (commit 58c4245), so assert they agree.
  check('index.html carries this change, not a stale build',
        COPIES['docs/index.html'].indexOf('_tzKnown') !== -1,
        'run node docs/build.js');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
