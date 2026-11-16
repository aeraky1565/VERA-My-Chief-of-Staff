// Negative controls for test_chores.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_chores');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Chores.js'], FULL = ['docs/app.js', 'docs/index.html'], ALL = FULL.concat(['docs/dashboard-lite.html']);
const CONTROLS = [
  ['an unknown owner is kept as typed', swapIn(S, "  return 'Either';\n}", "  return String(v == null ? '' : v).trim();\n}")],
  ['a new column isn’t named', swapIn(S, "  sheet.getRange(1, at + 1).setValue(name);\n", "")],
  ['no name on the tick', swapIn(S, "? String(_veraWho_.name) : '';", "? '' : '';")],
  ['adding drops the owner', swapIn(['WebApp.js'], "  var owner = chOwner_(p.owner);   // Chores.js", "  var owner = 'Either';")],
  ['unticking keeps the name', swapIn(['WebApp.js'], "      var by = checked ? chWho_() : '';   // Chores.js: who ticked it", "      var by = chWho_();")],
  ['the owner can’t be changed', swapIn(['WebApp.js'], "      if (p.owner != null && p.owner !== '') sheet.getRange(i + 1, chCol_(sheet, 'Owner') + 1).setValue(chOwner_(p.owner));   // Chores.js\n", "")],
  ['the reset leaves Checked By', swapIn(['Code.js'], "      if (byIdx !== -1) sheet.getRange(i + 1, byIdx + 1).setValue('');\n", "")],
  ['a person’s filter hides Either', swapIn(FULL, ":o===who||o==='Either';});}", ":o===who;});}")],
  ['done chores aren’t last', swapIn(FULL, "return (chDone_(a)?1:0)-(chDone_(b)?1:0)||", "return ")],
  ['no who-ticked-it', swapIn(FULL, "d&&chTicked_(c)&&h('span',{className:'ch-by'},chTicked_(c))", "false")],
  ['adding drops the owner (screen)', swapIn(FULL, "setText('');onAdd(t,cad,owner);", "setText('');onAdd(t,cad,'Either');")],
  ['the owner buttons do nothing', swapIn(FULL, "onClick:function(){if(onUpdateOwner)onUpdateOwner(c.ID,x);}", "onClick:function(){}")],
];
const T = 'test_chores.js';
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
