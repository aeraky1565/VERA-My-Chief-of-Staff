// Negative controls for Signal Learning (#260): revert one rule at a time and confirm
// test_signallearning.js catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const SRC = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'ctl_sl');
const FILES = ['SignalLearning.js', 'WebApp.js', 'Code.js', 'Memory.js', 'docs/app.js', 'docs/index.html'];
const BASE = {}; FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.replace(from, () => to); };
const one = f => (from, to) => b => { const o = {}; o[f] = swap(b[f], from, to); return o; };
const sl = one('SignalLearning.js');
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const UI = true;
const CONTROLS = [
  ['keys aren’t normalised first', sl("var t = String(flagKey).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');", "var t = String(flagKey).toLowerCase();")],
  ['every word kept', sl("return t.split('_').filter(Boolean).slice(0, 2).join('_');", "return t.split('_').filter(Boolean).join('_');")],
  ['ignoring teaches nothing', sl("            - SL_DRIFT_ * Math.max(0, since - SL_GRACE_);", "            - 0;")],
  ['no grace', sl("Math.max(0, since - SL_GRACE_)", "Math.max(0, since)")],
  ['Kept is ignored', sl("var state = kept && kept >= today ? 'Kept'", "var state = false ? 'Kept'")],
  ['Quiet is hard suppression again', sl("var isSuppressed = String(row[SL_COL.SUPPRESSED] || '').toLowerCase() === 'yes';", "var isSuppressed = /^(yes|quiet)$/i.test(String(row[SL_COL.SUPPRESSED] || ''));")],
  ['a snooze resets like an acknowledge', sl("outcome === 'snoozed' ? Math.floor(since / 2) : 0", "0")],
  ['an expiry counts as acting', sl("    if (outcome !== 'expired') {\n", "    if (true) {\n")],
  ['generation doesn’t count the night', sl("slSinceActed_(cur) + 1);", "slSinceActed_(cur));")],
  ['the regroup writes on a dry run', sl("var p = (e && e.parameter) || {}, dry = String(p.dry) !== 'false';", "var p = (e && e.parameter) || {}, dry = false;")],
  ['Keep doesn’t last', sl("SL_KEEP_DAYS_ * 86400000", "0")],
  ['Flags doesn’t mark quiet kinds', one('WebApp.js')("if (slIsQuietKey_(f.key, quiet)) { f.vq = true;", "if (false) { f.vq = true;")],
  ['the email sends quiet kinds', one('Code.js')(" && !(vqPatterns.length && slIsQuietKey_(String(row[9] || ''), vqPatterns));", ";")],
  ['quiet flags stay in the groups', ui("flagGroups_((flags||[]).filter(function(f){return !f.vq;}),today,area,urg)", "flagGroups_(flags||[],today,area,urg)"), UI],
  ['Keep showing does nothing', ui("apiGet(apiUrl,apiToken,{action:'signal_keep',pattern:p})", "Promise.resolve({ok:true})"), UI],
];
const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
let allBit = true;
CONTROLS.forEach(c => {
  const name = c[0];
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch; try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + name + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch), changed = [];
  Object.keys(files).forEach(f => { if (files[f] !== BASE[f]) changed.push(f); const d = path.join(OUT, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, files[f]); });
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => { try { fs.copyFileSync(path.join(SRC, f), path.join(OUT, f)); } catch (e) {} });
  const r = cp.spawnSync('node', ['test_signallearning.js'], { cwd: __dirname, encoding: 'utf8', timeout: 240000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
  const out = (r.stdout || '') + (r.stderr || ''), fails = (out.match(/^  FAIL .*$/gm) || []);
  console.log('\n=== CONTROL: ' + name);
  if (!changed.length) { console.log('  !! MUTATION DID NOT APPLY'); allBit = false; return; }
  if (r.status !== 0 && !fails.length) { console.log('  !! CRASHED with no clean assertion failure'); console.log(out.split('\n').slice(-5).join('\n')); allBit = false; return; }
  if (!fails.length) { console.log('  !! NOTHING BIT'); allBit = false; return; }
  console.log('  ' + fails.length + ' bit');
});
fs.rmSync(OUT, { recursive: true, force: true });
console.log('\n' + (allBit ? 'ALL CONTROLS BIT' : 'SOME CONTROLS DID NOT BITE'));
process.exit(allBit ? 0 : 1);
