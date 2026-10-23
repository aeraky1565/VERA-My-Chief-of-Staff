// Drives the REAL Career tab v2 (issue #216, phase 1) in the full dashboard at phone
// and desktop widths, over a stubbed `career` payload and a recording apiPost.
// Invented roles, companies and evidence only.
//
// Asserted as you'd see it: the ladder with the two next steps and their verdicts,
// the Earlier toggle, Mark reached posting career_advance and reloading, the track
// switcher changing the verdict, an override posting and showing as an override,
// the role check showing what the role adds and adopting it, adding evidence with
// criterion tags, and no sideways scroll.
const { chromium } = require('playwright');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

async function mount(page) {
  return page.evaluate(() => {
    document.querySelectorAll('#carprobe').forEach(n => n.remove());
    const host = document.createElement('div'); host.id = 'carprobe'; document.body.appendChild(host);
    const crit = (id, group, name, status, n, overridden) => ({ id, group, name, meaning: name + ' meaning', status,
      computed: overridden ? 'gap' : status, overridden: !!overridden, evidenceIds: Array.from({ length: n }, (_, i) => id + i) });
    const core = [crit('core-people', 'core', 'People leadership', 'partial', 1), crit('core-exec', 'core', 'Executive visibility', 'proven', 2, true)];
    window.__fx = {
      ok: true,
      tracks: [{ id: 'fpa', name: 'FP&A' }, { id: 'pmo', name: 'Program & Project Management' }],
      ladder: [
        { id: 'r1', status: 'reached', title: 'Engineer', company: 'Firstco', track: '', start: '2010', end: '2015' },
        { id: 'r2', status: 'current', title: 'Senior Manager, Planning', company: 'Exampleco', moveType: 'internal', track: 'fpa', start: '2025' },
        { id: 'n1', status: 'next', title: 'Associate Director, FP&A', track: 'fpa', moveType: 'either' },
        { id: 'n2', status: 'next', title: 'Associate Director, Program & Project Management', track: 'pmo', moveType: 'either' },
        { id: 'f1', status: 'future', title: 'Director', track: '', moveType: 'either' },
      ],
      criteria: [
        { id: 'core-people', group: 'core', name: 'People leadership', active: true },
        { id: 'core-exec', group: 'core', name: 'Executive visibility', active: true },
        { id: 'fpa-pl', group: 'fpa', name: 'P&L / budget accountability', active: true },
        { id: 'pmo-credentials', group: 'pmo', name: 'Program credentials & methodology', active: true },
      ],
      readiness: {
        fpa: { track: 'fpa', verdict: 'stretch', pct: 75, points: 6, max: 8, gaps: 0, partials: 2,
               criteria: core.concat([crit('fpa-pl', 'fpa', 'P&L / budget accountability', 'partial', 1)]) },
        pmo: { track: 'pmo', verdict: 'not-ready', pct: 50, points: 3, max: 6, gaps: 1, partials: 1,
               criteria: core.concat([crit('pmo-credentials', 'pmo', 'Program credentials & methodology', 'gap', 0)]) },
      },
      evidence: [{ id: 'e1', month: '2024-05', statement: 'Shipped the forecast model', scale: 'Cut close by 2 days', adScale: true, criterionIds: ['core-exec'], source: 'baseline' }],
      intents: [{ id: 'i1', text: 'Lead a planning function', track: 'fpa', status: 'active' }],
      northstar: { compFloor: { base: '150000', baseOutsideDC: '', total: '' }, locationStance: 'Remote or nearby', dealbreakers: 'Full onsite' },
      development: [{ item: 'Public speaking', status: 'Planned' }],
      baseline: { count: 1 }, network: [],
    };
    window.__posts = []; window.__reloads = 0;
    window.confirm = () => true;
    window.apiPost = function(url, token, body) {
      window.__posts.push(body);
      if (body.action === 'career_check_role') {
        return Promise.resolve({ ok: true, result: { matches: [{ criterionId: 'core-exec', note: 'reports to the CFO' }],
          extras: [{ name: 'Vendor management', meaning: 'Runs vendor contracts' }], departures: [{ note: 'Smaller team than usual' }] } });
      }
      return Promise.resolve({ ok: true });
    };
    function Probe() {
      const [, setN] = React.useState(0);
      return React.createElement(CareerTab, { career: window.__fx, loading: false, busy: false, apiUrl: 'https://vera.test/exec', apiToken: 't',
        onReload: () => { window.__reloads++; setN(n => n + 1); return Promise.resolve(); } });
    }
    ReactDOM.createRoot(host).render(React.createElement(Probe));
    return new Promise(r => setTimeout(r, 250));
  });
}

const text = page => page.$eval('#carprobe', n => n.innerText);
const clickText = (page, sel, t) => page.evaluate(([sel, t]) => {
  const el = Array.from(document.querySelectorAll('#carprobe ' + sel)).find(n => n.textContent.trim() === t || n.textContent.includes(t));
  if (!el) return false; el.click(); return true;
}, [sel, t]);
const posts = page => page.evaluate(() => window.__posts);
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of [390, 1280]) {
    console.log('\nfull dashboard @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await mount(page);

    let t = await text(page);
    check('the four phase-1 subtabs', ['North Star', 'Readiness', 'Evidence', 'Network'].every(s => t.includes(s)), t.slice(0, 200));
    check('both next steps show, each with its verdict', t.includes('Associate Director, FP&A') && t.includes('Stretch · 75%') && t.includes('Not ready · 50%'));
    check('reached roles are folded behind Earlier', t.includes('Earlier · 1 role') && !t.includes('Firstco'));
    await clickText(page, 'button', 'Earlier · 1 role');
    await wait(80);
    check('…and unfold', (await text(page)).includes('Firstco'));
    check('the constraints and intents show', t.includes('$150,000') && t.includes('Lead a planning function') && t.includes('Add 2 more'));

    const marked = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('#carprobe .car-rung')).find(n => n.textContent.includes('Associate Director, FP&A'));
      const b = Array.from(card.querySelectorAll('button')).find(x => x.textContent === 'Mark reached'); b.click(); return true;
    });
    await wait(120);
    let p = await posts(page);
    check('Mark reached posts career_advance for that rung and reloads', marked && p.some(x => x.action === 'career_advance' && x.id === 'n1') &&
          (await page.evaluate(() => window.__reloads)) >= 1, JSON.stringify(p));

    await clickText(page, '.subtab-btn', 'Readiness');
    await wait(80);
    t = await text(page);
    check('Readiness opens on FP&A: Stretch, 75%', t.toLowerCase().includes('verdict · fp&a') && t.includes('75%') && t.includes('6 of 8 points'));
    check('an override is shown as one', t.includes('Proven · override') && t.includes('computed: Gap'));
    check('carried-over development notes show', t.includes('Public speaking'));
    await clickText(page, 'button', 'Associate Director, Program & Project Management');
    await wait(80);
    t = await text(page);
    check('switching track switches the verdict', t.toLowerCase().includes('verdict · program & project management') && t.includes('Not ready') && t.includes('Program credentials & methodology'));
    await page.selectOption('#carprobe select[aria-label="Override for People leadership"]', 'proven');
    await wait(100);
    p = await posts(page);
    check('choosing an override posts it', p.some(x => x.action === 'career_set_override' && x.id === 'core-people' && x.status === 'proven'));

    await page.fill('#car-jd', 'Invented job description for a PMO lead.');
    await clickText(page, 'button', 'Check against the standard');
    await wait(150);
    t = await text(page);
    p = await posts(page);
    check('the role check posts the JD with the track', p.some(x => x.action === 'career_check_role' && x.track === 'pmo' && /Invented job/.test(x.jd)));
    check('…and shows matches, additions and departures', t.includes('Executive visibility — reports to the CFO') && t.includes('Vendor management') && t.includes('Smaller team than usual'));
    await clickText(page, 'button', 'Adopt as a PMO criterion');
    await wait(100);
    p = await posts(page);
    check('adopting posts a new PMO criterion from the role check', p.some(x => x.action === 'career_save_criterion' && x.criterion.group === 'pmo' && x.criterion.name === 'Vendor management' && x.criterion.source === 'role-check'));

    await clickText(page, '.subtab-btn', 'Evidence');
    await wait(80);
    t = await text(page);
    check('evidence shows its tags, month, scale and AD-scale chip', t.includes('Shipped the forecast model') && t.includes('Executive visibility') && t.includes('2024-05') && t.includes('AD scale'));
    await clickText(page, 'button', '+ Add evidence');
    await wait(80);
    await page.fill('#carprobe .modal textarea', 'Ran the quarterly portfolio review');
    await page.evaluate(() => {
      const lab = Array.from(document.querySelectorAll('#carprobe .modal label')).find(l => l.textContent.trim() === 'P&L / budget accountability');
      lab.querySelector('input').click();
    });
    await page.evaluate(() => Array.from(document.querySelectorAll('#carprobe .modal button')).find(b => b.textContent === 'Save').click());
    await wait(120);
    p = await posts(page);
    const saved = p.find(x => x.action === 'career_save_evidence');
    check('a new evidence item posts with its criterion tags', saved && saved.evidence.statement === 'Ran the quarterly portfolio review' && saved.evidence.criterionIds.join() === 'fpa-pl', JSON.stringify(saved));
    check('…and the dialog closes on success', !(await page.$('#carprobe .modal')));

    for (const sub of ['North Star', 'Readiness', 'Evidence']) {
      await clickText(page, '.subtab-btn', sub);
      await wait(60);
      const over = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      check(sub + ': no sideways scroll', over.scroll <= over.client + 1, JSON.stringify(over));
    }

    // A failed save keeps the dialog open and says why.
    await page.evaluate(() => { window.apiPost = () => Promise.reject(new Error('Sheet is busy')); });
    await clickText(page, '.subtab-btn', 'Evidence');
    await clickText(page, 'button', '+ Add evidence');
    await wait(60);
    await page.fill('#carprobe .modal textarea', 'Will fail');
    await page.evaluate(() => Array.from(document.querySelectorAll('#carprobe .modal button')).find(b => b.textContent === 'Save').click());
    await wait(120);
    check('a failed save keeps the dialog open and shows the error', !!(await page.$('#carprobe .modal')) && (await text(page)).includes('Sheet is busy'));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
