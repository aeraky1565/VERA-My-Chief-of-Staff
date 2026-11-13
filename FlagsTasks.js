// ============================================================
// VERA — FlagsTasks.js
// The Flags and Tasks tabs' newer actions: automatic flags, snooze to a date,
// a task made from a flag, and tasks done this week.
// ============================================================
//
// Two kinds of flag:
//   - one-off flags (writeFlags, appendExactKeyFlags_): a key is written once,
//     ever, so Resolve sticks;
//   - automatic flags, kept by a nightly check through upsertKeyedFlags_ (Code.js).
//     The check reopens a resolved one while its cause is still there, so Resolve
//     by hand doesn't last. These are refused Resolve and say what clears them.
//
// A task made from a flag keeps the flag's ID in the Tasks tab's "Flagged" column.
// Checking it off resolves a one-off flag; an automatic flag is left to its check.
// "Completed" (the Tasks tab's last column) is the day a task was checked off, for
// the "Done this week" list.
//
// Pure helpers first, then the routes.
// ============================================================

// Every prefix a nightly check keeps through upsertKeyedFlags_, and what clears it.
// test_flagstasks.js checks every upsertKeyedFlags_ call site has its prefix here.
var AUTO_FLAG_KINDS_ = [
  { prefix: 'AGENT_HEALTH|',     clears: 'Clears on the agent’s next good run.' },
  { prefix: 'ARIA|',             clears: 'Clears once ARIA’s next run no longer reports it.' },
  { prefix: 'warranty_expiry_',  clears: 'Clears once the warranty date is updated or has passed.' },
  { prefix: 'FAMPLAN|',          clears: 'Clears once it’s done in Health › Family Planning.' },
  { prefix: 'HSAFSA|',           clears: 'Clears once it’s settled in Finances › FSA & HSA.' },
  { prefix: 'UPKEEP|',           clears: 'Clears once the chore is logged as done.' },
  { prefix: 'MYTRIP|',           clears: 'Clears once the trip is sorted in Travel › Trips.' },
  { prefix: 'ONHAND|',           clears: 'Clears once the item is used up or restocked.' },
  { prefix: 'MEALPREP|',         clears: 'Clears once the prep is done.' },
  { prefix: 'PPURCH|',           clears: 'Clears once the purchase is made or dropped.' },
  { prefix: 'PROJECT|',          clears: 'Clears once the project moves on.' },
  { prefix: 'vehicle_renewal_',  clears: 'Clears once the new date is saved on the vehicle’s card.' },
  { prefix: 'vehicle_miles_',    clears: 'Clears once the miles are updated.' },
  { prefix: 'trip_decision_',    clears: 'Clears once you choose between the options.' },
  { prefix: 'trip_premise_',     clears: 'Clears once the trip’s plan is confirmed.' },
  { prefix: 'FLIGHTCHG|',        clears: 'Clears once the itinerary matches the airline’s time.' },
];

/** Pure: the automatic kind a flag key belongs to ({prefix, clears}), or null for a one-off flag. */
function flagAutoOf_(key) {
  var k = String(key == null ? '' : key).trim();
  if (!k) return null;
  for (var i = 0; i < AUTO_FLAG_KINDS_.length; i++) if (k.indexOf(AUTO_FLAG_KINDS_[i].prefix) === 0) return AUTO_FLAG_KINDS_[i];
  return null;
}

/** Pure: 'yyyy-MM-dd' + n days. */
function ftAddDays_(iso, n) {
  var d = new Date(String(iso) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Pure: the day a snooze ends. until: 'yyyy-MM-dd', tomorrow at the earliest and a
 * year out at most; else days (1–365, default 2). → { ok, until } or { ok:false, error }.
 */
function flagSnoozeUntil_(until, days, todayIso) {
  var u = String(until == null ? '' : until).trim();
  if (u) {
    var t = /^\d{4}-\d{2}-\d{2}$/.test(u) ? Date.parse(u + 'T00:00:00Z') : NaN;
    if (isNaN(t) || new Date(t).toISOString().slice(0, 10) !== u) return { ok: false, error: 'until must be a date (yyyy-MM-dd)' };
    if (u <= todayIso) return { ok: false, error: 'Pick a day after today' };
    if (u > ftAddDays_(todayIso, 365)) return { ok: false, error: 'Pick a day within a year' };
    return { ok: true, until: u };
  }
  var n = parseInt(days, 10);
  if (!(n >= 1)) n = 2;
  return { ok: true, until: ftAddDays_(todayIso, Math.min(n, 365)) };
}

/**
 * Pure: tasks checked off in the last `days` days (today included), newest first.
 * rows: the Tasks tab's data rows in TASK_HEADERS order. → [{id, task, completed}]
 */
function tasksDoneRecent_(rows, todayIso, days, completedCol) {
  var from = ftAddDays_(todayIso, -((days || 7) - 1));
  var DONE = ['done', 'complete', 'completed'];
  var out = [];
  (rows || []).forEach(function(r, i) {
    var text = String(r[1] == null ? '' : r[1]).trim();
    if (!text || DONE.indexOf(String(r[4] || '').trim().toLowerCase()) === -1) return;
    var c = r[completedCol];
    var iso = c instanceof Date && !isNaN(c.getTime()) ? Utilities.formatDate(c, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(c == null ? '' : c).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso < from || iso > todayIso) return;
    out.push({ id: String(r[0] || '').trim() || ('TASK-R' + (i + 2)), task: text, completed: iso });
  });
  return out.sort(function(a, b) { return a.completed < b.completed ? 1 : a.completed > b.completed ? -1 : 0; });
}

function ftToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function ftCompletedCol_() { return TASK_HEADERS.indexOf('Completed') + 1; }     // 1-based
function ftFlaggedCol_() { return TASK_HEADERS.indexOf('Flagged') + 1; }

/** The Tasks tab's "Completed" header cell, labelled when blank (an older tab). */
function ftCompletedHeader_(sheet) {
  var col = ftCompletedCol_();
  try { if (!String(sheet.getRange(1, col).getValue() || '').trim()) sheet.getRange(1, col).setValue('Completed'); } catch (e) {}
}

/** Every flag by ID: {flag, resolved, auto, key}. One read. */
function ftFlagIndex_() {
  var out = {};
  var sh = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues().forEach(function(r) {
    var id = String(r[0] || '').trim();
    if (id) out[id] = { flag: String(r[3] || ''), resolved: String(r[8]).toLowerCase() === 'yes', key: String(r[9] || '').trim(), auto: !!flagAutoOf_(r[9]) };
  });
  return out;
}

/**
 * GET flag_to_task — id (a flag) [, task, dueDate] → a task linked to the flag.
 * The text defaults to the flag's, the due date to the flag's Due. A flag that
 * already has an open task gets that one back, not a second.
 */
function webFlagToTask_(p) {
  p = p || {};
  var found;
  try { found = findFlagRow_(p.id); } catch (e) { return { ok: false, error: e.message }; }
  var row = found.sheet.getRange(found.rowNum, 1, 1, FLAG_HEADERS.length).getValues()[0];
  var flagId = String(row[0]).trim();
  return veraLocked_(function() {
    var sheet = getSpreadsheet().getSheetByName(TABS.TASKS);
    if (!sheet) return { ok: false, error: 'Tasks sheet not found' };
    var fCol = ftFlaggedCol_();
    if (sheet.getLastRow() >= 2) {
      var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, TASK_HEADERS.length).getValues();
      for (var i = 0; i < rows.length; i++) {
        var open = ['done', 'complete', 'completed', 'cancelled', 'canceled'].indexOf(String(rows[i][4] || '').trim().toLowerCase()) === -1;
        if (open && String(rows[i][fCol - 1] || '').trim() === flagId) return { ok: true, id: String(rows[i][0]).trim(), existing: true };
      }
    }
    var text = String(p.task || '').trim() || String(row[3] || '').trim();
    if (!text) return { ok: false, error: 'The flag has no text' };
    var due = String(p.dueDate || '').trim() || flagDueCell_(row[11]);
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { ok: false, error: 'dueDate must be yyyy-MM-dd' };
    var tz = Session.getScriptTimeZone(), now = new Date();
    var dateKey = Utilities.formatDate(now, tz, 'yyyyMMdd'), seq = 1;
    if (sheet.getLastRow() >= 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function(r) { if (String(r[0] || '').indexOf('TASK-' + dateKey) === 0) seq++; });
    var id = 'TASK-' + dateKey + '-' + String(seq).padStart(2, '0');
    // TASK_HEADERS: ID | Task | Added Date | Due Date | Status | Recurring | Notes | Flagged | Completed
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, TASK_HEADERS.length).setValues([[id, text, Utilities.formatDate(now, tz, 'yyyy-MM-dd'), due, 'Open', '', '', flagId, '']]);
    return { ok: true, id: id, created: true };
  });
}

/**
 * After a task is checked off: its flag, if it has one. A one-off flag is resolved;
 * an automatic one is left for its check, which clears it once the cause is gone.
 * → '' | 'resolved' | 'left' (automatic) | 'already' (already resolved)
 */
function ftSettleFlagFor_(flagId) {
  var id = String(flagId || '').trim();
  if (!id) return '';
  var found;
  try { found = findFlagRow_(id); } catch (e) { return ''; }
  var r = found.sheet.getRange(found.rowNum, 1, 1, 10).getValues()[0];
  if (String(r[8]).toLowerCase() === 'yes') return 'already';
  if (flagAutoOf_(r[9])) return 'left';
  found.sheet.getRange(found.rowNum, 9).setValue('Yes');
  return 'resolved';
}

/** GET reopen_task — id → back to Open, its Completed day cleared. */
function webReopenTask_(id) {
  var found;
  try { found = findTaskRow_(id); } catch (e) { return { ok: false, error: e.message }; }
  found.sheet.getRange(found.rowNum, 5).setValue('Open');
  found.sheet.getRange(found.rowNum, ftCompletedCol_()).setValue('');
  return { ok: true, id: id, action: 'reopened' };
}
