// Negative controls for test_learning.js: undo ONE rule of learning from your corrections
// and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_rl');
const FILES = ['Learning.js', 'HomePurchases.js', 'Settings.js', 'GroceryRun.js', 'Groceries.js', 'Pantry.js', 'WebApp.js', 'SignalLearning.js', 'docs/app.js', 'docs/dashboard-lite.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const T = 'test_learning.js';
const CONTROLS = [
  ["a change isn't learned", "Learning.js", "    if (d.changed) m[d.key] = rlItemStr_(", "    if (false) m[d.key] = rlItemStr_("],
  ["confirmations don't count", "Learning.js", "    else if (cur) m[d.key] = rlItemStr_({ kind: cur.kind, season: cur.season, times: cur.times + 1, at: today });", ""],
  ["a season change isn't a change", "Learning.js", " || (kind === 'home' && season !== (gp[1] || ''));", ";"],
  ["learns without a scan", "Learning.js", "    if (!key || !g) return;", "    if (!key) return; g = g || 'g|';"],
  ["the learned group isn't applied", "Learning.js", "      if (got.kind !== x.kind) { x.kind = got.kind;", "      if (false) { x.kind = got.kind;"],
  ["the learned season isn't applied", "Learning.js", "if (got.season !== guess) x.learned = true; x.season = got.season; }", "}"],
  ["no season guessed", "Learning.js", "    x.season = guess;\n", "    x.season = '';\n"],
  ["the scan isn't remembered", "Learning.js", "    c.put('RL_GUESS', JSON.stringify(g), RL_GUESS_TTL_);", ""],
  ["no cap on items", "Learning.js", "  if (keys.length > RL_MAX_ITEMS_) {", "  if (false) {"],
  ["one card is a habit", "Learning.js", "var RL_CARD_STREAK_ = 2;", "var RL_CARD_STREAK_ = 1;"],
  ["another card keeps counting", "Learning.js", "  var times = p[0] === card ? (parseInt(p[1], 10) || 1) + 1 : 1;", "  var times = (parseInt(p[1], 10) || 0) + 1;"],
  ["an old card is suggested", "Learning.js", "  if (theirCards && theirCards.length && theirCards.indexOf(p[0]) === -1) return null;\n", ""],
  ["cards aren't per person", "Learning.js", "function rlCardKey_(store, who) { return String(store || '').trim().toLowerCase().replace(/\\|/g, ' ').slice(0, 40) + '|' + String(who || '').trim(); }", "function rlCardKey_(store, who) { return String(store || '').trim().toLowerCase().replace(/\\|/g, ' ').slice(0, 40) + '|'; }"],
  ["Forget does nothing", "Learning.js", "delete m[key]; rlItemsSave_(m); }", "rlItemsSave_(m); }"],
  ["the grocery scan ignores it", "GroceryRun.js", "  if (typeof rlScanLines_ === 'function') lines = rlScanLines_(lines);", ""],
  ["the season isn't sent", "GroceryRun.js", "season: l.season || '', learned: !!l.learned, ", ""],
  ["Done shopping scan ignores it", "Pantry.js", "return typeof rlScanLines_ === 'function' ? rlScanLines_(lines) : lines;", "return lines;"],
  ["the run's card isn't noted", "Groceries.js", "    if (typeof rlNoteCard_ === 'function') rlNoteCard_(x.store, x.who, x.card);\n", ""],
  ["the learned card isn't suggested", "Groceries.js", "suggested: used || grBestCard_(", "suggested: grBestCard_("],
  ["no forget route", "WebApp.js", "      case 'learn_forget':    return jsonOut_(webLearnForget_(e));", ""],
  ["the screens ignore the learned season", "docs/app.js", "function rcSeasonFor_(x){return x&&x.season?String(x.season):rcSeasonGuess_(x&&(x.match||x.name));}", "function rcSeasonFor_(x){return rcSeasonGuess_(x&&(x.match||x.name));}"],
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
