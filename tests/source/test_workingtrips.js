// Working Trips (working remotely) and Business Trips (the employer sends you). Pins:
//  - the Context: "Working Trip" is remote; "Business Trip", and the older "Work Trip"
//    and "Business", are a business trip; nothing else is either;
//  - who's working: the saved choice, else the trip's Traveller, else both of you;
//    kept in the VERA State tab by Trip ID, never a TripMeta column;
//  - next year's PTO plan: a trip is busy only for the people on it, a working trip is
//    "working away" for those working, nothing a trip does costs PTO, and a pencilled
//    working trip reserves none;
//  - clear windows: a trip that's only someone else's leaves your days clear;
//  - a Business Trip's budget says Employer pays; packing and day-plan prompts get the
//    working days (weekdays, not holidays, not booked PTO) and the hours (9 to 6);
//  - the rename: menus and prompts say Business Trip; Work Trip still reads.
// Invented trips and people.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const WT = read('WorkTrips.js'), PTS = read('PTOStrategy.js'), PTO = read('PTO.js'), WEB = read('WebApp.js'), CHAT = read('Chat.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const fnSrc = (src, name) => { const a = src.indexOf('function ' + name + '('); if (a === -1) return ''; let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); };

// A world: TripMeta rows [Trip Key, Context, Notes, Updated, Traveler, …, Trip ID last], the VERA State store.
function world(meta, store) {
  const HEAD = ['Trip Key', 'Context', 'Notes', 'Updated Date', 'Traveler', 'Trip Budget', 'Trip Travellers', 'Outbound Mode', 'Return Mode', 'Luggage JSON', 'Characteristics', 'Trip ID'];
  const rows = (meta || []).map(m => { const r = HEAD.map(() => ''); r[0] = m.key; r[1] = m.context || ''; r[4] = m.traveler || ''; r[11] = m.id || ''; return r; });
  const st = Object.assign({}, store || {}), saves = [];
  const c = { String, Array, Object, JSON, Math, Number, RegExp, Date, isFinite, Logger: { log: () => {} },
    TRIP_META_HEADERS: HEAD, TABS: { TRIP_META: 'TripMeta' },
    getSpreadsheet: () => ({ getSheetByName: () => ({ getLastRow: () => rows.length + 1, getRange: (r, col, n, w) => ({ getValues: () => rows.slice(r - 2, r - 2 + n).map(x => x.slice(col - 1, col - 1 + w)) }) }) }),
    tripKeyRowIndex_: (keys, k, ids) => { const id = (k.match(/TRIP-\w+/) || [])[0]; let i = ids.findIndex(x => id && x === id); if (i === -1) i = keys.indexOf(k); return i; },
    tripIdOf_: k => ((meta || []).find(m => m.key === k) || {}).id || '',
    veraStoreGet_: k => (k in st ? st[k] : null), veraStoreSet_: (k, v) => { st[k] = v; saves.push(k); return true; },
    veraLocked_: f => f(), _veraStoreCache_: null,
    getConfigValues: () => ({ work_hours_victoria: '8:30-17:00' }),
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: () => '2027-01-10' },
    _st: st, _saves: saves };
  vm.createContext(c);
  vm.runInContext(WT, c);
  return c;
}

console.log('\nwhich trips, and who');
{
  const c = world();
  check('Working Trip is remote; Business Trip, Work Trip and Business are business; others are neither',
        c.tripWorkKind_('Working Trip') === 'remote' && c.tripWorkKind_(' business trip ') === 'business' && c.tripWorkKind_('Work Trip') === 'business'
        && c.tripWorkKind_('Business') === 'business' && c.tripWorkKind_('Family Trip') === '' && c.tripWorkKind_('Workshop weekend') === '' && c.tripWorkKind_('') === '');
  check('travellers: the Traveller, else both of you', J(c.wtTravellers_('Victoria')) === J(['Victoria']) && J(c.wtTravellers_('Both')) === J(['Ahmed', 'Victoria']) && J(c.wtTravellers_('')) === J(['Ahmed', 'Victoria']));
  check('workers: the saved choice wins', J(c.tripWorkers_('Working Trip', 'Both', 'Victoria')) === J(['Victoria']));
  check('…else the Traveller', J(c.tripWorkers_('Business Trip', 'Ahmed', '')) === J(['Ahmed']));
  check('…and nobody on a trip that isn’t a working kind, whatever was saved', c.tripWorkers_('Family Trip', 'Both', 'Ahmed').length === 0);
  check('hours: "8:30-17:00" read; anything unreadable is 9 to 6', J(c.wtParseHours_('8:30-17:00')) === J({ start: 8.5, end: 17 }) && J(c.wtParseHours_('9–18')) === J({ start: 9, end: 18 })
        && J(c.wtParseHours_('')) === J({ start: 9, end: 18 }) && J(c.wtParseHours_('17-9')) === J({ start: 9, end: 18 }));
  const days = c.wtWorkingDays_('2027-03-05', '2027-03-16', { '2027-03-15': 'Invented Day' }, [['2027-03-11', '2027-03-12']]);
  check('working days: weekdays, not holidays, not booked PTO', J(days) === J(['2027-03-05', '2027-03-08', '2027-03-09', '2027-03-10', '2027-03-16']), J(days));
}

console.log('\nsaving who’s working');
{
  const c = world([{ key: '2027-03-08|Denver', context: 'Working Trip', traveler: 'Both', id: 'TRIP-AAAA00000001' }]);
  const r = c.webSetTripWorking_({ tripKey: '2027-03-08|Denver', working: 'Victoria' });
  check('saved by Trip ID in the VERA State tab', r.ok && JSON.parse(c._st.TRIP_WORKING)['TRIP-AAAA00000001'] === 'Victoria', J(c._st));
  check('…and read back through the trip', J(c.tripPeopleIndex_()('2027-03-08|Denver')) === J({ kind: 'remote', travellers: ['Ahmed', 'Victoria'], workers: ['Victoria'] }));
  c.webSetTripWorking_({ tripKey: '2027-03-08|Denver', working: '' });
  check('clearing it goes back to the Traveller', !('TRIP-AAAA00000001' in JSON.parse(c._st.TRIP_WORKING)) && J(c.tripPeopleIndex_()('2027-03-08|Denver').workers) === J(['Ahmed', 'Victoria']));
  check('anything but Ahmed, Victoria or Both is refused', c.webSetTripWorking_({ tripKey: '2027-03-08|Denver', working: 'Sam' }).ok === false && c.webSetTripWorking_({ working: 'Both' }).ok === false);
  check('a trip with no details: everyone travels, nobody works', J(c.tripPeopleIndex_()('2027-05-01|Nowhere')) === J({ kind: '', travellers: ['Ahmed', 'Victoria'], workers: [] }));
  check('TripMeta gets no new column (the Trip ID stays last)', !/'Working'/.test(read('Code.js').match(/const TRIP_META_HEADERS\s*=[^\n]*/)[0]));
}

console.log('\nnext year’s PTO plan');
{
  const P = (() => { const c = { console, Logger: { log: () => {} } }; vm.createContext(c); vm.runInContext(PTS, c); return c; })();
  const FED = P.ptsFederalHolidays_(2027);
  const person = (id, extra) => Object.assign({ id, name: id === 'ahmed' ? 'Ahmed' : 'Victoria', holidays: FED, assumed: false, busy: [], blackouts: [],
    budget: { vacation: 20, carry: 0, personal: 0, booked: 0, buffer: 0, capCarry: null } }, extra || {});
  const input = (locked, pencilled) => ({ year: 2027, today: '2026-11-26', settings: P.ptsSettings_({ preset: 'all' }), people: [person('ahmed'), person('victoria')],
    locked: locked, pencilled: pencilled || [], saved: {} });
  // Victoria works from Denver Mon Mar 8 to Fri Mar 12; Presidents' Day isn't in it.
  const work = [{ label: 'Denver', start: '2027-03-06', end: '2027-03-14', who: ['victoria'], work: ['victoria'], kind: 'remote' }];
  const r = P.ptsPlan_(input(work));
  const all = r.picks.concat(r.more || []);
  const hits = (id) => all.filter(c => (c.who === id || c.who === 'joint') && P.ptsOverlaps_(c.start, c.end, '2027-03-06', '2027-03-14'));
  check('Victoria’s working trip blocks her breaks and joint ones that week', hits('victoria').length === 0, J(hits('victoria').map(c => c.who + ' ' + c.start)));
  const old = P.ptsPlan_(input([{ label: 'Denver', start: '2027-03-06', end: '2027-03-14' }]));
  check('…but no longer Ahmed’s own (a trip with no traveller list still blocks everyone)', P.ptsPlan_(input(work)).people.find(p => p.id === 'ahmed').busy.length === 0
        && old.people.find(p => p.id === 'ahmed').busy.length === 1, J(P.ptsPlan_(input(work)).people.map(p => p.id + ':' + J(p.busy))));
  check('a trip costs no PTO: the budgets are the same with or without it', J(r.budget.victoria.booked) === J(P.ptsPlan_(input([])).budget.victoria.booked) && r.budget.victoria.reserved === 0);
  const pen = [{ label: 'Lisbon working trip', start: '2027-09-06', end: '2027-09-17', months: ['2027-09'], days: 12, who: ['victoria'], working: true }];
  const withPen = P.ptsPlan_(Object.assign(input([], pen), { settings: P.ptsSettings_({}) }));
  check('a pencilled working trip reserves no PTO', withPen.budget.victoria.reserved === 0 && (withPen.reserves || []).length === 0, J(withPen.reserves));
  check('a Trip Idea is working when its title or must-haves say so', P.ptsIdeaIsWorking_({ title: 'Lisbon working trip' }) && P.ptsIdeaIsWorking_({ title: 'Chicago', mustHaves: ['business trip hotel'] })
        && !P.ptsIdeaIsWorking_({ title: 'Lisbon', mustHaves: ['workout room'] }));
  check('the trip’s travellers and workers come from its details', /var pp = peopleOf\(t\.startDate \+ '\|' \+ t\.label\);/.test(PTS) && /who: pp\.travellers\.length \? ids\(pp\.travellers\) : null, work: ids\(pp\.workers\)/.test(PTS));
}

console.log('\nthe year grid');
{
  const g = { }; vm.createContext(g);
  const marks = fnSrc(APP, 'psMarks_'), add = fnSrc(APP, 'psAdd_') + '\n' + fnSrc(APP, 'psD_') + '\n' + fnSrc(APP, 'psIso_'), days = fnSrc(APP, 'psDays_'), shows = fnSrc(APP, 'psShows_');
  vm.runInContext([add, days, shows, marks, (APP.match(/var PS_RANK=\{[^}]*\};/) || [''])[0]].join('\n'), g);
  const plan = { people: [{ id: 'ahmed', holidays: {} }, { id: 'victoria', holidays: {} }], locked: [{ start: '2027-03-08', end: '2027-03-09', who: ['victoria'], work: ['victoria'] }, { start: '2027-04-05', end: '2027-04-05', who: null, work: [] }], reserves: [], picks: [] };
  const all = g.psMarks_(plan, 'all'), vic = g.psMarks_(plan, 'victoria'), ah = g.psMarks_(plan, 'ahmed');
  check('a working trip is "working away" for the person working', all['2027-03-08'] === 'w' && vic['2027-03-08'] === 'w');
  check('…and isn’t drawn on someone it doesn’t block', !ah['2027-03-08'] && ah['2027-04-05'] === 'l');
  check('the striped fill and its legend, the same in lite', /w:\{bg:'repeating-linear-gradient\(135deg,#334155 0 3px,#1f2937 3px 6px\)',edge:'#94a3b8',fg:'#cbd5e1',t:'working away \(no PTO\)'\}/.test(APP)
        && /\['h','ha','l','w','p','k','a','b'\]\.map/.test(APP) && fnSrc(LITE, 'psMarks_') === marks);
}

console.log('\nclear windows');
{
  const c = world([{ key: '2027-03-06|Denver', context: 'Working Trip', traveler: 'Victoria' }, { key: '2027-04-03|Lake', context: 'Family Trip', traveler: 'Both' }]);
  vm.runInContext(fnSrc(PTO, 'ptoSkipOthersTrip_'), c);
  c.Utilities = { formatDate: d => d.toISOString().slice(0, 10) };
  const ev = (start, title, allDay) => ({ isAllDayEvent: () => allDay !== false, getAllDayStartDate: () => new Date(start + 'T00:00:00Z'), getTitle: () => title });
  const skip = c.ptoSkipOthersTrip_('Ahmed');
  check('a trip that’s only Victoria’s leaves Ahmed’s days clear', skip(ev('2027-03-06', 'Denver')) === true);
  check('…a trip he’s on, or one with no details, still blocks them', skip(ev('2027-04-03', 'Lake')) === false && skip(ev('2027-05-01', 'Unknown')) === false && skip(ev('2027-03-06', 'Denver', false)) === false);
  check('the snapshot passes it to the clear-window scan, which skips what it says', /findClearWindows_\(gapCals, today, PTO_GAP_SCAN_DAYS_, 3, gapScan, ptoSkipOthersTrip_\('Ahmed'\)\)/.test(PTO) && /if \(skipEvent\) \{ try \{ if \(skipEvent\(ev\)\) continue; \} catch \(skipErr\) \{\} \}/.test(PTO));
}

console.log('\nbudget, packing and day plans');
{
  check('a Business Trip’s budget says Employer pays, with what to claim back', /var employerPays = tripWorkKind_\(meta\.context\) === 'business';/.test(WEB) && /toClaim:\s+employerPays \? totalActual : 0,/.test(WEB)
        && /className:"tb-employer"/.test(APP) && /"Employer pays\."/.test(APP));
  const c = world([{ key: '2027-03-08|Denver', context: 'Working Trip', traveler: 'Victoria', id: 'TRIP-AAAA00000001' }, { key: '2027-06-01|Chicago', context: 'Business Trip', traveler: 'Ahmed' }]);
  c.PTS_PEOPLE_ = [{ id: 'ahmed', name: 'Ahmed' }, { id: 'victoria', name: 'Victoria' }];
  c.ptsPerson_ = () => ({ holidays: { '2027-03-10': 'Invented Day' }, booked: [['2027-03-12', '2027-03-12']] });
  const remote = c.wtPromptLines_('2027-03-08|Denver', '2027-03-08', '2027-03-14');
  check('a remote trip: a laptop on top of the usual list', /WORKING TRIP \(working remotely\) for Victoria: add a laptop, charger/.test(remote));
  check('…her working days (not the holiday, not her PTO day) and her hours', /Victoria works 8:30 am–5 pm on 2027-03-08, 2027-03-09, 2027-03-11\. On those days suggest only things before 8:30 am, at lunch, or after 5 pm/.test(remote), remote);
  const biz = c.wtPromptLines_('2027-06-01|Chicago', '2027-06-01', '2027-06-02');
  check('a business trip: work clothes and a laptop; hours default to 9 to 6', /BUSINESS TRIP for Ahmed: pack work clothes, a laptop and charger/.test(biz) && /Ahmed works 9 am–6 pm on/.test(biz), biz);
  check('a family trip adds nothing', c.wtPromptLines_('2027-05-01|Lake', '2027-05-01', '2027-05-03') === '');
  check('the packing and day-plan prompts both get it', /workLines = wtPromptLines_\(tripKey, startDate, endDate\);/.test(WEB) && /recsWork = wtPromptLines_\(tripKey, startDate, endDate\);/.test(WEB)
        && (WEB.match(/=== WORKING ON THIS TRIP ===/g) || []).length === 2);
}

console.log('\nthe rename');
{
  check('the Context menu offers Business Trip and Working Trip, not Work Trip', /const CONTEXT_PRESETS=\[[^\]]*'Business Trip','Working Trip'[^\]]*\]/.test(APP) && !/const CONTEXT_PRESETS=\[[^\]]*'Work Trip'/.test(APP));
  check('…an old "Work Trip" still gets its colour, in both dashboards', /'Business Trip':'#94a3b8','Work Trip':'#94a3b8','Working Trip':'#5eead4'/.test(APP) && /'Business Trip':'#94a3b8','Work Trip':'#94a3b8','Working Trip':'#5eead4'/.test(LITE));
  check('chat and the prompts say Business Trip and Working Trip', /Business Trip \(your employer sends you\), Working Trip \(working remotely from out of town\)/.test(CHAT) && !/Work Trip/.test(CHAT)
        && !/Work Trip →|Work Trip \\u2192/.test(WEB) && /Business Trip or Working Trip → quick sights/.test(WEB));
  check('the trip card asks who’s working, and saves it', /function TripWorkingBlock\(/.test(APP) && /action:'set_trip_working',tripKey:tripKey,working:w/.test(APP) && /case 'set_trip_working':\s+return jsonOut_\(webSetTripWorking_\(e\.parameter\)\);/.test(WEB));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
