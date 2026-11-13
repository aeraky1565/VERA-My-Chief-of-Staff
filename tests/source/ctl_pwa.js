// Negative controls for #243: revert ONE rule at a time and confirm test_pwa.js (or the
// browser test, test_pwa_ui.js) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_pwa');
const TEXT = ['docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/sw.js', 'docs/offline.html', 'docs/manifest-full.webmanifest', 'docs/manifest-lite.webmanifest', '.claspignore'];
const BASE = {};
TEXT.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const APP = 'docs/app.js', LITE = 'docs/dashboard-lite.html', IDX = 'docs/index.html', SW = 'docs/sw.js';
// A change to the shared block goes into app.js, the built index.html and lite alike.
const shared = (from, to) => b => ({ [APP]: swap(b[APP], from, to), [IDX]: swap(b[IDX], from, to), [LITE]: swap(b[LITE], from, to) });
const NODE = 'test_pwa.js', UI = 'test_pwa_ui.js';
const CONTROLS = [
  ['the lite manifest starts on the full dashboard', b => ({ 'docs/manifest-lite.webmanifest': swap(b['docs/manifest-lite.webmanifest'], '"start_url": "./dashboard-lite.html"', '"start_url": "./index.html"') }), NODE],
  ['no maskable icon', b => ({ 'docs/manifest-full.webmanifest': swap(b['docs/manifest-full.webmanifest'], '"purpose": "maskable"', '"purpose": "any"') }), NODE],
  ['an icon listed at the wrong size', b => ({ 'docs/manifest-full.webmanifest': swap(b['docs/manifest-full.webmanifest'], '"src": "icons/vera-full-192.png", "sizes": "192x192"', '"src": "icons/vera-full-512.png", "sizes": "192x192"') }), NODE],
  ['the page in a browser tab, not full screen', b => ({ 'docs/manifest-lite.webmanifest': swap(b['docs/manifest-lite.webmanifest'], '"display": "standalone"', '"display": "browser"') }), NODE],
  ['the full page without its manifest', b => ({ [IDX]: swap(b[IDX], '  <link rel="manifest" href="manifest-full.webmanifest" />\n', '') }), NODE],
  ['lite without the iPhone icon', b => ({ [LITE]: swap(b[LITE], '  <link rel="apple-touch-icon" href="icons/vera-lite-180.png" />\n', '') }), NODE],
  ['the status bar covers the page', b => ({ [IDX]: swap(b[IDX], 'status-bar-style" content="black"', 'status-bar-style" content="black-translucent"') }), NODE],
  ['pages cached (stale updates)', b => ({ [SW]: swap(b[SW], "    event.respondWith(fetch(req).catch(function () { return caches.match('offline.html'); }));", "    event.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }).catch(function () { return caches.match('offline.html'); }));") }), NODE],
  ['offline: the browser’s error', b => ({ [SW]: swap(b[SW], ".catch(function () { return caches.match('offline.html'); })", "") }), NODE],
  ['the backend intercepted', b => ({ [SW]: swap(b[SW], "  if (url.origin !== self.location.origin) return;", "") }), NODE],
  ['every file cached', b => ({ [SW]: swap(b[SW], "  if (VERA_SW_SHELL.some(function (p) { return url.pathname.slice(-p.length) === p; })) {", "  if (true) {") }), NODE],
  ['an update deletes other caches', b => ({ [SW]: swap(b[SW], "return k.indexOf('vera-shell-') === 0 && k !== VERA_SW_CACHE;", "return k !== VERA_SW_CACHE;") }), NODE],
  ['the worker registered on plain http too', shared("if('serviceWorker' in navigator&&location.protocol==='https:')", "if('serviceWorker' in navigator)"), NODE],
  ['iPads treated as computers', shared("||(platform==='MacIntel'&&touch>1)", ""), NODE],
  ['the tip shown on computers', shared("if(!phone||done||veraInstalled_())return null;", "if(done||veraInstalled_())return null;"), UI],
  ['the tip shown after installing', shared("if(!phone||done||veraInstalled_())return null;", "if(!phone||done)return null;"), UI],
  ['Got it forgotten', shared("function close(){try{localStorage.setItem('vera_install_tip_done','1');}catch(e){}setDone(true);}", "function close(){setDone(true);}"), UI],
  ['Android’s Install never offered', shared("phone==='android'&&VERA_INSTALL_EVT&&h('button'", "false&&h('button'"), UI],
  ['the offline page never reloads', b => ({ 'docs/offline.html': swap(b['docs/offline.html'], "window.addEventListener('online', function () { location.reload(); });", "") }), NODE],
];
let allBit = true;
CONTROLS.forEach(([name, mut, test]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  fs.cpSync(path.join(SRC_DIR, 'docs', 'icons'), path.join(OUT, 'docs', 'icons'), { recursive: true });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', timeout: 280000, env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
