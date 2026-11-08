// Bucket List release 2 (BucketPlus.js, issue #228): best months (parse, text, overlap), the sample
// trip and vacation days, the award table and points held, direct flights and long weekends, the
// Place Facts cache (one Claude call per place), the routes, and the wiring. Invented places.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'BucketPlus.js'), 'utf8');
const TI = fs.readFileSync(path.join(ROOT, 'TripIdeas.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const PL = fs.readFileSync(path.join(ROOT, 'Places.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const FHEAD = eval((CODE.match(/const PLACE_FACT_HEADERS\s*=\s*(\[[^\]]*\])/) || [])[1]);
const fnSrc = (src, name) => { const i = src.indexOf('function ' + name + '('); let d = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1); } return ''; };

function ctx(o) {
  o = o || {};
  const rows = [FHEAD].concat(o.facts || []);
  const facts = { rows, getLastRow: () => rows.length,
    getRange: (r, c, n, w) => ({ getValues: () => rows.slice(r - 1, r - 1 + n).map(x => { const out = []; for (let i = 0; i < w; i++) out.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return out; }),
      setValues: v => v.forEach((row, i) => row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; })) }),
    appendRow: r => rows.push(r.slice()) };
  const loyalty = o.loyalty ? { getLastRow: () => o.loyalty.length, getDataRange: () => ({ getValues: () => o.loyalty }) } : null;
  const calls = [], set = [];
  const bucket = o.bucket || [{ ID: 'b1', Country: 'Portugal', City: 'Lisbon', 'Best Months': '' }, { ID: 'b2', Country: 'Norway', City: '', 'Best Months': 'Jun–Aug' }];
  const c = { String, Number, Object, Array, Date, JSON, Math, RegExp, isNaN, isFinite, Error, parseInt,
    TABS: { PLACE_FACTS: 'Place Facts', LOYALTY_PROGRAMS: 'Loyalty Programs' }, PLACE_FACT_HEADERS: FHEAD,
    Logger: { log: () => {} },
    getSpreadsheet: () => ({ getSheetByName: n => n === 'Loyalty Programs' ? loyalty : null }), ensureSheet: () => facts,
    getConfigValues: () => o.cfg || {}, plBucketRows_: () => bucket, plLocked_: fn => fn(),
    plSetBucket_: (id, h, v) => { set.push([id, h, v]); return true; },
    callClaudeJsonDetailed_: p => { calls.push(p); return o.claude === null ? { json: null, error: 'down' } : { json: o.claude || { bestMonths: [4, 5, 6, 9, 10], flights: [{ from: 'IAD', minutes: 400 }, { from: 'BWI', minutes: 430, seasonal: true }, { from: 'JFK', minutes: 380 }, { from: 'DCA', minutes: 5 }] } }; },
    tiPtoPerson_: (name, fn, years) => (o.pto || {})[fn()] || { name: fn(), holidays: {}, remaining: {}, found: false },
    readPTOConfig_: () => 'P1', readVictoriaPTOConfig_: () => 'P2' };
  vm.createContext(c);
  vm.runInContext(fnSrc(TI, 'tiDay_') + '\n' + fnSrc(TI, 'tiYmd_') + '\n' + fnSrc(TI, 'tiPtoCost_'), c);
  vm.runInContext(SRC, c);
  c.__facts = rows; c.__calls = calls; c.__set = set;
  return c;
}

console.log('\nbest months');
{
  const c = ctx();
  check('read from words, ranges and numbers', J(c.bpMonths_('Apr–Jun, Sep')) === J([4, 5, 6, 9]) && J(c.bpMonths_('4,5, 10')) === J([4, 5, 10]) && J(c.bpMonths_(['May', 6])) === J([5, 6]) && J(c.bpMonths_('nonsense')) === J([]));
  check('a range can run over New Year', J(c.bpMonths_('Nov-Feb')) === J([1, 2, 11, 12]));
  check('written back compactly', c.bpMonthsText_([4, 5, 6, 9]) === 'Apr–Jun, Sep' && c.bpMonthsText_([1, 2]) === 'Jan, Feb' && c.bpMonthsText_([]) === '');
  const ov = c.bpOverlap_([[4, 5, 6, 9], [5, 6, 7, 8], []]);
  check('months for all places and for some; a place with none doesn’t count', J(ov.all) === J([5, 6]) && J(ov.some) === J([4, 5, 6, 7, 8, 9]) && ov.known === 2);
}

console.log('\nthe sample trip and vacation days');
{
  const c = ctx();
  const s = c.bpSampleTrip_([5, 6], '2027-03-10', 7);
  check('the first Saturday of the first good month from next month on', s.start === '2027-05-01' && s.end === '2027-05-08' && s.monthName === 'May', J(s));
  check('next year when this year’s good months have passed', c.bpSampleTrip_([2], '2027-03-10', 7).start === '2028-02-05');
  check('this month doesn’t count; no months, no sample', c.bpSampleTrip_([3], '2027-03-01', 7).start.slice(0, 7) === '2028-03' && c.bpSampleTrip_([], '2027-03-01', 7) === null);
  const ppl = c.bpPeople_([{ name: 'Sam', remaining: { 2027: 12 }, holidays: { '2027-05-03': 'Spring day' } }, { name: 'Lee', found: false }], s);
  check('each person: days left that year, what the trip uses (holidays bridged), and after', ppl[0].left === 12 && ppl[0].uses === 4 && ppl[0].after === 8 && ppl[0].bridged[0] === 'Spring day' && ppl[1].found === false, J(ppl));
}

console.log('\npoints');
{
  const c = ctx();
  const a = c.bpAwards_({ award_europe_business: 'Air France:55,000', award_europe_economy: 'bad value', foo: 'x' });
  check('the award table: defaults, Config rows win, bad rows ignored', J(a.europe.business) === J(['Air France', 55000]) && J(a.europe.economy) === J(['United', 30000]) && a.asia.business[1] === 80000);
  const b = c.bpBalances_([['ID', 'Program', 'Linked Card', 'Total Points'], ['1', 'United MileagePlus', '', '42,000'], ['2', 'Chase Ultimate Rewards', '', 150000], ['3', 'United MileagePlus', '', 8000], ['4', '', '', 5]]);
  check('points held per programme, and the transferable total', b.by['United MileagePlus'] === 50000 && b.transferable === 150000 && Object.keys(b.by).length === 2);
}

console.log('\nflights and long weekends');
{
  const c = ctx();
  const f = c.bpCleanFacts_({ bestMonths: ['Apr', 5], flights: [{ from: 'iad', minutes: 400 }, { from: 'JFK', minutes: 380 }, { from: 'DCA', minutes: 5 }, { from: 'BWI', minutes: 430, seasonal: 1 }] }, ['IAD', 'DCA', 'BWI']);
  check('only home airports, sensible times, shortest first', J(f.flights) === J([{ from: 'IAD', minutes: 400, seasonal: false }, { from: 'BWI', minutes: 430, seasonal: true }]) && J(f.bestMonths) === J([4, 5]));
  check('a long weekend is a direct flight under 7 hours', c.bpLongWeekend_(f).from === 'IAD' && c.bpLongWeekend_({ flights: [{ from: 'IAD', minutes: 420 }] }) === null);
  check('home airports from Config, or the default', J(c.bpHomes_({ home_airports: 'iad, BWI' })) === J(['IAD', 'BWI']) && J(c.bpHomes_({})) === J(['IAD', 'DCA', 'BWI']));
}

console.log('\nthe Place Facts cache');
{
  const c = ctx();
  const r = c.webBucketFacts_({ id: 'b1' });
  check('one call for a new place, naming the place and the home airports', c.__calls.length === 1 && /Lisbon, Portugal/.test(c.__calls[0]) && /IAD, DCA, BWI/.test(c.__calls[0]) && r.ok && !r.saved);
  check('kept in Place Facts', c.__facts.length === 2 && c.__facts[1][0] === 'lisbon, portugal' && c.__facts[1][1] === 'Apr–Jun, Sep–Oct'.replace('Sep–Oct', 'Sep, Oct') && /IAD/.test(c.__facts[1][2]), J(c.__facts[1]));
  check('fills a blank Best Months on the row', J(c.__set) === J([['b1', 'Best Months', 'Apr–Jun, Sep, Oct']]) && J(r.bestMonths) === J([4, 5, 6, 9, 10]));
  const again = c.webBucketFacts_({ id: 'b1' });
  check('asked again: nothing new is called', c.__calls.length === 1 && again.saved === true);
  const c2 = ctx();
  c2.webBucketFacts_({ id: 'b2' });
  check('a row with its own best months keeps them', c2.__set.length === 0);
  const down = ctx({ claude: null });
  check('Claude down: says so, saves nothing', down.webBucketFacts_({ id: 'b1' }).ok === false && down.__facts.length === 1);
  check('a place that’s gone', c.webBucketFacts_({ id: 'nope' }).ok === false);
  const e = c.webBucketFactsSet_({ id: 'b1', flights: [{ from: 'DCA', minutes: 450 }, { from: 'LAX', minutes: 300 }] });
  check('your own flight times are kept, marked edited, and a refresh won’t replace them', e.ok && J(e.facts.flights) === J([{ from: 'DCA', minutes: 450, seasonal: false }]) && c.__facts[1][4] === 'yes'
    && (c.webBucketFacts_({ id: 'b1', refresh: '1' }), c.__calls.length === 1));
}

console.log('\nwhat GET places and the plan screen add');
{
  const c = ctx({ facts: [['lisbon, portugal', 'Apr–Jun', '[{"from":"IAD","minutes":400}]', '', '']], cfg: { award_cabin: 'economy' },
    loyalty: [['ID', 'Program', 'Linked Card', 'Total Points'], ['1', 'United MileagePlus', '', 1000]] });
  const x = c.bpPlacesExtras_([{ ID: 'b1', Country: 'Portugal', City: 'Lisbon' }, { ID: 'b2', Country: 'Norway' }]);
  check('cached facts by bucket ID, home airports, awards, cabin and points', J(Object.keys(x.facts)) === J(['b1']) && x.facts.b1.flights[0].minutes === 400 && x.homeAirports.length === 3 && x.awards.europe && x.awardCabin === 'economy' && x.points.by['United MileagePlus'] === 1000 && x.longWeekendMinutes === 420);
  const pc = ctx({ pto: { P1: { name: 'Sam', remaining: { 2027: 10 }, holidays: {} }, P2: { name: 'Lee', found: false } } });
  const p = pc.bpPlanExtras_([{ 'Best Months': 'Apr–Jun' }, { 'Best Months': 'May, Jun, Sep' }], { nights: 7 }, '2027-03-01');
  check('the plan: months for all and some, a sample in the first good month, vacation days', J(p.months.all) === J([5, 6]) && p.sample.start === '2027-05-01' && p.people[0].name === 'Sam' && p.people[0].uses === 5 && p.people[0].after === 5 && p.people[1].found === false, J(p));
}

console.log('\nthe wiring');
{
  check('Best Months on the Bucket List, and the Place Facts tab', /'Trip Idea', 'Best Months'\]/.test(CODE) && /PLACE_FACTS:\s+'Place Facts'/.test(CODE) && FHEAD && FHEAD.join() === 'Place,Best Months,Flights,Updated,Edited');
  check('routes: bucket_facts, bucket_facts_set', /case 'bucket_facts':\s+return jsonOut_\(webBucketFacts_\(e\.parameter\)\)/.test(WEB) && /case 'bucket_facts_set':\s+return jsonOut_\(webBucketFactsSet_\(body\)\)/.test(WEB));
  check('GET places and the plan preview add them, guarded', /bpPlacesExtras_\(bucket\)/.test(PL) && /bpPlanExtras_\(items, brief, today\)/.test(PL) && /typeof bpPlacesExtras_ === 'function'/.test(PL));
  check('nothing writes ARIA’s sheet', !/ARIA_SHEET|aria_request|openById/.test(SRC));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
