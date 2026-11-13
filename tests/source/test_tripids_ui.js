// System › Checks › Trip IDs (#239), in a browser: the panel drawn from app.js's own
// source over a stubbed apiGet, at phone and desktop widths. Invented trips.
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const APP = fs.readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
const LITE = fs.readFileSync(path.join(ROOT, 'docs/dashboard-lite.html'), 'utf8');
const IDX = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8');
const { chromium } = require('playwright');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
function fnSrc(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('){', start) + 1; j < src.length; j++) {   // past a destructured ({a,b}) parameter
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}
const varSrc = (src, name) => { const a = src.indexOf('var ' + name + '='); return src.slice(a, src.indexOf(';\n', a) + 1); };

console.log('\nwhere it lives');
check('System › Checks › Trip IDs, after Agent health', /\{id:'agent_health',label:'🤖 Agent health'\},\{id:'trip_ids',label:'🧳 Trip IDs'\}/.test(APP) && /cur==='trip_ids'&&h\(SysTripIds,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
check('…in the Checks group of both dashboards’ menus (the shared nav block)', /items:\['test','api_health','agent_health','trip_ids'\]/.test(APP) && /items:\['test','api_health','agent_health','trip_ids'\]/.test(LITE));
check('index.html is rebuilt with it', IDX.includes('function SysTripIds('));
check('it only reads: the one call is trip_id_check', (fnSrc(APP, 'SysTripIds').match(/action:'[a-z_]+'/g) || []).join() === "action:'trip_id_check'");

const TABS = ['Itinerary', 'TripMeta', 'PackingItems', 'Trip Budget', 'Trip Gifts', 'Trip Outfits', 'Packing Reviews', 'Leaving Home Runs', 'TripRecommendations', 'Trip Decisions'];
const tabsWith = (over) => TABS.map(t => Object.assign({ tab: t, rows: 12, withId: 12, blank: 0, filled: 0, mismatched: 0, mismatches: [], unresolved: [] }, (over || {})[t] || {}));
const STATES = {
  dirty: { ok: true, totals: { withId: 1282, blank: 1, mismatched: 2 }, cleanNow: false, cleanSince: '', cleanDays: 0, needDays: 7, ready: false,
    tabs: tabsWith({ Itinerary: { rows: 400, withId: 397, blank: 1, mismatched: 2,
      mismatches: [{ row: 14, key: '2027-04-09|Hold for Weekend Away', id: 'TRIP-AAAA00000001', keyIs: 'TRIP-BBBB00000002' }, { row: 15, key: '2027-04-09|Hold for Weekend Away', id: 'TRIP-AAAA00000001', keyIs: 'TRIP-BBBB00000002' }],
      unresolved: [{ row: 90, key: '2026-01-02|A very long trip name that someone typed by hand once and never again' }] } }) },
  waiting: { ok: true, totals: { withId: 1284, blank: 0, mismatched: 0 }, cleanNow: true, cleanSince: '2027-02-08', cleanDays: 3, needDays: 7, ready: false, tabs: tabsWith() },
  ready: { ok: true, totals: { withId: 1284, blank: 0, mismatched: 0 }, cleanNow: true, cleanSince: '2027-02-01', cleanDays: 9, needDays: 7, ready: true, tabs: tabsWith() },
  moved: { ok: true, totals: { withId: 1100, blank: 0, mismatched: 0 }, cleanNow: false, cleanSince: '', cleanDays: 0, needDays: 7, ready: false,
    tabs: tabsWith({ 'Trip Gifts': { skipped: 'column 11 is "Notes 2", not Trip ID' } }) },
  error: { ok: false, error: 'The trip tabs couldn’t be read: timeout' },
};

const PAGE = (state) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:16px;background:#070b14;color:#dde1f0;font-family:sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div>
<script src="file://${path.join(ROOT, 'docs/react.min.js')}"></script>
<script src="file://${path.join(ROOT, 'docs/react-dom.min.js')}"></script>
<script>
window.CALLS = [];
var STATE = ${JSON.stringify(STATES[state])};
function apiGet(u, t, p) { window.CALLS.push(p); return STATE.ok === false ? Promise.resolve(STATE) : Promise.resolve(JSON.parse(JSON.stringify(STATE))); }
${varSrc(APP, 'TID_TAB_NAMES')}
${fnSrc(APP, 'tidNice_')}
${fnSrc(APP, 'SysTripIds')}
ReactDOM.render(React.createElement(SysTripIds, { apiUrl: 'x', apiToken: 'y' }), document.getElementById('root'));
</script></body></html>`;

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of (process.env.VERA_CTL_FAST ? [390] : [390, 1280])   /* a control checks one width */) {
    console.log('\n@' + width);
    for (const state of Object.keys(STATES)) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tid-ui-'));
      fs.writeFileSync(path.join(dir, 'p.html'), PAGE(state));
      await page.goto('file://' + path.join(dir, 'p.html'));
      await page.waitForFunction(() => !document.querySelector('.loading-text'), null, { timeout: 5000 }).catch(() => {});
      const txt = await page.evaluate(() => document.body.innerText);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(state + ': no page errors, no sideways scroll', !errors.length && !sideways, errors.join('; ') + (sideways ? ' sideways' : ''));
      if (state === 'error') { check('error: says what failed', /couldn’t be read: timeout/.test(txt)); await page.close(); continue; }
      const counts = await page.$$eval('.tid-count-v', els => els.map(e => e.textContent));
      const pill = await page.$eval('.tid-pill', e => e.textContent).catch(() => '');
      if (state === 'dirty') {
        check('dirty: the three counts', counts.join('|') === '1,282|1|2', counts.join('|'));
        check('dirty: "Not yet", saying what blocks it', pill === 'Not yet' && /1 row without an ID and 2 mismatches/.test(txt), pill);
        const issues = await page.$$eval('.tid-issue', els => els.map(e => e.innerText));
        check('dirty: a card per listed row, named by tab and row', issues.length === 3 && /Itinerary · row 14/.test(issues[0]) && /now names TRIP-BBBB00000002/.test(issues[0]) && /names no trip/.test(issues[2]), JSON.stringify(issues));
        check('dirty: every trip tab in the table, by a name people know', (await page.$$('.tid-tabs tbody tr')).length === 10 && /Trip details/.test(txt) && /Leaving home/.test(txt));
        check('dirty: step 3 waits', /Writers look rows up by ID/.test(txt) && (await page.$$eval('.tid-done', e => e.length)) === 2);
        await page.click('.sys-health-refresh');
        await page.waitForTimeout(50);
        check('Count again reads again, and only reads', (await page.evaluate(() => window.CALLS.map(c => c.action).join())) === 'trip_id_check,trip_id_check');
      }
      if (state === 'waiting') check('waiting: since when, and how many of the 7 nights', pill === 'Waiting' && /Clean since Feb 8 \(3 of 7 nights\)/.test(txt) && !(await page.$('.tid-issue')), pill + ' ' + txt.slice(0, 200));
      if (state === 'ready') check('ready: says step 3 can go, after the dated copy', pill === 'Ready' && /Clean for 9 nights, since Feb 1/.test(txt) && /dated copy of the sheet/.test(txt));
      if (state === 'moved') check('a moved column: the tab says it was skipped, and it isn’t ready', pill === 'Not yet' && /Trip gifts skipped: column 11 is "Notes 2"/.test(txt) && /Skipped: column 11/.test(txt), txt.slice(0, 300));
      check(state + ': ARIA’s column is named as kept', /The Trip Key column stays on every tab/.test(txt));
      await page.close();
    }
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + e.message); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
