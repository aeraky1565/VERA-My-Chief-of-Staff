// testWeekendMemo() — generate the weekend memo without sending it.
//
// A dry run is only worth anything if it takes the SAME path the scheduled send
// takes, so this runs the real runWeekendPlanner_ with every side-effecting
// function replaced by a recorder, and asserts what it would have done.
//
// The guard that matters most is writePlannerHistory_. It records the memo as
// anti-repeat context for future weeks, so a dry run that wrote it would make
// Wednesday's real memo avoid suggestions it had never actually made — a dry
// run with a lasting consequence is not a dry run, and its absence would be
// invisible until next week's output was quietly wrong.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const WP = fs.readFileSync(ROOT + '/WeekendPlanner.js', 'utf8');

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

// Every side effect the planner can have, plus the work it must still do.
const SIDE_EFFECTS = ['createWeekendMemoEvent_', 'sendVeraEmail_', 'sendSlack_',
                      'markSent_', 'writePlannerHistory_'];
const REAL_WORK    = ['callClaudeWeekendPlanner_', 'getWeekendWeather_', 'searchLocalEvents_'];

function runPlanner(opts, o) {
  o = o || {};
  const calls = {};
  const logs  = [];
  const rec = name => (...args) => { (calls[name] = calls[name] || []).push(args); return null; };

  const ctx = {
    String, Array, Number, JSON, Math, parseInt, parseFloat, isNaN, Error, Object, Date, RegExp, Boolean,
    Logger: { log: m => logs.push(String(m)) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (dt, tz, f) => dt.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'KEY' }) },
    CONFIG: { MORNING_NUDGE_EMAIL: 'a@b.c' },
    TABS: { ITINERARY: 'Itinerary' },
    ITINERARY_HEADERS: new Array(10).fill('x'),
    getSpreadsheet: () => ({ getSheetByName: () => null }),
    getConfigValues: () => ({ weekend_planner_home_city: 'Fairfax, VA' }),

    // Gathering — enough to reach the delivery block.
    readPTOConfig_: () => ({}), getGapCalendars_: () => [],
    getWeekendWindows_: () => [{ weekendStart: '2026-10-10' }],
    getUpcomingEvents: () => [], filterToNarrativeCalendars_: () => [],
    getOpenTasks: () => [], readActiveFlagsForPlanner_: () => [],
    computeIntensitySignal_: () => ({ level: 'normal' }),
    getGoals_: () => [], getSharedInterestLedger_: () => [],
    getPTOEvents_: () => ({}), computePTOStats_: () => ({}),
    getTravelContextForPlanner_: () => ({ allTrips: [], upcomingTrips: [], currentTrip: null }),
    readPlannerHistory_: () => [],
    getWeekendCalendarEvents_: () => [], classifyWeekend_: () => ({ type: 'open', eventCount: 0, note: '' }),
    getHouseGuestStayDetail_: () => null,
    getWeekendLocationPlan_: () => ({ sat: { away: false, city: 'Fairfax, VA', geocoded: true, date: '2026-10-10' },
                                      sun: { away: false, city: 'Fairfax, VA', geocoded: true, date: '2026-10-11' },
                                      anyAway: false, unknownDestination: false,
                                      // carried so weather can fall back to it; the
                                      // planner also reads homeUnknown when logging
                                      home: { city: 'Fairfax, VA', coords: { lat: 38.8, lon: -77.3 }, geocoded: true },
                                      homeUnknown: false }),
    eventSearchCityFor_: () => 'Fairfax, VA',
    describeWeekendLocation_: () => '',
    getCarryForwardNote_: () => null, getRadarDatesForWeekendMemo_: () => [],
    buildWeekendPlannerPrompt_: () => 'THE PROMPT BODY',
    assembleWeekendMemoText_: () => 'THE ASSEMBLED MEMO',
    buildWeekendMemoHtml_: () => '<html>',
    parseDateStr_: () => new Date('2026-10-10T00:00:00Z'),
    computeNextSaturday_: () => new Date('2026-10-10T00:00:00Z'),
    isSlackConfigured_: () => true,
    veraLog_: rec('veraLog_'),

    // The cooldown. Default true — the state that makes a dry run necessary.
    wasRecentlySent_: (...a) => { (calls.wasRecentlySent_ = calls.wasRecentlySent_ || []).push(a);
                                  return o.cooldownActive !== false; },
  };
  SIDE_EFFECTS.forEach(n => { ctx[n] = rec(n); });
  ctx.callClaudeWeekendPlanner_ = (...a) => {
    (calls.callClaudeWeekendPlanner_ = calls.callClaudeWeekendPlanner_ || []).push(a);
    return { memo: 'THE MEMO', activities: [{ title: 'x' }], localEvents: [] };
  };
  ctx.getWeekendWeather_ = rec('getWeekendWeather_');   // null weather is a real, handled case
  // Must return an ARRAY — the planner reads .length off it straight away.
  ctx.searchLocalEvents_ = (...a) => {
    (calls.searchLocalEvents_ = calls.searchLocalEvents_ || []).push(a);
    return [];
  };

  vm.createContext(ctx);
  vm.runInContext(extractFn(WP, 'runWeekendPlanner_') + '\n' + extractFn(WP, 'testWeekendMemo'), ctx);
  ctx.__opts = opts;
  vm.runInContext(opts === undefined ? 'runWeekendPlanner_()' : 'runWeekendPlanner_(__opts)', ctx);
  return { calls, logs: logs.join('\n'), n: name => (calls[name] || []).length };
}

// ============ the dry run ===================================================

console.log('\na dry run sends nothing');
{
  const r = runPlanner({ dryRun: true });
  SIDE_EFFECTS.forEach(name => {
    check('no ' + name, r.n(name) === 0, r.n(name) + ' call(s)');
  });
}

console.log('\n…and runs anyway, with the cooldown active');
{
  // The whole reason it exists: this week's memo has already been sent.
  const r = runPlanner({ dryRun: true }, { cooldownActive: true });
  check('the cooldown is not even consulted', r.n('wasRecentlySent_') === 0, r.n('wasRecentlySent_'));
  check('it reached Claude', r.n('callClaudeWeekendPlanner_') === 1, r.n('callClaudeWeekendPlanner_'));
  check('…rather than returning early', !/already sent recently/.test(r.logs));
}

console.log('\n…while still doing the real work');
{
  const r = runPlanner({ dryRun: true });
  REAL_WORK.forEach(name => {
    check(name + ' still runs', r.n(name) === 1, r.n(name) + ' call(s)');
  });
  check('a dry run still costs exactly one Claude call', r.n('callClaudeWeekendPlanner_') === 1);
}

console.log('\n…and shows its work');
{
  const r = runPlanner({ dryRun: true });
  check('the prompt is logged', /THE PROMPT BODY/.test(r.logs));
  check('the assembled memo is logged', /THE ASSEMBLED MEMO/.test(r.logs));
  check('it says plainly that nothing was sent', /NOT SENT/.test(r.logs));
  check('…and names what it skipped',
        /no email/.test(r.logs) && /no calendar event/.test(r.logs) && /no Slack ping/.test(r.logs),
        r.logs.slice(-300));
  check('the system log records a dry run, not a Success',
        (r.calls['veraLog_'] || []).some(a => a[2] === 'Dry run'),
        JSON.stringify((r.calls['veraLog_'] || []).map(a => a[2])));
}

// ============ the scheduled send is untouched ===============================

console.log('\nthe scheduled send still does everything');
{
  const r = runPlanner(undefined, { cooldownActive: false });
  SIDE_EFFECTS.forEach(name => {
    check(name + ' fires exactly once', r.n(name) === 1, r.n(name) + ' call(s)');
  });
  check('the cooldown IS checked', r.n('wasRecentlySent_') === 1, r.n('wasRecentlySent_'));
  check('it logs a real send, not a dry run', !/NOT SENT/.test(r.logs));
  check('…and records Success', (r.calls['veraLog_'] || []).some(a => a[2] === 'Success'),
        JSON.stringify((r.calls['veraLog_'] || []).map(a => a[2])));
}

console.log('\n…and still refuses to double-send');
{
  const r = runPlanner(undefined, { cooldownActive: true });
  check('the cooldown stops it', /already sent recently/.test(r.logs));
  SIDE_EFFECTS.forEach(name => {
    check('no ' + name, r.n(name) === 0, r.n(name) + ' call(s)');
  });
  check('…and Claude is never called', r.n('callClaudeWeekendPlanner_') === 0);
}

console.log('\nan explicit dryRun:false behaves like the scheduled send');
{
  const r = runPlanner({ dryRun: false }, { cooldownActive: false });
  check('it delivers', r.n('sendVeraEmail_') === 1, r.n('sendVeraEmail_'));
  check('…and writes history', r.n('writePlannerHistory_') === 1, r.n('writePlannerHistory_'));
}

// ============ the wrapper ====================================================

console.log('\ntestWeekendMemo is reachable from the editor');
{
  check('it has no trailing underscore — the Run menu hides those',
        /function testWeekendMemo\(\)/.test(WP));
  const body = extractFn(WP, 'testWeekendMemo');
  check('it asks for a dry run', /dryRun:\s*true/.test(body), body);
  check('…and says so in the log', /nothing was sent/i.test(body));
  check('the private function it wraps is still private',
        /function runWeekendPlanner_\(/.test(WP));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
