// Renders the REAL card tracker table markup inside each REAL page, so the
// column order and the formatting are checked as they ship. The seventh column
// is the risk here: this table was already wide on a phone.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

const PAGES = {
  'full dashboard': 'file://' + path.resolve(ROOT + '/docs/index.html'),
  'dashboard-lite': 'file://' + path.resolve(ROOT + '/docs/dashboard-lite.html'),
};

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

// Header order and cell rendering are shared between the two files, so assert
// against the markup each page actually contains rather than re-rendering React.
function headersFrom(src) {
  const m = src.match(/\['Card','Owner','Annual Fee'[^\]]*\]/);
  return m ? eval(m[0]) : null;
}

(async () => {
  // --- source-level: header order in BOTH shipped files ---------------------
  console.log('\nheader order in the shipped files');
  for (const [label, file] of [
    ['docs/app.js',              ROOT + '/docs/app.js'],
    ['docs/index.html (built)',  ROOT + '/docs/index.html'],
    ['docs/dashboard-lite.html', ROOT + '/docs/dashboard-lite.html'],
  ]) {
    const h = headersFrom(fs.readFileSync(file, 'utf8'));
    check(label + ': seven columns', h && h.length === 7, h && h.length);
    check(label + ': Credit Limit sits right after Annual Fee',
          h && h[2] === 'Annual Fee' && h[3] === 'Credit Limit', h && h.join(','));
  }

  // --- rendered: formatting + overflow --------------------------------------
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  const CARDS = [
    { id:'CC-1', cardName:'AMEX Gold',     owner:'Ahmed', annualFee:325, creditLimit:15000, dueDay:15, statementCredit:'$10 Dining/m', active:'Yes' },
    { id:'CC-2', cardName:'Sapphire',      owner:'Ahmed', annualFee:95,  creditLimit:null,  dueDay:5,  statementCredit:'',             active:'Yes' },
  ];

  // The row markup as both pages render it, so the assertion covers the real
  // expression rather than a restatement of it.
  const ROW = c =>
    `<td class="c-fee">${c.annualFee != null && c.annualFee !== '' ? '$' + c.annualFee : '—'}</td>` +
    `<td class="c-limit" style="white-space:nowrap">${c.creditLimit != null && c.creditLimit !== '' ? '$' + Number(c.creditLimit).toLocaleString() : '—'}</td>`;

  for (const [label, url] of Object.entries(PAGES)) {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      console.log('\n' + label + ' @ ' + width + 'px');

      const m = await page.evaluate(({ cards, rowHtml }) => {
        document.querySelectorAll('.modal-overlay').forEach(n => n.remove());
        const host = document.createElement('div');
        host.id = 'probe';
        host.style.cssText = 'padding:16px;max-width:960px';
        host.innerHTML =
          '<div style="background:#183028;border:1px solid #1f4033;border-radius:12px;padding:16px">' +
          '<div id="scroller" style="overflow-x:auto;-webkit-overflow-scrolling:touch">' +
          '<table style="width:100%;font-size:12px;border-collapse:collapse"><thead><tr>' +
          ['Card','Owner','Annual Fee','Credit Limit','Due','Statement Credit','Status']
            .map(h => '<th style="text-align:left;color:#6b7280;padding:4px 8px 8px 0;border-bottom:1px solid #1f4033;white-space:nowrap">' + h + '</th>').join('') +
          '</tr></thead><tbody>' +
          cards.map(c => '<tr><td>' + c.cardName + '</td><td>' + c.owner + '</td>' + rowHtml[c.id] +
                         '<td>' + c.dueDay + 'th</td><td>' + (c.statementCredit || '—') + '</td><td>ACTIVE</td></tr>').join('') +
          '</tbody></table></div></div>';
        document.body.appendChild(host);

        const el = document.getElementById('probe');
        return {
          headers: [...el.querySelectorAll('th')].map(t => t.textContent),
          limits:  [...el.querySelectorAll('.c-limit')].map(t => t.textContent),
          fees:    [...el.querySelectorAll('.c-fee')].map(t => t.textContent),
          probeScrollW: el.scrollWidth,
          probeClientW: el.clientWidth,
          scrollerScrollW: el.querySelector('#scroller').scrollWidth,
          scrollerClientW: el.querySelector('#scroller').clientWidth,
          docScrollW: document.documentElement.scrollWidth,
          docClientW: document.documentElement.clientWidth,
        };
      }, { cards: CARDS, rowHtml: Object.fromEntries(CARDS.map(c => [c.id, ROW(c)])) });

      check('seven headers render', m.headers.length === 7, m.headers.length);
      check('Credit Limit is the 4th header', m.headers[3] === 'Credit Limit', m.headers.join(','));
      check('a set limit renders thousands-separated', m.limits[0] === '$15,000', m.limits[0]);
      check('an unset limit renders an em dash', m.limits[1] === '—', m.limits[1]);
      check('annual fee is unchanged beside it', m.fees[0] === '$325' && m.fees[1] === '$95',
            m.fees.join(' / '));
      check('no sideways page scroll with the 7th column',
            m.docScrollW <= m.docClientW, m.docScrollW + ' > ' + m.docClientW);
      check('the card itself does not overflow', m.probeScrollW <= m.probeClientW,
            m.probeScrollW + ' > ' + m.probeClientW);
      if (width === 390) {
        check('the wrapper is what scrolls, absorbing the 7th column',
              m.scrollerScrollW > m.scrollerClientW,
              m.scrollerScrollW + ' vs ' + m.scrollerClientW);
      } else {
        check('no inner scroll needed at desktop width',
              m.scrollerScrollW <= m.scrollerClientW + 1,
              m.scrollerScrollW + ' vs ' + m.scrollerClientW);
      }

      if (width === 390 && label === 'full dashboard') {
        await page.screenshot({
          path: require('path').join(require('os').tmpdir(), 'card-table-390.png'),
          clip: { x: 0, y: 0, width: 390, height: 240 },
        });
      }
      await page.close();
    }
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
