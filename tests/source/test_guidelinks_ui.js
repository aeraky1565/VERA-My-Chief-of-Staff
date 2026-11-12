// Issue #236: the guides in docs/guides are reachable from both dashboards.
// Full dashboard: System › Reference › Guides lists every guide. Lite dashboard:
// a 📖 button in the header opens Victoria's guide, and the ⚙ box links both her
// guide and "VERA in 5 minutes". Every link is relative and opens in a new tab, and
// every target file exists. The screen part needs a browser and skips without one.
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const APP  = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
// The guide files themselves are never patched by a control, so look for them in the real repo.
const exists = href => fs.existsSync(path.join(REPO, 'docs', href));

const FULL = ['guides/VERA_in_5_Minutes.html', 'guides/VERA_Working_with_Assistants.html', 'guides/VERA_Quick_User_Guide.html',
  'guides/VERA_Quick_Reference.html', 'guides/VERA_Documentation.pdf'];

console.log('\nthe full dashboard');
{
  const block = (APP.match(/var VERA_GUIDES=\[[\s\S]*?\];/) || [''])[0];
  const hrefs = (block.match(/href:'([^']+)'/g) || []).map(s => s.slice(6, -1));
  check('System lists every guide', JSON.stringify(hrefs) === JSON.stringify(FULL), JSON.stringify(hrefs));
  check('…each one a file that exists', hrefs.length && hrefs.every(exists), hrefs.filter(h => !exists(h)).join(', '));
  check('…opening in a new tab', /h\("a",\{key:g\.href,className:"sys-guide",href:g\.href,target:'_blank',rel:'noopener'/.test(APP));
  check('Guides is a System sub-tab, in the Reference tiles', /\{id:'guides',label:'📘 Guides'\}/.test(APP) &&
        /\{id:'reference',label:'Reference',icon:'📖',items:\['assistants','documents','guides'\]\}/.test(APP));
  check('…and System shows it', /cur==='guides'&&h\(SysGuides,null\)/.test(APP));
  check('the built dashboard carries the same', INDEX.includes('var VERA_GUIDES=[') && INDEX.includes("cur==='guides'&&h(SysGuides,null)"));
}

console.log('\nthe lite dashboard');
{
  const header = (LITE.match(/<a\s+className="btn-settings lite-guide-link"[\s\S]*?<\/a>/) || [''])[0];
  check('a 📖 button in the header opens Victoria\'s guide in a new tab', /href="guides\/VERA_Lite_Guide\.html"/.test(header) &&
        /target="_blank"/.test(header) && /aria-label="How to use VERA"/.test(header), header.slice(0, 120));
  const box = (LITE.match(/<div className="form-group lite-guides">[\s\S]*?<\/div>\s*<\/div>/) || [''])[0];
  const hrefs = (box.match(/href="([^"]+)"/g) || []).map(s => s.slice(6, -1));
  check('the ⚙ box links her guide and VERA in 5 minutes', JSON.stringify(hrefs) === JSON.stringify(['guides/VERA_Lite_Guide.html', 'guides/VERA_in_5_Minutes.html']), JSON.stringify(hrefs));
  check('…both files exist', hrefs.length && hrefs.every(exists) && exists('guides/VERA_Lite_Guide.html'));
  check('every lite guide link is relative', !/href="(https?:)?\/\/[^"]*guides\//.test(LITE));
}

const HAS_BROWSER = (() => {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true;
  try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; }
})();

(async () => {
  if (!HAS_BROWSER) { console.log('\n(screen checks skipped: no browser here)'); }
  else {
    const { chromium } = require('playwright');
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    for (const width of [390, 1280]) {
      console.log('\nSystem › Guides @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      const r = await page.evaluate(() => new Promise(done => {
        const host = document.createElement('div'); host.id = 'gprobe'; document.body.appendChild(host);
        ReactDOM.createRoot(host).render(React.createElement(SystemTab, { apiUrl: 'x', apiToken: 't', sub: 'guides', status: {} }));
        setTimeout(() => {
          const links = Array.from(host.querySelectorAll('a.sys-guide'));
          done({ text: host.textContent, hrefs: links.map(a => a.getAttribute('href')), targets: links.map(a => a.target),
                 scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth });
        }, 250);
      }));
      check('the five guides show, in order', JSON.stringify(r.hrefs) === JSON.stringify(FULL), JSON.stringify(r.hrefs));
      check('…each opening in a new tab', r.targets.length === 5 && r.targets.every(t => t === '_blank'));
      check('…with a title and a line on what it is for', r.text.includes('VERA in 5 minutes') && r.text.includes('Start here'));
      check('no sideways scroll', r.scroll <= 1, r.scroll);
      check('no page errors', errors.length === 0, errors.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
