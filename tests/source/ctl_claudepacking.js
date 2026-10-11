// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The first restores the bug: both reads back inside the per-trip loop. It produces the
// SAME prompt, which is why an output-only test would stay green on it — the counters in
// test_claudepacking.js are the only thing that can tell the two versions apart.
//
// The rest guard the two things the rewrite could have quietly broken: alias matching
// (the old lookup matched a trip's whole key set, and bucketing by trip would have
// dropped the aliases) and per-tab degradation (a failed read must cost one count, not
// the whole trips section).
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_clp');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 60));
  return src.replace(from, to);
};

// The lookup, as the loop now has it.
const LOOKUP =
  '          var cKeys     = tripKeysFor_(tripKey);\n' +
  '          var packCount = countForTripKeys_(packByKey_t, cKeys);\n' +
  '          var itinCount = countForTripKeys_(itinByKey_t, cKeys);';

const CONTROLS = {
  // ---- the bug itself, restored --------------------------------------------
  'both reads go back inside the per-trip loop': b => ({
    'Claude.js': swap(b['Claude.js'], LOOKUP,
      '          var cKeys = tripKeysFor_(tripKey);\n' +
      '          var packCount = 0;\n' +
      '          try {\n' +
      '            var packSheet = ss_t.getSheetByName(TABS.PACKING_ITEMS);\n' +
      '            if (packSheet && packSheet.getLastRow() >= 2) {\n' +
      '              packSheet.getRange(2, 1, packSheet.getLastRow() - 1, PACKING_ITEM_HEADERS.length)\n' +
      '                .getValues().forEach(function(r) { if (tripRowMatches_(r[1], cKeys)) packCount++; });\n' +
      '            }\n' +
      '          } catch(pe2) {}\n' +
      '          var itinCount = 0;\n' +
      '          try {\n' +
      '            var itinSheet = ss_t.getSheetByName(TABS.ITINERARY);\n' +
      '            if (itinSheet && itinSheet.getLastRow() >= 2) {\n' +
      '              itinSheet.getRange(2, 1, itinSheet.getLastRow() - 1, ITINERARY_HEADERS.length)\n' +
      '                .getValues().forEach(function(r) { if (tripRowMatches_(r[1], tripKeysFor_(tripKey))) itinCount++; });\n' +
      '            }\n' +
      '          } catch(ie2) {}'),
  }),

  // ---- the tallies ---------------------------------------------------------
  'the packing tally is never filled': b => ({
    'Claude.js': swap(b['Claude.js'],
      '            if (k) packByKey_t[k] = (packByKey_t[k] || 0) + 1;', '            ;'),
  }),
  'the itinerary tally is never filled': b => ({
    'Claude.js': swap(b['Claude.js'],
      '            if (k) itinByKey_t[k] = (itinByKey_t[k] || 0) + 1;', '            ;'),
  }),
  // The trim is behaviour, not tidiness: the lookup it replaced trimmed the cell inside
  // tripRowMatches_, so a key typed with a trailing space has always counted.
  'the key cell is no longer trimmed': b => ({
    'Claude.js': swap(b['Claude.js'],
      "            var k = String(r[1] == null ? '' : r[1]).trim();\n" +
      '            if (k) packByKey_t[k] = (packByKey_t[k] || 0) + 1;',
      "            var k = String(r[1] == null ? '' : r[1]);\n" +
      '            if (k) packByKey_t[k] = (packByKey_t[k] || 0) + 1;'),
  }),
  'the itinerary key cell is no longer trimmed': b => ({
    'Claude.js': swap(b['Claude.js'],
      "            var k = String(r[1] == null ? '' : r[1]).trim();\n" +
      '            if (k) itinByKey_t[k] = (itinByKey_t[k] || 0) + 1;',
      "            var k = String(r[1] == null ? '' : r[1]);\n" +
      '            if (k) itinByKey_t[k] = (itinByKey_t[k] || 0) + 1;'),
  }),
  'the two tallies are crossed': b => ({
    'Claude.js': swap(b['Claude.js'],
      '          var itinCount = countForTripKeys_(itinByKey_t, cKeys);',
      '          var itinCount = countForTripKeys_(packByKey_t, cKeys);'),
  }),

  // ---- alias matching ------------------------------------------------------
  'the lookup matches the canonical key only': b => ({
    'Claude.js': swap(b['Claude.js'], LOOKUP,
      '          var packCount = packByKey_t[tripKey] || 0;\n' +
      '          var itinCount = itinByKey_t[tripKey] || 0;'),
  }),
  'the alias sum stops at the first key': b => ({
    'Trips.js': swap(b['Trips.js'],
      '  for (var i = 0; i < keys.length; i++) {', '  for (var i = 0; i < 1; i++) {'),
  }),
  'the alias sum counts a missing key as one row': b => ({
    'Trips.js': swap(b['Trips.js'],
      '    if (Object.prototype.hasOwnProperty.call(bucket, keys[i])) n += Number(bucket[keys[i]]) || 0;',
      '    n += Number(bucket[keys[i]]) || 1;'),
  }),

  // ---- per-tab degradation -------------------------------------------------
  // Rethrown rather than deleted: removing the catch leaves a bare try, which is a
  // SyntaxError, and a control that cannot compile tests nothing.
  'a failed Packing read escapes and costs the whole trips section': b => ({
    'Claude.js': swap(b['Claude.js'],
      '    } catch(pe) {}\n\n    var itinByKey_t = {};',
      '    } catch(pe) { throw pe; }\n\n    var itinByKey_t = {};'),
  }),
  'a failed Itinerary read escapes too': b => ({
    'Claude.js': swap(b['Claude.js'],
      '    } catch(ie) {}\n\n    tripsSectionStr =',
      '    } catch(ie) { throw ie; }\n\n    tripsSectionStr ='),
  }),

  // ---- the morning email’s own copy ----------------------------------------
  // Same helper, same rule, other file: buildMorningIntelligence_ matched the canonical
  // key only and under-reported packing for a trip keyed by an alias.
  'the morning travel section matches the canonical key only': b => ({
    'Code.js': swap(b['Code.js'],
      '      var packTotal = countForTripKeys_(packTotalByKey, cKeys);\n' +
      '      var packDone  = countForTripKeys_(packDoneByKey,  cKeys);',
      '      var packTotal = packTotalByKey[tripKey] || 0;\n' +
      '      var packDone  = packDoneByKey[tripKey] || 0;'),
  }),
  'the morning travel section stops counting what is packed': b => ({
    'Code.js': swap(b['Code.js'],
      "            if (checked === 'true' || checked === 'yes') packDoneByKey[k] = (packDoneByKey[k] || 0) + 1;",
      '            ;'),
  }),
};

// Each control is checked against the test that owns the behaviour: the Claude prompt
// ones against test_claudepacking.js, the morning email's against test_morningintel.js.
const TEST_FOR = name => (name.indexOf('morning travel section') !== -1
  ? 'test_morningintel.js'
  : 'test_claudepacking.js');

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

  const r = cp.spawnSync('node', [TEST_FOR(name)], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name + '  [' + TEST_FOR(name) + ']');
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
