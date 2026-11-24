// ============================================================
// VERA — PracticeLogs.js (#259)
// Language practice logged by outside apps (ÉLISE for French, and any later
// language app), read each night into Life › Growth.
// ============================================================
//
// WHY. ÉLISE keeps its own log of the days you practised, in its own Sheet.
// VERA reads it, rather than ÉLISE writing into VERA, so no app holds VERA's
// token and a new language app only needs one more item in Config.
//
// HOW.
//  - Config row practice_logs: a JSON list, one item per app:
//      [{"sheet": "<spreadsheet id>", "tab": "Practice", "goal": "GOAL-…"}]
//  - Each app's tab has a header row with at least `date` (yyyy-MM-dd) and
//    `minutes`; `theme` and `note` are used for the practice note if present.
//    Other columns (language, sessions, new_items, reviewed…) are ignored here.
//  - Each night, for the last PL_DAYS_BACK_ days: a day not sent before is
//    logged on the goal with lgLogPractice_ (its minutes and note); a day sent
//    before whose minutes went up is logged again with only the difference,
//    since lgLogPractice_ adds same-day logs together. What was sent is kept in
//    the VERA State tab (PRACTICE_LOG_SYNCED), so a rerun never counts twice.
//  - A Sheet that can't be read is logged and skipped; the others still run.
//    Logs name the tab and counts, never values. Nothing is ever written to an
//    app's Sheet.
// ============================================================

var PL_DAYS_BACK_  = 7;    // a missed night (or a few) is caught up
var PL_KEEP_DAYS_  = 60;   // how long "already sent" is remembered
var PL_SYNCED_KEY_ = 'PRACTICE_LOG_SYNCED';

// ---- pure ------------------------------------------------------------------------------

/** Pure: the Config value → [{sheet, tab, goal}]; items without a sheet or goal are dropped. */
function plSources_(raw) {
  var list;
  try { list = JSON.parse(String(raw || '[]')); } catch (e) { return []; }
  if (!Array.isArray(list)) return [];
  return list.map(function(x) {
    return { sheet: lfStr_(x && x.sheet, 80), tab: lfStr_(x && x.tab, 60) || 'Practice', goal: lfStr_(x && x.goal, 40) };
  }).filter(function(x) { return x.sheet && x.goal; });
}

/** Pure: a log tab's values (header row first) → [{date, minutes, note}], one per date, oldest first. */
function plRows_(values) {
  if (!values || values.length < 2) return [];
  var hdr = values[0].map(function(h) { return String(h).trim().toLowerCase(); });
  var col = function(n) { return hdr.indexOf(n); };
  if (col('date') === -1) return [];
  var byDate = {};
  values.slice(1).forEach(function(r) {
    var d = lfYmd_(r[col('date')]);
    if (!d) return;
    var m = col('minutes') === -1 ? 0 : Math.max(0, Math.round(Number(r[col('minutes')]) || 0));
    var note = ['theme', 'note'].map(function(n) { return col(n) === -1 ? '' : lfStr_(r[col(n)], 80); }).filter(Boolean).join(' · ');
    var prev = byDate[d];
    byDate[d] = { date: d, minutes: (prev ? prev.minutes : 0) + m, note: prev && prev.note ? prev.note : note };
  });
  return Object.keys(byDate).sort().map(function(d) { return byDate[d]; });
}

/**
 * Pure: what to send for one source. rows from plRows_, synced {"<sheet>|<date>": minutes sent},
 * from the first day to look at. → [{date, minutes, note, key, total}]
 */
function plToSend_(rows, synced, sheetId, sinceYmd) {
  var out = [];
  rows.forEach(function(r) {
    if (r.date < sinceYmd) return;
    var key = sheetId + '|' + r.date, prev = synced[key];
    if (prev == null) out.push({ date: r.date, minutes: r.minutes, note: r.note, key: key, total: r.minutes });
    else if (r.minutes > prev) out.push({ date: r.date, minutes: r.minutes - prev, note: '', key: key, total: r.minutes });
  });
  return out;
}

/** Pure: synced without the days before keepFrom. */
function plPrune_(synced, keepFrom) {
  var out = {};
  Object.keys(synced || {}).forEach(function(k) { if (String(k.split('|')[1]) >= keepFrom) out[k] = synced[k]; });
  return out;
}

/** Pure: 'yyyy-MM-dd' moved by n days. */
function plShift_(ymd, n) {
  var p = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

// ---- nightly ---------------------------------------------------------------------------

/** Nightly: reads every practice log in Config and logs new practice on its Growth goal. */
function plNightly_() {
  var sources = plSources_(veraSetting_('PRACTICE_LOGS'));
  if (!sources.length) return { ok: true, sources: 0, logged: 0 };
  var synced = {};
  try { synced = JSON.parse(veraStoreGet_(PL_SYNCED_KEY_) || '{}') || {}; } catch (e) { synced = {}; }
  var today = lfToday_(), since = plShift_(today, -PL_DAYS_BACK_), logged = 0, failed = 0;
  sources.forEach(function(src) {
    var values;
    try { values = SpreadsheetApp.openById(src.sheet).getSheetByName(src.tab).getDataRange().getValues(); }
    catch (e) { failed++; Logger.log('plNightly_: could not read the ' + src.tab + ' tab of a practice log'); return; }
    plToSend_(plRows_(values), synced, src.sheet, since).forEach(function(s) {
      var res = lfLocked_(function() { return lgLogPractice_(src.goal, s.date, s.minutes, s.note); });
      if (res && res.ok) { synced[s.key] = s.total; logged++; }
      else Logger.log('plNightly_: ' + src.goal + ' ' + s.date + ': ' + (res && res.error));
    });
  });
  veraStoreSet_(PL_SYNCED_KEY_, JSON.stringify(plPrune_(synced, plShift_(today, -PL_KEEP_DAYS_))));
  Logger.log('plNightly_: ' + sources.length + ' log(s), ' + logged + ' day(s) logged, ' + failed + ' unreadable');
  return { ok: !failed, sources: sources.length, logged: logged, failed: failed };
}
