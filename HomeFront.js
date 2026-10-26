// ============================================================
// VERA — HomeFront.js
// Home Front additions (decided Oct 26): upkeep inside Chores.
// ============================================================
//
// UPKEEP. Chores on a long cadence (Quarterly, Semiannually, Annually, Seasonal)
// are tracked by date, not by a checkbox that clears on a calendar day: each one
// has a Last Done and, optionally, a Due By ("shut off the outdoor taps by
// Nov 15"). Next due = Due By when set, else Last Done + the cadence. ✓ Done
// logs today and moves Due By on by the cadence. resetChoresByCadence_ leaves
// these cadences alone.
//
// Overdue upkeep, or upkeep due within a week, raises a reminder from the
// nightly run (Config upkeep_reminders):
//   flag (default)  a Low flag keyed UPKEEP|<chore id>, resolved once done
//   task            a task in Tasks ("Upkeep: …", noted upkeep:<id>), marked Done once done
//   off             nothing
//
// Two layers, so the tests need no Google:
//   hfUpkeep*_ (pure)        state, the date maths, the reminders wanted
//   the web* and sync calls  the Chores sheet, Flags and Tasks
// ============================================================

var HF_UPKEEP_MONTHS_ = { Quarterly: 3, Semiannually: 6, Annually: 12, Seasonal: 12 };
var HF_UPKEEP_SOON_DAYS_ = 14;      // shown as "due soon" on the dashboard
var HF_UPKEEP_REMIND_DAYS_ = 7;     // a reminder is raised this close to the due date
var HF_FLAG_PREFIX_ = 'UPKEEP|';
var HF_TASK_NOTE_ = 'upkeep:';

// A common starter list: [chore, cadence, due-by month-day or ''].
var HF_UPKEEP_STARTER_ = [
  ['Replace HVAC filter', 'Quarterly', ''],
  ['Test smoke & CO alarms', 'Semiannually', ''],
  ['Shut off outdoor taps before the first frost', 'Seasonal', '11-15'],
  ['Clean the gutters', 'Seasonal', '11-30'],
  ['Furnace check before heating season', 'Seasonal', '10-01'],
  ['Check the sump pump', 'Seasonal', '03-01'],
  ['Turn the outdoor taps back on', 'Seasonal', '04-15'],
  ['AC service before summer', 'Seasonal', '05-15'],
];

function hfIsUpkeep_(cadence) { return Object.prototype.hasOwnProperty.call(HF_UPKEEP_MONTHS_, String(cadence || '')); }

/** Pure: 'yyyy-MM-dd' from a Date, an ISO string or a date string; '' otherwise. */
function hfYmd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  var m = String(v == null ? '' : v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

/** Pure: a date plus whole months, the day kept (or the month's last day). */
function hfAddMonths_(ymd, months) {
  var p = ymd.split('-').map(Number), y = p[0], mo = p[1] - 1 + months;
  y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
  var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(Math.min(p[2], last)).padStart(2, '0');
}

function hfDaysBetween_(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }

/**
 * Pure: an upkeep chore's state, or null for a routine chore. row: a Chores
 * object by header ('Cadence', 'Last Done', 'Due By', 'Checked', 'Checked At').
 * → {months, last, next, status: overdue | soon | ok | unset, days (next − today)}
 */
function hfUpkeepState_(row, today) {
  if (!row || !hfIsUpkeep_(row.Cadence)) return null;
  var months = HF_UPKEEP_MONTHS_[row.Cadence];
  var checked = row.Checked === true || String(row.Checked).toUpperCase() === 'TRUE';
  var last = hfYmd_(row['Last Done']) || (checked ? hfYmd_(row['Checked At']) : '');
  var dueBy = hfYmd_(row['Due By']);
  var next = dueBy || (last ? hfAddMonths_(last, months) : '');
  if (!next) return { months: months, last: last, next: '', status: 'unset', days: null };
  var days = hfDaysBetween_(today, next);
  return { months: months, last: last, next: next, days: days,
    status: days < 0 ? 'overdue' : days <= HF_UPKEEP_SOON_DAYS_ ? 'soon' : 'ok' };
}

/** Pure: the Due By after doing it today: moved on by the cadence until it is after today. '' stays ''. */
function hfNextDueBy_(dueBy, months, today) {
  if (!dueBy) return '';
  var d = hfAddMonths_(dueBy, months);
  for (var i = 0; d <= today && i < 40; i++) d = hfAddMonths_(d, months);
  return d;
}

/** Pure: the next date a month-day ('11-15') falls on, today counting. */
function hfNextMonthDay_(md, today) {
  var d = today.slice(0, 4) + '-' + md;
  return d >= today ? d : (Number(today.slice(0, 4)) + 1) + '-' + md;
}

/**
 * Pure: the reminders wanted: upkeep overdue, or due within a week.
 * → {'UPKEEP|<id>': {flag, reason, urgency, chore, next, id}}
 */
function hfUpkeepWanted_(chores, today) {
  var out = {};
  (chores || []).forEach(function(c) {
    var s = hfUpkeepState_(c, today);
    if (!s || s.status === 'unset' || s.days > HF_UPKEEP_REMIND_DAYS_) return;
    var name = String(c.Chore || '').trim(), id = String(c.ID || '').trim();
    if (!name || !id) return;
    out[HF_FLAG_PREFIX_ + id] = { id: id, chore: name, next: s.next, urgency: 'Low',
      flag: 'Upkeep: ' + name,
      reason: (s.days < 0 ? 'Overdue since ' + s.next : s.days === 0 ? 'Due today' : 'Due ' + s.next) + (s.last ? ' · last done ' + s.last : ' · not done yet') + '. Mark it done in Home Front → Chores.' };
  });
  return out;
}

// ---- the sheet -------------------------------------------------------------------

function hfChoresSheet_() { return tiSchema_(ensureSheet(getSpreadsheet(), TABS.CHORES, CHORES_HEADERS), CHORES_HEADERS); }

function hfToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/** Every chore as an object by header, upkeep ones with their state. */
function hfReadChores_(sheet, today) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var rows = sheet.getRange(1, 1, sheet.getLastRow(), CHORES_HEADERS.length).getValues();
  var out = [];
  rows.slice(1).forEach(function(r, i) {
    if (!String(r[0] || '').trim()) return;
    var o = { _row: i + 2 };
    CHORES_HEADERS.forEach(function(h, j) { o[h] = r[j] instanceof Date ? hfYmd_(r[j]) : r[j]; });
    var s = hfUpkeepState_(o, today);
    if (s) o.upkeep = s;
    out.push(o);
  });
  return out;
}

function hfChoreOut_(o) { var c = Object.assign({}, o); delete c._row; return c; }

/** GET chore_upkeep_done?id → {ok, chore}: logs today, moves Due By on. */
function webUpkeepDone_(e) {
  var id = String((e.parameter && e.parameter.id) || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  return tiLocked_(function() {
    var sheet = hfChoresSheet_(), today = hfToday_();
    var c = hfReadChores_(sheet, today).filter(function(x) { return String(x.ID).trim() === id; })[0];
    if (!c) return { ok: false, error: 'not found' };
    if (!hfIsUpkeep_(c.Cadence)) return { ok: false, error: 'Only quarterly, seasonal and yearly chores are logged by date.' };
    var col = function(h) { return CHORES_HEADERS.indexOf(h) + 1; };
    var dueBy = hfNextDueBy_(hfYmd_(c['Due By']), HF_UPKEEP_MONTHS_[c.Cadence], today);
    sheet.getRange(c._row, col('Checked')).setValue(true);
    sheet.getRange(c._row, col('Checked At')).setValue(new Date().toISOString());
    sheet.getRange(c._row, col('Last Done')).setValue(today);
    sheet.getRange(c._row, col('Due By')).setValue(dueBy);
    c.Checked = true; c['Last Done'] = today; c['Due By'] = dueBy; c.upkeep = hfUpkeepState_(c, today);
    try { hfSyncUpkeepReminders_(); } catch (err) { Logger.log('upkeep: reminders not refreshed: ' + err.message); }
    return { ok: true, chore: hfChoreOut_(c) };
  });
}

/** GET chore_upkeep_set?id&cadence&dueBy&lastDone → {ok, chore}. Blank clears a date. */
function webUpkeepSet_(e) {
  var p = e.parameter || {}, id = String(p.id || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  var cadence = String(p.cadence || '').trim();
  if (cadence && !hfIsUpkeep_(cadence) && ['Daily', 'Weekly', 'Biweekly', 'Monthly', 'Bimonthly'].indexOf(cadence) === -1) return { ok: false, error: 'unknown cadence' };
  return tiLocked_(function() {
    var sheet = hfChoresSheet_(), today = hfToday_();
    var c = hfReadChores_(sheet, today).filter(function(x) { return String(x.ID).trim() === id; })[0];
    if (!c) return { ok: false, error: 'not found' };
    var col = function(h) { return CHORES_HEADERS.indexOf(h) + 1; };
    if (cadence) { sheet.getRange(c._row, col('Cadence')).setValue(cadence); c.Cadence = cadence; }
    if ('dueBy' in p) { var d = hfYmd_(p.dueBy); sheet.getRange(c._row, col('Due By')).setValue(d); c['Due By'] = d; }
    if ('lastDone' in p) { var l = hfYmd_(p.lastDone); if (l > today) return { ok: false, error: 'Last done can’t be in the future.' }; sheet.getRange(c._row, col('Last Done')).setValue(l); c['Last Done'] = l; }
    var s = hfUpkeepState_(c, today);
    if (s) c.upkeep = s; else delete c.upkeep;
    return { ok: true, chore: hfChoreOut_(c) };
  });
}

/** GET chores_upkeep_starter → {ok, added, chores}: the starter list, skipping any already there by name. */
function webUpkeepStarter_() {
  return tiLocked_(function() {
    var sheet = hfChoresSheet_(), today = hfToday_();
    var have = {};
    hfReadChores_(sheet, today).forEach(function(c) { have[String(c.Chore).trim().toLowerCase()] = 1; });
    var added = [];
    HF_UPKEEP_STARTER_.forEach(function(s, i) {
      if (have[s[0].toLowerCase()]) return;
      var id = 'ch_' + Date.now() + '_' + i;
      var row = {}; row.ID = id; row.Chore = s[0]; row.Cadence = s[1]; row.Sort = sheet.getLastRow(); row.Checked = false; row['Checked At'] = '';
      row['Added Date'] = today; row['Last Done'] = ''; row['Due By'] = s[2] ? hfNextMonthDay_(s[2], today) : '';
      sheet.appendRow(CHORES_HEADERS.map(function(h) { return row[h]; }));
      row.upkeep = hfUpkeepState_(row, today);
      added.push(row);
    });
    return { ok: true, added: added.length, chores: added };
  });
}

// ---- reminders (nightly) -----------------------------------------------------------

function hfUpkeepMode_() {
  var v = '';
  try { v = String(getConfigValues()['upkeep_reminders'] || '').trim().toLowerCase(); } catch (e) {}
  return v === 'task' || v === 'off' ? v : 'flag';
}

/**
 * Raises, refreshes and closes upkeep reminders, as flags or tasks (Config
 * upkeep_reminders). Switching mode closes what the other mode left open.
 * Returns {mode, wanted}.
 */
function hfSyncUpkeepReminders_() {
  var ss = getSpreadsheet(), today = hfToday_(), mode = hfUpkeepMode_();
  var wanted = hfUpkeepWanted_(hfReadChores_(ss.getSheetByName(TABS.CHORES), today), today);
  var flags = ss.getSheetByName(TABS.FLAGS);
  if (flags) upsertKeyedFlags_(flags, HF_FLAG_PREFIX_, 'Chores', mode === 'flag' ? wanted : {}, today);
  var tasks = ss.getSheetByName(TABS.TASKS);
  if (tasks) hfSyncUpkeepTasks_(tasks, mode === 'task' ? wanted : {}, today);
  Logger.log('upkeep reminders: ' + Object.keys(wanted).length + ' due (' + mode + ')');
  return { mode: mode, wanted: Object.keys(wanted).length };
}

/** One open task per wanted reminder; an open upkeep task no longer wanted is marked Done. */
function hfSyncUpkeepTasks_(sheet, wanted, today) {
  var rows = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, TASK_HEADERS.length).getValues() : [];
  var open = {};
  rows.forEach(function(r, i) {
    var note = String(r[6] || ''), at = note.indexOf(HF_TASK_NOTE_);
    if (at === -1 || String(r[4]).toLowerCase() === 'done') return;
    var id = note.slice(at + HF_TASK_NOTE_.length).split(/\s/)[0];
    if (wanted[HF_FLAG_PREFIX_ + id]) open[id] = 1;
    else sheet.getRange(i + 2, 5).setValue('Done');
  });
  var n = 0;
  Object.keys(wanted).forEach(function(k) {
    var w = wanted[k];
    if (open[w.id]) return;
    var stamp = today.replace(/-/g, '');
    sheet.appendRow(['TASK-' + stamp + '-U' + (++n) + String(Date.now()).slice(-3), w.flag, today, w.next, 'Open', '', HF_TASK_NOTE_ + w.id + ' · from Home Front → Chores', '']);
  });
}

// ============================================================
// GATHERINGS (Hosting): dinner and lunch parties, birthdays, holidays.
// ============================================================
//
// One row per gathering in the Gatherings tab; the guest list, menu, to-dos and
// shopping list are JSON in their cells. A to-do is set relative to the day
// ("3 weeks before"), so moving the date moves every to-do with it. A new
// gathering starts with a few to-dos for its type. "Plan it again" copies the
// menu only (decided Oct 26), with fresh to-dos and no date. Party to-dos show
// under Coming up, never as flags (decided Oct 26). VERA writes to no calendar:
// the dashboard offers an .ics download.

var HF_GATHERING_TYPES_ = ['dinner', 'lunch', 'birthday', 'holiday', 'other'];
var HF_GUEST_STATUSES_ = ['invited', 'coming', 'maybe', 'declined'];
var HF_GATHERING_TEMPLATES_ = {
  dinner:   [['Send invites', 21], ['Plan the menu', 7], ['Shop', 1], ['Set the table', 0]],
  lunch:    [['Send invites', 14], ['Plan the menu', 7], ['Shop', 1]],
  birthday: [['Send invites', 21], ['Order the cake', 3], ['Buy the gift', 2], ['Decorations', 1]],
  holiday:  [['Send invites', 28], ['Plan the menu', 14], ['Ask who brings what', 10], ['Shop', 2]],
  other:    [['Send invites', 14]],
};

function hfStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
function hfNum_(v) { if (v === '' || v == null) return null; var n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; }
function hfTime_(v) { var m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})$/); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? String(m[1]).padStart(2, '0') + ':' + m[2] : ''; }
// Sheets turns a typed "19:00" into a time cell (a Date on 1899-12-30): read its hours and minutes back.
function hfTimeCell_(v) { return v instanceof Date && !isNaN(v.getTime()) ? String(v.getHours()).padStart(2, '0') + ':' + String(v.getMinutes()).padStart(2, '0') : v; }
function hfList_(v) { if (Array.isArray(v)) return v; try { var a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

/** Pure: the to-dos a new gathering of this type starts with. */
function hfGatheringTemplate_(type) {
  return (HF_GATHERING_TEMPLATES_[type] || HF_GATHERING_TEMPLATES_.other).map(function(t) { return { text: t[0], before: t[1], done: false }; });
}

/** Pure: a gathering as VERA keeps it: every field checked and capped. null without a title. */
function hfCleanGathering_(g) {
  g = g || {};
  var title = hfStr_(g.title, 80);
  if (!title) return null;
  var type = HF_GATHERING_TYPES_.indexOf(String(g.type || '').toLowerCase()) !== -1 ? String(g.type).toLowerCase() : 'other';
  return {
    id: hfStr_(g.id, 40), title: title, type: type, date: hfYmd_(g.date), start: hfTime_(g.start), end: hfTime_(g.end), place: hfStr_(g.place, 120),
    guests: hfList_(g.guests).map(function(x) { x = x || {}; var name = hfStr_(x.name, 60); if (!name) return null;
      var st = String(x.status || '').toLowerCase(); return { name: name, status: HF_GUEST_STATUSES_.indexOf(st) !== -1 ? st : 'invited', diet: hfStr_(x.diet, 60) }; }).filter(Boolean).slice(0, 60),
    menu: hfList_(g.menu).map(function(x) { x = x || {}; var dish = hfStr_(x.dish, 80); if (!dish) return null; return { dish: dish, who: hfStr_(x.who, 40), recipe: hfStr_(x.recipe, 80), note: hfStr_(x.note, 60) }; }).filter(Boolean).slice(0, 40),
    todos: hfList_(g.todos).map(function(x) { x = x || {}; var text = hfStr_(x.text, 80); if (!text) return null; var b = parseInt(x.before, 10);
      return { text: text, before: isFinite(b) ? Math.min(Math.max(b, 0), 120) : 0, done: x.done === true }; }).filter(Boolean).slice(0, 40),
    shopping: hfList_(g.shopping).map(function(x) { return hfStr_(x, 80); }).filter(Boolean).slice(0, 60),
    budget: hfNum_(g.budget), spent: hfNum_(g.spent), notes: String(g.notes == null ? '' : g.notes).trim().slice(0, 1000),
  };
}

/** Pure: "Plan it again": the same kind of gathering, the menu only (who brings what cleared), fresh to-dos, no date. */
function hfGatheringAgain_(g) {
  var c = hfCleanGathering_(g);
  if (!c) return null;
  return { id: '', title: c.title, type: c.type, date: '', start: c.start, end: c.end, place: c.place, guests: [],
    menu: c.menu.map(function(m) { return { dish: m.dish, who: '', recipe: m.recipe, note: m.note }; }),
    todos: hfGatheringTemplate_(c.type), shopping: [], budget: c.budget, spent: null, notes: '' };
}

/** Pure: a to-do's date: the gathering's date less its days before. '' with no date. */
function hfTodoDue_(date, before) { return date ? hfAddDays_(date, -(Number(before) || 0)) : ''; }
function hfAddDays_(ymd, n) { var d = new Date(Date.parse(ymd + 'T00:00:00Z') + n * 864e5); return d.toISOString().slice(0, 10); }

function hfGatheringToRow_(g, created, updated) {
  return [g.id, g.title, g.type, g.date, g.start, g.end, g.place, JSON.stringify(g.guests), JSON.stringify(g.menu), JSON.stringify(g.todos),
    JSON.stringify(g.shopping), g.budget == null ? '' : g.budget, g.spent == null ? '' : g.spent, g.notes, created, updated];
}
function hfGatheringFromRow_(r) {
  var g = hfCleanGathering_({ id: r[0], title: r[1], type: r[2], date: r[3] instanceof Date ? hfYmd_(r[3]) : r[3], start: hfTimeCell_(r[4]), end: hfTimeCell_(r[5]),
    place: r[6], guests: r[7], menu: r[8], todos: r[9], shopping: r[10], budget: r[11], spent: r[12], notes: r[13] });
  if (g) { g.created = String(r[14] || ''); g.updated = String(r[15] || ''); }
  return g;
}

function hfGatheringsSheet_() { return tiSchema_(ensureSheet(getSpreadsheet(), TABS.GATHERINGS, GATHERINGS_HEADERS), GATHERINGS_HEADERS); }
function hfReadGatherings_() { return tiRows_(hfGatheringsSheet_(), GATHERINGS_HEADERS.length).map(hfGatheringFromRow_).filter(Boolean); }

/** GET gatherings → {ok, gatherings, templates} */
function webGetGatherings_() {
  return { ok: true, gatherings: hfReadGatherings_(), templates: Object.keys(HF_GATHERING_TEMPLATES_).reduce(function(o, k) { o[k] = hfGatheringTemplate_(k); return o; }, {}) };
}

/** POST gathering_save {gathering} → {ok, gathering}. A new one (no id) gets an id, and its type's to-dos when it has none. */
function webSaveGathering_(body) {
  var g = hfCleanGathering_(body && body.gathering);
  if (!g) return { ok: false, error: 'A gathering needs a name.' };
  return tiLocked_(function() {
    var sheet = hfGatheringsSheet_(), now = tiNow_(), w = GATHERINGS_HEADERS.length;
    var row = g.id ? tiRowOf_(sheet, w, g.id) : -1;
    if (g.id && row === -1) return { ok: false, error: 'That gathering no longer exists.' };
    if (row === -1) {
      g.id = tiMintId_('GATH-');
      if (!g.todos.length && !(body.gathering && Array.isArray(body.gathering.todos))) g.todos = hfGatheringTemplate_(g.type);
      sheet.appendRow(hfGatheringToRow_(g, now, now));
      g.created = now; g.updated = now;
    } else {
      var created = String(sheet.getRange(row, 15).getValue() || now);
      sheet.getRange(row, 1, 1, w).setValues([hfGatheringToRow_(g, created, now)]);
      g.created = created; g.updated = now;
    }
    return { ok: true, gathering: g };
  });
}

/** POST gathering_delete {id} */
function webDeleteGathering_(body) {
  var id = hfStr_(body && body.id, 40);
  if (!id) return { ok: false, error: 'id required' };
  return tiLocked_(function() {
    var sheet = hfGatheringsSheet_(), row = tiRowOf_(sheet, GATHERINGS_HEADERS.length, id);
    if (row === -1) return { ok: false, error: 'not found' };
    sheet.deleteRow(row);
    return { ok: true, id: id };
  });
}

/** POST gathering_to_shopping {tabId, items[]} → {ok, added}: onto one store's list in the Shopping doc. */
function webGatheringToShopping_(body) {
  var tabId = hfStr_(body && body.tabId, 80);
  var items = hfList_(body && body.items).map(function(x) { return hfStr_(x, 80); }).filter(Boolean).slice(0, 60);
  if (!tabId) return { ok: false, error: 'Pick a store.' };
  if (!items.length) return { ok: false, error: 'Nothing to send.' };
  var added = 0;
  items.forEach(function(t) { addShoppingItem_(tabId, t); added++; });
  return { ok: true, added: added };
}
