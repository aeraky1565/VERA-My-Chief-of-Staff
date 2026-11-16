// People › Gift Ideas (Gifts.js, the gift routes, GiftIdeasView, the App handlers). Pins:
//  - an idea's Price and Link (cleaned), in named columns; on add and on update;
//  - Bought keeps it as given with the day and occasion; undo moves it back;
//  - the add handler keeps the saved idea (the server sends `entry`);
//  - the screen: people by next occasion, price and link chips, 🎁 Bought with the occasion
//    filled in, "Last: …", the Given fold, a nudge when an occasion is near with no idea.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const GI = read('Gifts.js'), WEB = read('WebApp.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = isoOf(new Date());
function sheetOf(rows) { let cols = rows[0].length; const pad = r => { while (r.length < cols) r.push(''); return r; }; rows.forEach(pad);
  return { rows, getLastRow: () => rows.length, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; rows.forEach(pad); }, appendRow: r => rows.push(pad(r.slice())),
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
      setValue: x => { rows[r - 1][c - 1] = x; }, setValues: v => v.forEach((row, i) => row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; })) }) }; }
function ctx(ideas, people) {
  const c = { String, Number, Math, JSON, Date, Object, isFinite, CONFIG: { SHEET_ID: 'x' }, TABS: { GIFT_IDEAS: 'I', GIFT_PEOPLE: 'P' },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => n === 'I' ? ideas : people }) }, Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: d => isoOf(d) } };
  vm.createContext(c); vm.runInContext(GI + '\n' + ['webGetGiftData_', 'webAddGiftIdea_'].map(n => fnSrc(WEB, n)).join('\n'), c); return c;
}

console.log('\nprice, link, given');
{
  const ideas = sheetOf([['ID', 'Person', 'Idea', 'Added Date'], ['g1', 'Sam', 'Bike helmet', '2026-10-01']]), people = sheetOf([['Name'], ['Sam']]);
  const c = ctx(ideas, people);
  check('prices and links are cleaned', c.giPrice_('$45') === 45 && c.giPrice_('45.5') === 45.5 && c.giPrice_('lots') === '' && c.giLink_('shop.example.test/helmet') === 'https://shop.example.test/helmet' && c.giLink_('javascript:alert(1)') === '' && c.giLink_('') === '');
  c.webUpdateGiftIdea_({ parameter: { id: 'g1', price: '$45', link: 'shop.example.test/h' } });
  check('update: Price and Link in named columns', J(ideas.rows[0].slice(4)) === J(['Price', 'Link', 'Given On', 'Occasion']) && ideas.rows[1][4] === 45 && ideas.rows[1][5] === 'https://shop.example.test/h', J(ideas.rows));
  const a = c.webAddGiftIdea_({ parameter: { person: 'Sam', idea: 'Lego set', price: '60', link: 'toys.example.test' } });
  check('add with a price and link', a.ok && a.entry.Price === 60 && ideas.rows[2][4] === 60 && ideas.rows[2][5] === 'https://toys.example.test');
  let r = c.webGiftGiven_({ parameter: { id: 'g1', occasion: 'Birthday 2026' } });
  check('Bought keeps it: Given On and Occasion', r.given && ideas.rows[1][6] === TODAY && ideas.rows[1][7] === 'Birthday 2026' && ideas.rows.length === 3);
  r = c.webGiftGiven_({ parameter: { id: 'g1', undo: '1' } });
  check('…undo moves it back', !r.given && ideas.rows[1][6] === '' && ideas.rows[1][7] === '');
  check('an unknown idea is refused', c.webGiftGiven_({ parameter: { id: 'nope' } }).ok === false);
  ideas.rows[1][6] = new Date(2025, 11, 20);
  const got = c.webGetGiftData_().ideas;
  check('the read: price, link, given date as yyyy-MM-dd', got[0].Price === 45 && got[0]['Given On'] === '2025-12-20' && got[1].Link === 'https://toys.example.test', J(got[0]));
}
check('the add handler keeps the saved idea (the server sends entry)', /i\.ID===tempId\?\(data\.entry\|\|data\.idea\|\|i\):i/.test(APP));

console.log('\nthe order and the occasion');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array, parseFloat }; vm.createContext(U);
vm.runInContext(['giNum_', 'giMoney_', 'giGiven_', 'giNext_', 'giOrder_', 'giOccasion_', 'giLast_'].map(n => fnSrc(APP, n)).join('\n'), U);
const DATES = [{ Label: 'Sam’s birthday', Person: 'Sam', daysUntil: 40, nextDate: '2026-12-26' }, { Label: 'Anniversary', Person: 'Victoria', daysUntil: 9, nextDate: '2026-11-25' }, { Label: 'Jo’s birthday', Person: 'jo', daysUntil: 120, nextDate: '2027-03-16' }, { Label: 'Old', Person: 'Sam', daysUntil: -3 }];
check('people by next occasion; no date last', J(U.giOrder_(['Sam', 'Ahmed', 'Jo', 'Victoria'], DATES)) === J(['Victoria', 'Sam', 'Jo', 'Ahmed']));
check('the occasion words', U.giOccasion_(DATES[0]) === 'Birthday 2026' && U.giOccasion_(DATES[1]) === 'Anniversary 2026' && /^Gift \d{4}$/.test(U.giOccasion_(null)));
check('the last given', U.giLast_([{ Idea: 'A', 'Given On': '2025-12-01' }, { Idea: 'B', 'Given On': '2026-03-01' }, { Idea: 'C' }]).Idea === 'B');

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
    await page.evaluate(({ dates }) => {
      window.__ev = []; window.confirm = () => true;
      const ideas = [{ ID: 'g1', Person: 'Sam', Idea: 'Bike helmet', Price: 45, Link: 'https://shop.example.test/h' }, { ID: 'g2', Person: 'Sam', Idea: 'Kite' },
        { ID: 'g3', Person: 'Sam', Idea: 'Scooter', Price: 80, 'Given On': '2025-12-20', Occasion: 'Birthday 2025' }];
      document.body.innerHTML = '<div id="gi" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('gi')).render(React.createElement(GiftIdeasView, { people: ['Sam', 'Victoria', 'Ahmed'], ideas, dates, loading: false, busy: false,
        onAddPerson: n => window.__ev.push(['person', n]), onDeletePerson: n => window.__ev.push(['delperson', n]), onAddIdea: (p, t, x) => window.__ev.push(['add', p, t, x]),
        onDeleteIdea: id => window.__ev.push(['del', id]), onUpdateIdea: (id, f) => window.__ev.push(['update', id, f]), onGiven: (id, o, u) => window.__ev.push(['given', id, o, !!u]) }));
    }, { dates: DATES });
    await page.waitForTimeout(200);
    check('people by next occasion, with it on the card', J(await page.$$eval('#gi .gi-card', ns => ns.map(n => n.dataset.person))) === J(['Victoria', 'Sam', 'Ahmed']) && /Anniversary · in 9 d/.test(await page.$eval('#gi .gi-card[data-person="Victoria"]', n => n.innerText)));
    check('no idea with an occasion near: says so', /No gift idea yet for Anniversary/.test(await page.$eval('#gi .gi-card[data-person="Victoria"]', n => n.innerText)));
    const sam = await page.$eval('#gi .gi-card[data-person="Sam"]', n => n.innerText);
    check('chips: price and link; given ones folded; "Last: …"', /Bike helmet \$45/.test(sam) && !!(await page.$('#gi .gi-chip[data-idea="g1"] .gi-link')) && !(await page.$('#gi .gi-chip[data-idea="g3"]')) && /Last: Scooter \(Birthday 2025\)/.test(sam) && /Given · 1 ▸/.test(sam), sam);
    await page.click('#gi .gi-chip[data-idea="g1"] .gi-bought'); await page.waitForTimeout(40);
    check('🎁 Bought fills in the next occasion', (await page.$eval('#gi .gi-in-occ', n => n.value)) === 'Birthday 2026');
    await page.click('#gi .gi-given-save');
    check('…and keeps it as given', J((await page.evaluate(() => window.__ev)).pop()) === J(['given', 'g1', 'Birthday 2026', false]));
    await page.click('#gi .gi-chip[data-idea="g2"] .gi-chip-t'); await page.fill('#gi .gi-in-price', '12'); await page.fill('#gi .gi-in-link', 'kites.example.test'); await page.click('#gi .gi-save');
    check('a chip edits its price and link', J((await page.evaluate(() => window.__ev)).pop()) === J(['update', 'g2', { price: '12', link: 'kites.example.test' }]));
    await page.click('#gi .gi-card[data-person="Sam"] .gi-more'); await page.fill('#gi .gi-card[data-person="Sam"] .gi-in-idea', 'Book'); await page.fill('#gi .gi-card[data-person="Sam"] .gi-in-newprice', '20'); await page.click('#gi .gi-card[data-person="Sam"] .gi-add-btn');
    check('adding with a price', J((await page.evaluate(() => window.__ev)).pop()) === J(['add', 'Sam', 'Book', { price: '20', link: '' }]));
    await page.click('#gi .gi-card[data-person="Sam"] .gi-fold'); await page.click('#gi .gi-undo');
    check('the Given fold, with undo', J((await page.evaluate(() => window.__ev)).pop()) === J(['given', 'g3', '', true]));
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
