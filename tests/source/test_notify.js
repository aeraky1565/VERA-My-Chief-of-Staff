// Notifications, one home per kind (#250, Notify.js): where each kind goes, quiet hours, the
// daily cap, the morning email's "Held for this email", the count line that replaced
// "Reminder sent", movement on a schedule, check-in times to the minute, act-now caps and
// posts, one-tap sleep, and the wiring. Invented data.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));
const J = JSON.stringify;
const SRC = read('Notify.js'), CODE = read('Code.js'), REM = read('Reminders.js'), SLACK = read('Slack.js'), WEB = read('WebApp.js');

function ctx(opts) {
  opts = opts || {};
  const state = Object.assign({}, opts.state || {});
  const c = { Logger: { log() {} }, JSON, Math, Date, String, Object, parseInt, isNaN, sent: [], held: [],
    getConfigValues: () => opts.cfg || {},
    Utilities: { formatDate: (d, tz, f) => { const p = n => String(n).padStart(2, '0'); if (f === 'yyyy-MM-dd') return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); if (f === 'H') return String(d.getHours()); if (f === 'm') return String(d.getMinutes()); return 'Wed 9:00 AM'; } },
    Session: { getScriptTimeZone: () => 'UTC' },
    veraStateGet_: () => Object.assign({}, state), veraStateSet_: (b, p) => { Object.keys(p).forEach(k => { if (p[k] == null) delete state[k]; else state[k] = String(p[k]); }); },
    awayHolds_: () => !!opts.away,
    sendNudge_: (k, s, m, n) => c.sent.push([k, s, n]),
    NOTIF_REGISTRY: [{ key: 'bill_due', emoji: '💳', label: 'Bill Due' }, { key: 'usps_mail', emoji: '📬', label: 'USPS Mail Scan' }],
  };
  vm.createContext(c);
  vm.runInContext(SRC, c);
  c.__state = state;
  return c;
}

console.log('\nWhere each kind goes');
{
  const c = ctx();
  check('a push kind goes to Slack by default; the morning-email kinds to the email', c.notifDeliveryFrom_('bill_due', {}) === 'slack' && c.notifDeliveryFrom_('usps_mail', {}) === 'email' && c.notifDeliveryFrom_('flag_low', {}) === 'email' && c.notifDeliveryFrom_('movement', {}) === 'slack');
  check('Config notif_<key>_delivery overrides it', c.notifDeliveryFrom_('usps_mail', { notif_usps_mail_delivery: 'slack' }) === 'slack' && c.notifDeliveryFrom_('bill_due', { notif_bill_due_delivery: 'email' }) === 'email');
  check('the old notif_<key>_enabled = FALSE still means off', c.notifDeliveryFrom_('bill_due', { notif_bill_due_enabled: 'FALSE' }) === 'off');
  check('a check-in is Slack or off; a long read is email or off', c.notifDeliveryFrom_('gym_checkin', { notif_gym_checkin_delivery: 'email' }) === 'slack' && c.notifDeliveryFrom_('weekend_memo', { notif_weekend_memo_delivery: 'slack' }) === 'email' && c.notifDeliveryFrom_('weekend_memo', { notif_weekend_memo_delivery: 'off' }) === 'off');
  check('act-now kinds are their own kind', c.notifKind_('act_now_vera') === 'act' && c.notifKind_('gym_checkin') === 'checkin' && c.notifKind_('bill_due') === 'push');
}

console.log('\nQuiet hours and the daily cap');
{
  const c = ctx();
  check('quiet hours run past midnight: 21:00 to 07:00 by default', c.notifQuietAt_(22 * 60, {}) && c.notifQuietAt_(6 * 60 + 59, {}) && !c.notifQuietAt_(7 * 60, {}) && !c.notifQuietAt_(20 * 60 + 59, {}));
  check('…or any window you set, and none when start = end', c.notifQuietAt_(13 * 60, { notif_quiet_start: '12:30', notif_quiet_end: '14:00' }) && !c.notifQuietAt_(22 * 60, { notif_quiet_start: '12:30', notif_quiet_end: '14:00' }) && !c.notifQuietAt_(3 * 60, { notif_quiet_start: '07:00', notif_quiet_end: '07:00' }));
  check('the cap is 6 unless set', c.notifCap_({}) === 6 && c.notifCap_({ notif_daily_cap: '3' }) === 3 && c.notifCap_({ notif_daily_cap: 'lots' }) === 6);
  const d = (k, st) => c.notifDecide_(k, Object.assign({ delivery: 'slack', kind: 'push', away: false, quiet: false, pushed: 0, cap: 6 }, st)).go + ':' + c.notifDecide_(k, Object.assign({ delivery: 'slack', kind: 'push', away: false, quiet: false, pushed: 0, cap: 6 }, st)).why;
  check('a push in the day is sent', d('bill_due', {}) === 'send:push');
  check('off sends nothing; a morning-email kind waits for the email', d('bill_due', { delivery: 'off' }) === 'skip:off' && d('usps_mail', { delivery: 'email' }) === 'digest:email');
  check('quiet hours: into the email, except travel, leaving home and act-now', d('bill_due', { quiet: true }) === 'digest:quiet' && d('leave_home', { quiet: true }) === 'send:always' && d('travel_day_briefing', { quiet: true }) === 'send:always' && d('act_now_vera', { quiet: true, kind: 'act' }) === 'send:always');
  check('past the cap: into the email; check-ins and act-now don’t count', d('bill_due', { pushed: 6 }) === 'digest:cap' && d('gym_checkin', { pushed: 9, kind: 'checkin' }) === 'send:checkin' && d('aria_book_now', { pushed: 9 }) === 'send:always');
  check('Away mode holds it', d('bill_due', { away: true }) === 'skip:away');
  check('system messages are never gated', d('error_alerts', { delivery: 'off', quiet: true, pushed: 99 }) === 'send:system');
}

console.log('\nThe gate, counts and the email’s waiting list');
{
  const at = (h, m) => { const RealDate = Date; return class extends RealDate { constructor(...a) { if (a.length) super(...a); else { super(2026, 10, 18, h, m); } } static now() { return new RealDate(2026, 10, 18, h, m).getTime(); } }; };
  const c = ctx({ cfg: { notif_daily_cap: '2' } });
  c.Date = at(10, 0);
  check('sent, and counted', c.notifGate_('bill_due', 'Bill Due: Water $40') === true && c.notifGate_('bill_due', 'Bill Due: Power') === true && JSON.parse(c.__state.NOTIF_COUNTS).push === 2);
  check('past the cap it waits for the email', c.notifGate_('bill_due', 'Bill Due: Internet $70') === false && JSON.parse(c.__state.NOTIF_DIGEST)[0].text === 'Bill Due: Internet $70');
  check('…once, however often it’s asked', c.notifGate_('bill_due', 'Bill Due: Internet $70') === false && JSON.parse(c.__state.NOTIF_DIGEST).length === 1);
  check('a morning-email kind waits too, without a push', c.notifGate_('usps_mail', 'Mail today: 3 pieces') === false && JSON.parse(c.__state.NOTIF_DIGEST).length === 2);
  const html = c.notifHeldHtmlNow_();
  check('the morning email shows them, labelled by kind, escaped', /📨 Held for this email/.test(html) && /💳 Bill Due · Wed 9:00 AM<\/span><br>Bill Due: Internet \$70/.test(html) && /📬 USPS Mail Scan/.test(html));
  check('…and nothing when there’s nothing waiting', c.notifHeldHtml_([], {}) === '');
  c.notifHeldClear_();
  check('cleared after the email goes', c.notifHeldList_().length === 0);
  const q = ctx(); q.Date = at(22, 30);
  check('at 10:30 PM a push waits for the email', q.notifGate_('bill_due', 'Late one') === false && JSON.parse(q.__state.NOTIF_DIGEST)[0].text === 'Late one');
  const r = ctx({ state: { NOTIF_DAY: '2026-11-17', NOTIF_COUNTS: J({ push: 5, checkin: 2, held: 3 }) } }); r.Date = at(1, 0);
  const y = r.notifCounts_().yesterday;
  check('a new day: today’s counts start at zero, the day before becomes yesterday', y.push === 5 && y.day === '2026-11-17' && J(r.notifCounts_().counts) === '{}');
  check('the nightly count line', r.notifCountLine_(y) === 'Yesterday: 5 pushes · 2 check-ins · 3 held for the morning email' && r.notifCountLine_({}) === 'Yesterday: nothing sent' && r.notifCountLine_({ push: 1, read: 1 }) === 'Yesterday: 1 push · 1 email read');
  const b = ctx(); b.getConfigValues = () => { throw new Error('sheet down'); };
  check('a broken gate sends rather than silencing VERA', b.notifGate_('bill_due', 'x') === true);
}

console.log('\nMovement on a schedule');
{
  const c = ctx();
  check('the times inside work hours, at most the cap', J(c.moveTimes_({})) === '[630,810,930]' && J(c.moveTimes_({ movement_times: '8:00, 11:00, 14:00, 16:30, 18:00', work_hours: '9:00-17:00', movement_daily_cap: '2' })) === '[660,840]');
  const t = [630, 810, 930];
  check('a slot is due from its time until the next one (an hourly run at :41 still catches 10:30)', c.moveDue_(10 * 60 + 41, t, [], false) === 630 && c.moveDue_(13 * 60 + 41, t, [630], false) === 810);
  check('…once', c.moveDue_(10 * 60 + 50, t, [630], false) === -1);
  check('…not before the first, and not long after the last', c.moveDue_(9 * 60, t, [], false) === -1 && c.moveDue_(18 * 60, t, [], false) === -1);
  check('never on a day off', c.moveDue_(10 * 60 + 41, t, [], true) === -1);
  check('PTO: a day inside a block', c.movePtoOn_([{ startDate: '2026-11-25', endDate: '2026-11-27' }], '2026-11-26') && !c.movePtoOn_([{ startDate: '2026-11-25', endDate: '2026-11-27' }], '2026-11-28'));
  const w = ctx(); w.awayStatus_ = () => ({ on: false }); w.ptsVerizonHolidays_ = () => ({ '2026-11-26': 'Thanksgiving' }); w.readPTOConfig_ = () => ({}); w.getPTOEvents_ = () => ({ events: [] });
  check('a weekend and a holiday are days off; a plain Tuesday isn’t', w.moveDayOff_(new Date(2026, 10, 21)) && w.moveDayOff_(new Date(2026, 10, 26)) && !w.moveDayOff_(new Date(2026, 10, 17)));
  w.awayStatus_ = () => ({ on: true });
  check('…and so is a day away', w.moveDayOff_(new Date(2026, 10, 17)));
  const m = ctx(); m.awayStatus_ = () => ({ on: false }); m.ptsVerizonHolidays_ = () => ({}); m.readPTOConfig_ = () => ({}); m.getPTOEvents_ = () => ({ events: [] });
  check('the nudge goes through sendNudge_ as Movement, once per slot', m.checkMovement_(new Date(2026, 10, 17, 10, 41), {}) === true && m.checkMovement_(new Date(2026, 10, 17, 10, 55), {}) === false && m.sent.length === 1 && m.sent[0][2] === 'movement');
  check('the three old rules are gone from the hourly run', /function\(\) \{ checkMovement_\(now, cfg\); \}/.test(REM) && !/checkErgonomicBreak_|checkHydration_|checkCalendarOpportunity_/.test(REM));
  check('…and from the registry, with Movement in their place', /key: 'movement',/.test(CODE) && !/key: 'desk_break'|key: 'water_break'|key: 'calendar_opportunity'/.test(CODE));
}

console.log('\nCheck-in times, to the minute');
{
  const c = ctx();
  check('morning 6:30 on workdays, 8:30 at weekends, evening 8 PM', c.checkinAt_('morning', {}, false) === 390 && c.checkinAt_('morning', {}, true) === 510 && c.checkinAt_('evening', {}, false) === 1200);
  check('your times win; the old hour-only settings still work when the new ones are blank', c.checkinAt_('morning', { morning_checkin_time: '05:45' }, false) === 345 && c.checkinAt_('morning', { wellness_checkin_hour: '7' }, false) === 420 && c.checkinAt_('evening', { mobility_reminder_hour: '21' }, false) === 1260);
  check('due from its time for two hours', c.checkinDue_(390, 390) && c.checkinDue_(509, 390) && !c.checkinDue_(389, 390) && !c.checkinDue_(510, 390));
  check('the morning and evening check-ins use them', /checkinDue_\(minute, checkinAt_\('morning', cfg, weekend\)\)/.test(REM) && /checkinDue_\(minute, checkinAt_\('evening', cfg, false\)\)/.test(REM));
  check('the 15-minute trigger runs the check-ins (only when the trigger ran it)', /if \(forceRefresh === undefined \|\| \(forceRefresh && typeof forceRefresh === 'object'\)\) \{ try \{ checkinTick_\(\); \}/.test(read('FlightStatus.js')));
}

console.log('\nSleep: Google Fit is gone, one tap instead');
{
  check('no Google Fit call, function, or scope', !/fetchGoogleFitSleep_\(\)/.test(REM) && !/function fetchGoogleFitSleep_/.test(read('Wellness.js')) && !/fitness\./.test(read('appsscript.json')));
  const blocksSrc = SLACK.slice(SLACK.indexOf('function wellShow_'), SLACK.indexOf('function sendMorningWellnessSlack_'));
  const s = { Utilities: { formatDate: () => 'Wednesday' }, Session: { getScriptTimeZone: () => 'UTC' }, String, JSON };
  vm.createContext(s); vm.runInContext(blocksSrc, s);
  const row = s.buildMorningWellnessBlocks_(null, null).filter(b => b.block_id === 'wellness_row_hours')[0];
  check('the check-in asks for hours slept: ≤5 h · 6 · 7 · 8 · 9 h+', row && J(row.elements.slice(1).map(e => e.text.text)) === J(['≤5 h', '6 h', '7 h', '8 h', '9 h+']) && row.elements[3].action_id === 'wellness_hours_7');
  check('…and doesn’t ask when a watch already gave it', s.buildMorningWellnessBlocks_(7.5, null).every(b => b.block_id !== 'wellness_row_hours'));
  check('a tap reads back as hours, a rating as /5', s.wellShow_('hours', 7) === '7 h' && s.wellShow_('hours', 5) === '≤5 h' && s.wellShow_('hours', '9') === '9 h+' && s.wellShow_('mood', 4) === '4/5');
  check('a tap logs sleep_hours, manual', (SLACK.match(/hours: 'sleep_hours'/g) || []).length === 2);
}

console.log('\n#vera-act-now');
{
  const c = ctx();
  const rows = [
    ['F1', '', 'Planned', '↩️ Last days to return the lamp', 'The return window ends 2026-11-19.', 'Medium', '', '', '', 'PPURCH|return|p1', '', '2026-11-19'],
    ['F2', '', 'Cards', 'Lounge pass expires', '', 'Medium', '', '', '', 'perk_expiry_x', '', '2026-11-25'],
    ['F3', '', 'Coupons', 'Coupon ends', '', 'Low', '', '', '', 'coupon_expiry_z', '', '2026-11-18'],
    ['F4', '', 'Planned', 'Return the chair', '', 'Medium', '', '', 'Yes', 'PPURCH|return|p2', '', '2026-11-18']];
  const picks = c.actNowVeraPicks_(rows, '2026-11-18', []);
  check('VERA posts its own decisions ending within 2 days, open ones only', J(picks.map(p => p.id)) === '["F1"]');
  check('…once each', c.actNowVeraPicks_(rows, '2026-11-18', ['PPURCH|return|p1|2026-11-19']).length === 0);
  const b = c.actNowBlocks_('VERA', picks[0], 1, 3, '2026-11-18');
  check('the post: badge and deadline, title and why, Done and Later, "act-now 1 of 3 today"', /\*VERA\*  ·  ⏳ Ends 2026-11-19/.test(b[0].elements[0].text) && /\*↩️ Last days to return the lamp\*\nThe return window ends/.test(b[1].text.text) && b[2].elements[0].action_id === 'acknowledge_flag' && b[2].elements[0].value === 'F1' && b[2].elements[1].action_id === 'snooze_flag' && /act-now 1 of 3 today/.test(b[3].elements[0].text));
  check('a cap per assistant, 3 unless set', c.actNowCap_({}, 'aria') === 3 && c.actNowCap_({ act_now_cap_aria: '1' }, 'aria') === 1);
  const d = ctx({ cfg: { act_now_cap_aria: '1' } });
  check('past it, nothing more today', d.actNowAllowed_('aria') === true && d.actNowAllowed_('aria') === false);
  check('ARIA’s Book now honours the cap, and the rest waits for the email', /if \(typeof actNowAllowed_ === 'function' && !actNowAllowed_\('aria'\)\) \{ posted\.push\(p\.id\); notifHold_\('aria_book_now', p\.text\); return; \}/.test(read('Aria.js')));
  check('Act now is its own category: ARIA Book Now and VERA Decision Deadline', /key: 'aria_book_now',[^\n]*category: 'Act now'/.test(CODE) && /key: 'act_now_vera',[^\n]*category: 'Act now'/.test(CODE));
  check('hourlyCheck posts VERA’s', /try \{ actNowVeraSync_\(new Date\(\)\); \}/.test(REM));
}

console.log('\nHAILEY and TESS in #vera-act-now (read only)');
{
  const c = ctx();
  const id = v => String(v || '').slice(0, 10);
  const H = [['Status', 'Address', 'Market', 'Type', 'Beds', 'Baths', 'Sqft', 'Price', 'Est. monthly cost', 'Cost flag', 'Deck', 'First seen', 'Last seen', 'Price history', 'Notes', 'Missed runs', 'Zillow URL'],
    ['New', '12 Elm Ct, Springfield', 'Test market', 'singleFamily', '4', '3', '2,200', '$530,000', '$3,900', 'Under ceiling', '', '2026-11-18', '2026-11-18', '', '', '0', 'https://example.test/12-elm'],
    ['New', '14 Elm Ct, Springfield', 'Test market', 'singleFamily', '4', '3', '2,400', '$690,000', '$5,000', 'Over ceiling', '', '2026-11-18', '2026-11-18', '', '', '0', 'https://example.test/14-elm'],
    ['New', '16 Elm Ct, Springfield', 'Test market', 'singleFamily', '4', '3', '2,400', '$520,000', '$3,800', 'Under ceiling', '', '2026-11-16', '2026-11-18', '', '', '0', 'https://example.test/16-elm'],
    ['Price cut', '18 Oak St, Springfield', 'Test market', 'townhome', '3', '3', '1,900', '$600,000', '$4,300', 'Over ceiling', '', '2026-10-24', '2026-11-18', '610000 (10-24); 600000 (11-18)', 'Price cut $5,000 on 2026-11-02. Price cut $10,000 on 2026-11-18', '0', 'https://example.test/18-oak'],
    ['Price cut', '20 Oak St, Springfield', 'Test market', 'townhome', '3', '3', '1,900', '$600,000', '$4,300', 'Over ceiling', '', '2026-10-24', '2026-11-18', '', 'Price cut $1,000 on 2026-11-10.', '0', 'https://example.test/20-oak'],
    ['Gone', '22 Oak St, Springfield', 'Test market', 'townhome', '3', '3', '1,900', '$600,000', '$4,300', 'Under ceiling', '', '2026-10-24', '2026-11-18', '', 'Price cut $1,000 on 2026-11-18.', '0', '']];
  const hp = c.actNowHaileyPicks_(H, '2026-11-18', [], id);
  check('HAILEY: a listing first seen today, under the ceiling', hp.some(p => p.key === 'hailey|new|https://example.test/12-elm' && /About \$3,900 a month, under your ceiling\. 4 bd · 3 ba · 2,200 sqft/.test(p.reason)));
  check('…not one over the ceiling, and not one first seen another day', !hp.some(p => /14-elm|16-elm/.test(p.key)));
  check('…and a price cut made today, from its notes', hp.some(p => p.key === 'hailey|cut|https://example.test/18-oak|2026-11-18' && /^Price cut \$10,000 today\./.test(p.reason) && /now \$600,000/.test(p.title)));
  check('…not an older cut, and nothing for a home that’s gone', !hp.some(p => /20-oak|22 Oak/.test(p.key)) && hp.length === 2, J(hp.map(p => p.key)));
  check('…once each', c.actNowHaileyPicks_(H, '2026-11-18', hp.map(p => p.key), id).length === 0);
  const T = [['Date found', 'Company', 'Title', 'Tier', 'Score', 'Job link', 'Materials folder', 'Status', 'Notes', 'Salary range', 'Suggested person', 'Score breakdown', 'Track', 'Pass reason'],
    ['2026-11-18', 'Acme Co', 'Director, FP&A', '1', '88', 'https://jobs.example.test/1', '', 'New', '', '$200K-$240K', '', '', 'FP&A', ''],
    ['2026-11-18', 'Beta Inc', 'Director, Planning', '1', '82', 'https://jobs.example.test/2', '', 'New', '', '', '', '', 'FP&A', ''],
    ['2026-11-17', 'Gamma LLC', 'VP Finance', '1', '93', 'https://jobs.example.test/3', '', 'New', '', '', '', '', 'FP&A', ''],
    ['2026-11-18', 'Delta Corp', 'Head of FP&A', '1', '95', 'https://jobs.example.test/4', '', 'Passed', '', '', '', '', 'FP&A', '']];
  const tp = c.actNowTessPicks_(T, '2026-11-18', [], 85, id);
  check('TESS: a New match found today scoring 85 or more', J(tp.map(p => p.key)) === '["tess|https://jobs.example.test/1"]' && tp[0].title === 'Director, FP&A · Acme Co' && tp[0].reason === '$200K-$240K · Track: FP&A · Tier 1' && /score 88/.test(tp[0].kind));
  check('…not below the bar, not another day, not one already passed', !tp.some(p => /\/(2|3|4)$/.test(p.key)));
  check('…the bar is configurable', c.actNowTessPicks_(T, '2026-11-18', [], 80, id).length === 2);
  check('…and a missing column reads blank rather than breaking', c.actNowTessPicks_([['Company', 'Status'], ['X', 'New']], '2026-11-18', [], 85, id).length === 0);
  const b = c.actNowAgentBlocks_('HAILEY', hp[0], 1, 3);
  check('the post: badge, what it is, the home, why, Open, "act-now 1 of 3 today"', /\*HAILEY\*  ·  ⏳ today  ·  New listing under your ceiling/.test(b[0].elements[0].text) && b[2].elements[0].url === 'https://example.test/12-elm' && /HAILEY · act-now 1 of 3 today/.test(b[3].elements[0].text));
  check('…no Open button without a link', c.actNowAgentBlocks_('HAILEY', { kind: 'x', title: 't', reason: '', url: '' }, 1, 3).every(x => x.type !== 'actions'));
  check('hourlyCheck posts them; both kinds are in Act now, with caps and the TESS bar as settings', /try \{ actNowAgentsSync_\(new Date\(\)\); \}/.test(REM) && /key: 'act_now_hailey',[^\n]*category: 'Act now'/.test(CODE) && /key: 'act_now_tess',[^\n]*category: 'Act now'/.test(CODE) && /\['act_now_tess_min_score', +'85'\]/.test(CODE) && /\['act_now_cap_hailey',/.test(CODE));
  check('VERA only reads their sheets', !/setValue|appendRow|setValues/.test(SRC.slice(SRC.indexOf('function actNowAgentsSync_'), SRC.indexOf('veraStateSet_(\'NOTIF\', { NOTIF_ACTNOW: JSON.stringify(posted.slice(-150))'))));
}

console.log('\nWiring');
{
  check('sendNudge_ asks the gate first', /if \(notifKey && typeof notifGate_ === 'function'\) \{\n    if \(!notifGate_\(notifKey,/.test(REM));
  check('…and no longer logs "Reminder sent", only a failure', !/'\\u23f0 Reminder sent/.test(REM) && !/sendSlackLog_\(delivered/.test(REM) && /Reminder FAILED to send/.test(REM));
  check('isNotifEnabled_ means "not off"', /return notifDeliveryFrom_\(key, cfg\) !== 'off';/.test(CODE));
  check('the morning email shows what was held, and clears it only after it goes', /notifHeldHtmlNow_\(\) : ''\) \+\s*\n\s*stalenessNotice/.test(CODE) && CODE.indexOf('notifHeldClear_()') > CODE.indexOf("sendVeraEmail_(CONFIG.MORNING_NUDGE_EMAIL, subject, plainText, mailOptions, 'morning_briefing');"));
  check('the nightly tail posts the count line', /sendSlackLog_\('📊 ' \+ notifCountLine_\(notifCounts_\(\)\.yesterday\)\)/.test(CODE));
  check('the weekend memo: email only, no Slack ping', !/Weekend memo is ready/.test(read('WeekendPlanner.js')) && /notifGate_\('weekend_memo'/.test(read('WeekendPlanner.js')));
  check('Settings: a Where route; any Slack channel by name', /case 'set_notif_delivery':\s+return jsonOut_\(webSetNotifDelivery_\(e\)\);/.test(WEB) && /\^\[a-z0-9\]\[a-z0-9_-\]\{0,79\}\$/.test(WEB) && /id = '#' \+ name;/.test(SLACK));
  check('the map reports each kind’s Where and what it is', /delivery: notifDeliveryFrom_\(n\.key, config\), kind: notifKind_\(n\.key\)/.test(WEB));
  check('the new settings have Config rows', ['morning_checkin_time', 'morning_checkin_weekend_time', 'evening_checkin_time', 'notif_quiet_start', 'notif_quiet_end', 'notif_daily_cap', 'movement_times', 'work_hours', 'movement_daily_cap', 'act_now_cap_aria', 'act_now_cap_vera'].every(k => CODE.indexOf("['" + k + "',") !== -1));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
