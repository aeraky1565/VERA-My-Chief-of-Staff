// ============================================================
// VERA — HealthAccounts.js
// FSA & HSA balances (Finances → FSA & HSA), one view for the household.
// ============================================================
//
// One card per account type, never one per person:
//   - The FSA is one shared election. Its balance is the election less the claims in the
//     household's FSA sheet (Config `fsa_sheet_id`), or a balance typed from the
//     provider's site, whichever is newer. Each claim keeps its Recipient as a tag, but
//     nothing is totalled per person.
//   - An HSA belongs to one person in law, but family coverage has ONE yearly limit the
//     two of you can split however you like. Every HSA listed is added into one card
//     against that limit, employer deposits (e.g. Verizon's) included.
//
// THE FSA SHEET IS SOMEONE ELSE'S EXPORT. VERA only reads it, and reads it by column
// header, never by cell position (the NetWorth.js rule): a header it can't find makes the
// claims unavailable, said so on the card, and the typed balance is used instead.
//
// Rows live in the Health Accounts tab (HEALTH_ACCOUNT_HEADERS, Code.js).
// ============================================================

// Yearly limits. Config overrides: fsa_limit_<year>, fsa_carryover_<year>,
// hsa_limit_self_<year>, hsa_limit_family_<year>. A year not listed uses the latest one.
var HA_LIMITS_ = {
  2026: { fsa: 3400, carry: 680, hsaSelf: 4400, hsaFamily: 8750 },
};
var HA_WARN_DAYS_  = 90;   // money that would be lost: flagged from this many days out
var HA_STALE_DAYS_ = 45;   // a typed balance this old is worth checking
var HA_RECENT_     = 8;    // claims listed on the card
var HA_FLAG_PREFIX_ = 'HSAFSA|';

// Claim statuses. Counted: money paid out or on its way. Not counted: claims that won't be
// paid. Anything else is counted (safer to under-state what's left) and listed.
var HA_COUNTED_RE_  = /paid|pend|submit|approv|process|review|receiv|reimburs/i;
var HA_EXCLUDED_RE_ = /den(y|ied)|reject|cancel|void|withdraw/i;

/** Pure: a cell as yyyy-MM-dd; '' when it isn't a date. Accepts Date, ISO and M/D/YYYY. */
function haYmd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  var s = String(v == null ? '' : v).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return m[3] + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
  return '';
}

/** Pure: '$1,234.50', '(40.00)', 40 → a number; NaN when it isn't one. */
function haMoney_(v) {
  if (typeof v === 'number') return v;
  var s = String(v == null ? '' : v).trim();
  if (!s) return NaN;
  var neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  var n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? NaN : (neg ? -n : n);
}

/** Pure: whole days from a to b (yyyy-MM-dd). */
function haDays_(a, b) {
  var p = function(s) { var x = String(s).split('-').map(Number); return Date.UTC(x[0], x[1] - 1, x[2]); };
  return Math.round((p(b) - p(a)) / 86400000);
}

/** The limits for a plan year, with Config overrides. */
function haLimits_(year, cfg) {
  var years = Object.keys(HA_LIMITS_).map(Number).sort();
  var base = HA_LIMITS_[year] || HA_LIMITS_[years.filter(function(y) { return y <= year; }).pop() || years[years.length - 1]];
  var out = { fsa: base.fsa, carry: base.carry, hsaSelf: base.hsaSelf, hsaFamily: base.hsaFamily };
  var o = function(key, field) { var n = haMoney_((cfg || {})[key + '_' + year]); if (!isNaN(n) && n > 0) out[field] = n; };
  o('fsa_limit', 'fsa'); o('fsa_carryover', 'carry'); o('hsa_limit_self', 'hsaSelf'); o('hsa_limit_family', 'hsaFamily');
  return out;
}

/**
 * Pure: the claims in an FSA export grid. The header row is the first row naming both an
 * Amount and a status column; Date of Service, Merchant/Provider, Recipient and Account
 * are optional. With an Account column, only rows naming `year` (e.g. "2026 Health Care…")
 * are kept, so last year's claims in the same sheet don't count.
 *
 * @returns {{status:'ok', claims:Array, total:number, unknownStatuses:Array}|{status:'unavailable', reason:string}}
 */
function haParseClaims_(grid, year) {
  if (!grid || !grid.length) return { status: 'unavailable', reason: 'the sheet is empty' };
  var norm = function(v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  var find = function(row, re) { for (var i = 0; i < row.length; i++) if (re.test(norm(row[i]))) return i; return -1; };
  var h = -1, col = {};
  for (var r = 0; r < Math.min(grid.length, 10) && h === -1; r++) {
    var amt = find(grid[r], /^amount\b|^claim amount|^amount paid/), st = find(grid[r], /status/);
    if (amt !== -1 && st !== -1) { h = r; col = { amount: amt, status: st, date: find(grid[r], /date/), who: find(grid[r], /merchant|provider|payee/), to: find(grid[r], /recipient|patient|for whom/), acct: find(grid[r], /^account|plan/) }; }
  }
  if (h === -1) return { status: 'unavailable', reason: 'couldn’t find an "Amount" and a "Claim Status" column' };
  var claims = [], total = 0, unknown = {};
  grid.slice(h + 1).forEach(function(row) {
    var amount = haMoney_(row[col.amount]);
    if (isNaN(amount)) return;
    if (year && col.acct !== -1) { var a = String(row[col.acct] || ''); if (/\b(19|20)\d{2}\b/.test(a) && a.indexOf(String(year)) === -1) return; }
    var status = String(row[col.status] == null ? '' : row[col.status]).trim();
    var counted = !HA_EXCLUDED_RE_.test(status);
    if (counted && !HA_COUNTED_RE_.test(status)) unknown[status || '(blank)'] = true;
    claims.push({ date: col.date === -1 ? '' : haYmd_(row[col.date]), provider: col.who === -1 ? '' : String(row[col.who] || '').trim(),
      recipient: col.to === -1 ? '' : String(row[col.to] || '').trim(), status: status, amount: Math.round(amount * 100) / 100, counted: counted });
    if (counted) total += amount;
  });
  claims.sort(function(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return { status: 'ok', claims: claims, total: Math.round(total * 100) / 100, unknownStatuses: Object.keys(unknown) };
}

/**
 * Pure: what one FSA card shows. The balance is the sheet's (election − counted claims),
 * unless a typed balance is newer than the newest claim; with no readable sheet, the typed
 * one; with neither, null.
 */
function haFsaView_(a, claims, today, lim) {
  var election = a.election || lim.fsa;
  var newest = claims && claims.status === 'ok' && claims.claims.length ? claims.claims[0].date : '';
  var typed = a.balance !== '' && a.balance !== null && !isNaN(a.balance) && a.balanceAsOf;
  var source = 'none', balance = null;
  if (claims && claims.status === 'ok' && !(typed && a.balanceAsOf > newest)) { source = 'sheet'; balance = Math.round((election - claims.total) * 100) / 100; }
  else if (typed) { source = 'typed'; balance = a.balance; }
  var rule = a.rule === 'grace' || a.rule === 'carry' ? a.rule : 'none';
  var useBy = rule === 'grace' && a.useBy ? a.useBy : a.year + '-12-31';
  var daysLeft = haDays_(today, useBy);
  var carry = rule === 'carry' ? (a.carryover || lim.carry) : 0;
  var atRisk = balance === null ? 0 : Math.max(0, Math.round((balance - carry) * 100) / 100);
  return {
    id: a.id, type: 'FSA', year: a.year, provider: a.provider, election: election,
    balance: balance, source: source, balanceAsOf: source === 'typed' ? a.balanceAsOf : newest,
    spent: balance === null ? null : Math.round((election - balance) * 100) / 100,
    rule: rule, useBy: useBy, daysLeft: daysLeft, carryover: carry, atRisk: atRisk,
    warn: daysLeft >= 0 && daysLeft <= HA_WARN_DAYS_ && atRisk > 0,
    stale: source === 'typed' && haDays_(a.balanceAsOf, today) >= HA_STALE_DAYS_,
    edit: a,
  };
}

/** Pure: every HSA listed, as one household card against one yearly limit. */
function haHsaView_(rows, today, lim) {
  if (!rows || !rows.length) return null;
  var sum = function(k) { return Math.round(rows.reduce(function(s, r) { return s + (Number(r[k]) || 0); }, 0) * 100) / 100; };
  var family = rows.length > 1 || rows.some(function(r) { return r.coverage === 'family'; });
  var limit = family ? lim.hsaFamily : lim.hsaSelf;
  var put = sum('contributed') + sum('employer');
  var asOf = rows.map(function(r) { return r.balanceAsOf || ''; }).sort()[0] || '';
  return {
    type: 'HSA', year: rows[0].year, ids: rows.map(function(r) { return r.id; }), accounts: rows.length,
    coverage: family ? 'family' : 'self', limit: limit,
    balance: sum('balance'), you: sum('contributed'), employer: sum('employer'),
    employerName: rows.map(function(r) { return r.employerName; }).filter(Boolean)[0] || '',
    room: Math.max(0, Math.round((limit - put) * 100) / 100), over: Math.max(0, Math.round((put - limit) * 100) / 100),
    balanceAsOf: asOf, stale: !!asOf && haDays_(asOf, today) >= HA_STALE_DAYS_,
    edits: rows,
  };
}

// ---- The tab ----------------------------------------------------------------

function haSheet_() {
  var ss = getSpreadsheet();
  return ss.getSheetByName(TABS.HEALTH_ACCOUNTS) || ensureSheet(ss, TABS.HEALTH_ACCOUNTS, HEALTH_ACCOUNT_HEADERS);
}

/** Every account row, as objects. */
function haReadAccounts_() {
  var sh = haSheet_();
  if (!sh || sh.getLastRow() < 2) return [];
  var n = function(v) { var x = haMoney_(v); return isNaN(x) ? '' : x; };
  return sh.getRange(2, 1, sh.getLastRow() - 1, HEALTH_ACCOUNT_HEADERS.length).getValues()
    .map(function(r, i) {
      return { id: String(r[0] || '').trim(), rowNum: i + 2, type: String(r[1] || '').trim().toUpperCase() === 'HSA' ? 'HSA' : 'FSA',
        year: parseInt(r[2], 10) || new Date().getFullYear(), provider: String(r[3] || '').trim(), election: n(r[4]),
        coverage: String(r[5] || '').trim().toLowerCase() === 'family' ? 'family' : 'self', contributed: n(r[6]), employer: n(r[7]),
        employerName: String(r[8] || '').trim(), balance: n(r[9]), balanceAsOf: haYmd_(r[10]),
        rule: String(r[11] || '').trim().toLowerCase(), useBy: haYmd_(r[12]), carryover: n(r[13]), notes: String(r[14] || '').trim() };
    }).filter(function(a) { return a.id; });
}

/** The FSA sheet's claims for a plan year; {status:'unconfigured'} with no sheet id. */
function haReadClaims_(cfg, year) {
  var sheetId = String((cfg || {})['fsa_sheet_id'] || '').trim();
  if (!sheetId) return { status: 'unconfigured' };
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sh = ss.getSheets()[0];
    return haParseClaims_(sh ? sh.getDataRange().getValues() : [], year);
  } catch (e) {
    return { status: 'unavailable', reason: 'VERA can’t open the FSA sheet (' + e.message + '). Share it with VERA’s Google account, Viewer is enough.' };
  }
}

/** GET health_accounts → the household's FSA and HSA cards. */
function webGetHealthAccounts_() {
  var cfg = getConfigValues(), today = hfToday_();
  var accts = haReadAccounts_();
  var claimsByYear = {};
  var fsa = accts.filter(function(a) { return a.type === 'FSA'; }).sort(function(a, b) { return b.year - a.year; }).map(function(a) {
    if (!claimsByYear[a.year]) claimsByYear[a.year] = haReadClaims_(cfg, a.year);
    var c = claimsByYear[a.year], v = haFsaView_(a, c, today, haLimits_(a.year, cfg));
    v.claims = c.status === 'ok' ? { status: 'ok', count: c.claims.length, recent: c.claims.slice(0, HA_RECENT_), unknownStatuses: c.unknownStatuses, total: c.total } : c;
    return v;
  });
  var hsaRows = accts.filter(function(a) { return a.type === 'HSA'; });
  var hsaYear = hsaRows.reduce(function(y, a) { return Math.max(y, a.year); }, 0);
  var hsa = haHsaView_(hsaRows.filter(function(a) { return a.year === hsaYear; }), today, haLimits_(hsaYear, cfg));
  return { ok: true, today: today, fsa: fsa, hsa: hsa, sheetLinked: !!String(cfg['fsa_sheet_id'] || '').trim(), limits: haLimits_(Number(today.slice(0, 4)), cfg) };
}

/** A row from request params, in HEALTH_ACCOUNT_HEADERS order. */
function haRowFrom_(p, id, prev) {
  prev = prev || {};
  var g = function(k, d) { return p[k] != null ? String(p[k]).trim() : (d == null ? '' : d); };
  var money = function(k, d) { var x = haMoney_(g(k, d)); return isNaN(x) ? '' : x; };
  var type = g('type', prev.type || 'FSA').toUpperCase() === 'HSA' ? 'HSA' : 'FSA';
  var bal = money('balance', prev.balance);
  var balChanged = p.balance != null && String(p.balance).trim() !== '';
  return [id, type, parseInt(g('year', prev.year), 10) || new Date().getFullYear(), g('provider', prev.provider), money('election', prev.election),
    g('coverage', prev.coverage || 'self') === 'family' ? 'family' : 'self', money('contributed', prev.contributed), money('employer', prev.employer),
    g('employerName', prev.employerName), bal, balChanged ? hfToday_() : (bal === '' ? '' : (prev.balanceAsOf || '')),
    ['none', 'grace', 'carry'].indexOf(g('rule', prev.rule)) !== -1 ? g('rule', prev.rule) : 'none', g('useBy', prev.useBy), money('carryover', prev.carryover), g('notes', prev.notes)];
}

/** GET health_account_save: no id adds an account; an id updates it (fields not sent are kept). */
function webSaveHealthAccount_(e) {
  var p = (e && e.parameter) || {}, sh = haSheet_();
  var id = String(p.id || '').trim();
  if (!id) {
    id = 'HA-' + Utilities.getUuid().slice(0, 8);
    sh.appendRow(haRowFrom_(p, id));
    return { ok: true, id: id, action: 'added' };
  }
  var a = haReadAccounts_().filter(function(x) { return x.id === id; })[0];
  if (!a) throw new Error('Account not found: ' + id);
  sh.getRange(a.rowNum, 1, 1, HEALTH_ACCOUNT_HEADERS.length).setValues([haRowFrom_(p, id, a)]);
  return { ok: true, id: id, action: 'updated' };
}

/** GET health_account_delete. */
function webDeleteHealthAccount_(e) {
  var id = String(((e && e.parameter) || {}).id || '').trim();
  var a = haReadAccounts_().filter(function(x) { return x.id === id; })[0];
  if (!a) throw new Error('Account not found: ' + id);
  haSheet_().deleteRow(a.rowNum);
  return { ok: true, id: id, action: 'deleted' };
}

// ---- Nightly flags ------------------------------------------------------------

/** Pure: the flags wanted for these cards. */
function haFlagsWanted_(view) {
  var wanted = {}, $ = function(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
  (view.fsa || []).forEach(function(f) {
    if (f.warn) wanted[HA_FLAG_PREFIX_ + f.id + '|lose'] = { urgency: 'Medium',
      flag: '💊 FSA: ' + $(f.atRisk) + ' would be lost',
      reason: $(f.balance) + ' left of ' + $(f.election) + (f.rule === 'carry' ? ', and only ' + $(f.carryover) + ' carries into ' + (f.year + 1) : '') +
        '. Spend the rest by ' + f.useBy + ' (' + f.daysLeft + ' days). See Finances → FSA & HSA.' };
    if (f.stale) wanted[HA_FLAG_PREFIX_ + f.id + '|stale'] = { urgency: 'Low',
      flag: '💊 FSA balance last updated ' + f.balanceAsOf,
      reason: 'Check the provider’s site and update it in Finances → FSA & HSA, or link the FSA sheet (Config fsa_sheet_id), so the deadline warning stays right.' };
  });
  if (view.hsa && view.hsa.stale) wanted[HA_FLAG_PREFIX_ + 'HSA|stale'] = { urgency: 'Low',
    flag: '💊 HSA balance last updated ' + view.hsa.balanceAsOf,
    reason: 'Update it in Finances → FSA & HSA so the room left under the limit stays right.' };
  return wanted;
}

/** Nightly step: refreshes the FSA/HSA flags; ones no longer wanted resolve. */
function haSyncFlags_() {
  var flags = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!flags) return { skipped: 'no Flags tab' };
  var view = webGetHealthAccounts_();
  var wanted = haFlagsWanted_(view);
  upsertKeyedFlags_(flags, HA_FLAG_PREFIX_, 'Finances', wanted, view.today);
  return { wanted: Object.keys(wanted).length };
}
