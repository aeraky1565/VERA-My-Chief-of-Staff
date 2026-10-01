// Marking a perk used has to clean up after the reminder.
//
// Reported from the sheet: a Lululemon credit stamped used for Q3 still had its
// "expires today" event sitting on the shared calendar for Sep 30, and it had to
// be deleted by hand.
//
// Two separate holes, both confirmed in the source:
//   1. webToggleCardPerk_ — what the dashboard checkbox actually calls — wrote the
//      Last Used cell and nothing else. Only Chat and the mark_card_perk_used API
//      ever called resolveCardPerkFlag_, so the commonest path left the flag open.
//   2. The VERA-PERK:<id>:<period> marker had exactly one occurrence in the whole
//      repo, where it is written. Nothing could find the event again, so no path
//      could have removed it.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = {
  Code: fs.readFileSync(ROOT + '/Code.js', 'utf8'),
  Web:  fs.readFileSync(ROOT + '/WebApp.js', 'utf8'),
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

const TZ = 'America/New_York';

// A calendar whose events remember whether they were deleted, so "removed" is
// observed rather than inferred from a return value.
function makeEvent(desc, title) {
  return {
    desc, title: title || 'untitled', deleted: false,
    getDescription: function () { return this.desc; },
    deleteEvent:    function () { this.deleted = true; },
  };
}
function makeCal(eventsByDay) {
  const calls = [];
  return {
    calls, eventsByDay,
    getEventsForDay: function (d) {
      const k = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      calls.push(k);
      return eventsByDay[k] || [];
    },
  };
}

function loadCode(today, opts) {
  const o = opts || {};
  const calLookups = [];
  const ctx = {
    String, Number, Object, Array, Math, JSON, RegExp, Boolean, parseInt, Error, console,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => TZ },
    Utilities: { formatDate: () => { throw new Error('unexpected formatDate'); } },
    getPrimarySharedCalendar_: () => {
      calLookups.push(1);
      if (o.calThrows) throw new Error('Calendar service unavailable');
      return o.cal === undefined ? null : o.cal;
    },
    calLookups,
  };
  if (today) {
    const Real = Date;
    function FakeDate(...a) { return a.length ? new Real(...a) : new Real(today.getTime()); }
    FakeDate.prototype = Real.prototype;
    FakeDate.now = () => today.getTime();
    ctx.Date = FakeDate;
  } else {
    ctx.Date = Date;
  }
  vm.createContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'perkPeriodKeyEnd_')).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'perkCalendarMark_')).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'deletePerkReminderEvent_')).runInContext(ctx);
  return ctx;
}

console.log('The marker is built in one place');
{
  const c = loadCode(null, {});
  check('perkCalendarMark_ produces the shape already on the calendar',
        c.perkCalendarMark_('CP-7', '2026-Q3') === 'VERA-PERK:CP-7:2026-Q3',
        c.perkCalendarMark_('CP-7', '2026-Q3'));

  // The bug was that the string existed in exactly one place and could not be
  // looked up again. It must now be built by the helper at BOTH ends and written
  // as a literal at neither.
  const literals = (SRC.Code.match(/'VERA-PERK:' \+/g) || []).length;
  check('the literal is written once, inside the helper', literals === 1, String(literals));

  const checker = extractFn(SRC.Code, 'checkCardPerksExpiring_');
  const deleter = extractFn(SRC.Code, 'deletePerkReminderEvent_');
  check('the checker builds the mark through the helper', /perkCalendarMark_\(id, periodKey\)/.test(checker));
  check('the deleter builds it through the same helper', /perkCalendarMark_\(id, pk\)/.test(deleter));
  check('…so neither carries its own copy of the format',
        !/'VERA-PERK:/.test(checker) && !/'VERA-PERK:/.test(deleter));

  // Behaviourally this line is currently redundant — null < aDate is true, so a
  // standing perk would fall out of the date check anyway. It stays, and is pinned
  // here, because resting on that coercion is a trap for whoever edits the date
  // logic next.
  check('a null period end is refused explicitly, not by coercion',
        /if \(!end\) return 0;/.test(deleter),
        'null < today happens to be true; do not rely on it');
}

console.log('\nThe pending event is removed, and only that one');
{
  const mine  = makeEvent('VERA-PERK:CP-7:2026-Q3', 'Lululemon credit expires today');
  const other = makeEvent('VERA-PERK:CP-8:2026-Q3', 'Saks credit expires today');
  const older = makeEvent('VERA-PERK:CP-7:2026-Q2', 'same perk, last quarter');
  const lookalike = makeEvent('VERA-PERK:CP-77:2026-Q3', 'a different perk whose id starts the same');
  const real  = makeEvent('', 'Dentist');
  const c = loadCode(new Date(2026, 8, 29), {
    cal: makeCal({ '2026-9-30': [mine, other, older, lookalike, real] }),
  });

  const removed = c.deletePerkReminderEvent_('CP-7', '2026-Q3');
  check('it reports one removal', removed === 1, String(removed));
  check('the perk\'s own event is gone', mine.deleted === true);
  check('another perk\'s event on the same day survives', other.deleted === false);
  check('the same perk\'s event for another period survives', older.deleted === false);
  check('CP-7 does not match CP-77', lookalike.deleted === false,
        'the trailing colon in the marker is what keeps these apart');
  check('an unrelated appointment survives', real.deleted === false,
        'this runs against the shared calendar — a false positive deletes real plans');
  check('it looked only at the period-end day', JSON.stringify(c.calLookups) !== '[]');
}

console.log('\nWhat it refuses to touch');
{
  // Already fired. The event records a deadline that really did pass.
  const past = makeEvent('VERA-PERK:CP-7:2026-Q2', 'expired in June');
  const c1 = loadCode(new Date(2026, 8, 29), { cal: makeCal({ '2026-6-30': [past] }) });
  check('a past event is left as history', c1.deletePerkReminderEvent_('CP-7', '2026-Q2') === 0);
  check('…and the event really is untouched', past.deleted === false);
  check('…without even opening the calendar', c1.calLookups.length === 0,
        'the date check must come first — this runs on every mark');

  // The day itself: the perk is usable all of Sep 30, and so the reminder is still
  // pending, not fired.
  const todays = makeEvent('VERA-PERK:CP-7:2026-Q3', 'expires today');
  const c2 = loadCode(new Date(2026, 8, 30, 9, 15), { cal: makeCal({ '2026-9-30': [todays] }) });
  check('an event for TODAY is still removed', c2.deletePerkReminderEvent_('CP-7', '2026-Q3') === 1);
  check('…even marked used late in that day', todays.deleted === true);

  const c3 = loadCode(new Date(2026, 8, 29), { cal: makeCal({}) });
  check('a standing perk has no event to remove',
        c3.deletePerkReminderEvent_('CP-9', 'standing') === 0);
  check('…and no calendar lookup is made for it', c3.calLookups.length === 0);
  check('an unparseable period is left alone', c3.deletePerkReminderEvent_('CP-9', 'whenever') === 0);
  check('a blank id or period does nothing',
        c3.deletePerkReminderEvent_('', '2026-Q3') === 0 &&
        c3.deletePerkReminderEvent_('CP-9', '') === 0);
}

console.log('\nCalendar trouble never reaches the caller');
{
  const c1 = loadCode(new Date(2026, 8, 29), {});           // no shared calendar configured
  check('no shared calendar returns 0', c1.deletePerkReminderEvent_('CP-7', '2026-Q3') === 0);

  const c2 = loadCode(new Date(2026, 8, 29), { calThrows: true });
  let threw = null, got = null;
  try { got = c2.deletePerkReminderEvent_('CP-7', '2026-Q3'); } catch (e) { threw = e.message; }
  check('a throwing calendar service is swallowed', threw === null, threw);
  check('…and reported as 0 removals', got === 0, String(got));
}

console.log('\nBoth writers now end in the same place');
{
  const toggle = extractFn(SRC.Web, 'webToggleCardPerk_');
  const mark   = extractFn(SRC.Web, 'webMarkCardPerkUsed_');
  const finish = extractFn(SRC.Web, 'finishCardPerkMarkedUsed_');

  check('finishCardPerkMarkedUsed_ resolves the flag', /resolveCardPerkFlag_\(perkId, periodKey\)/.test(finish));
  check('…and removes the event', /deletePerkReminderEvent_\(perkId, periodKey\)/.test(finish));
  check('…and closes any "available again" notice',
        /resolveCardPerkEligibleFlags_\(perkId\)/.test(finish),
        'acting on the prompt has to close it, or it sits there until the next cycle');
  check('…each guarded separately', (finish.match(/try \{/g) || []).length === 3,
        'one failing third must not skip the other two');

  check('the dashboard toggle calls it', /finishCardPerkMarkedUsed_\(r\.id, r\.period\)/.test(toggle),
        'this is the path the checkbox uses, and it did neither before');
  check('the API/Chat writer calls it too', /finishCardPerkMarkedUsed_\(r\.id, r\.period\)/.test(mark));
  check('neither writer resolves the flag on its own any more',
        !/resolveCardPerkFlag_\(/.test(toggle) && !/resolveCardPerkFlag_\(/.test(mark),
        'two copies of the cleanup is how they drifted apart in the first place');
}

console.log('\nTicking cleans up; un-ticking only writes the cell');
{
  function runToggle(lastUsed) {
    const writes = [];
    const calls = [];
    const ctx = {
      String, Object, Array, Number, Math, Boolean, console, Error,
      Logger: { log: () => {} },
      // Stands in for the real resolver, whose contract now carries `used` —
      // the toggle must branch on that and not re-derive it, because for a
      // multi-year perk "used" is a range test the toggle cannot do inline.
      // Mimics what the real one computes for this Quarterly fixture.
      resolveCardPerkRow_: () => ({
        id: 'CP-7', period: '2026-Q3', lastUsed, used: lastUsed === '2026-Q3',
        rowNum: 4, lastUsedCol: 7,
        sheet: { getRange: (r, c) => ({ setValue: v => writes.push({ r, c, v }) }) },
      }),
      finishCardPerkMarkedUsed_: (id, pk) => { calls.push([id, pk]); return { flagsResolved: 1, eventsRemoved: 1 }; },
    };
    vm.createContext(ctx);
    new vm.Script(extractFn(SRC.Web, 'webToggleCardPerk_')).runInContext(ctx);
    const out = ctx.webToggleCardPerk_({ parameter: { id: 'CP-7' } });
    return { out, writes, calls };
  }

  const on = runToggle('');            // unused -> ticking it ON
  check('ticking stamps the period', on.writes.length === 1 && on.writes[0].v === '2026-Q3');
  check('…and runs the cleanup once', on.calls.length === 1 && on.calls[0][0] === 'CP-7',
        JSON.stringify(on.calls));
  check('…reporting what it cleaned', on.out.flagsResolved === 1 && on.out.eventsRemoved === 1);
  check('…and still says the perk is used', on.out.used === true && on.out.period === '2026-Q3');

  const off = runToggle('2026-Q3');    // already used -> un-ticking it
  check('un-ticking clears the stamp', off.writes.length === 1 && off.writes[0].v === '');
  check('…and runs NO cleanup', off.calls.length === 0,
        'the flag stays resolved and the event stays gone, by decision');
  check('…and says the perk is unused', off.out.used === false);
  check('…carrying no cleanup counts at all',
        off.out.flagsResolved === undefined && off.out.eventsRemoved === undefined);
}

console.log('\nThe mark-used writer keeps its existing guards');
{
  const mark = extractFn(SRC.Web, 'webMarkCardPerkUsed_');
  check('autopay still returns before any write',
        mark.indexOf("out.reason = 'autopay'") < mark.indexOf('setValue'));
  check('standing still returns before any write',
        mark.indexOf("out.reason = 'standing'") < mark.indexOf('setValue'));
  check('standing returns before the cleanup too',
        mark.indexOf("out.reason = 'standing'") < mark.indexOf('finishCardPerkMarkedUsed_'),
        'a standing perk has no period, no flag and no event');
  check('the idempotent second call still writes nothing',
        /out\.alreadyMarked = true;[\s\S]{0,120}return out;/.test(mark));
  check('…and does not run the cleanup either',
        mark.indexOf('out.alreadyMarked = true') < mark.indexOf('finishCardPerkMarkedUsed_'),
        'cleanup belongs on the transition into used, not on every repeat mark');
  check('it still reports eventsRemoved to callers', /out\.eventsRemoved = done\.eventsRemoved;/.test(mark));
}

console.log('\nThe nightly checker is unchanged where it was already right');
{
  const checker = extractFn(SRC.Code, 'checkCardPerksExpiring_');
  const USED_GUARD = 'if (cardPerkIsUsed_(freq, lastUsed, today, tz)) return;';
  check('it still skips a perk already used this period',
        checker.indexOf(USED_GUARD) !== -1,
        'the hand-rolled lastUsed === periodKey test is now cardPerkIsUsed_');
  check('…before any flag, email or event',
        checker.indexOf(USED_GUARD) !== -1 &&
        checker.indexOf(USED_GUARD) < checker.indexOf('writeFlags'),
        'it never created the event AFTER the perk was marked — that part was right');
  check('it still dedups before creating an event', /dupExists/.test(checker));
  check('it still latches email+calendar per perk per period', /PERK_NOTIFY_/.test(checker));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
