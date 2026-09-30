// The weather dependency: a decision rested on a fact, and the fact changed.
// Most of this file is about the cases where VERA must stay quiet — it fires
// on ONE transition and no other.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const HDRS = ['ID','Trip Key','Group Key','Slot Date','Status','Chosen Item ID','Snoozed Until','Decided At','Notes'];
const TODAY = '2026-11-05';

// Real upsertKeyedFlags_, lifted out of Code.js — the dedup behaviour is the
// whole reason this goes through it instead of writeFlags, so testing a copy
// would test nothing.
function realUpsert() {
  const src = fs.readFileSync(ROOT + '/Code.js', 'utf8');
  const at = src.indexOf('function upsertKeyedFlags_');
  let depth = 0, end = at;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  return src.slice(at, end);
}

function fakeFlagSheet() {
  const FLAG_COLS = 11;
  return {
    rows: [],
    getLastRow() { return this.rows.length + 1; },
    getRange(r, c, nr, nc) {
      const self = this;
      return {
        getValues() {
          const o = [];
          for (let i = 0; i < nr; i++) {
            const row = self.rows[r - 2 + i] || [];
            const rr = [];
            for (let j = 0; j < nc; j++) rr.push(row[c - 1 + j] !== undefined ? row[c - 1 + j] : '');
            o.push(rr);
          }
          return o;
        },
        setValue(v) { const row = self.rows[r - 2]; if (row) row[c - 1] = v; },
      };
    },
    appendRow(v) { this.rows.push(v.slice()); },
  };
}

function build(opts) {
  opts = opts || {};
  const flagSheet = fakeFlagSheet();
  const tdSheet = {
    _rows: [HDRS].concat(opts.decisionRows || []),
    getLastRow() { return this._rows.length; },
    getRange(r, c, nr, nc) {
      const self = this;
      return { getValues() {
        const o = [];
        for (let i = 0; i < nr; i++) {
          const rr = [];
          for (let j = 0; j < nc; j++) {
            const row = self._rows[r - 1 + i];
            rr.push(row && row[c - 1 + j] !== undefined ? row[c - 1 + j] : '');
          }
          o.push(rr);
        }
        return o;
      } };
    },
  };

  const ctx = {
    TABS: { TRIP_DECISIONS: 'Trip Decisions', FLAGS: 'Flags' },
    TRIP_DECISION_HEADERS: HDRS,
    FLAG_HEADERS: new Array(11).fill(''),
    getSpreadsheet: () => ({ getSheetByName: n => (n === 'Flags' ? flagSheet : tdSheet) }),
    formatDateVal_: v => String(v || ''),
    Logger: { log(){} },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (d, tz, f) => {
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        if (f === 'EEE MMM d') return days[d.getUTCDay()] + ' ' + mons[d.getUTCMonth()] + ' ' + d.getUTCDate();
        return TODAY;   // "now" is pinned so the tests are not time-dependent
      },
    },
    colorCodeFlags: () => {},
    webGetItinerary_: () => ({ items: opts.items || [] }),
    geocodePackingDestination_: () => ({ lat: 1, lon: 2 }),
    fetchWithHealth_: () => null,
    JSON, String, Number, Math, parseInt, Object, Array, RegExp, Date, isNaN,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/TripDecisions.js', 'utf8'), ctx);
  vm.runInContext(realUpsert(), ctx);

  // AFTER the source runs, not before: TripDecisions.js declares its own
  // tripDailyForecast_, and a function declaration overwrites a same-named
  // context property. Stubbing it up front left the real one in place, which
  // returned null for every fixture — so the whole suite passed green while
  // asserting nothing. What is stubbed here is the forecast as it stands
  // TODAY; the premise it is compared against comes from the decision row.
  ctx.tripDailyForecast_ = () => opts.forecastNow || null;
  ctx.__flagSheet = flagSheet;
  return ctx;
}

// A decided group: the BEACH (outdoor) was chosen over the museum.
function decidedItems() {
  const items = [
    { id:'A', type:'museum', title:'Maybe the Frost Museum', date:'2026-11-08',
      startTime:'14:00', endTime:'16:30', location:'Biscayne', notes:'', metadata:'{}' },
    { id:'B', type:'beach', title:'Beach afternoon (tentative)', date:'2026-11-08',
      startTime:'14:30', endTime:'17:00', location:'South Beach', notes:'', metadata:'{}' },
  ];
  const E = build();
  E.annotateOptionGroups_(items);
  return items;
}
const GROUP_KEY = '2026-11-08|14:00';
const row = (over) => Object.assign({
  id:'TD-1', tripKey:'2026-11-06|Miami', groupKey:GROUP_KEY, slot:'2026-11-08',
  status:'Decided', chosen:'B', snoozed:'', decidedAt:'2026-11-03',
  notes: JSON.stringify({ wx:'fine', asOf:'2026-11-03' }),
}, over);
const asRow = o => [o.id, o.tripKey, o.groupKey, o.slot, o.status, o.chosen, o.snoozed, o.decidedAt, o.notes];

// Against a pre-phase-3 tree these do not exist; report that rather than dying.
console.log('\nthe premise engine exists');
{
  const probe = build();
  ['checkTripDecisionPremises_', 'tdReadPremise_', 'isOutdoorType_', 'weatherVerdictFor_']
    .forEach(fn => check(fn + ' is defined', typeof probe[fn] === 'function', typeof probe[fn]));
  if (fail) {
    console.log('\n' + pass + ' passed, ' + fail + ' failed  — engine absent, nothing further to test');
    process.exit(1);
  }
}

const WET  = [{ date:'2026-11-08', precipMm: 3, code: 61 }];   // 1 < mm <= 5 is 'wet'; over 5 is 'severe'
const FINE = [{ date:'2026-11-08', precipMm: 0, code: 1  }];
const STORM= [{ date:'2026-11-08', precipMm: 2, code: 95 }];

function run(over, forecastNow, items) {
  const E = build({ decisionRows: [asRow(row(over))], forecastNow, items: items || decidedItems() });
  E.checkTripDecisionPremises_();
  return E.__flagSheet.rows;
}

console.log('\nthe transition it fires on');
{
  const rows = run({}, WET);
  check('fine → wet on an outdoor choice FIRES', rows.length === 1, rows.length);
  check('…naming the chosen option', rows[0] && /Beach afternoon/.test(rows[0][3]), rows[0] && rows[0][3]);
  check('…and the day',              rows[0] && /Sun Nov 8/.test(rows[0][3]), rows[0] && rows[0][3]);
  check('…saying when it was chosen', rows[0] && /2026-11-03/.test(rows[0][4]), rows[0] && rows[0][4]);
  check('…offering the option passed over', rows[0] && /Frost Museum/.test(rows[0][4]), rows[0] && rows[0][4]);
  check('…and NOT claiming to have changed anything',
        rows[0] && /Reopen it/.test(rows[0][4]) && !/reopened|withdrawn/i.test(rows[0][4]),
        rows[0] && rows[0][4]);
  check('Medium for rain', rows[0] && rows[0][5] === 'Medium', rows[0] && rows[0][5]);

  const storm = run({}, STORM);
  check('a storm is High', storm[0] && storm[0][5] === 'High', storm[0] && storm[0][5]);
}

console.log('\nand every case it stays quiet on');
{
  check('still fine → SILENT', run({}, FINE).length === 0);
  check('no forecast at all → SILENT', run({}, null).length === 0);

  check('the premise was already wet → SILENT',
        run({ notes: JSON.stringify({ wx:'wet', asOf:'2026-11-03' }) }, WET).length === 0,
        'it did not turn; it was always going to rain');

  check('no premise stored → SILENT', run({ notes: '' }, WET).length === 0,
        'nothing to compare against');
  check('a malformed premise → SILENT', run({ notes: '{oh no' }, WET).length === 0);

  // An INDOOR choice is weatherproof.
  check('an indoor choice → SILENT', run({ chosen: 'A' }, WET).length === 0,
        'rain does not reach a museum');

  check('an OPEN decision → SILENT', run({ status: 'Snoozed' }, WET).length === 0);
  check('a past slot → SILENT', run({ slot: '2026-11-01' }, WET).length === 0,
        'too late to matter');
  check('the slot is TODAY → SILENT', run({ slot: TODAY }, WET).length === 0,
        'you are living it, not deciding it');

  check('the chosen option no longer exists → SILENT',
        run({ chosen: 'GONE' }, WET).length === 0,
        'the hold was deleted from the calendar');
  check('an empty itinerary → SILENT', run({}, WET, []).length === 0);
}

console.log('\none row per decision, whatever happens');
{
  const E = build({ decisionRows: [asRow(row({}))], forecastNow: WET, items: decidedItems() });
  E.checkTripDecisionPremises_();
  check('the first run opens one flag', E.__flagSheet.rows.length === 1, E.__flagSheet.rows.length);
  E.checkTripDecisionPremises_();
  E.checkTripDecisionPremises_();
  check('two more runs add NOTHING', E.__flagSheet.rows.length === 1, E.__flagSheet.rows.length);

  // Escalating rain must sharpen the SAME row, not open a second.
  const E2 = build({ decisionRows: [asRow(row({}))], forecastNow: WET, items: decidedItems() });
  E2.checkTripDecisionPremises_();
  E2.tripDailyForecast_ = () => STORM;
  E2.checkTripDecisionPremises_();
  check('rain sharpening to storms stays ONE row', E2.__flagSheet.rows.length === 1, E2.__flagSheet.rows.length);
  check('…and the urgency moves to High', E2.__flagSheet.rows[0][5] === 'High', E2.__flagSheet.rows[0][5]);
}

console.log('\nit resolves itself');
{
  const E = build({ decisionRows: [asRow(row({}))], forecastNow: WET, items: decidedItems() });
  E.checkTripDecisionPremises_();
  check('flag is open', E.__flagSheet.rows[0][8] === 'No', E.__flagSheet.rows[0][8]);

  // The forecast recovers.
  E.tripDailyForecast_ = () => FINE;
  E.checkTripDecisionPremises_();
  check('a recovered forecast auto-resolves it', E.__flagSheet.rows[0][8] === 'Yes', E.__flagSheet.rows[0][8]);

  // …and reopens if it turns again.
  E.tripDailyForecast_ = () => WET;
  E.checkTripDecisionPremises_();
  check('and reopens if it turns back', E.__flagSheet.rows[0][8] === 'No', E.__flagSheet.rows[0][8]);
  check('still just one row', E.__flagSheet.rows.length === 1, E.__flagSheet.rows.length);
}

console.log('\nno Trip Decisions tab at all');
{
  const E = build({ decisionRows: [] });
  let threw = false;
  try { E.checkTripDecisionPremises_(); } catch (e) { threw = true; }
  check('an empty tab does not throw', !threw);
  check('…and opens no flags', E.__flagSheet.rows.length === 0, E.__flagSheet.rows.length);
}

console.log('\ntdReadPremise_');
{
  check('reads a good premise', E_premise('{"wx":"fine","asOf":"2026-11-03"}').wx === 'fine');
  check('rejects malformed JSON', E_premise('{nope') === null);
  check('rejects an object with no wx', E_premise('{"asOf":"x"}') === null);
  check('rejects empty', E_premise('') === null);
}
function E_premise(s) { return build().tdReadPremise_(s); }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
