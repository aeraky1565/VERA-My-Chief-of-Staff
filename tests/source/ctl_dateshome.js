// Negative controls for test_dateshome.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_dateshome');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['GiftNudge.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['given ideas count', swapIn(S, "if (String(i['Given On'] || '').trim()) return; var p", "var p")],
  ['every date, not just occasions', swapIn(S, "return d.ID && p && gnIsOccasion_(d.Label) && d.daysUntil", "return d.ID && p && d.daysUntil")],
  ['30 days ahead', swapIn(S, "var GN_DAYS_ = 14;", "var GN_DAYS_ = 30;")],
  ['no nightly step', swapIn(['Code.js'], "    nightlyStep_(ctx, 'checkNoGiftIdea_', checkNoGiftIdea_);   // GiftNudge.js: an occasion in 14 days, no gift idea\n", "")],
  ['no age', swapIn(FULL, "/birthday|b-?day/i.test(String(d.Label||''))?{n:n,word:'turns '+n}:null;}", "null;}")],
  ['not soonest first', swapIn(FULL, "return d.daysUntil!=null&&d.daysUntil>=0&&d.daysUntil<=days;}).sort(function(a,b){return a.daysUntil-b.daysUntil;})", "return d.daysUntil!=null&&d.daysUntil>=0&&d.daysUntil<=days;})")],
  ['the note shows with an idea', swapIn(FULL, "&&d.daysUntil<=14&&!dhHasIdea_(ideas,d.Person);", "&&d.daysUntil<=14;")],
  ['By person isn’t the editor', swapIn(FULL, "view==='person'&&h(ImportantDatesView,{", "view==='nobody'&&h(ImportantDatesView,{")],
];
const T = 'test_dateshome.js';
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
