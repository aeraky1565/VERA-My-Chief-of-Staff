// System › Checks › Trip IDs: fixing the keys that name no trip, and repairing Trip details.
// Pins:
//  - trip_orphans groups the orphan keys with per-tab counts, biggest first, and suggests the
//    one trip the live matcher finds (minting nothing); a key the registry knows is not listed;
//  - trip_orphan_fix register: one 'past' registry row with the key as its alias, its end the
//    latest Itinerary date, and the rows get their Trip IDs at once; a second tap makes no
//    second trip;
//  - trip_orphan_fix merge: rows re-keyed to the target and their IDs filled; a Trip details
//    conflict comes back as the reason, with nothing changed; an unknown target is refused;
//  - trip_meta_repair: the dry run changes nothing and says what it would do; the repair
//    fixes the header row, moves values back and fills the IDs;
//  - every write is owner only, and the routes are wired.
// Whole Trips.js and TripIds.js run against an in-memory sheet. Invented trips and keys.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(fs.existsSync(path.join(ROOT, f)) ? ROOT : REPO, f), 'utf8');
const TRIPS = read('Trips.js'), TID = read('TripIds.js'), CODE = read('Code.js'), WEB = read('WebApp.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

const H = {};
['TRIPS_HEADERS', 'ITINERARY_HEADERS', 'TRIP_META_HEADERS', 'PACKING_ITEM_HEADERS', 'TRIP_BUDGET_HEADERS', 'TRIP_GIFT_HEADERS',
 'TRIP_OUTFIT_HEADERS', 'PACKING_REVIEW_HEADERS', 'LEAVE_RUN_HEADERS', 'TRIP_RECS_HEADERS', 'TRIP_DECISION_HEADERS'].forEach(n => {
  const m = CODE.match(new RegExp('const ' + n + '\\s*=\\s*(\\[[^\\]]*\\]);'));
  if (!m) throw new Error('no ' + n);
  H[n] = JSON.parse(m[1].replace(/'/g, '"'));
});
const TABS = { TRIPS: 'Trips', ITINERARY: 'Itinerary', TRIP_META: 'TripMeta', PACKING_ITEMS: 'PackingItems', COUNTRIES: 'Countries',
  TRIP_BUDGET: 'Trip Budget', TRIP_GIFTS: 'Trip Gifts', TRIP_OUTFITS: 'Trip Outfits', PACKING_REVIEWS: 'Packing Reviews',
  LEAVE_RUNS: 'Leaving Home Runs', TRIP_RECOMMENDATIONS: 'TripRecommendations', TRIP_DECISIONS: 'Trip Decisions', FLAGS: 'Flags' };

// An in-memory sheet: all[0] is the header row.
function sheet(name, all) {
  const cell = (r, c) => { const row = all[r - 1] || []; return row[c - 1] === undefined ? '' : row[c - 1]; };
  const put = (r, c, v) => { while (all.length < r) all.push([]); const row = all[r - 1]; while (row.length < c - 1) row.push(''); row[c - 1] = v; };
  const width = () => all.reduce((m, r) => Math.max(m, r.length), 0);
  return {
    _all: all, getName: () => name,
    getLastRow: () => { for (let i = all.length; i > 0; i--) if ((all[i - 1] || []).some(v => String(v) !== '')) return i; return 0; },
    getLastColumn: () => width(), getMaxColumns: () => Math.max(width(), 26), insertColumnsAfter: () => {},
    appendRow: row => { all.push(row.slice()); },
    getDataRange: () => ({ getValues: () => all.map(r => r.slice()) }),
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: () => { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(cell(r + i, c + j)); o.push(row); } return o; },
        getValue: () => cell(r, c),
        setValue: v => put(r, c, v),
        setValues: v => v.forEach((row, i) => row.forEach((x, j) => put(r + i, c + j, x))),
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if ((all[r - 1 + i] || [])[c - 1 + j] !== undefined) all[r - 1 + i][c - 1 + j] = ''; },
        setFontWeight: () => {}, setNumberFormat: () => {},
      };
    },
  };
}
const pad = (row, w) => { const o = row.slice(); while (o.length < w) o.push(''); return o; };

// The world: one live trip (Lisbon & Porto, Mar 2027) and one older trip (Oslo, Jan 2026).
// Orphans: "2026-03-17|Harbor Week" (never registered) and "2027-03-05|Lisbon trip" (a
// hand-typed key for the Lisbon trip, within the matcher's reach).
const LIS = 'TRIP-1A2B3C4D5E6F', OSLO = 'TRIP-0A0B0C0D0E0F';
const HARBOR = '2026-03-17|Harbor Week', STRAY = '2027-03-05|Lisbon & Porto';
function world(opts) {
  opts = opts || {};
  const IH = H.ITINERARY_HEADERS, MH = H.TRIP_META_HEADERS, PH = H.PACKING_ITEM_HEADERS, RH = H.TRIP_RECS_HEADERS;
  const tabs = {
    Trips: [H.TRIPS_HEADERS.slice(),
      [LIS, 'Lisbon & Porto', '2027-03-06', '2027-03-12', '', '2027-03-06|Lisbon & Porto', '2026-01-01', '2026-01-01', 'active', ''],
      [OSLO, 'Oslo', '2026-01-10', '2026-01-14', '', '2026-01-10|Oslo', '2026-01-01', '2026-01-01', 'active', '']],
    Itinerary: [IH.slice(),
      pad(['IT-1', HARBOR, 'Hotel', 'Check in', '2026-03-17'], IH.length),
      pad(['IT-2', HARBOR, 'Dinner', 'Dinner', '2026-03-21'], IH.length),
      pad(['IT-3', HARBOR, 'Walk', 'Walk', '2026-03-19'], IH.length),
      pad(['IT-4', '2027-03-06|Lisbon & Porto', 'Flight', 'Out', '2027-03-06'], IH.length)],
    TripMeta: [opts.metaHeader || MH.slice(),
      pad([HARBOR, opts.harborContext || '', ''], MH.length),
      pad(['2027-03-06|Lisbon & Porto', opts.lisContext || '', ''], MH.length),
      pad([STRAY, opts.strayContext || '', ''], MH.length)],
    PackingItems: [PH.slice()].concat([1, 2, 3, 4, 5].map(i => pad(['PK-' + i, HARBOR, 'A', 'Misc', 'Thing ' + i], PH.length)))
      .concat([pad(['PK-9', STRAY, 'A', 'Misc', 'Hat'], PH.length)]),
    TripRecommendations: [RH.slice(), pad(['RC-1', STRAY, '', 'Food', 'Cafe'], RH.length)],
  };
  if (opts.meta) tabs.TripMeta = opts.meta;
  const sheets = {};
  Object.keys(tabs).forEach(k => { sheets[k] = sheet(k, tabs[k]); });
  const store = {}, logs = [];
  const c = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, isFinite, isNaN, Error, parseInt, parseFloat,
    Logger: { log: m => logs.push(String(m)) }, Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: d => new Date(d).toISOString().slice(0, 10), getUuid: (() => { let n = 0; return () => 'abcdef' + String(++n).padStart(6, '0') + '-0000-0000-0000-000000000000'; })() },
    LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    TABS, getSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = sheet(n, [])) }),
    ensureSheet: (ss, n, hdr) => sheets[n] || (sheets[n] = sheet(n, [hdr.slice()])),
    veraStoreGet_: k => store[k] || '', veraStoreSet_: (k, v) => { store[k] = v; }, veraNotes_: () => ({ getProperty: () => null, deleteProperty: () => {}, getProperties: () => ({}), getKeys: () => [] }),
    _veraLockDepth_: 0, _veraWho_: { owner: opts.owner !== false },
    _sheets: sheets, _logs: logs,
  };
  Object.assign(c, H);
  vm.createContext(c);
  vm.runInContext(TRIPS + '\n' + TID, c);
  // Settings.js and People.js, the two helpers the routes lean on
  const SET = read('Settings.js'), PPL = read('People.js');
  const fn = (src, name) => { const a = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', a); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); };
  vm.runInContext(fn(SET, 'veraLocked_') + '\n' + fn(PPL, 'peopleOwnerOnly_'), c);
  return c;
}
const col = (c, tab, name) => { const s = c._sheets[tab]._all, i = s[0].indexOf(name); return s.slice(1).map(r => r[i]); };
const regRows = c => c._sheets.Trips._all.slice(1);

// ---- the list --------------------------------------------------------------------
console.log('\ntrip_orphans');
{
  const c = world();
  const r = c.webTripOrphans_();
  check('it answers ok', r.ok === true, J(r).slice(0, 200));
  const keys = r.orphans.map(o => o.key);
  check('both orphan keys are listed, the known ones are not', J(keys.slice().sort()) === J([HARBOR, STRAY].sort()), J(keys));
  check('the biggest comes first', keys[0] === HARBOR, J(keys));
  const h = r.orphans.filter(o => o.key === HARBOR)[0];
  check('…with its rows counted per tab', h.tabs.Itinerary === 3 && h.tabs.PackingItems === 5 && h.tabs.TripMeta === 1 && h.total === 9, J(h));
  check('…and its date and name split out', h.startDate === '2026-03-17' && h.label === 'Harbor Week', J(h));
  check('a key nothing matches gets no suggestion', h.suggestion === null, J(h.suggestion));
  const s = r.orphans.filter(o => o.key === STRAY)[0];
  check('a key a day off the trip is suggested as that trip', s.suggestion && s.suggestion.tripId === LIS && s.suggestion.label === 'Lisbon & Porto', J(s.suggestion));
  check('the picker lists the registry, newest first', J(r.trips.map(t => t.tripId)) === J([LIS, OSLO]), J(r.trips));
  check('the owner can fix', r.canFix === true);
  check('listing minted nothing and wrote nothing', regRows(c).length === 2 && col(c, 'Itinerary', 'Trip ID').every(v => v === ''));
  check('…not even the suggested trip’s dates (the matcher is a pure lookup)', regRows(c)[0][2] === '2027-03-06' && regRows(c)[0][3] === '2027-03-12', J(regRows(c)[0]));
  const other = world({ owner: false }).webTripOrphans_();
  check('anyone else sees the list without the buttons', other.ok && other.orphans.length === 2 && other.canFix === false);
}

// ---- register ----------------------------------------------------------------------
console.log('\ntrip_orphan_fix: register');
{
  const c = world();
  const r = c.webTripOrphanFix_({ key: HARBOR, how: 'register' });
  check('it answers ok, done: register', r.ok === true && r.done === 'register', J(r));
  const rows = regRows(c);
  check('one registry row was added', rows.length === 3, rows.length);
  const n = rows[2] || [];
  check('…named and dated from the key', n[1] === 'Harbor Week' && n[2] === '2026-03-17', J(n));
  check('…ending on its latest Itinerary date', n[3] === '2026-03-21', J(n));
  check('…with the key as its alias', n[5] === HARBOR, J(n));
  check('…marked past', n[8] === 'past', J(n));
  check('the response names the new trip', r.tripId === n[0] && /^TRIP-[0-9A-F]{12}$/.test(r.tripId), r.tripId);
  const itIds = col(c, 'Itinerary', 'Trip ID'), keysIt = col(c, 'Itinerary', 'Trip Key');
  check('its Itinerary rows got the ID at once', keysIt.every((k, i) => k !== HARBOR || itIds[i] === r.tripId), J(itIds));
  check('…and its Packing rows', col(c, 'PackingItems', 'Trip ID').slice(0, 5).every(v => v === r.tripId));
  check('the filled count comes back', r.filled >= 9, r.filled);
  const again = c.webTripOrphanFix_({ key: HARBOR, how: 'register' });
  check('a second tap makes no second trip', again.ok && again.done === 'already' && regRows(c).length === 3, J(again));
  check('it is no longer listed', !c.webTripOrphans_().orphans.some(o => o.key === HARBOR));
  const bad = c.webTripOrphanFix_({ key: 'Just a label', how: 'register' });
  check('a key with no date can’t be registered', bad.ok === false || bad.done === 'already', J(bad));
}

// ---- merge -------------------------------------------------------------------------
console.log('\ntrip_orphan_fix: merge');
{
  const c = world();
  const r = c.webTripOrphanFix_({ key: STRAY, how: 'merge', tripId: LIS.toLowerCase() });
  check('it answers ok, done: merge', r.ok === true && r.done === 'merge' && r.tripId === LIS, J(r));
  check('its rows were re-keyed to the trip', col(c, 'PackingItems', 'Trip Key')[5] === '2027-03-06|Lisbon & Porto' && col(c, 'TripRecommendations', 'Trip Key')[0] === '2027-03-06|Lisbon & Porto',
    J(col(c, 'PackingItems', 'Trip Key')));
  check('…and carry its ID', col(c, 'PackingItems', 'Trip ID')[5] === LIS && col(c, 'TripRecommendations', 'Trip ID')[0] === LIS);
  check('the key became an alias', String(regRows(c)[0][5]).indexOf(STRAY) !== -1, regRows(c)[0][5]);
  check('no trip was minted', regRows(c).length === 2);

  const k = world({ lisContext: 'Family trip', strayContext: 'Work trip' });
  const before = J(k._sheets.PackingItems._all);
  const no = k.webTripOrphanFix_({ key: STRAY, how: 'merge', tripId: LIS });
  check('a Trip details conflict comes back as the reason', no.ok === false && /different Context/.test(no.error), J(no));
  check('…and nothing was re-keyed', J(k._sheets.PackingItems._all) === before);

  const u = world().webTripOrphanFix_({ key: STRAY, how: 'merge', tripId: 'TRIP-FFFFFFFFFFFF' });
  check('an unknown trip is refused', u.ok === false && /isn’t a trip VERA knows/.test(u.error), J(u));
  const blank = world().webTripOrphanFix_({ key: STRAY, how: 'merge' });
  check('merge without a trip asks for one', blank.ok === false && /Pick the trip/.test(blank.error), J(blank));
  const what = world().webTripOrphanFix_({ key: STRAY, how: 'delete' });
  check('anything but merge or register is refused', what.ok === false, J(what));
}

// ---- Trip details repair -----------------------------------------------------------------
console.log('\ntrip_meta_repair');
{
  // The drifted header row: 'Trip Travellers' where Trip ID belongs, labels past column 12,
  // and a traveller count written into column 12.
  const MH = H.TRIP_META_HEADERS;
  const drift = ['Trip Key', 'Context', 'Notes', 'Updated Date', 'Traveler', '', '', '', '', '', 'Trip Budget', 'Trip Travellers', 'Trip Budget', 'Trip Travellers'];
  const meta = () => [drift.slice(), pad(['2027-03-06|Lisbon & Porto', 'Family', '', '', '', '', '', '', '', '', '', 3], 12), pad(['2026-01-10|Oslo', '', '', '', '', '', '', '', '', '', 900], 12)];
  const c = world({ meta: meta() });
  const check0 = c.webTripIdCheck_();
  check('the check reports Trip details skipped', check0.tabs.some(t => t.tab === 'TripMeta' && t.skipped), J(check0.tabs.filter(t => t.tab === 'TripMeta')));
  const before = J(c._sheets.TripMeta._all);
  const dry = c.webTripMetaRepair_({ dryRun: 'yes' });
  check('the dry run says what it would do', dry.ok && dry.dryRun === true && dry.plan.ok && dry.plan.moved === 2 && dry.plan.cleared === 0 && dry.plan.extraCols === 2, J(dry));
  check('…and changes nothing', J(c._sheets.TripMeta._all) === before);
  const go = c.webTripMetaRepair_({});
  check('the repair answers ok', go.ok && go.dryRun === false && go.plan.ok && go.plan.moved === 2, J(go));
  const all = c._sheets.TripMeta._all;
  check('the header row is put back', J(all[0].slice(0, MH.length)) === J(MH) && all[0].slice(MH.length).every(v => v === ''), J(all[0]));
  check('the traveller count is back in its column', all[1][MH.indexOf('Trip Travellers')] === 3, J(all[1]));
  check('the budget is back in its column', all[2][MH.indexOf('Trip Budget')] === 900 && all[2][MH.indexOf('Characteristics')] === '', J(all[2]));
  check('the Trip IDs were filled', all[1][MH.length - 1] === LIS && all[2][MH.length - 1] === OSLO && go.filled >= 2, J(all.map(r => r[11])));
  check('the check no longer skips it', !c.webTripIdCheck_().tabs.some(t => t.tab === 'TripMeta' && t.skipped));

  const odd = meta(); odd[1][13] = 'something';
  const k = world({ meta: odd });
  const kb = J(k._sheets.TripMeta._all);
  const no = k.webTripMetaRepair_({ dryRun: 'yes' });
  check('data past column 12 is a reason not to repair', no.ok && no.plan.ok === false && /past Trip ID/.test(no.plan.why), J(no));
  const noGo = k.webTripMetaRepair_({});
  check('…and the repair itself changes nothing then', noGo.plan.ok === false && J(k._sheets.TripMeta._all) === kb, J(noGo));
}

// ---- owner only, and the routes -------------------------------------------------------
console.log('\nowner only, and wired');
{
  const c = world({ owner: false });
  const regBefore = regRows(c).length, pk = J(c._sheets.PackingItems._all), tm = J(c._sheets.TripMeta._all);
  const a = c.webTripOrphanFix_({ key: HARBOR, how: 'register' });
  const b = c.webTripOrphanFix_({ key: STRAY, how: 'merge', tripId: LIS });
  const m = c.webTripMetaRepair_({});
  const d = c.webTripMetaRepair_({ dryRun: 'yes' });
  check('register is owner only', a.ok === false && /owner/.test(a.error), J(a));
  check('merge is owner only', b.ok === false && /owner/.test(b.error), J(b));
  check('the repair is owner only', m.ok === false && d.ok === false, J([m, d]));
  check('…and nothing was written', regRows(c).length === regBefore && J(c._sheets.PackingItems._all) === pk && J(c._sheets.TripMeta._all) === tm);
  check('GET trip_orphans is wired', /case 'trip_orphans':\s*return jsonOut_\(webTripOrphans_\(\)\)/.test(WEB));
  check('POST trip_orphan_fix is wired', /case 'trip_orphan_fix':\s*return jsonOut_\(webTripOrphanFix_\(body\)\)/.test(WEB));
  check('POST trip_meta_repair is wired', /case 'trip_meta_repair':\s*return jsonOut_\(webTripMetaRepair_\(body\)\)/.test(WEB));
  check('the fix reads "how", not the route’s "action"', /p\.how/.test(TID) && !/String\(p\.action/.test(TID));
  check('both writes run under the lock', /function webTripOrphanFix_[\s\S]*?veraLocked_\(/.test(TID) && /function webTripMetaRepair_[\s\S]*?veraLocked_\(/.test(TID));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
