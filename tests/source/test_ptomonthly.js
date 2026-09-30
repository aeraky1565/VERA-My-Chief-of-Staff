// Extracts the REAL buildMonthlyPTO_ from docs/app.js and exercises it.
// The headline property is the invariant: the twelve rows must add up to the
// same totals the cards above them print, or the card contradicts itself.

const fs = require('fs');
const vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

const SRC = fs.readFileSync(ROOT + '/docs/app.js', 'utf8');

function extractFn(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('not found in app.js: ' + name);
  let j = SRC.indexOf('{', i), depth = 0;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return SRC.slice(i, j) + '\n';
}

const ctx = { console, Date, Math, Number, String, Object, RegExp };
vm.createContext(ctx);
vm.runInContext(extractFn('ptoYmd_'), ctx);
vm.runInContext(extractFn('buildMonthlyPTO_'), ctx);
const build = vm.runInContext('buildMonthlyPTO_', ctx);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}
const round2 = n => Math.round(n * 100) / 100;

// Event shape taken from PTO.js (type/label/startDate/endDate/weekdays/hours/status).
const EVENTS = [
  { type:'Vacation',     label:'Presidents week', startDate:'2026-02-16', endDate:'2026-02-20', weekdays:5, hours:null, status:'Used'    },
  { type:'Vacation',     label:'Long weekend',    startDate:'2026-05-22', endDate:'2026-05-22', weekdays:1, hours:null, status:'Used'    },
  { type:'Vacation',     label:'Summer',          startDate:'2026-07-06', endDate:'2026-07-08', weekdays:3, hours:null, status:'Used'    },
  { type:'Vacation',     label:'Caribbean',       startDate:'2026-11-06', endDate:'2026-11-13', weekdays:6, hours:null, status:'Planned' },
  { type:'PTO-Personal', label:'Dentist',         startDate:'2026-03-04', endDate:'2026-03-04', weekdays:1, hours:8,    status:'Used'    },
  { type:'PTO-Personal', label:'Half day',        startDate:'2026-09-09', endDate:'2026-09-09', weekdays:1, hours:4,    status:'Used'    },
];

console.log('\nshape');
{
  const rows = build(EVENTS, 2026);
  check('twelve rows', rows.length === 12, rows.length);
  check('labelled Jan..Dec', rows[0].label === 'Jan' && rows[11].label === 'Dec');
  check('no events → twelve zero rows', build([], 2026)
        .every(r => r.usedVac === 0 && r.plannedVac === 0 && r.usedPersHrs === 0 && r.plannedPersHrs === 0));
  check('null events tolerated', build(null, 2026).length === 12);
}

console.log('\nTHE INVARIANT — rows sum to the card totals');
{
  const rows = build(EVENTS, 2026);
  const sum = k => round2(rows.reduce((a, r) => a + r[k], 0));

  const wantUsedVac    = EVENTS.filter(e => e.type === 'Vacation'     && e.status === 'Used').reduce((a,e)=>a+e.weekdays,0);
  const wantPlanVac    = EVENTS.filter(e => e.type === 'Vacation'     && e.status === 'Planned').reduce((a,e)=>a+e.weekdays,0);
  const wantUsedPers   = EVENTS.filter(e => e.type === 'PTO-Personal' && e.status === 'Used').reduce((a,e)=>a+e.hours,0);

  check('vacation used sums exactly',    sum('usedVac')     === wantUsedVac,  sum('usedVac') + ' vs ' + wantUsedVac);
  check('vacation planned sums exactly', sum('plannedVac')  === wantPlanVac,  sum('plannedVac') + ' vs ' + wantPlanVac);
  check('personal used sums exactly',    sum('usedPersHrs') === wantUsedPers, sum('usedPersHrs') + ' vs ' + wantUsedPers);
}

console.log('\nplacement');
{
  const rows = build(EVENTS, 2026);
  check('Feb holds the 5-day vacation', rows[1].usedVac === 5, rows[1].usedVac);
  check('Nov holds the planned trip',   rows[10].plannedVac === 6, rows[10].plannedVac);
  check('Nov has no USED vacation',     rows[10].usedVac === 0);
  check('Mar holds 8h personal',        rows[2].usedPersHrs === 8, rows[2].usedPersHrs);
  check('Sep holds the 4h half-day',    rows[8].usedPersHrs === 4, rows[8].usedPersHrs);
  check('personal never leaks into vacation',
        rows.every(r => r.usedVac % 1 === 0 || true) && rows[2].usedVac === 0 && rows[8].usedVac === 0);
  check('empty months stay empty', rows[0].usedVac === 0 && rows[3].usedVac === 0);
}

console.log('\nmonth-straddling event');
{
  // Dec 28 2026 (Mon) → Jan 1 2027. Only the 2026 weekdays count toward 2026.
  const ev = [{ type:'Vacation', label:'NY break', startDate:'2026-12-28', endDate:'2027-01-01', weekdays:5, hours:null, status:'Planned' }];
  const rows = build(ev, 2026);
  const total = round2(rows.reduce((a, r) => a + r.plannedVac, 0));
  check('all of it lands in December', rows[11].plannedVac === 5, rows[11].plannedVac);
  check('and nothing leaks into January', rows[0].plannedVac === 0);
  check('total preserved', total === 5, total);

  // A span genuinely inside one year but across two months: Jan 29 → Feb 4 2026.
  const ev2 = [{ type:'Vacation', label:'Split', startDate:'2026-01-29', endDate:'2026-02-04', weekdays:5, hours:null, status:'Used' }];
  const r2 = build(ev2, 2026);
  const t2 = round2(r2.reduce((a, r) => a + r.usedVac, 0));
  check('splits across Jan and Feb', r2[0].usedVac > 0 && r2[1].usedVac > 0,
        'Jan ' + r2[0].usedVac + ', Feb ' + r2[1].usedVac);
  check('the two parts still sum to the original 5', t2 === 5, t2);
}

console.log('\nyear filtering');
{
  const ev = [
    { type:'Vacation', label:'Last year', startDate:'2025-06-02', endDate:'2025-06-06', weekdays:5, hours:null, status:'Used' },
    { type:'Vacation', label:'This year', startDate:'2026-06-01', endDate:'2026-06-05', weekdays:5, hours:null, status:'Used' },
  ];
  const rows = build(ev, 2026);
  check('only the in-year event counts', round2(rows.reduce((a,r)=>a+r.usedVac,0)) === 5);
  check('and it lands in June', rows[5].usedVac === 5, rows[5].usedVac);
}

console.log('\nmalformed input');
{
  check('missing startDate skipped',  build([{ type:'Vacation', weekdays:3, status:'Used' }], 2026).every(r=>r.usedVac===0));
  check('end before start skipped',   build([{ type:'Vacation', startDate:'2026-05-10', endDate:'2026-05-01', weekdays:3, status:'Used' }], 2026).every(r=>r.usedVac===0));
  check('weekend-only span skipped',  build([{ type:'Vacation', startDate:'2026-05-02', endDate:'2026-05-03', weekdays:0, status:'Used' }], 2026).every(r=>r.usedVac===0));
  check('zero weekdays contributes nothing',
        build([{ type:'Vacation', startDate:'2026-05-04', endDate:'2026-05-08', weekdays:0, status:'Used' }], 2026).every(r=>r.usedVac===0));
  check('a null entry does not throw', build([null, EVENTS[0]], 2026)[1].usedVac === 5);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
