// My Trips (issue #220): calendar trips, pencilled-in trips, past trips.
//
// MyTrips.js and the Trip Ideas columns it adds run in a vm over a fake sheet.
// Today is fixed at Nov 1, 2026. Every trip, place and date is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
require('./tripkey_helpers').rowIs(vm);   // #239: tripRowIs_ alongside this test's own key stubs
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const TI = fs.readFileSync(path.join(ROOT, 'TripIdeas.js'), 'utf8');
const MT = fs.readFileSync(path.join(ROOT, 'MyTrips.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const headers = name => eval(CODE.match(new RegExp('const ' + name + ' *= (\\[[^\\]]*\\]);'))[1]);
function fakeSheet(hdr) {
  const rows = [hdr.slice()];
  return {
    rows,
    getLastRow: () => rows.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => { const o = x.slice(c - 1, c - 1 + nc); while (o.length < nc) o.push(''); return o; }),
      setValues: vals => vals.forEach((v, i) => { rows[r - 1 + i] = v.slice(); }),
      getValue: () => (rows[r - 1] || [])[c - 1],
    }),
    appendRow: v => rows.push(v.slice()),
    deleteRow: r => rows.splice(r - 1, 1),
  };
}

let uuid = 0;
const S = vm.createContext({
  console, JSON, Math, Number, String, Array, Date, isFinite, Object,
  TABS: { TRIP_IDEAS: 'Trip Ideas', TRIP_IDEA_OPTIONS: 'Trip Idea Options', FLAGS: 'Flags', TRIP_META: 'TripMeta' },
  TRIP_META_HEADERS: headers('TRIP_META_HEADERS'), TRIP_IDEAS_HEADERS: headers('TRIP_IDEAS_HEADERS'), TRIP_IDEA_OPTIONS_HEADERS: headers('TRIP_IDEA_OPTIONS_HEADERS'),
  Utilities: { getUuid: () => (++uuid).toString(16).padStart(12, 'a') + '-0000-0000-0000-000000000000', sleep: () => {},
               formatDate: () => S.TODAY },
  Session: { getScriptTimeZone: () => 'UTC' },
  Logger: { log: () => {} },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  TODAY: '2026-11-01',
});
S.sheets = { 'Trip Ideas': fakeSheet(S.TRIP_IDEAS_HEADERS), 'Trip Idea Options': fakeSheet(S.TRIP_IDEA_OPTIONS_HEADERS) };
S.metaRows = [];
S.getSpreadsheet = () => ({ getSheetByName: n => n === 'TripMeta' ? { getLastRow: () => S.metaRows.length + 1,
  getRange: (r, c, nr, nc) => ({ getValues: () => S.metaRows.map(x => x.slice(c - 1, c - 1 + nc)) }) } : null });
S.ensureSheet = (ss, name) => S.sheets[name];
S.registry = [];
S.readTripRegistry_ = () => ({ rows: S.registry });
S.tripKeyRowIndex_ = (cells, key) => cells.findIndex(c => String(c) === key);
S.metaWrites = [];
S.webSetTripMeta_ = e => { S.metaWrites.push(e.parameter); return { ok: true }; };
S.upcoming = [];
S.getUpcomingTravel_ = () => S.upcoming;
S.readPTOConfig_ = () => ({});
S.webListPastTrips_ = () => ({ ok: true, trips: [{ key: '2026-10-21|Lake Trip', label: 'Lake Trip', startDate: '2026-10-21', endDate: '2026-10-28' }] });
S.ariaCalls = [];
S.ariaWatchSettled_ = (opt, trip) => S.ariaCalls.push([opt, trip.tripId]);
vm.runInContext(TI, S);
vm.runInContext(MT, S);
{ const T = fs.readFileSync(path.join(ROOT, 'Trips.js'), 'utf8'); const a = T.indexOf('function tripIsLive_('); vm.runInContext(T.slice(a, T.indexOf('\n}\n', a) + 3), S); }
const run = code => vm.runInContext(code, S);
const J = x => JSON.stringify(x);

// The ideas the page is built from.
const IDEAS = [
  { id: 'I-EGYPT', title: 'Family Visit to Egypt', months: ['2027-04', '2027-11'], nightsMin: 9, nightsMax: 9, travelers: 'Both', mustHaves: 'See everyone', pulledIn: true, status: 'brainstorming' },
  { id: 'I-JAPAN', title: 'Spring in Japan', months: ['2027-03', '2027-04'], nightsMin: 8, nightsMax: 12, pulledIn: true, status: 'shortlisted' },
  { id: 'I-MTL', title: 'Weekend in Montreal', months: ['2026-09', '2026-10'], nightsMin: 2, nightsMax: 2, pulledIn: true, status: 'brainstorming' },
  { id: 'I-WED', title: 'Cousin wedding', exactStart: '2027-11-18', exactEnd: '2027-11-22', pulledIn: true, status: 'brainstorming' },
  { id: 'I-ALPS', title: 'Hiking in the Alps', months: ['2027-07'], nightsMin: 7, pulledIn: false, status: 'brainstorming' },
  { id: 'I-OLD', title: 'Old plan', months: ['2027-05'], pulledIn: true, status: 'archived' },
  { id: 'I-DONE', title: 'Coast weekend', months: ['2027-05'], pulledIn: true, status: 'settled', tripId: 'TRIP-9' },
  { id: 'I-ANY', title: 'Safari someday', months: [], pulledIn: true, status: 'brainstorming' },
];
S.ideas = IDEAS.map(i => run('tiCleanIdea_')(i));
S.counts = { 'I-JAPAN': 3 };

console.log('\nthe pencilled-in list');
{
  const P = run('mtPencilled_(ideas, counts, "2026-11-01")');
  S.P = P;
  check('only pulled-in, open ideas with no trip', J(P.map(p => p.id).sort()) === J(['I-ANY', 'I-EGYPT', 'I-JAPAN', 'I-MTL', 'I-WED']), J(P.map(p => p.id)));
  check('months that passed first, then soonest, "any time" last', J(P.map(p => p.id)) === J(['I-MTL', 'I-JAPAN', 'I-EGYPT', 'I-WED', 'I-ANY']), J(P.map(p => p.id)));
  const by = id => P.filter(p => p.id === id)[0];
  check('all months gone: expired', by('I-MTL').expired === true && by('I-EGYPT').expired === false);
  check('about 10 days, leaving on a Friday, takes 6 PTO days', by('I-EGYPT').days === 10 && by('I-EGYPT').pto === 6, J(by('I-EGYPT')));
  check('known dates Thu–Mon take 3 PTO days', by('I-WED').exact && by('I-WED').pto === 3, J(by('I-WED')));
  check('pick dates 12 weeks before the first month', by('I-EGYPT').pickBy === '2027-01-07' && by('I-JAPAN').pickBy === '2026-12-07', by('I-EGYPT').pickBy);
  check('known dates need no pick-by', by('I-WED').pickBy === '');
  check('a Trip Idea with options says so', by('I-JAPAN').options === 3 && by('I-EGYPT').options === 0);
  check('"any time" is marked', by('I-ANY').anyTime === true);
  const half = run('mtPencilled_([tiCleanIdea_({ id: "H", title: "Half gone", months: ["2026-10", "2027-02"], pulledIn: true })], {}, "2026-11-01")')[0];
  check('a passed month drops out of the windows, the rest stay', J(half.months) === '["2027-02"]' && J(half.passedMonths) === '["2026-10"]' && !half.expired);
}

console.log('\nthe 15-month strip and what it points out');
{
  S.UP = [
    { label: 'Island Trip', startDate: '2026-11-06', endDate: '2026-11-15', tentative: false },
    { label: 'Potential Ski weekend', startDate: '2027-02-12', endDate: '2027-02-15', tentative: true },
    { label: 'Spring break', startDate: '2027-03-10', endDate: '2027-03-14', tentative: false },
  ];
  S.OTHER = [{ label: 'a leave block', start: '2027-11-01', end: '2027-12-15' }];
  const H = run('mtHorizon_("2026-11-01")');
  check('15 months, this one first', H.length === 15 && H[0] === '2026-11' && H[14] === '2028-01', J(H));
  S.H = H;
  const strip = run('mtStrip_(H, UP, P, OTHER)');
  const m = ym => strip.filter(x => x.ym === ym)[0];
  check('a calendar trip fills its month', J(m('2026-11').firm) === '["Island Trip"]');
  check('a tentative one goes in its own row', J(m('2027-02').tentative) === '["Potential Ski weekend"]' && m('2027-02').firm.length === 0);
  check('both pencilled trips sit in April', J(m('2027-04').loose.sort()) === J(['Family Visit to Egypt', 'Spring in Japan']));
  check('known dates fill their month', m('2027-11').loose.indexOf('Cousin wedding') !== -1);
  check('a trip whose months passed is not on the strip', !strip.some(x => x.loose.indexOf('Weekend in Montreal') !== -1));
  // Known dates that ended earlier this month: expired, and kept off this month's cell.
  S.Pmid = run('mtPencilled_([tiCleanIdea_({ id: "E", title: "Early November weekend", exactStart: "2026-11-05", exactEnd: "2026-11-07", pulledIn: true })], {}, "2026-11-20")');
  const mid = run('mtStrip_(mtHorizon_("2026-11-20"), [], Pmid, [])');
  check('known dates that already went by are not on the strip', S.Pmid[0].expired === true && mid[0].loose.length === 0, J(mid[0]));
  check('a leave block marks its months', m('2027-11').other.length === 1 && m('2027-12').other.length === 1 && m('2027-10').other.length === 0);
  S.strip = strip;
  const C = run('mtClashes_(strip)');
  const texts = C.map(c => c.text);
  check('two pencilled trips after one month', texts.indexOf('Family Visit to Egypt and Spring in Japan both look at April 2027.') !== -1 ||
        texts.indexOf('Spring in Japan and Family Visit to Egypt both look at April 2027.') !== -1, J(texts));
  check('a pencilled month with a calendar trip in it', texts.some(t => /Spring in Japan could clash with Spring break in March 2027/.test(t)), J(texts));
  check('a pencilled month over a leave block', texts.indexOf('November 2027 overlaps a leave block.') !== -1, J(texts));
  check('a month with one pencilled trip and nothing else says nothing', !C.some(c => c.ym === '2027-07'));
}

console.log('\ntentative calendar trips');
{
  const t = s => run('mtIsTentative_(' + J(s) + ')');
  check('"Potential", "Maybe", "TBD" and a trailing "?" are tentative', t('Potential Ski weekend') && t('Maybe: Lisbon') && t('Austin TBD') && t('Chicago?'));
  check('a plain name is not', !t('Ski weekend') && !t('Island Trip'));
  check('"options" in a name is not a maybe here', !t('Options Weekend'));
}

console.log('\nis this the same trip?');
{
  S.REG = [
    { tripId: 'TRIP-1', label: 'Egypt', startDate: '2027-04-10', endDate: '2027-04-19', status: 'active' },
    { tripId: 'TRIP-2', label: 'Egypt', startDate: '2027-06-01', endDate: '2027-06-08', status: 'active' },
    { tripId: 'TRIP-3', label: 'Lake weekend', startDate: '2027-04-03', endDate: '2027-04-05', status: 'active' },
    { tripId: 'TRIP-4', label: 'Wedding weekend', startDate: '2027-11-19', endDate: '2027-11-21', status: 'active' },
    { tripId: 'TRIP-9', label: 'Egypt again', startDate: '2027-04-11', endDate: '2027-04-18', status: 'active' },
    { tripId: 'TRIP-OLD', label: 'Egypt', startDate: '2025-04-10', endDate: '2025-04-19', status: 'active' },
  ];
  S.LINKED = { 'TRIP-9': 1 };
  const M = run('mtMatches_(P, REG, LINKED, "2026-11-01")');
  const pairs = M.map(x => x.ideaId + '>' + x.tripId).sort();
  check('a trip in the window that shares a word is offered', pairs.indexOf('I-EGYPT>TRIP-1') !== -1, J(pairs));
  check('known dates match a trip within a few days that shares a word', pairs.indexOf('I-WED>TRIP-4') !== -1, J(pairs));
  check('outside the months: not offered', pairs.indexOf('I-EGYPT>TRIP-2') === -1);
  check('no word in common: not offered', !pairs.some(p => /TRIP-3/.test(p)));
  check('a trip already linked to an idea: not offered', !pairs.some(p => /TRIP-9/.test(p)));
  check('a trip that has ended: not offered', !pairs.some(p => /TRIP-OLD/.test(p)));
  check('that is all', pairs.length === 2, J(pairs));
  S.P2 = S.P.map(p => p.id === 'I-EGYPT' ? Object.assign({}, p, { notSame: ['TRIP-1'] }) : p);
  check('a pair turned down is never offered again', !run('mtMatches_(P2, REG, LINKED, "2026-11-01")').some(x => x.tripId === 'TRIP-1'));
  S.P3 = S.P.map(p => p.id === 'I-EGYPT' ? Object.assign({}, p, { settle: { start: '2027-04-09', end: '2027-04-18' } }) : p);
  check('a trip whose dates were chosen is left to the settle link', !run('mtMatches_(P3, REG, LINKED, "2026-11-01")').some(x => x.ideaId === 'I-EGYPT'));
  const mm = M.filter(x => x.tripId === 'TRIP-1')[0];
  check('a match carries the trip key the dashboard opens', mm.tripKey === '2027-04-10|Egypt' && mm.ideaTitle === 'Family Visit to Egypt');
}

console.log('\nflags');
{
  const now = Object.keys(run('mtFlagsWanted_(P, "2026-11-01")'));
  check('today: only the trip whose months went by', J(now) === J(['MYTRIP|expired|I-MTL']), J(now));
  S.Pdec = run('mtPencilled_(ideas, counts, "2026-12-08")');
  const dec = run('mtFlagsWanted_(Pdec, "2026-12-08")');
  check('12 weeks before March: pick dates for Japan, not yet Egypt', dec['MYTRIP|pick|I-JAPAN'] && !dec['MYTRIP|pick|I-EGYPT'], J(Object.keys(dec)));
  S.Pjan = run('mtPencilled_(ideas, counts, "2027-01-07")');
  const later = run('mtFlagsWanted_(Pjan, "2027-01-07")');
  check('12 weeks before April: Egypt too', later['MYTRIP|pick|I-EGYPT'] && later['MYTRIP|pick|I-JAPAN'], J(Object.keys(later)));
  check('…worded with the months', /Pick dates for Family Visit to Egypt/.test(later['MYTRIP|pick|I-EGYPT'].flag) &&
        /April 2027 or November 2027/.test(later['MYTRIP|pick|I-EGYPT'].reason), J(later['MYTRIP|pick|I-EGYPT']));
  check('known dates and "any time" raise none', !later['MYTRIP|pick|I-WED'] && !later['MYTRIP|pick|I-ANY']);
  check('nightly step is registered', /nightlyStep_\(ctx, 'myTripsSyncFlags_', myTripsSyncFlags_\)/.test(CODE));
}

console.log('\nmoving a trip on a year');
{
  check('passed months move on a year', J(run('mtRollForward_({ months: ["2026-09", "2026-10"] })').months) === '["2027-09","2027-10"]');
  const w = run('mtRollForward_({ exactStart: "2026-08-07", exactEnd: "2026-08-09", months: [] })');
  check('known dates move on a year', w.exactStart === '2027-08-07' && w.exactEnd === '2027-08-09');
}

console.log('\nthe sheet: columns, pencil in, and every change');
{
  const H = S.TRIP_IDEAS_HEADERS;
  check('four columns added at the end', J(H.slice(-4)) === J(['Pulled In', 'Exact Start', 'Exact End', 'Not Same']) && H[18] === 'Settle', J(H.slice(-5)));
  // An idea written before the columns existed reads as not pulled in.
  const old = ['IDEA-OLD', 'Old row', '', '["2027-05"]', 7, 7, '', '', 'balanced', '[]', '', 'brainstorming', '', '', 'c', 'u', '[]', '[]', ''];
  S.sheets['Trip Ideas'].rows.push(old);
  const o = run('tiGetIdea_("IDEA-OLD")');
  check('a row from before reads as not pulled in, no dates, nobody turned down', o.pulledIn === false && o.exactStart === '' && J(o.notSame) === '[]', J(o));

  let r = run('webMyTripPencil_({ trip: { title: "Family Visit to Egypt", where: "Cairo", months: ["2027-04", "2027-11"], days: 10, travelers: "Both", note: "See everyone" } })');
  check('pencil in creates a pulled-in idea', r.ok && r.idea.pulledIn === true && r.idea.status === 'brainstorming', J(r));
  check('"about 10 days" is 9 nights', r.idea.nightsMin === 9 && r.idea.nightsMax === 9);
  S.eid = r.idea.id;
  const row = S.sheets['Trip Ideas'].rows.filter(x => x[0] === S.eid)[0];
  check('it is written as "yes" in Pulled In', row[19] === 'yes' && row.length === H.length, J(row.slice(19)));
  check('a name is required', run('webMyTripPencil_({ trip: { months: ["2027-04"] } })').ok === false);
  check('and a month or dates', run('webMyTripPencil_({ trip: { title: "x" } })').ok === false);
  r = run('webMyTripPencil_({ trip: { title: "Cousin wedding", exactStart: "2027-11-22", exactEnd: "2027-11-18", months: ["2027-11"] } })');
  check('known dates: kept in order, no months', r.ok && r.idea.exactStart === '2027-11-18' && r.idea.exactEnd === '2027-11-22' && r.idea.months.length === 0, J(r.idea));

  // The Trip Ideas board saves whole ideas but knows nothing of these fields.
  const board = run('tiGetIdea_(eid)');
  ['pulledIn', 'exactStart', 'exactEnd', 'notSame'].forEach(k => delete board[k]);
  board.title = 'Family Visit to Egypt (both sides)';
  S.board = board;
  run('webSaveTripIdea_({ idea: board })');
  check('saving from the Trip Ideas board keeps it pulled in', run('tiGetIdea_(eid)').pulledIn === true && /both sides/.test(run('tiGetIdea_(eid)').title));

  const up = (op, extra) => run('webMyTripUpdate_(' + J(Object.assign({ id: S.eid, op }, extra || {})) + ')');
  check('unpull and pull', up('unpull').idea.pulledIn === false && up('pull').idea.pulledIn === true);
  const noMonths = run('webSaveTripIdea_({ idea: { title: "No months yet" } })').idea.id;
  check('a trip with no months cannot be pulled in', run('webMyTripUpdate_({ id: "' + noMonths + '", op: "pull" })').ok === false);
  r = up('choose', { start: '2027-04-09', end: '2027-04-18' });
  check('choosing dates saves them as the settle, with no option', r.ok && J(r.idea.settle) === J({ optionId: '', start: '2027-04-09', end: '2027-04-18',
        label: 'Family Visit to Egypt (both sides)', at: r.idea.settle.at }), J(r.idea.settle));
  check('backwards dates are refused', up('choose', { start: '2027-04-18', end: '2027-04-09' }).ok === false);
  check('unchoose lets them go', up('unchoose').idea.settle === null);
  check('not the same trip: remembered once', J(up('not_same', { tripId: 'TRIP-2' }).idea.notSame) === '["TRIP-2"]' &&
        J(up('not_same', { tripId: 'TRIP-2' }).idea.notSame) === '["TRIP-2"]');

  S.registry = [{ tripId: 'TRIP-1', label: 'Egypt', startDate: '2027-04-10', endDate: '2027-04-19', status: 'active' }];
  S.metaRows = [['2027-04-10|Egypt', '', '', '', '']];
  S.metaWrites = [];
  r = up('link', { tripId: 'TRIP-1' });
  check('linking settles it on the calendar trip', r.ok && r.idea.tripId === 'TRIP-1' && r.idea.status === 'settled' &&
        r.idea.settle.start === '2027-04-10' && r.idea.settle.end === '2027-04-19', J(r.idea));
  check('…its note and travellers go to the trip', J(S.metaWrites) === J([{ tripKey: '2027-04-10|Egypt', notes: 'See everyone', traveler: 'Both' }]), J(S.metaWrites));
  check('…with no option, no fare request is moved', S.ariaCalls.length === 0);
  S.metaRows = [['2027-04-10|Egypt', 'Family Trip', 'Our own notes', '', 'Ahmed']];
  S.metaWrites = [];
  run('mtCarryToTrip_(tiGetIdea_(eid), { startDate: "2027-04-10", label: "Egypt" })');
  check('…never over notes or travellers the trip already has', S.metaWrites.length === 0, J(S.metaWrites));
  check('a gone calendar trip cannot be linked', up('link', { tripId: 'TRIP-NOPE' }).ok === false);
  check('an unknown change is refused', up('fly').ok === false);
  const mtl = run('webMyTripPencil_({ trip: { title: "Weekend in Montreal", months: ["2026-09", "2026-10"], days: 3 } })').idea.id;
  check('move on a year', J(run('webMyTripUpdate_({ id: "' + mtl + '", op: "roll" })').idea.months) === '["2027-09","2027-10"]');
  const d = run('webMyTripUpdate_({ id: "' + mtl + '", op: "drop" })').idea;
  check('drop archives it and takes it off My Trips', d.status === 'archived' && d.pulledIn === false);
}

console.log('\nthe whole page');
{
  S.upcoming = [{ label: 'Island Trip', startDate: '2026-11-06', endDate: '2026-11-15', daysAway: 5 },
                { label: 'Potential Ski weekend', startDate: '2027-02-12', endDate: '2027-02-15', daysAway: 103 }];
  S.registry = [];
  const r = run('webMyTrips_()');
  check('it answers', r.ok === true && r.today === '2026-11-01');
  check('upcoming trips carry their key and tentative mark', r.upcoming[0].tripKey === '2026-11-06|Island Trip' && r.upcoming[1].tentative === true && !r.upcoming[0].tentative);
  check('past trips come along', r.past.length === 1 && r.past[0].label === 'Lake Trip');
  check('the strip has 15 months', r.strip.length === 15);
  check('the wedding is pencilled in; the settled and dropped ones are not', r.pencilled.some(p => p.title === 'Cousin wedding') &&
        !r.pencilled.some(p => /Egypt|Montreal/.test(p.title)), J(r.pencilled.map(p => p.title)));
  check('the From Trip Ideas list holds open ideas only', r.ideas.every(i => i.status !== 'settled' && i.status !== 'archived') && r.ideas.some(i => i.title === 'No months yet'));
}

console.log('\nroutes');
{
  check('GET my_trips and my_trip_windows', /case 'my_trips':\s*return jsonOut_\(webMyTrips_\(\)\)/.test(WEB) && /case 'my_trip_windows':\s*return jsonOut_\(webMyTripWindows_\(e\.parameter\)\)/.test(WEB));
  check('POST my_trip_pencil and my_trip_update', /case 'my_trip_pencil':\s*return jsonOut_\(webMyTripPencil_\(body\)\)/.test(WEB) && /case 'my_trip_update':\s*return jsonOut_\(webMyTripUpdate_\(body\)\)/.test(WEB));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
