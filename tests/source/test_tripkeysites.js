// A trip that was renamed or re-dated keeps every row written under its old key.
//
// Read sites used to compare a row's trip-key cell to the key exactly, so a
// trip renamed from "Maybe Lake Trip" (Oct 23) to "Lake Trip" (Oct 21) lost
// every packing item, decision, meta row and itinerary row written before the
// change. They now go through tripKeyMatches_, which matches every key the
// Trips registry says the trip has gone by. Writers use the current key.
//
// Invented trips throughout.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(ROOT + '/' + f, 'utf8');
const TRIPS = read('Trips.js'), WEB = read('WebApp.js'), TDB = read('TravelDayBriefing.js');
const PTB = read('PreTripBriefing.js'), TD = read('TripDecisions.js'), TS = read('TripShare.js');
const GI = read('GenerationInputs.js'), CHAT = read('Chat.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}

const NEW = '2026-10-21|Lake Trip', OLD = '2026-10-23|Maybe Lake Trip';
const OTHER = '2027-04-05|Lake Trip';   // a different trip with the same name
const REGISTRY = { [NEW]: [NEW, OLD, 'TRIP-LAKE1'], [OLD]: [NEW, OLD, 'TRIP-LAKE1'], [OTHER]: [OTHER, 'TRIP-LAKE2'] };
const CANON = { [OLD]: NEW };
const IDS = { [NEW]: 'TRIP-LAKE1', [OLD]: 'TRIP-LAKE1', [OTHER]: 'TRIP-LAKE2' };

// A context with the real helpers and a stub registry.
function base(extra) {
  const ctx = Object.assign({
    String, Number, Object, Array, Date, Math, JSON, RegExp, isFinite, isNaN, parseInt, Error,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: d => new Date(d).toISOString().slice(0, 10) },
    tripKeysFor_: k => REGISTRY[k] || [k],
    canonicalTripKey_: k => CANON[k] || k,
    tripIdForKey_: k => IDS[k] || '',
  }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(['tripRowMatches_', 'tripKeyMatches_', 'tripKeyRowIndex_', 'tripKeyForWrite_']
    .map(n => extractFn(TRIPS, n)).join('\n'), ctx);
  return ctx;
}
// A sheet stub: getRange(row, col, nRows, nCols).getValues() over `rows`, and
// setValue on a single cell, recorded.
function sheet(rows, writes) {
  return {
    getLastRow: () => rows.length + 1,
    getLastColumn: () => (rows[0] || []).length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 2, r - 2 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || x.length))),
      setValue: v => { writes.push([r, c, v]); },
      setValues: v => { writes.push([r, c, v]); },
      setNumberFormat: () => {},
    }),
    getDataRange: () => ({ getValues: () => [['h']].concat(rows) }),
  };
}

console.log('\nthe helpers');
{
  const c = base();
  const m = (a, b) => { c.__a = a; c.__b = b; return vm.runInContext('tripKeyMatches_(__a, __b)', c); };
  check('the same key matches', m(NEW, NEW) === true);
  check('an old key matches the trip it became', m(OLD, NEW) === true);
  check('…and the other way round', m(NEW, OLD) === true);
  check('a different trip with the same name does not', m(OTHER, NEW) === false);
  check('blank never matches', m('', NEW) === false && m(NEW, '') === false);
  c.__cells = [OLD, NEW, OTHER];
  check('a single-row tab prefers the exact key', vm.runInContext('tripKeyRowIndex_(__cells, "' + NEW + '")', c) === 1);
  c.__cells = [OTHER, OLD];
  check('…else the row under an old key', vm.runInContext('tripKeyRowIndex_(__cells, "' + NEW + '")', c) === 1);
  check('…and -1 when none', vm.runInContext('tripKeyRowIndex_(["x|y"], "' + NEW + '")', c) === -1);
  check('a new row is written under the current key',
        vm.runInContext('tripKeyForWrite_("' + OLD + '")', c) === NEW);
  check('an unknown key is written as given', vm.runInContext('tripKeyForWrite_("2026-01-01|Nope")', c) === '2026-01-01|Nope');

  const bare = vm.createContext({ String });
  vm.runInContext(['tripRowMatches_', 'tripKeyMatches_'].map(n => extractFn(TRIPS, n)).join('\n'), bare);
  check('with no registry it is the old exact comparison',
        vm.runInContext('tripKeyMatches_("' + OLD + '", "' + NEW + '") === false && tripKeyMatches_("' + NEW + '", "' + NEW + '")', bare));
}

console.log('\nrows written under the old key are found');
{
  // Packing status for the pre-trip briefing.
  const pack = [['P1', OLD, 'ahmed', 'clothes', 'Jacket', 'TRUE'], ['P2', NEW, 'ahmed', 'clothes', 'Shoes', 'FALSE'],
                ['P3', OTHER, 'ahmed', 'clothes', 'Hat', 'FALSE']];
  const c = base({ TABS: { PACKING_ITEMS: 'P' }, PACKING_ITEM_HEADERS: new Array(6).fill('x'),
                   getSpreadsheet: () => ({ getSheetByName: () => sheet(pack, []) }) });
  vm.runInContext(extractFn(PTB, 'getPackingStatusForBriefing_'), c);
  const st = vm.runInContext('getPackingStatusForBriefing_("' + NEW + '")', c);
  check('packing: old-key and current-key items both count', st.ahmed && st.ahmed.total === 2, JSON.stringify(st));

  // Decisions.
  const dec = [['D1', OLD, 'grp1', 'x', 'decided', 'I1', ''], ['D2', OTHER, 'grp2', 'x', 'decided', 'I3', '']];
  const d = base({ TABS: { TRIP_DECISIONS: 'D' }, TRIP_DECISION_HEADERS: new Array(7).fill('x'),
                   formatDateVal_: v => String(v || ''),
                   getSpreadsheet: () => ({ getSheetByName: () => sheet(dec, []) }) });
  vm.runInContext(extractFn(TD, 'loadTripDecisions_'), d);
  const dd = vm.runInContext('loadTripDecisions_("' + NEW + '")', d);
  check('decisions: one made before the rename still applies', !!dd.grp1, JSON.stringify(dd));
  check('…and the other Lake Trip\'s does not', !dd.grp2, JSON.stringify(dd));

  // Trip sharing.
  const itin = [['I1', OLD, 'arranged_stay', 'Stay', '2026-10-23', '', '', '', '', ''],
                ['I2', NEW, 'dining', 'Dinner', '2026-10-22', '19:00', '', '', '', ''],
                ['I3', OTHER, 'dining', 'Spring dinner', '2027-04-06', '19:00', '', '', '', '']];
  const sh = base({ TABS: { ITINERARY: 'I' }, ITINERARY_HEADERS: new Array(10).fill('x'),
                    getSpreadsheet: () => ({ getSheetByName: () => sheet(itin, []) }) });
  vm.runInContext(extractFn(TS, 'tripShareItems_'), sh);
  const items = vm.runInContext('tripShareItems_("' + NEW + '")', sh);
  check('sharing: both rows of the trip, not the other one',
        JSON.stringify(items.map(i => i.id)) === '["I1","I2"]', JSON.stringify(items.map(i => i.id)));

  // Generation inputs.
  const gi = [[OLD, 'packing', '2026-10-01', '{"tripKey":"' + OLD + '","factors":[]}']];
  const g = base({ GEN_INPUTS_TAB_: 'G', GEN_INPUTS_HEADERS_: new Array(4).fill('x'),
                   getSpreadsheet: () => ({ getSheetByName: () => sheet(gi, []) }) });
  vm.runInContext(extractFn(GI, 'readGenerationInputs_'), g);
  check('generation inputs: the record saved before the rename is read',
        !!vm.runInContext('readGenerationInputs_("' + NEW + '", "packing")', g));
}

console.log('\nan item entered under both the old and the new key shows once');
{
  const c = base();
  vm.runInContext(extractFn(WEB, 'dedupeStoredRowsAcrossKeys_'), c);
  const it = (id, key, title, date, start) => ({ id, tripKey: key, type: 'arranged_stay', title, date, startTime: start || '' });
  c.__i = [it('O', OLD, 'Staying with friends', '2026-10-23'), it('N', NEW, 'Staying with friends', '2026-10-23'),
           it('A', NEW, 'Coffee', '2026-10-24', '09:00'), it('B', NEW, 'Coffee', '2026-10-24', '09:00'),
           it('C', OLD, 'Coffee', '2026-10-25', '09:00'), it('D', NEW, 'Coffee', '2026-10-25', '10:00')];
  const ids = vm.runInContext('dedupeStoredRowsAcrossKeys_(__i, "' + NEW + '")', c).map(x => x.id);
  check('the stay under both keys is kept once, the current-key row', ids.indexOf('O') === -1 && ids.indexOf('N') !== -1,
        JSON.stringify(ids));
  check('two copies under the same key both stay', ids.indexOf('A') !== -1 && ids.indexOf('B') !== -1, JSON.stringify(ids));
  check('a different start time is a different item', ids.indexOf('C') !== -1 && ids.indexOf('D') !== -1, JSON.stringify(ids));
  check('the itinerary read uses it', /dedupeStoredRowsAcrossKeys_\(items, tripKey\)/.test(extractFn(WEB, 'webGetItinerary_')));
}

console.log('\nthe one TripMeta row moves to the current key instead of splitting');
{
  const meta = [[OLD, 'ctx', 'notes', '2026-10-01', 'Both', '', '', '', '', '', '']];
  const writes = [];
  const c = base({ TABS: { TRIP_META: 'M' }, TRIP_META_HEADERS: new Array(11).fill('x'),
                   getSpreadsheet: () => ({ getSheetByName: () => sheet(meta, writes) }) });
  vm.runInContext(extractFn(WEB, 'setTripBriefing_'), c);
  vm.runInContext('setTripBriefing_("' + NEW + '", "Why we go")', c);
  check('the old row is the one written', writes.some(w => w[0] === 2 && w[1] === 3 && w[2] === 'Why we go'),
        JSON.stringify(writes));
  check('…and its key cell becomes the current key', writes.some(w => w[0] === 2 && w[1] === 1 && w[2] === NEW),
        JSON.stringify(writes));
  check('…no second row is added', !writes.some(w => w[0] > 2), JSON.stringify(writes));
}

console.log('\nthe travel day email: one per trip per day, even renamed that morning');
{
  const props = {};
  const sends = [];
  // The trip is listed under both keys today (a row under each).
  const rows = [['A', OLD, 'dining', 'Lunch', '2026-10-24', '12:00', '', '', '', ''],
                ['B', NEW, 'dining', 'Dinner', '2026-10-24', '19:00', '', '', '', '']];
  const c = base({
    TABS: { ITINERARY: 'I' }, ITINERARY_HEADERS: new Array(10).fill('x'),
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null,
                                                       setProperty: (k, v) => { props[k] = v; } }) },
    getConfigValues: () => ({}), readPTOConfig_: () => ({}), veraLog_: () => {},
    getSpreadsheet: () => ({ getSheetByName: () => sheet(rows, []) }),
    getUpcomingTravel_: () => [],
    fetchTripDayItems_: () => [['x']],
    sendTravelDayBriefing_: k => { sends.push(k); },
  });
  // Without folding (travelTripKey_ sees no canonical mapping for this test)
  // the two keys reach the guard separately; the Trip ID must collapse them.
  c.canonicalTripKey_ = k => k;
  vm.runInContext(['travelRowDate_', 'travelTripKey_', 'travelDayRanges_', 'checkAndSendTravelDayBriefings_']
    .map(n => extractFn(TDB, n)).join('\n'), c);
  c.__o = { dateOverride: '2026-10-24' };
  vm.runInContext('checkAndSendTravelDayBriefings_(__o)', c);
  check('two names for one trip send one email', sends.length === 1, JSON.stringify(sends));
  check('…and the guard is the trip\'s ID', Object.keys(props).some(k => /^TDB_SENT_20261024_TRIP-LAKE1$/.test(k)),
        JSON.stringify(Object.keys(props)));
  sends.length = 0;
  vm.runInContext('checkAndSendTravelDayBriefings_(__o)', c);
  check('a second run that day sends none', sends.length === 0, JSON.stringify(sends));

  // A guard written under the old name-based form (before this change) still holds.
  const legacy = { 'TDB_SENT_20261024_LAKE_TRIP': 'x' };
  const c2 = base({
    TABS: { ITINERARY: 'I' }, ITINERARY_HEADERS: new Array(10).fill('x'),
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => legacy[k] || null, setProperty: () => {} }) },
    getConfigValues: () => ({}), readPTOConfig_: () => ({}), veraLog_: () => {},
    getSpreadsheet: () => ({ getSheetByName: () => sheet([rows[1]], []) }),
    getUpcomingTravel_: () => [], fetchTripDayItems_: () => [['x']],
    sendTravelDayBriefing_: k => { sends.push(k); },
  });
  vm.runInContext(['travelRowDate_', 'travelTripKey_', 'travelDayRanges_', 'checkAndSendTravelDayBriefings_']
    .map(n => extractFn(TDB, n)).join('\n'), c2);
  c2.__o = { dateOverride: '2026-10-24' };
  vm.runInContext('checkAndSendTravelDayBriefings_(__o)', c2);
  check('a guard written under the name before this change still holds', sends.length === 0, JSON.stringify(sends));
}

console.log('\nno read site compares the raw trip key any more');
{
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const hits = [];
  files.forEach(f => {
    read(f).split('\n').forEach((l, i) => {
      // A row/cell value against the trip key, the shape every converted site had.
      if (/^\s*(\*|\/\/)/.test(l)) return;   // comments describe the old form
      if (/String\([^)]*\)\.trim\(\) (?:!==|===) tripKey\b/.test(l) &&
          !/sheet\.getRange\(rowNum, 1\)\.setValue/.test(l)) hits.push(f + ':' + (i + 1));
    });
  });
  check('every trip-key read goes through tripKeyMatches_', hits.length === 0, hits.join(', '));
  ['webAddItineraryItem_', 'webSetTripMeta_', 'webGeneratePacking_', 'webGenerateRecommendations_',
   'webSaveBudgetItem_', 'webSetTripBudgetSettings_', 'webImportBudgetFromItinerary_', 'webCopyTripBudget_',
   'webAddTripGift_'].forEach(fn => {
    check(fn + ' writes under the current key', /tripKeyForWrite_\(/.test(extractFn(WEB, fn)));
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
