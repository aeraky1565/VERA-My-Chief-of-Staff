// System › Checks › Script Properties. Pins:
//  - every property lands in the right group: needed, VERA's records, settings not
//    moved (each with why), old copies (marked safe to remove only when their value
//    is already in its new home), secrets, and VERA's running notes;
//  - no value ever reaches the response (invented secret values are searched for);
//  - owner only, for the list, the move and the clean;
//  - "Remove the old copies" deletes only copies already in their new home, never a
//    secret, a setting or anything unrecognised;
//  - the panel in the dashboard: where it lives, and what it calls.
// Invented names and values.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const SET = read('Settings.js'), SP = read('ScriptProps.js'), WEB = read('WebApp.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

const SECRET = 'sk-INVENTED-SECRET-VALUE-0001', BOT = 'xoxb-INVENTED-BOT-0002';
function world(over) {
  const store = Object.assign({
    CLAUDE_API_KEY: SECRET, SLACK_BOT_TOKEN: BOT, SLACK_SIGNING_SECRET: 'PASTE_SIGNING_SECRET_HERE', VERA_WEB_TOKEN: 'web-INVENTED-0003',
    VERA_SHEET_ID: 'InventedVeraSheet01234567', SLACK_ALLOWED_USER_IDS: 'U0A,U0B',
    VERA_ONCE_MARKERS: J({ TP_MIGRATED: '2026-01-01' }), VERA_STATE_PACING: J({ PACING_MODE_ACTIVE: 'true' }), VERA_SETTINGS_COPY: '{}', VERA_USER_TOKENS: '{"people":[]}',
    VERA_DASHBOARD_URL: 'https://example.test/old/',            // Config differs
    SLACK_VICTORIA_USER_ID: 'U0INVENTED2',                       // Config is a placeholder
    SAT_SHEET_ID: 'InventedSatSheet0123456789',                  // Config blank
    TP_MIGRATED: '2026-01-01',                                   // old copy, already in the bundle
    LG_DIDIT: 'x', PACING_MODE_ACTIVE: 'true',                   // a note; an old copy already in its bundle
    PACING_MODE_ENDS: '2026-12-01',                              // old copy NOT in its bundle
    FLIGHT_DAYS: '{"a":1}', EXPLORER_HISTORY: '[1]',             // a cache in the tab; one whose tab row differs
    day_plan_2026_11_01: '{}', LAST_NIGHTLY_RUN: 'NOTE-INVENTED-0004',
  }, (over || {}).store || {});
  const log = [];
  const api = {
    getProperty: k => (k in store ? store[k] : null),
    getProperties: () => Object.assign({}, store),
    setProperty: (k, v) => { log.push(['set', k]); store[k] = String(v); },
    deleteProperty: k => { log.push(['del', k]); delete store[k]; },
  };
  let owner = (over || {}).owner !== false;
  const c = { String, Object, JSON, Array, Date, Math, RegExp, Number,
    PropertiesService: { getScriptProperties: () => api },
    getConfigValues: () => ({ vera_dashboard_url: 'https://example.test/new/', slack_victoria_user_id: 'PASTE_VICTORIA_USER_ID', sat_sheet_id: '' }),
    Logger: { log: () => {} }, LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }), getUserLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { flush: () => {} }, TABS: { CONFIG: 'Config', VERA_STATE: 'VERA State' },
    peopleOwnerOnly_: () => (owner ? null : { ok: false, error: 'Only the owner can do that' }),
  };
  vm.createContext(c);
  vm.runInContext(SET, c);
  vm.runInContext(SP, c);
  vm.runInContext('veraStoreRows_ = function() { return { FLIGHT_DAYS: { row: 2, value: \'{"a":1}\' }, EXPLORER_HISTORY: { row: 3, value: "[0]" } }; };', c);
  return { c, store, log };
}
const byName = r => { const o = {}; Object.keys(r.groups).forEach(g => r.groups[g].forEach(i => { o[i.name] = Object.assign({ group: g }, i); })); return o; };

console.log('\nthe groups');
{
  const { c } = world();
  const r = c.webScriptProps_(), n = byName(r);
  check('the list answers, with the total and the editor’s limit', r.ok && r.total === Object.keys(world().store).length && r.limit === 50, J(r.counts));
  check('VERA_SHEET_ID and the allowed users are needed before Config', n.VERA_SHEET_ID.group === 'needed' && n.SLACK_ALLOWED_USER_IDS.group === 'needed');
  check('keys and tokens are secrets', ['CLAUDE_API_KEY', 'SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'VERA_WEB_TOKEN'].every(k => n[k].group === 'secret'));
  check('…a secret still left as the setup placeholder says so (without its value)', /placeholder/.test(n.SLACK_SIGNING_SECRET.note) && !n.CLAUDE_API_KEY.note);
  check('the bundles, the settings copy and the fingerprints are VERA’s records', ['VERA_ONCE_MARKERS', 'VERA_STATE_PACING', 'VERA_SETTINGS_COPY', 'VERA_USER_TOKENS'].every(k => n[k].group === 'records'));
  check('a setting left behind says why: Config differs', n.VERA_DASHBOARD_URL.group === 'settings' && /different value/.test(n.VERA_DASHBOARD_URL.note));
  check('…Config holds a placeholder', /placeholder: “Move settings now” puts the real value there/.test(n.SLACK_VICTORIA_USER_ID.note));
  check('…Config is blank', /Config is blank/.test(n.SAT_SHEET_ID.note));
  check('an old copy already in its new home can go; one that isn’t can’t',
        n.TP_MIGRATED.group === 'old' && n.TP_MIGRATED.removable && n.PACING_MODE_ACTIVE.removable && n.FLIGHT_DAYS.removable
        && n.PACING_MODE_ENDS.removable === false && n.EXPLORER_HISTORY.removable === false && /Not copied yet/.test(n.PACING_MODE_ENDS.note));
  check('a state name ending in KEY is still an old copy, not a secret', c.spGroups_(['PACING_OFFER_FLAG_KEY'], {}).groups.old.length === 1);
  check('everything else is VERA’s running notes', ['LG_DIDIT', 'day_plan_2026_11_01', 'LAST_NIGHTLY_RUN'].every(k => n[k].group === 'other'));
  const out = J(r);
  check('no value is in the response', [SECRET, BOT, 'web-INVENTED', 'InventedVeraSheet', 'U0A,U0B', 'example.test', 'U0INVENTED2', 'InventedSatSheet', '2026-12-01', 'PASTE_', 'NOTE-INVENTED'].every(v => out.indexOf(v) === -1), out.slice(0, 300));
}

console.log('\nonly the owner');
{
  const { c, log } = world({ owner: false });
  check('not the owner: the list, the move and the clean all refuse, and nothing is touched',
        c.webScriptProps_().ok === false && c.webSettingsMove_().ok === false && c.webScriptPropsClean_().ok === false && log.length === 0);
}

console.log('\nremove the old copies');
{
  const { c, store } = world();
  const r = c.webScriptPropsClean_();
  check('only the copies already in their new home go', J(r.removed.sort()) === J(['FLIGHT_DAYS', 'PACING_MODE_ACTIVE', 'TP_MIGRATED']) && !('TP_MIGRATED' in store) && !('FLIGHT_DAYS' in store), J(r));
  check('…the rest are kept and named', r.left.indexOf('PACING_MODE_ENDS') !== -1 && r.left.indexOf('EXPLORER_HISTORY') !== -1 && 'PACING_MODE_ENDS' in store && 'EXPLORER_HISTORY' in store);
  check('secrets, settings, records and notes are never touched', [SECRET, BOT].every(v => Object.values(store).indexOf(v) !== -1)
        && ['VERA_DASHBOARD_URL', 'SAT_SHEET_ID', 'VERA_ONCE_MARKERS', 'VERA_STATE_PACING', 'LG_DIDIT', 'LAST_NIGHTLY_RUN', 'VERA_SHEET_ID'].every(k => k in store));
}

console.log('\nmove settings now');
{
  const src = (s, name) => { const a = s.indexOf('function ' + name + '('); return a === -1 ? '' : s.slice(a, s.indexOf('\n}\n', a) + 2); };
  check('it runs the same move as the editor, under the lock, and answers with names and counts only',
        /veraLocked_\(function\(\) \{ return veraMoveSettings_\(\); \}\)/.test(src(SP, 'webSettingsMove_')) && /markers: r\.markers\.length/.test(src(SP, 'webSettingsMove_')));
  check('the routes: script_props (GET), settings_move and script_props_clean (POST)',
        /case 'script_props':\s+return jsonOut_\(webScriptProps_\(\)\);/.test(WEB) && /case 'settings_move':\s+return jsonOut_\(webSettingsMove_\(\)\);/.test(WEB) && /case 'script_props_clean':\s+return jsonOut_\(webScriptPropsClean_\(\)\);/.test(WEB));
}

console.log('\nthe panel');
{
  check('System › Checks › 🔑 Script Properties, after Trip IDs', /\{id:'trip_ids',label:'🧳 Trip IDs'\},\{id:'script_props',label:'🔑 Script Properties'\}/.test(APP) && /cur==='script_props'&&h\(SysScriptProps,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
  check('…in the Checks group of both dashboards’ menus (the shared nav block)', /items:\['test','api_health','agent_health','trip_ids','script_props'\]/.test(APP) && /items:\['test','api_health','agent_health','trip_ids','script_props'\]/.test(LITE));
  check('index.html is rebuilt with it', read('docs/index.html').includes('function SysScriptProps('));
  const p = (() => { const a = APP.indexOf('function SysScriptProps('); return APP.slice(a, APP.indexOf('\nfunction SysPeople(', a)); })();
  check('it calls only its three actions', J((p.match(/action:'[a-z_]+'/g) || []).concat(p.match(/act\('[a-z_]+'/g) || []).sort()) === J(["act('script_props_clean'", "act('settings_move'", "action:'script_props'"]), J(p.match(/action:'[a-z_]+'|act\('[a-z_]+'/g)));
  check('removing asks first', /window\.confirm\('Remove '/.test(p));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
