// The REAL fmtDate from each dashboard, and the REAL normalizeDatesForJson_.
// The ISO shape is the bug that started this; the yyyy-MM-dd shape is the one
// that must NOT be turned into a Date, because that shifts the day east of UTC.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

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
function loadFmt(file, monthDecl) {
  const src = fs.readFileSync(ROOT + '/' + file, 'utf8');
  const m = src.match(monthDecl);
  if (!m) throw new Error('MONTH_ABBR_ not found in ' + file);
  const ctx = { Date, String, parseInt, isNaN };
  vm.createContext(ctx);
  vm.runInContext(m[0] + '\n' + extractFn(src, 'fmtDate') + '\nF = fmtDate;', ctx);
  return ctx.F;
}

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const impls = {
  'docs/app.js':              loadFmt('docs/app.js',              /const MONTH_ABBR_=\[[^\]]*\];/),
  'docs/dashboard-lite.html': loadFmt('docs/dashboard-lite.html', /const MONTH_ABBR_ = \[[^\]]*\];/),
};

const CASES = [
  // [input, expected, why]
  ['2026-09-20',               'Sep 20, 2026', 'the wire format'],
  ['2026-01-01',               'Jan 1, 2026',  'no zero padding on the day'],
  ['2026-12-31',               'Dec 31, 2026', 'December'],
  ['2026-09-19T04:00:00.000Z', 'Sep 19, 2026', 'the ISO leak that started this'],
  ['2026-11-08T05:00:00.000Z', 'Nov 8, 2026',  'another from the screenshot'],
  ['09-20',                    'Sep 20',       'MM-DD has no year to show'],
  ['04-14',                    'Apr 14',       'MM-DD'],
  ['',                         '',             'blank'],
  [null,                       '',             'null'],
  [undefined,                  '',             'undefined'],
  ['3rd sun of sep',           '3rd sun of sep','a rule string is not a date'],
  ['thanksgiving -6d',         'thanksgiving -6d','an offset rule'],
  ['Every 12mo',               'Every 12mo',   'free text'],
  ['Never',                    'Never',        'a literal used by loyalty expiry'],
  ['13-01',                    '13-01',        'not a month — left alone'],
];

for (const [file, fmt] of Object.entries(impls)) {
  console.log('\n' + file);
  CASES.forEach(([inp, want, why]) => {
    const got = fmt(inp);
    check(JSON.stringify(inp) + ' → ' + JSON.stringify(want) + '  (' + why + ')', got === want, JSON.stringify(got));
  });
}

console.log('\nthe two implementations agree');
{
  const a = impls['docs/app.js'], b = impls['docs/dashboard-lite.html'];
  const probes = CASES.map(c => c[0]).concat(['2027-02-28', '2026-06-05T00:00:00.000Z', 'Sep 20']);
  check('identical output on every probe',
        probes.every(p => a(p) === b(p)),
        probes.filter(p => a(p) !== b(p)).map(p => p + ': ' + a(p) + ' vs ' + b(p)).join(' | '));
}

console.log('\nyyyy-MM-dd must not round-trip through Date (timezone safety)');
{
  const fmt = impls['docs/app.js'];
  // Parsing "2026-09-20" as a Date yields UTC midnight; a viewer at UTC+10
  // would render the 20th, but one at UTC-5 reading UTC parts would get the
  // 19th. Reading the string directly sidesteps it entirely.
  const origTZ = process.env.TZ;
  let same = true;
  for (const tz of ['UTC', 'Australia/Sydney', 'America/Los_Angeles', 'Asia/Tokyo']) {
    process.env.TZ = tz;
    if (fmt('2026-09-20') !== 'Sep 20, 2026') same = false;
  }
  process.env.TZ = origTZ;
  check('the same day in every timezone', same);
}

// ---- server-side normalisation -------------------------------------------
console.log('\nnormalizeDatesForJson_ (the global fix)');
{
  const web = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
  const ctx = {
    Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 10) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Date, String, Array, Object,
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(web, 'formatDateVal_') + '\n' +
                  extractFn(web, 'normalizeDatesForJson_') + '\nN = normalizeDatesForJson_;', ctx);
  const N = ctx.N;

  check('a bare Date becomes yyyy-MM-dd', N(new Date(Date.UTC(2026,8,19))) === '2026-09-19',
        N(new Date(Date.UTC(2026,8,19))));
  const out = N({ ok:true, dates:[{ ID:'x', Date:new Date(Date.UTC(2026,8,19)), Label:'Ryan' }] });
  check('a Date nested in an array of objects', out.dates[0].Date === '2026-09-19', JSON.stringify(out));
  check('…and its siblings are untouched', out.dates[0].Label === 'Ryan' && out.ok === true, JSON.stringify(out));
  check('strings pass through', N('2026-09-19') === '2026-09-19');
  check('numbers pass through', N(12) === 12);
  check('booleans pass through', N(false) === false);
  check('null passes through', N(null) === null);
  check('nested arrays of arrays', JSON.stringify(N([[new Date(Date.UTC(2026,0,2))]])) === '[["2026-01-02"]]',
        JSON.stringify(N([[new Date(Date.UTC(2026,0,2))]])));
  check('JSON.stringify no longer emits a timestamp',
        JSON.stringify(N({ d: new Date(Date.UTC(2026,8,19)) })).indexOf('T04:00') === -1 &&
        JSON.stringify(N({ d: new Date(Date.UTC(2026,8,19)) })) === '{"d":"2026-09-19"}',
        JSON.stringify(N({ d: new Date(Date.UTC(2026,8,19)) })));

  // A self-referencing object must not hang the web app.
  const cyc = { name: 'a' }; cyc.self = cyc;
  let threw = null, res;
  try { res = N(cyc); } catch (e) { threw = e.message; }
  check('a cycle is bounded by the depth guard rather than hanging', threw === null, threw);
  check('…and the top level still survives', res && res.name === 'a', JSON.stringify(res && res.name));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
