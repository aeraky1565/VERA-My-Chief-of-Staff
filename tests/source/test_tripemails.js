// Who's travelling and who gets the Travel Day email (TripEmails.js, issue #233): reading the
// Traveler cell (old one-word values too), the recipient rules (you on your trips; travellers only
// when switched on; Victoria's address from Config; added addresses; no email on a trip you're
// not on), cleaning, the retired shared list, the routes over in-memory sheets, the Travel Day
// hook and the filters. Invented people and addresses.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'TripEmails.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const TDB = fs.readFileSync(path.join(ROOT, 'TravelDayBriefing.js'), 'utf8');
const TRIPS = fs.readFileSync(path.join(ROOT, 'Trips.js'), 'utf8');
const TRD = fs.readFileSync(path.join(ROOT, 'TripReadiness.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const THEAD = eval((CODE.match(/const TRIPS_HEADERS\s*=\s*(\[[^\]]*\])/) || [])[1]);

function ctx(o) {
  o = o || {};
  const trips = (o.trips || []).map((t, i) => Object.assign({ status: 'active', recipients: '', _row: i + 2 }, t));
  const cells = {}, meta = Object.assign({}, o.meta || {}), props = Object.assign({}, o.props || {});
  const c = { String, Number, Object, Array, Date, JSON, Math, RegExp, isNaN, Error,
    CONFIG: { MORNING_NUDGE_EMAIL: 'me@example.test' }, TRIPS_HEADERS: THEAD,
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: () => o.today || '2027-03-01' }, Logger: { log: () => {} },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    getConfigValues: () => Object.assign({ victoria_email: 'partner@example.test' }, o.cfg || {}),
    tpItems_: () => o.items || [],
    readTripRegistry_: () => { const byId = {}; trips.forEach(t => { byId[t.tripId] = t; }); return { byId, rows: trips }; },
    invalidateTripRegistry_: () => {},
    tripIdForKey_: k => (trips.find(t => t.startDate + '|' + t.label === k) || {}).tripId || '',
    webGetTripMeta_: e => ({ ok: true, traveler: meta[e.parameter.tripKey] || '' }),
    webSetTripMeta_: e => { meta[e.parameter.tripKey] = e.parameter.traveler; return { ok: true }; },
    getTripsSheet_: () => ({ getRange: (r, col) => ({ setValue: v => { cells[r + ':' + col] = v; const t = trips.find(x => x._row === r); if (t && col === THEAD.indexOf('Email Recipients') + 1) t.recipients = v; } }) }) };
  vm.createContext(c); vm.runInContext(SRC, c);
  c.__cells = cells; c.__meta = meta; c.__props = props; c.__trips = trips;
  return c;
}

console.log('\nwho is travelling');
{
  const c = ctx();
  const names = ['Ahmed', 'Victoria', 'Kit Moreno'];
  check('an old "Both" means the two of you', J(c.teTravellersFrom_('Both', names)) === J(['Ahmed', 'Victoria']));
  check('an old one-word value is that person', J(c.teTravellersFrom_('Victoria', names)) === J(['Victoria']) && J(c.teTravellersFrom_('ahmed', names)) === J(['Ahmed']));
  check('a list of names, spelled as on the profiles, no repeats', J(c.teTravellersFrom_('ahmed, kit moreno; Ahmed', names)) === J(['Ahmed', 'Kit Moreno']));
  check('“and” and “&” work too; blank is nobody set', J(c.teTravellersFrom_('Ahmed and Victoria', names)) === J(['Ahmed', 'Victoria']) && J(c.teTravellersFrom_('', names)) === J([]));
}

console.log('\nwho gets the Travel Day email');
{
  const c = ctx();
  const base = { ownerEmail: 'me@example.test', partnerEmail: 'partner@example.test', profileEmails: { 'Kit Moreno': 'kit@example.test' } };
  const r1 = c.teResolve_(Object.assign({ travellers: ['Ahmed', 'Victoria'], tokens: [] }, base));
  check('a trip you both go on: only you, Victoria listed but off', J(r1.to) === J(['me@example.test']) && r1.list[1].name === 'Victoria' && r1.list[1].on === false && !r1.solo);
  const r2 = c.teResolve_(Object.assign({ travellers: ['Ahmed', 'Victoria'], tokens: ['victoria'] }, base));
  check('switched on: her address from Config', J(r2.to) === J(['me@example.test', 'partner@example.test']));
  const r3 = c.teResolve_(Object.assign({ travellers: ['Ahmed', 'Kit Moreno'], tokens: ['Kit Moreno', 'lee@example.test'] }, base));
  check('another traveller by their profile email, and an added address', J(r3.to) === J(['me@example.test', 'kit@example.test', 'lee@example.test']) && r3.list[2].source === 'added');
  const r4 = c.teResolve_(Object.assign({ travellers: ['Victoria'], tokens: ['Victoria', 'lee@example.test'] }, base));
  check('Victoria’s solo trip sends nothing at all', r4.solo === true && J(r4.to) === J([]));
  const r5 = c.teResolve_(Object.assign({ travellers: [], tokens: [] }, base));
  check('nobody set: you, as before', J(r5.to) === J(['me@example.test']) && !r5.solo);
  const r6 = c.teResolve_(Object.assign({ travellers: ['Ahmed'], tokens: ['Victoria'] }, base));
  check('a switch for someone not travelling does nothing', J(r6.to) === J(['me@example.test']));
  const r7 = c.teResolve_(Object.assign({ travellers: ['Ahmed', 'Victoria'], tokens: ['Victoria', 'PARTNER@example.test'] }, base));
  check('no address twice', J(r7.to) === J(['me@example.test', 'partner@example.test']));
  const r9 = c.teResolve_({ travellers: ['Ahmed', 'Kit Moreno'], tokens: ['Kit Moreno'], ownerEmail: 'me@example.test', partnerEmail: '', profileEmails: { 'Kit Moreno': 'ME@example.test' } });
  check('…even when a traveller’s profile email is your own', J(r9.to) === J(['me@example.test']), J(r9.to));
  const r8 = c.teResolve_(Object.assign({ travellers: ['Ahmed', 'Sam'], tokens: ['Sam'] }, base));
  check('a traveller with no email is listed as missing one and gets nothing', r8.list[1].missing === true && J(r8.to) === J(['me@example.test']));
  const r10 = c.teResolve_(Object.assign({ travellers: ['Ahmed', 'Victoria'], tokens: ['Partner@Example.test'] }, base));
  check('her address typed in switches her on, not a second row', J(r10.to) === J(['me@example.test', 'partner@example.test']) && r10.list[1].on === true && !r10.list.some(x => x.source === 'added'), J(r10));
  check('Victoria with no address in Config gets nothing', J(c.teResolve_({ travellers: ['Ahmed', 'Victoria'], tokens: ['Victoria'], ownerEmail: 'me@example.test', partnerEmail: '' }).to) === J(['me@example.test']));
}

console.log('\ncleaning');
{
  const c = ctx();
  check('addresses checked', c.teEmailOk_('a.b@example.co.uk') && !c.teEmailOk_('kit@example') && !c.teEmailOk_('two words@x.com') && !c.teEmailOk_('a@b@c.com'));
  const t = c.teCleanTokens_(['Victoria', 'Kit Moreno', 'Ahmed', 'lee@example.test', 'LEE@example.test', 'bad@nowhere'], ['Ahmed', 'Victoria']);
  check('only travelling names (never you) and good addresses, no repeats; bad ones named', J(t.tokens) === J(['Victoria', 'lee@example.test']) && J(t.bad) === J(['bad@nowhere']));
  check('the cell splits on ; , and new lines', J(c.teTokens_('Victoria; lee@example.test,\nkit@example.test; victoria')) === J(['Victoria', 'lee@example.test', 'kit@example.test']));
}

const TRIPS_FIX = [
  { tripId: 'TRIP-1', label: 'Lisbon', startDate: '2027-04-03', endDate: '2027-04-10', recipients: 'Victoria' },
  { tripId: 'TRIP-2', label: 'Austin', startDate: '2027-06-20', endDate: '2027-06-22', recipients: '' },
  { tripId: 'TRIP-3', label: 'Old trip', startDate: '2026-01-01', endDate: '2026-01-05', recipients: '' },
  { tripId: 'TRIP-4', label: 'Denver', startDate: '2027-05-01', endDate: '2027-05-03', recipients: '', status: 'cancelled' },
];
const META = { '2027-04-03|Lisbon': 'Both', '2027-06-20|Austin': 'Victoria' };

console.log('\nthe routes');
{
  const c = ctx({ trips: TRIPS_FIX, meta: META, cfg: { travel_companions: 'friend@example.test, not-an-email' },
    items: [{ person: 'Kit Moreno', section: 'contact', kind: 'email', value: 'kit@example.test' }, { person: 'Kit Moreno', section: 'document', kind: 'passport' }] });
  const g = c.webTeGet_();
  check('upcoming trips only, soonest first; cancelled and past ones left out', J(g.trips.map(t => t.label)) === J(['Lisbon', 'Austin']));
  check('each with its travellers and who gets it', J(g.trips[0].travellers) === J(['Ahmed', 'Victoria']) && g.trips[0].count === 2 && g.trips[1].solo === true);
  check('your own and Victoria’s addresses are never sent to the screen', !/me@example\.test|partner@example\.test/.test(J(g)));
  check('people with profiles, with whether they have an email', J(g.people.map(p => p.name + ':' + p.hasEmail)) === J(['Kit Moreno:true', 'Ahmed:false', 'Victoria:true']) && g.people[1].you === true);
  check('the retired shared list is offered once, valid addresses only', J(g.legacy) === J(['friend@example.test']));
  const s = c.webTeSet_({ tripKey: '2027-04-03|Lisbon', travellers: ['Ahmed', 'Victoria', 'Kit Moreno'], tokens: ['Kit Moreno', 'lee@example.test'] });
  check('saving travellers writes the Traveler cell as names', s.ok && c.__meta['2027-04-03|Lisbon'] === 'Ahmed, Victoria, Kit Moreno');
  check('saving recipients writes the Email Recipients column', c.__trips[0].recipients === 'Kit Moreno; lee@example.test' && s.trip.count === 3);
  check('Victoria switched off by leaving her out', !s.trip.list.find(x => x.name === 'Victoria').on);
  check('a bad address is refused, nothing written', /full email address: kit@example$/.test(c.webTeSet_({ tripKey: '2027-04-03|Lisbon', tokens: ['kit@example'] }).error) && c.__trips[0].recipients === 'Kit Moreno; lee@example.test');
  check('a trip not on the Trips tab', c.webTeSet_({ tripKey: '2027-09-09|Nowhere', tokens: [] }).ok === false && c.webTeTrip_({ tripKey: '2027-09-09|Nowhere' }).found === false);
  check('one trip, for its summary', c.webTeTrip_({ tripKey: '2027-06-20|Austin' }).trip.solo === true);
  const l = c.webTeLegacy_({ mode: 'add' });
  check('Add to all upcoming trips: every trip you’re on, not her solo ones; then never offered again', l.trips === 1 && /friend@example\.test/.test(c.__trips[0].recipients) && !c.__trips[1].recipients && c.webTeGet_().legacy.length === 0);
  const d = ctx({ cfg: { travel_companions: 'friend@example.test' } });
  d.webTeLegacy_({ mode: 'dismiss' });
  check('Dismiss adds nothing, and it’s gone', d.webTeGet_().legacy.length === 0);
}

console.log('\nthe Travel Day email');
{
  const c = ctx({ trips: TRIPS_FIX, meta: META });
  check('the To list for a trip you’re both on, with her switched on', J(c.teRecipientsFor_('2027-04-03|Lisbon')) === J(['me@example.test', 'partner@example.test']));
  check('nobody on Victoria’s solo trip', J(c.teRecipientsFor_('2027-06-20|Austin')) === J([]));
  check('a trip the Trips tab doesn’t know: you', J(c.teRecipientsFor_('2027-08-01|Mystery')) === J(['me@example.test']));
  check('the send skips a trip with nobody to send to, before building anything', /if \(!isTest && !getTravelDayRecipients_\(tripKey\)\.length\) \{/.test(TDB));
  check('a test always goes to you only', /var recipients = isTest \? \[CONFIG\.MORNING_NUDGE_EMAIL\] : getTravelDayRecipients_\(tripKey\);/.test(TDB) && /var to      = 'me';/.test(TDB));
  check('you in To, everyone else in Bcc; the quota counts Bcc too', /var mailTo = recipients\[0\] \|\| CONFIG\.MORNING_NUDGE_EMAIL, mailBcc = recipients\.slice\(1\);/.test(TDB) && /if \(mailBcc\.length\) mailOpts\.bcc = mailBcc\.join\(','\);/.test(TDB) && /options\.bcc/.test(fs.readFileSync(path.join(ROOT, 'Mailer.js'), 'utf8')));
  check('travel_companions is no longer read', !/cfg\['travel_companions'\]/.test(TDB) && /teRecipientsFor_\(tripKey\)/.test(TDB));
}

console.log('\nthe wiring');
{
  check('Email Recipients on the Trips tab, at the end, and in the registry', THEAD[9] === 'Email Recipients' && THEAD.length === 10 && /recipients: String\(r\[9\] \|\| ''\)\.trim\(\)/.test(TRIPS));
  check('routes: te_get, te_trip, te_set, te_legacy', /case 'te_get':\s+return jsonOut_\(webTeGet_\(\)\)/.test(WEB) && /case 'te_trip':\s+return jsonOut_\(webTeTrip_\(e\.parameter\)\)/.test(WEB)
    && /case 'te_set':\s+return jsonOut_\(webTeSet_\(body\)\)/.test(WEB) && /case 'te_legacy':\s+return jsonOut_\(webTeLegacy_\(body\)\)/.test(WEB));
  check('the documents check and readiness cover only the travellers, when set', /if \(going\.length\) profiles = profiles\.filter/.test(WEB) && /if \(going\.length\) items = items\.filter/.test(TRD));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
