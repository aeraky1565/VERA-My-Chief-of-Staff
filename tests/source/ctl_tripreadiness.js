// Negative controls for the Trip readiness (TripReadiness.js and TsReadinessSection, issue #227 Profiles B):
// revert ONE rule at a time and confirm test_tripreadiness.js (server) or test_tripreadiness_ui.js (screen) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_tripreadiness_out');

const FILES = ['TripReadiness.js', 'TravelerProfiles.js', 'PatternRecognition.js', 'PreTripBriefing.js', 'Code.js', 'WebApp.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const A = 'docs/app.js', I = 'docs/index.html', L = 'docs/dashboard-lite.html';
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [I]: swap(b[I], from, to), [L]: swap(b[L], from, to) });
const UI = 'test_tripreadiness_ui.js', SRV = 'test_tripreadiness.js', S = 'TripReadiness.js';
const srv = (from, to) => b => ({ [S]: swap(b[S], from, to) });

const W = 'WebApp.js', P = 'PatternRecognition.js', B = 'PreTripBriefing.js';
const CONTROLS = [
  ['a visa required doesn’t block', srv("if (p.color === 'red') add('blocks'", "if (p.color === 'red') add('todo'"), SRV],
  ['partner airlines don’t count', srv("if (al && air.alliance && al === air.alliance) return 'partner';", ''), SRV],
  ['a missing member number is fine', srv("if (!have) add('todo', 'bookings', 'Member number missing on ' + name", "if (false) add('todo', 'bookings', 'Member number missing on ' + name"), SRV],
  ['someone else’s number passes', srv("else if (mem.last4 && have !== mem.last4) add('todo', 'bookings', name + ' has number", "else if (false) add('todo', 'bookings', name + ' has number"), SRV],
  ['everyone’s flights count for everyone', srv("var t = String(traveler || '').toLowerCase(), p = String(person || '').toLowerCase().split(' ')[0];\n  return !t", "var t = '', p = '';\n  return !t"), SRV],
  ['an aisle passes for a window', srv("var l = m[2], kind = /[AFKL]/.test(l) ? 'window'", "var l = m[2], kind = /[AFKLCDGH]/.test(l) ? 'window'"), SRV],
  ['lounge by status on a domestic trip', srv('if (abroad && flights.length) {', 'if (flights.length) {'), SRV],
  ['a refill after the trip is flagged', srv('rx.refillDate > o.endDate) return;', 'false) return;'), SRV],
  ['the refill is suggested even once packed', srv("if (packed.some(function(p) { return p.indexOf(med.toLowerCase()) !== -1 && /refill/.test(p); }))", 'if (false)'), SRV],
  ['blocks aren’t listed first', srv('rows.sort(function(a, b) { return rank[a.state] - rank[b.state]; });', ''), SRV],
  ['health notes are asked every time', srv("if (String(rows[i][0]) === key) { try {", "if (false) { try {"), SRV],
  ['a failed health call saves something', srv("if (!r || !r.json) return null;", "if (!r) return null;"), SRV],
  ['the packing add can repeat', srv("if (have) return { ok: true, already: true };", ''), SRV],
  ['the briefing lists ready rows too', srv("p.rows.filter(function(r) { return r.state !== 'ready'; })", 'p.rows'), SRV],
  ['the briefing has no READINESS section', b => ({ [B]: swap(b[B], 'packSection, readinessSection, actionSection', 'packSection, actionSection') }), SRV],
  ['the Rx flag reads the wrong fields again', b => ({ [P]: swap(b[P], "var urgency = rx.daysLeft <= 3 ? 'High' : 'Medium';", "var urgency = rx.daysUntil <= 3 ? 'High' : 'Medium';") }), SRV],
  ['the summary drops Readiness', both("h(TsReadinessSection,{trip:trip,apiUrl:props.apiUrl,apiToken:props.apiToken,readiness:props.readiness,card:card,label:label}),\n", '')],
  ['an empty answer shows an empty card', both("  if(!tsReadinessHas_(d))return null;\n  return h('section'", "  return h('section'")],
  ['Add to packing sends nothing', both("{action:'trip_readiness_pack',tripKey:trip.tripKey,person:a.person,item:a.item}", "{action:'nothing'}")],
  ['the doctor line is gone', both("'Check with your doctor or a travel clinic before you go.'", "''")],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
const ONLY = process.env.CTL_ONLY;
CONTROLS.forEach(function(c) {
  if (ONLY && c[0] !== ONLY) return;
  const name = c[0];
  if (!HAS_BROWSER && (c[2] || UI) === UI) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const r = cp.spawnSync('node', [c[2] || UI], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').trim().split('  — ')[0]);
  const crashed = r.status !== 0 && fails.length === 0;
  console.log('\n=== CONTROL: ' + name + '  (' + (c[2] || UI) + ')');
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
