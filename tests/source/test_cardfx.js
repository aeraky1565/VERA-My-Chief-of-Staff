// A card is only offered for spending abroad when it is MARKED fee-free.
//
// The cheat sheet's International Travel row is unlike every other row in it: the
// others group Card Rewards rows the user typed, this one is derived from the card's
// No FX Fee flag. That makes the flag's unset state a safety question, and the costs
// are asymmetric — a card wrongly offered costs ~3% of a foreign purchase, a card
// wrongly withheld costs a tick in a box. So blank reads as "do not offer this one",
// and the row is simply absent until cards are marked.
//
// Driven against the REAL memo and the REAL label helper, extracted from both dashboard
// copies, because a derived row that only works in one of them is half shipped.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const CODE = fs.readFileSync(ROOT + '/Code.js', 'utf8');
const WEB  = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
const APP  = fs.readFileSync(ROOT + '/docs/app.js', 'utf8');
const LITE = fs.readFileSync(ROOT + '/docs/dashboard-lite.html', 'utf8');

// WebApp.js has 8 `var colMap` and 36 `appendRow([`. The first version of this test
// regexed the file and read a projects handler's colMap, reporting "notes is 7 but
// Notes is column 12" about code that was fine. Scoped by brace-matching instead.
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return '';
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return '';
}

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// ---------------------------------------------------------------------------
// THE DERIVED ROW, run for real.
//
// The memo body is lifted out of docs/app.js and executed with React.useMemo stubbed
// to call its function straight through. Never a copy of the logic — a copy would only
// prove the copy works, which is this suite's whole convention.
function runCheatSheet(cards, rewards) {
  const start = APP.indexOf('cheatSheet=React.useMemo');
  if (start === -1) throw new Error('cheatSheet memo not found in docs/app.js');
  // To the end of the dependency array.
  const end = APP.indexOf('])', APP.indexOf('},[rewards,visibleCards]', start)) + 2;
  const memo = APP.slice(start, end);

  const labelStart = APP.indexOf('function cheatLabel(');
  if (labelStart === -1) throw new Error('cheatLabel not found in docs/app.js');
  let depth = 0, j = APP.indexOf('{', labelStart), labelEnd = -1;
  for (; j < APP.length; j++) {
    if (APP[j] === '{') depth++;
    else if (APP[j] === '}') { depth--; if (depth === 0) { labelEnd = j + 1; break; } }
  }

  const ctx = {
    String, Number, Object, Array, Math, JSON, Error, Set, console, isNaN, parseFloat,
    React: { useMemo: fn => fn() },
    visibleCards: cards,
    rewards: rewards,
  };
  vm.createContext(ctx);
  vm.runInContext(APP.slice(labelStart, labelEnd) + '\nvar ' + memo + ';', ctx);
  return { rows: ctx.cheatSheet, label: ctx.cheatLabel };
}

const card = (name, extra) => Object.assign(
  { cardName: name, active: 'Yes', noFxFee: false, owner: 'Ahmed' }, extra || {});
const rw = (name, category, rate, rateType) =>
  ({ cardName: name, category: category, rate: String(rate), rateType: rateType || 'x points', conditions: '' });

const intlRow = rows => rows.filter(r => r.category === 'International Travel')[0] || null;

// ============================================================================
console.log('Only cards MARKED fee-free are offered');
{
  const out = runCheatSheet([
    card('FeeFree Card',  { noFxFee: true }),
    card('Charges 3pct',  { noFxFee: false }),
  ], [
    rw('FeeFree Card', 'General Spend', 2, '% cash back'),
    rw('Charges 3pct', 'General Spend', 5, '% cash back'),
  ]);

  const row = intlRow(out.rows);
  check('the row appears when a card is marked', !!row, JSON.stringify(out.rows.map(r => r.category)));
  check('…listing the fee-free card',
        row && row.top.length === 1 && row.top[0].cardName === 'FeeFree Card',
        JSON.stringify(row && row.top));
  check('…and NOT the one that charges a fee, however good its rate',
        row && !row.top.some(t => t.cardName === 'Charges 3pct'),
        JSON.stringify(row && row.top) +
        ' — 5% back is worth less than nothing once 3% of the purchase is a fee');
}

console.log('\nUnset means NOT offered');
{
  // The safety property. Every one of these must be excluded.
  [['blank',      ''],
   ['absent',     undefined],
   ['the word no', false],
  ].forEach(([what, v]) => {
    const out = runCheatSheet([card('Unknown Card', { noFxFee: v })],
                              [rw('Unknown Card', 'General Spend', 2)]);
    check('  ' + what + ' → not offered', intlRow(out.rows) === null,
          JSON.stringify(out.rows.map(r => r.category)));
  });

  const none = runCheatSheet([card('A'), card('B')], [rw('A', 'Dining', 4)]);
  check('the row is absent entirely when nothing is marked',
        intlRow(none.rows) === null,
        JSON.stringify(none.rows.map(r => r.category)) +
        ' — an empty International Travel heading would imply "no good options", ' +
        'when the truth is "nobody has filled this in"');
}

console.log('\nThe flag is read from the sheet the same way');
{
  // The server's coercion, exercised through the real read mapping rather than retyped.
  const mapStart = WEB.indexOf('noFxFee:         String(r[13]');
  check('the read mapping exists', mapStart !== -1);
  const expr = WEB.slice(mapStart + 'noFxFee:'.length, WEB.indexOf(',', mapStart)).trim();
  const coerce = v => {
    const ctx = { String, r: { 13: v } };
    vm.createContext(ctx);
    return vm.runInContext('(' + expr + ')', ctx);
  };

  check("'Yes' → true",   coerce('Yes')   === true);
  check("'yes' → true",   coerce('yes')   === true);
  check("'YES' → true",   coerce('YES')   === true);
  check("' Yes ' → true", coerce(' Yes ') === true, 'a sheet cell picks up stray spaces');
  check("'' → false",      coerce('')      === false);
  check('undefined → false (a sheet that predates the column)',
        coerce(undefined) === false,
        'readSheet reads getLastColumn() columns, so a missing column is undefined — ' +
        'the creditLimit comment above says exactly this');
  check("'No' → false",    coerce('No')    === false);
  check("'true' → false",  coerce('true')  === false,
        'the edit form used to post the boolean back as the string "true"');
  check('a stray value → false', coerce('maybe?') === false,
        'anything unrecognised has to be the cautious answer, not the permissive one');
  check('…and it is NOT defaulted to Yes the way active is',
        !/noFxFee:\s*String\(r\[13\][^)]*\|\|\s*'Yes'/.test(WEB),
        "active defaults to 'Yes' because an unmarked card is presumably in use; an " +
        'unmarked FX flag means unknown, which is a different thing');

  // THE TRAP, asserted where the real expression is in scope. Making noFxFee a tri-state
  // string would have been the obvious way to get a third state for the tracker, and
  // 'No' is truthy — every card marked No would start being offered for foreign
  // purchases at ~3% a time. It stays a boolean; noFxFeeSet carries the third state.
  check('it stays a BOOLEAN, never the raw cell',
        /\.toLowerCase\(\)\s*===\s*'yes'/.test(expr) &&
        typeof coerce('No') === 'boolean' && typeof coerce('Yes') === 'boolean',
        'a tri-state string would invert the cheat-sheet filter\'s meaning: ' +
        JSON.stringify(expr));
}

console.log('\nnoFxFeeSet separates "No" from "nobody has said"');
{
  // The second field exists because noFxFee cannot answer "has anyone told us?" — and
  // that is what the card tracker needs to show a backlog. Driven through the real
  // expression, like the one above.
  const setStart = WEB.indexOf("noFxFeeSet:      String(r[13]");
  check('the companion mapping exists', setStart !== -1,
        'without it the tracker cannot distinguish an unset card from one that charges fees');
  const setExpr = WEB.slice(setStart + 'noFxFeeSet:'.length, WEB.indexOf(',', setStart)).trim();
  const isSet = v => {
    const ctx = { String, r: { 13: v } };
    vm.createContext(ctx);
    return vm.runInContext('(' + setExpr + ')', ctx);
  };

  check("'Yes' is set",       isSet('Yes') === true);
  check("'No' is ALSO set",   isSet('No')  === true,
        'answered, and the answer was no — the whole point of this field');
  check("'' is not set",      isSet('')    === false);
  check("'  ' is not set",    isSet('   ') === false, 'a cell of spaces is nobody answering');
  check('undefined is not set (a sheet that predates the column)',
        isSet(undefined) === false);

  // Nothing may filter on the new field, in the server or either dashboard.
  const filterish = /(filter|if)\s*\([^)]{0,120}noFxFeeSet/;
  [['WebApp.js', WEB], ['docs/app.js', APP], ['docs/dashboard-lite.html', LITE]].forEach(([n, src]) => {
    check('  ' + n + ': noFxFeeSet is never filtered on',
          !filterish.test(src),
          'it is display only. The moment a filter reads it, blank stops meaning ' +
          '"do not offer this one" and the asymmetry the flag exists for is gone');
  });
}

console.log('\nRanked on general spend, not the best rate anywhere');
{
  const out = runCheatSheet([
    card('Dining Star', { noFxFee: true }),
    card('Plain Payer', { noFxFee: true }),
  ], [
    rw('Dining Star', 'Dining',        4,   'x points'),
    rw('Dining Star', 'General Spend', 1,   'x points'),
    // TWO general rows on one card, so "best" and "worst" are distinguishable. With
    // one row each, a mutation flipping > to < produced identical output and its
    // control did not bite.
    rw('Plain Payer', 'General Spend', 2,   '% cash back'),
    rw('Plain Payer', 'Everything Else', 0.5, '% cash back'),
  ]);
  const row = intlRow(out.rows);

  check('the card with the better GENERAL rate ranks first',
        row && row.top[0].cardName === 'Plain Payer',
        JSON.stringify(row && row.top.map(t => t.cardName)) +
        ' — a 4x dining rate is the wrong number to show for a miscellaneous purchase');
  check('…and the rate shown is the general one',
        row && row.top[0].rate === '2' && row.top[1].rate === '1',
        JSON.stringify(row && row.top));
  check('a Dining row never supplies the rate',
        row && !row.top.some(t => t.rateType === 'x points' && t.rate === '4'),
        JSON.stringify(row && row.top));
  check('…and the BEST general row wins, not the first or the worst',
        row && row.top[0].rate === '2',
        JSON.stringify(row && row.top[0]) +
        ' — Plain Payer has both 2% and 0.5% general rows');

  // Everything Else counts as general spend too.
  const alt = runCheatSheet([card('Catchall', { noFxFee: true })],
                            [rw('Catchall', 'Everything Else', 1.5, '% cash back')]);
  check("'Everything Else' counts as general spend",
        intlRow(alt.rows).top[0].rate === '1.5',
        JSON.stringify(intlRow(alt.rows).top));
}

console.log('\nA fee-free card with no general rate still appears');
{
  const out = runCheatSheet([
    card('Rated',   { noFxFee: true }),
    card('Unrated', { noFxFee: true }),
  ], [rw('Rated', 'General Spend', 2, '% cash back')]);
  const row = intlRow(out.rows);

  check('both are listed', row && row.top.length === 2,
        JSON.stringify(row && row.top.map(t => t.cardName)) +
        ' — it is still a card you can use abroad for free');
  check('…the rated one first', row && row.top[0].cardName === 'Rated');
  check('…and the unrated one last, with no rate',
        row && row.top[1].cardName === 'Unrated' && row.top[1].rate === '',
        JSON.stringify(row && row.top));
  check('…rendering as the bare card name, not "Unrated (  )"',
        out.label(row.top[1]) === 'Unrated', JSON.stringify(out.label(row.top[1])));
  check('…while a rated one still reads normally',
        out.label(row.top[0]) === 'Rated (2 % cash back)', JSON.stringify(out.label(row.top[0])));
  check('…and conditions are still appended when present',
        out.label({ cardName: 'C', rate: '3', rateType: 'x', conditions: 'first $6k' })
          === 'C (3 x) | first $6k',
        JSON.stringify(out.label({ cardName: 'C', rate: '3', rateType: 'x', conditions: 'first $6k' })));
  check('…and not left dangling when absent',
        out.label({ cardName: 'C', rate: '3', rateType: 'x', conditions: '' }) === 'C (3 x)');

  // Two unrated cards fall back to alphabetical rather than an unstable order.
  const two = runCheatSheet([card('Zeta', { noFxFee: true }), card('Alpha', { noFxFee: true })], []);
  check('two unrated cards order alphabetically',
        intlRow(two.rows).top.map(t => t.cardName).join(',') === 'Alpha,Zeta',
        JSON.stringify(intlRow(two.rows).top.map(t => t.cardName)));
}

console.log('\nIt obeys the same gates as every other row');
{
  const inactive = runCheatSheet([card('Retired', { noFxFee: true, active: 'No' })],
                                 [rw('Retired', 'General Spend', 2)]);
  check('an inactive fee-free card is not offered',
        intlRow(inactive.rows) === null,
        'the rest of the cheat sheet filters on active === "Yes" and so must this');

  // visibleCards is already owner-filtered by the caller, so passing one owner's cards
  // is what the owner pills do.
  const filtered = runCheatSheet([card('Hers', { noFxFee: true, owner: 'Victoria' })],
                                 [rw('Hers', 'General Spend', 2)]);
  check('…and the row is built from the owner-filtered list',
        intlRow(filtered.rows).top[0].cardName === 'Hers' &&
        /\(visibleCards\s*\|\|\s*\[\]\)/.test(APP),
        'reading from the unfiltered cards would make the row ignore the owner pills');

  const row = intlRow(runCheatSheet(
    [card('A', { noFxFee: true }), card('B', { noFxFee: true }), card('C', { noFxFee: true })],
    [rw('A', 'General Spend', 3), rw('B', 'General Spend', 2), rw('C', 'General Spend', 1)]).rows);
  check('it shows the top 2, like the others', row.top.length === 2,
        JSON.stringify(row.top.map(t => t.cardName)));
  check('…which are the two best', row.top.map(t => t.cardName).join(',') === 'A,B');
}

console.log('\nA typed category of the same name does not double the row');
{
  // The reward Category field is a free-text input, so this is reachable.
  const out = runCheatSheet([card('Mine', { noFxFee: true })], [
    rw('Mine', 'International Travel', 3, 'x points'),
    rw('Mine', 'General Spend', 1, 'x points'),
  ]);
  const matching = out.rows.filter(r => r.category === 'International Travel');
  check('there is exactly ONE International Travel row',
        matching.length === 1, matching.length +
        ' — two rows with the same category is a duplicate React key and the heading twice');
  // Was `top.length <= 2`, which is satisfied by the card listed TWICE — and by the
  // shipped bug that put fee-charging cards here. Pin the contents.
  check('…listing the card exactly once',
        matching[0].top.length === 1 && matching[0].top[0].cardName === 'Mine',
        JSON.stringify(matching[0].top));
  check('…at its typed International Travel rate, not its general-spend one',
        matching[0].top[0].rate === '3', JSON.stringify(matching[0].top[0]) +
        ' — a row the user typed for this category is the most explicit signal there is');
}

// ============================================================================
// THE SHIPPED BUG. byCat groups reward rows by free-text category and is gated only
// on the card being active — it never looks at noFxFee. 'International Travel' is
// typeable, and before the flag existed that was HOW you recorded "use this abroad".
// The old merge was `existing.top.concat(intl).slice(0,2)`, so two typed entries filled
// both slots and every correctly-filtered card was thrown away. The live row ended up
// listing precisely the two cards that DO charge a fee.
console.log('\nA typed row cannot smuggle a fee-charging card into the row');
{
  const out = runCheatSheet([
    card('BMW Card',                { noFxFee: false }),
    card('AMEX Blue Cash Everyday', { noFxFee: false }),
    card('Capital One Venture',     { noFxFee: true  }),
  ], [
    rw('BMW Card',                'International Travel', 1.5),
    rw('AMEX Blue Cash Everyday', 'International Travel', 1, '% cashback'),
    rw('Capital One Venture',     'General Spend',        2),
  ]);
  const row = intlRow(out.rows);
  check('the row exists', !!row, JSON.stringify(out.rows.map(r => r.category)));
  check('…and contains ONLY the fee-free card',
        row && row.top.length === 1 && row.top[0].cardName === 'Capital One Venture',
        JSON.stringify(row && row.top.map(t => t.cardName)));
  check('…with both fee-charging cards gone, typed row or not',
        row && !row.top.some(t => /BMW|Blue Cash/.test(t.cardName)),
        JSON.stringify(row && row.top.map(t => t.cardName)) +
        ' — 1.5x points does not beat a 3% fee');
  check('…and the typed rows survive under their own heading nowhere else',
        out.rows.filter(r => /international travel/i.test(r.category)).length === 1,
        JSON.stringify(out.rows.map(r => r.category)));
}

console.log('\n…and cannot create the row at all when nothing is marked');
{
  // The second path: with intl empty the old code never reconciled, so a typed row
  // rendered alone — the one case the row is supposed to be absent.
  const out = runCheatSheet([card('BMW Card', { noFxFee: false })],
                            [rw('BMW Card', 'International Travel', 1.5)]);
  check('no International Travel row exists',
        out.rows.filter(r => /international travel/i.test(r.category)).length === 0,
        JSON.stringify(out.rows.map(r => r.category)) +
        ' — a heading promising no-FX cards, populated entirely by one that charges');
}

console.log('\nThe reserved category is matched normalised, not by ===');
{
  // An exact === let a trailing space or different casing make a second, visually
  // identical row that escaped every guard.
  [['lower case', 'international travel'],
   ['trailing space', 'International Travel '],
   ['mixed case', 'INTERNATIONAL travel']].forEach(([what, cat]) => {
    const out = runCheatSheet([card('Charges', { noFxFee: false })], [rw('Charges', cat, 9)]);
    check('  ' + what + ' is reserved too',
          out.rows.filter(r => /^\s*international travel\s*$/i.test(r.category)).length === 0,
          JSON.stringify(out.rows.map(r => r.category)));
  });
}

console.log('\nRanked on the best applicable benefit, tier before rate');
{
  const out = runCheatSheet([
    card('Everything 2x', { noFxFee: true }),
    card('Dining 4x',     { noFxFee: true }),
  ], [
    rw('Everything 2x', 'General Spend', 2),
    rw('Dining 4x',     'Dining',        4),
  ]);
  const row = intlRow(out.rows);
  check('a card good on EVERYTHING outranks one good on dining only',
        row.top[0].cardName === 'Everything 2x',
        JSON.stringify(row.top.map(t => t.cardName)) +
        ' — ranking on raw rate would put 4x dining first for a miscellaneous purchase');
  check('…and the conditional rate names its category',
        out.label(row.top[1]) === 'Dining 4x (4 x points · dining)', out.label(row.top[1]));
  check('…while an unconditional one does not',
        out.label(row.top[0]) === 'Everything 2x (2 x points)', out.label(row.top[0]));
}

console.log('\nOnly travel-ish categories count as a basis');
{
  const out = runCheatSheet([card('Grocer', { noFxFee: true })],
                            [rw('Grocer', 'Online Groceries', 5)]);
  const row = intlRow(out.rows);
  check('a 5x groceries rate is NOT offered as a travel basis',
        row.top[0].rate === '', JSON.stringify(row.top[0]) +
        ' — it would read as 5x abroad, which it is not');
  check('…but the card is still listed, as a bare name',
        row.top[0].cardName === 'Grocer' && out.label(row.top[0]) === 'Grocer',
        out.label(row.top[0]) + ' — it is still free to use abroad');

  const hotel = runCheatSheet([card('Hotelier', { noFxFee: true })],
                              [rw('Hotelier', 'Hotels (Prepaid)', 5)]);
  check('a hotels category DOES count', intlRow(hotel.rows).top[0].rate === '5',
        JSON.stringify(intlRow(hotel.rows).top[0]));
}

console.log('\nIt sorts in with the rest');
{
  const out = runCheatSheet([card('X', { noFxFee: true })], [
    rw('X', 'Groceries', 3), rw('X', 'Streaming', 2), rw('X', 'General Spend', 1),
  ]);
  const cats = out.rows.map(r => r.category);
  check('categories stay alphabetical with the derived row among them',
        cats.join(',') === cats.slice().sort((a, b) => a.localeCompare(b)).join(','),
        JSON.stringify(cats));
  check('…and it is actually in there', cats.indexOf('International Travel') !== -1,
        JSON.stringify(cats));
}

// ============================================================================
console.log('\nThe column is writable, not just readable');
{
  const hdr = /const CREDIT_CARD_HEADERS\s*=\s*\[([^\]]*)\]/.exec(CODE);
  check('CREDIT_CARD_HEADERS parses', !!hdr);
  const headers = hdr[1].split(',').map(h => h.trim().replace(/^'|'$/g, ''));
  check("it carries 'No FX Fee'", headers.indexOf('No FX Fee') !== -1, JSON.stringify(headers));

  // DERIVED, not restated. webUpdateCard_ addresses columns by NUMBER, so an index that
  // drifts from the header list writes a field into the wrong column — the FX flag into
  // Notes, silently. Checking every key against the header positions makes that whole
  // class of mistake impossible rather than merely unlikely.
  const cm = /var colMap = \{([^}]*)\}/.exec(extractFn(WEB, 'webUpdateCard_'));
  check('the colMap parses', !!cm);
  const FIELD_TO_HEADER = {
    cardName: 'Card Name', issuer: 'Issuer', last4: 'Last 4', annualFee: 'Annual Fee',
    dueDay: 'Due Day', lastUsed: 'Last Used', owner: 'Owner', authUser: 'Auth User',
    active: 'Active', statementCredit: 'Statement Credit', notes: 'Notes',
    creditLimit: 'Credit Limit', noFxFee: 'No FX Fee',
  };
  const wrong = [];
  cm[1].split(',').forEach(pair => {
    const [k, v] = pair.split(':').map(x => x.trim());
    if (!k) return;
    const want = headers.indexOf(FIELD_TO_HEADER[k]) + 1;
    if (!FIELD_TO_HEADER[k]) { wrong.push(k + ' is not a known header'); return; }
    if (Number(v) !== want) wrong.push(k + ' is ' + v + ' but ' + FIELD_TO_HEADER[k] + ' is column ' + want);
  });
  check('every colMap index matches its header position',
        wrong.length === 0, wrong.join('; '));
  // The other direction. Checking only colMap -> headers passes when an entry is
  // simply absent, and an absent entry means webUpdateCard_ silently never writes
  // that field — which is how its control failed to bite.
  const absent = Object.keys(FIELD_TO_HEADER)
    .filter(k => !new RegExp('\\b' + k + '\\s*:').test(cm[1]));
  check('…and every writable field HAS a colMap entry',
        absent.length === 0, JSON.stringify(absent) +
        ' — a field missing from the map is a field the edit form can never save');

  const add = /sheet\.appendRow\(\[([\s\S]*?)\]\);/.exec(extractFn(WEB, 'webAddCard_'));
  check('webAddCard_ writes every column',
        add && add[1].split('\n').filter(l => l.trim()).length === headers.length,
        add && (add[1].split('\n').filter(l => l.trim()).length + ' values for ' +
                headers.length + ' columns — a short row leaves the new field unwritable'));
  check('…including the new one', /p\.noFxFee/.test(extractFn(WEB, 'webAddCard_')));

  // The live sheet self-heals; no migration step.
  check('the schema helper rewrites the header row when it does not match',
        /function ensureCreditCardSchema_/.test(WEB) &&
        /setValues\(\[CREDIT_CARD_HEADERS\]\)/.test(WEB),
        'without this a populated sheet never gains the header and the column can ' +
        'never be written, because webUpdateCard_ addresses it by number');
  check('…and both write paths go through it',
        (WEB.match(/ensureCreditCardSchema_\(ss\.getSheetByName\(TABS\.CREDIT_CARDS\)\)/g) || []).length >= 2,
        'the add path widening the sheet and the update path not would be a coin flip');
}

// ============================================================================
console.log('\nBoth dashboards got it, and there is one label helper');
{
  [['docs/app.js', APP], ['docs/dashboard-lite.html', LITE]].forEach(([name, src]) => {
    check('  ' + name + ': has the derived row',
          /International Travel/.test(src) &&
          // The declaration, not the bare name: renaming it to GENERAL_SPEND_CATS_UNUSED
          // still satisfied a substring test, so that control did not bite.
          /GENERAL_SPEND_CATS\s*=\s*\{/.test(src) && /GENERAL_SPEND_CATS\[/.test(src),
          'a derived row that works in one copy and not the other is half shipped');
    check('  ' + name + ': has the icon',
          /'International Travel':\s*'🌍'/.test(src));
    check('  ' + name + ': declares cheatLabel once',
          (src.match(/function cheatLabel\(/g) || []).length === 1);
    // The WHOLE file with the helper's own body cut out. Slicing from the helper
    // onwards missed copyCheatSheet in docs/app.js, which sits BEFORE it — so a
    // reintroduced copy there went unnoticed and its control did not bite.
    const helperBody = extractFn(src, 'cheatLabel');
    const outsideHelper = helperBody ? src.split(helperBody).join('') : src;
    check('  ' + name + ': no hand-built label survives anywhere else',
          !/r\.cardName\s*\+\s*' \('\s*\+\s*r\.rate/.test(outsideHelper),
          'the panel and the Copy button each built this string independently, which ' +
          'is how one could be fixed and the other left disagreeing with it');
    check('  ' + name + ': the modal converts the boolean to Yes/No',
          /noFxFee:\s*\(card\s*&&\s*card\.noFxFee\)\s*\?\s*'Yes'\s*:\s*'No'/.test(src),
          'the server returns a boolean and takes Yes/No back; without this, editing ' +
          'any card posted "true" and silently turned its own flag off');
    // This used to be `/c\.noFxFee\s*&&/` — satisfied by ANY occurrence anywhere in the
    // file, which is why the flag could ship with its entire on-row presence being a
    // conditional glyph nobody could find. The assertions below pin the column itself.
    check('  ' + name + ': the tracker has a No FX column, before Status',
          /'Statement Credit','No FX','Status'/.test(src),
          'the one place a dozen cards can be triaged at a glance; Status stays last ' +
          'because it carries the row action buttons');
    check('  ' + name + ': the cell renders all THREE states',
          /c\.noFxFee\s*\?\s*'🌍 Yes'\s*:\s*c\.noFxFeeSet\s*\?\s*'No'\s*:\s*'Set'/.test(src),
          'Yes / No / never-answered. Collapsing the last two is how the flag became ' +
          'invisible: an unset card looked identical to one that charges fees');
    check('  ' + name + ': the toggle flips the EFFECTIVE value',
          /noFxFee:\s*c\.noFxFee\s*\?\s*'No'\s*:\s*'Yes'/.test(src),
          'so an unset card goes straight to Yes, which is the intent when working ' +
          'through which cards are fee-free');
    check('  ' + name + ': …through update_card, which runs the schema migration',
          /action:\s*'update_card',\s*id:\s*c\.id,\s*noFxFee:/.test(src),
          'no new web action — the first toggle widens the sheet to 14 columns because ' +
          'webUpdateCard_ calls ensureCreditCardSchema_ before writing');
    check('  ' + name + ': the toggle stops the row click propagating',
          /e\.stopPropagation\(\);\s*handleToggleFx\(c\)/.test(src),
          'the <tr> opens the detail modal, so without this every toggle also opens a ' +
          'modal over the change it just made');
    check('  ' + name + ': the duplicate glyph is gone from the Status cell',
          !/c\.noFxFee\s*&&/.test(src),
          'the column carries it now; two indicators for one flag is noise');
  });

  // Was `indexOf('GENERAL_SPEND_CATS') !== -1` — which only ever caught a bundle missing
  // the feature that existed when it was written. A bundle stale by exactly the NEW
  // column sailed through it, and its control did not bite. So compare the whole app
  // block the way docs/build.js --check does: every future feature is then covered
  // without anyone remembering to add a string here.
  {
    const html = fs.readFileSync(ROOT + '/docs/index.html', 'utf8');
    const CLOSE = '</script>\n</body>', OPEN = '<script>';
    const closeAt = html.lastIndexOf(CLOSE);
    const openAt  = closeAt === -1 ? -1 : html.lastIndexOf(OPEN, closeAt);
    const inlined = openAt === -1 ? null : html.slice(openAt + OPEN.length, closeAt);
    const desired = '\n' + APP.replace(/\n+$/, '') + '\n';
    check('index.html was rebuilt from app.js',
          inlined === desired,
          inlined === null ? 'could not find the app block'
            : 'app block ' + inlined.length.toLocaleString() + ' bytes vs app.js ' +
              desired.length.toLocaleString() + ' — run: node docs/build.js');
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
