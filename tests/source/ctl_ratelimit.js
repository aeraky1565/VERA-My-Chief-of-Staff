// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The first restores the bug verbatim — a 429 counted as a failure, which is what put
// open-meteo in "SOME DATA IS NOT LIVE" every morning. The rest cover the two ways this
// particular change can go wrong in opposite directions: a 429 that still leaks into
// the banner, and a 429 that is let through so permissively that it erases, outranks or
// silences a genuine fault. The last group guards the mistake I actually made — reading
// one open-meteo call site and reporting it as all of them.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_rl');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

// Several fields are spelled identically in the success, 429 and failure branches
// (`lastFailure:         prev.lastFailure,` is in two of them). A whole-file replace
// would silently patch the wrong branch and the control would prove nothing, so
// mutations that target the 429 branch are scoped to it.
const BLOCK_START = '} else if (Number(httpCode) === 429) {';
function in429(src, from, to) {
  const a = src.indexOf(BLOCK_START);
  if (a === -1) throw new Error('429 branch not found');
  const b = src.indexOf('\n    } else {', a);
  if (b === -1) throw new Error('429 branch has no end');
  const block = src.slice(a, b);
  if (block.indexOf(from) === -1) throw new Error('not in the 429 branch: ' + from);
  return src.slice(0, a) + block.split(from).join(to) + src.slice(b);
}

const CONTROLS = {
  // ---- the bug itself ------------------------------------------------------
  'a 429 is counted as a failure again (the reported bug)': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(BLOCK_START,
      '} else if (Number(httpCode) === 429 && false) {'),
  }),
  'the 429 branch bumps consecutiveFailures': b => ({
    'ApiHealth.js': in429(b['ApiHealth.js'],
      'consecutiveFailures: prev.consecutiveFailures,',
      'consecutiveFailures: prev.consecutiveFailures + 1,'),
  }),
  'getDegradedSources_ stops filtering on consecutiveFailures': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      'if (!e || !e.consecutiveFailures) return;',
      'if (!e) return;'),
  }),

  // ---- a 429 that erases or outranks a real fault --------------------------
  'the 429 overwrites lastError': b => ({
    'ApiHealth.js': in429(b['ApiHealth.js'],
      'lastError:           prev.lastError,',
      "lastError:           'HTTP 429 — ' + (detail || ''),"),
  }),
  'the 429 stamps lastFailure': b => ({
    'ApiHealth.js': in429(b['ApiHealth.js'],
      'lastFailure:         prev.lastFailure,',
      'lastFailure:         now,'),
  }),
  'the 429 clears the failure count, papering over an outage': b => ({
    'ApiHealth.js': in429(b['ApiHealth.js'],
      'consecutiveFailures: prev.consecutiveFailures,',
      'consecutiveFailures: 0,'),
  }),
  'the 429 drops lastSuccess, so the age is lost': b => ({
    'ApiHealth.js': in429(b['ApiHealth.js'],
      'lastSuccess:         prev.lastSuccess,',
      'lastSuccess:         0,'),
  }),

  // ---- a 429 that is not recorded at all -----------------------------------
  'the rate limit is not timestamped': b => ({
    'ApiHealth.js': in429(b['ApiHealth.js'],
      'lastRateLimited:     now,',
      'lastRateLimited:     prev.lastRateLimited || 0,'),
  }),
  'the hit counter does not count': b => ({
    'ApiHealth.js': in429(b['ApiHealth.js'],
      'rateLimitHits:       (prev.rateLimitHits || 0) + 1,',
      'rateLimitHits:       prev.rateLimitHits || 0,'),
  }),
  'the Logger line is dropped, so #vera-logs loses the occurrences': b => ({
    'ApiHealth.js': in429(b['ApiHealth.js'],
      "      Logger.log('ApiHealth [' + source + ']: rate limited (HTTP 429) — ' + (detail || ''));\n",
      ''),
  }),

  // ---- matching the status code --------------------------------------------
  'a strict === replaces Number(), so a string code slips through': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(BLOCK_START,
      '} else if (httpCode === 429) {'),
  }),

  // ---- the cooldown --------------------------------------------------------
  'the rate limit shares the genuine-failure cooldown': b => {
    let s = in429(b['ApiHealth.js'],
      'lastRateLimitAlertedAt: prev.lastRateLimitAlertedAt || 0,',
      'lastRateLimitAlertedAt: 0,');
    s = in429(s, '(now - (prev.lastRateLimitAlertedAt || 0))', '(now - (prev.lastAlertedAt || 0))');
    return { 'ApiHealth.js': in429(s, 'entry.lastRateLimitAlertedAt = now;', 'entry.lastAlertedAt = now;') };
  },
  'the 429 never announces at all': b => ({
    'ApiHealth.js': in429(b['ApiHealth.js'],
      'if ((now - (prev.lastRateLimitAlertedAt || 0)) > API_ALERT_COOLDOWN_MS_) {',
      'if (false) {'),
  }),
  'it announces on every single 429': b => ({
    'ApiHealth.js': in429(b['ApiHealth.js'],
      'if ((now - (prev.lastRateLimitAlertedAt || 0)) > API_ALERT_COOLDOWN_MS_) {',
      'if (true) {'),
  }),
  'the notice is worded as an outage': b => ({
    'ApiHealth.js': in429(b['ApiHealth.js'],
      "summary: source + ' is rate limited (HTTP 429) — not a fault in the source, ' +\n" +
      "                   'and not counted as degraded data',",
      "summary: source + ' unavailable — rate limited',"),
  }),
  'a genuine failure resets the rate-limit cooldown': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      '        lastRateLimited:        prev.lastRateLimited || 0,\n' +
      '        rateLimitHits:          prev.rateLimitHits || 0,\n' +
      '        lastRateLimitAlertedAt: prev.lastRateLimitAlertedAt || 0,\n', ''),
  }),
  'a success keeps the rate-limit cooldown, so a fresh 429 is swallowed': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      '        consecutiveFailures: 0,\n        lastAlertedAt:       0,\n      };',
      '        consecutiveFailures: 0,\n        lastAlertedAt:       0,\n' +
      '        lastRateLimitAlertedAt: prev.lastRateLimitAlertedAt || 0,\n      };'),
  }),

  // ---- the prune -----------------------------------------------------------
  'the prune forgets lastRateLimited and orphans the source': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      'var lastTouched = Math.max(e.lastSuccess || 0, e.lastFailure || 0, e.lastRateLimited || 0);',
      'var lastTouched = Math.max(e.lastSuccess || 0, e.lastFailure || 0);'),
  }),
  'the prune keeps everything, so nothing ages out': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      'var lastTouched = Math.max(e.lastSuccess || 0, e.lastFailure || 0, e.lastRateLimited || 0);',
      'var lastTouched = now;'),
  }),

  // ---- the UV removal ------------------------------------------------------
  'fetchUVIndex_ comes back': b => ({
    'Weather.js': b['Weather.js'].replace('function fetchAQI_(',
      'function fetchUVIndex_(lat, lon) { return null; }\n\nfunction fetchAQI_('),
  }),
  'buildTickerHtml_ keeps the uvi parameter the call no longer passes': b => ({
    'Weather.js': b['Weather.js'].replace(
      'function buildTickerHtml_(slot9am, slot6pm, rainPct, aqi, awayLabel9am, awayLabel6pm)',
      'function buildTickerHtml_(slot9am, slot6pm, rainPct, aqi, uvi, awayLabel9am, awayLabel6pm)'),
  }),
  'a dead UV chip is left rendering a dash': b => ({
    'Weather.js': b['Weather.js'].replace(
      "    parts.push('🌿&nbsp;AQI&nbsp;",
      "    parts.push('☀️&nbsp;UV&nbsp;<strong>&mdash;</strong>');\n    parts.push('🌿&nbsp;AQI&nbsp;"),
  }),
  'AQI is dropped along with UV': b => ({
    'Weather.js': b['Weather.js'].replace(/fetchAQI_/g, 'fetchAQI_DISABLED_'),
  }),

  // ---- guarding my own mistake ---------------------------------------------
  'trip weather is dropped along with the UV chip': b => ({
    'TripDecisions.js': b['TripDecisions.js'].replace(
      "fetchWithHealth_('open-meteo'", 'UrlFetchApp.fetch('),
  }),
  'the packing forecast stops recording its health': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "fetchWithHealth_('open-meteo'", 'UrlFetchApp.fetch('),
  }),
  'the geocode call stops recording its health': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "fetchTracked_('open-meteo'", 'UrlFetchApp.fetch('),
  }),
  'the geocode cache is dropped, raising the volume against the quota': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      '    try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 21600); } catch(e_) {}\n', ''),
  }),
  'the open-meteo fetch moves out of getPackingWeather_ but stays in the file': b => {
    const s = b['WebApp.js'];
    return { 'WebApp.js': s.replace(
      'function getPackingWeather_',
      "function packingFetchElsewhere_(url) { return fetchWithHealth_('open-meteo', url, {}); }\n\nfunction getPackingWeather_")
      .replace("const wResp = fetchWithHealth_('open-meteo', weatherUrl);",
               'const wResp = packingFetchElsewhere_(weatherUrl);') };
  },
  'PreTripBriefing stops asking for packing weather': b => ({
    'PreTripBriefing.js': b['PreTripBriefing.js'].replace(/getPackingWeather_\(/g, 'noPackingWeather_('),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_ratelimit.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)         { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length)   { console.log('  !! NOTHING BIT (patched: ' + changed.join(', ') + ')'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 3).forEach(f => console.log('    - ' + f));
  if (fails.length > 3) console.log('    … and ' + (fails.length - 3) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
