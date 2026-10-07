// buildMorningIntelligence_ must not redo the morning's own work.
//
// It reported 27.5s — 60% of a morning run, in a job the six-minute ceiling had already
// killed once. Most of that was a repeat. The function took NO arguments, so every
// dependency it needed it fetched for itself, ~150 lines after morningNudge had put the
// same data in a local variable:
//
//   getUpcomingEvents(7)   a second all-calendar 7-day scan        ~12.6s
//   getOpenTasks() × 2     the Tasks tab, twice more                ~2.6s
//   the weather forecast   a second geocode AND forecast              ~2s
//   getCapacityMode_()     four more PropertiesService gets
//   Packing Items          re-read in full ONCE PER TRIP
//   getSpreadsheet() × 8   eight openById for one document
//
// Everything here is asserted on COST as well as output, because an output-only test
// passes just as well on the slow version. The counters are the point.
//
// The hazard this file exists to catch: a "fix" that reintroduces the cost through a
// lazy fallback. `allEvents || getUpcomingEvents(7)` looks defensive and is not — it
// restores 12.6s on the one path where the budget has already said there is no time.
// See ctl_morningintel.js, where that exact mutation is the most important control.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const CODE  = fs.readFileSync(ROOT + '/Code.js', 'utf8');
const REM   = fs.readFileSync(ROOT + '/Reminders.js', 'utf8');
const WX    = fs.readFileSync(ROOT + '/Weather.js', 'utf8');

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

// Headers lifted from source, so a column added later cannot silently shift a fixture.
const hdr = n => eval(CODE.match(new RegExp('const ' + n + '\\s*=\\s*(\\[[^\\]]*\\])'))[1]);
const BILL_HEADERS    = hdr('BILL_HEADERS');
const COUPON_HEADERS  = hdr('COUPON_HEADERS');
const HOME_HEADERS    = hdr('HOME_ITEM_HEADERS');
const PACKING_HEADERS = hdr('PACKING_ITEM_HEADERS');

// Enough of Utilities.formatDate for the patterns this code path uses.
function formatDate(d, tz, pat) {
  const D = new Date(d);
  const p2 = n => String(n).padStart(2, '0');
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  if (pat === 'yyyy-MM')     return D.getFullYear() + '-' + p2(D.getMonth() + 1);
  if (pat === 'yyyy-MM-dd')  return D.getFullYear() + '-' + p2(D.getMonth() + 1) + '-' + p2(D.getDate());
  if (pat === 'EEEE')        return DAYS[D.getDay()];
  if (pat === 'h:mm a') {
    const h = D.getHours(), h12 = (h % 12) || 12;
    return h12 + ':' + p2(D.getMinutes()) + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  throw new Error('formatDate: unhandled pattern ' + pat);
}

// A sheet book that COUNTS. Every read is recorded, because "one read however many
// trips" is the property under test, not merely "the right number came out".
function makeBook(tabs, calls) {
  return {
    getSheetByName(name) {
      calls.getSheetByName.push(name);
      const rows = tabs[name];
      if (!rows) return null;
      return {
        getLastRow: () => rows.length + 1,          // +1 for the header row
        getRange(startRow, startCol, nRows, nCols) {
          return {
            getValues() {
              calls.getValues.push(name);
              return rows.slice(startRow - 2, startRow - 2 + nRows)
                         .map(r => r.slice(startCol - 1, startCol - 1 + nCols));
            },
          };
        },
      };
    },
  };
}

const DAY = 86400000;
// The REAL today, because buildMorningIntelligence_ calls new Date() itself and every
// block's arithmetic is against that. A hard-coded fixture date here would make the
// expected day counts drift by one every midnight.
const TODAY = new Date(); TODAY.setHours(6, 30, 0, 0);
const MIDNIGHT = new Date(TODAY); MIDNIGHT.setHours(0, 0, 0, 0);
const p2 = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const iso = (d, hhmm) => ymd(d) + ' ' + hhmm;
// A date N days from today, as yyyy-MM-dd.
const dayOffset = n => ymd(new Date(MIDNIGHT.getTime() + n * DAY));
// A day-of-month that reads as exactly N days out. Crossing a month boundary is fine:
// the block's own wraparound (+= days in month) lands on the same answer.
const dueDayIn = n => new Date(MIDNIGHT.getTime() + n * DAY).getDate();

// An event in the shape getUpcomingEvents returns.
function ev(daysUntil, title, startHHMM, endHHMM, isAllDay, location) {
  const d = new Date(TODAY.getTime() + daysUntil * DAY);
  return {
    title, daysUntil, isAllDay: !!isAllDay, location: location || '',
    start: iso(d, startHHMM || '09:00'), end: iso(d, endHHMM || '10:00'),
  };
}

const CLAUDE_OK = {
  sequence: [{ title: 'Standup', suggestedTime: '9:00 AM', note: 'Keep as scheduled' }],
  weekNote: null, taskSuggestions: null,
};

/**
 * The REAL buildMorningIntelligence_ and its whole day-sequencing subtree, in a vm.
 * opts lets each test decide what the dependencies do — and every one of them counts
 * its own calls, so a test can assert a dependency was never reached.
 */
function harness(opts) {
  opts = opts || {};
  const calls = {
    getSheetByName: [], getValues: [], getSpreadsheet: 0,
    getUpcomingEvents: 0, getOpenTasks: 0, getCapacityMode_: 0,
    readPTOConfig_: 0, fetchTracked_: 0,
  };
  const logs = [], prompts = [];
  const tabs = opts.tabs || {};

  const ctx = {
    console, Date, Math, String, Number, Boolean, Object, Array, JSON, isNaN, parseInt, parseFloat,
    RegExp, Error,
    Logger: { log: m => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate },
    PropertiesService: { getScriptProperties: () => ({ setProperty: () => {}, getProperty: () => null }) },
    TABS: { BILLS: 'Bills', COUPONS: 'Coupons', HOME_ITEMS: 'Home Items', PACKING_ITEMS: 'Packing Items' },
    BILL_HEADERS, COUPON_HEADERS, HOME_ITEM_HEADERS: HOME_HEADERS, PACKING_ITEM_HEADERS: PACKING_HEADERS,
    CLAUDE_API_URL: 'https://api.anthropic.com/v1/messages',
    CLAUDE_MODEL: 'claude-test',
    getApiKey: () => 'k',

    getSpreadsheet() {
      calls.getSpreadsheet++;
      if (opts.spreadsheetThrows) throw new Error('SHEET_ID not configured');
      return makeBook(tabs, calls);
    },
    getConfigValues: () => opts.config || {},
    getUpcomingEvents() {
      calls.getUpcomingEvents++;
      // Throws as well as counts. A counter alone is not enough: the day-sequencing
      // block swallows throws, so a counter-only test would pass green while the
      // section came out silently blank.
      throw new Error('re-scanned the calendar');
    },
    getOpenTasks() {
      calls.getOpenTasks++;
      if (opts.openTasksThrows) throw new Error('tasks boom');
      return opts.fallbackTasks || [];
    },
    getCapacityMode_() { calls.getCapacityMode_++; return { mode: 'light', source: 'default' }; },
    readPTOConfig_() {
      calls.readPTOConfig_++;
      if (opts.ptoThrows) throw new Error('Config tab not found');
      return {};
    },
    getUpcomingTravel_: () => opts.trips || [],
    getWeatherSummaryForPlanning_: () => opts.weather || '',
    fetchTracked_(src, url, params) {
      calls.fetchTracked_++;
      prompts.push(JSON.parse(params.payload).messages[0].content);
      const body = opts.claudeBody !== undefined ? opts.claudeBody : JSON.stringify(CLAUDE_OK);
      return {
        getResponseCode: () => (opts.claudeCode || 200),
        getContentText: () => JSON.stringify({ content: [{ text: body }] }),
      };
    },
    _calls: calls, _logs: logs, _prompts: prompts,
  };
  if (opts.override) opts.override(ctx, calls);

  vm.createContext(ctx);
  [extractFn(CODE, 'escapeHtml_'),
   extractFn(REM,  'findNextFreeWindow_'),
   extractFn(CODE, 'buildCalPlanHtml_'),
   extractFn(CODE, 'getDaySequencingAnalysis_'),
   extractFn(CODE, 'buildDaySequencingSection_'),
   extractFn(CODE, 'buildMorningIntelligence_')].forEach(src => vm.runInContext(src, ctx));
  return ctx;
}

// buildMorningIntelligence_ MUST NOT THROW, whatever fails inside it. nightlyStep_
// catches, but a throw blanks the entire section — every block has its own try for
// exactly that reason. So run() records a throw instead of propagating one, and
// c._threw is asserted wherever a dependency is made to fail.
const run = (c, allEvents, openTasks, capMode, subTimings) => {
  c.SUBS = subTimings || [];
  c._threw = null;
  try {
    return vm.runInContext('buildMorningIntelligence_(' +
      JSON.stringify(allEvents === undefined ? null : allEvents) + ',' +
      JSON.stringify(openTasks === undefined ? null : openTasks) + ',' +
      JSON.stringify(capMode === undefined ? null : capMode) + ',' +
      'SUBS)', c);
  } catch (e) {
    c._threw = e.message;
    return '';
  }
};

// Two timed events today, so the day plan clears its `< 2` guard.
const EVENTS = [
  ev(0, 'Standup',  '09:00', '09:30'),
  ev(0, 'Review',   '14:00', '15:00'),
  ev(0, 'Birthday', '00:00', '00:00', true),
  ev(1, 'Tomorrow A', '10:00', '11:00'),
  ev(2, 'Later',      '10:00', '11:00'),
];
const TASKS = [
  { task: 'File the thing', isOverdue: true,  daysUntilDue: -2 },
  { task: 'Mow the lawn',   isOverdue: false, daysUntilDue: 3 },
];

// ============================================================================
console.log('The calendar is never re-scanned');
{
  const c = harness();
  const out = run(c, EVENTS, TASKS, 'busy');

  check('getUpcomingEvents is not called at all', c._calls.getUpcomingEvents === 0,
        c._calls.getUpcomingEvents + ' call(s) — this was 12.6s, twenty times the ' +
        'duplicate the capacity ticker already fixed');
  check('…and the day plan still rendered', /Your Day, Sequenced/.test(out),
        'a counter at 0 with a blank section is the failure mode a counter alone misses');
  check('…from the injected array', c._prompts.length === 1 && /- Standup: 09:00/.test(c._prompts[0]),
        JSON.stringify(c._prompts[0] || '').slice(0, 200));
  check('…including the rest-of-week outlook the second scan used to supply',
        /REST OF WEEK OUTLOOK:/.test(c._prompts[0]) && /Friday: 1 event/.test(c._prompts[0]),
        'days 1-6 were exactly the part morningNudge threw away');
  check('…and the all-day event is excluded from today\'s timed list',
        !/Birthday/.test(c._prompts[0]));
  check('nothing was logged as a failure', !c._logs.some(l => /day sequencing/.test(l)),
        JSON.stringify(c._logs));
}

console.log('\nThe Tasks tab is never re-read');
{
  const c = harness();
  const out = run(c, EVENTS, TASKS, 'busy');

  check('getOpenTasks is not called at all', c._calls.getOpenTasks === 0,
        c._calls.getOpenTasks + ' call(s) — it was read three times in one run');
  check('…and the overdue row still rendered', /File the thing/.test(out) && /2 days overdue/.test(out),
        'the first consumer');
  check('…and the unscheduled task still reached the prompt',
        /UNSCHEDULED TASKS/.test(c._prompts[0]) && /- Mow the lawn/.test(c._prompts[0]),
        'the second consumer — both fed from one array');
  check('…and the overdue task is NOT offered as unscheduled',
        !/- File the thing/.test(c._prompts[0]),
        'the day-plan consumer filters isOverdue out');
}

console.log('\nCapacity mode is never re-read');
{
  const c = harness();
  run(c, EVENTS, TASKS, 'busy');
  check('getCapacityMode_ is not called', c._calls.getCapacityMode_ === 0,
        String(c._calls.getCapacityMode_));
  check('…and the injected value reached the prompt', /CAPACITY MODE: busy/.test(c._prompts[0]),
        'a vanished call proves nothing if the value did not arrive');

  // Standalone default preserved.
  const c2 = harness();
  run(c2, EVENTS, TASKS, null);
  check('…and a missing capMode still defaults to normal',
        /CAPACITY MODE: normal/.test(c2._prompts[0]));
}

console.log('\nOne packing read, however many trips');
{
  const ROME = dayOffset(4), CAIRO = dayOffset(7), OSLO = dayOffset(10);
  const trips = [
    { startDate: ROME,  label: 'Rome',  daysAway: 4 },
    { startDate: CAIRO, label: 'Cairo', daysAway: 7 },
    { startDate: OSLO,  label: 'Oslo',  daysAway: 10 },
  ];
  let pid = 0;
  const pk = (key, checked) => {
    const r = new Array(PACKING_HEADERS.length).fill('');
    r[0] = 'PI-' + (++pid); r[1] = key; r[4] = 'thing'; r[5] = checked;
    return r;
  };
  const c = harness({
    trips,
    tabs: { 'Packing Items': [
      pk(ROME + '|Rome', 'TRUE'), pk(ROME + '|Rome', 'true'), pk(ROME + '|Rome', 'FALSE'),
      pk(CAIRO + '|Cairo', 'yes'),
      pk('', 'TRUE'),                            // blank key — matched no trip before either
      pk('1999-01-01|Ghost', 'TRUE'),            // a key no trip claims
    ] },
  });
  const out = run(c, EVENTS, TASKS, 'busy');

  const packReads = c._calls.getValues.filter(t => t === 'Packing Items').length;
  check('three trips still make ONE Packing Items read', packReads === 1,
        packReads + ' read(s) — a full getValues of the whole tab per trip, to produce ' +
        'a count one pass already has');
  check('…and Rome counts 2 of 3', /Rome<\/strong>[\s\S]{0,120}?2\/3 packed/.test(out),
        'cheap is not enough; the bucketing has to be right');
  check('…and Cairo counts 1 of 1', /Cairo<\/strong>[\s\S]{0,120}?1\/1 packed/.test(out));
  check('…and Oslo, with no rows, reads as not started',
        /Oslo<\/strong>[\s\S]{0,120}?packing not started/.test(out),
        'a missing bucket must not become 0/0 packed');
}

console.log('\nOne spreadsheet handle for the four tabs');
{
  const bill = (name, dueDay, amt, paid) => {
    const r = new Array(BILL_HEADERS.length).fill('');
    r[0] = name; r[1] = amt; r[2] = dueDay; r[6] = paid || '';
    return r;
  };
  const coup = (store, offer, expires) => {
    const r = new Array(COUPON_HEADERS.length).fill('');
    r[1] = store; r[2] = offer; r[7] = expires;
    return r;
  };
  const home = (item, nextService, warranty) => {
    const r = new Array(HOME_HEADERS.length).fill('');
    r[0] = item; r[3] = warranty || ''; r[5] = nextService || '';
    return r;
  };
  const pkRow = (() => {
    const r = new Array(PACKING_HEADERS.length).fill('');
    r[0] = 'PI-1'; r[1] = dayOffset(4) + '|Rome'; r[4] = 'passport'; r[5] = 'TRUE';
    return r;
  })();
  const c = harness({
    trips: [{ startDate: dayOffset(4), label: 'Rome', daysAway: 4 }],
    tabs: {
      Bills:           [bill('Electric', dueDayIn(2), 120)],
      Coupons:         [coup('Target', '20% off', dayOffset(1))],
      'Home Items':    [home('Furnace filter', dayOffset(-2), dayOffset(24))],
      'Packing Items': [pkRow],
    },
  });
  const out = run(c, EVENTS, TASKS, 'busy');

  check('getSpreadsheet is called once, not four times', c._calls.getSpreadsheet === 1,
        c._calls.getSpreadsheet + ' call(s) — each one was a fresh SpreadsheetApp.openById');
  check('…and all four tabs were still read',
        ['Bills', 'Coupons', 'Home Items', 'Packing Items']
          .every(t => c._calls.getValues.indexOf(t) !== -1),
        JSON.stringify(c._calls.getValues));
  check('…bills still render', /Electric/.test(out) && /due in 2 days/.test(out));
  check('…coupons still render', /Target/.test(out) && /expires in 1 day/.test(out));
  check('…home service still renders', /Furnace filter/.test(out) && /2 days overdue/.test(out));
  check('…and the warranty line still renders', /warranty ends in 24 days/.test(out));
  check('…and the trip\'s packing count came from that one read',
        /Rome<\/strong>[\s\S]{0,120}?1\/1 packed/.test(out), out.slice(out.indexOf('Rome') - 60, out.indexOf('Rome') + 160));
}

console.log('\nThe handle is lazy, so one failure costs only its own blocks');
{
  const c = harness({ spreadsheetThrows: true });
  const out = run(c, EVENTS, TASKS, 'busy');

  check('an unreachable spreadsheet does not throw out of the function',
        c._threw === null, c._threw +
        ' — an eager `var ss = getSpreadsheet()` at the top sits outside every block\'s ' +
        'try, so it would take the whole section with it');
  check('the day plan still renders when the spreadsheet is unreachable',
        /Your Day, Sequenced/.test(out),
        'an eager var ss = getSpreadsheet() at the top would throw past every block');
  check('…and so does the overdue task row', /File the thing/.test(out));
  check('…and each sheet block logged its own failure',
        ['bills', 'coupons', 'home', 'travel']
          .every(b => c._logs.some(l => l.indexOf('buildMorningIntelligence_: ' + b + ' — ') === 0)),
        JSON.stringify(c._logs));
  // The travel block must be in that list. The packing read sits inside its own
  // try/catch, so resolving the handle THERE would swallow a SHEET_ID failure and
  // render a Travel section claiming no trip has started packing — which is a
  // different statement from "we could not read the tab".
  check('…and the Travel section is dropped, not rendered as "not started"',
        !/🧳 Travel/.test(out), out.slice(0, 200));
}

// ============================================================================
console.log('\nA skipped calendar phase drops the day plan — it does not re-scan');
{
  // allEvents === null is what morningNudge leaves behind when the budget skipped its
  // calendar phase. Making the scan HERE is the exact cost the budget just refused,
  // on the block that runs latest with the least time left.
  const c = harness();
  const out = run(c, null, TASKS, 'busy');

  check('the calendar is still not scanned', c._calls.getUpcomingEvents === 0,
        c._calls.getUpcomingEvents + ' — `allEvents || getUpcomingEvents(7)` is the trap');
  check('…no Claude call was made either', c._calls.fetchTracked_ === 0);
  check('…the day plan is absent', !/Your Day, Sequenced/.test(out));
  check('…and nothing was logged as an error', !c._logs.length, JSON.stringify(c._logs));
  check('…while the other sections still render', /File the thing/.test(out),
        'one missing section, not a missing email');
}

console.log('\nThe cheap fallbacks still work when their phase was skipped');
{
  const c = harness({ fallbackTasks: TASKS });
  const out = run(c, EVENTS, null, 'busy');

  check('openTasks === null falls back to one sheet read', c._calls.getOpenTasks === 2,
        c._calls.getOpenTasks + ' — one per consumer, and only on a path where the ' +
        'phase was already skipped; bounded, unlike a calendar re-scan');
  check('…and both sections still render',
        /File the thing/.test(out) && /- Mow the lawn/.test(c._prompts[0]));
}

// ============================================================================
console.log('\nEvery block still degrades on its own');
{
  const blocks = {
    tasks:   { openTasksThrows: true, args: [EVENTS, null, 'busy'] },
    travel:  { ptoThrows: true,       args: [EVENTS, TASKS, 'busy'] },
  };
  Object.keys(blocks).forEach(name => {
    const o = blocks[name];
    const c = harness(o);
    const out = run(c, o.args[0], o.args[1], o.args[2]);
    check('  a failing ' + name + ' block does not throw out of the function',
          c._threw === null, c._threw + ' — sub_ must keep a catch, not just a finally');
    check('  a failing ' + name + ' block logs its own exact message',
          c._logs.some(l => l.indexOf('buildMorningIntelligence_: ' + name + ' — ') === 0),
          JSON.stringify(c._logs));
    check('  …and the day plan still renders', /Your Day, Sequenced/.test(out));
  });

  // The gated block keeps its original, differently-worded message.
  const c = harness({ claudeCode: 500 });
  run(c, EVENTS, TASKS, 'busy');
  check('the day-sequencing block still logs "day sequencing (non-fatal)"',
        c._logs.some(l => /getDaySequencingAnalysis_: Claude returned 500/.test(l)),
        JSON.stringify(c._logs));

  const c2 = harness({ claudeBody: 'not json' });
  const out2 = run(c2, EVENTS, TASKS, 'busy');
  check('…and a malformed analysis is caught under the original label',
        c2._logs.some(l => l.indexOf('buildMorningIntelligence_: day sequencing (non-fatal) — ') === 0),
        JSON.stringify(c2._logs));
  check('…leaving the rest of the section intact', /File the thing/.test(out2));
}

console.log('\nNothing to say still says nothing');
{
  const c = harness({ claudeCode: 500 });
  const out = run(c, EVENTS, [], 'busy');
  check('all four buckets empty returns the empty string', out === '', JSON.stringify(out).slice(0, 120));
}

console.log('\nThe day plan is gated off by config, as before');
{
  const c = harness({ config: { day_sequencing_enabled: 'false' } });
  const out = run(c, EVENTS, TASKS, 'busy');
  check('no Claude call when day_sequencing_enabled is false', c._calls.fetchTracked_ === 0);
  check('…and no section', !/Your Day, Sequenced/.test(out));
  check('…but the rest still renders', /File the thing/.test(out));
}

// ============================================================================
console.log('\nEvery block reports a timing');
{
  const c = harness({ trips: [], tabs: {} });
  const subs = [];
  run(c, EVENTS, TASKS, 'busy', subs);
  check('the run completed without throwing', c._threw === null, c._threw);

  const names = subs.map(s => s.name);
  check('all six blocks are timed',
        JSON.stringify(names) === JSON.stringify(['tasks', 'bills', 'coupons', 'home', 'travel', 'daySeq']),
        JSON.stringify(names) + ' — a breakdown that hides a block is not a breakdown');
  check('…each with a numeric ms', subs.every(s => typeof s.ms === 'number' && s.ms >= 0),
        JSON.stringify(subs));
}

console.log('\nThe sub-timer is not nightlyStep_');
{
  // Counted from the AST, not the text. A text scan found both of these — in the
  // COMMENT inside the function explaining why they are not used. That is the eighth
  // time a check in this repo has matched prose about the thing instead of the thing;
  // see test_heartbeats.js and test_morningnudge.js for the others.
  const parser = require('@babel/standalone').packages.parser;
  const fnAst = (() => {
    const ast = parser.parse(CODE, { sourceType: 'script' });
    for (const st of ast.program.body) {
      if (st.type === 'FunctionDeclaration' && st.id && st.id.name === 'buildMorningIntelligence_') return st;
    }
    return null;
  })();
  check('buildMorningIntelligence_ parses', !!fnAst);

  let stepCalls = 0, ctxTimings = 0, subCalls = 0;
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'CallExpression' && n.callee && n.callee.type === 'Identifier') {
      if (n.callee.name === 'nightlyStep_') stepCalls++;
      if (n.callee.name === 'sub_')         subCalls++;
    }
    if (n.type === 'MemberExpression' && n.object && n.object.type === 'Identifier' &&
        n.object.name === 'ctx' && n.property && n.property.name === 'timings') ctxTimings++;
    Object.keys(n).forEach(k => { if (k !== 'loc') walk(n[k]); });
  })(fnAst);

  check('no block goes through nightlyStep_', stepCalls === 0,
        stepCalls + ' call(s) — six more Script Property writes, and its budget guard ' +
        'would start SKIPPING blocks: error-driven degradation becoming time-driven');
  check('…and nothing touches ctx.timings', ctxTimings === 0,
        ctxTimings + ' — slowestNightlySteps_ would report these as phases and ' +
        'double-count their ms inside this function\'s own total');
  check('…and all six blocks go through sub_ instead', subCalls === 6, String(subCalls));
  check('the breakdown shares the phase line\'s formatter',
        /slowestNightlySteps_\(intelSubTimings, 6\)/.test(CODE),
        'so the two lines can never drift apart');
}

// ============================================================================
console.log('\nOne forecast per location per execution');
{
  // The real fetchWeatherForecast_, driven twice for the same city and once for another.
  const calls = { geocode: 0, forecast: 0 };
  const ctx = {
    console, JSON, Date, Math, String, Number, Object, Array, RegExp, encodeURIComponent,
    Logger: { log: () => {} },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    recordApiHealth_: () => {},
    fetchWithHealth_(src, url) {
      if (/geo\/1\.0\/direct/.test(url)) {
        calls.geocode++;
        return { getContentText: () => JSON.stringify([{ lat: 1, lon: 2 }]) };
      }
      calls.forecast++;
      return { getContentText: () => JSON.stringify({ list: [], city: { timezone: 0 } }) };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(/^var _weatherForecastCache_\s*=.*?;/m.exec(WX)[0], ctx);
  vm.runInContext(extractFn(WX, 'geocodeLocation_'), ctx);
  vm.runInContext(extractFn(WX, 'fetchWeatherForecast_'), ctx);

  vm.runInContext("fetchWeatherForecast_('Fairfax,VA', 'k')", ctx);
  vm.runInContext("fetchWeatherForecast_('Fairfax,VA', 'k')", ctx);
  check('the same city is fetched once, not twice', calls.forecast === 1 && calls.geocode === 1,
        JSON.stringify(calls) + ' — the ticker and the day plan each paid for this');

  vm.runInContext("fetchWeatherForecast_('Rome,IT', 'k')", ctx);
  check('…and a different city is still fetched', calls.forecast === 2,
        JSON.stringify(calls) + ' — on a trip day the ticker wants the trip city while ' +
        'the day plan wants home, so a one-slot cache would cross them');
}

console.log('\nA failed forecast is retried, not memoised as a failure');
{
  let n = 0;
  const ctx = {
    console, JSON, Date, Math, String, Number, Object, Array, RegExp, encodeURIComponent,
    Logger: { log: () => {} },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    recordApiHealth_: () => {},
    fetchWithHealth_(src, url) {
      if (/geo\/1\.0\/direct/.test(url)) {
        return { getContentText: () => JSON.stringify([{ lat: 1, lon: 2 }]) };
      }
      n++;
      return n === 1 ? null
                     : { getContentText: () => JSON.stringify({ list: [], city: { timezone: 0 } }) };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(/^var _weatherForecastCache_\s*=.*?;/m.exec(WX)[0], ctx);
  vm.runInContext(extractFn(WX, 'geocodeLocation_'), ctx);
  vm.runInContext(extractFn(WX, 'fetchWeatherForecast_'), ctx);

  check('the first call fails', vm.runInContext("fetchWeatherForecast_('Home', 'k')", ctx) === null);
  check('…and the second succeeds rather than returning a cached null',
        !!vm.runInContext("fetchWeatherForecast_('Home', 'k')", ctx),
        'caching a null would turn one transient OWM failure into no weather for the ' +
        'rest of the execution');
}

console.log('\nThe geocode is cached across executions, successes only');
{
  const store = {};
  let geocodes = 0;
  const mk = () => {
    const ctx = {
      console, JSON, Date, Math, String, Number, Object, Array, RegExp, encodeURIComponent,
      Logger: { log: () => {} },
      CacheService: { getScriptCache: () => ({
        get: k => (k in store ? store[k] : null),
        put: (k, v) => { store[k] = v; },
      }) },
      recordApiHealth_: () => {},
      fetchWithHealth_(src, url) {
        if (/geo\/1\.0\/direct/.test(url)) {
          geocodes++;
          return { getContentText: () => JSON.stringify([{ lat: 1, lon: 2 }]) };
        }
        return { getContentText: () => JSON.stringify({ list: [], city: { timezone: 0 } }) };
      },
    };
    vm.createContext(ctx);
    vm.runInContext(/^var _weatherForecastCache_\s*=.*?;/m.exec(WX)[0], ctx);
    vm.runInContext(extractFn(WX, 'geocodeLocation_'), ctx);
    vm.runInContext(extractFn(WX, 'fetchWeatherForecast_'), ctx);
    return ctx;
  };

  // Two separate executions — a fresh global scope each time, as GAS gives.
  vm.runInContext("fetchWeatherForecast_('Fairfax,VA', 'k')", mk());
  vm.runInContext("fetchWeatherForecast_('Fairfax,VA', 'k')", mk());
  check('a second execution reuses the cached coordinates', geocodes === 1,
        geocodes + ' geocode(s) across two executions');
  check('…under a 6h TTL', /21600/.test(extractFn(WX, 'geocodeLocation_')),
        'coordinates do not change');

  // Behavioural, not a source scan: drive a geocode that finds nothing and prove the
  // cache was left empty. A cached null would blind weather for six hours off one
  // transient failure, and suppress the health failure that banners the source.
  const emptyStore = {};
  let healthFailures = 0, geoAttempts = 0;
  const mkFailing = () => {
    const ctx = {
      console, JSON, Date, Math, String, Number, Object, Array, RegExp, encodeURIComponent,
      Logger: { log: () => {} },
      CacheService: { getScriptCache: () => ({
        get: k => (k in emptyStore ? emptyStore[k] : null),
        put: (k, v) => { emptyStore[k] = v; },
      }) },
      recordApiHealth_: (s, ok) => { if (!ok) healthFailures++; },
      fetchWithHealth_: () => {
        geoAttempts++;
        return { getContentText: () => JSON.stringify([]) };   // no results
      },
    };
    vm.createContext(ctx);
    vm.runInContext(extractFn(WX, 'geocodeLocation_'), ctx);
    return ctx;
  };
  check('a geocode that finds nothing returns null',
        vm.runInContext("geocodeLocation_('Nowhere,ZZ', 'k')", mkFailing()) === null);
  check('…and wrote nothing to the cache', Object.keys(emptyStore).length === 0,
        JSON.stringify(emptyStore));
  const attemptsAfterFirst = geoAttempts;
  vm.runInContext("geocodeLocation_('Nowhere,ZZ', 'k')", mkFailing());
  check('…so a later execution tries again instead of reading a cached failure',
        geoAttempts > attemptsAfterFirst, geoAttempts + ' vs ' + attemptsAfterFirst);
  check('…and the health failure is still recorded both times', healthFailures === 2,
        String(healthFailures) + ' — a cached null would have suppressed the second');
}

// ============================================================================
console.log('\nThe Config tab is read once per execution');
{
  let dataRangeReads = 0;
  const rows = [['pto_vacation_days', '20'], ['pto_buffer_remaining', '2']];
  const PTO = fs.readFileSync(ROOT + '/PTO.js', 'utf8');
  const ctx = {
    console, Date, Math, String, Number, parseInt, parseFloat, isNaN, JSON, Object, Array, Error,
    Logger: { log: () => {} },
    TABS: { CONFIG: 'Config' },
    getSpreadsheet: () => ({ getSheetByName: () => ({
      getDataRange: () => ({ getValues: () => { dataRangeReads++; return rows; } }),
    }) }),
  };
  vm.createContext(ctx);
  vm.runInContext(/^var _ptoConfigRows_\s*=.*?;/m.exec(PTO)[0], ctx);
  vm.runInContext(extractFn(PTO, 'invalidatePTOConfigRows_'), ctx);
  vm.runInContext(extractFn(PTO, 'readPTOConfigRows_'), ctx);
  vm.runInContext(/^var PTO_DEFAULT_ACCRUAL_DAY_ = \d+;/m.exec(PTO)[0], ctx);
  vm.runInContext(extractFn(PTO, 'readPTOConfig_'), ctx);
  vm.runInContext(extractFn(PTO, 'readPTOBufferRemaining_'), ctx);

  vm.runInContext('readPTOConfig_()', ctx);
  vm.runInContext('readPTOConfig_()', ctx);
  vm.runInContext('readPTOBufferRemaining_({ bufferDays: 3 })', ctx);
  check('three readers make one full-range read', dataRangeReads === 1,
        dataRangeReads + ' read(s) — the morning run read the whole Config range three times');

  check('…and each caller still gets its OWN object',
        vm.runInContext('readPTOConfig_() !== readPTOConfig_()', ctx),
        'the object holds arrays; sharing it would let one caller corrupt another');
  check('…whose arrays are separate too',
        vm.runInContext('readPTOConfig_().milestoneKeywords !== readPTOConfig_().milestoneKeywords', ctx),
        'the hazard _upcomingTravelCache_\'s .slice() exists to prevent');

  vm.runInContext('invalidatePTOConfigRows_()', ctx);
  vm.runInContext('readPTOConfig_()', ctx);
  check('invalidation forces a fresh read', dataRangeReads === 2, String(dataRangeReads));

  // And the writers actually call it. A memo nobody busts is a stale read waiting to
  // happen: the dashboard's Config editor writes, then something reads the old rows.
  {
    let writes = 0, reads = 0;
    const wctx = {
      console, Date, Math, String, Number, parseInt, parseFloat, isNaN, JSON, Object, Array, Error,
      Logger: { log: () => {} }, TABS: { CONFIG: 'Config' },
      getSpreadsheet: () => ({ getSheetByName: () => ({
        getDataRange: () => ({ getValues: () => { reads++; return [['pto_buffer_remaining', 2]]; } }),
        getLastRow: () => 1,
        getRange: () => ({ setValue: () => { writes++; }, setValues: () => { writes++; } }),
      }) }),
    };
    vm.createContext(wctx);
    vm.runInContext(/^var _ptoConfigRows_\s*=.*?;/m.exec(PTO)[0], wctx);
    vm.runInContext(extractFn(PTO, 'invalidatePTOConfigRows_'), wctx);
    vm.runInContext(extractFn(PTO, 'readPTOConfigRows_'), wctx);
    vm.runInContext(extractFn(PTO, 'setPTOBufferRemaining_'), wctx);

    vm.runInContext('readPTOConfigRows_()', wctx);          // warms the memo
    const afterWarm = reads;
    vm.runInContext('setPTOBufferRemaining_(1)', wctx);     // writes, must invalidate
    vm.runInContext('readPTOConfigRows_()', wctx);          // must go to the sheet again
    check('a Config writer busts the row memo', writes === 1 && reads > afterWarm + 1,
          'writes=' + writes + ' reads=' + reads + ' (warm at ' + afterWarm + ')' +
          ' — the writer reads directly too, so the second read must be a THIRD read');
  }

  // The throw the 40-odd callers depend on, preserved.
  const ctx2 = {
    console, Date, Math, String, Number, parseInt, parseFloat, isNaN, JSON, Object, Array, Error,
    Logger: { log: () => {} }, TABS: { CONFIG: 'Config' },
    getSpreadsheet: () => ({ getSheetByName: () => null }),
  };
  vm.createContext(ctx2);
  vm.runInContext(/^var _ptoConfigRows_\s*=.*?;/m.exec(PTO)[0], ctx2);
  vm.runInContext(extractFn(PTO, 'readPTOConfigRows_'), ctx2);
  vm.runInContext(/^var PTO_DEFAULT_ACCRUAL_DAY_ = \d+;/m.exec(PTO)[0], ctx2);
  vm.runInContext(extractFn(PTO, 'readPTOConfig_'), ctx2);
  vm.runInContext(extractFn(PTO, 'readPTOBufferRemaining_'), ctx2);
  let threw = '';
  try { vm.runInContext('readPTOConfig_()', ctx2); } catch (e) { threw = e.message; }
  check('a missing Config tab still throws the same message', threw === 'Config tab not found', threw);
  // readPTOConfigRows_ throws where this reader used to return its fallback, so the
  // try/catch around it is load-bearing — assert the fallback, not a propagated error.
  let bufOut = 'threw', bufErr = '';
  try { bufOut = vm.runInContext('readPTOBufferRemaining_({ bufferDays: 7 })', ctx2); }
  catch (e) { bufErr = e.message; }
  check('…while the buffer reader still returns its fallback instead of throwing',
        bufOut === 7, bufErr || JSON.stringify(bufOut));
}

// ============================================================================
console.log('\nThe spreadsheet handle is memoised per execution');
{
  let opens = 0;
  const ctx = {
    console, Error,
    CONFIG: { SHEET_ID: 'abc' },
    SpreadsheetApp: { openById: () => { opens++; return { id: 'handle' }; } },
  };
  vm.createContext(ctx);
  vm.runInContext(/^var _spreadsheet_\s*=.*?;/m.exec(CODE)[0], ctx);
  vm.runInContext(extractFn(CODE, 'invalidateSpreadsheet_'), ctx);
  vm.runInContext(extractFn(CODE, 'getSpreadsheet'), ctx);

  vm.runInContext('getSpreadsheet(); getSpreadsheet(); getSpreadsheet();', ctx);
  check('three calls open the document once', opens === 1,
        opens + ' openById call(s) across ~320 call sites repo-wide');
  check('…and hand back the same handle',
        vm.runInContext('getSpreadsheet() === getSpreadsheet()', ctx),
        'which is what makes every creator and reader in a run agree');

  vm.runInContext('invalidateSpreadsheet_()', ctx);
  vm.runInContext('getSpreadsheet()', ctx);
  check('the escape hatch forces a reopen', opens === 2, String(opens));

  // An unconfigured sheet must still throw, and must not poison the memo.
  const ctx2 = {
    console, Error, CONFIG: { SHEET_ID: 'YOUR_SHEET_ID_HERE' },
    SpreadsheetApp: { openById: () => ({}) },
  };
  vm.createContext(ctx2);
  vm.runInContext(/^var _spreadsheet_\s*=.*?;/m.exec(CODE)[0], ctx2);
  vm.runInContext(extractFn(CODE, 'getSpreadsheet'), ctx2);
  let msg = '';
  try { vm.runInContext('getSpreadsheet()', ctx2); } catch (e) { msg = e.message; }
  check('an unconfigured SHEET_ID still throws before the memo',
        /SHEET_ID not configured/.test(msg), msg);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
