// TestBench.js — the index of manual test entry points.
//
// This file is almost entirely callouts, so it has exactly one interesting
// failure mode: a callout to a function that does not exist. In Apps Script
// that is not a parse error — it fails at run time, in the editor, with
// "ReferenceError: x is not defined", which is precisely the moment you were
// trying to test something else. A dead callout makes the index worse than no
// index, because you trust it.
//
// So the main assertion is boring and total: every function TestBench calls is
// declared somewhere in the codebase. It already caught two real ones —
// checkPostTripCaptures_ (the real name is singular) and a .count read off a
// function that returns .recs.
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;
const TB   = fs.readFileSync(ROOT + '/TestBench.js', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const PEERS = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.js') && f !== 'TestBench.js')
  .map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);

// ---- stripping ------------------------------------------------------------
// Comments AND string literals have to go. Without the strings, tbBanner_(
// 'Discoveries (recommendations)') reads as calls to Discoveries() and
// recommendation() — three false alarms that would train you to ignore this
// test, which is the only way a real one gets through.
function strip(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 2; out += ' '; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i);     i = e === -1 ? src.length : e;     out += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < src.length && src[i] !== c) i += (src[i] === '\\' ? 2 : 1);
      i++; out += '""'; continue;
    }
    out += c; i++;
  }
  return out;
}

// Anything the V8 runtime or a method call provides — not a global we own.
const AMBIENT = new Set([
  'function','if','for','while','switch','catch','return','typeof','new','do','else',
  'String','Number','Object','Array','Date','JSON','Math','parseInt','parseFloat','isNaN','Error','Boolean','RegExp',
  'Logger','Utilities','Session','SpreadsheetApp','CalendarApp','GmailApp','MailApp','UrlFetchApp',
  'PropertiesService','ContentService','HtmlService','ScriptApp','DriveApp','CacheService','LockService',
]);

// Column 0 only — the same rule test_globals.js uses. An indented `var ss` is a
// function-local; counting those made every file look like it redeclared half
// the codebase, and buried the one collision that would actually matter.
function declaredNames(src) {
  const s = new Set();
  let m, r;
  r = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;        while ((m = r.exec(src))) s.add(m[1]);
  r = /^(?:const|var|let)\s+([A-Za-z_$][\w$]*)\s*=/gm; while ((m = r.exec(src))) s.add(m[1]);
  return s;
}

const peerDecls = new Map();
PEERS.forEach(([f, src]) => declaredNames(src).forEach(n => { if (!peerDecls.has(n)) peerDecls.set(n, f); }));
const tbDecls = declaredNames(TB);

// Calls, minus method calls (`.foo(`) — those are resolved by the receiver.
function callsIn(src) {
  const code = strip(src), s = new Set();
  let m, r = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = r.exec(code))) if (!AMBIENT.has(m[2])) s.add(m[2]);
  return s;
}

// ============ the point of the file ========================================

console.log('\nevery callout resolves');
{
  const unresolved = [...callsIn(TB)].filter(n => !tbDecls.has(n) && !peerDecls.has(n)).sort();
  check('no call to a function that does not exist', unresolved.length === 0, unresolved.join(', '));

  // Negative control. Without this, the sweep above passes just as happily on
  // a file with no calls in it at all, or on a stripper that ate everything.
  const sabotaged = TB.replace('function tbApiHealth() {', 'function tbApiHealth() {\n  debugApiHelth();');
  const broken = [...callsIn(sabotaged)].filter(n => !tbDecls.has(n) && !peerDecls.has(n));
  check('control: a typo IS caught', broken.indexOf('debugApiHelth') !== -1, broken.join(', '));
  check('control: and the string literals are not false alarms',
        broken.length === 1, broken.join(', '));
}

console.log('\n…and nothing here shadows an existing global');
{
  // Every root .js shares ONE global scope, so a duplicate declaration silently
  // wins over the original and the loser's callers break somewhere else.
  const clash = [...tbDecls].filter(n => peerDecls.has(n)).map(n => n + ' (also ' + peerDecls.get(n) + ')');
  check('no redeclaration', clash.length === 0, clash.join(', '));
}

// ============ reachable from the Run menu ==================================

console.log('\nthe entries are reachable, the helpers are not');
{
  const entries = [...tbDecls].filter(n => /^tb/.test(n) && !n.endsWith('_'));
  const helpers = [...tbDecls].filter(n => /^tb/.test(n) && n.endsWith('_'));
  check('there are entries at all', entries.length >= 20, entries.length);
  check('…none ends in _ — the Run menu hides those', entries.every(n => !n.endsWith('_')));
  check('the private helpers are private', helpers.length >= 2 && helpers.every(n => n.endsWith('_')),
        helpers.join(', '));
  check('every entry is a top-level function declaration',
        entries.every(n => new RegExp('^function ' + n + '\\(\\)', 'm').test(TB)));
  // An entry with no banner gives you a log you cannot tell apart from the
  // previous run's.
  const noBanner = entries.filter(n => {
    const i = TB.indexOf('function ' + n + '(');
    return TB.slice(i, i + 400).indexOf('tbBanner_(') === -1;
  });
  check('every entry announces itself', noBanner.length === 0, noBanner.join(', '));
}

// ============ the knobs ====================================================

console.log('\nevery knob is declared and actually read');
{
  const knobs = [...tbDecls].filter(n => /^TB_/.test(n));
  // Named, not counted: a hardcoded count breaks on every knob added later
  // without telling you anything. The loop below covers any extras.
  ['TB_DATE', 'TB_PRETRIP_HOURS', 'TB_TRIP_LABEL', 'TB_AIRPORTS'].forEach(k => {
    check(k + ' is declared', knobs.indexOf(k) !== -1, knobs.join(', '));
  });
  knobs.forEach(k => {
    // Declared once, used at least once more.
    const uses = (TB.match(new RegExp('\\b' + k + '\\b', 'g')) || []).length;
    check(k + ' is read, not just declared', uses >= 2, uses + ' occurrence(s)');
  });
  check('they are var, not const — the point is to edit them',
        knobs.every(k => new RegExp('^var ' + k + ' =', 'm').test(TB)));
}

// ============ the overrides TestBench depends on ============================

console.log('\nthe date/window overrides it passes are honoured');
{
  const TD = fs.readFileSync(ROOT + '/TravelDayBriefing.js', 'utf8');
  const PT = fs.readFileSync(ROOT + '/PreTripBriefing.js', 'utf8');

  check('checkAndSendTravelDayBriefings_ takes opts',
        /function checkAndSendTravelDayBriefings_\(opts\)/.test(TD));
  check('…and reads dateOverride off it', /opts\.dateOverride/.test(TD));
  check('…and TestBench passes that exact key', /dateOverride:\s*TB_DATE/.test(TB));

  check('checkPreTripBriefings_ takes opts', /function checkPreTripBriefings_\(opts\)/.test(PT));
  check('…and reads hoursOverride off it', /opts\.hoursOverride/.test(PT));
  check('…and TestBench passes that exact key', /hoursOverride:\s*TB_PRETRIP_HOURS/.test(TB));

  // The scheduled callers must still work with no argument at all.
  check('a bare call is still safe in TravelDayBriefing',
        /\(opts && opts\.dateOverride\)/.test(TD));
  check('a bare call is still safe in PreTripBriefing',
        /\(opts && opts\.hoursOverride\)/.test(PT));
}

// ============ the dedup clearing ===========================================

console.log('\nthe flag prefixes it clears match the keys those features write');
{
  const PTC = fs.readFileSync(ROOT + '/PostTripCapture.js', 'utf8');
  const PTB = fs.readFileSync(ROOT + '/PreTripBriefing.js', 'utf8');

  // A prefix that matches nothing clears nothing, the flag fingerprint still
  // matches, and the test silently does nothing at all — which looks exactly
  // like "no trip qualified".
  const prefixes = [...TB.matchAll(/tbClearFlagsByKeyPrefix_\('([^']+)'\)/g)].map(m => m[1]);
  check('it clears two prefixes', prefixes.length === 2, prefixes.join(', '));
  // The flag key is now built by tripFlagKey_ so it follows the Trip ID rather
  // than the key string, but the PREFIX is unchanged and is still what has to
  // match: a prefix that matches nothing clears nothing, silently.
  check('the pre-trip prefix is the one PreTripBriefing writes',
        prefixes.indexOf('pretrip_briefing_') !== -1 &&
        /tripFlagKey_\('pretrip_briefing_'/.test(PTB),
        prefixes.join(', '));
  check('the post-trip prefix is the one PostTripCapture writes',
        prefixes.indexOf('posttrip_capture_') !== -1 &&
        /tripFlagKey_\('posttrip_capture_'/.test(PTC),
        prefixes.join(', '));

  // Column J. Off by one and it reads Resolved or Escalated and deletes rows
  // that merely say FALSE.
  const CODE = fs.readFileSync(ROOT + '/Code.js', 'utf8');
  const hdrs = eval(CODE.match(/^const FLAG_HEADERS\s*=\s*(\[[^\]]*\])/m)[1]);
  check('Key really is column ' + (hdrs.indexOf('Key') + 1),
        new RegExp('getRange\\(2,\\s*' + (hdrs.indexOf('Key') + 1) + ',').test(TB),
        'FLAG_HEADERS: ' + hdrs.join(','));
}

console.log('\ntbClearFlagsByKeyPrefix_ deletes the right rows, bottom-up');
{
  // Deleting top-down shifts every row below the one you removed, so the second
  // match of a pair is always the wrong row — and the survivor is a real flag.
  function runClear(keys, prefix) {
    const rows = keys.slice();
    const ctx = {
      String, Logger: { log() {} },
      TABS: { FLAGS: 'Flags' },
      getSpreadsheet: () => ({ getSheetByName: () => ({
        getLastRow: () => rows.length + 1,
        getRange: (r, c, n) => ({ getValues: () => rows.slice(r - 2, r - 2 + n).map(k => [k]) }),
        deleteRow: rn => rows.splice(rn - 2, 1),
      })}),
    };
    vm.createContext(ctx);
    const i = TB.indexOf('function tbClearFlagsByKeyPrefix_(');
    let depth = 0, end = i;
    for (let j = TB.indexOf('{', i); j < TB.length; j++) {
      if (TB[j] === '{') depth++;
      else if (TB[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
    }
    vm.runInContext(TB.slice(i, end), ctx);
    ctx.__p = prefix;
    const removed = vm.runInContext('tbClearFlagsByKeyPrefix_(__p)', ctx);
    return { removed, left: rows };
  }

  const r = runClear(
    ['pretrip_briefing_a', 'gym_low_week', 'pretrip_briefing_b', 'pretrip_briefing_c', 'bill_due_rent'],
    'pretrip_briefing_');
  check('it removes every match', r.removed === 3, r.removed);
  check('…and leaves the unrelated flags alone',
        JSON.stringify(r.left) === JSON.stringify(['gym_low_week', 'bill_due_rent']),
        JSON.stringify(r.left));

  const empty = runClear([], 'pretrip_briefing_');
  check('an empty Flags tab is not an error', empty.removed === 0);

  const none = runClear(['gym_low_week'], 'pretrip_briefing_');
  check('a prefix that matches nothing removes nothing', none.removed === 0 && none.left.length === 1);
}

// ============ the README index ==============================================

console.log('\nthe README lists exactly the entries that exist');
{
  // The README table is the version of this index you read before opening the
  // editor. If it lists an entry that was renamed, you go looking for it in a
  // 200-function dropdown; if it omits one, the entry may as well not exist.
  const RM  = fs.readFileSync(ROOT + '/README.md', 'utf8');
  const sec = RM.slice(RM.indexOf('## Running Things by Hand'),
                       RM.indexOf('## Flag System'));
  check('the section is there', sec.length > 500, sec.length);

  const listed  = new Set([...sec.matchAll(/`(tb[A-Z][\w]*)`/g)].map(m => m[1]));
  const entries = new Set([...tbDecls].filter(n => /^tb[A-Z]/.test(n) && !n.endsWith('_')));

  const undocumented = [...entries].filter(n => !listed.has(n)).sort();
  const phantom      = [...listed].filter(n => !entries.has(n)).sort();
  check('every entry is documented', undocumented.length === 0, undocumented.join(', '));
  check('…and nothing documented has gone missing', phantom.length === 0, phantom.join(', '));

  [...tbDecls].filter(n => /^TB_/.test(n)).forEach(k => {
    check(k + ' is explained', sec.indexOf('`' + k + '`') !== -1);
  });
}

// ============ the one thing that must NOT send ==============================

console.log('\nthe weekend memo dry run really is dry');
{
  const dry = TB.slice(TB.indexOf('function tbWeekendMemoDryRun()'),
                       TB.indexOf('function tbWeekendMemoSend()'));
  check('it calls the dry-run wrapper', /testWeekendMemo\(\)/.test(dry));
  check('…and not the real planner', !/runWeekendPlanner_\(/.test(dry));
  check('…and says so in its banner', /DRY RUN/.test(dry));

  const send = TB.slice(TB.indexOf('function tbWeekendMemoSend()'));
  check('the real-send entry clears the cooldown first',
        send.indexOf("clearReminderEntry_('weekend_planner')") <
        send.indexOf('runWeekendPlanner_()'));
  check('…and is labelled a REAL SEND', /REAL SEND/.test(send.slice(0, 300)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
