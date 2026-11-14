// Card Hub, as it renders. The full dashboard's Finances › Cards has four subtabs (Which card,
// My cards, Perks, Points); lite has Shopping › Which card (one best card a row, tap for the
// runner-up, search, abroad) and Finances › Our cards (a reference where a perk can be ticked).
// Each page's REAL components, fed invented cards, at phone (390) and desktop (1280) widths.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const PAGES = process.env.VERA_PAGES_ROOT || ROOT;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const thisMonth = new Date().toISOString().slice(0, 7);
const DATA = {
  ok: true,
  cards: [
    { id: 'CC-1', cardName: 'Gold', owner: 'Ahmed', authUser: 'Victoria', active: 'Yes', annualFee: 325, network: 'Amex', fxFeePct: '0', noFxFee: true, feeMonth: 'March', perksUsedValue: 240 },
    { id: 'CC-2', cardName: 'Sapphire', owner: 'Ahmed', active: 'Yes', annualFee: 550, network: 'Visa', noFxFee: true, perksUsedValue: 600 },
    { id: 'CC-3', cardName: 'Freedom', owner: 'Victoria', active: 'Yes', annualFee: 0, network: 'Visa', fxFeePct: '3' },
    { id: 'CC-4', cardName: 'Cash Card', owner: 'Victoria', active: 'Yes', annualFee: 0, network: 'Mastercard' },
    { id: 'CC-5', cardName: 'Old Card', owner: 'Victoria', active: 'Yes', annualFee: 0, network: 'Visa', closed: '2026-01' },
  ],
  rewards: [
    { id: 'CR-1', cardName: 'Gold', category: 'Groceries', rate: '4', rateType: 'x points' },
    { id: 'CR-2', cardName: 'Cash Card', category: 'Groceries', rate: '3', rateType: '% cashback' },
    { id: 'CR-3', cardName: 'Freedom', category: 'Costco', rate: '2', rateType: '% cashback' },
    { id: 'CR-4', cardName: 'Cash Card', category: 'Costco', rate: '5', rateType: '% cashback' },
    { id: 'CR-5', cardName: 'Sapphire', category: 'Travel', rate: '3', rateType: 'x points' },
    { id: 'CR-6', cardName: 'Freedom', category: 'General Spend', rate: '1.5', rateType: '% cashback' },
    { id: 'CR-7', cardName: 'Old Card', category: 'Groceries', rate: '9', rateType: '% cashback' },
  ],
  perks: [
    { id: 'CP-1', cardName: 'Gold', perk: 'Dining credit', amount: 10, frequency: 'Monthly' },
    { id: 'CP-2', cardName: 'Sapphire', perk: 'Hotel credit', amount: 50, frequency: 'Semiannual' },
    { id: 'CP-3', cardName: 'Sapphire', perk: 'Lounge access', frequency: 'Standing' },
    { id: 'CP-4', cardName: 'Gold', perk: 'Global Entry', amount: 120, frequency: 'Every 4 Years', lastUsed: '2025-05-01' },
    { id: 'CP-5', cardName: 'Gold', perk: 'Streaming', amount: 7, frequency: 'Monthly', lastUsed: thisMonth },
    { id: 'CP-6', cardName: 'Old Card', perk: 'Closed card perk', amount: 5, frequency: 'Monthly' },
  ],
  programs: [
    { id: 'LP-1', program: 'Amex MR', owner: 'Ahmed', linkedCard: 'CC-1', totalPoints: 80000, centsPerPoint: '1.6', memberNo: '1234', status: '', expiry: '' },
    { id: 'LP-2', program: 'Marriott Bonvoy', owner: 'Victoria', totalPoints: 61200, expiry: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10), status: 'Gold', statusRenews: '2027-01-31', transfersFrom: 'Amex MR 1:1' },
  ],
  goals: [{ id: 'RG-1', goal: 'Hawaii nights', targetProgram: 'Marriott Bonvoy', targetPoints: 100000, currentPoints: 61200, fromProgram: true, transferable: 0 }],
  history: { 'LP-2': [{ date: '2026-08-01', points: 40000 }, { date: '2026-09-01', points: 52000 }, { date: '2026-10-01', points: 61200 }] },
  perkUses: [],
};

async function open(browser, file, width) {
  const vendor = {
    'react.production.min.js': fs.readFileSync(path.join(PAGES, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.join(PAGES, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const body = fs.readFileSync(path.join(PAGES, 'docs', file), 'utf8');
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.route('**/*', route => {
    const u = route.request().url();
    for (const n of Object.keys(vendor)) if (u.includes(n)) return route.fulfill({ contentType: 'application/javascript', body: vendor[n] });
    if (u.indexOf('/exec') !== -1) {
      const a = new URL(u).searchParams.get('action');
      if (a === 'toggle_card_perk') page.__toggled = (page.__toggled || []).concat(new URL(u).searchParams.get('id'));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(a === 'cards' || !a ? DATA : { ok: true }) });
    }
    if (u.startsWith('https://vera.test/')) return route.fulfill({ contentType: 'text/html', body });
    return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
  });
  await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 'test-token'); });
  await page.goto('https://vera.test/' + file, { waitUntil: 'networkidle' });
  return { page, errors };
}

// Mounts a component into a fresh host on the page; the component fetches through the routed /exec.
async function mount(page, comp, props) {
  return page.evaluate(({ comp, props }) => {
    document.querySelectorAll('#chprobe').forEach(n => n.remove());
    const fn = { CardHubFull: typeof CardHubFull === 'function' ? CardHubFull : null, CardsTab: typeof CardsTab === 'function' ? CardsTab : null }[comp];
    if (!fn) return 'missing ' + comp;
    const host = document.createElement('div'); host.id = 'chprobe'; host.style.maxWidth = '100%';
    document.body.prepend(host);
    ReactDOM.createRoot(host).render(React.createElement(fn, Object.assign({ apiUrl: 'https://vera.test/exec', apiToken: 't' }, props)));
    return 'ok';
  }, { comp, props });
}
const txt = (page, sel) => page.$$eval('#chprobe ' + sel, ns => ns.map(n => n.textContent.trim()));
const wait = ms => new Promise(r => setTimeout(r, ms));
const noSideScroll = page => page.evaluate(() => { const h = document.getElementById('chprobe'); return !!h && h.scrollWidth <= h.clientWidth + 1 && h.getBoundingClientRect().right <= window.innerWidth + 1; });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  for (const width of [390, 1280]) {
    console.log('\nfull dashboard, Finances › Cards, at ' + width);
    const { page, errors } = await open(browser, 'index.html', width);
    await page.evaluate(() => { try { localStorage.removeItem('vera_cardhub_sub'); } catch (e) {} });
    check('mounted', (await mount(page, 'CardHubFull', {})) === 'ok');
    await wait(700);
    check('four subtabs with their own icons', JSON.stringify(await txt(page, '.ch-nav [role=tab]')) === JSON.stringify(['🥇 Which card', '📇 My cards', '🎫 Perks', '🪙 Points']));
    check('Which card opens first', (await page.$('#chprobe .ch-which')) !== null);
    const groups = await txt(page, '.ch-grp');
    check('the fixed groups, in order', JSON.stringify(groups.slice(0, 3)) === JSON.stringify(['Everyday', 'Travel', 'Online & bills']), groups.join(' | '));
    const rows = await page.$$eval('#chprobe .ch-row', ns => ns.map(n => ({ label: n.children[0].textContent, best: n.querySelector('.ch-best').textContent, val: n.querySelector('.ch-val').textContent, ru: (n.querySelector('.ch-ru') || {}).textContent || '' })));
    const row = l => rows.find(r => r.label.indexOf(l) !== -1) || {};
    check('groceries: 4x Amex points at 1.6¢ beats 3% cash, owner tagged', /^Gold/.test(row('Groceries').best) && /Ahmed/.test(row('Groceries').best) && row('Groceries').val === '4x ≈ 6.4¢' && /Cash Card/.test(row('Groceries').ru), JSON.stringify(row('Groceries')));
    check('a closed card never shows', !rows.some(r => /Old Card/.test(r.best + r.ru)));
    check('Costco: the Visa, not the 5% Mastercard', /^Freedom/.test(row('Costco').best) && !/Cash Card/.test(row('Costco').best + row('Costco').ru), JSON.stringify(row('Costco')));
    check('flights from the broad travel rate', /^Sapphire/.test(row('Flights').best) && /travel rate/.test(row('Flights').val));
    await page.fill('#chprobe .ch-search', 'costco');
    await wait(150);
    check('search narrows the list', JSON.stringify((await txt(page, '.ch-row > div:first-child')).map(s => s.replace(/^\S+\s/, ''))) === JSON.stringify(['Costco']));
    await page.fill('#chprobe .ch-search', '');
    await page.click('#chprobe .ch-chip:has-text("abroad")');
    await wait(150);
    const away = await page.$$eval('#chprobe .ch-best', ns => ns.map(n => n.textContent));
    check('“I’m abroad”: only no-FX cards', away.length > 0 && away.every(t => /^(Gold|Sapphire)/.test(t)), away.join(' | '));
    await page.click('#chprobe .ch-chip:has-text("abroad")');
    await page.click('#chprobe .ch-chip:has-text("Victoria")');
    await wait(150);
    const vic = await page.$$eval('#chprobe .ch-best', ns => ns.map(n => n.textContent));
    check('Victoria’s: her cards and the ones she’s authorised on', vic.length > 0 && vic.every(t => /^(Gold|Freedom|Cash Card)/.test(t)), vic.join(' | '));
    check('no sideways scroll on Which card', await noSideScroll(page));

    await page.click('#chprobe .ch-nav [role=tab]:has-text("My cards")');
    await wait(500);
    check('My cards: the tracker, perks used against each fee', (await page.$('#chprobe .ch-payback')) !== null && /\$240 of \$325 fee · March/.test((await txt(page, '.ch-pay')).join(' | ')));
    check('…and the old cheat sheet and hub are not repeated there', !/Quick-Reference Cheat Sheet|Rewards & Redemption Hub/.test(await page.textContent('#chprobe')));
    await page.click('#chprobe tr:has-text("Gold")');
    await wait(300);
    check('a card’s pop-up lets a rate be edited', (await page.$('[data-edit-rate="CR-1"]')) !== null);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === '×' && x.closest('[style*="position: fixed"]')); if (b) b.click(); });

    await page.click('#chprobe .ch-nav [role=tab]:has-text("Perks")');
    await wait(500);
    const perks = await page.$$eval('#chprobe .ch-perk', ns => ns.map(n => ({ id: n.dataset.perk, text: n.textContent, checked: n.querySelector('input').checked, disabled: n.querySelector('input').disabled })));
    const perk = id => perks.find(p => p.id === id) || {};
    check('every open card’s perks on one list; a closed card’s are out', perks.length === 5 && !perk('CP-6').id, perks.map(p => p.id).join());
    check('each perk shows its own cycle and reset', /Monthly/.test(perk('CP-1').text) && /Resets/.test(perk('CP-1').text) && /Semiannual/.test(perk('CP-2').text) && /Every 4 years/.test(perk('CP-4').text) && /Always on/.test(perk('CP-3').text));
    check('due ones first; used, standing and claimed multi-year last', perks.slice(-3).map(p => p.id).sort().join() === 'CP-3,CP-4,CP-5', perks.map(p => p.id).join());
    check('a used perk is ticked; a standing one can’t be', perk('CP-5').checked && perk('CP-3').disabled);
    const chips = await txt(page, '.ch-perks .ch-chip');
    check('a filter for each cycle there is', ['All', 'Monthly', 'Semiannual', 'Always on', 'Multi-year'].every(c => chips.indexOf(c) !== -1), chips.join(' | '));
    await page.click('#chprobe .ch-perks .ch-chip:text-is("Semiannual")');
    await wait(150);
    check('…and it filters', JSON.stringify(await page.$$eval('#chprobe .ch-perk', ns => ns.map(n => n.dataset.perk))) === JSON.stringify(['CP-2']));
    await page.click('#chprobe .ch-perk[data-perk="CP-2"] input');
    await wait(300);
    check('ticking a perk saves it', (page.__toggled || []).indexOf('CP-2') !== -1, JSON.stringify(page.__toggled));

    await page.click('#chprobe .ch-nav [role=tab]:has-text("Points")');
    await wait(500);
    const progs = await page.$$eval('#chprobe .ch-prog', ns => ns.map(n => n.textContent));
    check('programs with owner, member #, status and renewal', /Amex MR.*Ahmed.*# 1234/.test(progs[0]) && /Marriott Bonvoy.*Victoria.*Gold · renews 2027-01-31/.test(progs[1]), progs.join(' || '));
    check('your ¢ beside the typical ¢, and the $ value', /Your value 1\.6¢/.test(progs[0]) && /Typical 1\.6¢/.test(progs[0]) && /≈ \$1,280/.test(progs[0]) && /Your value 0\.8¢/.test(progs[1]));
    check('transfers from, and a balance trend', /Transfers from Amex MR 1:1/.test(progs[1]) && (await page.$('#chprobe [data-program="LP-2"] .ch-spark')) !== null && (await page.$('#chprobe [data-program="LP-1"] .ch-spark')) === null);
    check('points expiring within 90 days are called out', /Marriott Bonvoy expires/.test((await txt(page, '.ch-expiring')).join('')));
    check('a goal reads its program', /61,200 in Marriott Bonvoy of 100,000 · 38,800 to go/.test((await txt(page, '.ch-goal-src')).join('')));
    check('no sideways scroll on Points', await noSideScroll(page));
    check('no script errors', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  for (const width of [390, 1280]) {
    console.log('\nlite at ' + width);
    const { page, errors } = await open(browser, 'dashboard-lite.html', width);
    check('Shopping › Which card mounted', (await mount(page, 'CardsTab', { part: 'cheat' })) === 'ok');
    await wait(900);
    const lrows = await page.$$eval('#chprobe .ch-lrow', ns => ns.map(n => n.textContent));
    check('one best card a row, no group headings', lrows.length >= 10 && (await page.$$('#chprobe .ch-grp')).length === 0 && (await page.$$('#chprobe .ch-ru')).length === 0, lrows.length);
    check('…with the owner and the value', /Groceries.*Gold.*Ahmed.*4x ≈ 6\.4¢/.test(lrows.find(t => /Groceries/.test(t)) || ''));
    check('no person filter or Copy in lite', !(await txt(page, '.ch-chip')).some(t => /Ahmed|Victoria|Copy/.test(t)));
    await page.click('#chprobe .ch-lrow:has-text("Groceries")');
    await wait(150);
    check('tap a row for the runner-up', /Runner-up: Cash Card \(Victoria\) · 3%/.test((await txt(page, '.ch-ru')).join('')));
    await page.fill('#chprobe .ch-search', 'gas');
    await wait(150);
    check('search', (await page.$$('#chprobe .ch-lrow')).length === 1 || (await page.$$('#chprobe .ch-lrow')).length === 0);
    await page.fill('#chprobe .ch-search', '');
    await page.click('#chprobe .ch-chip:has-text("abroad")');
    await wait(150);
    const best = await page.$$eval('#chprobe .ch-best', ns => ns.map(n => n.textContent));
    check('abroad leaves only no-FX cards, “Abroad” first', best.every(t => /^(Gold|Sapphire)/.test(t)) && /Abroad/.test((await txt(page, '.ch-lrow'))[0] || ''));
    check('no sideways scroll', await noSideScroll(page));

    check('Finances › Our cards mounted', (await mount(page, 'CardsTab', { part: 'ref' })) === 'ok');
    await wait(900);
    const ref = await page.$$eval('#chprobe .ch-refcard', ns => ns.map(n => n.textContent));
    check('a card each, what it’s best for, who can use it, the foreign fee and the annual fee', ref.length === 4 && /Gold.*Best for Groceries.*Can use Ahmed, Victoria.*Foreign fee 0%.*Fee \$325/.test(ref[0]) && /Freedom.*Foreign fee 3%.*Fee none/.test(ref.find(t => /Freedom/.test(t)) || ''), ref.join(' || '));
    check('nothing to edit there', (await page.$$('#chprobe button')).every(async () => true) && !/Add Card|＋ Program|＋ Goal|✏️/.test(await page.textContent('#chprobe')));
    await page.click('#chprobe .ch-chip:text-is("Perks")');
    await wait(200);
    check('Perks: each with its cycle and reset', /Dining credit.*Monthly.*Resets/.test((await txt(page, '.ch-perk')).join(' ')));
    check('…no person filter there', !(await txt(page, '.ch-perks .ch-chip')).some(t => /Ahmed|Victoria/.test(t)));
    await page.click('#chprobe .ch-perk[data-perk="CP-1"] input');
    await wait(300);
    check('…and a perk can be ticked as used', (page.__toggled || []).indexOf('CP-1') !== -1);
    await page.click('#chprobe .ch-chip:text-is("Points")');
    await wait(200);
    check('Points: read only', (await page.$$('#chprobe .ch-prog')).length === 2 && !/✏️ Update|＋ Program/.test(await page.textContent('#chprobe')));
    check('no sideways scroll', await noSideScroll(page));
    check('no script errors', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
