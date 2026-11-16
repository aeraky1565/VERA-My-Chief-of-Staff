// Negative controls for test_contracts.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_contracts');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Contracts.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['blank reads as 30', swapIn(S, "var CT_WARN_DEFAULT_ = 60;", "var CT_WARN_DEFAULT_ = 30;")],
  ['due on the end date', swapIn(S, "+p[2] - 7));", "+p[2]));")],
  ['due in the past', swapIn(S, "  return iso < todayIso ? todayIso : iso;", "  return iso;")],
  ['a second Task each time', swapIn(S, "&& String(rows[i][4]).trim() === 'Open') return { ok: true, made: false,", "&& false) return { ok: true, made: false,")],
  ['the nightly check keeps 30', swapIn(['Code.js'], "    var noticeDays    = ctWarnDays_(row[7]);", "    var noticeDays    = parseInt(row[7], 10) || 30;")],
  ['the outcome isn’t read', swapIn(['WebApp.js'], "var action = String(p.outcome || (p.action !== 'log_contract_action' ? p.action : '') || '').trim();", "var action = (p.action || '').trim();")],
  ['soon ignores its own window', swapIn(FULL, "return ctActive_(c)&&c.daysUntil!=null&&c.daysUntil<=ctWarn_(c);}", "return ctActive_(c)&&c.daysUntil!=null&&c.daysUntil<=60;}")],
  ['ended contracts counted per month', swapIn(FULL, "perMonth:act.reduce(", "perMonth:(cs||[]).reduce(")],
  ['Shop around does nothing', swapIn(FULL, "onClick:function(){shop(c);}},'Shop around → Task')", "onClick:function(){}},'Shop around → Task')")],
  ['Cancel sends the old double action', swapIn(FULL, "{action:'log_contract_action',id:c.id,outcome:'Terminated'}", "{action:'log_contract_action',id:c.id}")],
  ['the window can’t be changed', swapIn(FULL, "if(n>=1&&n<=365)run({action:'update_contract',id:c.id,noticeDays:String(n)});", "")],
  ['a new contract defaults to 30', swapIn(FULL, "autoRenews:'Unknown',noticeDays:'60',monthlyCost:''", "autoRenews:'Unknown',noticeDays:'30',monthlyCost:''")],
  ['ended shown open', swapIn(FULL, "showEnded&&h('div',{className:'ct-grid'},L.ended.map(card))", "h('div',{className:'ct-grid'},L.ended.map(card))")],
];
const T = 'test_contracts.js';
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
