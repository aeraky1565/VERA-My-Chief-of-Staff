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
  check('VERA only reads their sheets', !/setValue|appendRow|setValues/.test(SRC.slice(SRC.indexOf('function actNowAgentsSync_'), SRC.indexOf('    actNowPostedSave_(posted);\n    try { if (tId)'))));
}

console.log('\nAct now’s memory');
{
  const c = ctx({ state: { NOTIF_ACTNOW: J(['ARIA|x']) } });
  const long = 'hailey|new|https://www.example.test/homedetails/' + 'x'.repeat(80) + '/1_zpid';
  check('a long key becomes a short stand-in, the same every time; a short one is kept', c.actNowShort_(long).length < 40 && c.actNowShort_(long) === c.actNowShort_(long) && c.actNowShort_(long) !== c.actNowShort_(long + '2') && c.actNowShort_('tess|1') === 'tess|1');
  check('…and either form counts as posted', c.actNowWas_([c.actNowShort_(long)], long) && c.actNowWas_([long], long) && !c.actNowWas_([], long));
  check('the old NOTIF list is carried over once', J(c.actNowPostedGet_()) === J(['ARIA|x']));
  c.actNowPostedSave_(['ARIA|x', long, long]);
  check('…saved short, once each, in its own ACTNOW bundle, and the old list cleared', J(JSON.parse(c.__state.ACTNOW_POSTED)) === J(['ARIA|x', c.actNowShort_(long)]) && !c.__state.NOTIF_ACTNOW);
  const many = []; for (let i = 0; i < 400; i++) many.push(long + i);
  c.actNowPostedSave_(many);
  check('…the newest 200, under the 9 KB a Script Property holds', JSON.parse(c.__state.ACTNOW_POSTED).length === 200 && c.__state.ACTNOW_POSTED.length < 9000, c.__state.ACTNOW_POSTED.length);
  check('VERA’s decision deadlines use the same memory', /var posted = actNowPostedGet_\(\);\n    var picks = actNowVeraPicks_/.test(SRC) && !/NOTIF_ACTNOW: JSON\.stringify\(posted/.test(SRC));
  check('ACTNOW is its own state bundle', /ACTNOW: +\['ACTNOW_POSTED', 'ACTNOW_SEEN'\]/.test(read('Settings.js')));
}

console.log('\nWILLA, and HAILEY and TESS follow-ups (read only)');
{
  const c = ctx();
  const cds = [{ name: 'Test Bank CD 1', owner: 'Alex', amount: 10000, apy: 4.1, matures: '2026-11-23' }, { name: 'Test Bank CD 2', amount: 5000, apy: 3.9, matures: '2026-12-20' }, { name: 'Old CD', amount: 1, matures: '2026-11-10' }];
  const plans = [{ item: 'Anniversary trip', month: '2026-12', amount: 6000, confidence: 'committed', canDefer: false }, { item: 'Getaway', month: '2026-12', amount: 1200, confidence: 'maybe', canDefer: true }, { item: 'Later', month: '2027-02', amount: 99 }];
  const w = c.actNowWillaPicks_(cds, plans, '2026-11-18', [], 'https://docs.example.test/w');
  check('WILLA: a CD maturing within 7 days, once per term', J(w.map(p => p.key)) === J(['willa|cd|Test Bank CD 1|2026-11-23']) && /in 5 days/.test(w[0].kind) && /\$10,000/.test(w[0].title) && /roll it over/.test(w[0].reason) && w[0].url === 'https://docs.example.test/w');
  check('…not one further out, not one already matured; once', c.actNowWillaPicks_(cds, plans, '2026-11-18', [w[0].key], '').length === 0);
  const d = c.actNowWillaPicks_([], plans, '2026-12-01', [], '');
  check('…on the 1st, this month’s plan in one post: total and what can wait', d.length === 1 && d[0].key === 'willa|plan|2026-12' && d[0].title === '2 planned this month · $7,200' && /Anniversary trip \$6,000 \(committed\); Getaway \$1,200 \(maybe\)\. 1 can wait\./.test(d[0].reason), J(d));
  check('…not mid-month, and once a month', c.actNowWillaPicks_([], plans, '2026-12-15', [], '').length === 0 && c.actNowWillaPicks_([], plans, '2026-12-02', ['willa|plan|2026-12'], '').length === 0);
  const H = [['Status', 'Address', 'Price', 'Cost flag', 'Notes', 'Zillow URL'],
    ['Gone', '1 Pine Rd, Springfield', '$500,000', 'Under ceiling', 'Not returned 2026-11-17; Gone 2026-11-18', 'https://example.test/1-pine'],
    ['Gone', '3 Pine Rd, Springfield', '$700,000', 'Over ceiling', 'Gone 2026-11-18', 'https://example.test/3-pine'],
    ['Gone', '5 Pine Rd, Springfield', '$700,000', 'Over ceiling', 'Gone 2026-11-18', 'https://example.test/5-pine'],
    ['Gone', '7 Pine Rd, Springfield', '$500,000', 'Under ceiling', 'Gone 2026-11-12', 'https://example.test/7-pine'],
    ['Watching', '9 Pine Rd, Springfield', '$500,000', 'Under ceiling', '', 'https://example.test/9-pine']];
  const g = c.actNowHaileyGonePicks_(H, '2026-11-18', ['hailey|cut|https://example.test/3-pine|2026-11-10']);
  check('HAILEY: off the market today, if it was under the ceiling or VERA posted it', J(g.map(p => p.key)) === J(['hailey|gone|https://example.test/1-pine', 'hailey|gone|https://example.test/3-pine']) && /under your ceiling/.test(g[0].reason) && /VERA posted it here before/.test(g[1].reason) && /was \$500,000/.test(g[0].title), J(g.map(p => p.key)));
  check('…not an over-ceiling home VERA never posted, not one gone another day, not one still listed; once', !g.some(p => /5-pine|7-pine|9-pine/.test(p.key)) && c.actNowHaileyGonePicks_(H, '2026-11-18', g.map(p => p.key)).length === 0);
  const T = [['Date found', 'Company', 'Title', 'Job link', 'Status', 'Notes', 'Salary range'],
    ['2026-11-01', 'Acme Co', 'Director, FP&A', 'https://jobs.example.test/a', 'Saved', 'Hybrid; closes 2026-11-20', '$200K'],
    ['2026-11-01', 'Beta Inc', 'Director', 'https://jobs.example.test/b', 'Saved', 'deadline 2026-12-20', ''],
    ['2026-11-01', 'Gamma LLC', 'VP', 'https://jobs.example.test/c', 'Applied', '', ''],
    ['2026-11-01', 'Delta Corp', 'Head', 'https://jobs.example.test/d', 'Passed', 'closes 2026-11-19', ''],
    ['2026-11-18', 'Eps Ltd', 'Lead', 'https://jobs.example.test/e', 'New', '', '']];
  const first = c.actNowTessFollowPicks_(T, '2026-11-18', [], {});
  check('TESS: a Saved job closing within 3 days, from its notes', J(first.picks.map(p => p.key)) === J(['tess|closes|https://jobs.example.test/a|2026-11-20']) && /in 2 days/.test(first.picks[0].kind) && /Apply before 2026-11-20/.test(first.picks[0].reason));
  check('…the first run only records statuses (Saved and later, not New or Passed)', !first.picks.some(p => /status/.test(p.key)) && first.seen._ === 1 && Object.keys(first.seen).length === 4, J(first.seen));
  const T2 = T.map((r, i) => i === 3 ? r.slice(0, 4).concat(['Interview', '', '']) : i === 1 ? r.slice(0, 4).concat(['Applied', '', '']) : r);
  const next = c.actNowTessFollowPicks_(T2, '2026-11-18', [], first.seen);
  check('…then a status that moved past Saved posts, saying what it was', J(next.picks.map(p => p.kind)) === J(['Now Applied', 'Now Interview']) && /It was saved\./.test(next.picks[0].reason) && /It was applied\./.test(next.picks[1].reason), J(next.picks));
  check('…once, and not again while it stays', c.actNowTessFollowPicks_(T2, '2026-11-18', [], next.seen).picks.length === 0);
  check('the wiring: three new kinds read the same sheets once an hour, and remember TESS statuses', /key: 'hailey_follow_up', cap: 'hailey'/.test(SRC) && /key: 'tess_follow_up', cap: 'tess'/.test(SRC) && /key: 'act_now_willa', cap: 'willa'/.test(SRC) && /if \(grids\[k\]\) return grids\[k\];/.test(SRC) && /ACTNOW_SEEN: JSON\.stringify\(seen\)/.test(SRC));
  check('…their registry rows in Act now, and WILLA’s cap as a setting', ['hailey_follow_up', 'tess_follow_up', 'act_now_willa'].every(k => new RegExp("key: '" + k + "',[^\\n]*category: 'Act now'").test(CODE)) && /\['act_now_cap_willa', +'2'\]/.test(CODE) && /'act_now_cap_willa'/.test(read('docs/app.js')));
}

console.log('\nAgent down, per agent');
{
  const AH = read('AgentHealth.js');
  const mk = (delivery) => {
    const c = { Logger: { log() {} }, JSON, Math, Date, String, Object, posts: [], logs: [], held: [],
      NOTIF_REGISTRY: [{ key: 'agent_down_aria' }, { key: 'agent_down_tess' }, { key: 'agent_down_hailey' }],
      notifDelivery_: k => (delivery || {})[k] || 'slack', notifHold_: (k, t) => c.held.push([k, t]),
      getNotifChannel_: k => k === 'agent_down_tess' ? 'job-search' : 'vera-logs', getSlackChannelId_: n => 'C_' + n,
      sendSlackLog_: t => c.logs.push(t), sendSlackMessage_: (id, t) => c.posts.push([id, t]) };
    vm.createContext(c); vm.runInContext(AH, c); return c;
  };
  const items = [{ name: 'ARIA', line: '❌ ARIA: failed — x' }, { name: 'TESS', line: '⚠️ TESS: late — y' }, { name: 'HAILEY', line: '✅ HAILEY: back on time — z' }];
  const a = mk(); a.agentHealthPost_(items);
  check('each agent goes where its own row says: #vera-logs by default, another channel if chosen', a.logs.length === 1 && /ARIA: failed/.test(a.logs[0]) && /HAILEY: back/.test(a.logs[0]) && !/TESS/.test(a.logs[0]) && a.posts.length === 1 && a.posts[0][0] === 'C_job-search' && /TESS: late/.test(a.posts[0][1]));
  const b = mk({ agent_down_aria: 'off', agent_down_hailey: 'email' }); b.agentHealthPost_(items);
  check('…Off sends nothing for that agent, Morning email waits for the email', !b.logs.some(t => /ARIA|HAILEY/.test(t)) && b.held.length === 1 && b.held[0][0] === 'agent_down_hailey');
  check('the nightly check uses it, and the flags are still held', /if \(ch\.items\.length\) \{ try \{ agentHealthPost_\(ch\.items\); \} catch \(e\) \{\} \}/.test(AH) && /upsertKeyedFlags_\(flagSheet, AGENT_FLAG_PREFIX_/.test(AH));
  check('three rows in System Health', ['aria', 'tess', 'hailey'].every(n => new RegExp("key: 'agent_down_" + n + "',[^\\n]*category: 'System Health'").test(CODE)));
}

console.log('\nWiring');
{
  check('sendNudge_ asks the gate first', /if \(notifKey && typeof notifGate_ === 'function'\) \{\n    if \(!notifGate_\(notifKey,/.test(REM));
  check('…and no longer logs "Reminder sent", only a failure', !/'\\u23f0 Reminder sent/.test(REM) && !/sendSlackLog_\(delivered/.test(REM) && /Reminder FAILED to send/.test(REM));
  check('isNotifEnabled_ means "not off"', /return notifDeliveryFrom_\(key, cfg\) !== 'off';/.test(CODE));
  check('the morning email shows what was held, and clears it only after it goes', /notifHeldHtmlNow_\(\) : ''\) \+\s*\n\s*stalenessNotice/.test(CODE) && CODE.indexOf('notifHeldClear_()') > CODE.indexOf("sendVeraEmail_(CONFIG.MORNING_NUDGE_EMAIL, subject, plainText, mailOptions, 'morning_briefing');"));
  check('the nightly tail posts the count line', /sendSlackLog_\('📊 ' \+ notifCountLine_\(notifCounts_\(\)\.yesterday\)\)/.test(CODE));
  check('the weekend memo: email only, no Slack ping', !/Weekend memo is ready/.test(read('WeekendPlanner.js')) && /notifGate_\('weekend_memo'/.test(read('WeekendPlanner.js')));
  check('Settings: a Where route; any Slack channel by name', /case 'set_notif_delivery':\s+return jsonOut_\((peopleOwnerOnly_\(\) \|\| )?webSetNotifDelivery_\(e\)\);/.test(WEB) && /\^\[a-z0-9\]\[a-z0-9_-\]\{0,79\}\$/.test(WEB) && /id = '#' \+ name;/.test(SLACK));
  check('the map reports each kind’s Where and what it is', /delivery: notifDeliveryFrom_\(n\.key, config\), kind: notifKind_\(n\.key\)/.test(WEB));
  check('the new settings have Config rows', ['morning_checkin_time', 'morning_checkin_weekend_time', 'evening_checkin_time', 'notif_quiet_start', 'notif_quiet_end', 'notif_daily_cap', 'movement_times', 'work_hours', 'movement_daily_cap', 'act_now_cap_aria', 'act_now_cap_vera'].every(k => CODE.indexOf("['" + k + "',") !== -1));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
