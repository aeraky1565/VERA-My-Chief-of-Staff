// Negative controls for issue #235 (SheetStyle.js): revert ONE rule at a time and
// confirm test_sheetstyle.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_sst');

const FILES = ['SheetStyle.js', 'Code.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const S = 'SheetStyle.js';
const ss = (from, to) => b => ({ [S]: swap(b[S], from, to) });
const TEST = 'test_sheetstyle.js';

const CONTROLS = [
  ['a data column is reordered', ss("    } else if (op.op === 'tabColor') {", "    } else if (op.op === 'tabColor') {\n      sheet.moveColumns(sheet.getRange(1, 1), 3);")],
  ['the header is written, not formatted', ss("sheet.getRange(1, 1, 1, op.cols).setBackground(SS_NAVY_)", "sheet.getRange(1, 1, 1, op.cols).setValue('').setBackground(SS_NAVY_)")],
  ['Config gets formatted', ss("    if (ssSkip_(t.name)) return;\n", "")],
  ['Access moves out of position 14', ss("  if (access) out.splice(Math.min(SS_FIXED_.Access, out.length), 0, access);", "  if (access) out.push(access);")],
  ['unknown tabs go after the internal ones', ss("    if (!a) return SS_AREAS_.length - 1.5;   // before internal", "    if (!a) return SS_AREAS_.length;")],
  ['a re-run wipes hand-made rules', ss("    return !(c && ssIsOurFill_(c.getBackground && c.getBackground()));", "    return false;")],
  ['old banding is left in place', ss("  sheet.getBandings().forEach(function(band) { band.remove(); });\n", "")],
  ['scores count as money', ss("|tier|total seen/i;", "|tier/i;")],
  ['banding stops at today\'s rows', ss("    var rows = Math.max(Number(t.maxRows) || 0, 2);", "    var rows = 2;")],
  ['wide tabs don\'t freeze column A', ss("cols: cols > 8 ? 1 : 0", "cols: 0")],
  ['no time limit', ss("    if (Date.now() - started > SS_TIME_LIMIT_MS_) { remaining.push(name); return; }\n", "")],
  ['new tabs are not styled', b => ({ 'Code.js': swap(b['Code.js'], "    if (typeof ssStyleNewTab_ === 'function') ssStyleNewTab_(sheet, headers.length);\n", "") })],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[1](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });
  const r = cp.spawnSync('node', [c[2] || TEST], { cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + (c[2] || TEST) + ')');
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)         { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length)   { console.log('  !! NOTHING BIT (patched: ' + changed.join(', ') + ')'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 3).forEach(f => console.log('    - ' + f));
  if (fails.length > 3) console.log('    … and ' + (fails.length - 3) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
