// Negative controls for test_routine.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_routine');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Routine.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['no-list items hidden', swapIn(S, "var l = mrList_(itemList); return !l || !mrList_(list) || l === mrList_(list); }", "var l = mrList_(itemList); return l === mrList_(list); }")],
  ['Saturday is a weekday', swapIn(S, "return w === 0 || w === 6 ? 'Weekend' : 'Weekday'; }", "return w === 0 ? 'Weekend' : 'Weekday'; }")],
  ['one prompt for both', swapIn(S, "var weekend = mrList_(list) === 'Weekend';", "var weekend = false;")],
  ['the column isn’t named', swapIn(S, ".setValue('List');", ".setValue('');")],
  ['generating wipes both lists', swapIn(['WebApp.js'], "if (String(allRows[i][2] || '') === 'vera' && (mrList_(allRows[i][MR_LIST_COL_ - 1]) || 'Weekday') === list) sheet.deleteRow(i + 2);", "if (String(allRows[i][2] || '') === 'vera') sheet.deleteRow(i + 2);")],
  ['adding drops the list', swapIn(['WebApp.js'], ".setValues([[itemId, text, source, maxSort + 1, false, '', addedDate, list]]);", ".setValues([[itemId, text, source, maxSort + 1, false, '', addedDate, '']]);")],
  ['moving ignores the list', swapIn(['WebApp.js'], "  if (onList) data = data.filter(function(r) { return mrInList_(r[MR_LIST_COL_ - 1], onList); });\n", "")],
  ['the screen ignores the list', swapIn(FULL, "return (items||[]).filter(function(i){return !i.list||i.list===list;}).slice()", "return (items||[]).slice()")],
  ['opens on Weekday always', swapIn(FULL, "var _l=React.useState(mrTodayListUI_(new Date())),list=", "var _l=React.useState('Weekday'),list=")],
  ['generate ignores the list', swapIn(FULL, "{action:'generate_morning_routine',list:list}", "{action:'generate_morning_routine'}")],
  ['both lists ignored', swapIn(FULL, "list:both?'':list}", "list:list}")],
];
const T = 'test_routine.js';
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
