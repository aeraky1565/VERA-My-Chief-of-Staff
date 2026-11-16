// ============================================================
// VERA — Appts.js
// Health › Appointments: appointments still come from calendar events (HealthTracker.js). Each
// person + appointment type can carry a typed Doctor and Phone, and a Booked On date, in a small
// Appointment Contacts tab (Person | Type | Doctor | Phone | Booked On), made on first save.
// "Book it" makes one Task "Call <doctor> to book <type>", with the phone in its notes.
// A booking counts until a visit after it shows up on the calendar.
// ============================================================

var APC_TAB_ = 'Appointment Contacts';
var APC_HEADERS_ = ['Person', 'Type', 'Doctor', 'Phone', 'Booked On'];
var APC_TASK_TAG_ = 'VERA appt book:';

/** Pure: the key for a person and an appointment type. */
function apcKey_(person, type) { return String(person || 'Ahmed').trim().toLowerCase() + '|' + String(type || '').trim().toLowerCase(); }

/** Pure: a phone number kept as typed, digits and + ( ) - . space only, at most 30. */
function apcPhone_(v) { return String(v == null ? '' : v).replace(/[^\d+()\-. ]/g, '').trim().slice(0, 30); }

/** Pure: whether a booking still counts: booked, and no visit on or after that day. */
function apcBooked_(bookedOn, lastVisit) { return !!bookedOn && (!lastVisit || String(lastVisit) < String(bookedOn)); }

/** Pure: the Task's words: "Call Dr. Lin to book a dental cleaning". */
function apcTaskText_(doctor, type) {
  var who = String(doctor || '').trim(); who = who ? (/^dr\.?\s/i.test(who) || /\b(clinic|office|center|centre|practice|group|hospital)\b/i.test(who) ? who : 'Dr. ' + who) : 'the office';
  var t = String(type || 'an appointment').trim().toLowerCase();
  return 'Call ' + who + ' to book ' + (/^(a|an|the)\s/.test(t) ? t : (/^[aeiou]/.test(t) ? 'an ' : 'a ') + t);
}

function apcSheet_(make) {
  var ss = getSpreadsheet(), sh = ss.getSheetByName(APC_TAB_);
  if (!sh && make) { sh = ss.insertSheet(APC_TAB_); sh.getRange(1, 1, 1, APC_HEADERS_.length).setValues([APC_HEADERS_]); }
  return sh;
}

/** key → {doctor, phone, bookedOn, row} */
function apcRead_() {
  var sh = apcSheet_(false), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var tz = Session.getScriptTimeZone();
  sh.getRange(2, 1, sh.getLastRow() - 1, APC_HEADERS_.length).getValues().forEach(function(r, i) {
    if (!String(r[1]).trim()) return;
    var b = r[4]; b = Object.prototype.toString.call(b) === '[object Date]' ? Utilities.formatDate(b, tz, 'yyyy-MM-dd') : String(b || '').slice(0, 10);
    out[apcKey_(r[0], r[1])] = { doctor: String(r[2] || '').trim(), phone: String(r[3] || '').trim(), bookedOn: b, row: i + 2 };
  });
  return out;
}

/** Sets fields on a person + type row, adding it when there's none. */
function apcSet_(person, type, fields) {
  return veraLocked_(function() {
    var sh = apcSheet_(true), cur = apcRead_()[apcKey_(person, type)];
    var row = cur ? cur.row : sh.getLastRow() + 1;
    var vals = [String(person || 'Ahmed').trim(), String(type).trim(), cur ? cur.doctor : '', cur ? cur.phone : '', cur ? cur.bookedOn : ''];
    if (fields.doctor !== undefined) vals[2] = String(fields.doctor).trim().slice(0, 80);
    if (fields.phone !== undefined) vals[3] = apcPhone_(fields.phone);
    if (fields.bookedOn !== undefined) vals[4] = fields.bookedOn;
    sh.getRange(row, 1, 1, APC_HEADERS_.length).setValues([vals]);
    return { doctor: vals[2], phone: vals[3], bookedOn: vals[4] };
  });
}

/** The calendar appointments with the typed doctor, phone and booking merged in. */
function apcMerged_() {
  var saved = {}; try { saved = apcRead_(); } catch (e) { saved = {}; }
  return getHealthAppointments_().map(function(a) {
    var s = saved[apcKey_(a.person, a.type)] || {};
    return Object.assign({}, a, { doctor: s.doctor || a.provider || '', phone: s.phone || '', bookedOn: s.bookedOn || '', booked: apcBooked_(s.bookedOn, a.lastVisit) });
  });
}

/** GET appt_contact — person, type, doctor, phone. */
function webApptContact_(e) {
  var p = (e && e.parameter) || {};
  if (!String(p.type || '').trim()) throw new Error('type is required');
  return Object.assign({ ok: true }, apcSet_(p.person, p.type, { doctor: p.doctor, phone: p.phone }));
}

/** GET appt_booked — person, type, on ('' to clear; default today). */
function webApptBooked_(e) {
  var p = (e && e.parameter) || {};
  if (!String(p.type || '').trim()) throw new Error('type is required');
  var on = p.on === '' ? '' : (/^\d{4}-\d{2}-\d{2}$/.test(String(p.on || '')) ? p.on : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  return Object.assign({ ok: true }, apcSet_(p.person, p.type, { bookedOn: on }));
}

/** GET appt_book — person, type: a Task to call and book (kept if one is open). → {ok, made, task} */
function webApptBook_(e) {
  var p = (e && e.parameter) || {}, type = String(p.type || '').trim(), person = String(p.person || 'Ahmed').trim();
  if (!type) throw new Error('type is required');
  var a = apcMerged_().filter(function(x) { return apcKey_(x.person, x.type) === apcKey_(person, type); })[0] || { doctor: '', phone: '' };
  var doctor = p.doctor !== undefined ? String(p.doctor).trim() : a.doctor, phone = p.phone !== undefined ? apcPhone_(p.phone) : a.phone;
  var sheet = getSpreadsheet().getSheetByName(TABS.TASKS);
  if (!sheet) throw new Error('Tasks tab not found');
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), tag = APC_TASK_TAG_ + apcKey_(person, type);
  var text = apcTaskText_(doctor, type) + (person !== 'Ahmed' ? ' for ' + person : '');
  var last = sheet.getLastRow(), rows = last >= 2 ? sheet.getRange(2, 1, last - 1, TASK_HEADERS.length).getValues() : [];
  for (var i = 0; i < rows.length; i++) if (String(rows[i][6] || '').indexOf(tag) !== -1 && String(rows[i][4]).trim() === 'Open') return { ok: true, made: false, task: String(rows[i][1]) };
  return veraLocked_(function() {
    var id = taskNextId_(sheet, Utilities.formatDate(new Date(), tz, 'yyyyMMdd'));
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, TASK_HEADERS.length).setValues([[id, text, today, today, 'Open', '',
      (phone ? '📞 ' + phone + ' · ' : '') + tag + ' (from Health › Appointments; tap Booked ✓ there once it’s on the calendar)', '', '']]);
    return { ok: true, made: true, task: text, phone: phone };
  });
}
