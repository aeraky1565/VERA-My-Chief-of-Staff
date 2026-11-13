// ============================================================
// VERA — Settings.js
// Settings live in the Config tab; Script Properties keep the secrets.
// ============================================================
//
// The Apps Script property editor lists only the first 50 Script Properties and
// turns read-only past that, and VERA had about 80. Most of them were not secrets:
// sheet and doc ids, Slack channel and user ids, the dashboard link, an email
// address, plus one-time "already done" markers. So:
//
//   - SETTINGS (VERA_SETTINGS_) are read with veraSetting_(KEY): the Config row
//     named key.toLowerCase() first, then the old Script Property, so a
//     deployment that hasn't moved yet keeps working. If the Config tab can't be
//     read at all, the copy in VERA_SETTINGS_COPY is used, so a sheet hiccup
//     doesn't silence Slack or the morning email. The nightly run refreshes that
//     copy, and only writes it when something changed.
//   - ONE-TIME MARKERS (VERA_ONCE_MARKERS_) live in one property,
//     VERA_ONCE_MARKERS, as {name: stamp}. veraOnceGet_ still reads the old
//     property when the bundle doesn't have it, so no migration runs twice.
//   - FEATURE STATE (VERA_STATE_BUNDLES_) lives in one property per feature,
//     VERA_STATE_<FEATURE>, as {name: value}: pacing and vacation mode, the PTO
//     buffer, the mail counter, and capacity (your override and the nightly guess
//     kept apart, so one can't undo the other). veraStateGet_ still reads a value's
//     old property until the first write moves it.
//   - CACHES AND HISTORIES (VERA_STORE_KEYS_) live in the hidden VERA State tab,
//     one row each (veraStoreGet_/veraStoreSet_), falling back to the old
//     property, and to the property again if the tab can't be written.
//   - SECRETS, VERA_SHEET_ID (needed to find the Config tab at all) and
//     SLACK_ALLOWED_USER_IDS (who may talk to VERA) stay Script Properties.
//
// moveSettingsToConfig() is run once, by hand, from the editor (after a backup
// copy of the sheet). It copies each setting into Config only where that cell is
// blank, reads it back, and only then deletes the property. It logs names and
// counts, never values.
// ============================================================

var VERA_SETTINGS_ = [
  'SAT_SHEET_ID', 'TRANSACTIONS_SHEET_ID', 'ADDRESS_BOOK_SHEET_ID',
  'LIFE_PLAN_DOC_ID', 'SHOPPING_LIST_DOC_ID', 'VERA_LOGO_FILE_ID',
  'VERA_DASHBOARD_URL', 'VERA_SEARCH_ENGINE', 'MORNING_NUDGE_EMAIL',
  'SLACK_CHAT_CHANNEL_ID', 'SLACK_NOTIFICATIONS_CHANNEL_ID', 'SLACK_LOGS_CHANNEL_ID', 'SLACK_ACT_NOW_CHANNEL_ID',
  'SLACK_AHMED_USER_ID', 'SLACK_VICTORIA_USER_ID', 'NEIGHBORHOOD_HOA_URL',
];

// Old Script Property → the Config row it moves to, where that isn't its own name
// in lower case.
var VERA_SETTING_ROWS_ = { ARIA_SHEET_ID: 'roster_link_aria' };

var VERA_ONCE_MARKERS_ = [
  'CAR_CRED_IMPORTED', 'CAR_MIGRATED_V1', 'CU_CONFIG_SEEDED', 'FLIGHT_POLL_CONFIG_SEEDED',
  'LF_WISH_LIST_MIGRATED', 'LOG_SECRETS_SCRUBBED', 'NETWORTH_MAPPING_SEEDED', 'PL_OCCASION_MOVED',
  'TE_LEGACY_DONE', 'TP_MIGRATED', 'WISHLIST_INITIALS_SEEDED',
];

var VERA_SETTINGS_COPY_PROP_ = 'VERA_SETTINGS_COPY';
var VERA_ONCE_PROP_          = 'VERA_ONCE_MARKERS';

function veraSettingRow_(key) {
  var k = String(key || '');
  return VERA_SETTING_ROWS_[k] || k.toLowerCase();
}

/**
 * A setting: the Config row first, then the old Script Property, then (only when
 * the Config tab couldn't be read at all) the nightly copy. → trimmed string or ''.
 */
function veraSetting_(key) {
  var k = String(key || ''), cfg = null, v = '';
  try { cfg = getConfigValues() || {}; } catch (e) { cfg = null; }
  if (cfg) v = String(cfg[veraSettingRow_(k)] == null ? '' : cfg[veraSettingRow_(k)]).trim();
  if (v) return v;
  var props;
  try { props = PropertiesService.getScriptProperties(); } catch (e) { return ''; }
  try { v = String(props.getProperty(k) || '').trim(); } catch (e) { v = ''; }
  if (v) return v;
  if (cfg && Object.keys(cfg).length) return '';
  try { v = String((JSON.parse(props.getProperty(VERA_SETTINGS_COPY_PROP_) || '{}') || {})[k] || '').trim(); } catch (e) { v = ''; }
  return v;
}

/**
 * Saves a setting from the dashboard: into its Config row (added if missing), and
 * drops the old Script Property, so the two can't disagree. → true when saved.
 */
function veraSetSetting_(key, value) {
  var k = String(key || ''), row = veraSettingRow_(k), v = String(value == null ? '' : value).trim();
  var sheet = getSpreadsheet().getSheetByName(TABS.CONFIG);
  if (!sheet) return false;
  var n = Math.max(sheet.getLastRow() - 1, 0), at = 0;
  if (n) sheet.getRange(2, 1, n, 1).getValues().some(function(r, i) { if (String(r[0] || '').trim() === row) { at = i + 2; return true; } return false; });
  if (at) sheet.getRange(at, 2).setValue(v); else sheet.appendRow([row, v]);
  try { _configCache_ = null; } catch (e) {}
  try { var props = PropertiesService.getScriptProperties(); if (props.getProperty(k) != null) props.deleteProperty(k); } catch (e) {}
  return true;
}

/** A Drive id from a setting that may hold a bare id or a pasted link. */
function veraIdFrom_(v) {
  var t = String(v == null ? '' : v).trim();
  var m = t.match(/\/d\/([A-Za-z0-9_-]{20,})/) || t.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]+$/.test(t) ? t : '';
}
function veraSettingId_(key) { return veraIdFrom_(veraSetting_(key)); }

/**
 * Nightly: keeps VERA_SETTINGS_COPY in step with the Config tab. Writes only when
 * a value changed, and never when the Config tab couldn't be read.
 */
function veraSettingsCopyRefresh_() {
  var cfg;
  try { cfg = getConfigValues() || {}; } catch (e) { return { written: false, reason: 'config unreadable' }; }
  if (!Object.keys(cfg).length) return { written: false, reason: 'config unreadable' };
  var props = PropertiesService.getScriptProperties(), copy = {};
  VERA_SETTINGS_.forEach(function(k) {
    var v = String(cfg[veraSettingRow_(k)] == null ? '' : cfg[veraSettingRow_(k)]).trim();
    if (!v) { try { v = String(props.getProperty(k) || '').trim(); } catch (e) { v = ''; } }
    if (v) copy[k] = v;
  });
  var next = JSON.stringify(copy), was = '';
  try { was = props.getProperty(VERA_SETTINGS_COPY_PROP_) || ''; } catch (e) { was = ''; }
  if (next === was) return { written: false, count: Object.keys(copy).length };
  props.setProperty(VERA_SETTINGS_COPY_PROP_, next);
  return { written: true, count: Object.keys(copy).length };
}

// ---- one-time markers ------------------------------------------------------------

function veraOnceBundle_(props) {
  try { var b = JSON.parse(props.getProperty(VERA_ONCE_PROP_) || '{}'); return (b && typeof b === 'object') ? b : {}; }
  catch (e) { return {}; }
}

/** A one-time marker's stamp, or null: the bundle first, then its old property. */
function veraOnceGet_(name) {
  var props = PropertiesService.getScriptProperties();
  var b = veraOnceBundle_(props);
  if (b[name]) return String(b[name]);
  var old = props.getProperty(name);
  return old ? String(old) : null;
}

/** Records a one-time marker in the bundle, and drops its old property if any. */
function veraOnceSet_(name, stamp) {
  var props = PropertiesService.getScriptProperties();
  var b = veraOnceBundle_(props);
  b[name] = String(stamp == null || stamp === '' ? new Date().toISOString() : stamp);
  props.setProperty(VERA_ONCE_PROP_, JSON.stringify(b));
  try { if (props.getProperty(name) != null) props.deleteProperty(name); } catch (e) {}
}

// ---- feature state ---------------------------------------------------------------

var VERA_STATE_BUNDLES_ = {
  PACING:            ['PACING_FIRST_DETECTED', 'PACING_MODE_ACTIVE', 'PACING_MODE_ENDS', 'PACING_OFFER_FLAG_KEY',
                      'VACATION_MODE_ACTIVE', 'VACATION_MODE_ENDS', 'VACATION_TRIP_NAME'],
  PTO_BUFFER:        ['PTO_BUFFER_EVENT_ID', 'PTO_BUFFER_EVENT_DATE', 'PTO_BUFFER_DECLINED_UNTIL'],
  MAIL:              ['MAIL_COUNTER_PIECES', 'MAIL_COUNTER_PACKAGES', 'MAIL_COUNTER_LAST_SCAN',
                      'MAIL_COUNTER_LAST_SCAN_RUN', 'MAIL_COUNTER_LAST_RESET'],
  // Two bundles on purpose: you set the override from chat or Slack while the
  // nightly run writes its guess, and one read-modify-write must never undo the other.
  CAPACITY_OVERRIDE: ['capacity_override_mode', 'capacity_override_date'],
  CAPACITY_INFERRED: ['capacity_inferred_mode', 'capacity_inferred_date'],
};

function veraStateProp_(bundle) { return 'VERA_STATE_' + bundle; }

function veraStateNames_(bundle) {
  var names = VERA_STATE_BUNDLES_[bundle];
  if (!names) throw new Error('veraState: unknown bundle ' + bundle);
  return names;
}

/**
 * A feature's state: {name: string}. The bundle first; a value it doesn't hold yet
 * comes from its old Script Property, so nothing resets when this ships.
 */
function veraStateGet_(bundle) {
  var names = veraStateNames_(bundle), props = PropertiesService.getScriptProperties(), b = {}, out = {};
  try { b = JSON.parse(props.getProperty(veraStateProp_(bundle)) || '{}') || {}; } catch (e) { b = {}; }
  names.forEach(function(n) {
    if (b[n] != null && b[n] !== '') { out[n] = String(b[n]); return; }
    var old = props.getProperty(n);
    if (old != null && old !== '') out[n] = String(old);
  });
  return out;
}

/**
 * Changes a feature's state. patch: {name: value}; null or '' clears that value.
 * Writes the one bundle property, reads it back, and only then drops the feature's
 * old properties (their values are carried in the bundle by then). → the new state.
 */
function veraStateSet_(bundle, patch) {
  var names = veraStateNames_(bundle), props = PropertiesService.getScriptProperties();
  var cur = veraStateGet_(bundle);
  Object.keys(patch || {}).forEach(function(k) {
    if (names.indexOf(k) === -1) throw new Error('veraState: ' + k + ' is not in ' + bundle);
    var v = patch[k];
    if (v == null || v === '') delete cur[k]; else cur[k] = String(v);
  });
  var prop = veraStateProp_(bundle), next = JSON.stringify(cur);
  if (Object.keys(cur).length) props.setProperty(prop, next);
  else if (props.getProperty(prop) != null) props.deleteProperty(prop);
  var back = props.getProperty(prop);
  if ((Object.keys(cur).length ? back === next : back == null)) {
    names.forEach(function(n) { if (props.getProperty(n) != null) props.deleteProperty(n); });
  }
  return cur;
}

/**
 * The same four calls as Script Properties (getProperty, setProperty, setProperties,
 * deleteProperty), backed by one feature's bundle. A name outside the bundle throws,
 * so a feature can't quietly write a stray property.
 */
function veraStateProps_(bundle) {
  veraStateNames_(bundle);
  return {
    getProperty:    function(n) { var v = veraStateGet_(bundle)[n]; return v == null ? null : v; },
    setProperty:    function(n, v) { var p = {}; p[n] = v; veraStateSet_(bundle, p); return this; },
    setProperties:  function(o) { veraStateSet_(bundle, o || {}); return this; },
    deleteProperty: function(n) { var p = {}; p[n] = null; veraStateSet_(bundle, p); return this; },
  };
}

// ---- caches and histories: the hidden VERA State tab ------------------------------

var VERA_STORE_KEYS_    = ['FLIGHT_STATUS_CACHE', 'FLIGHT_DAYS', 'EXPLORER_HISTORY', 'WKND_PLAN_HISTORY'];
var VERA_STORE_HEADERS_ = ['Key', 'Value', 'Updated'];
var VERA_STORE_MAX_     = 45000;   // a cell holds 50,000 characters
var _veraStoreCache_    = null;    // the tab's rows, read once per execution

function veraStoreSheet_(create) {
  var ss = getSpreadsheet(), sh = ss.getSheetByName(TABS.VERA_STATE);
  if (!sh && create) {
    sh = ensureSheet(ss, TABS.VERA_STATE, VERA_STORE_HEADERS_);
    try { sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat('@'); } catch (e) {}
    try { sh.hideSheet(); } catch (e) {}
  }
  return sh;
}

function veraStoreRows_() {
  if (_veraStoreCache_) return _veraStoreCache_;
  var sh = veraStoreSheet_(false), rows = {};
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function(r, i) {
      var k = String(r[0] || '').trim();
      if (k && !(k in rows)) rows[k] = { row: i + 2, value: String(r[1] == null ? '' : r[1]) };
    });
  }
  _veraStoreCache_ = rows;
  return rows;
}

/** A cache or history (a string), or null: the VERA State tab, else its old property. */
function veraStoreGet_(key) {
  try { var r = veraStoreRows_()[key]; if (r && r.value !== '') return r.value; }
  catch (e) { Logger.log('veraStoreGet_: the VERA State tab couldn’t be read for ' + key); }
  try { return PropertiesService.getScriptProperties().getProperty(key); } catch (e) { return null; }
}

/**
 * Saves a cache or history to its row in the VERA State tab (added if missing), reads
 * it back, then drops its old property. If the tab can't be written, it stays a
 * Script Property, so a sheet hiccup never breaks a flight poll. → true when in the tab.
 */
function veraStoreSet_(key, value) {
  var v = String(value == null ? '' : value), props = PropertiesService.getScriptProperties();
  if (v.length > VERA_STORE_MAX_) { Logger.log('veraStoreSet_: ' + key + ' is ' + v.length + ' characters, over the limit; not saved'); return false; }
  var ok = false;
  try {
    var sh = veraStoreSheet_(true), rows = veraStoreRows_(), now = new Date().toISOString();
    if (rows[key]) sh.getRange(rows[key].row, 2, 1, 2).setValues([[v, now]]);
    else { sh.appendRow([key, v, now]); rows[key] = { row: sh.getLastRow(), value: v }; }
    rows[key].value = v;
    ok = String(sh.getRange(rows[key].row, 2).getValue()) === v;
  } catch (e) { ok = false; }
  if (!ok) {
    Logger.log('veraStoreSet_: the VERA State tab couldn’t be written for ' + key + '; kept in Script Properties');
    _veraStoreCache_ = null;
    try { props.setProperty(key, v); } catch (e) {}
    return false;
  }
  try { if (props.getProperty(key) != null) props.deleteProperty(key); } catch (e) {}
  return true;
}

// ---- the one-time move -----------------------------------------------------------

/**
 * Run once by hand from the Apps Script editor, after making a backup copy of the
 * sheet. Moves the settings into the Config tab, the one-time markers and the
 * feature state into their bundles, and the caches into the hidden VERA State tab.
 * Safe to run again.
 *
 * For each setting with a Script Property:
 *   - Config cell blank (or no row): writes it, reads it back, then deletes the property;
 *   - Config already holds the same value: deletes the property;
 *   - Config holds a different value: leaves both and says so (Config wins).
 * Logs names and counts only, never values.
 */
function moveSettingsToConfig() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('moveSettingsToConfig: another run holds the lock; try again in a minute'); return null; }
  try { return veraMoveSettings_(); } finally { lock.releaseLock(); }
}

function veraMoveSettings_() {
  var props = PropertiesService.getScriptProperties();
  var sheet = getSpreadsheet().getSheetByName(TABS.CONFIG);
  if (!sheet) { Logger.log('moveSettingsToConfig: no Config tab, nothing moved'); return null; }
  var out = { moved: [], same: [], kept: [], markers: [], missing: [] };

  var rowsOf = function() {
    var n = Math.max(sheet.getLastRow() - 1, 0), at = {};
    if (n) sheet.getRange(2, 1, n, 2).getValues().forEach(function(r, i) {
      var k = String(r[0] || '').trim();
      if (k && !(k in at)) at[k] = { row: i + 2, value: String(r[1] == null ? '' : r[1]).trim() };
    });
    return at;
  };

  VERA_SETTINGS_.concat(Object.keys(VERA_SETTING_ROWS_)).forEach(function(k) {
    var row = veraSettingRow_(k), at = rowsOf(), have = at[row] ? at[row].value : '';
    var prop = String(props.getProperty(k) || '').trim();
    if (!prop) { if (!have) out.missing.push(row); return; }
    if (have) {
      if (have === prop || (veraIdFrom_(have) && veraIdFrom_(have) === veraIdFrom_(prop))) { props.deleteProperty(k); out.same.push(k); }
      else out.kept.push(k);
      return;
    }
    if (at[row]) sheet.getRange(at[row].row, 2).setValue(prop);
    else sheet.appendRow([row, prop]);
    try { SpreadsheetApp.flush(); } catch (e) {}
    var back = rowsOf()[row];
    if (back && back.value === prop) { props.deleteProperty(k); out.moved.push(k); }
    else out.kept.push(k);
  });
  try { _configCache_ = null; } catch (e) {}

  VERA_ONCE_MARKERS_.forEach(function(m) {
    var old = props.getProperty(m);
    if (old == null || old === '') return;
    veraOnceSet_(m, old);
    out.markers.push(m);
  });

  // Feature state into its bundles, caches into the VERA State tab (each one read
  // back before its old property goes; see veraStateSet_ and veraStoreSet_).
  out.state = []; out.stores = []; out.storesKept = [];
  Object.keys(VERA_STATE_BUNDLES_).forEach(function(b) {
    var had = VERA_STATE_BUNDLES_[b].filter(function(n) { var v = props.getProperty(n); return v != null && v !== ''; });
    if (!had.length) return;
    veraStateSet_(b, {});
    if (!VERA_STATE_BUNDLES_[b].some(function(n) { return props.getProperty(n) != null; })) out.state.push(b);
  });
  VERA_STORE_KEYS_.forEach(function(k) {
    var old = props.getProperty(k);
    if (old == null || old === '') return;
    if (veraStoreSet_(k, old)) out.stores.push(k); else out.storesKept.push(k);
  });

  try { veraSettingsCopyRefresh_(); } catch (e) {}

  Logger.log('moveSettingsToConfig: moved ' + out.moved.length + (out.moved.length ? ' (' + out.moved.join(', ') + ')' : '') +
    '; already in Config ' + out.same.length + (out.same.length ? ' (' + out.same.join(', ') + ')' : '') +
    '; left as they are ' + out.kept.length + (out.kept.length ? ' (' + out.kept.join(', ') + ': Config holds a different value, or it didn’t read back)' : '') +
    '; markers bundled ' + out.markers.length +
    '; feature state bundled ' + out.state.length + (out.state.length ? ' (' + out.state.join(', ') + ')' : '') +
    '; caches moved to the VERA State tab ' + out.stores.length + (out.stores.length ? ' (' + out.stores.join(', ') + ')' : '') +
    (out.storesKept.length ? '; caches left in Script Properties (the tab couldn’t be written): ' + out.storesKept.join(', ') : '') +
    (out.missing.length ? '; not set anywhere: ' + out.missing.join(', ') : ''));
  return out;
}
