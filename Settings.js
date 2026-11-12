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

// ---- the one-time move -----------------------------------------------------------

/**
 * Run once by hand from the Apps Script editor, after making a backup copy of the
 * sheet. Moves the settings into the Config tab and the one-time markers into
 * their bundle. Safe to run again.
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

  try { veraSettingsCopyRefresh_(); } catch (e) {}

  Logger.log('moveSettingsToConfig: moved ' + out.moved.length + (out.moved.length ? ' (' + out.moved.join(', ') + ')' : '') +
    '; already in Config ' + out.same.length + (out.same.length ? ' (' + out.same.join(', ') + ')' : '') +
    '; left as they are ' + out.kept.length + (out.kept.length ? ' (' + out.kept.join(', ') + ': Config holds a different value, or it didn’t read back)' : '') +
    '; markers bundled ' + out.markers.length +
    (out.missing.length ? '; not set anywhere: ' + out.missing.join(', ') : ''));
  return out;
}
