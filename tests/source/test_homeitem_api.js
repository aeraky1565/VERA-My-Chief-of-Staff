// The REAL webAddHomeItem_ / webDeleteHomeItem_ against a fake sheet. Column
// ORDER is the thing a form can get silently wrong — a date landing in the
// wrong column reads fine and reminds on the wrong thing.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC  = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');

function extractFn(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = SRC.indexOf('{', start); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(start, j + 1); }
  }
  throw new Error('unbalanced');
}
const HDRS = ['Item','Category','Purchase Date','Warranty Expiry','Last Service','Next Service','Interval (mo)','Notes'];

function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  return {
    _rows: data,
    getLastRow: () => data.length,
    getRange: (row, c, nr, nc) => ({
      getValue: () => (data[row-1] ? data[row-1][c-1] : undefined),
      setValues: v => { while (data.length < row) data.push([]); v.forEach((rv,i)=>{ data[row-1+i] = rv.slice(); }); },
    }),
    deleteRow: r => { data.splice(r-1, 1); },
  };
}
function run(fn, sheet, params) {
  const ctx = {
    TABS: { HOME_ITEMS: 'Home Items' },
    HOME_ITEM_HEADERS: HDRS,
    getSpreadsheet: () => ({ getSheetByName: n => n === 'Home Items' ? sheet : null }),
    Number, String, parseInt, isNaN, Error, Object,
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(fn) + '\nRESULT = ' + fn + '({ parameter: P });',
                  Object.assign(ctx, { P: params }));
  return ctx.RESULT;
}

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

console.log('\nadding a warranty-only item (the watch)');
{
  const sh = makeSheet([HDRS]);
  const r = run('webAddHomeItem_', sh, { item: 'Watch battery', category: 'Personal',
    warrantyExpiry: '2027-09-30', notes: 'Seiko' });
  check('reports created', r.ok && r.action === 'created', JSON.stringify(r));
  check('one row appended', sh._rows.length === 2, sh._rows.length);
  const row = sh._rows[1];
  check('Item in col 1',            row[0] === 'Watch battery', JSON.stringify(row));
  check('Category in col 2',        row[1] === 'Personal', row[1]);
  check('Purchase Date blank',      row[2] === '', JSON.stringify(row[2]));
  check('Warranty Expiry in col 4', row[3] === '2027-09-30', row[3]);
  check('Last/Next Service blank',  row[4] === '' && row[5] === '', JSON.stringify(row.slice(4,6)));
  check('Interval blank',           row[6] === '', JSON.stringify(row[6]));
  check('Notes in col 8',           row[7] === 'Seiko', row[7]);
  check('the row is exactly 8 wide', row.length === 8, row.length);
}

console.log('\nadding an appliance already mid-cycle');
{
  const sh = makeSheet([HDRS]);
  run('webAddHomeItem_', sh, { item: 'Boiler', category: 'Appliance', purchaseDate: '2020-03-01',
    warrantyExpiry: '2030-03-01', lastService: '2027-01-15', nextService: '2028-01-15',
    intervalMonths: '12', notes: 'British Gas' });
  const row = sh._rows[1];
  check('Last Service is kept', row[4] === '2027-01-15', row[4]);
  check('Next Service is kept', row[5] === '2028-01-15', row[5]);
  check('…so it does not need a Record Service click to schedule from today',
        row[5] !== '' && row[4] !== '');
  check('interval coerced to a number', row[6] === 12, JSON.stringify(row[6]));
  check('all eight columns land in order',
        row.join('|') === 'Boiler|Appliance|2020-03-01|2030-03-01|2027-01-15|2028-01-15|12|British Gas',
        row.join('|'));
}

console.log('\nadd validation');
{
  const sh = makeSheet([HDRS]);
  let threw = null;
  try { run('webAddHomeItem_', sh, { item: '   ' }); } catch (e) { threw = e.message; }
  check('a blank name is refused', /required/i.test(threw || ''), threw);
  check('…and nothing is written', sh._rows.length === 1, sh._rows.length);

  run('webAddHomeItem_', sh, { name: 'Laptop' });
  check('"name" works as an alias for "item"', sh._rows[1][0] === 'Laptop', JSON.stringify(sh._rows[1]));
  check('a non-numeric interval becomes blank, not NaN',
        (() => { const s2 = makeSheet([HDRS]); run('webAddHomeItem_', s2, { item:'X', intervalMonths:'abc' });
                 return s2._rows[1][6] === ''; })());
}

console.log('\ndeleting');
{
  const base = () => makeSheet([HDRS,
    ['Watch battery','Personal','','2027-09-30','','','',''],
    ['Boiler','Appliance','','','','2028-01-15',12,''],
  ]);

  let sh = base();
  const r = run('webDeleteHomeItem_', sh, { row: '2', item: 'Watch battery' });
  check('removes the named row', sh._rows.length === 2 && sh._rows[1][0] === 'Boiler',
        JSON.stringify(sh._rows.map(x => x[0])));
  check('reports what it deleted', r.item === 'Watch battery', JSON.stringify(r));

  // The hazard: a stale list. Row 2 is the watch, but the caller thinks it is the boiler.
  sh = base();
  let threw = null;
  try { run('webDeleteHomeItem_', sh, { row: '2', item: 'Boiler' }); } catch (e) { threw = e.message; }
  check('refuses when the row holds a different item', threw !== null, 'no throw');
  check('…naming both, so the message is actionable',
        /Watch battery/.test(threw || '') && /Boiler/.test(threw || ''), threw);
  check('…and deletes NOTHING', sh._rows.length === 3, sh._rows.length);

  sh = base();
  run('webDeleteHomeItem_', sh, { row: '2' });
  check('an omitted name still deletes (chat and older callers)', sh._rows.length === 2);

  sh = base();
  threw = null;
  try { run('webDeleteHomeItem_', sh, { row: '1', item: 'Item' }); } catch (e) { threw = e.message; }
  check('the header row cannot be deleted', /Invalid row/.test(threw || ''), threw);

  sh = base();
  threw = null;
  try { run('webDeleteHomeItem_', sh, { row: '99', item: 'X' }); } catch (e) { threw = e.message; }
  check('a row past the end is refused', /no longer exists/.test(threw || ''), threw);

  sh = base();
  run('webDeleteHomeItem_', sh, { row: '2', item: 'watch BATTERY' });
  check('the name check ignores case', sh._rows.length === 2);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
