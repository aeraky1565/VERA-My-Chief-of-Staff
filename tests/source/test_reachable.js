// Is every scheduled-looking function actually scheduled?
//
// checkImportantDates_ was defined, complete and tested, and had never run: its
// only caller was testCheckImportantDates(), a manual editor helper. The
// calendar half of the same feature WAS wired, so dates appeared on the
// calendar and were simply never flagged — a half-working feature, which is the
// kind that goes unnoticed longest.
//
// This is that sweep, made permanent.
const fs = require('fs'), path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

function extract(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) return '';
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  return '';
}

const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && f !== 'playwright.config.js');
const src = {};
files.forEach(f => { src[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
const ALL = files.map(f => src[f]).join('\n');

// The scheduled entry points, plus anything Apps Script invokes by NAME STRING
// through a trigger — runEmailScan_ is only reachable that way, and reading it
// as unreachable is how a sweep like this produces false alarms.
const CODE = src['Code.js'];
const ENTRIES = ['nightlyRun', 'morningNudge', 'hourlyCheck'];
const triggerNames = (ALL.match(/ScriptApp\.newTrigger\('([A-Za-z0-9_]+)'\)/g) || [])
  .map(m => m.replace(/.*'([A-Za-z0-9_]+)'.*/, '$1'));

// An entry point is not necessarily in Code.js — hourlyCheck lives in
// Reminders.js, beside the rules it dispatches.
function findEntry(name) {
  for (const f of files) { const body = extract(src[f], name); if (body) return body; }
  return '';
}

console.log('\nthe entry points themselves');
{
  ENTRIES.forEach(e => check(e + ' exists', findEntry(e).length > 0));
  check('triggers are registered by name', triggerNames.length >= 5, triggerNames.join(', '));
}

// Everything reachable from an entry point, one hop deep through the entry's
// own body plus the bodies of what it calls.
const entryBodies = ENTRIES.map(findEntry).join('\n');
const directlyCalled = new Set();
(entryBodies.match(/\b([A-Za-z0-9_]+)\s*\(/g) || [])
  .forEach(m => directlyCalled.add(m.replace(/\s*\($/, '')));
triggerNames.forEach(n => directlyCalled.add(n));

// One more hop: a step the entry calls may itself call the worker.
let secondHop = '';
directlyCalled.forEach(fn => { files.forEach(f => { secondHop += extract(src[f], fn); }); });
const reachableText = entryBodies + '\n' + secondHop;

function isReachable(fn) {
  if (directlyCalled.has(fn)) return true;
  return new RegExp('\\b' + fn + '\\s*\\(').test(reachableText);
}

console.log('\nitem 1 — checkImportantDates_ now runs');
{
  const nightly = extract(CODE, 'nightlyRun');
  check('nightlyRun calls it', /\bcheckImportantDates_\s*\(/.test(nightly));
  check('…and calls the calendar sync too', /\bsyncImportantDatesToCalendar_\s*\(/.test(nightly));

  // Order matters: a date placed on the calendar this run should also be
  // considered for a flag on the same run.
  const syncAt  = nightly.indexOf('syncImportantDatesToCalendar_(');
  const checkAt = nightly.indexOf('checkImportantDates_(');
  check('the sync runs BEFORE the check', syncAt !== -1 && checkAt > syncAt,
        'sync@' + syncAt + ' check@' + checkAt);

  // It is wrapped like every other step, so a throw cannot take the night down.
  const around = nightly.slice(Math.max(0, checkAt - 400), checkAt + 300);
  check('it is wrapped in try/catch', /try\s*\{\s*checkImportantDates_\(\);/.test(around), '');
  check('…and records the failure', /stepFailures\.push\('checkImportantDates_/.test(around));
}

console.log('\nwriteFlags is the right choice here');
{
  // upsertKeyedFlags_ exists for TIERED flags, where keysAreSimilar_'s
  // digit-stripping would collapse _60d/_14d/_1d into one. This engine raises
  // one flag per date whose wording moves from "in 30 days" to "tomorrow", so
  // that same dedup is the behaviour wanted, not a trap.
  const ID = src['ImportantDates.js'];
  check('checkImportantDates_ uses writeFlags', /writeFlags\(/.test(extract(ID, 'checkImportantDates_')));
  check('…and one flag per date, not per tier',
        (extract(ID, 'checkImportantDates_').match(/flags\.push\(/g) || []).length <= 2,
        'flags.push count');
}

console.log('\nnothing else is quietly dead');
{
  // Tracing the call graph was the wrong tool. Reminders.js dispatches through
  // an array of closures inside runAnticipatorRules_ (Reminders.js:90), and
  // Growth/Pacing/Experiments do similar — so a hop-counting sweep called 19
  // working features dead. A check that cries wolf gets ignored, which would
  // have defeated the point.
  //
  // The real question is narrower and answerable without a call graph: is this
  // function referenced ANYWHERE outside its own definition and outside a test
  // helper? That is exactly what was true of checkImportantDates_ — its only
  // caller was testCheckImportantDates() — and it cannot false-positive on a
  // dispatcher.
  const testHelpers = [];
  files.forEach(f => {
    const re = /^function (test[A-Za-z0-9_]*)\s*\(/gm;
    let m;
    while ((m = re.exec(src[f])) !== null) testHelpers.push(extract(src[f], m[1]));
  });
  const testText = testHelpers.join('\n');

  const defined = [];
  files.forEach(f => {
    const re = /^function ((?:check|sync)[A-Za-z0-9_]*_)\s*\(/gm;
    let m;
    while ((m = re.exec(src[f])) !== null) defined.push([m[1], f]);
  });

  const orphans = defined.filter(([fn]) => {
    const callRe = new RegExp('\\b' + fn + '\\s*\\(', 'g');
    const total  = (ALL.match(callRe) || []).length;      // includes the definition
    const inTest = (testText.match(callRe) || []).length;
    return (total - inTest) <= 1;                          // definition only
  });

  console.log('       ' + defined.length + ' check*_/sync*_ functions, ' +
              orphans.length + ' called only from a test helper (or not at all)');
  orphans.forEach(([fn, f]) => console.log('         \u00b7 ' + fn + '   (' + f + ')'));

  check('checkImportantDates_ is no longer among them',
        !orphans.some(([fn]) => fn === 'checkImportantDates_'),
        orphans.map(o => o[0]).join(', '));

  // Known, pending its own decision. Named so the count below means something.
  const ACCEPTED = ['checkGoalHealth_'];
  const unexpected = orphans.filter(([fn]) => ACCEPTED.indexOf(fn) === -1);
  check('no UNEXPECTED dead functions', unexpected.length === 0,
        unexpected.map(o => o[0] + ' (' + o[1] + ')').join(', '));

  // The false-positive guard, kept as an assertion so the sweep can never
  // regress into crying wolf again.
  const dispatched = ['checkHydration_', 'checkBillsDue_', 'checkErgonomicBreak_'];
  check('closure-dispatched functions are NOT called dead',
        dispatched.every(fn => !orphans.some(([o]) => o === fn)),
        'Reminders.js dispatches these through an array of closures');
}

console.log('\nthe sweep does not cry wolf');
{
  // runEmailScan_ is reachable ONLY as a trigger name string. A sweep that
  // missed that would report a working feature as dead, which is how this kind
  // of check gets ignored.
  check('a trigger-name-only function counts as reachable', isReachable('runEmailScan_'));
  check('a nightly step counts as reachable', isReachable('checkTripDecisions_'));
  check('a second-hop function counts as reachable', isReachable('checkTripDecisionPremises_'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
