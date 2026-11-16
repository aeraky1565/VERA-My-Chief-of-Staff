// Negative controls for test_recipes.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_recipes');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Recipes.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['only og:image in one attribute order', swapIn(S, "  for (var i = 0; i < pats.length && !m; i++) m = pats[i].exec(s);", "  m = pats[0].exec(s);")],
  ['relative images kept relative', swapIn(S, "else if (/^\\//.test(u)) {", "else if (false) {")],
  ['a bad image URL is kept', swapIn(S, "return /^https:\\/\\/[^\\s\"'<>]+$/i.test(u) && u.length <= 1000 ? u : '';", "return u;")],
  ['a link with no image is fetched again', swapIn(S, "setValue(photo || 'none');", "setValue(photo);")],
  ['no batch limit', swapIn(S, "todo.slice(0, RC_PHOTO_BATCH_)", "todo")],
  ['the Photo column isn’t named', swapIn(S, ".setValue('Photo');", ".setValue('');")],
  ['a skipped dinner counts as made', swapIn(S, " || /skip/i.test(String(r.status || ''))) return;", ") return;")],
  ['a planned dinner counts as made', swapIn(S, "    if (d <= today) { if (d > o.lastMade) o.lastMade = d; }", "    if (true) { if (d > o.lastMade) o.lastMade = d; }")],
  ['the read sends "none" as a photo', swapIn(['WebApp.js'], "photo:       /^https:\\/\\//.test(String(row[8] || '')) ? String(row[8]).trim() : '',", "photo:       String(row[8] || '').trim(),")],
  ['hours aren’t read', swapIn(FULL, "return Math.round((h?Number(h[1])*60:0)+(m?Number(m[1]):0));}", "return Math.round(m?Number(m[1]):0);}")],
  ['the search ignores ingredients', swapIn(FULL, "(String(r.name)+' '+String(r.ingredients||'')+' '", "(String(r.name)+' '")],
  ['quick is ≤ 60', swapIn(FULL, "var RC_QUICK_MIN_=30,", "var RC_QUICK_MIN_=60,")],
  ['not made lately includes planned ones', swapIn(FULL, "function rcLately_(r,now){if(r.nextPlanned)return false;", "function rcLately_(r,now){")],
  ['the picker shows past days', swapIn(FULL, "if(date<t)return;", "")],
  ['replacing a dinner doesn’t ask', swapIn(FULL, "if(!d.free&&!window.confirm('Replace '+d.meal+' on '+d.day+'?'))return;", "")],
  ['Plan it plans nothing', swapIn(FULL, "onPlan(recipe,d.weekStart,d.day,d.date);onClose();", "onClose();")],
  ['photos never asked for', swapIn(FULL, "asked.current=true;onFetchPhotos();", "asked.current=true;")],
];
const T = 'test_recipes.js';
let allBit = true;
const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
CONTROLS.forEach(([name, mut]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const ui = Object.keys(patch).some(f => f.startsWith('docs/'));
  if (ui && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  fs.readdirSync(path.join(SRC_DIR, 'docs')).forEach(f => { const s = path.join(SRC_DIR, 'docs', f), d = path.join(OUT, 'docs', f); if (!fs.existsSync(d) && fs.statSync(s).isFile()) fs.copyFileSync(s, d); });
  const r = cp.spawnSync('node', [T], { cwd: __dirname, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_CTL_FAST: '1' }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name);
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
