// Negative controls for the Cycle tracker (Cycle.js and FpCycleCard under Family Planning › Trying):
// revert ONE rule at a time and confirm test_cycle.js (server) or test_cycle_ui.js (card) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_cycle_out');

const FILES = ['Cycle.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const UI = 'test_cycle_ui.js', SRV = 'test_cycle.js', S = 'Cycle.js';
const srv = (from, to) => b => ({ [S]: swap(b[S], from, to) });

const CONTROLS = [
  ['outlier gaps count toward the average', srv('if (g >= 15 && g <= 60) gaps.push(g);', 'gaps.push(g);'), SRV],
  ['ovulation is counted from the start, not back from the next period', srv('ovu = cyAdd_(next, -14);', 'ovu = cyAdd_(start, 14);'), SRV],
  ['late is never flagged', srv("if (today > next) { v.phase = 'late';", "if (false) { v.phase = 'late';"), SRV],
  ['the fertile reminder goes out when not trying', srv("if (!view || phase !== 'trying') return [];", 'if (!view) return [];'), SRV],
  ['the late reminder is sent every day', srv("view.lateBy === late) out.push", "view.lateBy >= late) out.push"), SRV],
  ['the nightly step runs when not trying', srv("if (phase !== 'trying') return 'not trying';", ''), SRV],
  ['a reminder already sent goes out again', srv("wasRecentlySent_(n.key, 60 * 24 * 60)) return;", "false) return;"), SRV],
  ['a second log a few days later adds a new period', srv("Math.abs(cyDays_(cyYmd_(r.start), start)) <= CY_SAME_PERIOD_DAYS_", 'false'), SRV],
  ['a future start is accepted', srv("if (start > cyTodayYmd_()) return { ok: false, error: 'That day hasn’t happened yet.' };", ''), SRV],
  ['an end before the start is accepted', srv("if (end && end < start) return { ok: false, error: 'It can’t end before it starts.' };", ''), SRV],
  ['the card no longer waits for Trying', both("phase==='trying'?h(FpCycleCard,", "true?h(FpCycleCard,")],
  ['Yesterday logs today', both("form.when==='yesterday'?cyfAdd(today,-1):form.date", "form.when==='yesterday'?today:form.date")],
  ['the mood line drops “Go easy”', both("cyfMoodLine(d.mood)+'. Go easy.'", "cyfMoodLine(d.mood)+'.'")],
  ['Period ended is never offered', both("v.phase==='period'&&!d.log[0].end?h('button',{type:'button',className:'cy-end'", "false?h('button',{type:'button',className:'cy-end'")],
  ['the week strip doesn’t mark peak days', both("if(d>=v.peakStart&&d<=v.peakEnd)return 'peak';", '')],
  ['× doesn’t delete', both("post({action:'cycle_delete',id:r.id});", "post({action:'cycle_nothing',id:r.id});")],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
const ONLY = process.env.CTL_ONLY;
CONTROLS.forEach(function(c) {
  if (ONLY && c[0] !== ONLY) return;
  const name = c[0];
  if (!HAS_BROWSER && (c[2] || UI) === UI) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const r = cp.spawnSync('node', [c[2] || UI], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + (c[2] || UI) + ')');
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
