// One flight, shown twice.
//
//   18:47  Flight to Washington (UA 1370)   Tampa TPA
//   18:47  Flight UA1370 TPA to IAD         Tampa, FL, US (TPA)
//
// The row VERA built and the event Google auto-created from the airline email.
// Same flight, different titles, different locations — so the title-keyed
// dedupe saw two unrelated events, and nothing reconciled a sheet row against a
// calendar event at all.
//
// The assertion that matters most here is the INVERSE: two genuinely different
// flights on one day must still both show. An over-eager key silently hides a
// real flight, which is worse than the duplicate being fixed.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extract(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error('unterminated: ' + name);
}

const WEB = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
const ctx = { Logger: { log(){} }, JSON, String, Number, Math, parseInt, Object, Array, RegExp, Date };
vm.createContext(ctx);
['flightKeyFor_', 'dedupeItineraryCalendarItems_', 'suppressCalendarDuplicatesOfRows_']
  .forEach(fn => {
    try { vm.runInContext(extract(WEB, fn), ctx); }
    catch (e) { console.log('  (could not load ' + fn + ': ' + e.message + ')'); }
  });

console.log('\nthe phase exists');
['flightKeyFor_', 'suppressCalendarDuplicatesOfRows_'].forEach(fn =>
  check(fn + ' is defined', typeof ctx[fn] === 'function', typeof ctx[fn]));
if (fail) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed  — absent, nothing further to test');
  process.exit(1);
}

const DAY = '2026-09-27';
const calItem = o => Object.assign({
  id: 'CAL-a', tripKey: 'T', type: 'flight', title: 'Flight to Washington (UA 1370)',
  date: DAY, startTime: '18:47', endTime: '21:03', allDay: false,
  location: 'Tampa TPA', notes: '', metadata: JSON.stringify({ calendarName: 'Personal' }),
  source: 'calendar', _descLength: 40, _isPersonal: true,
}, o);
const sheetRow = o => Object.assign({
  id: 'ITIN-9', tripKey: 'T', type: 'flight', title: 'Flight UA1370 TPA to IAD',
  date: DAY, startTime: '18:47', endTime: '21:03', allDay: false,
  location: 'Tampa, FL, US (TPA)', notes: '',
  metadata: JSON.stringify({ airline: 'UA', flightNum: '1370' }),
  source: 'manual',
}, o);
const meta = it => { try { return JSON.parse(it.metadata || '{}'); } catch (e) { return {}; } };

console.log('\nflightKeyFor_');
{
  const k = (o) => ctx.flightKeyFor_(Object.assign({ type: 'flight', title: '', metadata: '{}' }, o));
  check('reads the auto-created title',  k({ title: 'Flight to Washington (UA 1370)' }) === 'UA1370',
        k({ title: 'Flight to Washington (UA 1370)' }));
  check('reads VERA’s own title',   k({ title: 'Flight UA1370 TPA to IAD' }) === 'UA1370',
        k({ title: 'Flight UA1370 TPA to IAD' }));
  check('both give the SAME key',
        k({ title: 'Flight to Washington (UA 1370)' }) === k({ title: 'Flight UA1370 TPA to IAD' }));

  check('metadata beats the title',
        k({ title: 'Flight to Washington (UA 9999)', metadata: JSON.stringify({ airline:'UA', flightNum:'1370' }) }) === 'UA1370',
        k({ title: 'Flight to Washington (UA 9999)', metadata: JSON.stringify({ airline:'UA', flightNum:'1370' }) }));
  check('a combined flightNum is taken as-is',
        k({ metadata: JSON.stringify({ flightNum: 'DL404' }) }) === 'DL404');
  check('whitespace in metadata is normalised',
        k({ metadata: JSON.stringify({ flightNum: 'dl 404' }) }) === 'DL404');

  check('a non-flight type gives nothing',
        ctx.flightKeyFor_({ type: 'hotel', title: 'Flight UA1370 TPA to IAD' }) === '');
  check('a flight with no number gives nothing', k({ title: 'Flight home' }) === '');
  check('an airport code is not a flight number', k({ title: 'TPA to IAD' }) === '',
        k({ title: 'TPA to IAD' }));
  check('null is fine', ctx.flightKeyFor_(null) === '');
}

console.log('\nTHE REPORTED BUG — sheet row + auto-created calendar event');
{
  const stored = [sheetRow()];
  const cal    = ctx.dedupeItineraryCalendarItems_([calItem()]);
  const out    = ctx.suppressCalendarDuplicatesOfRows_(cal, stored);

  check('the calendar copy is dropped', out.length === 0, JSON.stringify(out.map(i => i.title)));
  check('the sheet row survives', stored.length === 1 && stored[0].id === 'ITIN-9', stored[0].id);
  check('…so it is still editable and deletable', stored[0].id === 'ITIN-9');
  check('the day now shows ONE flight', stored.length + out.length === 1,
        stored.length + out.length);
}

console.log('\nnothing is lost when the duplicate is dropped');
{
  // The calendar copy knows the route; the row does not.
  const stored = [sheetRow({ metadata: JSON.stringify({ airline:'UA', flightNum:'1370' }) })];
  const cal    = [calItem({ metadata: JSON.stringify({ calendarName:'Personal', origin:'TPA', dest:'IAD' }) })];
  ctx.suppressCalendarDuplicatesOfRows_(cal, stored);

  check('origin is carried onto the row', meta(stored[0]).origin === 'TPA', JSON.stringify(meta(stored[0])));
  check('dest is carried onto the row',   meta(stored[0]).dest === 'IAD',   JSON.stringify(meta(stored[0])));
  check('…and the row keeps its own fields', meta(stored[0]).flightNum === '1370');

  // A row that already knows better is not overwritten.
  const known = [sheetRow({ metadata: JSON.stringify({ flightNum:'1370', origin:'TPA', dest:'DCA' }) })];
  ctx.suppressCalendarDuplicatesOfRows_(
    [calItem({ metadata: JSON.stringify({ origin:'TPA', dest:'IAD' }) })], known);
  check('an existing value is NOT overwritten', meta(known[0]).dest === 'DCA', meta(known[0]).dest);
}

console.log('\nTHE INVERSE — real flights must not be hidden');
{
  const outbound = sheetRow({ id:'ITIN-1', title:'Flight UA1073 IAD to TPA',
                              metadata: JSON.stringify({ airline:'UA', flightNum:'1073' }),
                              startTime:'08:40', endTime:'11:33' });
  const ret      = calItem({ id:'CAL-2', title:'Flight to Washington (UA 1370)' });
  const out = ctx.suppressCalendarDuplicatesOfRows_([ret], [outbound]);
  check('a DIFFERENT flight the same day survives', out.length === 1, out.length);

  // Two airlines, same number.
  const ua = sheetRow({ id:'ITIN-2', metadata: JSON.stringify({ airline:'UA', flightNum:'404' }) });
  const dl = calItem({ id:'CAL-3', title:'Flight to Atlanta (DL 404)' });
  check('same number, different airline survives',
        ctx.suppressCalendarDuplicatesOfRows_([dl], [ua]).length === 1);

  // Same flight number on a different DAY.
  const other = ctx.suppressCalendarDuplicatesOfRows_(
    [calItem({ date: '2026-09-28' })], [sheetRow()]);
  check('the same flight on another day survives', other.length === 1, other.length);

  // A flight with no number anywhere must not collide with another.
  const vague1 = sheetRow({ id:'ITIN-3', title:'Flight home', metadata:'{}' });
  const vague2 = calItem({ id:'CAL-4', title:'Flight somewhere', metadata:'{}' });
  check('flights with no number are left alone',
        ctx.suppressCalendarDuplicatesOfRows_([vague2], [vague1]).length === 1);
}

console.log('\nnon-flights behave exactly as before');
{
  const hotel     = { id:'ITIN-H', type:'hotel', title:'Airbnb Stay', date:DAY,
                      startTime:'15:00', endTime:'', location:'Gulf Blvd', metadata:'{}' };
  const hotelCal  = calItem({ id:'CAL-H', type:'hotel', title:'Airbnb Stay',
                              startTime:'15:00', endTime:'' });
  check('a duplicate hotel is NOT merged across sources',
        ctx.suppressCalendarDuplicatesOfRows_([hotelCal], [hotel]).length === 1,
        'no natural key — merging two real bookings would be worse');

  const dinner1 = calItem({ id:'CAL-D1', type:'dining', title:'Dinner', startTime:'19:00', endTime:'21:00' });
  const dinner2 = calItem({ id:'CAL-D2', type:'dining', title:'Drinks',  startTime:'19:00', endTime:'21:00' });
  check('two different same-slot events still do not merge',
        ctx.dedupeItineraryCalendarItems_([dinner1, dinner2]).length === 2);
}

console.log('\nwithin the calendar — differing titles now merge');
{
  // The same flight on three calendars, titled inconsistently.
  const three = [
    calItem({ id:'CAL-1', title:'Flight to Washington (UA 1370)', _descLength: 10 }),
    calItem({ id:'CAL-2', title:'Flight UA1370 TPA to IAD',       _descLength: 400 }),
    calItem({ id:'CAL-3', title:'UA 1370',                        _descLength: 30 }),
  ];
  const out = ctx.dedupeItineraryCalendarItems_(three);
  check('three differently-titled copies collapse to one', out.length === 1, out.length);
  check('the richest description still wins', out[0].id === 'CAL-2', out[0].id);

  // …and three copies plus a sheet row gives exactly one item.
  const stored = [sheetRow()];
  const after  = ctx.suppressCalendarDuplicatesOfRows_(ctx.dedupeItineraryCalendarItems_(three), stored);
  check('three calendars + a sheet row = ONE flight', stored.length + after.length === 1,
        stored.length + after.length);
}

console.log('\n5c9eaf0 still holds');
{
  // A confirmed flight must not come back as a hold through the new path.
  const copies = [
    calItem({ id:'CAL-1', _descLength: 10,  metadata: JSON.stringify({ calendarName:'Personal' }) }),
    calItem({ id:'CAL-2', _descLength: 400, metadata: JSON.stringify({ calendarName:'Shared', tentative:true }) }),
  ];
  const out = ctx.dedupeItineraryCalendarItems_(copies);
  check('a booked flight stays confirmed', meta(out[0]).tentative !== true, JSON.stringify(meta(out[0])));
}

console.log('\nedge cases');
{
  check('no calendar items', ctx.suppressCalendarDuplicatesOfRows_([], [sheetRow()]).length === 0);
  check('no stored items',   ctx.suppressCalendarDuplicatesOfRows_([calItem()], []).length === 1);
  check('null calendar',     ctx.suppressCalendarDuplicatesOfRows_(null, [sheetRow()]).length === 0);
  check('null stored',       ctx.suppressCalendarDuplicatesOfRows_([calItem()], null).length === 1);

  let threw = false;
  try {
    ctx.suppressCalendarDuplicatesOfRows_([calItem({ metadata: '{bad' })],
                                          [sheetRow({ metadata: '{also bad' })]);
  } catch (e) { threw = true; }
  check('unparseable metadata on both sides does not throw', !threw);
}

console.log('\nFlightStatus no longer carries its own copy');
{
  const FS = fs.readFileSync(ROOT + '/FlightStatus.js', 'utf8');
  // Match the regex by its distinctive character class rather than trying to
  // escape a regex literal inside a regex literal, which is what made this
  // assertion pass vacuously the first time.
  check('the inline regex is gone', FS.indexOf('[A-Z]{2}') === -1,
        'still present at index ' + FS.indexOf('[A-Z]{2}'));
  check('it calls the shared helper', /flightKeyFor_\(/.test(FS));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
