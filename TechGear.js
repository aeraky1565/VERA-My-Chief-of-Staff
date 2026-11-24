// ============================================================
// VERA — TechGear.js
// Tech gear inside Home Front › Warranties & Service. A Home Items row whose
// Category is Tech (or Laptop, Tablet, Phone, Watch, Computer…) gets extra
// columns, appended after Manual and named on first use:
//   Owner | Model | Serial | Support Until | Support Source | Plan Name | Plan Until
// Other items leave them blank, so nothing changes for them.
//
//   - the read (WebApp.js webGetHomesteward_) adds them, plus isTech, supportDays, planDays;
//   - GET tech_item_save edits them on one row (checked against the item's name);
//   - GET tech_support_lookup asks Claude when the maker stops security updates
//     for a model. It's an estimate: the form fills Support Until and Support Source
//     ("estimate: <basis>"), and a date typed by hand is "you";
//   - nightly checkTechGear_: keyed flags TECH|plan|, TECH|support|, TECH|tradein|.
//     The warranty itself is already flagged for every item (checkWarrantiesExpiring_).
// ============================================================

var TG_FIRST_COL_ = 11;   // after Receipt (9) and Manual (10), HomeSteward.js
var TG_HEADERS_ = ['Owner', 'Model', 'Serial', 'Support Until', 'Support Source', 'Plan Name', 'Plan Until'];
var TG_LAST_COL_ = TG_FIRST_COL_ + TG_HEADERS_.length - 1;
var TG_FLAG_PREFIX_ = 'TECH|';
var TG_FLAG_SOURCE_ = 'Tech gear';
var TG_LEAD_ = { plan: 30, support: 90, tradein: 180 };

/** Pure: a category that means tech. */
function tgIsTech_(category) {
  return /\b(tech|laptops?|tablets?|phones?|smartphones?|watch(es)?|smartwatch(es)?|computers?|electronics)\b/i.test(String(category || ''));
}

/** Pure: a 'yyyy-MM-dd' (or a Date) as ISO, else ''. */
function tgIso_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** Pure: whole days from today to a date (negative when past), or null. */
function tgDays_(iso, today) {
  if (!iso || !today) return null;
  var p = function(x) { var q = String(x).split('-'); return Date.UTC(+q[0], +q[1] - 1, +q[2]); };
  return Math.round((p(iso) - p(today)) / 86400000);
}

/** Pure: plain text for a cell; refuses what a sheet would read as a formula. */
function tgText_(v, max) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 120);
  if (/^[=+@\-]/.test(s) && !/^-?\d/.test(s)) throw new Error('A value can’t start with ' + s.charAt(0));
  return s;
}

/** Pure: the tech fields from a request, cleaned. → {owner, model, serial, supportUntil, supportSource, planName, planUntil} */
function tgClean_(p) {
  p = p || {};
  var date = function(k) { var s = String(p[k] || '').trim(); if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(k + ' must be a date'); return s; };
  return {
    owner: tgText_(p.owner, 40), model: tgText_(p.model, 80), serial: tgText_(p.serial, 60),
    supportUntil: date('supportUntil'), supportSource: tgText_(p.supportSource, 160),
    planName: tgText_(p.planName, 60), planUntil: date('planUntil'),
  };
}

/** Pure: a cleaned set as the seven cells. */
function tgCells_(t) { return [t.owner, t.model, t.serial, t.supportUntil, t.supportSource, t.planName, t.planUntil]; }

/** Pure: the read's extra fields from a Home Items row (A..Q). */
function tgFields_(row, today) {
  var g = function(i) { return row.length > i ? row[i] : ''; }, b = TG_FIRST_COL_ - 1;
  var supportUntil = tgIso_(g(b + 3)), planUntil = tgIso_(g(b + 6));
  return {
    isTech: tgIsTech_(g(1)),
    owner: String(g(b) || '').trim(), model: String(g(b + 1) || '').trim(), serial: String(g(b + 2) || '').trim(),
    supportUntil: supportUntil, supportSource: String(g(b + 4) || '').trim(),
    planName: String(g(b + 5) || '').trim(), planUntil: planUntil,
    supportDays: tgDays_(supportUntil, today), planDays: tgDays_(planUntil, today),
  };
}

/** Names the tech columns on a tab made before they existed (and the link columns before them). */
function tgEnsureCols_(sheet) {
  if (typeof hsEnsureLinkCols_ === 'function') hsEnsureLinkCols_(sheet);
  if (sheet.getMaxColumns() < TG_LAST_COL_) sheet.insertColumnsAfter(sheet.getMaxColumns(), TG_LAST_COL_ - sheet.getMaxColumns());
  var h = sheet.getRange(1, TG_FIRST_COL_, 1, TG_HEADERS_.length).getValues()[0];
  if (h.some(function(x) { return !String(x).trim(); })) sheet.getRange(1, TG_FIRST_COL_, 1, TG_HEADERS_.length).setValues([TG_HEADERS_]);
}

/** Writes the tech cells on a row. */
function tgWrite_(sheet, rowNum, t) {
  tgEnsureCols_(sheet);
  sheet.getRange(rowNum, TG_FIRST_COL_, 1, TG_HEADERS_.length).setValues([tgCells_(t)]);
}

/** Pure: does a request carry any tech field? */
function tgAny_(p) { return ['owner', 'model', 'serial', 'supportUntil', 'planName', 'planUntil'].some(function(k) { return String((p || {})[k] || '').trim(); }); }

/** GET tech_item_save?row&item&owner&model&serial&supportUntil&supportSource&planName&planUntil */
function webTechItemSave_(e) {
  var p = (e && e.parameter) || {}, r = hsRow_(p), t;
  try { t = tgClean_(p); } catch (err) { return { ok: false, error: err.message }; }
  tgWrite_(r.sheet, r.rowNum, t);
  return { ok: true, item: r.item, tech: t };
}

/** Pure: the support-lookup prompt. */
function tgLookupPrompt_(item, model) {
  return 'When does the maker stop security / OS updates for this device?\n' +
    'Device: ' + String(item || '').slice(0, 80) + '\nModel: ' + String(model || '').slice(0, 80) + '\n\n' +
    'Use the maker\'s published support policy if there is one; otherwise estimate from its usual support length after release. ' +
    'Reply with JSON only: {"date":"yyyy-MM-dd","basis":"one short sentence on where the date comes from","confidence":"high|medium|low"}. ' +
    'If you can\'t tell at all, use "date":"".';
}

/** Pure: Claude's answer, checked. → {ok, date, basis, confidence} */
function tgLookupClean_(json) {
  json = json || {};
  var raw = String(json.date || '').trim(), date = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) date = raw;
  else if (/^\d{4}-\d{2}$/.test(raw)) { var q = raw.split('-'); date = new Date(Date.UTC(+q[0], +q[1], 0)).toISOString().slice(0, 10); }   // a month → its last day
  var conf = String(json.confidence || '').toLowerCase();
  return { ok: !!date, date: date, basis: String(json.basis || '').replace(/\s+/g, ' ').trim().slice(0, 140),
    confidence: ['high', 'medium', 'low'].indexOf(conf) !== -1 ? conf : 'low',
    error: date ? '' : 'VERA couldn’t find a support date for that model. Type one in if you know it.' };
}

/** GET tech_support_lookup?item&model — an estimate, nothing saved. */
function webTechSupportLookup_(e) {
  var p = (e && e.parameter) || {}, item = String(p.item || '').trim(), model = String(p.model || '').trim();
  if (!item && !model) return { ok: false, error: 'Give the device or its model first.' };
  var res = callClaudeJsonDetailed_(tgLookupPrompt_(item, model), { maxTokens: 300 });
  if (!res.json) return { ok: false, error: 'The lookup didn’t answer (' + (res.error || 'no reply') + '). Try again, or type the date.' };
  return tgLookupClean_(res.json);
}

/** Pure: the flags wanted for tech items on a day. items: from tgFields_ plus {item, warrantyExpiry}. → {key: {flag, reason, urgency}} */
function tgFlagsWanted_(items, today, lead) {
  lead = lead || TG_LEAD_;
  var wanted = {}, nice = function(iso) { return iso; };
  (items || []).forEach(function(it) {
    if (!it || !it.isTech || !it.item) return;
    var slug = hsSlug_(it.item), who = it.owner ? ' (' + it.owner + ')' : '';
    var pd = tgDays_(it.planUntil, today), sd = tgDays_(it.supportUntil, today);
    if (pd != null && pd >= 0 && pd <= lead.plan) wanted[TG_FLAG_PREFIX_ + 'plan|' + slug] = {
      flag: '🛡️ ' + it.item + who + ': ' + (it.planName || 'protection plan') + ' ends in ' + pd + ' day' + (pd === 1 ? '' : 's'),
      reason: 'Covered until ' + nice(it.planUntil) + '. Last chance for a free repair or battery swap. Home Front › Warranties & Service › Tech.',
      urgency: pd <= 7 ? 'High' : 'Medium' };
    if (sd != null && sd >= 0 && sd <= lead.support) wanted[TG_FLAG_PREFIX_ + 'support|' + slug] = {
      flag: '📵 ' + it.item + who + ': security updates end in ' + sd + ' day' + (sd === 1 ? '' : 's'),
      reason: 'Support until ' + nice(it.supportUntil) + (it.supportSource ? ' (' + it.supportSource + ')' : '') + '. Plan a replacement: the card has Add to Planned Purchases.',
      urgency: 'Low' };
    else if (sd != null && sd > lead.support && sd <= lead.tradein) wanted[TG_FLAG_PREFIX_ + 'tradein|' + slug] = {
      flag: '💱 ' + it.item + who + ': trade in or resell while it still gets updates',
      reason: 'Support ends ' + nice(it.supportUntil) + ', about ' + Math.round(sd / 30) + ' months away. A device still getting updates sells for more: the card has List on Resell.',
      urgency: 'Low' };
  });
  return wanted;
}

/** Nightly: the tech reminders. */
function checkTechGear_() {
  var ss = getSpreadsheet(), sheet = ss.getSheetByName(TABS.HOME_ITEMS), flagSheet = ss.getSheetByName(TABS.FLAGS);
  if (!sheet || !flagSheet) return { skipped: 'no tab' };
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var cols = Math.min(TG_LAST_COL_, sheet.getMaxColumns());
  var rows = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, cols).getValues() : [];
  var cfg = {}; try { cfg = getConfigValues() || {}; } catch (e) {}
  var num = function(k, d) { var n = Number(cfg[k]); return n > 0 && n <= 730 ? n : d; };
  var lead = { plan: num('tech_plan_days_ahead', TG_LEAD_.plan), support: num('tech_support_days_ahead', TG_LEAD_.support), tradein: num('tech_tradein_days_ahead', TG_LEAD_.tradein) };
  var items = rows.map(function(r) { var f = tgFields_(r, today); f.item = String(r[0] || '').trim(); return f; });
  var wanted = tgFlagsWanted_(items, today, lead);
  var suppressed = []; try { suppressed = getSuppressedKeyPatterns_(); } catch (e) {}
  Object.keys(wanted).forEach(function(k) { if (suppressed.indexOf(k) !== -1 || suppressed.indexOf('TECH') !== -1) delete wanted[k]; });
  upsertKeyedFlags_(flagSheet, TG_FLAG_PREFIX_, TG_FLAG_SOURCE_, wanted, today);
  return { tech: items.filter(function(i) { return i.isTech; }).length, flags: Object.keys(wanted).length };
}
