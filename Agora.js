// ============================================================
// VERA — Agora.js
// AGORA, the teachers' lounge (Life › Learn › Lounge). The language teachers (ÉLISE for
// French, then GRETA and BEA) are outside apps; each keeps a Practice tab that #259
// already syncs into a Growth goal (PracticeLogs.js). The lounge only SHOWS practice:
// vocabulary, words and idioms stay in each teacher's app.
//
// ROSTER. The Config row practice_logs (one entry per teacher):
//   {"name":"ÉLISE","lang":"French","flag":"🇫🇷","app":"<link>","sheet":"<id>","tab":"Practice",
//    "goal":"GOAL-…","countries":["France",…]}   (countries optional: the language's own list)
// An entry with no sheet or goal is "coming soon": shown greyed out, never read or synced.
//
// PER TEACHER (GET agora, owner-only, cached 10 min):
//   - mood: proud (weekly target met) · today (practised today) · dozing (the gap since the
//     last lesson is longer than the target allows: ceil(7 / target) days, 3 with no target)
//     · waiting;
//   - this week (goal practice, lgPractice_), this month (lessons + minutes from her tab),
//     today's theme, her level (a `level` column in her Practice tab, latest row wins) and
//     the goal's target level (from the goal title, e.g. "(>B1)");
//   - a trip within 45 days to a country where her language is spoken (plPlanned_);
// and one free slot today (20+ min, 06:00–22:00, after now) for the teacher practised least.
// Also the last nightly sync (PRACTICE_LOG_LAST), for System › Checks.
// ============================================================

var AG_CACHE_KEY_ = 'agora_v1';
var AG_TRIP_DAYS_ = 45;
var AG_SLOT_MIN_ = 20, AG_SLOT_FROM_ = 6 * 60, AG_SLOT_TO_ = 22 * 60;
var AG_LANGS_ = {
  french:  { flag: '🇫🇷', countries: ['France', 'Belgium', 'Switzerland', 'Canada', 'Luxembourg', 'Monaco'] },
  german:  { flag: '🇩🇪', countries: ['Germany', 'Austria', 'Switzerland', 'Liechtenstein'] },
  italian: { flag: '🇮🇹', countries: ['Italy', 'Switzerland', 'San Marino'] },
  spanish: { flag: '🇪🇸', countries: ['Spain', 'Mexico', 'Argentina', 'Colombia', 'Peru', 'Chile'] },
};
var AG_LEVELS_ = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// ---- pure ------------------------------------------------------------------------------

/** Pure: the whole roster, coming-soon entries included. */
function agTeachers_(raw) {
  var list;
  try { list = JSON.parse(String(raw || '[]')); } catch (e) { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter(function(x) { return x && (x.name || x.sheet); }).map(function(x, i) {
    var lang = lfStr_(x.lang, 30), L = AG_LANGS_[lang.toLowerCase()] || {};
    var app = lfStr_(x.app, 400);
    var countries = Array.isArray(x.countries) ? x.countries.map(function(c) { return lfStr_(c, 40); }).filter(Boolean) : (L.countries || []);
    var sheet = lfStr_(x.sheet, 80), goal = lfStr_(x.goal, 40);
    return { key: 't' + i, name: lfStr_(x.name, 30) || ('Teacher ' + (i + 1)), lang: lang, flag: lfStr_(x.flag, 8) || L.flag || '🗣️',
      app: /^https:\/\//i.test(app) ? app : '', sheet: sheet, tab: lfStr_(x.tab, 60) || 'Practice', goal: goal,
      countries: countries, live: !!(sheet && goal) };
  });
}

/** Pure: a Practice tab (header first) → {rows:[{date, minutes, theme}], level}. Rows merged by date. */
function agRows_(values) {
  if (!values || values.length < 2) return { rows: [], level: '' };
  var hdr = values[0].map(function(h) { return String(h).trim().toLowerCase(); });
  var col = function(n) { return hdr.indexOf(n); };
  if (col('date') === -1) return { rows: [], level: '' };
  var by = {}, level = '', levelDate = '';
  values.slice(1).forEach(function(r) {
    var d = lfYmd_(r[col('date')]);
    if (!d) return;
    var m = col('minutes') === -1 ? 0 : Math.max(0, Math.round(Number(r[col('minutes')]) || 0));
    var theme = col('theme') === -1 ? '' : lfStr_(r[col('theme')], 80);
    var lv = col('level') === -1 ? '' : lfStr_(r[col('level')], 8).toUpperCase();
    if (lv && d >= levelDate) { level = lv; levelDate = d; }
    var p = by[d];
    by[d] = { date: d, minutes: (p ? p.minutes : 0) + m, theme: p && p.theme ? p.theme : theme };
  });
  return { rows: Object.keys(by).sort().map(function(d) { return by[d]; }), level: level };
}

/** Pure: the target level in a goal title, e.g. "Improve French fluency (>B1)" → "B1". */
function agTargetLevel_(title) {
  var m = String(title || '').toUpperCase().match(/\b[ABC][12]\b/g);
  return m ? m[m.length - 1] : '';
}

/** Pure: the mood. p: lgPractice_ result (or null); practisedToday from the live tab too. */
function agMood_(p, practisedToday, today) {
  var target = p && p.target > 0 ? p.target : 0;
  if (target && p.thisWeek >= target) return 'proud';
  if (practisedToday) return 'today';
  var allow = target ? Math.ceil(7 / target) : 3;
  var since = p && p.lastDate ? lfDays_(p.lastDate, today) : null;
  if (since === null || since > allow) return 'dozing';
  return 'waiting';
}

/** Pure: lessons and minutes in today's month. */
function agMonth_(rows, today) {
  var ym = String(today).slice(0, 7), out = { lessons: 0, minutes: 0 };
  (rows || []).forEach(function(r) { if (r.date.slice(0, 7) === ym && r.date <= today) { out.lessons++; out.minutes += r.minutes; } });
  return out;
}

/** Pure: the nearest trip (startDate within `days`) to one of her countries. planned: plPlanned_ rows. */
function agTripFor_(countries, planned, today, days) {
  var lc = (countries || []).map(function(c) { return String(c).toLowerCase(); }), best = null;
  (planned || []).forEach(function(p) {
    if (lc.indexOf(String(p.country || '').toLowerCase()) === -1) return;
    var d = lfDays_(today, p.startDate);
    if (d < 0 || d > days) return;
    if (!best || d < best.days) best = { tripKey: p.tripKey, label: p.label, startDate: p.startDate, country: p.country, days: d };
  });
  return best;
}

/** Pure: the next free gap of `minutes` today between lo and hi minutes, after nowMin. busy: [{start,end}] ISO. → {from, to, minutes} */
function agFreeToday_(busy, today, nowMin, minutes, lo, hi) {
  var start = Math.max(lo, Math.ceil(nowMin / 5) * 5);
  var iv = (busy || []).filter(function(b) { return String(b.start).slice(0, 10) <= today && String(b.end).slice(0, 10) >= today; }).map(function(b) {
    var s = String(b.start).slice(0, 10) < today ? 0 : Number(String(b.start).slice(11, 13)) * 60 + Number(String(b.start).slice(14, 16));
    var e = String(b.end).slice(0, 10) > today ? 1440 : Number(String(b.end).slice(11, 13)) * 60 + Number(String(b.end).slice(14, 16));
    return [s, e];
  }).sort(function(a, b) { return a[0] - b[0]; });
  var cur = start, hm = function(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  for (var k = 0; k <= iv.length; k++) {
    var next = k < iv.length ? Math.min(iv[k][0], hi) : hi;
    if (next - cur >= minutes) return { from: hm(cur), to: hm(next), minutes: next - cur };
    if (k < iv.length) cur = Math.max(cur, iv[k][1]);
    if (cur >= hi) break;
  }
  return null;
}

/** Pure: the live teacher practised least this week against her target, not done today. */
function agNeglected_(teachers) {
  var c = (teachers || []).filter(function(t) { return t.live && t.mood !== 'today' && t.mood !== 'proud'; });
  c.sort(function(a, b) {
    var ra = a.target ? a.thisWeek / a.target : a.thisWeek, rb = b.target ? b.thisWeek / b.target : b.thisWeek;
    return ra - rb || (b.daysSince || 0) - (a.daysSince || 0);
  });
  return c[0] || null;
}

// ---- read ------------------------------------------------------------------------------

/** The lounge. */
function agoraRead_() {
  var today = lfToday_(), roster = agTeachers_(veraSetting_('PRACTICE_LOGS'));
  var goals = []; try { goals = lgGoals_(); } catch (e) {}
  var by = {}; try { by = lgLogsByGoal_(goals, lgHabitLog_()); } catch (e) {}
  var planned = []; try { planned = plPlanned_(); } catch (e) {}
  var teachers = roster.map(function(t) {
    var out = { key: t.key, name: t.name, lang: t.lang, flag: t.flag, app: t.app, live: t.live,
      sheetUrl: t.sheet ? 'https://docs.google.com/spreadsheets/d/' + t.sheet + '/edit' : '' };
    if (!t.live) return out;
    var g = goals.filter(function(x) { return x.id === t.goal; })[0] || null;
    var p = g ? lgPractice_(by[g.id], g.perWeek, today) : null;
    var tab = { rows: [], level: '' }, unread = false;
    try { tab = agRows_(SpreadsheetApp.openById(t.sheet).getSheetByName(t.tab).getDataRange().getValues()); }
    catch (e) { unread = true; Logger.log('agoraRead_: could not read ' + t.name + '’s ' + t.tab + ' tab'); }
    var todayRow = tab.rows.filter(function(r) { return r.date === today; })[0] || null;
    var practisedToday = !!todayRow || !!(p && p.practisedToday);
    var last = [p && p.lastDate, tab.rows.length ? tab.rows[tab.rows.length - 1].date : ''].filter(function(x) { return x && x <= today; }).sort().pop() || '';
    var pp = p ? Object.assign({}, p, { lastDate: last || p.lastDate }) : (last ? { thisWeek: 0, target: 0, lastDate: last } : null);
    return Object.assign(out, {
      goalId: t.goal, goal: g ? g.title : '', goalFocus: g ? g.focus : '', unread: unread, nogoal: !g,
      thisWeek: p ? p.thisWeek : 0, target: p ? p.target : 0, week: p ? (p.weeks[p.weeks.length - 1] || {}) : {},
      lastDate: last, daysSince: last ? lfDays_(last, today) : null, practisedToday: practisedToday,
      theme: todayRow ? todayRow.theme : '', minutesToday: todayRow ? todayRow.minutes : 0,
      mood: agMood_(pp, practisedToday, today), month: agMonth_(tab.rows, today),
      level: tab.level, targetLevel: g ? agTargetLevel_(g.title) : '', trip: agTripFor_(t.countries, planned, today, AG_TRIP_DAYS_),
      days: tab.rows.filter(function(r) { return lfDays_(r.date, today) < 7 && r.date <= today; }).map(function(r) { return r.date; }) });
  });
  var slot = null, who = agNeglected_(teachers);
  if (who) {
    try {
      var busy = lgEvents_(new Date(today + 'T00:00:00'), new Date(plShift_(today, 1) + 'T00:00:00'));
      var now = new Date(), nowMin = Number(Utilities.formatDate(now, Session.getScriptTimeZone(), 'H')) * 60 + Number(Utilities.formatDate(now, Session.getScriptTimeZone(), 'm'));
      var s = agFreeToday_(busy, today, nowMin, AG_SLOT_MIN_, AG_SLOT_FROM_, AG_SLOT_TO_);
      if (s) slot = Object.assign({ teacher: who.key, name: who.name }, s);
    } catch (e) { Logger.log('agoraRead_: free slot: ' + e.message); }
  }
  var sync = null; try { sync = JSON.parse(veraStoreGet_('PRACTICE_LOG_LAST') || 'null'); } catch (e) {}
  return { ok: true, today: today, teachers: teachers, slot: slot, sync: sync, levels: AG_LEVELS_ };
}

/** GET agora[&refresh=1]: owner-only (each teacher's app link carries her own key). */
function webAgora_(p) {
  var deny = typeof peopleOwnerOnly_ === 'function' ? peopleOwnerOnly_() : null;
  if (deny) return deny;
  var cache = CacheService.getScriptCache();
  if (!(p && p.refresh)) { var hit = cache.get(AG_CACHE_KEY_); if (hit) { try { return JSON.parse(hit); } catch (e) {} } }
  var out = agoraRead_();
  try { cache.put(AG_CACHE_KEY_, JSON.stringify(out), 600); } catch (e) {}
  return out;
}
