// Every cadence and scheduled time is a setting (#254 follow-up): the weekend memo's day and
// hour, the nightly run's hour (the second half follows an hour later), the morning email,
// the scan intervals, the monthly days. These pin:
//   1. the readers (schedHour_ / schedWeekday_ / schedDom_ / schedMinutes_) take a good value
//      and fall back to today's time on a bad or blank one;
//   2. the trigger specs follow the settings, and keep today's times without them;
//   3. saving a setting that moves a trigger rebuilds that trigger (only that one);
//   4. each hourly / nightly check reads its day from Config, not a hard-coded one;
//   5. Feature Flags says when each scheduled feature runs.
// Invented data throughout.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CODE = read('Co' + 'de.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
const varLine = (src, name) => new RegExp('^var ' + name + ' = .*;', 'm').exec(src)[0];

// A trigger builder that records its chain.
function builder(handler, log) {
  const chain = [];
  const b = {};
  ['atHour', 'everyDays', 'everyHours', 'everyMinutes', 'everyWeeks', 'onWeekDay', 'inTimezone', 'nearMinute'].forEach(m => {
    b[m] = (...a) => { chain.push(m + '(' + a.join(',') + ')'); return b; };
  });
  b.create = () => { log.push('create:' + handler + ':' + chain.join('.')); return {}; };
  b.chain = chain;
  return b;
}

function harness(cfg, existing) {
  const log = [];
  const ctx = {
    Logger: { log() {} }, JSON, Math, Date, String, Object, Array, parseInt,
    Session: { getScriptTimeZone: () => 'UTC' },
    CONFIG: { NIGHTLY_RUN_HOUR: 23, MORNING_NUDGE_HOUR: 7 },
    getConfigValues: () => cfg || {},
    ScriptApp: {
      WeekDay: { SUNDAY: 'SUNDAY', MONDAY: 'MONDAY', TUESDAY: 'TUESDAY', WEDNESDAY: 'WEDNESDAY', THURSDAY: 'THURSDAY', FRIDAY: 'FRIDAY', SATURDAY: 'SATURDAY' },
      newTrigger: h => ({ timeBased: () => builder(h, log) }),
      getProjectTriggers: () => (existing || []).map(h => ({ getHandlerFunction: () => h, h })),
      deleteTrigger: t => log.push('delete:' + t.h),
    },
    recordTriggerRegistrations_: hs => log.push('record:' + hs.join(',')),
    _log: log,
  };
  vm.createContext(ctx);
  vm.runInContext([varLine(CODE, 'VERA_WEEKDAYS_'), varLine(CODE, 'VERA_TRIGGER_MINUTES_'),
    'schedCfg_', 'schedHour_', 'schedWeekday_', 'schedDom_', 'schedMinutes_', 'veraTriggerSpecs_', 'rebuildTrigger_']
    .map(x => /^var /.test(x) ? x : extractFn(CODE, x)).join('\n'), ctx);
  return ctx;
}
const chains = c => {
  const out = {};
  vm.runInContext('veraTriggerSpecs_()', c).forEach(s => { const b = builder(s.handler, []); s.build(b); out[s.handler] = b.chain.join('.'); });
  return out;
};

console.log('The readers');
{
  const c = harness();
  const r = (fn, k, def, cfg) => vm.runInContext(fn + '(' + J(k) + ',' + def + ',' + J(cfg) + ')', c);
  check('an hour is read', r('schedHour_', 'h', 8, { h: '17' }) === 17);
  check('hour 0 (midnight) is a real hour, not blank', r('schedHour_', 'h', 8, { h: '0' }) === 0);
  check('a blank, a word or 24 keeps the default', [r('schedHour_', 'h', 8, { h: '' }), r('schedHour_', 'h', 8, { h: 'soon' }), r('schedHour_', 'h', 8, { h: '24' }), r('schedHour_', 'h', 8, {})].every(v => v === 8));
  check('a weekday 0–6 is read; Sunday is 0', r('schedWeekday_', 'd', 3, { d: '0' }) === 0 && r('schedWeekday_', 'd', 3, { d: '5' }) === 5);
  check('weekday 7 keeps the default', r('schedWeekday_', 'd', 3, { d: '7' }) === 3);
  check('a day of the month is 1–28 (every month has it)', r('schedDom_', 'm', 1, { m: '15' }) === 15 && r('schedDom_', 'm', 1, { m: '30' }) === 1 && r('schedDom_', 'm', 1, { m: '0' }) === 1);
  check('minutes are only ones Apps Script accepts', r('schedMinutes_', 'x', 30, { x: '10' }) === 10 && r('schedMinutes_', 'x', 30, { x: '7' }) === 30 && r('schedMinutes_', 'x', 30, { x: '1' }) === 30);
  check('with no cfg passed, the reader reads Config itself', vm.runInContext('schedHour_("h", 8)', harness({ h: '6' })) === 6);
}

console.log('\nThe triggers follow the settings');
{
  const d = chains(harness());
  check('no settings: nightly at 23, tail at midnight, morning at 7', d.nightlyRun === 'atHour(23).everyDays(1).inTimezone(UTC)' && d.nightlyRunTail === 'atHour(0).everyDays(1).inTimezone(UTC)' && d.morningNudge === 'atHour(7).everyDays(1).inTimezone(UTC)', J(d));
  check('no settings: flights every 15, email every 30, USPS at 10, HOA Mondays at 9',
    d.checkFlightStatuses_ === 'everyMinutes(15)' && d.runEmailScan_ === 'everyMinutes(30)' && d.scanUSPSMail_ === 'atHour(10).everyDays(1).inTimezone(UTC)' && d.scanHoaWebsite_ === 'everyWeeks(1).onWeekDay(MONDAY).atHour(9).inTimezone(UTC)', J(d));
  const s = chains(harness({ nightly_run_hour: '21', morning_nudge_time: '6', flight_status_trigger_minutes: '10', email_parser_minutes: '5', usps_scan_hour: '8', hoa_scan_day: '3', hoa_scan_hour: '7' }));
  check('the nightly run moves, and its second half follows an hour later', s.nightlyRun === 'atHour(21).everyDays(1).inTimezone(UTC)' && s.nightlyRunTail === 'atHour(22).everyDays(1).inTimezone(UTC)', J(s));
  check('the morning email moves', s.morningNudge === 'atHour(6).everyDays(1).inTimezone(UTC)');
  check('the scan intervals move', s.checkFlightStatuses_ === 'everyMinutes(10)' && s.runEmailScan_ === 'everyMinutes(5)');
  check('USPS and the HOA scan move (Wednesdays at 7)', s.scanUSPSMail_ === 'atHour(8).everyDays(1).inTimezone(UTC)' && s.scanHoaWebsite_ === 'everyWeeks(1).onWeekDay(WEDNESDAY).atHour(7).inTimezone(UTC)', J(s));
  check('the HOA spec says the day it runs', vm.runInContext('veraTriggerSpecs_()', harness({ hoa_scan_day: '3', hoa_scan_hour: '7' })).filter(x => x.handler === 'scanHoaWebsite_')[0].when === 'Wednesdays at 07:00');
  const bad = chains(harness({ nightly_run_hour: 'late', email_parser_minutes: '2', hoa_scan_day: '9' }));
  check('bad values keep today’s times', bad.nightlyRun === d.nightlyRun && bad.runEmailScan_ === d.runEmailScan_ && bad.scanHoaWebsite_ === d.scanHoaWebsite_);
  const ctx = harness(); delete ctx.schedHour_; ctx.schedHour_ = undefined; ctx.schedCfg_ = undefined;
  check('without the readers loaded, the specs still build today’s times', (() => { try { return chains(ctx).nightlyRun === d.nightlyRun; } catch (e) { return false; } })());
}

console.log('\nOne trigger is rebuilt');
{
  const c = harness({ nightly_run_hour: '22' }, ['nightlyRun', 'nightlyRun', 'hourlyCheck', 'someoneElse']);
  const ok = vm.runInContext('rebuildTrigger_("nightlyRun")', c);
  const log = c._log;
  check('it returns true', ok === true);
  check('both old nightlyRun triggers are deleted, and nothing else', J(log.filter(l => l.startsWith('delete:'))) === J(['delete:nightlyRun', 'delete:nightlyRun']), J(log));
  check('one new one is made at the new hour', J(log.filter(l => l.startsWith('create:'))) === J(['create:nightlyRun:atHour(22).everyDays(1).inTimezone(UTC)']), J(log));
  check('deleted before it is created', log.indexOf('delete:nightlyRun') < log.findIndex(l => l.startsWith('create:')));
  check('the watchdog’s registry is told', log.indexOf('record:nightlyRun') !== -1);
  check('an unknown handler is refused, and nothing is touched', vm.runInContext('rebuildTrigger_("nope")', harness({}, ['nightlyRun'])) === false);
}

console.log('\nSaving a schedule setting');
{
  const set = [], rebuilt = [];
  const c = { Logger: { log() {} }, JSON, Math, Date, String, Object, Array, parseInt, Utilities: { formatDate: () => '2026-11-19' }, Session: { getScriptTimeZone: () => 'UTC' },
    peopleOwnerOnly_: () => null, setConfigRow_: (k, v) => set.push(k + '=' + v), rebuildTrigger_: h => (rebuilt.push(h), true), getConfigValues: () => ({}) };
  vm.createContext(c); vm.runInContext(read('Features.js'), c);
  const save = (key, value) => vm.runInContext('webSetFeatureSetting_(' + J({ key, value }) + ')', c);
  const r1 = save('nightly_run_hour', '21');
  check('the nightly hour rebuilds both halves', r1.ok && J(r1.rebuilt) === J(['nightlyRun', 'nightlyRunTail']) && J(rebuilt) === J(['nightlyRun', 'nightlyRunTail']), J(r1));
  rebuilt.length = 0;
  const r2 = save('weekend_planner_day', '5');
  check('the weekend memo’s day is saved and needs no trigger (hourly check reads it)', r2.ok && set.indexOf('weekend_planner_day=5') !== -1 && r2.rebuilt.length === 0 && rebuilt.length === 0, J(r2));
  check('the HOA day rebuilds only the HOA scan', J(save('hoa_scan_day', '2').rebuilt) === J(['scanHoaWebsite_']));
  check('a day that isn’t a choice is refused, and nothing is saved', !save('weekend_planner_day', '9').ok && set.indexOf('weekend_planner_day=9') === -1);
  check('a minute Apps Script can’t do isn’t a choice', !save('email_parser_minutes', '7').ok);
  const keys = Object.keys(vm.runInContext('SCHED_TRIGGER_KEYS_', c));
  const settings = {}; vm.runInContext('FEATURES_', c).forEach(f => (f.cfg || []).forEach(x => { settings[x.c] = x; }));
  check('every trigger-moving key is a setting on some feature', keys.every(k => settings[k]), J(keys.filter(k => !settings[k])));
  const want = ['nightly_run_hour', 'morning_nudge_time', 'weekend_planner_day', 'weekend_planner_hour', 'goal_checkin_day', 'goal_checkin_hour', 'finance_review_day', 'card_perks_review_day',
    'chores_reset_day', 'email_admin_day', 'hoa_scan_day', 'hoa_scan_hour', 'usps_scan_hour', 'wishlist_wrap_day', 'wishlist_flags_until', 'memory_snapshot_day', 'health_insight_day', 'pto_accrual_day', 'fitness_low_flag_day'];
  check('each scheduled time is a setting with a picker', want.every(k => settings[k] && settings[k].type === 'select' && settings[k].sched), J(want.filter(k => !(settings[k] && settings[k].sched))));
  const when = (k, cfg) => vm.runInContext('featureWhen_(featureByKey_(' + J(k) + '),' + J(cfg || {}) + ')', c);
  check('Feature Flags says when the weekend memo goes out', when('weekend_planner') === 'Wednesdays at 8 am', when('weekend_planner'));
  check('…and follows the setting', when('weekend_planner', { weekend_planner_day: '5', weekend_planner_hour: '17' }) === 'Fridays at 5 pm', when('weekend_planner', { weekend_planner_day: '5', weekend_planner_hour: '17' }));
  check('the nightly run and the monthly review say theirs', /11 pm/.test(when('nightly_run')) && /1st/.test(when('monthly_review')), when('nightly_run') + ' | ' + when('monthly_review'));
  check('the nightly run and morning email are always on (no switch)', vm.runInContext('featureByKey_("nightly_run").fixed && featureByKey_("morning_email").fixed', c) === true);
  check('a fixed feature can’t be switched off', vm.runInContext('webSetFeature_({key:"nightly_run",state:"off"})', c).ok === false);
}

console.log('\nThe checks read their day from Config');
{
  const R = read('Reminders.js'), E = read('EmailAdmin.js'), M = read('MonthlyReview.js'), U = read('MailCounter.js'), W = read('WishLists.js');
  check('the weekend memo: its day and hour', /day === schedWeekday_\('weekend_planner_day', 3, cfg\) && hour === schedHour_\('weekend_planner_hour', 8, cfg\)/.test(R));
  check('the goal check-in: its day and hour', /schedWeekday_\('goal_checkin_day', 1, cfg\)/.test(R) && /schedHour_\('goal_checkin_hour'/.test(R));
  check('the email tidy-up: its day', /schedWeekday_\('email_admin_day', 0, config\)/.test(E));
  check('the monthly review: its day', /today\.getDate\(\) !== \(typeof schedDom_ === 'function' \? schedDom_\('finance_review_day', 1, cfg\)/.test(M));
  check('the PTO snapshot follows the review’s day', /today\.getDate\(\) === schedDom_\('finance_review_day', 1\) \? writePTOSnapshot_\(\)/.test(CODE));
  check('the health insight and card perks: their days', /schedDom_\('health_insight_day', 1\)/.test(CODE) && /schedDom_\('card_perks_review_day', 1\)/.test(CODE));
  check('the chores reset: its weekday', /dow === schedWeekday_\('chores_reset_day', 5\)/.test(CODE));
  check('the USPS catch-up waits for the scan’s hour', /schedHour_\('usps_scan_hour', USPS_SCAN_HOUR_\)/.test(U));
  check('the wish-list flags: their last day and wrap day', /wishlist_flags_until/.test(W) && /wishlist_wrap_day/.test(W));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
