// Negative controls for share or export (TripShare.js, itinerary redesign stage
// 5): revert ONE rule at a time and confirm test_tripshare.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tshare');

const FILES = ['TripShare.js', 'WebApp.js', 'docs/app.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const T = 'TripShare.js', W = 'WebApp.js';
const TEST = 'test_tripshare.js';

const CONTROLS = [
  ['another trip\'s rows go out', b => ({ [T]: swap(b[T], "if (!String(r[0]).trim() || !tripKeyMatches_(r[1], tripKey)) return;", "if (!String(r[0]).trim()) return;") })],
  ['whose plans is ignored', b => ({ [T]: swap(b[T], "    if (who !== 'Both' && tv !== 'Both' && tv !== who) return false;\n", '') })],
  ['every option of a choice goes out', b => ({ [T]: swap(b[T], "    if (m.optionGroup && m.isRepresentative !== true) return false;\n", '') })],
  ['undecided choices go out by default', b => ({ [T]: swap(b[T], "    if (m.tentative === true && m.decisionStatus !== 'decided' && !opts.notes) return false;\n", '') })],
  ['confirmation numbers go out by default', b => ({ [T]: swap(b[T], "confirmations: flag(inc.confirmations !== undefined ? inc.confirmations : p.conf, false),", "confirmations: flag(inc.confirmations !== undefined ? inc.confirmations : p.conf, true),") })],
  ['the HTML does not escape', b => ({ [T]: swap(b[T], "return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')", "return String(s == null ? '' : s).replace(/&/g, '&amp;')") })],
  ['an overnight flight lands the same day', b => ({ [T]: swap(b[T], "      var endDate = it.endTime && it.endTime < it.startTime ? shareAddDays_(it.date, 1) : it.date;\n      L.push(", "      var endDate = it.date;\n      L.push(") })],
  ['times lose their time zone', b => ({ [T]: swap(b[T], "L.push('DTSTART' + (tzS ? ';TZID=' + tzS : '')", "L.push('DTSTART' + ''") })],
  ['ics text is not escaped', b => ({ [T]: swap(b[T], ".replace(/,/g, '\\\\,')", "") })],
  ['long ics lines are not folded', b => ({ [T]: swap(b[T], "return L.map(fold).join('\\r\\n')", "return L.join('\\r\\n')") })],
  ['a bad address is let through', b => ({ [T]: swap(b[T], "  if (bad.length) return { error:", "  if (false) return { error:") })],
  ['no copy to you', b => ({ [T]: swap(b[T], "if (me && rcp.list.indexOf(me) === -1) options.bcc = me;", '') })],
  ['the attachment ignores its switch', b => ({ [T]: swap(b[T], "var attach = body.attachIcs !== false && body.attachIcs !== 'false';", 'var attach = true;') })],
  ['the email route is missing', b => ({ [W]: swap(b[W], "      case 'trip_share_email':           return jsonOut_(webTripShareEmail_(body));\n", '') })],
  ['the sheet reads cities its own way', b => ({ [T]: swap(b[T], "  if (parts.length >= 3 && !/\\d/.test(parts[parts.length - 1]) && parts[parts.length - 1].length > 2) parts.pop();\n", '') })],
];

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
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
  const r = cp.spawnSync('node', [TEST], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + TEST + ')');
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
