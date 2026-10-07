// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The first restores the bug verbatim — the morning email reporting itself as dead, in
// itself. The rest cover the ways a fix could look applied and not be: excluding on
// only one branch, excluding at the renderer so the flag survives, or excluding so
// broadly that nothing is watched any more.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_sw');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const CONTROLS = {
  // ---- the bug itself ------------------------------------------------------
  'the morning run stops excluding itself (the reported bug)': b => ({
    'Code.js': b['Code.js'].replace(/runWatchdog_\(SELF\)/g, 'runWatchdog_()'),
  }),
  'it excludes the job but not the delivery marker': b => ({
    'Code.js': b['Code.js'].replace(
      "var SELF = ['morningNudge', 'delivery:morning_briefing'];",
      "var SELF = ['morningNudge'];"),
  }),
  'it excludes the delivery marker but not the job': b => ({
    'Code.js': b['Code.js'].replace(
      "var SELF = ['morningNudge', 'delivery:morning_briefing'];",
      "var SELF = ['delivery:morning_briefing'];"),
  }),
  'only the watchdog_email branch is fixed': b => ({
    'Code.js': b['Code.js'].replace(
      "        runWatchdog_(SELF);   // still run it", "        runWatchdog_();   // still run it"),
  }),
  'a job name is misspelled, so the exclusion silently does nothing': b => ({
    'Code.js': b['Code.js'].replace("'delivery:morning_briefing'];",
                                    "'delivery:morningBriefing'];"),
  }),

  // ---- the plumbing --------------------------------------------------------
  'getOverdueJobs_ ignores the argument': b => ({
    'Watchdog.js': b['Watchdog.js'].replace('    if (skip[r.job]) return;\n', ''),
  }),
  'the skip list is built but never consulted': b => ({
    'Watchdog.js': b['Watchdog.js'].replace(
      '  (exclude || []).forEach(function(j) { skip[j] = true; });',
      '  (exclude || []).forEach(function(j) { if (false) skip[j] = true; });'),
  }),
  'getWatchdogNotices_ swallows the exclusion': b => ({
    'Watchdog.js': b['Watchdog.js'].replace('var jobs  = getOverdueJobs_(exclude);',
                                            'var jobs  = getOverdueJobs_();'),
  }),
  'runWatchdog_ swallows the exclusion': b => ({
    'Watchdog.js': b['Watchdog.js'].replace('var notices = getWatchdogNotices_(exclude);',
                                            'var notices = getWatchdogNotices_();'),
  }),
  'the skip happens after the entry is read': b => {
    const s = b['Watchdog.js'];
    const line = '    if (skip[r.job]) return;\n';
    return { 'Watchdog.js': s.replace(line, '')
      .replace('    var windowMs = r.maxAgeHours * 3600000;', line + '    var windowMs = r.maxAgeHours * 3600000;') };
  },

  // ---- a fix that only looks applied ---------------------------------------
  'the exclusion moves to the renderer, so the FLAG still says it': b => {
    const s = b['Watchdog.js'];
    return { 'Watchdog.js': s
      .replace('    if (skip[r.job]) return;\n', '')
      .replace("  jobs.forEach(function(j) {\n    lines.push(j.label",
               "  jobs.forEach(function(j) {\n    if ((exclude || []).indexOf(j.job) !== -1) return;\n    lines.push(j.label") };
  },
  'the flag sync is handed a different, unexcluded notices object': b => ({
    'Watchdog.js': b['Watchdog.js'].replace('  try { syncWatchdogFlags_(notices); }',
                                            '  try { syncWatchdogFlags_(getWatchdogNotices_()); }'),
  }),

  // ---- excluding too much --------------------------------------------------
  'hourlyCheck starts excluding the morning jobs too (nothing watches them)': b => ({
    'Reminders.js': b['Reminders.js'].replace(
      'try { runWatchdog_(); } catch (wdErr)',
      "try { runWatchdog_(['morningNudge','delivery:morning_briefing']); } catch (wdErr)"),
  }),
  'the exclusion quietly swallows everything': b => ({
    'Watchdog.js': b['Watchdog.js'].replace('    if (skip[r.job]) return;',
                                            '    if (exclude) return;'),
  }),

  // ---- the ordering that keeps hourlyCheck safe ----------------------------
  'hourlyCheck asks the watchdog before recording its heartbeat': b => {
    const s = b['Reminders.js'];
    const hb = "    try { recordHeartbeat_('hourlyCheck'); } catch (hbErr) {}\n";
    const wdLine = /    try \{ runWatchdog_\(\); \} catch \(wdErr\) \{[^\n]*\}\n/.exec(s)[0];
    return { 'Reminders.js': s.replace(hb, '').replace(wdLine, wdLine + hb) };
  },
  'the reason for that ordering is deleted': b => ({
    'Reminders.js': b['Reminders.js'].replace(
      /    \/\/ RECORDED FIRST, AND THAT ORDER IS LOAD-BEARING[\s\S]*?\n    \/\/ Swapping these two lines would quietly bring the self-report back here\.\n/, ''),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_selfwatch.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)         { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length)   { console.log('  !! NOTHING BIT (patched: ' + changed.join(', ') + ')'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 3).forEach(f => console.log('    - ' + f));
  if (fails.length > 3) console.log('    … and ' + (fails.length - 3) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
