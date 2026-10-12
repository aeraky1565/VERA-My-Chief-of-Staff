// Negative controls: revert ONE behaviour at a time and confirm the test bites.
//
// The ones that matter most restore a permissive default — money printed by
// concatenation, or the Type column ignored — because those are the failures that
// reach the inbox. "$-310" shipped and was read every morning; a paycheck announced as
// DUE TODAY would have too.
//
// The Income filter gets one control PER SURFACE on purpose. All four sites read the
// same sheet and none of them shared a code path, which is exactly how one of them
// could be fixed and the other three left announcing payday as a bill.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_bill');
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

// An anchor that has moved must THROW, not quietly leave the file unchanged.
//
// The replacement goes through a FUNCTION, not a string. String.replace expands `$` in
// a string replacement — `$'` means "everything after the match", `$&` the match itself
// — and these controls restore money formatting, so their replacements are full of
// `' ($' + …` and `'-$'`. Passed as a string, `' ($' + Number(r[1])` had its `$'`
// substituted and wrote a syntactically broken Code.js, which the runner reported as a
// crash rather than as the control biting. A function replacement is taken literally.
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 60));
  return src.replace(from, function() { return to; });
};

const CONTROLS = {
  // ---- the formatter -------------------------------------------------------
  'money goes back to string concatenation': b => ({
    'Code.js': swap(b['Code.js'],
      "        var money  = fmtMoney_(r[1]);\n        var amtStr = money ? ' (' + money + ')' : '';",
      "        var amtStr = r[1] !== '' ? ' ($' + Number(r[1]) + ')' : '';"),
  }),
  'the formatter drops the sign, like fmtCurrency_': b => ({
    'Finance.js': swap(b['Finance.js'],
      "  return (v < 0 ? '-$' : '$') +", "  return '$' +"),
  }),
  'the formatter drops the decimals': b => ({
    'Finance.js': swap(b['Finance.js'],
      "    Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });",
      "    Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });"),
  }),
  'a blank amount becomes $0.00 instead of nothing': b => ({
    'Finance.js': swap(b['Finance.js'],
      "  if (n === '' || n === null || n === undefined) return '';", '  ;'),
  }),
  'text renders as $NaN': b => ({
    'Finance.js': swap(b['Finance.js'], '  if (!isFinite(v)) return \'\';', '  ;'),
  }),

  // ---- the Type column, one control per surface ----------------------------
  'the morning email ignores Type again': b => ({
    'Code.js': swap(b['Code.js'], '        if (isIncomeBillRow_(r[8])) return;', '        ;'),
  }),
  'the bill nudge ignores Type again': b => ({
    'Reminders.js': swap(b['Reminders.js'], '    if (isIncomeBillRow_(row[8])) return;', '    ;'),
  }),
  'chat notices ignore Type again': b => ({
    'Chat.js': swap(b['Chat.js'], '        if (b.isIncome) return;', '        ;'),
  }),
  'Claude stops being told which rows are income': b => ({
    'Claude.js': swap(b['Claude.js'], "          if (b.isIncome) line += ' [INCOME]';", '          ;'),
  }),
  'the predicate treats everything as income': b => ({
    'Finance.js': swap(b['Finance.js'],
      "  return String(typeCell == null ? '' : typeCell).trim().toLowerCase() === 'income';",
      '  return true;'),
  }),
  'blank Type counts as income, so untyped bills vanish': b => ({
    'Finance.js': swap(b['Finance.js'],
      "  return String(typeCell == null ? '' : typeCell).trim().toLowerCase() === 'income';",
      "  return String(typeCell == null ? '' : typeCell).trim().toLowerCase() !== 'expense';"),
  }),

  // ---- the row numbers Claude writes back to -------------------------------
  // Each of these is a write to the wrong row of a different tab.
  'bill row numbers are indexed after the filter again': b => ({
    'Chat.js': swap(b['Chat.js'],
      '      bills = billData.map(function(r, i) { return { r: r, rowNum: i + 2 }; })\n' +
      "        .filter(function(x) { return String(x.r[0]).trim(); }).map(function(x) {\n" +
      '        var r = x.r;\n        return {\n          row:       x.rowNum,',
      "      bills = billData.filter(function(r) { return String(r[0]).trim(); }).map(function(r, idx) {\n" +
      '        return {\n          row:       idx + 2,'),
  }),
  'idea row numbers are indexed after the filter again': b => ({
    'Chat.js': swap(b['Chat.js'],
      '      ideas = ideaData.map(function(r, i) { return { r: r, rowNum: i + 2 }; })\n' +
      "        .filter(function(x) { return String(x.r[0]).trim(); }).map(function(x) {\n" +
      '        var r = x.r;\n        return { row: x.rowNum,',
      "      ideas = ideaData.filter(function(r) { return String(r[0]).trim(); }).map(function(r, idx) {\n" +
      '        return { row: idx + 2,'),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });

  const r = cp.spawnSync('node', ['test_bills.js'], {
    cwd: __dirname, encoding: 'utf8',
    env: Object.assign({}, process.env, { VERA_ROOT: OUT }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
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
