const NR__ = require('fs').readFileSync(require('path').join(process.env.VERA_ROOT || require('path').join(__dirname, '..', '..'), 'NightlyRunner.js'), 'utf8');   // the night's one list (#256)
// Settings › Feature Flags, Config and Feature map, server side (#254, Features.js): one feature list
// drives the switches, "off until", needs, the step / notification / screen gates, the routes, the
// retired-row purge, and the new settings read in code. Invented data.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const SRC = read('Features.js'), CODE = read('Co' + 'de.js'), WEB = read('WebApp.js'), NOTIFY = read('Notify.js');

function ctx(cfg, opts) {
  opts = opts || {};
  const writes = [], props = {};
  const c = { Logger: { log() {} }, JSON, Math, Date, String, Object, Number, parseInt, writes,
    Utilities: { formatDate: () => opts.today || '2026-11-19' }, Session: { getScriptTimeZone: () => 'UTC' },
    getConfigValues: () => cfg, peopleOwnerOnly_: () => opts.notOwner ? { ok: false, error: 'Only the owner can do that' } : null,
    setConfigRow_: (k, v) => { writes.push([k, v]); cfg[k] = v; return true; },
    veraStateGet_: () => ({ STEPS_LAST: props.STEPS_LAST }), veraStateSet_: (b, p) => Object.assign(props, p),
    getHeartbeatState_: () => ({ scanUSPSMail_: { lastRun: '2026-11-19T10:00:00Z' } }),
    NOTIF_REGISTRY: [{ key: 'gym_checkin', label: 'Gym Check-in' }] };
  vm.createContext(c); vm.runInContext(SRC, c); c.__props = props; return c;
}

console.log('\nThe list');
{
  const c = ctx({});
  const keys = c.FEATURES_.map(f => f.k);
  check('50 features, each key once, each in a known area and kind', keys.length === 50 && new Set(keys).size === 50 && c.FEATURES_.every(f => c.FEATURE_AREAS_.includes(f.a) && c.FEATURE_KINDS_.includes(f.kind)));
  check('every "needs" names a feature', c.FEATURES_.every(f => !f.needs || keys.includes(f.needs)));
  const steps = Object.keys(c.featureStepMap_()), missing = steps.filter(s => !new RegExp("nightlyStep_\\((ctx|c), '" + s + "'").test(CODE) && !new RegExp("S\\('" + s + "', \\d").test(NR__));
  check('every step it owns is a real nightly or morning step', steps.length > 40 && !missing.length, J(missing));
  const notif = Object.keys(c.featureNotifMap_()), gone = notif.filter(n => !new RegExp("key: '" + n + "'").test(CODE));
  check('every notification it owns is in the registry', notif.length > 20 && !gone.length, J(gone));
  const own = {}; c.FEATURES_.forEach(f => (f.steps || []).forEach(s => { own[s] = (own[s] || 0) + 1; }));
  check('no step belongs to two features', Object.values(own).every(n => n === 1));
}

console.log('\nOn, off, paused, blocked');
{
  const c = ctx({}), S = (k, cfg) => c.featureStateFrom_(k, cfg, '2026-11-19');
  check('missing means on; FALSE means off (any case)', S('fitness', {}) === 'on' && S('fitness', { fitness_enabled: 'FALSE' }) === 'off' && S('fitness', { fitness_enabled: 'false' }) === 'off');
  check('off with a future date is paused; once the date comes it’s on', S('fitness', { fitness_enabled: 'FALSE', fitness_paused_until: '2026-12-01' }) === 'paused' && S('fitness', { fitness_enabled: 'FALSE', fitness_paused_until: '2026-11-19' }) === 'on');
  check('a feature whose need is off is blocked, keeping its own switch', S('gym_tracker', { fitness_enabled: 'FALSE' }) === 'blocked' && S('gym_tracker', { fitness_enabled: 'FALSE', fitness_paused_until: '2026-12-01' }) === 'blocked');
  check('an unknown key is on', S('nope', { nope_enabled: 'FALSE' }) === 'on');
  check('its notifications follow it', c.featureOffForNotif_('gym_checkin', { fitness_enabled: 'FALSE' }, '2026-11-19') === 'gym_tracker' && c.featureOffForNotif_('gym_checkin', {}, '2026-11-19') === '' && c.featureOffForNotif_('bill_due', { fitness_enabled: 'FALSE' }, '2026-11-19') === '');
  check('its screens are hidden while it’s not on', J(c.featureHiddenScreens_({ career_enabled: 'FALSE', notes_enabled: 'FALSE', notes_paused_until: '2026-12-01' }, '2026-11-19')) === J(['life/notes', 'career']));
}

console.log('\nSteps, and when they last ran');
{
  const c = ctx({ career_enabled: 'FALSE' });
  check('a step of an off feature is skipped, naming the feature; others run', c.featureOffStep_('carNightly_') === 'career' && c.featureOffStep_('checkPreTripBriefings_') === '' && c.featureOffStep_('collect') === '');
  c.featureNoteSteps_([{ name: 'checkGymSessions_', ms: 10 }, { name: 'collect', ms: 99 }]);
  const map = JSON.parse(c.__props.STEPS_LAST);
  check('a run notes when each feature step ran (only the ones features own)', map.checkGymSessions_ > 0 && map.collect === undefined);
  const f = c.featureByKey_('usps_scan');
  check('last activity: the latest of its steps and its jobs’ heartbeats', c.featureLastMs_(f, {}, { scanUSPSMail_: { lastRun: '2026-11-19T10:00:00Z' } }) === Date.parse('2026-11-19T10:00:00Z') && c.featureLastMs_(c.featureByKey_('takeouts'), {}, {}) === 0);
  check('nightlyStep_ asks before the clock, and says why it skipped', /var offBy = typeof featureOffStep_ === 'function' \? featureOffStep_\(name\) : '';/.test(CODE) && CODE.indexOf('featureOffStep_(name)') < CODE.indexOf('if (Date.now() + NIGHTLY_STEP_RESERVE_MS_ >= ctx.deadline)'));
  check('the night (once, when it finishes) and the morning email note their steps', (CODE.match(/featureNoteSteps_\(ctx\.timings\)/g) || []).length === 1 && /  try \{ featureNoteSteps_\(st\.timings\); \} catch \(e\) \{\}/.test(NR__));
}

console.log('\nRoutes');
{
  const cfg = { pantry_enabled: 'FALSE', pantry_paused_until: '2026-12-01', pretrip_briefing_hours: '36' };
  const c = ctx(cfg);
  const r = c.webFeatureFlags_();
  const pre = r.features.find(f => f.k === 'pretrip_briefing'), pan = r.features.find(f => f.k === 'pantry'), usps = r.features.find(f => f.k === 'usps_scan');
  check('feature_flags: every feature with its state, its settings (value or default) and last activity', r.ok && r.features.length === 50 && pan.state === 'paused' && pan.until === '2026-12-01' && pre.cfg[0].v === '36' && !pre.cfg[0].isDefault && usps.last === '2026-11-19T10:00:00.000Z');
  check('…its notifications by name', J(r.features.find(f => f.k === 'gym_tracker').notif) === J([{ key: 'gym_checkin', label: 'Gym Check-in' }]));
  check('owner only', ctx({}, { notOwner: true }).webFeatureFlags_().ok === false && ctx({}, { notOwner: true }).webSetFeature_({ key: 'fitness', state: 'off' }).ok === false);
  const s = c.webSetFeature_({ key: 'fitness', state: 'off' });
  check('set_feature off: the switch FALSE, no date, and what needed it is now blocked', s.ok && cfg.fitness_enabled === 'FALSE' && cfg.fitness_paused_until === '' && J(s.dependents) === J([{ k: 'gym_tracker', state: 'blocked' }]));
  c.webSetFeature_({ key: 'explorer', state: 'paused', until: '2026-12-24' });
  check('…paused: FALSE until the date, so code that reads the switch sees it off', cfg.explorer_enabled === 'FALSE' && cfg.explorer_paused_until === '2026-12-24' && c.featureStateFrom_('explorer', cfg, '2026-11-19') === 'paused');
  check('…a pause needs a date after today', c.webSetFeature_({ key: 'explorer', state: 'paused', until: '2026-11-19' }).ok === false && c.webSetFeature_({ key: 'nope', state: 'off' }).ok === false);
  c.webSetFeature_({ key: 'explorer', state: 'on' });
  check('…on: TRUE and the date cleared', cfg.explorer_enabled === 'TRUE' && cfg.explorer_paused_until === '');
  check('set_feature_setting: only a feature’s own settings, checked by type', c.webSetFeatureSetting_({ key: 'pretrip_briefing_hours', value: '24' }).ok && cfg.pretrip_briefing_hours === '24'
    && c.webSetFeatureSetting_({ key: 'pretrip_briefing_hours', value: 'soon' }).ok === false && c.webSetFeatureSetting_({ key: 'morning_nudge_email', value: 'x' }).ok === false
    && c.webSetFeatureSetting_({ key: 'gym_checkin_hours', value: '23-18' }).ok === false && c.webSetFeatureSetting_({ key: 'email_admin_frequency', value: 'hourly' }).ok === false);
  const p = ctx({ reminders_enabled: 'FALSE', reminders_paused_until: '2026-11-19', fitness_enabled: 'FALSE', fitness_paused_until: '2026-12-01' });
  check('a pause whose date has come turns back on (hourly); one still ahead stays', J(p.featureResumePaused_()) === J(['reminders']) && J(p.writes) === J([['reminders_enabled', 'TRUE'], ['reminders_paused_until', '']]));
  check('the routes are wired: GET feature_flags, config_files, config_calendars; POST set_feature, set_feature_setting, config_slack_test',
    /case 'feature_flags':\s+return jsonOut_\(webFeatureFlags_\(\)\)/.test(WEB) && /case 'config_files':/.test(WEB) && /case 'config_calendars':/.test(WEB) && /case 'set_feature':\s+return jsonOut_\(webSetFeature_\(body\)\)/.test(WEB) && /case 'set_feature_setting':/.test(WEB) && /case 'config_slack_test':/.test(WEB));
  check('Settings is the owner’s: Config and Notifications routes refuse anyone else', /case 'get_config_rows':\s+return jsonOut_\(peopleOwnerOnly_\(\) \|\| webGetConfigRows_\(\)\)/.test(WEB) && /case 'set_config_value': return jsonOut_\(peopleOwnerOnly_\(\) \|\| webSetConfigValue_/.test(WEB) && /case 'get_notification_map': return jsonOut_\(peopleOwnerOnly_\(\) \|\| /.test(WEB) && /case 'set_notif_delivery':\s+return jsonOut_\(peopleOwnerOnly_\(\) \|\| /.test(WEB));
  check('every config route checks the owner itself', ['webConfigFiles_', 'webConfigCalendars_', 'webConfigSlackTest_', 'webSetFeatureSetting_'].every(fn => new RegExp('function ' + fn + '\\([^)]*\\) \\{\\n  var refused = peopleOwnerOnly_\\(\\); if \\(refused\\) return refused;').test(SRC)));
}

console.log('\nConfig helpers and the purge');
{
  const c = ctx({});
  check('a file ID from a link or a bare ID', c.configFileId_('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit') === '1AbCdEfGhIjKlMnOpQrStUvWxYz012345' && c.configFileId_('1AbCdEfGhIjKlMnOpQrStUvWxYz012345') === '1AbCdEfGhIjKlMnOpQrStUvWxYz012345' && c.configFileId_('short') === '');
  check('retired rows: the old break and calendar-opportunity rows and travel_companions, nothing else', c.configRetired_('notif_desk_break_channel') && c.configRetired_('notif_water_break_while_away') && c.configRetired_('travel_companions') && !c.configRetired_('notif_movement_channel') && !c.configRetired_('travel_day_briefing_enabled'));
  const rows = [['k'], ['notif_desk_break_channel'], ['home_address'], ['travel_companions']], deleted = [];
  const d = ctx({}); d.getSpreadsheet = () => ({ getSheetByName: () => ({ getLastRow: () => rows.length + 1, getRange: () => ({ getValues: () => rows }), deleteRow: n => deleted.push(n) }) });
  d.TABS = { CONFIG: 'Config' }; d.veraLocked_ = fn => fn();
  check('the purge deletes them bottom-up', d.purgeRetiredConfig_() === 2 && J(deleted) === J([5, 3]));
  check('…as a nightly housekeeping step', /S\('purgeRetiredConfig_', 5, function\(\) \{ purgeRetiredConfig_\(\); \}\)/.test(NR__));
  check('gym check-in hours: "18-23", and nothing odd', J(c.gymCheckinRange_('18-23')) === J({ from: 18, to: 23 }) && c.gymCheckinRange_('23-18') === null && c.gymCheckinRange_('soon') === null);
}

console.log('\nOff everywhere: the gates');
{
  check('notifications: off when their feature is', /if \(typeof featureOffForNotif_ === 'function' && featureOffForNotif_\(key, cfg\)\) return 'off';/.test(NOTIFY));
  check('the Notifications page says which feature turned a row off', /offBy:/.test(WEB) && /'Off because '\+n\.offBy\+' is off in Feature Flags/.test(read('docs/app.js')));
  check('/status: every feature, and the screens to hide', /features\[f\.k\] = featureStateFrom_\(f\.k, featureCfg, fToday\) === 'on';/.test(WEB) && /hiddenScreens: hiddenScreens,/.test(WEB));
  check('the scheduled jobs check their switch', /!featureOn_\('flight_status'\)/.test(read('FlightStatus.js')) && /!featureOn_\('usps_scan'\)/.test(read('MailCounter.js')) && /!featureOn_\('hoa_watch'\)/.test(read('NeighborhoodWatcher.js'))
    && /!featureOn_\('aria_sync'\)/.test(read('Aria.js')) && /!featureOn_\('run_log'\)/.test(read('RunLog.js')) && /!featureOn_\('away_mode'\)/.test(read('Away.js')) && /!featureOn_\('gym_tracker'\)/.test(read('GymTracker.js')));
  check('…a flight refresh you ask for still runs', /\(forceRefresh === undefined \|\| \(forceRefresh && typeof forceRefresh === 'object'\)\) && typeof featureOn_ === 'function' && !featureOn_\('flight_status'\)/.test(read('FlightStatus.js')));
  check('the hourly check resumes pauses whose date has come', /featureResumePaused_\(\);/.test(read('Reminders.js')));
  check('email parsing turns back on whichever case TRUE is written in', /String\(enabled \|\| ''\)\.trim\(\)\.toLowerCase\(\) !== 'true'/.test(read('EmailParser.js')));
  check('new settings read in code: recap delay, gym hours, Run Log days', /posttrip_recap_delay_days/.test(read('PostTripCapture.js')) && /gym_checkin_hours/.test(read('GymTracker.js')) && /run_log_keep_days/.test(read('RunLog.js')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
