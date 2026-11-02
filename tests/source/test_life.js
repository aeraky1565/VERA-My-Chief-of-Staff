// Life tab server rules (Life.js, issue #222) on invented data. Explore: which view an interest
// lands in, the trip a debrief came from, duplicates merged, lessons found for a trip, Giving's
// cleaning, totals and the Tax offer, weekend wishes, and the one-time Wish List move. Every
// name and value is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const LIFE = read('Life.js'), WEB = read('WebApp.js'), CHAT = read('Chat.js'), WP = read('WeekendPlanner.js'), PP = read('PlannedPurchases.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(LIFE, ctx);
const L = ctx;

// ============ Explore: interests ============
console.log('\nwhich view an interest is in');
const TRIPS = [{ label: 'Example Coast Trip', endDate: '2026-06-10' }, { label: 'Hill Town Weekend', endDate: '2026-09-01' }];
const it = (id, date, person, interest, category, source, notes) => ({ id, date, person, interest, category, source: source || 'Manual', notes: notes || '' });
check('Chat entry the day after a trip ended is from that trip', L.lfTripFor_(it('I1', '2026-06-11', 'Ahmed', 'x', 'Food', 'Chat'), TRIPS) === 'Example Coast Trip');
check('…up to four days after', L.lfTripFor_(it('I1', '2026-06-14', 'Ahmed', 'x', 'Food', 'Chat'), TRIPS) === 'Example Coast Trip');
check('…not five', L.lfTripFor_(it('I1', '2026-06-15', 'Ahmed', 'x', 'Food', 'Chat'), TRIPS) === null);
check('…and not before the trip ended', L.lfTripFor_(it('I1', '2026-06-09', 'Ahmed', 'x', 'Food', 'Chat'), TRIPS) === null);
check('a manual entry in the window is not a debrief', L.lfTripFor_(it('I1', '2026-06-11', 'Ahmed', 'x', 'Food', 'Manual'), TRIPS) === null);
check('two trips in range: the later one wins', L.lfTripFor_(it('I1', '2026-06-12', 'Ahmed', 'x', 'Food', 'Chat'), [{ label: 'A', endDate: '2026-06-09' }, { label: 'B', endDate: '2026-06-11' }]) === 'B');
check('a debrief entry is a lesson', L.lfKind_(it('I', '', 'Ahmed', 'Seafood shack', 'Food'), null, 'Example Coast Trip') === 'lesson');
check('"skip: …" is a lesson even without a trip', L.lfKind_(it('I', '', 'Ahmed', 'skip: the cable car, Example City', 'Travel'), null, null) === 'lesson');
check('Travel and Food are places', L.lfKind_(it('I', '', 'Ahmed', 'Old harbour', 'Travel'), null, null) === 'place' && L.lfKind_(it('I', '', 'Ahmed', 'Corner bakery', 'Food'), null, null) === 'place');
check('everything else is a thing we love', L.lfKind_(it('I', '', 'Ahmed', 'Jazz nights', 'Culture'), null, null) === 'thing');
check('a tag set by hand wins', L.lfKind_(it('I', '', 'Ahmed', 'Old harbour', 'Travel'), { tag: 'thing' }, null) === 'thing' && L.lfKind_(it('I', '', 'Ahmed', 'Seafood', 'Food'), { tag: 'place' }, 'Example Coast Trip') === 'place');
check('an unknown tag is ignored', L.lfKind_(it('I', '', 'Ahmed', 'Jazz', 'Culture'), { tag: 'banana' }, null) === 'thing');

console.log('\nthe three views');
const INTS = [
  it('I1', '2026-06-11', 'Ahmed', 'Seafood shack, Example Coast', 'Food', 'Chat'),
  it('I2', '2026-03-01', 'Victoria', 'Corner bakery', 'Food'),
  it('I3', '2026-04-01', 'Victoria', 'Corner Bakery!', 'Food', 'Manual', 'the almond one'),
  it('I4', '2026-04-02', 'Ahmed', 'Corner bakery', 'Food'),
  it('I5', '2026-05-01', 'Ahmed', 'Jazz nights', 'Culture'),
  it('I6', '2026-09-02', 'Ahmed', 'skip: the gondola, Hill Town', 'Travel', 'Chat'),
  it('I7', '2026-01-05', 'Ahmed', 'Pottery class', 'Hobbies'),
];
const v = L.lfInterestViews_(INTS, { I7: { tag: 'lesson', trip: 'Hand-picked Trip' } }, TRIPS);
check('places: same words and person merge, newest first', J(v.places.map(p => [p.text, p.person, p.count])) === J([['Corner bakery', 'Ahmed', 1], ['Corner Bakery!', 'Victoria', 2]]), J(v.places.map(p => [p.text, p.person, p.count])));
check('a merged place keeps every id, the dates, and a note', J(v.places[1].ids) === J(['I2', 'I3']) && v.places[1].firstDate === '2026-03-01' && v.places[1].lastDate === '2026-04-01' && v.places[1].notes === 'the almond one' && v.places[1].id === 'I3');
check('the same words from two people stay two', v.places.length === 2);
check('things: the rest', J(v.things.map(t => t.text)) === J(['Jazz nights']));
check('lessons grouped by trip, newest trip first', J(v.lessonsByTrip.map(g => [g.trip, g.items.map(i => i.text)])) === J([['Hill Town Weekend', ['skip: the gondola, Hill Town']], ['Example Coast Trip', ['Seafood shack, Example Coast']], ['Hand-picked Trip', ['Pottery class']]]), J(v.lessonsByTrip.map(g => [g.trip, g.items.map(i => i.text)])));
check('a lesson with no trip sits under "Other lessons"', L.lfInterestViews_([it('X', '2026-01-01', 'Ahmed', 'skip: queues', 'Travel')], {}, []).lessonsByTrip[0].trip === 'Other lessons');
check('nothing is lost between views', v.places.reduce((n, p) => n + p.count, 0) + v.things.length + v.lessons.length === INTS.length);

console.log('\nlessons for a trip');
check('place words drop trip words, years and short words', J(L.lfPlaceWords_('Our Example Coast Trip 2027 to the sea')) === J(['example', 'coast', 'sea']));
check('a new trip to the same coast finds that lesson', J(L.lfLessonsFor_('Example Coast getaway', v.lessons).map(l => l.text)) === J(['Seafood shack, Example Coast']));
check('a lesson mentioning the place in its text matches too', J(L.lfLessonsFor_('Hill Town', v.lessons).map(l => l.text)) === J(['skip: the gondola, Hill Town']));
check('a trip name with only stop words matches nothing', L.lfLessonsFor_('The Trip 2027', v.lessons).length === 0);
check('another place matches nothing', L.lfLessonsFor_('Desert Lodge', v.lessons).length === 0);

// ============ Giving ============
console.log('\nGiving');
const g1 = L.lfGivingClean_({ kind: 'Donation', organisation: '  Example Food Bank ', date: '2026-03-04T10:00', amount: '$1,250.50', receipt: 'https://example.test/r1' });
check('cleaned: kind, trimmed name, date, money', g1.kind === 'donation' && g1.organisation === 'Example Food Bank' && g1.date === '2026-03-04' && g1.amount === 1250.5 && g1.receipt === 'https://example.test/r1', J(g1));
check('an unknown kind is a donation', L.lfGivingClean_({ kind: 'gift' }).kind === 'donation');
check('hours round to a tenth', L.lfGivingClean_({ kind: 'volunteering', hours: '2.46' }).hours === 2.5);
check('a donation needs an amount, volunteering needs hours', L.lfGivingProblem_(L.lfGivingClean_({ organisation: 'X', date: '2026-01-01' })) === 'How much was given?' && L.lfGivingProblem_(L.lfGivingClean_({ kind: 'volunteering', organisation: 'X', date: '2026-01-01' })) === 'How many hours?');
check('…and a name and a date', L.lfGivingProblem_(L.lfGivingClean_({ amount: 5, date: '2026-01-01' })) === 'Who was it for?' && L.lfGivingProblem_(L.lfGivingClean_({ amount: 5, organisation: 'X' })) === 'When was it?');
check('a complete entry is fine', L.lfGivingProblem_(g1) === '');
const ROWS = [
  g1,
  L.lfGivingClean_({ kind: 'donation', organisation: 'Example Shelter', date: '2026-11-01', amount: 100 }),
  L.lfGivingClean_({ kind: 'volunteering', organisation: 'Example Park', date: '2026-05-01', hours: 3 }),
  L.lfGivingClean_({ kind: 'volunteering', organisation: 'Example Park', date: '2026-06-01', hours: 1.5 }),
  L.lfGivingClean_({ kind: 'donation', organisation: 'Example Library', date: '2025-12-20', amount: 40, receipt: 'https://example.test/r2' }),
];
const tot = L.lfGivingTotals_(ROWS);
check('totals per year, newest first', J(tot.map(t => t.year)) === J([2026, 2025]));
check('2026: money, hours, counts, receipts', tot[0].donated === 1350.5 && tot[0].hours === 4.5 && tot[0].donations === 2 && tot[0].volunteering === 2 && tot[0].withReceipt === 1 && tot[0].receiptTotal === 1250.5, J(tot[0]));
check('2025 on its own', tot[1].donated === 40 && tot[1].hours === 0 && tot[1].withReceipt === 1);
const tax = L.lfTaxGiving_(ROWS, 2026);
check('Tax is offered only donations with a receipt, that year', tax.count === 1 && tax.total === 1250.5 && tax.items[0].organisation === 'Example Food Bank', J(tax));
check('…and nothing for a year with none', L.lfTaxGiving_(ROWS, 2024).count === 0 && L.lfTaxGiving_(ROWS, 2024).total === 0);

// ============ Weekend wishes ============
console.log('\nweekend wishes');
let w = L.lfAddWish_([], 'Corner bakery', '2026-11-02');
w = L.lfAddWish_(w, 'corner  BAKERY', '2026-11-03');
w = L.lfAddWish_(w, '   ', '2026-11-03');
w = L.lfAddWish_(w, 'Jazz nights', '2026-11-04');
check('a wish is added once, blanks never', J(w) === J([{ text: 'Corner bakery', added: '2026-11-02' }, { text: 'Jazz nights', added: '2026-11-04' }]), J(w));
check('the Weekend Planner gets them in its prompt', /weekendWishes:\s+\(function\(\) \{ try \{ return lfWeekendWishLines_\(\); \}/.test(WP) && /=== THINGS WE SAID WE\\'D LIKE TO DO ON A WEEKEND ===/.test(WP) && /Never more than one, and never force it\./.test(WP));

// ============ Wish List move ============
console.log('\nthe Wish List moves to Planned Purchases');
const wp = L.lfWishToPurchase_({ person: 'Victoria', category: 'Home', item: 'Example lamp', description: 'The brass one', urls: 'https://example.test/l1, not-a-link https://example.test/l2', price: 120, status: 'Wanted', dateAdded: '2026-02-01', notes: 'after the move' });
check('as an idea, for its person, with its price', wp.stage === 'idea' && wp.forWho === 'Victoria' && wp.item === 'Example lamp' && wp.budget === 120 && wp.why === 'Wish List · Home');
check('description, links and notes become research notes', J(wp.notes.map(n => [n.text, n.link])) === J([['The brass one', ''], ['Link from the Wish List', 'https://example.test/l1'], ['Link from the Wish List', 'https://example.test/l2'], ['after the move', '']]), J(wp.notes));
check('bought ones stay behind', L.lfWishToPurchase_({ item: 'Old thing', status: 'Purchased' }) === null);
check('someone else is Shared', L.lfWishToPurchase_({ item: 'Rug', person: 'Both' }).forWho === 'Shared');
check('the move runs once, from Planned Purchases', /props\.getProperty\(LF_WISH_MIGRATED_PROP_\)\) return/.test(LIFE) && /try \{ lfMigrateWishList_\(\); \}/.test(extractFn(PP, 'webPlannedPurchases_')));
check('…and skips anything already planned', /if \(!p \|\| have\[lfNorm_\(p\.item\)\]\) return;/.test(LIFE));

// ============ wiring ============
console.log('\nwiring');
['life_interests', 'life_giving', 'life_weekend_wishes'].forEach(a => check('GET ' + a, new RegExp("case '" + a + "':\\s+return jsonOut_\\(webLife").test(WEB)));
check('GET life_tax_giving passes the year', /case 'life_tax_giving':\s+return jsonOut_\(webLifeTaxGiving_\(e\.parameter\)\);/.test(WEB));
['life_interest_tag', 'life_place_to_trip_idea', 'life_add_to_weekend', 'life_weekend_wish_remove', 'life_idea_to_goal', 'life_idea_to_project', 'life_giving_save', 'life_giving_delete']
  .forEach(a => check('POST ' + a, new RegExp("case '" + a + "':\\s+return jsonOut_\\(webLife[A-Za-z]+_\\(body\\)\\);").test(WEB)));
check('Chat can log giving', /'ACTION:log_giving\|\{donation or volunteering\}\|\{organisation\}\|\{amount in dollars, or hours\}/.test(CHAT) && /else if \(type === 'log_giving'\) \{\s+var lgOut = lfChatLogGiving_\(args\);/.test(CHAT));
check('Chat\'s giving reads amount for a donation, hours for volunteering', /if \(kind === 'donation'\) entry\.amount = args\[2\]; else entry\.hours = args\[2\];/.test(LIFE));
check('a place becomes a Trip Ideas brief', /webSaveTripIdea_\(\{ idea: \{ title: lfStr_\(it\.interest, 80\)/.test(LIFE));
check('an idea becomes a goal or a project, and is marked Promoted', /createGoal_\(i\.text/.test(extractFn(LIFE, 'webLifeIdeaToGoal_')) && /createProject_\(i\.text/.test(extractFn(LIFE, 'webLifeIdeaToProject_')) && (LIFE.match(/setValue\('Promoted'\)/g) || []).length === 2);
check('the Tag and Trip columns are added only when tagging', /lfCol_\(sh, 'Tag', false\)/.test(extractFn(LIFE, 'lfInterestTags_')) && /lfCol_\(sh, 'Tag', true\)/.test(extractFn(LIFE, 'webLifeInterestTag_')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
