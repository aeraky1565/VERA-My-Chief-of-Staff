// Two layout fixes found after the Nov 13 release, checked against the shapes the
// live sheet actually had:
//  (a) the styling matches tab names without regard to case. The Config tab is
//      named "CONFIG", and an exact match once styled it and moved it to the end.
//      Config goes first again, is never styled, and gets its frozen first column back;
//  (b) TripMeta is read and written by position. The budget writer used to find
//      its columns by header name, and on a drifted header row wrote the traveller
//      count into the Trip ID column and the budget over Characteristics. The writer
//      now uses positions, ensureTripMetaColumns_ never adds columns, and a one-time
//      repairTripMeta() resets the header row and moves misplaced values back.
// Invented trips and values.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const STYLE = read('SheetStyle.js'), CODE = read('Code.js'), WEB = read('WebApp.js'), TID = read('TripIds.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const fnSrc = (src, name) => { const a = src.indexOf('function ' + name + '('); if (a === -1) return ''; let d = 0, j = src.indexOf('{', a); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); };
const HEAD = (CODE.match(/const TRIP_META_HEADERS\s*=\s*(\[[^\]]*\]);/) || [])[1];

console.log('\n(a) the Config tab, whatever its case');
{
  const c = { String, Array, Object, Math, Logger: { log: () => {} } };
  vm.createContext(c);
  vm.runInContext(STYLE, c);
  const names = ['Flags', 'Tasks', 'Trips', 'Bills', 'Career State', 'CONFIG', 'System Log', 'Access', 'Mystery Tab'];
  const order = vm.runInContext('ssOrder_(' + J(names) + ')', c);
  check('"CONFIG" goes first, under its own name', order[0] === 'CONFIG' && order.indexOf('Config') === -1, J(order));
  check('…and "access" in any case keeps its fixed place', vm.runInContext('ssOrder_(' + J(names.map(n => n === 'Access' ? 'ACCESS' : n)) + ')', c).indexOf('ACCESS') === Math.min(13, names.length - 1));
  const plan = vm.runInContext('ssPlan_(' + J(names.map(n => ({ name: n, maxRows: 10, headers: ['Setting', 'Value', 'What it does', 'Where it’s used'] }))) + ')', c);
  check('"CONFIG" and "Access" are never styled', !plan.ops.some(o => /^(config|access)$/i.test(o.sheet)), J(plan.ops.filter(o => /config|access/i.test(o.sheet))));
  check('…while other tabs are', plan.ops.some(o => o.sheet === 'Flags' && o.op === 'band'));
  check('a new tab named in any case is skipped too', /if \(ssSkip_\(name\) \|\| !cols\) return;/.test(fnSrc(STYLE, 'ssStyleNewTab_')));

  const frozen = { rows: 1, cols: 0 };
  const sh = { getFrozenRows: () => frozen.rows, getFrozenColumns: () => frozen.cols, setFrozenRows: n => { frozen.rows = n; }, setFrozenColumns: n => { frozen.cols = n; } };
  c.getSpreadsheet = () => ({ getSheetByName: n => (/^config$/i.test(n) ? sh : null) });
  c.TABS = { CONFIG: 'Config' };
  check('restoreConfigTab_ freezes Config\'s first column again', vm.runInContext('restoreConfigTab_()', c) === true && frozen.cols === 1 && frozen.rows === 1);
  check('…and every styling run restores it first', /function styleVeraSheet\(\) \{\n\s*restoreConfigTab_\(\);/.test(STYLE));
}

console.log('\n(b) TripMeta, by position');
const W = 12;
const liveHeader = ['Trip Key', 'Context', 'Notes', 'Updated Date', 'Traveller', '', '', '', '', '', 'Trip Budget', 'Trip Travellers', 'Traveler', 'Outbound Mode', 'Return Mode', 'Luggage JSON', 'Characteristics'];
const pad = (r, n) => { const o = r.slice(); while (o.length < n) o.push(''); return o; };
function ctxWith() {
  const c = { String, Array, Object, Math, Number, isNaN, JSON, Logger: { log: s => c.__log.push(String(s)) }, __log: [] };
  vm.createContext(c);
  vm.runInContext('var TRIP_META_HEADERS = ' + HEAD + ';\n' + TID, c);
  return c;
}
{
  const c = ctxWith();
  const rows = [
    pad(['2027-01-02|Invented Lake Trip', 'Family Trip', '', '2026-10-01', '', '', '2', 'flight', 'flight', '', 'cruise', '2'], 17),   // count also in col 12
    pad(['2027-02-03|Invented City Trip', 'Visit', '', '2026-10-02', '', '', '', '', '', '', 'city', '3'], 17),                        // count only in col 12
    pad(['2027-03-04|Invented Beach Trip', 'Visit', '', '2026-10-03', '', '', '2', '', '', '', '1500'], 17),                           // budget over Characteristics
    pad(['2027-04-05|Invented Road Trip', 'Visit', '', '2026-10-04', '', '900', '2', '', '', '', '1200'], 17),                          // budget there and a stray one
  ];
  c.__h = liveHeader; c.__r = rows;
  const p = vm.runInContext('tmRepairPlan_(__h, __r)', c);
  check('the plan resets the header row to TRIP_META_HEADERS', p.ok && J(p.header) === J(eval(HEAD)), J(p.header));
  check('…and removes the 5 extra labels past column 12', p.extraCols === 5, p.extraCols);
  check('a count only in column 12 moves to Trip Travellers', p.moves.some(m => m.row === 3 && m.from === 12 && m.to === 7), J(p.moves));
  check('a count in both places: the column-12 copy is cleared', p.clears.some(x => x.row === 2 && x.col === 12), J(p.clears));
  check('a budget over Characteristics moves to Trip Budget', p.moves.some(m => m.row === 4 && m.from === 11 && m.to === 6));
  check('…or is cleared when Trip Budget already has one', p.clears.some(x => x.row === 5 && x.col === 11));
  check('Characteristics words are left alone', !p.moves.concat(p.clears).some(x => (x.row === 2 || x.row === 3) && (x.from === 11 || x.col === 11)));
  c.__r2 = rows.concat([pad(['2027-05-06|Invented Odd Trip'], 14).map((v, i) => i === 13 ? 'something' : v)]);
  const bad = vm.runInContext('tmRepairPlan_(__h, __r2)', c);
  check('data past column 12 stops the repair, changing nothing', !bad.ok && /column 14/.test(bad.why) && !bad.moves.length);

  // The whole repair on a fake sheet.
  const grid = [liveHeader.slice()].concat(rows.map(r => r.slice()));
  const writes = [];
  const sheet = {
    getLastRow: () => grid.length, getLastColumn: () => Math.max(...grid.map(r => r.length)),
    getRange: (r, col, nr, nc) => ({
      getValues: () => grid.slice(r - 1, r - 1 + (nr || 1)).map(x => { const o = []; for (let i = 0; i < (nc || 1); i++) o.push(x[col - 1 + i] == null ? '' : x[col - 1 + i]); return o; }),
      setValue: v => { writes.push([r, col]); grid[r - 1][col - 1] = v; },
      setValues: v => { writes.push([r, col, v[0].length]); v.forEach((row, i) => row.forEach((x, k) => { grid[r - 1 + i][col - 1 + k] = x; })); },
      clearContent: () => { for (let i = 0; i < (nc || 1); i++) grid[r - 1][col - 1 + i] = ''; writes.push([r, col, 'clear']); },
    }),
  };
  c.getSpreadsheet = () => ({ getSheetByName: () => sheet });
  c.TABS = { TRIP_META: 'TripMeta' };
  let stamped = 0;
  c.tripIdStampAll_ = () => { stamped++; return { filled: 4 }; };
  vm.runInContext('repairTripMeta()', c);
  check('the header row is TRIP_META_HEADERS, and nothing is labelled past column 12',
        J(grid[0].slice(0, W)) === J(eval(HEAD)) && grid[0].slice(W).every(x => x === ''), J(grid[0]));
  check('the counts and budget end up in their own columns', grid[2][6] === '3' && grid[2][11] === '' && grid[3][5] === '1500' && grid[3][10] === '' && grid[1][11] === '' && grid[4][10] === '' && grid[4][5] === '900');
  check('…then the Trip IDs are filled', stamped === 1);
  check('the log gives counts, never a trip or a value', c.__log.some(l => /2 value\(s\) moved/.test(l)) && !c.__log.some(l => /Invented|1500|cruise/.test(l)), J(c.__log));
}
{
  // The budget writer, on the drifted header row.
  const c = { String, Array, Object, Math, Number, JSON, Logger: { log: () => {} } };
  vm.createContext(c);
  const grid = [liveHeader.slice(0, 12), pad(['2027-01-02|Invented Lake Trip', 'Family Trip', '', '2026-10-01', '', '', '2', '', '', '', 'cruise', ''], 12)];
  const sheet = {
    getLastRow: () => grid.length, getLastColumn: () => Math.max(...grid.map(r => r.length)),
    getRange: (r, col, nr, nc) => ({
      getValues: () => grid.slice(r - 1, r - 1 + (nr || 1)).map(x => { const o = []; for (let i = 0; i < (nc || 1); i++) o.push(x[col - 1 + i] == null ? '' : x[col - 1 + i]); return o; }),
      setValue: v => { grid[r - 1][col - 1] = v; },
    }),
    appendRow: row => { grid.push(row.slice()); },
  };
  c.getSpreadsheet = () => ({ getSheetByName: () => sheet });
  c.TABS = { TRIP_META: 'TripMeta' };
  c.tripKeyForWrite_ = k => k; c.tripKeyRowIndex_ = (ids, k) => ids.indexOf(k);
  c.Session = { getScriptTimeZone: () => 'UTC' }; c.Utilities = { formatDate: () => '2026-11-13' };
  c.tripIdCell_ = () => 'TRIP-INVENTED01';
  vm.runInContext('var TRIP_META_HEADERS = ' + HEAD + ';\n' + fnSrc(WEB, 'ensureTripMetaColumns_') + '\n' + fnSrc(WEB, 'webSetTripBudgetSettings_'), c);
  vm.runInContext('webSetTripBudgetSettings_({ parameter: { tripKey: "2027-01-02|Invented Lake Trip", tripBudget: "2500", tripTravellers: "3" } })', c);
  check('the budget goes to column 6 and the count to column 7, by position', grid[1][5] === 2500 && grid[1][6] === 3, J(grid[1]));
  check('…never over Characteristics or into the Trip ID column', grid[1][10] === 'cruise' && grid[1][11] === '');
  check('blank header cells are labelled in place, and no column is added', grid[0].length === 12 && grid[0][5] === 'Trip Budget' && grid[0][6] === 'Trip Travellers' && grid[0][4] === 'Traveller');
  vm.runInContext('webSetTripBudgetSettings_({ parameter: { tripKey: "2027-09-09|Invented New Trip", tripTravellers: "4" } })', c);
  const added = grid[grid.length - 1];
  check('a new trip\'s row is full width, with its count, budget slot and Trip ID in place', added.length === 12 && added[6] === 4 && added[5] === '' && added[11] === 'TRIP-INVENTED01', J(added));
  check('nothing looks TripMeta columns up by header name any more', !/indexOf\('Trip (Budget|Travellers)'\)\s*\+\s*1;\n\s*var travCol\s*=\s*hdrsRow/.test(WEB) && !/hdrsRow\.indexOf\('Trip (Budget|Travellers)'\)/.test(WEB));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
