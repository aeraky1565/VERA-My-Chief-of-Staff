// Compact Slack messages: one short line per question, small controls on the right.
//
// WHAT WENT WRONG. Slack's phone app gives every button in an actions row its own
// full-width line, so the morning check-in (5 + 5 + 4 buttons) became a tall wall, and
// every act-now post carried three full-width buttons.
//
// Agreed (Nov 28):
//   ☀️ Morning. How are you starting the day?
//   Slept                [Choose ▾]
//   Energy               [Choose ▾]
//   Mood                 [Choose ▾]
//   Other messages: the first button on the right of the text, the rest on the footer line:
//   one more button, or a ⋯ menu. A pick from a dropdown or menu acts exactly like the button.
// Invented data throughout.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = process.env.VERA_ROOT || path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SLACK = read('Slack.js'), NOTIFY = read('Notify.js'), ARIA = read('Aria.js');

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
const c = { JSON, Object, String, Number, Math, Array, Logger: { log() {} }, Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: { formatDate: () => '9' }, veraStateGet_: () => ({}), veraStateSet_: () => {} };
vm.createContext(c);
vm.runInContext([/var SLACK_PICK_SEP_ = .*;/.exec(SLACK)[0], /var WELL_MOOD_ = .*;/.exec(SLACK)[0], /var EVENING_MOVE_IDS_ = [\s\S]*?\};/.exec(SLACK)[0],
  ...['slackOpt_', 'slackSoloText_', 'slackCompact_', 'slackNormalizeAction_', 'slackNoControls_', 'wellShow_', 'buildMorningWellnessBlocks_',
    'wellnessAfterTap_', 'buildEveningCheckinBlocks_', 'eveningAfterTap_', 'moveAfterTap_', 'buildFlagBlocks_'].map(n => extractFn(SLACK, n)),
  ...['moveClock_', 'moveMessage_', 'actNowBlocks_', 'actNowAgentBlocks_', 'actRemindAfterTap_'].map(n => extractFn(NOTIFY, n)),
  extractFn(ARIA, 'ariaRebookBlocks_')].join('\n'), c);
const noActions = bs => bs.every(b => b.type !== 'actions');
const btn = (id, label, extra) => Object.assign({ type: 'button', text: { type: 'plain_text', text: label }, action_id: id, value: id + 'V' }, extra || {});

console.log('The morning check-in');
{
  const m = c.slackCompact_(c.buildMorningWellnessBlocks_(null, null));
  check('four lines: the question, then Slept, Energy and Mood, with no rows of buttons', m.length === 4 && noActions(m), J(m.map(b => b.type)));
  const row = id => m.filter(b => b.block_id === 'wellness_row_' + id)[0];
  check('each question is one line: its label, and a Choose dropdown on the right',
    ['hours', 'energy', 'mood'].every(id => row(id) && row(id).type === 'section' && row(id).accessory.type === 'static_select' && row(id).accessory.placeholder.text === 'Choose')
    && row('hours').text.text === '*Slept*' && row('energy').text.text === '*Energy*' && row('mood').text.text === '*Mood*');
  check('the labels are no longer separate lines', !m.some(b => /wellness_lbl_/.test(b.block_id || '')));
  check('Slept offers ≤5 h · 6 h · 7 h · 8 h · 9 h+', J(row('hours').accessory.options.map(o => o.text.text)) === J(['≤5 h', '6 h', '7 h', '8 h', '9 h+']));
  check('…Energy 1–5 and Mood 😞 😐 🙂 😄', J(row('energy').accessory.options.map(o => o.text.text)) === J(['1', '2', '3', '4', '5']) && J(row('mood').accessory.options.map(o => o.text.text)) === J(['😞', '😐', '🙂', '😄']));
  check('each choice carries the button it stands for', row('hours').accessory.options[2].value === 'wellness_hours_7::7');
  const ids = m.filter(b => b.accessory).map(b => b.accessory.action_id);
  check('each dropdown has its own id (Slack needs them unique)', new Set(ids).size === ids.length);
  const after = c.wellnessAfterTap_(m, 'mood', 4);
  check('a pick turns that line into "✅ Mood 🙂" and leaves the others to answer',
    after.filter(b => b.block_id === 'wellness_row_mood')[0].text.text === '✅ *Mood* 🙂' && !after.filter(b => b.block_id === 'wellness_row_mood')[0].accessory && row('energy') && after.filter(b => b.block_id === 'wellness_row_energy')[0].accessory);
  check('with a watch: no Slept line', !c.slackCompact_(c.buildMorningWellnessBlocks_(7.5, null)).some(b => b.block_id === 'wellness_row_hours'));
}

console.log('\nA pick acts like the button');
{
  const p = { actions: [{ type: 'static_select', action_id: 'vera_pick_wellness_row_hours', selected_option: { value: 'wellness_hours_7::7' } }] };
  c.slackNormalizeAction_(p);
  check('a dropdown pick becomes wellness_hours_7 with value 7', p.actions[0].action_id === 'wellness_hours_7' && p.actions[0].value === '7');
  const q = { actions: [{ type: 'overflow', action_id: 'vera_more_x', selected_option: { value: 'snooze_flag::F12' } }] };
  c.slackNormalizeAction_(q);
  check('a ⋯ pick becomes the button (snooze_flag, F12)', q.actions[0].action_id === 'snooze_flag' && q.actions[0].value === 'F12');
  const r = { actions: [{ type: 'button', action_id: 'acknowledge_flag', value: 'F1' }] };
  c.slackNormalizeAction_(r);
  check('a plain button is left alone', r.actions[0].action_id === 'acknowledge_flag' && r.actions[0].value === 'F1');
  check('the live handler reads picks this way', /var payload = slackNormalizeAction_\(JSON\.parse\(payloadStr\)\);/.test(SLACK));
}

console.log('\nThe evening check-in');
{
  const m = c.slackCompact_(c.buildEveningCheckinBlocks_({ moved: 2, extra: 'Tomorrow: Dentist at 4:30.' }));
  check('the question, then one line with a Choose dropdown (Gym, Walk, Stretch, Not today), then tomorrow', noActions(m) && m.length === 3
    && m[1].block_id === 'evening_move' && m[1].accessory.type === 'static_select' && J(m[1].accessory.options.map(o => o.value)) === J(['evening_move_gym::gym', 'evening_move_walk::walk', 'evening_move_stretch::stretch', 'evening_move_none::none']), J(m));
  const after = c.eveningAfterTap_(m, '✅ Logged: gym.');
  check('a pick: the question stays, the dropdown line becomes the answer', /Did you move today/.test(after[0].text.text) && after[1].text.text === '✅ Logged: gym.' && after.every(b => !b.accessory));
}

console.log('\nThe 5-minute reset');
{
  const m = c.slackCompact_(c.moveMessage_(600, [600, 780, 900]).blocks);
  check('Done sits on the right of the nudge; Skip on the footer line', m.length === 2 && m[0].accessory.action_id === 'move_done' && m[0].accessory.style === 'primary'
    && m[1].block_id === 'move_row' && m[1].accessory.action_id === 'move_skip' && /1 of 3 today/.test(m[1].text.text), J(m));
  const after = c.moveAfterTap_(m, '✅ Logged. Nice.');
  check('a tap: both buttons go, the footer line becomes the reply', after.every(b => !b.accessory) && after[1].text.text === '✅ Logged. Nice.');
}

console.log('\nFlags and act-now posts');
{
  const f = c.slackCompact_(c.buildFlagBlocks_({ id: 'F9', flag: 'Car registration', urgency: 'High', reason: 'Due Friday' }));
  check('a flag: Acknowledge on the right; Snooze on a short line below it', f[0].accessory.action_id === 'acknowledge_flag' && f[1].accessory.action_id === 'snooze_flag'
    && /Snooze 3 days/.test(f[1].text.text) && f[2].type === 'divider', J(f));
  const a = c.slackCompact_([
    { type: 'context', elements: [{ type: 'mrkdwn', text: '*VERA*  ·  ⏳ Ends today' }] },
    { type: 'section', text: { type: 'mrkdwn', text: '*Return the lamp*' } },
    { type: 'actions', elements: [btn('acknowledge_flag', '✓ Done', { style: 'primary', value: 'F1' }), btn('act_remind', 'Remind me at 9 PM', { value: '123' }), btn('snooze_flag', 'Later', { value: 'F1' })] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'VERA · act-now 1 of 3 today' }] }]);
  check('act-now: Done on the right of the title; Remind me and Later in a ⋯ menu on the footer line', a.length === 3 && a[1].accessory.action_id === 'acknowledge_flag'
    && a[2].accessory.type === 'overflow' && J(a[2].accessory.options.map(o => o.value)) === J(['act_remind::123', 'snooze_flag::F1']) && /act-now 1 of 3/.test(a[2].text.text), J(a));
  const r = c.actRemindAfterTap_(a, '⏰ I’ll remind you at 9:00 PM.');
  check('after Remind me: the menu is just a Later button, and a line says when', r[2].accessory.type === 'button' && r[2].accessory.action_id === 'snooze_flag' && r[2].accessory.value === 'F1' && r[r.length - 1].elements[0].text === '⏰ I’ll remind you at 9:00 PM.', J(r));
  const solo = c.actRemindAfterTap_(c.slackCompact_([{ type: 'section', text: { type: 'mrkdwn', text: 'Book now' } }, { type: 'actions', elements: [btn('act_remind', 'Remind me at 9 PM')] }]), 'ok');
  check('a lone Remind me button on the right goes away after the tap', !solo[0].accessory);
  const ag = c.slackCompact_([{ type: 'section', text: { type: 'mrkdwn', text: '*Apply*' } }, { type: 'actions', elements: [btn('act_now_open', 'Open', { style: 'primary', url: 'https://x.test/j' }), btn('act_remind', 'Remind me')] }]);
  check('Open keeps its link on the right', ag[0].accessory.url === 'https://x.test/j' && ag[1].accessory.action_id === 'act_remind');
  const many = c.slackCompact_([{ type: 'section', text: { type: 'mrkdwn', text: 't' } }, { type: 'actions', elements: [btn('a', 'A', { style: 'primary' }), btn('b', 'B'), btn('c', 'C')] }]);
  check('with no footer, the ⋯ line names what is in it', many[1].text.text === '_More: B · C_' && many[1].accessory.type === 'overflow');
}

console.log('\nEverything that posts');
{
  check('every message to Slack is compacted before it goes', /payload\.blocks {4}= slackCompact_\(blocks\);/.test(SLACK) && /blocks: slackCompact_\(blocks\)/.test(extractFn(SLACK, 'sendMorningWellnessSlack_')) && /payload\.blocks = slackCompact_\(blocks\);/.test(extractFn(SLACK, 'sendSlackResponse_')));
  check('no other file posts to Slack directly', !/chat\.postMessage/.test(NOTIFY + ARIA + read('Reminders.js')));
  const same = [{ type: 'section', text: { type: 'mrkdwn', text: 'x' } }];
  check('a message with no buttons is unchanged', J(c.slackCompact_(same)) === J(same));
  const orig = c.buildFlagBlocks_({ id: 'F1', flag: 'x', urgency: 'Low' }), copy = J(orig);
  c.slackCompact_(orig);
  check('compacting leaves the original blocks as they were', J(orig) === copy);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
