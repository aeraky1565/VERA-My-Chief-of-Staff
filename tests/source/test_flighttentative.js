// A booked flight was being drawn as a hold.
//
// Two causes. Busy/Free was read as a tentative signal, and a confirmed flight
// marked "Free" so it does not block the work calendar is the commonest event
// there is. And when the same flight sits on three calendars, the dedupe picked
// a winner by DESCRIPTION LENGTH and let that copy carry its own tentative
// flag — so whether your flight read as confirmed depended on which calendar
// happened to be the wordiest, and flipped when someone edited a description.
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
const TD  = fs.readFileSync(ROOT + '/TripDecisions.js', 'utf8');

function build() {
  const ctx = { Logger: { log(){} }, JSON, String, Number, Math, parseInt, Object, Array, RegExp, Date };
  vm.createContext(ctx);
  // dedupeItineraryCalendarItems_ keys flights on their number now, so it needs
  // flightKeyFor_ in scope too.
  vm.runInContext(extract(WEB, 'flightKeyFor_'), ctx);
  vm.runInContext(extract(WEB, 'dedupeItineraryCalendarItems_'), ctx);
  vm.runInContext(TD, ctx);
  return ctx;
}
const E = build();

// A calendar item the way webGetItinerary_ builds one.
const cal = o => Object.assign({
  id: 'CAL-x', tripKey: 'T', type: 'flight', title: 'Flight to Miami (UA 1073)',
  date: '2026-11-06', startTime: '08:40', endTime: '11:33', allDay: false,
  location: 'Washington IAD', notes: '', metadata: JSON.stringify({ calendarName: 'Personal' }),
  source: 'calendar', row: null, _descLength: 0, _isPersonal: true,
}, o);

const meta = it => { try { return JSON.parse(it.metadata || '{}'); } catch (e) { return {}; } };

console.log('\nthe reported bug — a booked flight drawn as a hold');
{
  // The flight on three calendars. One copy is marked Free; under the old code
  // that alone made it tentative, and the wordiest copy decided the outcome.
  const three = [
    cal({ id:'CAL-1', metadata: JSON.stringify({ calendarName:'Personal' }),        _descLength: 12,  _isPersonal: true  }),
    cal({ id:'CAL-2', metadata: JSON.stringify({ calendarName:'Shared', tentative:true }), _descLength: 400, _isPersonal: false }),
    cal({ id:'CAL-3', metadata: JSON.stringify({ calendarName:'Work' }),            _descLength: 30,  _isPersonal: false }),
  ];
  const out = E.dedupeItineraryCalendarItems_(three);

  check('three copies collapse to one', out.length === 1, out.length);
  check('and it is NOT tentative', meta(out[0]).tentative !== true, JSON.stringify(meta(out[0])));
  check('…even though the WINNING copy was the tentative one',
        out[0].id === 'CAL-2', out[0].id + ' (description-length winner)');
  check('the richest description still wins the content', out[0].id === 'CAL-2', out[0].id);

  // And it does not depend on ordering.
  const reordered = [three[1], three[2], three[0]].map(x => Object.assign({}, x));
  const out2 = E.dedupeItineraryCalendarItems_(reordered);
  check('the answer does not depend on calendar order',
        meta(out2[0]).tentative !== true, JSON.stringify(meta(out2[0])));
}

console.log('\nwhen every copy really is a hold');
{
  const held = [
    cal({ id:'CAL-1', type:'dining', title:'Tentative dinner w friends',
          metadata: JSON.stringify({ calendarName:'Personal', tentative:true }), _descLength: 5 }),
    cal({ id:'CAL-2', type:'dining', title:'Tentative dinner w friends',
          metadata: JSON.stringify({ calendarName:'Shared', tentative:true }), _descLength: 50 }),
  ];
  const out = E.dedupeItineraryCalendarItems_(held);
  check('it stays a hold', meta(out[0]).tentative === true, JSON.stringify(meta(out[0])));
  check('…because no copy disagreed', out.length === 1, out.length);
}

console.log('\nthe text path — the one that is supposed to work — still does');
{
  // This is the user's own event from the screenshot.
  const items = [
    { id:'A', type:'dining', title:'Tentative dinner w friends', date:'2026-11-07',
      startTime:'19:00', endTime:'20:00', location:'', notes:'', metadata:'{}' },
    { id:'B', type:'dining', title:'Dinner at Joe’s — option 2', date:'2026-11-07',
      startTime:'19:00', endTime:'20:00', location:'', notes:'', metadata:'{}' },
  ];
  E.annotateOptionGroups_(items);
  check('"Tentative ..." in the title is still a hold', meta(items[0]).tentative === true,
        JSON.stringify(meta(items[0])));
  check('"... option 2" is too', meta(items[1]).tentative === true, JSON.stringify(meta(items[1])));
  check('…and they group as one decision', meta(items[0]).optionGroup === meta(items[1]).optionGroup,
        meta(items[0]).optionGroup + ' vs ' + meta(items[1]).optionGroup);
}

console.log('\na confirmed flight is never inferred into a hold');
{
  const flight = [{ id:'F', type:'flight', title:'Flight to Miami (UA 1073)', date:'2026-11-06',
                    startTime:'08:40', endTime:'11:33', location:'Washington IAD', notes:'', metadata:'{}' }];
  E.annotateOptionGroups_(flight);
  check('a plain flight title is not a hold', meta(flight[0]).tentative !== true,
        JSON.stringify(meta(flight[0])));

  // But saying so in the title still works — holding two flights is legitimate.
  const held = [{ id:'F2', type:'flight', title:'Flight to Miami (UA 1073) — option A', date:'2026-11-06',
                  startTime:'08:40', endTime:'11:33', location:'IAD', notes:'', metadata:'{}' }];
  E.annotateOptionGroups_(held);
  check('a flight you DID mark as an option is a hold', meta(held[0]).tentative === true,
        JSON.stringify(meta(held[0])));
}

console.log('\nthe source no longer reads Busy/Free at all');
{
  check('getTransparency is gone from WebApp.js', !/getTransparency/.test(WEB));
  check('EventTransparency is gone too',          !/EventTransparency/.test(WEB));
  check('the explicit Maybe RSVP is kept',        /GuestStatus\.MAYBE/.test(WEB));
  check('…but not for transport or lodging',
        /NEVER_INFERRED_TENTATIVE_/.test(WEB) && /'flight', 'hotel', 'cruise', 'train'/.test(WEB));
}

console.log('\nthe dedupe is otherwise unchanged');
{
  const two = [
    cal({ id:'CAL-1', _descLength: 10, _isPersonal: true }),
    cal({ id:'CAL-2', _descLength: 99, _isPersonal: false }),
  ];
  const out = E.dedupeItineraryCalendarItems_(two);
  check('the richer description still wins', out[0].id === 'CAL-2', out[0].id);
  check('scoring fields are stripped',
        out[0]._descLength === undefined && out[0]._isPersonal === undefined,
        JSON.stringify(Object.keys(out[0])));

  const tie = [
    cal({ id:'CAL-1', _descLength: 10, _isPersonal: true }),
    cal({ id:'CAL-2', _descLength: 10, _isPersonal: false }),
  ];
  check('a tie still goes to the shared calendar',
        E.dedupeItineraryCalendarItems_(tie)[0].id === 'CAL-2');

  const different = [
    cal({ id:'CAL-1', title: 'Flight to Miami' }),
    cal({ id:'CAL-2', title: 'Dinner' }),
  ];
  check('genuinely different events are NOT merged',
        E.dedupeItineraryCalendarItems_(different).length === 2);

  check('an empty list is fine', E.dedupeItineraryCalendarItems_([]).length === 0);
  check('null is fine',         E.dedupeItineraryCalendarItems_(null).length === 0);

  const broken = [cal({ id:'CAL-1', metadata: '{not json' }), cal({ id:'CAL-2', metadata: '{}' })];
  let threw = false;
  try { E.dedupeItineraryCalendarItems_(broken); } catch (e) { threw = true; }
  check('unparseable metadata does not throw', !threw);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
