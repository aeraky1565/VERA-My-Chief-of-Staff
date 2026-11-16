// ============================================================
// VERA — Neighborhood.js
// Home Front › Neighborhood, beyond the flyer routes in WebApp.js:
//   - two columns after Notes on NEIGHBORHOOD_FLYERS: Photo (a small JPEG thumbnail kept in
//     the cell, no Drive write) and Event ID (the Joint Chaos event made for it);
//   - Going puts the event on the Joint Chaos calendar; any other answer takes it off;
//   - the nightly clean-up of flyers more than 30 days past.
// ============================================================

var NB_PHOTO_COL_ = 13, NB_EVENT_COL_ = 14;
var NB_PHOTO_MAX_ = 45000;        // characters; a cell holds 50,000
var NB_KEEP_PAST_DAYS_ = 30;

/** Pure: a thumbnail the dashboard made: a JPEG data URL, small enough for one cell. */
function nbPhotoOk_(v) { var s = String(v || ''); return s.length <= NB_PHOTO_MAX_ && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(s); }

/** Pure: a Date cell or text as yyyy-MM-dd ('' when blank). */
function nbYmd_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim(); var m = /^(\d{4}-\d{2}-\d{2})/.exec(s); return m ? m[1] : s;
}

/** Pure: a flyer is cleared once it is more than 30 days past (never a recurring one, nor one with no date). */
function nbExpired_(date, recurring, todayIso) {
  if (String(recurring) === 'true' || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return false;
  var p = function(x) { var q = x.split('-'); return Date.UTC(+q[0], +q[1] - 1, +q[2]); };
  return (p(todayIso) - p(date)) / 86400000 > NB_KEEP_PAST_DAYS_;
}

function nbEnsureCols_(sh) {
  if (sh.getMaxColumns() < NB_EVENT_COL_) sh.insertColumnsAfter(sh.getMaxColumns(), NB_EVENT_COL_ - sh.getMaxColumns());
  var h = sh.getRange(1, NB_PHOTO_COL_, 1, 2).getValues()[0];
  if (!String(h[0]).trim() || !String(h[1]).trim()) sh.getRange(1, NB_PHOTO_COL_, 1, 2).setValues([['Photo', 'Event ID']]);
}

/** The Joint Chaos calendar (its name contains "joint chaos"), or null. */
function nbJointCal_() {
  var found = null;
  CalendarApp.getAllCalendars().forEach(function(c) { if (!found && String(c.getName()).toLowerCase().indexOf('joint chaos') !== -1) found = c; });
  return found;
}

/** Makes the event for a flyer on a calendar: timed (2 hours) when it has a time, else all day. */
function nbMakeEvent_(cal, f) {
  var title = '🏘 ' + (String(f.title || '').trim() || 'Neighborhood event');
  var opts = { location: String(f.location || ''), description: String(f.description || '') + '\n\nFrom VERA’s Neighborhood board.' };
  var t = String(f.time || '').trim(), m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (m) {
    var start = new Date(f.date + 'T' + ('0' + m[1]).slice(-2) + ':' + m[2] + ':00');
    return cal.createEvent(title, start, new Date(start.getTime() + 2 * 3600 * 1000), opts);
  }
  return cal.createAllDayEvent(title, new Date(f.date + 'T12:00:00'), opts);
}

/**
 * The RSVP's calendar side, for one flyer row: Going makes the Joint Chaos event (once);
 * anything else deletes the one VERA made. → {calendar: 'added'|'removed'|'kept'|'none', error?}
 */
function nbSyncRsvp_(sh, row, status) {
  nbEnsureCols_(sh);
  var hdrs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var vals = sh.getRange(row, 1, 1, Math.max(NB_EVENT_COL_, hdrs.length)).getValues()[0];
  var col = function(name, fb) { var i = hdrs.indexOf(name); return i < 0 ? fb : i; };
  var tz = Session.getScriptTimeZone();
  var f = { title: vals[col('Title', 1)], date: nbYmd_(vals[col('Date', 3)], tz), time: String(vals[col('Time', 4)] || ''), location: vals[col('Location', 5)], description: vals[col('Description', 6)] };
  var eventId = String(vals[NB_EVENT_COL_ - 1] || '').trim();
  if (status === 'Going') {
    if (eventId) return { calendar: 'kept' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return { calendar: 'none', error: 'No date on the flyer, so nothing went on the calendar.' };
    var cal = nbJointCal_();
    if (!cal) return { calendar: 'none', error: 'Couldn’t find the Joint Chaos calendar.' };
    var ev = nbMakeEvent_(cal, f);
    sh.getRange(row, NB_EVENT_COL_).setValue(ev.getId());
    return { calendar: 'added' };
  }
  if (!eventId) return { calendar: 'none' };
  try {
    var c = nbJointCal_(), e = c && c.getEventById(eventId);
    if (e) e.deleteEvent();
  } catch (err) { Logger.log('nbSyncRsvp_ remove: ' + err.message); }
  sh.getRange(row, NB_EVENT_COL_).setValue('');
  return { calendar: 'removed' };
}

/** Nightly: deletes flyers more than 30 days past (bottom-up, so row numbers hold). */
function purgeOldFlyers_() {
  var sh = getSpreadsheet().getSheetByName(TABS.NEIGHBORHOOD_FLYERS);
  if (!sh || sh.getLastRow() < 2) return { removed: 0 };
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var hdrs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var di = hdrs.indexOf('Date'), ri = hdrs.indexOf('Recurring');
  if (di < 0) di = 3; if (ri < 0) ri = 7;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(di, ri) + 1).getValues(), removed = 0;
  for (var i = rows.length - 1; i >= 0; i--) if (nbExpired_(nbYmd_(rows[i][di], tz), rows[i][ri], today)) { sh.deleteRow(i + 2); removed++; }
  return { removed: removed };
}
