// The suggestion, rendered in BOTH real pages at both widths.
//
// What matters here is as much what it does NOT do: it must not reorder the
// options, must not pre-select anything, and must vanish once a decision is
// made. A recommender that quietly rearranges the list is deciding for you
// while appearing not to.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT   = process.env.VERA_PAGES_ROOT || REPO;
const ENGINE = process.env.VERA_ROOT || ROOT;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// Fixtures built by the REAL engine, so the pages get exactly what the server
// would send.
function engine(decisionRows) {
  const HDRS = ['ID','Trip Key','Group Key','Slot Date','Status','Chosen Item ID','Snoozed Until','Decided At','Notes'];
  const sheet = {
    _rows: [HDRS].concat(decisionRows || []),
    getLastRow() { return this._rows.length; },
    getRange(r,c,nr,nc){ const self=this; return { getValues(){ const o=[];for(let i=0;i<nr;i++){const rr=[];for(let j=0;j<nc;j++)rr.push(self._rows[r-1+i]?(self._rows[r-1+i][c-1+j]!==undefined?self._rows[r-1+i][c-1+j]:''):'');o.push(rr);} return o; } }; },
  };
  const ctx = { TABS:{TRIP_DECISIONS:'Trip Decisions'}, TRIP_DECISION_HEADERS: HDRS,
    getSpreadsheet: () => ({ getSheetByName: () => sheet }),
    formatDateVal_: v => String(v || ''), Logger: { log(){} },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    isUsableTravelLocation_: l => !!l, departurePointOf_: i => i.location,
    travelLegKey_: (f,t,m) => f+'|'+t+'|'+m, loadTravelLegCache_: () => ({}),
    JSON, String, Number, Math, parseInt, Object, Array, RegExp, Date, isNaN };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ENGINE + '/TripDecisions.js','utf8'), ctx);
  return ctx;
}

// Museum (indoor) vs beach (outdoor) — the group weather can actually settle.
// The BEACH is first by start time, so it is the representative; the museum is
// the one that gets suggested. That asymmetry is deliberate: it proves the
// suggestion is not just "whatever is at the top".
const mk = () => ([
  { id:'B', tripKey:'T', type:'beach',  title:'Beach afternoon (tentative)', date:'2026-11-08',
    startTime:'14:00', endTime:'17:00', location:'South Beach', notes:'', metadata:'{}' },
  { id:'A', tripKey:'T', type:'museum', title:'Maybe the Frost Museum', date:'2026-11-08',
    startTime:'14:30', endTime:'16:30', location:'Biscayne', notes:'', metadata:'{}' },
]);

const E1 = engine([]);
const SUGGESTED = mk();
E1.annotateOptionGroups_(SUGGESTED);
E1.applyTripDecisions_(SUGGESTED, 'T', '2026-10-01');
E1.applyTripRecommendations_(SUGGESTED, { forecast: [{ date:'2026-11-08', precipMm:4, code:61 }] });

// Same group, glorious forecast — no suggestion at all.
const E2 = engine([]);
const NO_SUGGESTION = mk();
E2.annotateOptionGroups_(NO_SUGGESTION);
E2.applyTripDecisions_(NO_SUGGESTION, 'T', '2026-10-01');
E2.applyTripRecommendations_(NO_SUGGESTION, { forecast: [{ date:'2026-11-08', precipMm:0, code:1 }] });

// Decided, with a forecast that would otherwise suggest — must show nothing.
const E3 = engine([['TD-1','T','2026-11-08|14:00','2026-11-08','Decided','B','','2026-10-02','']]);
const DECIDED = mk();
E3.annotateOptionGroups_(DECIDED);
E3.applyTripDecisions_(DECIDED, 'T', '2026-10-01');
E3.applyTripRecommendations_(DECIDED, { forecast: [{ date:'2026-11-08', precipMm:4, code:61 }] });

async function mount(page, kind, items) {
  return page.evaluate(({ items, kind }) => {
    document.querySelectorAll('.modal-overlay, #sprobe').forEach(n => n.remove());
    const host = document.createElement('div'); host.id = 'sprobe'; document.body.appendChild(host);
    const grouped = groupItineraryOptions(items);
    if (kind === 'lite') {
      ReactDOM.createRoot(host).render(React.createElement('div', null, grouped.map(it =>
        React.createElement(ItinItemRow, { key:it.id, item:it, onEdit:()=>{}, onDelete:()=>{},
                                           onDecide:()=>{}, onReopen:()=>{} }))));
    } else {
      ReactDOM.createRoot(host).render(React.createElement('div', null,
        grouped.map(it => React.createElement('div', { key: it.id },
          it.title, itinOptionsChip(it), itinOptionsList(it, ()=>{}, ()=>{})))));
    }
    return new Promise(r => setTimeout(() => {
      // The option rows only — the reason line is a sibling div inside the same
      // container and would otherwise count as a third option.
      const rows = Array.from(host.querySelectorAll('.itin-hold-options > div > div'))
        .filter(d => !d.classList.contains('itin-suggested-why'));
      r({
        chips:   host.querySelectorAll('.itin-suggested-chip').length,
        why:     (host.querySelector('.itin-suggested-why') || {}).textContent || '',
        // Which option row carries the chip, and the order of the list.
        order:   rows.map(d => (d.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
        chipRow: rows.findIndex(d => d.querySelector('.itin-suggested-chip')),
        confirms: host.querySelectorAll('.itin-confirm-btn').length,
        checked: host.querySelectorAll('input:checked, [aria-selected="true"]').length,
        detailsText: (host.querySelector('.itin-hold-options') || {}).textContent || '',
      });
    }, 260));
  }, { items, kind });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const liteHtml = fs.readFileSync(path.resolve(ROOT,'docs/dashboard-lite.html'),'utf8');
  const vendor = {
    'react.production.min.js': fs.readFileSync(path.resolve(ROOT,'docs/react.min.js'),'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT,'docs/react-dom.min.js'),'utf8'),
    'babel.min.js': fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'),'utf8'),
  };

  for (const [label, kind] of [['full dashboard','full'], ['dashboard-lite','lite']]) {
    for (const width of [390, 1280]) {
      console.log('\n' + label + ' @ ' + width + 'px');
      const page = await browser.newPage({ viewport:{width,height:1000} });
      if (kind === 'lite') {
        await page.route('**/*', r => { const u=r.request().url();
          for (const n of Object.keys(vendor)) if (u.includes(n)) return r.fulfill({contentType:'application/javascript',body:vendor[n]});
          if (u.startsWith('https://vera.test/')) return r.fulfill({contentType:'text/html',body:liteHtml});
          return r.fulfill({contentType:'application/json',body:'{"ok":false}'}); });
        await page.addInitScript(()=>{localStorage.setItem('vera_url','https://vera.test/exec');localStorage.setItem('vera_token','t');});
        await page.goto('https://vera.test/dashboard-lite.html',{waitUntil:'networkidle'});
      } else {
        await page.goto('file://' + path.resolve(ROOT,'docs/index.html'), { waitUntil:'domcontentloaded' });
      }

      // ---- SUGGESTED ---------------------------------------------------
      let r = await mount(page, kind, SUGGESTED);
      check('exactly one option is marked', r.chips === 1, r.chips);
      check('the reason is shown',          /rain likely/.test(r.why), r.why);
      check('…prefixed with the star',      /★/.test(r.why), r.why);

      // The list is in TIME order, beach first. The suggestion is the museum,
      // second. If the chip is on row 0, something reordered the list.
      check('the options stay in time order',
            r.order.length === 2 && /Beach afternoon/.test(r.order[0]) && /Frost Museum/.test(r.order[1]),
            JSON.stringify(r.order));
      check('the chip is on the SECOND row, not the first', r.chipRow === 1, r.chipRow);
      check('both options are still confirmable', r.confirms === 2, r.confirms);
      check('nothing is pre-selected', r.checked === 0, r.checked);

      // ---- NO SUGGESTION -----------------------------------------------
      r = await mount(page, kind, NO_SUGGESTION);
      check('a fine day shows NO chip', r.chips === 0, r.chips);
      check('…and no reason line',      r.why === '', r.why);
      check('…but the options are still there', r.confirms === 2, r.confirms);

      // ---- DECIDED -------------------------------------------------------
      r = await mount(page, kind, DECIDED);
      check('a decided group shows no suggestion', r.chips === 0, r.chips);
      check('…and no reason line',                 r.why === '', r.why);
      check('…it reads as decided',                /Decided/.test(r.detailsText), r.detailsText.slice(0,80));

      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      check('no sideways page scroll', sw[0] <= sw[1], sw.join(' > '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
