// The night as one list that continues itself (NightlyRunner.js, #256).
//
// WHY. Google stops an execution at 6 minutes. The night outgrew one run, then two halves,
// and on Nov 18 the first half spent its budget by 341 s, skipped 50 steps and was killed.
// Now a part runs up to 4 minutes, saves its place and schedules the next part; a part that
// is killed is picked up by the backup it scheduled first, which skips the step that died.
// Driven here with the real runner, the real nightlyStep_, a fake clock and fake triggers.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RUNNER = read('NightlyRunner.js'), CODE = read('Co' + 'de.js'), WATCH = read('Watchdog.js'), FEAT = read('Features.js'), RUNLOG = read('RunLog.js');

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
const pad = n => String(n).padStart(2, '0');

function world(steps) {
  const W = { clock: new Date(2026, 10, 19, 23, 20).getTime(), props: {}, bundles: {}, store: {}, triggers: [], ran: [], slack: [], vlog: [], beats: [], flags: [], notes: [], handoffs: [] };
  const RealDate = Date;
  W.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(W.clock); } static now() { return W.clock; } };
  Object.assign(W, {
    JSON, Math, String, Object, Array, parseInt, Number,
    Logger: { log() {} }, Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in W.props ? W.props[k] : null), setProperty: (k, v) => { W.props[k] = String(v); }, deleteProperty: k => { delete W.props[k]; } }) },
    veraStateGet_: b => Object.assign({}, W.bundles[b] || {}),
    veraStateSet_: (b, patch) => { const cur = W.bundles[b] = W.bundles[b] || {}; Object.keys(patch).forEach(k => { if (patch[k] == null) delete cur[k]; else cur[k] = String(patch[k]); }); return cur; },
    veraStoreGet_: k => W.store[k] || null, veraStoreSet_: (k, v) => { W.store[k] = v; },
    ScriptApp: {
      newTrigger: h => ({ timeBased: () => ({ after: ms => ({ create: () => { W.triggers.push({ h, ms, getHandlerFunction: () => h }); } }) }) }),
      getProjectTriggers: () => W.triggers.slice(), deleteTrigger: t => { W.triggers = W.triggers.filter(x => x !== t); },
    },
    runLogStart_: () => {}, runLogStep_: () => {}, runLogNote_: (a, b, s) => W.notes.push(s), runLogHandoff_: (ctx, s) => W.handoffs.push(s),
    sendSlackLog_: t => W.slack.push(t), veraLog_: (...a) => W.vlog.push(a), recordHeartbeat_: j => W.beats.push(j),
    featureNoteSteps_: () => {}, flushSystemLog_: () => {}, writeFlags: f => { W.flags.push(...f); return f.length; },
    notifCountLine_: () => 'Yesterday: nothing sent', notifCounts_: () => ({ counts: {} }),
  });
  vm.createContext(W);
  vm.runInContext(['var NIGHTLY_STEP_PROP_ = \'NIGHTLY_STEP\';', /var NIGHTLY_STEP_RESERVE_MS_ = .*;/.exec(CODE)[0],
    extractFn(CODE, 'nightlyStep_'), extractFn(CODE, 'slowestNightlySteps_'), RUNNER].join('\n'), W);
  if (steps) W.nightlySteps_ = () => steps.map(s => ({ n: s.n, g: s.g || 3, fn: (ctx, st) => { W.ran.push(s.n); W.clock += (s.ms || 0); if (s.fn) s.fn(ctx, st, W); } }));
  return W;
}
const fire = W => { const t = W.triggers.find(x => x.h === 'nightlyContinue'); if (!t) return false; W.clock += t.ms; W.triggers = W.triggers.filter(x => x !== t); W.nightlyContinue(); return true; };
const cont = W => W.triggers.filter(t => t.h === 'nightlyContinue');

console.log('A night longer than one run');
{
  const steps = Array.from({ length: 10 }, (_, i) => ({ n: 's' + i, ms: 60000 }));
  const W = world(steps);
  W.nightlyRun();
  check('part 1 runs while there’s time (4 steps of 60 s), then hands off', J(W.ran) === J(['s0', 's1', 's2', 's3']), J(W.ran));
  check('…with one continuation, a minute out', cont(W).length === 1 && cont(W)[0].ms === 60000, J(cont(W).map(t => t.ms)));
  check('…its place saved, marked as a handoff', JSON.parse(W.bundles.NIGHT.NIGHTLY_RESUME).next === 4 && JSON.parse(W.bundles.NIGHT.NIGHTLY_RESUME).handoff === true);
  check('…no breadcrumb left (a handoff isn’t a death)', !('NIGHTLY_STEP' in W.props));
  check('…its Run Log row says it continues', /part 1 · continues at s4/.test(W.handoffs[0] || ''), J(W.handoffs));
  check('…and nothing is finished yet', W.beats.length === 0 && W.slack.length === 0 && !('LAST_NIGHTLY_RUN' in W.props));
  fire(W); fire(W);
  check('the next parts pick up where it stopped, and finish the list in order', J(W.ran) === J(steps.map(s => s.n)), J(W.ran));
  check('one heartbeat, one summary, one LAST_NIGHTLY_RUN', J(W.beats) === '["nightlyRun"]' && W.slack.filter(t => /Nightly run —/.test(t)).length === 1 && !!W.props.LAST_NIGHTLY_RUN);
  check('the summary says how many parts and steps', /· 3 parts · 10 steps/.test(W.slack[0]), W.slack[0]);
  check('the saved night is cleared, and no trigger is left', !W.bundles.NIGHT.NIGHTLY_RESUME && cont(W).length === 0);
}

console.log('\nA part that gets killed');
{
  let seenBackup = null;
  const steps = [{ n: 'a', fn: (ctx, st, W) => { seenBackup = cont(W).map(t => t.ms); } }, { n: 'b' }, { n: 'c' }, { n: 'd' }];
  const W = world(steps);
  W.nightlyRun();
  check('every part schedules a backup 7 minutes out before its first step', J(seenBackup) === J([7 * 60000]), J(seenBackup));
  // Now act out a kill: part 1 of a new night died during 'b' (breadcrumb, no handoff).
  const K = world(steps);
  K.bundles.NIGHT = { NIGHTLY_RESUME: J({ id: '2026-11-19', started: K.clock, next: 1, part: 1, handoff: false, failures: [], skipped: [], blocked: [], killed: [], timings: [], vars: {} }) };
  K.props.NIGHTLY_STEP = 'b|200';
  K.triggers.push({ h: 'nightlyContinue', ms: 7 * 60000, getHandlerFunction: () => 'nightlyContinue' });
  fire(K);
  check('the backup skips the step that was killed and carries on from the next', J(K.ran) === J(['c', 'd']), J(K.ran));
  check('…and the summary names it', /1 cut off \(b\)/.test(K.slack[0] || ''), K.slack[0]);
  check('…the night still finishes', J(K.beats) === '["nightlyRun"]');
  const P = world(); P.nightlyResumeAt_ = P.nightlyResumeAt_;
  const names = ['a', 'b', 'c'];
  check('pure: a handoff resumes at its saved place', J(P.nightlyResumeAt_({ next: 2, handoff: true }, 'b|3', names)) === J({ next: 2, killed: '' }));
  check('pure: no handoff + a breadcrumb → that step was killed', J(P.nightlyResumeAt_({ next: 1, handoff: false }, 'b|3', names)) === J({ next: 2, killed: 'b' }));
  check('pure: a breadcrumb behind the saved place never moves it back', J(P.nightlyResumeAt_({ next: 3, handoff: false }, 'a|3', names)) === J({ next: 3, killed: 'a' }));
}

console.log('\nLimits and stale nights');
{
  const steps = Array.from({ length: 12 }, (_, i) => ({ n: 'x' + i, ms: 200000 }));
  const W = world(steps);
  W.nightlyRun(); let parts = 1; while (fire(W)) parts++;
  check('at most 6 parts', parts === 6, String(parts));
  check('…the rest are recorded as skipped, and the night still finishes', /skipped \(out of parts\)/.test(W.slack[0] || '') && J(W.beats) === '["nightlyRun"]', W.slack[0]);
  check('…with the skipped steps listed', W.slack.some(t => /Skipped \(out of parts\):\n• x\d+/.test(t)));
  const S = world([{ n: 'a' }]);
  S.bundles.NIGHT = { NIGHTLY_RESUME: J({ id: 'old', started: S.clock - 9 * 3600000, next: 0, part: 1, handoff: true, failures: [], skipped: [], blocked: [], killed: [], timings: [], vars: {} }) };
  S.nightlyContinue();
  check('a continuation for a night more than 8 h old does nothing and clears it', S.ran.length === 0 && !S.bundles.NIGHT.NIGHTLY_RESUME);
  const N = world([{ n: 'a' }]); N.triggers.push({ h: 'nightlyContinue', ms: 1, getHandlerFunction: () => 'nightlyContinue' });
  N.nightlyContinue();
  check('with no night in progress it does nothing, and removes its trigger', N.ran.length === 0 && cont(N).length === 0);
}

console.log('\nThe pattern engine and what passes between parts');
{
  const steps = [{ n: 'stash', fn: () => {} }, { n: 'checkCrossPatternFlags_' }];
  const W = world(steps);
  W.bundles.NIGHT = { NIGHTLY_RESUME: J({ id: '2026-11-19', started: W.clock, next: 1, part: 1, handoff: false, failures: [], skipped: [], blocked: [], killed: [], timings: [], vars: {} }) };
  W.props.NIGHTLY_STEP = 'stash|10';
  W.nightlyContinue();
  check('a step killed tonight withholds the pattern engine (its input is incomplete)', W.ran.indexOf('checkCrossPatternFlags_') === -1 && /1 withheld/.test(W.slack[0]), J([W.ran, W.slack[0]]));
  const G = world();
  check('pure gate: a clean night lets it run; a skipped or killed step doesn’t', G.nightlyCrossGate_({ skipped: [], killed: [] }).ok === true && G.nightlyCrossGate_({ skipped: ['x'], killed: [] }).ok === false && /\(k\)/.test(G.nightlyCrossGate_({ skipped: [], killed: ['k'] }).reason));
  const X = world([{ n: 'put', ms: 230000, fn: (ctx, st, W) => W.nightlyStash_('NIGHTLY_FLAGS', [{ key: 'k1' }]) }, { n: 'get', fn: (ctx, st, W) => { W.got = W.nightlyUnstash_('NIGHTLY_FLAGS'); } }]);
  X.nightlyRun(); fire(X);
  check('a result stashed in one part is read in the next', J(X.got) === J([{ key: 'k1' }]) && J(X.ran) === '["put","get"]');
  check('small results ride in the saved night (st.vars) between parts', /st\.vars\.suppressed = getSuppressedKeyPatterns_\(\)/.test(RUNNER) && /st\.vars\.suppressed \|\| \[\]/.test(RUNNER));
}

console.log('\nSlow and killed steps, two nights running');
{
  const W = world();
  const r = W.nightlyRepeatOffenders_({ writePTOSnapshot_: '2026-11-18', old_: '2026-11-10' }, ['writePTOSnapshot_', 'collect', 'old_'], '2026-11-19', '2026-11-18');
  check('a step that was a problem last night too is a repeat (one from a week ago isn’t)', J(r.repeat) === '["writePTOSnapshot_"]', J(r.repeat));
  check('…tonight’s problems are kept for tomorrow; older ones drop', J(r.keep) === J({ writePTOSnapshot_: '2026-11-19', collect: '2026-11-19', old_: '2026-11-19' }));
  W.bundles.NIGHT = { NIGHTLY_KILLED: J({ b: '2026-11-18' }) };
  W.nightlyRepeatFlags_({ id: '2026-11-19', killed: ['b'], timings: [{ name: 'p', ms: 160000 }] });
  check('a step killed two nights running raises one flag naming it', W.flags.length === 1 && W.flags[0].flag === 'b was cut off two nights running' && W.flags[0].key === 'nightly_step_b', J(W.flags));
  check('a step over 150 s is remembered for tomorrow', JSON.parse(W.bundles.NIGHT.NIGHTLY_KILLED).p === '2026-11-19');
  check('steps over 90 s are named in the summary', J(W.nightlySlowSteps_([{ name: 'a', ms: 91000 }, { name: 'b', ms: 5000 }, { name: 'c', ms: 120000 }], 90000)) === J(['c 120.0s', 'a 91.0s']));
}

console.log('\nThe count line is for the night’s own day');
{
  const N = world(); N.notifCountLine_ = c => 'Yesterday: ' + J(c);
  const nc = { counts: { push: 2 }, yesterday: { push: 5 } };
  check('finished before midnight: today’s counts, called Today', N.nightlyCountLine_(nc, '2026-11-19', '2026-11-19') === 'Today: {"push":2}');
  check('finished after midnight: yesterday’s, which is the night’s day', N.nightlyCountLine_(nc, '2026-11-19', '2026-11-20') === 'Yesterday: {"push":5}');
}

console.log('\nThe list itself');
{
  const R = world();
  const list = R.nightlySteps_(), names = list.map(s => s.n), at = n => names.indexOf(n);
  check('every step once', new Set(names).size === names.length, names.filter((n, i) => names.indexOf(n) !== i).join());
  check('87 steps: all 85 the two halves ran, plus the flags write and Signal Learning inside the budget', names.length === 87 && at('writeFlags') !== -1 && at('recordFlagsGenerated_') !== -1, String(names.length));
  check('groups in order: noticed, data, writers, analysis, housekeeping', list.every((s, i) => i === 0 || s.g >= list[i - 1].g));
  check('the trip emails come right after the trip-key steps they need', at('adoptLegacyTripKeys_') < at('tripIdStampAll_') && at('tripIdStampAll_') < at('checkPreTripBriefings_') && at('checkPreTripBriefings_') < at('checkPostTripCapture_') && at('checkPostTripCapture_') < 6);
  check('gym, refills and the important dates are in the first group', ['checkGymSessions_', 'checkRefills_', 'checkImportantDates_', 'checkNoGiftIdea_'].every(n => list[at(n)].g === 1));
  check('the flags call: suppressed patterns and PTO first, then collect → write → record', at('getSuppressedKeyPatterns_') < at('collect') && at('writePTOSnapshot_') < at('collect') && at('collect') < at('writeFlags') && at('writeFlags') < at('recordFlagsGenerated_'));
  check('the pattern engine comes after every flag writer', list.filter(s => s.g <= 3).every(s => at(s.n) < at('checkCrossPatternFlags_')));
  check('the important dates are synced before they’re checked', at('syncImportantDatesToCalendar_') < at('checkImportantDates_'));
  check('perk flags are closed before new ones are raised', at('closeExpiredPerkFlags_') < at('checkCardPerksExpiring_'));
  check('retired Config is purged before the property prune', at('purgeRetiredConfig_') < at('pruneScriptProperties_'));
  check('writeSummarySnapshot is last (tomorrow’s collect reads it)', names[names.length - 1] === 'writeSummarySnapshot');
  const all = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && !/config\.js$/.test(f)).map(f => read(f)).join('\n');
  const listSrc = RUNNER.slice(RUNNER.indexOf('function nightlySteps_'), RUNNER.indexOf('function morningRoutineReset_')).replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  const local = [...listSrc.matchAll(/(?:var|let|const|function)\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]);
  const called = [...listSrc.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\(/g)].map(m => m[1]).filter(n => !local.includes(n))
    .filter(n => !['S', 'function', 'push', 'join', 'log', 'filter', 'map', 'getDate', 'Date', 'slowestNightlySteps_', 'nightlyStash_', 'nightlyUnstash_', 'schedDom_'].includes(n));
  const missing = [...new Set(called)].filter(n => !new RegExp('function ' + n + '\\(').test(all));
  check('every function a step calls exists', called.length > 60 && missing.length === 0, called.length + ' calls; missing: ' + missing.join());
}

console.log('\nThe second half is gone');
{
  check('only nightlyRun has a daily trigger now', !/handler: 'nightlyRunTail'/.test(extractFn(CODE, 'veraTriggerSpecs_')) && /handler: 'nightlyRun'/.test(extractFn(CODE, 'veraTriggerSpecs_')));
  check('the nightly hour setting moves only that one', /nightly_run_hour: \['nightlyRun'\]/.test(FEAT));
  check('the old halves’ code is gone from the main file', !/^function nightlyRun\(/m.test(CODE) && !/^function nightlyRunTail\(/m.test(CODE) && !/^function nightlyHeadCompletedTonight_\(/m.test(CODE));
  const T = world(); T.triggers.push({ h: 'nightlyRunTail', ms: 0, getHandlerFunction: () => 'nightlyRunTail' }, { h: 'hourlyCheck', ms: 0, getHandlerFunction: () => 'hourlyCheck' });
  T.nightlyRunTail();
  check('if the old second-half trigger fires, it removes itself and does nothing else', J(T.triggers.map(t => t.h)) === '["hourlyCheck"]' && T.ran.length === 0);
  check('the watchdog watches the night as one job', !/job: 'nightlyRunTail'/.test(WATCH) && /job: 'nightlyRun',/.test(WATCH));
  check('…and removes a continuation left with no night in progress', /if \(typeof nightlyLoad_ === 'function' && !nightlyLoad_\(\)\) nightlyDropContinues_\(\);/.test(extractFn(WATCH, 'runWatchdog_')));
  check('a part that hands off is "Continued" in the Run Log, not Cut off', /if \(r\.status === 'Continued'\) return 'Continued';/.test(RUNLOG) && /function runLogHandoff_\(ctx, summary\)/.test(RUNLOG));
  check('the saved night has its own state bundle', /NIGHT:\s+\['NIGHTLY_RESUME', 'NIGHTLY_KILLED'\]/.test(read('Settings.js')));
}

console.log('\nThe flag colours: one write, not one per row');
{
  const C = { FLAG_HEADERS: Array(12).fill('h'), calls: 0 };
  vm.createContext(C); vm.runInContext(extractFn(CODE, 'colorCodeFlags') + extractFn(CODE, 'flagRowColors_'), C);
  const rows = Array.from({ length: 500 }, (_, i) => [['High', 'Medium', 'Low', ''][i % 4]]);
  let bg = null;
  const sheet = { getLastRow: () => 501, getRange: (r, c, n, w) => ({ getValues: () => { C.calls++; return rows; }, setBackgrounds: v => { C.calls++; bg = v; }, setBackground: () => { C.calls++; } }) };
  C.colorCodeFlags(sheet);
  check('500 flags: one read and one write (was 501 calls, 57 s on Nov 18)', C.calls === 2, String(C.calls));
  check('…each row its urgency’s colour', bg.length === 500 && bg[0][0] === '#fce8e6' && bg[1][11] === '#fef9e7' && bg[2][5] === '#e6f4ea' && bg[3][0] === '#ffffff');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
