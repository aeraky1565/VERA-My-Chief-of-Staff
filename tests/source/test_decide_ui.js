// Drives the REAL disclosure in BOTH real pages: confirm sends the right
// payload, a decided group renders solid with the chosen plan, undo reopens.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_PAGES_ROOT || REPO;
const ENGINE = process.env.VERA_ROOT || ROOT;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// Build both fixtures with the REAL engine, so the pages get exactly what the
// server sends — open, and decided-on-the-latest-option.
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
    JSON, String, Number, Math, parseInt, Object, Array, RegExp, Date };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ENGINE + '/TripDecisions.js','utf8'), ctx);
  return ctx;
}
const mk = () => ([
  { id:'A', tripKey:'T', type:'museum',   title:'Maybe the Frost Museum', date:'2026-11-08', startTime:'14:00', endTime:'16:30', location:'Biscayne', notes:'', metadata:'{}' },
  { id:'B', tripKey:'T', type:'beach',    title:'Beach afternoon (tentative)', date:'2026-11-08', startTime:'14:30', endTime:'17:00', location:'South Beach', notes:'', metadata:'{}' },
  { id:'C', tripKey:'T', type:'shopping', title:'Lincoln Road — option', date:'2026-11-08', startTime:'15:00', endTime:'17:00', location:'Lincoln Rd', notes:'', metadata:'{}' },
]);
const E1 = engine([]);            const OPEN = mk();
E1.annotateOptionGroups_(OPEN);   E1.applyTripDecisions_(OPEN, 'T', '2026-10-01');
const E2 = engine([['TD-1','T','2026-11-08|14:00','2026-11-08','Decided','C','','2026-10-02','']]);
const DECIDED = mk();
E2.annotateOptionGroups_(DECIDED); E2.applyTripDecisions_(DECIDED, 'T', '2026-10-01');

// The overdue fixture. The server clamps decide-by to [today, slotDate], so a
// deadline that has slipped arrives at the client as TODAY, never as a past
// date — which is why the client predicate has to be <=. Built by asking the
// real engine for a payload whose decide-by is the browser's own today.
const nowT = new Date();
const TODAY = nowT.getFullYear() + '-' + String(nowT.getMonth()+1).padStart(2,'0') +
              '-' + String(nowT.getDate()).padStart(2,'0');
const OVERDUE = mk();
const E3 = engine([]);
E3.annotateOptionGroups_(OVERDUE);
// slotDate is 2026-11-08 and the museum wants slot-3, so any "today" at or past
// that pins decide-by to today. Pass the real today so the page agrees.
E3.applyTripDecisions_(OVERDUE, 'T', TODAY >= '2026-11-05' ? TODAY : '2026-11-05');
if (TODAY < '2026-11-05') {
  // Before the natural deadline, force the clamped case the server would
  // produce on the day itself: rewrite decide-by to today, as the clamp does.
  OVERDUE.forEach(it => {
    const m = JSON.parse(it.metadata || '{}');
    if (m.decideBy) { m.decideBy = TODAY; it.metadata = JSON.stringify(m); }
  });
}

async function mount(page, kind, items) {
  return page.evaluate(({ items, kind }) => {
    document.querySelectorAll('.modal-overlay, #dprobe').forEach(n => n.remove());
    window.__decided = null; window.__reopened = null;
    const host = document.createElement('div'); host.id='dprobe'; document.body.appendChild(host);
    const onDecide = o => { window.__decided = { id:o.id, title:o.title }; };
    const onReopen = r => { window.__reopened = { id:r.id }; };
    const grouped = groupItineraryOptions(items);
    if (kind === 'lite') {
      ReactDOM.createRoot(host).render(React.createElement('div', null, grouped.map(it =>
        React.createElement(ItinItemRow, { key:it.id, item:it, onEdit:()=>{}, onDelete:()=>{}, onDecide, onReopen }))));
    } else {
      // The full dashboard builds the disclosure through itinOptionsList.
      ReactDOM.createRoot(host).render(React.createElement('div', null,
        grouped.map(it => React.createElement('div', { key: it.id },
          it.title, itinOptionsChip(it), itinOptionsList(it, onDecide, onReopen)))));
    }
    return new Promise(r => setTimeout(() => r({
      text: host.innerText,
      detailsText: (host.querySelector('.itin-hold-options') || {}).textContent || '',
      chip: (host.querySelector('.itin-hold-chip') || {}).textContent || '',
      confirms: host.querySelectorAll('.itin-confirm-btn').length,
      undos: host.querySelectorAll('.itin-undo-btn').length,
      rows: grouped.length,
    }), 260));
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

      // ---- OPEN --------------------------------------------------------
      let r = await mount(page, kind, OPEN);
      check('one row for the group', r.rows === 1, r.rows);
      check('the chip counts three options', /3 options/i.test(r.chip), r.chip);
      check('the summary names a decide-by', /decide by/i.test(r.detailsText), r.detailsText.slice(0,120));
      check('every option offers Confirm', r.confirms === 3, r.confirms);
      check('no Undo while open', r.undos === 0, r.undos);

      // Guarded so the negative control (phase 1 pages, which have no Confirm)
      // reports what is missing instead of dying on an undefined .click().
      const d = await page.evaluate(() => {
        const b = document.querySelectorAll('.itin-confirm-btn')[2];
        if (!b) return null;
        b.click();
        return null;
      }).then(() => page.waitForTimeout(150)).then(() => page.evaluate(() => window.__decided));
      check('Confirm sends the option that was clicked', d && d.id === 'C', JSON.stringify(d));
      check('…identified by id, not by index', d && /Lincoln/.test(d.title), JSON.stringify(d));

      // ---- DECIDED -----------------------------------------------------
      r = await mount(page, kind, DECIDED);
      check('still one row', r.rows === 1, r.rows);
      check('the row is now the CHOSEN plan, not the earliest hold',
            /Lincoln Road/.test(r.text) && !/^Maybe the Frost/m.test(r.text), r.text.slice(0,160));
      check('no chip — it is a plan now, not a hold', r.chip === '', r.chip);
      check('the summary reads decided', /Decided/.test(r.detailsText), r.detailsText.slice(0,100));
      check('the chosen option is ticked', /✓/.test(r.detailsText), r.detailsText.slice(0,200));
      check('the others are still listed', /Frost/.test(r.detailsText) && /Beach/.test(r.detailsText),
            r.detailsText.slice(0,240));
      check('Confirm is gone', r.confirms === 0, r.confirms);
      check('Undo is offered', r.undos === 1, r.undos);

      const u = await page.evaluate(() => {
        const b = document.querySelector('.itin-undo-btn');
        if (b) b.click();
        return null;
      }).then(() => page.waitForTimeout(150)).then(() => page.evaluate(() => window.__reopened));
      check('Undo reopens the decision', u && u.id === 'C', JSON.stringify(u));

      // ---- OVERDUE -----------------------------------------------------
      // The state the old `decideBy < today` made unreachable: the clamp means
      // a slipped deadline is reported as today, so < was always false and the
      // amber chip could never render.
      r = await mount(page, kind, OVERDUE);
      check('an arrived deadline reads overdue', /overdue/i.test(r.detailsText), r.detailsText.slice(0,140));
      check('the chip says decide now', /decide now/i.test(r.chip), r.chip);
      check('…and it is amber, not the hold colour', await page.evaluate(() => {
        const c = document.querySelector('.itin-hold-chip');
        return c ? getComputedStyle(c).color : '';
      }).then(c => c === 'rgb(208, 138, 58)'), await page.evaluate(() => {
        const c = document.querySelector('.itin-hold-chip');
        return c ? getComputedStyle(c).color : '(no chip)';
      }));
      check('an overdue decision is still confirmable', r.confirms === 3, r.confirms);

      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      check('no sideways page scroll', sw[0] <= sw[1], sw.join(' > '));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
