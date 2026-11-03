// ============================================================
// VERA — Cycle.js
// Family Planning › Trying › Cycle: a simple period tracker.
// ============================================================
//
// Either of you logs a period's start (and, if you like, its end). From the
// starts VERA works out the usual cycle and period length, then today's cycle
// day, the next period, the fertile window (ovulation ~14 days before the next
// period: 5 days before it through 1 day after, the 2 days up to it as the
// peak), and how late a period is.
//
// The card shows only while Family Planning is on Trying, and so do the
// reminders: period due soon, fertile window starting, peak days, and late.
// Each reminder goes once (by key) to the cycle_reminders channel, with a
// discreet subject. VERA never writes a calendar, and nothing here raises a
// Home flag.
//
// Config (all optional): cycle_due_lead_days (2), cycle_late_days (5),
// cycle_mood_days ("1:usually the hardest day|2:…|3:usually better|…").
//
//   cy*_      pure: stats, today's view, mood words, reminders
//   webCycle* the sheet reads and writes
// ============================================================

var CY_DEFAULT_CYCLE_ = 28;
var CY_DEFAULT_PERIOD_ = 5;
var CY_SAME_PERIOD_DAYS_ = 10;     // a second log this close to a start is the same period
var CY_MOOD_DEFAULT_ = '1:usually the hardest day|2:usually the hardest day|3:usually better|4:usually okay to good|5:usually okay to good';

// ---- pure: dates --------------------------------------------------------------

function cyYmd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  var t = String(v == null ? '' : v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
}
function cyMs_(ymd) { return Date.parse(ymd + 'T00:00:00Z'); }
function cyDays_(a, b) { return Math.round((cyMs_(b) - cyMs_(a)) / 864e5); }
function cyAdd_(ymd, n) { return new Date(cyMs_(ymd) + n * 864e5).toISOString().slice(0, 10); }
function cyNice_(ymd) {
  var d = new Date(cyMs_(ymd));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + d.getUTCDate();
}

// ---- pure: the cycle ----------------------------------------------------------

/**
 * From the log ([{start, end}], any order): average cycle (the last 6 gaps between starts,
 * ignoring ones under 15 or over 60 days; 28 until there's one), its range, and the average
 * period length (logged ends, 2–10 days; 5 until there's one).
 */
function cyStats_(log) {
  var starts = (log || []).map(function(r) { return r; }).filter(function(r) { return cyYmd_(r.start); })
    .sort(function(a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  var gaps = [];
  for (var i = 1; i < starts.length; i++) {
    var g = cyDays_(starts[i - 1].start, starts[i].start);
    if (g >= 15 && g <= 60) gaps.push(g);
  }
  gaps = gaps.slice(-6);
  var lens = starts.filter(function(r) { return cyYmd_(r.end); }).map(function(r) { return cyDays_(r.start, r.end) + 1; })
    .filter(function(n) { return n >= 2 && n <= 10; }).slice(-6);
  var avg = function(a) { return Math.round(a.reduce(function(s, x) { return s + x; }, 0) / a.length); };
  return {
    cycle: gaps.length ? avg(gaps) : CY_DEFAULT_CYCLE_,
    min: gaps.length ? Math.min.apply(null, gaps) : null,
    max: gaps.length ? Math.max.apply(null, gaps) : null,
    period: lens.length ? avg(lens) : CY_DEFAULT_PERIOD_,
    cycles: gaps.length,
    estimated: gaps.length < 2,
  };
}

/** "1:words|2:words" → {1: 'words', 2: 'words'}; the defaults when blank. */
function cyMood_(cfgValue) {
  var out = {};
  String(cfgValue || CY_MOOD_DEFAULT_).split('|').forEach(function(p) {
    var i = p.indexOf(':'); if (i === -1) return;
    var n = parseInt(p.slice(0, i), 10), w = p.slice(i + 1).trim();
    if (n > 0 && w) out[n] = w;
  });
  return out;
}

/**
 * Today in the cycle. last: the latest {start, end}; stats from cyStats_; mood from cyMood_.
 * → {day, phase: period|follicular|fertile|peak|luteal|late, mood, next, daysToNext, ovulation,
 *    fertileStart, fertileEnd, peakStart, peakEnd, lateBy, periodEnd}, or null with nothing logged.
 */
function cyToday_(last, stats, today, mood) {
  if (!last || !cyYmd_(last.start)) return null;
  var start = cyYmd_(last.start), day = cyDays_(start, today) + 1;
  if (day < 1) return null;
  var next = cyAdd_(start, stats.cycle), ovu = cyAdd_(next, -14);
  var pEnd = cyYmd_(last.end) || cyAdd_(start, stats.period - 1);
  var v = { day: day, start: start, next: next, daysToNext: cyDays_(today, next), ovulation: ovu,
    fertileStart: cyAdd_(ovu, -5), fertileEnd: cyAdd_(ovu, 1), peakStart: cyAdd_(ovu, -1), peakEnd: ovu,
    periodEnd: pEnd, lateBy: 0, mood: '' };
  if (today > next) { v.phase = 'late'; v.lateBy = cyDays_(next, today); }
  else if (today <= pEnd) { v.phase = 'period'; v.mood = (mood || {})[day] || ''; }
  else if (today >= v.peakStart && today <= v.peakEnd) v.phase = 'peak';
  else if (today >= v.fertileStart && today <= v.fertileEnd) v.phase = 'fertile';
  else v.phase = today < v.fertileStart ? 'follicular' : 'luteal';
  return v;
}

/**
 * The reminders due today, only while Trying: [{key, text}]. Each key names its date, so a
 * reminder already sent is never sent again.
 */
function cyNotices_(view, phase, today, cfg) {
  if (!view || phase !== 'trying') return [];
  cfg = cfg || {};
  var lead = Number(cfg.cycle_due_lead_days) || 2, late = Number(cfg.cycle_late_days) || 5, out = [];
  if (view.phase !== 'late' && view.daysToNext === lead) out.push({ key: 'cycle_due_' + view.next,
    text: '🌸 Cycle: next period expected in ' + lead + ' day' + (lead === 1 ? '' : 's') + ' (~' + cyNice_(view.next) + ').' + (cfg.mood && cfg.mood[1] ? ' Day 1 is ' + cfg.mood[1] + '.' : '') });
  if (today === view.fertileStart) out.push({ key: 'cycle_fertile_' + view.fertileStart,
    text: '🌿 Cycle: fertile window starts today, through ' + cyNice_(view.fertileEnd) + '. Peak ' + cyNice_(view.peakStart).slice(0, 3) + '–' + cyNice_(view.peakEnd).slice(0, 3) + '; ovulation estimated ~' + cyNice_(view.ovulation) + '.' });
  if (today === view.peakStart) out.push({ key: 'cycle_peak_' + view.peakStart,
    text: '🌿 Cycle: today and tomorrow are the peak fertile days (estimate).' });
  if (view.phase === 'late' && view.lateBy === late) out.push({ key: 'cycle_late_' + view.next,
    text: '🌸 Cycle: ' + late + ' days past the expected start (' + cyNice_(view.next) + '). If it began, log it in Family Planning.' });
  return out;
}

/** The log entry a new start belongs to: one within 10 days of it, else none. */
function cySamePeriod_(log, start) {
  return (log || []).filter(function(r) { return cyYmd_(r.start) && Math.abs(cyDays_(cyYmd_(r.start), start)) <= CY_SAME_PERIOD_DAYS_; })[0] || null;
}

// ---- sheet ----------------------------------------------------------------------

function cySheet_() { return ensureSheet(getSpreadsheet(), TABS.CYCLE_LOG, CYCLE_LOG_HEADERS); }

function cyRead_() {
  var sh = cySheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, CYCLE_LOG_HEADERS.length).getValues().filter(function(r) { return String(r[0]).trim(); })
    .map(function(r, i) { return { id: String(r[0]).trim(), start: cyYmd_(r[1]), end: cyYmd_(r[2]), by: String(r[3] || ''), at: String(r[4] || ''), notes: String(r[5] || ''), _row: i + 2 }; })
    .sort(function(a, b) { return a.start < b.start ? 1 : a.start > b.start ? -1 : 0; });
}

function cyLocked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function cyTodayYmd_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function cyCfg_() { var c = {}; try { c = getConfigValues() || {}; } catch (e) {} return c; }

function cyPhase_() { try { return fpReadSettings_().phase || 'plan'; } catch (e) { return 'plan'; } }

function cyWho_(v) { return v === 'Victoria' ? 'Victoria' : 'Ahmed'; }

// ---- routes ---------------------------------------------------------------------

/** GET cycle_get → {log (newest first), stats, view, phase, mood}. */
function webCycleGet_() {
  var log = cyRead_(), cfg = cyCfg_(), stats = cyStats_(log), mood = cyMood_(cfg.cycle_mood_days), today = cyTodayYmd_();
  return { ok: true, today: today, phase: cyPhase_(), stats: stats, view: cyToday_(log[0], stats, today, mood), mood: mood,
    log: log.map(function(r) { return { id: r.id, start: r.start, end: r.end, by: r.by, notes: r.notes }; }) };
}

/** POST cycle_log {start, end?, notes?, by}: a start within 10 days of one logged updates that one. */
function webCycleLog_(body) {
  var start = cyYmd_(body && body.start), end = cyYmd_(body && body.end);
  if (!start) return { ok: false, error: 'Which day did it start?' };
  if (start > cyTodayYmd_()) return { ok: false, error: 'That day hasn’t happened yet.' };
  if (end && end < start) return { ok: false, error: 'It can’t end before it starts.' };
  var notes = String((body && body.notes) || '').trim().slice(0, 200), by = cyWho_(body && body.by), now = new Date().toISOString();
  return cyLocked_(function() {
    var sh = cySheet_(), same = cySamePeriod_(cyRead_(), start);
    if (same) {
      sh.getRange(same._row, 2, 1, 5).setValues([[start, end || same.end || '', by, now, notes || same.notes || '']]);
      return { ok: true, id: same.id, merged: true };
    }
    var id = 'CY-' + Date.now();
    sh.appendRow([id, start, end || '', by, now, notes]);
    return { ok: true, id: id, merged: false };
  });
}

/** POST cycle_edit {id, start?, end?, notes?} (end '' clears it). */
function webCycleEdit_(body) {
  var id = String((body && body.id) || '').trim();
  return cyLocked_(function() {
    var r = cyRead_().filter(function(x) { return x.id === id; })[0];
    if (!r) return { ok: false, error: 'That entry is gone.' };
    var start = body.start !== undefined ? cyYmd_(body.start) : r.start, end = body.end !== undefined ? cyYmd_(body.end) : r.end;
    if (!start) return { ok: false, error: 'Which day did it start?' };
    if (end && end < start) return { ok: false, error: 'It can’t end before it starts.' };
    cySheet_().getRange(r._row, 2, 1, 5).setValues([[start, end || '', cyWho_(body.by), new Date().toISOString(), body.notes !== undefined ? String(body.notes).trim().slice(0, 200) : r.notes]]);
    return { ok: true };
  });
}

/** POST cycle_end {id?, end?, by}: ends the latest period (today unless given). */
function webCycleEnd_(body) {
  var log = cyRead_(), r = body && body.id ? log.filter(function(x) { return x.id === body.id; })[0] : log[0];
  if (!r) return { ok: false, error: 'Nothing logged yet.' };
  return webCycleEdit_({ id: r.id, end: cyYmd_(body && body.end) || cyTodayYmd_(), by: body && body.by });
}

/** POST cycle_delete {id}. */
function webCycleDelete_(body) {
  var id = String((body && body.id) || '').trim();
  return cyLocked_(function() {
    var r = cyRead_().filter(function(x) { return x.id === id; })[0];
    if (!r) return { ok: false, error: 'That entry is gone.' };
    cySheet_().deleteRow(r._row);
    return { ok: true };
  });
}

/** Nightly: the reminders due today, while Trying, each once. */
function cySyncReminders_() {
  var phase = cyPhase_();
  if (phase !== 'trying') return 'not trying';
  var log = cyRead_();
  if (!log.length) return 'nothing logged';
  var cfg = cyCfg_(), today = cyTodayYmd_(), stats = cyStats_(log), mood = cyMood_(cfg.cycle_mood_days);
  var due = cyNotices_(cyToday_(log[0], stats, today, mood), phase, today, { cycle_due_lead_days: cfg.cycle_due_lead_days, cycle_late_days: cfg.cycle_late_days, mood: mood }), sent = 0;
  due.forEach(function(n) {
    if (typeof wasRecentlySent_ === 'function' && wasRecentlySent_(n.key, 60 * 24 * 60)) return;
    sendNudge_(n.key, 'Cycle reminder', n.text, 'cycle_reminders');
    sent++;
  });
  return sent + ' reminder(s)';
}
