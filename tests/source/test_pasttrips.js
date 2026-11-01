// Issue #219: the trip gifts picker offers past trips, not only upcoming ones.
//
// webListPastTrips_ gathers ended trips from three places (the Trips registry,
// the Itinerary sheet, and trips that already have gifts), folds old keys onto
// the trip's current one, and lists them most recent first. Invented trips.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const WEB = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
const APP = fs.readFileSync(ROOT + '/docs/app.js', 'utf8');
const LITE = fs.readFileSync(ROOT + '/docs/dashboard-lite.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', src.indexOf(')', start)); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}

const TODAY = '2026-11-01';
const sheet = rows => ({ getLastRow: () => rows.length + 1,
  getRange: (r, c, n, w) => ({ getValues: () => rows.map(x => x.slice(c - 1, c - 1 + w)) }) });

function run(o) {
  const ctx = { String, Number, Object, Array, Date, JSON, Math, RegExp, isNaN, Error,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
    TABS: { ITINERARY: 'Itinerary', TRIP_GIFTS: 'Trip Gifts' }, ITINERARY_HEADERS: new Array(10).fill('x'),
    readTripRegistry_: () => ({ rows: o.registry || [] }),
    tripKeyForWrite_: k => (o.alias || {})[k] || k,
    getSpreadsheet: () => ({ getSheetByName: n => n === 'Itinerary' ? sheet(o.itin || []) : sheet(o.gifts || []) }),
  };
  // "Today" is fixed so the test does not age.
  const RealDate = Date;
  ctx.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(TODAY + 'T12:00:00Z'); } };
  vm.createContext(ctx);
  vm.runInContext(extractFn(WEB, 'webListPastTrips_'), ctx);
  return vm.runInContext('webListPastTrips_()', ctx);
}
const row = (key, date) => ['I', key, 'dining', 'x', date, '', '', '', '', ''];

console.log('\npast trips, from every place a trip lives');
{
  const r = run({
    registry: [{ status: 'active', label: 'Lake Trip', startDate: '2026-10-21', endDate: '2026-10-28' },
               { status: 'active', label: 'Island Trip', startDate: '2026-11-06', endDate: '2026-11-15' },
               { status: 'merged:TRIP-X', label: 'Old Copy', startDate: '2026-09-01', endDate: '2026-09-03' }],
    itin: [row('2026-06-19|Mountain Cruise', '2026-06-20'), row('2026-06-19|Mountain Cruise', '2026-07-04'),
           row('2026-10-23|Maybe Lake Trip', '2026-10-23'), row('', '2026-05-01')],
    alias: { '2026-10-23|Maybe Lake Trip': '2026-10-21|Lake Trip' },
    gifts: [['G1', '2025-12-20|Winter Visit']],
  });
  const keys = r.trips.map(t => t.key);
  check('a trip from the registry that has ended', keys.indexOf('2026-10-21|Lake Trip') !== -1, JSON.stringify(keys));
  check('…and one only in the Itinerary sheet, older than the registry', keys.indexOf('2026-06-19|Mountain Cruise') !== -1);
  check('…and one that only has gifts', keys.indexOf('2025-12-20|Winter Visit') !== -1);
  check('an upcoming trip is not past', keys.indexOf('2026-11-06|Island Trip') === -1);
  check('a merged registry row is not listed', !keys.some(k => /Old Copy/.test(k)));
  check('a renamed trip appears once, under its current name', keys.filter(k => /Lake Trip/.test(k)).length === 1 &&
        keys.indexOf('2026-10-23|Maybe Lake Trip') === -1, JSON.stringify(keys));
  check('most recent first', JSON.stringify(keys) === '["2026-10-21|Lake Trip","2026-06-19|Mountain Cruise","2025-12-20|Winter Visit"]',
        JSON.stringify(keys));
  const cruise = r.trips.filter(t => t.key === '2026-06-19|Mountain Cruise')[0];
  check('a sheet trip spans its rows', cruise.startDate === '2026-06-20' && cruise.endDate === '2026-07-04', JSON.stringify(cruise));
  check('the label is the trip\'s name', cruise.label === 'Mountain Cruise');
  check('rows with no trip are ignored', !keys.some(k => !k || k.indexOf('|') === -1));
}

console.log('\nthe route and the picker');
{
  check('past_trips is routed', /case 'past_trips':\s*return jsonOut_\(webListPastTrips_\(\)\)/.test(WEB));
  const panel = src => { const i = src.indexOf('function TripGiftsPanel('); let d = 0;
    for (let j = src.indexOf('{', src.indexOf(')', i)); j < src.length; j++) {
      if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1); } };
  const a = panel(APP), l = panel(LITE);
  check('both dashboards have the same panel', a === l, 'the full and lite copies differ');
  check('it asks for past trips', /api\(\{action:'past_trips'\}\)/.test(a));
  check('…and lists them under Past, after Upcoming', /label:'Upcoming'/.test(a) && /label:'Past'/.test(a) &&
        a.indexOf("label:'Upcoming'") < a.indexOf("label:'Past'"));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
