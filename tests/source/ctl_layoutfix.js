// Negative controls for the Nov 13 layout fixes: revert ONE rule at a time and
// confirm test_layoutfix.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_layoutfix');
const FILES = ['SheetStyle.js', 'Code.js', 'WebApp.js', 'TripIds.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const S = 'SheetStyle.js', W = 'WebApp.js', T = 'TripIds.js';
const CONTROLS = [
  ['skip matches case exactly again', b => ({ [S]: swap(b[S], "  return SS_SKIP_.some(function(s) { return s.toLowerCase() === l; });", "  return SS_SKIP_.indexOf(name) !== -1;") })],
  ['Config found only by its exact name', b => ({ [S]: swap(b[S], "  var config = ssFind_(names, 'Config'), access", "  var config = (names || []).indexOf('Config') !== -1 ? 'Config' : null, access") })],
  ['new tabs skip by exact name', b => ({ [S]: swap(b[S], "    if (ssSkip_(name) || !cols) return;", "    if (SS_SKIP_.indexOf(name) !== -1 || !cols) return;") })],
  ['Config\'s first column not frozen again', b => ({ [S]: swap(b[S], "    if (sh.getFrozenColumns() !== 1) sh.setFrozenColumns(1);\n", "") })],
  ['the styling run doesn\'t restore Config', b => ({ [S]: swap(b[S], "function styleVeraSheet() {\n  restoreConfigTab_();", "function styleVeraSheet() {") })],
  ['the repair runs over unknown data', b => ({ [T]: swap(b[T], "        return { ok: false, why: 'row '", "        if (false) return { ok: false, why: 'row '") })],
  ['a count in column 12 is left there', b => ({ [T]: swap(b[T], "      if (String(at(TRAV)).trim() === '') out.moves.push({ row: i + 2, from: TID, to: TRAV });", "      if (false) out.moves.push({ row: i + 2, from: TID, to: TRAV });") })],
  ['a budget over Characteristics is left there', b => ({ [T]: swap(b[T], "      if (String(at(BUDGET)).trim() === '') out.moves.push({ row: i + 2, from: CHAR, to: BUDGET });\n      else out.clears.push({ row: i + 2, col: CHAR });", "") })],
  ['extra labels kept', b => ({ [T]: swap(b[T], "  if (plan.extraCols) sh.getRange(1, plan.header.length + 1, 1, plan.extraCols).clearContent();\n", "") })],
  ['Trip IDs not filled after the repair', b => ({ [T]: swap(b[T], "  var filled = tripIdStampAll_();", "  var filled = null;") })],
  ['the log names trips', b => ({ [T]: swap(b[T], "  Logger.log('repairTripMeta: header row reset; '", "  Logger.log(JSON.stringify(rows) + 'repairTripMeta: header row reset; '") })],
  ['the budget writer finds columns by name again', b => ({ [W]: swap(b[W], "  var budgetCol = TRIP_META_HEADERS.indexOf('Trip Budget')     + 1;\n  var travCol   = TRIP_META_HEADERS.indexOf('Trip Travellers') + 1;", "  var hdrsRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];\n  var budgetCol = hdrsRow.indexOf('Trip Budget')     + 1;\n  var travCol   = hdrsRow.indexOf('Trip Travellers') + 1;") })],
  ['missing headers appended past column 12', b => ({ [W]: swap(b[W], "    if (!header[i]) { sheet.getRange(1, i + 1).setValue(name); header[i] = name; }", "    if (header.indexOf(name) === -1) { header.push(name); sheet.getRange(1, header.length).setValue(name); }") })],
  ['a new trip\'s row is short', b => ({ [W]: swap(b[W], "  row[TRIP_META_HEADERS.length - 1] = (typeof tripIdCell_ === 'function' ? tripIdCell_(tripKey) : '');   // Trip ID\n  sheet.appendRow(row);", "  sheet.appendRow(row.slice(0, 7));") })],
];
let allBit = true;
CONTROLS.forEach(([name, mut]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const r = cp.spawnSync('node', ['test_layoutfix.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
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
