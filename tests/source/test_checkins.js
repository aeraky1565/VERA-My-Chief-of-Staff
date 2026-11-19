// The Slack check-ins match the agreed mockup (docs/mockups/notifications.html, #250).
//
// WHAT WENT WRONG. #250 moved the check-ins to the agreed times and channels, but the
// messages themselves were never rebuilt: the evening one still read "Wednesday Evening
// Check-In" with Yes / I walked instead / No, the morning one "Morning Check-In — 3 quick
// taps" with three 1–5 rows, and the movement nudge was plain text with no Done or Skip.
//
// Agreed:
//   ☀️ Morning. How are you starting the day?   Slept ≤5 h…9 h+ · Energy 1–5 · Mood 😞😐🙂😄
//   🌙 Evening check-in · Did you move today? You logged 2 movement breaks.
//      [🏋️ Gym] [🚶 Walk] [🧘 Stretch] [Not today] · Tomorrow: Dentist at 4:30. The electric bill is still unpaid.
//   🚶 5-minute reset · Stand, walk a lap, refill your water. Next one around 1:30. [Done] [Skip]
//      Movement · 1 of 3 today · Done moves the next one 2 h out
// Invented data throughout.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SLACK = read('Slack.js'), NOTIFY = read('Notify.js'), GYM = read('GymTracker.js'), REM = read('Reminders.js');

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
const pad = n => String(n).padStart(2, '0');
const text = blocks => blocks.map(b => b.type === 'actions' ? '[' + b.elements.map(e => e.text.text).join('] [') + ']'
  : b.type === 'context' ? b.elements[0].text : b.text.text).join('\n');

function ctx() {
  const c = { clock: new Date(2026, 10, 19, 10, 40).getTime(), state: {}, sent: [], String, Number, JSON, Math, Array, Object, parseInt };
  const RealDate = Date;
  c.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(c.clock); } static now() { return c.clock; } };
  Object.assign(c, {
    Logger: { log() {} }, Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      : f === 'yyyy-MM' ? d.getFullYear() + '-' + pad(d.getMonth() + 1) : f === 'H' ? String(d.getHours()) : f === 'm' ? String(d.getMinutes())
      : f === 'h:mm a' ? ((d.getHours() + 11) % 12 + 1) + ':' + pad(d.getMinutes()) + (d.getHours() < 12 ? ' AM' : ' PM') : String(d) },
    veraStateGet_: () => Object.assign({}, c.state), veraStateSet_: (b, p) => Object.assign(c.state, p),
    sendNudge_: (...a) => c.sent.push(a), awayStatus_: () => ({ on: false }), ptsVerizonHolidays_: () => ({}),
    readPTOConfig_: () => ({}), getPTOEvents_: () => ({ events: [] }),
  });
  vm.createContext(c);
  vm.runInContext([/var MOVE_GAP_MIN_ = .*;/.exec(NOTIFY)[0], ...['notifMinutes_', 'moveTimes_', 'moveDue_', 'moveDayOff_', 'movePtoOn_', 'checkMovement_', 'moveState_', 'moveTooSoon_',
    'moveClock_', 'moveMessage_', 'moveTap_', 'moveDoneToday_', 'eveningExtraLine_', 'eveningFirstTomorrow_', 'eveningUnpaid_', 'eveningContext_'].map(n => extractFn(NOTIFY, n))].join('\n'), c);
  vm.runInContext([/var WELL_MOOD_ = .*;/.exec(SLACK)[0], /var EVENING_MOVE_IDS_ = [\s\S]*?\};/.exec(SLACK)[0],
    ...['wellShow_', 'buildMorningWellnessBlocks_', 'wellnessAfterTap_', 'buildEveningCheckinBlocks_', 'eveningAfterTap_', 'moveAfterTap_'].map(n => extractFn(SLACK, n))].join('\n'), c);
  vm.runInContext(['gymWeekDone_', 'eveningReply_', 'eveningMoveLog_'].map(n => extractFn(GYM, n)).join('\n'), c);
  return c;
}

console.log('The morning check-in');
{
  const c = ctx();
  const b = c.buildMorningWellnessBlocks_(null, null);
  check('it opens "☀️ Morning. How are you starting the day?"', b[0].text.text === '☀️ *Morning.* How are you starting the day?', b[0].text.text);
  check('three rows: Slept, Energy, Mood, each with a small label (not a button)',
    J(b.filter(x => x.type === 'context').map(x => x.elements[0].text)) === J(['*Slept*', '*Energy*', '*Mood*']) &&
    b.filter(x => x.type === 'actions').every(r => r.elements.every(e => !/wellness_label_/.test(e.action_id))));
  const row = id => b.filter(x => x.block_id === 'wellness_row_' + id)[0].elements.map(e => e.text.text + '=' + e.action_id.split('_').pop());
  check('Slept: ≤5 h · 6 h · 7 h · 8 h · 9 h+', J(row('hours')) === J(['≤5 h=5', '6 h=6', '7 h=7', '8 h=8', '9 h+=9']), J(row('hours')));
  check('Energy: 1–5', J(row('energy')) === J(['1=1', '2=2', '3=3', '4=4', '5=5']));
  check('Mood: 😞 😐 🙂 😄, logged as 1, 3, 4, 5', J(row('mood')) === J(['😞=1', '😐=3', '🙂=4', '😄=5']), J(row('mood')));
  check('no "Sleep quality" row any more', !b.some(x => x.block_id === 'wellness_row_sleep'));
  check('with a watch: no Slept row, and it says what the watch read', !c.buildMorningWellnessBlocks_(7.5, null).some(x => x.block_id === 'wellness_row_hours') && /You slept 7\.5 h/.test(c.buildMorningWellnessBlocks_(7.5, null)[0].text.text));
  const after = c.wellnessAfterTap_(b, 'mood', 4);
  check('a tap turns the label and its row into one "✅ Mood 🙂" line', !after.some(x => x.block_id === 'wellness_lbl_mood') && after.filter(x => x.block_id === 'wellness_row_mood')[0].text.text === '✅ *Mood* 🙂' && after.length === b.length - 1);
  check('…and leaves the other rows to tap', after.some(x => x.block_id === 'wellness_row_energy' && x.type === 'actions'));
  check('the old title and its 3-taps line are gone', !/Morning Check-In\* — 3 quick taps/.test(SLACK));
}

console.log('\nThe evening check-in');
{
  const c = ctx();
  const b = c.buildEveningCheckinBlocks_({ moved: 2, extra: 'Tomorrow: Dentist at 4:30. The electric bill is still unpaid.' });
  check('it reads as agreed', text(b) === '🌙 *Evening check-in*\nDid you move today? You logged 2 movement breaks.\n[🏋️ Gym] [🚶 Walk] [🧘 Stretch] [Not today]\nTomorrow: Dentist at 4:30. The electric bill is still unpaid.', text(b));
  check('one break reads in the singular; none leaves the count out', /You logged 1 movement break\./.test(text(c.buildEveningCheckinBlocks_({ moved: 1 }))) && /Did you move today\?\n/.test(text(c.buildEveningCheckinBlocks_({ moved: 0 }))));
  check('nothing tomorrow and no bill: no extra line', c.buildEveningCheckinBlocks_({ moved: 0, extra: '' }).length === 2);
  check('the old title and buttons are gone', !/Evening Check-In\*|I walked instead|No — skipped/.test(SLACK));
  // The context.
  c.ev = [{ title: 'Standup', start: '2026-11-20T09:00', allDay: false }, { title: 'Dentist', start: '2026-11-20T16:30', allDay: false },
          { title: 'Holiday', start: '2026-11-20T00:00', allDay: true }, { title: 'Tonight', start: '2026-11-19T21:00', allDay: false }];
  check('tomorrow: the first timed event, as a 12-hour time', J(vm.runInContext('eveningFirstTomorrow_(ev, "2026-11-20")', c)) === J({ title: 'Standup', time: '9:00' }));
  c.ev2 = c.ev.slice(1);
  check('…4:30 for 16:30; all-day and tonight’s events left out', J(vm.runInContext('eveningFirstTomorrow_(ev2, "2026-11-20")', c)) === J({ title: 'Dentist', time: '4:30' }));
  c.rows = [['Electric', 142, 19, 'Monthly', '', '', '', '', 'Expense'], ['Water', 40, 20, 'Monthly', '', '', '2026-11', '', 'Expense'],
            ['Paycheck', 0, 19, '', '', '', '', '', 'Income'], ['Rent', 2000, 1, '', '', '', '', '', 'Expense'], ['Internet', 70, 20, '', '', '', '', '', 'Expense']];
  check('unpaid bills due today or tomorrow; paid, income and other days left out', J(vm.runInContext('eveningUnpaid_(rows, 19, 20, "2026-11")', c)) === J(['electric', 'internet']));
  check('the line: tomorrow first, then at most two bills', c.eveningExtraLine_({ title: 'Dentist', time: '4:30' }, ['electric', 'internet', 'gas']) === 'Tomorrow: Dentist at 4:30. The electric bill is still unpaid. The internet bill is still unpaid.');
  check('it goes with the evening check-in', /sendEveningCheckinSlack_\(typeof eveningContext_ === 'function' \? eveningContext_\(now\) : null\)/.test(REM));
  check('the calendar is the personal one (lgEvents_: no work calendar)', /lgEvents_\(from, to\)/.test(extractFn(NOTIFY, 'eveningContext_')));
}

console.log('\nAnswering the evening check-in');
{
  const mk = log => { const c = ctx(); c.clock = new Date(2026, 10, 19, 20, 5).getTime(); c.log = log; c.calls = [];
    c.getGymLog_ = () => c.log; c.logGymAttendance_ = (id, a) => { c.calls.push(a + ':' + id); c.log.forEach(s => { if (s.id === id) s.attended = a; }); };
    c.webWorkoutAdd_ = e => { c.calls.push('add:' + e.parameter.type); c.log.push({ id: 'add', date: '2026-11-19', attended: 'Yes', type: e.parameter.type }); };
    c.getConfigValues = () => ({ fitness_weekly_target: '4' }); c.wkTarget_ = cfg => parseInt(cfg.fitness_weekly_target, 10); return c; };
  const week = () => [{ id: 'G-mon', date: '2026-11-16', attended: 'Yes', type: 'Gym' }, { id: 'G-old', date: '2026-10-02', attended: '', type: 'Gym' }];
  let c = mk(week().concat([{ id: 'G-today', date: '2026-11-19', attended: '', type: 'Gym' }]));
  let r = c.eveningMoveLog_('gym');
  check('Gym marks today’s planned workout as went', J(c.calls) === J(['Yes:G-today']), J(c.calls));
  check('…and says the week so far', r === '✅ Logged: gym. That’s 2 of 4 this week.', r);
  c = mk(week());
  check('Gym with nothing planned today adds one', c.eveningMoveLog_('gym') && J(c.calls) === J(['add:Gym']));
  c = mk(week());
  r = c.eveningMoveLog_('walk');
  check('Walk adds a walk', J(c.calls) === J(['add:Walk']) && r === '✅ Logged: a walk. That’s 2 of 4 this week.', r);
  c = mk(week().concat([{ id: 'G-today', date: '2026-11-19', attended: '', type: 'Gym' }]));
  r = c.eveningMoveLog_('none');
  check('Not today marks today’s planned workout as skipped', J(c.calls) === J(['No:G-today']) && r === 'Logged: not today. 1 of 4 this week so far.', r);
  c = mk(week());
  c.eveningMoveLog_('none');
  check('…and never touches an old open session (the old Yes button did)', !c.calls.some(x => /G-old/.test(x)));
  c = mk(week().concat([{ id: 'w', date: '2026-11-19', attended: 'Yes', type: 'Walk' }]));
  c.eveningMoveLog_('walk');
  check('a walk already logged today isn’t added twice', c.calls.length === 0);
  check('the week starts on Monday', c.gymWeekDone_([{ date: '2026-11-15', attended: 'Yes' }, { date: '2026-11-16', attended: 'Yes' }], '2026-11-19') === 1);
  check('every button maps to an answer, old ids too', J(c.EVENING_MOVE_IDS_) === J({ evening_move_gym: 'gym', evening_move_walk: 'walk', evening_move_stretch: 'stretch', evening_move_none: 'none', evening_checkin_yes: 'gym', evening_checkin_walk: 'walk', evening_checkin_no: 'none' }));
  const b = c.buildEveningCheckinBlocks_({ moved: 2 });
  const after = c.eveningAfterTap_(b, '✅ Logged: gym. That’s 2 of 4 this week.');
  check('after a tap the buttons become the answer, the question stays', after.length === b.length && after[0] === b[0] && after[1].type === 'section' && /Logged: gym/.test(after[1].text.text));
  const live = extractFn(SLACK, 'handleSlackInteractionSync_');
  check('the live Slack handler logs the answer and updates the message', /EVENING_MOVE_IDS_\[actionId\]/.test(live) && /ackText = eveningMoveLog_\(kind\)/.test(live) && /updatedBlocks = eveningAfterTap_/.test(live));
  check('…and no longer posts "Nice work" and a #vera-logs line per tap', !/Nice work/.test(live) && !/Evening check-in — /.test(live));
}

console.log('\nThe movement nudge');
{
  const c = ctx();
  const m = c.moveMessage_(630, [630, 810, 930]);
  check('it reads as agreed', text(m.blocks) === '🚶 *5-minute reset*\nStand, walk a lap, refill your water. Next one around 1:30.\n[Done] [Skip]\nMovement · 1 of 3 today · Done moves the next one 2 h out', text(m.blocks));
  check('the last one says so', /That’s the last one today\./.test(c.moveMessage_(930, [630, 810, 930]).blocks[0].text.text) && /3 of 3 today/.test(text(c.moveMessage_(930, [630, 810, 930]).blocks)));
  check('it goes out with its buttons', c.checkMovement_(new Date(2026, 10, 19, 10, 41), {}) === true && c.sent.length === 1 && c.sent[0][2] === m.text && J(c.sent[0][5]) === J(m.blocks));
  check('sendNudge_ passes buttons to Slack', /function sendNudge_\(ruleKey, subject, message, notifKey, due, blocks\)/.test(REM) && /sendSlack_\(ch, message, blocks\)/.test(REM));
  c.clock = new Date(2026, 10, 19, 12, 40).getTime();
  const reply = c.moveTap_('done', new c.Date());
  check('Done is counted and says when the next can come', reply === '✅ Logged. Nice. Next nudge no sooner than 2:40 PM.' && c.moveDoneToday_(new c.Date()) === 1, reply);
  check('the 1:30 one is passed over (inside 2 h of the tap)', c.checkMovement_(new Date(2026, 10, 19, 13, 31), {}) === false && c.sent.length === 1);
  check('…and the 3:30 one goes', c.checkMovement_(new Date(2026, 10, 19, 15, 31), {}) === true && c.sent.length === 2);
  check('Skip waits 2 h too, but isn’t counted', /^Skipped\. Next nudge no sooner than /.test(c.moveTap_('skip', new c.Date())) && c.moveDoneToday_(new c.Date()) === 1);
  c.clock = new Date(2026, 10, 20, 9, 0).getTime();
  check('a new day starts at 0', c.moveDoneToday_(new c.Date()) === 0);
  check('the evening count is the day’s Done taps', /moved = moveDoneToday_\(now\)/.test(extractFn(NOTIFY, 'eveningContext_')));
  const after = c.moveAfterTap_(m.blocks, 'Skipped.');
  check('a tap replaces the buttons with the reply', after[1].type === 'section' && after[1].text.text === 'Skipped.' && after[2] === m.blocks[2]);
  check('the live handler takes Done and Skip', /actionId === 'move_done' \|\| actionId === 'move_skip'/.test(extractFn(SLACK, 'handleSlackInteractionSync_')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
