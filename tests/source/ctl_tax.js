// Negative controls for test_tax.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tax');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Tax.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['every step restamps', swapIn(S, "if ((oldStatus || 'not_received') === 'not_received' && !txYmd_(cell.getValue(), Session.getScriptTimeZone())) { cell.setValue(today); return today; }", "cell.setValue(today); return today;")],
  ['going back keeps the date', swapIn(S, "  if (newStatus === 'not_received') { cell.setValue(''); return ''; }\n", "")],
  ['the column isn’t named', swapIn(S, ".setValue('Received On');", ".setValue('');")],
  ['the owner is ignored', swapIn(S, "return [formType, issuer, owner || 'Ahmed'].map(", "return [formType, issuer].map(")],
  ['late after receiving', swapIn(S, "daysLate: (d.status || 'not_received') === 'not_received' && late > 0 ? late : null", "daysLate: late > 0 ? late : null")],
  ['flag at 7 days', swapIn(S, "var TX_LATE_DAYS_ = 14;", "var TX_LATE_DAYS_ = 7;")],
  ['send before all are verified', swapIn(S, "var all = docs.every(function(d) { return TX_DONE_[d.status]; })", "var all = true")],
  ['send after filing', swapIn(S, "  if (prep && /^(filed|complete)$/i.test(String(prep.filingStatus || ''))) return null;\n", "")],
  ['no nightly step', swapIn(['Code.js'], "    nightlyStep_(ctx, 'checkTaxLate_', checkTaxLate_);   // Tax.js: two weeks later than last year\n", "")],
  ['the update never stamps', swapIn(['WebApp.js'], "txStampReceived_(sh, row, String(sh.getRange(row, 7).getValue() || 'not_received'), p.status); ", "")],
  ['the deadline in the tax year', swapIn(FULL, "var d=new Date(Number(year)+1,3,15)", "var d=new Date(Number(year),3,15)")],
  ['late not first', swapIn(FULL, "return lb-la||st(a)-st(b)||", "return st(a)-st(b)||")],
  ['a step tap does nothing', swapIn(FULL, "onClick:function(){setStatus(d,s[0]);}},s[1]);", "onClick:function(){}},s[1]);")],
  ['no Needs you row', swapIn(FULL, "['cfo','get_chores_for_others'],['tax','tax_needs']]", "['cfo','get_chores_for_others']]")],
];
const T = 'test_tax.js';
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
