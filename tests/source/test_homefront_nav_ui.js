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
check('the lite Home Front shows Household too', /\{sub === 'household' && \(\n        <HouseholdLiteTab apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>/.test(LITE));
check('Watch reads Neighborhood', APP.indexOf("{id:'neighborhood_watch',label:'🏘 Neighborhood'}") !== -1 && LITE.indexOf("{ id:'neighborhood_watch', label:'🏘 Neighborhood' }") !== -1);

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
        window.apiGet = (u, t, p) => Promise.resolve(p && p.action === 'get_household_info'
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
      if (process.env.SHOT_DIR) { const el = await page.$('#hfnprobe .hf-nav'); if (el) try { await el.screenshot({ path: process.env.SHOT_DIR + '/hfnav-' + L.replace(/\s+/g, '-') + '.png' }); } catch (e) {} }
      check(L + ': no page errors', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
