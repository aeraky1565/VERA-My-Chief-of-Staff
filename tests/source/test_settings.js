// Script Properties cleanup: settings live in the Config tab, one-time markers in one
// bundle, secrets stay Script Properties. Pins:
//  - veraSetting_: Config row (key in lower case) first, then the old property; the
//    nightly copy only when the Config tab can't be read at all;
//  - veraIdFrom_: a bare id or a pasted Drive link;
//  - veraSettingsCopyRefresh_: writes only when something changed, never from an
//    unreadable Config tab;
//  - veraOnceGet_/veraOnceSet_: the bundle first, the old property still counts (so
//    no migration runs twice), setting one drops its old property;
//  - moveSettingsToConfig: copies only into a blank cell, reads it back before
//    deleting, leaves a different Config value alone, bundles the markers, never
//    logs a value; secrets and VERA_SHEET_ID are never touched;
//  - the call sites read through the helper, and no Drive id is written in code.
// Invented ids and values.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const SET = read('Settings.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

function fakeProps(init) {
  const store = Object.assign({}, init || {}), log = [];
  return { store, log, api: {
    getProperty: k => (k in store ? store[k] : null),
    setProperty: (k, v) => { log.push(['set', k]); store[k] = String(v); },
    deleteProperty: k => { log.push(['del', k]); delete store[k]; },
  } };
}
function fakeConfig(rows, opts) {
  const grid = [['Key', 'Value']].concat(rows.map(r => r.slice()));
  const o = opts || {};
  return { grid, sheet: {
    getLastRow: () => grid.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => grid.slice(r - 1, r - 1 + (nr || 1)).map(x => { const out = []; for (let i = 0; i < (nc || 1); i++) out.push(x[c - 1 + i] == null ? '' : x[c - 1 + i]); return out; }),
      setValue: v => { if (o.dropWrites) return; grid[r - 1][c - 1] = v; },
    }),
    appendRow: row => { if (o.dropWrites) return; grid.push(row.slice()); },
  } };
}
function ctx(p, cfg, extra) {
  const logs = [];
  const c = Object.assign({ String, Object, JSON, Array, Date, Math, RegExp,
    PropertiesService: { getScriptProperties: () => p.api },
    getConfigValues: typeof cfg === 'function' ? cfg : () => cfg || {},
    Logger: { log: s => logs.push(String(s)) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { flush: () => {} },
    TABS: { CONFIG: 'Config' },
    _configCache_: null,
  }, extra || {});
  c.__logs = logs;
  vm.createContext(c);
  vm.runInContext(SET, c);
  return c;
}

console.log('\nreading a setting');
{
  const p = fakeProps({ SAT_SHEET_ID: 'PropSatSheet0000000000001' });
  const c = ctx(p, { sat_sheet_id: '  CfgSatSheet00000000000001 ', other: 'x' });
  check('the Config row (key in lower case) comes first', c.veraSetting_('SAT_SHEET_ID') === 'CfgSatSheet00000000000001');
  const c2 = ctx(p, { other: 'x' });
  check('…else the old Script Property, so a deployment that hasn\'t moved keeps working', c2.veraSetting_('SAT_SHEET_ID') === 'PropSatSheet0000000000001');
  check('…else blank, even with a copy, while the Config tab reads fine', ctx(fakeProps({ VERA_SETTINGS_COPY: J({ SAT_SHEET_ID: 'Copy1' }) }), { other: 'x' }).veraSetting_('SAT_SHEET_ID') === '');
  const broken = ctx(fakeProps({ VERA_SETTINGS_COPY: J({ SLACK_LOGS_CHANNEL_ID: 'C0COPY001' }) }), () => { throw new Error('sheet down'); });
  check('the copy is used only when the Config tab can\'t be read', broken.veraSetting_('SLACK_LOGS_CHANNEL_ID') === 'C0COPY001');
  check('…or reads back empty', ctx(fakeProps({ VERA_SETTINGS_COPY: J({ SLACK_LOGS_CHANNEL_ID: 'C0COPY001' }) }), {}).veraSetting_('SLACK_LOGS_CHANNEL_ID') === 'C0COPY001');
  check('ARIA_SHEET_ID maps to the existing roster_link_aria row', ctx(fakeProps(), { roster_link_aria: 'x' }).veraSettingRow_('ARIA_SHEET_ID') === 'roster_link_aria');
}

console.log('\nids from links');
{
  const c = ctx(fakeProps(), {});
  check('a bare id', c.veraIdFrom_(' InventedDocId_0123456789abc ') === 'InventedDocId_0123456789abc');
  check('a Sheets or Docs link', c.veraIdFrom_('https://docs.google.com/spreadsheets/d/InventedSheetId0123456789xyz/edit#gid=0') === 'InventedSheetId0123456789xyz'
        && c.veraIdFrom_('https://docs.google.com/document/d/InventedDocId_0123456789abc/edit') === 'InventedDocId_0123456789abc');
  check('a Drive file link (the logo)', c.veraIdFrom_('https://drive.google.com/file/d/InventedFileId0123456789abc/view') === 'InventedFileId0123456789abc'
        && c.veraIdFrom_('https://drive.google.com/open?id=InventedFileId0123456789abc') === 'InventedFileId0123456789abc');
  check('text that is neither is no id', c.veraIdFrom_('my budget sheet') === '' && c.veraIdFrom_('') === '');
  const c2 = ctx(fakeProps(), { life_plan_doc_id: 'https://docs.google.com/document/d/InventedDocId_0123456789abc/edit' });
  check('veraSettingId_ takes the id out of a pasted link', c2.veraSettingId_('LIFE_PLAN_DOC_ID') === 'InventedDocId_0123456789abc');
}

console.log('\nthe nightly copy');
{
  const p = fakeProps({ SLACK_CHAT_CHANNEL_ID: 'C0CHAT001' });
  const c = ctx(p, { slack_logs_channel_id: 'C0LOG0001', unrelated: 'secret-ish' });
  const r1 = c.veraSettingsCopyRefresh_();
  const copy = JSON.parse(p.store.VERA_SETTINGS_COPY || '{}');
  check('copies the settings from Config, and old properties not yet moved', r1.written && copy.SLACK_LOGS_CHANNEL_ID === 'C0LOG0001' && copy.SLACK_CHAT_CHANNEL_ID === 'C0CHAT001', J(copy));
  check('…and nothing that isn\'t a setting', !('unrelated' in copy) && !('UNRELATED' in copy));
  const writes = p.log.length, r2 = c.veraSettingsCopyRefresh_();
  check('a second run with nothing changed writes nothing', !r2.written && p.log.length === writes);
  const p3 = fakeProps({ VERA_SETTINGS_COPY: J({ SLACK_LOGS_CHANNEL_ID: 'C0LOG0001' }) });
  const r3 = ctx(p3, () => { throw new Error('down'); }).veraSettingsCopyRefresh_();
  check('an unreadable Config tab never overwrites the copy', !r3.written && p3.log.length === 0 && /C0LOG0001/.test(p3.store.VERA_SETTINGS_COPY));
}

console.log('\none-time markers');
{
  const p = fakeProps({ TP_MIGRATED: '2026-01-01 copied 3' });
  const c = ctx(p, {});
  check('a marker still in its old property counts as done (no migration runs twice)', c.veraOnceGet_('TP_MIGRATED') === '2026-01-01 copied 3');
  check('an unset marker reads null', c.veraOnceGet_('CU_CONFIG_SEEDED') === null);
  c.veraOnceSet_('CU_CONFIG_SEEDED', '2026-11-12T00:00:00Z');
  check('setting one writes the bundle', JSON.parse(p.store.VERA_ONCE_MARKERS || '{}').CU_CONFIG_SEEDED === '2026-11-12T00:00:00Z' && c.veraOnceGet_('CU_CONFIG_SEEDED') === '2026-11-12T00:00:00Z');
  check('…and writes no property of its own', !('CU_CONFIG_SEEDED' in p.store));
  c.veraOnceSet_('TP_MIGRATED', '2026-01-01 copied 3');
  check('re-setting one that had an old property drops that property', !('TP_MIGRATED' in p.store) && c.veraOnceGet_('TP_MIGRATED') === '2026-01-01 copied 3');
  check('a damaged bundle reads as empty and falls back to the old property', ctx(fakeProps({ VERA_ONCE_MARKERS: '{bad', PL_OCCASION_MOVED: 'x' }), {}).veraOnceGet_('PL_OCCASION_MOVED') === 'x');
  const SRC = ['CareerCredentials.js', 'Career.js', 'ComingUp.js', 'FlightStatus.js', 'Life.js', 'VERALog.js', 'NetWorth.js', 'Places.js', 'TripEmails.js', 'TravelerProfiles.js', 'WishLists.js'].map(read).join('\n');
  const names = vm.runInContext('VERA_ONCE_MARKERS_', c);
  const consts = names.map(n => (SRC.match(new RegExp("var (\\w+)\\s*=\\s*'" + n + "';")) || [])[1]);
  check('every bundled marker is a constant in its file', consts.every(Boolean), J(names.filter((n, i) => !consts[i])));
  const direct = consts.filter(k => k && new RegExp('\\.(get|set)Property\\(' + k + '\\b').test(SRC));
  check('…and none is read or written as its own property any more', direct.length === 0, J(direct));
  check('…every one goes through veraOnceGet_ and veraOnceSet_', consts.every(k => new RegExp('veraOnceGet_\\(' + k + '\\)').test(SRC) && new RegExp('veraOnceSet_\\(' + k + ',').test(SRC)));
}

console.log('\nthe one-time move');
{
  const p = fakeProps({
    SAT_SHEET_ID: 'InventedSatSheet0123456789',          // Config row missing → appended
    TRANSACTIONS_SHEET_ID: 'InventedTxSheet01234567890',  // Config row blank → filled
    SLACK_LOGS_CHANNEL_ID: 'C0LOG0001',                   // Config already the same → property dropped
    VERA_DASHBOARD_URL: 'https://example.test/old/',       // Config differs → both kept
    ARIA_SHEET_ID: 'InventedAriaSheet012345678',           // roster_link_aria holds its link → same
    TP_MIGRATED: '2026-01-01 copied 3', LOG_SECRETS_SCRUBBED: '2026-02-02',
    CLAUDE_API_KEY: 'sk-invented', VERA_SHEET_ID: 'InventedVeraSheet01234567', SLACK_ALLOWED_USER_IDS: 'U0A,U0B',
  });
  const cfg = fakeConfig([
    ['transactions_sheet_id', ''],
    ['slack_logs_channel_id', 'C0LOG0001'],
    ['vera_dashboard_url', 'https://example.test/new/'],
    ['roster_link_aria', 'https://docs.google.com/spreadsheets/d/InventedAriaSheet012345678/edit'],
  ]);
  const read2 = () => { const o = {}; cfg.grid.slice(1).forEach(r => { o[r[0]] = String(r[1]); }); return o; };
  const c = ctx(p, read2, { getSpreadsheet: () => ({ getSheetByName: n => n === 'Config' ? cfg.sheet : null }) });
  const r = c.moveSettingsToConfig();
  const v = read2();
  check('a missing Config row is added with the value', v.sat_sheet_id === 'InventedSatSheet0123456789' && !('SAT_SHEET_ID' in p.store), J(r));
  check('a blank Config cell is filled, then the property deleted', v.transactions_sheet_id === 'InventedTxSheet01234567890' && !('TRANSACTIONS_SHEET_ID' in p.store));
  check('the same value already in Config: the property is just dropped', !('SLACK_LOGS_CHANNEL_ID' in p.store) && r.same.indexOf('SLACK_LOGS_CHANNEL_ID') !== -1);
  check('…a link and its bare id count as the same (ARIA → roster_link_aria)', !('ARIA_SHEET_ID' in p.store) && /\/d\/InventedAriaSheet/.test(v.roster_link_aria));
  check('a different value in Config is left alone, and so is the property', v.vera_dashboard_url === 'https://example.test/new/' && p.store.VERA_DASHBOARD_URL === 'https://example.test/old/' && r.kept.indexOf('VERA_DASHBOARD_URL') !== -1);
  check('markers move into the bundle and their old properties go', JSON.parse(p.store.VERA_ONCE_MARKERS || '{}').TP_MIGRATED === '2026-01-01 copied 3' && !('TP_MIGRATED' in p.store) && !('LOG_SECRETS_SCRUBBED' in p.store));
  check('secrets, VERA_SHEET_ID and the allowed-users list are never touched',
        p.store.CLAUDE_API_KEY === 'sk-invented' && p.store.VERA_SHEET_ID === 'InventedVeraSheet01234567' && p.store.SLACK_ALLOWED_USER_IDS === 'U0A,U0B'
        && !p.log.some(x => /CLAUDE_API_KEY|VERA_SHEET_ID|SLACK_ALLOWED_USER_IDS/.test(x[1])));
  check('settings set nowhere are reported by row name', r.missing.indexOf('life_plan_doc_id') !== -1);
  const said = c.__logs.join('\n');
  check('the log names settings and counts, never a value', /moved 2/.test(said) && /SAT_SHEET_ID/.test(said)
        && !/Invented|C0LOG|example\.test|sk-invented|U0A/.test(said), said);
  const again = c.moveSettingsToConfig();
  check('a second run moves nothing', again.moved.length === 0 && again.markers.length === 0 && v.sat_sheet_id === read2().sat_sheet_id);

  const p2 = fakeProps({ SAT_SHEET_ID: 'InventedSatSheet0123456789' });
  const cfg2 = fakeConfig([], { dropWrites: true });
  const c2 = ctx(p2, () => ({}), { getSpreadsheet: () => ({ getSheetByName: () => cfg2.sheet }) });
  const r2 = c2.moveSettingsToConfig();
  check('a value that doesn\'t read back keeps its property', p2.store.SAT_SHEET_ID === 'InventedSatSheet0123456789' && r2.kept.indexOf('SAT_SHEET_ID') !== -1);
}

console.log('\nplaceholders count as blank');
{
  const c = ctx(fakeProps(), {});
  check('PASTE_…, TODO and CHANGE_ME are placeholders, in any case; real values aren’t',
        ['PASTE_VICTORIA_USER_ID', ' paste_bot_token_here ', 'TODO', 'tbd', 'CHANGE_ME', 'changeme'].every(v => c.veraIsPlaceholder_(v))
        && !['U0INVENTED1', 'https://example.test/', '', 'todo list sheet', 'PASTEL'].some(v => c.veraIsPlaceholder_(v)));
  const p = fakeProps({ SLACK_VICTORIA_USER_ID: 'U0INVENTED2' });
  check('a placeholder in Config gives way to the real property', ctx(p, { slack_victoria_user_id: 'PASTE_VICTORIA_USER_ID' }).veraSetting_('SLACK_VICTORIA_USER_ID') === 'U0INVENTED2');
  check('a placeholder everywhere reads as blank, never as the placeholder', ctx(fakeProps({ SLACK_VICTORIA_USER_ID: 'PASTE_VICTORIA_USER_ID' }), { slack_victoria_user_id: 'PASTE_VICTORIA_USER_ID' }).veraSetting_('SLACK_VICTORIA_USER_ID') === '');
  const pc = fakeProps({});
  ctx(pc, { slack_victoria_user_id: 'PASTE_VICTORIA_USER_ID', slack_logs_channel_id: 'C0LOG0001' }).veraSettingsCopyRefresh_();
  check('…and the nightly copy never keeps one', !/PASTE_/.test(pc.store.VERA_SETTINGS_COPY) && /C0LOG0001/.test(pc.store.VERA_SETTINGS_COPY));

  const mp = fakeProps({ SLACK_VICTORIA_USER_ID: 'U0INVENTED2', SLACK_AHMED_USER_ID: 'PASTE_AHMED_USER_ID', VERA_DASHBOARD_URL: 'https://example.test/old/' });
  const cfg = fakeConfig([['slack_victoria_user_id', 'PASTE_VICTORIA_USER_ID'], ['slack_ahmed_user_id', ''], ['vera_dashboard_url', 'https://example.test/new/']]);
  const read3 = () => { const o = {}; cfg.grid.slice(1).forEach(r => { o[r[0]] = String(r[1]); }); return o; };
  const mc = ctx(mp, read3, { getSpreadsheet: () => ({ getSheetByName: n => n === 'Config' ? cfg.sheet : null }) });
  const r = mc.moveSettingsToConfig();
  check('the move writes the real value over a placeholder cell, reads it back, then drops the property',
        read3().slack_victoria_user_id === 'U0INVENTED2' && !('SLACK_VICTORIA_USER_ID' in mp.store) && r.moved.indexOf('SLACK_VICTORIA_USER_ID') !== -1, J(r));
  check('a placeholder property is never copied into Config, and is reported', read3().slack_ahmed_user_id === '' && r.placeholders.indexOf('slack_ahmed_user_id') !== -1);
  check('a real value that differs is still kept, as before', mp.store.VERA_DASHBOARD_URL === 'https://example.test/old/' && r.kept.indexOf('VERA_DASHBOARD_URL') !== -1);
  check('the log names the placeholders, never a value', /still a placeholder[^;]*slack_ahmed_user_id/.test(mc.__logs.join('\n')) && !/U0INVENTED|PASTE_|example\.test/.test(mc.__logs.join('\n')), mc.__logs.join('\n'));
}

console.log('\nthe call sites');
{
  const all = fs.readdirSync(ROOT).filter(f => f.endsWith('.js')).map(f => [f, read(f)]);
  const c = ctx(fakeProps(), {});
  const keys = vm.runInContext('VERA_SETTINGS_', c);
  const direct = [];
  all.forEach(([f, s]) => keys.forEach(k => { if (new RegExp("getProperty\\(\\s*'" + k + "'\\s*\\)").test(s.replace(/\s*\n\s*\./g, '.'))) direct.push(f + ':' + k); }));
  check('no setting is read straight from Script Properties', direct.length === 0, J(direct));
  const ab = read('AddressBook.js');
  check('the address book reads its sheet through veraSettingId_', /veraSettingId_\(ADDRESS_BOOK_PROP_\)/.test(ab));
  check('CONFIG.MORNING_NUDGE_EMAIL is read when used, from Config first', /get MORNING_NUDGE_EMAIL\(\) \{ return veraSetting_\('MORNING_NUDGE_EMAIL'\); \}/.test(read('Code.js')));
  check('the Life Plan doc id is no longer written in code', !/LIFE_PLAN_DOC_ID\s*=\s*'[A-Za-z0-9_-]{20,}'/.test(read('FinancialGoals.js')) && /veraSettingId_\('LIFE_PLAN_DOC_ID'\)/.test(read('FinancialGoals.js')));
  const ids = [];
  all.forEach(([f, s]) => { (s.match(/'[A-Za-z0-9_-]{40,46}'/g) || []).forEach(m => { if (/\d/.test(m) && /[A-Z]/.test(m) && /[a-z]/.test(m) && !/[_-]{2}|^'[A-Z_]+'$/.test(m)) ids.push(f + ':' + m.slice(0, 8) + '…'); }); });
  check('no Drive-id-shaped literal anywhere in the server code', ids.length === 0, J(ids));
  check('the nightly run refreshes the copy, right after properties are pruned',
        /nightlyStep_\(ctx, 'pruneScriptProperties_', pruneScriptProperties_\);\n(?:\s*\/\/[^\n]*\n)*\s*nightlyStep_\(ctx, 'veraSettingsCopyRefresh_', veraSettingsCopyRefresh_\);/.test(read('Code.js')));
}

console.log('\nsaving a setting from the dashboard');
{
  const p = fakeProps({ NEIGHBORHOOD_HOA_URL: 'https://old.example.test/' });
  const cfg = fakeConfig([['other', 'x']]);
  const c = ctx(p, {}, { getSpreadsheet: () => ({ getSheetByName: () => cfg.sheet }) });
  check('it is written to its Config row (added when missing)', c.veraSetSetting_('NEIGHBORHOOD_HOA_URL', ' https://hoa.example.test/ ') === true
        && cfg.grid.some(r => r[0] === 'neighborhood_hoa_url' && r[1] === 'https://hoa.example.test/'));
  check('…and the old property goes, so the two can\'t disagree', !('NEIGHBORHOOD_HOA_URL' in p.store));
  c.veraSetSetting_('NEIGHBORHOOD_HOA_URL', 'https://hoa2.example.test/');
  check('saving again updates the same row', cfg.grid.filter(r => r[0] === 'neighborhood_hoa_url').length === 1 && cfg.grid.some(r => r[1] === 'https://hoa2.example.test/'));
  const web = read('WebApp.js'), nw = read('NeighborhoodWatcher.js');
  check('the HOA page reads and saves it through the helper, and refuses a non-link',
        /var url = veraSetting_\(NEIGHBORHOOD_HOA_URL_KEY\);/.test(web) && /veraSetSetting_\(NEIGHBORHOOD_HOA_URL_KEY, url\)/.test(web) && /isn’t a web link/.test(web)
        && !/setProperty\(NEIGHBORHOOD_HOA_URL_KEY/.test(web));
  check('the HOA scan reads it from Config first', /var hoaUrl = veraSetting_\(NEIGHBORHOOD_HOA_URL_KEY\);/.test(nw));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
