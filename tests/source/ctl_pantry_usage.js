// Negative controls for ✓ Used it / Still have some and the smarter pantry guesses (Pantry.js +
// PantryView): revert one rule at a time and confirm test_pantry_usage.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const SRC = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'ctl_pu');
const FILES = ['Pantry.js', 'WebApp.js', 'Settings.js', 'docs/app.js', 'docs/index.html'];
const BASE = {}; FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const pa = (from, to) => b => ({ 'Pantry.js': swap(b['Pantry.js'], from, to) });
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const T = 'test_pantry_usage.js', UI = true;
const CONTROLS = [
  ['buys a day apart count as restocks', pa("if (!prev || pantryDays_(prev, d) > PANTRY_MERGE_DAYS_) out.push(d);", "out.push(d);")],
  ['Used it isn’t learned from', pa("    if (span >= 1) intervals.push(span);\n", "")],
  ['used never means out', pa("var out = !!(u.used && u.used >= lastD);", "var out = false;")],
  ['an old used date still means out', pa("var out = !!(u.used && u.used >= lastD);", "var out = !!u.used;")],
  ['Still have some changes nothing', pa("    if (pushed > next) next = pushed;\n", "")],
  ['the hide window has no floor', pa("return Math.max(2, Math.round((avgDays || 0) / 3));", "return Math.round((avgDays || 0) / 3);")],
  ['stale never happens', pa("stale: daysUntil < -Math.max(7, rate.avgDays) };", "stale: false };")],
  ['stale items stay due', pa("if (!pr.estimatedNext || pr.stale || pr.daysUntil > horizon) return;", "if (!pr.estimatedNext || pr.daysUntil > horizon) return;")],
  ['a flat 30-day first guess', pa("return PANTRY_DEFAULTS[norm] || PANTRY_AISLE_DAYS_[pantryAisle_(norm)] || 30;", "return PANTRY_DEFAULTS[norm] || 30;")],
  ['used keeps the old Still have some', pa("if (kind === 'used') { u.used = today; delete u.have; }", "if (kind === 'used') { u.used = today; }")],
  ['a staple that ran out waits for tonight', pa("if (kind === 'used' && pantryStaples_(getConfigValues()).indexOf(name) !== -1) {", "if (false) {")],
  ['any kind accepted', pa("  if (kind !== 'used' && kind !== 'have') throw new Error('kind must be used or have');\n", "")],
  ['not routed', b => ({ 'WebApp.js': swap(b['WebApp.js'], "      case 'pantry_used':              return jsonOut_(webPantryUsed_(e));\n", "") })],
  ['not a VERA State key', b => ({ 'Settings.js': swap(b['Settings.js'], ", 'PANTRY_USAGE']", "]") })],
  ['stale items stay in Running out soon', pa("var d = it.estimatedNext && !it.stale ?", "var d = it.estimatedNext ?")],
  ['Used it sends have', ui("onClick:function(){usedUp(i,'used');}", "onClick:function(){usedUp(i,'have');}"), UI],
  ['Still have some keeps it on Running out soon', ui("patch(i.normalized,{daysUntil:r.daysUntil!=null?r.daysUntil:days+1,", "patch(i.normalized,{daysUntil:i.daysUntil,"), UI],
  ['no not-bought-lately tag', ui("i.stale?h('span',{className:'pa-stale'},'not bought lately'):null", "null"), UI],
];
const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
let allBit = true;
CONTROLS.forEach(c => {
  const name = c[0];
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch), changed = [];
  Object.keys(files).forEach(f => { if (files[f] !== BASE[f]) changed.push(f); const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => { try { fs.copyFileSync(path.join(SRC, f), path.join(OUT, f)); } catch (e) {} });
  const r = cp.spawnSync('node', [T], { cwd: __dirname, encoding: 'utf8', timeout: 240000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || ''), fails = (out.match(/^  FAIL .*$/gm) || []);
  console.log('\n=== CONTROL: ' + name);
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY'); allBit = false; return; }
  if (r.status !== 0 && !fails.length) { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-5).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
