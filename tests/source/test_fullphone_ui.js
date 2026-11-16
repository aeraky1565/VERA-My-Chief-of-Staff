// The full dashboard on a phone (option B of the layouts mockup): seven buttons at the bottom
// (Home · Flags · Tasks · Chat · Travel · Money · All), no top row of tabs or status strip, an All
// screen of every tab in groups, and a greeting. On a computer: the top row as before, no bar.
// The whole app runs in a browser over an in-page fake of its routes. Invented data.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const IDX = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const wait = ms => new Promise(r => setTimeout(r, ms));

const REPLIES = (hidden) => ({
  whoami: { ok: true, name: 'Ahmed', owner: true, view: 'full', hidden: hidden || [] },
  status: { ok: true, activeFlags: 3, high: 1, medium: 1, low: 1, totalFlags: 40 },
  flags: { ok: true, flags: [{ id: 'F1', flag: 'Renew passport', urgency: 'High' }, { id: 'F2', flag: 'Insurance card', urgency: 'Medium' }, { id: 'F3', flag: 'Low thing', urgency: 'Low' }] },
  tasks: { ok: true, tasks: [{ id: 'T1', task: 'Call the plumber', isOverdue: true, dueDate: '2020-01-01' }, { id: 'T2', task: 'Water plants', isOverdue: true, dueDate: '2020-01-02' }, { id: 'T3', task: 'Later', dueDate: '2099-01-01' }] },
  summaries: { ok: true }, get_todays_events: { ok: true, calendarFound: true, events: [] },
});

async function openApp(browser, viewport, hidden) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  const R = REPLIES(hidden);
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.indexOf('/exec') !== -1) { const a = new URL(u).searchParams.get('action'); return route.fulfill({ contentType: 'application/json', body: J(R[a] || { ok: true }) }); }
    if (u.startsWith('https://vera.test/')) return route.fulfill({ contentType: 'text/html', body: IDX });
    return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
  });
  await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 'OWNER'); localStorage.setItem('vera_install_tip_done', '1'); });
  await page.goto('https://vera.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.fh-home', { timeout: 15000 }).catch(() => {});
  await wait(700);
  return { ctx, page, errors };
}
const visible = (page, sel) => page.$eval(sel, n => { const s = getComputedStyle(n); return s.display !== 'none' && s.visibility !== 'hidden' && n.getBoundingClientRect().height > 0; }).catch(() => false);

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  console.log('\nPixel 9 Pro XL (412 × 915)');
  {
    const { ctx, page, errors } = await openApp(browser, { width: 412, height: 915 });
    check('the bottom bar shows, the top tabs and status strip don’t', await visible(page, '.full-bar') && !(await visible(page, '.tabs')) && !(await visible(page, '.status-bar')));
    const btns = await page.$$eval('.full-bar-btn', ns => ns.map(n => n.dataset.bar));
    check('seven buttons: Home, Flags, Tasks, Chat, Travel, Money, All', J(btns) === J(['home', 'flags', 'tasks', 'chat', 'travel', 'finances', 'all']), J(btns));
    check('Home is on, Chat is the raised one', (await page.$eval('.full-bar-btn.on', n => n.dataset.bar)) === 'home' && (await page.$eval('.full-bar-btn.center', n => n.dataset.bar)) === 'chat');
    const badges = await page.$$eval('.full-bar-btn', ns => ns.map(n => [n.dataset.bar, (n.querySelector('.full-bar-n') || {}).textContent || '']));
    check('badges: open flags on Flags, overdue on Tasks', J(badges.filter(b => b[1])) === J([['flags', '3'], ['tasks', '2']]), J(badges));
    check('the greeting, with the name and initial', await visible(page, '.fh-hello') && /Good (morning|afternoon|evening), Ahmed/.test(await page.$eval('.fh-hello', n => n.innerText)) && (await page.$eval('.fh-av', n => n.textContent)) === 'A');
    const bar = await page.$eval('.full-bar', n => n.getBoundingClientRect().top);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await wait(200);
    const last = await page.$eval('.fh-grid > :last-child', n => n.getBoundingClientRect().bottom);
    check('nothing ends up hidden under the bar', last <= bar + 1, J([last, bar]));
    check('no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    if (process.env.FP_SHOT) { await page.evaluate(() => window.scrollTo(0, 0)); await wait(100); await page.screenshot({ path: process.env.FP_SHOT + 'home.png', fullPage: true }); }
    await page.click('.full-bar-btn[data-bar="flags"]'); await wait(300);
    check('Flags opens the Flags tab', (await page.$eval('.full-bar-btn.on', n => n.dataset.bar)) === 'flags' && !(await page.$('.fh-home')));
    await page.click('.full-bar-btn[data-bar="all"]'); await wait(300);
    const groups = await page.$$eval('.full-all-g .fh-sect', ns => ns.map(n => n.textContent));
    check('All: every tab in its group', J(groups) === J(['Today', 'Money', 'Home', 'People & health', 'Life & career', 'System']), J(groups));
    const apps = await page.$$eval('.full-app', ns => ns.map(n => n.dataset.tab));
    check('…all fifteen tabs', apps.length === 15 && ['home', 'chat', 'flags', 'tasks', 'finances', 'pto', 'shopping', 'home_front', 'projects', 'travel', 'people', 'health', 'life', 'career', 'system'].every(t => apps.includes(t)), J(apps));
    if (process.env.FP_SHOT) await page.screenshot({ path: process.env.FP_SHOT + 'all.png' });
    await page.click('.full-app[data-tab="pto"]'); await wait(300);
    check('…and a tap opens it (PTO)', !(await page.$('.full-all')) && (await page.evaluate(() => document.body.innerText)).length > 0 && !(await page.$('.full-bar-btn.on')));
    await page.click('.full-bar-btn[data-bar="home"]'); await wait(300);
    check('Home brings the Home page back', !!(await page.$('.fh-home')));
    check('no page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }

  console.log('\na hidden tab has no button and isn’t in All');
  {
    const { ctx, page } = await openApp(browser, { width: 412, height: 915 }, ['full:finances', 'full:career']);
    const btns = await page.$$eval('.full-bar-btn', ns => ns.map(n => n.dataset.bar));
    check('no Money button when Finances is hidden', !btns.includes('finances') && btns.length === 6, J(btns));
    await page.click('.full-bar-btn[data-bar="all"]'); await wait(300);
    const apps = await page.$$eval('.full-app', ns => ns.map(n => n.dataset.tab));
    check('…nor Finances or Career in All', !apps.includes('finances') && !apps.includes('career') && apps.length === 13, J(apps));
    await ctx.close();
  }

  console.log('\na computer (1280)');
  {
    const { ctx, page, errors } = await openApp(browser, { width: 1280, height: 900 });
    check('the top tabs and status strip, no bottom bar', await visible(page, '.tabs') && await visible(page, '.status-bar') && !(await visible(page, '.full-bar')));
    check('no phone greeting', !(await visible(page, '.fh-hello')));
    check('no page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + e.message); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
