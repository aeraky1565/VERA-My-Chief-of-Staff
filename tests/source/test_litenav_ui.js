// Lite, simplified: the bottom bar (Today · Lists · Chat · Trips · All), the All screen, and Today
// (the day first, "Needs you", tiles that each say one thing). The REAL lite page, its fetches served
// from invented data, the page clock held at Mon 25 Jan 2027, on an emulated iPhone 13 and at 1280.
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const PAGES = process.env.VERA_PAGES_ROOT || ROOT;
const LITE = fs.readFileSync(path.join(PAGES, 'docs/dashboard-lite.html'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

console.log('\nthe source');
check('the page runs to the screen edges on iPhone', /<meta name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover" \/>/.test(LITE));
check('the bar pads itself clear of the home indicator', /\.lite-bar \{[^}]*calc\(8px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(LITE)
      && /\.lite-main \{[^}]*calc\(96px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(LITE));
check('no row of tabs across the top any more', !/\{\/\* Tab bar \*\/\}/.test(LITE) && /<LiteBottomBar active=\{activeTab\} onGo=\{setActiveTab\} \/>/.test(LITE));
check('the tab ids People & access knows are unchanged', ((LITE.match(/const TOP_TABS = \[[\s\S]*?\];/) || [''])[0].match(/id: '(\w+)'/g) || []).join() === "id: 'overview',id: 'chat',id: 'shopping',id: 'home_front',id: 'travel',id: 'finances',id: 'family',id: 'projects'");
check('ARIA’s banner moved to Trips, the grocery run to Lists', /<AriaBookBanner apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>\s*\n\s*<VeraTileNav name="lite_travel"/.test(LITE)
      && !/AriaBookBanner|GroceryRunButton/.test((LITE.match(/function OverviewLiteTab[\s\S]*?\nfunction App\(\)/) || [''])[0]));

const D = '2027-01-25';
const DATA = {
  whoami: { ok: true, name: 'Victoria', view: 'lite', hidden: [] },
  status: { ok: true, features: {}, rosterLinks: {} },
  shopping: { ok: true, stores: [
    { tabId: 't1', storeName: 'Costco', items: [{ index: 0, text: 'Eggs', done: false }, { index: 1, text: 'Milk', done: false }, { index: 2, text: 'Paper towels', done: true }] },
    { tabId: 't2', storeName: 'Target', items: [{ index: 0, text: 'Socks', done: false }] },
    { tabId: 't3', storeName: 'Pharmacy', items: [] }] },
  cards: { ok: true,
    cards: [{ id: 'CC-1', cardName: 'Gold', owner: 'Ahmed', authUser: 'Victoria', active: 'Yes', annualFee: 325, network: 'Amex', noFxFee: true },
            { id: 'CC-3', cardName: 'Freedom', owner: 'Victoria', active: 'Yes', annualFee: 0, network: 'Visa' },
            { id: 'CC-9', cardName: 'Old Card', owner: 'Victoria', active: 'Yes', annualFee: 0, closed: '2026-01' }],
    rewards: [{ cardName: 'Gold', category: 'Groceries', rate: '4', rateType: 'x points' }, { cardName: 'Freedom', category: 'Gas', rate: '3', rateType: '% cashback' },
              { cardName: 'Freedom', category: 'Groceries', rate: '3', rateType: '% cashback' }],
    programs: [{ id: 'LP-1', program: 'Amex MR', linkedCard: 'CC-1', centsPerPoint: '1.6' }],
    perks: [{ id: 'CP-1', cardName: 'Gold', perk: 'Dining credit', amount: 10, frequency: 'Monthly' },          // 6 days left: in
            { id: 'CP-2', cardName: 'Gold', perk: 'Hotel credit', amount: 50, frequency: 'Quarterly' },        // 65 days: out
            { id: 'CP-3', cardName: 'Gold', perk: 'Streaming', amount: 7, frequency: 'Monthly', lastUsed: '2027-01' }, // used: out
            { id: 'CP-4', cardName: 'Gold', perk: 'Lounges', frequency: 'Standing' },                          // standing: out
            { id: 'CP-5', cardName: 'Gold', perk: 'Phone credit', amount: 15, frequency: 'Monthly', autopay: true }, // autopay: out
            { id: 'CP-6', cardName: 'Old Card', perk: 'Closed perk', amount: 5, frequency: 'Monthly' }] },     // closed card: out
  get_coupons: { ok: true, coupons: [{ ID: 'CO-1', Store: 'Costco', Offer: '$5 off detergent', Expires: '2027-01-27', Status: '' },
                                     { ID: 'CO-2', Store: 'Target', Offer: '10% off', Expires: '2027-01-20', Status: '' },
                                     { ID: 'CO-3', Store: 'Kohls', Offer: '$10 off', Expires: '2027-02-10', Status: '' }] },
  prescriptions: { ok: true, prescriptions: [{ id: 'RX-1', medication: 'Vitamin D', active: 'Yes', refillDate: '2027-01-28' }, { id: 'RX-2', medication: 'Old', active: 'No', refillDate: '2027-01-26' }] },
  pto: { ok: true, ahmedStats: { upcomingTravel: [{ startDate: '2027-02-04', endDate: '2027-02-11', label: 'Lisbon' }] } },
  bills: { ok: true, bills: [{ bill: 'Rent', dueDay: 1, paid: true }, { bill: 'Water', dueDay: 30, paid: false }, { bill: 'Internet', dueDay: 27, paid: false }] },
  get_chores: { ok: true, chores: [
    { ID: 'ch_1', Chore: 'Clean gutters', Cadence: 'Quarterly', Checked: false, upkeep: { days: -2, next: '2027-01-23', status: 'overdue' } },
    { ID: 'ch_2', Chore: 'Change the filter', Cadence: 'Quarterly', Checked: false, upkeep: { days: 2, next: '2027-01-27', status: 'soon' } },
    { ID: 'ch_3', Chore: 'Dishes', Cadence: 'Daily', Checked: false },
    { ID: 'ch_4', Chore: 'Laundry', Cadence: 'Daily', Checked: 'TRUE' },
    { ID: 'ch_5', Chore: 'Trash', Cadence: 'Weekly', Checked: false },
    { ID: 'ch_6', Chore: 'Descale kettle', Cadence: 'Yearly', Checked: false, upkeep: { days: 40, next: '2027-03-06', status: 'ok' } }] },
  get_todays_events: { ok: true, calendarFound: true, events: [{ title: 'Swim lesson', startTime: '10:30', endTime: '11:30' }, { title: 'Dinner with friends', startTime: '19:30', location: 'Home' }] },
  get_packing: { ok: true, items: [{ item: 'Passport', status: 'ready', checked: false, person: 'Victoria' }, { item: 'Charger', status: 'tobuy', checked: false, person: '' },
                                   { item: 'Scarf', status: 'ready', checked: false, person: 'Both' }, { item: 'Shoes', status: 'bag', checked: true, person: 'Victoria' },
                                   { item: 'Laptop', status: 'ready', checked: false, person: 'Ahmed' }] },
};

async function open(browser, opts, hidden) {
  const vendor = {
    'react.production.min.js': fs.readFileSync(path.join(PAGES, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.join(PAGES, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [], calls = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.clock.setFixedTime(new Date(2027, 0, 25, 9, 0, 0));
  await page.route('**/*', route => {
    const u = route.request().url();
    for (const n of Object.keys(vendor)) if (u.includes(n)) return route.fulfill({ contentType: 'application/javascript', body: vendor[n] });
    if (u.indexOf('/exec') !== -1) {
      const p = new URL(u).searchParams, a = p.get('action');
      calls.push(a + (p.get('id') ? ':' + p.get('id') : ''));
      let body = DATA[a] || { ok: true };
      if (a === 'whoami' && hidden) body = Object.assign({}, body, { hidden });
      return route.fulfill({ contentType: 'application/json', body: J(body) });
    }
    if (u.startsWith('https://vera.test/')) return route.fulfill({ contentType: 'text/html', body: LITE });
    return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
  });
  await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); localStorage.setItem('vera_install_tip_done', '1'); });
  await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.lite-bar', { timeout: 15000 });
  await page.waitForTimeout(600);
  return { ctx, page, errors, calls };
}
const txt = (page, sel) => page.$$eval(sel, ns => ns.map(n => n.textContent.trim()));
const barOn = page => page.$eval('.lite-bar-btn[aria-current="page"]', n => n.dataset.bar).catch(() => '');
const shot = async (page, label, name) => { if (process.env.LITE_SHOTS && label === 'iPhone 13') { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(process.env.LITE_SHOTS, name + '.png') }); } };
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  console.log('\nthe rules (in the page, on its own copy)');
  {
    const { ctx, page } = await open(browser, { viewport: { width: 390, height: 800 } });
    const r = await page.evaluate(() => {
      const now = new Date(2027, 0, 25);
      const many = { chores: { chores: Array.from({ length: 12 }, (_, i) => ({ ID: 'c' + i, Chore: 'Job ' + String(i).padStart(2, '0'), upkeep: { days: i - 3, next: 'x', status: i < 3 ? 'overdue' : 'soon' } })).filter(c => c.upkeep.days <= 3) } };
      const big = { chores: { chores: Array.from({ length: 14 }, (_, i) => ({ ID: 'c' + i, Chore: 'Job ' + i, upkeep: { days: -i, next: 'x', status: 'overdue' } })) } };
      VERA_ACCESS = { dash: 'lite', hidden: { 'lite:lite_travel/bucketlist': true, 'lite:finances': true } };
      const can = [liteCanOpen_('travel', 'trips'), liteCanOpen_('travel', 'bucketlist'), liteCanOpen_('finances', 'fin_cards'), liteCanOpen_('all', ''), liteCanOpen_('settings', '')];
      VERA_ACCESS = null;
      return { order: liteNeedsYou_(many, now).map(n => n.days), cap: liteNeedsYou_(big, now).length, can,
        due: [liteDueText_(-2), liteDueText_(0), liteDueText_(1), liteDueText_(6)], days: [liteDays_('2027-01-27', now), liteDays_('2027-01-23T10:00:00Z', now), liteDays_('', now)] };
    });
    check('Needs you puts the soonest first', J(r.order) === J([-3, -2, -1, 0, 1, 2, 3]), J(r.order));
    check('…and never shows more than 10', r.cap === 10, r.cap);
    check('a hidden tab or subtab can’t be opened; All and Settings always can', J(r.can) === J([true, false, false, true, true]), J(r.can));
    check('days left, in words', J(r.due) === J(['2d overdue', 'Today', 'Tomorrow', '6 days']) && J(r.days) === J([2, -2, null]));
    await ctx.close();
  }

  for (const [label, opts] of [['iPhone 13', devices['iPhone 13']], ['1280', { viewport: { width: 1280, height: 900 } }]]) {
    console.log('\nToday, on ' + label);
    const { ctx, page, errors, calls } = await open(browser, opts);
    check('the bar: Today, Lists, Chat, Trips, All, with Today current', J(await txt(page, '.lite-bar-btn')) === J(['🌅Today', '🛒Lists', '💬Chat', '✈️Trips', '▦All']) && await barOn(page) === 'overview', J(await txt(page, '.lite-bar-btn')));
    const bar = await page.$eval('.lite-bar', n => { const r = n.getBoundingClientRect(), s = getComputedStyle(n); return { pos: s.position, bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight, pad: parseFloat(getComputedStyle(document.querySelector('.lite-main')).paddingBottom) }; });
    check('it stays at the bottom of the screen, and the page leaves room for it', bar.pos === 'fixed' && bar.bottom === bar.vh && bar.pad >= bar.h, J(bar));
    check('the greeting uses her name', /Good morning, Victoria/.test(await page.textContent('.lite-hello')));
    const order = await page.$$eval('.lite-main > div > *', ns => ns.map(n => n.className || n.tagName).filter(Boolean));
    check('the grocery run isn’t on Today any more (it’s at the top of Lists)', !/grocery run/i.test(await page.textContent('.lite-main')));
    check('Today first: greeting, the day, Needs you, then the tiles', order.indexOf('lite-hello') < order.indexOf('lite-hero') && order.indexOf('lite-hero') < order.indexOf('lite-need') && order.indexOf('lite-need') < order.indexOf('lite-tiles'), J(order));
    check('the day’s events with colour rails, and the next trip', J(await txt(page, '.lite-ev b')) === J(['Swim lesson', 'Dinner with friends']) && /10:30 – 11:30/.test(await page.textContent('.lite-hero'))
          && (await page.textContent('.lite-trip')).trim() === '✈️ Lisbon in 10 days');
    const needs = await page.$$eval('.lite-need-row', ns => ns.map(n => ({ k: n.dataset.need, t: n.querySelector('b') ? n.querySelector('b').textContent : '', due: (n.querySelector('.lite-due') || {}).textContent || '', tick: !!n.querySelector('input') })));
    check('Needs you: the three soonest, overdue first, a tie by name', J(needs.map(n => n.t)) === J(['Clean gutters', 'Change the filter', 'Costco coupon']) && J(needs.map(n => n.due)) === J(['2d overdue', '2 days', '2 days']), J(needs));
    check('chores and perks tick; a coupon opens Coupons (marking one used deletes it)', needs[0].tick && needs[1].tick && !needs[2].tick);
    await page.click('.lite-sect button');
    await page.waitForTimeout(100);
    const all = await txt(page, '.lite-need-row b');
    check('“See all 5”: the perk 6 days out and the packing for Lisbon; nothing used, standing, on autopay, far off or on a closed card', J(all) === J(['Clean gutters', 'Change the filter', 'Costco coupon', 'Dining credit', 'Pack for Lisbon']), J(all));
    check('the packing counts her items and shared ones not yet in the bag', /3 items left/.test(await page.textContent('[data-need="packing"]')));
    const tiles = await page.$$eval('.lite-tile', ns => ns.map(n => ({ id: n.dataset.tile, line: n.querySelector('span').innerText, hot: n.classList.contains('hot') })));
    const T = id => tiles.find(t => t.id === id) || {};
    check('eight tiles, Chat and Household gone', J(tiles.map(t => t.id)) === J(['lists', 'cheat', 'trips', 'money', 'home', 'family', 'coupons', 'projects']), J(tiles.map(t => t.id)));
    check('Lists: what’s left to buy, per store', T('lists').line === 'Costco · 2 to buy\nTarget · 1 to buy', J(T('lists')));
    check('Which card: the best for groceries and gas, by value', T('cheat').line === 'Groceries → Gold\nGas → Freedom', J(T('cheat')));
    check('Trips and Money say when', T('trips').line === 'Lisbon · in 10 days' && !T('trips').hot && T('money').line === 'Internet · due Wed' && T('money').hot, J([T('trips'), T('money')]));
    check('Home counts daily chores not yet ticked (Checked), and flags the overdue one', T('home').line === '1 chore left today\n1 overdue' && T('home').hot, J(T('home')));
    check('Family: the next refill; Coupons: how many expire this week', T('family').line === 'Refill Vitamin D · Thu' && T('family').hot && T('coupons').line === '1 expires this week' && T('coupons').hot, J([T('family'), T('coupons')]));
    await shot(page, label, 'today');
    check('no sideways scroll on Today', await noSideScroll(page));

    await page.click('.lite-need-row[data-need="chore"] input');
    await page.waitForTimeout(300);
    await page.click('.lite-need-row:has-text("Dining credit") input');
    await page.waitForTimeout(300);
    check('ticking saves it: the upkeep chore done, the perk used this month', calls.indexOf('chore_upkeep_done:ch_1') !== -1 && calls.indexOf('toggle_card_perk:CP-1') !== -1, J(calls.filter(c => /:/.test(c))));

    await page.click('.lite-tile[data-tile="cheat"]');
    await page.waitForTimeout(500);
    check('a tile opens its place: Which card', (await page.$('.ch-which')) !== null && await barOn(page) === 'shopping');
    await page.click('.lite-bar-btn[data-bar="shopping"]');
    await page.waitForTimeout(400);
    await shot(page, label, 'lists');
    const listsText = await page.textContent('.lite-main');
    check('Lists: Shopping’s lists, with the grocery run at the top', await barOn(page) === 'shopping' && /grocery run/i.test(listsText) && listsText.search(/grocery run/i) < listsText.indexOf('Costco'), listsText.slice(0, 120));
    await page.click('.lite-bar-btn[data-bar="travel"]');
    await page.waitForTimeout(500);
    await shot(page, label, 'trips');
    check('Trips: My Trips, with ARIA’s banner moved here', await barOn(page) === 'travel' && (await page.$('.vn-lite_travel')) !== null);
    await page.click('.lite-bar-btn[data-bar="all"]');
    await page.waitForTimeout(300);
    const groups = await txt(page, '.lite-all .lite-sect');
    check('All: every area, grouped', J(groups) === J(['Everyday', 'Home', 'Money', 'Travel', 'Family', 'More']) && (await page.$$('.lite-app')).length === 22, J(groups));
    check('…and Your assistants at the end', (await page.$('.lite-all .vera-roster, .lite-all [class*="roster"]')) !== null || /assistant/i.test(await page.textContent('.lite-all')));
    await shot(page, label, 'all');
    check('no sideways scroll on All', await noSideScroll(page));
    await page.click('.lite-app[data-open="travel/bucketlist"]');
    await page.waitForTimeout(500);
    check('All › Bucket list opens Trips at the Bucket List', await barOn(page) === 'travel' && /Bucket/.test(await page.$eval('.vn-lite_travel .vn-tile.on', n => n.textContent).catch(() => '')));
    await page.click('.lite-bar-btn[data-bar="all"]');
    await page.click('.lite-app[data-open="home_front/chores"]');
    await page.waitForTimeout(500);
    // Home has no bar button of its own; the chores list is what shows.
    check('All › Chores opens Home at Chores', await barOn(page) === '' && /Dishes/.test(await page.textContent('.lite-main')) && !(await page.$('.lite-all')));
    await page.click('.lite-bar-btn[data-bar="all"]');
    await page.click('.lite-app[data-open="finances/fin_cards"]');
    await page.waitForTimeout(500);
    check('All › Our cards opens Money at Our cards', (await page.$('.ch-ourcards')) !== null);
    await page.click('.lite-bar-btn[data-bar="all"]');
    await page.click('.lite-app[data-open="settings"]');
    await page.waitForTimeout(200);
    check('All › Settings opens the settings', (await page.$('.modal-overlay')) !== null);
    check('no script errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  console.log('\nsomeone who can’t see Travel (People & access)');
  {
    const { ctx, page, errors } = await open(browser, devices['iPhone 13'], ['lite:travel']);
    check('no Trips button', J(await page.$$eval('.lite-bar-btn', ns => ns.map(n => n.dataset.bar))) === J(['overview', 'shopping', 'chat', 'all']), J(await txt(page, '.lite-bar-btn')));
    check('no Trips tile', !(await page.$$eval('.lite-tile', ns => ns.map(n => n.dataset.tile))).includes('trips'));
    await page.click('.lite-bar-btn[data-bar="all"]');
    await page.waitForTimeout(200);
    check('no Travel group in All', !(await txt(page, '.lite-all .lite-sect')).includes('Travel'));
    check('no script errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
