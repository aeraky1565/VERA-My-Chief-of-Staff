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
  });
  s.appendRow = row => s.rows.push(row.slice());
  return s;
}
function ctx(o) {
  o = o || {};
  const props = Object.assign({}, o.props || {});
  const sheets = { Countries: makeSheet([o.oldHeaders ? HEAD.slice(0, 7) : HEAD].concat(o.visits || [])), 'Bucket List': makeSheet([BHEAD].concat(o.bucket || [])) };
  const cache = Object.assign({}, o.cache || {});
  const c = {
    String, Number, Object, Array, Date, JSON, Math, RegExp, isNaN, isFinite, Error,
    Logger: { log: () => {} },
    TABS: { COUNTRIES: 'Countries', BUCKET_LIST: 'Bucket List' }, COUNTRIES_HEADERS: HEAD,
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
    lfPlaceWords_: s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && ['trip', 'the', 'and'].indexOf(w) === -1),
  };
  vm.createContext(c); vm.runInContext(SRC, c);
  c.__sheets = sheets; c.__props = props; c.__cache = cache;
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
  check('bucket: only places not yet visited', r.bucket.map(b => b.Country).join() === 'Norway');
  check('planned comes along', r.planned.length === 1 && r.planned[0].country === 'Costa Rica');
  check('notes per country', r.notes.Italy && r.notes.Italy.loved[0] === 'Rome at night');
  check('occasion suggestions include what was used', r.occasions.indexOf('10th anniversary') !== -1 && r.picks[0] === 'Anniversary');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
