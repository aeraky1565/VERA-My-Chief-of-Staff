// Notes (NotesTab, LinkedNotes, ProjectNotes in docs/app.js). Pins:
//  - a pinned row on top, category chips with counts, search over title, content, tags and Related To;
//  - cards on a computer, a list on a phone;
//  - a note's Related To links it to a person, trip or project, and it shows there too
//    (Gift Ideas person card, a trip's summary, the Projects tab);
//  - chat still writes to Memory (the screen says so).
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }

// Invented notes.
const NOTES = [
  { id: 'n1', title: 'Boiler code', content: 'Reset: hold 10 s', category: 'Reference', dateAdded: '2026-03-01', pinned: true, tags: 'house', relatedTo: '' },
  { id: 'n2', title: 'Lisbon tram tips', content: 'Line 28 early', category: 'Travel', dateAdded: '2026-05-02', pinned: false, tags: '', relatedTo: 'Lisbon spring' },
  { id: 'n3', title: 'Wren sizes', content: 'Shoe 4, shirt M', category: 'General', dateAdded: '2026-04-01', pinned: false, tags: 'kids, sizes', relatedTo: 'Wren' },
  { id: 'n4', title: 'Shed quotes', content: 'Three quotes by June', category: 'Finance', dateAdded: '2026-02-01', pinned: true, tags: '', relatedTo: 'Garden shed; Wren' },
  { id: 'n5', title: 'Old lesson', content: 'Book early', category: 'Lessons Learned', dateAdded: '2025-01-01', pinned: false, tags: '', relatedTo: '' }];

console.log('\nthe pieces');
const U = { String, Number, Math, JSON, Date, RegExp, Object, Array }; vm.createContext(U);
vm.runInContext(['ntMatch_', 'ntLinked_', 'ntFilter_', 'ntCounts_'].map(n => fnSrc(APP, n)).join('\n'), U);
try {
  check('Related To: exact, several split by ; or ,, and a longer name containing it', U.ntMatch_('Wren', ['wren']) && U.ntMatch_('Garden shed; Wren', ['Wren']) && U.ntMatch_('Bo; Garden shed', ['Bo']) && U.ntMatch_('Ivy, Bo', ['bo']) && U.ntMatch_('Lisbon spring', ['Lisbon spring 2026']) && U.ntMatch_('Trip to Lisbon spring', ['Lisbon spring']));
  check('…not a blank, and not a two-letter name inside a word', !U.ntMatch_('', ['Wren']) && !U.ntMatch_('Bob Lowe', ['Bo']) && U.ntMatch_('Bo', ['Bo']));
  check('linked notes for a person', J(U.ntLinked_(NOTES, ['Wren']).map(n => n.id)) === J(['n3', 'n4']));
  check('filter: pinned first then newest; category; search covers Related To and tags', J(U.ntFilter_(NOTES, 'All', '').map(n => n.id)) === J(['n1', 'n4', 'n2', 'n3', 'n5']) &&
    J(U.ntFilter_(NOTES, 'Travel', '').map(n => n.id)) === J(['n2']) && J(U.ntFilter_(NOTES, 'All', 'garden').map(n => n.id)) === J(['n4']) && J(U.ntFilter_(NOTES, 'All', 'sizes').map(n => n.id)) === J(['n3']));
  check('counts per category', J(U.ntCounts_(NOTES)) === J({ Reference: 1, Travel: 1, General: 1, Finance: 1, 'Lessons Learned': 1 }));
} catch (e) { check('the pieces run', false, e.message); }

console.log('\nwiring');
check('Gift Ideas person cards show their notes', /function GiftIdeasView\(\{notes,/.test(APP) && APP.indexOf("h(LinkedNotes,{notes:notes||[],names:[person]})") !== -1 && APP.indexOf('React.createElement(GiftIdeasView,{notes:pNotes||[],') !== -1);
check('a trip’s summary shows its notes', APP.indexOf(",viewMode==='summary'&&React.createElement(LinkedNotes,{apiUrl:apiUrl,apiToken:apiToken,names:[trip.label,trip.tripKey],title:\"Notes for this trip\"})") !== -1);
check('the Projects tab shows each project’s notes', APP.indexOf('React.createElement(ProjectNotes,{apiUrl:props.apiUrl,apiToken:props.apiToken,projects:props.projects})') !== -1);

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screen: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of [390, 1280]) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ notes }) => {
      window.__calls = [];
      const answer = q => { const a = new URLSearchParams(q).get('action'); window.__calls.push(a); return a === 'get_notes' ? { ok: true, notes } : a === 'get_note_categories' ? { ok: true, categories: ['General', 'Travel', 'Lessons Learned', 'Reference', 'Finance', 'Health'] } : { ok: true }; };
      window.fetch = async url => ({ json: async () => answer(String(url).split('?')[1] || '') });
      window.apiGet = async (u, t, p) => answer(new URLSearchParams(p).toString());
      document.body.innerHTML = '<div id="nt" style="padding:0 16px"></div><div id="ln" style="padding:0 16px"></div><div id="pn" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('nt')).render(React.createElement(NotesTab, { apiUrl: 'https://x.invalid/exec', apiToken: 't' }));
      ReactDOM.createRoot(document.getElementById('ln')).render(React.createElement(LinkedNotes, { notes, names: ['Wren'] }));
      ReactDOM.createRoot(document.getElementById('pn')).render(React.createElement(ProjectNotes, { apiUrl: 'x', apiToken: 't', projects: [{ projectId: 'p1', projectName: 'Garden shed' }, { projectId: 'p2', projectName: 'Attic' }] }));
    }, { notes: NOTES });
    await page.waitForTimeout(300);
    try {
      check('a pinned row on top, then the rest', J(await page.$$eval('#nt .nt-pinned .nt-card', ns => ns.map(n => n.dataset.note))) === J(['n1', 'n4']) &&
        J(await page.$$eval('#nt .nt-grid .nt-card', ns => ns.map(n => n.dataset.note))) === J(['n2', 'n3', 'n5']));
      const chips = await page.$$eval('#nt .nt-chip', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check('category chips with counts', chips[0] === 'All 5' && chips.indexOf('Travel 1') !== -1 && chips.indexOf('Health 0') !== -1, J(chips));
      const disp = await page.$eval('#nt .nt-grid', n => getComputedStyle(n).display);
      check(width < 640 ? 'a list on a phone' : 'cards on a computer', width < 640 ? disp === 'flex' : disp === 'grid', disp);
      const rel = await page.$eval('#nt .nt-card[data-note="n2"] .nt-rel', n => n.innerText);
      check('a card says where else it shows', rel === '↳ Lisbon spring', rel);
      await page.click('#nt .nt-chip >> text=Travel'); await page.waitForTimeout(40);
      check('a category chip filters', J(await page.$$eval('#nt .nt-card', ns => ns.map(n => n.dataset.note))) === J(['n2']));
      await page.click('#nt .nt-chip >> text=All');
      await page.fill('#nt .nt-search', 'garden'); await page.waitForTimeout(40);
      check('search reaches Related To', J(await page.$$eval('#nt .nt-card', ns => ns.map(n => n.dataset.note))) === J(['n4']));
      await page.fill('#nt .nt-search', '');
      check('it says chat goes to Memory', /in chat is kept in Memory/.test(await page.$eval('#nt .nt-foot', n => n.innerText)));
      await page.click('#nt .nt-add'); await page.waitForTimeout(40);
      check('the form offers the names already used for Related To', J(await page.$$eval('#nt-related option', ns => ns.map(n => n.value).sort())) === J(['Garden shed', 'Lisbon spring', 'Wren']));
      await page.click('text=Cancel'); await page.waitForTimeout(40);
      const lnk = await page.$$eval('#ln .ln-note', ns => ns.map(n => n.dataset.note));
      check('a person’s linked notes', J(lnk) === J(['n3', 'n4']) && /notes · 2/i.test(await page.$eval('#ln .ln-h', n => n.innerText)));
      await page.click('#ln .ln-note[data-note="n3"]');
      check('…tap one to read it all', await page.$eval('#ln .ln-note[data-note="n3"]', n => n.classList.contains('open') && /Shoe 4/.test(n.innerText)));
      check('Projects: each project with notes, none for a project without', J(await page.$$eval('#pn .pn-proj', ns => ns.map(n => n.dataset.project))) === J(['Garden shed']) && /Shed quotes/.test(await page.$eval('#pn', n => n.innerText)));
    } catch (e) { check('the screen runs', false, e.message.split('\n')[0]); }
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
