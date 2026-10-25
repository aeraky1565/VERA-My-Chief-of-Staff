// ============================================================
// VERA — TripShare.js
// Share or export a trip's itinerary (itinerary redesign, stage 5)
// ============================================================
//
// Everything that leaves VERA about a trip is built here, from the trip's own
// Itinerary rows, so the email, the printed sheet and the calendar file all say
// the same thing:
//
//   GET  trip_sheet           a printable trip sheet (also "Save offline" as PDF)
//   GET  trip_ics             one .ics file with every item, local times
//   POST trip_share_email     the itinerary as a clean email, .ics attached
//
// There is no calendar sync: whoever wants the trip in a shared calendar imports
// the .ics into it, so VERA never writes to a calendar it might later read back.
//
// What goes out is chosen by the person sending: whose plans (Both, Ahmed or
// Victoria), and whether confirmation numbers and notes/open decisions are in.
// Both are off by default. Nothing sent carries a link back into VERA or a
// token, and nothing is logged but counts.
// ============================================================

var ITIN_SHARE_STAY_TYPES_ = { hotel: 1, arranged_stay: 1, cruise: 1 };
var ITIN_SHARE_MOVE_TYPES_ = { flight: 1, train: 1, bus: 1, ferry: 1, car: 1, transport: 1, rental_car: 1, driving: 1 };
var ITIN_SHARE_MAX_TO_ = 10;

function shareMeta_(it) { try { return JSON.parse((it && it.metadata) || '{}') || {}; } catch (e) { return {}; } }
function shareEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function shareAddDays_(iso, n) {
  var p = iso.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
var SHARE_DOW_ = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var SHARE_MON_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shareDay_(iso) { var p = iso.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return { dow: SHARE_DOW_[d.getUTCDay()], mon: SHARE_MON_[p[1] - 1], num: p[2] }; }
function shareShort_(iso) { var d = shareDay_(iso); return d.mon + ' ' + d.num; }
function shareLong_(iso) { var d = shareDay_(iso); return d.dow + ', ' + d.mon + ' ' + d.num; }
// A city from an address, the same reading the dashboard's Summary uses (tsCity_).
function shareCity_(loc) {
  var parts = String(loc || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length >= 3 && !/\d/.test(parts[parts.length - 1]) && parts[parts.length - 1].length > 2) parts.pop();
  if (parts.length >= 2 && /^[A-Z]{2}(\s+[A-Z0-9]{2,4}\s*[A-Z0-9]{0,4}|\s+\d{5}(-\d{4})?)?$/.test(parts[parts.length - 1])) parts.pop();
  for (var i = parts.length - 1; i >= 0; i--) {
    var city = parts[i].split(/\s+/).filter(function(w) { return !/\d/.test(w); }).join(' ').trim();
    if (city && !(parts.length === 1 && city.length > 28)) return city;
  }
  return '';
}
function shareConf_(it) { var m = shareMeta_(it); return String(m.confirmation || m.confirmationNumber || '').trim(); }

/** The trip's own Itinerary rows, as plain objects. */
function tripShareItems_(tripKey) {
  var out = [];
  var sheet = getSpreadsheet().getSheetByName(TABS.ITINERARY);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var tz = Session.getScriptTimeZone();
  var d = function(v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v || '').trim(); };
  var t = function(v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'HH:mm') : String(v || '').trim(); };
  sheet.getRange(2, 1, sheet.getLastRow() - 1, ITINERARY_HEADERS.length).getValues().forEach(function(r) {
    if (!String(r[0]).trim() || String(r[1]).trim() !== tripKey) return;
    out.push({ id: String(r[0]).trim(), type: String(r[2] || ''), title: String(r[3] || ''), date: d(r[4]),
      startTime: t(r[5]), endTime: t(r[6]), location: String(r[7] || ''), notes: String(r[8] || ''), metadata: String(r[9] || '') });
  });
  return out;
}

/**
 * Pure: the items that go out. Whose plans: an item tagged for one traveler is
 * left out of the other's. Of a set of options, only the chosen one — or, while
 * still undecided, nothing unless notes and open decisions are asked for.
 */
function tripShareSelect_(items, opts) {
  opts = opts || {};
  var who = opts.who || 'Both';
  return (items || []).filter(function(it) {
    if (!it || !it.date) return false;
    var m = shareMeta_(it);
    var tv = m.traveler || 'Both';
    if (who !== 'Both' && tv !== 'Both' && tv !== who) return false;
    if (m.optionGroup && m.isRepresentative !== true) return false;
    if (m.tentative === true && m.decisionStatus !== 'decided' && !opts.notes) return false;
    return true;
  }).sort(function(a, b) { return (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')); });
}

/** Pure: what the email and the sheet show. */
function tripShareModel_(trip, items, opts) {
  opts = opts || {};
  var sel = tripShareSelect_(items, opts);
  var days = [];
  if (trip.startDate && trip.endDate) for (var dd = trip.startDate; dd <= trip.endDate && days.length < 120; dd = shareAddDays_(dd, 1)) days.push(dd);
  var stayOf = {};
  var stays = sel.filter(function(it) { return ITIN_SHARE_STAY_TYPES_[it.type]; }).map(function(it) {
    var out = shareMeta_(it).checkoutDate || shareAddDays_(it.date, 1);
    for (var x = it.date; x < out; x = shareAddDays_(x, 1)) if (!stayOf[x]) stayOf[x] = it;
    return { from: it.date, to: out, name: it.title || 'Stay', city: shareCity_(it.location), address: it.location || '',
      conf: opts.confirmations ? shareConf_(it) : '' };
  });
  var moves = sel.filter(function(it) { return ITIN_SHARE_MOVE_TYPES_[it.type]; }).map(function(it) {
    return { date: it.date, title: it.title || '', times: (it.startTime || '') + (it.endTime ? ' → ' + it.endTime : ''),
      conf: opts.confirmations ? shareConf_(it) : '' };
  });
  var title = String(trip.label || 'Our trip').replace(/^(vacation|trip|travel|holiday|road trip|potential)\s*[:\-–]\s*/i, '');
  // Where each day is, read as the Summary reads it: the stay that night, else
  // where the day's last move ends ("Train · Lisbon → Porto"), else an address
  // that day; a day with none takes the day before's, or the first day the next one's.
  var moveDest = function(it) { var parts = String(it.title || '').split(/\s*(?:→|->)\s*|\s+to\s+/);
    var c = parts.length > 1 ? shareCity_(parts[parts.length - 1].replace(/[()]/g, '')) : ''; return /^[A-Z]{3}$/.test(c) ? '' : c; };
  var cities = days.map(function(d, i) {
    if (i === days.length - 1) return 'Home';
    var c = stayOf[d] ? shareCity_(stayOf[d].location) : '';
    if (!c) sel.filter(function(x) { return x.date === d && ITIN_SHARE_MOVE_TYPES_[x.type]; }).forEach(function(x) { c = moveDest(x) || c; });
    if (!c) { var it = sel.filter(function(x) { return x.date === d && String(x.location || '').indexOf(',') !== -1; })[0]; c = it ? shareCity_(it.location) : ''; }
    return c;
  });
  for (var ci = 1; ci < cities.length; ci++) if (!cities[ci]) cities[ci] = cities[ci - 1];
  for (var cj = cities.length - 2; cj >= 0; cj--) if (!cities[cj]) cities[cj] = cities[cj + 1] !== 'Home' ? cities[cj + 1] : '';
  var glance = days.map(function(d, i) { return { date: d, dow: shareDay_(d).dow, num: shareDay_(d).num, city: cities[i] || shareCity_(title) || title }; });
  // A night flight is where you sleep that night.
  var inAir = {};
  sel.forEach(function(it) { if (it.type === 'flight' && it.startTime && it.endTime && it.endTime < it.startTime) inAir[it.date] = true; });
  var dayList = days.map(function(d, i) {
    var rows = sel.filter(function(it) { return it.date === d; }).map(function(it) {
      var stay = ITIN_SHARE_STAY_TYPES_[it.type];
      return { time: it.startTime || '', title: (stay ? 'Check in · ' : '') + (it.title || ''),
        sub: [it.endTime && !stay ? 'until ' + it.endTime : '', opts.notes && it.notes ? it.notes : ''].filter(Boolean).join(' · ') };
    });
    stays.forEach(function(s) { if (s.to === d) rows.unshift({ time: '', title: 'Check out · ' + s.name, sub: '' }); });
    var lastNight = i === days.length - 1;
    return { date: d, label: 'Day ' + (i + 1) + ' · ' + shareLong_(d), where: glance[i].city, rows: rows,
      tonight: lastNight || stayOf[d] || inAir[d] ? '' : 'Tonight: ' + (glance[i].city || 'to be booked') + ' (address to follow)' };
  });
  return { title: title,
    range: shareLong_(trip.startDate) + ' → ' + shareLong_(trip.endDate), nights: Math.max(0, days.length - 1),
    who: opts.who && opts.who !== 'Both' ? opts.who : '', glance: glance, stays: opts.stays === false ? [] : stays,
    moves: opts.moves === false ? [] : moves, days: dayList, note: String(opts.note || '').trim() };
}

/** Pure: the email-safe HTML of a model (inline styles, light background). */
function tripShareHtml_(m, opts) {
  opts = opts || {};
  var e = shareEsc_;
  var h = [];
  var H = function(s) { h.push(s); };
  var sec = function(t) { H('<tr><td style="padding:18px 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5b6478;">' + e(t) + '</td></tr>'); };
  H('<div style="background:#eef0f4;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2a44;">');
  H('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dfe3eb;border-radius:10px;"><tr><td style="padding:24px 28px;">');
  H('<table role="presentation" width="100%" cellpadding="0" cellspacing="0">');
  H('<tr><td style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9a7a2c;">' + (opts.print ? 'Trip sheet' : 'Our itinerary') + '</td></tr>');
  H('<tr><td style="font-size:26px;font-weight:700;color:#14213d;padding-top:4px;">' + e(m.title) + '</td></tr>');
  H('<tr><td style="font-size:14px;color:#4a5a80;padding-top:4px;">' + e(m.range) + ' · ' + m.nights + ' night' + (m.nights === 1 ? '' : 's') + (m.who ? ' · ' + e(m.who) + '\'s plans' : '') + '</td></tr>');
  if (m.note) H('<tr><td style="padding-top:14px;"><div style="font-size:15px;line-height:1.55;padding:12px 14px;background:#f6f7fa;border-radius:8px;">' + e(m.note).replace(/\n/g, '<br>') + '</div></td></tr>');
  if (m.glance.length) {
    sec('At a glance');
    H('<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="4"><tr>');
    m.glance.forEach(function(g) {
      H('<td style="background:#f1f3f8;border-radius:6px;text-align:center;font-size:11px;color:#4a5a80;padding:6px 2px;">' + e(g.dow) + '<br><b style="font-size:15px;color:#14213d;">' + g.num + '</b><br>' + e(g.city) + '</td>');
    });
    H('</tr></table></td></tr>');
  }
  var row = function(a, b, sub) {
    H('<tr><td style="padding:4px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
      + '<td width="88" valign="top" style="font-size:13px;color:#4a5a80;">' + e(a) + '</td>'
      + '<td valign="top" style="font-size:14px;line-height:1.45;">' + b + (sub ? '<div style="font-size:12px;color:#5b6478;">' + sub + '</div>' : '') + '</td></tr></table></td></tr>');
  };
  if (m.stays.length) {
    sec('Where we\'re staying');
    m.stays.forEach(function(s) {
      row(shareShort_(s.from) + '–' + shareShort_(s.to), '<b>' + e(s.name) + '</b>' + (s.city ? ', ' + e(s.city) : ''),
        [e(s.address), s.conf ? 'Confirmation ' + e(s.conf) : ''].filter(Boolean).join(' · '));
    });
  }
  if (m.moves.length) {
    sec('Flights, trains and transfers');
    m.moves.forEach(function(v) { row(shareShort_(v.date), '<b>' + e(v.title) + '</b>' + (v.times ? ' · ' + e(v.times) : ''), v.conf ? 'Confirmation ' + e(v.conf) : ''); });
  }
  sec('Day by day');
  m.days.forEach(function(d) {
    H('<tr><td style="border-top:1px solid #e3e6ee;padding:12px 0 4px;"><b style="font-size:15px;color:#14213d;">' + e(d.label) + '</b>'
      + (d.where ? ' <span style="font-size:13px;color:#5b6478;">· ' + e(d.where) + '</span>' : '') + '</td></tr>');
    if (!d.rows.length) H('<tr><td style="font-size:13px;color:#8a93a6;padding:2px 0;">Nothing planned</td></tr>');
    d.rows.forEach(function(r) { row(r.time, e(r.title), e(r.sub)); });
    if (d.tonight) H('<tr><td style="padding:4px 0;"><div style="font-size:13px;color:#2f5b3a;background:#eef7f0;border:1px solid #cfe6d5;border-radius:6px;padding:6px 10px;">' + e(d.tonight) + '</div></td></tr>');
  });
  H('<tr><td style="border-top:1px solid #e3e6ee;padding-top:12px;font-size:13px;color:#4a5a80;">'
    + (opts.ics ? 'Attached: a calendar file. Open it to add every day to your calendar.<br>' : '')
    + 'All times are local to where we are.<br><span style="font-size:12px;color:#8a93a6;">Sent with VERA.</span></td></tr>');
  H('</table></td></tr></table></div>');
  return h.join('');
}

/** Pure: plain text of a model, for mail clients that do not show HTML. */
function tripShareText_(m) {
  var out = [m.title, m.range, ''];
  if (m.note) out.push(m.note, '');
  if (m.stays.length) { out.push('WHERE WE\'RE STAYING'); m.stays.forEach(function(s) { out.push(shareShort_(s.from) + '–' + shareShort_(s.to) + '  ' + s.name + (s.city ? ', ' + s.city : '') + (s.address ? ' · ' + s.address : '') + (s.conf ? ' · Confirmation ' + s.conf : '')); }); out.push(''); }
  if (m.moves.length) { out.push('FLIGHTS, TRAINS AND TRANSFERS'); m.moves.forEach(function(v) { out.push(shareShort_(v.date) + '  ' + v.title + (v.times ? ' · ' + v.times : '') + (v.conf ? ' · Confirmation ' + v.conf : '')); }); out.push(''); }
  out.push('DAY BY DAY');
  m.days.forEach(function(d) { out.push('', d.label + (d.where ? ' · ' + d.where : '')); d.rows.forEach(function(r) { out.push('  ' + (r.time || '     ') + '  ' + r.title + (r.sub ? ' (' + r.sub + ')' : '')); }); if (d.tonight) out.push('  ' + d.tonight); });
  out.push('', 'All times are local to where we are.');
  return out.join('\n');
}

/** Pure: an iCalendar file with every item, in each item's own time zone where known. */
function tripShareIcs_(trip, items, opts, stampIso) {
  var sel = tripShareSelect_(items, opts);
  var esc = function(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); };
  var fold = function(line) { var out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); } out.push(line); return out.join('\r\n'); };
  var ymd = function(iso) { return iso.replace(/-/g, ''); };
  var hm = function(t) { var p = String(t).split(':'); return ('0' + p[0]).slice(-2) + ('0' + (p[1] || '0')).slice(-2) + '00'; };
  var stamp = (stampIso || new Date().toISOString()).replace(/[-:]/g, '').replace(/\.\d+/, '');
  var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VERA//Itinerary//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + esc(trip.label || 'Trip')];
  sel.forEach(function(it) {
    var m = shareMeta_(it);
    var conf = opts && opts.confirmations ? shareConf_(it) : '';
    var desc = [opts && opts.notes ? it.notes : '', conf ? 'Confirmation ' + conf : ''].filter(Boolean).join('\n');
    L.push('BEGIN:VEVENT', 'UID:' + esc(it.id || (it.date + it.title)) + '@vera-itinerary', 'DTSTAMP:' + stamp);
    if (ITIN_SHARE_STAY_TYPES_[it.type]) {
      L.push('DTSTART;VALUE=DATE:' + ymd(it.date), 'DTEND;VALUE=DATE:' + ymd(m.checkoutDate || shareAddDays_(it.date, 1)));
    } else if (it.startTime) {
      var tzS = m.startTz || m.timezone || '', tzE = m.endTz || tzS;
      var endDate = it.endTime && it.endTime < it.startTime ? shareAddDays_(it.date, 1) : it.date;
      L.push('DTSTART' + (tzS ? ';TZID=' + tzS : '') + ':' + ymd(it.date) + 'T' + hm(it.startTime));
      L.push('DTEND' + (tzE ? ';TZID=' + tzE : '') + ':' + ymd(endDate) + 'T' + hm(it.endTime || it.startTime));
    } else {
      L.push('DTSTART;VALUE=DATE:' + ymd(it.date), 'DTEND;VALUE=DATE:' + ymd(shareAddDays_(it.date, 1)));
    }
    L.push('SUMMARY:' + esc(it.title || 'Itinerary item'));
    if (it.location) L.push('LOCATION:' + esc(it.location));
    if (desc) L.push('DESCRIPTION:' + esc(desc));
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

function tripShareOpts_(p) {
  var inc = p.include || {};
  var flag = function(v, dflt) { return v === undefined || v === null || v === '' ? dflt : (v === true || v === 'true' || v === '1'); };
  return { who: ['Both', 'Ahmed', 'Victoria'].indexOf(p.who) !== -1 ? p.who : 'Both',
    stays: flag(inc.stays !== undefined ? inc.stays : p.stays, true), moves: flag(inc.moves !== undefined ? inc.moves : p.moves, true),
    confirmations: flag(inc.confirmations !== undefined ? inc.confirmations : p.conf, false),
    notes: flag(inc.notes !== undefined ? inc.notes : p.notes, false), note: String(p.note || '').slice(0, 1000) };
}
function tripShareTrip_(p) {
  return { tripKey: String(p.tripKey || '').trim(), label: String(p.label || String(p.tripKey || '').split('|')[1] || 'Trip'),
    startDate: String(p.startDate || '').trim(), endDate: String(p.endDate || '').trim() };
}

/** GET ?action=trip_sheet — the printable sheet; ?conf=1 for the offline copy. */
function webTripSheet_(p) {
  var trip = tripShareTrip_(p);
  if (!trip.tripKey) return { ok: false, error: 'tripKey required' };
  var opts = tripShareOpts_(p);
  var m = tripShareModel_(trip, tripShareItems_(trip.tripKey), opts);
  return { ok: true, title: m.title, html: tripShareHtml_(m, { print: true }) };
}

/** GET ?action=trip_ics — the calendar file. */
function webTripIcs_(p) {
  var trip = tripShareTrip_(p);
  if (!trip.tripKey) return { ok: false, error: 'tripKey required' };
  return { ok: true, filename: (trip.label.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'trip') + '.ics',
    ics: tripShareIcs_(trip, tripShareItems_(trip.tripKey), tripShareOpts_(p)) };
}

/** Pure: the recipients, checked. Up to ten, each a plain address. */
function tripShareRecipients_(to) {
  var list = (Array.isArray(to) ? to : String(to || '').split(/[,;\s]+/)).map(function(s) { return String(s).trim(); }).filter(Boolean);
  var bad = list.filter(function(s) { return !/^[^@\s<>"',;]+@[^@\s<>"',;]+\.[A-Za-z]{2,}$/.test(s); });
  if (!list.length) return { error: 'Add at least one email address.' };
  if (bad.length) return { error: 'These don\'t look like email addresses: ' + bad.join(', ') };
  if (list.length > ITIN_SHARE_MAX_TO_) return { error: 'Up to ' + ITIN_SHARE_MAX_TO_ + ' addresses at a time.' };
  return { list: list.filter(function(s, i) { return list.indexOf(s) === i; }) };
}

/** POST action=trip_share_email — sends the itinerary from the owner's Gmail, with a copy to them. */
function webTripShareEmail_(body) {
  var trip = tripShareTrip_(body);
  if (!trip.tripKey) return { ok: false, error: 'tripKey required' };
  var rcp = tripShareRecipients_(body.to);
  if (rcp.error) return { ok: false, error: rcp.error };
  var opts = tripShareOpts_(body);
  var items = tripShareItems_(trip.tripKey);
  var m = tripShareModel_(trip, items, opts);
  var attach = body.attachIcs !== false && body.attachIcs !== 'false';
  var options = { htmlBody: tripShareHtml_(m, { ics: attach }), name: 'VERA' };
  if (attach) options.attachments = [Utilities.newBlob(tripShareIcs_(trip, items, opts), 'text/calendar', (trip.label.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() || 'trip') + '.ics')];
  try { var me = Session.getEffectiveUser().getEmail(); if (me && rcp.list.indexOf(me) === -1) options.bcc = me; } catch (e) {}
  sendVeraEmail_(rcp.list.join(','), 'Our trip: ' + m.title + ', ' + shareShort_(trip.startDate) + '–' + shareShort_(trip.endDate),
    tripShareText_(m), options, 'trip_itinerary');
  return { ok: true, sent: rcp.list.length };
}
