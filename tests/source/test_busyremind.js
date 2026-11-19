// Two pieces of the agreed notifications design (docs/mockups/notifications.html, #250):
//  · Work busy times (Config work_busy_ics, optional): a free/busy link from the work calendar,
//    so a movement nudge waits out a meeting instead of landing in one.
//  · "Remind me at 11 AM" on #vera-act-now posts: about 3 hours on, before the deadline, never
//    after 9 PM; the tap remembers it and it's posted again then.
// Invented data throughout.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOTIFY = read('Notify.js'), SLACK = read('Slack.js'), ARIA = read('Aria.js'), APP = read('docs/app.js'), SET = read('Settings.js');

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
const c = { Math, Date, parseInt, String, JSON, Object, Array };
vm.createContext(c);
vm.runInContext(/var ACT_REMIND_LAST_HOUR_ = .*;/.exec(NOTIFY)[0] + '\n' +
  ['icsLines_', 'icsWhen_', 'icsBusyBlocks_', 'moveBusyAt_', 'actRemindAt_', 'actClock_', 'actRemindAfterTap_', 'actRemindTitle_', 'actRemindDue_'].map(n => extractFn(NOTIFY, n)).join('\n'), c);
// Eastern time, 5 hours behind UTC in November.
const toLocal = ms => { const d = new Date(ms - 5 * 3600000); return { iso: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; };
const ics = (...evs) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...evs.flatMap(e => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const blocks = (text, day) => J(c.icsBusyBlocks_(text, day, toLocal));

console.log('Reading busy times');
{
  check('a local-time meeting today', blocks(ics(['UID:a', 'DTSTART;TZID=Eastern Standard Time:20261119T100000', 'DTEND;TZID=Eastern Standard Time:20261119T110000']), '2026-11-19') === '[[600,660]]');
  check('a UTC meeting becomes local time', blocks(ics(['UID:b', 'DTSTART:20261119T183000Z', 'DTEND:20261119T190000Z']), '2026-11-19') === '[[810,840]]');
  check('another day’s meeting doesn’t count', blocks(ics(['UID:a', 'DTSTART:20261118T100000', 'DTEND:20261118T110000']), '2026-11-19') === '[]');
  check('free and cancelled ones are skipped', blocks(ics(['UID:f', 'DTSTART:20261119T100000', 'DTEND:20261119T110000', 'TRANSP:TRANSPARENT'], ['UID:x', 'DTSTART:20261119T120000', 'DTEND:20261119T130000', 'STATUS:CANCELLED']), '2026-11-19') === '[]');
  check('all-day entries aren’t meetings', blocks(ics(['UID:d', 'DTSTART;VALUE=DATE:20261119', 'DTEND;VALUE=DATE:20261120']), '2026-11-19') === '[]');
  const wk = ['UID:w', 'DTSTART:20261102T143000', 'DTEND:20261102T150000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261231T000000Z'];
  check('a weekly meeting on its days (Mon, Thu)', blocks(ics(wk), '2026-11-19') === '[[870,900]]' && blocks(ics(wk), '2026-11-18') === '[]');
  check('…not after its UNTIL', blocks(ics(wk), '2027-01-07') === '[]');
  check('…not on an EXDATE', blocks(ics(wk.concat(['EXDATE:20261119T143000'])), '2026-11-19') === '[]');
  check('…and a moved occurrence replaces it', blocks(ics(wk, ['UID:w', 'RECURRENCE-ID:20261119T143000', 'DTSTART:20261119T160000', 'DTEND:20261119T163000']), '2026-11-19') === '[[960,990]]');
  check('a daily standup, every other day with INTERVAL=2', blocks(ics(['UID:s', 'DTSTART:20261116T091500', 'DTEND:20261116T093000', 'RRULE:FREQ=DAILY;INTERVAL=2']), '2026-11-18') === '[[555,570]]' && blocks(ics(['UID:s', 'DTSTART:20261116T091500', 'DTEND:20261116T093000', 'RRULE:FREQ=DAILY;INTERVAL=2']), '2026-11-19') === '[]');
  check('folded lines are read', blocks('BEGIN:VEVENT\r\nUID:z\r\nDTSTART:2026111\r\n 9T100000\r\nDTEND:20261119T103000\r\nEND:VEVENT', '2026-11-19') === '[[600,630]]');
  check('busy at 10:30 during 10–11, free at 11:00', c.moveBusyAt_([[600, 660]], 630) && !c.moveBusyAt_([[600, 660]], 660) && !c.moveBusyAt_(null, 630));
}

console.log('\nMovement waits out a meeting');
{
  const body = extractFn(NOTIFY, 'checkMovement_');
  check('a slot in a meeting isn’t sent, and isn’t spent', /if \(moveBusyAt_\(workBusyToday_\(cfg, now\), minute\)\) \{\s*try \{ veraStateSet_\('NOTIF', \{ NOTIF_MOVE: JSON\.stringify\(mv0\) \}\); \} catch \(e\) \{\}\s*return false;/.test(body));
  check('…checked after the slot is found, before it goes', body.indexOf('moveBusyAt_(') > body.indexOf('moveDue_(') && body.indexOf('moveBusyAt_(') < body.indexOf('sendNudge_('));
  const fn = extractFn(NOTIFY, 'workBusyToday_');
  check('no link, or one that isn’t https/webcal: nothing to wait for', /if \(!\/\^https:\\\/\\\/\/i\.test\(url\)\) return null;/.test(fn) && /replace\(\/\^webcal:\\\/\\\/\/i, 'https:\/\/'\)/.test(fn));
  check('read at most every 30 minutes, and a failed read is ignored', /put\(key, JSON\.stringify\(blocks\), 1800\)/.test(fn) && /getResponseCode\(\) !== 200\) \{[^}]*return null;/.test(fn));
  check('Settings › Config has it, masked, under Calendars', /\{id:'workbusy',l:'Work busy times \(optional\)',type:'text',key:'work_busy_ics',mask:true,/.test(APP));
  check('a blank Config row is added for it', /\['work_busy_ics',\s+''\]/.test(read('Co' + 'de.js')));
}

console.log('\nRemind me at …');
{
  const H = 3600000, at = (y, mo, d, h, mi) => Date.UTC(y, mo, d, h + 5, mi || 0);   // Eastern → UTC ms
  const hourAt = ms => new Date(ms - 5 * H).getUTCHours();
  const when = (now, end) => { const t = c.actRemindAt_(now, end, hourAt); return t ? hourAt(t) + ':' + new Date(t - 5 * H).getUTCMinutes() : 0; };
  check('about 3 hours on, on the hour (7:12 → 11 AM)', when(at(2026, 10, 19, 7, 12), at(2026, 10, 19, 23, 59)) === '11:0');
  check('an hour before a deadline that comes sooner (4 PM, ends 6:30 → 5 PM)', when(at(2026, 10, 19, 16, 0), at(2026, 10, 19, 18, 30)) === '17:0');
  check('never after 9 PM (7:30 PM → 9 PM)', when(at(2026, 10, 19, 19, 30), at(2026, 10, 20, 23, 59)) === '21:0');
  check('no button when there’s no sensible time (8:40 PM, or a deadline an hour away)', when(at(2026, 10, 19, 20, 40), at(2026, 10, 20, 23, 59)) === 0 && when(at(2026, 10, 19, 15, 0), at(2026, 10, 19, 16, 0)) === 0);
  check('the label reads like a clock', c.actClock_(11, 0) === '11 AM' && c.actClock_(21, 0) === '9 PM' && c.actClock_(13, 30) === '1:30 PM' && c.actClock_(0, 0) === '12 AM');
  const post = [{ type: 'section', text: { type: 'mrkdwn', text: '*Keep or cancel the Denver hotel?*\nAfter tonight it’s non-refundable.' } },
    { type: 'actions', elements: [{ action_id: 'acknowledge_flag' }, { action_id: 'act_remind', value: '1' }, { action_id: 'snooze_flag' }] }];
  const after = c.actRemindAfterTap_(post, '⏰ I’ll remind you at 9:00 PM.');
  check('after the tap: the button is gone, the others stay, and a line says when', J(after[1].elements.map(e => e.action_id)) === J(['acknowledge_flag', 'snooze_flag']) && after[2].elements[0].text === '⏰ I’ll remind you at 9:00 PM.');
  check('…and an actions row left empty is removed', c.actRemindAfterTap_([post[0], { type: 'actions', elements: [{ action_id: 'act_remind' }] }], 'x').every(b => b.type !== 'actions'));
  check('the reminder carries the post’s title', c.actRemindTitle_({ blocks: post }) === 'Keep or cancel the Denver hotel?' && c.actRemindTitle_({ text: '🧭 ARIA says *book* now: Denver.' }) === '🧭 ARIA says book now: Denver.');
  const split = c.actRemindDue_([{ at: 10, title: 'a' }, { at: 30, title: 'b' }], 20);
  check('due ones go, the rest wait', J(split.due.map(r => r.title)) === '["a"]' && J(split.keep.map(r => r.title)) === '["b"]');
  check('the 15-minute tick posts them', /try \{ actRemindTick_\(now\); \}/.test(extractFn(NOTIFY, 'checkinTick_')));
  check('…in the post’s channel, saying when you asked', /sendSlackMessage_\(r\.ch, '⏰ Reminder: ' \+ r\.title/.test(extractFn(NOTIFY, 'actRemindTick_')) && /You asked at ' \+ r\.from/.test(extractFn(NOTIFY, 'actRemindTick_')));
  check('reminders live in the NOTIF bundle, at most 30', /'NOTIF_ACTNOW', 'NOTIF_REMIND'\]/.test(SET) && /list\.slice\(-30\)/.test(extractFn(NOTIFY, 'actRemindTap_')));
  check('the live Slack handler takes the tap', /actionId === 'act_remind'[\s\S]{0,300}ackText = actRemindTap_\(payload\);[\s\S]{0,200}updatedBlocks = actRemindAfterTap_/.test(extractFn(SLACK, 'handleSlackInteractionSync_')));
  check('VERA’s decision posts have it between Done and Later', /'acknowledge_flag', value: item\.id \},\s*typeof actRemindButton_ === 'function' \? actRemindButton_\(new Date\(item\.due \+ 'T23:59:00'\)\.getTime\(\)\) : null,\s*\{ type: 'button', text: \{ type: 'plain_text', text: 'Later' \}/.test(extractFn(NOTIFY, 'actNowBlocks_')));
  check('HAILEY, TESS and WILLA posts have it', /var rb = typeof actRemindButton_ === 'function' \? actRemindButton_\(0\) : null;\s*if \(rb\) acts\.push\(rb\);/.test(extractFn(NOTIFY, 'actNowAgentBlocks_')));
  check('ARIA’s Book now and price-drop posts have it', /actRemindButton_\(0\)/.test(extractFn(ARIA, 'ariaPostBookNow_')) && /actRemindButton_\(0\)/.test(extractFn(ARIA, 'ariaRebookBlocks_')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
