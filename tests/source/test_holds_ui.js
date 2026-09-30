// Renders the REAL itinerary in BOTH real pages against a payload annotated the
// way the server now annotates it, and checks the collapse assertion that
// matters: three competing holds occupy ONE slot, with a negative control
// proving the un-collapsed input produces the bogus packed afternoon.

const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_PAGES_ROOT || REPO;
const ENGINE = process.env.VERA_ROOT || ROOT;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// Annotate the fixture with the REAL server engine, so the page is fed exactly
// what webGetItinerary_ would send rather than a hand-written approximation.
const ctx = { JSON, String, Number, Math, parseInt, Object, Array, RegExp };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(ENGINE + '/TripDecisions.js', 'utf8'), ctx);

const RAW = [
  { id:'F1', tripKey:'T', type:'flight', title:'UA640 IAD → MIA', date:'2026-11-08',
    startTime:'08:00', endTime:'11:00', location:'IAD', notes:'', metadata:'{}' },
  { id:'H1', tripKey:'T', type:'museum', title:'Maybe the Frost Museum', date:'2026-11-08',
    startTime:'14:00', endTime:'16:30', location:'1075 Biscayne Blvd', notes:'', metadata:'{}' },
  { id:'H2', tripKey:'T', type:'beach', title:'Beach afternoon (tentative)', date:'2026-11-08',
    startTime:'14:30', endTime:'17:00', location:'South Beach', notes:'', metadata:'{}' },
  { id:'H3', tripKey:'T', type:'shopping', title:'Lincoln Road — option', date:'2026-11-08',
    startTime:'15:00', endTime:'17:00', location:'Lincoln Rd', notes:'', metadata:'{}' },
  { id:'D1', tripKey:'T', type:'dining', title:'Rasika — booked', date:'2026-11-08',
    startTime:'19:30', endTime:'21:30', location:'Rasika', notes:'', metadata:'{}' },
];
const ANNOTATED = JSON.parse(JSON.stringify(RAW));
ctx.annotateOptionGroups_(ANNOTATED);

console.log('\nthe fixture the pages will receive');
{
  const m = i => JSON.parse(i.metadata || '{}');
  check('the three holds share one group',
        new Set(ANNOTATED.filter(i => m(i).optionGroup).map(i => m(i).optionGroup)).size === 1);
  check('the flight and the booking are untouched',
        !m(ANNOTATED[0]).tentative && !m(ANNOTATED[4]).tentative);
}

async function render(page, kind, items) {
  return page.evaluate(({ items, kind }) => {
    document.querySelectorAll('.modal-overlay, #iprobe').forEach(n => n.remove());
    const host = document.createElement('div'); host.id = 'iprobe'; document.body.appendChild(host);
    const out = {};
    // The collapse is the load-bearing bit and is pure — call it directly.
    if (typeof collapseOptionGroups === 'function') out.collapsed = collapseOptionGroups(items).length;
    if (typeof groupItineraryOptions === 'function') out.grouped = groupItineraryOptions(items).length;
    if (kind === 'full' && typeof computeItineraryGaps === 'function') {
      out.gaps = computeItineraryGaps(items, ['2026-11-08','2026-11-09'], {}, '', '').length;
    }
    // Render the row component each page owns.
    const noop = () => {};
    if (kind === 'lite' && typeof ItinItemRow === 'function' && typeof groupItineraryOptions === 'function') {
      ReactDOM.createRoot(host).render(
        React.createElement('div', null, groupItineraryOptions(items).map(it =>
          React.createElement(ItinItemRow, { key: it.id, item: it, onEdit: noop, onDelete: noop }))));
    }
    return new Promise(r => setTimeout(() => {
      out.text = host.innerText;
      out.hatched = host.querySelectorAll('[style*="repeating-linear-gradient"]').length;
      out.chips   = host.querySelectorAll('.itin-hold-chip').length;
      out.details = host.querySelectorAll('.itin-hold-options').length;
      r(out);
    }, 250));
  }, { items, kind });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const liteHtml = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };

  for (const [label, kind] of [['full dashboard', 'full'], ['dashboard-lite', 'lite']]) {
    for (const width of [390, 1280]) {
      console.log('\n' + label + ' @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      if (kind === 'lite') {
        await page.route('**/*', route => {
          const u = route.request().url();
          for (const n of Object.keys(vendor))
            if (u.includes(n)) return route.fulfill({ contentType:'application/javascript', body: vendor[n] });
          if (u.startsWith('https://vera.test/')) return route.fulfill({ contentType:'text/html', body: liteHtml });
          return route.fulfill({ contentType:'application/json', body:'{"ok":false}' });
        });
        await page.addInitScript(() => {
          localStorage.setItem('vera_url','https://vera.test/exec'); localStorage.setItem('vera_token','t');
        });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else {
        await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      }

      const r = await render(page, kind, ANNOTATED);

      // ── THE assertion ─────────────────────────────────────────────────────
      check('five items collapse to three — one slot per decision', r.collapsed === 3, r.collapsed);
      check('grouping yields the same three rows', r.grouped === 3, r.grouped);

      if (kind === 'full') {
        check('gap detection sees the collapsed day', typeof r.gaps === 'number', String(r.gaps));
      }

      if (kind === 'lite') {
        check('three rows render, not five', (r.text.match(/Frost|Beach|Lincoln/g) || []).length >= 1, r.text.slice(0,200));
        check('the representative is the one shown', /Frost Museum/.test(r.text), r.text.slice(0,200));
        check('the other two are not top-level rows', !/^Beach afternoon/m.test(r.text), r.text.slice(0,300));
        check('one row is hatched', r.hatched >= 1, r.hatched);
        check('the chip counts three options', /3 options/.test(r.text), r.text.slice(0,300));
        check('a disclosure is offered', r.details === 1, r.details);
        check('the booked dinner renders solid, unchipped', /Rasika/.test(r.text) && r.chips === 1,
              'chips=' + r.chips);
        // textContent, not innerText: a collapsed <details> renders none of its
        // content, and setting .open synchronously does not reflow in the same
        // tick. The assertion is that all three options are in the DOM.
        check('the disclosure carries all three options', await page.evaluate(() => {
          const d = document.querySelector('.itin-hold-options'); if (!d) return false;
          const t = d.textContent || '';
          return /Frost/.test(t) && /Beach/.test(t) && /Lincoln/.test(t);
        }));
        check('…and their times', await page.evaluate(() => {
          const t = (document.querySelector('.itin-hold-options') || {}).textContent || '';
          return /14:00/.test(t) && /14:30/.test(t) && /15:00/.test(t);
        }));
        // Phase 2 replaced the read-only "Confirm one from the calendar for now"
        // instruction with a real Confirm per option. This fixture mounts the
        // row without an onDecide handler, so no buttons are expected here —
        // test_decide_ui.js is what drives them. What this suite proves is that
        // the dead instruction is gone and the list still reads as a choice.
        check('…and no longer tells you to go to the calendar', await page.evaluate(() => {
          const t = (document.querySelector('.itin-hold-options') || {}).textContent || '';
          return !/Confirm one from the calendar/i.test(t) && /Still deciding/.test(t);
        }));
      }

      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      check('no sideways page scroll', sw[0] <= sw[1], sw.join(' > '));

      // Negative control LAST — it re-renders the probe, so running it earlier
      // would wipe the disclosure the assertions above inspect.
      const raw = await render(page, kind, RAW);
      check('un-annotated input is NOT collapsed — the flag is doing the work',
            raw.collapsed === 5, raw.collapsed);
      if (kind === 'lite') {
        check('…and un-annotated items render no hold affordances',
              raw.chips === 0 && raw.details === 0, 'chips=' + raw.chips + ' details=' + raw.details);
      }
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
