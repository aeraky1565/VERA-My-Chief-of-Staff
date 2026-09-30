// The email side of phase 3: the Still To Decide section, and — the bug this
// phase fixes — the briefings collapsing competing holds instead of listing a
// packed afternoon that does not exist.
//
// Runs the REAL builders out of the real source, not transcriptions.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function build() {
  const ctx = {
    TABS: { TRIP_DECISIONS: 'Trip Decisions', FLAGS: 'Flags' },
    TRIP_DECISION_HEADERS: ['ID','Trip Key','Group Key','Slot Date','Status','Chosen Item ID','Snoozed Until','Decided At','Notes'],
    getSpreadsheet: () => ({ getSheetByName: () => null }),
    formatDateVal_: v => String(v || ''),
    Logger: { log(){} },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (d, tz, f) => {
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        if (f === 'EEE MMM d') return days[d.getUTCDay()] + ' ' + mons[d.getUTCMonth()] + ' ' + d.getUTCDate();
        return d.toISOString().slice(0, 10);
      },
    },
    // The real one, lifted from Code.js so the escaping under test is the
    // shipped escaping.
    escapeHtml_: (() => {
      const src = fs.readFileSync(ROOT + '/Code.js', 'utf8');
      const at = src.indexOf('function escapeHtml_');
      let depth = 0, end = at;
      for (let i = src.indexOf('{', at); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
      }
      const box = { String, RegExp };
      vm.createContext(box);
      vm.runInContext(src.slice(at, end) + '; this.__f = escapeHtml_;', box);
      return box.__f;
    })(),
    webGetItinerary_: null,   // set per-test
    JSON, String, Number, Math, parseInt, Object, Array, RegExp, Date, isNaN,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/TripDecisions.js', 'utf8'), ctx);
  return ctx;
}

const E = build();

// Against a pre-phase-3 tree every one of these is undefined. Report that as
// failures rather than dying on the first call, so the negative control says
// what is missing instead of printing a stack trace.
console.log('\nthe phase 3 engine exists');
['openDecisionsForTrip_','buildOpenDecisionsSection_','buildOpenDecisionsPlain_','collapseItineraryRows_'].forEach(fn => check(fn + ' is defined', typeof E[fn] === 'function', typeof E[fn]));
if (fail) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed  — engine absent, nothing further to test');
  process.exit(1);
}

const OPTS = () => ([
  { id:'A', type:'museum', title:'Maybe the Frost Museum', date:'2026-11-08',
    startTime:'14:00', endTime:'16:30', location:'Biscayne', notes:'', metadata:'{}' },
  { id:'B', type:'beach', title:'Beach afternoon (tentative)', date:'2026-11-08',
    startTime:'14:30', endTime:'17:00', location:'South Beach', notes:'', metadata:'{}' },
]);

function itinOf(items) {
  E.annotateOptionGroups_(items);
  E.applyTripDecisions_(items, 'T', '2026-10-01');
  return items;
}

console.log('\nopenDecisionsForTrip_');
{
  const items = itinOf(OPTS());
  E.applyTripRecommendations_(items, { forecast: [{ date:'2026-11-08', precipMm:4, code:61 }] });
  E.webGetItinerary_ = () => ({ items });

  const d = E.openDecisionsForTrip_('T', '2026-11-08', '2026-11-08');
  check('one open decision', d.length === 1, d.length);
  check('…with both options', d[0] && d[0].options.length === 2, d[0] && d[0].options.length);
  check('…a slot label',      d[0] && d[0].slotLabel === 'Sun Nov 8', d[0] && d[0].slotLabel);
  check('…a decide-by',       d[0] && !!d[0].decideBy, d[0] && d[0].decideBy);
  check('…and the recommendation', d[0] && d[0].recommendedId === 'A', d[0] && d[0].recommendedId);

  // A decided group is not an open decision.
  const decided = itinOf(OPTS());
  decided.forEach(it => { const m = JSON.parse(it.metadata); m.decisionStatus = 'decided'; it.metadata = JSON.stringify(m); });
  E.webGetItinerary_ = () => ({ items: decided });
  check('a decided group is not listed', E.openDecisionsForTrip_('T','2026-11-08','2026-11-08').length === 0);

  // onlyDate filters to one day — what the night-before and travel-day use.
  const twoDays = itinOf(OPTS().concat([
    { id:'C', type:'museum', title:'Maybe the Perez (tentative)', date:'2026-11-09',
      startTime:'14:00', endTime:'16:00', location:'Perez', notes:'', metadata:'{}' },
    { id:'D', type:'beach', title:'Key Biscayne — option', date:'2026-11-09',
      startTime:'14:30', endTime:'17:00', location:'Key Biscayne', notes:'', metadata:'{}' },
  ]));
  E.webGetItinerary_ = () => ({ items: twoDays });
  check('both days when unfiltered', E.openDecisionsForTrip_('T','2026-11-08','2026-11-09').length === 2,
        E.openDecisionsForTrip_('T','2026-11-08','2026-11-09').length);
  const one = E.openDecisionsForTrip_('T','2026-11-08','2026-11-09','2026-11-09');
  check('onlyDate narrows to that day', one.length === 1 && one[0].slotDate === '2026-11-09',
        JSON.stringify(one.map(x => x.slotDate)));
}

console.log('\nbuildOpenDecisionsSection_ — quiet when there is nothing open');
{
  check('no decisions renders NOTHING', E.buildOpenDecisionsSection_([]) === '',
        'an empty string is what makes the assembler drop the section');
  check('null renders nothing',         E.buildOpenDecisionsSection_(null) === '');
  check('undefined renders nothing',    E.buildOpenDecisionsSection_(undefined) === '');
}

console.log('\nbuildOpenDecisionsSection_ — the section itself');
{
  const items = itinOf(OPTS());
  E.applyTripRecommendations_(items, { forecast: [{ date:'2026-11-08', precipMm:4, code:61 }] });
  E.webGetItinerary_ = () => ({ items });
  const html = E.buildOpenDecisionsSection_(E.openDecisionsForTrip_('T','2026-11-08','2026-11-08'));

  check('has the section eyebrow',   /Still To Decide/.test(html));
  check('…in the house blue',        /#1565c0/.test(html), 'matches buildTravelLoungeSection_');
  check('names the day',             /Sun Nov 8/.test(html));
  check('counts the options',        /2 options/.test(html));
  check('names a decide-by',         /Decide by/.test(html));
  check('lists both options',        /Frost Museum/.test(html) && /Beach afternoon/.test(html));
  check('marks the suggested one',   /★ suggested/.test(html));
  check('…and gives the reason',     /rain likely/.test(html), html.slice(-260));

  // The suggestion must sit on the museum, not the beach.
  const museumAt = html.indexOf('Frost Museum');
  const beachAt  = html.indexOf('Beach afternoon');
  const chipAt   = html.indexOf('★ suggested');
  check('the chip is on the MUSEUM row', chipAt > museumAt && chipAt < beachAt,
        'museum@' + museumAt + ' chip@' + chipAt + ' beach@' + beachAt);
}

console.log('\nescaping');
{
  const nasty = itinOf([
    { id:'A', type:'museum', title:'Maybe <script>alert(1)</script> & co', date:'2026-11-08',
      startTime:'14:00', endTime:'16:30', location:'A & B', notes:'', metadata:'{}' },
    { id:'B', type:'beach', title:'Beach (tentative)', date:'2026-11-08',
      startTime:'14:30', endTime:'17:00', location:'', notes:'', metadata:'{}' },
  ]);
  E.webGetItinerary_ = () => ({ items: nasty });
  const html = E.buildOpenDecisionsSection_(E.openDecisionsForTrip_('T','2026-11-08','2026-11-08'));
  check('a title with tags is escaped', !/<script>/.test(html), html.slice(0, 200));
  check('…and the ampersand too',       /&amp;/.test(html));
}

console.log('\nplain text twin');
{
  const items = itinOf(OPTS());
  E.applyTripRecommendations_(items, { forecast: [{ date:'2026-11-08', precipMm:4, code:61 }] });
  E.webGetItinerary_ = () => ({ items });
  const d = E.openDecisionsForTrip_('T','2026-11-08','2026-11-08');

  check('empty when nothing is open', E.buildOpenDecisionsPlain_([]) === '');
  const txt = E.buildOpenDecisionsPlain_(d);
  check('has a heading',       /STILL TO DECIDE/.test(txt));
  check('lists both options',  /Frost Museum/.test(txt) && /Beach afternoon/.test(txt));
  check('marks the suggested', /\[suggested\]/.test(txt), txt);
  check('carries no HTML',     !/[<>]/.test(txt), txt);
}

console.log('\ncollapseItineraryRows_ — the packed afternoon that does not exist');
{
  // Raw Itinerary rows, the shape the briefings actually hold.
  // ITINERARY_HEADERS: ID, Trip Key, Type, Title, Date, Start, End, Location, Notes, Metadata
  const rows = [
    ['R1','T','flight','Flight to Miami','2026-11-08','08:00','11:00','MIA','',''],
    ['R2','T','museum','Maybe the Frost Museum','2026-11-08','14:00','16:30','Biscayne','',''],
    ['R3','T','beach','Beach afternoon (tentative)','2026-11-08','14:30','17:00','South Beach','',''],
    ['R4','T','shopping','Lincoln Road — option','2026-11-08','15:00','17:00','Lincoln Rd','',''],
    ['R5','T','dining','Dinner at Joe’s','2026-11-08','19:00','21:00','Joe’s','',''],
  ];
  const out = E.collapseItineraryRows_(rows, 'T', '2026-10-01');

  check('five rows become three', out.length === 3, out.length);
  check('the flight survives',    out.some(r => r[0] === 'R1'));
  check('the dinner survives',    out.some(r => r[0] === 'R5'));
  check('exactly ONE of the three holds survives',
        out.filter(r => ['R2','R3','R4'].indexOf(r[0]) !== -1).length === 1,
        out.map(r => r[0]).join(','));
  check('rows come back as ROWS, not objects', Array.isArray(out[0]), typeof out[0]);
  check('…with every column intact', out[0].length === rows[0].length, out[0].length);

  // Nothing tentative → nothing removed.
  const solid = [
    ['S1','T','dining','Dinner','2026-11-08','19:00','21:00','Joe’s','',''],
    ['S2','T','museum','The Frost Museum','2026-11-08','14:00','16:30','Biscayne','',''],
  ];
  check('a day with no holds is untouched',
        E.collapseItineraryRows_(solid, 'T', '2026-10-01').length === 2);

  check('an empty list is fine', E.collapseItineraryRows_([], 'T', '2026-10-01').length === 0);
  check('null is fine',          E.collapseItineraryRows_(null, 'T', '2026-10-01').length === 0);

  // Never throws: a malformed row must not take the whole briefing down.
  let threw = false;
  try { E.collapseItineraryRows_([[null]], 'T', '2026-10-01'); } catch (e) { threw = true; }
  check('a malformed row does not throw', !threw);
}

console.log('\nthe emails actually call it');
{
  const pre  = fs.readFileSync(ROOT + '/PreTripBriefing.js', 'utf8');
  const trav = fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8');

  check('the 48h brief collapses its rows',   /collapseItineraryRows_/.test(pre));
  check('the travel day collapses its rows',  /collapseItineraryRows_/.test(trav));
  check('the 48h brief has a decisions section',
        /id: 'decisions'/.test(pre) && /buildOpenDecisionsSection_/.test(pre));
  check('the night-before has one too',
        (pre.match(/id: 'decisions'/g) || []).length === 2,
        (pre.match(/id: 'decisions'/g) || []).length);
  check('the night-before is filtered to departure day',
        /openDecisionsForTrip_\(trip\.tripKey, depStr, endStrNB, depStr\)/.test(pre));
  check('the travel day has an open_decisions section',
        /id: 'open_decisions'/.test(trav) && /buildOpenDecisionsSection_/.test(trav));
  check('both plain-text parts include decisions',
        (pre.match(/buildOpenDecisionsPlain_/g) || []).length === 2,
        (pre.match(/buildOpenDecisionsPlain_/g) || []).length);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
