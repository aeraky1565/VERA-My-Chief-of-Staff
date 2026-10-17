// Negative controls for test_geninputs.js: revert ONE protection at a time and confirm
// the test bites.
//
// Several of these restore real defects, not hypothetical ones: lite generating with no
// end date, the weather service called with end_date= and failing silently, the
// month-only season that called December in Sydney "Winter", and a regenerate that
// wiped every checkmark. The rest guard the record and its flags, whose failures are
// quiet by nature — a superseded warning that never closes, a resolved one that comes
// back, two similar trips sharing one flag.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_geninpt');

const FILES = ['GenerationInputs.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

// An anchor that moved must THROW; replacements go through a function so `$` is literal.
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const GI = 'GenerationInputs.js', WEB = 'WebApp.js', CODE = 'Code.js', LITE = 'docs/dashboard-lite.html';

const CONTROLS = {
  // ---- the real defects, restored -----------------------------------------
  'dashboard-lite stops sending the end date again': b => ({
    [LITE]: swap(b[LITE], "action:'generate_packing',tripKey,startDate,endDate}", "action:'generate_packing',tripKey,startDate}"),
  }),
  'the weather lookup goes to the service without dates again': b => ({
    [WEB]: swap(b[WEB], "  if (!startDate || !endDate) { out.reason = 'no trip dates (' + (startDate ? 'end date' : 'start date') + ' missing)'; return out; }\n", ''),
  }),
  'the season goes back to the month alone (Sydney in December is "Winter")': b => ({
    [GI]: swap(b[GI], "  if (lat < 0) return { season: flip[north], basis: 'south' };\n", ''),
  }),
  'regenerating deletes checked items again': b => ({
    [GI]: swap(b[GI], '    if (r.checked) keptKeys[genItemKey_(r.person, r.item)] = r;\n    else deleteRows.push(r.rowNum);',
                      '    deleteRows.push(r.rowNum);'),
  }),
  'the missing end date is no longer filled from the trip': b => ({
    [GI]: swap(b[GI], '      if (rec && rec.endDate) e = rec.endDate;\n', ''),
  }),
  'Discover stops seeing the weather': b => ({
    [WEB]: swap(b[WEB], "    (weatherSummary ? 'Weather: ' + weatherSummary + '\\n' : '') + '\\n' +", "    '\\n' +"),
  }),

  // ---- the factors -------------------------------------------------------
  'the equator gets a season name': b => ({
    [GI]: swap(b[GI], "  if (Math.abs(lat) < 15) return { season: 'Tropical (no real seasons)', basis: 'tropical' };\n", ''),
  }),
  'a destination guessed from the trip’s name counts as solid': b => ({
    [GI]: swap(b[GI], "  if (dest.source === 'label') {", '  if (false) {'),
  }),
  'last year’s weather passes for a forecast': b => ({
    [GI]: swap(b[GI], "  if (w.mode === 'last_year') {", '  if (false) {'),
  }),
  'no dress codes becomes a warning': b => ({
    [GI]: swap(b[GI], "genFactor_('dresscodes', 'Dress codes', 'none', 'None on the itinerary')",
                      "genFactor_('dresscodes', 'Dress codes', 'missing', 'None on the itinerary')"),
  }),
  'unreadable lessons are passed off as "none apply"': b => ({
    [GI]: swap(b[GI], "  if (error) return genFactor_('lessons', 'Lessons from past trips', 'missing', 'Couldn’t read them: ' + error);\n", ''),
  }),

  // ---- keeping checkmarks -------------------------------------------------
  'a checked item the new list repeats is added a second time': b => ({
    [GI]: swap(b[GI], '    if (!keptKeys[k]) append.push(n);', '    append.push(n);'),
  }),
  'item matching becomes case-sensitive': b => ({
    [GI]: swap(b[GI], "String(item || '').trim().toLowerCase().replace(/\\s+/g, ' ')", "String(item || '').trim()"),
  }),

  // ---- the record and its flags ------------------------------------------
  'a superseded generation’s flag is never closed': b => ({
    [GI]: swap(b[GI], "  resolveFlagsWithPrefix_(flagSheet, genFlagKey_('inputs',   record.kind, record.tripKey) + '__', keep);\n", ''),
  }),
  'flag keys use a single underscore, so similar trips collide': b => ({
    [GI]: swap(b[GI], ".join('__');", ".join('_');"),
  }),
  'the forecast nudge fires however far away the trip is': b => ({
    [GI]: swap(b[GI], "  if (record.weatherMode === 'last_year' && item.daysUntil <= GEN_FORECAST_DAYS_) {", "  if (record.weatherMode === 'last_year') {"),
  }),
  'a list with no record raises nothing': b => ({
    [GI]: swap(b[GI], '  if (!record) {\n    return [{', '  if (!record) {\n    return []; return [{'),
  }),
  'the exact-key writer raises the same flag every night': b => ({
    [CODE]: swap(b[CODE], '    if (!f.key || keys[f.key]) return;\n', '    if (!f.key) return;\n'),
  }),
  'a failed record write fails the whole generation': b => ({
    [GI]: swap(b[GI], "  } catch (e) {\n    Logger.log('recordGenerationInputs_ (' + kind",
                      "  } catch (e) { throw e;\n    Logger.log('recordGenerationInputs_ (' + kind"),
  }),

  // ---- the banner --------------------------------------------------------
  'one dashboard’s banner drifts from the other': b => ({
    [LITE]: swap(b[LITE], "'✓ Built from all ' + factors.length + ' inputs'", "'✓ Built from ' + factors.length + ' inputs'"),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });

  const r = cp.spawnSync('node', ['test_geninputs.js'], {
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
