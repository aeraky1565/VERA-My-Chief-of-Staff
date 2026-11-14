// System › Checks › Script Properties in the browser, at 390 and 1280: the counts and
// pill, each group with its notes, Move settings now, Remove the old copies (asks
// first, only shown when there is one), and a page that shows names only. Invented names.
const { chromium } = require('playwright');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const LIST = { ok: true, total: 9, limit: 50,
  counts: { settings: 1, old: 2, needed: 2, secret: 2, records: 1, other: 1 },
  groups: {
    settings: [{ name: 'VERA_DASHBOARD_URL', note: 'Config holds a different value, and Config is the one VERA uses. Remove this property in the editor once Config is right' }],
    old: [{ name: 'TP_MIGRATED', note: 'Already copied to its new home; safe to remove', removable: true }, { name: 'PACING_MODE_ENDS', note: 'Not copied yet: “Move settings now” moves it', removable: false }],
    needed: [{ name: 'SLACK_ALLOWED_USER_IDS', note: '' }, { name: 'VERA_SHEET_ID', note: '' }],
    secret: [{ name: 'A_VERY_LONG_INVENTED_SERVICE_NAME_FOR_THE_WEATHER_API_KEY', note: '' }, { name: 'SLACK_SIGNING_SECRET', note: 'Still a setup placeholder: paste the real value in the Apps Script editor' }],
    records: [{ name: 'VERA_ONCE_MARKERS', note: '' }], other: [{ name: 'LAST_NIGHTLY_RUN', note: '' }],
  } };
const CLEAN = { ok: true, total: 6, limit: 50, counts: { settings: 0, old: 0, needed: 2, secret: 2, records: 1, other: 1 },
  groups: { settings: [], old: [], needed: LIST.groups.needed, secret: [{ name: 'CLAUDE_API_KEY', note: '' }, { name: 'SLACK_BOT_TOKEN', note: '' }], records: LIST.groups.records, other: LIST.groups.other } };

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of (process.env.VERA_CTL_FAST ? [390] : [390, 1280])   /* a control checks one width */) {
    const L = '@' + width;
    console.log('\nScript Properties ' + L);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof SystemTab === 'function', null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(([list, clean]) => {
      window.__posts = []; window.__list = list; window.__clean = clean;
      window.fetch = (url, opt) => {
        const u = new URL(url); let a = u.searchParams.get('action'), body = null;
        if (opt && opt.method === 'POST') { body = JSON.parse(opt.body); a = body.action; window.__posts.push(body); }
        let r = { ok: true };
        if (a === 'script_props') r = window.__list;
        if (a === 'settings_move') r = { ok: true, moved: ['SAT_SHEET_ID', 'SLACK_VICTORIA_USER_ID'], same: ['SLACK_LOGS_CHANNEL_ID'], kept: ['VERA_DASHBOARD_URL'], markers: 0, state: [], stores: [], placeholders: ['slack_ahmed_user_id'], missing: [] };
        if (a === 'script_props_clean') { r = { ok: true, removed: ['TP_MIGRATED'], left: ['PACING_MODE_ENDS'] }; window.__list = window.__clean; }
        return Promise.resolve({ json: () => Promise.resolve(r) });
      };
      VERA_ACCESS = null;
      const root = document.getElementById('root'); if (root) root.style.display = 'none';
      const host = document.createElement('div'); host.id = 'sp'; host.style.padding = '0 12px'; document.body.prepend(host);
      ReactDOM.createRoot(host).render(React.createElement(SystemTab, { apiUrl: 'https://vera.test/exec', apiToken: 't', resources: [], resourcesLoading: false,
        onAddResource() {}, onUpdateResource() {}, onDeleteResource() {}, busy: false, status: { rosterLinks: {}, features: {} }, sub: 'script_props' }));
    }, [LIST, CLEAN]);
    await wait(400);
    const txt = sel => page.$eval('#sp ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    check(L + ': the count, against the editor’s 50, and the breakdown', /^9 properties of the editor’s 50 1 setting not moved · 2 old copies · 2 needed before Config · 2 secrets · 1 record · 1 running note/.test(await txt('.sp-summary')), await txt('.sp-summary'));
    check(L + ': …and what needs a look (1 setting, 2 old copies, 1 placeholder secret)', (await txt('.sp-pill')) === '4 things to look at', await txt('.sp-pill'));
    const groups = await page.$$eval('#sp .sp-group', ns => ns.map(n => ({ open: n.open, t: n.querySelector('summary').innerText })));
    check(L + ': the groups, in order: what needs a look first', JSON.stringify(groups.map(g => g.t.replace(/\s*\(\d+\)/, ''))) === JSON.stringify(['Settings not moved yet', 'Old copies', 'Needed before Config', 'Secrets', 'VERA’s records', 'VERA’s running notes']), JSON.stringify(groups));
    check(L + ': open where there’s something to read; closed where there isn’t', groups[0].open && groups[1].open && groups[3].open && !groups[2].open && !groups[4].open && !groups[5].open, JSON.stringify(groups));
    check(L + ': each name with why it’s there', /VERA_DASHBOARD_URL Config holds a different value/.test(await txt('.sp-group:nth-of-type(1)')) && /SLACK_SIGNING_SECRET Still a setup placeholder/.test(await txt('.sp-group:nth-of-type(4)')));
    check(L + ': names only: no value is on the page', !/https?:|xox|sk-|U0[A-Z0-9]/.test(await page.$eval('#sp', n => n.innerText)));
    await page.click('#sp .sp-move'); await wait(300);
    check(L + ': Move settings now runs the move and says what happened', (await page.evaluate(() => window.__posts)).slice(-1)[0].action === 'settings_move'
          && /^Moved 2, removed 1 already in Config, left 1 where Config differs\. Still placeholders: slack_ahmed_user_id\.$/.test(await txt('.sp-said')), await txt('.sp-said'));
    check(L + ': Remove the old copies counts only the ones that can go', (await txt('.sp-clean')) === 'Remove the old copies (1)');
    await page.click('#sp .sp-clean'); await wait(300);
    check(L + ': …asks first, then removes them and reads again', /Remove 1 old copy\? Each one is checked/.test(dialogs.slice(-1)[0] || '') && (await page.evaluate(() => window.__posts)).slice(-1)[0].action === 'script_props_clean'
          && /Removed 1 old copy; 1 not copied yet, so kept\./.test(await txt('.sp-said')), dialogs.join(' | '));
    check(L + ': all in place: a green pill, no remove button', (await txt('.sp-pill')) === 'All in place' && (await page.$('#sp .sp-clean')) === null);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(L + ': no sideways scroll, even with a long name', sw <= width, sw);
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + e.message); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
