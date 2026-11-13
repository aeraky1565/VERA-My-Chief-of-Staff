// PTO Planner › 📅 Next year (#248) and lite's Time off card, in both dashboards at phone and
// desktop width, over a plan made by the real planner (PTOStrategy.js) on invented calendars.
// Strategy pills, Advanced, the budget with the "take by" line, the filter pills and the
// date-ordered picks with whose-break pills, Accept / Skip, an accepted break's follow-ons,
// the year grid, Use it before Dec 31, the lite card, and each person's own plan card.
const { chromium } = require('playwright');
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8'), LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

// The plan, from the real planner.
const P = { console }; vm.createContext(P); vm.runInContext(fs.readFileSync(path.join(ROOT, 'PTOStrategy.js'), 'utf8'), P);
const FED = P.ptsFederalHolidays_(2027), AH = Object.assign({}, FED, { '2027-11-26': 'Day after Thanksgiving' });
const first = P.ptsPlan_({ year: 2027, today: '2026-11-26', settings: P.ptsSettings_({}), locked: [{ label: 'Lisbon', start: '2027-04-09', end: '2027-04-18' }],
  pencilled: [{ label: 'Beach week', months: ['2027-08'], days: 8, who: ['ahmed', 'victoria'] }], saved: {},
  people: [{ id: 'ahmed', name: 'Ahmed', holidays: AH, busy: [], budget: { vacation: 20, carry: 20, personal: 6, booked: 0, buffer: 2, capCarry: 23, accrual: { annual: 20, day: 16, cap: 25 } } },
           { id: 'victoria', name: 'Victoria', holidays: FED, assumed: true, busy: [], budget: { vacation: 15, carry: 2, personal: 0, booked: 0, buffer: 2, capCarry: null } }] });
const thx = first.picks.find(c => c.who === 'joint' && /Christmas/.test(c.label)) || first.picks.find(c => c.who === 'joint');
const PLAN = JSON.parse(JSON.stringify(first));
PLAN.picks.forEach(c => { if (c.id === thx.id) { c.status = 'accepted'; c.away = false; } });
const useIt = P.ptsUseItBefore_([{ id: 'ahmed', name: 'Ahmed', holidays: Object.assign(P.ptsFederalHolidays_(2026), { '2026-11-27': 'Day after' }), busy: [], blackouts: [], personalLeft: 2, vacationLeft: 26, capCarry: 23 }], '2026-11-13');
const presets = {}; Object.keys(P.PTS_PRESETS_).forEach(k => { presets[k] = { label: P.PTS_PRESETS_[k].label, about: P.PTS_PRESETS_[k].about }; });
const RESP = { ok: true, today: '2026-11-26', defaultYear: 2027, years: [2026, 2027], plan: PLAN, useIt: JSON.parse(JSON.stringify(useIt)), presets, settings: PLAN.settings };

console.log('\nthe block and the wiring');
{
  const blk = s => { const a = s.indexOf('// ---- PtoStrategyView'), b = s.indexOf('// ---- end PtoStrategyView ----'); return a === -1 ? '' : s.slice(a, b); };
  check('the shared block is byte-identical in both dashboards', blk(APP).length > 1000 && blk(APP) === blk(LITE));
  check('PTO Planner has a third subtab, Next year', /\{id:'nextyear',label:'📅 Next year'/.test(APP) && /ptoSub==='nextyear'&&React\.createElement\(PtoStrategyView,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
  check('Go to it from a PTO plan flag lands there', /\['PTOPLAN\|','pto','nextyear'\]/.test(APP) && /veraTakeGoto_\('pto','ahmed'\)/.test(APP));
  check('lite: the Time off card on Today', /\{activeTab === 'overview' && <PtoStrategyView apiUrl=\{apiUrl\} apiToken=\{apiToken\} compact=\{true\} me="victoria" \/>\}/.test(LITE));
  check('each person’s own view shows their plan', /stats\.plan&&stats\.plan\.breaks&&stats\.plan\.breaks\.length>0&&React\.createElement\(PtoPersonPlan/.test(APP));
}

async function mount(browser, file, width, props) {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  if (file === 'index.html') await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
  else {
    const vendor = { 'react.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'), 'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
      'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8') };
    await page.route('**/*', route => { const url = route.request().url();
      if (url.startsWith('https://vera.test/dashboard-lite.html')) return route.fulfill({ contentType: 'text/html', body: LITE });
      for (const n of Object.keys(vendor)) if (url.includes(n)) return route.fulfill({ contentType: 'application/javascript', body: vendor[n] });
      return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' }); });
    await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
  }
  await page.waitForFunction(() => typeof PtoStrategyView === 'function', null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(({ RESP, props }) => {
    const root = document.getElementById('root'); if (root) root.style.display = 'none';
    window.__calls = [];
    window.fetch = (url, opts) => { const p = Object.fromEntries(new URL(url).searchParams); if (opts && opts.body) Object.assign(p, JSON.parse(opts.body)); window.__calls.push(p);
      const body = p.action === 'pto_strategy' || p.action === 'pto_strategy_settings' ? RESP : { ok: true };
      return Promise.resolve({ json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) }); };
    const host = document.createElement('div'); host.id = 'ps'; host.style.padding = '0 12px'; document.body.prepend(host);
    ReactDOM.createRoot(host).render(React.createElement(PtoStrategyView, Object.assign({ apiUrl: 'https://vera.test/exec', apiToken: 't' }, props)));
  }, { RESP, props: props || {} });
  await wait(400);
  return { page, errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const file of ['index.html', 'dashboard-lite.html']) for (const width of (process.env.VERA_CTL_FAST ? [390] : [390, 1280])   /* a control checks one width */) {
    const L = (file === 'index.html' ? 'Full ' : 'Lite ') + width;
    console.log('\n' + L);
    let { page, errs } = await mount(browser, file, width);
    const calls = () => page.evaluate(() => window.__calls.filter(c => c.action !== 'pto_strategy'));
    const sideways = () => page.evaluate(() => Array.from(document.querySelectorAll('#ps *')).some(n => n.getBoundingClientRect().right > window.innerWidth + 1));
    check(L + ': it asks for the plan', (await page.evaluate(() => window.__calls.map(c => c.action).join())) === 'pto_strategy');
    const starts = await page.$$eval('#ps .ps-view > .ps-pick', ns => ns.map(n => n.getAttribute('data-pick')));
    check(L + ': picks in date order, one list', starts.length === PLAN.picks.length && starts.join() === PLAN.picks.slice().sort((a, b) => a.start < b.start ? -1 : 1).map(c => c.id).join(), starts.join());
    const whos = await page.$$eval('#ps .ps-view > .ps-pick .ps-who', ns => ns.map(n => n.textContent));
    check(L + ': each with a whose-break pill', whos.length === starts.length && whos.every(w => ['Together', 'Ahmed', 'Victoria'].indexOf(w) !== -1) && whos.indexOf('Together') !== -1);
    check(L + ': breaks that save an accrual say so', (await page.$$('#ps .ps-cap')).length === PLAN.picks.filter(c => c.reason === 'cap').length && PLAN.picks.some(c => c.reason === 'cap'));
    await page.click('#ps .ps-filter button:nth-of-type(4)'); await wait(80);   // Victoria
    const vic = await page.$$eval('#ps .ps-view > .ps-pick .ps-who', ns => ns.map(n => n.textContent));
    check(L + ': the Victoria pill shows hers and the shared ones', vic.length > 0 && vic.every(w => w !== 'Ahmed'), vic.join());
    await page.click('#ps .ps-filter button:nth-of-type(1)'); await wait(80);
    const tb = await page.$$eval('#ps .ps-takeby-step', ns => ns.map(n => n.textContent));
    check(L + ': “take by” steps for the capped balance, each ticked', tb.length > 0 && tb.every(t => /^✓ \d+ by [A-Z][a-z]{2} \d+$/.test(t)), tb.join(' | '));
    check(L + ': the budget names accruals lost', /Accruals lost at the cap/.test(await page.$eval('#ps .ps-budget', n => n.textContent)));
    check(L + ': Use it before Dec 31, with this year’s breaks', /Use it before Dec 31/.test(await page.$eval('#ps .ps-useit', n => n.textContent).catch(() => '')) && (await page.$$('#ps .ps-useit .ps-pick')).length === useIt.picks.length);
    check(L + ': the year grid shows holidays, the locked trip, the reserve and the picks', (await page.$$('#ps .ps-grid .ps-h, #ps .ps-grid .ps-ha')).length >= 10 && (await page.$$('#ps .ps-grid .ps-l')).length === 10 && (await page.$$('#ps .ps-grid .ps-p')).length > 0 && (await page.$$('#ps .ps-grid .ps-k')).length > 0);
    // Accept
    const open = PLAN.picks.find(c => c.status === 'suggested');
    await page.click('#ps .ps-pick[data-pick="' + open.id + '"] .ps-accept'); await wait(300);
    let c = await calls();
    check(L + ': Accept posts the pick', c.some(x => x.action === 'pto_plan_accept' && x.id === open.id && x.year === 2027), JSON.stringify(c));
    await page.evaluate(() => { window.__calls = []; });
    await page.click('#ps .ps-pick[data-pick="' + open.id + '"] .ps-skip'); await wait(300);
    check(L + ': Skip posts the pick', (await calls()).some(x => x.action === 'pto_plan_skip' && x.id === open.id));
    // the accepted one
    const acc = '#ps .ps-pick[data-pick="' + thx.id + '"]';
    const follow = await page.$eval(acc + ' .ps-follow', n => n.textContent).catch(() => '');
    check(L + ': an accepted break: on the VERA calendar, and when to request it at work', /On the VERA calendar/.test(follow) && /Request it at work by [A-Z][a-z]{2} [A-Z][a-z]{2} \d+/.test(follow), follow.slice(0, 160));
    await page.evaluate(() => { window.__calls = []; });
    if (thx.days >= 5) { await page.click(acc + ' .ps-trip'); await wait(250); }
    await page.click(acc + ' .ps-away'); await wait(250);
    c = await calls();
    check(L + ': …pencil a trip (5+ days) and Away mode, through their routes', (thx.days < 5 || c.some(x => x.action === 'pto_plan_follow' && x.what === 'trip')) && c.some(x => x.action === 'pto_plan_follow' && x.what === 'away' && x.on === true), JSON.stringify(c));
    // strategies
    await page.evaluate(() => { window.__calls = []; });
    await page.click('#ps .ps-preset:nth-of-type(2)'); await wait(300);
    c = await calls();
    check(L + ': a strategy pill saves and re-plans', c.some(x => x.action === 'pto_strategy_settings' && x.preset === 'value'), JSON.stringify(c));
    await page.click('#ps .ps-adv-wrap summary'); await wait(100);
    await page.fill('#ps #ps-maxPto', '3'); await page.fill('#ps #ps-blackouts-ahmed', '2027-03-22..2027-03-31');
    await page.evaluate(() => { window.__calls = []; });
    await page.click('#ps .ps-adv-save'); await wait(300);
    c = await calls();
    check(L + ': Advanced saves only what changed', c.some(x => x.action === 'pto_strategy_settings' && x.overrides && x.overrides.maxPto === 3 && x.overrides.blackouts && x.overrides.blackouts.ahmed === '2027-03-22..2027-03-31' && !('minRatio' in x.overrides)), JSON.stringify(c));
    check(L + ': no sideways scroll, no page errors', !(await sideways()) && !errs.length, errs.join(' | '));
    await page.close();
    // the lite card
    ({ page, errs } = await mount(browser, file, width, { compact: true, me: 'victoria' }));
    const card = await page.$eval('#ps .ps-lite', n => n.textContent).catch(() => '');
    check(L + ': the Time off card: her breaks and the shared ones, nothing of his alone', /Time off in 2027/.test(card) && (await page.$$eval('#ps .ps-lite .ps-who', ns => ns.map(n => n.textContent))).every(w => w !== 'Ahmed'));
    check(L + ': …Accept only, and the assumed-holidays note', (await page.$$('#ps .ps-lite .ps-skip')).length === 0 && /holidays are assumed/.test(card));
    check(L + ': …no sideways scroll, no page errors', !(await page.evaluate(() => Array.from(document.querySelectorAll('#ps *')).some(n => n.getBoundingClientRect().right > window.innerWidth + 1))) && !errs.length, errs.join(' | '));
    await page.close();
  }
  // Each person's own card (full dashboard).
  console.log('\nAhmed’s own PTO view');
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => typeof PtoPersonPlan === 'function', null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'pp'; document.body.prepend(host);
    ReactDOM.createRoot(host).render(React.createElement(PtoPersonPlan, { vacationLeft: 12, plan: { pending: 3, slots: { longWeekend: 1, midSizeWeek: 1, bigPivot: 0 },
      breaks: [{ id: 'a', label: 'Memorial weekend', start: '2027-05-28', end: '2027-05-31', days: 1, onCalendar: true }, { id: 'b', label: 'Thanksgiving week', start: '2027-11-20', end: '2027-11-28', days: 3, onCalendar: false }] } }));
  });
  await wait(200);
  const t = await page.$eval('#pp', n => n.textContent).catch(() => '');
  check('his breaks, which are on the work calendar and which still need requesting', /Memorial weekend/.test(t) && /on the work calendar/.test(t) && /still to request/.test(t));
  check('…and the balance once they’re taken, with the 3-2-1 they fill', /3 days still to request; 9 vacation days left once taken/.test(t) && /Fills: 1 long weekend · 1 mid-size week/.test(t), t);
  check('…no page errors', !errs.length, errs.join(' | '));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(2); });
