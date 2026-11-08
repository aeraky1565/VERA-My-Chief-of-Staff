// Before you leave home (LeavingHome.js, issue #231): which groups apply (season, nights, empty
// house), the list per trip and per "Heading out", the default leave time (2 h before the first
// flight), shared ticks with who and when, one-offs, the starter template, the morning message
// (at the time set, once, only if items are left), the night-before email section, and wiring.
// Invented homes, people and trips.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'LeavingHome.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const FS = fs.readFileSync(path.join(ROOT, 'FlightStatus.js'), 'utf8');
const PTB = fs.readFileSync(path.join(ROOT, 'PreTripBriefing.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const arr = name => eval((CODE.match(new RegExp('const ' + name + '\\s*=\\s*(\\[[^\\]]*\\])')) || [])[1]);
const LEAVE_HOME_HEADERS = arr('LEAVE_HOME_HEADERS'), LEAVE_RUN_HEADERS = arr('LEAVE_RUN_HEADERS'), ITINERARY_HEADERS = arr('ITINERARY_HEADERS');

function fakeSheet(rows) {
  const data = rows.map(r => r.slice());
  return {
    data,
    getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + (nr || 1)).map(x => { const o = []; for (let i = 0; i < (nc || 1); i++) o.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return o; }),
      setValue: v => { while (data.length < r) data.push([]); data[r - 1][c - 1] = v; },
      setValues: vs => vs.forEach((row, i) => { while (data.length < r + i) data.push([]); row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; }); }),
    }),
    appendRow: row => data.push(row.slice()),
    deleteRow: r => data.splice(r - 1, 1),
  };
}

function ctx(o) {
  o = o || {};
  const sheets = {
    'Leaving Home': fakeSheet([LEAVE_HOME_HEADERS].concat(o.template || [])),
    'Leaving Home Runs': fakeSheet([LEAVE_RUN_HEADERS].concat(o.runs || [])),
    Itinerary: fakeSheet([ITINERARY_HEADERS].concat(o.itinerary || [])),
  };
  const sent = [];
  const c = { String, Number, Object, Array, Date, JSON, Math, RegExp, isNaN, isFinite, Error,
    TABS: { LEAVE_HOME: 'Leaving Home', LEAVE_RUNS: 'Leaving Home Runs', ITINERARY: 'Itinerary' },
    LEAVE_HOME_HEADERS, LEAVE_RUN_HEADERS, ITINERARY_HEADERS, TE_OWNER_: 'Ahmed', TE_PARTNER_: 'Victoria',
    Session: { getScriptTimeZone: () => 'UTC' }, Logger: { log: () => {} },
    Utilities: { formatDate: (d, tz, f) => { const n = o.now || '2027-07-09T21:00'; return f === 'yyyy-MM-dd HH:mm' ? n.replace('T', ' ') : n; } },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    getSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }),
    ensureSheet: (ss, n) => sheets[n],
    teTravellersForKey_: () => o.travellers || [],
    readTripRegistry_: () => ({ rows: o.trips || [] }),
    sendNudge_: (k, s, t, n) => sent.push({ k, s, t, n }),
  };
  vm.createContext(c); vm.runInContext(SRC, c);
  c.__sheets = sheets; c.__sent = sent;
  return c;
}

console.log('\nwhich groups apply');
{
  const c = ctx();
  const a = (g, x) => c.lhApplies_(g, x);
  check('always, always', a('always', { month: 1, nights: 0 }));
  check('summer is May to September', a('summer', { month: 5 }) && a('summer', { month: 9 }) && !a('summer', { month: 4 }) && !a('summer', { month: 10 }));
  check('winter is November to March', a('winter', { month: 11 }) && a('winter', { month: 1 }) && a('winter', { month: 3 }) && !a('winter', { month: 4 }) && !a('winter', { month: 10 }));
  check('3+ and 7+ nights', a('nights3', { nights: 3 }) && !a('nights3', { nights: 2 }) && a('nights7', { nights: 7 }) && !a('nights7', { nights: 6 }));
  check('only if nobody stays home', a('empty', { empty: true }) && !a('empty', { empty: false }));
  check('the house is empty only when everyone is leaving', c.lhEmpty_(['Ahmed', 'Victoria'], ['ahmed', 'Victoria']) && !c.lhEmpty_(['Ahmed', 'Victoria'], ['Ahmed']));
}

console.log('\ntimes');
{
  const c = ctx();
  check('2 hours before the first flight', c.lhDefaultLeave_({ date: '2027-07-10', time: '09:40' }, '2027-07-10') === '2027-07-10T07:40');
  check('an early flight moves to the night before', c.lhDefaultLeave_({ date: '2027-07-10', time: '01:15' }, '2027-07-10') === '2027-07-09T23:15');
  check('no flight: 8 AM on the first day', c.lhDefaultLeave_(null, '2027-07-10') === '2027-07-10T08:00');
  check('a typed time is cleaned; nonsense is empty', c.lhAt_('2027-07-10 7:05') === '2027-07-10T07:05' && c.lhAt_('2027-07-10T25:00') === '' && c.lhAt_('soon') === '');
  check('"Sat 7:40 AM"', c.lhWhen_('2027-07-10T07:40') === 'Sat 7:40 AM' && c.lhWhen_('2027-07-10T18:00') === 'Sat 6:00 PM');
}

const T = [
  ['LH-1', 'Our home', 'always', 'Take out the trash', 1, '', ''],
  ['LH-2', 'Our home', 'always', 'Check every door is locked', 2, '', ''],
  ['LH-3', 'Our home', 'summer', 'AC to 82°F (not off)', 3, '', ''],
  ['LH-4', 'Our home', 'winter', 'Heat to 58°F', 4, '', ''],
  ['LH-5', 'Our home', 'nights3', 'Empty the fridge', 5, '', ''],
  ['LH-6', 'Our home', 'nights7', 'Hold the mail', 6, '', ''],
  ['LH-7', 'Our home', 'empty', 'Set the alarm', 7, '', ''],
  ['LH-8', 'Beach flat', 'always', 'Shut the shutters', 1, '', ''],
];

console.log('\nthe list');
{
  const c = ctx();
  const tpl = c.lhTemplateRows_(T);
  const L = run => c.lhList_(tpl, Object.assign({ home: 'Our home', leaveAt: '2027-07-10T07:40', nights: 8, leaving: ['Ahmed', 'Victoria'], ticks: {}, oneOffs: [] }, run), ['Ahmed', 'Victoria']);
  const july = L({});
  check('July, 8 nights, nobody home: always, summer, 3+, 7+, empty', J(july.items.map(i => i.key)) === J(['LH-1', 'LH-2', 'LH-3', 'LH-5', 'LH-6', 'LH-7']), J(july.items.map(i => i.key)));
  const jan = L({ leaveAt: '2027-01-10T07:40', nights: 2, leaving: ['Ahmed'] });
  check('January, 2 nights, Victoria stays: always and winter only', J(jan.items.map(i => i.key)) === J(['LH-1', 'LH-2', 'LH-4']));
  check('another home has its own list', J(L({ home: 'beach flat' }).items.map(i => i.key)) === J(['LH-8']));
  const ticked = L({ ticks: { 'LH-1': { by: 'Victoria', at: '2027-07-09 21:12' } }, oneOffs: [{ id: 'a', text: 'Leave a key with Sam', by: 'Ahmed' }] });
  check('N of M, with who ticked and when', ticked.done === 1 && ticked.total === 7 && ticked.left === 6 && ticked.items[0].by === 'Victoria' && ticked.items[0].at === '2027-07-09 21:12');
  check('a one-off is on this list only, last', ticked.items[6].key === 'o:a' && ticked.items[6].oneOff && ticked.items[6].groupLabel === 'This trip only' && L({}).items.length === 6);
  const why = c.lhWhy_({ home: 'Our home', leaveAt: '2027-07-10T07:40' }, july.ctx);
  check('why it’s this list', why === 'Our home · July, so the summer items · 8 nights, so the 3+ and 7+ items · nobody stays home. Leaving Sat 7:40 AM.', why);
  check('why, when someone stays', /someone stays home, so the empty-house items are left out/.test(c.lhWhy_({ home: 'Our home', leaveAt: '2027-01-10T07:40' }, jan.ctx)));
  const msg = c.lhMessage_(L({ ticks: { 'LH-1': { by: 'x' } } }));
  check('the morning message lists what’s left', msg === '🏠 Before you head out: 5 things left (check every door is locked, aC to 82°F (not off), empty the fridge, hold the mail, and 1 more). Tick them in VERA.' || /5 things left \(check every door is locked, .*and 1 more\)\. Tick them in VERA\.$/.test(msg), msg);
}

console.log('\nthe morning message: when');
{
  const c = ctx();
  const runs = [{ id: 'a', leaveAt: '2027-07-10T07:40', sent: '' }, { id: 'b', leaveAt: '2027-07-10T07:40', sent: '2027-07-10 07:45' }, { id: 'c', leaveAt: '2027-07-10T12:00', sent: '' }, { id: 'd', leaveAt: '2027-07-10T03:00', sent: '' }];
  check('due at the time set, once, within 3 hours', J(c.lhDue_(runs, '2027-07-10T07:45').map(r => r.id)) === J(['a']));
  check('not before the time', c.lhDue_(runs, '2027-07-10T07:39').every(r => r.id !== 'a'));
  check('not long after', c.lhDue_([runs[3]], '2027-07-10T07:45').length === 0);
}

console.log('\nroutes');
{
  const c = ctx({ now: '2027-07-09T21:00', travellers: ['Ahmed', 'Victoria'],
    itinerary: [['I1', '2027-07-10|Lisbon', 'flight', 'TP 204', '2027-07-10', '9:40 AM', '', '', '', ''], ['I2', '2027-07-10|Lisbon', 'flight', 'TP 205', '2027-07-18', '10:00', '', '', '', '']] });
  const g = c.webLhGet_();
  check('first use seeds a starter list for "Our home"', g.ok && g.homes[0] === 'Our home' && g.template.length === 18 && c.__sheets['Leaving Home'].data.length === 19);
  check('the six groups', J(g.groups.map(x => x.id)) === J(['always', 'summer', 'winter', 'nights3', 'nights7', 'empty']));
  const g2 = c.webLhGet_();
  check('seeded once', g2.template.length === 18);
  const key = '2027-07-10|Lisbon', q = { tripKey: key, startDate: '2027-07-10', endDate: '2027-07-18' };
  const v = c.webLhTrip_(q);
  check('a trip: 2 h before the first flight, 8 nights, both leaving', v.ok && v.run.leaveAt === '2027-07-10T07:40' && v.run.defaultLeave && v.run.nights === 8 && v.run.empty && v.run.id === '', J(v.run));
  check('nothing is written until something changes', c.__sheets['Leaving Home Runs'].data.length === 1);
  check('July and 8 nights: 6 always + 2 summer + 2 + 3 + 3 = 16', v.total === 16 && v.done === 0, v.total);
  const t1 = c.webLhTick_(Object.assign({ key: v.items[0].key, done: true, by: 'Victoria' }, q));
  check('a tick records who and when, and writes the trip’s row', t1.done === 1 && t1.items[0].by === 'Victoria' && t1.items[0].at === '2027-07-09 21:00' && t1.run.id && c.__sheets['Leaving Home Runs'].data.length === 2);
  const t2 = c.webLhTick_(Object.assign({ key: v.items[1].key, done: true, by: 'Ahmed' }, q));
  check('ticks are shared: the other dashboard sees both', t2.done === 2 && c.webLhTrip_(q).done === 2 && c.__sheets['Leaving Home Runs'].data.length === 2);
  const t3 = c.webLhTick_(Object.assign({ key: v.items[1].key, done: false, by: 'Ahmed' }, q));
  check('untick', t3.done === 1);
  const o1 = c.webLhOneOff_(Object.assign({ text: 'Leave a key with Sam', by: 'Ahmed' }, q));
  check('a one-off for this trip', o1.total === 17 && o1.items[16].text === 'Leave a key with Sam');
  const o2 = c.webLhOneOff_(Object.assign({ remove: o1.items[16].key }, q));
  check('and remove it', o2.total === 16);
  const s1 = c.webLhRunSet_(Object.assign({ leaveAt: '2027-07-10T06:30', leaving: ['Ahmed'] }, q));
  check('change the leave time and who’s leaving: the empty-house items drop out', s1.run.leaveAt === '2027-07-10T06:30' && !s1.run.empty && s1.total === 13 && !s1.run.defaultLeave, s1.total);
  c.__sheets['Leaving Home Runs'].data[1][9] = '2027-07-10 06:31';
  c.webLhRunSet_(Object.assign({ leaveAt: '2027-07-10T07:00' }, q));
  check('a new leave time sends the reminder again', c.__sheets['Leaving Home Runs'].data[1][9] === '');
  c.__sheets['Leaving Home Runs'].data[1][9] = 'sent';
  c.webLhRunSet_(Object.assign({ leaving: ['Ahmed'] }, q));
  check('…but other changes don’t', c.__sheets['Leaving Home Runs'].data[1][9] === 'sent');
  check('a bad time is refused', c.webLhRunSet_(Object.assign({ leaveAt: 'later' }, q)).ok === false && c.webLhRunSet_(Object.assign({ leaving: [] }, q)).ok === false);
  const add = c.webLhItemSave_({ home: 'Our home', group: 'always', item: 'Feed the fish', by: 'Victoria' });
  check('either of you can add to the template', add.ok && add.template.some(t => t.item === 'Feed the fish' && t.by === 'Victoria'));
  const fish = add.template.filter(t => t.item === 'Feed the fish')[0];
  const ed = c.webLhItemSave_({ id: fish.id, home: 'Our home', group: 'nights3', item: 'Ask Sam to feed the fish', by: 'Ahmed' });
  check('edit an item in place', ed.template.filter(t => t.id === fish.id)[0].item === 'Ask Sam to feed the fish' && ed.template.length === 19);
  check('an item needs words and a group', c.webLhItemSave_({ group: 'always' }).ok === false && c.webLhItemSave_({ item: 'x', group: 'monday' }).ok === false);
  const nh = c.webLhItemSave_({ home: 'Beach flat', group: 'always', item: 'Shut the shutters' });
  check('a new home starts with its first item', J(nh.homes) === J(['Our home', 'Beach flat']));
  check('delete an item', c.webLhItemDelete_({ id: fish.id }).template.length === 19);
  const aw = c.webLhAway_({ leaveAt: '2027-07-16T18:00', nights: 2, home: 'Our home', leaving: ['Ahmed'], by: 'Ahmed' });
  check('Heading out: time away that isn’t a trip', aw.ok && aw.run.kind === 'away' && aw.run.nights === 2 && !aw.run.empty && aw.total === 8, aw.total);
  check('Heading out needs a time and who', c.webLhAway_({ leaving: ['Ahmed'] }).ok === false && c.webLhAway_({ leaveAt: '2027-07-16T18:00', leaving: [] }).ok === false);
  check('the away list shows on Leaving home', c.webLhGet_().away.length === 1);
  const at = c.webLhTick_({ run: aw.run.id, key: aw.items[0].key, done: true, by: 'Ahmed' });
  check('tick an away list by its id', at.done === 1 && at.run.id === aw.run.id);
  c.webLhAwayDelete_({ id: aw.run.id });
  check('remove a Heading out list', c.webLhGet_().away.length === 0);
  check('tripKey required', c.webLhTrip_({}).ok === false);
}

console.log('\nthe morning message: sending');
{
  const tpl = T.slice(0, 7);
  const trips = [{ startDate: '2027-07-10', endDate: '2027-07-18', label: 'Lisbon', status: 'active' }];
  const it = [['I1', '2027-07-10|Lisbon', 'flight', 'TP 204', '2027-07-10', '09:40', '', '', '', '']];
  const c1 = ctx({ now: '2027-07-10T07:30', template: tpl, trips, itinerary: it, travellers: ['Ahmed', 'Victoria'] });
  check('before the time: nothing', c1.lhMorningCheck_() === 0 && c1.__sent.length === 0);
  const c2 = ctx({ now: '2027-07-10T07:45', template: tpl, trips, itinerary: it, travellers: ['Ahmed', 'Victoria'] });
  c2.lhMorningCheck_();
  check('at the time: one message, on the Leaving Home channel', c2.__sent.length === 1 && c2.__sent[0].n === 'leave_home' && /Before you head out: 6 things left/.test(c2.__sent[0].t), J(c2.__sent));
  c2.lhMorningCheck_();
  check('once: the next check sends nothing', c2.__sent.length === 1 && c2.__sheets['Leaving Home Runs'].data.length === 2);
  const allDone = {}; ['LH-1', 'LH-2', 'LH-3', 'LH-5', 'LH-6', 'LH-7'].forEach(k => { allDone[k] = { by: 'Ahmed', at: 'x' }; });
  const c3 = ctx({ now: '2027-07-10T07:45', template: tpl, trips, itinerary: it,
    runs: [['TRIP-1', 'trip', '2027-07-10|Lisbon', 'Our home', '2027-07-10T07:40', 8, 'Ahmed, Victoria', J(allDone), '[]', '', '']] });
  c3.lhMorningCheck_();
  check('everything ticked: no message', c3.__sent.length === 0 && c3.__sheets['Leaving Home Runs'].data[1][9] !== '');
  const c4 = ctx({ now: '2027-07-16T18:10', template: tpl,
    runs: [['AWAY-1', 'away', '', 'Our home', '2027-07-16T18:00', 2, 'Ahmed', '{}', '[]', '', '']] });
  c4.lhMorningCheck_();
  check('a Heading out list gets its message too', c4.__sent.length === 1 && /3 things left/.test(c4.__sent[0].t), J(c4.__sent));
  const c5 = ctx({ now: '2027-07-10T07:45', template: tpl, trips: [] });
  check('no trip today or tomorrow and no away list: it reads nothing more', c5.lhMorningCheck_() === 0);
}

console.log('\nthe night-before email');
{
  const c = ctx({ now: '2027-07-09T21:00', template: T.slice(0, 7), travellers: ['Ahmed', 'Victoria'],
    runs: [['TRIP-1', 'trip', '2027-07-10|Lisbon', 'Our home', '2027-07-10T07:40', 8, 'Ahmed, Victoria', J({ 'LH-1': { by: 'Victoria', at: 'x' } }), '[]', '', '']] });
  const s = c.lhEmailSection_('2027-07-10|Lisbon', '2027-07-10', '2027-07-18');
  check('a section: N of M left, the items, and when the reminder goes', s && /Before you leave home · 5 of 6 left/.test(s.html) && /Check every door is locked/.test(s.html) && /Sat 7:40 AM/.test(s.html) && !/Take out the trash/.test(s.html), s && s.html);
  check('and in the plain text', /BEFORE YOU LEAVE HOME · 5 OF 6 LEFT/.test(s.text) && /• Set the alarm/.test(s.text));
  const all = {}; ['LH-1', 'LH-2', 'LH-3', 'LH-5', 'LH-6', 'LH-7'].forEach(k => { all[k] = { by: 'x' }; });
  const c2 = ctx({ template: T.slice(0, 7), runs: [['TRIP-1', 'trip', '2027-07-10|Lisbon', 'Our home', '2027-07-10T07:40', 8, 'Ahmed, Victoria', J(all), '[]', '', '']] });
  check('nothing left: no section', c2.lhEmailSection_('2027-07-10|Lisbon', '2027-07-10', '2027-07-18') === null);
  check('the night-before email carries it, in HTML and plain text', /\{ id: 'leave_home', data: leaveHome \? leaveHome\.html : '' \}/.test(PTB) && /if \(leaveHome\) plain\.push\(leaveHome\.text, ''\)/.test(PTB));
}

console.log('\nwiring');
{
  check('the two tabs are declared', /LEAVE_HOME:\s*'Leaving Home'/.test(CODE) && /LEAVE_RUNS:\s*'Leaving Home Runs'/.test(CODE));
  check('the Leaving Home notification', /key: 'leave_home',\s+label: 'Leaving Home'/.test(CODE));
  check('the 15-minute flight check runs the morning check first', /lhMorningCheck_\(\)/.test(FS.slice(FS.indexOf('function checkFlightStatuses_'), FS.indexOf('function checkFlightStatuses_') + 900)));
  ['lh_get', 'lh_trip'].forEach(a => check('GET ' + a + ' is routed', new RegExp("case '" + a + "':").test(WEB)));
  ['lh_item_save', 'lh_item_delete', 'lh_tick', 'lh_oneoff', 'lh_run_set', 'lh_away', 'lh_away_delete'].forEach(a => check('POST ' + a + ' is routed', new RegExp("case '" + a + "':\\s*return jsonOut_\\(webLh\\w+_\\(body\\)\\)").test(WEB)));
  check('no calendar writes, no sheet IDs', !/CalendarApp|createEvent|openById/.test(SRC));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
