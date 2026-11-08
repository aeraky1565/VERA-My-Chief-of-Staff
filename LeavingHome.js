// ============================================================
// VERA — LeavingHome.js
// Before you leave home (issue #231).
// ============================================================
//
// One template per home (Home Front › House › Leaving home), its items in groups:
//   Always · Summer (May–Sep) · Winter (Nov–Mar) · 3+ nights · 7+ nights ·
//   Only if nobody stays home
// Ahmed and Victoria can both edit it.
//
// Each trip gets "Before you head out", built from the home, the month you leave,
// the nights away and who's leaving (if someone stays, the empty-house items drop
// out). Ticks are shared by both dashboards and record who and when; one-off
// items can be added to one trip. "Heading out" starts the same list for any
// time away that isn't a trip.
//
// Reminders: a section in the night-before email, and a Slack / push message at
// the time set for heading out (on a trip it starts as 2 hours before the first
// flight, and can be changed), sent only if something is left.
//
// Sheets: "Leaving Home" (the templates) and "Leaving Home Runs" (one row per
// trip or time away, written the first time something is ticked, added or set).
//
// Two layers: lh*_ pure helpers, then the reads and the routes.
// ============================================================

var LH_GROUPS_ = [
  { id: 'always',  label: 'Always' },
  { id: 'summer',  label: 'Summer (May–Sep)' },
  { id: 'winter',  label: 'Winter (Nov–Mar)' },
  { id: 'nights3', label: '3+ nights' },
  { id: 'nights7', label: '7+ nights' },
  { id: 'empty',   label: 'Only if nobody stays home' },
];
var LH_HOME_DEFAULT_ = 'Our home';
var LH_SEED_ = [
  ['always', 'Take out the trash'], ['always', 'Empty the dehumidifier'], ['always', 'Check every door is locked'],
  ['always', 'Check the windows'], ['always', 'Turn off the fans'], ['always', 'Unplug the iron, hair tools and coffee maker'],
  ['summer', 'AC to 82°F (not off)'], ['summer', 'Close the blinds on the sunny side'],
  ['winter', 'Heat to 58°F (not off), so the pipes don’t freeze'], ['winter', 'Open the cabinet doors under the sinks'],
  ['nights3', 'Empty the fridge of anything that spoils'], ['nights3', 'Run and empty the dishwasher'],
  ['nights7', 'Hold the mail'], ['nights7', 'Water the plants or ask a neighbour'], ['nights7', 'Set the lights on timers'],
  ['empty', 'Turn off the water heater (or vacation mode)'], ['empty', 'Shut the main water valve'], ['empty', 'Set the alarm'],
];
var LH_WINDOW_MIN_ = 180;   // the morning message goes in the 3 hours after the time set

// Kind: trip, away, or checkout (PackPlus.js, #234: leave nothing behind).
// ---- pure ---------------------------------------------------------------------

function lhStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function lhSame_(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
function lhGroup_(v) { var g = String(v || '').toLowerCase(); return LH_GROUPS_.some(function(x) { return x.id === g; }) ? g : ''; }
function lhGroupLabel_(id) { return (LH_GROUPS_.filter(function(g) { return g.id === id; })[0] || { label: id }).label; }
function lhJson_(s, fallback) { try { var o = JSON.parse(String(s || '') || 'null'); return o == null ? fallback : o; } catch (e) { return fallback; } }

/** A local date-time 'yyyy-MM-ddTHH:mm', or ''. */
function lhAt_(v) {
  var m = String(v || '').trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/);
  if (!m) return '';
  var h = Number(m[2]), mi = Number(m[3]);
  if (h > 23 || mi > 59) return '';
  return m[1] + 'T' + (h < 10 ? '0' : '') + h + ':' + m[3];
}
/** A local date-time plus minutes (no time zone: both sides are local). */
function lhAddMin_(at, min) {
  var m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + min * 60000).toISOString().slice(0, 16);
}

/** When to head out for a trip: 2 hours before its first flight, else 8 AM on the first day. */
function lhDefaultLeave_(flight, startDate) {
  if (flight && flight.date && flight.time) { var t = lhAt_(flight.date + 'T' + flight.time); if (t) return lhAddMin_(t, -120); }
  return /^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '')) ? startDate + 'T08:00' : '';
}

/** Whether a group applies. ctx: {month 1–12, nights, empty}. */
function lhApplies_(group, ctx) {
  var m = Number(ctx.month) || 0, n = Number(ctx.nights) || 0;
  if (group === 'always') return true;
  if (group === 'summer') return m >= 5 && m <= 9;
  if (group === 'winter') return m >= 11 || (m >= 1 && m <= 3);
  if (group === 'nights3') return n >= 3;
  if (group === 'nights7') return n >= 7;
  if (group === 'empty') return !!ctx.empty;
  return false;
}

/** Whether the house is empty: everyone in the household is leaving. */
function lhEmpty_(household, leaving) {
  return (household || []).length > 0 && household.every(function(h) { return (leaving || []).some(function(l) { return lhSame_(l, h); }); });
}

/**
 * A run's list. template: [{id, home, group, item, order}]; run: {home, leaveAt, nights, leaving, ticks, oneOffs};
 * household: names. → {items:[{key, text, group, groupLabel, done, by, at, oneOff}], done, total, left, ctx}
 */
function lhList_(template, run, household) {
  var month = Number(String(run.leaveAt || '').slice(5, 7)) || 0;
  var ctx = { month: month, nights: Number(run.nights) || 0, empty: lhEmpty_(household, run.leaving) };
  var order = {}; LH_GROUPS_.forEach(function(g, i) { order[g.id] = i; });
  var ticks = run.ticks || {}, items = [];
  (template || []).filter(function(t) { return lhSame_(t.home, run.home) && lhApplies_(t.group, ctx); })
    .sort(function(a, b) { return (order[a.group] - order[b.group]) || ((a.order || 0) - (b.order || 0)); })
    .forEach(function(t) { var k = t.id, tk = ticks[k]; items.push({ key: k, text: t.item, group: t.group, groupLabel: lhGroupLabel_(t.group), done: !!tk, by: tk ? tk.by || '' : '', at: tk ? tk.at || '' : '', oneOff: false }); });
  (run.oneOffs || []).forEach(function(o) { var k = 'o:' + o.id, tk = ticks[k]; items.push({ key: k, text: o.text, group: 'oneoff', groupLabel: 'This trip only', done: !!tk, by: tk ? tk.by || '' : '', at: tk ? tk.at || '' : '', oneOff: true }); });
  var done = items.filter(function(i) { return i.done; }).length;
  return { items: items, done: done, total: items.length, left: items.length - done, ctx: ctx };
}

var LH_MONTHS_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var LH_DAYS_ = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Sat 7:40 AM" for a local date-time. */
function lhWhen_(at) {
  var m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return '';
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), h = +m[4], ap = h < 12 ? 'AM' : 'PM', h12 = h % 12 || 12;
  return LH_DAYS_[d.getUTCDay()] + ' ' + h12 + ':' + m[5] + ' ' + ap;
}

/** Why the list is what it is: "Our home · July, so the summer items · 8 nights, so the 3+ and 7+ items · nobody stays home. Leaving Sat 7:40 AM." */
function lhWhy_(run, ctx) {
  var bits = [run.home || LH_HOME_DEFAULT_];
  if (ctx.month) bits.push(LH_MONTHS_[ctx.month - 1] + (lhApplies_('summer', ctx) ? ', so the summer items' : lhApplies_('winter', ctx) ? ', so the winter items' : ''));
  var n = ctx.nights;
  bits.push(n + ' night' + (n === 1 ? '' : 's') + (n >= 7 ? ', so the 3+ and 7+ items' : n >= 3 ? ', so the 3+ items' : ''));
  bits.push(ctx.empty ? 'nobody stays home' : 'someone stays home, so the empty-house items are left out');
  var w = lhWhen_(run.leaveAt);
  return bits.join(' · ') + '.' + (w ? ' Leaving ' + w + '.' : '');
}

/** The morning message. */
function lhMessage_(list) {
  var left = list.items.filter(function(i) { return !i.done; });
  var names = left.slice(0, 4).map(function(i) { return i.text.charAt(0).toLowerCase() + i.text.slice(1); });
  return '🏠 Before you head out: ' + left.length + ' thing' + (left.length === 1 ? '' : 's') + ' left (' + names.join(', ') + (left.length > 4 ? ', and ' + (left.length - 4) + ' more' : '') + '). Tick them in VERA.';
}

/** Runs due a morning message now: leave time passed, within the window, not sent. */
function lhDue_(runs, now) {
  return (runs || []).filter(function(r) { return r.leaveAt && !r.sent && r.leaveAt <= now && now < lhAddMin_(r.leaveAt, LH_WINDOW_MIN_); });
}

function lhTemplateRows_(rows) {
  return (rows || []).filter(function(r) { return String(r[0] || '').trim() && String(r[3] || '').trim() && lhGroup_(r[2]); }).map(function(r) {
    return { id: String(r[0]).trim(), home: lhStr_(r[1], 60) || LH_HOME_DEFAULT_, group: lhGroup_(r[2]), item: lhStr_(r[3], 160), order: Number(r[4]) || 0, updated: String(r[5] || ''), by: lhStr_(r[6], 40) };
  });
}

function lhRunRows_(rows) {
  return (rows || []).map(function(r, i) { return [r, i]; }).filter(function(x) { return String(x[0][0] || '').trim(); }).map(function(x) {
    var r = x[0], i = x[1];
    return { id: String(r[0]).trim(), kind: String(r[1] || '') === 'away' ? 'away' : String(r[1] || '') === 'checkout' ? 'checkout' : 'trip', tripKey: String(r[2] || '').trim(), home: lhStr_(r[3], 60) || LH_HOME_DEFAULT_,
      leaveAt: lhAt_(r[4] instanceof Date ? Utilities.formatDate(r[4], Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm") : r[4]),
      nights: Math.max(0, Number(r[5]) || 0), leaving: String(r[6] || '').split(/\s*,\s*/).filter(String), ticks: lhJson_(r[7], {}) || {}, oneOffs: lhJson_(r[8], []) || [],
      sent: String(r[9] || ''), updated: String(r[10] || ''), _row: i + 2 };
  });
}

// ---- reads ----------------------------------------------------------------------

function lhTz_() { return Session.getScriptTimeZone(); }
function lhNow_() { return Utilities.formatDate(new Date(), lhTz_(), "yyyy-MM-dd'T'HH:mm"); }
function lhStamp_() { return Utilities.formatDate(new Date(), lhTz_(), 'yyyy-MM-dd HH:mm'); }
function lhLocked_(fn) { var l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }
function lhKeyMatch_(cell, tripKey) { return tripKeyMatches_(cell, tripKey); }   // Trips.js: the trip's current key or any it had
function lhHousehold_() {
  return [typeof TE_OWNER_ !== 'undefined' ? TE_OWNER_ : 'Ahmed', typeof TE_PARTNER_ !== 'undefined' ? TE_PARTNER_ : 'Victoria'];
}
function lhId_(p) { return p + new Date().getTime().toString(36) + Math.floor(Math.random() * 46656).toString(36); }

function lhTplSheet_() { return ensureSheet(getSpreadsheet(), TABS.LEAVE_HOME, LEAVE_HOME_HEADERS); }
function lhRunSheet_() { return ensureSheet(getSpreadsheet(), TABS.LEAVE_RUNS, LEAVE_RUN_HEADERS); }

/** The templates, seeding the starter list the first time the sheet is empty. */
function lhTemplate_(seed) {
  var sh = seed ? lhTplSheet_() : getSpreadsheet().getSheetByName(TABS.LEAVE_HOME);
  if (!sh) return [];
  if (sh.getLastRow() < 2 && seed) {
    var stamp = lhStamp_();
    sh.getRange(2, 1, LH_SEED_.length, LEAVE_HOME_HEADERS.length).setValues(LH_SEED_.map(function(s, i) { return ['LH-' + (i + 1), LH_HOME_DEFAULT_, s[0], s[1], i + 1, stamp, 'VERA']; }));
  }
  if (sh.getLastRow() < 2) return [];
  return lhTemplateRows_(sh.getRange(2, 1, sh.getLastRow() - 1, LEAVE_HOME_HEADERS.length).getValues());
}
function lhHomes_(template) {
  var homes = [];
  (template || []).forEach(function(t) { if (!homes.some(function(h) { return lhSame_(h, t.home); })) homes.push(t.home); });
  return homes.length ? homes : [LH_HOME_DEFAULT_];
}
function lhRuns_() {
  var sh = getSpreadsheet().getSheetByName(TABS.LEAVE_RUNS);
  if (!sh || sh.getLastRow() < 2) return [];
  return lhRunRows_(sh.getRange(2, 1, sh.getLastRow() - 1, LEAVE_RUN_HEADERS.length).getValues());
}

/** The first flight of a trip on the Itinerary sheet: {date, time}, or null. */
function lhFirstFlight_(tripKey) {
  var sh = getSpreadsheet().getSheetByName(TABS.ITINERARY);
  if (!sh || sh.getLastRow() < 2) return null;
  var tz = lhTz_(), best = null;
  sh.getRange(2, 1, sh.getLastRow() - 1, ITINERARY_HEADERS.length).getValues().forEach(function(r) {
    if (String(r[2] || '').toLowerCase() !== 'flight' || !lhKeyMatch_(r[1], tripKey)) return;
    var d = r[4] instanceof Date ? Utilities.formatDate(r[4], tz, 'yyyy-MM-dd') : String(r[4] || '').trim().slice(0, 10);
    var t = r[5] instanceof Date ? Utilities.formatDate(r[5], tz, 'HH:mm') : String(r[5] || '').trim();
    var tm = t.match(/^(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !tm) return;
    var h = Number(tm[1]) % (tm[3] ? 12 : 24) + (tm[3] && /p/i.test(tm[3]) ? 12 : 0);
    var hm = (h < 10 ? '0' : '') + h + ':' + tm[2];
    if (!best || d + hm < best.date + best.time) best = { date: d, time: hm };
  });
  return best;
}

function lhNights_(a, b) {
  var x = Date.parse(String(a || '') + 'T00:00:00Z'), y = Date.parse(String(b || '') + 'T00:00:00Z');
  return isFinite(x) && isFinite(y) && y > x ? Math.round((y - x) / 86400000) : 0;
}

/** A trip's run: its row if it has one, else the defaults (not written until something changes). */
function lhTripRun_(tripKey, startDate, endDate, runs, homes) {
  var row = (runs || lhRuns_()).filter(function(r) { return r.kind === 'trip' && lhKeyMatch_(r.tripKey, tripKey); })[0];
  if (row) { row.defaultLeave = false; return row; }
  var hh = lhHousehold_(), going = [];
  try { going = typeof teTravellersForKey_ === 'function' ? teTravellersForKey_(tripKey) : []; } catch (e) {}
  var leaving = going.length ? hh.filter(function(h) { return going.some(function(g) { return lhSame_(g, h); }); }) : hh.slice();
  return { id: '', kind: 'trip', tripKey: tripKey, home: (homes || [LH_HOME_DEFAULT_])[0], leaveAt: lhDefaultLeave_(lhFirstFlight_(tripKey), startDate),
    nights: lhNights_(startDate, endDate), leaving: leaving.length ? leaving : hh.slice(), ticks: {}, oneOffs: [], sent: '', defaultLeave: true };
}

function lhView_(run, template) {
  var hh = lhHousehold_(), list = lhList_(template, run, hh);
  return { ok: true, run: { id: run.id, kind: run.kind, tripKey: run.tripKey, home: run.home, leaveAt: run.leaveAt, nights: run.nights, leaving: run.leaving, empty: list.ctx.empty, sent: run.sent, defaultLeave: !!run.defaultLeave },
    items: list.items, done: list.done, total: list.total, left: list.left, why: lhWhy_(run, list.ctx), homes: lhHomes_(template), household: hh };
}

/** Writes a run (appending it the first time). */
function lhSaveRun_(run) {
  var sh = lhRunSheet_(), stamp = lhStamp_();
  var row = [run.id || lhId_(run.kind === 'away' ? 'AWAY-' : run.kind === 'checkout' ? 'OUT-' : 'TRIP-'), run.kind, run.tripKey || '', run.home, run.leaveAt, run.nights, (run.leaving || []).join(', '), JSON.stringify(run.ticks || {}), JSON.stringify(run.oneOffs || []), run.sent || '', stamp];
  if (run._row) sh.getRange(run._row, 1, 1, LEAVE_RUN_HEADERS.length).setValues([row]);
  else { sh.appendRow(row); run._row = sh.getLastRow(); }
  run.id = row[0];
  return run;
}

/** The run a POST names: {run: id} or {tripKey, startDate, endDate}. */
function lhFindRun_(body, runs, template) {
  if (body.run) return runs.filter(function(r) { return r.id === String(body.run); })[0] || null;
  var tripKey = lhStr_(body.tripKey, 200);
  return tripKey ? lhTripRun_(tripKey, lhStr_(body.startDate, 10), lhStr_(body.endDate, 10), runs, lhHomes_(template)) : null;
}

// ---- routes -----------------------------------------------------------------------

/** GET lh_get: the templates and the current away lists. */
function webLhGet_() {
  var template = lhTemplate_(true), now = lhNow_(), since = lhAddMin_(now, -36 * 60);
  var away = lhRuns_().filter(function(r) { return r.kind === 'away' && r.leaveAt >= since; }).map(function(r) { return lhView_(r, template); });
  return { ok: true, groups: LH_GROUPS_, homes: lhHomes_(template), template: template, away: away, household: lhHousehold_() };
}

/** POST lh_item_save {id?, home, group, item, by}. */
function webLhItemSave_(body) {
  body = body || {};
  var item = lhStr_(body.item, 160), group = lhGroup_(body.group), home = lhStr_(body.home, 60) || LH_HOME_DEFAULT_;
  if (!item) return { ok: false, error: 'Type what to do.' };
  if (!group) return { ok: false, error: 'Pick when it applies.' };
  return lhLocked_(function() {
    var sh = lhTplSheet_(), t = lhTemplate_(true), stamp = lhStamp_(), by = lhStr_(body.by, 40);
    var id = lhStr_(body.id, 40);
    if (id) {
      var ids = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1).getValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) {
        var old = t.filter(function(x) { return x.id === id; })[0];
        sh.getRange(i + 2, 1, 1, LEAVE_HOME_HEADERS.length).setValues([[id, home, group, item, old ? old.order : i + 1, stamp, by]]);
        return { ok: true, template: lhTemplate_(false), homes: lhHomes_(lhTemplate_(false)) };
      }
      return { ok: false, error: 'That item isn’t there any more.' };
    }
    var max = t.reduce(function(m, x) { return Math.max(m, x.order); }, 0);
    sh.appendRow([lhId_('LH-'), home, group, item, max + 1, stamp, by]);
    var fresh = lhTemplate_(false);
    return { ok: true, template: fresh, homes: lhHomes_(fresh) };
  });
}

/** POST lh_item_delete {id}. */
function webLhItemDelete_(body) {
  var id = lhStr_(body && body.id, 40);
  if (!id) return { ok: false, error: 'id required' };
  return lhLocked_(function() {
    var sh = getSpreadsheet().getSheetByName(TABS.LEAVE_HOME);
    if (sh && sh.getLastRow() >= 2) {
      var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]).trim() === id) sh.deleteRow(i + 2);
    }
    var fresh = lhTemplate_(false);
    return { ok: true, template: fresh, homes: lhHomes_(fresh) };
  });
}

/** GET lh_trip {tripKey, startDate, endDate}: the trip's "Before you head out". */
function webLhTrip_(p) {
  p = p || {};
  var tripKey = lhStr_(p.tripKey, 200);
  if (!tripKey) return { ok: false, error: 'tripKey required' };
  var template = lhTemplate_(true);
  return lhView_(lhTripRun_(tripKey, lhStr_(p.startDate, 10), lhStr_(p.endDate, 10) || lhStr_(p.startDate, 10), lhRuns_(), lhHomes_(template)), template);
}

/** POST lh_tick {run | tripKey+dates, key, done, by}: shared by both dashboards. */
function webLhTick_(body) {
  body = body || {};
  var key = lhStr_(body.key, 60);
  if (!key) return { ok: false, error: 'key required' };
  return lhLocked_(function() {
    var template = lhTemplate_(true), run = lhFindRun_(body, lhRuns_(), template);
    if (!run) return { ok: false, error: 'That list isn’t there any more.' };
    run.ticks = run.ticks || {};
    var on = body.done === true || body.done === 'true' || body.done === 1 || body.done === '1';
    if (on) run.ticks[key] = { by: lhStr_(body.by, 40), at: lhStamp_() }; else delete run.ticks[key];
    return lhView_(lhSaveRun_(run), template);
  });
}

/** POST lh_oneoff {run | tripKey+dates, text, by} adds; {remove: key} takes one away. */
function webLhOneOff_(body) {
  body = body || {};
  var text = lhStr_(body.text, 160), remove = lhStr_(body.remove, 60);
  if (!text && !remove) return { ok: false, error: 'Type the item to add.' };
  return lhLocked_(function() {
    var template = lhTemplate_(true), run = lhFindRun_(body, lhRuns_(), template);
    if (!run) return { ok: false, error: 'That list isn’t there any more.' };
    run.oneOffs = run.oneOffs || [];
    if (remove) { run.oneOffs = run.oneOffs.filter(function(o) { return 'o:' + o.id !== remove; }); if (run.ticks) delete run.ticks[remove]; }
    else run.oneOffs.push({ id: new Date().getTime().toString(36) + run.oneOffs.length, text: text, by: lhStr_(body.by, 40) });
    return lhView_(lhSaveRun_(run), template);
  });
}

/** POST lh_run_set {run | tripKey+dates, leaveAt?, home?, leaving?, nights?}. A new leave time sends again. */
function webLhRunSet_(body) {
  body = body || {};
  return lhLocked_(function() {
    var template = lhTemplate_(true), run = lhFindRun_(body, lhRuns_(), template);
    if (!run) return { ok: false, error: 'That list isn’t there any more.' };
    if (body.leaveAt !== undefined) {
      var at = lhAt_(body.leaveAt);
      if (!at) return { ok: false, error: 'Pick a date and time to head out.' };
      if (at !== run.leaveAt) run.sent = '';
      run.leaveAt = at;
    }
    if (body.home !== undefined) run.home = lhStr_(body.home, 60) || LH_HOME_DEFAULT_;
    if (Array.isArray(body.leaving)) run.leaving = body.leaving.map(function(x) { return lhStr_(x, 40); }).filter(String);
    if (body.nights !== undefined && run.kind === 'away') run.nights = Math.max(0, Math.min(365, Number(body.nights) || 0));
    if (!run.leaving.length) return { ok: false, error: 'Pick who’s leaving.' };
    return lhView_(lhSaveRun_(run), template);
  });
}

/** POST lh_away {leaveAt, nights, home, leaving, by}: "Heading out" for time away that isn't a trip. */
function webLhAway_(body) {
  body = body || {};
  var at = lhAt_(body.leaveAt);
  if (!at) return { ok: false, error: 'Pick when you’re leaving.' };
  var leaving = Array.isArray(body.leaving) ? body.leaving.map(function(x) { return lhStr_(x, 40); }).filter(String) : [];
  if (!leaving.length) return { ok: false, error: 'Pick who’s leaving.' };
  return lhLocked_(function() {
    var template = lhTemplate_(true);
    var run = { id: '', kind: 'away', tripKey: '', home: lhStr_(body.home, 60) || lhHomes_(template)[0], leaveAt: at, nights: Math.max(0, Math.min(365, Number(body.nights) || 0)), leaving: leaving, ticks: {}, oneOffs: [], sent: '' };
    return lhView_(lhSaveRun_(run), template);
  });
}

/** POST lh_away_delete {id}: removes a "Heading out" list. Trip lists stay. */
function webLhAwayDelete_(body) {
  var id = lhStr_(body && body.id, 40);
  if (!id) return { ok: false, error: 'id required' };
  return lhLocked_(function() {
    var runs = lhRuns_(), r = runs.filter(function(x) { return x.id === id && x.kind === 'away'; })[0];
    if (r) lhRunSheet_().deleteRow(r._row);
    return { ok: true };
  });
}

// ---- reminders ----------------------------------------------------------------------

/**
 * Every 15 minutes, from checkFlightStatuses_: at the time set for heading out, one
 * Slack / push message if anything is left. Cheap: it reads only the runs and the
 * trips starting today or tomorrow, and nothing else unless one is due.
 */
function lhMorningCheck_() {
  var now = lhNow_(), today = now.slice(0, 10), tomorrow = lhAddMin_(today + 'T00:00', 1440).slice(0, 10);
  var runs = lhRuns_(), cands = runs.filter(function(r) { return r.kind === 'away'; });
  var trips = [];
  try { trips = (readTripRegistry_().rows || []).filter(function(t) { return t.status !== 'cancelled' && (t.startDate === today || t.startDate === tomorrow); }); } catch (e) { trips = []; }
  if (!trips.length && !cands.length) return 0;
  var template = null, sent = 0;
  trips.forEach(function(t) {
    var key = t.startDate + '|' + t.label;
    var row = runs.filter(function(r) { return r.kind === 'trip' && lhKeyMatch_(r.tripKey, key); })[0];
    if (row) cands.push(row);
    else { template = template || lhTemplate_(true); cands.push(lhTripRun_(key, t.startDate, t.endDate || t.startDate, runs, lhHomes_(template))); }
  });
  var due = lhDue_(cands, now);
  if (!due.length) return 0;
  template = template || lhTemplate_(true);
  due.forEach(function(run) {
    lhLocked_(function() {
      var list = lhList_(template, run, lhHousehold_());
      if (list.left > 0) {
        try { sendNudge_('leave_home|' + (run.tripKey || run.id) + '|' + run.leaveAt, 'Before you head out', lhMessage_(list), 'leave_home'); sent++; }
        catch (e) { Logger.log('lhMorningCheck_: ' + e.message); return; }
      }
      run.sent = lhStamp_();
      lhSaveRun_(run);
    });
  });
  return sent;
}

/** The night-before email's section: {html, text}, or null when nothing is left. */
function lhEmailSection_(tripKey, startDate, endDate) {
  var template = lhTemplate_(true);
  var run = lhTripRun_(tripKey, startDate, endDate, lhRuns_(), lhHomes_(template));
  var list = lhList_(template, run, lhHousehold_());
  if (!list.total || !list.left) return null;
  var left = list.items.filter(function(i) { return !i.done; }), shown = left.slice(0, 7).map(function(i) { return i.text; });
  var more = left.length > 7 ? ' · and ' + (left.length - 7) + ' more' : '';
  var esc = typeof escapeHtml_ === 'function' ? escapeHtml_ : function(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var title = 'Before you leave home · ' + list.left + ' of ' + list.total + ' left';
  var w = lhWhen_(run.leaveAt);
  var html = '<p style="margin:0 0 6px;font-size:11px;color:#8a7a3a;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">\u{1F3E0} ' + esc(title) + '</p>' +
    '<p style="margin:0 0 4px;font-size:13px;color:#4b5563;line-height:1.6;">' + esc(shown.join(' · ') + more) + '</p>' +
    '<p style="margin:0;font-size:12px;color:#0f766e;">Open the trip in VERA to tick them off' + (w ? '. A reminder goes at ' + esc(w) + ' if any are left.' : '.') + '</p>';
  return { html: html, text: title.toUpperCase() + '\n' + left.map(function(i) { return '• ' + i.text; }).join('\n') };
}
