/**
 * System.js — the System tab's two server reads (issue #222, stage 1).
 *
 * The tab itself mounts panels that already exist (Notifications, Config, Test,
 * the assistants roster); what's new here is
 *   - Documents: today's Resources with a "used by" line on each one, and
 *   - API health: every source as OK / slow / failing, with counts.
 *
 * Both are reads. Nothing here writes a sheet.
 */

var SYS_SLOW_AFTER_MS_ = 24 * 3600 * 1000;   // no good call in a day, or rate limited within one

/**
 * Who reads each document. Chat can read any of them (fetch_resource_content);
 * Family Planning reads the one chosen as each parent's policy (policyDoc_<parent>,
 * an id or a name, matched the way webFetchResourceContent_ matches).
 * @param {Array<{id,name}>} resources
 * @param {Object} fpSettings  Family Planning settings (policyDoc_Ahmed, policyDoc_Victoria)
 * @returns {Object} id -> [label, …]
 */
function sysUsedBy_(resources, fpSettings) {
  var s = fpSettings || {}, out = {};
  var picks = ['Ahmed', 'Victoria'].map(function(p) {
    return { parent: p, q: String(s['policyDoc_' + p] || '').trim() };
  }).filter(function(x) { return x.q; });
  (resources || []).forEach(function(r) {
    var used = [];
    picks.forEach(function(x) {
      var byId = String(r.id) === x.q;
      var byName = !byId && x.q && String(r.name || '').toLowerCase().indexOf(x.q.toLowerCase()) !== -1;
      if (byId || byName) used.push('Family Planning: ' + x.parent + '’s leave policy');
    });
    used.push('Chat: VERA can read it when you ask');
    out[r.id] = used;
  });
  return out;
}

/**
 * Every recorded source as ok / slow / failing.
 *   failing — its last real call failed (consecutiveFailures > 0)
 *   slow    — not failing, but rate limited in the last day, or no good call in a day
 *   ok      — otherwise
 * @param {Object} state  the API health map (ApiHealth.js)
 * @param {number} nowMs
 */
function sysApiHealth_(state, nowMs) {
  var now = nowMs || Date.now(), list = [];
  Object.keys(state || {}).forEach(function(source) {
    var e = state[source] || {}, status = 'ok', why = '';
    if (e.consecutiveFailures > 0) {
      status = 'failing';
      why = (e.consecutiveFailures === 1 ? '1 failed call' : e.consecutiveFailures + ' failed calls in a row') + (e.lastError ? ' · ' + e.lastError : '');
    } else if (e.lastRateLimited && now - e.lastRateLimited < SYS_SLOW_AFTER_MS_) {
      status = 'slow'; why = 'Rate limited ' + formatAge_(now - e.lastRateLimited) + ' ago';
    } else if (!e.lastSuccess || now - e.lastSuccess >= SYS_SLOW_AFTER_MS_) {
      status = 'slow'; why = e.lastSuccess ? 'No good call in ' + formatAge_(now - e.lastSuccess) : 'No good call on record';
    }
    list.push({ source: source, status: status, why: why,
      lastSuccessAgo: e.lastSuccess ? formatAge_(now - e.lastSuccess) : '', lastFailureAgo: e.lastFailure ? formatAge_(now - e.lastFailure) : '' });
  });
  var rank = { failing: 0, slow: 1, ok: 2 };
  list.sort(function(a, b) { return rank[a.status] - rank[b.status] || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0); });
  var counts = { ok: 0, slow: 0, failing: 0 };
  list.forEach(function(x) { counts[x.status]++; });
  return { sources: list, counts: counts };
}

/** GET system_documents */
function webSystemDocuments_() {
  var res = webGetResources_(), s = {};
  try { s = fpReadSettings_(); } catch (e) {}
  var used = sysUsedBy_(res.resources, s);
  res.resources.forEach(function(r) { r.usedBy = used[r.id] || []; });
  return res;
}

/** GET system_api_health */
function webSystemApiHealth_() {
  var h = sysApiHealth_(getApiHealthState_(), Date.now());
  return { ok: true, sources: h.sources, counts: h.counts };
}
