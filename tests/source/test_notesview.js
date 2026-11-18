// Notes (#252: NotesTab, NqSheet, NqView, NqTidy, JotNoteTile, NotesHome, LinkedNotes, ProjectNotes
// in docs/app.js). Pins:
//  - just tags: chips with counts and a colour per tag; ✨ and 🔒 filters; pinned on top;
//  - search: every word must match, matches highlighted, a Vault note by its label only;
//  - a card shows 4 lines, a tap opens the whole note; checklists tick; the Vault hides on screen;
//  - Jot a note: one box, #tags, a suggested tag, ✨ / 🔒, routing words, Undo, "put it in the Vault?",
//    newer replaces older after asking;
//  - Tidy tags is a pop-up; Back today shows only when something comes back;
//  - linked notes still show on a person, trip or project, never a Vault note;
//  - the screen says notes are private and nothing goes to Memory.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }

const TODAY = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
// Invented notes.
const NOTES = [
  { id: 'n1', title: 'Boiler reset', content: 'Hold the button 10 s', category: 'Reference', dateAdded: '2026-03-01', pinned: true, tags: 'house', relatedTo: '' },
  { id: 'n2', title: 'Lisbon tram tips', content: 'Line 28 early', category: 'Travel', dateAdded: '2026-05-02', tags: '', relatedTo: 'Lisbon spring' },
  { id: 'n3', title: 'Wren sizes', content: 'Shoe 4, shirt M', category: 'General', dateAdded: '2026-04-01', tags: 'kids, sizes', relatedTo: 'Wren', share: true },
  { id: 'n4', title: 'Shed quotes', content: 'Three quotes by June', category: 'Finance', dateAdded: '2026-02-01', pinned: true, tags: '', relatedTo: 'Garden shed; Wren' },
  { id: 'n5', title: 'Move list', content: '- [x] boxes\n- [ ] tape\n- [ ] labels', category: '', dateAdded: '2026-06-01', tags: 'move', relatedTo: '', backOn: TODAY },
  { id: 'v1', title: 'Garage door', content: 'code 4471', dateAdded: '2026-06-02', tags: 'house', relatedTo: 'Wren', vault: true },
  { id: 'v2', title: 'Bank pin', content: '9911', dateAdded: '2026-06-03', tags: 'codes', vault: true, hideLabel: true },
  { id: 'n6', title: 'Size 9', content: '', dateAdded: '2026-06-04', tags: 'size' }];

console.log('\nthe pieces');
const U = { String, Number, Math, JSON, Date, RegExp, Object, Array }; vm.createContext(U);
vm.runInContext(['ntMatch_', 'ntLinked_', 'ntTagNorm_', 'ntTagList_', 'ntTagsOf_', 'ntParseTags_', 'ntWords_', 'ntHay_', 'ntSearch_', 'ntSort_', 'ntTagCounts_', 'ntBackToday_', 'ntChecklist_', 'ntToggleLine_', 'ntFactKey_', 'ntReplaces_', 'ntLookAlikes_', 'ntSuggestTag_', 'ntLooksSecret_', 'ntLabel_'].map(n => fnSrc(APP, n)).join('\n') + '\nvar NT_CHECK_RE=/^\\s*[-*]\\s*\\[( |x|X)\\]\\s*(.*)$/;', U);
try {
  check('Related To: exact, several split by ; or ,, and a longer name containing it', U.ntMatch_('Wren', ['wren']) && U.ntMatch_('Garden shed; Wren', ['Wren']) && U.ntMatch_('Ivy, Bo', ['bo']) && U.ntMatch_('Trip to Lisbon spring', ['Lisbon spring']) && !U.ntMatch_('Bob Lowe', ['Bo']));
  check('linked notes for a person, never a Vault note', J(U.ntLinked_(NOTES, ['Wren']).map(n => n.id)) === J(['n3', 'n4']));
  check('a note’s tags: its own, then its old category as one', J(U.ntTagsOf_(NOTES[1])) === '["travel"]' && J(U.ntTagsOf_(NOTES[2])) === '["kids","sizes"]' && J(U.ntTagsOf_(NOTES[0])) === '["house","reference"]');
  check('search: every word must match, over text, tags and Related To', J(U.ntSearch_(NOTES, 'shoe wren').map(n => n.id)) === '["n3"]' && J(U.ntSearch_(NOTES, '#travel').map(n => n.id)) === '["n2"]' && J(U.ntSearch_(NOTES, 'garden').map(n => n.id)) === '["n4"]');
  check('…a Vault note by its label only, and not at all when the label is hidden', J(U.ntSearch_(NOTES, 'garage').map(n => n.id)) === '["v1"]' && J(U.ntSearch_(NOTES, '4471').map(n => n.id)) === '[]' && J(U.ntSearch_(NOTES, 'bank').map(n => n.id)) === '[]');
  check('pinned first, then newest', J(U.ntSort_(NOTES.slice(0, 5)).map(n => n.id)) === J(['n1', 'n4', 'n5', 'n2', 'n3']));
  check('tag counts leave out a hidden Vault label', J(U.ntTagCounts_(NOTES)) === J({ house: 2, reference: 1, travel: 1, kids: 1, sizes: 1, finance: 1, move: 1, size: 1 }));
  check('Back today: notes due back on or before today', J(U.ntBackToday_(NOTES, TODAY).map(n => n.id)) === '["n5"]' && U.ntBackToday_(NOTES, '2000-01-01').length === 0);
  check('checklist lines, and a tick toggles one line', J(U.ntChecklist_(NOTES[4].content).map(c => c.done)) === '[true,false,false]' && U.ntToggleLine_(NOTES[4].content, 1) === '- [x] boxes\n- [x] tape\n- [ ] labels');
  check('newer replaces older: "shoe 4.5" finds "Shoe 4"? only a one-line note of that shape', U.ntReplaces_('Size 10', NOTES, 'x').id === 'n6' && U.ntReplaces_('Size 10\nfor boots', NOTES, 'x') === null);
  check('look-alike tags', J(U.ntLookAlikes_({ sizes: 3, size: 1 })) === '[["sizes","size"]]');
  check('a hidden Vault label reads Locked note', U.ntLabel_(NOTES[6]) === 'Locked note' && U.ntLabel_(NOTES[5]) === 'Garage door');
  check('the dashboard’s tag rules match the server’s (Notes.js)', U.ntSuggestTag_('shoe size 9') === 'sizes' && U.ntLooksSecret_('Garage code 4471') && J(U.ntParseTags_('a #B c #b')) === '["b"]');
} catch (e) { check('the pieces run', false, e.message); }

console.log('\nwiring');
check('Gift Ideas person cards show their notes', /function GiftIdeasView\(\{notes,/.test(APP) && APP.indexOf("h(LinkedNotes,{notes:notes||[],names:[person]})") !== -1);
check('a trip’s summary shows its notes', APP.indexOf(",viewMode==='summary'&&React.createElement(LinkedNotes,{apiUrl:apiUrl,apiToken:apiToken,names:[trip.label,trip.tripKey],title:\"Notes for this trip\"})") !== -1);
check('the Projects tab shows each project’s notes', APP.indexOf('React.createElement(ProjectNotes,{apiUrl:props.apiUrl,apiToken:props.apiToken,projects:props.projects})') !== -1);
check('Home: Jot a note between Log a grocery run and Away, then the notes search and Back today', APP.indexOf("React.createElement(GroceryRunButton,{apiUrl:apiUrl,apiToken:apiToken,who:'Ahmed',variant:'tile'}),React.createElement(JotNoteTile,{apiUrl:apiUrl,apiToken:apiToken}),React.createElement(AwayBanner,") !== -1 && /React\.createElement\(AwayBanner,\{[^}]*variant:'tile'\}\)\),React\.createElement\(NotesHome,/.test(APP));
check('a card shows 4 lines (2 on a phone)', /\.nq-body \{[^}]*-webkit-line-clamp: 4;/.test(read('docs/index.html')) && /\.nq-grid \.nq-body \{ -webkit-line-clamp: 2; \}/.test(read('docs/index.html')));
check('the installed app can share into Notes', /"share_target"[\s\S]*"action": "\.\/index\.html\?tab=life&sub=notes"/.test(read('docs/manifest-full.webmanifest')) && APP.indexOf("sessionStorage.setItem('vera_share_text'") !== -1);

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screen: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of (process.env.VERA_CTL_FAST ? [390] : [390, 1280])) {
    const L = '@' + width + ': ';
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ notes }) => {
      window.__gets = []; window.__posts = []; window.__notes = notes;
      window.apiGet = async (u, t, p) => { window.__gets.push(p); return p.action === 'get_notes' ? { ok: true, notes: window.__notes } : { ok: true }; };
      window.apiPost = async (u, t, b) => { window.__posts.push(b); if (b.action === 'note_capture') { if (/^remind me/i.test(b.text)) return { ok: true, kind: 'task', id: 'TASK-9', title: 'Call the vet', due: '' }; return { ok: true, kind: 'note', id: 'new1', title: b.text.split('\n')[0] }; } return { ok: true, changed: 1 }; };
      document.body.innerHTML = '<div id="nt" style="padding:0 16px"></div><div id="ln" style="padding:0 16px"></div><div id="pn" style="padding:0 16px"></div><div id="hm" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('nt')).render(React.createElement(NotesTab, { apiUrl: 'https://x.invalid/exec', apiToken: 't' }));
      ReactDOM.createRoot(document.getElementById('ln')).render(React.createElement(LinkedNotes, { notes, names: ['Wren'] }));
      ReactDOM.createRoot(document.getElementById('pn')).render(React.createElement(ProjectNotes, { apiUrl: 'x', apiToken: 't', projects: [{ projectId: 'p1', projectName: 'Garden shed' }, { projectId: 'p2', projectName: 'Attic' }] }));
      window.__nav = []; NT_CACHE_.p = null;
      ReactDOM.createRoot(document.getElementById('hm')).render(React.createElement('div', null, React.createElement(JotNoteTile, { apiUrl: 'x', apiToken: 't' }), React.createElement(NotesHome, { apiUrl: 'x', apiToken: 't', onNavigate: t => window.__nav.push(t) })));
    }, { notes: NOTES });
    await page.waitForTimeout(350);
    const ids = sel => page.$$eval(sel, ns => ns.map(n => n.dataset.note));
    const txt = sel => page.$eval(sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    try {
      check(L + 'Back today on top, only for the note coming back', J(await ids('#nt .nq-backsect .nq-card')) === '["n5"]');
      check(L + 'a pinned row, then the rest, newest first', J(await ids('#nt .nq-pinned .nq-card')) === J(['n1', 'n4']) && J(await ids('#nt > .nq > .nq-grid .nq-card')) === J(['n6', 'v2', 'v1', 'n5', 'n2', 'n3']));
      const chips = await page.$$eval('#nt .nq-chip', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + 'filters, then tag chips with counts, the most used first', chips[0] === 'All 8' && chips[1] === '✨ VERA can use 1' && chips[2] === '🔒 Vault 2' && chips[3] === '#house 2' && chips.indexOf('#travel 1') !== -1, J(chips));
      const disp = await page.$eval('#nt > .nq > .nq-grid', n => getComputedStyle(n).display);
      check(L + (width < 640 ? 'a list on a phone' : 'cards on a computer'), width < 640 ? disp === 'flex' : disp === 'grid', disp);
      const clamp = await page.$eval('#nt .nq-card[data-note="n2"] .nq-body', n => getComputedStyle(n).webkitLineClamp);
      check(L + 'a card shows up to ' + (width < 640 ? '2 lines on a phone' : '4 lines'), clamp === (width < 640 ? '2' : '4'), clamp);
      check(L + 'a Vault note’s body is hidden on its card; a hidden label reads Locked note', /Hidden · tap to open/.test(await txt('#nt .nq-card[data-note="v1"]')) && !/4471/.test(await txt('#nt .nq-card[data-note="v1"]')) && /^Locked note/.test(await txt('#nt .nq-card[data-note="v2"] .nq-title')));
      check(L + 'a card’s colour comes from its first tag', await page.$eval('#nt .nq-card[data-note="n5"]', n => getComputedStyle(n).borderLeftColor) !== await page.$eval('#nt .nq-card[data-note="n2"]', n => getComputedStyle(n).borderLeftColor));
      check(L + 'a checklist card counts what’s done', /1 of 3 done/.test(await txt('#nt .nq-card[data-note="n5"]')));
      await page.click('#nt .nq-chip >> text=#travel'); await page.waitForTimeout(40);
      check(L + 'a tag chip filters', J(await ids('#nt .nq-card')) === '["n2"]');
      await page.click('#nt .nq-chip >> text=✨ VERA can use'); await page.waitForTimeout(40);
      check(L + '✨ shows the notes VERA can use', J(await ids('#nt .nq-card')) === '["n3"]');
      await page.click('#nt .nq-chip >> text=All');
      await page.fill('#nt .nq-search', 'wren shoe'); await page.waitForTimeout(40);
      check(L + 'search: every word, highlighted', J(await ids('#nt .nq-card')) === '["n3"]' && J(await page.$$eval('#nt .nq-mark', ns => ns.map(n => n.innerText.toLowerCase()).sort())) === '["shoe","wren"]');
      await page.fill('#nt .nq-search', '4471'); await page.waitForTimeout(40);
      check(L + '…never inside a Vault note', (await ids('#nt .nq-card')).length === 0 && /No notes match/.test(await txt('#nt .nq-empty')));
      await page.fill('#nt .nq-search', '');
      check(L + 'it says notes are private and nothing goes to Memory', /VERA reads only the ones marked ✨\. Nothing here goes to Memory/.test(await txt('#nt .nq-foot')));
      // open a note
      await page.click('#nt .nq-card[data-note="n5"]'); await page.waitForTimeout(60);
      check(L + 'a tap opens the whole note', (await page.$$('.nq-view .nq-check')).length === 3);
      await page.click('.nq-view .nq-check:nth-of-type(2) input'); await page.waitForTimeout(60);
      const upd = (await page.evaluate(() => window.__gets)).filter(g => g.action === 'update_note').slice(-1)[0];
      check(L + '…a tick saves that one line', upd && upd.id === 'n5' && upd.content === '- [x] boxes\n- [x] tape\n- [ ] labels', J(upd));
      await page.click('.nq-view .nq-share'); await page.waitForTimeout(60);
      check(L + '…✨ turns on from the note', J((await page.evaluate(() => window.__gets)).slice(-2)[0]) !== '' && (await page.evaluate(() => window.__gets)).some(g => g.action === 'update_note' && g.share === 'true' && g.id === 'n5'));
      await page.fill('.nq-view .nq-backon input[type=date]', '2026-12-24');
      await page.check('.nq-view .nq-backtask input'); await page.click('.nq-view .nq-backset'); await page.waitForTimeout(60);
      check(L + '…"Bring this back on" can make a Task too', (await page.evaluate(() => window.__gets)).some(g => g.action === 'update_note' && g.backOn === '2026-12-24' && g.backTask === 'true'));
      await page.click('.nq-view .nq-x'); await page.waitForTimeout(40);
      await page.click('#nt .nq-card[data-note="v1"]'); await page.waitForTimeout(60);
      check(L + 'a Vault note opens hidden until tapped', !/4471/.test(await txt('.nq-view')) && (await page.$('.nq-view .nq-reveal')) !== null && (await page.$('.nq-view .nq-share')) === null && (await page.$('.nq-view .nq-attach')) === null);
      await page.click('.nq-view .nq-reveal'); await page.waitForTimeout(40);
      check(L + '…then shows', /4471/.test(await txt('.nq-view')));
      await page.click('.nq-view .nq-x'); await page.waitForTimeout(40);
      // Jot a note from the Notes screen
      await page.click('#nt .nq-add'); await page.waitForTimeout(60);
      await page.fill('.nq-sheet .nq-text', 'Wifi password is Lantern77');
      check(L + 'the sheet suggests a tag from the words', /＋ #codes/.test(await txt('.nq-sheet .nq-tagrow')));
      await page.click('.nq-sheet .nq-save'); await page.waitForTimeout(120);
      const cap = (await page.evaluate(() => window.__posts)).filter(b => b.action === 'note_capture').slice(-1)[0];
      check(L + 'a password asks “put it in the Vault?”, and saves there', dialogs.some(d => /Put it in the Vault\?/.test(d)) && cap.vault === true && cap.share === false, J(cap));
      check(L + 'a toast says what happened, with Undo', /Saved a note\./.test(await txt('#nt .nq-toast')) && (await page.$('#nt .nq-toast .nq-undo')) !== null);
      await page.click('#nt .nq-toast .nq-undo'); await page.waitForTimeout(60);
      check(L + 'Undo takes it back', (await page.evaluate(() => window.__posts)).slice(-1)[0].action === 'note_undo' && (await page.evaluate(() => window.__posts)).slice(-1)[0].id === 'new1');
      await page.click('#nt .nq-add'); await page.waitForTimeout(60);
      await page.fill('.nq-sheet .nq-text', 'Size 10');
      await page.click('.nq-sheet .nq-save'); await page.waitForTimeout(150);
      check(L + 'newer replaces older, after asking', dialogs.some(d => /Replace the older note “Size 9”/.test(d)) && (await page.evaluate(() => window.__gets)).some(g => g.action === 'delete_note' && g.id === 'n6') && /replacing “Size 9”/.test(await txt('#nt .nq-toast')));
      // Tidy tags
      await page.click('#nt .nq-tidy-open'); await page.waitForTimeout(60);
      check(L + 'Tidy tags is a pop-up that spots look-alikes', (await page.$('.nq-tidy[role=dialog]')) !== null && /Merge #size into #sizes/.test(await txt('.nq-tidy .nq-alike')));
      await page.click('.nq-tidy .nq-merge'); await page.waitForTimeout(80);
      const rt = (await page.evaluate(() => window.__posts)).filter(b => b.action === 'notes_retag').slice(-1)[0];
      check(L + '…and merges them', rt && rt.from === 'size' && rt.to === 'sizes' && /#size → #sizes on 1 note\./.test(await txt('.nq-tidy .nq-said')), J(rt));
      await page.click('.nq-tidy .nq-x'); await page.waitForTimeout(40);
      // Home
      await page.click('#hm .nq-tile'); await page.waitForTimeout(60);
      await page.fill('.nq-sheet .nq-text', 'remind me to call the vet');
      await page.click('.nq-sheet .nq-save'); await page.waitForTimeout(120);
      check(L + 'Home: Jot a note routes “remind me…” to a task, and says so', /Added a task: Call the vet/.test(await txt('#hm .nq-toast')));
      check(L + 'Home: Back today, only because a note comes back', /Back today · 1/.test(await txt('#hm .nq-back')));
      await page.fill('#hm .nq-search', 'tram'); await page.waitForTimeout(40);
      check(L + 'Home: the notes search shows matches', /Lisbon tram tips/.test(await txt('#hm .nq-hits')));
      await page.click('#hm .nq-hit'); await page.waitForTimeout(40);
      check(L + '…and opens Notes with it', J(await page.evaluate(() => window.__nav)) === '["life"]' && await page.evaluate(() => sessionStorage.getItem('vera_notes_q')) === 'tram' && await page.evaluate(() => localStorage.getItem('vera_life_sub')) === 'notes');
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press('/');
      check(L + '/ jumps to the notes search', await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-notes-search')));
      // linked notes
      check(L + 'a person’s linked notes, never a Vault one', J(await page.$$eval('#ln .ln-note', ns => ns.map(n => n.dataset.note))) === J(['n3', 'n4']));
      check(L + 'Projects: each project with notes', J(await page.$$eval('#pn .pn-proj', ns => ns.map(n => n.dataset.project))) === J(['Garden shed']));
    } catch (e) { check(L + 'the screen runs', false, e.message.split('\n')[0]); }
    check(L + 'no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
