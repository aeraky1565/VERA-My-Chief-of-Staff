// The trip-identity read helpers from Trips.js (tripKeyMatches_ and friends),
// loaded into every vm context a test creates after calling this.
//
// Read sites now match a trip's rows by every key it has gone by, through
// these helpers. A test that brace-matches one function out of the source
// would otherwise hit "tripKeyMatches_ is not defined". With no tripKeysFor_
// in the context they reduce to the old exact comparison, so a test's own
// expectations are unchanged.
const fs = require('fs'), path = require('path');

function extract(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('tripkey_helpers: not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('tripkey_helpers: unbalanced: ' + name);
}

module.exports = function installTripKeyHelpers(vm) {
  const repo = path.join(__dirname, '..', '..');
  const root = process.env.VERA_ROOT && fs.existsSync(path.join(process.env.VERA_ROOT, 'Trips.js'))
    ? process.env.VERA_ROOT : repo;
  const src = fs.readFileSync(path.join(root, 'Trips.js'), 'utf8');
  const code = ['tripRowMatches_', 'tripKeyMatches_', 'tripKeyRowIndex_', 'tripKeyForWrite_']
    .map(n => extract(src, n)).join('\n');
  const create = vm.createContext;
  if (create.__tripKeys) return;
  vm.createContext = function(o, opts) {
    const c = create.call(vm, o, opts);
    vm.runInContext(code, c);
    return c;
  };
  vm.createContext.__tripKeys = true;
};
