// Negative controls for Health › Care › Eyes (Eyes.js, its routes, the chat action, the nightly step,
// and the EyesTab block shared by both dashboards): revert ONE rule at a time and confirm a test catches it.
// Server rules run test_coverage.js; dashboard rules run test_coverage_ui.js (skipped with no browser).
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_eyes_out');

const FILES = ['Eyes.js', 'DriveSave.js', 'Notes.js', 'appsscript.json', 'Code.js', 'Chat.js', 'TripIdeas.js', 'WebApp.js', 'NightlyRunner.js', 'docs/app.js', 'docs/dashboard-lite.html', 'docs/index.html', 'docs/react.min.js', 'docs/react-dom.min.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });

const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const EY = 'Eyes.js', W = 'WebApp.js', CH = 'Chat.js', A = 'docs/app.js', L = 'docs/dashboard-lite.html';
const srv = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const both = (from, to) => b => ({ [A]: swap(b[A], from, to), [L]: swap(b[L], from, to) });
const UI = 'test_eyes_ui.js';

const CONTROLS = [
  // reading the numbers
  ['a power off the quarter step isn’t marked', srv(EY, "Math.abs(Math.round(n * 4) - n * 4) > 1e-9 || ", "")],
  ['an axis over 180 isn’t marked', srv(EY, "(Math.round(x) === x && x >= 0 && x <= 180)", "(x >= 0)")],
  ['what the reader marked is dropped', srv(EY, "var vals = {}, unsure = (readUnsure || []).slice();", "var vals = {}, unsure = [];")],
  ['a cylinder without an axis isn’t marked', srv(EY, "if (c && Number(c) !== 0 && !a) mark(e + 'Axis');", "")],
  ['contacts expire in 2 years too', srv(EY, "(kind === 'contacts' ? 1 : 2)", "2")],
  ['a typed expiry is ignored', srv(EY, "if (/^\\d{4}-\\d{2}-\\d{2}$/.test(eyText_(typed))) return eyText_(typed);", "")],
  // reading a photo
  ['a PDF goes as an image', srv(EY, "return mime === 'application/pdf' ? { type: 'document',", "return false ? { type: 'document',")],
  ['any file type is read', srv(EY, "if (EY_MIMES_.indexOf(mime) === -1) return { error: 'That isn’t a photo or a PDF.' };", "")],
  ['a file over 10 MB is read', srv(EY, "if (b64.length > EY_MAX_B64_) return { error: 'That file is over 10 MB.' };", "")],
  // saving
  ['marked numbers save without being checked', srv(EY, "if (clean.unsure.length && !b.confirmed) return", "if (false) return")],
  ['the photo isn’t kept', srv(EY, "photo = veraDriveSave_(EY_FOLDER_,", "veraDriveSave_(EY_FOLDER_,")],
  ['the oldest exam is the current one', srv(EY, "return (a.exam || '') < (b.exam || '') ? 1 : (a.exam || '') > (b.exam || '') ? -1 :", "return (a.exam || '') < (b.exam || '') ? -1 : (a.exam || '') > (b.exam || '') ? 1 :")],
  ['a formula-like name is saved', srv(EY, "if (/^[=+@]/.test(person) || /^[=+@]/.test(eyText_(b.doctor)) || /^[=+@]/.test(eyText_(b.lens))) return { ok: false, error: 'A name can’t start with =, + or @.' };", "")],
  // supply and flags
  ['the oldest order sets the supply', srv(EY, ".sort(function(a, b) { return a.date < b.date ? 1 : -1; });\n  var u =", ".sort(function(a, b) { return a.date < b.date ? -1 : 1; });\n  var u =")],
  ['the reorder date isn’t ahead of running out', srv(EY, "reorderBy: eyAddDays_(lastsTo, -EY_REORDER_DAYS_)", "reorderBy: lastsTo")],
  ['an expiry far off still flags', srv(EY, "if (d > EY_EXPIRY_LEAD_DAYS_) return;", "")],
  ['contacts running low never flag', srv(EY, "if (!s || s.daysLeft > EY_SUPPLY_LEAD_DAYS_) return;", "return;")],
  ['an expired prescription is only Medium', srv(EY, "urgency: d < 0 ? 'High' : 'Medium' };", "urgency: 'Medium' };")],
  ['the dentist shows as the eye exam', srv(EY, ".filter(function(a) { return /eye|optom|ophthal/i.test(a.type); })", ".filter(function(a) { return true; })")],
  ['the nightly step is gone', srv('NightlyRunner.js', "    S('checkEyes_', 1, function() { checkEyes_(); }),\n", "")],
  ['the folder is made every time', srv('DriveSave.js', "if (found && found.files && found.files.length) return found.files[0].id;", "")],
  ['full Drive access is asked for', b => ({ 'appsscript.json': swap(b['appsscript.json'], '"https://www.googleapis.com/auth/drive.file"', '"https://www.googleapis.com/auth/drive"') })],
  ['the household’s names are ignored', srv(EY, "try { cvPeople_((getHouseholdInfoData_() || {}).sections || []).forEach(add); } catch (e) {}", "")],
  ['the “Owner” placeholder shows as a person', srv(EY, "if (on && on !== 'Owner') add(on);", "if (on) add(on);")],
  // routes and chat
  ['the save route is missing', srv(W, "      case 'eye_save':                   return jsonOut_(webEyeSave_(body));\n", "")],
  ['the chat can’t give the prescription', srv(CH, "else if (type === 'eye_rx')", "else if (type === 'eye_rx_off')")],
  // the dashboard (both)
  ['the photo isn’t sent to be read', both("return apiPost(props.apiUrl,props.apiToken,{action:'eye_read',kind:form.kind,imageBase64:x.base64,mime:x.mime});", "return {ok:false,error:'not read'};"), UI],
  ['an unsure number isn’t marked', both("className:'ey-field'+(form.unsure.indexOf(k)!==-1?' ey-unsure':'')", "className:'ey-field'"), UI],
  ['typing doesn’t clear the mark', both("n.unsure=n.unsure.filter(function(x){return x!==k;});", ""), UI],
  ['Save doesn’t send the photo', both("onClick:function(){save(!!form.file);}", "onClick:function(){save(false);}"), UI],
  ['Save without the photo still sends it', both("imageBase64:withPhoto&&f.file?f.file.base64:undefined", "imageBase64:f.file?f.file.base64:undefined"), UI],
  ['Book it goes nowhere', both("post({action:'appt_book',person:who,", "post({action:'appt_none',person:who,"), UI],
  ['Copy copies nothing', both("try{navigator.clipboard.writeText(r.copy);}catch(e){}", ""), UI],
  ['the other person’s prescriptions show', both("var cur=function(kind){return (d.current||[]).filter(function(r){return r.person===who&&r.kind===kind;})[0];};", "var cur=function(kind){return (d.current||[]).filter(function(r){return r.kind===kind;})[0];};"), UI],
];

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
  if (c[2] && !HAS_BROWSER) { console.log('\n=== CONTROL: ' + name + '  (skipped: no browser here)'); return; }
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
  const test = c[2] || 'test_eyes.js';
  const r = cp.spawnSync('node', [test], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT, VERA_PAGES_ROOT: OUT }) });
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
