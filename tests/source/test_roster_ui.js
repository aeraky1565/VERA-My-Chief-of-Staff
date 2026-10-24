// Renders the REAL "Your assistants" roster card in both dashboards at phone and
// desktop widths, over a stubbed status: six rows, the right links opening in a new
// tab, every link from status (one Config row each), ARIA "Not built
// yet", a blank Config row shown as a hint naming the row, and no sideways scroll. Invented sheet ids only.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const WILLA = 'https://docs.google.com/spreadsheets/d/InventedPlannerId_0123456789/edit';
const HAILEY_URL = 'https://docs.google.com/spreadsheets/d/InventedHaileyId_0123456789/edit';
const TESS = 'https://docs.google.com/spreadsheets/d/InventedAgentId_9876543210/edit';

function probe(page, links, veraHref) {
  return page.evaluate(([links, veraHref]) => {
    document.querySelectorAll('#rprobe').forEach(n => n.remove());
    if (typeof VeraRoster !== 'function') return { error: 'VeraRoster is not defined' };
    const host = document.createElement('div'); host.id = 'rprobe';
    document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(VeraRoster, { links, veraHref }));
    return new Promise(r => setTimeout(() => {
      const rows = Array.from(host.querySelectorAll('.roster-row')).map(li => {
        const a = li.querySelector('a.roster-link');
        return { name: (a || li.querySelector('.roster-name') || {}).textContent, href: a ? a.getAttribute('href') : '',
                 target: a ? a.target : '', rel: a ? a.rel : '', state: li.querySelector('.roster-state').textContent,
                 note: (li.querySelector('.roster-note') || {}).textContent || '', text: li.innerText };
      });
      r({ title: host.querySelector('.bento-card-title').textContent, rows,
          noScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 });
    }, 250));
  }, [links, veraHref]);
}

async function assertPage(page, veraHref) {
  let r = await probe(page, { PIES: '', VERA: '', WILLA, TESS, HAILEY: HAILEY_URL, ARIA: '' }, veraHref);
  check('the roster is available', !r.error, r.error);
  if (r.error) return;
  const by = n => r.rows.find(x => x.name === n) || {};
  check('titled "Your assistants"', /Your assistants/.test(r.title), r.title);
  check('six rows, in order', JSON.stringify(r.rows.map(x => x.name)) === '["PIES","VERA","WILLA","TESS","HAILEY","ARIA"]', JSON.stringify(r.rows.map(x => x.name)));
  check('VERA with a blank row links to ' + veraHref, by('VERA').href === veraHref, by('VERA').href);
  check('WILLA links to the planner sheet', by('WILLA').href === WILLA, by('WILLA').href);
  check('TESS links to the job agent sheet', by('TESS').href === TESS, by('TESS').href);
  check('every link opens in a new tab with noopener', ['VERA', 'WILLA', 'TESS'].every(n => by(n).target === '_blank' && by(n).rel === 'noopener'));
  check('HAILEY links to its tracker', by('HAILEY').href === HAILEY_URL && by('HAILEY').target === '_blank', by('HAILEY').href);
  check('PIES and ARIA with blank rows are not links', ['PIES', 'ARIA'].every(n => by(n).href === ''));
  check('PIES says it lives in the work environment', /Lives in Ahmed’s work environment/.test(by('PIES').note) && /professional workflow/.test(by('PIES').text), by('PIES').note);
  check('ARIA: Not built yet, waiting on trip details', by('ARIA').state === 'Not built yet' && /trip details/.test(by('ARIA').note));
  check('the five built ones read Live, HAILEY included, with no waiting note', ['PIES', 'VERA', 'WILLA', 'TESS', 'HAILEY'].every(n => by(n).state === 'Live') && by('HAILEY').note === '');
  check('each row spells out the acronym and its job', /Work-optional Income & Lifestyle Longevity Analyzer/.test(by('WILLA').text) && /you submit applications yourself/.test(by('TESS').text));
  check('no sideways scroll', r.noScroll);

  r = await probe(page, { WILLA: '', TESS: '' }, veraHref);
  const by2 = n => r.rows.find(x => x.name === n) || {};
  check('a blank Config row: the name unlinked, with what to add',
        by2('WILLA').href === '' && /roster_link_willa/.test(by2('WILLA').note) && by2('TESS').href === '' && /roster_link_tess/.test(by2('TESS').note));
  const ALL = { PIES: 'https://pies.example.test/', VERA: 'https://dash.example.test/', WILLA, TESS, HAILEY: 'https://hailey.example.test/', ARIA: 'https://aria.example.test/' };
  r = await probe(page, ALL, veraHref);
  check('with every row filled, all six names are links to their rows', r.rows.length === 6 && r.rows.every(x => x.href === ALL[x.name] && x.target === '_blank' && x.rel === 'noopener'),
        JSON.stringify(r.rows.map(x => [x.name, x.href])));
  check('…and the notes still say where PIES lives and what ARIA waits on', /work environment/.test((r.rows.find(x => x.name === 'PIES') || {}).note) && /trip details/.test((r.rows.find(x => x.name === 'ARIA') || {}).note));
  r = await probe(page, undefined, veraHref);
  check('no status yet: still renders, VERA still linked', r.rows && r.rows.length === 6 && (r.rows.find(x => x.name === 'VERA') || {}).href === veraHref);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };
  const lite = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');
  for (const width of [390, 1280]) {
    console.log('\nfull dashboard @ ' + width + 'px');
    let page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    await assertPage(page, 'https://vera.test/index.html');
    await page.close();

    console.log('\ndashboard-lite @ ' + width + 'px');
    page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith('https://vera.test/')) return route.fulfill({ contentType: 'text/html', body: lite });
      for (const n of Object.keys(vendor)) if (url.includes(n)) return route.fulfill({ contentType: 'application/javascript', body: vendor[n] });
      return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
    });
    await page.addInitScript(() => { localStorage.setItem('vera_url', 'https://vera.test/exec'); localStorage.setItem('vera_token', 'test-token'); });
    await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
    await assertPage(page, './');
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
