// HTTP 429 is "try later", not "this data is wrong".
//
// The morning banner carried this every day:
//
//   open-meteo — last good data 8h 17m ago
//   HTTP 429 — {"reason":"Daily API request limit exceeded. Please try again tomorrow."}
//
// …for a quota VERA does not spend. Open-Meteo rate-limits per IP and Apps Script
// egresses from Google ranges shared with every Apps Script project, while VERA makes a
// handful of calls a night. Unactionable, daily, and corrosive to the one banner this
// week's work exists to keep worth reading — the same "alarm permanently about correct
// behaviour" failure Watchdog.js's header warns about, in a different file.
//
// recordApiHealth_ counted a 429 like a 500. It no longer does. What matters just as
// much is everything the change must NOT do: a 429 must not clear, mask or outrank a
// genuine failure, and every other status code must behave exactly as before.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const API = fs.readFileSync(ROOT + '/ApiHealth.js', 'utf8');
const WEATHER = fs.readFileSync(ROOT + '/Weather.js', 'utf8');

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

const HOUR = 3600000;

// The real recordApiHealth_, driven against an in-memory state map and a clock the
// test owns. Never a copy — a copy would only prove the copy works.
function harness(initialState) {
  let now = Date.UTC(2026, 9, 8, 12, 0, 0);
  const state = JSON.parse(JSON.stringify(initialState || {}));
  const logs = [], alerts = [];

  const ctx = {
    String, Number, Object, Array, Math, JSON, Error, console, isNaN,
    Date: { now: () => now },
    Logger: { log: m => logs.push(String(m)) },
    getApiHealthState_: () => state,
    setApiHealthState_: s => { Object.keys(s).forEach(k => { state[k] = s[k]; }); },
    formatAge_: ms => Math.round(ms / HOUR) + 'h',
    veraLog_: (src, cat, status, summary, ms, err) =>
      alerts.push({ src, status, summary, err }),
    API_HEALTH_NO_SLACK_: {},
    _state: state, _logs: logs, _alerts: alerts,
    _advance: ms => { now += ms; },
    _now: () => now,
  };
  vm.createContext(ctx);
  vm.runInContext(
    /^var API_ALERT_COOLDOWN_MS_\s*=.*?;/m.exec(API)[0] + '\n' +
    extractFn(API, 'recordApiHealth_'), ctx);
  return ctx;
}

const rec = (c, source, ok, detail, code) =>
  vm.runInContext('recordApiHealth_(' + JSON.stringify(source) + ',' + ok + ',' +
                  JSON.stringify(detail || '') + ',' + code + ')', c);

// ============================================================================
console.log('A 429 is not a degraded source');
{
  const c = harness();
  rec(c, 'open-meteo', true, '', 200);
  const good = c._state['open-meteo'].lastSuccess;

  c._advance(8 * HOUR);
  rec(c, 'open-meteo', false, '{"reason":"Daily API request limit exceeded"}', 429);
  const e = c._state['open-meteo'];

  check('consecutiveFailures is untouched', e.consecutiveFailures === 0, JSON.stringify(e));
  check('…which is what keeps it out of the banner',
        /if \(!e \|\| !e\.consecutiveFailures\) return;/.test(API),
        'getDegradedSources_ filters on exactly this field');
  check('lastFailure is untouched', e.lastFailure === 0, JSON.stringify(e));
  check('lastError is untouched', e.lastError === '', JSON.stringify(e));
  check('lastSuccess is preserved', e.lastSuccess === good, JSON.stringify(e));
  check('the rate limit IS recorded', e.lastRateLimited === c._now() && e.rateLimitHits === 1,
        JSON.stringify(e));
  check('…and logged every time',
        c._logs.some(l => /rate limited \(HTTP 429\)/.test(l)), JSON.stringify(c._logs));
}

console.log('\nIt cannot hide a real fault');
{
  const c = harness();
  rec(c, 'api', true, '', 200);
  c._advance(HOUR);
  rec(c, 'api', false, 'upstream exploded', 500);
  const degraded = JSON.parse(JSON.stringify(c._state.api));
  check('a 500 degrades it as before',
        degraded.consecutiveFailures === 1 && /HTTP 500/.test(degraded.lastError),
        JSON.stringify(degraded));

  c._advance(HOUR);
  rec(c, 'api', false, 'rate limited', 429);
  const after = c._state.api;

  check('a later 429 leaves it degraded',
        after.consecutiveFailures === 1, JSON.stringify(after) +
        ' — otherwise a daily rate limit would paper over a real outage');
  check('…and the error still names the 500, not the 429',
        /HTTP 500/.test(after.lastError) && !/429/.test(after.lastError),
        JSON.stringify(after.lastError));
  check('…and lastFailure still points at the 500',
        after.lastFailure === degraded.lastFailure, JSON.stringify(after));
}

console.log('\nA success after a 429 still clears');
{
  const c = harness();
  rec(c, 'api', false, 'rate limited', 429);
  c._advance(HOUR);
  rec(c, 'api', false, 'boom', 503);
  c._advance(HOUR);
  rec(c, 'api', false, 'rate limited', 429);
  check('degraded by the 503, despite the 429s around it',
        c._state.api.consecutiveFailures === 1, JSON.stringify(c._state.api));

  c._advance(HOUR);
  rec(c, 'api', true, '', 200);
  const e = c._state.api;
  check('a success clears the failure count', e.consecutiveFailures === 0, JSON.stringify(e));
  check('…and the error', e.lastError === '', JSON.stringify(e));
  check('…and announces the recovery',
        c._alerts.some(a => a.status === 'Success' && /recovered/.test(a.summary)),
        JSON.stringify(c._alerts.map(a => a.summary)));

  // A recovery is a state transition, and the rate-limit notice is transition-based
  // like every other alert in this file. So a success drops the rate-limit cooldown
  // and the next 429 is announced afresh rather than swallowed by an hour-old stamp.
  const c2 = harness();
  rec(c2, 'api', false, 'limited', 429);
  c2._advance(60000);
  rec(c2, 'api', true, '', 200);
  c2._advance(60000);
  rec(c2, 'api', false, 'limited', 429);
  check('a recovery resets the rate-limit cooldown, so the next 429 is a fresh transition',
        c2._alerts.filter(a => /rate limited/.test(a.summary)).length === 2,
        JSON.stringify(c2._alerts.map(a => a.status + ': ' + a.summary)));
}

console.log('\nEvery other status behaves exactly as before');
{
  [[500, 'server error'], [404, 'not found'], [0, 'network exception'], [403, 'forbidden']]
    .forEach(([code, detail]) => {
      const c = harness();
      rec(c, 'api', false, detail, code);
      const e = c._state.api;
      check('  HTTP ' + code + ' still degrades',
            e.consecutiveFailures === 1 && e.lastFailure === c._now(),
            JSON.stringify(e));
    });

  // 429 as a STRING, which is what a hand-rolled call site could pass.
  const c = harness();
  vm.runInContext("recordApiHealth_('api', false, 'limited', '429')", c);
  check('a string "429" is treated as a rate limit too',
        c._state.api.consecutiveFailures === 0, JSON.stringify(c._state.api) +
        ' — Number(httpCode) rather than ===, because call sites pass what they have');
}

console.log('\nThe rate-limit notice has its own cooldown');
{
  const c = harness();
  rec(c, 'api', false, 'limited', 429);
  check('the first 429 announces', c._alerts.length === 1 && c._alerts[0].status === 'Warning',
        JSON.stringify(c._alerts));
  check('…worded as rate limited, not unavailable',
        /rate limited/.test(c._alerts[0].summary) && !/unavailable/.test(c._alerts[0].summary),
        JSON.stringify(c._alerts[0].summary));
  check('…and says it is not counted as degraded',
        /not counted as degraded/.test(c._alerts[0].summary), c._alerts[0].summary);

  c._advance(60000);
  rec(c, 'api', false, 'limited', 429);
  check('a second one inside the cooldown is silent', c._alerts.length === 1,
        JSON.stringify(c._alerts.map(a => a.summary)) +
        ' — several calls a night would otherwise be several Slack lines');

  // The cooldown must be its OWN, or a daily rate limit silences genuine outages.
  const c2 = harness();
  rec(c2, 'api', false, 'limited', 429);
  check('the 429 used its own cooldown field',
        c2._state.api.lastRateLimitAlertedAt > 0 && !c2._state.api.lastAlertedAt,
        JSON.stringify(c2._state.api));
  c2._advance(60000);
  rec(c2, 'api', false, 'real outage', 500);
  check('…so a genuine failure right after still alerts',
        c2._alerts.length === 2 && c2._alerts[1].status === 'Failed',
        JSON.stringify(c2._alerts.map(a => a.status + ': ' + a.summary)) +
        ' — sharing lastAlertedAt would have suppressed this');

  // And the other direction: a genuine failure must carry the rate-limit fields
  // forward, or every real failure would re-open the 429 floodgate.
  const c3 = harness();
  rec(c3, 'api', false, 'limited', 429);
  c3._advance(60000);
  rec(c3, 'api', false, 'real outage', 500);
  const afterFailure = JSON.parse(JSON.stringify(c3._state.api));
  c3._advance(60000);
  rec(c3, 'api', false, 'limited', 429);
  check('a genuine failure in between does not reset the rate-limit cooldown',
        c3._alerts.filter(a => /rate limited/.test(a.summary)).length === 1,
        JSON.stringify(c3._alerts.map(a => a.status + ': ' + a.summary)));
  check('…and the failure keeps the rate-limit timestamp the prune needs',
        afterFailure.lastRateLimited > 0 && afterFailure.rateLimitHits === 1,
        JSON.stringify(afterFailure));
}

console.log('\nA source that only ever 429s is not orphaned');
{
  const ctx = {
    String, Number, Object, Array, Math, JSON, console,
    Logger: { log: () => {} },
    _state: null,
  };
  const now = Date.UTC(2026, 9, 8);
  const state = {
    // Succeeded three weeks ago, rate limited since. Both lastSuccess and lastFailure
    // are frozen by design, so only lastRateLimited keeps it alive.
    'open-meteo': { lastSuccess: now - 21 * 24 * HOUR, lastFailure: 0,
                    lastRateLimited: now - HOUR, consecutiveFailures: 0 },
    'long-dead':  { lastSuccess: now - 30 * 24 * HOUR, lastFailure: now - 30 * 24 * HOUR },
  };
  ctx.getApiHealthState_ = () => state;
  ctx.setApiHealthState_ = s => { ctx._state = s; };
  vm.createContext(ctx);
  vm.runInContext(/^var API_HEALTH_ORPHAN_MS_\s*=.*?;/m.exec(API)[0] + '\n' +
                  extractFn(API, 'pruneApiHealthState_'), ctx);
  const removed = vm.runInContext('pruneApiHealthState_(' + now + ')', ctx);

  check('the rate-limited source survives the prune',
        removed.indexOf('open-meteo') === -1, JSON.stringify(removed) +
        ' — it would otherwise be dropped and recreated for ever');
  check('…while a genuinely dead one is still pruned',
        removed.indexOf('long-dead') !== -1, JSON.stringify(removed));
}

// ============================================================================
console.log('\nThe UV chip is gone, and nothing else with it');
{
  check('fetchUVIndex_ is removed', !/function fetchUVIndex_/.test(WEATHER));
  check('…and nothing still calls it',
        !/fetchUVIndex_\s*\(/.test(WEATHER), 'a dangling call would throw at render time');
  check('buildTickerHtml_ no longer takes uvi',
        /function buildTickerHtml_\(slot9am, slot6pm, rainPct, aqi, awayLabel9am, awayLabel6pm\)/.test(WEATHER),
        'leaving the parameter would silently shift awayLabel9am into it');
  check('…and the call matches the signature',
        /buildTickerHtml_\(slot9am, slot6pm, rainPct, aqi, awayLabel9am, awayLabel6pm\)/.test(WEATHER));
  check('no UV markup survives', !/UV&nbsp;/.test(WEATHER), 'a dead branch rendering a dash');

  // `/fetchAQI_/` would match `fetchAQI_DISABLED_` too, so this asks for the definition
  // AND a live call — the same substring trap that has bitten these checks before.
  check('the rest of the ticker is untouched',
        /AQI&nbsp;/.test(WEATHER) &&
        /function fetchAQI_\(/.test(WEATHER) && /=\s*fetchAQI_\(/.test(WEATHER),
        'temperature, rain and AQI are the point of the ticker');
}

console.log('\nopen-meteo is still load-bearing elsewhere — and still watched');
{
  // THE GUARD ON MY OWN MISTAKE. I reported open-meteo as used in one place, dropped
  // the UV chip on that basis, and it is used in four. These three callers are trip
  // and packing weather; "remove the UV chip" must never quietly become "remove trip
  // weather", and the health recording has to stay so a REAL open-meteo fault is still
  // reported.
  const TRIP = fs.readFileSync(ROOT + '/TripDecisions.js', 'utf8');
  const WEB  = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');

  // Each assertion reads that function's OWN body. A file-wide regex would stay green
  // if the fetch moved to some other function in the same file — which is exactly the
  // kind of "still there somewhere" that let me report four call sites as one.
  const body = (src, name) => { try { return extractFn(src, name); } catch (e) { return ''; } };
  const trip   = body(TRIP, 'tripDailyForecast_');
  const pack   = body(WEB,  'getPackingWeather_');
  const geo    = body(WEB,  'geocodePackingDestination_');

  check('tripDailyForecast_ still fetches open-meteo',
        /fetchWithHealth_\('open-meteo'/.test(trip), 'TripDecisions.js: ' + trip.length + ' chars');
  check('getPackingWeather_ still does',
        /fetchWithHealth_\('open-meteo'/.test(pack), 'WebApp.js: ' + pack.length + ' chars');
  check('geocodePackingDestination_ still does',
        /fetchTracked_\('open-meteo'/.test(geo), 'WebApp.js: ' + geo.length + ' chars');
  check('…and it is still cached for 6h',
        /CacheService\.getScriptCache\(\)\.get\(/.test(geo) &&
        /CacheService\.getScriptCache\(\)\.put\([\s\S]{0,80}?,\s*21600\)/.test(geo),
        'coordinates do not change; this is the one caller already keeping its volume down');

  check('the briefings still call it',
        /getPackingWeather_\(/.test(fs.readFileSync(ROOT + '/PreTripBriefing.js', 'utf8')),
        'PreTripBriefing.js is what puts trip weather in front of you');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
