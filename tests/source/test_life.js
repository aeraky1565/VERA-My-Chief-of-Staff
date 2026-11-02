// Life tab server rules (Life.js, issue #222) on invented data. Explore: which view an interest
// lands in, the trip a debrief came from, duplicates merged, lessons found for a trip, Giving's
// cleaning, totals and the Tax offer, weekend wishes, and the one-time Wish List move. Every
// name and value is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const LIFE = read('Life.js'), LG = read('LifeGrowth.js'), CU = read('ComingUp.js'), MR = read('MonthlyReview.js'), CODE = read('Code.js'), WEB = read('WebApp.js'), CHAT = read('Chat.js'), WP = read('WeekendPlanner.js'), PP = read('PlannedPurchases.js');

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
vm.runInContext(LIFE + '\n' + LG + '\n' + CU, ctx);
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


// ============ Growth ============
console.log('\nrhythm and focus');
check('rhythms read as times a week', [['3× a week', 3], ['3x a week', 3], ['3 times per week', 3], ['daily', 7], ['every day', 7], ['twice a week', 2], ['weekly', 1], ['once a week', 1], ['weekdays', 5], ['', 0], ['whenever', 0], ['8x a week', 7]].every(c => L.lgPerWeek_(c[0]) === c[1]),
  J([['3× a week'], ['daily'], ['twice a week'], ['weekly'], ['8x a week']].map(c => [c[0], L.lgPerWeek_(c[0])])));
check('a monthly rhythm is a fraction of a week', L.lgPerWeek_('4 times a month') === 0.9);
check('focus: stored wins, else the old status', L.lgFocus_('now', 'To Do') === 'now' && L.lgFocus_('', 'Doing') === 'now' && L.lgFocus_('', 'Done') === 'done' && L.lgFocus_('', 'To Do') === 'waiting' && L.lgFocus_('bogus', 'Parked') === 'waiting');
check('milestones: kept tidy, blanks dropped', J(L.lgMilestones_('[{"text":" 5k ","done":1},{"text":""},{"x":1}]')) === J([{ text: '5k', done: true }]) && J(L.lgMilestones_('not json')) === '[]');
check('Now holds three at most', L.lgNowProblem_([{ id: 'a', focus: 'now' }, { id: 'b', focus: 'now' }, { id: 'c', focus: 'now' }], 'd') !== '' && L.lgNowProblem_([{ id: 'a', focus: 'now' }, { id: 'b', focus: 'now' }], 'c') === '' && L.lgNowProblem_([{ id: 'a', focus: 'now' }, { id: 'b', focus: 'now' }, { id: 'c', focus: 'now' }], 'c') === '');

console.log('\npractice');
check('minutes come from the log note', L.lgMinutes_('30 min · pool') === 30 && L.lgMinutes_('from the calendar') === 0);
check('weeks start on Monday', L.lgMonday_('2026-11-04') === '2026-11-02' && L.lgMonday_('2026-11-08') === '2026-11-02' && L.lgMonday_('2026-11-02') === '2026-11-02');
const LOG = ['2026-10-26', '2026-10-28', '2026-10-30', '2026-10-19', '2026-10-21', '2026-10-23', '2026-10-13', '2026-11-03'].map((d, i) => ({ date: d, notes: i === 0 ? '30 min' : i === 7 ? '20 min · lake' : '' }));
LOG.push({ date: '2026-11-09', notes: '' });   // after today: ignored
const pr = L.lgPractice_(LOG, 3, '2026-11-04');
check('8 weeks, oldest first, this week last', pr.weeks.length === 8 && pr.weeks[7].start === '2026-11-02' && pr.weeks[0].start === '2026-09-14');
check('counts per week', J(pr.weeks.slice(4).map(w => w.count)) === J([1, 3, 3, 1]), J(pr.weeks.map(w => w.count)));
check('a week meets the rhythm at 3 of 3', J(pr.weeks.slice(4).map(w => w.met)) === J([false, true, true, false]));
check('the streak counts back from last week; this week still open', pr.streak === 2, pr.streak);
check('this week, last date, days since, minutes this year', pr.thisWeek === 1 && pr.lastDate === '2026-11-03' && pr.daysSince === 1 && pr.minutesYear === 50 && pr.practisedToday === false, J(pr));
check('no rhythm: any practice meets the week', L.lgPractice_([{ date: '2026-11-03', notes: '' }], 0, '2026-11-04').weeks[7].met === true);
check('never practised', L.lgPractice_([], 3, '2026-11-04').daysSince === null && L.lgPractice_([], 3, '2026-11-04').streak === 0);
check('practised today', L.lgPractice_([{ date: '2026-11-04', notes: '' }], 3, '2026-11-04').practisedToday === true);

console.log('\nyear-end review');
const GO = [{ id: 'g1', title: 'Swim', year: 2025, focus: 'now' }, { id: 'g2', title: 'Read', year: 2025, focus: 'done' }, { id: 'g3', title: 'Sail', year: 2026, focus: 'waiting' }];
check('last year’s unfinished goals are offered to this year', J(L.lgCarryOver_(GO, '2026-03-01')) === J([{ id: 'g1', title: 'Swim', year: 2025, toYear: 2026 }]));
check('in December, this year’s unfinished goals are offered to next year', J(L.lgCarryOver_(GO, '2026-12-05').map(c => [c.id, c.toYear])) === J([['g1', 2026], ['g3', 2027]]));

console.log('\ntrials');
const TR = { start: '2026-10-01', end: '2026-10-28', status: 'Active' };
const TL = [{ date: '2026-09-30' }, { date: '2026-10-02' }, { date: '2026-10-20' }, { date: '2026-10-28' }, { date: '2026-10-29' }];
let ts = L.lgTrialState_(TR, TL, '2026-10-21');
check('while it runs: check-ins so far and days left', ts.state === 'active' && ts.checkins === 2 && ts.daysLeft === 7 && ts.weeks === 4, J(ts));
ts = L.lgTrialState_(TR, TL, '2026-10-29');
check('the day after it ends it asks', ts.state === 'ended' && ts.checkins === 3 && ts.daysLeft === null, J(ts));
check('once answered it is decided', L.lgTrialState_(Object.assign({}, TR, { status: 'Kept' }), TL, '2026-11-01').state === 'decided' && L.lgTrialState_(Object.assign({}, TR, { status: 'dropped' }), TL, '2026-11-01').state === 'decided');
check('an old experiment with no end stays active', L.lgTrialState_({ start: '2026-01-01', end: '', status: 'Active' }, [], '2026-11-01').state === 'active');

console.log('\nLife balance');
const bal = L.lgBalance_([{ month: '2026-05', health: 4, relationships: 4, career: 3, money: 3, growth: 3, fun: 2 },
  { month: '2026-09', health: 2, relationships: 4, career: 2, money: 3, growth: 1, fun: 2 },
  { month: '2026-10', health: 2, relationships: 5, career: 3, money: 3, growth: 2, fun: 3 }, { month: 'junk' }]);
check('months oldest first, junk dropped', J(bal.months.map(m => m.month)) === J(['2026-05', '2026-09', '2026-10']));
check('low two months running: ≤ 2 both times', J(bal.low) === J(['health', 'growth']), J(bal.low));
check('one month is not a run', J(L.lgBalance_([{ month: '2026-10', health: 1 }]).low) === '[]');
check('ratings must be 1 to 5', J(L.lgCleanBalance_({ month: '2026-10', health: '5', fun: 9, money: 0 })) === J({ month: '2026-10', health: 5, relationships: null, career: null, money: null, growth: null, fun: null }));
check('the month to rate is last month', L.lgRateMonth_('2026-11-02') === '2026-10' && L.lgRateMonth_('2027-01-15') === '2026-12');
check('the Monthly Life Review asks for it, linking to Review', /sections\.push\(buildLifeBalanceAsk_\(label\)\);/.test(MR) && /'\?tab=life&sub=review'/.test(MR));

console.log('\nwhere my time went');
const EV = [
  { title: 'Dinner with friends', start: '2026-10-07T19:00', end: '2026-10-07T21:30', allDay: false },          // Wed evening, 2.5 h
  { title: 'Swim', start: '2026-10-08T18:00', end: '2026-10-08T19:00', allDay: false },                          // practice 1 h
  { title: 'Groceries', start: '2026-10-10T10:00', end: '2026-10-10T11:00', allDay: false },                     // Sat chores 1 h
  { title: 'Example Coast Trip', start: '2026-10-17T00:00', end: '2026-10-19T00:00', allDay: true },             // Sat+Sun 24 h
  { title: 'Office', start: '2026-10-06T09:00', end: '2026-10-06T17:00', allDay: false },                        // outside free time
  { title: 'Late call', start: '2026-10-06T21:00', end: '2026-10-06T23:00', allDay: false },                     // 1 h counted (to 22:00)
  { title: 'Dinner again', start: '2026-10-07T20:00', end: '2026-10-07T21:00', allDay: false },                  // overlaps: not counted twice
  { title: 'Out of office', start: '2026-10-20T00:00', end: '2026-10-21T00:00', allDay: true },                  // a marker: fills nothing
];
const tb = L.lgTimeBuckets_(EV, '2026-10', [['swim']]), hrs = id => tb.buckets.find(b => b.id === id).hours;
check('free hours: 22 weekday evenings × 4 h + 9 weekend days × 12 h', tb.freeHours === 22 * 4 + 9 * 12, tb.freeHours);
check('friends & family, trips, chores, goal practice, other', hrs('people') === 2.5 && hrs('trips') === 24 && hrs('home') === 1 && hrs('practice') === 1 && hrs('other') === 1, J(tb.buckets));
check('what is left is unplanned', hrs('unplanned') === Math.round((196 - 29.5) * 10) / 10, hrs('unplanned'));
check('six buckets in order', J(tb.buckets.map(b => b.id)) === J(['people', 'trips', 'home', 'practice', 'other', 'unplanned']));

console.log('\nDid it? and nudges');
check('goal words drop filler', J(L.lgGoalWords_('Swim twice a week')) === J(['swim']) && J(L.lgGoalWords_('Learn Spanish better')) === J(['spanish']));
const GN = [{ id: 'g1', title: 'Swim more', focus: 'now' }, { id: 'g2', title: 'Spanish', focus: 'now' }, { id: 'g3', title: 'Pottery', focus: 'waiting' }];
const asks = L.lgDidItAsks_([{ title: 'Swim at the Y' }, { title: 'Pottery wheel' }, { title: 'Spanish class' }], GN, { g2: [{ date: '2026-11-01' }] }, '2026-11-01');
check('a matching event asks for a Now goal not yet logged that day', J(asks) === J([{ goalId: 'g1', goal: 'Swim more', day: '2026-11-01', event: 'Swim at the Y' }]), J(asks));
check('a word inside another word does not match', L.lgDidItAsks_([{ title: 'Unswimmable' }], GN, {}, '2026-11-01').length === 0);
const busy = [{ start: '2026-11-03T18:00', end: '2026-11-03T20:30' }, { start: '2026-11-04T17:00', end: '2026-11-04T21:00' }];
check('a free slot: the first evening with room (30 min fits after 20:30)', J(L.lgFreeSlot_(busy, '2026-11-02', 30)) === J({ day: '2026-11-03', from: '20:30' }), J(L.lgFreeSlot_(busy, '2026-11-02', 30)));
check('…and 45 min does not, so it is the next free evening', J(L.lgFreeSlot_(busy, '2026-11-02', 45)) === J({ day: '2026-11-05', from: '18:00' }));
check('…skipping a full evening', J(L.lgFreeSlot_(busy.concat([{ start: '2026-11-03T20:00', end: '2026-11-03T22:00' }]), '2026-11-02', 45)) === J({ day: '2026-11-05', from: '18:00' }));
check('weekends start at 9', J(L.lgFreeSlot_([], '2026-11-06', 45)) === J({ day: '2026-11-07', from: '09:00' }));
const nd = L.lgNudgesDue_(GN, { g1: { daysSince: 9 }, g2: { daysSince: 2 } }, '2026-11-04', 7);
check('nudge a Now goal quiet 7+ days, keyed by week; not a busy one, not a waiting one', J(nd) === J([{ goalId: 'g1', title: 'Swim more', key: 'growth_nudge_g1_2026-11-02', since: 9 }]), J(nd));
check('never practised counts as quiet', L.lgNudgesDue_([{ id: 'x', title: 'X', focus: 'now' }], {}, '2026-11-04', 7)[0].since === null);

console.log('\nChat and goal lookup');
const GF = [{ id: 'g1', title: 'Swim more', focus: 'now' }, { id: 'g2', title: 'Learn Spanish', focus: 'waiting' }, { id: 'g3', title: 'Spanish', focus: 'done' }];
check('a goal by its words', L.lgFindGoal_(GF, 'spanish').id === 'g2' && L.lgFindGoal_(GF, 'swim').id === 'g1' && L.lgFindGoal_(GF, 'Swim more').id === 'g1');
check('a done goal is not found', L.lgFindGoal_([{ id: 'g3', title: 'Spanish', focus: 'done' }], 'spanish') === null && L.lgFindGoal_(GF, '') === null);
check('learning kinds and statuses', J(L.lgCleanLearning_({ kind: 'APP', title: ' Duo ', status: 'nope' })) === J({ id: '', kind: 'app', title: 'Duo', by: '', goalId: '', status: 'In Progress' }));
check('Chat: log_practice, add_learning, start_trial', /else if \(type === 'log_practice'\) \{\s+var lpOut = lgChatLogPractice_\(args\);/.test(CHAT) && /else if \(type === 'add_learning'\) \{\s+var alOut = lgChatAddLearning_\(args\);/.test(CHAT) && /else if \(type === 'start_trial'\) \{\s+var stOut = lgChatStartTrial_\(args\);/.test(CHAT)
  && /'ACTION:log_practice\|\{goal\}\|\{minutes or blank\}\|\{note\}/.test(CHAT));
check('Chat sees the Now goals', /growthNow:\s+\(function\(\) \{ try \{ return lgContextLines_\(\); \}/.test(CHAT) && /'GROWTH GOALS IN NOW \(Life \\u203a Growth; log practice with log_practice\):\\n'/.test(CHAT));

console.log('\nGrowth wiring');
['life_growth', 'life_review'].forEach(a => check('GET ' + a, new RegExp("case '" + a + "':\\s+return jsonOut_\\(webLife").test(WEB)));
['life_goal_save', 'life_goal_carry', 'life_practice_log', 'life_practice_undo', 'life_learning_save', 'life_trial_start', 'life_trial_decide', 'life_did_it', 'life_balance_save']
  .forEach(a => check('POST ' + a, new RegExp("case '" + a + "':\\s+return jsonOut_\\(webLife[A-Za-z]+_\\(body\\)\\);").test(WEB)));
check('practice is the Habits log: one habit per goal, made on first log', /var res = addHabit_\(g\.title/.test(extractFn(LG, 'lgEnsureHabit_')) && /logHabitCompletion_\(hid, d,/.test(extractFn(LG, 'lgLogPractice_')));
check('a second log the same day adds minutes, it is not a second row', /var total = lgMinutes_\(existing\.notes\) \+ m/.test(extractFn(LG, 'lgLogPractice_')));
check('focus keeps the old status in step', /updateGoal_\(goalId, \{ status: fields\.focus === 'now' \? 'Doing' : fields\.focus === 'done' \? 'Done' : 'To Do' \}\)/.test(LG));
check('the nudge is in Notifications and runs nightly', /\{ key: 'growth_nudge',/.test(CODE) && /nightlyStep_\(ctx, 'lgNightly_', lgNightly_\);/.test(CODE) && /sendNudge_\(d\.key, 'Growth: ' \+ d\.title, msg, 'growth_nudge'\)/.test(LG));
check('…at most once a week per goal', /wasRecentlySent_\(d\.key, 60 \* 24 \* 8\)/.test(LG));
check('VERA writes no calendar', !/createEvent|createAllDayEvent|setTitle|deleteEvent/.test(LG + LIFE));


// ============ Coming up ============
console.log('\nComing up: types and leads from Config');
const TY = L.cuTypes_({});
check('no rows: the five defaults', J(TY.map(t => [t.name, t.lead])) === J([['wedding', 60], ['big_event', 30], ['show', 21], ['party', 14], ['dinner', 7]]) && J(TY[0].words) === J(['wedding', 'reception', 'ceremony']));
const TY2 = L.cuTypes_({ 'coming_up_type:recital': 'Recital, Play | 10', 'coming_up_type:broken': 'no lead here', 'coming_up_type:neg': 'x | -3', other: 'y' });
check('rows from Config replace the defaults; bad rows are skipped', J(TY2) === J([{ name: 'recital', words: ['recital', 'play'], lead: 10 }]), J(TY2));
check('coming_up_days, 60 by default', L.cuDays_({}) === 60 && L.cuDays_({ coming_up_days: '45' }) === 45 && L.cuDays_({ coming_up_days: 'soon' }) === 60);
check('a title matches a type by word', L.cuTypeFor_('Sam & Alex Wedding', TY).name === 'wedding' && L.cuTypeFor_('Dinner at Example Bistro', TY).name === 'dinner' && L.cuTypeFor_('Showroom visit', TY) === null);
check('two types: the longer lead wins', L.cuTypeFor_('Wedding dinner', TY).name === 'wedding' && L.cuTypeFor_('Birthday party and concert', TY).name === 'show');
check('kept: a location or guests; otherwise not recurring and not his own', L.cuKeep_({ location: 'X', recurring: true, mine: true }) && L.cuKeep_({ guests: 2, recurring: true, mine: true }) && L.cuKeep_({ recurring: false, mine: false }) && !L.cuKeep_({ recurring: true, mine: false }) && !L.cuKeep_({ recurring: false, mine: true }));

console.log('\nComing up: the cards');
const ev = (id, title, start, end, x) => Object.assign({ id, title, start, end: end || start, allDay: false, location: '', guests: 0, recurring: false, mine: false, description: '' }, x || {});
const EVS = [
  ev('e1', 'Wedding of Example Pair', '2026-12-20T15:00', '2026-12-20T23:00', { location: 'Example Hall, Far Town, VA', guests: 40 }),
  ev('e2', 'Dinner with Sam', '2026-11-06T19:00', '2026-11-06T21:00', { location: 'Example Bistro, Home City', description: 'Potluck. RSVP by Nov 3 please' }),
  ev('e3', 'Concert', '2026-11-06T20:00', '2026-11-06T23:00', { location: 'Example Arena' }),
  ev('e4', 'Brunch', '2026-12-30T11:00', '2026-12-30T12:00', { guests: 3 }),                 // dinner type, 26 days away > 7: not yet
  ev('e5', 'Team lunch', '2026-11-05T12:00', '2026-11-05T13:00', { recurring: true }),     // recurring, no place: skipped
  ev('e6', 'Focus block', '2026-11-05T09:00', '2026-11-05T10:00', { mine: true }),          // untyped
  ev('e7', 'Dinner at ours', '2026-11-01T19:00', '2026-11-01T22:00', { guests: 4 }),        // 3 days ago: How was it?
  ev('e8', 'Old party', '2026-10-25T19:00', '2026-10-25T22:00', { guests: 4 }),             // 9 days ago: gone
  ev('e9', 'Party at Example Lake', '2026-11-10T18:00', '2026-11-10T22:00', { guests: 6 }),// during a trip
];
const DATES = [{ day: '2026-11-06', label: 'Sam birthday', person: 'Sam Example', lead: 14, kind: 'birthday' }, { day: '2026-11-20', label: 'Our anniversary', person: 'Victoria', lead: 21, kind: 'anniversary' }, { day: '2027-03-01', label: 'Far birthday', person: 'Far', lead: 14, kind: 'birthday' }];
const CO = { types: TY, days: 60, today: '2026-11-04', done: {}, trips: [{ label: 'Example Lake Trip', start: '2026-11-09', end: '2026-11-12' }], homeCity: 'Home City' };
let cards = L.cuCards_(EVS, DATES, CO), byId = id => cards.find(c => c.id === id);
check('typed, kept, within their lead; How was it? last', J(cards.map(c => c.id)) === J(['e2', 'e3', 'e9', 'date:2026-11-20:our-anniversary', 'e1', 'e7']), J(cards.map(c => c.id)));
check('a wedding 46 days out shows (lead 60); brunch 26 days out does not (lead 7)', !!byId('e1') && !byId('e4'));
check('recurring with no place, and untyped events, stay out', !byId('e5') && !byId('e6'));
check('a birthday merges into the same-day plan naming that person', J(byId('e2').dates) === J([{ label: 'Sam birthday', person: 'Sam Example', kind: 'birthday' }]) && !cards.some(c => c.id.indexOf('date:2026-11-06') === 0));
check('…and a date with no plan is its own card', byId('date:2026-11-20:our-anniversary').type === 'anniversary' && byId('date:2026-11-20:our-anniversary').daysAway === 16);
check('a date past its own lead waits', !cards.some(c => /Far birthday/.test(c.title)));
check('three days after, How was it?; older ones are gone', byId('e7').after === true && byId('e7').daysAway === -3 && !byId('e8'));
check('answered once, it is gone', !L.cuCards_(EVS, DATES, Object.assign({}, CO, { done: { e7: '2026-11-03' } })).some(c => c.id === 'e7'));
check('the horizon caps a long lead', !L.cuCards_(EVS, [], Object.assign({}, CO, { days: 30 })).some(c => c.id === 'e1'));

console.log('\nComing up: prep and clashes');
const kinds = id => byId(id).prep.map(p => p.kind);
check('dinner: gift for the merged birthday, RSVP, leave-by, bring', J(kinds('e2')) === J(['gift', 'rsvp', 'leave_by', 'bring']), J(byId('e2').prep));
check('the gift names the person, RSVP quotes the description', byId('e2').prep[0].label === 'Plan a gift for Sam Example' && byId('e2').prep[1].label === 'RSVP by Nov 3 please');
check('a wedding out of town: gift and a trip, no leave-by that far ahead', J(kinds('e1')) === J(['gift', 'trip']), J(kinds('e1')));
check('a show near home: leave-by only', J(kinds('e3')) === J(['leave_by']), J(kinds('e3')));
check('an anniversary: a gift', J(kinds('date:2026-11-20:our-anniversary')) === J(['gift']));
check('a party: gift and bring', J(kinds('e9')) === J(['gift', 'bring']));
check('How was it? has no prep', byId('e7').prep.length === 0);
check('hosting at ours opens Hosting', L.cuCards_([ev('h', 'Hosting game night party', '2026-11-08T19:00', '2026-11-08T23:00', { guests: 5 })], [], CO)[0].prep.some(p => p.kind === 'hosting'));
check('two evening plans that overlap clash, both ways', byId('e2').clash === 'Overlaps Concert at 20:00' && byId('e3').clash === 'Overlaps Dinner with Sam at 19:00', byId('e2').clash + ' / ' + byId('e3').clash);
check('a plan during a trip says so', byId('e9').clash === 'During Example Lake Trip');
check('no clash, no line', byId('e1').clash === '');
check('leave-by: start less the drive and ten minutes', L.cuLeaveBy_('19:00', 35) === '18:15' && L.cuLeaveBy_('', 35) === '' && L.cuLeaveBy_('19:00', null) === '');

console.log('\nComing up: wiring');
check('GET coming_up and coming_up_leave_by', /case 'coming_up':\s+return jsonOut_\(webComingUp_\(\)\);/.test(WEB) && /case 'coming_up_leave_by':\s+return jsonOut_\(webComingUpLeaveBy_\(e\.parameter\)\);/.test(WEB));
check('POST coming_up_debrief and coming_up_bring', /case 'coming_up_debrief':\s+return jsonOut_\(webComingUpDebrief_\(body\)\);/.test(WEB) && /case 'coming_up_bring':\s+return jsonOut_\(webComingUpBring_\(body\)\);/.test(WEB));
check('the Config rows are seeded once, never over a row you have', /if \(props\.getProperty\(CU_SEEDED_PROP_\)\) return 0;/.test(CU) && /if \(!have\[p\[0\]\]\) \{ sheet\.appendRow\(p\); added\+\+; \}/.test(CU));
check('separate from the PTO milestones', !/getMilestones_/.test(CU.replace(/^ \*.*$/gm, '')));
check('How was it? logs a note or a favourite', /createInterest_\('Ahmed', text, 'Other', 'Manual', 'After ' \+ title\)/.test(CU) && /webAddNote_\(\{ parameter: \{ title: 'After ' \+ title/.test(CU));
check('leave-by reuses the trips drive-time cache', /loadTravelLegCache_\(\)/.test(CU) && /fetchTravelLeg_\(from, to, 'driving', apiKey\)/.test(CU));
check('VERA writes no calendar here either', !/createEvent|createAllDayEvent|setTitle|deleteEvent/.test(CU));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
