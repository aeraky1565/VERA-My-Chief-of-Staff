// Negative controls for the System tab (System.js and SystemTab, issue #222 stage 1): break ONE
// rule at a time and confirm a test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_system_out');
const FILES = ['System.js', 'ApiHealth.js', 'WebApp.js', 'docs/app.js', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const F = 'System.js', A = 'docs/app.js', I = 'docs/index.html';
const srv = (from, to) => b => ({ [F]: swap(b[F], from, to) });
const ui = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to) });
const TEST = 'test_system.js', UI = 'test_system_ui.js';
const CONTROLS = [
  ['a policy is only matched by id', srv("var byName = !byId && x.q && String(r.name || '').toLowerCase().indexOf(x.q.toLowerCase()) !== -1;", "var byName = false;")],
  ['Chat is not listed as a reader', srv("    used.push('Chat: VERA can read it when you ask');\n", "")],
  ['a rate limit counts as failing', srv("} else if (e.lastRateLimited && now - e.lastRateLimited < SYS_SLOW_AFTER_MS_) {\n      status = 'slow';", "} else if (e.lastRateLimited && now - e.lastRateLimited < SYS_SLOW_AFTER_MS_) {\n      status = 'failing';")],
  ['an old rate limit stays slow forever', srv("e.lastRateLimited && now - e.lastRateLimited < SYS_SLOW_AFTER_MS_", "e.lastRateLimited")],
  ['a stale source reads as OK', srv("} else if (!e.lastSuccess || now - e.lastSuccess >= SYS_SLOW_AFTER_MS_) {", "} else if (false) {")],
  ['OK sorts first', srv("var rank = { failing: 0, slow: 1, ok: 2 };", "var rank = { failing: 2, slow: 1, ok: 0 };")],
  ['the used-by line is not shown', ui('r.usedBy&&r.usedBy.length>0&&', 'false&&'), UI],
  ['API health is not mounted', ui("cur==='api_health'&&h(SysApiHealth,", "false&&h(SysApiHealth,"), UI],
  ['the roster is not under Assistants', ui("cur==='assistants'&&h(VeraRoster,", "false&&h(VeraRoster,"), UI],
  ['Feature Flags is not under System', ui("cur==='flags'&&h(SysFeatureFlags,", "false&&h(SysFeatureFlags,"), UI],
  ['Home shows Projects with none active', ui("if(activeProjs.length===0)return null;", ""), UI],
  ['System opens on Documents again', ui("var[own,setOwn]=React.useState('assistants');", "var[own,setOwn]=React.useState('documents');"), UI],
  ['Test is not under System', ui("cur==='test'&&h(TestEmailsPanel,", "false&&h(TestEmailsPanel,"), 'test_testtab_ui.js'],
  ['🔔 opens the old settings window', ui("onClick:()=>{setSystemSub('notifications');setActiveTab('system');loadResources(apiUrl,apiToken);}", "onClick:()=>setNotifSettingsOpen(true)"), UI],
  ['the health rows are not sorted worst first in the UI', ui("data.sources.map(function(s){return h(\"div\",{key:s.source,className:\"sys-health-row\"", "data.sources.slice().reverse().map(function(s){return h(\"div\",{key:s.source,className:\"sys-health-row\""), UI],
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
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }, {}) });
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
