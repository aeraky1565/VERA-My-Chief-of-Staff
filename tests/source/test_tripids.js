// Issue #239, phase 1: a Trip ID column on every trip-keyed tab, kept filled.
// Pins:
//  - each of the ten tabs' header constants ends in "Trip ID" and has a "Trip Key";
//  - every fixed-width write of a whole row to those tabs ("<HEADERS>.length).setValues")
//    writes the Trip ID too. A writer that doesn't writes a row one cell short, which
//    throws in Google Sheets, and the other tests' fake sheets don't check widths. So
//    this check goes through the source, writer by writer (a writer that leaves it blank on
//    purpose says so with a "// Trip ID" comment);
//  - tidFill_: fills blanks from the key, keeps existing IDs, counts disagreements;
//  - tripIdStampAll_: writes only the Trip ID column (and a blank header cell),
//    skips a tab whose column was moved, writes nothing when nothing is blank;
//  - the nightly run fills, right after legacy keys are adopted.
// Invented trips and keys.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CODE = read('Code.js'), TID = read('TripIds.js'), TRIPS = read('Trips.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

const CONSTS = ['ITINERARY_HEADERS', 'TRIP_META_HEADERS', 'PACKING_ITEM_HEADERS', 'TRIP_BUDGET_HEADERS', 'TRIP_GIFT_HEADERS',
  'TRIP_OUTFIT_HEADERS', 'PACKING_REVIEW_HEADERS', 'LEAVE_RUN_HEADERS', 'TRIP_RECS_HEADERS', 'TRIP_DECISION_HEADERS'];

console.log('\nthe header constants');
const H = {};
{
  const ctx = {};
  vm.createContext(ctx);
  CONSTS.forEach(n => {
    const m = CODE.match(new RegExp('const ' + n + '\\s*=\\s*(\\[[^\\]]*\\]);'));
    H[n] = m ? vm.runInContext(m[1], ctx) : null;
  });
  check('all ten tabs end in "Trip ID"', CONSTS.every(n => H[n] && H[n][H[n].length - 1] === 'Trip ID'), CONSTS.filter(n => !H[n] || H[n][H[n].length - 1] !== 'Trip ID').join());
  check('…and each has a Trip Key column', CONSTS.every(n => H[n] && H[n].indexOf('Trip Key') !== -1));
  check('…and only one Trip ID', CONSTS.every(n => H[n].filter(h => h === 'Trip ID').length === 1));
  check('the fill pass covers exactly these ten', CONSTS.every(n => TID.includes('headers: ' + n + ' }')) && (TID.match(/headers: [A-Z_]+_HEADERS \}/g) || []).length === 10);
}

console.log('\nevery fixed-width row write includes the Trip ID');
{
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const enclosing = (src, at) => {
    const start = src.lastIndexOf('\nfunction ', at);
    let depth = 0, j = src.indexOf('{', start);
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
    return src.slice(start, j + 1);
  };
  const sites = [], missing = [];
  files.forEach(f => {
    const src = read(f);
    CONSTS.forEach(n => {
      const re = new RegExp(n + '\\.length\\)\\.setValues\\(([^)]*)\\)', 'g');
      let m;
      while ((m = re.exec(src))) {
        if (m[1].trim() === '[' + n + ']') continue;   // the header row itself
        const fn = enclosing(src, m.index);
        const name = (fn.match(/function (\w+)/) || [])[1];
        sites.push(f + ':' + name);
        if (!/tripIdCell_\(|\/\/ Trip ID/.test(fn)) missing.push(f + ':' + name + ' (' + n + ')');
      }
    });
  });
  check('the writers were found (' + sites.length + ')', sites.length >= 13, J(sites));
  check('…and every one writes the Trip ID', missing.length === 0, missing.join(', '));
  check('the email parser\'s new itinerary rows carry a Trip ID cell (blank until a key is assigned)', /JSON\.stringify\(metadata\),\s*\n\s*'',\s*\/\/ Trip ID/.test(read('EmailParser.js')));
  check('tripIdCell_ never throws and never writes', /function tripIdCell_\(tripKey\) \{\n\s*try \{ return tripIdForKey_\(tripKey\) \|\| ''; \} catch \(e\) \{ return ''; \}\n\}/.test(TRIPS));
}

function ctxWith(extra) {
  const c = Object.assign({ String, Array, Number, Object, JSON, Math, RegExp, Logger: { log: () => {} } }, extra || {});
  vm.createContext(c);
  vm.runInContext(TID, c);
  return c;
}

console.log('\nfilling a column');
{
  const c = ctxWith();
  const map = { '2026-11-06|Island Trip': 'TRIP-AAA', '2026-12-23|Winter Trip': 'TRIP-BBB' };
  c.__rows = [
    ['I-1', '2026-11-06|Island Trip', 'x', ''],
    ['I-2', '2026-11-06|Island Trip', 'y', ''],
    ['I-3', '2026-12-23|Winter Trip', 'z', 'TRIP-BBB'],
    ['I-4', '2026-12-23|Winter Trip', 'z', 'TRIP-OLD'],
    ['I-5', '', 'no key', ''],
    ['I-6', '2027-01-01|Not Yet', 'q', ''],
  ];
  let calls = 0;
  c.__res = k => { calls++; return map[k] || ''; };
  const r = vm.runInContext('tidFill_(__rows, 1, 3, __res)', c);
  check('blanks fill from the key', r.ids[0][0] === 'TRIP-AAA' && r.ids[1][0] === 'TRIP-AAA' && r.filled === 2, J(r));
  check('an existing ID is kept, even when its key now says otherwise (counted)', r.ids[2][0] === 'TRIP-BBB' && r.ids[3][0] === 'TRIP-OLD' && r.mismatched === 1);
  check('no key, or a key that doesn\'t resolve yet: left blank', r.ids[4][0] === '' && r.ids[5][0] === '');
  check('each key is resolved once', calls === 3, calls);
}

console.log('\nthe fill pass on the sheet');
{
  const writes = [];
  const sheet = (name, rows, opts) => {
    const grid = rows.map(r => r.slice());
    return {
      name, grid,
      getLastRow: () => grid.length,
      getRange: (r, c, nr, nc) => ({
        getValue: () => (grid[r - 1] || [])[c - 1],
        getValues: () => grid.slice(r - 1, r - 1 + nr).map(x => { const o = []; for (let i = 0; i < nc; i++) o.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return o; }),
        setValue: v => { writes.push([name, r, c, 1, 1]); grid[r - 1][c - 1] = v; },
        setValues: v => { writes.push([name, r, c, v.length, v[0].length]); v.forEach((row, i) => row.forEach((x, k) => { grid[r - 1 + i][c - 1 + k] = x; })); },
      }),
    };
  };
  const IT = ['ID', 'Trip Key', 'Type', 'Title', 'Date', 'Start Time', 'End Time', 'Location', 'Notes', 'Metadata', 'Trip ID'];
  const itin = sheet('Itinerary', [
    ['ID', 'Trip Key', 'Type', 'Title', 'Date', 'Start Time', 'End Time', 'Location', 'Notes', 'Metadata'],   // no Trip ID header yet
    ['I-1', '2026-11-06|Island Trip', 'flight', 'Out', '2026-11-06', '', '', '', '', '{}'],
    ['I-2', '2026-11-06|Island Trip', 'hotel', 'Stay', '2026-11-06', '', '', '', '', '{}', 'TRIP-AAA'],
  ]);
  const meta = sheet('TripMeta', [
    ['Trip Key', 'Context', 'Notes', 'Updated Date', 'Traveler', 'Trip Budget', 'Trip Travellers', 'Outbound Mode', 'Return Mode', 'Luggage JSON', 'Characteristics', 'Trip ID'],
    ['2026-11-06|Island Trip', '', '', '', '', '', 2, '', '', '', '', 'TRIP-AAA'],
  ]);
  const gifts = sheet('Trip Gifts', [['ID', 'Trip Key', 'Recipient', 'Item', 'Amount', 'Purchased', 'Notes', 'Kind', 'Status', 'Packs As', 'Moved by hand']]);
  const sheets = { Itinerary: itin, TripMeta: meta, 'Trip Gifts': gifts };
  const c = ctxWith({
    getSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }),
    tripIdForKey_: k => ({ '2026-11-06|Island Trip': 'TRIP-AAA' })[k] || '',
    TABS: { ITINERARY: 'Itinerary', TRIP_META: 'TripMeta', PACKING_ITEMS: 'PackingItems', TRIP_BUDGET: 'Trip Budget', TRIP_GIFTS: 'Trip Gifts',
            TRIP_OUTFITS: 'Trip Outfits', PACKING_REVIEWS: 'Packing Reviews', LEAVE_RUNS: 'Leaving Home Runs', TRIP_RECOMMENDATIONS: 'TripRecommendations', TRIP_DECISIONS: 'Trip Decisions' },
  });
  CONSTS.forEach(n => { c[n] = H[n]; });
  const r = vm.runInContext('tripIdStampAll_()', c);
  check('a blank Trip ID header cell is written', itin.grid[0][10] === 'Trip ID');
  check('a blank Trip ID fills from its key; an existing one is untouched', itin.grid[1][10] === 'TRIP-AAA' && itin.grid[2][10] === 'TRIP-AAA');
  check('only the Trip ID column is written (one write for the header, one for the column)',
        J(writes.filter(w => w[0] === 'Itinerary')) === J([['Itinerary', 1, 11, 1, 1], ['Itinerary', 2, 11, 2, 1]]), J(writes));
  check('a tab with nothing to fill gets no write', !writes.some(w => w[0] === 'TripMeta'));
  check('a tab whose last column holds something else is skipped and reported, never written',
        !writes.some(w => w[0] === 'Trip Gifts') && r.tabs.some(t => t.tab === 'Trip Gifts' && /Moved by hand/.test(t.skipped || '')), J(r.tabs));
  check('tabs that don\'t exist yet are passed over', r.tabs.length === 3, J(r.tabs));
  check('it reports what it filled', r.filled === 1, J(r));
}

console.log('\nwhen it runs');
{
  const i = CODE.indexOf("nightlyStep_(ctx, 'adoptLegacyTripKeys_'"), k = CODE.indexOf("nightlyStep_(ctx, 'tripIdStampAll_', tripIdStampAll_);");
  check('every night, right after legacy keys are adopted', i !== -1 && k > i && k - i < 400);
  check('backfillTripIds() runs the same pass by hand', /function backfillTripIds\(\) \{\s*return tripIdStampAll_\(\);\s*\}/.test(TID));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
