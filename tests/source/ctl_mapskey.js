// Negative controls for the shared trip map key (maps_browser_key, TripMapView): revert ONE rule at a
// time and confirm test_mapskey.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_mapskey_out');
const FILES = ['WebApp.js', 'docs/app.js', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const W = (from, to) => b => ({ 'WebApp.js': swap(b['WebApp.js'], from, to) });
const A = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to) });

const CONTROLS = [
  ['anyone signed in gets the key', W("  var refused = peopleOwnerOnly_();\n  if (refused) return refused;\n  var key = String(PropertiesService.getScriptProperties().getProperty('GOOGLE_MAPS_BROWSER_KEY')", "  var key = String(PropertiesService.getScriptProperties().getProperty('GOOGLE_MAPS_BROWSER_KEY')")],
  ['the server key is handed out', W("getProperty('GOOGLE_MAPS_BROWSER_KEY') || '').trim();\n  return { ok: true, key: key };", "getProperty('GOOGLE_STATIC_MAPS_API_KEY') || '').trim();\n  return { ok: true, key: key };")],
  ['the route is missing', W("      case 'maps_browser_key':      return jsonOut_(webMapsBrowserKey_());\n", "")],
  ['a key typed on this device is ignored', A("React.useState(stored('vera_maps_key')||_mapsBrowserKey);", "React.useState(_mapsBrowserKey);")],
  ['VERA is never asked', A("    if(keyChecked)return;\n    let off=false;", "    return;\n    let off=false;")],
  ['a refusal leaves the map loading', A(".catch(function(){if(!off)setKeyChecked(true);});", ".catch(function(){});")],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
  if (!HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const r = cp.spawnSync('node', ['test_mapskey.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  console.log('\n=== CONTROL: ' + name);
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:'); fails.slice(0, 3).forEach(f => console.log('    - ' + f));
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log(allBit ? '\nALL CONTROLS BIT' : '\nSOME CONTROLS DID NOT BITE');
process.exit(allBit ? 0 : 1);
