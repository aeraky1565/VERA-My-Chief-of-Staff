// Travel › Places (issue #228), the server side in Places.js: Occasion on Countries (and the
// one-time move out of Notes), occasion picks and grouping, trip notes per country, upcoming
// trips for Planned, and the places endpoint against an in-memory sheet. Invented places.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'Places.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const HEAD = eval((CODE.match(/const COUNTRIES_HEADERS\s*=\s*(\[[^\]]*\])/) || [])[1]);
const BHEAD = eval((CODE.match(/const BUCKET_LIST_HEADERS\s*=\s*(\[[^\]]*\])/) || [])[1]);

function makeSheet(rows) {
  const s = { rows: rows.map(r => r.slice()) };
  s.getLastRow = () => s.rows.length;
  s.getDataRange = () => ({ getValues: () => s.rows.map(r => r.slice()) });
  s.getRange = (r, c, n, w) => ({
    getValues: () => s.rows.slice(r - 1, r - 1 + (n || 1)).map(x => { const o = []; for (let i = 0; i < (w || 1); i++) o.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return o; }),
    setValues: v => v.forEach((row, i) => { const t = s.rows[r - 1 + i] = s.rows[r - 1 + i] || []; row.forEach((x, j) => { t[c - 1 + j] = x; }); }),
    setValue: v => { const t = s.rows[r - 1] = s.rows[r - 1] || []; t[c - 1] = v; },
  });
  s.appendRow = row => s.rows.push(row.slice());
  return s;
}
function ctx(o) {
  o = o || {};
  const props = Object.assign({}, o.props || {});
  const sheets = { Countries: makeSheet([o.oldHeaders ? HEAD.slice(0, 7) : HEAD].concat(o.visits || [])), 'Bucket List': makeSheet([o.oldBucket ? BHEAD.slice(0, 9) : BHEAD].concat(o.bucket || [])), BucketActivities: makeSheet([['ID', 'Bucket ID', 'Activity', 'Done', 'Added Date']].concat(o.acts || [])) };
  const cache = Object.assign({}, o.cache || {});
  const c = {
    String, Number, Object, Array, Date, JSON, Math, RegExp, isNaN, isFinite, Error,
    Logger: { log: () => {} },
    TABS: { COUNTRIES: 'Countries', BUCKET_LIST: 'Bucket List', BUCKET_ACTIVITIES: 'BucketActivities' }, COUNTRIES_HEADERS: HEAD, BUCKET_LIST_HEADERS: BHEAD,
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] === undefined ? null : cache[k], put: (k, v) => { cache[k] = v; } }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: () => o.today || '2026-11-03' },
    getSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }),
    ensureSheet: (ss, n, h) => sheets[n] || (sheets[n] = makeSheet([h])),
    getConfigValues: () => ({ places_occasions: o.picks || '', home_country: 'United States' }),
    readTripRegistry_: () => ({ rows: o.registry || [] }),
    passportIndexCsv_: () => 'Passport,Portugal,Costa Rica,Spain\n',
    visaNorm_: s => String(s).trim().toLowerCase(),
    resolveIataCountry_: code => ({ LIS: 'Portugal', OPO: 'Portugal', SJO: 'Costa Rica', EWR: 'United States' })[code] || '',
    tripItemsFor_: key => (o.items || {})[key] || [],
    tripCountries_: (items, names, airport) => items.map(it => ({ country: airport(it.code), role: it.role || 'stay' })).filter(x => x.country && x.country !== 'United States'),
    lfViews_: () => o.views || { places: [], things: [], lessons: [] },
    TRIP_IDEAS_HEADERS: ['Idea ID', 'Title'], tiIdeasSheet_: () => null, tiRows_: () => (o.ideas || []).map(i => [i.id, i]), tiIdeaFromRow_: r => r[1],
    webSaveTripIdea_: body => { (o.saved = o.saved || []).push(body.idea); return o.saveFails ? { ok: false, error: 'Give the idea a name' } : { ok: true, idea: Object.assign({ id: 'IDEA-NEW' }, body.idea) }; },
    lfPlaceWords_: s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && ['trip', 'the', 'and'].indexOf(w) === -1),
  };
  vm.createContext(c); vm.runInContext(SRC, c);
  c.__sheets = sheets; c.__props = props; c.__cache = cache; c.__o = o;
  return c;
}

console.log('\nthe columns');
check('Countries gains Occasion after Notes', HEAD.join() === 'ID,Country,City,Year,Traveller,Trip Key,Notes,Occasion');
check('add_country saves the occasion in its own column', /sheet\.appendRow\(\[id, country, city, year, traveller, tripKey, notes, occasion\]\)/.test(WEB) && /var occasion  = \(p\.occasion  \|\| ''\)\.trim\(\);/.test(WEB));
check('the add form sends Occasion as occasion, not as notes', APP.indexOf("tripKey,notes:'',occasion:occasion.trim()});}") !== -1 && APP.indexOf("notes:fields.notes||'',occasion:fields.occasion||''}") !== -1);
check('places is routed', /case 'places':\s*return jsonOut_\(webGetPlaces_\(\)\)/.test(WEB));

console.log('\noccasions');
{
  const c = ctx();
  check('picks: Config list, else the defaults', c.plPicks_('Anniversary, Birthday ,').join() === 'Anniversary,Birthday' && c.plPicks_('').length === 8 && c.plPicks_('')[0] === 'Anniversary');
  check('suggestions: picks first, then used ones, no repeats ignoring case', J(c.plSuggestions_(['Anniversary', 'Birthday'], ['birthday', '10th anniversary', '', 'Mom’s 70th', '10th Anniversary'])) === J(['Anniversary', 'Birthday', '10th anniversary', 'Mom’s 70th']));
  const P = c.plPicks_('');
  check('free text counts under its pick', c.plOccasionGroup_('10th anniversary', P) === 'Anniversary' && c.plOccasionGroup_('Honeymoon redo', P) === 'Honeymoon' && c.plOccasionGroup_('Mom’s 70th birthday', P) === 'Birthday');
  check('…a plural pick still matches ("Family visits" ~ "Family visit")', c.plOccasionGroup_('family visits', P) === 'Family visit');
  check('…anything else is Other; blank is none', c.plOccasionGroup_('Conference + 3 days', P) === 'Other' && c.plOccasionGroup_('  ', P) === '');
}

console.log('\nthe one-time move out of Notes');
{
  const c = ctx();
  const rows = [HEAD, ['c1', 'Italy', 'Rome', 2023, 'Both', '', 'Anniversary', ''], ['c2', 'Japan', 'Tokyo', 2024, 'Both', '', 'note', 'Holiday'], ['c3', 'Greece', 'Athens', 2019, 'Both', '', '', ''], ['', '', '', '', '', '', 'stray', '']];
  const r = c.plMoveOccasions_(rows);
  check('Notes moves into a blank Occasion and Notes is cleared', r.rows[1][6] === '' && r.rows[1][7] === 'Anniversary');
  check('a filled Occasion is never overwritten, its Notes kept', r.rows[2][6] === 'note' && r.rows[2][7] === 'Holiday');
  check('empty rows and rows without an ID are left alone', r.rows[3][7] === '' && r.rows[4][6] === 'stray' && r.moved === 1);
  const s = ctx({ visits: [['c1', 'Italy', 'Rome', 2023, 'Both', '', 'Anniversary', ''], ['c2', 'Japan', 'Tokyo', 2024, 'Both', '', 'Holiday', '']] });
  s.webGetPlaces_();
  check('it runs on the first places read', s.__sheets.Countries.rows[1][7] === 'Anniversary' && s.__sheets.Countries.rows[2][7] === 'Holiday' && /moved 2/.test(s.__props.PL_OCCASION_MOVED));
  s.__sheets.Countries.rows.push(['c3', 'Peru', 'Cusco', 2026, 'Both', '', 'a note', '']);
  s.webGetPlaces_();
  check('…and only once: later notes stay notes', s.__sheets.Countries.rows[3][6] === 'a note' && s.__sheets.Countries.rows[3][7] === '');
  const old = ctx({ oldHeaders: true, visits: [['c1', 'Italy', 'Rome', 2023, 'Both', '', 'Birthday']] });
  const out = old.webGetPlaces_();
  check('an older tab gets the Occasion header, then the move', old.__sheets.Countries.rows[0].join() === HEAD.join() && out.visits[0].Occasion === 'Birthday', J(out.visits));
}

console.log('\nwhat we thought, per country');
{
  const c = ctx();
  const visits = [{ Country: 'Japan', City: 'Kyoto', 'Trip Key': '2024-04-02|Japan cherry blossoms' }, { Country: 'Italy', City: 'Florence' }];
  const n = c.plNotesFor_(visits, {
    loved: [{ text: 'Kyoto depachika food halls' }, { text: 'Florence cooking class' }, { text: 'kyoto depachika food halls' }, { text: 'Lisbon trams' }],
    lessons: [{ text: 'Fewer cities next time', trip: 'Japan cherry blossoms' }, { text: 'Book the ryokan early', trip: '' }],
  }, c.lfPlaceWords_ || (s => String(s).toLowerCase().split(/\s+/).filter(w => w.length > 2)));
  check('loved: matched by the country’s cities, no duplicates', J(n.Japan.loved) === J(['Kyoto depachika food halls']) && J(n.Italy.loved) === J(['Florence cooking class']), J(n));
  check('next time: a lesson from that trip', J(n.Japan.next) === J(['Fewer cities next time']));
  check('a country with nothing to say has no entry', !c.plNotesFor_([{ Country: 'Peru' }], { loved: [{ text: 'Kyoto' }], lessons: [] }, s => String(s).toLowerCase().split(/\s+/)).Peru);
}

console.log('\nplanned');
{
  const c = ctx();
  const rows = [
    { status: 'active', startDate: '2027-06-12', endDate: '2027-06-22', label: 'Lisbon & Porto' },
    { status: 'active', startDate: '2026-10-01', endDate: '2026-10-05', label: 'Past' },
    { status: 'active', startDate: '2026-11-01', endDate: '2026-11-08', label: 'Under way' },
    { status: 'cancelled', startDate: '2027-02-01', endDate: '2027-02-08', label: 'Gone' },
    { status: 'active', startDate: '2029-01-01', endDate: '2029-01-08', label: 'Too far' },
  ];
  check('upcoming: active, not ended, within 18 months, soonest first', c.plUpcoming_(rows, '2026-11-03').map(r => r.label).join() === 'Under way,Lisbon & Porto');
  const s = ctx({ registry: [{ status: 'active', startDate: '2027-06-12', endDate: '2027-06-22', label: 'Lisbon & Porto' }, { status: 'active', startDate: '2027-02-10', endDate: '2027-02-18', label: 'Costa Rica' }],
    items: { '2027-06-12|Lisbon & Porto': [{ code: 'LIS' }, { code: 'OPO' }, { code: 'MAD', role: 'layover' }], '2027-02-10|Costa Rica': [{ code: 'SJO' }] } });
  const p = s.plPlanned_();
  check('countries stayed in on upcoming trips, layovers left out, once per trip', J(p.map(x => x.country + '@' + x.label)) === J(['Costa Rica@Costa Rica', 'Portugal@Lisbon & Porto', 'Portugal@Lisbon & Porto']) || J([...new Set(p.map(x => x.country + '@' + x.label))]) === J(['Costa Rica@Costa Rica', 'Portugal@Lisbon & Porto']), J(p));
  check('cached for 6 hours', !!s.__cache.pl_planned_v1);
  const hit = ctx({ cache: { pl_planned_v1: J([{ country: 'Peru', tripKey: 'k', label: 'x' }]) } });
  check('a cached answer is used as is', hit.plPlanned_()[0].country === 'Peru');
}

console.log('\nthe endpoint');
{
  const c = ctx({ visits: [['c1', 'Italy', 'Rome', 2023, 'Both', '', '', '10th anniversary']],
    bucket: [['b1', 'Norway', '', 2028, 'Both', 5, 'Yes', '', ''], ['b2', 'Japan', 'Kyoto', '', 'Both', 3, '', '', '2024']],
    registry: [{ status: 'active', startDate: '2027-02-10', endDate: '2027-02-18', label: 'Costa Rica' }], items: { '2027-02-10|Costa Rica': [{ code: 'SJO' }] },
    views: { places: [{ text: 'Rome at night' }], things: [], lessons: [] } });
  const r = c.webGetPlaces_();
  check('visits by header, with Occasion', r.visits.length === 1 && r.visits[0].Country === 'Italy' && r.visits[0].Occasion === '10th anniversary');
  check('bucket: every place, visited ones flagged', r.bucket.map(b => b.Country + ':' + b.visited).join() === 'Norway:false,Japan:true');
  check('planned comes along', r.planned.length === 1 && r.planned[0].country === 'Costa Rica');
  check('notes per country', r.notes.Italy && r.notes.Italy.loved[0] === 'Rome at night');
  check('occasion suggestions include what was used', r.occasions.indexOf('10th anniversary') !== -1 && r.picks[0] === 'Anniversary');
}

console.log('\nthe Bucket List');
{
  check('Bucket List gains Occasion and Trip Idea at the end', BHEAD.slice(9).join() === 'Occasion,Trip Idea' && BHEAD.slice(0, 9).join() === 'ID,Country,City,Target Year,Traveller,Stars,Dream Trip,Notes,Visited');
  check('add_bucket_item writes the occasion, Trip Idea blank', /sheet\.appendRow\(\[id, country, city, targetYear, traveller, stars, dreamTrip, notes, '', occasion, ''\]\);/.test(WEB) && /var occasion   = \(p\.occasion   \|\| ''\)\.trim\(\);/.test(WEB));
  check('update_bucket_item edits the rest by header', /\[\['occasion', 'Occasion'\], \['notes', 'Notes'\], \['city', 'City'\], \['traveller', 'Traveller'\], \['dreamTrip', 'Dream Trip'\], \['targetYear', 'Target Year'\]\]/.test(WEB));
  check('the add form sends the occasion', APP.indexOf("dreamTrip:fields.dreamTrip||'',notes:fields.notes||'',occasion:fields.occasion||''}") !== -1 && APP.indexOf("notes:notes.trim(),occasion:occasion.trim()});}") !== -1);
  const c = ctx({ oldBucket: true, bucket: [['b1', 'Portugal', 'Lisbon', 2027, 'Both', 4, '', 'stay in Alfama', ''], ['b2', 'Norway', '', 2028, 'Both', 5, 'Fjords by train', '', ''], ['b3', 'Japan', 'Kyoto', '', 'Both', 3, '', '', '2024']],
    acts: [['a1', 'b1', 'Tram 28', '', ''], ['a2', 'b1', 'Pastéis in Belém', 'yes', ''], ['a3', 'b9', 'orphan', '', ''], ['a4', 'b2', 'Flåm railway', 'FALSE', '']] });
  const r = c.webGetPlaces_();
  check('an older tab gets the two new headers', c.__sheets['Bucket List'].rows[0].join() === BHEAD.join());
  const b1 = r.bucket.find(b => b.ID === 'b1');
  check('each place carries its things to do, in order, done read as yes', JSON.stringify(b1.activities.map(a => a.activity + ':' + a.done)) === JSON.stringify(['Tram 28:false', 'Pastéis in Belém:true']));
  check('"FALSE" is not done; an orphan activity goes nowhere', r.bucket.find(b => b.ID === 'b2').activities[0].done === false && !JSON.stringify(r.bucket).includes('orphan'));
  const items = [{ ID: '1', visited: false, Stars: 4 }, { ID: '2', visited: false, 'Dream Trip': 'Fjords', Stars: 5 }, { ID: '3', visited: true, Stars: 5, Occasion: 'Birthday' }, { ID: '4', visited: false, Occasion: 'Honeymoon redo', Stars: 2 }];
  const ids = f => c.plBucketView_(items, f).map(x => x.ID).join();
  check('filters: not yet visited', ids('open') === '1,2,4');
  check('filters: dream trips, for an occasion, 4★ and up leave visited ones out', ids('dream') === '2' && ids('occasion') === '4' && ids('stars') === '1,2');
  check('filters: all', ids('all') === '1,2,3,4');
}

console.log('\nplan as one trip: the brief');
{
  const c = ctx();
  const items = [
    { ID: 'b1', Country: 'Portugal', City: 'Lisbon', 'Target Year': 2027, Traveller: 'Both', Notes: 'stay in Alfama', Occasion: '10th anniversary',
      activities: [{ activity: 'Tram 28', done: false }, { activity: 'Pastéis in Belém', done: true }] },
    { ID: 'b2', Country: 'Portugal', City: 'Porto', 'Target Year': 2028, Traveller: 'Both', Notes: '', Occasion: '', activities: [{ activity: 'Port lodges', done: false }] },
    { ID: 'b3', Country: 'Portugal', City: 'Douro Valley', 'Target Year': '', Traveller: 'Victoria', Notes: 'a night at a quinta', Occasion: '', activities: [] },
  ];
  const b = c.plBriefFrom_(items, '2026-11-03', c.plPicks_(''));
  check('title: the occasion leads, then the country and cities', b.title === '10th anniversary in Portugal: Lisbon, Porto, Douro Valley', b.title);
  check('where: the cities, with the country once', b.where === 'Lisbon, Porto, Douro Valley (Portugal)', b.where);
  check('months: all of the earliest target year', b.months.length === 12 && b.months[0] === '2027-01' && b.months[11] === '2027-12');
  check('who: mixed means both of us', b.travelers === 'Ahmed and Victoria');
  check('must haves: the anniversary dinner, then each place’s notes', b.mustHaves === 'Anniversary dinner on the night itself. Lisbon: stay in Alfama Douro Valley: a night at a quinta', b.mustHaves);
  check('wishes: things not done yet, tagged with their place', JSON.stringify(b.pieces) === JSON.stringify([{ kind: 'wish', name: 'Tram 28', detail: 'Lisbon, Portugal' }, { kind: 'wish', name: 'Port lodges', detail: 'Porto, Portugal' }]), JSON.stringify(b.pieces));
  check('the occasion comes along', b.occasion === '10th anniversary');
  const one = c.plBriefFrom_([{ Country: 'Norway', 'Target Year': 2026, Traveller: 'Ahmed', Notes: 'by train', activities: [] }], '2026-11-03', []);
  check('one place, no city: the country; this year means from next month', one.title === 'Norway' && one.where === 'Norway' && one.months.join() === '2026-12' && one.travelers === 'Ahmed' && one.mustHaves === 'by train', JSON.stringify(one));
  check('a past target year gives no months', c.plBriefFrom_([{ Country: 'Peru', 'Target Year': 2020 }], '2026-11-03', []).months.length === 0);
  const two = c.plBriefFrom_([{ Country: 'Spain', City: 'Seville' }, { Country: 'Portugal', City: 'Lisbon', Occasion: 'Mom’s 70th birthday' }], '2026-11-03', c.plPicks_(''));
  check('two countries: each city with its country; a birthday dinner', two.where === 'Seville (Spain), Lisbon (Portugal)' && /^Mom’s 70th birthday in Spain & Portugal/.test(two.title) && /^Birthday dinner/.test(two.mustHaves), JSON.stringify(two));
}

console.log('\nplan as one trip: saving');
{
  const c = ctx({ bucket: [['b1', 'Portugal', 'Lisbon', 2027, 'Both', 4, '', 'stay in Alfama', '', '10th anniversary', ''], ['b2', 'Portugal', 'Porto', 2027, 'Both', 4, '', '', '', '', ''], ['b3', 'Peru', '', '', 'Both', 3, '', '', '', '', '']],
    acts: [['a1', 'b1', 'Tram 28', '', '']] });
  const pv = c.webPlacesPlanPreview_({ bucketIds: ['b1', 'b2'] });
  check('preview: the brief and the places', pv.ok && pv.places.join('|') === 'Lisbon, Portugal|Porto, Portugal' && pv.brief.pieces.length === 1);
  check('preview: nothing chosen is an error', c.webPlacesPlanPreview_({ bucketIds: [] }).ok === false);
  const r = c.webPlacesPlanIdea_({ bucketIds: ['b1', 'b2'], edits: { title: 'Portugal for our 10th', mustHaves: 'Alfama' } });
  const saved = c.__o.saved[0];
  check('saves through Trip Ideas, with the edits over the brief', r.ok && saved.title === 'Portugal for our 10th' && saved.mustHaves === 'Alfama' && saved.where === 'Lisbon, Porto (Portugal)' && saved.status === 'brainstorming' && saved.pieces[0].name === 'Tram 28', JSON.stringify(saved));
  const rows = c.__sheets['Bucket List'].rows, col = BHEAD.indexOf('Trip Idea');
  check('each chosen place links to the new idea; others don’t', rows[1][col] === 'IDEA-NEW' && rows[2][col] === 'IDEA-NEW' && !rows[3][col]);
  check('Trip Ideas reads the link back: places by idea', JSON.stringify(c.plBucketForIdeas_()) === JSON.stringify({ 'IDEA-NEW': ['Lisbon, Portugal', 'Porto, Portugal'] }));
  const bad = ctx({ saveFails: true, bucket: [['b1', 'Peru', '', '', 'Both', 3, '', '', '', '', '']] });
  check('a failed save links nothing', bad.webPlacesPlanIdea_({ bucketIds: ['b1'], edits: { title: '' } }).ok === false && !bad.__sheets['Bucket List'].rows[1][col]);
  check('the routes and the Trip Ideas join are wired', /case 'places_plan_preview':\s*return jsonOut_\(webPlacesPlanPreview_\(body\)\)/.test(WEB) && /case 'places_plan_idea':\s*return jsonOut_\(webPlacesPlanIdea_\(body\)\)/.test(WEB)
    && /if \(fromBucket\[i\.id\]\) i\.fromBucket = fromBucket\[i\.id\];/.test(fs.readFileSync(path.join(ROOT, 'TripIdeas.js'), 'utf8')));
}

console.log('\nafter the trip');
{
  const c = ctx();
  const bucket = [{ ID: 'b1', 'Trip Idea': 'I1' }, { ID: 'b2', 'Trip Idea': 'I1', Visited: '2027' }, { ID: 'b3', 'Trip Idea': 'I2' }, { ID: 'b4', 'Trip Idea': '' }, { ID: 'b5', 'Trip Idea': 'I3' }];
  const ideas = [{ id: 'I1', tripId: 'TRIP-1' }, { id: 'I2', tripId: 'TRIP-2' }, { id: 'I3', tripId: '' }];
  const trips = { 'TRIP-1': { startDate: '2027-06-12', endDate: '2027-06-22', label: 'Lisbon & Porto' }, 'TRIP-2': { startDate: '2027-09-01', endDate: '2027-09-09', label: 'Later' } };
  const todo = c.plToClose_(bucket, ideas, trips, '2027-07-01');
  check('only places whose idea’s trip has ended, not yet visited', todo.map(x => x.item.ID).join() === 'b1' && todo[0].trip.label === 'Lisbon & Porto');
  const s = ctx({ today: '2027-07-01', registry: [{ tripId: 'TRIP-1', status: 'active', startDate: '2027-06-12', endDate: '2027-06-22', label: 'Lisbon & Porto' }], ideas: [{ id: 'I1', tripId: 'TRIP-1' }],
    bucket: [['b1', 'Portugal', 'Lisbon', 2027, 'Both', 4, '', '', '', '10th anniversary', 'I1'], ['b2', 'Portugal', 'Porto', 2027, 'Both', 4, '', '', '', '', 'I1']],
    visits: [['c1', 'Portugal', 'Porto', 2027, 'Both', '2027-06-12|Lisbon & Porto', '', '']] });
  s.webGetPlaces_();
  const rows = s.__sheets['Bucket List'].rows, v = BHEAD.indexOf('Visited');
  check('they’re marked visited with the trip’s year', rows[1][v] === '2027' && rows[2][v] === '2027');
  const cs = s.__sheets.Countries.rows;
  check('a visit is added for Lisbon, with its occasion; Porto already had one', cs.length === 3 && cs[2][1] === 'Portugal' && cs[2][2] === 'Lisbon' && cs[2][5] === '2027-06-12|Lisbon & Porto' && cs[2][7] === '10th anniversary', JSON.stringify(cs));
  s.webGetPlaces_();
  check('…and only once', s.__sheets.Countries.rows.length === 3);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
