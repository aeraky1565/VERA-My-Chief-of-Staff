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

const FILES = ['GenerationInputs.js', 'Code.js', 'WebApp.js', 'Trips.js', 'TravelDayBriefing.js', 'docs/app.js', 'docs/dashboard-lite.html'];
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
    [GI]: swap(b[GI], "  if (Math.abs(lat) < GEN_TROPICS_LAT_) return { season: 'Tropical (no real seasons)', basis: 'tropical' };\n", ''),
  }),
  'the tropical cut-off goes back to 15° (Puerto Plata in November is "Fall")': b => ({
    [GI]: swap(b[GI], 'var GEN_TROPICS_LAT_    = 23.44;', 'var GEN_TROPICS_LAT_    = 15;'),
  }),
  'an assumed traveller list is flagged as missing again': b => ({
    [GI]: swap(b[GI], "    genFactor_('travellers', 'Travellers', 'used',\n",
                      "    genFactor_('travellers', 'Travellers', g.travellerSource === 'assumed' ? 'missing' : 'used',\n"),
  }),

  // ---- the November cruise: geocoding and places -------------------------
  'the geocoder is sent the full string only (the hotel’s address finds nothing)': b => ({
    [WEB]: swap(b[WEB], '    var cands = geocodeCandidates_(destination);', "    var cands = [{ name: destination, countryCode: '' }];"),
  }),
  'the event’s words are ignored (Saint Thomas lands in Ontario)': b => ({
    [WEB]: swap(b[WEB], '      const r = geoPickResult_(data.results, hint);', "      const r = geoPickResult_(data.results, '');"),
  }),
  '"U.S." and "US" no longer read alike': b => ({
    [WEB]: swap(b[WEB], "      var t = String(w || '').toLowerCase().replace(/\\./g, '').replace(", "      var t = String(w || '').toLowerCase().replace("),
  }),
  'every located event on the trip becomes a port, cruise or not': b => ({
    [GI]: swap(b[GI], '    if (inside) out.push(', '    out.push('),
  }),
  'flight origins are counted as ports': b => ({
    [GI]: swap(b[GI], "if (!loc || !date || type === 'flight' || type === 'cruise') return;", "if (!loc || !date || type === 'cruise') return;"),
  }),
  'no 50 km filter: the home port is a "stop"': b => ({
    [GI]: swap(b[GI], '    if (base.geo && genKm_(base.geo, g) < GEN_PORT_RADIUS_KM_) return;\n', ''),
  }),
  'a stop that doesn’t resolve is kept anyway ("Swim With The Pigs")': b => ({
    [GI]: swap(b[GI], '    if (!g) return;\n    if (base.geo', "    if (!g) g = { lat: 0, lon: 0, name: c.location, country: '' };\n    if (base.geo"),
  }),
  'a renamed trip’s rows stop counting as ports': b => ({
    [GI]: swap(b[GI], "typeof tripKeysFor_ === 'function' ? tripKeysFor_(tripKey) : [tripKey];", '[tripKey];'),
  }),
  'every stop is looked up for the whole trip, not its own day': b => ({
    [GI]: swap(b[GI], 'getPackingWeatherDetail_(p.label, p.date, p.date, p.geo)', 'getPackingWeatherDetail_(p.label, startDate, endDate, p.geo)'),
  }),
  'a stop on last year’s weather lets the whole pass for a forecast': b => ({
    [GI]: swap(b[GI], "    mode:    got.length ? (anyLast ? 'last_year' : 'forecast') : '',", "    mode:    got.length ? 'forecast' : '',"),
  }),
  'only one spelling of a saint is tried (Saint Thomas is lost again)': b => ({
    [WEB]: swap(b[WEB], '  return spelled;\n', '  return out;\n'),
  }),
  'a leading "St" reads as a street again': b => ({
    [WEB]: swap(b[WEB], "  function isStreet(p) { return STREET.test(String(p).replace(/^(st\\.?|saint)\\s+/i, '')); }",
                        '  function isStreet(p) { return STREET.test(p); }'),
  }),
  'no title fallback when the location finds nothing': b => ({
    [GI]: swap(b[GI], '    if (!g && genTitleNamesPlace_(c.title, c.location)) g = geocodePackingDestination_(c.title, hint);\n', ''),
  }),
  'every title is searched as a place (an excursion lands in the Caymans)': b => ({
    [GI]: swap(b[GI], '    if (!g && genTitleNamesPlace_(c.title, c.location)) g =', '    if (!g) g ='),
  }),
  'same-day neighbours are separate stops (Goat Cay is a fifth port)': b => ({
    [GI]: swap(b[GI], '    if (ports.some(function(p) { return p.date === c.date && genKm_(p.geo, g) < GEN_PORT_RADIUS_KM_; })) return;\n', ''),
  }),
  'each place repeats its packing advice in the combined weather': b => ({
    [GI]: swap(b[GI], '    return m ? m[1].trim() : x.replace(', '    return x; return m ? m[1].trim() : x.replace('),
  }),
  'the season ignores the tropical stops': b => ({
    [GI]: swap(b[GI], "  return tropicalStop ? { season: s.season + '; tropical at the cruise stops', basis: s.basis } : s;", '  return s;'),
  }),
  'the itinerary’s traveller tags are never read': b => ({
    [GI]: swap(b[GI], "  if (names(tags)) return { value: names(tags), source: 'itinerary' };\n", ''),
  }),
  'the trip’s own "Both" is ignored (always assumed)': b => ({
    [GI]: swap(b[GI], "  if (names(own)) return { value: names(own), source: 'trip' };\n", ''),
  }),
  'the banner hides that the travellers were assumed': b => ({
    [GI]: swap(b[GI], "(GEN_TRAVELLER_SOURCE_[g.travellerSource] || GEN_TRAVELLER_SOURCE_.assumed)", "'set on the trip'"),
  }),
  'packing never resolves the travellers': b => ({
    [WEB]: swap(b[WEB], '  traveler = travellers.value;\n', ''),
  }),
  'an airport code is searched as a place name again (ORD → Ord, Nebraska)': b => ({
    [WEB]: swap(b[WEB], '    if (isAirportCode) {', '    if (false) {'),
  }),
  'packing goes back to the hotel’s raw address': b => ({
    [WEB]: swap(b[WEB], '  const places      = tripPlaces_(itinData, tripKey, tripLabel, endDate);\n', '  const places      = { base: inferTripDestination_(itinData, tripKey, tripLabel), ports: [] };\n'),
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
