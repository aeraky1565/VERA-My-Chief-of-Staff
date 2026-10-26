// ARIA, read by VERA (Aria.js and the shared AriaView block): the ARIA Travel
// Tracker is read by header name (its columns can move and grow), cleaned, and
// set beside VERA's own trips to find what needs a look. The sheet is a fake;
// every trip, fare and ID here is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'Aria.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
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
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  SpreadsheetApp: { openById: id => { opens++; if (openFails) throw new Error('no access'); return { getSheetByName: n => n === 'Watchlist' ? tab(WATCH) : n === 'Fare Log' ? tab(FARES) : null }; } },
  Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 10) },
  Logger: { log: m => { S.logs.push(String(m)); } },
  logs: [],
  TABS: { TRIP_META: 'TripMeta', ARIA_REQUESTS: 'ARIA Requests' }, TRIP_META_HEADERS: new Array(11).fill(''),
  TRIP_IDEAS_HEADERS: new Array(18).fill(''), ARIA_REQUESTS_HEADERS: ['Request ID', 'Kind', 'Ref', 'Trip ID', 'Trip Key', 'Label', 'Origin Airports', 'Destination Airports', 'Return-From Airports', 'Earliest Depart', 'Latest Return', 'Nights Min', 'Nights Max', 'Travelers', 'Bags', 'Ceiling Per Person', 'Status', 'Created', 'Updated', 'Flex Days'], TRIP_IDEA_OPTIONS_HEADERS: new Array(14).fill(''),
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
  S.vtNow = [{ tripId: 'TRIP-NOW', label: 'Under way', startDate: '2027-02-18' }, { tripId: 'TRIP-TODAY', label: 'Leaves today', startDate: '2027-02-20' }, { tripId: 'TRIP-SOON', label: 'Soon', startDate: '2027-02-21' }];
  check('a trip already under way (or leaving today) is not "ARIA isn\'t watching"', run('ariaGaps_(vtNow, [], [], [], "2027-02-20").noRow.map(function(x){return x.id;}).join()') === 'TRIP-SOON');
  check('a draft says how to watch it from VERA', /use Watch with ARIA on its card below/.test(g.draft[0].why));
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
  const nc0 = run('webAriaStatus_({})');
  check('with no sheet ID it says so, and opens nothing', nc0.ok === true && nc0.configured === false && Array.isArray(nc0.requests) && opens === 0);
  props.ARIA_SHEET_ID = 'InventedTrackerId_0123456789'; openFails = true;
  const bad = run('webAriaStatus_({})');
  check('a sheet it can\'t open says what to check', bad.ok === false && /roster_link_aria/.test(bad.error) && /shared with the account/.test(bad.error));
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
  const ariaPart = SRC.slice(0, SRC.indexOf('// ---- ARIA Requests'));
  check('nothing that reads ARIA\'s sheet writes anything', ariaPart.length > 1000 && !/\.(setValue|setValues|appendRow|deleteRow|insertSheet|clear)\(/.test(ariaPart));
  check('the sheet ID is never in the code', !/1[A-Za-z0-9_-]{40,}/.test(SRC));
  check('a link or a bare ID both give the sheet ID; anything else gives none', run('ariaSheetIdFrom_("https://docs.google.com/spreadsheets/d/InventedAriaTracker_0123456789/edit#gid=0")') === 'InventedAriaTracker_0123456789'
    && run('ariaSheetIdFrom_(" InventedAriaTracker_0123456789 ")') === 'InventedAriaTracker_0123456789' && run('ariaSheetIdFrom_("https://example.test/x")') === '' && run('ariaSheetIdFrom_("")') === '');
  const keepProp = props.ARIA_SHEET_ID; delete props.ARIA_SHEET_ID;
  S.getConfigValues = () => ({ roster_link_aria: 'https://docs.google.com/spreadsheets/d/InventedAriaTracker_0123456789/edit' });
  check('with no Script Property, the Config tab\'s roster_link_aria is used', run('ariaSheetId_()') === 'InventedAriaTracker_0123456789');
  props.ARIA_SHEET_ID = 'InventedOverride_abcdefghij0123';
  check('…and a Script Property, when set, wins', run('ariaSheetId_()') === 'InventedOverride_abcdefghij0123');
  S.getConfigValues = () => ({}); props.ARIA_SHEET_ID = keepProp;
}

console.log('\nasking ARIA to scout an option');
{
  S.idea = { id: 'IDEA-1', title: 'Spring in Europe', status: 'shortlisted', months: ['2027-05', '2027-03', '2027-04'], nightsMin: 7, nightsMax: 10, travelers: '2 adults' };
  S.opt = { id: 'opt-abc', ideaId: 'IDEA-1', name: 'Lisbon → Algarve → cruise', flag: 'star', cost: { flights: { low: 1400, high: 1800 } },
    legs: [{ kind: 'move', mode: 'fly', from: 'Home', to: 'lis' }, { kind: 'stop', place: 'Lisbon', nights: 6 }, { kind: 'move', mode: 'car', from: 'Lisbon', to: 'Lagos' },
      { kind: 'stop', place: 'Cruise', nights: 7 }, { kind: 'move', mode: 'fly', from: 'BCN', to: 'Home' }] };
  const r = run('ariaRequestFromOption_(idea, opt, "IAD, DCA, BWI")');
  check('the first flight\'s end is where to fly; "Home" means the home airports', r.origins === 'IAD, DCA, BWI' && r.dests === 'LIS', JSON.stringify(r));
  check('…flying home from somewhere else is an open jaw', r.returnFrom === 'BCN');
  check('the window is the idea\'s months, first day to last', r.earliest === '2027-03-01' && r.latest === '2027-05-31');
  check('the nights are the brief\'s range', r.nightsMin === 7 && r.nightsMax === 10);
  check('the ceiling per person is the flights estimate\'s high end, shared', r.travelers === 2 && r.ceiling === 900);
  check('it is a scout request, keyed by the option, upper case', r.kind === 'scout' && r.ref === 'OPT-ABC' && r.label === 'Spring in Europe · Lisbon → Algarve → cruise');
  S.opt2 = Object.assign({}, S.opt, { legs: [{ kind: 'move', mode: 'fly', from: 'IAD', to: 'NCE' }, { kind: 'stop', place: 'Nice', nights: 5 }, { kind: 'move', mode: 'fly', from: 'NCE', to: 'IAD' }], cost: {} });
  S.idea2 = Object.assign({}, S.idea, { nightsMin: null, nightsMax: null, travelers: 'the two of us' });
  const r2 = run('ariaRequestFromOption_(idea2, opt2, "IAD")');
  check('a round trip has no return-from; the route\'s own nights stand in for the brief\'s', r2.returnFrom === '' && r2.origins === 'IAD' && r2.nightsMin === 5 && r2.nightsMax === 5, JSON.stringify(r2));
  check('no traveler count or flights estimate: no ceiling, not a guess', r2.travelers === null && r2.ceiling === null);
  check('an option with no flights can\'t be scouted', /no flights/.test(run('ariaRequestFromOption_(idea, {legs:[{kind:"move",mode:"train",from:"A",to:"B"}]}, "IAD")').error));
  check('…nor an idea with no months', /Pick the months/.test(run('ariaRequestFromOption_(Object.assign({}, idea, {months: []}), opt, "IAD")').error));

  // The endpoints, over VERA's own fake sheet
  const ARQ = [run('ARIA_REQUESTS_HEADERS').slice()];
  const rqTab = { getLastRow: () => ARQ.length, getRange: (r, c, nr, nc) => ({ getValues: () => ARQ.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)), setValues: v => v.forEach((x, i) => { ARQ[r - 1 + i] = x.slice(); }) }), appendRow: v => ARQ.push(v.slice()) };
  S.getSpreadsheet = () => ({ getSheetByName: n => n === 'ARIA Requests' ? rqTab : null });
  S.ensureSheet = (ss, n) => n === 'ARIA Requests' ? rqTab : null;
  S.getConfigValues = () => ({});
  S.tiSchema_ = sh => sh;   S.tiLocked_ = fn => fn(); S.tiNow_ = () => '2027-02-20T12:00:00.000Z'; let mint = 0; S.tiMintId_ = p => p + (++mint);
  S.dateCellToIso_ = v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').trim();
  const opts = { 'OPT-ABC': S.opt };
  S.ariaIdeaOption_ = (i, o) => (S.ideasById[i] && opts[o.toUpperCase()]) ? { idea: S.ideasById[i], option: opts[o.toUpperCase()] } : null;
  S.ideasById = { 'IDEA-1': S.idea };
  cache[run('ARIA_CACHE_KEY_')] = 'stale';
  const a = run('webSaveAriaRequest_({ ideaId: "IDEA-1", optionId: "OPT-ABC" })');
  check('a starred option of a shortlisted idea is asked for', a.ok && ARQ.length === 2 && ARQ[1][1] === 'scout' && ARQ[1][2] === 'OPT-ABC' && ARQ[1][16] === 'Active', JSON.stringify(ARQ[1]));
  check('…with the home airports from VERA\'s default when Config has none', ARQ[1][6] === 'IAD, DCA, BWI');
  check('…and the next status read is fresh', !cache[run('ARIA_CACHE_KEY_')]);
  S.opt.cost = { flights: { low: 1000, high: 1200 } };
  run('webSaveAriaRequest_({ ideaId: "IDEA-1", optionId: "OPT-ABC" })');
  check('asking again refreshes the one request, not a second', ARQ.length === 2 && ARQ[1][15] === 600 && ARQ[1][0] === 'REQ-1', JSON.stringify(ARQ[1]));
  ['OPT-B', 'OPT-C', 'OPT-D'].forEach(id => { opts[id] = Object.assign({}, S.opt, { id }); });
  run('webSaveAriaRequest_({ ideaId: "IDEA-1", optionId: "OPT-B" })'); run('webSaveAriaRequest_({ ideaId: "IDEA-1", optionId: "OPT-C" })');
  const capped = run('webSaveAriaRequest_({ ideaId: "IDEA-1", optionId: "OPT-D" })');
  check('no more than three scouted at once', capped.ok === false && /already scouting 3/.test(capped.error) && ARQ.length === 4, ARQ.length);
  check('…refreshing one of the three is still fine', run('webSaveAriaRequest_({ ideaId: "IDEA-1", optionId: "OPT-B" })').ok === true);
  const w = run('webWithdrawAriaRequest_({ ref: "opt-c" })');
  check('stopping a scout withdraws it; ARIA drops its row', w.ok && ARQ[3][16] === 'Withdrawn');
  check('…which frees a place', run('webSaveAriaRequest_({ ideaId: "IDEA-1", optionId: "OPT-D" })').ok === true && ARQ.length === 5);
  check('…and a withdrawn one can be asked for again, reusing its row', run('webWithdrawAriaRequest_({ ref: "OPT-D" })').ok && run('webSaveAriaRequest_({ ideaId: "IDEA-1", optionId: "OPT-C" })').ok && ARQ[3][16] === 'Active' && ARQ.length === 5);
  check('stopping what isn\'t scouted says so', run('webWithdrawAriaRequest_({ ref: "OPT-ZZZ" })').ok === false);
  S.idea.status = 'brainstorming';
  check('an idea not yet shortlisted is refused, with why', /Shortlist the idea first/.test(run('webSaveAriaRequest_({ ideaId: "IDEA-1", optionId: "OPT-ABC" })').error));
  S.idea.status = 'shortlisted'; S.opt.flag = '';
  check('…and so is an option not starred', /Star this option first/.test(run('webSaveAriaRequest_({ ideaId: "IDEA-1", optionId: "OPT-ABC" })').error));
  S.opt.flag = 'star';
  check('…and an option that doesn\'t exist', run('webSaveAriaRequest_({ ideaId: "IDEA-1", optionId: "OPT-NOPE" })').ok === false);
  ARQ[1][9] = new Date(Date.UTC(2027, 2, 1)); ARQ[1][15] = '$600';
  const rq = run('ariaReadRequests_()');
  check('Status is written as ARIA\'s contract spells it, and read back in any case', ARQ[1][16] === 'Active' && run('ariaRequestFromRow_(' + JSON.stringify(ARQ[1]) + ').status') === 'active' && run('ariaRequestFromRow_(["x","scout","OPT-1","","","","","","","","","","","","","","BOOKED"]).status') === 'booked');
  check('requests read back, a date cell and a money cell included', rq.length === 4 && rq[0].earliest === '2027-03-01' && rq[0].ceiling === 600 && rq[0].ref === 'OPT-ABC', JSON.stringify(rq[0]));
  delete props.ARIA_SHEET_ID;
  const nc = run('webAriaStatus_({})');
  check('with ARIA\'s sheet not connected, the requests still show', nc.configured === false && nc.requests.length === 4);
  const before = ARQ.map(r => r.slice());
  const nw = run('ariaWatchSettled_("opt-abc", { tripId: "TRIP-SET1", label: "Spring in Europe", startDate: "2027-05-29", endDate: "2027-06-11" })');
  const wr = ARQ.find(r => r[2] === 'OPT-ABC');
  check('settling turns the option\'s scout request into a watch request for the real trip', nw === 1 && wr[1] === 'watch' && wr[3] === 'TRIP-SET1' && wr[4] === '2027-05-29|Spring in Europe' && wr[9] === '2027-05-29' && wr[10] === '2027-06-11', JSON.stringify(wr));
  check('…keeping its Ref and its airports, so ARIA moves its row over with the fare history', wr[2] === 'OPT-ABC' && wr[7] === 'LIS' && wr[16] === 'Active');
  check('…and touches no other request', ARQ.filter(r => r[2] !== 'OPT-ABC').every(r => JSON.stringify(r) === JSON.stringify(before.find(b => b[0] === r[0]))));
  check('an option never scouted has no request to change', run('ariaWatchSettled_("OPT-NEVER", { tripId: "T", label: "x", startDate: "2027-01-01", endDate: "2027-01-02" })') === 0);
  S.vtS = [{ tripId: 'TRIP-SET1', label: 'Spring in Europe', startDate: '2027-05-29' }];
  S.rqS = [{ ref: 'OPT-ABC', kind: 'watch', tripId: 'TRIP-SET1', status: 'active', created: '2027-02-20T00:00:00Z' }];
  check('while ARIA catches up, a trip a request names is not "ARIA has no row"', run('ariaGaps_(vtS, [], [], rqS, "2027-02-20")').noRow.length === 0 && run('ariaGaps_(vtS, [], [], [], "2027-02-20")').noRow.length === 1);
  check('requests are written only to VERA\'s own tab', !/openById\([^)]*\)\.[^;]*(appendRow|setValues)/.test(SRC) && /function ariaRequestsSheet_\(\) \{ return tiSchema_\(ensureSheet\(getSpreadsheet\(\), TABS\.ARIA_REQUESTS/.test(SRC));
}

console.log('\nv3.1: actions, the Run Log, run health and the Book now email');
{
  const WH = ['Trip ID', 'Label', 'Watch Status', 'Earliest Depart', 'Latest Return', 'Best Fare Seen', 'Best Fare Source', 'Verdict', 'Price Ceiling Per Person', 'Origin Airports', 'Destination Airports',
    'Action Needed', 'Action Type', 'Action Urgency', 'Action Key', 'Action Since', 'Best Fare Link'];
  S.WV = [WH,
    ['TRIP-0001', 'Chicago Trip', 'Watching', '2027-04-05', '2027-04-13', 704, 'Expedia', 'Book now', 360, 'IAD', 'ORD', 'Book now: $704 on UA 2027-04-05–2027-04-13', 'book_now', 'high', 'ARIA|TRIP-0001|BOOK_NOW', '2027-02-18', 'https://fares.example/x'],
    ['TRIP-0002', 'Coast hop', 'Watching', '2027-05-01', '2027-05-08', '', '', '', '', '', 'SFO', 'Needs airports', 'NEEDS_AIRPORTS', '', 'ARIA|TRIP-0002|NEEDS_AIRPORTS', '2027-02-10', 'javascript:x'],
    ['TRIP-0003', 'Old plan', 'Draft', '2027-06-01', '', '', '', '', '', '', '', 'Date changed: check trip', 'DATE_CHANGED', 'Medium', 'ARIA|TRIP-0003|DATE_CHANGED', '2027-02-19', ''],
    ['TRIP-0004', 'Quiet', 'Watching', '2027-07-01', '', '', '', 'Wait', 400, 'IAD', 'LAX', '', '', '', '', '', ''],
    ['TRIP-0005', 'Odd', 'Watching', '2027-08-01', '', '', '', '', '', '', '', 'Something', 'TELEPORT', 'High', 'ARIA|TRIP-0005|TELEPORT', '', '']];
  const w = run('ariaReadRows_(WV, ARIA_WATCH_FIELDS_, dateText)');
  check('an action reads with its type, urgency, key, since and link', w[0].actionType === 'BOOK_NOW' && w[0].actionUrgency === 'High' && w[0].actionKey === 'ARIA|TRIP-0001|BOOK_NOW' && w[0].actionSince === '2027-02-18' && w[0].bestLink === 'https://fares.example/x', JSON.stringify(w[0]));
  check('…a blank urgency takes the type\'s own, and a bad link is dropped', w[1].actionUrgency === 'Low' && w[1].bestLink === '');
  check('an unknown action type is no action', w[4].actionType === '' && w[4].actionKey === '');
  S.RL = [['Run Time (UTC)', 'Status (OK / Partial / Failed)', 'Trips Synced', 'Rows Priced', 'Searches Used', 'Book Now', 'Action Needed', 'Failures', 'Notes', 'Run ID', 'Email Sent'],
    ['2027-02-18 11:52', 'OK', 3, 2, 6, 1, 2, '', '', 'ARIA-RUN-20270218-1152', 'Sent (1 trips)'],
    ['2027-02-20 11:52', 'Partial', 3, 1, 4, 0, 2, 'Expedia timed out', '', 'ARIA-RUN-20270220-1152', 'None'],
    ['2027-02-19 11:52', 'ok', 3, 2, 6, 0, 2, '', '', 'ARIA-RUN-20270219-1152', 'Draft (send failed: quota)'],
    ['', '', '', '', '', '', '', '', '', '', '']];
  const runs = run('ariaReadRows_(RL, ARIA_RUN_FIELDS_, null)');
  S.runs = runs;
  check('the Run Log reads by header, its times as UTC', runs.length === 3 && runs[0].runTime === '2027-02-18T11:52:00.000Z' && runs[0].status === 'OK' && runs[2].status === 'OK' && runs[0].bookNow === 1, JSON.stringify(runs[0]));
  check('the newest run is the latest Run Time, not the last row', run('ariaLatestRun_(runs).runId') === 'ARIA-RUN-20270220-1152');
  S.SET = [['WHERE YOU FLY FROM', ''], ['home_airports', 'IAD, DCA, BWI'], ['RUN STATUS (written by ARIA)', ''], ['last_run_utc', '2027-02-20T11:52:00Z'], ['last_run_status', 'Partial: Expedia timed out'], ['book_now_email', true], ['', 'x']];
  const set = run('ariaSettings_(SET)');
  check('Settings read by key; section titles are not settings', set.home_airports === 'IAD, DCA, BWI' && set.last_run_status === 'Partial: Expedia timed out' && set.book_now_email === 'true' && !('where you fly from' in set), JSON.stringify(set));
  S.set = set;
  const hp = run('ariaRunHealth_(runs, set, "2027-02-20T15:00:00Z")');
  check('a partial run (status plus reason) is amber, with what failed', hp.level === 'partial' && /Expedia timed out/.test(hp.text) && /ARIA-RUN-20270220-1152/.test(hp.text), JSON.stringify(hp));
  check('a failed run is red', run('ariaRunHealth_([], {last_run_utc:"2027-02-20T11:52:00Z", last_run_status:"Failed: Sheets error"}, "2027-02-20T15:00:00Z").level') === 'failed');
  check('an OK run is green', run('ariaRunHealth_([], {last_run_utc:"2027-02-20T11:52:00Z", last_run_status:"OK"}, "2027-02-20T15:00:00Z").level') === 'ok');
  check('no run in 26 hours: ARIA did not run', run('ariaRunHealth_([], {last_run_utc:"2027-02-19T11:52:00Z", last_run_status:"OK"}, "2027-02-20T15:00:00Z").level') === 'stale');
  check('…and no run logged at all is the same', run('ariaRunHealth_([], {}, "2027-02-20T15:00:00Z").level') === 'stale');
  check('email states read from the Run Log words', run('[ariaEmailState_("Sent (2 trips)"), ariaEmailState_("Draft (send failed: x)"), ariaEmailState_("Failed: x"), ariaEmailState_("None"), ariaEmailState_("")].join()') === 'sent,failed,failed,none,none');
  S.w = w;
  const e = run('ariaEmailFor_(w[0], runs)');
  check('the Book now card knows the email went out the morning it began', e && e.state === 'sent' && e.date === '2027-02-18', JSON.stringify(e));
  S.w0b = Object.assign({}, w[0], { actionSince: '2027-02-19' });
  check('…or that it failed', run('ariaEmailFor_(w0b, runs).state') === 'failed');
  S.w0c = Object.assign({}, w[0], { actionSince: '2027-02-20' });
  check('…and says nothing when that run sent none', run('ariaEmailFor_(w0c, runs)') === null);

  const want = run('ariaWantedFlags_(w, runs, set, "2027-02-20T15:00:00Z")');
  const bk = want['ARIA|TRIP-0001|BOOK_NOW'];
  check('a trip action becomes a flag keyed by its Action Key, worded as ARIA said it', bk && bk.flag === 'Book now: $704 on UA 2027-04-05–2027-04-13' && bk.urgency === 'High' && bk.date === '2027-02-18', JSON.stringify(bk));
  check('…its reason in the agreed shape', bk.reason === 'Chicago Trip (2027-04-05–2027-04-13): Book now: $704 on UA 2027-04-05–2027-04-13. Verdict Book now, best $704.', bk.reason);
  check('a Draft row\'s date change is a flag too', want['ARIA|TRIP-0003|DATE_CHANGED'] && want['ARIA|TRIP-0003|DATE_CHANGED'].urgency === 'Medium');
  check('a row with no action, or an unknown one, raises nothing', !Object.keys(want).some(k => /TRIP-0004|TRIP-0005/.test(k)));
  check('a partial run raises the rolling health flag, Medium', want['ARIA|RUN_HEALTH'] && want['ARIA|RUN_HEALTH'].flag === 'ARIA run partially failed' && want['ARIA|RUN_HEALTH'].urgency === 'Medium');
  check('the latest run sent no email, so no email flag', !Object.keys(want).some(k => /EMAIL_FAILED/.test(k)));
  S.runs2 = runs.concat([{ runTime: '2027-02-21T11:52:00.000Z', status: 'OK', runId: 'ARIA-RUN-20270221-1152', emailSent: 'Failed: auth' }]);
  const want2 = run('ariaWantedFlags_(w, runs2, {}, "2027-02-21T13:00:00Z")');
  check('a Book now email that didn\'t send raises its own flag, by run', want2['ARIA|EMAIL_FAILED|ARIA-RUN-20270221-1152'] && want2['ARIA|EMAIL_FAILED|ARIA-RUN-20270221-1152'].reason === 'Failed: auth' && want2['ARIA|EMAIL_FAILED|ARIA-RUN-20270221-1152'].urgency === 'Medium');
  check('…and an OK, fresh run raises no health flag', !want2['ARIA|RUN_HEALTH']);
  S.wbad = [Object.assign({}, w[0], { actionKey: 'ARIA|TRIP-0001|UNDER_CEILING' })];
  check('a key that doesn\'t match its type is rebuilt from the row', Object.keys(run('ariaWantedFlags_(wbad, [], {last_run_utc:"2027-02-20T11:52:00Z", last_run_status:"OK"}, "2027-02-20T15:00:00Z")')).join() === 'ARIA|TRIP-0001|BOOK_NOW');
  const g = run('ariaGaps_([], w, [], [], "2027-02-20")');
  check('the gaps list what ARIA says it can\'t price, in its words', g.incomplete.some(x => x.id === 'TRIP-0002' && x.why === 'Needs airports'), JSON.stringify(g.incomplete));

  // The sync, through VERA's real upsertKeyedFlags_.
  const CODE_SRC = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
  const at = CODE_SRC.indexOf('function upsertKeyedFlags_'); const end = CODE_SRC.indexOf('\n}\n', at) + 3;
  vm.runInContext(CODE_SRC.slice(at, end), S);
  S.FLAG_HEADERS = ['ID', 'Date', 'Source', 'Flag', 'Reason', 'Urgency', 'Acknowledged', 'Snoozed Until', 'Resolved', 'Key', 'Escalated'];
  S.colorCodeFlags = () => {};
  const FL = [S.FLAG_HEADERS.slice(), ['FLAG-OLD', '2027-02-01', 'ARIA', 'Ceiling not set', 'x', 'Low', 'No', '', 'No', 'ARIA|TRIP-0009|CEILING_NOT_SET', ''],
    ['FLAG-OTHER', '2027-02-01', 'Watchdog', 'Other', 'x', 'Low', 'No', '', 'No', 'watchdog_x', '']];
  const flagTab = { getLastRow: () => FL.length, getRange: (r, c, nr, nc) => ({ getValues: () => FL.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)), setValue: v => { FL[r - 1][c - 1] = v; } }), appendRow: v => FL.push(v.slice()) };
  S.getSpreadsheet = () => ({ getSheetByName: n => n === 'Flags' ? flagTab : null });
  S.TABS.FLAGS = 'Flags';
  props.ARIA_SHEET_ID = 'InventedTrackerId_0123456789';
  const tracker = { Watchlist: S.WV, 'Fare Log': FARES, 'Run Log': S.RL, Settings: S.SET };
  S.SpreadsheetApp = { openById: () => ({ getSheetByName: n => tracker[n] ? tab(tracker[n]) : null }) };
  S.Date = Date; vm.runInContext('Date = this.Date', S);
  const r1 = run('syncAriaFlags_()');
  const open = () => FL.filter(x => x[2] === 'ARIA' && x[8] === 'No').map(x => x[9]).sort().join();
  check('a sync opens one flag per action and the health flag', r1.ok && open() === 'ARIA|RUN_HEALTH,ARIA|TRIP-0001|BOOK_NOW,ARIA|TRIP-0002|NEEDS_AIRPORTS,ARIA|TRIP-0003|DATE_CHANGED', open());
  const bookRow = FL.find(x => x[9] === 'ARIA|TRIP-0001|BOOK_NOW');
  check('…dated when the action began, sourced ARIA', bookRow[1] === '2027-02-18' && bookRow[2] === 'ARIA' && bookRow[3] === 'Book now: $704 on UA 2027-04-05–2027-04-13');
  check('…an ARIA flag whose key left the Watchlist is resolved', FL.find(x => x[9] === 'ARIA|TRIP-0009|CEILING_NOT_SET')[8] === 'Yes');
  check('…and other sources\' flags are untouched', FL.find(x => x[9] === 'watchdog_x')[8] === 'No');
  const n = FL.length; run('syncAriaFlags_()');
  check('syncing again duplicates nothing', FL.length === n);
  S.WV[1][12] = ''; S.WV[1][14] = ''; S.WV[1][11] = '';
  run('syncAriaFlags_()');
  check('Book now cleared on the Watchlist: its flag resolves', FL.find(x => x[9] === 'ARIA|TRIP-0001|BOOK_NOW')[8] === 'Yes');
  S.SpreadsheetApp = { openById: () => { throw new Error('denied'); } };
  const r3 = run('syncAriaFlags_()');
  check('a tracker VERA can\'t read raises only the health flag, and closes nothing ARIA raised', r3.ok === false && FL.find(x => x[9] === 'ARIA|TRIP-0002|NEEDS_AIRPORTS')[8] === 'No'
    && FL.find(x => x[9] === 'ARIA|RUN_HEALTH')[3] === '🧭 VERA can’t read ARIA' && FL.find(x => x[9] === 'ARIA|RUN_HEALTH')[5] === 'High');
  S.SpreadsheetApp = { openById: () => ({ getSheetByName: n => n === 'Watchlist' ? null : tab(tracker[n]) }) };
  run('syncAriaFlags_()');
  check('…and so does one with no Watchlist tab', FL.find(x => x[9] === 'ARIA|TRIP-0002|NEEDS_AIRPORTS')[8] === 'No');
  delete props.ARIA_SHEET_ID;
  check('not connected: nothing to sync', run('syncAriaFlags_()').skipped === 'not configured');

  const due = (h, m, last) => { S.nowD = new Date(2027, 1, 20, h, m); S.lastI = last; return run('ariaSyncDue_(nowD, lastI)'); };
  check('VERA reads ARIA from 07:30, after its 06:52 run, not before', due(7, 20, '') === false && due(7, 35, '') === true);
  check('…then every three hours', due(9, 0, new Date(2027, 1, 20, 7, 35).toISOString()) === false && due(10, 35, new Date(2027, 1, 20, 7, 35).toISOString()) === true);
  check('…the first sync of a morning doesn\'t wait on last night\'s', due(7, 40, new Date(2027, 1, 19, 21, 0).toISOString()) === true);
  check('…and not after 22:00', due(22, 10, '') === false);
}

console.log('\none trip: what ARIA has, asking it to watch, and telling it it\'s booked');
{
  S.bud = [{ category: 'flights', budgeted: '$800' }, { category: 'Flights', budgeted: 120 }, { category: 'lodging', budgeted: 2000 }];
  check('the ceiling is Trip Budget\'s flights line shared by the travelers', run('ariaCeilingFrom_(bud, 2)') === 460 && run('ariaCeilingFrom_([{category:"transport", budgeted: 900}], 2)') === null && run('ariaCeilingFrom_(bud, 0)') === null);
  S.fl = [{ type: 'flight', date: '2027-04-06' }, { type: 'hotel', date: '2027-04-05' }, { type: 'flight', date: '2027-04-13' }];
  check('flights out (on or a day after the start) and back (on or a day before the end) are booked', run('ariaFlightsBooked_(fl, "2027-04-05", "2027-04-13").both') === true);
  check('…only the way out is not both', run('ariaFlightsBooked_([fl[0]], "2027-04-05", "2027-04-13").both') === false && run('ariaFlightsBooked_([{type:"flight",date:"2027-04-08"}], "2027-04-05", "2027-04-13").out') === false);

  const RQ = [run('ARIA_REQUESTS_HEADERS').slice()];
  const rq = { getLastRow: () => RQ.length, getRange: (r, c, nr, nc) => ({ getValues: () => RQ.slice(r - 1, r - 1 + nr).map(x => { const o = x.slice(c - 1, c - 1 + nc); while (o.length < nc) o.push(''); return o; }), setValues: v => v.forEach((x, i) => { RQ[r - 1 + i] = x.slice(); }) }), appendRow: v => RQ.push(v.slice()) };
  const BUD = [['ID', 'Trip Key', 'Category', 'Label', 'Budgeted', 'Actual', 'Notes'], ['B1', '2027-04-05|Chicago Trip', 'flights', 'Flights', 720, '', ''], ['B2', 'other', 'flights', 'x', 99999, '', '']];
  const budTab = { getLastRow: () => BUD.length, getRange: (r, c, nr, nc) => ({ getValues: () => BUD.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }) };
  S.TABS.TRIP_BUDGET = 'Trip Budget'; S.TRIP_BUDGET_HEADERS = BUD[0];
  S.getSpreadsheet = () => ({ getSheetByName: n => n === 'ARIA Requests' ? rq : n === 'Trip Budget' ? budTab : null });
  S.ensureSheet = (ss, n) => n === 'ARIA Requests' ? rq : null;
  S.tiSchema_ = sh => sh; S.tiLocked_ = fn => fn(); S.tiNow_ = () => '2027-02-20T12:00:00.000Z'; let mint = 100; S.tiMintId_ = p => p + (++mint);
  S.getConfigValues = () => ({ home_airports: 'IAD, DCA' });
  S.webGetTripMeta_ = () => ({ ok: true, tripTravellers: 2 });
  S.resolveTripId_ = (t, o) => (o && o.mint === false && o.touch === false && t.label === 'Chicago Trip') ? 'TRIP-CHI' : '';
  S.ariaPlanFor_ = () => null;
  let status = { ok: true, configured: true, watchlist: [{ tripId: 'TRIP-CHI', label: 'Chicago Trip', status: 'draft', origins: '', dests: '', ceiling: null, travelers: null }], fares: [], requests: [] };
  S.webAriaStatus_ = () => status;
  const q = 'webTripAria_({ tripKey: "2027-04-05|Chicago Trip", label: "Chicago Trip", startDate: "2027-04-05", endDate: "2027-04-13" })';
  let ta = run(q);
  check('a trip\'s Trip ID is found from the trip, read only, nothing minted', ta.ok && ta.tripId === 'TRIP-CHI');
  check('…its ARIA row (a Draft here) is found', ta.row && ta.row.status === 'draft' && ta.request === null);
  check('the watch form comes prefilled: home airports, the trip\'s dates, travelers, the ceiling from Trip Budget\'s flights', ta.draft.origins === 'IAD, DCA' && ta.draft.earliest === '2027-04-05' && ta.draft.latest === '2027-04-13'
    && ta.draft.travelers === 2 && ta.draft.ceiling === 360 && ta.draft.flexDays === 1 && ta.draft.dests === '', JSON.stringify(ta.draft));
  S.ariaPlanFor_ = () => ({ idea: { id: 'IDEA-1', title: 'x' }, option: { id: 'OPT-9', legs: [{ kind: 'move', mode: 'fly', from: 'Home', to: 'ord' }] } });
  check('…with where to fly from the settled plan when there is one', run(q).draft.dests === 'ORD');
  S.ariaPlanFor_ = () => null;

  check('asking needs where to fly to', /where you fly to/.test(run('webWatchAriaRequest_({ tripId: "TRIP-CHI", tripKey: "2027-04-05|Chicago Trip", startDate: "2027-04-05", endDate: "2027-04-13", dests: " " })').error));
  const w1 = run('webWatchAriaRequest_({ tripId: "trip-chi", tripKey: "2027-04-05|Chicago Trip", label: "Chicago Trip", startDate: "2027-04-05", endDate: "2027-04-13", origins: "IAD", dests: "ORD", travelers: "2", ceiling: "$360", flexDays: "1" })');
  check('Ask ARIA to watch writes a watch request for the trip, with no Ref', w1.ok && RQ.length === 2 && RQ[1][1] === 'watch' && RQ[1][2] === '' && RQ[1][3] === 'TRIP-CHI' && RQ[1][4] === '2027-04-05|Chicago Trip'
    && RQ[1][7] === 'ORD' && RQ[1][15] === 360 && RQ[1][16] === 'Active' && RQ[1][19] === 1, JSON.stringify(RQ[1]));
  run('webWatchAriaRequest_({ tripId: "TRIP-CHI", tripKey: "2027-04-05|Chicago Trip", startDate: "2027-04-05", endDate: "2027-04-13", origins: "IAD", dests: "MDW", ceiling: "400" })');
  check('…asking again refreshes the one request', RQ.length === 2 && RQ[1][7] === 'MDW' && RQ[1][15] === 400);
  status = Object.assign({}, status, { requests: run('ariaReadRequests_()') });
  check('the trip then shows its request', run(q).request && run(q).request.dests === 'MDW');
  run('webWatchAriaRequest_({ tripId: "TRIP-ZZZ", tripKey: "2027-08-01|Other", startDate: "2027-08-01", endDate: "2027-08-03", dests: "SEA" })');
  check('Stop watching withdraws it by trip, and only that trip', run('webWithdrawAriaRequest_({ tripId: "TRIP-CHI" })').ok && RQ[1][16] === 'Withdrawn' && RQ.find(r => r[3] === 'TRIP-ZZZ')[16] === 'Active');
  run('webWatchAriaRequest_({ tripId: "TRIP-CHI", tripKey: "2027-04-05|Chicago Trip", startDate: "2027-04-05", endDate: "2027-04-13", dests: "ORD" })');

  // VERA tells ARIA a trip is booked
  S.readTripRegistry_ = () => ({ byId: { 'TRIP-CHI': { tripId: 'TRIP-CHI', label: 'Chicago Trip', startDate: '2027-04-05', endDate: '2027-04-13' },
    'TRIP-LAX': { tripId: 'TRIP-LAX', label: 'LA', startDate: '2027-07-01', endDate: '2027-07-05' }, 'TRIP-NOPE': { tripId: 'TRIP-NOPE', label: 'Not yet', startDate: '2027-09-01', endDate: '2027-09-05' } }, rows: [] });
  let asked = [];
  const ITEMS = { 'TRIP-CHI': S.fl, 'TRIP-LAX': [{ type: 'flight', date: '2027-07-01' }, { type: 'flight', date: '2027-07-05' }], 'TRIP-NOPE': [{ type: 'flight', date: '2027-09-01' }] };
  S.tripItemsFor_ = (key, a) => { asked.push(key); const id = Object.keys(S.readTripRegistry_().byId).find(k => S.readTripRegistry_().byId[k].startDate === a); return ITEMS[id] || []; };
  S.wl = [{ tripId: 'TRIP-LAX', status: 'watching' }, { tripId: 'TRIP-NOPE', status: 'watching' }, { tripId: 'TRIP-OLD', status: 'booked' }];
  const n = run('ariaMarkBooked_(wl)');
  check('VERA marks a watched trip booked once its flights out and back are in', n === 2 && RQ.find(r => r[3] === 'TRIP-CHI')[16] === 'Booked', n);
  check('…and adds a booked request for a trip ARIA watches with no request (the parser\'s rows have no Trip Key)', RQ.some(r => r[3] === 'TRIP-LAX' && r[16] === 'Booked' && r[1] === 'watch'));
  check('…but not for a trip with only one way booked', !RQ.some(r => r[3] === 'TRIP-NOPE'));
  const len = RQ.length; run('ariaMarkBooked_(wl)');
  check('…and only once', RQ.length === len && RQ.filter(r => r[3] === 'TRIP-LAX').length === 1);
  check('the booked check runs with the hourly ARIA sync', /try \{ ariaMarkBooked_\(t\.watch\); \}/.test(SRC));
  check('…which also makes sure the ARIA Requests tab exists, so ARIA can read it', /try \{ ariaRequestsSheet_\(\); \}/.test(SRC));
  check('the trip routes are wired', /case 'trip_aria':\s+return jsonOut_\(webTripAria_\(e\.parameter\)\);/.test(WEB) && /case 'aria_request_watch':\s+return jsonOut_\(webWatchAriaRequest_\(body\)\);/.test(WEB));
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
check('the requests tab is the one ARIA reads, with the columns it reads', /ARIA_REQUESTS: +'ARIA Requests'/.test(CODE) && CODE.indexOf("const ARIA_REQUESTS_HEADERS = ['Request ID', 'Kind', 'Ref', 'Trip ID', 'Trip Key', 'Label', 'Origin Airports', 'Destination Airports', 'Return-From Airports', 'Earliest Depart', 'Latest Return', 'Nights Min', 'Nights Max', 'Travelers', 'Bags', 'Ceiling Per Person', 'Status', 'Created', 'Updated', 'Flex Days'];") !== -1);
check('ARIA\'s flags ride on the hourly trigger, ahead of the reminders switch', (() => { const R = fs.readFileSync(path.join(ROOT, 'Reminders.js'), 'utf8'); const i = R.indexOf('function hourlyCheck() {'), a = R.indexOf('maybeSyncAriaFlags_(new Date());', i), b = R.indexOf("reminders_enabled", i); return i !== -1 && a !== -1 && a < b; })());
check('the request routes are wired', /case 'aria_request_save':\s+return jsonOut_\(webSaveAriaRequest_\(body\)\);/.test(WEB) && /case 'aria_request_withdraw':\s+return jsonOut_\(webWithdrawAriaRequest_\(body\)\);/.test(WEB));
check('the route is wired', /case 'aria_status':\s+return jsonOut_\(webAriaStatus_\(e\.parameter\)\);/.test(WEB));
check('full: ARIA is a Travel tab, and renders the view', /\{id:'aria',label:'🧭 ARIA'/.test(APP) && /sub==='aria'&&\/\*#__PURE__\*\/React\.createElement\(AriaView,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
check('lite: ARIA is a Travel tab, and renders the view', /\['aria','🧭 ARIA'\]/.test(LITE) && /\{travSub === 'aria' && <AriaView apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>\}/.test(LITE));
check('index.html carries the block, not a stale build', fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8').indexOf('function AriaView(') !== -1);
check('the dashboard opens a fare link safely', /rel:'noopener noreferrer'/.test(A));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
