// Negative controls: revert ONE behaviour at a time against the new source.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl3');
const FILES = ['Code.js', 'WebApp.js', 'TravelDayBriefing.js'];
const DOCS  = ['app.js', 'index.html', 'dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
DOCS.forEach(f => { BASE['docs/' + f] = fs.readFileSync(path.join(SRC_DIR, 'docs', f), 'utf8'); });

const CONTROLS = {
  'Standing gets a real period end (reminders come back)': b => ({
    'Code.js': b['Code.js'].replace("  if (freq === 'Standing') return null;\n", ''),
  }),
  'the expiry skip is removed': b => ({
    'Code.js': b['Code.js'].replace("    if (freq === 'Standing') return;\n", ''),
  }),
  'Standing gets a date-shaped period key': b => ({
    'Code.js': b['Code.js'].replace("  if (freq === 'Standing') return 'standing';\n", ''),
  }),
  'blank frequency is changed to mean Standing (the tempting mistake)': b => ({
    'Code.js': b['Code.js']
      .replace("  if (freq === 'Standing') return 'standing';",
               "  if (freq === 'Standing' || !freq) return 'standing';")
      .replace("  if (freq === 'Standing') return null;",
               "  if (freq === 'Standing' || !freq) return null;"),
  }),
  'the relevance check skips Standing too': b => ({
    'Code.js': b['Code.js'].replace(
      "    if (isAutopay) return;             // on autopay — fully excluded from tracking\n\n    var results;",
      "    if (isAutopay) return;             // on autopay — fully excluded from tracking\n    if (freq === 'Standing') return;\n\n    var results;"),
  }),
  'the prompt hardcodes a bare "amount $" again': b => ({
    'Code.js': b['Code.js'].replace(/\(amount === '' \|\| amount === null[\s\S]*?: ', amount \$' \+ amount\) \+/,
                                    "', amount $' + amount +"),
  }),
  'period fields are not null-guarded': b => ({
    'WebApp.js': b['WebApp.js']
      .replace("periodEndIso:   periodEnd ? Utilities.formatDate(periodEnd, tz, 'yyyy-MM-dd') : null,",
               "periodEndIso:   Utilities.formatDate(periodEnd, tz, 'yyyy-MM-dd'),")
      .replace("periodEndLabel: periodEnd ? Utilities.formatDate(periodEnd, tz, 'MMM d, yyyy') : null,",
               "periodEndLabel: Utilities.formatDate(periodEnd, tz, 'MMM d, yyyy'),")
      .replace("daysLeft:       periodEnd ? Math.round((periodEnd - now) / 86400000) : null,",
               "daysLeft:       Math.round((periodEnd - now) / 86400000),"),
  }),
  'marking a standing perk used writes the cell': b => ({
    'WebApp.js': b['WebApp.js'].replace(/  if \(r\.standing\) \{\n    out\.reason = 'standing';\n    return out;\n  \}\n/, ''),
  }),
  'Standing dropped from perkGroups (perk goes invisible)': b => {
    const o = {};
    DOCS.forEach(f => { o['docs/' + f] = b['docs/' + f].replace(/,\s*'Standing'\]/, ']'); });
    return o;
  },
  'isPerkUsed loses its early return': b => {
    const o = {};
    DOCS.forEach(f => {
      o['docs/' + f] = b['docs/' + f]
        .replace(/if\s*\(perk\.frequency\s*===\s*'Standing'\)\s*return false;\s*/g, '');
    });
    return o;
  },
  'the period suffix is shown for Standing': b => {
    const o = {};
    DOCS.forEach(f => { o['docs/' + f] = b['docs/' + f].replace(/&&\s*freq\s*!==\s*'Standing'/g, ''); });
    return o;
  },
  'the select no longer offers Standing': b => {
    const o = {};
    DOCS.forEach(f => {
      o['docs/' + f] = b['docs/' + f]
        .replace('<option>Standing</option>', '')
        .replace(',/*#__PURE__*/React.createElement("option",null,"Standing")', '');
    });
    return o;
  },
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true });
  const patch = CONTROLS[name](BASE);
  const files = Object.assign({}, BASE, patch);
  let changed = false;
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed = true;
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_perkstanding.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
  if (!changed)      { console.log('  !! MUTATION DID NOT APPLY — vacuous'); allBit = false; return; }
  if (crashed)       { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit:');
  fails.slice(0, 5).forEach(f => console.log('    - ' + f));
  if (fails.length > 5) console.log('    … and ' + (fails.length - 5) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
