// Negative controls for test_ariarebook.js (ARIA price drop after booking, #250): break ONE rule
// at a time and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_ariarebook_out');
const FILES = ['Aria.js', 'Code.js', 'docs/guides/aria-rebook-check.md'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const ar = (from, to) => b => ({ 'Aria.js': swap(b['Aria.js'], from, to) });

const CONTROLS = [
  ['the hotel counts as flights', ar("if (!/^flights?$/i.test(String(b.category || '').trim())) return;", '')],
  ['paid isn’t split by travelers', ar('return total > 0 ? Math.round(total / n) : null;', 'return total > 0 ? Math.round(total) : null;')],
  ['a blank actual sends a paid amount', ar('return total > 0 ? Math.round(total / n) : null;', 'return Math.round(total / n);')],
  ['Paid Per Person isn’t written to the row', ar('v(r.paidPP), v(r.repriceUntil)];', "'', ''];")],
  ['any fare counts, not just rebook', ar("if (String(f.role || '').trim().toLowerCase() !== 'rebook') return;", '')],
  ['a trip that has left still posts', ar("&& r.repriceUntil && today <= r.repriceUntil) byTrip", '&& r.repriceUntil) byTrip')],
  ['a trip still watched counts', ar("if (r.kind === 'watch' && r.status === 'booked' && r.tripId && r.paidPP", "if (r.kind === 'watch' && r.tripId && r.paidPP")],
  ['old fares post', ar("if (!r || !f.dateSeen || f.dateSeen < yesterday) return;", 'if (!r) return;')],
  ['no minimum saving', ar('if (price == null || !(r.paidPP - price >= min)) return;', 'if (price == null || !(r.paidPP - price > 0)) return;')],
  ['the first fare, not the lowest', ar('if (!best[id] || price < best[id].now) best[id]', 'if (!best[id]) best[id]')],
  ['the same low posts again', ar(".filter(function(b) { return (posted || []).indexOf(b.key) === -1; });\n}\n\n/** Pure: the #vera-act-now post", ".filter(function(b) { return true; });\n}\n\n/** Pure: the #vera-act-now post")],
  ['the post forgets the total saving', ar("' each, ' + money(p.save * p.travelers) + ' for ' + p.travelers + '.'", "' each.'")],
  ['no change-rules line', ar("\\nCheck your airline’s change or credit rules before you rebook.", '')],
  ['the minimum isn’t a setting', ar('var min = parseFloat(cfg.aria_rebook_min_saving); min = min > 0 ? min : 50;', 'var min = 50;')],
  ['Off still sends', ar("if (typeof notifDelivery_ === 'function' && notifDelivery_('aria_price_drop') === 'off') return 0;", '')],
  ['past the cap it still posts', ar("|| (typeof actNowAllowed_ === 'function' && !actNowAllowed_('aria'))) {", ') {')],
  ['Away never holds it', ar("if (typeof awayHolds_ === 'function' && awayHolds_('aria_price_drop', p.until)) return;", '')],
  ['the sync doesn’t post drops', ar("  try { ariaPostPriceDrops_(t.fares, ariaReadRequests_(), new Date()); }", '  try { 0; }')],
  ['paid is written for trips that have left', ar("if (!t || !t.startDate || t.startDate < today) return;", 'if (!t || !t.startDate) return;')],
];

let allBit = true;
CONTROLS.forEach(function(c) {
  if (process.env.CTL_ONLY && c[0] !== process.env.CTL_ONLY) return;
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + c[0] + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  const r = cp.spawnSync('node', ['test_ariarebook.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).map(s => s.replace(/^  FAIL /, '').split('  — ')[0]);
  console.log('\n=== CONTROL: ' + c[0]);
  if (r.status !== 0 && !fails.length) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit: ' + fails[0]);
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
