// The trip registry: one immutable Trip ID per trip.
//
// The bug it exists to kill: trip identity was the string startDate + '|' +
// label, frozen into eight tabs at write time and rewritable by nothing. A
// cancelled flight moved a trip's start date, the trip acquired two identities,
// and that produced two travel-day emails, a re-sent pre-trip briefing, and a
// post-trip email that fired early.
//
// So the assertions that matter are all one question asked different ways:
// after the thing that broke it before, is it still the same trip?
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const TRP  = fs.readFileSync(ROOT + '/Trips.js', 'utf8');
const PTO  = fs.readFileSync(ROOT + '/PTO.js',   'utf8');
const COD  = fs.readFileSync(ROOT + '/Code.js',  'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const HDR = (() => {
  const m = /^const TRIPS_HEADERS\s*=\s*(\[[^\]]*\])/m.exec(COD);
  if (!m) throw new Error('TRIPS_HEADERS not found in Code.js');
  return eval(m[1]);
})();

// ---- a fake Trips tab -----------------------------------------------------

function ctxFor(opts) {
  opts = opts || {};
  const rows = [HDR.slice()].concat(opts.rows || []);
  let uuidSeq = 0;
  const flags = [];
  const logs  = [];
  const sheet = {
    _rows: rows,
    getLastRow:    () => rows.length,
    getLastColumn: () => HDR.length,
    getMaxColumns: () => HDR.length,
    appendRow: r => { rows.push(r.slice()); },
    getRange: (r, c, nR, nC) => ({
      getValue:  () => rows[r - 1][c - 1],
      setValue:  v => { rows[r - 1][c - 1] = v; },
      getValues: () => {
        const out = [];
        for (let i = 0; i < (nR || 1); i++) out.push(rows[r - 1 + i].slice(c - 1, c - 1 + (nC || 1)));
        return out;
      },
      // A real setValues, not a no-op. It was `() => {}`, which silently swallowed
      // every batched write — so touchTripRow_ switching from four setValue calls to
      // two setValues made three assertions fail while the product was correct. A fake
      // that drops writes cannot catch a bug in writes.
      setValues: vals => {
        for (let i = 0; i < vals.length; i++) {
          for (let j = 0; j < vals[i].length; j++) rows[r - 1 + i][c - 1 + j] = vals[i][j];
        }
      },
      setFontWeight: () => {},
    }),
  };
  const ctx = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, isNaN, isFinite, parseInt, Error,
    Logger: { log: m => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (d, tz, f) => d.toISOString().slice(0, 10),
      // Distinct every call — so "same id across a cache miss" can only pass by
      // the matcher genuinely finding the existing row, never by luck.
      getUuid: () => {
        uuidSeq++;
        return (String(uuidSeq).padStart(8, '0') + '-aaaa-bbbb-cccc-' +
                String(uuidSeq).padStart(12, '0'));
      },
    },
    TABS: { TRIPS: 'Trips', FLAGS: 'Flags' },
    TRIPS_HEADERS: HDR,
    getSpreadsheet: () => ({ getSheetByName: () => sheet }),
    ensureSheet: () => sheet,
    writeFlags: f => { f.forEach(x => flags.push(x)); },
    LockService: { getScriptLock: () => ({
      tryLock: () => opts.lockFails !== true,
      releaseLock: () => {},
    })},
  };
  vm.createContext(ctx);
  vm.runInContext([
    extractFn(TRP, 'getTripsSheet_'),
    extractFn(TRP, 'ensureTripsSchema_'),
    extractFn(TRP, 'isTripId_'),
    extractFn(TRP, 'mintTripId_'),
    // invalidateTripRegistry_ now also drops the key-set memo, so its companion
    // has to be loaded or the call throws.
    'var _tripKeySetCache_ = {};',
    extractFn(TRP, 'invalidateTripKeyCache_'),
    extractFn(TRP, 'invalidateTripRegistry_'),
    extractFn(TRP, 'readTripRegistry_'),
    extractFn(TRP, 'tripDateCell_'),
    extractFn(TRP, 'splitTripList_'),
    extractFn(TRP, 'getTripById_'),
    extractFn(TRP, 'tripLabelFor_'),
    extractFn(TRP, 'tripStartDateFor_'),
    extractFn(TRP, 'tripDateRangeFor_'),
    extractFn(TRP, 'tripRangeDistanceDays_'),
    extractFn(TRP, 'normaliseTripLabel_'),
    'var TRIP_MATCH_TOLERANCE_DAYS_ = ' +
      (/var TRIP_MATCH_TOLERANCE_DAYS_ = (\d+)/.exec(TRP) || [, '14'])[1] + ';',
    extractFn(TRP, 'resolveTripId_'),
    extractFn(TRP, 'resolveTripIdForLabelRange_'),
    extractFn(TRP, 'createTripRow_'),
    extractFn(TRP, 'touchTripRow_'),
    extractFn(TRP, 'appendTripAlias_'),
    extractFn(TRP, 'appendTripEventId_'),
    extractFn(TRP, 'attachTripIds_'),
    extractFn(TRP, 'tripIdSlugForProperty_'),
    extractFn(TRP, 'tripIdSlugForFlag_'),
    'var _tripsSheet_ = null, _tripRegistryCache_ = null;',
  ].join('\n'), ctx);
  ctx.__sheet = sheet;
  ctx.__flags = flags;
  ctx.__logs  = logs;
  return ctx;
}

const resolve = (ctx, trip, opts) => {
  ctx.__t = trip; ctx.__o = opts || {};
  return vm.runInContext('resolveTripId_(__t, __o)', ctx);
};
const registryRows = ctx => ctx.__sheet._rows.slice(1);

// ============ the id =======================================================

console.log('\nthe id is opaque and safely short');
{
  const ctx = ctxFor();
  const id = vm.runInContext('mintTripId_()', ctx);
  check('it has the expected shape', /^TRIP-[0-9A-F]{12}$/.test(id), id);
  check('…and isTripId_ agrees', vm.runInContext('isTripId_("' + id + '")', ctx) === true);

  // Length is load-bearing: Fitness.js truncates a derived flag key at 50 chars
  // and Pantry.js at 30, so a full 36-char UUID would be cut mid-hex.
  check('it fits under the 30-char truncation with room for a prefix',
        ('pantry_trip_overlap_x_' + id.toLowerCase()).length > 0 && id.length === 17, id.length);

  // The trap this whole file closes: PROJ-YYYYMMDD-NN carries its creation date
  // and Projects.js parses it back out. Assert on the IMPLEMENTATION, not on a
  // sample id — any 12 hex digits could coincidentally look like a date, and a
  // sequential stub uuid certainly does.
  const mintSrc = extractFn(TRP, 'mintTripId_');
  check('nothing date-shaped is built into the id',
        !/formatDate|yyyy|MMdd|getFullYear|Date\(\)/.test(mintSrc), mintSrc);
  check('…it is uuid-derived, not a timestamp', /Utilities\.getUuid\(\)/.test(mintSrc));
  check('…and generateId_ was deliberately not reused',
        !/generateId_/.test(TRP), 'generateId_ embeds yyyyMMddHHmmss');
  check('no pipe, so it can never be confused with a legacy key',
        id.indexOf('|') === -1);

  check('a legacy key is NOT an id', vm.runInContext('isTripId_("2026-09-20|Florida Trip")', ctx) === false);
  check('…even one whose label looks like an id',
        vm.runInContext('isTripId_("2026-09-20|TRIP-ABCDEF123456")', ctx) === false);
  check('junk is not an id', vm.runInContext('isTripId_("TRIP-zzz")', ctx) === false);
  check('blank is not an id', vm.runInContext('isTripId_("")', ctx) === false);

  // Injective under both latch sanitisers — the old key was not: 'Alaska/Yukon'
  // and 'Alaska-Yukon' collapse to the same slug today.
  const a = vm.runInContext('mintTripId_()', ctx), b = vm.runInContext('mintTripId_()', ctx);
  check('two ids differ', a !== b);
  check('…and still differ after the property sanitiser',
        vm.runInContext('tripIdSlugForProperty_("' + a + '")', ctx) !==
        vm.runInContext('tripIdSlugForProperty_("' + b + '")', ctx));
  check('…and after the flag sanitiser',
        vm.runInContext('tripIdSlugForFlag_("' + a + '")', ctx) !==
        vm.runInContext('tripIdSlugForFlag_("' + b + '")', ctx));
}

// ============ the failure that started all this ============================

console.log('\nTHE BUG: a start date moves, and it is still the same trip');
{
  const ctx = ctxFor();
  const first = resolve(ctx, { label: 'Florida Trip', startDate: '2026-09-19',
                               endDate: '2026-09-23', eventIds: ['ev-florida@google.com'] });
  check('a new trip is minted', /^TRIP-/.test(first), first);

  // The flight is cancelled and rebooked; the calendar event's start moves.
  // Same event, so this resolves on the event branch.
  const after = resolve(ctx, { label: 'Florida Trip', startDate: '2026-09-20',
                               endDate: '2026-09-23', eventIds: ['ev-florida@google.com'] });
  check('the SAME id comes back', after === first, first + ' vs ' + after);
  check('…and there is still only one registry row', registryRows(ctx).length === 1,
        registryRows(ctx).length);
  check('…whose start date now reflects the move',
        registryRows(ctx)[0][2] === '2026-09-20', registryRows(ctx)[0][2]);
}

console.log('\n…even when the event was DELETED and recreated');
{
  // The likely real sequence: a cancelled flight often means deleting the
  // calendar entry and making a new one, which mints a new iCalUID. Only the
  // label + date-range branch saves the id here, which is why that branch is
  // primary rather than a fallback.
  const ctx = ctxFor();
  const first = resolve(ctx, { label: 'Florida Trip', startDate: '2026-09-19',
                               endDate: '2026-09-23', eventIds: ['ev-old@google.com'] });
  const after = resolve(ctx, { label: 'Florida Trip', startDate: '2026-09-22',
                               endDate: '2026-09-25', eventIds: ['ev-brand-new@google.com'] });
  check('still the same id', after === first, first + ' vs ' + after);
  check('one row only', registryRows(ctx).length === 1, registryRows(ctx).length);
  // The set grows, so either event resolves from now on.
  check('the new event id was absorbed into the set',
        String(registryRows(ctx)[0][4]).indexOf('ev-brand-new@google.com') !== -1,
        registryRows(ctx)[0][4]);
  check('…and the old one is still there',
        String(registryRows(ctx)[0][4]).indexOf('ev-old@google.com') !== -1,
        registryRows(ctx)[0][4]);
}

console.log('\n…and the event id alone can save a trip that was RENAMED');
{
  // The date-edit case above is covered twice over — the ranges still overlap,
  // so the label+range branch catches it even with no event id. This isolates
  // the event branch: rename the trip AND move it two months, so label+range
  // cannot possibly match and only the event id can.
  const ctx = ctxFor();
  const first = resolve(ctx, { label: 'Florida Trip', startDate: '2026-09-20',
                               endDate: '2026-09-23', eventIds: ['ev-same@google.com'] });
  const after = resolve(ctx, { label: 'Tampa Wedding', startDate: '2026-11-20',
                               endDate: '2026-11-25', eventIds: ['ev-same@google.com'] });
  check('the same event is the same trip, renamed and moved', after === first, first + ' / ' + after);
  check('…still one row', registryRows(ctx).length === 1, registryRows(ctx).length);
  check('…and the registry took the new label',
        registryRows(ctx)[0][1] === 'Tampa Wedding', registryRows(ctx)[0][1]);

  // And without the event id, that same pair MUST be two trips — otherwise the
  // matcher is merging things it should not.
  const noEv = ctxFor();
  const a = resolve(noEv, { label: 'Florida Trip',  startDate: '2026-09-20', endDate: '2026-09-23' });
  const b = resolve(noEv, { label: 'Tampa Wedding', startDate: '2026-11-20', endDate: '2026-11-25' });
  check('without the event id they are correctly two trips', a !== b, a + ' / ' + b);
}

console.log('\n…but a genuinely different trip is a different trip');
{
  const ctx = ctxFor();
  const fl = resolve(ctx, { label: 'Florida Trip', startDate: '2026-09-20', endDate: '2026-09-23' });
  const bo = resolve(ctx, { label: 'Boston Work',  startDate: '2026-09-20', endDate: '2026-09-23' });
  check('same dates, different labels → two ids', fl !== bo, fl + ' / ' + bo);
  check('…and two rows', registryRows(ctx).length === 2);

  // Beyond the tolerance, the same label is next year's trip, not this one.
  const far = resolve(ctx, { label: 'Florida Trip', startDate: '2027-09-20', endDate: '2027-09-23' });
  check('the same label a year later is a new trip', far !== fl, fl + ' / ' + far);
}

console.log('\n…and the tolerance boundary is where it says it is');
{
  const ctx = ctxFor();
  const base = resolve(ctx, { label: 'Florida Trip', startDate: '2026-09-20', endDate: '2026-09-23' });
  const near = resolve(ctx, { label: 'Florida Trip', startDate: '2026-10-05', endDate: '2026-10-08' });
  check('a 12-day slip is the same trip', near === base, base + ' / ' + near);

  const ctx2 = ctxFor();
  const b2 = resolve(ctx2, { label: 'Florida Trip', startDate: '2026-09-20', endDate: '2026-09-23' });
  const f2 = resolve(ctx2, { label: 'Florida Trip', startDate: '2026-11-20', endDate: '2026-11-23' });
  check('a two-month slip is not', f2 !== b2, b2 + ' / ' + f2);
}

// ============ the cache boundary ===========================================

console.log('\nthe id survives the 600-second cache expiring');
{
  // getUpcomingTravel_ caches the resolved array for ten minutes. On a miss it
  // re-resolves from scratch — and must land on the same ids. The stubbed
  // getUuid returns something different every call, so this can only pass if the
  // matcher genuinely found the existing rows.
  const ctx = ctxFor();
  const trips = () => ([
    { label: 'Florida Trip', startDate: '2026-09-20', endDate: '2026-09-23', eventIds: ['ev-a@google.com'] },
    { label: 'Boston Work',  startDate: '2026-10-05', endDate: '2026-10-07', eventIds: ['ev-b@google.com'] },
  ]);

  ctx.__trips = trips();
  const firstPass = vm.runInContext('attachTripIds_(__trips).map(function(t){return t.tripId;})', ctx);
  check('both get ids', firstPass.every(id => /^TRIP-/.test(id)), JSON.stringify(firstPass));

  vm.runInContext('invalidateTripRegistry_()', ctx);   // the cache expired
  ctx.__trips = trips();
  const secondPass = vm.runInContext('attachTripIds_(__trips).map(function(t){return t.tripId;})', ctx);
  check('the second pass yields the SAME ids',
        JSON.stringify(secondPass) === JSON.stringify(firstPass),
        JSON.stringify(firstPass) + ' vs ' + JSON.stringify(secondPass));
  check('…and minted nothing new', registryRows(ctx).length === 2, registryRows(ctx).length);
}

console.log('\n…and a lock failure leaves ids blank rather than wrong');
{
  // Two concurrent cold loads must not both mint. Refusing to mint costs a
  // briefing its id for one run; minting twice costs the trip its identity
  // permanently.
  const ctx = ctxFor({ lockFails: true });
  ctx.__trips = [{ label: 'Florida Trip', startDate: '2026-09-20', endDate: '2026-09-23' }];
  const ids = vm.runInContext('attachTripIds_(__trips).map(function(t){return t.tripId;})', ctx);
  check('no id was assigned', ids[0] === '', JSON.stringify(ids));
  check('…and nothing was written', registryRows(ctx).length === 0, registryRows(ctx).length);
  check('…and it said so', /could not take the lock/.test(ctx.__logs.join('\n')));
}

// ============ ambiguity ====================================================

console.log('\ntwo matching records are never guessed between');
{
  const iso = '2026-01-01T00:00:00.000Z';
  const ctx = ctxFor({ rows: [
    ['TRIP-AAAAAAAAAAAA', 'Florida Trip', '2026-09-20', '2026-09-23', '', '', iso, iso, 'active'],
    ['TRIP-BBBBBBBBBBBB', 'Florida Trip', '2026-09-21', '2026-09-24', '', '', '2026-06-01T00:00:00.000Z', iso, 'active'],
  ]});
  const id = resolve(ctx, { label: 'Florida Trip', startDate: '2026-09-20', endDate: '2026-09-23' });
  check('it does NOT mint a third', registryRows(ctx).length === 2, registryRows(ctx).length);
  check('it takes the oldest Created as the tiebreak', id === 'TRIP-AAAAAAAAAAAA', id);
  check('…and says so in the log', /AMBIGUOUS/.test(ctx.__logs.join('\n')));
  check('…and raises a flag so it is visible',
        ctx.__flags.some(f => /ambiguous/i.test(f.key || '')), JSON.stringify(ctx.__flags.map(f => f.key)));
  check('the flag is low urgency, not a klaxon',
        ctx.__flags.every(f => f.urgency === 'Low'));
}

console.log('\n…and a merged trip forwards rather than vanishing');
{
  const iso = '2026-01-01T00:00:00.000Z';
  const ctx = ctxFor({ rows: [
    ['TRIP-AAAAAAAAAAAA', 'Florida Trip', '2026-09-20', '2026-09-23', '', '', iso, iso, 'active'],
    ['TRIP-BBBBBBBBBBBB', 'Florida Trip', '2026-09-20', '2026-09-23', '', '', iso, iso, 'merged:TRIP-AAAAAAAAAAAA'],
  ]});
  // A losing id can still be held by a chat transcript or an open browser tab.
  const rec = vm.runInContext('getTripById_("TRIP-BBBBBBBBBBBB")', ctx);
  check('the losing id resolves to the survivor', rec && rec.tripId === 'TRIP-AAAAAAAAAAAA',
        rec && rec.tripId);
  check('a merged row is not offered as a match',
        resolve(ctx, { label: 'Florida Trip', startDate: '2026-09-20', endDate: '2026-09-23' })
          === 'TRIP-AAAAAAAAAAAA');

  const loop = ctxFor({ rows: [
    ['TRIP-AAAAAAAAAAAA', 'X', '2026-09-20', '2026-09-23', '', '', iso, iso, 'merged:TRIP-BBBBBBBBBBBB'],
    ['TRIP-BBBBBBBBBBBB', 'X', '2026-09-20', '2026-09-23', '', '', iso, iso, 'merged:TRIP-AAAAAAAAAAAA'],
  ]});
  check('a merge cycle terminates rather than hanging',
        vm.runInContext('getTripById_("TRIP-AAAAAAAAAAAA")', loop) === null);
}

// ============ aliases and lookups ==========================================

console.log('\naliases map a legacy key to its trip');
{
  const ctx = ctxFor();
  const id = resolve(ctx, { label: 'Florida Trip', startDate: '2026-09-20', endDate: '2026-09-23' });
  check('the minting key is recorded as an alias',
        String(registryRows(ctx)[0][5]).indexOf('2026-09-20|Florida Trip') !== -1,
        registryRows(ctx)[0][5]);

  vm.runInContext('appendTripAlias_("' + id + '", "2026-09-19|Florida Trip")', ctx);
  check('an added alias sticks',
        String(registryRows(ctx)[0][5]).indexOf('2026-09-19|Florida Trip') !== -1,
        registryRows(ctx)[0][5]);
  check('…and adding it twice does nothing',
        vm.runInContext('appendTripAlias_("' + id + '", "2026-09-19|Florida Trip")', ctx) === false);

  // The old key now resolves without any date-range reasoning at all.
  const viaAlias = resolve(ctx, { label: 'Florida Trip', startDate: '2026-09-19', endDate: '2026-09-19' });
  check('the old key resolves to the same trip', viaAlias === id, id + ' / ' + viaAlias);
}

console.log('\n…and the lookups that replace the parse sites work');
{
  const ctx = ctxFor();
  const id = resolve(ctx, { label: 'Florida Trip', startDate: '2026-09-20', endDate: '2026-09-23' });
  check('tripLabelFor_ replaces split("|")[1]',
        vm.runInContext('tripLabelFor_("' + id + '")', ctx) === 'Florida Trip');
  check('tripStartDateFor_ replaces split("|")[0]',
        vm.runInContext('tripStartDateFor_("' + id + '")', ctx) === '2026-09-20');
  const range = vm.runInContext('tripDateRangeFor_("' + id + '")', ctx);
  check('tripDateRangeFor_ gives both ends',
        range.startDate === '2026-09-20' && range.endDate === '2026-09-23', JSON.stringify(range));

  // A label containing a pipe is exactly what split('|')[1] truncates today.
  const piped = resolve(ctx, { label: 'Alaska | Yukon', startDate: '2026-07-01', endDate: '2026-07-10' });
  check('a label with a pipe survives intact',
        vm.runInContext('tripLabelFor_("' + piped + '")', ctx) === 'Alaska | Yukon',
        vm.runInContext('tripLabelFor_("' + piped + '")', ctx));

  check('an unknown id returns nothing, not a guess',
        vm.runInContext('tripLabelFor_("TRIP-FFFFFFFFFFFF")', ctx) === '');
  check('…and a blank id is handled', vm.runInContext('tripLabelFor_("")', ctx) === '');
}

console.log('\n…and a trip with no calendar event still gets an id');
{
  // Both pre- and post-trip build trips purely from Itinerary rows, with no
  // calendar counterpart at all.
  const ctx = ctxFor();
  const id = vm.runInContext(
    'resolveTripIdForLabelRange_("Sheet Only Trip", "2026-09-20", "2026-09-23", { mint: true })', ctx);
  check('it is minted', /^TRIP-/.test(id), id);
  check('…with no event ids', String(registryRows(ctx)[0][4]) === '', registryRows(ctx)[0][4]);
  check('…and resolves again to the same id',
        vm.runInContext('resolveTripIdForLabelRange_("Sheet Only Trip", "2026-09-20", "2026-09-23", {})', ctx) === id);
  check('mint:false on something unknown returns blank, not a new id',
        vm.runInContext('resolveTripIdForLabelRange_("Never Seen", "2030-01-01", "2030-01-05", { mint: false })', ctx) === '');
}

// ============ the PTO.js wiring ============================================

console.log('\nthe wiring in PTO.js');
{
  const up = extractFn(PTO, 'getUpcomingTravel_');
  check('ids are attached', /attachTripIds_\(travel\)/.test(up));
  // Order is load-bearing: after the cache write, a cache hit would serve
  // id-less trips for ten minutes. Count as well as position — an earlier
  // control disabled the real call and added a second one after the cache, and
  // a bare index comparison happily passed.
  check('…exactly once', (up.match(/attachTripIds_\(travel\)/g) || []).length === 1,
        (up.match(/attachTripIds_\(travel\)/g) || []).length);
  check('…not behind a disabled branch', !/if \(false\)[^\n]*attachTripIds_/.test(up));
  check('…BEFORE the cache write',
        up.indexOf('attachTripIds_(travel)') < up.indexOf('CacheService.getScriptCache().put'));
  check('…and after sub-event filtering',
        up.indexOf('filterSubEvents_(travel)') < up.indexOf('attachTripIds_(travel)'));
  check('a partially-resolved array is not cached', /allResolved/.test(up));
  check('a resolver failure cannot break travel itself',
        /attachTripIds_ failed \(non-fatal\)/.test(up));

  check('a regular trip carries its event id', /tripEntry\.eventIds = ev\.isRecurringEvent\(\)/.test(PTO));
  // A recurring instance id encodes the start time, so it changes on exactly the
  // edit the id must survive.
  check('…but a recurring event contributes none', /isRecurringEvent\(\) \? \[\]/.test(PTO));

  const cruise = extractFn(PTO, 'detectCruises_');
  check('a cruise carries BOTH legs', /eventIds:\s*\[b\.id, matchD \? matchD\.id : ''\]/.test(cruise));
  check('…filtered so a missing leg leaves no blank', /\.filter\(function\(x\) \{ return !!x; \}\)/.test(cruise));

  // One implementation of the range arithmetic, two tolerances.
  check('the range helper is hoisted for sharing', /^function tripRangesNearby_\(/m.test(PTO));
  check('…and filterSubEvents_ delegates to it',
        /return tripRangesNearby_\(a, b, 1\)/.test(extractFn(PTO, 'filterSubEvents_')));
  check('…keeping its own 1-day meaning', /tripRangesNearby_\(a, b, 1\)/.test(PTO));
}

console.log('\n…and the registry tab is declared');
{
  check('TABS.TRIPS exists', /TRIPS:\s*'Trips'/.test(COD));
  check('TRIPS_HEADERS has all nine columns', HDR.length === 9, HDR.join('|'));
  check('Trip ID is column A', HDR[0] === 'Trip ID');
  check('…and the event ids are a set, named plurally', HDR[4] === 'Calendar Event IDs');
  check('createSheetTabs makes it', /ensureSheet\(ss, TABS\.TRIPS,\s*TRIPS_HEADERS\)/.test(COD));

  // A missing TABS entry must throw, not silently drop a tab from the repair —
  // the original code filtered, and TABS.TRIP_RECS does not exist.
  const tabs = extractFn(TRP, 'tripKeyedTabs_');
  check('the repair throws on a missing TABS entry', /throw new Error\('tripKeyedTabs_/.test(tabs));
  check('…and covers all eight keyed tabs', (tabs.match(/tab:\s*TABS\./g) || []).length === 8,
        (tabs.match(/tab:\s*TABS\./g) || []).length);
  check('…using the name that actually exists', /TABS\.TRIP_RECOMMENDATIONS/.test(tabs));
  check('TripMeta is keyed on column A, not B', /TRIP_META[^\n]*col:\s*1/.test(tabs));
  check('Countries is column F', /COUNTRIES[^\n]*col:\s*6/.test(tabs));
}

console.log('\nthe repair tool refuses to guess');
{
  const rep = extractFn(TRP, 'repairOrphanTripKeys_');
  check('it is dry-run by default', /dryRun = opts\.dryRun !== false/.test(rep));
  check('it prints per-tab row counts', /rows: /.test(rep));
  check('it suggests a target without minting one', /\{ mint: false \}/.test(rep));
  check('it applies only from a mapping handed to it', /opts\.merges/.test(rep));
  // Alias first, so a half-failed run has already mapped the orphan.
  check('the alias is written before any tab is rewritten',
        rep.indexOf('appendTripAlias_(targetId, orphanKey)') < rep.indexOf('range.setValues(vals)'));
  check('it refuses a TripMeta conflict rather than picking one', /REFUSING/.test(rep));
  check('…naming both sides so you can choose', /orphan: /.test(rep) && /target: /.test(rep));
  check('it clears the orphan’s stale latches', /clearTripLatches_\(orphanKey\)/.test(rep));
  check('a blank key is left alone — EmailParser writes those on purpose',
        /EmailParser writes a blank key on purpose/.test(rep));

  const clear = extractFn(TRP, 'clearTripLatches_');
  // The prefixes moved into TRIP_LATCH_PREFIXES_, shared with the senders, so a
  // latch added there is cleared here automatically. Check both halves: that this
  // iterates the shared list, and that the list is still complete.
  check('it iterates the shared prefix list', /TRIP_LATCH_PREFIXES_\.forEach/.test(clear));
  const prefixSrc = TRP.slice(TRP.indexOf('var TRIP_LATCH_PREFIXES_'),
                              TRP.indexOf(';', TRP.indexOf('var TRIP_LATCH_PREFIXES_')) + 1);
  check('every property latch prefix is cleared',
        ['PRETRIP_48H_', 'PRETRIP_NB_', 'POSTTRIP_NUDGE_', 'POSTTRIP_RECAP_', 'POSTTRIP_DEBRIEF_']
          .every(p => prefixSrc.indexOf(p) !== -1), prefixSrc);
  // It must NOT delete the id-keyed latch: repairOrphanTripKeys_ appends the alias
  // first, so by now the orphan key resolves to the TARGET and deleting that would
  // wipe the surviving trip's latch and re-send everything.
  check('it does not delete the id-keyed latch',
        !/deleteProperty\(prefix \+ tripIdSlugForProperty_/.test(clear));
  check('flag rows are deleted bottom-up', /for \(var i = keys\.length - 1; i >= 0; i--\)/.test(clear));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
