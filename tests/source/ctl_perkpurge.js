// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// This deletes from a calendar two people read, so the controls that matter most are
// the ones that put back a way of deleting the wrong thing: dropping the marker check,
// matching it loosely, or moving the window by a day so a live perk's reminder goes
// with the dead ones.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_ppg');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const CONTROLS = {
  // ---- what gets deleted --------------------------------------------------
  'the marker check is removed (it deletes everything in the window)': b => ({
    'Code.js': b['Code.js'].replace(
      "      if (desc.indexOf('VERA-PERK:') === -1) return;      // not ours — never touch it\n", ''),
  }),
  'the marker is matched loosely': b => ({
    'Code.js': b['Code.js'].replace("desc.indexOf('VERA-PERK:') === -1",
                                    "desc.indexOf('VERA') === -1"),
  }),
  'the marker match is inverted': b => ({
    'Code.js': b['Code.js'].replace("desc.indexOf('VERA-PERK:') === -1",
                                    "desc.indexOf('VERA-PERK:') !== -1"),
  }),

  // ---- the window ---------------------------------------------------------
  'the window ends at today 00:00 (today\'s live reminder is swept)': b => ({
    'Code.js': b['Code.js'].replace('    to = new Date(to.getTime() - 1);\n', ''),
  }),
  'the window runs to tomorrow': b => ({
    'Code.js': b['Code.js'].replace('    to = new Date(to.getTime() - 1);',
                                    '    to = new Date(to.getTime() + 86400000);'),
  }),
  'the window is off by one at the start': b => ({
    'Code.js': b['Code.js'].replace('    from.setDate(from.getDate() - days + 1);',
                                    '    from.setDate(from.getDate() - days - 1);'),
  }),
  'the lookback is one month, so a missed night orphans an event': b => ({
    'Code.js': b['Code.js'].replace('var PERK_EVENT_PURGE_LOOKBACK_DAYS_ = 40;',
                                    'var PERK_EVENT_PURGE_LOOKBACK_DAYS_ = 30;'),
  }),
  'the backlog window is as narrow as the nightly one': b => ({
    'Code.js': b['Code.js'].replace('var PERK_EVENT_PURGE_BACKLOG_DAYS_  = 400;',
                                    'var PERK_EVENT_PURGE_BACKLOG_DAYS_  = 40;'),
  }),

  // ---- the dry run --------------------------------------------------------
  'the dry run deletes anyway': b => ({
    'Code.js': b['Code.js'].replace('      if (dryRun) return;\n', ''),
  }),
  'the dry run reports nothing, so the preview is empty': b => {
    const s = b['Code.js'];
    const push = "      out.events.push({ date: when, title: title });";
    return { 'Code.js': s.replace(push, "      if (!dryRun) out.events.push({ date: when, title: title });") };
  },
  'the dry run still claims it removed them': b => ({
    'Code.js': b['Code.js'].replace('      if (dryRun) return;',
                                    '      if (dryRun) { out.removed++; return; }'),
  }),

  // ---- cost ---------------------------------------------------------------
  'the calendar is read one day at a time': b => ({
    'Code.js': b['Code.js'].replace(
      '    var events = cal.getEvents(from, to);',
      '    var events = [];\n' +
      '    for (var d = new Date(from.getTime()); d <= to; d.setDate(d.getDate() + 1)) {\n' +
      '      events = events.concat(cal.getEvents(new Date(d.getTime()), new Date(d.getTime() + 86400000)));\n' +
      '    }'),
  }),

  // ---- it must not take the night down ------------------------------------
  'a calendar error is rethrown': b => ({
    'Code.js': b['Code.js'].replace(
      /  \} catch \(err\) \{\n    \/\/ Best effort, like deletePerkReminderEvent_[\s\S]*?\n    return out;\n  \}/,
      '  } catch (err) {\n    throw err;\n  }'),
  }),
  'one undeletable event aborts the rest': b => ({
    'Code.js': b['Code.js'].replace(
      /      try \{\n        ev\.deleteEvent\(\);\n        out\.removed\+\+;\n      \} catch \(delErr\) \{\n[\s\S]*?\n      \}/,
      '      ev.deleteEvent();\n      out.removed++;'),
  }),
  'a missing shared calendar throws instead of reporting': b => ({
    'Code.js': b['Code.js'].replace(
      /    if \(!cal\) \{\n      out\.ok    = false;\n      out\.error = 'no shared calendar configured \(pto_gap_calendars\)';\n      return out;\n    \}/,
      "    if (!cal) throw new Error('boom');"),
  }),
  'an unreadable description is treated as ours': b => ({
    'Code.js': b['Code.js'].replace(
      "      try { desc = ev.getDescription() || ''; } catch (dErr) { return; }",
      "      try { desc = ev.getDescription() || ''; } catch (dErr) { desc = 'VERA-PERK:?'; }"),
  }),

  // ---- the counts ---------------------------------------------------------
  'matched counts everything scanned, not just ours': b => ({
    'Code.js': b['Code.js'].replace('      out.matched++;\n', '')
                           .replace('    out.scanned = events.length;',
                                    '    out.scanned = events.length;\n    out.matched = events.length;'),
  }),

  // ---- the wiring ---------------------------------------------------------
  'the nightly sweep moves into the head': b => {
    const s = b['Code.js'];
    const m = /    \/\/ Step 0r: Clear VERA's own perk reminder events[\s\S]*?\n    \}\);\n/.exec(s)[0];
    return { 'Code.js': s.replace(m, '').replace(
      "    nightlyStep_(ctx, 'checkCardPerksActive_', checkCardPerksActive_);",
      "    nightlyStep_(ctx, 'checkCardPerksActive_', checkCardPerksActive_);\n" + m) };
  },
  'it runs in BOTH halves': b => {
    const s = b['Code.js'];
    const m = /    \/\/ Step 0r: Clear VERA's own perk reminder events[\s\S]*?\n    \}\);\n/.exec(s)[0];
    return { 'Code.js': s.replace(
      "    nightlyStep_(ctx, 'checkCardPerksActive_', checkCardPerksActive_);",
      "    nightlyStep_(ctx, 'checkCardPerksActive_', checkCardPerksActive_);\n" + m) };
  },
  'the nightly sweep uses the 400-day backlog window every night': b => ({
    'Code.js': b['Code.js'].replace(
      'purgePastPerkReminderEvents_(PERK_EVENT_PURGE_LOOKBACK_DAYS_, false);',
      'purgePastPerkReminderEvents_(PERK_EVENT_PURGE_BACKLOG_DAYS_, false);'),
  }),
  'the nightly sweep is removed': b => ({
    'Code.js': b['Code.js'].replace(
      /    \/\/ Step 0r: Clear VERA's own perk reminder events[\s\S]*?\n    \}\);\n/, ''),
  }),
  'the dashboard actions are unregistered': b => ({
    'WebApp.js': b['WebApp.js']
      .replace("      case 'preview_perk_event_purge':   return jsonOut_(webPreviewPerkEventPurge_());\n", '')
      .replace("      case 'run_perk_event_purge':       return jsonOut_(webRunPerkEventPurge_());\n", ''),
  }),
  // ---- the TestBench backlog sweep ----------------------------------------
  'the backlog preview actually deletes': b => ({
    'TestBench.js': b['TestBench.js'].replace(
      'var out = purgePastPerkReminderEvents_(PERK_EVENT_PURGE_BACKLOG_DAYS_, true);',
      'var out = purgePastPerkReminderEvents_(PERK_EVENT_PURGE_BACKLOG_DAYS_, false);'),
  }),
  'the backlog preview reports a count without the list': b => ({
    'TestBench.js': b['TestBench.js'].replace(
      "  out.events.forEach(function(e) { Logger.log('  ' + e.date + '  ' + e.title); });\n", ''),
  }),
  'preview and run collapse into one function': b => ({
    'TestBench.js': b['TestBench.js'].replace(
      /\/\*\* The same sweep, FOR REAL\. Run tbPerkEventPurgePreview\(\) first\. \*\/\nfunction tbPerkEventPurgeRun\(\) \{[\s\S]*?\n\}\n/, ''),
  }),
  'preview and run become two implementations': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      'function webPreviewPerkEventPurge_() {\n  return purgePastPerkReminderEvents_(PERK_EVENT_PURGE_BACKLOG_DAYS_, true);\n}',
      'function webPreviewPerkEventPurge_() {\n  return { ok: true, dryRun: true, matched: 0, removed: 0, events: [] };\n}'),
  }),

  // ---- the lazy fix this change exists to avoid ---------------------------
  'deletePerkReminderEvent_ is relaxed to delete past events instead': b => ({
    'Code.js': b['Code.js'].replace(
      '    if (end < today) return 0;           // already fired — leave it as history\n', ''),
  }),
  'the purge routes through deletePerkReminderEvent_ (and so deletes nothing)': b => ({
    'Code.js': b['Code.js'].replace(
      /      if \(dryRun\) return;\n      try \{\n        ev\.deleteEvent\(\);/,
      '      if (dryRun) return;\n      try {\n        deletePerkReminderEvent_(\'x\', \'y\'); ev.deleteEvent();'),
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

  const r = cp.spawnSync('node', ['test_perkpurge.js'], {
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
