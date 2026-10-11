// buildPrompt read the whole Packing Items tab, and the whole Itinerary tab, ONCE PER
// TRIP.
//
// Both reads sat inside `tripsForPrompt.map(...)`: a full getValues of every row, twice,
// per trip, to produce two counts one pass already has. The same bug was fixed in the
// morning email's travel section (buildMorningIntelligence_, Code.js) and left here.
//
// Asserted on COST as well as output. An output-only test passes just as well on the
// version that reads 2N times — the read counters are the point.
//
// It also gives buildPrompt its first test coverage, so the fakes below are deliberately
// minimal: enough for the prompt to build, and no more.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const CL    = fs.readFileSync(ROOT + '/Claude.js', 'utf8');
const CODE  = fs.readFileSync(ROOT + '/Code.js', 'utf8');
const TRIPS = fs.readFileSync(ROOT + '/Trips.js', 'utf8');

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
// A file-level declaration, brace-matched. Used for TABS, so a renamed tab cannot pass
// here and miss in Apps Script.
function extractDecl(src, prefix) {
  const start = src.indexOf(prefix);
  if (start === -1) throw new Error('not found: ' + prefix);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) + ';'; }
  }
  throw new Error('unbalanced: ' + prefix);
}
// Headers lifted from source, so a column added later cannot silently shift a fixture.
const hdr = n => eval(CODE.match(new RegExp('const ' + n + '\\s*=\\s*(\\[[^\\]]*\\])'))[1]);
const PACKING_ITEM_HEADERS = hdr('PACKING_ITEM_HEADERS');
const ITINERARY_HEADERS    = hdr('ITINERARY_HEADERS');
const TRIP_META_HEADERS    = hdr('TRIP_META_HEADERS');
const BILL_HEADERS         = hdr('BILL_HEADERS');
const HOME_ITEM_HEADERS    = hdr('HOME_ITEM_HEADERS');
const IDEA_HEADERS         = hdr('IDEA_HEADERS');

const P_KEY = PACKING_ITEM_HEADERS.indexOf('Trip Key');
const I_KEY = ITINERARY_HEADERS.indexOf('Trip Key');

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August',
                'September','October','November','December'];
function formatDate(d, tz, pat) {
  const D = new Date(d), p2 = n => String(n).padStart(2, '0');
  if (pat === 'yyyy-MM-dd') return D.getFullYear() + '-' + p2(D.getMonth() + 1) + '-' + p2(D.getDate());
  if (pat === 'yyyy-MM')    return D.getFullYear() + '-' + p2(D.getMonth() + 1);
  if (pat === 'EEEE, MMMM d, yyyy') {
    return DAYS[D.getDay()] + ', ' + MONTHS[D.getMonth()] + ' ' + D.getDate() + ', ' + D.getFullYear();
  }
  // Loud on purpose. A silent fallback here would let a date land in the prompt in the
  // wrong shape and still pass.
  throw new Error('formatDate: unhandled pattern ' + pat);
}

const DAY = 86400000;
const MIDNIGHT = new Date(); MIDNIGHT.setHours(0, 0, 0, 0);
const p2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
// Derived from the real today, because buildPrompt does its own date arithmetic. A
// hard-coded fixture date drifts by one every midnight.
const dayOffset = n => ymd(new Date(MIDNIGHT.getTime() + n * DAY));

// A sheet book that COUNTS every read, and can be made to fail one tab at a time.
function makeBook(tabs, calls, throwsOn) {
  return {
    getSheetByName(name) {
      calls.getSheetByName.push(name);
      const rows = tabs[name];
      if (!rows) return null;
      return {
        getLastRow: () => rows.length + 1,          // +1 for the header row
        getRange(startRow, startCol, nRows, nCols) {
          return {
            getValues() {
              calls.getValues.push(name);
              if (throwsOn && throwsOn[name]) throw new Error(name + ' read failed');
              return rows.slice(startRow - 2, startRow - 2 + nRows)
                         .map(r => r.slice(startCol - 1, startCol - 1 + nCols));
            },
          };
        },
      };
    },
  };
}

/** The REAL buildPrompt in a vm, with counting dependencies. */
function harness(opts) {
  opts = opts || {};
  const calls = { getSheetByName: [], getValues: [], getSpreadsheet: 0, tripKeysFor_: [] };
  const logs = [];
  const tabs = opts.tabs || {};

  const ctx = {
    console, Date, Math, String, Number, Boolean, Object, Array, JSON, isNaN, parseInt, parseFloat,
    RegExp, Error,
    Logger: { log: m => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate },
    CONFIG: { CALENDAR_DAYS_AHEAD: 7 },
    PACKING_ITEM_HEADERS, ITINERARY_HEADERS, TRIP_META_HEADERS,
    BILL_HEADERS, HOME_ITEM_HEADERS, IDEA_HEADERS,

    getSpreadsheet() {
      calls.getSpreadsheet++;
      if (opts.spreadsheetThrows) throw new Error('SHEET_ID not configured');
      return makeBook(tabs, calls, opts.throwsOn);
    },
    readPTOConfig_:        () => ({}),
    getUpcomingTravel_:    () => opts.trips || [],
    ptoSummaryForClaude_:  () => '',
    getDegradedSources_:   () => [],
    getGoals_:             () => [],
    getProjects_:          () => [],
    getTopSignalPatterns_: () => [],
    calculateProjection_:  () => null,
    webGetCountries_:      () => ({ entries: [] }),
    webGetBucketList_:     () => ({ entries: [] }),
    // The alias set. Counted, because resolving it once per ROW rather than once per
    // trip is the other half of the N+1 — the itinerary loop used to call it per row.
    tripKeysFor_(k) {
      calls.tripKeysFor_.push(k);
      return (opts.aliases && opts.aliases[k]) || [k];
    },
    _calls: calls, _logs: logs,
  };

  vm.createContext(ctx);
  vm.runInContext(extractDecl(CODE, 'const TABS = {'), ctx);
  // The REAL alias sum, not a stub: summing a tally across the alias set is the whole
  // of what the lookup now does, so a stub would leave the counts untested.
  [extractFn(TRIPS, 'countForTripKeys_'),
   extractFn(CL, 'buildPrompt')].forEach(s => vm.runInContext(s, ctx));
  return ctx;
}

const build = c => {
  c._threw = null;
  try { return vm.runInContext('buildPrompt([], [], [], null, [], [], null)', c); }
  catch (e) { c._threw = e.message; return ''; }
};

// Row builders.
let pid = 0, iid = 0;
const pk = key => {
  const r = new Array(PACKING_ITEM_HEADERS.length).fill('');
  r[0] = 'PI-' + (++pid); r[P_KEY] = key; r[4] = 'thing';
  return r;
};
const ik = key => {
  const r = new Array(ITINERARY_HEADERS.length).fill('');
  r[0] = 'IT-' + (++iid); r[I_KEY] = key; r[3] = 'something';
  return r;
};

const ROME  = dayOffset(5),  CAIRO = dayOffset(9), OSLO = dayOffset(13);
const TRIPS_3 = [
  { startDate: ROME,  label: 'Rome',  daysAway: 5 },
  { startDate: CAIRO, label: 'Cairo', daysAway: 9 },
  { startDate: OSLO,  label: 'Oslo',  daysAway: 13 },
];
const line = (out, label) => (out.split('\n').find(l => l.indexOf('- ' + label + ' (') === 0) || '');

console.log('One read of each tab, however many trips');
{
  const c = harness({
    trips: TRIPS_3,
    tabs: {
      PackingItems: [pk(ROME + '|Rome'), pk(ROME + '|Rome'), pk(CAIRO + '|Cairo')],
      Itinerary:    [ik(ROME + '|Rome'), ik(CAIRO + '|Cairo'), ik(CAIRO + '|Cairo'),
                     ik(CAIRO + '|Cairo')],
    },
  });
  const out = build(c);
  check('buildPrompt did not throw', c._threw === null, c._threw);

  const packReads = c._calls.getValues.filter(t => t === 'PackingItems').length;
  const itinReads = c._calls.getValues.filter(t => t === 'Itinerary').length;
  check('three trips make ONE Packing Items read', packReads === 1,
        packReads + ' read(s) — it used to be one per trip');
  check('…and ONE Itinerary read', itinReads === 1, itinReads + ' read(s)');

  check('Rome counts 2 packing, 1 itinerary',
        /packing: 2 items, itinerary: 1 items/.test(line(out, 'Rome')),
        line(out, 'Rome') + ' — cheap is not enough; the tally has to be right');
  check('Cairo counts 1 packing, 3 itinerary',
        /packing: 1 items, itinerary: 3 items/.test(line(out, 'Cairo')), line(out, 'Cairo'));
  check('Oslo, with no rows of its own, counts nothing',
        /packing: 0 items, itinerary: 0 items/.test(line(out, 'Oslo')), line(out, 'Oslo'));

  // The alias set is resolved once per TRIP. It used to be called inside the itinerary
  // row loop, which is cheap only because tripKeysFor_ memoises — and a cost test that
  // leans on someone else's cache is not a cost test.
  check('the alias set is resolved once per trip, not once per row',
        c._calls.tripKeysFor_.length === 3,
        c._calls.tripKeysFor_.length + ' call(s) for 3 trips and 7 rows');
}

console.log('\nA row under a legacy key still counts');
{
  // The tally is keyed by the RAW cell and looked up across the alias set, because a
  // tab can hold the canonical key, an older key and a bare TRIP-… id for one trip —
  // and tripRowMatches_ counted all three. Bucketing by trip would have dropped them.
  const c = harness({
    trips: [TRIPS_3[0]],
    aliases: { [ROME + '|Rome']: [ROME + '|Rome', 'TRIP-0000000000AB', '2026-01-01|Roma'] },
    tabs: {
      PackingItems: [pk('TRIP-0000000000AB'), pk('2026-01-01|Roma'), pk(ROME + '|Rome')],
      Itinerary:    [ik('TRIP-0000000000AB'), ik('nobody/else')],
    },
  });
  const out = build(c);
  check('all three keyings of the same trip are counted once each',
        /packing: 3 items, itinerary: 1 items/.test(line(out, 'Rome')),
        line(out, 'Rome'));
  // The non-emptiness is part of the assertion: a negative match alone passes just as
  // well on a prompt that failed to build at all.
  check('…and a row belonging to no trip is not',
        line(out, 'Rome') !== '' && !/itinerary: 2 items/.test(out), line(out, 'Rome'));
  check('still one read of each tab',
        c._calls.getValues.filter(t => t === 'PackingItems').length === 1 &&
        c._calls.getValues.filter(t => t === 'Itinerary').length === 1);
}

console.log('\nBlank keys count for nobody, and whitespace still counts');
{
  // The trim is behaviour, not tidiness. The lookup this replaced trimmed the cell
  // inside tripRowMatches_, so a key typed with a trailing space has always counted —
  // and dropping the trim would silently stop a hand-edited row from matching.
  const c = harness({
    trips: [TRIPS_3[0]],
    tabs: {
      PackingItems: [pk(''), pk('   '), pk(ROME + '|Rome'), pk(' ' + ROME + '|Rome ')],
      Itinerary:    [ik(''), ik('  ' + ROME + '|Rome')],
    },
  });
  const out = build(c);
  check('blank keys are ignored, as they were before',
        /packing: 2 items/.test(line(out, 'Rome')), line(out, 'Rome'));
  check('…and a key with stray whitespace still matches its trip',
        /packing: 2 items, itinerary: 1 items/.test(line(out, 'Rome')), line(out, 'Rome'));
}

console.log('\nOne tab failing degrades one count');
{
  // The inner try/catch per read is load-bearing. A Packing-tab failure gave every trip
  // "0 items" before; letting it escape to the outer catch would render the WHOLE trips
  // section as "(unavailable)" instead — a much bigger loss than one count.
  const c = harness({
    trips: [TRIPS_3[0]],
    throwsOn: { PackingItems: true },
    tabs: {
      PackingItems: [pk(ROME + '|Rome')],
      Itinerary:    [ik(ROME + '|Rome'), ik(ROME + '|Rome')],
    },
  });
  const out = build(c);
  check('the packing count falls to 0', /packing: 0 items/.test(line(out, 'Rome')), line(out, 'Rome'));
  check('…the itinerary count survives', /itinerary: 2 items/.test(line(out, 'Rome')), line(out, 'Rome'));
  check('…and the trips section is still rendered',
        line(out, 'Rome') !== '' && !/=== UPCOMING TRIPS ===\n\(unavailable\)/.test(out),
        'a failed tab read must not cost the whole section');
  check('the ⚠ flag the count drives still fires',
        /NO PACKING LIST/.test(line(out, 'Rome')), line(out, 'Rome'));

  const c2 = harness({
    trips: [TRIPS_3[0]],
    throwsOn: { Itinerary: true },
    tabs: { PackingItems: [pk(ROME + '|Rome')], Itinerary: [ik(ROME + '|Rome')] },
  });
  const out2 = build(c2);
  check('and symmetrically, a failed Itinerary read keeps the packing count',
        /packing: 1 items, itinerary: 0 items/.test(line(out2, 'Rome')), line(out2, 'Rome'));
}

console.log('\nA dead spreadsheet still drops the whole section');
{
  const c = harness({ trips: TRIPS_3, spreadsheetThrows: true });
  const out = build(c);
  check('buildPrompt does not throw', c._threw === null, c._threw);
  check('…the trips section reads (unavailable)', /=== UPCOMING TRIPS ===\n\(unavailable\)/.test(out),
        'unchanged: an unreachable spreadsheet is not a packing-tab problem');
}

console.log('\nThe flags the counts feed');
{
  const SOON = dayOffset(3), LATER = dayOffset(12);
  const c = harness({
    trips: [
      { startDate: SOON,  label: 'Soon',  daysAway: 3 },
      { startDate: LATER, label: 'Later', daysAway: 12 },
    ],
    tabs: { PackingItems: [], Itinerary: [] },
  });
  const out = build(c);
  check('a trip 3 days out with no packing is flagged',
        /NO PACKING LIST/.test(line(out, 'Soon')), line(out, 'Soon'));
  check('…and 12 days out is not, but its itinerary is',
        !/NO PACKING LIST/.test(line(out, 'Later')) && /NO ITINERARY/.test(line(out, 'Later')),
        line(out, 'Later'));
}

console.log('\nVictoria’s trip is not Ahmed’s prep problem');
{
  const c = harness({
    trips: [{ startDate: ROME, label: 'Rome', daysAway: 5 }],
    tabs: {
      PackingItems: [],
      Itinerary:    [],
      TripMeta:     [(() => {
        const r = new Array(TRIP_META_HEADERS.length).fill('');
        r[0] = ROME + '|Rome'; r[4] = 'Victoria';
        return r;
      })()],
    },
  });
  const out = build(c);
  check('it is labelled as hers', /VICTORIA ONLY/.test(line(out, 'Rome')), line(out, 'Rome'));
  check('…and carries no missing-prep flag',
        line(out, 'Rome') !== '' &&
        !/NO PACKING LIST/.test(line(out, 'Rome')) && !/NO ITINERARY/.test(line(out, 'Rome')),
        line(out, 'Rome'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
