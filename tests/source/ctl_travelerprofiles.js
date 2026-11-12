// Negative controls for the Traveller profiles (TravelerProfiles.js and TravelerProfilesPanel, issue #227):
// revert ONE rule at a time and confirm test_travelerprofiles.js (server) or test_travelerprofiles_ui.js (screen) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_travelerprofiles_out');

const FILES = ['TravelerProfiles.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const UI = 'test_travelerprofiles_ui.js', SRV = 'test_travelerprofiles.js', S = 'TravelerProfiles.js';
const srv = (from, to) => b => ({ [S]: swap(b[S], from, to) });

const W = 'WebApp.js';
const CONTROLS = [
  ['a full number is kept', srv("function tpLast4_(v) { return String(v == null ? '' : v).replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase(); }", "function tpLast4_(v) { return String(v == null ? '' : v).replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }"), SRV],
  ['long numbers in notes are kept', srv("return d.length >= 5 ? '••••' + d.slice(-4) : run;", 'return run;'), SRV],
  ['the save doesn’t say it trimmed', srv("var trimmed = raw.replace(/[^A-Za-z0-9]/g, '').length > 4;", 'var trimmed = false;'), SRV],
  ['the old tab is copied every time', srv("if (veraOnceGet_(TP_MIGRATED_PROP_)) return 0;", ""), SRV],
  ['a passport is copied twice', srv('    if (haveIds[id]) return;\n', ''), SRV],
  ['the visa checks lose the passports', srv("return (items || []).filter(function(i) { return i.section === 'document' && i.kind === 'passport'; })", "return (items || []).filter(function(i) { return false; })"), SRV],
  ['a visa that runs out mid-trip still covers it', srv("(!d.expiry || !endDate || d.expiry >= endDate)", 'true'), SRV],
  ['one person’s visa covers everyone', srv("var doc = (held[t.name] || [])", "var doc = [].concat.apply([], Object.keys(held).map(function(k) { return held[k]; }))"), SRV],
  ['no admission turns green', srv("      if (/no admission/i.test(p.label || '')) return;\n", ''), SRV],
  ['the trip documents check ignores what’s held', b => ({ [W]: swap(b[W], '    if (held) tpApplyHeld_(travelers, held, c.country, endDate);\n', '') }), SRV],
  ['no passport-short-for-a-trip reminder', srv('if (tpAddMonths_(end, 6) <= i.expiry) return;', 'return;'), SRV],
  ['the Global Entry reminder forgets the card', srv("var payLine = pay ?", "var payLine = false ?"), SRV],
  ['a reminder already sent goes out again', srv("if (wasRecentlySent_(x.key, 60 * 24 * 365)) return;", ''), SRV],
  ['Children shows before a birth', srv("if (fp.phase === 'leave' || fp.phase === 'back') return true;", 'return true;'), SRV],
  ['the screen shows Children before a birth', both("return s.id!=='child'||d.hasChild;", 'return true;')],
  ['the number hint is gone', both("'Only the last 4 are kept. Keep the full number in your wallet or password manager.'", "''")],
  ['the person switch shows everyone’s items', both("var mine=(d.items||[]).filter(function(i){return i.person===person;});", 'var mine=(d.items||[]);')],
  ['a medication shows no prescription', both("bits.push(rx?'Rx: '+rx.medication", "bits.push(false?'Rx: '+rx.medication")],
  ['× doesn’t remove', both("{action:'tp_delete',id:i.id}", "{action:'tp_nothing',id:i.id}")],
  ['a passport months from expiry looks fine', both("if(d<180)return ['bad','Expires '+ymd];", '')],
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
  if (!HAS_BROWSER && (c[2] || UI) === UI) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const r = cp.spawnSync('node', [c[2] || UI], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + (c[2] || UI) + ')');
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
