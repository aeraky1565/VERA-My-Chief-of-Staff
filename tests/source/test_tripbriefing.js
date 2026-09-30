// The trip briefing — free text saying what a trip is actually for.
//
// It lives in TripMeta's existing "Notes" column, which until now nothing
// wrote, displayed or read. Two hazards found while wiring it, both asserted
// here because both would corrupt data rather than merely misbehave:
//
//   1. webSetTripMeta_ overwrote Context, Notes and Traveler unconditionally,
//      so any caller that omitted one blanked it.
//   2. Chat's set_trip_context sent notes:'' explicitly, so setting a trip's
//      LABEL erased its briefing. Harmless while nothing wrote briefings;
//      destructive the moment they exist.
//
// The REAL functions, brace-matched into a vm context.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const CODE = fs.readFileSync(ROOT + '/Code.js',   'utf8');
const WEB  = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');
const CHAT = fs.readFileSync(ROOT + '/Chat.js',   'utf8');
const TDB  = fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8');
const PTB  = fs.readFileSync(ROOT + '/PreTripBriefing.js',   'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const HDRS_SRC = CODE.match(/^const TRIP_META_HEADERS +=.*;$/m)[0];
const HEADERS  = JSON.parse(HDRS_SRC.slice(HDRS_SRC.indexOf('[')).replace(/;\s*$/, '').replace(/'/g, '"'));
const WIDTH    = HEADERS.length;

// ---- fake sheet ------------------------------------------------------------
function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  const cols = WIDTH;
  const sheet = {
    _rows: data, _writes: 0,
    getMaxColumns: () => cols,
    getLastRow: () => data.length,
    getRange: (row, c, nr, nc) => {
      nr = nr === undefined ? 1 : nr; nc = nc === undefined ? 1 : nc;
      return {
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const r = [];
            for (let j = 0; j < nc; j++) {
              const s = data[row - 1 + i];
              r.push(s && s[c - 1 + j] !== undefined ? s[c - 1 + j] : '');
            }
            out.push(r);
          }
          return out;
        },
        setValues: v => {
          sheet._writes++;
          v.forEach((rv, i) => {
            while (!data[row - 1 + i]) data.push([]);
            rv.forEach((cv, j) => {
              const r = data[row - 1 + i];
              while (r.length <= c - 1 + j) r.push('');
              r[c - 1 + j] = cv;
            });
          });
        },
        setValue: v => {
          sheet._writes++;
          while (!data[row - 1]) data.push([]);
          const r = data[row - 1];
          while (r.length <= c - 1) r.push('');
          r[c - 1] = v;
        },
        setNumberFormat: () => sheet,
      };
    },
  };
  return sheet;
}

const PRELUDE = [
  HDRS_SRC,
  extractFn(WEB, 'webGetTripMeta_'),
  extractFn(WEB, 'webSetTripMeta_'),
  extractFn(WEB, 'setTripBriefing_'),
  extractFn(WEB, 'webSetTripBriefing_'),
  extractFn(WEB, 'tripBriefingFor_'),
].join('\n');

function ctxFor(sheet) {
  const ctx = {
    String, Array, Number, JSON, Math, parseInt, isNaN, Error, Object, Date,
    TABS: { TRIP_META: 'TripMeta' },
    getSpreadsheet: () => ({ getSheetByName: () => sheet }),
    Session:   { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: () => '2026-09-22' },
    Logger:    { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(PRELUDE, ctx);
  return ctx;
}

const KEY = '2026-11-01|Thanksgiving with the Lewises';
const BRIEF = "Visiting Sarah and Tom for the new baby — quiet, low-key, we want to be useful.";
// tripKey | Context | Notes | Updated | Traveler | Budget | Travellers | Out | Ret | Luggage
const fullRow = () => [KEY, 'Visiting Family', '', '2026-09-01', 'Ahmed', 1200, 2, 'flight', 'flight', '{}'];

// ============ the clobbering guard =========================================

console.log('\nwebSetTripMeta_ preserves what it is not given');
{
  const sheet = makeSheet([HEADERS.slice(), fullRow()]);
  const ctx = ctxFor(sheet);
  vm.runInContext("webSetTripMeta_({ parameter: { tripKey: KEY, notes: BRIEF } })",
                  Object.assign(ctx, { KEY, BRIEF }));
  const r = sheet._rows[1];
  check('the briefing is written', r[2] === BRIEF, r[2]);
  check('the context label SURVIVES', r[1] === 'Visiting Family', JSON.stringify(r[1]));
  check('the traveller SURVIVES', r[4] === 'Ahmed', JSON.stringify(r[4]));
  check('the budget is untouched', r[5] === 1200, r[5]);
  check('the travel modes are untouched', r[7] === 'flight' && r[8] === 'flight');
  check('Updated Date is refreshed', r[3] === '2026-09-22', r[3]);
}

console.log('\n…but an EXPLICIT blank still clears');
{
  const sheet = makeSheet([HEADERS.slice(), fullRow()]);
  const ctx = ctxFor(sheet);
  // '' is defined, so it means "clear this". Only an omitted key is preserved.
  vm.runInContext("webSetTripMeta_({ parameter: { tripKey: KEY, context: '' } })", Object.assign(ctx, { KEY }));
  check('context cleared on purpose', sheet._rows[1][1] === '', JSON.stringify(sheet._rows[1][1]));
  check('…and the traveller still survives', sheet._rows[1][4] === 'Ahmed', sheet._rows[1][4]);
}

console.log('\nthe full dashboard save still works');
{
  // The dashboard sends all three together; that must keep behaving exactly as
  // before the guard.
  const sheet = makeSheet([HEADERS.slice(), fullRow()]);
  const ctx = ctxFor(sheet);
  vm.runInContext("webSetTripMeta_({ parameter: { tripKey: KEY, context: 'Family Trip', notes: BRIEF, traveler: 'Both' } })",
                  Object.assign(ctx, { KEY, BRIEF }));
  const r = sheet._rows[1];
  check('all three land', r[1] === 'Family Trip' && r[2] === BRIEF && r[4] === 'Both',
        [r[1], r[2].slice(0, 12), r[4]].join(' / '));
}

// ============ the targeted writer ==========================================

console.log('\nsetTripBriefing_ touches column 3 and nothing else');
{
  const sheet = makeSheet([HEADERS.slice(), fullRow()]);
  const before = sheet._rows[1].slice();
  const ctx = ctxFor(sheet);
  vm.runInContext("setTripBriefing_(KEY, BRIEF)", Object.assign(ctx, { KEY, BRIEF }));
  const r = sheet._rows[1];
  check('the briefing is written', r[2] === BRIEF, r[2]);
  check('every other cell but Updated Date is byte-identical',
        r.filter((v, i) => i !== 2 && i !== 3).join('|') === before.filter((v, i) => i !== 2 && i !== 3).join('|'),
        r.join('|'));
  check('Updated Date is refreshed', r[3] === '2026-09-22', r[3]);
  check('it reports what it did', vm.runInContext("setTripBriefing_(KEY, BRIEF).action", ctx) === 'updated');
}

console.log('\nsetTripBriefing_ on a trip with no row yet');
{
  const sheet = makeSheet([HEADERS.slice()]);
  const ctx = ctxFor(sheet);
  const res = vm.runInContext("setTripBriefing_(KEY, BRIEF)", Object.assign(ctx, { KEY, BRIEF }));
  check('a row is created', sheet._rows.length === 2, sheet._rows.length);
  check('…carrying the briefing', sheet._rows[1][2] === BRIEF, sheet._rows[1][2]);
  check('…and inventing no label', sheet._rows[1][1] === '', JSON.stringify(sheet._rows[1][1]));
  check('…and no traveller', sheet._rows[1][4] === '', JSON.stringify(sheet._rows[1][4]));
  check('it says it created', res.action === 'created', res.action);
  check('the row is the full header width', sheet._rows[1].length === WIDTH, sheet._rows[1].length);
}

console.log('\nsetTripBriefing_ refusals and round-trip');
{
  const sheet = makeSheet([HEADERS.slice(), fullRow()]);
  const ctx = ctxFor(sheet);
  let threw = '';
  try { vm.runInContext("setTripBriefing_('', 'x')", ctx); } catch (e) { threw = e.message; }
  check('a missing tripKey throws', /tripKey is required/.test(threw), threw);

  vm.runInContext("setTripBriefing_(KEY, '   ')", Object.assign(ctx, { KEY }));
  check('whitespace-only clears rather than storing spaces', sheet._rows[1][2] === '', JSON.stringify(sheet._rows[1][2]));

  vm.runInContext("setTripBriefing_(KEY, BRIEF)", Object.assign(ctx, { KEY, BRIEF }));
  check('webGetTripMeta_ reads it back',
        vm.runInContext("webGetTripMeta_({ parameter: { tripKey: KEY } }).notes", ctx) === BRIEF);
  check('tripBriefingFor_ reads it back', vm.runInContext("tripBriefingFor_(KEY)", ctx) === BRIEF);
  check('an unknown trip reads as empty, not undefined',
        vm.runInContext("tripBriefingFor_('nope|nope')", ctx) === '');
}

// ============ the prompts ===================================================

function promptCtx() {
  const ctx = {
    String, Array, Number, JSON, Math, parseInt, isNaN, Error, Object, Date, RegExp,
    getConfigValues: () => ({}),
    Logger: { log: () => {} },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(WEB, 'buildRecsUserPrompt_') + '\n' +
                  extractFn(WEB, 'buildPackingPrompt_'), ctx);
  return ctx;
}

console.log('\nthe discoveries prompt');
{
  const ctx = promptCtx();
  const call = b => vm.runInContext(
    "buildRecsUserPrompt_('Thanksgiving', '2026-11-01', '2026-11-05', 4, 'Visiting Family', " +
    "'Portland', 'itin here', 'gaps here', " + JSON.stringify(b) + ")", ctx);

  const withB = call(BRIEF);
  check('the briefing is in the prompt', withB.indexOf(BRIEF) !== -1);
  check('…and the label still is too', /Context: Visiting Family/.test(withB));
  check('…the briefing comes BEFORE the itinerary, so it frames it',
        withB.indexOf(BRIEF) < withB.indexOf('PLANNED ITINERARY'),
        withB.indexOf(BRIEF) + ' vs ' + withB.indexOf('PLANNED ITINERARY'));
  check('…and before the gap analysis',
        withB.indexOf(BRIEF) < withB.indexOf('GAP ANALYSIS'));
  check('the conflict rule is present',
        /Where they conflict, follow the latter/.test(withB));

  const noB = call('');
  check('a blank briefing adds NO line at all',
        noB.indexOf('What this trip is actually for') === -1);
  check('…and no conflict rule either', !/Where they conflict/.test(noB));
  check('…while the rest of the prompt is unchanged',
        noB.indexOf('Context: Visiting Family') !== -1 && /PLANNED ITINERARY/.test(noB));
  check('omitting the argument behaves like blank', vm.runInContext(
    "buildRecsUserPrompt_('T','2026-11-01','2026-11-05',4,'Visiting Family','Portland','i','g')", ctx)
    .indexOf('What this trip is actually for') === -1);
}

console.log('\nthe packing prompt');
{
  const ctx = promptCtx();
  const call = b => vm.runInContext(
    "buildPackingPrompt_('Thanksgiving','2026-11-01','2026-11-05',4,'Visiting Family','Both'," +
    "'Portland','autumn','itin','weather',{},[],[]," + JSON.stringify(b) + ")", ctx);
  const withB = call(BRIEF);
  check('the briefing is in the prompt', withB.indexOf(BRIEF) !== -1);
  check('…and the label still is too', /Trip Context: Visiting Family/.test(withB));
  const noB = call('');
  check('a blank briefing adds no line',
        noB.indexOf('What this trip is actually for') === -1);
  check('omitting the argument behaves like blank', vm.runInContext(
    "buildPackingPrompt_('T','2026-11-01','2026-11-05',4,'Visiting Family','Both','Portland','autumn','i','w',{},[],[])", ctx)
    .indexOf('What this trip is actually for') === -1);
}

// ============ the wiring ====================================================

console.log('\nevery generator actually loads it');
{
  const recs = extractFn(WEB, 'webGenerateRecommendations_');
  check('discoveries read notes off the meta', /rMeta\.notes/.test(recs));
  check('…and pass it to the prompt builder', /buildRecsUserPrompt_\([^)]*briefing\)/.test(recs));

  const pack = extractFn(WEB, 'webGeneratePacking_');
  check('packing reads notes off the meta', /metaResult\.notes/.test(pack));
  check('…and passes it to the prompt builder', /freeDays, briefing/.test(pack));

  check('the pre-trip emails read it through the shared helper',
        (PTB.match(/tripBriefingFor_\(/g) || []).length === 2,
        (PTB.match(/tripBriefingFor_\(/g) || []).length + ' call sites');
  check('…and put it in a section', /id: 'briefing'/.test(PTB));
  check('both emails carry the section',
        (PTB.match(/id: 'briefing'/g) || []).length === 2,
        (PTB.match(/id: 'briefing'/g) || []).length);

  // The travel-day wiring goes to the NARRATIVE, not the per-item lookups: a
  // venue's address does not depend on why the trip is happening.
  check('the travel-day narrative takes a briefing',
        /function buildTravelDayNarrativeData_\([^)]*briefing\)/.test(TDB));
  check('…and its caller passes one', /buildTravelDayNarrativeData_\([^)]*tripBriefing\)/.test(TDB));
  const enrich = TDB.indexOf('Find day-of details for this itinerary item');
  check('the per-item detail lookup does NOT get it',
        TDB.slice(enrich, enrich + 900).indexOf('actually for') === -1);
}

console.log('\nthe chat actions');
{
  check('set_trip_briefing has an ACTION line', /ACTION:set_trip_briefing\|/.test(CHAT));
  check('…a rule explaining it is a sentence, not a label',
        /the briefing is a SENTENCE, not a label/.test(CHAT));
  check('…and a handler', /type === 'set_trip_briefing'/.test(CHAT));
  check('the handler uses the targeted writer, not the whole-row path',
        /setTripBriefing_\(stbTK\.tripKey/.test(CHAT));
  check('…re-joining on | so a sentence containing one survives',
        /stbTK\.rest\.join\('\|'\)/.test(CHAT));

  // The bug: setting the LABEL used to wipe the BRIEFING.
  const stc = CHAT.slice(CHAT.indexOf("type === 'set_trip_context'"), CHAT.indexOf("type === 'set_trip_briefing'"));
  check('set_trip_context no longer sends notes at all', !/notes\s*:/.test(stc), stc.slice(0, 200));

  check('the route is registered', /case 'set_trip_briefing':/.test(WEB));
}

console.log('\nsetting a label does not erase a briefing');
{
  // The end-to-end version of the assertion above, through the real functions.
  const sheet = makeSheet([HEADERS.slice(), fullRow()]);
  const ctx = ctxFor(sheet);
  vm.runInContext("setTripBriefing_(KEY, BRIEF)", Object.assign(ctx, { KEY, BRIEF }));
  // …then set the label the way Chat's handler now does — with no notes key.
  vm.runInContext("webSetTripMeta_({ parameter: { tripKey: KEY, context: 'Family Trip' } })", ctx);
  check('the briefing survives setting the label', sheet._rows[1][2] === BRIEF, sheet._rows[1][2]);
  check('…and the label changed', sheet._rows[1][1] === 'Family Trip', sheet._rows[1][1]);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
