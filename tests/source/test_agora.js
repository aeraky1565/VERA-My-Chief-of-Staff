// AGORA, the teachers' lounge (Agora.js). Pins:
//  - the roster keeps coming-soon entries (no sheet or goal), fills the flag and countries from the
//    language, and only keeps https app links;
//  - the Practice tab: rows merged by date, theme kept, level from the latest row with one;
//  - the goal's target level from its title; the four moods (proud, today, dozing by target, waiting);
//  - this month; a trip within 45 days to one of her countries; today's free slot (20+ min, 6–22,
//    after now); the teacher practised least;
//  - agoraRead_: coming-soon teachers aren't read; a sheet that can't be read doesn't break the rest;
//  - the route is wired and owner-only; the nightly sync records what it did.
// Invented teachers (ALMA, KAI, NINA) and invented sheets.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const AG = read('Agora.js'), WEB = read('WebApp.js'), PL = read('PracticeLogs.js'), SET = read('Settings.js');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const day = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

function ctx(extra) {
  const c = Object.assign({ String, Number, Math, JSON, Date, Object, Array, isNaN, Logger: { log() {} },
    lfStr_: (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 200),
    lfYmd_: v => v instanceof Date ? v.toISOString().slice(0, 10) : (/^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : ''),
    lfDays_: day, lfToday_: () => '2026-11-25', plShift_: (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10) }, extra || {});
  vm.createContext(c); vm.runInContext(AG, c); return c;
}

console.log('\nthe roster');
{
  const c = ctx();
  const raw = J([{ name: 'ALMA', lang: 'French', app: 'https://alma.example/app', sheet: 'S1', goal: 'G1' }, { name: 'KAI', lang: 'German' }, { name: 'NINA', lang: 'Italian', app: 'javascript:alert(1)', sheet: 'S3', goal: 'G3', countries: ['Malta'] }]);
  const r = c.agTeachers_(raw);
  check('three teachers, the second coming soon', r.length === 3 && r[0].live && !r[1].live && r[2].live);
  check('flag and countries come from the language', r[0].flag === '🇫🇷' && r[0].countries.indexOf('Belgium') !== -1 && r[1].flag === '🇩🇪');
  check('her own countries win', J(r[2].countries) === J(['Malta']));
  check('only an https app link is kept', r[0].app === 'https://alma.example/app' && r[2].app === '');
  check('bad JSON is an empty roster', c.agTeachers_('{nope').length === 0);
}

console.log('\nher Practice tab');
{
  const c = ctx();
  const t = c.agRows_([['date', 'minutes', 'theme', 'level'], ['2026-11-24', 10, 'Les soldes', 'A2'], ['2026-11-24', 5, '', ''], ['2026-11-25', 20, 'Le passé', 'A2+'], ['2026-11-20', 15, '', 'A1']]);
  check('rows merged by date, oldest first, theme kept', J(t.rows.map(r => [r.date, r.minutes, r.theme])) === J([['2026-11-20', 15, ''], ['2026-11-24', 15, 'Les soldes'], ['2026-11-25', 20, 'Le passé']]));
  check('level from the latest row that has one', t.level === 'A2+');
  check('no level column: blank', c.agRows_([['date', 'minutes'], ['2026-11-25', 5]]).level === '');
  check('target level from the goal title', c.agTargetLevel_('Improve French fluency (>B1)') === 'B1' && c.agTargetLevel_('Improve German Understanding (=>A2)') === 'A2' && c.agTargetLevel_('Read more') === '');
  check('this month', J(c.agMonth_(t.rows, '2026-11-25')) === J({ lessons: 3, minutes: 50 }));
}

console.log('\nmoods');
{
  const c = ctx(), T = '2026-11-25';
  check('proud when the weekly target is met', c.agMood_({ thisWeek: 4, target: 4, lastDate: '2026-11-24' }, false, T) === 'proud');
  check('today when practised today', c.agMood_({ thisWeek: 1, target: 4, lastDate: T }, true, T) === 'today');
  check('dozing past what the target allows (4× → 2 days)', c.agMood_({ thisWeek: 0, target: 4, lastDate: '2026-11-22' }, false, T) === 'dozing' && c.agMood_({ thisWeek: 0, target: 4, lastDate: '2026-11-23' }, false, T) === 'waiting');
  check('…2× a week allows 4 days', c.agMood_({ thisWeek: 0, target: 2, lastDate: '2026-11-21' }, false, T) === 'waiting' && c.agMood_({ thisWeek: 0, target: 2, lastDate: '2026-11-20' }, false, T) === 'dozing');
  check('never practised: dozing', c.agMood_(null, false, T) === 'dozing');
}

console.log('\ntrips, free slot, least practised');
{
  const c = ctx(), T = '2026-11-25';
  const planned = [{ country: 'Italy', tripKey: '2027-01-02|Rome', label: 'Rome', startDate: '2027-01-02' }, { country: 'France', tripKey: '2027-03-01|Paris', label: 'Paris', startDate: '2027-03-01' }, { country: 'Belgium', tripKey: '2026-12-20|Brussels', label: 'Brussels', startDate: '2026-12-20' }];
  const fr = c.agTripFor_(['France', 'Belgium'], planned, T, 45);
  check('the nearest trip to one of her countries within 45 days', fr && fr.label === 'Brussels' && fr.days === 25, J(fr));
  check('…none past 45 days', c.agTripFor_(['France'], planned, T, 45) === null);
  check('…matching is case-blind', c.agTripFor_(['italy'], planned, T, 45).label === 'Rome');
  const busy = [{ start: T + 'T17:00:00', end: T + 'T18:30:00' }, { start: T + 'T18:40:00', end: T + 'T19:00:00' }];
  const s = c.agFreeToday_(busy, T, 16 * 60 + 50, 20, 360, 1320);
  check('the next 20+ min gap after now (a 10 min gap is skipped)', s && s.from === '19:00' && s.to === '22:00', J(s));
  check('…starts from now when free', c.agFreeToday_([], T, 9 * 60 + 2, 20, 360, 1320).from === '09:05');
  check('…none after 10 PM', c.agFreeToday_([], T, 21 * 60 + 50, 20, 360, 1320) === null);
  const who = c.agNeglected_([{ key: 'a', live: true, mood: 'waiting', thisWeek: 2, target: 4 }, { key: 'b', live: true, mood: 'dozing', thisWeek: 0, target: 3 }, { key: 'c', live: true, mood: 'today', thisWeek: 0, target: 3 }, { key: 'd', live: false }]);
  check('the least practised, not one done today, not coming soon', who && who.key === 'b');
}

console.log('\nreading the lounge');
{
  const values = { S1: [['date', 'minutes', 'theme', 'level'], ['2026-11-25', 20, 'Le passé', 'A2+']] };
  const c = ctx({
    veraSetting_: () => J([{ name: 'ALMA', lang: 'French', sheet: 'S1', goal: 'G1' }, { name: 'KAI', lang: 'German' }, { name: 'NINA', lang: 'Italian', sheet: 'BAD', goal: 'G3' }]),
    lgGoals_: () => [{ id: 'G1', title: 'Improve French fluency (>B1)', perWeek: 4, focus: 'now' }, { id: 'G3', title: 'Italian', perWeek: 3, focus: 'waiting' }],
    lgHabitLog_: () => [], lgLogsByGoal_: () => ({ G1: [], G3: [] }),
    lgPractice_: (e, per) => ({ weeks: [{ count: 0 }], thisWeek: 0, target: per, lastDate: '', practisedToday: false }),
    plPlanned_: () => [], lgEvents_: () => [], veraStoreGet_: () => J({ at: 'x', sources: 2, logged: 1, failed: 1 }),
    Utilities: { formatDate: (d, tz, f) => f === 'H' ? '9' : '0' }, Session: { getScriptTimeZone: () => 'UTC' },
    SpreadsheetApp: { openById: id => { if (!values[id]) throw new Error('no access'); return { getSheetByName: () => ({ getDataRange: () => ({ getValues: () => values[id] }) }) }; } },
  });
  let r; try { r = c.agoraRead_(); } catch (e) { r = { ok: false, teachers: [{}, {}, {}], crashed: e.message }; }
  const a = r.teachers[0], k = r.teachers[1], n = r.teachers[2];
  check('a live teacher: practised today from her tab, theme, level, target level', a.practisedToday && a.mood === 'today' && a.theme === 'Le passé' && a.level === 'A2+' && a.targetLevel === 'B1', J(a));
  check('coming soon: not read, no practice fields', k.live === false && k.mood === undefined);
  check('an unreadable sheet is marked, the rest still work', n.unread === true && r.ok);
  check('the free slot is for the least practised live teacher', r.slot && r.slot.teacher === n.key, J(r.slot));
  check('the last sync is passed through for Checks', r.sync && r.sync.failed === 1);
  check('the sheet link is built from the id', a.sheetUrl === 'https://docs.google.com/spreadsheets/d/S1/edit');
}

console.log('\nonly the owner');
{
  const store = {};
  const mk = deny => ctx({ peopleOwnerOnly_: () => deny, veraSetting_: () => '[]', lgGoals_: () => [], lgHabitLog_: () => [], lgLogsByGoal_: () => ({}), plPlanned_: () => [], veraStoreGet_: () => '',
    CacheService: { getScriptCache: () => ({ get: k => store[k] || null, put: (k, v) => { store[k] = v; } }) } });
  const no = mk({ ok: false, error: 'Only the owner can do that' }).webAgora_({});
  check('someone else gets a refusal, not the teachers', no.ok === false && !no.teachers);
  const yes = mk(null).webAgora_({});
  check('the owner gets the lounge', yes.ok === true && Array.isArray(yes.teachers));
}

console.log('\nwiring');
check('route agora, owner-only, cached', /case 'agora':\s*return jsonOut_\(webAgora_\(e\.parameter\)\)/.test(WEB) && /peopleOwnerOnly_\(\)/.test(AG) && /cache\.put\(AG_CACHE_KEY_/.test(AG));
check('the nightly sync records what it did', /veraStoreSet_\('PRACTICE_LOG_LAST'/.test(PL) && /'PRACTICE_LOG_LAST'\]/.test(SET));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
