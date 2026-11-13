// Issue #248: next year's PTO plan (PTOStrategy.js), on invented calendars.
//  - the US federal holidays, observed on the nearest weekday;
//  - breaks: a run of days off made by PTO next to weekends and holidays, for both of you or
//    one; never stretchable for free, never over a locked trip, a reserve or a blackout;
//  - the plan: together first, then each; the strategies; the budget (allowance + carryover,
//    personal first, pencilled trips held, buffer kept); nothing lost over the cap;
//    accepted breaks are fixed, skipped ones hidden (or allowed back);
//  - this year's leftovers; when the plan is due; the request-at-work flags;
//  - accept / skip / remove, the nightly step, Away mode on the day, each person's own card;
//  - the wiring: routes, the notification row, the flag kinds, the morning email, two fixes.
// Invented people's calendars and trips.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PTS = read('PTOStrategy.js'), WEB = read('WebApp.js'), CODE = read('Code.js'), FT = read('FlagsTasks.js'), MR = read('MonthlyReview.js'), WP = read('WeekendPlanner.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function ctx(extra) { const c = Object.assign({ console, Logger: { log: () => {} } }, extra || {}); vm.createContext(c); vm.runInContext(PTS, c); return c; }
const P = ctx();

console.log('\nfederal holidays');
{
  const h = P.ptsFederalHolidays_(2027);
  check('2027: eleven days, observed on weekdays', Object.keys(h).length === 12 && Object.keys(h).every(d => [0, 6].indexOf(P.ptsDow_(d)) === -1), J(h));
  check('Independence Day on a Sunday is observed Monday Jul 5', h['2027-07-05'] === 'Independence Day');
  check('Christmas on a Saturday is observed Friday Dec 24', h['2027-12-24'] === 'Christmas Day');
  check('New Year’s Day 2028 on a Saturday is observed Dec 31, 2027', /New Year/.test(h['2027-12-31'] || ''));
  check('Thanksgiving: the 4th Thursday; Memorial Day: the last Monday', h['2027-11-25'] === 'Thanksgiving' && h['2027-05-31'] === 'Memorial Day');
  check('only federal days: not the day after Thanksgiving or Christmas Eve', !h['2027-11-26'] && !P.ptsFederalHolidays_(2026)['2026-12-24']);
  check('2022: Jan 1 on a Saturday leaves 2022 without a New Year’s Day', !Object.keys(P.ptsFederalHolidays_(2022)).some(d => d.startsWith('2022-01-0')));
}

const FED = P.ptsFederalHolidays_(2027);
const AH = Object.assign({}, FED, { '2027-11-26': 'Day after Thanksgiving' });
const person = (id, hol, extra) => Object.assign({ id, name: id === 'ahmed' ? 'Ahmed' : 'Victoria', holidays: hol, assumed: false, busy: [], blackouts: [] }, extra || {});

console.log('\nbreaks');
{
  const A = person('ahmed', AH), V = person('victoria', FED);
  const all = P.ptsCandidates_([A, V], '2027-01-02', '2027-12-31', { maxPto: 5, minRatio: 2 });
  const mem = all.find(c => c.start === '2027-05-28' && c.end === '2027-05-31');
  check('Memorial Day: take Fri May 28, get 4 off, together', mem && mem.who === 'joint' && J(mem.pto) === J({ ahmed: ['2027-05-28'], victoria: ['2027-05-28'] }) && mem.ratio === 4 && mem.slot === 'longWeekend', J(mem));
  check('a break can’t be stretched for free (none starts the day after a shared day off)', all.every(c => !([A, V].every(p => P.ptsOff_(p, P.ptsAdd_(c.start, -1))))));
  check('…or ends the day before one', all.every(c => !([A, V].every(p => P.ptsOff_(p, P.ptsAdd_(c.end, 1))))));
  const thx = P.ptsCandidates_([A, V], '2027-11-01', '2027-12-31', { maxPto: 5, minRatio: 1 }).find(c => c.start === '2027-11-20' && c.end === '2027-11-28');
  check('Thanksgiving week together costs each their own days (one has the Friday off)', thx && thx.pto.ahmed.length === 3 && thx.pto.victoria.length === 4 && thx.cost === 4, J(thx));
  check('no break costs more than maxPto', P.ptsCandidates_([A], '2027-01-02', '2027-12-31', { maxPto: 2, minRatio: 1 }).every(c => c.pto.ahmed.length <= 2));
  check('none below the ratio', P.ptsCandidates_([A], '2027-01-02', '2027-12-31', { maxPto: 5, minRatio: 3 }).every(c => c.ratio >= 3));
  const busyA = person('ahmed', AH, { busy: [['2027-05-27', '2027-06-02']] });
  check('none over a locked trip', !P.ptsCandidates_([busyA], '2027-05-01', '2027-06-30', { maxPto: 5, minRatio: 1 }).some(c => P.ptsOverlaps_(c.start, c.end, '2027-05-27', '2027-06-02')));
  const blk = person('ahmed', AH, { blackouts: [['2027-05-24', '2027-05-28']] });
  check('none over a blackout', !P.ptsCandidates_([blk], '2027-05-01', '2027-06-30', { maxPto: 5, minRatio: 1 }).some(c => P.ptsOverlaps_(c.start, c.end, '2027-05-24', '2027-05-28')));
  const xmas = P.ptsCandidates_([A, V], '2027-12-01', '2027-12-31', { maxPto: 5, minRatio: 1 }).find(c => c.start === '2027-12-24' && c.end === '2028-01-02');
  check('Christmas to New Year runs into January; only this year’s days are PTO', xmas && xmas.end === '2028-01-02' && xmas.pto.ahmed.every(d => d < '2028') && P.ptsLabel_(xmas) === 'Christmas to New Year', J(xmas));
  check('no break puts PTO into next January (that’s next year’s plan)', P.ptsCandidates_([A, V], '2027-12-01', '2027-12-31', { maxPto: 5, minRatio: 1 }).every(c => Object.keys(c.pto).every(k => c.pto[k].every(d => d < '2028-01-01'))));
  const assumedV = person('victoria', FED, { assumed: true });
  check('a break over an assumed holiday says so', P.ptsCandidates_([assumedV], '2027-05-01', '2027-06-30', { maxPto: 5, minRatio: 2 }).find(c => c.start === '2027-05-28').assumed === true);
}

function input(over) {
  return Object.assign({ year: 2027, today: '2026-11-26', settings: P.ptsSettings_({}),
    people: [person('ahmed', AH, { budget: { vacation: 20, carry: 4, personal: 6, booked: 0, buffer: 2, capCarry: 23, accrual: { annual: 20, day: 16, cap: 25 } } }),
             person('victoria', FED, { assumed: true, budget: { vacation: 15, carry: 2, personal: 0, booked: 0, buffer: 2, capCarry: null } })],
    locked: [{ label: 'Lisbon', start: '2027-04-09', end: '2027-04-18' }],
    pencilled: [{ label: 'Beach week', months: ['2027-08'], days: 8, who: ['ahmed', 'victoria'] }], saved: {} }, over || {});
}
const ptoOf = (picks, id) => picks.reduce((n, c) => n + ((c.pto[id] || []).length), 0);

console.log('\nthe plan');
{
  const r = P.ptsPlan_(input());
  check('picks are in date order', r.picks.every((c, i) => !i || r.picks[i - 1].start <= c.start));
  check('nothing over the locked trip or the pencilled reserve', !r.picks.some(c => P.ptsOverlaps_(c.start, c.end, '2027-04-09', '2027-04-18') || r.reserves.some(x => P.ptsOverlaps_(c.start, c.end, x.start, x.end))));
  check('the pencilled trip is held in August, for both', r.reserves.length === 1 && r.reserves[0].start.startsWith('2027-08') && r.reserves[0].cost.ahmed === r.reserves[0].cost.victoria, J(r.reserves));
  const bA = r.budget.ahmed, bV = r.budget.victoria;
  check('the budget is never overspent (buffer kept)', bA.left >= 0 && bV.left >= 0 && ptoOf(r.picks, 'ahmed') + bA.reserved + bA.buffer <= 30 && ptoOf(r.picks, 'victoria') + bV.reserved + bV.buffer <= 17, J({ bA, bV }));
  check('personal time is spent first: none left to expire', bA.personalUnused === 0);
  check('nothing is lost at the cap, and what rolls over leaves room for January’s accrual', bA.lost === 0 && bA.rollsOver <= 23, J(bA));
  check('Fill the 3-2-1 leads with holiday weekends, together', r.picks.filter(c => c.who === 'joint' && c.holidays.length).length >= 4);
  const v = P.ptsPlan_(input({ settings: P.ptsSettings_({ preset: 'value' }) }));
  check('picks are in date order even when they differ in value', v.picks.every((c, i) => !i || v.picks[i - 1].start <= c.start) && new Set(v.picks.map(c => c.ratio)).size > 1);
  const tight = P.ptsPlan_(input({ settings: P.ptsSettings_({ preset: 'value', overrides: { reservePencilled: false } }), people: [person('ahmed', AH, { budget: { vacation: 20, carry: 0, personal: 0, booked: 0, buffer: 2, capCarry: 23, accrual: { annual: 20, day: 16, cap: 25 } } }),
    person('victoria', FED, { budget: { vacation: 6, carry: 0, personal: 0, booked: 0, buffer: 2, capCarry: null } })] }));
  check('a tight budget: never into the buffer', ptoOf(tight.picks, 'victoria') <= 4 && ptoOf(tight.picks, 'victoria') > 0, ptoOf(tight.picks, 'victoria'));
  check('Most days off per PTO day: every pick at least 2.5 days off per PTO day before the top-up', v.picks.filter(c => c.reason !== 'use').every(c => c.ratio >= 2.5));
  const sp = P.ptsPlan_(input({ settings: P.ptsSettings_({ preset: 'spread' }) }));
  const firsts = sp.picks.filter(c => c.reason !== 'use').map(c => c.start).sort();
  check('Spread evenly: at least 8 weeks between its own picks', firsts.every((d, i) => !i || P.ptsDays_(firsts[i - 1], d) >= 49), J(firsts));
  const all = P.ptsPlan_(input({ settings: P.ptsSettings_({ preset: 'all' }) }));
  check('Every bridge: all of them, chosen by nobody', all.picks.length > 20 && all.picks.every(c => c.status === 'idea') && all.budget.ahmed.planned === 0);
  check('…each listed once (together, not three times)', !all.picks.some(c => c.who !== 'joint' && all.picks.some(x => x.who === 'joint' && x.start === c.start && x.end === c.end)));
  const joint = P.ptsPlan_(input({ settings: P.ptsSettings_({ overrides: { scope: 'joint' } }) }));
  check('Together only: no one-person picks', joint.picks.every(c => c.who === 'joint'));
  const each = P.ptsPlan_(input({ settings: P.ptsSettings_({ overrides: { scope: 'each' } }) }));
  check('Each separately: no joint picks', each.picks.every(c => c.who !== 'joint'));
  const noRes = P.ptsPlan_(input({ settings: P.ptsSettings_({ overrides: { reservePencilled: false } }) }));
  check('holding nothing for pencilled trips frees their days', noRes.reserves.length === 0 && noRes.budget.ahmed.reserved === 0);
  const blk = P.ptsPlan_(input({ settings: P.ptsSettings_({ overrides: { blackouts: { ahmed: '2027-05-01..2027-06-30' } } }) }));
  check('a blackout keeps that person’s breaks out of it', !blk.picks.some(c => (c.pto.ahmed || []).some(d => d >= '2027-05-01' && d <= '2027-06-30')));
  const keep = P.ptsPlan_(input({ settings: P.ptsSettings_({ overrides: { keep: { victoria: 4 } } }) }));
  check('“carry over at least” leaves that many', keep.budget.victoria.rollsOver >= 4, J(keep.budget.victoria));
}

console.log('\nthe accrual cap, month by month');
{
  const acc = { annual: 20, day: 16, cap: 25 };
  let k = P.ptsAccrualCheck_(acc, 20, [], 2027);
  check('20 days carried in, nothing taken: accruals are lost from March', k.lost > 0 && k.firstLoss === '2027-03-16' && k.timeline[0].after === 22, J(k.timeline.slice(0, 4)));
  check('…“take by” says how many days must be gone by each accrual day', J(k.takeBy.slice(0, 3).map(t => [t.date, t.atLeast])) === J([['2027-03-16', 1], ['2027-04-16', 3], ['2027-05-16', 5]]));
  const twoAMonth = []; for (let m = 1; m <= 10; m++) { const mm = String(m).padStart(2, '0'); twoAMonth.push('2027-' + mm + '-05', '2027-' + mm + '-06'); }
  k = P.ptsAccrualCheck_(acc, 20, twoAMonth, 2027);
  check('taking them as the year goes keeps every accrual', k.lost === 0 && k.takeBy.every(t => t.met), J(k.takeBy));
  check('a small carryover never comes near the cap', P.ptsAccrualCheck_(acc, 4, [], 2027).lost === 0 && P.ptsAccrualCheck_(acc, 4, [], 2027).takeBy.length === 0);
  const big = P.ptsPlan_(input({ people: [person('ahmed', AH, { budget: { vacation: 20, carry: 20, personal: 6, booked: 0, buffer: 2, capCarry: 23, accrual: acc } }),
    person('victoria', FED, { budget: { vacation: 15, carry: 2, personal: 0, booked: 0, buffer: 2, capCarry: null } })] }));
  const b = big.budget.ahmed;
  check('with 20 carried in, the plan takes vacation early enough that nothing is lost', b.lost === 0 && b.takeBy.every(t => t.met), J({ lost: b.lost, takeBy: b.takeBy }));
  check('…the breaks it adds for that are marked, and come before the first loss', big.picks.some(c => c.reason === 'cap') && big.picks.filter(c => c.reason === 'cap').every(c => (c.pto.ahmed || [])[0] < '2027-10-16'));
  check('…and personal time still gets used (on the latest days)', b.personalUnused === 0);
  check('Victoria has no cap: no month-by-month check', !big.budget.victoria.takeBy);
  // Personal time is put on the latest days, so vacation comes off the balance early.
  const accept = (id, days, who) => ({ [id]: { status: 'accepted', year: '2027', who: who || 'ahmed', start: days[0], end: days[days.length - 1], pto: { ahmed: days }, label: id } });
  const early = P.ptsPlan_(input({ settings: P.ptsSettings_({ preset: 'all' }), pencilled: [],
    saved: Object.assign(accept('jan', ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07']), accept('nov', ['2027-11-01', '2027-11-02', '2027-11-03', '2027-11-04'])),
    people: [person('ahmed', AH, { budget: { vacation: 20, carry: 20, personal: 6, booked: 0, buffer: 2, capCarry: 23, accrual: { annual: 20, day: 16, cap: 25 } } }), person('victoria', FED, { budget: { vacation: 15, carry: 0, personal: 0, booked: 0, buffer: 2 } })] }));
  check('personal time goes on the latest days: the January days count against the balance', early.budget.ahmed.takeBy[0].used === 2 && early.budget.ahmed.takeBy[0].met === true, J(early.budget.ahmed.takeBy[0]));
  const jan = P.ptsPlan_(input({ settings: P.ptsSettings_({ preset: 'all' }), pencilled: [],
    people: [person('ahmed', AH, { budget: { vacation: 20, carry: 4, personal: 0, booked: 0, buffer: 0, capCarry: 23, accrual: { annual: 20, day: 16, cap: 25 } } }), person('victoria', FED, { budget: { vacation: 15, carry: 0, personal: 0, booked: 0, buffer: 2 } })] }));
  check('rolling over more than leaves room for next January’s accrual counts as lost', jan.budget.ahmed.lostNextJan === 1 && jan.budget.ahmed.lost === 1, J(jan.budget.ahmed));
}

console.log('\naccepted and skipped');
{
  const base = P.ptsPlan_(input());
  const pick = base.picks.find(c => c.who === 'joint');
  const saved = { [pick.id]: { status: 'accepted', year: '2027', who: pick.who, start: pick.start, end: pick.end, pto: pick.pto, label: pick.label, away: true } };
  const r = P.ptsPlan_(input({ saved }));
  const acc = r.picks.find(c => c.id === pick.id);
  check('an accepted break stays in the plan, marked accepted', acc && acc.status === 'accepted' && acc.away === true);
  check('…and counts against the budget', r.budget.ahmed.accepted === pick.pto.ahmed.length);
  const skipId = base.picks.find(c => c.status === 'suggested' && c.id !== pick.id).id;
  const s = P.ptsPlan_(input({ saved: { [skipId]: { status: 'skipped', year: '2027' } } }));
  check('a skipped break is hidden, and listed as skipped', !s.picks.some(c => c.id === skipId) && s.skipped.some(c => c.id === skipId));
  const back = P.ptsPlan_(input({ saved: { [skipId]: { status: 'skipped', year: '2027' } }, settings: P.ptsSettings_({ overrides: { skips: 'return' } }) }));
  check('with “can come back”, a skipped break is only tried last', !back.skipped.length);
}

console.log('\nsettings');
{
  const s = P.ptsSettings_({ preset: 'value', overrides: { maxPto: 3, buffer: { ahmed: 4, victoria: '' }, blackouts: { ahmed: '2027-03-22..2027-03-31, 2027-07-01, nonsense' } } });
  check('a preset sets its values; an override wins', s.preset === 'value' && s.minRatio === 2.5 && s.maxPto === 3);
  check('…and says what changed', s.changed.indexOf('maxPto') !== -1 && s.changed.indexOf('buffer') !== -1 && s.changed.indexOf('minRatio') === -1);
  check('a blank buffer means “from Config”, not zero', s.buffer.victoria === null && s.buffer.ahmed === 4);
  check('blackouts: ranges and single days; nonsense dropped', J(s.blackouts.ahmed) === J([['2027-03-22', '2027-03-31'], ['2027-07-01', '2027-07-01']]));
  check('an unknown preset falls back to Fill the 3-2-1; bad values are ignored', P.ptsSettings_({ preset: 'x', overrides: { maxPto: 99, minRatio: 'a' } }).preset === 'fill321' && P.ptsSettings_({ overrides: { maxPto: 99 } }).maxPto === 5);
}

console.log('\nthis year, when, and reminders');
{
  const H26 = Object.assign(P.ptsFederalHolidays_(2026), { '2026-11-27': 'Day after Thanksgiving' });
  const u = P.ptsUseItBefore_([{ id: 'ahmed', name: 'Ahmed', holidays: H26, busy: [], blackouts: [], personalLeft: 2, vacationLeft: 6, capCarry: 5 },
    { id: 'victoria', name: 'Victoria', holidays: P.ptsFederalHolidays_(2026), busy: [], blackouts: [], personalLeft: 0, vacationLeft: 3, capCarry: null }], '2026-11-13');
  check('leftovers: personal plus vacation over the cap; none when it all rolls', u.people[0].total === 3 && u.people[1].total === 0, J(u.people));
  check('…with up to three breaks this year that fit them', u.picks.length > 0 && u.picks.length <= 3 && u.picks.every(c => c.start > '2026-11-13' && (c.pto.ahmed || []).length <= 3 && !c.pto.victoria));
  check('plan due on the trigger day', P.ptsPlanDue_('2026-11-25', '11-25', [{ assumed: true }]) && !P.ptsPlanDue_('2026-11-24', '11-25', [{ assumed: true }]));
  check('…or from October once everyone’s holidays are real', P.ptsPlanDue_('2026-10-20', '11-25', [{ assumed: false }, { assumed: false }]) && !P.ptsPlanDue_('2026-09-20', '11-25', [{ assumed: false }]));
  const st = P.ptsSettings_({});
  const acc = [{ id: 'joint:2027-05-28:2027-05-28', label: 'Memorial weekend', pto: { ahmed: ['2027-05-28'], victoria: ['2027-05-28'] } }, { id: 'ahmed:2027-11-22:2027-11-26', label: 'Thanksgiving week', pto: { ahmed: ['2027-11-22', '2027-11-23', '2027-11-24', '2027-11-25', '2027-11-26'] } }];
  const names = { ahmed: 'Ahmed', victoria: 'Victoria' };
  const keys = t => Object.keys(P.ptsRequestFlags_(acc, t, st, () => true, names));
  check('request-at-work: 6 weeks before', keys('2027-04-15').length === 0 && keys('2027-04-16').length === 2);
  check('…8 weeks before for 5+ days', keys('2027-09-26').length === 0 && keys('2027-09-27').some(k => /Thanksgiving|2027-11-22/.test(k)));
  check('…and not once it’s on the work calendar', Object.keys(P.ptsRequestFlags_(acc, '2027-05-01', st, (c, pid) => pid !== 'ahmed', names)).every(k => /victoria$/.test(k)));
  check('…High in the last two weeks', P.ptsRequestFlags_(acc, '2027-05-20', st, () => true, names)['PTOPLAN|REQ|joint:2027-05-28:2027-05-28|ahmed'].urgency === 'High');
}

console.log('\neach person’s own card');
{
  const saved = { a: { status: 'accepted', year: '2027', who: 'joint', label: 'Memorial weekend', start: '2027-05-28', end: '2027-05-31', pto: { ahmed: ['2027-05-28'], victoria: ['2027-05-28'] } },
    b: { status: 'accepted', year: '2027', who: 'ahmed', label: 'Thanksgiving week', start: '2027-11-20', end: '2027-11-28', pto: { ahmed: ['2027-11-22', '2027-11-23', '2027-11-24'] } },
    c: { status: 'skipped', year: '2027', who: 'victoria' } };
  const a = P.ptsPlanFor_(saved, 'ahmed', 2027, [{ startDate: '2027-05-28', endDate: '2027-05-28' }]);
  check('his breaks (shared and his own), in order, with what is on the work calendar', a.breaks.length === 2 && a.breaks[0].onCalendar === true && a.breaks[1].onCalendar === false && a.pending === 3, J(a));
  check('…and the 3-2-1 slots they fill', a.slots.longWeekend === 1 && a.slots.midSizeWeek === 1);
  check('hers: only the shared one; skips don’t count', P.ptsPlanFor_(saved, 'victoria', 2027, []).breaks.length === 1);
  check('webGetPTO_ hands each person their plan', /ahmedStats\.plan = ptsPlanFor_\(saved, 'ahmed', cfg\.year, ptoResult\.events\)/.test(WEB) && /victoriaStats\.plan = ptsPlanFor_\(saved, 'victoria'/.test(WEB));
}

console.log('\naccept, skip, remove, and the nightly step');
{
  const H = ['ID', 'Year', 'Who', 'Label', 'Off Start', 'Off End', 'PTO Days', 'Status', 'Away', 'Event ID', 'Updated'];
  const rows = [H.slice()];
  const sheet = { getLastRow: () => rows.length, appendRow: r => rows.push(r.slice()),
    getRange: (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => { const o = []; for (let k = 0; k < (nc || 1); k++) o.push(x[c - 1 + k] === undefined ? '' : x[c - 1 + k]); return o; }),
      setValues: v => v.forEach((x, i) => x.forEach((y, k) => { rows[r - 1 + i][c - 1 + k] = y; })), setValue: v => { rows[r - 1][c - 1] = v; } }) };
  const events = [], deleted = [], awayCalls = [], flags = {};
  const pick = { id: 'joint:2027-05-28:2027-05-28', who: 'joint', label: 'Memorial weekend', start: '2027-05-28', end: '2027-05-31', days: 4, pto: { ahmed: ['2027-05-28'], victoria: ['2027-05-28'] } };
  const c = ctx({ Utilities: { formatDate: () => '2027-05-28' }, Session: { getScriptTimeZone: () => 'UTC' },
    getSpreadsheet: () => ({ getSheetByName: n => n === 'PTO Plan' ? sheet : n === 'Flags' ? {} : null }), ensureSheet: () => sheet, TABS: { FLAGS: 'Flags' },
    veraLocked_: f => f(), readPTOConfig_: () => ({ veraCalendarName: 'Vera' }),
    getCalendarByName_: () => ({ createAllDayEvent: (t, a, b, o) => { events.push({ t, a, b, o }); return { getId: () => 'EV1' }; }, getEventById: id => ({ deleteEvent: () => deleted.push(id) }) }),
    awaySet_: (on, until, trip) => awayCalls.push([on, until, trip]), upsertKeyedFlags_: (s, p, src, wanted) => Object.assign(flags, wanted), isNotifEnabled_: () => true });
  c.ptsFindPick_ = () => pick;
  let r = c.webPtoPlanAccept_({ id: pick.id, year: 2027 });
  check('Accept: one all-day VERA event over the break, not the work calendar', r.ok && events.length === 1 && /Time off: Memorial weekend/.test(events[0].t) && /PTO days: 2027-05-28/.test(events[0].o.description), J(r));
  check('…and a row in the PTO Plan tab', rows.length === 2 && rows[1][0] === pick.id && rows[1][7] === 'accepted' && rows[1][9] === 'EV1');
  r = c.webPtoPlanAccept_({ id: pick.id, year: 2027 });
  check('accepting twice adds nothing', r.already && events.length === 1 && rows.length === 2);
  check('Away mode, when asked, is noted on the row', c.webPtoPlanFollow_({ id: pick.id, what: 'away' }).away === true && rows[1][8] === 'yes');
  // nightly on the break's first day: Away mode on
  c.ptsInputs_ = () => ({ people: [{ assumed: false }] });
  c.ptsPlan_ = () => ({ picks: [] });
  c.ptsUseItCard_ = () => ({ people: [] });
  c.ptsPerson_ = () => ({ booked: [] });
  c.checkPTOStrategy_();
  check('the nightly step turns Away mode on that morning, until the break ends', J(awayCalls) === J([[true, '2027-05-31', 'Memorial weekend']]));
  check('…and asks for the PTO to be requested at work, for each of you', Object.keys(flags).filter(k => /^PTOPLAN\|REQ\|/.test(k)).length === 2);
  r = c.webPtoPlanSkip_({ id: pick.id, year: 2027 });
  check('an accepted break can’t be skipped', r.ok === false);
  r = c.webPtoPlanRemove_({ id: pick.id });
  check('Remove: the VERA event goes, the row says removed', r.ok && J(deleted) === J(['EV1']) && rows[1][7] === 'removed');
  r = c.webPtoPlanSkip_({ id: 'ahmed:2027-02-12:2027-02-12', year: 2027, label: 'Presidents’ weekend' });
  check('Skip: a row marked skipped', r.ok && rows[2][7] === 'skipped');
  c.webPtoPlanSkip_({ id: 'ahmed:2027-02-12:2027-02-12', year: 2027, undo: true });
  check('Bring back', rows[2][7] === 'unskipped');
  const off = ctx({ isNotifEnabled_: () => false });
  check('the nightly step does nothing when its notification is off', J(off.checkPTOStrategy_()) === J({ skipped: 'off' }));
}

console.log('\nWeekend Planner');
{
  const w = P.ptsMergeWindows_([{ startDate: '2027-05-28', endDate: '2027-05-28', weekendEnd: '2027-05-30' }, { startDate: '2027-06-11', endDate: '2027-06-11', weekendEnd: '2027-06-13' }],
    [{ startDate: '2027-05-28', endDate: '2027-05-31', bridgeType: 'planned-break', label: 'Memorial weekend' }]);
  check('an accepted break replaces the window it overlaps', w.length === 2 && w[0].bridgeType === 'planned-break' && w[1].startDate === '2027-06-11');
  check('getWeekendWindows_ adds them', /windows = ptsMergeWindows_\(windows, ptsPlanWindows_\(today, lookAheadDays\)\)/.test(WP));
}

console.log('\nthe wiring');
{
  check('routes', /case 'pto_strategy':\s+return jsonOut_\(webPtoStrategy_\(e\.parameter\)\)/.test(WEB) && ['pto_strategy_settings', 'pto_plan_accept', 'pto_plan_skip', 'pto_plan_remove', 'pto_plan_follow'].every(a => new RegExp("case '" + a + "':\\s+return jsonOut_\\(webPto").test(WEB)));
  check('its own notification row: sent if due while away', /\{ key: 'pto_strategy',[^\n]*whileAway: 'due' \}/.test(CODE));
  check('the nightly step, right after the PTO year turns over', /nightlyStep_\(ctx, 'checkPTOYearRollover_', checkPTOYearRollover_\);\n[^\n]*\n\s*nightlyStep_\(ctx, 'checkPTOStrategy_', checkPTOStrategy_\);/.test(CODE));
  check('its flags are automatic, with what clears them', /prefix: 'PTOPLAN\|REQ\|',\s+clears: 'Clears once the PTO shows on the work calendar\.'/.test(FT) && /prefix: 'PTOPLAN\|',/.test(FT));
  check('the morning email’s Time off section', /ptoPlanSection = ptsEmailSection_\(\)/.test(CODE) && /\(ptoPlanSection \? ptoPlanSection\.html : ''\)/.test(CODE));
  check('fix: the monthly review reads threeToOneStatus', /ptoStats\.threeToOneStatus \|\| ptoStats\['3-2-1'\]/.test(MR));
  check('fix: the Config seeder writes pto_-prefixed keys', /\['pto_gap_calendars',/.test(CODE) && !/\['gap_calendars',/.test(CODE) && /\['pto_holiday_keywords',/.test(CODE));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
