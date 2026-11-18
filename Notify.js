// ============================================================
// VERA — Notify.js  (issue #250)
// One home for every message, and fewer pings.
// ============================================================
//
// Every notification kind (NOTIF_REGISTRY, Code.js) has ONE place it goes:
//   - Where: Slack, the morning email, or off. Config notif_<key>_delivery ('slack' |
//     'email' | 'off') overrides the default; the old notif_<key>_enabled = FALSE still
//     means off. Check-ins (they expect a reply) are Slack or off; the long reads
//     (weekly trends, monthly review, the weekend memo) are email or off.
//   - The Slack channel: notif_<key>_channel, as before.
//   - While away: hold / send / if due (Away.js).
//
// Before a push goes out, notifGate_ decides:
//   off                    → nothing;
//   Where = morning email  → it waits for tomorrow's email ("Held for this email");
//   Away mode holds it     → held, counted for the catch-up (Away.js);
//   quiet hours            → (notif_quiet_start–notif_quiet_end, 21:00–07:00) into the email,
//                            except travel, leaving home and act-now;
//   the daily cap          → (notif_daily_cap, 6) past it, into the email; check-ins and act-now
//                            don't count against it;
//   otherwise              → sent, and counted.
// A day's counts become "Yesterday: 5 pushes · 2 check-ins · 3 held for the email" in the
// nightly #vera-logs summary, which replaces the old per-nudge "Reminder sent" lines.
//
// Movement replaces the desk break, water break and free-calendar-block nudges: one rule at
// movement_times (10:30, 13:30, 15:30) inside work_hours, at most movement_daily_cap (3) a
// day, workdays only, never on a holiday, PTO or while away. VERA can't see work meetings,
// so it runs on a schedule.
// ============================================================

var NOTIF_KINDS_ = {
  gym_checkin: 'checkin', evening_mobility: 'checkin', morning_checkin: 'checkin',
  weekly_trend_review: 'read', monthly_review: 'read', weekend_memo: 'read', health_performance_insight: 'read',
};
// Their home is the morning email unless you choose otherwise (#250, "one home per kind").
var NOTIF_EMAIL_DEFAULT_ = ['flag_medium', 'flag_low', 'vehicle_renewals', 'contract_expiry', 'coupon_expiry', 'home_service',
  'travel_docs', 'career_cert_expiry', 'pto_strategy', 'quarterly_checkin', 'goal_checkin', 'growth_nudge', 'daily_discovery', 'usps_mail'];
// Through quiet hours and past the cap: travel, leaving home, and decisions with a clock on them.
var NOTIF_ALWAYS_ = ['travel_day_briefing', 'pretrip_briefing', 'leave_home', 'aria_book_now', 'act_now_vera'];
// System messages are never gated: they're how you'd find out the gate broke something.
var NOTIF_SYSTEM_ = ['nightly_log', 'error_alerts', 'watchdog_slack', 'watchdog_flag', 'watchdog_email', 'morning_briefing'];
var NOTIF_DIGEST_MAX_ = 40;

function notifKind_(key) { return NOTIF_KINDS_[key] || (String(key).indexOf('act_now_') === 0 ? 'act' : 'push'); }

/** Pure: where a kind goes, from its Config values. → 'slack' | 'email' | 'off' */
function notifDeliveryFrom_(key, cfg) {
  cfg = cfg || {};
  var v = String(cfg['notif_' + key + '_delivery'] || '').trim().toLowerCase();
  var kind = notifKind_(key);
  if (String(cfg['notif_' + key + '_enabled'] || '').toUpperCase() === 'FALSE') return 'off';
  if (v === 'off') return 'off';
  if (kind === 'checkin') return 'slack';                       // a reply needs Slack
  if (kind === 'read') return 'email';                          // a long read is an email
  if (v === 'slack' || v === 'email') return v;
  return NOTIF_EMAIL_DEFAULT_.indexOf(key) !== -1 ? 'email' : 'slack';
}
function notifDelivery_(key) { var cfg = {}; try { cfg = getConfigValues() || {}; } catch (e) {} return notifDeliveryFrom_(key, cfg); }

/** Pure: minutes past midnight for 'HH:mm', else the fallback. */
function notifMinutes_(s, fallback) {
  var m = String(s || '').trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return fallback;
  var h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : fallback;
}

/** Pure: is this minute of the day inside quiet hours (which may run past midnight)? */
function notifQuietAt_(minute, cfg) {
  var a = notifMinutes_((cfg || {}).notif_quiet_start, 21 * 60), b = notifMinutes_((cfg || {}).notif_quiet_end, 7 * 60);
  if (a === b) return false;
  return a < b ? (minute >= a && minute < b) : (minute >= a || minute < b);
}

/** Pure: the daily cap (1–50), 6 by default. */
function notifCap_(cfg) { var n = parseInt((cfg || {}).notif_daily_cap, 10); return n >= 1 && n <= 50 ? n : 6; }

/**
 * Pure: the decision for one push. st: { delivery, kind, away (bool: Away holds it),
 * quiet (bool), pushed (today's count), cap }. → 'send' | 'digest' | 'skip', with why.
 */
function notifDecide_(key, st) {
  if (NOTIF_SYSTEM_.indexOf(key) !== -1) return { go: 'send', why: 'system' };
  if (st.delivery === 'off') return { go: 'skip', why: 'off' };
  if (st.kind === 'read') return { go: 'send', why: 'read' };
  if (st.delivery === 'email') return { go: 'digest', why: 'email' };
  if (st.away) return { go: 'skip', why: 'away' };
  var always = NOTIF_ALWAYS_.indexOf(key) !== -1 || st.kind === 'act';
  if (st.kind === 'checkin') return { go: 'send', why: 'checkin' };
  if (st.quiet && !always) return { go: 'digest', why: 'quiet' };
  if (!always && st.pushed >= st.cap) return { go: 'digest', why: 'cap' };
  return { go: 'send', why: always ? 'always' : 'push' };
}

// ---- the day's counts and the email's waiting list ---------------------------------

function notifToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/** The counts, rolled over at the first touch of a new day. → { day, counts, yesterday } */
function notifCounts_() {
  var st = {}; try { st = veraStateGet_('NOTIF'); } catch (e) { st = {}; }
  var today = notifToday_(), counts = {}, yest = {};
  try { counts = JSON.parse(st.NOTIF_COUNTS || '{}') || {}; } catch (e) { counts = {}; }
  try { yest = JSON.parse(st.NOTIF_YESTERDAY || '{}') || {}; } catch (e) { yest = {}; }
  if (st.NOTIF_DAY && st.NOTIF_DAY !== today) {
    yest = counts; yest.day = st.NOTIF_DAY; counts = {};
    try { veraStateSet_('NOTIF', { NOTIF_DAY: today, NOTIF_COUNTS: '{}', NOTIF_YESTERDAY: JSON.stringify(yest) }); } catch (e) {}
  } else if (!st.NOTIF_DAY) {
    try { veraStateSet_('NOTIF', { NOTIF_DAY: today }); } catch (e) {}
  }
  return { day: today, counts: counts, yesterday: yest };
}
function notifBump_(what) {
  try {
    var c = notifCounts_().counts; c[what] = (c[what] || 0) + 1;
    veraStateSet_('NOTIF', { NOTIF_DAY: notifToday_(), NOTIF_COUNTS: JSON.stringify(c) });
  } catch (e) {}
}

/** Adds a line to tomorrow's email. Never throws. */
function notifHold_(key, text) {
  try {
    var st = veraStateGet_('NOTIF'), list = [];
    try { list = JSON.parse(st.NOTIF_DIGEST || '[]') || []; } catch (e) { list = []; }
    var line = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!line || list.some(function(x) { return x.key === key && x.text === line; })) return;
    list.push({ key: key, text: line, at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEE h:mm a') });
    if (list.length > NOTIF_DIGEST_MAX_) list = list.slice(-NOTIF_DIGEST_MAX_);
    veraStateSet_('NOTIF', { NOTIF_DIGEST: JSON.stringify(list) });
    notifBump_('held');
  } catch (e) { Logger.log('notifHold_ (non-fatal): ' + e.message); }
}
function notifHeldList_() { try { return JSON.parse(veraStateGet_('NOTIF').NOTIF_DIGEST || '[]') || []; } catch (e) { return []; } }
function notifHeldClear_() { try { veraStateSet_('NOTIF', { NOTIF_DIGEST: null }); } catch (e) {} }

/** Pure: the morning email's "Held for this email" section, grouped by kind. '' when empty. */
function notifHeldHtml_(list, labels) {
  if (!list || !list.length) return '';
  var esc = function(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var html = '<div style="margin:0 0 24px;padding:16px 18px;background:#f7f7fa;border-radius:8px;">' +
    '<p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#0d1b3e;letter-spacing:1px;text-transform:uppercase;">📨 Held for this email</p>';
  list.forEach(function(x) {
    html += '<p style="margin:0 0 6px;font-size:13px;color:#333333;line-height:1.45;"><span style="color:#888888;">' + esc((labels && labels[x.key]) || x.key) + ' · ' + esc(x.at || '') + '</span><br>' + esc(x.text) + '</p>';
  });
  return html + '</div>';
}
function notifHeldHtmlNow_() {
  try {
    var labels = {}; (NOTIF_REGISTRY || []).forEach(function(r) { labels[r.key] = r.emoji + ' ' + r.label; });
    return notifHeldHtml_(notifHeldList_(), labels);
  } catch (e) { return ''; }
}

/** Pure: "Yesterday: 5 pushes · 2 check-ins · 1 email read · 3 held for the morning email". */
function notifCountLine_(y) {
  y = y || {};
  var parts = [], pl = function(n, a, b) { return n + ' ' + (n === 1 ? a : b); };
  if (y.push) parts.push(pl(y.push, 'push', 'pushes'));
  if (y.checkin) parts.push(pl(y.checkin, 'check-in', 'check-ins'));
  if (y.act) parts.push(pl(y.act, 'act-now', 'act-nows'));
  if (y.read) parts.push(pl(y.read, 'email read', 'email reads'));
  if (y.held) parts.push(y.held + ' held for the morning email');
  if (y.off) parts.push(y.off + ' switched off');
  return 'Yesterday: ' + (parts.length ? parts.join(' · ') : 'nothing sent');
}

/**
 * The gate. Returns true when the caller should send now; otherwise it has already done
 * the right thing (held for the email, counted for Away, or nothing). text is what the
 * email shows if it's held. Never throws: a broken gate sends, rather than silencing VERA.
 */
function notifGate_(key, text, due) {
  try {
    var cfg = getConfigValues() || {};
    var now = new Date();
    var minute = parseInt(Utilities.formatDate(now, Session.getScriptTimeZone(), 'H'), 10) * 60 + parseInt(Utilities.formatDate(now, Session.getScriptTimeZone(), 'm'), 10);
    var kind = notifKind_(key), delivery = notifDeliveryFrom_(key, cfg);
    var away = delivery !== 'off' && kind !== 'read' && NOTIF_SYSTEM_.indexOf(key) === -1 && delivery !== 'email' && typeof awayHolds_ === 'function' ? awayHolds_(key, due) : false;
    var d = notifDecide_(key, { delivery: delivery, kind: kind, away: away, quiet: notifQuietAt_(minute, cfg), pushed: notifCounts_().counts.push || 0, cap: notifCap_(cfg) });
    if (d.go === 'digest') { notifHold_(key, text); return false; }
    if (d.go === 'skip') { if (d.why === 'off') notifBump_('off'); return false; }
    if (d.why !== 'system') notifBump_(kind === 'checkin' ? 'checkin' : kind === 'read' ? 'read' : kind === 'act' ? 'act' : 'push');
    return true;
  } catch (e) { Logger.log('notifGate_ (sent anyway): ' + e.message); return true; }
}

// ---- Movement: one rule on a schedule (replaces desk break, water, calendar window) ---------

/** Pure: the movement times ('10:30, 13:30, 15:30'), as minutes, inside work hours. */
function moveTimes_(cfg) {
  cfg = cfg || {};
  var hours = String(cfg.work_hours || '9:00-17:00').split(/\s*[-–]\s*/);
  var a = notifMinutes_(hours[0], 9 * 60), b = notifMinutes_(hours[1], 17 * 60);
  var list = String(cfg.movement_times || '10:30, 13:30, 15:30').split(/[,;\s]+/).map(function(t) { return notifMinutes_(t, -1); })
    .filter(function(m) { return m >= a && m < b; }).sort(function(x, y) { return x - y; });
  var cap = parseInt(cfg.movement_daily_cap, 10); cap = cap >= 0 && cap <= 12 ? cap : 3;
  return list.slice(0, cap);
}

/**
 * Pure: the movement nudge due now, if any. minute: now; sent: the slot minutes already
 * sent today; off: a weekend, holiday, PTO day or Away. A slot is due from its time until
 * the next slot (so an hourly run that lands at :41 still catches 10:30). → the slot, or -1.
 */
function moveDue_(minute, times, sent, off) {
  if (off) return -1;
  for (var i = times.length - 1; i >= 0; i--) {
    if (minute >= times[i]) {
      var until = i + 1 < times.length ? times[i + 1] : times[i] + 120;
      return minute < until && (sent || []).indexOf(times[i]) === -1 ? times[i] : -1;
    }
  }
  return -1;
}

/** Today a day off? Weekend, a holiday or PTO in the work calendar (PTO.js), or Away. */
function moveDayOff_(now) {
  var dow = now.getDay();
  if (dow === 0 || dow === 6) return true;
  try { if (typeof awayStatus_ === 'function' && awayStatus_().on) return true; } catch (e) {}
  var iso = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  try { if (typeof ptsVerizonHolidays_ === 'function' && ptsVerizonHolidays_(now.getFullYear())[iso]) return true; } catch (e) {}
  // PTO from the work calendar: read once a day, not every hour.
  var st = {}; try { st = veraStateGet_('NOTIF'); } catch (e) {}
  try { var c = JSON.parse(st.NOTIF_OFF || '{}'); if (c.day === iso) return !!c.off; } catch (e) {}
  var off = false;
  try { off = movePtoOn_((getPTOEvents_(readPTOConfig_()) || {}).events, iso); } catch (e) { off = false; }
  try { veraStateSet_('NOTIF', { NOTIF_OFF: JSON.stringify({ day: iso, off: off }) }); } catch (e) {}
  return off;
}

/** Pure: is a day inside any PTO block? events: [{startDate, endDate}] */
function movePtoOn_(events, iso) {
  return (events || []).some(function(e) { var s = String(e.startDate || '').slice(0, 10), en = String(e.endDate || s).slice(0, 10); return !!s && s <= iso && iso <= en; });
}

/** From hourlyCheck: the movement nudge, when one is due. */
function checkMovement_(now, cfg) {
  cfg = cfg || {};
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var minute = parseInt(Utilities.formatDate(now, tz, 'H'), 10) * 60 + parseInt(Utilities.formatDate(now, tz, 'm'), 10);
  var st = {}; try { st = veraStateGet_('NOTIF'); } catch (e) {}
  var sent = []; try { var mv = JSON.parse(st.NOTIF_MOVE || '{}'); sent = mv.day === today ? (mv.sent || []) : []; } catch (e) { sent = []; }
  var slot = moveDue_(minute, moveTimes_(cfg), sent, moveDayOff_(now));
  if (slot === -1) return false;
  try { veraStateSet_('NOTIF', { NOTIF_MOVE: JSON.stringify({ day: today, sent: sent.concat([slot]) }) }); } catch (e) {}
  sendNudge_('movement_' + today + '_' + slot, 'Movement',
    '🚶 Time to move: 5 minutes standing or walking, and a glass of water. Your back and focus will thank you.', 'movement');
  return true;
}

// ---- Check-in times (minutes, not just hours) ---------------------------------

/** Pure: today's check-in time for a kind, in minutes. weekend: a Saturday or Sunday. */
function checkinAt_(which, cfg, weekend) {
  cfg = cfg || {};
  if (which === 'morning') {
    if (weekend) return notifMinutes_(cfg.morning_checkin_weekend_time, 8 * 60 + 30);
    var oldH = parseInt(cfg.wellness_checkin_hour, 10);
    return notifMinutes_(cfg.morning_checkin_time, oldH >= 0 && oldH < 24 ? oldH * 60 : 6 * 60 + 30);
  }
  var oldE = parseInt(cfg.mobility_reminder_hour, 10);
  return notifMinutes_(cfg.evening_checkin_time, oldE >= 0 && oldE < 24 ? oldE * 60 : 20 * 60);
}

/** Pure: due now? From its time for the next two hours (the check-in tick runs every 15 minutes). */
function checkinDue_(minute, at) { return minute >= at && minute < at + 120; }

// ---- #vera-act-now: a decision with a clock on it ------------------------------------
// A post here must expire, be yours to decide, and move forward in one tap. VERA's own are
// its decision deadlines: a return window, a card perk or a contract's notice date ending
// within 2 days. Each item posts once; Done and Later use the flag buttons (Slack.js).
// Each assistant has a daily cap (act_now_cap_aria, act_now_cap_vera, 3 by default); past
// it, the item waits for the morning email.

var ACT_NOW_DECISIONS_ = ['PPURCH|return|', 'perk_expiry_', 'contract_expiry_'];

/** Pure: an assistant's daily act-now cap (0–20), 3 by default. */
function actNowCap_(cfg, who) { var n = parseInt((cfg || {})['act_now_cap_' + who], 10); return n >= 0 && n <= 20 ? n : 3; }

/** May this assistant post one more today? Counts it when it may. */
function actNowAllowed_(who) {
  var cfg = {}; try { cfg = getConfigValues() || {}; } catch (e) {}
  var c = notifCounts_().counts, k = 'act_' + who;
  if ((c[k] || 0) >= actNowCap_(cfg, who)) return false;
  notifBump_(k);
  return true;
}

/**
 * Pure: the open flags that are VERA decisions ending soon, not posted yet.
 * rows: Flags tab rows (FLAG_HEADERS); posted: keys already posted. → [{id, key, title, reason, due}]
 */
function actNowVeraPicks_(rows, today, posted) {
  var soon = (function() { var p = today.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 2)); return d.toISOString().slice(0, 10); })();
  return (rows || []).filter(function(r) {
    var key = String(r[9] || ''), due = String(r[11] instanceof Date ? r[11].toISOString() : r[11] || '').slice(0, 10);
    if (String(r[8]).toLowerCase() === 'yes' || String(r[6]).toLowerCase() === 'yes') return false;
    if (!ACT_NOW_DECISIONS_.some(function(p) { return key.indexOf(p) === 0; })) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < today || due > soon) return false;
    return (posted || []).indexOf(key + '|' + due) === -1;
  }).map(function(r) {
    return { id: String(r[0]), key: String(r[9]), title: String(r[3] || ''), reason: String(r[4] || ''), due: String(r[11] instanceof Date ? r[11].toISOString() : r[11]).slice(0, 10) };
  });
}

/** Pure: the Slack blocks for one act-now post: badge, deadline, title, why, Done / Later. */
function actNowBlocks_(who, item, n, cap, today) {
  var ends = item.due === today ? 'Ends today' : 'Ends ' + item.due;
  return [
    { type: 'context', elements: [{ type: 'mrkdwn', text: '*' + who + '*  ·  ⏳ ' + ends + '  ·  decision' }] },
    { type: 'section', text: { type: 'mrkdwn', text: '*' + item.title + '*' + (item.reason ? '\n' + item.reason : '') } },
    { type: 'actions', elements: [
      { type: 'button', text: { type: 'plain_text', text: '✓ Done' }, style: 'primary', action_id: 'acknowledge_flag', value: item.id },
      { type: 'button', text: { type: 'plain_text', text: 'Later' }, action_id: 'snooze_flag', value: item.id },
    ] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: who + ' · act-now ' + n + ' of ' + cap + ' today · ' + ends.toLowerCase() }] },
  ];
}

/** From hourlyCheck, 8 AM to 8 PM: VERA's decision deadlines to #vera-act-now. Never throws. */
function actNowVeraSync_(now) {
  try {
    var h = now.getHours();
    if (h < 8 || h >= 20) return 0;
    if (notifDelivery_('act_now_vera') === 'off' || !isSlackConfigured_()) return 0;
    var sheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
    if (!sheet || sheet.getLastRow() < 2) return 0;
    var today = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var st = veraStateGet_('NOTIF'), posted = [];
    try { posted = JSON.parse(st.NOTIF_ACTNOW || '[]') || []; } catch (e) { posted = []; }
    var picks = actNowVeraPicks_(sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.min(12, sheet.getLastColumn())).getValues(), today, posted);
    var cfg = getConfigValues() || {}, cap = actNowCap_(cfg, 'vera'), sent = 0;
    picks.forEach(function(p) {
      posted.push(p.key + '|' + p.due);
      if (typeof awayHolds_ === 'function' && awayHolds_('act_now_vera', p.due)) return;
      if (!actNowAllowed_('vera')) { notifHold_('act_now_vera', p.title + ' (ends ' + p.due + ')'); return; }
      var n = notifCounts_().counts.act_vera || 1;
      var chId = getSlackChannelId_(getNotifChannel_('act_now_vera'));
      if (chId && sendSlackMessage_(chId, '⏳ ' + p.title, actNowBlocks_('VERA', p, n, cap, today)).ok) { sent++; notifBump_('act'); }
    });
    veraStateSet_('NOTIF', { NOTIF_ACTNOW: JSON.stringify(posted.slice(-80)) });
    return sent;
  } catch (e) { Logger.log('actNowVeraSync_ (non-fatal): ' + e.message); return 0; }
}

/**
 * Every 15 minutes (it rides on the flight-status trigger, the only one that runs that
 * often): the morning and evening check-ins, so 6:30 means 6:30 and not 6:41. Each goes
 * once a day; hourlyCheck asks too, as a backstop. Never throws.
 */
function checkinTick_() {
  try {
    var cfg = getConfigValues() || {};
    if (String(cfg['reminders_enabled'] || 'true').toLowerCase() === 'false') return;
    var now = new Date();
    try { checkMorningWellnessCheckin_(now, now.getHours(), cfg); } catch (e) { Logger.log('checkinTick_ morning: ' + e.message); }
    try { checkEveningMobility_(now, now.getHours(), cfg); } catch (e) { Logger.log('checkinTick_ evening: ' + e.message); }
  } catch (e) { Logger.log('checkinTick_ (non-fatal): ' + e.message); }
}

// ---- HAILEY and TESS in #vera-act-now (read only, from their own sheets) -------------------
// HAILEY (Listings tab, Config roster_link_hailey): a listing first seen today and Under its
// cost ceiling, or a price cut made today. There's no score column, so the ceiling is the bar.
// TESS (Tracker tab, the TESS sheet Agent health reads): a New match found today scoring at
// least act_now_tess_min_score (85). Each posts once, with a link to open it. VERA never writes
// their sheets, so "Pass" stays in the assistant's own tools.

/** Pure: a header row → {lower-cased name: index}. */
function actNowCols_(head) { var m = {}; (head || []).forEach(function(h, i) { m[String(h || '').trim().toLowerCase()] = i; }); return m; }
function actNowIso_(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v || '').trim().slice(0, 10); }

/** Pure: HAILEY's posts for today. rows include the header. → [{key, title, reason, url, kind}] */
function actNowHaileyPicks_(rows, today, posted, iso) {
  iso = iso || actNowIso_;
  if (!rows || rows.length < 2) return [];
  var c = actNowCols_(rows[0]), out = [];
  var col = function(r, n) { var i = c[n]; return i === undefined ? '' : r[i]; };
  rows.slice(1).forEach(function(r) {
    var status = String(col(r, 'status')).trim().toLowerCase(), addr = String(col(r, 'address')).trim(), url = String(col(r, 'zillow url')).trim();
    if (!addr) return;
    var facts = [col(r, 'beds') && col(r, 'beds') + ' bd', col(r, 'baths') && col(r, 'baths') + ' ba', col(r, 'sqft') && col(r, 'sqft') + ' sqft', col(r, 'market')].filter(Boolean).join(' · ');
    if (status === 'new' && iso(col(r, 'first seen')) === today && /under/i.test(String(col(r, 'cost flag')))) {
      out.push({ key: 'hailey|new|' + (url || addr), kind: 'New listing under your ceiling', title: addr + ' · ' + String(col(r, 'price')),
        reason: 'About ' + String(col(r, 'est. monthly cost')) + ' a month, under your ceiling. ' + facts, url: url });
    }
    var cuts = String(col(r, 'notes')).match(/Price cut \$[\d,]+ on \d{4}-\d{2}-\d{2}/g) || [];
    var last = cuts.length ? cuts[cuts.length - 1] : '';
    if (status !== 'gone' && last && last.slice(-10) === today) {
      out.push({ key: 'hailey|cut|' + (url || addr) + '|' + today, kind: 'Price cut on a home HAILEY is watching', title: addr + ' · now ' + String(col(r, 'price')),
        reason: last.replace(/ on \d{4}-\d{2}-\d{2}$/, ' today') + '. About ' + String(col(r, 'est. monthly cost')) + ' a month (' + String(col(r, 'cost flag')).toLowerCase() + '). ' + facts, url: url });
    }
  });
  return out.filter(function(p) { return (posted || []).indexOf(p.key) === -1; });
}

/** Pure: TESS's posts for today: New, found today, score at least min. */
function actNowTessPicks_(rows, today, posted, min, iso) {
  iso = iso || actNowIso_;
  if (!rows || rows.length < 2) return [];
  var c = actNowCols_(rows[0]), out = [];
  var col = function(r, n) { var i = c[n]; return i === undefined ? '' : r[i]; };
  rows.slice(1).forEach(function(r) {
    var score = parseFloat(col(r, 'score'));
    if (String(col(r, 'status')).trim().toLowerCase() !== 'new' || iso(col(r, 'date found')) !== today || !(score >= min)) return;
    var url = String(col(r, 'job link')).trim(), co = String(col(r, 'company')).trim(), title = String(col(r, 'title')).trim();
    if (!co && !title) return;
    var bits = [String(col(r, 'salary range') || ''), col(r, 'track') ? 'Track: ' + col(r, 'track') : '', col(r, 'tier') ? 'Tier ' + col(r, 'tier') : ''].filter(Boolean);
    out.push({ key: 'tess|' + (url || co + '|' + title), kind: 'Strong new match · score ' + score, title: title + ' · ' + co, reason: bits.join(' · '), url: url });
  });
  return out.filter(function(p) { return (posted || []).indexOf(p.key) === -1; });
}

/** Pure: the Slack blocks for an assistant's post: badge, what it is, title, why, Open. */
function actNowAgentBlocks_(who, item, n, cap) {
  var blocks = [
    { type: 'context', elements: [{ type: 'mrkdwn', text: '*' + who + '*  ·  ⏳ today  ·  ' + item.kind }] },
    { type: 'section', text: { type: 'mrkdwn', text: '*' + item.title + '*' + (item.reason ? '\n' + item.reason : '') } },
  ];
  if (/^https:\/\//.test(item.url || '')) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open' }, style: 'primary', url: item.url, action_id: 'act_now_open' }] });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: who + ' · act-now ' + n + ' of ' + cap + ' today' }] });
  return blocks;
}

/** From hourlyCheck, 8 AM to 8 PM: HAILEY's and TESS's posts. Read only. Never throws. */
function actNowAgentsSync_(now) {
  try {
    var h = now.getHours();
    if (h < 8 || h >= 20 || !isSlackConfigured_()) return 0;
    var cfg = getConfigValues() || {}, today = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var st = veraStateGet_('NOTIF'), posted = [];
    try { posted = JSON.parse(st.NOTIF_ACTNOW || '[]') || []; } catch (e) { posted = []; }
    var min = parseFloat(cfg.act_now_tess_min_score); min = min > 0 && min <= 100 ? min : 85;
    var read = function(id, tab) {
      try { var sh = SpreadsheetApp.openById(id).getSheetByName(tab); return sh && sh.getLastRow() >= 2 ? sh.getRange(1, 1, Math.min(sh.getLastRow(), 600), sh.getLastColumn()).getValues() : []; }
      catch (e) { Logger.log('actNowAgentsSync_: ' + tab + ' unreadable — ' + e.message); return []; }
    };
    var tessSheet = cfg['career_' + 'alert_sheet_id'];   // the same TESS sheet Agent health reads
    var sources = [
      { who: 'HAILEY', key: 'act_now_hailey', cap: 'hailey', id: ariaSheetIdFrom_(cfg.roster_link_hailey), tab: 'Listings', pick: function(rows) { return actNowHaileyPicks_(rows, today, posted); } },
      { who: 'TESS', key: 'act_now_tess', cap: 'tess', id: ariaSheetIdFrom_(tessSheet), tab: 'Tracker', pick: function(rows) { return actNowTessPicks_(rows, today, posted, min); } },
    ];
    var sent = 0;
    sources.forEach(function(s) {
      if (!s.id || notifDelivery_(s.key) === 'off') return;
      s.pick(read(s.id, s.tab)).forEach(function(p) {
        posted.push(p.key);
        if (typeof awayHolds_ === 'function' && awayHolds_(s.key)) return;
        if (notifDelivery_(s.key) === 'email' || !actNowAllowed_(s.cap)) { notifHold_(s.key, s.who + ': ' + p.title); return; }
        var chId = getSlackChannelId_(getNotifChannel_(s.key));
        var n = notifCounts_().counts['act_' + s.cap] || 1;
        if (chId && sendSlackMessage_(chId, '⏳ ' + s.who + ': ' + p.title, actNowAgentBlocks_(s.who, p, n, actNowCap_(cfg, s.cap))).ok) { sent++; notifBump_('act'); }
      });
    });
    veraStateSet_('NOTIF', { NOTIF_ACTNOW: JSON.stringify(posted.slice(-150)) });
    return sent;
  } catch (e) { Logger.log('actNowAgentsSync_ (non-fatal): ' + e.message); return 0; }
}
