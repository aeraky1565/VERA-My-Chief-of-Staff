// Issue #221: two plans for one slot show as two plans, even when neither is a hold.
//
// Nov 6, 8pm: a booked dinner (a reservation email made the calendar event)
// and a second dinner at the same time, added from a suggestion. Neither was
// marked tentative, so VERA listed two 8pm dinners and no choice. Bookings now
// compete when they genuinely overlap. Holds keep their rules exactly.
//
// Invented places throughout.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const TD = fs.readFileSync(ROOT + '/TripDecisions.js', 'utf8');
const APP = fs.readFileSync(ROOT + '/docs/app.js', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

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
const varLine = name => new RegExp('^var ' + name + '\\s*=[\\s\\S]*?;\\s*$', 'm').exec(TD)[0];

const ctx = { String, Number, Object, Array, JSON, Math, RegExp, parseInt, Error };
vm.createContext(ctx);
vm.runInContext(['TENTATIVE_PATTERNS_', 'OPTION_MARKER_RE_', 'TD_NEVER_CLASH_TYPES_', 'TD_CLASH_MAX_MINS_', 'TD_CLASH_DEFAULT_MINS_']
  .map(varLine).concat(['isTentativeText_', 'hasExplicitOptionMarker_', 'timeBucketOf_', 'tdTimeToMins_', 'tdReadMeta_',
    'tdWriteMeta_', 'tdAreAlternatives_', 'tdClashSpan_', 'annotateOptionGroups_'].map(n => extractFn(TD, n))).join('\n'), ctx);

let seq = 0;
const item = o => Object.assign({ id: 'CAL-' + (++seq), title: 'x', type: 'dining', date: '2026-11-06',
  startTime: '', endTime: '', notes: '', metadata: '{}', allDay: false }, o);
const meta = it => JSON.parse(it.metadata || '{}');
const run = items => { ctx.__i = items; vm.runInContext('annotateOptionGroups_(__i)', ctx); return items; };

console.log('\nTHE REPORTED NIGHT: a booked dinner and a suggested one at 8pm');
{
  const booked = item({ id: 'CAL-joyce', title: 'Reservation at The Patio', startTime: '20:00', endTime: '21:00', type: 'calendar' });
  const sugg = item({ id: 'ITIN-REC-1', title: 'Dinner at the Spanish place', startTime: '20:00', endTime: '' });
  run([sugg, booked]);
  check('they are one choice', meta(booked).optionGroup && meta(booked).optionGroup === meta(sugg).optionGroup,
        JSON.stringify([meta(booked), meta(sugg)]));
  check('…of 2 plans', meta(booked).optionCount === 2);
  check('the booking is shown first, over the suggestion', meta(booked).isRepresentative === true &&
        meta(sugg).isRepresentative === false);
  check('neither is called a hold', meta(booked).tentative !== true && meta(sugg).tentative !== true);
}

console.log('\nonly a real overlap makes a choice');
{
  const a = item({ title: 'Early dinner', startTime: '18:00', endTime: '19:30' });
  const b = item({ title: 'Late drinks', startTime: '20:00', endTime: '22:00' });
  run([a, b]);
  check('back-to-back plans stay separate', !meta(a).optionGroup && !meta(b).optionGroup);
  const c = item({ title: 'Dinner', startTime: '19:00' });
  const d = item({ title: 'Show', type: 'show', startTime: '20:45', endTime: '22:30' });
  run([c, d]);
  check('no end time counts as 90 minutes, so 7pm and 8:45pm do not clash', !meta(c).optionGroup, JSON.stringify(meta(c)));
  const e = item({ title: 'Lone dinner', startTime: '19:00', endTime: '21:00' });
  run([e]);
  check('a booking on its own is just a booking', !meta(e).optionGroup);
  const f = item({ title: 'Dinner', date: '2026-11-06', startTime: '20:00', endTime: '21:00' });
  const g = item({ title: 'Dinner', date: '2026-11-07', startTime: '20:00', endTime: '21:00' });
  run([f, g]);
  check('the same time on different days stays separate', !meta(f).optionGroup);
}

console.log('\nthe frame of a day never becomes a choice');
{
  const port = item({ title: 'Island port day', type: 'calendar', startTime: '09:00', endTime: '17:00' });
  const exc = item({ title: 'Snorkel excursion', type: 'snorkeling', startTime: '13:30', endTime: '15:00' });
  const lunch = item({ title: 'Beach lunch', startTime: '12:00', endTime: '13:15' });
  run([port, exc, lunch]);
  check('an 8-hour port day does not swallow what happens inside it', !meta(port).optionGroup &&
        !meta(exc).optionGroup && !meta(lunch).optionGroup, JSON.stringify([meta(port), meta(exc), meta(lunch)]));
  const fl = item({ title: 'Flight UA1', type: 'flight', startTime: '19:00', endTime: '21:00' });
  const din = item({ title: 'Dinner', startTime: '19:30', endTime: '21:00' });
  run([fl, din]);
  check('a flight is never one of the plans', !meta(fl).optionGroup && !meta(din).optionGroup);
  const ht = item({ title: 'Hotel check-in', type: 'hotel', startTime: '15:00', endTime: '16:00' });
  const tea = item({ title: 'Tea', startTime: '15:00', endTime: '16:00' });
  run([ht, tea]);
  check('nor is a stay', !meta(ht).optionGroup);
  const ad = item({ title: 'Museum day', allDay: true, startTime: '' });
  run([ad, item({ title: 'Museum café', startTime: '12:00', endTime: '13:00' })]);
  check('all-day items never take part', !meta(ad).optionGroup);
}

console.log('\nholds work exactly as before');
{
  const h1 = item({ title: 'Dinner at A (tentative)', startTime: '19:00', endTime: '21:00' });
  const h2 = item({ title: 'Dinner at B (tentative)', startTime: '20:00', endTime: '22:00' });
  run([h1, h2]);
  check('two overlapping holds are one choice', meta(h1).optionGroup && meta(h1).optionGroup === meta(h2).optionGroup);
  check('…both still marked as holds', meta(h1).tentative === true && meta(h2).tentative === true);
  const h3 = item({ title: 'Brunch (hold)', startTime: '10:00' });
  const h4 = item({ title: 'Breakfast (hold)', startTime: '09:00' });
  run([h3, h4]);
  check('holds of the same kind in the same part of the day still group without times overlapping',
        meta(h3).optionGroup && meta(h3).optionGroup === meta(h4).optionGroup,
        JSON.stringify([meta(h3), meta(h4)]));
  const h5 = item({ title: 'Lone hold (tentative)', startTime: '18:00' });
  run([h5]);
  check('a lone hold still gets its own group, as before', !!meta(h5).optionGroup && meta(h5).optionCount === 1);
  const hb = item({ title: 'Booked dinner', startTime: '19:00', endTime: '21:00' });
  const hh = item({ title: 'Other dinner (tentative)', startTime: '19:30', endTime: '21:30' });
  run([hh, hb]);
  check('a hold beside a booking: one choice, the booking first', meta(hb).optionGroup === meta(hh).optionGroup &&
        meta(hb).isRepresentative === true);
}

console.log('\nthe dashboard shows the choice');
{
  check('the options chip shows for a group led by a booking, not just for holds',
        /function itinOptionsChip\(item\)\{var n=optionCountOf\(item\);if\(!isTentativeItem\(item\)&&!\(n>1&&!isDecidedItem\(item\)\)\)return null;/.test(APP));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
