// Negative controls: revert ONE behaviour at a time against the new source.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl2');
const FILES = ['Trips.js', 'PostTripCapture.js', 'PreTripBriefing.js', 'Chat.js',
               'TravelDayBriefing.js', 'TestBench.js', 'Code.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

function fnOf(src, name) {
  const s = src.indexOf('function ' + name + '(');
  let d = 0;
  for (let j = src.indexOf('{', s); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); }
  }
}

const CONTROLS = {
  'key sets collapse to the single key (no alias lookup)': b => ({
    'Trips.js': b['Trips.js'].replace(fnOf(b['Trips.js'], 'tripKeysFor_'),
      'function tripKeysFor_(tripKey) { var k = String(tripKey||"").trim(); return k ? [k] : []; }'),
  }),
  'post-trip groups by the raw key string again': b => ({
    'Trips.js': b['Trips.js'],
    'PostTripCapture.js': b['PostTripCapture.js']
      .replace('var groupId = tripIdForKey_(tripKey) || tripKey;', 'var groupId = tripKey;'),
  }),
  'post-trip ignores the registry end date': b => ({
    'PostTripCapture.js': b['PostTripCapture.js']
      .replace(/var range     = tripDateRangeFor_\(groupId\);[^\n]*/, 'var range     = null;')
      .replace(/var range  = tripId \? tripDateRangeFor_\(tripId\) : null;/, 'var range  = null;'),
  }),
  'readTripRows_ matches one key again': b => ({
    'PostTripCapture.js': b['PostTripCapture.js']
      .replace('return tripRowMatches_(row[1], keys);',
               'return String(row[1] || "").trim() === tripKey;'),
  }),
  'latches key on the string again (no id, no older-key search)': b => ({
    'Trips.js': b['Trips.js'].replace(fnOf(b['Trips.js'], 'tripLatchSeen_'),
      'function tripLatchSeen_(prefix, trip) { var t = tripLatchTarget_(trip); return !!PropertiesService.getScriptProperties().getProperty(prefix + tripLegacySlugForProperty_(t.key)); }'),
  }),
  'tripLatchMark_ writes the legacy name': b => ({
    'Trips.js': b['Trips.js'].replace(fnOf(b['Trips.js'], 'tripLatchMark_'),
      'function tripLatchMark_(prefix, trip, value) { var t = tripLatchTarget_(trip); var n = prefix + tripLegacySlugForProperty_(t.key); PropertiesService.getScriptProperties().setProperty(n, value || new Date().toISOString()); return n; }'),
  }),
  'seeding is a no-op': b => ({
    'Trips.js': b['Trips.js'].replace(fnOf(b['Trips.js'], 'seedTripIdLatches_'),
      'function seedTripIdLatches_() { return { seeded: 0, skipped: 0, details: [] }; }'),
  }),
  'flag keys embed the key string again': b => ({
    'Trips.js': b['Trips.js'].replace(fnOf(b['Trips.js'], 'tripFlagKey_'),
      'function tripFlagKey_(prefix, trip) { var t = tripLatchTarget_(trip); return (String(prefix) + t.key).toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, ""); }'),
  }),
  'reads write to the registry again (touch gate removed)': b => ({
    'Trips.js': b['Trips.js'].replace('{ mint: false, touch: false }', '{ mint: false }')
                             .replace('resolveTripId_({ label: label, startDate: startDate },',
                                      'resolveTripId_({ label: label, startDate: startDate, endDate: startDate },'),
  }),
  'clearTripLatches_ also deletes the id latch (wipes the survivor)': b => ({
    'Trips.js': b['Trips.js'].replace(
      '  TRIP_LATCH_PREFIXES_.forEach(function(prefix) {\n    try { props.deleteProperty(prefix + propSlug); } catch (e) {}\n  });',
      '  var _oid = tripIdForKey_(tripKey);\n  TRIP_LATCH_PREFIXES_.forEach(function(prefix) {\n    try { props.deleteProperty(prefix + propSlug); } catch (e) {}\n    if (_oid) { try { props.deleteProperty(prefix + tripIdSlugForProperty_(_oid)); } catch (e) {} }\n  });'),
  }),
  'the key-set memo outlives an alias write': b => ({
    'Trips.js': b['Trips.js'].replace(fnOf(b['Trips.js'], 'invalidateTripRegistry_'),
      'function invalidateTripRegistry_() { _tripRegistryCache_ = null; }'),
  }),
  'the travel-day read matches one key again': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js']
      .replace('return tripRowMatches_(row[1], keys) && rowDate === today;',
               'return String(row[1] || "").trim() === tripKey && rowDate === today;'),
  }),
  'Chat trusts the transcript key': b => ({
    'Chat.js': b['Chat.js']
      .replace("tripLatchMark_('POSTTRIP_DEBRIEF_', cdTripKey,", "XtripLatchMarkX('POSTTRIP_DEBRIEF_', cdTripKey,")
      .replace('var cdCanonical = canonicalTripKey_(cdTripKey);', 'var cdCanonical = cdTripKey;'),
  }),
  'adoption is a no-op (the state the sheet is in today)': b => ({
    'Trips.js': b['Trips.js'].replace(fnOf(b['Trips.js'], 'adoptLegacyTripKeys_'),
      'function adoptLegacyTripKeys_(opts) { return { adopted: 0, already: 0, ambiguous: 0, unresolved: 0, details: [] }; }'),
  }),
  'adoption resolves without strict (guesses on ambiguity)': b => ({
    'Trips.js': b['Trips.js'].replace('{ mint: false, touch: false, strict: true }',
                                      '{ mint: false, touch: false }'),
  }),
  'strict is ignored by the resolver': b => ({
    'Trips.js': b['Trips.js'].replace('    if (opts.strict) {', '    if (false) {'),
  }),
  'the Trip ID is not in the key set': b => ({
    'Trips.js': b['Trips.js'].replace('.concat([rec.tripId, key])', '.concat([key])'),
  }),
  'the repair tool writes the bare id again': b => ({
    'Trips.js': b['Trips.js'].replace('vals[i][0] = mergeInto;', 'vals[i][0] = targetId;')
                             .replace('var mergeInto = canonicalTripKey_(targetId) || targetId;',
                                      'var mergeInto = targetId;'),
  }),
  'the TripMeta guard compares against targetId only': b => ({
    'Trips.js': b['Trips.js']
      .replace('var targetKey = canonicalTripKey_(targetId);', 'var targetKey = null;')
      .replace('if (k === targetId || (targetKey && k === targetKey)) b = r;',
               'if (k === targetId) b = r;'),
  }),
  'adoption is not wired into the nightly pass': b => ({
    'Code.js': fs.readFileSync(SRC_DIR + '/Code.js', 'utf8')
      .replace('adoptLegacyTripKeys_({ dryRun: false });', '/* removed */;'),
  }),
  'adoption runs AFTER pre-trip instead of before': b => ({
    'Code.js': (() => {
      const c = fs.readFileSync(SRC_DIR + '/Code.js', 'utf8');
      const call = '      adoptLegacyTripKeys_({ dryRun: false });\n';
      return c.replace(call, '').replace('      checkPostTripCapture_();\n',
                                         '      checkPostTripCapture_();\n' + call);
    })(),
  }),
  'no TestBench entry points': b => ({
    'TestBench.js': b['TestBench.js']
      .replace('function tbTripIdentity()', 'function tbTripIdentityOFF()')
      .replace('function tbSeedTripLatches()', 'function tbSeedTripLatchesOFF()'),
  }),
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

  const r = cp.spawnSync('node', ['test_tripidentity.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
  if (!changed)      { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)       { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-8).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 6).forEach(f => console.log('    - ' + f));
  if (fails.length > 6) console.log('    … and ' + (fails.length - 6) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
