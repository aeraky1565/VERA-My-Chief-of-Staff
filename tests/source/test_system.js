// System tab server reads (System.js, issue #222 stage 1) on invented data: each document's
// "used by" line (Family Planning's policy pick by id or by name, Chat for all), and API health
// as OK / slow / failing with counts, worst first. Every name and value is invented.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SYS = read('System.js'), API = read('ApiHealth.js'), WEB = read('WebApp.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(SYS + '\n' + extractFn(API, 'formatAge_'), ctx);

console.log('\nused by');
const RES = [{ id: 'RES-1', name: 'Example Corp Leave Policy' }, { id: 'RES-2', name: 'Lease agreement' }, { id: 'RES-3', name: 'Second Leave Policy' }];
let u = ctx.sysUsedBy_(RES, { policyDoc_Ahmed: 'RES-1', policyDoc_Victoria: 'second leave' });
check('a policy picked by id is used by Family Planning for that parent', J(u['RES-1']) === J(['Family Planning: Ahmed’s leave policy', 'Chat: VERA can read it when you ask']), J(u['RES-1']));
check('a policy picked by name matches, ignoring case', u['RES-3'][0] === 'Family Planning: Victoria’s leave policy', J(u['RES-3']));
check('every document says Chat can read it', ['RES-1', 'RES-2', 'RES-3'].every(id => u[id][u[id].length - 1] === 'Chat: VERA can read it when you ask'));
check('a document nobody picked is only used by Chat', J(u['RES-2']) === J(['Chat: VERA can read it when you ask']));
u = ctx.sysUsedBy_(RES, {});
check('with no policy picks, nothing claims Family Planning', Object.keys(u).every(id => u[id].length === 1));
u = ctx.sysUsedBy_(RES, { policyDoc_Ahmed: 'RES-1', policyDoc_Victoria: 'RES-1' });
check('one document can be both parents’ policy', u['RES-1'].length === 3);

console.log('\nAPI health');
const NOW = Date.UTC(2026, 10, 2, 12, 0, 0), H = 3600e3;
const STATE = {
  'weather': { lastSuccess: NOW - 2 * H, consecutiveFailures: 0 },
  'flights': { lastSuccess: NOW - 30 * H, lastFailure: NOW - H, consecutiveFailures: 3, lastError: 'HTTP 500 — boom' },
  'maps':    { lastSuccess: NOW - H, consecutiveFailures: 0, lastRateLimited: NOW - 3 * H },
  'news':    { lastSuccess: NOW - 26 * H, consecutiveFailures: 0 },
  'zeta':    { lastSuccess: 0, consecutiveFailures: 0 },
  'alpha':   { lastSuccess: NOW - 60e3, consecutiveFailures: 0, lastRateLimited: NOW - 30 * H },
};
const hh = ctx.sysApiHealth_(STATE, NOW), by = n => hh.sources.find(s => s.source === n);
check('a source whose last call failed is failing, with the count and error', by('flights').status === 'failing' && /3 failed calls in a row · HTTP 500 — boom/.test(by('flights').why), J(by('flights')));
check('one failure says so in the singular', ctx.sysApiHealth_({ x: { consecutiveFailures: 1 } }, NOW).sources[0].why === '1 failed call');
check('rate limited in the last day is slow, not failing', by('maps').status === 'slow' && /^Rate limited 3h ago$/.test(by('maps').why), J(by('maps')));
check('rate limited more than a day ago is OK again', by('alpha').status === 'ok');
check('no good call in a day is slow', by('news').status === 'slow' && by('news').why === 'No good call in 1d 2h', J(by('news')));
check('never a good call is slow', by('zeta').status === 'slow' && by('zeta').why === 'No good call on record');
check('a recent good call is OK', by('weather').status === 'ok' && by('weather').lastSuccessAgo === '2h');
check('counts add up', J(hh.counts) === J({ ok: 2, slow: 3, failing: 1 }), J(hh.counts));
check('failing first, then slow, then OK, by name within each', J(hh.sources.map(s => s.source)) === J(['flights', 'maps', 'news', 'zeta', 'alpha', 'weather']), J(hh.sources.map(s => s.source)));
check('an empty map is all zeros', J(ctx.sysApiHealth_({}, NOW).counts) === J({ ok: 0, slow: 0, failing: 0 }));

console.log('\nwiring');
check('the two GET routes', /case 'system_documents':\s+return jsonOut_\(webSystemDocuments_\(\)\);/.test(WEB) && /case 'system_api_health':\s+return jsonOut_\(webSystemApiHealth_\(\)\);/.test(WEB));
check('Documents reads Family Planning’s settings and puts usedBy on each row', /fpReadSettings_\(\)/.test(extractFn(SYS, 'webSystemDocuments_')) && /r\.usedBy = used\[r\.id\]/.test(SYS));
check('nothing in System.js writes a sheet', !/setValue|appendRow|deleteRow|insertSheet/.test(SYS));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
