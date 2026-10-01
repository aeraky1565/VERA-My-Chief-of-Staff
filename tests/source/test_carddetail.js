// Renders each page's REAL CardDetailModal and asserts Credit Limit appears in
// both. The identical signature in the two files made it easy to assume parity;
// the full dashboard was in fact missing this line, so it is worth a render test
// rather than a grep.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;


const CARD = {
  id:'CC-1', cardName:'AMEX Gold', issuer:'American Express', last4:'1234',
  annualFee:325, creditLimit:15000, dueDay:15, owner:'Ahmed', authUser:'Victoria',
  active:'Yes', statementCredit:'', notes:'',
};
const CARD_NO_LIMIT = Object.assign({}, CARD, { id:'CC-2', cardName:'Sapphire', creditLimit:null });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

async function detailTextFor(page, card) {
  return page.evaluate((c) => {
    document.querySelectorAll('.modal-overlay, #dprobe').forEach(n => n.remove());
    if (typeof CardDetailModal !== 'function') return { error: 'CardDetailModal is not defined' };
    const host = document.createElement('div');
    host.id = 'dprobe';
    document.body.appendChild(host);
    const noop = () => {};
    ReactDOM.createRoot(host).render(React.createElement(CardDetailModal, {
      card: c, rewards: [], perks: [], busy: false,
      onClose: noop, onAddReward: noop, onDeleteReward: noop, onAddPerk: noop,
      onEditPerk: noop, onDeletePerk: noop, onTogglePerk: noop, onClearReview: noop,
      onSetPerkLastUsed: noop,
    }));
    return new Promise(r => setTimeout(() => r({ text: host.innerText }), 250));
  }, card);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  // --- full dashboard: plain file:// load -----------------------------------
  {
    console.log('\nfull dashboard (docs/index.html)');
    const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });

    let r = await detailTextFor(page, CARD);
    check('CardDetailModal is available', !r.error, r.error);
    check('shows the annual fee', /Annual Fee:\s*\$325/.test(r.text), (r.text || '').slice(0, 200));
    check('shows the credit limit, thousands-separated',
          /Credit Limit:\s*\$15,000/.test(r.text), (r.text || '').slice(0, 200));

    r = await detailTextFor(page, CARD_NO_LIMIT);
    check('omits the line entirely when unset', !/Credit Limit/.test(r.text),
          (r.text || '').slice(0, 200));
    await page.close();
  }

  // --- dashboard-lite: needs its vendor scripts served locally ---------------
  {
    console.log('\ndashboard-lite (docs/dashboard-lite.html)');
    const html = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');
    const vendor = {
      'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
      'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
      'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
    };
    const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith('https://vera.test/')) return route.fulfill({ contentType: 'text/html', body: html });
      for (const n of Object.keys(vendor)) {
        if (url.includes(n)) return route.fulfill({ contentType: 'application/javascript', body: vendor[n] });
      }
      return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
    });
    await page.addInitScript(() => {
      localStorage.setItem('vera_url', 'https://vera.test/exec');
      localStorage.setItem('vera_token', 'test-token');
    });
    await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });

    let r = await detailTextFor(page, CARD);
    check('CardDetailModal is available', !r.error, r.error);
    check('shows the annual fee', /Annual Fee:\s*\$325/.test(r.text), (r.text || '').slice(0, 200));
    check('shows the credit limit, thousands-separated',
          /Credit Limit:\s*\$15,000/.test(r.text), (r.text || '').slice(0, 200));

    r = await detailTextFor(page, CARD_NO_LIMIT);
    check('omits the line entirely when unset', !/Credit Limit/.test(r.text),
          (r.text || '').slice(0, 200));
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
