// Renders the REAL PTOMonthlyChart inside the REAL docs/index.html, so both the
// component and the stylesheet under test are the shipped ones.

const { chromium } = require('playwright');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

const INDEX = 'file://' + path.resolve(ROOT + '/docs/index.html');

const STATS = {
  year: 2026,
  remaining: { vacationDays: 8, personalHours: 7 },
  events: [
    { type:'Vacation',     label:'Presidents week', startDate:'2026-02-16', endDate:'2026-02-20', weekdays:5, hours:null, status:'Used'    },
    { type:'Vacation',     label:'Long weekend',    startDate:'2026-05-22', endDate:'2026-05-22', weekdays:1, hours:null, status:'Used'    },
    { type:'Vacation',     label:'Summer',          startDate:'2026-07-06', endDate:'2026-07-08', weekdays:3, hours:null, status:'Used'    },
    { type:'Vacation',     label:'Caribbean',       startDate:'2026-11-06', endDate:'2026-11-13', weekdays:6, hours:null, status:'Planned' },
    { type:'PTO-Personal', label:'Dentist',         startDate:'2026-03-04', endDate:'2026-03-04', weekdays:1, hours:8,    status:'Used'    },
    { type:'PTO-Personal', label:'Half day',        startDate:'2026-09-09', endDate:'2026-09-09', weekdays:1, hours:4,    status:'Used'    },
  ],
};

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
    console.log('\n@' + width + 'px');

    // Mount the page's own PTOMonthlyChart with React from the page's own bundle.
    const mounted = await page.evaluate((stats) => {
      if (typeof PTOMonthlyChart !== 'function') return 'PTOMonthlyChart is not defined';
      // The app is unconfigured here, so it opens its settings modal and that
      // overlay swallows clicks. Nothing to do with this component — drop it.
      document.querySelectorAll('.modal-overlay').forEach(n => n.remove());
      const host = document.createElement('div');
      host.id = 'probe';
      host.style.cssText = 'padding:14px 12px;max-width:960px';
      document.body.appendChild(host);
      try { localStorage.setItem('vera_pto_monthly', '0'); } catch (e) {}
      ReactDOM.createRoot(host).render(React.createElement(PTOMonthlyChart, { stats: stats }));
      return 'ok';
    }, STATS);
    check('component exists and mounts', mounted === 'ok', mounted);
    await page.waitForSelector('#probe .pto-section-title');

    check('starts collapsed (default off)', await page.locator('#probe .pto-month-row').count() === 0);
    check('header shows the year', /2026 by month/i.test(await page.locator('#probe .pto-section-title').innerText()));

    await page.locator('#probe .pto-section-title').click();
    await page.waitForSelector('#probe .pto-month-row');

    const m = await page.evaluate(() => {
      const rows  = [...document.querySelectorAll('#probe .pto-month-row')];
      const probe = document.getElementById('probe');
      return {
        rowCount: rows.length,
        labels: rows.map(r => r.querySelector('.pto-month-label').textContent),
        vals:   rows.map(r => r.querySelector('.pto-month-val').textContent),
        segCounts: rows.map(r => r.querySelectorAll('.pto-month-seg').length),
        legend: document.querySelectorAll('#probe .pto-legend-key').length,
        foot: document.querySelector('#probe .pto-month-foot').textContent,
        footLines: [...document.querySelectorAll('#probe .pto-month-foot > span')].map(n => n.textContent),
        vacText: (document.querySelector('#probe .foot-vac') || {}).textContent,
        persText: (document.querySelector('#probe .foot-pers') || {}).textContent,
        persColor: (function () {
          const strong = document.querySelector('#probe .foot-pers strong');
          return strong ? getComputedStyle(strong).color : null;
        })(),
        vacColor: (function () {
          const strong = document.querySelector('#probe .foot-vac strong');
          return strong ? getComputedStyle(strong).color : null;
        })(),
        probeScrollW: probe.scrollWidth,
        probeClientW: probe.clientWidth,
        docScrollW: document.documentElement.scrollWidth,
        docClientW: document.documentElement.clientWidth,
        // Bars must never exceed their track.
        overflowing: rows.some(r => {
          const bar = r.querySelector('.pto-month-bar');
          return bar.scrollWidth > bar.clientWidth + 1;
        }),
        gridCount: document.querySelectorAll('#probe .pto-month-grid').length,
        // The grid must be the LAST child of the bar, i.e. painted over the fills.
        gridIsLast: rows.every(r => {
          const bar = r.querySelector('.pto-month-bar');
          return bar.lastElementChild && bar.lastElementChild.classList.contains('pto-month-grid');
        }),
        gridImage: (document.querySelector('#probe .pto-month-grid') || {}).style
                   ? document.querySelector('#probe .pto-month-grid').style.backgroundImage : '',
        legendText: document.querySelector('#probe .pto-legend').textContent,
        // Fill fractions, to prove the bars still measure value/scale.
        febFillPct: (function () {
          const bar = rows[1].querySelector('.pto-month-bar');
          const seg = rows[1].querySelector('.pto-month-seg');
          return seg ? (seg.getBoundingClientRect().width / bar.getBoundingClientRect().width) : null;
        })(),
      };
    });

    check('twelve month rows', m.rowCount === 12, m.rowCount);
    check('Jan..Dec in order', m.labels.join(',') === 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec', m.labels.join(','));
    check('four legend keys', m.legend === 4, m.legend);
    check('Feb reads 5d', m.vals[1] === '5d', m.vals[1]);
    check('Nov reads 6d', m.vals[10] === '6d', m.vals[10]);
    check('Mar reads 1d (8h personal)', m.vals[2] === '1d', m.vals[2]);
    check('Sep reads 0.5d (4h personal)', m.vals[8] === '0.5d', m.vals[8]);
    check('empty months show an em dash', m.vals[0] === '—' && m.vals[3] === '—', m.vals[0] + ' / ' + m.vals[3]);
    check('Mar draws exactly one segment', m.segCounts[2] === 1, m.segCounts[2]);
    check('no segment overflows its track', !m.overflowing);
    check('every row has a day grid', m.gridCount === 12, m.gridCount);
    check('grid paints above the fills', m.gridIsLast);
    check('legend states the cell value', /each cell = 1 day/.test(m.legendText), m.legendText);
    // Busiest month here is Nov at 6d, already whole, so the cell is 100/6.
    check('cell width is 100/6 at a 6-day scale',
          /16\.6667%|16\.6666%|calc\(16\.6667% - 1px\)/.test(m.gridImage.replace(/\s+/g,'')) ||
          m.gridImage.indexOf('16.6667') !== -1,
          m.gridImage.slice(0, 120));
    // Feb is 5d of a 6d scale -> 5/6 of the track.
    check('Feb fills 5/6 of the track', Math.abs(m.febFillPct - 5/6) < 0.01, m.febFillPct);
    check('footer has two lines, one per pool', m.footLines.length === 2, m.footLines.length);
    check('vacation line still reads 8 days unplaced', /8 days still unplaced/.test(m.vacText), m.vacText);
    check('vacation line keeps its months-left clause', /months left to place them/.test(m.vacText), m.vacText);
    check('vacation figure is gold', m.vacColor === 'rgb(201, 168, 76)', m.vacColor);
    check('personal line names 7 hrs', /7 hrs personal time/.test(m.persText), m.persText);
    check('personal line says unplaced', /still unplaced/.test(m.persText), m.persText);
    check('personal figure is blue', m.persColor === 'rgb(92, 158, 255)', m.persColor);
    check('personal line does NOT repeat the months-left clause',
          !/months left/.test(m.persText), m.persText);
    check('no sideways scroll', m.docScrollW <= m.docClientW && m.probeScrollW <= m.probeClientW,
          m.docScrollW + '/' + m.docClientW);

    // Toggle persistence
    const stored = await page.evaluate(() => localStorage.getItem('vera_pto_monthly'));
    check('expanding persists to localStorage', stored === '1', stored);
    await page.locator('#probe .pto-section-title').click();
    check('collapsing hides the rows', await page.locator('#probe .pto-month-row').count() === 0);
    check('collapsing persists too', await page.evaluate(() => localStorage.getItem('vera_pto_monthly')) === '0');

    if (width === 390) {
      await page.locator('#probe .pto-section-title').click();
      await page.waitForSelector('#probe .pto-month-row');
      const box = await page.locator('#probe').boundingBox();
      await page.screenshot({
        path: require('path').join(require('os').tmpdir(), 'pto-monthly-390.png'),
        clip: { x: 0, y: Math.max(0, box.y - 4), width: 390, height: Math.min(560, box.height + 8) },
      });
    }
    await page.close();
  }

  // ---- the scale -----------------------------------------------------------
  console.log('\nscale rounding and tick density');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
    await page.goto(INDEX, { waitUntil: 'domcontentloaded' });

    async function scaleFor(events) {
      return page.evaluate((evs) => {
        document.querySelectorAll('.modal-overlay, #probe3').forEach(n => n.remove());
        const host = document.createElement('div');
        host.id = 'probe3';
        document.body.appendChild(host);
        try { localStorage.setItem('vera_pto_monthly', '1'); } catch (e) {}
        ReactDOM.createRoot(host).render(React.createElement(PTOMonthlyChart, {
          stats: { year: 2026, remaining: { vacationDays: 0, personalHours: 0 }, events: evs },
        }));
        return new Promise(r => setTimeout(() => {
          const rows = [...document.querySelectorAll('#probe3 .pto-month-row')];
          const grid = document.querySelector('#probe3 .pto-month-grid');
          const busiest = rows.find(x => x.querySelector('.pto-month-seg'));
          const bar = busiest.querySelector('.pto-month-bar');
          const segs = [...busiest.querySelectorAll('.pto-month-seg')];
          const filled = segs.reduce((a, s) => a + s.getBoundingClientRect().width, 0);
          r({
            gridImage: grid.style.backgroundImage,
            legend: document.querySelector('#probe3 .pto-legend').textContent,
            busiestFillFraction: filled / bar.getBoundingClientRect().width,
          });
        }, 200));
      }, events);
    }

    // 5 vacation days + a 4h personal half-day in the same month = 5.5 raw.
    let r = await scaleFor([
      { type:'Vacation',     startDate:'2026-02-16', endDate:'2026-02-20', weekdays:5, status:'Used' },
      { type:'PTO-Personal', startDate:'2026-02-24', endDate:'2026-02-24', weekdays:1, hours:4, status:'Used' },
    ]);
    check('a 5.5d month rounds the scale up to 6', r.gridImage.indexOf('16.6667') !== -1,
          r.gridImage.slice(0, 120));
    check('so the busiest month no longer fills the whole track',
          Math.abs(r.busiestFillFraction - 5.5 / 6) < 0.02, r.busiestFillFraction);
    check('cell still reads 1 day', /each cell = 1 day/.test(r.legend), r.legend);

    // A whole-day busiest month keeps a clean divisor.
    r = await scaleFor([{ type:'Vacation', startDate:'2026-02-02', endDate:'2026-02-06', weekdays:5, status:'Used' }]);
    check('a 5d month scales to 5 and fills the track', Math.abs(r.busiestFillFraction - 1) < 0.02,
          r.busiestFillFraction);

    // Density valve: a month above 15 days steps to 5-day cells.
    r = await scaleFor([{ type:'Vacation', startDate:'2026-03-02', endDate:'2026-03-27', weekdays:20, status:'Used' }]);
    check('above 15 days the grid steps to 5-day cells', /each cell = 5 days/.test(r.legend), r.legend);
    check('...and the cell width follows (5/20 = 25%)', r.gridImage.indexOf('25%') !== -1,
          r.gridImage.slice(0, 120));

    await page.close();
  }

  // ---- footer states -------------------------------------------------------
  console.log('\nfooter states');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
    await page.goto(INDEX, { waitUntil: 'domcontentloaded' });

    async function footFor(stats) {
      return page.evaluate((st) => {
        document.querySelectorAll('.modal-overlay, #probe2').forEach(n => n.remove());
        const host = document.createElement('div');
        host.id = 'probe2';
        document.body.appendChild(host);
        try { localStorage.setItem('vera_pto_monthly', '1'); } catch (e) {}
        ReactDOM.createRoot(host).render(React.createElement(PTOMonthlyChart, { stats: st }));
        return new Promise(r => setTimeout(() => r({
          vac:  (document.querySelector('#probe2 .foot-vac')  || {}).textContent,
          pers: (document.querySelector('#probe2 .foot-pers') || {}).textContent,
        }), 200));
      }, stats);
    }

    let f = await footFor(Object.assign({}, STATS, { remaining: { vacationDays: 8, personalHours: 0 } }));
    check('personal at zero reads as all used or planned',
          /All personal time is used or planned/.test(f.pers), f.pers);
    check('...while the vacation line is unaffected', /8 days still unplaced/.test(f.vac), f.vac);

    f = await footFor(Object.assign({}, STATS, { remaining: { vacationDays: 0, personalHours: 7 } }));
    check('vacation at zero reads as every day used or planned',
          /Every vacation day is used or planned/.test(f.vac), f.vac);
    check('...while the personal line still reports 7 hrs', /7 hrs personal time/.test(f.pers), f.pers);

    // A year that is over: monthsLeft is 0, so both switch to "went unused".
    f = await footFor(Object.assign({}, STATS, { year: 2024, remaining: { vacationDays: 3, personalHours: 5 } }));
    check('past year: vacation says went unused', /went unused in 2024/.test(f.vac), f.vac);
    check('past year: personal says went unused', /5 hrs personal time went unused in 2024/.test(f.pers), f.pers);

    f = await footFor(Object.assign({}, STATS, { remaining: { vacationDays: 1, personalHours: 1 } }));
    check('singular day', /1 day still unplaced/.test(f.vac), f.vac);
    check('singular hr',  /1 hr personal time/.test(f.pers), f.pers);

    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
