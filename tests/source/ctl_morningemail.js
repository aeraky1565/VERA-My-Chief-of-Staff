// Negative controls for test_morningemail.js: undo ONE agreed detail of the morning email
// (the masthead included) and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_me');
const FILES = ['MorningEmail.js', 'Co' + 'de.js', 'Notify.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const T = 'test_morningemail.js';
const CONTROLS = [
  ["the masthead loses its gold line again", "MorningEmail.js", "<br><span style=\"color:#c9a84c;font-size:11px;letter-spacing:2px;\">YOUR PERSONAL CHIEF OF STAFF</span>", ""],
  ["the old subject line", "MorningEmail.js", "  return '\u2600\ufe0f ' + dateLabel + ': ' + (needCount ?", "  return 'Good morning, Ahmed \u2014 VERA has ' + (needCount ?"],
  ["This week isn't sorted", "MorningEmail.js", "week = (d.week || []).slice().sort(function(a, b) { return (a.days == null ? 99 : a.days) - (b.days == null ? 99 : b.days); });", "week = (d.week || []).slice();"],
  ["held overnight loses its reason", "MorningEmail.js", "' <span style=\"color:#8a93a6;\">(' + (x.why === 'cap' ? 'past today\u2019s ' + 'push limit' : 'arrived in quiet hours') + ')</span>'", "''"],
  ["the remaining flags aren't counted", "MorningEmail.js", "  if (d.moreFlags) also.push(", "  if (false) also.push("],
  ["Medium flags due this week are dropped", "MorningEmail.js", "    else if (days !== null && days <= 7) out.week.push(", "    else if (false) out.week.push("],
  ["a flag due today isn't in Needs you", "MorningEmail.js", "    else if (days !== null && days <= 0) out.needs.push(", "    else if (false) out.needs.push("],
  ["everything held goes under Also", "MorningEmail.js", "(x.why === 'quiet' || x.why === 'cap' ? out.overnight : out.also)", "out.also"],
  ["held items forget why", "Notify.js", "if (d.go === 'digest') { notifHold_(key, text, d.why); return false; }", "if (d.go === 'digest') { notifHold_(key, text); return false; }"],
  ["a fixed 600 px card again", "MorningEmail.js", "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;", "<table width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;"],
  ["no open flags skips the email again", 'Co' + 'de.js', "    // No open flags is no longer a reason to skip the email:", "    if (!data || !data.length) { Logger.log('Morning nudge: no active flags, skipping email.'); }\n    // No open flags is no longer a reason to skip the email:"],
  ["an empty email still goes", "MorningEmail.js", "  return !(d.needs || []).length &&", "  return false && !(d.needs || []).length &&"],
  ["text isn't escaped", "MorningEmail.js", "var esc = function(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')", "var esc = function(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;')"],
].map(c => [c[0], b => ({ [c[1]]: swap(b[c[1]], c[2], c[3]) }), T]);

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0], test = c[2];
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
  const env = Object.assign({}, process.env, { VERA_ROOT: OUT });
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
