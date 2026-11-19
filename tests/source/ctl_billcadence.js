// Negative controls for how often a bill is due (BillSchedule.js; test_billcadence.js).
// Each puts back one way a bill would be due in the wrong month, counted wrong, or ticked wrong.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_bcad');
// Every root .js: the harness reads more of them than it mutates, and they share
// one global scope.
const FILES = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js'));
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const B = 'BillSchedule.js', W = 'WebApp.js', N = 'Notify.js', RM = 'Reminders.js';
const rep = (f, a, b2) => b => { if (b[f].indexOf(a) === -1) throw new Error('anchor not found: ' + a.slice(0, 60)); return { [f]: b[f].replace(a, b2) }; };
const CONTROLS = {
  'a quarterly bill is due every month': rep(B, '    if (diff < 0 || diff % BS_CADENCE_MONTHS_[c]) return [];', '    if (diff < 0) return [];'),
  'every 2 weeks steps a week': rep(B, 'var k = Math.ceil((first - anchor) / (14 * DAY)), out = [];', 'var k = Math.ceil((first - anchor) / (7 * DAY)), out = []; DAY = DAY / 2;'),
  'the 31st isn’t clamped to the month’s end': rep(B, '  return [bsIso_(y, mo, Math.min(day, last))];', '  return [bsIso_(y, mo, day)];'),
  'every 2 weeks counts as twice a month': rep(B, 'biweekly: 26 / 12,', 'biweekly: 2,'),
  '“twice a year” isn’t understood': rep(B, "if (/^(semi-?annual(ly)?|twice a year|every (6|six) months)$/.test(t)) return 'semiannual';", "if (/^(semi-?annual(ly)?)$/.test(t)) return 'semiannual';"),
  'due this month counts bills that aren’t due': rep(B, 's + (b.dueThisMonth ? (b.amount || 0) * Math.max(1, b.dueDates.length) : 0)', 's + (b.amount || 0)'),
  'Joint through the month includes a bill not due': rep(B, " && b.amount != null && b.dueThisMonth !== false; });", " && b.amount != null; });"),
  'every 2 weeks is out once a month on the timeline': rep(B, "var daysOf = function(b) { return (b.dueDates || []).length ? b.dueDates.map(function(d) { return +d.slice(8, 10); }) : (b.dueDay ? [b.dueDay] : []); };",
    "var daysOf = function(b) { return (b.dueDates || []).length ? [+b.dueDates[0].slice(8, 10)] : (b.dueDay ? [b.dueDay] : []); };"),
  'every 2 weeks is paid when one date is': rep(B, '  return due.length > 0 && due.every(function(d) { return got.indexOf(d) !== -1; });', '  return due.some(function(d) { return got.indexOf(d) !== -1; });'),
  'old paid dates are never trimmed': rep(B, '  got = got.filter(function(d) { return d >= cutoff; }).sort();', '  got = got.sort();'),
  'a ticked date toggles every date this month': rep(B, '        var dates = date ? [String(date).slice(0, 10)] : bsDueDates_(e, month);', '        var dates = bsDueDates_(e, month);'),
  'quarterly is saved without a month': rep(B, "    if (!/^\\d{4}-\\d{2}/.test(starts)) return { ok: false, error: 'Pick when it’s next due.' };", ''),
  'every 2 weeks is saved without a date': rep(B, "    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(starts)) return { ok: false, error: 'Pick a date you paid it.' };", ''),
  'a month-style Paid is kept when it becomes every 2 weeks': rep(B, "      row[7] = (was === 'biweekly') === (cadence === 'biweekly') ? rows[i][7] || '' : '';", "      row[7] = rows[i][7] || '';"),
  'a reader sees a bill not due as due': rep(B, "  if (!days.length) return { due: false, day: null, days: [], paid: paidMonth };", "  if (!days.length) return { due: true, day: bsDay_(row[2]), days: [], paid: paidMonth };"),
  'every 2 weeks: the reader takes the first date, not the next': rep(B, '  var pick = days.filter(function(x) { return x >= (day || 0); })[0] || days[days.length - 1];', '  var pick = days[0];'),
  'the evening check-in ignores how often': rep(N, "    if (typeof bsRowDue_ === 'function' && r.length > 10) {", "    if (false) {"),
  'the bill nudge nudges a bill not due': rep(RM, '      if (!rd.due) return;\n', ''),
  'cashflow ignores the due dates': rep(W, "    if (type !== 'Income' && row.length > 10) {", "    if (false) {"),
  'every bill reads Monthly again (Accounts sets nothing aside)': rep(B, "b.cadenceLabel, b.category || ''", "'Monthly', b.category || ''"),
  'the morning email lists a bill not due': rep('Co' + 'de.js', ' if (!rdM.due) return; dueDay = rdM.day;', ' dueDay = rdM.day;'),
  'Claude isn’t told whether a bill is due this month': rep('Claude.js', "          dueThisMonth: r.length <= 10 || String(r[10] || '') !== '',\n", ''),
  'the paid toggle drops the payment date': rep(W, "bsSetPaid_(lineP, monT, null, undefined, /^\\d{4}-\\d{2}-\\d{2}$/.test(dateT) ? dateT : undefined)", "bsSetPaid_(lineP, monT, null)"),
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

  const r = cp.spawnSync('node', ['test_billcadence.js'], {
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
