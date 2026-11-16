// Negative controls for test_workouts.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_workouts');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const S = ['Workouts.js'], FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['errands count', swapIn(S, "if (!t || WK_NOT_.test(t)) return '';", "if (!t) return '';")],
  ['EXERCISE no longer counts', swapIn(S, "return String(desc || '').toUpperCase().indexOf('EXERCISE') !== -1 || !!wkType_(title); }", "return !!wkType_(title); }")],
  ['only EXERCISE counts', swapIn(['GymTracker.js'], "      if (!wkIsWorkout_(ev.getTitle(), ev.getDescription())) continue;   // Workouts.js: EXERCISE, or Run / Swim / Class / Yoga…", "      if ((ev.getDescription() || '').toUpperCase().indexOf('EXERCISE') === -1) continue;")],
  ['no type written', swapIn(['GymTracker.js'], ".setValues([[s.id, s.title, s.date, '', '', wkType_(s.title) || 'Gym']]);", ".setValues([[s.id, s.title, s.date, '', '', '']]);")],
  ['added ones not attended', swapIn(S, "setValues([[id, type, date, 'Yes',", "setValues([[id, type, date, '',")],
  ['a future day kept', swapIn(S, "&& p.date <= today ? p.date : today;", "? p.date : today;")],
  ['target 3 by default', swapIn(S, "return n >= 1 && n <= 14 ? n : 4; }", "return n >= 1 && n <= 14 ? n : 3; }")],
  ['the read drops the target', swapIn(['WebApp.js'], "sessions: getGymLog_(), target: wkTarget_(getConfigValues()) };", "sessions: getGymLog_() };")],
  ['skipped ones count on the dots', swapIn(FULL, "done:(sessions||[]).filter(function(s){return s.attended==='Yes'&&s.date===iso;}).length", "done:(sessions||[]).filter(function(s){return !!s.attended&&s.date===iso;}).length")],
  ['the streak ignores the target', swapIn(FULL, "if((done[wkIso_(w)]||0)>=target)n++;else break;}return n;}", "if((done[wkIso_(w)]||0)>=1)n++;else break;}return n;}")],
  ['Went does nothing', swapIn(FULL, "onClick:function(){answer(s,true);}},'✓ Went')", "onClick:function(){}},'✓ Went')")],
  ['＋ Workout drops minutes', swapIn(FULL, "{action:'workout_add',type:a.type,minutes:a.minutes||'',date:a.date||''}", "{action:'workout_add',type:a.type,minutes:'',date:a.date||''}")],
];
const T = 'test_workouts.js';
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
