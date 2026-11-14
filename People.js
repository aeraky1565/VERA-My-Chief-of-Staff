// ============================================================
// VERA — People.js  (issue #218)
// Who is using VERA: a sign-in code per person, and the tabs each one sees.
// ============================================================
//
// Sign-in. Each person gets their own sign-in code, typed once per device where the
// token used to go. VERA keeps only a fingerprint of each code (SHA-256) in one Script
// Property, VERA_USER_TOKENS, never the code itself, and shows a new code once.
// The old shared token (VERA_WEB_TOKEN) keeps working as the owner, so nothing breaks
// during the switch. "Sign out everywhere" deletes a person's fingerprints, so every
// device with one of their codes stops working at once.
//
// What each person sees. The Access tab in the VERA sheet lists every tab and subtab
// of both dashboards (VERA fills the rows when the owner opens a dashboard), with a
// checkbox column per person, and an "Opens on" row naming each person's first tab.
// A new person's column starts all ticked; a new tab is ticked for everyone. The
// dashboards hide what's unticked. This is what each person SEES, not security: the
// server doesn't refuse a hidden tab's data (that's #218 piece 4, later).
//
// whoami → { name, owner, view: full | lite, opensOn, hidden: [ids] }. Ids are
// "<full|lite>:<tab>" for a main tab and "<full|lite>:<menu>/<subtab>" for a subtab.
// The owner always keeps System and System › People & access, so it can't lock itself out.
//
// Two layers: pure (peopleWho_, peopleCodeFrom_, accessSyncPlan_, accessFor_,
// accessCounts_) and the reads and writes around them.
// ============================================================

var PEOPLE_PROP_ = 'VERA_USER_TOKENS';
var ACCESS_TAB_ = 'Access';
var ACCESS_OPENS_ID_ = 'opens_on';
var PEOPLE_CODE_ALPHABET_ = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L
var PEOPLE_OWNER_KEEPS_ = ['full:system', 'full:system/people'];
var _veraWho_ = null;   // the person making this request (set by isAuthorized_)

// ---- pure ----------------------------------------------------------------------

/** Pure: a typed code as it's fingerprinted: upper case, no spaces. */
function peopleNormalize_(code) { return String(code == null ? '' : code).toUpperCase().replace(/\s+/g, ''); }

/** Pure: 16 random bytes (0–255) → "XXXX-XXXX-XXXX-XXXX" from the unambiguous alphabet. */
function peopleCodeFrom_(bytes) {
  var a = PEOPLE_CODE_ALPHABET_, out = '';
  for (var i = 0; i < 16; i++) { out += a.charAt(((bytes[i] % 256) + 256) % 256 % a.length); if (i % 4 === 3 && i < 15) out += '-'; }
  return out;
}

/**
 * Pure: who is this token? webToken: the owner's shared token; people: the record's
 * list; hashOf(code) → fingerprint. → { name, owner, view } or null.
 */
function peopleWho_(token, webToken, people, hashOf, ownerName) {
  var t = String(token == null ? '' : token).trim();
  if (!t) return null;
  people = people || [];
  var owner = people.filter(function(p) { return p.owner; })[0];
  if (webToken && t === webToken) return { name: owner ? owner.name : (ownerName || 'Owner'), owner: true, view: owner ? owner.view || 'full' : 'full' };
  var h = hashOf(peopleNormalize_(t));
  for (var i = 0; i < people.length; i++) {
    if ((people[i].hashes || []).indexOf(h) !== -1) return { name: people[i].name, owner: !!people[i].owner, view: people[i].view === 'lite' ? 'lite' : 'full' };
  }
  return null;
}

/** Pure: is this a name VERA can use as a column? → '' when fine, else why not. */
function peopleNameProblem_(name, people) {
  var n = String(name == null ? '' : name).trim();
  if (!n) return 'Give them a name';
  if (n.length > 30) return 'Keep the name under 30 characters';
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(n)) return 'Use letters, spaces, apostrophes or hyphens';
  if ((people || []).some(function(p) { return p.name.toLowerCase() === n.toLowerCase(); })) return n + ' is already listed';
  return '';
}

/**
 * Pure: the Access grid after a sync. values: the tab as it is (row 1 = Area, Tab, Id,
 * then one column per person; row 2 = the Opens on row), or [] for a new tab;
 * catalog: [{ id, area, tab }]; names: everyone, owner first. Existing rows and
 * ticks are kept as they are; a missing row is added ticked for everyone; a missing
 * person gets a column ticked everywhere. → { values, addedRows, addedCols }
 */
function accessSyncPlan_(values, catalog, names) {
  var v = (values && values.length) ? values.map(function(r) { return r.slice(); }) : [['Area', 'Tab', 'Id'], ['Opens on', '(their first tab)', ACCESS_OPENS_ID_]];
  if (!v[1] || String(v[1][2]) !== ACCESS_OPENS_ID_) v.splice(1, 0, ['Opens on', '(their first tab)', ACCESS_OPENS_ID_]);
  var width = v[0].length;
  v.forEach(function(r) { while (r.length < width) r.push(''); });
  var addedCols = [];
  (names || []).forEach(function(n) {
    var have = v[0].slice(3).some(function(h) { return String(h).toLowerCase() === n.toLowerCase(); });
    if (have) return;
    addedCols.push(n);
    v.forEach(function(r, i) { r.push(i === 0 ? n : i === 1 ? '' : true); });
  });
  var ids = {};
  v.forEach(function(r, i) { if (i > 1) ids[String(r[2])] = true; });
  var addedRows = 0, cols = v[0].length;
  (catalog || []).forEach(function(c) {
    if (!c || !c.id || ids[c.id]) return;
    ids[c.id] = true;
    var row = [c.area || '', c.tab || '', c.id];
    for (var k = 3; k < cols; k++) row.push(true);
    v.push(row);
    addedRows++;
  });
  return { values: v, addedRows: addedRows, addedCols: addedCols };
}

/** Pure: a cell counts as unticked only when it's FALSE (a blank or a new row is ticked). */
function accessTicked_(cell) { return !(cell === false || String(cell).trim().toUpperCase() === 'FALSE'); }

/**
 * Pure: what one person sees, from the Access grid. → { hidden: [ids], opensOn }.
 * No column for them: nothing hidden. The owner always keeps System and People & access.
 */
function accessFor_(values, name, owner) {
  if (!values || !values.length) return { hidden: [], opensOn: '' };
  var col = -1;
  values[0].forEach(function(h, i) { if (i >= 3 && String(h).trim().toLowerCase() === String(name || '').toLowerCase()) col = i; });
  if (col === -1) return { hidden: [], opensOn: '' };
  var hidden = [], opensOn = '';
  values.forEach(function(r, i) {
    if (i === 0) return;
    var id = String(r[2] || '').trim();
    if (id === ACCESS_OPENS_ID_) { opensOn = String(r[col] == null ? '' : r[col]).trim(); return; }
    if (id && !accessTicked_(r[col]) && !(owner && PEOPLE_OWNER_KEEPS_.indexOf(id) !== -1)) hidden.push(id);
  });
  return { hidden: hidden, opensOn: opensOn };
}

/** Pure: how many tab rows a person sees, of how many. */
function accessCounts_(values, name) {
  var a = accessFor_(values, name, false), total = 0;
  (values || []).forEach(function(r, i) { if (i > 0 && String(r[2] || '') && String(r[2]) !== ACCESS_OPENS_ID_) total++; });
  return { visible: total - a.hidden.length, total: total };
}

// ---- the record (Script Property: fingerprints only) ------------------------------

function peopleHash_(code) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, peopleNormalize_(code), Utilities.Charset.UTF_8);
  return bytes.map(function(b) { var x = (b < 0 ? b + 256 : b).toString(16); return x.length === 1 ? '0' + x : x; }).join('');
}

function peopleRead_() {
  try {
    var d = JSON.parse(PropertiesService.getScriptProperties().getProperty(PEOPLE_PROP_) || '{}');
    return d && Array.isArray(d.people) ? d : { people: [] };
  } catch (e) { return { people: [] }; }
}
function peopleWrite_(d) { PropertiesService.getScriptProperties().setProperty(PEOPLE_PROP_, JSON.stringify({ people: d.people })); }

function peopleOwnerName_() { try { return String(getConfigValues()['owner_name'] || '').trim() || 'Owner'; } catch (e) { return 'Owner'; } }

/** The record, with the owner's entry made on first use. */
function peopleWithOwner_() {
  var d = peopleRead_();
  if (!d.people.some(function(p) { return p.owner; })) {
    d.people.unshift({ name: peopleOwnerName_(), owner: true, view: 'full', hashes: [], created: new Date().toISOString() });
    peopleWrite_(d);
  }
  return d;
}

function peopleNewCode_() {
  var seed = Utilities.getUuid() + Utilities.getUuid() + new Date().getTime() + Math.random();
  return peopleCodeFrom_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8));
}

/** Who is this request? Sets _veraWho_. → the person, or null. */
function veraIdentify_(token) {
  var who = null;
  try { who = peopleWho_(token, getWebToken_(), peopleRead_().people, peopleHash_, peopleOwnerName_()); } catch (e) { who = null; }
  _veraWho_ = who;
  return who;
}

function peopleOwnerOnly_() { return _veraWho_ && _veraWho_.owner ? null : { ok: false, error: 'Only the owner can do that' }; }

// ---- the Access tab (VERA's own sheet) ----------------------------------------------

function accessSheet_(create) {
  var ss = getSpreadsheet(), sh = ss.getSheetByName(ACCESS_TAB_);
  if (!sh && create) sh = ss.insertSheet(ACCESS_TAB_);
  return sh;
}
function accessValues_() {
  var sh = accessSheet_(false);
  if (!sh || sh.getLastRow() < 1) return [];
  return sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
}

/** Writes a synced grid: values, checkboxes on the person cells, the header frozen. */
function accessWrite_(plan) {
  var sh = accessSheet_(true), v = plan.values;
  sh.getRange(1, 1, v.length, v[0].length).setValues(v);
  if (v.length > 2 && v[0].length > 3) {
    try { sh.getRange(3, 4, v.length - 2, v[0].length - 3).insertCheckboxes(); } catch (e) {}
  }
  try { sh.setFrozenRows(2); sh.setFrozenColumns(2); sh.getRange(1, 1, 1, v[0].length).setFontWeight('bold'); } catch (e) {}
}

function accessNames_(d) {
  return d.people.slice().sort(function(a, b) { return (b.owner ? 1 : 0) - (a.owner ? 1 : 0); }).map(function(p) { return p.name; });
}

// ---- endpoints ----------------------------------------------------------------------

/** GET whoami → the person, their view, first tab and hidden tabs. Records "last seen" (hourly). */
function webWhoami_() {
  var who = _veraWho_;
  if (!who) return { ok: false, error: 'Unauthorized' };
  var a = { hidden: [], opensOn: '' };
  try { a = accessFor_(accessValues_(), who.name, who.owner); } catch (e) {}
  if (!who.owner) a.hidden = a.hidden.concat(PEOPLE_OWNER_KEEPS_.slice(1));   // People & access is the owner's
  try {
    var d = peopleRead_(), p = d.people.filter(function(x) { return x.name === who.name; })[0];
    if (p && (!p.lastSeen || Date.now() - new Date(p.lastSeen).getTime() > 3600000)) { p.lastSeen = new Date().toISOString(); peopleWrite_(d); }
  } catch (e) {}
  return { ok: true, name: who.name, owner: who.owner, view: who.view, opensOn: a.opensOn, hidden: a.hidden };
}

/** GET people_list (owner) → everyone, with their view, codes, last seen and tab count. */
function webPeopleList_() {
  var no = peopleOwnerOnly_(); if (no) return no;
  var d = peopleWithOwner_(), v = [];
  try { v = accessValues_(); } catch (e) {}
  return { ok: true, people: d.people.map(function(p) {
    var c = accessCounts_(v, p.name);
    return { name: p.name, owner: !!p.owner, view: p.view === 'lite' ? 'lite' : 'full', codes: (p.hashes || []).length, lastSeen: p.lastSeen || '', visible: c.visible, total: c.total };
  }), access: { rows: accessCounts_(v, '').total, listSaved: accessCatalogRead_().length > 0 } };
}

/** POST people_add { name, view } (owner) → their first sign-in code, shown once. */
function webPeopleAdd_(body) {
  var no = peopleOwnerOnly_(); if (no) return no;
  return veraLocked_(function() {
    var d = peopleWithOwner_(), name = String((body || {}).name || '').trim();
    var why = peopleNameProblem_(name, d.people);
    if (why) return { ok: false, error: why };
    var code = peopleNewCode_();
    d.people.push({ name: name, owner: false, view: body.view === 'full' ? 'full' : 'lite', hashes: [peopleHash_(code)], created: new Date().toISOString() });
    peopleWrite_(d);
    try { accessWrite_(accessSyncPlan_(accessValues_(), [], accessNames_(d))); } catch (e) {}
    return { ok: true, name: name, code: code };
  });
}

/** POST people_code { name } (owner) → a new code for them; their old ones keep working. */
function webPeopleNewCode_(body) {
  var no = peopleOwnerOnly_(); if (no) return no;
  return veraLocked_(function() {
    var d = peopleWithOwner_(), p = d.people.filter(function(x) { return x.name === String((body || {}).name || ''); })[0];
    if (!p) return { ok: false, error: 'No one by that name' };
    var code = peopleNewCode_();
    p.hashes = (p.hashes || []).concat([peopleHash_(code)]);
    peopleWrite_(d);
    return { ok: true, name: p.name, code: code };
  });
}

/** POST people_signout { name } (owner) → every code of theirs stops working. */
function webPeopleSignOut_(body) {
  var no = peopleOwnerOnly_(); if (no) return no;
  return veraLocked_(function() {
    var d = peopleWithOwner_(), p = d.people.filter(function(x) { return x.name === String((body || {}).name || ''); })[0];
    if (!p) return { ok: false, error: 'No one by that name' };
    var n = (p.hashes || []).length;
    p.hashes = [];
    peopleWrite_(d);
    return { ok: true, name: p.name, signedOut: n };
  });
}

/** POST people_view { name, view } (owner) → which dashboard they open. */
function webPeopleSetView_(body) {
  var no = peopleOwnerOnly_(); if (no) return no;
  var view = (body || {}).view;
  if (view !== 'full' && view !== 'lite') return { ok: false, error: 'view must be full or lite' };
  return veraLocked_(function() {
    var d = peopleWithOwner_(), p = d.people.filter(function(x) { return x.name === String((body || {}).name || ''); })[0];
    if (!p) return { ok: false, error: 'No one by that name' };
    p.view = view;
    peopleWrite_(d);
    return { ok: true, name: p.name, view: view };
  });
}

// The dashboard's list of tabs, kept in the hidden VERA State tab so the nightly run
// can fill the Access tab without anyone opening the dashboard.
var ACCESS_CATALOG_KEY_ = 'ACCESS_CATALOG';

/** Pure: only well-formed catalog entries, at most 400. */
function accessCleanCatalog_(list) {
  return (list || []).filter(function(c) { return c && /^(full|lite):[a-z_]+(\/[a-z_]+)?$/.test(String(c.id || '')); })
    .slice(0, 400).map(function(c) { return { id: String(c.id), area: String(c.area || '').slice(0, 60), tab: String(c.tab || '').slice(0, 80) }; });
}

function accessCatalogRead_() {
  try { var v = veraStoreGet_(ACCESS_CATALOG_KEY_); return v ? accessCleanCatalog_(JSON.parse(v)) : []; } catch (e) { return []; }
}

/** Brings the Access tab up to date with a catalog, under the lock. Logs a write that fails. */
function accessSyncWith_(cat, source) {
  return veraLocked_(function() {
    try {
      var plan = accessSyncPlan_(accessValues_(), cat, accessNames_(peopleWithOwner_()));
      if (plan.addedRows || plan.addedCols.length || !accessSheet_(false)) accessWrite_(plan);
      return { ok: true, addedRows: plan.addedRows, addedCols: plan.addedCols };
    } catch (e) {
      try { veraLog_('accessSync', 'System', 'Warning', 'Access tab couldn’t be written (' + source + '): ' + e.message, 0); } catch (x) {}
      return { ok: false, error: 'The Access tab couldn’t be written: ' + e.message };
    }
  });
}

/** POST access_sync { catalog: [{id, area, tab}] } (owner): a row for every tab the dashboard has. */
function webAccessSync_(body) {
  var no = peopleOwnerOnly_(); if (no) return no;
  var cat = accessCleanCatalog_((body || {}).catalog);
  if (cat.length) {
    try { if (JSON.stringify(cat) !== JSON.stringify(accessCatalogRead_())) veraStoreSet_(ACCESS_CATALOG_KEY_, JSON.stringify(cat)); } catch (e) {}
  }
  return accessSyncWith_(cat, 'dashboard');
}

/** Nightly: fills the Access tab from the last saved catalog (a new person or tab shows up). */
function accessNightlySync_() {
  var cat = accessCatalogRead_();
  if (!cat.length) return { skipped: 'no tab list saved yet: open the full dashboard once' };
  return accessSyncWith_(cat, 'nightly');
}

// ---- Slack's own posts (#218: doPost had no check) -------------------------------------

/** Pure: Slack's verification token from a form post, an interaction payload or an event body. */
function slackPostToken_(e, body) {
  if (body && body.token) return String(body.token);
  var p = (e && e.parameter) || {};
  if (p.payload) { try { var j = JSON.parse(p.payload); if (j && j.token) return String(j.token); } catch (x) {} }
  if (p.token) return String(p.token);
  var raw = (e && e.postData && e.postData.contents) || '';
  var m = /(?:^|&)payload=([^&]*)/.exec(raw);
  if (m) { try { var j2 = JSON.parse(decodeURIComponent(m[1].replace(/\+/g, ' '))); if (j2 && j2.token) return String(j2.token); } catch (x) {} }
  var t = /(?:^|&)token=([^&]*)/.exec(raw);
  return t ? decodeURIComponent(t[1].replace(/\+/g, ' ')) : '';
}

/** Is this really from Slack? Checked when SLACK_VERIFICATION_TOKEN is set; until then, allowed. */
function slackPostOk_(e, body) {
  var want = '';
  try { want = PropertiesService.getScriptProperties().getProperty('SLACK_VERIFICATION_TOKEN') || ''; } catch (x) {}
  if (!want) return true;
  return slackPostToken_(e, body) === want;
}
