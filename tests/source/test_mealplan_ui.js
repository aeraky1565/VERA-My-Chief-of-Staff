// Drives the REAL meal planner in BOTH real pages.
//
// The three things asked for, asserted as behaviour rather than as markup: two weeks
// are on screen at once, the days already behind you are folded away, and a dinner can
// be picked up on one day and dropped on another — including into next week.
//
// Tap-to-move rather than HTML5 drag-and-drop, and the reason is this file's whole
// justification: `draggable` fires no events on touch, so the Chores pattern would do
// nothing at all on the phone this planner is read on. Both viewports run below, and
// the 390px one is the one that matters.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const REPO = require('path').join(__dirname, '..', '..');
const ROOT = process.env.VERA_PAGES_ROOT || REPO;

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

// The two Mondays, computed in Node so the browser's answers are checked against
// something, rather than against themselves.
const p2 = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const _today = new Date(); _today.setHours(0, 0, 0, 0);
const _dow = _today.getDay();
const _mon = new Date(_today); _mon.setDate(_today.getDate() + (_dow === 0 ? -6 : 1 - _dow));
const _next = new Date(_mon); _next.setDate(_mon.getDate() + 7);
const THIS_MONDAY = isoOf(_mon), NEXT_MONDAY = isoOf(_next);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const liteHtml = fs.readFileSync(path.resolve(ROOT, 'docs/dashboard-lite.html'), 'utf8');
  const vendor = {
    'react.production.min.js':     fs.readFileSync(path.resolve(ROOT, 'docs/react.min.js'), 'utf8'),
    'react-dom.production.min.js': fs.readFileSync(path.resolve(ROOT, 'docs/react-dom.min.js'), 'utf8'),
    'babel.min.js':                fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'), 'utf8'),
  };

  for (const [label, kind] of [['full dashboard', 'full'], ['dashboard-lite', 'lite']]) {
    for (const width of [390, 1280]) {
      console.log('\n' + label + ' @ ' + width + 'px');
      const page = await browser.newPage({ viewport: { width, height: 1400 } });
      if (kind === 'lite') {
        await page.route('**/*', r => {
          const u = r.request().url();
          for (const n of Object.keys(vendor)) {
            if (u.includes(n)) return r.fulfill({ contentType: 'application/javascript', body: vendor[n] });
          }
          if (u.startsWith('https://vera.test/')) return r.fulfill({ contentType: 'text/html', body: liteHtml });
          return r.fulfill({ contentType: 'application/json', body: '{"ok":false}' });
        });
        await page.addInitScript(() => {
          localStorage.setItem('vera_url', 'https://vera.test/exec');
          localStorage.setItem('vera_token', 't');
        });
        await page.goto('https://vera.test/dashboard-lite.html', { waitUntil: 'networkidle' });
      } else {
        await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'domcontentloaded' });
      }

      // Mount the real component over a stubbed apiGet that RECORDS. The fixture is
      // built against the browser's own today, because the component decides what is
      // past from the real clock — a hard-coded Monday would drift every week.
      const mounted = await page.evaluate(() => {
        document.querySelectorAll('#mprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'mprobe'; document.body.appendChild(host);

        const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const p2 = n => String(n).padStart(2, '0');
        const iso = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dow = today.getDay();
        const monday = new Date(today); monday.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow));
        const next = new Date(monday); next.setDate(monday.getDate() + 7);
        const dayOf = (ws, i) => { const d = new Date(ws + 'T00:00:00'); d.setDate(d.getDate() + i); return iso(d); };

        // Every day of this week has a dinner, so "how many are hidden" is decided by
        // the date and not by whether a row happens to exist.
        const week = (ws, names) => ({
          weekStart: ws,
          days: DAYS.map((day, i) => ({
            day, date: dayOf(ws, i), mealName: names[i] || '', type: names[i] ? 'Home Cooked' : '',
            status: 'Planned', notes: '',
          })),
        });
        const WS  = iso(monday), WS2 = iso(next);
        window.__fixture = {
          ok: true,
          weeks: [
            week(WS,  ['Chili','Soup','Tacos','Ramen','Pizza','Roast','Curry']),
            week(WS2, ['Pasta','', '', '', '', '', '']),
          ],
        };
        window.__calls = [];
        window.apiGet = function(url, token, params) {
          window.__calls.push(params);
          if (params.action === 'meal_plan') return Promise.resolve(window.__fixture);
          return Promise.resolve({ ok: true });
        };

        ReactDOM.createRoot(host).render(
          React.createElement(MealPlanSubTab, { apiUrl: 'https://vera.test/exec', apiToken: 't' }));

        return new Promise(r => setTimeout(() => r({
          weeks:    host.querySelectorAll('.mp-week').length,
          days:     host.querySelectorAll('.mp-day').length,
          toggles:  host.querySelectorAll('.mp-past-toggle').length,
          handles:  host.querySelectorAll('.mp-handle').length,
          text:     host.innerText,
          todayDow: dow,
        }), 400));
      });

      check('both weeks are drawn', mounted.weeks === 2, mounted.weeks);
      check('…labelled this week and next',
            /This week/.test(mounted.text) && /Next week/.test(mounted.text),
            mounted.text.slice(0, 120));

      // Monday is the only day with nothing behind it.
      const expectPast = mounted.todayDow === 1 ? 0 : (mounted.todayDow === 0 ? 6 : mounted.todayDow - 1);
      if (expectPast > 0) {
        check('the days already behind you are folded away',
              mounted.days === 14 - expectPast,
              mounted.days + ' day rows, expected ' + (14 - expectPast) +
              ' with ' + expectPast + ' earlier day(s) hidden');
        check('…behind a toggle that says how many', mounted.toggles === 1 &&
              new RegExp(expectPast + ' earlier day').test(mounted.text), mounted.text.slice(0, 200));

        const expanded = await page.evaluate(() => {
          document.querySelector('.mp-past-toggle').click();
          return new Promise(r => setTimeout(() => r(document.querySelectorAll('.mp-day').length), 200));
        });
        check('…and expands to the full fortnight', expanded === 14, expanded);
      } else {
        check('on a Monday there is nothing to fold away',
              mounted.days === 14 && mounted.toggles === 0, mounted.days);
      }

      // ---- pick up, drop ------------------------------------------------
      const moved = await page.evaluate(() => {
        const host = document.getElementById('mprobe');
        host.querySelector('.mp-handle').click();          // the first visible dinner
        return new Promise(r => setTimeout(() => r({
          bar:     !!host.querySelector('.mp-moving-bar'),
          barText: (host.querySelector('.mp-moving-bar') || {}).innerText || '',
          targets: host.querySelectorAll('.mp-target').length,
          sources: host.querySelectorAll('.mp-moving').length,
          handles: host.querySelectorAll('.mp-handle').length,
        }), 200));
      });
      check('picking a dinner up announces it', moved.bar && /Moving/.test(moved.barText), moved.barText);
      check('…marks exactly one row as the source', moved.sources === 1, moved.sources);
      // Exactly every other drawn day: 14 rows are on screen by now (the past days
      // were expanded above, or it is Monday and there were none), so 13 targets.
      check('…and every other day as a target', moved.targets === 13,
            moved.targets + ' target(s), expected 13 — both weeks have to be droppable, ' +
            'or "move it to next Tuesday" is impossible');
      check('…while the row buttons stand down', moved.handles === 0, moved.handles);

      // Drop it on the LAST day drawn — which is next week's Sunday, the furthest
      // target there is, and the one a single-week planner could never offer.
      const call = await page.evaluate(() => {
        const host = document.getElementById('mprobe');
        const days = host.querySelectorAll('.mp-day');
        days[days.length - 1].click();
        return new Promise(r => setTimeout(() => r(
          window.__calls.filter(c => c.action === 'move_meal').pop() || null), 250));
      });
      check('dropping sends a move', !!call, JSON.stringify(call));
      if (call) {
        check('…naming the day it came from', call.fromDay === 'Mon' || !!call.fromDay, JSON.stringify(call));
        check('…and the day it goes to', call.toDay === 'Sun', JSON.stringify(call));
        check('…across the week boundary',
              call.toWeekStart === NEXT_MONDAY && call.fromWeekStart === THIS_MONDAY,
              JSON.stringify(call) + ' — expected ' + THIS_MONDAY + ' → ' + NEXT_MONDAY +
              '; drawing two weeks is what makes this droppable at all');
      }
      const setMeals = await page.evaluate(() => window.__calls.filter(c => c.action === 'set_meal').length);
      check('a move is one atomic call, never a pair of set_meals', setMeals === 0,
            setMeals + ' set_meal call(s) — two round trips can half-fail and lose a dinner');

      // ---- the swap affordance -------------------------------------------
      const swapHint = await page.evaluate(() => {
        const host = document.getElementById('mprobe');
        const h = host.querySelector('.mp-handle');
        if (h) h.click();
        return new Promise(r => setTimeout(() => r(host.innerText), 200));
      });
      check('an occupied target says it will swap', /tap to swap/.test(swapHint),
            'dropping onto a day that already has a dinner trades them, and the row says so');

      // ---- cancel ---------------------------------------------------------
      const cancelled = await page.evaluate(() => {
        const host = document.getElementById('mprobe');
        const c = host.querySelector('.mp-cancel-move');
        if (c) c.click();
        return new Promise(r => setTimeout(() => r({
          bar: !!host.querySelector('.mp-moving-bar'),
          targets: host.querySelectorAll('.mp-target').length,
        }), 200));
      });
      check('cancelling puts it back down', !cancelled.bar && cancelled.targets === 0,
            JSON.stringify(cancelled));

      // ---- Suggest Week names its own week --------------------------------
      const suggested = await page.evaluate(() => {
        const host = document.getElementById('mprobe');
        const btns = host.querySelectorAll('.mp-suggest');
        btns[btns.length - 1].click();                     // next week's button
        return new Promise(r => setTimeout(() => r(
          window.__calls.filter(c => c.action === 'suggest_week').pop() || null), 250));
      });
      // Compared against the Monday computed HERE, not against the call's own value —
      // `call.weekStart === call.weekStart` would pass on the version that sends no
      // week at all, which is the bug: the backend then defaults to the current week
      // and the button silently fills the wrong one.
      check('Suggest Week on the second week asks for the SECOND week',
            !!suggested && suggested.weekStart === NEXT_MONDAY,
            JSON.stringify(suggested) + ' — expected weekStart ' + NEXT_MONDAY);

      // ---- the tab is REACHABLE ------------------------------------------
      //
      // Everything above drives MealPlanSubTab directly, which is exactly how the
      // sub-tab could go missing from dashboard-lite while every assertion stayed
      // green: a working planner behind a button nobody drew. So mount the real Home
      // Front tab, with the precise feature map that hid it — meal_planner false,
      // its two neighbours true — and look for the button.
      const row = await page.evaluate(({ kind }) => {
        document.querySelectorAll('#hfprobe').forEach(n => n.remove());
        const host = document.createElement('div'); host.id = 'hfprobe'; document.body.appendChild(host);
        // Reuses the two-week fixture built at the top of this page, so "the button
        // opens the planner" is checked against real weeks rather than against an
        // empty list that would render nothing and prove nothing.
        window.apiGet = (url, token, params) => Promise.resolve(
          params && params.action === 'meal_plan'
            ? window.__fixture
            : { ok: true, items: [], recipes: [], takeouts: [] });
        const features = { meal_planner: false, takeouts: true, pantry: true };
        const Tab = (kind === 'lite') ? HomeFrontLiteTab : HomeFrontTab;
        ReactDOM.createRoot(host).render(
          React.createElement(Tab, { apiUrl: 'https://vera.test/exec', apiToken: 't', features: features }));
        // Home Front opens on Household (House group); Meal Plan and its neighbours are in Kitchen.
        return new Promise(r => setTimeout(() => {
          const kitchen = Array.from(host.querySelectorAll('.hf-group')).find(b => b.textContent.indexOf('Kitchen') !== -1);
          if (kitchen) kitchen.click();
          setTimeout(() => {
            const labels = Array.from(host.querySelectorAll('.subtab-btn')).map(b => b.textContent);
            r({ labels: labels });
          }, 200);
        }, 500));
      }, { kind });

      const has = t => row.labels.some(l => l.indexOf(t) !== -1);
      check('Meal Plan is in the sub-tab row even with the flag off', has('Meal Plan'),
            JSON.stringify(row.labels) +
            ' — meal_planner:false used to delete it from this row silently');
      check('…and its flagged neighbours are still there', has('Takeouts') && has('Pantry'),
            JSON.stringify(row.labels) + ' — if these vanished the gate was removed from ' +
            'the filter rather than from the Meal Plan entry, which is a different change');

      // Reachable, not merely listed: the button has to open the planner.
      const opened = await page.evaluate(() => {
        const host = document.getElementById('hfprobe');
        const btn = Array.from(host.querySelectorAll('.subtab-btn'))
                         .find(b => b.textContent.indexOf('Meal Plan') !== -1);
        if (!btn) return null;
        btn.click();
        return new Promise(r => setTimeout(() => r(host.querySelectorAll('.mp-week').length), 600));
      });
      check('…and clicking it opens the two-week planner', opened === 2,
            opened + ' week section(s) — listed but not wired is the other way to fail this');

      await page.close();
    }
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
