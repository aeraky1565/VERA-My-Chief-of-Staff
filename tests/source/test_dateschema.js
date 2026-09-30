// The REAL ensureImportantDatesSchema_ against a fake sheet. ensureSheet only
// writes headers into a blank tab, so without this a live sheet never gains the
// calendar columns — and PatternRecognition reads a range sized by the constant.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const WEB  = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
const CODE = fs.readFileSync(ROOT + '/Code.js', 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced');
}
const HDRS_SRC = CODE.match(/^const IMPORTANT_DATES_HEADERS +=.*;$/m)[0];
// `const` inside a vm context is not reachable as a context property; copy it out.
const HDRS_EXPORT = HDRS_SRC + '\n__H = IMPORTANT_DATES_HEADERS;';
function headers() { const c = {}; vm.createContext(c); vm.runInContext(HDRS_EXPORT, c); return c.__H; }

const OLD = ['ID','Date','Label','Person','Recurring','Lead Time Days','Notes','Last Actioned Year'];

function makeSheet(rows, maxCols) {
  const data = rows.map(r => r.slice());
  let cols = maxCols || rows[0].length;
  return {
    _rows: data, _inserted: 0, _bolded: 0,
    getMaxColumns: () => cols,
    insertColumnsAfter: (_, n) => { cols += n; data.forEach(r => { while (r.length < cols) r.push(''); }); },
    getRange: (row, c, nr, nc) => ({
      getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const r = []; for (let j = 0; j < nc; j++) r.push(data[row-1+i] ? (data[row-1+i][c-1+j] !== undefined ? data[row-1+i][c-1+j] : '') : ''); out.push(r); } return out; },
      setValues: v => { v.forEach((rv, i) => rv.forEach((cv, j) => { while (data[row-1+i].length <= c-1+j) data[row-1+i].push(''); data[row-1+i][c-1+j] = cv; })); },
      setFontWeight: () => {},
    }),
  };
}
function run(sheet) {
  const ctx = { String, Array };
  vm.createContext(ctx);
  vm.runInContext(HDRS_SRC + '\n' + extractFn(WEB, 'ensureImportantDatesSchema_') +
                  '\nresult = ensureImportantDatesSchema_(SHEET);', Object.assign(ctx, { SHEET: sheet }));
  return ctx;
}

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

console.log('\nthe header constant');
{
  const H = headers();
  check('has 11 columns', H.length === 11, H.length);
  check('the original 8 are unchanged and in order',
        JSON.stringify(H.slice(0, 8)) === JSON.stringify(OLD), H.slice(0, 8).join(','));
  check('the three new ones are appended, not inserted',
        JSON.stringify(H.slice(8)) === JSON.stringify(['Add to Calendar','Calendar Lead Days','Last Calendar Year']),
        H.slice(8).join(','));
}

console.log('\nwidening a populated 8-column sheet');
{
  const sheet = makeSheet([
    OLD.slice(),
    ['id_1','04-14',"Victoria's Birthday",'Victoria','Yes',30,'notes here','2025'],
    ['id_2','12-25','Christmas','Both','Yes',30,'',''],
  ], 8);
  const before = sheet._rows.slice(1).map(r => r.slice(0, 8).join('|'));
  run(sheet);
  check('the sheet is widened to 11', sheet.getMaxColumns() === 11, sheet.getMaxColumns());
  check('the new headers are written',
        sheet._rows[0].slice(8).join(',') === 'Add to Calendar,Calendar Lead Days,Last Calendar Year',
        sheet._rows[0].join(','));
  check('existing data rows are byte-identical in their first 8 columns',
        JSON.stringify(sheet._rows.slice(1).map(r => r.slice(0, 8).join('|'))) === JSON.stringify(before),
        sheet._rows.slice(1).map(r => r.slice(0, 8).join('|')).join(' // '));
  check('their new cells are blank, not undefined',
        sheet._rows.slice(1).every(r => r.slice(8, 11).every(c => c === '')),
        JSON.stringify(sheet._rows[1].slice(8)));

  const snap = JSON.stringify(sheet._rows);
  run(sheet);
  check('a second call changes nothing', JSON.stringify(sheet._rows) === snap);
}

console.log('\na sheet that is already current');
{
  const sheet = makeSheet([headers().slice(), ['id_1','04-14','B','V','Yes',30,'','','Yes','45','2026']], 11);
  const snap = JSON.stringify(sheet._rows);
  run(sheet);
  check('is left alone', JSON.stringify(sheet._rows) === snap);
}

console.log('\na sheet with a wrong header in the middle');
{
  const bad = OLD.slice(); bad[3] = 'Who';
  const sheet = makeSheet([bad, ['id_1','04-14','B','V','Yes',30,'','']], 8);
  run(sheet);
  check('the header row is corrected end to end',
        sheet._rows[0].join(',').indexOf('Person') !== -1 && sheet._rows[0].length === 11,
        sheet._rows[0].join(','));
  check('the data row is untouched', sheet._rows[1].slice(0, 8).join('|') === 'id_1|04-14|B|V|Yes|30||');
}

console.log('\nnull sheet');
{
  let threw = null, out;
  try { out = run(null).result; } catch (e) { threw = e.message; }
  check('returns the null rather than throwing', threw === null && out === null, threw);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
