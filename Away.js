// ============================================================
// VERA — Away.js  (issue #246)
// Away mode: while you're on a trip, VERA holds what can wait.
// ============================================================
//
// What it is. Away mode is on while you're on a trip: automatically, for a trip in
// your calendars that you're on (Pacing.js's checkVacationMode_, from the Itinerary
// dates; Victoria-only trips don't count), or by hand from the dashboard, for a
// trip VERA can't see. The switch can also end it early.
//
// What it does while on:
//   - flags are still created in the Flags tab, but nothing escalates
//     (escalateAgedFlags_) and the morning Slack post isn't sent;
//   - each notification has a "while away" setting: send, hold, or due (send only
//     when its deadline falls before you're back). The defaults are on the
//     NOTIF_REGISTRY rows (Code.js); Config notif_<key>_while_away overrides one.
//     Held ones are counted, for the Home banner and the catch-up (#244);
//   - the morning email becomes the away edition: today's plan, your flights, and
//     only what got through. A flag gets through when it's High, from a source with
//     a deadline (bills, contracts, coupons, card perks, travel documents), and its
//     Due date (the Flags tab's Due column) falls before you're back.
//
// State lives in VERA_STATE_PACING (Settings.js): AWAY_MANUAL / AWAY_UNTIL /
// AWAY_TRIP for the switch, AWAY_ENDED_TRIP when a trip's automatic mode was
// ended early, AWAY_STARTED (the day it began), AWAY_HELD ({notif key: count}).
//
// Two layers: pure deciders (awayDecide_, awayHoldsDecide_, awayFlagGetsThrough_,
// awayEditionHtml_) and the reads and writes around them.
// ============================================================

var AWAY_DATED_PREFIXES_ = ['bill_due_', 'contract_expiry_', 'coupon_expiry_', 'perk_expiry_', 'tp_'];
var AWAY_POLICIES_ = ['send', 'hold', 'due'];

function awayToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function awayIso_(v) { var s = String(v == null ? '' : v).trim().slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }

/**
 * Pure: is Away mode on? st: the pacing state; today: 'yyyy-MM-dd'.
 * → { on, source: 'manual'|'auto'|'', until, trip, started }
 */
function awayDecide_(st, today) {
  st = st || {};
  var until = awayIso_(st.AWAY_UNTIL);
  if (st.AWAY_MANUAL === 'on' && (!until || today <= until)) {
    return { on: true, source: 'manual', until: until, trip: String(st.AWAY_TRIP || ''), started: awayIso_(st.AWAY_STARTED) };
  }
  var trip = String(st.VACATION_TRIP_NAME || '');
  if (st.VACATION_MODE_ACTIVE === 'true' && trip && trip !== String(st.AWAY_ENDED_TRIP || '')) {
    return { on: true, source: 'auto', until: awayIso_(st.VACATION_MODE_ENDS), trip: trip, started: awayIso_(st.AWAY_STARTED) };
  }
  return { on: false, source: '', until: '', trip: '', started: '' };
}

function awayStatus_() {
  try { return awayDecide_(veraStateGet_('PACING'), awayToday_()); }
  catch (e) { return { on: false, source: '', until: '', trip: '', started: '' }; }
}

/**
 * The manual switch. on: Away mode until `until` ('yyyy-MM-dd', optional), for `trip`
 * (optional). Off: ends it now, including the current trip's automatic mode.
 * → the new status.
 */
function awaySet_(on, until, trip) {
  var st = veraStateGet_('PACING'), today = awayToday_();
  if (on) {
    var was = awayDecide_(st, today).on;
    veraStateSet_('PACING', {
      AWAY_MANUAL: 'on', AWAY_UNTIL: awayIso_(until), AWAY_TRIP: String(trip || '').slice(0, 80),
      AWAY_ENDED_TRIP: null,
      AWAY_STARTED: was && st.AWAY_STARTED ? st.AWAY_STARTED : today,
      AWAY_HELD: was ? (st.AWAY_HELD || null) : null,
    });
  } else {
    veraStateSet_('PACING', {
      AWAY_MANUAL: null, AWAY_UNTIL: null, AWAY_TRIP: null,
      AWAY_ENDED_TRIP: st.VACATION_MODE_ACTIVE === 'true' ? (st.VACATION_TRIP_NAME || null) : null,
    });
  }
  return awayStatus_();
}

/** A notification's "while away" setting: send | hold | due. Config overrides the registry default. */
function notifWhileAway_(key) {
  var v = '';
  try { v = String((getConfigValues() || {})['notif_' + key + '_while_away'] || '').trim().toLowerCase(); } catch (e) { v = ''; }
  if (AWAY_POLICIES_.indexOf(v) !== -1) return v;
  var reg = (typeof NOTIF_REGISTRY !== 'undefined' && NOTIF_REGISTRY) || [];
  for (var i = 0; i < reg.length; i++) if (reg[i].key === key) return AWAY_POLICIES_.indexOf(reg[i].whileAway) !== -1 ? reg[i].whileAway : 'hold';
  return 'hold';
}

/** Pure: is this notification held right now? due: its deadline, 'yyyy-MM-dd' or ''. */
function awayHoldsDecide_(away, policy, due) {
  if (!away || !away.on) return false;
  if (policy === 'send') return false;
  if (policy === 'due') { var d = awayIso_(due); return !(d && (!away.until || d <= away.until)); }
  return true;
}

/** Held while away? Counts it when it is, for the banner and the catch-up. Never throws. */
function awayHolds_(key, due) {
  try {
    var held = awayHoldsDecide_(awayStatus_(), notifWhileAway_(key), due);
    if (held) awayNoteHeld_(key);
    return held;
  } catch (e) { return false; }
}

function awayNoteHeld_(key) {
  try {
    var m = awayHeldMap_();
    m[key] = (m[key] || 0) + 1;
    veraStateSet_('PACING', { AWAY_HELD: JSON.stringify(m) });
  } catch (e) {}
}
function awayHeldMap_() {
  try { var m = JSON.parse(veraStateGet_('PACING').AWAY_HELD || '{}'); return (m && typeof m === 'object') ? m : {}; } catch (e) { return {}; }
}

/** Pure: does an open flag get through while away? flag: { urgency, key, due }. */
function awayFlagGetsThrough_(flag, away) {
  if (!away || !away.on) return true;
  if (String(flag && flag.urgency) !== 'High') return false;
  var k = String(flag.key || '');
  if (!AWAY_DATED_PREFIXES_.some(function(p) { return k.indexOf(p) === 0; })) return false;
  var due = awayIso_(flag.due);
  return !!due && (!away.until || due <= away.until);
}

/**
 * Pure: what the banner and the catch-up count. flags: open flag rows as objects
 * { date, urgency, key, due }; held: AWAY_HELD. → { flags, reminders, nudges, total }
 * "flags" are those raised since Away mode began that didn't get through.
 */
var AWAY_REMINDER_KEYS_ = ['bill_due', 'home_service', 'contract_expiry', 'coupon_expiry', 'career_cert_expiry', 'packing_reminder', 'cycle_reminders', 'usps_mail', 'quarterly_checkin', 'goal_checkin', 'calendar_opportunity'];
function awayHeldSummary_(flags, held, away) {
  var since = (away && away.started) || '';
  var f = (flags || []).filter(function(x) { return (!since || awayIso_(x.date) >= since) && !awayFlagGetsThrough_(x, away); }).length;
  var reminders = 0, nudges = 0;
  Object.keys(held || {}).forEach(function(k) {
    var n = Number(held[k]) || 0;
    if (AWAY_REMINDER_KEYS_.indexOf(k) !== -1) reminders += n; else nudges += n;
  });
  return { flags: f, reminders: reminders, nudges: nudges, total: f + reminders + nudges };
}

/** Open flags as objects (unresolved, unacknowledged), with their Due date. */
function awayOpenFlags_() {
  var sh = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!sh || sh.getLastRow() < 2) return [];
  var w = FLAG_HEADERS.length, due = FLAG_HEADERS.indexOf('Due');
  return sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues().filter(function(r) {
    return String(r[8]).toLowerCase() !== 'yes' && String(r[6]).toLowerCase() !== 'yes';
  }).map(function(r) {
    var d = r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[1] || '');
    var dv = due === -1 ? '' : r[due];
    var di = dv instanceof Date ? Utilities.formatDate(dv, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(dv || '');
    return { date: d, source: String(r[2] || ''), flag: String(r[3] || ''), reason: String(r[4] || ''), urgency: String(r[5] || ''), key: String(r[9] || ''), due: di };
  });
}

/** For the dashboard: the status plus what's held. */
function awaySummary_() {
  var a = awayStatus_();
  if (!a.on) return { on: false };
  var flags = [];
  try { flags = awayOpenFlags_(); } catch (e) { flags = []; }
  var held = awayHeldSummary_(flags, awayHeldMap_(), a);
  return { on: true, source: a.source, until: a.until, trip: awayTripLabel_(a.trip), started: a.started, held: held,
           through: flags.filter(function(f) { return awayFlagGetsThrough_(f, a); }).length };
}

// ---- the morning email, away edition ----------------------------------------------

function awayEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** 'Sun, Nov 16' from 'yyyy-MM-dd' (no time zone shift: built from its parts). */
function awayNiceDate_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  var d = new Date(+m[1], +m[2] - 1, +m[3]);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ', ' +
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getDate();
}

/** Pure: whole days from a to b ('yyyy-MM-dd'), or null. */
function awayDaysBetween_(a, b) {
  var p = function(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  var x = p(a), y = p(b);
  return x === null || y === null ? null : Math.round((y - x) / 86400000);
}

/** Pure: the trip label without its date prefix ("2026-11-06|Island Cruise" → "Island Cruise"). */
function awayTripLabel_(trip) { var s = String(trip || ''); var i = s.indexOf('|'); return i === -1 ? s : s.slice(i + 1); }

/**
 * Pure: the away edition. d: { away, today, weatherHtml, today: 'yyyy-MM-dd', items: [{time, title, where}],
 * through: [{urgency, flag, reason, due}], flights: [{date, title, time}], held: {flags, reminders, nudges, total},
 * dashboardUrl } → { subject, html, text }
 */
function awayEditionHtml_(d) {
  var a = d.away || {}, label = awayTripLabel_(a.trip), held = d.held || { flags: 0, reminders: 0, nudges: 0, total: 0 };
  var n = a.started ? awayDaysBetween_(a.started, d.today) : null, N = (a.started && a.until) ? awayDaysBetween_(a.started, a.until) : null;
  var dayLine = (n !== null && N !== null && n >= 0 && N >= n) ? 'Day ' + (n + 1) + ' of ' + (N + 1) + (label ? ' of the <strong>' + awayEsc_(label) + '</strong>' : '') + '.'
              : (label ? 'On the <strong>' + awayEsc_(label) + '</strong>.' : 'You’re away.');
  var quiet = !(d.through && d.through.length);
  var heldBits = [];
  if (held.flags) heldBits.push(held.flags + ' flag' + (held.flags === 1 ? '' : 's'));
  if (held.reminders) heldBits.push(held.reminders + ' reminder' + (held.reminders === 1 ? '' : 's'));
  if (held.nudges) heldBits.push(held.nudges + ' nudge' + (held.nudges === 1 ? '' : 's'));
  var label12 = function(t) { return '<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:1.5px;color:#8a94a6;">' + t + '</p>'; };
  var sec = [];
  sec.push('<p style="margin:0 0 6px;font-size:17px;font-weight:600;color:#0d1b3e;">Good morning, Ahmed.</p>' +
    '<p style="margin:0 0 18px;font-size:15px;color:#555555;">' + dayLine + (quiet ? ' Nothing needs you today.' : ' Everything that can wait, is waiting.') + '</p>');
  sec.push('<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td style="padding:12px 14px;background:#f2f6ff;border-left:4px solid #0d1b3e;border-radius:6px;">' +
    '<span style="font-size:14px;font-weight:600;color:#0d1b3e;">✈️ Away mode on' + (a.until ? ' until ' + awayEsc_(awayNiceDate_(a.until)) : '') + '</span><br>' +
    '<span style="font-size:13px;color:#5a6680;line-height:1.6;">Slack is quiet and nothing escalates.' +
    (held.total ? ' <strong>' + held.total + ' item' + (held.total === 1 ? '' : 's') + ' held</strong> for when you’re back: ' + heldBits.join(', ') + '.' : '') + '</span>' +
    (d.dashboardUrl ? '<br><a href="' + awayEsc_(d.dashboardUrl) + '" style="font-size:12px;color:#0d1b3e;">End away mode early →</a>' : '') +
    '</td></tr></table>');
  if (d.items && d.items.length) {
    sec.push(label12('TODAY') + '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;font-size:14px;color:#333333;">' +
      d.items.map(function(it, i) {
        var b = i ? 'border-top:1px solid #f0f0f5;' : '';
        return '<tr><td style="padding:6px 0;width:78px;color:#777777;vertical-align:top;' + b + '">' + awayEsc_(it.time || '') + '</td><td style="padding:6px 0;' + b + '">' + awayEsc_(it.title) + (it.where ? ' · ' + awayEsc_(it.where) : '') + '</td></tr>';
      }).join('') + '</table>');
  }
  if (!quiet) {
    sec.push(label12('NEEDS YOU BEFORE YOU’RE BACK') + d.through.map(function(f) {
      return '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr><td style="padding:12px 14px;background:#fff5f5;border-left:4px solid #e53935;border-radius:6px;">' +
        '<span style="font-size:14px;font-weight:600;color:#9b1c1c;">High · ' + awayEsc_(f.flag) + (f.due ? ' · due ' + awayEsc_(awayNiceDate_(f.due)) : '') + '</span>' +
        (f.reason ? '<br><span style="font-size:13px;color:#7a4b4b;">' + awayEsc_(f.reason) + '</span>' : '') + '</td></tr></table>';
    }).join('') + '<div style="height:14px"></div>');
  }
  if (d.flights && d.flights.length) {
    sec.push(label12('YOUR FLIGHTS') + '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:26px;font-size:14px;color:#333333;">' +
      d.flights.map(function(f) { return '<tr><td style="padding:6px 0;">' + awayEsc_(awayNiceDate_(f.date)) + (f.time ? ' ' + awayEsc_(f.time) : '') + ' · ' + awayEsc_(f.title) + '</td></tr>'; }).join('') + '</table>');
  }
  if (d.dashboardUrl) sec.push('<table cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr><td style="background:#0d1b3e;border-radius:6px;padding:10px 18px;"><a href="' + awayEsc_(d.dashboardUrl) + '" style="color:#ffffff;font-size:14px;text-decoration:none;font-weight:600;">Open VERA Dashboard →</a></td></tr></table>');
  var html = '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f0f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f5;padding:24px 0;"><tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">' +
    '<tr><td style="padding:22px 40px;background:#0d1b3e;text-align:center;"><span style="color:#ffffff;font-size:26px;font-weight:bold;letter-spacing:4px;">VERA</span><br><span style="color:#c9a84c;font-size:11px;letter-spacing:2px;">AWAY EDITION</span></td></tr>' +
    (d.weatherHtml || '') +
    '<tr><td style="padding:30px 40px 8px;">' + sec.join('') + '</td></tr>' +
    '<tr><td style="padding:16px 40px;background:#f7f7fa;border-top:1px solid #eeeeee;"><p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">' +
    (held.total ? 'The ' + held.total + ' held item' + (held.total === 1 ? '' : 's') + ' arrive' + (held.total === 1 ? 's' : '') + ' in “While you were away”, the morning after you’re home.' : 'Held items arrive in “While you were away”, the morning after you’re home.') +
    '</p></td></tr></table></td></tr></table></body></html>';
  var text = ['VERA · Away edition', dayLine.replace(/<[^>]+>/g, ''), 'Away mode on' + (a.until ? ' until ' + awayNiceDate_(a.until) : '') + '. Slack is quiet and nothing escalates.' + (held.total ? ' ' + held.total + ' held.' : '')]
    .concat((d.items || []).map(function(it) { return '- ' + (it.time ? it.time + ' ' : '') + it.title; }))
    .concat(quiet ? [] : ['Needs you before you’re back:'].concat(d.through.map(function(f) { return '- ' + f.flag + (f.due ? ' (due ' + f.due + ')' : ''); })))
    .join('\n');
  return { subject: '✈️ VERA · Away edition' + (label ? ' — ' + label : '') + ' · ' + awayNiceDate_(d.today), html: html, text: text };
}

/** The away edition's data, from the sheet and the trip. */
function awayEditionData_() {
  var a = awayStatus_(), today = awayToday_(), tz = Session.getScriptTimeZone();
  var flags = [];
  try { flags = awayOpenFlags_(); } catch (e) { flags = []; }
  var iso = function(v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : awayIso_(v); };
  var time = function(v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'h:mm a') : String(v || '').trim(); };
  var rows = [];
  try {
    if (a.source === 'auto' && a.trip) rows = readTripRows_(a.trip);
    else {
      var sh = getSpreadsheet().getSheetByName(TABS.ITINERARY);
      if (sh && sh.getLastRow() >= 2) rows = sh.getRange(2, 1, sh.getLastRow() - 1, ITINERARY_HEADERS.length).getValues();
    }
  } catch (e) { rows = []; }
  // Itinerary: ID, Trip Key, Type, Title, Date, Start Time, End Time, Location, …
  var items = rows.filter(function(r) { return iso(r[4]) === today; })
    .map(function(r) { return { time: time(r[5]), title: String(r[3] || ''), where: String(r[7] || '') }; });
  var flights = rows.filter(function(r) { var d = iso(r[4]); return /flight/i.test(String(r[2] || '')) && d >= today && (!a.until || d <= a.until); })
    .map(function(r) { return { date: iso(r[4]), time: time(r[5]), title: String(r[3] || '') }; });
  var weatherHtml = '';
  try { weatherHtml = getWeatherTicker_([]) || ''; } catch (e) { weatherHtml = ''; }
  var url = '';
  try { url = veraSetting_('VERA_DASHBOARD_URL'); } catch (e) { url = ''; }
  return {
    away: a, today: today, items: items, flights: flights, weatherHtml: weatherHtml, dashboardUrl: url,
    through: flags.filter(function(f) { return awayFlagGetsThrough_(f, a); }),
    held: awayHeldSummary_(flags, awayHeldMap_(), a),
  };
}

/** Sends the away edition in place of the morning briefing (Code.js morningNudge). */
function sendAwayEditionEmail_() {
  var e = awayEditionHtml_(awayEditionData_());
  sendVeraEmail_(CONFIG.MORNING_NUDGE_EMAIL, e.subject, e.text, { name: 'VERA', htmlBody: e.html }, 'morning_briefing');
  Logger.log('morningNudge: away edition sent');
  return e;
}
