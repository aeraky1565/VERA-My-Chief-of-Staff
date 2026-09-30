// Negative controls: revert ONE behaviour at a time and confirm the test bites.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_pcu');
const FILES = ['Code.js', 'WebApp.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const CONTROLS = {
  'the dashboard toggle does no cleanup (the reported bug)': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  var out = \{ ok: true, used: newUsed !== '', period: r\.period \};\n  if \(newUsed !== ''\) \{\n[\s\S]*?\n  \}\n  return out;/,
      "  return { ok: true, used: newUsed !== '', period: r.period };"),
  }),
  'un-ticking runs the cleanup too': b => ({
    'WebApp.js': b['WebApp.js'].replace("  if (newUsed !== '') {\n    var done = finishCardPerkMarkedUsed_(r.id, r.period);",
                                        "  if (true) {\n    var done = finishCardPerkMarkedUsed_(r.id, r.period);"),
  }),
  'the event is never removed, only the flag resolved': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  try \{\n    out\.eventsRemoved = deletePerkReminderEvent_\(perkId, periodKey\);\n  \} catch \(ce\) \{\n[^\n]*\n  \}\n/, ''),
  }),
  'the two halves share one try/catch': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  try \{\n    out\.flagsResolved = resolveCardPerkFlag_\(perkId, periodKey\);\n  \} catch \(fe\) \{\n[^\n]*\n  \}\n  try \{\n    out\.eventsRemoved = deletePerkReminderEvent_\(perkId, periodKey\);\n  \} catch \(ce\) \{\n[^\n]*\n  \}/,
      "  try {\n    out.flagsResolved = resolveCardPerkFlag_(perkId, periodKey);\n    out.eventsRemoved = deletePerkReminderEvent_(perkId, periodKey);\n  } catch (fe) {\n    Logger.log('x');\n  }"),
  }),
  'the marker is a second literal at the creation site': b => ({
    'Code.js': b['Code.js'].replace("var dedupMark  = perkCalendarMark_(id, periodKey);",
                                    "var dedupMark  = 'VERA-PERK:' + id + ':' + periodKey;"),
  }),
  'the marker drops the trailing period (CP-7 matches CP-77)': b => ({
    'Code.js': b['Code.js'].replace("  return 'VERA-PERK:' + perkId + ':' + periodKey;",
                                    "  return 'VERA-PERK:' + perkId;"),
  }),
  'past events are deleted too': b => ({
    'Code.js': b['Code.js'].replace("    if (end < today) return 0;           // already fired — leave it as history\n", ''),
  }),
  'the day itself counts as past (deletes nothing on the deadline)': b => ({
    'Code.js': b['Code.js'].replace('    if (end < today) return 0;', '    if (end <= today) return 0;'),
  }),
  'the description is not checked (everything that day is deleted)': b => ({
    'Code.js': b['Code.js'].replace("      if ((ev.getDescription() || '').indexOf(mark) === -1) return;\n", ''),
  }),
  'a null period end is not guarded (standing hits the calendar)': b => ({
    'Code.js': b['Code.js'].replace(
      '    if (!end) return 0;                  // standing, or a shape we do not parse\n', ''),
  }),
  'calendar errors propagate to the caller': b => {
    const s = b['Code.js'];
    const fn = /function deletePerkReminderEvent_\(perkId, periodKey\) \{[\s\S]*?\n\}/.exec(s)[0];
    const bare = fn
      .replace(/  try \{\n/, '')
      .replace(/\n  \} catch \(err\) \{\n[\s\S]*?\n    return 0;\n  \}\n\}$/, '\n}')
      .replace(/^    /gm, '  ');
    return { 'Code.js': s.replace(fn, bare) };
  },
  'the checker loses its already-used skip': b => ({
    'Code.js': b['Code.js'].replace('    if (lastUsed === periodKey) return;   // already used this period\n', ''),
  }),
  'the idempotent second mark runs the cleanup': b => {
    const s = b['WebApp.js'];
    return { 'WebApp.js': s.replace(
      "    out.alreadyMarked = true;\n    out.marked        = true;\n    return out;",
      "    out.alreadyMarked = true;\n    out.marked        = true;\n    var d0 = finishCardPerkMarkedUsed_(r.id, r.period);\n    out.eventsRemoved = d0.eventsRemoved;\n    return out;") };
  },
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const patch = CONTROLS[name](BASE);
  const files = Object.assign({}, BASE, patch);
  let changed = false;
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed = true;
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_perkcleanup.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
  if (!changed)      { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)       { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 4).forEach(f => console.log('    - ' + f));
  if (fails.length > 4) console.log('    … and ' + (fails.length - 4) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
