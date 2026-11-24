// Negative controls for test_practicelogs.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_practicelogs');
const FILES = ['PracticeLogs.js', 'Life.js', 'NightlyRunner.js', 'Settings.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (f, from, to) => b => { if (b[f].indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); const o = {}; o[f] = b[f].split(from).join(to); return o; };
const P = 'PracticeLogs.js';
const CONTROLS = [
  ['the tab has no default', swap(P, "lfStr_(x && x.tab, 60) || 'Practice'", "lfStr_(x && x.tab, 60)")],
  ['items without a goal kept', swap(P, ".filter(function(x) { return x.sheet && x.goal; });", ".filter(function(x) { return x.sheet; });")],
  ['a Date cell is skipped', swap(P, "var d = lfYmd_(r[col('date')]);", "var d = typeof r[col('date')] === 'string' ? lfYmd_(r[col('date')]) : '';")],
  ['same-day rows don\'t add up', swap(P, "minutes: (prev ? prev.minutes : 0) + m,", "minutes: m,")],
  ['the note leaves out the theme', swap(P, "['theme', 'note'].map(", "['note'].map(")],
  ['more minutes resend the whole day', swap(P, "out.push({ date: r.date, minutes: r.minutes - prev, note: '',", "out.push({ date: r.date, minutes: r.minutes, note: '',")],
  ['a synced day is sent again', swap(P, "    else if (r.minutes > prev) out.push(", "    else out.push(")],
  ['the window is ignored', swap(P, "    if (r.date < sinceYmd) return;\n", "")],
  ['nothing is pruned', swap(P, "if (String(k.split('|')[1]) >= keepFrom) out[k] = synced[k];", "out[k] = synced[k];")],
  ['a refused day is marked sent', swap(P, "      if (res && res.ok) { synced[s.key] = s.total; logged++; }", "      synced[s.key] = s.total; if (res && res.ok) { logged++; }")],
  ['one bad log stops the rest', swap(P, "    catch (e) { failed++; Logger.log('plNightly_: could not read the ' + src.tab + ' tab of a practice log'); return; }", "    catch (e) { throw e; }")],
  ['nothing is remembered', swap(P, "  veraStoreSet_(PL_SYNCED_KEY_, JSON.stringify(plPrune_(synced, plShift_(today, -PL_KEEP_DAYS_))));\n", "")],
  ['the log line names the sheet', swap(P, "Logger.log('plNightly_: could not read the ' + src.tab + ' tab of a practice log');", "Logger.log('plNightly_: could not read ' + src.sheet);")],
  ['the step isn\'t in the nightly list', swap('NightlyRunner.js', "    S('plNightly_', 3, function() { plNightly_(); }),", "")],
  ['the key isn\'t a VERA State key', swap('Settings.js', ", 'PRACTICE_LOG_SYNCED']", "]")],
];
let allBit = true;
CONTROLS.forEach(([name, mut]) => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const r = cp.spawnSync('node', ['test_practicelogs.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
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
