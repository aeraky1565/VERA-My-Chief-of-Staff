// Settings › Test: the pre-trip and post-trip emails, sent on demand.
//
// What this pins:
//  1. Each of the four senders takes { test: true }: "TEST · " on the subject,
//     the send latch is neither read nor written (so the real one still goes
//     out), and the real (non-test) path still checks and sets its latch.
//  2. webTestTripEmailSend_ picks the right sender for each kind, builds a
//     pre-trip test as if departure were 48 hours / the night before away, and
//     finds a past trip from its itinerary, or from the past-trips list when
//     the itinerary has no rows.
//  3. The route is wired.
// Invented trips throughout.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const TDB = fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8');
const PRE = fs.readFileSync(ROOT + '/PreTripBriefing.js', 'utf8');
const POST = fs.readFileSync(ROOT + '/PostTripCapture.js', 'utf8');
const WEB = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}
const kindsSrc = (() => { const i = TDB.indexOf('var TRIP_TEST_KINDS_'); if (i === -1) throw new Error('no TRIP_TEST_KINDS_'); return TDB.slice(i, TDB.indexOf('};', i) + 2); })();

// ============ the four senders =============================================
// Each sender runs for real with everything around it stubbed; the stubs
// record the email and the latch calls.
const SENDERS = [
  ['sendPreTripEmail_48h_', PRE, 'PRETRIP_48H_', /^TEST · 🗺️ Pre-Trip Brief — Lake Trip/],
  ['sendPreTripEmail_NightBefore_', PRE, 'PRETRIP_NB_', /^TEST · 📋 Tomorrow — Lake Trip/],
  ['sendPostTripNudgeEmail_', POST, 'POSTTRIP_NUDGE_', /^TEST · 🧳 Lake Trip — Capture the Memories/],
  ['sendPostTripRecapEmail_', POST, 'POSTTRIP_RECAP_', /^TEST · 📸 Lake Trip — Trip Recap/],
];
function senderCtx(fn, src, latched) {
  const log = { mail: [], seen: [], mark: [] };
  const ctx = {
    String, Object, JSON, RegExp, Date, Math, Array, Number, parseInt, isNaN, isFinite, encodeURIComponent,
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? d.toISOString().slice(0, 10) : 'Fri Nov 6' },
    CONFIG: { MORNING_NUDGE_EMAIL: 'me@example.test' },
    tripLatchSeen_: (p) => { log.seen.push(p); return latched; },
    tripLatchMark_: (p) => { log.mark.push(p); },
    tripLatchName_: () => 'X', tripLatchValue_: () => null,
    sendVeraEmail_: (to, subject) => { log.mail.push({ to, subject }); },
    callClaudeJson_: (prompt, fb) => fb,
    getSpreadsheet: () => ({ getSheetByName: () => null }),
    readTripRows_: () => [],
  };
  Object.assign(ctx, {
    getTripToneMode_: () => 'personal', collapseItineraryRows_: r => r, inferTripDestination_: () => '',
    getPackingWeather_: () => null, getPackingStatusForBriefing_: () => ({ total: 0, packed: 0, open: [] }),
    escapeHtml_: x => String(x), openDecisionsForTrip_: () => [], buildOpenDecisionsSection_: () => '',
    tripBriefingFor_: () => '', buildPreTripEmailHtml_: () => '<html>', buildOpenDecisionsPlain_: () => '',
    tripDurationPrefix_: () => '', tripDurationLabel_: () => '3 days',
  });
  vm.createContext(ctx);
  ctx.__fn = vm.runInContext('(' + extractFn(src, fn) + ')', ctx);
  return { ctx, log };
}
const TRIP = { tripKey: '2026-11-06|Lake Trip', tripLabel: 'Lake Trip', departureDate: new Date('2026-11-06T00:00:00Z'),
               endDate: new Date('2026-11-08T00:00:00Z'), rows: [], hoursUntil: 48 };

console.log('\neach sender, as a test and for real');
SENDERS.forEach(([fn, src, prefix, subj]) => {
  const t = senderCtx(fn, src, true);
  let out, err = '';
  try { out = t.ctx.__fn(Object.assign({}, TRIP), { test: true }); } catch (e) { err = e.message; }
  check(fn + ': a test sends even after the real one went out', t.log.mail.length === 1, err || JSON.stringify(t.log));
  check(fn + ': …marked TEST', t.log.mail[0] && subj.test(t.log.mail[0].subject), t.log.mail[0] && t.log.mail[0].subject);
  check(fn + ': …without reading or setting the latch', t.log.seen.length === 0 && t.log.mark.length === 0, JSON.stringify(t.log));
  check(fn + ': …and says what it sent', out && out.subject === (t.log.mail[0] || {}).subject && out.to[0] === 'me@example.test', JSON.stringify(out));
  const real = senderCtx(fn, src, true);
  real.ctx.__fn(Object.assign({}, TRIP));
  check(fn + ': the real one still stops at its latch', real.log.mail.length === 0 && real.log.seen[0] === prefix, JSON.stringify(real.log));
  const fresh = senderCtx(fn, src, false);
  fresh.ctx.__fn(Object.assign({}, TRIP));
  check(fn + ': …and sets it when it sends, without TEST', fresh.log.mail.length === 1 && !/TEST/.test(fresh.log.mail[0].subject) && fresh.log.mark[0] === prefix, JSON.stringify(fresh.log));
});

// ============ the endpoint ================================================
function webCtx(o) {
  o = o || {};
  const sent = [];
  const mk = name => (trip, opts) => { sent.push({ name, trip, opts }); return o.nothing ? null : { to: ['me@example.test'], subject: 'TEST · ' + name, count: 3 }; };
  const ctx = {
    String, Object, JSON, RegExp, Date, Math,
    travelTestRanges_: () => ({ '2026-11-06|Lake Trip': { min: '2026-11-06', max: '2026-11-08' } }),
    readTripRows_: k => k === '2026-09-24|Old Trip' ? [['I-6']] : [],
    getTripBoundsByKey_: k => k === '2026-09-24|Old Trip' ? { tripKey: k, tripLabel: 'Old Trip', departureDate: new Date('2026-09-24T00:00:00'), endDate: new Date('2026-09-27T00:00:00') } : null,
    webListPastTrips_: () => ({ ok: true, trips: [{ key: '2026-08-01|Calendar Only', label: 'Calendar Only', startDate: '2026-08-01', endDate: '2026-08-04' }] }),
    sendPreTripEmail_48h_: mk('48h'), sendPreTripEmail_NightBefore_: mk('nb'),
    sendPostTripNudgeEmail_: mk('nudge'), sendPostTripRecapEmail_: mk('recap'),
    veraLog_: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(kindsSrc + '\n' + extractFn(TDB, 'tripTestTrip_') + '\n' + extractFn(TDB, 'webTestTripEmailSend_'), ctx);
  ctx.run = p => { ctx.__e = { parameter: p }; try { return vm.runInContext('webTestTripEmailSend_(__e)', ctx); } catch (e) { return { threw: e.message }; } };
  ctx.sent = sent;
  return ctx;
}

console.log('\nthe Test tab endpoint');
{
  [['pretrip_48h', '48h'], ['pretrip_nb', 'nb'], ['posttrip_nudge', 'nudge'], ['posttrip_recap', 'recap']].forEach(([kind, name]) => {
    const w = webCtx();
    const tk = kind.indexOf('pre') === 0 ? '2026-11-06|Lake Trip' : '2026-09-24|Old Trip';
    const r = w.run({ kind, tripKey: tk });
    check(kind + ' goes to its own sender, as a test', r.ok && w.sent.length === 1 && w.sent[0].name === name && (w.sent[0].opts || {}).test === true, JSON.stringify(r));
  });
  const w = webCtx(); w.run({ kind: 'pretrip_48h', tripKey: '2026-11-06|Lake Trip' });
  const t = w.sent[0].trip;
  check('a pre-trip test is built as if departure were 48 hours away', t.hoursUntil === 48 && t.tripLabel === 'Lake Trip', JSON.stringify(t));
  check('…for the trip\'s whole range', t.departureDate.toISOString().slice(0, 10) === '2026-11-06' && t.endDate.toISOString().slice(0, 10) === '2026-11-08');
  const nb = webCtx(); nb.run({ kind: 'pretrip_nb', tripKey: '2026-11-06|Lake Trip' });
  check('a night-before test, as if leaving tomorrow', nb.sent[0].trip.hoursUntil === 12, JSON.stringify(nb.sent[0].trip));
  const p = webCtx(); p.run({ kind: 'posttrip_recap', tripKey: '2026-09-24|Old Trip' });
  check('a past trip comes from its itinerary, with its rows', p.sent[0].trip.tripLabel === 'Old Trip' && p.sent[0].trip.rows.length === 1, JSON.stringify(p.sent[0].trip));
  const c = webCtx(); const cr = c.run({ kind: 'posttrip_nudge', tripKey: '2026-08-01|Calendar Only' });
  check('…or from the past-trips list when the itinerary has none', cr.ok && c.sent[0].trip.tripLabel === 'Calendar Only' && c.sent[0].trip.endDate.getDate() === 4, JSON.stringify(c.sent[0] && c.sent[0].trip));
  const uk = webCtx(); const ur = uk.run({ kind: 'weekend', tripKey: '2026-11-06|Lake Trip' });
  check('an unknown email is refused, nothing sent', ur.ok === false && !ur.threw && uk.sent.length === 0, JSON.stringify(ur));
  check('no trip is refused', webCtx().run({ kind: 'pretrip_48h' }).ok === false);
  const gone = webCtx(); const g = gone.run({ kind: 'pretrip_48h', tripKey: '2026-12-01|Gone' });
  check('a trip that is gone is refused, nothing sent', g.ok === false && gone.sent.length === 0, JSON.stringify(g));
  const gp = webCtx(); check('…a past one too', gp.run({ kind: 'posttrip_recap', tripKey: '2026-01-01|Gone' }).ok === false && gp.sent.length === 0);
  check('a sender that builds nothing says so', webCtx({ nothing: true }).run({ kind: 'pretrip_48h', tripKey: '2026-11-06|Lake Trip' }).ok === false);
  const rr = webCtx().run({ kind: 'posttrip_recap', tripKey: '2026-09-24|Old Trip' });
  check('it says what it sent', rr.subject === 'TEST · recap' && rr.to[0] === 'me@example.test', JSON.stringify(rr));
}

console.log('\nwiring');
check('test_trip_email_send', /case 'test_trip_email_send':\s*return jsonOut_\(webTestTripEmailSend_\(e\)\)/.test(WEB));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
