// Mounts a modal into the REAL docs/index.html so it picks up the page's own
// stylesheet, and checks the two things that were broken: a tall modal can be
// scrolled at all, and both its top and its save button can actually be reached.
//
// Runs the same checks with the OLD rules forced back on, as a control — a test
// that also passes on the broken CSS would prove nothing.

const { chromium } = require('playwright');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

const PAGES = {
  'full dashboard': 'file://' + path.resolve(ROOT + '/docs/index.html'),
  'dashboard-lite': 'file://' + path.resolve(ROOT + '/docs/dashboard-lite.html'),
};

// Roughly the shape of AddItineraryItemModal: title, seven fields, actions.
function modalHtml(fieldCount) {
  let fields = '';
  for (let i = 0; i < fieldCount; i++) {
    fields += `<div style="margin-bottom:14px"><label style="display:block;font-size:12px;margin-bottom:4px">Field ${i + 1}</label>` +
              `<input style="width:100%;padding:8px;box-sizing:border-box"></div>`;
  }
  return `<div class="modal-overlay" id="ov"><div class="modal" id="box">
    <h2 id="box-title">Add Itinerary Item</h2>
    ${fields}
    <div class="modal-actions"><button id="cancel">Cancel</button><button id="save">Save</button></div>
  </div></div>`;
}

// The rules as they were before this change.
const OLD_CSS = `.modal-overlay{align-items:center!important;overflow-y:visible!important;padding:0!important}
                 .modal-overlay>*{margin-block:0!important}`;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

async function measure(page, fieldCount, oldCss) {
  return page.evaluate(({ html, oldCss }) => {
    document.querySelectorAll('#ov, #patch').forEach(n => n.remove());
    if (oldCss) {
      const st = document.createElement('style');
      st.id = 'patch'; st.textContent = oldCss;
      document.head.appendChild(st);
    }
    document.body.insertAdjacentHTML('beforeend', html);

    const ov = document.getElementById('ov');
    const box = document.getElementById('box');
    const save = document.getElementById('save');
    const title = document.getElementById('box-title');

    const scrollable = ov.scrollHeight > ov.clientHeight + 1;

    // Can the TOP of the modal be reached? Scroll the overlay fully up.
    ov.scrollTop = 0;
    const titleTopAtTop = title.getBoundingClientRect().top;

    // Can the SAVE button be reached? Scroll the overlay fully down.
    ov.scrollTop = ov.scrollHeight;
    const s = save.getBoundingClientRect();
    const saveReachable = s.top >= 0 && s.bottom <= window.innerHeight + 1;

    // Centring when it fits: top gap should roughly equal bottom gap.
    ov.scrollTop = 0;
    const b = box.getBoundingClientRect();
    const gapTop = b.top, gapBottom = window.innerHeight - b.bottom;

    return {
      scrollable,
      titleTopAtTop,
      saveReachable,
      saveTop: Math.round(s.top),
      saveBottom: Math.round(s.bottom),
      vh: window.innerHeight,
      gapTop: Math.round(gapTop),
      gapBottom: Math.round(gapBottom),
      boxH: Math.round(b.height),
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
    };
  }, { html: modalHtml(fieldCount), oldCss });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  for (const [label, url] of Object.entries(PAGES)) {
    for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
      const page = await browser.newPage({ viewport: vp });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      console.log('\n' + label + ' @ ' + vp.width + 'x' + vp.height);

      // --- tall modal: the reported case -----------------------------------
      const tall = await measure(page, 14, null);
      check('tall modal: overlay scrolls', tall.scrollable,
            'scrollHeight vs clientHeight');
      check('tall modal: top is reachable (not cut off above the scroll origin)',
            tall.titleTopAtTop >= -1, 'title top = ' + Math.round(tall.titleTopAtTop));
      check('tall modal: Save button is reachable',
            tall.saveReachable, 'save ' + tall.saveTop + '–' + tall.saveBottom + ' in ' + tall.vh);
      check('tall modal: no sideways scroll', tall.docScrollW <= tall.docClientW,
            tall.docScrollW + ' > ' + tall.docClientW);

      // --- short modal: centring must survive ------------------------------
      const short = await measure(page, 2, null);
      check('short modal: still vertically centred',
            Math.abs(short.gapTop - short.gapBottom) <= 2,
            'top ' + short.gapTop + ' vs bottom ' + short.gapBottom);
      check('short modal: Save visible without scrolling', short.saveReachable);

      // --- control: old rules forced back on -------------------------------
      const ctl = await measure(page, 14, OLD_CSS);
      const controlBroken = !ctl.saveReachable || ctl.titleTopAtTop < -1;
      check('CONTROL — old CSS genuinely fails this test', controlBroken,
            'save reachable=' + ctl.saveReachable + ', title top=' + Math.round(ctl.titleTopAtTop));

      await page.close();
    }
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
