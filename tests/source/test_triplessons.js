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
  const sheet = {
    grid, appended,
    getLastRow:    () => grid.length,
    getLastColumn: () => grid[0].length,
    appendRow: r => { grid.push(r.slice()); appended.push(r.slice()); },
    getRange: (r, c, nR, nC) => ({
      getValue:  () => (grid[r - 1] || [])[c - 1],
      setValue:  v => { while (grid[r - 1].length < c) grid[r - 1].push(''); grid[r - 1][c - 1] = v; },
      getValues: () => {
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
    deleteRow: i => { grid.splice(i - 1, 1); },
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
    extractFn(SRC.Mem, 'tripLessonApplies_'),
    extractFn(SRC.Mem, 'getTripLessons_'),
    extractFn(SRC.Mem, 'tripLessonsPromptBlock_'),
    extractFn(SRC.Mem, 'logTripLesson_'),
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

console.log('\nThe debrief captures it, and asks for the scope');
{
  check('the action is declared', /ACTION:log_trip_lesson\|\{category\}\|\{scope\}\|\{trip\}\|\{lesson\}/.test(SRC.Chat));
  check('…with the lesson LAST so it may contain a pipe',
        /everything after the third \| is the lesson/.test(SRC.Chat));
  check('the debrief asks question 6', /Was anything missing from the packing list/.test(SRC.Chat));
  check('…and is told to ASK for the scope, never guess',
        /the scope is the whole point and you must ASK, never guess/.test(SRC.Chat));
  check('…and warned about the activity-scope trap',
        /scoped activity:beach will NOT fire/.test(SRC.Chat),
        'the exact failure that caused this feature');
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
