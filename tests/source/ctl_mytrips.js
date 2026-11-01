// Negative controls for My Trips (issue #220): break ONE rule at a time and
// confirm test_mytrips.js (server) or test_mytrips_ui.js (both dashboards)
// catches it. Dashboard mutations change app.js and dashboard-lite.html alike,
// so the copies still match and the lite page is what has to notice.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_mt');

const MT = 'MyTrips.js', TI = 'TripIdeas.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const FILES = [MT, TI, 'Code.js', 'WebApp.js', 'Trips.js', A, L, 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const both = (b, from, to) => ({ [A]: swap(b[A], from, to), [L]: swap(b[L], from, to) });
const SRV = 'test_mytrips.js', UI = 'test_mytrips_ui.js';

const CONTROLS = [
  [SRV, 'months that passed sort with the rest', b => ({ [MT]: swap(b[MT], "    if (a.expired !== b.expired) return a.expired ? -1 : 1;\n", "") })],
  [SRV, 'pick dates 8 weeks out, not 12', b => ({ [MT]: swap(b[MT], "var MT_PICK_LEAD_DAYS_ = 84;", "var MT_PICK_LEAD_DAYS_ = 56;") })],
  [SRV, '"Potential" is not tentative', b => ({ [MT]: swap(b[MT], "|tbd|maybe|potential(ly)?|", "|tbd|maybe|") })],
  [SRV, 'a pair turned down is offered again', b => ({ [MT]: swap(b[MT], "if (end < today || (p.notSame || []).indexOf(t.tripId) !== -1) return;", "if (end < today) return;") })],
  [SRV, 'a trip already linked is offered', b => ({ [MT]: swap(b[MT], " || linkedIds[String(t.tripId).toUpperCase()]) return;", ") return;") })],
  [SRV, 'any trip in the window matches, no shared word needed', b => ({ [MT]: swap(b[MT], "      if (!want.some(function(w) { return words.indexOf(w) !== -1; })) return;\n", "") })],
  [SRV, 'a settling trip is offered as a match too', b => ({ [MT]: swap(b[MT], "    if (p.settle) return;\n    var want", "    var want") })],
  [SRV, 'the Trip Ideas board un-pulls a trip when it saves', b => ({ [TI]: swap(b[TI], "      TI_KEEP_IF_MISSING_.forEach(function(k) { if (raw[k] === undefined) idea[k] = stored[k]; });\n", "") })],
  [SRV, 'linking writes over the trip\'s own notes', b => ({ [MT]: swap(b[MT], "if (idea.mustHaves && !have.notes) p.notes", "if (idea.mustHaves) p.notes") })],
  [SRV, 'not-same is stored twice', b => ({ [MT]: swap(b[MT], "    if (idea.notSame.indexOf(t) === -1) idea.notSame.push(t);", "    idea.notSame.push(t);"),
    [TI]: swap(b[TI], ".filter(function(x, i, a) { return x && a.indexOf(x) === i; }).slice(0, 40),", ".filter(function(x) { return x; }).slice(0, 40),") })],
  [SRV, 'an expired trip stays on the strip', b => ({ [MT]: swap(b[MT], "      if (p.expired) return;\n      if (p.exact ?", "      if (p.exact ?") })],
  [SRV, 'Pulled In is never written', b => ({ [TI]: swap(b[TI], "i.pulledIn ? 'yes' : '',", "'',") })],
  [SRV, 'about 10 days is stored as 10 nights', b => ({ [MT]: swap(b[MT], "Math.max(1, days - 1), nightsMax", "days, nightsMax") })],
  [SRV, 'a leave block raises no clash', b => ({ [MT]: swap(b[MT], "    if (m.loose.length && m.other.length) out.push", "    if (false) out.push") })],
  [UI, 'Yes on a match sends not-same', b => both(b, "onYes:function(){update(m.ideaId,'link',", "onYes:function(){update(m.ideaId,'not_same',")],
  [UI, 'Download sends only the start', b => both(b, "update(p.id,'choose',{start:start,end:end,label:p.title}", "update(p.id,'choose',{start:start,label:p.title}")],
  [UI, 'an idea with no months can be pulled in', b => both(b, "disabled:none||props.busy,onClick:function(){props.onPull(i,!i.pulledIn);}", "disabled:props.busy,onClick:function(){props.onPull(i,!i.pulledIn);}")],
  [UI, 'Drop this month drops them all', b => both(b, "months:p.months.concat(p.passedMonths).filter(function(x){return x!==ym;})", "months:[]")],
  [UI, 'the clashes are not shown', b => both(b, "(props.clashes||[]).map(function(c,i){var lilac", "([]).map(function(c,i){var lilac")],
  [UI, 'a lite tentative trip is not marked', b => ({ [L]: swap(b[L], "{myTripsTentative(t.label) && <span className=\"mt-tentative-chip\"", "{false && <span className=\"mt-tentative-chip\"") })],
];

let allBit = true;
CONTROLS.forEach(function(c) {
  const test = c[0], name = c[1];
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[2](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true });
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    fs.writeFileSync(path.join(OUT, f), files[f]);
  });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', timeout: 600000,
    env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
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
