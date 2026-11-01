// The "Changed flights" card, rendered for real: it says what moved, Update
// sends the calendar's values while keeping the row's own details (seat,
// confirmation), and Remove removes the stale row.
const { chromium } = require('playwright');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// Invented flight: the sheet says Oct 23, the calendar now says Oct 21.
const CHANGED = [{ reason: 'date',
  row: { id: 'ITIN-1', type: 'flight', title: 'Flight UA590', date: '2026-10-23', startTime: '18:00', endTime: '19:20',
         metadata: JSON.stringify({ flightNum: 'UA590', origin: 'BWI', dest: 'ORD', seat: '21C', confirmationNumber: 'ABC123' }) },
  by: { title: 'Flight to Chicago (UA 590)', date: '2026-10-21', startTime: '17:29', endTime: '18:49', flight: 'UA590',
        metadata: JSON.stringify({ origin: 'BWI', dest: 'ORD', startTz: 'America/New_York', endTz: 'America/Chicago' }) } }];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of [390, 1280]) {
    console.log('\nchanged flights @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(({ changed }) => {
      document.querySelectorAll('.modal-overlay, #cfprobe').forEach(n => n.remove());
      if (typeof ChangedFlightsCard !== 'function') return { error: 'ChangedFlightsCard is not defined' };
      window.__upd = []; window.__rem = [];
      const host = document.createElement('div'); host.id = 'cfprobe'; document.body.appendChild(host);
      ReactDOM.createRoot(host).render(React.createElement(ChangedFlightsCard, { changed, tripKey: '2026-10-21|Lake Trip', busy: false,
        onUpdate: p => window.__upd.push(p), onRemove: id => window.__rem.push(id) }));
      return new Promise(res => setTimeout(() => res({ ok: true }), 250));
    }, { changed: CHANGED });
    if (r.error) { fail++; console.log('  FAIL ' + r.error); await page.close(); continue; }

    const text = await page.evaluate(() => document.querySelector('.changed-flights').textContent);
    check('it says what moved, from what to what', /UA590 moved/.test(text) && /Oct 23 18:00/.test(text) && /Oct 21 17:29/.test(text), text);
    check('…and that the old row is still in the sheet', /old row is still in the sheet/.test(text), text);

    await page.click('.cf-update');
    const upd = await page.evaluate(() => window.__upd);
    const p = upd[0] || {};
    const meta = JSON.parse(p.metadata || '{}');
    check('Update sends the calendar\'s date and times', p.id === 'ITIN-1' && p.date === '2026-10-21' &&
          p.startTime === '17:29' && p.endTime === '18:49', JSON.stringify(p));
    check('…for the right trip', p.tripKey === '2026-10-21|Lake Trip', p.tripKey);
    check('…keeps the row\'s own seat and confirmation', meta.seat === '21C' && meta.confirmationNumber === 'ABC123', p.metadata);
    check('…and takes the calendar\'s airport zones', meta.endTz === 'America/Chicago', p.metadata);

    await page.click('.cf-remove');
    check('Remove removes that row', JSON.stringify(await page.evaluate(() => window.__rem)) === '["ITIN-1"]');

    const none = await page.evaluate(() => {
      const host = document.createElement('div'); document.body.appendChild(host);
      ReactDOM.createRoot(host).render(React.createElement(ChangedFlightsCard, { changed: [], tripKey: 'x', onUpdate: () => {}, onRemove: () => {} }));
      return new Promise(res => setTimeout(() => res(host.textContent), 150));
    });
    check('nothing changed, nothing shown', none === '', none);

    if (width === 390) check('no sideways scroll at phone width',
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
