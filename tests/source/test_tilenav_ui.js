// The icon-tile navigation (VeraTileNav, shared verbatim by both dashboards), Home's pick-and-remember
// slot card (HomeSlot, full dashboard), and the lite dashboard's eight-tab layout for Victoria.
// Every value here is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const START = '// ---- VeraTileNav — SHARED VERBATIM', END = '// ---- /VeraTileNav ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
const HS_START = '// ---- Home › the slot', HS_END = '"Open →"));}';
const hsBlock = (() => { const a = APP.indexOf(HS_START), b = APP.indexOf(HS_END, a); return a === -1 || b === -1 ? '' : APP.slice(a, b + HS_END.length); })();

console.log('\nthe shared block');
check('both dashboards carry it, word for word', block(APP).length > 1000 && block(APP) === block(LITE));
const C = vm.createContext({ React: { createElement: () => null, useState: v => [v, () => {}], useEffect: () => {} } });
vm.runInContext(block(APP), C);
const ids = (name, tabs) => vm.runInContext('vnGroupsFor_(' + JSON.stringify(name) + ',' + JSON.stringify(tabs) + ').map(function(g){return g.id+":"+g.tabs.map(function(t){return t.id;}).join("+");}).join(" ")', C);
const T = list => list.map(id => ({ id, label: id }));
check('Career: five groups, Brand and Market together as Search, Network on its own',
  ids('career', T(['market', 'network', 'brand', 'northstar', 'readiness', 'evidence', 'credentials', 'pipeline', 'exchange'])) === 'direction:northstar+readiness proof:evidence+credentials search:brand+market agents:pipeline+exchange network:network');
check('System: Reference, Checks, Settings',
  ids('system', T(['assistants', 'test', 'notifications', 'trip_emails', 'config', 'api_health', 'flags', 'documents'])) === 'reference:assistants+documents checks:test+api_health settings:notifications+trip_emails+config+flags');
check('Life: four groups of three',
  ids('life', T(['now', 'goals', 'habits', 'learning', 'trials', 'review', 'places', 'lessons', 'things', 'ideas', 'giving', 'notes'])) === 'grow:now+goals+habits learn:learning+trials+review explore:places+lessons+things keep:ideas+giving+notes');
check('Travel 4, Health 3, People 4',
  ids('travel', T(['trips', 'itinerary', 'ideas', 'aria', 'countries', 'bucketlist', 'profiles', 'gifts'])).split(' ').length === 4
  && ids('health', T(['fitness', 'morning_routine', 'prescriptions', 'appointments', 'family_planning'])).split(' ').length === 3
  && ids('people', T(['people', 'dates', 'gifts', 'wishlists'])).split(' ').length === 4);
check('a subtab not on offer is left out, and an emptied group is hidden', ids('travel', T(['gifts', 'trips'])) === 'trips:trips travelers:gifts');
check('an unknown tab name has no groups', ids('nope', T(['a'])) === '');
check('each subtab finds its group; an unknown one finds none',
  vm.runInContext('vnGroupOf_("career","market")+","+vnGroupOf_("career","network")+","+vnGroupOf_("system","flags")+","+vnGroupOf_("life","x")', C) === 'search,network,settings,');
check('lite: Shopping, Travel and Family groups are Victoria’s own',
  ids('lite_shopping', T(['lists', 'cheat', 'coupons'])) === 'lists:lists cheat:cheat coupons:coupons'
  && ids('lite_travel', T(['trips', 'gifts'])) === 'trips:trips gifts:gifts'
  && ids('lite_family', T(['planning', 'prescriptions', 'wishlists', 'contacts'])) === 'planning:planning health:prescriptions gifts:wishlists contacts:contacts');

console.log('\nwho uses it');
check('the full dashboard puts Career, System, Life, Travel, Health and People on it',
  ['career', 'system', 'life', 'travel', 'health', 'people'].every(n => APP.indexOf("VeraTileNav,{name:'" + n + "'") !== -1),
  ['career', 'system', 'life', 'travel', 'health', 'people'].filter(n => APP.indexOf("VeraTileNav,{name:'" + n + "'") === -1).join());
check('the lite dashboard puts Shopping, Travel and Family on it',
  ['lite_shopping', 'lite_travel', 'lite_family'].every(n => LITE.indexOf('<VeraTileNav name="' + n + '"') !== -1));

console.log('\nthe lite dashboard (Victoria)');
const tops = ((LITE.match(/const TOP_TABS = \[[\s\S]*?\];/) || [''])[0].match(/id: '(\w+)'/g) || []).map(x => x.slice(5, -1));
check('eight top tabs, Chat right after Today', tops.join() === 'overview,chat,shopping,home_front,travel,finances,family,projects', tops.join());
check('old top tabs still land in the right place',
  /cards: \['finances', 'fin_cards'\]/.test(LITE) && /coupons: \['shopping', 'coupons'\]/.test(LITE) && /prescriptions: \['family', 'prescriptions'\]/.test(LITE)
  && /wishlists: \['family', 'wishlists'\]/.test(LITE) && /people: \['family', 'contacts'\]/.test(LITE) && /household: \['home_front', ''\]/.test(LITE)
  && /var to = LITE_OLD_TABS\[id\];/.test(LITE));
check('Shopping holds the card cheat sheet, and Money › Cards has no cheat sheet',
  /<CardsTab apiUrl=\{apiUrl\} apiToken=\{apiToken\} part="cheat" \/>/.test(LITE) && /part="cards" \/>/.test(LITE)
  && /display: part === 'cards' \? 'none' : undefined/.test(LITE) && /display: part === 'cheat' \? 'none' : 'flex'/.test(LITE));
check('Travel is My Trips, Bucket List, Profiles and Gifts', /const LITE_TRAVEL_TABS = \[\{ id: 'trips', label: '✈️ My Trips' \}, \{ id: 'bucketlist', label: '🪣 Bucket List' \}, \{ id: 'profiles', label: '👤 Profiles' \}, \{ id: 'gifts', label: '🎁 Gifts' \}\];/.test(LITE));
check('Your assistants stays on lite Today', LITE.indexOf('<VeraRoster links={status && status.rosterLinks} veraHref="./" />') !== -1);
check('no Home slot on lite', LITE.indexOf('HomeSlot') === -1);

console.log('\nHome › the slot (pure)');
check('the full dashboard mounts it on Home', APP.indexOf('React.createElement(HomeSlot,{apiUrl:apiUrl,apiToken:apiToken,onNavigate:onNavigate})') !== -1 && hsBlock.length > 1000);
check('Home keeps Mail & Packages, Shopping and the active trip card',
  APP.indexOf('React.createElement(MailCounterCard,{counter:mailCounter') !== -1 && APP.indexOf('"🛒 Shopping"),shopping.length===0') !== -1 && APP.indexOf('displayTrip&&/*#__PURE__*/React.createElement(ActiveTravelCard') !== -1);
const H = vm.createContext({ React: { createElement: () => null, useState: v => [v, () => {}], useEffect: () => {} } });
vm.runInContext(hsBlock, H);
check('the four cards, and no Bills', vm.runInContext('HS_CARDS.map(function(c){return c.id;}).join()', H) === 'coming,practice,money,birthday' && !/bill/i.test(vm.runInContext('JSON.stringify(HS_CARDS)', H)));
H.r = { quarter: '2026-Q4', lines: { a: { plan: 500, actual: 420 }, b: { plan: 200, actual: 260 }, c: { plan: 100, actual: null } } };
check('spending: monthly average against plan, lines without actuals skipped',
  vm.runInContext('JSON.stringify(hsSpending_(r))', H) === JSON.stringify({ plan: 700, actual: 680, left: 20, over: 1, lines: 2, quarter: '2026-Q4' }));
check('spending: nothing uploaded gives nothing', vm.runInContext('hsSpending_({noUploads:true})===null&&hsSpending_({lines:{}})===null&&hsSpending_(null)===null', H));
H.d = [{ Label: 'Sam’s Birthday', Person: 'Sam', daysUntil: 12, nextDate: '2026-11-15' }, { Label: 'Dentist', daysUntil: 2 }, { Label: 'Anniversary', Person: 'Pat', daysUntil: 40 }, { Label: 'Kim’s Birthday', Person: 'Kim', daysUntil: -3 }];
H.i = [{ person: 'sam' }, { Person: 'Sam ' }, { person: 'Pat' }];
check('birthday: the next birthday or anniversary, with that person’s gift ideas',
  vm.runInContext('JSON.stringify(hsNextDate_(d,i))', H) === JSON.stringify({ label: 'Sam’s Birthday', person: 'Sam', date: '2026-11-15', days: 12, ideas: 2 }));
check('birthday: none ahead gives nothing', vm.runInContext('hsNextDate_([{Label:"Dentist",daysUntil:1}],[])===null', H));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
  };
  const shell = body => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#0b1020;color:#dde1f0;font-family:sans-serif}</style>'
    + '<script src="/react.js"></script><script src="/react-dom.js"></script></head><body><div id="root"></div><script>' + body + '</script></body></html>';
  const open = async (width, body, store) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route('**/*', r => {
      const u = new URL(r.request().url()).pathname.slice(1);
      if (vendor[u]) return r.fulfill({ contentType: 'application/javascript', body: vendor[u] });
      return r.fulfill({ contentType: 'text/html', body: shell(body) });
    });
    if (store) await page.addInitScript(s => { for (const k in s) localStorage.setItem(k, s[k]); }, store);
    await page.goto('http://probe.local/');
    await wait(300);
    return { page, errs };
  };

  for (const width of [390, 1280]) {
    const L = 'nav @' + width;
    const TABS = [['northstar', 'North Star'], ['readiness', 'Readiness'], ['evidence', 'Evidence'], ['credentials', 'Credentials'], ['brand', 'Brand'], ['market', 'Market'], ['pipeline', 'Pipeline'], ['exchange', 'Exchange'], ['network', 'Network']]
      .map(([id, label]) => ({ id, label }));
    const probe = block(APP) + '\nvar TABS=' + JSON.stringify(TABS) + ';function P(){var s=React.useState("northstar");return React.createElement("div",null,React.createElement(VeraTileNav,{name:"career",label:"Career",tabs:TABS,sub:s[0],onPick:s[1]}),React.createElement("div",{id:"cur"},s[0]));}'
      + 'ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(P));';
    let { page, errs } = await open(width, probe);
    const st = () => page.evaluate(() => ({
      tiles: [...document.querySelectorAll('.vn-tile')].map(n => n.textContent),
      on: [...document.querySelectorAll('.vn-tile.on')].map(n => n.textContent).join(),
      chips: [...document.querySelectorAll('.vn-chips .subtab-btn')].map(n => n.textContent),
      active: [...document.querySelectorAll('.vn-chips .subtab-btn.active')].map(n => n.textContent).join(),
      cur: document.getElementById('cur').textContent,
      titles: [...document.querySelectorAll('.vn-tile')].map(n => n.title),
    }));
    const tile = async t => { await page.locator('.vn-tile', { hasText: t }).first().click(); await wait(120); };
    const chip = async t => { await page.locator('.vn-chips .subtab-btn', { hasText: t }).first().click(); await wait(120); };
    let s = await st();
    check(L + ': five icon tiles, each says what is in it', s.tiles.join('|') === '🧭Direction|📎Proof|🔍Search|🔁Agents|🤝Network' && s.titles[2] === 'Brand · Market', JSON.stringify(s));
    check(L + ': opens on Direction › North Star', s.on === '🧭Direction' && s.active === 'North Star' && s.chips.join('|') === 'North Star|Readiness');
    await tile('Search'); s = await st();
    check(L + ': a tile opens its first subtab', s.cur === 'brand' && s.chips.join('|') === 'Brand|Market');
    await chip('Market'); await tile('Network'); s = await st();
    check(L + ': a one-subtab group opens straight to it, no chips', s.cur === 'network' && s.chips.length === 0 && !(await page.$('.vn-chips')));
    await tile('Search'); s = await st();
    check(L + ': a group remembers its last subtab', s.cur === 'market' && s.active === 'Market');
    check(L + ': kept in this browser', (JSON.parse(await page.evaluate(() => localStorage.getItem('vera_vn_career')) || '{}')).search === 'market');
    check(L + ': tiles are big enough to tap', await page.$$eval('.vn-tile', ns => ns.every(n => n.getBoundingClientRect().height >= 44)));
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();

    ({ page, errs } = await open(width, probe, { vera_vn_career: JSON.stringify({ search: 'market' }) }));
    await tile('Search');
    check(L + ': the memory survives a reload', (await st()).cur === 'market');
    await page.close();
  }

  // HomeSlot with invented answers from a stubbed API
  const api = {
    coming_up: { cards: [{ title: 'Friend’s wedding', day: '2026-11-21', time: '4:00 PM', prep: [{ label: 'Gift' }] }, { title: 'Old dinner', day: '2026-11-01', after: true }] },
    life_growth: { today: '2026-11-03', goals: [{ id: 'G1', title: 'Spanish', focus: 'now', perWeek: 3, practice: { thisWeek: 1, practisedToday: false } }, { id: 'G2', title: 'Later', focus: 'waiting' }] },
    budget_actuals: { quarter: '2026-Q4', lines: { a: { plan: 500, actual: 420 }, b: { plan: 200, actual: 260 } } },
    get_important_dates: { dates: [{ Label: 'Sam’s Birthday', Person: 'Sam', daysUntil: 12, nextDate: '2026-11-15' }] },
    get_gift_data: { ideas: [{ person: 'Sam' }] },
  };
  for (const width of [390, 1280]) {
    const L = 'Home slot @' + width;
    const probe = 'var API=' + JSON.stringify(api) + ';var CALLS=[],POSTS=[],NAV=[];function apiGet(u,t,p){CALLS.push(p.action+(p.quarter?":"+p.quarter:""));return new Promise(function(r){setTimeout(function(){r(API[p.action]);},20);});}'
      + 'function apiPost(u,t,b){POSTS.push(b);return Promise.resolve({ok:true});}\n' + hsBlock
      + '\nReactDOM.createRoot(document.getElementById("root")).render(React.createElement(HomeSlot,{apiUrl:"x",apiToken:"y",onNavigate:function(t){NAV.push(t);}}));';
    let { page, errs } = await open(width, probe);
    await wait(200);
    const body = () => page.$eval('.hs-body', n => n.textContent);
    const opt = async t => { await page.locator('.hs-opt', { hasText: t }).click(); await wait(200); };
    check(L + ': four choices, Coming up first', (await page.$$eval('.hs-opt', ns => ns.map(n => n.textContent))).join('|') === '🗓️ Coming up|🌱 Practice|💰 Spending|🎂 Birthday');
    check(L + ': Coming up shows what is ahead, not what is past', /Friend’s wedding/.test(await body()) && /Gift/.test(await body()) && !/Old dinner/.test(await body()), await body());
    await opt('Practice');
    check(L + ': Practice shows the Now goals only', /Spanish/.test(await body()) && /1 of 3 this week/.test(await body()) && !/Later/.test(await body()), await body());
    await page.click('.hs-didit'); await wait(200);
    check(L + ': Did it logs practice for that goal', await page.evaluate(() => POSTS.length === 1 && POSTS[0].action === 'life_practice_log' && POSTS[0].goalId === 'G1'));
    await opt('Spending');
    check(L + ': Spending is this quarter per month against plan', /\$680 of \$700/.test(await body()) && /Under plan\$20/.test(await body()) && /1 of 2/.test(await body()), await body());
    check(L + ': it asks for this quarter', await page.evaluate(() => CALLS.some(c => /^budget_actuals:\d{4}-Q[1-4]$/.test(c))));
    await opt('Birthday');
    check(L + ': Birthday shows the next one with gift ideas', /Sam’s Birthday/.test(await body()) && /in 12 days/.test(await body()) && /Gift ideas saved1/.test(await body()), await body());
    await page.click('.hs-open'); await wait(50);
    check(L + ': Open → goes to People', await page.evaluate(() => NAV.join() === 'people'));
    check(L + ': the pick is remembered', await page.evaluate(() => localStorage.getItem('vera_home_slot')) === 'birthday');
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
    ({ page, errs } = await open(width, probe, { vera_home_slot: 'money' }));
    await wait(200);
    check(L + ': it reopens on the remembered card', /\$680 of \$700/.test(await body()) && (await page.$eval('.hs-opt.on', n => n.textContent)) === '💰 Spending');
    await page.close();
    ({ page, errs } = await open(width, probe, { vera_home_slot: 'bills' }));
    await wait(200);
    check(L + ': an unknown remembered card falls back to Coming up', (await page.$eval('.hs-opt.on', n => n.textContent)) === '🗓️ Coming up');
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
