// Notes as private quick capture (#252, Notes.js): tags, routing on explicit words only, the
// Vault, newer replaces older, Tidy tags, link previews, owner-only routes, chat reading only ✨
// notes, and "note:" never reaching the AI or Memory. Invented data.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

const NOTES = read('Notes.js'), CODE = read('Code.js'), WEB = read('WebApp.js'), CHAT = read('Chat.js'), QC = read('QuickCapture.js');
const headers = CODE.match(/var NOTES_DOC_HEADERS = \[[^\]]*\];/)[0];

// A fake Notes Doc: a table of rows of cells.
function fakeDoc(rows) {
  const mkRow = cells => ({ cells: cells.slice(), getNumCells() { return this.cells.length; }, getCell(i) { const r = this; return { getText: () => String(r.cells[i] == null ? '' : r.cells[i]), setText: v => { r.cells[i] = v; } }; }, appendTableCell(v) { this.cells.push(v); } });
  const t = { rows: rows.map(mkRow) };
  t.getNumRows = () => t.rows.length; t.getRow = i => t.rows[i];
  t.insertTableRow = i => { const r = mkRow(['']); t.rows.splice(i, 0, r); return r; };
  t.removeRow = i => { t.rows.splice(i, 1); };
  return t;
}
function ctx(opts) {
  opts = opts || {};
  const table = opts.table || fakeDoc([['ID', 'Date Added', 'Title', 'Content', 'Tags', 'Related To', 'Pinned', 'Category']]);
  const c = { Logger: { log() {} }, JSON, Math, Date, String, Object, parseInt, isNaN, calls: [],
    Utilities: { getUuid: () => 'id-' + (c.calls.length + 1) + '-' + table.rows.length, formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? '2026-11-18' : '2026-11-18 10:00', base64Decode: s => Buffer.from(s, 'base64'), newBlob: (b, m, n) => ({ b, m, n }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    getNotesDocId_: () => 'DOC', getNotesTable_: () => table,
    peopleOwnerOnly_: () => opts.notOwner ? { ok: false, error: 'Only the owner can do that' } : null,
    webAddTask_: e => { c.calls.push(['task', e.parameter]); return { ok: true, id: 'TASK-1' }; },
    webDeleteTask_: id => { c.calls.push(['deltask', id]); return { ok: true }; },
    getShoppingList_: () => opts.stores || [{ storeName: 'Costco', tabId: 't1', items: [{}, {}] }, { storeName: 'General', tabId: 't2', items: [{}] }],
    addShoppingItem_: (tab, text) => { c.calls.push(['shop', tab, text]); },
    deleteShoppingItem_: (tab, i) => { c.calls.push(['delshop', tab, i]); return { ok: true }; },
    UrlFetchApp: { fetch: (url) => { c.calls.push(['fetch', url]); return { getResponseCode: () => 200, getContentText: () => opts.html || '' }; } },
  };
  vm.createContext(c);
  vm.runInContext(headers.replace('var ', 'var ') + '\n' + NOTES, c);
  // readAllNotes_ is Code.js's, with the #252 extras.
  const rd = CODE.slice(CODE.indexOf('function readAllNotes_('), CODE.indexOf('function setupNotesDoc()'));
  vm.runInContext(rd, c);
  c.__table = table;
  return c;
}

console.log('\nTags, by simple rules (never AI)');
{
  const c = ctx();
  check('#tags are read from the text, lower case, in order, once', J(c.ntParseTags_('Shoe 8.5 #Sizes and #move #sizes')) === '["sizes","move"]');
  check('…a # inside a word or a URL fragment is not a tag', J(c.ntParseTags_('see https://x.test/a#top and C#')) === '[]');
  check('a stored tags cell, either way it was written', J(c.ntTagList_('sizes, move')) === '["sizes","move"]' && J(c.ntTagList_('#Sizes #move')) === '["sizes","move"]');
  check('a tag suggested from the words', c.ntSuggestTag_('Shoe size 8.5') === 'sizes' && c.ntSuggestTag_('Wifi password is…') === 'codes' && c.ntSuggestTag_('read https://example.com') === 'links' && c.ntSuggestTag_('Movers $1,240') === 'money');
  check('…and none when nothing fits', c.ntSuggestTag_('Call the plumber') === '');
  check('a code or password suggests the Vault', c.ntLooksSecret_('Garage code 4471') && c.ntLooksSecret_('wifi: hunter2') && !c.ntLooksSecret_('Shoe 8.5'));
}

console.log('\nRouting only on explicit words');
{
  const c = ctx();
  const r = (t) => J(c.ntRoute_(t, '2026-11-18'));
  check('"remind me to …" makes a task', r('remind me to renew the passport') === J({ kind: 'task', text: 'Renew the passport', due: '' }));
  check('…"tomorrow" sets its due date', r('remind me tomorrow to call the vet') === J({ kind: 'task', text: 'Call the vet', due: '2026-11-19' }) && r('add a task: pay the plumber today') === J({ kind: 'task', text: 'Pay the plumber', due: '2026-11-18' }));
  check('"buy …" adds to Shopping', r('buy oat milk') === J({ kind: 'shopping', text: 'oat milk' }));
  check('everything else stays a note, even with those words later on', r('Sam said to remind me later') === J({ kind: 'note' }) && r('Things to buy for the move') === J({ kind: 'note' }));
  check('a note splits into its first line and the rest', J(c.ntSplit_('Move costs\nTruck $400\nBoxes $60')) === J({ title: 'Move costs', content: 'Truck $400\nBoxes $60' }));
}

console.log('\nCapture');
{
  const c = ctx();
  const t = c.webNoteCapture_({ text: 'remind me to book the dentist' });
  check('a reminder goes to Tasks, from Jot a note', t.kind === 'task' && c.calls[0][0] === 'task' && c.calls[0][1].task === 'Book the dentist' && c.__table.rows.length === 1);
  const s = c.webNoteCapture_({ text: 'buy batteries' });
  check('"buy" goes to the General list when there is one, with what Undo needs', s.kind === 'shopping' && J(c.calls[1]) === J(['shop', 't2', 'batteries']) && s.store === 'General' && s.index === 1);
  const n = c.webNoteCapture_({ text: 'Alex shoe 10.5 #sizes\nwide fit', share: true });
  const row = c.__table.rows[1].cells;
  check('anything else is a note: first line the title, #tags stored, ✨ kept', n.kind === 'note' && row[2] === 'Alex shoe 10.5 #sizes' && row[3] === 'wide fit' && row[4] === 'sizes' && row[8] === 'true');
  check('…the header gains the new columns the first time', c.__table.rows[0].cells.length === 15 && c.__table.rows[0].cells[9] === 'Vault' && c.__table.rows[0].cells[14] === 'Updated');
  c.webNoteCapture_({ text: 'Garage code 4471', vault: true, share: true, hideLabel: true });
  const v = c.__table.rows[1].cells;
  check('a Vault note is never shared, and can hide its label', v[9] === 'true' && v[8] === '' && v[10] === 'true');
  const all = c.readAllNotes_('DOC');
  check('reading back: the new fields, and older rows with fewer cells read blank', all.length === 2 && all[0].vault === true && all[0].hideLabel === true && all[1].share === true && all[1].backOn === '' && all[1].link === null);
  const c2 = ctx({ table: fakeDoc([['ID', 'Date Added', 'Title', 'Content', 'Tags', 'Related To', 'Pinned', 'Category'], ['old1', '2026-01-02', 'Old note', 'body', 'x', '', 'true', 'Travel']]) });
  const old = c2.readAllNotes_('DOC')[0];
  check('a note from before #252 still reads, with its category', old.title === 'Old note' && old.pinned === true && old.category === 'Travel' && old.share === false && old.vault === false);
  c.webNoteUndo_({ kind: 'task', id: 'TASK-1' }); c.webNoteUndo_({ kind: 'shopping', tabId: 't2', index: 1 });
  check('Undo takes back the task and the shopping item', J(c.calls.slice(-2)) === J([['deltask', 'TASK-1'], ['delshop', 't2', 1]]));
  const before = c.__table.rows.length; c.webNoteUndo_({ kind: 'note', id: all[0].id });
  check('…and a note', c.__table.rows.length === before - 1);
  check('an empty box saves nothing', c.webNoteCapture_({ text: '  ' }).ok === false);
}

console.log('\nNewer replaces older (after asking)');
{
  const c = ctx();
  const notes = [{ id: 'a', title: 'Shoe 8', content: '' }, { id: 'b', title: 'Shirt M', content: '' }, { id: 'v', title: 'Shoe 9', content: '', vault: true }];
  check('"shoe 8.5" would replace "Shoe 8"', c.ntReplaces_('shoe 8.5 #sizes', notes, 'new') === 'a');
  check('…never a Vault note, never itself, never a longer note', c.ntReplaces_('shoe 8.5', [notes[2]], 'n') === '' && c.ntReplaces_('Shoe 8', [notes[0]], 'a') === '' && c.ntReplaces_('Shoe 8.5\nthe blue ones', notes, 'n') === '');
}

console.log('\nTidy tags');
{
  const c = ctx();
  check('look-alikes: plurals, -ing, and a one-letter typo, the more used first', J(c.ntLookAlikes_({ sizes: 5, size: 1, move: 2, moving: 3, recipes: 2, recipies: 1, gifts: 1 })) === J([['sizes', 'size'], ['moving', 'move'], ['recipes', 'recipies']]), J(c.ntLookAlikes_({ sizes: 5, size: 1, move: 2, moving: 3, recipes: 2, recipies: 1, gifts: 1 })));
  check('rename a tag, and merging into one already there doesn’t repeat it', c.ntRetag_('size, travel', 'size', 'sizes') === 'sizes, travel' && c.ntRetag_('size, sizes', 'size', 'sizes') === 'sizes');
  const t = fakeDoc([NOTES_HEADERS(), ['n1', '', 'A', '', 'size', '', '', ''], ['n2', '', 'B', '', 'move', '', '', ''], ['n3', '', 'C', '', 'size, move', '', '', '']]);
  const d = ctx({ table: t });
  const r = d.webNotesRetag_({ from: 'size', to: '#Sizes' });
  check('the route changes every note with that tag, and only those', r.changed === 2 && t.rows[1].cells[4] === 'sizes' && t.rows[2].cells[4] === 'move' && t.rows[3].cells[4] === 'sizes, move');
}
function NOTES_HEADERS() { return ['ID', 'Date Added', 'Title', 'Content', 'Tags', 'Related To', 'Pinned', 'Category']; }

console.log('\nLink preview, only when asked');
{
  const html = '<html><head><title>Plain title</title><meta property="og:title" content="Best &amp; Brightest"><meta name="description" content="A page"><meta property="og:image" content="/pic.jpg"></head></html>';
  const c = ctx();
  const pv = c.ntPreviewFromHtml_(html, 'https://example.com/a');
  check('Open Graph first, with the picture made absolute', pv.title === 'Best & Brightest' && pv.desc === 'A page' && pv.image === 'https://example.com/pic.jpg', J(pv));
  check('…the page title when there’s no Open Graph', c.ntPreviewFromHtml_('<title> Just this </title>', 'https://x.test').title === 'Just this');
  const t = fakeDoc([NOTES_HEADERS(), ['n1', '', 'Read later', 'https://example.com/a', '', '', '', ''], ['v1', '', 'Secret', 'https://bank.test', '', '', '', '', '', 'true']]);
  const d = ctx({ table: t, html });
  const r = d.webNoteLinkPreview_({ id: 'n1' });
  check('the route fetches the first link and keeps the preview on the note', r.ok && d.calls[0][1] === 'https://example.com/a' && JSON.parse(t.rows[1].cells[13]).title === 'Best & Brightest');
  check('a Vault note never fetches anything', d.webNoteLinkPreview_({ id: 'v1' }).ok === false && d.calls.length === 1);
}

console.log('\nOwner only, everywhere');
{
  const c = ctx({ notOwner: true });
  ['webNoteCapture_', 'webNoteUndo_', 'webNotesRetag_', 'webNoteLinkPreview_', 'webNotePicture_', 'webNotePictureView_'].forEach(fn => {
    check(fn + ' refuses anyone but the owner', c[fn]({ text: 'x', id: 'x', parameter: { id: 'x' } }).error === 'Only the owner can do that');
  });
  ['get_notes', 'add_note', 'update_note', 'delete_note', 'pin_note'].forEach(a => {
    check("'" + a + "' asks peopleOwnerOnly_ first", new RegExp("case '" + a + "':\\s+return jsonOut_\\(peopleOwnerOnly_\\(\\) \\|\\| web").test(WEB));
  });
  ['note_capture', 'note_undo', 'notes_retag', 'note_link_preview', 'note_picture'].forEach(a => check("'" + a + "' is routed", new RegExp("case '" + a + "':\\s+return jsonOut_\\(web").test(WEB)));
}

console.log('\nWhat VERA reads, and what never goes to the AI or Memory');
{
  const t = fakeDoc([NOTES_HEADERS(), ['s1', '', 'Sam ring size 6', '', '', '', '', '', 'true'], ['p1', '', 'Pinned private', '', '', '', 'true', ''], ['v1', '', 'Vault', 'x', '', '', '', '', 'true', 'true']]);
  const c = ctx({ table: t });
  check('VERA gets the ✨ notes, never a pinned private one or a Vault one', J(c.ntForVera_(15).map(n => n.id)) === '["s1"]');
  check('chat context reads ntForVera_, not pinned notes', /pinnedNotes = ntForVera_\(15\)/.test(CHAT) && !/\.filter\(function\(n\) \{ return n\.pinned; \}\)/.test(CHAT));
  check('…and tells the AI the rest are private', /NOTES SHARED WITH VERA/.test(CHAT));
  const nm = CHAT.slice(CHAT.indexOf('// ── Note capture shortcut'), CHAT.indexOf('var history   = loadChatHistory_'));
  check('"note: …" in chat saves straight to Notes and returns before the AI is called', /ntAdd_\(\{ title: noteParts\.title/.test(nm) && /return \{ reply: 'Saved to your Notes, private/.test(nm) && !/callClaude/.test(nm) && !/appendMemory|Memory_\(/.test(nm));
  const qc = QC.slice(QC.indexOf('function webLifeQuickCapture_'));
  check('Quick capture: a "note:" or #tagged line is saved without asking the AI', qc.indexOf('ntParseTags_(text).length') !== -1 && qc.indexOf('ntParseTags_(text).length') < qc.indexOf('callClaudeJsonDetailed_'));
  check('readAllNotes_ reads the #252 columns', /var extra = ntExtras_\(row\);/.test(CODE) && /'Share', 'Vault', 'Hide Label', 'Back On', 'Picture', 'Link', 'Updated'/.test(CODE));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
