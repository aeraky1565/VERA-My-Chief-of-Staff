// Meal Plan "on hand" screens (the shared MealHand block) in BOTH real pages, at phone and
// desktop width: the on-hand panel (sources, coverage, use soon, remove, carry-overs,
// adding), a dinner's uses and Again / Skip / Made extra, the Suggest sheet (pick, still to
// buy → a store's list, save) and What can I make (plan it, add missing), and the planner
// showing them. Every value here is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const START = '// ---- MealHand (Meal Plan: on hand) — SHARED VERBATIM', END = '// ---- /MealHand ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
console.log('\nthe shared block');
check('both dashboards carry the MealHand block, word for word', block(APP).length > 3000 && block(APP) === block(LITE));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  // ONHAND_QUICK (set by ctl_onhand.js): the full dashboard at phone width only. The lite copy
  // of the block is checked word for word above.
  const QUICK = !!process.env.ONHAND_QUICK;
  for (const kind of (QUICK ? ['full'] : ['full', 'lite'])) {
    for (const width of (QUICK ? [390] : [390, 1280])) {
      const L = kind + ' ' + width;
      console.log('\n' + kind + ' dashboard @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errs = []; page.on('pageerror', e => errs.push(e.message));
      if (kind === 'lite') {
        await page.route('**/*', r => {
          const u = r.request().url();
          for (const n of Object.keys(vendor)) if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
          if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: LITE });
          return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
        });
        await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else {
        await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      }
      await page.waitForFunction(() => typeof MpOnHand === 'function' && typeof MealPlanSubTab === 'function', null, { timeout: 15000 }).catch(() => {});
      // A probe host and a recording call/post, shared by every mount below.
      await page.evaluate(() => {
        window.__calls = []; window.__posts = []; window.__reply = {}; window.__reloads = 0; window.__flags = {};
        window.__call = (action, params) => { window.__calls.push(Object.assign({ action }, params)); return Promise.resolve(window.__reply[action] || { ok: true }); };
        window.__post = body => { window.__posts.push(body); return Promise.resolve({ ok: true, saved: ['Wed'], kept: [] }); };
        window.__mount = (C, props) => { document.querySelectorAll('#ohprobe').forEach(n => n.remove()); const host = document.createElement('div'); host.id = 'ohprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
          ReactDOM.createRoot(host).render(React.createElement(C, props)); };
        window.__items = [
          { id: 'OH-1', item: 'Cabbage', source: 'checkout', note: 'checked off · Costco, Sun', useSoon: true, status: 'on hand' },
          { id: 'OH-2', item: 'Feta', source: 'manual', note: 'added by you', useSoon: false, status: 'on hand' },
          { id: 'OH-3', item: 'Spinach', source: 'receipt', note: 'receipt · Costco, Sun', useSoon: true, status: 'on hand' },
          { id: 'OH-4', item: 'Rice', source: 'carried', note: 'from last week', useSoon: false, status: 'pending' }];
      });
      const q = (sel) => page.$$eval('#ohprobe ' + sel, ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      const clickText = (sel, re) => page.evaluate(({ sel, re }) => { const b = Array.from(document.querySelectorAll('#ohprobe ' + sel)).find(x => new RegExp(re).test(x.textContent || x.getAttribute('aria-label') || '')); if (b) b.click(); return !!b; }, { sel, re });
      const clickLabel = (sel, label) => page.evaluate(({ sel, label }) => { const b = Array.from(document.querySelectorAll('#ohprobe ' + sel)).find(x => x.getAttribute('aria-label') === label); if (b) b.click(); return !!b; }, { sel, label });
      const lastCall = () => page.evaluate(() => window.__calls[window.__calls.length - 1] || null);

      // ---- the on-hand panel ----
      await page.evaluate(() => window.__mount(MpOnHand, { items: window.__items, days: [{ day: 'Tue', mealName: 'Hash', uses: ['OH-1'] }], weekStart: '2026-10-26',
        call: window.__call, reload: () => { window.__reloads++; }, onSuggest: () => { window.__flags.suggest = 1; }, onCook: () => { window.__flags.cook = 1; } }));
      await wait(200);
      check(L + ': the panel counts what\'s in a dinner and what to use soon', (await q('.mp-onhand-count'))[0] === '1 of 3 in a dinner · 1 to use soon', JSON.stringify(await q('.mp-onhand-count')));
      const chips = await q('.mp-chip');
      check(L + ': each chip says where it came from and whether a dinner uses it', chips.length === 3 && /^Cabbage ✓ in Tue’s dinner checked off · Costco, Sun ×$/.test(chips[0]) && /^Spinach use soon · no dinner yet receipt · Costco, Sun ×$/.test(chips[2]) && /^Feta no dinner yet added by you ×$/.test(chips[1]), JSON.stringify(chips));
      check(L + ': a carry-over waits for keep or used it', /^Carried over: Rice Keep Used it$/.test((await q('.mp-carried'))[0] || ''), JSON.stringify(await q('.mp-carried')));
      await clickLabel('.mp-soon', 'Mark Feta as use soon');
      check(L + ': the dot marks an item use soon', JSON.stringify(await lastCall()) === '{"action":"onhand_set","id":"OH-2","useSoon":"true"}', JSON.stringify(await lastCall()));
      await clickLabel('.mp-chip-x', 'Used up or not here: Spinach'); await wait(50);
      check(L + ': × takes an item off on hand', JSON.stringify(await lastCall()) === '{"action":"onhand_set","id":"OH-3","status":"removed"}', JSON.stringify(await lastCall()));
      await clickText('.mp-keep', '^Keep$'); await wait(50);
      check(L + ': Keep brings a carry-over in', JSON.stringify(await lastCall()) === '{"action":"onhand_set","id":"OH-4","status":"on hand"}');
      await clickText('.mp-usedit', '^Used it$'); await wait(50);
      check(L + ': Used it retires it', JSON.stringify(await lastCall()) === '{"action":"onhand_set","id":"OH-4","status":"used"}');
      await page.fill('#ohprobe .mp-onhand-add input', 'Potatoes');
      await clickText('.mp-onhand-add button', '^Use soon$');
      await page.$eval('#ohprobe .mp-onhand-add', f => f.requestSubmit()); await wait(150);
      check(L + ': adding sends the item, use soon as toggled, then clears', JSON.stringify(await lastCall()) === '{"action":"onhand_add","weekStart":"2026-10-26","item":"Potatoes","useSoon":"true"}' && await page.$eval('#ohprobe .mp-onhand-add input', n => n.value) === '', JSON.stringify(await lastCall()));
      check(L + ': every change reloads the planner', await page.evaluate(() => window.__reloads) >= 5);
      await page.evaluate(() => { window.__reply.onhand_add = { ok: false, error: 'The sheet is busy.' }; });
      await page.fill('#ohprobe .mp-onhand-add input', 'Kale'); await page.$eval('#ohprobe .mp-onhand-add', f => f.requestSubmit()); await wait(150);
      check(L + ': a failed save says why', (await q('.mp-onhand-err'))[0] === 'The sheet is busy.');
      await clickText('.mp-suggest-week', 'Suggest'); await clickText('.mp-cook', 'What can I make');
      check(L + ': the panel opens Suggest and What can I make', JSON.stringify(await page.evaluate(() => window.__flags)) === '{"suggest":1,"cook":1}');
      const tgt = await page.$$eval('#ohprobe .mp-soon, #ohprobe .mp-chip-x, #ohprobe .mp-onhand-add input, #ohprobe .mp-onhand-add button, #ohprobe .mp-keep', bs => bs.map(b => Math.round(Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
      check(L + ': its controls are at least 32px', tgt.every(x => x >= 32), JSON.stringify(tgt));
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      await page.evaluate(() => window.__mount(MpOnHand, { items: undefined, days: [], weekStart: '2026-10-26', call: window.__call, reload: () => {} })); await wait(100);
      check(L + ': no on hand (the server couldn\'t read it) says so', /isn’t available right now/.test((await q('.mp-onhand'))[0] || ''));

      // ---- a dinner: uses, Again / Skip / Made extra ----
      await page.evaluate(() => { window.__calls = []; window.__mount(MpDayHand, { entry: { id: 'MP-Tue', day: 'Tue', mealName: 'Hash', uses: ['OH-1'], rating: '' }, weekStart: '2026-10-26', isPast: true,
        items: window.__items.concat([{ id: 'OH-9', item: 'leftover hash', pid: 'LEFT:MP-Tue', status: 'on hand' }]), call: window.__call, reload: () => {} }); });
      await wait(150);
      check(L + ': a dinner shows what it uses', JSON.stringify(await q('.mp-uses')) === '["uses Cabbage"]');
      await clickText('.mp-uses-edit', 'Change'); await wait(100);
      check(L + ': Change lists what\'s on hand, its picks ticked', JSON.stringify(await q('.mp-uses-pick button')) === '["✓ Cabbage","Feta","Spinach","leftover hash"]', JSON.stringify(await q('.mp-uses-pick button')));
      await clickText('.mp-uses-pick button', '^Feta$'); await wait(50);
      check(L + ': ticking one saves the dinner\'s uses', JSON.stringify(await lastCall()) === '{"action":"meal_extras","weekStart":"2026-10-26","day":"Tue","uses":"OH-1,OH-2"}', JSON.stringify(await lastCall()));
      await clickText('.mp-again', '^Again$'); await wait(50);
      check(L + ': Again rates the dinner', JSON.stringify(await lastCall()) === '{"action":"meal_extras","weekStart":"2026-10-26","day":"Tue","rating":"again"}');
      check(L + ': Made extra shows as on when its leftovers are on hand', await page.$eval('#ohprobe .mp-extra', b => b.getAttribute('aria-pressed') + '|' + b.textContent) === 'true|Made extra ✓');
      await clickText('.mp-extra', 'Made extra'); await wait(50);
      check(L + ': …and toggles them', JSON.stringify(await lastCall()) === '{"action":"made_extra","weekStart":"2026-10-26","day":"Tue"}');
      await page.evaluate(() => window.__mount(MpDayHand, { entry: { id: 'MP-Sat', day: 'Sat', mealName: 'Pizza', uses: [], rating: 'skip' }, weekStart: '2026-10-26', isPast: false, items: window.__items, call: window.__call, reload: () => {} })); await wait(100);
      check(L + ': a dinner still ahead has no rating buttons; with nothing used it offers to pick', (await page.$$('#ohprobe .mp-rate')).length === 0 && (await q('.mp-uses-edit'))[0] === '+ What it uses');

      // ---- Suggest the week ----
      await page.evaluate(() => { window.__calls = []; window.__posts = []; window.__reloads = 0; window.__closed = 0;
        window.__reply.suggest_week = { ok: true, days: [{ day: 'Wed', meal: 'Cabbage soup', type: 'Home Cooked', why: 'Cabbage first; a free evening', uses: ['Cabbage'] }, { day: 'Fri', meal: 'Takeout', type: 'Takeout', why: 'Late call until 19:00', uses: [] }], stillToBuy: ['onion', 'eggs'] };
        window.__reply.shopping = { ok: true, stores: [{ tabId: 't.a', storeName: 'Store A' }, { tabId: 't.b', storeName: 'Store B' }] };
        window.__mount(MpSuggestSheet, { weekStart: '2026-10-26', items: window.__items, call: window.__call, post: window.__post, reload: () => { window.__reloads++; }, onClose: () => { window.__closed++; } }); });
      await wait(250);
      check(L + ': suggestions are asked for that week', JSON.stringify((await page.evaluate(() => window.__calls))[0]) === '{"action":"suggest_week","weekStart":"2026-10-26"}');
      const picks = await q('.mp-pick');
      check(L + ': each pick has its reason and what it uses', picks.length === 2 && /^✓ WED Cabbage soup Cabbage first; a free evening uses Cabbage · use soon Home Cooked$/.test(picks[0]) && /Late call until 19:00/.test(picks[1]), JSON.stringify(picks));
      check(L + ': still to buy is listed, with the stores', /Still to buy: onion, eggs/.test((await q('.mp-buy'))[0] || '') && JSON.stringify(await q('.mp-send button[aria-pressed]')) === '["Store A","Store B"]');
      await clickText('.mp-send button[aria-pressed]', '^Store B$'); await clickText('.mp-send-go', '^Add 2$'); await wait(200);
      const adds = await page.evaluate(() => window.__calls.filter(c => c.action === 'shopping_add'));
      check(L + ': still to buy goes to the store picked, one item each', JSON.stringify(adds) === '[{"action":"shopping_add","tabId":"t.b","text":"onion"},{"action":"shopping_add","tabId":"t.b","text":"eggs"}]' && (await q('.mp-send-msg'))[0] === 'Added 2 to the Store B list.', JSON.stringify(adds));
      check(L + ': the button counts the picks', (await q('.mp-use'))[0] === 'Use these 2');
      await clickText('.mp-pick', 'Takeout'); await wait(50);
      check(L + ': unticking one leaves it out', (await q('.mp-use'))[0] === 'Use these 1');
      await clickText('.mp-use', 'Use these'); await wait(200);
      check(L + ': saving sends only the picks kept, then reloads and closes', JSON.stringify(await page.evaluate(() => window.__posts)) === JSON.stringify([{ action: 'meal_apply', weekStart: '2026-10-26', picks: [{ day: 'Wed', meal: 'Cabbage soup', type: 'Home Cooked', why: 'Cabbage first; a free evening', uses: ['Cabbage'] }] }])
        && await page.evaluate(() => window.__reloads === 1 && window.__closed === 1), JSON.stringify(await page.evaluate(() => window.__posts)));
      check(L + ': the sheet fits the screen', await page.$eval('#ohprobe .mp-sheet', n => n.getBoundingClientRect().width <= window.innerWidth));
      await page.evaluate(() => { window.__reply.suggest_week = { ok: false, error: 'Couldn’t get suggestions right now (HTTP 529).' };
        window.__mount(MpSuggestSheet, { weekStart: '2026-10-26', items: [], call: window.__call, post: window.__post, reload: () => {}, onClose: () => {} }); }); await wait(200);
      check(L + ': a failed suggestion says why', /HTTP 529/.test((await q('.mp-sheet-err'))[0] || ''));
      await page.evaluate(() => { window.__reply.suggest_week = { ok: true, days: [], stillToBuy: [] };
        window.__mount(MpSuggestSheet, { weekStart: '2026-10-26', items: [], call: window.__call, post: window.__post, reload: () => {}, onClose: () => {} }); }); await wait(200);
      check(L + ': a full week says so', /already has a dinner/.test(await page.$eval('#ohprobe .mp-sheet', n => n.innerText)) && (await q('.mp-use'))[0] === 'Nothing picked');

      // ---- What can I make ----
      await page.evaluate(() => { window.__calls = []; window.__reply.meal_cook = { ok: true, open: ['Thu', 'Sat'], recipes: [
          { name: 'Spinach omelette', time: '15 min', have: [{ name: 'Spinach', useSoon: true }, { name: 'Feta', useSoon: false }], missing: [] },
          { name: 'Hash', time: '', have: [{ name: 'Cabbage', useSoon: true }], missing: ['onion'] }] };
        window.__mount(MpCookSheet, { weekStart: '2026-10-26', items: window.__items, call: window.__call, post: window.__post, reload: () => {}, onClose: () => {} }); });
      await wait(250);
      const recs = await q('.mp-recipe');
      check(L + ': recipes in two groups, with what you have and what you need', recs.length === 2 && /^Spinach omelette 15 min Spinach · use soon Feta Plan it for Thu Sat$/.test(recs[0]) && /need onion/.test(recs[1]) && /YOU HAVE EVERYTHING[\s\S]*MISSING 1–2 THINGS/.test(await page.$eval('#ohprobe .mp-sheet', n => n.innerText)), JSON.stringify(recs));
      await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#ohprobe .mp-recipe'))[0].querySelectorAll('.mp-plan-day'); Array.from(b).find(x => x.textContent === 'Sat').click(); }); await wait(250);
      const plan = await page.evaluate(() => window.__calls.filter(c => c.action !== 'meal_cook'));
      check(L + ': Plan it saves the dinner on that day, with what it uses from on hand', JSON.stringify(plan) === '[{"action":"set_meal","weekStart":"2026-10-26","day":"Sat","mealName":"Spinach omelette","type":"Home Cooked"},{"action":"meal_extras","weekStart":"2026-10-26","day":"Sat","uses":"OH-2,OH-3"}]', JSON.stringify(plan));
      check(L + ': …says so, and that night is no longer offered', (await q('.mp-planned'))[0] === 'Spinach omelette is on Sat.' && JSON.stringify(await q('.mp-recipe:first-of-type .mp-plan-day')) !== '["Thu","Sat"]' && !(await q('.mp-plan-day')).includes('Sat'));
      await clickText('.mp-missing', 'Add missing'); await wait(150);
      await clickText('.mp-send-go', '^Add 1$'); await wait(150);
      check(L + ': what\'s missing goes to a store\'s list', JSON.stringify(await page.evaluate(() => window.__calls.filter(c => c.action === 'shopping_add'))) === '[{"action":"shopping_add","tabId":"t.a","text":"onion"}]');
      check(L + ': no sideways scroll with a sheet open', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));

      // ---- the planner shows all of it ----
      await page.evaluate(() => {
        const p2 = n => String(n).padStart(2, '0'), iso = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
        const today = new Date(); today.setHours(0, 0, 0, 0); const dow = today.getDay();
        const mon = new Date(today); mon.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow)); const nxt = new Date(mon); nxt.setDate(mon.getDate() + 7);
        const WS = iso(mon), sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        window.__calls = [];
        window.apiGet = (u, t, p) => { window.__calls.push(p);
          if (p.action === 'meal_plan') return Promise.resolve({ ok: true, weeks: [
            { weekStart: WS, onHand: window.__items, days: [{ id: 'MP-Sun', day: 'Sun', date: iso(sun), mealName: 'Cabbage hash', type: 'Home Cooked', status: 'Planned', notes: '', uses: ['OH-1'], rating: '' }] },
            { weekStart: iso(nxt), days: [] }] });
          if (p.action === 'meal_cook') return Promise.resolve({ ok: true, recipes: [], open: [] });
          return Promise.resolve({ ok: true }); };
        window.__mount(MealPlanSubTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' });
      });
      await wait(500);
      check(L + ': this week opens with on hand', (await page.$$('#ohprobe .mp-week:first-child .mp-onhand')).length === 1 && (await page.$$('#ohprobe .mp-onhand')).length === 1 && (await q('.mp-chip')).length === 3);
      check(L + ': …and a dinner shows what it uses', (await q('.mp-uses')).includes('uses Cabbage') && /✓ in Sun’s dinner/.test((await q('.mp-chip'))[0]), JSON.stringify(await q('.mp-chip')));
      await clickText('.mp-cook', 'What can I make'); await wait(250);
      check(L + ': What can I make opens over the planner, for this week', (await page.$$('#ohprobe .mp-sheet')).length === 1 && (await page.evaluate(() => window.__calls.some(c => c.action === 'meal_cook'))));
      await page.$eval('#ohprobe .mp-sheet button[aria-label="Close"]', b => b.click()); await wait(100);
      check(L + ': …and closes', (await page.$$('#ohprobe .mp-sheet')).length === 0);
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
