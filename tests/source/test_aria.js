// ARIA, read by VERA (Aria.js and the shared AriaView block): the ARIA Travel
// Tracker is read by header name (its columns can move and grow), cleaned, and
// set beside VERA's own trips to find what needs a look. The sheet is a fake;
// every trip, fare and ID here is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'Aria.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// ============ a fake ARIA Travel Tracker ============================================
// The Watchlist's columns are deliberately out of the tracker's order, with the
// as-built bracketed notes in its headers ("Ref (OPT-…)", "Est. Fees (bags/seats)")
// and a column VERA doesn't know.
const WATCH = [
  ['Label', 'Trip ID', 'Watch Status (Draft/Watching/Booked/Dropped)', 'Mystery Column', 'Origin Airports', 'Destination Airports', 'Earliest Depart', 'Latest Return',
   'Price Ceiling Per Person', 'Travelers', 'Window Tier (Too early/Weekly/Booking window/Daily)', 'Last Checked', 'Next Check', 'Best Fare Seen', 'Best Fare Source',
   'Verdict (Book now/Wait/Skip, dropdown)', 'Notes', 'Ref (OPT-…)', 'Nights Min', 'Nights Max', 'Return-From Airports', 'Date Change Flag'],
  ['Lake week', 'trip-0001', 'Watching', 'x', 'IAD', 'ORD', new Date(Date.UTC(2027, 3, 5, 12)), '2027-04-13', '$450', 2, 'Booking window', '2027-02-18', '2027-02-21', '$612', 'SlickTrip', 'Book now', 'Nonstop preferred', '', '', '', '', ''],
  ['Coast hop', 'TRIP-0002', 'watching', '', '', 'SFO', '2027-05-01', '2027-05-08', '', '2', 'Weekly', '2027-02-01', '', '', '', 'Wait', '', '', '', '', '', 'yes'],
  ['Spring idea', '', 'Scouting', '', 'IAD', 'LIS', '2027-03-01', '2027-05-31', '', '2', 'Weekly', '', '', '1240', 'SlickTrip', 'Wait', '', 'opt-abc', '7', '10', 'BCN', ''],
  ['Old plan', 'TRIP-0003', 'Dropped', '', '', '', '2027-01-02', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['Someday', 'TRIP-0004', 'Draft', '', '', '', '2027-06-10', '2027-06-14', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
];
const FARES = [
  ['Trip ID', 'Date Seen', 'Route', 'Depart', 'Return', 'Airline', 'Stops', 'Fare Per Person', 'Est. Fees (bags/seats)', 'True Total', 'vs Ceiling', 'Source', 'Verdict', 'Booking Link', 'Flags'],
  ['TRIP-0001', '2027-02-18', 'IAD-ORD', '2027-04-05', '2027-04-13', 'UA', 0, 280, 52, 612, '-', 'SlickTrip', 'Book now', 'https://fares.example/abc', ''],
  ['TRIP-0001', '2027-02-18', 'IAD-ORD', '2027-04-06', '2027-04-13', 'AA', 1, 300, 52, 652, '', 'Expedia', 'Wait', 'javascript:alert(1)', 'excl. bags; fare type unknown'],
  ['TRIP-0001', '2027-02-10', 'IAD-ORD', '2027-04-05', '2027-04-13', 'UA', 0, 320, 52, 692, '', 'SlickTrip', 'Wait', 'http://plain.example', ''],
  ['OPT-ABC', '2027-02-15', 'IAD-LIS', '2027-05-29', '2027-06-05', 'TP', 0, 590, 60, 1240, '', 'SlickTrip', 'Wait', '', 'est.'],
  ['TRIP-0002', '2026-09-01', 'IAD-SFO', '', '', '', '', 400, '', 800, '', '', '', '', ''],
  ['TRIP-0009', '2027-02-18', '', '', '', '', '', '', '', '', '', '', '', '', ''],
];
function tab(values) { return { getLastRow: () => values.length, getLastColumn: () => values[0].length, getRange: (r, c, nr, nc) => ({ getValues: () => values.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }) }; }
let props = {}, cache = {}, opens = 0, openFails = false;
const S = vm.createContext({
  console, JSON, Math, Number, String, Array, Date, Object, isFinite, parseInt,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  SpreadsheetApp: { openById: id => { opens++; if (openFails) throw new Error('no access'); return { getSheetByName: n => n === 'Watchlist' ? tab(WATCH) : n === 'Fare Log' ? tab(FARES) : null }; } },
  Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 10) },
  Logger: { log: m => { S.logs.push(String(m)); } },
  logs: [],
  TABS: { TRIP_META: 'TripMeta' }, TRIP_META_HEADERS: new Array(11).fill(''),
  TRIP_IDEAS_HEADERS: new Array(18).fill(''), TRIP_IDEA_OPTIONS_HEADERS: new Array(14).fill(''),
});
S.getSpreadsheet = () => ({ getSheetByName: () => tab([new Array(11).fill('h'), ['2027-07-01|Beach drive', '', '', '', '', '', '', 'Driving', '', '', '']]) });
S.readTripRegistry_ = () => ({ rows: [
  { tripId: 'TRIP-0001', label: 'Lake week', startDate: '2027-04-05', endDate: '2027-04-13', status: 'active', aliases: [] },
  { tripId: 'TRIP-0007', label: 'Hold for Girls Weekend', startDate: '2027-03-12', endDate: '2027-03-14', status: 'active', aliases: [] },
  { tripId: 'TRIP-0008', label: 'Hold for girls weekend', startDate: '2027-03-12', endDate: '2027-03-14', status: 'active', aliases: [] },
  { tripId: 'TRIP-0010', label: 'Beach drive', startDate: '2027-07-01', endDate: '2027-07-05', status: 'active', aliases: [] },
  { tripId: 'TRIP-0011', label: 'Last year', startDate: '2026-01-01', endDate: '2026-01-04', status: 'active', aliases: [] },
] });
S.tiRows_ = (sheet) => sheet; S.tiIdeasSheet_ = () => [['IDEA-1', 'Spring in Europe']]; S.tiOptionsSheet_ = () => [['OPT-ABC', 'IDEA-1', 'Lisbon → Algarve → cruise']];
vm.runInContext(SRC, S);
const run = code => vm.runInContext(code, S);

console.log('reading by header name');
{
  S.dateText = v => v instanceof Date ? v.toISOString().slice(0, 10) : v;
  S.WATCHV = WATCH; S.FARESV = FARES;
  const w = run('ariaReadRows_(WATCHV, ARIA_WATCH_FIELDS_, dateText)');
  check('every row with something in it is read; a blank row is not', w.length === 5, w.length);
  check('columns are found by name, in any order', w[0].label === 'Lake week' && w[0].origins === 'IAD' && w[0].dests === 'ORD');
  check('a header\'s bracketed note doesn\'t hide it', w[0].status === 'watching' && w[0].tier === 'Booking window', JSON.stringify([w[0].status, w[0].tier]));
  check('a Date cell and a text date both read as yyyy-MM-dd', w[0].earliest === '2027-04-05' && w[0].latest === '2027-04-13');
  check('money reads as a number, whatever it was typed as', w[0].ceiling === 450 && w[0].bestFare === 612 && w[2].bestFare === 1240);
  check('no figure is null, not zero', w[1].ceiling === null && w[1].bestFare === null);
  check('IDs read upper case, so they match VERA\'s', w[0].tripId === 'TRIP-0001' && w[2].ref === 'OPT-ABC');
  check('statuses and verdicts read in any case', w[1].status === 'watching' && w[0].verdict === 'book' && w[1].verdict === 'wait');
  check('the date-change flag is yes or no', w[1].dateChange === true && w[0].dateChange === false);
  check('nights and travelers are numbers', w[2].nightsMin === 7 && w[2].nightsMax === 10 && w[0].travelers === 2);
  check('a column VERA doesn\'t know is left alone', !('mysteryColumn' in w[0]) && !Object.values(w[0]).includes('x'));
  const f = run('ariaReadRows_(FARESV, ARIA_FARE_FIELDS_, dateText)');
  check('a Fare Log row with no fare is dropped', f.length === 5 && !f.some(x => x.tripId === 'TRIP-0009'), f.length);
  check('flags read as a list', JSON.stringify(f[1].flags) === '["excl. bags","fare type unknown"]', JSON.stringify(f[1].flags));
  check('a booking link must be https: a javascript: link and a plain http one are dropped', f[0].link === 'https://fares.example/abc' && f[1].link === '' && f[2].link === '');
  check('nonstop reads as 0, not blank', String(f[0].stops) === '0');
  check('the as-built headers with notes are read: Ref (OPT-…), Est. Fees (bags/seats), Verdict (…)', w[2].ref === 'OPT-ABC' && f[0].fees === 52 && w[1].verdict === 'wait');
}

console.log('\nwhat needs a look');
{
  S.w = run('ariaReadRows_(WATCHV, ARIA_WATCH_FIELDS_, dateText)'); S.f = run('ariaReadRows_(FARESV, ARIA_FARE_FIELDS_, dateText)');
  S.vt = [{ tripId: 'TRIP-0001', label: 'Lake week', startDate: '2027-04-05' }, { tripId: 'TRIP-0007', label: 'Hold for Girls Weekend', startDate: '2027-03-12' },
    { tripId: 'TRIP-0008', label: 'Hold for girls weekend', startDate: '2027-03-12' }, { tripId: 'TRIP-0010', label: 'Beach drive', startDate: '2027-07-01', drive: true },
    { tripId: 'TRIP-0099', label: 'Spring idea', startDate: '2027-03-01' }];
  S.rq = [{ ref: 'OPT-NEW', label: 'Japan', status: 'active', created: '2027-02-10T09:00:00Z' }, { ref: 'OPT-ABC', label: 'Spring', status: 'active', created: '2027-02-01T09:00:00Z' },
    { ref: 'OPT-OLD', label: 'Old', status: 'withdrawn', created: '2027-01-01T09:00:00Z' }, { ref: 'OPT-FRESH', label: 'Fresh', status: 'active', created: '2027-02-19T09:00:00Z' }];
  const g = run('ariaGaps_(vt, w, f, rq, "2027-02-20")');
  check('a VERA trip ARIA has no row for is listed', g.noRow.length === 1 && g.noRow[0].id === 'TRIP-0007', JSON.stringify(g.noRow));
  check('…a duplicated calendar hold counts once', g.noRow.filter(x => /girls/i.test(x.label)).length === 1);
  check('…a trip you drive to needs no fares', !g.noRow.some(x => x.id === 'TRIP-0010'));
  check('…and a row matched by label and start counts as watched', !g.noRow.some(x => x.id === 'TRIP-0099'));
  check('drafts are listed', g.draft.length === 1 && g.draft[0].id === 'TRIP-0004');
  check('a Watching row with no airports or ceiling says what is missing', g.incomplete.length === 1 && /origin airports, a price ceiling/.test(g.incomplete[0].why), JSON.stringify(g.incomplete));
  check('a Watching row with no fare for a week is stale; one priced this week is not', g.stale.length === 1 && g.stale[0].id === 'TRIP-0002' && /since 2026-09-01/.test(g.stale[0].why), JSON.stringify(g.stale));
  check('a changed date is listed', g.dateChanged.length === 1 && g.dateChanged[0].id === 'TRIP-0002');
  check('a request ARIA hasn\'t picked up in 2 days is listed; a picked-up, withdrawn or fresh one is not', g.waiting.length === 1 && g.waiting[0].id === 'OPT-NEW', JSON.stringify(g.waiting));
  check('the count adds them up', g.count === 6, g.count);
  S.w2 = S.w.map(x => Object.assign({}, x, { tier: x.tripId === 'TRIP-0002' ? 'Too early' : x.tier }));
  S.w3 = [{ tripId: 'TRIP-0005', label: 'Ready but unpriced', status: 'watching', origins: 'IAD', dests: 'ORD', ceiling: null, tier: 'Weekly' }];
  const g3 = run('ariaGaps_([], w3, [], [], "2027-02-20")');
  check('…and a row with airports but no ceiling is listed too', g3.incomplete.length === 1 && /Missing a price ceiling/.test(g3.incomplete[0].why), JSON.stringify(g3.incomplete));
  check('a trip too early to price is not stale', run('ariaGaps_(vt, w2, f, [], "2027-02-20")').stale.length === 0);
  const rf = run('ariaRecentFares_(f, "2027-02-20")');
  check('the dashboard gets the last 90 days of fares, newest first', rf.length === 4 && rf[0].dateSeen === '2027-02-18' && !rf.some(x => x.dateSeen === '2026-09-01'), rf.map(x => x.dateSeen).join());
}

console.log('\nthe endpoint');
{
  check('with no sheet ID it says so, and opens nothing', JSON.stringify(run('webAriaStatus_({})')) === '{"ok":true,"configured":false}' && opens === 0);
  props.ARIA_SHEET_ID = 'sheet-test-id'; openFails = true;
  const bad = run('webAriaStatus_({})');
  check('a sheet it can\'t open says what to check', bad.ok === false && /ARIA_SHEET_ID/.test(bad.error) && /shared with the account/.test(bad.error));
  openFails = false; S.Date = class extends Date { constructor(...a) { if (a.length) super(...a); else super('2027-02-20T12:00:00Z'); } static UTC(...a) { return Date.UTC(...a); } };
  vm.runInContext('Date = this.Date', S);
  const r = run('webAriaStatus_({})');
  check('it reads the Watchlist and the Fare Log', r.ok && r.configured && r.watchlist.length === 5 && r.fares.length === 4, JSON.stringify(r).slice(0, 200));
  check('VERA\'s future trips are set beside them; past ones and drives are not', r.gaps.noRow.map(x => x.id).join() === 'TRIP-0007', JSON.stringify(r.gaps.noRow));
  check('scouted rows carry the idea and option they came from', r.ideas['OPT-ABC'].idea === 'Spring in Europe' && r.ideas['OPT-ABC'].option === 'Lisbon → Algarve → cruise');
  const n = opens; run('webAriaStatus_({})');
  check('a second read within ten minutes comes from the cache', opens === n);
  run('webAriaStatus_({ refresh: "1" })');
  check('…unless asked to read again', opens === n + 1);
  check('the log holds counts only, no names or fares', S.logs.every(l => !/Lake|Coast|612|IAD/.test(l)), S.logs.join(' | '));
  check('nothing here writes to ARIA\'s sheet', !/\.(setValue|setValues|appendRow|deleteRow|insertSheet|clear)\(/.test(SRC));
  check('the sheet ID is never in the code', !/1[A-Za-z0-9_-]{40,}/.test(SRC));
}

// ============ the dashboard block ===================================================
const block = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); return i === -1 || j === -1 ? '' : s.slice(i, j + b.length); };
const TS = '// ---- TripIdeasView (Trip Ideas) — SHARED VERBATIM', TE = '// ---- /TripIdeasView ----';
const AS = '// ---- AriaView (ARIA) — SHARED VERBATIM', AE = '// ---- /AriaView ----';
const A = block(APP, AS, AE), L = block(LITE, AS, AE);
console.log('\nthe shared block');
check('both dashboards carry it', A.length > 1000 && L.length > 1000);
check('…word for word', A === L);
const C = vm.createContext({ console, React: { createElement: () => null, useState: v => [typeof v === 'function' ? v() : v, () => {}], useEffect: () => {} } });
vm.runInContext(block(APP, TS, TE) + '\n' + A, C);
const cr = code => vm.runInContext(code, C);
{
  C.fares = [{ tripId: 'TRIP-1', dateSeen: '2027-02-10', total: 690 }, { tripId: 'TRIP-1', dateSeen: '2027-02-10', total: 700 }, { tripId: 'OPT-9', dateSeen: '2027-02-12', total: 650, flags: [] },
    { tripId: 'TRIP-1', dateSeen: '2027-02-18', total: 612, flags: [] }, { tripId: 'TRIP-1', dateSeen: '2027-02-18', total: 652, flags: ['excl. bags'] }, { tripId: 'TRIP-2', dateSeen: '2027-02-19', total: 10 }];
  C.row = { tripId: 'TRIP-1', ref: 'OPT-9' };
  check('a row\'s fares include the ones from when it was scouted', cr('ariaFaresFor_(fares, row).length') === 5);
  check('the line is the cheapest fare of each day, oldest first', JSON.stringify(cr('ariaHistory_(ariaFaresFor_(fares, row)).map(function(p){return p.value;})')) === '[690,650,612]');
  check('the card leads with the best fare of the latest day', cr('ariaLatest_(ariaFaresFor_(fares, row)).total') === 612);
  check('a flagged fare is not firm', cr('ariaFirm_({flags:["excl. bags"]})') === false && cr('ariaFirm_({flags:[]})') === true && cr('ariaFirm_(null)') === false);
  C.ws = [{ status: 'watching', earliest: '2027-05-01' }, { status: 'watching', earliest: '2027-04-01' }, { status: 'scouting', ref: 'OPT-9' }, { status: 'scouting', ref: 'OPT-X' }, { status: 'dropped' }, { status: 'other' }];
  const g = cr('ariaGroup_(ws, {"OPT-9": {idea: "Spring in Europe"}})');
  check('rows group by status, soonest first; scouted ones under their idea', g.watching[0].earliest === '2027-04-01' && g.scouting['Spring in Europe'].length === 1 && g.scouting['Scouted'].length === 1 && g.dropped.length === 1 && g.other.length === 1, JSON.stringify(Object.keys(g.scouting)));
  check('a scouted row reads as its window and nights', cr('ariaWhen_({status:"scouting",earliest:"2027-03-01",latest:"2027-05-31",nightsMin:7,nightsMax:10})') === 'Leaving Mar 1 – May 31 · 7–10 nights', cr('ariaWhen_({status:"scouting",earliest:"2027-03-01",latest:"2027-05-31",nightsMin:7,nightsMax:10})'));
  check('fares read in whole dollars', cr('ariaUsd_(1240)') === '$1,240' && cr('ariaUsd_(612.4)') === '$612');
  check('a watched row reads as its dates', cr('ariaWhen_({status:"watching",earliest:"2027-04-05",latest:"2027-04-13"})') === 'Mon, Apr 5 → Tue, Apr 13');
}

console.log('\nwiring');
check('the route is wired', /case 'aria_status':\s+return jsonOut_\(webAriaStatus_\(e\.parameter\)\);/.test(WEB));
check('full: ARIA is a Travel tab, and renders the view', /\{id:'aria',label:'🧭 ARIA'/.test(APP) && /sub==='aria'&&\/\*#__PURE__\*\/React\.createElement\(AriaView,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
check('lite: ARIA is a Travel tab, and renders the view', /\['aria','🧭 ARIA'\]/.test(LITE) && /\{travSub === 'aria' && <AriaView apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>\}/.test(LITE));
check('index.html carries the block, not a stale build', fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8').indexOf('function AriaView(') !== -1);
check('the dashboard opens a fare link safely', /rel:'noopener noreferrer'/.test(A));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
