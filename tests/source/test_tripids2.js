// Issue #239, phase 2, step 2: the trip tabs' readers prefer the Trip ID.
// Pins:
//  - tripRowIs_: a row's Trip ID decides when it has one and the trip resolves; a row
//    with no ID (or a trip that doesn't resolve) matches by key exactly as before;
//  - a moved and renamed trip keeps every row on every tab it is read from, even a row
//    whose key the registry never heard of, and a row carrying ANOTHER trip's ID is
//    never read as this trip's, whatever its key says. Reader by reader;
//  - one-pass tallies count rows by ID (tripTallyKey_) and still count rows by key;
//  - single-row tabs (TripMeta): tripKeyRowIndex_ with the ID column prefers the row
//    carrying the trip's ID and skips a row carrying another's;
//  - every key-only comparison left in the code is a writer's lookup (step 3, later)
//    or a tab with no Trip ID column. A new reader that compares keys fails here;
//  - the readiness check (System › Checks › Trip IDs): read only, counts, "clean
//    since", ready after a week; the nightly fill records it;
//  - ARIA's column, Trip Key, is still written and read.
// Invented trips and keys.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TRIPS = read('Trips.js'), TID = read('TripIds.js'), CODE = read('Code.js'), WEB = read('WebApp.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

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
const H = {};
['ITINERARY_HEADERS', 'TRIP_META_HEADERS', 'PACKING_ITEM_HEADERS', 'TRIP_BUDGET_HEADERS', 'TRIP_GIFT_HEADERS',
 'TRIP_OUTFIT_HEADERS', 'PACKING_REVIEW_HEADERS', 'LEAVE_RUN_HEADERS', 'TRIP_RECS_HEADERS', 'TRIP_DECISION_HEADERS'].forEach(n => {
  const m = CODE.match(new RegExp('const ' + n + '\\s*=\\s*(\\[[^\\]]*\\]);'));
  H[n] = m ? JSON.parse(m[1].replace(/'/g, '"')) : null;
});
const TABS = { ITINERARY: 'Itinerary', TRIP_META: 'TripMeta', PACKING_ITEMS: 'PackingItems', TRIP_BUDGET: 'Trip Budget', TRIP_GIFTS: 'Trip Gifts',
  TRIP_OUTFITS: 'Trip Outfits', PACKING_REVIEWS: 'Packing Reviews', LEAVE_RUNS: 'Leaving Home Runs', TRIP_RECOMMENDATIONS: 'TripRecommendations', TRIP_DECISIONS: 'Trip Decisions' };

// The trip: "Lisbon Weekend" on Mar 5 became "Lisbon & Porto" on Mar 6. The registry
// knows both keys. A third key, typed by hand once, it never heard of.
const NEW = '2027-03-06|Lisbon & Porto', OLD = '2027-03-05|Lisbon Weekend', STRAY = '2027-03-05|Lisbon trip';
const ID = 'TRIP-1A2B3C4D5E6F', OTHER_ID = 'TRIP-9F8E7D6C5B4A', OTHER = '2027-06-01|Porto Again';
const REG = { [NEW]: [NEW, OLD, ID], [OLD]: [NEW, OLD, ID], [ID]: [NEW, OLD, ID], [OTHER]: [OTHER, OTHER_ID] };
const IDS = { [NEW]: ID, [OLD]: ID, [OTHER]: OTHER_ID };

const HELPERS = ['tripRowMatches_', 'tripKeyMatches_', 'tripKeyRowIndex_', 'tripIdOf_', 'tripIdCellOf_', 'tripRowIs_', 'tripTallyKey_', 'countForTripKeys_'];
function sheetOf(name, header, rows, writes) {
  const all = [header].concat(rows);
  const rng = (r, c, nr, nc) => ({
    getValues: () => all.slice(r - 1, r - 1 + (nr || 1)).map(row => { const out = []; for (let k = 0; k < (nc || 1); k++) out.push(row[c - 1 + k] === undefined ? '' : row[c - 1 + k]); return out; }),
    getValue: () => { const row = all[r - 1] || []; return row[c - 1] === undefined ? '' : row[c - 1]; },
    setValue: v => writes && writes.push([name, r, c, v]),
    setValues: v => writes && writes.push([name, r, c, v]),
  });
  return { getName: () => name, getLastRow: () => all.length, getLastColumn: () => header.length, getMaxColumns: () => header.length,
    getRange: rng, getDataRange: () => ({ getValues: () => all.map(r => r.slice()) }) };
}
function ctx(tabs, extra, fns, srcs) {
  const writes = [];
  const sheets = {};
  Object.keys(tabs || {}).forEach(k => { sheets[k] = sheetOf(k, tabs[k][0], tabs[k][1], writes); });
  const c = Object.assign({
    String, Number, Object, Array, Date, Math, JSON, RegExp, isFinite, isNaN, Error,
    Logger: { log: () => {} }, Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: d => new Date(d).toISOString().slice(0, 10) },
    TABS, getSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }),
    tripKeysFor_: k => REG[k] || [k], tripIdForKey_: k => IDS[k] || '', isTripId_: v => /^TRIP-/.test(String(v)),
    _writes: writes,
  }, H, extra || {});
  vm.createContext(c);
  vm.runInContext('var _tripIdOfCache_ = {};\n' + HELPERS.map(n => extractFn(TRIPS, n)).join('\n'), c);
  (fns || []).forEach(([src, n]) => vm.runInContext(extractFn(src, n), c));
  (srcs || []).forEach(s => vm.runInContext(s, c));
  return c;
}
// A row in a tab's own column order: fields by header name, Trip ID last.
const rowOf = (headers, f) => headers.map(h => f[h] === undefined ? '' : f[h]);
// The four rows every reader is handed, told apart by a label in some column:
//   alias  — an old key the registry knows, no ID          → this trip's
//   byId   — a key nobody knows, this trip's ID              → this trip's (the point of phase 2)
//   other  — this trip's key, ANOTHER trip's ID              → not this trip's
//   plain  — the current key, no ID                          → this trip's (a row with no ID reads by key)
const CASES = [['alias', OLD, ''], ['byId', STRAY, ID], ['other', NEW, OTHER_ID], ['plain', NEW, '']];
const WANT = ['alias', 'byId', 'plain'];

console.log('\ntripRowIs_');
{
  const c = ctx();
  const is = (k, id, t) => c.tripRowIs_(k, id, t);
  check('a row with this trip\'s ID is this trip\'s, whatever its key', is(STRAY, ID, NEW) && is('', ID, NEW) && is(OTHER, ID, NEW));
  check('…and the ID is matched without regard to case or spaces', is(STRAY, ' trip-1a2b3c4d5e6f ', NEW));
  check('a row with another trip\'s ID is not, even under this trip\'s key', !is(NEW, OTHER_ID, NEW) && !is(OLD, OTHER_ID, NEW));
  check('a row with no ID matches by every key the trip has had', is(OLD, '', NEW) && is(NEW, '', NEW) && !is(STRAY, '', NEW) && !is(OTHER, '', NEW));
  check('…and a cell that isn\'t an ID counts as none', is(OLD, 'n/a', NEW) && !is(STRAY, 'n/a', NEW));
  check('a trip that doesn\'t resolve matches by key, ID or not', is('2027-01-01|Nowhere', OTHER_ID, '2027-01-01|Nowhere') && !is('2027-01-02|Nowhere', '', '2027-01-01|Nowhere'));
  check('asked by the Trip ID itself, the same answers', is(STRAY, ID, ID) && !is(NEW, OTHER_ID, ID) && is(OLD, '', ID));
  check('without a registry in the context, exactly the old key comparison',
    (() => { const d = ctx(null, { tripKeysFor_: undefined, tripIdForKey_: undefined }); return d.tripRowIs_(NEW, OTHER_ID, NEW) && !d.tripRowIs_(OLD, ID, NEW); })());
  check('the trip\'s ID is looked up once per run, not once per row',
    (() => { let n = 0; const d = ctx(null, { tripIdForKey_: k => { n++; return IDS[k] || ''; } }); for (let i = 0; i < 50; i++) d.tripRowIs_(STRAY, ID, NEW); return n === 1; })());
  check('…and dropped with the key cache when the registry changes', /function invalidateTripKeyCache_\(\) \{ _tripKeySetCache_ = \{\}; _tripIdOfCache_ = \{\}; \}/.test(TRIPS));
}

console.log('\ntallies and single-row tabs');
{
  const c = ctx();
  const rows = CASES.map(([, k, id]) => [k, id]);
  const bucket = {};
  rows.forEach(([k, id]) => { const t = c.tripTallyKey_(k, id); bucket[t] = (bucket[t] || 0) + 1; });
  check('one-pass tallies count the trip\'s rows by ID and by key, once each', c.countForTripKeys_(bucket, REG[NEW]) === 3, J(bucket));
  check('…and the other trip\'s row counts for it', c.countForTripKeys_(bucket, REG[OTHER]) === 1);
  const keys = [OLD, NEW, STRAY], ids = ['', OTHER_ID, ID];
  check('TripMeta: the row carrying the trip\'s ID wins, over an exact key on another trip\'s row', c.tripKeyRowIndex_(keys, NEW, ids) === 2);
  check('…a row carrying another trip\'s ID is skipped', c.tripKeyRowIndex_([NEW, OLD], NEW, [OTHER_ID, '']) === 1);
  check('…and without the ID column, exactly as before (exact key, then alias)', c.tripKeyRowIndex_(keys, NEW) === 1 && c.tripKeyRowIndex_([OLD], NEW) === 0);
}

console.log('\nreader by reader: a moved, renamed trip keeps its rows; another trip\'s are not read');
function tab(headers, keyField, labelField, extra) {
  return CASES.map(([label, key, id], i) => rowOf(headers, Object.assign({ ID: 'r' + i, 'Trip Key': key, 'Trip ID': id, [labelField]: label }, extra ? extra(label, i) : {})));
}
const same = (a, b) => J(a.slice().sort()) === J(b.slice().sort());
{
  // Itinerary readers
  const IT = H.ITINERARY_HEADERS, it = tab(IT, 'Trip Key', 'Title', (l, i) => ({ Type: 'flight', Date: l === 'other' ? '2027-03-01' : '2027-03-0' + (5 + i), 'Start Time': '09:00' }));
  const PTC = read('PostTripCapture.js');
  let c = ctx({ Itinerary: [IT, it] }, {}, [[PTC, 'readTripRows_']]);
  check('PostTripCapture readTripRows_', same(c.readTripRows_(NEW).map(r => r[3]), WANT), J(c.readTripRows_(NEW).map(r => r[3])));
  c = ctx({ Itinerary: [IT, it] }, {}, [[read('TripShare.js'), 'tripShareItems_']]);
  check('TripShare tripShareItems_', same(c.tripShareItems_(NEW).map(r => r.title), WANT), J(c.tripShareItems_(NEW).map(r => r.title)));
  c = ctx({ Itinerary: [IT, it] }, { lhTz_: () => 'UTC' }, [[read('LeavingHome.js'), 'lhFirstFlight_']]);
  check('LeavingHome lhFirstFlight_ skips the other trip\'s earlier flight', (c.lhFirstFlight_(NEW) || {}).date === '2027-03-05', J(c.lhFirstFlight_(NEW)));
  c = ctx({}, {}, [[read('TripActuals.js'), 'tripActualsItems_']]);
  const got = c.tripActualsItems_(it, { startDate: '2027-03-06', endDate: '2027-03-09' }, REG[NEW].concat([NEW]), null, ID).map(x => x.title);
  check('TripActuals tripActualsItems_ (bookings paid toward the trip)', same(got, WANT), J(got));
  const legacy = c.tripActualsItems_(it, { startDate: '2027-03-06', endDate: '2027-03-09' }, REG[NEW].concat([NEW]), null).map(x => x.title);
  check('…and without the trip\'s ID, by key exactly as before', same(legacy, ['alias', 'other', 'plain']), J(legacy));
  check('webGetItinerary_ reads by tripRowIs_ and hands each item its Trip ID', /if \(!tripRowIs_\(row\[1\], row\[ITINERARY_HEADERS\.length - 1\], tripKey\)\) return; \/\/ different trip/.test(WEB) && /tripId:\s+tripIdCellOf_\(row\[ITINERARY_HEADERS\.length - 1\]\)/.test(WEB));
  check('…and both generators rebuild their rows with the ID in Itinerary\'s last column', (WEB.match(/it\.startTime, it\.endTime, it\.location, it\.notes, it\.metadata, it\.tripId \|\| ''\];/g) || []).length === 2 && IT.indexOf('Trip ID') === 10);
  const fns = ['inferTripDestination_', 'buildRecsGapSummary_'].concat(['webGeneratePacking_', 'webGenerateRecommendations_']);
  check('…so the readers of those rows (destination, gap summary, prompts) match on index 10', fns.every(n => /tripRowIs_\(row\[1\], row\[10\], tripKey\)/.test(extractFn(WEB, n))), fns.filter(n => !/tripRowIs_\(row\[1\], row\[10\], tripKey\)/.test(extractFn(WEB, n))).join());
  check('cruise ports read the same way', /tripRowIs_\(r\[1\], r\[10\], tripKey\)/.test(extractFn(read('GenerationInputs.js'), 'cruisePortRows_')));

  // Packing readers
  const PK = H.PACKING_ITEM_HEADERS, pk = tab(PK, 'Trip Key', 'Item', (l, i) => ({ Person: 'Sam', Checked: i % 2 ? 'TRUE' : 'FALSE' }));
  c = ctx({ PackingItems: [PK, pk] }, {}, [[read('PreTripBriefing.js'), 'getPackingStatusForBriefing_']]);
  const st = c.getPackingStatusForBriefing_(NEW).sam || {};
  check('PreTripBriefing getPackingStatusForBriefing_', st.total === 3 && st.packed === 2 && same(st.open, ['alias']), J(st));
  c = ctx({ PackingItems: [PK, pk] }, {}, [[read('Luggage.js'), 'luPacking_']]);
  check('Luggage luPacking_', same(c.luPacking_(NEW).map(x => x.item), WANT), J(c.luPacking_(NEW).map(x => x.item)));
  const PP = read('PackPlus.js');
  c = ctx({ PackingItems: [PK, pk] }, { PK_STATUSES_: ['buy', 'ready', 'bag'] },
    [[PP, 'pkStr_'], [PP, 'pkStatusOf_'], [PP, 'pkRow_'], [PP, 'pkAllRows_'], [PP, 'pkTripRows_']]);
  vm.runInContext('pkSheet_ = function() { return getSpreadsheet().getSheetByName("PackingItems"); };', c);
  let pkGot; try { pkGot = c.pkTripRows_(NEW).map(x => x.item); } catch (e) { pkGot = ['threw: ' + e.message]; }
  check('PackPlus pkTripRows_ (Packing, the copy-from list, leave-nothing-behind)', same(pkGot, WANT), J(pkGot));
  check('…and each packing row carries its Trip ID', c.pkAllRows_().filter(r => r.tripId === ID).length === 1);
  const RM = read('Reminders.js');
  check('Reminders packing_not_started counts by tripRowIs_', /if \(tripRowIs_\(r\[1\], r\[PACKING_ITEM_HEADERS\.length - 1\], tripKey\)\) packCount\+\+;/.test(RM));
  check('the morning prompt (Claude.js) and the nightly packing nudge (Code.js) tally by tripTallyKey_',
    (read('Claude.js').match(/tripTallyKey_\(r\[1\], r\[(PACKING_ITEM|ITINERARY)_HEADERS\.length - 1\]\)/g) || []).length === 2 && /tripTallyKey_\(r\[1\], r\[PACKING_ITEM_HEADERS\.length - 1\]\)/.test(CODE));
  check('webGetPacking_ reads by tripRowIs_', /tripRowIs_\(row\[1\], row\[PACKING_ITEM_HEADERS\.length - 1\], tripKey\)/.test(extractFn(WEB, 'webGetPacking_')));

  // Trip Budget readers
  const BU = H.TRIP_BUDGET_HEADERS, bu = tab(BU, 'Trip Key', 'Label', (l, i) => ({ Category: 'Gifts', Budgeted: Math.pow(10, i) }));
  c = ctx({ 'Trip Budget': [BU, bu] }, {}, [[read('TripGifts.js'), 'tgReadBudget_']]);
  check('TripGifts tgReadBudget_ (1 + 10 + 1000: never the other trip\'s 100)', c.tgReadBudget_(NEW) === 1011, J(c.tgReadBudget_(NEW)));
  c = ctx({ 'Trip Budget': [BU, bu] }, { webGetTripMeta_: () => ({}) }, [[read('Aria.js'), 'ariaTripFacts_']]);
  check('ARIA ariaTripFacts_ (the trip\'s budget lines)', same(c.ariaTripFacts_(NEW).budget.map(b => b.label), WANT), J(c.ariaTripFacts_(NEW).budget));
  c = ctx({ 'Trip Budget': [BU, bu] }, { ensureSheet: (ss, n) => ss.getSheetByName(n) }, [[WEB, 'webGetTripBudget_']]);
  let tb = null; try { tb = c.webGetTripBudget_({ parameter: { tripKey: NEW } }); } catch (e) { tb = { err: e.message }; }
  check('webGetTripBudget_ (by the Trip ID column\'s header)', /tripRowIs_\(obj\['Trip Key'\], obj\['Trip ID'\], tripKey\)/.test(extractFn(WEB, 'webGetTripBudget_')) && (!tb || !tb.items || same(tb.items.map(x => x.Label), WANT)), J(tb && tb.items && tb.items.map(x => x.Label)));
  check('budget import and copy read existing lines by tripRowIs_', /tripRowIs_\(r\[bTkIdx\], r\[bHdrs\.indexOf\('Trip ID'\)\], tripKey\)/.test(extractFn(WEB, 'webImportBudgetFromItinerary_')) && /tripRowIs_\(rk, rid, sourceTripKey\)/.test(extractFn(WEB, 'webCopyTripBudget_')));

  // Gifts
  const GF = H.TRIP_GIFT_HEADERS, gf = tab(GF, 'Trip Key', 'Item');
  const TG = read('TripGifts.js');
  c = ctx({ 'Trip Gifts': [GF, gf] }, { tgRowToGift_: r => r[3] }, [[TG, 'tgAllRows_'], [read('Luggage.js'), 'luGifts_']]);
  check('Luggage luGifts_', same(c.luGifts_(NEW), WANT), J(c.luGifts_(NEW)));
  check('webGetTripGifts_ and the checkout gift note read by tripRowIs_', /tripRowIs_\(r\[1\], r\[TRIP_GIFT_HEADERS\.length - 1\], tripKey\)/.test(extractFn(TG, 'webGetTripGifts_')) && /tripRowIs_\(r\[1\], r\[TRIP_GIFT_HEADERS\.length - 1\], tripKey\)/.test(extractFn(PP, 'pkCheckoutView_')));

  // Decisions, recommendations, TripMeta, Leaving Home runs
  const TD = H.TRIP_DECISION_HEADERS, td = tab(TD, 'Trip Key', 'Group Key', () => ({ Status: 'chosen' }));
  c = ctx({ 'Trip Decisions': [TD, td] }, { formatDateVal_: v => String(v || '') }, [[read('TripDecisions.js'), 'loadTripDecisions_']]);
  check('TripDecisions loadTripDecisions_', same(Object.keys(c.loadTripDecisions_(NEW)), WANT), J(Object.keys(c.loadTripDecisions_(NEW))));
  check('webGetRecommendations_ reads by tripRowIs_', /tripRowIs_\(row\[1\], row\[TRIP_RECS_HEADERS\.length - 1\], tripKey\)/.test(extractFn(WEB, 'webGetRecommendations_')));
  const TM = H.TRIP_META_HEADERS;
  const tm = [rowOf(TM, { 'Trip Key': NEW, Context: 'work', 'Trip ID': OTHER_ID }), rowOf(TM, { 'Trip Key': STRAY, Context: 'Anniversary trip', 'Trip ID': ID })];
  c = ctx({ TripMeta: [TM, tm] }, {}, [[read('TravelDayBriefing.js'), 'getTripToneMode_']]);
  check('TravelDayBriefing getTripToneMode_ reads the row with the trip\'s ID', c.getTripToneMode_(NEW) === 'personal');
  check('…and not another trip\'s row under this key', c.getTripToneMode_(OTHER) === 'professional');
  check('webGetTripMeta_ and the pencilled-trip carry-over pass the Trip ID column', /tripKeyRowIndex_\(data\.map\(function\(r\) \{ return r\[0\]; \}\), tripKey, data\.map\(function\(r\) \{ return r\[TRIP_META_HEADERS\.length - 1\]; \}\)\)/.test(extractFn(WEB, 'webGetTripMeta_')) && /TRIP_META_HEADERS\.length - 1\]; \}\)\);/.test(extractFn(read('MyTrips.js'), 'mtCarryToTrip_')));
  const LR = H.LEAVE_RUN_HEADERS, LH = read('LeavingHome.js');
  const lr = CASES.map(([label, key, id]) => rowOf(LR, { ID: label, Kind: 'trip', 'Trip Key': key, 'Trip ID': id }));
  c = ctx({}, { LH_HOME_DEFAULT_: 'Home' }, [[LH, 'lhStr_'], [LH, 'lhJson_'], [LH, 'lhAt_'], [LH, 'lhRunRows_'], [LH, 'lhRunIs_'], [LH, 'lhTripRun_']]);
  const runs = c.lhRunRows_([lr[2], lr[1]]);   // the other trip's run first, under this trip's key
  check('LeavingHome lhTripRun_ picks the run with the trip\'s ID over another trip\'s under its key', (c.lhTripRun_(NEW, '2027-03-06', '2027-03-09', runs) || {}).id === 'byId', J(c.lhTripRun_(NEW, '2027-03-06', '2027-03-09', runs)));
  check('…and the morning-of send and checkout run read the same way', /lhRunIs_\(r, key\)/.test(extractFn(LH, 'lhMorningCheck_')) && /r\.kind === 'checkout' && tripRowIs_\(r\.tripKey, r\.tripId, tripKey\)/.test(PP));
  check('Chat\'s trip dates, the flight statuses and the trip items read by tripRowIs_',
    /tripRowIs_\(row\[1\], row\[ITINERARY_HEADERS\.length - 1\], tripKey\)/.test(read('Chat.js')) && /tripRowIs_\(rows\[i\]\[1\], rows\[i\]\[ITINERARY_HEADERS\.length - 1\], tripKey\)/.test(extractFn(WEB, 'webGetFlightStatuses_')) && /tripRowIs_\(r\[1\], r\[ITINERARY_HEADERS\.length - 1\], tripKey\)/.test(extractFn(WEB, 'tripItemsFor_')));
  check('…and the travel-day briefing', (read('TravelDayBriefing.js').match(/tripRowIs_\(row\[1\], row\[ITINERARY_HEADERS\.length - 1\], tripKey\)/g) || []).length === 2);
}

console.log('\nevery key-only comparison left is a writer (step 3) or a tab without a Trip ID');
{
  // Each function that may still compare by key alone, and why. Step 3 moves the writers.
  const ALLOWED = {
    readGenerationInputs_: 'Generation Inputs: not a trip tab, no Trip ID column',
    recordGenerationInputs_: 'Generation Inputs: not a trip tab',
    luMetaRow_: 'step 3: the TripMeta row luggage moves are written to',
    pkOutfitsFor_: 'step 3: the outfit row that is rewritten',
    pkReviewFor_: 'step 3: the review row that is rewritten',
    tripActualsLines_: 'step 3: Trip Budget lines that actuals are written to',
    webSetTripGiftBudget_: 'step 3: the Gifts budget line that is written',
    tdFindDecisionRow_: 'step 3: the decision row that is written',
    webSetTripMeta_: 'step 3', setTripBriefing_: 'step 3', webSetTripBudgetSettings_: 'step 3',
    webGeneratePacking_: 'step 3: the packing rows a regenerate replaces (its prompt reads by ID)',
    webGenerateRecommendations_: 'step 3: the AI rows a regenerate deletes (its prompt reads by ID)',
    tripKeyMatches_: 'the helper', tripRowMatches_: 'the helper', tripKeyRowIndex_: 'the helper', tripRowIs_: 'the helper', pkKeyMatch_: 'the helper',
  };
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const re = /\b(tripKeyMatches_|tripRowMatches_|pkKeyMatch_|tripKeyRowIndex_)\(/g;
  const left = [], stray = [];
  files.forEach(f => {
    const s = read(f);
    let m;
    while ((m = re.exec(s))) {
      const line = s.slice(s.lastIndexOf('\n', m.index) + 1, s.indexOf('\n', m.index));
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      const st = s.lastIndexOf('\nfunction ', m.index);
      const name = (s.slice(st, st + 120).match(/function (\w+)/) || [])[1];
      if (m[1] === 'tripKeyRowIndex_' && /TRIP_META_HEADERS\.length - 1|, idCells\)/.test(line)) continue;   // passes the ID column
      left.push(name);
      if (!ALLOWED[name]) stray.push(f + ':' + name);
    }
  });
  check('no reader compares trip keys alone (' + left.length + ' writer and helper sites left)', stray.length === 0, stray.join(', '));
  check('the step-3 writers are still there to move (nothing switched early)', ['tdFindDecisionRow_', 'webSetTripMeta_', 'webSetTripGiftBudget_', 'pkOutfitsFor_'].every(n => left.indexOf(n) !== -1));
  check('ARIA\'s column: every trip tab still has a Trip Key, and writers still fill it', Object.keys(H).every(n => H[n].indexOf('Trip Key') !== -1) && /tripKeyForWrite_\(/.test(TRIPS));
}

console.log('\nthe readiness check');
{
  const mk = (extra) => {
    const writes = [], store = Object.assign({}, (extra || {}).store);
    const c = Object.assign({ String, Array, Number, Object, JSON, Math, RegExp, Date, isFinite, Logger: { log: () => {} },
      Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: () => (extra || {}).today || '2027-02-10' },
      veraStoreGet_: k => store[k] || null, veraStoreSet_: (k, v) => { store[k] = v; return true; }, _store: store, _writes: writes,
      TABS }, H, extra || {});
    const tabs = (extra || {}).tabs || {};
    const sheets = {};
    Object.keys(tabs).forEach(k => { sheets[k] = sheetOf(k, tabs[k][0], tabs[k][1], writes); });
    c.getSpreadsheet = () => ({ getSheetByName: n => sheets[n] || null });
    c.tripIdForKey_ = k => IDS[k] || '';
    vm.createContext(c);
    vm.runInContext(TID, c);
    return c;
  };
  const IT = H.ITINERARY_HEADERS;
  const r = (key, id, t) => rowOf(IT, { ID: 'x', 'Trip Key': key, 'Trip ID': id, Title: t || '' });
  const dirty = { Itinerary: [IT, [r(NEW, ID), r(OLD, ''), r(NEW, OTHER_ID), r('2027-09-09|Unknown', '')]] };
  let c = mk({ tabs: dirty, today: '2027-02-10' });
  let out = c.webTripIdCheck_();
  check('it never writes: not even the blank it could fill', c._writes.length === 0, J(c._writes));
  check('rows with an ID / without / mismatches, counted after what the nightly run would fill', J(out.totals) === J({ withId: 2, blank: 2, mismatched: 1 }), J(out.totals));
  const itTab = out.tabs.find(t => t.tab === 'Itinerary') || {};
  check('the mismatch is listed: the row, its key, its ID and what the key names now', J(itTab.mismatches) === J([{ row: 4, key: NEW, id: OTHER_ID, keyIs: ID }]), J(itTab.mismatches));
  check('…and the row whose key names no trip', J(itTab.unresolved) === J([{ row: 5, key: '2027-09-09|Unknown' }]), J(itTab.unresolved));
  check('not clean, not ready', out.cleanNow === false && out.ready === false && out.cleanSince === '');
  check('a tab missing from the sheet is passed over, not an error', out.ok === true && out.tabs.length === 1);

  const clean = { Itinerary: [IT, [r(NEW, ID), r(OLD, ID), r(OTHER, OTHER_ID), r('', '')]] };
  c = mk({ tabs: clean, today: '2027-02-10', store: { trip_ids_clean_since: '2027-02-05' } });
  out = c.webTripIdCheck_();
  check('clean for 5 nights: waiting, with the date it started', out.cleanNow && out.cleanSince === '2027-02-05' && out.cleanDays === 5 && out.needDays === 7 && !out.ready, J(out));
  c = mk({ tabs: clean, today: '2027-02-12', store: { trip_ids_clean_since: '2027-02-05' } });
  check('clean for 7: ready for step 3', c.webTripIdCheck_().ready === true);
  c = mk({ tabs: dirty, today: '2027-02-12', store: { trip_ids_clean_since: '2027-02-05' } });
  check('a stored date doesn\'t count while the tabs aren\'t clean', c.webTripIdCheck_().ready === false && c.webTripIdCheck_().cleanSince === '');
  const moved = { Itinerary: [IT.slice(0, 10).concat(['Notes 2']), [r(NEW, ID)]] };
  c = mk({ tabs: moved, today: '2027-02-12', store: { trip_ids_clean_since: '2027-02-05' } });
  out = c.webTripIdCheck_();
  check('a tab whose Trip ID column was moved is reported, and blocks ready', /not Trip ID/.test((out.tabs[0] || {}).skipped || '') && !out.ready && !out.cleanNow);

  check('clean since: a clean night starts the count', c.tidCleanSince_({ blank: 0, mismatched: 0, tabs: [] }, '', '2027-02-10') === '2027-02-10');
  check('…keeps the earlier date', c.tidCleanSince_({ blank: 0, mismatched: 0, tabs: [] }, '2027-02-01', '2027-02-10') === '2027-02-01');
  check('…a blank or a mismatch clears it', c.tidCleanSince_({ blank: 1, mismatched: 0, tabs: [] }, '2027-02-01', '2027-02-10') === '' && c.tidCleanSince_({ blank: 0, mismatched: 2, tabs: [] }, '2027-02-01', '2027-02-10') === '');
  check('…and a junk or future stored date restarts it', c.tidCleanSince_({ blank: 0, mismatched: 0, tabs: [] }, 'soon', '2027-02-10') === '2027-02-10' && c.tidCleanSince_({ blank: 0, mismatched: 0, tabs: [] }, '2027-03-01', '2027-02-10') === '2027-02-10');

  c = mk({ tabs: { Itinerary: [IT, [r(NEW, ''), r(OLD, ID)]] }, today: '2027-02-10' });
  const night = c.tripIdStampAll_();
  check('the nightly fill still fills, and only the Trip ID column', night.filled === 1 && c._writes.length === 1 && c._writes[0][2] === IT.length, J(c._writes));
  check('…and records that tonight was clean', c._store.trip_ids_clean_since === '2027-02-10', J(c._store));
  c = mk({ tabs: dirty, today: '2027-02-11', store: { trip_ids_clean_since: '2027-02-01' } });
  c.tripIdStampAll_();
  check('…or clears the date on a night that isn\'t', c._store.trip_ids_clean_since === '', J(c._store));
  c = mk({ tabs: clean, today: '2027-02-11', store: { trip_ids_clean_since: '2027-02-01' } });
  c.veraStoreSet_ = () => { throw new Error('quota'); };
  let threw = false; try { c.tripIdStampAll_(); } catch (e) { threw = true; }
  check('…and a store that can\'t be written never stops the fill', !threw);
  check('the check is a GET route', /case 'trip_id_check':\s+return jsonOut_\(webTripIdCheck_\(\)\);/.test(WEB));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
