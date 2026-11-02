// Life tab (issue #222) in the full dashboard at phone and desktop width, on invented data:
// the Growth | Explore switch and subtab rows, Places / Trip lessons / Things we love with
// their actions, Ideas → goal / project, Giving, lessons on trips, and no sideways scroll.
// Every name and value is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const ONLY = process.env.LIFE_ONLY || '';   // controls run one part
const part = p => !ONLY || ONLY === p;

console.log('\nthe wiring');
check('Life replaces Growth and Explore in the top tabs', /'career','life','system'\]\.map\(tab=>/.test(APP) && /tab==='life'\?`🌿 Life`/.test(APP) && !/tab==='growth'\?`🌱 Growth`/.test(APP) && !/tab==='explore'\?`🔭 Explore`/.test(APP));
check('anything still sending you to Growth or Explore lands on Life', /if\(activeTab==='growth'\|\|activeTab==='explore'\)setActiveTab\('life'\);/.test(APP));
check('Life is mounted with the ideas and their actions', /activeTab==='life'&&\/\*#__PURE__\*\/React\.createElement\(LifeTab,\{apiUrl:apiUrl,apiToken:apiToken,onAddInterest:/.test(APP) && /action:'life_idea_to_goal',id:id/.test(APP) && /action:'life_idea_to_project',id:id/.test(APP));
check('My Trips’ upcoming cards and the Trip Idea page show lessons', /t\.label\),\/\*#__PURE__\*\/React\.createElement\(LifeTripLessons,\{apiUrl:apiUrl,apiToken:apiToken,name:t\.label\}\)/.test(APP) && /renderLessons:function\(idea\)\{return React\.createElement\(LifeTripLessons,\{apiUrl:apiUrl,apiToken:apiToken,name:\[idea\.title,idea\.where\]\.join\(' '\)\}\)/.test(APP));
check('Finances › Tax is offered the year’s receipted donations', /React\.createElement\(LifeTaxGiving,\{apiUrl:apiUrl,apiToken:apiToken,year:year\}\)/.test(APP));

const INTERESTS = { ok: true, stop: ['trip', 'the', 'and', 'our', 'weekend', 'skip', 'to', 'in', 'of', 'a'],
  places: [{ id: 'I3', ids: ['I2', 'I3'], text: 'Corner bakery', person: 'Victoria', category: 'Food', lastDate: '2026-04-01', count: 2, notes: 'the almond one' },
           { id: 'I8', ids: ['I8'], text: 'Old harbour walk', person: 'Ahmed', category: 'Travel', lastDate: '2026-03-01', count: 1 }],
  things: [{ id: 'I5', ids: ['I5'], text: 'Jazz nights', person: 'Ahmed', category: 'Culture', lastDate: '2026-05-01', count: 1 }],
  lessonsByTrip: [{ trip: 'Example Coast Trip', items: [{ id: 'I1', ids: ['I1'], text: 'Seafood shack, Example Coast', person: 'Ahmed', category: 'Food', lastDate: '2026-06-11', count: 1, trip: 'Example Coast Trip' }] }],
  lessons: [{ id: 'I1', text: 'Seafood shack, Example Coast', person: 'Ahmed', trip: 'Example Coast Trip', words: ['example', 'coast', 'seafood', 'shack'] }] };
const GIVING = { ok: true, today: '2026-11-02', totals: [{ year: 2026, donated: 1350.5, hours: 4.5, donations: 2, volunteering: 2, withReceipt: 1, receiptTotal: 1250.5 }],
  entries: [{ id: 'G1', kind: 'donation', organisation: 'Example Food Bank', date: '2026-03-04', amount: 1250.5, hours: null, receipt: 'https://example.test/r', notes: '' },
            { id: 'G2', kind: 'volunteering', organisation: 'Example Park', date: '2026-05-01', amount: null, hours: 3, receipt: '', notes: 'trail day' }] };
const IDEAS = [{ id: 'IDEA-1', idea: 'Learn to sail', category: 'Growth', tags: '', notes: '', status: 'New', dateAdded: '2026-10-01' }];

async function mount(page, props) {
  await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LifeTab === 'function', null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(({ INTERESTS, GIVING, IDEAS, props }) => {
    window.__posts = []; window.__gets = []; window.__toGoal = []; window.__toProject = [];
    LF_INT_P = null;
    window.apiGet = (u, t, p) => { window.__gets.push(p.action);
      const r = { life_interests: INTERESTS, life_giving: GIVING, life_tax_giving: { ok: true, year: 2025, count: 1, total: 40, items: [{ organisation: 'Example Library', amount: 40 }] } }[p.action];
      return r ? Promise.resolve(JSON.parse(JSON.stringify(r))) : (window.__life_get ? window.__life_get(p) : Promise.resolve({ ok: true })); };
    window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b)));
      if (b.action === 'life_place_to_trip_idea') return Promise.resolve({ ok: true, title: 'Old harbour walk' });
      return window.__life_post ? window.__life_post(b) : Promise.resolve({ ok: true, entry: b.entry }); };
    document.querySelectorAll('#lfprobe').forEach(n => n.remove());
    const host = document.createElement('div'); host.id = 'lfprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
    window.__lfRoot = ReactDOM.createRoot(host);
    window.__lfRoot.render(React.createElement(LifeTab, Object.assign({ apiUrl: 'https://vera.test/exec', apiToken: 't', ideas: IDEAS, busy: false,
      onToGoal: null, onIdeaToGoal: id => window.__toGoal.push(id), onIdeaToProject: id => window.__toProject.push(id), onAddIdea() {}, onPromoteIdea() {}, onArchiveIdea() {}, onShelveIdea() {} }, props || {})));
  }, { INTERESTS, GIVING, IDEAS, props });
  await wait(350);
}
const T = page => sel => page.$eval('#lfprobe ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
const clickText = (page, sel, text) => page.evaluate(({ sel, text }) => { const b = Array.from(document.querySelectorAll('#lfprobe ' + sel)).find(n => n.textContent.trim() === text); if (b) b.click(); return !!b; }, { sel, text });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of (ONLY ? [390] : [390, 1280])) {
    const L = 'Life ' + width;
    console.log('\nLife @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', d => d.accept());
    await page.evaluate(() => { try { localStorage.removeItem('vera_life_group'); } catch (e) {} }).catch(() => {});
    await mount(page);
    const txt = T(page);
    const groups = await page.$$eval('#lfprobe .lf-group', ns => ns.map(n => n.textContent));
    check(L + ': Growth | Explore', JSON.stringify(groups) === JSON.stringify(['🌱 Growth', '🔭 Explore']), JSON.stringify(groups));
    const gsubs = await page.$$eval('#lfprobe .lf-subs .subtab-btn', ns => ns.map(n => n.textContent));
    check(L + ': Growth’s subtabs', JSON.stringify(gsubs) === JSON.stringify(['Now', 'Goals', 'Habits', 'Learning', 'Trials', 'Review']), JSON.stringify(gsubs));

    if (part('explore')) {
      await clickText(page, '.lf-group', '🔭 Explore'); await wait(300);
      const esubs = await page.$$eval('#lfprobe .lf-subs .subtab-btn', ns => ns.map(n => n.textContent));
      check(L + ': Explore’s subtabs', JSON.stringify(esubs) === JSON.stringify(['Places', 'Trip lessons', 'Things we love', 'Ideas', 'Giving', 'Notes']), JSON.stringify(esubs));
      check(L + ': the group is remembered', await page.evaluate(() => localStorage.getItem('vera_life_group')) === 'explore');
      let cards = await page.$$eval('#lfprobe .lf-int-card', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': Places lists places, a repeat shown once with its count', cards.length === 2 && /^Corner bakery Victoria · Food · 2026-04-01 the almond one ×2/.test(cards[0]), JSON.stringify(cards));
      check(L + ': a place can be planned as a trip or added to a weekend', /✈️ Plan a trip/.test(cards[0]) && /🗓 Add to a weekend/.test(cards[0]));
      await clickText(page, '.lf-person', 'Ahmed'); await wait(100);
      cards = await page.$$eval('#lfprobe .lf-int-card .lf-int-text', ns => ns.map(n => n.textContent));
      check(L + ': filtered by person', JSON.stringify(cards) === JSON.stringify(['Old harbour walk']), JSON.stringify(cards));
      await page.evaluate(() => document.querySelector('#lfprobe .lf-to-trip').click()); await wait(250);
      let posts = await page.evaluate(() => window.__posts);
      check(L + ': Plan a trip sends the place to Trip Ideas', posts[0] && posts[0].action === 'life_place_to_trip_idea' && posts[0].id === 'I8');
      check(L + ': …and says where it went', /Added “Old harbour walk” to Travel › Trip Ideas\./.test(await txt('.lf-msg')));
      await page.evaluate(() => document.querySelector('#lfprobe .lf-to-weekend').click()); await wait(250);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': Add to a weekend', posts[1] && posts[1].action === 'life_add_to_weekend' && posts[1].id === 'I8');
      await clickText(page, '.lf-person', 'All'); await wait(100);
      await page.evaluate(() => { const s = document.querySelector('#lfprobe .lf-move'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'thing'); s.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(250);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': Move to… moves every copy', posts[2] && posts[2].action === 'life_interest_tag' && posts[2].tag === 'thing' && JSON.stringify(posts[2].ids) === JSON.stringify(['I2', 'I3']), JSON.stringify(posts[2]));
      await clickText(page, '.lf-subs .subtab-btn', 'Trip lessons'); await wait(250);
      check(L + ': Trip lessons are grouped by trip', (await txt('.lf-lesson-trip')) === 'EXAMPLE COAST TRIP' || (await txt('.lf-lesson-trip')) === 'Example Coast Trip', await txt('.lf-lesson-trip'));
      check(L + ': a lesson can’t be sent to a weekend', (await page.$('#lfprobe .lf-view-lessons .lf-to-weekend')) === null);
      await clickText(page, '.lf-subs .subtab-btn', 'Things we love'); await wait(250);
      check(L + ': Things we love', JSON.stringify(await page.$$eval('#lfprobe .lf-int-text', ns => ns.map(n => n.textContent))) === JSON.stringify(['Jazz nights']) && (await page.$('#lfprobe .lf-to-trip')) === null);
      await clickText(page, '.lf-subs .subtab-btn', 'Ideas'); await wait(200);
      await page.evaluate(() => document.querySelector('#lfprobe .idea-to-goal').click());
      await page.evaluate(() => document.querySelector('#lfprobe .idea-to-project').click());
      check(L + ': an idea can become a goal or a project', JSON.stringify(await page.evaluate(() => [window.__toGoal, window.__toProject])) === JSON.stringify([['IDEA-1'], ['IDEA-1']]));
      await clickText(page, '.lf-subs .subtab-btn', 'Giving'); await wait(250);
      check(L + ': Giving shows the year’s totals', /^2026 \$1,350\.50 4\.5 hours volunteered · 1 with a receipt$/.test(await txt('.lf-give-year')), await txt('.lf-give-year'));
      const rows = await page.$$eval('#lfprobe .lf-give-row', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': each entry, money or hours', /Example Food Bank 2026-03-04 · \$1,250\.50 · receipt ✓/.test(rows[0]) && /Example Park 2026-05-01 · 3 h · trail day/.test(rows[1]), JSON.stringify(rows));
      await page.evaluate(() => document.querySelector('#lfprobe .lf-give-add').click()); await wait(100);
      check(L + ': a donation asks for an amount and a receipt', (await page.$('#lfprobe .lf-give-amount')) !== null && (await page.$('#lfprobe .lf-give-receipt')) !== null && (await page.$('#lfprobe .lf-give-hours')) === null);
      await page.evaluate(() => document.querySelector('#lfprobe .lf-give-volunteering').click()); await wait(80);
      check(L + ': volunteering asks for hours instead', (await page.$('#lfprobe .lf-give-hours')) !== null && (await page.$('#lfprobe .lf-give-amount')) === null && (await page.$('#lfprobe .lf-give-receipt')) === null);
      const fill = (sel, v) => page.evaluate(({ sel, v }) => { const n = document.querySelector('#lfprobe ' + sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); }, { sel, v });
      await fill('.lf-give-org', 'Example Shelter'); await fill('.lf-give-hours', '2'); await wait(50);
      await page.evaluate(() => document.querySelector('#lfprobe .lf-give-save').click()); await wait(250);
      posts = await page.evaluate(() => window.__posts);
      const last = posts[posts.length - 1];
      check(L + ': saving sends the entry', last.action === 'life_giving_save' && last.entry.kind === 'volunteering' && last.entry.organisation === 'Example Shelter' && last.entry.hours === '2', JSON.stringify(last));
      await page.evaluate(() => document.querySelector('#lfprobe .lf-give-del').click()); await wait(200);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': delete asks, then deletes', posts[posts.length - 1].action === 'life_giving_delete' && posts[posts.length - 1].id === 'G1');
      // lessons on a trip card
      await page.evaluate(() => { const host = document.createElement('div'); host.id = 'lfprobe2'; document.querySelector('#lfprobe').appendChild(host);
        ReactDOM.createRoot(host).render(React.createElement('div', null, React.createElement(LifeTripLessons, { apiUrl: 'u', apiToken: 't', name: 'Example Coast getaway 2027' }), React.createElement(LifeTripLessons, { apiUrl: 'u', apiToken: 't', name: 'Desert Lodge' }))); });
      await wait(250);
      const ls = await page.$$eval('#lfprobe2 .lf-trip-lessons', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': a trip to the same place shows last time’s lessons; another shows nothing', ls.length === 1 && /Seafood shack, Example Coast \(Example Coast Trip\)/.test(ls[0]), JSON.stringify(ls));
    }
    check(L + ': buttons big enough to tap', await page.$$eval('#lfprobe .lf-group, #lfprobe .lf-subs .subtab-btn, #lfprobe .lf-to-trip, #lfprobe .lf-give-add, #lfprobe .lf-give-edit', ns => ns.every(n => n.getBoundingClientRect().height >= 36)));
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
