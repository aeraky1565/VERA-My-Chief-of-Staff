// Home Front › Household: the cheat sheet (HouseholdInfo.js + HouseholdView). Pins:
//  - the sheet's Private and Emergency columns: read as true/false/blank, written from the switches,
//    kept when a save doesn't send them, named on a sheet made before they existed;
//  - "Still right ✓" stamps today on one section only;
//  - private is the line's own switch, else guessed from the label, and the sitter guide follows it
//    (the same rule in both dashboards);
//  - countdowns, the 12-month re-check, ⭐ lines, search, suggestions, the Contracts link;
//  - the screen at phone and computer width: emergency card, tiles or list, masked values, copy,
//    the edit sheet's switches, Still right, suggestions, the Contracts chip, the sitter guide,
//    no Print button. Invented lines.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HH = read('HouseholdInfo.js'), WEB = read('WebApp.js'), APP = read('docs/app.js'), LITE = read('docs/dashboard-lite.html');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }

// ---- a fake HouseholdInfo sheet -----------------------------------------------------------------
function fakeSheet(rows, maxCols) {
  const grid = rows.map(r => r.slice());
  let cols = maxCols || 8;
  const pad = r => { while (r.length < cols) r.push(''); return r; };
  grid.forEach(pad);
  const rng = (r, c, nr, nc) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
    setValues: v => v.forEach((row, i) => row.forEach((x, j) => { while (grid.length < r + i) grid.push(pad([])); grid[r - 1 + i][c - 1 + j] = x; })),
  });
  return { grid, getLastRow: () => grid.length, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; grid.forEach(pad); },
    getRange: rng, getSheetId: () => 7, appendRow: r => grid.push(pad(r.slice())), deleteRow: n => grid.splice(n - 1, 1) };
}
function ctx(sheet) {
  const c = { String, Number, Math, JSON, Date, parseInt, Logger: { log() {} }, CONFIG: { SHEET_ID: 'x' }, TABS: { HOUSEHOLD_INFO: 'HouseholdInfo' },
    Utilities: { formatDate: () => '2026-11-16' }, Session: { getScriptTimeZone: () => 'tz' },
    formatDateVal_: v => String(v == null ? '' : v), getSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }) };
  vm.createContext(c); vm.runInContext(HH, c); return c;
}
const HEAD = ['Section', 'Subsection', 'Label', 'Value', 'Notes', 'LastUpdated', 'Private', 'Emergency'];

console.log('\nthe sheet: Private and Emergency');
{
  const sh = fakeSheet([HEAD, ['Internet', '', 'Password', 'grey-otter', '', '2026-10-02', 'Yes', ''], ['Internet', '', 'Account number', '88123310', '', '2026-10-02', '', ''],
    ['Emergency contacts', '', 'Call first', 'Rania · 555-0131', '', '2025-01-02', 'No', 'Yes'], ['Home base', '', 'Address', '412 Linden Ct', '', '2026-10-02', 'no', 'TRUE']]);
  const c = ctx(sh);
  const d = c.getHouseholdInfoData_();
  const rows = {}; d.sections.forEach(s => s.subsections.forEach(ss => ss.rows.forEach(r => { rows[r.label] = r; })));
  check('Private reads as true / false, and blank as not set', rows.Password.private === true && rows['Call first'].private === false && rows['Account number'].private === null && rows.Address.private === false);
  check('Emergency reads as a star', rows['Call first'].star === true && rows.Address.star === true && rows.Password.star === false);
  check('each line keeps its own updated date', rows['Call first'].updated === '2025-01-02');
  c.webUpdateHouseholdRow_({ parameter: { rowNum: '3', section: 'Internet', label: 'Account number', value: '88123310', private: 'true', star: 'false' } });
  check('a save writes the switches as Yes / No', J(sh.grid[2].slice(6, 8)) === J(['Yes', 'No']), J(sh.grid[2]));
  c.webUpdateHouseholdRow_({ parameter: { rowNum: '2', section: 'Internet', label: 'Password', value: 'new-pass' } });
  check('…and a save that doesn’t send them keeps them', sh.grid[1][3] === 'new-pass' && sh.grid[1][6] === 'Yes');
  c.webAddHouseholdRow_({ parameter: { section: 'Shut-offs', label: 'Water', value: 'Basement', star: 'true' } });
  check('a new line takes its switches', J(sh.grid[5].slice(0, 8)) === J(['Shut-offs', '', 'Water', 'Basement', '', '2026-11-16', '', 'Yes']), J(sh.grid[5]));
  check('a line that has gone is refused, not written over', c.webUpdateHouseholdRow_({ parameter: { rowNum: '40', section: 'X', label: 'Y', value: 'Z' } }).ok === false);
  const r = c.webHouseholdSectionChecked_({ parameter: { section: 'Internet' } });
  check('Still right ✓ stamps today on that section only', r.ok && r.lines === 2 && sh.grid[1][5] === '2026-11-16' && sh.grid[2][5] === '2026-11-16' && sh.grid[3][5] === '2025-01-02');
  check('…and says when there is no such section', c.webHouseholdSectionChecked_({ parameter: { section: 'Nope' } }).ok === false && c.webHouseholdSectionChecked_({ parameter: {} }).ok === false);
  const old = fakeSheet([HEAD.slice(0, 6), ['Internet', '', 'Network', 'Maple', '', '2026-10-02']], 6);
  const c2 = ctx(old);
  check('a sheet made before the columns still reads', c2.getHouseholdInfoData_().sections[0].subsections[0].rows[0].private === null);
  c2.webUpdateHouseholdRow_({ parameter: { rowNum: '2', section: 'Internet', label: 'Network', value: 'Maple', private: 'false' } });
  check('…and the first save adds and names them', old.getMaxColumns() === 8 && J(old.grid[0].slice(6, 8)) === J(['Private', 'Emergency']) && old.grid[1][6] === 'No');
  check('the route is wired', /case 'household_section_checked':\s*return jsonOut_\(webHouseholdSectionChecked_\(e\)\)/.test(WEB));
}

console.log('\nprivate lines and the sitter guide (the same rule in both dashboards)');
const G = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array };
vm.createContext(G);
vm.runInContext(['hfGuideSensitive_', 'hfGuidePrivate_', 'hfGuideMask_', 'hfGuideBuild_'].map(n => fnSrc(APP, n)).join('\n'), G);
check('the line’s own switch wins, either way', G.hfGuidePrivate_({ label: 'Wi-Fi password', private: true }) && !G.hfGuidePrivate_({ label: 'Account number', private: false }));
check('…a line never set is guessed from its label', G.hfGuidePrivate_({ label: 'Member ID', private: null }) && !G.hfGuidePrivate_({ label: 'Provider' }));
{
  const data = { sections: [{ section: 'Internet', subsections: [{ subsection: '', rows: [{ label: 'Password', value: 'grey-otter-1984', private: true }, { label: 'Account number', value: '88123310', private: false }, { label: 'Policy', value: 'POL-2208' }] }] }] };
  const rows = G.hfGuideBuild_(data, { Internet: true }, {}).sections[0].subsections[0].rows;
  check('the guide masks what’s private and shows what’s switched off', rows[0].value === '••••1984' && rows[1].value === '88123310' && rows[2].value === '••••2208', J(rows));
  check('…and shows everything when you include private lines', G.hfGuideBuild_(data, { Internet: true }, { secrets: true }).sections[0].subsections[0].rows[0].value === 'grey-otter-1984');
}
check('the guide’s rule is the same code in lite', fnSrc(APP, 'hfGuidePrivate_') === fnSrc(LITE, 'hfGuidePrivate_') && fnSrc(APP, 'hfGuideBuild_') === fnSrc(LITE, 'hfGuideBuild_'));

console.log('\nthe rules behind the screen');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array };
vm.createContext(U);
vm.runInContext(APP.slice(APP.indexOf('var HH_SUGGEST_='), APP.indexOf('function hhToday_(')) + fnSrc(APP, 'hfGuideSensitive_') + fnSrc(APP, 'hfGuidePrivate_'), U);
const T = '2026-11-16';
check('a date value becomes a countdown', U.hhDateIn_('2027-06-30', T) === 'in 7 months' && U.hhDateIn_('Jun 30, 2027', T) === 'in 7 months' && U.hhDateIn_('2026-11-20', T) === 'in 4 days' && U.hhDateIn_('2026-11-13', T) === '3 days ago' && U.hhDateIn_('2026-11-16', T) === 'today');
check('…anything else isn’t one', ['Basement', '555-0131', '2026-13-40', ''].every(v => U.hhDateIn_(v, T) === ''));
check('a section is marked for a re-check after a year', U.hhStale_('2025-11-16', T) && !U.hhStale_('2025-11-17', T) && !U.hhStale_('', T));
const DATA = { sections: [
  { section: 'Emergency contacts', lastUpdated: '2025-01-02', subsections: [{ subsection: '', rows: [{ rowNum: 4, label: 'Call first', value: 'Rania · 555-0131', star: true, private: false }] }] },
  { section: 'Internet', lastUpdated: '2026-10-02', subsections: [{ subsection: '', rows: [{ rowNum: 2, label: 'Network', value: 'MapleHouse-5G' }, { rowNum: 3, label: 'Password', value: 'grey-otter-1984', private: true }] }] },
  { section: 'Insurance', lastUpdated: '2024-03-01', subsections: [{ subsection: 'Auto', rows: [{ rowNum: 6, label: 'Provider', value: 'Harbor Mutual' }, { rowNum: 7, label: 'Policy number', value: 'POL-2208' }] }] },
  { section: 'Shut-offs', lastUpdated: '2026-06-14', subsections: [{ subsection: '', rows: [{ rowNum: 9, label: 'Water', value: 'Basement, left of the heater', notes: 'red handle', star: true }] }] }] };
check('the emergency card is every ⭐ line, in sheet order', J(U.hhStarred_(DATA).map(r => r.rowNum)) === J([4, 9]));
check('search finds labels, values, notes and section names', J(U.hhFilter_(DATA, 'maple').map(s => s.section)) === J(['Internet']) && U.hhFilter_(DATA, 'red handle').length === 1 && U.hhFilter_(DATA, 'insurance')[0].subsections[0].rows.length === 2);
check('…but never a private value', U.hhFilter_(DATA, 'otter').length === 0);
const miss = U.hhMissing_(DATA).map(g => g.label);
check('suggestions: the common lines you don’t have yet', !miss.includes('Wi-Fi password') && !miss.includes('Water shut-off') && !miss.includes('Emergency contact') && miss.includes('Gas shut-off') && miss.includes('Trash day') && miss.includes('Vet'), J(miss));
const CON = [{ name: 'Car insurance', counterparty: 'Harbor Mutual', status: 'Active', daysUntil: 23 }, { name: 'Lease', counterparty: 'M. Brooks', status: 'Terminated', daysUntil: 2 }];
check('a group links to the contract it’s about (the company in a value)', U.hhContractFor_('Insurance', DATA.sections[2].subsections[0], CON).name === 'Car insurance' && U.hhContractText_(CON[0]) === 'Renews in 23 d · in Contracts');
check('…not to an ended contract, nor to unrelated lines', !U.hhContractFor_('Home base', { subsection: '', rows: [{ value: 'M. Brooks · 555-0190' }] }, CON) && !U.hhContractFor_('Internet', DATA.sections[1].subsections[0], CON));
check('section icons', U.hhIcon_('Internet') === '📶' && U.hhIcon_('Emergency contacts') === '🚨' && U.hhIcon_('Shut-offs') === '🧯' && U.hhIcon_('Insurance') === '🛡' && U.hhIcon_('Odd stuff') === '📄');

// ---- the screen ---------------------------------------------------------------------------------
const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screen: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of [390, 1280]) {   // both, even in a control: the layout differs
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ data, con }) => {
      window.__calls = []; window.__nav = []; window.confirm = () => true;
      try { localStorage.removeItem('vera_hh_suggest_off'); } catch (e) {}
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied = t; return Promise.resolve(); } }, configurable: true });
      window.apiGet = (u, t, q) => { window.__calls.push(q); return Promise.resolve(JSON.parse(JSON.stringify(q.action === 'get_household_info' ? data : q.action === 'get_contracts' ? { ok: true, contracts: con } : { ok: true }))); };
      document.body.innerHTML = '<div id="hh" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('hh')).render(React.createElement(HouseholdView, { apiUrl: 'https://vera.test/exec', apiToken: 't', onPick: s => window.__nav.push('sub:' + s), onOpenTab: (t, s) => window.__nav.push(t + ':' + s) }));
    }, { data: Object.assign({ ok: true, sheetUrl: 'https://example.test/sheet' }, DATA), con: CON });
    await page.waitForTimeout(400);
    const txt = await page.$eval('#hh', n => n.innerText);
    check('the emergency card: the ⭐ lines', /🚨 In an emergency/.test(txt) && (await page.$$('#hh .hh-em .hh-line')).length === 2);
    check('a private value is masked; the Show button reveals it', /••••1984/.test(txt) && !/grey-otter/.test(txt));
    await page.click('#hh .hh-sec .hh-line[data-row="3"] .hh-reveal'); await page.waitForTimeout(60);
    check('…', /grey-otter-1984/.test(await page.$eval('#hh .hh-sec .hh-line[data-row="3"]', n => n.innerText)));
    await page.click('#hh .hh-sec .hh-line[data-row="2"] .hh-copy'); await page.waitForTimeout(60);
    check('copy puts the value on the clipboard', (await page.evaluate(() => window.__copied)) === 'MapleHouse-5G');
    check('a stale section: the chip and Still right ✓', /A year since updated/.test(await page.$eval('#hh-sec-insurance', n => n.innerText)));
    await page.click('#hh-sec-insurance .hh-checked'); await page.waitForTimeout(80);
    check('…which marks it, through its route', (await page.evaluate(() => window.__calls)).some(q => q.action === 'household_section_checked' && q.section === 'Insurance'));
    const chip = await page.$eval('#hh-sec-insurance .hh-contract', n => n.innerText).catch(() => '');
    check('the Contracts link on the insurance it matches', chip === 'Renews in 23 d · in Contracts', chip);
    await page.click('#hh-sec-insurance .hh-contract'); await page.waitForTimeout(40);
    check('…opens Finances › Contracts', (await page.evaluate(() => window.__nav)).includes('finances:contracts'));
    await page.click('#hh .hh-to-guide'); await page.waitForTimeout(40);
    check('the sitter guide button opens the guide', (await page.evaluate(() => window.__nav)).includes('sub:guide'));
    check('no Print button', !/Print/.test(txt));
    const sugg = await page.$$eval('#hh .hh-sug', ns => ns.map(n => n.innerText));
    check('suggestions for what’s missing', sugg.includes('＋ Gas shut-off') && !sugg.includes('＋ Wi-Fi password'), sugg.join());
    // the edit sheet
    await page.click('#hh .hh-sec .hh-line[data-row="7"] .hh-line-main'); await page.waitForTimeout(80);
    check('tapping a line opens its edit sheet, Private already on for a policy number', !!(await page.$('#hh .hh-sheet')) && (await page.$eval('#hh .hh-tog-private', n => n.checked)) === true && (await page.$eval('#hh .hh-tog-star', n => n.checked)) === false);
    await page.click('#hh .hh-tog-star'); await page.click('#hh .hh-tog-private'); await page.click('#hh .hh-save'); await page.waitForTimeout(100);
    const up = (await page.evaluate(() => window.__calls)).filter(q => q.action === 'update_household_row').pop() || {};
    check('Save sends the line and both switches', up.rowNum === 7 && up.label === 'Policy number' && up.star === 'true' && up.private === 'false' && up.section === 'Insurance' && up.subsection === 'Auto', JSON.stringify(up));
    check('…and closes the sheet', !(await page.$('#hh .hh-sheet')));
    await page.click('#hh .hh-sug >> text=＋ Gas shut-off'); await page.waitForTimeout(60);
    check('a suggestion opens a new line, filled in', (await page.$eval('#hh .hh-in-label', n => n.value)) === 'Gas shut-off' && (await page.$eval('#hh .hh-in-section', n => n.value)) === 'Shut-offs');
    await page.click('#hh .hh-cancel'); await page.waitForTimeout(40);
    await page.click('#hh .hh-sug-off'); await page.waitForTimeout(40);
    check('Hide ✕ puts the suggestions away', !(await page.$('#hh .hh-suggest')));
    await page.fill('#hh .hh-search', 'water'); await page.waitForTimeout(60);
    check('search narrows to the matching lines', (await page.$$('#hh .hh-sec')).length === 1 && /Basement/.test(await page.$eval('#hh .hh-secs', n => n.innerText)));
    await page.fill('#hh .hh-search', ''); await page.waitForTimeout(40);
    const box = s => page.$eval(s, n => { const r = n.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; });
    const toc = await box('#hh .hh-toc'), secs = await box('#hh .hh-secs');
    if (width >= 900) check('a computer: the sections as a list on the left', toc[0] < secs[0] && Math.abs(toc[1] - secs[1]) < 4 && toc[2] < 260, J([toc, secs]));
    else check('a phone: section tiles above the sections, two across', toc[1] < secs[1] && (await page.$$eval('#hh .hh-tile', ns => ns.slice(0, 2).map(n => Math.round(n.getBoundingClientRect().top)))).reduce((a, b) => a === b ? a : -1) !== -1, J([toc, secs]));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
