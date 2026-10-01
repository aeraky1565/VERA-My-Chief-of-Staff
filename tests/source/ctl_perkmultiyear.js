// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The two that matter most are the ones that revert the change to something
// plausible rather than to something broken: comparing YEARS instead of dates
// (which reads a December credit as available the following January), and giving a
// multi-year perk a real period end (which is exactly how three Global Entry rows
// came to raise a High-urgency December reminder each).
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_pmy');
// Every root .js file, because the harness reads more of them than it mutates and
// they share one global scope.
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const DOCS  = ['app.js', 'index.html', 'dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
DOCS.forEach(f => { BASE['docs/' + f] = fs.readFileSync(path.join(SRC_DIR, 'docs', f), 'utf8'); });
BASE['README.md'] = fs.readFileSync(path.join(SRC_DIR, 'README.md'), 'utf8');

const eachDoc = (b, fn) => {
  const o = {};
  DOCS.forEach(f => { o['docs/' + f] = fn(b['docs/' + f]); });
  return o;
};

const CONTROLS = {
  // ---- the frequency is not recognised at all -------------------------------
  'the cadence parser never matches (back to Monthly for everything)': b => ({
    'Code.js': b['Code.js'].replace(
      "  var m = /^every\\s+(\\d{1,2})\\s+years?$/i.exec(String(freq || '').trim());",
      "  var m = null;"),
  }),
  'the parser is case-sensitive (his typing breaks it)': b => ({
    'Code.js': b['Code.js'].replace(
      "/^every\\s+(\\d{1,2})\\s+years?$/i.exec(String(freq || '').trim())",
      "/^Every (\\d{1,2}) Years$/.exec(String(freq || ''))"),
  }),
  'a zero cadence is accepted by the eligibility maths': b => ({
    'Code.js': b['Code.js'].replace(
      "  var n = Math.floor(Number(years));\n  if (!(n >= 1)) return null;",
      "  var n = Math.floor(Number(years));"),
  }),

  // ---- the December bug, put back ------------------------------------------
  'a multi-year perk gets a real period end (the reported bug)': b => ({
    'Code.js': b['Code.js'].replace("  if (perkCycleYears_(freq)) return null;\n", ''),
  }),
  'the checker drops the multi-year branch': b => ({
    'Code.js': b['Code.js'].replace(
      /    var cycleYears = perkCycleYears_\(freq\);\n    if \(cycleYears\) \{\n[\s\S]*?\n      return;\n    \}\n/,
      ''),
  }),
  'the multi-year branch is placed AFTER the period maths': b => ({
    'Code.js': b['Code.js'].replace(
      "    var cycleYears = perkCycleYears_(freq);\n    if (cycleYears) {",
      "    var periodKeyEarly = cardPerkPeriodKey_(freq, today, tz);\n" +
      "    var cycleYears = perkCycleYears_(freq);\n    if (cycleYears) {"),
  }),

  // ---- the anchor and the boundary -----------------------------------------
  'the stamp is a year, not a day': b => ({
    'Code.js': b['Code.js'].replace(
      "  if (perkCycleYears_(freq)) return Utilities.formatDate(date, tz, 'yyyy-MM-dd');",
      "  if (perkCycleYears_(freq)) return Utilities.formatDate(date, tz, 'yyyy');"),
  }),
  'eligibility is compared by YEAR, not by date (available 11 months early)': b => ({
    'Code.js': b['Code.js'].replace(
      "  var from = new Date(a.getFullYear() + n, a.getMonth(), a.getDate());",
      "  var from = new Date(a.getFullYear() + n, 0, 1);"),
  }),
  'the boundary is off by one (eligible a day late)': b => ({
    'Code.js': b['Code.js'].replace("    return today < from;", "    return today <= from;"),
  }),
  'a rolled-over date is accepted as an anchor': b => ({
    'Code.js': b['Code.js'].replace(
      "  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;\n", ''),
  }),
  'Feb 29 is left to slip into March': b => ({
    'Code.js': b['Code.js'].replace(
      /  if \(from\.getMonth\(\) !== a\.getMonth\(\)\) \{\n[\s\S]*?\n  \}\n/, ''),
  }),
  'an unreadable anchor hides the perk instead of showing it': b => ({
    'Code.js': b['Code.js'].replace(
      "    var from = cardPerkEligibleFrom_(lu, years);\n    if (!from) return false;",
      "    var from = cardPerkEligibleFrom_(lu, years);\n    if (!from) return true;"),
  }),
  'cardPerkIsUsed_ mutates the Date it is handed': b => ({
    'Code.js': b['Code.js'].replace(
      "    var today = new Date(now.getTime());   // never mutate the caller's Date\n    today.setHours(0, 0, 0, 0);",
      "    var today = now;\n    today.setHours(0, 0, 0, 0);"),
  }),

  // ---- the eligibility notice ----------------------------------------------
  'a perk that was never used is prompted anyway': b => ({
    'Code.js': b['Code.js'].replace(
      "  if (!anchor || !from) return 0;   // never used, unreadable stamp, or no real cadence",
      "  if (!anchor || !from) { anchor = new Date(1970, 0, 1); from = new Date(1970, 0, 1); }"),
  }),
  'the notice fires while still inside the cycle': b => ({
    'Code.js': b['Code.js'].replace(
      "  if (p.today < from) return 0;     // still inside the cycle\n", ''),
  }),
  'the notice is raised at High urgency': b => ({
    'Code.js': b['Code.js'].replace("    urgency: 'Medium',\n    key:     'perk_eligible_",
                                    "    urgency: 'High',\n    key:     'perk_eligible_"),
  }),
  'the key drops the anchor (one notice, ever)': b => ({
    'Code.js': b['Code.js'].replace("    key:     'perk_eligible_' + p.id + '_' + p.lastUsed,",
                                    "    key:     'perk_eligible_' + p.id,"),
  }),
  'the key carries today instead of the anchor (a new one nightly)': b => ({
    'Code.js': b['Code.js'].replace(
      "    key:     'perk_eligible_' + p.id + '_' + p.lastUsed,",
      "    key:     'perk_eligible_' + p.id + '_' + Utilities.formatDate(p.today, p.tz, 'yyyy-MM-dd'),"),
  }),
  'the notice is not counted in the step total': b => ({
    'Code.js': b['Code.js'].replace("      flagsGenerated += checkCardPerkEligibleAgain_({",
                                    "      checkCardPerkEligibleAgain_({"),
  }),

  // ---- marking it used -----------------------------------------------------
  'the writers compare lastUsed to the period again': b => ({
    'WebApp.js': b['WebApp.js']
      .replace("  var newUsed = r.used ? '' : r.period;",
               "  var newUsed = (r.lastUsed === r.period) ? '' : r.period;")
      .replace("  if (r.used) {", "  if (r.lastUsed === r.period) {"),
  }),
  'the "available again" notice is never closed': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      /  try \{\n    out\.eligibleResolved = resolveCardPerkEligibleFlags_\(perkId\);\n[\s\S]*?\n  \}\n  return out;/,
      '  return out;'),
  }),
  'the notice is matched on the exact anchor, which has just moved': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "  var prefix      = ('perk_eligible_' + id + '_').toLowerCase();",
      "  var prefix      = ('perk_eligible_' + id + '_' + '9999-99-99').toLowerCase();"),
  }),
  'the prefix loses its trailing underscore (CP-1 matches CP-14)': b => ({
    'WebApp.js': b['WebApp.js'].replace("  var prefix      = ('perk_eligible_' + id + '_').toLowerCase();",
                                        "  var prefix      = ('perk_eligible_' + id).toLowerCase();"),
  }),
  'the eligible sweep writes TRUE instead of \'Yes\'': b => ({
    'WebApp.js': b['WebApp.js'].replace(
      "    cell.setValue('Yes');\n    done++;\n    try { recordFlagOutcome_(key, 'resolved'); }",
      "    cell.setValue(true);\n    done++;\n    try { recordFlagOutcome_(key, 'resolved'); }"),
  }),
  'the eligible sweep also closes expiry flags': b => ({
    'WebApp.js': b['WebApp.js'].replace("  var prefix      = ('perk_eligible_' + id + '_').toLowerCase();",
                                        "  var prefix      = ('perk_').toLowerCase();"),
  }),
  'the resolver stops reporting the cycle': b => ({
    'WebApp.js': b['WebApp.js'].replace("      cycleYears:     cycleYears,\n", ''),
  }),
  'the resolver stops reporting when it comes back': b => ({
    'WebApp.js': b['WebApp.js'].replace("      eligibleFromIso:   eligible ? Utilities.formatDate(eligible, tz, 'yyyy-MM-dd') : null,",
                                        "      eligibleFromIso:   null,"),
  }),

  // ---- Chat ----------------------------------------------------------------
  'chat goes back to the hand-rolled equality test': b => ({
    'Chat.js': b['Chat.js']
      .replace("return !cardPerkIsUsed_(p.frequency || 'Monthly', p.lastUsed, now, perkTz);",
               "return p.lastUsed !== cardPerkPeriodKey_(p.frequency || 'Monthly', now, perkTz);")
      .replace("return !cardPerkIsUsed_(pk.frequency || 'Monthly', pk.lastUsed, mpNow, mpTz);",
               "return pk.lastUsed !== cardPerkPeriodKey_(pk.frequency || 'Monthly', mpNow, mpTz);"),
  }),
  'chat prints the null reset date again': b => ({
    'Chat.js': b['Chat.js'].replace(
      /              if \(mpRes\.cycleYears\) \{\n[\s\S]*?\n              \} else \{\n/,
      '              if (false) {\n              } else {\n'),
  }),

  // ---- the dashboard, all three copies -------------------------------------
  'the multi-year group is dropped (the perk goes invisible)': b => eachDoc(b, s =>
    s.replace(/'Annual',\s*'Multi-year',\s*'Standing'/, "'Annual', 'Standing'")),
  'the dashboard filters on the raw frequency again': b => eachDoc(b, s =>
    s.replace(/perkGroupOf\(p\.frequency\)\s*===\s*freq/g, 'p.frequency === freq')),
  'the browser compares eligibility by year': b => eachDoc(b, s =>
    s.replace(/let from\s*=\s*new Date\(y\s*\+\s*years,\s*mo\s*-\s*1,\s*d\);/g,
              'let from = new Date(y + years, 0, 1);')),
  'the browser loses its range branch': b => eachDoc(b, s =>
    s.replace(/const yrs\s*=\s*perkCycleYears\(perk\.frequency\);/g,
              'const yrs = 0;')),
  'the browser accepts a rolled-over anchor': b => eachDoc(b, s =>
    s.replace(/if\s*\(a\.getFullYear\(\)\s*!==\s*y[^;]*\)\s*return null;/g, '')),
  'the status line goes back to the frequency ladder': b => eachDoc(b, s =>
    s.replace(/perkStatusLabel\(pk,\s*used\)/g, "(used ? 'Used' : 'Not used')")),
  'the select no longer offers the cadence': b => eachDoc(b, s => s
    .replace(/<option>Every 4 Years<\/option>/g, '')
    .replace(/\/\*#__PURE__\*\/React\.createElement\("option",null,"Every 4 Years"\),/g, '')),
  'index.html is a stale build': b => ({
    'docs/index.html': b['docs/index.html'].replace(/Multi-year/g, 'Annual'),
  }),

  // ---- the seeds and the docs ---------------------------------------------
  'one seeded Global Entry row is still Annual': b => ({
    'Code.js': b['Code.js'].replace(
      "['CP-17', 'Capital One Venture',    'Global Entry / TSA PreCheck',                        120, 'Every 4 Years', 'Travel', '']",
      "['CP-17', 'Capital One Venture',    'Global Entry / TSA PreCheck',                        120, 'Annual', 'Travel', '']"),
  }),
  'the README never explains the distinction': b => ({
    'README.md': b['README.md'].replace(/use-anchored/g, 'periodic'),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true });
  const patch = CONTROLS[name](BASE);
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_perkmultiyear.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;

  console.log('\n=== CONTROL: ' + name);
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
