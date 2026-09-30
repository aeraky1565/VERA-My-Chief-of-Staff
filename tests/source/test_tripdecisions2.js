// Phase 2 engine: decide-by, applying a resolution, and the representative flip.
// The flip is the assertion that matters — every consumer collapses on
// isRepresentative, so moving it is what makes the whole app reason about the
// plan you actually chose.

const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC  = fs.readFileSync(ROOT + '/TripDecisions.js', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const HDRS = ['ID','Trip Key','Group Key','Slot Date','Status','Chosen Item ID','Snoozed Until','Decided At','Notes'];

function build(decisionRows) {
  const logs = [];
  const sheet = {
    _rows: [HDRS].concat(decisionRows || []),
    getLastRow() { return this._rows.length; },
    getRange(r, c, nr, nc) {
      const self = this;
      return { getValues() { const o=[]; for (let i=0;i<nr;i++){const rr=[];for(let j=0;j<nc;j++)rr.push(self._rows[r-1+i]?(self._rows[r-1+i][c-1+j]!==undefined?self._rows[r-1+i][c-1+j]:''):'');o.push(rr);} return o; } };
    },
  };
  const ctx = {
    TABS: { TRIP_DECISIONS: 'Trip Decisions' },
    TRIP_DECISION_HEADERS: HDRS,
    getSpreadsheet: () => ({ getSheetByName: () => sheet }),
    formatDateVal_: v => (v instanceof Date ? v.toISOString().slice(0,10) : String(v || '')),
    Logger: { log: s => logs.push(s) },
    JSON, String, Number, Math, parseInt, Object, Array, RegExp, Date,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return Object.assign(ctx, { _logs: logs });
}

const E = build([]);

// Run this against a pre-phase-2 tree and every one of these is undefined.
// Report that as failures rather than dying on the first call, so the negative
// control says what is missing instead of printing a stack trace.
console.log('\nthe phase 2 engine exists');
['decideByLeadDays_', 'decideByFor_', 'tdAddDays_', 'loadTripDecisions_',
 'applyTripDecisions_', 'checkTripDecisions_'].forEach(fn => {
  check(fn + ' is defined', typeof E[fn] === 'function', typeof E[fn]);
});
if (fail) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed  — engine absent, nothing further to test');
  process.exit(1);
}

const meta = it => { try { return JSON.parse(it.metadata || '{}'); } catch (e) { return {}; } };
let seq = 0;
const item = o => Object.assign({
  id: 'I' + (++seq), type: 'calendar', title: '', date: '2026-11-08',
  startTime: '', endTime: '', location: '', notes: '', metadata: '', allDay: false,
}, o);

console.log('\ndecide-by by type');
{
  const d = (type, today) => {
    const it = [item({ type, title: 'x (tentative)', startTime: '14:00', endTime: '16:00' })];
    return E.decideByFor_(it, today || '2026-10-01');
  };
  check('a museum is 3 days out',   d('museum')   === '2026-11-05', d('museum'));
  check('a show is 3 days out',     d('show')     === '2026-11-05', d('show'));
  check('dining is 2 days out',     d('dining')   === '2026-11-06', d('dining'));
  check('a reservation is 2 days',  d('reservation') === '2026-11-06', d('reservation'));
  check('anything else is 1 day',   d('beach')    === '2026-11-07', d('beach'));
  check('a calendar item is 1 day', d('calendar') === '2026-11-07', d('calendar'));

  const mixed = [
    item({ type: 'beach',  title: 'Beach (tentative)',  startTime: '14:00', endTime: '17:00' }),
    item({ type: 'museum', title: 'Museum (tentative)', startTime: '14:30', endTime: '16:30' }),
  ];
  check('a mixed group takes the EARLIEST deadline — the museum sets the clock',
        E.decideByFor_(mixed, '2026-10-01') === '2026-11-05', E.decideByFor_(mixed, '2026-10-01'));

  check('never in the past — clamped to today',
        E.decideByFor_([item({ type:'museum', startTime:'14:00' })], '2026-11-07') === '2026-11-07',
        E.decideByFor_([item({ type:'museum', startTime:'14:00' })], '2026-11-07'));
  check('never after the slot itself',
        E.decideByFor_([item({ type:'museum', startTime:'14:00' })], '2026-11-20') === '2026-11-08',
        E.decideByFor_([item({ type:'museum', startTime:'14:00' })], '2026-11-20'));
}

// A three-option group, annotated by phase 1.
function group() {
  seq = 0;
  const items = [
    item({ id:'A', type:'museum',   title:'Maybe the museum',    startTime:'14:00', endTime:'16:30' }),
    item({ id:'B', type:'beach',    title:'Beach (tentative)',   startTime:'14:30', endTime:'17:00' }),
    item({ id:'C', type:'shopping', title:'Shopping — option',   startTime:'15:00', endTime:'17:00' }),
    item({ id:'D', type:'dining',   title:'Rasika — booked',     startTime:'19:30', endTime:'21:30' }),
  ];
  E.annotateOptionGroups_(items);
  return items;
}

console.log('\nwhile open');
{
  const items = group();
  E.applyTripDecisions_(items, 'T', '2026-10-01');
  check('every option carries a decide-by', items.slice(0,3).every(i => !!meta(i).decideBy));
  check('status is open', items.slice(0,3).every(i => meta(i).decisionStatus === 'open'));
  check('the earliest is still the representative', meta(items[0]).isRepresentative === true);
  check('collapse returns the earliest hold', (() => {
    const k = E.collapseOptionGroups_(items);
    return k.length === 2 && k.some(i => i.id === 'A');
  })());
  check('the booked dinner is untouched', !meta(items[3]).decisionStatus);
}

console.log('\nTHE FLIP — confirming the LAST option');
{
  const E2 = build([['TD-1','T','2026-11-08|14:00','2026-11-08','Decided','C','', '2026-10-02','']]);
  seq = 0;
  const items = [
    item({ id:'A', type:'museum',   title:'Maybe the museum',  startTime:'14:00', endTime:'16:30' }),
    item({ id:'B', type:'beach',    title:'Beach (tentative)', startTime:'14:30', endTime:'17:00' }),
    item({ id:'C', type:'shopping', title:'Shopping — option', startTime:'15:00', endTime:'17:00' }),
  ];
  E2.annotateOptionGroups_(items);
  check('before: the earliest (A) is the representative', meta(items[0]).isRepresentative === true);

  E2.applyTripDecisions_(items, 'T', '2026-10-01');
  check('after: the representative MOVES to the chosen option C',
        meta(items[2]).isRepresentative === true && meta(items[0]).isRepresentative === false,
        items.map(i => i.id + '=' + meta(i).isRepresentative).join(' '));
  check('collapse now returns the chosen plan, not the earliest hold', (() => {
    const k = E2.collapseOptionGroups_(items);
    return k.length === 1 && k[0].id === 'C';
  })(), JSON.stringify(E2.collapseOptionGroups_(items).map(i => i.id)));
  check('the chosen one stops being tentative — it is a plan now',
        meta(items[2]).tentative === false && meta(items[2]).chosen === true);
  check('the others are marked dismissed',
        meta(items[0]).dismissed === true && meta(items[1]).dismissed === true);
  check('status reads decided on all of them',
        items.every(i => meta(i).decisionStatus === 'decided'));

  // The negative control: same items, no resolution.
  const items2 = [
    item({ id:'A2', type:'museum',   title:'Maybe the museum',  startTime:'14:00', endTime:'16:30' }),
    item({ id:'B2', type:'beach',    title:'Beach (tentative)', startTime:'14:30', endTime:'17:00' }),
    item({ id:'C2', type:'shopping', title:'Shopping — option', startTime:'15:00', endTime:'17:00' }),
  ];
  const E3 = build([]);
  E3.annotateOptionGroups_(items2);
  E3.applyTripDecisions_(items2, 'T', '2026-10-01');
  check('un-resolved, collapse still returns the EARLIEST — proving the flip is the resolution',
        E3.collapseOptionGroups_(items2)[0].id === 'A2',
        E3.collapseOptionGroups_(items2)[0].id);
}

console.log('\nsnoozed and dropped');
{
  const S = build([['TD-2','T','2026-11-08|14:00','2026-11-08','Snoozed','','2026-10-20','2026-10-01','']]);
  seq = 0;
  const items = [
    item({ id:'A', type:'museum', title:'Maybe the museum', startTime:'14:00', endTime:'16:30' }),
    item({ id:'B', type:'beach',  title:'Beach (tentative)', startTime:'14:30', endTime:'17:00' }),
  ];
  S.annotateOptionGroups_(items); S.applyTripDecisions_(items, 'T', '2026-10-01');
  check('snoozed keeps the group open-shaped', meta(items[0]).decisionStatus === 'snoozed');
  check('…carries the date', meta(items[0]).snoozedUntil === '2026-10-20', meta(items[0]).snoozedUntil);
  check('…and the representative does not move', meta(items[0]).isRepresentative === true);
  check('…and both stay tentative', items.every(i => meta(i).tentative === true));

  const D = build([['TD-3','T','2026-11-08|14:00','2026-11-08','Dropped','','','2026-10-01','']]);
  seq = 0;
  const it2 = [
    item({ id:'A', type:'museum', title:'Maybe the museum', startTime:'14:00', endTime:'16:30' }),
    item({ id:'B', type:'beach',  title:'Beach (tentative)', startTime:'14:30', endTime:'17:00' }),
  ];
  D.annotateOptionGroups_(it2); D.applyTripDecisions_(it2, 'T', '2026-10-01');
  check('dropped is reflected', meta(it2[0]).decisionStatus === 'dropped');
}

console.log('\nthe resolution points at a hold that no longer exists');
{
  const G = build([['TD-4','T','2026-11-08|14:00','2026-11-08','Decided','GONE','','2026-10-01','']]);
  seq = 0;
  const items = [
    item({ id:'A', type:'museum', title:'Maybe the museum', startTime:'14:00', endTime:'16:30' }),
    item({ id:'B', type:'beach',  title:'Beach (tentative)', startTime:'14:30', endTime:'17:00' }),
  ];
  G.annotateOptionGroups_(items); G.applyTripDecisions_(items, 'T', '2026-10-01');
  check('the group still has exactly one representative',
        items.filter(i => meta(i).isRepresentative).length === 1,
        items.map(i => i.id + '=' + meta(i).isRepresentative).join(' '));
  check('…so the slot is not silently dropped from every consumer',
        G.collapseOptionGroups_(items).length === 1);
  check('…and it reopens rather than pretending to be decided',
        meta(items[0]).decisionStatus === 'open', meta(items[0]).decisionStatus);
  check('…and says so in the log', G._logs.some(l => /chosen item missing/.test(l)), G._logs.join(' | '));
}

console.log('\nresolutions are scoped to their trip');
{
  const X = build([['TD-5','OTHER|Trip','2026-11-08|14:00','2026-11-08','Decided','B','','2026-10-01','']]);
  seq = 0;
  const items = [
    item({ id:'A', type:'museum', title:'Maybe the museum', startTime:'14:00', endTime:'16:30' }),
    item({ id:'B', type:'beach',  title:'Beach (tentative)', startTime:'14:30', endTime:'17:00' }),
  ];
  X.annotateOptionGroups_(items); X.applyTripDecisions_(items, 'T', '2026-10-01');
  check("another trip's resolution does not apply", meta(items[0]).decisionStatus === 'open');
  check('…and the representative is untouched', meta(items[0]).isRepresentative === true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
