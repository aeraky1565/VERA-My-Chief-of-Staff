// Negative controls for the HabitLog date reading (Habits.js): revert one rule at a time
// and confirm test_habitdates.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const SRC = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'ctl_hbd');
const BASE = fs.readFileSync(path.join(SRC, 'Habits.js'), 'utf8');
const swap = (from, to) => { if (BASE.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return BASE.replace(from, () => to); };
const CONTROLS = [
  ['the grid reads the date as text', swap("        date:    hbYmd_(r[2]),", "        date:    String(r[2] || '').trim(),")],
  ['marking compares as text', swap("String(existing[i][1]).trim() === habitId && hbYmd_(existing[i][2]) === hbYmd_(date)", "String(existing[i][1]).trim() === habitId && String(existing[i][2]).trim() === date")],
  ['unmarking compares as text', swap("String(data[i][1]).trim() === habitId && hbYmd_(data[i][2]) === hbYmd_(date)", "String(data[i][1]).trim() === habitId && String(data[i][2]).trim() === date")],
  ['text dates aren\'t padded', swap("return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : s;", "return s;")],
];
let allBit = true;
CONTROLS.forEach(([name, src]) => {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'Habits.js'), src);
  const r = cp.spawnSync('node', ['test_habitdates.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []);
  console.log('\n=== CONTROL: ' + name);
  if (r.status !== 0 && !fails.length) { console.log('  !! CRASHED with no clean assertion failure'); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
