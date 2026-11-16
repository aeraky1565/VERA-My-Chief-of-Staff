// Negative controls for test_takeouts.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_takeouts');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Takeouts.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['twice in a day counts twice', swapIn(S, "var times = (parseInt(rows[at][TO_R_TIMES_ - 1], 10) || 0) + (toYmd_(rows[at][TO_R_LAST_ - 1]) === today ? 0 : 1);", "var times = (parseInt(rows[at][TO_R_TIMES_ - 1], 10) || 0) + 1;")],
  ['the columns aren’t named', swapIn(S, "if (h.some(function(x) { return !String(x).trim(); })) sheet.getRange(1, from, 1, names.length).setValues([names]);", "")],
  ['a dish at another restaurant is marked too', swapIn(S, "if (String(r[0]).trim() !== name || dishes.indexOf", "if (dishes.indexOf")],
  ['an unknown restaurant is accepted', swapIn(S, "  if (at === -1) throw new Error('Restaurant not found: ' + name);\n", "  if (at === -1) return { ok: true };\n")],
  ['A and V aren’t read', swapIn(S, "  if (s === 'a') s = 'ahmed'; else if (s === 'v') s = 'victoria'; else if (s === 'b') s = 'both';\n", "")],
  ['a moved row is overwritten', swapIn(S, "if (body.item && String(sheet.getRange(row, 2).getValue()).trim() !== String(body.item).trim()) throw new Error('That dish moved. Refresh and try again.');", "")],
  ['adding drops who it’s for', swapIn(['WebApp.js'], "  var who = toFor_(body['for']);   // Takeouts.js", "  var who = '';")],
  ['the read drops last ordered', swapIn(['WebApp.js'], "        lastOrdered: toYmd_(row[TO_R_LAST_ - 1]),\n", "")],
  ['our usual ignores how often', swapIn(FULL, "var ordered=l.filter(function(i){return (i.timesOrdered||0)>=2;})", "var ordered=l.filter(function(i){return false;})")],
  ['not last ordered first', swapIn(FULL, ".sort(function(a,b){return String(b.lastOrdered||'').localeCompare(String(a.lastOrdered||''))||", ".sort(function(a,b){return ")],
  ['the cuisine chip does nothing', swapIn(FULL, "return !cuisine||cuisine==='all'||String(r.cuisine||'').trim().toLowerCase()===cuisine.toLowerCase();})", "return true;})")],
  ['no who on a dish', swapIn(FULL, "function toDish_(i){return i.item+(i['for']?' ('+TO_PILL_[i['for']]+')':'');}", "function toDish_(i){return i.item;}")],
  ['We ordered drops the dishes', swapIn(FULL, "onSave(rest.name,Object.keys(picked).filter(function(k){return picked[k];}));", "onSave(rest.name,[]);")],
  ['stars can’t be tapped', swapIn(FULL, "onClick:function(){onChange(n===value?0:n);}", "onClick:function(){}")],
  ['adding a dish drops who', swapIn(FULL, "notes:'','for':dish['for']});setDish(", "notes:'','for':''});setDish(")],
];
const T = 'test_takeouts.js';
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
