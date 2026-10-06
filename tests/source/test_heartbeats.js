// Every watchdog-tracked job must record its heartbeat on EVERY return path.
//
// THE RULE WAS ALREADY WRITTEN DOWN. Watchdog.js's header says it:
//
//   runEmailScan_ early-returns when email_parser_enabled is false (its default)
//   and checkFlightStatuses_ no-ops with no flights booked. Both still record.
//   Otherwise the watchdog would alarm permanently about correct behaviour.
//
// Nothing enforced it, and morningNudge broke it: its
// `if (!isNotifEnabled_('morning_briefing')) return;` sat BEFORE the try whose finally
// records. So a briefing deliberately switched off would report as an outage every
// morning forever — and a briefing that was genuinely broken produced the identical
// sentence, which is what made a real outage take a day to pin down.
//
// The job list is derived from HEARTBEAT_REGISTRY, not named here, so a job added
// later is covered without anyone remembering to add it.
//
// ---------------------------------------------------------------------------
// WHY THIS PARSES INSTEAD OF SCANNING TEXT.
//
// Four hand-rolled versions of this check produced four false positives, each time
// reporting correct code as broken:
//
//   1. /\bfunction\b/ matched the word "function" in hourlyCheck's own comment
//      ("this function returns early when reminders_enabled is false"), brace-matched
//      from the next {, and blanked the very finally it was looking for.
//   2. Blanking string contents desynchronised on `.replace(/'/g, '')` — a quote
//      inside a regex literal opened a string that ran to the next apostrophe.
//   3. Walking backwards from the finally over the catch and try blocks landed 4.5k
//      characters early, inside an object literal mid-function.
//   4. A block-comment pass that ignored strings read the `*/*` in an HTTP Accept
//      header ('…image/webp,*/*;q=0.8') as a comment opener and blanked 40 lines of
//      real code, including the braces it then could not match.
//
// Every one of those is the same mistake: treating JavaScript as text. You cannot
// find a `finally` without lexing strings, comments and regex literals, and regex
// literals need real parser context. @babel/standalone is already a devDependency
// (it compiles the dashboard JSX), and it ships a parser — so the check is exact and
// the whole class of bug goes away.
const fs = require('fs'), path = require('path');
const parser = require('@babel/standalone').packages.parser;

const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const FILES = fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && f !== 'playwright.config.js');
const SRC = {}, AST = {};
FILES.forEach(f => {
  SRC[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
  try {
    AST[f] = parser.parse(SRC[f], { sourceType: 'script', errorRecovery: false });
  } catch (e) {
    AST[f] = { _error: e.message };
  }
});

const FN_TYPES = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
                  'ObjectMethod', 'ClassMethod'];

/** Every descendant node, NOT descending into nested functions. */
function walkOwn(node, visit) {
  const seen = new Set();
  (function rec(n, isRoot) {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(c => rec(c, false)); return; }
    if (!n.type) { Object.keys(n).forEach(k => rec(n[k], false)); return; }
    if (!isRoot && FN_TYPES.indexOf(n.type) !== -1) return;   // a nested function's
    visit(n);                                                  // returns are its own
    Object.keys(n).forEach(k => {
      if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') return;
      rec(n[k], false);
    });
  })(node, true);
}

function findFunction(name) {
  for (const f of FILES) {
    if (AST[f]._error) continue;
    for (const stmt of AST[f].program.body) {
      if (stmt.type === 'FunctionDeclaration' && stmt.id && stmt.id.name === name) {
        return { file: f, node: stmt };
      }
    }
  }
  return null;
}

/** Is this node a `recordHeartbeat_('<job>')` call? */
function isHeartbeatCall(n, job) {
  return n.type === 'CallExpression' &&
         n.callee.type === 'Identifier' && n.callee.name === 'recordHeartbeat_' &&
         n.arguments.length === 1 &&
         n.arguments[0].type === 'StringLiteral' && n.arguments[0].value === job;
}

/** Does this subtree contain the heartbeat call, nested functions included? */
function containsHeartbeat(node, job) {
  let found = false;
  (function rec(n) {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(rec); return; }
    if (n.type && isHeartbeatCall(n, job)) { found = true; return; }
    Object.keys(n).forEach(k => { if (k !== 'loc') rec(n[k]); });
  })(node);
  return found;
}

// ---------------------------------------------------------------------------
console.log('The sources parse at all');
{
  const broken = FILES.filter(f => AST[f]._error);
  check('every root .js parses', broken.length === 0,
        broken.map(f => f + ': ' + AST[f]._error).join(' | ') +
        ' — an unparseable file would silently drop out of every check below');
}

console.log('\nEvery watchdog-tracked job records on every return path');
const WD = SRC['Watchdog.js'];
const REG = /var HEARTBEAT_REGISTRY = \[([\s\S]*?)^\];/m.exec(WD);
const jobs = REG ? [...REG[1].matchAll(/job:\s*'([^']+)'/g)].map(m => m[1]) : [];

check('the registry was parsed and has jobs', jobs.length >= 8, JSON.stringify(jobs));
// A delivery marker is recorded after an action, not by a trigger entry point.
const entryPoints = jobs.filter(j => j.indexOf(':') === -1);
check('…and most of them are trigger entry points',
      entryPoints.length >= 8, JSON.stringify(entryPoints));

entryPoints.forEach(job => {
  const f = findFunction(job);
  if (!f) { check(job + ': the function exists', false, 'no top-level declaration found'); return; }

  // The try whose FINALIZER records the heartbeat.
  let recordingTry = null;
  walkOwn(f.node.body, n => {
    if (n.type === 'TryStatement' && n.finalizer && containsHeartbeat(n.finalizer, job)) {
      recordingTry = n;
    }
  });

  if (!recordingTry) {
    const anywhere = containsHeartbeat(f.node, job);
    check(job + ' [' + f.file + ']: records its heartbeat in a finally', false,
          anywhere
            ? 'it records, but not in a finally — a run that threw or returned early ' +
              'records nothing, and the watchdog cannot tell that from a dead trigger'
            : 'no recordHeartbeat_(\'' + job + '\') call at all');
    return;
  }

  // Returns outside that try are return paths the finally cannot cover.
  const escaping = [];
  walkOwn(f.node.body, n => {
    if (n.type !== 'ReturnStatement') return;
    if (n.start >= recordingTry.start && n.end <= recordingTry.end) return;
    escaping.push(n);
  });

  check(job + ' [' + f.file + ']: every return path records',
        escaping.length === 0,
        escaping.length + ' return(s) outside the recording try, at line(s) ' +
        escaping.map(n => (n.loc ? n.loc.start.line : '?')).join(', ') +
        ' — a job that fired and correctly did nothing is then indistinguishable ' +
        'from one that never fired');
});

// ---------------------------------------------------------------------------
// The walker, tested rather than trusted. Each case below is one of the four ways
// the text-scanning versions got this wrong.
console.log('\nThe AST walker');
{
  const parse = s => parser.parse(s, { sourceType: 'script' });
  const fnOf = (src, name) => {
    for (const st of parse(src).program.body) {
      if (st.type === 'FunctionDeclaration' && st.id.name === name) return st;
    }
    return null;
  };

  // A return inside a NESTED function is not the outer function's return path.
  const nested = fnOf("function j(){ try { [1].forEach(function(x){ return x; }); } finally { recordHeartbeat_('j'); } }", 'j');
  let rets = 0;
  walkOwn(nested.body, n => { if (n.type === 'ReturnStatement') rets++; });
  check('a return inside a nested function is not counted', rets === 0, String(rets));

  // The word "function" in a comment is simply not in the tree. Case 1.
  const commented = fnOf("function k(){ // this function returns early\n try { f(); } finally { recordHeartbeat_('k'); } }", 'k');
  let tries = 0;
  walkOwn(commented.body, n => { if (n.type === 'TryStatement' && n.finalizer) tries++; });
  check('a comment mentioning "function" cannot hide the finally', tries === 1, String(tries));

  // A quote inside a regex literal. Case 2.
  const rx = fnOf("function l(){ try { s.replace(/'/g, ''); } finally { recordHeartbeat_('l'); } }", 'l');
  check('a regex containing a quote does not hide the finally',
        !!(rx && (() => { let t = 0; walkOwn(rx.body, n => { if (n.type === 'TryStatement' && n.finalizer) t++; }); return t === 1; })()),
        'this desynchronised the string-blanking version');

  // `*/*` in a string. Case 4 — the one that actually bit scanHoaWebsite_.
  const accept = fnOf("function m(){ try { h({'Accept':'image/webp,*/*;q=0.8'}); } finally { recordHeartbeat_('m'); } }", 'm');
  let t4 = 0;
  walkOwn(accept.body, n => { if (n.type === 'TryStatement' && n.finalizer) t4++; });
  check('an Accept header containing */* does not read as a comment', t4 === 1, String(t4));

  // And the positive: a return before the try IS caught. This is the bug itself.
  const bug = fnOf("function n(){ if (!on()) return; try { f(); } finally { recordHeartbeat_('n'); } }", 'n');
  let rt = null;
  walkOwn(bug.body, x => { if (x.type === 'TryStatement' && x.finalizer && containsHeartbeat(x.finalizer, 'n')) rt = x; });
  const esc = [];
  walkOwn(bug.body, x => { if (x.type === 'ReturnStatement' && !(x.start >= rt.start && x.end <= rt.end)) esc.push(x); });
  check('a return BEFORE the recording try is caught', esc.length === 1, String(esc.length) +
        ' — this is the morningNudge bug, and the check must fail on it');

  // …and a return inside the try is fine, because the finally still runs.
  const ok = fnOf("function o(){ try { if (!x) return; f(); } finally { recordHeartbeat_('o'); } }", 'o');
  let rt2 = null;
  walkOwn(ok.body, x => { if (x.type === 'TryStatement' && x.finalizer && containsHeartbeat(x.finalizer, 'o')) rt2 = x; });
  const esc2 = [];
  walkOwn(ok.body, x => { if (x.type === 'ReturnStatement' && !(x.start >= rt2.start && x.end <= rt2.end)) esc2.push(x); });
  check('a return INSIDE the try is not a finding', esc2.length === 0, String(esc2.length) +
        ' — the finally still runs, so those returns are fine and must not be flagged');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
