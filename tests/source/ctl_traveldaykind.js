// Negative controls for issue #237 (the Travel Day email knows which day of the trip it is):
// revert ONE rule at a time and confirm test_traveldaykind.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tdk');

const FILES = ['TravelDayBriefing.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const T = 'TravelDayBriefing.js';
const tdb = (from, to) => b => ({ [T]: swap(b[T], from, to) });
const TEST = 'test_traveldaykind.js';

const CONTROLS = [
  ['every day is "travel day to" again', tdb("'You are VERA, Ahmed\\'s Chief of Staff. Trip: ' + tripLabel + '.\\n' +\n      travelDayPromptLine_(dayCtx) + '\\n\\n' +",
    "'You are VERA, Ahmed\\'s Chief of Staff. It\\'s travel day to ' + tripLabel + '.\\n\\n' +")],
  ['a day mid-trip forgets they are already there', tdb("'. They are already on the trip. ' +", "'. ' +")],
  ['the middle of a trip counts as departure', tdb("var kind = n === 1 ? 'departure' : n === total ? 'return' : hasFlight ? 'transit' : 'during';", "var kind = n === total ? 'return' : 'departure';")],
  ['a cruise checkout night still counts', tdb("    if (dayStr < out && (!hit || it.date >= hit.date))", "    if (dayStr <= out && (!hit || it.date >= hit.date))")],
  ['port stops get airport directions again', tdb("give directions from the cruise pier or tender dock, never from an airport or a ferry terminal, and leave out immigration and ferry details (the cruise line handles them). ", "")],
  ['a ship\'s restaurant is looked up anywhere', tdb("is most likely on board ' + ship + ': look it up there first.", "can be anywhere.")],
  ['a match in another country is kept', tdb("  lines.push('Only describe a place in that area. If the only match is somewhere else (another city or country), set found=false rather than give its details.');\n", "")],
  ['parking on a cruise comes back', tdb(" && !(dayCtx && dayCtx.onCruise)) details.parkingInfo", ") details.parkingInfo")],
  ['the lookup is not told the day', tdb("    try { details = buildTravelItemDetailsData_(row, dayCtx); }", "    try { details = buildTravelItemDetailsData_(row); }")],
  ['flight-data warnings show on every day', tdb("      return opts.hasFlight !== false || !/aviation|flight/i.test(String(d.source || ''));", "      return true;")],
  ['the subject says Travel Day every day', tdb("  if (ctx.kind === 'during') {", "  if (false) {")],
  ['the header always says Travel Day', tdb("escapeHtml_(opts.label || 'Travel Day')", "'Travel Day'")],
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
