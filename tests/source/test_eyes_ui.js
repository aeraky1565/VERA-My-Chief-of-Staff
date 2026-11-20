// Health › Care › Eyes (EyesTab, shared verbatim) in BOTH real pages at phone and desktop width, on
// invented data: Eyes under Care (and lite's Family); the person switch; the glasses and contacts cards
// (Rx grid, expiry, Copy, the photo); contacts supply and Reorder; the eye exam from Appointments with
// Book it; Add a prescription from a photo (VERA reads it, an unsure number marked, the change from the
// last one, Save); History; Buying (usual items, Log an order); no sideways scroll. All invented.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || process.env.VERA_ROOT || REPO;
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8'), LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const START = '// ---- EyesTab (Health › Care › Eyes)', END = '// ---- /EyesTab ----';
const block = s => { const a = s.indexOf(START), b = s.indexOf(END); return a === -1 || b === -1 ? '' : s.slice(a, b + END.length); };
console.log('\nthe shared block and where it lives');
check('both dashboards carry it, word for word', block(APP).length > 3000 && block(APP) === block(LITE));
check('Eyes sits after Coverage under Health › Care, in both', /items:\['coverage','eyes','prescriptions','appointments'\]/.test(APP) && /items:\['coverage','eyes','prescriptions','appointments'\]/.test(LITE)
  && /sub==='eyes'&&React\.createElement\(EyesTab,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
check('…and on lite’s Family tab', /\{ id: 'eyes', label: '👓 Eyes' \}/.test(LITE) && /familySub === 'eyes' && <EyesTab apiUrl=\{apiUrl\} apiToken=\{apiToken\} \/>/.test(LITE));

const EYES = { ok: true, today: '2026-11-20', people: ['Pat', 'Sam'],
  current: [{ id: 'G1', person: 'Pat', kind: 'glasses', exam: '2025-03-12', expires: '2027-03-12', doctor: 'Dr. Lee', odSph: '-2.25', odCyl: '-0.50', odAxis: '180', odAdd: '', osSph: '-2.00', osCyl: '-0.75', osAxis: '170', osAdd: '', pd: '63', photo: 'F1', copy: 'OD -2.25 -0.50 x180 · OS -2.00 -0.75 x170 · PD 63 · expires 2027-03-12' },
    { id: 'C1', person: 'Pat', kind: 'contacts', exam: '2025-12-01', expires: '2026-12-30', doctor: 'Dr. Lee', odSph: '-2.25', osSph: '-2.00', bc: '8.6', dia: '14.5', lens: 'Acme Daily', wear: 'daily', photo: '', copy: 'OD -2.25 · OS -2.00 · BC 8.6 · DIA 14.5 · Acme Daily' },
    { id: 'G2', person: 'Sam', kind: 'glasses', exam: '2024-08-04', expires: '2026-08-04', odSph: '-4.75', osSph: '-5.00', osCyl: '-0.25', osAxis: '90', pd: '60', photo: '', copy: 'OD -4.75 · OS -5.00 -0.25 x90 · PD 60' }],
  history: [{ id: 'G0', person: 'Pat', kind: 'glasses', exam: '2023-02-01', odSph: '-2.00', osSph: '-2.00', photo: 'F0', copy: 'OD -2.00 · OS -2.00' }],
  usual: [{ id: 'U1', person: 'Pat', what: 'Contacts', brand: 'Acme Daily', pack: '90', daysPerPack: '90', store: 'LensShop', link: 'https://shop.test/acme', price: '62' }],
  orders: [{ id: 'O1', person: 'Pat', date: '2026-09-28', what: 'Contacts', boxes: '1', store: 'LensShop', cost: '124', paidWith: 'FSA' }],
  supply: { Pat: { lastOrder: '2026-09-28', boxes: 1, lastsTo: '2026-12-27', daysLeft: 37, reorderBy: '2026-12-13', store: 'LensShop', link: 'https://shop.test/acme' }, Sam: null },
  exams: [{ person: 'Pat', type: 'Eye Exam', provider: 'Dr. Lee', lastVisit: '2025-12-01', nextDue: '2026-12-01', daysUntil: 11 }] };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8Dwn4GBgYGJAQoAAA7oAQPn1x3sAAAAAElFTkSuQmCC';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = { 'react.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'), 'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8') };
  const pngFile = path.join(__dirname, 'zz_eyes_rx.png'); fs.writeFileSync(pngFile, Buffer.from(PNG, 'base64'));
  for (const kind of ['full', 'lite']) for (const width of [390, 1280]) {
    const L = kind + ' ' + width; console.log('\n' + kind + ' dashboard @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    if (kind === 'lite') {
      await page.route('**/*', r => { const u = r.request().url();
        for (const n of Object.keys(vendor)) if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
        if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: LITE });
        return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' }); });
      await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 't'); });
      await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
    } else await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof EyesTab === 'function', null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(({ EYES }) => {
      window.__posts = []; window.__copied = '';
      try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } }); } catch (e) {}
      window.apiGet = (u, t, p) => Promise.resolve(JSON.parse(JSON.stringify(p.action === 'eyes' ? EYES : p.action === 'eye_photo' ? { ok: true, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' } : { ok: false })));
      window.apiPost = (u, t, b) => { window.__posts.push(JSON.parse(JSON.stringify(Object.assign({}, b, b.imageBase64 ? { imageBase64: 'B64:' + b.imageBase64.length } : {}))));
        if (b.action === 'eye_read') return Promise.resolve({ ok: true, kind: b.kind, values: { odSph: '-2.50', odCyl: '-0.50', odAxis: '180', osSph: '-2.25', osCyl: '-0.75', osAxis: '170', pd: '63' }, unsure: ['osAxis'], exam: '2026-03-10', doctor: 'Dr. Lee' });
        if (b.action === 'appt_book') return Promise.resolve({ ok: true, made: true, task: 'Call to book Eye Exam', phone: '555-0100' });
        return Promise.resolve({ ok: true, id: 'NEW' }); };
      document.querySelectorAll('#eyprobe').forEach(n => n.remove());
      const host = document.createElement('div'); host.id = 'eyprobe'; host.style.padding = '0 12px'; document.body.prepend(host);
      ReactDOM.createRoot(host).render(React.createElement(EyesTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
    }, { EYES });
    await wait(400);
    const txt = s => page.$eval('#eyprobe ' + s, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    const click = s => page.$eval('#eyprobe ' + s, n => n.click());
    const last = () => page.evaluate(() => window.__posts.slice(-1)[0] || {});
    check(L + ': the person switch, Pat first', JSON.stringify(await page.$$eval('#eyprobe .ey-person', ns => ns.map(n => n.innerText.trim() + ':' + n.getAttribute('aria-pressed')))) === '["Pat:true","Sam:false"]');
    const g = await txt('.ey-glasses');
    check(L + ': glasses: the Rx grid, PD, the exam, good-to pill', /SPH CYL AXIS ADD OD -2\.25 -0\.50 180 — OS -2\.00 -0\.75 170 —/.test(g) && /PD 63/.test(g) && /good to Mar 12, 2027/.test(g) && /Dr\. Lee/.test(g), g);
    const cc = await txt('.ey-contacts');
    check(L + ': contacts: PWR, BC · DIA, the lens, expires soon, supply left and reorder by', /PWR CYL AXIS OD -2\.25/.test(cc) && /BC · DIA 8\.6 · 14\.5/.test(cc) && /Acme Daily · daily/.test(cc) && /expires in 40 days/.test(cc) && /about 37 days/.test(cc) && /Reorder by Dec 13, 2026/.test(cc), cc);
    check(L + ': Reorder opens the usual store', (await page.$eval('#eyprobe .ey-reorder', n => n.getAttribute('href') + '|' + n.innerText)) === 'https://shop.test/acme|Reorder · LensShop');
    await page.$eval('#eyprobe .ey-glasses .ey-copy', n => n.click()); await wait(100);
    check(L + ': Copy for an online order', (await page.evaluate(() => window.__copied)) === EYES.current[0].copy && /Copied: OD -2\.25/.test(await txt('.ey-glasses')));
    await page.$eval('#eyprobe .ey-glasses .ey-photo', n => n.click()); await wait(150);
    check(L + ': See the photo shows it', await page.$('#eyprobe .ey-glasses img') !== null);
    check(L + ': the eye exam from Appointments', /Eye exam due Dec 1, 2026/.test(await txt('.ey-exam')) && /Last visit Dec 1, 2025 · Dr\. Lee/.test(await txt('.ey-exam')));
    await click('.ey-book'); await wait(150);
    check(L + ': Book it makes the Task, through Appointments', JSON.stringify(await last()) === '{"action":"appt_book","person":"Pat","type":"Eye Exam"}' && /Task added: Call to book Eye Exam \(555-0100\)/.test(await txt('.ey-msg')));
    // add a prescription from a photo
    await click('.ey-add'); await wait(100);
    await page.setInputFiles('#eyprobe .ey-file', pngFile); await wait(500);
    const rd = (await page.evaluate(() => window.__posts.filter(p => p.action === 'eye_read').slice(-1)[0])) || {};
    check(L + ': the photo goes to VERA to read, as glasses', rd.kind === 'glasses' && /^B64:\d+$/.test(rd.imageBase64) && rd.mime === 'image/jpeg', JSON.stringify(rd));
    check(L + ': the numbers fill in; the one it wasn’t sure of is marked', (await page.$eval('#eyprobe input[aria-label="OD SPH"]', n => n.value)) === '-2.50' && (await page.$$eval('#eyprobe .ey-unsure input', ns => ns.map(n => n.getAttribute('aria-label')))).join() === 'OS AXIS' && /VERA wasn’t sure/.test(await txt('.ey-form')));
    check(L + ': what changed from the current one', /Changed: OD SPH -2\.25 → -2\.50 · OS SPH -2\.00 → -2\.25/.test(await txt('.ey-diff')), await txt('.ey-diff'));
    await page.fill('#eyprobe input[aria-label="OS AXIS"]', '171'); await wait(80);
    check(L + ': typing over a marked number clears the mark', (await page.$$('#eyprobe .ey-unsure')).length === 0);
    check(L + ': with a photo, Save with the photo or Save without it', (await page.$eval('#eyprobe .ey-save', n => n.innerText)) === 'Save with the photo' && (await page.$eval('#eyprobe .ey-save-nophoto', n => n.innerText)) === 'Save without the photo');
    await click('.ey-save-nophoto'); await wait(200);
    const np = await page.evaluate(() => window.__posts.filter(p => p.action === 'eye_save').slice(-1)[0] || {});
    check(L + ': Save without the photo sends the numbers and no photo', np.kind === 'glasses' && np.values.osAxis === '171' && !('imageBase64' in np) && /Saved Pat’s glasses prescription\./.test(await txt('.ey-msg')), JSON.stringify(np));
    await click('.ey-add'); await wait(100);
    check(L + ': no photo yet → one Save button', (await page.$('#eyprobe .ey-save-nophoto')) === null && /Save · it becomes the current one/.test(await page.$eval('#eyprobe .ey-save', n => n.innerText)));
    await page.setInputFiles('#eyprobe .ey-file', pngFile); await wait(500);
    await page.fill('#eyprobe input[aria-label="OS AXIS"]', '171'); await wait(80);
    await click('.ey-save'); await wait(200);
    const sv = await page.evaluate(() => window.__posts.filter(p => p.action === 'eye_save').slice(-1)[0] || {});
    check(L + ': Save sends Pat’s glasses, the numbers, the exam and the photo', sv.person === 'Pat' && sv.kind === 'glasses' && sv.values.osAxis === '171' && sv.exam === '2026-03-10' && sv.confirmed === true && /^B64:/.test(sv.imageBase64), JSON.stringify(sv));
    // Sam, history, buying
    await page.$$eval('#eyprobe .ey-person', ns => ns.find(n => n.innerText.trim() === 'Sam').click()); await wait(120);
    check(L + ': Sam: expired glasses said in red; no contacts yet; no exam in Appointments', /expired Aug 4, 2026/.test(await txt('.ey-glasses')) && /No contacts prescription for Sam yet/.test(await txt('.ey-contacts')) && /No eye exam in Appointments yet/.test(await txt('.ey-exam')));
    await page.$$eval('#eyprobe .ey-person', ns => ns.find(n => n.innerText.trim() === 'Pat').click()); await click('.ey-nav-hist'); await wait(120);
    check(L + ': History: the older glasses with its photo', /Glasses · Feb 1, 2023/.test(await txt('.ey-hist')) && /OD -2\.00 · OS -2\.00/.test(await txt('.ey-hist')));
    await click('.ey-nav-buy'); await wait(120);
    check(L + ': Buying: the usual contacts and the order', /Contacts Acme Daily · 90-pack · 90 days a pack · LensShop · \$62/.test(await txt('.ey-usual')) && /Sep 28, 2026 · Contacts · 1 per eye LensShop · \$124 · FSA/.test(await txt('.ey-orders')));
    await click('.ey-order-add'); await wait(80);
    await page.fill('#eyprobe .ey-order-form input[aria-label="Boxes per eye"]', '2'); await click('.ey-order-save'); await wait(150);
    check(L + ': Log an order sends the person, today, the store from the usual item and boxes', (o => o.action === 'eye_order_log' && o.person === 'Pat' && o.date === '2026-11-20' && o.store === 'LensShop' && o.boxes === '2')(await last()), JSON.stringify(await last()));
    await click('.ey-usual-add'); await wait(80);
    await page.fill('#eyprobe .ey-usual-form input[aria-label="Brand"]', 'Drops Co'); await page.fill('#eyprobe .ey-usual-form input[aria-label="What"]', 'Drops'); await click('.ey-usual-save'); await wait(150);
    check(L + ': Add a brand or store saves it for that person', (o => o.action === 'eye_usual_save' && o.person === 'Pat' && o.what === 'Drops' && o.brand === 'Drops Co')(await last()));
    await click('.ey-nav-now'); await wait(80);
    check(L + ': buttons are big enough to tap', await page.$$eval('#eyprobe button', ns => ns.every(n => n.getBoundingClientRect().height >= 36)));
    check(L + ': no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  fs.rmSync(pngFile, { force: true });
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
