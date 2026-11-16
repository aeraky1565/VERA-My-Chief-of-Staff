// Negative controls for the full dashboard on a phone (the bottom bar, All, the greeting): break ONE
// rule at a time and confirm test_fullphone_ui.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_fullphone');
const FILES = ['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const css = (from, to) => b => ({ 'docs/index.html': swap(b['docs/index.html'], from, to) });
const T = 'test_fullphone_ui.js';
const CONTROLS = [
  ['no bottom bar on the phone', ui("React.createElement(FullBottomBar,{active:activeTab,onGo:openMainTab,", "false&&React.createElement(FullBottomBar,{active:activeTab,onGo:openMainTab,")],
  ['the top tabs stay on the phone', css("      .tabs, .status-bar { display: none !important; }\n", "")],
  ['the bar shows on a computer too', css("    .full-bar { display: none; }\n", "    .full-bar { display: block; }\n")],
  ['Chat isn’t the raised one', ui("{id:'chat',icon:'💬',label:'Chat',center:true}", "{id:'chat',icon:'💬',label:'Chat'}")],
  ['no Flags badge', ui("var n=b.id==='flags'?flagCount:b.id==='tasks'?overdue:0;", "var n=b.id==='tasks'?overdue:0;")],
  ['a hidden tab keeps its button', ui("var items=FULL_BAR.filter(function(b){return b.id==='all'||veraCan_(b.id);});", "var items=FULL_BAR;")],
  ['All lists hidden tabs', ui("var items=g.items.filter(function(it){return veraCan_(it[2]);});if(!items.length)return null;", "var items=g.items;")],
  ['All bounces back to Home', ui("if(ok.length&&activeTab!=='all'&&ok.indexOf(activeTab)===-1)", "if(ok.length&&ok.indexOf(activeTab)===-1)")],
  ['All forgets a tab', ui("['🌴','PTO','pto'],", "")],
  ['the last tile sits under the bar', css("      body { padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px)); }\n", "")],
  ['no greeting on the phone', css("      .fh-hello { display: flex; }\n", "")],
  ['the greeting forgets the name', ui("fhGreeting_(new Date())+(me?', '+me:'')", "fhGreeting_(new Date())")],
];
let allBit = true;
const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();
CONTROLS.forEach(([name, mut]) => {
  if (!HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT, f)));
  const r = cp.spawnSync('node', [T], { cwd: __dirname, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_CTL_FAST: '1' }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name + '  (' + T + ')');
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
