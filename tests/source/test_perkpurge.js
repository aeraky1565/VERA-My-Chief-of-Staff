// VERA's perk reminder events must not pile up on the shared calendar for ever.
//
// September's reminders were still there in October. deletePerkReminderEvent_ was the
// only thing that ever removed one, it has a single caller — the dashboard's mark-used
// toggle — and it refuses anything in the past by design. So a perk that was never
// redeemed kept its event indefinitely and clearing it was a human's job.
//
// The events are NUDGES, NOT RECORDS: closeExpiredPerkFlags_ already marks every lapsed
// perk 'expired' in the Flags sheet and feeds recordFlagOutcome_, so the history is kept
// where the signal work wants it. Past its date the calendar entry carries nothing the
// sheet does not.
//
// The three things that make deleting from a SHARED calendar safe, all asserted here:
// only events carrying VERA's own marker, only events strictly before today, and a dry
// run that reports exactly what the real run would remove.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const CODE = fs.readFileSync(ROOT + '/Code.js', 'utf8');
const WEB  = fs.readFileSync(ROOT + '/WebApp.js', 'utf8');

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

// ---------------------------------------------------------------------------
// A calendar that records instead of deleting. getEvents is counted, because "one call
// however wide the window" is a property worth keeping: a call per day would make the
// nightly cost scale with the lookback for nothing.
const DAY = 86400000;

function harness(opts) {
  opts = opts || {};
  const TODAY = Date.UTC(2026, 9, 7);          // 7 Oct 2026, local midnight in the stub
  const calls = { getEvents: 0, ranges: [] };

  const mkEvent = e => {
    const ev = {
      _title: e.title, _desc: e.desc, _start: e.start, deleted: false,
      getTitle: () => ev._title,
      getDescription: () => {
        if (e.descThrows) throw new Error('description unavailable');
        return ev._desc;
      },
      getStartTime: () => new Date(ev._start),
      deleteEvent: () => {
        if (e.deleteThrows) throw new Error('calendar is read-only');
        ev.deleted = true;
      },
    };
    return ev;
  };
  const events = (opts.events || []).map(mkEvent);

  const cal = {
    getEvents: (from, to) => {
      calls.getEvents++;
      calls.ranges.push([from.getTime(), to.getTime()]);
      // Real overlap semantics: an all-day event on day D occupies [D, D+1).
      return events.filter(ev => {
        const s = ev._start, e = s + DAY;
        return s <= to.getTime() && e > from.getTime();
      });
    },
  };

  const ctx = {
    String, Number, Object, Array, Math, JSON, Error, console, isNaN, Date,
    Logger: { log: m => ctx._log.push(String(m)) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: {
      // Formats from the epoch value directly, so the stub does not depend on the
      // machine's timezone — the suite has to give the same answer everywhere.
      formatDate: (d, tz, fmt) => new Date(d.getTime()).toISOString().slice(0, 10),
    },
    getPrimarySharedCalendar_: () => (opts.noCalendar ? null : cal),
    _log: [], _calls: calls, _events: events, _today: TODAY,
  };
  if (opts.calendarThrows) {
    ctx.getPrimarySharedCalendar_ = () => { throw new Error('calendar service down'); };
  }
  vm.createContext(ctx);

  // The clock is pinned so "before today" is a fixed question.
  //
  // Reflect.construct with the real argument list, NOT new R(a, b, c): passing three
  // parameters when one was given hands Date (ms, undefined, undefined), which it reads
  // as (year, month, day) and returns an Invalid Date. Every `new Date(someMs)` in the
  // function under test then produced NaN and the whole thing reported ok:false.
  vm.runInContext(
    'Date = (function(R){ function D(){ return arguments.length' +
    ' ? Reflect.construct(R, Array.prototype.slice.call(arguments))' +
    ' : new R(' + TODAY + '); }' +
    ' D.now = function(){ return ' + TODAY + '; }; D.UTC = R.UTC; D.parse = R.parse; return D; })(Date);\n' +
    /^var PERK_EVENT_PURGE_LOOKBACK_DAYS_\s*=.*?;/m.exec(CODE)[0] + '\n' +
    /^var PERK_EVENT_PURGE_BACKLOG_DAYS_\s*=.*?;/m.exec(CODE)[0] + '\n' +
    extractFn(CODE, 'purgePastPerkReminderEvents_'), ctx);
  return ctx;
}

const mark = (id, pk) => 'VERA-PERK:' + id + ':' + pk;

// ============================================================================
console.log('Only VERA\'s own perk reminders are deleted');
{
  const c = harness({ events: [
    { title: '⏰ Dining credit ($30) expires today — Amex', desc: mark('CP-1', '2026-09'),
      start: Date.UTC(2026, 8, 30) },
    { title: 'Victoria — dentist',            desc: '',            start: Date.UTC(2026, 8, 30) },
    { title: 'Dinner with the Shaws',         desc: 'ours, hands off', start: Date.UTC(2026, 8, 30) },
    // VERA'S OTHER MARKER. ImportantDates.js writes 'VERA-DATE:<id>:<year>' into
    // birthday and anniversary descriptions, and those legitimately stay on the
    // calendar after the day has passed. Matching 'VERA' instead of the full
    // 'VERA-PERK:' prefix would delete someone's birthday — the fixture exists
    // because without it the loose-match control had nothing to bite on, and a
    // destructive sweep over a shared calendar is the last place to find that out.
    { title: 'Victoria — birthday', desc: 'VERA-DATE:ID-7:2026', start: Date.UTC(2026, 8, 15) },
    { title: '⏰ Travel credit expires today — Chase', desc: mark('CP-2', '2026-Q3'),
      start: Date.UTC(2026, 8, 30) },
  ] });

  const out = vm.runInContext('purgePastPerkReminderEvents_()', c);
  check('it reports ok', out.ok === true, JSON.stringify(out));
  check('both perk reminders are removed', out.removed === 2, JSON.stringify(out));
  check('…and they are the two carrying the marker',
        c._events[0].deleted && c._events[4].deleted, JSON.stringify(c._events.map(e => e.deleted)));
  check('the events that are NOT ours survive, on the same day',
        !c._events[1].deleted && !c._events[2].deleted,
        'this runs against a calendar Victoria reads; touching anything unmarked ' +
        'would be unforgivable');
  check('a past BIRTHDAY carrying VERA\'s other marker survives',
        !c._events[3].deleted,
        'ImportantDates.js writes VERA-DATE: into birthday descriptions. Matching ' +
        '\'VERA\' rather than \'VERA-PERK:\' deletes them, and a birthday that has ' +
        'passed is exactly the kind of thing a 40-day lookback sweeps over');
  check('matched counts only ours, not everything scanned',
        out.matched === 2 && out.scanned === 5, JSON.stringify(out));
  check('the list names what went, for the dashboard and the log',
        out.events.length === 2 &&
        /Dining credit/.test(out.events[0].title) && out.events[0].date === '2026-09-30',
        JSON.stringify(out.events));
}

console.log('\nOnly events strictly BEFORE today');
{
  // The off-by-one that matters: a perk whose period ends TODAY is still live all day,
  // and an all-day event on the 7th spans the 7th to the 8th. A range ending at today
  // 00:00 would catch it through getEvents' overlap semantics and delete a live nudge.
  const c = harness({ events: [
    { title: 'yesterday — dead',  desc: mark('CP-1', '2026-10a'), start: Date.UTC(2026, 9, 6) },
    { title: 'TODAY — still live', desc: mark('CP-2', '2026-10'),  start: Date.UTC(2026, 9, 7) },
    { title: 'tomorrow — live',   desc: mark('CP-3', '2026-10b'), start: Date.UTC(2026, 9, 8) },
  ] });

  const out = vm.runInContext('purgePastPerkReminderEvents_()', c);
  check('yesterday\'s reminder is removed', c._events[0].deleted === true);
  check('TODAY\'S reminder survives', c._events[1].deleted === false,
        'the perk has not expired until the day is over — deleting its reminder in the ' +
        'morning is deleting the only nudge that still mattered');
  check('tomorrow\'s survives', c._events[2].deleted === false);
  check('…and only the one is counted', out.removed === 1, JSON.stringify(out));

  // The window's far edge is reported, so a log line says what was actually examined.
  check('the window ends yesterday', out.to === '2026-10-06', JSON.stringify(out));
  check('…and starts a lookback ago',
        out.from === '2026-08-28', JSON.stringify(out) + ' — 40 days back from 6 Oct');
}

console.log('\nA dry run reports exactly what the real run would remove');
{
  const mk = () => ({ events: [
    { title: '⏰ A', desc: mark('CP-1', '2026-09'), start: Date.UTC(2026, 8, 30) },
    { title: 'not ours', desc: '', start: Date.UTC(2026, 8, 30) },
    { title: '⏰ B', desc: mark('CP-2', '2026-08'), start: Date.UTC(2026, 8, 29) },
  ] });

  const dry  = harness(mk());
  const real = harness(mk());
  const dOut = vm.runInContext('purgePastPerkReminderEvents_(40, true)', dry);
  const rOut = vm.runInContext('purgePastPerkReminderEvents_(40, false)', real);

  check('the dry run deletes nothing',
        dry._events.every(e => !e.deleted) && dOut.removed === 0,
        JSON.stringify(dry._events.map(e => e.deleted)));
  check('…and says so', dOut.dryRun === true && rOut.dryRun === false);
  check('…but matches the same events',
        dOut.matched === rOut.matched && dOut.matched === 2,
        JSON.stringify({ dry: dOut.matched, real: rOut.matched }));
  check('…and lists exactly the same ones, in the same order',
        JSON.stringify(dOut.events) === JSON.stringify(rOut.events),
        JSON.stringify({ dry: dOut.events, real: rOut.events }) +
        ' — a preview that can disagree with the thing it previews is worse than none');
  check('the real run removes them', rOut.removed === 2 &&
        real._events[0].deleted && real._events[2].deleted && !real._events[1].deleted);
}

console.log('\nOne calendar round trip, however wide the window');
{
  const evs = [];
  for (let d = 1; d <= 30; d++) {
    evs.push({ title: '⏰ perk ' + d, desc: mark('CP-' + d, '2026-09'), start: Date.UTC(2026, 8, d) });
  }
  const c = harness({ events: evs });
  const out = vm.runInContext('purgePastPerkReminderEvents_(400, false)', c);

  check('a 400-day sweep still makes ONE getEvents call',
        c._calls.getEvents === 1, c._calls.getEvents + ' call(s) — a call per day ' +
        'would make the nightly cost scale with the lookback for no benefit');
  check('…and finds all 30', out.removed === 30, JSON.stringify({ removed: out.removed }));
  check('the wide window really is wider',
        out.from === '2025-09-02', JSON.stringify(out.from) + ' — 400 days back');
}

console.log('\nIt cannot take the night down');
{
  const noCal = harness({ noCalendar: true });
  const a = vm.runInContext('purgePastPerkReminderEvents_()', noCal);
  // Requires the ACTIONABLE part. Matching only /no shared calendar/ passed even when
  // the graceful return was replaced by a bare throw caught upstream — a distinction
  // without a difference. What matters is that the message names the Config key to set,
  // so the dashboard says "configure this" rather than "something broke".
  check('no shared calendar is reported with what to configure',
        a.ok === false && /pto_gap_calendars/.test(a.error || ''), JSON.stringify(a));

  const boom = harness({ calendarThrows: true });
  let threw = '';
  let b = null;
  try { b = vm.runInContext('purgePastPerkReminderEvents_()', boom); }
  catch (e) { threw = e.message; }
  check('a calendar that throws is swallowed',
        threw === '' && b && b.ok === false && /calendar service down/.test(b.error),
        threw || JSON.stringify(b));

  // One event refusing to delete must not abandon the rest.
  const partial = harness({ events: [
    { title: '⏰ stuck', desc: mark('CP-1', '2026-09'), start: Date.UTC(2026, 8, 29), deleteThrows: true },
    { title: '⏰ fine',  desc: mark('CP-2', '2026-09'), start: Date.UTC(2026, 8, 30) },
  ] });
  const p = vm.runInContext('purgePastPerkReminderEvents_()', partial);
  check('one undeletable event does not stop the others',
        p.removed === 1 && partial._events[1].deleted === true, JSON.stringify(p));
  check('…and the count reflects what actually went',
        p.matched === 2 && p.removed === 1, JSON.stringify(p));

  // An unreadable description is skipped rather than guessed at.
  const opaque = harness({ events: [
    { title: 'unreadable', desc: '', start: Date.UTC(2026, 8, 29), descThrows: true },
    { title: '⏰ fine', desc: mark('CP-2', '2026-09'), start: Date.UTC(2026, 8, 30) },
  ] });
  const o = vm.runInContext('purgePastPerkReminderEvents_()', opaque);
  check('an event whose description cannot be read is left alone',
        o.removed === 1 && !opaque._events[0].deleted, JSON.stringify(o));
}

console.log('\nNothing to do is not a failure');
{
  const c = harness({ events: [
    { title: 'Victoria — dentist', desc: '', start: Date.UTC(2026, 8, 30) },
  ] });
  const out = vm.runInContext('purgePastPerkReminderEvents_()', c);
  check('a calendar with no perk reminders reports ok and removes nothing',
        out.ok === true && out.removed === 0 && out.matched === 0 && out.events.length === 0,
        JSON.stringify(out));
}

// ============================================================================
console.log('\nWired into the night and the dashboard');
{
  const tail = extractFn(CODE, 'nightlyRunTail');
  const head = extractFn(CODE, 'nightlyRun');

  check('the nightly sweep runs in the TAIL',
        /nightlyStep_\(ctx, 'purgePastPerkReminderEvents_'/.test(tail),
        'the head\'s three perk steps are already #32–34 of 37, so they are among the ' +
        'first the budget drops; this is housekeeping and belongs where there is room');
  check('…and NOT in the head as well',
        !/purgePastPerkReminderEvents_/.test(head),
        'running it twice a night is two calendar sweeps for one job');
  check('…with the nightly lookback, not the backlog one',
        /purgePastPerkReminderEvents_\(PERK_EVENT_PURGE_LOOKBACK_DAYS_, false\)/.test(tail),
        'the 400-day sweep every night is a wide scan for nothing');
  check('the nightly lookback is wider than a month, so a missed night self-heals',
        /PERK_EVENT_PURGE_LOOKBACK_DAYS_ = (3[5-9]|[4-9]\d|\d{3})/.test(CODE),
        'at 30 or less, one skipped night orphans that period\'s event for ever');
  check('the backlog window reaches past a year',
        /PERK_EVENT_PURGE_BACKLOG_DAYS_\s*=\s*(36[6-9]|3[7-9]\d|[4-9]\d\d)/.test(CODE),
        'September and earlier accumulated for months');

  check('both endpoint actions are registered',
        /case 'preview_perk_event_purge':/.test(WEB) && /case 'run_perk_event_purge':/.test(WEB));

  // The backlog sweep is driven from TestBench, not the dashboard. The Credit Card Hub
  // is one minified React.createElement line, and wedging two buttons into compiled
  // output for a run-ONCE operation is risk without return — TestBench is where this
  // codebase already keeps the things you run by hand (tbNightlyRun, tbMorningNudge),
  // and a list of dates and perk names reads perfectly in an execution log.
  const TB = fs.readFileSync(ROOT + '/TestBench.js', 'utf8');
  // Scoped to each function's OWN body by brace-matching. A /name[\s\S]{0,900}?.../
  // window reached past the end of the preview into the run function, so removing the
  // preview's list still matched the run's — its control is what exposed that.
  let prevBody = '', runBody = '';
  try { prevBody = extractFn(TB, 'tbPerkEventPurgePreview'); } catch (e) {}
  try { runBody  = extractFn(TB, 'tbPerkEventPurgeRun'); } catch (e) {}

  check('a preview function exists for the backlog', prevBody !== '');
  check('…and it is a DRY RUN',
        /purgePastPerkReminderEvents_\(PERK_EVENT_PURGE_BACKLOG_DAYS_, true\)/.test(prevBody),
        'a preview that deletes is not a preview');
  check('…and it lists what would go, not just a count',
        /out\.events\.forEach/.test(prevBody),
        'a count you cannot inspect is not something to approve');
  check('the real sweep is a separate function',
        runBody !== '' &&
        /purgePastPerkReminderEvents_\(PERK_EVENT_PURGE_BACKLOG_DAYS_, false\)/.test(runBody),
        'one function with a flag you might forget to pass is how a preview becomes a delete');
  check('preview and run are the SAME function with a flag',
        /function webPreviewPerkEventPurge_\(\)[\s\S]{0,200}?purgePastPerkReminderEvents_\(PERK_EVENT_PURGE_BACKLOG_DAYS_, true\)/.test(WEB) &&
        /function webRunPerkEventPurge_\(\)[\s\S]{0,200}?purgePastPerkReminderEvents_\(PERK_EVENT_PURGE_BACKLOG_DAYS_, false\)/.test(WEB),
        'two implementations is how a preview comes to promise something the run does ' +
        'not do — the address book import already taught that once');
}

console.log('\nThe mark-used path is unchanged');
{
  // This guard is CORRECT for its own caller: ticking an old perk used should not
  // rewrite the shared calendar. Deleting the line would have been the lazy way to
  // clear September, and it would have broken documented behaviour that has its own
  // tests. The purge is a separate, explicit operation.
  const del = extractFn(CODE, 'deletePerkReminderEvent_');
  check('deletePerkReminderEvent_ still refuses past events',
        /if \(end < today\) return 0;/.test(del),
        'the purge exists so this did not have to be relaxed');
  check('…and is still what the mark-used toggle calls',
        /out\.eventsRemoved = deletePerkReminderEvent_\(perkId, periodKey\)/.test(WEB));
  // The CALL, not the name: the purge's comments reference deletePerkReminderEvent_ to
  // explain where its boundary came from, and a bare-name match found those instead.
  // Sixth time in this codebase a check has matched a comment about the thing rather
  // than the thing — see test_heartbeats.js for the other five.
  check('the purge does not go through it',
        !/deletePerkReminderEvent_\s*\(/.test(extractFn(CODE, 'purgePastPerkReminderEvents_')),
        'routing through a function that refuses past events would delete nothing at all');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
