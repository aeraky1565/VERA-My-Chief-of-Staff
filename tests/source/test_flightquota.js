// Flight lookups stay inside the AviationStack plan (the free plan is 100 a month).
//
// WHAT WENT WRONG. A lookup that came back empty (the free plan has no data until close
// to departure) or failed was never written down: the spacing read only the last GOOD
// answer, so the 15-minute trigger asked again every run, all day. The System Log shows
// it: 96 lookups on Oct 21, every one empty. And ↺ / the dashboard's own fill-in skipped
// both the spacing and the quota backoff, so every page open on a travel day spent more.
//
// These pin: every try is remembered and spaces the next one; ↺ waits during a backoff
// and skips a flight tried in the last 10 minutes; every real call is counted, and at
// the month's budget nothing more is asked until the 1st. Invented flights throughout.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FLIGHT = read('FlightStatus.js'), WEBAPP = read('WebApp.js'), FEAT = read('Features.js');
const APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
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
const T = s => new Date(s).getTime();
const pad = n => String(n).padStart(2, '0');

// A world: one calendar flight (UA 1369, 07:30) and one Itinerary flight (XY 700, 18:00) on Oct 28.
function world(opts) {
  opts = opts || {};
  const C = { clock: T('2026-10-27T12:00:00'), calls: [], props: {}, store: {}, logged: [], cfg: {}, answer: 'empty' };
  const RealDate = Date;
  C.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(C.clock); }
    static now() { return C.clock; }
  };
  const rows = [
    ['ID', 'Trip Key', 'Type', 'Title', 'Date', 'Time', '', '', '', 'Metadata'],
    ['IT-2', '2026-10-21|Chicago', 'flight', 'Flight XY 700 ORD→IAD', '2026-10-28', '18:00', '', '', '', '{}'],
  ];
  C.rows = rows;
  const events = [{ id: 'abc_123@google.com', title: 'Flight to Washington (UA 1369)', location: 'Chicago ORD', start: T('2026-10-28T07:30:00'), allDay: false }];
  Object.assign(C, {
    JSON, Math, String, Object, Array, parseInt, isFinite, Number,
    Logger: { log() {} }, TABS: { ITINERARY: 'Itinerary', CONFIG: 'Config' },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate: (d, tz, f) => f === 'yyyy-MM' ? d.getFullYear() + '-' + pad(d.getMonth() + 1)
                                       : f === 'HH:mm' ? pad(d.getHours()) + ':' + pad(d.getMinutes())
                                       : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in C.props ? C.props[k] : null), setProperty: (k, v) => { C.props[k] = String(v); }, deleteProperty: k => { delete C.props[k]; } }) },
    getConfigValues: () => C.cfg,
    veraStoreGet_: k => C.store[k] || null, veraStoreSet_: (k, v) => { C.store[k] = v; },
    recordApiHealth_: () => {}, getApiHealth_: () => ({ lastError: '' }),
    veraLog_: (...a) => C.logged.push(a), recordHeartbeat_: () => {}, flushSystemLog_: () => {}, runLogStart_: () => {},
    checkinTick_: () => {}, lhMorningCheck_: () => {}, featureOn_: () => true,
    getUpcomingTripsForLegs_: () => [{ tripKey: '2026-10-21|Chicago', startDate: '2026-10-21', endDate: '2026-10-28' }],
    UrlFetchApp: { fetch: url => {
      const num = /flight_iata=([A-Z0-9]+)/.exec(url)[1]; C.calls.push(num);
      if (C.answer === 'fail') return { getResponseCode: () => 500, getContentText: () => 'oops' };
      if (C.answer === 'good') return { getResponseCode: () => 200, getContentText: () => J({ data: [{ flight_status: 'scheduled', departure: { scheduled: '2026-10-28T07:30:00', gate: 'B7' }, arrival: {} }] }) };
      return { getResponseCode: () => 200, getContentText: () => J({ data: [] }) };
    } },
    getSpreadsheet: () => ({ getSheetByName: () => ({
      getDataRange: () => ({ getValues: () => rows }),
      getRange: (r, c) => ({ setValue: v => { rows[r - 1][c - 1] = v; } }),
    }) }),
    CalendarApp: { getAllCalendars: () => [{ getEvents: () => events.map(e => ({
      getId: () => e.id, getTitle: () => e.title, getLocation: () => e.location,
      getStartTime: () => new C.Date(e.start), isAllDayEvent: () => e.allDay })) }] },
  });
  vm.createContext(C);
  vm.runInContext(FLIGHT + '\n' + ['flightKeyFor_', 'itinKeywordHit_', 'isItineraryCalendarRelevant_'].map(n => extractFn(WEBAPP, n)).join('\n'), C);
  C.checkStaleFlightStatus_ = () => {};
  C.getAviationStackKey_ = () => 'invented-key';
  return C;
}
const run = (C, when, force, key) => {
  C.clock = T(when); C.calls = []; C.force = force; C.key = key || '';
  C.result = vm.runInContext('checkFlightStatuses_(force, key || undefined)', C);
  return C.calls.slice();
};
const atTimes = (from, to, stepMin) => { const out = []; for (let t = T(from); t <= T(to); t += stepMin * 60000) { const d = new Date(t); out.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00'); } return out; };

console.log('An empty answer spaces the next try');
{
  const C = world();
  check('6 hours before: looked up, and the API answers empty', J(run(C, '2026-10-28T01:30:00', false)) === '["UA1369"]', J(C.calls));
  check('15 minutes later, in the 1–6 h band: no second lookup', run(C, '2026-10-28T01:45:00', false).length === 0, J(C.calls));
  check('an hour after the try: asked again', run(C, '2026-10-28T02:30:00', false).length === 1);
  const all = world(); let n = 0;
  atTimes('2026-10-28T00:00:00', '2026-10-28T08:00:00', 15).forEach(t => { n += run(all, t, false).filter(x => x === 'UA1369').length; });
  check('a whole morning of empty answers costs at most 10 lookups for the flight (was 25)', n > 0 && n <= 10, n);
  const sheet = world(); let m = 0;
  atTimes('2026-10-28T11:30:00', '2026-10-28T18:30:00', 15).forEach(t => { m += run(sheet, t, false).filter(x => x === 'XY700').length; });
  check('…and the same for a flight on the Itinerary tab', m > 0 && m <= 10, m);
  check('the Itinerary row remembers the try', JSON.parse(sheet.rows[1][9]).flight_attempt_at > 0, sheet.rows[1][9]);
}

console.log('\nA failed answer waits too, and a good one still counts as checked');
{
  const C = world(); C.answer = 'fail';
  check('the API fails: it was asked once', run(C, '2026-10-28T02:00:00', false).length === 1);
  check('…and not again 15 minutes later', run(C, '2026-10-28T02:15:00', false).length === 0);
  const G = world(); G.answer = 'good';
  run(G, '2026-10-28T02:00:00', false);
  const e = JSON.parse(G.store.FLIGHT_STATUS_CACHE || '{}')['CAL-abc123googlecom'] || {};
  check('a good answer is cached with its time', e.status && e.status.gate === 'B7' && e.status.lastChecked === T('2026-10-28T02:00:00'), J(e));
  check('…and spaces the next one the same way', run(G, '2026-10-28T02:15:00', false).length === 0);
}

console.log('\n↺ stays inside the plan');
{
  const C = world();
  check('↺ on the day looks up both flights', run(C, '2026-10-28T00:30:00', true, '2026-10-21|Chicago').length === 2, J(C.calls));
  check('a second ↺ five minutes later looks up nothing', run(C, '2026-10-28T00:35:00', true, '2026-10-21|Chicago').length === 0, J(C.calls));
  check('…and says each was just tried', C.result && C.result.recent === 2, J(C.result));
  check('after 10 minutes ↺ works again', run(C, '2026-10-28T00:41:00', true, '2026-10-21|Chicago').length === 2);
  const B = world(); B.props.AVIATIONSTACK_BACKOFF_UNTIL = String(T('2026-10-28T09:00:00'));
  check('during a backoff ↺ looks up nothing', run(B, '2026-10-28T02:00:00', true, '2026-10-21|Chicago').length === 0);
  check('…and says until when', B.result && B.result.paused === T('2026-10-28T09:00:00'), J(B.result));
  check('the trigger waits during a backoff too', run(B, '2026-10-28T02:00:00', false).length === 0);
}

console.log('\nThe month’s lookups are counted, and stop at the budget');
{
  const C = world();
  run(C, '2026-10-28T01:30:00', false); run(C, '2026-10-28T01:45:00', false); run(C, '2026-10-28T02:30:00', false);
  check('each real call counts once; a skipped run counts nothing', C.props.AVIATIONSTACK_USED === '2026-10:2', C.props.AVIATIONSTACK_USED);
  const F = world(); F.props.AVIATIONSTACK_USED = '2026-10:100';
  check('at 100 of 100: the trigger asks nothing', run(F, '2026-10-28T02:00:00', false).length === 0);
  check('…nor does ↺', run(F, '2026-10-28T02:00:00', true, '2026-10-21|Chicago').length === 0);
  check('…and it says why', F.result && F.result.budget === 100 && F.result.used === 100, J(F.result));
  F.cfg.flight_status_monthly_budget = '500';
  check('a bigger plan in the setting: asked again', run(F, '2026-10-28T02:00:00', false).length === 1);
  const N = world(); N.props.AVIATIONSTACK_USED = '2026-09:100';
  check('a new month starts at 0', run(N, '2026-10-28T02:00:00', false).length === 1 && N.props.AVIATIONSTACK_USED === '2026-10:1', N.props.AVIATIONSTACK_USED);
  const W = world(); W.props.AVIATIONSTACK_USED = '2026-10:79';
  run(W, '2026-10-28T02:00:00', false);
  check('at 80 of 100, the System Log says so once', W.logged.filter(a => a[2] === 'Warning' && /80 of this month/.test(a[3])).length === 1, J(W.logged));
  const X = world(); X.props.AVIATIONSTACK_USED = '2026-10:99';
  run(X, '2026-10-28T02:00:00', false);
  check('at 100 of 100, it says checks pause until the 1st', X.logged.some(a => a[2] === 'Warning' && /pause until the 1st/.test(a[3])), J(X.logged));
  C.c = {}; C.c2 = { flight_status_monthly_budget: 'lots' };
  check('a missing or bad budget reads as the free plan’s 100', vm.runInContext('asBudget_(c) === 100 && asBudget_(c2) === 100', C));
}

console.log('\nThe dashboard says why ↺ found nothing');
{
  const W = { JSON, ran: {}, e: {}, webGetFlightStatuses_: () => ({ ok: true, statuses: {} }) };
  vm.createContext(W);
  vm.runInContext('var checkFlightStatuses_ = function() { return ran; };\n' + extractFn(WEBAPP, 'webForceFlightStatuses_'), W);
  const why = ran => { W.ran = ran; W.e = { parameter: { tripKey: 'k' } }; return vm.runInContext('webForceFlightStatuses_(e)', W); };
  check('the month used up', why({ budget: 100, used: 100 }).skippedWhy === 'budget');
  check('a backoff, with its end', why({ paused: T('2026-10-28T09:00:00') }).skippedWhy === 'paused' && !!why({ paused: T('2026-10-28T09:00:00') }).pausedUntil);
  check('tried a few minutes ago', why({ recent: 2, polled: 0, errors: 0 }).skippedWhy === 'recent');
  check('nothing to say when it looked something up', why({ polled: 1, recent: 1 }).skippedWhy === '');
  const D = { Date }; vm.createContext(D); vm.runInContext(extractFn(APP, 'flightSkipNote'), D);
  const note = r => { D.r = r; return vm.runInContext('flightSkipNote(r)', D); };
  check('↺ note: the month', /100 flight lookups are used\. Live status is back on the 1st\./.test(note({ skippedWhy: 'budget', lookupsBudget: 100 })));
  check('↺ note: paused', /^Flight lookups are paused until /.test(note({ skippedWhy: 'paused', pausedUntil: '2026-10-28T13:00:00Z' })));
  check('↺ note: just checked', note({ skippedWhy: 'recent' }) === 'Checked a few minutes ago.');
  check('↺ note: nothing when it looked', note({ skippedWhy: '' }) === '' && note(null) === '');
  check('the note is the same on the lite dashboard', extractFn(APP, 'flightSkipNote') === extractFn(LITE, 'flightSkipNote'));
  check('both dashboards show it beside ↺', [APP, LITE].every(s => /setFlightNote\(flightSkipNote\(r\)\)/.test(s) && /className:"flight-skip-note"/.test(s)));
}

console.log('\nSettings and the test lookup');
{
  const S = { Logger: { log() {} }, JSON, Math, Date, String, Object, Array, parseInt, Utilities: { formatDate: () => '2026-10' }, Session: { getScriptTimeZone: () => 'UTC' },
    asUsed_: () => 37, asBudget_: c => parseInt(c.flight_status_monthly_budget, 10) || 100 };
  vm.createContext(S); vm.runInContext(FEAT, S);
  const f = vm.runInContext('featureByKey_("flight_status")', S);
  check('Flight status has the plan’s lookups as a setting', (f.cfg || []).some(x => x.c === 'flight_status_monthly_budget' && x.type === 'num' && x.def === '100'));
  S.f = f;
  check('Feature Flags shows this month’s count', vm.runInContext('featureUsage_(f, {})', S) === 'Lookups this month: 37 of 100');
  check('…and only on Flight status', vm.runInContext('featureUsage_(featureByKey_("notes"), {})', S) === '');
  check('the Feature Flags list carries it', /usage: featureUsage_\(f, cfg\)/.test(extractFn(FEAT, 'webFeatureFlags_')));
  check('the row draws it', /f\.usage&&h\('div',\{className:'ff-when ff-usage'\},'📊 '\+f\.usage\)/.test(APP));
  const dbg = extractFn(FLIGHT, 'debugFlightStatusScan');
  check('the debug scan tests one flight, not every one', /if \(tested >= 1\) break;/.test(dbg));
  check('…and no longer makes a second, raw call', !/rawUrl|UrlFetchApp\.fetch/.test(dbg));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
