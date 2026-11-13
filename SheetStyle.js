// ============================================================
// VERA — SheetStyle.js  (issue #235)
// The VERA sheet's look as a script: re-runnable, and new tabs get it too.
// ============================================================
//
// On Nov 9 the sheet was styled by hand through the Sheets connector. Nothing
// re-applied it, tabs VERA creates later only got a bold header, banding stopped
// at that day's row count, and the detailed rules reached only a dozen tabs. This
// file holds the same style:
//
//   - every data tab: a navy header row (white, bold), row 1 frozen, column A
//     frozen when a tab has more than 8 columns, and white / light-blue banding;
//   - a tab colour per area, and the tabs ordered by area (Config first, Access at
//     position 14, VERA's internal tabs last and visible);
//   - per column, by header name: money as $#,##0.00, prose wrapped, JSON and ID
//     lists clipped;
//   - colours: Urgency High / Medium / Low; Status done / open / closed / overdue;
//     a Flags row greys out once Resolved is Yes.
//
// Two rules hold everywhere, because VERA reads data tabs by POSITION:
//   1. no value is ever written, and no row or column is ever moved, inserted or
//      deleted — only formats, banding, freezes, tab colours and tab order change;
//   2. Config and Access are never formatted (their own layout is hand-made), only
//      kept at their places in the tab order.
//
// Re-runnable: before re-adding, a run removes each tab's banding and only the
// colour rules this file makes (recognised by their background colours), so any
// rule added by hand survives.
//
// Run by hand from the Apps Script editor: styleVeraSheet(). It is never part of
// the nightly run. A long run stops before Apps Script's time limit and says so;
// running it again finishes the rest.
//
// Two layers, so the tests need no Google:
//   ss*_ (pure)       areas, tab order, column kinds, the plan
//   ssApply*_         SpreadsheetApp calls that carry the plan out
// ============================================================

var SS_NAVY_  = '#1a1a2e';
var SS_WHITE_ = '#ffffff';
var SS_BAND_  = '#f3f6fb';
var SS_SKIP_  = ['Config', 'Access'];
var SS_FIXED_ = { Config: 0, Access: 13 };   // zero-based tab positions that never change

// Areas in tab order. A tab is matched by exact name, then by prefix.
var SS_AREAS_ = [
  { id: 'today',    color: '#c9a84c', tabs: ['Flags', 'Tasks', 'Projects', 'Summaries', 'Metrics', 'Morning Routine', 'Chores',
    'ChoresForOthers', 'Ideas', 'Email Follow-ups', 'Important Dates', 'Monthly Reviews', 'PTO', 'PTO Memory'] },
  { id: 'travel',   color: '#3d7be0', tabs: ['Trips', 'TripMeta', 'Itinerary', 'PackingItems', 'LuggageProfiles', 'Bags',
    'Traveler Items', 'Traveler Profiles', 'Gift Place Ideas', 'TripRecommendations', 'TravelLegs', 'Bucket List',
    'BucketActivities', 'Countries', 'Place Facts', 'ARIA Requests', 'Loyalty Programs'],
    prefixes: ['Trip ', 'Travel', 'Packing', 'Leaving Home'] },
  { id: 'money',    color: '#2e9d5b', tabs: ['Bills', 'Bill Schedule', 'Transactions', 'Bank Accounts', 'Credit Cards',
    'Rewards Goals', 'Financial Goals', 'Financial Scenarios', 'Finance Snapshots', 'Planned Purchases', 'Planned Purchase Options',
    'Health Accounts', 'Contracts', 'Coupons', 'Giving', 'Resell List'],
    prefixes: ['Card ', 'Tax ', 'Budget ', 'Check-in ', 'Phone '] },
  { id: 'home',     color: '#e07b39', tabs: ['HouseholdInfo', 'Home Items', 'Vehicles', 'On Hand', 'Purchase History',
    'Grocery Runs', 'Meal Plan', 'Recipes'],
    prefixes: ['Takeout ', 'NEIGHBORHOOD_'] },
  { id: 'health',   color: '#d9548f', tabs: ['Wellness Log', 'Gym Log', 'Prescriptions', 'Family Planning', 'Cycle Log',
    'Wish List', 'Gatherings'],
    prefixes: ['FP ', 'Gift '] },
  { id: 'career',   color: '#7b5cd6', tabs: [], prefixes: ['Career '] },
  { id: 'life',     color: '#1f9e9e', tabs: ['Goals', 'Habits', 'HabitLog', 'Books', 'Courses', 'Skills', 'Shared Interests', 'Resources'],
    prefixes: ['Experiment'] },
  { id: 'internal', color: '#8a94a6', tabs: ['System Log', 'Processed Emails', 'SignalLearning', 'Generation Inputs', 'Reminders Memory', 'VERA State'],
    prefixes: ['Memory '] },
];

// The colour rules' fills, which also mark a rule as ours when a run clears old ones.
var SS_RULES_ = {
  high:    { bg: '#fde2e2', fg: '#9b1c1c' },
  medium:  { bg: '#fef3c7', fg: '#92400e' },
  low:     { bg: '#e0ecff', fg: '#1e40af' },
  done:    { bg: '#dcfce7', fg: '#166534' },
  open:    { bg: '#e8f0fe', fg: '#1e40af' },
  closed:  { bg: '#eceff3', fg: '#6b7280' },
  overdue: { bg: '#fdecec', fg: '#9b1c1c' },
  resolved:{ bg: '#f1f3f6', fg: '#8a94a6' },
};
var SS_STATUS_WORDS_ = {
  done:    ['done', 'complete', 'completed', 'resolved', 'booked', 'paid', 'hired', 'applied'],
  open:    ['open', 'draft', 'active', 'new', 'watching', 'scouting', 'in progress', 'pending', 'saved', 'interviewing'],
  closed:  ['cancelled', 'canceled', 'merged', 'archived', 'dropped', 'withdrawn', 'passed', 'ignored', 'declined'],
  overdue: ['overdue'],
};
var SS_TIME_LIMIT_MS_ = 5 * 60 * 1000;
var SS_PROGRESS_PROP_ = 'SS_STYLE_DONE';

// ---- pure ----------------------------------------------------------------------

/** Pure: the area of a tab, or null. */
function ssAreaOf_(name) {
  name = String(name || '');
  for (var i = 0; i < SS_AREAS_.length; i++) {
    var a = SS_AREAS_[i];
    if (a.tabs.indexOf(name) !== -1) return a;
    if ((a.prefixes || []).some(function(p) { return name.indexOf(p) === 0; })) return a;
  }
  return null;
}

/**
 * Pure: the tab order. Config first; the areas in order; tabs in no area after the
 * last named area and before VERA's internal tabs, in their current order; Access
 * back at position 14. names: the current order.
 */
function ssOrder_(names) {
  var rest = (names || []).filter(function(n) { return SS_SKIP_.indexOf(n) === -1; });
  var rank = function(n) {
    var a = ssAreaOf_(n);
    if (!a) return SS_AREAS_.length - 1.5;   // before internal
    return SS_AREAS_.indexOf(a);
  };
  var sorted = rest.map(function(n, i) { return { n: n, r: rank(n), i: i }; })
    .sort(function(x, y) { return x.r - y.r || x.i - y.i; })
    .map(function(x) { return x.n; });
  var out = sorted.slice();
  if ((names || []).indexOf('Config') !== -1) out.unshift('Config');
  if ((names || []).indexOf('Access') !== -1) out.splice(Math.min(SS_FIXED_.Access, out.length), 0, 'Access');
  return out;
}

/** Pure: how a column is formatted, from its header: 'money' | 'prose' | 'code' | ''. */
function ssColumnKind_(header) {
  var h = String(header || '').trim();
  if (!h) return '';
  if (/json|metadata|payload|\bids\b|key pattern|luggage/i.test(h)) return 'code';
  var notMoney = /date|\bid\b|%|pct|percent|count|points|miles|qty|quantity|score|rate|days?\b|month|year|link|url|type|status|name|notes?|frequency|level|tier|total seen/i;
  if (/\b(amount|cost|price|budget|budgeted|balance|total|fare|paid|spend|spent|payment|fee|fees|ceiling|limit|income|salary|bonus|savings|contribution|deposit|refund|actual|planned|due)\b/i.test(h) && !notMoney.test(h)) return 'money';
  if (/\b(notes?|reason|flag|task|description|details?|summary|message|body|comment|comments|instructions|why|statement|meaning|action needed|what changes|calibration note)\b/i.test(h)) return 'prose';
  return '';
}

/** Pure: the column letter for a 1-based column number. */
function ssColLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Pure: a REGEXMATCH formula for a status column's words, for row 2 of column `col`. */
function ssStatusFormula_(col, words) {
  var c = ssColLetter_(col);
  return '=REGEXMATCH(LOWER(TRIM($' + c + '2)),"^(' + words.join('|') + ')$")';
}

/**
 * Pure: the plan. tabs: [{ name, headers, maxRows }] in their current order.
 * → { order: [names], ops: [...] }. Each op names its sheet; kinds:
 *   header {cols} · freeze {rows, cols} · band {cols, rows} · tabColor {color}
 *   format {col, kind} · rule {col, rule, words|text, width}
 * No op writes a value or moves a row or column; Config and Access get none.
 */
function ssPlan_(tabs) {
  var ops = [];
  (tabs || []).forEach(function(t) {
    if (SS_SKIP_.indexOf(t.name) !== -1) return;
    var headers = (t.headers || []).map(function(h) { return String(h == null ? '' : h).trim(); });
    while (headers.length && !headers[headers.length - 1]) headers.pop();
    var cols = headers.length;
    if (!cols) return;   // an empty tab: nothing to style yet
    var rows = Math.max(Number(t.maxRows) || 0, 2);
    ops.push({ op: 'header', sheet: t.name, cols: cols });
    ops.push({ op: 'freeze', sheet: t.name, rows: 1, cols: cols > 8 ? 1 : 0 });
    ops.push({ op: 'band', sheet: t.name, cols: cols, rows: rows });
    var area = ssAreaOf_(t.name);
    if (area) ops.push({ op: 'tabColor', sheet: t.name, color: area.color });
    headers.forEach(function(h, i) {
      var kind = ssColumnKind_(h);
      if (kind) ops.push({ op: 'format', sheet: t.name, col: i + 1, kind: kind, rows: rows });
      var low = h.toLowerCase();
      if (low === 'urgency' || low === 'priority' || low === 'action urgency') {
        ['high', 'medium', 'low'].forEach(function(lvl) {
          ops.push({ op: 'rule', sheet: t.name, col: i + 1, rule: lvl, text: lvl.charAt(0).toUpperCase() + lvl.slice(1), rows: rows });
        });
      }
      if (low === 'status' || low === 'watch status') {
        ['done', 'open', 'closed', 'overdue'].forEach(function(k) {
          ops.push({ op: 'rule', sheet: t.name, col: i + 1, rule: k, words: SS_STATUS_WORDS_[k], rows: rows });
        });
      }
      if (t.name === 'Flags' && low === 'resolved') {
        ops.push({ op: 'rule', sheet: t.name, col: i + 1, rule: 'resolved', text: 'Yes', width: cols, rows: rows });
      }
    });
  });
  return { order: ssOrder_((tabs || []).map(function(t) { return t.name; })), ops: ops };
}

/** Pure: is a background colour one of this file's rule fills? */
function ssIsOurFill_(bg) {
  var b = String(bg || '').toLowerCase();
  return Object.keys(SS_RULES_).some(function(k) { return SS_RULES_[k].bg === b; });
}

// ---- apply ---------------------------------------------------------------------

/** One conditional format rule from a plan op. */
function ssApplyRule_(sheet, op) {
  var fill = SS_RULES_[op.rule];
  var b = SpreadsheetApp.newConditionalFormatRule().setBackground(fill.bg).setFontColor(fill.fg);
  var range;
  if (op.rule === 'resolved') {
    b = b.whenFormulaSatisfied('=$' + ssColLetter_(op.col) + '2="Yes"');
    range = sheet.getRange(2, 1, op.rows - 1, op.width);
  } else if (op.words) {
    b = b.whenFormulaSatisfied(ssStatusFormula_(op.col, op.words));
    range = sheet.getRange(2, op.col, op.rows - 1, 1);
  } else {
    b = b.whenTextEqualTo(op.text);
    range = sheet.getRange(2, op.col, op.rows - 1, 1);
  }
  return b.setRanges([range]).build();
}

/** Carries out one tab's ops. Clears its banding and this file's old rules first. */
function ssApplyTab_(sheet, ops) {
  sheet.getBandings().forEach(function(band) { band.remove(); });
  var keep = sheet.getConditionalFormatRules().filter(function(r) {
    var c = r.getBooleanCondition && r.getBooleanCondition();
    return !(c && ssIsOurFill_(c.getBackground && c.getBackground()));
  });
  var rules = [];
  ops.forEach(function(op) {
    if (op.op === 'header') {
      sheet.getRange(1, 1, 1, op.cols).setBackground(SS_NAVY_).setFontColor(SS_WHITE_).setFontWeight('bold');
    } else if (op.op === 'freeze') {
      sheet.setFrozenRows(op.rows);
      sheet.setFrozenColumns(op.cols);
    } else if (op.op === 'band') {
      sheet.getRange(1, 1, op.rows, op.cols)
        .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
        .setHeaderRowColor(SS_NAVY_).setFirstRowColor(SS_WHITE_).setSecondRowColor(SS_BAND_);
    } else if (op.op === 'tabColor') {
      sheet.setTabColor(op.color);
    } else if (op.op === 'format') {
      var r = sheet.getRange(2, op.col, op.rows - 1, 1);
      if (op.kind === 'money') r.setNumberFormat('$#,##0.00');
      else if (op.kind === 'prose') r.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
      else if (op.kind === 'code') r.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    } else if (op.op === 'rule') {
      rules.push(ssApplyRule_(sheet, op));
    }
  });
  sheet.setConditionalFormatRules(keep.concat(rules));
}

/**
 * Styles the whole sheet. Resumable: tabs finished are remembered in a Script
 * Property, so a run that hits the time limit picks up where it stopped.
 * → { styled, skipped, remaining, ordered }
 */
function ssApply_(ss) {
  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var done = {};
  try { done = JSON.parse(props.getProperty(SS_PROGRESS_PROP_) || '{}') || {}; } catch (e) { done = {}; }
  var sheets = ss.getSheets();
  var tabs = sheets.map(function(sh) {
    var lastCol = sh.getLastColumn();
    return { name: sh.getName(), maxRows: sh.getMaxRows(),
             headers: lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [] };
  });
  var plan = ssPlan_(tabs);
  var byTab = {};
  plan.ops.forEach(function(op) { (byTab[op.sheet] = byTab[op.sheet] || []).push(op); });
  var names = Object.keys(byTab), styled = 0, remaining = [];
  names.forEach(function(name) {
    if (done[name]) return;
    if (Date.now() - started > SS_TIME_LIMIT_MS_) { remaining.push(name); return; }
    try {
      ssApplyTab_(ss.getSheetByName(name), byTab[name]);
      done[name] = true; styled++;
    } catch (e) { Logger.log('styleVeraSheet: ' + name + ' — ' + e.message); remaining.push(name); }
  });
  var ordered = false;
  if (!remaining.length) {
    plan.order.forEach(function(name, i) {
      var sh = ss.getSheetByName(name);
      if (!sh || sh.getIndex() === i + 1) return;
      // A hidden tab (VERA State) is left where it is: activating it to move it would show it.
      if (sh.isSheetHidden && sh.isSheetHidden()) return;
      ss.setActiveSheet(sh);
      ss.moveActiveSheet(i + 1);
    });
    ordered = true;
    props.deleteProperty(SS_PROGRESS_PROP_);
  } else {
    props.setProperty(SS_PROGRESS_PROP_, JSON.stringify(done));
  }
  return { styled: styled, skipped: SS_SKIP_.length, remaining: remaining, ordered: ordered };
}

/**
 * The style for a tab VERA has just created (ensureSheet): banding and its area's
 * tab colour. The header itself is already navy from ensureSheet. Never throws.
 */
function ssStyleNewTab_(sheet, cols) {
  try {
    var name = sheet.getName();
    if (SS_SKIP_.indexOf(name) !== -1 || !cols) return;
    if (!sheet.getBandings().length) {
      sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), cols)
        .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
        .setHeaderRowColor(SS_NAVY_).setFirstRowColor(SS_WHITE_).setSecondRowColor(SS_BAND_);
    }
    var area = ssAreaOf_(name);
    if (area) sheet.setTabColor(area.color);
    if (cols > 8) sheet.setFrozenColumns(1);
  } catch (e) { Logger.log('ssStyleNewTab_: ' + e.message); }
}

/**
 * Run by hand from the Apps Script editor. Styles every data tab, then puts the
 * tabs in order. If it stops at the time limit, run it again to finish.
 */
function styleVeraSheet() {
  var r = ssApply_(getSpreadsheet());
  var msg = 'styleVeraSheet: ' + r.styled + ' tab(s) styled' +
    (r.remaining.length ? '; ' + r.remaining.length + ' left — run styleVeraSheet() again to finish' : '; tabs in order');
  Logger.log(msg);
  return r;
}
