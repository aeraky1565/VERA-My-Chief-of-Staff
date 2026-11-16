// The full dashboard's Home (the computer layout), in a browser at desktop, laptop and phone widths, over
// an in-page fake of the routes it reads. Pins:
//  - Today reads the Joint Chaos calendar (get_todays_events) and says when it can't find it; the trip chip;
//  - At a glance: Coming up, Practice, Spending and Birthday at once, each one line, amber when it needs
//    you (behind on practice, a line over plan, a birthday within 14 days with no gift ideas), each opening
//    its page; no pick-one card any more;
//  - Needs you: high and medium flags, overdue tasks and the lite Today's perks, coupons and chores,
//    soonest first, five then "See all"; a row opens its tab;
//  - Everything: Flags, Tasks, Shopping, Money, Which card, Projects, PTO, Mail & Packages (with Got the
//    mail!), Travel and System health, four across on a wide window, one column on a phone;
//  - System health names what to look at, and opens System;
//  - two columns on a computer, one on a phone, and no sideways scroll anywhere.
// Pure helpers are checked in node first. Every name, amount and date here is invented.
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const IDX = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const wait = ms => new Promise(r => setTimeout(r, ms));
function fnSrc(src, name) {
  const a = src.indexOf('function ' + name + '(');
  if (a === -1) throw new Error('not found: ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', a));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
  return src.slice(a, j + 1);
}
const block = (src, name) => { const a = src.indexOf('// ---- ' + name), b = src.indexOf('// ---- /' + name + ' ----', a); return a === -1 || b === -1 ? null : src.slice(a, b); };

console.log('\nthe source');
const NA = block(APP, 'NeedsYou'), NL = block(LITE, 'NeedsYou');
check('Needs you’s helpers are one shared block, byte-identical in both dashboards', !!NA && NA === NL && /SHARED VERBATIM/.test(NA));
check('the pick-one card is gone from the full dashboard', APP.indexOf('function HomeSlot(') === -1 && APP.indexOf('HS_CARDS') === -1);
check('index.html is rebuilt with the new Home', IDX.includes('function FhGlance(') && IDX.includes('.fh-cols {'));
check('the nightly route is wired, read only', /case 'home_nightly':\s*return jsonOut_\(webHomeNightly_\(\)\)/.test(WEB) && !/setProperty|deleteProperty/.test(fnSrc(WEB, 'webHomeNightly_')));
check('the mail tile keeps its Got the mail! button', /'✓ Got the mail!'/.test(fnSrc(APP, 'FhMailTile')) && /React\.createElement\(FhMailTile,\{counter:mailCounter,busy:mailCounterBusy,onReset:onResetMailCounter/.test(fnSrc(APP, 'HomeTab')));
check('no old big-number cards left on Home', !/bento-card-main|MailCounterCard/.test(fnSrc(APP, 'HomeTab')) && APP.indexOf('function MailCounterCard(') === -1);

// ---- pure, in node ----------------------------------------------------------------
const ctx = { console, Date, Math, JSON, Object, Array, String, Number, RegExp, isNaN, VERA_GOTO_: {} };
vm.createContext(ctx);
const CARDVALUE = (() => { const a = APP.indexOf('// ---- CardValue'); const b = APP.indexOf('// ---- /CardValue ----', a); return a === -1 ? '' : APP.slice(a, b); })();
const HUB = (() => { const a = APP.indexOf('// ---- CardHub'); const b = APP.indexOf('// ---- /CardHub ----', a); return a === -1 ? '' : APP.slice(a, b); })();
['hsMoney_', 'hsQuarter_', 'hsSpending_', 'hsNextDate_', 'fhDate_', 'fhTripChip_', 'fhGlance_', 'fhGlancePick_', 'fhNeeds_', 'fhMoneyLine_', 'fhHealth_', 'fhTravelLine_', 'fhFlagsTile_', 'fhTasksTile_', 'fhShopTile_', 'fhProjTile_', 'fhPtoTile_', 'fhMailTile_', 'fhMoneyTile_', 'fhTravelTile_', 'fhNeedsShown_', 'fhGreeting_'].forEach(n => vm.runInContext(fnSrc(APP, n), ctx));
vm.runInContext(NA, ctx);
try { vm.runInContext(CARDVALUE + '\n' + HUB.replace(/function CardHub[\s\S]*$/, ''), ctx); } catch (e) {}

console.log('\nToday’s chip, and Travel');
check('the next trip, with the days to it', ctx.fhTripChip_([{ label: 'Lisbon', startDate: '2027-03-25', endDate: '2027-03-31' }], '2027-03-15') === '✈️ Lisbon in 10 days');
check('on a trip: the days until home', ctx.fhTripChip_([{ label: 'Lisbon', startDate: '2027-03-25', endDate: '2027-03-31' }], '2027-03-27') === '🏠 Home in 4 days');
check('no trips: nothing', ctx.fhTripChip_([], '2027-03-15') === '' && ctx.fhTravelLine_([], '2027-03-15') === 'No trips planned');
check('Travel says the same, without the icon', ctx.fhTravelLine_([{ label: 'Lisbon', startDate: '2027-03-16' }], '2027-03-15') === 'Lisbon tomorrow');

console.log('\nEverything: each tile’s lines, and when it’s amber');
{
  const T = (o, lines, hot) => J(o.lines) === J(lines) && o.hot === hot;
  const f = ctx.fhFlagsTile_([{ flag: 'Renew passport', urgency: 'High' }, { flag: 'Low one', urgency: 'Low' }, { flag: 'Shut', urgency: 'High', resolved: true }]);
  check('Flags: open and high, then the top one; amber with a high flag', T(f, ['2 open · 1 high', 'Renew passport'], true), J(f));
  check('…none: All clear', T(ctx.fhFlagsTile_([]), ['All clear'], false));
  check('Tasks: overdue first, then Next; amber when overdue', T(ctx.fhTasksTile_([{ task: 'Call the plumber', isOverdue: true }, { task: 'B', dueDate: '2027-04-01' }]), ['1 overdue', 'Next: Call the plumber'], true)
        && T(ctx.fhTasksTile_([{ task: 'A' }, { task: 'B', dueDate: '2027-04-01' }]), ['2 open', 'Next: B'], false));
  check('Shopping: lists with nothing left say so', J(ctx.fhShopTile_([{ storeName: 'Aldi', items: [{ done: true }] }]).lines) === J(['Nothing to buy']));
  check('Shopping: the two lists with most to buy', T(ctx.fhShopTile_([{ storeName: 'Target', items: [{ done: false }, { done: true }] }, { storeName: 'Costco', items: [{}, {}, {}] }, { storeName: 'Aldi', items: [] }]), ['Costco · 3', 'Target · 1'], false));
  check('Projects: two active, with steps left', T(ctx.fhProjTile_([{ projectName: 'Garage', tasks: [{ status: 'Open' }] }, { projectName: 'Kitchen', tasks: [{ status: 'Open' }, { status: 'Open' }, { status: 'Done' }] }, { projectName: 'Done one', tasks: [{ status: 'Done' }] }]), ['Kitchen · 2 left', 'Garage · 1'], false));
  check('PTO: both balances, then the next time off', T(ctx.fhPtoTile_({ ahmedStats: { remaining: { vacationDays: 12 }, nextPTO: { label: 'Lisbon', daysUntil: 10 } }, victoriaStats: { remaining: { vacationDays: 9 } } }), ['Ahmed 12d · Victoria 9d', 'Next: Lisbon, in 10 days'], false));
  check('Mail: pieces and packages, amber while waiting; clear when empty', T(ctx.fhMailTile_({ pieces: 2, packages: 1 }), ['2 pieces · 1 package'], true) && T(ctx.fhMailTile_({ pieces: 0, packages: 0 }), ['Mailbox is clear'], false));
  const NOWM = new Date(2027, 2, 15, 9, 0);
  check('Money: groceries against plan, then the next bill; amber when groceries are over', T(ctx.fhMoneyTile_({ bills: [{ bill: 'Internet', dueDay: 24 }] }, { lines: { 'Groceries & household': { plan: 600, actual: 640 } } }, NOWM), ['Groceries $640 of $600', 'Internet · due in 9 days'], true));
  check('…a bill due within 3 days is amber too', ctx.fhMoneyTile_({ bills: [{ bill: 'Water', dueDay: 16 }] }, { noUploads: true }, NOWM).hot === true);
  check('Travel: the trip, then packing; amber within 3 days with packing left', T(ctx.fhTravelTile_([{ label: 'Lisbon', startDate: '2027-03-17' }], '2027-03-15', { items: [{ status: 'bag' }, { checked: true }, { status: 'ready' }] }), ['Lisbon in 2 days', 'Packing 2 of 3'], true)
        && ctx.fhTravelTile_([{ label: 'Lisbon', startDate: '2027-03-25' }], '2027-03-15', { items: [{ status: 'ready' }] }).hot === false);
  check('Needs you: 3 on a phone, 5 on a computer', ctx.fhNeedsShown_(false) === 3 && ctx.fhNeedsShown_(true) === 5);
  check('the greeting follows the hour', ctx.fhGreeting_(new Date(2027, 0, 1, 8)) === 'Good morning' && ctx.fhGreeting_(new Date(2027, 0, 1, 14)) === 'Good afternoon' && ctx.fhGreeting_(new Date(2027, 0, 1, 20)) === 'Good evening');
}

console.log('\nAt a glance');
const NOW = new Date(2027, 2, 15, 9, 0);   // Mon 15 Mar 2027
const LOADED = {
  coming: { cards: [{ day: '2027-03-18', time: '7 pm', title: 'Dinner with the Hales', prep: [{ label: 'bring dessert' }] }, { day: '2027-03-19', title: 'Recital' }, { day: '2027-03-20', title: 'Market' }, { day: '2027-03-25', title: 'Later', after: true }] },
  practice: { goals: [{ id: 'g1', title: 'Spanish', focus: 'now', perWeek: 4, practice: { thisWeek: 1 } }, { id: 'g2', title: 'Piano', focus: 'later', perWeek: 3 }] },
  money: { quarter: '2027-Q1', lines: { groceries: { plan: 600, actual: 640 }, dining: { plan: 300, actual: 200 }, gas: { plan: 200, actual: null } } },
  birthday: { next: { label: 'Sam’s birthday', days: 5, ideas: 0 } },
};
let g = ctx.fhGlance_(LOADED, NOW);
check('four tiles, in order', J(g.map(t => t.id)) === J(['coming', 'practice', 'money', 'birthday']), J(g.map(t => t.id)));
check('Coming up: the first card, with the day and time, and how many more', g[0].line === 'Thu 7 pm · Dinner with the Hales' && g[0].sub === '+2 more this week · bring dessert' && !g[0].hot, J(g[0]));
check('Practice: the goal in focus, this week against its target', g[1].line === 'Spanish · 1 of 4 this week', J(g[1]));
const late = new Date(2027, 2, 19, 9, 0);   // Fri: 3 days left, 3 sessions to go
const gl = ctx.fhGlance_(LOADED, late);
check('…behind on Friday with 3 to go: amber, and says so', gl[1].hot === true && gl[1].sub === 'Behind: 3 sessions left, 3 days', J(gl[1]));
check('…on Monday with 3 to go: on track', g[1].hot === false && g[1].sub === 'On track', J(g[1]));
check('Spending: the month against the plan, a line over is amber', g[2].line === '$840 of $900 a month' && g[2].sub === 'Under plan by $60 · 1 line over' && g[2].hot === true, J(g[2]));
check('Birthday: within 14 days and no gift ideas is amber', g[3].line === 'Sam’s birthday · in 5 days' && g[3].sub === 'No gift ideas yet' && g[3].hot === true, J(g[3]));
const calm = ctx.fhGlance_({ coming: { cards: [] }, practice: { goals: [] }, money: { noUploads: true }, birthday: { next: { label: 'Mom’s birthday', days: 9, ideas: 3 } } }, NOW);
check('calm: nothing amber; empty states say what they mean', !calm.some(t => t.hot) && calm[0].line === 'Nothing coming up this week' && calm[1].line === 'No goal in focus now' && calm[2].line === 'No spending yet this quarter' && calm[3].sub === '3 gift ideas saved', J(calm));
check('loading: each says Loading, nothing amber', ctx.fhGlance_({}, NOW).every(t => t.line === null && !t.hot));
check('a failed read says so on its own tile only', ctx.fhGlance_({ coming: { error: 'x' }, money: LOADED.money }, NOW)[0].line === 'Couldn’t load');
check('each opens its page', J(g.map(t => t.nav)) === J(['life', 'life', 'finances', 'people']));

console.log('\nAt a glance: one card, the most urgent');
{
  const T = (ids) => ids.map(id => ({ id, hot: true }));
  const pick = (hot) => ctx.fhGlancePick_(['coming', 'practice', 'money', 'birthday'].map(id => ({ id, hot: hot.includes(id) })));
  check('a birthday with no ideas comes first', pick(['practice', 'money', 'birthday']) === 'birthday');
  check('…then spending over plan', pick(['practice', 'money']) === 'money');
  check('…then practice behind', pick(['practice']) === 'practice');
  check('…otherwise Coming up (also while loading)', pick([]) === 'coming' && ctx.fhGlancePick_(ctx.fhGlance_({}, NOW)) === 'coming');
  check('from the real rules: with the invented data, the birthday', ctx.fhGlancePick_(g) === 'birthday', J(g.map(x => [x.id, x.hot])));
  check('a hidden page’s card isn’t picked', ctx.fhGlancePick_([{ id: 'coming', hot: false }, { id: 'practice', hot: true }]) === 'practice' && ctx.fhGlancePick_([{ id: 'practice', hot: false }]) === 'practice');
}

console.log('\nNeeds you');
const FLAGS = [{ id: 'F1', flag: 'Renew passport', urgency: 'High' }, { id: 'F2', flag: 'Low thing', urgency: 'Low' }, { id: 'F3', flag: 'Done one', urgency: 'High', resolved: true }, { id: 'F4', flag: 'Insurance card', urgency: 'Medium' }];
const TASKS = [{ id: 'T1', task: 'Call the plumber', isOverdue: true, dueDate: '2027-03-13' }, { id: 'T2', task: 'Far away', dueDate: '2027-04-30' }, { id: 'T3', task: 'Water plants', dueDate: '2027-03-16' }];
const EXTRA = [{ kind: 'perk', id: 'P1', title: 'Dining credit', sub: 'Gold · $10', days: 6, go: ['finances', 'fin_cards'] }];
const rows = ctx.fhNeeds_(FLAGS, TASKS, EXTRA, NOW);
check('high and medium flags, overdue and near tasks, and the extras; not resolved, low or far ones', J(rows.map(r => r.title)) === J(['Call the plumber', 'Renew passport', 'Water plants', 'Insurance card', 'Dining credit']), J(rows.map(r => r.title)));
check('…soonest first: overdue, today, tomorrow, soon, 6 days', J(rows.map(r => r.days)) === J([-2, 0, 1, 3, 6]), J(rows.map(r => r.days)));
check('…each knows its tab', rows[0].go[0] === 'tasks' && rows[1].go[0] === 'flags' && rows[4].go[0] === 'finances');
check('at most ten', ctx.fhNeeds_(Array.from({ length: 14 }, (_, i) => ({ id: 'X' + i, flag: 'F' + i, urgency: 'High' })), [], [], NOW).length === 10);

console.log('\nMoney, and System health');
check('Money: the next unpaid bill, amber within 3 days', J(ctx.fhMoneyLine_({ bills: [{ bill: 'Internet', amount: 80, dueDay: 17 }, { bill: 'Rent', dueDay: 1 }, { bill: 'Water', dueDay: 16, paid: true }] }, NOW)) === J({ line: 'Internet $80 · due in 2 days', hot: true }));
check('…none left this month', ctx.fhMoneyLine_({ bills: [{ bill: 'Rent', dueDay: 1 }] }, NOW).line === 'No bills left this month');
const H = { nightly: { at: new Date(2027, 2, 15, 2, 14).toISOString(), stoppedAt: '' }, agents: { counts: { ok: 4, late: 1, failed: 0, none: 0 }, agents: [{ name: 'TESS', level: 'late' }] }, api: { counts: { ok: 4, slow: 0, failing: 0 } }, tripIds: { totals: { blank: 1, mismatched: 0 }, tabs: [] } };
let hh = ctx.fhHealth_(H, NOW);
check('System health: four parts, the bad ones named', hh.parts.length === 4 && hh.hot && J(hh.parts.filter(p => p.bad).map(p => p.k)) === J(['agents', 'setup']) && /TESS late/.test(hh.parts[1].text) && /1 Trip ID to fix/.test(hh.parts[3].text), J(hh));
hh = ctx.fhHealth_(Object.assign({}, H, { agents: { counts: { ok: 5 } }, tripIds: { totals: {}, tabs: [] } }), NOW);
check('…all fine: not hot', !hh.hot && hh.parts.every(p => !p.bad), J(hh));
check('…a stopped or stale nightly run is bad', ctx.fhHealth_({ nightly: { at: H.nightly.at, stoppedAt: 'getUpcomingEvents' } }, NOW).parts[0].bad && ctx.fhHealth_({ nightly: { at: new Date(2027, 2, 12).toISOString() } }, NOW).parts[0].bad && ctx.fhHealth_({ nightly: { at: '' } }, NOW).parts[0].bad);
check('…a skipped trip tab counts', /1 tab skipped/.test(ctx.fhHealth_({ tripIds: { totals: {}, tabs: [{ skipped: 'x' }] } }, NOW).parts[0].text));

// ---- the page --------------------------------------------------------------------
const REPLIES = {
  get_todays_events: { ok: true, calendarFound: true, events: [{ title: 'Team standup', allDay: false, startTime: '9:00 AM', endTime: '9:30 AM', location: 'Zoom' }, { title: 'Dinner with the Hassans', allDay: false, startTime: '7:30 PM', endTime: '9:30 PM', location: 'Home' }] },
  coming_up: LOADED.coming, life_growth: LOADED.practice, budget_actuals: LOADED.money,
  get_important_dates: { dates: [{ Label: 'Sam’s birthday', Person: 'Sam', daysUntil: 5 }] }, get_gift_data: { ideas: [] },
  cards: { cards: [], perks: [], rewards: [], programs: [] }, get_chores: { chores: [] },
  bills: { bills: [{ bill: 'Internet', amount: 80, dueDay: new Date().getDate() + 1 > 28 ? 28 : new Date().getDate() + 1 }] },
  home_nightly: { ok: true, at: new Date().toISOString(), stoppedAt: '' },
  agent_health: H.agents, system_api_health: H.api, trip_id_check: { ok: true, totals: { blank: 0, mismatched: 0 }, tabs: [] },
  away_status: { on: false }, aria_book: { ok: true, items: [] },
};
const today = new Date(), iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const plus = n => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
REPLIES.get_coupons = { coupons: [{ ID: 'C1', Store: 'Fresh Market', Offer: '$5 off $40', Expires: plus(2) }] };
const PROPS = {
  flags: [{ id: 'F1', flag: 'Renew passport', urgency: 'High' }, { id: 'F4', flag: 'Insurance card', urgency: 'Medium' }],
  tasks: Array.from({ length: 7 }, (_, i) => ({ id: 'T' + i, task: 'Overdue task ' + (i + 1), isOverdue: true, dueDate: plus(-1 - i) })),
  projects: [{ projectId: 'P1', projectName: 'Kitchen', tasks: [{ status: 'Open' }] }],
  shopping: [{ tabId: 's1', storeName: 'Costco', items: [{ done: false }, { done: false }] }],
  pto: { ahmedStats: { remaining: { vacationDays: 12 }, upcomingTravel: [{ label: 'Lisbon', startDate: plus(10), endDate: plus(16) }] }, victoriaStats: { remaining: { vacationDays: 9 } } },
  milestones: [], summaries: {}, status: { high: 1, medium: 1, low: 0 }, pacingStatus: {},
  mailCounter: { pieces: 2, packages: 1, lastScanRun: new Date().toISOString() }, mailCounterBusy: false,
};

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of (process.env.VERA_CTL_FAST ? [1280, 390] : [1280, 1000, 390])) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ replies, props }) => {
      window.__gets = []; window.__nav = [];
      window.apiGet = (u, t, q) => { window.__gets.push(q.action); const r = replies[q.action]; return r ? Promise.resolve(JSON.parse(JSON.stringify(r))) : Promise.resolve({ ok: true }); };
      window.apiPost = () => Promise.resolve({ ok: true });
      try { localStorage.setItem('vera_install_tip_done', '1'); } catch (e) {}
      document.body.innerHTML = '<div id="fhprobe" style="padding:0 16px"></div>';
      const p = Object.assign({}, props, { apiUrl: 'https://vera.test/exec', apiToken: 't', onNavigate: tab => window.__nav.push(tab), onViewItinerary: () => {}, onResetMailCounter: () => window.__nav.push('reset-mail') });
      window.__home = () => window.__root.render(React.createElement(HomeTab, p));
      window.__root = ReactDOM.createRoot(document.getElementById('fhprobe')); window.__home();
    }, { replies: REPLIES, props: PROPS });
    await wait(400);
    const t = await page.$eval('#fhprobe', n => n.innerText);
    check('no page errors', !errors.length, errors.join('; '));
    check('Today: the Joint Chaos events and the trip chip', /📅 Today ·/.test(t) && /Team standup/.test(t) && /9:00 AM – 9:30 AM · Zoom/.test(t) && /✈️ Lisbon in 10 days/.test(t), t.slice(0, 300));
    const cards = await page.$$eval('.fh-gt', ns => ns.map(n => [n.dataset.tile, n.className.includes('hot'), n.innerText.replace(/\s+/g, ' ')]));
    check('At a glance: one card, the most urgent (a birthday with no gift ideas), amber', cards.length === 1 && cards[0][0] === 'birthday' && cards[0][1] && /Sam’s birthday · in 5 days/.test(cards[0][2]), J(cards));
    const chips = await page.$$eval('.fh-gchip', ns => ns.map(n => [n.dataset.chip, n.getAttribute('aria-pressed'), !!n.querySelector('.fh-gdot')]));
    check('…four chips to peek, the urgent one marked', J(chips) === J([['coming', 'false', false], ['practice', 'false', false], ['money', 'false', false], ['birthday', 'true', true]]), J(chips));
    await page.click('.fh-gchip[data-chip="money"]'); await wait(40);
    check('…a chip shows another card', (await page.$eval('.fh-gt', n => n.dataset.tile)) === 'money' && /\$840 of \$900 a month/.test(await page.$eval('.fh-gt', n => n.innerText)));
    await page.click('.fh-gt'); await wait(30);
    check('…and the card opens its page', (await page.evaluate(() => window.__nav)).includes('finances'));
    await page.click('.fh-gchip[data-chip="money"]'); await wait(40);
    await page.evaluate(() => { window.__root.render(React.createElement('div')); }); await wait(30);   // leave Home…
    await page.evaluate(() => window.__home()); await wait(300);                                         // …and come back
    check('…a peek lasts only until you leave Home: back, it picks by urgency again', (await page.$eval('.fh-gt', n => n.dataset.tile)) === 'birthday');
    check('no pick-one card', !(await page.$('.hs-slot')) && !(await page.$('.hs-pick')));
    const needs = await page.$$eval('.fh-nr', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
    check('Needs you: five on a computer, three on a phone, soonest first, with See all', needs.length === (width < 620 ? 3 : 5) && /Overdue task 7/.test(needs[0]) && /See all 10/.test(t), J(needs));
    await page.click('.fh-more'); await wait(60);
    check('…See all shows the rest, the lite Today’s coupon among them', (await page.$$('.fh-nr')).length === 10 && !!(await page.$('.fh-nr[data-kind="coupon"]')) && /Fresh Market coupon/.test(await page.$eval('.fh-nr[data-kind="coupon"]', n => n.innerText)));
    await page.click('.fh-nr[data-kind="flag"]'); await wait(30);
    check('…a flag row opens Flags', (await page.evaluate(() => window.__nav)).includes('flags'));
    const every = await page.$$eval('.fh-grid > *', ns => ns.map(n => (n.querySelector('.fh-tile-t, .bento-card-title') || n).innerText.trim().split('\n')[0]));
    check('Everything: compact tiles only, no big-number cards', !(await page.$('.fh-grid .bento-card-main')) && (await page.$$('.fh-grid > .fh-tile')).length === 10, J(every));
    check('…flags and tasks say what needs you, amber', /2 open · 1 high/.test(await page.$eval('.fh-tile[data-tile="flags"]', n => n.innerText)) && (await page.$eval('.fh-tile[data-tile="tasks"]', n => n.className)).includes('hot'));
    check('Everything: the ten, Mail and System health among them', ['Flags', 'Tasks', 'Shopping', 'Money', 'Which card', 'Projects', 'PTO', 'Mail & Packages', 'Travel', 'System health'].every(w => every.some(x => x.toLowerCase().indexOf(w.toLowerCase()) !== -1)), J(every));
    check('…the mail card has Got the mail!', /Got the mail!/.test(t));
    await page.click('text=✓ Got the mail!'); await wait(30);
    check('…and it resets the counter', (await page.evaluate(() => window.__nav)).includes('reset-mail'));
    check('Travel tile: the next trip', /Lisbon in 10 days/.test(await page.$eval('.fh-tile[data-tile="travel"]', n => n.innerText)));
    const health = await page.$eval('.fh-health', n => [n.className, n.innerText.replace(/\s+/g, ' ')]);
    check('System health: what to look at', /hot/.test(health[0]) && /1 to look at/.test(health[1]) && /TESS late/.test(health[1]), J(health));
    await page.click('.fh-health'); await wait(30);
    check('…opens System', (await page.evaluate(() => window.__nav)).includes('system'));
    const got = await page.evaluate(() => window.__gets);
    check('it reads the routes it shows, and writes nothing', ['get_todays_events', 'coming_up', 'life_growth', 'budget_actuals', 'get_important_dates', 'cards', 'get_coupons', 'get_chores', 'bills', 'home_nightly', 'agent_health', 'system_api_health', 'trip_id_check'].every(a => got.includes(a)), J(got));
    const box = s => page.$eval(s, n => { const r = n.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; });
    const L = await box('.fh-left'), R = await box('.fh-right');
    if (width >= 1000) check('two columns: Today on the left, Needs you on the right', R[0] > L[0] + L[2] - 2 && Math.abs(R[1] - L[1]) < 4, J([L, R]));
    else { const T = await box('.fh-today'), G = await box('.fh-glance'); check('a phone: one column, Today, then Needs you, then At a glance (the mockup’s order)', T[1] < R[1] && R[1] < G[1] && Math.abs(R[0] - T[0]) < 4, J([T, R, G])); }
    const tops = await page.$$eval('.fh-grid > .fh-tile', ns => ns.slice(0, 4).map(n => Math.round(n.getBoundingClientRect().top)));
    if (width >= 1200) check('four tiles across', new Set(tops).size === 1, J(tops));
    if (width < 620) check('two tiles across on a phone', tops[0] === tops[1] && tops[2] === tops[3] && tops[1] < tops[2], J(tops));
    check('no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    if (process.env.FH_SHOT) await page.screenshot({ path: process.env.FH_SHOT + width + '.png', fullPage: true });
    await page.close();
  }
  // Today without the calendar
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { window.apiGet = (u, t, q) => Promise.resolve(q.action === 'get_todays_events' ? { ok: true, events: [], calendarFound: false } : { ok: true });
    document.body.innerHTML = '<div id="p"></div>'; ReactDOM.createRoot(document.getElementById('p')).render(React.createElement(FhToday, { apiUrl: 'u', apiToken: 't', upcoming: [], todayStr: '2027-03-15' })); });
  await wait(150);
  check('Today says when it can’t find the Joint Chaos calendar', /Couldn’t find the Joint Chaos calendar/.test(await page.$eval('#p', n => n.innerText)));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + e.message); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
