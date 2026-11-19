// Negative controls for test_rx.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_rx');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Rx.js'], FULL = ['docs/app.js', 'docs/index.html'], ALL = FULL.concat(['docs/dashboard-lite.html']);
const CONTROLS = [
  ['Days Supply ignored', swapIn(S, "  if (n > 0 && n <= 400) return rxAdd_(todayIso, n);\n", "")],
  ['no gap fallback', swapIn(S, "  if (lastFilledIso && refillIso) { var gap", "  if (false) { var gap")],
  ['Last Filled not written', swapIn(S, "setValues([[today, next]]);", "setValues([[rows[i][8], next]]);")],
  ['paused ones flagged', swapIn(S, "return String(r.active || 'Yes') === 'Yes'; }).map(", "return true; }).map(")],
  ['flag 14 days ahead', swapIn(S, "var RX_AHEAD_DAYS_ = 7;", "var RX_AHEAD_DAYS_ = 14;")],
  ['overdue is Medium', swapIn(S, "urgency: r.days < 0 ? 'High' : 'Medium' };", "urgency: 'Medium' };")],
  ['no nightly step', swapIn(['NightlyRunner.js'], "    S('checkRefills_', 1, function() { checkRefills_(); }),\n", "")],
  ['dates sent raw', swapIn(['WebApp.js'], "      refillDate: rxYmd_(r[9], tzRx) || (r[9] || ''),", "      refillDate: r[9] || '',")],
  ['Ahmed’s on her Today', swapIn(ALL, "|| String(x.person || '') !== String(d.who || 'Victoria')) return;", ") return;")],
  ['lite doesn’t pass rx', swapIn(['docs/dashboard-lite.html'], "chores: data.chores, rx: data.rx, trip:", "chores: data.chores, trip:")],
  ['the switch does nothing', swapIn(FULL, "return who==='Both'||String(r.person||'Ahmed')===who;})", "return true;})")],
  ['not soonest first', swapIn(FULL, "return (x==null?9999:x)-(y==null?9999:y);}),paused", "return 0;}),paused")],
  ['Refilled does nothing', swapIn(FULL, "onClick:function(){refilled(r);}},'✓ Refilled today')", "onClick:function(){}},'✓ Refilled today')")],
  ['paused shown open', swapIn(FULL, "showPaused&&h('div',{className:'rx-grid'},paused.map(card))", "h('div',{className:'rx-grid'},paused.map(card))")],
];
const T = 'test_rx.js';
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
