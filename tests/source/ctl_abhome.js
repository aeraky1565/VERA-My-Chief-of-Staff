// Negative controls for test_abhome.js: break ONE rule at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_abhome');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swapIn = (files, from, to) => b => { const out = {}; files.forEach(f => { if (b[f].indexOf(from) !== -1) out[f] = b[f].split(from).join(to); });
  if (!Object.keys(out).length) throw new Error('anchor moved: ' + from.slice(0, 70)); return out; };
const FULL = ['docs/app.js', 'docs/index.html'];
const CONTROLS = [
  ['runs not newest first', swapIn(FULL, "}).sort(function (a, b) { return String(b.last).localeCompare(String(a.last)); });", "});")],
  ['sent counts any year', swapIn(FULL, "if (String(m.sent).slice(0, 4) === year) sent[m.householdId] = true;", "sent[m.householdId] = true;")],
  ['last card can be a planned one', swapIn(FULL, "return (items || []).filter(abIsSent).sort(", "return (items || []).sort(")],
  ['stale after one year', swapIn(FULL, "return !y || (now || new Date()).getFullYear() - y >= 2;", "return !y || (now || new Date()).getFullYear() - y >= 0;")],
  ['full name only', swapIn(FULL, "return [f, f.split(/\\s+/)[0]]; };", "return [f]; };")],
  ['given ideas count', swapIn(FULL, "return hit(i.Person) && !String(i['Given On'] || '').trim(); }).length;", "return hit(i.Person); }).length;")],
  ['past dates count', swapIn(FULL, "return hit(d.Person) && d.daysUntil != null && d.daysUntil >= 0; })", "return hit(d.Person); })")],
  ['no runs on top', swapIn(FULL, "}, \"⚠️ \", error), !event && runs.length > 0 && ", "}, \"⚠️ \", error), false && ")],
  ['a link folds the household', swapIn(FULL, "className: \"ab-links\",\n      onClick: e => e.stopPropagation()", "className: \"ab-links\"")],
  ['the date link opens Gift Ideas', swapIn(FULL, "onClick: () => onOpenDates && onOpenDates(l.name)", "onClick: () => onOpenGifts && onOpenGifts(l.name)")],
  ['PeopleTab passes no ideas', swapIn(FULL, "ideas:giftData&&giftData.ideas||[],onOpenDates:", "ideas:[],onOpenDates:")],
  ['Tools open at first', swapIn(FULL, "const [showImport, setShowImport] = React.useState(false);", "const [showImport, setShowImport] = React.useState(true);")],
];
const T = 'test_abhome.js';
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
