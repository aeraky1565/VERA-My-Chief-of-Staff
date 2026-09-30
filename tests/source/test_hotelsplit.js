// Runs the REAL splitHotelRewardCategories() — extracted from Code.js by
// brace-matching, never a copy — against a fake Spreadsheet, because this is a
// one-shot migration against live data and there is no second chance to get it
// right.

const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const SRC = fs.readFileSync((process.env.VERA_ROOT || REPO) + '/Code.js', 'utf8');

function extractFn(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0, i = SRC.indexOf('{', start);
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function extractConst(name) {
  const re = new RegExp('^const ' + name + ' +=[\\s\\S]*?;$', 'm');
  const m = SRC.match(re);
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}

// --- fake sheet -------------------------------------------------------------
function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  return {
    _rows: data,
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
    getRange: (row, col) => ({ setValue: v => { data[row - 1][col - 1] = v; } }),
    appendRow: r => data.push(r.slice()),
  };
}

const HEADERS = ['ID','Card Name','Category','Rate','Rate Type','Conditions'];
function freshRewards() {
  return makeSheet([
    HEADERS,
    ['CR-1', 'AMEX Gold',                            'Dining',        '4',  'x points',   'Worldwide'],
    ['CR-4', 'AMEX Gold',                            'Hotels',        '2',  'x points',   'Prepaid hotels via Amex Travel'],
    ['CR-7', 'AMEX Platinum',                        'Hotels',        '5',  'x points',   'Prepaid hotels via Amex Travel'],
    ['CR-33','IHG One Rewards Premier',              'IHG Hotels',    '10', 'x points',   'Card multiplier'],
    ['CR-42','Chase Sapphire Preferred (Ahmed)',     'Travel',        '2',  'x points',   'All other travel'],
  ]);
}
const ALL_CARDS = [
  ['ID','Card Name'],
  ['CC-1','AMEX Gold'], ['CC-2','AMEX Platinum'], ['CC-3','IHG One Rewards Premier'],
  ['CC-4','Costco Anywhere Visa'], ['CC-5','Chase Sapphire Preferred (Ahmed)'],
  ['CC-6','Chase Sapphire Preferred (Victoria)'], ['CC-7','BILT Worldwide'],
  ['CC-8','Capital One Venture'],
];

function run(rewardSheet, cardRows) {
  const logs = [];
  const ctx = {
    TABS: { CARD_REWARDS: 'Card Rewards', CREDIT_CARDS: 'Credit Cards' },
    getSpreadsheet: () => ({
      getSheetByName: n => n === 'Card Rewards' ? rewardSheet
                         : n === 'Credit Cards' ? (cardRows ? makeSheet(cardRows) : null)
                         : null,
    }),
    Logger: { log: s => logs.push(s) },
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(
    extractConst('HOTELS_PREPAID_CATEGORY_') + '\n' +
    extractConst('HOTELS_PAY_AT_CATEGORY_') + '\n' +
    extractConst('HOTELS_PAY_AT_REWARDS_') + '\n' +
    extractFn('splitHotelRewardCategories') + '\nsplitHotelRewardCategories();',
    ctx);
  return logs;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}
const catsOf = sh => sh._rows.slice(1).map(r => r[2]);
const payAt  = sh => sh._rows.slice(1).filter(r => r[2] === 'Hotels (Pay at Hotel)');

// --- 1. the normal migration ------------------------------------------------
console.log('\na populated sheet, all cards owned');
{
  const sh = freshRewards();
  const HOTEL_CATS = ['Hotels', 'Hotels (Prepaid)', 'Hotels (Pay at Hotel)'];
  const before = sh._rows.slice(1).filter(r => HOTEL_CATS.indexOf(r[2]) === -1).map(r => r.join('|'));
  const logs = run(sh, ALL_CARDS);

  check('no bare "Hotels" category survives', catsOf(sh).indexOf('Hotels') === -1, catsOf(sh).join(','));
  check('both Hotels rows became Hotels (Prepaid)',
        catsOf(sh).filter(c => c === 'Hotels (Prepaid)').length === 2, catsOf(sh).join(','));
  check('six pay-at-hotel rows appended', payAt(sh).length === 6, payAt(sh).length);
  check('their IDs are distinct', new Set(payAt(sh).map(r => r[0])).size === 6,
        payAt(sh).map(r => r[0]).join(','));
  check('their IDs use the CR- prefix', payAt(sh).every(r => /^CR-\d+$/.test(r[0])),
        payAt(sh).map(r => r[0]).join(','));
  check('one row per card, no duplicates',
        new Set(payAt(sh).map(r => r[1])).size === 6, payAt(sh).map(r => r[1]).join(','));
  check('IHG is the top rate at 10x',
        payAt(sh).sort((a,b)=>parseFloat(b[3])-parseFloat(a[3]))[0][1] === 'IHG One Rewards Premier');
  check('header row untouched', sh._rows[0].join('|') === HEADERS.join('|'), sh._rows[0].join('|'));

  const after = sh._rows.slice(1).filter(r => HOTEL_CATS.indexOf(r[2]) === -1).map(r => r.join('|'));
  check('rows in other categories are byte-identical',
        JSON.stringify(before) === JSON.stringify(after), after.join('  //  '));
  check('logs a summary', /renamed 2 .*added 6/.test(logs[0]), logs[0]);
}

// --- 2. idempotence ---------------------------------------------------------
console.log('\nrunning it a second time');
{
  const sh = freshRewards();
  run(sh, ALL_CARDS);
  const snapshot = JSON.stringify(sh._rows);
  const logs = run(sh, ALL_CARDS);
  check('the sheet is unchanged', JSON.stringify(sh._rows) === snapshot,
        'rows now ' + sh._rows.length);
  check('reports 0 renamed, 0 added', /renamed 0 .*added 0 .*6 already present/.test(logs[0]), logs[0]);
}

// --- 3. a card the user does not own ---------------------------------------
console.log('\na wallet missing two of the six cards');
{
  const sh = freshRewards();
  const partial = ALL_CARDS.filter(r => r[1] !== 'BILT Worldwide' && r[1] !== 'Capital One Venture');
  const logs = run(sh, partial);
  check('only the owned cards are seeded', payAt(sh).length === 4, payAt(sh).length);
  check('BILT is not advertised', payAt(sh).every(r => r[1] !== 'BILT Worldwide'));
  check('reports the skipped cards', /2 card\(s\) not in the wallet/.test(logs[0]), logs[0]);
}

// --- 4. a sheet with no Hotels rows at all ---------------------------------
console.log('\na sheet that has no Hotels rows');
{
  const sh = makeSheet([HEADERS, ['CR-1','AMEX Gold','Dining','4','x points','']]);
  const logs = run(sh, ALL_CARDS);
  check('renames nothing', /renamed 0/.test(logs[0]), logs[0]);
  check('still seeds the pay-at-hotel side', payAt(sh).length === 6, payAt(sh).length);
}

// --- 5. missing Credit Cards tab -------------------------------------------
console.log('\nno Credit Cards tab (seeds everything rather than nothing)');
{
  const sh = freshRewards();
  run(sh, null);
  check('all six are seeded', payAt(sh).length === 6, payAt(sh).length);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
