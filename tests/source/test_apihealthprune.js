// The "SOME DATA IS NOT LIVE" banner was crying wolf, twice.
//
//   ⚠ SOME DATA IS NOT LIVE
//     • aviationstack (last good data: 10d)
//     • googlefit-steps (last good data: no successful call on record)
//
// NEITHER was a fault.
//
// aviationstack: fetchFlightStatus_ recorded a health FAILURE on an HTTP 200 with
// an empty data array. The file's own comment, four lines above the call, says the
// free tier only carries current/upcoming flights — so a flight booked weeks out
// legitimately returns nothing and the API answered perfectly to say so.
//
// googlefit-steps: NOTHING in the codebase records that source. Only
// googlefit-sleep exists (Wellness.js). It is residue in the API_HEALTH_STATE
// property from code that was deleted, and consecutiveFailures could never reset,
// because clearing it requires a successful call and nothing was ever going to make
// one. It would have nagged every morning forever.
//
// A banner whose job is to say "do not trust this data" loses its authority the
// moment it reports things that are fine.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = {
  Health: fs.readFileSync(ROOT + '/ApiHealth.js', 'utf8'),
  Flight: fs.readFileSync(ROOT + '/FlightStatus.js', 'utf8'),
  Code:   fs.readFileSync(ROOT + '/Code.js', 'utf8'),
};

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

const DAY = 24 * 60 * 60 * 1000;
// Deliberately years from any clock this ever runs on. With a fixture date near
// today, dropping the injectable `nowMs` parameter would still pass — the real
// Date.now() would happen to give the same answers.
const NOW = Date.UTC(2031, 5, 17, 6, 0, 0);

function healthCtx(state) {
  const stored = { API_HEALTH_STATE: JSON.stringify(state || {}) };
  const ctx = {
    String, Number, Object, Array, Math, JSON, Date, Error, console,
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in stored ? stored[k] : null),
      setProperty: (k, v) => { stored[k] = v; },
      deleteProperty: k => { delete stored[k]; },
    }) },
    _stored: stored,
  };
  vm.createContext(ctx);
  vm.runInContext([
    /^var API_HEALTH_KEY_\s*=.*?;/m.exec(SRC.Health)[0],
    /^var API_HEALTH_ORPHAN_MS_\s*=.*?;/m.exec(SRC.Health)[0],
    'var _apiHealthCache_ = null;',
    extractFn(SRC.Health, 'getApiHealthState_'),
    extractFn(SRC.Health, 'setApiHealthState_'),
    extractFn(SRC.Health, 'pruneApiHealthState_'),
    extractFn(SRC.Health, 'getDegradedSources_'),
    extractFn(SRC.Health, 'formatAge_'),
  ].join('\n'), ctx);
  return ctx;
}

const entry = o => Object.assign(
  { lastSuccess: 0, lastFailure: 0, lastError: '', consecutiveFailures: 0, lastAlertedAt: 0 }, o);

// ============================================================================
console.log('The orphan prune');
{
  // The real shape of the problem: googlefit-steps never succeeded, and its last
  // failure is frozen at whenever the code that recorded it was deleted.
  const c = healthCtx({
    'googlefit-steps': entry({ lastFailure: NOW - 40 * DAY, consecutiveFailures: 9,
                               lastError: 'no steps data returned' }),
    'openweathermap':  entry({ lastSuccess: NOW - 2 * 3600000 }),
  });
  const removed = c.pruneApiHealthState_(NOW);

  check('the orphan is dropped', removed.indexOf('googlefit-steps') !== -1, JSON.stringify(removed));
  check('…and really leaves the state',
        JSON.parse(c._stored.API_HEALTH_STATE)['googlefit-steps'] === undefined);
  check('a healthy live source is untouched',
        JSON.parse(c._stored.API_HEALTH_STATE)['openweathermap'] !== undefined);
  check('…so the banner stops reporting it',
        c.getDegradedSources_().length === 0,
        'this is the whole point — the warning could never clear itself');
}

console.log('\nThe discriminator is RECENCY, not failure count');
{
  // THE assertion that makes the rule safe. A genuinely broken source still has
  // code calling it, so its lastFailure is refreshed every night.
  const c = healthCtx({
    'reallyBroken': entry({ lastSuccess: NOW - 200 * DAY, lastFailure: NOW - 2 * 3600000,
                            consecutiveFailures: 200 }),
  });
  const removed = c.pruneApiHealthState_(NOW);
  check('a source failing EVERY night is kept, however long it has been failing',
        removed.length === 0 && c.getDegradedSources_().length === 1,
        'pruning on how long it has been broken would silence the real outages');
}
{
  const c = healthCtx({
    'quietButFine': entry({ lastSuccess: NOW - 2 * DAY, lastFailure: NOW - 100 * DAY }),
  });
  check('a source that succeeded recently is kept, despite an ancient failure',
        c.pruneApiHealthState_(NOW).length === 0,
        'pruning on lastFailure alone would throw away a perfectly healthy source');
}
{
  const c = healthCtx({
    'deadCode': entry({ lastSuccess: NOW - 60 * DAY, lastFailure: NOW - 59 * DAY }),
  });
  check('a source nothing has touched at all ages out', c.pruneApiHealthState_(NOW).length === 1,
        'if nothing has tried it in a fortnight there is nothing to warn about today');
}

console.log('\nThe boundary, and the odd cases');
{
  const c = healthCtx({
    'justInside':  entry({ lastFailure: NOW - 13 * DAY, consecutiveFailures: 1 }),
    'justOutside': entry({ lastFailure: NOW - 15 * DAY, consecutiveFailures: 1 }),
  });
  const removed = c.pruneApiHealthState_(NOW);
  check('13 days is kept', removed.indexOf('justInside') === -1, JSON.stringify(removed));
  check('15 days is dropped', removed.indexOf('justOutside') !== -1, JSON.stringify(removed));

  const exact = healthCtx({ 'bangOn': entry({ lastFailure: NOW - 14 * DAY, consecutiveFailures: 1 }) });
  check('exactly 14 days is KEPT, not dropped', exact.pruneApiHealthState_(NOW).length === 0,
        'the window is inclusive; an off-by-one here silently shortens it by a day');

  const empty = healthCtx({});
  check('an empty state is a no-op', empty.pruneApiHealthState_(NOW).length === 0);

  const malformed = healthCtx({ 'noTimestamps': entry({ consecutiveFailures: 3 }) });
  check('an entry with no timestamps at all is dropped',
        malformed.pruneApiHealthState_(NOW).length === 1,
        'it can never age out on its own, so it would nag forever too');

  // Counting the WRITES, not comparing the value: re-serialising an unchanged state
  // produces an identical string, so equality would pass however often it was written.
  const c2 = healthCtx({ 'fine': entry({ lastSuccess: NOW - 1000 }) });
  let writes = 0;
  const realProps = c2.PropertiesService.getScriptProperties();
  c2.PropertiesService = { getScriptProperties: () => ({
    getProperty: k => realProps.getProperty(k),
    setProperty: (k, v) => { writes++; realProps.setProperty(k, v); },
  }) };
  c2.pruneApiHealthState_(NOW);
  check('nothing is written when nothing is dropped', writes === 0,
        'a nightly step that rewrites a Script Property for no reason is a wasted round trip');

  const c3 = healthCtx({ 'gone': entry({ lastFailure: NOW - 90 * DAY }) });
  let writes3 = 0;
  const realProps3 = c3.PropertiesService.getScriptProperties();
  c3.PropertiesService = { getScriptProperties: () => ({
    getProperty: k => realProps3.getProperty(k),
    setProperty: (k, v) => { writes3++; realProps3.setProperty(k, v); },
  }) };
  c3.pruneApiHealthState_(NOW);
  check('…and exactly once when something is', writes3 === 1, String(writes3));
}

// ============================================================================
console.log('\naviationstack: an empty 200 is not an outage');
{
  const fn = extractFn(SRC.Flight, 'fetchFlightStatus_');

  // Drive the REAL function against a stubbed UrlFetchApp.
  function fetchWith(code, body, opts) {
    const o = opts || {};
    const recorded = [];
    const ctx = {
      String, Number, Object, Array, Math, JSON, Date, Error, console, encodeURIComponent,
      Logger: { log: () => {} },
      getAviationStackKey_: () => (o.noKey ? '' : 'KEY'),
      setAviationStackBackoff_: () => {},
      recordApiHealth_: (source, ok, detail, httpCode) =>
        recorded.push({ source, ok, detail, httpCode }),
      UrlFetchApp: { fetch: () => {
        if (o.throwOn) throw new Error(o.throwOn);
        return { getResponseCode: () => code, getContentText: () => body };
      } },
      Utilities: { formatDate: () => '' },
      _recorded: recorded,
    };
    vm.createContext(ctx);
    vm.runInContext(fn, ctx);
    let out = null;
    try { out = ctx.fetchFlightStatus_('AA102', '2026-12-20'); } catch (e) { out = 'THREW'; }
    return { out, recorded };
  }

  const emptyOk = fetchWith(200, JSON.stringify({ data: [] }));
  check('an empty result is recorded as a SUCCESS', emptyOk.recorded.length === 1 &&
        emptyOk.recorded[0].ok === true, JSON.stringify(emptyOk.recorded));
  check('…against aviationstack', emptyOk.recorded[0].source === 'aviationstack');
  check('…at HTTP 200', emptyOk.recorded[0].httpCode === 200);
  check('…and the caller still gets null', emptyOk.out === null,
        'the FLIGHT has no live status — that is a fact about the flight, not the API');

  const missingData = fetchWith(200, JSON.stringify({}));
  check('a body with no data key behaves the same', missingData.recorded[0].ok === true);

  // Every genuine failure path must still record a failure.
  const rate = fetchWith(429, '{}');
  check('a 429 is still a failure', rate.recorded[0].ok === false && rate.out === null,
        JSON.stringify(rate.recorded));
  check('…named as rate limiting', /rate limited|quota/.test(rate.recorded[0].detail));

  const http500 = fetchWith(500, '{}');
  check('a 500 is still a failure', http500.recorded[0].ok === false && http500.out === null);

  // first() rather than recorded[0]: a control that deletes the record call leaves
  // the array empty, and reading .ok off undefined would crash instead of failing.
  const first = r => (r.recorded.length ? r.recorded[0] : { ok: null, detail: '(nothing recorded)' });

  const noKey = fetchWith(200, '{}', { noKey: true });
  check('a missing key is still a failure', first(noKey).ok === false &&
        /not set/.test(first(noKey).detail), JSON.stringify(noKey.recorded));

  const boom = fetchWith(200, '{}', { throwOn: 'DNS failure' });
  check('a fetch error is still a failure', first(boom).ok === false &&
        /DNS failure/.test(first(boom).detail), JSON.stringify(boom.recorded));

  const good = fetchWith(200, JSON.stringify({ data: [{ flight_status: 'scheduled',
    departure: { scheduled: '2026-12-20T10:00:00+00:00' }, arrival: {} }] }));
  check('a real result is a success and returns an object',
        good.recorded[0].ok === true && good.out && typeof good.out === 'object',
        JSON.stringify(good.recorded));

  check('the empty branch no longer calls it a failure',
        !/recordApiHealth_\('aviationstack', false, 'no data returned/.test(fn),
        'this exact line is what put aviationstack in the banner for 10 days');
}

console.log('\nRecovery: the banner actually clears');
{
  // End to end through the real recorder: a source stuck degraded from the old
  // behaviour must heal on the next empty-200.
  const stored = { API_HEALTH_STATE: JSON.stringify({
    aviationstack: entry({ lastSuccess: NOW - 10 * DAY, lastFailure: NOW - 3600000,
                           consecutiveFailures: 14, lastError: 'no data returned for AA102' }),
  }) };
  const ctx = {
    String, Number, Object, Array, Math, JSON, Date, Error, console,
    Logger: { log: () => {} },
    sendSlackLog_: () => {},
    veraLog_: () => {},
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in stored ? stored[k] : null),
      setProperty: (k, v) => { stored[k] = v; },
    }) },
  };
  vm.createContext(ctx);
  vm.runInContext([
    /^var API_HEALTH_KEY_\s*=.*?;/m.exec(SRC.Health)[0],
    /^var API_ALERT_COOLDOWN_MS_\s*=.*?;/m.exec(SRC.Health)[0],
    /^var API_HEALTH_NO_SLACK_\s*=.*?;/m.exec(SRC.Health)[0],
    'var _apiHealthCache_ = null;',
    extractFn(SRC.Health, 'getApiHealthState_'),
    extractFn(SRC.Health, 'setApiHealthState_'),
    extractFn(SRC.Health, 'recordApiHealth_'),
    extractFn(SRC.Health, 'getDegradedSources_'),
    extractFn(SRC.Health, 'formatAge_'),
  ].join('\n'), ctx);

  check('it starts degraded, as it is today', ctx.getDegradedSources_().length === 1);
  ctx.recordApiHealth_('aviationstack', true, '', 200);
  check('one empty-200 clears it', ctx.getDegradedSources_().length === 0,
        'the fix has to heal the stuck state, not just stop adding to it');
}

console.log('\nWiring and documentation');
{
  const nightly = SRC.Code.slice(SRC.Code.indexOf('function nightlyRun()'),
                                 SRC.Code.indexOf('function nightlyRun()') + 40000);
  check('the prune runs nightly', /nightlyStep_\(ctx, 'pruneApiHealthState_'/.test(nightly),
        'a manual clearApiHealthSource_ existed already and nobody ever called it');

  // One declaration across the shared global scope.
  const roots = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const n = roots.reduce((acc, f) => acc +
    (fs.readFileSync(path.join(ROOT, f), 'utf8')
       .match(/^function pruneApiHealthState_\(/gm) || []).length, 0);
  check('pruneApiHealthState_ is declared exactly once', n === 1, String(n));

  const readme = fs.readFileSync(ROOT + '/README.md', 'utf8');
  check('the README explains the orphan rule', /orphan|no longer records/i.test(readme) &&
        /API health|api_health|API Health/i.test(readme));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
