// Negative controls for the Projects redesign (Projects.js, Coming up in HomeFront.js, and the
// shared ProjBoard block): revert ONE rule at a time and confirm a test catches it. Server rules
// run test_projecthealth.js, Coming up runs test_homefront.js, and the screens run
// test_projectui.js — quickly (PROJ_QUICK), or the lite page only for the lite scoping — and
// are skipped with no browser.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_proj');

const FILES = ['Projects.js', 'HomeFront.js', 'Code.js', 'WebApp.js', 'Tasks.js', 'Memory.js', 'TripIdeas.js', 'docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const P = 'Projects.js', H = 'HomeFront.js', W = 'WebApp.js', A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const T = 'test_projecthealth.js', HF = 'test_homefront.js', UI = 'test_projectui.js';

const CONTROLS = [
  ['re-dating is a day off', one(P, "    var d = projShiftDate_(target, -b);", "    var d = projShiftDate_(target, -b + 1);")],
  ['a stale Due Date cell wins over the target', one(P, "      if (t.before !== null) t.dueDate = projShiftDate_(proj.targetDate, -t.before);", "")],
  ['moving the target leaves its tasks behind', one(W, "  res.redated = projRedate_(getSpreadsheet().getSheetByName(TABS.PROJECTS), projectId);", "  res.redated = 0;")],
  ['a task added days before keeps the date it was sent', one(W, "  if (before !== '' && targetStr) dueDate = projShiftDate_(targetStr, -before);", "")],
  ['Waiting On outlives Blocked', one(P, "  if (val !== 'Blocked') sheet.getRange(rn, PROJ_COL.WAITING_ON + 1).setValue('');", "")],
  ['Waiting On lands on a task that isn\'t blocked', one(W, "st === 'Blocked' ? String(e.parameter.waitingOn).trim() : ''", "String(e.parameter.waitingOn).trim()")],
  ['pace is never "a little behind"', one(P, "'behind' : p.timePct > p.pct ? 'slightly' : 'on'", "'behind' : 'on'")],
  ['the flag counts done tasks as overdue', one(P, "return t.status !== 'Done' && t.isOverdue; });\n    if (!late.length) return;", "return t.isOverdue || t.status === 'Done'; });\n    if (!late.length) return;")],
  ['Coming up lets a project crowd the house out', one(H, "out = out.concat(projItems.slice(0, HF_COMING_PROJ_MAX_));", "out = out.concat(projItems);"), HF],
  ['Coming up lists done project tasks', one(H, "if (t.status === 'Done' || !d || d > soon7) return;", "if (!d || d > soon7) return;"), HF],
  // the screens
  ['cards aren\'t sorted by what needs you', both("active=visible.filter(pjOpen_).sort(function(a,b){return rank(a)-rank(b);})", "active=visible.filter(pjOpen_)"), UI],
  ['a task can be moved across phases', both("canDrop=mover&&mover!==t&&(mover.phase||'')===(t.phase||'')", "canDrop=mover&&mover!==t"), UI],
  ['±1 wk leaves the days-before dates where they were', both("dueDate:pjShift_(d,-t.before)", "dueDate:t.dueDate"), UI],
  ['Blocked never asks who it waits on', both("setAsking(nx==='Blocked'?t.rowNum:null);", "setAsking(null);"), UI],
  ['the lite page shows Ahmed\'s projects', one(L, "var LITE_PROJECT_OWNERS = ['Shared', 'Victoria'];", "var LITE_PROJECT_OWNERS = ['Shared', 'Victoria', 'Ahmed'];"), UI, 'lite'],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0], test = c[2] || T, ui = test === UI;
  if (ui && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const env = Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }, ui ? (c[3] === 'lite' ? { VERA_ONLY: 'lite' } : { PROJ_QUICK: '1' }) : {});
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
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
