// ============================================================
// VERA — Renewals.js  (issue #245)
// The Vehicles tab's dates: what's coming up, the flags, and a calendar reminder.
// ============================================================
//
// One set of rules serves three places: the nightly flags (checkVehicleRenewals_),
// the "Coming up" list on each vehicle card (webGetVehicles_ adds it as v.comingUp),
// and the calendar reminder (vehicle_renewal_ics).
//
// Dated items: Registration, Insurance, both warranties, Next Service, Emission and
// Safety inspections. From 30 days out: 30–15 Low, 14–8 Medium, 7 or fewer High; a
// passed date is High, "passed on <date>: renewed? Update the tab". Warranties stay
// Low: they flag in the 30 days before they end and the 30 after, then move to the
// card's History. A blank date never flags. One flag per vehicle per item, keyed
// vehicle_renewal_<id>_<item>_<date>: changing the date resolves it.
//
// Miles (card only): oil and tires, judged from Current Mileage. When the miles are
// over 30 days old (or never dated), the card says so and a monthly Low flag asks
// for them (vehicle_miles_<id>_<yyyy-MM>).
//
// The card's Renewed… / Done… buttons write to the Vehicles tab (VERA's own sheet):
// vehicle_renew and vehicle_service. VERA never writes to a calendar: the reminder
// is an .ics the dashboard downloads.
// ============================================================

var RENEWAL_ITEMS_ = [
  { key: 'registration', col: 'Registration Expiry',          label: 'Registration',              kind: 'renew',    verb: 'expires' },
  { key: 'insurance',    col: 'Insurance Expiry',             label: 'Insurance',                 kind: 'renew',    verb: 'expires' },
  { key: 'service',      col: 'Next Service',                 label: 'Service',                   kind: 'service',  verb: 'is due' },
  { key: 'emission',     col: 'Emission Inspection Expiry',   label: 'Emission inspection',       kind: 'renew',    verb: 'expires' },
  { key: 'safety',       col: 'Safety Inspection Expiry',     label: 'Safety inspection',         kind: 'renew',    verb: 'expires' },
  { key: 'warranty_b2b', col: 'Warranty Expiry (B2B)',        label: 'Bumper-to-bumper warranty', kind: 'warranty', verb: 'ends' },
  { key: 'warranty_pt',  col: 'Warranty Expiry (Powertrain)', label: 'Powertrain warranty',       kind: 'warranty', verb: 'ends' },
];
var RENEWAL_AHEAD_DAYS_ = 30;
var RENEWAL_MILES_STALE_DAYS_ = 30;
var RENEWAL_RANK_ = { high: 0, med: 1, low: 2, ok: 3 };
var RENEWAL_MONTHS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var RENEWAL_DAYS_ = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- pure ----------------------------------------------------------------------

/** Pure: 'yyyy-MM-dd' from a Date (its own calendar day) or text; '' when none. */
function renewalIso_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
  var s = String(v == null ? '' : v).trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  if (!s) return '';
  var d = new Date(s);
  return isNaN(d.getTime()) ? '' : renewalIso_(d);
}
function renewalUtc_(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function renewalDays_(fromIso, toIso) { return Math.round((renewalUtc_(toIso) - renewalUtc_(fromIso)) / 86400000); }
function renewalAddDays_(iso, n) { var d = new Date(renewalUtc_(iso) + n * 86400000); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
function renewalAddMonths_(iso, n) { var p = iso.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1)), last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + Math.min(p[2], last)).slice(-2); }
/** Pure: "Thu, Nov 26" (adds the year when it isn't this one). */
function renewalNice_(iso, todayIso) {
  var d = new Date(renewalUtc_(iso));
  return RENEWAL_DAYS_[d.getUTCDay()] + ', ' + RENEWAL_MONTHS_[d.getUTCMonth()] + ' ' + d.getUTCDate() + (todayIso && iso.slice(0, 4) !== todayIso.slice(0, 4) ? ', ' + iso.slice(0, 4) : '');
}
function renewalShort_(iso, todayIso) { var d = new Date(renewalUtc_(iso)); return RENEWAL_MONTHS_[d.getUTCMonth()] + ' ' + d.getUTCDate() + (todayIso && iso.slice(0, 4) !== todayIso.slice(0, 4) ? ', ' + iso.slice(0, 4) : ''); }

/** Pure: a vehicle's name: its Nickname, else year, make and model. */
function renewalVehicleName_(v) {
  var n = String((v && v['Nickname']) || '').trim();
  return n || [v && v['Year'], v && v['Make'], v && v['Model']].map(function(x) { return String(x == null ? '' : x).trim(); }).filter(Boolean).join(' ') || 'Vehicle';
}

/** Pure: the urgency for an item `days` away ('' = not flagged). */
function renewalUrgency_(kind, days) {
  if (days == null) return '';
  if (kind === 'warranty') return days <= RENEWAL_AHEAD_DAYS_ && days >= -RENEWAL_AHEAD_DAYS_ ? 'low' : '';
  if (days < 0 || days <= 7) return 'high';
  if (days <= 14) return 'med';
  if (days <= RENEWAL_AHEAD_DAYS_) return 'low';
  return '';
}

/**
 * Pure: everything coming up for one vehicle (an object keyed by Vehicles header).
 * → { coming: [items, soonest/most urgent first], history: [ended warranties],
 *     milesAge (days or null), milesStale }
 * item: { key, label, kind, date, days, miles, status: high|med|low|ok, chip, when, flag?, reason?, flagKey?, urgency? }
 */
function renewalItems_(v, todayIso) {
  var coming = [], history = [], name = renewalVehicleName_(v), id = String(v['ID'] || '').trim();
  RENEWAL_ITEMS_.forEach(function(it) {
    var date = renewalIso_(v[it.col]);
    if (!date) return;
    var days = renewalDays_(todayIso, date);
    if (it.kind === 'warranty' && days < -RENEWAL_AHEAD_DAYS_) { history.push({ key: it.key, label: it.label, date: date, when: 'Ended ' + renewalShort_(date, todayIso) }); return; }
    var urg = renewalUrgency_(it.kind, days);
    var item = { key: it.key, label: it.label, kind: it.kind, col: it.col, date: date, days: days, status: urg || 'ok' };
    if (days < 0) item.chip = it.kind === 'warranty' ? 'Ended' : it.kind === 'service' ? (-days) + (days === -1 ? ' day late' : ' days late') : 'Passed';
    else if (days === 0) item.chip = 'Today';
    else item.chip = urg ? days + (days === 1 ? ' day' : ' days') : 'OK';
    item.when = days < 0 ? (it.kind === 'warranty' ? 'Ended ' : it.kind === 'service' ? 'Was due ' : 'Passed ') + renewalShort_(date, todayIso) : renewalNice_(date, todayIso);
    if (urg) {
      var when = days === 0 ? 'today' : 'in ' + days + (days === 1 ? ' day' : ' days');
      item.urgency = urg === 'high' ? 'High' : urg === 'med' ? 'Medium' : 'Low';
      item.flagKey = 'vehicle_renewal_' + id + '_' + it.key + '_' + date;
      item.flag = days < 0
        ? (it.kind === 'warranty' ? name + ': ' + it.label.toLowerCase() + ' ended on ' + renewalShort_(date, todayIso)
          : it.kind === 'service' ? name + ': service was due ' + renewalShort_(date, todayIso) + ': done? Log it on the card'
          : name + ': ' + it.label.toLowerCase() + ' passed on ' + renewalShort_(date, todayIso) + ': renewed? Update the tab')
        : name + ': ' + it.label.toLowerCase() + ' ' + it.verb + ' ' + renewalNice_(date, todayIso) + ' (' + when + ')';
      item.reason = it.col + ' on the Vehicles tab is ' + renewalNice_(date, todayIso) + '.'
        + (days < 0 && it.kind !== 'warranty' ? ' Once it\'s done, update the date (Home Front › Vehicles); the flag goes by itself on the next run.' : '');
    }
    coming.push(item);
  });
  var cur = parseFloat(v['Current Mileage']);
  var mile = function(key, label, lastCol, intCol, dflt, medAt, lowAt) {
    var last = parseFloat(v[lastCol]);
    if (isNaN(cur) || isNaN(last)) return;
    var left = last + (parseFloat(v[intCol]) || dflt) - cur;
    var st = left < 0 ? 'high' : left <= medAt ? 'med' : left <= lowAt ? 'low' : 'ok';
    coming.push({ key: key, label: label, kind: 'miles', miles: Math.round(left), status: st,
      chip: left < 0 ? Math.abs(Math.round(left)).toLocaleString('en-US') + ' mi over' : '~' + Math.round(left).toLocaleString('en-US') + ' mi',
      when: (left < 0 ? 'Overdue' : 'In about ' + Math.round(left).toLocaleString('en-US') + ' mi') + ' · every ' + (parseFloat(v[intCol]) || dflt).toLocaleString('en-US') + ' mi' });
  };
  mile('oil', 'Oil change', 'Last Oil Change Mileage', 'Oil Interval (mi)', 5000, 500, 1000);
  mile('tires', 'Tires', 'Tires Last Replaced Mileage', 'Tire Interval (mi)', 50000, 1500, 3000);
  coming.sort(function(a, b) {
    var r = RENEWAL_RANK_[a.status] - RENEWAL_RANK_[b.status];
    if (r) return r;
    var ad = a.days == null ? 1e6 : a.days, bd = b.days == null ? 1e6 : b.days;
    return ad - bd || (a.miles == null ? 1e9 : a.miles) - (b.miles == null ? 1e9 : b.miles);
  });
  var mu = renewalIso_(v['Mileage Updated']);
  var milesAge = mu ? renewalDays_(mu, todayIso) : null;
  var hasMiles = !isNaN(cur);
  return { coming: coming, history: history, milesAge: milesAge, milesStale: hasMiles && (milesAge == null || milesAge > RENEWAL_MILES_STALE_DAYS_) };
}

/** Pure: the flags to hold across all vehicles: { renewals: {key: flag}, miles: {key: flag} }. */
function renewalWantedFlags_(vehicles, todayIso) {
  var out = { renewals: {}, miles: {} };
  (vehicles || []).forEach(function(v) {
    var id = String(v['ID'] || '').trim();
    if (!id) return;
    var r = renewalItems_(v, todayIso), name = renewalVehicleName_(v);
    r.coming.forEach(function(it) { if (it.flagKey) out.renewals[it.flagKey] = { flag: it.flag, reason: it.reason, urgency: it.urgency, due: it.date }; });
    if (r.milesStale) {
      out.miles['vehicle_miles_' + id + '_' + todayIso.slice(0, 7)] = { flag: name + ': update the miles',
        reason: (r.milesAge == null ? 'The miles have no date yet' : 'The miles were last updated ' + r.milesAge + ' days ago') + ', so the oil and tire reminders may be off. Home Front › Vehicles › Update miles.',
        urgency: 'Low' };
    }
  });
  return out;
}

/** Pure: the reminder's day: a week before the deadline, but never before today. */
function renewalReminderDay_(dateIso, todayIso) {
  var d = renewalAddDays_(dateIso, -7);
  return d < todayIso ? todayIso : d;
}

/** Pure: the calendar reminder for one item. → { filename, ics } */
function renewalIcs_(v, item, todayIso, stampIso) {
  var name = renewalVehicleName_(v);
  var title = (item.kind === 'service' ? 'Book service' : item.kind === 'warranty' ? item.label + ' ends' : 'Renew ' + item.label.toLowerCase()) + ' · ' + name;
  var day = renewalReminderDay_(item.date, todayIso);
  var esc = function(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); };
  var fold = function(line) { var out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); } out.push(line); return out.join('\r\n'); };
  var ymd = function(iso) { return iso.replace(/-/g, ''); };
  var stamp = (stampIso || new Date().toISOString()).replace(/[-:]/g, '').replace(/\.\d+/, '');
  var plate = String(v['License Plate'] || '').trim();
  var desc = (item.kind === 'warranty' ? 'Ends ' : item.kind === 'service' ? 'Due ' : 'Expires ') + renewalNice_(item.date, todayIso) + '.'
    + (plate ? ' Plate ' + plate + (v['State'] ? ' (' + String(v['State']).trim() + ')' : '') + '.' : '') + ' From VERA\'s Vehicles tab.';
  var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VERA//Renewals//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', 'UID:' + esc(String(v['ID'] || 'vehicle') + '-' + item.key + '-' + item.date) + '@vera-renewals', 'DTSTAMP:' + stamp,
    'DTSTART;VALUE=DATE:' + ymd(day), 'DTEND;VALUE=DATE:' + ymd(renewalAddDays_(day, 1)),
    'SUMMARY:' + esc(title), 'DESCRIPTION:' + esc(desc),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(title), 'TRIGGER:PT9H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'];
  var file = (title.replace(/ · /, ' ').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'reminder') + '.ics';
  return { filename: file, ics: L.map(fold).join('\r\n') + '\r\n', day: day, title: title };
}

var RENEWAL_BODIES_ = ['sedan', 'suv', 'truck', 'van', 'coupe'];
/** Pure: the card's icon: Body Type when set, else a guess from the model's name (sedan when unsure). */
function renewalBodyOf_(v) {
  var set = String((v && v['Body Type']) || '').trim().toLowerCase();
  if (RENEWAL_BODIES_.indexOf(set) !== -1) return set;
  var t = ' ' + [v && v['Model'], v && v['Nickname'], v && v['Notes']].join(' ').toLowerCase() + ' ';
  if (/\b(pickup|pick-up|truck|f-?150|silverado|ram 1500|tacoma|tundra|ranger|colorado|frontier|ridgeline|gladiator)\b/.test(t)) return 'truck';
  if (/\b(van|minivan|sienna|odyssey|pacifica|carnival|transit|sprinter)\b/.test(t)) return 'van';
  if (/\b(coupe|convertible|roadster|mustang|camaro|corvette|miata|911)\b/.test(t)) return 'coupe';
  if (/\b(suv|crossover|4x4|awd|explorer|highlander|rav4|cr-v|crv|pilot|tahoe|suburban|wrangler|grand cherokee|cherokee|outback|forester|rogue|tucson|santa fe|telluride|sorento|x3|x5|q5|q7|gx|rx)\b/.test(t)) return 'suv';
  return 'sedan';
}

/** Pure: the item a "Renewed…" may change, by its key ('' = not renewable that way). */
function renewalColumnFor_(key) {
  for (var i = 0; i < RENEWAL_ITEMS_.length; i++) if (RENEWAL_ITEMS_[i].key === key && RENEWAL_ITEMS_[i].kind !== 'service') return RENEWAL_ITEMS_[i].col;
  return '';
}

// ---- the reads and writes ----------------------------------------------------------

function renewalToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/** Nightly: one flag per vehicle per due item, and a monthly one for stale miles. */
function checkVehicleRenewals_() {
  if (typeof isNotifEnabled_ === 'function' && !isNotifEnabled_('vehicle_renewals')) return 'off';
  var vehicles = (webGetVehicles_().vehicles) || [];
  var today = renewalToday_();
  var w = renewalWantedFlags_(vehicles, today);
  var sheet = getSpreadsheet().getSheetByName(TABS.FLAGS);
  if (!sheet) return 'no Flags tab';
  upsertKeyedFlags_(sheet, 'vehicle_renewal_', 'Vehicles', w.renewals, today);
  upsertKeyedFlags_(sheet, 'vehicle_miles_', 'Vehicles', w.miles, today);
  return Object.keys(w.renewals).length + ' renewal flag(s), ' + Object.keys(w.miles).length + ' miles flag(s)';
}

function renewalVehicle_(id) {
  var vs = (webGetVehicles_().vehicles) || [];
  for (var i = 0; i < vs.length; i++) if (String(vs[i]['ID']).trim() === String(id || '').trim()) return vs[i];
  return null;
}

/** GET vehicle_renewal_ics?id=&item= → { ok, filename, ics } (the dates come from the sheet). */
function webVehicleRenewalIcs_(p) {
  p = p || {};
  var v = renewalVehicle_(p.id);
  if (!v) return { ok: false, error: 'No vehicle with that id' };
  var today = renewalToday_();
  var r = renewalItems_(v, today), item = null;
  r.coming.forEach(function(x) { if (x.key === p.item && x.date) item = x; });
  if (!item) return { ok: false, error: 'That vehicle has no date for ' + String(p.item || 'that item') };
  var c = renewalIcs_(v, item, today);
  return { ok: true, filename: c.filename, ics: c.ics, day: c.day, title: c.title };
}

/** GET vehicle_renew?id=&item=&date= → writes the new date to the Vehicles tab (VERA's own sheet). */
function webVehicleRenew_(p) {
  p = p || {};
  var id = String(p.id || '').trim(), col = renewalColumnFor_(String(p.item || '')), date = String(p.date || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  if (!col) return { ok: false, error: 'That item can\'t be renewed this way' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) return { ok: false, error: 'date must be YYYY-MM-DD' };
  return veraLocked_(function() {
    var sheet = getSpreadsheet().getSheetByName(TABS.VEHICLES);
    var f = {}; f[col] = date;
    if (!_vehicleSetFields_(sheet, id, f)) return { ok: false, error: 'No vehicle with that id' };
    return { ok: true, vehicle: renewalVehicle_(id) };
  });
}

/** GET vehicle_body?id=&body= → sets Body Type (the card's icon) on the Vehicles tab. */
function webVehicleBody_(p) {
  p = p || {};
  var id = String(p.id || '').trim(), body = String(p.body || '').trim().toLowerCase();
  if (!id) return { ok: false, error: 'id required' };
  if (RENEWAL_BODIES_.indexOf(body) === -1) return { ok: false, error: 'body must be one of ' + RENEWAL_BODIES_.join(', ') };
  return veraLocked_(function() {
    if (!_vehicleSetFields_(getSpreadsheet().getSheetByName(TABS.VEHICLES), id, { 'Body Type': body })) return { ok: false, error: 'No vehicle with that id' };
    return { ok: true, body: body };
  });
}
