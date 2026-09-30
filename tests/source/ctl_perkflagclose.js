// Negative controls: revert ONE behaviour at a time and confirm the test bites.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_pfc');
const FILES = ['Code.js', 'WebApp.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const CONTROLS = {
  'the whole pass is gone (today\'s behaviour: flags never close)': b => ({
    'Code.js': b['Code.js'].replace(
      /    try \{ closeExpiredPerkFlags_\(\); \} catch \(cpcErr\) \{[^\n]*\n/, ''),
  }),
  'it writes TRUE instead of \'Yes\'': b => ({
    'Code.js': b['Code.js'].replace(
      "    sheet.getRange(i + 2, resolvedCol).setValue('Yes');",
      '    sheet.getRange(i + 2, resolvedCol).setValue(true);'),
  }),
  "the outcome is recorded as 'resolved'": b => ({
    'Code.js': b['Code.js'].replace("recordFlagOutcome_(key, 'expired');",
                                    "recordFlagOutcome_(key, 'resolved');"),
  }),
  'off-by-one on the boundary (closes a day early)': b => ({
    'Code.js': b['Code.js'].replace('    if (end >= today) continue;', '    if (end > today) continue;'),
  }),
  'today is not floored to midnight': b => ({
    'Code.js': b['Code.js'].replace(
      "  var today       = new Date();\n  today.setHours(0, 0, 0, 0);",
      '  var today       = new Date();'),
  }),
  'a null period end is treated as expired': b => ({
    'Code.js': b['Code.js'].replace(
      '    if (!end) continue;                  // unparseable or standing — leave it alone\n', ''),
  }),
  "'standing' is given a real end": b => ({
    'Code.js': b['Code.js'].replace(
      "  if (!k || k.toLowerCase() === 'standing') return null;",
      "  if (!k) return null;\n  if (k.toLowerCase() === 'standing') return lastDayOf(2000, 12);"),
  }),
  'already-resolved rows are rewritten': b => ({
    'Code.js': b['Code.js'].replace(
      "    if (String(res[i][0] || '').trim().toLowerCase() === 'yes') continue;\n", ''),
  }),
  'the period key is taken by splitting on _ (first field)': b => ({
    'Code.js': b['Code.js'].replace(
      "    var periodKey = key.substring(key.lastIndexOf('_') + 1);",
      "    var periodKey = key.split('_')[2];"),
  }),
  'every flag key is swept, not just perk ones': b => ({
    'Code.js': b['Code.js'].replace(
      "    if (!key || key.toLowerCase().indexOf('perk_expiry_') !== 0) continue;",
      '    if (!key) continue;'),
  }),
  'quarters end one month early': b => ({
    'Code.js': b['Code.js'].replace(
      "  if ((m = /^(\\d{4})-Q([1-4])$/.exec(k)))   return lastDayOf(+m[1], +m[2] * 3);",
      "  if ((m = /^(\\d{4})-Q([1-4])$/.exec(k)))   return lastDayOf(+m[1], +m[2] * 3 - 1);"),
  }),
  'H1 ends in December too': b => ({
    'Code.js': b['Code.js'].replace(
      "  if ((m = /^(\\d{4})-H([12])$/.exec(k)))    return lastDayOf(+m[1], m[2] === '1' ? 6 : 12);",
      "  if ((m = /^(\\d{4})-H([12])$/.exec(k)))    return lastDayOf(+m[1], 12);"),
  }),
  'an out-of-range month is accepted': b => ({
    'Code.js': b['Code.js'].replace(
      '    if (mo >= 1 && mo <= 12) return lastDayOf(+m[1], mo);',
      '    return lastDayOf(+m[1], mo);'),
  }),
  'the signal hook is not guarded (one failure aborts the sweep)': b => ({
    'Code.js': b['Code.js'].replace(
      /    try \{\n      recordFlagOutcome_\(key, 'expired'\);\n    \} catch \(slErr\) \{\n[^\n]*\n    \}/,
      "    recordFlagOutcome_(key, 'expired');"),
  }),
  'the pass runs AFTER the checker': b => {
    const s = b['Code.js'];
    const close = /    try \{ closeExpiredPerkFlags_\(\); \} catch \(cpcErr\) \{[^\n]*\n/.exec(s)[0];
    const check = /    try \{ checkCardPerksExpiring_\(\); \} catch \(cpeErr\) \{[^\n]*\n/.exec(s)[0];
    return { 'Code.js': s.replace(close + check, check + close) };
  },
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const patch = CONTROLS[name](BASE);
  const files = Object.assign({}, BASE, patch);
  let changed = false;
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed = true;
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_perkflagclose.js'], {
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
  fails.slice(0, 4).forEach(f => console.log('    - ' + f));
  if (fails.length > 4) console.log('    … and ' + (fails.length - 4) + ' more');
});

fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
