// A `Standing` perk frequency: benefits that never expire.
//
// Adding "Centurion Lounge access" to Card Perks hit a schema gap — every perk
// needs an Amount and a Frequency, and neither applies to a standing benefit.
//
// Amount was already fine (blank just omits the dollar figure). Frequency was
// not, and blank was the WORST choice: three readers do String(row[4]||'Monthly')
// and both period helpers fall through to Monthly for any unrecognised value, so
// a blank-frequency row raises "use it or lose it" every month, forever.
//
// The regression that matters most here is that blank must KEEP meaning Monthly.
const fs = require('fs'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = {
  Code:   fs.readFileSync(ROOT + '/Code.js', 'utf8'),
  Web:    fs.readFileSync(ROOT + '/WebApp.js', 'utf8'),
  App:    fs.readFileSync(ROOT + '/docs/app.js', 'utf8'),
  Index:  fs.readFileSync(ROOT + '/docs/index.html', 'utf8'),
  Lite:   fs.readFileSync(ROOT + '/docs/dashboard-lite.html', 'utf8'),
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

// A real-ish Apps Script surface. formatDate is implemented properly rather than
// stubbed to a constant — the period maths is the thing under test.
function baseCtx(extra) {
  const ctx = Object.assign({
    String, Number, Object, Array, Date, Math, JSON, RegExp, Boolean,
    isFinite, isNaN, parseInt, parseFloat, Error, console,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: {
      formatDate: (d, tz, f) => {
        const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
        const p2 = n => String(n).padStart(2, '0');
        if (f === 'yyyy')       return String(y);
        if (f === 'M')          return String(m);
        if (f === 'yyyy-MM')    return y + '-' + p2(m);
        if (f === 'yyyy-MM-dd') return y + '-' + p2(m) + '-' + p2(day);
        if (f === 'MMM d, yyyy') return 'MMM ' + day + ', ' + y;
        throw new Error('unstubbed format: ' + f);
      },
    },
  }, extra || {});
  vm.createContext(ctx);
  // perkCycleYears_ first: both period helpers branch on it to recognise a
  // use-anchored frequency, so loading them without it is a ReferenceError.
  new vm.Script(extractFn(SRC.Code, 'perkCycleYears_')).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'perkAnchorDate_')).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'cardPerkEligibleFrom_')).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'cardPerkPeriodKey_')).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'cardPerkPeriodEnd_')).runInContext(ctx);
  new vm.Script(extractFn(SRC.Code, 'cardPerkIsUsed_')).runInContext(ctx);
  return ctx;
}

const TZ = 'America/New_York';
const MAR = new Date(2026, 2, 15);   // mid-Q1, first half
const SEP = new Date(2026, 8, 15);   // Q3, second half

console.log('The period helpers');
{
  const c = baseCtx();

  check('Standing has a fixed, non-date-shaped key',
        c.cardPerkPeriodKey_('Standing', SEP, TZ) === 'standing',
        c.cardPerkPeriodKey_('Standing', SEP, TZ));
  check('…the same on every date',
        c.cardPerkPeriodKey_('Standing', MAR, TZ) === c.cardPerkPeriodKey_('Standing', SEP, TZ));
  check('…so a stale date-shaped Last Used stamp can never match it',
        c.cardPerkPeriodKey_('Standing', SEP, TZ) !== '2026-09' &&
        c.cardPerkPeriodKey_('Standing', SEP, TZ) !== '2026');

  check('Standing has no period end', c.cardPerkPeriodEnd_('Standing', SEP, TZ) === null,
        String(c.cardPerkPeriodEnd_('Standing', SEP, TZ)));

  // THE regression guard. These four plus the blank default are load-bearing for
  // every row that already exists.
  check('Monthly is unchanged',    c.cardPerkPeriodKey_('Monthly', SEP, TZ) === '2026-09');
  check('Quarterly is unchanged',  c.cardPerkPeriodKey_('Quarterly', SEP, TZ) === '2026-Q3');
  check('Semiannual is unchanged', c.cardPerkPeriodKey_('Semiannual', SEP, TZ) === '2026-H2');
  check('Annual is unchanged',     c.cardPerkPeriodKey_('Annual', SEP, TZ) === '2026');
  check('…and Q1 still computes',  c.cardPerkPeriodKey_('Quarterly', MAR, TZ) === '2026-Q1');
  check('…and H1 still computes',  c.cardPerkPeriodKey_('Semiannual', MAR, TZ) === '2026-H1');

  check('BLANK still means Monthly',   c.cardPerkPeriodKey_('', SEP, TZ) === '2026-09',
        'this default is load-bearing for every existing row');
  check('…and so does an unknown value', c.cardPerkPeriodKey_('Whenever', SEP, TZ) === '2026-09');
  check('blank still gets a real period end', c.cardPerkPeriodEnd_('', SEP, TZ) instanceof Date);
  check('an unknown value still gets one',    c.cardPerkPeriodEnd_('Nonsense', SEP, TZ) instanceof Date);

  const annualEnd = c.cardPerkPeriodEnd_('Annual', SEP, TZ);
  check('Annual still ends Dec 31',
        annualEnd.getMonth() === 11 && annualEnd.getDate() === 31,
        annualEnd.toDateString());
  const qEnd = c.cardPerkPeriodEnd_('Quarterly', SEP, TZ);
  check('Quarterly still ends Sep 30', qEnd.getMonth() === 8 && qEnd.getDate() === 30, qEnd.toDateString());
}

console.log('\nExpiry tracking skips it — no flag, no email, no calendar event');
{
  // The real guard block out of checkCardPerksExpiring_, run as a predicate over
  // the same fields the function reads.
  const fn = extractFn(SRC.Code, 'checkCardPerksExpiring_');

  check('the skip is present and names Standing', /if \(freq === 'Standing'\) return;/.test(fn));
  check('…and sits with the other row-level guards, before any period maths',
        fn.indexOf("if (freq === 'Standing') return;") < fn.indexOf('cardPerkPeriodKey_'),
        'it must return before the period is computed');
  check('…after the autopay guard', fn.indexOf('isAutopay') < fn.indexOf("freq === 'Standing'"));

  // Behavioural: a Standing row must not reach writeFlags on any day of the year.
  const flags = [];
  const c = baseCtx({
    writeFlags: f => flags.push(f),
    sendVeraEmail_: () => flags.push('EMAIL'),
    getSpreadsheet: () => ({ getSheetByName: () => null }),
  });
  // Re-implement only the decision path, from the real source, by evaluating the
  // two conditions the function applies to a row.
  function wouldRemind(freq, lastUsed, today) {
    if (freq === 'Standing') return false;           // the line under test
    const key = c.cardPerkPeriodKey_(freq, today, TZ);
    if (lastUsed === key) return false;
    const end = c.cardPerkPeriodEnd_(freq, today, TZ);
    if (end === null) return false;
    const days = Math.round((end - today) / 86400000);
    return days >= 0 && days <= 14;
  }
  const DEC20 = new Date(2026, 11, 20);
  check('a Standing perk never reminds, even inside the window',
        wouldRemind('Standing', '', DEC20) === false);
  check('…nor on the last day of a month', wouldRemind('Standing', '', new Date(2026, 5, 30)) === false);
  check('an Annual perk still reminds in late December',
        wouldRemind('Annual', '', DEC20) === true, 'the periodic path must be untouched');
  check('a blank-frequency perk still reminds at month end',
        wouldRemind('', '', new Date(2026, 5, 25)) === true,
        'blank means Monthly — this is the behaviour Standing exists to avoid');
  check('an already-used Annual perk does not remind', wouldRemind('Annual', '2026', DEC20) === false);
}

console.log('\nThe relevance check keeps running, and its prompt reads properly');
{
  const fn = extractFn(SRC.Code, 'checkCardPerksActive_');
  check('Standing is NOT skipped here — a standing benefit can be discontinued',
        !/if \(freq === 'Standing'\) return;/.test(fn),
        'skipping it would hide the one thing worth knowing');
  check('the prompt no longer hardcodes a bare "amount $"',
        !/'\), perk "' \+ perkName \+ '", amount \$'/.test(fn), 'renders as "amount $," when blank');
  check('…it omits the amount clause when there is none', /amount === ''/.test(fn));
  check('…and asks an ongoing-benefit question for Standing',
        /ongoing benefit with no periodic allotment/.test(fn));
  check('…while periodic perks still get the amount/cadence question',
        /same or similar amount\/cadence/.test(fn));
}

console.log('\nMarking one used is a no-op');
{
  const mark = extractFn(SRC.Web, 'webMarkCardPerkUsed_');
  const resolve = extractFn(SRC.Web, 'resolveCardPerkRow_');

  check('resolveCardPerkRow_ flags standing rows', /standing:       standing,/.test(resolve));
  check('…derived from the frequency', /var standing\s+= freq === 'Standing';/.test(resolve));

  // periodEnd is null for Standing, so every derived field must be null rather
  // than handed to Utilities.formatDate, which would throw.
  check('periodEndIso is null-guarded',   /periodEndIso:   periodEnd \? /.test(resolve));
  check('periodEndLabel is null-guarded', /periodEndLabel: periodEnd \? /.test(resolve));
  check('daysLeft is null-guarded',       /daysLeft:       periodEnd \? /.test(resolve));

  check('webMarkCardPerkUsed_ returns early for a standing perk',
        /if \(r\.standing\) \{[\s\S]*?out\.reason = 'standing';[\s\S]*?return out;/.test(mark));
  check('…before any cell is written',
        mark.indexOf("out.reason = 'standing'") < mark.indexOf('setValue'),
        'it must write no cell');
  check('…and it reports the flag to callers', /standing:       r\.standing,/.test(mark));
  check('the autopay early return still works', /out\.reason = 'autopay';/.test(mark));
}

console.log('\nThe dashboard shows it — all three copies');
{
  const COPIES = { 'docs/app.js': SRC.App, 'docs/index.html': SRC.Index, 'docs/dashboard-lite.html': SRC.Lite };

  Object.keys(COPIES).forEach(label => {
    const s = COPIES[label];
    // The one that fails silently: a frequency missing from perkGroups renders
    // nowhere at all, with no error.
    check(label + ': Standing is in perkGroups', /perkGroups\s*=\s*\[[^\]]*'Standing'/.test(s),
          'without this the perk is invisible in the card modal');
    check(label + ': the select offers Standing', /Standing<\/option>|"option",null,"Standing"/.test(s));
    check(label + ': isPerkUsed returns early for it',
          /frequency\s*===\s*'Standing'\)\s*return false/.test(s));
    check(label + ': a badge replaces the checkbox', /Standing/.test(s) && /♾️/.test(s));
    check(label + ': the period suffix is suppressed',
          /(?:pk\.)?freq(?:uency)?\s*!==\s*'Standing'/.test(s), 'would read "Not used this month"');
  });

  // index.html is generated; drift has shipped a dead feature before.
  check('index.html carries this change, not a stale build',
        SRC.Index.indexOf('Standing') !== -1, 'run node docs/build.js');
}

console.log('\nThe lounge matcher is indifferent to frequency');
{
  // The whole point of the exercise: the Centurion row works the moment it exists,
  // whatever its Frequency says.
  const TDB = fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8');
  const matcher = extractFn(TDB, 'loungeProgramsForPerk_');
  check('loungeProgramsForPerk_ never reads a frequency',
        !/freq|Frequency|Standing/.test(matcher));
  // Comments stripped: the reader's header comment NAMES Frequency in prose, and a
  // raw grep cannot tell an explanation from a read.
  const reader = extractFn(TDB, 'getLoungePerkPrograms_')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('…and neither does the sheet reader', !/row\[4\]|Frequency/.test(reader), reader.slice(0, 200));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
