// Apps Script loads every root .js file into ONE global scope, and function
// declarations hoist across files. Two files declaring the same function name
// is therefore not a style problem — one of them silently wins, and every call
// site written against the loser gets the winner's signature instead.
//
// This found inferTripDestination_ already broken in two places, and caught a
// todayStr_ I was about to add on top of Summaries.js's.
const fs = require('fs'), path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// Root .js only — docs/ is browser code with its own scope, and node_modules
// and the playwright config are not part of the Apps Script project.
const files = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.js') && f !== 'playwright.config.js');

// Top-level declarations only: a nested helper is scoped to its parent and
// cannot collide. Anchoring on column 0 is exactly that distinction.
const DECL = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
const VAR  = /^(?:var|const|let)\s+([A-Za-z0-9_$]+)\s*=/gm;

const seen = {};
files.forEach(f => {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  [DECL, VAR].forEach(re => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split('\n').length;
      (seen[m[1]] = seen[m[1]] || []).push(f + ':' + line);
    }
  });
});

const dupes = Object.keys(seen).filter(k => {
  const inFiles = new Set(seen[k].map(s => s.split(':')[0]));
  return inFiles.size > 1;
}).sort();

console.log('\nno name is declared in two files');
check(dupes.length + ' duplicate global name(s)', dupes.length === 0,
      dupes.length ? '\n' + dupes.map(d => '         ' + d + '  →  ' + seen[d].join(', ')).join('\n') : undefined);

// The specific ones this feature depends on resolving correctly.
console.log('\nthe names phase 3 relies on are unique');
['inferTripDestination_', 'todayStr_', 'tripDailyForecast_', 'weatherVerdictFor_',
 'recommendForGroup_', 'applyTripRecommendations_', 'checkTripDecisionPremises_',
 'isOutdoorType_', 'isIndoorType_'].forEach(name => {
  const where = seen[name] || [];
  const inFiles = new Set(where.map(s => s.split(':')[0]));
  check(name, inFiles.size === 1, where.length ? where.join(', ') : 'not declared anywhere');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
