// Negative controls for the round trip: break ONE link in the chain
// write -> sheet -> webGetCards_ -> isPerkUsed and confirm the test notices.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_prt');
const FILES = ['Code.js', 'WebApp.js'];
const DOCS  = ['app.js', 'index.html', 'dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
DOCS.forEach(f => { BASE['docs/' + f] = fs.readFileSync(path.join(SRC_DIR, 'docs', f), 'utf8'); });

const eachDoc = (b, fn) => {
  const o = {};
  DOCS.forEach(f => { o['docs/' + f] = fn(b['docs/' + f]); });
  return o;
};

const CONTROLS = {
  'every frequency is stamped with the MONTH key': b => ({
    'Code.js': b['Code.js'].replace(
      "function cardPerkPeriodKey_(freq, date, tz) {\n  if (freq === 'Standing') return 'standing';",
      "function cardPerkPeriodKey_(freq, date, tz) {\n  if (freq === 'Standing') return 'standing';\n  return Utilities.formatDate(date, tz, 'yyyy-MM');"),
  }),
  'the tick is written as TRUE instead of the period key': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "  var newUsed = r.used ? '' : r.period;",
      "  var newUsed = r.used ? '' : true;"),
  }),
  'the writer targets the wrong column': b => ({
    'WebApp.js': b['WebApp.js'].replace("  var lastUsedCol = colOf('Last Used',   7);",
                                        "  var lastUsedCol = 8;"),
  }),
  'the refresh reads one column to the left': b => ({
    'WebApp.js': b['WebApp.js'].replace("      lastUsed:  String(r[6] || ''),\n      needsReview:",
                                        "      lastUsed:  String(r[5] || ''),\n      needsReview:"),
  }),
  'the refresh drops lastUsed from the payload': b => ({
    'WebApp.js': b['WebApp.js'].replace("      lastUsed:  String(r[6] || ''),\n      needsReview:",
                                        "      lastUsed:  '',\n      needsReview:"),
  }),
  'the dashboard compares everything against the month': b => eachDoc(b, s => s
    .replace(/if\s*\(perk\.frequency\s*===\s*'Quarterly'\)\s*return perk\.lastUsed\s*===\s*curQuarter;/,
             "if(perk.frequency==='Quarterly')return perk.lastUsed===curMonth;")
    .replace(/if \(perk\.frequency === 'Quarterly'\)\s*return perk\.lastUsed === curQuarter;/,
             "if (perk.frequency === 'Quarterly') return perk.lastUsed === curMonth;")),
  'the dashboard pins the quarter to Q3 (never rolls over)': b => eachDoc(b, s => s
    .replace(/curYear\s*\+\s*'-Q'\s*\+\s*\(Math\.floor\(now\.getMonth\(\)\s*\/\s*3\)\s*\+\s*1\)/g,
             "curYear + '-Q3'")),
  'un-ticking leaves the stamp in place': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "  var newUsed = r.used ? '' : r.period;",
      "  var newUsed = r.period;"),
  }),
  'marking used writes nothing at all': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "  r.sheet.getRange(r.rowNum, r.lastUsedCol).setValue(r.period);\n  out.marked = true;",
      "  out.marked = true;"),
  }),
  'a standing perk is reported as used': b => eachDoc(b, s => s
    .replace(/if\s*\(perk\.frequency\s*===\s*'Standing'\)\s*return false;/g,
             "if(perk.frequency==='Standing')return true;")),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true });
  const patch = CONTROLS[name](BASE);
  const files = Object.assign({}, BASE, patch);
  let changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_perkroundtrip.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)         { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-5).join('\n')); allBit = false; return; }
  if (!fails.length)   { console.log('  !! NOTHING BIT (patched: ' + changed.join(', ') + ')'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 3).forEach(f => console.log('    - ' + f));
  if (fails.length > 3) console.log('    … and ' + (fails.length - 3) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
