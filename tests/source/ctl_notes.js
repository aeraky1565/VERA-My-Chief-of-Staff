// Negative controls for test_notes.js (Notes.js and its hooks, #252): break ONE rule at a time
// and confirm the test catches it.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const SRC_DIR = process.env.VERA_ROOT || REPO;
const OUT = path.join(__dirname, 'ctl_notes_out');
const FILES = ['Notes.js', 'Code.js', 'WebApp.js', 'Chat.js', 'QuickCapture.js'];
const BASE = {};
FILES.forEach(f => { BASE[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8'); });
const swap = (src, from, to) => { if (src.indexOf(from) === -1) throw new Error('anchor moved: ' + from.slice(0, 70)); return src.split(from).join(to); };
const on = (f, from, to) => b => ({ [f]: swap(b[f], from, to) });
const nt = (from, to) => on('Notes.js', from, to);

const CONTROLS = [
  ['a # inside a word is a tag', nt("String(text || '').replace(/(^|\\s)#([A-Za-z0-9]", "String(text || '').replace(/(^|)#([A-Za-z0-9]")],
  ['tags keep their case', nt("return String(t || '').replace(/^#+/, '').toLowerCase()", "return String(t || '').replace(/^#+/, '')")],
  ['no tag suggested for sizes', nt("if (/\\b(size|sizes|shoe|shoes|shirt|pants|jeans|dress|ring size|waist|inseam)\\b/i.test(t)) return 'sizes';", '')],
  ['a code isn’t offered the Vault', nt("|| /\\bcode\\b[^\\n]{0,12}\\d{3,}/i.test(t);", ';')],
  ['any mention of "remind me" routes', nt("var m = t.match(/^(?:remind me", "var m = t.match(/(?:remind me")],
  ['"buy" anywhere routes', nt("var b = t.match(/^buy\\b", "var b = t.match(/\\bbuy\\b")],
  ['"tomorrow" isn’t a due date', nt("due = d[1].toLowerCase() === 'today' ? today : ntAddDays_(today, 1);", "due = '';")],
  ['shopping ignores the General list', nt("var s = stores.filter(function(x) { return /^(general|any|anything|misc|other|groceries)$/i.test(String(x.storeName || '').trim()); })[0] || stores[0];", 'var s = stores[0];')],
  ['a Vault note can be shared', nt("vals[NT_COL_.SHARE] = ntBool_(p.share) && !ntBool_(p.vault) ? 'true' : '';", "vals[NT_COL_.SHARE] = ntBool_(p.share);")],
  ['the header never gets the new columns', nt('  if (Object.keys(want).length) ntSetCells_(head, want);', '')],
  ['Undo leaves the shopping item', nt("if (b.kind === 'shopping') return deleteShoppingItem_(String(b.tabId || ''), b.index);", '')],
  ['newer replaces a Vault note', nt("return n.id !== selfId && !n.vault && ntFactKey_(", "return n.id !== selfId && ntFactKey_(")],
  ['look-alikes miss plurals', nt("var stem = function(t) { return t.replace(/s$/, '').replace(/ing$/, '').replace(/e$/, ''); };", 'var stem = function(t) { return t; };')],
  ['a merge repeats the tag', nt("var y = x === f ? t : x; if (y && out.indexOf(y) === -1) out.push(y);", "var y = x === f ? t : x; if (y) out.push(y);")],
  ['the preview ignores Open Graph', nt("var title = meta('og:title') || (tm ? ntUnescape_(tm[1]).trim() : '');", "var title = tm ? ntUnescape_(tm[1]).trim() : '';")],
  ['a Vault note fetches a preview', nt("if (f.note.vault) return { ok: false, error: 'Vault notes don’t fetch previews.' };", '')],
  ['capture isn’t owner-only', nt("function webNoteCapture_(body) {\n  var refused = peopleOwnerOnly_(); if (refused) return refused;", 'function webNoteCapture_(body) {')],
  ['get_notes isn’t owner-only', on('WebApp.js', "case 'get_notes':           return jsonOut_(peopleOwnerOnly_() || webGetNotes_(e));", "case 'get_notes':           return jsonOut_(webGetNotes_(e));")],
  ['VERA reads Vault notes', nt('return n.share && !n.vault; }).slice(0, max || 15);', 'return n.share; }).slice(0, max || 15);')],
  ['chat reads pinned notes again', on('Chat.js', 'try { pinnedNotes = ntForVera_(15); }', 'try { pinnedNotes = readAllNotes_(getNotesDocId_()).filter(function(n) { return n.pinned; }).slice(0, 5); }')],
  ['Quick capture sends a #tagged note to the AI', on('QuickCapture.js', 'if (asNote || ntParseTags_(text).length) {', 'if (asNote) {')],
  ['older rows lose their extras', on('Code.js', '    for (var k in extra) note[k] = extra[k];\n', '')],
];

let allBit = true;
CONTROLS.forEach(function(c) {
  if (process.env.CTL_ONLY && c[0] !== process.env.CTL_ONLY) return;
  fs.rmSync(OUT, { recursive: true, force: true });
  let patch;
  try { patch = c[1](BASE); } catch (e) { console.log('\n=== CONTROL: ' + c[0] + '\n  !! MUTATION THREW: ' + e.message); allBit = false; return; }
  const files = Object.assign({}, BASE, patch);
  Object.keys(files).forEach(f => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, f), files[f]); });
  const r = cp.spawnSync('node', ['test_notes.js'], { cwd: __dirname, encoding: 'utf8', env: Object.assign({}, process.env, { VERA_ROOT: OUT }) });
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
