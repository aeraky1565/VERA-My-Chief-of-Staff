// Drives the REAL Career tab v2, phase 3 (issue #216) in the full dashboard at
// phone and desktop widths: Network, Market, Brand, Exchange and "How it
// connects", over a stubbed career payload, a stubbed career_pipeline and a
// recording apiPost. Invented people, companies and figures only.
//
// Asserted as you'd see it: the no-sponsor gap names the right track, a contact
// posts with its role and tracks, the package and its estimated total, matches
// priced against it and the benchmarks, a brand that refuses a non-https link,
// an Exchange paste that previews with marks and imports only once the box is
// ticked, a copy-out that logs, the crossings view, and no sideways scroll.
const { chromium } = require('playwright');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const FX = {
  ok: true,
  tracks: [{ id: 'fpa', name: 'FP&A' }, { id: 'pmo', name: 'Program & Project Management' }],
  ladder: [{ id: 'r2', status: 'current', title: 'Senior Manager, Planning', company: 'Exampleco', track: 'fpa', start: '2025' }],
  criteria: [{ id: 'core-people', group: 'core', name: 'People leadership', active: true }],
  readiness: {
    fpa: { verdict: 'stretch', pct: 50, points: 1, max: 2, criteria: [{ id: 'core-people', group: 'core', name: 'People leadership', meaning: 'Leads a team', status: 'partial', computed: 'partial', overridden: false, evidenceIds: ['e1'] }] },
    pmo: { verdict: 'stretch', pct: 50, points: 1, max: 2, criteria: [] },
  },
  piesReadiness: { period: '2026-10', updates: [{ criterionId: 'core-people', status: 'partial', reason: 'Two direct reports' }] },
  evidence: [], intents: [], suggestions: [], development: [],
  northstar: { compFloor: { base: '175000', baseOutsideDC: '', total: '220000' } },
  contacts: [
    { id: 'c1', name: 'Pat Example', title: 'VP Finance', org: 'Exampleco', role: 'sponsor', tracks: ['fpa'], canDo: 'Speaks for me at planning reviews', warmth: 'strong', lastTouch: '2026-10-01', nextIntent: 'Coffee in November', source: 'v1' },
    { id: 'c2', name: 'Talent partner', title: '', org: 'Madeup LLC', role: 'recruiter', tracks: [], warmth: 'cold', lastTouch: '', source: 'agent' },
  ],
  sponsorGap: { fpa: false, pmo: true },
  package: { id: 'p1', asOf: '2026-10', employer: 'Exampleco', base: 150000, bonusPct: 10 },
  packageEst: { base: 150000, bonus: 15000, equity: 20000, match401k: 6000, benefits: 14000, forfeited: 30000, total: 205000 },
  brand: { positioning: { core: 'Finance leader who runs portfolios', fpa: '', pmo: '' }, linkedin: [], resumes: [], staticProfile: '' },
  exchange: {
    log: [{ id: 'x1', date: '2026-10-02', direction: 'in', payload: 'PIES-BRIEF', version: 'v1', period: '2026-09', summary: '3 evidence, 1 readiness, 1 calibration' }],
    overdue: { month: '2026-10', quarter: '2026-Q4', brief: { last: '2026-09', due: '2026-09', overdue: false }, intents: { last: '2026-Q3', overdue: true } },
    briefLast: { period: '2026-09', scopeThemes: ['Broader portfolio'], visibilityChanges: [], feedbackThemes: [] },
  },
};
const PIPE = {
  ok: true, configured: true, statuses: ['New', 'Passed', 'Handoff'],
  benchmarks: [{ track: 'fpa', level: 'Associate Director', count: 3, lo: 160000, hi: 210000, mid: 185000 }],
  rows: [{ row: 2, title: 'Associate Director, FP&A', company: 'Invented Corp', salaryRange: '$160K–$220K', track: 'fpa',
           market: { lo: 160000, hi: 220000, mid: 190000, pctMid: 27, pctTop: 47, estTotalMid: 229000, vsTotal: 24000, firstYearVsTotal: -21000, verdict: 'step-up', clearsFloor: true } }],
};
const PREVIEW = { ok: true, type: 'PIES-BRIEF', period: '2026-10', duplicate: '',
  marks: [{ kind: 'name', text: 'Acme Corp' }, { kind: 'figure', text: '$2.5M' }],
  content: { accomplishments: [{ statement: 'Led the reforecast with Acme Corp', scale: '$2.5M', criterion: 'Planning & forecasting ownership' }], readinessUpdates: [], internalCalibration: [] } };

async function mount(page) {
  return page.evaluate(([fx, pipe, preview]) => {
    document.querySelectorAll('#carprobe').forEach(n => n.remove());
    const host = document.createElement('div'); host.id = 'carprobe'; document.body.appendChild(host);
    window.__posts = []; window.confirm = () => true;
    window.apiGet = (u, t, p) => Promise.resolve(p.action === 'career_pipeline' ? pipe : { ok: true });
    window.apiPost = (u, t, b) => {
      window.__posts.push(b);
      if (b.action === 'career_exchange_preview') return Promise.resolve(preview);
      if (b.action === 'career_exchange_import') return Promise.resolve({ ok: true, type: 'PIES-BRIEF', evidence: 1, readiness: 0, calibration: 0 });
      if (b.action === 'career_exchange_export') return Promise.resolve({ ok: true, text: 'VERA-INTENTS v1 | 2026-Q4\nNext step: Associate Director\nIntents:\n1. Invented intent' });
      return Promise.resolve({ ok: true });
    };
    function Probe() {
      const [, setN] = React.useState(0);
      return React.createElement(CareerTab, { career: fx, loading: false, busy: false, apiUrl: 'https://vera.test/exec', apiToken: 't',
        onReload: () => { setN(n => n + 1); return Promise.resolve(); } });
    }
    ReactDOM.createRoot(host).render(React.createElement(Probe));
    return new Promise(r => setTimeout(r, 250));
  }, [FX, PIPE, PREVIEW]);
}

const text = page => page.$eval('#carprobe', n => n.innerText);
const clickText = (page, sel, t) => page.evaluate(([sel, t]) => {
  const el = Array.from(document.querySelectorAll('#carprobe ' + sel)).find(n => n.textContent.trim() === t);
  if (!el) return false; el.click(); return true;
}, [sel, t]);
const posts = page => page.evaluate(() => window.__posts);
const wait = ms => new Promise(r => setTimeout(r, ms));
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const modalField = (page, label, value) => page.evaluate(([label, value]) => {
  const g = Array.from(document.querySelectorAll('#carprobe .modal .form-group')).find(n => n.querySelector('label').textContent === label);
  const el = g.querySelector('input,textarea,select');
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}, [label, value]);
const saveModal = page => page.evaluate(() => Array.from(document.querySelectorAll('#carprobe .modal button')).find(b => b.textContent === 'Save').click());

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of [390, 1280]) {
    console.log('\nphase 3 @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await mount(page);
    let t = await text(page);
    check('all eight subtabs', ['North Star', 'Readiness', 'Evidence', 'Pipeline', 'Network', 'Market', 'Brand', 'Exchange'].every(s => t.includes(s)));

    // ---- Readiness: the PIES signal beside its criterion
    await clickText(page, '.subtab-btn', '✅ Readiness');
    await wait(80);
    check('a PIES readiness update shows beside its criterion, not as the status', (await text(page)).includes('PIES 2026-10: Partial — Two direct reports'));

    // ---- Network
    await clickText(page, '.subtab-btn', '🤝 Network');
    await wait(80);
    t = await text(page);
    check('the sponsor gap names only the uncovered track', t.includes('No active sponsor for Program & Project Management') && !/No active sponsor for FP&A/.test(t));
    check('contacts show by role, with warmth, tracks and the next intent', t.includes('Pat Example') && t.includes('Strong') && t.includes('Next: Coffee in November') && t.includes('Talent partner') && t.includes('From the agent'));
    await page.evaluate(() => { const li = Array.from(document.querySelectorAll('#carprobe .car-contact')).find(n => n.textContent.includes('Pat Example')); Array.from(li.querySelectorAll('button')).find(b => b.textContent === 'Touched today').click(); });
    await wait(100);
    check('“Touched today” posts for that contact', (await posts(page)).some(x => x.action === 'career_touch_contact' && x.id === 'c1'));
    await clickText(page, 'button', '+ Add contact');
    await wait(60);
    await modalField(page, 'Name (or a role title)', 'Invented Mentor');
    await modalField(page, 'Role for you', 'sponsor');
    await modalField(page, 'Warmth', 'warm');
    await page.evaluate(() => { const l = Array.from(document.querySelectorAll('#carprobe .modal label')).find(n => n.textContent.trim() === 'Program & Project Management'); l.querySelector('input').click(); });
    await saveModal(page);
    await wait(120);
    const ct = ((await posts(page)).find(x => x.action === 'career_save_contact') || {}).contact || {};
    check('a new contact posts with its role, warmth and track', ct.name === 'Invented Mentor' && ct.role === 'sponsor' && ct.warmth === 'warm' && ct.tracks.join() === 'pmo', JSON.stringify(ct));
    check('Network: no sideways scroll', await noScroll(page));

    // ---- Market
    await clickText(page, '.subtab-btn', '💵 Market');
    await wait(200);
    t = await text(page);
    check('the package shows with its estimated total and the floors', t.includes('$205,000') && t.includes('$30,000') && t.toLowerCase().includes('as of 2026-10') && t.includes('base $175,000'));
    check('each priced match shows its verdict and first-year cost', t.includes('Invented Corp') && t.includes('Step up') && t.includes('first year −$21,000'));
    check('benchmarks show median ranges by track and level', t.includes('$160,000') && t.includes('$185,000') && t.includes('Associate Director'));
    await clickText(page, 'button', 'Update');
    await wait(60);
    await modalField(page, 'Base', '158000');
    await modalField(page, 'Unvested, forfeited on leaving', '25000');
    await saveModal(page);
    await wait(120);
    const pk = ((await posts(page)).find(x => x.action === 'career_save_package') || {}).package || {};
    check('updating the package posts its figures', pk.base === '158000' && pk.unvestedForfeited === '25000' && pk.asOf === '2026-10', JSON.stringify(pk));
    check('Market: no sideways scroll', await noScroll(page));

    // ---- Brand
    await clickText(page, '.subtab-btn', '🪪 Brand');
    await wait(80);
    check('the saved positioning shows', await page.evaluate(() => Array.from(document.querySelectorAll('#carprobe textarea')).some(n => n.value === 'Finance leader who runs portfolios')));
    await clickText(page, 'button', '+ Add link');
    await wait(60);
    const setIn = (sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, [sel, v]);
    await setIn('#carprobe input[type="url"]', 'http://plain.example/resume');
    await wait(60);
    const blocked = await page.evaluate(() => Array.from(document.querySelectorAll('#carprobe button')).find(b => b.textContent === 'Save brand').disabled);
    check('a non-https resume link blocks the save, and says why', blocked && (await text(page)).includes('must start with https://'));
    await setIn('#carprobe input[type="url"]', 'https://docs.example/resume');
    await wait(60);
    await clickText(page, 'button', 'Save brand');
    await wait(120);
    const br = ((await posts(page)).find(x => x.action === 'career_save_brand') || {}).brand || {};
    check('saving posts the brand with its link', br.resumes && br.resumes[0].url === 'https://docs.example/resume' && br.positioning.core === 'Finance leader who runs portfolios', JSON.stringify(br));
    check('Brand: no sideways scroll', await noScroll(page));

    // ---- Exchange
    await clickText(page, '.subtab-btn', '🔁 Exchange');
    await wait(80);
    t = await text(page);
    check('what’s due shows: brief up to date, intents due', t.includes('Up to date') && t.includes('last: 2026-09') && t.includes('Due this quarter'));
    check('the log and the latest brief show', t.includes('PIES-BRIEF v1') && t.includes('3 evidence, 1 readiness, 1 calibration') && t.includes('Broader portfolio'));
    await page.fill('#car-paste', 'PIES-BRIEF v1 | 2026-10\n{"accomplishments":[]}');
    await clickText(page, 'button', 'Preview');
    await wait(150);
    t = await text(page);
    check('the preview shows what would be imported and marks what to check', t.includes('Name?: Acme Corp') && t.includes('Figure: $2.5M') && t.includes('Led the reforecast with Acme Corp'));
    const importBtn = () => page.evaluate(() => { const b = Array.from(document.querySelectorAll('#carprobe button')).find(x => x.textContent === 'Import'); return b ? b.disabled : null; });
    check('Import stays off until the marks are checked', (await importBtn()) === true && !(await posts(page)).some(x => x.action === 'career_exchange_import'));
    await page.evaluate(() => { const l = Array.from(document.querySelectorAll('#carprobe label')).find(n => /checked the marked terms/.test(n.textContent)); l.querySelector('input').click(); });
    await wait(60);
    await clickText(page, 'button', 'Import');
    await wait(150);
    const im = (await posts(page)).find(x => x.action === 'career_exchange_import');
    check('Import posts the pasted text, confirmed', im && im.confirmed === true && /^PIES-BRIEF v1/.test(im.text));
    check('…and says what came in', (await text(page)).includes('Imported: 1 evidence item(s)'));
    await clickText(page, 'button', 'Copy VERA-INTENTS');
    await wait(150);
    check('copying intents asks for the export and shows the text', (await posts(page)).some(x => x.action === 'career_exchange_export' && x.kind === 'intents') &&
          await page.evaluate(() => /^VERA-INTENTS v1 \| 2026-Q4/.test((document.querySelector('#carprobe textarea.car-out') || {}).value || '')));
    check('Exchange: no sideways scroll', await noScroll(page));

    // ---- How it connects
    await clickText(page, 'button', 'How it connects');
    await wait(80);
    t = await text(page);
    check('How it connects shows the three systems and every payload crossing', ['PIES', 'VERA', 'Job agent'].every(s => t.includes(s)) &&
          ['PIES-BRIEF v1', 'VERA-INTENTS v1', 'MATCHER-CONTEXT v1', 'ROLE-MATCH v1'].every(s => t.includes(s)) && t.includes('Tracker → Status column, nothing else'));
    check('…with the rules and where each file lives', t.includes('Links into VERA never carry a token.') && t.includes('Job Agent Settings sheet'));
    check('How it connects: no sideways scroll (wide tables scroll inside their card)', await noScroll(page));
    await clickText(page, 'button', 'Back to Career');
    await wait(60);
    check('Back returns to the subtab', (await text(page)).includes('Paste in') && !(await text(page)).includes('Every crossing'));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
