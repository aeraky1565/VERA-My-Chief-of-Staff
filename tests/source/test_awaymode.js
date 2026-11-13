// #246 Away mode. Pins:
//  - when it is on: the manual switch (until a date), a trip of yours, and a trip
//    ended early by hand;
//  - what's held: each notification's "while away" setting (send / hold / due), a
//    Config override beating the registry default, and "due" sending only when the
//    deadline falls before you're back;
//  - which flags get through: High, from a source with a deadline, Due in time;
//  - what's counted for the banner and the catch-up;
//  - the away edition of the morning email;
//  - the Flags tab's Due column (L), from the writers, the producers and Claude;
//  - the endpoints, and the gates in the senders (escalation, morning email, nudges);
//  - the dashboard: the Home banner and switch, and the per-notification setting.
// Invented trips, keys and dates.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return fs.readFileSync(path.join(REPO, f), 'utf8'); } };
const AWAY = read('Away.js'), CODE = read('Code.js'), WEB = read('WebApp.js'), REM = read('Reminders.js'), CL = read('Claude.js'), APP = read('docs/app.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const fnSrc = (src, name) => { const a = src.indexOf('function ' + name + '('); if (a === -1) return ''; const m = /\)\s*\{/g; m.lastIndex = a; let d = 0, j = m.exec(src).index; j = src.indexOf('{', j); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(a, j + 1); };
const REGISTRY = (() => { const a = CODE.indexOf('const NOTIF_REGISTRY = ['); return CODE.slice(a, CODE.indexOf('\n];', a) + 3).replace(/^const /, 'var '); })();
const FLAG_HEADERS_SRC = CODE.match(/^const FLAG_HEADERS\s*=.*;$/m)[0].replace(/^const /, 'var ');
const DUE_HELPERS = CODE.slice(CODE.indexOf('function flagDueCell_('), CODE.indexOf('function writeFlags('));

const TODAY = '2026-11-13';
function ctx(opts) {
  const o = opts || {};
  const st = Object.assign({}, o.state || {}), sent = [], logs = [];
  const c = {
    String, Array, Object, JSON, Math, Number, isNaN, parseInt, Date, RegExp,
    Logger: { log: s => logs.push(String(s)) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? (d.__iso || TODAY) : '9:00 AM' },
    veraStateGet_: () => Object.assign({}, st),
    veraStateSet_: (b, patch) => { Object.keys(patch).forEach(k => { if (patch[k] === null) delete st[k]; else st[k] = String(patch[k]); }); },
    getConfigValues: () => o.config || {},
  };
  c.__st = st; c.__sent = sent; c.__logs = logs;
  vm.createContext(c);
  vm.runInContext(REGISTRY + '\n' + FLAG_HEADERS_SRC + '\n' + AWAY, c);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);

console.log('\nawayDecide_: when Away mode is on');
{
  const c = ctx();
  c.st = { AWAY_MANUAL: 'on', AWAY_UNTIL: '2026-11-16', AWAY_TRIP: 'Invented Getaway', AWAY_STARTED: '2026-11-10' };
  const m = run(c, 'awayDecide_(st, "2026-11-13")');
  check('the switch: on until its date, with the trip and start day', m.on && m.source === 'manual' && m.until === '2026-11-16' && m.trip === 'Invented Getaway' && m.started === '2026-11-10', J(m));
  check('…still on, on its last day', run(c, 'awayDecide_(st, "2026-11-16")').on === true);
  check('…off the day after', run(c, 'awayDecide_(st, "2026-11-17")').on === false);
  c.st = { AWAY_MANUAL: 'on' };
  check('the switch with no date stays on', run(c, 'awayDecide_(st, "2027-01-01")').on === true);
  c.st = { VACATION_MODE_ACTIVE: 'true', VACATION_TRIP_NAME: '2026-11-10|Island Cruise', VACATION_MODE_ENDS: '2026-11-18' };
  const a = run(c, 'awayDecide_(st, "2026-11-13")');
  check('a trip of yours turns it on, until the trip ends', a.on && a.source === 'auto' && a.until === '2026-11-18', J(a));
  c.st.AWAY_ENDED_TRIP = '2026-11-10|Island Cruise';
  check('…unless that trip was ended early by hand', run(c, 'awayDecide_(st, "2026-11-13")').on === false);
  c.st.AWAY_ENDED_TRIP = '2026-10-01|Some Other Trip';
  check('…ending an older trip early does not end this one', run(c, 'awayDecide_(st, "2026-11-13")').on === true);
  c.st = { VACATION_MODE_ACTIVE: 'false', AWAY_MANUAL: '' };
  check('nothing set: off', run(c, 'awayDecide_(st, "2026-11-13")').on === false);
}

console.log('\nawayHoldsDecide_: what a "while away" setting does');
{
  const c = ctx();
  c.on = { on: true, until: '2026-11-16' };
  const h = (policy, due, away) => run(c, 'awayHoldsDecide_(' + (away || 'on') + ', ' + J(policy) + ', ' + J(due || '') + ')');
  check('not away: nothing is held', h('hold', '', '{ on: false }') === false);
  check('send: sends', h('send') === false);
  check('hold: held', h('hold') === true);
  check('due, deadline before you’re back: sends', h('due', '2026-11-15') === false);
  check('due, deadline on your last day: sends', h('due', '2026-11-16') === false);
  check('due, deadline after you’re back: held', h('due', '2026-11-20') === true);
  check('due, no deadline: held', h('due', '') === true);
  check('due, away with no end date: a deadline sends', h('due', '2026-12-30', '{ on: true, until: "" }') === false);
}

console.log('\nnotifWhileAway_: the setting, and its default');
{
  check('the registry default', ctx().notifWhileAway_('water_break') === 'hold' && ctx().notifWhileAway_('travel_day_briefing') === 'send' && ctx().notifWhileAway_('bill_due') === 'due');
  check('a Config row overrides it', ctx({ config: { notif_water_break_while_away: 'Send' } }).notifWhileAway_('water_break') === 'send');
  check('…a nonsense value is ignored', ctx({ config: { notif_water_break_while_away: 'sometimes' } }).notifWhileAway_('water_break') === 'hold');
  check('a key that isn’t registered: held', ctx().notifWhileAway_('email_admin') === 'hold');
  const reg = run(ctx(), 'NOTIF_REGISTRY');
  check('every registry row has a valid setting', reg.length > 30 && reg.every(r => ['send', 'hold', 'due'].indexOf(r.whileAway) !== -1), reg.filter(r => ['send', 'hold', 'due'].indexOf(r.whileAway) === -1).map(r => r.key).join(','));
  const by = p => reg.filter(r => r.whileAway === p).map(r => r.key).sort();
  check('the agreed "send" list: travel, ARIA Book now, the system logs and watchdog, the morning email',
        J(by('send')) === J(['aria_book_now', 'error_alerts', 'leave_home', 'morning_briefing', 'nightly_log', 'packing_reminder', 'pretrip_briefing', 'travel_day_briefing', 'travel_docs', 'watchdog_email', 'watchdog_flag', 'watchdog_slack']), J(by('send')));
  check('the agreed "due" list: High flags, bills, contracts, coupons', J(by('due')) === J(['bill_due', 'contract_expiry', 'coupon_expiry', 'flag_high']), J(by('due')));
}

console.log('\nawayFlagGetsThrough_: which flags still come through');
{
  const c = ctx();
  c.away = { on: true, until: '2026-11-16' };
  const g = (f, away) => { c.f = f; return run(c, 'awayFlagGetsThrough_(f, ' + (away || 'away') + ')'); };
  check('High, from a bill, due before you’re back: through', g({ urgency: 'High', key: 'bill_due_invented_power', due: '2026-11-15' }) === true);
  check('…a travel document too', g({ urgency: 'High', key: 'tp_passport_x_2026-11-15', due: '2026-11-15' }) === true);
  check('Medium: held', g({ urgency: 'Medium', key: 'bill_due_invented_power', due: '2026-11-15' }) === false);
  check('High with no deadline source: held', g({ urgency: 'High', key: 'calendar_conflict_x', due: '2026-11-15' }) === false);
  check('High, due after you’re back: held', g({ urgency: 'High', key: 'contract_expiry_x', due: '2026-11-30' }) === false);
  check('High, no Due date: held', g({ urgency: 'High', key: 'coupon_expiry_x', due: '' }) === false);
  check('not away: everything comes through', g({ urgency: 'Low', key: 'x' }, '{ on: false }') === true);
}

console.log('\nawayHeldSummary_: what the banner and the catch-up count');
{
  const c = ctx();
  c.flags = [
    { date: '2026-11-09', urgency: 'Medium', key: 'a' },                                       // before the trip
    { date: '2026-11-11', urgency: 'Medium', key: 'b' },
    { date: '2026-11-12', urgency: 'Low', key: 'c' },
    { date: '2026-11-12', urgency: 'High', key: 'bill_due_x', due: '2026-11-14' },            // got through
  ];
  c.held = { bill_due: 2, water_break: 3, daily_discovery: '1' };
  const s = run(c, 'awayHeldSummary_(flags, held, { on: true, until: "2026-11-16", started: "2026-11-10" })');
  check('flags raised since it began, minus the ones that got through', s.flags === 2, J(s));
  check('reminders and nudges counted apart', s.reminders === 2 && s.nudges === 4 && s.total === 8, J(s));
}

console.log('\nawaySet_: the switch');
{
  const c = ctx({ state: { VACATION_MODE_ACTIVE: 'true', VACATION_TRIP_NAME: '2026-11-10|Island Cruise', VACATION_MODE_ENDS: '2026-11-18', AWAY_STARTED: '2026-11-10', AWAY_HELD: '{"water_break":2}' } });
  run(c, 'awaySet_(true, "2026-11-20", "Island Cruise, extended")');
  check('on while already away keeps the start day and the held count', c.__st.AWAY_MANUAL === 'on' && c.__st.AWAY_UNTIL === '2026-11-20' && c.__st.AWAY_STARTED === '2026-11-10' && c.__st.AWAY_HELD === '{"water_break":2}', J(c.__st));
  run(c, 'awaySet_(false)');
  check('off ends it now, and remembers the trip it ended', !c.__st.AWAY_MANUAL && c.__st.AWAY_ENDED_TRIP === '2026-11-10|Island Cruise' && run(c, 'awayStatus_()').on === false, J(c.__st));
  const f = ctx();
  run(f, 'awaySet_(true, "2026-11-20", "Weekend")');
  check('on from off starts today with nothing held', f.__st.AWAY_STARTED === TODAY && !f.__st.AWAY_HELD && run(f, 'awayStatus_()').on === true, J(f.__st));
}

console.log('\nsendNudge_: held, sent, counted');
{
  const c = ctx({ state: { AWAY_MANUAL: 'on', AWAY_UNTIL: '2026-11-16', AWAY_STARTED: '2026-11-10' } });
  const out = [];
  Object.assign(c, { isNotifEnabled_: () => true, getNotifChannel_: () => 'vera-notifications', sendSlack_: (ch, m) => { out.push(m); return true; },
                     markSent_: () => {}, sendSlackLog_: () => {}, isSlackConfigured_: () => true, sendVeraEmail_: () => {}, CONFIG: {} });
  run(c, fnSrc(REM, 'sendNudge_'));
  run(c, 'sendNudge_("r1", "Water", "invented water nudge", "water_break")');
  run(c, 'sendNudge_("r2", "Bill", "invented bill, due soon", "bill_due", "2026-11-15")');
  run(c, 'sendNudge_("r3", "Bill", "invented bill, due later", "bill_due", "2026-11-25")');
  run(c, 'sendNudge_("r4", "Travel", "invented travel day", "travel_day_briefing")');
  check('only the bill due before you’re back and the travel message go out', J(out) === J(['invented bill, due soon', 'invented travel day']), J(out));
  check('the held ones are counted for the catch-up', c.__st.AWAY_HELD === J({ water_break: 1, bill_due: 1 }), c.__st.AWAY_HELD);
  check('the bill reminder passes its due date', /'bill_due',\s*\n\s*dueIso/.test(REM));
}

console.log('\nawayEditionHtml_: the morning email while away');
{
  const c = ctx();
  c.d = { away: { on: true, until: '2026-11-18', trip: '2026-11-10|Island <Cruise>', started: '2026-11-10' }, today: '2026-11-15',
          items: [{ time: '9:00 AM', title: 'Snorkel tour', where: 'Pier 2' }], flights: [{ date: '2026-11-18', time: '4:10 PM', title: 'Flight home' }],
          through: [{ urgency: 'High', flag: 'Invented bill due', reason: 'Pay online', due: '2026-11-17' }],
          held: { flags: 3, reminders: 1, nudges: 0, total: 4 }, dashboardUrl: 'https://example.invalid/vera' };
  const e = run(c, 'awayEditionHtml_(d)');
  check('the subject names the edition, the trip and the day', e.subject === '✈️ VERA · Away edition — Island <Cruise> · Sun, Nov 15', e.subject);
  check('the header says AWAY EDITION', /AWAY EDITION/.test(e.html));
  check('Day 6 of 9 of the trip, escaped', /Day 6 of 9 of the <strong>Island &lt;Cruise&gt;<\/strong>/.test(e.html) && !/Island <Cruise>/.test(e.html));
  check('what got through is listed with its due date', /NEEDS YOU BEFORE YOU’RE BACK/.test(e.html) && /Invented bill due · due Tue, Nov 17/.test(e.html));
  check('the held counts, and the footer about the catch-up', /4 items held<\/strong> for when you’re back: 3 flags, 1 reminder\./.test(e.html) && /The 4 held items arrive in “While you were away”/.test(e.html));
  check('today and the flights home', /Snorkel tour · Pier 2/.test(e.html) && /YOUR FLIGHTS/.test(e.html) && /Wed, Nov 18 4:10 PM · Flight home/.test(e.html));
  check('the plain-text part too', /Needs you before you’re back:\n- Invented bill due \(due 2026-11-17\)/.test(e.text));
  c.d.through = []; c.d.held = { flags: 0, reminders: 0, nudges: 0, total: 0 };
  const q = run(c, 'awayEditionHtml_(d)');
  check('a quiet day says so, and lists nothing as needing you', /Nothing needs you today\./.test(q.html) && !/NEEDS YOU/.test(q.html) && !/items? held/.test(q.html));
}

console.log('\nThe Due column');
{
  const c = ctx();
  run(c, DUE_HELPERS);
  check('Due is column L of the Flags tab', run(c, 'FLAG_HEADERS.indexOf("Due")') === 11);
  check('a date is kept as yyyy-MM-dd, anything else is blank', c.flagDueCell_('2026-11-20') === '2026-11-20' && c.flagDueCell_('2026-11-20T08:00:00') === '2026-11-20' && c.flagDueCell_('soon') === '' && c.flagDueCell_(null) === '');
  const rows = [['ID', 'Date', 'Source', 'Flag', 'Reason', 'Urgency', 'Acknowledged', 'Snoozed Until', 'Resolved', 'Key', 'Escalated', '']];
  let headerWrites = 0;
  const sheet = {
    getLastRow: () => rows.length,
    getRange: (r, col, nr, nc) => ({
      getValue: () => (rows[r - 1] || [])[col - 1],
      setValue: v => { if (r === 1) headerWrites++; rows[r - 1][col - 1] = v; },
      getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(col - 1, col - 1 + (nc || 1))),
    }),
    appendRow: row => rows.push(row.slice()),
  };
  c.sheet = sheet; c.colorCodeFlags = () => {};
  run(c, fnSrc(CODE, 'appendExactKeyFlags_') + fnSrc(CODE, 'upsertKeyedFlags_'));
  run(c, 'appendExactKeyFlags_(sheet, [{ source: "Finance", flag: "f", reason: "r", urgency: "High", key: "contract_expiry_x", due: "2026-11-30" }, { source: "Finance", flag: "g", reason: "r", urgency: "Low", key: "plain_x" }], "2026-11-13")');
  run(c, 'upsertKeyedFlags_(sheet, "perk_expiry_", "Finance", { perk_expiry_y: { flag: "p", reason: "r", urgency: "High", due: "2026-11-28" } }, "2026-11-13")');
  check('the exact-key writer puts the deadline in L, blank when there is none', rows[1][11] === '2026-11-30' && rows[2][11] === '', J(rows.slice(1)));
  check('…and so does the keyed upsert', rows[3][9] === 'perk_expiry_y' && rows[3][11] === '2026-11-28', J(rows[3]));
  check('the blank header is labelled Due, once', rows[0][11] === 'Due' && headerWrites === 1);
  const wf = fnSrc(CODE, 'writeFlags');
  check('the nightly writer fills L too', /flagDueCell_\(flag\.due\)/.test(wf) && /flagDueHeader_\(sheet\)/.test(wf));
  check('the producers pass their deadlines: contracts, coupons, card perks, travel documents',
        /due:\s*endDate/.test(CODE) && /key: flagKey, due: expiry/.test(CODE) && /due:\s*periodEnd/.test(CODE)
        && /due: i\.expiry/.test(read('TravelerProfiles.js')) && /due: t\.startDate/.test(read('TravelerProfiles.js')) && /key: x\.key, due: x\.due/.test(read('TravelerProfiles.js')));
  const p = ctx();
  p.CONFIG = { MAX_FLAGS: 20 };
  run(p, fnSrc(CL, 'parseFlags'));
  const parsed = run(p, 'parseFlags(\'[{"source":"Finance","flag":"Bill","reason":"r","urgency":"High","key":"bill_due_power","due":"2026-11-20"},{"source":"Finance","flag":"Bill2","reason":"r","urgency":"High","key":"bill_due_water","due":"next week"}]\')');
  check('Claude’s flags keep a real due date and drop a made-up one', parsed[0].due === '2026-11-20' && parsed[1].due === '', J(parsed));
  check('the prompt asks for "due" on bills', /bill_due_\[bill_name_snake\]\. Add "due"/.test(CL) && /"due"\s+— OPTIONAL/.test(CL));
}

console.log('\nThe endpoints');
{
  const c = ctx();
  const wrote = [];
  c.setConfigRow_ = (k, v) => { wrote.push([k, v]); return true; };
  run(c, fnSrc(WEB, 'webSetNotifWhileAway_') + fnSrc(WEB, 'webAwaySet_') + fnSrc(WEB, 'webAwayStatus_'));
  const w = p => run(c, 'webSetNotifWhileAway_({ parameter: ' + J(p) + ' })');
  check('a bad value is refused', w({ key: 'water_break', value: 'later' }).ok === false);
  check('an unknown key is refused', w({ key: 'nope', value: 'send' }).ok === false);
  check('a locked row is refused', w({ key: 'nightly_log', value: 'hold' }).ok === false);
  check('a good one is written through setConfigRow_', w({ key: 'water_break', value: 'Send' }).ok === true && J(wrote) === J([['notif_water_break_while_away', 'send']]), J(wrote));
  check('away_set refuses a bad date', run(c, 'webAwaySet_({ on: true, until: "Nov 20" })').ok === false);
  check('…and a date that has passed', run(c, 'webAwaySet_({ on: true, until: "2026-11-01" })').ok === false);
  const r = run(c, 'webAwaySet_({ on: true, until: "2026-11-20", trip: "Weekend" })');
  check('a good one turns it on and answers with the status', r.ok && r.on && r.until === '2026-11-20' && r.trip === 'Weekend', J(r));
  const t = ctx({ state: { VACATION_MODE_ACTIVE: 'true', VACATION_TRIP_NAME: '2026-11-10|Island Cruise', VACATION_MODE_ENDS: '2026-11-18' } });
  t.awayOpenFlags_ = () => [];
  check('the banner gets the trip’s name, not its key', run(t, 'awaySummary_()').trip === 'Island Cruise', J(run(t, 'awaySummary_()')));
  check('the routes are wired', /case 'set_notif_while_away':\s*return jsonOut_\(webSetNotifWhileAway_\(e\)\)/.test(WEB) && /case 'away_status':\s*return jsonOut_\(webAwayStatus_\(\)\)/.test(WEB) && /case 'away_set':\s*return jsonOut_\(webAwaySet_\(body\)\)/.test(WEB));
  check('the notification map carries the setting', /whileAway: notifWhileAway_\(n\.key\)/.test(fnSrc(WEB, 'webGetNotificationMap_')));
}

console.log('\nThe senders');
{
  check('nothing escalates while away', /^\s*if \(typeof awayStatus_ === 'function' && awayStatus_\(\)\.on\) \{[^\n]*return; \}/m.test(fnSrc(CODE, 'escalateAgedFlags_').split('\n').slice(0, 4).join('\n')));
  const mn = fnSrc(CODE, 'morningNudge');
  check('the morning email becomes the away edition', /if \(typeof awayStatus_ === 'function' && awayStatus_\(\)\.on\) \{\s*sendAwayEditionEmail_\(\);\s*return;\s*\}/.test(mn));
  check('trip days count as busy, not light', /capacity_inferred_mode: 'busy'/.test(fnSrc(CODE, 'inferCapacityMode_')) && !/capacity_inferred_mode: 'light'/.test(fnSrc(CODE, 'inferCapacityMode_')));
  check('the other senders hold too', /awayHolds_\('gym_checkin'\)/.test(REM) && /awayHolds_\('health_performance_insight'\)/.test(read('Wellness.js'))
        && /awayHolds_\('monthly_review'\)/.test(read('MonthlyReview.js')) && /awayHolds_\('weekly_trend_review'\)/.test(read('Memory.js')) && /awayHolds_\('email_admin'\)/.test(read('EmailAdmin.js')));
  check('isInVacationMode_ is Away mode now', /return awayStatus_\(\)\.on;/.test(fnSrc(read('Pacing.js'), 'isInVacationMode_')));
}

console.log('\nThe dashboard');
{
  const home = fnSrc(APP, 'HomeTab');
  check('Home shows the Away banner', /React\.createElement\(AwayBanner,\{apiUrl:apiUrl,apiToken:apiToken,onNavigate:onNavigate\}\)/.test(home));
  check('…and the old Vacation Mode banner is gone', !/Vacation Mode/.test(home) && !/showVacation/.test(home) && /showPacing&&/.test(home));
  const b = fnSrc(APP, 'AwayBanner');
  check('the banner reads away_status and the switch posts away_set', /action:'away_status'/.test(b) && /apiPost\(apiUrl,apiToken,\{action:'away_set',on:on/.test(b));
  check('…with the held chips, "See what\'s held" and "End away mode"', /' flags'\)\+' held'/.test(b) && /"See what's held"/.test(b) && /'End away mode'/.test(b));
  const nm = fnSrc(APP, 'NotificationMapPanel');
  check('each notification has a While away setting', /action:'set_notif_while_away',key:key,value:value/.test(nm) && /\{value:'due',label:'Send if due'\}/.test(nm));
  check('…the morning briefing shows the away edition instead', /n\.key==='morning_briefing'\)\?/.test(nm) && /"Away edition"/.test(nm));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
