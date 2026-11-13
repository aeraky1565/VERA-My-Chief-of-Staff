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
check('Life replaces Growth and Explore in the top tabs', /\{id:'career',label:'Career'\},\{id:'life',label:'Life'\},\{id:'system',label:'System'\}\]/.test(APP) && !/\{id:'growth'|\{id:'explore'/.test(APP.slice(APP.indexOf('var VERA_MAIN_TABS='), APP.indexOf('var VERA_LITE_MAIN_TABS='))) && /tab==='life'\?`🌿 Life`/.test(APP) && !/tab==='growth'\?`🌱 Growth`/.test(APP) && !/tab==='explore'\?`🔭 Explore`/.test(APP));
check('anything still sending you to Growth or Explore lands on Life', /if\(activeTab==='growth'\|\|activeTab==='explore'\)setActiveTab\('life'\);/.test(APP));
check('Life is mounted with the ideas and their actions', /activeTab==='life'&&\/\*#__PURE__\*\/React\.createElement\(LifeTab,\{apiUrl:apiUrl,apiToken:apiToken,onNavigate:setActiveTab,initialSub:lifeDeepLink&&lifeDeepLink\.sub,onAddInterest:/.test(APP) && /action:'life_idea_to_goal',id:id/.test(APP) && /action:'life_idea_to_project',id:id/.test(APP));
check('?tab=life&sub=review opens Life on that subtab (the monthly review links to it)', /return q\.get\('tab'\)==='life'\?\{sub:q\.get\('sub'\)\|\|''\}:null;/.test(APP) && /useState\(careerDeepLink\?'career':lifeDeepLink\?'life':'home'\)/.test(APP) && /if\(props\.initialSub&&LF_SUBS\.some\(function\(x\)\{return x\.id===props\.initialSub;\}\)\)return props\.initialSub;/.test(APP));
check('Health no longer has Year in Review (it is Growth › Habits)', !/id:'year_in_review'/.test(APP) && /if\(sub==='habits'\)return h\(YearInReviewTab,/.test(APP));
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


const W = (start, count, met) => ({ start, count, met });
const GROWTH = { ok: true, today: '2026-11-04',
  goals: [
    { id: 'g1', title: 'Swim more', focus: 'now', rhythm: '3× a week', perWeek: 3, year: 2026, category: 'Health', description: '', milestones: [{ text: 'Swim 1k', done: true }, { text: 'Swim 2k', done: false }], habitId: 'HAB-1',
      practice: { weeks: [W('2026-09-14', 0, false), W('2026-09-21', 0, false), W('2026-09-28', 1, false), W('2026-10-05', 0, false), W('2026-10-12', 1, false), W('2026-10-19', 3, true), W('2026-10-26', 3, true), W('2026-11-02', 1, false)], thisWeek: 1, target: 3, lastDate: '2026-11-03', daysSince: 1, minutesYear: 90, streak: 2, practisedToday: false } },
    { id: 'g2', title: 'Spanish', focus: 'waiting', rhythm: '', perWeek: 0, year: 2026, category: 'Growth', description: 'For the trip', milestones: [], habitId: '', practice: { weeks: [], thisWeek: 0, lastDate: '', daysSince: null, minutesYear: 0, streak: 0 } },
    { id: 'g3', title: 'Read 12 books', focus: 'done', rhythm: '', perWeek: 0, year: 2026, category: '', description: '', milestones: [], habitId: '', practice: { weeks: [], thisWeek: 0 } }],
  carryOver: [{ id: 'g9', title: 'Learn to sail', year: 2025, toYear: 2026 }],
  didIt: [{ goalId: 'g1', goal: 'Swim more', day: '2026-11-03', event: 'Swim at the Y' }],
  learning: [{ id: 'B1', kind: 'book', title: 'Example Swim Book', by: 'A. Writer', status: 'In Progress', goalId: 'g1' }, { id: 'C1', kind: 'app', title: 'Example Lingo', by: 'App', status: 'In Progress', goalId: 'g2' }],
  trials: [{ id: 'T1', title: 'Swim before work', goalId: 'g1', goal: 'Swim more', start: '2026-10-01', end: '2026-10-28', state: 'ended', checkins: 6, status: 'Active' },
           { id: 'T2', title: 'Night reading', goalId: '', goal: '', start: '2026-11-01', end: '2026-11-21', state: 'active', checkins: 0, daysLeft: 17, status: 'Active' }] };
const REVIEW = { ok: true, today: '2026-11-04', rateMonth: '2026-10', rated: false, areas: ['health', 'relationships', 'career', 'money', 'growth', 'fun'],
  balance: [{ month: '2026-08', health: 2, relationships: 4, career: 3, money: 3, growth: 2, fun: 4 }, { month: '2026-09', health: 2, relationships: 5, career: 3, money: 4, growth: 3, fun: 4 }], low: ['health'],
  time: { month: '2026-10', freeHours: 196, buckets: [{ id: 'people', label: 'Friends & family', hours: 12 }, { id: 'trips', label: 'Trips', hours: 24 }, { id: 'home', label: 'Home & chores', hours: 6 }, { id: 'practice', label: 'Goal practice', hours: 4 }, { id: 'other', label: 'Other plans', hours: 10 }, { id: 'unplanned', label: 'Unplanned', hours: 140 }] } };

const CUP = { ok: true, today: '2026-11-04', days: 60, cards: [
  { id: 'e2', title: 'Dinner with Sam', day: '2026-11-06', time: '19:00', type: 'dinner', daysAway: 2, location: 'Example Bistro, Home City', after: false,
    dates: [{ label: 'Sam birthday', person: 'Sam Example', kind: 'birthday' }], clash: 'Overlaps Concert at 20:00',
    prep: [{ kind: 'gift', label: 'Plan a gift for Sam Example' }, { kind: 'rsvp', label: 'RSVP by Nov 3 please' }, { kind: 'leave_by', label: 'Leave-by time' }, { kind: 'bring', label: 'Bring something?' }] },
  { id: 'e1', title: 'Wedding of Example Pair', day: '2026-12-20', time: '15:00', type: 'wedding', daysAway: 46, location: 'Example Hall, Far Town, VA', after: false, dates: [], clash: '', prep: [{ kind: 'gift', label: 'Plan a gift' }, { kind: 'trip', label: 'Pencil in a trip' }] },
  { id: 'e7', title: 'Dinner at ours', day: '2026-11-01', time: '19:00', type: 'dinner', daysAway: -3, location: '', after: true, dates: [], clash: '', prep: [] }] };
async function mount(page, props) {
  await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LifeTab === 'function', null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(({ INTERESTS, GIVING, IDEAS, props, GROWTH, REVIEW, CUP }) => {
    window.__posts = []; window.__gets = []; window.__GROWTH = GROWTH; window.__nav = []; window.__REVIEW = REVIEW; window.__toGoal = []; window.__toProject = [];
    LF_INT_P = null;
    window.apiGet = (u, t, p) => { window.__gets.push(p.action);
      const r = { coming_up: CUP, coming_up_leave_by: { ok: true, minutes: 35, leaveBy: '18:15' }, life_growth: GROWTH, life_review: REVIEW, get_year_review: { ok: true, year: 2026, habits: [{ id: 'HAB-1', name: 'Swim more', cadence: '3× a week', color: '#8ab4f8', active: true }], completions: { 'HAB-1': { '2026-11-03': true } } }, life_interests: INTERESTS, life_giving: GIVING, life_tax_giving: { ok: true, year: 2025, count: 1, total: 40, items: [{ organisation: 'Example Library', amount: 40 }] } }[p.action];
      return r ? Promise.resolve(JSON.parse(JSON.stringify(r))) : (window.__life_get ? window.__life_get(p) : Promise.resolve({ ok: true })); };
    window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b)));
      if (b.action === 'life_place_to_trip_idea') return Promise.resolve({ ok: true, title: 'Old harbour walk' });
      if (b.action === 'life_quick_capture') return Promise.resolve({ ok: true, kind: 'idea', said: 'Added the idea “Sail club”.', undo: { action: 'delete_idea', id: 'IDEA-9', via: 'get' } });
      if (b.action === 'life_practice_log') return Promise.resolve({ ok: true, goal: 'Swim more', minutes: b.minutes || 0, added: true });
      if (b.action === 'life_trial_decide') return Promise.resolve({ ok: true, status: 'Kept' });
      if (b.action === 'life_trial_start') return Promise.resolve({ ok: true, end: '2026-12-01', weeks: 4 });
      return window.__life_post ? window.__life_post(b) : Promise.resolve({ ok: true, entry: b.entry }); };
    document.querySelectorAll('#lfprobe').forEach(n => n.remove());
    const host = document.createElement('div'); host.id = 'lfprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
    window.__lfRoot = ReactDOM.createRoot(host);
    window.__lfRoot.render(React.createElement(LifeTab, Object.assign({ apiUrl: 'https://vera.test/exec', apiToken: 't', ideas: IDEAS, busy: false,
      onToGoal: null, onNavigate: t => window.__nav.push(t), onIdeaToGoal: id => window.__toGoal.push(id), onIdeaToProject: id => window.__toProject.push(id), onAddIdea() {}, onPromoteIdea() {}, onArchiveIdea() {}, onShelveIdea() {} }, props || {})));
  }, { INTERESTS, GIVING, IDEAS, props, GROWTH, REVIEW, CUP });
  await wait(350);
}
const T = page => sel => page.$eval('#lfprobe ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
const clickOnce = (page, sel, text) => page.evaluate(({ sel, text }) => { const b = Array.from(document.querySelectorAll('#lfprobe ' + sel)).find(n => n.textContent.trim() === text); if (b) b.click(); return !!b; }, { sel, text });
// Life's subtabs sit in four groups (VeraTileNav): a chip not on show is reached through its group's tile.
const clickText = async (page, sel, text) => {
  if (await clickOnce(page, sel, text)) return true;
  if (!/subtab-btn/.test(sel)) return false;
  const hit = await page.evaluate(t => { const el = Array.from(document.querySelectorAll('#lfprobe .vn-tile')).find(n => (n.title || '').split(' · ').indexOf(t) !== -1); if (!el) return false; el.click(); return true; }, text);
  if (!hit) return false;
  await new Promise(r => setTimeout(r, 150));
  await clickOnce(page, sel, text);
  return true;
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of (ONLY ? [390] : [390, 1280])) {
    const L = 'Life ' + width;
    console.log('\nLife @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', d => d.accept());
    await page.evaluate(() => { try { localStorage.removeItem('vera_life_sub'); localStorage.removeItem('vera_vn_life'); } catch (e) {} }).catch(() => {});
    await mount(page);
    const txt = T(page);
    const groups = await page.$$eval('#lfprobe .vn-tile', ns => ns.map(n => n.textContent));
    check(L + ': four groups: Grow, Learn, Explore, Keep', JSON.stringify(groups) === JSON.stringify(['🌱Grow', '🧪Learn', '🔭Explore', '💡Keep']), JSON.stringify(groups));
    const gsubs = await page.$$eval('#lfprobe .vn-chips .subtab-btn', ns => ns.map(n => n.textContent));
    check(L + ': Grow’s subtabs, opening on Now', JSON.stringify(gsubs) === JSON.stringify(['Now', 'Goals', 'Habits']) && (await txt('.vn-chips .subtab-btn.active')) === 'Now', JSON.stringify(gsubs));
    const allSubs = await page.$$eval('#lfprobe .vn-tile', ns => ns.map(n => n.title));
    check(L + ': every subtab in a group of three', JSON.stringify(allSubs) === JSON.stringify(['Now · Goals · Habits', 'Learning · Trials · Review', 'Places · Trip lessons · Things we love', 'Ideas · Giving · Notes']), JSON.stringify(allSubs));



    if (part('quick')) {
      check(L + ': Quick capture sits at the top of Life', (await page.$('#lfprobe .life-tab > .qc')) !== null);
      check(L + ': File it waits for text', await page.$eval('#lfprobe .qc-file', n => n.disabled));
      await page.evaluate(() => { const n = document.querySelector('#lfprobe .qc-text'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, 'sail club idea'); n.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(50);
      await page.evaluate(() => document.querySelector('#lfprobe .qc-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))); await wait(250);
      let posts = await page.evaluate(() => window.__posts);
      check(L + ': Enter files it', posts[posts.length - 1].action === 'life_quick_capture' && posts[posts.length - 1].text === 'sail club idea');
      check(L + ': it says what it filed, and clears the box', /Added the idea “Sail club”\./.test(await txt('.qc-result')) && await page.$eval('#lfprobe .qc-text', n => n.value) === '');
      const getsBefore = (await page.evaluate(() => window.__gets)).length;
      await page.evaluate(() => { window.__undoGet = null; const g = window.apiGet; window.apiGet = (u, t, p) => { if (p.action === 'delete_idea') { window.__undoGet = p; return Promise.resolve({ ok: true }); } return g(u, t, p); }; });
      await page.evaluate(() => document.querySelector('#lfprobe .qc-undo').click()); await wait(250);
      check(L + ': Undo removes it the way that kind is removed', JSON.stringify(await page.evaluate(() => window.__undoGet)) === JSON.stringify({ action: 'delete_idea', id: 'IDEA-9' }) && /Undone\./.test(await txt('.qc-result')));
    }
    if (part('comingup')) {
      const cc = await page.$$eval('#lfprobe .cu-card', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': Coming up sits at the top of Life, a card per plan', cc.length === 3 && (await page.$('#lfprobe .life-tab > .cu-strip')) !== null, JSON.stringify(cc));
      check(L + ': when, how soon, where, the merged birthday, the clash', /^Fri, Nov 6 · 19:00 in 2 days 🍽️ Dinner with Sam 📍 Example Bistro, Home City 🎂 Sam birthday ⚠ Overlaps Concert at 20:00/.test(cc[0]), cc[0]);
      check(L + ': prep actions by type, RSVP as a note', /Plan a gift for Sam Example RSVP by Nov 3 please Leave-by time Bring something\?/.test(cc[0]) && (await page.$('#lfprobe .cu-rsvp')) !== null);
      await page.evaluate(() => document.querySelector('#lfprobe .cu-prep-leave_by').click()); await wait(250);
      check(L + ': Leave-by works out the time', /Leave by 18:15 \(35 min drive\)/.test(cc[0] + (await txt('.cu-msg'))));
      await page.evaluate(() => document.querySelector('#lfprobe .cu-prep-bring').click()); await wait(250);
      let posts = await page.evaluate(() => window.__posts);
      check(L + ': Bring something adds a task for the day before', posts[posts.length - 1].action === 'coming_up_bring' && posts[posts.length - 1].day === '2026-11-06');
      await page.evaluate(() => document.querySelector('#lfprobe .cu-prep-gift').click());
      await page.evaluate(() => document.querySelector('#lfprobe .cu-prep-trip').click()); await wait(100);
      check(L + ': a gift opens People, a trip opens Travel', JSON.stringify(await page.evaluate(() => window.__nav)) === JSON.stringify(['people', 'travel']));
      check(L + ': after the day it asks how it was', /^Sun, Nov 1 · 19:00 3 days ago 🍽️ Dinner at ours How was it\?/.test(cc[2]), cc[2]);
      check(L + ': saving waits for a word', await page.$eval('#lfprobe .cu-how-note', n => n.disabled));
      await page.evaluate(() => { const n = document.querySelector('#lfprobe .cu-how-text'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, 'The lamb was great'); n.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(50);
      await page.evaluate(() => document.querySelector('#lfprobe .cu-how-interest').click()); await wait(250);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': How was it? saves a favourite, and the card goes', posts[posts.length - 1].action === 'coming_up_debrief' && posts[posts.length - 1].kind === 'interest' && posts[posts.length - 1].text === 'The lamb was great' && (await page.$$('#lfprobe .cu-card')).length === 2);
      check(L + ': the strip scrolls inside itself', await page.$eval('#lfprobe .cu-row', n => getComputedStyle(n).overflowX === 'auto'));
    }
    if (part('explore')) {
      await clickText(page, '.vn-tile', '🔭Explore'); await wait(300);
      const esubs = await page.$$eval('#lfprobe .vn-chips .subtab-btn', ns => ns.map(n => n.textContent));
      check(L + ': Explore’s subtabs', JSON.stringify(esubs) === JSON.stringify(['Places', 'Trip lessons', 'Things we love']), JSON.stringify(esubs));
      check(L + ': the subtab is remembered', await page.evaluate(() => localStorage.getItem('vera_life_sub')) === 'places');
      let cards = await page.$$eval('#lfprobe .lf-int-card', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': Places lists places, a repeat shown once with its count', cards.length === 2 && /^Corner bakery Victoria · Food · 2026-04-01 the almond one ×2/.test(cards[0]), JSON.stringify(cards));
      check(L + ': a place can be planned as a trip or added to a weekend', /✈️ Plan a trip/.test(cards[0]) && /🗓 Add to a weekend/.test(cards[0]));
      await clickText(page, '.lf-person', 'Ahmed'); await wait(100);
      cards = await page.$$eval('#lfprobe .lf-int-card .lf-int-text', ns => ns.map(n => n.textContent));
      check(L + ': filtered by person', JSON.stringify(cards) === JSON.stringify(['Old harbour walk']), JSON.stringify(cards));
      await page.evaluate(() => { window.__posts = []; document.querySelector('#lfprobe .lf-to-trip').click(); }); await wait(250);
      let posts = await page.evaluate(() => window.__posts);
      check(L + ': Plan a trip sends the place to Trip Ideas', posts[0] && posts[0].action === 'life_place_to_trip_idea' && posts[0].id === 'I8');
      check(L + ': …and says where it went', /Added “Old harbour walk” to Travel › Trip Ideas\./.test(await txt('.lf-interests .lf-msg')));
      await page.evaluate(() => document.querySelector('#lfprobe .lf-to-weekend').click()); await wait(250);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': Add to a weekend', posts[1] && posts[1].action === 'life_add_to_weekend' && posts[1].id === 'I8');
      await clickText(page, '.lf-person', 'All'); await wait(100);
      await page.evaluate(() => { const s = document.querySelector('#lfprobe .lf-move'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'thing'); s.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(250);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': Move to… moves every copy', posts[2] && posts[2].action === 'life_interest_tag' && posts[2].tag === 'thing' && JSON.stringify(posts[2].ids) === JSON.stringify(['I2', 'I3']), JSON.stringify(posts[2]));
      await clickText(page, '.vn-chips .subtab-btn', 'Trip lessons'); await wait(250);
      check(L + ': Trip lessons are grouped by trip', (await txt('.lf-lesson-trip')) === 'EXAMPLE COAST TRIP' || (await txt('.lf-lesson-trip')) === 'Example Coast Trip', await txt('.lf-lesson-trip'));
      check(L + ': a lesson can’t be sent to a weekend', (await page.$('#lfprobe .lf-view-lessons .lf-to-weekend')) === null);
      await clickText(page, '.vn-chips .subtab-btn', 'Things we love'); await wait(250);
      check(L + ': Things we love', JSON.stringify(await page.$$eval('#lfprobe .lf-int-text', ns => ns.map(n => n.textContent))) === JSON.stringify(['Jazz nights']) && (await page.$('#lfprobe .lf-to-trip')) === null);
      await clickText(page, '.vn-chips .subtab-btn', 'Ideas'); await wait(200);
      await page.evaluate(() => document.querySelector('#lfprobe .idea-to-goal').click());
      await page.evaluate(() => document.querySelector('#lfprobe .idea-to-project').click());
      check(L + ': an idea can become a goal or a project', JSON.stringify(await page.evaluate(() => [window.__toGoal, window.__toProject])) === JSON.stringify([['IDEA-1'], ['IDEA-1']]));
      await clickText(page, '.vn-chips .subtab-btn', 'Giving'); await wait(250);
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

    if (part('growth')) {
      await clickText(page, '.vn-tile', '🌱Grow'); await wait(300);
      // Now
      const nc = await page.$$eval('#lfprobe .lf-now-card', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': Now shows only Now goals', nc.length === 1 && /^Swim more This week 1 of 3 · 3× a week/.test(nc[0]), JSON.stringify(nc));
      const strip = await page.$$eval('#lfprobe .lf-now-card .lf-week', ns => ns.map(n => n.className.replace('lf-week', '').trim() || '-'));
      check(L + ': the 8-week strip: met weeks, some, none', JSON.stringify(strip) === JSON.stringify(['-', '-', 'some', '-', 'some', 'met', 'met', 'some']), JSON.stringify(strip));
      check(L + ': streak, hours, last practised', /2-week streak · 1\.5 h this year · last practised 1 day ago/.test(nc[0]));
      check(L + ': its book and its trial are on the card', /📖 Book Example Swim Book · In Progress/.test(nc[0]) && !/Night reading/.test(nc[0]) && !/Example Lingo/.test(nc[0]));
      check(L + ': Did it? asks about yesterday’s event', /Did it\? “Swim at the Y” was on the calendar 2026-11-03 — practice for Swim more\?/.test(await txt('.lf-didit')));
      await page.evaluate(() => document.querySelector('#lfprobe .lf-didit-yes').click()); await wait(250);
      let posts = await page.evaluate(() => window.__posts);
      check(L + ': Yes logs it for that day', posts[posts.length - 1].action === 'life_did_it' && posts[posts.length - 1].yes === true && posts[posts.length - 1].day === '2026-11-03');
      await page.evaluate(() => document.querySelector('#lfprobe .lf-did-today').click()); await wait(250);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': Did it today logs today', posts[posts.length - 1].action === 'life_practice_log' && posts[posts.length - 1].goalId === 'g1' && posts[posts.length - 1].day === '2026-11-04');
      check(L + ': …and offers an undo', /Logged Swim more for today\./.test(await txt('.lf-now .lf-msg')) && (await page.$('#lfprobe .lf-undo')) !== null);
      await page.evaluate(() => document.querySelector('#lfprobe .lf-undo').click()); await wait(250);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': Undo removes that day’s log', posts[posts.length - 1].action === 'life_practice_undo' && posts[posts.length - 1].day === '2026-11-04');
      check(L + ': Log minutes waits for a number', await page.$eval('#lfprobe .lf-log-min', n => n.disabled));
      await page.evaluate(() => { const n = document.querySelector('#lfprobe .lf-min-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, '30m'); n.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(50);
      await page.evaluate(() => document.querySelector('#lfprobe .lf-log-min').click()); await wait(250);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': Log minutes sends just the number', posts[posts.length - 1].action === 'life_practice_log' && posts[posts.length - 1].minutes === 30, JSON.stringify(posts[posts.length - 1]));
      // Goals
      await clickText(page, '.vn-chips .subtab-btn', 'Goals'); await wait(250);
      const cols = await page.$$eval('#lfprobe .lf-goal-col-h', ns => ns.map(n => n.textContent));
      check(L + ': Goals grouped Now / Waiting / Done', JSON.stringify(cols) === JSON.stringify(['Now · 1', 'Waiting · 1', 'Done this year · 1']), JSON.stringify(cols));
      check(L + ': no % slider any more', (await page.$('#lfprobe .lf-goals input[type=range]')) === null);
      check(L + ': the year-end review offers last year’s', /Learn to sail \(2025\)/.test(await txt('.lf-carry')) && /Carry into 2026/.test(await txt('.lf-carry')));
      await page.evaluate(() => document.querySelector('#lfprobe .lf-carry-yes').click()); await wait(200);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': Carry over', posts[posts.length - 1].action === 'life_goal_carry' && posts[posts.length - 1].carry === true && posts[posts.length - 1].id === 'g9');
      await page.evaluate(() => document.querySelector('#lfprobe .lf-col-waiting .lf-start-now').click()); await wait(200);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': Start now moves a waiting goal to Now', posts[posts.length - 1].action === 'life_goal_save' && posts[posts.length - 1].goal.id === 'g2' && posts[posts.length - 1].goal.focus === 'now');
      await page.evaluate(() => document.querySelectorAll('#lfprobe .lf-col-now .lf-ms-check')[1].click()); await wait(200);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': ticking a milestone saves the list', JSON.stringify(posts[posts.length - 1].goal.milestones) === JSON.stringify([{ text: 'Swim 1k', done: true }, { text: 'Swim 2k', done: true }]), JSON.stringify(posts[posts.length - 1]));
      await page.evaluate(() => document.querySelector('#lfprobe .lf-goal-new').click()); await wait(100);
      const fillI = (sel, v) => page.evaluate(({ sel, v }) => { const n = document.querySelector('#lfprobe ' + sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); }, { sel, v });
      await fillI('.lf-goal-f-title', 'Run a 10k'); await fillI('.lf-goal-f-rhythm', '2× a week'); await wait(50);
      await page.evaluate(() => document.querySelector('#lfprobe .lf-goal-save').click()); await wait(200);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': + New goal with a rhythm', posts[posts.length - 1].action === 'life_goal_save' && posts[posts.length - 1].goal.title === 'Run a 10k' && posts[posts.length - 1].goal.rhythm === '2× a week' && !posts[posts.length - 1].goal.id);
      // Habits
      await clickText(page, '.vn-chips .subtab-btn', 'Habits'); await wait(400);
      check(L + ': Habits is the year grid from Health', (await page.evaluate(() => window.__gets)).includes('get_year_review'));
      // Learning
      await clickText(page, '.vn-chips .subtab-btn', 'Learning'); await wait(250);
      let lr = await page.$$eval('#lfprobe .lf-learn-row', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': learning, each tied to its goal', lr.length === 2 && /📖 Book Example Swim Book A\. Writer · In Progress · for Swim more/.test(lr[0]) && /for Spanish/.test(lr[1]), JSON.stringify(lr));
      await clickText(page, '.lf-learn-filter', 'Apps & classes'); await wait(100);
      lr = await page.$$eval('#lfprobe .lf-learn-row', ns => ns.map(n => n.innerText));
      check(L + ': filters: Apps & classes', lr.length === 1 && /Example Lingo/.test(lr[0]));
      await clickText(page, '.lf-learn-filter', 'Books'); await wait(100);
      check(L + ': filters: Books', (await page.$$('#lfprobe .lf-learn-row')).length === 1);
      // Trials
      await clickText(page, '.vn-chips .subtab-btn', 'Trials'); await wait(250);
      const tr = await page.$$eval('#lfprobe .lf-trial', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': an ended trial first, asking how it went', /^Swim before work Swim more · 2026-10-01 → 2026-10-28 Done: 6 check-ins\. How did it go\? Keep it Change it Drop it$/.test(tr[0]), JSON.stringify(tr));
      check(L + ': an active one shows days left', /Night reading/.test(tr[1]) && /17 days left/.test(tr[1]));
      await page.evaluate(() => document.querySelector('#lfprobe .lf-trial-keep').click()); await wait(200);
      posts = await page.evaluate(() => window.__posts);
      check(L + ': Keep it', posts[posts.length - 1].action === 'life_trial_decide' && posts[posts.length - 1].decision === 'keep' && posts[posts.length - 1].id === 'T1');
      // Review
      await clickText(page, '.vn-chips .subtab-btn', 'Review'); await wait(350);
      check(L + ': Life balance asks about last month', /How did 2026-10 feel\?/.test(await txt('.lf-rate')));
      check(L + ': Save waits for all six', await page.$eval('#lfprobe .lf-rate-save', n => n.disabled));
      await page.evaluate(() => document.querySelector('#lfprobe .lf-rate-health-4').click()); await wait(50);
      check(L + ': …still waiting with one rated', await page.$eval('#lfprobe .lf-rate-save', n => n.disabled));
      for (const k of ['health', 'relationships', 'career', 'money', 'growth', 'fun']) await page.evaluate(k => document.querySelector('#lfprobe .lf-rate-' + k + '-4').click(), k);
      await wait(50);
      await page.evaluate(() => document.querySelector('#lfprobe .lf-rate-save').click()); await wait(250);
      posts = await page.evaluate(() => window.__posts);
      const rp = posts[posts.length - 1];
      check(L + ': the month is saved', rp.action === 'life_balance_save' && rp.rating.month === '2026-10' && rp.rating.health === 4 && rp.rating.fun === 4, JSON.stringify(rp));
      check(L + ': the trend table', /Health 2 2/.test(await txt('.lf-balance-table')));
      check(L + ': a low area offers a goal', /Health has been low two months running\./.test(await txt('.lf-low')));
      const tb = await page.$$eval('#lfprobe .lf-time-row', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
      check(L + ': where the time went, by bucket', tb.length === 6 && tb[0] === 'Friends & family 12 h' && tb[5] === 'Unplanned 140 h', JSON.stringify(tb));
    }
    if (part('deeplink')) {
      await mount(page, { initialSub: 'giving' });
      check(L + ': a deep link opens its group and subtab', (await txt('.vn-tile.on')) === '💡 Keep' && (await txt('.vn-chips .subtab-btn.active')) === 'Giving' && (await page.$('#lfprobe .lf-giving')) !== null);
    }
    check(L + ': buttons big enough to tap', await page.$$eval('#lfprobe .vn-tile, #lfprobe .vn-chips .subtab-btn, #lfprobe .lf-to-trip, #lfprobe .lf-give-add, #lfprobe .lf-give-edit, #lfprobe .lf-did-today, #lfprobe .lf-start-now, #lfprobe .lf-trial-keep, #lfprobe .lf-rate-save, #lfprobe .cu-prep-gift', ns => ns.every(n => n.getBoundingClientRect().height >= 36)));
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
