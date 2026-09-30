// Renders each page's REAL CardsTab, fed the REAL seed data extracted from
// Code.js, and reads the cheat-sheet panel as it ships. The panel has no hotel
// logic in it — the split lives entirely in the data — so a source grep would
// prove nothing about what the user ends up seeing.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out

const ROOT  = process.env.VERA_ROOT || REPO;
const PAGES = process.env.VERA_PAGES_ROOT || ROOT;
const SRC  = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');

// --- pull the shipped seed arrays out of Code.js ----------------------------
function sliceTo(marker) {
  const start = SRC.indexOf(marker);
  if (start === -1) throw new Error('not found: ' + marker);
  const end = SRC.indexOf('\n  ];', start);
  const end2 = SRC.indexOf('\n  }));', start);
  const stop = (end === -1) ? end2 : (end2 === -1 ? end : Math.min(end, end2));
  return SRC.slice(start, SRC.indexOf(';', stop) + 1);
}
// Tolerant, so the same script can run against a pre-change tree as a control.
function constOf(name) {
  const m = SRC.match(new RegExp('^const ' + name + ' +=[\\s\\S]*?;$', 'm'));
  return m ? m[0] : '';
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  constOf('HOTELS_PREPAID_CATEGORY_') + '\n' +
  constOf('HOTELS_PAY_AT_CATEGORY_') + '\n' +
  constOf('HOTELS_PAY_AT_REWARDS_') + '\n' +
  sliceTo('var cardRows = [') + '\n' +
  sliceTo('var rewardRows = [') + '\n', ctx);

const CARDS = ctx.cardRows.map(r => ({
  id: r[0], cardName: r[1], issuer: r[2], last4: r[3], annualFee: r[4],
  dueDay: r[5], lastUsed: r[6], owner: r[7], authUser: r[8], active: r[9],
  statementCredit: r[10], notes: r[11], creditLimit: null,
}));
const REWARDS = ctx.rewardRows.map(r => ({
  id: r[0], cardName: r[1], category: r[2], rate: r[3], rateType: r[4], conditions: r[5],
}));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

// --- what the panel should say ---------------------------------------------
function assertPanel(label, rows) {
  const cats = rows.map(r => r.cat);
  check('no bare HOTELS row survives', cats.indexOf('Hotels') === -1, cats.join(' | '));

  const iPay = cats.indexOf('Hotels (Pay at Hotel)');
  const iPre = cats.indexOf('Hotels (Prepaid)');
  check('both hotel rows render', iPay !== -1 && iPre !== -1, cats.join(' | '));
  check('pay-at-hotel sits immediately above prepaid', iPay !== -1 && iPre === iPay + 1,
        'pay@' + iPay + ' prepaid@' + iPre);

  const pre = rows[iPre] || { lines: [], icon: '' };
  const pay = rows[iPay] || { lines: [], icon: '' };

  check('prepaid names Platinum 5x first',
        /^AMEX Platinum \(5 x points\)/.test(pre.lines[0] || ''), pre.lines[0]);
  check('prepaid names Gold 2x second',
        /^AMEX Gold \(2 x points\)/.test(pre.lines[1] || ''), pre.lines[1]);
  check('prepaid shows only two', pre.lines.length === 2, pre.lines.length);

  check('pay-at-hotel names IHG 10x first',
        /^IHG One Rewards Premier \(10 x points\)/.test(pay.lines[0] || ''), pay.lines[0]);
  check('pay-at-hotel names Costco 3% second',
        /^Costco Anywhere Visa \(3 % cashback\)/.test(pay.lines[1] || ''), pay.lines[1]);
  check('pay-at-hotel says it is paid at the hotel',
        /paid at the hotel/i.test(pay.lines[0] || ''), pay.lines[0]);
  check('neither advertises an Amex Travel rate at the desk',
        !/Amex Travel/i.test(pay.lines.join(' ')), pay.lines.join(' / '));

  check('prepaid carries the hotel icon, not the fallback', pre.icon === '🏨', pre.icon);
  check('pay-at-hotel carries the hotel icon, not the fallback', pay.icon === '🏨', pay.icon);

  // The 5x portal rates deliberately stay where they are.
  check('Chase Travel Portal still has its own row', cats.indexOf('Chase Travel Portal') !== -1,
        cats.join(' | '));
  check('Travel still has its own row', cats.indexOf('Travel') !== -1, cats.join(' | '));
}

// Reads the panel structurally: icon, category, and the card lines under it.
async function readPanel(page, cards, rewards) {
  return page.evaluate(({ cards, rewards }) => {
    document.querySelectorAll('.modal-overlay, #cprobe').forEach(n => n.remove());
    if (typeof CardsTab !== 'function') return { error: 'CardsTab is not defined' };

    // Serve the component's one fetch from the seed, without touching the page.
    const realFetch = window.fetch;
    window.fetch = (url, opts) => {
      if (String(url).indexOf('vera.test') !== -1 || String(url).indexOf('/exec') !== -1) {
        return Promise.resolve(new Response(
          JSON.stringify({ ok: true, cards, rewards, perks: [], programs: [], goals: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, opts);
    };

    const host = document.createElement('div');
    host.id = 'cprobe';
    document.body.appendChild(host);
    ReactDOM.createRoot(host).render(
      React.createElement(CardsTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));

    return new Promise(resolve => setTimeout(() => {
      // The cheat sheet is the panel headed "Quick-Reference Cheat Sheet".
      const heads = [...host.querySelectorAll('span')]
        .filter(s => s.textContent.indexOf('Quick-Reference Cheat Sheet') !== -1);
      if (!heads.length) return resolve({ error: 'cheat sheet panel not found' });
      const panel = heads[0].closest('div[style*="border-radius"]') || heads[0].parentElement.parentElement.parentElement;

      // Each category is a flex row: [icon div][text div[title, ...lines]].
      const rows = [...panel.children].slice(1).map(row => {
        const kids = [...row.children];
        if (kids.length < 2) return null;
        const body = [...kids[1].children].map(d => d.textContent);
        return { icon: kids[0].textContent.trim(), cat: body[0], lines: body.slice(1) };
      }).filter(Boolean);
      resolve({ rows });
    }, 600));
  }, { cards, rewards });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  const liteHtml = fs.readFileSync(path.join(PAGES, 'docs/dashboard-lite.html'), 'utf8');
  const fullHtml = fs.readFileSync(path.join(PAGES, 'docs/index.html'), 'utf8');
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.join(PAGES, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.join(PAGES, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };

  for (const [label, body, url] of [
    ['full dashboard (docs/index.html)',  fullHtml, 'https://vera.test/index.html'],
    ['dashboard-lite',                    liteHtml, 'https://vera.test/dashboard-lite.html'],
  ]) {
    console.log('\n' + label);
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.route('**/*', route => {
      const u = route.request().url();
      for (const n of Object.keys(vendor)) {
        if (u.includes(n)) return route.fulfill({ contentType: 'application/javascript', body: vendor[n] });
      }
      if (u.indexOf('/exec') !== -1) {
        return route.fulfill({ contentType: 'application/json',
          body: JSON.stringify({ ok: true, cards: CARDS, rewards: REWARDS, perks: [], programs: [], goals: [] }) });
      }
      if (u.startsWith('https://vera.test/')) return route.fulfill({ contentType: 'text/html', body });
      return route.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
    });
    await page.addInitScript(() => {
      localStorage.setItem('vera_url', 'https://vera.test/exec');
      localStorage.setItem('vera_token', 'test-token');
    });
    await page.goto(url, { waitUntil: 'networkidle' });

    const r = await readPanel(page, CARDS, REWARDS);
    if (r.error) { fail++; console.log('  FAIL ' + r.error); await page.close(); continue; }
    assertPanel(label, r.rows);
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
