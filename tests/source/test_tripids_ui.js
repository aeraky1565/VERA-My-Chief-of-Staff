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
check('System › Checks › Trip IDs, after Agent health and the Run log', /\{id:'agent_health',label:'🤖 Agent health'\},\{id:'run_log',label:'🗒️ Run log'\},\{id:'trip_ids',label:'🧳 Trip IDs'\}/.test(APP) && /cur==='trip_ids'&&h\(SysTripIds,\{apiUrl:apiUrl,apiToken:apiToken\}\)/.test(APP));
check('…in the Checks group of both dashboards’ menus (the shared nav block)', /items:\['test','api_health','agent_health','run_log','trip_ids'(,'script_props')?\]/.test(APP) && /items:\['test','api_health','agent_health','run_log','trip_ids'(,'script_props')?\]/.test(LITE));
check('index.html is rebuilt with it', IDX.includes('function SysTripIds('));
check('the panel reads two things: the count and the orphan list', (fnSrc(APP, 'SysTripIds').match(/action:'[a-z_]+'/g) || []).sort().join() === "action:'trip_id_check',action:'trip_orphans'");
check('the fixes post their own routes, with "how" (the route is "action")', /action:'trip_orphan_fix',key:o\.key,how:how,tripId:tid/.test(fnSrc(APP, 'TidOrphans')) && /action:'trip_meta_repair',dryRun:dry\?'yes':''/.test(fnSrc(APP, 'TidRepair')));
check('rows without an ID are no longer one card per row', !/kind:'blank'/.test(fnSrc(APP, 'SysTripIds')));

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
  meta: { ok: true, totals: { withId: 1000, blank: 409, mismatched: 0 }, cleanNow: false, cleanSince: '', cleanDays: 0, needDays: 7, ready: false,
    tabs: tabsWith({ TripMeta: { skipped: 'column 12 is "Trip Travellers", not Trip ID' }, PackingItems: { blank: 266 } }) },
  error: { ok: false, error: 'The trip tabs couldn’t be read: timeout' },
};
const LONG = '2026-01-02|A very long trip name that someone typed by hand once and never again';
const ORPHANS = { ok: true, canFix: true,
  trips: [{ tripId: 'TRIP-BBBB00000002', label: 'Harbor Week', startDate: '2026-03-18', endDate: '2026-03-24' }, { tripId: 'TRIP-CCCC00000003', label: 'Oslo', startDate: '2026-01-10', endDate: '2026-01-14' }],
  orphans: [
    { key: '2026-03-17|Harbor Week', startDate: '2026-03-17', label: 'Harbor Week', tabs: { Itinerary: 24, PackingItems: 261, TripRecommendations: 123 }, total: 408,
      suggestion: { tripId: 'TRIP-BBBB00000002', label: 'Harbor Week', startDate: '2026-03-18', endDate: '2026-03-24' } },
    { key: LONG, startDate: '2026-01-02', label: 'A very long trip name that someone typed by hand once and never again', tabs: { 'Trip Gifts': 1 }, total: 1, suggestion: null }] };

const PAGE = (state, opts) => { opts = opts || {}; return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:16px;background:#070b14;color:#dde1f0;font-family:sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div>
<script src="file://${path.join(ROOT, 'docs/react.min.js')}"></script>
<script src="file://${path.join(ROOT, 'docs/react-dom.min.js')}"></script>
<script>
window.CALLS = []; window.POSTS = []; window.CONFIRMS = []; window.SAY = ${JSON.stringify(opts.say || 'yes')};
var STATE = ${JSON.stringify(STATES[state])}, ORPH = ${JSON.stringify(opts.orphans || ORPHANS)}, REPLY = ${JSON.stringify(opts.reply || {})};
window.confirm = function(m) { window.CONFIRMS.push(m); return window.SAY === 'yes'; };
function apiGet(u, t, p) { window.CALLS.push(p); if (p.action === 'trip_orphans') return Promise.resolve(JSON.parse(JSON.stringify(ORPH))); return STATE.ok === false ? Promise.resolve(STATE) : Promise.resolve(JSON.parse(JSON.stringify(STATE))); }
function apiPost(u, t, b) { window.POSTS.push(b); var r = (b.how && REPLY[b.action + ':' + b.how]) || REPLY[b.action + (b.dryRun === 'yes' ? ':dry' : '')] || { ok: true, done: b.how, filled: 7 }; return Promise.resolve(JSON.parse(JSON.stringify(r))); }
${varSrc(APP, 'TID_TAB_NAMES')}
${varSrc(APP, 'TID_BTN')}
${fnSrc(APP, 'tidNice_')}
${fnSrc(APP, 'TidRepair')}
${fnSrc(APP, 'TidOrphans')}
${fnSrc(APP, 'SysTripIds')}
ReactDOM.render(React.createElement(SysTripIds, { apiUrl: 'x', apiToken: 'y' }), document.getElementById('root'));
</script></body></html>`; };

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
        check('dirty: a card per mismatched row, named by tab and row (no per-row cards for keys)', issues.length === 2 && /Itinerary · row 14/.test(issues[0]) && /now names TRIP-BBBB00000002/.test(issues[0]) && !/names no trip in the registry/.test(txt), JSON.stringify(issues));
        check('dirty: every trip tab in the table, by a name people know', (await page.$$('.tid-tabs tbody tr')).length === 10 && /Trip details/.test(txt) && /Leaving home/.test(txt));
        check('dirty: step 3 waits', /Writers look rows up by ID/.test(txt) && (await page.$$eval('.tid-done', e => e.length)) === 2);
        await page.click('.sys-health-refresh');
        await page.waitForTimeout(50);
        check('Count again reads again, and only reads', (await page.evaluate(() => window.CALLS.map(c => c.action).sort().join())) === 'trip_id_check,trip_id_check,trip_orphans,trip_orphans' && (await page.evaluate(() => window.POSTS.length)) === 0);
      }
      if (state === 'waiting') check('waiting: since when, and how many of the 7 nights', pill === 'Waiting' && /Clean since Feb 8 \(3 of 7 nights\)/.test(txt) && !(await page.$('.tid-issue')), pill + ' ' + txt.slice(0, 200));
      if (state === 'ready') check('ready: says step 3 can go, after the dated copy', pill === 'Ready' && /Clean for 9 nights, since Feb 1/.test(txt) && /dated copy of the sheet/.test(txt));
      if (state === 'meta') {
        check('meta: the repair card shows when Trip details is skipped', !!(await page.$('.tid-repair')) && /header row has drifted/.test(txt));
        check('meta: nothing to repair yet, just "Check the repair"', !!(await page.$('.tid-repair-check')) && !(await page.$('.tid-repair-go')));
      }
      if (state === 'moved') check('a moved column: the tab says it was skipped, and it isn’t ready', pill === 'Not yet' && /Trip gifts skipped: column 11 is "Notes 2"/.test(txt) && /Skipped: column 11/.test(txt), txt.slice(0, 300));
      if (state === 'dirty') {
        const cards = await page.$$eval('.tid-orphan', els => els.map(e => e.innerText));
        check('dirty: one card per key, biggest first, with its rows per tab', cards.length === 2 && /Mar 17 2026 · Harbor Week/.test(cards[0]) && /408 rows \(Itinerary 24, Packing items 261, Recommendations 123\)/.test(cards[0]), JSON.stringify(cards));
        check('dirty: VERA’s guess is shown, and the picker starts on it', /Looks like Harbor Week \(Mar 18\)/.test(cards[0]) && (await page.$eval('.tid-orphan .tid-orphan-pick', e => e.value)) === 'TRIP-BBBB00000002');
        check('dirty: a key with no guess starts on "Same trip as…"', (await page.$$eval('.tid-orphan-pick', els => els[1].value)) === '' && !/Looks like/.test(cards[1]));
        check('dirty: Merge, Register as a past trip and Leave on each', (await page.$$('.tid-orphan-merge')).length === 2 && (await page.$$('.tid-orphan-register')).length === 2 && (await page.$$('.tid-orphan-leave')).length === 2);
        check('dirty: no repair card while Trip details reads fine', !(await page.$('.tid-repair')));
        // Merge with no pick asks for one and posts nothing
        await page.click('.tid-orphan[data-key="' + LONG + '"] .tid-orphan-merge'); await page.waitForTimeout(30);
        check('Merge with no trip picked asks for one, posting nothing', (await page.evaluate(() => window.POSTS.length)) === 0 && /Pick the trip it’s the same as/.test(await page.evaluate(() => document.body.innerText)));
        // Merge the first: posts the suggestion
        await page.click('.tid-orphan .tid-orphan-merge'); await page.waitForTimeout(60);
        const p1 = await page.evaluate(() => window.POSTS[0]);
        check('Merge posts the key, how: merge, and the picked trip', p1 && p1.action === 'trip_orphan_fix' && p1.key === '2026-03-17|Harbor Week' && p1.how === 'merge' && p1.tripId === 'TRIP-BBBB00000002', JSON.stringify(p1));
        check('…then says what happened and counts again', /Merged into Harbor Week · 7 rows now have an ID/.test(await page.evaluate(() => document.body.innerText)) && (await page.evaluate(() => window.CALLS.length)) >= 4);
        // Register the second after a confirm
        await page.click('.tid-orphan[data-key="' + LONG + '"] .tid-orphan-register'); await page.waitForTimeout(60);
        const p2 = await page.evaluate(() => window.POSTS[1]);
        check('Register asks first, then posts how: register', (await page.evaluate(() => window.CONFIRMS.length)) === 1 && p2 && p2.how === 'register' && p2.key === LONG && p2.tripId === '', JSON.stringify(p2));
      }
      check(state + ': ARIA’s column is named as kept', /The Trip Key column stays on every tab/.test(txt));
      await page.close();
    }
  }
  const run = async (state, opts, width) => {
    const page = await browser.newPage({ viewport: { width: width || 390, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tid-ui-'));
    fs.writeFileSync(path.join(dir, 'p.html'), PAGE(state, opts));
    await page.goto('file://' + path.join(dir, 'p.html'));
    await page.waitForFunction(() => !document.querySelector('.loading-text'), null, { timeout: 5000 }).catch(() => {});
    page._errors = errors; return page;
  };
  console.log('\nthe Trip details repair');
  {
    const page = await run('meta', { reply: { 'trip_meta_repair:dry': { ok: true, dryRun: true, plan: { ok: true, why: '', moved: 4, cleared: 1, extraCols: 5 } },
      'trip_meta_repair': { ok: true, dryRun: false, plan: { ok: true, why: '', moved: 4, cleared: 1, extraCols: 5 }, filled: 38 } } });
    await page.click('.tid-repair-check'); await page.waitForTimeout(60);
    let posts = await page.evaluate(() => window.POSTS);
    check('Check the repair is a dry run', posts.length === 1 && posts[0].action === 'trip_meta_repair' && posts[0].dryRun === 'yes', JSON.stringify(posts));
    check('…and says what it would do, changing nothing yet', /It would move 4 values back to their column, clear 1 duplicate and remove 5 extra labels\. Nothing has changed yet\./.test(await page.$eval('.tid-repair-plan', e => e.innerText)));
    await page.evaluate(() => { window.SAY = 'no'; });
    await page.click('.tid-repair-go'); await page.waitForTimeout(40);
    check('Repair asks first; a no posts nothing', (await page.evaluate(() => window.CONFIRMS.length)) === 1 && (await page.evaluate(() => window.POSTS.length)) === 1);
    await page.evaluate(() => { window.SAY = 'yes'; });
    await page.click('.tid-repair-go'); await page.waitForTimeout(60);
    posts = await page.evaluate(() => window.POSTS);
    check('a yes repairs (no dry run)', posts.length === 2 && posts[1].dryRun === '', JSON.stringify(posts));
    check('…says what it did, and counts again', /Repaired: 4 values moved back, 1 duplicate cleared · 38 Trip IDs filled\./.test(await page.evaluate(() => document.body.innerText)) && (await page.evaluate(() => window.CALLS.length)) >= 4);
    check('no page errors', !page._errors.length, page._errors.join('; '));
    await page.close();
    const why = await run('meta', { reply: { 'trip_meta_repair:dry': { ok: true, dryRun: true, plan: { ok: false, why: 'row 9 has data in column 14, past Trip ID; nothing changed', moved: 0, cleared: 0, extraCols: 2 } } } });
    await why.click('.tid-repair-check'); await why.waitForTimeout(60);
    check('a repair that can’t run says why, with no Repair button', /Can’t repair: row 9 has data in column 14/.test(await why.evaluate(() => document.body.innerText)) && !(await why.$('.tid-repair-go')));
    await why.close();
  }
  console.log('\nrefusals, Leave, and anyone but the owner');
  {
    const page = await run('dirty', { reply: { trip_orphan_fix: { ok: false, error: 'Both trips have a different Context in Trip details. Make them match in the TripMeta tab, then merge again.' } } });
    await page.click('.tid-orphan .tid-orphan-merge'); await page.waitForTimeout(60);
    const t = await page.evaluate(() => document.body.innerText);
    check('a refused merge shows the reason, and the buttons stay', /different Context in Trip details/.test(t) && (await page.$$('.tid-orphan-merge')).length === 2);
    await page.click('.tid-orphan .tid-orphan-leave'); await page.waitForTimeout(30);
    check('Leave hides the card, posting nothing', (await page.$$('.tid-orphan')).length === 1 && (await page.evaluate(() => window.POSTS.length)) === 1);
    await page.selectOption('.tid-orphan .tid-orphan-pick', 'TRIP-CCCC00000003');
    await page.click('.tid-orphan .tid-orphan-merge'); await page.waitForTimeout(60);
    const p = await page.evaluate(() => window.POSTS[1]);
    check('a picked trip is what Merge posts', p && p.tripId === 'TRIP-CCCC00000003' && p.key === LONG, JSON.stringify(p));
    await page.close();
    const other = await run('meta', { orphans: Object.assign({}, ORPHANS, { canFix: false }) });
    const ot = await other.evaluate(() => document.body.innerText);
    check('anyone else sees the keys and the drift, without buttons', (await other.$$('.tid-orphan')).length === 2 && !(await other.$('.tid-orphan-merge')) && !(await other.$('.tid-repair-check')) && /Only the owner can merge or register them/.test(ot) && /Only the owner can repair it/.test(ot));
    await other.close();
    const none = await run('waiting', { orphans: { ok: true, canFix: true, trips: [], orphans: [] } });
    check('no orphans: no section', !(await none.$('.tid-orphans')));
    await none.close();
    console.log('\nolder trips with no ID, in the picker');
    for (const w of [390, 1280]) {
      const pg = await run('dirty', { reply: { 'trip_orphan_fix:register': { ok: true, done: 'register', tripId: 'TRIP-DDDD00000004', filled: 3 } } }, w);
      const groups = await pg.$$eval('.tid-orphan[data-key="' + LONG + '"] .tid-orphan-pick optgroup', gs => gs.map(g => [g.label, [...g.querySelectorAll('option')].map(o => o.value)]));
      check('@' + w + ' the picker: Registered, then Not registered yet with the other cards (not its own)', JSON.stringify(groups) === JSON.stringify([['Registered', ['TRIP-BBBB00000002', 'TRIP-CCCC00000003']], ['Not registered yet', ['key:2026-03-17|Harbor Week']]]), JSON.stringify(groups));
      await pg.selectOption('.tid-orphan[data-key="' + LONG + '"] .tid-orphan-pick', 'key:2026-03-17|Harbor Week');
      await pg.click('.tid-orphan[data-key="' + LONG + '"] .tid-orphan-merge'); await pg.waitForTimeout(80);
      const posts = await pg.evaluate(() => window.POSTS);
      check('@' + w + ' picking one registers it first, then merges this card into the ID it got', posts.length === 2 && posts[0].how === 'register' && posts[0].key === '2026-03-17|Harbor Week' && posts[1].how === 'merge' && posts[1].key === LONG && posts[1].tripId === 'TRIP-DDDD00000004', JSON.stringify(posts));
      check('@' + w + ' …after a confirm, and it says so', /as a past trip and merge this into it\?/.test((await pg.evaluate(() => window.CONFIRMS)).pop() || '') && /Registered “Harbor Week” as a past trip and merged this into it/.test(await pg.evaluate(() => document.body.innerText)));
      await pg.close();
    }
    {
      const pg = await run('dirty', { reply: { 'trip_orphan_fix:register': { ok: true, done: 'register', tripId: 'TRIP-DDDD00000004', filled: 3 }, 'trip_orphan_fix:merge': { ok: false, error: 'Both trips have a different Context' } } });
      await pg.selectOption('.tid-orphan[data-key="' + LONG + '"] .tid-orphan-pick', 'key:2026-03-17|Harbor Week');
      await pg.click('.tid-orphan[data-key="' + LONG + '"] .tid-orphan-merge'); await pg.waitForTimeout(80);
      check('a merge refused after the register says the other is registered and this one is left', /is registered now, but this didn’t merge: Both trips have a different Context/.test(await pg.evaluate(() => document.body.innerText)) && !!(await pg.$('.tid-orphan[data-key="' + LONG + '"] .tid-orphan-merge')));
      await pg.close();
    }
    const wide = await run('dirty', {}, 1280);
    check('desktop: the key cards fit with no sideways scroll', !(await wide.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) && (await wide.$$('.tid-orphan')).length === 2);
    await wide.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + e.message); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
