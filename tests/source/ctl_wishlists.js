// Negative controls for test_wishlists.js: revert ONE protection at a time and confirm
// the test bites. Several restore the real defect — the paragraph reader that turned
// every table cell into an "item" — and the rest guard what the new reader decides:
// columns by label, template rows dropped, the year it opens on, whose gifts flag.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_wishl');

const FILES = ['WishLists.js', 'Code.js', 'WebApp.js', 'README.md', 'docs/app.js', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

// An anchor that moved must THROW; replacements go through a function so `$` is literal.
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.replace(from, function() { return to; });
};
const WL = 'WishLists.js', LITE = 'docs/dashboard-lite.html';

const CONTROLS = {
  // ---- the real defect, restored --------------------------------------------
  'every table cell becomes its own paragraph again (the pile of words)': b => ({
    [WL]: swap(b[WL], "    } else if (type === T.TABLE) {", "    } else if (false) {"),
  }),

  // ---- reading the doc --------------------------------------------------------
  'gift columns are read by position, not label': b => ({
    [WL]: swap(b[WL], "  var cItem = wishCol_(header, /^item/);", "  var cItem = 0;"),
  }),
  'blank template rows are kept as gifts': b => ({
    [WL]: swap(b[WL], "    if (!item || /^total\\b/i.test(item)) return;", "    if (/^total\\b/i.test(item)) return;"),
  }),
  'a Total row counts as a gift': b => ({
    [WL]: swap(b[WL], "    if (!item || /^total\\b/i.test(item)) return;", "    if (!item) return;"),
  }),
  'a ticked box is not read': b => ({
    [WL]: swap(b[WL], "    var ticked = function(c) { return c.struck || ", "    var ticked = function(c) { return "),
  }),
  'struck wishes count as still wanted': b => ({
    [WL]: swap(b[WL], "{ text: text, done: !!b.struck }", "{ text: text, done: false }"),
  }),
  'a one-cell year banner isn’t seen as a year': b => ({
    [WL]: swap(b[WL], "      if (b.rows.length === 1 && b.rows[0].length === 1 && wishYearOf_(b.rows[0][0].text)) {", "      if (false) {"),
  }),

  // ---- who and what -----------------------------------------------------------
  'Config initials are ignored': b => ({
    [WL]: swap(b[WL], "    var mapped = initials[t.toUpperCase()];", "    var mapped = null;"),
  }),
  'unclaimed wishes are never marked': b => ({
    [WL]: swap(b[WL], "    w.claimed = w.done || sec.gifts.some(", "    w.claimed = true || sec.gifts.some("),
  }),
  'the year rolls over on Dec 26 instead of Jan 1': b => ({
    [WL]: swap(b[WL], "  return (today || new Date()).getFullYear();",
                     "  var t = today || new Date(); return t.getFullYear() + (t.getMonth() === 11 && t.getDate() > 25 ? 1 : 0);"),
  }),
  'an empty template year counts as started': b => ({
    [WL]: swap(b[WL], "  return !sec || (!sec.wishlist.length && !sec.gifts.length && !sec.ideas.length);", "  return !sec;"),
  }),

  // ---- flags ----------------------------------------------------------------
  'everyone’s gifts flag, not just ours': b => ({
    [WL]: swap(b[WL], "      if (!g.ours) return;\n", ''),
  }),
  'flags fire outside December': b => ({
    [WL]: swap(b[WL], "  if (m !== 12 || d > WISH_LAST_DAY_) return [];\n", ''),
  }),
  '"not wrapped" fires from Dec 1': b => ({
    [WL]: swap(b[WL], "(!g.wrapped && d >= WISH_WRAP_DAY_)", "(!g.wrapped)"),
  }),
  'closing stale flags touches other kinds of flag': b => ({
    [WL]: swap(b[WL], "    if (key.indexOf(WISH_FLAG_PREFIX_) !== 0 || dueKeys[key]) continue;", "    if (dueKeys[key]) continue;"),
  }),

  // ---- the view -------------------------------------------------------------
  'one dashboard’s view drifts from the other': b => ({
    [LITE]: swap(b[LITE], "'🎄 Christmas ' + shown", "'🎄 Xmas ' + shown"),
  }),
};

let allBit = true;
Object.keys(CONTROLS).forEach(name => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = CONTROLS[name](BASE); }
  catch (e) { console.log('\n=== CONTROL: ' + name); console.log('  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  const changed = [];
  Object.keys(files).forEach(f => {
    if (files[f] !== BASE[f]) changed.push(f);
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, files[f]);
  });

  const r = cp.spawnSync('node', ['test_wishlists.js'], {
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
