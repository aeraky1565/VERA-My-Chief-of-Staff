// Negative controls for the recurring-task cadence (Every N days/weeks/months/years): break ONE rule
// at a time and confirm test_cadence.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_cadence');
const FILES = ['WebApp.js', 'docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const css = (from, to) => b => ({ 'docs/index.html': swap(b['docs/index.html'], from, to) });
const T = 'test_cadence.js';
const web = (from, to) => b => ({ 'WebApp.js': swap(b['WebApp.js'], from, to) });
const CONTROLS = [
  ['years aren’t understood', web("'every year': ['year', 1] };", "'every year': ['year', 1] };\n  if (/year/.test(s)) return null;")],
  ['month ends overflow again', web("  d.setDate(Math.min(day, last));\n  return d;", "  d.setDate(day);\n  return d;")],
  ['anything unreadable becomes monthly again', web("  return null;\n}\n\n/** Pure: '' when VERA can read", "  return { unit: 'month', n: 1 };\n}\n\n/** Pure: '' when VERA can read")],
  ['adding a task doesn’t check', web("  const why = cadenceProblem_(recurring);\n  if (why) throw new Error(why);\n", "")],
  ['editing a task doesn’t check', web("{ const why = cadenceProblem_(e.parameter.recurring); if (why) throw new Error(why); }", "{ }")],
  ['old values stop repeating', web("  if (!c) c = { unit: 'month', n: 1 };", "  if (!c) return null;")],
  ['the dashboard’s copy drifts', ui("function tcLabel_(n,unit){n=Math.max(1,Math.min(99,parseInt(n,10)||1));", "function tcLabel_(n,unit){n=Math.max(1,Math.min(99,parseInt(n,10)||1))+1;")],
  ['Custom… shows nothing (the old bug)', ui("custom&&React.createElement(\"span\",{className:\"tc-custom\"", "false&&React.createElement(\"span\",{className:\"tc-custom\"")],
  ['no next-date preview', ui("nextDue?(dueDate?\" · next after \"+fmtDate(dueDate)+\": \":\" · next: \")+fmtDate(nextDue):\"\"", "\"\"")],
  ['an unreadable old value isn’t flagged', ui("custom&&was&&!wasPreset&&!wasC&&React.createElement", "false&&React.createElement")],
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
