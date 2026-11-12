// #vera-act-now: one Slack channel for alerts that go stale within hours. ARIA's
// Book now and Book this stay post there by default. Pins: the channel resolves
// from Script Property SLACK_ACT_NOW_CHANNEL_ID; until that is set it falls back to
// #vera-notifications (nothing lost); other channels are unchanged and never fall
// back; the System › Notifications picker and its server check both offer it; ARIA's
// poster accepts it. Invented channel IDs.
const fs = require('fs'), vm = require('vm'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.VERA_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SLACK = read('Slack.js'), CODE = read('Code.js'), WEB = read('WebApp.js'), APP = read('docs/app.js'), ARIA = read('Aria.js');

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ok   ' + n))
                             : (fail++, console.log('  FAIL ' + n + (d !== undefined ? '  — ' + d : '')));

const fnSrc = (src, name) => { const a = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', a); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return a === -1 ? '' : src.slice(a, j + 1); };
const resolver = (props, cfg) => { const c = vm.createContext({ String, getConfigValues: () => cfg || {}, PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) } }); vm.runInContext(fnSrc(SLACK, 'getSlackChannelId_'), c); return n => c.getSlackChannelId_(n); };

console.log('\nresolving the channel');
{
  const both = resolver({ SLACK_ACT_NOW_CHANNEL_ID: 'C-ACT', SLACK_NOTIFICATIONS_CHANNEL_ID: 'C-NOTE', SLACK_LOGS_CHANNEL_ID: 'C-LOG' });
  check('vera-act-now resolves to its own channel ID', both('vera-act-now') === 'C-ACT' && both('act-now') === 'C-ACT');
  check('the other channels are unchanged', both('vera-notifications') === 'C-NOTE' && both('vera-logs') === 'C-LOG');
  const unset = resolver({ SLACK_NOTIFICATIONS_CHANNEL_ID: 'C-NOTE' });
  check('until its ID is set, act-now posts go to #vera-notifications', unset('vera-act-now') === 'C-NOTE');
  check('…but no other channel falls back', unset('vera-logs') === '' && unset('vera-chat') === '');
  check('with no Slack set up at all, nothing resolves', resolver({})('vera-act-now') === '');
  const cfg = resolver({ SLACK_NOTIFICATIONS_CHANNEL_ID: 'C-NOTE' }, { slack_act_now_channel_id: ' C0ACTNOW1 ' });
  check('the ID can come from the Config tab instead (Script Properties full)', cfg('vera-act-now') === 'C0ACTNOW1');
  check('…a Config value that isn\'t a channel ID (a #name, a link) is ignored: back to #vera-notifications',
        resolver({ SLACK_NOTIFICATIONS_CHANNEL_ID: 'C-NOTE' }, { slack_act_now_channel_id: '#vera-act-now' })('vera-act-now') === 'C-NOTE');
  check('…and a Script Property, when set, wins', resolver({ SLACK_ACT_NOW_CHANNEL_ID: 'C-ACT' }, { slack_act_now_channel_id: 'C0ACTNOW1' })('vera-act-now') === 'C-ACT');
  check('a broken Config read never stops the post', (() => { const c = vm.createContext({ String, getConfigValues: () => { throw new Error('x'); }, PropertiesService: { getScriptProperties: () => ({ getProperty: k => ({ SLACK_NOTIFICATIONS_CHANNEL_ID: 'C-NOTE' })[k] || null }) } }); vm.runInContext(fnSrc(SLACK, 'getSlackChannelId_'), c); return c.getSlackChannelId_('vera-act-now') === 'C-NOTE'; })());
}

console.log('\nwho posts there');
{
  const row = (CODE.match(/\{ key: 'aria_book_now',[^\n]*\}/) || [''])[0];
  check('ARIA Book Now (flights and stays) defaults to #vera-act-now', /channel: 'vera-act-now'/.test(row), row);
  const others = (CODE.match(/channel: 'vera-act-now'/g) || []).length;
  check('…and nothing else does yet', others === 1, others);
  check('ARIA\'s poster accepts the channel', /if \(!\/\^vera-\/\.test\(ch\)\) return 0;/.test(ARIA) && /^vera-/.test('vera-act-now'));
  check('the Notifications picker offers it', /\{value:'vera-act-now',label:'#vera-act-now'\}/.test(APP));
  check('…and the server accepts it', /var valid = \[[^\]]*'vera-act-now'[^\]]*\];/.test(WEB));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
