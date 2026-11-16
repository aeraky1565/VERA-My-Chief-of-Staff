// Negative controls for test_accounts.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_accounts');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Accounts.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['refunds count as payments', swapIn(S, "return t.amount < 0; }).slice()", "return true; }).slice()")],
  ['all payments averaged', swapIn(S, "}).slice(0, AC_EST_PAYMENTS_);", "});")],
  ['oldest payments first', swapIn(S, "return String(b.month).localeCompare(String(a.month)); });", "return String(a.month).localeCompare(String(b.month)); });")],
  ['aliases ignored', swapIn(S, "|| aliases.some(function(a) { return d.indexOf(a) !== -1; }); }).slice(0, AC_EST_PAYMENTS_);", "; }).slice(0, AC_EST_PAYMENTS_);")],
  ['yearly bills counted in full', swapIn(FULL, "'annual':1/12,'yearly':1/12};", "'annual':1,'yearly':1};")],
  ['estimates ignored', swapIn(FULL, "if(e&&e.amount!=null){amt=Number(e.amount);est=true;}else{p.missing.push(b.bill);return;}", "p.missing.push(b.bill);return;")],
  ['one-time bills counted', swapIn(FULL, "return k==='one-time'||k==='once'?0:", "return ")],
  ['transfers ignore the split', swapIn(FULL, "ahmed:Math.round(total*ah/100),victoria:Math.round(total*vi/100)", "ahmed:Math.round(total*0.6),victoria:Math.round(total*0.4)")],
  ['no ~ on an estimate', swapIn(FULL, "h('b',null,(m.estimated?'~':'')+acMoney_(m.total))", "h('b',null,acMoney_(m.total))")],
  ['bills shown open', swapIn(FULL, "isOpen&&h('div',{className:'ac-bills'}", "h('div',{className:'ac-bills'}")],
  ['no estimates asked for', swapIn(FULL, "apiGet(apiUrl,apiToken,{action:'bill_estimates'})", "Promise.resolve({})")],
];
const T = 'test_accounts.js';
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
