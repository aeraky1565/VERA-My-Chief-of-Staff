// Negative controls for Working and Business Trips: revert ONE rule at a time and
// confirm test_workingtrips.js (or its browser test) catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_workingtrips');
const BASE = {};
fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html'].forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const ui = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const W = 'WorkTrips.js', NODE = 'test_workingtrips.js', UI = 'test_workingtrips_ui.js';
const CONTROLS = [
  ['an old "Work Trip" isn’t business', one(W, "if (/^(business trip|work trip|business)\\b/.test(c)) return 'business';", "if (/^(business trip)\\b/.test(c)) return 'business';"), NODE],
  ['a saved choice is ignored', one(W, "  var s = wtNames_(stored);\n  return s.length ? s : wtTravellers_(traveler);", "  return wtTravellers_(traveler);"), NODE],
  ['a family trip has workers', one(W, "  if (!tripWorkKind_(context)) return [];\n", ''), NODE],
  ['booked PTO counts as a working day', one(W, " || (pto || []).some(function(r) { return d >= r[0] && d <= r[1]; });", ";"), NODE],
  ['holidays count as working days', one(W, " || !!(holidays && holidays[d])", ''), NODE],
  ['the hours are always 9 to 6', one(W, "  return wtParseHours_(v);\n}", "  return wtParseHours_('');\n}"), NODE],
  ['saved by trip key, not Trip ID', one(W, "    if (w) map[k] = w; else delete map[k];", "    if (w) map[String(tripKey)] = w; else delete map[String(tripKey)];"), NODE],
  ['any value accepted', one(W, "  if (w && ['Ahmed', 'Victoria', 'Both'].indexOf(w) === -1) return { ok: false, error: 'working must be Ahmed, Victoria or Both' };\n", ''), NODE],
  ['a trip busy for everyone again', one('PTOStrategy.js', "if (!t.who || t.who.indexOf(p.id) !== -1) busy.push([t.start, t.end]);", "busy.push([t.start, t.end]);"), NODE],
  ['a pencilled working trip reserves PTO', one('PTOStrategy.js', "    if (t.working) return;                 // a working or business trip takes no days off\n", ''), NODE],
  ['must-haves aren’t read', one('PTOStrategy.js', "  var text = [t && t.title, t && t.mustHaves, t && t.note]", "  var text = [t && t.title]"), NODE],
  ['someone else’s trip blocks your clear windows', one('PTO.js', "    return who.length > 0 && who.indexOf(name) === -1;", "    return false;"), NODE],
  ['the clear-window scan ignores the skip', one('PTO.js', "      if (skipEvent) { try { if (skipEvent(ev)) continue; } catch (skipErr) {} }\n", ''), NODE],
  ['no Employer pays', one('WebApp.js', "  var employerPays = tripWorkKind_(meta.context) === 'business';", "  var employerPays = false;"), NODE],
  ['the day plans don’t hear about working days', one('WebApp.js', "  try { recsWork = wtPromptLines_(tripKey, startDate, endDate); } catch (wtErr) { recsWork = ''; }", "  recsWork = '';"), NODE],
  ['Work Trip back in the menu', ui("'Romantic Couples Getaway','Business Trip','Working Trip','Visiting Friends'", "'Romantic Couples Getaway','Work Trip','Visiting Friends'"), NODE],
  ['a working trip drawn as a plain trip', b => ({ 'docs/app.js': swap(b['docs/app.js'], "put(t.start,t.end,w?'w':'l');", "put(t.start,t.end,'l');"), 'docs/index.html': swap(b['docs/index.html'], "put(t.start,t.end,w?'w':'l');", "put(t.start,t.end,'l');") }), NODE],
  ['the card asks on every trip', ui("if(!kind)return null;\nfunction pick(w)", "function pick(w)"), UI],
  ['the card’s default ignores the Traveller', ui("return s.indexOf('victoria')!==-1?'Victoria':s.indexOf('ahmed')!==-1?'Ahmed':'Both';}", "return 'Both';}"), UI],
  ['the choice isn’t saved', ui("apiGet(apiUrl,apiToken,{action:'set_trip_working',tripKey:tripKey,working:w})", "Promise.resolve({ok:true})"), UI],
  ['the budget note is gone', ui("summary.employerPays&&React.createElement(\"div\",{className:\"tb-employer\"", "false&&React.createElement(\"div\",{className:\"tb-employer\""), UI],
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
  ['docs/react.min.js', 'docs/react-dom.min.js'].forEach(f => fs.copyFileSync(path.join(SRC_DIR, f), path.join(OUT, f)));
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
