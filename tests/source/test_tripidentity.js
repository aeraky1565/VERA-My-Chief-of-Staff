// Trip identity, phases 2-4: making the rest of the system use the event-ID anchor.
//
// The anchor itself already worked — resolveTripId_ checks reg.byEventId before
// label or dates, so a trip whose start date moves keeps its id. Nothing
// downstream asked it. Every consumer compared the frozen string
// startDate + '|' + label, which is written into eight tabs and never rewritten.
//
// So when a cancelled flight moved a start date, the trip owned TWO key strings:
//   - the post-trip email fired a day early, calling a multi-night trip 1 night,
//     because the newer key owned only the rows written after the change and its
//     "latest row date" was the departure day itself;
//   - two travel-day emails went out, one per key;
//   - every itinerary read returned half a trip.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = {
  Trips:      fs.readFileSync(ROOT + '/Trips.js', 'utf8'),
  PostTrip:   fs.readFileSync(ROOT + '/PostTripCapture.js', 'utf8'),
  PreTrip:    fs.readFileSync(ROOT + '/PreTripBriefing.js', 'utf8'),
  Chat:       fs.readFileSync(ROOT + '/Chat.js', 'utf8'),
  TravelDay:  fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8'),
  TestBench:  fs.readFileSync(ROOT + '/TestBench.js', 'utf8'),
};

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// The real functions, brace-matched out of the source. Never retyped.
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
function extractVar(src, name) {
  const m = new RegExp('^var ' + name + '\\s*=', 'm').exec(src);
  if (!m) throw new Error('not found: var ' + name);
  let depth = 0;
  for (let j = m.index; j < src.length; j++) {
    const c = src[j];
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return src.slice(m.index, j + 1);
  }
  throw new Error('unterminated: var ' + name);
}

const TRIPS_FNS = [
  'getTripsSheet_', 'isTripId_', 'invalidateTripKeyCache_', 'invalidateTripRegistry_',
  'readTripRegistry_', 'tripDateCell_', 'splitTripList_', 'getTripById_',
  'tripLabelFor_', 'tripStartDateFor_', 'tripDateRangeFor_', 'tripRangeDistanceDays_',
  'normaliseTripLabel_', 'resolveTripId_', 'touchTripRow_', 'appendTripAlias_',
  'tripIdForKey_', 'tripKeysFor_', 'canonicalTripKey_', 'tripRowMatches_',
  'tripIdSlugForProperty_', 'tripIdSlugForFlag_', 'tripLegacySlugForProperty_',
  'tripFlagKey_', 'tripLatchTarget_', 'tripLatchSeen_', 'tripLatchName_',
  'tripLatchValue_', 'tripLatchMark_', 'seedTripIdLatches_',
  'tripKeyedTabs_', 'scanTripKeyUsage_', 'adoptLegacyTripKeys_',
  'adoptLegacyTripKeysDryRun',
];
const TRIPS_VARS = ['_tripsSheet_', '_tripRegistryCache_', '_tripKeySetCache_',
                    'TRIP_MATCH_TOLERANCE_DAYS_', 'TRIP_LATCH_PREFIXES_'];

// ---------------------------------------------------------------------------
// A registry and an itinerary the tests control, wired to the REAL functions.
// ---------------------------------------------------------------------------
function ctxFor(opts) {
  opts = opts || {};
  const logs = [], props = Object.assign({}, opts.props || {});
  const registryRows = (opts.trips || []).map(t => [
    t.tripId, t.label, t.startDate, t.endDate,
    (t.eventIds || []).join(', '), (t.aliases || []).join(', '),
    t.created || '2026-01-01', t.lastSeen || '2026-01-01', t.status || 'active',
  ]);
  const itinRows = opts.itinerary || [];

  function sheetOf(rows, width) {
    return {
      getLastRow: () => rows.length + 1,
      // setValue matters: resolveTripId_ calls touchTripRow_ on every hit, and a
      // range without it throws — which the resolver's own catch swallows, so
      // every lookup silently returns '' and the tests fail for the wrong reason.
      getRange: (r, c, n, w) => ({
        getValues: () => rows.slice(r - 2, r - 2 + n)
          .map(row => { const o = row.slice(c - 1, c - 1 + (w || 1)); while (o.length < (w || 1)) o.push(''); return o; }),
        setValues: v => { v.forEach((row, i) => { rows[r - 2 + i] = row.slice(); }); },
        setValue: val => { if (!rows[r - 2]) rows[r - 2] = []; rows[r - 2][c - 1] = val; },
        setFontWeight: () => {},
      }),
      getMaxColumns: () => width,
      insertColumnsAfter: () => {},
      appendRow: row => rows.push(row.slice()),
    };
  }
  // tripKeyedTabs_ throws on a missing TABS entry — deliberately, so a repair
  // cannot silently skip a tab — so all eight have to be named here.
  const TABS = {
    TRIPS: 'Trips', ITINERARY: 'Itinerary', FLAGS: 'Flags', TRIP_META: 'TripMeta',
    PACKING_ITEMS: 'Packing Items', COUNTRIES: 'Countries', TRIP_BUDGET: 'Trip Budget',
    TRIP_GIFTS: 'Trip Gifts', TRIP_RECOMMENDATIONS: 'Trip Recommendations',
    TRIP_DECISIONS: 'Trip Decisions',
  };
  const sheets = {
    Trips:     opts.noRegistry ? null : sheetOf(registryRows, 9),
    Itinerary: sheetOf(itinRows, 10),
  };

  const ctx = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, Boolean,
    isFinite, isNaN, parseInt, parseFloat, Error, console,
    Logger: { log: m => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: {
      formatDate: (d, tz, f) => d.toISOString().slice(0, 10),
      getUuid: () => 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: k => { delete props[k]; },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    TABS,
    TRIPS_HEADERS: ['Trip ID', 'Label', 'Start Date', 'End Date', 'Calendar Event IDs',
                    'Aliases', 'Created', 'Last Seen', 'Status'],
    ITINERARY_HEADERS: new Array(10).fill('h'),
    getSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }),
    // getTripsSheet_ goes through ensureSheet + ensureTripsSchema_ and caches the
    // result, so both must return the sheet — a stub returning undefined leaves
    // _tripsSheet_ falsy and every registry read comes back empty.
    ensureSheet: (ss, name) => ss.getSheetByName(name),
    ensureTripsSchema_: sheet => sheet,
    addFlag_: () => {},
  };
  ctx.props = props;
  ctx.logs = logs;
  ctx.registryRows = registryRows;
  ctx.itinRows = itinRows;
  vm.createContext(ctx);

  // Loud on failure. A swallowed extraction error means every assertion below is
  // testing an empty context instead of the real code, and passes or fails for
  // reasons unrelated to the change.
  const load = (src, name, how) => {
    try { new vm.Script(how(src, name)).runInContext(ctx); }
    catch (e) { throw new Error('could not load ' + name + ': ' + e.message); }
  };
  TRIPS_VARS.forEach(n => load(SRC.Trips, n, extractVar));
  TRIPS_FNS.forEach(n => load(SRC.Trips, n, extractFn));
  ['tripDurationNights_', 'readTripRows_', 'getTripBoundsByKey_', 'getRecentlyCompletedTrips_']
    .forEach(n => load(SRC.PostTrip, n, extractFn));
  return ctx;
}

// The reported case: a Florida trip that departed 2026-09-19 and ran to the 26th,
// whose start date moved to the 20th after a cancelled flight. Rows written before
// the change carry the old key; rows written after carry the new one.
const OLD_KEY = '2026-09-19|Florida Trip';
const NEW_KEY = '2026-09-20|Florida Trip';
const row = (key, date) => ['id', key, 'flight', 'Flight', date, '09:00', '11:00', 'TPA', '', ''];
const SPLIT_ITINERARY = [
  row(OLD_KEY, '2026-09-19'), row(OLD_KEY, '2026-09-22'),
  row(OLD_KEY, '2026-09-24'), row(OLD_KEY, '2026-09-26'),   // the real last day
  row(NEW_KEY, '2026-09-20'),                                // the only post-change row
];
const FLORIDA = {
  tripId: 'TRIP-AAAABBBBCCCC', label: 'Florida Trip',
  startDate: '2026-09-20', endDate: '2026-09-26',
  eventIds: ['evt-florida'], aliases: [OLD_KEY],
};

console.log('The reported case: one trip, two keys');
{
  const c = ctxFor({ trips: [FLORIDA], itinerary: SPLIT_ITINERARY });

  const keys = c.tripKeysFor_(NEW_KEY);
  // Named, not counted: the set also carries the Trip ID so a row an earlier
  // repair run rewrote to a bare TRIP-… still matches.
  check('both keys resolve to one trip',
        keys.indexOf(NEW_KEY) !== -1 && keys.indexOf(OLD_KEY) !== -1, JSON.stringify(keys));
  check('…and the Trip ID is in the set too',
        keys.indexOf(FLORIDA.tripId) !== -1, JSON.stringify(keys));
  check('…so a row holding the bare id matches',
        c.tripRowMatches_(FLORIDA.tripId, keys) === true);
  check('…the canonical key first', keys[0] === NEW_KEY, JSON.stringify(keys));
  check('…and the old key is in the set', keys.indexOf(OLD_KEY) !== -1);
  check('the old key resolves to the same set',
        c.tripKeysFor_(OLD_KEY).indexOf(NEW_KEY) !== -1, JSON.stringify(c.tripKeysFor_(OLD_KEY)));
  check('canonicalTripKey_ maps the old key onto the new',
        c.canonicalTripKey_(OLD_KEY) === NEW_KEY, c.canonicalTripKey_(OLD_KEY));

  // The whole itinerary, not the sliver.
  check('readTripRows_ returns ALL rows for the trip',
        c.readTripRows_(NEW_KEY).length === 5, String(c.readTripRows_(NEW_KEY).length));
  check('…from either key', c.readTripRows_(OLD_KEY).length === 5);

  // The bug: end date and duration.
  const b = c.getTripBoundsByKey_(NEW_KEY);
  check('the end date is the real last day, not the departure day',
        b && b.endDate.toISOString().slice(0, 10) === '2026-09-26',
        b && b.endDate.toISOString().slice(0, 10));
  check('the duration is the real span, not 1 night',
        c.tripDurationNights_(b) === 6, String(c.tripDurationNights_(b)));
  check('…and the trip reports its canonical key', b && b.tripKey === NEW_KEY, b && b.tripKey);
}

console.log('\n…and post-trip no longer fires a day early');
{
  // 2026-09-27: one day after the REAL end (the 26th). With delayDays=1 the trip
  // is due. The sliver's own end was the 20th, which came due on the 21st —
  // five days early, which is the reported bug.
  function firesOn(todayISO, delayDays) {
    const c = ctxFor({ trips: [FLORIDA], itinerary: SPLIT_ITINERARY });
    c.Date = class extends Date {
      constructor(...a) { super(...(a.length ? a : [todayISO + 'T12:00:00Z'])); }
      static now() { return new Date(todayISO + 'T12:00:00Z').getTime(); }
    };
    vm.createContext(c);
    TRIPS_FNS.forEach(n => new vm.Script(extractFn(SRC.Trips, n)).runInContext(c));
    ['tripDurationNights_', 'readTripRows_', 'getRecentlyCompletedTrips_']
      .forEach(n => new vm.Script(extractFn(SRC.PostTrip, n)).runInContext(c));
    return c.getRecentlyCompletedTrips_(delayDays);
  }

  const early = firesOn('2026-09-21', 1);
  check('nothing fires on the 21st, while the trip is still running',
        early.length === 0, JSON.stringify(early.map(t => t.tripKey + '@' + t.endDate)));

  const due = firesOn('2026-09-27', 1);
  check('it fires on the 27th, one day after the real end', due.length === 1,
        JSON.stringify(due.map(t => t.tripKey)));
  check('…as ONE trip, not one per key', due.length === 1);
  check('…reporting the real duration',
        due.length === 1 && due[0].endDate.toISOString().slice(0, 10) === '2026-09-26',
        due.length ? due[0].endDate.toISOString().slice(0, 10) : 'none');
}

console.log('\nThe event ID outranks label and dates');
{
  // Rename AND move in one edit — the only case branch 3 cannot catch, because
  // neither the label nor the dates still match.
  const c = ctxFor({ trips: [FLORIDA] });
  const before = c.registryRows.length;
  const id = c.resolveTripId_({
    label: 'Gulf Coast Week', startDate: '2026-10-15', endDate: '2026-10-22',
    eventIds: ['evt-florida'],
  }, { mint: false });
  check('the same calendar event keeps the trip id', id === FLORIDA.tripId, id);
  check('…and mints nothing', c.registryRows.length === before);

  // Without the event id, that same edit is genuinely a different trip.
  const c2 = ctxFor({ trips: [FLORIDA] });
  const id2 = c2.resolveTripId_({
    label: 'Gulf Coast Week', startDate: '2026-10-15', endDate: '2026-10-22', eventIds: [],
  }, { mint: false });
  check('with no event id and nothing else matching, it resolves to nothing', !id2, id2);
}

console.log('\nA read never mints');
{
  const c = ctxFor({ trips: [FLORIDA] });
  const before = c.registryRows.length;
  for (let i = 0; i < 50; i++) {
    c.tripKeysFor_('2026-12-01|Some Trip That Does Not Exist ' + i);
    c.canonicalTripKey_('2026-12-01|Another Unknown ' + i);
    c.tripIdForKey_('2026-12-01|A Third ' + i);
  }
  check('100+ resolutions of unknown keys add no registry rows',
        c.registryRows.length === before, c.registryRows.length + ' vs ' + before);
  check('tripIdForKey_ passes mint:false', /mint:\s*false/.test(extractFn(SRC.Trips, 'tripIdForKey_')));
  check('…and does not append aliases on a read',
        !/appendAlias/.test(extractFn(SRC.Trips, 'tripIdForKey_').replace(/\/\/[^\n]*/g, '')));

  const unknown = c.tripKeysFor_('2026-12-25|Nowhere');
  check('an unresolvable key comes back as itself, not empty',
        unknown.length === 1 && unknown[0] === '2026-12-25|Nowhere', JSON.stringify(unknown));
  check('canonicalTripKey_ likewise returns its input',
        c.canonicalTripKey_('2026-12-25|Nowhere') === '2026-12-25|Nowhere');
}

console.log('\n…and a read does not rewrite the registry');
{
  // resolveTripId_ calls touchTripRow_, which WRITES the label and dates it was
  // handed onto the matched row. That is right when the fields came from the
  // calendar. It is destructive when they came from a legacy key, because a key's
  // date prefix is the trip's OLD start date — so one lookup reverts the registry
  // to whenever that key was minted, including the end date post-trip timing
  // reads. Worse than the bug this change set out to fix.
  const c = ctxFor({ trips: [FLORIDA], itinerary: SPLIT_ITINERARY });
  const before = JSON.stringify(c.registryRows);

  c.tripKeysFor_(OLD_KEY);
  c.tripKeysFor_(NEW_KEY);
  c.canonicalTripKey_(OLD_KEY);
  c.tripIdForKey_(OLD_KEY);
  c.getTripBoundsByKey_(NEW_KEY);
  c.readTripRows_(OLD_KEY);

  check('resolving the OLD key leaves the registry byte-identical',
        JSON.stringify(c.registryRows) === before,
        'was ' + before + '\n        now ' + JSON.stringify(c.registryRows));
  check('…so the end date is still the real one',
        c.registryRows[0][3] === '2026-09-26', String(c.registryRows[0][3]));
  check('…and the start date was not reverted to the old key\'s prefix',
        c.registryRows[0][2] === '2026-09-20', String(c.registryRows[0][2]));

  // The gate itself, and that the writing path still writes when it should.
  check('tripIdForKey_ passes touch:false',
        /touch:\s*false/.test(extractFn(SRC.Trips, 'tripIdForKey_')));
  check('…and supplies no endDate it does not have',
        !/endDate:\s*startDate/.test(extractFn(SRC.Trips, 'tripIdForKey_')),
        'a fabricated endDate makes every trip look zero-length');

  const w = ctxFor({ trips: [FLORIDA] });
  w.resolveTripId_({ label: 'Florida Trip', startDate: '2026-09-21', endDate: '2026-09-28',
                     eventIds: ['evt-florida'] }, { mint: false });
  check('a calendar-sourced resolve DOES still update the row',
        w.registryRows[0][3] === '2026-09-28', String(w.registryRows[0][3]));
}

console.log('\nDegrading safely when the registry is not there');
{
  const c = ctxFor({ noRegistry: true, itinerary: SPLIT_ITINERARY });
  check('tripKeysFor_ falls back to the key itself',
        JSON.stringify(c.tripKeysFor_(NEW_KEY)) === JSON.stringify([NEW_KEY]));
  check('canonicalTripKey_ returns the input', c.canonicalTripKey_(NEW_KEY) === NEW_KEY);
  check('readTripRows_ still returns that key\'s rows', c.readTripRows_(OLD_KEY).length === 4);
  check('nothing threw into the log',
        !c.logs.some(l => /TypeError|undefined is not/.test(l)), c.logs.join(' | '));

  const empty = ctxFor({ trips: [] });
  check('an empty registry behaves the same',
        JSON.stringify(empty.tripKeysFor_(NEW_KEY)) === JSON.stringify([NEW_KEY]));
}

console.log('\nLatches follow the trip, and pre-seeding stops the re-send');
{
  const legacySlug = k => k.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const idSlug     = 'TRIP_AAAABBBBCCCC';

  // In flight across the change: the latch exists under the OLD key only.
  const sent = { ['PRETRIP_48H_' + legacySlug(OLD_KEY)]: '2026-09-17T10:00:00Z' };

  const c = ctxFor({ trips: [FLORIDA], props: Object.assign({}, sent) });
  check('a latch under an older key still counts as sent',
        c.tripLatchSeen_('PRETRIP_48H_', { tripKey: NEW_KEY }) === true,
        JSON.stringify(Object.keys(c.props)));
  check('an unrelated prefix is not confused',
        c.tripLatchSeen_('POSTTRIP_RECAP_', { tripKey: NEW_KEY }) === false);

  // Seeding copies it onto the id.
  const s = ctxFor({ trips: [FLORIDA], props: Object.assign({}, sent) });
  const res = s.seedTripIdLatches_();
  check('seeding copies the legacy latch onto the Trip ID', res.seeded === 1, JSON.stringify(res));
  check('…under the id-slugged name',
        s.props['PRETRIP_48H_' + idSlug] === '2026-09-17T10:00:00Z',
        JSON.stringify(s.props));
  check('…preserving the original timestamp, not "now"',
        s.props['PRETRIP_48H_' + idSlug] === sent['PRETRIP_48H_' + legacySlug(OLD_KEY)]);
  check('…and deleting nothing',
        s.props['PRETRIP_48H_' + legacySlug(OLD_KEY)] === '2026-09-17T10:00:00Z');

  const again = s.seedTripIdLatches_();
  check('seeding twice changes nothing', again.seeded === 0 && again.skipped >= 1, JSON.stringify(again));
  check('…and the value is untouched', s.props['PRETRIP_48H_' + idSlug] === '2026-09-17T10:00:00Z');

  // THE failure this step exists to prevent: after seeding, the trip still reads
  // as sent even if the legacy latch is gone.
  const seeded = ctxFor({ trips: [FLORIDA], props: { ['PRETRIP_48H_' + idSlug]: '2026-09-17T10:00:00Z' } });
  check('after seeding, a trip with NO legacy latch still reads as sent',
        seeded.tripLatchSeen_('PRETRIP_48H_', { tripKey: NEW_KEY }) === true);
  const unseeded = ctxFor({ trips: [FLORIDA], props: {} });
  check('…and a genuinely unsent trip reads as unsent',
        unseeded.tripLatchSeen_('PRETRIP_48H_', { tripKey: NEW_KEY }) === false);

  // Marking writes against the id.
  const m = ctxFor({ trips: [FLORIDA] });
  const name = m.tripLatchMark_('POSTTRIP_NUDGE_', { tripKey: OLD_KEY });
  check('a mark made under the OLD key lands on the Trip ID',
        name === 'POSTTRIP_NUDGE_' + idSlug, name);
  check('…so the same trip then reads as sent under the NEW key',
        m.tripLatchSeen_('POSTTRIP_NUDGE_', { tripKey: NEW_KEY }) === true);

  // The debrief marker carries a payload.
  const d = ctxFor({ trips: [FLORIDA] });
  d.tripLatchMark_('POSTTRIP_DEBRIEF_', OLD_KEY, JSON.stringify({ completed: 'x' }));
  check('tripLatchValue_ finds a payload written under another key',
        /completed/.test(String(d.tripLatchValue_('POSTTRIP_DEBRIEF_', { tripKey: NEW_KEY }))),
        String(d.tripLatchValue_('POSTTRIP_DEBRIEF_', { tripKey: NEW_KEY })));
  check('…and returns null when genuinely absent',
        d.tripLatchValue_('PRETRIP_NB_', { tripKey: NEW_KEY }) === null);

  // An unresolvable trip still latches, under the legacy name.
  const u = ctxFor({ trips: [] });
  const un = u.tripLatchMark_('PRETRIP_48H_', { tripKey: '2026-11-01|Unknown Trip' });
  check('an unresolvable trip falls back to the legacy latch name',
        un === 'PRETRIP_48H_' + legacySlug('2026-11-01|Unknown Trip'), un);
  check('…and reads back as sent', u.tripLatchSeen_('PRETRIP_48H_', { tripKey: '2026-11-01|Unknown Trip' }));
}

console.log('\nFlag dedup keys follow the trip too');
{
  const c = ctxFor({ trips: [FLORIDA] });
  const a = c.tripFlagKey_('pretrip_briefing_', { tripKey: OLD_KEY });
  const b = c.tripFlagKey_('pretrip_briefing_', { tripKey: NEW_KEY });
  check('both keys give ONE flag key', a === b, a + ' vs ' + b);
  check('…built from the trip id', /trip_aaaabbbbcccc/.test(a), a);
  check('…lowercase and underscore-normalised', /^[a-z0-9_]+$/.test(a) && !/__|^_|_$/.test(a), a);

  const u = ctxFor({ trips: [] });
  const legacyShape = u.tripFlagKey_('pretrip_briefing_', { tripKey: OLD_KEY });
  check('an unresolvable trip keeps the old flag-key shape, so existing flags match',
        legacyShape === ('pretrip_briefing_' + OLD_KEY).toLowerCase()
          .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''),
        legacyShape);
}

console.log('\nAdoption: the registry learns keys only the sheet knows');
{
  // THE STATE THE REAL SHEET IS IN. The registry resolved the trip through its
  // calendar event id, so the row exists — but nothing ever recorded the OLD key,
  // because attachTripIds_ only ever sees trips as the calendar describes them and
  // the calendar has moved on. Aliases is empty.
  const UNADOPTED = Object.assign({}, FLORIDA, { aliases: [] });

  const before = ctxFor({ trips: [UNADOPTED], itinerary: SPLIT_ITINERARY });
  check('before adoption the old key is invisible',
        before.tripKeysFor_(NEW_KEY).indexOf(OLD_KEY) === -1,
        JSON.stringify(before.tripKeysFor_(NEW_KEY)));
  check('…so a read returns only the rows written since the date moved',
        before.readTripRows_(NEW_KEY).length === 1,
        String(before.readTripRows_(NEW_KEY).length));
  // The end date is ALREADY right here, because getTripBoundsByKey_ seeds it from
  // the registry — the calendar knows when the trip runs. So the two fixes are
  // independent: the registry anchor protects the timing, adoption restores the
  // rows. Worth stating, because it is easy to assume adoption is what fixed the
  // early fire and then remove the anchor.
  check('the registry anchor already protects the end date',
        before.getTripBoundsByKey_(NEW_KEY).endDate.toISOString().slice(0, 10) === '2026-09-26',
        before.getTripBoundsByKey_(NEW_KEY).endDate.toISOString().slice(0, 10));

  // …but when the registry has no end date, the rows are the only source, and
  // without adoption they are a sliver. This is where adoption saves the timing.
  const noEnd = ctxFor({
    trips: [Object.assign({}, UNADOPTED, { endDate: '' })],
    itinerary: SPLIT_ITINERARY,
  });
  check('with no registry end date, an unadopted trip ends on its departure day',
        noEnd.getTripBoundsByKey_(NEW_KEY).endDate.toISOString().slice(0, 10) === '2026-09-20',
        noEnd.getTripBoundsByKey_(NEW_KEY).endDate.toISOString().slice(0, 10));
  noEnd.adoptLegacyTripKeys_({ dryRun: false });
  check('…and adoption alone moves it to the real last day',
        noEnd.getTripBoundsByKey_(NEW_KEY).endDate.toISOString().slice(0, 10) === '2026-09-26',
        noEnd.getTripBoundsByKey_(NEW_KEY).endDate.toISOString().slice(0, 10));

  // Dry run first: says what it would do, writes nothing.
  const dry = ctxFor({ trips: [UNADOPTED], itinerary: SPLIT_ITINERARY });
  const snapshot = JSON.stringify(dry.registryRows);
  const dryRes = dry.adoptLegacyTripKeysDryRun();
  check('the dry run finds the old key', dryRes.adopted === 1, JSON.stringify(dryRes));
  check('…names it and the trip it would attach to',
        dryRes.details.some(d => d.indexOf(OLD_KEY) !== -1 && d.indexOf(FLORIDA.tripId) !== -1),
        JSON.stringify(dryRes.details));
  check('…and writes nothing at all', JSON.stringify(dry.registryRows) === snapshot);

  // Apply.
  const c = ctxFor({ trips: [UNADOPTED], itinerary: SPLIT_ITINERARY });
  const res = c.adoptLegacyTripKeys_({ dryRun: false });
  check('adoption attaches exactly one key', res.adopted === 1, JSON.stringify(res));
  check('…recorded in the Aliases column', /2026-09-19\|Florida Trip/.test(String(c.registryRows[0][5])),
        JSON.stringify(c.registryRows[0]));
  check('…the canonical key counts as already attached, not adopted again',
        res.already >= 1, JSON.stringify(res));

  // And only now does the whole chain work.
  check('AFTER adoption the old key is in the set',
        c.tripKeysFor_(NEW_KEY).indexOf(OLD_KEY) !== -1, JSON.stringify(c.tripKeysFor_(NEW_KEY)));
  check('…a read returns the whole itinerary', c.readTripRows_(NEW_KEY).length === 5,
        String(c.readTripRows_(NEW_KEY).length));
  check('…and post-trip computes the real last day',
        c.getTripBoundsByKey_(NEW_KEY).endDate.toISOString().slice(0, 10) === '2026-09-26',
        c.getTripBoundsByKey_(NEW_KEY).endDate.toISOString().slice(0, 10));
  check('…giving the real duration', c.tripDurationNights_(c.getTripBoundsByKey_(NEW_KEY)) === 6);

  // Idempotent.
  const after = JSON.stringify(c.registryRows);
  const again = c.adoptLegacyTripKeys_({ dryRun: false });
  check('a second run adopts nothing', again.adopted === 0, JSON.stringify(again));
  check('…and writes nothing', JSON.stringify(c.registryRows) === after);
}

console.log('\n…and it refuses to guess');
{
  // Two live trips, same label, nine days apart — inside the 14-day tolerance, so
  // both are candidates. Adopting either would hand one trip's rows to the other.
  const A = { tripId: 'TRIP-AAAA00000001', label: 'Florida Trip',
              startDate: '2026-09-20', endDate: '2026-09-26', eventIds: ['e1'], aliases: [] };
  const B = { tripId: 'TRIP-BBBB00000002', label: 'Florida Trip',
              startDate: '2026-09-29', endDate: '2026-10-03', eventIds: ['e2'], aliases: [] };
  const c = ctxFor({ trips: [A, B], itinerary: [row(OLD_KEY, '2026-09-19')] });
  const res = c.adoptLegacyTripKeys_({ dryRun: false });
  check('an ambiguous key is not adopted', res.adopted === 0, JSON.stringify(res));
  check('…it is left alone and counted', res.unresolved === 1, JSON.stringify(res));
  check('…neither trip gained an alias',
        !String(c.registryRows[0][5]).trim() && !String(c.registryRows[1][5]).trim(),
        JSON.stringify(c.registryRows.map(r => r[5])));
  check('…and the refusal is logged', c.logs.some(l => /AMBIGUOUS and strict/.test(l)),
        c.logs.join(' | '));

  // Minting must be unaffected: without strict, resolveTripId_ still picks.
  const m = ctxFor({ trips: [A, B] });
  const picked = m.resolveTripId_({ label: 'Florida Trip', startDate: '2026-09-22',
                                    endDate: '2026-09-24' }, { mint: false });
  check('without strict it still picks, so minting is unchanged', !!picked, picked);

  // A key belonging to nothing is left for the repair tool.
  const o = ctxFor({ trips: [FLORIDA], itinerary: [row('2024-01-01|Ancient Trip', '2024-01-01')] });
  const ores = o.adoptLegacyTripKeys_({ dryRun: false });
  check('a genuinely orphaned key is left alone', ores.adopted === 0 && ores.unresolved === 1,
        JSON.stringify(ores));
}

console.log('\nThe repair tool writes a form the readers accept');
{
  const repair = extractFn(SRC.Trips, 'repairOrphanTripKeys_');
  // Rows re-keyed to a bare TRIP-… vanish from post-trip, which skips any key that
  // is not yyyy-MM-dd-prefixed and derives the departure date from that prefix.
  check('rows are re-keyed to the canonical key, not the bare id',
        /vals\[i\]\[0\] = mergeInto/.test(repair) && /mergeInto = canonicalTripKey_\(targetId\)/.test(repair),
        'a bare id would make the rows invisible to post-trip');
  check('…and it says why', /post-trip|yyyy-MM-dd/.test(repair));

  // The TripMeta conflict guard compared against targetId, but those rows hold key
  // strings — so it never matched and the REFUSING branch never fired.
  check('the TripMeta guard compares against the canonical key',
        /var targetKey = canonicalTripKey_\(targetId\)/.test(repair));
  check('…accepting either form', /k === targetId \|\| \(targetKey && k === targetKey\)/.test(repair));

  // The scan is shared, so adoption and repair cannot disagree about the sheet.
  check('both tools scan through scanTripKeyUsage_ or tripKeyedTabs_',
        /tripKeyedTabs_\(\)/.test(repair) &&
        /tripKeyedTabs_\(\)/.test(extractFn(SRC.Trips, 'scanTripKeyUsage_')));
}

console.log('\nAdoption runs before anything depends on it');
{
  const CODE = fs.readFileSync(ROOT + '/Code.js', 'utf8');
  const adopt   = CODE.indexOf('adoptLegacyTripKeys_({ dryRun: false })');
  const preTrip = CODE.indexOf('checkPreTripBriefings_()');
  const postTrip = CODE.indexOf('checkPostTripCapture_()');
  check('the nightly pass adopts', adopt !== -1);
  check('…before pre-trip', adopt !== -1 && adopt < preTrip, adopt + ' vs ' + preTrip);
  check('…and before post-trip', adopt !== -1 && adopt < postTrip);
  check('…non-fatally, like its neighbours',
        /adoptLegacyTripKeys_: ' \+ adoptErr\.message/.test(CODE));
  check('TestBench previews it', /function tbAdoptTripKeys\(\)/.test(SRC.TestBench));
  check('…as a dry run', /adoptLegacyTripKeysDryRun\(\)/.test(SRC.TestBench));

  // A read must still never mint or write.
  const adoptFn = extractFn(SRC.Trips, 'adoptLegacyTripKeys_');
  check('adoption resolves with mint:false', /mint: false/.test(adoptFn));
  check('…touch:false', /touch: false/.test(adoptFn));
  check('…and strict:true', /strict: true/.test(adoptFn));
}

console.log('\nThe call sites actually moved');
{
  // Latch readers/writers: no site may still build its own slug.
  const inline = /tripKey\.toUpperCase\(\)\.replace\(\/\[\^A-Z0-9\]\/g, '_'\)/;
  ['PostTrip', 'PreTrip'].forEach(k => {
    check(k + ' builds no latch slug by hand', !inline.test(SRC[k]),
          'an inline slug survives — that site still keys on the string');
  });
  check('Chat builds none either', !/cdTripKey\.toUpperCase\(\)/.test(SRC.Chat));
  check('Chat resolves the transcript key rather than trusting it',
        /canonicalTripKey_\(cdTripKey\)/.test(SRC.Chat));
  check('Chat marks via the shared helper', /tripLatchMark_\('POSTTRIP_DEBRIEF_'/.test(SRC.Chat));

  ['PRETRIP_48H_', 'PRETRIP_NB_', 'POSTTRIP_NUDGE_', 'POSTTRIP_RECAP_'].forEach(p => {
    check(p + ' reads through tripLatchSeen_',
          new RegExp("tripLatchSeen_\\('" + p + "'").test(SRC.PostTrip + SRC.PreTrip));
    check(p + ' writes through tripLatchMark_',
          new RegExp("tripLatchMark_\\('" + p + "'").test(SRC.PostTrip + SRC.PreTrip));
  });

  // Reads match the key set.
  check('post-trip groups by Trip ID, not the key string',
        /tripIdForKey_\(tripKey\) \|\| tripKey/.test(SRC.PostTrip));
  check('readTripRows_ matches the key set', /tripRowMatches_\(row\[1\], keys\)/.test(SRC.PostTrip));
  check('the travel-day itinerary read does too',
        /tripRowMatches_\(row\[1\], keys\)/.test(SRC.TravelDay));
  check('post-trip seeds its bounds from the registry',
        /tripDateRangeFor_/.test(SRC.PostTrip));

  // clearTripLatches_ must NOT delete an id latch: the alias is appended first,
  // so the orphan key resolves to the TARGET and that would wipe the survivor's.
  const clear = extractFn(SRC.Trips, 'clearTripLatches_');
  check('clearTripLatches_ deletes legacy names only',
        !/deleteProperty\(prefix \+ tripIdSlugForProperty_/.test(clear),
        'it would delete the surviving trip\'s latch and re-send everything');
  check('…and says why in a comment', /surviving trip|TARGET/.test(clear));
  check('…using the shared prefix list', /TRIP_LATCH_PREFIXES_/.test(clear));

  // Cache coherence: an alias written mid-run must not leave stale key sets.
  check('the key-set memo is dropped with the registry memo',
        /invalidateTripKeyCache_\(\)/.test(extractFn(SRC.Trips, 'invalidateTripRegistry_')));

  // TestBench.
  check('tbTripIdentity exists', /function tbTripIdentity\(\)/.test(SRC.TestBench));
  check('tbSeedTripLatches exists', /function tbSeedTripLatches\(\)/.test(SRC.TestBench));
  const diag = extractFn(SRC.Trips, 'diagnoseTripIdentity_');
  check('the diagnostic writes nothing',
        !/setValue|appendRow|setProperty|sendVeraEmail_/.test(diag));
  check('…and cannot mint', !/mint:\s*true/.test(diag));
}

console.log('\nCaching does not lie');
{
  const c = ctxFor({ trips: [FLORIDA] });
  const first = c.tripKeysFor_(NEW_KEY);
  check('a repeat call returns the same set', JSON.stringify(c.tripKeysFor_(NEW_KEY)) === JSON.stringify(first));
  c.appendTripAlias_(FLORIDA.tripId, '2026-09-18|Florida Trip');
  const after = c.tripKeysFor_(NEW_KEY);
  check('an alias appended mid-run is visible immediately',
        after.indexOf('2026-09-18|Florida Trip') !== -1, JSON.stringify(after));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
