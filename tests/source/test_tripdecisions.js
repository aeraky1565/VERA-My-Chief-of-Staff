// The REAL detection and grouping from TripDecisions.js. The headline case is
// three holds of DIFFERENT types over one afternoon forming ONE group — grouping
// on type would file them as three unrelated decisions, which is the bug this
// module exists to avoid.

const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC  = fs.readFileSync(ROOT + '/TripDecisions.js', 'utf8');

const ctx = { JSON, String, Number, Math, parseInt, Object, Array, RegExp };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const { isTentativeText_, timeBucketOf_, annotateOptionGroups_, collapseOptionGroups_ } = ctx;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

let seq = 0;
const item = (o) => Object.assign({
  id: 'I' + (++seq), tripKey: 'T', type: 'calendar', title: '', date: '2026-11-08',
  startTime: '', endTime: '', location: '', notes: '', metadata: '', allDay: false,
}, o);
const meta  = (it) => { try { return JSON.parse(it.metadata || '{}'); } catch (e) { return {}; } };
const groups = (items) => {
  const g = {};
  items.forEach(it => { const m = meta(it); if (m.optionGroup) (g[m.optionGroup] = g[m.optionGroup] || []).push(it.title); });
  return g;
};

console.log('\ndetection');
{
  ['Dinner (tentative)', 'Lunch TBD', 'Maybe the museum', 'Option 2: beach',
   'Plan A — hiking', 'Brunch [?]', 'Tour (?)', 'Alt: indoor market'].forEach(t =>
    check('"' + t + '" is a hold', isTentativeText_(t, '') === true));

  ['Dinner at Rasika', 'Flight UA640', 'Hotel check-in'].forEach(t =>
    check('"' + t + '" is not', isTentativeText_(t, '') === false));

  check('"maybenot" does not trip the word "maybe"', isTentativeText_('maybenot', '') === false);
  check('"optional extras" does not trip "option"', isTentativeText_('optional extras', '') === false);
  check('a marker in the notes counts', isTentativeText_('Dinner', 'still tentative') === true);
  check('blank is not a hold', isTentativeText_('', '') === false);
}

console.log('\ntime buckets');
{
  check('09:00 → morning', timeBucketOf_('09:00') === 'morning');
  check('11:00 → midday',  timeBucketOf_('11:00') === 'midday');
  check('15:59 → midday',  timeBucketOf_('15:59') === 'midday');
  check('16:00 → evening', timeBucketOf_('16:00') === 'evening');
  check('no time → blank', timeBucketOf_('') === '');
}

console.log('\nTHE CASE THIS EXISTS FOR — three types, one afternoon');
{
  const items = [
    item({ title: 'Maybe the Frost Museum', type: 'museum',   startTime: '14:00', endTime: '16:30' }),
    item({ title: 'Beach afternoon (tentative)', type: 'beach', startTime: '14:30', endTime: '17:00' }),
    item({ title: 'Lincoln Road shopping — option', type: 'shopping', startTime: '15:00', endTime: '17:00' }),
  ];
  annotateOptionGroups_(items);
  const g = groups(items);
  check('all three land in ONE group', Object.keys(g).length === 1, JSON.stringify(g));
  check('the group counts three', meta(items[0]).optionCount === 3, meta(items[0]).optionCount);
  check('exactly one representative', items.filter(i => meta(i).isRepresentative).length === 1,
        items.map(i => i.title + '=' + meta(i).isRepresentative).join(' | '));
  check('the earliest is the representative', meta(items[0]).isRepresentative === true);
  check('the key is date|earliest-start', meta(items[0]).optionGroup === '2026-11-08|14:00',
        meta(items[0]).optionGroup);
  check('all three are marked tentative', items.every(i => meta(i).tentative === true));
}

console.log('\noverlap groups, separation does not');
{
  let items = [
    item({ title: 'Lunch A (tentative)',  type: 'dining', startTime: '12:00', endTime: '13:30' }),
    item({ title: 'Dinner B (tentative)', type: 'dining', startTime: '19:00', endTime: '21:00' }),
  ];
  annotateOptionGroups_(items);
  check('lunch and dinner stay two decisions', Object.keys(groups(items)).length === 2,
        JSON.stringify(groups(items)));

  items = [
    item({ title: 'Morning hike (tentative)', type: 'outdoor', startTime: '08:00', endTime: '10:00' }),
    item({ title: 'Evening show (maybe)',     type: 'show',    startTime: '20:00', endTime: '22:00' }),
  ];
  annotateOptionGroups_(items);
  check('a morning hold and an evening hold do not group', Object.keys(groups(items)).length === 2);

  items = [
    item({ title: 'Touching A (tentative)', type: 'a', startTime: '12:00', endTime: '13:00' }),
    item({ title: 'Touching B (tentative)', type: 'b', startTime: '13:00', endTime: '14:00' }),
  ];
  annotateOptionGroups_(items);
  check('ranges that merely touch do not overlap', Object.keys(groups(items)).length === 2,
        JSON.stringify(groups(items)));
}

console.log('\nexplicit markers beat the clock');
{
  const items = [
    item({ title: 'Plan A — morning museum', type: 'museum', startTime: '09:00', endTime: '11:00' }),
    item({ title: 'Plan B — afternoon beach', type: 'beach',  startTime: '15:00', endTime: '18:00' }),
  ];
  annotateOptionGroups_(items);
  check('Plan A and Plan B group despite six hours apart',
        Object.keys(groups(items)).length === 1, JSON.stringify(groups(items)));
  check('Option 1 / Option 2 likewise', (() => {
    const i2 = [
      item({ title: 'Option 1: kayaking', type: 'x', startTime: '09:00', endTime: '10:00' }),
      item({ title: 'Option 2: gallery',  type: 'y', startTime: '16:00', endTime: '17:00' }),
    ];
    annotateOptionGroups_(i2);
    return Object.keys(groups(i2)).length === 1;
  })());
}

console.log('\nsame bucket + same type — the no-end-time fallback');
{
  let items = [
    item({ title: 'Dinner option 1', type: 'dining', startTime: '19:00' }),
    item({ title: 'Dinner option 2', type: 'dining', startTime: '20:00' }),
  ];
  annotateOptionGroups_(items);
  check('two timed dining holds in one bucket group',
        Object.keys(groups(items)).length === 1, JSON.stringify(groups(items)));

  items = [
    item({ title: 'Dinner (tentative)', type: 'dining', startTime: '19:00' }),
    item({ title: 'Show (tentative)',   type: 'show',   startTime: '20:00' }),
  ];
  annotateOptionGroups_(items);
  check('different types with no end times do NOT group — under-grouping is the cheaper error',
        Object.keys(groups(items)).length === 2, JSON.stringify(groups(items)));
}

console.log('\nwhat must never be absorbed');
{
  const items = [
    item({ title: 'Rasika — BOOKED', type: 'dining', startTime: '19:00', endTime: '21:00' }),
    item({ title: 'Komi (tentative)', type: 'dining', startTime: '19:30', endTime: '21:30' }),
  ];
  annotateOptionGroups_(items);
  check('a confirmed booking is never grouped', !meta(items[0]).optionGroup,
        JSON.stringify(meta(items[0])));
  check('…and is not marked tentative', meta(items[0]).tentative !== true);
  check('the hold beside it still gets a group', !!meta(items[1]).optionGroup);

  const allDay = [
    item({ title: 'Maybe a day trip', type: 'calendar', startTime: '', allDay: true }),
    item({ title: 'Maybe another',    type: 'calendar', startTime: '', allDay: true }),
  ];
  annotateOptionGroups_(allDay);
  check('all-day holds are never grouped — no slot to compete for',
        Object.keys(groups(allDay)).length === 0, JSON.stringify(groups(allDay)));
  check('…but are still flagged tentative', allDay.every(i => meta(i).tentative === true));

  const crossDay = [
    item({ title: 'Sat option (tentative)', type: 'x', date: '2026-11-08', startTime: '14:00', endTime: '16:00' }),
    item({ title: 'Sun option (tentative)', type: 'x', date: '2026-11-09', startTime: '14:00', endTime: '16:00' }),
  ];
  annotateOptionGroups_(crossDay);
  check('holds on different days never group', Object.keys(groups(crossDay)).length === 2);
}

console.log('\ntransitivity and stability');
{
  const items = [
    item({ title: 'A', type: 'x', startTime: '14:00', endTime: '15:00' }),
    item({ title: 'B', type: 'y', startTime: '14:45', endTime: '16:00' }),
    item({ title: 'C', type: 'z', startTime: '15:45', endTime: '17:00' }),
  ].map(i => Object.assign(i, { title: i.title + ' (tentative)' }));
  annotateOptionGroups_(items);
  check('A~B and B~C put all three in one group (A and C never overlap)',
        Object.keys(groups(items)).length === 1, JSON.stringify(groups(items)));

  const mk = () => [
    item({ id: 'Z1', title: 'Late (tentative)',  type: 'x', startTime: '15:00', endTime: '17:00' }),
    item({ id: 'Z2', title: 'Early (tentative)', type: 'x', startTime: '14:00', endTime: '16:00' }),
  ];
  const a = mk(), b = mk();
  annotateOptionGroups_(a); annotateOptionGroups_(b);
  check('repeated reads give identical keys',
        meta(a[0]).optionGroup === meta(b[0]).optionGroup && meta(a[0]).optionGroup === '2026-11-08|14:00',
        meta(a[0]).optionGroup);
  check('the representative is the earliest even when listed second',
        meta(a[1]).isRepresentative === true && meta(a[0]).isRepresentative === false);
}

console.log('\na lone hold is a decision with one option');
{
  const items = [item({ title: 'Maybe the spa', type: 'spa', startTime: '15:00', endTime: '16:00' })];
  annotateOptionGroups_(items);
  check('it gets a group', !!meta(items[0]).optionGroup);
  check('optionCount is 1', meta(items[0]).optionCount === 1, meta(items[0]).optionCount);
  check('and it is its own representative', meta(items[0]).isRepresentative === true);
}

console.log('\ncollapse — one occupied slot per decision');
{
  const items = [
    item({ title: 'Flight UA640', type: 'flight', startTime: '08:00', endTime: '11:00' }),
    item({ title: 'Museum (tentative)',   type: 'museum',   startTime: '14:00', endTime: '16:30' }),
    item({ title: 'Beach (tentative)',    type: 'beach',    startTime: '14:30', endTime: '17:00' }),
    item({ title: 'Shopping (tentative)', type: 'shopping', startTime: '15:00', endTime: '17:00' }),
  ];
  annotateOptionGroups_(items);
  const kept = collapseOptionGroups_(items);
  check('four items collapse to two', kept.length === 2, kept.map(i => i.title).join(' | '));
  check('the confirmed flight survives', kept.some(i => /UA640/.test(i.title)));
  check('exactly one of the three holds survives',
        kept.filter(i => /tentative/.test(i.title)).length === 1, kept.map(i => i.title).join(' | '));
  check('and it is the representative', meta(kept.find(i => /tentative/.test(i.title))).isRepresentative === true);

  // The negative control: without annotation there is nothing to collapse, and
  // all three holds occupy the afternoon — the bug this prevents.
  const raw = [
    item({ title: 'Museum',   type: 'museum',   startTime: '14:00', endTime: '16:30' }),
    item({ title: 'Beach',    type: 'beach',    startTime: '14:30', endTime: '17:00' }),
    item({ title: 'Shopping', type: 'shopping', startTime: '15:00', endTime: '17:00' }),
  ];
  check('un-annotated items are NOT collapsed (proves the flag does the work)',
        collapseOptionGroups_(raw).length === 3, collapseOptionGroups_(raw).length);
  check('collapse on an empty list is safe', collapseOptionGroups_([]).length === 0);
  check('collapse on null is safe', collapseOptionGroups_(null).length === 0);
}

console.log('\nmalformed metadata does not throw');
{
  const items = [item({ title: 'Maybe X', type: 'x', startTime: '14:00', endTime: '15:00', metadata: '{not json' })];
  let threw = null;
  try { annotateOptionGroups_(items); } catch (e) { threw = e.message; }
  check('a bad metadata cell is survivable', threw === null, threw);
  check('…and the item is still annotated', meta(items[0]).tentative === true, items[0].metadata);

  const preserved = [item({ title: 'Maybe Y', type: 'y', startTime: '14:00', endTime: '15:00',
                            metadata: '{"calendarName":"Joint Chaos","startTz":"America/New_York"}' })];
  annotateOptionGroups_(preserved);
  check('existing metadata keys survive annotation',
        meta(preserved[0]).calendarName === 'Joint Chaos' && meta(preserved[0]).startTz === 'America/New_York',
        preserved[0].metadata);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
