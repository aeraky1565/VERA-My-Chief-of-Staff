// Negative controls for #258 Quiet flags (FlagQuiet.js and its wiring): revert ONE rule at a
// time and confirm test_flagquiet.js (server) or test_flagstasks_ui.js (dashboard) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_flagquiet');
const FILES = ['FlagQuiet.js', 'FlagsTasks.js', 'Code.js', 'WebApp.js', 'Claude.js', 'NightlyRunner.js', 'docs/app.js', 'docs/index.html'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const fq = (from, to) => one('FlagQuiet.js', from, to);
const NODE = 'test_flagquiet.js', UI = 'test_flagstasks_ui.js';
const CONTROLS = [
  ['everyday words count as a topic', fq("    if (w.length < 4 || FQ_STOP_[w] || seen[w]) return;", "    if (w.length < 4 || seen[w]) return;"), NODE],
  ['possessives kept', fq(".replace(/[’']s\\b/g, '')", ""), NODE],
  ['common words count as telling', fq("var max = fqRareMax_(n), rare = function(w) { return ((df || {})[w] || 0) <= max; };", "var max = fqRareMax_(n), rare = function(w) { return true; };"), NODE],
  ['one shared word is the same topic', fq("  if (common.length < 2) return false;", "  if (common.length < 1) return false;"), NODE],
  ['a shared word needn’t be in a title', fq("  if (inBoth) return true;\n  return common.length >= 3 && common.some", "  if (inBoth || common.length >= 2) return true;\n  return common.length >= 3 && common.some"), NODE],
  ['the Due is ignored', fq("  if (ok(due)) return due;\n", ""), NODE],
  ['a far date in the words counts', fq("    .filter(function(d) { return ok(d) && d <= near; }).sort();", "    .filter(function(d) { return ok(d); }).sort();"), NODE],
  ['no date: 2 days, not 7', fq("var FQ_DAYS_ = 7;", "var FQ_DAYS_ = 2;"), NODE],
  ['quiet ends a day early', fq("  return u === FQ_NEVER_ || (u !== '' && u >= todayIso);", "  return u === FQ_NEVER_ || (u !== '' && u > todayIso);"), NODE],
  ['a mute ends', fq("  return u === FQ_NEVER_ || (u !== '' && u >= todayIso);", "  return u !== FQ_NEVER_ && u !== '' && u >= todayIso;"), NODE],
  ['changed overrides a mute', fq("    var mute = quiet.filter(function(q) { return q.kind === 'muted' && fqSame_(t, q.topic); })[0];", "    var mute = String(c.changed || '').trim() ? null : quiet.filter(function(q) { return q.kind === 'muted' && fqSame_(t, q.topic); })[0];"), NODE],
  ['changed ignored: a real change stays held', fq("    if (!why && !String(c.changed || '').trim()) {", "    if (!why) {"), NODE],
  ['open flags don’t hold', fq("      var hit = open.filter(function(x) { return fqSame_(t, x.t); })[0];", "      var hit = null;"), NODE],
  ['two of a topic in one night', fq("    open.push({ o: { flag: k.flag, reason: k.reason, date: today, auto: false }, t: t });   // one per topic in a night\n", ""), NODE],
  ['the reason doesn’t say what changed', fq("    if (ch && String(k.reason || '').indexOf('What changed:') !== 0) k.reason = 'What changed: ' + ch + '. ' + (k.reason || '');\n", ""), NODE],
  ['the prompt lists VERA’s own checks', fq("    if (typeof flagAutoOf_ === 'function' && flagAutoOf_(key)) return;   // VERA's own checks: listed below as covered\n", ""), NODE],
  ['muted topics left out of the prompt', fq("    if (q.kind === 'muted' && !lines.some", "    if (false && !lines.some"), NODE],
  ['the prompt doesn’t carry the block', one('Claude.js', "(typeof fqPromptBlock_ === 'function' ? fqPromptBlock_() : '') +", "'' +"), NODE],
  ['resolving twice adds two rows', fq("  fqRows_().filter(function(q) { return q.id && q.id === id; }).map(function(q) { return q.row; })\n    .sort(function(a, b) { return b - a; }).forEach(function(r) { sh.deleteRow(r); });\n", ""), NODE],
  ['Resolve doesn’t remember the topic', one('WebApp.js', "  try { quietUntil = fqRemember_(row, 'resolved'); }", "  try { quietUntil = ''; }"), NODE],
  ['an automatic flag reopens while quiet', one('Code.js', "      if (resolved && quietKey(key)) continue;\n", ""), NODE],
  ['the quiet never ends when the check stops', one('Code.js', "      settled.push(key);   // its check no longer raises it: the situation changed\n", ""), NODE],
  ['a stop ends a mute too', fq("  var gone = fqRows_().filter(function(q) { return q.kind !== 'muted' && set[q.key]; })", "  var gone = fqRows_().filter(function(q) { return set[q.key]; })"), NODE],
  ['the night writes everything', one('NightlyRunner.js', "var kept = flagHoldBackRun_(flags);", "var kept = flags;"), NODE],
  ['the held list isn’t kept', fq("    veraStoreSet_(FQ_HELD_KEY_, JSON.stringify({ on: today, items: out.held.slice(0, 20) }));\n", ""), NODE],
  ['a raised flag stays on the list', fq("  held.items.splice(n, 1);\n", ""), NODE],
  ['a raised flag is blocked by the similar-key check', one('Code.js', "if (flag.key && !flag.changed && keysAreSimilar_(flag.key, existing)) {", "if (flag.key && keysAreSimilar_(flag.key, existing)) {"), NODE],
  ['unmute removes nothing', fq("  rows.map(function(q) { return q.row; }).sort(function(a, b) { return b - a; }).forEach(function(r) { sh.deleteRow(r); });\n  _fqRows_ = null;\n  return { ok: true, id: id, action: 'unmuted' };", "  return { ok: true, id: id, action: 'unmuted' };"), NODE],
  // the screen
  ['mute without asking', ui("onClick:function(){setMuting(!muting);}},\"🔕 Don’t raise this again\")", "onClick:function(){onAction('flag_mute',flag.id);}},\"🔕 Don’t raise this again\")"), UI],
  ['Mute it does nothing', ui("onClick:function(){setMuting(false);onAction('flag_mute',flag.id);}},\"Mute it\")", "onClick:function(){setMuting(false);}},\"Mute it\")"), UI],
  ['no held-back list', ui("    held.length>0&&h(\"details\",{className:\"fq-held\"", "    false&&h(\"details\",{className:\"fq-held\""), UI],
  ['Raise it sends nothing', ui("act('flag_raise_held',{i:x.i}", "act('noop',{i:x.i}"), UI],
  ['no muted list', ui("    muted.length>0&&h(\"details\",{className:\"fq-muted\"", "    false&&h(\"details\",{className:\"fq-muted\""), UI],
  ['the mute toast says resolved', ui("flag_mute:'🔕 Muted · VERA won’t raise this topic again',", ""), UI],
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
  // index.html loads its scripts and styles from docs/: bring the rest of docs along unchanged.
  fs.readdirSync(path.join(SRC_DIR, 'docs')).forEach(f => { const s = path.join(SRC_DIR, 'docs', f), d = path.join(OUT, 'docs', f); if (!fs.existsSync(d) && fs.statSync(s).isFile()) fs.copyFileSync(s, d); });
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', timeout: 600000, env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_CTL_FAST: '1' }) });
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
