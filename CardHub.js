// ============================================================
// VERA — CardHub.js
// Nightly jobs for Finances › Cards: points that expire, status that renews, and the
// annual fee coming up against what the card's perks have paid back.
// ============================================================
//
// Flags (upsertKeyedFlags_, kept by nightly checks, so they clear themselves):
//   POINTS|EXP|<program id>|<date>     90 days before a program's points expire
//   POINTS|STATUS|<program id>|<date>  60 days before elite status renews
//   CARDFEE|<card id>|<yyyy-mm>        30 days before a card's annual fee posts
// The fee month comes from the card's Fee Month column, else its Notes ("fee in March").
// Perk Uses (WebApp.js cardPerkUseLog_) is seeded once from the perks already ticked
// this cycle, so "perks used this year" starts from what's known.
// ============================================================

var CH_POINTS_PREFIX_ = 'POINTS|';
var CH_FEE_PREFIX_    = 'CARDFEE|';
var CH_SEEDED_        = 'PERK_USES_SEEDED';

/** Pure: days from a to b (yyyy-MM-dd). */
function chDays_(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }

/** Pure: a month name or number ("March", "3", "2027-03") → 1–12, or 0. */
function chMonthOf_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return 0;
  var iso = /^\d{4}-(\d{2})/.exec(s); if (iso) return Number(iso[1]);
  if (/^\d{1,2}$/.test(s)) { var n = Number(s); return n >= 1 && n <= 12 ? n : 0; }
  var names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var i = names.indexOf(s.slice(0, 3)); return i === -1 ? 0 : i + 1;
}

/** Pure: the next date a fee posts in that month (the 1st), on or after today. */
function chNextFeeDate_(month, today) {
  var y = Number(today.slice(0, 4)), mm = ('0' + month).slice(-2), d = y + '-' + mm + '-01';
  return d < today.slice(0, 8) + '01' ? (y + 1) + '-' + mm + '-01' : d;
}

/**
 * Pure: the flags wanted tonight.
 * programs: [{ id, program, totalPoints, expiry, status, statusRenews }];
 * cards: [{ id, cardName, annualFee, feeMonth, notes, active, closed, perksUsedValue }].
 * → { key: { flag, reason, urgency, due } }
 */
function chWantedFlags_(programs, cards, today) {
  var out = {};
  (programs || []).forEach(function(p) {
    var exp = String(p.expiry || '').trim(), sr = String(p.statusRenews || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(exp) && (Number(p.totalPoints) || 0) > 0) {
      var d = chDays_(today, exp);
      if (d >= 0 && d <= 90) out[CH_POINTS_PREFIX_ + 'EXP|' + p.id + '|' + exp] = {
        flag: '🪙 ' + p.program + ' points expire in ' + d + ' day' + (d === 1 ? '' : 's'),
        reason: (Number(p.totalPoints) || 0).toLocaleString('en-US') + ' points expire on ' + exp + ' unless there’s activity: earn or redeem any amount to keep them.',
        urgency: d <= 30 ? 'High' : 'Medium', due: exp };
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(sr) && String(p.status || '').trim()) {
      var s = chDays_(today, sr);
      if (s >= 0 && s <= 60) out[CH_POINTS_PREFIX_ + 'STATUS|' + p.id + '|' + sr] = {
        flag: '🪙 ' + p.program + ' ' + p.status + ' renews in ' + s + ' day' + (s === 1 ? '' : 's'),
        reason: 'Status is assessed on ' + sr + '. Check what’s still needed to keep it.', urgency: 'Low', due: sr };
    }
  });
  (cards || []).forEach(function(c) {
    var fee = cvNum_(c.annualFee) || 0;
    if (!fee || !cvOpen_(c)) return;
    var m = chMonthOf_(c.feeMonth) || (typeof fsCardFeeMonth_ === 'function' ? fsCardFeeMonth_(c.notes) : 0);
    if (!m) return;
    var when = chNextFeeDate_(m, today), d = chDays_(today, when);
    if (d < 0 || d > 30) return;
    var used = Number(c.perksUsedValue) || 0;
    out[CH_FEE_PREFIX_ + c.id + '|' + when.slice(0, 7)] = {
      flag: '💳 ' + c.cardName + ' annual fee $' + fee + ' around ' + when,
      reason: 'Its perks have paid back $' + used + ' this year' + (used >= fee ? ', more than the fee.' : ', $' + (fee - used) + ' short of the fee. Worth a call to ask for a retention offer, or a downgrade.'),
      urgency: used >= fee ? 'Low' : 'Medium', due: when };
  });
  return out;
}

/**
 * The card tabs get any Card Hub columns they're missing (headers only, at the end), and
 * the two new tabs exist, so readers that size a range by the header lists never run past
 * the sheet.
 */
function chEnsureSchema_() {
  var ss = getSpreadsheet();
  try { ensureCreditCardSchema_(ss.getSheetByName(TABS.CREDIT_CARDS)); } catch (e) {}
  try { cardEnsureHeaders_(ss.getSheetByName(TABS.LOYALTY_PROGRAMS), LOYALTY_PROGRAM_HEADERS); } catch (e) {}
  try { cardEnsureHeaders_(ss.getSheetByName(TABS.REWARDS_GOALS), REWARDS_GOAL_HEADERS); } catch (e) {}
  try { ensureSheet(ss, TABS.POINTS_HISTORY, POINTS_HISTORY_HEADERS); ensureSheet(ss, TABS.PERK_USES, PERK_USE_HEADERS); } catch (e) {}
}

/** Nightly: the points and fee flags (they close themselves when they no longer apply). */
function checkCardHub_() {
  chEnsureSchema_();
  var d = webGetCards_();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var wanted = chWantedFlags_(d.programs, d.cards, today);
  var sheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!sheet) return { flags: 0 };
  var pts = {}, fees = {};
  Object.keys(wanted).forEach(function(k) { (k.indexOf(CH_FEE_PREFIX_) === 0 ? fees : pts)[k] = wanted[k]; });
  upsertKeyedFlags_(sheet, CH_POINTS_PREFIX_, 'Cards', pts, today);
  upsertKeyedFlags_(sheet, CH_FEE_PREFIX_, 'Cards', fees, today);
  return { flags: Object.keys(wanted).length };
}

/** Once: Perk Uses gets a row for each perk already ticked this cycle. */
function seedPerkUses_() {
  if (veraOnceGet_(CH_SEEDED_)) return { seeded: 0, already: true };
  chEnsureSchema_();
  var d = webGetCards_(), tz = Session.getScriptTimeZone(), now = new Date(), n = 0;
  (d.perks || []).forEach(function(p) {
    if (!p.lastUsed || p.autopay || p.frequency === 'Standing') return;
    if (!cardPerkIsUsed_(p.frequency, p.lastUsed, now, tz)) return;
    if (cardPerkUseLog_(p.id, p.lastUsed, true)) n++;
  });
  veraOnceSet_(CH_SEEDED_, Utilities.formatDate(now, tz, 'yyyy-MM-dd') + ' seeded ' + n);
  return { seeded: n };
}
