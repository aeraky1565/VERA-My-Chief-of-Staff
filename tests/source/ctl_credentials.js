// Negative controls for Career › Credentials (CareerCredentials.js and CarCredentials, issue #223):
// break ONE rule at a time and confirm a test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_credentials_out');
const FILES = ['CareerCredentials.js', 'Career.js', 'WebApp.js', 'Code.js', 'Chat.js', 'docs/app.js', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const F = 'CareerCredentials.js', A = 'docs/app.js', I = 'docs/index.html';
const srv = (from, to) => b => ({ [F]: swap(b[F], from, to) });
const ui = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });
const TEST = 'test_credentials.js', UI = 'test_credentials_ui.js';
const CONTROLS = [
  ['an expired year reads as earned', srv("var exp = s.match(/\\(\\s*expired\\s+(\\d{4})\\s*\\)\\s*$/i), yr = s.match(/\\(\\s*(\\d{4})\\s*\\)\\s*$/);", "var exp = null, yr = s.match(/(\\d{4})\\s*\\)\\s*$/);")],
  ['an MBA reads as a certification', srv("var degree = CAR_CRED_DEGREE_RE_.test(name);", "var degree = false;")],
  ['expired certifications go first', srv("return degrees.concat(active, expired).join('; ');", "return expired.concat(degrees, active).join('; ');")],
  ['an expired certification is sent as held', srv("return c.name + ' (expired ' + carCredYear_(c.expires) + ')'; });", "return item(c); });")],
  ['a cert set not to go to the agent is sent', srv("var sent = (rows || []).filter(function(c) { return c.name && c.sendToAgent; });", "var sent = (rows || []).filter(function(c) { return c.name; });")],
  ['the credential ID goes to the agent', srv("var item = function(c) { var y = carCredYear_(c.earned); return c.name + (y ? ' (' + y + ')' : ''); };", "var item = function(c) { var y = carCredYear_(c.earned); return c.name + (c.credentialId ? ' #' + c.credentialId : '') + (y ? ' (' + y + ')' : ''); };")],
  ['renew soon never shows', srv("if (d <= soonDays) return { status: 'soon'", "if (false) return { status: 'soon'")],
  ['the reminder key has no expiry date', srv("out.push({ key: 'career_cert_' + slug + '_' + c.expires + '_' + lead,", "out.push({ key: 'career_cert_' + slug + '_' + lead,")],
  ['lead times ignore Config', srv("var out = String(v == null || v === '' ? '90,30,7' : v)", "var out = String('90')")],
  ['no pace reminder', srv("if (p && p.left && p.perMonth != null && p.perMonth > paceMax)", "if (false)")],
  ['the import runs every time', srv("  if (veraOnceGet_(CAR_CRED_IMPORT_PROP_)) return { imported: false, reason: 'already imported' };\n", "")],
  ['the bachelor’s degree isn’t added', srv("items.unshift({ kind: 'degree', name: CAR_CRED_BACHELOR_, earned: '', expires: '' });", "")],
  ['a save doesn’t reach the agent', srv("  try { var s = carCredSyncAgent_(); out.sync = s; } catch (e) { out.sync = { ok: false, error: e.message }; }\n", "")],
  ['renewing keeps the old credits', srv("  if (cur.renewal === 'credits') sheet.getRange(cur._row, CAR_CRED_HEADERS_.indexOf('Credits Earned') + 1).setValue(0);\n", "")],
  ['“Credentials held” isn’t owned', b => ({ 'Career.js': swap(b['Career.js'], "  'Credentials held'];", "  ];") })],
  ['the pace bar ignores progress', ui("className:'car-cred-bar',style:{height:8,width:p.pct+'%',", "className:'car-cred-bar',style:{height:8,width:'100%',"), UI],
  ['fee mode asks for credits', ui("f.renewal==='credits'?field('Credits needed'", "f.renewal!=='none'?field('Credits needed'"), UI],
  ['the agent switch isn’t saved', ui("onChange:function(e){set('sendToAgent',e.target.checked);}", "onChange:function(e){}"), UI],
  ['a credential ID shows on the card', ui("[c.issuer,c.earned?'earned '+String(c.earned).slice(0,4):''].filter(Boolean)", "[c.issuer,c.credentialId,c.earned?'earned '+String(c.earned).slice(0,4):''].filter(Boolean)"), UI],
];
const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
let allBit = true;
CONTROLS.forEach(function(c) {
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + c[0] + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + c[0] + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const test = c[2] || TEST;
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }, c[2] ? { CRED_QUICK: '1' } : {}) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  console.log('\n=== CONTROL: ' + c[0] + '  (' + test + ')');
  if (r.status !== 0 && !fails.length) { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:'); fails.slice(0, 3).forEach(f => console.log('    - ' + f));
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
