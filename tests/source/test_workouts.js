// Health › Fitness (Workouts.js, GymTracker.js, GymLogTab). Pins:
//  - a calendar event is a workout when its description says EXERCISE or its title starts with a
//    workout word (Run, Swim, Class, Yoga…), not "Run errands" or "Class reunion"; it gets a
//    "Did you go?" check-in and a Type, in new named columns;
//  - ＋ Workout logs one as attended, today unless a past day is given, minutes kept;
//  - the read sends type, minutes and the weekly target (4 by default);
//  - the screen: week dots, n of target, the streak, this month, Did you go?, ＋ Workout, recent.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const WK = read('Workouts.js'), GT = read('GymTracker.js'), WEB = read('WebApp.js'), APP = read('docs/app.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
function fnSrc(src, name) { const a = src.indexOf('function ' + name + '('); if (a === -1) throw new Error('not found: ' + name); let d = 0, j = src.indexOf('{', src.indexOf(')', a)); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); }
const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = isoOf(new Date()), ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d); };
const HDR = ['ID', 'Event Title', 'Event Date', 'Attended', 'Logged At'];
function sheetOf(rows) { let cols = Math.max(5, rows[0].length); const pad = r => { while (r.length < cols) r.push(''); return r; }; rows.forEach(pad);
  return { rows, getLastRow: () => rows.length, getMaxColumns: () => cols, insertColumnsAfter: (a, n) => { cols += n; rows.forEach(pad); },
    getRange: (r, c, nr, nc) => ({ getValues: () => Array.from({ length: nr || 1 }, (_, i) => Array.from({ length: nc || 1 }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
      setValues: v => v.forEach((row, i) => { while (rows.length < r + i) rows.push(pad([])); row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; }); }) }) }; }
function ctx(sheet, events, cfg) {
  const flags = [];
  const c = { String, Number, Math, JSON, Date, Object, parseInt, Logger: { log() {} }, flags, TABS: { GYM_LOG: 'G' }, GYM_LOG_HEADERS: HDR,
    getSpreadsheet: () => ({ getSheetByName: () => sheet }), getConfigValues: () => cfg || {}, veraLocked_: f => f(), writeFlags: f => flags.push.apply(flags, f), sendSlackLog_() {},
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: (d, tz, f) => f === 'HHmmss' ? '090000' : f === 'yyyy-MM-dd HH:mm' ? isoOf(d) + ' 09:00' : isoOf(d) },
    CalendarApp: { getAllCalendars: () => [{ getName: () => 'Me', getEvents: () => (events || []).map(e => ({ getTitle: () => e.title, getDescription: () => e.desc || '', getStartTime: () => e.start, getEndTime: () => e.end })) }] } };
  vm.createContext(c); vm.runInContext(WK + '\n' + GT + '\n' + fnSrc(WEB, 'webGetGymLog_'), c); return c;
}

console.log('\nwhat counts as a workout');
const C0 = ctx(sheetOf([HDR.slice()]));
check('workout titles, by type', J(['Run 5k', 'Morning swim', 'Yoga flow', 'Spin class', 'Class: HIIT', 'Gym', 'Bike ride', 'Leg day at the gym', 'Tennis with Sam'].map(t => C0.wkType_(t))) === J(['Run', 'Swim', 'Yoga', 'Class', 'Class', 'Gym', 'Ride', 'Gym', 'Sport']));
check('not errands, reunions or meetings', ['Run errands', 'Class reunion', 'Swim team meeting', 'Dentist', 'Dinner'].every(t => C0.wkType_(t) === ''));
check('EXERCISE in the description still counts', C0.wkIsWorkout_('Lunch break', 'EXERCISE block') && !C0.wkIsWorkout_('Lunch break', ''));
{
  const y = new Date(); y.setDate(y.getDate() - 1); const end = new Date(y.getTime() + 3600e3);
  const sh = sheetOf([HDR.slice()]);
  const c = ctx(sh, [{ title: 'Run 5k', start: y, end }, { title: 'Run errands', start: y, end }, { title: 'Strength', desc: 'EXERCISE', start: y, end }]);
  c.checkGymSessions_();
  check('the nightly scan logs calendar workouts with a Type, in named columns', sh.rows.length === 3 && sh.rows[0][5] === 'Type' && sh.rows[0][6] === 'Minutes' && sh.rows[1][5] === 'Run' && sh.rows[2][5] === 'Gym' && !sh.rows.some(r => r[1] === 'Run errands'), J(sh.rows));
  check('…each with a "Did you go?" check-in', c.flags.length === 2 && /^Did you go\? Run 5k/.test(c.flags[0].flag));
  c.backfillGymSessions_(30);
  check('the backfill uses the same rule and doesn’t duplicate', sh.rows.length === 3);
}

console.log('\n＋ Workout');
{
  const sh = sheetOf([HDR.slice()]);
  const c = ctx(sh, [], { fitness_weekly_target: '5' });
  let r = c.webWorkoutAdd_({ parameter: { type: 'Swim', minutes: '40' } });
  check('logged as attended, today, with type and minutes', r.ok && sh.rows[1][3] === 'Yes' && sh.rows[1][2] === TODAY && sh.rows[1][5] === 'Swim' && sh.rows[1][6] === 40, J(sh.rows[1]));
  r = c.webWorkoutAdd_({ parameter: { type: 'Run', minutes: 'lots', date: ago(2) } });
  check('…a past day, no minutes when they aren’t a number', sh.rows[2][2] === ago(2) && sh.rows[2][6] === '');
  c.webWorkoutAdd_({ parameter: { type: 'Run', date: '2999-01-01' } });
  check('…a future day becomes today', sh.rows[3][2] === TODAY);
  let threw = false; try { c.webWorkoutAdd_({ parameter: {} }); } catch (e) { threw = true; }
  check('…a type is required', threw);
  const got = c.webGetGymLog_();
  check('the read: type, minutes, the target', got.target === 5 && got.sessions[0].type === 'Swim' && got.sessions[0].minutes === 40 && ctx(sheetOf([HDR.slice()])).webGetGymLog_().target === 4);
  check('older rows without a type read one from the title', ctx(sheetOf([HDR.slice(), ['GYM-x', 'Yoga flow', '2026-11-01', 'Yes', '']])).getGymLog_()[0].type === 'Yoga');
}

console.log('\nthe week');
const U = { String, Number, Math, JSON, Date, RegExp, isNaN, Object, Array }; vm.createContext(U);
vm.runInContext(['wkIso_', 'wkMonday_', 'wkWeek_', 'wkStreak_', 'wkMonth_'].map(n => fnSrc(APP, n)).join('\n'), U);
const NOW = new Date(2026, 10, 18, 12);   // Wed Nov 18
const S = [['2026-11-16', 'Yes'], ['2026-11-17', 'Yes'], ['2026-11-17', 'Yes'], ['2026-11-18', 'No'],
  ['2026-11-09', 'Yes'], ['2026-11-10', 'Yes'], ['2026-11-12', 'Yes'], ['2026-11-14', 'Yes'],
  ['2026-11-02', 'Yes'], ['2026-11-04', 'Yes'], ['2026-11-06', 'Yes'], ['2026-11-07', 'Yes'], ['2026-10-26', 'Yes']].map((x, i) => ({ id: 's' + i, date: x[0], attended: x[1] }));
const W = U.wkWeek_(S, NOW);
check('this week’s dots: Mon–Sun, how many each day, today, later days', W.length === 7 && J(W.map(d => d.done)) === J([1, 2, 0, 0, 0, 0, 0]) && W[2].today && W[3].future && !W[1].future, J(W));
check('the streak: weeks in a row at the target, back from last week', U.wkStreak_(S, 4, NOW) === 2 && U.wkStreak_(S, 3, NOW) === 3 && U.wkStreak_(S, 5, NOW) === 0);
check('this month', U.wkMonth_(S, NOW) === 11);

const HAS_BROWSER = (() => { if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return true; try { return fs.existsSync(require('playwright').chromium.executablePath()); } catch (e) { return false; } })();
(async () => {
  if (!HAS_BROWSER) { console.log('\n(the screen: skipped, no browser here)\n\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const width of [390, 1280]) {
    console.log('\n@' + width);
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve(ROOT, 'docs/index.html'), { waitUntil: 'load' });
    await page.evaluate(({ sessions }) => {
      window.__ev = [];
      window.apiGet = (u, t, p) => { window.__ev.push(p); if (p.action === 'gym_log') return Promise.resolve({ ok: true, sessions: JSON.parse(JSON.stringify(sessions)), target: 3 });
        if (p.action === 'workout_add') return Promise.resolve({ ok: true, id: 'new', title: p.type, date: p.date || 'x', type: p.type, minutes: p.minutes ? +p.minutes : '' }); return Promise.resolve({ ok: true }); };
      document.body.innerHTML = '<div id="wk" style="padding:0 16px"></div>';
      ReactDOM.createRoot(document.getElementById('wk')).render(React.createElement(GymLogTab, { apiUrl: 'u', apiToken: 't' }));
    }, { sessions: [{ id: 'a', title: 'Gym', date: TODAY, attended: 'Yes', type: 'Gym' }, { id: 'b', title: 'Run 5k', date: ago(1), attended: '', type: 'Run' }, { id: 'c', title: 'Old swim', date: ago(40), attended: 'Yes', type: 'Swim', minutes: 30 }] });
    await page.waitForTimeout(250);
    check('n of the target this week, and the dots', /1 of 3 this week/.test(await page.$eval('#wk .wk-week', n => n.innerText)) && (await page.$$('#wk .wk-dot')).length === 7 && (await page.$$('#wk .wk-dot.on')).length === 1);
    check('Did you go? for a planned one that passed', !!(await page.$('#wk .wk-ask[data-workout="b"]')));
    await page.click('#wk .wk-ask[data-workout="b"] .wk-yes'); await page.waitForTimeout(40);
    check('✓ Went counts it', J((await page.evaluate(() => window.__ev)).pop()) === J({ action: 'gym_attend', id: 'b' }) && !(await page.$('#wk .wk-ask')));
    await page.click('#wk .wk-add-btn'); await page.click('#wk .wk-type >> text=Yoga'); await page.fill('#wk .wk-min', '45'); await page.click('#wk .wk-save'); await page.waitForTimeout(60);
    const ev = (await page.evaluate(() => window.__ev)).pop();
    check('＋ Workout: type and minutes', ev.action === 'workout_add' && ev.type === 'Yoga' && ev.minutes === '45' && /Yoga logged · 45 min/.test(await page.$eval('#wk', n => n.innerText)), J(ev));
    check('recent, newest first', (await page.$$eval('#wk .wk-row', ns => ns.map(n => n.dataset.workout))).slice(-1)[0] === 'c');
    check('no sideways scroll, no page errors', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) && !errs.length, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
