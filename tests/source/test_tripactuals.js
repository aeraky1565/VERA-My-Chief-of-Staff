// What a trip actually cost (TripActuals.js): booking confirmations' totalPaid,
// totalled by Trip Budget category and written as the Actual on the trip's Budget
// lines, never over an amount Ahmed typed; a settled trip idea's WILLA reminder
// refreshed with what has been booked. Every trip, booking and amount is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'TripActuals.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const PARSER = fs.readFileSync(path.join(ROOT, 'EmailParser.js'), 'utf8');
const REM = fs.readFileSync(path.join(ROOT, 'Reminders.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// The real type → category map, lifted out of WebApp.js.
const mapAt = WEB.indexOf('var TRIP_BUDGET_TYPE_MAP_ = {');
const MAP = WEB.slice(mapAt, WEB.indexOf('\n};', mapAt) + 3);
const S = vm.createContext({ console, JSON, Math, Number, String, Array, Date, Object, isFinite, logs: [] });
S.Logger = { log: m => S.logs.push(String(m)) };
vm.runInContext(MAP + '\n' + SRC, S);
const run = code => vm.runInContext(code, S);
const meta = o => JSON.stringify(o);

console.log('totals by category');
{
  S.items = [
    { type: 'flight', title: 'UA 123 IAD → ORD', date: '2027-04-05', metadata: meta({ totalPaid: 612.4, totalCurrency: 'USD', sourceEmailId: 'm1' }) },
    { type: 'flight', title: 'UA 456 ORD → IAD', date: '2027-04-13', metadata: meta({ totalPaid: 612.4, totalCurrency: 'USD', sourceEmailId: 'm1' }) },
    { type: 'hotel', title: 'Hotel Lake', date: '2027-04-05', metadata: meta({ totalPaid: '1,180' }) },
    { type: 'hotel', title: 'Hotel Euro', date: '2027-04-09', metadata: meta({ totalPaid: 900, totalCurrency: 'EUR' }) },
    { type: 'dining', title: 'Alinea', date: '2027-04-07', metadata: meta({ totalPaid: 450, totalCurrency: 'usd' }) },
    { type: 'car_rental', title: 'Hertz', date: '2027-04-05', metadata: meta({ depositPaid: 100 }) },
    { type: 'flight', title: 'Calendar flight', date: '2027-04-05', metadata: '' },
    { type: 'mystery', title: 'x', date: '2027-04-06', metadata: meta({ totalPaid: 99 }) },
  ];
  const a = run('tripActualsFromItems_(items)');
  check('a booking is counted once, however many rows carry its confirmation (a round trip)', a.flights.total === 612.4 && a.flights.count === 1, JSON.stringify(a.flights));
  check('the parser\'s own type names map to Budget categories (dining → food)', a.food && a.food.total === 450);
  check('an amount with no currency counts as dollars, written "1,180" too', a.lodging.total === 1180, JSON.stringify(a.lodging));
  check('another currency is left out, and counted as left out', a.lodging.count === 1 && a.lodging.other === 1);
  check('a deposit is not the total paid; a calendar event has none; an unknown type is not a category', !a.transport && !a.mystery && Object.keys(a).sort().join() === 'flights,food,lodging', Object.keys(a).join());
}

console.log('\nwhich Budget lines to write');
{
  S.act = { flights: { total: 612.4, count: 1, other: 0, label: 'Flights' }, lodging: { total: 1180, count: 1, other: 1, label: 'Lodging' }, food: { total: 450, count: 1, other: 0, label: 'Food' }, transport: { total: 0, count: 0, other: 1, label: 'T' } };
  S.lines = [{ row: 2, category: 'flights', actual: '', notes: '' }, { row: 3, category: 'Lodging', actual: 1500, notes: 'deposit + balance, typed' }, { row: 4, category: 'food', actual: 300, notes: 'VERA: from 1 confirmation' }];
  const w = run('tripActualsWrites_(lines, act)');
  check('a blank Actual is filled, with where it came from', w.some(x => x.kind === 'update' && x.row === 2 && x.actual === 612.4 && x.notes === 'VERA: from 1 confirmation'), JSON.stringify(w));
  check('an Actual you typed is never overwritten', !w.some(x => x.row === 3));
  check('an Actual VERA wrote is kept current', w.some(x => x.kind === 'update' && x.row === 4 && x.actual === 450));
  check('a category with no line gets one; a category with nothing in dollars gets none', !w.some(x => x.kind === 'add' && x.category === 'transport') && run('tripActualsWrites_([], act)').filter(x => x.kind === 'add').length === 3);
  check('the note says what was left out', run('tripActualsNote_({count: 2, other: 1})') === 'VERA: from 2 confirmations · 1 in another currency left out');
  S.lines2 = [{ row: 2, category: 'flights', actual: 612.4, notes: 'VERA: from 1 confirmation' }];
  S.act2 = { flights: S.act.flights };
  check('nothing changed: nothing written', run('tripActualsWrites_(lines2, act2)').length === 0);
  const r = run('tripActualsWillaReason_({label:"Spring in Europe", startDate:"2027-05-29", endDate:"2027-06-11"}, {flights:{total:1640,count:1}, lodging:{total:4210.5,count:2}})');
  check('the WILLA reminder says what was booked so far, by category', r === 'Spring in Europe (2027-05-29–2027-06-11): booked so far $5,851 (flights $1,640, lodging $4,211). Send WILLA the final total once everything is booked.', r);
  check('it runs every six hours', run('tripActualsDue_(Date.parse("2027-02-20T12:00:00Z"), "2027-02-20T07:00:00Z")') === false && run('tripActualsDue_(Date.parse("2027-02-20T13:00:00Z"), "2027-02-20T07:00:00Z")') === true && run('tripActualsDue_(0, "")') === true);
}

console.log('\nthe sync, over fake sheets');
{
  const H = ['ID', 'Trip Key', 'Category', 'Label', 'Budgeted', 'Actual', 'Notes'];
  const BUD = [H.slice(), ['B1', '2027-04-05|Chicago Trip', 'flights', 'Flights', 720, '', ''], ['B2', '2027-04-05|Chicago Trip', 'lodging', 'Lodging', 1500, 1400, 'typed by me'], ['B3', 'other', 'flights', 'x', 1, '', '']];
  const tab = rows => ({ getLastRow: () => rows.length, getRange: (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => { const o = x.slice(c - 1, c - 1 + nc); while (o.length < nc) o.push(''); return o; }),
    setValues: v => v.forEach((x, i) => x.forEach((y, j) => { rows[r - 1 + i][c - 1 + j] = y; })), setValue: v => { rows[r - 1][c - 1] = v; } }), appendRow: v => rows.push(v.slice()) });
  const FL = [['ID', 'Date', 'Source', 'Flag', 'Reason', 'Urgency', 'Ack', 'Snooze', 'Resolved', 'Key', 'Esc'], ['F1', '2027-02-01', 'Trip Ideas', 'Send…', 'old reason', 'Low', 'No', '', 'No', 'trip_idea_willa|IDEA-1', ''],
    ['F2', '2027-02-01', 'Trip Ideas', 'Send…', 'resolved one', 'Low', 'No', '', 'Yes', 'trip_idea_willa|IDEA-2', '']];
  Object.assign(S, {
    TABS: { TRIP_BUDGET: 'Trip Budget', FLAGS: 'Flags' }, TRIP_BUDGET_HEADERS: H, FLAG_HEADERS: FL[0], TRIP_IDEAS_HEADERS: new Array(19).fill(''),
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
    readTripRegistry_: () => ({ rows: [{ tripId: 'TRIP-CHI', label: 'Chicago Trip', startDate: '2027-04-05', endDate: '2027-04-13', status: 'active' },
      { tripId: 'TRIP-OLD', label: 'Long ago', startDate: '2020-01-01', endDate: '2020-01-05', status: 'active' }] }),
    tripItemsFor_: (key) => { S.asked = (S.asked || []).concat([key]); return key === '2027-04-05|Chicago Trip' ? S.items : []; },
    tripKeysFor_: k => [k], tripRowMatches_: (cell, keys) => keys.indexOf(String(cell).trim()) !== -1,
    tiLocked_: fn => fn(), getSpreadsheet: () => ({ getSheetByName: n => n === 'Flags' ? tab(FL) : n === 'Trip Budget' ? tab(BUD) : null }),
    ensureSheet: (ss, n) => tab(BUD),
    tiRows_: s => s, tiIdeasSheet_: () => [['IDEA-1'], ['IDEA-2']], tiIdeaFromRow_: r => ({ id: r[0], tripId: 'TRIP-CHI' }),
  });
  const n = run('syncTripActuals_()');
  check('only trips not long over are read', JSON.stringify(S.asked) === '["2027-04-05|Chicago Trip"]', JSON.stringify(S.asked));
  check('the flights line gets what was paid', BUD[1][5] === 612.4 && BUD[1][6] === 'VERA: from 1 confirmation', JSON.stringify(BUD[1]));
  check('the lodging you typed stays yours', BUD[2][5] === 1400 && BUD[2][6] === 'typed by me');
  check('a missing category (food) gets its own line, on the trip\'s key', BUD.some(r => r[1] === '2027-04-05|Chicago Trip' && r[2] === 'food' && r[5] === 450));
  check('another trip\'s line is untouched', BUD[3][5] === '');
  check('the settled idea\'s open WILLA reminder now says what was booked', /^Chicago Trip \(2027-04-05–2027-04-13\): booked so far \$2,242 \(flights \$612, lodging \$1,180, food \$450\)/.test(FL[1][4]), FL[1][4]);
  check('…a resolved one is left resolved and unchanged', FL[2][4] === 'resolved one' && FL[2][8] === 'Yes');
  const len = BUD.length; run('syncTripActuals_()');
  check('syncing again adds nothing', BUD.length === len && n >= 2);
  check('the log is counts only', S.logs.every(l => !/Chicago|612|Alinea/.test(l)), S.logs.join(' | '));
}

console.log('\nwiring');
check('the parser asks for the total paid, in both its prompts', (PARSER.match(/"totalPaid": "number or null: the total charged for this booking/g) || []).length === 2 && (PARSER.match(/"totalCurrency"/g) || []).length === 2);
check('the import and the actuals share one type map', /var typeToCategory = TRIP_BUDGET_TYPE_MAP_;/.test(WEB) && /TRIP_BUDGET_TYPE_MAP_\[/.test(SRC));
check('it runs from the hourly check, every six hours, and never throws', /maybeSyncTripActuals_\(new Date\(\)\);/.test(REM) && /function maybeSyncTripActuals_\(now\) \{\n  try \{/.test(SRC));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
