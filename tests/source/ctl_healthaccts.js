// Negative controls for FSA & HSA (HealthAccounts.js and the shared HealthAcct block): revert
// ONE rule at a time and confirm a test catches it. Server rules run test_healthaccounts.js; the
// screen rules run test_healthacct_ui.js quickly (HA_QUICK) and are skipped with no browser.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_ha');

const FILES = ['HealthAccounts.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const S = 'HealthAccounts.js', A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const T = 'test_healthaccounts.js', UI = 'test_healthacct_ui.js';

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

const CONTROLS = [
  ['a denied claim is counted', one(S, "var counted = !HA_EXCLUDED_RE_.test(status);", "var counted = true;")],
  ['last year\'s claims count this year', one(S, "    if (year && col.acct !== -1) { var a = String(row[col.acct] || ''); if (/\\b(19|20)\\d{2}\\b/.test(a) && a.indexOf(String(year)) === -1) return; }\n", "")],
  ['a typed balance always wins over the sheet', one(S, "!(typed && a.balanceAsOf > newest)", "!typed")],
  ['the carryover is ignored in what would be lost', one(S, "var carry = rule === 'carry' ? (a.carryover || lim.carry) : 0;", "var carry = 0;")],
  ['the lose-it warning ignores the deadline', one(S, "warn: daysLeft >= 0 && daysLeft <= HA_WARN_DAYS_ && atRisk > 0,", "warn: atRisk > 0,")],
  ['each HSA gets its own limit', one(S, "var limit = family ? lim.hsaFamily : lim.hsaSelf;", "var limit = (family ? lim.hsaFamily : lim.hsaSelf) * rows.length;")],
  ['a typed balance isn\'t dated', one(S, "balChanged ? hfToday_() :", "balChanged ? (prev.balanceAsOf || '') :")],
  ['the FSA sheet\'s id is ignored', one(S, "var sheetId = String((cfg || {})['fsa_sheet_id'] || '').trim();", "var sheetId = '';")],
  ['2027 ignores its own limits', one(S, "  2027: { hsaFamily: 9000 },\n", "")],
  // the screen
  ['a balance with cents can\'t be saved', both("type: 'number', step: 'any', inputMode", "type: 'number', inputMode"), UI],
  ['Update balance forgets which account', both("var p = { id: props.id, balance: v };", "var p = { balance: v };"), UI],
  ['the employer\'s money isn\'t shown', both("(v.employerName || 'Employer') + ' ' + haUsd_(v.employer)", "(v.employerName || 'Employer')"), UI],
];

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0], test = c[2] || T, ui = test === UI;
  if (ui && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const env = Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }, ui ? { HA_QUICK: '1' } : {});
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
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
