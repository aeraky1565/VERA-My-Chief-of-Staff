// ============================================================
// VERA — Eyes.js
// Health › Care › Eyes: glasses and contacts prescriptions for each person, read from a photo or a
// PDF (Claude fills the numbers; anything it wasn't sure of is marked for you to check), the usual
// brands and stores, and the orders that tell VERA how long the contacts last.
//
//   Eye Rx       one row per prescription; the newest saved for a person + kind is the current one,
//                earlier ones are its history. The photo lives in a private Drive folder.
//   Eye Usual    what each person buys (contacts, frames, solution) and where.
//   Eye Orders   what was bought, when, how many boxes per eye: the supply left and the reorder date.
//
// The yearly exam isn't kept here: it comes from Appointments ("DR: <person> - Eye Exam" events)
// and Book it uses Appointments' own appt_book. Nightly checkEyes_ flags a prescription 45 days
// before it expires and contacts with fewer than 21 days left; each flag closes itself.
// ============================================================

var EY_RX_TAB_ = 'Eye Rx';
var EY_RX_HEADERS_ = ['ID', 'Person', 'Kind', 'Exam', 'Expires', 'Doctor', 'OD SPH', 'OD CYL', 'OD AXIS', 'OD ADD', 'OS SPH', 'OS CYL', 'OS AXIS', 'OS ADD',
  'PD', 'BC', 'DIA', 'Lens', 'Wear', 'Photo', 'Notes', 'Updated'];
var EY_USUAL_TAB_ = 'Eye Usual';
var EY_USUAL_HEADERS_ = ['ID', 'Person', 'What', 'Brand', 'Pack', 'Days per pack', 'Store', 'Link', 'Price'];
var EY_ORDER_TAB_ = 'Eye Orders';
var EY_ORDER_HEADERS_ = ['ID', 'Person', 'Date', 'What', 'Boxes per eye', 'Store', 'Cost', 'Paid with', 'Notes'];
var EY_FOLDER_ = 'VERA Eye Prescriptions';
var EY_FLAG_PREFIX_ = 'EYES|';
var EY_EXPIRY_LEAD_DAYS_ = 45, EY_SUPPLY_LEAD_DAYS_ = 21, EY_REORDER_DAYS_ = 14;
var EY_MAX_B64_ = 14000000;   // ~10 MB
var EY_MIMES_ = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
// The numbers a prescription carries, by kind (the dashboard shows the same).
var EY_FIELDS_ = { glasses: ['odSph', 'odCyl', 'odAxis', 'odAdd', 'osSph', 'osCyl', 'osAxis', 'osAdd', 'pd'],
                   contacts: ['odSph', 'odCyl', 'odAxis', 'osSph', 'osCyl', 'osAxis', 'bc', 'dia'] };
var EY_COLS_ = { odSph: 6, odCyl: 7, odAxis: 8, odAdd: 9, osSph: 10, osCyl: 11, osAxis: 12, osAdd: 13, pd: 14, bc: 15, dia: 16 };

function eyText_(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }
function eyYmd_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = eyText_(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

// ---- pure ------------------------------------------------------------------------------------

/** Pure: a lens power as the optician writes it: "-2.25", "+0.50", "plano"/"pl" → "0.00". null if not a number. */
function eyPower_(v) {
  var s = eyText_(v).replace(/[−–]/g, '-').replace(/^\+/, '');
  if (/^(pl|plano|0|0\.0+)$/i.test(s)) return '0.00';
  var n = Number(s);
  if (s === '' || !isFinite(n)) return null;
  return (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n).toFixed(2);
}

/**
 * Pure: the fields read (or typed) for one prescription → { values, unsure: [field] }.
 * A power must be a multiple of 0.25 within ±20, an axis 0–180, ADD 0–4, PD 40–80, BC 7.5–10, DIA 12–16;
 * anything else, or anything the reader itself marked, is unsure (kept as typed, for you to check).
 */
function eyRxClean_(kind, raw, readUnsure) {
  raw = raw || {}; var vals = {}, unsure = (readUnsure || []).slice();
  var mark = function(f) { if (unsure.indexOf(f) === -1) unsure.push(f); };
  (EY_FIELDS_[kind] || []).forEach(function(f) {
    var t = eyText_(raw[f]);
    if (!t || t === '—' || t === '-') { vals[f] = ''; return; }
    if (/Sph|Cyl|Add/.test(f)) {
      var p = eyPower_(t), n = Number(p);
      if (p == null || Math.abs(n) > 20 || Math.abs(Math.round(n * 4) - n * 4) > 1e-9 || (/Add/.test(f) && (n < 0 || n > 4))) { vals[f] = t; mark(f); }
      else vals[f] = p;
      return;
    }
    var x = Number(t.replace(/[^\d.]/g, ''));
    var ok = /Axis/.test(f) ? (Math.round(x) === x && x >= 0 && x <= 180) : f === 'pd' ? (x >= 40 && x <= 80) : f === 'bc' ? (x >= 7.5 && x <= 10) : (x >= 12 && x <= 16);
    if (!isFinite(x) || !ok) { vals[f] = t; mark(f); } else vals[f] = /Axis/.test(f) ? String(x) : String(x);
  });
  // A cylinder needs an axis, and the other way round.
  ['od', 'os'].forEach(function(e) { var c = vals[e + 'Cyl'], a = vals[e + 'Axis'];
    if (c && Number(c) !== 0 && !a) mark(e + 'Axis'); if (a && !c) mark(e + 'Cyl'); });
  return { values: vals, unsure: unsure.filter(function(f) { return (EY_FIELDS_[kind] || []).indexOf(f) !== -1; }) };
}

/** Pure: when a prescription runs out. Typed date wins; else glasses 2 years and contacts 1 year from the exam. */
function eyExpiry_(kind, exam, typed, years) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(eyText_(typed))) return eyText_(typed);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eyText_(exam))) return '';
  var y = (years && years[kind]) || (kind === 'contacts' ? 1 : 2);
  return (Number(exam.slice(0, 4)) + y) + exam.slice(4);
}

function eyUtc_(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
function eyDays_(fromIso, toIso) { return Math.round((eyUtc_(toIso) - eyUtc_(fromIso)) / 86400000); }
function eyAddDays_(iso, n) { var d = new Date(eyUtc_(iso) + n * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }

/**
 * Pure: how long a person's contacts last. The last contacts order (boxes per eye) × the usual
 * contacts' days per pack, from that order's date. → { lastOrder, lastsTo, daysLeft, reorderBy } or null.
 */
function eySupply_(person, orders, usual, today) {
  var mine = (orders || []).filter(function(o) { return o.person === person && /contact/i.test(o.what) && /^\d{4}-\d{2}-\d{2}$/.test(o.date); })
    .sort(function(a, b) { return a.date < b.date ? 1 : -1; });
  var u = (usual || []).filter(function(x) { return x.person === person && /contact/i.test(x.what) && Number(x.daysPerPack) > 0; })[0];
  if (!mine.length || !u) return null;
  var o = mine[0], days = Math.round(Number(o.boxes || 0) * Number(u.daysPerPack));
  if (!(days > 0)) return null;
  var lastsTo = eyAddDays_(o.date, days);
  return { lastOrder: o.date, boxes: Number(o.boxes), lastsTo: lastsTo, daysLeft: eyDays_(today, lastsTo), reorderBy: eyAddDays_(lastsTo, -EY_REORDER_DAYS_), store: u.store, link: u.link };
}

/** Pure: what changed from the last prescription of that kind → [{field, from, to}]. */
function eyDiff_(kind, prev, next) {
  if (!prev) return [];
  return (EY_FIELDS_[kind] || []).filter(function(f) { return eyText_(prev[f]) !== eyText_(next[f]) && (eyText_(prev[f]) || eyText_(next[f])); })
    .map(function(f) { return { field: f, from: eyText_(prev[f]), to: eyText_(next[f]) }; });
}

/** Pure: a prescription as one line to paste into an online order. */
function eyCopyText_(rx) {
  var eye = function(e) { var s = rx[e + 'Sph'] || '0.00', c = rx[e + 'Cyl'], a = rx[e + 'Axis'], ad = rx[e + 'Add'];
    return e.toUpperCase() + ' ' + s + (c ? ' ' + c + ' x' + a : '') + (ad ? ' ADD ' + ad : ''); };
  var tail = rx.kind === 'contacts' ? [rx.bc ? 'BC ' + rx.bc : '', rx.dia ? 'DIA ' + rx.dia : '', rx.lens].filter(Boolean).join(' · ') : (rx.pd ? 'PD ' + rx.pd : '');
  return [eye('od'), eye('os'), tail].filter(Boolean).join(' · ') + (rx.expires ? ' · expires ' + rx.expires : '');
}

/** Pure: the flags wanted today. rxCurrent: current prescriptions; supply: { person: eySupply_ }. */
function eyFlags_(rxCurrent, supply, today) {
  var wanted = {};
  (rxCurrent || []).forEach(function(r) {
    if (!r.expires) return;
    var d = eyDays_(today, r.expires);
    if (d > EY_EXPIRY_LEAD_DAYS_) return;
    var what = (r.kind === 'contacts' ? 'contacts' : 'glasses') + ' prescription';
    wanted[EY_FLAG_PREFIX_ + 'exp|' + r.id] = { flag: '👓 ' + r.person + '’s ' + what + (d < 0 ? ' expired ' + (-d) + ' day' + (d === -1 ? '' : 's') + ' ago' : d === 0 ? ' expires today' : ' expires in ' + d + ' day' + (d === 1 ? '' : 's')),
      reason: 'Expires ' + r.expires + (r.doctor ? ' · ' + r.doctor : '') + '. Book the eye exam from Health › Care › Eyes, then add the new prescription.', urgency: d < 0 ? 'High' : 'Medium' };
  });
  Object.keys(supply || {}).forEach(function(p) { var s = supply[p];
    if (!s || s.daysLeft > EY_SUPPLY_LEAD_DAYS_) return;
    wanted[EY_FLAG_PREFIX_ + 'supply|' + p] = { flag: '👁 ' + p + '’s contacts ' + (s.daysLeft <= 0 ? 'have run out' : 'run out in ' + s.daysLeft + ' day' + (s.daysLeft === 1 ? '' : 's')),
      reason: 'From the order on ' + s.lastOrder + ' (' + s.boxes + ' boxes per eye). Reorder' + (s.store ? ' from ' + s.store : '') + ' and log the order in Health › Care › Eyes.', urgency: s.daysLeft <= 7 ? 'High' : 'Medium' };
  });
  return wanted;
}

// ---- sheets ----------------------------------------------------------------------------------

function eySheet_(name, headers) { return tiSchema_(ensureSheet(getSpreadsheet(), name, headers), headers); }

function eyRxRows_() {
  return tiRows_(eySheet_(EY_RX_TAB_, EY_RX_HEADERS_), EY_RX_HEADERS_.length).filter(function(r) { return eyText_(r[0]); }).map(function(r) {
    var x = { id: eyText_(r[0]), person: eyText_(r[1]), kind: /contact/i.test(r[2]) ? 'contacts' : 'glasses', exam: eyYmd_(r[3]), expires: eyYmd_(r[4]), doctor: eyText_(r[5]),
      lens: eyText_(r[17]), wear: eyText_(r[18]), photo: eyText_(r[19]), notes: eyText_(r[20]), updated: eyText_(r[21]) };
    Object.keys(EY_COLS_).forEach(function(f) { x[f] = eyText_(r[EY_COLS_[f]]); });
    return x;
  });
}
function eyUsualRows_() {
  return tiRows_(eySheet_(EY_USUAL_TAB_, EY_USUAL_HEADERS_), EY_USUAL_HEADERS_.length).filter(function(r) { return eyText_(r[0]); }).map(function(r) {
    return { id: eyText_(r[0]), person: eyText_(r[1]), what: eyText_(r[2]), brand: eyText_(r[3]), pack: eyText_(r[4]), daysPerPack: eyText_(r[5]), store: eyText_(r[6]), link: eyText_(r[7]), price: eyText_(r[8]) };
  });
}
function eyOrderRows_() {
  return tiRows_(eySheet_(EY_ORDER_TAB_, EY_ORDER_HEADERS_), EY_ORDER_HEADERS_.length).filter(function(r) { return eyText_(r[0]); }).map(function(r) {
    return { id: eyText_(r[0]), person: eyText_(r[1]), date: eyYmd_(r[2]), what: eyText_(r[3]), boxes: eyText_(r[4]), store: eyText_(r[5]), cost: eyText_(r[6]), paidWith: eyText_(r[7]), notes: eyText_(r[8]) };
  });
}

/** Pure: each person's current glasses and contacts (the newest exam), and the rest as history. */
function eyCurrent_(rows) {
  var by = {};
  (rows || []).slice().sort(function(a, b) { return (a.exam || '') < (b.exam || '') ? 1 : (a.exam || '') > (b.exam || '') ? -1 : (a.updated < b.updated ? 1 : -1); })
    .forEach(function(r) { var k = r.person + '|' + r.kind; (by[k] = by[k] || []).push(r); });
  var current = [], history = [];
  Object.keys(by).forEach(function(k) { current.push(by[k][0]); history = history.concat(by[k].slice(1)); });
  return { current: current, history: history };
}

function eyToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/** GET eyes → { ok, people, current, history, usual, orders, supply, exams, today }. */
function webGetEyes_() {
  var rows = eyRxRows_(), cur = eyCurrent_(rows), usual = eyUsualRows_(), orders = eyOrderRows_(), today = eyToday_();
  var people = [];
  var add = function(p) { if (p && people.indexOf(p) === -1) people.push(p); };
  try { add(peopleOwnerName_()); } catch (e) {}
  rows.concat(usual, orders).forEach(function(x) { add(x.person); });
  try { (getConfigValues().eyes_people || '').split(',').forEach(function(p) { add(eyText_(p)); }); } catch (e) {}
  var supply = {}; people.forEach(function(p) { supply[p] = eySupply_(p, orders, usual, today); });
  var exams = [];
  try { exams = (getHealthAppointments_() || []).filter(function(a) { return /eye|optom|ophthal/i.test(a.type); })
    .map(function(a) { return { person: a.person, type: a.type, provider: a.provider, lastVisit: a.lastVisit, nextDue: a.nextDue, daysUntil: a.daysUntil, scheduledNext: a.scheduledNext }; }); } catch (e) {}
  exams.forEach(function(x) { add(x.person); });
  return { ok: true, today: today, people: people, current: cur.current.map(function(r) { return Object.assign(r, { copy: eyCopyText_(r) }); }), history: cur.history,
    usual: usual, orders: orders.sort(function(a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 40), supply: supply, exams: exams };
}

// ---- reading a photo -------------------------------------------------------------------------

/** The Claude content block for an image or a PDF. */
function eyBlock_(b64, mime) {
  return mime === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: mime, data: b64 } }
                                    : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };
}

function eyCheckFile_(b) {
  var b64 = String((b && b.imageBase64) || '').replace(/^data:[^,]+,/, ''), mime = String((b && b.mime) || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!b64) return { error: 'No photo came through.' };
  if (EY_MIMES_.indexOf(mime) === -1) return { error: 'That isn’t a photo or a PDF.' };
  if (b64.length > EY_MAX_B64_) return { error: 'That file is over 10 MB.' };
  return { b64: b64, mime: mime };
}

/** POST eye_read { imageBase64, mime, kind } → { ok, kind, values, unsure, exam, expires, doctor, lens, wear } (nothing saved). */
function webEyeRead_(body) {
  var f = eyCheckFile_(body); if (f.error) return { ok: false, error: f.error };
  var kind = /contact/i.test(body && body.kind) ? 'contacts' : 'glasses';
  var prompt = 'This is an eye ' + (kind === 'contacts' ? 'CONTACT LENS' : 'GLASSES (spectacle)') + ' prescription. Read it exactly as written.\n' +
    'Return ONLY JSON (no markdown): {"odSph","odCyl","odAxis",' + (kind === 'glasses' ? '"odAdd",' : '') + '"osSph","osCyl","osAxis",' + (kind === 'glasses' ? '"osAdd","pd",' : '"bc","dia","lens","wear",') +
    '"exam":"yyyy-mm-dd or empty","expires":"yyyy-mm-dd or empty","doctor":"name and practice or empty","unsure":[names of any field you could not read with confidence]}.\n' +
    'OD is the right eye, OS the left. Keep signs on powers (e.g. "-2.25", "+0.50"); use "" for anything not written. Do not guess: if a digit is unclear, give your best reading and list the field in unsure.';
  var resp = fetchTracked_('anthropic', CLAUDE_API_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': getApiKey(), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 800, messages: [{ role: 'user', content: [eyBlock_(f.b64, f.mime), { type: 'text', text: prompt }] }] }) });
  if (resp.getResponseCode() !== 200) return { ok: false, error: 'Couldn’t read it right now (HTTP ' + resp.getResponseCode() + '). You can type the numbers instead.' };
  var text = ''; try { var j = JSON.parse(resp.getContentText()); text = (j.content && j.content[0] && j.content[0].text) || ''; } catch (e) {}
  var m = text.match(/\{[\s\S]*\}/), got = null; try { got = m ? JSON.parse(m[0]) : null; } catch (e) {}
  if (!got) return { ok: false, error: 'VERA couldn’t make out a prescription in that. Try a closer photo, or type the numbers.' };
  var clean = eyRxClean_(kind, got, Array.isArray(got.unsure) ? got.unsure : []);
  return { ok: true, kind: kind, values: clean.values, unsure: clean.unsure, exam: eyYmd_(got.exam), expires: eyYmd_(got.expires), doctor: eyText_(got.doctor).slice(0, 80),
    lens: eyText_(got.lens).slice(0, 80), wear: eyText_(got.wear).slice(0, 30) };
}

/** The Drive folder the prescription photos go in, made the first time. */
function eyFolder_() { var it = DriveApp.getFoldersByName(EY_FOLDER_); return it.hasNext() ? it.next() : DriveApp.createFolder(EY_FOLDER_); }

/** POST eye_save { id?, person, kind, values, exam, expires, doctor, lens, wear, notes, imageBase64?, mime? } */
function webEyeSave_(body) {
  var b = body || {}, person = eyText_(b.person).slice(0, 40), kind = /contact/i.test(b.kind) ? 'contacts' : 'glasses';
  if (!person) return { ok: false, error: 'Whose prescription is it?' };
  if (/^[=+@]/.test(person) || /^[=+@]/.test(eyText_(b.doctor)) || /^[=+@]/.test(eyText_(b.lens))) return { ok: false, error: 'A name can’t start with =, + or @.' };
  var exam = eyText_(b.exam);
  if (exam && !/^\d{4}-\d{2}-\d{2}$/.test(exam)) return { ok: false, error: 'The exam date isn’t a date.' };
  var clean = eyRxClean_(kind, b.values || {}, []);
  if (!(EY_FIELDS_[kind] || []).some(function(f) { return clean.values[f]; })) return { ok: false, error: 'Add at least the sphere (SPH or PWR) for one eye.' };
  if (clean.unsure.length && !b.confirmed) return { ok: false, unsure: clean.unsure, error: 'Check the marked numbers, then save again.' };
  var photo = eyText_(b.photo);
  if (b.imageBase64) {
    var f = eyCheckFile_(b); if (f.error) return { ok: false, error: f.error };
    var ext = f.mime === 'application/pdf' ? '.pdf' : '';
    photo = eyFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(f.b64), f.mime, person + ' ' + kind + ' ' + (exam || eyToday_()) + ext)).getId();
  }
  return tiLocked_(function() {
    var sh = eySheet_(EY_RX_TAB_, EY_RX_HEADERS_), id = eyText_(b.id) || tiMintId_('EY-');
    var row = [id, person, kind === 'contacts' ? 'Contacts' : 'Glasses', exam, eyExpiry_(kind, exam, b.expires), eyText_(b.doctor).slice(0, 80)];
    ['odSph', 'odCyl', 'odAxis', 'odAdd', 'osSph', 'osCyl', 'osAxis', 'osAdd', 'pd', 'bc', 'dia'].forEach(function(k) { row.push(clean.values[k] || ''); });
    row.push(eyText_(b.lens).slice(0, 80), eyText_(b.wear).slice(0, 30), photo, eyText_(b.notes).slice(0, 300), new Date().toISOString());
    var at = tiRowOf_(sh, EY_RX_HEADERS_.length, id);
    sh.getRange(at === -1 ? sh.getLastRow() + 1 : at, 1, 1, EY_RX_HEADERS_.length).setNumberFormat('@').setValues([row]);
    return { ok: true, id: id, photo: photo, expires: row[4] };
  });
}

/** GET eye_photo { id } → the photo as a data URL (images) or its Drive link (PDFs). */
function webEyePhoto_(e) {
  var id = eyText_(e && e.parameter && e.parameter.id), r = eyRxRows_().filter(function(x) { return x.id === id; })[0];
  if (!r || !r.photo) return { ok: false, error: 'No photo for that prescription.' };
  var file = DriveApp.getFileById(r.photo), mime = file.getMimeType();
  if (mime === 'application/pdf') return { ok: true, url: file.getUrl(), pdf: true };
  return { ok: true, dataUrl: 'data:' + mime + ';base64,' + Utilities.base64Encode(file.getBlob().getBytes()) };
}

/** A row by ID removed from one of the three tabs. */
function eyDelete_(tab, headers, id) {
  id = eyText_(id); if (!id) return { ok: false, error: 'id required' };
  return tiLocked_(function() { var sh = eySheet_(tab, headers), at = tiRowOf_(sh, headers.length, id);
    if (at === -1) return { ok: false, error: 'That’s already gone.' }; sh.deleteRow(at); return { ok: true }; });
}
/** POST eye_delete { id } — the photo stays in Drive. */
function webEyeDelete_(body) { return eyDelete_(EY_RX_TAB_, EY_RX_HEADERS_, body && body.id); }

/** POST eye_usual_save { id?, person, what, brand, pack, daysPerPack, store, link, price } */
function webEyeUsualSave_(body) {
  var b = body || {}, person = eyText_(b.person).slice(0, 40), what = eyText_(b.what).slice(0, 40);
  if (!person || !what) return { ok: false, error: 'Say whose it is and what it is.' };
  if ([person, what, b.brand, b.store].some(function(x) { return /^[=+@]/.test(eyText_(x)); })) return { ok: false, error: 'A name can’t start with =, + or @.' };
  var link = eyText_(b.link); if (link && !/^https?:\/\//i.test(link)) return { ok: false, error: 'The link should start with https://' };
  var dpp = eyText_(b.daysPerPack); if (dpp && !(Number(dpp) > 0)) return { ok: false, error: 'Days per pack is a number, like 90.' };
  return tiLocked_(function() { var sh = eySheet_(EY_USUAL_TAB_, EY_USUAL_HEADERS_), id = eyText_(b.id) || tiMintId_('EU-');
    var row = [id, person, what, eyText_(b.brand).slice(0, 80), eyText_(b.pack).slice(0, 20), dpp, eyText_(b.store).slice(0, 60), link.slice(0, 300), eyText_(b.price).slice(0, 20)];
    var at = tiRowOf_(sh, EY_USUAL_HEADERS_.length, id); if (at === -1) sh.appendRow(row); else sh.getRange(at, 1, 1, row.length).setValues([row]);
    return { ok: true, id: id }; });
}
function webEyeUsualDelete_(body) { return eyDelete_(EY_USUAL_TAB_, EY_USUAL_HEADERS_, body && body.id); }

/** POST eye_order_log { person, date, what, boxes, store, cost, paidWith, notes } */
function webEyeOrderLog_(body) {
  var b = body || {}, person = eyText_(b.person).slice(0, 40), date = eyText_(b.date) || eyToday_();
  if (!person) return { ok: false, error: 'Whose order is it?' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Pick the order date.' };
  var boxes = eyText_(b.boxes); if (boxes && !(Number(boxes) > 0)) return { ok: false, error: 'Boxes per eye is a number.' };
  if ([person, b.what, b.store].some(function(x) { return /^[=+@]/.test(eyText_(x)); })) return { ok: false, error: 'A name can’t start with =, + or @.' };
  return tiLocked_(function() { var id = tiMintId_('EO-');
    eySheet_(EY_ORDER_TAB_, EY_ORDER_HEADERS_).appendRow([id, person, date, eyText_(b.what).slice(0, 40) || 'Contacts', boxes, eyText_(b.store).slice(0, 60), eyText_(b.cost).slice(0, 20), eyText_(b.paidWith).slice(0, 30), eyText_(b.notes).slice(0, 200)]);
    return { ok: true, id: id }; });
}
function webEyeOrderDelete_(body) { return eyDelete_(EY_ORDER_TAB_, EY_ORDER_HEADERS_, body && body.id); }

/** Nightly: a prescription about to expire, contacts about to run out. Each flag closes itself. */
function checkEyes_() {
  var ss = getSpreadsheet(), flagSheet = ss.getSheetByName(TABS.FLAGS);
  if (!flagSheet) return { skipped: 'no flags tab' };
  if (!ss.getSheetByName(EY_RX_TAB_) && !ss.getSheetByName(EY_ORDER_TAB_)) return { skipped: 'no eye prescriptions yet' };
  var d = webGetEyes_(), wanted = eyFlags_(d.current, d.supply, d.today);
  upsertKeyedFlags_(flagSheet, EY_FLAG_PREFIX_, 'Eyes', wanted, d.today);
  return { flags: Object.keys(wanted).length };
}

/** Chat: the current prescriptions for a person, as text. */
function eyChatText_(person) {
  var d = webGetEyes_(), p = eyText_(person).toLowerCase();
  var rows = d.current.filter(function(r) { return !p || r.person.toLowerCase() === p; });
  if (!rows.length) return 'No eye prescriptions saved' + (person ? ' for ' + person : '') + ' yet (Health › Care › Eyes).';
  return rows.map(function(r) { return r.person + ' · ' + r.kind + (r.exam ? ' (exam ' + r.exam + ')' : '') + ': ' + r.copy; }).join('\n');
}
