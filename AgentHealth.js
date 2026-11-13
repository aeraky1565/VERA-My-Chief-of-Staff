// ============================================================
// VERA — AgentHealth.js  (issue #247)
// Did ARIA, TESS, HAILEY and VERA's own jobs run when they should have?
// ============================================================
//
// VERA can't query Claude scheduled tasks from Apps Script, so each agent's health
// comes from what that agent writes to ITS OWN Google Sheet. VERA only reads those
// sheets; nothing here writes to an agent's sheet.
//
//   ARIA    the Run Log tab in the ARIA Travel Tracker (Run Time, Status, …)
//   TESS    the Run Log tab in the Job Agent Settings sheet (Run Time (UTC), Status,
//           Summary: step 11 of TESS's task). Until that tab exists, TESS is judged
//           from its job finds, as before (carAgentHealth_).
//   HAILEY  the sweep's Run Log tab (Run time (UTC), Results returned, New, …, Notes;
//           no Status column, so errors in Notes or in Settings "Last run status"
//           decide it), and the Friday digest's Weekly Digest tab (Digest date, Notes)
//   VERA    its own watchdog and heartbeats (Watchdog.js)
//   PIES    not visible to VERA: listed so the roster is complete, never flagged
//
// The schedules live in Config (agent_schedule_aria, agent_schedule_tess,
// agent_schedule_hailey, agent_schedule_hailey_digest), since VERA can't read
// Claude's: "<daily|weekdays|mon,wed,…> HH:MM <IANA time zone> [eod]". eod = late
// only once the day is over (TESS), else late 2 hours after the scheduled time.
//
// Rules: Late = no run logged for the latest scheduled run, once it's due. Failed =
// the latest run says Failed. Partial shows amber and counts as OK. One flag per
// agent (AGENT_HEALTH|<name>) for TESS and HAILEY, reworded as things change and
// resolved on the next good run; ARIA and VERA already raise their own (ARIA|
// RUN_HEALTH, the watchdog), so they aren't flagged twice. A change of level posts
// to #vera-logs.
//
// Two layers: pure (agentParseSchedule_, agentSlots_, agentRunHealth_, agentLogRuns_,
// agentWantedFlags_, agentCounts_) and the reads around them.
// ============================================================

var AGENT_GRACE_HOURS_ = 2;
var AGENT_STRIP_ = 7;
var AGENT_CACHE_KEY_ = 'agent_health_v1';
var AGENT_FLAG_PREFIX_ = 'AGENT_HEALTH|';
var AGENT_SCHEDULE_DEFAULTS_ = {
  aria: 'daily 06:52 America/New_York',
  tess: 'weekdays 06:36 America/New_York eod',
  hailey: 'weekdays 06:38 America/Chicago',
  hailey_digest: 'fri 18:00 America/Chicago',
};
var AGENT_DAY_NAMES_ = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
var AGENT_DAY_LONG_ = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---- pure ----------------------------------------------------------------------

/** Pure: "weekdays 06:36 America/New_York eod" → { days:[1..5], hh, mm, tz, eod, text }, or null. */
function agentParseSchedule_(s) {
  var m = /^\s*([a-z,]+)\s+(\d{1,2}):(\d{2})\s+([A-Za-z_]+\/[A-Za-z_]+)(\s+eod)?\s*$/i.exec(String(s || ''));
  if (!m) return null;
  var w = m[1].toLowerCase(), days;
  if (w === 'daily') days = [0, 1, 2, 3, 4, 5, 6];
  else if (w === 'weekdays') days = [1, 2, 3, 4, 5];
  else {
    days = w.split(',').map(function(d) { return AGENT_DAY_NAMES_.indexOf(d.slice(0, 3)); });
    if (days.some(function(d) { return d === -1; })) return null;
  }
  var hh = +m[2], mm = +m[3];
  if (hh > 23 || mm > 59) return null;
  var h12 = (hh % 12 || 12) + ':' + ('0' + mm).slice(-2) + (hh < 12 ? ' AM' : ' PM');
  var when = w === 'daily' ? 'daily' : w === 'weekdays' ? 'weekdays' : days.map(function(d) { return AGENT_DAY_LONG_[d].slice(0, 3); }).join(', ');
  var zone = { 'America/New_York': 'ET', 'America/Chicago': 'CT', 'America/Denver': 'MT', 'America/Los_Angeles': 'PT' }[m[4]] || m[4];
  return { days: days, hh: hh, mm: mm, tz: m[4], eod: !!m[5], text: when + ' ' + h12 + ' ' + zone };
}

/** Pure: 'yyyy-MM-dd' of a UTC instant at a fixed offset (minutes east of UTC). */
function agentLocalDate_(ms, offsetMin) {
  var d = new Date(ms + offsetMin * 60000);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

/**
 * Pure: the latest n scheduled runs that have started (at ≤ now), newest first:
 * { date: local 'yyyy-MM-dd', dow, atMs, dueMs }. offsetFn(ms) → the zone's offset
 * in minutes east of UTC at that moment (DST-aware in the caller).
 */
function agentSlots_(sched, nowMs, offsetFn, n) {
  var out = [], off = offsetFn(nowMs);
  var today = agentLocalDate_(nowMs, off).split('-').map(Number);
  for (var back = 0; back < 60 && out.length < n; back++) {
    var dayUtc = Date.UTC(today[0], today[1] - 1, today[2] - back);
    var dow = new Date(dayUtc).getUTCDay();
    if (sched.days.indexOf(dow) === -1) continue;
    var guess = dayUtc + (sched.hh * 60 + sched.mm) * 60000;
    var at = guess - offsetFn(guess) * 60000;
    if (at > nowMs) continue;
    var due = sched.eod ? dayUtc + 24 * 3600000 - offsetFn(dayUtc + 24 * 3600000) * 60000 : at + AGENT_GRACE_HOURS_ * 3600000;
    out.push({ date: agentLocalDate_(dayUtc, 0), dow: dow, atMs: at, dueMs: due });
  }
  return out;
}

/** Pure: "OK", "ok - 3 trips", "Partial: …", "FAILED" → OK | Partial | Failed | ''. */
function agentStatusWord_(s) {
  var t = String(s == null ? '' : s).trim();
  return /^ok\b/i.test(t) ? 'OK' : /^partial/i.test(t) ? 'Partial' : /^fail/i.test(t) ? 'Failed' : '';
}

/**
 * Pure: a Run Log grid (row 1 = headers) → runs, newest first: { at: ISO UTC or '',
 * date: 'yyyy-MM-dd' when only a date is known, status, summary }. Columns by header
 * (any case): the time is "Run Time (UTC)", "Run Time", "Run time" or "Digest date";
 * Status when there is one; Summary, else a few known counts, else Notes. Without a
 * Status column, errors in Notes make a run Partial.
 */
function agentLogRuns_(values) {
  if (!values || values.length < 2) return [];
  var head = values[0].map(function(h) { return String(h == null ? '' : h).trim().toLowerCase(); });
  var col = function(names) { for (var i = 0; i < names.length; i++) { var j = head.indexOf(names[i]); if (j !== -1) return j; } return -1; };
  var cTime = col(['run time (utc)', 'run time', 'digest date']), cStatus = col(['status']), cSummary = col(['summary']), cNotes = col(['notes']);
  if (cTime === -1) return [];
  var counts = ['rows priced', 'book now', 'results returned', 'new', 'price cuts', 'gone', 'tracked', 'available now', 'failures']
    .map(function(h) { return { h: h, i: head.indexOf(h) }; }).filter(function(x) { return x.i !== -1; });
  var runs = [];
  values.slice(1).forEach(function(r) {
    var t = r[cTime], at = '', date = '';
    if (t instanceof Date && !isNaN(t.getTime())) at = t.toISOString();
    else {
      var s = String(t == null ? '' : t).trim();
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) { var d = new Date(s.replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? '' : 'Z')); if (!isNaN(d.getTime())) at = d.toISOString(); }
      else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) date = s;
    }
    if (!at && !date) return;
    var notes = cNotes === -1 ? '' : String(r[cNotes] == null ? '' : r[cNotes]).trim();
    var status = cStatus === -1 ? (/\b(error|errors|fail|failed|failure|could not|couldn.t|unavailable)\b/i.test(notes) ? 'Partial' : 'OK') : (agentStatusWord_(r[cStatus]) || 'OK');
    var summary = cSummary !== -1 ? String(r[cSummary] == null ? '' : r[cSummary]).trim() : '';
    if (!summary && counts.length) {
      summary = counts.map(function(x) { var v = r[x.i]; return v === '' || v == null ? '' : x.h.charAt(0).toUpperCase() + x.h.slice(1) + ' ' + v; }).filter(String).join(' · ');
    }
    if (!summary) summary = notes;
    runs.push({ at: at, date: date, status: status, summary: summary.slice(0, 200) });
  });
  runs.sort(function(a, b) { var x = a.at || a.date, y = b.at || b.date; return x < y ? 1 : x > y ? -1 : 0; });
  return runs;
}

/**
 * Pure: is the agent on time? runs: newest first (agentLogRuns_); sched: parsed;
 * offsetFn as for agentSlots_.
 * → { level: ok | late | failed | none, lastRun, lastStatus, summary, text, strip: [state …] }
 *   strip: the last 7 scheduled runs, newest first: ok | partial | failed | missing | pending.
 */
function agentRunHealth_(runs, sched, nowMs, offsetFn, name) {
  name = name || 'The agent';
  if (!sched) return { level: 'none', lastRun: '', lastStatus: '', summary: '', text: 'No schedule: add its agent_schedule row to Config', strip: [] };
  runs = runs || [];
  var dayOf = function(r) {
    if (r.date) return r.date;
    var ms = new Date(r.at).getTime();
    return agentLocalDate_(ms, offsetFn(ms));
  };
  var byDay = {};
  runs.forEach(function(r) { var d = dayOf(r); if (!byDay[d]) byDay[d] = r; });   // newest first, so the day's latest
  var slots = agentSlots_(sched, nowMs, offsetFn, AGENT_STRIP_);
  var dateOnlyNext = function(d) { var p = d.split('-').map(Number); return agentLocalDate_(Date.UTC(p[0], p[1] - 1, p[2] + 1), 0); };
  var runFor = function(slot) {
    var r = byDay[slot.date];
    if (r) return r;
    var n = byDay[dateOnlyNext(slot.date)];   // a date-only row may carry the UTC date, a day later
    return n && n.date ? n : null;
  };
  var strip = slots.map(function(s) {
    var r = runFor(s);
    if (r) return r.status === 'Failed' ? 'failed' : r.status === 'Partial' ? 'partial' : 'ok';
    return nowMs < s.dueMs ? 'pending' : 'missing';
  });
  var latest = runs[0] || null;
  var last = latest ? (latest.at || latest.date) : '';
  var base = { lastRun: last, lastStatus: latest ? latest.status : '', summary: latest ? latest.summary : '', strip: strip };
  if (!latest) return Object.assign(base, { level: 'none', text: 'Nothing logged yet' });
  if (latest.status === 'Failed') return Object.assign(base, { level: 'failed', text: name + '’s last run failed' + (latest.summary ? ': ' + latest.summary : '') });
  var firstDue = -1;
  for (var i = 0; i < slots.length; i++) { if (strip[i] !== 'pending') { firstDue = i; break; } }
  if (firstDue !== -1 && strip[firstDue] === 'missing') {
    var missed = [];
    for (var j = firstDue; j < slots.length && strip[j] === 'missing'; j++) missed.push(AGENT_DAY_LONG_[slots[j].dow]);
    var said = missed.length === 1 ? missed[0] : missed.length === 2 ? missed[1] + ' or ' + missed[0] : missed.length + ' scheduled runs in a row';
    return Object.assign(base, { level: 'late', missed: missed.length, text: 'No run logged ' + (missed.length <= 2 ? said : '— ' + said) });
  }
  return Object.assign(base, { level: 'ok', text: latest.status === 'Partial' ? 'Last run was partial' + (latest.summary ? ': ' + latest.summary : '') : (latest.summary || 'Ran on time') });
}

/** Pure: the worse of two health results (HAILEY's sweep and digest). */
function agentWorse_(a, b) {
  var rank = { failed: 0, late: 1, none: 2, ok: 3 };
  return rank[b.level] < rank[a.level] ? b : a;
}

/** Pure: { ok, late, failed, none } across the agents. */
function agentCounts_(agents) {
  var c = { ok: 0, late: 0, failed: 0, none: 0 };
  (agents || []).forEach(function(a) { c[a.level] = (c[a.level] || 0) + 1; });
  return c;
}

/**
 * Pure: the flags to hold, keyed AGENT_HEALTH|<name>, for the agents that don't
 * raise their own (TESS, HAILEY). "Nothing logged yet" isn't flagged; a sheet VERA
 * can't open is.
 */
function agentWantedFlags_(agents) {
  var wanted = {};
  (agents || []).forEach(function(a) {
    if (!a.flaggable) return;
    if (a.level === 'ok' || (a.level === 'none' && !a.cantOpen)) return;
    var what = a.level === 'failed' ? a.name + ' run failed' : a.level === 'late' ? a.name + ' did not run' : 'VERA can’t read ' + a.name + '’s sheet';
    wanted[AGENT_FLAG_PREFIX_ + a.name] = { flag: what, reason: a.text + (a.schedule ? ' (scheduled ' + a.schedule + ').' : '.'),
      urgency: a.level === 'failed' || a.level === 'late' ? 'High' : 'Medium' };
  });
  return wanted;
}

/** Pure: the #vera-logs lines for agents whose level changed since last time. */
function agentChangeLines_(agents, before) {
  var lines = [], now = {};
  (agents || []).forEach(function(a) {
    if (a.name === 'PIES' || a.name === 'VERA') return;
    now[a.name] = a.level;
    var was = (before || {})[a.name];
    if (!was || was === a.level) return;
    lines.push((a.level === 'ok' ? '✅ ' : a.level === 'failed' ? '❌ ' : '⚠️ ') + a.name + ': ' + (a.level === 'ok' ? 'back on time' : a.level) + ' — ' + a.text);
  });
  return { lines: lines, now: now };
}

// ---- the reads -------------------------------------------------------------------

/** Minutes east of UTC for a zone at a moment ("-0500" → -300). */
function agentOffsetFn_(tz) {
  return function(ms) {
    var z = Utilities.formatDate(new Date(ms), tz, 'Z'), m = /^([+-])(\d{2})(\d{2})$/.exec(z);
    return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
  };
}

function agentSchedule_(key, cfg) {
  var v = String((cfg || {})['agent_schedule_' + key] || '').trim();
  return agentParseSchedule_(v) || agentParseSchedule_(AGENT_SCHEDULE_DEFAULTS_[key]);
}

function agentTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return null;
  return sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
}

function agentSheetUrl_(id) { return id ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' : ''; }

/** One agent from its sheet's Run Log. Never throws: a sheet VERA can't open is No signal. */
function agentFromSheet_(name, role, sheetId, tabName, sched, nowMs) {
  var base = { name: name, role: role, schedule: sched ? sched.text : '', source: { label: name + '’s ' + tabName, url: agentSheetUrl_(sheetId) }, flaggable: name === 'TESS' || name === 'HAILEY' };
  if (!sheetId) return Object.assign(base, { level: 'none', text: 'No sheet linked: add its link to Config', strip: [] });
  var ss;
  try { ss = SpreadsheetApp.openById(sheetId); }
  catch (e) { return Object.assign(base, { level: 'none', cantOpen: true, text: 'No signal: can’t open ' + name + '’s sheet', strip: [] }); }
  var values = agentTab_(ss, tabName);
  if (!values) return Object.assign(base, { level: 'none', noLog: true, text: name + '’s sheet has no ' + tabName + ' tab yet', strip: [], ss: ss });
  return Object.assign(base, agentRunHealth_(agentLogRuns_(values), sched, nowMs, agentOffsetFn_(sched.tz), name), { ss: ss });
}

/** HAILEY's latest status line (Settings "Last run status"), for the newest sweep row. */
function agentHaileyLastStatus_(ss) {
  try {
    var v = agentTab_(ss, 'Settings') || [];
    for (var i = 0; i < v.length; i++) if (/^last run status/i.test(String(v[i][0] || '').trim())) return String(v[i][1] || '').trim();
  } catch (e) {}
  return '';
}

/** Everything, fresh. Read only: nothing here writes to an agent's sheet. */
function agentHealthRead_() {
  var cfg = {};
  try { cfg = getConfigValues(); } catch (e) {}
  var nowMs = Date.now(), agents = [];
  var idOf = function(v) { return ariaSheetIdFrom_(v); };

  // ARIA
  var aria = agentFromSheet_('ARIA', 'travel agent', ariaSheetId_(), 'Run Log', agentSchedule_('aria', cfg), nowMs);
  agents.push(aria);

  // TESS: its Run Log, else (until TESS writes one) its job finds.
  var tessId = idOf(cfg['career_alert_sheet_id']);
  var tess = agentFromSheet_('TESS', 'job agent', tessId, 'Run Log', agentSchedule_('tess', cfg), nowMs);
  if (tess.noLog) {
    try {
      var res = carReadTracker_(tessId);
      if (res.status === 'ok') {
        var today = Utilities.formatDate(new Date(nowMs), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        var h = carAgentHealth_(res.rows, today, parseInt(cfg['career_agent_stale_weekdays'], 10) || 2);
        tess.level = h.stale ? 'late' : 'ok';
        tess.fallback = true;
        tess.lastRun = h.lastFound || '';
        tess.text = (h.lastFound ? 'Last job find ' + h.lastFound + (h.weekdays ? ', ' + h.weekdays + ' weekday' + (h.weekdays === 1 ? '' : 's') + ' ago' : '') : 'No job finds yet') + ' (judged from its finds until TESS writes a Run Log)';
        tess.source = { label: 'TESS’s Tracker', url: tess.source.url };
        tess.flaggable = false;   // carCheckAgentHealth_ flags this case, as before
      }
    } catch (e) {}
  }
  agents.push(tess);

  // HAILEY: the weekday sweep and the Friday digest; the worse of the two.
  var hId = idOf(cfg['roster_link_hailey']);
  var sweep = agentFromSheet_('HAILEY', 'home search', hId, 'Run Log', agentSchedule_('hailey', cfg), nowMs);
  if (sweep.ss && sweep.lastRun) {
    var st = agentHaileyLastStatus_(sweep.ss);
    if (/\b(fail|failed|failure)\b/i.test(st) && sweep.level !== 'late') {
      sweep.level = 'failed'; sweep.lastStatus = 'Failed'; sweep.text = 'HAILEY’s last sweep failed: ' + st.slice(0, 160);
      if (sweep.strip.length && sweep.strip[0] !== 'pending' && sweep.strip[0] !== 'missing') sweep.strip[0] = 'failed';
    }
  }
  var digestSched = agentSchedule_('hailey_digest', cfg), digest = null;
  if (sweep.ss) {
    var dv = agentTab_(sweep.ss, 'Weekly Digest');
    digest = dv ? agentRunHealth_(agentLogRuns_(dv), digestSched, nowMs, agentOffsetFn_(digestSched.tz), 'HAILEY’s weekly digest') : null;
    if (digest && digest.level === 'late') digest.text = 'Weekly digest: ' + digest.text;
  }
  var hailey = digest ? Object.assign({}, sweep, { level: agentWorse_(sweep, digest).level, text: agentWorse_(sweep, digest) === sweep ? sweep.text : digest.text,
    digest: { schedule: digestSched.text, level: digest.level, lastRun: digest.lastRun, text: digest.text, strip: digest.strip } }) : sweep;
  hailey.schedule = sweep.schedule + (digest ? ' · digest ' + digestSched.text : '');
  agents.push(hailey);

  // VERA: its watchdog.
  var vera = { name: 'VERA', role: 'its own jobs', schedule: 'nightly, morning email, hourly checks', source: { label: 'VERA’s watchdog', url: '' }, strip: [] };
  try {
    var overdue = getOverdueJobs_();
    var hb = getHeartbeatState_(), lastNight = hb.nightlyRun && hb.nightlyRun.lastRun;
    vera.lastRun = lastNight ? new Date(lastNight).toISOString() : '';
    if (!overdue.length) { vera.level = 'ok'; vera.text = 'Nightly run, morning email and hourly checks all on time'; }
    else {
      vera.level = overdue.some(function(o) { return o.diedAt; }) ? 'failed' : 'late';
      vera.text = overdue.map(function(o) { return o.label + ' ' + o.verb + ' ' + o.ageText + (o.suffix ? ' ' + o.suffix : ''); }).join('; ');
    }
  } catch (e) { vera.level = 'none'; vera.text = 'The watchdog couldn’t be read'; }
  agents.push(vera);

  agents.push({ name: 'PIES', role: 'work environment', level: 'none', schedule: 'Not visible to VERA', text: 'Runs outside VERA’s reach. Listed so the roster is complete; never flagged.', strip: [], source: { label: '', url: '' } });

  agents.forEach(function(a) { delete a.ss; delete a.noLog; });
  return { agents: agents, counts: agentCounts_(agents), read: new Date(nowMs).toISOString() };
}

/** GET agent_health[&refresh=1]: cached for ten minutes. */
function webAgentHealth_(p) {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache && !(p && p.refresh)) { try { var hit = cache.get(AGENT_CACHE_KEY_); if (hit) return JSON.parse(hit); } catch (e) {} }
  var out;
  try { out = Object.assign({ ok: true }, agentHealthRead_()); }
  catch (e) { return { ok: false, error: 'Agent health couldn’t be read: ' + e.message }; }
  if (cache) { try { cache.put(AGENT_CACHE_KEY_, JSON.stringify(out), 600); } catch (e) {} }
  return out;
}

/** Nightly: hold one flag per agent that needs it, and say on #vera-logs what changed. */
function checkAgentHealth_() {
  var h = agentHealthRead_();
  try { CacheService.getScriptCache().put(AGENT_CACHE_KEY_, JSON.stringify(Object.assign({ ok: true }, h)), 600); } catch (e) {}
  var flagSheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (flagSheet) upsertKeyedFlags_(flagSheet, AGENT_FLAG_PREFIX_, 'System', agentWantedFlags_(h.agents), today);
  var before = {};
  try { before = JSON.parse(veraStoreGet_('AGENT_HEALTH_LEVELS') || '{}') || {}; } catch (e) { before = {}; }
  var ch = agentChangeLines_(h.agents, before);
  if (ch.lines.length) { try { sendSlackLog_('🤖 Agent health\n' + ch.lines.join('\n')); } catch (e) {} }
  try { veraStoreSet_('AGENT_HEALTH_LEVELS', JSON.stringify(ch.now)); } catch (e) {}
  return h.counts.ok + ' ok, ' + h.counts.late + ' late, ' + h.counts.failed + ' failed, ' + h.counts.none + ' no signal';
}

/** Does TESS keep a Run Log yet? Then its job-find guess (carCheckAgentHealth_) steps aside. */
function agentTessHasRunLog_(sheetId) {
  try { return !!(sheetId && SpreadsheetApp.openById(sheetId).getSheetByName('Run Log')); } catch (e) { return false; }
}
