// System tab (issue #222 stage 1) in the full dashboard at phone and desktop width, on invented
// data: the six subtabs, Documents with each one's "used by" line, API health counts and rows,
// the roster under Assistants, the 🔔 button opening System, and the retired settings window.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const fnBody = (src, name) => { const i = src.indexOf('function ' + name + '('); if (i === -1) return ''; const j = src.indexOf('\nfunction ', i + 10); return src.slice(i, j === -1 ? src.length : j); };

console.log('\nthe wiring');
check('the settings window is retired', !/NotifSettingsModal|setNotifSettingsOpen/.test(APP));
check('🔔 opens System on Notifications', /onClick:\(\)=>\{setSystemSub\('notifications'\);setActiveTab\('system'\);loadResources\(apiUrl,apiToken\);\}/.test(APP));
check('System is a top tab, and opening it loads the documents', /'life','system'\]\.map\(tab=>/.test(APP) && /if\(tab==='system'\)\{loadResources\(apiUrl,apiToken\);\}/.test(APP) && /tab==='system'\?`🛠 System`/.test(APP));
check('Documents load with their used-by lines', /apiGet\(url,token,\{action:'system_documents'\}\)/.test(APP));
check('Home no longer has the Feature Flags or Milestones cards', !/"⚙️ Feature Flags"/.test(fnBody(APP, 'HomeTab')) && !/onNavigate\('milestones'\)/.test(fnBody(APP, 'HomeTab')) && /"⚙️ Feature Flags"/.test(fnBody(APP, 'SysFeatureFlags')));
check('Home’s Projects card shows only with an active project', /if\(activeProjs\.length===0\)return null;/.test(fnBody(APP, 'HomeTab')));
check('the ⚙ connection settings stay', /className:"btn-settings",onClick:\(\)=>setShowSettings\(true\)/.test(APP));

const DOCS = { ok: true, resources: [
  { id: 'RES-1', name: 'Example Leave Policy', category: 'HR & Benefits', appliesTo: 'Ahmed', description: 'An invented policy', url: 'https://example.test/a', tags: '', usedBy: ['Family Planning: Ahmed’s leave policy', 'Chat: VERA can read it when you ask'] },
  { id: 'RES-2', name: 'Example Lease', category: 'Legal', appliesTo: 'Both', description: '', url: 'https://example.test/b', tags: '', usedBy: ['Chat: VERA can read it when you ask'] }] };
const HEALTH = { ok: true, counts: { ok: 1, slow: 1, failing: 1 }, sources: [
  { source: 'example-flights', status: 'failing', why: '3 failed calls in a row · HTTP 500' },
  { source: 'example-maps', status: 'slow', why: 'Rate limited 3h ago' },
  { source: 'example-weather', status: 'ok', why: '', lastSuccessAgo: '2h' }] };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of [390, 1280]) {
    const L = 'System ' + width;
    console.log('\nSystem @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    const clickTab0 = label => page.evaluate(async l => {
      const chip = () => Array.from(document.querySelectorAll('#sysprobe .vn-chips .subtab-btn')).find(n => n.textContent === l);
      if (!chip()) { const t = Array.from(document.querySelectorAll('#sysprobe .vn-tile')).find(n => (n.title || '').split(' · ').indexOf(l) !== -1); if (!t) return false; t.click(); await new Promise(r => setTimeout(r, 120)); }
      const c = chip(); if (c) c.click(); return !!c; }, label);
    await page.waitForFunction(() => typeof SystemTab === 'function', null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(({ DOCS, HEALTH }) => {
      window.__calls = [];
      window.fetch = url => { const a = new URL(url).searchParams.get('action'); window.__calls.push(a);
        const body = a === 'system_api_health' ? HEALTH : a === 'notification_map' ? { ok: true, map: [] } : { ok: true, rows: [], config: {} };
        return Promise.resolve({ json: () => Promise.resolve(body) }); };
      document.querySelectorAll('#sysprobe').forEach(n => n.remove());
      const host = document.createElement('div'); host.id = 'sysprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
      ReactDOM.createRoot(host).render(React.createElement(SystemTab, { apiUrl: 'https://vera.test/exec', apiToken: 't', resources: DOCS.resources, resourcesLoading: false,
        onAddResource() {}, onUpdateResource() {}, onDeleteResource() {}, busy: false, status: { rosterLinks: {}, features: { fitness: true, pantry: false, weekend_planner: true } } }));
    }, { DOCS, HEALTH });
    await wait(300);
    const txt = sel => page.$eval('#sysprobe ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    const tiles = await page.$$eval('#sysprobe .vn-tile', ns => ns.map(n => n.textContent + ': ' + n.title));
    check(L + ': three groups: Reference, Checks, Settings', JSON.stringify(tiles) === JSON.stringify(['📖Reference: 🤖 Assistants · 📚 Documents · 📘 Guides', '🧪Checks: 🧪 Test · 🩺 API health · 🤖 Agent health', '⚙️Settings: 🔔 Notifications · ✉️ Trip emails · ⚙️ Config · 🚩 Feature Flags']), JSON.stringify(tiles));
    check(L + ': opens on Assistants, in Reference', (await txt('.vn-chips .subtab-btn.active')) === '🤖 Assistants' && (await txt('.vn-tile.on')) === '📖 Reference');
    await clickTab0('📚 Documents'); await wait(150);
    const used = await page.$$eval('#sysprobe .sys-used-by', ns => ns.map(n => n.textContent));
    check(L + ': each document says what uses it', used.length === 2 && used[0] === 'Used by: Family Planning: Ahmed’s leave policy · Chat: VERA can read it when you ask' && used[1] === 'Used by: Chat: VERA can read it when you ask', JSON.stringify(used));
    const clickTab = clickTab0;
    await clickTab('🩺 API health'); await wait(300);
    check(L + ': API health asks the server', (await page.evaluate(() => window.__calls)).includes('system_api_health'));
    check(L + ': OK / slow / failing counts', (await txt('.sys-health-counts')) === 'OK 1 SLOW 1 FAILING 1' || (await txt('.sys-health-counts')) === 'OK 1 Slow 1 Failing 1', await txt('.sys-health-counts'));
    const rows = await page.$$eval('#sysprobe .sys-health-row', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
    check(L + ': a row per source, worst first, with why', rows.length === 3 && /^Failing example-flights 3 failed calls in a row · HTTP 500$/.test(rows[0]) && /^Slow example-maps Rate limited 3h ago$/.test(rows[1]) && /^OK example-weather Last good call 2h ago$/.test(rows[2]), JSON.stringify(rows));
    await clickTab('🤖 Assistants'); await wait(200);
    check(L + ': Assistants shows the roster', /VERA/.test(await txt('')) && /TESS/.test(await txt('')));
    await clickTab('🚩 Feature Flags'); await wait(200);
    const flags = await txt('.sys-flags');
    check(L + ': Feature Flags shows tabs and features, on and off', /Feature Flags/i.test(flags) && /Tabs/i.test(flags) && /📦 Pantry/.test(flags) && /📅 Weekend Planner/.test(flags), flags.slice(0, 120));
    await clickTab('🧪 Test'); await wait(200);
    check(L + ': Test mounts the test emails panel', (await page.$('#sysprobe .test-emails')) !== null);
    check(L + ': buttons big enough to tap', await page.$$eval('#sysprobe .vn-tile, #sysprobe .vn-chips .subtab-btn', ns => ns.every(n => n.getBoundingClientRect().height >= 36)));
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
