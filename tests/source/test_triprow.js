// Renders the REAL docs/index.html in Chromium and mounts a trip card inside it,
// so the layout is measured against the page's own stylesheet rather than a
// transcription of it. A copied rule would only prove the copy works.

const { chromium } = require('playwright');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

const INDEX = 'file://' + path.resolve(ROOT + '/docs/index.html');

// The real card wrapper from TravelItineraryPanel — overflow:hidden included,
// because that is the thing doing the clipping.
const CARD = `
<div id="probe-card" style="margin-bottom:12px;border:1px solid #2a3a50;border-radius:10px;overflow:hidden">
  <div style="padding:14px 16px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="padding:3px 10px;border-radius:6px;font-size:11px;background:#1e2a3a">Anniversary Trip</span>
      <span style="font-size:13px">✈️ Flight ↔ ✈️ Flight</span>
      <div style="display:flex;gap:4px">
        <button style="padding:3px 10px;font-size:11px">Ahmed</button>
        <button style="padding:3px 10px;font-size:11px">Victoria</button>
        <button style="padding:3px 10px;font-size:11px">Both</button>
      </div>
      <div class="trip-actions">
        <button style="padding:5px 11px;font-size:13px">🧳 Packing</button>
        <button style="padding:5px 11px;font-size:13px">🗒 Agenda</button>
        <button style="padding:5px 11px;font-size:13px">🗺 Map</button>
        <button style="padding:5px 11px;font-size:13px">📋 Summary</button>
        <button style="padding:5px 11px;font-size:13px">🛂 Visa</button>
        <button style="padding:5px 14px;font-size:13px">+ Add Item</button>
      </div>
    </div>
  </div>
</div>`;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  for (const width of [390, 414, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(INDEX, { waitUntil: 'domcontentloaded' });

    // Confirm the page's own stylesheet actually defines the rule — if the build
    // ever dropped the <style> block this test must fail loudly, not silently
    // measure an unstyled div.
    const ruleFound = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const r of rules) {
          if (r.selectorText === '.trip-actions') return true;
          if (r.cssRules) for (const n of r.cssRules) if (n.selectorText === '.trip-actions') return true;
        }
      }
      return false;
    });
    if (width === 390) check('page stylesheet defines .trip-actions', ruleFound);

    const m = await page.evaluate((html) => {
      const host = document.createElement('div');
      // Mirror .main's real padding so the card gets the width it gets in situ.
      host.style.cssText = 'padding:14px 12px;max-width:960px';
      host.innerHTML = html;
      document.body.appendChild(host);

      const card = document.getElementById('probe-card');
      const grp  = card.querySelector('.trip-actions');
      const btns = Array.from(grp.children);
      const tops = [...new Set(btns.map(b => Math.round(b.getBoundingClientRect().top)))];
      const cardBox = card.getBoundingClientRect();

      return {
        cardScrollW: card.scrollWidth,
        cardClientW: card.clientWidth,
        docScrollW: document.documentElement.scrollWidth,
        docClientW: document.documentElement.clientWidth,
        rows: tops.length,
        // Every button must sit fully inside the card's painted box.
        allInside: btns.every(b => {
          const r = b.getBoundingClientRect();
          return r.left >= cardBox.left - 1 && r.right <= cardBox.right + 1;
        }),
        lastBtn: btns[btns.length - 1].textContent,
        lastRight: Math.round(btns[btns.length - 1].getBoundingClientRect().right),
        cardRight: Math.round(cardBox.right),
      };
    }, CARD);

    console.log('\n@' + width + 'px');
    check('card does not overflow itself', m.cardScrollW <= m.cardClientW,
          m.cardScrollW + ' > ' + m.cardClientW);
    check('page does not scroll sideways', m.docScrollW <= m.docClientW,
          m.docScrollW + ' > ' + m.docClientW);
    check('all six buttons inside the card', m.allInside,
          '"' + m.lastBtn + '" right=' + m.lastRight + ' cardRight=' + m.cardRight);
    check('"+ Add Item" is the last button and is reachable',
          m.lastBtn === '+ Add Item' && m.allInside);

    if (width <= 414) {
      check('wraps onto more than one row on a phone', m.rows > 1, 'rows=' + m.rows);
    } else {
      check('still a single row on desktop', m.rows === 1, 'rows=' + m.rows);
    }

    if (width === 390) {
      await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'trip-row-390.png'), clip: { x: 0, y: 0, width: 390, height: 260 } });
    }
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
