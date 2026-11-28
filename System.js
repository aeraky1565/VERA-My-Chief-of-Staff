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
var SYS_WEEKLY_AFTER_MS_ = 8 * 24 * 3600 * 1000;   // a weekly job: slow only once a week's run is missed

/**
 * What each source is and how often VERA calls it, so a quiet source isn't mistaken for a slow one.
 *   daily   — something calls it every day (the nightly run, the morning email): a day without a good call is slow
 *   weekly  — a weekly job: slow only after 8 days
 *   demand  — called only when you open a screen or ask: quiet days are idle, not slow
 *   retired — nothing calls it any more: idle until it drops off (14 quiet days, pruneApiHealthState_)
 * Sources not listed are treated as daily. Summary sheets (sheet:<name> from Config summary_sheet:) are daily.
 */
var SYS_SOURCES_ = {
  'anthropic':                 { cad: 'daily',  what: 'Claude, the AI behind Chat, receipts and the summaries', when: 'every night and whenever you chat' },
  'openweathermap':            { cad: 'daily',  what: 'Weather for the morning email and plans', when: 'every morning' },
  'openweathermap-aqi':        { cad: 'daily',  what: 'Air quality for the morning email', when: 'every morning' },
  'slack':                     { cad: 'daily',  what: 'Slack messages and nudges', when: 'whenever VERA sends you something on Slack' },
  'mail:send':                 { cad: 'daily',  what: 'Emails VERA sends you', when: 'every day (the morning email)' },
  'mail:quota':                { cad: 'daily',  what: 'Gmail’s daily sending allowance', when: 'before each email' },
  'googlecalendar-advanced':   { cad: 'daily',  what: 'Your Google Calendar', when: 'every day' },
  'aviationstack':             { cad: 'demand', what: 'Live flight status', when: 'around your flights' },
  'airportgap':                { cad: 'demand', what: 'Airport details for travel-day briefings', when: 'when a trip is close or you open its briefing' },
  'serper':                    { cad: 'demand', what: 'Web search for Chat', when: 'Chat searches the web' },
  'tavily':                    { cad: 'demand', what: 'Web search for Chat', when: 'Chat searches the web' },
  'passport-index':            { cad: 'demand', what: 'Visa rules for trip ideas', when: 'you look at a trip idea’s visa' },
  'googlemaps-distancematrix': { cad: 'demand', what: 'Drive times between trip stops', when: 'you plan a trip’s legs' },
  'open-meteo':                { cad: 'demand', what: 'Weather for trips and packing', when: 'you open a trip’s weather or a packing list' },
  'hoa-website':               { cad: 'weekly', what: 'Your HOA website, checked for news', when: 'once a week (the HOA scan in Feature Flags)' },
  'sheet:JobAgent':            { cad: 'demand', what: 'The Job Agent’s Tracker sheet', when: 'you open Career' },
  'sheet:Planner':             { cad: 'demand', what: 'Your planner sheet', when: 'you open Net worth' },
  'sheet:AddressBook':         { cad: 'demand', what: 'The address book sheet', when: 'you open People › Address book' },
  'googlefit-sleep':           { cad: 'retired', what: 'Google Fit sleep (no longer used)', when: 'never: nothing in VERA calls it now' }
};
/** Pure: a source's entry, with summary sheets and unknown sources treated as daily. */
function sysSourceInfo_(source) {
  var s = SYS_SOURCES_[source];
  if (s) return s;
  if (/^sheet:/.test(source)) return { cad: 'daily', what: 'Summary sheet “' + source.slice(6) + '”', when: 'every night (Config summary_sheet:)' };
  return { cad: 'daily', what: '', when: '' };
}

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
 * Every recorded source as ok / slow / idle / failing, each with what it is (about) and, when it
 * isn't OK, what that state means for it (explain).
 *   failing — its last real call failed (consecutiveFailures > 0)
 *   slow    — rate limited in the last day, or a daily source with no good call in a day, or a
 *             weekly one with none in 8 days
 *   idle    — an on-demand source with no call in a day (normal: nothing asked), or a retired one
 *   ok      — otherwise
 * @param {Object} state  the API health map (ApiHealth.js)
 * @param {number} nowMs
 */
function sysApiHealth_(state, nowMs) {
  var now = nowMs || Date.now(), list = [];
  Object.keys(state || {}).forEach(function(source) {
    var e = state[source] || {}, status = 'ok', why = '', explain = '', info = sysSourceInfo_(source);
    var quiet = !e.lastSuccess ? Infinity : now - e.lastSuccess;
    var noGood = e.lastSuccess ? 'No good call in ' + formatAge_(now - e.lastSuccess) : 'No good call on record';
    if (e.consecutiveFailures > 0) {
      status = 'failing';
      why = (e.consecutiveFailures === 1 ? '1 failed call' : e.consecutiveFailures + ' failed calls in a row') + (e.lastError ? ' · ' + e.lastError : '');
    } else if (e.lastRateLimited && now - e.lastRateLimited < SYS_SLOW_AFTER_MS_) {
      status = 'slow'; why = 'Rate limited ' + formatAge_(now - e.lastRateLimited) + ' ago';
      explain = 'The service turned VERA away for asking too often. It isn’t down; VERA backs off and tries again later.';
    } else if (info.cad === 'retired') {
      status = 'idle'; why = noGood;
      explain = 'Nothing in VERA calls this any more, so it can’t get a good call. It’s a leftover entry and drops off by itself after 14 quiet days.';
    } else if (info.cad === 'demand' && quiet >= SYS_SLOW_AFTER_MS_) {
      status = 'idle'; why = e.lastSuccess ? 'Not used in ' + formatAge_(now - e.lastSuccess) : 'Not used yet';
      explain = 'Only called when ' + info.when + ', so quiet days are normal. It isn’t failing; it turns red only if a call fails.';
    } else if (info.cad === 'weekly' && quiet >= SYS_WEEKLY_AFTER_MS_) {
      status = 'slow'; why = noGood;
      explain = 'It runs ' + info.when + ', and the last run didn’t get a good answer. Check the site still loads, or run the check from Feature Flags.';
    } else if (info.cad === 'daily' && quiet >= SYS_SLOW_AFTER_MS_) {
      status = 'slow'; why = noGood;
      explain = 'VERA calls this ' + info.when + ', so a day without a good call is worth a look: check its key or settings.';
    } else if (info.cad === 'weekly') {
      explain = 'Runs ' + info.when + '; last good call ' + formatAge_(now - e.lastSuccess) + ' ago is on schedule.';
    }
    list.push({ source: source, status: status, why: why, explain: explain, about: info.what ? info.what + ' · called ' + info.when : '', cadence: info.cad,
      lastSuccessAgo: e.lastSuccess ? formatAge_(now - e.lastSuccess) : '', lastFailureAgo: e.lastFailure ? formatAge_(now - e.lastFailure) : '' });
  });
  var rank = { failing: 0, slow: 1, idle: 2, ok: 3 };
  list.sort(function(a, b) { return rank[a.status] - rank[b.status] || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0); });
  var counts = { ok: 0, slow: 0, idle: 0, failing: 0 };
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
