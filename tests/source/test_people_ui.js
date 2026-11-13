// #218 in the browser, at 390 and 1280: System › Settings › People & access (the list,
// adding a person, the code shown once, a new code, sign out everywhere), and a hidden
// subtab leaving the shared menu. Invented people and codes.
const { chromium } = require('playwright');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of (process.env.VERA_CTL_FAST ? [390] : [390, 1280])   /* a control checks one width */) {
    const L = 'People ' + width;
    console.log('\nPeople @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof SystemTab === 'function', null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => {
      window.__posts = [];
      window.__people = [{ name: 'Sam', owner: true, view: 'full', codes: 0, lastSeen: new Date().toISOString(), visible: 74, total: 74 },
                         { name: 'Robin', owner: false, view: 'lite', codes: 1, lastSeen: '', visible: 31, total: 74 }];
      window.fetch = (url, opt) => {
        const u = new URL(url); let a = u.searchParams.get('action'), body = null;
        if (opt && opt.method === 'POST') { body = JSON.parse(opt.body); a = body.action; window.__posts.push(body); }
        let r = { ok: true };
        if (a === 'people_list') r = { ok: true, people: window.__people };
        if (a === 'people_add') { window.__people.push({ name: body.name, owner: false, view: body.view, codes: 1, lastSeen: '', visible: 74, total: 74 }); r = { ok: true, name: body.name, code: 'TEST-CODE-ABCD-EFGH' }; }
        if (a === 'people_code') r = { ok: true, name: body.name, code: 'NEXT-CODE-ABCD-EFGH' };
        if (a === 'people_signout') { window.__people.forEach(p => { if (p.name === body.name) p.codes = 0; }); r = { ok: true, signedOut: 1 }; }
        return Promise.resolve({ json: () => Promise.resolve(r) });
      };
      // Robin can't see Config: that chip leaves the System menu.
      VERA_ACCESS = { dash: 'full', hidden: { 'full:system/config': true } };
      const root = document.getElementById('root'); if (root) root.style.display = 'none';   // the app's own Settings dialog sits on top
      const host = document.createElement('div'); host.id = 'pp'; host.style.padding = '0 12px'; document.body.prepend(host);
      ReactDOM.createRoot(host).render(React.createElement(SystemTab, { apiUrl: 'https://vera.test/exec', apiToken: 't', resources: [], resourcesLoading: false,
        onAddResource() {}, onUpdateResource() {}, onDeleteResource() {}, busy: false, status: { rosterLinks: {}, features: {} }, sub: 'people' }));
    });
    await wait(400);
    const txt = sel => page.$eval('#pp ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    const tiles = await page.$$eval('#pp .vn-tile', ns => ns.map(n => n.title));
    check(L + ': a hidden subtab leaves the menu (Config), the rest stay', tiles.some(t => /People & access/.test(t)) && !tiles.some(t => /Config/.test(t)) && tiles.some(t => /Notifications/.test(t)), JSON.stringify(tiles));
    const people = await page.$$eval('#pp .pp-person', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ')));
    check(L + ': each person, the owner tagged, their view, codes and tab count', people.length === 2 && /Sam Owner Opens Full dashboard · 0 sign-in codes · last seen today/.test(people[0]) && /Robin Opens .*Lite dashboard.* · 1 sign-in code · last seen not yet/.test(people[1]) && /Sees 31 of 74 tabs/.test(people[1]), JSON.stringify(people));
    check(L + ': the owner has no "Sign out everywhere"; Robin does', !/Sign out everywhere/.test(people[0]) && /Sign out everywhere/.test(people[1]));
    await page.click('#pp button:has-text("Add a person")');
    await page.fill('#pp .pp-add input', 'Kit');
    await page.click('#pp button:has-text("Add and make a code")');
    await wait(300);
    check(L + ': adding a person shows their code once, with Copy and Done', (await txt('.pp-code')) === 'TEST-CODE-ABCD-EFGH' && /only time it's shown/.test(await txt('.pp-code-dialog')) && JSON.stringify((await page.evaluate(() => window.__posts)).slice(-1)[0]) === JSON.stringify({ action: 'people_add', name: 'Kit', view: 'lite' }));
    check(L + ': …and Kit is listed', (await page.$$('#pp .pp-person')).length === 3);
    await page.click('#pp .pp-code-dialog button:has-text("Done")'); await wait(100);
    check(L + ': Done closes the code for good', (await page.$('#pp .pp-code')) === null);
    await page.click('#pp .pp-person:nth-of-type(2) button:has-text("New sign-in code")'); await wait(300);
    check(L + ': a new code for Robin', (await txt('.pp-code')) === 'NEXT-CODE-ABCD-EFGH' && /Sign-in code for Robin/.test(await txt('.pp-code-dialog')));
    await page.click('#pp .pp-code-dialog button:has-text("Done")'); await wait(100);
    await page.click('#pp button:has-text("Sign out everywhere")'); await wait(300);
    const last = (await page.evaluate(() => window.__posts)).slice(-1)[0];
    check(L + ': sign out everywhere asks first, then signs Robin out', JSON.stringify(last) === JSON.stringify({ action: 'people_signout', name: 'Robin' }) && /0 sign-in codes/.test((await page.$$eval('#pp .pp-person', ns => ns[1].innerText.replace(/\s+/g, ' ')))));
    await page.selectOption('#pp select[aria-label="Kit\'s view"]', 'full'); await wait(200);
    check(L + ': the view switch', JSON.stringify((await page.evaluate(() => window.__posts)).slice(-1)[0]) === JSON.stringify({ action: 'people_view', name: 'Kit', view: 'full' }));
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(L + ': no sideways scroll', sw <= width, sw);
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
