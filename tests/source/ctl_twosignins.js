// Negative controls for two sign-ins on one phone (each dashboard its own saved code): break ONE
// rule at a time and confirm test_twosignins_ui.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_twosignins');
const FILES = ['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const css = (from, to) => b => ({ 'docs/index.html': swap(b['docs/index.html'], from, to) });
const T = 'test_twosignins_ui.js';
const lite = (from, to) => b => ({ 'docs/dashboard-lite.html': swap(b['docs/dashboard-lite.html'], from, to) });
const CONTROLS = [
  ['lite shares the full dashboard’s key again', lite("var VERA_TOKEN_KEY = 'vera_token_lite';", "var VERA_TOKEN_KEY = 'vera_token';")],
  ['lite forgets the old sign-in on upgrade', lite("    if (was) localStorage.setItem(VERA_TOKEN_KEY, was);\n    return was;", "    return '';")],
  ['lite keeps the old one but never saves it as its own', lite("    if (was) localStorage.setItem(VERA_TOKEN_KEY, was);\n", "")],
  ['lite’s Connect writes the full dashboard’s key', lite("    localStorage.setItem(VERA_TOKEN_KEY, t);", "    localStorage.setItem('vera_token', t);")],
  ['the full dashboard reads lite’s key', ui("var VERA_TOKEN_KEY='vera_token';", "var VERA_TOKEN_KEY='vera_token_lite';")],
  ['a shared block names a key of its own', b => { const from = "tok = tok || localStorage.getItem(VERA_TOKEN_KEY); } catch (e) {}", to = "tok = tok || localStorage.getItem('vera_token'); } catch (e) {}"; return { 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to), 'docs/dashboard-lite.html': swap(b['docs/dashboard-lite.html'], from, to) }; }],
  ['the full dashboard stops sending lite-only people to lite', ui("if(d.view==='lite'&&!d.owner){window.location.replace('dashboard-lite.html');return;}", "")],
];
let allBit = true;
const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();
CONTROLS.forEach(([name, mut]) => {
  if (!HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT, f)));
  const r = cp.spawnSync('node', [T], { cwd: __dirname, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_CTL_FAST: '1' }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name + '  (' + T + ')');
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
