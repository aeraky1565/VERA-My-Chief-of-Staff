// ============================================================
// VERA — ApiHealth.js  (Issue #138)
// Freshness contract for every external data source
// ============================================================
//
// THE PROBLEM THIS SOLVES:
//   Every external call in VERA used to fail the same way — Logger.log() then
//   return null. Nothing downstream was told the data was missing, so consumers
//   kept rendering the last successful value as if it were current. A flight
//   status from three days ago looked identical to a live one.
//
// TWO MECHANISMS:
//   1. A per-source health map in Script Properties (API_HEALTH_STATE) that
//      records the last success, last failure, reason, and consecutive-failure
//      count for every external service.
//   2. freshnessOf_() — turns a "last checked" timestamp into a live/aging/stale
//      verdict so consumers can render "Not live" instead of a confident value.
//
// SLACK NOISE CONTROL:
//   #vera-logs is the only diagnostics destination, and ~35 call sites are
//   instrumented. Logging every call would flood the channel, so alerts fire
//   only on state transitions: healthy → degraded, still-degraded after a
//   cooldown, and degraded → recovered. Routine successes are never posted.
//
// USAGE:
//   var resp = fetchWithHealth_('openweathermap', url, { muteHttpExceptions: true });
//   if (!resp) return null;   // failure already recorded and logged
//
//   // For call sites that can't use the wrapper (need the raw response, or
//   // aren't fetches at all — e.g. external Sheet reads):
//   recordApiHealth_('googlefit-sleep', false, 'no sleep data returned', 200);
// ============================================================

var API_HEALTH_KEY_        = 'API_HEALTH_STATE';
var API_ALERT_COOLDOWN_MS_ = 60 * 60 * 1000;   // 60 min between repeat failure alerts

// Sources that must never report through Slack — Slack is the log destination
// itself, so a Slack outage trying to announce itself via Slack would recurse.
var API_HEALTH_NO_SLACK_ = { slack: true };

// Per-execution read cache. GAS gives each execution a fresh global scope, so
// this avoids re-parsing the Script Property on every one of ~35 call sites.
var _apiHealthCache_ = null;

// ---- State access -----------------------------------------------------------

/** Reads the health map, parsing the Script Property once per execution. */
function getApiHealthState_() {
  if (_apiHealthCache_) return _apiHealthCache_;
  var raw = PropertiesService.getScriptProperties().getProperty(API_HEALTH_KEY_) || '{}';
  try { _apiHealthCache_ = JSON.parse(raw); } catch (e) { _apiHealthCache_ = {}; }
  return _apiHealthCache_;
}

/** Persists the health map and refreshes the per-execution cache. */
function setApiHealthState_(state) {
  _apiHealthCache_ = state;
  PropertiesService.getScriptProperties().setProperty(API_HEALTH_KEY_, JSON.stringify(state));
}

// ---- Recording --------------------------------------------------------------

/**
 * Records the outcome of one external call.
 *
 * Alerts to #vera-logs only on state transitions (see SLACK NOISE CONTROL above).
 * Never throws — a diagnostics helper must not be able to break its caller.
 *
 * @param {string}  source    Stable service name, e.g. 'aviationstack', 'sheet:Finance'
 * @param {boolean} ok        true if the call succeeded
 * @param {string}  [detail]  Failure reason / response snippet
 * @param {number}  [httpCode] HTTP status, when there was one
 */
function recordApiHealth_(source, ok, detail, httpCode) {
  try {
    var state = getApiHealthState_();
    var now   = Date.now();
    var prev  = state[source] || {
      lastSuccess: 0, lastFailure: 0, lastError: '',
      consecutiveFailures: 0, lastAlertedAt: 0,
    };
    var wasDegraded = prev.consecutiveFailures > 0;
    var entry, alert = null;

    if (ok) {
      entry = {
        lastSuccess:         now,
        lastFailure:         prev.lastFailure,
        lastError:           '',
        consecutiveFailures: 0,
        lastAlertedAt:       0,
      };
      if (wasDegraded) {
        var downMs = prev.lastSuccess ? (now - prev.lastSuccess) : 0;
        alert = {
          status:  'Success',
          summary: source + ' recovered after ' + prev.consecutiveFailures +
                   ' failed call' + (prev.consecutiveFailures === 1 ? '' : 's') +
                   (downMs ? ' — was down ' + formatAge_(downMs) : ''),
          error:   '',
        };
      }
    } else {
      var reason = (httpCode ? 'HTTP ' + httpCode + ' — ' : '') + (detail || 'unknown error');
      entry = {
        lastSuccess:         prev.lastSuccess,
        lastFailure:         now,
        lastError:           reason,
        consecutiveFailures: prev.consecutiveFailures + 1,
        lastAlertedAt:       prev.lastAlertedAt || 0,
      };
      var cooledOff = (now - (prev.lastAlertedAt || 0)) > API_ALERT_COOLDOWN_MS_;
      if (!wasDegraded || cooledOff) {
        entry.lastAlertedAt = now;
        alert = {
          status:  'Failed',
          summary: source + ' unavailable' +
                   (entry.consecutiveFailures > 1
                     ? ' (' + entry.consecutiveFailures + ' consecutive failures)' : '') +
                   (prev.lastSuccess
                     ? ' — last good data ' + formatAge_(now - prev.lastSuccess) + ' ago'
                     : ' — no successful call on record'),
          error:   reason,
        };
      }
    }

    state[source] = entry;
    setApiHealthState_(state);

    if (alert) {
      if (API_HEALTH_NO_SLACK_[source]) {
        Logger.log('ApiHealth [' + source + ']: ' + alert.summary +
                   (alert.error ? ' — ' + alert.error : ''));
      } else {
        veraLog_('apiHealth:' + source, 'System', alert.status, alert.summary, 0, alert.error);
      }
    }
  } catch (e) {
    // A diagnostics helper must never break the caller it is instrumenting.
    Logger.log('recordApiHealth_ failed silently for "' + source + '": ' + e.message);
  }
}

// ---- Instrumented fetch -----------------------------------------------------

/**
 * UrlFetchApp.fetch with health recording. Drop-in replacement for the
 * muteHttpExceptions + response-code-check pattern used throughout VERA.
 *
 * @param {string} source        Service name for the health map
 * @param {string} url           URL to fetch
 * @param {Object} [options]     UrlFetchApp options (muteHttpExceptions forced on)
 * @param {Object} [opts]        { okCodes: [200] }
 * @returns {HTTPResponse|null}  Response on success, null on any failure
 */
function fetchWithHealth_(source, url, options, opts) {
  opts = opts || {};
  var okCodes = opts.okCodes || [200];

  // Force muteHttpExceptions so we inspect the status ourselves rather than
  // letting a non-2xx throw past the health recording.
  var fetchOpts = Object.assign({}, options || {}, { muteHttpExceptions: true });

  var resp;
  try {
    resp = UrlFetchApp.fetch(url, fetchOpts);
  } catch (e) {
    recordApiHealth_(source, false, e.message, 0);
    Logger.log('fetchWithHealth_ [' + source + '] exception: ' + e.message);
    return null;
  }

  var code = resp.getResponseCode();
  if (okCodes.indexOf(code) === -1) {
    var body = '';
    try { body = String(resp.getContentText() || '').substring(0, 200); } catch (e2) {}
    recordApiHealth_(source, false, body || 'non-OK response', code);
    Logger.log('fetchWithHealth_ [' + source + '] HTTP ' + code + ': ' + body);
    return null;
  }

  recordApiHealth_(source, true, '', code);
  return resp;
}

/**
 * Records health without altering the caller's control flow.
 *
 * Unlike fetchWithHealth_, this returns the HTTPResponse whatever the status
 * code, and rethrows exceptions. That makes it a safe drop-in at the many call
 * sites that already inspect getResponseCode() and raise their own errors —
 * instrumentation becomes a side effect rather than a behaviour change.
 *
 * @param {string} source     Service name for the health map
 * @param {string} url        URL to fetch
 * @param {Object} [options]  UrlFetchApp options, passed through untouched
 * @returns {HTTPResponse}    The response, exactly as UrlFetchApp returned it
 */
function fetchTracked_(source, url, options) {
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, options);
  } catch (e) {
    recordApiHealth_(source, false, e.message, 0);
    throw e;   // preserve the caller's original failure behaviour
  }

  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) {
    recordApiHealth_(source, true, '', code);
  } else {
    var body = '';
    try { body = String(resp.getContentText() || '').substring(0, 200); } catch (e2) {}
    recordApiHealth_(source, false, body || 'non-2xx response', code);
  }
  return resp;
}

// ---- Reads ------------------------------------------------------------------

/**
 * Health record for one source.
 * @returns {Object} { lastSuccess, lastFailure, lastError, consecutiveFailures, healthy }
 */
function getApiHealth_(source) {
  var e = getApiHealthState_()[source];
  if (!e) {
    return { lastSuccess: 0, lastFailure: 0, lastError: '', consecutiveFailures: 0, healthy: true };
  }
  return {
    lastSuccess:         e.lastSuccess || 0,
    lastFailure:         e.lastFailure || 0,
    lastError:           e.lastError   || '',
    consecutiveFailures: e.consecutiveFailures || 0,
    healthy:             !e.consecutiveFailures,
  };
}

/**
 * Every source currently in a failed state, worst-stale first.
 * Feeds the Claude prompt caveat, the morning-email footer, and dashboard banners.
 * @returns {Array<Object>}
 */
function getDegradedSources_() {
  var state = getApiHealthState_();
  var now   = Date.now();
  var out   = [];

  Object.keys(state).forEach(function(source) {
    var e = state[source];
    if (!e || !e.consecutiveFailures) return;
    var staleFor = e.lastSuccess ? (now - e.lastSuccess) : 0;
    out.push({
      source:              source,
      consecutiveFailures: e.consecutiveFailures,
      error:               e.lastError || '',
      lastSuccess:         e.lastSuccess || 0,
      staleFor:            staleFor,
      staleForText:        e.lastSuccess ? formatAge_(staleFor) : 'no successful call on record',
    });
  });

  out.sort(function(a, b) { return b.staleFor - a.staleFor; });
  return out;
}

/**
 * One-line summary of degraded sources, or '' when everything is healthy.
 * Used by the morning email footer and the Claude prompt caveat.
 */
function degradedSourcesSummary_() {
  var degraded = getDegradedSources_();
  if (degraded.length === 0) return '';
  return degraded.map(function(d) {
    return d.source + ' (' + d.staleForText + ')';
  }).join(', ');
}

// ---- Freshness --------------------------------------------------------------

/**
 * Turns a "last checked" timestamp into a freshness verdict.
 *
 * @param {number} lastCheckedMs   Epoch ms of the last successful refresh
 * @param {number} [staleAfterMin] Minutes after which the value is stale (default 60)
 * @returns {Object} { state: 'live'|'aging'|'stale', ageMin, label, ageText }
 */
function freshnessOf_(lastCheckedMs, staleAfterMin) {
  var staleMin = staleAfterMin || 60;
  var agingMin = Math.max(1, Math.round(staleMin / 2));

  if (!lastCheckedMs) {
    return { state: 'stale', ageMin: null, label: 'Not live', ageText: 'never checked' };
  }

  var ageMs  = Date.now() - lastCheckedMs;
  var ageMin = Math.round(ageMs / 60000);
  var ageTxt = formatAge_(ageMs);

  if (ageMin >= staleMin) return { state: 'stale', ageMin: ageMin, label: 'Not live', ageText: ageTxt };
  if (ageMin >= agingMin) return { state: 'aging', ageMin: ageMin, label: 'Aging',    ageText: ageTxt };
  return                         { state: 'live',  ageMin: ageMin, label: 'Live',     ageText: ageTxt };
}

/** Compact human duration: '4m', '3h 20m', '2d 5h'. */
function formatAge_(ms) {
  if (!ms || ms < 0) return '0m';
  var mins = Math.round(ms / 60000);
  if (mins < 60) return mins + 'm';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24)  return hrs + 'h' + (mins % 60 ? ' ' + (mins % 60) + 'm' : '');
  var days = Math.floor(hrs / 24);
  return days + 'd' + (hrs % 24 ? ' ' + (hrs % 24) + 'h' : '');
}

// ---- Debug helpers (run manually from the Apps Script editor) ---------------

/** Prints the full health map, newest activity first. */
function debugApiHealth() {
  var state   = getApiHealthState_();
  var sources = Object.keys(state);
  var tz      = Session.getScriptTimeZone();

  Logger.log('=== VERA API Health ===');
  if (sources.length === 0) {
    Logger.log('(empty — no external call has been recorded yet)');
    return;
  }

  function stamp(ms) {
    return ms ? Utilities.formatDate(new Date(ms), tz, 'MM/dd HH:mm') : 'never';
  }

  sources.sort(function(a, b) {
    return Math.max(state[b].lastSuccess || 0, state[b].lastFailure || 0) -
           Math.max(state[a].lastSuccess || 0, state[a].lastFailure || 0);
  });

  sources.forEach(function(s) {
    var e = state[s];
    Logger.log(
      (e.consecutiveFailures ? '[DOWN] ' : '[  OK] ') + s +
      ' | last success ' + stamp(e.lastSuccess) +
      ' | last failure ' + stamp(e.lastFailure) +
      (e.consecutiveFailures ? ' | ' + e.consecutiveFailures + ' consecutive' : '') +
      (e.lastError ? ' | ' + e.lastError : '')
    );
  });

  var degraded = getDegradedSources_();
  Logger.log('');
  Logger.log(degraded.length
    ? 'Degraded right now: ' + degradedSourcesSummary_()
    : 'All sources healthy.');
}

/** Clears the health map. Use when a source name changes or after testing. */
function resetApiHealth_() {
  PropertiesService.getScriptProperties().deleteProperty(API_HEALTH_KEY_);
  _apiHealthCache_ = null;
  Logger.log('API health state cleared.');
}

/**
 * Removes one source's entry from the health map, without touching any
 * other source. Use when a source is retired for good (e.g. an integration
 * removed from the code) and its last-recorded failure would otherwise sit
 * in the degraded list forever, since nothing will ever call
 * recordApiHealth_ for it again to clear it naturally.
 */
function clearApiHealthSource_(source) {
  var state = getApiHealthState_();
  if (!state[source]) {
    Logger.log('clearApiHealthSource_: no entry for "' + source + '" — nothing to do.');
    return;
  }
  delete state[source];
  setApiHealthState_(state);
  Logger.log('clearApiHealthSource_: removed "' + source + '" from API health state.');
}
