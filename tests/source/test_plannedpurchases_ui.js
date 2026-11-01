// Planned Purchases, in both dashboards: the panel is mounted for real with a
// fake server and clicked through: the list, a purchase, an option, buying it.
// The two copies of the block must match. Invented items and stores.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;
const APP = fs.readFileSync(path.resolve(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const block = s => { const a = s.indexOf('// ---- PlannedPurchasesPanel'), b = s.indexOf('// ---- end PlannedPurchasesPanel ----'); return a === -1 || b === -1 ? null : s.slice(a, b); };
console.log('\nthe shared block');
check('both dashboards carry the block', !!block(APP) && !!block(LITE));
check('…and the two copies match', block(APP) === block(LITE));
check('Finances has the subtab in both', /\{id:'planned',label:'🛒 Planned Purchases'/.test(APP) && /sub==='planned'&&React\.createElement\(PlannedPurchasesPanel,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP) &&
      /\{ id: 'fin_planned',  label: '🛒 Planned Purchases' \}/.test(LITE) && /activeFinanceTab === 'fin_planned'   && <PlannedPurchasesPanel apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>/.test(LITE));

const opt = (o) => Object.assign({ store: '', link: '', prices: [], checks: {}, delivery: '', leadDays: null, returns: '', returnDays: null, notes: '', ruledOut: false, orderBy: '' }, o);
const couch = { id: 'PP-1', item: 'Living room couch', forWho: 'Shared', why: 'for the living room', budget: 2200, needBy: '2026-11-26', needNote: 'Thanksgiving guests', goalId: 'G-HOME',
  stage: 'deciding', must: ['Seats 4', 'Under 88 in'], nice: ['Chaise', 'Deep seats'], no: ['Light linen'], targetPrice: null, chosenOption: '', bought: null, oldItem: 'Couch', oldPlan: '',
  notes: [{ date: '2026-10-26', text: 'Sat on A at the showroom.', link: '' }], bestId: 'O-A', returnBy: '',
  money: { set: 900, budget: 2200, left: 1300, funded: false, pct: 41, perWeek: 364, goalName: 'Home' },
  alerts: [{ tone: 'soon', text: 'Delivery takes 8–10 wks. Order Option A by 2026-11-10 to have it by 2026-11-26.' }],
  options: [
    opt({ id: 'O-A', name: 'Option A', store: 'Store One', price: 2049, prices: [{ price: 2099, seen: '2026-10-20' }, { price: 2049, seen: '2026-10-26' }], delivery: '8–10 wks', returns: '30 days', returnDays: 30, orderBy: '2026-11-10',
      checks: { 'Seats 4': 'yes', 'Under 88 in': 'yes', 'Chaise': 'yes', 'Light linen': 'no' }, score: { ok: true, fails: 0, label: 'All musts · 1 of 2 nice' } }),
    opt({ id: 'O-B', name: 'Option B', store: 'Store Two', price: 1780, prices: [{ price: 1780 }], delivery: '12–14 wks', returns: 'Final sale',
      checks: { 'Seats 4': 'yes', 'Under 88 in': 'yes', 'Light linen': 'no' }, score: { ok: true, fails: 0, label: 'All musts · 0 of 2 nice' } }),
    opt({ id: 'O-C', name: 'Option C', price: 1450, prices: [{ price: 1450 }], ruledOut: true, checks: { 'Seats 4': 'yes', 'Under 88 in': 'no', 'Light linen': 'yes' }, score: { ok: false, fails: 2, label: 'Fails 2 musts' } })] };
const laptop = { id: 'PP-2', item: 'Laptop', forWho: 'Ahmed', why: '', budget: 1400, needBy: '', needNote: '', goalId: '', stage: 'bought', must: [], nice: [], no: [], targetPrice: null, chosenOption: '',
  bought: { price: 1329, orderedOn: '2026-10-14', store: 'Store Three', card: 'Blue Card', deliveryFrom: '2026-10-16', deliveryTo: '2026-10-16', returnDays: 30, warrantyYears: 1, warrantyNote: '', receipt: '' },
  oldItem: 'Laptop', oldPlan: '', notes: [], options: [], bestId: '', returnBy: '2026-11-15', money: { set: 0, budget: 1400, pct: 0 }, alerts: [{ tone: 'ok', text: 'Return window ends 2026-11-15.' }] };
const RESP = { planned_purchases: { ok: true, today: '2026-11-01', purchases: [laptop, couch], summary: { inProgress: 1, setAside: 900, budgets: 2200 },
  goals: [{ id: 'G-HOME', name: 'Home', currentAmount: 900 }], cards: ['Blue Card', 'Green Card'], suggestedCard: { card: 'Blue Card', why: 'Extended warranty + Purchase protection' } } };

async function mount(page) {
  return page.evaluate(resp => {
    document.querySelectorAll('.modal-overlay, #ppprobe').forEach(n => n.remove());
    if (typeof PlannedPurchasesPanel !== 'function') return { error: 'PlannedPurchasesPanel is not defined' };
    window.__post = [];
    window.apiGet = (u, t, p) => Promise.resolve(JSON.parse(JSON.stringify(resp[p.action] || { ok: false })));
    window.apiPost = (u, t, body) => { window.__post.push(body); return Promise.resolve(body.action === 'pp_save' ? { ok: true, purchase: { id: body.purchase.id || 'PP-NEW' } } : { ok: true }); };
    window.scrollTo = () => {}; window.confirm = () => true;
    const host = document.createElement('div'); host.id = 'ppprobe'; document.body.prepend(host);
    ReactDOM.createRoot(host).render(React.createElement(PlannedPurchasesPanel, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
    return new Promise(res => setTimeout(() => res({ ok: true }), 300));
  }, RESP);
}
const q = (page, s) => page.evaluate(s => { const n = document.querySelector('#ppprobe ' + s); return n ? n.textContent : null; }, s);
const qa = (page, s) => page.evaluate(s => Array.from(document.querySelectorAll('#ppprobe ' + s)).map(n => n.textContent), s);
const click = async (page, s, i) => { await page.evaluate(({ s, i }) => document.querySelectorAll('#ppprobe ' + s)[i || 0].click(), { s, i }); await page.waitForTimeout(120); };
const last = page => page.evaluate(() => window.__post[window.__post.length - 1]);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8') };
  for (const [label, kind] of [['full dashboard', 'full'], ['dashboard-lite', 'lite']]) {
    for (const width of [390, 1280]) {
      console.log('\n' + label + ' @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      if (kind === 'lite') {
        await page.route('**/*', r => { const u = r.request().url();
          for (const n of Object.keys(vendor)) if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
          if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: LITE });
          return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' }); });
        await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      const m = await mount(page);
      if (m.error) { fail++; console.log('  FAIL ' + m.error); await page.close(); continue; }

      const tiles = await qa(page, '.pp-tile');
      check('the tiles: in progress and set aside', /In progress1/.test(tiles[0]) && /\$900/.test(tiles[1]) && /of \$2,200 in budgets/.test(tiles[1]), tiles.join(' / '));
      const cards = await qa(page, '.pp-card');
      check('open purchases first, bought last', cards.length === 2 && /^Living room couch/.test(cards[0]) && /^Laptop/.test(cards[1]), cards.join(' / '));
      check('a card: stage, best fit, the heads-up, the money', /Deciding/.test(cards[0]) && /Best fit so far: Option A at \$2,049/.test(cards[0]) && /Order Option A by 2026-11-10/.test(cards[0]) &&
            /\$900 set aside of \$2,200/.test(cards[0]) && /41%/.test(cards[0]) && /3 options compared · 1 note/.test(cards[0]), cards[0]);
      check('a bought card says what it cost against the budget', /Paid \$1,329 · \$71 under budget/.test(cards[1]), cards[1]);
      const pills = await qa(page, '.pp-stage-pill');
      check('stage pills only for stages in use, with counts', pills.join('|') === 'All 2|Deciding 1|Bought 1', pills.join('|'));
      await click(page, '.pp-stage-pill', 2);
      check('a pill filters the list', (await qa(page, '.pp-card')).length === 1 && /Laptop/.test((await qa(page, '.pp-card'))[0]));

      // ---- detail ----
      await mount(page); await click(page, '.pp-card', 0);
      const d = await q(page, '.pp-detail');
      check('detail: what it has to do', /Must · Seats 4 · Under 88 in/.test(d) && /Nice · Chaise · Deep seats/.test(d) && /No · Light linen/.test(d), d.slice(0, 400));
      check('…the money from the goal, the weekly amount, the card', /\$900 of \$2,200 · from the "Home" goal/.test(d) && /\$364 a week gets there by Nov 26/.test(d) &&
            /Card to use: Blue Card \(extended warranty \+ purchase protection, from Card Perks\)/.test(d), d);
      const cells = await page.evaluate(() => Array.from(document.querySelectorAll('#ppprobe .pp-cell')).map(n => n.dataset.v));
      check('the table ticks each option against each requirement, a deal-breaker inverted', cells.length === 15 &&
            cells.slice(0, 3).join() === 'good,good,good' && cells.slice(3, 6).join() === 'good,good,bad' && cells.slice(12, 15).join() === 'good,good,bad', cells.join());
      const fits = await qa(page, '.pp-fit');
      check('…and scores it', fits.join('|') === 'All musts · 1 of 2 nice|All musts · 0 of 2 nice|Fails 2 musts', fits.join('|'));
      check('the price history shows', /was \$2,099/.test(d));
      check('the verdict compares the best with a cheaper one', /Option A is the best fit\. Option B is \$269 cheaper but meets fewer nice-to-haves\./.test(await q(page, '.pp-verdict')), await q(page, '.pp-verdict'));
      check('timing: needed by and order by', /Needed byNov 26 · Thanksgiving guests/.test(d) && /Order by \(Option A\)Nov 10/.test(d), d);
      await click(page, '.pp-rule-out', 1);
      check('Rule out sends the option', JSON.stringify(await last(page)) === JSON.stringify({ action: 'pp_option_save', option: { id: 'O-B', purchaseId: 'PP-1', ruledOut: true } }));
      await click(page, '.pp-rule-out', 2);
      check('Bring back a ruled-out one', (await last(page)).option.ruledOut === false);
      await click(page, '.pp-stage-step[data-stage="waiting"]');
      check('the stage track moves the stage', JSON.stringify(await last(page)) === JSON.stringify({ action: 'pp_save', purchase: { id: 'PP-1', stage: 'waiting' } }));
      check('Bought is not on the track: it is the buy button', await page.evaluate(() => document.querySelector('#ppprobe .pp-stage-step[data-stage="bought"]').disabled));
      await page.fill('#ppprobe .pp-note-in', 'https://example.com/review');
      await click(page, '.pp-note-add');
      check('a pasted link is saved as a link', JSON.stringify(await last(page)) === JSON.stringify({ action: 'pp_note_add', id: 'PP-1', text: '', link: 'https://example.com/review' }));
      await click(page, '.pp-old-resell');
      check('the old one to Resell', JSON.stringify(await last(page)) === JSON.stringify({ action: 'pp_old_plan', id: 'PP-1', plan: 'resell' }));
      await page.waitForTimeout(150);

      // ---- an option ----
      await mount(page); await click(page, '.pp-card', 0); await click(page, '.pp-add-opt');
      await page.fill('#ppprobe .ppo-in-name', 'Option D'); await page.fill('#ppprobe .ppo-in-price', '1999'); await page.fill('#ppprobe .ppo-in-lead', '21');
      await click(page, '.pp-check-btn[data-req="Seats 4"]');
      await click(page, '.pp-check-btn[data-req="Light linen"]'); await click(page, '.pp-check-btn[data-req="Light linen"]');
      check('the requirement buttons cycle yes, no', /✓ yes/.test(await q(page, '.pp-check-btn[data-req="Seats 4"]')) && /✕ no/.test(await q(page, '.pp-check-btn[data-req="Light linen"]')));
      await click(page, '.pp-opt-save');
      const o = (await last(page)).option;
      check('Save option sends it with its ticks', o.purchaseId === 'PP-1' && o.name === 'Option D' && o.price === '1999' && o.leadDays === '21' &&
            JSON.stringify(o.checks) === '{"Seats 4":"yes","Light linen":"no"}', JSON.stringify(o));
      await page.waitForTimeout(150);

      // ---- buying ----
      await mount(page); await click(page, '.pp-card', 0);
      check('the buy button names the best fit', /Choose Option A and mark as bought/.test(await q(page, '.pp-buy-btn')));
      await click(page, '.pp-buy-btn');
      const bf = await q(page, '.pp-bought-form');
      check('the bought form starts from the option and the suggested card', await page.evaluate(() => document.querySelector('#ppprobe .ppb-in-price').value) === '2049' &&
            await page.evaluate(() => document.querySelector('#ppprobe .ppb-in-card').value) === 'Blue Card' && /Blue Card \(suggested\)/.test(bf), bf.slice(0, 300));
      await page.fill('#ppprobe .ppb-in-price', '1989');
      await page.fill('#ppprobe .ppb-in-df', '2026-11-20'); await page.fill('#ppprobe .ppb-in-dt', '2026-11-24'); await page.fill('#ppprobe .ppb-in-wy', '10');
      const fx = await q(page, '.pp-effects');
      check('it says what happens: Coming up, warranties, the goal, the old one', /Delivery Nov 20–Nov 24 goes to Coming up, with a reminder the day before/.test(fx) &&
            /The 30-day return window and the 10-year warranty go to Warranties & Service/.test(fx) && /\$1,989 comes out of the "Home" goal; \$211 under budget/.test(fx) &&
            /The old couch stays on the list until you choose Resell, Donate or Haul away/.test(fx), fx);
      await click(page, '.pp-bought-save');
      const b = await last(page);
      check('Save as bought sends it all', b.action === 'pp_mark_bought' && b.id === 'PP-1' && b.bought.optionId === 'O-A' && b.bought.price === '1989' && b.bought.card === 'Blue Card' &&
            b.bought.deliveryFrom === '2026-11-20' && b.bought.returnDays === '30' && b.bought.warrantyYears === '10', JSON.stringify(b));
      await mount(page); await click(page, '.pp-card', 1);
      const bd = await q(page, '.pp-boughtbox');
      check('a bought purchase shows what was paid, the return window and the warranty', /Paid \$1,329 at Store Three on Oct 14, Blue Card\. \$71 under budget\./.test(bd) && /Return window ends Nov 15/.test(bd) &&
            /1-year warranty\. Saved to Warranties & Service/.test(bd), bd);
      check('…and no buy button', (await q(page, '.pp-buy-btn')) === null);

      // ---- add ----
      await mount(page); await click(page, '.pp-add-btn');
      check('the add form waits for a name', await page.evaluate(() => document.querySelector('#ppprobe .pp-save').disabled));
      await page.fill('#ppprobe .pp-in-item', 'New phone'); await page.fill('#ppprobe .pp-in-budget', '1000'); await page.fill('#ppprobe .pp-in-needby', '2027-09-01');
      await page.selectOption('#ppprobe .pp-goal-select', '__new');
      await page.fill('#ppprobe .pp-req-in-must', 'Five years of updates'); await click(page, '.pp-req-add-must');
      await page.fill('#ppprobe .pp-in-old', 'Phone');
      await click(page, '.pp-save');
      const a = await last(page);
      check('Save as Researching sends the purchase and asks for a new goal', a.action === 'pp_save' && a.newGoal === true && a.purchase.item === 'New phone' && a.purchase.budget === '1000' &&
            a.purchase.needBy === '2027-09-01' && JSON.stringify(a.purchase.must) === '["Five years of updates"]' && a.purchase.goalId === '' && a.purchase.stage === 'researching' && a.purchase.oldItem === 'Phone', JSON.stringify(a));

      if (width === 390) { await mount(page); await click(page, '.pp-card', 0);
        check('no sideways page scroll at phone width (the table scrolls in its box)', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => document.documentElement.scrollWidth)); }
      check('no page errors', errors.length === 0, errors.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
