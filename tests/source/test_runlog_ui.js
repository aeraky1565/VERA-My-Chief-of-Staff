// System › Checks › Run log in the browser, at 390 and 1280: one line per scheduled job,
// a cut-off nightly run named with the step it stopped in, the pill, the strip, and
// the older runs on a tap. Invented data.
const { chromium } = require('playwright');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const wait = ms => new Promise(r => setTimeout(r, ms));

const LOG = { ok: true, where: 'the Run Log tab in your logs sheet', jobs: [
  { fn: 'nightlyRun', runs: [
    { started: '2026-11-17T23:02:00', status: 'Cut off', secs: null, step: 'mpSyncNudges_', at: 183, steps: 40, skipped: '', errors: '', slowest: '', summary: 'Never finished: cut off during mpSyncNudges_ at 183s' },
    { started: '2026-11-16T23:01:00', status: 'Cut off', step: 'collect', at: 181, steps: 7 },
    { started: '2026-11-15T23:03:00', status: 'Done', secs: 301, steps: 62, slowest: 'collect 61.0s · checkHealthAppointments_ 40.2s', summary: '12 flags written' }] },
  { fn: 'hourlyCheck', runs: [{ started: '2026-11-18T09:41:00', status: 'Done', secs: 14, steps: 0 }] },
  { fn: 'runEmailScan_', runs: [{ started: '2026-11-18T09:11:00', status: 'Skipped', secs: 1, summary: 'email_parser_enabled is not true' }] },
  { fn: 'checkFlightStatuses_', runs: [{ started: '2026-11-18T09:24:00', status: 'Partial', secs: 7, errors: 'aviationstack: quota reached on a very long invented provider name that keeps going and going' }] },
] };

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of (process.env.VERA_CTL_FAST ? [390] : [390, 1280])) {
    const L = '@' + width;
    console.log('\nRun log ' + L);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof SystemTab === 'function', null, { timeout: 15000 }).catch(() => {});
    await page.evaluate((log) => {
      window.__asked = [];
      window.fetch = (url) => { const a = new URL(url).searchParams.get('action'); window.__asked.push(a);
        return Promise.resolve({ json: () => Promise.resolve(a === 'run_log' ? log : { ok: true }) }); };
      VERA_ACCESS = null;
      const root = document.getElementById('root'); if (root) root.style.display = 'none';
      const host = document.createElement('div'); host.id = 'rl'; host.style.padding = '0 12px'; document.body.prepend(host);
      ReactDOM.createRoot(host).render(React.createElement(SystemTab, { apiUrl: 'https://vera.test/exec', apiToken: 't', resources: [], resourcesLoading: false,
        onAddResource() {}, onUpdateResource() {}, onDeleteResource() {}, busy: false, status: { rosterLinks: {}, features: {} }, sub: 'run_log' }));
    }, LOG);
    await wait(400);
    const txt = sel => page.$eval('#rl ' + sel, n => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    check(L + ': it reads the run log', (await page.evaluate(() => window.__asked)).indexOf('run_log') !== -1);
    check(L + ': the pill counts jobs whose latest run didn’t finish', (await txt('.rl-pill')) === '1 didn’t finish', await txt('.rl-pill'));
    check(L + ': says where the rows come from', /From the Run Log tab in your logs sheet\./.test(await txt('.rl-head')));
    const names = await page.$$eval('#rl .rl-name', ns => ns.map(n => n.innerText));
    check(L + ': one line per job, by name, in the order given', JSON.stringify(names) === '["Nightly run","Hourly check","Email scan","Flight status"]', JSON.stringify(names));
    const first = await txt('.rl-jobs > .rl-job:nth-of-type(1)');
    check(L + ': a cut-off run says the step and when it stopped', /Cut off during mpSyncNudges_ at 3m 3s · never finished/.test(first) && /Cut off/.test(await txt('.rl-jobs > .rl-job:nth-of-type(1) .rl-status')), first);
    check(L + ': a finished run says how long it took', /Took 14s/.test(await txt('.rl-jobs > .rl-job:nth-of-type(2) .rl-line')));
    check(L + ': errors are shown', /quota reached/.test(await txt('.rl-jobs > .rl-job:nth-of-type(4) .rl-errors')));
    const strip = await page.$$eval('#rl .rl-jobs > .rl-job:nth-of-type(1) .rl-strip i', ns => ns.map(n => getComputedStyle(n).backgroundColor));
    check(L + ': the strip shows the last runs, newest first: red, red, green', strip.length === 3 && strip[0] === 'rgb(248, 113, 113)' && strip[2] === 'rgb(52, 211, 153)', JSON.stringify(strip));
    check(L + ': older runs stay folded away', (await page.$('#rl .rl-more')) === null);
    await page.click('#rl .rl-jobs > .rl-job:nth-of-type(1) .rl-row'); await wait(150);
    const more = await txt('.rl-more');
    check(L + ': a tap shows the summary and each older run', /Never finished: cut off during mpSyncNudges_/.test(more) && /Cut off · Cut off during collect at 3m 1s/.test(more) && /Done · Took 5m 1s · 62 steps/.test(more), more);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(L + ': no sideways scroll, even with a long error', sw <= width, sw);
    check(L + ': no page errors', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof SystemTab === 'function', null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => {
      window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, jobs: [], where: 'the Run Log tab in VERA’s sheet' }) });
      VERA_ACCESS = null;
      const host = document.createElement('div'); host.id = 'rl'; document.body.prepend(host);
      ReactDOM.createRoot(host).render(React.createElement(SysRunLog, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));
    });
    await wait(300);
    const t = await page.$eval('#rl', n => n.innerText);
    check('nothing logged yet: says the next run writes the first row, and the pill is green', /No runs logged yet/.test(t) && /All finished/.test(t), t);
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + e.message); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
