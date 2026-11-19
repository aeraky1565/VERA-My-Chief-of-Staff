// Negative controls for test_coupons.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_coupons');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
// Swap in every listed file that has the anchor; at least one must.
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const FULL = ['docs/app.js', 'docs/index.html'], ALL = FULL.concat(['docs/dashboard-lite.html']), LITE = ['docs/dashboard-lite.html'];
const EARLY = "    // Coupon expiry flags, then remove coupons past their grace week (Issue #173). Early, and\n    // cheap: as the night's last step it was the first one the time budget dropped.\n    nightlyStep_(ctx, 'checkExpiringCoupons_', checkExpiringCoupons_);\n    nightlyStep_(ctx, 'purgeExpiredCoupons_', purgeExpiredCoupons_);\n";
const CONTROLS = [
  ['the grace week ignored: gone the day after', swapIn(['Code.js'], 'gone: left < 0 && left <= -keep };', 'gone: left < 0 };')],
  ['expiring today counts as gone with a grace of 0', swapIn(['Code.js'], 'gone: left < 0 && left <= -keep };', 'gone: left <= -keep };')],
  ['a US date can’t be read', swapIn(['Code.js'], "  if ((m = /^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4}|\\d{2})$/.exec(s))) return ymd(m[3].length === 2 ? '20' + m[3] : m[3], m[1], m[2]);\n", '')],
  ['Feb 30 accepted', swapIn(['Code.js'], "    if (t.getUTCMonth() !== m - 1) return '';                      // e.g. Feb 30\n", '')],
  ['the purge deletes every expired one', swapIn(['Code.js'], ': couponState_(couponIso_(rows[i][7], tz), today, keep).gone)', ': couponState_(couponIso_(rows[i][7], tz), today, keep).expired)')],
  ['the grace week setting not kept within 0–60', swapIn(['Code.js'], 'return isNaN(v) ? 7 : Math.max(0, Math.min(60, v));', 'return isNaN(v) ? 7 : v;')],
  ['the route sends coupons past their grace week', swapIn(['WebApp.js'], '    if (st.gone && !used) return;\n', '')],
  ['the route leaves a US date as it is', swapIn(['WebApp.js'], '    if (st.iso) obj.Expires = st.iso;\n', '')],
  ['the purge back as the night’s last step', b => { if (b['Code.js'].indexOf(EARLY) === -1) throw new Error('anchor moved: early coupon steps');
    const s = b['NightlyRunner.js'].replace(EARLY, ''); const t = "    S('checkTaxDocuments_', 3, function() { checkTaxDocuments_(); }),\n"; if (s.indexOf(t) === -1) throw new Error('anchor moved: tax step');
    return { 'NightlyRunner.js': s.replace(t, t + "    S('checkExpiringCoupons_', 1, function() { checkExpiringCoupons_(); }),\n") }; }],
  ['expired coupons stay in the live list (full)', swapIn(FULL, 'if(cpUsed_(c)||cpExpired_(c))return false;', 'if(cpUsed_(c))return false;')],
  ['expired coupons stay in the live list (lite)', swapIn(LITE, 'live = sorted.filter(c => !cpExpired_(c))', 'live = sorted')],
  ['not scratched off', swapIn(ALL, "strike={textDecoration:'line-through',textDecorationColor:'#9aa6c4aa',color:'#6b7590'}", "strike={color:'#6b7590'}")],
  ['copy still on for an expired code', swapIn(ALL, "disabled:true,title:'Expired'", "disabled:false,title:'Expired'")],
  ['no “Goes on” date', swapIn(ALL, "cpRemoveOn_(c)&&h('span',{className:'cp-gone-when'", "false&&h('span',{className:'cp-gone-when'")],
  ['lite opens the Expired group', swapIn(LITE, 'React.useState(false);   // lite keeps Expired closed', 'React.useState(true);   // lite keeps Expired closed')],
  ['the server’s expired flag ignored', swapIn(ALL, 'function cpExpired_(c){if(c.expired===true)return true;if(c.expired===false)return false;', 'function cpExpired_(c){')],
  ['the two copies drift', swapIn(LITE, "' · removed 7 days after they expire'", "' · removed a week after they expire'")],
];
const T = 'test_coupons.js';
let allBit = true;
const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();
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
