// Share or export (TripShare.js, itinerary redesign stage 5): what goes out in
// the email, the trip sheet and the calendar file, built from a trip's own rows.
//
// The real functions run in a vm over an invented trip. Nothing is sent: the
// mail door is a recorder.
const fs = require('fs'), vm = require('vm'), path = require('path');
require('./tripkey_helpers')(require('vm'));   // tripKeyMatches_ & co. in every context
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SHARE = read('TripShare.js'), WEB = read('WebApp.js'), APP = read('docs/app.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const TRIP = { tripKey: '2026-11-12|Vacation: Lisbon & Porto', label: 'Vacation: Lisbon & Porto', startDate: '2026-11-12', endDate: '2026-11-16' };
const ROWS = [
  ['f1', TRIP.tripKey, 'flight', 'TP 204 · IAD → LIS', '2026-11-12', '18:05', '06:40', 'IAD', 'Seats 23A', '{"confirmation":"ABC123","startTz":"America/New_York","endTz":"Europe/Lisbon"}'],
  ['h1', TRIP.tripKey, 'hotel', 'Alfama <hotel>', '2026-11-13', '', '', 'Rua X 12, 1100-001 Lisboa, Portugal', '', '{"checkoutDate":"2026-11-15","confirmationNumber":"H-77"}'],
  ['a1', TRIP.tripKey, 'museum', 'Tile museum, the big one', '2026-11-14', '10:00', '12:00', 'Lisboa, Portugal', 'Closed Mondays', '{"timezone":"Europe/Lisbon"}'],
  ['v1', TRIP.tripKey, 'spa', 'Spa', '2026-11-14', '15:00', '', '', '', '{"traveler":"Victoria"}'],
  ['o1', TRIP.tripKey, 'dining', 'Fado tavern', '2026-11-14', '20:00', '', '', '', '{"tentative":true,"optionGroup":"g","isRepresentative":true,"decisionStatus":"open"}'],
  ['o2', TRIP.tripKey, 'dining', 'Rooftop', '2026-11-14', '20:00', '', '', '', '{"tentative":true,"optionGroup":"g","decisionStatus":"open"}'],
  ['x1', 'other|trip', 'hotel', 'Someone else', '2026-11-13', '', '', '', '', ''],
  ['f2', TRIP.tripKey, 'flight', 'TP 203 · LIS → IAD', '2026-11-16', '11:20', '15:05', 'LIS', '', '{"confirmation":"XYZ9"}'],
];
const sent = [];
const S = vm.createContext({ console, Date, JSON, Math,
  getSpreadsheet: () => ({ getSheetByName: () => ({ getLastRow: () => ROWS.length + 1, getRange: () => ({ getValues: () => ROWS.map(r => r.slice()) }) }) }),
  TABS: { ITINERARY: 'Itinerary' }, ITINERARY_HEADERS: new Array(10).fill(''),
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }) },
  Utilities: { formatDate: d => String(d), newBlob: (data, type, name) => ({ data, type, name }) },
  sendVeraEmail_: (to, subject, body, options, kind) => { sent.push({ to, subject, body, options, kind }); return true; },
});
vm.runInContext(SHARE, S);
const run = code => vm.runInContext(code, S);
S.T = TRIP;
const items = () => run('tripShareItems_(T.tripKey)');

// ============ what goes out ====================================================
console.log('what goes out');
{
  const ids = o => { S.o = o; return run('tripShareSelect_(tripShareItems_(T.tripKey), o)').map(i => i.id).join(); };
  check('only this trip\'s rows, in date and time order', ids({}) === 'f1,h1,a1,v1,f2', ids({}));
  check('whose plans: Ahmed\'s copy leaves out Victoria\'s spa', ids({ who: 'Ahmed' }) === 'f1,h1,a1,f2');
  check('…Victoria\'s keeps it', ids({ who: 'Victoria' }) === 'f1,h1,a1,v1,f2');
  check('an undecided choice stays out unless notes and decisions are asked for, and then only one option', ids({ notes: true }) === 'f1,h1,a1,v1,o1,f2', ids({ notes: true }));
}

// ============ the model behind the email and the sheet ==========================
console.log('\nthe email and the sheet');
{
  S.o = {};
  const m = run('tripShareModel_(T, tripShareItems_(T.tripKey), tripShareOpts_({}))');
  check('the title drops "Vacation:"', m.title === 'Lisbon & Porto');
  check('a day at a glance per day, the last one home; the first day, with no address, takes the next day\'s city', m.glance.length === 5 && m.glance[0].city === 'Lisboa' && m.glance[1].city === 'Lisboa' && m.glance[4].city === 'Home', JSON.stringify(m.glance.map(g => g.city)));
  check('stays with dates, city and address', m.stays.length === 1 && m.stays[0].from === '2026-11-13' && m.stays[0].to === '2026-11-15' && m.stays[0].city === 'Lisboa');
  check('confirmation numbers are out by default', m.stays[0].conf === '' && m.moves.every(v => v.conf === ''));
  check('notes are out by default', !m.days.some(d => d.rows.some(r => /Closed Mondays|Seats/.test(r.sub))));
  check('check-out shows on its day', m.days[3].rows[0].title === 'Check out · Alfama <hotel>');
  check('a night with nothing booked says the address will follow; a night flight, a stay or home says nothing', m.days[0].tonight === '' && /^Tonight: Lisboa \(address to follow\)$/.test(m.days[3].tonight) && m.days[1].tonight === '' && m.days[4].tonight === '', JSON.stringify(m.days.map(d => d.tonight)));
  check('a travel day takes the city its move ends in', (() => { S.tr = [{ id: 't', type: 'train', title: 'Train · Lisbon → Porto', date: '2026-11-15', startTime: '11:00' }].concat(run('tripShareItems_(T.tripKey)')); const g = run('tripShareModel_(T, tr, {})').glance; return g[3].city === 'Porto'; })());
  S.p = { conf: '1', notes: '1', who: 'Ahmed', note: 'Call the hotel if you can\'t reach us.' };
  const full = run('tripShareModel_(T, tripShareItems_(T.tripKey), tripShareOpts_(p))');
  check('asked for, confirmations come along', full.stays[0].conf === 'H-77' && full.moves[0].conf === 'ABC123');
  check('…and notes', full.days[2].rows.some(r => /Closed Mondays/.test(r.sub)));
  check('the note and whose plans are carried', full.note === 'Call the hotel if you can\'t reach us.' && full.who === 'Ahmed');
  S.m = full;
  const html = run('tripShareHtml_(m, { ics: true })');
  check('the HTML escapes what it is given', /Alfama &lt;hotel&gt;/.test(html) && !/<hotel>/.test(html));
  check('the HTML carries no links and no token', !/<a\s/i.test(html) && !/https?:\/\//.test(html) && !/token/i.test(html));
  check('the HTML says the calendar file is attached, and that times are local', /Attached: a calendar file/.test(html) && /All times are local/.test(html));
  check('a plain-text copy for clients without HTML', /WHERE WE'RE STAYING/.test(run('tripShareText_(m)')) && /DAY BY DAY/.test(run('tripShareText_(m)')));
}

// ============ the calendar file ================================================
console.log('\nthe calendar file');
{
  S.o = {};
  const ics = run('tripShareIcs_(T, tripShareItems_(T.tripKey), tripShareOpts_({}), "2026-10-25T12:00:00.000Z")');
  check('a well-formed calendar, CRLF line ends', /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/.test(ics) && /END:VCALENDAR\r\n$/.test(ics));
  check('one event per item that goes out', (ics.match(/BEGIN:VEVENT/g) || []).length === 5);
  check('a stay spans its nights as all-day dates', /DTSTART;VALUE=DATE:20261113\r\nDTEND;VALUE=DATE:20261115/.test(ics));
  check('a flight leaves and lands in its own time zones, landing the next day', /DTSTART;TZID=America\/New_York:20261112T180500\r\nDTEND;TZID=Europe\/Lisbon:20261113T064000/.test(ics), ics.slice(0, 600));
  check('an item with one time zone uses it for both ends', /DTSTART;TZID=Europe\/Lisbon:20261114T100000\r\nDTEND;TZID=Europe\/Lisbon:20261114T120000/.test(ics));
  check('commas are escaped', /SUMMARY:Tile museum\\, the big one/.test(ics));
  check('no confirmation numbers by default', !/ABC123|H-77/.test(ics));
  check('stable ids, so a second import can update rather than double', /UID:f1@vera-itinerary/.test(ics));
  const long = run("tripShareIcs_(T, [{ id: 'L', type: 'activity', title: 'A very long day out: ' + 'Sintra, Pena Palace, Quinta da Regaleira and the coast at Cabo da Roca'.repeat(2), date: '2026-11-14' }], {}, '2026-10-25T12:00:00Z')");
  check('long lines are folded, and unfold back whole', long.split('\r\n').every(l => l.length <= 75) && long.split('\r\n').some(l => l.startsWith(' ')) && /Cabo da Roca.*Cabo da Roca/.test(long.replace(/\r\n /g, '')));
}

// ============ sending the email ================================================
console.log('\nsending the email');
{
  const rc = to => { S.to = to; return run('tripShareRecipients_(to)'); };
  check('addresses split on commas and spaces, duplicates once', JSON.stringify(rc('a@example.test, b@example.test a@example.test').list) === '["a@example.test","b@example.test"]');
  check('a bad address is named', /don't look like email addresses: nope/.test(rc('a@example.test, nope').error));
  check('none is refused', /at least one/.test(rc('').error));
  check('more than ten is refused', /Up to 10/.test(rc(Array.from({ length: 11 }, (_, i) => 'p' + i + '@example.test')).error));
  S.b = Object.assign({ to: 'mom@example.test, dad@example.test', who: 'Both', include: { stays: true, moves: true }, note: 'Here we are', attachIcs: true }, TRIP);
  const r = run('webTripShareEmail_(b)');
  const m = sent[0] || {};
  check('sends once, to the people named', r.ok && r.sent === 2 && sent.length === 1 && m.to === 'mom@example.test,dad@example.test', JSON.stringify(r));
  check('with a copy to you', m.options.bcc === 'owner@example.test');
  check('subject: "Our trip: Lisbon & Porto, Nov 12–Nov 16"', m.subject === 'Our trip: Lisbon & Porto, Nov 12–Nov 16', m.subject);
  check('HTML with a plain-text fallback, through the mail door', /<table/.test(m.options.htmlBody) && /DAY BY DAY/.test(m.body) && m.kind === 'trip_itinerary');
  check('the calendar file attached', m.options.attachments && m.options.attachments[0].type === 'text/calendar' && /\.ics$/.test(m.options.attachments[0].name));
  sent.length = 0; S.b2 = Object.assign({}, S.b, { attachIcs: false });
  run('webTripShareEmail_(b2)');
  check('no attachment when it is turned off', !sent[0].options.attachments && !/Attached: a calendar file/.test(sent[0].options.htmlBody));
  sent.length = 0; S.b3 = Object.assign({}, S.b, { to: 'bad' });
  check('nothing is sent to a bad address', run('webTripShareEmail_(b3)').ok === false && sent.length === 0);
}

// ============ wiring ============================================================
console.log('\nwiring');
check('GET trip_sheet and trip_ics are routed', /case 'trip_sheet':\s+return jsonOut_\(webTripSheet_\(e\.parameter\)\);/.test(WEB) && /case 'trip_ics':\s+return jsonOut_\(webTripIcs_\(e\.parameter\)\);/.test(WEB));
check('POST trip_share_email is routed', /case 'trip_share_email':\s+return jsonOut_\(webTripShareEmail_\(body\)\);/.test(WEB));
check('there is no calendar sync: VERA never writes a calendar it reads', !/Calendar\.Events\.(insert|update|remove)/.test(SHARE) && !/trip_calendar_sync/.test(WEB));
check('the sheet logs nothing about recipients', !/Logger\.log\([^)]*(to|list)\b/.test(SHARE));
// The sheet and the email read a city the same way the dashboard does.
{
  const A = APP.slice(APP.indexOf('function tsCity_('), APP.indexOf('\n// The place a trip', APP.indexOf('function tsCity_(')));
  const C = vm.createContext({}); vm.runInContext(A, C);
  const cases = ['Anchorage, AK', 'Little Havana, Miami, FL', 'Vancouver, BC, Canada', 'Rua X 12, 1100-001 Lisboa, Portugal', '10 Downing St, London SW1A 2AA, UK', 'Delaware', ''];
  check('shareCity_ reads an address exactly as the dashboard\'s tsCity_', cases.every(c => { C.c = c; S.c = c; return vm.runInContext('tsCity_(c)', C) === run('shareCity_(c)'); }));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
