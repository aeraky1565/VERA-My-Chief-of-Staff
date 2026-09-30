// Renders the REAL PTOPersonView inside the REAL docs/index.html and reads
// COMPUTED styles off the PTO Events rows, so the assertions are about what
// actually paints rather than about what the source string says.

const { chromium } = require('playwright');
const path = require('path');
const REPO = require('path').join(__dirname, '..', '..');   // this repo, wherever it happens to be checked out
const ROOT = process.env.VERA_ROOT || REPO;

const INDEX = 'file://' + path.resolve(ROOT + '/docs/index.html');

const GOLD_BG   = 'rgb(61, 46, 16)';
const GOLD_FG   = 'rgb(255, 213, 79)';
const BLUE_BG   = 'rgb(30, 48, 96)';
const BLUE_FG   = 'rgb(138, 176, 216)';
const AMT_GOLD  = 'rgb(201, 168, 76)';
const AMT_BLUE  = 'rgb(92, 158, 255)';

const STATS = {
  year: 2026,
  config: { vacationDays: 20, rolloverDays: 3, personalHours: 48, bufferDays: 3 },
  used:      { vacationDays: 9, personalHours: 41 },
  planned:   { vacationDays: 6, personalHours: 0 },
  remaining: { vacationDays: 8, personalHours: 7 },
  burnDown: { idealUsedToDate: 20.4, actualUsedToDate: 14.1, paceGap: -6.3, paceStatus: 'behind',
              projectedYearEnd: 20.1, projectedUnused: 8.9, dayOfYear: 260, totalDays: 365 },
  events: [
    { type:'Vacation',     label:'Vacation: Caribbean', startDate:'2026-11-09', endDate:'2026-11-13', weekdays:5, hours:null, status:'Planned' },
    { type:'PTO-Personal', label:'PTO',                 startDate:'2026-09-16', endDate:'2026-09-16', weekdays:1, hours:1,    status:'Used'    },
  ],
  holidays: [], clearWindows: [], milestones: [], upcomingTravel: [],
};

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  — ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1400 } });
    await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
    console.log('\n@' + width + 'px');

    const m = await page.evaluate((stats) => {
      document.querySelectorAll('.modal-overlay').forEach(n => n.remove());
      const host = document.createElement('div');
      host.id = 'probe';
      host.style.cssText = 'padding:14px 12px;max-width:960px';
      document.body.appendChild(host);
      ReactDOM.createRoot(host).render(React.createElement(PTOPersonView, { stats: stats, busy: false }));

      return new Promise(resolve => setTimeout(() => {
        // Find the PTO Events section by its title, then read its rows.
        const sections = [...document.querySelectorAll('#probe .pto-section')];
        const sec = sections.find(s => /PTO Events/i.test(
          (s.querySelector('.pto-section-title') || {}).textContent || ''));
        if (!sec) return resolve({ error: 'PTO Events section not found' });

        const rows = [...sec.querySelectorAll('.pto-row')];
        const read = row => {
          const pills = [...row.querySelectorAll('.pto-pill')];
          const statusPill = pills[0];
          const typePill   = pills[pills.length - 1];
          const spans = [...row.querySelectorAll('span')];
          const amt = spans.find(s => /^\d+(\.\d+)?(d|h)$/.test(s.textContent.trim()));
          return {
            type: typePill.textContent.trim(),
            typeBg: getComputedStyle(typePill).backgroundColor,
            typeFg: getComputedStyle(typePill).color,
            statusText: statusPill.textContent.trim(),
            statusBg: getComputedStyle(statusPill).backgroundColor,
            statusFg: getComputedStyle(statusPill).color,
            amtText: amt ? amt.textContent.trim() : null,
            amtColor: amt ? getComputedStyle(amt).color : null,
          };
        };
        resolve({ rows: rows.map(read) });
      }, 250));
    }, STATS);

    if (m.error) { check('PTO Events section renders', false, m.error); await page.close(); continue; }
    check('PTO Events section renders two rows', m.rows.length === 2, m.rows.length);

    const vac  = m.rows.find(r => r.type === 'Vacation');
    const pers = m.rows.find(r => r.type === 'Personal');
    check('a Vacation row and a Personal row are present', !!vac && !!pers);

    check('Vacation pill background is the GOLD pair', vac.typeBg === GOLD_BG, vac.typeBg);
    check('Vacation pill text is gold',                vac.typeFg === GOLD_FG, vac.typeFg);
    check('Personal pill background is the BLUE pair', pers.typeBg === BLUE_BG, pers.typeBg);
    check('Personal pill text is blue',                pers.typeFg === BLUE_FG, pers.typeFg);

    // The inversion the user reported must genuinely be gone.
    check('Vacation is NOT blue any more', vac.typeBg !== BLUE_BG && vac.typeFg !== BLUE_FG);
    check('Personal is NOT gold any more', pers.typeBg !== GOLD_BG && pers.typeFg !== GOLD_FG);

    check('Vacation amount reads in days and is gold',
          /d$/.test(vac.amtText) && vac.amtColor === AMT_GOLD, vac.amtText + ' ' + vac.amtColor);
    check('Personal amount reads in hours and is blue',
          /h$/.test(pers.amtText) && pers.amtColor === AMT_BLUE, pers.amtText + ' ' + pers.amtColor);

    // The status pill is a different axis and must not have moved.
    check('Planned status pill keeps its own colours',
          vac.statusText === 'Planned' && vac.statusBg === 'rgb(30, 48, 96)' && vac.statusFg === 'rgb(201, 217, 255)',
          vac.statusBg + ' / ' + vac.statusFg);
    check('Done status pill keeps its own colours',
          /Done/.test(pers.statusText) && pers.statusBg === 'rgb(15, 48, 32)' && pers.statusFg === 'rgb(105, 240, 174)',
          pers.statusBg + ' / ' + pers.statusFg);

    if (width === 390) {
      const sec = await page.evaluate(() => {
        const s = [...document.querySelectorAll('#probe .pto-section')]
          .find(x => /PTO Events/i.test((x.querySelector('.pto-section-title') || {}).textContent || ''));
        const r = s.getBoundingClientRect();
        return { y: r.y + window.scrollY, h: r.height };
      });
      await page.screenshot({
        path: require('path').join(require('os').tmpdir(), 'pto-pills-390.png'),
        clip: { x: 0, y: Math.max(0, sec.y - 6), width: 390, height: Math.min(300, sec.h + 12) },
      });
    }
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
