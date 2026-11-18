// ============================================================
// VERA — Notes.js  (issue #252)
// Notes as private quick capture: just tags, private by default.
// ============================================================
//
// THE RULES (decided in #252):
//   - Notes are the owner's alone. Every notes route is owner-only (peopleOwnerOnly_),
//     so hiding the tab is no longer the only thing between a partner's sign-in and them.
//   - Private by default. VERA reads a note only when it's marked ✨ "Let VERA use"
//     (the Share column): chat context gets those and nothing else (Chat.js). Pinning
//     only changes the order on the page. Nothing typed into Notes goes to Memory.
//   - Just tags. #words become tags; a tag can be suggested by simple word rules, never
//     by AI. The old Category column is still read: a non-General one shows as a tag.
//   - Routing happens only on explicit words: "remind me…" / "add a task…" makes a Task,
//     "buy…" adds to Shopping. Everything else stays a note. Each can be undone.
//   - The Vault (for now) only hides a note on screen: its text is in the Doc as usual,
//     but VERA never reads it, it never shows on other screens, and search sees only its
//     label. Encrypting it is #253.
//
// STORAGE. The Notes Doc's table (Code.js getNotesTable_ / readAllNotes_), with columns
// added after Category the first time they're written (NOTES_DOC_HEADERS):
//   Share · Vault · Hide Label · Back On · Picture · Link · Updated
// Older rows simply have fewer cells; a missing cell reads as blank.
// ============================================================

// Cell index of each column (0-based, as DocumentApp counts them).
var NT_COL_ = { ID: 0, DATE: 1, TITLE: 2, CONTENT: 3, TAGS: 4, RELATED: 5, PINNED: 6, CATEGORY: 7,
                SHARE: 8, VAULT: 9, HIDE: 10, BACK: 11, PICTURE: 12, LINK: 13, UPDATED: 14 };
var NT_PICTURES_FOLDER_ = 'VERA Notes';

// ---- pure helpers --------------------------------------------------------------

/** Pure: a tag in its stored form: lower case, no '#', letters, digits and - only. */
function ntTagNorm_(t) { return String(t || '').replace(/^#+/, '').toLowerCase().replace(/[^a-z0-9\-]/g, '').slice(0, 30); }

/** Pure: the #tags typed in a text, in order, without repeats. */
function ntParseTags_(text) {
  var out = [];
  String(text || '').replace(/(^|\s)#([A-Za-z0-9][A-Za-z0-9\-]*)/g, function(m, pre, t) {
    var n = ntTagNorm_(t); if (n && out.indexOf(n) === -1) out.push(n); return m;
  });
  return out;
}

/** Pure: a stored tags cell ("sizes, move" or "#sizes #move") → ['sizes','move']. */
function ntTagList_(cell) {
  var out = [];
  String(cell || '').split(/[,\s]+/).forEach(function(t) { var n = ntTagNorm_(t); if (n && out.indexOf(n) === -1) out.push(n); });
  return out;
}

/** Pure: a tag suggested from the words, by simple rules (never AI). '' when none fits. */
function ntSuggestTag_(text) {
  var t = String(text || '');
  if (/\b(size|sizes|shoe|shoes|shirt|pants|jeans|dress|ring size|waist|inseam)\b/i.test(t)) return 'sizes';
  if (/\b(password|passcode|pin|wifi|wi-fi|combo|combination|code)\b/i.test(t)) return 'codes';
  if (/https?:\/\//i.test(t)) return 'links';
  if (/\$\s?\d/.test(t)) return 'money';
  if (/\b(recipe|cook|bake|ingredients?)\b/i.test(t)) return 'recipes';
  if (/\b(gift|birthday|anniversary)\b/i.test(t)) return 'gifts';
  return '';
}

/** Pure: does this look like a code or password, worth suggesting the Vault for? */
function ntLooksSecret_(text) {
  var t = String(text || '');
  return /\b(password|passcode|pin|wifi|wi-fi|combo|combination|ssn|social security|account (no|number)|routing)\b/i.test(t)
      || /\bcode\b[^\n]{0,12}\d{3,}/i.test(t);
}

/**
 * Pure: what a captured line asks for. Only explicit words route anything:
 *   "remind me (to) …", "add a task(:) …"  → { kind:'task', text, due }
 *   "buy …"                                 → { kind:'shopping', text }
 *   anything else                           → { kind:'note' }
 * due is today / tomorrow ('yyyy-MM-dd') when the line says so, else ''.
 */
function ntRoute_(text, today) {
  var t = String(text || '').trim();
  var m = t.match(/^(?:remind me(?:\s+to)?|add (?:a )?task)\b[\s:,-]*(.+)$/i);
  if (m) {
    var rest = m[1].trim(), due = '';
    var d = rest.match(/^(today|tomorrow)\b[\s,:-]*(?:to\s+)?/i) || rest.match(/\s+(today|tomorrow)\s*$/i);
    if (d) { due = d[1].toLowerCase() === 'today' ? today : ntAddDays_(today, 1); rest = rest.replace(d[0], ' ').trim(); }
    rest = rest.replace(/^to\s+/i, '');
    return rest ? { kind: 'task', text: rest.charAt(0).toUpperCase() + rest.slice(1), due: due } : { kind: 'note' };
  }
  var b = t.match(/^buy\b[\s:,-]*(.+)$/i);
  if (b && b[1].trim()) return { kind: 'shopping', text: b[1].trim() };
  return { kind: 'note' };
}

function ntAddDays_(iso, n) {
  var p = String(iso).split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.toISOString().slice(0, 10);
}

/** Pure: a typed note → { title: its first line, content: the rest }. */
function ntSplit_(text) {
  var lines = String(text || '').replace(/\r/g, '').split('\n');
  var title = lines.shift().trim(), content = lines.join('\n').trim();
  if (title.length > 120) { content = (title.slice(120) + (content ? '\n' + content : '')).trim(); title = title.slice(0, 120); }
  return { title: title, content: content };
}

/** Pure: the first web link in a note. */
function ntFirstUrl_(text) { var m = String(text || '').match(/https?:\/\/[^\s<>"')]+/i); return m ? m[0] : ''; }

/** Pure: a page's title, description and picture, from its HTML (Open Graph first). */
function ntPreviewFromHtml_(html, url) {
  var h = String(html || '').slice(0, 200000);
  var meta = function(prop) {
    var re = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
    var re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + prop + '["\']', 'i');
    var m = h.match(re) || h.match(re2); return m ? ntUnescape_(m[1]).trim() : '';
  };
  var tm = h.match(/<title[^>]*>([^<]*)<\/title>/i);
  var title = meta('og:title') || (tm ? ntUnescape_(tm[1]).trim() : '');
  var img = meta('og:image');
  if (img && !/^https?:/i.test(img)) { try { img = img.charAt(0) === '/' ? url.match(/^https?:\/\/[^\/]+/i)[0] + img : ''; } catch (e) { img = ''; } }
  return { url: url, title: title.slice(0, 200), desc: (meta('og:description') || meta('description')).slice(0, 300), image: /^https:/i.test(img) ? img : '' };
}
function ntUnescape_(s) { return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }

/**
 * Pure: tags that look like the same thing (sizes / size, move / moving, Gift / gift),
 * for Tidy tags. → [[a, b], …], each pair once, the more used one first.
 */
function ntLookAlikes_(counts) {
  var tags = Object.keys(counts || {}), out = [];
  var stem = function(t) { return t.replace(/s$/, '').replace(/ing$/, '').replace(/e$/, ''); };
  for (var i = 0; i < tags.length; i++) for (var j = i + 1; j < tags.length; j++) {
    var a = tags[i], b = tags[j];
    if (stem(a) === stem(b) || (a.length > 4 && b.length > 4 && ntEdit1_(a, b))) {
      out.push(counts[a] >= counts[b] ? [a, b] : [b, a]);
    }
  }
  return out;
}
/** Pure: within one edit (a typo). */
function ntEdit1_(a, b) {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  var i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}

/** Pure: a tags cell with one tag renamed (or merged into an existing one). */
function ntRetag_(cell, from, to) {
  var f = ntTagNorm_(from), t = ntTagNorm_(to), out = [];
  ntTagList_(cell).forEach(function(x) { var y = x === f ? t : x; if (y && out.indexOf(y) === -1) out.push(y); });
  return out.join(', ');
}

/**
 * Pure: the older note a new one would replace: the same kind of fact with a newer
 * value ("shoe 8.5" after "shoe 8"). Only for one-line notes that are "<words> <value>".
 * → the older note's id, or ''.
 */
function ntReplaces_(text, notes, selfId) {
  var key = ntFactKey_(text);
  if (!key) return '';
  var hit = (notes || []).filter(function(n) { return n.id !== selfId && !n.vault && ntFactKey_(n.title + (n.content ? '\n' + n.content : '')) === key; });
  return hit.length ? hit[0].id : '';
}
function ntFactKey_(text) {
  var t = String(text || '').replace(/(^|\s)#[A-Za-z0-9\-]+/g, ' ').trim();
  if (!t || /\n/.test(t)) return '';
  var m = t.match(/^([A-Za-z][A-Za-z' ]{1,40}?)[\s:=-]+(\d[\d.\/\-]*\s*[A-Za-z]{0,4})$/);
  return m ? m[1].trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

// ---- reading and writing the Doc ---------------------------------------------

/** The extra cells of one Doc row (Code.js readAllNotes_ calls this). Missing cells read blank. */
function ntExtras_(row) {
  var n = row.getNumCells();
  var cell = function(i) { return i < n ? row.getCell(i).getText().trim() : ''; };
  var link = null;
  try { link = cell(NT_COL_.LINK) ? JSON.parse(cell(NT_COL_.LINK)) : null; } catch (e) { link = null; }
  return { share: cell(NT_COL_.SHARE) === 'true', vault: cell(NT_COL_.VAULT) === 'true', hideLabel: cell(NT_COL_.HIDE) === 'true',
           backOn: cell(NT_COL_.BACK), picture: cell(NT_COL_.PICTURE), link: link, updated: cell(NT_COL_.UPDATED) };
}

/** Writes cells by index, adding the cells an older row doesn't have yet. */
function ntSetCells_(row, vals) {
  Object.keys(vals).forEach(function(k) {
    var i = parseInt(k, 10), v = vals[k] == null ? '' : String(vals[k]);
    while (row.getNumCells() <= i) row.appendTableCell('');
    row.getCell(i).setText(v);
  });
}

/** The header row gets the new column names the first time (Code.js NOTES_DOC_HEADERS). */
function ntEnsureHeader_(table) {
  var head = table.getRow(0), want = {};
  for (var i = head.getNumCells(); i < NOTES_DOC_HEADERS.length; i++) want[i] = NOTES_DOC_HEADERS[i];
  if (Object.keys(want).length) ntSetCells_(head, want);
}

function ntNow_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }
function ntToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function ntBool_(v) { return v === true || String(v) === 'true' ? 'true' : ''; }

/** Finds a note by id → { note, row, table } or throws. */
function ntFind_(id) {
  var docId = getNotesDocId_(), notes = readAllNotes_(docId);
  for (var i = 0; i < notes.length; i++) if (notes[i].id === id) {
    var table = getNotesTable_(docId);
    return { note: notes[i], row: table.getRow(notes[i].rowIndex), table: table, notes: notes };
  }
  throw new Error('Note not found');
}

/** Adds a note; tags from the text plus any passed. Used by the route, capture and chat. → id */
function ntAdd_(p) {
  var docId = getNotesDocId_(), table = getNotesTable_(docId);
  ntEnsureHeader_(table);
  var id = Utilities.getUuid();
  var tags = ntTagList_(p.tags);
  ntParseTags_((p.title || '') + '\n' + (p.content || '')).forEach(function(t) { if (tags.indexOf(t) === -1) tags.push(t); });
  var row = table.insertTableRow(1);
  var vals = {};
  vals[NT_COL_.ID] = id; vals[NT_COL_.DATE] = ntToday_(); vals[NT_COL_.TITLE] = String(p.title || '').slice(0, 200);
  vals[NT_COL_.CONTENT] = String(p.content || ''); vals[NT_COL_.TAGS] = tags.join(', '); vals[NT_COL_.RELATED] = String(p.relatedTo || '');
  vals[NT_COL_.PINNED] = ntBool_(p.pinned); vals[NT_COL_.CATEGORY] = String(p.category || '');
  vals[NT_COL_.SHARE] = ntBool_(p.share) && !ntBool_(p.vault) ? 'true' : ''; vals[NT_COL_.VAULT] = ntBool_(p.vault);
  vals[NT_COL_.HIDE] = ntBool_(p.vault) ? ntBool_(p.hideLabel) : ''; vals[NT_COL_.BACK] = /^\d{4}-\d{2}-\d{2}$/.test(String(p.backOn || '')) ? p.backOn : '';
  vals[NT_COL_.PICTURE] = ''; vals[NT_COL_.LINK] = ''; vals[NT_COL_.UPDATED] = ntNow_();
  ntSetCells_(row, vals);
  return id;
}

// ---- routes (all owner-only; see the router in WebApp.js) ----------------------

/**
 * POST note_capture {text, share, vault, hideLabel} — the Jot a note box. Routes on
 * explicit words only; anything else becomes a note. Never sent to the AI.
 * → { ok, kind:'note'|'task'|'shopping', id, title, store?, index? }
 */
function webNoteCapture_(body) {
  var refused = peopleOwnerOnly_(); if (refused) return refused;
  var b = body || {}, text = String(b.text || '').trim();
  if (!text) return { ok: false, error: 'Type something first.' };
  var r = ntRoute_(text, ntToday_());
  if (r.kind === 'task') {
    var t = webAddTask_({ parameter: { task: r.text, dueDate: r.due, notes: 'From Jot a note' } });
    return { ok: true, kind: 'task', id: t.id, title: r.text, due: r.due };
  }
  if (r.kind === 'shopping') {
    var stores = getShoppingList_();
    if (!stores.length) return { ok: false, error: 'No shopping list is set up yet.' };
    var s = stores.filter(function(x) { return /^(general|any|anything|misc|other|groceries)$/i.test(String(x.storeName || '').trim()); })[0] || stores[0];
    addShoppingItem_(s.tabId, r.text);
    return { ok: true, kind: 'shopping', title: r.text, store: s.storeName, tabId: s.tabId, index: (s.items || []).length };
  }
  var parts = ntSplit_(text);
  var id = ntAdd_({ title: parts.title, content: parts.content, tags: b.tags, share: b.share, vault: b.vault, hideLabel: b.hideLabel, backOn: b.backOn });
  return { ok: true, kind: 'note', id: id, title: parts.title };
}

/** POST note_undo {kind, id, tabId, index} — takes back what note_capture just did. */
function webNoteUndo_(body) {
  var refused = peopleOwnerOnly_(); if (refused) return refused;
  var b = body || {};
  if (b.kind === 'task') return webDeleteTask_(String(b.id || ''));
  if (b.kind === 'shopping') return deleteShoppingItem_(String(b.tabId || ''), b.index);
  if (b.kind === 'note') { var f = ntFind_(String(b.id || '')); f.table.removeRow(f.note.rowIndex); return { ok: true }; }
  return { ok: false, error: 'Nothing to undo.' };
}

/** POST notes_retag {from, to} — Tidy tags: rename a tag, or merge it into another. */
function webNotesRetag_(body) {
  var refused = peopleOwnerOnly_(); if (refused) return refused;
  var b = body || {}, from = ntTagNorm_(b.from), to = ntTagNorm_(b.to);
  if (!from || !to || from === to) return { ok: false, error: 'Pick a tag and a new name.' };
  var docId = getNotesDocId_(), notes = readAllNotes_(docId), table = getNotesTable_(docId), changed = 0;
  notes.forEach(function(n) {
    if (ntTagList_(n.tags).indexOf(from) === -1) return;
    var v = {}; v[NT_COL_.TAGS] = ntRetag_(n.tags, from, to);
    ntSetCells_(table.getRow(n.rowIndex), v); changed++;
  });
  return { ok: true, changed: changed };
}

/** POST note_link_preview {id} — on request only: fetches the note's first link's title and picture. */
function webNoteLinkPreview_(body) {
  var refused = peopleOwnerOnly_(); if (refused) return refused;
  var f = ntFind_(String((body || {}).id || ''));
  if (f.note.vault) return { ok: false, error: 'Vault notes don’t fetch previews.' };
  var url = ntFirstUrl_(f.note.title + '\n' + f.note.content);
  if (!url) return { ok: false, error: 'This note has no link.' };
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VERA notes preview)' } });
  if (resp.getResponseCode() >= 400) return { ok: false, error: 'The page answered ' + resp.getResponseCode() + '.' };
  var pv = ntPreviewFromHtml_(resp.getContentText(), url);
  var v = {}; v[NT_COL_.LINK] = JSON.stringify(pv); ntSetCells_(f.row, v);
  return { ok: true, link: pv };
}

/** The Drive folder pictures go in, made the first time. */
function ntPicturesFolder_() {
  var it = DriveApp.getFoldersByName(NT_PICTURES_FOLDER_);
  return it.hasNext() ? it.next() : DriveApp.createFolder(NT_PICTURES_FOLDER_);
}

/** POST note_picture {id, imageBase64, mime} — attaches a picture, saved to the Notes folder in Drive. */
function webNotePicture_(body) {
  var refused = peopleOwnerOnly_(); if (refused) return refused;
  var b = body || {};
  var f = ntFind_(String(b.id || ''));
  if (f.note.vault) return { ok: false, error: 'The Vault is text only.' };
  var mime = /^image\/(png|jpeg|jpg|webp|heic|gif)$/i.test(String(b.mime || '')) ? b.mime : '';
  if (!mime || !b.imageBase64) return { ok: false, error: 'That isn’t a picture VERA can keep.' };
  var bytes = Utilities.base64Decode(String(b.imageBase64).replace(/^data:[^,]+,/, ''));
  if (bytes.length > 10 * 1024 * 1024) return { ok: false, error: 'That picture is over 10 MB.' };
  var file = ntPicturesFolder_().createFile(Utilities.newBlob(bytes, mime, 'note-' + f.note.id.slice(0, 8) + '-' + Date.now()));
  var v = {}; v[NT_COL_.PICTURE] = file.getId(); v[NT_COL_.UPDATED] = ntNow_(); ntSetCells_(f.row, v);
  return { ok: true, picture: file.getId() };
}

/** GET note_picture_view {id} — the note's picture as a data URL, for the dashboard. */
function webNotePictureView_(e) {
  var refused = peopleOwnerOnly_(); if (refused) return refused;
  var f = ntFind_(String((e && e.parameter && e.parameter.id) || ''));
  if (!f.note.picture) return { ok: false, error: 'No picture.' };
  var file = DriveApp.getFileById(f.note.picture), blob = file.getBlob();
  if (blob.getBytes().length > 4 * 1024 * 1024) { try { blob = file.getThumbnail(); } catch (err) {} }
  return { ok: true, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()), url: file.getUrl() };
}

/** The notes VERA may use (✨, never Vault), for chat. Reads the Doc directly: no request, no owner check. */
function ntForVera_(max) {
  try {
    return readAllNotes_(getNotesDocId_()).filter(function(n) { return n.share && !n.vault; }).slice(0, max || 15);
  } catch (e) { return []; }
}
