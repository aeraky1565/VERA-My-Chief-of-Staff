// Negative controls for "a check-off is a purchase" (Pantry.js shopCheckLog_, WebApp.js
// webToggleShoppingItem_, the dashboards' toggle handlers): revert ONE rule at a time and
// confirm test_shopcheck.js catches it. Node only, so these run in CI's controls job too.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_shopck');

const FILES = ['Pantry.js', 'Shopping.js', 'WebApp.js', 'Code.js', 'Chat.js', 'docs/app.js', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const P = 'Pantry.js', W = 'WebApp.js', SH = 'Shopping.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });

const CONTROLS = [
  ['an untick removes any day\'s row', one(P, "if (day === today && String(c[2]", "if (String(c[2]")],
  ['an untick ignores the store', one(P, " && String(c[7] || '').trim() === store && String(c[9]", " && String(c[9]")],
  ['an untick removes a receipt row too', one(P, " && String(c[9] || '').trim() === 'checkout') {", ") {")],
  ['a Date cell is not read as a day', one(P, "var day = c[4] instanceof Date ? Utilities.formatDate(c[4], tz, 'yyyy-MM-dd') : String(c[4] || '').slice(0, 10);", "var day = String(c[4] || '').slice(0, 10);")],
  ['VERA\'s marker is logged as part of the name', one(P, "  var raw  = String(rawText || '').replace(/^🤖\\s*/, '').replace(/\\s*\\(est\\..*?\\)$/, '').trim();\n  var norm = normalizeItemName_(raw);\n  if (!norm)", "  var raw  = String(rawText || '').trim();\n  var norm = normalizeItemName_(raw);\n  if (!norm)")],
  ['no lock', one(P, "  if (!lock.tryLock(10000)) throw new Error('Purchase History is busy — try again.');\n", "")],
  ['the toggle route does not log', one(W, "    try { Object.assign(r, shopCheckLog_(r.storeName, r.text, r.done)); }", "    try { }")],
  ['a history failure breaks the tick', one(W, "    catch (err) { r.logError = err.message; }", "    catch (err) { throw err; }")],
  ['the store name is not passed back', one(SH, ", text: text, storeName: found.getTitle() };", ", text: text };")],
  ['the full dashboard hides a history failure', one(A, "if(r&&r.logError)setError('Checked off, but not saved to Purchase History: '+r.logError);", "")],
  ['the lite dashboard hides a history failure', one(L, "      if (r && r.logError) setError('Checked off, but not saved to Purchase History: ' + r.logError);\n", "")],
];

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[1](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });
  const r = cp.spawnSync('node', ['test_shopcheck.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
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
