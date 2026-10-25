// Trip Ideas, stage 1 (TripIdeas.js and the shared TripIdeasView block): trips
// with no dates yet. The backend's cleaners and endpoints run in a vm over a fake
// sheet; the dashboard's pure builders run straight from the block; the two copies
// of the block must match. Every trip, place and figure here is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'TripIdeas.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// ============ the backend, over a fake sheet =======================================
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
  console, JSON, Math, Number, String, Array, Date, isFinite,
  TABS: { TRIP_IDEAS: 'Trip Ideas', TRIP_IDEA_OPTIONS: 'Trip Idea Options' },
  TRIP_IDEAS_HEADERS: headers('TRIP_IDEAS_HEADERS'), TRIP_IDEA_OPTIONS_HEADERS: headers('TRIP_IDEA_OPTIONS_HEADERS'),
  Utilities: { getUuid: () => (++uuid).toString(16).padStart(12, 'a') + '-0000-0000-0000-000000000000' },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
});
S.sheets = { 'Trip Ideas': fakeSheet(S.TRIP_IDEAS_HEADERS), 'Trip Idea Options': fakeSheet(S.TRIP_IDEA_OPTIONS_HEADERS) };
S.getSpreadsheet = () => ({});
S.ensureSheet = (ss, name) => S.sheets[name];
vm.runInContext(SRC, S);
const run = code => vm.runInContext(code, S);

console.log('cleaning an idea');
{
  S.raw = { title: '  Spring   in Europe ', where: 'Portugal, Spain', months: ['2027-05', '2027-03', '2027-04', '2027-04', '2027-13', 'May'],
    nightsMin: 21, nightsMax: 7, budget: '$9,500', pace: 'PACKED', openTo: ['train', 'cruise', 'helicopter', 'train'], status: 'nope', travelers: 'A & V' };
  const i = run('tiCleanIdea_(raw)');
  check('the title is trimmed and its spaces collapsed', i.title === 'Spring in Europe', i.title);
  check('months are real yyyy-MM, sorted, once each', i.months.join() === '2027-03,2027-04,2027-05', i.months.join());
  check('a backwards nights range is put in order', i.nightsMin === 7 && i.nightsMax === 21);
  check('the budget is one number, whatever it was typed as', i.budget === 9500, i.budget);
  check('pace and status fall back to known values', i.pace === 'packed' && i.status === 'brainstorming');
  check('open-to keeps only known styles, once each', i.openTo.join() === 'train,cruise', i.openTo.join());
  check('no budget is null, not zero', run('tiCleanIdea_({ title: "x", budget: "" }).budget') === null);
  check('nights are bounded', run('tiCleanIdea_({ title: "x", nightsMin: -4, nightsMax: 400 })').nightsMin === 1 && run('tiCleanIdea_({ title: "x", nightsMin: -4, nightsMax: 400 })').nightsMax === 90);
}

console.log('\ncleaning an option: any mix of legs');
{
  S.rawOpt = { ideaId: 'IDEA-1', name: 'Lisbon → cruise → Madrid', source: 'ChatGPT', flag: 'star', legs: [
    { kind: 'move', mode: 'fly', from: 'Home', to: 'LIS', note: 'overnight' },
    { kind: 'stop', place: 'Lisbon', nights: '3' },
    { kind: 'move', mode: 'car', from: 'Lisbon', to: 'Lagos', note: '~3h' },
    { kind: 'stop', place: 'Algarve', nights: 3 },
    { kind: 'move', mode: 'ship', from: 'Cádiz', to: 'Barcelona' },
    { kind: 'stop', place: 'Cruise', nights: 7 },
    { kind: 'move', mode: 'train', from: 'Barcelona', to: 'Madrid' },
    { kind: 'stop', place: '   ', nights: 2 },
    { kind: 'move', mode: 'teleport', from: 'Madrid', to: 'Home' },
    { kind: 'nonsense' }],
    cost: { flights: { low: '1,200', high: 900, basis: 'ARIA · Oct 24' }, stays: { low: '', high: 2000 }, cruise: { low: '', high: '' }, bogus: { low: 1 } },
    pros: 'Beach, city and sea\n\n  Two countries ', cons: ['Four kinds of transport'] };
  const o = run('tiCleanOption_(rawOpt)');
  check('a mixed trip keeps every leg in order', o.legs.map(l => l.kind === 'stop' ? l.place : l.mode).join() === 'fly,Lisbon,car,Algarve,ship,Cruise,train,other', o.legs.map(l => l.kind === 'stop' ? l.place : l.mode).join());
  check('a stop with no place is dropped; an unknown leg too', o.legs.length === 8);
  check('an unknown mode becomes "other", never dropped', o.legs[7].mode === 'other' && o.legs[7].to === 'Home');
  check('nights are whole numbers', o.legs[1].nights === 3);
  check('the source is a known one, lower-cased', o.source === 'chatgpt');
  check('a cost range is put in order, with its basis', o.cost.flights.low === 900 && o.cost.flights.high === 1200 && o.cost.flights.basis === 'ARIA · Oct 24');
  check('one end alone is a range of one', o.cost.stays.low === 2000 && o.cost.stays.high === 2000);
  check('a category with no figure is left out, and unknown ones too', !('cruise' in o.cost) && !('bogus' in o.cost));
  check('for and against are trimmed lines', o.pros.join('|') === 'Beach, city and sea|Two countries' && o.cons.length === 1);
  check('a simple trip is fine too: fly in, stay, fly out', run('tiCleanOption_({ name: "Cairo", legs: [{kind:"move",mode:"fly",from:"IAD",to:"CAI"},{kind:"stop",place:"Cairo",nights:10},{kind:"move",mode:"fly",from:"CAI",to:"IAD"}] })').legs.length === 3);
  check('the route is capped', run('tiCleanLegs_(Array.from({length: 60}, () => ({kind:"stop",place:"x",nights:1})))').length === 40);
}

console.log('\nthe endpoints');
{
  const idea = run('webSaveTripIdea_({ idea: { title: "Spring in Europe", months: ["2027-04"], nightsMin: 7, nightsMax: 21, budget: 9000 } })');
  check('a new idea gets an id and is stored', idea.ok && /^IDEA-[0-9A-F]{12}$/.test(idea.idea.id) && S.sheets['Trip Ideas'].rows.length === 2, JSON.stringify(idea));
  check('…its row is in header order', S.sheets['Trip Ideas'].rows[1][1] === 'Spring in Europe' && S.sheets['Trip Ideas'].rows[1][3] === '["2027-04"]' && S.sheets['Trip Ideas'].rows[1][7] === 9000);
  check('an idea with no name is refused', run('webSaveTripIdea_({ idea: { title: "  " } })').ok === false);
  S.id = idea.idea.id;
  // The dashboard always sends the whole idea back; a save replaces it.
  S.whole = Object.assign({}, idea.idea, { status: 'shortlisted' });
  const upd = run('webSaveTripIdea_({ idea: whole })');
  check('saving with its id updates it in place', upd.ok && S.sheets['Trip Ideas'].rows.length === 2 && S.sheets['Trip Ideas'].rows[1][11] === 'shortlisted');
  check('…and keeps when it was created', S.sheets['Trip Ideas'].rows[1][14] === idea.idea.created);
  check('an unknown id is refused, not created', run('webSaveTripIdea_({ idea: { id: "IDEA-NOPE", title: "x" } })').ok === false && S.sheets['Trip Ideas'].rows.length === 2);

  const opt = run('webSaveTripIdeaOption_({ option: Object.assign({}, rawOpt, { ideaId: id }) })');
  check('an option is stored under its idea', opt.ok && /^OPT-/.test(opt.option.id) && S.sheets['Trip Idea Options'].rows.length === 2, JSON.stringify(opt).slice(0, 200));
  check('an option for an idea that does not exist is refused', run('webSaveTripIdeaOption_({ option: { ideaId: "IDEA-NOPE", name: "x" } })').ok === false);
  const all = run('webGetTripIdeas_()');
  check('reading back gives the same idea and option', all.ok && all.ideas.length === 1 && all.ideas[0].status === 'shortlisted' && all.ideas[0].months.join() === '2027-04'
    && all.options.length === 1 && all.options[0].legs.length === 8 && all.options[0].cost.flights.high === 1200 && all.options[0].pros.length === 2, JSON.stringify(all).slice(0, 300));
  S.oid = opt.option.id;
  run('webSaveTripIdeaOption_({ option: { id: oid, ideaId: id, name: "Renamed", flag: "out" } })');
  check('an option is updated in place', S.sheets['Trip Idea Options'].rows.length === 2 && S.sheets['Trip Idea Options'].rows[1][2] === 'Renamed' && S.sheets['Trip Idea Options'].rows[1][4] === 'out');
  run('webSaveTripIdeaOption_({ option: { ideaId: id, name: "Second" } })');
  check('deleting an option removes only it', run('webDeleteTripIdeaOption_({ id: oid })').ok && S.sheets['Trip Idea Options'].rows.length === 2);
  const del = run('webDeleteTripIdea_({ id: id })');
  check('deleting an idea removes it and its options', del.ok && del.optionsRemoved === 1 && S.sheets['Trip Ideas'].rows.length === 1 && S.sheets['Trip Idea Options'].rows.length === 1);
}

// ============ the dashboard block ===================================================
const START = '// ---- TripIdeasView (Trip Ideas, stage 1) — SHARED VERBATIM', END = '// ---- /TripIdeasView ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
const A = block(APP), L = block(LITE);
console.log('\nthe shared block');
check('both dashboards carry it', A.length > 1000 && L.length > 1000);
check('…word for word', A === L);
const C = vm.createContext({ console, React: { createElement: () => null, useState: v => [typeof v === 'function' ? v() : v, () => {}], useEffect: () => {} } });
vm.runInContext(A, C);
const cr = code => vm.runInContext(code, C);
{
  const mt = m => { C.m = m; return cr('tiMonthsText_(m)'); };
  check('months read as a range', mt(['2027-03', '2027-04', '2027-05']) === 'Mar – May 2027', mt(['2027-03', '2027-04', '2027-05']));
  check('…or a list when they skip', mt(['2027-03', '2027-06']) === 'Mar, Jun 2027', mt(['2027-03', '2027-06']));
  check('…across a new year', mt(['2026-12', '2027-01', '2027-02']) === 'Dec 2026 – Feb 2027', mt(['2026-12', '2027-01', '2027-02']));
  check('…and no months is any time', mt([]) === 'Any time');
  check('nights read as a range', cr('tiNightsText_(7, 21)') === '7–21 nights' && cr('tiNightsText_(10, 10)') === '10 nights' && cr('tiNightsText_(null, null)') === 'Any length');
  C.legs = [{ kind: 'move', mode: 'fly' }, { kind: 'stop', place: 'Lisbon', nights: 3 }, { kind: 'move', mode: 'car' }, { kind: 'move', mode: 'car' },
    { kind: 'stop', place: 'Algarve', nights: 3 }, { kind: 'move', mode: 'ship' }, { kind: 'stop', place: 'Cruise', nights: 7 }, { kind: 'move', mode: 'train' }, { kind: 'move', mode: 'fly' }];
  check('a route\'s modes read in order, a repeat once', cr('tiModesText_(legs)') === 'Fly · drive · cruise · train · fly', cr('tiModesText_(legs)'));
  check('a flight in and a flight out read twice', cr('tiModesText_([{kind:"move",mode:"fly"},{kind:"stop",place:"x",nights:2},{kind:"move",mode:"fly"}])') === 'Fly · fly');
  check('…and a route with no moves stays put', cr('tiModesText_([{kind:"stop",place:"x",nights:2}])') === 'Stay put');
  check('nights add up across the stops', cr('tiLegNights_(legs)') === 13);
  C.cost = { flights: { low: 1000, high: 1400 }, stays: { low: 2000, high: 3000 }, daily: { low: 800, high: 800 } };
  check('the cost total adds the categories', JSON.stringify(cr('tiCostTotal_(cost)')) === '{"low":3800,"high":5200,"count":3}');
  check('no cost is no total, not $0', cr('tiCostTotal_({})') === null);
  check('money reads short', cr('tiMoney_(850)') === '$850' && cr('tiMoney_(4200)') === '$4.2k' && cr('tiMoney_(12400)') === '$12k');
  check('within the budget when even the high end fits', cr('tiBudgetFit_({low:3800,high:5200}, 6000)') === 'within');
  check('over when even the low end does not', cr('tiBudgetFit_({low:3800,high:5200}, 3000)') === 'over');
  check('close when the budget falls inside the range', cr('tiBudgetFit_({low:3800,high:5200}, 4500)') === 'close');
  check('no budget, no verdict', cr('tiBudgetFit_({low:1,high:2}, null)') === '' && cr('tiBudgetFit_(null, 5000)') === '');
  C.ideas = [{ id: 'a', status: 'brainstorming', updated: '2026-10-01' }, { id: 'b', status: 'brainstorming', updated: '2026-10-20' }, { id: 'c', status: 'weird' }, { id: 'd', status: 'archived' }];
  const g = cr('tiGroupIdeas_(ideas)');
  check('ideas group by status, newest first; an unknown status brainstorms', g.brainstorming.map(i => i.id).join() === 'b,a,c' && g.archived.length === 1, JSON.stringify(g));
  C.opts = [{ ideaId: 'a', name: 'Train', flag: 'star', legs: [{ kind: 'stop', nights: 10 }], cost: { flights: { low: 1000, high: 2000 } } },
    { ideaId: 'a', name: 'Cruise', flag: '', legs: [{ kind: 'stop', nights: 14 }], cost: { cruise: { low: 3000, high: 4000 } } },
    { ideaId: 'a', name: 'Out', flag: 'out', legs: [{ kind: 'stop', nights: 30 }] }, { ideaId: 'z', name: 'Other idea', legs: [] }];
  const s = cr('tiIdeaSummary_({id:"a"}, opts)');
  check('a card counts the options still in play, and names the favourite', s.count === 2 && s.star === 'Train', JSON.stringify(s));
  check('…with the spread of nights and cost, ruled-out ones left out', s.nights.lo === 10 && s.nights.hi === 14 && s.cost.low === 1000 && s.cost.high === 4000, JSON.stringify(s));
  check('the quick route is fly in, stay, fly out', cr('tiSimpleLegs_().map(function(l){return l.kind==="stop"?"stop":l.mode;}).join()') === 'fly,stop,fly');
}

console.log('\nwiring');
check('the five routes are wired', /case 'trip_ideas':\s+return jsonOut_\(webGetTripIdeas_\(\)\);/.test(WEB)
  && /case 'trip_idea_save':\s+return jsonOut_\(webSaveTripIdea_\(body\)\);/.test(WEB) && /case 'trip_idea_delete':\s+return jsonOut_\(webDeleteTripIdea_\(body\)\);/.test(WEB)
  && /case 'trip_option_save':\s+return jsonOut_\(webSaveTripIdeaOption_\(body\)\);/.test(WEB) && /case 'trip_option_delete':\s+return jsonOut_\(webDeleteTripIdeaOption_\(body\)\);/.test(WEB));
check('full: Trip Ideas is the first Travel tab, and renders the view', /const subTabs=\[\{id:'ideas',label:'💡 Trip Ideas'/.test(APP) && /sub==='ideas'&&\/\*#__PURE__\*\/React\.createElement\(TripIdeasView,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
check('lite: Trip Ideas is the first Travel tab, and renders the view', /\{\[\['ideas','💡 Trip Ideas'\],\['trips','✈️ My Trips'\]/.test(LITE) && /\{travSub === 'ideas' && <TripIdeasView apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>\}/.test(LITE));
check('index.html carries the block, not a stale build', fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8').indexOf('function TripIdeasView(') !== -1);
check('nothing in Trip Ideas writes to a calendar', !/CalendarApp|Calendar\.Events/.test(SRC));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
