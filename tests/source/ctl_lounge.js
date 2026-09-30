// Negative controls: revert ONE behaviour at a time against the new source and
// confirm the assertions that cover it actually bite. A whole-file revert only
// proves the file changed.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const SRC = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl');

const TDB = fs.readFileSync(SRC + '/TravelDayBriefing.js', 'utf8');
const EP  = fs.readFileSync(SRC + '/EmailParser.js', 'utf8');
const TB  = fs.readFileSync(SRC + '/TestBench.js', 'utf8');

function fnOf(src, name) {
  const s = src.indexOf('function ' + name + '(');
  let d = 0;
  for (let j = src.indexOf('{', s); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); }
  }
}

// The matcher exactly as it was before: one keyword array, a separate normalize
// cascade, first match wins.
const OLD_MATCHER = `function loungeProgramsForPerk_(perkName) {
  var perkLower = String(perkName || '').toLowerCase();
  var loungeKeywords = ['lounge', 'priority pass', 'centurion', 'capital one lounge'];
  var matchedProgram = null;
  loungeKeywords.forEach(function(kw) {
    if (!matchedProgram && perkLower.indexOf(kw) !== -1) {
      if (perkLower.indexOf('centurion') !== -1) matchedProgram = 'Centurion Lounge';
      else if (perkLower.indexOf('priority pass') !== -1) matchedProgram = 'Priority Pass';
      else if (perkLower.indexOf('capital one') !== -1) matchedProgram = 'Capital One Lounge';
      else matchedProgram = String(perkName || '');
    }
  });
  return matchedProgram ? [matchedProgram] : [];
}`;

const CONTROLS = {
  'old matcher (keyword array + normalize cascade, first match wins)': () => ({
    'TravelDayBriefing.js': TDB.replace(fnOf(TDB, 'loungeProgramsForPerk_'), OLD_MATCHER),
    'EmailParser.js': EP, 'TestBench.js': TB,
  }),
  'old empty-data shape (no programs carried, so no fallback)': () => ({
    'TravelDayBriefing.js': TDB.replace(fnOf(TDB, 'emptyLoungeData_'),
      "function emptyLoungeData_(programs, airports) { return { lounges: [], tip: '' }; }")
      .replace(/result\.programs = loungePerks;/, 'result.programs = [];'),
    'EmailParser.js': EP, 'TestBench.js': TB,
  }),
  'old HTML gate (hide the section whenever no lounge was named)': () => ({
    'TravelDayBriefing.js': TDB.replace(
      /  if \(!data\.lounges \|\| !data\.lounges\.length\) \{\n    if \(!data\.programs[^\n]*\n[^\n]*\n  \}/,
      '  if (!data.lounges || !data.lounges.length) return \'\';'),
    'EmailParser.js': EP, 'TestBench.js': TB,
  }),
  'old plain-text gate (heading only when a lounge was named)': () => ({
    'TravelDayBriefing.js': TDB.replace(
      /\} else if \(loungeData\.programs && loungeData\.programs\.length\) \{/,
      '} else if (false) {'),
    'EmailParser.js': EP, 'TestBench.js': TB,
  }),
  'no caveat line in either renderer': () => ({
    'TravelDayBriefing.js': TDB
      .replace(/^var LOUNGE_CAVEAT_ = [\s\S]*?;$/m, "var LOUNGE_CAVEAT_ = '';")
      .replace(/\n\s*lines\.push\(LOUNGE_CAVEAT_\);/, ''),
    'EmailParser.js': EP, 'TestBench.js': TB,
  }),
  'hardcoded max_tokens: 1024 (no opts argument)': () => ({
    'TravelDayBriefing.js': TDB,
    'EmailParser.js': EP.replace(fnOf(EP, 'callClaudeJson_'),
      fnOf(EP, 'callClaudeJson_')
        .replace('function callClaudeJson_(prompt, fallback, opts) {', 'function callClaudeJson_(prompt, fallback) {')
        .replace(/var maxTokens = [^\n]*\n/, '')
        .replace('max_tokens: maxTokens,', 'max_tokens: 1024,')),
    'TestBench.js': TB,
  }),
  'no gate logging in the caller': () => ({
    'TravelDayBriefing.js': TDB.replace(/Logger\.log\('LOUNGE: gate ([23]) [^;]*;/g, ''),
    'EmailParser.js': EP, 'TestBench.js': TB,
  }),
  'the airport scan copied into the diagnostic instead of shared': () => ({
    'TravelDayBriefing.js': TDB.replace(/airports = travelDayAirports_\(rows\);/, 'airports = [];'),
    'EmailParser.js': EP, 'TestBench.js': TB,
  }),
  'no TestBench entry point': () => ({
    'TravelDayBriefing.js': TDB, 'EmailParser.js': EP,
    'TestBench.js': TB.replace(/function tbLoungeAccess\(\)/, 'function tbLoungeAccessDISABLED()'),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const files = CONTROLS[name]();
  Object.keys(files).forEach(f => fs.writeFileSync(path.join(OUT, f), files[f]));

  // The mutation must actually have landed, or the control proves nothing.
  const changed = Object.keys(files).some(f => files[f] !== ({ 'TravelDayBriefing.js': TDB, 'EmailParser.js': EP, 'TestBench.js': TB })[f]);

  const r = cp.spawnSync('node', ['test_lounge.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
  if (!changed) { console.log('  !! MUTATION DID NOT APPLY — control is vacuous'); allBit = false; return; }
  if (crashed)  { console.log('  !! CRASHED without a clean assertion failure'); console.log(out.split('\n').slice(-12).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT — the suite passes with this reverted'); allBit = false; return; }
  console.log('  ' + fails.length + ' assertion(s) bit:');
  fails.slice(0, 8).forEach(f => console.log('    - ' + f));
  if (fails.length > 8) console.log('    … and ' + (fails.length - 8) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
