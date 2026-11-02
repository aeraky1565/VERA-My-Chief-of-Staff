// ============================================================
// VERA — CareerCredentials.js
// Career › Credentials (issue #223): certifications and degrees in one place. VERA keeps them in
// its own "Career Credentials" tab, writes the job agent's "Credentials held" row from them, and
// reminds before a certification lapses (and when its renewal credits are behind pace).
// ============================================================
//
//   1. THE JOB AGENT'S SHEET: VERA writes only "Credentials held" (in CAR_AGENT_OWNED_LABELS_),
//      by label, through carWriteAgentSettings_. The agent's own rows — "Candidate background",
//      "Credential deal-breakers" and the rest — are never touched.
//   2. The line it writes: degrees, then active certifications, then expired ones marked
//      "(expired YYYY)". A year earned, where known, as "(YYYY)". Credential IDs never leave VERA.
//   3. The first time, the agent's existing line is imported once (Script Property guard), plus
//      the bachelor's degree, so nothing has to be typed twice.
//   4. Reminder lead times live in Config (career_cert_reminder_days, default 90,30,7); a flag's
//      key carries the expiry date, so a renewed certification raises a fresh one.
// ============================================================

var CAR_CRED_TAB_ = 'Career Credentials';
var CAR_CRED_HEADERS_ = ['ID', 'Kind', 'Name', 'Issuer', 'Field', 'Earned', 'Expires', 'Renewal', 'Credits Needed', 'Credits Earned', 'Fee',
  'Credential ID', 'Verify URL', 'Tracks', 'Send To Agent', 'Notes', 'Updated'];
var CAR_CRED_IMPORT_PROP_ = 'CAR_CRED_IMPORTED';
var CAR_CRED_AGENT_LABEL_ = 'Credentials held';
var CAR_CRED_DEGREE_RE_ = /^(mba|bachelor|master|b\.?s\.?c?|b\.?a\.?|b\.?eng|m\.?s\.?c?|m\.?a\.?|m\.?eng|ph\.?d|doctor|associate (of|in))\b/i;
var CAR_CRED_BACHELOR_ = 'Bachelor of Engineering';

function carCredText_(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
function carCredIso_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = carCredText_(v); return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s) ? s : '';
}
function carCredNum_(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : null; }
function carCredDays_(fromIso, toIso) { return Math.round((new Date(toIso + 'T00:00:00') - new Date(fromIso + 'T00:00:00')) / 86400000); }
function carCredYear_(iso) { var m = String(iso || '').match(/^(\d{4})/); return m ? m[1] : ''; }

/**
 * Pure: the agent's "Credentials held" text → items. "MBA; PMP; SAFe Architect (2024); Scrum Master
 * (expired 2025)" → [{ kind, name, earned, expires }]. A degree is recognised by its name.
 */
function carCredParseAgent_(text) {
  return String(text || '').split(';').map(function(s) { return carCredText_(s); }).filter(Boolean).map(function(s) {
    var exp = s.match(/\(\s*expired\s+(\d{4})\s*\)\s*$/i), yr = s.match(/\(\s*(\d{4})\s*\)\s*$/);
    var name = carCredText_(s.replace(/\(\s*(expired\s+)?\d{4}\s*\)\s*$/i, ''));
    var degree = CAR_CRED_DEGREE_RE_.test(name);
    return { kind: degree ? 'degree' : 'cert', name: name, earned: yr ? yr[1] : '', expires: exp ? exp[1] + '-12-31' : '' };
  });
}

/** Pure: a row from the tab → a credential. */
function carCredFrom_(r) {
  var g = function(h) { return r[h] == null ? '' : r[h]; };
  var kind = carCredText_(g('Kind')).toLowerCase() === 'degree' ? 'degree' : 'cert';
  var ren = carCredText_(g('Renewal')).toLowerCase();
  return { id: carCredText_(g('ID')), kind: kind, name: carCredText_(g('Name')), issuer: carCredText_(g('Issuer')), field: carCredText_(g('Field')),
    earned: carCredIso_(g('Earned')) || carCredText_(g('Earned')), expires: kind === 'degree' ? '' : carCredIso_(g('Expires')),
    renewal: kind === 'degree' ? 'none' : (ren === 'credits' || ren === 'fee' ? ren : 'none'),
    creditsNeeded: carCredNum_(g('Credits Needed')), creditsEarned: carCredNum_(g('Credits Earned')) || 0, fee: carCredNum_(g('Fee')),
    credentialId: carCredText_(g('Credential ID')), verifyUrl: carCredText_(g('Verify URL')),
    tracks: carCredText_(g('Tracks')).split(',').map(function(t) { return carCredText_(t); }).filter(Boolean),
    sendToAgent: !/^(no|false|0)$/i.test(carCredText_(g('Send To Agent'))), notes: carCredText_(g('Notes')), updated: carCredText_(g('Updated')), _row: r._row };
}

/** Pure: a credential's state today. → { status: degree|none|active|soon|expired, daysLeft, label } */
function carCredStatus_(c, today, soonDays) {
  soonDays = soonDays == null ? 90 : soonDays;
  if (c.kind === 'degree') return { status: 'degree', daysLeft: null, label: 'Degree' };
  if (!c.expires) return { status: 'none', daysLeft: null, label: 'No expiry' };
  var d = carCredDays_(today, c.expires);
  if (d < 0) return { status: 'expired', daysLeft: d, label: 'Expired ' + carCredYear_(c.expires) };
  if (d <= soonDays) return { status: 'soon', daysLeft: d, label: 'Renew by ' + c.expires };
  return { status: 'active', daysLeft: d, label: 'Active' };
}

/** Pure: a credits certification's pace: "22 of 60 PDUs · 8 months left · about 5 a month". */
function carCredPace_(c, today, unit) {
  if (c.kind !== 'cert' || c.renewal !== 'credits' || !c.creditsNeeded) return null;
  unit = unit || (/pmp|pmi|capm|pgmp/i.test(c.name + ' ' + c.issuer) ? 'PDUs' : 'credits');
  var earned = Math.max(0, c.creditsEarned || 0), left = Math.max(0, c.creditsNeeded - earned);
  var months = c.expires ? Math.max(0, Math.round(carCredDays_(today, c.expires) / 30.44)) : null;
  var perMonth = months ? Math.ceil(left / months * 10) / 10 : (left ? null : 0);
  var parts = [earned + ' of ' + c.creditsNeeded + ' ' + unit];
  if (months != null) parts.push(months + ' month' + (months === 1 ? '' : 's') + ' left');
  if (left && perMonth != null) parts.push('about ' + (perMonth >= 10 ? Math.round(perMonth) : perMonth) + ' a month');
  if (!left) parts.push('done');
  return { earned: earned, needed: c.creditsNeeded, left: left, months: months, perMonth: perMonth, unit: unit, pct: Math.min(100, Math.round(earned / c.creditsNeeded * 100)), text: parts.join(' · ') };
}

/**
 * Pure: the agent's "Credentials held" line. Only credentials set to go to the agent; degrees, then
 * active certifications (no expiry counts as active), then expired ones as "(expired YYYY)". A year
 * earned shows as "(YYYY)". Never a credential ID, issuer note or link.
 */
function carCredentialsLine_(rows, today) {
  var sent = (rows || []).filter(function(c) { return c.name && c.sendToAgent; });
  var item = function(c) { var y = carCredYear_(c.earned); return c.name + (y ? ' (' + y + ')' : ''); };
  var degrees = sent.filter(function(c) { return c.kind === 'degree'; }).map(function(c) { var y = carCredYear_(c.earned); return c.name + (c.field && c.name.toLowerCase().indexOf(c.field.toLowerCase()) === -1 ? ' in ' + c.field : '') + (y ? ' (' + y + ')' : ''); });
  var certs = sent.filter(function(c) { return c.kind === 'cert'; });
  var active = certs.filter(function(c) { return carCredStatus_(c, today).status !== 'expired'; }).map(item);
  var expired = certs.filter(function(c) { return carCredStatus_(c, today).status === 'expired'; }).map(function(c) { return c.name + ' (expired ' + carCredYear_(c.expires) + ')'; });
  return degrees.concat(active, expired).join('; ');
}

/** Pure: Config "90,30,7" → [90, 30, 7]. */
function carCredLeads_(v) {
  var out = String(v == null || v === '' ? '90,30,7' : v).split(',').map(function(x) { return parseInt(x, 10); }).filter(function(n) { return n > 0; });
  return (out.length ? out : [90, 30, 7]).sort(function(a, b) { return b - a; });
}

/**
 * Pure: the reminders due today. A certification gets one per lead time it has reached (90, 30, 7
 * days before it expires) — the key carries the expiry date, so a renewal starts over. A credits
 * certification behind pace (more than `paceMax` a month still to earn) gets a pace reminder.
 * → [{ key, flag, reason, urgency }]
 */
function carCredRemindersDue_(rows, today, leads, paceMax) {
  var out = [];
  paceMax = paceMax == null ? 4 : paceMax;
  (rows || []).forEach(function(c) {
    if (c.kind !== 'cert' || !c.expires) return;
    var d = carCredDays_(today, c.expires);
    if (d < 0) return;
    var slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    var reached = leads.filter(function(n) { return d <= n; });
    if (reached.length) {
      var lead = reached[reached.length - 1];
      out.push({ key: 'career_cert_' + slug + '_' + c.expires + '_' + lead, urgency: lead <= 7 ? 'High' : lead <= 30 ? 'Medium' : 'Low',
        flag: c.name + ' expires ' + c.expires + ' (' + d + ' day' + (d === 1 ? '' : 's') + ')',
        reason: c.renewal === 'credits' ? 'Log the renewal credits and renew in Career › Credentials.' : c.renewal === 'fee' ? 'Renew it' + (c.fee ? ' (' + '$' + c.fee + ')' : '') + ' and record the new expiry in Career › Credentials.' : 'Renew it and record the new expiry in Career › Credentials.' });
    }
    var p = carCredPace_(c, today);
    if (p && p.left && p.perMonth != null && p.perMonth > paceMax)
      out.push({ key: 'career_cert_pace_' + slug + '_' + c.expires, urgency: 'Medium', flag: c.name + ': ' + p.left + ' ' + p.unit + ' still to earn', reason: p.text + '. Log them in Career › Credentials as you go.' });
  });
  return out;
}

// ---- reading, writing, the agent ---------------------------------------------------------------

function carCredSheet_() { return carSheet_(CAR_CRED_TAB_, CAR_CRED_HEADERS_); }
function carCredRows_() { return carReadRows_(carCredSheet_()).filter(function(r) { return carCredText_(r.ID); }).map(carCredFrom_); }
function carCredToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function carCredRowOut_(c) {
  return [c.id, c.kind, c.name, c.issuer || '', c.field || '', c.earned || '', c.kind === 'degree' ? '' : (c.expires || ''), c.kind === 'degree' ? 'none' : (c.renewal || 'none'),
    c.creditsNeeded == null ? '' : c.creditsNeeded, c.creditsEarned == null ? '' : c.creditsEarned, c.fee == null ? '' : c.fee,
    c.credentialId || '', c.verifyUrl || '', (c.tracks || []).join(', '), c.sendToAgent === false ? 'No' : 'Yes', c.notes || '', new Date().toISOString()];
}

/** Read the agent's current "Credentials held" (by label). '' when it can't be read. */
function carCredAgentLine_() {
  var id = carAgentSheetId_(); if (!id) return '';
  var grid = carOpenAgentTab_(id, 'Settings').getDataRange().getValues();
  var head = grid[0].map(carLabel_), k = head.indexOf('setting'), v = head.indexOf('your value');
  for (var i = 1; i < grid.length; i++) if (carLabel_(grid[i][k]) === carLabel_(CAR_CRED_AGENT_LABEL_)) return carCredText_(grid[i][v]);
  return '';
}

/** Once ever: the agent's line, then the bachelor's degree, into the tab. Idempotent by name. */
function carCredImportOnce_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(CAR_CRED_IMPORT_PROP_)) return { imported: false, reason: 'already imported' };
  var line = '';
  try { line = carCredAgentLine_(); } catch (e) { return { imported: false, reason: e.message }; }
  var items = carCredParseAgent_(line);
  if (!items.some(function(x) { return /^bachelor/i.test(x.name); })) items.unshift({ kind: 'degree', name: CAR_CRED_BACHELOR_, earned: '', expires: '' });
  var sheet = carCredSheet_(), have = {};
  carCredRows_().forEach(function(c) { have[c.name.toLowerCase()] = 1; });
  var added = 0;
  items.forEach(function(x) {
    if (have[x.name.toLowerCase()]) return;
    have[x.name.toLowerCase()] = 1;
    sheet.appendRow(carCredRowOut_({ id: 'CRED-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase(), kind: x.kind, name: x.name, earned: x.earned, expires: x.expires,
      renewal: 'none', creditsEarned: null, sendToAgent: true, notes: 'Imported from the job agent' }));
    added++;
  });
  props.setProperty(CAR_CRED_IMPORT_PROP_, new Date().toISOString());
  return { imported: true, added: added };
}

/** Write the line to the agent when it differs from what's there. */
function carCredSyncAgent_(rows) {
  var id = carAgentSheetId_();
  if (!id) return { ok: false, error: 'Add a career_alert_sheet_id row to Config first.' };
  var line = carCredentialsLine_(rows || carCredRows_(), carCredToday_());
  var res = carWriteAgentSettings_(carOpenAgentTab_(id, 'Settings'), [{ label: CAR_CRED_AGENT_LABEL_, value: line }]);
  var state = { at: new Date().toISOString(), line: line, written: res.written.length > 0, missing: res.missing.length > 0 };
  if (res.written.length || !carStateGet_('cred_sync_last')) carStateSet_('cred_sync_last', state);
  return { ok: !res.missing.length, line: line, written: res.written.length > 0, error: res.missing.length ? 'The agent’s Settings has no “Credentials held” row.' : '' };
}

/** GET career_credentials */
function webCareerCredentials_() {
  try { carCredImportOnce_(); } catch (e) {}
  var today = carCredToday_(), rows = carCredRows_();
  var list = rows.map(function(c) { var o = Object.assign({}, c); delete o._row; o.state = carCredStatus_(c, today); o.pace = carCredPace_(c, today); return o; });
  var last = carStateGet_('cred_sync_last') || null;
  return { ok: true, today: today, credentials: list, line: carCredentialsLine_(rows, today), lastSent: last,
    totals: { active: list.filter(function(c) { return c.state.status === 'active' || c.state.status === 'none' || c.state.status === 'soon'; }).length,
              soon: list.filter(function(c) { return c.state.status === 'soon'; }).length, degrees: list.filter(function(c) { return c.kind === 'degree'; }).length },
    agentConnected: !!carAgentSheetId_() };
}

/** Save, then send the line on. A failed send doesn't lose the save; it says so. */
function carCredAfterChange_(out) {
  try { var s = carCredSyncAgent_(); out.sync = s; } catch (e) { out.sync = { ok: false, error: e.message }; }
  return out;
}

/** POST career_credential_save { credential } */
function webCareerSaveCredential_(body) {
  var c = body && body.credential || {};
  var kind = c.kind === 'degree' ? 'degree' : 'cert';
  var name = carCredText_(c.name).slice(0, 120);
  if (!name) return { ok: false, error: 'Give it a name.' };
  var ren = kind === 'degree' ? 'none' : (c.renewal === 'credits' || c.renewal === 'fee' ? c.renewal : 'none');
  var expires = kind === 'degree' ? '' : carCredText_(c.expires);
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return { ok: false, error: 'An expiry date is YYYY-MM-DD.' };
  var earned = carCredText_(c.earned);
  if (earned && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(earned)) return { ok: false, error: 'Earned is a year or a date.' };
  var need = ren === 'credits' ? carCredNum_(c.creditsNeeded) : null;
  if (ren === 'credits' && !(need > 0)) return { ok: false, error: 'How many credits does renewal need?' };
  var row = { kind: kind, name: name, issuer: carCredText_(c.issuer).slice(0, 120), field: carCredText_(c.field).slice(0, 120), earned: earned, expires: expires, renewal: ren,
    creditsNeeded: need, creditsEarned: ren === 'credits' ? Math.max(0, carCredNum_(c.creditsEarned) || 0) : null, fee: ren === 'fee' ? carCredNum_(c.fee) : null,
    credentialId: carCredText_(c.credentialId).slice(0, 80), verifyUrl: /^https?:\/\//i.test(carCredText_(c.verifyUrl)) ? carCredText_(c.verifyUrl).slice(0, 300) : '',
    tracks: (Array.isArray(c.tracks) ? c.tracks : String(c.tracks || '').split(',')).map(carCredText_).filter(Boolean).slice(0, 6), sendToAgent: c.sendToAgent !== false, notes: carCredText_(c.notes).slice(0, 500) };
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var sheet = carCredSheet_(), rows = carCredRows_(), id = carCredText_(c.id);
    var cur = id ? rows.filter(function(x) { return x.id === id; })[0] : null;
    if (id && !cur) return { ok: false, error: 'That credential no longer exists.' };
    row.id = cur ? cur.id : 'CRED-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
    if (cur) sheet.getRange(cur._row, 1, 1, CAR_CRED_HEADERS_.length).setValues([carCredRowOut_(row)]);
    else sheet.appendRow(carCredRowOut_(row));
  } finally { lock.releaseLock(); }
  return carCredAfterChange_({ ok: true, id: row.id });
}

/** POST career_credential_delete { id } */
function webCareerDeleteCredential_(body) {
  var id = carCredText_(body && body.id);
  var cur = carCredRows_().filter(function(x) { return x.id === id; })[0];
  if (!cur) return { ok: false, error: 'That credential no longer exists.' };
  carCredSheet_().deleteRow(cur._row);
  return carCredAfterChange_({ ok: true });
}

/** POST career_credential_log_credits { id or name, n } — adds n (may be negative to correct). */
function webCareerLogCredits_(body) {
  var n = carCredNum_(body && body.n);
  if (n == null || n === 0 || Math.abs(n) > 500) return { ok: false, error: 'How many credits?' };
  var rows = carCredRows_(), key = carCredText_(body && (body.id || body.name)).toLowerCase();
  var cur = rows.filter(function(x) { return x.id.toLowerCase() === key; })[0] || rows.filter(function(x) { return x.name.toLowerCase() === key; })[0]
    || rows.filter(function(x) { return key.length >= 3 && x.name.toLowerCase().indexOf(key) !== -1; })[0];
  if (!cur) return { ok: false, error: 'No credential called ' + (body.id || body.name) + '.' };
  if (cur.renewal !== 'credits') return { ok: false, error: cur.name + ' doesn’t renew by credits.' };
  var total = Math.max(0, (cur.creditsEarned || 0) + n);
  carCredSheet_().getRange(cur._row, CAR_CRED_HEADERS_.indexOf('Credits Earned') + 1).setValue(total);
  carCredSheet_().getRange(cur._row, CAR_CRED_HEADERS_.indexOf('Updated') + 1).setValue(new Date().toISOString());
  return { ok: true, id: cur.id, name: cur.name, creditsEarned: total };
}

/** Chat / dashboard: renew — a new expiry, credits back to 0 for a credits cert. */
function carCredRenew_(name, newExpiry) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(carCredText_(newExpiry))) return { ok: false, error: 'The new expiry is YYYY-MM-DD.' };
  var rows = carCredRows_(), key = carCredText_(name).toLowerCase();
  var cur = rows.filter(function(x) { return x.name.toLowerCase() === key; })[0] || rows.filter(function(x) { return key.length >= 3 && x.name.toLowerCase().indexOf(key) !== -1; })[0];
  if (!cur || cur.kind !== 'cert') return { ok: false, error: 'No certification called ' + name + '.' };
  var sheet = carCredSheet_();
  sheet.getRange(cur._row, CAR_CRED_HEADERS_.indexOf('Expires') + 1).setValue(newExpiry);
  if (cur.renewal === 'credits') sheet.getRange(cur._row, CAR_CRED_HEADERS_.indexOf('Credits Earned') + 1).setValue(0);
  sheet.getRange(cur._row, CAR_CRED_HEADERS_.indexOf('Updated') + 1).setValue(new Date().toISOString());
  return carCredAfterChange_({ ok: true, name: cur.name, expires: newExpiry });
}

/** Chat context: name, kind and state; never an ID. */
function carCredContextLines_() {
  var today = carCredToday_();
  return carCredRows_().map(function(c) { var s = carCredStatus_(c, today), p = carCredPace_(c, today);
    return '  - ' + c.name + (c.kind === 'degree' ? ' (degree' + (c.field ? ', ' + c.field : '') + ')' : ' — ' + s.label) + (p ? ' — ' + p.text : ''); });
}

/**
 * Nightly (in the Career pass): import once; send the line when it changed (a certification that
 * lapsed overnight becomes "(expired YYYY)"); raise the expiry and pace reminders, each once.
 */
function carCredNightly_() {
  try { carCredImportOnce_(); } catch (e) {}
  var rows = carCredRows_(), today = carCredToday_();
  var last = carStateGet_('cred_sync_last') || {};
  if (carAgentSheetId_() && carCredentialsLine_(rows, today) !== last.line) { try { carCredSyncAgent_(rows); } catch (e) {} }
  var cfg = {}; try { cfg = getConfigValues() || {}; } catch (e) {}
  var due = carCredRemindersDue_(rows, today, carCredLeads_(cfg['career_cert_reminder_days']), cfg['career_cert_pace_max'] === undefined || cfg['career_cert_pace_max'] === '' ? 4 : Number(cfg['career_cert_pace_max']));
  if (!due.length) return 'ok';
  writeFlags(due.map(function(x) { return { source: 'Career', flag: x.flag, reason: x.reason, urgency: x.urgency, key: x.key }; }));
  due.forEach(function(x) {
    if (typeof wasRecentlySent_ === 'function' && wasRecentlySent_(x.key, 60 * 24 * 365)) return;
    sendNudge_(x.key, x.flag, '🎓 ' + x.flag + '\n' + x.reason, 'career_cert_expiry');
  });
  return due.length + ' reminder(s)';
}
