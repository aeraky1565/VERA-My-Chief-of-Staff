// ============================================================
// VERA — Tax.js
// Finances › Tax: when each document arrived (a Received On column after Notes, stamped the
// first time a document leaves Not received), so next year's copy can say "Usually arrives late
// Jan" and get a Medium flag when it's two weeks later than that. The filing deadline is Apr 15
// of the year after the tax year. Once every document for the year is Verified (or Uploaded) and
// some aren't uploaded yet, the full Home's Needs you says "Send the documents to <preparer>".
// ============================================================

var TX_RECEIVED_COL_ = 11;          // after Notes (TAX_DOCUMENT_HEADERS has 10)
var TX_LATE_DAYS_ = 14;
var TX_FLAG_PREFIX_ = 'tax_late_';
var TX_DONE_ = { verified: true, uploaded: true };

function txYmd_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/** Pure: a document's match key across years: form, issuer, owner (case and spaces ignored). */
function txKey_(formType, issuer, owner) {
  return [formType, issuer, owner || 'Ahmed'].map(function(x) { return String(x || '').trim().toLowerCase().replace(/\s+/g, ' '); }).join('|');
}

/** Pure: an ISO date a year later (Feb 29 → Feb 28). */
function txNextYear_(iso) {
  var y = Number(iso.slice(0, 4)) + 1, m = iso.slice(5, 7), d = iso.slice(8, 10);
  if (m === '02' && d === '29') d = '28';
  return y + '-' + m + '-' + d;
}

/**
 * Pure: per document, when it usually arrives (last year's copy's Received On, a year on) and
 * how late it is. docs: [{id, taxYear, formType, issuer, owner, status, receivedOn}].
 * → { id: { expected, daysLate } } (daysLate null unless it's still not received and expected has passed)
 */
function txUsual_(docs, todayIso) {
  var last = {};
  (docs || []).forEach(function(d) { if (d.receivedOn) last[String(d.taxYear) + '|' + txKey_(d.formType, d.issuer, d.owner)] = d.receivedOn; });
  var at = function(x) { var p = x.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); };
  var out = {};
  (docs || []).forEach(function(d) {
    var prev = last[String(Number(d.taxYear) - 1) + '|' + txKey_(d.formType, d.issuer, d.owner)];
    if (!prev) return;
    var expected = txNextYear_(prev), late = Math.round((at(todayIso) - at(expected)) / 86400000);
    out[d.id] = { expected: expected, daysLate: (d.status || 'not_received') === 'not_received' && late > 0 ? late : null };
  });
  return out;
}

/** Pure: "early Jan" / "mid Feb" / "late Jan" for an ISO date. */
function txWhen_(iso) {
  var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1], d = Number(iso.slice(8, 10));
  return (d <= 10 ? 'early ' : d <= 20 ? 'mid ' : 'late ') + m;
}

/** Pure: the Needs you row for a tax year, or null. prep: the preparer record (may be null). */
function txNeeds_(docs, prep) {
  if (!docs || !docs.length) return null;
  var all = docs.every(function(d) { return TX_DONE_[d.status]; }), left = docs.filter(function(d) { return d.status !== 'uploaded'; }).length;
  if (!all || !left) return null;
  if (prep && /^(filed|complete)$/i.test(String(prep.filingStatus || ''))) return null;
  var who = prep ? (prep.type === 'Accountant' ? (prep.name || prep.firm || 'the preparer') : (prep.software || 'the tax software')) : 'the preparer';
  return { title: 'Send the documents to ' + who, sub: 'All ' + docs.length + ' tax documents are verified · ' + left + ' not uploaded yet' };
}

/** Adds and names Received On on a tab made before it. */
function txEnsureCol_(sh) {
  if (sh.getMaxColumns() < TX_RECEIVED_COL_) sh.insertColumnsAfter(sh.getMaxColumns(), TX_RECEIVED_COL_ - sh.getMaxColumns());
  if (!String(sh.getRange(1, TX_RECEIVED_COL_).getValue() || '').trim()) sh.getRange(1, TX_RECEIVED_COL_).setValue('Received On');
}

/** Stamps Received On (today) the first time a document leaves Not received; clears it when it goes back. */
function txStampReceived_(sh, row, oldStatus, newStatus) {
  if (newStatus === undefined || newStatus === oldStatus) return '';
  txEnsureCol_(sh);
  var cell = sh.getRange(row, TX_RECEIVED_COL_), today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (newStatus === 'not_received') { cell.setValue(''); return ''; }
  if ((oldStatus || 'not_received') === 'not_received' && !txYmd_(cell.getValue(), Session.getScriptTimeZone())) { cell.setValue(today); return today; }
  return '';
}

/** Every document with receivedOn, as webGetTaxDocuments_ reads them. */
function txAllDocs_() {
  var sh = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(TABS.TAX_DOCUMENTS);
  if (!sh || sh.getLastRow() < 2) return [];
  var tz = Session.getScriptTimeZone(), n = Math.min(TX_RECEIVED_COL_, sh.getMaxColumns());
  return sh.getRange(2, 1, sh.getLastRow() - 1, n).getValues().filter(function(r) { return r[0]; }).map(function(r) {
    return { id: r[0], taxYear: r[1], formType: r[2], issuer: r[3], account: r[4], category: r[5], status: r[6] || 'not_received', docLink: r[7], owner: r[8] || 'Ahmed', notes: r[9], receivedOn: n >= TX_RECEIVED_COL_ ? txYmd_(r[TX_RECEIVED_COL_ - 1], tz) : '' };
  });
}

/** Nightly: a Medium flag for each document two weeks later than it arrived last year; it closes once received. */
function checkTaxLate_() {
  var flagSheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!flagSheet) return { skipped: 'no flags tab' };
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), docs = txAllDocs_(), usual = txUsual_(docs, today), wanted = {};
  docs.forEach(function(d) {
    var u = usual[d.id];
    if (!u || u.daysLate == null || u.daysLate < TX_LATE_DAYS_) return;
    wanted[TX_FLAG_PREFIX_ + d.id] = { flag: '🧾 ' + d.formType + (d.issuer ? ' from ' + d.issuer : '') + ' is ' + u.daysLate + ' days later than last year',
      reason: 'Last year it arrived around ' + u.expected.slice(5) + ' (tax year ' + d.taxYear + ', ' + (d.owner || 'Ahmed') + '). Check the issuer’s site or ask for a copy.', urgency: 'Medium' };
  });
  upsertKeyedFlags_(flagSheet, TX_FLAG_PREFIX_, 'Tax', wanted, today);
  return { late: Object.keys(wanted).length };
}

/** GET tax_needs — the Needs you row for last tax year, or null. */
function webTaxNeeds_() {
  var year = new Date().getFullYear() - 1;
  var docs = txAllDocs_().filter(function(d) { return String(d.taxYear) === String(year); });
  var prep = null; try { prep = webGetTaxPreparer_({ parameter: { year: String(year) } }).preparer; } catch (e) { prep = null; }
  return { ok: true, year: year, row: txNeeds_(docs, prep) };
}
