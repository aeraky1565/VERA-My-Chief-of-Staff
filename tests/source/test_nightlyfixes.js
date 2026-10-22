// What the Oct 20 nightly kill exposed, each fixed and held here:
//   · credentials in logs — a failed aviationstack call wrote its full URL, access_key
//     included, into the System Log's Error column and Slack
//   · the first half's slowest steps went into veraLog_'s DURATION slot, so the log
//     could not say how long anything had taken
//   · writeSummarySnapshot (external sheets) moved out of the first half
//   · the flight poll's gap is now a Config setting, so it can't burn the free quota
// The real functions run in a vm. Invented keys only — never a real one.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const LOG = read('VERALog.js'), CODE = read('Code.js'), FLIGHT = read('FlightStatus.js'),
      API = read('ApiHealth.js'), SLACK = read('Slack.js'), APP = read('docs/app.js'), INDEX = read('docs/index.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error('unterminated: ' + name);
}

// ============ redaction ======================================================
console.log('redactSecrets_: credentials never reach a log');
const R = {};
vm.createContext(R);
vm.runInContext(extractFn(LOG, 'redactSecrets_'), R);
const red = s => { R.s = s; return vm.runInContext('redactSecrets_(s)', R); };
{
  // Shaped exactly like the real System Log Error cell, with an invented key.
  const real = 'fetch error for UA590: Address unavailable: http://api.aviationstack.com/v1/flights?access_key=0123456789abcdef0123456789abcdef&flight_iata=UA590';
  const out = red(real);
  check('the aviationstack error loses its key, and keeps everything else',
        out === 'fetch error for UA590: Address unavailable: http://api.aviationstack.com/v1/flights?access_key=[redacted]&flight_iata=UA590', out);
  check('an OpenWeather appid is masked', red('https://api.openweathermap.org/data/2.5/weather?q=Chicago&appid=abc123def456') === 'https://api.openweathermap.org/data/2.5/weather?q=Chicago&appid=[redacted]');
  check('a Maps key= is masked', red('https://maps.googleapis.com/maps/api/staticmap?size=600x300&key=AIzaSyFAKEFAKEFAKE') === 'https://maps.googleapis.com/maps/api/staticmap?size=600x300&key=[redacted]');
  check('token= and api_key= too', red('?token=t0k&api_key=k3y&q=1') === '?token=[redacted]&api_key=[redacted]&q=1');
  check('a Bearer token is masked', red('Authorization: Bearer sk-abcdefghij123456') === 'Authorization: Bearer [redacted]');
  check('words that merely contain "key" are left alone', red('?monkey=1&keyword=2&q=key') === '?monkey=1&keyword=2&q=key');
  check('text with no secret is unchanged', red('checked=0 skipped=0 errors=1') === 'checked=0 skipped=0 errors=1');
  check('non-strings go back untouched', red(42) === 42 && red(null) === null && red('') === '');
}

console.log('\n…applied where things are written');
{
  // veraLog_ → Slack text AND the buffered System Log row.
  const slack = [], rows = [];
  const S = { sendSlackLog_: t => slack.push(t), Logger: { log() {} } };
  vm.createContext(S);
  vm.runInContext(extractFn(LOG, 'redactSecrets_') + extractFn(LOG, 'veraLog_'), S);
  S.bufferSystemLogRow_ = (...a) => rows.push(a);
  vm.runInContext("veraLog_('apiHealth:aviationstack', 'System', 'Failed', 'see ?access_key=SECRET1', 0, 'GET https://x.test/v1?access_key=SECRET2&q=1')", S);
  check('veraLog_: Slack never sees the key', slack.length === 1 && !/SECRET/.test(slack[0]), slack[0]);
  check('veraLog_: the System Log row never sees it', rows.length === 1 && !/SECRET/.test(JSON.stringify(rows[0])), JSON.stringify(rows[0]));

  // bufferSystemLogRow_ on its own — other callers reach the sheet through it.
  const B = { _systemLogBuffer_: [], SYSTEM_LOG_AUTOFLUSH_ROWS_: 99, flushSystemLog_() {}, Date };
  vm.createContext(B);
  vm.runInContext(extractFn(LOG, 'redactSecrets_') + extractFn(LOG, 'bufferSystemLogRow_'), B);
  vm.runInContext("bufferSystemLogRow_('r', 'c', 'Failed', 'x?key=SECRET3', 0, 'y?appid=SECRET4')", B);
  check('bufferSystemLogRow_ masks the summary and the error', !/SECRET/.test(JSON.stringify(B._systemLogBuffer_)));

  check('recordApiHealth_ masks the detail before keeping it', /function recordApiHealth_\(source, ok, detail, httpCode\) \{[\s\S]{0,300}detail = redactSecrets_\(detail\);/.test(API));
  check('sendSlackLog_ masks what it posts', /sendSlackMessage_\(channelId, redactSecrets_\(text\)\)/.test(SLACK));
}

console.log('\nscrubLoggedSecrets_: what was logged before, once');
{
  const sysRows = [
    ['10/21/2026', 'apiHealth:aviationstack', 'System', 'Failed', 'aviationstack unavailable', '', 'fetch error: http://a.test/v1?access_key=OLDSECRET&flight_iata=UA590'],
    ['10/21/2026', 'checkFlightStatuses', 'Travel', 'Partial', 'checked=0 skipped=0 errors=1', '8', ''],
  ];
  let written = null, props = {};
  const state = { aviationstack: { lastError: 'GET ?access_key=OLDSECRET2', consecutiveFailures: 3 }, weather: { lastError: '' } };
  let savedState = null;
  const S = {
    TABS: { SYSTEM_LOG: 'System Log' }, SYSTEM_LOG_HEADERS: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], Logger: { log() {} }, Date, JSON, Object,
    getSpreadsheet: () => ({ getSheetByName: () => ({
      getLastRow: () => sysRows.length + 1,
      getRange: () => ({ getValues: () => sysRows.map(r => r.slice()), setValues: v => { written = v; } }),
    }) }),
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    getApiHealthState_: () => JSON.parse(JSON.stringify(state)),
    setApiHealthState_: s => { savedState = s; },
  };
  vm.createContext(S);
  vm.runInContext("var SECRETS_SCRUBBED_PROPERTY_ = 'LOG_SECRETS_SCRUBBED';" + extractFn(LOG, 'redactSecrets_') + extractFn(LOG, 'scrubLoggedSecrets_'), S);
  const n = vm.runInContext('scrubLoggedSecrets_()', S);
  check('rewrites the leaked System Log cell', written && !/OLDSECRET/.test(JSON.stringify(written)) && /access_key=\[redacted\]&flight_iata=UA590/.test(written[0][6]), JSON.stringify(written && written[0]));
  check('…and leaves the other rows as they were', written && JSON.stringify(written[1]) === JSON.stringify(sysRows[1]));
  check('rewrites the API-health error it keeps', savedState && !/OLDSECRET/.test(JSON.stringify(savedState)) && savedState.aviationstack.consecutiveFailures === 3);
  check('counts what it changed', n === 2, n);
  written = null;
  check('runs once: a second call does nothing', vm.runInContext('scrubLoggedSecrets_()', S) === -1 && written === null);
  check('it runs in the nightly tail', /nightlyStep_\(ctx, 'scrubLoggedSecrets_', scrubLoggedSecrets_\);/.test(CODE));
}

// ============ the nightly run ================================================
console.log('\nthe nightly run');
{
  const head = CODE.slice(CODE.indexOf('function nightlyRun() {'), CODE.indexOf('function nightlyRunTail() {'));
  const tail = CODE.slice(CODE.indexOf('function nightlyRunTail() {'));
  check('writeSummarySnapshot is no longer a first-half step', !/nightlyStep_\(ctx, 'writeSummarySnapshot'/.test(head));
  check('…it is the second half’s, after runExplorer_', /nightlyStep_\(ctx, 'runExplorer_', runExplorer_\);[\s\S]{0,600}nightlyStep_\(ctx, 'writeSummarySnapshot', writeSummarySnapshot\);/.test(tail));
  check('…and the first half still reads Summaries in collect (it always read the previous night’s)', /var collected = nightlyStep_\(ctx, 'collect'[\s\S]{0,400}summaries = getSummaries\(\);/.test(head));

  // The first half's System Log entry: run the REAL call with captured arguments.
  const at = head.indexOf("veraLog_('nightlyRun', 'Nightly',");
  const call = head.slice(at, head.indexOf(');', head.indexOf("stepFailures.length ? stepFailures.join('; ') : ''", at)) + 2);
  const S = {};
  vm.createContext(S);
  S.got = null;
  vm.runInContext('function veraLog_() { got = Array.prototype.slice.call(arguments); }' +
    'var stepFailures = [], stepSkipped = ["a"], flagCount = 2, highCount = 1, medCount = 1, lowCount = 0, deduped = 0, elapsed = 300;' +
    'var slowest = ["writePTOSnapshot_ 120.0s", "collect 40.0s"];' + call, S);
  check('the slowest steps are in the SUMMARY of the System Log row', S.got && /slowest: writePTOSnapshot_ 120\.0s, collect 40\.0s/.test(S.got[3]), JSON.stringify(S.got));
  check('…with the time-budget skips', /1 skipped \(time budget\)/.test(S.got[3]));
  check('…and the duration slot is the duration', S.got[4] === 300000, String(S.got[4]));
}

// ============ the flight poll ================================================
console.log('\nthe flight poll interval');
{
  const F = {};
  vm.createContext(F);
  vm.runInContext('var FLIGHT_POLL_MIN_MINUTES_ = 15;' + extractFn(FLIGHT, 'flightPollIntervalMin_') + extractFn(FLIGHT, 'flightPollDue_'), F);
  const gap = v => { F.cfg = { flight_status_poll_minutes: v }; return vm.runInContext('flightPollIntervalMin_(cfg)', F); };
  check('the setting is read: 60', gap('60') === 60);
  check('unset → 15, the trigger’s own cadence', gap(undefined) === 15 && gap('') === 15);
  check('below 15, or junk, reads as 15', gap('5') === 15 && gap('abc') === 15 && gap('-30') === 15);
  const due = (minsAgo, g) => { F.now = 10e12; F.last = minsAgo === null ? 0 : F.now - minsAgo * 60000; F.g = g; return vm.runInContext('flightPollDue_(now, last, g)', F); };
  check('never polled → due', due(null, 60) === true);
  check('gap 60: due at 60 min, not at 45', due(60, 60) && !due(45, 60));
  check('gap 15: every trigger run is due, despite seconds of drift', due(14.5, 15) && due(15, 15));

  const fn = extractFn(FLIGHT, 'checkFlightStatuses_');
  check('the poll checks the gap before touching the sheet or the API',
        /if \(!forceRefresh\) \{[\s\S]{0,400}flightPollDue_\(Date\.now\(\), _last, _gapMin\)[\s\S]*?var ss    = getSpreadsheet\(\);/.test(fn));
  check('…a dashboard refresh (forceRefresh) always polls', /if \(!forceRefresh\) \{\s+var _gapMin/.test(fn));
  check('…a skipped run still checks for stale statuses, and the heartbeat is in finally',
        /return \{ polled: 0, skipped: 0, errors: 0, gated: true \};/.test(fn) && /checkStaleFlightStatus_\(\);\s+return \{ polled: 0, skipped: 0, errors: 0, gated: true \}/.test(fn) &&
        /finally \{[\s\S]{0,400}recordHeartbeat_\('checkFlightStatuses_'\)/.test(fn));
  check('the settings modal lists it, in both built files', [APP, INDEX].every(t => /\{label:'Travel',keys:\['weather_location','home_country','flight_status_poll_minutes',/.test(t)));
  check('the Config row is seeded once by the nightly run', /nightlyStep_\(ctx, 'seedFlightPollConfig_', seedFlightPollConfig_\);/.test(CODE));

  // The seed: once, and never over a row that's there.
  const rows = [['other', 'x']], props = {};
  const S = {
    TABS: { CONFIG: 'CONFIG' }, Date, _configCache_: {},
    getSpreadsheet: () => ({ getSheetByName: () => ({ getLastRow: () => rows.length + 1,
      getRange: (r, c, n) => ({ getValues: () => rows.slice(0, n).map(x => [x[0]]) }), appendRow: r => rows.push(r) }) }),
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  };
  vm.createContext(S);
  vm.runInContext("var FLIGHT_POLL_MIN_MINUTES_ = 15, FLIGHT_POLL_SEEDED_PROP_ = 'FLIGHT_POLL_CONFIG_SEEDED';" + extractFn(FLIGHT, 'seedFlightPollConfig_'), S);
  vm.runInContext('seedFlightPollConfig_(); seedFlightPollConfig_();', S);
  check('seeded once, at 15', rows.filter(r => r[0] === 'flight_status_poll_minutes').length === 1 && rows[1][1] === '15');
  const rows2 = [['flight_status_poll_minutes', '90']];
  S.getSpreadsheet = () => ({ getSheetByName: () => ({ getLastRow: () => rows2.length + 1,
      getRange: (r, c, n) => ({ getValues: () => rows2.slice(0, n).map(x => [x[0]]) }), appendRow: r => rows2.push(r) }) });
  for (const k of Object.keys(props)) delete props[k];
  vm.runInContext('seedFlightPollConfig_();', S);
  check('…and a value you set is never overwritten', rows2.length === 1 && rows2[0][1] === '90');
}

// ============ aviationstack errors, named ======================================
console.log('\naviationstack errors say what they were');
{
  const C = {};
  vm.createContext(C);
  vm.runInContext(extractFn(FLIGHT, 'classifyAviationStackError_'), C);
  const cls = (code, body) => { C.c = code; C.b = body; return vm.runInContext('classifyAviationStackError_(c, b)', C); };
  const quotaBody = JSON.stringify({ error: { code: 'usage_limit_reached', message: 'Your monthly usage limit has been reached.' } });
  check('usage_limit_reached → quota', cls(429, quotaBody).kind === 'quota');
  check('…even on HTTP 200 (it used to read as "no live data yet", a success)', cls(200, quotaBody).kind === 'quota');
  check('rate_limit_reached → rate', cls(429, JSON.stringify({ error: { code: 'rate_limit_reached' } })).kind === 'rate');
  check('a bare 429 → rate', cls(429, '{}').kind === 'rate');
  check('invalid_access_key → key, naming the Script Property', cls(401, JSON.stringify({ error: { code: 'invalid_access_key' } })).kind === 'key' &&
        /AVIATIONSTACK_KEY/.test(cls(401, JSON.stringify({ error: { code: 'invalid_access_key' } })).text));
  check('function_access_restricted → restricted', cls(403, JSON.stringify({ error: { code: 'function_access_restricted' } })).kind === 'restricted');
  check('anything else carries the service’s own message', cls(500, JSON.stringify({ error: { message: 'Internal error' } })).text === 'HTTP 500: Internal error');
  check('a good 200 is not an error', cls(200, JSON.stringify({ data: [] })) === null);

  // The real fetchFlightStatus_, against stubbed responses.
  const fn = extractFn(FLIGHT, 'fetchFlightStatus_');
  function fetchWith(code, body, throwOn) {
    const recorded = [], backoffs = [];
    const ctx = { String, Number, Object, Array, Math, JSON, Date, Error, encodeURIComponent, Logger: { log() {} },
      getAviationStackKey_: () => 'KEY', setAviationStackBackoff_: b => { backoffs.push(b); return Date.parse('2026-11-21T12:00:00Z'); },
      recordApiHealth_: (source, ok, detail, httpCode) => recorded.push({ ok, detail, httpCode }),
      UrlFetchApp: { fetch: () => { if (throwOn) throw new Error(throwOn); return { getResponseCode: () => code, getContentText: () => body }; } },
      Utilities: { formatDate: (d, tz, f) => f === 'MMM d' ? 'Nov 21' : '2:00 PM' }, Session: { getScriptTimeZone: () => 'America/New_York' } };
    vm.createContext(ctx);
    vm.runInContext(extractFn(FLIGHT, 'classifyAviationStackError_') + '\n' + fn, ctx);
    const out = ctx.fetchFlightStatus_('UA590', '2026-10-21');
    return { out, r: recorded[0] || {}, backoffs };
  }
  const q = fetchWith(429, quotaBody);
  check('quota: says so, and when checks resume', q.r.ok === false && /^monthly quota used up — this plan’s requests for the month are spent — flight checks paused until Nov 21\./.test(q.r.detail), q.r.detail);
  check('…and what to do about it', /Raise flight_status_poll_minutes, or upgrade the aviationstack plan\./.test(q.r.detail));
  check('…recorded as a real outage, not the passing-429 warning', q.r.httpCode === 0 && q.backoffs.length === 1);
  const q200 = fetchWith(200, quotaBody);
  check('quota on a 200 is a failure too, never a success', q200.r.ok === false && /monthly quota/.test(q200.r.detail) && q200.out === null);
  const rl = fetchWith(429, JSON.stringify({ error: { code: 'rate_limit_reached' } }));
  check('rate limit: named, with when it resumes, as the passing 429 warning', rl.r.ok === false && rl.r.httpCode === 429 &&
        rl.r.detail === 'too many requests in a short time — flight checks paused until 2:00 PM', rl.r.detail);
  const key = fetchWith(401, JSON.stringify({ error: { code: 'invalid_access_key' } }));
  check('a rejected key says to check the key', /the API key was rejected \(invalid_access_key\)/.test(key.r.detail) && key.r.httpCode === 401);
  const net = fetchWith(0, '', 'Address unavailable: http://api.aviationstack.com/v1/flights?access_key=X');
  check('a network failure is called one', /^couldn’t reach aviationstack for UA590 \(network\): Address unavailable/.test(net.r.detail), net.r.detail);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
