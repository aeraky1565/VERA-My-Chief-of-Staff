// Tech gear on Warranties & Service, the full dashboard (HomestewardView), at 390 and 1280:
// All · Tech · Home chips, Tech grouped by owner, a tech card (owner chip, model, plan bar,
// "security updates until … · estimate"), serial hidden behind Show then Copy, ✎ Tech details
// with 🔎 Look up support filling an estimate, the add form switching to tech fields for a
// Tech category, the replace / resell buttons near the end of support, no sideways scroll.
// Invented devices.
const { chromium } = require('playwright');
const path = require('path');
const ROOT = process.env.VERA_PAGES_ROOT || path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const ITEMS = [
  { row: 2, item: 'Fridge', category: 'Kitchen', warrantyExpiry: '2028-01-01', warrantyDays: 400, purchaseDate: '2025-01-01', isTech: false },
  { row: 3, item: 'Tablet A', category: 'Tech', isTech: true, owner: 'Sam', model: 'Tab Pro 11', serial: 'SN-ZX81', purchaseDate: '2025-03-01', warrantyExpiry: '2026-03-01', warrantyDays: -268,
    planName: 'CarePlus', planUntil: '2027-03-01', planDays: 97, supportUntil: '2029-10-31', supportDays: 1072, supportSource: 'estimate: about 6 years after release' },
  { row: 4, item: 'Phone D', category: 'Phone', isTech: true, owner: 'Alex', model: 'P8', supportUntil: '2027-04-01', supportDays: 128, supportSource: 'you' },
  { row: 5, item: 'Watch E', category: 'Watch', isTech: true, owner: '', model: '' },
];

async function mount(page) {
  return page.evaluate((items) => {
    if (typeof HomestewardView !== 'function') return { error: 'HomestewardView is not defined' };
    document.querySelectorAll('.modal-overlay').forEach(n => n.remove()); const root = document.getElementById('root'); if (root) root.style.display = 'none';
    window.__calls = []; window.confirm = () => true;
    try { navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; } catch (e) {}
    const host = document.createElement('div'); host.id = 'tgprobe'; document.body.prepend(host);
    ReactDOM.createRoot(host).render(React.createElement(HomestewardView, {
      items, loading: false, busy: false, onRecordService() {}, onDelete() {}, onSnooze() {}, onLinks() {},
      onAdd: f => window.__calls.push(['add', f]),
      onLookup: (item, model) => { window.__calls.push(['lookup', item, model]); return Promise.resolve({ ok: true, date: '2030-09-30', basis: 'Makers support phones about 5 years.', confidence: 'medium' }); },
      onTechSave: (row, item, t) => window.__calls.push(['save', row, item, t]),
      onPlanReplace: it => window.__calls.push(['replace', it.item]),
      onResell: it => window.__calls.push(['resell', it.item]),
    }));
    return new Promise(r => setTimeout(() => r({ ok: true }), 300));
  }, ITEMS);
}
const txt = (page, sel) => page.$eval(sel, n => n.innerText).catch(() => '');
const calls = page => page.evaluate(() => window.__calls);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of [390, 1280]) {
    console.log('\nfull dashboard @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    const m = await mount(page);
    if (m.error) { fail++; console.log('  FAIL ' + m.error); await page.close(); continue; }
    const P = '#tgprobe ';
    const chips = await page.$$eval(P + '.hs-chip-f', ns => ns.map(n => n.innerText));
    check('three chips with counts: All 4, Tech 3, Home 1', chips.join('|') === 'All · 4|💻 Tech · 3|🏠 Home · 1', chips.join('|'));
    await page.click(P + '.hs-chip-f:nth-child(3)');
    let names = await page.$$eval(P + '.hs-name', ns => ns.map(n => n.innerText));
    const homeTxt = await txt(page, '#tgprobe .hs');
    check('Home shows only the fridge (folded under Later)', !names.length && /Later · 1/.test(homeTxt) && !/Tablet A|Phone D/.test(homeTxt), names.join());
    await page.click(P + '.hs-chip-f:nth-child(2)');
    const groups = await page.$$eval(P + '.tg-ghead', ns => ns.map(n => n.innerText));
    check('Tech is grouped by owner, no owner = Shared, last', groups.slice(0, 2).map(g => g.toUpperCase()).sort().join('|') === 'ALEX · 1|SAM · 1' && groups[2].toUpperCase() === 'SHARED · 1', groups.join('|'));
    const card = P + '.hs-card[data-item="Tablet A"] ';
    const t = await txt(page, card.trim());
    check('a tech card: owner chip, model, plan bar, support line with estimate', /Sam/.test(await txt(page, card + '.tg-owner')) && /Tab Pro 11/.test(t) && /CarePlus to/.test(t) && !!(await page.$(card + '.tg-plan .hs-meter')) && /Security updates until Oct 31, 2029 · ~3 years/.test(t) && /estimate/i.test(await txt(page, card + '.tg-est')), t);
    check('the serial is hidden', !/SN-ZX81/.test(t) && /••••/.test(t));
    await page.click(card + '.tg-show');
    check('…Show reveals it, Copy copies it', /SN-ZX81/.test(await txt(page, card + '.tg-serial')) && await page.$(card + '.tg-copy') !== null);
    await page.click(card + '.tg-copy');
    check('…copied', (await page.evaluate(() => window.__copied)) === 'SN-ZX81');
    check('far from the end of support: no replace or resell', !(await page.$(card + '.tg-replace')) && !(await page.$(card + '.tg-resell')));
    const ph = P + '.hs-card[data-item="Phone D"] ';
    await page.click(ph + '.tg-replace'); await page.click(ph + '.tg-resell');
    const c1 = await calls(page);
    check('support ends within 6 months: ＋ Planned Purchases and List on Resell', c1.some(c => c[0] === 'replace' && c[1] === 'Phone D') && c1.some(c => c[0] === 'resell' && c[1] === 'Phone D'));
    check('…and no estimate badge for a date you typed', !(await page.$(ph + '.tg-est')));
    const we = P + '.hs-card[data-item="Watch E"] ';
    check('no support date: says the lookup can find it', /Support end not set/.test(await txt(page, we.trim())));
    await page.click(we + '.tg-edit');
    await page.fill(we + '.tg-model', 'Band 3');
    await page.click(we + '.tg-lookup');
    await page.waitForTimeout(150);
    check('Look up support fills the date and marks it an estimate', (await page.inputValue(we + '.tg-supportUntil')) === '2030-09-30' && /Estimate \(medium confidence\)/.test(await txt(page, we + '.tg-look')) && /estimate: Makers support/.test(await txt(page, we + '.tg-src')));
    await page.fill(we + '.tg-owner', 'Alex');
    await page.click(we + '.tg-save');
    const sv = (await calls(page)).filter(c => c[0] === 'save').pop();
    check('…Save sends the row, the name and the fields', sv && sv[1] === 5 && sv[2] === 'Watch E' && sv[3].model === 'Band 3' && sv[3].owner === 'Alex' && sv[3].supportUntil === '2030-09-30' && /^estimate:/.test(sv[3].supportSource), JSON.stringify(sv));
    await page.click(we + '.tg-edit');
    await page.fill(we + '.tg-supportUntil', '2031-01-01');
    check('a date typed by hand is "you"', /Source: you/.test(await txt(page, we + '.tg-src')));
    await page.click(we + '.tg-edit');
    // add form
    await page.click(P + '.add-item-btn');
    check('from the Tech chip, the add form starts as Tech with the tech fields', (await page.inputValue('.hs-sheet .hi-category')) === 'Tech' && !!(await page.$('.hs-sheet .tg-fields')));
    await page.fill('.hs-sheet .hi-category', 'Kitchen');
    check('…a non-tech category hides them', !(await page.$('.hs-sheet .tg-fields')));
    await page.fill('.hs-sheet .hi-category', 'laptop');
    await page.fill('.hs-sheet .hi-item', 'Laptop F'); await page.fill('.hs-sheet .tg-model', 'Air 13'); await page.fill('.hs-sheet .tg-serial', 'C02X');
    await page.click('.hs-sheet .hi-save');
    const ad = (await calls(page)).filter(c => c[0] === 'add').pop();
    check('…and the tech fields go with the new item', ad && ad[1].item === 'Laptop F' && ad[1].model === 'Air 13' && ad[1].serial === 'C02X' && ad[1].category === 'laptop', JSON.stringify(ad));
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('no sideways scroll', sw <= 0, sw);
    check('no page errors', !errors.length, errors.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
