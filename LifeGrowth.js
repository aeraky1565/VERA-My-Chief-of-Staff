/**
 * LifeGrowth.js — Life › Growth (issue #222, stage 3).
 *
 * Goals      the Goals sheet, plus columns Focus (now | waiting | done), Rhythm ("3× a week"),
 *            Milestones (JSON) and Habit (the habit its practice is logged under). No more %.
 * Now        at most three goals, each with an 8-week practice strip.
 * Practice   is the Habits log (Habits.js): each goal has one habit, made the first time it is
 *            logged, so one record shows in Growth and in Habits' year grid. Minutes ride in the
 *            log's Notes ("30 min · …").
 * Learning   Books and Courses, each with a Goal column; a course's Kind is course, app or class.
 * Trials     the Experiments sheet: "try X for N weeks" on a goal, ending Keep / Change / Drop.
 * Review     Life balance (1–5 for six areas, a month at a time) and where last month's free
 *            evenings and weekends went (from the calendar).
 * Did it?    a calendar event yesterday whose title matches a goal asks the next morning; nothing
 *            is logged until you say yes.
 * Nudges     a weekly Slack nudge (growth_nudge) for a Now goal not practised in N days, with a
 *            free slot.
 */

var LG_GOAL_EXTRA_ = ['Focus', 'Rhythm', 'Milestones', 'Habit'];
var LG_FOCUS_ = ['now', 'waiting', 'done'];
var LG_NOW_MAX_ = 3;
var LG_WEEKS_ = 8;
var LG_KINDS_ = ['book', 'course', 'app', 'class'];
var LG_AREAS_ = ['health', 'relationships', 'career', 'money', 'growth', 'fun'];
var LG_BALANCE_TAB_ = 'Life Balance';
var LG_BALANCE_HEADERS_ = ['Month', 'Health', 'Relationships', 'Career', 'Money', 'Growth', 'Fun', 'Saved At'];
var LG_DIDIT_PROP_ = 'LG_DID_IT_ASKS';
var LG_TIME_PROP_ = 'LG_TIME_SNAPSHOTS';
var LG_BUCKETS_ = [
  { id: 'people', label: 'Friends & family', words: ['dinner', 'brunch', 'lunch', 'party', 'birthday', 'visit', 'drinks', 'coffee', 'bbq', 'game night', 'wedding', 'shower', 'celebration'] },
  { id: 'trips', label: 'Trips', words: ['trip', 'flight', 'hotel', 'travel', 'vacation', 'getaway'] },
  { id: 'home', label: 'Home & chores', words: ['clean', 'chore', 'laundry', 'groceries', 'grocery', 'repair', 'errand', 'appointment', 'dr:', 'dentist', 'oil change', 'contractor', 'delivery'] },
];

// ---- pure ------------------------------------------------------------------------------

/** Pure: how many times a week a rhythm asks for ("3× a week", "daily", "weekly", "twice a week"). */
function lgPerWeek_(rhythm) {
  var r = String(rhythm || '').toLowerCase().trim();
  if (!r) return 0;
  if (/\b(daily|every ?day)\b/.test(r)) return 7;
  if (/\btwice\b/.test(r)) return 2;
  if (/\bweekdays\b/.test(r)) return 5;
  var m = r.match(/(\d+)\s*(x|×|times)?\s*(a|per|\/)?\s*week/);
  if (m) return Math.max(1, Math.min(7, Number(m[1])));
  if (/\bweekly\b|\bonce a week\b|\ba week\b/.test(r)) return 1;
  m = r.match(/(\d+)\s*(x|×|times)?\s*(a|per|\/)?\s*month/);
  if (m) return Math.round(Number(m[1]) / 4.3 * 10) / 10;
  return 0;
}
/** Pure: a goal's focus from its stored value, or from its old status. */
function lgFocus_(stored, status) {
  var f = String(stored || '').toLowerCase();
  if (LG_FOCUS_.indexOf(f) !== -1) return f;
  if (status === 'Done') return 'done';
  if (status === 'Doing') return 'now';
  return 'waiting';
}
function lgMilestones_(raw) {
  var v; try { v = JSON.parse(String(raw || '[]')); } catch (e) { v = []; }
  return (Array.isArray(v) ? v : []).map(function(m) { return { text: lfStr_(m && m.text, 120), done: !!(m && m.done) }; }).filter(function(m) { return m.text; }).slice(0, 20);
}
/** Pure: minutes in a log note ("30 min · swim" → 30). */
function lgMinutes_(note) { var m = String(note || '').match(/(\d+)\s*min/); return m ? Number(m[1]) : 0; }
/** Pure: the Monday of a date's week. */
function lgMonday_(ymd) {
  var d = new Date(ymd + 'T12:00:00Z'), dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * 864e5).toISOString().slice(0, 10);
}
function lgAddDays_(ymd, n) { return new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10); }

/**
 * Pure: a goal's practice picture from its log entries.
 * @returns { weeks:[{start,count,met}], thisWeek, target, lastDate, daysSince, minutesYear, streak, practisedToday }
 */
function lgPractice_(entries, perWeek, today) {
  var days = {}, minutesYear = 0, y = today.slice(0, 4);
  (entries || []).forEach(function(e) {
    if (!e.date || e.date > today) return;
    days[e.date] = (days[e.date] || 0) + lgMinutes_(e.notes);
    if (e.date.slice(0, 4) === y) minutesYear += lgMinutes_(e.notes);
  });
  var mon = lgMonday_(today), weeks = [];
  for (var i = LG_WEEKS_ - 1; i >= 0; i--) {
    var start = lgAddDays_(mon, -7 * i), count = 0;
    for (var d = 0; d < 7; d++) if (days[lgAddDays_(start, d)] !== undefined) count++;
    weeks.push({ start: start, count: count, met: perWeek > 0 ? count >= perWeek : count > 0 });
  }
  var dates = Object.keys(days).sort(), last = dates.length ? dates[dates.length - 1] : '';
  // A streak is the run of weeks that met the rhythm, counting back from last week (this week is still open).
  var streak = 0;
  for (var k = weeks.length - 2; k >= 0 && weeks[k].met; k--) streak++;
  if (weeks[weeks.length - 1].met) streak++;
  return { weeks: weeks, thisWeek: weeks[weeks.length - 1].count, target: perWeek, lastDate: last,
    daysSince: last ? lfDays_(last, today) : null, minutesYear: minutesYear, streak: streak, practisedToday: days[today] !== undefined };
}

/** Pure: the reason a goal can't move to Now, or ''. */
function lgNowProblem_(goals, id) {
  var n = goals.filter(function(g) { return g.focus === 'now' && g.id !== id; }).length;
  return n >= LG_NOW_MAX_ ? 'Three goals are in Now already. Move one to Waiting first.' : '';
}

/** Pure: last year's unfinished goals, offered to carry over (December, and until each is answered). */
function lgCarryOver_(goals, today) {
  var y = Number(today.slice(0, 4)), dec = today.slice(5, 7) === '12';
  return goals.filter(function(g) { return g.focus !== 'done' && (g.year < y || (dec && g.year === y)); })
    .map(function(g) { return { id: g.id, title: g.title, year: g.year, toYear: g.year < y ? y : y + 1 }; });
}

/** Pure: a trial's state on a day: active (with check-ins so far), ended (asking Keep/Change/Drop), or decided. */
function lgTrialState_(t, entries, today) {
  var decided = /^(kept|changed|dropped)$/i.test(t.status || '');
  var checkins = (entries || []).filter(function(e) { return e.date >= t.start && e.date <= (t.end || today) && e.date <= today; }).length;
  var weeks = t.start && t.end ? Math.max(1, Math.round((lfDays_(t.start, t.end) + 1) / 7)) : null;
  var state = decided ? 'decided' : (t.end && today > t.end ? 'ended' : 'active');
  var daysLeft = t.end && state === 'active' ? lfDays_(today, t.end) : null;
  return { state: state, checkins: checkins, weeks: weeks, daysLeft: daysLeft };
}

/** Pure: Life balance — newest six months, and areas low (≤ 2) two months running. */
function lgBalance_(rows) {
  var list = (rows || []).filter(function(r) { return /^\d{4}-\d{2}$/.test(r.month); }).sort(function(a, b) { return a.month < b.month ? -1 : 1; });
  var last6 = list.slice(-6), low = [];
  if (list.length >= 2) {
    var a = list[list.length - 1], b = list[list.length - 2];
    LG_AREAS_.forEach(function(k) { if (a[k] && b[k] && a[k] <= 2 && b[k] <= 2) low.push(k); });
  }
  return { months: last6, low: low };
}
function lgCleanBalance_(raw) {
  raw = raw || {};
  var out = { month: /^\d{4}-\d{2}$/.test(String(raw.month || '')) ? String(raw.month) : '' };
  LG_AREAS_.forEach(function(k) { var n = Math.round(Number(raw[k])); out[k] = n >= 1 && n <= 5 ? n : null; });
  return out;
}
/** Pure: the month a Life balance rating is for — last month. */
function lgRateMonth_(today) {
  var y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  if (m === 0) { y--; m = 12; }
  return y + '-' + String(m).padStart(2, '0');
}

/**
 * Pure: where a month's free time went. Free time is weekday evenings 18:00–22:00 and weekend
 * days 09:00–21:00. Each event's overlap with free time goes to a bucket: goal practice when it
 * matches a Now goal's words, otherwise friends & family / trips / home & chores by its title;
 * events that match nothing are "other plans". What's left is unplanned. Hours, rounded.
 * @param {Array} events [{ title, start, end, allDay }] (ISO local times 'YYYY-MM-DDTHH:MM')
 * @param {Array} goalWords [[word, …] per Now goal]
 */
function lgTimeBuckets_(events, month, goalWords) {
  var y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  var daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate(), windows = [];
  for (var d = 1; d <= daysIn; d++) {
    var ymd = month + '-' + String(d).padStart(2, '0'), dow = new Date(ymd + 'T12:00:00Z').getUTCDay();
    var weekend = dow === 0 || dow === 6;
    windows.push({ day: ymd, from: weekend ? 9 * 60 : 18 * 60, to: weekend ? 21 * 60 : 22 * 60 });
  }
  var total = windows.reduce(function(n, w) { return n + (w.to - w.from); }, 0);
  var mins = { practice: 0, people: 0, trips: 0, home: 0, other: 0 };
  var taken = {};   // day -> [ [from,to] … ] so overlapping events aren't counted twice
  function bucketFor(title) {
    var t = String(title || '').toLowerCase();
    if ((goalWords || []).some(function(ws) { return ws.some(function(w) { return t.indexOf(w) !== -1; }); })) return 'practice';
    for (var i = 0; i < LG_BUCKETS_.length; i++) if (LG_BUCKETS_[i].words.some(function(w) { return t.indexOf(w) !== -1; })) return LG_BUCKETS_[i].id;
    return 'other';
  }
  (events || []).forEach(function(ev) {
    var b = bucketFor(ev.title);
    windows.forEach(function(w) {
      var s, e;
      if (ev.allDay) {
        var sd = String(ev.start).slice(0, 10), ed = String(ev.end || ev.start).slice(0, 10);   // end is exclusive for all-day
        if (!(w.day >= sd && (w.day < ed || (sd === ed && w.day === sd)))) return;
        if (b === 'other') return;   // an all-day marker that isn't a trip or a plan doesn't fill the evening
        s = w.from; e = w.to;
      } else {
        var es = String(ev.start), ee = String(ev.end || ev.start);
        if (es.slice(0, 10) > w.day || ee.slice(0, 10) < w.day) return;
        s = es.slice(0, 10) < w.day ? 0 : Number(es.slice(11, 13)) * 60 + Number(es.slice(14, 16));
        e = ee.slice(0, 10) > w.day ? 1440 : Number(ee.slice(11, 13)) * 60 + Number(ee.slice(14, 16));
      }
      s = Math.max(s, w.from); e = Math.min(e, w.to);
      if (e <= s) return;
      var used = taken[w.day] = taken[w.day] || [], add = 0, cur = s;
      used.sort(function(a, c) { return a[0] - c[0]; }).forEach(function(u) {
        if (u[1] <= cur || u[0] >= e) return;
        if (u[0] > cur) add += u[0] - cur;
        cur = Math.max(cur, u[1]);
      });
      if (cur < e) add += e - cur;
      used.push([s, e]);
      mins[b] += add;
    });
  });
  var planned = mins.practice + mins.people + mins.trips + mins.home + mins.other;
  var hrs = function(n) { return Math.round(n / 6) / 10; };
  return { month: month, freeHours: hrs(total), buckets: [
    { id: 'people', label: 'Friends & family', hours: hrs(mins.people) },
    { id: 'trips', label: 'Trips', hours: hrs(mins.trips) },
    { id: 'home', label: 'Home & chores', hours: hrs(mins.home) },
    { id: 'practice', label: 'Goal practice', hours: hrs(mins.practice) },
    { id: 'other', label: 'Other plans', hours: hrs(mins.other) },
    { id: 'unplanned', label: 'Unplanned', hours: hrs(Math.max(0, total - planned)) }] };
}

/** Pure: the words a goal is recognised by in calendar titles ("Swim twice a week" → swim). */
function lgGoalWords_(title) {
  var stop = ['learn', 'more', 'better', 'every', 'week', 'weekly', 'daily', 'twice', 'times', 'month', 'year', 'start', 'keep', 'get', 'back', 'into', 'with', 'my', 'the', 'and', 'for', 'to', 'a', 'an', 'of', 'in', 'on', 'at', 'be', 'do', 'go'];
  return lfNorm_(title).split(' ').filter(function(w) { return w.length >= 3 && stop.indexOf(w) === -1 && !/^\d+$/.test(w); });
}
/** Pure: yesterday's events that look like practice for a Now goal not already logged that day. */
function lgDidItAsks_(events, goals, logsByGoal, day) {
  var out = [];
  (goals || []).filter(function(g) { return g.focus === 'now'; }).forEach(function(g) {
    var words = lgGoalWords_(g.title);
    if (!words.length) return;
    if ((logsByGoal[g.id] || []).some(function(e) { return e.date === day; })) return;
    var ev = (events || []).filter(function(e) { var t = lfNorm_(e.title); return words.some(function(w) { return (' ' + t + ' ').indexOf(' ' + w) !== -1; }); })[0];
    if (ev) out.push({ goalId: g.id, goal: g.title, day: day, event: ev.title });
  });
  return out;
}

/**
 * Pure: the first free slot of at least `minutes` in the next 7 days — weekday evenings 18:00–21:00
 * or weekend days 09:00–18:00 — between busy intervals. Returns { day, from: 'HH:MM' } or null.
 */
function lgFreeSlot_(busy, fromYmd, minutes) {
  for (var i = 1; i <= 7; i++) {
    var day = lgAddDays_(fromYmd, i), dow = new Date(day + 'T12:00:00Z').getUTCDay(), we = dow === 0 || dow === 6;
    var lo = we ? 9 * 60 : 18 * 60, hi = we ? 18 * 60 : 21 * 60;
    var iv = (busy || []).filter(function(b) { return String(b.start).slice(0, 10) <= day && String(b.end).slice(0, 10) >= day; }).map(function(b) {
      var s = String(b.start).slice(0, 10) < day ? 0 : Number(String(b.start).slice(11, 13)) * 60 + Number(String(b.start).slice(14, 16));
      var e = String(b.end).slice(0, 10) > day ? 1440 : Number(String(b.end).slice(11, 13)) * 60 + Number(String(b.end).slice(14, 16));
      return [s, e];
    }).sort(function(a, b) { return a[0] - b[0]; });
    var cur = lo;
    for (var k = 0; k <= iv.length; k++) {
      var nextStart = k < iv.length ? iv[k][0] : hi;
      if (Math.min(nextStart, hi) - cur >= minutes) return { day: day, from: String(Math.floor(cur / 60)).padStart(2, '0') + ':' + String(cur % 60).padStart(2, '0') };
      if (k < iv.length) cur = Math.max(cur, iv[k][1]);
      if (cur >= hi) break;
    }
  }
  return null;
}

/** Pure: which Now goals are due a nudge — not practised in `days` (or never) — keyed once a week. */
function lgNudgesDue_(goals, practiceById, today, days) {
  var week = lgMonday_(today);
  return (goals || []).filter(function(g) { return g.focus === 'now'; }).filter(function(g) {
    var p = practiceById[g.id];
    return !p || p.daysSince === null || p.daysSince >= days;
  }).map(function(g) {
    var p = practiceById[g.id];
    return { goalId: g.id, title: g.title, key: 'growth_nudge_' + g.id + '_' + week, since: p && p.daysSince !== null ? p.daysSince : null };
  });
}

// ---- sheets ------------------------------------------------------------------------------

function lgGoalsSheet_() { return getSpreadsheet().getSheetByName(TABS.GOALS); }
/** Goals with Focus, Rhythm, Milestones and Habit read by header. */
function lgGoals_() {
  var base = getGoals_(), sh = lgGoalsSheet_(), extra = {};
  if (sh && sh.getLastRow() >= 2) {
    var cols = LG_GOAL_EXTRA_.map(function(h) { return lfCol_(sh, h, false); });
    var w = Math.max.apply(null, [1].concat(cols));
    sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues().forEach(function(r) {
      var id = String(r[0] || '').trim();
      if (!id) return;
      extra[id] = { focus: cols[0] ? r[cols[0] - 1] : '', rhythm: cols[1] ? r[cols[1] - 1] : '', milestones: cols[2] ? r[cols[2] - 1] : '', habit: cols[3] ? r[cols[3] - 1] : '' };
    });
  }
  return base.map(function(g) {
    var x = extra[g.id] || {};
    return { id: g.id, title: g.title, description: g.description, category: g.category, year: g.year, status: g.status, notes: g.notes,
      focus: lgFocus_(x.focus, g.status), rhythm: lfStr_(x.rhythm, 40), perWeek: lgPerWeek_(x.rhythm), milestones: lgMilestones_(x.milestones), habitId: lfStr_(x.habit, 60) };
  });
}
/** Writes a goal's extra columns, adding the headers the first time. */
function lfSetGoalExtra_(goalId, fields) {
  var sh = lgGoalsSheet_();
  if (!sh || sh.getLastRow() < 2) return null;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues(), row = -1;
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === goalId) { row = i + 2; break; }
  if (row === -1) return null;
  var map = { focus: 'Focus', rhythm: 'Rhythm', milestones: 'Milestones', habit: 'Habit' };
  Object.keys(map).forEach(function(k) {
    if (fields[k] === undefined) return;
    var v = k === 'milestones' ? JSON.stringify(lgMilestones_(JSON.stringify(fields[k]))) : String(fields[k]);
    sh.getRange(row, lfCol_(sh, map[k], true)).setValue(v);
  });
  // Keep the old Status in step, so the morning email and Monthly Review read the same goals.
  if (fields.focus !== undefined) updateGoal_(goalId, { status: fields.focus === 'now' ? 'Doing' : fields.focus === 'done' ? 'Done' : 'To Do' });
  return true;
}
/** The HabitLog, every year, dates normalised (a typed date can come back as a Date). */
function lgHabitLog_() {
  var sh = getSpreadsheet().getSheetByName(TABS.HABIT_LOG);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, HABIT_LOG_HEADERS.length).getValues().map(function(r, i) {
    return { id: String(r[0] || '').trim(), habitId: String(r[1] || '').trim(), date: lfYmd_(r[2]), notes: String(r[3] || '').trim(), row: i + 2 };
  }).filter(function(e) { return e.id && e.date; });
}
function lgLogsByGoal_(goals, log) {
  var byHabit = {}; (log || lgHabitLog_()).forEach(function(e) { (byHabit[e.habitId] = byHabit[e.habitId] || []).push(e); });
  var out = {}; goals.forEach(function(g) { out[g.id] = g.habitId ? (byHabit[g.habitId] || []) : []; });
  return out;
}
/** The goal's habit, made (and remembered on the goal) the first time it is needed. */
function lgEnsureHabit_(g) {
  if (g.habitId) return g.habitId;
  var res = addHabit_(g.title, g.rhythm || 'Weekly', '#8ab4f8', 'Growth goal ' + g.id);
  lfSetGoalExtra_(g.id, { habit: res.id });
  g.habitId = res.id;
  return res.id;
}
/** Logs practice on a goal for a day; a second log the same day adds its minutes to the first. */
function lgLogPractice_(goalId, day, minutes, note) {
  var g = lgGoals_().filter(function(x) { return x.id === goalId; })[0];
  if (!g) return { ok: false, error: 'That goal is gone' };
  var hid = lgEnsureHabit_(g), d = lfYmd_(day) || lfToday_(), m = Math.max(0, Math.round(Number(minutes) || 0));
  var existing = lgHabitLog_().filter(function(e) { return e.habitId === hid && e.date === d; })[0];
  var noteTxt = function(mins, extra) { return [mins ? mins + ' min' : '', extra || ''].filter(Boolean).join(' · '); };
  if (existing) {
    var total = lgMinutes_(existing.notes) + m, rest = String(existing.notes).replace(/^\d+\s*min\s*(·\s*)?/, '');
    var merged = noteTxt(total, [rest, lfStr_(note, 120)].filter(Boolean).join('; '));
    getSpreadsheet().getSheetByName(TABS.HABIT_LOG).getRange(existing.row, 4).setValue(merged);
    return { ok: true, goal: g.title, day: d, minutes: total, logId: existing.id, added: false };
  }
  var res = logHabitCompletion_(hid, d, noteTxt(m, lfStr_(note, 120)));
  return { ok: true, goal: g.title, day: d, minutes: m, logId: res.id, added: true, habitId: hid };
}

// Learning: Books and Courses, with a Goal column (and a Kind column on Courses).
function lgLearning_() {
  var ss = getSpreadsheet(), out = [];
  [[TABS.BOOKS, 'book'], [TABS.COURSES, 'course']].forEach(function(t) {
    var sh = ss.getSheetByName(t[0]);
    if (!sh || sh.getLastRow() < 2) return;
    var w = sh.getLastColumn(), hdr = sh.getRange(1, 1, 1, w).getValues()[0].map(function(x) { return String(x).trim().toLowerCase(); });
    var col = function(n) { return hdr.indexOf(n); };
    sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues().forEach(function(r) {
      var id = String(r[0] || '').trim();
      if (!id) return;
      var kind = t[1] === 'book' ? 'book' : (LG_KINDS_.indexOf(String(r[col('kind')] || '').toLowerCase()) !== -1 ? String(r[col('kind')]).toLowerCase() : 'course');
      out.push({ id: id, kind: kind, person: String(r[col('person')] || ''), title: String(r[col('title')] || ''),
        by: String(r[col(t[1] === 'book' ? 'author' : 'source')] || ''), status: String(r[col('status')] || ''),
        goalId: col('goal') !== -1 ? String(r[col('goal')] || '') : '' });
    });
  });
  return out.filter(function(x) { return x.title && (!x.person || x.person === 'Ahmed'); });
}
/** Pure: a learning item as the dashboard sent it. */
function lgCleanLearning_(raw) {
  raw = raw || {};
  var kind = LG_KINDS_.indexOf(String(raw.kind || '').toLowerCase()) !== -1 ? String(raw.kind).toLowerCase() : 'course';
  var st = String(raw.status || '').trim();
  return { id: lfStr_(raw.id, 40), kind: kind, title: lfStr_(raw.title, 120), by: lfStr_(raw.by, 120), goalId: lfStr_(raw.goalId, 40),
    status: ['Want', 'In Progress', 'Done'].indexOf(st) !== -1 ? st : 'In Progress' };
}
function lgSaveLearning_(item) {
  var x = lgCleanLearning_(item);
  if (!x.title) return { ok: false, error: 'What is it called?' };
  var ss = getSpreadsheet(), book = x.kind === 'book';
  var sh = book ? ensureSheet(ss, TABS.BOOKS, BOOK_HEADERS) : ensureSheet(ss, TABS.COURSES, COURSE_HEADERS);
  var gc = lfCol_(sh, 'Goal', true), kc = book ? 0 : lfCol_(sh, 'Kind', true), row = -1;
  if (x.id && sh.getLastRow() >= 2) {
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === x.id) { row = i + 2; break; }
    if (row === -1) return { ok: false, error: 'That item is gone' };
  }
  var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function(h) { return String(h).trim().toLowerCase(); });
  var set = function(r, name, v) { var c = hdr.indexOf(name); if (c !== -1) sh.getRange(r, c + 1).setValue(v); };
  if (row === -1) {
    x.id = lfMint_(book ? 'BOOK-' : 'COURSE-');
    var blank = hdr.map(function() { return ''; });
    sh.appendRow(blank);
    row = sh.getLastRow();
    set(row, 'id', x.id); set(row, 'person', 'Ahmed');
  }
  set(row, 'title', x.title); set(row, book ? 'author' : 'source', x.by); set(row, 'status', x.status);
  sh.getRange(row, gc).setValue(x.goalId);
  if (kc) sh.getRange(row, kc).setValue(x.kind);
  return { ok: true, item: x };
}

// Trials: the Experiments sheet, with a Goal column.
function lgTrials_() {
  var sh = getSpreadsheet().getSheetByName(TABS.EXPERIMENTS);
  if (!sh || sh.getLastRow() < 2) return [];
  var gc = lfCol_(sh, 'Goal', false), w = Math.max(EXPERIMENT_HEADERS.length, gc);
  return sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues().filter(function(r) { return String(r[0]).trim(); }).map(function(r, i) {
    return { id: String(r[0]).trim(), person: String(r[1] || ''), title: String(r[2] || ''), category: String(r[3] || ''), hypothesis: String(r[4] || ''),
      start: lfYmd_(r[5]), end: lfYmd_(r[6]), status: String(r[7] || ''), outcome: String(r[8] || ''), notes: String(r[9] || ''), goalId: gc ? String(r[gc - 1] || '') : '', row: i + 2 };
  });
}

// Calendar: Ahmed's calendars and the joint one (Config life_calendars, or every calendar
// except skipped ones, the work calendar and VERA's own). Read only.
function lgCalendars_() {
  var cfg = {}; try { cfg = getConfigValues() || {}; } catch (e) {}
  var want = String(cfg['life_calendars'] || '').split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
  var skip = String(cfg['skip_calendars'] || '').split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
  var work = String(cfg['calendar_name'] || 'Verizon Calendar').toLowerCase(), vera = String(cfg['vera_calendar'] || 'Vera').toLowerCase();
  return CalendarApp.getAllCalendars().filter(function(c) {
    var n = c.getName().toLowerCase();
    if (want.length) return want.indexOf(n) !== -1;
    return skip.indexOf(n) === -1 && n !== work && n !== vera;
  });
}
/** Events between two dates as plain objects. */
function lgEvents_(from, to) {
  var tz = Session.getScriptTimeZone(), me = ''; try { me = Session.getEffectiveUser().getEmail().toLowerCase(); } catch (e) {}
  var out = [];
  lgCalendars_().forEach(function(cal) {
    var evs = []; try { evs = cal.getEvents(from, to); } catch (e) { return; }
    evs.forEach(function(ev) {
      var all = ev.isAllDayEvent(), s = all ? ev.getAllDayStartDate() : ev.getStartTime(), e = all ? ev.getAllDayEndDate() : ev.getEndTime();
      var guests = 0; try { guests = ev.getGuestList().length; } catch (x) {}
      var creators = []; try { creators = ev.getCreators().map(function(c) { return String(c).toLowerCase(); }); } catch (x) {}
      var rec = false; try { rec = ev.isRecurringEvent(); } catch (x) {}
      out.push({ id: ev.getId(), title: ev.getTitle() || '', allDay: all, calendar: cal.getName(),
        start: Utilities.formatDate(s, tz, "yyyy-MM-dd'T'HH:mm"), end: Utilities.formatDate(e, tz, "yyyy-MM-dd'T'HH:mm"),
        location: ev.getLocation() || '', guests: guests, recurring: rec, mine: !!me && creators.indexOf(me) !== -1, description: String(ev.getDescription() || '').slice(0, 600) });
    });
  });
  return out;
}

// ---- routes --------------------------------------------------------------------------------

/** GET life_growth → goals with practice, carry-over, Did it? asks, learning, trials. */
function webLifeGrowth_() {
  var today = lfToday_(), goals = lgGoals_(), log = lgHabitLog_(), by = lgLogsByGoal_(goals, log);
  var thisYear = Number(today.slice(0, 4));
  goals.forEach(function(g) { g.practice = lgPractice_(by[g.id], g.perWeek, today); });
  var trials = lgTrials_().map(function(t) {
    var s = lgTrialState_(t, by[t.goalId] || [], today);
    return Object.assign({}, t, s, { goal: (goals.filter(function(g) { return g.id === t.goalId; })[0] || {}).title || '' });
  });
  var asks = lgDidItGet_().filter(function(a) { return goals.some(function(g) { return g.id === a.goalId && g.focus === 'now'; }); });
  return { ok: true, today: today, goals: goals.filter(function(g) { return g.year >= thisYear - 1 || g.focus !== 'done'; }),
    carryOver: lgCarryOver_(goals, today), didIt: asks, learning: lgLearning_(), trials: trials };
}
/** POST life_goal_save { goal } */
function webLifeGoalSave_(body) {
  var raw = (body && body.goal) || {}, title = lfStr_(raw.title, 120);
  return lfLocked_(function() {
    var goals = lgGoals_(), id = lfStr_(raw.id, 40), g = id ? goals.filter(function(x) { return x.id === id; })[0] : null;
    if (id && !g) return { ok: false, error: 'That goal is gone' };
    var focus = raw.focus !== undefined ? lgFocus_(raw.focus, '') : (g ? g.focus : 'waiting');
    if (focus === 'now' && (!g || g.focus !== 'now')) { var why = lgNowProblem_(goals, id); if (why) return { ok: false, error: why }; }
    if (!g) {
      if (!title) return { ok: false, error: 'Name the goal' };
      var made = createGoal_(title, lfStr_(raw.description, 400), 'To Do', lfStr_(raw.category, 40) || 'Growth', Number(raw.year) || new Date().getFullYear(), '');
      id = made.id;
    } else {
      var f = {};
      if (title) f.title = title;
      if (raw.description !== undefined) f.description = lfStr_(raw.description, 400);
      if (raw.category !== undefined) f.category = lfStr_(raw.category, 40);
      if (raw.year !== undefined && Number(raw.year)) f.year = Number(raw.year);
      if (Object.keys(f).length) updateGoal_(id, f);
    }
    lfSetGoalExtra_(id, { focus: focus, rhythm: raw.rhythm !== undefined ? lfStr_(raw.rhythm, 40) : (g ? g.rhythm : ''), milestones: raw.milestones !== undefined ? raw.milestones : (g ? g.milestones : []) });
    return { ok: true, id: id, focus: focus };
  });
}
/** POST life_goal_carry { id, carry } — carry an unfinished goal into the new year, or let it go. */
function webLifeGoalCarry_(body) {
  var id = lfStr_(body && body.id, 40), today = lfToday_(), y = Number(today.slice(0, 4));
  return lfLocked_(function() {
    var g = lgGoals_().filter(function(x) { return x.id === id; })[0];
    if (!g) return { ok: false, error: 'That goal is gone' };
    if (body.carry) { updateGoal_(id, { year: g.year < y ? y : y + 1 }); return { ok: true, carried: true }; }
    updateGoal_(id, { status: 'Parked' }); lfSetGoalExtra_(id, { focus: 'done' });
    return { ok: true, carried: false };
  });
}
/** POST life_practice_log { goalId, day, minutes, note } / life_practice_undo { goalId, day } */
function webLifePracticeLog_(body) {
  return lfLocked_(function() { return lgLogPractice_(lfStr_(body && body.goalId, 40), body && body.day, body && body.minutes, body && body.note); });
}
function webLifePracticeUndo_(body) {
  var g = lgGoals_().filter(function(x) { return x.id === lfStr_(body && body.goalId, 40); })[0];
  if (!g || !g.habitId) return { ok: false, error: 'Nothing to undo' };
  var log = lgHabitLog_().filter(function(e) { return e.habitId === g.habitId && e.date === lfYmd_(body.day); })[0];
  if (!log) return { ok: true };
  getSpreadsheet().getSheetByName(TABS.HABIT_LOG).deleteRow(log.row);
  return { ok: true };
}
/** POST life_learning_save { item } */
function webLifeLearningSave_(body) { return lfLocked_(function() { return lgSaveLearning_(body && body.item); }); }
/** POST life_trial_start { goalId, title, weeks, start } */
function webLifeTrialStart_(body) {
  var title = lfStr_(body && body.title, 120), weeks = Math.max(1, Math.min(26, Math.round(Number(body && body.weeks) || 4)));
  if (!title) return { ok: false, error: 'What are you trying?' };
  var start = lfYmd_(body && body.start) || lfToday_(), end = lgAddDays_(start, weeks * 7 - 1), goalId = lfStr_(body && body.goalId, 40);
  return lfLocked_(function() {
    var sh = ensureSheet(getSpreadsheet(), TABS.EXPERIMENTS, EXPERIMENT_HEADERS), gc = lfCol_(sh, 'Goal', true), id = lfMint_('TRIAL-');
    var row = [id, 'Ahmed', title, 'Growth', 'Try it for ' + weeks + ' week' + (weeks === 1 ? '' : 's'), start, end, 'Active', '', ''];
    sh.appendRow(row);
    sh.getRange(sh.getLastRow(), gc).setValue(goalId);
    return { ok: true, id: id, start: start, end: end, weeks: weeks };
  });
}
/** POST life_trial_decide { id, decision: keep|change|drop, note } */
function webLifeTrialDecide_(body) {
  var d = String((body && body.decision) || '').toLowerCase(), st = { keep: 'Kept', change: 'Changed', drop: 'Dropped' }[d];
  if (!st) return { ok: false, error: 'Keep it, change it or drop it?' };
  return lfLocked_(function() {
    var t = lgTrials_().filter(function(x) { return x.id === lfStr_(body.id, 40); })[0];
    if (!t) return { ok: false, error: 'That trial is gone' };
    var sh = getSpreadsheet().getSheetByName(TABS.EXPERIMENTS);
    sh.getRange(t.row, 8).setValue(st);
    sh.getRange(t.row, 9).setValue(lfStr_(body.note, 400) || st);
    return { ok: true, status: st };
  });
}
// Did it? — asked the morning after, from yesterday's calendar.
function lgDidItGet_() { try { var v = JSON.parse(PropertiesService.getScriptProperties().getProperty(LG_DIDIT_PROP_) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function lgDidItSet_(list) { PropertiesService.getScriptProperties().setProperty(LG_DIDIT_PROP_, JSON.stringify(list.slice(-20))); }
/** POST life_did_it { goalId, day, yes } */
function webLifeDidIt_(body) {
  var gid = lfStr_(body && body.goalId, 40), day = lfYmd_(body && body.day);
  return lfLocked_(function() {
    lgDidItSet_(lgDidItGet_().filter(function(a) { return !(a.goalId === gid && a.day === day); }));
    if (!body.yes) return { ok: true, logged: false };
    var r = lgLogPractice_(gid, day, body.minutes || 0, 'from the calendar');
    return r.ok ? { ok: true, logged: true, goal: r.goal } : r;
  });
}
/** GET life_review → Life balance and where last month's free time went. */
function webLifeReview_() {
  var today = lfToday_(), sh = getSpreadsheet().getSheetByName(LG_BALANCE_TAB_), rows = [];
  if (sh && sh.getLastRow() >= 2) rows = sh.getRange(2, 1, sh.getLastRow() - 1, LG_BALANCE_HEADERS_.length).getValues().map(function(r) {
    var o = { month: /^\d{4}-\d{2}/.test(String(r[0])) ? String(r[0]).slice(0, 7) : lfYmd_(r[0]).slice(0, 7) };
    LG_AREAS_.forEach(function(k, i) { o[k] = Number(r[i + 1]) || null; });
    return o;
  });
  var month = lgRateMonth_(today), snaps = {};
  try { snaps = JSON.parse(PropertiesService.getScriptProperties().getProperty(LG_TIME_PROP_) || '{}') || {}; } catch (e) {}
  var time = snaps[month] || null;
  if (!time) {
    try {
      var start = new Date(month + '-01T00:00:00'), end = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1);
      var nowGoals = lgGoals_().filter(function(g) { return g.focus === 'now'; }).map(function(g) { return lgGoalWords_(g.title); });
      time = lgTimeBuckets_(lgEvents_(start, end), month, nowGoals);
      snaps[month] = time;
      var keys = Object.keys(snaps).sort().slice(-12), keep = {}; keys.forEach(function(k) { keep[k] = snaps[k]; });
      PropertiesService.getScriptProperties().setProperty(LG_TIME_PROP_, JSON.stringify(keep));
    } catch (e) { time = null; }
  }
  var b = lgBalance_(rows);
  return { ok: true, today: today, rateMonth: month, rated: rows.some(function(r) { return r.month === month; }), balance: b.months, low: b.low, areas: LG_AREAS_, time: time };
}
/** POST life_balance_save { rating: { month, health, … } } */
function webLifeBalanceSave_(body) {
  var r = lgCleanBalance_(body && body.rating);
  if (!r.month) r.month = lgRateMonth_(lfToday_());
  if (LG_AREAS_.some(function(k) { return r[k] == null; })) return { ok: false, error: 'Rate all six, 1 to 5' };
  return lfLocked_(function() {
    var sh = ensureSheet(getSpreadsheet(), LG_BALANCE_TAB_, LG_BALANCE_HEADERS_), row = -1;
    if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function(x, i) { if (String(x[0]).slice(0, 7) === r.month) row = i + 2; });
    var out = [r.month].concat(LG_AREAS_.map(function(k) { return r[k]; })).concat([new Date().toISOString()]);
    if (row === -1) sh.appendRow(out); else sh.getRange(row, 1, 1, out.length).setValues([out]);
    return { ok: true, rating: r };
  });
}

// ---- nightly --------------------------------------------------------------------------------

/** Nightly: yesterday's "Did it?" asks, and the weekly nudge for a Now goal gone quiet. */
function lgNightly_() {
  var today = lfToday_(), yday = lgAddDays_(today, -1), goals = lgGoals_(), log = lgHabitLog_(), by = lgLogsByGoal_(goals, log);
  var now = goals.filter(function(g) { return g.focus === 'now'; });
  if (!now.length) return 'no Now goals';
  var evs = [];
  try { evs = lgEvents_(new Date(yday + 'T00:00:00'), new Date(today + 'T00:00:00')); } catch (e) {}
  var asks = lgDidItAsks_(evs, goals, by, yday);
  if (asks.length) {
    var have = lgDidItGet_(), keyOf = function(a) { return a.goalId + '|' + a.day; }, seen = {};
    have.forEach(function(a) { seen[keyOf(a)] = 1; });
    lgDidItSet_(have.filter(function(a) { return lfDays_(a.day, today) <= 3; }).concat(asks.filter(function(a) { return !seen[keyOf(a)]; })));
  }
  var cfg = {}; try { cfg = getConfigValues() || {}; } catch (e) {}
  var days = Number(cfg['growth_nudge_days']) || 7, practice = {};
  now.forEach(function(g) { practice[g.id] = lgPractice_(by[g.id], g.perWeek, today); });
  var due = lgNudgesDue_(goals, practice, today, days), sent = 0;
  if (due.length) {
    var busy = []; try { busy = lgEvents_(new Date(today + 'T00:00:00'), new Date(lgAddDays_(today, 8) + 'T00:00:00')); } catch (e) {}
    due.forEach(function(d) {
      if (typeof wasRecentlySent_ === 'function' && wasRecentlySent_(d.key, 60 * 24 * 8)) return;
      var slot = lgFreeSlot_(busy, today, 45);
      var msg = '🌱 ' + d.title + ': ' + (d.since === null ? 'no practice logged yet.' : 'last practised ' + d.since + ' days ago.') +
        (slot ? '\nA free slot: ' + slot.day + ' from ' + slot.from + '.' : '') + '\nLog it in VERA › Life › Now, or tell Chat ("did 30 min").';
      sendNudge_(d.key, 'Growth: ' + d.title, msg, 'growth_nudge');
      sent++;
    });
  }
  return asks.length + ' ask(s), ' + sent + ' nudge(s)';
}

// ---- Chat --------------------------------------------------------------------------------

/** Pure: the goal a name means — exact title first, then the one whose title contains it. */
function lgFindGoal_(goals, name) {
  var n = lfNorm_(name);
  if (!n) return null;
  var open = goals.filter(function(g) { return g.focus !== 'done'; });
  return open.filter(function(g) { return lfNorm_(g.title) === n; })[0] ||
    open.filter(function(g) { return lfNorm_(g.title).indexOf(n) !== -1 || n.indexOf(lfNorm_(g.title)) !== -1; })[0] ||
    open.filter(function(g) { return lgGoalWords_(g.title).some(function(w) { return n.split(' ').indexOf(w) !== -1; }); })[0] || null;
}
/** Chat: log_practice|{goal}|{minutes}|{note} */
function lgChatLogPractice_(args) {
  var g = lgFindGoal_(lgGoals_(), args[0]);
  if (!g) return { ok: false, error: 'No goal called "' + lfStr_(args[0], 60) + '"' };
  return lfLocked_(function() { return lgLogPractice_(g.id, lfToday_(), args[1], args[2]); });
}
/** Chat: add_learning|{book|course|app|class}|{title}|{goal} */
function lgChatAddLearning_(args) {
  var g = args[2] ? lgFindGoal_(lgGoals_(), args[2]) : null;
  return lfLocked_(function() { return lgSaveLearning_({ kind: args[0], title: args[1], goalId: g ? g.id : '' }); });
}
/** Chat: start_trial|{goal}|{what}|{weeks} */
function lgChatStartTrial_(args) {
  var g = args[0] ? lgFindGoal_(lgGoals_(), args[0]) : null;
  return webLifeTrialStart_({ goalId: g ? g.id : '', title: args[1], weeks: args[2] });
}
/** Chat context: Now goals and how practice is going. */
function lgContextLines_() {
  var today = lfToday_(), goals = lgGoals_(), by = lgLogsByGoal_(goals);
  return goals.filter(function(g) { return g.focus === 'now'; }).map(function(g) {
    var p = lgPractice_(by[g.id], g.perWeek, today);
    return g.title + (g.rhythm ? ' (' + g.rhythm + ')' : '') + ': ' + p.thisWeek + ' this week' + (p.lastDate ? ', last ' + p.lastDate : ', not practised yet');
  });
}
