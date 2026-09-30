const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl4');
const F = 'TravelDayBriefing.js';
const BASE = fs.readFileSync(path.join(SRC_DIR, F), 'utf8');

function fnOf(src, name) {
  const s = src.indexOf('function ' + name + '(');
  let d = 0;
  for (let j = src.indexOf('{', s); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(s, j + 1); }
  }
}

const CONTROLS = {
  'grounding check removed (today\'s behaviour)': b =>
    b.replace(fnOf(b, 'loungeNameIsGrounded_'),
      'function loungeNameIsGrounded_(name, corpus) { return true; }'),

  'grounding checked against a merged corpus': b =>
    b.replace('var corpus = loungeCorpusFor_(candidates, code);',
      'var corpus = Object.keys(candidates).map(function(k){return loungeCorpusFor_(candidates,k);}).join("");'),

  'hedged names accepted': b =>
    b.replace(/    if \(\/\[\(\\\[\]\/\.test\(name\)\)[^\n]*\n    if \(LOUNGE_HEDGE_RE_\.test\(name\)\)[^\n]*\n/, ''),

  'non-answers printed as data': b =>
    b.replace(fnOf(b, 'loungeDetailOrNull_'),
      'function loungeDetailOrNull_(v) { var t = String(v == null ? "" : v).trim(); return t || null; }'),

  'the tip survives a drop (the fabrication leaks back)': b =>
    b.replace('if (!result.lounges.length || verdict.dropped.length) result.tip = \'\';',
              'if (!result.lounges.length) result.tip = \'\';'),

  'ungrounded model call when search is unavailable': b =>
    b.replace(/  if \(!candidateCount\) \{[\s\S]*?    return bare;\n  \}\n/, ''),

  'airport and programme allowlists removed': b =>
    b.replace(/    if \(!okAirports\[code\]\)[^\n]*\n/, '')
     .replace(/    if \(!okPrograms\[prog\.toLowerCase\(\)\]\)[^\n]*\n/, ''),

  'search results not cached': b =>
    b.replace('var cached = cache.get(cacheKey);', 'var cached = null;'),

  'query cap lifted': b =>
    b.replace('var LOUNGE_SEARCH_MAX_QUERIES_ = 12;', 'var LOUNGE_SEARCH_MAX_QUERIES_ = 999;'),

  'the pair-verification path removed (tonight\'s false negative returns)': b =>
    b.replace(/      var verdict = 'UNKNOWN';\n      try \{ verdict = verifyLoungeProgramAtAirport_\(prog, code\); \} catch \(ve\) \{\n        Logger\.log\('validateLounges_: verification threw — ' \+ ve\.message\);\n      \}\n      if \(verdict !== 'CONFIRMED'\) \{/,
      "      var verdict = 'NOT_FOUND';\n      if (verdict !== 'CONFIRMED') {"),

  'verification admits anything (UNKNOWN counts as yes)': b =>
    b.replace("if (verdict !== 'CONFIRMED') {", "if (false) {"),

  'the verbatim fast path removed (every name needs a call)': b =>
    b.replace('if (loungeNameIsGrounded_(name, corpus)) {', 'if (false) {'),

  'the 60-char cap restored, before grounding': b =>
    b.replace(/    \/\/ TWO WAYS IN[\s\S]*?var corpus = loungeCorpusFor_\(candidates, code\);/,
      "    if (name.length > 60) { dropped.push(name.substring(0, 40) + '\u2026 — name too long to be a name'); return; }\n    var corpus = loungeCorpusFor_(candidates, code);"),

  'the query template duplicates "lounge" again': b =>
    b.replace(/function loungeProgramQuery_\(program, code\) \{[\s\S]*?\n\}/,
      "function loungeProgramQuery_(program, code) { return String(program || '').trim() + ' lounge ' + code + ' airport'; }"),

  'the general airport listing query removed': b =>
    b.replace(/  codes\.forEach\(function\(code\) \{\n    byAirport\[code\] = byAirport\[code\] \|\| \[\];\n    fetch_\(loungeAirportQuery_\(code\)[^\n]*\n  \}\);\n/,
      "  codes.forEach(function(code) { byAirport[code] = byAirport[code] || []; });\n"),

  'the old recall prompt restored': b =>
    b.replace("    'You are selecting airport lounges from SEARCH RESULTS. Do not use prior knowledge.\\n\\n' +",
              "    'You are a travel assistant with detailed knowledge of airport lounges worldwide.\\n' +\n    'IMPORTANT: Only include lounges you are CONFIDENT exist. OMIT it entirely — do not guess.\\n\\n' +"),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const mutated = CONTROLS[name](BASE);
  fs.writeFileSync(path.join(OUT, F), mutated);

  const r = cp.spawnSync('node', ['test_loungegrounding.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
  if (mutated === BASE) { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)          { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length)    { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 5).forEach(f => console.log('    - ' + f));
  if (fails.length > 5) console.log('    … and ' + (fails.length - 5) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
