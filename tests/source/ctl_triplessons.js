// Negative controls: revert ONE behaviour at a time and confirm the test bites.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const SRC_DIR = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'ctl_tls');
const FILES = ['Memory.js', 'WebApp.js', 'Code.js', 'Chat.js'];
const DOCS  = ['app.js', 'index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
DOCS.forEach(f => { BASE['docs/' + f] = fs.readFileSync(path.join(SRC_DIR, 'docs', f), 'utf8'); });

const CONTROLS = {
  'an unparseable scope is treated as "applies to everything"': b => ({
    'Memory.js': b['Memory.js'].replace(
      "  if (TRIP_LESSON_SCOPES.indexOf(scope) === -1) return null;",
      "  if (TRIP_LESSON_SCOPES.indexOf(scope) === -1) return { scope: 'always', value: '*' };"),
  }),
  'a scope with no colon is accepted': b => ({
    'Memory.js': b['Memory.js'].replace(
      "  if (i === -1) return null;",
      "  if (i === -1) return { scope: 'always', value: '*' };"),
  }),
  'destination matching demands an exact string': b => ({
    'Memory.js': b['Memory.js'].replace(
      "  return hay.indexOf(parsed.value) !== -1 || parsed.value.indexOf(hay) !== -1;",
      "  return hay === parsed.value;"),
  }),
  'activity scope matches even when the row type is absent': b => ({
    'Memory.js': b['Memory.js'].replace(
      "    var types = t.activityTypes || {};\n    return !!types[parsed.value];",
      "    return true;"),
  }),
  'the category filter is ignored (packing lessons reach the recs prompt)': b => ({
    'Memory.js': b['Memory.js'].replace(
      "      if (wanted && wanted.indexOf(category.toLowerCase()) === -1) return;\n", ''),
  }),
  'every Memory Log row is treated as a lesson': b => ({
    'Memory.js': b['Memory.js'].replace(
      "      if (cell(row, 'Type') !== MEMORY_TYPE.TRIP_LESSON) return;\n", ''),
  }),
  'an empty lessons block is emitted anyway': b => ({
    'Memory.js': b['Memory.js'].replace(
      "  if (!lessons.length) return '';",
      "  if (!lessons.length) lessons = [];"),
  }),
  'a rejected scope is written anyway': b => ({
    'Memory.js': b['Memory.js'].replace(
      /  if \(!parsed\) \{\n    return \{ ok: false, reason: 'scope must be one of ' \+\n[^\n]*\n  \}/,
      "  if (!parsed) { parsed = { scope: 'always', value: '*' }; }"),
  }),
  'the row is written positionally instead of by header': b => ({
    'Memory.js': b['Memory.js'].replace(
      /    var col    = ensureMemoryColumns_\(sheet\);[\s\S]*?sheet\.appendRow\(values\);/,
      "    sheet.appendRow([id, ts, type || '', who || 'System', title || '', detail || '', context || '']);"),
  }),
  'lessons are pruned with everything else': b => ({
    'Memory.js': b['Memory.js'].replace(
      /      pruned \+= deleteRowsOlderThan_\(logSheet, 2, cutoff, function\(row\) \{[\s\S]*?\}\);/,
      "      pruned += deleteRowsOlderThan_(logSheet, 2, cutoff, null);"),
  }),
  'the prune goes back to reading one cell per row': b => ({
    'Memory.js': b['Memory.js'].replace(
      "  var rows  = sheet.getRange(2, 1, n, width).getValues();   // ONE read, not one per row",
      "  var rows = [];\n  for (var q = 2; q <= sheet.getLastRow(); q++) rows.push([sheet.getRange(q, 1).getValue(), sheet.getRange(q, stampCol).getValue()]);\n  for (var z = 0; z < rows.length; z++) rows[z][stampCol - 1] = rows[z][1];"),
  }),
  'deletions happen one row at a time': b => ({
    'Memory.js': b['Memory.js'].replace(
      /  for \(var r = runs\.length - 1; r >= 0; r--\) \{\n    sheet\.deleteRows\(runs\[r\]\.start, runs\[r\]\.count\);\n    deleted \+= runs\[r\]\.count;\n  \}/,
      "  for (var r = runs.length - 1; r >= 0; r--) {\n    for (var q2 = runs[r].count - 1; q2 >= 0; q2--) sheet.deleteRow(runs[r].start + q2);\n    deleted += runs[r].count;\n  }"),
  }),
  'runs are deleted front to back, shifting the indices': b => ({
    'Memory.js': b['Memory.js'].replace(
      "  for (var r = runs.length - 1; r >= 0; r--) {",
      "  for (var r = 0; r < runs.length; r++) {"),
  }),
  'adjacent rows are no longer collapsed into a run': b => ({
    'Memory.js': b['Memory.js'].replace(
      "    if (last && last.start + last.count === rowNum) last.count++;\n    else runs.push({ start: rowNum, count: 1 });",
      "    runs.push({ start: rowNum, count: 1 });"),
  }),
  'the packing prompt stops reading lessons': b => ({
    'WebApp.js': b['WebApp.js'].replace("    (lessonsBlock ? lessonsBlock + '\\n' : '') +\n    'Generate a practical packing list", "    'Generate a practical packing list"),
  }),
  'the packing lessons block moves below the RULES': b => {
    const s = b['WebApp.js'];
    return { 'WebApp.js': s
      .replace("    (lessonsBlock ? lessonsBlock + '\\n' : '') +\n    'Generate a practical packing list", "    'Generate a practical packing list")
      .replace("    'RULES:\\n' +", "    'RULES:\\n' +\n    (lessonsBlock ? lessonsBlock + '\\n' : '') +") };
  },
  'packing asks for every category instead of Packing': b => ({
    'WebApp.js': b['WebApp.js'].replace("      ['Packing']\n    );", "      null\n    );"),
  }),
  'recommendations ask for Packing lessons too': b => ({
    'WebApp.js': b['WebApp.js'].replace("      ['Dining', 'Activities']", "      ['Packing']"),
  }),
  'the recs lessons block moves after the search instruction': b => {
    const s = b['WebApp.js'];
    const block = "    // Before the search instruction, so what he has already told us not to\n    // suggest shapes the search rather than being applied to its results.\n    (lessonsBlock ? lessonsBlock + '\\n' : '') +\n";
    return { 'WebApp.js': s.replace(block, '')
      .replace("    'RULES:\\n' +\n    '- Never recommend a place", "    (lessonsBlock ? lessonsBlock + '\\n' : '') +\n    'RULES:\\n' +\n    '- Never recommend a place") };
  },
  'the packing lookup is not guarded': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  var packingLessons = '';\n  try \{\n([\s\S]*?)\n  \} catch \(lsErr\) \{\n[^\n]*\n  \}/,
      "  var packingLessons = '';\n$1"),
  }),
  'the beach hint loses the hat and the water bottle': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /'- Beach\/water activities: include swimwear, water shoes, dry bag, reef-safe sunscreen, ' \+\n\s*'a wide-brim or packable sun hat, and a refillable water bottle\.'/,
      "'- Beach/water activities: include swimwear, water shoes, dry bag, reef-safe sunscreen.'"),
  }),
  'the debrief stops asking for the scope': b => ({
    'Chat.js': b['Chat.js'].replace('the scope is the whole point and you must ASK, never guess',
                                    'pick a sensible scope yourself'),
  }),
  'the activity-scope warning is dropped': b => ({
    'Chat.js': b['Chat.js'].replace(/activity:beach will NOT fire[^']*/, 'is fine '),
  }),
  'the debrief stops offering trait first': b => ({
    'Chat.js': b['Chat.js'].replace('OFFER trait FIRST', 'offer any scope'),
  }),
  'destination is no longer called the narrow fallback': b => ({
    'Chat.js': b['Chat.js'].replace('Destination is the narrow fallback', 'Destination is a good default'),
  }),
  'a rejected lesson is swallowed instead of reported': b => ({
    'Chat.js': b['Chat.js'].replace(/          errors\.push\('log_trip_lesson: ' \+ ltRes\.reason\);/,
                                    "          executed.push('log_trip_lesson (skipped)');"),
  }),
  'trait is dropped from the recognised scopes': b => ({
    'Memory.js': b['Memory.js'].replace(
      "var TRIP_LESSON_SCOPES = ['trait', 'always', 'destination', 'context', 'activity'];",
      "var TRIP_LESSON_SCOPES = ['always', 'destination', 'context', 'activity'];"),
  }),
  'trait falls back to itinerary activity types': b => ({
    'Memory.js': b['Memory.js'].replace(
      "    return tripTraitList_(t.traits).indexOf(parsed.value) !== -1;",
      "    return tripTraitList_(t.traits).indexOf(parsed.value) !== -1 || !!(t.activityTypes || {})[parsed.value];"),
  }),
  'trait matches a trip with no characteristics': b => ({
    'Memory.js': b['Memory.js'].replace(
      "    return tripTraitList_(t.traits).indexOf(parsed.value) !== -1;",
      "    var tl = tripTraitList_(t.traits);\n    return !tl.length || tl.indexOf(parsed.value) !== -1;"),
  }),
  'the characteristics list is not lowercased': b => ({
    'Memory.js': b['Memory.js'].replace(
      "  return arr.map(function(s) { return String(s || '').trim().toLowerCase(); })",
      "  return arr.map(function(s) { return String(s || '').trim(); })"),
  }),
  'the packing hints ignore the characteristics': b => ({
    'WebApp.js': b['WebApp.js']
      .replace("  if (isTrip('beach') || activityTypes.beach", "  if (activityTypes.beach")
      .replace("  if (isTrip('ski') || activityTypes.skiing", "  if (activityTypes.skiing"),
  }),
  'setTripMeta wipes characteristics when the field is omitted': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /        if \(p\.characteristics !== undefined\) \{\n          sheet\.getRange\(rowNum, 11\)\.setValue\(normaliseTripCharacteristics_\(p\.characteristics\)\);\n        \}/,
      "        sheet.getRange(rowNum, 11).setValue(normaliseTripCharacteristics_(p.characteristics));"),
  }),
  'an unknown characteristic is kept instead of dropped': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    if (TRIP_CHARACTERISTICS.indexOf(s) === -1) return;\n", ''),
  }),
  'the blank-characteristics signal is removed': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  packResult\.characteristicsMissing = !traits;\n/, ''),
  }),
  'the briefing scan guesses from the trip label too': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "function suggestTripCharacteristics_(briefing, activityTypes) {\n  var text = ' ' + String(briefing || '').toLowerCase() + ' ';",
      "function suggestTripCharacteristics_(briefing, activityTypes, tripLabel) {\n  var text = ' ' + String(briefing || '').toLowerCase() + ' ' + String(tripLabel || '').toLowerCase() + ' ';"),
  }),
  'index.html is stale — the chips exist only in app.js': b => ({
    'docs/index.html': b['docs/index.html'].replace(/TripCharacteristicsBlock/g, 'DeadBlock'),
  }),
  'the UI vocabulary drifts from the server': b => ({
    'docs/app.js':     b['docs/app.js'].replace("'beach','city','resort','ski','outdoors','roadtrip','cruise','themepark'", "'beach','city','mountains'"),
    'docs/index.html': b['docs/index.html'].replace("'beach','city','resort','ski','outdoors','roadtrip','cruise','themepark'", "'beach','city','mountains'"),
  }),
  'the "not set" warning is dropped from the UI': b => ({
    'docs/app.js':     b['docs/app.js'].replace(/not set, so beach\/ski lessons and hints won't fire/g, ''),
    'docs/index.html': b['docs/index.html'].replace(/not set, so beach\/ski lessons and hints won't fire/g, ''),
  }),
  'the Scope and Category columns are removed from the schema': b => ({
    'Code.js': b['Code.js'].replace(
      "const MEMORY_LOG_HEADERS         = ['ID', 'Timestamp', 'Type', 'Who', 'Title', 'Detail', 'Context', 'Scope', 'Category']; // Issue #9",
      "const MEMORY_LOG_HEADERS         = ['ID', 'Timestamp', 'Type', 'Who', 'Title', 'Detail', 'Context']; // Issue #9"),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true });
  const patch = CONTROLS[name](BASE);
  const files = Object.assign({}, BASE, patch);
  let changed = false;
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed = true;
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_triplessons.js'], {
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
  fails.slice(0, 3).forEach(f => console.log('    - ' + f));
  if (fails.length > 3) console.log('    … and ' + (fails.length - 3) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
