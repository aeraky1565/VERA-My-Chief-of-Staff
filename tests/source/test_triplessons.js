// Lessons learned on one trip, applied to the next.
//
// Asked for after a Florida beach trip packed neither a hat nor a water bottle.
// Two separate things were wrong, and the second is the one that shapes the design:
//
//   1. The packing prompt's beach hint listed "swimwear, water shoes, dry bag,
//      reef-safe sunscreen" — no hat, no water bottle.
//   2. That hint only fires when an itinerary row is TYPED 'beach'. A lesson scoped
//      to activity:beach would therefore have missed the same trip for the same
//      reason, which is why scope is asked rather than guessed.
//
// The capture half already half-existed: debrief question 3 has always asked "what
// would you do differently", and the answer went to the Shared Interests ledger,
// which nothing that plans a trip reads. These tests are mostly about the read-back.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = {
  Mem:  fs.readFileSync(ROOT + '/Memory.js', 'utf8'),
  App:   fs.readFileSync(ROOT + '/docs/app.js', 'utf8'),
  Index: fs.readFileSync(ROOT + '/docs/index.html', 'utf8'),
  Web:  fs.readFileSync(ROOT + '/WebApp.js', 'utf8'),
  Code: fs.readFileSync(ROOT + '/Code.js', 'utf8'),
  Chat: fs.readFileSync(ROOT + '/Chat.js', 'utf8'),
};

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
function extractDecl(src, name) {
  // Up to the first ';' on the line, not to end-of-line: these declarations carry a
  // trailing // comment, and anchoring on $ found none of them.
  const re = new RegExp('^(?:var|const)\\s+' + name + '\\s*=.*?;', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('declaration not found: ' + name);
  return m[0];
}

const HEADERS = ['ID', 'Timestamp', 'Type', 'Who', 'Title', 'Detail', 'Context', 'Scope', 'Category'];

// A Memory Log that remembers what was written, so "it was saved correctly" is
// observed rather than inferred from a return value.
function makeMemorySheet(rows, headers) {
  const hdr = (headers || HEADERS).slice();
  const grid = [hdr].concat(rows || []);
  const appended = [];
  // Every Sheets round-trip is counted. In Apps Script each of these is a separate
  // call over the wire, and the cost of a prune is the COUNT, not the outcome — a
  // loop doing two getValue()s per row is what overran the nightly run's time
  // limit and killed it silently.
  const calls = { getRange: 0, getValue: 0, getValues: 0, deleteRow: 0, deleteRows: 0 };
  const sheet = {
    grid, appended, calls,
    getLastRow:    () => grid.length,
    getLastColumn: () => grid[0].length,
    appendRow: r => { grid.push(r.slice()); appended.push(r.slice()); },
    deleteRows: (start, count) => { calls.deleteRows++; grid.splice(start - 1, count); },
    getRange: (r, c, nR, nC) => (calls.getRange++, {
      getValue:  () => (calls.getValue++, (grid[r - 1] || [])[c - 1]),
      setValue:  v => { while (grid[r - 1].length < c) grid[r - 1].push(''); grid[r - 1][c - 1] = v; },
      getValues: () => {
        calls.getValues++;
        const out = [];
        for (let i = 0; i < (nR || 1); i++) {
          const row = grid[r - 1 + i] || [];
          const line = [];
          for (let j = 0; j < (nC || 1); j++) line.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
          out.push(line);
        }
        return out;
      },
    }),
    deleteRow: i => { calls.deleteRow++; grid.splice(i - 1, 1); },
  };
  return sheet;
}

function loadCtx(sheet, opts) {
  const o = opts || {};
  const ctx = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, Boolean,
    isNaN, isFinite, parseInt, parseFloat, Error, console,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: {
      formatDate: (d, tz, f) => {
        const p2 = n => String(n).padStart(2, '0');
        const Y = d.getFullYear(), M = d.getMonth() + 1, D = d.getDate();
        if (f === 'yyyy-MM-dd HH:mm') return Y + '-' + p2(M) + '-' + p2(D) + ' 09:00';
        if (f === 'yyyyMMdd')         return '' + Y + p2(M) + p2(D);
        if (f === 'yyyy-MM-dd')       return Y + '-' + p2(M) + '-' + p2(D);
        throw new Error('unstubbed format: ' + f);
      },
    },
    TABS: { MEMORY_LOG: 'Memory Log', MEMORY_SNAPSHOT: 'Memory Snapshot' },
    getConfigValues: () => o.cfg || {},
    getSpreadsheet: () => ({ getSheetByName: n => (n === 'Memory Log' ? sheet : null) }),
  };
  vm.createContext(ctx);
  // The real constants, not copies — renaming a scope or a category must break this.
  vm.runInContext([
    extractDecl(SRC.Code, 'MEMORY_LOG_HEADERS'),
    extractDecl(SRC.Mem, 'TRIP_LESSON_SCOPES'),
    extractDecl(SRC.Mem, 'TRIP_LESSON_CATEGORIES'),
    SRC.Mem.slice(SRC.Mem.indexOf('var MEMORY_TYPE'), SRC.Mem.indexOf('};', SRC.Mem.indexOf('var MEMORY_TYPE')) + 2),
    extractFn(SRC.Mem, 'ensureMemoryColumns_'),
    extractFn(SRC.Mem, 'appendMemoryEvent_'),
    extractFn(SRC.Mem, 'parseTripLessonScope_'),
    extractFn(SRC.Mem, 'tripTraitList_'),
    extractFn(SRC.Mem, 'tripLessonApplies_'),
    extractFn(SRC.Mem, 'getTripLessons_'),
    extractFn(SRC.Mem, 'tripLessonsPromptBlock_'),
    extractFn(SRC.Mem, 'logTripLesson_'),
    extractFn(SRC.Mem, 'deleteRowsOlderThan_'),
    extractFn(SRC.Mem, 'pruneMemoryLog_'),
  ].join('\n\n'), ctx);
  return ctx;
}

const lessonRow = (title, scope, category, trip, ts) =>
  ['MEM-1', ts || '2026-02-01 09:00', 'trip_lesson', 'Both', title, '', trip || '', scope, category];

console.log('Scope parsing — an unplaceable lesson is refused, not assumed universal');
{
  const c = loadCtx(makeMemorySheet([]));
  const p = s => c.parseTripLessonScope_(s);

  check('always:* parses',            JSON.stringify(p('always:*')) === '{"scope":"always","value":"*"}');
  check('destination parses + lowercases', JSON.stringify(p('Destination:Florida')) === '{"scope":"destination","value":"florida"}');
  check('context parses',             p('context:Family').value === 'family');
  check('activity parses',            p('activity:beach').value === 'beach');

  check('a bare word is refused',     p('florida') === null, 'no scope means we cannot place it');
  check('an unknown scope is refused', p('weather:hot') === null);
  check('an empty value is refused',  p('destination:') === null);
  check('blank is refused',           p('') === null && p(null) === null);
  check('…and refusal is null, never a catch-all',
        p('nonsense') !== undefined && p('nonsense') === null,
        'treating an unparseable scope as always:* would push it into every prompt forever');
}

console.log('\nMatching a lesson to a trip');
{
  const c = loadCtx(makeMemorySheet([]));
  const florida = { destination: 'Orlando, Florida', context: 'Family', activityTypes: { dining: true } };
  const alps    = { destination: 'Chamonix, France', context: 'Anniversary', activityTypes: { skiing: true, beach: false } };

  check('always:* applies to anything',  c.tripLessonApplies_('always:*', florida) === true &&
                                         c.tripLessonApplies_('always:*', alps) === true);
  check('destination matches a substring', c.tripLessonApplies_('destination:florida', florida) === true,
        'stored "Florida" must match a trip whose destination reads "Orlando, Florida"');
  check('…and the other way round too',  c.tripLessonApplies_('destination:orlando, florida',
                                           { destination: 'Florida' }) === true);
  check('a different destination does not match', c.tripLessonApplies_('destination:florida', alps) === false);
  check('context matches',               c.tripLessonApplies_('context:family', florida) === true);
  check('…and does not match another',   c.tripLessonApplies_('context:family', alps) === false);
  check('activity matches a typed row',  c.tripLessonApplies_('activity:skiing', alps) === true);
  check('…and not an untyped one',       c.tripLessonApplies_('activity:beach', florida) === false);

  // The point of the whole design, stated as a test.
  check('activity:beach MISSES a beach trip whose itinerary never says beach',
        c.tripLessonApplies_('activity:beach', florida) === false &&
        c.tripLessonApplies_('destination:florida', florida) === true,
        'this is why the debrief asks for the scope instead of inferring it');

  check('an unparseable scope matches nothing', c.tripLessonApplies_('florida', florida) === false);
  check('a blank trip field matches nothing',   c.tripLessonApplies_('destination:florida', {}) === false);
  check('a missing trip object does not throw', c.tripLessonApplies_('always:*', undefined) === true);
}

console.log('\nTrait scope — the axis a lesson actually generalises over');
{
  const c = loadCtx(makeMemorySheet([]));

  // Guarded: when 'trait' is not a recognised scope the parser returns null, and a
  // bare .value turns an assertion failure into a crash that says nothing.
  const parsedTrait = c.parseTripLessonScope_('trait:beach');
  check('trait parses', !!parsedTrait && parsedTrait.value === 'beach', JSON.stringify(parsedTrait));
  check('…and is a recognised scope', c.TRIP_LESSON_SCOPES.indexOf('trait') !== -1);

  // THE case this whole change exists for, stated as a test.
  const floridaBeach = {
    destination: 'Orlando, Florida',
    context: 'Family Trip',
    activityTypes: { dining: true },     // nothing typed 'beach' — as it was
    traits: 'beach',
  };
  check('trait:beach FIRES for a beach trip with no beach itinerary row',
        c.tripLessonApplies_('trait:beach', floridaBeach) === true,
        'the Florida case: the hint missed it because nothing was typed beach');
  check('…while activity:beach still does NOT',
        c.tripLessonApplies_('activity:beach', floridaBeach) === false,
        'the two must stay distinct — "is a beach trip" vs "a beach is scheduled"');

  // And it generalises, which destination never did.
  const hawaii = { destination: 'Maui, Hawaii', context: 'Anniversary Trip', activityTypes: {}, traits: 'beach, resort' };
  check('the same lesson fires on a different beach trip',
        c.tripLessonApplies_('trait:beach', hawaii) === true,
        'this is what destination:florida could never do');
  check('destination:florida does NOT reach Hawaii',
        c.tripLessonApplies_('destination:florida', hawaii) === false,
        'which is exactly why it was the wrong axis');

  check('a multi-value list matches either value',
        c.tripLessonApplies_('trait:resort', hawaii) === true &&
        c.tripLessonApplies_('trait:beach', hawaii) === true);
  check('…and not a value it does not hold',
        c.tripLessonApplies_('trait:ski', hawaii) === false);

  check('a trip with NO characteristics matches no trait scope',
        c.tripLessonApplies_('trait:beach', { destination: 'Orlando', context: '', activityTypes: {}, traits: '' }) === false,
        'correct, but silent — which is why the blank is reported rather than inferred');
  check('…and a missing traits field behaves the same',
        c.tripLessonApplies_('trait:beach', { destination: 'Orlando' }) === false);

  check('whitespace and case in the stored list are tolerated',
        c.tripLessonApplies_('trait:city', { traits: ' Beach ,  CITY ' }) === true);
  check('an array is accepted as well as a string',
        c.tripLessonApplies_('trait:ski', { traits: ['ski', 'outdoors'] }) === true);
  check('trait does NOT fall back to activity types',
        c.tripLessonApplies_('trait:beach', { activityTypes: { beach: true }, traits: '' }) === false,
        'blurring them would re-admit the failure trait exists to fix');
}

console.log('\nReading lessons back, filtered by category');
{
  const sheet = makeMemorySheet([
    lessonRow('Pack a wide-brim hat and a refillable water bottle', 'destination:florida', 'Packing', 'Florida Trip'),
    lessonRow('Book dinner before 6pm',                             'context:family',      'Dining',  'Florida Trip'),
    lessonRow('Skip the aquarium',                                  'destination:florida', 'Activities', 'Florida Trip'),
    lessonRow('Bring the good camera',                              'always:*',            'Packing', 'Japan'),
    lessonRow('Leave 30 min earlier for ORD',                       'destination:chicago', 'Logistics', 'Chicago'),
    // Not a lesson at all — the log is shared with every other event type.
    ['MEM-9', '2026-02-02 09:00', 'trip_completed', 'Ahmed', 'Trip completed: Florida', '', 'Florida Trip', '', ''],
    // Also not a lesson, but carrying a Scope and Category that WOULD match. Rows
    // like this are what the Type check is actually for: the columns are on a
    // shared tab, so a future event type reusing them — or a stray hand edit in
    // the sheet — must not start injecting itself into packing prompts. Without
    // this row the Type check is unobservable, because nothing else ever fills
    // Scope and the scope match rejects every blank.
    ['MEM-10', '2026-02-03 09:00', 'trip_completed', 'Ahmed', 'Flew to Tampa', '', 'Florida Trip', 'always:*', 'Packing'],
  ]);
  const c = loadCtx(sheet);
  const florida = { destination: 'Orlando, Florida', context: 'Family', activityTypes: {} };

  const packing = c.getTripLessons_(florida, ['Packing']);
  check('packing lessons come back', packing.length === 2, JSON.stringify(packing.map(l => l.title)));
  check('…the destination-scoped one', packing.some(l => /wide-brim hat/.test(l.title)));
  check('…and the always-scoped one',  packing.some(l => /good camera/.test(l.title)));
  check('…but not the dining one',     !packing.some(l => /Book dinner/.test(l.title)));

  const dining = c.getTripLessons_(florida, ['Dining', 'Activities']);
  check('dining + activities come back together', dining.length === 2);
  check('…and exclude packing', !dining.some(l => /hat/.test(l.title)));

  check('a lesson for another destination never appears',
        !c.getTripLessons_(florida).some(l => /ORD/.test(l.title)));
  check('non-lesson rows are ignored',
        !c.getTripLessons_(florida).some(l => /Trip completed/.test(l.title)),
        'the Memory Log holds every event type; only trip_lesson rows are rules');
  check('…even one carrying a Scope and Category that would otherwise match',
        !packing.some(l => /Flew to Tampa/.test(l.title)) &&
        !c.getTripLessons_(florida).some(l => /Flew to Tampa/.test(l.title)),
        'Type is the gate; Scope alone must never be enough to get into a prompt');
  check('…and the real lesson count is unaffected by it', packing.length === 2);
  check('provenance survives', packing.some(l => l.trip === 'Florida Trip'));
}

console.log('\nThe prompt block');
{
  const sheet = makeMemorySheet([
    lessonRow('Pack a wide-brim hat and a refillable water bottle', 'destination:florida', 'Packing', 'Florida Trip'),
  ]);
  const c = loadCtx(sheet);
  const florida = { destination: 'Florida', context: 'Family', activityTypes: {} };

  const block = c.tripLessonsPromptBlock_(florida, ['Packing']);
  check('it names the section', /LESSONS FROM PAST TRIPS/.test(block));
  check('it carries the lesson', /wide-brim hat/.test(block));
  check('it says these are requirements', /requirements, not suggestions/.test(block));
  check('it cites the trip', /from Florida Trip/.test(block));

  const empty = c.tripLessonsPromptBlock_({ destination: 'Tokyo', context: '', activityTypes: {} }, ['Packing']);
  check('no matching lessons means NO block at all', empty === '',
        'an empty section is an invitation to invent one');
}

console.log('\nWriting a lesson');
{
  const sheet = makeMemorySheet([]);
  const c = loadCtx(sheet);

  const r = c.logTripLesson_('Pack a hat', 'Destination:Florida', 'packing', 'Florida Trip', '');
  check('it reports success', r.ok === true, JSON.stringify(r));
  check('the scope is normalised', r.scope === 'destination:florida', r.scope);
  check('the category is canonicalised', r.category === 'Packing', r.category);

  const row = sheet.appended[0];
  const at  = n => row[HEADERS.indexOf(n)];
  check('the row is typed trip_lesson', at('Type') === 'trip_lesson', at('Type'));
  check('the lesson is the Title',      at('Title') === 'Pack a hat');
  check('Scope lands in the Scope column',       at('Scope') === 'destination:florida', JSON.stringify(row));
  check('Category lands in the Category column', at('Category') === 'Packing');
  check('the trip is kept as provenance',        at('Context') === 'Florida Trip');

  const bad = c.logTripLesson_('Pack a hat', 'florida', 'Packing', 'Florida', '');
  check('a bad scope is rejected', bad.ok === false, JSON.stringify(bad));
  check('…with a reason naming the valid scopes', /destination/.test(bad.reason), bad.reason);
  check('…and nothing is written', sheet.appended.length === 1,
        'a silently-dropped lesson is how the next list forgets the hat again');

  const noText = c.logTripLesson_('   ', 'always:*', 'Packing', '', '');
  check('an empty lesson is rejected', noText.ok === false);

  const odd = c.logTripLesson_('Something', 'always:*', 'Nonsense', '', '');
  check('an unknown category falls back to Other', odd.ok === true && odd.category === 'Other', odd.category);
}

console.log('\nA sheet seeded before Scope and Category existed');
{
  // ensureSheet only writes headers into a BLANK sheet, so the live tab still has
  // the original seven columns. A fixed-length appendRow would scatter the values.
  const old = makeMemorySheet([], ['ID', 'Timestamp', 'Type', 'Who', 'Title', 'Detail', 'Context']);
  const c = loadCtx(old);

  const r = c.logTripLesson_('Pack a hat', 'always:*', 'Packing', 'Florida', '');
  check('the write still succeeds', r.ok === true);
  check('the two columns are added to the header',
        old.grid[0].indexOf('Scope') !== -1 && old.grid[0].indexOf('Category') !== -1,
        JSON.stringify(old.grid[0]));
  const row = old.appended[0];
  check('…and the values land under them',
        row[old.grid[0].indexOf('Scope')] === 'always:*' &&
        row[old.grid[0].indexOf('Category')] === 'Packing',
        JSON.stringify(row));
  check('…and it reads back', c.getTripLessons_({ destination: 'Anywhere' }, ['Packing']).length === 1);
}

console.log('\nLessons do not age out');
{
  const sheet = makeMemorySheet([
    lessonRow('Pack a hat', 'always:*', 'Packing', 'Florida', '2020-01-01 09:00'),
    ['MEM-2', '2020-01-01 09:00', 'trip_completed', 'Ahmed', 'Old trip', '', '', '', ''],
    ['MEM-3', '2026-09-01 09:00', 'trip_completed', 'Ahmed', 'Recent trip', '', '', '', ''],
  ]);
  const c = loadCtx(sheet, { cfg: { memory_log_retention_months: '12' } });
  c.pruneMemoryLog_();

  const titles = sheet.grid.slice(1).map(r => r[4]);
  check('the six-year-old event is pruned', titles.indexOf('Old trip') === -1, JSON.stringify(titles));
  check('the recent event survives',        titles.indexOf('Recent trip') !== -1);
  check('the six-year-old LESSON survives', titles.indexOf('Pack a hat') !== -1,
        'a lesson is a standing rule; deleting it on its first birthday undoes the point');
}

console.log('\nPruning costs a handful of calls, not one per row');
{
  // The assertion the regression would have failed. pruneMemoryLog_ used to make
  // TWO getValue() round-trips per row plus a deleteRow() per deleted row; on a
  // log of a few thousand rows that is thousands of calls inside nightlyRun, and
  // an execution that overruns its limit is TERMINATED — skipping the finally
  // that records the heartbeat, so the run reads as never having happened.
  const OLD = '2020-01-01 09:00';
  const NEW = '2026-09-01 09:00';
  const rows = [];
  for (let i = 0; i < 400; i++) {
    rows.push(['MEM-' + i, OLD, 'trip_completed', 'Ahmed', 'Old ' + i, '', '', '', '']);
  }
  rows.push(['MEM-L', OLD, 'trip_lesson', 'Both', 'Pack a hat', '', '', 'always:*', 'Packing']);
  for (let i = 0; i < 400; i++) {
    rows.push(['MEMN-' + i, OLD, 'trip_completed', 'Ahmed', 'Old b ' + i, '', '', '', '']);
  }
  rows.push(['MEM-R', NEW, 'trip_completed', 'Ahmed', 'Recent', '', '', '', '']);

  const sheet = makeMemorySheet(rows);
  const c = loadCtx(sheet, { cfg: { memory_log_retention_months: '12' } });
  c.pruneMemoryLog_();

  const titles = sheet.grid.slice(1).map(r => r[4]);
  check('all 800 expired rows are gone', titles.length === 2, titles.length);
  check('…the exempt lesson survives in the middle', titles.indexOf('Pack a hat') !== -1);
  check('…and the recent row survives', titles.indexOf('Recent') !== -1);

  // 801 rows, two contiguous runs of deletions separated by the lesson.
  check('it deletes in RUNS, not row by row',
        sheet.calls.deleteRows === 2 && sheet.calls.deleteRow === 0,
        'deleteRows=' + sheet.calls.deleteRows + ' deleteRow=' + sheet.calls.deleteRow);
  check('it never reads a cell at a time',
        sheet.calls.getValue === 0, 'getValue=' + sheet.calls.getValue);
  check('the whole prune is a handful of calls, not ~1600',
        sheet.calls.getRange < 20,
        'getRange=' + sheet.calls.getRange + ' for 801 rows — this is the number that killed the nightly run');
}

console.log('\nThe generators actually read it');
{
  const packing = extractFn(SRC.Web, 'webGeneratePacking_');
  const recs    = extractFn(SRC.Web, 'webGenerateRecommendations_');
  const pPrompt = extractFn(SRC.Web, 'buildPackingPrompt_');
  const rPrompt = extractFn(SRC.Web, 'buildRecsUserPrompt_');

  check('packing looks up lessons', /tripLessonsPromptBlock_\(/.test(packing));
  check('…filtered to Packing',     /\['Packing'\]/.test(packing));
  check('…passing the trip\'s destination, context and activity types',
        /destination: destination, context: context, activityTypes: activityTypes/.test(packing));
  check('…and hands the block to the builder', /packingLessons\s*\n?\s*\)/.test(packing) ||
        /packingLessons/.test(packing));
  check('…non-fatally',             /trip lessons unavailable \(non-fatal\)/.test(packing),
        'an unreadable Memory Log must not cost him the packing list');

  check('the packing prompt renders the block', /lessonsBlock \? lessonsBlock/.test(pPrompt));
  check('…above the RULES, not after them',
        pPrompt.indexOf('lessonsBlock ? lessonsBlock') < pPrompt.indexOf("'RULES:"),
        'a lesson exists because the generic rules already failed once');

  check('recommendations look up lessons', /tripLessonsPromptBlock_\(/.test(recs));
  check('…filtered to Dining + Activities', /\['Dining', 'Activities'\]/.test(recs));
  check('…and NOT to Packing',              !/\['Packing'\]/.test(recs),
        'what to pack says nothing about where to go');
  check('the recs prompt renders the block', /lessonsBlock \? lessonsBlock/.test(rPrompt));
  check('…before the search instruction',
        rPrompt.indexOf('lessonsBlock ? lessonsBlock') < rPrompt.indexOf('Search the web'),
        'what he rejected should shape the search, not be applied to its results');
}

console.log('\nTrip characteristics: the field a trait scope matches against');
{
  const set    = extractFn(SRC.Web, 'webSetTripMeta_');
  const get    = extractFn(SRC.Web, 'webGetTripMeta_');
  const norm   = extractFn(SRC.Web, 'normaliseTripCharacteristics_');
  const ensure = extractFn(SRC.Web, 'ensureTripMetaColumns_');

  check('the header carries Characteristics', /'Characteristics'/.test(SRC.Code));
  check('…as the 11th column', /'Luggage JSON', 'Characteristics'/.test(SRC.Code));
  check('the vocabulary is declared', /TRIP_CHARACTERISTICS\s*=/.test(SRC.Code));

  check('the writer guards it like every other field',
        /if \(p\.characteristics !== undefined\)/.test(set),
        'an omitted field must not wipe it — the bug this function already records');
  check('…writes column 11', /getRange\(rowNum, 11\)/.test(set));
  check('…and normalises on the way in', /normaliseTripCharacteristics_\(p\.characteristics\)/.test(set));
  check('the append row grew to match the header',
        /\(p\.characteristics \|\| ''\)\.trim\(\),/.test(set),
        'setValues sizes from TRIP_META_HEADERS.length and throws on a short row');
  check('the reader returns it', /characteristics: String\(data\[i\]\[10\]/.test(get));
  check('…and defaults it to blank when there is no row',
        (get.match(/characteristics: ''/g) || []).length >= 2);
  check('the tab self-heals its header', /TRIP_META_HEADERS\.forEach/.test(ensure));

  // Run the real normaliser.
  const ctx = { String, Array, Object, console };
  vm.createContext(ctx);
  vm.runInContext(extractDecl(SRC.Code, 'TRIP_CHARACTERISTICS') + '\n' + norm, ctx);
  check('it lowercases and trims', ctx.normaliseTripCharacteristics_(' Beach , CITY ') === 'beach, city');
  check('it de-duplicates',        ctx.normaliseTripCharacteristics_('beach,beach') === 'beach');
  check('it accepts an array',     ctx.normaliseTripCharacteristics_(['beach', 'ski']) === 'beach, ski');
  check('it DROPS a value outside the vocabulary',
        ctx.normaliseTripCharacteristics_('beach, jungle') === 'beach',
        'a characteristic nothing can match is indistinguishable from a typo');
  check('blank in, blank out', ctx.normaliseTripCharacteristics_('') === '' &&
                               ctx.normaliseTripCharacteristics_(null) === '');
}

console.log('\nSeeding characteristics from the briefing');
{
  const fn  = extractFn(SRC.Web, 'suggestTripCharacteristics_');
  const ctx = { String, Array, Object, RegExp, console };
  vm.createContext(ctx);
  vm.runInContext(extractDecl(SRC.Code, 'TRIP_CHARACTERISTICS') + '\n' + fn, ctx);
  const sug = (b, a) => ctx.suggestTripCharacteristics_(b, a || {});

  check('"beach week with the family" seeds beach',
        sug('beach week with the family').join() === 'beach',
        JSON.stringify(sug('beach week with the family')));
  check('"city break in Lisbon" seeds city', sug('city break in Lisbon').indexOf('city') !== -1);
  check('"skiing in March" seeds ski',       sug('skiing in March').indexOf('ski') !== -1);
  check('"all-inclusive in Cancun" seeds resort', sug('all-inclusive in Cancun').indexOf('resort') !== -1);

  check('"we\'re going to the shore" seeds NOTHING',
        sug("we're going to the shore").length === 0,
        'wrong only by omission — the field stays editable, and this is a suggestion');
  check('an empty briefing seeds nothing', sug('').length === 0 && sug(null).length === 0);

  check('a beach-typed itinerary row seeds beach on its own',
        sug('', { beach: true }).join() === 'beach');
  check('…and a cruise row seeds cruise', sug('', { cruise: true }).join() === 'cruise');

  check('the suggestion is ordered by the vocabulary, not by discovery',
        sug('city beach').join(',') === 'beach,city',
        JSON.stringify(sug('city beach')));

  // The guess that already failed, explicitly not reattempted.
  check('the trip LABEL is not an input', !/tripLabel|label/.test(fn),
        '"Florida Trip" does not say beach');
}

console.log('\nThe packing hints no longer depend on itinerary row types');
{
  const p = extractFn(SRC.Web, 'buildPackingPrompt_');
  check('the builder takes the trip characteristics', /lessonsBlock, traits\) \{/.test(p));
  check('…and turns them into a lookup', /function isTrip\(trait\)/.test(p));
  check('the beach hint fires on the characteristic', /isTrip\('beach'\) \|\| activityTypes\.beach/.test(p),
        'the Florida fix at its source: no beach-typed row needed');
  check('…and so do ski, cruise, outdoors and themepark',
        /isTrip\('ski'\)/.test(p) && /isTrip\('cruise'\)/.test(p) &&
        /isTrip\('outdoors'\)/.test(p) && /isTrip\('themepark'\)/.test(p),
        'they all had the identical weakness');
  check('the itinerary signal is kept, not replaced',
        /isTrip\('beach'\) \|\| activityTypes\.beach \|\| activityTypes\.snorkeling/.test(p),
        'a scheduled beach still counts even on an unmarked trip');

  const gen = extractFn(SRC.Web, 'webGeneratePacking_');
  check('packing loads the characteristics', /traits   = String\(metaResult\.characteristics/.test(gen));
  check('…passes them to the lesson matcher', /activityTypes: activityTypes, traits: traits/.test(gen));
  check('…and to the prompt builder', /packingLessons, traits/.test(gen));
  check('a blank field is REPORTED, not silently treated as "no"',
        /characteristicsMissing/.test(gen),
        'blank reads exactly like "not a beach trip" — that must be visible');
  check('…along with what the briefing suggests',
        /characteristicsSuggested/.test(gen) && /suggestTripCharacteristics_\(briefing, activityTypes\)/.test(gen));

  const recs = extractFn(SRC.Web, 'webGenerateRecommendations_');
  check('recommendations match on characteristics too', /traits: recTraits/.test(recs));
}

console.log('\nThe dashboard can set them');
{
  // index.html is GENERATED from app.js, and drift has shipped a dead feature
  // before: a change made only in app.js is invisible on the live dashboard.
  [['docs/app.js', SRC.App], ['docs/index.html', SRC.Index]].forEach(function(pair) {
    const label = pair[0], src = pair[1];
    check(label + ': has the characteristics chips', /TripCharacteristicsBlock/.test(src));
    check(label + ': offers the full vocabulary',
          /'beach','city','resort','ski','outdoors','roadtrip','cruise','themepark'/.test(src));
    check(label + ': saves through set_trip_meta', /action=set_trip_meta/.test(src));
    check(label + ': sends ONLY characteristics',
          /characteristics='\+encodeURIComponent/.test(src) &&
          !/action=set_trip_meta[^)]*context=/.test(src),
          'sending context or notes too would clear whichever it got wrong');
    check(label + ': says so when nothing is set',
          /not set, so beach\/ski lessons and hints won't fire/.test(src),
          'blank is the silent failure — it has to be visible in the UI too');
  });

  // The dashboard vocabulary and the server vocabulary have to agree, or a chip
  // writes a value normaliseTripCharacteristics_ then drops on the floor.
  const ui = /\['beach','city','resort','ski','outdoors','roadtrip','cruise','themepark'\]/.test(SRC.App);
  const srv = /\['beach', 'city', 'resort', 'ski', 'outdoors', 'roadtrip', 'cruise', 'themepark'\]/.test(SRC.Code);
  check('the UI and server vocabularies match', ui && srv, 'ui=' + ui + ' server=' + srv);
}

console.log('\nThe debrief captures it, and asks for the scope');
{
  check('the action is declared', /ACTION:log_trip_lesson\|\{category\}\|\{scope\}\|\{trip\}\|\{lesson\}/.test(SRC.Chat));
  check('…with the lesson LAST so it may contain a pipe',
        /everything after the third \| is the lesson/.test(SRC.Chat));
  check('the debrief asks question 6', /Was anything missing from the packing list/.test(SRC.Chat));
  check('…and is told to ASK for the scope, never guess',
        /the scope is the whole point and you must ASK, never guess/.test(SRC.Chat));
  check('…and warned about the activity-scope trap',
        /activity:beach will NOT fire/.test(SRC.Chat),
        'the exact failure that caused this feature');
  check('…and offers trait FIRST',
        /OFFER trait FIRST/.test(SRC.Chat),
        'destination over-fits: a hat lesson is about beach trips, not about Florida');
  check('…naming destination as the narrow fallback',
        /Destination is the narrow fallback/.test(SRC.Chat));
  check('…and warned about the trait trap too',
        /trait scope matches\s*\n?\s*'? ?\+? ?'?only trips MARKED with that characteristic/.test(SRC.Chat) ||
        /only trips MARKED with that characteristic/.test(SRC.Chat),
        'an unmarked trip reads exactly like "not a beach trip"');
  check('setting a trip\'s characteristics is an action',
        /ACTION:set_trip_characteristics/.test(SRC.Chat));
  check('…with a handler that preserves the other fields',
        /type === 'set_trip_characteristics'/.test(SRC.Chat) &&
        /characteristics: stcsTK\.rest\.join/.test(SRC.Chat));
  check('the handler exists', /type === 'log_trip_lesson'/.test(SRC.Chat));
  check('…and surfaces a rejected scope as an error',
        /errors\.push\('log_trip_lesson: '/.test(SRC.Chat));
}

console.log('\nThe beach hint names the two things that were missed');
{
  const p = extractFn(SRC.Web, 'buildPackingPrompt_');
  const hint = /Beach\/water activities:[^']*(?:'[\s\S]{0,80}')?/.exec(p);
  check('the beach hint mentions a sun hat', /sun hat/.test(p), hint && hint[0]);
  check('…and a refillable water bottle',    /refillable water bottle/.test(p));
  check('…while keeping what it already had', /reef-safe sunscreen/.test(p) && /dry bag/.test(p));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
