// Negative controls for test_coupons_used.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_coupons_used');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Coupons.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['a % coupon counts as dollars', swapIn(S, "  if (!s || /%|percent/i.test(s)) return null;\n", "  if (!s) return null;\n")],
  ['used still deletes the row', swapIn(['WebApp.js'], "  return webMarkCouponUsedKeep_(e);", "  return webDeleteCoupon_(e);")],
  ['the typed amount is ignored', swapIn(S, "var saved = given !== '' && !isNaN(Number(given)) && Number(given) >= 0 ? Math.round(Number(given) * 100) / 100 : cpnSaved_(rows[i][3]);", "var saved = cpnSaved_(rows[i][3]);")],
  ['the columns aren’t named', swapIn(S, ".setValues([['Used On', 'Saved']]);", ".setValues([['', '']]);")],
  ['lite sees used coupons', swapIn(['WebApp.js'], "    if (used && !withUsed) return;\n", "")],
  ['savedThisYear counts every year', swapIn(['WebApp.js'], "if (used && usedOn.slice(0, 4) === today.slice(0, 4) && saved) savedThisYear += saved;", "if (used && saved) savedThisYear += saved;")],
  ['a used coupon is purged at expiry', swapIn(['Code.js'], "if (used ? cpnUsedOld_(rows[i][CPN_USED_COL_ - 1], tz, today) : couponState_(", "if (couponState_(")],
  ['used coupons never purged', swapIn(S, "  return Number(iso.slice(0, 4)) < Number(String(todayIso).slice(0, 4)) - 1;", "  return false;")],
  ['the morning email lists used coupons', swapIn(['Code.js'], "          if (String(r[10]).trim() === 'Used') return;  // used coupons are kept for Saved this year (Coupons.js)\n", "")],
  ['used coupons listed as live', swapIn(FULL, "if(cpUsed_(c)||cpExpired_(c))return false;if(!filter||filter==='all')return true;", "if(cpExpired_(c))return false;if(!filter||filter==='all')return true;")],
  ['saved this year counts last year', swapIn(FULL, "return cpUsed_(c)&&String(c.usedOn||'').slice(0,4)===y;", "return cpUsed_(c);")],
  ['a % coupon doesn’t ask', swapIn(FULL, "var used=function(c){if(cpPercent_(c)){setAsk(c.ID);setAskVal('');return;}onMarkUsed(c.ID);};", "var used=function(c){onMarkUsed(c.ID);};")],
  ['Skip sends a number', swapIn(FULL, "onClick:function(){setAsk(null);onMarkUsed(c.ID,'');}},'Skip')", "onClick:function(){setAsk(null);onMarkUsed(c.ID,'0');}},'Skip')")],
  ['the store chip does nothing', swapIn(FULL, "return String(c.Store||'').trim().toLowerCase()===String(filter).slice(2).toLowerCase();})", "return true;})")],
  ['the shopping chip counts other stores', swapIn(FULL, "return t&&(t===s||t.indexOf(s)!==-1||s.indexOf(t)!==-1);}).length;}", "return true;}).length;}")],
  ['the full screen doesn’t ask for used ones', swapIn(FULL, "{action:'get_coupons',withUsed:'1'}", "{action:'get_coupons'}")],
];
const T = 'test_coupons_used.js';
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
