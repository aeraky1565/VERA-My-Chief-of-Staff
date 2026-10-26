// Home Front's grouped navigation (HfNav, shared verbatim) in BOTH real pages, at
// phone and desktop width: it opens on Household, five groups sit above the chips of
// the group you are in, a group remembers the section you last opened in it, a
// section switched off by a feature flag is left out, and nothing scrolls sideways.
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
const START = '// ---- HfNav (Home Front groups) — SHARED VERBATIM', END = '// ---- /HfNav ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };

console.log('\nthe shared block');
check('both dashboards carry it, word for word', block(APP).length > 500 && block(APP) === block(LITE));
const C = vm.createContext({ React: { createElement: () => null, useState: v => [v, () => {}], useEffect: () => {} } });
vm.runInContext(block(APP), C);
C.tabs = [{ id: 'resell', label: 'R' }, { id: 'household', label: 'H' }, { id: 'meal_plan', label: 'M' }, { id: 'steward', label: 'W' }];
const gs = vm.runInContext('hfGroupsFor_(tabs)', C);
check('groups keep their order, sections in group order, empty groups hidden',
  gs.map(g => g.id + ':' + g.tabs.map(t => t.id).join('+')).join(' ') === 'house:household+steward kitchen:meal_plan savings:resell', JSON.stringify(gs));
check('every section belongs to one group, and an unknown one to none',
  vm.runInContext('hfGroupOf_("guests")', C) === 'hosting' && vm.runInContext('hfGroupOf_("nope")', C) === ''
  && vm.runInContext('HF_GROUPS.reduce(function(a,g){return a.concat(g.items);},[]).length', C) === vm.runInContext('Object.keys(HF_GROUPS.reduce(function(a,g){g.items.forEach(function(i){a[i]=1;});return a;},{})).length', C));
check('Household is first, and where Home Front opens (both dashboards)',
  /const allSubTabs=\[\{id:'household',label:'🏡 Household'\}/.test(APP) && /const\[sub,setSub\]=React\.useState\('household'\);/.test(APP)
  && /const ALL_SUBTABS = \[\n    \{ id:'household', label:'🏡 Household' \},/.test(LITE) && /React\.useState\('household'\);/.test(LITE));
check('the lite Home Front shows Household too, under Coming up', /\{sub === 'household' && \(\n        <>\n          <HfComingUp apiUrl=\{apiUrl\} apiToken=\{apiToken\} onPick=\{setSub\} \/>\n          <HouseholdLiteTab apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>/.test(LITE));
check('Watch reads Neighborhood', APP.indexOf("{id:'neighborhood_watch',label:'🏘 Neighborhood'}") !== -1 && LITE.indexOf("{ id:'neighborhood_watch', label:'🏘 Neighborhood' }") !== -1);

console.log('\nthe sitter & guest guide: the rules');
C.HH = { sections: [
  { section: 'Emergency', subsections: [{ subsection: '', rows: [{ label: 'Who to call first', value: 'Neighbor Dee 555-0100', notes: '' }] }] },
  { section: 'Wi-Fi & codes', subsections: [{ subsection: 'Network', rows: [{ label: 'Wi-Fi password', value: 'blue-heron-42', notes: '' }, { label: 'Alarm PIN', value: '91827', notes: 'disarm by the door' }, { label: 'Spare', value: '', notes: '' }] }] },
  { section: 'Utilities', subsections: [{ subsection: '', rows: [{ label: 'Provider', value: 'Example Power', notes: '' }, { label: 'Account number', value: '1234567890', notes: '' }] }] },
  { section: 'Insurance', subsections: [{ subsection: '', rows: [{ label: 'Home policy #', value: 'HP-55512', notes: '' }] }] }] };
C.names = C.HH.sections.map(x => x.section);
check('the sitter preset ticks everything but money and paperwork', JSON.stringify(vm.runInContext('hfGuidePreset_(names, "sitter")', C)) === '{"Emergency":true,"Wi-Fi & codes":true,"Utilities":true,"Insurance":false}');
check('the guests preset ticks only the practical bits', JSON.stringify(vm.runInContext('hfGuidePreset_(names, "guests")', C)) === '{"Emergency":true,"Wi-Fi & codes":true,"Utilities":false,"Insurance":false}');
check('numbers, policies, accounts, IDs and PINs count as sensitive, by whole word; a password or a provider does not',
  ['Account number', 'Home policy #', 'Alarm PIN', 'Member ID', 'VIN'].every(l => vm.runInContext('hfGuideSensitive_(' + JSON.stringify(l) + ')', C))
  && !['Wi-Fi password', 'Provider', 'Spinach'].some(l => vm.runInContext('hfGuideSensitive_(' + JSON.stringify(l) + ')', C)));
C.pk = { Emergency: true, 'Wi-Fi & codes': true, Utilities: true, Insurance: false };
const gd = vm.runInContext('hfGuideBuild_(HH, pk, { note: "  Back Sunday  " })', C);
check('the guide holds the sections picked, in order, without empty values', gd.sections.map(x => x.name).join() === 'Emergency,Wi-Fi & codes,Utilities' && gd.sections[1].subsections[0].rows.length === 2 && gd.note === 'Back Sunday', JSON.stringify(gd).slice(0, 300));
check('…numbers masked by default, passwords as written', gd.sections[1].subsections[0].rows[0].value === 'blue-heron-42' && gd.sections[1].subsections[0].rows[1].value === '••••1827' && gd.sections[2].subsections[0].rows[1].value === '••••7890' && gd.sections[2].subsections[0].rows[0].value === 'Example Power');
check('…and shown when switched on', vm.runInContext('hfGuideBuild_(HH, pk, { secrets: true })', C).sections[2].subsections[0].rows[1].value === '1234567890');
const txt = vm.runInContext('hfGuideText_(hfGuideBuild_(HH, pk, { note: "Back Sunday" }))', C);
check('as text: title, note, then each section with its rows', /^Our home: the guide\n\nBack Sunday\n\nEMERGENCY\n  Who to call first: Neighbor Dee 555-0100\n\nWI-FI & CODES\n  Network\n    Wi-Fi password: blue-heron-42\n    Alarm PIN: ••••1827 \(disarm by the door\)/.test(txt) && !/Insurance|HP-55512/i.test(txt), txt);
C.evil = { sections: [{ section: '<b>x</b>', subsections: [{ subsection: '', rows: [{ label: 'a', value: '<script>alert(1)</script>', notes: '' }] }] }] };
const html = vm.runInContext('hfGuideHtml_(hfGuideBuild_(evil, {"<b>x</b>": true}, {}))', C);
check('as a page: printable, and every value escaped', /<!doctype html>/.test(html) && /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(html) && !/<script>alert/.test(html) && /&lt;b&gt;x&lt;\/b&gt;/.test(html));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  for (const [label, kind] of [['full', 'full'], ['lite', 'lite']]) {
    for (const width of [390, 1280]) {
      const L = label + ' ' + width;
      console.log('\n' + label + ' dashboard @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
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
      await page.waitForFunction(() => typeof HfNav === 'function', null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(({ kind }) => {
        window.apiGet = (u, t, p) => p && p.action === 'homefront_coming_up' ? Promise.resolve({ ok: true, today: '2026-10-26', missing: [], items: [
          { kind: 'upkeep', section: 'chores', label: 'Replace HVAC filter', detail: 'Overdue since 2026-10-02', date: '2026-10-02', tone: 'overdue' },
          { kind: 'meal', section: 'meal_plan', label: 'Tacos', detail: 'Dinner tonight', date: '2026-10-26', tone: 'ok' }] }) : Promise.resolve(p && p.action === 'get_household_info'
          ? { ok: true, sections: [{ section: 'Utilities', subsections: [{ subsection: '', rows: [{ rowNum: 2, section: 'Utilities', subsection: '', label: 'Internet', value: 'Example ISP', notes: '' }] }] }] }
          : { ok: true, items: [], recipes: [], takeouts: [], chores: [], vehicles: [], weeks: [] });
        window.apiAction = () => Promise.resolve({ ok: true });
        document.querySelectorAll('#hfnprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'hfnprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        const Tab = kind === 'lite' ? HomeFrontLiteTab : HomeFrontTab;
        ReactDOM.createRoot(host).render(React.createElement(Tab, { apiUrl: 'https://vera.test/exec', apiToken: 't', features: { takeouts: false } }));
      }, { kind });
      await wait(500);
      const state = () => page.evaluate(() => {
        const host = document.getElementById('hfnprobe');
        return { groups: Array.from(host.querySelectorAll('.hf-group')).map(b => b.innerText.replace(/\s+/g, ' ').trim()),
          on: (host.querySelector('.hf-group.on') || {}).innerText || '',
          tabs: Array.from(host.querySelectorAll('.hf-tabs .subtab-btn')).map(b => b.textContent),
          active: (host.querySelector('.hf-tabs .subtab-btn.active') || {}).textContent || '', text: host.innerText };
      });
      const click = (sel, txt) => page.evaluate(({ sel, txt }) => { const b = Array.from(document.querySelectorAll('#hfnprobe ' + sel)).find(x => x.textContent.indexOf(txt) !== -1); if (b) b.click(); return !!b; }, { sel, txt });
      let s = await state();
      check(L + ': five groups', s.groups.map(g => g.replace(/^\S+\s/, '')).join() === 'House,Chores,Kitchen,Hosting,Savings', JSON.stringify(s.groups));
      check(L + ': it opens on Household, in House', /House/.test(s.on) && /Household/.test(s.active)
        && s.tabs.join('|') === '🏡 Household|🛡️ Warranties & Service|🚗 Vehicles|🏘 Neighborhood', JSON.stringify(s.tabs));
      check(L + ': …showing the household cheat sheet', /Example ISP/.test(s.text), s.text.slice(0, 300));
      const cuText = await page.$eval('#hfnprobe .hf-coming', n => n.innerText).catch(() => '');
      check(L + ': Coming up sits above the cheat sheet, overdue marked', /COMING UP ACROSS HOME FRONT/.test(cuText) && /Replace HVAC filter · Overdue since 2026-10-02[\s\S]*OVERDUE/.test(cuText) && /Tacos · Dinner tonight/.test(cuText), cuText);
      await page.evaluate(() => Array.from(document.querySelectorAll('#hfnprobe .hf-coming-item')).find(b => /Tacos/.test(b.innerText)).click()); await wait(200);
      check(L + ': tapping an item opens its section', /Kitchen/.test((await state()).on) && /Meal Plan/.test((await state()).active));
      await click('.hf-group', 'House'); await wait(150);
      await click('.hf-group', 'Kitchen'); await wait(150);
      s = await state();
      check(L + ': a group shows its own sections, the first one opened; a feature switched off is left out', /Kitchen/.test(s.on) && /Meal Plan/.test(s.active)
        && s.tabs.some(t => /Recipes/.test(t)) && s.tabs.some(t => /Pantry/.test(t)) && !s.tabs.some(t => /Takeouts/.test(t)), JSON.stringify(s.tabs));
      await click('.hf-tabs .subtab-btn', 'Recipes'); await wait(100);
      await click('.hf-group', 'House'); await wait(100);
      s = await state();
      check(L + ': back in House, Household again', /Household/.test(s.active));
      await click('.hf-group', 'Kitchen'); await wait(100);
      s = await state();
      check(L + ': and Kitchen remembers Recipes', /Recipes/.test(s.active), s.active);
      check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      // ---- Chores: routine chores above, upkeep by date below -------------------------------
      await page.evaluate(({ kind }) => {
        const CH = [
          { ID: 'ch_9', Chore: 'Dishes', Cadence: 'Daily', Checked: false },
          { ID: 'ch_1', Chore: 'Replace HVAC filter', Cadence: 'Quarterly', 'Last Done': '2026-07-02', upkeep: { status: 'overdue', next: '2026-10-02', last: '2026-07-02', days: -24, months: 3 } },
          { ID: 'ch_2', Chore: 'Clean the gutters', Cadence: 'Seasonal', 'Due By': '2026-11-30', upkeep: { status: 'ok', next: '2026-11-30', last: '', days: 35, months: 12 } },
          { ID: 'ch_3', Chore: 'Test smoke alarms', Cadence: 'Semiannually', upkeep: { status: 'unset', next: '', last: '', days: null, months: 6 } }];
        window.__calls = [];
        window.apiGet = (u, t, p) => { window.__calls.push(Object.assign({}, p));
          if (p.action === 'get_chores') return Promise.resolve({ ok: true, chores: CH });
          if (p.action === 'chore_upkeep_done') return Promise.resolve({ ok: true, chore: Object.assign({}, CH[1], { 'Last Done': '2026-10-26', upkeep: { status: 'ok', next: '2027-01-26', last: '2026-10-26', days: 92, months: 3 } }) });
          if (p.action === 'chore_upkeep_set') return Promise.resolve({ ok: true, chore: Object.assign({}, CH[3], { Cadence: p.cadence, 'Last Done': p.lastDone, upkeep: { status: 'ok', next: '2027-04-01', last: p.lastDone, days: 157, months: 6 } }) });
          if (p.action === 'chores_upkeep_starter') return Promise.resolve({ ok: true, added: 1, chores: [{ ID: 'ch_7', Chore: 'Check the sump pump', Cadence: 'Seasonal', 'Due By': '2027-03-01', upkeep: { status: 'ok', next: '2027-03-01', last: '', days: 126, months: 12 } }] });
          return Promise.resolve({ ok: true, items: [], recipes: [], takeouts: [], vehicles: [], weeks: [] }); };
        document.querySelectorAll('#hfnprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'hfnprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        if (kind === 'lite') {
          ReactDOM.createRoot(host).render(React.createElement(HomeFrontLiteTab, { apiUrl: 'https://vera.test/exec', apiToken: 't', features: {} }));
        } else {
          // The full dashboard keeps chores in App; this stands in for it.
          const Wrap = () => { const [c, setC] = React.useState(CH); return React.createElement(HomeFrontTab, { apiUrl: 'https://vera.test/exec', apiToken: 't', features: {}, chores: c,
            onMergeChores: cs => setC(p => hfMergeChores_(p, cs)), onToggleChore() {}, onAddChore() {}, onDeleteChore() {}, onUpdateChoreCadence() {} }); };
          ReactDOM.createRoot(host).render(React.createElement(Wrap));
        }
      }, { kind });
      await wait(300);
      await click('.hf-group', 'Chores'); await wait(300);
      const up = () => page.evaluate(() => { const u = document.querySelector('#hfnprobe .hf-upkeep'); const all = document.getElementById('hfnprobe').innerText;
        return { text: u ? u.innerText : '', rows: u ? Array.from(u.querySelectorAll('.hf-upkeep-row')).map(r => r.innerText.replace(/\s+/g, ' ')) : [],
          routine: u ? all.slice(0, all.indexOf(u.innerText.slice(0, 10))) : all }; });
      let u = await up();
      check(L + ': upkeep sits under the routine chores, which no longer list it', u.rows.length === 3 && /Dishes/.test(u.routine) && !/HVAC|gutters|smoke/i.test(u.routine), JSON.stringify(u.rows));
      check(L + ': overdue first, then not set, then the rest; each says how often, when, and last done', /^Replace HVAC filter Every 3 months · overdue since Oct 2(, 2026)? · last Jul 2/.test(u.rows[0]) && /^Test smoke alarms Every 6 months · not done yet/.test(u.rows[1]) && /^Clean the gutters Seasonal · next Nov 30/.test(u.rows[2]), JSON.stringify(u.rows));
      check(L + ': the "done today" count is routine chores only', /0\/1 chores done today/.test(u.routine), u.routine.slice(0, 300));
      check(L + ': the routine list offers only routine cadences', await page.evaluate(() => !/Quarterly|Annually|Seasonal/.test(document.getElementById('hfnprobe').innerText.split('UPKEEP')[0])));
      await page.evaluate(() => document.querySelector('#hfnprobe .hf-upkeep-row .hf-upkeep-done').click()); await wait(200);
      u = await up();
      check(L + ': ✓ Done logs it and the row moves on', (await page.evaluate(() => window.__calls.filter(c => c.action === 'chore_upkeep_done').pop() || {})).id === 'ch_1'
        && u.rows.some(r => /^Replace HVAC filter Every 3 months · next Jan 26, 2027 · last Oct 26/.test(r)) && !/overdue/.test(u.text), JSON.stringify(u.rows));
      await page.evaluate(() => Array.from(document.querySelectorAll('#hfnprobe .hf-upkeep-row')).find(r => /smoke/.test(r.innerText)).querySelector('.hf-upkeep-edit').click()); await wait(100);
      await page.evaluate(() => { const f = document.querySelector('#hfnprobe .hf-upkeep-form'); const set = (el, v) => { const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
        set(f.querySelector('select'), 'Semiannually'); set(f.querySelectorAll('input[type=date]')[1], '2026-10-01'); });
      await page.evaluate(() => document.querySelector('#hfnprobe .hf-upkeep-save').click()); await wait(200);
      const sc = await page.evaluate(() => window.__calls.filter(c => c.action === 'chore_upkeep_set').pop() || {});
      u = await up();
      check(L + ': Edit sends how often and the dates, and the row updates', sc.id === 'ch_3' && sc.cadence === 'Semiannually' && sc.lastDone === '2026-10-01' && sc.dueBy === ''
        && u.rows.some(r => /^Test smoke alarms Every 6 months · next Apr 1, 2027 · last Oct 1/.test(r)) && !(await page.$('#hfnprobe .hf-upkeep-form')), JSON.stringify(sc) + JSON.stringify(u.rows));
      await page.evaluate(() => document.querySelector('#hfnprobe .hf-upkeep-starter').click()); await wait(200);
      u = await up();
      check(L + ': + Add common upkeep adds the starter list', u.rows.some(r => /^Check the sump pump Seasonal/.test(r)) && u.rows.length === 4);
      check(L + ': no sideways scroll with upkeep', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      if (process.env.SHOT_DIR) { const el = await page.$('#hfnprobe .hf-upkeep'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/hfupkeep-' + L.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }

      // ---- Hosting › Gatherings --------------------------------------------------------------
      await page.evaluate(({ kind }) => {
        const T = { dinner: [{ text: 'Send invites', before: 21 }, { text: 'Plan the menu', before: 7 }, { text: 'Shop', before: 1 }, { text: 'Set the table', before: 0 }],
          birthday: [{ text: 'Send invites', before: 21 }, { text: 'Order the cake', before: 3 }, { text: 'Buy the gift', before: 2 }, { text: 'Decorations', before: 1 }] };
        const G = [
          { id: 'GATH-UP', title: 'Friendsgiving', type: 'holiday', date: '2099-11-21', start: '14:00', place: 'at home', guests: [{ name: 'Ann', status: 'coming', diet: '' }, { name: 'Bea', status: 'maybe', diet: '' }],
            menu: [], todos: [{ text: 'Send invites', before: 28, done: true }, { text: 'Shop', before: 2, done: false }], shopping: [] },
          { id: 'GATH-PAST', title: 'Lunch with the neighbors', type: 'lunch', date: '2020-10-04', guests: [{ name: 'Cal', status: 'coming', diet: '' }],
            menu: [{ dish: 'Quiche', who: 'Cal', recipe: '', note: '' }, { dish: 'Salad', who: '', recipe: '', note: '' }], todos: [], shopping: ['bread'] }];
        let n = 0; window.__posts = []; window.__gets = [];
        window.apiGet = (u, t, p) => { window.__gets.push(Object.assign({}, p));
          if (p.action === 'gatherings') return Promise.resolve({ ok: true, gatherings: JSON.parse(JSON.stringify(G)), templates: T });
          if (p.action === 'address_book') return Promise.resolve({ ok: true, people: [{ name: 'Dee' }, { name: 'Eve' }] });
          if (p.action === 'recipes') return Promise.resolve({ ok: true, recipes: [{ name: 'Herb roast chicken' }] });
          if (p.action === 'shopping') return Promise.resolve({ ok: true, stores: [{ tabId: 't.costco', storeName: 'Costco' }, { tabId: 't.giant', storeName: 'Giant' }] });
          return Promise.resolve({ ok: true, items: [], recipes: [], takeouts: [], chores: [], vehicles: [], weeks: [] }); };
        window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b)));
          if (b.action === 'gathering_save') { const g = Object.assign({}, b.gathering); if (!g.id) g.id = 'GATH-N' + (++n); return Promise.resolve({ ok: true, gathering: g }); }
          if (b.action === 'gathering_to_shopping') return Promise.resolve({ ok: true, added: b.items.length });
          return Promise.resolve({ ok: true }); };
        document.querySelectorAll('#hfnprobe').forEach(x => x.remove());
        const host = document.createElement('div'); host.id = 'hfnprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        ReactDOM.createRoot(host).render(React.createElement(kind === 'lite' ? HomeFrontLiteTab : HomeFrontTab, { apiUrl: 'https://vera.test/exec', apiToken: 't', features: {}, chores: [] }));
      }, { kind });
      await wait(300);
      await click('.hf-group', 'Hosting'); await wait(150);
      s = await state();
      check(L + ': Hosting holds Guests and Gatherings', s.tabs.some(t => /Guests/.test(t)) && s.tabs.some(t => /Gatherings/.test(t)), JSON.stringify(s.tabs));
      await click('.hf-tabs .subtab-btn', 'Gatherings'); await wait(250);
      const gt = () => page.$eval('#hfnprobe .hf-gatherings', n => n.innerText).catch(() => '');
      let g = await gt();
      check(L + ': coming up first, with progress and the next to-do; past below, offering to plan it again', /COMING UP[\s\S]*Friendsgiving[\s\S]*HOLIDAY[\s\S]*2 PM · at home · 1 coming, 1 maybe[\s\S]*1 of 2 to-dos done · next: Shop by/.test(g)
        && /PAST[\s\S]*Lunch with the neighbors[\s\S]*Plan it again/.test(g), g.slice(0, 500));
      const set = (sel, v) => page.evaluate(({ sel, v }) => { const el = document.querySelector('#hfnprobe ' + sel); const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, { sel, v });
      const q = sel => page.evaluate(sel => { const el = document.querySelector('#hfnprobe ' + sel); if (el) el.click(); return !!el; }, sel);
      await q('.hf-g-new-btn'); await wait(100);
      await set('.hf-g-new-title', 'Birthday dinner'); await set('.hf-g-new-type', 'birthday'); await set('.hf-g-new-date', '2099-11-14'); await wait(80);
      check(L + ': a new gathering starts with its kind\'s to-dos', /Starts with 4 to-dos for a birthday/.test(await gt()));
      await q('.hf-g-create'); await wait(200);
      let post = await page.evaluate(() => window.__posts.filter(p => p.action === 'gathering_save').pop());
      check(L + ': Create saves it with those to-dos and opens it', post && post.gathering.title === 'Birthday dinner' && post.gathering.type === 'birthday' && post.gathering.date === '2099-11-14'
        && post.gathering.todos.map(t => t.text).join() === 'Send invites,Order the cake,Buy the gift,Decorations' && /Birthday dinner/.test(await page.$eval('#hfnprobe .hf-g-title', n => n.innerText).catch(() => '')), JSON.stringify(post));
      const last = () => page.evaluate(() => window.__posts.filter(p => p.action === 'gathering_save').pop().gathering);
      await set('.hf-g-guest-new', 'Ann'); await q('.hf-g-guest-new-add'); await wait(120);
      await q('.hf-g-book-btn'); await wait(150);
      await set('.hf-g-book', 'Eve'); await wait(120);
      let lg = await last();
      check(L + ': guests are added by name or from the Address Book, invited to start', lg.guests.map(x => x.name + ':' + x.status).join() === 'Ann:invited,Eve:invited', JSON.stringify(lg.guests));
      await set('.hf-g-dish-new', 'Salad'); await q('.hf-g-dish-new-add'); await wait(120);
      await q('.hf-g-recipes-btn'); await wait(150); await set('.hf-g-recipes', 'Herb roast chicken'); await wait(120);
      lg = await last();
      check(L + ': dishes come typed or from Recipes', lg.menu.map(m => m.dish).join() === 'Salad,Herb roast chicken' && lg.menu[1].recipe === 'Herb roast chicken');
      const due = await page.$$eval('#hfnprobe .hf-g-todo .hf-g-due', ns => ns.map(n => n.innerText));
      check(L + ': each to-do shows its date, counted back from the day', due.join() === 'Oct 24, 2099,Nov 11, 2099,Nov 12, 2099,Nov 13, 2099', due.join());
      await page.evaluate(() => document.querySelectorAll('#hfnprobe .hf-g-todo input[type=checkbox]')[1].click()); await wait(120);
      lg = await last();
      check(L + ': ticking a to-do saves it done', lg.todos[1].done === true && lg.todos[0].done === false && /1 OF 4/.test(await gt()));
      await set('.hf-g-item-new', 'Candles'); await q('.hf-g-item-new-add'); await wait(120);
      await q('.hf-g-shop-btn'); await wait(150); await set('.hf-g-store', 't.giant'); await q('.hf-g-send'); await wait(150);
      const sp = await page.evaluate(() => window.__posts.filter(p => p.action === 'gathering_to_shopping').pop());
      check(L + ': Send to Shopping sends what to buy to the store picked, and says so', sp && sp.tabId === 't.giant' && sp.items.join() === 'Candles' && /✓ 1 sent to Giant/.test(await gt()), JSON.stringify(sp));
      check(L + ': no sideways scroll in a gathering', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      if (process.env.SHOT_DIR) { const el = await page.$('#hfnprobe .hf-gatherings'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/hfgathering-' + L.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
      await q('.hf-g-back'); await wait(120);
      await page.evaluate(() => Array.from(document.querySelectorAll('#hfnprobe .hf-g-card')).find(c => /neighbors/.test(c.innerText)).querySelector('.hf-g-again').click()); await wait(120);
      check(L + ': Plan it again says the menu comes along', /PLAN IT AGAIN · THE MENU COMES ALONG/.test(await gt()) && /and 2 dishes from last time/.test(await gt()));
      await q('.hf-g-create'); await wait(200);
      post = await page.evaluate(() => window.__posts.filter(p => p.action === 'gathering_save').pop());
      check(L + ': …and copies the menu only: who brings what cleared, no guests, no date, nothing to buy, fresh to-dos', post.gathering.title === 'Lunch with the neighbors' && post.gathering.menu.map(m => m.dish + '|' + m.who).join() === 'Quiche|,Salad|'
        && post.gathering.guests.length === 0 && post.gathering.date === '' && post.gathering.shopping.length === 0 && post.gathering.todos.length === 0, JSON.stringify(post.gathering));

      // ---- Hosting › Sitter & guest guide ------------------------------------------------------
      await page.evaluate(({ kind, HH }) => {
        window.apiGet = (u, t, p) => Promise.resolve(p.action === 'get_household_info' ? JSON.parse(JSON.stringify(HH)) : { ok: true, items: [], recipes: [], takeouts: [], chores: [], vehicles: [], weeks: [], gatherings: [], templates: {} });
        try { localStorage.removeItem('vera_guide_picks_v1'); } catch (e) {}
        window.__clip = null; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__clip = t; return Promise.resolve(); } } }); } catch (e) {}
        window.__printed = null; window.open = () => ({ document: { open() {}, write(x) { window.__printed = x; }, close() {} }, focus() {}, print() { window.__didPrint = true; } });
        document.querySelectorAll('#hfnprobe').forEach(x => x.remove());
        const host = document.createElement('div'); host.id = 'hfnprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
        ReactDOM.createRoot(host).render(React.createElement(kind === 'lite' ? HomeFrontLiteTab : HomeFrontTab, { apiUrl: 'https://vera.test/exec', apiToken: 't', features: {}, chores: [] }));
      }, { kind, HH: { sections: [
        { section: 'Emergency', subsections: [{ subsection: '', rows: [{ label: 'Who to call first', value: 'Neighbor Dee', notes: '' }] }] },
        { section: 'Wi-Fi & codes', subsections: [{ subsection: '', rows: [{ label: 'Wi-Fi password', value: 'blue-heron-42', notes: '' }, { label: 'Alarm PIN', value: '91827', notes: '' }] }] },
        { section: 'Utilities', subsections: [{ subsection: '', rows: [{ label: 'Account number', value: '1234567890', notes: '' }] }] },
        { section: 'Insurance', subsections: [{ subsection: '', rows: [{ label: 'Home policy #', value: 'HP-55512', notes: '' }] }] }] } });
      await wait(300);
      await click('.hf-group', 'Hosting'); await wait(120); await click('.hf-tabs .subtab-btn', 'guide'); await wait(250);
      check(L + ': the guide offers to make one from the cheat sheet', /4 sections to choose from/.test(await page.$eval('#hfnprobe .hf-guide', n => n.innerText).catch(() => '')));
      await page.evaluate(() => document.querySelector('#hfnprobe .hf-guide-make').click()); await wait(150);
      const boxes = () => page.$$eval('#hfnprobe .hf-guide-section', ls => ls.map(l => l.innerText.trim() + ':' + l.querySelector('input').checked).join());
      check(L + ': it opens on Sitter: everything but Insurance', (await boxes()) === 'Emergency:true,Wi-Fi & codes:true,Utilities:true,Insurance:false' && /3 of 4 sections · numbers hidden/.test(await page.$eval('#hfnprobe .hf-guide-summary', n => n.innerText)), await boxes());
      await page.evaluate(() => Array.from(document.querySelectorAll('#hfnprobe .hf-guide-preset')).find(b => b.innerText === 'Guests').click()); await wait(100);
      check(L + ': Guests ticks just the practical sections', (await boxes()) === 'Emergency:true,Wi-Fi & codes:true,Utilities:false,Insurance:false');
      await page.evaluate(() => Array.from(document.querySelectorAll('#hfnprobe .hf-guide-section')).find(l => /Emergency/.test(l.innerText)).querySelector('input').click()); await wait(100);
      check(L + ': unticking one makes it Custom', /Custom/.test(await page.$eval('#hfnprobe .hf-guide-preset[aria-pressed="true"]', n => n.innerText)) && (await boxes()) === 'Emergency:false,Wi-Fi & codes:true,Utilities:false,Insurance:false');
      await page.evaluate(() => document.querySelector('#hfnprobe .hf-guide-copy').click()); await wait(150);
      let clip = await page.evaluate(() => window.__clip);
      check(L + ': Copy text holds only what is ticked, with the PIN masked and the password as written', clip && /WI-FI & CODES/.test(clip) && /Wi-Fi password: blue-heron-42/.test(clip) && /Alarm PIN: ••••1827/.test(clip) && !/EMERGENCY|Neighbor Dee|1234567890|HP-55512/.test(clip), clip);
      await page.evaluate(() => document.querySelector('#hfnprobe .hf-guide-secrets').click()); await wait(80);
      await page.evaluate(() => document.querySelector('#hfnprobe .hf-guide-print').click()); await wait(400);
      const pr = await page.evaluate(() => ({ html: window.__printed, did: !!window.__didPrint }));
      check(L + ': Print / PDF opens the page and prints it; numbers shown once switched on', pr.did && /Alarm PIN<\/td><td>91827/.test(pr.html || ''), (pr.html || '').slice(0, 200));
      check(L + ': no sideways scroll with the dialog open', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      if (process.env.SHOT_DIR) { const el = await page.$('#hfnprobe .hf-guide-dialog'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/hfguide-' + L.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
      await page.evaluate(() => document.querySelector('#hfnprobe .hf-guide-close').click()); await wait(80);
      await page.evaluate(() => document.querySelector('#hfnprobe .hf-guide-make').click()); await wait(120);
      check(L + ': the picks are remembered for next time', (await boxes()) === 'Emergency:false,Wi-Fi & codes:true,Utilities:false,Insurance:false' && /numbers shown/.test(await page.$eval('#hfnprobe .hf-guide-summary', n => n.innerText)));

      if (process.env.SHOT_DIR) { const el = await page.$('#hfnprobe .hf-nav'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/hfnav-' + L.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
