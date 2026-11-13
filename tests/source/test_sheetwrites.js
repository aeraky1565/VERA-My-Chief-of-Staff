// #242: sheet writes that two VERA runs could do at once. Pins:
//  - veraLocked_: takes the USER lock (never the script lock that ~15 modules hold
//    themselves), runs a nested call without re-locking, goes ahead (and says so)
//    when the lock stays busy, and always releases it;
//  - setConfigRow_: one Config writer, under the lock, update in place or append
//    [key, value, note], caches cleared; every Config writer goes through it;
//  - veraNextSeqId_: the highest number in use plus one, never a count, so a deleted
//    row or two writers at once can't repeat an ID; Habits and Memory mint with it,
//    under the lock;
//  - the SignalLearning counters are read, bumped and written under the lock.
// Invented keys and values.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const SET = read('Settings.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const fnSrc = (src, name) => { const a = src.indexOf('function ' + name + '('); if (a === -1) return ''; let d = 0, j = src.indexOf('{', a); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); };

function lockFake(opts) {
  const o = opts || {}, st = { user: 0, script: 0, held: false, released: 0, heldDuring: [] };
  const mk = kind => ({
    tryLock: () => { st[kind]++; if (o.busy) return false; st.held = true; return true; },
    waitLock: () => { st[kind]++; st.held = true; },
    releaseLock: () => { st.held = false; st.released++; },
  });
  return { st, api: { getUserLock: () => mk('user'), getScriptLock: () => mk('script') } };
}
function ctx(extra) {
  const logs = [];
  const c = Object.assign({ String, Array, Object, JSON, Math, Number, isNaN, parseInt, Date, Logger: { log: s => logs.push(String(s)) } }, extra || {});
  c.__logs = logs;
  vm.createContext(c);
  vm.runInContext(SET, c);
  return c;
}

console.log('\nveraLocked_');
{
  const L = lockFake();
  const c = ctx({ LockService: L.api });
  c.__probe = () => L.st.held;
  check('runs fn holding the USER lock, and returns its value', vm.runInContext('veraLocked_(function() { return __probe() ? 42 : 0; })', c) === 42 && L.st.user === 1 && L.st.script === 0);
  check('…and releases it after', L.st.held === false && L.st.released === 1);
  vm.runInContext('veraLocked_(function() { veraLocked_(function() {}); veraLocked_(function() {}); })', c);
  check('a nested call runs without taking the lock again', L.st.user === 2, L.st.user);
  let threw = false; try { vm.runInContext('veraLocked_(function() { throw new Error("boom"); })', c); } catch (e) { threw = true; }
  check('a throw still releases the lock (and is passed on)', threw && L.st.held === false && vm.runInContext('_veraLockDepth_', c) === 0);
  const B = lockFake({ busy: true });
  const cb = ctx({ LockService: B.api });
  check('a lock that stays busy: fn still runs, and the log says so', vm.runInContext('veraLocked_(function() { return "ran"; })', cb) === 'ran' && cb.__logs.some(l => /going ahead without it/.test(l)) && B.st.released === 0);
  const cn = ctx({});
  check('no LockService at all (a test harness): fn still runs', vm.runInContext('veraLocked_(function() { return 7; })', cn) === 7);
}

console.log('\nsetConfigRow_');
{
  const L = lockFake();
  const grid = [['Setting', 'Value'], ['pto_year', '2025'], ['other', 'x']];
  const heldAt = [];
  const sheet = {
    getLastRow: () => grid.length,
    getRange: (r, col, nr, nc) => ({
      getValues: () => grid.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(col - 1, col - 1 + (nc || 1))),
      setValue: v => { heldAt.push(L.st.held); grid[r - 1][col - 1] = v; },
    }),
    appendRow: row => { heldAt.push(L.st.held); grid.push(row.slice()); },
  };
  let ptoBust = 0;
  const c = ctx({ LockService: L.api, getSpreadsheet: () => ({ getSheetByName: () => sheet }), TABS: { CONFIG: 'Config' }, _configCache_: { stale: 1 }, invalidatePTOConfigRows_: () => { ptoBust++; } });
  c.setConfigRow_('pto_year', 2026);
  check('an existing key is updated in place', grid[1][1] === 2026 && grid.length === 3);
  c.setConfigRow_('shop_grocery_stores', '["A"]', 'Which stores count');
  check('a missing key is appended, with its note', J(grid[3]) === J(['shop_grocery_stores', '["A"]', 'Which stores count']));
  check('both writes happened holding the lock', heldAt.length === 2 && heldAt.every(Boolean), J(heldAt));
  check('the Config caches are cleared', vm.runInContext('_configCache_', c) === null && ptoBust === 2);
  check('a blank key writes nothing', c.setConfigRow_('  ', 1) === false && grid.length === 4);
  const src = f => read(f);
  const pto = src('PTO.js'), gr = src('Groceries.js'), web = src('WebApp.js'), set = src('Settings.js');
  check('the PTO writers go through it', /setConfigRow_\('pto_buffer_remaining'/.test(fnSrc(pto, 'setPTOBufferRemaining_')) && /setConfigRow_\('victoria_pto_buffer_remaining'/.test(fnSrc(pto, 'setVictoriaPTOBufferRemaining_'))
        && /setConfigRow_\(key, value\)/.test(fnSrc(pto, 'setPTOConfigValue_')));
  check('…and the grocery stores, the notification switches and channels, and dashboard settings',
        /setConfigRow_\(GR_STORES_KEY_/.test(fnSrc(gr, 'grWriteConfig_')) && /setConfigRow_\(configKey, value\)/.test(fnSrc(web, 'webSetNotifEnabled_'))
        && /setConfigRow_\(configKey, channel\)/.test(fnSrc(web, 'webSetNotifChannel_')) && /setConfigRow_\(row, v\)/.test(fnSrc(set, 'veraSetSetting_')));
  const raw = ['setPTOBufferRemaining_', 'setVictoriaPTOBufferRemaining_', 'setPTOConfigValue_'].map(n => fnSrc(pto, n)).concat([fnSrc(gr, 'grWriteConfig_'), fnSrc(web, 'webSetNotifEnabled_'), fnSrc(web, 'webSetNotifChannel_'), fnSrc(set, 'veraSetSetting_')]);
  check('none of them appends to Config itself any more', raw.every(s => !/appendRow|getLastRow\(\) \+ 1/.test(s)));
}

console.log('\nIDs');
{
  const c = ctx({});
  check('the next ID is the highest in use plus one', c.veraNextSeqId_('HAB-20261113-', [['HAB-20261113-01'], ['HAB-20261113-03']], 2) === 'HAB-20261113-04');
  check('…not a count, so a deleted row is never reused', c.veraNextSeqId_('HAB-20261113-', [['HAB-20261113-02']], 2) === 'HAB-20261113-03');
  check('other days and prefixes are ignored', c.veraNextSeqId_('MEM-20261113-', [['MEM-20261112-009'], ['HAB-20261113-05'], ['MEM-20261113-002']], 3) === 'MEM-20261113-003');
  check('first of the day', c.veraNextSeqId_('MEM-20261113-', [], 3) === 'MEM-20261113-001');

  const L = lockFake();
  const grid = [['ID'], ['HAB-20261113-02']];
  const heldAt = [];
  const sheet = { getLastRow: () => grid.length, getRange: (r, col, nr) => ({ getValues: () => grid.slice(r - 1, r - 1 + nr).map(x => [x[0]]) }), appendRow: row => { heldAt.push(L.st.held); grid.push(row); } };
  const h = ctx({ LockService: L.api, getSpreadsheet: () => ({ getSheetByName: () => sheet }), TABS: { HABITS: 'Habits' }, Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: () => '20261113' } });
  vm.runInContext(fnSrc(read('Habits.js'), 'addHabit_'), h);
  const r = vm.runInContext('addHabit_("Invented habit", "Daily")', h);
  check('a habit added after a delete gets a fresh ID, minted and appended under the lock', r.id === 'HAB-20261113-03' && heldAt.length === 1 && heldAt[0] === true, J(r));
  const mem = fnSrc(read('Memory.js'), 'appendMemoryEvent_');
  check('memory events mint the same way, under the lock', /veraLocked_\(function\(\) \{/.test(mem) && /veraNextSeqId_\('MEM-' \+ dateKey \+ '-', ids, 3\)/.test(mem) && !/seq\+\+/.test(mem));
}

console.log('\nSignalLearning');
{
  const sl = read('SignalLearning.js');
  check('a flag outcome is recorded under the lock', /function recordFlagOutcome_\(flagKey, outcome\) \{[\s\S]{0,200}return veraLocked_\(function\(\) \{ return slRecordFlagOutcome_\(flagKey, outcome\); \}\);/.test(sl));
  check('…and the nightly "seen" counts too', /function recordFlagsGenerated_\(flagKeys\) \{\s*return veraLocked_\(function\(\) \{ return slRecordFlagsGenerated_\(flagKeys\); \}\);/.test(sl));
  check('…both bodies still exist (the counters and the row creation run inside)', /function slRecordFlagOutcome_\(/.test(sl) && /function slRecordFlagsGenerated_\(/.test(sl));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
