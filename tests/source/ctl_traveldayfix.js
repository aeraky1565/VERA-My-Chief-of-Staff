// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The first restores the bug this file was extended for. On 10 Oct the diagnostic
// fetched the static-map URL, Google answered
//
//   HTTP 403 — "This API is not activated on your API project."
//
// and the verdict came out as "unrecognised failure" — the one case the tool exists to
// name, with a one-click fix. The matcher was looking for "not authorized to use this
// api". Nothing caught it because the assertions were regexes over the diagnostic's own
// SOURCE, which pin the matcher's spelling without ever checking that spelling against
// what Google says.
//
// So the controls that matter most are the ones that keep the code compiling, keep the
// source strings present, and still get the verdict wrong.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tdf');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

// Replacement through a FUNCTION: String.replace expands `$` patterns in a string
// replacement, and these bodies are full of them.
const swapTdb = (b, from, to) => {
  const src = b['TravelDayBriefing.js'];
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 60));
  return src.replace(from, function() { return to; });
};

const CONTROLS = {
  // ---- the trip's range (the Oct 28 flight home) ---------------------------
  'the calendar trip only fills a range the sheet left empty (the reported bug)': b => ({
    'TravelDayBriefing.js': swapTdb(b,
      "    if (end > ranges[key].max) ranges[key].max = end;\n", ''),
  }),
  'a stay\'s checkout is not part of the trip': b => ({
    'TravelDayBriefing.js': swapTdb(b,
      "checkout > ranges[tripKey].max) {", "checkout > ranges[tripKey].max && false) {"),
  }),
  'a stay runs one day past its checkout': b => ({
    'TravelDayBriefing.js': swapTdb(b,
      "      ranges[tripKey].max = checkout;\n",
      "      ranges[tripKey].max = checkout.slice(0, 8) + ('0' + (+checkout.slice(8) + 1)).slice(-2);\n"),
  }),

  // ---- the bug itself, restored --------------------------------------------
  // The wording list moved to googleApiNotEnabled_ (ApiHealth.js) when the Calendar
  // advanced service needed the same answer, so these three now mutate it there. The
  // verdict is still what gets checked — one list, two callers, one place to break it.
  'the matcher only knows the old wording (the reported bug)': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      "  return t.indexOf('not authorized to use this api') !== -1 ||\n" +
      "         t.indexOf('not activated')                  !== -1 ||\n" +
      "         t.indexOf('api is not enabled')             !== -1 ||\n" +
      "         t.indexOf('has not been used in project')   !== -1 ||\n" +
      "         t.indexOf('accessnotconfigured')            !== -1;",
      "  return t.indexOf('not authorized to use this api') !== -1;"),
  }),
  'it stops recognising the Calendar-style phrasing': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      "         t.indexOf('has not been used in project')   !== -1 ||",
      '         false ||'),
  }),
  'the 403 gate is dropped, so any status reads as not-enabled': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      '  if (code === 403 && googleApiNotEnabled_(b)) {', '  if (googleApiNotEnabled_(b)) {'),
  }),

  // ---- verdicts that go to the wrong branch ---------------------------------
  'restriction is decided before not-enabled': b => {
    const s = b['TravelDayBriefing.js'];
    const neStart = s.indexOf('  if (code === 403 && googleApiNotEnabled_(b)) {');
    const neEnd   = s.indexOf("  if (b.indexOf('referer')", neStart);
    const resEnd  = s.indexOf("  if (b.indexOf('billing')", neEnd);
    if (neStart === -1 || neEnd === -1 || resEnd === -1) throw new Error('branches not found');
    return { 'TravelDayBriefing.js':
      s.slice(0, neStart) + s.slice(neEnd, resEnd) + s.slice(neStart, neEnd) + s.slice(resEnd) };
  },
  'billing swallows everything': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      "  if (b.indexOf('billing') !== -1 || code === 402) {", '  if (true) {'),
  }),
  'a 400 no longer means a bad marker': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      '  if (code === 400) {\n    return { kind: \'bad_marker\'', "  if (false) {\n    return { kind: 'bad_marker'"),
  }),
  'the catch-all stops pointing at Google’s own text': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      '    "DIAGNOSIS — unrecognised failure. The body above is Google\'s own text.",',
      "    'DIAGNOSIS — unrecognised failure.',"),
  }),
  'everything unknown is reported as not-enabled': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      "  return { kind: 'unknown', lines: [", "  return { kind: 'not_enabled', lines: ["),
  }),

  // ---- the verdict stops reaching the caller --------------------------------
  'the diagnostic stops bisecting on a bad marker': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      "  if (verdict.kind === 'bad_marker') {", '  if (false) {'),
  }),
  'the not-enabled verdict stops naming the misleading check': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      "      '  It is separate from Distance Matrix, which is the only thing',\n" +
      "      '  testTravelLegsApi_ checks — so that passing told you nothing here.',\n", ''),
  }),
  'the not-enabled verdict stops naming the fix': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      '      \'  Fix: Cloud Console -> APIs & Services -> enable "Maps Static API".\',\n', ''),
  }),

  // ---- the key probe --------------------------------------------------------
  // Each of these keeps the probe compiling and makes it answer wrongly, which is the
  // only failure mode that matters in a function whose entire output is a yes or a no.
  'the probe fetches even with no key': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      "    return { ok: false, code: 0, contentType: '', body: '', verdict: null, reason: 'no key' };",
      '    ;'),
  }),
  'the probe stops classifying the failure': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      '    verdict:     ok ? null : travelMapVerdict_(code, body),',
      '    verdict:     null,'),
  }),
  'the probe passes the STATUS instead of the body to the verdict': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      '    verdict:     ok ? null : travelMapVerdict_(code, body),',
      "    verdict:     ok ? null : travelMapVerdict_(code, ''),"),
  }),
  // Addresses reintroduce geocoding, so a 400 for an unresolvable place looks exactly
  // like the API being off — the ambiguity the coordinates exist to remove.
  'the probe markers go back to addresses': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      "var STATIC_MAP_PROBE_MARKERS_ = ['38.9072,-77.0369', '41.8781,-87.6298'];",
      "var STATIC_MAP_PROBE_MARKERS_ = ['Washington DC', 'Chicago IL'];"),
  }),
  'a one-marker probe, which no real map is': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      "var STATIC_MAP_PROBE_MARKERS_ = ['38.9072,-77.0369', '41.8781,-87.6298'];",
      "var STATIC_MAP_PROBE_MARKERS_ = ['38.9072,-77.0369'];"),
  }),
  'any 200 counts as a working map': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      "  var ok = code === 200 && ctype.toLowerCase().indexOf('image') === 0;",
      '  var ok = code === 200;'),
  }),
  'a thrown request escapes the probe': b => {
    const s2 = b['TravelDayBriefing.js'];
    const anchor = "    return { ok: false, code: 0, contentType: '', body: String(e.message || e),\n" +
                   "             verdict: null, reason: 'fetch threw' };";
    if (s2.indexOf(anchor) === -1) throw new Error('the throw guard moved');
    return { 'TravelDayBriefing.js': s2.replace(anchor, '    throw e;') };
  },
  // ---- the key-restriction verdict ------------------------------------------
  'the key-restriction 403 goes back to "unrecognised"': b => {
    const s2 = b['TravelDayBriefing.js'];
    const start = s2.indexOf("  if (b.indexOf('not authorized to use this service or api') !== -1 ||");
    const end   = s2.indexOf("  if (b.indexOf('referer') !== -1", start);
    if (start === -1 || end === -1) throw new Error('the key-restriction branch moved');
    return { 'TravelDayBriefing.js': s2.slice(0, start) + s2.slice(end) };
  },
  // Both are restrictions with incompatible fixes, so the order is the behaviour.
  'the referrer branch is checked first, naming the wrong fix': b => {
    const s2 = b['TravelDayBriefing.js'];
    const kStart = s2.indexOf("  if (b.indexOf('not authorized to use this service or api') !== -1 ||");
    const kEnd   = s2.indexOf("  if (b.indexOf('referer') !== -1", kStart);
    const rEnd   = s2.indexOf("  if (b.indexOf('billing')", kEnd);
    if (kStart === -1 || kEnd === -1 || rEnd === -1) throw new Error('branches not found');
    return { 'TravelDayBriefing.js':
      s2.slice(0, kStart) + s2.slice(kEnd, rEnd) + s2.slice(kStart, kEnd) + s2.slice(rEnd) };
  },
  'it only matches the first phrase, not the restrictions wording': b => ({
    'TravelDayBriefing.js': swapTdb(b,
      "  if (b.indexOf('not authorized to use this service or api') !== -1 ||\n" +
      "      b.indexOf('api restrictions settings') !== -1) {",
      "  if (b.indexOf('not authorized to use this service or api') !== -1) {"),
  }),
  // The shared predicate learning this wording would name the wrong remedy here AND
  // leak into the Calendar advanced service, which has no API-key restriction list.
  'googleApiNotEnabled_ swallows it as a disabled API': b => ({
    'ApiHealth.js': b['ApiHealth.js'].replace(
      "         t.indexOf('accessnotconfigured')            !== -1;",
      "         t.indexOf('accessnotconfigured')            !== -1 ||\n" +
      "         t.indexOf('not authorized to use this')     !== -1;"),
  }),

  'the TestBench entry needs a knob again': b => ({
    'TestBench.js': b['TestBench.js'].replace(
      '  var r = probeStaticMapsKey_();',
      '  var r = probeStaticMapsKey_(TB_DATE);'),
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

  const r = cp.spawnSync('node', ['test_traveldayfix.js'], {
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
