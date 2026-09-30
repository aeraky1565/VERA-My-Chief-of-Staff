// Renders the REAL ImportantDatesView with the exact payload from the
// screenshot — raw ISO timestamps in Date, as the server used to send them —
// and asserts none of them reach the screen.
const { chromium } = require('playwright');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// Straight from the screenshot: fixed rows carrying ISO timestamps, plus the
// rule row that was already rendering correctly.
const DATES = [
  { ID:'d1', Date:'2026-09-19T04:00:00.000Z', Label:"Ryan's Birthday", Person:'Ryan', Recurring:'Yes',
    nextDate:'2026-09-19', daysUntil:0, isRule:false },
  { ID:'d2', Date:'3rd sun of sep', Label:'National Wife Day', Person:'Victoria', Recurring:'Yes',
    nextDate:'2026-09-20', daysUntil:1, isRule:true, 'Add to Calendar':'Yes' },
  { ID:'d3', Date:'2026-10-01T04:00:00.000Z', Label:"Allison's Birthday", Person:'Allison', Recurring:'Yes',
    nextDate:'2026-10-01', daysUntil:12, isRule:false },
  { ID:'d4', Date:'2026-11-08T05:00:00.000Z', Label:"Gabby's Birthday", Person:'Gabby', Recurring:'Yes',
    nextDate:'2026-11-08', daysUntil:50, isRule:false },
  // A row the backend could not resolve — nextDate absent. Must still not show ISO.
  { ID:'d5', Date:'2026-12-12T05:00:00.000Z', Label:"Haidy's Birthday", Person:'Haidy', Recurring:'Yes',
    nextDate:null, daysUntil:84, isRule:false },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  for (const width of [390, 1280]) {
    console.log('\nfull dashboard @ ' + width + 'px');
    const page = await browser.newPage({ viewport: { width, height: 1200 } });
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });

    const r = await page.evaluate(({ dates }) => {
      document.querySelectorAll('.modal-overlay, #dprobe').forEach(n => n.remove());
      if (typeof ImportantDatesView !== 'function') return { error: 'ImportantDatesView is not defined' };
      const host = document.createElement('div'); host.id='dprobe'; document.body.appendChild(host);
      const noop = () => {};
      ReactDOM.createRoot(host).render(React.createElement(ImportantDatesView, {
        dates, loading:false, busy:false, onAdd:noop, onDelete:noop, onUpdate:noop,
        onPreviewCalendar:noop, onImportCalendar:noop, calPreviews:[], calPreviewLoading:false,
      }));
      return new Promise(res => setTimeout(() => {
        // Open every person group so the by-person rows render too.
        [...host.querySelectorAll('span')].filter(e => e.textContent.trim() === '▸')
          .forEach(e => e.parentElement.parentElement.click());
        setTimeout(() => res({ text: host.innerText }), 200);
      }, 300));
    }, { dates: DATES });

    if (r.error) { fail++; console.log('  FAIL ' + r.error); await page.close(); continue; }

    check('NO ISO timestamp anywhere on screen', !/T\d{2}:\d{2}:\d{2}/.test(r.text),
          (r.text.match(/.*T\d{2}:\d{2}:\d{2}.*/) || [''])[0]);
    check('no trailing .000Z', !/\.000Z/.test(r.text), (r.text.match(/.*\.000Z.*/) || [''])[0]);
    check("Ryan's Birthday reads Sep 19, 2026", /Sep 19, 2026/.test(r.text), r.text.slice(0, 400));
    check('National Wife Day reads Sep 20, 2026', /Sep 20, 2026/.test(r.text), r.text.slice(0, 400));
    check("Allison's reads Oct 1, 2026", /Oct 1, 2026/.test(r.text), r.text.slice(0, 500));
    check("Gabby's reads Nov 8, 2026", /Nov 8, 2026/.test(r.text), r.text.slice(0, 600));
    check('a row with no nextDate still formats from its raw cell',
          /Dec 12, 2026/.test(r.text), r.text.slice(0, 900));
    check('the relative labels are untouched', /Today/.test(r.text) && /12 days/.test(r.text),
          r.text.slice(0, 300));
    check('the rule string itself is never shown', !/3rd sun of sep/.test(r.text), r.text.slice(0, 400));
    check('the calendar marker survives', /📅/.test(r.text));

    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
