// Negative controls for Tech gear (TechGear.js + HomestewardView): revert ONE rule at a
// time and confirm test_techgear.js / test_techgear_ui.js catch it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tg');
const FILES = ['TechGear.js', 'HomeSteward.js', 'WebApp.js', 'NightlyRunner.js', 'FlagsTasks.js', 'Features.js', 'docs/app.js', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const tg = (from, to) => b => ({ 'TechGear.js': swap(b['TechGear.js'], from, to) });
const web = (from, to) => b => ({ 'WebApp.js': swap(b['WebApp.js'], from, to) });
// A page control patches app.js AND the index.html built from it (the same text is in both).
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const T = 'test_techgear.js', U = 'test_techgear_ui.js';

const CONTROLS = [
  ['any category counts as tech', tg("return /\\b(tech|laptops?", "return true || /\\b(tech|laptops?")],
  ['columns not named on first use', tg("  if (h.some(function(x) { return !String(x).trim(); })) sheet.getRange(1, TG_FIRST_COL_, 1, TG_HEADERS_.length).setValues([TG_HEADERS_]);\n", "")],
  ['a formula gets through', tg("  if (/^[=+@\\-]/.test(s) && !/^-?\\d/.test(s)) throw", "  if (false) throw")],
  ['edit skips the stale-list check', tg("var p = (e && e.parameter) || {}, r = hsRow_(p), t;", "var p = (e && e.parameter) || {}, r = { sheet: getSpreadsheet().getSheetByName(TABS.HOME_ITEMS), rowNum: +p.row, item: p.item }, t;")],
  ['a looked-up month is not its last day', tg("date = new Date(Date.UTC(+q[0], +q[1], 0))", "date = new Date(Date.UTC(+q[0], +q[1] - 1, 1))")],
  ['plan flag has no lead time', tg("pd >= 0 && pd <= lead.plan)", "pd >= 0)")],
  ['plan flag stays after the date', tg("if (pd != null && pd >= 0 && pd <= lead.plan)", "if (pd != null && pd <= lead.plan)")],
  ['support and trade-in flags both raised', tg("    else if (sd != null && sd > lead.support && sd <= lead.tradein)", "    if (sd != null && sd <= lead.tradein)")],
  ['non-tech items flagged', tg("    if (!it || !it.isTech || !it.item) return;", "    if (!it || !it.item) return;")],
  ['the read leaves out the tech columns', web("Math.min(TG_LAST_COL_, sheet.getMaxColumns())", "Math.min(HS_MANUAL_COL_, sheet.getMaxColumns())")],
  ['a new item drops its tech details', web("    tgWrite_(sheet, sheet.getLastRow(), tech);\n", "")],
  ['not in the night', b => ({ 'NightlyRunner.js': swap(b['NightlyRunner.js'], "\n    S('checkTechGear_', 3, function() { checkTechGear_(); }),", "") })],
  ['the serial shows without Show', ui("shown[it.row]?h('code',null,it.serial):h('span',{className:'tg-mask'},'••••••')", "h('code',null,it.serial)"), U],
  ['the Tech chip shows everything', ui("return f==='tech'?hsTechOf_(it):", "return f==='tech'?true:"), U],
  ['the lookup fills nothing', ui("if(r&&r.ok){set('supportUntil',r.date);", "if(r&&r.ok){"), U],
  ['a typed date stays "estimate"', ui("if(k==='supportUntil')set('supportSource',v?'you':'');", ""), U],
  ['the add form never shows tech fields', ui("    hsIsTech_(form.category)&&techFields(form,setF),", "    false&&techFields(form,setF),"), U],
  ['replace and resell always shown', ui("soon=it.supportDays!=null&&it.supportDays>=0&&it.supportDays<=180;", "soon=true;"), U],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0], test = c[2] || T;
  if (test === U && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch), changed = [];
  Object.keys(files).forEach(f => { if (files[f] !== BASE[f]) changed.push(f); const dest = path.join(OUT, f); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => { try { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(SRC_DIR, f), d); } catch (e) {} });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', timeout: 240000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed) { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT (patched: ' + changed.join(', ') + ')'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:'); fails.slice(0, 3).forEach(f => console.log('    - ' + f));
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
