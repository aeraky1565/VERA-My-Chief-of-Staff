// Family Planning › Trying › Cycle (Cycle.js): the stats, today's view (period with the mood
// words, fertile window and peak, before and after, late), the reminders (only while Trying,
// each once), the routes against an in-memory sheet, and the wiring. Invented dates.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const SRC = fs.readFileSync(path.join(ROOT, 'Cycle.js'), 'utf8');
const CODE = fs.readFileSync(path.join(ROOT, 'Code.js'), 'utf8');
const WEB = fs.readFileSync(path.join(ROOT, 'WebApp.js'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const HEAD = eval((CODE.match(/const CYCLE_LOG_HEADERS\s*=\s*(\[[^\]]*\])/) || [])[1]);

function ctx(o) {
  o = o || {};
  const rows = [HEAD].concat(o.rows || []);
  const sheet = { rows, getLastRow: () => rows.length,
    getRange: (r, c, n, w) => ({ getValues: () => rows.slice(r - 1, r - 1 + n).map(x => { const out = []; for (let i = 0; i < w; i++) out.push(x[c - 1 + i] === undefined ? '' : x[c - 1 + i]); return out; }),
      setValues: v => v.forEach((row, i) => row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; })) }),
    appendRow: r => rows.push(r.slice()), deleteRow: r => rows.splice(r - 1, 1) };
  const sent = [];
  const c = { String, Number, Object, Array, Date, JSON, Math, RegExp, isNaN, isFinite, Error, parseInt,
    TABS: { CYCLE_LOG: 'Cycle Log' }, CYCLE_LOG_HEADERS: HEAD,
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getScriptTimeZone: () => 'UTC' }, Utilities: { formatDate: () => o.today || '2027-02-11' },
    getSpreadsheet: () => ({}), ensureSheet: () => sheet,
    getConfigValues: () => o.cfg || {}, fpReadSettings_: () => ({ phase: o.phase || 'trying' }),
    wasRecentlySent_: k => (o.sentBefore || []).indexOf(k) !== -1, sendNudge_: (k, subj, text, notif) => sent.push({ k, subj, text, notif }) };
  vm.createContext(c); vm.runInContext(SRC, c); c.__rows = rows; c.__sent = sent;
  return c;
}

console.log('\nthe stats');
{
  const c = ctx();
  check('nothing logged: 28-day estimate, 5 period days', J(c.cyStats_([])) === J({ cycle: 28, min: null, max: null, period: 5, cycles: 0, estimated: true }));
  const log = [{ start: '2026-09-19', end: '2026-09-23' }, { start: '2026-10-16', end: '2026-10-19' }, { start: '2026-11-13', end: '2026-11-17' }, { start: '2026-12-14', end: '2026-12-19' }, { start: '2027-01-12' }, { start: '2027-02-10' }];
  const s = c.cyStats_(log.slice().reverse());
  check('average of the gaps, any order: 27,28,31,29,29 → 29; range 27–31', s.cycle === 29 && s.min === 27 && s.max === 31 && s.cycles === 5 && s.estimated === false, J(s));
  check('period length from logged ends: 5,4,5,6 → 5', s.period === 5);
  check('a missed month (a 58-day gap) still counts; a 70-day one doesn’t', c.cyStats_([{ start: '2027-01-01' }, { start: '2027-02-28' }]).cycle === 58 && c.cyStats_([{ start: '2027-01-01' }, { start: '2027-03-12' }]).cycle === 28);
  check('a double log 3 days apart is ignored as a gap', c.cyStats_([{ start: '2027-01-01' }, { start: '2027-01-04' }, { start: '2027-01-30' }]).cycle === 26);
  check('only the last 6 gaps count', c.cyStats_(Array.from({ length: 9 }, (_, i) => ({ start: new Date(Date.UTC(2026, 0, 1) + (i < 3 ? i * 40 : 80 + (i - 2) * 30) * 864e5).toISOString().slice(0, 10) }))).cycle === 30);
  check('one gap is still an estimate', c.cyStats_([{ start: '2027-01-01' }, { start: '2027-01-30' }]).estimated === true);
}

console.log('\nthe mood words');
{
  const c = ctx();
  const m = c.cyMood_('');
  check('the defaults: days 1–2 hardest, 3 better, 4–5 okay to good', m[1] === 'usually the hardest day' && m[2] === m[1] && m[3] === 'usually better' && m[5] === 'usually okay to good' && !m[6]);
  check('Config words win', c.cyMood_('1:rough|2:easier')[2] === 'easier');
}

console.log('\ntoday in the cycle');
{
  const c = ctx(), st = { cycle: 29, period: 5 }, mood = c.cyMood_('');
  const at = (today, last) => c.cyToday_(last || { start: '2027-02-10' }, st, today, mood);
  const p = at('2027-02-11');
  check('period day 2, with its mood words', p.phase === 'period' && p.day === 2 && p.mood === 'usually the hardest day');
  check('dates: next Mar 11, ovulation Feb 25, window Feb 20–26, peak Feb 24–25', p.next === '2027-03-11' && p.ovulation === '2027-02-25' && p.fertileStart === '2027-02-20' && p.fertileEnd === '2027-02-26' && p.peakStart === '2027-02-24' && p.peakEnd === '2027-02-25', J(p));
  check('a logged end ends the period early', at('2027-02-14', { start: '2027-02-10', end: '2027-02-12' }).phase === 'follicular');
  check('before the window: follicular', at('2027-02-16').phase === 'follicular');
  check('the window', at('2027-02-20').phase === 'fertile' && at('2027-02-26').phase === 'fertile' && at('2027-02-27').phase === 'luteal');
  check('the peak', at('2027-02-24').phase === 'peak' && at('2027-02-25').phase === 'peak');
  check('after the window: luteal, days to next counted', at('2027-03-04').phase === 'luteal' && at('2027-03-04').daysToNext === 7);
  check('the expected day itself isn’t late; the day after is', at('2027-03-11').phase === 'luteal' && at('2027-03-12').phase === 'late' && at('2027-03-14').lateBy === 3);
  check('nothing logged, or a future start, gives nothing', c.cyToday_(null, st, '2027-02-11', mood) === null && at('2027-02-01') === null);
}

console.log('\nthe reminders');
{
  const c = ctx(), st = { cycle: 29, period: 5 }, mood = c.cyMood_('');
  const v = d => c.cyToday_({ start: '2027-02-10' }, st, d, mood);
  const keys = (d, phase, cfg) => c.cyNotices_(v(d), phase || 'trying', d, Object.assign({ mood }, cfg || {})).map(n => n.key).join();
  check('nothing unless Trying', keys('2027-03-10', 'pregnant') === '' && keys('2027-02-21', 'plan') === '');
  check('due in 2 days (Config lead)', keys('2027-03-09') === 'cycle_due_2027-03-11' && keys('2027-03-08', 'trying', { cycle_due_lead_days: 3 }) === 'cycle_due_2027-03-11');
  check('the due note mentions day 1', /Day 1 is usually the hardest day/.test(c.cyNotices_(v('2027-03-09'), 'trying', '2027-03-09', { mood })[0].text));
  check('the fertile window starts, with its peak days', keys('2027-02-20') === 'cycle_fertile_2027-02-20' && /Peak Wed–Thu; ovulation estimated ~Thu Feb 25/.test(c.cyNotices_(v('2027-02-20'), 'trying', '2027-02-20', { mood })[0].text));
  check('the first peak day', keys('2027-02-24') === 'cycle_peak_2027-02-24');
  check('no reminders at all outside Trying', ['2027-02-20', '2027-02-24', '2027-03-09', '2027-03-16'].every(d => keys(d, 'plan') === ''));
  check('late at 5 days (Config), once', keys('2027-03-16') === 'cycle_late_2027-03-11' && keys('2027-03-17') === '' && keys('2027-03-14', 'trying', { cycle_late_days: 3 }) === 'cycle_late_2027-03-11');
  check('a quiet day sends nothing', keys('2027-02-16') === '');
  const s = ctx({ today: '2027-02-20', rows: [['CY-1', '2027-02-10', '', 'Victoria', '', ''], ['CY-0', '2027-01-12', '', 'Victoria', '', '']] });
  check('nightly: sends the due one to cycle_reminders, discreet subject', s.cySyncReminders_() === '1 reminder(s)' && s.__sent[0].notif === 'cycle_reminders' && s.__sent[0].subj === 'Cycle reminder' && s.__sent[0].k === 'cycle_fertile_2027-02-20');
  const again = ctx({ today: '2027-02-20', sentBefore: ['cycle_fertile_2027-02-20'], rows: [['CY-1', '2027-02-10', '', 'Victoria', '', ''], ['CY-0', '2027-01-12', '', 'Victoria', '', '']] });
  check('…and not twice', again.cySyncReminders_() === '0 reminder(s)' && again.__sent.length === 0);
  check('nightly: nothing when not Trying', ctx({ phase: 'plan', today: '2027-02-21', rows: [['CY-1', '2027-02-10', '', '', '', '']] }).cySyncReminders_() === 'not trying');
}

console.log('\nthe routes');
{
  const c = ctx({ today: '2027-02-11', rows: [['CY-0', new Date(2027, 0, 12), '', 'Victoria', '', '']] });
  let r = c.webCycleLog_({ start: '2027-02-10', by: 'Victoria' });
  check('log a start: a new row, who logged it', r.ok && !r.merged && c.__rows.length === 3 && c.__rows[2][1] === '2027-02-10' && c.__rows[2][3] === 'Victoria');
  r = c.webCycleLog_({ start: '2027-02-11', notes: 'light', by: 'Ahmed' });
  check('logged again within 10 days: the same period, updated', r.merged && c.__rows.length === 3 && c.__rows[2][1] === '2027-02-11' && c.__rows[2][5] === 'light' && c.__rows[2][3] === 'Ahmed');
  check('a future day or an end before the start is refused', c.webCycleLog_({ start: '2027-03-01' }).ok === false && c.webCycleLog_({ start: '2027-02-05', end: '2027-02-01' }).ok === false);
  r = c.webCycleEnd_({ by: 'Victoria' });
  check('end: the latest period ends today', r.ok && c.__rows[2][2] === '2027-02-11');
  const g = c.webCycleGet_();
  check('get: newest first, dates read from Date cells, the view and stats', g.log.map(x => x.start).join() === '2027-02-11,2027-01-12' && g.view.day === 1 && g.stats.cycle === 30 && g.phase === 'trying', J(g.log));
  c.webCycleEdit_({ id: g.log[0].id, start: '2027-02-10', end: '' });
  check('edit: change the start, clear the end', c.__rows[2][1] === '2027-02-10' && c.__rows[2][2] === '');
  c.webCycleDelete_({ id: 'CY-0' });
  check('delete', c.__rows.length === 2 && c.__rows[1][0] !== 'CY-0');
  check('unknown id', c.webCycleDelete_({ id: 'nope' }).ok === false);
}

console.log('\nthe wiring');
check('the sheet, its headers and the notification are declared', /CYCLE_LOG:\s*'Cycle Log'/.test(CODE) && HEAD.join() === 'ID,Start,End,Logged By,Logged At,Notes' && /\{ key: 'cycle_reminders',/.test(CODE));
check('the nightly step runs it', /nightlyStep_\(ctx, 'cySyncReminders_', cySyncReminders_\);/.test(CODE));
check('the routes', ["case 'cycle_get':             return jsonOut_(webCycleGet_());", "case 'cycle_log':                  return jsonOut_(webCycleLog_(body));", "case 'cycle_edit':                 return jsonOut_(webCycleEdit_(body));",
  "case 'cycle_end':                  return jsonOut_(webCycleEnd_(body));", "case 'cycle_delete':               return jsonOut_(webCycleDelete_(body));"].every(x => WEB.indexOf(x) !== -1));
check('it never writes a calendar or a flag', !/CalendarApp|upsertKeyedFlags_|TABS\.FLAGS/.test(SRC));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
