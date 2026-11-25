// Negative controls for AGORA (Agora.js + the Lounge on the dashboard): revert one rule at a time
// and confirm test_agora.js / test_agora_ui.js catch it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const SRC = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'ctl_ag');
const FILES = ['Agora.js', 'WebApp.js', 'PracticeLogs.js', 'Settings.js', 'docs/app.js', 'docs/index.html'];
const BASE = {}; FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const ag = (from, to) => b => ({ 'Agora.js': swap(b['Agora.js'], from, to) });
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const T = 'test_agora.js', U = 'test_agora_ui.js';
const CONTROLS = [
  ['coming-soon teachers dropped', ag("return list.filter(function(x) { return x && (x.name || x.sheet); })", "return list.filter(function(x) { return x && x.sheet && x.goal; })")],
  ['">B1" read as B1', ag("  if (last[1] !== '>') return lv;", "  return lv;")],
  ['any app link kept', ag("app: /^https:\\/\\//i.test(app) ? app : ''", "app: app")],
  ['level from the first row, not the latest', ag("if (lv && d >= levelDate) { level = lv; levelDate = d; }", "if (lv && !level) { level = lv; levelDate = d; }")],
  ['dozing ignores her target', ag("var allow = target ? Math.ceil(7 / target) : 3;", "var allow = 3;")],
  ['proud never shows', ag("if (target && p.thisWeek >= target) return 'proud';", "")],
  ['trips any distance away', ag("if (d < 0 || d > days) return;", "if (d < 0) return;")],
  ['free slot ignores now', ag("var start = Math.max(lo, Math.ceil(nowMin / 5) * 5);", "var start = lo;")],
  ['coming-soon teachers are read', ag("    if (!t.live) return out;\n", "")],
  ['one unreadable sheet breaks the lounge', ag("catch (e) { unread = true; Logger.log('agoraRead_: could not read ' + t.name + '’s ' + t.tab + ' tab'); }", "finally {}")],
  ['not owner-only', ag("  if (deny) return deny;\n", "")],
  ['the sync stops recording', b => ({ 'PracticeLogs.js': swap(b['PracticeLogs.js'], "  try { veraStoreSet_('PRACTICE_LOG_LAST',", "  try { void ('PRACTICE_LOG_LAST',") })],
  ['coming soon is a link', ui("return t.live&&href?h('a',", "return href||!t.live?h('a',"), U],
  ['no trip tag', ui("fwd&&h('span',{key:'trip',className:'ag-trip'}", "false&&h('span',{key:'trip',className:'ag-trip'}"), U],
  ['teachers never talk', ui("both.length>=2&&h('div',{className:'ag-talk'}", "both.length>=9&&h('div',{className:'ag-talk'}"), U],
  ['the trip page shows every teacher', ui("return t.live&&t.trip&&(t.trip.tripKey===key||", "return t.live&&(true||"), U],
  ['the roll call says late', ui("{cls:'wait',txt:'not yet today'}", "{cls:'wait',txt:'late'}"), U],
];
const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
let allBit = true;
CONTROLS.forEach(c => {
  const name = c[0], test = c[2] || T;
  if (test === U && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch), changed = [];
  Object.keys(files).forEach(f => { if (files[f] !== BASE[f]) changed.push(f); const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => { try { fs.copyFileSync(path.join(SRC, f), path.join(OUT, f)); } catch (e) {} });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', timeout: 240000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || ''), fails = (out.match(/^  FAIL .*$/gm) || []);
  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY'); allBit = false; return; }
  if (r.status !== 0 && !fails.length) { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-5).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
