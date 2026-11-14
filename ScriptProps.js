// ============================================================
// VERA — ScriptProps.js
// System › Checks › 🔑 Script Properties: every Script Property by name, what it
// is and where it belongs. Values never leave the server.
// ============================================================
//
// Since the settings move (Settings.js), what's left in Script Properties is:
//   - secrets: API keys and tokens (they stay);
//   - the two settings needed before the Config tab can be read: VERA_SHEET_ID and
//     SLACK_ALLOWED_USER_IDS (they stay);
//   - VERA's own records: the one-time markers, the feature-state bundles, the
//     settings copy and the sign-in fingerprints (they stay);
//   - settings the move left alone, each with the reason;
//   - old copies of a marker, a feature's state or a cache that now live in a
//     bundle or the VERA State tab;
//   - everything else: VERA's own running notes (timestamps, "already sent"
//     markers, caches it rewrites and prunes itself).
//
// GET script_props (owner) lists them. POST settings_move runs the move without the
// editor. POST script_props_clean removes only old copies whose value is already in
// their new home, read back first. Secrets and anything unrecognised are never
// deleted from here.
// ============================================================

var SP_NEEDED_  = ['VERA_SHEET_ID', 'SLACK_ALLOWED_USER_IDS'];
var SP_RECORDS_ = ['VERA_ONCE_MARKERS', 'VERA_SETTINGS_COPY', 'VERA_USER_TOKENS'];
var SP_SECRET_RE_ = /(KEY|TOKEN|SECRET|PASSWORD)$/;

/** Pure: the old names that moved into a bundle or the VERA State tab → { name: where }. */
function spOldHomes_() {
  var at = {};
  VERA_ONCE_MARKERS_.forEach(function(n) { at[n] = 'markers'; });
  Object.keys(VERA_STATE_BUNDLES_).forEach(function(b) { VERA_STATE_BUNDLES_[b].forEach(function(n) { at[n] = 'state:' + b; }); });
  VERA_STORE_KEYS_.forEach(function(n) { at[n] = 'store'; });
  return at;
}

/**
 * Pure: sorts property names into groups. info: { name: { placeholder, setting,
 * inHome } } (what the server learned from the values, without the values).
 * → { counts: {group: n}, groups: { group: [{ name, note }] }, total }
 */
function spGroups_(names, info) {
  var settings = {}, old = spOldHomes_(), g = { secret: [], needed: [], records: [], settings: [], old: [], other: [] };
  VERA_SETTINGS_.concat(Object.keys(VERA_SETTING_ROWS_)).forEach(function(k) { settings[k] = true; });
  (names || []).slice().sort().forEach(function(n) {
    var i = (info || {})[n] || {};
    if (SP_NEEDED_.indexOf(n) !== -1) return g.needed.push({ name: n, note: i.placeholder ? 'Still a setup placeholder: paste the real value in the Apps Script editor' : '' });
    if (SP_RECORDS_.indexOf(n) !== -1 || /^VERA_STATE_/.test(n)) return g.records.push({ name: n, note: '' });
    if (settings[n]) return g.settings.push({ name: n, note: i.setting || '' });
    if (old[n]) return g.old.push({ name: n, note: i.inHome ? 'Already copied to its new home; safe to remove' : 'Not copied yet: “Move settings now” moves it', removable: !!i.inHome });
    if (SP_SECRET_RE_.test(n)) return g.secret.push({ name: n, note: i.placeholder ? 'Still a setup placeholder: paste the real value in the Apps Script editor' : '' });
    g.other.push({ name: n, note: '' });
  });
  var counts = {}, total = 0;
  Object.keys(g).forEach(function(k) { counts[k] = g[k].length; total += g[k].length; });
  return { counts: counts, groups: g, total: total };
}

/** Pure: why a setting is still a Script Property, from its Config cell and its value. */
function spSettingWhy_(cfgValue, propValue) {
  var c = String(cfgValue == null ? '' : cfgValue).trim(), p = String(propValue == null ? '' : propValue).trim();
  if (veraIsPlaceholder_(p)) return 'Still a setup placeholder: paste the real value into Config, then remove this property';
  if (!c) return 'Config is blank: “Move settings now” copies it in';
  if (veraIsPlaceholder_(c)) return 'Config holds a placeholder: “Move settings now” puts the real value there';
  if (c === p || (veraIdFrom_(c) && veraIdFrom_(c) === veraIdFrom_(p))) return 'Same as Config: “Move settings now” removes this copy';
  return 'Config holds a different value, and Config is the one VERA uses. Remove this property in the editor once Config is right';
}

/** Is an old copy's value already in its new home? (Values compared on the server only.) */
function spInHome_(name, where, value, props) {
  try {
    if (where === 'markers') return !!veraOnceBundle_(props)[name];
    if (where.indexOf('state:') === 0) {
      var b = JSON.parse(props.getProperty(veraStateProp_(where.slice(6))) || '{}') || {};
      return b[name] != null && String(b[name]) === String(value);
    }
    if (where === 'store') { var r = veraStoreRows_()[name]; return !!r && r.value === String(value); }
  } catch (e) {}
  return false;
}

/** The server's look at the values: placeholders, settings' reasons, old copies' homes. Names only out. */
function spInspect_() {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties() || {}, names = Object.keys(all);
  var cfg = {};
  try { cfg = getConfigValues() || {}; } catch (e) { cfg = {}; }
  var settings = {}, old = spOldHomes_(), info = {};
  VERA_SETTINGS_.concat(Object.keys(VERA_SETTING_ROWS_)).forEach(function(k) { settings[k] = true; });
  names.forEach(function(n) {
    var v = all[n], i = { placeholder: veraIsPlaceholder_(v) };
    if (settings[n]) i.setting = spSettingWhy_(cfg[veraSettingRow_(n)], v);
    else if (old[n]) i.inHome = spInHome_(n, old[n], v, props);
    info[n] = i;
  });
  return { names: names, info: info, props: props, all: all, old: old };
}

/** GET script_props (owner) → names in groups, never a value. */
function webScriptProps_() {
  var no = peopleOwnerOnly_(); if (no) return no;
  var s = spInspect_(), r = spGroups_(s.names, s.info);
  return { ok: true, total: r.total, counts: r.counts, groups: r.groups, limit: 50 };
}

/** POST settings_move (owner): the one-time move, without the editor. → names and counts. */
function webSettingsMove_() {
  var no = peopleOwnerOnly_(); if (no) return no;
  var r = veraLocked_(function() { return veraMoveSettings_(); });
  if (!r) return { ok: false, error: 'The Config tab couldn’t be found, so nothing moved' };
  return { ok: true, moved: r.moved, same: r.same, kept: r.kept, markers: r.markers.length,
           state: r.state || [], stores: r.stores || [], placeholders: r.placeholders || [], missing: r.missing };
}

/** POST script_props_clean (owner): removes old copies already in their new home, each checked first. */
function webScriptPropsClean_() {
  var no = peopleOwnerOnly_(); if (no) return no;
  return veraLocked_(function() {
    var s = spInspect_(), removed = [], left = [];
    s.names.forEach(function(n) {
      if (!s.old[n]) return;
      if (spInHome_(n, s.old[n], s.all[n], s.props)) { s.props.deleteProperty(n); removed.push(n); }
      else left.push(n);
    });
    return { ok: true, removed: removed, left: left };
  });
}
