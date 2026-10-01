// Multi-year card perks: a credit you can claim once every four years.
//
// THE BUG THIS CLOSES. Global Entry's application-fee credit appears on three of
// his cards — CP-14 AMEX Platinum, CP-17 Capital One Venture, CP-23 IHG Premier —
// and all three were marked 'Annual'. So every December VERA raised three
// High-urgency "use it or lose it, expires Dec 31" flags, emailed both mailboxes
// three times and put three events on the shared calendar, for a credit that
// cannot be claimed again for years.
//
// WHY IT IS NOT JUST A MISSING LITERAL. Every other frequency VERA tracks is
// calendar-aligned: everyone's Q3 is the same Q3, so the period belongs to the
// calendar and to nothing else. That is baked into the signature —
// cardPerkPeriodKey_(freq, date, tz) is never shown Last Used — and into four
// hand-rolled readers that each test EQUALITY against a key derived from today:
// checkCardPerksExpiring_, two sites in Chat.js, and isPerkUsed in three
// dashboard copies. A four-year credit is anchored to when YOU used it, so "used"
// stops being an equality test and becomes a range test. That is the change.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');   // this repo, wherever it is checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = {
  Code:  fs.readFileSync(ROOT + '/Code.js', 'utf8'),
  Web:   fs.readFileSync(ROOT + '/WebApp.js', 'utf8'),
  Chat:  fs.readFileSync(ROOT + '/Chat.js', 'utf8'),
  App:   fs.readFileSync(ROOT + '/docs/app.js', 'utf8'),
  Index: fs.readFileSync(ROOT + '/docs/index.html', 'utf8'),
  Lite:  fs.readFileSync(ROOT + '/docs/dashboard-lite.html', 'utf8'),
};

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  // Walk PAST the parameter list before looking for the body's opening brace.
  // `function makeUrl(base, token, params = {})` has a `{}` in its signature, and
  // matching from the first brace in the file returns the default value instead of
  // the function — which parses as "unexpected end of input", several frames away
  // from the actual cause.
  let paren = 0, afterParams = -1;
  for (let j = src.indexOf('(', start); j < src.length; j++) {
    if (src[j] === '(') paren++;
    else if (src[j] === ')') { paren--; if (paren === 0) { afterParams = j; break; } }
  }
  if (afterParams === -1) throw new Error('unbalanced parameter list: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', afterParams); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

// A real formatDate, not a stub that ignores its format string. The whole subject
// here is which day a thing lands on, and a formatter that returns a constant
// would let every assertion below pass on broken code.
function fmtDate(d, tz, f) {
  const Y = d.getFullYear(), M = d.getMonth() + 1, D = d.getDate();
  const p2 = n => String(n).padStart(2, '0');
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (f === 'yyyy')        return String(Y);
  if (f === 'M')           return String(M);
  if (f === 'yyyy-MM')     return Y + '-' + p2(M);
  if (f === 'yyyy-MM-dd')  return Y + '-' + p2(M) + '-' + p2(D);
  if (f === 'MMM d')       return MON[M - 1] + ' ' + D;
  if (f === 'MMM d, yyyy') return MON[M - 1] + ' ' + D + ', ' + Y;
  throw new Error('unstubbed format: ' + f);
}

const TZ = 'America/New_York';
const HELPERS = ['perkCycleYears_', 'perkAnchorDate_', 'cardPerkEligibleFrom_',
                 'cardPerkPeriodKey_', 'cardPerkPeriodEnd_', 'cardPerkIsUsed_'];

function helperCtx() {
  const ctx = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, Boolean,
    isFinite, isNaN, parseInt, parseFloat, Error, console,
    Logger: { log: () => {} },
    Utilities: { formatDate: fmtDate },
  };
  vm.createContext(ctx);
  vm.runInContext(HELPERS.map(n => extractFn(SRC.Code, n)).join('\n'), ctx);
  return ctx;
}

// ============================================================================
console.log('perkCycleYears_ — reading the cadence out of the frequency');
{
  const c = helperCtx();
  const y = f => c.perkCycleYears_(f);

  check("'Every 4 Years' is four years", y('Every 4 Years') === 4, y('Every 4 Years'));
  check('…case and spacing are forgiving', y('every  4  years') === 4 && y('EVERY 4 YEARS') === 4,
        'he types this into a spreadsheet cell by hand');
  check('…and it tolerates surrounding whitespace', y('  Every 4 Years  ') === 4);
  check("the singular reads too ('Every 1 Year')", y('Every 1 Year') === 1, y('Every 1 Year'));
  check('a two-digit cadence reads', y('Every 10 Years') === 10);

  // THE regression guard. Every frequency that already exists on the live sheet
  // must come back 0, because 0 is what every caller branches on to keep its
  // existing behaviour.
  ['Monthly', 'Quarterly', 'Semiannual', 'Annual', 'Standing', '', 'Whenever'].forEach(f => {
    check('…' + JSON.stringify(f) + ' is not multi-year', y(f) === 0, String(y(f)));
  });
  check('a zero cadence is not a cadence', y('Every 0 Years') === 0,
        'a perk usable every zero years is a typo, not a standing benefit');
  check('a spelled-out number is not accepted', y('Every four Years') === 0,
        'better to fall through to Monthly and be noisy than to guess at prose');
  check('it never throws on rubbish', y(null) === 0 && y(undefined) === 0 && y(7) === 0);
}

// ============================================================================
console.log('\nThe anchor, and the day the credit comes back');
{
  const c = helperCtx();

  const a = c.perkAnchorDate_('2023-12-14');
  check('a yyyy-MM-dd stamp parses to that day',
        a.getFullYear() === 2023 && a.getMonth() === 11 && a.getDate() === 14, String(a));
  check('…at local midnight', a.getHours() === 0 && a.getMinutes() === 0);

  check('a year alone is not an anchor', c.perkAnchorDate_('2023') === null,
        'this is exactly the shape an Annual row leaves behind');
  check('…nor a month', c.perkAnchorDate_('2023-12') === null);
  check('…nor a quarter', c.perkAnchorDate_('2023-Q4') === null);
  check('…nor standing', c.perkAnchorDate_('standing') === null);
  check('…nor blank', c.perkAnchorDate_('') === null);
  check('a day that does not exist is rejected, not rolled over',
        c.perkAnchorDate_('2023-02-30') === null,
        'new Date(2023,1,30) is March 2 — accepting it would shift the whole cycle');
  check('…and so is month 13', c.perkAnchorDate_('2023-13-01') === null);

  const from = c.cardPerkEligibleFrom_('2023-12-14', 4);
  check('used 14 Dec 2023 on a 4-year cycle comes back 14 Dec 2027',
        from.getFullYear() === 2027 && from.getMonth() === 11 && from.getDate() === 14,
        String(from));
  check('no anchor means no eligibility date', c.cardPerkEligibleFrom_('', 4) === null);
  check('…and neither does a cadence of zero', c.cardPerkEligibleFrom_('2023-12-14', 0) === null);

  // Feb 29 + 4 years is still Feb 29; + 1 year is not a real day and must clamp
  // back into February rather than slipping into March.
  const leap4 = c.cardPerkEligibleFrom_('2024-02-29', 4);
  check('Feb 29 + 4 years lands on Feb 29 again',
        leap4.getMonth() === 1 && leap4.getDate() === 29 && leap4.getFullYear() === 2028,
        String(leap4));
  const leap1 = c.cardPerkEligibleFrom_('2024-02-29', 1);
  check('Feb 29 + 1 year clamps to Feb 28, not Mar 1',
        leap1.getMonth() === 1 && leap1.getDate() === 28, String(leap1));
}

// ============================================================================
console.log('\ncardPerkPeriodKey_ and cardPerkPeriodEnd_ learn one frequency each');
{
  const c = helperCtx();
  const OCT1 = new Date(2026, 9, 1);

  check('a multi-year perk stamps the full DAY',
        c.cardPerkPeriodKey_('Every 4 Years', OCT1, TZ) === '2026-10-01',
        c.cardPerkPeriodKey_('Every 4 Years', OCT1, TZ));
  check('…because the stamp IS the anchor the next cycle is measured from',
        c.perkAnchorDate_(c.cardPerkPeriodKey_('Every 4 Years', OCT1, TZ)) !== null);

  check('a multi-year perk has NO period end',
        c.cardPerkPeriodEnd_('Every 4 Years', OCT1, TZ) === null,
        String(c.cardPerkPeriodEnd_('Every 4 Years', OCT1, TZ)));
  check('…which is the single line that stops the December flag/email/event',
        c.cardPerkPeriodEnd_('Every 4 Years', new Date(2026, 11, 20), TZ) === null);

  // Untouched: the five shapes already on the live sheet.
  check('Monthly is unchanged',    c.cardPerkPeriodKey_('Monthly', OCT1, TZ) === '2026-10');
  check('Quarterly is unchanged',  c.cardPerkPeriodKey_('Quarterly', OCT1, TZ) === '2026-Q4');
  check('Semiannual is unchanged', c.cardPerkPeriodKey_('Semiannual', OCT1, TZ) === '2026-H2');
  check('Annual is unchanged',     c.cardPerkPeriodKey_('Annual', OCT1, TZ) === '2026');
  check('Standing is unchanged',   c.cardPerkPeriodKey_('Standing', OCT1, TZ) === 'standing');
  check('blank still means Monthly', c.cardPerkPeriodKey_('', OCT1, TZ) === '2026-10',
        'this default is load-bearing for every existing row');
  check('Annual still ends Dec 31', c.cardPerkPeriodEnd_('Annual', OCT1, TZ).getMonth() === 11);
  check('…and the multi-year key cannot be mistaken for any of them',
        ['2026-10', '2026-Q4', '2026-H2', '2026', 'standing']
          .indexOf(c.cardPerkPeriodKey_('Every 4 Years', OCT1, TZ)) === -1);

  // A multi-year key is deliberately NOT a shape perkPeriodKeyEnd_ parses: a
  // use-anchored perk never raises an expiry flag or a calendar event, so there is
  // nothing for that function to close and null is the right answer.
  const ctx2 = helperCtx();
  vm.runInContext(extractFn(SRC.Code, 'perkPeriodKeyEnd_'), ctx2);
  check('perkPeriodKeyEnd_ does not claim to know a date-shaped key',
        ctx2.perkPeriodKeyEnd_('2026-10-01', TZ) === null,
        'null means "leave the flag alone", which is right when no flag exists');
}

// ============================================================================
console.log('\ncardPerkIsUsed_ — the boundary, both sides');
{
  const c = helperCtx();
  const used = (f, lu, d) => c.cardPerkIsUsed_(f, lu, d, TZ);

  check('the day before the cycle completes it is still used',
        used('Every 4 Years', '2023-12-14', new Date(2027, 11, 13)) === true);
  check('on the day itself it is available again',
        used('Every 4 Years', '2023-12-14', new Date(2027, 11, 14)) === false);
  check('…and after', used('Every 4 Years', '2023-12-14', new Date(2028, 0, 5)) === false);

  // The whole reason Last Used holds a full date and not just a year.
  check('1 Jan of the fourth year does NOT read as available',
        used('Every 4 Years', '2023-12-14', new Date(2027, 0, 1)) === true,
        'comparing years alone would say available eleven months early — a rejected application');
  check('the day after it was claimed it reads as used',
        used('Every 4 Years', '2023-12-14', new Date(2023, 11, 15)) === true,
        'the equality test it replaces said unused here, the very next day');

  check('no anchor reads as NOT used', used('Every 4 Years', '', new Date(2026, 9, 1)) === false,
        'a missing stamp is an absence of evidence — leave the perk visible');
  check('…and so does an anchor we cannot read',
        used('Every 4 Years', '2023', new Date(2026, 9, 1)) === false,
        'a leftover Annual stamp must not hide the perk for four years');

  // The calendar-aligned frequencies, through the same one predicate.
  const OCT1 = new Date(2026, 9, 1);
  check('Monthly: the current month reads used',   used('Monthly', '2026-10', OCT1) === true);
  check('…a past month does not',                  used('Monthly', '2026-09', OCT1) === false);
  check('Quarterly: the current quarter',          used('Quarterly', '2026-Q4', OCT1) === true);
  check('Semiannual: the current half',            used('Semiannual', '2026-H2', OCT1) === true);
  check('Annual: the current year',                used('Annual', '2026', OCT1) === true);
  check('…and last year does not',                 used('Annual', '2025', OCT1) === false);
  check('blank frequency still behaves as Monthly', used('', '2026-10', OCT1) === true);
  check('Standing is never "used"',                used('Standing', 'standing', OCT1) === false,
        'there is no period for it to be used in');
  check('a blank stamp is never used, whatever the frequency',
        ['Monthly','Quarterly','Semiannual','Annual','Every 4 Years','Standing']
          .every(f => used(f, '', OCT1) === false));

  // It must not mutate the Date it is handed — it floors a copy to midnight.
  const probe = new Date(2027, 11, 14, 13, 45, 7);
  used('Every 4 Years', '2023-12-14', probe);
  check('it leaves the caller\'s Date alone',
        probe.getHours() === 13 && probe.getMinutes() === 45,
        'nightlyRun passes a shared `today` to every step');
  check('…and a mid-afternoon clock still reads the day right',
        used('Every 4 Years', '2023-12-14', new Date(2027, 11, 13, 23, 59)) === true);
}

// ============================================================================
// The December bug, run through the real nightly checker against a fake sheet.
// ============================================================================
console.log('\nThe nightly checker: the Global Entry row, on 20 December');
{
  function sheetOf(headers, rows) {
    const all = [headers].concat(rows);
    return {
      getLastRow: () => all.length,
      getLastColumn: () => headers.length,
      getRange: (r, c, nr, nc) => ({
        getValues: () => all.slice(r - 1, r - 1 + (nr === undefined ? 1 : nr))
                             .map(row => row.slice(c - 1, c - 1 + (nc === undefined ? 1 : nc))),
      }),
    };
  }

  const PERK_H = ['ID','Card Name','Perk','Amount','Frequency','Category','Last Used','Needs Review','Autopay'];
  const CARD_H = ['ID','Card Name','Issuer','Last 4','Annual Fee','Due Day','Last Used','Owner','Auth User','Active','Statement Credit','Notes','Credit Limit'];

  // One row, one frequency, one Last Used. Returns everything the step emitted.
  function runChecker(freq, lastUsed, today) {
    const flags = [], emails = [], events = [], props = {};
    const perkRow = ['CP-14', 'AMEX Platinum', 'Global Entry / TSA PreCheck', 120,
                     freq, 'Travel', lastUsed, '', ''];
    const cardRow = ['CC-1', 'AMEX Platinum', 'Amex', '', 695, 1, '', 'Ahmed', '', 'Yes', '', '', ''];

    const ctx = {
      String, Number, Object, Array, Math, JSON, RegExp, Boolean,
      isFinite, isNaN, parseInt, parseFloat, Error, console,
      Logger: { log: () => {} },
      Utilities: { formatDate: fmtDate },
      Session: { getScriptTimeZone: () => TZ },
      TABS: { CARD_PERKS: 'Card Perks', CREDIT_CARDS: 'Credit Cards' },
      CARD_PERK_HEADERS: PERK_H,
      CREDIT_CARD_HEADERS: CARD_H,
      CONFIG: { MORNING_NUDGE_EMAIL: 'a@b.c' },
      getConfigValues: () => ({}),
      getSpreadsheet: () => ({ getSheetByName: n =>
        n === 'Card Perks' ? sheetOf(PERK_H, [perkRow]) :
        n === 'Credit Cards' ? sheetOf(CARD_H, [cardRow]) : null }),
      // The real one WRITES missing headers; the fixture's sheet already has them,
      // so this stands in with the indices they sit at.
      ensureCardPerkColumns_: () => ({ reviewCol: 8, autopayCol: 9 }),
      writeFlags: f => flags.push.apply(flags, f),
      sendVeraEmail_: (to, subj) => emails.push({ to, subj }),
      buildCardPerkEmailHtml_: () => '<html></html>',
      getPrimarySharedCalendar_: () => ({
        getEventsForDay: () => [],
        createAllDayEvent: (t, d) => { events.push({ t, d }); return { setDescription: () => {} }; },
      }),
      PropertiesService: { getScriptProperties: () => ({
        getProperty: k => props[k] || null,
        setProperty: (k, v) => { props[k] = v; },
      }) },
    };
    vm.createContext(ctx);
    vm.runInContext([
      ...HELPERS.map(n => extractFn(SRC.Code, n)),
      extractFn(SRC.Code, 'perkCalendarMark_'),
      extractFn(SRC.Code, 'checkCardPerkEligibleAgain_'),
      extractFn(SRC.Code, 'checkCardPerksExpiring_'),
      // Freeze the clock, forwarding every argument: cardPerkPeriodEnd_ builds
      // new Date(year, month, 0), and a one-arg stub turns that into 1970.
      'var __Real = Date;',
      'Date = function() {',
      '  if (arguments.length === 0) return new __Real(' + today.getTime() + ');',
      '  if (arguments.length === 1) return new __Real(arguments[0]);',
      '  return new __Real(arguments[0], arguments[1], arguments.length > 2 ? arguments[2] : 1,',
      '                    arguments[3] || 0, arguments[4] || 0, arguments[5] || 0);',
      '};',
      'Date.now = function() { return ' + today.getTime() + '; };',
    ].join('\n'), ctx);
    ctx.checkCardPerksExpiring_();
    return { flags, emails, events };
  }

  const DEC20 = new Date(2026, 11, 20);
  const DEC28 = new Date(2026, 11, 28);   // inside the 7-day email/calendar window

  // The control case: the row EXACTLY as it ships today.
  const asAnnual = runChecker('Annual', '', DEC20);
  check('marked Annual it raises the bug: a High "expires Dec 31" flag',
        asAnnual.flags.length === 1 && asAnnual.flags[0].urgency === 'High',
        JSON.stringify(asAnnual.flags));
  check('…whose wording is the part that is wrong',
        /use it or lose it/.test(asAnnual.flags[0].reason),
        'nothing is lost — the credit is simply not claimable again for years');
  const annualLate = runChecker('Annual', '', DEC28);
  check('…and inside 7 days it also emails both mailboxes',
        annualLate.emails.length === 1, String(annualLate.emails.length));
  check('…and books the deadline on the shared calendar',
        annualLate.events.length === 1,
        'three cards carry this perk, so that is three of each, every December');

  // The fix. Never claimed, so it gets nothing at all.
  const never = runChecker('Every 4 Years', '', DEC20);
  check('as Every 4 Years with no Last Used: no flag',   never.flags.length === 0,
        JSON.stringify(never.flags));
  check('…no email',    never.emails.length === 0);
  check('…no calendar event', never.events.length === 0,
        'this is the event he deleted by hand');
  const neverLate = runChecker('Every 4 Years', '', DEC28);
  check('…and none of the three even inside the 7-day window',
        neverLate.flags.length === 0 && neverLate.emails.length === 0 &&
        neverLate.events.length === 0,
        JSON.stringify(neverLate));

  // Claimed four years ago: the cycle has run out, so one Medium notice.
  const due = runChecker('Every 4 Years', '2022-06-01', DEC20);
  check('claimed 2022 and now due: exactly one flag', due.flags.length === 1,
        JSON.stringify(due.flags));
  check('…at Medium urgency', due.flags[0].urgency === 'Medium',
        'nothing is at risk; a High flag that can never expire burns the alert surface');
  check('…saying it is available again', /available again/i.test(due.flags[0].flag),
        due.flags[0].flag);
  check('…naming the card and the amount',
        /AMEX Platinum/.test(due.flags[0].flag) && /\$120/.test(due.flags[0].flag));
  check('…keyed on the anchor', due.flags[0].key === 'perk_eligible_CP-14_2022-06-01',
        due.flags[0].key);
  check('…and it sends NO email and books NO event',
        due.emails.length === 0 && due.events.length === 0,
        'there is no deadline, so there is nothing to put on a calendar');

  // Claimed last year: still inside the cycle, so silence.
  const inside = runChecker('Every 4 Years', '2025-06-01', DEC20);
  check('claimed inside the cycle: nothing at all',
        inside.flags.length === 0 && inside.emails.length === 0 && inside.events.length === 0,
        JSON.stringify(inside.flags));

  // A stale Annual-shaped stamp left on the row after the frequency changed.
  const stale = runChecker('Every 4 Years', '2023', DEC20);
  check('a leftover Annual stamp raises nothing rather than guessing',
        stale.flags.length === 0, JSON.stringify(stale.flags));

  // And the periodic path is untouched by all of this.
  const monthly = runChecker('Monthly', '', new Date(2026, 5, 28));
  check('a Monthly perk still reminds at month end',
        monthly.flags.length === 1 && monthly.flags[0].urgency === 'High',
        JSON.stringify(monthly.flags));
  const marked = runChecker('Monthly', '2026-06', new Date(2026, 5, 28));
  check('…and still goes quiet once marked used', marked.flags.length === 0);
}

// ============================================================================
console.log('\nThe notice fires once, and the next cycle is a different key');
{
  const flags = [];
  const ctx = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, Boolean,
    isFinite, isNaN, parseInt, parseFloat, Error, console,
    Logger: { log: () => {} },
    Utilities: { formatDate: fmtDate },
    writeFlags: f => flags.push.apply(flags, f),
  };
  vm.createContext(ctx);
  vm.runInContext([...HELPERS.map(n => extractFn(SRC.Code, n)),
                   extractFn(SRC.Code, 'checkCardPerkEligibleAgain_')].join('\n'), ctx);

  const row = lu => ({ id: 'CP-14', cardName: 'AMEX Platinum',
                       perkName: 'Global Entry / TSA PreCheck', amount: 120,
                       years: 4, lastUsed: lu, today: new Date(2027, 11, 20), tz: TZ });

  check('it reports writing one flag', ctx.checkCardPerkEligibleAgain_(row('2023-12-14')) === 1);
  const first = flags[flags.length - 1];
  check('…keyed perk_eligible_<id>_<anchor>', first.key === 'perk_eligible_CP-14_2023-12-14',
        first.key);
  check('…sourced to Card Perks', first.source === 'Card Perks');
  check('…and the reason names both dates',
        /Dec 14, 2023/.test(first.reason) && /Dec 14, 2027/.test(first.reason), first.reason);
  check('…and says the cadence', /every 4 years/i.test(first.reason), first.reason);
  check('…and never says use it or lose it',
        !/use it or lose it/i.test(first.reason + first.flag), first.reason);
  check('…saying the opposite outright', /Nothing expires/.test(first.reason),
        'the Annual wording on this row is what sent him to delete a calendar event');

  const again = ctx.checkCardPerkEligibleAgain_(row('2023-12-14'));
  check('a second nightly pass mints the identical key',
        again === 1 && flags[flags.length - 1].key === first.key,
        'writeFlags fingerprints on the key, so an identical key is what makes it a no-op');

  const nextCycle = ctx.checkCardPerkEligibleAgain_({ ...row('2027-12-20'), today: new Date(2031, 11, 25) });
  check('…while the NEXT cycle is a distinct key',
        nextCycle === 1 && flags[flags.length - 1].key === 'perk_eligible_CP-14_2027-12-20',
        flags[flags.length - 1].key);

  const before = flags.length;
  check('never claimed: no notice', ctx.checkCardPerkEligibleAgain_(row('')) === 0);
  check('unreadable anchor: no notice', ctx.checkCardPerkEligibleAgain_(row('2023')) === 0,
        'inventing an anchor would prompt him about credits spent before VERA existed');
  check('still inside the cycle: no notice',
        ctx.checkCardPerkEligibleAgain_({ ...row('2025-01-01'), today: new Date(2027, 11, 20) }) === 0);
  check('not a multi-year perk at all: no notice',
        ctx.checkCardPerkEligibleAgain_({ ...row('2023-12-14'), years: 0 }) === 0);
  check('…and none of those wrote a flag', flags.length === before,
        'returning 0 and writing anyway would be the worst of both');

  // The day it becomes due, exactly.
  const onDay = ctx.checkCardPerkEligibleAgain_({ ...row('2023-12-14'), today: new Date(2027, 11, 14) });
  check('the notice starts on the eligibility day itself', onDay === 1);
  const dayBefore = ctx.checkCardPerkEligibleAgain_({ ...row('2023-12-14'), today: new Date(2027, 11, 13) });
  check('…and not the day before', dayBefore === 0);
}

// ============================================================================
console.log('\nMarking it used: re-anchor, and close the notice');
{
  // The real resolver and both writers over a fake Card Perks tab.
  function harness(freq, lastUsed, now, flagRows) {
    const writes = [], outcomes = [];
    const perkRows = [
      ['ID','Card Name','Perk','Amount','Frequency','Category','Last Used','Needs Review','Autopay'],
      ['CP-1',  'AMEX Gold',     'Dunkin',       7,   'Monthly', 'Dining', '',       '', ''],
      ['CP-14', 'AMEX Platinum', 'Global Entry', 120, freq,      'Travel', lastUsed, '', ''],
    ];
    const flagVals = (flagRows || []).map(r => r.slice());
    const flagSheet = {
      getLastRow: () => flagVals.length + 1,
      getRange: (r, c, nr, nc) => ({
        getValues: () => flagVals.slice(r - 2, r - 2 + (nr || 1)).map(x => [x[c - 1]]),
        getValue: () => flagVals[r - 2][c - 1],
        setValue: v => { flagVals[r - 2][c - 1] = v; },
      }),
    };
    const perkSheet = {
      getDataRange: () => ({ getValues: () => perkRows }),
      getRange: (r, c) => ({ setValue: v => { writes.push({ r, c, v }); perkRows[r - 1][c - 1] = v; } }),
    };

    const ctx = {
      String, Number, Object, Array, Math, JSON, RegExp, Boolean,
      isFinite, isNaN, parseInt, parseFloat, Error, console,
      Logger: { log: () => {} },
      Utilities: { formatDate: fmtDate },
      Session: { getScriptTimeZone: () => TZ },
      CONFIG: { SHEET_ID: 'x' },
      TABS: { CARD_PERKS: 'Card Perks', FLAGS: 'Flags' },
      FLAG_HEADERS: ['Date', 'Source', 'Flag', 'Reason', 'Urgency', 'Resolved', 'Key'],
      SpreadsheetApp: { openById: () => ({ getSheetByName: n =>
        n === 'Card Perks' ? perkSheet : n === 'Flags' ? flagSheet : null }) },
      recordFlagOutcome_: (k, o) => outcomes.push([k, o]),
      deletePerkReminderEvent_: () => 0,
      __flagVals: flagVals,
      __writes: writes,
      __outcomes: outcomes,
    };
    vm.createContext(ctx);
    vm.runInContext([
      ...HELPERS.map(n => extractFn(SRC.Code, n)),
      extractFn(SRC.Web, 'resolveCardPerkRow_'),
      extractFn(SRC.Web, 'resolveCardPerkFlag_'),
      extractFn(SRC.Web, 'resolveCardPerkEligibleFlags_'),
      extractFn(SRC.Web, 'finishCardPerkMarkedUsed_'),
      extractFn(SRC.Web, 'webToggleCardPerk_'),
      extractFn(SRC.Web, 'webMarkCardPerkUsed_'),
      'var __Real = Date;',
      'Date = function() {',
      '  if (arguments.length === 0) return new __Real(' + now.getTime() + ');',
      '  if (arguments.length === 1) return new __Real(arguments[0]);',
      '  return new __Real(arguments[0], arguments[1], arguments.length > 2 ? arguments[2] : 1,',
      '                    arguments[3] || 0, arguments[4] || 0, arguments[5] || 0);',
      '};',
      'Date.now = function() { return ' + now.getTime() + '; };',
    ].join('\n'), ctx);
    return ctx;
  }

  const NOW = new Date(2027, 11, 20, 9, 30);
  const row = (key, resolved) => ['2027-12-01', 'Card Perks', 'f', 'r', 'Medium', resolved || '', key];

  // resolveCardPerkRow_ describes the row the way the dashboard needs it.
  {
    const c = harness('Every 4 Years', '2023-12-14', NOW);
    const r = c.resolveCardPerkRow_('CP-14');
    check('the resolver reports the cadence', r.cycleYears === 4, String(r.cycleYears));
    check('…and no period end', r.periodEnd === null && r.periodEndLabel === null);
    check('…and the day it became available', r.eligibleFromIso === '2027-12-14',
          r.eligibleFromIso);
    check('…and that it is NOT currently used', r.used === false);
    check('…and the stamp it would write is today', r.period === '2027-12-20', r.period);

    const inCycle = harness('Every 4 Years', '2025-12-14', NOW).resolveCardPerkRow_('CP-14');
    check('a perk inside its cycle reports used', inCycle.used === true);
    check('…with its return date', inCycle.eligibleFromIso === '2029-12-14', inCycle.eligibleFromIso);

    const annual = harness('Annual', '2027', NOW).resolveCardPerkRow_('CP-14');
    check('an Annual row still reports its period end',
          annual.cycleYears === 0 && annual.periodEndIso === '2027-12-31', annual.periodEndIso);
    check('…and still reads as used for the year', annual.used === true);
  }

  // The dashboard checkbox.
  {
    const c = harness('Every 4 Years', '2023-12-14', NOW, [row('perk_eligible_CP-14_2023-12-14')]);
    const out = c.webToggleCardPerk_({ parameter: { id: 'CP-14' } });
    check('ticking an available perk re-anchors it to today',
          c.__writes.length === 1 && c.__writes[0].v === '2027-12-20',
          JSON.stringify(c.__writes));
    check('…and reports it used', out.used === true);
    check('…and closes the "available again" notice',
          c.__flagVals[0][5] === 'Yes', JSON.stringify(c.__flagVals[0]));
    check('…counting it', out.eligibleResolved === 1 && out.flagsResolved === 1,
          JSON.stringify(out));
    check('…and recording the outcome as acted-on',
          c.__outcomes.length === 1 && c.__outcomes[0][1] === 'resolved',
          JSON.stringify(c.__outcomes));
  }

  // Un-ticking a mis-click, from inside the cycle.
  {
    const c = harness('Every 4 Years', '2025-12-14', NOW);
    const out = c.webToggleCardPerk_({ parameter: { id: 'CP-14' } });
    check('un-ticking a perk inside its cycle clears the anchor',
          c.__writes.length === 1 && c.__writes[0].v === '', JSON.stringify(c.__writes));
    check('…and reports it unused', out.used === false);
    check('…running no cleanup', out.eligibleResolved === undefined);
  }

  // The idempotent writer must never move an anchor it already has.
  {
    const c = harness('Every 4 Years', '2025-12-14', NOW);
    const out = c.webMarkCardPerkUsed_({ parameter: { id: 'CP-14' } });
    check('marking a perk already inside its cycle writes NOTHING',
          c.__writes.length === 0, JSON.stringify(c.__writes));
    check('…and says so', out.alreadyMarked === true && out.marked === true);
    check('…reporting when it comes back', out.eligibleFromLabel === 'Dec 14, 2029',
          out.eligibleFromLabel);
    check('…and the cadence, so Chat can phrase it', out.cycleYears === 4);
    check('…and no bogus reset date', out.periodEndLabel === null,
          '"it resets null" is worse than saying nothing');
  }
  {
    const c = harness('Every 4 Years', '2023-12-14', NOW,
                      [row('perk_eligible_CP-14_2023-12-14')]);
    const out = c.webMarkCardPerkUsed_({ parameter: { id: 'CP-14' } });
    check('marking a DUE perk stamps today', out.marked === true && out.alreadyMarked === false &&
          c.__writes[0].v === '2027-12-20', JSON.stringify(c.__writes));
    check('…and closes the notice', c.__flagVals[0][5] === 'Yes');
  }

  // Prefix matching: the CP-1 / CP-14 trap the trailing underscore exists for.
  {
    const c = harness('Every 4 Years', '2023-12-14', NOW, [
      row('perk_eligible_CP-14_2023-12-14'),
      row('perk_eligible_CP-1_2020-01-01'),
      row('perk_expiry_CP-14_2027'),
      row('perk_eligible_CP-14_2019-01-01', 'Yes'),
    ]);
    const n = c.resolveCardPerkEligibleFlags_('CP-1');
    check('resolving CP-1 touches only CP-1', n === 1 && c.__flagVals[1][5] === 'Yes',
          JSON.stringify(c.__flagVals.map(r => r[5])));
    check('…and leaves CP-14 alone', c.__flagVals[0][5] === '',
          'without the trailing underscore CP-1 would match every CP-1x perk');

    const m = c.resolveCardPerkEligibleFlags_('CP-14');
    check('resolving CP-14 closes its open notice', c.__flagVals[0][5] === 'Yes');
    check('…and does not touch its expiry flag', c.__flagVals[2][5] === '',
          'that one belongs to resolveCardPerkFlag_, which matches the exact key');
    check('…and does not re-resolve an already-closed one', m === 1, String(m));
    check('a blank id resolves nothing', c.resolveCardPerkEligibleFlags_('') === 0);
  }

  // Any anchor, not just the one that raised it: the stamp has already moved on.
  {
    const c = harness('Every 4 Years', '2023-12-14', NOW,
                      [row('perk_eligible_CP-14_2023-11-02')]);
    c.webMarkCardPerkUsed_({ parameter: { id: 'CP-14' } });
    check('a notice raised against a since-edited anchor still closes',
          c.__flagVals[0][5] === 'Yes',
          'matching the exact anchor would strand it, because the caller just overwrote it');
  }
}

// ============================================================================
console.log('\nThe dashboard: the server and the browser must agree');
{
  // The browser's copy, lifted out of docs/app.js — not retyped.
  // Anchored BACKWARDS from isPerkUsed. A coupon helper earlier in the file opens
  // with the identical `const now=new Date();`, and matching forwards from the
  // first one grabs that function instead.
  const atUsed = SRC.App.indexOf('function isPerkUsed(');
  const atPre  = SRC.App.lastIndexOf('const now=new Date();', atUsed);
  const atEnd  = SRC.App.indexOf(';', SRC.App.indexOf('const todayMid=', atPre));
  if (atUsed === -1 || atPre === -1 || atEnd === -1) {
    throw new Error('the isPerkUsed preamble was not found in docs/app.js');
  }
  const pre = [SRC.App.slice(atPre, atEnd + 1)];
  const browser = {
    String, Number, Object, Array, Date, Math, JSON, RegExp, Boolean, parseInt, console,
  };
  vm.createContext(browser);
  vm.runInContext([
    'var __Real = Date;',
    'Date = function() {',
    '  if (arguments.length === 0) return new __Real(2026, 9, 1);',
    '  if (arguments.length === 1) return new __Real(arguments[0]);',
    '  return new __Real(arguments[0], arguments[1], arguments.length > 2 ? arguments[2] : 1);',
    '};',
    pre[0],
    extractFn(SRC.App, 'perkCycleYears'),
    extractFn(SRC.App, 'perkEligibleFrom'),
    extractFn(SRC.App, 'isPerkUsed'),
    extractFn(SRC.App, 'perkGroupOf'),
    extractFn(SRC.App, 'fmtPerkDay'),
    extractFn(SRC.App, 'perkStatusLabel'),
  ].join('\n'), browser);

  const server = helperCtx();
  const OCT1 = new Date(2026, 9, 1);     // the same day the browser context is frozen to

  // THE regression guard for this change: four readers were replaced by one, and
  // the browser keeps a fifth copy because it cannot call Apps Script.
  const CASES = [
    ['Monthly', '2026-10'], ['Monthly', '2026-09'], ['Monthly', ''],
    ['Quarterly', '2026-Q4'], ['Quarterly', '2026-Q3'],
    ['Semiannual', '2026-H2'], ['Semiannual', '2026-H1'],
    ['Annual', '2026'], ['Annual', '2025'],
    ['Standing', 'standing'], ['Standing', ''],
    ['', '2026-10'], ['', '2026-09'], ['', ''],
    ['Every 4 Years', '2022-10-01'], ['Every 4 Years', '2022-10-02'],
    ['Every 4 Years', '2023-12-14'], ['Every 4 Years', '2026-10-01'],
    ['Every 4 Years', ''], ['Every 4 Years', '2023'], ['Every 4 Years', 'rubbish'],
    ['Every 1 Year', '2025-10-01'], ['Every 1 Year', '2025-10-02'],
  ];
  let agreed = 0;
  CASES.forEach(([f, lu]) => {
    const s = server.cardPerkIsUsed_(f, lu, OCT1, TZ);
    const b = browser.isPerkUsed({ frequency: f, lastUsed: lu });
    if (s === b) { agreed++; return; }
    check('server and browser agree on ' + JSON.stringify([f, lu]), false,
          'server=' + s + ' browser=' + b);
  });
  check('server and browser agree on all ' + CASES.length + ' frequency/stamp pairs',
        agreed === CASES.length, agreed + '/' + CASES.length);
  // The boundary specifically, since that is the whole point of the full date.
  check('…including the day the cycle completes',
        browser.isPerkUsed({ frequency: 'Every 4 Years', lastUsed: '2022-10-01' }) === false &&
        browser.isPerkUsed({ frequency: 'Every 4 Years', lastUsed: '2022-10-02' }) === true);
  check('…and 1 Jan of the final year is still used',
        browser.isPerkUsed({ frequency: 'Every 4 Years', lastUsed: '2022-12-31' }) === true,
        'a year comparison in the browser would show it available in January');

  check('perkGroupOf folds every cadence into one section',
        browser.perkGroupOf('Every 4 Years') === 'Multi-year' &&
        browser.perkGroupOf('Every 10 Years') === 'Multi-year',
        browser.perkGroupOf('Every 4 Years'));
  check('…and leaves the others as they were',
        ['Monthly','Quarterly','Semiannual','Annual','Standing']
          .every(f => browser.perkGroupOf(f) === f));
  check('…mapping blank to Monthly rather than nowhere',
        browser.perkGroupOf('') === 'Monthly',
        'an unlisted group renders the perk invisible with no error');

  const lbl = (f, lu) => browser.perkStatusLabel({ frequency: f, lastUsed: lu },
                                                  browser.isPerkUsed({ frequency: f, lastUsed: lu }));
  check('the label names both dates once it is used',
        /2022-10-02/.test(lbl('Every 4 Years', '2022-10-02')) &&
        /2026/.test(lbl('Every 4 Years', '2022-10-02')),
        lbl('Every 4 Years', '2022-10-02'));
  check('…and says so plainly when it is available',
        /available now/i.test(lbl('Every 4 Years', '2022-10-01')),
        lbl('Every 4 Years', '2022-10-01'));
  check('…and never says "this month" for one',
        !/this month|this year/.test(lbl('Every 4 Years', '2022-10-02')),
        'the old label read "Not used this month" for a four-year credit');
  check('a never-claimed one says the cadence',
        /once every 4 years/.test(lbl('Every 4 Years', '')), lbl('Every 4 Years', ''));
  check('an unreadable stamp asks for a date instead of lying',
        /yyyy-mm-dd/.test(lbl('Every 4 Years', '2023')), lbl('Every 4 Years', '2023'));
  check('the periodic labels are unchanged',
        lbl('Monthly', '') === 'Not used this month' &&
        lbl('Annual', '2026') === 'Used this year' &&
        lbl('Quarterly', '') === 'Not used this quarter' &&
        lbl('Semiannual', '') === 'Not used this half',
        lbl('Annual', '2026'));
}

// ============================================================================
console.log('\nAll three dashboard copies carry it');
{
  const COPIES = { 'docs/app.js': SRC.App, 'docs/index.html': SRC.Index,
                   'docs/dashboard-lite.html': SRC.Lite };
  Object.keys(COPIES).forEach(label => {
    const s = COPIES[label];
    // The silent one: a group missing from perkGroups renders nowhere, no error.
    check(label + ": 'Multi-year' is in perkGroups",
          /perkGroups\s*=\s*\[[^\]]*'Multi-year'/.test(s),
          'without this the perk is invisible in the card modal');
    check(label + ': the filter groups through perkGroupOf',
          /perkGroupOf\(p\.frequency\)\s*===\s*freq/.test(s),
          'an exact === on the frequency can never match a string carrying a number');
    check(label + ': the select offers Every 4 Years',
          /Every 4 Years<\/option>|"option",null,"Every 4 Years"/.test(s));
    check(label + ': isPerkUsed has the range branch',
          /perkEligibleFrom\(perk\.lastUsed/.test(s) && /todayMid\s*<\s*from/.test(s));
    check(label + ': the cadence parser is there',
          /function perkCycleYears\(/.test(s));
    check(label + ': the status line comes from perkStatusLabel',
          /perkStatusLabel\(pk,\s*used\)/.test(s),
          'the group name is "Multi-year", so the old freq===... ladder would say "this month"');
    check(label + ': the anchor must be a real day there too',
          /getFullYear\(\)\s*!==\s*y/.test(s),
          "'2023-02-30' silently becomes March 2 in the browser as well");
  });
  // index.html is generated from app.js; drift has shipped a dead feature before.
  check('index.html is not a stale build',
        SRC.Index.indexOf('Multi-year') !== -1 && SRC.Index.indexOf('perkStatusLabel') !== -1,
        'run node docs/build.js');
}

// ============================================================================
console.log('\nThe rest of the wiring');
{
  // Chat: both sites go through the shared predicate.
  check('the chat card context uses cardPerkIsUsed_',
        /cardPerkIsUsed_\(p\.frequency \|\| 'Monthly', p\.lastUsed, now, perkTz\)/.test(SRC.Chat));
  check('mark_perk_used picks the unused one with it too',
        /cardPerkIsUsed_\(pk\.frequency \|\| 'Monthly', pk\.lastUsed, mpNow, mpTz\)/.test(SRC.Chat));
  check('neither site still hand-rolls the equality test',
        !/lastUsed !== cardPerkPeriodKey_/.test(SRC.Chat),
        'that is the test that read a multi-year perk as unused the day after it was used');
  check('the already-marked note does not print a null reset date',
        /mpRes\.cycleYears/.test(SRC.Chat) && /eligibleFromLabel/.test(SRC.Chat),
        'periodEndLabel is null for one, and "it resets null" is worse than silence');

  // The checker reaches the eligibility notice from the row it already has.
  const checker = extractFn(SRC.Code, 'checkCardPerksExpiring_');
  check('the multi-year branch sits with the other row-level guards',
        checker.indexOf('perkCycleYears_(freq)') < checker.indexOf('cardPerkPeriodKey_'),
        'it must return before any period maths');
  check('…after the Standing guard',
        checker.indexOf("freq === 'Standing'") < checker.indexOf('perkCycleYears_(freq)'));
  check('…and it raises the notice from that same row',
        /checkCardPerkEligibleAgain_\(\{/.test(checker),
        'a second sweep would re-read both tabs to say one extra thing a year');
  check('the notice is counted in the step total',
        /flagsGenerated \+= checkCardPerkEligibleAgain_/.test(checker));

  // The seeded rows. populateCreditCardHub_ only runs on a rebuild, but shipping
  // the wrong frequency is how all three came to be Annual in the first place.
  const seeds = SRC.Code.match(/\['CP-\d+',[^\]]*Global Entry[^\]]*\]/g) || [];
  check('all three Global Entry seed rows exist', seeds.length === 3, String(seeds.length));
  check('…and every one is Every 4 Years',
        seeds.every(s => /'Every 4 Years'/.test(s)), seeds.join('\n'));
  check('…and none is still Annual', seeds.every(s => !/'Annual'/.test(s)));

  // Every root .js file shares one global scope, so a new helper must be declared
  // exactly once across all of them.
  const roots = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  ['perkCycleYears_', 'perkAnchorDate_', 'cardPerkEligibleFrom_', 'cardPerkIsUsed_',
   'checkCardPerkEligibleAgain_', 'resolveCardPerkEligibleFlags_'].forEach(name => {
    const n = roots.reduce((acc, f) => acc +
      (fs.readFileSync(path.join(ROOT, f), 'utf8')
         .match(new RegExp('^function ' + name + '\\(', 'gm')) || []).length, 0);
    check(name + ' is declared exactly once across the shared global scope',
          n === 1, String(n));
  });

  // And the docs say WHY, because the next person to add a frequency needs to know
  // that one of them is not like the others.
  const readme = fs.readFileSync(ROOT + '/README.md', 'utf8');
  check('the README explains calendar-aligned vs use-anchored',
        /use-anchored/i.test(readme) && /Every 4 Years/.test(readme));
}

// ============================================================================
// Entering the anchor by hand.
//
// He had to open the backend sheet to record when Global Entry was last claimed,
// because the perk form has a name, an amount, a frequency and an Autopay box and
// nothing else. For a calendar-aligned perk that was fine — Last Used holds a
// period key the checkbox owns. For a use-anchored perk that cell IS the cycle.
//
// The shape of the fix is forced by makeUrl in all three dashboards:
//   Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });
// A falsy value is DROPPED, not sent — so a blank arrives as undefined and reads as
// "leave this field alone". Hence a presence flag per clearable field. The same
// mechanism is why un-checking Autopay used to be a silent no-op.
// ============================================================================
console.log('\nThe writers: validating an anchor a human typed');
{
  const PERK_H = ['ID','Card Name','Perk','Amount','Frequency','Category','Last Used','Needs Review','Autopay'];

  // `now` drives the future-date guard; `rows` is the live tab.
  function harness(rows, now) {
    const writes = [], appended = [];
    const sheet = {
      getDataRange: () => ({ getValues: () => rows }),
      getRange: (r, c) => ({ setValue: v => { writes.push({ r, c, v }); rows[r - 1][c - 1] = v; } }),
      appendRow: r => appended.push(r),
      getLastColumn: () => PERK_H.length,
    };
    const ctx = {
      String, Number, Object, Array, Math, JSON, RegExp, Boolean,
      isFinite, isNaN, parseInt, parseFloat, Error, console,
      Logger: { log: () => {} },
      Utilities: { formatDate: fmtDate },
      Session: { getScriptTimeZone: () => TZ },
      CONFIG: { SHEET_ID: 'x' },
      TABS: { CARD_PERKS: 'Card Perks' },
      SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) },
      // The real one WRITES missing headers; the fixture already has them.
      ensureCardPerkColumns_: () => ({ reviewCol: 8, autopayCol: 9 }),
      __writes: writes,
      __appended: appended,
      __rows: rows,
    };
    vm.createContext(ctx);
    vm.runInContext([
      extractFn(SRC.Code, 'perkCycleYears_'),
      extractFn(SRC.Code, 'perkAnchorDate_'),
      extractFn(SRC.Web, 'perkAnchorForWrite_'),
      extractFn(SRC.Web, 'webAddCardPerk_'),
      extractFn(SRC.Web, 'webUpdateCardPerk_'),
      'var __Real = Date;',
      'Date = function() {',
      '  if (arguments.length === 0) return new __Real(' + now.getTime() + ');',
      '  if (arguments.length === 1) return new __Real(arguments[0]);',
      '  return new __Real(arguments[0], arguments[1], arguments.length > 2 ? arguments[2] : 1,',
      '                    arguments[3] || 0, arguments[4] || 0, arguments[5] || 0);',
      '};',
      'Date.now = function() { return ' + now.getTime() + '; };',
    ].join('\n'), ctx);
    return ctx;
  }

  const NOW = new Date(2026, 9, 1, 11, 0);   // 1 Oct 2026
  const freshRows = () => [
    PERK_H.slice(),
    ['CP-6',  'AMEX Platinum', 'Uber Cash',    15,  'Monthly',       'Travel', '2026-10', '', ''],
    ['CP-14', 'AMEX Platinum', 'Global Entry', 120, 'Every 4 Years', 'Travel', '2023-12-14', '', 'Yes'],
  ];
  const threw = fn => { try { fn(); return null; } catch (e) { return e.message; } };

  // ---- the validator on its own ----
  {
    const c = harness(freshRows(), NOW);
    check('a valid date on a multi-year perk is accepted',
          c.perkAnchorForWrite_('Every 4 Years', '2023-12-14') === '2023-12-14');
    check('…and whitespace is trimmed', c.perkAnchorForWrite_('Every 4 Years', ' 2023-12-14 ') === '2023-12-14');
    // A throw here must report as a failed assertion, not escape the file: these
    // run the real validator, and a control that refuses a blank would otherwise
    // crash the whole test instead of naming the behaviour it broke.
    const safe = (f, v) => { try { return c.perkAnchorForWrite_(f, v); } catch (e) { return 'THREW: ' + e.message; } };
    check('a blank is a legitimate CLEAR, not an error',
          safe('Every 4 Years', '') === '' && safe('Monthly', '') === '',
          '"I have never claimed this" is a real answer, and a wrong date you cannot take back is worse: ' +
          JSON.stringify([safe('Every 4 Years', ''), safe('Monthly', '')]));
    check('…including undefined, which is what a dropped parameter looks like',
          safe('Every 4 Years', undefined) === '', safe('Every 4 Years', undefined));

    const nonDate = threw(() => c.perkAnchorForWrite_('Every 4 Years', '2023'));
    check('a bare year is refused', nonDate !== null);
    check('…naming the expected form', /yyyy-mm-dd/.test(nonDate), nonDate);
    check('…and quoting what it got', /2023/.test(nonDate), nonDate);

    check('a rolled-over day is refused', threw(() => c.perkAnchorForWrite_('Every 4 Years', '2023-02-30')) !== null,
          'new Date(2023,1,30) is March 2 — accepting it shifts the cycle by two days');
    check('a quarter key is refused', threw(() => c.perkAnchorForWrite_('Every 4 Years', '2026-Q3')) !== null);

    const future = threw(() => c.perkAnchorForWrite_('Every 4 Years', '2033-12-14'));
    check('a future date is refused', future !== null,
          'a fat-fingered 2033 would hide the perk for fourteen years with no error anywhere');
    check('…and says so', /future/i.test(future), future);
    check('TODAY is not the future', c.perkAnchorForWrite_('Every 4 Years', '2026-10-01') === '2026-10-01',
          'he can claim a credit and record it the same day');

    ['Monthly', 'Quarterly', 'Semiannual', 'Annual', 'Standing', ''].forEach(f => {
      const m = threw(() => c.perkAnchorForWrite_(f, '2023-12-14'));
      check('a date is refused on a ' + (f || 'blank') + ' perk', m !== null,
            'those stamps are period keys the checkbox owns; a hand-typed one never matches');
    });
    check('…and the refusal points at the checkbox',
          /checkbox/i.test(threw(() => c.perkAnchorForWrite_('Monthly', '2023-12-14'))));
  }

  // ---- webUpdateCardPerk_ ----
  {
    // THE regression guard. Editing a Monthly perk's name sends every other field
    // and no flag; the stamp must survive.
    const c = harness(freshRows(), NOW);
    c.webUpdateCardPerk_({ parameter: { id: 'CP-6', perk: 'Uber Credit', amount: '15',
                                        frequency: 'Monthly', category: 'Travel' } });
    check('without the flag, Last Used is NOT touched',
          !c.__writes.some(w => w.c === 7) && c.__rows[1][6] === '2026-10',
          JSON.stringify(c.__writes));
    check('…while the other fields are written', c.__rows[1][2] === 'Uber Credit');
    check('…and Autopay is left alone too without ITS flag',
          !c.__writes.some(w => w.c === 9),
          'a caller that never mentions a field must not clear it');
  }
  {
    const c = harness(freshRows(), NOW);
    // No frequency is sent — this is the inline date box's request shape. It must be
    // judged against the ROW's 'Every 4 Years', so capture the throw rather than
    // letting it escape: a control that crashes reports nothing useful.
    const err = threw(() => c.webUpdateCardPerk_({
      parameter: { id: 'CP-14', lastUsed: '2022-06-01', lastUsedSet: 'yes' } }));
    check('…validated against the ROW\'s frequency, not a missing one', err === null,
          'defaulting to Monthly would refuse every date the inline box can send: ' + err);
    check('with the flag, the anchor is written', c.__rows[2][6] === '2022-06-01', c.__rows[2][6]);
    check('…to the header-resolved column', c.__writes.some(w => w.c === 7), JSON.stringify(c.__writes));
    check('…and nothing else is', c.__writes.length === 1, JSON.stringify(c.__writes));
  }
  {
    const c = harness(freshRows(), NOW);
    const e2 = threw(() => c.webUpdateCardPerk_({ parameter: { id: 'CP-14', lastUsedSet: 'yes' } }));
    check('clearing is not an error', e2 === null, String(e2));
    check('the flag with no value CLEARS the anchor', c.__rows[2][6] === '',
          'this is the makeUrl trap: a blank never arrives, so the flag is the only signal');
  }
  {
    const c = harness(freshRows(), NOW);
    const m = threw(() => c.webUpdateCardPerk_({ parameter: {
      id: 'CP-14', perk: 'Renamed', lastUsed: 'rubbish', lastUsedSet: 'yes' } }));
    check('a refused anchor fails the whole request', m !== null, String(m));
    check('…leaving NO field half-written', c.__writes.length === 0 && c.__rows[2][2] === 'Global Entry',
          'validate before writing, or a rejected edit still renames the perk');
  }
  {
    // Switching cadence and setting the anchor in one request must be judged by the
    // NEW frequency — the row still says Annual at that moment.
    const rows = freshRows();
    rows[1][4] = 'Annual';
    const c = harness(rows, NOW);
    c.webUpdateCardPerk_({ parameter: { id: 'CP-6', frequency: 'Every 4 Years',
                                        lastUsed: '2022-06-01', lastUsedSet: 'yes' } });
    check('a cadence change and an anchor land together',
          c.__rows[1][4] === 'Every 4 Years' && c.__rows[1][6] === '2022-06-01',
          JSON.stringify([c.__rows[1][4], c.__rows[1][6]]));
  }
  {
    // The Autopay bug: un-checking was a silent no-op because '' was dropped.
    const c = harness(freshRows(), NOW);
    c.webUpdateCardPerk_({ parameter: { id: 'CP-14', autopaySet: 'yes' } });
    check('the flag with no value turns Autopay OFF', c.__rows[2][8] === '',
          'this never worked from the form — makeUrl dropped autopay=\'\'');
    const c2 = harness(freshRows(), NOW);
    c2.webUpdateCardPerk_({ parameter: { id: 'CP-6', autopay: 'yes' } });
    check('…and the old bare parameter still turns it ON', c2.__rows[1][8] === 'Yes',
          'an existing API caller must keep working');
    const c3 = harness(freshRows(), NOW);
    c3.webUpdateCardPerk_({ parameter: { id: 'CP-14', autopay: 'yes', autopaySet: 'yes' } });
    check('…and flag plus value still sets it', c3.__rows[2][8] === 'Yes');
  }
  {
    const c = harness(freshRows(), NOW);
    check('an unknown id still throws', threw(() => c.webUpdateCardPerk_({ parameter: { id: 'CP-404' } })) !== null);
    check('…and a blank id too', threw(() => c.webUpdateCardPerk_({ parameter: {} })) !== null);
  }

  // ---- webAddCardPerk_ ----
  {
    const c = harness(freshRows(), NOW);
    c.webAddCardPerk_({ parameter: { cardName: 'AMEX Platinum', perk: 'Global Entry',
                                     amount: '120', frequency: 'Every 4 Years',
                                     category: 'Travel', lastUsed: '2022-06-01' } });
    const row = c.__appended[0];
    check('a new perk can carry its anchor', row[6] === '2022-06-01', JSON.stringify(row));
    check('…in a full-width row', row.length === PERK_H.length, String(row.length));
    check('…with the cadence intact', row[4] === 'Every 4 Years');

    const c2 = harness(freshRows(), NOW);
    c2.webAddCardPerk_({ parameter: { cardName: 'C', perk: 'Uber', frequency: 'Monthly' } });
    check('a Monthly perk is still added with a blank stamp', c2.__appended[0][6] === '');

    const c3 = harness(freshRows(), NOW);
    const m = threw(() => c3.webAddCardPerk_({ parameter: {
      cardName: 'C', perk: 'X', frequency: 'Every 4 Years', lastUsed: '2033-01-01' } }));
    check('a bad anchor refuses the add', m !== null, String(m));
    check('…before the row exists', c3.__appended.length === 0,
          'a perk created with a stamp nothing can read is worse than no perk');
  }
}

console.log('\nThe form and the row — all three dashboard copies');
{
  const COPIES = { 'docs/app.js': SRC.App, 'docs/index.html': SRC.Index,
                   'docs/dashboard-lite.html': SRC.Lite };
  Object.keys(COPIES).forEach(label => {
    const s = COPIES[label];

    check(label + ': the form field is conditional on the cadence',
          /perkCycleYears\(newPerk\.frequency\)/.test(s),
          'choose Every 4 Years and it appears — that is the whole request');
    check(label + ': …and is a date picker', /Last claimed/.test(s) && /type="date"|type:"date"/.test(s));
    check(label + ': …capped at today', /max=\{todayIso\}|max:todayIso/.test(s),
          'you cannot have claimed something in the future');
    check(label + ': the form state carries lastUsed',
          /blankPerk\s*=\s*\{[^}]*lastUsed/.test(s) &&
          /startEditPerk[\s\S]{0,400}?lastUsed:\s*pk\.lastUsed/.test(s),
          'without it, editing a perk submits a blank and clears the anchor');
    check(label + ': the select goes through setPerkFrequency',
          /setPerkFrequency\(e\.target\.value\)/.test(s),
          "otherwise a stale '2023' from an Annual row is submitted and refused");
    check(label + ': …which drops a stamp that is not a date',
          /function setPerkFrequency[\s\S]{0,300}?\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(s));

    check(label + ': a multi-year row gets a date box, not a checkbox',
          /perkCycleYears\(pk\.frequency\)\s*\?/.test(s),
          'the exact day is the point, so a one-click "today" is the wrong control');
    check(label + ': …wired to onSetPerkLastUsed',
          /onSetPerkLastUsed\(pk\.id,\s*e\.target\.value\)/.test(s));
    check(label + ': …and it is ordered after the two badges',
          s.indexOf("pk.frequency === 'Standing'") < s.indexOf('perkCycleYears(pk.frequency)') ||
          s.indexOf("pk.frequency==='Standing'") < s.indexOf('perkCycleYears(pk.frequency)'),
          'autopay and standing are exclusions and must win');
    check(label + ': a Monthly row still has its checkbox',
          /onTogglePerk\(pk\.id\)/.test(s), 'only the multi-year arm was replaced');

    check(label + ': the edit request carries both presence flags',
          /autopaySet:\s*'yes'/.test(s) && /lastUsedSet:\s*'yes'/.test(s),
          'makeUrl drops a blank, so without these, clearing either field is a silent no-op');
    check(label + ': the add request carries the anchor',
          /add_card_perk[\s\S]{0,260}?lastUsed:\s*pk\.lastUsed/.test(s));
    check(label + ': the inline box writes through the SAME action',
          /handleSetPerkLastUsed[\s\S]{0,300}?action:\s*'update_card_perk'/.test(s),
          'a second write path to that cell is how the toggle and the marker drifted apart');
    check(label + ': …sending no frequency, so the row\'s own is used',
          /handleSetPerkLastUsed[\s\S]{0,300}?lastUsedSet:\s*'yes'/.test(s) &&
          !/handleSetPerkLastUsed[\s\S]{0,300}?frequency:/.test(s));
    check(label + ': the parent actually wires the handler in',
          /onSetPerkLastUsed=\{handleSetPerkLastUsed\}|onSetPerkLastUsed:handleSetPerkLastUsed/.test(s),
          'the bare name also appears in the signature and the row, so match the wiring');
    // RUN the real makeUrl rather than matching its source: the three copies have
    // already drifted on it — app.js/index.html test
    // `v !== undefined && v !== null && v !== ''` where the lite dashboard tests
    // plain `if (v)` — and what the presence flags depend on is the BEHAVIOUR they
    // share, which is that an empty string never leaves the browser.
    {
      const mu = { URL, Object, String, console };
      vm.createContext(mu);
      vm.runInContext(extractFn(s, 'makeUrl'), mu);
      const sent = mu.makeUrl('https://x.test/exec', 'TOK',
                              { action: 'update_card_perk', id: 'CP-14', lastUsed: '' });
      check(label + ': makeUrl drops an empty value instead of sending it',
            sent.indexOf('lastUsed') === -1, sent);
      check(label + ': …which is exactly why the presence flag is needed',
            mu.makeUrl('https://x.test/exec', 'TOK', { lastUsed: '', lastUsedSet: 'yes' })
              .indexOf('lastUsedSet=yes') !== -1,
            'the flag is truthy, so it survives and says "I mean this field, blank and all"');
    }
  });
  check('index.html is not a stale build',
        SRC.Index.indexOf('setPerkFrequency') !== -1 && SRC.Index.indexOf('onSetPerkLastUsed') !== -1,
        'run node docs/build.js');

  // The modal takes the prop explicitly, so the fixture has to pass it or the
  // test renders a component whose handler is undefined. Read from REPO, not ROOT:
  // this is a sibling test, not production source, so the control harness does not
  // copy it into its mutated tree and no control mutates it.
  const cd = fs.readFileSync(REPO + '/tests/source/test_carddetail.js', 'utf8');
  check('the card-detail fixture passes onSetPerkLastUsed', /onSetPerkLastUsed/.test(cd));

  // And the single global scope: one declaration across every root .js file.
  const roots = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const n = roots.reduce((acc, f) => acc +
    (fs.readFileSync(path.join(ROOT, f), 'utf8')
       .match(/^function perkAnchorForWrite_\(/gm) || []).length, 0);
  check('perkAnchorForWrite_ is declared exactly once', n === 1, String(n));

  const readme = fs.readFileSync(ROOT + '/README.md', 'utf8');
  check('the README says how the anchor is entered',
        /Last claimed/.test(readme) && /no checkbox/i.test(readme));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
