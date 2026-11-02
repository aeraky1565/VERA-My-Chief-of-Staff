// Career › Credentials (CarCredentials, issue #223) in the full dashboard at phone and desktop
// width, on invented credentials: the totals, the job agent's line and when it was sent, the
// badges, the credits bar and pace, logging credits and renewing, the edit screen's renewal modes,
// the agent switch, and no sideways scroll. Every name and value is invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
console.log('\nthe wiring');
check('Credentials is a Career subtab after Evidence, with a deep link', APP.indexOf("{id:'evidence',label:'📎 Evidence'},{id:'credentials',label:'🎓 Credentials'}") !== -1
  && /sub==='credentials'&&carH\(CarCredentials,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP) && /var CAR_SUBS=\[[^\]]*'credentials'/.test(APP));

const st = (status, label, daysLeft) => ({ status, label, daysLeft });
const PAYLOAD = { ok: true, today: '2026-11-02', agentConnected: true,
  line: 'Bachelor of Engineering (2010); MBA in Finance (2016); Example PM Pro; Cloud Architect Cert (2024); Old Scrum Cert (expired 2025)',
  lastSent: { at: '2026-11-01T10:00:00Z', line: 'Bachelor of Engineering (2010); MBA in Finance (2016); Example PM Pro; Cloud Architect Cert (2024); Old Scrum Cert (expired 2025)' },
  totals: { active: 2, soon: 1, degrees: 2 },
  credentials: [
    { id: 'C1', kind: 'cert', name: 'Example PM Pro', issuer: 'PMI', earned: '2018', expires: '2027-07-02', renewal: 'credits', creditsNeeded: 60, creditsEarned: 22, tracks: ['Program & Project Management'], sendToAgent: true, credentialId: 'SECRET-1',
      state: st('active', 'Active', 242), pace: { earned: 22, needed: 60, left: 38, months: 8, perMonth: 4.8, unit: 'PDUs', pct: 37, text: '22 of 60 PDUs · 8 months left · about 4.8 a month' } },
    { id: 'C2', kind: 'cert', name: 'Cloud Architect Cert', issuer: 'Example Cloud', earned: '2024', expires: '2026-12-01', renewal: 'fee', fee: 99, tracks: ['FP&A'], sendToAgent: true, state: st('soon', 'Renew by 2026-12-01', 29), pace: null },
    { id: 'C3', kind: 'cert', name: 'Old Scrum Cert', issuer: '', earned: '2021', expires: '2025-06-30', renewal: 'none', tracks: [], sendToAgent: true, state: st('expired', 'Expired 2025', -490), pace: null },
    { id: 'D1', kind: 'degree', name: 'Bachelor of Engineering', issuer: 'Example University', field: '', earned: '2010', tracks: [], sendToAgent: true, state: st('degree', 'Degree', null), pace: null },
    { id: 'D2', kind: 'degree', name: 'MBA', issuer: 'Example School', field: 'Finance', earned: '2016', tracks: [], sendToAgent: true, state: st('degree', 'Degree', null), pace: null }] };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const QUICK = !!process.env.CRED_QUICK;
  for (const width of (QUICK ? [390] : [390, 1280])) {
    const L = 'full ' + width;
    console.log('\nfull dashboard @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof CarCredentials === 'function', null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(PAYLOAD => {
      window.__posts = [];
      window.apiGet = (u, t, p) => Promise.resolve(p.action === 'career_credentials' ? JSON.parse(JSON.stringify(PAYLOAD)) : { ok: false });
      window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(b))); return Promise.resolve({ ok: true, sync: { ok: true, written: true } }); };
      document.querySelectorAll('#ccprobe').forEach(n => n.remove());
      const host = document.createElement('div'); host.id = 'ccprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
      ReactDOM.createRoot(host).render(React.createElement(CarCredentials, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
    }, PAYLOAD);
    await wait(400);
    const txt = sel => page.$eval('#ccprobe ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    const click = sel => page.evaluate(sel => { const n = document.querySelector('#ccprobe ' + sel); if (n) n.click(); return !!n; }, sel);
    const fill = (sel, v) => page.evaluate(({ sel, v }) => { const n = document.querySelector('#ccprobe ' + sel); if (!n) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); return true; }, { sel, v });
    check(L + ': totals', (await txt('.car-cred-totals')) === 'Active 2 Renew soon 1 Degrees 2', await txt('.car-cred-totals'));
    check(L + ': what the job agent sees, and when it was sent', /^WHAT THE JOB AGENT SEES Bachelor of Engineering \(2010\); MBA in Finance \(2016\); Example PM Pro; Cloud Architect Cert \(2024\); Old Scrum Cert \(expired 2025\) Sent 2026-11-01$/.test(await txt('.car-cred-agent')), await txt('.car-cred-agent'));
    const cards = await page.$$eval('#ccprobe .car-cred-card', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
    check(L + ': a card per certification, with its badge', cards.length === 3 && /^Example PM Pro PMI · earned 2018 Active/.test(cards[0]) && /Renew by 2026-12-01/.test(cards[1]) && /Expired 2025/.test(cards[2]), JSON.stringify(cards));
    check(L + ': the credits bar and pace', /22 of 60 PDUs · 8 months left · about 4\.8 a month/.test(cards[0]) && await page.$eval('#ccprobe .car-cred-bar', n => n.style.width) === '37%');
    check(L + ': fee and never', /Renews by fee · \$99 · next 2026-12-01/.test(cards[1]) && /Expires 2025-06-30/.test(cards[2]));
    check(L + ': tracks shown, and no credential ID anywhere', /Program & Project Management/.test(cards[0]) && !/SECRET/.test(await txt('.car-creds')));
    check(L + ': degrees, never expiring', /Bachelor of Engineering Example University · 2010 Degree/.test(await txt('.car-creds')) && /MBA Finance · Example School · 2016 Degree/.test(await txt('.car-creds')));
    await click('.car-cred-log-btn'); await wait(100);
    await fill('.car-cred-log-n', '6'); await wait(50); await click('.car-cred-log-save'); await wait(200);
    let posts = await page.evaluate(() => window.__posts);
    check(L + ': Log PDUs', posts[0] && posts[0].action === 'career_credential_log_credits' && posts[0].id === 'C1' && posts[0].n === 6, JSON.stringify(posts));
    check(L + ': …and says it was sent on', /sent to the job agent/.test(await txt('.car-cred-msg')));
    await page.evaluate(() => Array.from(document.querySelectorAll('#ccprobe .car-cred-card')).find(n => /Cloud Architect/.test(n.innerText)).querySelector('.car-cred-renew-btn').click()); await wait(100);
    await fill('.car-cred-renew-date', '2027-12-01'); await wait(50); await click('.car-cred-renew-save'); await wait(200);
    posts = await page.evaluate(() => window.__posts);
    check(L + ': Renew saves the new expiry', posts[1] && posts[1].action === 'career_credential_save' && posts[1].credential.id === 'C2' && posts[1].credential.expires === '2027-12-01');
    await page.evaluate(() => document.querySelector('#ccprobe .car-cred-edit[aria-label="Edit Example PM Pro"]').click()); await wait(100);
    check(L + ': the edit screen opens filled, credits mode', await page.$eval('#ccprobe .car-cred-f-name', n => n.value) === 'Example PM Pro' && await page.$('#ccprobe .car-cred-renewal-credits.on') !== null && await page.$('#ccprobe .car-cred-f-needed') !== null);
    await click('.car-cred-renewal-fee'); await wait(80);
    check(L + ': fee mode asks for the fee, not credits', await page.$('#ccprobe .car-cred-f-fee') !== null && await page.$('#ccprobe .car-cred-f-needed') === null);
    await click('.car-cred-renewal-none'); await wait(80);
    check(L + ': never: no fee, no credits', await page.$('#ccprobe .car-cred-f-fee') === null && await page.$('#ccprobe .car-cred-f-needed') === null);
    await click('.car-cred-renewal-credits'); await wait(80);
    check(L + ': the credential ID field says it stays in VERA', /Credential ID \(kept in VERA only\)/.test(await txt('.car-cred-editor')));
    await page.evaluate(() => document.querySelector('#ccprobe .car-cred-f-agent').click()); await wait(50);
    await click('.car-cred-save'); await wait(200);
    posts = await page.evaluate(() => window.__posts);
    check(L + ': the agent switch is saved', posts[2] && posts[2].action === 'career_credential_save' && posts[2].credential.sendToAgent === false && posts[2].credential.renewal === 'credits', JSON.stringify(posts[2]));
    await click('.car-cred-add-degree'); await wait(100);
    check(L + ': + Degree: school and field, no renewal', /School/.test(await txt('.car-cred-editor')) && await page.$('#ccprobe .car-cred-f-field') !== null && await page.$('#ccprobe .car-cred-renewal-fee') === null);
    await click('.car-cred-cancel');
    check(L + ': buttons big enough to tap', await page.$$eval('#ccprobe .car-cred-kind, #ccprobe .car-cred-renewal, #ccprobe .car-cred-track', ns => ns.every(n => n.getBoundingClientRect().height >= 36)));
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
