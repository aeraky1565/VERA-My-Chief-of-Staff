// Exercises the REAL credit-card read mapping and ensureCreditCardSchema_
// extracted from WebApp.js, against row shapes that exist in practice —
// including the 12-column pre-migration row that would otherwise read NaN.

const fs = require('fs');
const vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

const WEBAPP = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
const CODE   = fs.readFileSync(ROOT + '/Code.js', 'utf8');

function extractFn(src, name) {
  let i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('not found: ' + name);
  let j = src.indexOf('{', i), depth = 0;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j) + '\n';
}

const HEADERS = eval(CODE.match(/const CREDIT_CARD_HEADERS\s*=\s*(\[[^\]]*\])/)[1]);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

// ---- The read mapping -------------------------------------------------------
// Lifted verbatim from webGetFinances_ so the mapping under test is the shipped
// expression, not a paraphrase of it.
const MAP_SRC = WEBAPP.match(/var cards = cardRows\.filter\([\s\S]*?\n  \}\);/)[0];

console.log('\nthe read mapping');
{
  const ctx = { console, String, Number };
  vm.createContext(ctx);
  vm.runInContext('var cardRows = CARD_ROWS;\n' + MAP_SRC.replace('var cards =', 'var cards ='), Object.assign(ctx, {
    CARD_ROWS: [
      // 12 columns: a row written before the Credit Limit header existed.
      ['CC-1', 'AMEX Gold', 'American Express', '1234', 325, 15, '2026-09-01', 'Ahmed', 'Victoria', 'Yes', '$10 Dining/m', 'note'],
      // 13 columns, limit blank.
      ['CC-2', 'AMEX Platinum', 'American Express', '5678', 895, 20, '', 'Ahmed', '', 'Yes', '', '', ''],
      // 13 columns, limit set.
      ['CC-3', 'Sapphire', 'Chase', '9012', 95, 5, '', 'Ahmed', '', 'Yes', '', '', 15000],
    ],
  }));
  const cards = vm.runInContext('cards', ctx);

  check('three cards parsed', cards.length === 3, cards.length);
  check('pre-migration 12-column row gives null, NOT NaN',
        cards[0].creditLimit === null, JSON.stringify(cards[0].creditLimit));
  check('...and is genuinely not NaN', !Number.isNaN(cards[0].creditLimit));
  check('13-column row with a blank cell gives null',
        cards[1].creditLimit === null, JSON.stringify(cards[1].creditLimit));
  check('a set limit comes through as a number',
        cards[2].creditLimit === 15000, cards[2].creditLimit);
  check('existing fields are undisturbed',
        cards[0].annualFee === 325 && cards[0].notes === 'note' && cards[0].statementCredit === '$10 Dining/m');
}

// ---- The schema migration ---------------------------------------------------
console.log('\nensureCreditCardSchema_');
{
  function fakeSheet(header, dataRows, maxCols) {
    const state = { header: header.slice(), rows: dataRows.map(r => r.slice()),
                    maxCols: maxCols || header.length, inserted: 0, headerWrites: 0, bolded: 0 };
    return {
      _state: state,
      getMaxColumns: () => state.maxCols,
      insertColumnsAfter: (after, n) => { state.maxCols += n; state.inserted += n; },
      getRange: (row, col, numRows, numCols) => ({
        getValues: () => {
          const h = state.header.slice(0, numCols);
          while (h.length < numCols) h.push('');
          return [h];
        },
        setValues: vals => { state.header = vals[0].slice(); state.headerWrites++; },
        setFontWeight: () => { state.bolded++; },
      }),
    };
  }

  const ctx = { console, String, CREDIT_CARD_HEADERS: HEADERS };
  vm.createContext(ctx);
  vm.runInContext(extractFn(WEBAPP, 'ensureCreditCardSchema_'), ctx);
  const ensure = vm.runInContext('ensureCreditCardSchema_', ctx);

  // A sheet one column short of the current schema — the live one, whenever a column
  // has just been added. The WIDTHS COME FROM HEADERS, not from a literal: pinning
  // them to 12/13 meant this file failed the moment 'No FX Fee' became column 14,
  // reporting "widens by 2" about an ensure that was behaving correctly.
  const N = HEADERS.length;
  const old = fakeSheet(HEADERS.slice(0, N - 1), [['CC-1', 'AMEX Gold']], N - 1);
  ensure(old);
  check('widens a short sheet by exactly the shortfall',
        old._state.inserted === 1, old._state.inserted);
  check('writes the full header row', old._state.headerWrites === 1);
  check('the header now ends with the last schema column',
        old._state.header[N - 1] === HEADERS[N - 1], old._state.header[N - 1]);
  check('data rows are left alone', old._state.rows.length === 1 && old._state.rows[0][0] === 'CC-1');

  // Second call must be a no-op.
  const before = old._state.headerWrites;
  ensure(old);
  check('idempotent on a second call', old._state.headerWrites === before, old._state.headerWrites);

  // An already-correct sheet is untouched.
  const good = fakeSheet(HEADERS, [], N);
  ensure(good);
  check('an already-correct sheet is not rewritten', good._state.headerWrites === 0 && good._state.inserted === 0);

  // Two columns behind, which is what a sheet that missed a release looks like.
  const older = fakeSheet(HEADERS.slice(0, N - 2), [['CC-2', 'Chase']], N - 2);
  ensure(older);
  check('a sheet two columns behind is caught up in one call',
        older._state.inserted === 2 && older._state.header.join(',') === HEADERS.join(','),
        older._state.inserted + ' inserted');

  check('a null sheet does not throw', ensure(null) === null);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
