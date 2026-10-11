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

const CONTROLS = {
  // ---- the bug itself, restored --------------------------------------------
  'the matcher only knows the old wording (the reported bug)': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      "  var notEnabled = b.indexOf('not authorized to use this api') !== -1 ||\n" +
      "                   b.indexOf('not activated') !== -1 ||\n" +
      "                   b.indexOf('api is not enabled') !== -1 ||\n" +
      "                   b.indexOf('has not been used in project') !== -1;",
      "  var notEnabled = b.indexOf('not authorized to use this api') !== -1;"),
  }),
  'it stops recognising the Calendar-style phrasing': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      "                   b.indexOf('has not been used in project') !== -1;",
      "                   false;"),
  }),
  'the 403 gate is dropped, so any status reads as not-enabled': b => ({
    'TravelDayBriefing.js': b['TravelDayBriefing.js'].replace(
      '  if (code === 403 && notEnabled) {', '  if (notEnabled) {'),
  }),

  // ---- verdicts that go to the wrong branch ---------------------------------
  'restriction is decided before not-enabled': b => {
    const s = b['TravelDayBriefing.js'];
    const neStart = s.indexOf('  if (code === 403 && notEnabled) {');
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
