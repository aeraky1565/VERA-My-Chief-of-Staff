// Negative controls for Travel › Gifts on the server (TripGifts.js, issue #227): revert ONE rule
// at a time and confirm test_tripgifts.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tripgifts_out');

const FILES = ['TripGifts.js', 'Code.js', 'WebApp.js', 'Chat.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
// A dashboard change: the full page is served from index.html, which carries app.js inside it.
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const full = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });
const UI = 'test_tripgifts.js';
const G = 'TripGifts.js';
const srv = (from, to) => b => ({ [G]: swap(b[G], from, to) });

const CONTROLS = [
  ['old rows read as not bought', srv("return String(purchasedCell).trim().toLowerCase() === 'yes' || purchasedCell === true ? 'Bought' : 'To buy';", "return 'To buy';")],
  ['Purchased isn’t kept in step', srv("if (status) { set(TG_COL_.status, status); set(TG_COL_.purchased, status === 'To buy' ? 'No' : 'Yes'); }", "if (status) { set(TG_COL_.status, status); }")],
  ['packed doesn’t count as spent', srv("if (g.status === 'To buy') planned += g.amount; else bought += g.amount;", "if (g.status === 'Bought') bought += g.amount; else planned += g.amount;")],
  ['names match case-sensitively', srv("function tgNameKey_(s) { return String(s || '').trim().toLowerCase().replace(/\\s+/g, ' '); }", "function tgNameKey_(s) { return String(s || '').trim(); }")],
  ['plurals don’t match', srv(".map(function(w) { return w.length > 4 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w; })", "")],
  ['filler words count as a match', srv("return w.length >= 3 && !TG_STOP_[w] && a.indexOf(w) === i;", "return w.length >= 3 && a.indexOf(w) === i;")],
  ['a trip warns against itself', srv("if (tripKey && g.tripKey === tripKey) return false;", "")],
  ['host gifts are brought back', srv("var back = (gifts || []).filter(function(g) { return g.kind !== 'host'; });", "var back = (gifts || []).slice();")],
  ['meat is allowed in', srv("    text: 'Meat products can’t come into the US, cured or tinned: leave them off.' });", "    text: '' }) && rules.pop();")],
  ['alcohol allowance is per trip, not per person', srv("free = n * TG_US_ALCOHOL_L_;", "free = TG_US_ALCOHOL_L_;")],
  ['US rules apply abroad', srv("var us = /^(united states|usa|us|united states of america)$/i.test(String(home || '').trim());", "var us = true;")],
  ['ideas keep meat', srv("if (!x.item || seen[k] || (us && TG_MEAT_RE_.test(x.item))) return false;", "if (!x.item || seen[k]) return false;")],
  ['ideas are asked every time', srv("if (at !== -1 && String(p.refresh) !== '1') {", "if (false) {")],
  ['the budget reads every category', srv("|| String(r[2]).trim().toLowerCase() !== 'gifts') return;", ") return;")],
  ['Chat adds a second copy instead of ticking', srv("var match = tgMatchToBuy_(have, item, recipient);", "var match = null;")],
  ['Chat files to a trip ended weeks ago', srv("return (t0 - new Date(end + 'T12:00:00Z').getTime()) / 86400000 <= 7;", "return true;")],
  ['Chat drops the action', b => ({ 'Chat.js': swap(b['Chat.js'], "try { executed.push(tgChatBought_(args[0], args[1], args[2])); }", "try { }") })],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
const ONLY = process.env.CTL_ONLY;
CONTROLS.forEach(function(c) {
  if (ONLY && c[0] !== ONLY) return;
  const name = c[0];
  // Server tests only: no browser needed.
  if (false && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const r = cp.spawnSync('node', [UI], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT, FIN_QUICK: '1' }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + UI + ')');
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
