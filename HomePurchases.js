// ============================================================
// VERA — HomePurchases.js
// Home & seasonal things bought on grocery runs: decorations, Christmas and Halloween
// things, small furniture, gadgets, gifts. They never go in the pantry, they count
// against their own budget line (a "Home & seasonal" row on the Budget tab), and a
// season tag lets VERA show next year what was bought last time.
// ============================================================
//
// A receipt line is one of three kinds (receiptClean_ in Pantry.js):
//   grocery  food and drink                      → pantry, the Groceries line
//   supply   household things that run out       → pantry, the Groceries line
//   home     things you keep (decor, furniture)  → this tab, the Home & seasonal line
// The paid total (tax included) is shared across the three in proportion to their
// line sums (hpSplit_), so each home row's Amount includes its share of the tax.
//
// The Home Purchases tab is the one place the month's Home & seasonal total and the
// season reminders read from. Rows come from grocery runs (source receipt / typed,
// with the run's ID) or from the Pantry's "Not a pantry item" (source pantry).
//
// Nightly checkSeasonalReminders_: about season_remind_weeks (8) weeks before each
// season, when that season has purchases from last time, a SEASON|<season>|<year> flag
// lists them and what they cost.
//
//   hp*_     pure: cleaning, the split, season dates and guesses, the month, the reminders
//   hpSheet_ / hpAll_ / hpLog_ / webPantryToHome_ / checkSeasonalReminders_  the sheet side
// ============================================================

var HP_SEASONS_ = ['Christmas', 'Halloween', 'Thanksgiving', 'Easter', 'Ramadan & Eid', 'Summer', 'Other'];
var HP_SEASON_EMOJI_ = { 'Christmas': '🎄', 'Halloween': '🎃', 'Thanksgiving': '🦃', 'Easter': '🐣', 'Ramadan & Eid': '🌙', 'Summer': '☀️', 'Other': '🏠' };
// Ramadan follows the moon: its first day for the years ahead (approximate, a day either way).
var HP_RAMADAN_STARTS_ = ['2026-02-18', '2027-02-08', '2028-01-28', '2029-01-16', '2030-01-05', '2030-12-26', '2031-12-15'];
var HP_FLAG_PREFIX_ = 'SEASON|';
var HP_FLAG_SOURCE_ = 'Home & seasonal';
var HP_REMIND_WEEKS_ = 8;
var HP_KEEP_MIN_ = 50;
var HP_KINDS_ = ['grocery', 'supply', 'home'];

// ---- pure ------------------------------------------------------------------------

function hpStr_(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 80); }
function hpMoney_(v) { if (v === '' || v == null) return null; var n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) && String(v).match(/\d/) && n >= 0 ? Math.round(n * 100) / 100 : null; }
function hpYmd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  var t = String(v == null ? '' : v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
}
function hpDays_(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function hpAddDays_(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
function hpSeason_(v) { var s = hpStr_(v, 30).toLowerCase(); return HP_SEASONS_.filter(function(x) { return x.toLowerCase() === s; })[0] || ''; }
/** Pure: a line's kind: what the reader said, else food → grocery, anything else → supply. */
function hpKind_(kind, food) { var k = String(kind || '').trim().toLowerCase(); return HP_KINDS_.indexOf(k) !== -1 ? k : food === false ? 'supply' : 'grocery'; }

/** Pure: a home line as the dashboard sent it. */
function hpClean_(raw) {
  raw = raw || {};
  return { name: hpStr_(raw.name || raw.item, 80), price: hpMoney_(raw.price), amount: hpMoney_(raw.amount), season: hpSeason_(raw.season) };
}

/** Pure: a season from the item's name, or '' (the user picks). */
function hpSeasonGuess_(name) {
  var t = String(name || '').toLowerCase();
  if (/christmas|xmas|\bwreath|ornament|stocking|garland|nativity|\btree\b|tinsel|santa|snowman|reindeer/.test(t)) return 'Christmas';
  if (/hallowe?en|pumpkin|costume|skeleton|\bspooky|\bwitch|\bghost|jack.o.lantern|cobweb/.test(t)) return 'Halloween';
  if (/thanksgiving|turkey platter|\bgourd|harvest decor|cornucopia/.test(t)) return 'Thanksgiving';
  if (/easter|egg dye|\bbunny/.test(t)) return 'Easter';
  if (/ramadan|\beid\b|lantern|fanous|crescent/.test(t)) return 'Ramadan & Eid';
  if (/\bpool\b|beach|sprinkler|patio umbrella|\bcooler\b|sunscreen tent|summer/.test(t)) return 'Summer';
  return '';
}

/**
 * Pure: shares the paid total across the three kinds in proportion to their line sums.
 * lines: [{price, kind}], paid: the total paid (tax included) or null (then the line sums).
 * → { grocery, supply, home, linesSum, paid, factor, homeAmounts: [amount per line, null when not home] }.
 * The home amounts are rounded per line and the home total is their sum, so the rows on the tab
 * add up to what the run shows; groceries take whatever cent is left.
 */
function hpSplit_(lines, paid) {
  var sum = { grocery: 0, supply: 0, home: 0 };
  (lines || []).forEach(function(l) { var p = hpMoney_(l && l.price); if (p != null) sum[hpKind_(l.kind, l.food)] += p; });
  var linesSum = Math.round((sum.grocery + sum.supply + sum.home) * 100) / 100;
  var total = hpMoney_(paid);
  if (total == null || !(total > 0)) total = linesSum;
  var f = linesSum > 0 ? total / linesSum : 1;
  var homeAmounts = (lines || []).map(function(l) { var p = hpMoney_(l && l.price); return hpKind_(l && l.kind, l && l.food) === 'home' ? (p == null ? 0 : Math.round(p * f * 100) / 100) : null; });
  var home = Math.round(homeAmounts.reduce(function(n, a) { return n + (a || 0); }, 0) * 100) / 100;
  var supply = Math.round(sum.supply * f * 100) / 100;
  var grocery = Math.round((total - supply - home) * 100) / 100;
  if (grocery < 0) grocery = 0;
  return { grocery: grocery, supply: supply, home: home, linesSum: linesSum, paid: total, factor: Math.round(f * 10000) / 10000, homeAmounts: homeAmounts };
}

/** Pure: Easter Sunday for a year (the anonymous Gregorian computus). */
function hpEaster_(y) {
  var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}
/** Pure: Thanksgiving (US): the fourth Thursday of November. */
function hpThanksgiving_(y) {
  var first = new Date(Date.UTC(y, 10, 1)).getUTCDay();          // 0 Sunday … 4 Thursday
  var day = 1 + ((4 - first + 7) % 7) + 21;
  return y + '-11-' + String(day).padStart(2, '0');
}
/** Pure: the season's date in a year, or '' (Other, or Ramadan beyond the table). */
function hpSeasonDate_(season, y) {
  switch (season) {
    case 'Christmas': return y + '-12-25';
    case 'Halloween': return y + '-10-31';
    case 'Thanksgiving': return hpThanksgiving_(y);
    case 'Easter': return hpEaster_(y);
    case 'Summer': return y + '-06-21';
    case 'Ramadan & Eid': return HP_RAMADAN_STARTS_.filter(function(d) { return d.slice(0, 4) === String(y); })[0] || '';
  }
  return '';
}
/** Pure: the season's next date on or after today, or ''. */
function hpNextDate_(season, today) {
  if (season === 'Ramadan & Eid') return HP_RAMADAN_STARTS_.filter(function(d) { return d >= today; })[0] || '';
  var y = Number(today.slice(0, 4));
  for (var k = 0; k < 2; k++) { var d = hpSeasonDate_(season, y + k); if (d && d >= today) return d; }
  return '';
}

/** Pure: a month of home rows → { total, count, bySeason: [{season, total, items}], items }. */
function hpMonthFrom_(rows, ym) {
  var out = { total: 0, count: 0, bySeason: [], items: [] }, by = {};
  (rows || []).filter(function(r) { return r.date && r.date.slice(0, 7) === ym; }).forEach(function(r) {
    var a = r.amount || 0; out.total += a; out.count++; out.items.push(r);
    var s = r.season || 'Other';
    (by[s] = by[s] || { season: s, total: 0, items: [] }).total += a; by[s].items.push(r);
  });
  out.total = Math.round(out.total * 100) / 100;
  out.bySeason = Object.keys(by).map(function(k) { by[k].total = Math.round(by[k].total * 100) / 100; return by[k]; }).sort(function(a, b) { return b.total - a.total; });
  return out;
}

/**
 * Pure: the season reminders that should be open today: for each season with a date, from
 * weeks*7 days before it until the day itself, when it has purchases from last time (120 to
 * 500 days before this season's date). → { 'SEASON|Christmas|2027': {flag, reason, urgency} }.
 */
function hpRemindersWanted_(rows, today, weeks) {
  var wanted = {}, w = weeks > 0 ? weeks : HP_REMIND_WEEKS_;
  HP_SEASONS_.forEach(function(season) {
    if (season === 'Other') return;
    var next = hpNextDate_(season, today);
    if (!next) return;
    var days = hpDays_(today, next);
    if (days < 0 || days > w * 7) return;
    var from = hpAddDays_(next, -500), to = hpAddDays_(next, -120);
    var last = (rows || []).filter(function(r) { return r.season === season && r.date >= from && r.date <= to; });
    if (!last.length) return;
    var total = Math.round(last.reduce(function(n, r) { return n + (r.amount || 0); }, 0) * 100) / 100;
    var weeksAway = Math.max(1, Math.round(days / 7));
    var list = last.slice(0, 8).map(function(r) { return r.item + ' (' + (r.store ? r.store + ', ' : '') + '$' + (r.amount || 0).toFixed(2) + ')'; }).join('; ');
    wanted[HP_FLAG_PREFIX_ + season + '|' + next.slice(0, 4)] = {
      flag: (HP_SEASON_EMOJI_[season] || '') + ' ' + season + ' is ' + (days <= 7 ? 'this week' : weeksAway + ' weeks away') + ': you already have what you bought last time',
      reason: 'Last time: ' + list + (last.length > 8 ? '; and ' + (last.length - 8) + ' more' : '') + '. $' + total.toFixed(2) + ' in all. Check what you still have before buying more.',
      urgency: 'Low' };
  });
  return wanted;
}

// ---- the sheet ---------------------------------------------------------------------

function hpSheet_() { return ensureSheet(getSpreadsheet(), TABS.HOME_PURCHASES, HOME_PURCHASE_HEADERS); }
function hpRowTo_(r) {
  return { id: String(r[0] || ''), date: hpYmd_(r[1]), item: hpStr_(r[2], 80), store: hpStr_(r[3], 60), amount: hpMoney_(r[4]) || 0, season: hpSeason_(r[5]),
    runId: String(r[6] || ''), source: String(r[7] || ''), homeItem: String(r[8] || '') };
}
function hpAll_() {
  var sh = hpSheet_();
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, HOME_PURCHASE_HEADERS.length).getValues().filter(function(r) { return String(r[0]).trim(); }).map(hpRowTo_);
}
/** Appends home rows: [{date, item, store, amount, season, runId, source}]. → the rows with their IDs. */
function hpLog_(rows) {
  var clean = (rows || []).filter(function(r) { return r && hpStr_(r.item, 80); });
  if (!clean.length) return [];
  var now = new Date().toISOString();
  var out = clean.map(function(r) {
    return { id: 'HP-' + Utilities.getUuid().replace(/-/g, '').substring(0, 10).toUpperCase(), date: hpYmd_(r.date), item: hpStr_(r.item, 80), store: hpStr_(r.store, 60),
      amount: hpMoney_(r.amount) || 0, season: hpSeason_(r.season), runId: String(r.runId || ''), source: String(r.source || 'receipt'), homeItem: '' };
  });
  var sh = hpSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, out.length, HOME_PURCHASE_HEADERS.length)
    .setValues(out.map(function(x) { return [x.id, x.date, x.item, x.store, x.amount, x.season, x.runId, x.source, '', now]; }));
  return out;
}
/** Removes the home rows a grocery run wrote (the run was deleted). */
function hpDeleteRun_(runId) {
  if (!runId) return 0;
  var sh = hpSheet_(), n = sh.getLastRow(), gone = 0;
  if (n < 2) return 0;
  var ids = sh.getRange(2, 7, n - 1, 1).getValues();
  for (var k = ids.length - 1; k >= 0; k--) if (String(ids[k][0]) === String(runId)) { sh.deleteRow(k + 2); gone++; }
  return gone;
}
function hpMonth_(ym) { return hpMonthFrom_(hpAll_(), ym); }

/**
 * Turns a run's home lines into tab rows. lines: [{name, price, amount, season}], homeTotal:
 * the run's Home & seasonal amount. Without per-line amounts the total is shared by price;
 * a typed run with no lines is one row.
 */
function hpRowsForRun_(run, lines, homeTotal) {
  var clean = (lines || []).map(hpClean_).filter(function(l) { return l.name; });
  var total = hpMoney_(homeTotal);
  if (!clean.length) return total > 0 ? [{ date: run.date, item: 'Home & seasonal', store: run.store, amount: total, season: '', runId: run.id, source: run.source || 'typed' }] : [];
  var priced = clean.reduce(function(n, l) { return n + (l.price || 0); }, 0);
  return clean.map(function(l) {
    var amt = l.amount != null ? l.amount : total > 0 && priced > 0 ? Math.round((l.price || 0) / priced * total * 100) / 100 : (l.price || 0);
    return { date: run.date, item: l.name, store: run.store, amount: amt, season: l.season, runId: run.id, source: run.source || 'receipt' };
  });
}

// ---- routes -------------------------------------------------------------------------

/**
 * GET pantry_to_home — name, season: an item that was never a pantry item (a wreath, a lamp).
 * Its Purchase History rows move to Home Purchases (source pantry) and leave the pantry. When a
 * receipt run that day at that store counted it in groceries, that amount moves from the run's
 * Total to its Home Total, so nothing is counted twice.
 */
function webPantryToHome_(e) {
  var p = (e && e.parameter) || e || {}, name = normalizeItemName_(p.name || ''), season = hpSeason_(p.season);
  if (!name) throw new Error('name required');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Purchase History is busy — try again.');
  try {
    var ph = getPurchaseHistorySheet_(), last = ph.getLastRow();
    var data = last >= 2 ? ph.getRange(2, 1, last - 1, PURCHASE_HISTORY_HEADERS.length).getValues() : [];
    var hits = [];
    data.forEach(function(r, i) { if (String(r[2] || '').trim().toLowerCase() === name) hits.push({ row: i + 2, r: r }); });
    if (!hits.length) return { ok: false, error: 'That item isn’t in the pantry.' };
    var moved = hits.map(function(x) {
      return { date: hpYmd_(x.r[4]), item: hpStr_(x.r[1] || name, 80), store: hpStr_(x.r[7], 60), amount: hpMoney_(x.r[8]) || 0, season: season, runId: '', source: 'pantry',
        nonFood: String(x.r[3] || '').trim() === 'Household' };
    });
    // The runs that counted it in groceries.
    var adjusted = 0;
    try {
      var gs = grSheet_(), gn = gs.getLastRow();
      var runs = gn >= 2 ? gs.getRange(2, 1, gn - 1, GROCERY_RUN_HEADERS.length).getValues() : [];
      moved.forEach(function(m) {
        if (!(m.amount > 0)) return;
        for (var k = 0; k < runs.length; k++) {
          var run = grRowToRun_(runs[k]);
          if (run.date !== m.date || run.store !== m.store || run.source !== 'receipt' || !(run.total >= m.amount)) continue;
          if (run.counted === 'food' && m.nonFood) break;   // "just the food" never counted it
          run.total = Math.round((run.total - m.amount) * 100) / 100;
          run.homeTotal = Math.round(((run.homeTotal || 0) + m.amount) * 100) / 100;
          runs[k] = grRunToRow_(run, run.created, new Date().toISOString());
          gs.getRange(k + 2, 1, 1, GROCERY_RUN_HEADERS.length).setValues([runs[k]]);
          m.runId = run.id; adjusted++;
          break;
        }
      });
    } catch (x) { Logger.log('pantry_to_home: grocery runs not adjusted — ' + x.message); }
    hpLog_(moved);
    for (var j = hits.length - 1; j >= 0; j--) ph.deleteRow(hits[j].row);
    return { ok: true, name: name, season: season, moved: moved.length, runsAdjusted: adjusted };
  } finally {
    lock.releaseLock();
  }
}

/** Nightly: the season reminders. */
function checkSeasonalReminders_() {
  var ss = getSpreadsheet(), flagSheet = ss.getSheetByName(TABS.FLAGS);
  if (!flagSheet || !ss.getSheetByName(TABS.HOME_PURCHASES)) return { skipped: 'no tab' };
  var cfg = {}; try { cfg = getConfigValues() || {}; } catch (e) {}
  var w = Number(cfg['season_remind_weeks']); if (!(w >= 1 && w <= 26)) w = HP_REMIND_WEEKS_;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var wanted = hpRemindersWanted_(hpAll_(), today, w);
  var suppressed = []; try { suppressed = getSuppressedKeyPatterns_(); } catch (e) {}
  Object.keys(wanted).forEach(function(k) { if (suppressed.indexOf(k) !== -1 || suppressed.indexOf('SEASON') !== -1) delete wanted[k]; });
  upsertKeyedFlags_(flagSheet, HP_FLAG_PREFIX_, HP_FLAG_SOURCE_, wanted, today);
  return { flags: Object.keys(wanted).length };
}
