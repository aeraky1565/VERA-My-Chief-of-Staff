// Negative controls for the running-notes move (Settings.js, ScriptProps.js, the writers, the prune and
// the button): revert ONE rule at a time and confirm a test catches it. Most run test_runningnotes.js;
// the prune ones run test_addressbook.js.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_runningnotes_out');

// Every root script (the tests read several) plus the two dashboard files.
const FILES = fs.readdirSync(SRC_DIR).filter(f => /\.js$/.test(f)).concat(['docs/app.js', 'docs/index.html', 'docs/dashboard-lite.html', 'docs/react.min.js', 'docs/react-dom.min.js', 'tests/regression.spec.js']);
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => {
  if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70));
  return src.split(from).join(to);
};
const one = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const both = (from, to) => b => ({ 'docs/app.js': swap(b['docs/app.js'], from, to), 'docs/index.html': swap(b['docs/index.html'], from, to) });
const TEST = 'test_runningnotes.js', BOOK = 'test_addressbook.js';

const CONTROLS = [
  ['the old property is deleted before the tab reads back', one('Settings.js', "      return String(sh.getRange(rows[key].row, 2).getValue()) === v;", "      return true;")],
  ['the nightly stamp is moved off Script Properties (the keep list ignored)', b => ({ 'Settings.js': swap(swap(b['Settings.js'],
    "var VERA_NOTE_NAMES_ = ['ARIA_FLAGS_SYNCED_AT',", "var VERA_NOTE_NAMES_ = ['LAST_NIGHTLY_RUN', 'ARIA_FLAGS_SYNCED_AT',"),
    "  if (VERA_KEEP_PROPS_.indexOf(n) !== -1) return false;\n", "") })],
  ['trip latches are left in Script Properties', one('Settings.js', "/^PRETRIP_48H_/, ", "")],
  ['a note isn’t read from its old property before the move', one('Settings.js', "function veraNoteGet_(key) { return veraStoreGet_(key); }", "function veraNoteGet_(key) { try { var r = veraStoreRows_()[key]; return r && r.value !== '' ? r.value : null; } catch (e) { return null; } }")],
  ['a deleted note leaves its row taken', one('Settings.js', "      else if (_veraStoreFree_.length) {", "      else if (false) {")],
  ['the move ignores the oversize limit', one('Settings.js', "      if (v.length > VERA_STORE_MAX_) { out.kept.push({ name: k, why: 'too long for one cell' }); return; }\n", "")],
  ['the move leaves Slack’s trail behind', one('Settings.js', "    if (VERA_STATE_BUNDLES_.SLACK.some(function(n) { return all[n] != null; })) {", "    if (false) {")],
  ['anyone can move the notes', one('ScriptProps.js', "function webScriptPropsMoveNotes_() {\n  var no = peopleOwnerOnly_(); if (no) return no;", "function webScriptPropsMoveNotes_() {")],
  ['chat history goes back to Script Properties', one('Chat.js', "  veraNoteSet_(key, JSON.stringify(trimmed));", "  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(trimmed));")],
  ['the trip latch only looks in Script Properties', one('Trips.js', "  var props = veraNotes_();   // latches are running notes (Settings.js); old properties still count", "  var props = PropertiesService.getScriptProperties();")],
  ['the perk email latch only looks in Script Properties', one('Code.js', "      if (!veraNoteGet_(notifyKey)) {", "      if (!PropertiesService.getScriptProperties().getProperty(notifyKey)) {")],
  ['the prune ignores the tab', one('AddressBook.js', "  var keys  = veraNoteKeys_(/^(day_plan_|TDB_SENT_|PERK_NOTIFY_|SCHED_SLACK_|TI_CLIMATE_)/);", "  var keys  = Object.keys(PropertiesService.getScriptProperties().getProperties());\n  var veraNoteGet_ = function(k) { return PropertiesService.getScriptProperties().getProperty(k); };")],
  ['the image dedupe is never pruned', one('AddressBook.js', "      if (at > 1e12 && ageDays(at) > PROP_PRUNE_SCHED_SLACK_DAYS_) removed.push(key);", "      if (false) removed.push(key);"), BOOK],
  ['an old climate is never pruned', one('AddressBook.js', "      if (!isNaN(cAt) && ageDays(cAt) > PROP_PRUNE_CLIMATE_DAYS_) removed.push(key);", "      if (false) removed.push(key);"), BOOK],
  ['the button never shows', both('d.notesToMove>0&&h("button",{className:"sp-move-notes"', 'false&&h("button",{className:"sp-move-notes"')],
];

let allBit = true;
CONTROLS.forEach(function(c) {
  const name = c[0];
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
  const test = c[2] || TEST;
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
