// ============================================================
// VERA — GiftNudge.js
// People › Important Dates: a birthday or anniversary 14 days away (or closer) with no gift idea
// for that person (one not yet given) gets a Low flag, which closes once an idea is added or the
// day passes. Runs nightly after checkImportantDates_.
// ============================================================

var GN_DAYS_ = 14;
var GN_PREFIX_ = 'no_gift_';

/** Pure: whether a label is a gift occasion (birthday or anniversary). */
function gnIsOccasion_(label) { return /birthday|b-?day|anniversar/i.test(String(label || '')); }

/** Pure: the dates (from webGetImportantDates_) that want the flag: an occasion within 14 days, no open idea for the person. */
function gnWanted_(dates, ideas) {
  var has = {};
  (ideas || []).forEach(function(i) { if (String(i['Given On'] || '').trim()) return; var p = String(i.Person || '').trim().toLowerCase(); if (p) has[p] = true; });
  return (dates || []).filter(function(d) {
    var p = String(d.Person || '').trim().toLowerCase();
    return d.ID && p && gnIsOccasion_(d.Label) && d.daysUntil != null && d.daysUntil >= 0 && d.daysUntil <= GN_DAYS_ && !has[p];
  });
}

/** Nightly: the Low "no gift idea yet" flags. */
function checkNoGiftIdea_() {
  var flagSheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!flagSheet) return { skipped: 'no flags tab' };
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), wanted = {};
  gnWanted_(webGetImportantDates_().dates || [], webGetGiftData_().ideas || []).forEach(function(d) {
    wanted[GN_PREFIX_ + d.ID + '_' + String(d.nextDate || today).slice(0, 4)] = {
      flag: '🎁 No gift idea yet: ' + d.Label + ' in ' + d.daysUntil + ' day' + (d.daysUntil === 1 ? '' : 's'),
      reason: d.Person + ' · ' + (d.nextDate || '') + '. Add an idea in People › Gift Ideas and this goes away.', urgency: 'Low' };
  });
  upsertKeyedFlags_(flagSheet, GN_PREFIX_, 'Important Dates', wanted, today);
  return { flagged: Object.keys(wanted).length };
}
