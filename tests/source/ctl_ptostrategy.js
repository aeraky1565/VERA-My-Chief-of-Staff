// Negative controls for #248: revert ONE rule at a time and confirm test_ptostrategy.js (or the
// browser test, test_ptostrategy_ui.js) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_ptostrategy');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const S = 'PTOStrategy.js', NODE = 'test_ptostrategy.js', UI = 'test_ptostrategy_ui.js';
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to), 'docs/dashboard-lite.html': swap(b['docs/dashboard-lite.html'], from, to) });
const CONTROLS = [
  ['Saturday holidays not moved to Friday', one(S, "return w === 6 ? ptsAdd_(iso, -1) : w === 0 ? ptsAdd_(iso, 1) : iso;", "return w === 0 ? ptsAdd_(iso, 1) : iso;"), NODE],
  ['a break can start a day early for free', one(S, "    if (allOff(ptsAdd_(s, -1))) continue;                  // could start a day earlier for free\n", ''), NODE],
  ['breaks over a locked trip', one(S, "if (ptsInRanges_(s, e, p.busy) || ptsInRanges_(s, e, p.blackouts)) { ok = false; break; }", "if (ptsInRanges_(s, e, p.blackouts)) { ok = false; break; }"), NODE],
  ['no maxPto', one(S, "        if (days.length > maxPto) { ok = false; break; }\n", ''), NODE],
  ['January PTO counted in this year', one(S, "          if (d.slice(0, 4) !== year) { ok = false; break; }   // PTO next January belongs to next year's plan\n", ''), NODE],
  ['joint cost is the cheaper person', one(S, "pto[p.id] = days; any += days.length; worst = Math.max(worst, days.length);", "pto[p.id] = days; any += days.length; worst = worst ? Math.min(worst, days.length) : days.length;"), NODE],
  ['the buffer is spent', one(S, "    left[p.id] = total - (b.booked || 0) - reserved - buffer - keep;", "    left[p.id] = total - (b.booked || 0) - reserved - keep;"), NODE],
  ['pencilled trips not held', one(S, "    reserves.push(r);\n", ''), NODE],
  ['accepted breaks dropped', one(S, "    spend(c); chosen.push(c); ids[id] = true;\n    membersOf(c)", "    ids[id] = true;\n    membersOf(c)"), NODE],
  ['skipped breaks shown', one(S, "  if (st.skips === 'hidden') ordered = ordered.filter", "  if (false) ordered = ordered.filter"), NODE],
  ['no top-up (personal time and accruals lost)', one(S, "  if (st.mode !== 'all') people.forEach(function(p) {\n    var need = roll(p), guard = 0;", "  if (false) people.forEach(function(p) {\n    var need = roll(p), guard = 0;"), NODE],
  ['accruals never lost (no cap)', one(S, "    var l = Math.max(0, Math.min(a, before + a - cap));", "    var l = 0;"), NODE],
  ['personal time on the earliest days', one(S, "      var vacDates = dates.slice(0, Math.max(0, dates.length - personalUsed));", "      var vacDates = dates.slice(personalUsed);"), NODE],
  ['next January’s accrual ignored', one(S, "      b.lostNextJan = b.capCarry == null ? 0 : Math.max(0, b.rollsOver - b.capCarry);", "      b.lostNextJan = 0;"), NODE],
  ['a blank buffer becomes zero', one(S, "  var num = function(v, lo, hi) { if (v === '' || v === null || v === undefined) return null;", "  var num = function(v, lo, hi) {"), NODE],
  ['request flags ignore the long lead', one(S, "var lead = (days.length >= 5 ? st.leadWeeksLong : st.leadWeeks) * 7", "var lead = st.leadWeeks * 7"), NODE],
  ['request flags stay once it’s on the work calendar', one(S, "if (today < by || today > first || !pending(c, pid)) return;", "if (today < by || today > first) return;"), NODE],
  ['plan announced before the trigger', one(S, "  if (today >= t) return true;", "  return true;"), NODE],
  ['Accept twice makes two events', one(S, "    if (saved[id] && saved[id].status === 'accepted') return { ok: true, id: id, already: true };\n", ''), NODE],
  ['no Away mode on the day', one(S, "if (s.status === 'accepted' && s.away && s.start === today && typeof awaySet_ === 'function')", "if (false)"), NODE],
  ['an accepted break can be skipped', one(S, "    if (saved[id] && saved[id].status === 'accepted') return { ok: false, error: 'Remove it first; it’s accepted' };\n", ''), NODE],
  ['picks by value, not date', one(S, "  var picks = chosen.slice().sort(function(a, b) { return a.start < b.start ? -1 : 1; });", "  var picks = chosen.slice().sort(ptsRank_);"), NODE],
  ['the Victoria pill shows his breaks too', ui("function psShows_(c,f){return !f||f==='all'||c.who===f||(f!=='joint'&&c.who==='joint');}", "function psShows_(c,f){return true;}"), UI],
  ['the take-by steps never ticked', ui("(t.met?'✓ ':'✗ ')", "('✗ ')"), UI],
  ['Advanced sends every field', ui("var o={};Object.keys(dirty).forEach(function(k){", "var o={minRatio:st.minRatio};Object.keys(dirty).forEach(function(k){"), UI],
  ['lite shows Skip', ui("!compact&&h('button',{className:'ps-skip'", "h('button',{className:'ps-skip'"), UI],
  ['an accepted break has no request date', ui("h('div',null,'🏢 Request it at work by ',h('b',null,psNice_(psRequestBy_(c,st)))", "h('div',null,'🏢 Request it at work'"), UI],
];
let allBit = true;
// The dashboard controls drive a real browser. The CI job that runs controls has none (the
// browser job runs the screens themselves), so there they are skipped and said so; locally they run.
const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();
CONTROLS.forEach(([name, mut, test]) => {
  if (test === UI && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = mut(BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  fs.readdirSync(path.join(SRC_DIR, 'docs')).forEach(f => { const s = path.join(SRC_DIR, 'docs', f), d = path.join(OUT, 'docs', f); if (!fs.existsSync(d) && fs.statSync(s).isFile()) fs.copyFileSync(s, d); });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', timeout: 900000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_CTL_FAST: '1' }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = (out.match(/^  FAIL .*$/gm) || []).length;
  console.log('\n=== CONTROL: ' + name + '  (' + test + ')');
  if (r.status !== 0 && !fails) { console.log('  !! CRASHED'); console.log(out.split('\n').slice(-6).join('\n')); allBit = false; return; }
  if (!fails) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
