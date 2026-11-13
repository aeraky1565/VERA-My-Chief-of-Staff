// Script Properties, batch 2: feature state in one property per feature, caches and
// histories in the hidden VERA State tab. Pins:
//  - veraStateGet_: the bundle first, a value it lacks from its old property (nothing
//    resets at release);
//  - veraStateSet_: merges, '' or null clears, reads the bundle back and only then drops
//    the feature's old properties; a name outside the bundle throws;
//  - the two capacity bundles are independent (an override survives a nightly guess);
//  - veraStoreGet_/veraStoreSet_: one tab read per run, a row updated in place, the tab
//    created hidden, the old property as fallback when the tab can't be written;
//  - moveSettingsToConfig moves both, logs names only, and a second run moves nothing;
//  - the call sites go through the helpers.
// Invented values.
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
function fakeSS(opts) {
  const o = opts || {}, tabs = {}, stats = { reads: 0, created: [], hidden: [] };
  const mk = (name, grid) => {
    const sh = { name, grid, hidden: false,
      getLastRow: () => grid.length, getMaxRows: () => 1000,
      getRange: (r, c, nr, nc) => ({
        getValues: () => { stats.reads++; return grid.slice(r - 1, r - 1 + (nr || 1)).map(x => { const out = []; for (let i = 0; i < (nc || 1); i++) out.push(x[c - 1 + i] == null ? '' : x[c - 1 + i]); return out; }); },
        getValue: () => (grid[r - 1] || [])[c - 1],
        setValues: v => { if (o.dropWrites) return; v.forEach((row, i) => row.forEach((x, k) => { grid[r - 1 + i] = grid[r - 1 + i] || []; grid[r - 1 + i][c - 1 + k] = x; })); },
        setNumberFormat: () => {},
      }),
      appendRow: row => { if (o.throwOnWrite) throw new Error('quota'); if (o.dropWrites) return; grid.push(row.slice()); },
      hideSheet: () => { sh.hidden = true; stats.hidden.push(name); },
    };
    tabs[name] = sh; return sh;
  };
  Object.keys(o.tabs || {}).forEach(n => mk(n, o.tabs[n].map(r => r.slice())));
  return { tabs, stats, ss: {
    getSheetByName: n => { if (o.throwOnRead) throw new Error('sheet down'); return tabs[n] || null; },
    insertSheet: n => { stats.created.push(n); return mk(n, []); },
  } };
}
function ctx(p, s, extra) {
  const logs = [];
  const c = Object.assign({ String, Object, JSON, Array, Date, Math, RegExp, Error,
    PropertiesService: { getScriptProperties: () => p.api },
    getConfigValues: () => ({ other: 'x' }),
    getSpreadsheet: () => s.ss,
    ensureSheet: (ss, name, headers) => { const sh = ss.getSheetByName(name) || ss.insertSheet(name); if (sh.getLastRow() === 0) sh.grid.push(headers.slice()); return sh; },
    Logger: { log: x => logs.push(String(x)) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { flush: () => {} },
    TABS: { CONFIG: 'Config', VERA_STATE: 'VERA State' },
    _configCache_: null,
  }, extra || {});
  c.__logs = logs;
  vm.createContext(c);
  vm.runInContext(SET, c);
  return c;
}

console.log('\nfeature state');
{
  const p = fakeProps({ VACATION_MODE_ACTIVE: 'true', VACATION_TRIP_NAME: 'Island Trip', CLAUDE_API_KEY: 'sk-x' });
  const c = ctx(p, fakeSS());
  const st = c.veraStateGet_('PACING');
  check('before any write, old properties still read (nothing resets at release)', st.VACATION_MODE_ACTIVE === 'true' && st.VACATION_TRIP_NAME === 'Island Trip', J(st));
  c.veraStateSet_('PACING', { VACATION_MODE_ENDS: '2026-12-01' });
  const b = JSON.parse(p.store.VERA_STATE_PACING || '{}');
  check('a write keeps what was there, adds the change, in one property', b.VACATION_MODE_ACTIVE === 'true' && b.VACATION_TRIP_NAME === 'Island Trip' && b.VACATION_MODE_ENDS === '2026-12-01', J(b));
  check('…and the old properties are gone', !('VACATION_MODE_ACTIVE' in p.store) && !('VACATION_TRIP_NAME' in p.store));
  check('…and nothing else is touched', p.store.CLAUDE_API_KEY === 'sk-x');
  c.veraStateSet_('PACING', { VACATION_TRIP_NAME: null, VACATION_MODE_ENDS: '' });
  const b2 = JSON.parse(p.store.VERA_STATE_PACING || '{}');
  check('null or "" clears a value', !('VACATION_TRIP_NAME' in b2) && !('VACATION_MODE_ENDS' in b2) && b2.VACATION_MODE_ACTIVE === 'true', J(b2));
  c.veraStateSet_('PACING', { VACATION_MODE_ACTIVE: null });
  check('a bundle left empty is removed, not kept as {}', !('VERA_STATE_PACING' in p.store));
  let threw = ''; try { c.veraStateSet_('PACING', { SLACK_BOT_TOKEN: 'x' }); } catch (e) { threw = e.message; }
  check('a name outside the bundle throws (no stray properties)', /not in PACING/.test(threw) && !('SLACK_BOT_TOKEN' in p.store));
  const a = c.veraStateProps_('MAIL');
  a.setProperties({ MAIL_COUNTER_PIECES: 3, MAIL_COUNTER_PACKAGES: '1' });
  a.setProperty('MAIL_COUNTER_LAST_RESET', '2026-11-12T00:00:00Z');
  check('the adapter keeps the Script Properties calls, values as strings', a.getProperty('MAIL_COUNTER_PIECES') === '3' && a.getProperty('MAIL_COUNTER_LAST_RESET') === '2026-11-12T00:00:00Z' && a.getProperty('MAIL_COUNTER_LAST_SCAN') === null);
  a.deleteProperty('MAIL_COUNTER_PACKAGES');
  check('…deleteProperty clears one value', a.getProperty('MAIL_COUNTER_PACKAGES') === null && JSON.parse(p.store.VERA_STATE_MAIL || '{}').MAIL_COUNTER_PIECES === '3');

  const p2 = fakeProps({});
  const c2 = ctx(p2, fakeSS());
  c2.veraStateProps_('CAPACITY_OVERRIDE').setProperties({ capacity_override_mode: 'busy', capacity_override_date: '2026-11-13' });
  c2.veraStateProps_('CAPACITY_INFERRED').setProperties({ capacity_inferred_mode: 'light', capacity_inferred_date: '2026-11-13' });
  check('your override and the nightly guess live apart, so neither undoes the other',
        JSON.parse(p2.store.VERA_STATE_CAPACITY_OVERRIDE || '{}').capacity_override_mode === 'busy' && JSON.parse(p2.store.VERA_STATE_CAPACITY_INFERRED || '{}').capacity_inferred_mode === 'light');

  const p3 = fakeProps({ VACATION_MODE_ACTIVE: 'true' });
  const lie = Object.assign({}, p3.api, { getProperty: k => (k === 'VERA_STATE_PACING' ? null : p3.api.getProperty(k)) });
  const c3 = ctx({ store: p3.store, api: lie }, fakeSS());
  c3.veraStateSet_('PACING', { VACATION_MODE_ENDS: '2026-12-01' });
  check('a bundle that doesn\'t read back keeps the old properties', p3.store.VACATION_MODE_ACTIVE === 'true');
}

console.log('\nthe VERA State tab');
{
  const p = fakeProps({ EXPLORER_HISTORY: '[{"date":"Nov 1","text":"old"}]' });
  const s = fakeSS();
  const c = ctx(p, s);
  check('before any write, a cache still reads from its old property', c.veraStoreGet_('EXPLORER_HISTORY') === '[{"date":"Nov 1","text":"old"}]');
  check('a write creates the tab, hidden, with its headers', c.veraStoreSet_('EXPLORER_HISTORY', '[1]') === true && s.stats.created.indexOf('VERA State') !== -1
        && s.tabs['VERA State'].hidden && J(s.tabs['VERA State'].grid[0]) === J(['Key', 'Value', 'Updated']));
  check('…the value is in its row, and the old property is gone', s.tabs['VERA State'].grid[1][0] === 'EXPLORER_HISTORY' && s.tabs['VERA State'].grid[1][1] === '[1]' && !('EXPLORER_HISTORY' in p.store));
  c.veraStoreSet_('EXPLORER_HISTORY', '[2]');
  check('a second write updates the same row', s.tabs['VERA State'].grid.length === 2 && s.tabs['VERA State'].grid[1][1] === '[2]');
  c.veraStoreSet_('FLIGHT_DAYS', '{"at":1}');
  check('another cache gets its own row', s.tabs['VERA State'].grid.length === 3 && c.veraStoreGet_('FLIGHT_DAYS') === '{"at":1}');
  const s2 = fakeSS({ tabs: { 'VERA State': [['Key', 'Value', 'Updated'], ['FLIGHT_DAYS', '{"at":2}', ''], ['WKND_PLAN_HISTORY', '[]', '']] } });
  const c2 = ctx(fakeProps(), s2);
  c2.veraStoreGet_('FLIGHT_DAYS'); c2.veraStoreGet_('WKND_PLAN_HISTORY'); c2.veraStoreGet_('FLIGHT_DAYS');
  check('the tab is read once per run, however many caches are read', s2.stats.reads === 1, s2.stats.reads);

  const p3 = fakeProps({});
  const c3 = ctx(p3, fakeSS({ throwOnWrite: true }));
  check('a tab that can\'t be written: the value stays a Script Property', c3.veraStoreSet_('FLIGHT_STATUS_CACHE', '{"a":1}') === false && p3.store.FLIGHT_STATUS_CACHE === '{"a":1}');
  check('…and reading it still works', c3.veraStoreGet_('FLIGHT_STATUS_CACHE') === '{"a":1}');
  const p4 = fakeProps({ FLIGHT_DAYS: '{"at":9}' });
  const c4 = ctx(p4, fakeSS({ throwOnRead: true }));
  check('a tab that can\'t be read: the old property answers', c4.veraStoreGet_('FLIGHT_DAYS') === '{"at":9}');
  const p5 = fakeProps({ WKND_PLAN_HISTORY: '[0]' });
  const c5 = ctx(p5, fakeSS({ dropWrites: true }));
  check('a write that doesn\'t read back keeps the property', c5.veraStoreSet_('WKND_PLAN_HISTORY', '[5]') === false && p5.store.WKND_PLAN_HISTORY === '[5]');
  const c6 = ctx(fakeProps(), fakeSS());
  check('a value over the cell limit is refused, and says why', c6.veraStoreSet_('FLIGHT_STATUS_CACHE', 'x'.repeat(45001)) === false && c6.__logs.some(l => /over the limit/.test(l)));
}

console.log('\nthe one-time move');
{
  const p = fakeProps({
    PACING_MODE_ACTIVE: 'true', PACING_MODE_ENDS: '2026-11-20', PTO_BUFFER_EVENT_ID: 'evt-invented',
    MAIL_COUNTER_PIECES: '4', capacity_override_mode: 'busy', capacity_inferred_mode: 'light',
    FLIGHT_STATUS_CACHE: '{"CAL-x":{"status":"scheduled"}}', WKND_PLAN_HISTORY: '[{"date":"Nov 8, 2026","activities":["Invented Park"]}]',
    CLAUDE_API_KEY: 'sk-invented', LAST_NIGHTLY_RUN: '2026-11-12', USPS_SCAN_START: '2026-11-12T06:00:00Z',
  });
  const s = fakeSS({ tabs: { Config: [['Key', 'Value']] } });
  const c = ctx(p, s);
  const r = c.moveSettingsToConfig();
  check('each feature\'s state is in its bundle', JSON.parse(p.store.VERA_STATE_PACING || '{}').PACING_MODE_ENDS === '2026-11-20' && JSON.parse(p.store.VERA_STATE_PTO_BUFFER || '{}').PTO_BUFFER_EVENT_ID === 'evt-invented'
        && JSON.parse(p.store.VERA_STATE_MAIL || '{}').MAIL_COUNTER_PIECES === '4' && JSON.parse(p.store.VERA_STATE_CAPACITY_OVERRIDE || '{}').capacity_override_mode === 'busy'
        && JSON.parse(p.store.VERA_STATE_CAPACITY_INFERRED || '{}').capacity_inferred_mode === 'light', J(r));
  check('…and the old ones are gone', ['PACING_MODE_ACTIVE', 'PACING_MODE_ENDS', 'PTO_BUFFER_EVENT_ID', 'MAIL_COUNTER_PIECES', 'capacity_override_mode', 'capacity_inferred_mode'].every(k => !(k in p.store)));
  check('the caches are rows in the VERA State tab, and their properties are gone',
        c.veraStoreGet_('FLIGHT_STATUS_CACHE') === '{"CAL-x":{"status":"scheduled"}}' && (s.tabs['VERA State'] || { grid: [] }).grid.some(row => row[0] === 'WKND_PLAN_HISTORY')
        && !('FLIGHT_STATUS_CACHE' in p.store) && !('WKND_PLAN_HISTORY' in p.store));
  check('run stamps, the watchdog\'s start stamp and secrets stay', p.store.LAST_NIGHTLY_RUN === '2026-11-12' && p.store.USPS_SCAN_START === '2026-11-12T06:00:00Z' && p.store.CLAUDE_API_KEY === 'sk-invented');
  const said = c.__logs.join('\n');
  check('the log names bundles and caches, never a value', /feature state bundled 5/.test(said) && /caches moved to the VERA State tab 2/.test(said)
        && !/Invented|evt-invented|scheduled|2026-11-20|sk-invented/.test(said), said);
  const again = c.moveSettingsToConfig();
  check('a second run moves nothing', again.state.length === 0 && again.stores.length === 0);
}

console.log('\nthe call sites');
{
  const src = f => read(f);
  const names = ['PACING_FIRST_DETECTED', 'PACING_MODE_ACTIVE', 'PACING_MODE_ENDS', 'PACING_OFFER_FLAG_KEY', 'VACATION_MODE_ACTIVE', 'VACATION_MODE_ENDS', 'VACATION_TRIP_NAME',
    'PTO_BUFFER_EVENT_ID', 'PTO_BUFFER_EVENT_DATE', 'PTO_BUFFER_DECLINED_UNTIL', 'MAIL_COUNTER_PIECES', 'MAIL_COUNTER_PACKAGES', 'MAIL_COUNTER_LAST_SCAN', 'MAIL_COUNTER_LAST_SCAN_RUN', 'MAIL_COUNTER_LAST_RESET',
    'capacity_override_mode', 'capacity_override_date', 'capacity_inferred_mode', 'capacity_inferred_date', 'FLIGHT_STATUS_CACHE', 'EXPLORER_HISTORY', 'WKND_PLAN_HISTORY'];
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && f !== 'Settings.js');
  const direct = [];
  files.forEach(f => { const s = src(f).replace(/\s*\n\s*\./g, '.'); if (/PropertiesService\.getScriptProperties\(\)\.(?:getProperty|setProperty|deleteProperty)\(\s*'(?:PACING_|VACATION_|PTO_BUFFER_|MAIL_COUNTER_|capacity_|FLIGHT_STATUS_CACHE|EXPLORER_HISTORY|WKND_PLAN_HISTORY)/.test(s)) direct.push(f); });
  check('nothing reads or writes them as their own Script Property any more', direct.length === 0, J(direct));
  const pac = src('Pacing.js');
  // Away mode (#246): isInVacationMode_ asks Away.js, which reads the same bundle.
  check('pacing and vacation mode read and write only their bundle', !/PropertiesService\.getScriptProperties\(\)/.test(pac) && (pac.match(/veraStateProps_\('PACING'\)/g) || []).length >= 4
        && !/PropertiesService\.getScriptProperties\(\)/.test(read('Away.js')) && /veraStateGet_\('PACING'\)/.test(read('Away.js')));
  check('the PTO buffer', /var bProps\s*=\s*veraStateProps_\('PTO_BUFFER'\);/.test(src('PTO.js')));
  const mc = src('MailCounter.js');
  check('the mail counter (scan, status, reset), while the watchdog\'s start stamp stays a property',
        /var mail\s*=\s*veraStateProps_\('MAIL'\);/.test(mc) && (mc.match(/veraStateProps_\('MAIL'\)/g) || []).length === 3
        && (mc.match(/PropertiesService\.getScriptProperties\(\)/g) || []).length === 1 && /props\.setProperty\('USPS_SCAN_START'/.test(mc)
        && !/props\.(?:get|set)Propert(?:y|ies)\(\s*\{?\s*'MAIL_COUNTER_LAST_SCAN'/.test(mc.split('function uspsCatchUpDue_')[0].replace(/\n\s*/g, ' ')));
  const code = src('Code.js');
  check('the nightly guess writes only the inferred bundle; chat and Slack write only the override',
        (code.match(/veraStateProps_\('CAPACITY_INFERRED'\)\.setProperties\(\{\n\s*capacity_inferred_mode/g) || []).length === 2
        && /veraStateProps_\('CAPACITY_OVERRIDE'\)\.setProperties\(\{\n\s*capacity_override_mode: capOverride/.test(src('Chat.js'))
        && (src('Slack.js').match(/veraStateProps_\('CAPACITY_OVERRIDE'\)\.setProperties\(\{\n\s*capacity_override_mode: '(?:busy|light)'/g) || []).length === 2);
  check('today\'s capacity reads both bundles', /var over\s*=\s*veraStateGet_\('CAPACITY_OVERRIDE'\), inf = veraStateGet_\('CAPACITY_INFERRED'\);/.test(code));
  const fl = src('FlightStatus.js');
  check('the flight caches go through the tab', /veraStoreGet_\('FLIGHT_STATUS_CACHE'\)/.test(fl) && /veraStoreSet_\('FLIGHT_STATUS_CACHE'/.test(fl)
        && /veraStoreGet_\(FLIGHT_DAYS_PROP_\)/.test(fl) && /veraStoreSet_\(FLIGHT_DAYS_PROP_/.test(fl) && !/props\.(?:get|set)Property\(FLIGHT_DAYS_PROP_/.test(fl));
  check('the two histories too', /veraStoreGet_\('EXPLORER_HISTORY'\)/.test(src('Reminders.js')) && /veraStoreSet_\('EXPLORER_HISTORY'/.test(src('Reminders.js'))
        && /veraStoreGet_\('WKND_PLAN_HISTORY'\)/.test(src('WeekendPlanner.js')) && /veraStoreSet_\('WKND_PLAN_HISTORY'/.test(src('WeekendPlanner.js')));
  check('the styling never moves (and so never shows) a hidden tab', /if \(sh\.isSheetHidden && sh\.isSheetHidden\(\)\) return;\n\s*ss\.setActiveSheet\(sh\);/.test(src('SheetStyle.js')));
  check('the tab is in TABS and styled with VERA\'s internal tabs', /VERA_STATE:\s*'VERA State'/.test(code) && /id: 'internal'[^\n]*'VERA State'/.test(src('SheetStyle.js')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
