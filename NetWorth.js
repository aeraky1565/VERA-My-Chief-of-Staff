// ============================================================
// VERA — NetWorth.js  (Issue #126)
// Reads the work-optional planner's Google Sheet for the Finances → Net Worth tab,
// and raises a flag ahead of each CD maturity.
// ============================================================
//
// THE PLANNER SHEET BELONGS TO ANOTHER SYSTEM. It feeds that system's tracker and VERA
// at the same time, so two rules hold everywhere in this file:
//
//   1. VERA ONLY READS IT. Nothing here calls a write method on the planner — the
//      only spreadsheet writes in this file go to VERA's OWN Config and Flags tabs.
//      test_networth.js asserts the read path contains no write calls.
//
//   2. EVERY READ IS BY LABEL, NEVER BY CELL POSITION. The planner rewrites its
//      Outputs tab on every calculation, and its other consumer may reshape any tab.
//      A fixed ref like B5 keeps "working" after a row is inserted — it just returns
//      a different number, and nothing anywhere notices. So each section finds its
//      row by key or label and its column by header, and a label it cannot find makes
//      that section UNAVAILABLE. A missing number is visible; a wrong one is not.
//
// The sheet id lives in VERA's Config tab as `planner_sheet_id`, never in the repo —
// the same rule as the address book.
//
// The tab reads live on every open. Grouping and filtering happen in the dashboard,
// over the rows returned here, so changing a dropdown never re-reads the sheet.
// ============================================================

var NW_HEALTH_SOURCE_       = 'sheet:Planner';
var NW_UNMAPPED_            = 'Unmapped';
var NW_CD_FLAG_DAYS_        = 30;
var NW_CD_FLAG_PREFIX_      = 'cd_maturity_';
var NW_SEEDED_PROPERTY_     = 'NETWORTH_MAPPING_SEEDED';

// The 16 mapping rows approved for issue #126. Written ONCE into VERA's Config tab and
// then left alone: they are yours to edit, and a row you delete stays deleted.
var NW_MAPPING_DEFAULTS_ = [
  ['networth_class:chk',     'Cash'],        ['networth_tax:chk',     'Taxable'],
  ['networth_class:cash',    'Cash'],        ['networth_tax:cash',    'Taxable'],
  ['networth_class:cds',     'CDs'],         ['networth_tax:cds',     'Taxable'],
  ['networth_class:taxable', 'Investments'], ['networth_tax:taxable', 'Taxable'],
  ['networth_class:stock',   'Investments'], ['networth_tax:stock',   'Taxable'],
  ['networth_class:retire',  'Retirement'],  ['networth_tax:retire',  'Pre-tax'],
  ['networth_class:roth',    'Retirement'],  ['networth_tax:roth',    'Tax-free'],
  ['networth_class:crypto',  'Alternative'], ['networth_tax:crypto',  'Taxable'],
];

// ============================================================
// LABEL LOOKUPS — pure, so the tests can run them on fixtures
// ============================================================

/** Header text, lower-cased, trimmed. */
function nwNorm_(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

/**
 * Column index whose header names `name`. Headers carry format hints the planner
 * adds — "APY %", "Matures (YYYY-MM-DD)", "Pays out (YYYY-MM)" — so a header matches
 * when it IS the name or STARTS with the name followed by a space. -1 when absent.
 *
 * AN EXACT MATCH ALWAYS WINS, checked across every header before any prefix match.
 * Balances has both "Bucket key" and "Bucket", key first: a single prefix pass found
 * "Bucket key" when asked for "Bucket", so the label column WAS the key column and
 * the real label column was read as an owner. That is the exact layout of the real
 * planner sheet.
 */
function nwCol_(headers, name) {
  var want = nwNorm_(name), i;
  for (i = 0; i < headers.length; i++) {
    if (nwNorm_(headers[i]) === want) return i;
  }
  for (i = 0; i < headers.length; i++) {
    if (nwNorm_(headers[i]).indexOf(want + ' ') === 0) return i;
  }
  return -1;
}

/**
 * A money cell as a number. Sheets returns currency-formatted cells as numbers, but a
 * cell typed as text ("$8,554") must not become 0 — that is a wrong number, which is
 * the one outcome this file exists to prevent. Blank is 0; anything unparseable is null.
 */
function nwNumber_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v == null ? '' : v).trim();
  if (s === '') return 0;
  // A sign only where money puts one: (310), -310, -$310, $-310. A dash anywhere else
  // ("3-5") is not a number, and must not quietly become -35.
  var neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  if (s.charAt(0) === '-') { neg = !neg; s = s.slice(1); }
  if (s.charAt(0) === '$') s = s.slice(1);
  if (s.charAt(0) === '-') { neg = !neg; s = s.slice(1); }
  s = s.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  var n = Number(s);
  return neg ? -n : n;
}

/** 'YYYY-MM-DD' from a Date cell or a date-shaped string; '' when it is neither. */
function nwIsoDate_(v) {
  var s = dateCellToIso_(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/**
 * 'YYYY-MM' from a month cell. Sheets turns "2027-03" into a DATE on entry, which
 * dateCellToIso_ formats as 2027-03-01 — so take the first seven characters of
 * either shape. '' when it is not a month at all.
 */
function nwIsoMonth_(v) {
  var s = dateCellToIso_(v);
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : '';
}

/** TRUE/FALSE cells and their text forms. */
function nwBool_(v) {
  if (typeof v === 'boolean') return v;
  return /^(true|yes|y|1)$/i.test(String(v == null ? '' : v).trim());
}

function nwUnavailable_(reason) {
  return { status: 'unavailable', reason: reason };
}

// ============================================================
// SECTION PARSERS — each takes a tab's getValues() grid, never a Sheet
// ============================================================

/**
 * Balances: header row `Bucket key | Bucket | <owner> | <owner> | …`, one row per
 * bucket. Owners are whatever columns follow — not a hard-coded three — so a new
 * owner column appears rather than being dropped.
 *
 * Each bucket × owner cell becomes one row tagged with its asset class and tax
 * treatment from the Config mapping. A bucket with no mapping is tagged 'Unmapped'
 * rather than left out, so every grouping still adds up to the same total.
 */
function nwParseBalances_(grid, mapping) {
  if (!grid || grid.length < 1) return nwUnavailable_('the Balances tab is empty');
  var headers = grid[0];
  var keyCol  = nwCol_(headers, 'Bucket key');
  var lblCol  = nwCol_(headers, 'Bucket');
  if (keyCol === -1) return nwUnavailable_('couldn’t find a "Bucket key" column in Balances');
  if (lblCol === -1 || lblCol === keyCol) return nwUnavailable_('couldn’t find a "Bucket" column in Balances');

  var owners = [];
  headers.forEach(function(h, i) {
    if (i === keyCol || i === lblCol) return;
    var name = String(h == null ? '' : h).trim();
    if (name) owners.push({ name: name, col: i });
  });
  if (!owners.length) return nwUnavailable_('Balances has no owner columns');

  var cls = (mapping && mapping.cls) || {};
  var tax = (mapping && mapping.tax) || {};
  var rows = [], unmapped = [];

  for (var r = 1; r < grid.length; r++) {
    var key = String(grid[r][keyCol] == null ? '' : grid[r][keyCol]).trim();
    if (!key) continue;
    var label = String(grid[r][lblCol] == null ? '' : grid[r][lblCol]).trim() || key;
    var c = cls[key] || NW_UNMAPPED_;
    var t = tax[key] || NW_UNMAPPED_;
    if ((c === NW_UNMAPPED_ || t === NW_UNMAPPED_) && unmapped.indexOf(key) === -1) unmapped.push(key);

    for (var o = 0; o < owners.length; o++) {
      var amount = nwNumber_(grid[r][owners[o].col]);
      if (amount === null) {
        return nwUnavailable_('the ' + owners[o].name + ' balance for "' + label +
                              '" isn’t a number');
      }
      rows.push({ key: key, label: label, owner: owners[o].name, amount: amount, cls: c, tax: t });
    }
  }
  if (!rows.length) return nwUnavailable_('Balances has no bucket rows');

  return {
    status:   'ok',
    owners:   owners.map(function(x) { return x.name; }),
    rows:     rows,
    unmapped: unmapped,
  };
}

/**
 * Outputs: the planner's own summary, rewritten on every calculation — exactly the
 * tab a cell ref would betray first. Found by the row whose first column reads
 * "Net worth"; column B is the figure, column C the planner's own note on what it
 * includes and excludes, shown beside it so the two net-worth figures are explained
 * by the system that computed one of them.
 */
function nwParseOutputs_(grid) {
  if (!grid || !grid.length) return nwUnavailable_('the Outputs tab is empty');
  for (var r = 0; r < grid.length; r++) {
    if (nwNorm_(grid[r][0]) !== 'net worth') continue;
    var value = nwNumber_(grid[r][1]);
    if (value === null || String(grid[r][1] == null ? '' : grid[r][1]).trim() === '') {
      return nwUnavailable_('"Net worth" in Outputs has no number beside it');
    }
    return { status: 'ok', value: value, note: String(grid[r][2] == null ? '' : grid[r][2]).trim() };
  }
  return nwUnavailable_('couldn’t find "Net worth" in Outputs');
}

/**
 * Settings → asOfDate: when the BALANCES were entered. Deliberately not Meta's
 * updated_at, which moves whenever the planner recalculates — a recalculation over
 * month-old balances would read as fresh.
 */
function nwParseAsOf_(grid) {
  if (!grid || grid.length < 1) return nwUnavailable_('the Settings tab is empty');
  var keyCol = nwCol_(grid[0], 'Key');
  var valCol = nwCol_(grid[0], 'Value');
  if (keyCol === -1 || valCol === -1) return nwUnavailable_('couldn’t find Key and Value columns in Settings');
  for (var r = 1; r < grid.length; r++) {
    if (String(grid[r][keyCol] == null ? '' : grid[r][keyCol]).trim() !== 'asOfDate') continue;
    var iso = nwIsoDate_(grid[r][valCol]);
    return iso ? { status: 'ok', iso: iso } : nwUnavailable_('asOfDate in Settings isn’t a date');
  }
  return nwUnavailable_('couldn’t find asOfDate in Settings');
}

/** CDs: Name | Owner | Amount | APY % | Matures (YYYY-MM-DD). Rows missing a name are skipped. */
function nwParseCds_(grid) {
  if (!grid || grid.length < 1) return nwUnavailable_('the CDs tab is empty');
  var h = grid[0];
  var cols = { name: nwCol_(h, 'Name'), owner: nwCol_(h, 'Owner'), amount: nwCol_(h, 'Amount'),
               apy: nwCol_(h, 'APY'), matures: nwCol_(h, 'Matures') };
  var missing = Object.keys(cols).filter(function(k) { return cols[k] === -1; });
  if (missing.length) return nwUnavailable_('the CDs tab has no ' + missing.join(', ') + ' column');

  var items = [];
  for (var r = 1; r < grid.length; r++) {
    var name = String(grid[r][cols.name] == null ? '' : grid[r][cols.name]).trim();
    if (!name) continue;
    var amount = nwNumber_(grid[r][cols.amount]);
    var apy    = nwNumber_(grid[r][cols.apy]);
    items.push({
      name:    name,
      owner:   String(grid[r][cols.owner] == null ? '' : grid[r][cols.owner]).trim(),
      amount:  amount,
      apy:     apy,
      matures: nwIsoDate_(grid[r][cols.matures]),
    });
  }
  return { status: 'ok', items: items };
}

/** RSUs: Pays out (YYYY-MM) | Value before tax. No owner column — shown household-wide. */
function nwParseRsus_(grid) {
  if (!grid || grid.length < 1) return nwUnavailable_('the RSUs tab is empty');
  var mCol = nwCol_(grid[0], 'Pays out');
  var vCol = nwCol_(grid[0], 'Value before tax');
  if (mCol === -1 || vCol === -1) return nwUnavailable_('the RSUs tab has no "Pays out" or "Value before tax" column');
  var items = [];
  for (var r = 1; r < grid.length; r++) {
    var month = nwIsoMonth_(grid[r][mCol]);
    if (!month) continue;
    items.push({ month: month, value: nwNumber_(grid[r][vCol]) });
  }
  items.sort(function(a, b) { return a.month < b.month ? -1 : a.month > b.month ? 1 : 0; });
  return { status: 'ok', items: items };
}

/** Plan items: Item | Month | Amount | Category | Confidence | Can defer. All rows, month order. */
function nwParsePlans_(grid) {
  if (!grid || grid.length < 1) return nwUnavailable_('the Plan items tab is empty');
  var h = grid[0];
  var cols = { item: nwCol_(h, 'Item'), month: nwCol_(h, 'Month'), amount: nwCol_(h, 'Amount'),
               category: nwCol_(h, 'Category'), confidence: nwCol_(h, 'Confidence'),
               canDefer: nwCol_(h, 'Can defer') };
  var missing = Object.keys(cols).filter(function(k) { return cols[k] === -1; });
  if (missing.length) return nwUnavailable_('the Plan items tab has no ' + missing.join(', ') + ' column');
  var items = [];
  for (var r = 1; r < grid.length; r++) {
    var item = String(grid[r][cols.item] == null ? '' : grid[r][cols.item]).trim();
    if (!item) continue;
    items.push({
      item:       item,
      month:      nwIsoMonth_(grid[r][cols.month]),
      amount:     nwNumber_(grid[r][cols.amount]),
      category:   String(grid[r][cols.category] == null ? '' : grid[r][cols.category]).trim(),
      confidence: nwNorm_(grid[r][cols.confidence]),
      canDefer:   nwBool_(grid[r][cols.canDefer]),
    });
  }
  items.sort(function(a, b) { return a.month < b.month ? -1 : a.month > b.month ? 1 : 0; });
  return { status: 'ok', items: items };
}

/** The Config mapping, from `networth_class:<key>` and `networth_tax:<key>` rows. */
function nwMappingFromConfig_(cfg) {
  var out = { cls: {}, tax: {} };
  Object.keys(cfg || {}).forEach(function(k) {
    var v = String(cfg[k] == null ? '' : cfg[k]).trim();
    if (!v) return;
    if (k.indexOf('networth_class:') === 0) out.cls[k.slice('networth_class:'.length).trim()] = v;
    else if (k.indexOf('networth_tax:') === 0) out.tax[k.slice('networth_tax:'.length).trim()] = v;
  });
  return out;
}

// ============================================================
// READING THE SHEET — the only place it is opened
// ============================================================

/**
 * Each requested tab's values, by tab name. A tab that does not exist comes back
 * as null, which its parser turns into "unavailable" — never into a guess.
 *
 * READ-ONLY: getSheetByName and getDataRange().getValues(), nothing else.
 */
function nwReadTabs_(sheetId, tabNames) {
  var ss  = SpreadsheetApp.openById(sheetId);
  var out = {};
  tabNames.forEach(function(name) {
    var sh = ss.getSheetByName(name);
    out[name] = sh ? sh.getDataRange().getValues() : null;
  });
  return out;
}

/** The parsed sections the tab needs. Throws only if the sheet itself can't be opened. */
function readPlannerSheet_(sheetId, mapping) {
  var tabs = nwReadTabs_(sheetId, ['Balances', 'Outputs', 'Settings', 'CDs', 'RSUs', 'Plan items']);
  function missingTab(name) { return nwUnavailable_('the planner has no "' + name + '" tab'); }
  return {
    balances: tabs['Balances']   ? nwParseBalances_(tabs['Balances'], mapping) : missingTab('Balances'),
    planner:  tabs['Outputs']    ? nwParseOutputs_(tabs['Outputs'])            : missingTab('Outputs'),
    asOf:     tabs['Settings']   ? nwParseAsOf_(tabs['Settings'])              : missingTab('Settings'),
    cds:      tabs['CDs']        ? nwParseCds_(tabs['CDs'])                    : missingTab('CDs'),
    rsus:     tabs['RSUs']       ? nwParseRsus_(tabs['RSUs'])                  : missingTab('RSUs'),
    plans:    tabs['Plan items'] ? nwParsePlans_(tabs['Plan items'])           : missingTab('Plan items'),
  };
}

// ============================================================
// WEB ACTION — net_worth
// ============================================================

/**
 * The Net Worth tab's payload.
 *
 * Each CD is tagged with the cds bucket's class and tax treatment so the dashboard can
 * decide whether a filter includes it, using the same mapping as the balances.
 */
function webGetNetWorth_() {
  var cfg     = getConfigValues();
  var sheetId = String(cfg['planner_sheet_id'] || '').trim();
  if (!sheetId) return { ok: true, configured: false };

  var mapping = nwMappingFromConfig_(cfg);
  var data;
  try {
    data = readPlannerSheet_(sheetId, mapping);
  } catch (e) {
    recordApiHealth_(NW_HEALTH_SOURCE_, false, e.message, 0);
    return { ok: false, error: 'Couldn’t open the planner sheet: ' + e.message };
  }

  var problems = Object.keys(data).filter(function(k) { return data[k].status !== 'ok'; });
  recordApiHealth_(NW_HEALTH_SOURCE_, problems.length === 0,
                   problems.map(function(k) { return k + ': ' + data[k].reason; }).join('; '),
                   problems.length ? 0 : 200);

  if (data.cds.status === 'ok') {
    var cdsCls = mapping.cls['cds'] || NW_UNMAPPED_;
    var cdsTax = mapping.tax['cds'] || NW_UNMAPPED_;
    data.cds.items.forEach(function(cd) { cd.bucketKey = 'cds'; cd.cls = cdsCls; cd.tax = cdsTax; });
  }

  data.ok = true;
  data.configured = true;
  data.staleAfterDays = 60;
  return data;
}

// ============================================================
// NIGHTLY — CD maturity flag
// ============================================================

/** The flag key for one CD term. The maturity date is in it, so a rolled-over CD is a new flag. */
function nwCdFlagKey_(cd) {
  var slug = String(cd.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return NW_CD_FLAG_PREFIX_ + slug + '_' + cd.matures;
}

/**
 * The flags due tonight: one per CD maturing in the next 30 days.
 *
 * NAME AND DATE ONLY, by decision. A flag travels further than the tab — the Flags
 * list, the morning email, Chat's context — so it never carries the amount or APY.
 * test_networth.js asserts that, with a control that adds the amount back.
 */
function nwCdFlagsDue_(cds, todayIso) {
  var today = new Date(todayIso + 'T00:00:00');
  var due = [];
  (cds || []).forEach(function(cd) {
    if (!cd.name || !cd.matures) return;
    var days = Math.round((new Date(cd.matures + 'T00:00:00') - today) / 86400000);
    if (days < 0 || days > NW_CD_FLAG_DAYS_) return;
    var when = Utilities.formatDate(new Date(cd.matures + 'T12:00:00'), Session.getScriptTimeZone(), 'MMM d, yyyy');
    due.push({
      source:  'Finance',
      flag:    cd.name + ' matures ' + when + ': decide whether to roll it over.',
      reason:  'From the planner sheet’s CDs tab.',
      urgency: 'Medium',
      key:     nwCdFlagKey_(cd),
    });
  });
  return due;
}

/**
 * Raises each due CD flag ONCE — if any row already carries its key, in any state,
 * it is left alone. Resolving it means you've decided; it does not come back.
 *
 * This does NOT go through writeFlags(), deliberately. writeFlags also skips any key
 * sharing 60% of its words with an existing key, after stripping numbers and month
 * names — so "Capital One CD 1" and "Capital One CD 2 (14-month)" both reduce to
 * maturity/capital/one and the second CD would never be flagged, and a rolled-over CD
 * (same name, new date) would never flag again. Same row shape, exact keys only.
 */
function nwWriteCdFlags_(flagSheet, due, dateStr) {
  var lastRow = flagSheet.getLastRow();
  var keys = {};
  if (lastRow >= 2) {
    flagSheet.getRange(2, 10, lastRow - 1, 1).getValues().forEach(function(r) {
      keys[String(r[0] || '').trim()] = true;
    });
  }
  var written = 0;
  due.forEach(function(f) {
    if (keys[f.key]) return;
    var rand2 = String(Math.floor(Math.random() * 90) + 10);
    flagSheet.appendRow([
      'FLAG-' + dateStr.replace(/-/g, '') + '-' + rand2,
      dateStr, f.source, f.flag, f.reason, f.urgency,
      'No', '', 'No', f.key, '',
    ]);
    keys[f.key] = true;
    written++;
  });
  if (written > 0) { try { colorCodeFlags(flagSheet); } catch (e) {} }
  return written;
}

/** Nightly step. Reads only the CDs tab. */
function checkPlannerCdMaturity_() {
  var cfg     = getConfigValues();
  var sheetId = String(cfg['planner_sheet_id'] || '').trim();
  if (!sheetId) return;

  var cds;
  try {
    var tabs = nwReadTabs_(sheetId, ['CDs']);
    cds = tabs['CDs'] ? nwParseCds_(tabs['CDs']) : nwUnavailable_('the planner has no "CDs" tab');
  } catch (e) {
    recordApiHealth_(NW_HEALTH_SOURCE_, false, e.message, 0);
    Logger.log('checkPlannerCdMaturity_: couldn’t open the planner sheet — ' + e.message);
    return;
  }
  if (cds.status !== 'ok') {
    Logger.log('checkPlannerCdMaturity_: ' + cds.reason);
    return;
  }

  var suppressed = [];
  try { suppressed = getSuppressedKeyPatterns_(); } catch (e) {}
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var due = nwCdFlagsDue_(cds.items, dateStr).filter(function(f) {
    return suppressed.indexOf(f.key) === -1 && suppressed.indexOf('cd_maturity') === -1;
  });
  if (!due.length) return;

  var flagSheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!flagSheet) return;
  var written = nwWriteCdFlags_(flagSheet, due, dateStr);
  Logger.log('checkPlannerCdMaturity_: ' + written + ' CD maturity flag(s) raised, ' +
             (due.length - written) + ' already raised before.');
}

// ============================================================
// ONE-TIME SEEDING — the bucket → asset class / tax mapping
// ============================================================

/**
 * Writes the approved mapping rows into VERA's OWN Config tab, once.
 *
 * Once means once: a Script Property records that it ran, so a row you later delete
 * is not quietly put back by the next night's run. Within that single run, any key
 * already present is skipped, so a row you added by hand first is never overwritten.
 *
 * @returns {number} rows added (0 when it has already run)
 */
function seedNetWorthMappingConfig_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(NW_SEEDED_PROPERTY_)) return 0;

  var sheet = getSpreadsheet().getSheetByName(TABS.CONFIG);
  if (!sheet) return 0;

  var existing = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(r) {
      existing[String(r[0] || '').trim()] = true;
    });
  }
  var added = 0;
  NW_MAPPING_DEFAULTS_.forEach(function(pair) {
    if (existing[pair[0]]) return;
    sheet.appendRow(pair);
    added++;
  });
  props.setProperty(NW_SEEDED_PROPERTY_, new Date().toISOString());
  _configCache_ = null;
  Logger.log('seedNetWorthMappingConfig_: added ' + added + ' mapping row(s).');
  return added;
}
